import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const testsRoot = dirname(import.meta.dirname);

async function testFiles(directory = testsRoot): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files.sort();
}

describe('test hygiene contract', () => {
  it('R-111: all test-created temporary directories use the afterEach cleanup helper', async () => {
    const forbiddenTokens = [
      ['mkd', 'temp'].join(''),
      ["from 'node:", "os'"].join(''),
    ];
    const offenders: string[] = [];

    for (const file of await testFiles()) {
      const source = await readFile(file, 'utf8');
      if (forbiddenTokens.some((token) => source.includes(token))) offenders.push(relative(testsRoot, file).replace(/\\/g, '/'));
    }

    expect(offenders).toEqual([]);
  });
});
