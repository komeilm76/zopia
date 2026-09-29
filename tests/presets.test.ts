import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { apiDocsToOpenApi, generateApiDocsFiles, openApiToApiDocs, planPresetBuckets, ZopiaError } from '../src';
import { runCli, type ZopiaCliOutput } from '../src/cli-command';
import { writeFile } from 'node:fs/promises';

const temporaryDirectory = useTemporaryDirectories('zopia-preset-');

const tagged = {
  openapi: '3.1.0',
  info: { title: 'Shop', version: '1' },
  paths: {
    '/pets': { get: { operationId: 'listPets', tags: ['pets'], responses: { '200': { description: 'ok' } } } },
    '/pet/{id}': { get: { operationId: 'getPet', tags: ['pets', 'animals'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
    '/stores': { get: { operationId: 'listStores', tags: ['stores'], responses: { '200': { description: 'ok' } } } },
    '/admin': { get: { operationId: 'adminOnly', responses: { '200': { description: 'ok' } } } },
  },
  webhooks: { signed: { post: { operationId: 'hookSigned', tags: ['webhook ops'], responses: { '202': { description: 'ok' } } } } },
  components: { schemas: { Pet: { type: 'object' } } },
} as const;

describe('split-generation presets (Phase 3, S-92)', () => {
  it('S-92: multi-tag routes operations by primary tag with one reversible tree per bucket', async () => {
    const outputDir = await temporaryDirectory();
    const result = await openApiToApiDocs(tagged as any, { outDir: outputDir, preset: 'multi-tag' });
    // Buckets come back name-sorted; '(untagged)' leads the list deterministically.
    expect(result.trees).toEqual([
      { name: '(untagged)', directory: 'untagged', manifestPath: 'untagged/.zopia-manifest.json' },
      { name: 'pets', directory: 'pets', manifestPath: 'pets/.zopia-manifest.json' },
      { name: 'stores', directory: 'stores', manifestPath: 'stores/.zopia-manifest.json' },
      { name: 'webhook ops', directory: 'webhook-ops', manifestPath: 'webhook-ops/.zopia-manifest.json' },
    ]);
    expect(result.manifestPath).toBeUndefined();
    expect((result.trees ?? []).map((tree) => tree.directory).sort()).toEqual((await readdir(outputDir)).sort());
    expect(result.files.map((file) => file.path)).toContain('pet'.length ? 'pets/pets/get/index.ts' : '');
    expect(result.files.map((file) => file.path)).toContain('webhook-ops/webhooks/signed/post/index.ts');
    expect(result.files.map((file) => file.path)).toContain('untagged/admin/get/index.ts');
    expect(result.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_PRESET_PRIMARY_TAG')).toEqual([
      { code: 'ZOPIA_WARN_PRESET_PRIMARY_TAG', at: '#/paths/~1pet~1{id}/get', message: 'operation has 2 tags; using primary tag "pets" for --preset multi-tag' },
    ]);
    // every bucket is an independently reversible zopia tree holding only its operations
    const pets = await apiDocsToOpenApi(join(outputDir, 'pets'));
    expect(Object.keys(pets.openapi.paths ?? {}).sort()).toEqual(['/pet/{id}', '/pets']);
    expect(pets.openapi.webhooks).toBeUndefined();
    const webhooks = await apiDocsToOpenApi(join(outputDir, 'webhook-ops'));
    expect(webhooks.openapi.paths).toEqual({});
    expect(Object.keys(webhooks.openapi.webhooks ?? {})).toEqual(['signed']);
  });

  it('S-92: multi-server routes by effective first server with operation overrides', async () => {
    const outputDir = await temporaryDirectory();
    const spec = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1' },
      servers: [{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }],
      paths: {
        '/x': { get: { operationId: 'xGet', responses: { '200': { description: 'ok' } } } },
        '/y': { servers: [{ url: 'https://b.example.com' }], post: { operationId: 'yPost', responses: { '200': { description: 'ok' } } } },
      },
    };
    const result = await openApiToApiDocs(spec as any, { outDir: outputDir, preset: 'multi-server' });
    expect(result.trees?.map((tree) => `${tree.directory}:${tree.name}`)).toEqual(['https-a.example.com:https://a.example.com', 'https-b.example.com:https://b.example.com']);
    const a = await apiDocsToOpenApi(join(outputDir, 'https-a.example.com'));
    expect(Object.keys(a.openapi.paths ?? {})).toEqual(['/x']);
    const b = await apiDocsToOpenApi(join(outputDir, 'https-b.example.com'));
    expect(Object.keys(b.openapi.paths ?? {})).toEqual(['/y']);
  });

  it('S-92: buckets plan deterministically — slug collisions rename, paths/webhooks keep x- entries, fallthrough is transparent', () => {
    const planned = planPresetBuckets({
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/a': { get: { operationId: 'aGet', tags: ['Pet Store'], responses: { '200': { description: 'ok' } } } },
        '/b': { get: { operationId: 'bGet', tags: ['pet-store'], responses: { '200': { description: 'ok' } } } },
        'x-note': 'kept everywhere',
      },
      webhooks: { named: { post: { operationId: 'h', tags: ['Pet Store'], responses: { '202': { description: 'ok' } } } }, 'x-empty': {} },
      components: { schemas: {} },
    } as any, 'multi-tag');
    // 'Pet Store' sorts before 'pet-store', claims the base slug, and the later bucket renames.
    expect((planned ?? []).map((bucket) => `${bucket.directory}:${bucket.name}`)).toEqual(['pet-store:Pet Store', 'pet-store-2:pet-store']);
    for (const bucket of planned ?? []) {
      expect(bucket.document.paths['x-note']).toBe('kept everywhere');
      // Webhook x- entries travel with every bucket; the routed one keeps its item too,
      // and buckets without webhook operations drop the section instead of writing noise.
      if (bucket.name === 'Pet Store') expect(Object.keys(bucket.document.webhooks ?? {}).sort()).toEqual(['named', 'x-empty']);
      else expect(bucket.document.webhooks).toEqual({ 'x-empty': {} });
    }
    // nothing to split → undefined (the public API then renders the normal single tree)
    expect(planPresetBuckets({ openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} } as any, 'multi-tag')).toBeUndefined();
    expect(planPresetBuckets({ openapi: '3.0.3', info: { title: 'T', version: '1' }, servers: [{ url: 'https://one.example.com' }], paths: { '/z': { get: { operationId: 'z', responses: { '200': { description: 'ok' } } } } } } as any, 'multi-server')).toBeUndefined();
  });

  it('S-92: public fallthrough for a tag-less spec behaves exactly like no preset', async () => {
    const presetDir = await temporaryDirectory();
    const plainDir = await temporaryDirectory();
    const spec = { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: { '/z': { get: { operationId: 'z', responses: { '200': { description: 'ok' } } } } } };
    const preset = await openApiToApiDocs(spec as any, { outDir: presetDir, preset: 'multi-tag' });
    const plain = await openApiToApiDocs(spec as any, { outDir: plainDir });
    expect(preset.trees).toBeUndefined();
    expect(preset.files.map((file) => file.path)).toEqual(plain.files.map((file) => file.path));
    expect(preset.warnings).toEqual(plain.warnings);
    await expect(generateApiDocsFiles(spec as any, { outputDir: plainDir })).resolves.toBeTruthy();
  });

  it('S-92: $refs survive verbatim on whole-item routes and expand on partial routes', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/whole': { $ref: '#/components/pathItems/Shared' },
        '/partial': { $ref: '#/components/pathItems/Mixed' },
      },
      components: { pathItems: {
        Shared: { get: { operationId: 'sharedGet', tags: ['a'], responses: { '200': { description: 'ok' } } } },
        Mixed: { get: { operationId: 'mixedGet', tags: ['a'], responses: { '200': { description: 'ok' } } }, post: { operationId: 'mixedPost', tags: ['b'], responses: { '200': { description: 'ok' } } } },
      }, schemas: {} },
    };
    const buckets = planPresetBuckets(spec as any, 'multi-tag') ?? [];
    const aBucket = buckets.find((bucket) => bucket.name === 'a');
    const bBucket = buckets.find((bucket) => bucket.name === 'b');
    expect(aBucket?.document.paths['/whole']).toEqual({ $ref: '#/components/pathItems/Shared' });
    // partial route: `b` takes only the post — the ref must not leak the get
    const partial = (bBucket?.document.paths['/partial'] ?? {}) as Record<string, unknown>;
    expect(partial.$ref).toBeUndefined();
    expect(Object.keys(partial).filter((key) => ['get', 'post'].includes(key))).toEqual(['post']);
    expect((partial.post as any).operationId).toBe('mixedPost');
    // whole item `$ref`s survive verbatim; non-method siblings survive on partial inline expansion
    const aPartial = (aBucket?.document.paths['/partial'] ?? {}) as Record<string, unknown>;
    expect(Object.keys(aPartial).filter((key) => ['get', 'post'].includes(key))).toEqual(['get']);
  });

  it('S-92: invalid presets fail with ZOPIA_CONFIG_INVALID at both layers', async () => {
    const outputDir = await temporaryDirectory();
    await expect(openApiToApiDocs(tagged as any, { outDir: outputDir, preset: 'per-host' } as any)).rejects.toThrow('unsupported generate preset: per-host');
    await expect(openApiToApiDocs(tagged as any, { outDir: outputDir, preset: 'per-host' } as any)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID' } satisfies Partial<ZopiaError>);
    expect(() => planPresetBuckets({} as any, 'nope' as any)).toThrow('unsupported generate preset: nope');
  });

  function captureOutput(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { stdout, stderr, output: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
  }

  it('S-92: CLI --preset with value, config default, summary line, and grammar rejection', async () => {
    const directory = await temporaryDirectory();
    const specPath = join(directory, 'spec.json');
    await writeFile(specPath, JSON.stringify(tagged), 'utf8');

    const flag = captureOutput();
    const flagOut = join(directory, 'flag');
    await runCli(['generate', specPath, flagOut, '--preset', 'multi-tag'], flag.output);
    expect(flag.stdout).toEqual([`zopia generate ${specPath}: 4 preset trees in ${flagOut} (untagged, pets, stores, webhook-ops)\n`]);
    expect((await readdir(flagOut)).sort()).toEqual(['pets', 'stores', 'untagged', 'webhook-ops']);
    expect(flag.stderr.join('')).toContain('primary tag');

    await expect(runCli(['generate', specPath, flagOut, '--preset'], captureOutput().output)).rejects.toThrow();
    await expect(runCli(['generate', specPath, flagOut, '--preset', 'multi-tag', '--preset', 'multi-server'], captureOutput().output)).rejects.toThrow(/already provided|--preset/m);

    const help = captureOutput();
    await runCli(['--help'], help.output);
    expect(help.stdout.join('')).toContain('--preset multi-tag|multi-server');
  });
});
