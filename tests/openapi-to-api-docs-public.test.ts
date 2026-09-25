import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApiToApiDocs, ZopiaError } from '../src';

const minimal = (paths: Record<string, unknown> = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Public API', version: '1.0.0' },
  paths,
});

describe('openApiToApiDocs public API', () => {
  it('generates from an object and returns the sorted public result shape', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-public-'));
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
    const directory = await mkdtemp(join(tmpdir(), 'zopia-public-'));
    const input = join(directory, 'openapi.json');
    const outDir = join(directory, 'generated');
    await writeFile(input, JSON.stringify(minimal({ '/health': { get: { responses: { '200': { description: 'ok' } } } } })), 'utf8');

    const result = await openApiToApiDocs(input, { outDir, manifest: false, mode: 'flat' });
    expect(result.files).toEqual([{ path: 'health/get/index.ts', kind: 'endpoint' }]);
    expect(result.manifestPath).toBeUndefined();
  });

  it('uses application/json as the primary content regardless of document order', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-public-'));
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
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-public-'));
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
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-public-'));
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
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-public-'));
    await openApiToApiDocs(minimal({ '/before': { get: { responses: { '200': { description: 'ok' } } } } }), { outDir });
    const same = await openApiToApiDocs(minimal({ '/before': { get: { responses: { '200': { description: 'ok' } } } } }), { outDir });
    expect(same.warnings.some((warning) => warning.code === 'ZOPIA_WARN_STALE_TREE')).toBe(false);

    const changed = await openApiToApiDocs(minimal({ '/after': { get: { responses: { '200': { description: 'ok' } } } } }), { outDir });
    expect(changed.warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_STALE_TREE', at: '.zopia-manifest.json' }));
  });

  it('uses typed stable errors for input, configuration, and references', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-public-'));
    const malformed = join(directory, 'bad.json');
    await writeFile(malformed, '{', 'utf8');

    await expect(openApiToApiDocs(malformed, { outDir: join(directory, 'one') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_JSON' });
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
