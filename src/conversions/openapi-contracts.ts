import type { OpenApiOperationIR } from './openapi-ir';
import { resolveOpenApiLocalRef } from './openapi-ref';

export interface OperationContracts {
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
  const operation = ir.operation;
  const body = operation.requestBody;
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
  return { requestBody, responses: Object.entries(responses).map(([status, value]) => {
    if (status !== 'default' && !/^[1-5](?:\d{2}|XX)$/.test(status)) throw new TypeError(`Invalid response status: ${status}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid response ${status}: ${ir.method} ${ir.path}`);
    const response = resolveRef(value as Record<string, any>, ir, 'response');
    if (typeof response.description !== 'string' || response.description.trim() === '') throw new TypeError(`Invalid response description: ${status}`);
    const media = firstContent(response.content);
    return { status, description: response.description, ...media };
  }) };
}
