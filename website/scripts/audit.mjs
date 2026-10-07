#!/usr/bin/env node
/**
 * Static quality audit of the built site (W-5 / W-8).
 *
 * Lighthouse needs a real browser and a running server, so it is a manual /
 * scheduled check. This audit covers the deterministic part of the quality
 * floor — the regressions that actually happen when documentation changes —
 * and runs in CI on every build:
 *
 *   • base path       every asset reference is prefixed with /zopia/
 *   • metadata        unique, non-empty <title> and meta description per page
 *   • language        <html lang> is set (screen-reader + SEO requirement)
 *   • headings        exactly one <h1>, no skipped heading levels
 *   • images          every <img> has alt text
 *   • links           every internal link resolves to a built page
 *   • link text       no "click here" / "read more" style labels
 *   • leftovers       no unrendered Markdown links or stray "undefined"
 *   • weight          per-page HTML and total asset budgets
 *
 * Usage: node scripts/audit.mjs   (after `npm run build`)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(websiteRoot, '.vitepress', 'dist');
const BASE = '/zopia/';

const BUDGETS = {
  htmlKilobytes: 420, // a single rendered page (the CLI reference is the heaviest)
  assetMegabytes: 6, // all JS/CSS/fonts shipped by the site
};

const VAGUE_LINK_TEXT = ['click here', 'here', 'read more', 'more', 'link', 'this'];

const failures = [];
const fail = (page, message) => failures.push(`${page}: ${message}`);

function htmlFiles(directory = distRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
  });
}

function assetBytes(directory = join(distRoot, 'assets')) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? assetBytes(path) : statSync(path).size;
  }
  return total;
}

const text = (value) => value.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const pages = htmlFiles();
if (!pages.length) throw new Error('no built pages found — run `npm run build` first');

const titles = new Map();
const descriptions = new Map();
const builtRoutes = new Set(
  pages.map((file) => {
    const relativePath = relative(distRoot, file).replaceAll('\\', '/');
    return posix.join(BASE, relativePath.replace(/index\.html$/, '').replace(/\.html$/, ''));
  }),
);

for (const file of pages) {
  const page = relative(distRoot, file).replaceAll('\\', '/');
  const html = readFileSync(file, 'utf8');
  const is404 = page === '404.html';
  // Frozen snapshots are immutable (R-211) — their prose can never be fixed,
  // so content-shape checks apply to `latest` only. Structural checks (base
  // path, language, metadata, links) still apply everywhere.
  const isSnapshot = /^v\d+\.\d+\//.test(page);

  // ── weight ───────────────────────────────────────────────────────────────
  const kilobytes = Buffer.byteLength(html) / 1024;
  if (kilobytes > BUDGETS.htmlKilobytes) fail(page, `HTML is ${kilobytes.toFixed(0)} kB (budget ${BUDGETS.htmlKilobytes} kB)`);

  // ── language ─────────────────────────────────────────────────────────────
  if (!/<html[^>]+lang="[a-zA-Z-]+"/.test(html)) fail(page, 'missing <html lang="…">');

  // ── metadata ─────────────────────────────────────────────────────────────
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? '';
  if (!title) fail(page, 'empty <title>');
  else if (titles.has(title) && !is404) fail(page, `duplicate <title> "${title}" (also ${titles.get(title)})`);
  else titles.set(title, page);

  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim() ?? '';
  if (!description && !is404) fail(page, 'missing meta description');
  else if (description && descriptions.has(description) && !is404) fail(page, `duplicate meta description (also ${descriptions.get(description)})`);
  else if (description) descriptions.set(description, page);

  // ── base path ────────────────────────────────────────────────────────────
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const target = match[1];
    if (!target.startsWith(BASE)) fail(page, `absolute reference "${target}" does not use the ${BASE} base path`);
  }

  // ── headings ─────────────────────────────────────────────────────────────
  const headings = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({ level: Number(match[1]), label: text(match[2]) }));
  const h1 = headings.filter((heading) => heading.level === 1);
  if (h1.length !== 1 && !is404) fail(page, `expected exactly one <h1>, found ${h1.length}`);
  let previous = 1;
  for (const heading of headings) {
    if (heading.level > previous + 1 && !isSnapshot) {
      fail(page, `heading level jumps from h${previous} to h${heading.level} ("${heading.label.slice(0, 48)}")`);
    }
    previous = heading.level;
  }

  // ── images ───────────────────────────────────────────────────────────────
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(match[0])) fail(page, `<img> without alt text: ${match[0].slice(0, 72)}`);
  }

  // ── links ────────────────────────────────────────────────────────────────
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, href, inner] = match;
    const label = text(inner).toLowerCase();
    if (/https?:\/\/[^"]*https?:\/\//i.test(href)) fail(page, `malformed external link contains multiple protocols: ${href}`);
    if (label && VAGUE_LINK_TEXT.includes(label)) fail(page, `uninformative link text "${label}" → ${href}`);
    if (!href.startsWith(BASE) || href.startsWith('//')) continue;
    const route = posix.normalize(href.split('#')[0].split('?')[0]).replace(/\/$/, '') || BASE;
    const candidates = [route, `${route}/`, posix.join(route, '')];
    if (!candidates.some((candidate) => builtRoutes.has(candidate) || builtRoutes.has(`${candidate}/`))) {
      if (/\.(?:png|jpe?g|svg|webp|ico|json|txt|xml|css|js)$/.test(route)) continue;
      fail(page, `internal link "${href}" has no built page`);
    }
  }

  // ── leftovers ────────────────────────────────────────────────────────────
  // `undefined` is a legitimate *value* in option tables and code samples, so
  // strip code before looking for accidentally rendered placeholders.
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<code[\s\S]*?<\/code>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '');
  if (/\]\([^)]*\.md[)#]/.test(body)) fail(page, 'unrendered Markdown link to a .md file');
  if (/>\s*undefined\s*</.test(body)) fail(page, 'renders the literal string "undefined"');
}

const megabytes = assetBytes() / (1024 * 1024);
if (megabytes > BUDGETS.assetMegabytes) failures.push(`assets: ${megabytes.toFixed(2)} MB exceeds the ${BUDGETS.assetMegabytes} MB budget`);

const home = readFileSync(join(distRoot, 'index.html'), 'utf8');
for (const tag of ['og:title', 'og:description', 'og:url', 'theme-color']) {
  if (!home.includes(tag)) failures.push(`index.html: missing "${tag}" meta tag`);
}

if (failures.length) {
  console.error(`✖ quality audit failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):\n`);
  for (const failure of failures) console.error(`  • ${failure}`);
  process.exit(1);
}

console.log(`✓ quality audit passed — ${pages.length} pages, ${megabytes.toFixed(2)} MB of assets, budgets respected`);
