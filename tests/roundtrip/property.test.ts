import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, manifestFileToOpenApi, openApiToApiDocs, zodToJsonSchema, type ZopiaGenerateOptions } from '../../src';
import { useTemporaryDirectories } from '../test-temporary-directories';

const fixtureDirectory = join(import.meta.dirname, '..', 'fixtures', 'specs');
const temporaryDirectory = useTemporaryDirectories('zopia-roundtrip-');

async function readFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(fixtureDirectory, name), 'utf8')) as Record<string, unknown>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

async function treeSnapshot(root: string, directory = root): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await treeSnapshot(root, path));
    else if (entry.isFile()) snapshot[path.slice(root.length + 1).replace(/\\/g, '/')] = await readFile(path, 'utf8');
  }
  return Object.fromEntries(Object.entries(snapshot).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

describe('round-trip contract', () => {
  const fixtures = [
    'admin-api-2.0.json',
    'admin-api-3.0.json',
    'cookies-3.0.json',
    'cycle-comment.json',
    'formdata-2.0.json',
    'km-api-contract-3.1.json',
    'nested-refs.json',
    'path-item-ref-3.1.json',
    'petstore-mini-3.1.json',
    'unsupported-keywords.json',
  ];
  const cases: Array<{ fixture: string; label: string; options?: ZopiaGenerateOptions; scenarios?: string[] }> = [
    ...fixtures.map((fixture) => ({
      fixture,
      label: 'directory/default',
      scenarios: {
        'admin-api-2.0.json': ['S-01'],
        'admin-api-3.0.json': ['S-06', 'S-14', 'S-61'],
        'cookies-3.0.json': ['S-04'],
        'petstore-mini-3.1.json': ['S-05'],
        'unsupported-keywords.json': ['S-46'],
      }[fixture] ?? [],
    })),
    { fixture: 'admin-api-3.0.json', label: 'flat', options: { mode: 'flat' }, scenarios: ['S-62'] },
    { fixture: 'admin-api-3.0.json', label: 'components/inlined', options: { insertComponents: true } },
    { fixture: 'admin-api-3.0.json', label: 'flat/components-inlined', options: { mode: 'flat', insertComponents: true } },
    { fixture: 'admin-api-3.0.json', label: 'flat/components-references', options: { mode: 'flat', insertComponents: true, useComponentAsReference: true }, scenarios: ['S-63'] },
    { fixture: 'admin-api-2.0.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'admin-api-3.0.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true }, scenarios: ['S-63'] },
    { fixture: 'cycle-comment.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'nested-refs.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'unsupported-keywords.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true }, scenarios: ['S-46'] },
  ];

  for (const { fixture, label, options, scenarios = [] } of cases) {
    it(`S-35/${scenarios.length ? `${scenarios.join('/')}/` : ''}T-11: reproduces ${fixture} in ${label} mode after canonicalization`, async () => {
      const source = await readFixture(fixture);
      const outputDirectory = await temporaryDirectory();
      const regeneratedDirectory = await temporaryDirectory();

      await openApiToApiDocs(source, { ...options, outDir: outputDirectory });
      const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'));
      await openApiToApiDocs(reversed, { ...options, outDir: regeneratedDirectory });

      expect(canonicalize(reversed), `${basename(fixture)} (${label})`).toEqual(canonicalize(source));
      expect(await treeSnapshot(regeneratedDirectory), `${basename(fixture)} (${label}) regenerated tree`).toEqual(await treeSnapshot(outputDirectory));
    });
  }

  it.each([
    { label: 'Swagger definitions', source: { swagger: '2.0', info: { title: 'Empty Swagger schemas', version: '1' }, definitions: {}, paths: {} } },
    { label: 'OpenAPI schemas', source: { openapi: '3.1.0', info: { title: 'Empty OpenAPI schemas', version: '1' }, components: { schemas: {} }, paths: {} } },
  ])('T-10: preserves explicitly empty $label containers', async ({ source }) => {
    const outputDirectory = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir: outputDirectory });
    const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'));
    expect(canonicalize(reversed)).toEqual(canonicalize(source));
  });

  it('T-10: preserves absent Swagger body optionality with an unconstrained schema', async () => {
    const source = {
      swagger: '2.0', info: { title: 'Optional legacy body', version: '1' },
      definitions: { Tuple: { type: 'array', items: [{ type: 'string' }], additionalItems: false } },
      paths: { '/legacy': { post: {
        parameters: [{ name: 'body', in: 'body', schema: {} }],
        responses: { '200': { description: 'ok', examples: { 'application/json': { ok: true } } } },
      } } },
    };
    const outputDirectory = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir: outputDirectory, insertComponents: true });
    const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'));
    expect(canonicalize(reversed)).toEqual(canonicalize(source));
  });

  it('T-10: preserves empty Path Items, boolean schemas, and schema-less media types', async () => {
    const source = {
      openapi: '3.1.0',
      info: { title: 'Manifest edge shapes', version: '1' },
      components: { schemas: {
        Always: true,
        Never: false,
        BooleanChildren: { type: 'object', properties: { anything: true, impossible: false }, additionalProperties: true },
        ClosedArray: { type: 'array', items: false },
        EmptyRequired: { type: 'object', properties: {}, required: [] },
        LocalDefinitions: { type: 'object', $defs: { Unused: { type: 'string' } }, properties: {} },
        UntypedEnum: { enum: ['ready', 'done'] },
        ConstrainedEnum: { type: 'string', enum: ['ready', 'done'], minLength: 4, default: 'ready' },
      } },
      paths: {
        '/empty': {},
        '/media': { post: {
          parameters: [{ name: 'filter', in: 'query', content: { 'application/json': { schema: true, example: 'all' } } }],
          requestBody: { required: true, content: { 'application/json': { example: { accepted: true } } } },
          responses: { '200': { description: 'schema-less', content: { 'application/json': { example: { ok: true } } } } },
        } },
      },
    };
    const outputDirectory = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir: outputDirectory, insertComponents: true });
    const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'));
    expect(canonicalize(reversed)).toEqual(canonicalize(source));
  });

  it('T-10: preserves explicit false schema keywords in OpenAPI 3.0', async () => {
    const source = {
      openapi: '3.0.3', info: { title: 'False schema keywords', version: '1' },
      components: { schemas: { Maybe: { type: 'string', nullable: false }, Bound: { type: 'number', minimum: 0, exclusiveMinimum: false } } },
      paths: { '/value': { get: {
        parameters: [{ name: 'value', in: 'query', schema: { type: 'string', nullable: false } }],
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'number', minimum: 0, exclusiveMinimum: false } } } } },
      } } },
    };
    const outputDirectory = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir: outputDirectory, insertComponents: true });
    const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'));
    expect(canonicalize(reversed)).toEqual(canonicalize(source));
  });

  it('R-658: translates Swagger path-item metadata when selecting OpenAPI output', async () => {
    const source = await readFixture('admin-api-2.0.json');
    const outputDirectory = await temporaryDirectory();

    await openApiToApiDocs(source, { outDir: outputDirectory });
    const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'), { version: '3.1' }) as any;
    const pathParameter = reversed.paths['/users/{userId}'].parameters[0];

    expect(reversed).toMatchObject({ openapi: '3.1.0' });
    expect(reversed.swagger).toBeUndefined();
    expect(reversed.definitions).toBeUndefined();
    expect(pathParameter).toEqual({ name: 'userId', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } });
    expect(reversed.paths['/users/{userId}'].get.parameters[0].$ref).toBe('#/components/parameters/TraceId');
  });

  it('R-658: materializes a path-item reference when OpenAPI 3.0 omits pathItems components', async () => {
    const source = await readFixture('path-item-ref-3.1.json');
    const outputDirectory = await temporaryDirectory();
    const warnings: Array<{ code: string; at?: string }> = [];

    await openApiToApiDocs(source, { outDir: outputDirectory });
    const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'), { version: '3.0', onWarning: (warning) => warnings.push(warning) }) as any;

    expect(reversed.openapi).toBe('3.0.0');
    expect(reversed.components?.pathItems).toBeUndefined();
    expect(reversed.paths['/health'].$ref).toBeUndefined();
    expect(reversed.paths['/health'].get.operationId).toBe('sharedHealth');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/components/pathItems' }));
  });

  it('R-409: regenerating identical input produces a byte-identical tree', async () => {
    const source = await readFixture('admin-api-3.0.json');
    const outputDirectory = await temporaryDirectory();

    await openApiToApiDocs(source, { outDir: outputDirectory, insertComponents: true, useComponentAsReference: true });
    const first = await treeSnapshot(outputDirectory);
    const result = await openApiToApiDocs(source, { outDir: outputDirectory, insertComponents: true, useComponentAsReference: true });

    expect(result.warnings.some((warning) => warning.code === 'ZOPIA_WARN_STALE_TREE')).toBe(false);
    expect(await treeSnapshot(outputDirectory)).toEqual(first);
  });

  it('S-67/R-409: reverse output regenerates the same byte-identical tree', async () => {
    const source = await readFixture('admin-api-3.0.json');
    const firstDirectory = await temporaryDirectory();
    const secondDirectory = await temporaryDirectory();
    const options = { insertComponents: true, useComponentAsReference: true } as const;

    await openApiToApiDocs(source, { ...options, outDir: firstDirectory });
    const reversed = await manifestFileToOpenApi(join(firstDirectory, '.zopia-manifest.json'));
    await openApiToApiDocs(reversed, { ...options, outDir: secondDirectory });

    expect(await treeSnapshot(secondDirectory)).toEqual(await treeSnapshot(firstDirectory));
  });

  it('R-409: reverse regeneration preserves source-order-sensitive collision plans', async () => {
    const response = { responses: { '200': { description: 'ok' } } };
    const source = {
      openapi: '3.1.0', info: { title: 'Collision stability', version: '1' },
      paths: {
        '/users': { get: { ...response, operationId: 'users' } },
        '/users/get/details': { post: { ...response, operationId: 'details' } },
        '/empty': {},
      },
    };
    const firstDirectory = await temporaryDirectory();
    const secondDirectory = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir: firstDirectory });
    const reversed = await manifestFileToOpenApi(join(firstDirectory, '.zopia-manifest.json'));
    await openApiToApiDocs(reversed, { outDir: secondDirectory });
    expect(await treeSnapshot(secondDirectory)).toEqual(await treeSnapshot(firstDirectory));
  });

  it('T-10: the spec-clean canonical fixture needs no operation restorations', async () => {
    const source = await readFixture('admin-api-3.0.json');
    const outputDirectory = await temporaryDirectory();

    await openApiToApiDocs(source, { outDir: outputDirectory });
    const manifest = JSON.parse(await readFile(join(outputDirectory, '.zopia-manifest.json'), 'utf8')) as { apis: Array<{ overlay: unknown[] }> };

    expect(manifest.apis.every((api) => api.overlay.length === 0)).toBe(true);
  });

  it('T-11: supported Zod schemas converge through JSON Schema and back', () => {
    const recursive: z.ZodType = z.lazy(() => z.object({ value: z.string(), children: z.array(recursive).optional() }));
    const schemas = [
      z.object({ id: z.uuid(), email: z.email(), count: z.number().int().min(0), nickname: z.string().nullable().optional() }).strict(),
      z.array(z.string().min(1)).min(1).max(5),
      z.union([z.literal('ready'), z.literal('done'), z.literal(7)]),
      z.enum(['ready', 'done']),
      z.tuple([z.string(), z.number().int()]).rest(z.boolean()),
      z.record(z.string(), z.number()),
      z.never(),
      recursive,
    ];

    for (const schema of schemas) {
      const first = zodToJsonSchema(schema, { target: 'openapi-3.1', $schema: false });
      const second = zodToJsonSchema(jsonSchemaToZod(first).schema, { target: 'openapi-3.1', $schema: false });
      const third = zodToJsonSchema(jsonSchemaToZod(second).schema, { target: 'openapi-3.1', $schema: false });
      expect(canonicalize(second)).toEqual(canonicalize(first));
      expect(canonicalize(third)).toEqual(canonicalize(second));
    }
  });
});
