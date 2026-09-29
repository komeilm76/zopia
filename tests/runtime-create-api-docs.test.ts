import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeApiConfig } from 'km-api';
import { z } from 'zod';
import { openApiToApiDocs, type ZopiaGenerateOptions } from '../src';
import { ZOPIA_MANIFEST_FILE } from '../src/conversions/manifest-writer';
import { createApiDocs, flattenApiDocs, type ApiDocsTree } from '../src/runtime';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories('zopia-runtime-');

/** Spec that splits under both presets: tags for multi-tag, a server override for multi-server. */
const splittableSpec = {
  openapi: '3.0.3',
  info: { title: 'Runtime', version: '1' },
  servers: [{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }],
  paths: {
    '/users/{userId}': {
      parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getUser', tags: ['users'], summary: 'One user', responses: { '200': { description: 'ok' } } },
      patch: { operationId: 'updateUser', tags: ['users'], responses: { '200': { description: 'ok' } } },
    },
    '/health': { get: { operationId: 'getHealth', tags: ['ops'], responses: { '204': { description: 'empty' } } } },
    '/admin/reports': { get: { operationId: 'adminReports', servers: [{ url: 'https://b.example.com' }], responses: { '200': { description: 'ok' } } } },
  },
};

/** Ordered branch/leaf key paths (e.g. `users.{userId}.get`) of one runtime tree, in enumeration order. */
function treeKeys(node: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const at = prefix ? `${prefix}.${key}` : key;
    keys.push(at);
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).method !== 'string') {
      keys.push(...treeKeys(value as Record<string, unknown>, at));
    }
  }
  return keys;
}

/** Import one generated endpoint module's default export directly, bypassing the resolver. */
async function importEndpointDefault(file: string): Promise<Record<string, unknown>> {
  const endpointModule = await import(pathToFileURL(file).href) as Record<string, unknown>;
  return endpointModule.default as Record<string, unknown>;
}

/** One hand-built km-api config for pure flatten tests. */
function config(method: 'GET' | 'POST', pathShape: string, operationId?: string): Record<string, unknown> {
  return makeApiConfig({
    method,
    pathShape,
    ...(operationId === undefined ? {} : { operationId }),
    request: { body: z.any(), params: z.object({}), query: z.object({}), headers: z.object({}), cookies: z.object({}) },
    response: { 200: z.string() },
  }) as unknown as Record<string, unknown>;
}

