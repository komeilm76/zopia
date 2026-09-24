import type { OpenApiOperationIR } from './openapi-ir';

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

/** Extract request and response content without losing media-type metadata. */
export function extractOperationContracts(ir: OpenApiOperationIR): OperationContracts {
  const operation = ir.operation;
  const body = operation.requestBody;
  const requestBody = body === undefined ? undefined : (() => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError(`Invalid requestBody: ${ir.method} ${ir.path}`);
    if ('$ref' in body) throw new TypeError(`Unsupported requestBody $ref: ${body.$ref}`);
    if (body.required !== undefined && typeof body.required !== 'boolean') throw new TypeError(`Invalid requestBody.required: ${ir.method} ${ir.path}`);
    const media = firstContent(body.content);
    return { ...media, contentType: media.contentType ?? 'application/json', required: body.required === true };
  })();
  const responses = operation.responses;
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) throw new TypeError(`Invalid responses: ${ir.method} ${ir.path}`);
  return { requestBody, responses: Object.entries(responses).map(([status, value]) => {
    if (status !== 'default' && !/^[1-5](?:\d{2}|XX)$/.test(status)) throw new TypeError(`Invalid response status: ${status}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid response ${status}: ${ir.method} ${ir.path}`);
    const response = value as Record<string, any>;
    if ('$ref' in response) throw new TypeError(`Unsupported response $ref: ${response.$ref}`);
    if (response.description !== undefined && typeof response.description !== 'string') throw new TypeError(`Invalid response description: ${status}`);
    const media = firstContent(response.content);
    return { status, description: response.description ?? '', ...media };
  }) };
}
