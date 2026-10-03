import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const docsRoot = join(repositoryRoot, 'docs');
const userDocsRoot = join(docsRoot, 'user');
const developmentDocsRoot = join(docsRoot, 'development');
const expectedUserDocumentationFiles = [
  'api-docs-format.md',
  'cli.md',
  'components.md',
  'concepts.md',
  'configuration.md',
  'conversions.md',
  'errors-and-warnings.md',
  'index.md',
  'installation.md',
  'programmatic-api.md',
  'quick-start.md',
  'runtime.md',
];
const expectedDevelopmentDocumentationFiles = [
  '01-overview.md',
  '02-targets.md',
  '03-roadmap.md',
  '04-architecture.md',
  '11-testing.md',
  '12-standards.md',
  '13-documentation-split.md',
  '14-website.md',
  '15-website-setup.md',
];
const documentationFiles = [
  join(repositoryRoot, 'README.md'),
  join(docsRoot, 'README.md'),
  ...expectedUserDocumentationFiles.map((file) => join(userDocsRoot, file)),
  ...expectedDevelopmentDocumentationFiles.map((file) => join(developmentDocsRoot, file)),
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

function testSourceFiles(directory = join(repositoryRoot, 'tests')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testSourceFiles(path) : entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  }).sort();
}

describe('documentation status contract', () => {
  it('T-15/W-0/R-181/R-182/R-201: the audience-split documentation set is complete and uses structured Markdown', () => {
    expect(readdirSync(docsRoot).filter((file) => file.endsWith('.md')).sort()).toEqual(['README.md']);
    expect(readdirSync(userDocsRoot).filter((file) => file.endsWith('.md')).sort()).toEqual(expectedUserDocumentationFiles);
    expect(readdirSync(developmentDocsRoot).filter((file) => file.endsWith('.md')).sort()).toEqual(expectedDevelopmentDocumentationFiles);
    const rootReadme = markdown(join(repositoryRoot, 'README.md'));
    const docsReadme = markdown(join(docsRoot, 'README.md'));
    for (const file of expectedUserDocumentationFiles) {
      expect(rootReadme, `${file} missing from root documentation map`).toContain(`docs/user/${file}`);
      expect(docsReadme, `${file} missing from docs map`).toContain(`(user/${file})`);
      expect([...markdown(join(userDocsRoot, file)).matchAll(/\[[^\]]+\]\((?!https?:)[^)]+\.md(?:#[^)]+)?\)/g)].length, `${file} needs forward/back links`).toBeGreaterThanOrEqual(2);
    }
    for (const file of expectedDevelopmentDocumentationFiles) {
      expect(rootReadme, `${file} missing from root documentation map`).toContain(`docs/development/${file}`);
      expect(docsReadme, `${file} missing from docs map`).toContain(`(development/${file})`);
      expect([...markdown(join(developmentDocsRoot, file)).matchAll(/\[[^\]]+\]\((?!https?:)[^)]+\.md(?:#[^)]+)?\)/g)].length, `${file} needs forward/back links`).toBeGreaterThanOrEqual(2);
    }
    for (const file of documentationFiles) {
      const content = markdown(file);
      expect([...content.matchAll(/^#\s+\S.+$/gm)], `${file} must have one H1`).toHaveLength(1);
      let inFence = false;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.startsWith('```')) continue;
        if (!inFence) expect(line, `${file}:${index + 1} code fence needs a language`).toMatch(/^```[A-Za-z][A-Za-z0-9-]*$/);
        inFence = !inFence;
      }
      expect(inFence, `${file} has an unclosed code fence`).toBe(false);
    }
  });

  it('R-202/R-204: user documentation never leaks development-only material', () => {
    const leaks: string[] = [];
    for (const file of expectedUserDocumentationFiles) {
      const content = markdown(join(userDocsRoot, file));
      // Relative links into the development set would break on the website and
      // in the npm archive, where those files do not exist (R-204).
      if (content.includes('](../development/')) leaks.push(`${file}: relative link into docs/development/`);
      // Internal planning vocabulary has no meaning for a package consumer (R-202).
      for (const pattern of [/\bPhase \d\b/, /\bS-\d{2}\b/, /\bT-\d{1,2}\b/, /\bcoverage gate\b/i, /`(?:src|tests|scripts)\//]) {
        const match = content.match(pattern);
        if (match) leaks.push(`${file}: internal reference "${match[0]}"`);
      }
    }
    expect(leaks).toEqual([]);
  });

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
    const targets = markdown(join(developmentDocsRoot, '02-targets.md'));
    const roadmap = markdown(join(developmentDocsRoot, '03-roadmap.md'));
    const architecture = markdown(join(developmentDocsRoot, '04-architecture.md'));
    const components = markdown(join(userDocsRoot, 'components.md'));
    const testing = markdown(join(developmentDocsRoot, '11-testing.md'));
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

  it('T-13/R-124: every documented scenario is identified by an executable test', () => {
    const testing = markdown(join(developmentDocsRoot, '11-testing.md'));
    const scenarioIds = [...new Set([...testing.matchAll(/^\| (S-\d{2}) \|/gm)].map((match) => match[1]))].sort();
    const sources = testSourceFiles().map((file) => ({ file, text: markdown(file) }));
    const missing = scenarioIds.filter((scenario) => !sources.some(({ text }) => text.includes(scenario)));

    expect(scenarioIds.length).toBeGreaterThan(0);
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

    expect(markdown(join(userDocsRoot, 'api-docs-format.md'))).toContain(`\`\`\`ts\n${documentedEndpoint}\n\`\`\``);
    const components = markdown(join(userDocsRoot, 'components.md'));
    expect(components).toContain(`\`\`\`ts\n${referencedEndpoint}\n\`\`\``);
    expect(components).toContain(`\`\`\`ts\n${userComponent}\n\`\`\``);
    expect(components).toContain(`\`\`\`ts\n${componentBarrel}\n\`\`\``);
  });
});
