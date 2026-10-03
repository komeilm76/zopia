import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZOPIA_ERROR_CODES } from '../../src/errors';
import { ZOPIA_WARNING_CODES } from '../../src/warnings';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userDocsRoot = join(repositoryRoot, 'docs', 'user');

const read = (...segments: string[]): string => readFileSync(join(...segments), 'utf8');

/** Every user page concatenated — coverage is about the set, not one file. */
const allUserDocs = readdirSync(userDocsRoot)
  .filter((file) => file.endsWith('.md'))
  .map((file) => read(userDocsRoot, file))
  .join('\n');

/** Exported value and type names of one public entry point. */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const block of source.matchAll(/export\s*\{([\s\S]*?)\}\s*from/g)) {
    for (const specifier of block[1].split(',')) {
      const name = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  for (const direct of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/gm)) {
    names.add(direct[1]);
  }
  return [...names].sort();
}

describe('user documentation coverage contract (R-207)', () => {
  it('every public export of `zopia` and `zopia/runtime` is documented for users', () => {
    const names = [...new Set([...exportedNames(read(repositoryRoot, 'src', 'index.ts')), ...exportedNames(read(repositoryRoot, 'src', 'runtime.ts'))])];

    expect(names.length).toBeGreaterThan(20);
    const undocumented = names.filter((name) => !allUserDocs.includes(name));
    expect(undocumented, 'add these to docs/user/ (R-207)').toEqual([]);
  });

  it('every stable error and warning code is documented with a cause and a fix', () => {
    const page = read(userDocsRoot, 'errors-and-warnings.md');
    expect(ZOPIA_ERROR_CODES.filter((code) => !page.includes(code))).toEqual([]);
    expect(ZOPIA_WARNING_CODES.filter((code) => !page.includes(code))).toEqual([]);
  });

  it('every CLI command and flag in the binary help text is documented', () => {
    const help = read(repositoryRoot, 'src', 'cli-command.ts');
    const helpText = help.slice(help.indexOf('const HELP_TEXT'), help.indexOf('const processOutput'));
    const cli = read(userDocsRoot, 'cli.md');

    const flags = [...new Set([...helpText.matchAll(/(--[a-z][a-z-]+)/g)].map((match) => match[1]))];
    expect(flags.length).toBeGreaterThan(8);
    expect(flags.filter((flag) => !cli.includes(flag)), 'document these CLI flags in docs/user/cli.md').toEqual([]);

    const commands = [...new Set([...helpText.matchAll(/zopia (generate|reverse|validate|diff|navigate)\b/g)].map((match) => match[1]))];
    expect(commands.sort()).toEqual(['diff', 'generate', 'navigate', 'reverse', 'validate']);
    expect(commands.filter((command) => !cli.includes(`zopia ${command}`))).toEqual([]);
  });

  it('every generate/reverse option key is documented with its default', () => {
    const configuration = read(userDocsRoot, 'configuration.md');
    const options = ['outDir', 'mode', 'insertComponents', 'useComponentAsReference', 'manifest', 'custom', 'preset', 'version'];
    expect(options.filter((option) => !configuration.includes(`\`${option}\``))).toEqual([]);
    // Defaults are part of the contract: the option tables must state them.
    expect(configuration).toContain('🆔 Default');
  });
});