describe('runtime api-docs tree consumption (S-94)', () => {
  it('S-94/R-711: createApiDocs resolves nested access identically across all four layouts', async () => {
    const cases: Array<{ label: string; options: ZopiaGenerateOptions }> = [
      { label: 'directory', options: {} },
      { label: 'flat', options: { mode: 'flat' } },
      { label: 'multi-tag', options: { preset: 'multi-tag' } },
      { label: 'multi-server', options: { preset: 'multi-server' } },
    ];
    const expectedKeys = ['admin', 'admin.reports', 'admin.reports.get', 'health', 'health.get', 'users', 'users.{userId}', 'users.{userId}.get', 'users.{userId}.patch'];
    for (const { label, options } of cases) {
      const outputDir = await temporaryDirectory();
      await openApiToApiDocs(splittableSpec, { ...options, outDir: outputDir });
      const apiDocs = await createApiDocs(outputDir);
      expect(treeKeys(apiDocs as unknown as Record<string, unknown>), label).toEqual(expectedKeys);
      expect(apiDocs.users['{userId}'].get.method).toBe('GET');
      expect(apiDocs.users['{userId}'].get.pathShape).toBe('/users/{userId}');
      expect(apiDocs.users['{userId}'].get.operationId).toBe('getUser');
      expect(apiDocs.users['{userId}'].patch.operationId).toBe('updateUser');
      expect(apiDocs.health.get.operationId).toBe('getHealth');
      expect(apiDocs.admin.reports.get.operationId).toBe('adminReports');
    }
  });

  it('S-94/R-732: every leaf is the endpoint module default export (pathToFileURL import)', async () => {
    const directory = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: directory });
    const apiDocs = await createApiDocs(directory);
    expect(apiDocs.users['{userId}'].get).toBe(await importEndpointDefault(join(directory, 'users', '{userId}', 'get', 'index.ts')));
    expect(apiDocs.users['{userId}'].patch).toBe(await importEndpointDefault(join(directory, 'users', '{userId}', 'patch', 'index.ts')));

    const tagged = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { preset: 'multi-tag', outDir: tagged });
    const taggedDocs = await createApiDocs(tagged);
    expect(taggedDocs.users['{userId}'].get).toBe(await importEndpointDefault(join(tagged, 'users', 'users', '{userId}', 'get', 'index.ts')));
    expect(taggedDocs.admin.reports.get).toBe(await importEndpointDefault(join(tagged, 'untagged', 'admin', 'reports', 'get', 'index.ts')));
  });

  it('S-94/D-06: multi-tag bucket manifests merge with root-priority dedupe by path#method', async () => {
    const root = await temporaryDirectory();
    // A plain generation first: it writes the root manifest owning /a and /b.
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Merge', version: '1' },
      paths: {
        '/a': { get: { operationId: 'aGet', summary: 'root version', responses: { '200': { description: 'ok' } } } },
        '/b': { post: { operationId: 'bPost', responses: { '200': { description: 'ok' } } } },
      },
    }, { outDir: root });
    // A preset generation into the same root: bucket manifests own /a (duplicate) and /c (new).
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Merge', version: '1' },
      paths: {
        '/a': { get: { operationId: 'aGet', summary: 'bucket version', tags: ['one'], responses: { '200': { description: 'ok' } } } },
        '/c': { put: { operationId: 'cPut', tags: ['two'], responses: { '200': { description: 'ok' } } } },
      },
    }, { preset: 'multi-tag', outDir: root });
    expect((await readdir(root)).sort()).toEqual(['.zopia-manifest.json', 'a', 'b', 'one', 'two']);

    const apiDocs = await createApiDocs(root);
    // The root manifest wins the /a#get duplicate; bucket two supplies /c#put; /b#post survives.
    expect(apiDocs.a.get).toBe(await importEndpointDefault(join(root, 'a', 'get', 'index.ts')));
    expect(apiDocs.a.get.summary).toBe('root version');
    expect(apiDocs.a.get).not.toBe(await importEndpointDefault(join(root, 'one', 'a', 'get', 'index.ts')));
    expect(apiDocs.b.post.operationId).toBe('bPost');
    expect(apiDocs.c.put).toBe(await importEndpointDefault(join(root, 'two', 'c', 'put', 'index.ts')));
    expect(treeKeys(apiDocs as unknown as Record<string, unknown>)).toEqual(['a', 'a.get', 'b', 'b.post', 'c', 'c.put']);
  });

  it('S-94/R-141: a missing manifest fails typed ZOPIA_DOCS_MISSING_MANIFEST', async () => {
    const empty = await temporaryDirectory();
    await expect(createApiDocs(empty)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST', at: join(empty, ZOPIA_MANIFEST_FILE) });
    await expect(createApiDocs(join(empty, 'not-there'))).rejects.toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST' });
    // A file (not a directory) has no manifest and no buckets either.
    const filePath = join(empty, 'spec.json');
    await writeFile(filePath, '{}');
    await expect(createApiDocs(filePath)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST' });
    await expect(createApiDocs('' as never)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'docsDir' });
    await expect(createApiDocs(null as never)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'docsDir' });
    await expect(createApiDocs('a\0b')).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'docsDir' });
  });

  it('S-94/R-141: a garbled or malformed manifest fails typed ZOPIA_MANIFEST_INVALID', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, ZOPIA_MANIFEST_FILE), '{ not json');
    await expect(createApiDocs(root)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID', at: join(root, ZOPIA_MANIFEST_FILE) });

    const bucketRoot = await temporaryDirectory();
    await mkdir(join(bucketRoot, 'bucket'));
    await writeFile(join(bucketRoot, 'bucket', ZOPIA_MANIFEST_FILE), '][');
    await expect(createApiDocs(bucketRoot)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID', at: join(bucketRoot, 'bucket', ZOPIA_MANIFEST_FILE) });

    const shaped = await temporaryDirectory();
    const manifestPath = join(shaped, ZOPIA_MANIFEST_FILE);
    await writeFile(manifestPath, '[]');
    await expect(createApiDocs(shaped)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID' });
    await writeFile(manifestPath, JSON.stringify({}));
    await expect(createApiDocs(shaped)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID' });
    await writeFile(manifestPath, JSON.stringify({ apis: 'nope' }));
    await expect(createApiDocs(shaped)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID' });

    // A directory sitting at the manifest path is an unreadable manifest, not a missing one.
    const dirManifest = await temporaryDirectory();
    await mkdir(join(dirManifest, ZOPIA_MANIFEST_FILE));
    await expect(createApiDocs(dirManifest)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID' });

    const invalidFiles = ['', '/etc/passwd', 'a\\b.ts', 'C:/x.ts', '../escape.ts', './here.ts', 'a//b.ts', 'a/./b.ts'];
    for (const [index, file] of invalidFiles.entries()) {
      await writeFile(manifestPath, JSON.stringify({ apis: [{ file, path: '/a', method: 'get' }] }));
      await expect(createApiDocs(shaped), `file: ${JSON.stringify(file)}`).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID', at: `${manifestPath}#apis/0` });
    }
    const invalidEntries: unknown[] = [
      { file: 'a/get/index.ts', path: 'a', method: 'get' },
      { file: 'a/get/index.ts', path: '/a', method: 'fetch' },
      { file: 'a/get/index.ts' },
      'nope',
    ];
    for (const [index, entry] of invalidEntries.entries()) {
      await writeFile(manifestPath, JSON.stringify({ apis: [entry] }));
      await expect(createApiDocs(shaped), `entry ${index}`).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID', at: `${manifestPath}#apis/0` });
    }
  });

  it('S-94/R-141: a module without a usable default export fails typed, naming the file', async () => {
    const root = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: root });
    const target = join(root, 'health', 'get', 'index.ts');
    await writeFile(target, "export const getHealth = { method: 'GET' };\n");
    await expect(createApiDocs(root)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_IMPORT_FAILED', at: 'health/get/index.ts' });

    const broken = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: broken });
    await rm(join(broken, 'health', 'get', 'index.ts'));
    await expect(createApiDocs(broken)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_IMPORT_FAILED', at: 'health/get/index.ts' });

    const crashing = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: crashing });
    await writeFile(join(crashing, 'health', 'get', 'index.ts'), 'throw new Error("boom");\n');
    await expect(createApiDocs(crashing)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_IMPORT_FAILED', at: 'health/get/index.ts' });
  });

  it('S-94/P-1: two runs over the same tree enumerate keys in the identical order', async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: first });
    await openApiToApiDocs(splittableSpec, { outDir: second });
    const firstTree = await createApiDocs(first);
    const firstAgain = await createApiDocs(first);
    const secondTree = await createApiDocs(second);
    expect(treeKeys(firstAgain as unknown as Record<string, unknown>)).toEqual(treeKeys(firstTree as unknown as Record<string, unknown>));
    expect(treeKeys(secondTree as unknown as Record<string, unknown>)).toEqual(treeKeys(firstTree as unknown as Record<string, unknown>));
    expect(Object.keys(flattenApiDocs(secondTree))).toEqual(Object.keys(flattenApiDocs(firstTree)));
  });

  it('S-94: absolute and relative directory paths load through pathToFileURL (Windows-safe)', async () => {
    const outputDir = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: outputDir });
    const absoluteTree = await createApiDocs(resolve(outputDir));
    expect(absoluteTree.users['{userId}'].get.operationId).toBe('getUser');
    const relativeTree = await createApiDocs(relative(process.cwd(), outputDir));
    expect(relativeTree.users['{userId}'].get.operationId).toBe('getUser');
  });

  it('S-94/R-712: a root path nests its methods directly and method leaves follow the canonical order', async () => {
    const root = await temporaryDirectory();
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Root', version: '1' },
      paths: {
        '/': { get: { operationId: 'rootGet', responses: { '200': { description: 'ok' } } }, post: { operationId: 'rootPost', responses: { '201': { description: 'ok' } } } },
        '/items': { post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } }, get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } } },
      },
    }, { outDir: root });
    const apiDocs = await createApiDocs(root);
    expect(treeKeys(apiDocs as unknown as Record<string, unknown>)).toEqual(['get', 'post', 'items', 'items.get', 'items.post']);
    expect(apiDocs.get.operationId).toBe('rootGet');
    expect(apiDocs.post.operationId).toBe('rootPost');
    expect(Object.keys(apiDocs.items as unknown as Record<string, unknown>)).toEqual(['get', 'post']);
  });

  it('S-94/R-714: paths that cannot share one nested tree fail typed ZOPIA_SPEC_INVALID', async () => {
    const belowMethod = await temporaryDirectory();
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Conflict', version: '1' },
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } } },
        '/users/get': { get: { operationId: 'echoUsers', responses: { '200': { description: 'ok' } } } },
      },
    }, { outDir: belowMethod });
    await expect(createApiDocs(belowMethod)).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', at: 'users/get-2/get/index.ts' });

    const trailingSlash = await temporaryDirectory();
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Conflict', version: '1' },
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } } },
        '/users/': { get: { operationId: 'listUsersAlt', responses: { '200': { description: 'ok' } } } },
      },
    }, { outDir: trailingSlash });
    await expect(createApiDocs(trailingSlash)).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID' });
  });

  it('S-94/D-2: flattenApiDocs keys leaves by operationId in tree leaf order', async () => {
    const root = await temporaryDirectory();
    await openApiToApiDocs(splittableSpec, { outDir: root });
    const apiDocs = await createApiDocs(root);
    const endpoints = flattenApiDocs(apiDocs);
    expect(Object.keys(endpoints)).toEqual(['adminReports', 'getHealth', 'getUser', 'updateUser']);
    expect(endpoints.getUser).toBe(apiDocs.users['{userId}'].get);
    expect(endpoints.updateUser.pathShape).toBe('/users/{userId}');
    expect(endpoints.getHealth.method).toBe('GET');
  });

  it('S-94/D-2: flattenApiDocs derives missing-operationId names by the generator rules', async () => {
    const tree = {
      things: { get: config('GET', '/things') },
      'all-things': { get: config('GET', '/all-things') },
    } as unknown as ApiDocsTree;
    const endpoints = flattenApiDocs(tree);
    expect(Object.keys(endpoints)).toEqual(['getThings', 'getAllThings']);
    expect(endpoints.getThings.pathShape).toBe('/things');
  });

  it('S-94/D-3: collisions receive the uniqueness suffix and never clobber registered names', () => {
    const tree = {
      a: { get: config('GET', '/a', 'get-a') },
      b: { get: config('GET', '/b', 'get_a') },
      c: { get: config('GET', '/c', 'getA') },
      d: { get: config('GET', '/d', 'get-a') },
    } as unknown as ApiDocsTree;
    const endpoints = flattenApiDocs(tree);
    // `get-a` and `getA` camelize to the same key (the second gets `2`); `_` is an identifier
    // character, so `get_a` stays its own verbatim key and never collides.
    expect(Object.keys(endpoints)).toEqual(['getA', 'get_a', 'getA2', 'getA3']);
    expect(endpoints.getA.pathShape).toBe('/a');
    expect(endpoints.get_a.pathShape).toBe('/b');
    expect(endpoints.getA2.pathShape).toBe('/c');
    expect(endpoints.getA3.pathShape).toBe('/d');
  });

  it('S-94/R-732: flatten keys mirror the generator export names (await → awaitEndpoint)', async () => {
    const root = await temporaryDirectory();
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Parity', version: '1' },
      paths: {
        '/reserved': { get: { operationId: 'await', responses: { '200': { description: 'ok' } } } },
        '/applicant/{applicantId}/exame/{examId}': {
          parameters: [
            { name: 'applicantId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'examId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: { operationId: 'getExam', responses: { '200': { description: 'ok' } } },
        },
      },
    }, { outDir: root });
    const apiDocs = await createApiDocs(root);
    expect(apiDocs.applicant['{applicantId}'].exame['{examId}'].get.operationId).toBe('getExam');
    const endpoints = flattenApiDocs(apiDocs);
    expect(Object.keys(endpoints)).toEqual(['getExam', 'awaitEndpoint']);
    const reservedModule = await import(pathToFileURL(join(root, 'reserved', 'get', 'index.ts')).href) as Record<string, unknown>;
    expect(reservedModule.awaitEndpoint).toBe(endpoints.awaitEndpoint);
    expect(await readFile(join(root, 'reserved', 'get', 'index.ts'), 'utf8')).toContain('export const awaitEndpoint');
  });

  it('S-94/R-141: flattenApiDocs rejects non-tree inputs and underivable names typed', () => {
    expect(() => flattenApiDocs('nope' as never)).toThrowError('flattenApiDocs expects the tree object returned by createApiDocs');
    expect(() => flattenApiDocs(null as never)).toThrowError('flattenApiDocs expects the tree object returned by createApiDocs');
    expect(() => flattenApiDocs({ bad: 'text' } as never)).toThrowError("unexpected value in the api-docs tree at key 'bad'");
    const expressTree = { leaf: { get: config('GET', ':express-path') } } as unknown as ApiDocsTree;
    expect(() => flattenApiDocs(expressTree)).toThrowError('Invalid API path');
  });
});
