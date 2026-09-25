import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type ZopiaCliOutput } from '../src/cli-command';

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

describe('CLI warning output', () => {
  it('prints generate warnings to stderr without writing generated content to stdout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-cli-'));
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
    const directory = await mkdtemp(join(tmpdir(), 'zopia-cli-'));
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
});
