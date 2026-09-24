import { collectOpenApiOperations, type OpenApiOperation } from './openapi-to-api-docs';
import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';

export interface OpenApiOperationIR {
  path: string;
  method: Uppercase<OpenApiOperation['method']>;
  pathShape: string;
  operationId: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  security?: unknown[];
  operation: Record<string, any>;
}

function security(value: unknown, context: string): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) throw new TypeError(`Invalid security requirements: ${context}`);
  return value;
}

function tags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) throw new TypeError('Invalid operation tags: expected an array of strings');
  return value.map((tag) => tag.startsWith('#') ? tag : `#${tag}`);
}

/** Build the validated operation-level IR used by endpoint rendering. */
export function buildOpenApiOperationIR(input: OpenApiDocument | string): OpenApiOperationIR[] {
  const { document } = normalizeOpenApiDocument(input);
  return collectOpenApiOperations(document).map((entry) => {
    const operation = entry.operation;
    if (operation.summary !== undefined && typeof operation.summary !== 'string') throw new TypeError(`Invalid summary: ${entry.method.toUpperCase()} ${entry.path}`);
    if (operation.description !== undefined && typeof operation.description !== 'string') throw new TypeError(`Invalid description: ${entry.method.toUpperCase()} ${entry.path}`);
    return {
      path: entry.path,
      method: entry.method.toUpperCase() as Uppercase<OpenApiOperation['method']>,
      pathShape: entry.path,
      operationId: entry.operationId,
      summary: operation.summary,
      description: operation.description,
      tags: tags(operation.tags),
      deprecated: operation.deprecated === true,
      security: Object.prototype.hasOwnProperty.call(operation, 'security') ? security(operation.security, `${entry.method.toUpperCase()} ${entry.path}`) : security(document.security, 'document'),
      operation,
    };
  });
}
