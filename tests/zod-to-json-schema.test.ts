import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../src';

describe('zodToJsonSchema', () => {
  it('converts a Zod 4 schema', () => {
    expect(zodToJsonSchema(z.object({ id: z.string().uuid() }), { target: 'draft-07' })).toMatchObject({ type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] });
  });
  it('supports OpenAPI 3.0 and explicit dialect output', () => {
    expect(zodToJsonSchema(z.string(), { target: 'openapi-3.0', $schema: true })).toEqual({ type: 'string', '$schema': 'http://json-schema.org/draft-07/schema#' });
  });
  it('uses JSON Schema 2020-12 shapes for OpenAPI 3.1', () => {
    expect(zodToJsonSchema(z.string(), { target: 'openapi-3.1', $schema: true })).toHaveProperty('$schema', 'http://json-schema.org/draft-07/schema#');
    expect(zodToJsonSchema(z.tuple([z.string(), z.number()]), { target: 'openapi-3.1' })).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: false,
    });
  });
  it('supports input mode', () => {
    expect(zodToJsonSchema(z.object({ value: z.string().default('x') }), { io: 'input' }).required).toBeUndefined();
  });
});
