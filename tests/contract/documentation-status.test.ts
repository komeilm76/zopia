import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const docsRoot = join(repositoryRoot, 'docs');
const documentationFiles = [
  join(repositoryRoot, 'README.md'),
  ...readdirSync(docsRoot)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => join(docsRoot, file)),
];

function markdown(file: string): string {
  return readFileSync(file, 'utf8');
}

function normalizedCode(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trimEnd()).join('\n').trimEnd();
}

function headingAnchor(heading: string): string {
  return heading.trim().toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

describe('documentation status contract', () => {
  it('R-184: every local Markdown link and heading anchor resolves', () => {
    const missing: string[] = [];
    for (const file of documentationFiles) {
      for (const match of markdown(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const destination = match[1].trim().replace(/^<|>$/g, '');
        if (!destination || /^[a-z][a-z\d+.-]*:/i.test(destination)) continue;
        const [relativePath, anchor] = destination.split('#', 2).map(decodeURIComponent);
        const target = relativePath ? resolve(dirname(file), relativePath) : file;
        if (!existsSync(target)) {
          missing.push(`${file}: ${destination}`);
          continue;
        }
        if (anchor) {
          const anchors = [...markdown(target).matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) => headingAnchor(heading[1]));
          if (!anchors.includes(anchor)) missing.push(`${file}: ${destination}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('R-186: current Phase 1 status and repository-layout claims stay synchronized', () => {
    const docsIndex = markdown(join(docsRoot, 'README.md'));
    const targets = markdown(join(docsRoot, '02-targets.md'));
    const roadmap = markdown(join(docsRoot, '03-roadmap.md'));
    const architecture = markdown(join(docsRoot, '04-architecture.md'));
    const components = markdown(join(docsRoot, '08-components.md'));
    const testing = markdown(join(docsRoot, '11-testing.md'));
    const phaseOne = roadmap.slice(roadmap.indexOf('## 🚀 Phase 1'), roadmap.indexOf('## 🧰 Phase 2'));

    expect(docsIndex).not.toContain('Implementing Phase 1');
    expect(targets).not.toContain('once implemented');
    expect(components).not.toContain('Planned endpoint files');
    expect(architecture).not.toMatch(/src\/(?:ir|engines|fs|cli)\//);
    expect(testing).not.toMatch(/src\/\*\*\/\*\.test\.ts|tests\/integration\//);
    expect(phaseOne).not.toMatch(/^- \[ \]/m);
    expect(phaseOne).toContain('Documentation status sync');

    const documentedSourceModules = [
      ...readdirSync(join(repositoryRoot, 'src')).filter((name) => name.endsWith('.ts')),
      ...readdirSync(join(repositoryRoot, 'src/conversions')).filter((name) => name.endsWith('.ts')),
    ];
    for (const module of documentedSourceModules) expect(architecture, `${module} missing from architecture layout`).toContain(module);

    for (const target of targets.matchAll(/^\| (T-\d+) \|.*$/gm)) {
      expect(target[0], `${target[1]} must have one current status`).toMatch(/\| ✅ \|$/);
    }
    expect([...targets.matchAll(/^\| T-\d+ \|/gm)]).toHaveLength(17);
  });

  it('R-186: concrete source, test, and script paths named in docs exist', () => {
    const missing: string[] = [];
    for (const file of documentationFiles) {
      for (const match of markdown(file).matchAll(/`((?:src|tests|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|mts|json))`/g)) {
        if (!existsSync(join(repositoryRoot, match[1]))) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('R-701/R-186: documented generated examples match their golden files', () => {
    const documentedEndpoint = normalizedCode(markdown(join(
      repositoryRoot,
      'tests/fixtures/expected/admin-api-3.0.directory/users/{userId}/get/index.ts',
    )));
    const referencedEndpoint = normalizedCode(markdown(join(
      repositoryRoot,
      'tests/fixtures/expected/admin-api-3.0.components/users/{userId}/get/index.ts',
    )));
    const userComponent = normalizedCode(markdown(join(
      repositoryRoot,
      'tests/fixtures/expected/admin-api-3.0.components/components/User/index.ts',
    )));
    const componentBarrel = normalizedCode(markdown(join(
      repositoryRoot,
      'tests/fixtures/expected/admin-api-3.0.components/components/index.ts',
    )));

    expect(markdown(join(docsRoot, '07-api-docs.md'))).toContain(`\`\`\`ts\n${documentedEndpoint}\n\`\`\``);
    const components = markdown(join(docsRoot, '08-components.md'));
    expect(components).toContain(`\`\`\`ts\n${referencedEndpoint}\n\`\`\``);
    expect(components).toContain(`\`\`\`ts\n${userComponent}\n\`\`\``);
    expect(components).toContain(`\`\`\`ts\n${componentBarrel}\n\`\`\``);
  });
});
