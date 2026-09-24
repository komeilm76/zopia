import { describe, expect, it } from 'vitest';
import { jsonSchemaToZod } from '../src';

describe('jsonSchemaToZod', () => {
  it('converts objects and preserves optional properties', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'integer' }, nickname: { type: 'string' } }, required: ['id'] });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('z.number().int()');
    expect(result.schema.safeParse({ id: 1 }).success).toBe(true);
  });
  it('emits compilable code for non-string enums', () => {
    const result = jsonSchemaToZod({ enum: [1, 2, null] });
    expect(result.code).toBe('const schema = z.union([z.literal(1), z.literal(2), z.literal(null)]);');
  });
  it('converts unions, nullable types, formats, and constraints', () => {
    const result = jsonSchemaToZod({ type: ['string', 'null'], format: 'email', minLength: 5 });
    expect(result.schema.safeParse(null).success).toBe(true);
    expect(result.schema.safeParse('a').success).toBe(false);
    expect(result.schema.safeParse('valid@example.com').success).toBe(true);
    expect(result.warnings).toEqual([]);
  });
  it('validates generated identifier names', () => {
    expect(() => jsonSchemaToZod({ type: 'string' }, { rootName: 'not-valid' })).toThrow('Invalid rootName');
    expect(() => jsonSchemaToZod({ type: 'string' }, { rootName: 'default' })).toThrow('Invalid rootName');
  });
  it('preserves array uniqueness', () => {
    const result = jsonSchemaToZod({ type: 'array', uniqueItems: true, items: { type: 'string' } });
    expect(result.schema.safeParse(['a', 'a']).success).toBe(false);
  });
  it('enforces required keys even without property declarations', () => {
    const result = jsonSchemaToZod({ type: 'object', required: ['id'] });
    expect(result.schema.safeParse({}).success).toBe(false);
    expect(result.schema.safeParse({ id: 1 }).success).toBe(true);
  });
  it('preserves additionalProperties behavior', () => {
    const defaultOpen = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'number' } } });
    expect(defaultOpen.schema.safeParse({ extra: true }).success).toBe(true);
    const strict = jsonSchemaToZod({ type: 'object', additionalProperties: false });
    expect(strict.schema.safeParse({ extra: true }).success).toBe(false);
    const open = jsonSchemaToZod({ type: 'object', additionalProperties: { type: 'string' } });
    expect(open.schema.safeParse({ extra: 'ok' }).success).toBe(true);
    expect(open.schema.safeParse({ extra: 1 }).success).toBe(false);
  });
  it('rejects malformed JSON input clearly', () => {
    expect(() => jsonSchemaToZod('{bad')).toThrow('Invalid JSON Schema input');
  });
  it('resolves local definitions and warns on recursive references', () => {
    const result = jsonSchemaToZod({ $defs: { User: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }, $ref: '#/$defs/User' });
    expect(result.warnings).toEqual([]);
    expect(result.schema.safeParse({ name: 'Ada' }).success).toBe(true);
    const sibling = jsonSchemaToZod({ $defs: { Value: { type: 'string' } }, $ref: '#/$defs/Value', minLength: 3 });
    expect(sibling.schema.safeParse('ab').success).toBe(false);
    const recursive = jsonSchemaToZod({ $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } }, $ref: '#/$defs/Node' });
    expect(recursive.warnings[0]).toContain('Recursive $ref');
  });
  it('warns for unsupported applicator keywords', () => {
    const result = jsonSchemaToZod({ type: 'object', not: { required: ['id'] }, minProperties: 1 });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Unsupported JSON Schema keyword: not',
      'Unsupported JSON Schema keyword: minProperties',
    ]));
  });
  it('reports unsupported references without failing', () => {
    const result = jsonSchemaToZod({ $ref: 'https://example.com/schema.json' }, { rootName: 'user' });
    expect(result.code).toBe('const user = z.any();');
    expect(result.warnings).toHaveLength(1);
  });
});
