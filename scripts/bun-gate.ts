import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageManifest {
  packageManager?: string;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as PackageManifest;
const expectedVersion = packageManifest.packageManager?.match(/^bun@(.+)$/)?.[1];
const actualVersion = (process.versions as Record<string, string | undefined>).bun;

if (!expectedVersion) throw new Error('package.json must pin Bun through packageManager');
if (actualVersion !== expectedVersion) throw new Error(`Bun ${expectedVersion} is required by package.json; received ${actualVersion ?? 'a non-Bun runtime'}`);

async function runExecutable(label: string, executable: string, args: string[], expectedExitCode = 0): Promise<void> {
  console.log(`\n▶ ${label}`);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repositoryRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${label} terminated with ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== expectedExitCode) throw new Error(`${label} exited with ${exitCode}; expected ${expectedExitCode}`);
}

const run = (label: string, args: string[]): Promise<void> => runExecutable(label, process.execPath, args);

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'zopia-bun-gate-'));
try {
  await run('Frozen Bun install', ['install', '--frozen-lockfile']);
  await run('Strict TypeScript', ['run', 'typecheck']);
  await run('Vitest suite', ['run', 'test']);
  await run('Coverage gates', ['run', 'coverage']);
  await run('CLI help', ['run', 'src/cli.ts', '--help']);
  await runExecutable('Published CLI binary wrapper', 'node', ['bin/zopia.js', '--help']);
  await runExecutable('Published CLI typed-error exit status', 'node', ['bin/zopia.js', 'unknown'], 1);

  const generatedDirectory = join(temporaryDirectory, 'api-docs');
  const reversedFile = join(temporaryDirectory, 'reversed.json');
  await run('CLI generation', [
    'run',
    'src/cli.ts',
    'generate',
    join(repositoryRoot, 'tests', 'fixtures', 'specs', 'admin-api-3.0.json'),
    generatedDirectory,
    '--insert-components',
    '--use-component-as-reference',
  ]);
  await run('Bun generated-TypeScript import and reverse conversion', [
    'run',
    'src/cli.ts',
    'reverse',
    generatedDirectory,
    '--out',
    reversedFile,
  ]);

  const reversed = JSON.parse(await readFile(reversedFile, 'utf8')) as Record<string, unknown>;
  const info = reversed.info as Record<string, unknown> | undefined;
  const paths = reversed.paths as Record<string, unknown> | undefined;
  if (reversed.openapi !== '3.1.0' || info?.title !== 'Admin API' || !paths?.['/users/{userId}']) {
    throw new Error('Bun CLI smoke test produced an unexpected reverse document');
  }

  console.log(`\nBun ${actualVersion} gate passed.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
