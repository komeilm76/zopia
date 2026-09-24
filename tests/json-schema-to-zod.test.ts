import { describe, expect, it } from 'vitest';
import { jsonSchemaToZod } from '../src';

describe('jsonSchemaToZod', () => {
  it('converts objects and preserves optional properties', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'integer' }, nickname: { type: 'string' } }, required: ['id'] });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('z.number().int()');
    expect(result.schema.safeParse({ id: 1 }).success).toBe(true);
  });
  it('converts unions and common constraints', () => {
    const result = jsonSchemaToZod({ oneOf: [{ type: 'string', minLength: 2 }, { type: 'number', minimum: 1 }] });
    expect(result.warnings).toEqual([]);
    expect(result.schema.safeParse('a').success).toBe(false);
    expect(result.schema.safeParse(2).success).toBe(true);
    expect(result.code).toContain('z.union');
  });
  it('reports unsupported references without failing', () => {
    const result = jsonSchemaToZod({ $ref: '#/$defs/User' }, { rootName: 'user' });
    expect(result.code).toBe('const user = z.any();');
    expect(result.warnings).toHaveLength(1);
  });
});
