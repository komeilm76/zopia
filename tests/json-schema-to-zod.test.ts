import { describe, expect, it } from 'vitest';
import { jsonSchemaToZod } from '../src';

describe('jsonSchemaToZod', () => {
  it('reports malformed type arrays without throwing', () => {
    expect(jsonSchemaToZod({ type: [] }).warnings).toContain('Invalid type: expected a non-empty array of valid JSON Schema type names');
    expect(jsonSchemaToZod({ type: [1] }).warnings).toContain('Invalid type: expected a non-empty array of valid JSON Schema type names');
  });
  it('supports JSON Schema boolean schemas', () => {
    expect(jsonSchemaToZod(true).schema.safeParse('anything').success).toBe(true);
    expect(jsonSchemaToZod(false).schema.safeParse('anything').success).toBe(false);
  });
  it('converts objects and preserves optional properties', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'integer' }, nickname: { type: 'string' } }, required: ['id'] });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('z.number().int()');
    expect(result.schema.safeParse({ id: 1 }).success).toBe(true);
  });
  it('supports pattern properties and property count constraints', () => {
    const result = jsonSchemaToZod({ type: 'object', patternProperties: { '^x-': { type: 'string' } }, minProperties: 1, maxProperties: 2 });
    expect(result.code).toContain('.catchall(z.string())');
    expect(result.code).toContain('Object.keys(value).length >= 1');
    expect(result.code).toContain('Object.keys(value).length <= 2');
  });
  it('supports property name patterns', () => {
    const result = jsonSchemaToZod({ type: 'object', propertyNames: { pattern: '^[a-z]+$' } });
    expect(result.code).toContain('Object.keys(value).every');
    expect(result.schema.safeParse({ good: 1 }).success).toBe(true);
    expect(result.schema.safeParse({ 'bad-key': 1 }).success).toBe(false);
  });
  it('supports not schemas', () => {
    const result = jsonSchemaToZod({ type: 'string', not: { enum: ['blocked'] } });
    expect(result.schema.safeParse('allowed').success).toBe(true);
    expect(result.schema.safeParse('blocked').success).toBe(false);
    expect(result.code).toContain('safeParse');
  });
  it('reports invalid property name patterns without throwing', () => {
    const result = jsonSchemaToZod({ type: 'object', propertyNames: { pattern: '[' } });
    expect(result.warnings).toContain('Unsupported constraint: pattern');
  });
  it('combines multiple password rules through allOf', () => {
    const result = jsonSchemaToZod({ allOf: [
      { type: 'string', minLength: 9 },
      { type: 'string', pattern: '[A-Z]' },
      { type: 'string', pattern: '[0-9]' },
      { type: 'string', pattern: '[^A-Za-z0-9]' }
    ] });
    expect(result.warnings).toEqual([]);
    expect(result.schema.safeParse('Password1!').success).toBe(true);
    expect(result.schema.safeParse('password1!').success).toBe(false);
    expect(result.schema.safeParse('PasswordOnly').success).toBe(false);
    expect(result.code).toContain('.regex(new RegExp("[A-Z]"))');
    expect(result.code).toContain('.and(');
  });
  it('supports dependent required properties', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { password: { type: 'string' }, confirmPassword: { type: 'string' } }, dependentRequired: { password: ['confirmPassword'] } });
    expect(result.schema.safeParse({ password: 'Password1!' }).success).toBe(false);
    expect(result.schema.safeParse({ password: 'Password1!', confirmPassword: 'Password1!' }).success).toBe(true);
    expect(result.schema.safeParse({}).success).toBe(true);
  });
  it('reports malformed dependent required rules', () => {
    const result = jsonSchemaToZod({ type: 'object', dependentRequired: { password: 'confirmPassword' } });
    expect(result.warnings).toContain('Invalid dependentRequired entry: expected an array of strings');
  });
  it('supports dependent schemas', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { password: { type: 'string' }, confirmPassword: { type: 'string' } }, dependentSchemas: { password: { type: 'object', required: ['confirmPassword'] } } });
    expect(result.schema.safeParse({ password: 'Password1!' }).success).toBe(false);
    expect(result.schema.safeParse({ password: 'Password1!', confirmPassword: 'Password1!' }).success).toBe(true);
    expect(result.schema.safeParse({}).success).toBe(true);
    expect(result.warnings).toEqual([]);
  });
  it('supports positive multipleOf constraints', () => {
    const result = jsonSchemaToZod({ type: 'number', multipleOf: 0.1 });
    expect(result.schema.safeParse(1.5).success).toBe(true);
    expect(result.schema.safeParse(0.3).success).toBe(true);
    expect(result.schema.safeParse(1.25).success).toBe(false);
    expect(result.code).toContain('Math.round(value / 0.1)');
  });
  it('warns for invalid multipleOf constraints', () => {
    const result = jsonSchemaToZod({ type: 'integer', multipleOf: 0 });
    expect(result.warnings).toContain('Invalid multipleOf: expected a positive number');
  });
  it('supports unevaluated property restrictions', () => {
    const strict = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'string' } }, unevaluatedProperties: false });
    expect(strict.schema.safeParse({ id: 'x', extra: true }).success).toBe(false);
    const typed = jsonSchemaToZod({ type: 'object', unevaluatedProperties: { type: 'string' } });
    expect(typed.schema.safeParse({ extra: 'ok' }).success).toBe(true);
    expect(typed.schema.safeParse({ extra: 1 }).success).toBe(false);
  });
  it('supports legacy boolean exclusive bounds', () => {
    const result = jsonSchemaToZod({ type: 'number', minimum: 5, exclusiveMinimum: true });
    expect(result.schema.safeParse(5).success).toBe(false);
    expect(result.schema.safeParse(5.1).success).toBe(true);
    expect(result.code).toContain('.gt(5)');
  });
  it('reports malformed dependent schemas', () => {
    const result = jsonSchemaToZod({ type: 'object', dependentSchemas: [] });
    expect(result.warnings).toContain('Invalid dependentSchemas: expected an object of schemas');
  });
  it('supports unevaluated tuple items', () => {
    const result = jsonSchemaToZod({ type: 'array', prefixItems: [{ type: 'string' }], unevaluatedItems: { type: 'number' } });
    expect(result.schema.safeParse(['x', 1]).success).toBe(true);
    expect(result.schema.safeParse(['x', 'bad']).success).toBe(false);
    expect(result.code).toContain('.rest(z.number())');
  });
  it('supports hostname and IP address formats', () => {
    expect(jsonSchemaToZod({ type: 'string', format: 'hostname' }).schema.safeParse('api.example.com').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', format: 'hostname' }).schema.safeParse('bad..host').success).toBe(false);
    expect(jsonSchemaToZod({ type: 'string', format: 'ipv4' }).schema.safeParse('192.168.1.1').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', format: 'ipv6' }).schema.safeParse('2001:db8::1').success).toBe(true);
  });
  it('supports base64, base64url, and emoji formats', () => {
    expect(jsonSchemaToZod({ type: 'string', format: 'base64' }).schema.safeParse('SGVsbG8=').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', format: 'base64url' }).schema.safeParse('SGVsbG8').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', format: 'emoji' }).schema.safeParse('😀').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', format: 'time' }).schema.safeParse('12:30:00').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', format: 'duration' }).schema.safeParse('P3Y6M4DT12H30M5S').success).toBe(true);
  });
  it('supports base64 content encoding', () => {
    const result = jsonSchemaToZod({ type: 'string', contentEncoding: 'base64' });
    expect(result.schema.safeParse('SGVsbG8=').success).toBe(true);
    expect(result.code).toContain('.base64()');
  });
  it('supports hexadecimal content encoding', () => {
    const result = jsonSchemaToZod({ type: 'string', contentEncoding: 'hex' });
    expect(result.schema.safeParse('deadBEEF').success).toBe(true);
    expect(result.schema.safeParse('abc').success).toBe(false);
    expect(result.warnings).toEqual([]);
  });
  it('warns for unsupported content encoding', () => {
    const result = jsonSchemaToZod({ type: 'string', contentEncoding: 'binary' });
    expect(result.warnings).toContain('Unsupported contentEncoding: binary');
  });
  it('warns when contentEncoding is used on a non-string schema', () => {
    const result = jsonSchemaToZod({ type: 'number', contentEncoding: 'base64' });
    expect(result.warnings).toContain('Invalid contentEncoding: expected a string schema');
  });
  it('supports OpenAPI integer formats', () => {
    const result = jsonSchemaToZod({ type: 'number', format: 'int64' });
    expect(result.schema.safeParse(12.5).success).toBe(false);
    expect(result.schema.safeParse(12).success).toBe(true);
    expect(result.code).toContain('.int()');
  });
  it('emits compilable code for non-string enums', () => {
    const result = jsonSchemaToZod({ enum: [1, 2, null] });
    expect(result.code).toBe('const schema = z.union([z.literal(1), z.literal(2), z.literal(null)]);');
  });
  it('warns when oneOf exclusivity is approximated', () => {
    const result = jsonSchemaToZod({ oneOf: [{ type: 'string' }, { type: 'number' }] });
    expect(result.warnings).toContain('oneOf is approximated by z.union and does not enforce exclusivity');
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
    expect(() => jsonSchemaToZod({ type: 'string' }, { rootName: 'arguments' })).toThrow('Invalid rootName');
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
    const tuple = jsonSchemaToZod({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], uniqueItems: true });
    expect(tuple.schema.safeParse(['x', 1]).success).toBe(true);
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
  it('rejects all items when items is false', () => {
    const result = jsonSchemaToZod({ type: 'array', items: false });
    expect(result.schema.safeParse([]).success).toBe(true);
    expect(result.schema.safeParse([1]).success).toBe(false);
  });
  it('warns when contains bounds have no contains schema', () => {
    const result = jsonSchemaToZod({ type: 'array', minContains: 1 });
    expect(result.warnings).toContain('minContains/maxContains require contains and were ignored');
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
  it('supports applicator keywords', () => {
    const result = jsonSchemaToZod({ type: 'object', not: { type: 'object', required: ['id'] }, minProperties: 1 });
    expect(result.warnings).toEqual([]);
    expect(result.schema.safeParse({ id: 1 }).success).toBe(false);
  });
  it('handles prototype-like property names safely', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { __proto__: { type: 'string' }, constructor: { type: 'number' } }, required: ['__proto__', 'constructor'] });
    expect(result.schema.safeParse({ ['__proto__']: 'x', constructor: 1 }).success).toBe(true);
  });
  it('reports malformed object keywords without throwing', () => {
    expect(jsonSchemaToZod({ type: 'object', properties: [] }).warnings).toContain('Invalid properties: expected an object');
    expect(jsonSchemaToZod({ type: 'object', required: 'id' }).warnings).toContain('Invalid required: expected an array of strings');
  });
  it('reports malformed combinators without throwing', () => {
    expect(jsonSchemaToZod({ oneOf: 'bad' }).warnings).toContain('Invalid oneOf: expected an array');
    expect(jsonSchemaToZod({ allOf: {} }).warnings).toContain('Invalid allOf: expected an array');
  });
  it('reports malformed enum values without throwing', () => {
    const result = jsonSchemaToZod({ enum: 'not-an-array' });
    expect(result.warnings).toContain('Invalid enum: expected an array');
  });
  it('rejects inherited and malformed local reference targets', () => {
    expect(jsonSchemaToZod({ $ref: '#/toString' }).warnings[0]).toContain('Unsupported $ref');
    expect(jsonSchemaToZod({ $ref: '#/~2bad' }).warnings[0]).toContain('Unsupported $ref');
  });
  it('reports malformed references without coercing them', () => {
    const result = jsonSchemaToZod({ $ref: 42 });
    expect(result.warnings).toContain('Invalid $ref: expected a non-empty string');
  });
  it('reports unsupported references without failing', () => {
    const result = jsonSchemaToZod({ $ref: 'https://example.com/schema.json' }, { rootName: 'user' });
    expect(result.code).toBe('const user = z.any();');
    expect(result.warnings).toHaveLength(1);
  });
});
