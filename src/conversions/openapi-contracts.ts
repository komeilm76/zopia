import { ZopiaError } from '../errors';
import type { OpenApiOperationIR } from './openapi-ir';
import type { OpenApiDocument } from './openapi';
import { decodeJsonPointerSegment, resolveOpenApiLocalRef } from './openapi-ref';

/** Normalized non-body operation parameter consumed by endpoint rendering. */
export interface OperationParameter {
  /** Exact source parameter name. */
  name: string;
  /** Supported OpenAPI parameter location. */
  in: 'path' | 'query' | 'header' | 'cookie';
  /** Whether callers must provide the parameter. */
  required: boolean;
  /** Resolved JSON Schema for the parameter value, when present. */
  schema?: unknown;
  /** Reusable parameter component whose bare `$ref` declared this parameter (D-18); absent for inline or sibling-merged resolutions. */
  reusable?: string;
}

/** Normalized request, parameter, and response contracts for one operation. */
export interface OperationContracts {
  /** Resolved non-body operation parameters. */
  parameters: OperationParameter[];
  /** Primary request body contract, when the operation accepts a body. */
  requestBody?: {
    /** Selected request media type. */
    contentType: string;
    /** Resolved request JSON Schema, when present. */
    schema?: unknown;
    /** Whether callers must provide a request body. */
    required: boolean;
    /** Reusable parameter component whose bare `$ref` declared a Swagger `in: body` parameter (D-18). */
    reusable?: string;
    /** Reusable parameter component names for each bare-`$ref` formData property (D-18). */
    formDataReusable?: Record<string, string>;
  };
  /** Response contracts in source-document order. */
  responses: Array<{
    /** Original response status key. */
    status: string;
    /** Required OpenAPI response description. */
    description: string;
    /** Selected response media type, when the response has content. */
    contentType?: string;
    /** Resolved response JSON Schema, when present. */
    schema?: unknown;
    /** Reusable response component whose bare `$ref` declared this status (D-18); absent for inline or sibling-merged resolutions. */
    reusable?: string;
  }>;
}

function firstContent(content: unknown): { contentType?: string; schema?: unknown } {
  if (content === undefined) return {};
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid content: expected an object');
  const entries = Object.entries(content as Record<string, any>);
  if (entries.length === 0) return {};
  const [contentType, media] = entries.find(([type]) => type.toLowerCase() === 'application/json') ?? entries[0];
  if (!contentType || !media || typeof media !== 'object' || Array.isArray(media)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid media type content: ${contentType}`);
  return { contentType, schema: media.schema };
}

function primarySwaggerMediaType(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const types = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return types.find((type) => type.toLowerCase() === 'application/json' || type.toLowerCase().endsWith('+json')) ?? types[0];
}

function assertSwaggerMediaTypes(value: unknown, field: 'consumes' | 'produces', at: string): void {
  if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger ${field}: ${at}`);
}

const SWAGGER_SCHEMA_KEYS = new Set(['format', 'items', 'default', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'enum', 'multipleOf']);
const SWAGGER_PARAMETER_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array']);

function isValidSwaggerItems(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) return false;
  seen.add(value);
  const type = (value as Record<string, unknown>).type;
  return SWAGGER_PARAMETER_TYPES.has(type as string) && (type !== 'array' || isValidSwaggerItems((value as Record<string, unknown>).items, seen));
}

/**
 * Test whether a response key is valid for the selected source dialect.
 *
 * @param status Response-object key to validate.
 * @param swagger Whether the target dialect is Swagger 2.0.
 * @returns Whether the key is `default`, an exact HTTP status, or an OpenAPI range.
 */
export function isValidResponseStatus(status: string, swagger: boolean): boolean {
  return status === 'default' || /^[1-5]\d{2}$/.test(status) || !swagger && /^[1-5]XX$/.test(status);
}

function pathParameterNames(path: string): Set<string> {
  return new Set([...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]));
}

/**
 * Derive the effective schema of a Swagger 2.0 non-body/formData parameter.
 *
 * @param parameter Validated Swagger parameter object.
 * @returns The parameter's top-level constraint keywords as a JSON Schema (`file` renders as `string`/`binary`).
 */
