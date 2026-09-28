import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateApiDocsFiles, validateZopia, ZOPIA_VALIDATION_CODES } from '../src';
import { runCli, runCliEntrypoint, type ZopiaCliOutput } from '../src/cli-command';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories('zopia-validate-');

const petSpec: Record<string, unknown> = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { operationId: 'listPets', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } },
    },
  },
  components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
};

function captureOutput(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, output: { stdout: (content) => stdout.push(content), stderr: (content) => stderr.push(content) } };
}

/** Install a sentinel km-api next to a temporary tree so peer-drift probing is hermetic. */
async function seedKmApi(directory: string, version: string): Promise<void> {
  await mkdir(join(directory, 'node_modules', 'km-api'), { recursive: true });
  await writeFile(join(directory, 'node_modules', 'km-api', 'package.json'), JSON.stringify({ name: 'km-api', version }), 'utf8');
}

describe('zopia validate (S-89, Phase 3)', () => {
  it('reports a clean 3.1 spec with ok and no diagnostics', async () => {
    const result = await validateZopia(petSpec);
    expect(result).toEqual({ ok: true, kind: 'spec', target: '(in-memory document)', diagnostics: [] });
  });

  it('accepts YAML spec text', async () => {
    const result = await validateZopia('openapi: 3.0.3\ninfo:\n  title: Y\n  version: "1"\npaths: {}\n');
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('spec');
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps a schema referenced through a node shared between example and schema positions reachable', async () => {
    // In-memory documents can share one object instance across positions; the lint
    // must still see the schema-position occurrence after visiting the example one.
    const sharedRef = { $ref: '#/components/schemas/Pet' } as Record<string, unknown>;
    const result = await validateZopia({
      ...petSpec,
      paths: {
        '/pets': {
          get: { operationId: 'listPets', responses: { '200': { description: 'ok', content: { 'application/json': { example: sharedRef, schema: sharedRef } } } } },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('flags unreachable 3.1 components, including chains reachable only from other orphans', async () => {
    const result = await validateZopia({
      ...petSpec,
      components: {
        schemas: {
          Pet: { type: 'object' },
          Orphan: { type: 'string' },
          AlsoOrphan: { $ref: '#/components/schemas/OrphanChild' },
          OrphanChild: { type: 'number' },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      { severity: 'warning', code: 'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT', at: '#/components/schemas/AlsoOrphan', message: 'component is never referenced: AlsoOrphan' },
      { severity: 'warning', code: 'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT', at: '#/components/schemas/Orphan', message: 'component is never referenced: Orphan' },
      { severity: 'warning', code: 'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT', at: '#/components/schemas/OrphanChild', message: 'component is never referenced: OrphanChild' },
    ]);
  });

  it('keeps schemas referenced only from webhook operations reachable', async () => {
    const result = await validateZopia({
      ...petSpec,
      webhooks: { hook: { post: { operationId: 'onPet', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/HookShape' } } } }, responses: { '200': { description: 'ok' } } } } },
      components: { schemas: { Pet: { type: 'object' }, HookShape: { type: 'object' } } },
    });
    expect(result.diagnostics.filter((issue) => issue.at === '#/components/schemas/HookShape')).toEqual([]);
  });

  it('flags unreachable Swagger 2.0 definitions with the definitions pointer', async () => {
    const result = await validateZopia({
      swagger: '2.0',
      info: { title: 'S', version: '1' },
      paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } },
      definitions: { Used: { type: 'string' }, Orphan: { type: 'number' } },
      parameters: [{ name: 'p', in: 'query', type: 'string' }],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      { severity: 'warning', code: 'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT', at: '#/definitions/Orphan', message: 'component is never referenced: Orphan' },
      { severity: 'warning', code: 'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT', at: '#/definitions/Used', message: 'component is never referenced: Used' },
    ]);
  });

  it('reports broken local references as error diagnostics with the offending pointer', async () => {
    const result = await validateZopia({
      ...petSpec,
      paths: { '/x': { get: { operationId: 'x', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } } } },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', code: 'ZOPIA_REF_NOT_FOUND', at: '#/paths/~1x/get/responses/200/content/application~1json/schema/$ref' });
  });

  it('reports cross-namespace duplicate operationIds as errors while still linting', async () => {
    const result = await validateZopia({
      ...petSpec,
      webhooks: { hook: { post: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } } },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([
      { severity: 'error', code: 'ZOPIA_SPEC_INVALID', at: '#/webhooks/hook', message: 'Duplicate operationId across paths and webhooks: listPets' },
    ]);
  });

  it('bundles same-folder external refs before validating a spec file path', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'shared.json'), JSON.stringify({ Pet: { type: 'object' } }), 'utf8');
    await writeFile(join(directory, 'openapi.json'), JSON.stringify({
      ...petSpec,
      paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: './shared.json#/Pet' } } } } } } } },
      components: { schemas: {} },
    }), 'utf8');
    const result = await validateZopia(join(directory, 'openapi.json'));
    expect(result).toMatchObject({ ok: true, kind: 'spec', target: join(directory, 'openapi.json'), diagnostics: [] });
  });

  it('rejects an invalid kind option as a config error', async () => {
    await expect(validateZopia(petSpec, { kind: 'tree' as never })).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID' });
  });

  it('validates a generated docs tree through a reverse dry run', async () => {
    const directory = await temporaryDirectory();
    await generateApiDocsFiles(petSpec as never, { outputDir: directory, insertComponents: true, useComponentAsReference: true });
    await seedKmApi(directory, '0.4.1');
    const result = await validateZopia(directory);
    expect(result).toEqual({ ok: true, kind: 'docs', target: directory, diagnostics: [] });
  });

  it('reports a missing manifest in a docs directory', async () => {
    const directory = await temporaryDirectory();
    const result = await validateZopia(directory);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      { severity: 'error', code: 'ZOPIA_DOCS_MISSING_MANIFEST', at: join(directory, '.zopia-manifest.json'), message: 'manifest file not found; generate api docs first or pass the manifest path' },
    ]);
  });

  it('reports a tampered manifest through its typed validation error', async () => {
    const directory = await temporaryDirectory();
    await generateApiDocsFiles(petSpec as never, { outputDir: directory });
    await seedKmApi(directory, '0.4.1');
    const manifestPath = join(directory, '.zopia-manifest.json');
    const manifest = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(manifestPath, 'utf8')));
    manifest.apis[0].operationId = 42;
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    const result = await validateZopia(manifestPath);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('docs');
    expect(result.diagnostics[0]?.code).toBe('ZOPIA_MANIFEST_INVALID');
  });

  it('warns when the installed km-api is outside the declared peer range', async () => {
    const directory = await temporaryDirectory();
    await generateApiDocsFiles(petSpec as never, { outputDir: directory });
    await seedKmApi(directory, '9.9.9');
    const result = await validateZopia(directory);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      { severity: 'warning', code: 'ZOPIA_VALIDATE_KM_API_DRIFT', at: directory, message: 'installed km-api 9.9.9 is outside the required peer range ^0.4.1' },
    ]);
  });

  it('warns instead of failing when km-api cannot be resolved near the tree', async () => {
    const directory = await temporaryDirectory();
    await generateApiDocsFiles(petSpec as never, { outputDir: directory });
    const result = await validateZopia(directory);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('ZOPIA_VALIDATE_KM_API_DRIFT');
    expect(result.diagnostics[0]?.message).toContain('could not be resolved');
  });

  it('exposes the stable lint code catalogue', () => {
    expect(ZOPIA_VALIDATION_CODES).toEqual(['ZOPIA_VALIDATE_UNREACHABLE_COMPONENT', 'ZOPIA_VALIDATE_KM_API_DRIFT']);
    expect(Object.isFrozen(ZOPIA_VALIDATION_CODES)).toBe(true);
  });

  it('CLI validate prints sorted diagnostics and a summary to stdout with exit 0 on warnings only', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    await writeFile(source, JSON.stringify({
      ...petSpec,
      components: { schemas: { Pet: { type: 'object' }, Orphan: { type: 'string' } } },
    }), 'utf8');
    const capture = captureOutput();
    const exitCode = await runCliEntrypoint(['validate', source], capture.output);
    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(capture.stdout.join('')).toContain('Warning: ZOPIA_VALIDATE_UNREACHABLE_COMPONENT #/components/schemas/Orphan: component is never referenced: Orphan');
    expect(capture.stdout.join('')).toContain(`zopia validate spec ${source}: ok (0 errors, 1 warnings)`);
  });

  it('CLI validate exits 1 with error diagnostics on stdout and a typed tail on stderr', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    await writeFile(source, JSON.stringify({
      ...petSpec,
      paths: { '/x': { get: { operationId: 'x', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } } } },
    }), 'utf8');
    const capture = captureOutput();
    const exitCode = await runCliEntrypoint(['validate', source], capture.output);
    expect(exitCode).toBe(1);
    expect(capture.stdout.join('')).toContain('Error: ZOPIA_REF_NOT_FOUND #/paths/~1x/get/responses/200/content/application~1json/schema/$ref: unresolved local reference: #/components/schemas/Missing');
    expect(capture.stdout.join('')).toContain(`zopia validate spec ${source}: failed (1 errors, 0 warnings)`);
    expect(capture.stderr.join('\n')).toContain('zopia validate failed with 1 error');
  });

  it('CLI validate enforces a strict single-positional grammar and documents itself in help', async () => {
    const help = captureOutput();
    await runCli(['--help'], help.output);
    expect(help.stdout.join('')).toContain('zopia validate <spec.json|spec.yaml|docs-dir> [--config path]');

    const capture = captureOutput();
    const exitCode = await runCliEntrypoint(['validate'], capture.output);
    expect(exitCode).toBe(1);
    expect(capture.stderr.join('\n')).toContain('validate requires <spec.json|spec.yaml|docs-dir>');

    const unknown = captureOutput();
    expect(await runCliEntrypoint(['validate', 'spec.json', '--watch'], unknown.output)).toBe(1);
    expect(unknown.stderr.join('\n')).toContain('unknown validate option: --watch');
  });
});
