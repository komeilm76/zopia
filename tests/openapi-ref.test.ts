import { describe, expect, it } from 'vitest';
import { resolveOpenApiLocalRef } from '../src';

describe('OpenAPI local references', () => {
  const doc = { components: { schemas: { User: { type: 'object' } } } };
  it('resolves JSON Pointer references and the document root', () => {
    expect(resolveOpenApiLocalRef(doc, '#/components/schemas/User')).toEqual({ type: 'object' });
    expect(resolveOpenApiLocalRef(doc, '#')).toBe(doc);
  });
  it('rejects external and unresolved references', () => {
    expect(() => resolveOpenApiLocalRef(doc, 'other.json#/User')).toThrow('Only local');
    expect(() => resolveOpenApiLocalRef(doc, '#/components/schemas/Missing')).toThrow('Unresolved');
  });
});
