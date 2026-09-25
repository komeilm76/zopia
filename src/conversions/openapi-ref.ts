import type { OpenApiDocument } from './openapi';

/** Decode one RFC 6901 JSON Pointer segment. */
export function decodeJsonPointerSegment(segment: string, ref = segment): string {
  if (/~(?![01])/.test(segment)) throw new TypeError(`Invalid JSON Pointer escape in OpenAPI reference: ${ref}`);
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a local JSON Pointer reference in an OpenAPI document. */
export function resolveOpenApiLocalRef(document: OpenApiDocument, ref: string): unknown {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('Invalid OpenAPI document: expected an object');
  if (typeof ref !== 'string' || (!ref.startsWith('#/') && ref !== '#')) throw new TypeError(`Only local OpenAPI references are supported: ${String(ref)}`);
  const value = ref === '#' ? document : ref.slice(2).split('/').map((part) => decodeJsonPointerSegment(part, ref)).reduce<any>((current, key) => {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function') || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    return current[key];
  }, document);
  if (value === undefined) throw new ReferenceError(`Unresolved OpenAPI reference: ${ref}`);
  return value;
}
