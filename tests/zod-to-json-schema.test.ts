import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, type ZopiaWarning } from '../src';

describe('zodToJsonSchema', () => {
  it('defaults to OpenAPI 3.1 with its JSON Schema 2020-12 dialect marker', () => {
    expect(zodToJsonSchema(z.string())).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'string',
    });
  });

  it('emits dialect markers by default and removes them when requested', () => {
    expect(zodToJsonSchema(z.string(), { target: 'openapi-3.0' })).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'string',
    });
    expect(zodToJsonSchema(z.string(), { target: 'draft-07' })).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'string',
    });
    expect(zodToJsonSchema(z.string(), { target: 'openapi-3.1', $schema: false })).toEqual({ type: 'string' });
  });

  it('uses each target dialect nullability and tuple shape', () => {
    expect(zodToJsonSchema(z.string().nullable(), { target: 'openapi-3.1', $schema: false })).toEqual({
      type: ['string', 'null'],
    });
    expect(zodToJsonSchema(z.string().nullable(), { target: 'openapi-3.0', $schema: false })).toEqual({
      type: 'string',
      nullable: true,
    });
    expect(zodToJsonSchema(z.tuple([z.string(), z.number()]), { target: 'openapi-3.1', $schema: false })).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: false,
      minItems: 2,
      maxItems: 2,
    });
  });

  it('preserves metadata verbatim without letting metadata ids extract definitions', () => {
    const schema = z.object({
      nested: z.string().meta({ id: 'Nested', title: 'Nested title', 'x-note': { keep: true } }),
    }).meta({
      id: 'Root',
      title: 'Root title',
      description: 'Root description',
      examples: [{ nested: 'value' }],
      'x-owner': 'zopia',
    });

    const converted = zodToJsonSchema(schema, { $schema: false });
    expect(converted).toMatchObject({
      type: 'object',
      properties: {
        nested: { type: 'string', title: 'Nested title', 'x-note': { keep: true } },
      },
      title: 'Root title',
      description: 'Root description',
      examples: [{ nested: 'value' }],
      'x-owner': 'zopia',
    });
    expect(converted).not.toHaveProperty('id');
    expect(converted).not.toHaveProperty('$ref');
    expect(converted).not.toHaveProperty('$defs');
    expect(converted.properties).not.toHaveProperty('nested.id');
  });

  it('keeps recursive schemas representable with definitions and references', () => {
    let category: z.ZodType;
    category = z.object({
      name: z.string(),
      children: z.array(z.lazy(() => category)),
    });

    const converted = zodToJsonSchema(z.object({ category }), { $schema: false });
    expect(converted).toMatchObject({
      type: 'object',
      properties: { category: { $ref: '#/$defs/__schema0' } },
      $defs: {
        __schema0: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/$defs/__schema0' } },
          },
        },
      },
    });
  });

  it.each([
    ['bigint', z.bigint()],
    ['int64', z.int64()],
    ['symbol', z.symbol()],
    ['undefined', z.undefined()],
    ['void', z.void()],
    ['date', z.date()],
    ['map', z.map(z.string(), z.string())],
    ['set', z.set(z.string())],
    ['function', z.function()],
    ['transform', z.string().transform((value) => value.length)],
    ['nan', z.nan()],
    ['custom', z.custom()],
    ['multipleOf(0)', z.number().multipleOf(0)],
  ])('converts unrepresentable %s schemas to an empty schema plus a warning', (_name, schema) => {
    const warnings: ZopiaWarning[] = [];
    expect(zodToJsonSchema(schema, { $schema: false, onWarning: (warning) => warnings.push(warning) })).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'ZOPIA_WARN_UNREPRESENTABLE' });
    expect(warnings[0]?.message).toBeTruthy();
  });

  it.each([
    ['bigint literal', z.literal(1n)],
    ['bigint default', z.string().default(1n as never)],
    ['dynamic catch', z.string().catch(() => { throw new Error('dynamic'); })],
    ['symbol object key', z.object({ [Symbol('secret')]: z.string() } as any)],
  ])('handles the unrepresentable %s callback site without throwing', (_name, schema) => {
    const warnings: ZopiaWarning[] = [];
    expect(zodToJsonSchema(schema, { $schema: false, onWarning: (warning) => warnings.push(warning) })).toEqual({});
    expect(warnings).toEqual([expect.objectContaining({ code: 'ZOPIA_WARN_UNREPRESENTABLE' })]);
  });

  it('reports an escaped JSON Pointer for nested unrepresentable schemas', () => {
    const warnings: ZopiaWarning[] = [];
    expect(zodToJsonSchema(
      z.object({ 'a/b~c': z.array(z.bigint()) }),
      { $schema: false, onWarning: (warning) => warnings.push(warning) },
    )).toEqual({
      type: 'object',
      properties: { 'a/b~c': { type: 'array', items: {} } },
      required: ['a/b~c'],
      additionalProperties: false,
    });
    expect(warnings).toEqual([expect.objectContaining({
      code: 'ZOPIA_WARN_UNREPRESENTABLE',
      at: '#/properties/a~1b~0c/items',
    })]);
  });

  it('uses the representable input side of a transform without warning', () => {
    const warnings: ZopiaWarning[] = [];
    expect(zodToJsonSchema(z.string().transform((value) => value.length), {
      io: 'input',
      $schema: false,
      onWarning: (warning) => warnings.push(warning),
    })).toEqual({ type: 'string' });
    expect(warnings).toEqual([]);
  });

  it('uses input semantics for defaulted request properties', () => {
    expect(zodToJsonSchema(z.object({ value: z.string().default('x') }), {
      io: 'input',
      $schema: false,
    })).toEqual({
      type: 'object',
      properties: { value: { type: 'string', default: 'x' } },
    });
  });

  it('preserves record key and value constraints', () => {
    expect(zodToJsonSchema(z.record(z.string().min(2), z.number().positive()), { $schema: false })).toEqual({
      type: 'object',
      additionalProperties: { type: 'number', exclusiveMinimum: 0 },
      propertyNames: { type: 'string', minLength: 2 },
    });
  });

  it('sorts schema keywords canonically while preserving property order', () => {
    const converted = zodToJsonSchema(z.object({
      second: z.string().min(1).describe('Second'),
      first: z.uuid(),
    }).meta({ zeta: true, alpha: true }).describe('Root'), { target: 'draft-07' });

    expect(Object.keys(converted)).toEqual([
      '$schema',
      'type',
      'properties',
      'required',
      'additionalProperties',
      'description',
      'alpha',
      'zeta',
    ]);
    expect(Object.keys(converted.properties as object)).toEqual(['second', 'first']);
    expect(Object.keys((converted.properties as Record<string, Record<string, unknown>>).second)).toEqual([
      'type',
      'minLength',
      'description',
    ]);
    expect(Object.keys((converted.properties as Record<string, Record<string, unknown>>).first)).toEqual([
      'type',
      'format',
    ]);
    expect(JSON.stringify(zodToJsonSchema(z.uuid()))).toBe(JSON.stringify(zodToJsonSchema(z.uuid())));
  });

  it.each([
    ['uuid', z.uuid()],
    ['email', z.email()],
    ['hostname', z.hostname()],
    ['ipv4', z.ipv4()],
    ['ipv6', z.ipv6()],
    ['date-time', z.iso.datetime()],
    ['date', z.iso.date()],
    ['duration', z.iso.duration()],
    ['uri', z.url()],
  ])('strips the redundant built-in %s format pattern', (format, schema) => {
    expect(zodToJsonSchema(schema, { $schema: false })).toEqual({ type: 'string', format });
  });

  it('strips companion patterns from chained built-in format checks', () => {
    expect(zodToJsonSchema(z.string().uuid(), { $schema: false })).toEqual({ type: 'string', format: 'uuid' });
    expect(zodToJsonSchema(z.string().email(), { $schema: false })).toEqual({ type: 'string', format: 'email' });
  });

  it('keeps custom patterns even when metadata supplies a known format', () => {
    expect(zodToJsonSchema(z.string().regex(/^custom$/).meta({ format: 'email' }), { $schema: false })).toEqual({
      type: 'string',
      format: 'email',
      pattern: '^custom$',
    });
  });

  it('strips safe-integer sentinel bounds independently while retaining real bounds', () => {
    expect(zodToJsonSchema(z.number().int(), { $schema: false })).toEqual({ type: 'integer' });
    expect(zodToJsonSchema(z.number().int().min(-100), { $schema: false })).toEqual({
      type: 'integer',
      minimum: -100,
    });
    expect(zodToJsonSchema(z.number().int().max(100), { $schema: false })).toEqual({
      type: 'integer',
      maximum: 100,
    });
  });
});
