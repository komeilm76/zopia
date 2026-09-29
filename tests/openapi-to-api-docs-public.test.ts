import { useTemporaryDirectories } from './test-temporary-directories';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiDocsToOpenApi, openApiToApiDocs, ZopiaError } from '../src';

const temporaryDirectory = useTemporaryDirectories();

const minimal = (paths: Record<string, unknown> = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Public API', version: '1.0.0' },
  paths,
});

describe('openApiToApiDocs public API', () => {
  it('generates from an object and returns the sorted public result shape', async () => {
    const outDir = await temporaryDirectory('zopia-public-');
    const result = await openApiToApiDocs({
      ...minimal({
        '/z': { get: { responses: { '200': { description: 'ok' } } } },
        '/a': { post: { responses: { '204': { description: 'empty' } } } },
      }),
      components: { schemas: { Thing: { type: 'string' } } },
    }, { outDir, insertComponents: true });

    expect(result).toEqual({
      files: [
        { path: '.zopia-manifest.json', kind: 'manifest' },
        { path: '.zopia-tree.d.ts', kind: 'types' },
        { path: 'a/post/index.ts', kind: 'endpoint' },
        { path: 'components/Thing/index.ts', kind: 'component' },
        { path: 'components/index.ts', kind: 'component' },
        { path: 'z/get/index.ts', kind: 'endpoint' },
      ],
      warnings: [],
      manifestPath: '.zopia-manifest.json',
    });
    expect(JSON.parse(await readFile(join(outDir, result.manifestPath!), 'utf8')).source.kind).toBe('openapi-3.1');
  });

  it('reads a JSON file and supports disabling the manifest', async () => {
    const directory = await temporaryDirectory('zopia-public-');
    const input = join(directory, 'openapi.json');
    const outDir = join(directory, 'generated');
    await writeFile(input, JSON.stringify(minimal({ '/health': { get: { responses: { '200': { description: 'ok' } } } } })), 'utf8');

    const result = await openApiToApiDocs(input, { outDir, manifest: false, mode: 'flat' });
    expect(result.files).toEqual([{ path: 'health/get/index.ts', kind: 'endpoint' }]);
    expect(result.manifestPath).toBeUndefined();
  });

  it('classifies endpoint files under a components path as endpoints', async () => {
    const outDir = await temporaryDirectory('zopia-public-');
    const result = await openApiToApiDocs({
      ...minimal({ '/components/users': { get: { responses: { '200': { description: 'ok' } } } } }),
      components: { schemas: { User: { type: 'string' } } },
    }, { outDir, insertComponents: true });

    expect(result.files).toContainEqual({ path: 'components/users/get/index.ts', kind: 'endpoint' });
    expect(result.files).toContainEqual({ path: 'components/User/index.ts', kind: 'component' });

    const withoutComponents = await openApiToApiDocs(minimal({
      '/components': { get: { responses: { '200': { description: 'ok' } } } },
    }), { outDir: await temporaryDirectory('zopia-public-'), manifest: false });
    expect(withoutComponents.files).toEqual([{ path: 'components/get/index.ts', kind: 'endpoint' }]);
  });
  it('uses application/json as the primary content regardless of document order', async () => {
    const outDir = await temporaryDirectory('zopia-public-');
    const result = await openApiToApiDocs(minimal({
      '/media': { post: {
        requestBody: { content: {
          'text/plain': { schema: { type: 'string', minLength: 10 }, example: 'plain' },
          'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, example: { id: 'json' } },
        } },
        responses: { '200': { description: 'ok', content: {
          'text/plain': { schema: { type: 'string' }, example: 'plain response' },
          'application/json': { schema: { type: 'integer' }, example: 7 },
        } } },
      } },
    }), { outDir });

    const endpoint = await readFile(join(outDir, 'media', 'post', 'index.ts'), 'utf8');
    expect(endpoint).toContain('requestContentType: "application/json"');
    expect(endpoint).toContain('responseContentType: "application/json"');
    expect(endpoint).toContain('body: z.object({ ["id"]: z.string() })');
    expect(endpoint).toContain('response: { 200: z.number().int() }');
    expect(endpoint).toContain('json');
    expect(endpoint).not.toContain('plain response');
    expect(result.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_MULTI_CONTENT')).toHaveLength(2);
  });

  it('collects structured document and schema warnings with source pointers', async () => {
    const outDir = await temporaryDirectory('zopia-public-');
    const result = await openApiToApiDocs({
      ...minimal({
        '/items': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string', format: 'vendor-id' } } } } } } },
      }),
      servers: [{ url: 'https://{region}.example.test', variables: { region: { default: 'us' } } }],
      webhooks: { update: {} },
    }, { outDir });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ZOPIA_WARN_SERVER_VARIABLES', at: '#/servers/0/variables' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks' }),
      expect.objectContaining({ code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/paths/~1items/get/responses/200/content/application~1json/schema' }),
    ]));
  });

  it('does not interpret references inside literal example values', async () => {
    const outDir = await temporaryDirectory('zopia-public-');
    const result = await openApiToApiDocs(minimal({
      '/example': { get: { responses: { '200': { description: 'ok', content: {
        'application/json': {
          schema: { type: 'object', default: { $ref: './literal.json' } },
          example: { $ref: './also-literal.json' },
          examples: { named: { value: { $ref: './examples-value-is-literal.json' } } },
        },
      } } } } },
    }), { outDir });
    expect(result.files.some((file) => file.kind === 'endpoint')).toBe(true);
  });

  it('reports changed input against an existing generated tree', async () => {
    const outDir = await temporaryDirectory('zopia-public-');
    await openApiToApiDocs(minimal({ '/before': { get: { responses: { '200': { description: 'ok' } } } } }), { outDir });
    const same = await openApiToApiDocs(minimal({ '/before': { get: { responses: { '200': { description: 'ok' } } } } }), { outDir });
    expect(same.warnings.some((warning) => warning.code === 'ZOPIA_WARN_STALE_TREE')).toBe(false);

    const changed = await openApiToApiDocs(minimal({ '/after': { get: { responses: { '200': { description: 'ok' } } } } }), { outDir });
    expect(changed.warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_STALE_TREE', at: '.zopia-manifest.json' }));
  });

  it('S-34: uses typed stable errors for input, configuration, and references', async () => {
    const directory = await temporaryDirectory('zopia-public-');
    const malformed = join(directory, 'bad.json');
    await writeFile(malformed, '{', 'utf8');

    await expect(openApiToApiDocs(malformed, { outDir: join(directory, 'one') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_JSON' });
    await expect(openApiToApiDocs('[]', { outDir: join(directory, 'array') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', at: '#' });
    await expect(openApiToApiDocs(null as any, { outDir: join(directory, 'null') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', at: '#' });
    await expect(openApiToApiDocs({ info: { title: 'x', version: '1' }, paths: {} }, { outDir: join(directory, 'two') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_UNSUPPORTED_VERSION' });
    await expect(openApiToApiDocs({ openapi: '3.1.0', info: { title: 'x', version: '1' } }, { outDir: join(directory, 'three') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_MISSING_PATHS', at: '#/paths' });
    await expect(openApiToApiDocs(minimal(), { outDir: join(directory, 'four'), useComponentAsReference: true })).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', hint: 'enable `insertComponents` first' });
    await expect(openApiToApiDocs(minimal(), { outDir: join(directory, 'five'), mode: 'other' as any })).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'mode' });
    await expect(openApiToApiDocs(minimal(), { outDir: join(directory, 'unknown'), surprise: true } as any)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'surprise' });
    await expect(openApiToApiDocs({ ...minimal(), components: { schemas: { External: { $ref: './other.json#/Thing' } } } }, { outDir: join(directory, 'six') })).rejects.toMatchObject({ code: 'ZOPIA_REF_EXTERNAL' });
    await expect(openApiToApiDocs({ ...minimal(), components: { schemas: { External: { type: 'object', properties: { default: { $ref: './other.json#/Thing' } } } } } }, { outDir: join(directory, 'six-map') })).rejects.toMatchObject({ code: 'ZOPIA_REF_EXTERNAL' });
    await expect(openApiToApiDocs({ ...minimal(), components: { schemas: { Missing: { $ref: '#/components/schemas/Nope' } } } }, { outDir: join(directory, 'seven') })).rejects.toMatchObject({ code: 'ZOPIA_REF_NOT_FOUND' });
    await expect(openApiToApiDocs({ ...minimal(), components: { schemas: { Invalid: null } } }, { outDir: join(directory, 'invalid-schema') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID' });
    await expect(openApiToApiDocs({ ...minimal(), components: { schemas: [] } }, { outDir: join(directory, 'invalid-components') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID' });
    await expect(openApiToApiDocs(minimal({ '/content': { post: { requestBody: { content: { 'text/plain': null, 'application/json': {} } }, responses: { '200': { description: 'ok' } } } } }), { outDir: join(directory, 'invalid-content') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID' });
    await expect(openApiToApiDocs({
      ...minimal({ '/cycle': { $ref: '#/components/pathItems/A' } }),
      components: { pathItems: { A: { $ref: '#/components/pathItems/B' }, B: { $ref: '#/components/pathItems/A' } } },
    }, { outDir: join(directory, 'eight') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_PATH_REF' });

    try { await openApiToApiDocs(minimal(), { mode: 'invalid' as any }); }
    catch (error) { expect(error).toBeInstanceOf(ZopiaError); }
  });
});

describe('operationId identity (round 9 coverage)', () => {
  it('rejects duplicate explicit operationIds and renumbers derived predecessors deterministically', async () => {
    const base = { openapi: '3.1.0' as const, info: { title: 'T', version: '1' }, components: { schemas: {} } };
    const duplicate = {
      ...base,
      paths: {
        '/a': { get: { operationId: 'shared', responses: { '200': { description: 'ok' } } } },
        '/b': { get: { operationId: 'shared', responses: { '200': { description: 'ok' } } } },
      },
    };
    await expect(openApiToApiDocs(duplicate as any, { outDir: await temporaryDirectory() })).rejects.toThrow('Duplicate operationId: shared');
    // derived id later claimed explicitly: the derived predecessor is renamed with a numeric suffix
    const outputDir = await temporaryDirectory();
    const result = await openApiToApiDocs({
      ...base,
      paths: {
        '/a': { get: { responses: { '200': { description: 'ok' } } } },
        '/b': { get: { operationId: 'getA', responses: { '200': { description: 'ok' } } } },
      },
    } as any, { outDir: outputDir });
    expect(result.files.map((file) => file.path).sort()).toEqual(['.zopia-manifest.json', '.zopia-tree.d.ts', 'a/get/index.ts', 'b/get/index.ts']);
    // the generation-internal rename is visible in the manifest; the source
    // truth (op without operationId) round-trips back EXACTLY as authored
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')) as { apis: { operationId?: string }[] };
    expect(manifest.apis.map((api) => api.operationId).sort()).toEqual(['getA', 'getA2']);
    const reversed = await apiDocsToOpenApi(outputDir);
    const operations = Object.values(reversed.openapi.paths ?? {}).flatMap((item) => Object.values(item as Record<string, { operationId?: string }>)).map((operation) => operation.operationId).sort();
    expect(operations).toEqual(['getA', undefined]);
  });
});

describe('generate options validation (round 9 coverage)', () => {
  const spec = { openapi: '3.1.0' as const, info: { title: 'T', version: '1' }, paths: {}, components: { schemas: {} } };
  it('rejects every invalid options shape with its dedicated typed message', async () => {
    const cases: [unknown, string][] = [
      [null, 'generate options must be an object'],
      [[], 'generate options must be an object'],
      ['nope', 'generate options must be an object'],
      [{ bogus: true }, 'unknown generate option: bogus'],
      [{ outDir: '   ' }, 'outDir must be a non-empty path'],
      [{ outDir: 42 }, 'outDir must be a non-empty path'],
      [{ outDir: 'a\u0000b' }, 'outDir must be a non-empty path'],
      [{ mode: 'grid' }, 'unsupported layout mode'],
      [{ insertComponents: 'yes' }, 'insertComponents must be a boolean'],
      [{ useComponentAsReference: 1 }, 'useComponentAsReference must be a boolean'],
      [{ manifest: 'no' }, 'manifest must be a boolean'],
      [{ custom: 0 }, 'custom must be a boolean'],
    ];
    for (const [options, message] of cases) {
      await expect(openApiToApiDocs(spec as any, options as any)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID' } satisfies Partial<ZopiaError>);
      await expect(openApiToApiDocs(spec as any, options as any)).rejects.toThrow(message);
    }
  });
});

describe('accepted input shapes (round 9 coverage)', () => {
  const spec = { openapi: '3.1.0' as const, info: { title: 'T', version: '1' }, paths: { '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } } }, components: { schemas: {} } };
  it('accepts JSON text, YAML text, and file paths identically, and rejects malformed JSON text', async () => {
    const out1 = await temporaryDirectory();
    const byText = await openApiToApiDocs(JSON.stringify(spec), { outDir: out1 });
    expect(byText.files.map((file) => file.path)).toContain('ping/get/index.ts');
    const out2 = await temporaryDirectory();
    const byYaml = await openApiToApiDocs('openapi: 3.1.0\ninfo:\n  title: T\n  version: \'1\'\npaths: {}\n', { outDir: out2 });
    expect(byYaml.files.length).toBeGreaterThan(0);
    const out3 = await temporaryDirectory();
    const seed = join(out3, 'spec.json');
    await writeFile(seed, JSON.stringify(spec), 'utf8');
    const byFile = await openApiToApiDocs(seed, { outDir: join(out3, 'tree') });
    expect(byFile.files.map((file) => file.path)).toEqual(byText.files.map((file) => file.path));
    await expect(openApiToApiDocs('{\"openapi\": ', { outDir: await temporaryDirectory() })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_JSON' } satisfies Partial<ZopiaError>);
  });
});