export function swaggerParameterSchema(parameter: Record<string, any>): Record<string, unknown> {
  return {
    type: parameter.type === 'file' ? 'string' : parameter.type,
    ...(parameter.type === 'file' ? { format: 'binary' } : {}),
    ...Object.fromEntries(Object.entries(parameter).filter(([key]) => SWAGGER_SCHEMA_KEYS.has(key))),
  };
}

/** Reusable non-schema component kinds emitted as standalone modules in components mode (D-18). */
export type ReusableComponentKind = 'parameter' | 'response';

/** Namespace table for reusable parameter/response references per source dialect (D-18). */
const REUSABLE_REF_ROOTS = {
  parameter: { openapi: '#/components/parameters/', swagger: '#/parameters/' },
  response: { openapi: '#/components/responses/', swagger: '#/responses/' },
} as const;

/**
 * Detect a bare reusable parameter/response reference (`{ "$ref": <namespace>/<name> }` with no sibling keys).
 *
 * Sibling-merged references resolve inline and therefore never receive a component import (D-18).
 *
 * @param raw Raw source node (parameter or response object, before local-reference resolution).
 * @param kind Reusable namespace to match.
 * @param swagger Whether the source dialect is Swagger 2.0.
 * @returns The decoded component name when `raw` is a bare namespace reference, otherwise `undefined`.
 */
export function bareReusableReferenceName(raw: unknown, kind: ReusableComponentKind, swagger: boolean): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== '$ref' || typeof entries[0][1] !== 'string') return undefined;
  const prefix = REUSABLE_REF_ROOTS[kind][swagger ? 'swagger' : 'openapi'];
  if (!entries[0][1].startsWith(prefix)) return undefined;
  const suffix = entries[0][1].slice(prefix.length);
  return suffix.includes('/') || suffix === '' ? undefined : decodeJsonPointerSegment(suffix, entries[0][1]);
}

/**
 * Read the reusable parameter/response declaration maps of a normalized document.
 *
 * @param document Validated Swagger/OpenAPI document.
 * @returns Declaration maps keyed by component name (empty when the dialect container is absent).
 */
export function reusableDeclarations(document: OpenApiDocument): Record<ReusableComponentKind, Record<string, unknown>> {
  const swagger = document.swagger === '2.0';
  return {
    parameter: (swagger ? document.parameters : document.components?.parameters) ?? {},
    response: (swagger ? document.responses : document.components?.responses) ?? {},
  };
}

