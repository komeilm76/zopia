import { describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, runCliEntrypoint, runGenerateWatch, type ZopiaCliOutput } from '../src/cli-command';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories('zopia-watch-');

function capture(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    output: {
      stdout: (content) => stdout.push(content),
      stderr: (content) => stderr.push(content),
    },
  };
}

const spec = (operationId: string) => JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Watch', version: '1.0.0' },
  paths: {
    '/things': {
      get: { operationId, responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } } },
    },
  },
});

const manifestOperationId = async (manifestPath: string): Promise<unknown> =>
  JSON.parse(await readFile(manifestPath, 'utf8')).apis[0]?.operationId;

describe('generate --watch (S-88)', () => {
  it('runs ③ once immediately, then regenerates the manifest when the spec changes', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, spec('listThings'), 'utf8');
    const { output, stderr } = capture();
    const abort = new AbortController();
    const watching = runGenerateWatch(source, { outDir }, output, abort.signal);

    const manifestPath = join(outDir, '.zopia-manifest.json');
    await vi.waitFor(async () => expect(await manifestOperationId(manifestPath)).toBe('listThings'), { timeout: 15000, interval: 40 });

    await writeFile(source, spec('listThingsV2'), 'utf8');
    await vi.waitFor(async () => expect(await manifestOperationId(manifestPath)).toBe('listThingsV2'), { timeout: 15000, interval: 40 });
    // The second run observes the changed source → a deterministic stale-tree
    // warning precedes in-place regeneration of owned files. A single save can
    // make the OS emit more than one change event (rename + write), and each
    // debounced run legitimately repeats the same warning, so the contract is
    // "nothing but stale-tree warnings, at least one" rather than an exact count.
    expect(stderr.length).toBeGreaterThanOrEqual(1);
    for (const line of stderr) expect(line).toMatch(/^Warning: ZOPIA_WARN_STALE_TREE /);

    abort.abort();
    await watching;
  });

  it('keeps watching after a broken spec edit and recovers on the next fix', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, spec('firstRun'), 'utf8');
    const { output, stderr } = capture();
    const abort = new AbortController();
    const watching = runGenerateWatch(source, { outDir }, output, abort.signal);

    const manifestPath = join(outDir, '.zopia-manifest.json');
    await vi.waitFor(async () => expect(await manifestOperationId(manifestPath)).toBe('firstRun'), { timeout: 15000, interval: 40 });

    await writeFile(source, '{ this is not valid JSON', 'utf8');
    await vi.waitFor(() => expect(stderr.some((line) => line.startsWith('Error: ZOPIA_'))).toBe(true), { timeout: 15000, interval: 40 });
    // The failed run leaves the previous generated tree untouched.
    expect(await manifestOperationId(manifestPath)).toBe('firstRun');

    await writeFile(source, spec('recovered'), 'utf8');
    await vi.waitFor(async () => expect(await manifestOperationId(manifestPath)).toBe('recovered'), { timeout: 15000, interval: 40 });

    abort.abort();
    await watching;
  });

  it('--watch surfaces write-backed forward warnings on stderr after each run', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Watch warn', version: '1' },
      paths: {
        '/value': {
          post: {
            requestBody: { content: { 'application/json': { schema: { type: 'string', format: 'watch-code' } } } },
            responses: { '204': { description: 'empty' } },
          },
        },
      },
    }), 'utf8');
    const { output, stderr } = capture();
    const abort = new AbortController();
    const watching = runGenerateWatch(source, { outDir }, output, abort.signal);

    await vi.waitFor(() => expect(stderr.some((line) => line.startsWith('Warning: ZOPIA_WARN_CUSTOM_FORMAT '))).toBe(true), { timeout: 15000, interval: 40 });
    abort.abort();
    await watching;
  });

  it('regenerates through atomic saves that replace the spec file (write-temp + rename)', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, spec('beforeAtomic'), 'utf8');
    const { output } = capture();
    const abort = new AbortController();
    const watching = runGenerateWatch(source, { outDir }, output, abort.signal);

    const manifestPath = join(outDir, '.zopia-manifest.json');
    await vi.waitFor(async () => expect(await manifestOperationId(manifestPath)).toBe('beforeAtomic'), { timeout: 15000, interval: 40 });

    // Many editors save atomically: write a temp file then rename over the spec,
    // which replaces the inode a naive file watcher subscribed to.
    const temp = join(directory, '.openapi.json.tmp');
    await writeFile(temp, spec('afterAtomic'), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(temp, source);
    await vi.waitFor(async () => expect(await manifestOperationId(manifestPath)).toBe('afterAtomic'), { timeout: 15000, interval: 40 });

    abort.abort();
    await watching;
  });

  it('rejects an unwatchable parent as a typed diagnostics path, not a raw fs.watch failure', async () => {
    const directory = await temporaryDirectory();
    const missingParent = join(directory, 'missing-parent');
    const source = join(missingParent, 'openapi.json');
    const streams = capture();
    const outDir = join(directory, 'api-docs');
    const exitCode = await runCliEntrypoint(['generate', source, outDir, '--watch'], streams.output);
    expect(exitCode).toBe(1);
    const stderr = streams.stderr.join('');
    expect(stderr).toContain('ZOPIA_SPEC_INVALID_JSON');
    expect(stderr).toContain('ZOPIA_CONFIG_INVALID');
    expect(stderr).not.toContain('Unexpected zopia failure');
    expect(stderr).not.toContain('ENOENT: no such file or directory, watch');
  });

  it('rejects --watch combined with duplicate flags through normal option validation', async () => {
    const { output } = capture();
    await expect(runCli(['generate', 'spec.json', 'out', '--watch', '--watch'], output)).rejects.toThrow(/duplicate/);
  });

  it('documents the flag in the CLI help text', async () => {
    const { output, stdout } = capture();
    await runCli(['--help'], output);
    expect(stdout.join('\n')).toContain('--watch');
  });
});
