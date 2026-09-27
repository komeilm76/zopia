import { useTemporaryDirectories } from './test-temporary-directories';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, zodToJsonSchema } from '../src';

const temporaryDirectory = useTemporaryDirectories();

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
    expect(result.schema.safeParse({ 'x-name': 'valid' }).success).toBe(true);
    expect(result.schema.safeParse({ 'x-name': 1 }).success).toBe(false);
    expect(result.schema.safeParse({ unmatched: 1 }).success).toBe(true);
    expect(result.code).toContain('new RegExp("^x-")');
    expect(result.code).toContain('Object.keys(value).length >= 1');
    expect(result.code).toContain('Object.keys(value).length <= 2');
  });
  it('applies every matching pattern schema and additionalProperties only to unmatched keys', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      properties: { fixed: { type: 'number' } },
      patternProperties: {
        '^x-': { type: 'string', minLength: 2 },
        '-id$': { type: 'string', pattern: '^[a-z]+$' },
      },
      additionalProperties: { type: 'boolean' },
    });

    expect(result.schema.safeParse({ fixed: 1, 'x-name': 'ok', other: true }).success).toBe(true);
    expect(result.schema.safeParse({ fixed: 1, 'x-name': 'x' }).success).toBe(false);
    expect(result.schema.safeParse({ fixed: 1, 'x-id': '12' }).success).toBe(false);
    expect(result.schema.safeParse({ fixed: 1, other: 1 }).success).toBe(false);
    expect(result.schema.safeParse({ fixed: 1 }).success).toBe(true);
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);
    expect(generated.safeParse({ fixed: 1, 'x-id': '12' }).success).toBe(false);
    expect(generated.safeParse({ fixed: 1, other: true }).success).toBe(true);
  });
  it('permits pattern-matched keys while rejecting unmatched additional properties', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      patternProperties: { '^x-': { type: 'number' } },
      additionalProperties: false,
    });

    expect(result.schema.safeParse({ 'x-count': 1 }).success).toBe(true);
    expect(result.schema.safeParse({ 'x-count': '1' }).success).toBe(false);
    expect(result.schema.safeParse({ other: 1 }).success).toBe(false);
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
  it.each([
    [{ type: 'number', maximum: 5 }, 5, 5.1, '.max(5)'],
    [{ type: 'number', exclusiveMinimum: 1 }, 1.1, 1, '.gt(1)'],
    [{ type: 'number', exclusiveMaximum: 5 }, 4.9, 5, '.lt(5)'],
    [{ type: 'string', maxLength: 3 }, 'abc', 'abcd', '.max(3)'],
    [{ type: 'array', items: { type: 'string' }, maxItems: 2 }, ['a', 'b'], ['a', 'b', 'c'], '.max(2)'],
  ] as const)('S-42: enforces upper and exclusive constraint %#', (source, valid, invalid, codeFragment) => {
    const result = jsonSchemaToZod(source as any);
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);

    expect(result.schema.safeParse(valid).success).toBe(true);
    expect(result.schema.safeParse(invalid).success).toBe(false);
    expect(generated.safeParse(valid).success).toBe(true);
    expect(generated.safeParse(invalid).success).toBe(false);
    expect(result.code).toContain(codeFragment);
    expect(result.warnings).toEqual([]);
  });
  it('S-42: enforces the legacy boolean exclusive maximum with a restoration overlay', () => {
    const result = jsonSchemaToZod({ type: 'integer', maximum: 5, exclusiveMaximum: true });

    expect(result.schema.safeParse(4).success).toBe(true);
    expect(result.schema.safeParse(5).success).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_LEGACY_EXCLUSIVE_BOUND', at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', set: { exclusiveMaximum: true, maximum: 5 } }]);
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
  it.each([
    ['email', 'user@example.com', 'not-an-email'],
    ['uuid', '550e8400-e29b-41d4-a716-446655440000', 'not-a-uuid'],
    ['hostname', 'api.example.com', 'bad..host'],
    ['ipv4', '192.168.1.1', '2001:db8::1'],
    ['ipv6', '2001:db8::1', '192.168.1.1'],
    ['date-time', '2024-01-02T03:04:05Z', '2024-01-02'],
    ['date', '2024-01-02', '2024-02-30'],
    ['duration', 'P3Y6M4DT12H30M5S', 'three years'],
    ['uri', 'https://example.test/items/1', 'not a uri'],
  ])('S-41: enforces and round-trips the exact %s format', (format, valid, invalid) => {
    const source = { type: 'string', format };
    const result = jsonSchemaToZod(source);
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);

    expect(result.schema.safeParse(valid).success).toBe(true);
    expect(result.schema.safeParse(invalid).success).toBe(false);
    expect(generated.safeParse(valid).success).toBe(true);
    expect(generated.safeParse(invalid).success).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.overlays).toEqual([]);
    expect(zodToJsonSchema(result.schema, { $schema: false })).toEqual(source);
  });
  it.each([
    ['url', 'https://example.test/items/1', 'not a url', { at: '', set: { format: 'url' } }],
    ['time', '12:30:00', '25:00:00', { at: '', set: { format: 'time' }, remove: ['pattern'] }],
    ['byte', 'SGVsbG8=', '***', { at: '', set: { format: 'byte' }, remove: ['pattern', 'contentEncoding'] }],
    ['base64', 'SGVsbG8=', '***', { at: '', set: { format: 'base64' }, remove: ['pattern', 'contentEncoding'] }],
    ['base64url', 'SGVsbG8', '***', { at: '', set: { format: 'base64url' }, remove: ['pattern', 'contentEncoding'] }],
    ['emoji', '😀', 'plain', { at: '', set: { format: 'emoji' }, remove: ['pattern'] }],
  ] as const)('S-41: enforces the %s format and records its exact overlay', (format, valid, invalid, overlay) => {
    const result = jsonSchemaToZod({ type: 'string', format });
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);

    expect(result.schema.safeParse(valid).success).toBe(true);
    expect(result.schema.safeParse(invalid).success).toBe(false);
    expect(generated.safeParse(valid).success).toBe(true);
    expect(generated.safeParse(invalid).success).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#' })]);
    expect(result.overlays).toEqual([overlay]);
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
  it.each([
    ['int32', 2147483647, 2147483648, 'ZOPIA_WARN_CUSTOM_FORMAT'],
    ['int64', 12, 12.5, 'ZOPIA_WARN_INT64'],
    ['uint32', 4294967295, 4294967296, 'ZOPIA_WARN_CUSTOM_FORMAT'],
    ['uint64', 12, -1, 'ZOPIA_WARN_CUSTOM_FORMAT'],
  ] as const)('S-41: enforces numeric format %s and preserves it with an overlay', (format, valid, invalid, warningCode) => {
    const result = jsonSchemaToZod({ type: 'integer', format });
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);

    expect(result.schema.safeParse(valid).success).toBe(true);
    expect(result.schema.safeParse(invalid).success).toBe(false);
    expect(generated.safeParse(valid).success).toBe(true);
    expect(generated.safeParse(invalid).success).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: warningCode, at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', set: { format }, remove: ['minimum', 'maximum'] }]);
  });
  it.each([
    ['string', 'password', 'secret', 42],
    ['string', 'binary', '0101', false],
    ['number', 'float', 1.5, '1.5'],
    ['number', 'double', 1.5, '1.5'],
    ['string', 'uri-reference', '../items', 1],
    ['string', 'regex', '^x$', 1],
    ['number', 'decimal', 1.25, '1.25'],
    ['string', 'json-pointer', '/items/0', 1],
  ] as const)('S-41: retains base %s validation for unsupported format %s', (type, format, valid, invalid) => {
    const result = jsonSchemaToZod({ type, format });
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);

    expect(result.schema.safeParse(valid).success).toBe(true);
    expect(result.schema.safeParse(invalid).success).toBe(false);
    expect(generated.safeParse(valid).success).toBe(true);
    expect(generated.safeParse(invalid).success).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#' })]);
    expect(result.overlays).toEqual([{ at: '', set: { format } }]);
  });
  it('emits compilable code for non-string enums', () => {
    const result = jsonSchemaToZod({ enum: [1, 2, null] });
    expect(result.code).toBe('const schema = z.union([z.literal(1), z.literal(2), z.literal(null)]);\n');
  });
  it('supports structured enum and const values by JSON equality', () => {
    const sourceEnum = { enum: [{ nested: { a: 1, b: 2 } }, [1, 2], 'active'] };
    const objectEnum = jsonSchemaToZod(sourceEnum);
    expect(objectEnum.schema.safeParse({ nested: { b: 2, a: 1 } }).success).toBe(true);
    expect(objectEnum.schema.safeParse([1, 2]).success).toBe(true);
    expect(objectEnum.schema.safeParse('active').success).toBe(true);
    expect(objectEnum.schema.safeParse({ nested: { a: 2, b: 1 } }).success).toBe(false);
    expect(objectEnum.schema.safeParse({ nested: { a: 1, b: 2 }, ignored: undefined }).success).toBe(false);
    expect(zodToJsonSchema(objectEnum.schema, { $schema: false })).toEqual(sourceEnum);
    const generatedEnum = new Function('z', `${objectEnum.code}\nreturn schema;`)(z);
    expect(generatedEnum.safeParse({ nested: { b: 2, a: 1 } }).success).toBe(true);
    expect(generatedEnum.safeParse({ nested: { a: 1, b: 2 }, ignored: undefined }).success).toBe(false);
    const disguised = { toJSON: () => ({ nested: { a: 1, b: 2 } }) };
    expect(objectEnum.schema.safeParse(disguised).success).toBe(false);
    expect(generatedEnum.safeParse(disguised).success).toBe(false);
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

    const nullableReference = jsonSchemaToZod({ $defs: { Name: { type: 'string', minLength: 2 } }, $ref: '#/$defs/Name', nullable: true });
    expect(nullableReference.schema.safeParse(null).success).toBe(true);
    expect(nullableReference.schema.safeParse('ok').success).toBe(true);
    expect(nullableReference.schema.safeParse('x').success).toBe(false);
    expect(nullableReference.code).toContain('z.lazy(() => name).nullable()');
    const generatedNullableReference = new Function('z', `${nullableReference.code}\nreturn schema;`)(z);
    expect(generatedNullableReference.safeParse(null).success).toBe(true);

    const defaultedReference = jsonSchemaToZod({ $defs: { Name: { type: 'string' } }, $ref: '#/$defs/Name', default: 'anonymous' });
    expect(defaultedReference.schema.parse(undefined)).toBe('anonymous');
    expect(defaultedReference.code).toContain('z.lazy(() => name).default("anonymous")');

    const invalidDefault = jsonSchemaToZod({ type: 'object', default: { score: Number.NaN } });
    expect(invalidDefault.schema.safeParse(undefined).success).toBe(false);
    expect(invalidDefault.code).not.toContain('.default(');
    expect(invalidDefault.warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_INVALID_SCHEMA', at: '#', message: 'Invalid default: expected a JSON value' })]);
    expect(jsonSchemaToZod({ type: 'string', default: undefined }).warnings).toEqual([expect.objectContaining({ message: 'Invalid default: expected a JSON value' })]);
    expect(jsonSchemaToZod({ const: { score: Number.NaN } }).warnings).toEqual([expect.objectContaining({ message: 'Invalid const value: expected a JSON value' })]);
    expect(jsonSchemaToZod({ enum: [{ score: undefined }] }).warnings).toEqual([expect.objectContaining({ message: 'Invalid enum value: expected a JSON value' })]);
    expect(jsonSchemaToZod({ type: 'string', 'x-runtime': () => 'nope' }).warnings).toEqual([expect.objectContaining({ message: 'Invalid x-runtime: expected a JSON value' })]);

    const annotated = jsonSchemaToZod({ type: 'string', readOnly: true, writeOnly: false, deprecated: true, xml: { name: 'value' }, 'x-scope': 'internal' });
    expect(annotated.code).toContain('.meta({"readOnly":true,"writeOnly":false,"deprecated":true,"xml":{"name":"value"},"x-scope":"internal"})');
    expect(zodToJsonSchema(annotated.schema, { target: 'openapi-3.1', $schema: false })).toEqual({
      type: 'string', readOnly: true, writeOnly: false, deprecated: true, xml: { name: 'value' }, 'x-scope': 'internal',
    });

    expect(jsonSchemaToZod({ type: 'string', nullable: 'yes' }).warnings.map((warning) => warning.message)).toContain('Invalid nullable: expected a boolean');
  });
  it('validates generated identifier names', () => {
    expect(() => jsonSchemaToZod({ type: 'string' }, { rootName: 'not-valid' })).toThrow('Invalid rootName');
    expect(() => jsonSchemaToZod({ type: 'string' }, { rootName: 'default' })).toThrow('Invalid rootName');
    expect(() => jsonSchemaToZod({ type: 'string' }, { rootName: 'arguments' })).toThrow('Invalid rootName');
  });
  it('converts tuple arrays without requiring optional prefix positions', () => {
    const result = jsonSchemaToZod({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] });
    expect(result.schema.safeParse([]).success).toBe(true);
    expect(result.schema.safeParse(['x']).success).toBe(true);
    expect(result.schema.safeParse(['x', 1]).success).toBe(true);
    expect(result.schema.safeParse([1, 'x']).success).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.schema.safeParse(['x', 1, true]).success).toBe(true);
    expect(result.code).toContain('z.string().optional(), z.number().optional()');
    const closed = jsonSchemaToZod({ type: 'array', items: [{ type: 'string' }], additionalItems: false });
    expect(closed.schema.safeParse([]).success).toBe(true);
    expect(closed.schema.safeParse(['x', 1]).success).toBe(false);
  });
  it('enforces tuple minItems and maxItems without unsupported Zod tuple methods', () => {
    const result = jsonSchemaToZod({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
      minItems: 1,
      maxItems: 2,
    });

    expect(result.schema.safeParse([]).success).toBe(false);
    expect(result.schema.safeParse(['x']).success).toBe(true);
    expect(result.schema.safeParse(['x', 1]).success).toBe(true);
    expect(result.schema.safeParse(['x', 1, true]).success).toBe(false);
    expect(result.warnings.map((warning) => warning.message)).not.toContain('Unsupported constraint: minItems');
    expect(result.warnings.map((warning) => warning.message)).not.toContain('Unsupported constraint: maxItems');
    expect(result.overlays).toEqual([{ at: '', set: { minItems: 1, maxItems: 2 } }]);
    expect(result.code).toContain('z.tuple([z.string(), z.number().optional(), z.boolean().optional()])');
    expect(result.code).toContain('items.length >= 1');
    expect(result.code).toContain('items.length <= 2');
    const generated = new Function('z', `${result.code}\nreturn schema;`)(z);
    expect(generated.safeParse([]).success).toBe(false);
    expect(generated.safeParse(['x', 1]).success).toBe(true);
    expect(generated.safeParse(['x', 1, true]).success).toBe(false);
  });
  it('preserves empty tuples and false tuple rest schemas', () => {
    const closedPrefix = jsonSchemaToZod({ type: 'array', prefixItems: [{ type: 'string' }], unevaluatedItems: false });
    expect(closedPrefix.schema.safeParse([]).success).toBe(true);
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
  it('applies additional and pattern schemas to required keys without property declarations', () => {
    const impossible = jsonSchemaToZod({ type: 'object', required: ['id'], additionalProperties: false });
    expect(impossible.schema.safeParse({}).success).toBe(false);
    expect(impossible.schema.safeParse({ id: 1 }).success).toBe(false);

    const typed = jsonSchemaToZod({ type: 'object', required: ['id'], additionalProperties: { type: 'string' } });
    expect(typed.schema.safeParse({ id: 'ok' }).success).toBe(true);
    expect(typed.schema.safeParse({ id: 1 }).success).toBe(false);
    const generated = new Function('z', `${typed.code}\nreturn schema;`)(z);
    expect(generated.safeParse({ id: 'ok' }).success).toBe(true);
    expect(generated.safeParse({ id: 1 }).success).toBe(false);

    const patterned = jsonSchemaToZod({ type: 'object', required: ['x-id'], patternProperties: { '^x-': { type: 'number' } }, additionalProperties: false });
    expect(patterned.schema.safeParse({ 'x-id': 1 }).success).toBe(true);
    expect(patterned.schema.safeParse({ 'x-id': 'bad' }).success).toBe(false);
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
  it('resolves percent-encoded local JSON Schema references', () => {
    const result = jsonSchemaToZod({
      $defs: { 'User Profile': { type: 'string', minLength: 2 } },
      $ref: '#/$defs/User%20Profile',
    });

    expect(result.schema.safeParse('ok').success).toBe(true);
    expect(result.schema.safeParse('x').success).toBe(false);
    expect(result.warnings).toEqual([]);
  });
  it('intersects siblings of arbitrary local references instead of overriding referenced constraints', () => {
    const result = jsonSchemaToZod({
      $defs: {
        Holder: {
          type: 'object',
          properties: { value: { type: 'string', minLength: 5 } },
        },
      },
      $ref: '#/$defs/Holder/properties/value',
      minLength: 2,
    });

    expect(result.schema.safeParse('ab').success).toBe(false);
    expect(result.schema.safeParse('abcde').success).toBe(true);
    expect(result.code).toContain('z.string().min(5).and(');
    const incompatible = jsonSchemaToZod({
      $defs: { Holder: { type: 'object', properties: { value: { type: 'string' } } } },
      $ref: '#/$defs/Holder/properties/value',
      type: 'number',
    });
    expect(incompatible.schema.safeParse('text').success).toBe(false);
    expect(incompatible.schema.safeParse(1).success).toBe(false);
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
  it('S-49: matches z.fromJSONSchema behavior on the supported fixture set', () => {
    const fixtures: Array<{ schema: Record<string, unknown>; values: unknown[] }> = [
      { schema: { type: 'string', minLength: 2, maxLength: 4, pattern: '^a' }, values: ['', 'a', 'ab', 'abcd', 'abcde', 1] },
      { schema: { type: 'number', minimum: 1, maximum: 3, multipleOf: 0.5 }, values: [0, 1, 1.5, 3, 3.5, '2'] },
      { schema: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 2 }, values: [[], [1], [1, 2], [1, 2, 3], [1.5], ['1']] },
      { schema: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'integer' } }, required: ['id'], additionalProperties: false }, values: [{}, { id: 'x' }, { id: 'x', count: 1 }, { id: 'x', count: 1.2 }, { id: 'x', extra: true }] },
      { schema: { enum: ['a', 'b', 2] }, values: ['a', 'b', 2, 'c', 3] },
      { schema: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'number', minimum: 2 }] }, values: ['a', 'ab', 1, 2, false] },
      { schema: { $defs: { Id: { type: 'string', pattern: '^[a-z]+$' } }, $ref: '#/$defs/Id' }, values: ['valid', 'NOT-VALID', 1] },
      { schema: { type: ['string', 'null'], minLength: 2 }, values: [null, 'a', 'ab', 2] },
    ];

    for (const { schema, values } of fixtures) {
      const result = jsonSchemaToZod(schema);
      const generated = new Function('z', `${result.code}\nreturn schema;`)(z);
      const reference = z.fromJSONSchema(schema as any);
      for (const value of values) {
        const expected = reference.safeParse(value).success;
        expect(result.schema.safeParse(value).success, `${JSON.stringify(schema)} runtime: ${JSON.stringify(value)}`).toBe(expected);
        expect(generated.safeParse(value).success, `${JSON.stringify(schema)} generated: ${JSON.stringify(value)}`).toBe(expected);
      }
    }
  });
  it('S-50: produces deterministic Engine ② code, warnings, overlays, and runtime serialization', () => {
    const source = {
      $defs: { Name: { type: 'string', minLength: 2 } },
      type: 'object',
      properties: {
        name: { $ref: '#/$defs/Name' },
        website: { type: 'string', format: 'url' },
        count: { type: 'integer', maximum: 10 },
      },
      required: ['name'],
      additionalProperties: false,
    };
    const original = structuredClone(source);

    const first = jsonSchemaToZod(source, { rootName: 'record' });
    const second = jsonSchemaToZod(structuredClone(source), { rootName: 'record' });

    expect({ code: second.code, warnings: second.warnings, overlays: second.overlays }).toEqual({
      code: first.code,
      warnings: first.warnings,
      overlays: first.overlays,
    });
    expect(zodToJsonSchema(second.schema, { $schema: false })).toEqual(zodToJsonSchema(first.schema, { $schema: false }));
    expect(source).toEqual(original);
  });
  it('reads JSON Schema from a .json file path', async () => {
    const directory = await temporaryDirectory('zopia-schema-');
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
    expect(result.overlays).toEqual([
      { at: '', set: { oneOf: source.oneOf, discriminator: source.discriminator }, remove: ['anyOf'] },
      { at: '/oneOf/0', remove: ['additionalProperties'] },
      { at: '/oneOf/1', remove: ['additionalProperties'] },
    ]);
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
