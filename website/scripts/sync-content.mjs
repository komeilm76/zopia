#!/usr/bin/env node
/**
 * Sync `docs/user/**` (and the frozen snapshots in `website/versions/`) into
 * the VitePress content tree.
 *
 * The user documentation in `docs/user/` is the single source of truth (R-206):
 * it ships inside the npm archive *and* renders on the website. This script is
 * the only thing allowed to write into the generated content directories
 * (R-216) — prose is never hand-edited inside `website/`.
 *
 * What it does per page:
 *   1. maps the source file to its public route (R-218: unmapped file → error)
 *   2. injects VitePress frontmatter (title, description, outline)
 *   3. rewrites relative Markdown links to site routes (R-217)
 *   4. strips the page's trailing "Next" navigation block (VitePress renders
 *      prev/next links itself, so the hand-written one would be duplicated)
 *
 * Versioned documentation (R-211 … R-215):
 *   - each `website/versions/<vX.Y>/` snapshot renders under `/vX.Y/…`
 *   - every snapshot page gets the outdated-version banner (R-214)
 *   - the generated `versions.generated.json` drives the version switcher and
 *     the per-version sidebars, so neither is ever hand-maintained (R-215)
 */

import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(websiteRoot);
const userDocsRoot = join(repositoryRoot, 'docs', 'user');
const versionsRoot = join(websiteRoot, 'versions');
const contentRoot = join(websiteRoot, 'src');

const GITHUB_BLOB = 'https://github.com/komeilm76/zopia/blob/main/';
const GITHUB_TREE = 'https://github.com/komeilm76/zopia/blob/';

/** Source file → { section, slug, title, description } for every user page. */
const ROUTES = {
  'index.md': { section: 'guide', slug: 'introduction', title: 'Introduction', description: 'What zopia is and how its documentation is organized.' },
  'installation.md': { section: 'guide', slug: 'installation', title: 'Installation', description: 'Requirements, peer dependencies, package managers, and TypeScript setup.' },
  'quick-start.md': { section: 'guide', slug: 'quick-start', title: 'Quick start', description: 'From an OpenAPI file to type-safe endpoint code in five minutes.' },
  'cli.md': { section: 'guide', slug: 'cli', title: 'CLI reference', description: 'Every zopia command, flag, default, effect, and exit code.' },
  'programmatic-api.md': { section: 'guide', slug: 'programmatic-api', title: 'Programmatic API', description: 'Every exported function, its parameters, and its result shape.' },
  'configuration.md': { section: 'guide', slug: 'configuration', title: 'Configuration', description: 'zopia.config.ts and the complete option reference with defaults.' },
  'runtime.md': { section: 'guide', slug: 'runtime', title: 'Runtime', description: 'Load a generated api-docs tree with createApiDocs() and flattenApiDocs().' },
  'conversions.md': { section: 'reference', slug: 'conversions', title: 'Conversions', description: 'The exact mapping rules of the four conversion engines.' },
  'api-docs-format.md': { section: 'reference', slug: 'api-docs-format', title: 'API docs format', description: 'Layouts, the index.ts contract, the manifest, and regeneration.' },
  'components.md': { section: 'reference', slug: 'components', title: 'Components', description: '$ref handling, insertComponents, and useComponentAsReference.' },
  'errors-and-warnings.md': { section: 'reference', slug: 'errors-and-warnings', title: 'Errors & warnings', description: 'Every stable zopia error and warning code, its cause, and its fix.' },
  'concepts.md': { section: 'reference', slug: 'concepts', title: 'Concepts', description: 'Glossary — Swagger 2.0, OpenAPI 3.x, JSON Schema, $ref, Zod v4, km-api.' },
};

const route = (file) => {
  const entry = ROUTES[file];
  if (!entry) {
    throw new Error(
      `docs/user/${file} has no website route (R-218).\n` +
        'Add it to ROUTES in website/scripts/sync-content.mjs and to the sidebar in website/.vitepress/config.mts.',
    );
  }
  return entry;
};

const routePath = (file, prefix = '') => {
  const { section, slug } = route(file);
  return `${prefix}/${section}/${slug}`;
};

