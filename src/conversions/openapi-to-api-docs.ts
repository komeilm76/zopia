import { ZopiaError } from '../errors';
import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';
import { resolveOpenApiLocalRef } from './openapi-ref';

/** Canonical km-api/OpenAPI operation method order. */
export const OPENAPI_METHODS = ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'] as const;

/** Supported lowercase OpenAPI operation method. */
export type OpenApiMethod = (typeof OPENAPI_METHODS)[number];

/** Collected source operation with merged parameters and a stable identifier. */
export interface OpenApiOperation {
  /** Original OpenAPI path template. */
  path: string;
  /** Lowercase HTTP method. */
  method: OpenApiMethod;
  /** Original operation object. */
  operation: Record<string, any>;
  /** Explicit or deterministically derived operation identifier. */
  operationId: string;
  /** Path-level and operation-level parameters after override merging. */
  parameters: any[];
}

function pascalPath(path: string): string {
  return path.split('/').filter(Boolean).map((segment) => segment.replace(/[{}]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')).join('') || 'Root';
}
/**
 * Derive a stable operation identifier from a path and method.
 *
 * @param path OpenAPI path template beginning with `/`.
 * @param method Supported lowercase HTTP method.
 * @returns Method-prefixed camel-case operation identifier.
 * @throws {@link ZopiaError} when the path or method is invalid.
 */
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

/**
 * Collect path operations in the canonical km-api method order.
 *
 * @param input Valid Swagger/OpenAPI object or JSON text.
 * @returns Operations with merged parameters and unique stable identifiers.
 * @throws {@link ZopiaError} when the source, references, or operations are invalid.
 */
export function collectOpenApiOperations(input: OpenApiDocument | string): OpenApiOperation[] {
  const { document } = normalizeOpenApiDocument(input); const operations: OpenApiOperation[] = []; const ids = new Set<string>(); const owners = new Map<string, OpenApiOperation>();
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
      let operationId: string;
      if (operation.operationId !== undefined) {
        operationId = operation.operationId;
        const previous = owners.get(operationId);
        if (previous) {
          if (previous.operation.operationId !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Duplicate operationId: ${operationId}`);
          let replacement = previous.operationId; let suffix = 1;
          while (ids.has(replacement)) replacement = `${operationId}${++suffix}`;
          ids.delete(previous.operationId); owners.delete(previous.operationId);
          previous.operationId = replacement; ids.add(replacement); owners.set(replacement, previous);
        }
      } else {
        const base = deriveOperationId(path, method);
        operationId = base; let suffix = 1;
        while (ids.has(operationId)) operationId = `${base}${++suffix}`;
      }
      const collected = { path, method, operation, operationId, parameters: mergedParameters };
      ids.add(operationId); owners.set(operationId, collected); operations.push(collected);
    }
  }
  return operations;
}

/**
 * Collect every `webhooks` operation (OpenAPI 3.1) using the same operation rules as path operations.
 *
 * Webhook names are arbitrary identifiers rather than URL path templates, so no path-parameter
 * template validation applies. `x-` names are preserved through the manifest overlays instead.
 *
 * @param document Normalized OpenAPI document.
 * @returns Deterministically ordered webhook operations keyed by their webhook name.
 * @throws {@link ZopiaError} when a webhook item, webhook-item `$ref` chain, or webhook operation is invalid.
 */
export function collectOpenApiWebhookOperations(document: OpenApiDocument): OpenApiOperation[] {
  const operations: OpenApiOperation[] = []; const ids = new Set<string>(); const owners = new Map<string, OpenApiOperation>();
  const webhooks = (document as { webhooks?: unknown }).webhooks;
  if (webhooks === undefined) return operations;
  if (!webhooks || typeof webhooks !== 'object' || Array.isArray(webhooks)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid OpenAPI webhooks', { at: '#/webhooks' });
  for (const name of Object.keys(webhooks as Record<string, unknown>)) {
    if (name.startsWith('x-')) continue;
    let resolvedItem: any = (webhooks as Record<string, any>)[name];
    if (!resolvedItem || typeof resolvedItem !== 'object' || Array.isArray(resolvedItem)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI webhook item: ${name}`);
    const seenRefs = new Set<string>();
    while ('$ref' in resolvedItem) {
      if (typeof resolvedItem.$ref !== 'string' || !resolvedItem.$ref) throw new ZopiaError('ZOPIA_SPEC_PATH_REF', `Invalid webhook-item $ref: ${name}`);
      if (seenRefs.has(resolvedItem.$ref)) throw new ZopiaError('ZOPIA_SPEC_PATH_REF', `Circular webhook-item $ref: ${resolvedItem.$ref}`);
      seenRefs.add(resolvedItem.$ref);
      const target = resolveOpenApiLocalRef(document, resolvedItem.$ref);
      if (!target || typeof target !== 'object' || Array.isArray(target)) throw new ZopiaError('ZOPIA_SPEC_PATH_REF', `Invalid webhook-item $ref: ${resolvedItem.$ref}`);
      resolvedItem = { ...target, ...Object.fromEntries(Object.entries(resolvedItem as Record<string, unknown>).filter(([key]) => key !== '$ref')) };
    }
    for (const method of OPENAPI_METHODS) {
      const operation = resolvedItem[method];
      if (operation === undefined) continue;
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI webhook operation: ${method.toUpperCase()} ${name}`);
      if (operation.operationId !== undefined && (typeof operation.operationId !== 'string' || !operation.operationId.trim())) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid operationId: ${method.toUpperCase()} ${name}`);
      const pathParameters = resolvedItem.parameters === undefined ? [] : resolvedItem.parameters;
      if (!Array.isArray(pathParameters) || !pathParameters.every((parameter: any) => parameter && typeof parameter === 'object' && !Array.isArray(parameter))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid webhook-item parameters: ${name}`);
      const operationParameters = operation.parameters === undefined ? [] : operation.parameters;
      if (!Array.isArray(operationParameters) || !operationParameters.every((parameter: any) => parameter && typeof parameter === 'object' && !Array.isArray(parameter))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid webhook operation parameters: ${method.toUpperCase()} ${name}`);
      const identities = (parameters: any[], label: string): string[] => {
        const keys = parameters.map((parameter) => parameterIdentity(parameter, document));
        const seen = new Set<string>();
        for (const key of keys) {
          if (seen.has(key)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Duplicate ${label} parameter: ${key}`);
          seen.add(key);
        }
        return keys;
      };
      const pathIdentities = identities(pathParameters, 'webhook-item');
      const operationIdentities = identities(operationParameters, 'operation-level');
      const mergedParameters = [...pathParameters]; const mergedIdentities = [...pathIdentities];
      for (let parameterIndex = 0; parameterIndex < operationParameters.length; parameterIndex += 1) {
        const parameter = operationParameters[parameterIndex]; const identity = operationIdentities[parameterIndex];
        const index = mergedIdentities.indexOf(identity);
        if (index >= 0) mergedParameters[index] = parameter;
        else { mergedParameters.push(parameter); mergedIdentities.push(identity); }
      }
      let operationId: string;
      if (operation.operationId !== undefined) {
        operationId = operation.operationId;
        const previous = owners.get(operationId);
        if (previous) {
          if (previous.operation.operationId !== undefined) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Duplicate operationId: ${operationId}`);
          let replacement = previous.operationId; let suffix = 1;
          while (ids.has(replacement)) replacement = `${operationId}${++suffix}`;
          ids.delete(previous.operationId); owners.delete(previous.operationId);
          previous.operationId = replacement; ids.add(replacement); owners.set(replacement, previous);
        }
      } else {
        const base = `${method}${pascalPath(name)}`;
        operationId = base; let suffix = 1;
        while (ids.has(operationId)) operationId = `${base}${++suffix}`;
      }
      const collected = { path: name, method, operation, operationId, parameters: mergedParameters };
      ids.add(operationId); owners.set(operationId, collected); operations.push(collected);
    }
  }
  return operations;
}
