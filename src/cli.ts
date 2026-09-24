#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { generateApiDocsFiles } from './conversions/api-docs-generate';
import { manifestFileToOpenApi } from './conversions/manifest-to-openapi';

function usage(): never { throw new Error('Usage: zopia generate <spec.json> <output-dir> | zopia reverse <manifest.json>'); }

async function main(argv: string[]): Promise<void> {
  const [command, input, output] = argv;
  if (!command || !input) usage();
  if (command === 'generate') {
    if (!output) usage();
    await generateApiDocsFiles(await readFile(input, 'utf8'), { outputDir: output });
    return;
  }
  if (command === 'reverse') {
    const document = await manifestFileToOpenApi(input);
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return;
  }
  usage();
}

main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
