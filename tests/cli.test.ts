import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliEntrypoint, type ZopiaCliOutput } from '../src/cli-command';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zopia-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(async () => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function captureOutput(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
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

describe('CLI command contract', () => {
  it('prints generate warnings to stderr without writing generated content to stdout', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'CLI warning', version: '1' },
      paths: {
        '/value': {
          post: {
            requestBody: { content: { 'application/json': { schema: { type: 'string', format: 'project-code' } } } },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    }), 'utf8');
    const capture = captureOutput();

    await runCli(['generate', source, outDir], capture.output);

    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      expect.stringMatching(/^Warning: ZOPIA_WARN_CUSTOM_FORMAT #\/paths\/~1value\/post\/requestBody\/content\/application~1json\/schema:/),
    ]);
  });

  it('keeps reverse JSON parseable on stdout while sending warnings only to stderr', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, '.zopia-manifest.json'), JSON.stringify({
      $schema: 'zopia:manifest@1',
      source: { kind: 'openapi-3.1' },
      apis: [],
    }), 'utf8');
    const capture = captureOutput();

    await runCli(['reverse', directory], capture.output);

    expect(JSON.parse(capture.stdout.join(''))).toEqual(expect.objectContaining({
      openapi: '3.1.0',
      info: { title: 'Zopia API', version: '0.0.0' },
    }));
    expect(capture.stderr).toEqual([
      'Warning: ZOPIA_WARN_DEFAULT_INFO #/info/title: manifest source title is missing; using Zopia API',
      'Warning: ZOPIA_WARN_DEFAULT_INFO #/info/version: manifest source version is missing; using 0.0.0',
    ]);
  });

  it('prints complete help text without invoking a command', async () => {
    const capture = captureOutput();

    await runCli(['--help'], capture.output);

    expect(capture.stdout).toEqual([
      'Usage: zopia generate <spec.json> <output-dir> [--mode directory|flat] [--insert-components] [--use-component-as-reference] [--no-manifest]\n',
      '       zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]\n',
    ]);
    expect(capture.stderr).toEqual([]);
  });

  it('writes reverse output to the requested file without contaminating stdout', async () => {
    const directory = await temporaryDirectory();
    const outputFile = join(directory, 'openapi.json');
    await writeFile(join(directory, '.zopia-manifest.json'), JSON.stringify({
      $schema: 'zopia:manifest@1',
      source: { kind: 'openapi-3.1', title: 'File output', version: '1' },
      apis: [],
    }), 'utf8');
    const capture = captureOutput();

    await runCli(['reverse', directory, '--version', '3.0', '--out', outputFile], capture.output);

    expect(JSON.parse(await readFile(outputFile, 'utf8'))).toEqual(expect.objectContaining({ openapi: '3.0.0' }));
    expect(capture.stdout).toEqual([]);
  });

  it('maps typed CLI failures to actionable diagnostics and exit code 1', async () => {
    const capture = captureOutput();

    const exitCode = await runCliEntrypoint(['generate', 'input.json', 'out', '--mode', 'sideways'], capture.output);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toEqual([
      expect.stringContaining('ZOPIA_CONFIG_INVALID'),
      'At: --mode',
      expect.stringContaining("Hint: use '--mode directory' or '--mode flat'"),
    ]);
  });

  it('maps unexpected CLI failures to exit code 2', async () => {
    const capture = captureOutput();
    capture.output.stdout = () => { throw new Error('output failed'); };

    const exitCode = await runCliEntrypoint(['--help'], capture.output);

    expect(exitCode).toBe(2);
    expect(capture.stderr).toEqual(['Unexpected zopia failure: output failed']);
  });

  it('runs the executable entry module with process output and a success exit code', async () => {
    process.argv = [process.execPath, 'zopia', '--help'];
    process.exitCode = undefined;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.resetModules();

    await import('../src/cli');

    expect(process.exitCode).toBe(0);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Usage: zopia generate'));
  });
});
