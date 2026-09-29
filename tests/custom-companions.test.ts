import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { lstat, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateApiDocsFiles, openApiToApiDocs, ZopiaError } from '../src';
import { runCli, type ZopiaCliOutput } from '../src/cli-command';

const temporaryDirectory = useTemporaryDirectories('zopia-custom-');

const spec = {
  openapi: '3.1.0',
  info: { title: 'Custom companions', version: '1' },
  paths: { '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } } },
  webhooks: { signed: { post: { operationId: 'hookSigned', responses: { '202': { description: 'ok' } } } } },
} as const;

const wiredExport = "export * as custom from './custom';";

describe('merge-safe custom companions and incremental regeneration (D-24, S-90)', () => {
  it('S-90: emits one custom.ts scaffold per endpoint and webhook, never listed as a generated file', async () => {
    const outputDir = await temporaryDirectory();
    const files = await generateApiDocsFiles(spec as any, { outputDir, custom: true });
    expect(files.map((file) => file.file).sort()).toEqual(['.zopia-manifest.json', 'ping/get/index.ts', 'webhooks/signed/post/index.ts']);
    for (const directory of ['ping/get', 'webhooks/signed/post']) {
      expect((await readdir(join(outputDir, directory))).sort()).toEqual(['custom.ts', 'index.ts']);
      const scaffold = await readFile(join(outputDir, directory, 'custom.ts'), 'utf8');
      expect(scaffold).toContain('never overwrites');
      expect(scaffold).toContain('export {};');
      expect(await readFile(join(outputDir, directory, 'index.ts'), 'utf8')).toContain(wiredExport);
    }
    expect(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')).toContain('"custom": true');
  });

  it('S-90: byte-identical regeneration leaves mtimes untouched, changed sources refresh only what they affect', async () => {
    const outputDir = await temporaryDirectory();
    await generateApiDocsFiles(spec as any, { outputDir, custom: true });
    const endpoint = join(outputDir, 'ping/get/index.ts');
    const manifest = join(outputDir, '.zopia-manifest.json');
    // Pin both mtimes to a fixed instant far in the past; any real write would stamp "now" instead.
    const pinned = new Date('2001-02-03T04:05:06Z');
    await utimes(endpoint, pinned, pinned);
    await utimes(manifest, pinned, pinned);
    await generateApiDocsFiles(spec as any, { outputDir, custom: true });
    expect((await stat(endpoint)).mtimeMs).toBe(pinned.getTime());
    expect((await stat(manifest)).mtimeMs).toBe(pinned.getTime());
    const changed = { ...spec, paths: { '/ping': { get: { operationId: 'ping', summary: 'different', responses: { '200': { description: 'ok' } } } } } };
    await generateApiDocsFiles(changed as any, { outputDir, custom: true });
    expect((await stat(manifest)).mtimeMs).not.toBe(pinned.getTime());
    // the endpoint module is re-rendered with new bytes, so its mtime moves too
    expect((await stat(endpoint)).mtimeMs).not.toBe(pinned.getTime());
  });

  it('S-90: hand-written custom.ts content and symlinks at the path are never overwritten', async () => {
    const outputDir = await temporaryDirectory();
    await generateApiDocsFiles(spec as any, { outputDir, custom: true });
    const endpointCustom = join(outputDir, 'ping/get/custom.ts');
    await writeFile(endpointCustom, '// mine\nexport const mine = 1;\n', 'utf8');
    const webhookCustom = join(outputDir, 'webhooks/signed/post/custom.ts');
    await writeFile(join(outputDir, 'webhook-target.ts'), 'export {};\n', 'utf8');
    await rm(webhookCustom, { force: true });
    await symlink(join(outputDir, 'webhook-target.ts'), webhookCustom, 'file');
    await generateApiDocsFiles(spec as any, { outputDir, custom: true });
    expect(await readFile(endpointCustom, 'utf8')).toBe('// mine\nexport const mine = 1;\n');
    expect((await lstat(webhookCustom)).isSymbolicLink()).toBe(true);
    expect(await readFile(webhookCustom, 'utf8')).toBe('export {};\n');
  });

  it('S-90: default is off, toggling off drops the export line but keeps the companion, and staleness surfaces the change', async () => {
    const outputDir = await temporaryDirectory();
    const first = await openApiToApiDocs(JSON.stringify(spec), { outDir: outputDir });
    expect(await readdir(join(outputDir, 'ping/get'))).toEqual(['index.ts']);
    expect(await readFile(join(outputDir, 'ping/get/index.ts'), 'utf8')).not.toContain('custom');
    expect(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')).not.toContain('"custom"');
    expect(first.warnings).toEqual([]);

    await writeFile(join(outputDir, 'ping/get/custom.ts'), '// kept\n', 'utf8');
    const enabled = await openApiToApiDocs(JSON.stringify(spec), { outDir: outputDir, custom: true });
    expect(enabled.warnings.some((warning) => warning.message.includes('custom companion modules were enabled or disabled'))).toBe(true);
    // a pre-existing custom.ts with hand edits is adopted, never overwritten
    expect(await readFile(join(outputDir, 'ping/get/custom.ts'), 'utf8')).toBe('// kept\n');
    expect(await readFile(join(outputDir, 'ping/get/index.ts'), 'utf8')).toContain(wiredExport);

    await openApiToApiDocs(JSON.stringify(spec), { outDir: outputDir, custom: false });
    expect(await readFile(join(outputDir, 'ping/get/index.ts'), 'utf8')).not.toContain(wiredExport);
    expect(await readdir(join(outputDir, 'ping/get'))).toContain('custom.ts');
  });

  it('S-90: flat layout places the companion next to the endpoint module', async () => {
    const outputDir = await temporaryDirectory();
    await generateApiDocsFiles(spec as any, { outputDir, mode: 'flat', custom: true });
    expect((await readdir(join(outputDir, 'ping/get'))).sort()).toEqual(['custom.ts', 'index.ts']);
  });

  it('S-90: a directory at the companion path is a typed error, not a silently broken import', async () => {
    const outputDir = await temporaryDirectory();
    await mkdir(join(outputDir, 'ping/get/custom.ts'), { recursive: true });
    try {
      await generateApiDocsFiles(spec as any, { outputDir, custom: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ZopiaError);
      expect((error as ZopiaError).code).toBe('ZOPIA_FS_OUTSIDE_OUTDIR');
      expect((error as ZopiaError).at).toBe('ping/get/custom.ts');
    }
  });

  it('S-90: path segments shaped like custom.ts collide safely through planner renaming', async () => {
    const nested = {
      openapi: '3.1.0',
      info: { title: 'nested', version: '1' },
      paths: {
        '/a': { get: { operationId: 'aGet', responses: { '200': { description: 'ok' } } } },
        '/a/get/custom.ts': { get: { operationId: 'customGet', responses: { '200': { description: 'ok' } } } },
      },
    };
    for (const mode of ['directory', 'flat'] as const) {
      const outputDir = await temporaryDirectory();
      const files = await generateApiDocsFiles(nested as any, { outputDir, mode, custom: true });
      const endpointFiles = files.map((file) => file.file).filter((file) => file.endsWith('/index.ts'));
      expect(endpointFiles).toHaveLength(2);
      for (const endpointFile of endpointFiles) {
        const directory = endpointFile.slice(0, -'index.ts'.length);
        const module = await readFile(join(outputDir, ...endpointFile.split('/')), 'utf8');
        expect(module).toContain(wiredExport);
        const companion = join(outputDir, ...`${directory}custom.ts`.split('/'));
        const metadata = await lstat(companion);
        expect(metadata.isFile()).toBe(true);
        expect(await readFile(companion, 'utf8')).toContain('export {};');
      }
    }
  });

  it('S-90: rejects non-boolean custom options at every layer', async () => {
    const outputDir = await temporaryDirectory();
    await expect(generateApiDocsFiles(spec as any, { outputDir, custom: 'yes' } as any)).rejects.toThrow('custom must be a boolean');
    await expect(openApiToApiDocs(JSON.stringify(spec), { outDir: outputDir, custom: 1 } as any)).rejects.toThrow('custom must be a boolean');
    try {
      await generateApiDocsFiles(spec as any, { outputDir, custom: 'yes' } as any);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ZopiaError);
      expect((error as ZopiaError).code).toBe('ZOPIA_CONFIG_INVALID');
      expect((error as ZopiaError).at).toBe('custom');
    }
  });

  it('S-90: the CLI exposes --custom and documents it in --help', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'spec.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, JSON.stringify(spec), 'utf8');
    const stdout: string[] = [];
    const output: ZopiaCliOutput = { stdout: (line) => stdout.push(line), stderr: () => undefined };
    await runCli(['generate', source, outDir, '--custom'], output);
    expect((await readdir(join(outDir, 'ping/get'))).sort()).toEqual(['custom.ts', 'index.ts']);
    await runCli(['--help'], output);
    expect(stdout.join('\n')).toContain('--custom');
  });
});
