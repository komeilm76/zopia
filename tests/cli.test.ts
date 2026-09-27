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
  it('R-933: prints generate warnings to stderr without writing generated content to stdout', async () => {
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
    expect(JSON.parse(await readFile(join(outDir, '.zopia-manifest.json'), 'utf8'))).toMatchObject({
      mode: 'directory',
      options: { insertComponents: false, useComponentAsReference: false },
    });
  });

  it('R-931: maps every generate flag and permits options around positional arguments', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'openapi.json');
    const outDir = join(directory, 'api-docs');
    await writeFile(source, JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'CLI options', version: '1' },
      paths: {
        '/users/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            operationId: 'getUser',
            responses: { '200': { description: 'User', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
          },
        },
      },
      components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } } } } },
    }), 'utf8');
    const capture = captureOutput();

    await runCli([
      'generate',
      '--mode', 'flat',
      source,
      '--insert-components',
      '--use-component-as-reference',
      outDir,
      '--no-manifest',
    ], capture.output);

    expect(await readFile(join(outDir, 'users-{id}', 'get', 'index.ts'), 'utf8')).toContain("from '../../components/index'");
    expect(await readFile(join(outDir, 'components', 'User', 'index.ts'), 'utf8')).toContain('UserSchema');
    await expect(readFile(join(outDir, '.zopia-manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(capture).toMatchObject({ stdout: [], stderr: [] });
  });

  it('R-933: keeps reverse JSON parseable on stdout while sending warnings only to stderr', async () => {
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

  it('R-934: prints complete help and the trusted-tree warning without invoking a command', async () => {
    const capture = captureOutput();

    await runCli(['--help'], capture.output);

    expect(capture.stdout).toHaveLength(1);
    expect(capture.stdout[0]).toContain('zopia generate <spec.json> <output-dir>');
    expect(capture.stdout[0]).toContain('zopia reverse <docs-dir|manifest.json>');
    expect(capture.stdout[0]).toContain('--use-component-as-reference');
    expect(capture.stdout[0]).toContain('Security: reverse executes generated TypeScript');
    expect(capture.stderr).toEqual([]);
  });

  it('R-933: writes reverse output to the requested file without contaminating stdout', async () => {
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

  it('R-933: maps reverse output write failures to a typed user exit', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, '.zopia-manifest.json'), JSON.stringify({
      $schema: 'zopia:manifest@1',
      source: { kind: 'openapi-3.1', title: 'Write error', version: '1' },
      apis: [],
    }), 'utf8');
    const capture = captureOutput();

    const exitCode = await runCliEntrypoint(['reverse', directory, '--out', directory], capture.output);

    expect(exitCode).toBe(1);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      expect.stringContaining('ZOPIA_FS_WRITE_FAILED'),
      `At: ${directory}`,
      'Hint: check the destination path and permissions',
    ]);
  });

  it.each([
    { label: 'a missing command', argv: [], at: 'argv' },
    { label: 'a missing generate output directory', argv: ['generate', 'spec.json'], at: 'argv' },
    { label: 'an extra generate positional', argv: ['generate', 'spec.json', 'out', 'extra'], at: 'extra' },
    { label: 'an unknown generate flag', argv: ['generate', 'spec.json', 'out', '--wat'], at: '--wat' },
    { label: 'a cross-command generate flag', argv: ['generate', 'spec.json', 'out', '--out', 'file.json'], at: '--out' },
    { label: 'a missing mode value', argv: ['generate', 'spec.json', 'out', '--mode'], at: '--mode' },
    { label: 'a duplicate mode', argv: ['generate', 'spec.json', 'out', '--mode', 'flat', '--mode', 'directory'], at: '--mode' },
    { label: 'a duplicate boolean flag', argv: ['generate', 'spec.json', 'out', '--no-manifest', '--no-manifest'], at: '--no-manifest' },
    { label: 'a missing reverse input', argv: ['reverse'], at: 'argv' },
    { label: 'an extra reverse positional', argv: ['reverse', 'docs', 'extra'], at: 'extra' },
    { label: 'an unknown reverse flag', argv: ['reverse', 'docs', '--wat'], at: '--wat' },
    { label: 'a cross-command reverse flag', argv: ['reverse', 'docs', '--mode', 'flat'], at: '--mode' },
    { label: 'a missing output value before reading input', argv: ['reverse', 'missing', '--out'], at: '--out' },
    { label: 'a missing version value before reading input', argv: ['reverse', 'missing', '--version'], at: '--version' },
    { label: 'an invalid reverse version before reading input', argv: ['reverse', 'missing', '--version', '2.0'], at: '--version' },
    { label: 'a duplicate output flag', argv: ['reverse', 'docs', '--out', 'one.json', '--out', 'two.json'], at: '--out' },
    { label: 'an unknown command', argv: ['publish', 'spec.json'], at: 'publish' },
  ])('R-932: rejects $label', async ({ argv, at }) => {
    const capture = captureOutput();

    const exitCode = await runCliEntrypoint(argv, capture.output);

    expect(exitCode).toBe(1);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      expect.stringContaining('ZOPIA_CONFIG_INVALID'),
      `At: ${at}`,
      expect.stringMatching(/^Hint: /),
    ]);
  });

  it('R-932: rejects malformed argument and output boundaries', async () => {
    const capture = captureOutput();

    await expect(runCli(['generate', 1] as unknown as string[], capture.output)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'argv' });
    await expect(runCli(['--help'], {} as ZopiaCliOutput)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'output' });
  });

  it('R-933: maps typed CLI failures to actionable diagnostics and exit code 1', async () => {
    const capture = captureOutput();

    const exitCode = await runCliEntrypoint(['generate', 'input.json', 'out', '--mode', 'sideways'], capture.output);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toEqual([
      expect.stringContaining('ZOPIA_CONFIG_INVALID'),
      'At: --mode',
      expect.stringContaining("Hint: use '--mode directory' or '--mode flat'"),
    ]);
  });

  it('R-933: maps unexpected CLI failures to exit code 2', async () => {
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
    expect(write).toHaveBeenCalledWith(expect.stringContaining('zopia generate <spec.json> <output-dir>'));
  });
});
