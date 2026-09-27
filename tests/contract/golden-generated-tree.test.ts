import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openApiToApiDocs } from '../../src';
import { GOLDEN_CASES } from '../golden-cases';
import { useTemporaryDirectories } from '../test-temporary-directories';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixtureRoot = join(repositoryRoot, 'tests', 'fixtures', 'specs');
const expectedRoot = join(repositoryRoot, 'tests', 'fixtures', 'expected');
const temporaryDirectory = useTemporaryDirectories('zopia-golden-');

async function treeSnapshot(root: string, directory = root): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await treeSnapshot(root, path));
    else if (entry.isFile()) snapshot[relative(root, path).replace(/\\/g, '/')] = (await readFile(path)).toString('base64');
  }
  return Object.fromEntries(Object.entries(snapshot).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

describe('golden generated-tree contract', () => {
  it('R-112: the expected root contains exactly the governed trees', async () => {
    expect((await readdir(expectedRoot)).sort()).toEqual([
      ...GOLDEN_CASES.map((golden) => golden.name),
      'tsconfig.json',
    ].sort());
  });

  for (const golden of GOLDEN_CASES) {
    it(`R-112: ${golden.name} is byte-exact`, async () => {
      const source = JSON.parse(await readFile(join(fixtureRoot, golden.fixture), 'utf8')) as Record<string, unknown>;
      const outputDirectory = await temporaryDirectory();

      await openApiToApiDocs(source, { ...golden.options, outDir: outputDirectory });

      expect(await treeSnapshot(outputDirectory)).toEqual(await treeSnapshot(join(expectedRoot, golden.name)));
    });
  }

  it('R-502: golden source imports only zod, km-api, and relative modules', async () => {
    const invalid: string[] = [];
    for (const golden of GOLDEN_CASES) {
      const tree = await treeSnapshot(join(expectedRoot, golden.name));
      for (const [file, bytes] of Object.entries(tree)) {
        if (!file.endsWith('.ts')) continue;
        const content = Buffer.from(bytes, 'base64').toString('utf8');
        for (const match of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
          const moduleName = match[1];
          if (moduleName !== 'zod' && moduleName !== 'km-api' && !moduleName.startsWith('.')) invalid.push(`${golden.name}/${file}: ${moduleName}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('R-126: the km-api contract golden exercises open extension values', async () => {
    const content = await readFile(join(expectedRoot, 'km-api-0.4.1.contract', 'probe', '{probeId}', 'trace', 'index.ts'), 'utf8');
    expect(content).toContain('method: "TRACE"');
    expect(content).toContain('"application/vnd.zopia+json"');
    expect(content).toContain('response: { 419: z.string(), "default":');
  });

  it('R-126: all checked-in golden trees typecheck against published km-api 0.4.1', async () => {
    const kmApi = JSON.parse(await readFile(join(repositoryRoot, 'node_modules', 'km-api', 'package.json'), 'utf8')) as { version?: string };
    expect(kmApi.version).toBe('0.4.1');

    const result = spawnSync(process.execPath, [
      join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project',
      join(expectedRoot, 'tsconfig.json'),
      '--pretty',
      'false',
    ], { cwd: repositoryRoot, encoding: 'utf8' });

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
