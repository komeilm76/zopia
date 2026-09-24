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
  it('converts tuple arrays', () => {
    const result = jsonSchemaToZod({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] });
    expect(result.schema.safeParse(['x', 1]).success).toBe(true);
    expect(result.schema.safeParse([1, 'x']).success).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.schema.safeParse(['x', 1, true]).success).toBe(true);
    const closed = jsonSchemaToZod({ type: 'array', items: [{ type: 'string' }], additionalItems: false });
    expect(closed.schema.safeParse(['x', 1]).success).toBe(false);
  });
  it('preserves array uniqueness', () => {
    const result = jsonSchemaToZod({ type: 'array', uniqueItems: true, items: { type: 'string' } });
    expect(result.schema.safeParse(['a', 'a']).success).toBe(false);
    const objects = jsonSchemaToZod({ type: 'array', uniqueItems: true, items: { type: 'object' } });
    expect(objects.schema.safeParse([{ a: 1, b: 2 }, { b: 2, a: 1 }]).success).toBe(false);
    const nullable = jsonSchemaToZod({ type: 'array', uniqueItems: true, items: { type: ['string', 'null'] } });
    expect(nullable.schema.safeParse([null, null]).success).toBe(false);
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
  it('enforces contains and contains bounds', () => {
    const result = jsonSchemaToZod({ type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 2 });
    expect(result.schema.safeParse([1, 'x', 2]).success).toBe(true);
    expect(result.schema.safeParse([1]).success).toBe(false);
    expect(result.schema.safeParse([1, 2, 3]).success).toBe(false);
  });
  it('enforces object property counts', () => {
    const result = jsonSchemaToZod({ type: 'object', minProperties: 1, maxProperties: 2 });
    expect(result.schema.safeParse({}).success).toBe(false);
    expect(result.schema.safeParse({ a: 1, b: 2, c: 3 }).success).toBe(false);
  });
  it('warns for unsupported applicator keywords', () => {
    const result = jsonSchemaToZod({ type: 'object', not: { required: ['id'] }, minProperties: 1 });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Unsupported JSON Schema keyword: not',
    ]));
  });
  it('reports unsupported references without failing', () => {
    const result = jsonSchemaToZod({ $ref: 'https://example.com/schema.json' }, { rootName: 'user' });
    expect(result.code).toBe('const user = z.any();');
    expect(result.warnings).toHaveLength(1);
  });
});
