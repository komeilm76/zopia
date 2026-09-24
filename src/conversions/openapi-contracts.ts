import type { OpenApiOperationIR } from './openapi-ir';
import { resolveOpenApiLocalRef } from './openapi-ref';

export interface OperationParameter { name: string; in: 'path' | 'query' | 'header' | 'cookie'; required: boolean; schema?: unknown; }
export interface OperationContracts {
  parameters: OperationParameter[];
  requestBody?: { contentType: string; schema?: unknown; required: boolean };
  responses: Array<{ status: string; description: string; contentType?: string; schema?: unknown }>;
}

function firstContent(content: unknown): { contentType?: string; schema?: unknown } {
  if (content === undefined) return {};
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new TypeError('Invalid content: expected an object');
  const entries = Object.entries(content as Record<string, any>);
  if (entries.length === 0) return {};
  const [contentType, media] = entries[0];
  if (!contentType || !media || typeof media !== 'object' || Array.isArray(media)) throw new TypeError(`Invalid media type content: ${contentType}`);
  return { contentType, schema: media.schema };
}

function resolveRef(value: Record<string, any>, ir: OpenApiOperationIR, context: string): Record<string, any> {
  let current: any = value; const seen = new Set<string>();
  while ('$ref' in current) {
    if (typeof current.$ref !== 'string' || !current.$ref) throw new TypeError(`Invalid ${context} $ref`);
    if (seen.has(current.$ref)) throw new TypeError(`Circular ${context} $ref: ${current.$ref}`);
    seen.add(current.$ref);
    const resolved = resolveOpenApiLocalRef(ir.document, current.$ref);
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) throw new TypeError(`Invalid resolved ${context} $ref: ${current.$ref}`);
    const siblings = Object.fromEntries(Object.entries(current).filter(([key]) => key !== '$ref'));
    current = Object.keys(siblings).length ? { ...(resolved as Record<string, any>), ...siblings } : resolved;
  }
  return current as Record<string, any>;
}

