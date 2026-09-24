#!/usr/bin/env node
import { openApiToApiDocs, apiDocsToOpenApi } from './index';
import { writeFile } from 'node:fs/promises';

/** Run the zopia command-line interface. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  if (command === 'generate') {
    const input = argv[1];
    if (!input) throw new Error('Usage: zopia generate <openapi.json> [outputDir]');
    const result = await openApiToApiDocs(input, { outputDir: argv[2] });
    process.stdout.write(`Generated ${result.files.length} files in ${result.manifestPath}\n`);
    return;
  }
  if (command === 'reverse') {
    const docs = argv[1];
    if (!docs) throw new Error('Usage: zopia reverse <api_docs> [output.json]');
    const result = await apiDocsToOpenApi(docs);
    await writeFile(argv[2] ?? 'openapi.json', JSON.stringify(result.openapi, null, 2) + '\n');
    process.stdout.write(`Wrote ${argv[2] ?? 'openapi.json'}\n`);
    return;
  }
  throw new Error('Usage: zopia generate <openapi.json> [outputDir] | zopia reverse <api_docs> [output.json]');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
