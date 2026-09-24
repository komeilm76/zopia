import type { OpenApiDocument } from './openapi';

/** Resolve a local JSON Pointer reference in an OpenAPI document. */
export function resolveOpenApiLocalRef(document: OpenApiDocument, ref: string): unknown {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('Invalid OpenAPI document: expected an object');
  if (typeof ref !== 'string' || (!ref.startsWith('#/') && ref !== '#')) throw new TypeError(`Only local OpenAPI references are supported: ${String(ref)}`);
  const value = ref === '#' ? document : ref.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<any>((current, key) => current?.[key], document);
  if (value === undefined) throw new ReferenceError(`Unresolved OpenAPI reference: ${ref}`);
  return value;
}
