import { ZopiaError } from '../errors';
import type { OpenApiOperationIR } from './openapi-ir';
import { resolveOpenApiLocalRef } from './openapi-ref';

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

const SWAGGER_SCHEMA_KEYS = new Set(['format', 'items', 'default', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'enum', 'multipleOf']);

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

function swaggerParameterSchema(parameter: Record<string, any>): Record<string, unknown> {
  return {
    type: parameter.type === 'file' ? 'string' : parameter.type,
    ...(parameter.type === 'file' ? { format: 'binary' } : {}),
    ...Object.fromEntries(Object.entries(parameter).filter(([key]) => SWAGGER_SCHEMA_KEYS.has(key))),
  };
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
  const resolvedParameters = ir.parameters.map((raw) => resolveRef(raw, ir, 'parameter'));
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
  const parameters = resolvedParameters.filter((parameter) => parameter.in !== 'body' && parameter.in !== 'formData').map((parameter) => {
    if (!['path', 'query', 'header', 'cookie'].includes(parameter.in) || ir.document.swagger === '2.0' && parameter.in === 'cookie' || typeof parameter.name !== 'string' || !parameter.name) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid parameter: ${ir.method} ${ir.path}`);
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid parameter.required: ${parameter.name}`);
    if (parameter.in === 'path' && parameter.required !== true) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Path parameter must be required: ${parameter.name}`);
    if (parameter.content !== undefined && parameter.schema !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter cannot define both schema and content: ${parameter.name}`);
    if (parameter.content !== undefined && (!parameter.content || typeof parameter.content !== 'object' || Array.isArray(parameter.content) || Object.keys(parameter.content).length !== 1)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter content must contain exactly one media type: ${parameter.name}`);
    const parameterContent = parameter.schema === undefined && parameter.content !== undefined ? firstContent(parameter.content) : undefined;
    const swaggerTypes = new Set(['string', 'number', 'integer', 'boolean', 'array']);
    if (ir.document.swagger === '2.0' && parameter.type !== undefined && (!swaggerTypes.has(parameter.type) || (parameter.type === 'array' && !parameter.items))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger parameter type: ${parameter.name}`);
    const swaggerSchema = ir.document.swagger === '2.0' && parameter.type ? swaggerParameterSchema(parameter) : undefined;
    const schema = parameter.schema ?? parameterContent?.schema ?? swaggerSchema;
    if (schema === undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Parameter requires schema or content: ${parameter.name}`);
    return { name: parameter.name, in: parameter.in, required: parameter.required === true || parameter.in === 'path', schema };
  });
  const placeholders = pathParameterNames(ir.path);
  const pathParameters = new Set(parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name));
  const missingPathParameter = [...placeholders].find((name) => !pathParameters.has(name));
  if (missingPathParameter) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Path template parameter is not defined: ${missingPathParameter}`);
  const unrelatedPathParameter = [...pathParameters].find((name) => !placeholders.has(name));
  if (unrelatedPathParameter) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Path parameter is not present in the template: ${unrelatedPathParameter}`);
  let body = operation.requestBody;
  if (body === undefined && ir.document.swagger === '2.0') {
    const bodyParameters = resolvedParameters.filter((parameter) => parameter.in === 'body');
    const bodyParameter = bodyParameters[0];
    const formParameters = resolvedParameters.filter((parameter) => parameter.in === 'formData');
    if (bodyParameters.length > 1) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger operation cannot define multiple body parameters: ${ir.method} ${ir.path}`);
    if (bodyParameter && formParameters.length) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Swagger operation cannot combine body and formData parameters: ${ir.method} ${ir.path}`);
    if (bodyParameter) {
      if (typeof bodyParameter !== 'object' || typeof bodyParameter.name !== 'string' || !bodyParameter.name || !bodyParameter.schema) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger body parameter: ${ir.method} ${ir.path}`);
      if (bodyParameter.required !== undefined && typeof bodyParameter.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger body parameter required: ${ir.method} ${ir.path}`);
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(ir.document.consumes) ? ir.document.consumes : [];
      body = { content: { [primarySwaggerMediaType(consumes) ?? 'application/json']: { schema: bodyParameter.schema } }, required: bodyParameter.required === true };
    } else if (formParameters.length) {
      const properties: Record<string, any> = {}; const required: string[] = [];
      for (const parameter of formParameters) { const validTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'file']); if (typeof parameter.name !== 'string' || !parameter.name || !validTypes.has(parameter.type) || (parameter.type === 'array' && !parameter.items)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger formData parameter: ${ir.method} ${ir.path}`); if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid Swagger formData required: ${parameter.name}`); properties[parameter.name] = swaggerParameterSchema(parameter); if (parameter.required === true) required.push(parameter.name); }
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(ir.document.consumes) ? ir.document.consumes : [];
      const contentType = consumes.find((value: unknown) => value === 'multipart/form-data' || value === 'application/x-www-form-urlencoded') ?? (formParameters.some((parameter: any) => parameter.type === 'file') ? 'multipart/form-data' : 'application/x-www-form-urlencoded');
      body = { content: { [contentType]: { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } }, required: required.length > 0 };
    }
  }
  const requestBody = body === undefined ? undefined : (() => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody: ${ir.method} ${ir.path}`);
    const bodyObject = resolveRef(body, ir, 'requestBody');
    if (bodyObject.required !== undefined && typeof bodyObject.required !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody.required: ${ir.method} ${ir.path}`);
    if (bodyObject.content === undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody.content: ${ir.method} ${ir.path}`);
    const media = firstContent(bodyObject.content);
    if (!media.contentType) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid requestBody.content: ${ir.method} ${ir.path}`);
    return { ...media, contentType: media.contentType, required: bodyObject.required === true };
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
    return { status, description: response.description, ...media, ...schema, ...(contentType ? { contentType } : {}) };
  }) };
}
