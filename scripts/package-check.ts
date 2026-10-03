import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

interface PackedFile {
  path: string;
}

interface PackedPackage {
  filename: string;
  files: PackedFile[];
  name: string;
  version: string;
}

interface PackageManifest {
  name?: string;
  version?: string;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as PackageManifest;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (!packageManifest.name || !packageManifest.version) throw new Error('package.json must declare a package name and version');

async function run(label: string, executable: string, args: string[], cwd = repositoryRoot): Promise<void> {
  console.log(`\n▶ ${label}`);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${label} terminated with ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) throw new Error(`${label} exited with ${exitCode}`);
}

async function capture(executable: string, args: string[], cwd = repositoryRoot): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${executable} terminated with ${signal}`));
      else if (code !== 0) reject(new Error(`${executable} exited with ${code ?? 1}`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'zopia-package-check-'));
try {
  console.log('\n▶ npm package archive');
  const packed = JSON.parse(await capture(npm, [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temporaryDirectory,
  ])) as PackedPackage[];
  if (packed.length !== 1) throw new Error(`npm pack returned ${packed.length} packages`);
  const [{ filename, files, name, version }] = packed;
  if (name !== packageManifest.name || version !== packageManifest.version) throw new Error(`unexpected package identity: ${name}@${version}`);

  const paths = files.map((file) => file.path);
  const packedDocs = [
    'docs/user/api-docs-format.md', 'docs/user/cli.md', 'docs/user/components.md', 'docs/user/concepts.md',
    'docs/user/configuration.md', 'docs/user/conversions.md', 'docs/user/errors-and-warnings.md',
    'docs/user/index.md', 'docs/user/installation.md', 'docs/user/programmatic-api.md',
    'docs/user/quick-start.md', 'docs/user/runtime.md',
  ];
  const required = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'bin/zopia.js', 'src/index.ts', 'src/runtime.ts', ...packedDocs];
  for (const path of required) if (!paths.includes(path)) throw new Error(`package archive is missing ${path}`);
  const allowed = /^(?:package\.json$|README\.md$|CHANGELOG\.md$|LICENSE$|bin\/|src\/|docs\/user\/[a-z0-9-]+\.md$)/;
  const unexpected = paths.filter((path) => !allowed.test(path));
  if (unexpected.length) throw new Error(`package archive contains private files: ${unexpected.join(', ')}`);
  // npm users get practical usage/installation docs only — development docs stay on GitHub.
  const internalDocs = paths.filter((path) => /^docs\//.test(path) && !packedDocs.includes(path));
  if (internalDocs.length) throw new Error(`package archive contains development-only docs: ${internalDocs.join(', ')}`);
  if (paths.some((path) => /^(?:tests|scripts|coverage|km-api-promts)\//.test(path) || /(?:^|\/)(?:bun\.lock|package-lock\.json|tsconfig\.json|vitest\.config\.mts)$/.test(path))) {
    throw new Error('package archive contains development-only files');
  }

  const archive = join(temporaryDirectory, basename(filename));
  const consumer = join(temporaryDirectory, 'consumer');
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'zopia-packed-consumer',
    private: true,
    type: 'module',
    dependencies: {
      'km-api': pathToFileURL(join(repositoryRoot, 'node_modules', 'km-api')).href,
      zod: pathToFileURL(join(repositoryRoot, 'node_modules', 'zod')).href,
      zopia: pathToFileURL(archive).href,
    },
  }, null, 2));
  await run('Offline packed-package install', process.execPath, ['install', '--offline'], consumer);

  await writeFile(join(consumer, 'smoke.ts'), [
    "import { normalizeOpenApiDocument, zodToJsonSchema } from 'zopia';",
    "import { z } from 'zod';",
    "const normalized = normalizeOpenApiDocument({ openapi: '3.1.0', info: { title: 'Packed', version: '1.0.0' }, paths: {} });",
    "const schema = zodToJsonSchema(z.object({ id: z.string() }));",
    "if (normalized.version !== '3.1' || schema.type !== 'object') throw new Error('packed library import failed');",
    '',
  ].join('\n'));
  await run('Packed library import', process.execPath, ['run', 'smoke.ts'], consumer);

  const specification = join(consumer, 'openapi.json');
  const generated = join(consumer, 'api-docs');
  const reversed = join(consumer, 'reversed.json');
  await writeFile(specification, JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Packed CLI', version: '1.0.0' },
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: { '200': { description: 'Healthy', content: { 'application/json': { schema: { type: 'string' } } } } },
        },
      },
    },
  }));
  const binary = join(consumer, 'node_modules', 'zopia', 'bin', 'zopia.js');
  await run('Packed CLI help', 'node', [binary, '--help'], consumer);
  await run('Packed CLI generation', 'node', [binary, 'generate', specification, generated], consumer);
  await run('Packed CLI reverse conversion', 'node', [binary, 'reverse', generated, '--out', reversed], consumer);

  // The opt-in runtime subpath must work from the packed archive: load the generated
  // tree into the nested/flat objects and hand a leaf back to km-api-level checks.
  await writeFile(join(consumer, 'smoke-runtime.ts'), [
    "import { createApiDocs, flattenApiDocs } from 'zopia/runtime';",
    "const apiDocs = await createApiDocs('api-docs');",
    "const endpoint = apiDocs.health.get;",
    "const endpoints = flattenApiDocs(apiDocs);",
    "if (endpoint.pathShape !== '/health' || endpoint.method !== 'GET') throw new Error('packed runtime tree access failed');",
    "if (endpoints.getHealth !== endpoint) throw new Error('packed runtime flatten failed');",
    '',
  ].join('\n'));
  await run('Packed runtime subpath import', process.execPath, ['run', 'smoke-runtime.ts'], consumer);
  const output = JSON.parse(await readFile(reversed, 'utf8')) as Record<string, unknown>;
  const info = output.info as Record<string, unknown> | undefined;
  const pathsObject = output.paths as Record<string, unknown> | undefined;
  if (output.openapi !== '3.1.0' || info?.title !== 'Packed CLI' || !pathsObject?.['/health']) {
    throw new Error('packed CLI produced an unexpected reverse document');
  }

  console.log(`\nPacked ${name}@${version} passed archive, import, and CLI checks.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
