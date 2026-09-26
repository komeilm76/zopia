import { ZopiaError } from '../errors';
import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';
import { resolveOpenApiLocalRef } from './openapi-ref';

export const OPENAPI_METHODS = ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'] as const;
export type OpenApiMethod = (typeof OPENAPI_METHODS)[number];
export interface OpenApiOperation { path: string; method: OpenApiMethod; operation: Record<string, any>; operationId: string; parameters: any[]; }

function pascalPath(path: string): string {
  return path.split('/').filter(Boolean).map((segment) => segment.replace(/[{}]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')).join('') || 'Root';
}
export function deriveOperationId(path: string, method: OpenApiMethod): string {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid API path: ${String(path)}`, { at: 'path' });
  if (!OPENAPI_METHODS.includes(method)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsupported HTTP method: ${String(method)}`, { at: 'method' });
  return `${method}${pascalPath(path)}`;
}

function parameterIdentity(parameter: Record<string, any>, document: OpenApiDocument): string {
  let current = parameter; const seen = new Set<string>();
  while ('$ref' in current) {
    if (typeof current.$ref !== 'string' || !current.$ref) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', 'Invalid parameter $ref');
    if (seen.has(current.$ref)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Circular parameter $ref: ${current.$ref}`);
    seen.add(current.$ref);
    const target = resolveOpenApiLocalRef(document, current.$ref);
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Invalid parameter $ref target: ${current.$ref}`);
    current = { ...(target as Record<string, any>), ...Object.fromEntries(Object.entries(current).filter(([key]) => key !== '$ref')) };
  }
  return `${String(current.in)}:${String(current.name)}`;
}

/** Collect path operations in the canonical km-api method order. */
export function collectOpenApiOperations(input: OpenApiDocument | string): OpenApiOperation[] {
  const { document } = normalizeOpenApiDocument(input); const operations: OpenApiOperation[] = []; const ids = new Set<string>();
  for (const path of Object.keys(document.paths)) {
    if (path.startsWith('x-')) continue;
    const item = document.paths[path];
    let resolvedItem: any = item;
    const seenPathRefs = new Set<string>();
    while ('$ref' in resolvedItem) {
      if (typeof resolvedItem.$ref !== 'string' || !resolvedItem.$ref) throw new ZopiaError('ZOPIA_SPEC_PATH_REF', `Invalid path-item $ref: ${path}`);
      if (seenPathRefs.has(resolvedItem.$ref)) throw new ZopiaError('ZOPIA_SPEC_PATH_REF', `Circular path-item $ref: ${resolvedItem.$ref}`);
      seenPathRefs.add(resolvedItem.$ref);
      const target = resolveOpenApiLocalRef(document, resolvedItem.$ref);
      if (!target || typeof target !== 'object' || Array.isArray(target)) throw new ZopiaError('ZOPIA_SPEC_PATH_REF', `Invalid path-item $ref: ${resolvedItem.$ref}`);
      resolvedItem = { ...target, ...Object.fromEntries(Object.entries(resolvedItem).filter(([key]) => key !== '$ref')) };
    }
    for (const method of OPENAPI_METHODS) {
      const operation = resolvedItem[method];
      if (operation === undefined) continue;
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI operation: ${method.toUpperCase()} ${path}`);
      if (operation.operationId !== undefined && (typeof operation.operationId !== 'string' || !operation.operationId.trim())) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid operationId: ${method.toUpperCase()} ${path}`);
      const pathParameters = resolvedItem.parameters === undefined ? [] : resolvedItem.parameters;
      if (!Array.isArray(pathParameters) || !pathParameters.every((parameter: any) => parameter && typeof parameter === 'object' && !Array.isArray(parameter))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid path parameters: ${path}`);
      const operationParameters = operation.parameters === undefined ? [] : operation.parameters;
      if (!Array.isArray(operationParameters) || !operationParameters.every((parameter: any) => parameter && typeof parameter === 'object' && !Array.isArray(parameter))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid operation parameters: ${method.toUpperCase()} ${path}`);
      const identities = (parameters: any[], label: string): string[] => {
        const keys = parameters.map((parameter) => parameterIdentity(parameter, document));
        const seen = new Set<string>();
        for (const key of keys) {
          if (seen.has(key)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Duplicate ${label} parameter: ${key}`);
          seen.add(key);
        }
        return keys;
      };
      const pathIdentities = identities(pathParameters, 'path-level');
      const operationIdentities = identities(operationParameters, 'operation-level');
      const mergedParameters = [...pathParameters]; const mergedIdentities = [...pathIdentities];
      for (let parameterIndex = 0; parameterIndex < operationParameters.length; parameterIndex += 1) {
        const parameter = operationParameters[parameterIndex]; const identity = operationIdentities[parameterIndex];
        const index = mergedIdentities.indexOf(identity);
        if (index >= 0) mergedParameters[index] = parameter;
        else { mergedParameters.push(parameter); mergedIdentities.push(identity); }
      }
      const operationId = operation.operationId ?? deriveOperationId(path, method);
      if (ids.has(operationId)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Duplicate operationId: ${operationId}`);
      ids.add(operationId);
      operations.push({ path, method, operation, operationId, parameters: mergedParameters });
    }
  }
  return operations;
}
