import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const websiteRoot = join(repositoryRoot, 'website');
const userDocsRoot = join(repositoryRoot, 'docs', 'user');

const read = (...segments: string[]): string => readFileSync(join(...segments), 'utf8');

describe('documentation website contract', () => {
  it('W-1/D-25: the website project exists with the documented commands', () => {
    const manifest = JSON.parse(read(websiteRoot, 'package.json')) as {
      private: boolean;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.private).toBe(true);
    expect(manifest.devDependencies.vitepress).toBeDefined();
    for (const script of ['sync', 'dev', 'build', 'audit', 'check', 'snapshot', 'preview']) expect(manifest.scripts[script]).toBeDefined();
    expect(manifest.scripts.check).toContain('audit');
    // The build must always re-sync so the site can never ship stale prose.
    expect(manifest.scripts.build).toContain('sync');
    expect(manifest.scripts.dev).toContain('sync');
  });

  it('D-26: the site is configured for the /zopia/ sub-path of the public user site', () => {
    const config = read(websiteRoot, '.vitepress', 'config.mts');
    expect(config).toContain("base: '/zopia/'");
    expect(config).toContain("srcDir: 'src'");
    // Dead links must fail the build — the site is a public contract.
    expect(config).toContain('ignoreDeadLinks: false');
    expect(config).toContain("provider: 'local'");
  });

  it('R-206/R-216/R-218: every user page has a website route and nothing else is hand-written', () => {
    const sync = read(websiteRoot, 'scripts', 'sync-content.mjs');
    const userPages = readdirSync(userDocsRoot).filter((file) => file.endsWith('.md')).sort();

    expect(userPages.length).toBeGreaterThan(0);
    for (const page of userPages) expect(sync, `${page} is not mapped to a website route`).toContain(`'${page}':`);

    // Generated content directories are never committed (they are rebuilt by `npm run sync`).
    const ignore = read(repositoryRoot, '.gitignore');
    for (const path of ['website/src/guide/', 'website/src/reference/', 'website/src/v*/', 'website/src/changelog.md', 'website/.vitepress/dist/']) {
      expect(ignore, `${path} must stay out of version control`).toContain(path);
    }

    // The home page is the only hand-written Markdown inside the website project.
    expect(readdirSync(join(websiteRoot, 'src')).filter((file) => file.endsWith('.md'))).toContain('index.md');
  });

  it('R-221/R-223/R-231/R-232: the docs workflow publishes to the public site repository independently of npm publishing', () => {
    // The workflow template lives in docs/development until a maintainer copies
    // it to .github/workflows/docs.yml (see the header of the template).
    const workflow = read(repositoryRoot, 'docs', 'development', 'docs-workflow.yml.example');

    expect(workflow).toContain('repository: komeilm76/komeilm76.github.io');
    expect(workflow).toContain('secrets.PAGES_DEPLOY_TOKEN');
    expect(workflow).toContain('rm -rf site-repo/zopia');
    expect(workflow).toContain('/zopia/assets/');
    for (const path of ['docs/user/**', 'website/**', 'CHANGELOG.md']) expect(workflow).toContain(path);

    // The npm publish pipeline must not depend on, or be triggered by, the docs pipeline.
    const publish = read(repositoryRoot, '.github', 'workflows', 'publish.yml');
    expect(publish).not.toContain('docs.yml');
    expect(workflow).not.toContain('run: npm publish');
  });

  it('D-26b: the public-repository workflow deploys the same build through the native Pages pipeline', () => {
    const workflow = read(repositoryRoot, 'docs', 'development', 'docs-workflow-public.yml.example');

    // Native GitHub Pages deployment — no second repository, no deploy token.
    expect(workflow).toContain('actions/upload-pages-artifact@v3');
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('path: website/.vitepress/dist');
    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).not.toContain('PAGES_DEPLOY_TOKEN');
    expect(workflow).not.toContain('komeilm76/komeilm76.github.io');

    // Identical quality guarantees to the private-repository template.
    expect(workflow).toContain('npm run audit');
    expect(workflow).toContain('/zopia/assets/');
    expect(workflow).toContain('.nojekyll');
    expect(workflow).toContain('snapshot-version.mjs');
    for (const path of ['docs/user/**', 'website/**', 'CHANGELOG.md']) expect(workflow).toContain(path);
    expect(workflow).not.toContain('run: npm publish');

    // Only one of the two templates may ever be live.
    expect(existsSync(join(repositoryRoot, '.github', 'workflows', 'docs.yml')), 'a maintainer activates exactly one template').toBe(false);
  });

  it('R-211/R-212/R-213/R-215: version snapshots are frozen, mapped, and limited to the previous two minors', () => {
    const versionsRoot = join(websiteRoot, 'versions');
    const snapshots = readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(snapshots.length, 'at most the previous two minors are browsable (R-213)').toBeLessThanOrEqual(2);
    expect(snapshots.length, 'the switcher needs at least one older version to be useful').toBeGreaterThan(0);

    const latestMinor = `v${(JSON.parse(read(repositoryRoot, 'package.json')) as { version: string }).version.split('.').slice(0, 2).join('.')}`;

    for (const snapshot of snapshots) {
      expect(snapshot, 'snapshot directories are named vMAJOR.MINOR').toMatch(/^v\d+\.\d+$/);
      expect(snapshot, 'the latest minor is served from the site root, never snapshotted').not.toBe(latestMinor);

      const meta = JSON.parse(read(versionsRoot, snapshot, 'meta.json')) as {
        version: string;
        tag: string;
        pages: { file: string; section: string; slug: string; title: string }[];
      };

      expect(`v${meta.version.split('.').slice(0, 2).join('.')}`).toBe(snapshot);
      expect(meta.pages.length).toBeGreaterThan(0);
      for (const page of meta.pages) {
        expect(['guide', 'reference']).toContain(page.section);
        expect(existsSync(join(versionsRoot, snapshot, 'pages', page.file)), `${snapshot}/${page.file} is missing`).toBe(true);
      }
    }

    // R-215 — the switcher and per-version sidebars are generated, not hand-written.
    const config = read(websiteRoot, '.vitepress', 'config.mts');
    expect(config).toContain('versions.generated.json');
    expect(config).toContain('versionSidebars');
    // R-214 — every snapshot page is rendered with an outdated-version banner.
    expect(read(websiteRoot, 'scripts', 'sync-content.mjs')).toContain('YOU ARE READING OLD DOCUMENTATION');
  });

  it('W-5: the built site is gated by a deterministic quality audit', () => {
    const audit = read(websiteRoot, 'scripts', 'audit.mjs');
    for (const check of ['htmlKilobytes', 'assetMegabytes', 'missing <html lang', 'missing meta description', 'alt text', 'has no built page']) {
      expect(audit, `the audit must check: ${check}`).toContain(check);
    }
    expect(read(repositoryRoot, 'docs', 'development', 'docs-workflow.yml.example')).toContain('npm run audit');
  });

  it('W-8: the website is buildable from a clean clone (sources present, build output absent)', () => {
    for (const path of [
      ['website', '.vitepress', 'config.mts'],
      ['website', '.vitepress', 'theme', 'index.ts'],
      ['website', '.vitepress', 'theme', 'style.css'],
      ['website', 'scripts', 'sync-content.mjs'],
      ['website', 'scripts', 'snapshot-version.mjs'],
      ['website', 'scripts', 'audit.mjs'],
      ['website', '.vitepress', 'versions.generated.json'],
      ['website', 'src', 'index.md'],
      ['website', 'package-lock.json'],
    ]) {
      expect(existsSync(join(repositoryRoot, ...path)), `${path.join('/')} is missing`).toBe(true);
    }
  });
});