/** Extract request and response content without losing media-type metadata. */
export function extractOperationContracts(ir: OpenApiOperationIR): OperationContracts {
  const parameters = ir.parameters.filter((raw) => raw.in !== 'body' && raw.in !== 'formData').map((raw) => {
    const parameter = resolveRef(raw, ir, 'parameter');
    if (!['path', 'query', 'header', 'cookie'].includes(parameter.in) || typeof parameter.name !== 'string' || !parameter.name) throw new TypeError(`Invalid parameter: ${ir.method} ${ir.path}`);
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new TypeError(`Invalid parameter.required: ${parameter.name}`);
    if (parameter.in === 'path' && parameter.required !== true) throw new TypeError(`Path parameter must be required: ${parameter.name}`);
    if (parameter.content !== undefined && parameter.schema !== undefined) throw new TypeError(`Parameter cannot define both schema and content: ${parameter.name}`);
    if (parameter.content !== undefined && (!parameter.content || typeof parameter.content !== 'object' || Array.isArray(parameter.content) || Object.keys(parameter.content).length !== 1)) throw new TypeError(`Parameter content must contain exactly one media type: ${parameter.name}`);
    const parameterContent = parameter.schema === undefined && parameter.content !== undefined ? firstContent(parameter.content) : undefined;
    const swaggerTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'file']);
    if (ir.document.swagger === '2.0' && parameter.type !== undefined && (!swaggerTypes.has(parameter.type) || (parameter.type === 'array' && !parameter.items))) throw new TypeError(`Invalid Swagger parameter type: ${parameter.name}`);
    const swaggerSchema = ir.document.swagger === '2.0' && parameter.type ? { type: parameter.type === 'file' ? 'string' : parameter.type, ...(parameter.type === 'file' ? { format: 'binary' } : parameter.format === undefined ? {} : { format: parameter.format }), ...(parameter.items === undefined ? {} : { items: parameter.items }) } : undefined;
    const schema = parameter.schema ?? parameterContent?.schema ?? swaggerSchema;
    if (schema === undefined) throw new TypeError(`Parameter requires schema or content: ${parameter.name}`);
    return { name: parameter.name, in: parameter.in, required: parameter.required === true || parameter.in === 'path', schema };
  });
  const operation = ir.operation;
  let body = operation.requestBody;
  if (body === undefined && ir.document.swagger === '2.0') {
    const bodyParameter = ir.parameters.find((parameter: any) => parameter && parameter.in === 'body');
    const formParameters = ir.parameters.filter((parameter: any) => parameter && parameter.in === 'formData');
    if (bodyParameter && formParameters.length) throw new TypeError(`Swagger operation cannot combine body and formData parameters: ${ir.method} ${ir.path}`);
    if (bodyParameter) {
      if (typeof bodyParameter !== 'object' || !bodyParameter.schema) throw new TypeError(`Invalid Swagger body parameter: ${ir.method} ${ir.path}`);
      if (bodyParameter.required !== undefined && typeof bodyParameter.required !== 'boolean') throw new TypeError(`Invalid Swagger body parameter required: ${ir.method} ${ir.path}`);
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(ir.document.consumes) ? ir.document.consumes : [];
      body = { content: { [typeof consumes[0] === 'string' && consumes[0] ? consumes[0] : 'application/json']: { schema: bodyParameter.schema } }, required: bodyParameter.required === true };
    } else if (formParameters.length) {
      const properties: Record<string, any> = {}; const required: string[] = [];
      for (const parameter of formParameters) { const validTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'file']); if (typeof parameter.name !== 'string' || !parameter.name || !validTypes.has(parameter.type) || (parameter.type === 'array' && !parameter.items)) throw new TypeError(`Invalid Swagger formData parameter: ${ir.method} ${ir.path}`); if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new TypeError(`Invalid Swagger formData required: ${parameter.name}`); properties[parameter.name] = { type: parameter.type === 'file' ? 'string' : parameter.type, ...(parameter.type === 'file' ? { format: 'binary' } : parameter.format === undefined ? {} : { format: parameter.format }), ...(parameter.items === undefined ? {} : { items: parameter.items }) }; if (parameter.required === true) required.push(parameter.name); }
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(ir.document.consumes) ? ir.document.consumes : [];
      const contentType = consumes.find((value: unknown) => value === 'multipart/form-data' || value === 'application/x-www-form-urlencoded') ?? (formParameters.some((parameter: any) => parameter.type === 'file') ? 'multipart/form-data' : 'application/x-www-form-urlencoded');
      body = { content: { [contentType]: { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } }, required: required.length > 0 };
    }
  }
  const requestBody = body === undefined ? undefined : (() => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError(`Invalid requestBody: ${ir.method} ${ir.path}`);
    const bodyObject = resolveRef(body, ir, 'requestBody');
    if (bodyObject.required !== undefined && typeof bodyObject.required !== 'boolean') throw new TypeError(`Invalid requestBody.required: ${ir.method} ${ir.path}`);
    if (bodyObject.content === undefined) throw new TypeError(`Invalid requestBody.content: ${ir.method} ${ir.path}`);
    const media = firstContent(bodyObject.content);
    if (!media.contentType) throw new TypeError(`Invalid requestBody.content: ${ir.method} ${ir.path}`);
    return { ...media, contentType: media.contentType, required: bodyObject.required === true };
  })();
  const responses = operation.responses;
  if (!responses || typeof responses !== 'object' || Array.isArray(responses) || Object.keys(responses).length === 0) throw new TypeError(`Invalid responses: ${ir.method} ${ir.path}`);
  return { parameters, requestBody, responses: Object.entries(responses).map(([status, value]) => {
    if (status !== 'default' && !/^[1-5](?:\d{2}|XX)$/.test(status)) throw new TypeError(`Invalid response status: ${status}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid response ${status}: ${ir.method} ${ir.path}`);
    const response = resolveRef(value as Record<string, any>, ir, 'response');
    if (typeof response.description !== 'string' || response.description.trim() === '') throw new TypeError(`Invalid response description: ${status}`);
    const media = firstContent(response.content);
    const schema = media.schema === undefined && response.schema !== undefined ? { schema: response.schema } : {};
    const swaggerProduces = ir.document.swagger === '2.0' ? (Array.isArray(response.produces) ? response.produces : Array.isArray(operation.produces) ? operation.produces : Array.isArray(ir.document.produces) ? ir.document.produces : []) : [];
    const contentType = media.contentType ?? (typeof swaggerProduces[0] === 'string' ? swaggerProduces[0] : undefined);
    return { status, description: response.description, ...media, ...schema, ...(contentType ? { contentType } : {}) };
  }) };
}
