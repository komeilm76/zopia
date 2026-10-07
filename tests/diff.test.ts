import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffOpenApiDocuments, diffOpenApiSpecs, ZopiaError } from '../src';
import { runCli, type ZopiaCliOutput } from '../src/cli-command';

const temporaryDirectory = useTemporaryDirectories('zopia-diff-');

const base = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1' },
  paths: {
    '/pets': {
      get: { operationId: 'listPets', summary: 'List pets', responses: { '200': { description: 'ok' } } },
      post: { operationId: 'createPet', responses: { '201': { description: 'ok' } } },
    },
  },
  components: { schemas: { Pet: { type: 'object' } } },
} as const;

describe('spec diff (Phase 3, S-91)', () => {
  it('S-91: semantically identical documents report no changes, ignoring key order and input form', async () => {
    const shuffled = {
      components: { schemas: { Pet: { type: 'object' } } },
      paths: {
        '/pets': {
          post: { responses: { '201': { description: 'ok' } }, operationId: 'createPet' },
          get: { responses: { '200': { description: 'ok' } }, summary: 'List pets', operationId: 'listPets' },
        },
      },
      info: { version: '1', title: 'Pets' },
      openapi: '3.0.3',
    };
    const result = diffOpenApiDocuments(base as any, shuffled as any);
    expect(result.identical).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.counts).toEqual({ added: 0, removed: 0, changed: 0 });
    const directory = await temporaryDirectory();
    const jsonPath = join(directory, 'spec.json');
    const yamlPath = join(directory, 'spec.yaml');
    await writeFile(jsonPath, JSON.stringify(base), 'utf8');
    await writeFile(yamlPath, 'openapi: 3.0.3\ninfo: {title: Pets, version: "1"}\npaths:\n  /pets:\n    get: {operationId: listPets, summary: List pets, responses: {"200": {description: ok}}}\n    post: {operationId: createPet, responses: {"201": {description: ok}}}\ncomponents:\n  schemas: {Pet: {type: object}}\n', 'utf8');
    expect((await diffOpenApiSpecs(jsonPath, yamlPath)).identical).toBe(true);
  });

  it('S-91: bundles same-folder external references in file-backed diff inputs', async () => {
    const directory = await temporaryDirectory();
    const externalPath = join(directory, 'external.json');
    const inlinePath = join(directory, 'inline.json');
    const sharedPath = join(directory, 'shared.json');
    const operation = { operationId: 'listPets', responses: { '200': { description: 'ok' } } };
    await writeFile(sharedPath, JSON.stringify({ PetsPath: { summary: 'Pets', get: operation } }), 'utf8');
    await writeFile(externalPath, JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Pets', version: '1' },
      paths: { '/pets': { $ref: './shared.json#/PetsPath' } },
    }), 'utf8');
    await writeFile(inlinePath, JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Pets', version: '1' },
      paths: { '/pets': { summary: 'Pets', get: operation } },
    }), 'utf8');

    await expect(diffOpenApiSpecs(externalPath, inlinePath)).resolves.toMatchObject({
      identical: true,
      changes: [],
      counts: { added: 0, removed: 0, changed: 0 },
    });
  });

  it('S-91: reports endpoint additions and removals with operation identities', () => {
    const result = diffOpenApiDocuments(base as any, {
      ...base,
      paths: {
        '/pets': { get: base.paths['/pets'].get },
        '/pets/lost': { get: { operationId: 'findLost', responses: { '200': { description: 'ok' } } } },
      },
    } as any);
    expect(result.identical).toBe(false);
    expect(result.changes).toEqual([
      { kind: 'removed', area: 'endpoint', at: '#/paths/~1pets/post', message: 'endpoint POST /pets (createPet)', depth: 0 },
      { kind: 'added', area: 'endpoint', at: '#/paths/~1pets~1lost/get', message: 'endpoint GET /pets/lost (findLost)', depth: 0 },
    ]);
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  it('S-91: shared operations emit a header plus scalar, parameter, body, response, and x- details', () => {
    const newer = {
      ...base,
      paths: {
        '/pets': {
          ...base.paths['/pets'],
          get: {
            ...base.paths['/pets'].get,
            summary: 'List every pet',
            deprecated: true,
            parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'ok-en' }, '404': { description: 'nf' } },
            'x-rate-limit': 10,
          },
          post: base.paths['/pets'].post,
        },
      },
    };
    const atNew = diffOpenApiDocuments(base as any, newer as any);
    expect(atNew.changes).toEqual([
      { kind: 'changed', area: 'endpoint', at: '#/paths/~1pets/get', message: 'endpoint GET /pets (listPets)', depth: 0 },
      { kind: 'changed', area: 'endpoint', at: '#/paths/~1pets/get/summary', message: 'summary: "List pets" -> "List every pet"', depth: 1 },
      { kind: 'added', area: 'endpoint', at: '#/paths/~1pets/get/deprecated', message: 'deprecated: true', depth: 1 },
      { kind: 'added', area: 'endpoint', at: '#/paths/~1pets/get/parameters|"query"/"limit"', message: 'parameter limit (query) added', depth: 1 },
      { kind: 'added', area: 'endpoint', at: '#/paths/~1pets/get/requestBody', message: 'request body added', depth: 1 },
      { kind: 'changed', area: 'endpoint', at: '#/paths/~1pets/get/responses/200', message: 'response 200 changed', depth: 1 },
      { kind: 'added', area: 'endpoint', at: '#/paths/~1pets/get/responses/404', message: 'response 404 added', depth: 1 },
      { kind: 'added', area: 'endpoint', at: '#/paths/~1pets/get/x-rate-limit', message: 'x-rate-limit: 10', depth: 1 },
    ]);
    const atOld = diffOpenApiDocuments(newer as any, base as any);
    expect(atOld.changes.some((entry) => entry.kind === 'removed' && entry.message === 'parameter limit (query) removed')).toBe(true);
    expect(atOld.changes.some((entry) => entry.message === 'response 404 removed')).toBe(true);
    expect(atOld.changes.some((entry) => entry.message === 'request body removed')).toBe(true);
  });

  it('S-91: dialect, info, webhooks, components, document fields, and root extensions are compared', () => {
    const oldSpec = {
      swagger: '2.0', info: { title: 'Pets', version: '1' },
      paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } } },
      definitions: { Pet: { type: 'object' } }, 'x-logo': 'a',
    };
    const newSpec = {
      openapi: '3.1.0', info: { title: 'Pets API', version: '1' },
      paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } } },
      webhooks: { signed: { post: { operationId: 'hookSigned', responses: { '202': { description: 'ok' } } } } },
      components: { schemas: { Pet: { type: 'object', required: ['name'] }, Owner: { type: 'object' } } },
      servers: [{ url: 'https://api.example.com' }], 'x-logo': 'b',
    };
    const result = diffOpenApiDocuments(oldSpec as any, newSpec as any);
    const messages = result.changes.map((change) => change.message);
    expect(messages).toContain('dialect: swagger 2.0 -> openapi 3.1.0');
    expect(messages).toContain('info.title: "Pets" -> "Pets API"');
    expect(messages).toContain('webhook POST signed (hookSigned)');
    expect(messages).toContain('component Owner');
    expect(messages).toContain('component Pet: schema changed');
    expect(messages).toContain('servers: added');
    expect(messages).toContain('x-logo: "a" -> "b"');
    const petChange = result.changes.find((change) => change.message === 'component Pet: schema changed');
    expect(petChange?.at).toBe('#/components/schemas/Pet');
    // cross-dialect comparison keeps the removed component at the before-side dialect container pointer
    const noneLeft = diffOpenApiDocuments(newSpec as any, oldSpec as any);
    const removedOwner = noneLeft.changes.find((change) => change.kind === 'removed' && change.area === 'component');
    expect(removedOwner?.message).toBe('component Owner');
    expect(removedOwner?.at).toBe('#/components/schemas/Owner');
  });

  it('S-91: documents without shared changes are not flagged, including a changed-but-equal webhook section', () => {
    const withHook = {
      openapi: '3.1.0', info: { title: 'T', version: '1' },
      paths: {}, webhooks: { signed: { post: { operationId: 'hookSigned', responses: { '202': { description: 'ok' } } } } },
    };
    const shuffledHook = {
      openapi: '3.1.0', info: { title: 'T', version: '1' },
      webhooks: { signed: { post: { responses: { '202': { description: 'ok' } }, operationId: 'hookSigned' } } },
      paths: {},
    };
    expect(diffOpenApiDocuments(withHook as any, shuffledHook as any).identical).toBe(true);
    const removedHook = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} };
    const result = diffOpenApiDocuments(withHook as any, removedHook as any);
    expect(result.changes).toEqual([{ kind: 'removed', area: 'webhook', at: '#/webhooks/signed/post', message: 'webhook POST signed (hookSigned)', depth: 0 }]);
  });

  it('S-91: component registries are compared per name with dialect-aligned pointers (round 6)', () => {
    const oldSpec = {
      swagger: '2.0', info: { title: 'T', version: '1' }, paths: {},
      securityDefinitions: { key: { type: 'basic' } }, parameters: { P: { name: 'p', in: 'query', type: 'string' } },
    };
    const newSpec = {
      openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {},
      components: {
        securitySchemes: { key: { type: 'http', scheme: 'bearer' } },
        parameters: { P: { name: 'p', in: 'query', schema: { type: 'string' } } },
        requestBodies: { R: { content: { 'application/json': {} } } },
        schemas: {},
      },
    };
    const result = diffOpenApiDocuments(oldSpec as any, newSpec as any);
    expect(result.changes).toEqual([
      { kind: 'changed', area: 'dialect', at: '#', message: 'dialect: swagger 2.0 -> openapi 3.1.0', depth: 0 },
      { kind: 'changed', area: 'component', at: '#/components/parameters/P', message: 'parameter P changed', depth: 0 },
      { kind: 'changed', area: 'component', at: '#/components/securitySchemes/key', message: 'security scheme key changed', depth: 0 },
      { kind: 'added', area: 'component', at: '#/components/requestBodies/R', message: 'request body R', depth: 0 },
    ]);
    const backwards = diffOpenApiDocuments(newSpec as any, oldSpec as any);
    expect(backwards.changes.find((change) => change.message === 'request body R')).toMatchObject({ kind: 'removed', at: '#/components/requestBodies/R' });
    // same-dialect 2.0 change keeps the 2.0 pointer on both sides
    const two = diffOpenApiDocuments(oldSpec as any, { ...oldSpec, securityDefinitions: { key: { type: 'apiKey', in: 'header', name: 'X' } } } as any);
    expect(two.changes).toEqual([{ kind: 'changed', area: 'component', at: '#/securityDefinitions/key', message: 'security scheme key changed', depth: 0 }]);
  });

  it('S-91: path-item and webhook-item metadata, path extensions, and x- webhook entries are visible (round 6)', () => {
    const oldSpec = {
      openapi: '3.1.0', info: { title: 'T', version: '1' },
      paths: {
        '/a': { summary: 'A group', description: 'docs', get: { operationId: 'aGet', responses: { '200': { description: 'ok' } } } },
        '/b': { $ref: '#/components/pathItems/P' },
        'x-note': 'hi',
      },
      components: { pathItems: { P: { summary: 'older-path-item', get: { operationId: 'bGet', responses: { '200': { description: 'ok' } } } } }, schemas: {} },
      webhooks: { signed: { summary: 'A', post: { operationId: 'hook', responses: { '202': { description: 'ok' } } } }, 'x-empty': {} },
    };
    const newer = JSON.parse(JSON.stringify(oldSpec));
    newer.paths['/a'].summary = 'Renamed group';
    newer.paths['/a'] = { ...newer.paths['/a'], 'x-extra': true };
    newer.components.pathItems.P.summary = 'newer-path-item';
    newer.webhooks.signed.summary = 'B';
    delete newer.paths['x-note'];
    delete newer.webhooks['x-empty'];
    const result = diffOpenApiDocuments(oldSpec as any, newer as any);
    const messages = result.changes.map((change) => `${change.kind} ${change.message}`);
    expect(messages).toContain('changed path item /a: summary "A group" -> "Renamed group"');
    expect(messages).toContain('added path item /a: x-extra true added');
    expect(messages).toContain('changed path item /b: summary "older-path-item" -> "newer-path-item"');
    expect(messages).toContain('removed path extension x-note removed');
    expect(messages).toContain('changed webhook signed: summary "A" -> "B"');
    expect(messages).toContain('removed webhook extension x-empty removed');
    expect(messages).toContain('changed path item P changed');
    // deterministic section order: path metadata before operations, registries after schemas
    const pathItem = result.changes.findIndex((change) => change.message.startsWith('path item /a:'));
    const registry = result.changes.findIndex((change) => change.message === 'path item P changed');
    expect(pathItem).toBeGreaterThanOrEqual(0);
    expect(registry).toBeGreaterThan(pathItem);
  });

  it('S-91: broken $ref chains in compared items fail with the generation-era typed codes (round 6)', () => {
    expect(() => diffOpenApiDocuments(
      { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: { '/a': { $ref: '#/components/pathItems/NOPE' } }, components: { pathItems: { X: { get: { operationId: 'x', responses: { '200': { description: 'ok' } } } } } } } as any,
      { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} } as any,
    )).toThrowError(expect.objectContaining({ code: 'ZOPIA_REF_NOT_FOUND' }));
    expect(() => diffOpenApiDocuments(
      { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: { '/a': { summary: 'x', get: { operationId: 'x', responses: { '200': { description: 'ok' } } } } }, components: { pathItems: { X: { get: { operationId: 'x', responses: { '200': { description: 'ok' } } } } } } } as any,
      { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: { '/a': { $ref: '#/paths/~1a' } }, components: { pathItems: {} } } as any,
    )).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_PATH_REF' }));
  });

  it('S-91: broken $ref shapes inside compared documents fail with typed errors (round 9 coverage)', () => {
    const doc = (item: unknown) => ({ openapi: '3.1.0' as const, info: { title: 'T', version: '1' }, paths: { '/a': item }, components: { schemas: {} } });
    for (const [broken, code] of [
      [{ $ref: '' }, 'ZOPIA_SPEC_PATH_REF'],
      [{ $ref: 5 }, 'ZOPIA_SPEC_PATH_REF'],
    ] as const) {
      expect(() => diffOpenApiDocuments(doc(broken) as any, doc(broken) as any)).toThrow(code);
    }
  });

  it('S-91: unreadable or invalid inputs fail with typed errors at the offending input', async () => {
    const missing = await diffOpenApiSpecs('/nonexistent/old-spec.json', JSON.stringify(base)).then(
      () => { throw new Error('must throw'); },
      (error) => error,
    );
    expect(missing).toBeInstanceOf(ZopiaError);
    expect(['ZOPIA_SPEC_INVALID_JSON', 'ZOPIA_SPEC_INVALID', 'ZOPIA_FS_READ_FAILED', 'ZOPIA_READ_FAILED']).toContain((missing as ZopiaError).code);
    const invalid = await diffOpenApiSpecs('{not json', JSON.stringify(base)).catch((error) => error);
    expect((invalid as ZopiaError).code).toBe('ZOPIA_SPEC_INVALID_JSON');
  });

  function captureOutput(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { stdout, stderr, output: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
  }

  it('S-91: the CLI prints glyphs to stdout, stays silent on stderr, and exits 0 for differences', async () => {
    const directory = await temporaryDirectory();
    const before = join(directory, 'old.json');
    const after = join(directory, 'new.json');
    await writeFile(before, JSON.stringify(base), 'utf8');
    const changed = { ...base, info: { title: 'Pets API', version: '1' }, components: { schemas: { Pet: { type: 'object' }, Owner: { type: 'string' } } } };
    await writeFile(after, JSON.stringify(changed), 'utf8');
    const capture = captureOutput();
    await runCli(['diff', before, after], capture.output);
    expect(capture.stderr).toEqual([]);
    expect(capture.stdout.map((line) => line.trim())).toEqual([
      '~ info.title: "Pets" -> "Pets API"',
      '+ component Owner',
      `zopia diff ${before} ${after}: 2 changes (1 added, 0 removed, 1 changed)`,
    ]);
    expect(process.exitCode).toBeFalsy();

    const same = captureOutput();
    await runCli(['diff', before, before], same.output);
    expect(same.stdout).toEqual([`zopia diff ${before} ${before}: identical (0 changes)\n`]);
  });

  it('S-91: CLI grammar rejects missing/extra positionals and unknown options, and --help lists diff', async () => {
    const capture = captureOutput();
    await expect(runCli(['diff', 'one.json'], capture.output)).rejects.toThrow('diff requires <old.json|old.yaml> and <new.json|new.yaml>');
    await expect(runCli(['diff', 'one.json', 'two.json', 'three.json'], capture.output)).rejects.toThrow('unexpected diff argument: three.json');
    await expect(runCli(['diff', 'one.json', 'two.json', '--deep'], capture.output)).rejects.toThrow('unknown diff option: --deep');
    const help = captureOutput();
    await runCli(['--help'], help.output);
    expect(help.stdout.join('')).toContain('zopia diff <old.json|old.yaml> <new.json|new.yaml>');
  });
});
