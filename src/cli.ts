#!/usr/bin/env bun
import { readFile, writeFile } from 'node:fs/promises';
import { generateApiDocsFiles } from './conversions/api-docs-generate';
import { apiDocsToOpenApi } from './conversions/manifest-to-openapi';

function usage(): never { throw new Error('Usage: zopia generate <spec.json> <output-dir> [options] | zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]'); }

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { console.log('Usage: zopia generate <spec.json> <output-dir> [--mode directory|flat] [--insert-components] [--use-component-as-reference] [--no-manifest]'); console.log('       zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]'); return; }
  const [command, input, output] = argv;
  if (!command || !input) usage();
  if (command === 'generate') {
    if (!output) usage();
    const modeIndex = argv.indexOf('--mode'); const mode = modeIndex >= 0 ? argv[modeIndex + 1] as 'directory' | 'flat' : undefined;
    const insertComponents = argv.includes('--insert-components');
    const useComponentAsReference = argv.includes('--use-component-as-reference');
    const manifest = argv.includes('--no-manifest') ? false : true;
    if (modeIndex >= 0 && mode !== 'directory' && mode !== 'flat') throw new Error('Invalid --mode; expected directory or flat');
    await generateApiDocsFiles(await readFile(input, 'utf8'), { outputDir: output, mode, insertComponents, useComponentAsReference, manifest });
    return;
  }
  if (command === 'reverse') {
    const versionIndex = argv.indexOf('--version'); const version = versionIndex >= 0 ? argv[versionIndex + 1] : '3.1';
    if (version !== '3.0' && version !== '3.1') throw new Error("Invalid --version; expected '3.0' or '3.1'");
    const document = (await apiDocsToOpenApi(input, { version })).openapi;
    const outIndex = argv.indexOf('--out'); const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
    if (outIndex >= 0 && !out) throw new Error('--out requires a file path');
    const content = `${JSON.stringify(document, null, 2)}\n`;
    if (out) await writeFile(out, content, 'utf8'); else process.stdout.write(content);
    return;
  }
  usage();
}

main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
