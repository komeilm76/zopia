import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifestFileToOpenApi, openApiToApiDocs } from '../src';
import { runCli } from '../src/cli-command';
import { bundleExternalOpenApiRefs } from '../src/conversions/openapi-external-ref';
import type { OpenApiDocument } from '../src/conversions/openapi';
import { parseYaml } from '../src/conversions/yaml';
import { useTemporaryDirectories } from './test-temporary-directories';

const fixturesDirectory = join(import.meta.dirname, 'fixtures', 'specs');
const externalSpec = join(fixturesDirectory, 'external-refs', 'admin-3.0.yaml');
const inlineSpec = join(fixturesDirectory, 'external-refs-inline', 'admin-3.0-inline.json');
const temporaryDirectory = useTemporaryDirectories('zopia-external-refs-');

const document = (paths: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  openapi: '3.1.0',
  info: { title: 'External API', version: '1.0.0' },
  paths,
  ...extra,
});

const refResponse = (ref: string) => ({
  '/item': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: ref } } } } } } },
});

/** Seed one spec directory: a root document plus any sibling files it may reference. */
async function seedSpec(root: Record<string, unknown>, siblings: Record<string, string> = {}): Promise<string> {
  const directory = await temporaryDirectory();
  await writeFile(join(directory, 'openapi.json'), JSON.stringify(root), 'utf8');
  for (const [name, text] of Object.entries(siblings)) await writeFile(join(directory, name), text, 'utf8');
  return join(directory, 'openapi.json');
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

describe('external $ref bundling (D-17)', () => {
  it('S-79: bundles cross-file YAML and JSON chains without mutating the input document', async () => {
    const original = parseYaml(await readFile(externalSpec, 'utf8')) as OpenApiDocument;
    const snapshot = JSON.stringify(original);
    const bundled = await bundleExternalOpenApiRefs(original, externalSpec);
    const inline = JSON.parse(await readFile(inlineSpec, 'utf8'));

    expect(bundled).toEqual(inline);
    expect(bundled).not.toBe(original);
    expect(JSON.stringify(original)).toBe(snapshot); // host document untouched
    // Cloned twice: both User occurrences are equal but never share object identity.
    const first = (bundled.paths as any)['/users'].get.responses['200'].content['application/json'].schema.properties.items.items;
    const second = (bundled.paths as any)['/users/{id}'].patch.responses['200'].content['application/json'].schema;
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('S-79: generates byte-identical trees from external-ref and inline specs, with identical warnings', async () => {
    const externalOut = await temporaryDirectory();
    const inlineOut = await temporaryDirectory();
    const externalResult = await openApiToApiDocs(externalSpec, { outDir: externalOut });
    const inlineResult = await openApiToApiDocs(inlineSpec, { outDir: inlineOut });

    expect(externalResult.warnings).toEqual(inlineResult.warnings);
    expect(externalResult.files).toEqual(inlineResult.files);
    expect(await treeSnapshot(externalOut)).toEqual(await treeSnapshot(inlineOut));
  });

  it('S-79: reversal emits the bundled single-file document (no re-split, D-17)', async () => {
    const externalOut = await temporaryDirectory();
    await openApiToApiDocs(externalSpec, { outDir: externalOut });
    const reversed = await manifestFileToOpenApi(join(externalOut, '.zopia-manifest.json'));
    const inline = JSON.parse(await readFile(inlineSpec, 'utf8'));

    expect(canonicalize(reversed)).toEqual(canonicalize(inline));
    // A reversed document regenerates the same tree, proving single-file parity.
    const regenerated = await temporaryDirectory();
    await openApiToApiDocs(reversed, { outDir: regenerated });
    expect(await treeSnapshot(regenerated)).toEqual(await treeSnapshot(externalOut));
  });

  it('S-79: the CLI resolves external references for spec file paths', async () => {
    const outDir = await temporaryDirectory();
    const stdout: string[] = [];
    const stderr: string[] = [];
    await runCli(['generate', externalSpec, outDir], { stdout: (chunk) => stdout.push(chunk), stderr: (chunk) => stderr.push(chunk) });
    const inlineOut = await temporaryDirectory();
    const inlineStderr: string[] = [];
    await runCli(['generate', inlineSpec, inlineOut], { stdout: () => {}, stderr: (chunk) => inlineStderr.push(chunk) });

    // The external-ref run reports exactly the same diagnostics as the equivalent inline run.
    expect(stderr.length).toBeGreaterThan(0); // int64 overlays, same as the twin
    expect(stderr).toEqual(inlineStderr);
    expect(await treeSnapshot(outDir)).toEqual(await treeSnapshot(inlineOut));
  });

  it('S-79: manifest staleness reacts to edits of referenced sibling files', async () => {
    const directory = await temporaryDirectory();
    const specDirectory = join(directory, 'spec');
    await mkdir(specDirectory, { recursive: true });
    await cp(join(fixturesDirectory, 'external-refs'), specDirectory, { recursive: true });
    const outDir = join(directory, 'docs');

    await openApiToApiDocs(join(specDirectory, 'admin-3.0.yaml'), { outDir });
    const shared = join(specDirectory, 'shared-schemas.yaml');
    await writeFile(shared, (await readFile(shared, 'utf8')).replace('maxLength: 200', 'maxLength: 250'), 'utf8');

    const result = await openApiToApiDocs(join(specDirectory, 'admin-3.0.yaml'), { outDir });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZOPIA_WARN_STALE_TREE',
      message: expect.stringContaining('the source document changed'),
    }));
  });

  it('S-79: unsupported extension kinds and whole-file references bundle deterministically', async () => {
    const source = await seedSpec(document(refResponse('common.json#/definitions/UserId'), {
      components: { schemas: { Everything: { $ref: 'everything.yml' } } },
    }), {
      'everything.yml': 'type: string\nformat: uuid\n',
      'common.json': JSON.stringify({ definitions: { UserId: { type: 'integer', minimum: 1 } } }),
    });
    const bundled = await bundleExternalOpenApiRefs(
      JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument,
      source,
    );

    expect((bundled.components as any).schemas.Everything).toEqual({ type: 'string', format: 'uuid' });
    const schema = (bundled.paths as any)['/item'].get.responses['200'].content['application/json'].schema;
    expect(schema).toEqual({ type: 'integer', minimum: 1 });
  });

  it('S-79: self-file references stay in-document and host-local references are untouched', async () => {
    const source = await seedSpec(document(refResponse('openapi.json#/components/schemas/Local'), {
      components: { schemas: { Local: { type: 'string' }, Alias: { $ref: '#/components/schemas/Local' } } },
    }));
    const original = JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument;
    const bundled = await bundleExternalOpenApiRefs(original, source);

    expect((bundled.paths as any)['/item'].get.responses['200'].content['application/json'].schema).toEqual({ type: 'string' });
    expect((bundled.components as any).schemas.Alias).toEqual({ $ref: '#/components/schemas/Local' });
  });

  it('S-79: adjacent sibling keys win and sibling references resolve like the preflight walker', async () => {
    const source = await seedSpec(document(refResponse('shared.yaml#/Name'), {}), {
      'shared.yaml': 'Name:\n  type: string\n  minLength: 1\n',
    });
    const original = JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument;
    (original.paths as any)['/item'].get.responses['200'].content['application/json'].schema = {
      $ref: 'shared.yaml#/Name',
      description: 'documented locally',
      extension: { ignored: true },
      properties: { nickname: { $ref: 'shared.yaml#/Name' } },
    };
    const bundled = await bundleExternalOpenApiRefs(original, source);
    const schema = (bundled.paths as any)['/item'].get.responses['200'].content['application/json'].schema;

    expect(schema).toEqual({
      type: 'string',
      minLength: 1,
      description: 'documented locally',
      extension: { ignored: true },
      properties: { nickname: { type: 'string', minLength: 1 } },
    });
  });

  it('S-79: literal and example positions never resolve (2.0 examples map included)', async () => {
    const ghost = { example: { $ref: 'ghost.yaml#/Missing' }, default: 'x' };
    const swagger = document(refResponse('#/definitions/Inline'), {
      swagger: '2.0',
      info: { title: 'External API', version: '1.0.0' },
      definitions: { Inline: { type: 'string', ...ghost } },
      paths: { '/demo': { get: { responses: { '200': { description: 'ok', examples: { 'application/json': { $ref: 'ghost.yaml#/Missing' } } } } } } },
    }) as Record<string, unknown>;
    delete (swagger as Record<string, unknown>).openapi;
    const threeOne = document({}, {
      components: { schemas: { Inline: { type: 'string', ...ghost, examples: [{ $ref: 'ghost.yaml#/Missing' }] } } },
    });
    const twoZeroSource = await seedSpec(swagger);
    const threeOneSource = await seedSpec(threeOne);

    expect(await bundleExternalOpenApiRefs(JSON.parse(await readFile(twoZeroSource, 'utf8')) as OpenApiDocument, twoZeroSource)).toEqual(swagger);
    expect(await bundleExternalOpenApiRefs(JSON.parse(await readFile(threeOneSource, 'utf8')) as OpenApiDocument, threeOneSource)).toEqual(threeOne);
  });

  it('S-79: 3.x example objects shield `value` payloads but resolve referenceable examples', async () => {
    const spec = document({}, {
      components: { examples: {
        documented: { summary: 'no value payload', externalValue: 'https://docs.example/sample.json' },
        payload: { value: { $ref: 'ghost.yaml#/Missing' } },
        reusable: { $ref: 'shared.yaml#/Name' },
      } },
    });
    const source = await seedSpec(spec, { 'shared.yaml': 'Name:\n  summary: bundled example\n' });

    const bundled = await bundleExternalOpenApiRefs(JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument, source);
    expect((bundled.components as any).examples).toEqual({
      documented: { summary: 'no value payload', externalValue: 'https://docs.example/sample.json' },
      payload: { value: { $ref: 'ghost.yaml#/Missing' } },
      reusable: { summary: 'bundled example' },
    });
  });

  it('S-80: a non-string $ref passes bundling untouched and fails in preflight', async () => {
    const source = await seedSpec(document({}, {
      components: { schemas: { Broken: { $ref: 42 } } },
    }));
    await expect(openApiToApiDocs(source, { outDir: await temporaryDirectory() })).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('non-empty string'),
    });
  });

  it('S-80: bundling rejects non-object documents before walking', async () => {
    for (const value of [null, [], 'x', 42]) {
      await expect(bundleExternalOpenApiRefs(value as unknown as OpenApiDocument, 'unused.json')).rejects.toMatchObject({
        code: 'ZOPIA_SPEC_INVALID',
        at: '#',
      });
    }
  });

  it('S-80: object and text inputs keep rejecting external references (back-compat)', async () => {
    const outDir = await temporaryDirectory();
    const spec = document({}, { components: { schemas: { External: { $ref: './other.json#/Thing' } } } });
    await expect(openApiToApiDocs(spec, { outDir: join(outDir, 'object') })).rejects.toMatchObject({
      code: 'ZOPIA_REF_EXTERNAL',
      message: expect.stringContaining('external reference is not supported: ./other.json#/Thing'),
    });
    await expect(openApiToApiDocs(JSON.stringify(spec), { outDir: join(outDir, 'text') })).rejects.toMatchObject({
      code: 'ZOPIA_REF_EXTERNAL',
      message: expect.stringContaining('external reference is not supported: ./other.json#/Thing'),
    });
  });

  it.each([
    ['https://example.test/schemas.yaml#/User', 'URL'],
    ['../shared/schemas.yaml#/User', 'parent folder'],
    ['/opt/shared/schemas.yaml#/User', 'absolute path'],
    ['nested/schemas.yaml#/User', 'subdirectory'],
    ['C:\\shared\\schemas.yaml#/User', 'drive'],
    ['schemas.txt#/User', 'unsupported extension'],
  ])('S-80: rejects %s references with ZOPIA_REF_EXTERNAL', async (ref) => {
    const source = await seedSpec(document(refResponse(ref)));
    await expect(openApiToApiDocs(source, { outDir: await temporaryDirectory() })).rejects.toMatchObject({
      code: 'ZOPIA_REF_EXTERNAL',
      message: expect.stringContaining('outside the spec folder'),
      at: '#/paths/~1item/get/responses/200/content/application~1json/schema/$ref',
    });
  });

  it('S-80: unreadable targets fail as external references naming the file', async () => {
    const source = await seedSpec(document(refResponse('missing.yaml#/User')));
    await expect(openApiToApiDocs(source, { outDir: await temporaryDirectory() })).rejects.toMatchObject({
      code: 'ZOPIA_REF_EXTERNAL',
      message: expect.stringContaining('unable to read external reference target: missing.yaml'),
      at: '#/paths/~1item/get/responses/200/content/application~1json/schema/$ref',
    });
  });

  it('S-80: unparsable targets fail with the format code and the file as the location', async () => {
    const jsonSource = await seedSpec(document(refResponse('broken.json#/User')), { 'broken.json': '{ nope' });
    const yamlSource = await seedSpec(document(refResponse('broken.yaml#/User')), { 'broken.yaml': 'a: [1,\n' });

    await expect(openApiToApiDocs(jsonSource, { outDir: await temporaryDirectory() })).rejects.toMatchObject({
      code: 'ZOPIA_SPEC_INVALID_JSON',
      message: expect.stringContaining('broken.json'),
      at: expect.stringContaining('broken.json'),
    });
    await expect(openApiToApiDocs(yamlSource, { outDir: await temporaryDirectory() })).rejects.toMatchObject({
      code: 'ZOPIA_SPEC_INVALID_YAML',
      at: expect.stringContaining('broken.yaml'),
    });
  });

  it('S-80: unresolved pointers and bad fragments fail as reference-not-found', async () => {
    const source = await seedSpec(document(refResponse('shared.yaml#/Missing'), {
      components: { schemas: { Anchored: { $ref: 'shared.yaml#anchor' } } },
    }), { 'shared.yaml': 'Present:\n  type: string\n' });

    await expect(bundleExternalOpenApiRefs(JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument, source)).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('unresolved external reference: shared.yaml#/Missing'),
      at: '#/paths/~1item/get/responses/200/content/application~1json/schema/$ref',
    });
    const anchoredOnly = document({}, { components: { schemas: { Anchored: { $ref: 'shared.yaml#anchor' } } } });
    const anchoredSource = await seedSpec(anchoredOnly, { 'shared.yaml': 'Present:\n  type: string\n' });
    await expect(bundleExternalOpenApiRefs(JSON.parse(await readFile(anchoredSource, 'utf8')) as OpenApiDocument, anchoredSource)).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('unsupported reference fragment: shared.yaml#anchor'),
      at: '#/components/schemas/Anchored/$ref',
    });
  });

  it('S-80: circular external chains fail with the expansion path', async () => {
    const source = await seedSpec(document(refResponse('a.yaml#/Entry')), {
      'a.yaml': 'Entry:\n  back:\n    $ref: b.yaml#/Thing\n',
      'b.yaml': 'Thing:\n  again:\n    $ref: a.yaml#/Entry\n',
    });

    await expect(bundleExternalOpenApiRefs(JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument, source)).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('circular external reference: a.yaml#/Entry → b.yaml#/Thing → a.yaml#/Entry'),
    });

    // Self-file cycles through a cwd-relative spec path show bare names too (no folder prefix).
    const cycled = { a: { $ref: 'openapi.yaml#/b' }, b: { $ref: 'openapi.yaml#/a' } };
    await expect(bundleExternalOpenApiRefs(cycled as unknown as OpenApiDocument, 'openapi.yaml')).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('circular external reference: openapi.yaml#/b → openapi.yaml#/a → openapi.yaml#/b'),
    });
  });

  it('S-80: sibling keys on a scalar target fail deterministically', async () => {
    const source = await seedSpec(document(refResponse('shared.yaml#/Name')), { 'shared.yaml': 'Name:\n  type: string\n' });
    const original = JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument;
    (original.paths as any)['/item'].get.responses['200'].content['application/json'].schema = {
      $ref: 'shared.yaml#/Name/type',
      description: 'cannot annotate a scalar',
    };

    await expect(bundleExternalOpenApiRefs(original, source)).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('must target an object'),
    });
  });

  it('S-79: deep in-file structures without external refs bundle unchanged (no spurious limits)', async () => {
    let value: unknown = { type: 'string' };
    for (let index = 0; index < 600; index += 1) value = { type: 'object', properties: { node: value } };
    const spec = document({}, { components: { schemas: { Deep: value } } });
    const source = await seedSpec(spec);
    const original = JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument;

    expect(await bundleExternalOpenApiRefs(original, source)).toEqual(original);
  });

  it('S-80: expansion beyond 512 nested references fails without stack overflow', async () => {
    const siblings: Record<string, string> = {};
    for (let index = 0; index < 520; index += 1) {
      siblings[`chain-${index}.json`] = JSON.stringify(index === 519 ? { type: 'string' } : { $ref: `chain-${index + 1}.json` });
    }
    const source = await seedSpec(document(refResponse('chain-0.json')), siblings);

    await expect(openApiToApiDocs(source, { outDir: await temporaryDirectory() })).rejects.toMatchObject({
      code: 'ZOPIA_REF_NOT_FOUND',
      message: expect.stringContaining('exceeds 512'),
    });
  });
});
