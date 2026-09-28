import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface CoverageEntry {
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
}

type CoverageSummary = Record<string, CoverageEntry> & { total: CoverageEntry };
type MetricName = 'lines' | 'functions' | 'branches';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const summaryFile = join(repositoryRoot, 'coverage', 'coverage-summary.json');
const summary = JSON.parse(await readFile(summaryFile, 'utf8')) as CoverageSummary;
const failures: string[] = [];

function percent(entries: CoverageEntry[], metric: MetricName): number {
  const totals = entries.reduce((result, entry) => ({
    covered: result.covered + entry[metric].covered,
    total: result.total + entry[metric].total,
  }), { covered: 0, total: 0 });
  return totals.total === 0 ? 100 : (totals.covered / totals.total) * 100;
}

function requireThreshold(label: string, actual: number, minimum: number): void {
  if (actual + Number.EPSILON < minimum) failures.push(`${label}: ${actual.toFixed(2)}% is below ${minimum}%`);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(relative(repositoryRoot, path).split(sep).join('/'));
  }
  return files;
}

const sourceEntries = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, entry]) => ({ file: relative(repositoryRoot, resolve(repositoryRoot, file)).split(sep).join('/'), entry }));
const expectedFiles = (await sourceFiles(join(repositoryRoot, 'src'))).sort();
const reportedFiles = sourceEntries.map(({ file }) => file).sort();
const missingFiles = expectedFiles.filter((file) => !reportedFiles.includes(file));
const unexpectedFiles = reportedFiles.filter((file) => !expectedFiles.includes(file));
if (missingFiles.length) failures.push(`source files missing from coverage: ${missingFiles.join(', ')}`);
if (unexpectedFiles.length) failures.push(`unexpected files in source coverage: ${unexpectedFiles.join(', ')}`);

const overallLines = percent([summary.total], 'lines');
const overallFunctions = percent([summary.total], 'functions');
const overallBranches = percent([summary.total], 'branches');
requireThreshold('overall lines', overallLines, 90);
requireThreshold('overall functions', overallFunctions, 90);
requireThreshold('overall branches', overallBranches, 85);

for (const { file, entry } of sourceEntries) requireThreshold(`${file} lines`, percent([entry], 'lines'), 80);

const engineEntries = sourceEntries.filter(({ file }) => file.startsWith('src/conversions/')).map(({ entry }) => entry);
if (!engineEntries.length) failures.push('no conversion-engine files were measured');
else requireThreshold('conversion engines lines', percent(engineEntries, 'lines'), 95);

if (failures.length) {
  console.error(`Coverage gates failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Coverage gates passed: ${overallLines.toFixed(2)}% lines, ${overallFunctions.toFixed(2)}% functions, ${overallBranches.toFixed(2)}% branches; ${percent(engineEntries, 'lines').toFixed(2)}% conversion-engine lines; every source file ≥ 80% lines.`);
}
