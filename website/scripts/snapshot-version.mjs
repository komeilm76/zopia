#!/usr/bin/env node
/**
 * Freeze the user documentation of a released version into
 * `website/versions/<major.minor>/` (R-211 … R-213).
 *
 * Usage:
 *   node scripts/snapshot-version.mjs            # snapshot the working tree (current release)
 *   node scripts/snapshot-version.mjs v0.5.2     # snapshot a published git tag
 *   node scripts/snapshot-version.mjs v0.5.2 --keep 2
 *
 * A snapshot is immutable once written (R-211): fixing a typo in an old
 * version is not a thing — fix `latest`. Exactly `--keep` snapshots survive
 * (default 2, i.e. the previous two minors next to `latest` = three browsable
 * versions, R-213).
 *
 * Releases before the v0.7 documentation split kept their user pages under
 * `docs/NN-*.md`; HISTORIC_PAGES maps those names onto today's routes so an
 * old snapshot still browses like the current site.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(websiteRoot);
const versionsRoot = join(websiteRoot, 'versions');

/** Current (post-split) layout: docs/user/<file> → route + metadata. */
const CURRENT_PAGES = {
  'index.md': ['guide', 'introduction', 'Introduction'],
  'installation.md': ['guide', 'installation', 'Installation'],
  'quick-start.md': ['guide', 'quick-start', 'Quick start'],
  'cli.md': ['guide', 'cli', 'CLI reference'],
  'programmatic-api.md': ['guide', 'programmatic-api', 'Programmatic API'],
  'configuration.md': ['guide', 'configuration', 'Configuration'],
  'runtime.md': ['guide', 'runtime', 'Runtime'],
  'conversions.md': ['reference', 'conversions', 'Conversions'],
  'api-docs-format.md': ['reference', 'api-docs-format', 'API docs format'],
  'components.md': ['reference', 'components', 'Components'],
  'errors-and-warnings.md': ['reference', 'errors-and-warnings', 'Errors & warnings'],
  'concepts.md': ['reference', 'concepts', 'Concepts'],
};

/** Pre-split layout (≤ v0.6): the user-facing subset of docs/*.md. */
const HISTORIC_PAGES = {
  '10-usage.md': ['guide', 'usage', 'Usage'],
  '09-configuration.md': ['guide', 'configuration', 'Configuration'],
  '07-api-docs.md': ['reference', 'api-docs-format', 'API docs format'],
  '08-components.md': ['reference', 'components', 'Components'],
  '06-conversions.md': ['reference', 'conversions', 'Conversions'],
  '05-concepts.md': ['reference', 'concepts', 'Concepts'],
};

const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const minorOf = (version) => `v${version.replace(/^v/, '').split('.').slice(0, 2).join('.')}`;

function parseArguments(argv) {
  const positional = argv.filter((value) => !value.startsWith('--'));
  const keepIndex = argv.indexOf('--keep');
  const keep = keepIndex === -1 ? 2 : Number.parseInt(argv[keepIndex + 1] ?? '', 10);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep expects a positive integer');
  return { tag: positional[0], keep };
}

/** Read the user pages of a tag (or of the working tree when no tag is given). */
async function collectPages(tag) {
  if (!tag) {
    const version = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version;
    const files = (await readdir(join(repositoryRoot, 'docs', 'user'))).filter((file) => file.endsWith('.md'));
    const pages = [];
    for (const file of files.sort()) {
      const route = CURRENT_PAGES[file];
      if (!route) throw new Error(`docs/user/${file} is not mapped in CURRENT_PAGES — add it before snapshotting.`);
      pages.push({ file, route, content: await readFile(join(repositoryRoot, 'docs', 'user', file), 'utf8') });
    }
    return { version, pages, layout: 'current' };
  }

  const version = tag.replace(/^v/, '');
  const tracked = git('ls-tree', '--name-only', tag, 'docs/', 'docs/user/').split('\n').filter(Boolean);
  const post = tracked.filter((path) => path.startsWith('docs/user/'));
  const layout = post.length ? 'current' : 'historic';
  const table = layout === 'current' ? CURRENT_PAGES : HISTORIC_PAGES;
  const prefix = layout === 'current' ? 'docs/user/' : 'docs/';

  const pages = [];
  for (const [file, route] of Object.entries(table)) {
    const path = `${prefix}${file}`;
    if (!tracked.includes(path)) continue;
    pages.push({ file, route, content: git('show', `${tag}:${path}`) });
  }
  if (!pages.length) throw new Error(`${tag} contains no recognizable user documentation.`);
  return { version, pages, layout };
}

async function main() {
  const { tag, keep } = parseArguments(process.argv.slice(2));
  const { version, pages, layout } = await collectPages(tag);
  const minor = minorOf(version);
  const directory = join(versionsRoot, minor);

  if (existsSync(directory)) {
    throw new Error(`${minor} is already snapshotted (R-211: snapshots are immutable). Remove it deliberately if you must re-cut it.`);
  }

  await mkdir(join(directory, 'pages'), { recursive: true });
  const meta = {
    version,
    tag: tag ?? `v${version}`,
    layout,
    takenAt: new Date().toISOString().slice(0, 10),
    pages: pages.map(({ file, route: [section, slug, title] }) => ({ file, section, slug, title })),
  };

  for (const page of pages) await writeFile(join(directory, 'pages', page.file), page.content, 'utf8');
  await writeFile(join(directory, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  // R-213 — keep only the newest `keep` snapshots next to `latest`.
  const snapshots = (await readdir(versionsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const [leftMajor, leftMinor] = left.slice(1).split('.').map(Number);
      const [rightMajor, rightMinor] = right.slice(1).split('.').map(Number);
      return rightMajor - leftMajor || rightMinor - leftMinor;
    });

  for (const stale of snapshots.slice(keep)) {
    await rm(join(versionsRoot, stale), { recursive: true, force: true });
    console.log(`🗑️  pruned ${stale} (keeping ${keep})`);
  }

  console.log(`✓ snapshotted ${minor} (${meta.tag}, ${pages.length} pages, ${layout} layout)`);
}

await main();
