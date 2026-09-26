import { ZopiaError } from '../errors';
import type { OpenApiDocument } from './openapi';

/**
 * Decode one RFC 6901 JSON Pointer segment.
 *
 * @param segment Escaped JSON Pointer path segment.
 * @param ref Complete reference used in error diagnostics.
 * @returns Decoded property name.
 * @throws {@link ZopiaError} when `segment` contains an invalid escape.
 */
export function decodeJsonPointerSegment(segment: string, ref = segment): string {
  if (typeof segment !== 'string') throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `invalid JSON Pointer segment: ${String(segment)}`, { at: String(ref), hint: 'use string JSON Pointer segments' });
  let decoded: string;
  try { decoded = decodeURIComponent(segment); }
  catch (error) { throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Invalid percent encoding in OpenAPI reference: ${ref}`, { at: ref, hint: 'fix the local URI fragment encoding', cause: error }); }
  if (/~(?![01])/.test(decoded)) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `Invalid JSON Pointer escape in OpenAPI reference: ${ref}`, { at: ref, hint: 'fix the local JSON Pointer escape' });
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve a local JSON Pointer reference in an OpenAPI document.
 *
 * @param document Swagger/OpenAPI document containing the target.
 * @param ref Local reference beginning with `#`.
 * @returns Referenced value, including explicit `null` values.
 * @throws {@link ZopiaError} when the document, reference, or target is invalid.
 */
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
