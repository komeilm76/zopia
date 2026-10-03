import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZOPIA_VERSION } from '../../src/conversions/manifest-writer';

interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  keywords?: string[];
  homepage?: string;
  bugs?: { url?: string };
  repository?: { type?: string; url?: string };
  author?: string;
  license?: string;
  type?: string;
  types?: string;
  sideEffects?: boolean;
  files?: string[];
  packageManager?: string;
  engines?: Record<string, string>;
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  exports?: Record<string, { types?: string; import?: string; default?: string }>;
}

interface PackedPackage {
  name: string;
  version: string;
  files: Array<{ path: string; mode: number }>;
}

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as PackageManifest;

function dryRunPackage(): PackedPackage {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = execFileSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const packages = JSON.parse(output) as PackedPackage[];
  expect(packages).toHaveLength(1);
  return packages[0];
}

describe('package and release contract', () => {
  it('S-76/R-191: release identity and public package metadata are complete and synchronized', () => {
    expect(manifest).toMatchObject({
      name: 'zopia',
      version: '0.6.0',
      description: expect.any(String),
      homepage: 'https://github.com/komeilm76/zopia#readme',
      bugs: { url: 'https://github.com/komeilm76/zopia/issues' },
      repository: { type: 'git', url: 'git+https://github.com/komeilm76/zopia.git' },
      author: 'komeilm76',
      license: 'MIT',
      type: 'module',
      types: './src/index.ts',
      sideEffects: false,
      packageManager: 'bun@1.2.21',
      publishConfig: { access: 'public' },
      engines: { bun: '>=1.1', node: '>=20' },
      peerDependencies: { 'km-api': '^0.4.1', zod: '^4.0.0' },
      bin: { zopia: './bin/zopia.js' },
      exports: { '.': { types: './src/index.ts', import: './src/index.ts', default: './src/index.ts' } },
    });
    expect(manifest.private).not.toBe(true);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.keywords).toEqual(expect.arrayContaining(['openapi', 'swagger', 'zod', 'json-schema', 'km-api']));
    expect(manifest.version).toBe(ZOPIA_VERSION);

    const packageLock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    const changelog = readFileSync(join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
    const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');
    expect(packageLock.version).toBe(manifest.version);
    expect(packageLock.packages?.['']?.version).toBe(manifest.version);
    expect(changelog).toContain(`## [${manifest.version}] - 2026-09-30`);
    expect(readme).toContain(`v${manifest.version} released`);
  });

  it('T-14/R-193: the pinned Bun gate owns every required release check', () => {
    expect(manifest.devDependencies).toMatchObject({
      '@vitest/coverage-v8': '4.1.11',
      vitest: '4.1.11',
    });
    expect(manifest.devDependencies).not.toHaveProperty('vite-node');
    expect(manifest.scripts).toMatchObject({
      typecheck: 'tsc --noEmit',
      test: 'vitest run',
      coverage: 'vitest run --coverage && bun scripts/check-coverage.ts',
      'golden:update': 'bun scripts/update-golden.ts',
      'package:check': 'bun scripts/package-check.ts',
      'release:check': 'bun run bun:gate',
      prepublishOnly: 'bun run release:check',
    });

    const packageLock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { version?: string }> };
    expect(packageLock.packages?.['node_modules/vitest']?.version).toBe('4.1.11');
    expect(packageLock.packages?.['node_modules/@vitest/coverage-v8']?.version).toBe('4.1.11');

    const gate = readFileSync(join(repositoryRoot, 'scripts', 'bun-gate.ts'), 'utf8');
    for (const step of ['Frozen Bun install', 'Strict TypeScript', 'Vitest suite', 'Coverage gates', 'CLI help', 'Published CLI binary wrapper', 'Bun generated-TypeScript import and reverse conversion', 'Packed npm artifact']) {
      expect(gate).toContain(step);
    }
  });

  it('R-192: the npm archive is allowlisted, executable, and free of development files', () => {
    expect(manifest.files).toEqual(['bin', 'src', 'docs/07-api-docs.md', 'docs/09-configuration.md', 'docs/10-usage.md', '!docs/README.md', 'CHANGELOG.md', 'LICENSE', 'README.md']);
    const packed = dryRunPackage();
    expect({ name: packed.name, version: packed.version }).toEqual({ name: 'zopia', version: '0.6.0' });

    const paths = packed.files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining([
      'package.json',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'bin/zopia.js',
      'src/index.ts',
      'src/runtime.ts',
      'src/runtime/create-api-docs.ts',
      'docs/07-api-docs.md',
      'docs/09-configuration.md',
      'docs/10-usage.md',
    ]));
    expect(paths.filter((path) => !/^(?:package\.json$|README\.md$|CHANGELOG\.md$|LICENSE$|bin\/|src\/|docs\/(?:07-api-docs|09-configuration|10-usage)\.md$)/.test(path))).toEqual([]);
    // R-192: npm consumers ship with the practical docs only — the development
    // documentation (overview/targets/roadmap/architecture/concepts/conversions/
    // components/testing/standards, the docs map, the publish-workflow example)
    // never enters the archive and is linked to GitHub from the README instead.
    expect(paths.filter((path) => /^docs\//.test(path))).toEqual(['docs/07-api-docs.md', 'docs/09-configuration.md', 'docs/10-usage.md']);
    expect(paths.filter((path) => /^(?:tests|scripts|coverage|km-api-promts)\//.test(path)
      || /(?:^|\/)(?:bun\.lock|package-lock\.json|tsconfig\.json|vitest\.config\.mts)$/.test(path))).toEqual([]);

    const binary = packed.files.find((file) => file.path === 'bin/zopia.js');
    expect(binary?.mode).toBe(0o755);
    expect(statSync(join(repositoryRoot, 'bin', 'zopia.js')).mode & 0o111).not.toBe(0);
  });

  it('R-193: publishing is guarded by the complete release gate', () => {
    expect(manifest.scripts).toMatchObject({
      'package:check': 'bun scripts/package-check.ts',
      'release:check': 'bun run bun:gate',
      prepublishOnly: 'bun run release:check',
    });
  });
});