function resolveReusableDeclaration(document: OpenApiDocument, value: unknown, kind: ReusableComponentKind, name: string): Record<string, unknown> {
  let current = value;
  const seen = new Set<string>();
  while (current && typeof current === 'object' && !Array.isArray(current) && typeof (current as Record<string, unknown>).$ref === 'string') {
    const ref = (current as Record<string, unknown>).$ref as string;
    if (seen.has(ref)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Circular reusable ${kind} $ref: ${ref}`, { at: `#/components/${kind}s/${name}`, hint: 'break the reusable reference cycle' });
    seen.add(ref);
    const resolved = resolveOpenApiLocalRef(document, ref);
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid reusable ${kind}: ${name}`, { at: `#/components/${kind}s/${name}` });
    current = { ...(resolved as Record<string, unknown>), ...Object.fromEntries(Object.entries(current as Record<string, unknown>).filter(([key]) => key !== '$ref')) };
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid reusable ${kind}: ${name}`, { at: `#/components/${kind}s/${name}` });
  return current as Record<string, unknown>;
}

/**
 * Derive the JSON Schema rendered into a reusable parameter component module (D-18).
 *
 * @param document Validated Swagger/OpenAPI document (for reference chains).
 * @param name Reusable parameter component name (used in diagnostics).
 * @param declaration Raw declaration object; reference chains are resolved with sibling overrides.
 * @returns The parameter's effective schema.
 * @throws {@link ZopiaError} when the declaration has no derivable schema (`ZOPIA_SPEC_INVALID`).
 */
export function deriveReusableParameterSchema(document: OpenApiDocument, name: string, declaration: unknown): unknown {
  const parameter = resolveReusableDeclaration(document, declaration, 'parameter', name);
  const swagger = document.swagger === '2.0';
  if (swagger) {
    if (typeof parameter.name !== 'string' || !parameter.name || typeof parameter.in !== 'string' || !parameter.in) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid reusable parameter: ${name}`, { at: `#/parameters/${name}`, hint: 'declare name and in on the reusable parameter' });
    if (parameter.in === 'body') {
      if (parameter.schema === undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger body parameter: ${name}`, { at: `#/parameters/${name}` });
      return parameter.schema;
    }
    if (!SWAGGER_PARAMETER_TYPES.has(parameter.type as string) && parameter.type !== 'file') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger parameter type: ${name}`, { at: `#/parameters/${name}` });
    return swaggerParameterSchema(parameter);
  }
  if (typeof parameter.name !== 'string' || !parameter.name || !['path', 'query', 'header', 'cookie'].includes(String(parameter.in))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid reusable parameter: ${name}`, { at: `#/components/parameters/${name}`, hint: 'declare name and a supported in on the reusable parameter' });
  if (parameter.schema !== undefined && parameter.content !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter cannot define both schema and content: ${name}`, { at: `#/components/parameters/${name}` });
  if (parameter.schema !== undefined) return parameter.schema;
  if (parameter.content !== undefined) {
    const media = firstContent(parameter.content);
    if (media.schema === undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter requires schema or content: ${name}`, { at: `#/components/parameters/${name}` });
    return media.schema;
  }
  throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter requires schema or content: ${name}`, { at: `#/components/parameters/${name}`, hint: 'add a schema or content field' });
}

/**
 * Derive the JSON Schema rendered into a reusable response component module (D-18).
 *
 * @param document Validated Swagger/OpenAPI document (for reference chains).
 * @param name Reusable response component name (used in diagnostics).
 * @param declaration Raw declaration object; reference chains are resolved with sibling overrides.
 * @returns The primary response schema, or `undefined` for schema-less responses (which render `z.void()`).
 * @throws {@link ZopiaError} when the declaration is not an object (`ZOPIA_SPEC_INVALID`).
 */
export function deriveReusableResponseSchema(document: OpenApiDocument, name: string, declaration: unknown): unknown {
  const response = resolveReusableDeclaration(document, declaration, 'response', name);
  const swagger = document.swagger === '2.0';
  if (swagger) return response.schema;
  if (response.content !== undefined) return firstContent(response.content).schema;
  return undefined;
}

function resolveRef(value: Record<string, any>, ir: OpenApiOperationIR, context: string): Record<string, any> {
  let current: any = value; const seen = new Set<string>();
  while ('$ref' in current) {
    if (typeof current.$ref !== 'string' || !current.$ref) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Invalid ${context} $ref`);
    if (seen.has(current.$ref)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Circular ${context} $ref: ${current.$ref}`);
    seen.add(current.$ref);
    const resolved = resolveOpenApiLocalRef(ir.document, current.$ref);
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Invalid resolved ${context} $ref: ${current.$ref}`);
    const siblings = Object.fromEntries(Object.entries(current).filter(([key]) => key !== '$ref'));
    current = Object.keys(siblings).length ? { ...(resolved as Record<string, any>), ...siblings } : resolved;
  }
  return current as Record<string, any>;
}

/**
 * Extract request and response content without losing media-type metadata.
 *
 * @param ir Validated operation-level intermediate representation.
 * @returns Resolved parameter, request-body, and response contracts.
 * @throws {@link ZopiaError} when references or contract shapes are invalid.
 */
export function extractOperationContracts(ir: OpenApiOperationIR): OperationContracts {
  const operation = ir.operation;
  const swagger = ir.document.swagger === '2.0';
  if (swagger) for (const field of ['consumes', 'produces'] as const) {
    assertSwaggerMediaTypes(ir.document[field], field, '#');
    assertSwaggerMediaTypes(operation[field], field, `${ir.method} ${ir.path}`);
  }
  const resolvedParameters = ir.parameters.map((raw) => resolveRef(raw, ir, 'parameter'));
  const rawReusableParameters = ir.parameters.map((raw) => bareReusableReferenceName(raw, 'parameter', swagger));
  if (!swagger) {
    const legacyParameter = resolvedParameters.find((parameter) => parameter.in === 'body' || parameter.in === 'formData');
    if (legacyParameter) throw new ZopiaError('ZOPIA_SPEC_INVALID', `OpenAPI 3 does not support ${legacyParameter.in} parameters: ${ir.method} ${ir.path}`);
    const swaggerShaped = resolvedParameters.find((parameter) => ['type', ...SWAGGER_SCHEMA_KEYS].some((key) => Object.prototype.hasOwnProperty.call(parameter, key)));
    if (swaggerShaped) throw new ZopiaError('ZOPIA_SPEC_INVALID', `OpenAPI 3 parameter must place schema keywords under schema: ${String(swaggerShaped.name)}`);
  } else {
    if (operation.requestBody !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger 2.0 does not support requestBody: ${ir.method} ${ir.path}`);
    const schemaShaped = resolvedParameters.find((parameter) => parameter.in !== 'body' && (parameter.schema !== undefined || parameter.content !== undefined));
    if (schemaShaped) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger non-body parameter must use top-level type keywords: ${String(schemaShaped.name)}`);
  }
  const parameters = resolvedParameters.flatMap((parameter, parameterIndex) => {
    if (parameter.in === 'body' || parameter.in === 'formData') return [];
    if (!['path', 'query', 'header', 'cookie'].includes(parameter.in) || ir.document.swagger === '2.0' && parameter.in === 'cookie' || typeof parameter.name !== 'string' || !parameter.name) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid parameter: ${ir.method} ${ir.path}`);
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid parameter.required: ${parameter.name}`);
    if (parameter.in === 'path' && parameter.required !== true) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Path parameter must be required: ${parameter.name}`);
    if (parameter.content !== undefined && parameter.schema !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter cannot define both schema and content: ${parameter.name}`);
    if (parameter.content !== undefined && (!parameter.content || typeof parameter.content !== 'object' || Array.isArray(parameter.content) || Object.keys(parameter.content).length !== 1)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter content must contain exactly one media type: ${parameter.name}`);
    const parameterContent = parameter.schema === undefined && parameter.content !== undefined ? firstContent(parameter.content) : undefined;
    if (ir.document.swagger === '2.0' && parameter.type !== undefined && (!SWAGGER_PARAMETER_TYPES.has(parameter.type) || (parameter.type === 'array' && !isValidSwaggerItems(parameter.items)))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger parameter type: ${parameter.name}`);
    const swaggerSchema = ir.document.swagger === '2.0' && parameter.type ? swaggerParameterSchema(parameter) : undefined;
    const schema = parameter.schema ?? parameterContent?.schema ?? swaggerSchema;
    if (schema === undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter requires schema or content: ${parameter.name}`);
    const reusable = rawReusableParameters[parameterIndex];
    return [{ name: parameter.name, in: parameter.in, required: parameter.required === true || parameter.in === 'path', schema, ...(reusable === undefined ? {} : { reusable }) }];
  });
  const placeholders = pathParameterNames(ir.path);
  const pathParameters = new Set(parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name));
  const missingPathParameter = [...placeholders].find((name) => !pathParameters.has(name));
  if (missingPathParameter) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Path template parameter is not defined: ${missingPathParameter}`);
  const unrelatedPathParameter = [...pathParameters].find((name) => !placeholders.has(name));
  if (unrelatedPathParameter) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Path parameter is not present in the template: ${unrelatedPathParameter}`);
  let body = operation.requestBody;
  let bodyReusable: string | undefined;
  let formDataReusable: Record<string, string> | undefined;
  if (body === undefined && ir.document.swagger === '2.0') {
    const bodyEntries = [...resolvedParameters.entries()].filter(([, parameter]) => parameter.in === 'body');
    const bodyParameter = bodyEntries[0]?.[1];
    const formEntries = [...resolvedParameters.entries()].filter(([, parameter]) => parameter.in === 'formData');
    const formParameters = formEntries.map(([, parameter]) => parameter);
    if (bodyEntries.length > 1) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger operation cannot define multiple body parameters: ${ir.method} ${ir.path}`);
    if (bodyParameter && formParameters.length) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger operation cannot combine body and formData parameters: ${ir.method} ${ir.path}`);
    if (bodyParameter) {
      if (typeof bodyParameter !== 'object' || typeof bodyParameter.name !== 'string' || !bodyParameter.name || !bodyParameter.schema) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger body parameter: ${ir.method} ${ir.path}`);
      if (bodyParameter.required !== undefined && typeof bodyParameter.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger body parameter required: ${ir.method} ${ir.path}`);
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(ir.document.consumes) ? ir.document.consumes : [];
      body = { content: { [primarySwaggerMediaType(consumes) ?? 'application/json']: { schema: bodyParameter.schema } }, required: bodyParameter.required === true };
      bodyReusable = rawReusableParameters[bodyEntries[0][0]];
    } else if (formParameters.length) {
      const properties: Record<string, any> = {}; const required: string[] = [];
      for (const parameter of formParameters) { const validTypes = new Set([...SWAGGER_PARAMETER_TYPES, 'file']); if (typeof parameter.name !== 'string' || !parameter.name || !validTypes.has(parameter.type) || (parameter.type === 'array' && !isValidSwaggerItems(parameter.items))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger formData parameter: ${ir.method} ${ir.path}`); if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger formData required: ${parameter.name}`); properties[parameter.name] = swaggerParameterSchema(parameter); if (parameter.required === true) required.push(parameter.name); }
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(ir.document.consumes) ? ir.document.consumes : [];
      const contentType = consumes.find((value: unknown) => value === 'multipart/form-data' || value === 'application/x-www-form-urlencoded') ?? (formParameters.some((parameter: any) => parameter.type === 'file') ? 'multipart/form-data' : 'application/x-www-form-urlencoded');
      body = { content: { [contentType]: { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } }, required: required.length > 0 };
      const reusables = Object.fromEntries(formEntries.flatMap(([index, parameter]) => {
        const reusable = rawReusableParameters[index];
        return reusable === undefined ? [] : [[String(parameter.name), reusable]];
      }));
      if (Object.keys(reusables).length) formDataReusable = reusables;
    }
  }
  const requestBody = body === undefined ? undefined : (() => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody: ${ir.method} ${ir.path}`);
    const bodyObject = resolveRef(body, ir, 'requestBody');
    if (bodyObject.required !== undefined && typeof bodyObject.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody.required: ${ir.method} ${ir.path}`);
    if (bodyObject.content === undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody.content: ${ir.method} ${ir.path}`);
    const media = firstContent(bodyObject.content);
    if (!media.contentType) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody.content: ${ir.method} ${ir.path}`);
    return { ...media, contentType: media.contentType, required: bodyObject.required === true, ...(bodyReusable === undefined ? {} : { reusable: bodyReusable }), ...(formDataReusable === undefined ? {} : { formDataReusable }) };
  })();
  const responses = operation.responses;
  if (!responses || typeof responses !== 'object' || Array.isArray(responses) || Object.keys(responses).length === 0) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid responses: ${ir.method} ${ir.path}`);
  return { parameters, requestBody, responses: Object.entries(responses).map(([status, value]) => {
    if (!isValidResponseStatus(status, ir.document.swagger === '2.0')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid response status: ${status}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid response ${status}: ${ir.method} ${ir.path}`);
    const response = resolveRef(value as Record<string, any>, ir, 'response');
    if (typeof response.description !== 'string' || response.description.trim() === '') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid response description: ${status}`);
    if (swagger && (response.content !== undefined || response.produces !== undefined)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger response must use schema and operation-level produces: ${status}`);
    if (!swagger && response.schema !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `OpenAPI 3 response must place schemas under content: ${status}`);
    const media = firstContent(response.content);
    const schema = media.schema === undefined && response.schema !== undefined ? { schema: response.schema } : {};
    const swaggerProduces = swagger ? (Array.isArray(operation.produces) ? operation.produces : Array.isArray(ir.document.produces) ? ir.document.produces : []) : [];
    const contentType = media.contentType ?? primarySwaggerMediaType(swaggerProduces);
    const reusable = bareReusableReferenceName(value, 'response', swagger);
    return { status, description: response.description, ...media, ...schema, ...(contentType ? { contentType } : {}), ...(reusable === undefined ? {} : { reusable }) };
  }) };
}
