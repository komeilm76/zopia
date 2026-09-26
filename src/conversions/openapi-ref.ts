import { ZopiaError } from '../errors';
import type { OpenApiDocument } from './openapi';

/** Decode one RFC 6901 JSON Pointer segment. */
export function decodeJsonPointerSegment(segment: string, ref = segment): string {
  if (typeof segment !== 'string') throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `invalid JSON Pointer segment: ${String(segment)}`, { at: String(ref), hint: 'use string JSON Pointer segments' });
  if (/~(?![01])/.test(segment)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Invalid JSON Pointer escape in OpenAPI reference: ${ref}`, { at: ref, hint: 'fix the local JSON Pointer escape' });
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a local JSON Pointer reference in an OpenAPI document. */
export function resolveOpenApiLocalRef(document: OpenApiDocument, ref: string): unknown {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'invalid OpenAPI document: expected an object', { at: '#', hint: 'pass a Swagger/OpenAPI document object' });
  if (typeof ref !== 'string' || (!ref.startsWith('#/') && ref !== '#')) throw new ZopiaError('ZOPIA_REF_EXTERNAL', `Only local OpenAPI references are supported: ${String(ref)}`, { at: String(ref), hint: "use a local reference beginning with '#'" });
  const value = ref === '#' ? document : ref.slice(2).split('/').map((part) => decodeJsonPointerSegment(part, ref)).reduce<any>((current, key) => {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function') || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    return current[key];
  }, document);
  if (value === undefined) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Unresolved OpenAPI reference: ${ref}`, { at: ref, hint: 'check that the local JSON Pointer target exists' });
  return value;
}
