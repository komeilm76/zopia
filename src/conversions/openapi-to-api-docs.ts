import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';

export const OPENAPI_METHODS = ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'] as const;
export type OpenApiMethod = (typeof OPENAPI_METHODS)[number];
export interface OpenApiOperation { path: string; method: OpenApiMethod; operation: Record<string, any>; operationId: string; parameters: any[]; }

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
    if ('$ref' in item) {
      if (typeof item.$ref !== 'string' || !item.$ref) throw new TypeError(`Invalid path-item $ref: ${path}`);
      throw new TypeError(`Unsupported path-item $ref: ${item.$ref}`);
    }
    for (const method of OPENAPI_METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new TypeError(`Invalid OpenAPI operation: ${method.toUpperCase()} ${path}`);
      if (operation.operationId !== undefined && (typeof operation.operationId !== 'string' || !operation.operationId.trim())) throw new TypeError(`Invalid operationId: ${method.toUpperCase()} ${path}`);
      const pathParameters = item.parameters === undefined ? [] : item.parameters;
      if (!Array.isArray(pathParameters) || !pathParameters.every((parameter: any) => parameter && typeof parameter === 'object' && !Array.isArray(parameter))) throw new TypeError(`Invalid path parameters: ${path}`);
      const operationParameters = operation.parameters === undefined ? [] : operation.parameters;
      if (!Array.isArray(operationParameters) || !operationParameters.every((parameter: any) => parameter && typeof parameter === 'object' && !Array.isArray(parameter))) throw new TypeError(`Invalid operation parameters: ${method.toUpperCase()} ${path}`);
      const mergedParameters = [...pathParameters];
      for (const parameter of operationParameters) {
        const index = mergedParameters.findIndex((candidate: any) => candidate.name === parameter.name && candidate.in === parameter.in);
        if (index >= 0) mergedParameters[index] = parameter;
        else mergedParameters.push(parameter);
      }
      const operationId = operation.operationId ?? deriveOperationId(path, method);
      if (ids.has(operationId)) throw new TypeError(`Duplicate operationId: ${operationId}`);
      ids.add(operationId);
      operations.push({ path, method, operation, operationId, parameters: mergedParameters });
    }
  }
  return operations;
}
