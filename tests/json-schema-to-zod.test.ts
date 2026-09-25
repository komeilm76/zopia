import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonSchemaToZod, zodToJsonSchema } from '../src';

describe('jsonSchemaToZod', () => {
  it('reports malformed type arrays without throwing', () => {
    expect(jsonSchemaToZod({ type: [] }).warnings.map((warning) => warning.message)).toContain('Invalid type: expected a non-empty array of valid JSON Schema type names');
    expect(jsonSchemaToZod({ type: [1] }).warnings.map((warning) => warning.message)).toContain('Invalid type: expected a non-empty array of valid JSON Schema type names');
  });
  it('supports JSON Schema boolean and empty schemas without false warnings', () => {
    expect(jsonSchemaToZod(true).schema.safeParse('anything').success).toBe(true);
    expect(jsonSchemaToZod(false).schema.safeParse('anything').success).toBe(false);
    const empty = jsonSchemaToZod({});
    expect(empty.schema.safeParse('anything').success).toBe(true);
    expect(empty.warnings).toEqual([]);
  });
  it('converts objects and preserves optional properties', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'integer' }, nickname: { type: 'string' } }, required: ['id'] });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('z.number().int()');
    expect(result.schema.safeParse({ id: 1 }).success).toBe(true);
  });
  it('applies keyword-only object schemas without rejecting non-objects', () => {
    const result = jsonSchemaToZod({ properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false });
    expect(result.schema.safeParse({ id: 1 }).success).toBe(true);
    expect(result.schema.safeParse({}).success).toBe(false);
    expect(result.schema.safeParse({ id: 1, extra: true }).success).toBe(false);
    expect(result.schema.safeParse('not an object').success).toBe(true);
    expect(result.schema.safeParse(42).success).toBe(true);
    expect(result.schema.safeParse([]).success).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE', at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', node: { properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false } }]);
    expect(result.code).toContain('z.union([z.object(');
  });
  it('applies keyword-only string, array, and numeric schemas to matching instances', () => {
    const stringSchema = jsonSchemaToZod({ minLength: 2, pattern: '^a' });
    expect(stringSchema.schema.safeParse('a').success).toBe(false);
    expect(stringSchema.schema.safeParse('ab').success).toBe(true);
    expect(stringSchema.schema.safeParse(1).success).toBe(true);

    const arraySchema = jsonSchemaToZod({ items: { type: 'string' }, minItems: 1 });
    expect(arraySchema.schema.safeParse([]).success).toBe(false);
    expect(arraySchema.schema.safeParse(['x']).success).toBe(true);
    expect(arraySchema.schema.safeParse([1]).success).toBe(false);
    expect(arraySchema.schema.safeParse({}).success).toBe(true);

    const mixed = jsonSchemaToZod({ minLength: 2, minimum: 5 });
    expect(mixed.schema.safeParse('a').success).toBe(false);
    expect(mixed.schema.safeParse('ab').success).toBe(true);
    expect(mixed.schema.safeParse(4).success).toBe(false);
    expect(mixed.schema.safeParse(5).success).toBe(true);
    expect(mixed.schema.safeParse(false).success).toBe(true);
    expect(mixed.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE', at: '#' })]);
    expect(mixed.overlays).toEqual([{ at: '', node: { minLength: 2, minimum: 5 } }]);
    expect(() => new Function('z', mixed.code)).not.toThrow();
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
  it('supports boolean property-name schemas', () => {
    const result = jsonSchemaToZod({ type: 'object', propertyNames: false });
    expect(result.schema.safeParse({}).success).toBe(true);
    expect(result.schema.safeParse({ forbidden: true }).success).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);
    expect(jsonSchemaToZod({ type: 'object', propertyNames: [] }).warnings.map((warning) => warning.message)).toContain('Invalid propertyNames: expected a schema');
  });
  it('supports not schemas and validates malformed definitions', () => {
    const result = jsonSchemaToZod({ type: 'string', not: { enum: ['blocked'] } });
    expect(result.schema.safeParse('allowed').success).toBe(true);
    expect(result.schema.safeParse('blocked').success).toBe(false);
    expect(result.code).toContain('safeParse');
    const falseNot = jsonSchemaToZod({ type: 'string', not: false });
    expect(falseNot.schema.safeParse('allowed').success).toBe(true);
    expect(falseNot.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_NOT' })]);
    expect(jsonSchemaToZod({ type: 'string', not: null }).warnings.map((warning) => warning.message)).toContain('Invalid not: expected a schema');
    expect(jsonSchemaToZod({ type: 'string', not: 0 }).warnings.map((warning) => warning.message)).toContain('Invalid not: expected a schema');
  });
  it('reports invalid property name patterns without throwing', () => {
    const result = jsonSchemaToZod({ type: 'object', propertyNames: { pattern: '[' } });
    expect(result.warnings.map((warning) => warning.message)).toContain('Unsupported constraint: pattern');
  });
  it('combines multiple password rules through allOf', () => {
    const result = jsonSchemaToZod({ allOf: [
      { type: 'string', minLength: 9 },
      { type: 'string', pattern: '[A-Z]' },
      { type: 'string', pattern: '[0-9]' },
      { type: 'string', pattern: '[^A-Za-z0-9]' }
    ] });
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);
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
  it('reports malformed dependent required rules without partially applying them', () => {
    const result = jsonSchemaToZod({ type: 'object', dependentRequired: { password: 'confirmPassword' } });
    expect(result.warnings.map((warning) => warning.message)).toContain('Invalid dependentRequired entry: expected an array of strings');
    const mixed = jsonSchemaToZod({ type: 'object', dependentRequired: { password: ['confirmPassword', 1] } });
    expect(mixed.warnings.map((warning) => warning.message)).toContain('Invalid dependentRequired entry: expected an array of strings');
    expect(mixed.schema.safeParse({ password: 'secret' }).success).toBe(true);
    expect(mixed.code).not.toContain('confirmPassword');
  });
  it('supports dependent schemas', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { password: { type: 'string' }, confirmPassword: { type: 'string' } }, dependentSchemas: { password: { type: 'object', required: ['confirmPassword'] } } });
    expect(result.schema.safeParse({ password: 'Password1!' }).success).toBe(false);
    expect(result.schema.safeParse({ password: 'Password1!', confirmPassword: 'Password1!' }).success).toBe(true);
    expect(result.schema.safeParse({}).success).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);
  });
  it('supports legacy property and schema dependencies', () => {
    const result = jsonSchemaToZod({
      properties: { creditCard: { type: 'string' }, billingAddress: { type: 'string' }, country: { type: 'string' }, postalCode: { type: 'string' } },
      dependencies: {
        creditCard: ['billingAddress'],
        country: { properties: { postalCode: { type: 'string', minLength: 3 } }, required: ['postalCode'] },
      },
    });
    expect(result.schema.safeParse({ creditCard: '1234' }).success).toBe(false);
    expect(result.schema.safeParse({ creditCard: '1234', billingAddress: 'Main St' }).success).toBe(true);
    expect(result.schema.safeParse({ country: 'US' }).success).toBe(false);
    expect(result.schema.safeParse({ country: 'US', postalCode: '123' }).success).toBe(true);
    expect(result.schema.safeParse('non-object').success).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);
    expect(result.code).toContain('Object.prototype.hasOwnProperty.call');
    expect(() => new Function('z', result.code)).not.toThrow();

    const falseDependency = jsonSchemaToZod({ type: 'object', dependencies: { forbidden: false } });
    expect(falseDependency.schema.safeParse({}).success).toBe(true);
    expect(falseDependency.schema.safeParse({ forbidden: true }).success).toBe(false);
  });
  it('warns for malformed legacy dependencies', () => {
    expect(jsonSchemaToZod({ type: 'object', dependencies: [] }).warnings.map((warning) => warning.message)).toContain('Invalid dependencies: expected an object');
    expect(jsonSchemaToZod({ type: 'object', dependencies: { key: ['valid', 1] } }).warnings.map((warning) => warning.message)).toContain('Invalid dependencies entry: expected a string array or schema');
    expect(jsonSchemaToZod({ type: 'object', dependencies: { key: 'invalid' } }).warnings.map((warning) => warning.message)).toContain('Invalid dependencies entry: expected a string array or schema');
  });
  it('supports positive multipleOf constraints', () => {
    const result = jsonSchemaToZod({ type: 'number', multipleOf: 0.1 });
    expect(result.schema.safeParse(1.5).success).toBe(true);
    expect(result.schema.safeParse(0.3).success).toBe(true);
    expect(result.schema.safeParse(1.25).success).toBe(false);
    expect(result.code).toContain('.multipleOf(0.1)');
  });
  it('warns for invalid multipleOf constraints', () => {
    const result = jsonSchemaToZod({ type: 'integer', multipleOf: 0 });
    expect(result.warnings.map((warning) => warning.message)).toContain('Invalid multipleOf: expected a positive number');
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
    expect(result.warnings.map((warning) => warning.message)).toContain('Invalid dependentSchemas: expected an object of schemas');
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
    expect(jsonSchemaToZod({ type: 'string', format: 'byte' }).schema.safeParse('SGVsbG8=').success).toBe(true);
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
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_CONTENT_ENCODING' })]);
  });
  it('warns for unsupported content encoding', () => {
    const result = jsonSchemaToZod({ type: 'string', contentEncoding: 'binary' });
    expect(result.warnings.map((warning) => warning.message)).toContain('Unsupported contentEncoding: binary');
  });
  it('warns when contentEncoding is used on a non-string schema', () => {
    const result = jsonSchemaToZod({ type: 'number', contentEncoding: 'base64' });
    expect(result.warnings.map((warning) => warning.message)).toContain('Invalid contentEncoding: expected a string schema');
  });
  it('supports OpenAPI integer formats', () => {
    const result = jsonSchemaToZod({ type: 'number', format: 'int64' });
    expect(result.schema.safeParse(12.5).success).toBe(false);
    expect(result.schema.safeParse(12).success).toBe(true);
    expect(result.code).toContain('.int()');
  });
  it('supports unsigned integer formats', () => {
    const result = jsonSchemaToZod({ type: 'number', format: 'uint32' });
    expect(result.schema.safeParse(12).success).toBe(true);
    expect(result.schema.safeParse(-1).success).toBe(false);
    expect(result.code).toContain('.nonnegative().max(4294967295)');
    expect(jsonSchemaToZod({ type: 'integer', format: 'int32' }).schema.safeParse(2147483648).success).toBe(false);
  });
  it('emits compilable code for non-string enums', () => {
    const result = jsonSchemaToZod({ enum: [1, 2, null] });
    expect(result.code).toBe('const schema = z.union([z.literal(1), z.literal(2), z.literal(null)]);\n');
  });
  it('supports structured enum and const values by JSON equality', () => {
    const objectEnum = jsonSchemaToZod({ enum: [{ nested: { a: 1, b: 2 } }] });
    expect(objectEnum.schema.safeParse({ nested: { b: 2, a: 1 } }).success).toBe(true);
    expect(objectEnum.schema.safeParse({ nested: { a: 2, b: 1 } }).success).toBe(false);
    const arrayConst = jsonSchemaToZod({ const: [1, 2] });
    expect(arrayConst.schema.safeParse([1, 2]).success).toBe(true);
    expect(arrayConst.schema.safeParse([2, 1]).success).toBe(false);
    expect(() => new Function('z', objectEnum.code)).not.toThrow();
    expect(() => new Function('z', arrayConst.code)).not.toThrow();
  });
  it('preserves sibling constraints around enums, constants, and combinators', () => {
    expect(jsonSchemaToZod({ type: 'string', minLength: 3, enum: ['a', 'abc'] }).schema.safeParse('a').success).toBe(false);
    expect(jsonSchemaToZod({ type: 'string', minLength: 3, const: 'a' }).schema.safeParse('a').success).toBe(false);
    expect(jsonSchemaToZod({ type: 'string', minLength: 3, anyOf: [{ type: 'string', pattern: '^a' }] }).schema.safeParse('a').success).toBe(false);
    expect(jsonSchemaToZod({ type: 'string', minLength: 3, allOf: [{ type: 'string', pattern: '^a' }] }).schema.safeParse('a').success).toBe(false);
    expect(jsonSchemaToZod({ type: 'number', minimum: 10, oneOf: [{ type: 'number' }] }).schema.safeParse(5).success).toBe(false);
  });
  it('warns when oneOf exclusivity requires an overlay', () => {
    const result = jsonSchemaToZod({ oneOf: [{ type: 'string' }, { type: 'number' }] });
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_ONE_OF', at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', set: { oneOf: [{ type: 'string' }, { type: 'number' }] }, remove: ['anyOf'] }]);
    expect(result.code).toContain('// @zopia:warn ZOPIA_WARN_ONE_OF oneOf —');
  });
  it('converts unions, nullable types, formats, and constraints', () => {
    const result = jsonSchemaToZod({ type: ['string', 'null'], format: 'email', minLength: 5 });
    expect(result.schema.safeParse(null).success).toBe(true);
    expect(result.schema.safeParse('a').success).toBe(false);
    expect(result.schema.safeParse('valid@example.com').success).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE', at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', node: { type: ['string', 'null'], format: 'email', minLength: 5 } }]);

    const openApiNullable = jsonSchemaToZod({ type: 'string', minLength: 2, nullable: true });
    expect(openApiNullable.schema.safeParse(null).success).toBe(true);
    expect(openApiNullable.schema.safeParse('a').success).toBe(false);
    expect(openApiNullable.code).toContain('.nullable()');

    const nullableEnum = jsonSchemaToZod({ type: 'string', enum: ['active'], nullable: true });
    expect(nullableEnum.schema.safeParse(null).success).toBe(true);
    expect(nullableEnum.schema.safeParse('inactive').success).toBe(false);
    expect(jsonSchemaToZod({ type: 'string', nullable: 'yes' }).warnings.map((warning) => warning.message)).toContain('Invalid nullable: expected a boolean');
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
  it('preserves empty tuples and false tuple rest schemas', () => {
    const closedPrefix = jsonSchemaToZod({ type: 'array', prefixItems: [{ type: 'string' }], unevaluatedItems: false });
    expect(closedPrefix.schema.safeParse(['x']).success).toBe(true);
    expect(closedPrefix.schema.safeParse(['x', 1]).success).toBe(false);

    const emptyPrefix = jsonSchemaToZod({ type: 'array', prefixItems: [], items: false });
    expect(emptyPrefix.schema.safeParse([]).success).toBe(true);
    expect(emptyPrefix.schema.safeParse([1]).success).toBe(false);

    const typedPrefix = jsonSchemaToZod({ type: 'array', prefixItems: [], items: { type: 'string' } });
    expect(typedPrefix.schema.safeParse(['x']).success).toBe(true);
    expect(typedPrefix.schema.safeParse([1]).success).toBe(false);
    expect(typedPrefix.code).toContain('z.tuple([]).rest(z.string())');

    const emptyLegacyTuple = jsonSchemaToZod({ type: 'array', items: [], additionalItems: false });
    expect(emptyLegacyTuple.schema.safeParse([]).success).toBe(true);
    expect(emptyLegacyTuple.schema.safeParse([1]).success).toBe(false);

    const typedLegacyTuple = jsonSchemaToZod({ type: 'array', items: [], additionalItems: { type: 'string' } });
    expect(typedLegacyTuple.schema.safeParse(['x']).success).toBe(true);
    expect(typedLegacyTuple.schema.safeParse([1]).success).toBe(false);
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
  it('emits local definitions and lazy recursive references', () => {
    const result = jsonSchemaToZod({ $defs: { User: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }, $ref: '#/$defs/User' });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('const user = z.object(');
    expect(result.code).toContain('const schema = z.lazy(() => user);');
    expect(result.schema.safeParse({ name: 'Ada' }).success).toBe(true);
    const sibling = jsonSchemaToZod({ $defs: { Value: { type: 'string' } }, $ref: '#/$defs/Value', minLength: 3 });
    expect(sibling.schema.safeParse('ab').success).toBe(false);
    const recursive = jsonSchemaToZod({ $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } }, $ref: '#/$defs/Node' });
    expect(recursive.warnings).toEqual([]);
    expect(recursive.code).toContain('["next"]: z.lazy(() => node).optional()');
    expect(recursive.schema.safeParse({ next: { next: {} } }).success).toBe(true);
  });
  it('rejects all items when items is false', () => {
    const result = jsonSchemaToZod({ type: 'array', items: false });
    expect(result.schema.safeParse([]).success).toBe(true);
    expect(result.schema.safeParse([1]).success).toBe(false);
  });
  it('warns when contains bounds have no contains schema', () => {
    const result = jsonSchemaToZod({ type: 'array', minContains: 1 });
    expect(result.warnings.map((warning) => warning.message)).toContain('minContains/maxContains require contains and were ignored');
  });
  it('enforces contains and contains bounds', () => {
    const result = jsonSchemaToZod({ type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 2 });
    expect(result.schema.safeParse([1, 'x', 2]).success).toBe(true);
    expect(result.schema.safeParse([1]).success).toBe(false);
    expect(result.schema.safeParse([1, 2, 3]).success).toBe(false);
  });
  it('supports false boolean contains schemas', () => {
    const result = jsonSchemaToZod({ type: 'array', contains: false });
    expect(result.schema.safeParse([]).success).toBe(false);
    expect(result.schema.safeParse([1]).success).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);
    expect(jsonSchemaToZod({ type: 'array', contains: false, minContains: 0 }).schema.safeParse([1]).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'array', contains: [] }).warnings.map((warning) => warning.message)).toContain('Invalid contains: expected a schema');
  });
  it('enforces object property counts', () => {
    const result = jsonSchemaToZod({ type: 'object', minProperties: 1, maxProperties: 2 });
    expect(result.schema.safeParse({}).success).toBe(false);
    expect(result.schema.safeParse({ a: 1, b: 2, c: 3 }).success).toBe(false);
  });
  it('supports applicator keywords', () => {
    const result = jsonSchemaToZod({ type: 'object', not: { type: 'object', required: ['id'] }, minProperties: 1 });
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_NOT' })]);
    expect(result.schema.safeParse({ id: 1 }).success).toBe(false);
  });
  it('supports conditional if, then, and else schemas', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      properties: { kind: { type: 'string' }, value: { type: 'string' }, count: { type: 'number' } },
      if: { properties: { kind: { const: 'text' } }, required: ['kind'] },
      then: { properties: { value: { type: 'string', minLength: 2 } }, required: ['value'] },
      else: { properties: { count: { type: 'number', minimum: 1 } }, required: ['count'] },
    });
    expect(result.schema.safeParse({ kind: 'text', value: 'ok' }).success).toBe(true);
    expect(result.schema.safeParse({ kind: 'text', value: 'x' }).success).toBe(false);
    expect(result.schema.safeParse({ kind: 'count', count: 1 }).success).toBe(true);
    expect(result.schema.safeParse({ kind: 'count', count: 0 }).success).toBe(false);
    expect(result.code).toContain('.safeParse(value).success ?');
    expect(() => new Function('z', result.code)).not.toThrow();

    const falseCondition = jsonSchemaToZod({ type: 'number', if: false, else: { minimum: 10 } });
    expect(falseCondition.schema.safeParse(5).success).toBe(false);
    expect(falseCondition.schema.safeParse(10).success).toBe(true);
    const falseThen = jsonSchemaToZod({ type: 'number', if: { minimum: 0 }, then: false });
    expect(falseThen.schema.safeParse(1).success).toBe(false);
    expect(falseThen.schema.safeParse(-1).success).toBe(true);

    const untypedObject = jsonSchemaToZod({ if: { properties: { kind: { const: 'text' } }, required: ['kind'] }, then: { required: ['value'] } });
    expect(untypedObject.schema.safeParse({ kind: 'text' }).success).toBe(false);
    expect(untypedObject.schema.safeParse({ kind: 'text', value: 1 }).success).toBe(true);
    expect(untypedObject.schema.safeParse('non-object values remain valid').success).toBe(true);
    expect(untypedObject.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);

    const untypedString = jsonSchemaToZod({ if: { minLength: 2 }, then: { pattern: '^x' } });
    expect(untypedString.schema.safeParse('ab').success).toBe(false);
    expect(untypedString.schema.safeParse('xb').success).toBe(true);
    expect(untypedString.schema.safeParse('a').success).toBe(true);
    expect(untypedString.schema.safeParse(1).success).toBe(true);
    expect(untypedString.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' })]);
  });
  it('warns for malformed or detached conditional branches', () => {
    expect(jsonSchemaToZod({ type: 'string', then: { minLength: 2 } }).warnings.map((warning) => warning.message)).toContain('then/else require if and were ignored');
    expect(jsonSchemaToZod({ type: 'string', if: [] }).warnings.map((warning) => warning.message)).toContain('Invalid if: expected a schema');
    expect(jsonSchemaToZod({ type: 'string', if: true, then: [] }).warnings.map((warning) => warning.message)).toContain('Invalid then: expected a schema');
    expect(jsonSchemaToZod({ type: 'string', if: false, else: [] }).warnings.map((warning) => warning.message)).toContain('Invalid else: expected a schema');
  });
  it('handles prototype-like property names safely', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { __proto__: { type: 'string' }, constructor: { type: 'number' } }, required: ['__proto__', 'constructor'] });
    expect(result.schema.safeParse({ ['__proto__']: 'x', constructor: 1 }).success).toBe(true);
  });
  it('reports malformed object keywords without throwing', () => {
    expect(jsonSchemaToZod({ type: 'object', properties: [] }).warnings.map((warning) => warning.message)).toContain('Invalid properties: expected an object');
    expect(jsonSchemaToZod({ type: 'object', required: 'id' }).warnings.map((warning) => warning.message)).toContain('Invalid required: expected an array of strings');
    const malformedRequired = jsonSchemaToZod({ type: 'object', required: [1] });
    expect(malformedRequired.warnings.map((warning) => warning.message)).toContain('Invalid required: expected an array of strings');
    expect(malformedRequired.schema.safeParse({}).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'object', patternProperties: [] }).warnings.map((warning) => warning.message)).toContain('Invalid patternProperties: expected an object');
    expect(jsonSchemaToZod({ type: 'object', additionalProperties: [] }).warnings.map((warning) => warning.message)).toContain('Invalid additionalProperties: expected a schema');
    expect(jsonSchemaToZod({ type: 'object', unevaluatedProperties: [] }).warnings.map((warning) => warning.message)).toContain('Invalid unevaluatedProperties: expected a schema');
  });
  it('warns for malformed numeric and size constraints without emitting invalid code', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ type: 'string', minLength: 'x' }, 'Invalid minLength: expected a non-negative integer'],
      [{ type: 'string', minLength: -1 }, 'Invalid minLength: expected a non-negative integer'],
      [{ type: 'string', maxLength: 'x' }, 'Invalid maxLength: expected a non-negative integer'],
      [{ type: 'string', pattern: 42 }, 'Invalid pattern: expected a string'],
      [{ type: 'number', minimum: 'x' }, 'Invalid minimum: expected a finite number'],
      [{ type: 'number', minimum: Number.NaN }, 'Invalid minimum: expected a finite number'],
      [{ type: 'array', minItems: 'x' }, 'Invalid minItems: expected a non-negative integer'],
      [{ type: 'array', contains: false, minContains: 'x' }, 'Invalid minContains: expected a non-negative integer'],
      [{ type: 'array', contains: false, minContains: -1 }, 'Invalid minContains: expected a non-negative integer'],
      [{ type: 'object', minProperties: 'x' }, 'Invalid minProperties: expected a non-negative integer'],
      [{ type: 'object', minProperties: -1 }, 'Invalid minProperties: expected a non-negative integer'],
      [{ type: 'number', multipleOf: Number.POSITIVE_INFINITY }, 'Invalid multipleOf: expected a positive number'],
    ];
    for (const [schema, warning] of cases) {
      const result = jsonSchemaToZod(schema);
      expect(result.warnings.map((warning) => warning.message)).toContain(warning);
      expect(() => new Function('z', result.code)).not.toThrow();
    }
  });
  it('warns for malformed array keywords and ignores inapplicable constraints', () => {
    expect(jsonSchemaToZod({ type: 'array', prefixItems: 'bad' }).warnings.map((warning) => warning.message)).toContain('Invalid prefixItems: expected an array of schemas');
    expect(jsonSchemaToZod({ type: 'array', items: null }).warnings.map((warning) => warning.message)).toContain('Invalid items: expected a schema or tuple array');
    expect(jsonSchemaToZod({ type: 'array', uniqueItems: 'yes' }).warnings.map((warning) => warning.message)).toContain('Invalid uniqueItems: expected a boolean');
    const inapplicable = jsonSchemaToZod({ type: 'number', minLength: 5 });
    expect(inapplicable.schema.safeParse(1).success).toBe(true);
    expect(inapplicable.code).not.toContain('.min(5)');
  });
  it('reports malformed combinators without throwing', () => {
    expect(jsonSchemaToZod({ oneOf: 'bad' }).warnings.map((warning) => warning.message)).toContain('Invalid oneOf: expected an array');
    expect(jsonSchemaToZod({ allOf: {} }).warnings.map((warning) => warning.message)).toContain('Invalid allOf: expected an array');
  });
  it('reports malformed enum values without throwing', () => {
    const result = jsonSchemaToZod({ enum: 'not-an-array' });
    expect(result.warnings.map((warning) => warning.message)).toContain('Invalid enum: expected an array');
  });
  it('rejects inherited and malformed local reference targets', () => {
    expect(jsonSchemaToZod({ $ref: '#/toString' }).warnings[0]?.message).toContain('Unsupported $ref');
    expect(jsonSchemaToZod({ $ref: '#/~2bad' }).warnings[0]?.message).toContain('Unsupported $ref');
  });
  it('reports malformed references without coercing them', () => {
    const result = jsonSchemaToZod({ $ref: 42 });
    expect(result.warnings.map((warning) => warning.message)).toContain('Invalid $ref: expected a non-empty string');
  });
  it('reports unsupported references without failing', () => {
    const result = jsonSchemaToZod({ $ref: 'https://example.com/schema.json' }, { rootName: 'user' });
    expect(result.code).toContain('// @zopia:warn ZOPIA_WARN_REF $ref —');
    expect(result.code).toContain('z.any()');
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_REF', at: '#' })]);
  });
  it('reads JSON Schema from a .json file path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-schema-'));
    const file = join(directory, 'user.json');
    await writeFile(file, JSON.stringify({ type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] }), 'utf8');
    const result = jsonSchemaToZod(file, { rootName: 'user' });
    expect(result.code).toBe('const user = z.object({ ["id"]: z.string().uuid() }).passthrough();\n');
    expect(result.schema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
    expect(result.warnings).toEqual([]);
  });
  it('emits structured nested warnings, markers, and surgical overlays', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      properties: {
        website: { type: 'string', format: 'url' },
        clock: { type: 'string', format: 'time' },
        payload: { type: 'string', format: 'vendor-data' },
        ids: { type: 'array', uniqueItems: true, items: { type: 'string' } },
        count: { type: 'number', minimum: 1, exclusiveMinimum: true },
      },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/properties/website' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/properties/clock' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/properties/payload' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_UNIQUE_ITEMS', at: '#/properties/ids' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_LEGACY_EXCLUSIVE_BOUND', at: '#/properties/count' }),
    ]));
    expect(result.code).toContain('// @zopia:warn ZOPIA_WARN_CUSTOM_FORMAT format —');
    expect(result.code).toContain('// @zopia:warn ZOPIA_WARN_UNIQUE_ITEMS uniqueItems —');
    expect(result.schema.safeParse({ website: 'not a URL' }).success).toBe(false);
    expect(result.schema.safeParse({ clock: '99:99:99' }).success).toBe(false);
    expect(result.overlays).toEqual(expect.arrayContaining([
      { at: '/properties/website', set: { format: 'url' } },
      { at: '/properties/clock', set: { format: 'time' }, remove: ['pattern'] },
      { at: '/properties/payload', set: { format: 'vendor-data' } },
      { at: '/properties/ids', set: { uniqueItems: true } },
      { at: '/properties/count', set: { exclusiveMinimum: true, minimum: 1 } },
    ]));
  });
  it('freezes structural refinements and preserves the original node', () => {
    const source = { type: 'object', properties: { value: { type: 'string' } }, not: { required: ['blocked'] } };
    const result = jsonSchemaToZod(source);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_NOT', at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', node: source }]);
    expect(result.code).toContain('// @zopia:warn ZOPIA_WARN_NOT not —');
  });
  it('uses a native Zod hostname schema for identity reverse conversion', () => {
    const result = jsonSchemaToZod({ type: 'string', format: 'hostname' });
    expect(result.code).toContain('z.hostname()');
    expect(result.schema.safeParse('api.example.com').success).toBe(true);
    expect(result.schema.safeParse('-invalid.example').success).toBe(false);
    expect(zodToJsonSchema(result.schema, { $schema: false })).toEqual({ type: 'string', format: 'hostname' });
    expect(result.warnings).toEqual([]);
    expect(result.overlays).toEqual([]);
  });
  it('uses discriminated unions when every oneOf member has a discriminator literal', () => {
    const source = {
      oneOf: [
        { type: 'object', properties: { kind: { const: 'cat' }, lives: { type: 'integer' } }, required: ['kind', 'lives'] },
        { type: 'object', properties: { kind: { const: 'dog' }, good: { type: 'boolean' } }, required: ['kind', 'good'] },
      ],
      discriminator: { propertyName: 'kind' },
    };
    const result = jsonSchemaToZod(source);
    expect(result.code).toContain("z.discriminatedUnion(\"kind\"");
    expect(result.schema.safeParse({ kind: 'cat', lives: 9 }).success).toBe(true);
    expect(result.schema.safeParse({ kind: 'cat', good: true }).success).toBe(false);
    expect(result.overlays).toEqual([{ at: '', set: { oneOf: source.oneOf, discriminator: source.discriminator }, remove: ['anyOf'] }]);
  });
  it('preserves non-native encoding annotations and source numeric bounds in overlays', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      properties: {
        encoded: { type: 'string', contentEncoding: 'rot13', contentMediaType: 'text/plain' },
        count: { type: 'integer', format: 'int32', minimum: 5 },
      },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ZOPIA_WARN_CONTENT_ENCODING', at: '#/properties/encoded' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/properties/count' }),
    ]));
    expect(result.overlays).toEqual(expect.arrayContaining([
      { at: '/properties/encoded', set: { contentEncoding: 'rot13', contentMediaType: 'text/plain' } },
      { at: '/properties/count', set: { format: 'int32', minimum: 5 }, remove: ['maximum'] },
    ]));
  });
  it('copies schema annotations into one metadata call', () => {
    const result = jsonSchemaToZod({ type: 'string', title: 'Name', description: 'Display name', example: 'Ada' });
    expect(result.code).toContain('/**\n * Name\n * Display name\n */');
    expect(result.code).toContain('.meta({"title":"Name","description":"Display name","examples":["Ada"]})');
    expect(result.schema.meta()).toMatchObject({ title: 'Name', description: 'Display name', examples: ['Ada'] });
    expect(result.overlays).toEqual([{ at: '', set: { example: 'Ada' }, remove: ['examples'] }]);
  });
});
