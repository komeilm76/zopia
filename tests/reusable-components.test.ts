/* Reusable parameters & responses (v0.2.x, D-18): reusable declarations become their own
 * component modules in components mode (`components/parameters/<Name>/index.ts`,
 * `components/responses/<Name>/index.ts` with `<Name>Parameter` / `<Name>Response` exports),
 * use sites import them through the kind barrels, manifest entries carry `kind`, and the
 * reverse conversion refreshes the declarations from the current modules while restoring
 * every use-site `$ref` verbatim from manifest placements. */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifestFileToOpenApi, openApiToApiDocs } from '../src';
import type { OpenApiDocument } from '../src/conversions/openapi';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories();

const readSpec = async (name: string): Promise<Record<string, any>> => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures/specs', name), 'utf8'));

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

async function treeFiles(root: string, directory = root, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await treeFiles(root, path, `${prefix}${entry.name}/`));
    else files.push(`${prefix}${entry.name}`);
  }
  return files.sort();
}

describe('S-81: reusable parameters and responses generate their own component modules', () => {
  it('emits parameter/response modules, kind barrels, imports, and manifest entries for OpenAPI 3.x', async () => {
    const outDir = await temporaryDirectory();
    await openApiToApiDocs(await readSpec('reusables-3.1.json'), { outDir, insertComponents: true, useComponentAsReference: true });

    expect(await treeFiles(outDir)).toEqual([
      '.zopia-manifest.json',
      'components/CursorToken/index.ts',
      'components/Widget/index.ts',
      'components/index.ts',
      // Reusable declarations become modules — declarations drive the set, including
      // the unused `Cursor`; schema-less `Empty` has nothing to centralize (z.void() at use sites).
      'components/parameters/Cursor/index.ts',
      'components/parameters/PageSize/index.ts',
      'components/parameters/ViaHeader/index.ts',
      'components/parameters/index.ts',
      'components/responses/NotFound/index.ts',
      'components/responses/index.ts',
      'widgets/get/index.ts',
    ]);

    // Modules hold the derived schema only: direct, cross-schema $ref, and chained-declaration forms.
    await expect(readFile(join(outDir, 'components/parameters/PageSize/index.ts'), 'utf8')).resolves.toContain('export const PageSizeParameter = z.number().int().min(1);');
    await expect(readFile(join(outDir, 'components/parameters/Cursor/index.ts'), 'utf8')).resolves.toContain('export const CursorParameter = z.lazy(() => CursorTokenSchema);');
    await expect(readFile(join(outDir, 'components/parameters/ViaHeader/index.ts'), 'utf8')).resolves.toContain('export const ViaHeaderParameter = z.lazy(() => CursorTokenSchema);');
    await expect(readFile(join(outDir, 'components/responses/NotFound/index.ts'), 'utf8')).resolves.toContain('export const NotFoundResponse = z.lazy(() => WidgetSchema);');

    // Kind barrels exist only because that kind has declarations.
    await expect(readFile(join(outDir, 'components/parameters/index.ts'), 'utf8')).resolves.toBe(
      'export { CursorParameter } from "./Cursor/index";\nexport { PageSizeParameter } from "./PageSize/index";\nexport { ViaHeaderParameter } from "./ViaHeader/index";\n');
    await expect(readFile(join(outDir, 'components/responses/index.ts'), 'utf8')).resolves.toBe('export { NotFoundResponse } from "./NotFound/index";\n');

    const endpoint = await readFile(join(outDir, 'widgets/get/index.ts'), 'utf8');
    // Bare-declaration $refs at use sites become kind-barrel imports; sibling-merged $refs
    // (`default` response) resolve inline exactly as before.
    expect(endpoint).toContain("import { PageSizeParameter, ViaHeaderParameter } from '../../components/parameters/index';");
    expect(endpoint).toContain("import { NotFoundResponse } from '../../components/responses/index';");
    expect(endpoint).toContain('["pageSize"]: PageSizeParameter.optional()');
    expect(endpoint).toContain('["cursor"]: ViaHeaderParameter.optional()');
    expect(endpoint).toContain('["verbose"]: z.boolean().optional()');
    expect(endpoint).toContain('404: NotFoundResponse');
    expect(endpoint).toContain('204: z.void()');
    expect(endpoint).toContain('"default": WidgetSchema');
    expect(endpoint).toContain('200: z.array(WidgetSchema)');

    // Manifest entries carry kind, file, and the derived schema snapshot; schema-less declarations
    // are absent, and the raw declarations stay authoritative in componentsOverlay.
    const manifest = JSON.parse(await readFile(join(outDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.components.map((component: any) => `${component.kind ?? 'schema'}:${component.name}:${component.file}`)).toEqual([
      'schema:CursorToken:components/CursorToken/index.ts',
      'schema:Widget:components/Widget/index.ts',
      'parameter:Cursor:components/parameters/Cursor/index.ts',
      'parameter:PageSize:components/parameters/PageSize/index.ts',
      'parameter:ViaHeader:components/parameters/ViaHeader/index.ts',
      'response:NotFound:components/responses/NotFound/index.ts',
    ]);
    expect(manifest.components.find((component: any) => component.kind === 'parameter' && component.name === 'PageSize').schema).toEqual({ type: 'integer', minimum: 1 });
    expect(manifest.components.find((component: any) => component.kind === 'response' && component.name === 'NotFound').schema).toEqual({ $ref: '#/components/schemas/Widget' });
  });

  it('emits body and formData parameter modules with a single file body slot for Swagger 2.0', async () => {
    const outDir = await temporaryDirectory();
    await openApiToApiDocs(await readSpec('reusables-2.0.json'), { outDir, insertComponents: true, useComponentAsReference: true });

    expect(await treeFiles(outDir)).toEqual([
      '.zopia-manifest.json',
      'components/index.ts',
      'components/parameters/FilterBody/index.ts',
      'components/parameters/Trace/index.ts',
      'components/parameters/Upload/index.ts',
      'components/parameters/index.ts',
      'components/responses/Problem/index.ts',
      'components/responses/index.ts',
      'reports/post/index.ts',
      'reports/put/index.ts',
    ]);

    const post = await readFile(join(outDir, 'reports/post/index.ts'), 'utf8');
    expect(post).toContain("import { FilterBodyParameter, TraceParameter } from '../../components/parameters/index';");
    expect(post).toContain("import { ProblemResponse } from '../../components/responses/index';");
    expect(post).toContain('body: FilterBodyParameter');
    expect(post).toContain('["X-Trace"]: TraceParameter.optional()');
    expect(post).toContain('422: ProblemResponse');
    expect(post).toContain('204: z.void()');

    // A bare-ref `in: formData` parameter substitutes its module export inside the synthesized body object.
    const put = await readFile(join(outDir, 'reports/put/index.ts'), 'utf8');
    expect(put).toContain("import { TraceParameter, UploadParameter } from '../../components/parameters/index';");
    expect(put).toContain('body: z.object({ ["file"]: UploadParameter, ["note"]: z.string().optional() }).passthrough()');
    expect(put).toContain('200: ProblemResponse');

    const manifest = JSON.parse(await readFile(join(outDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.components.map((component: any) => `${component.kind ?? 'schema'}:${component.name}:${component.file}`)).toEqual([
      'parameter:FilterBody:components/parameters/FilterBody/index.ts',
      'parameter:Trace:components/parameters/Trace/index.ts',
      'parameter:Upload:components/parameters/Upload/index.ts',
      'response:Problem:components/responses/Problem/index.ts',
    ]);
    expect(manifest.components.find((component: any) => component.kind === 'parameter' && component.name === 'Upload').schema).toEqual({ type: 'string', format: 'binary' });
  });

  it('emits no kind barrels for specs without reusable declarations', async () => {
    const outDir = await temporaryDirectory();
    await openApiToApiDocs(await readSpec('petstore-mini-3.1.json'), { outDir, insertComponents: true, useComponentAsReference: true });
    const files = await treeFiles(outDir);
    expect(files.some((file) => file === 'components/parameters/index.ts' || file === 'components/responses/index.ts')).toBe(false);
  });

  it('rejects invalid reusable containers in components mode while default mode still accepts the spec', async () => {
    const source = {
      openapi: '3.1.0', info: { title: 'Broken reusables', version: '1' },
      components: { parameters: 42 },
      paths: { '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } } },
    } as unknown as OpenApiDocument;
    await expect(openApiToApiDocs(JSON.parse(JSON.stringify(source)), { outDir: await temporaryDirectory(), insertComponents: true }))
      .rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', at: '#/components/parameters' });
    // Default mode does not invent reusable modules — the malformed container round-trips untouched.
    await openApiToApiDocs(source, { outDir: await temporaryDirectory() });
  });

  it('rejects undeclarable parameters and name collisions with the schema-component errors', async () => {
    const base = {
      openapi: '3.1.0', info: { title: 'Reusable collisions', version: '1' },
      components: {
        parameters: {
          Broken: { name: 'broken', in: 'query' },
        },
        responses: {},
      },
      paths: { '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } } },
    } as unknown as OpenApiDocument;
    await expect(openApiToApiDocs(JSON.parse(JSON.stringify(base)), { outDir: await temporaryDirectory(), insertComponents: true }))
      .rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', at: '#/components/parameters/Broken' });

    const colliding = {
      openapi: '3.1.0', info: { title: 'Reusable collisions', version: '1' },
      components: {
        parameters: {
          page: { name: 'page', in: 'query', schema: { type: 'integer' } },
          Page: { name: 'Page', in: 'query', schema: { type: 'integer' } },
        },
      },
      paths: { '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } } },
    } as unknown as OpenApiDocument;
    await expect(openApiToApiDocs(JSON.parse(JSON.stringify(colliding)), { outDir: await temporaryDirectory(), insertComponents: true }))
      .rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', message: expect.stringContaining('Duplicate zopia manifest file: components/parameters/page/index.ts') });

    const barrelShadow = {
      openapi: '3.1.0', info: { title: 'Reusable collisions', version: '1' },
      components: { parameters: { ['index.ts']: { name: 'page', in: 'query', schema: { type: 'integer' } } } },
      paths: { '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } } },
    } as unknown as OpenApiDocument;
    await expect(openApiToApiDocs(JSON.parse(JSON.stringify(barrelShadow)), { outDir: await temporaryDirectory(), insertComponents: true }))
      .rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', message: expect.stringContaining('collides with the barrel') });

    // Same name across kinds is legal: the exports carry distinct suffixes.
    const crossKind = {
      openapi: '3.1.0', info: { title: 'Reusable collisions', version: '1' },
      components: {
        schemas: { Trace: { type: 'string' } },
        parameters: { Trace: { name: 'x-trace', in: 'header', schema: { type: 'string' } } },
        responses: { Trace: { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } },
      },
      paths: { '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } } },
    } as unknown as OpenApiDocument;
    const outDir = await temporaryDirectory();
    await openApiToApiDocs(crossKind, { outDir, insertComponents: true, useComponentAsReference: true });
    expect(await treeFiles(outDir)).toEqual([
      '.zopia-manifest.json',
      'components/Trace/index.ts',
      'components/index.ts',
      'components/parameters/Trace/index.ts',
      'components/parameters/index.ts',
      'components/responses/Trace/index.ts',
      'components/responses/index.ts',
      'ok/get/index.ts',
    ]);
  });
});

describe('S-82: reusable parameters and responses round-trip through the manifest', () => {
  for (const spec of ['reusables-3.1.json', 'reusables-2.0.json'] as const) {
    it(`reproduces ${spec} after canonicalization`, async () => {
      const source = await readSpec(spec);
      const outDir = await temporaryDirectory();
      await openApiToApiDocs(source, { outDir, insertComponents: true, useComponentAsReference: true });
      const reversed = await manifestFileToOpenApi(join(outDir, '.zopia-manifest.json'));
      expect(canonicalize(reversed)).toEqual(canonicalize(source));
    });
  }

  it('refreshes an edited parameter module while the use site stays a verbatim $ref', async () => {
    const source = await readSpec('reusables-3.1.json');
    const outDir = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir, insertComponents: true, useComponentAsReference: true });
    const module = join(outDir, 'components/parameters/PageSize/index.ts');
    await writeFile(module, (await readFile(module, 'utf8')).replace('.min(1)', '.min(5)'));

    const reversed: any = await manifestFileToOpenApi(join(outDir, '.zopia-manifest.json'));
    expect(reversed.components.parameters.PageSize.schema).toEqual({ type: 'integer', minimum: 5 });
    // The chained declaration remains a declaration chain — its schema derives through `Cursor`.
    expect(reversed.components.parameters.ViaHeader).toEqual({ $ref: '#/components/parameters/Cursor' });
    expect(reversed.paths['/widgets'].get.parameters).toEqual([
      { $ref: '#/components/parameters/PageSize' },
      { $ref: '#/components/parameters/ViaHeader' },
      { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
    ]);
    expect(reversed.paths['/widgets'].get.responses['404']).toEqual({ $ref: '#/components/responses/NotFound' });
    expect(reversed.paths['/widgets'].get.responses['204']).toEqual({ $ref: '#/components/responses/Empty' });
    expect(reversed.components.responses.Empty).toEqual({ description: 'nothing' });
  });

  it('refreshes an edited response module for Swagger 2.0 declarations and restored globals', async () => {
    const source = await readSpec('reusables-2.0.json');
    const outDir = await temporaryDirectory();
    await openApiToApiDocs(source, { outDir, insertComponents: true, useComponentAsReference: true });
    const module = join(outDir, 'components/responses/Problem/index.ts');
    await writeFile(module, (await readFile(module, 'utf8')).replace('z.number().int()', 'z.number().int().min(100)'));

    const reversed: any = await manifestFileToOpenApi(join(outDir, '.zopia-manifest.json'));
    expect(reversed.responses.Problem).toEqual({
      description: 'something failed',
      schema: { type: 'object', properties: { code: { type: 'integer', minimum: 100 } } },
    });
    expect(reversed.parameters.Trace).toEqual({ name: 'X-Trace', in: 'header', required: false, type: 'string' });
    expect(reversed.paths['/reports'].post.responses['422']).toEqual({ $ref: '#/responses/Problem' });
    expect(reversed.paths['/reports'].post.responses['204']).toEqual({ $ref: '#/responses/Empty' });
    expect(reversed.paths['/reports'].post.parameters).toEqual([{ $ref: '#/parameters/Trace' }, { $ref: '#/parameters/FilterBody' }]);
  });
});