/** Rewrite one Markdown link target that points at another user page. */
function rewriteTarget(target, pages, prefix, fallback) {
  const [path, anchor] = target.split('#');
  if (!path) return target; // same-page anchor
  const file = path.replace(/^\.\//, '');
  const page = pages[file];
  if (!page) return fallback ? `${fallback}${file}${anchor ? `#${anchor}` : ''}` : target;
  return `${prefix}/${page.section}/${page.slug}${anchor ? `#${anchor}` : ''}`;
}

function frontmatter(title, description) {
  return ['---', `title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(description)}`, 'outline: [2, 3]', '---', '', ''].join('\n');
}

function transform(markdown, { title, description, pages, prefix, fallback, banner }) {
  let body = markdown
    .replace(/\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g, (_match, target) => `](${rewriteTarget(target, pages, prefix, fallback)})`)
    .trimEnd();

  // Drop the hand-written trailing "Next" block — VitePress renders prev/next.
  body = body.replace(/\n## 🔗 Next\n[\s\S]*$/, '').trimEnd();

  // The banner goes after the H1 so the page still opens with its title.
  if (banner) {
    const lines = body.split('\n');
    const headingIndex = lines.findIndex((line) => line.startsWith('# '));
    const insertAt = headingIndex === -1 ? 0 : headingIndex + 1;
    lines.splice(insertAt, 0, '', banner);
    body = lines.join('\n');
  }

  return `${frontmatter(title, description)}${body}\n`;
}

/** Render `docs/user/` as the latest version. */
async function syncLatest() {
  const files = (await readdir(userDocsRoot)).filter((file) => file.endsWith('.md')).sort();

  // R-218 — every source page must be mapped, and every mapping must exist.
  for (const file of files) route(file);
  for (const file of Object.keys(ROUTES)) {
    if (!files.includes(file)) throw new Error(`ROUTES maps docs/user/${file}, which does not exist.`);
  }

  for (const section of ['guide', 'reference']) {
    await rm(join(contentRoot, section), { recursive: true, force: true });
    await mkdir(join(contentRoot, section), { recursive: true });
  }

  const pages = Object.fromEntries(Object.entries(ROUTES).map(([file, entry]) => [file, entry]));
  for (const file of files) {
    const { section, slug, title, description } = route(file);
    const markdown = await readFile(join(userDocsRoot, file), 'utf8');
    await writeFile(
      join(contentRoot, section, `${slug}.md`),
      transform(markdown, { title, description, pages, prefix: '', fallback: GITHUB_BLOB }),
      'utf8',
    );
  }

  return files.length;
}

/** Render every frozen snapshot under `/vX.Y/…` with an outdated banner. */
async function syncVersions(latestVersion) {
  if (!existsSync(versionsRoot)) return [];

  const directories = (await readdir(versionsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const [leftMajor, leftMinor] = left.slice(1).split('.').map(Number);
      const [rightMajor, rightMinor] = right.slice(1).split('.').map(Number);
      return rightMajor - leftMajor || rightMinor - leftMinor;
    });

  const rendered = [];
  for (const minor of directories) {
    const meta = JSON.parse(await readFile(join(versionsRoot, minor, 'meta.json'), 'utf8'));
    const pages = Object.fromEntries(meta.pages.map((page) => [page.file, page]));
    const prefix = `/${minor}`;

    await rm(join(contentRoot, minor), { recursive: true, force: true });
    for (const section of new Set(meta.pages.map((page) => page.section))) {
      await mkdir(join(contentRoot, minor, section), { recursive: true });
    }

    for (const page of meta.pages) {
      const markdown = await readFile(join(versionsRoot, minor, 'pages', page.file), 'utf8');
      // R-214 — every non-latest page says so, and links to the current docs.
      const banner = [
        '::: warning YOU ARE READING OLD DOCUMENTATION',
        `This page documents zopia **v${meta.version}**. The latest version is **v${latestVersion}** —`,
        `[read the current documentation](/guide/introduction) or [browse the v${meta.version} sources](${GITHUB_TREE}${meta.tag}/docs).`,
        ':::',
      ].join('\n');

      await writeFile(
        join(contentRoot, minor, page.section, `${page.slug}.md`),
        transform(markdown, {
          title: `${page.title} (${minor})`,
          description: `${page.title} — zopia ${meta.version} documentation snapshot.`,
          pages,
          prefix,
          fallback: `${GITHUB_TREE}${meta.tag}/docs/`,
          banner,
        }),
        'utf8',
      );
    }

    rendered.push({ minor, version: meta.version, tag: meta.tag, pages: meta.pages.map(({ section, slug, title }) => ({ section, slug, title })) });
  }

  return rendered;
}

async function syncChangelog() {
  const raw = await readFile(join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
  // The changelog links to repository files (./LICENSE, docs/…); on the site
  // those must resolve to GitHub, not to a site route.
  const source = raw.replace(/\]\((?!https?:|#|\/)\.?\/?([^)\s]+)\)/g, (_match, target) => `](${GITHUB_BLOB}${target})`);
  await writeFile(join(contentRoot, 'changelog.md'), `${frontmatter('Changelog', 'Release history of the zopia package.')}${source.trimEnd()}\n`, 'utf8');
}

async function sync() {
  const { version: latestVersion } = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const pageCount = await syncLatest();
  const versions = await syncVersions(latestVersion);
  await syncChangelog();

  // R-215 — the switcher and per-version sidebars are generated, never hand-written.
  await writeFile(
    join(websiteRoot, '.vitepress', 'versions.generated.json'),
    `${JSON.stringify({ latest: latestVersion, latestMinor: `v${latestVersion.split('.').slice(0, 2).join('.')}`, versions }, null, 2)}\n`,
    'utf8',
  );

  const snapshots = versions.map((entry) => entry.minor).join(', ') || 'none';
  console.log(`✓ synced ${pageCount} user pages + changelog · snapshots: ${snapshots} → ${resolve(contentRoot)}`);
}

await sync();

// `--watch` keeps the site in step with docs/user while `vitepress dev` runs:
// VitePress watches website/src, which this script owns, so edits to the real
// sources would otherwise not hot-reload.
if (process.argv.includes('--watch')) {
  let pending;
  const schedule = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      sync().catch((error) => console.error(`✖ sync failed: ${error.message}`));
    }, 60);
  };
  watch(userDocsRoot, { persistent: true }, schedule);
  watch(join(repositoryRoot, 'CHANGELOG.md'), { persistent: true }, schedule);
  console.log('👀 watching docs/user/ and CHANGELOG.md');
}
