#!/usr/bin/env node
/**
 * Sync `docs/user/**` into the VitePress content tree.
 *
 * The user documentation in `docs/user/` is the single source of truth (R-206):
 * it ships inside the npm archive *and* renders on the website. This script is
 * the only thing allowed to write into `website/src/guide`,
 * `website/src/reference`, and `website/src/changelog.md` (R-216) — prose is
 * never hand-edited inside `website/`.
 *
 * What it does per page:
 *   1. maps the source file to its public route (R-218: unmapped file → error)
 *   2. injects VitePress frontmatter (title, description, outline, editLink)
 *   3. rewrites relative Markdown links to site routes (R-217)
 *   4. strips the page's trailing "Next" navigation block (VitePress renders
 *      prev/next links itself, so the hand-written one would be duplicated)
 */

import { watch } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(websiteRoot);
const userDocsRoot = join(repositoryRoot, 'docs', 'user');
const contentRoot = join(websiteRoot, 'src');

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

const routePath = (file) => {
  const { section, slug } = route(file);
  return `/${section}/${slug}`;
};

/** Rewrite one Markdown link target that points at another user page. */
function rewriteTarget(target) {
  const [path, anchor] = target.split('#');
  if (!path) return target; // same-page anchor
  const file = path.replace(/^\.\//, '');
  if (!(file in ROUTES)) return target;
  return anchor ? `${routePath(file)}#${anchor}` : routePath(file);
}

function transform(file, markdown) {
  const { title, description } = route(file);

  let body = markdown
    // links to sibling user pages → site routes
    .replace(/\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g, (_match, target) => `](${rewriteTarget(target)})`)
    // the H1 is rendered from frontmatter-driven content, keep it but drop a duplicated title line
    .trimEnd();

  // Drop the hand-written trailing "Next" block — VitePress renders prev/next.
  body = body.replace(/\n## 🔗 Next\n[\s\S]*$/, '').trimEnd();

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    'outline: [2, 3]',
    '---',
    '',
    '',
  ].join('\n');

  return `${frontmatter}${body}\n`;
}

const GITHUB_BLOB = 'https://github.com/komeilm76/zopia/blob/main/';

async function syncChangelog() {
  const raw = await readFile(join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
  // The changelog links to repository files (./LICENSE, ./docs/…); on the site
  // those must resolve to GitHub, not to a site route.
  const source = raw.replace(
    /\]\((?!https?:|#|\/)\.?\/?([^)\s]+)\)/g,
    (_match, target) => `](${GITHUB_BLOB}${target})`,
  );
  const frontmatter = ['---', 'title: "Changelog"', 'description: "Release history of the zopia package."', 'outline: [2, 2]', '---', '', ''].join('\n');
  await writeFile(join(contentRoot, 'changelog.md'), `${frontmatter}${source.trimEnd()}\n`, 'utf8');
}

async function sync() {
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

  for (const file of files) {
    const { section, slug } = route(file);
    const markdown = await readFile(join(userDocsRoot, file), 'utf8');
    await writeFile(join(contentRoot, section, `${slug}.md`), transform(file, markdown), 'utf8');
  }

  await syncChangelog();

  console.log(`✓ synced ${files.length} user pages + changelog → ${resolve(contentRoot)}`);
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
