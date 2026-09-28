import { describe, expect, it } from 'vitest';
import { resolveOpenApiLocalRef } from '../src';

describe('OpenAPI local references', () => {
  const doc = { components: { schemas: { User: { type: 'object' } } } };
  it('resolves JSON Pointer references, URI-fragment escapes, and the document root', () => {
    const encoded = { components: { schemas: { 'User Profile': { type: 'object' }, 'a/b': { type: 'string' } } } };
    expect(resolveOpenApiLocalRef(doc, '#/components/schemas/User')).toEqual({ type: 'object' });
    expect(resolveOpenApiLocalRef(encoded, '#/components/schemas/User%20Profile')).toEqual({ type: 'object' });
    expect(resolveOpenApiLocalRef(encoded, '#/components/schemas/a%7E1b')).toEqual({ type: 'string' });
    expect(resolveOpenApiLocalRef(doc, '#')).toBe(doc);
  });
  it('does not resolve inherited properties', () => {
    expect(() => resolveOpenApiLocalRef(doc, '#/toString')).toThrow('Unresolved OpenAPI reference');
  });
  it('S-07/S-15: rejects external and unresolved references', () => {
    expect(() => resolveOpenApiLocalRef(doc, 'other.json#/User')).toThrow('Only local');
    expect(() => resolveOpenApiLocalRef(doc, '#/components/schemas/Missing')).toThrow('Unresolved');
    expect(() => resolveOpenApiLocalRef(doc, '#/components/~2bad')).toThrow('Invalid JSON Pointer escape');
    expect(() => resolveOpenApiLocalRef(doc, '#/components/%ZZ')).toThrow('Invalid percent encoding');
  });
});
