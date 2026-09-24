import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';

export const OPENAPI_METHODS = ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'] as const;
export type OpenApiMethod = (typeof OPENAPI_METHODS)[number];
export interface OpenApiOperation { path: string; method: OpenApiMethod; operation: Record<string, any>; operationId: string; }

function pascalPath(path: string): string {
  return path.split('/').filter(Boolean).map((segment) => segment.replace(/[{}]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')).join('') || 'Root';
}
export function deriveOperationId(path: string, method: OpenApiMethod): string { return `${method}${pascalPath(path)}`; }

/** Collect path operations in the canonical km-api method order. */
export function collectOpenApiOperations(input: OpenApiDocument | string): OpenApiOperation[] {
  const { document } = normalizeOpenApiDocument(input); const operations: OpenApiOperation[] = [];
  for (const path of Object.keys(document.paths)) {
    if (path.startsWith('x-')) continue;
    const item = document.paths[path];
    for (const method of OPENAPI_METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new TypeError(`Invalid OpenAPI operation: ${method.toUpperCase()} ${path}`);
      operations.push({ path, method, operation, operationId: typeof operation.operationId === 'string' && operation.operationId.trim() ? operation.operationId : deriveOperationId(path, method) });
    }
  }
  return operations;
}
