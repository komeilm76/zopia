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
  const { document } = normalizeOpenApiDocument(input); const operations: OpenApiOperation[] = []; const ids = new Set<string>();
  for (const path of Object.keys(document.paths)) {
    if (path.startsWith('x-')) continue;
    const item = document.paths[path];
    if (item.$ref && typeof item.$ref === 'string') throw new TypeError(`Unsupported path-item $ref: ${item.$ref}`);
    for (const method of OPENAPI_METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new TypeError(`Invalid OpenAPI operation: ${method.toUpperCase()} ${path}`);
      if (operation.operationId !== undefined && (typeof operation.operationId !== 'string' || !operation.operationId.trim())) throw new TypeError(`Invalid operationId: ${method.toUpperCase()} ${path}`);
      const operationId = operation.operationId ?? deriveOperationId(path, method);
      if (ids.has(operationId)) throw new TypeError(`Duplicate operationId: ${operationId}`);
      ids.add(operationId);
      operations.push({ path, method, operation, operationId });
    }
  }
  return operations;
}
