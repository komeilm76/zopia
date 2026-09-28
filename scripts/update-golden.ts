import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiToApiDocs } from '../src';
import { GOLDEN_CASES } from '../tests/golden-cases';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(repositoryRoot, 'tests', 'fixtures', 'specs');
const expectedRoot = join(repositoryRoot, 'tests', 'fixtures', 'expected');

await mkdir(expectedRoot, { recursive: true });
for (const golden of GOLDEN_CASES) {
  const source = JSON.parse(await readFile(join(fixtureRoot, golden.fixture), 'utf8')) as Record<string, unknown>;
  const outputDirectory = join(expectedRoot, golden.name);
  await rm(outputDirectory, { recursive: true, force: true });
  await openApiToApiDocs(source, { ...golden.options, outDir: outputDirectory });
  console.log(`updated ${relative(repositoryRoot, outputDirectory).replace(/\\/g, '/')}`);
}
