import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadNavigationIndex, navigationIndexFromManifest, openApiToApiDocs, specPointerAtLine, specPointerToLine, specPointersToLines, ZopiaError } from '../src';
import { runCli, type ZopiaCliOutput } from '../src/cli-command';

const temporaryDirectory = useTemporaryDirectories('zopia-navigation-');

const SPEC = {
  openapi: '3.1.0',
  info: { title: 'Shop', version: '1' },
  paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } }, post: { operationId: 'addPet', responses: { '201': { description: 'ok' } } } } },
  webhooks: { signed: { post: { operationId: 'hookSigned', responses: { '202': { description: 'ok' } } } } },
  components: { schemas: { Pet: { type: 'object' } } },
} as const;

function capture(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, output: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
}

describe('spec ↔ tree navigation (Phase 3, S-93)', () => {
  it('S-93: the index answers both directions exactly, including companions, barrels, and the manifest', async () => {
    const outputDir = await temporaryDirectory();
    await openApiToApiDocs(SPEC as any, { outDir: outputDir, custom: true, insertComponents: true });
    const index = await loadNavigationIndex(outputDir);
    expect(index.specToLocations('#/paths/~1pets/get')).toEqual([
      { kind: 'endpoint', file: 'pets/get/index.ts', pointer: '#/paths/~1pets/get', label: 'get /pets (listPets)' },
      { kind: 'custom', file: 'pets/get/custom.ts', pointer: '#/paths/~1pets/get', label: 'get /pets (listPets) custom companion' },
    ]);
    expect(index.specToLocations('#/webhooks/signed/post').map((location) => location.file)).toEqual(['webhooks/signed/post/index.ts', 'webhooks/signed/post/custom.ts']);
    expect(index.specToLocations('#/components/schemas/Pet')).toEqual([{ kind: 'component', file: 'components/Pet/index.ts', pointer: '#/components/schemas/Pet', label: 'component Pet' }]);
    expect(index.specToLocations('#')).toEqual([{ kind: 'manifest', file: '.zopia-manifest.json', pointer: '#', label: 'manifest' }]);
    expect(index.treeToSpecLocation('pets/post/custom.ts')).toMatchObject({ kind: 'custom', pointer: '#/paths/~1pets/post' });
    expect(index.treeToSpecLocation('.\\pets\\get\\index.ts')).toMatchObject({ kind: 'endpoint', pointer: '#/paths/~1pets/get' });
    expect(index.treeToSpecLocation('./components/index.ts')).toMatchObject({ pointer: '#/components/schemas' });
    expect(index.treeToSpecLocation('.zopia-manifest.json')).toMatchObject({ pointer: '#' });
    expect(index.pointerForOperationId('hookSigned')).toBe('#/webhooks/signed/post');
    expect(index.pointerForOperationId('unknown')).toBeUndefined();
    // deterministic full jump table, file-sorted
    expect(index.locations().map((location) => location.file)).toEqual(index.locations().map((location) => location.file).sort());
  });

  it('S-93: the schema barrel navigates even when no component modules exist', async () => {
    const outputDir = await temporaryDirectory();
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Empty Components', version: '1' },
      paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } } },
    } as any, { outDir: outputDir, insertComponents: true });
    const index = await loadNavigationIndex(outputDir);
    // insertComponents always emits the schema barrel, even when the container is empty.
    expect(index.treeToSpecLocation('components/index.ts')).toMatchObject({ kind: 'component', pointer: '#/components/schemas' });
    expect(index.specToLocations('#/components/schemas')).toEqual([{ kind: 'component', file: 'components/index.ts', pointer: '#/components/schemas', label: 'component barrel' }]);
  });

  it('S-93: flat layouts and preset bucket roots navigate identically', async () => {
    const flatDir = await temporaryDirectory();
    await openApiToApiDocs(SPEC as any, { outDir: flatDir, mode: 'flat' });
    const flat = await loadNavigationIndex(flatDir);
    expect(flat.specToLocations('#/webhooks/signed/post')).toEqual([{ kind: 'webhook', file: 'webhooks-signed/post/index.ts', pointer: '#/webhooks/signed/post', label: 'webhook signed post (hookSigned)' }]);
    const presetDir = await temporaryDirectory();
    await openApiToApiDocs({
      ...SPEC,
      paths: { '/pets': { get: { ...SPEC.paths['/pets'].get, tags: ['pets'] }, post: { ...SPEC.paths['/pets'].post, tags: ['stores'] } } },
    } as any, { outDir: presetDir, preset: 'multi-tag' });
    // each bucket root carries its own manifest and therefore its own index
    const bucket = await loadNavigationIndex(join(presetDir, 'pets'));
    expect(bucket.specToLocations('#/paths/~1pets/get')).toEqual([
      { kind: 'endpoint', file: 'pets/get/index.ts', pointer: '#/paths/~1pets/get', label: 'get /pets (listPets)' },
    ]);
    expect(bucket.locations().map((location) => location.kind)).toEqual(['manifest', 'endpoint']);
  });

  it('S-93: item-level pointers enumerate every routed operation of the item (round 8)', async () => {
    const outputDir = await temporaryDirectory();
    await openApiToApiDocs(SPEC as any, { outDir: outputDir, custom: true });
    const index = await loadNavigationIndex(outputDir);
    // '#/paths/<path>' is documented to answer every method of the item — and does
    expect(index.specToLocations('#/paths/~1pets').map((location) => `${location.file}:${location.pointer}`)).toEqual([
      'pets/get/custom.ts:#/paths/~1pets/get',
      'pets/get/index.ts:#/paths/~1pets/get',
      'pets/post/custom.ts:#/paths/~1pets/post',
      'pets/post/index.ts:#/paths/~1pets/post',
    ]);
    expect(index.specToLocations('#/webhooks/signed').map((location) => location.pointer)).toEqual(['#/webhooks/signed/post', '#/webhooks/signed/post']);
    // unknown items stay typed errors; over-deep pointers stay unsupported
    expect(() => index.specToLocations('#/paths/~1nope')).toThrow(/spec pointer has no generated module/);
    expect(() => index.specToLocations('#/paths/~1pets/get/extra')).toThrow(/unsupported spec pointer/);
  });

  it('S-93: unknown pointers and files fail with typed, actionable errors', async () => {
    const outputDir = await temporaryDirectory();
    await openApiToApiDocs(SPEC as any, { outDir: outputDir });
    const index = await loadNavigationIndex(outputDir);
    const illegal = [
      () => index.specToLocations('#/paths/~1pets/delete'),
      () => index.specToLocations('#/info/title'),
      () => index.specToLocations('#/components/schemas/Missing'),
      () => index.specToLocations('#/components/schemas/Pet'), // Pet declared but components emission disabled
      () => index.treeToSpecLocation('bogus.ts'),
    ];
    for (const attempt of illegal) expect(attempt).toThrow(/spec pointer has no generated module|unsupported spec pointer|file is not represented|declares no generated module/);
    for (const attempt of illegal) expect(attempt).toThrow(ZopiaError);
    try { index.specToLocations('#/components/schemas/Pet'); expect.unreachable(); } catch (error) { expect((error as ZopiaError).hint).toContain('insertComponents'); }
    // manifest loading layer
    await expect(loadNavigationIndex(join(outputDir, 'missing'))).rejects.toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST' } satisfies Partial<ZopiaError>);
    const broken = join(outputDir, 'broken');
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, '.zopia-manifest.json'), '{ not json', 'utf8');
    await expect(loadNavigationIndex(broken)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID' } satisfies Partial<ZopiaError>);
    await writeFile(join(broken, '.zopia-manifest.json'), '{"apis:":true}', 'utf8');
    expect(() => navigationIndexFromManifest({} as any)).toThrow(/apis array/);
  });

  it('S-93: pointer→line scanning is exact, one-pass, and side-effect free', () => {
    const pretty = JSON.stringify(SPEC, null, 2);
    const lines = specPointersToLines(pretty, ['#/paths/~1pets/get', '#/paths/~1pets/post', '#/webhooks/signed/post', '#/components/schemas/Pet']);
    for (const [pointer, line] of lines) expect(pretty.split('\n')[line - 1]).toMatch(new RegExp(pointer.includes('schemas') ? '"Pet"' : `"${pointer.split('/').pop()?.replace(/~1/g, '/')}"`));
    expect(lines.get('#/paths/~1pets/get')).toBe(9);
    // minified documents scan at line 1 without special-casing
    expect(specPointerToLine(JSON.stringify(SPEC), '#/paths/~1pets/get')).toBe(1);
    // undeclared pointers simply stay absent
    expect(specPointerToLine(pretty, '#/paths/~1admin/get')).toBeUndefined();
    // escaped segments round-trip through RFC 6901 decoding
    const escaped = JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/a~b/c': { get: {} } } });
    expect(specPointerToLine(escaped, '#/paths/~1a~0b~1c/get')).toBe(1);
    expect(() => specPointersToLines('{"a":}', ['#/a'])).toThrow(ZopiaError);
    for (const malformedScalar of ['{"a": tru}', '{"a": 01}', '{"a": -}', '{"a": nullx}', '{"a": 1e}', '{"a":\f1}', '{"a":\v1}']) {
      expect(() => specPointersToLines(malformedScalar, ['#/a'])).toThrow(ZopiaError);
    }
    try { specPointersToLines('{"a":}', ['#/a']); } catch (error) { expect((error as ZopiaError).code).toBe('ZOPIA_SPEC_INVALID_JSON'); }
  });

  it('S-93: scanning tolerates nested arrays and rejects malformed array bodies (round 9)', () => {
    const withArrays = JSON.stringify({
      openapi: '3.1.0', info: { title: 'T', version: '1' },
      paths: { '/pets': { get: { operationId: 'listPets', tags: ['pets', 'animals]', '"quoted"'], security: [{ key: [] }], servers: [], responses: { '200': { description: 'ok' } } } } },
      servers: [{ url: 'https://a.example.com', variables: { base: { enum: ['a', 'b'], default: 'a' } } }, {}],
    });
    expect(specPointerToLine(withArrays, '#/paths/~1pets/get')).toBeTypeOf('number');
    // object-keys with array values map like any other key; only positions INSIDE arrays stay unmappable
    expect(specPointerToLine(withArrays, '#/servers')).toBeTypeOf('number');
    expect(specPointerToLine(withArrays, '#/paths/~1pets/get/tags')).toBeTypeOf('number');
    expect(specPointerToLine(withArrays, '#/nope')).toBeUndefined();
    expect(() => specPointersToLines('{"a":[1,}', ['#/a'])).toThrow(ZopiaError);
    expect(() => specPointersToLines('{"a":[', ['#/a'])).toThrow(ZopiaError);
    expect(() => specPointersToLines('', ['#/a'])).toThrow(ZopiaError);
    expect(() => specPointersToLines('[1,2]', ['#/a'])).not.toThrow();
    expect(() => specPointersToLines('{"a" 1}', ['#/a'])).toThrow(ZopiaError);
    expect(() => specPointersToLines('{"a":1,}', ['#/a'])).toThrow(ZopiaError);
    expect(() => specPointersToLines('{"a":"x\\nz"}', ['#/a'])).not.toThrow();
    expect(() => specPointersToLines('{"a":"x\n' + '\n' + 'z"}', ['#/a'])).toThrow(ZopiaError);
    expect(() => specPointersToLines('{"a":"unterminated', ['#/a'])).toThrow(ZopiaError);
    // '#' root pointers and non-fragment shapes simply never match
    expect(specPointerToLine('{"a":1}', '#')).toBeUndefined();
  });

  it('S-93: specPointerAtLine picks the nearest declaration at-or-before the cursor, deterministically', () => {
    const pretty = JSON.stringify(SPEC, null, 2);
    const pointers = ['#/paths/~1pets/get', '#/paths/~1pets/post', '#/webhooks/signed/post', '#/components/schemas/Pet'];
    const getLine = specPointerToLine(pretty, '#/paths/~1pets/get');
    expect(getLine).toBeDefined();
    expect(specPointerAtLine(pretty, (getLine as number) + 4, pointers)).toBe('#/paths/~1pets/get');
    expect(specPointerAtLine(pretty, 1_000, pointers)).toBe('#/components/schemas/Pet');
    expect(specPointerAtLine(pretty, 1, pointers)).toBeUndefined();
    // order of candidates does not change the winner
    expect(specPointerAtLine(pretty, (getLine as number) + 4, [...pointers].reverse())).toBe('#/paths/~1pets/get');
  });

  it('S-93: pure manifest-shape guards — malformed entries skip, first operationId wins, labels omit absent ids (round 9 coverage)', () => {
    const index = navigationIndexFromManifest({
      apis: [
        null,
        42,
        { file: undefined, path: '/legacy', method: 'get', operationId: 'legacyOp' },
        { file: 'a/get/index.ts', path: '/a', method: 'get' },
        { file: 'b/get/index.ts', path: '/b', method: 'get', operationId: 'dupe' },
        { file: 'c/get/index.ts', path: '/c', method: 'get', operationId: 'dupe' },
        { file: 'malformed/get/index.ts', path: 42, method: 'get' },
      ],
      webhooks: [null, { file: 'webhooks/h/post/index.ts', name: 'h', method: 'post' }, { file: 'webhooks/bad/post/index.ts', name: 42, method: 'post' }],
      components: [null, { file: 'components/Thing/index.ts', name: 'Thing' }, { file: undefined, name: 'Ghost' }, { file: 'components/Nameless/index.ts' }],
      options: {},
    } as any);
    // malformed entries and legacy file-less records skip; the first operationId occurrence wins
    expect(index.locations().map((location) => location.file)).toEqual([
      '.zopia-manifest.json',
      'a/get/index.ts',
      'b/get/index.ts',
      'c/get/index.ts',
      'components/Thing/index.ts',
      'components/index.ts',
      'webhooks/h/post/index.ts',
    ]);
    expect(index.pointerForOperationId('dupe')).toBe('#/paths/~1b/get');
    expect(index.pointerForOperationId('legacyOp')).toBeUndefined();
    // labels omit the parenthesized id when none was declared
    expect(index.treeToSpecLocation('a/get/index.ts').label).toBe('get /a');
    expect(index.treeToSpecLocation('webhooks/h/post/index.ts').label).toBe('webhook h post');
    // every unsupported pointer shape keeps its dedicated hint branch
    const shapes: [string, string][] = [
      ['#/paths', 'unsupported spec pointer for navigation'],
      ['#/paths/~1a/get/extra', 'unsupported spec pointer for navigation'],
      ['#/~1sneaky', 'unsupported spec pointer for navigation'],
      ['ambient', 'unsupported spec pointer for navigation'],
      ['#/components/schemas/Oops/extra', 'unsupported spec pointer for navigation'],
      ['#/components/things/Thing', 'unsupported spec pointer for navigation'],
      ['#/', 'unsupported spec pointer for navigation'],
      ['#/components', 'unsupported spec pointer for navigation'],
      ['#/webhooks/ghost/post', 'spec pointer has no generated module'],
      ['#/components/schemas/Ghost', 'declares no generated module'],
    ];
    for (const [pointer, message] of shapes) expect(() => index.specToLocations(pointer)).toThrow(message);
    // the unheard-webhook failure mentions webhooks, not paths
    try { index.specToLocations('#/webhooks/ghost/post'); expect.unreachable(); } catch (error) { expect((error as ZopiaError).hint).toContain('webhook'); }
  });

  it('S-93: CLI navigate prints stable lines both directions and rejects bad grammar', async () => {
    const directory = await temporaryDirectory();
    await openApiToApiDocs(SPEC as any, { outDir: directory, custom: true });

    const code = capture();
    await runCli(['navigate', directory, '--to-code', '#/paths/~1pets/get'], code.output);
    expect(code.stdout).toEqual([
      `zopia navigate ${directory} --to-code #/paths/~1pets/get: pets/get/index.ts (get /pets (listPets))\n`,
      `zopia navigate ${directory} --to-code #/paths/~1pets/get: pets/get/custom.ts (get /pets (listPets) custom companion)\n`,
    ]);

    const spec = capture();
    await runCli(['navigate', directory, '--to-spec', 'pets/post/index.ts'], spec.output);
    expect(spec.stdout).toEqual([`zopia navigate ${directory} --to-spec pets/post/index.ts: #/paths/~1pets/post (post /pets (addPet))\n`]);

    await expect(runCli(['navigate', directory], capture().output)).rejects.toThrow(/requires --to-code or --to-spec/);
    await expect(runCli(['navigate', directory, '--to-code #/paths/~1pets/get'], capture().output)).rejects.toThrow();
    await expect(runCli(['navigate', directory, '--to-code', '#/a', '--to-spec', 'x.ts'], capture().output)).rejects.toThrow(/either --to-code or --to-spec/);
    await expect(runCli(['navigate', directory, '--to-code', '#/paths/~1pets/get', '--to-code', '#/x'], capture().output)).rejects.toThrow(/already provided|--to-code/m);
    await expect(runCli(['navigate', directory, '--bogus'], capture().output)).rejects.toThrow(/unknown navigate option/);
    await expect(runCli(['navigate', directory, '--to-code', '#/paths/~1nope/get'], capture().output)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID' } satisfies Partial<ZopiaError>);

    const help = capture();
    await runCli(['--help'], help.output);
    expect(help.stdout.join('')).toContain('zopia navigate <docs-dir>');
    try { await runCli(['nope'], capture().output); expect.unreachable(); } catch (error) { expect((error as ZopiaError).hint).toContain('zopia navigate'); }
  });
});
