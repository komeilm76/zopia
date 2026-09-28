import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { generateApiDocsFiles, jsonSchemaToZod, manifestFileToOpenApi } from '../src';
import { join } from 'node:path';

const temporaryDirectory = useTemporaryDirectories();

describe('native record object conversion (D-22)', () => {
  it('S-86: converts propertyNames + additionalProperties records without warnings or overlays', () => {
    const result = jsonSchemaToZod({ type: 'object', propertyNames: { type: 'string', pattern: '^x[0-9]+$' }, additionalProperties: { type: 'number' } });
    expect(result.code).toBe('const schema = z.record(z.string().regex(new RegExp("^x[0-9]+$")), z.number());\n');
    expect(result.warnings).toEqual([]);
    expect(result.overlays).toEqual([]);
    expect(result.schema.safeParse({ x1: 1 }).success).toBe(true);
    expect(result.schema.safeParse({ y: 1 }).success).toBe(false);
    expect(result.schema.safeParse({ x2: 'no' }).success).toBe(false);
  });

  it('S-86: supports length-constrained record keys', () => {
    const result = jsonSchemaToZod({ type: 'object', propertyNames: { type: 'string', minLength: 2, maxLength: 4 }, additionalProperties: { type: 'boolean' } });
    expect(result.code).toBe('const schema = z.record(z.string().min(2).max(4), z.boolean());\n');
    expect(result.warnings).toEqual([]);
    expect(result.overlays).toEqual([]);
    expect(result.schema.safeParse({ ab: true }).success).toBe(true);
    expect(result.schema.safeParse({ a: true }).success).toBe(false);
    expect(result.schema.safeParse({ abcde: true }).success).toBe(false);
  });

  it('S-86: keeps non-native propertyNames forms on the frozen refinement path', () => {
    const variants: Array<{ label: string; schema: Record<string, unknown> }> = [
      { label: 'implicit-type propertyNames', schema: { type: 'object', propertyNames: { pattern: '^[a-z]+$' }, additionalProperties: { type: 'number' } } },
      { label: 'annotation-carrying propertyNames', schema: { type: 'object', propertyNames: { type: 'string', pattern: '^[a-z]+$', title: 'key' }, additionalProperties: { type: 'number' } } },
      { label: 'enum propertyNames', schema: { type: 'object', propertyNames: { type: 'string', enum: ['a'] }, additionalProperties: { type: 'number' } } },
      { label: 'union propertyNames', schema: { type: 'object', propertyNames: { anyOf: [{ type: 'string' }] }, additionalProperties: { type: 'number' } } },
      { label: 'degenerate propertyNames', schema: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: { type: 'number' } } },
      { label: 'declared properties', schema: { type: 'object', propertyNames: { type: 'string', pattern: '^[a-z]+$' }, properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } } },
      { label: 'closed additionalProperties', schema: { type: 'object', propertyNames: { type: 'string', pattern: '^[a-z]+$' }, additionalProperties: false } },
      { label: 'required keys', schema: { type: 'object', propertyNames: { type: 'string', pattern: '^[a-z]+$' }, required: ['a'], additionalProperties: { type: 'number' } } },
      { label: 'property count bounds', schema: { type: 'object', propertyNames: { type: 'string', pattern: '^[a-z]+$' }, minProperties: 1, additionalProperties: { type: 'number' } } },
      { label: 'invalid key pattern', schema: { type: 'object', propertyNames: { type: 'string', pattern: '[' }, additionalProperties: { type: 'number' } } },
    ];
    for (const variant of variants) {
      const result = jsonSchemaToZod(variant.schema as any);
      expect(result.warnings, variant.label).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_FROZEN_SUBTREE' }));
      expect(result.overlays.some((overlay) => Object.prototype.hasOwnProperty.call(overlay, 'node')), variant.label).toBe(true);
      expect(result.code, variant.label).not.toContain('z.record(');
    }
  });

  it('S-86: round-trips native record component schemas verbatim through engines ③ and ④', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Records', version: '1' },
      components: {
        schemas: {
          ScoreBoard: { type: 'object', propertyNames: { type: 'string', pattern: '^team-[a-z]+$' }, additionalProperties: { type: 'integer', minimum: 0 } },
        },
      },
      paths: {
        '/scores': {
          get: { operationId: 'scores', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScoreBoard' } } } } } },
        },
      },
    }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const warnings: Array<{ code: string }> = [];
    const document = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'), { onWarning: (warning) => warnings.push(warning) }) as any;
    expect(warnings).toEqual([]);
    expect(document.components.schemas.ScoreBoard).toEqual({ type: 'object', propertyNames: { type: 'string', pattern: '^team-[a-z]+$' }, additionalProperties: { type: 'integer', minimum: 0 } });
  });

  it('S-86: round-trips implicit-type propertyNames through the frozen overlay instead', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Frozen', version: '1' },
      components: { schemas: { Loose: { type: 'object', propertyNames: { maxLength: 8 }, additionalProperties: { type: 'string' } } } },
      paths: {},
    }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const document = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(document.components.schemas.Loose).toEqual({ type: 'object', propertyNames: { maxLength: 8 }, additionalProperties: { type: 'string' } });
  });
});
