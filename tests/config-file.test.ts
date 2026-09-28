/* Project configuration (v0.2.x, D-19): the CLI discovers `zopia.config.ts` in the working
 * directory (or an explicit `--config` path), structurally validates it, and applies it as
 * defaults — explicit CLI flags always win over config values, and config values win over
 * built-in defaults. */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineConfig, loadZopiaConfig } from '../src';
import { runCli, type ZopiaCliOutput } from '../src/cli-command';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories('zopia-config-');

function captureOutput(): { output: ZopiaCliOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, output: { stdout: (content) => stdout.push(content), stderr: (content) => stderr.push(content) } };
}

const WRITE_SPEC = async (directory: string): Promise<string> => {
  const spec = join(directory, 'openapi.json');
  await writeFile(spec, JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Configured API', version: '1.0.0' },
    paths: { '/items': { get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } } } },
    components: { schemas: { Item: { type: 'object', properties: { id: { type: 'string' } } } } },
  }), 'utf8');
  return spec;
};

describe('S-83: zopia.config.ts project configuration (D-19)', () => {
  it('discovers the config next to the working directory and applies generate defaults', async () => {
    const directory = await temporaryDirectory();
    const spec = await WRITE_SPEC(directory);
    await writeFile(join(directory, 'zopia.config.ts'), `export default {
  generate: { mode: 'flat', insertComponents: true, useComponentAsReference: true, outDir: 'docs-out' },
};
`, 'utf8');

    // Loader-level discovery (cwd argument) keeps the working-directory convention.
    await expect(loadZopiaConfig({ cwd: directory })).resolves.toEqual({
      generate: { mode: 'flat', insertComponents: true, useComponentAsReference: true, outDir: 'docs-out' },
    });

    // The CLI uses cwd discovery: only the spec path is positional; output dir comes from config.
    const cwd = process.cwd();
    process.chdir(directory);
    const capture = captureOutput();
    try { await runCli(['generate', 'openapi.json'], capture.output); }
    finally { process.chdir(cwd); }

    const files = await readdir(join(directory, 'docs-out'));
    expect(files.sort()).toEqual(['.zopia-manifest.json', 'components', 'items']);
    // `--mode` came from the config: flat layout has no per-method directory nesting.
    expect(JSON.parse(await readFile(join(directory, 'docs-out/.zopia-manifest.json'), 'utf8'))).toMatchObject({
      mode: 'flat',
      options: { insertComponents: true, useComponentAsReference: true },
    });
    expect(capture.stdout).toEqual([]);
    void spec;
  });

  it('lets explicit CLI flags override config values and config values override built-in defaults', async () => {
    const directory = await temporaryDirectory();
    const spec = await WRITE_SPEC(directory);
    await writeFile(join(directory, 'zopia.config.ts'), `export default {
  generate: { mode: 'flat', insertComponents: true, useComponentAsReference: true, manifest: false, outDir: 'from-config' },
  reverse: { version: '3.0', out: 'reversed-from-config.json' },
};
`, 'utf8');

    const capture = captureOutput();
    // --mode directory beats config flat; positional output dir beats generate.outDir;
    // insertComponents/useComponentAsReference come from config; manifest:false comes from config.
    // An explicit --config path avoids cwd-roaming ambiguity; the relative positional outDir
    // resolves from the process cwd, so chdir around just this call.
    const repoCwd = process.cwd();
    process.chdir(directory);
    try { await runCli(['generate', spec, 'from-cli', '--mode', 'directory', '--config', join(directory, 'zopia.config.ts')], capture.output); }
    finally { process.chdir(repoCwd); }
    expect((await readdir(join(directory, 'from-cli'))).sort()).toEqual(['components', 'items']);
    expect((await readdir(join(directory, 'from-cli', 'items'))).sort()).toEqual(['get']);
    // The reverse lifecycle depends on the manifest, so configs are expected to keep it enabled.
    void capture;

    // `--no-manifest` always overrides a config manifest:true.
    const keepManifest = join(directory, 'keep-manifest');
    await writeFile(join(directory, 'zopia.config.ts'), `export default { generate: { manifest: true, outDir: ${JSON.stringify(keepManifest)} } };\n`, 'utf8');
    const capture2 = captureOutput();
    await runCli(['generate', spec, '--no-manifest', '--config', join(directory, 'zopia.config.ts')], capture2.output);
    expect((await readdir(keepManifest)).sort()).toEqual(['items']);
  });

  it('resolves an explicit --config path and reports missing files with a typed error', async () => {
    const directory = await temporaryDirectory();
    const spec = await WRITE_SPEC(directory);
    const configPath = join(directory, 'custom', 'zopia.config.ts');
    await mkdir(join(directory, 'custom'), { recursive: true });
    await writeFile(configPath, `export const config = { generate: { mode: 'flat', outDir: 'named-export-out' } };\n`, 'utf8');

    const capture = captureOutput();
    const cwd = process.cwd();
    process.chdir(directory);
    try { await runCli(['generate', 'openapi.json', '--config', 'custom/zopia.config.ts'], capture.output); }
    finally { process.chdir(cwd); }
    // Named `config` export is honored when no default export exists; flat mode comes through.
    expect((await readdir(join(directory, 'named-export-out'))).sort()).toEqual(['.zopia-manifest.json', 'components', 'items'].filter((name) => name !== 'components'));
    void spec;

    await expect(runCli(['generate', 'openapi.json', 'out', '--config', 'nope.config.ts'], capture.output)).rejects.toMatchObject({
      code: 'ZOPIA_CONFIG_INVALID', at: 'nope.config.ts',
    });
    await expect(runCli(['generate', 'openapi.json', 'out', '--config', 'custom/zopia.config.ts', '--config', 'custom/zopia.config.ts'], capture.output)).rejects.toMatchObject({
      code: 'ZOPIA_CONFIG_INVALID', at: '--config',
    });
    await expect(loadZopiaConfig({ cwd: directory, file: '' })).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'file' });
  });

  it('applies reverse defaults (version and out) with CLI --version/--out taking precedence', async () => {
    const directory = await temporaryDirectory();
    await WRITE_SPEC(directory);
    await writeFile(join(directory, 'zopia.config.ts'), `export default {
  generate: { outDir: 'tree' },
  reverse: { version: '3.0', out: 'reversed-3.0.json' },
};
`, 'utf8');

    const cwd = process.cwd();
    process.chdir(directory);
    const capture = captureOutput();
    try {
      await runCli(['generate', 'openapi.json'], capture.output);
      await runCli(['reverse', 'tree'], capture.output);
    } finally { process.chdir(cwd); }
    const reversed = JSON.parse(await readFile(join(directory, 'reversed-3.0.json'), 'utf8'));
    expect(reversed.openapi).toBe('3.0.0');
    expect(capture.stdout).toEqual([]);

    // CLI --version and --out both win over config defaults.
    const capture2 = captureOutput();
    cwd2: {
      const cwd2 = process.cwd();
      process.chdir(directory);
      try { await runCli(['reverse', 'tree', '--version', '3.1', '--out', 'reversed-3.1.json'], capture2.output); }
      finally { process.chdir(cwd2); }
    }
    const overridden = JSON.parse(await readFile(join(directory, 'reversed-3.1.json'), 'utf8'));
    expect(overridden.openapi).toBe('3.1.0');
  });

  it('rejects invalid config content with ZOPIA_CONFIG_INVALID and the offending key', async () => {
    const directory = await temporaryDirectory();
    const cases: Array<{ content: string; at: string | undefined; message: RegExp }> = [
      { content: `export default { generate: { mode: 'sideways' } };\n`, at: 'generate.mode', message: /generate\.mode must be 'directory' or 'flat'/ },
      { content: `export default { generate: { insertComponents: 'yes' } };\n`, at: 'generate.insertComponents', message: /generate\.insertComponents must be a boolean/ },
      { content: `export default { generate: { surprise: true } };\n`, at: 'generate.surprise', message: /unknown generate config option: surprise/ },
      { content: `export default { reverse: { version: '4.0' } };\n`, at: 'reverse.version', message: /reverse\.version must be '2\.0', '3\.0', or '3\.1'/ },
      { content: `export default { generate: { outDir: 42 } };\n`, at: 'generate.outDir', message: /generate\.outDir must be a non-empty string/ },
      { content: `export default { topLevel: true };\n`, at: 'topLevel', message: /unknown config config option: topLevel/ },
      { content: `export default 42;\n`, at: undefined, message: /zopia config must export an object/ },
      { content: `export const unrelated = true;\n`, at: undefined, message: /must default-export/ },
      { content: `throw new Error('boom in config');\n`, at: undefined, message: /Unable to import config file .*boom in config/ },
    ];
    for (const [index, { content, at, message }] of cases.entries()) {
      const file = join(directory, `case-${index}.config.ts`);
      await writeFile(file, content, 'utf8');
      await expect(loadZopiaConfig({ file })).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', ...(at === undefined ? {} : { at }), message: expect.stringMatching(message) });
    }
    await expect(loadZopiaConfig({ file: join(directory, 'case-2.config.ts') })).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID', at: 'generate.surprise' });
    // `defineConfig` is a pass-through for typing convenience.
    const typed = defineConfig({ generate: { mode: 'flat' } });
    expect(typed).toEqual({ generate: { mode: 'flat' } });
    // Missing config in a bare directory discovers nothing instead of failing.
    await expect(loadZopiaConfig({ cwd: directory })).resolves.toBeUndefined();
  });

  it('keeps the positional <output-dir> required only when no config supplies generate.outDir', async () => {
    const directory = await temporaryDirectory();
    const spec = await WRITE_SPEC(directory);
    const cwd = process.cwd();
    process.chdir(directory);
    const capture = captureOutput();
    try {
      await expect(runCli(['generate', spec], capture.output)).rejects.toMatchObject({
        code: 'ZOPIA_CONFIG_INVALID',
        message: 'ZOPIA_CONFIG_INVALID: generate requires <spec.json|spec.yaml> and <output-dir>',
      });
    } finally { process.chdir(cwd); }
  });
});
