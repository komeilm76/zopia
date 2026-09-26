import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, manifestFileToOpenApi, openApiToApiDocs, zodToJsonSchema, type ZopiaGenerateOptions } from '../../src';

const fixtureDirectory = join(import.meta.dirname, '..', 'fixtures', 'specs');
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zopia-roundtrip-'));
  temporaryDirectories.push(directory);
  return directory;
}

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
  return Object.fromEntries(Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right)));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('round-trip contract', () => {
  const fixtures = [
    'admin-api-2.0.json',
    'admin-api-3.0.json',
    'cookies-3.0.json',
    'cycle-comment.json',
    'formdata-2.0.json',
    'nested-refs.json',
    'path-item-ref-3.1.json',
    'petstore-mini-3.1.json',
    'unsupported-keywords.json',
  ];
  const cases: Array<{ fixture: string; label: string; options?: ZopiaGenerateOptions }> = [
    ...fixtures.map((fixture) => ({ fixture, label: 'directory/default' })),
    { fixture: 'admin-api-3.0.json', label: 'flat', options: { mode: 'flat' } },
    { fixture: 'admin-api-3.0.json', label: 'components/inlined', options: { insertComponents: true } },
    { fixture: 'admin-api-3.0.json', label: 'flat/components-inlined', options: { mode: 'flat', insertComponents: true } },
    { fixture: 'admin-api-3.0.json', label: 'flat/components-references', options: { mode: 'flat', insertComponents: true, useComponentAsReference: true } },
    { fixture: 'admin-api-2.0.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'admin-api-3.0.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'cycle-comment.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'nested-refs.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
    { fixture: 'unsupported-keywords.json', label: 'components/references', options: { insertComponents: true, useComponentAsReference: true } },
  ];

  for (const { fixture, label, options } of cases) {
    it(`T-11: reproduces ${fixture} in ${label} mode after canonicalization`, async () => {
      const source = await readFixture(fixture);
      const outputDirectory = await temporaryDirectory();

      await openApiToApiDocs(source, { ...options, outDir: outputDirectory });
      const reversed = await manifestFileToOpenApi(join(outputDirectory, '.zopia-manifest.json'));

      expect(canonicalize(reversed), `${basename(fixture)} (${label})`).toEqual(canonicalize(source));
    });
  }

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

  it('R-409: reverse output regenerates the same byte-identical tree', async () => {
    const source = await readFixture('admin-api-3.0.json');
    const firstDirectory = await temporaryDirectory();
    const secondDirectory = await temporaryDirectory();
    const options = { insertComponents: true, useComponentAsReference: true } as const;

    await openApiToApiDocs(source, { ...options, outDir: firstDirectory });
    const reversed = await manifestFileToOpenApi(join(firstDirectory, '.zopia-manifest.json'));
    await openApiToApiDocs(reversed, { ...options, outDir: secondDirectory });

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
      z.tuple([z.string(), z.number().int()]).rest(z.boolean()),
      z.record(z.string(), z.number()),
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
