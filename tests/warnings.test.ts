import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiDocsToOpenApi, generateApiDocsFiles, jsonSchemaToZod, manifestToOpenApi, ZOPIA_WARNING_CODES, type ZopiaWarning } from '../src';
import {
  formatZopiaWarning,
  formatZopiaWarningComment,
  normalizeZopiaWarnings,
  rebaseZopiaWarning,
  ZopiaWarningCollector,
} from '../src/warnings';

describe('warnings pipeline', () => {
  it('validates, sanitizes, deduplicates, and sorts structured warnings deterministically', () => {
    const inputs: ZopiaWarning[] = [
      { code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'second\nline' },
      { code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/components/schemas/A', message: 'custom format' },
      { code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'second\r\nline' },
    ];
    expect(normalizeZopiaWarnings(inputs)).toEqual([
      { code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/components/schemas/A', message: 'custom format' },
      { code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'second line' },
    ]);
    expect(inputs[0].message).toContain('\n');
    expect(ZOPIA_WARNING_CODES).toContain('ZOPIA_WARN_DEFAULT_SECURITY');
    expect(() => normalizeZopiaWarnings([{ code: 'ZOPIA_WARN_UNKNOWN', message: 'bad' } as any])).toThrow('Unknown zopia warning code');
  });

  it('source-locates dynamic warnings in nested JSON Schema children without suppressing siblings', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      properties: {
        alpha: { type: 'string', format: 'alpha-custom' },
        beta: { type: 'string', format: 'beta-custom' },
        nested: { type: 'array', items: { type: 'string', pattern: 42 } },
      },
    } as any);

    expect(result.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_CUSTOM_FORMAT').map((warning) => warning.at)).toEqual([
      '#/properties/alpha',
      '#/properties/beta',
    ]);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZOPIA_WARN_INVALID_SCHEMA',
      at: '#/properties/nested/items',
    }));
    expect(result.code).toContain('ZOPIA_WARN_CUSTOM_FORMAT format');
    expect(result.code).toContain('`alpha-custom`');
    expect(result.code).toContain('`beta-custom`');
    expect(result.code).toContain('ZOPIA_WARN_INVALID_SCHEMA pattern');
    expect(result.code).toContain('(#/properties/nested/items)');
  });

  it('rebases pointers and shares canonical generated-code and stderr formatting', () => {
    const warning: ZopiaWarning = { code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/properties/a', message: 'line one\nline two' };
    const rebased = rebaseZopiaWarning(warning, '#/components/schemas/Thing');
    expect(rebased.at).toBe('#/components/schemas/Thing/properties/a');
    expect(formatZopiaWarning(rebased)).toBe('ZOPIA_WARN_CUSTOM_FORMAT #/components/schemas/Thing/properties/a: line one line two');
    expect(formatZopiaWarningComment(rebased, 'format\nname')).toBe('// @zopia:warn ZOPIA_WARN_CUSTOM_FORMAT format name — line one line two (#/components/schemas/Thing/properties/a)');

    const collector = new ZopiaWarningCollector();
    collector.add(warning); collector.add(warning);
    collector.addRebased([{ code: 'ZOPIA_WARN_INT64', at: '#', message: 'int64 overlay' }], '#/components/schemas/Id');
    expect(collector.toArray()).toHaveLength(2);
  });

  it('collects reverse runtime-schema and default-security warnings with exact output pointers', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-warnings-'));
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Warnings', version: '1' },
      paths: { '/events': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } } } } },
    }, { outputDir });
    const endpoint = join(outputDir, 'events', 'get', 'index.ts');
    const generated = await readFile(endpoint, 'utf8');
    await writeFile(endpoint, generated.replace('auth: "NO"', 'auth: "YES"').replace('200: z.string()', '200: z.date()'), 'utf8');

    const callbackWarnings: ZopiaWarning[] = [];
    const result = await apiDocsToOpenApi(outputDir, { version: '3.1', onWarning: (warning) => callbackWarnings.push(warning) });
    expect(result.warnings).toEqual(callbackWarnings);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ZOPIA_WARN_DEFAULT_SECURITY', at: '#/paths/~1events/get/security' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_UNREPRESENTABLE', at: '#/paths/~1events/get/responses/200/content/schema' }),
    ]));
    expect((result.openapi as any).paths['/events'].get.security).toEqual([{ bearerAuth: [] }]);
    expect((result.openapi as any).components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' });
  });

  it('rebases edited component serialization losses to component output pointers', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-warnings-'));
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Components', version: '1' },
      components: { schemas: { BirthDate: { type: 'string' } } },
      paths: { '/birth': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/BirthDate' } } } } } } } },
    }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const component = join(outputDir, 'components', 'BirthDate', 'index.ts');
    const generated = await readFile(component, 'utf8');
    await writeFile(component, generated.replace('z.string()', 'z.date()'), 'utf8');

    const result = await apiDocsToOpenApi(outputDir);

    expect(result.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_UNREPRESENTABLE').map((warning) => warning.at)).toEqual([
      '#/components/schemas/BirthDate',
    ]);
  });

  it('warns when legacy manifests require info fallbacks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-warnings-'));
    const manifestFile = join(directory, '.zopia-manifest.json');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1' }, apis: [] }), 'utf8');

    const result = await apiDocsToOpenApi(directory);
    expect((result.openapi as any).info).toEqual({ title: 'Zopia API', version: '0.0.0' });
    expect(result.warnings).toEqual([
      { code: 'ZOPIA_WARN_DEFAULT_INFO', at: '#/info/title', message: 'manifest source title is missing; using Zopia API' },
      { code: 'ZOPIA_WARN_DEFAULT_INFO', at: '#/info/version', message: 'manifest source version is missing; using 0.0.0' },
    ]);
  });

  it('reports facts omitted by an OpenAPI 3.1 to 3.0 downgrade', () => {
    const warnings: ZopiaWarning[] = [];
    const output = manifestToOpenApi({
      $schema: 'zopia:manifest@1',
      source: { kind: 'openapi-3.1', title: 'Downgrade', version: '1' },
      documentOverlay: { webhooks: { event: {} }, jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema' },
      componentsOverlay: { pathItems: { Shared: {} } },
      apis: [],
    }, { version: '3.0', onWarning: (warning) => warnings.push(warning) }) as any;

    expect(output.webhooks).toBeUndefined();
    expect(output.jsonSchemaDialect).toBeUndefined();
    expect(output.components?.pathItems).toBeUndefined();
    expect(warnings.map((warning) => warning.code)).toEqual([
      'ZOPIA_WARN_DIALECT_DOWNGRADE',
      'ZOPIA_WARN_DIALECT_DOWNGRADE',
      'ZOPIA_WARN_WEBHOOKS',
    ]);
  });
});
