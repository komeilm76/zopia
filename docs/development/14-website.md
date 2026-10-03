# 🌐 Documentation website plan

The plan for **https://komeilm76.github.io/zopia/** — a Vue-docs-class
documentation site for zopia: beautiful, fast, searchable, versioned, and
updated automatically after every npm release.

> ✂️ Its content comes from `docs/user/` only — see
> [Documentation split plan](13-documentation-split.md).

## 🎯 Targets

| # | 🎯 Target | ✅ Acceptance |
| --- | --- | --- |
| W-1 | **The site exists at a stable public URL** | `https://komeilm76.github.io/zopia/` serves the built site over HTTPS; the repository README and `package.json#homepage` point at it |
| W-2 | **Every feature is documented** | Every exported symbol, CLI command, CLI flag, config key, error code, and warning code has a page section with its type, default, and effect (R-207) |
| W-3 | **Every example is valid and standard** | Examples compile against the published package; the site's code samples are extracted from, or mirrored by, checked-in fixtures |
| W-4 | **Options, arguments, and effects are explicit** | Each option is documented as *name · type · default · effect · failure mode* |
| W-5 | **5/5 UI & UX** | Measured against the [design bar](#-design-bar) below: landing page, navigation, search, responsive layout, dark mode, accessibility, performance |
| W-6 | **Versioned documentation** | The current release plus the previous two minors are browsable; a version switcher is present on every page |
| W-7 | **Automatic updates** | A release published to npm updates the site without manual steps |
| W-8 | **The site is reproducible** | `bun run docs:dev` and `bun run docs:build` work from a clean clone; CI builds the same output |

## 🏗️ Stack decision

| ❓ Choice | ✅ Decision | 📝 Rationale |
| --- | --- | --- |
| Generator | **VitePress** | The engine behind the Vue documentation experience the project is benchmarking against. Markdown-first (our docs already are Markdown), instant dev server, built-in dark mode, local search, accessible default theme, trivial customization through Vue components. |
| Theme | VitePress default theme **+ a custom home page and brand layer** | 95 % of the UX quality for a fraction of the work; customization is where the 5/5 bar is won (hero, feature grid, code showcase, badges). |
| Search | Built-in local search (MiniSearch) | Zero infrastructure, zero keys, works on a static host. Can be swapped for Algolia DocSearch later without content changes. |
| Package manager / runtime | **Bun** (pinned, as the rest of the repo) | One toolchain. |
| Location | `website/` in this repository | The docs and the code version together; one commit changes behaviour, user docs, and the site. |
| Hosting | **GitHub Pages of the public `komeilm76/komeilm76.github.io` repository, under `/zopia/`** (D-26) | `komeilm76/zopia` is becoming private, and Pages on a private repository needs a paid plan. CI builds here and pushes only the built `dist` there, so the source stays private while the docs stay public at the promised URL — and the user site becomes the hub for every `km-*` package. |

### 🔧 Key configuration

```ts
// website/.vitepress/config.ts (shape — not the final file)
export default defineConfig({
  base: '/zopia/',            // project Pages path — required
  title: 'zopia',
  description: 'Type-safe OpenAPI, JSON Schema, and Zod conversion toolkit.',
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: { search: { provider: 'local' }, nav: [/* … */], sidebar: { /* … */ } },
});
```

> ⚠️ `base: '/zopia/'` is mandatory: the site is served from the `/zopia/`
> sub-directory of the user site. Getting it wrong produces a page that loads
> HTML but no CSS/JS — the classic "broken Pages" symptom. The docs workflow
> asserts the built `index.html` references `/zopia/assets/`.

### 🚀 Deployment topology (D-26)

```text
komeilm76/zopia  (private)                 komeilm76/komeilm76.github.io  (public)
├── docs/user/**         ── source ──┐     ├── index.html            ← user site
└── website/             ── build ───┤     ├── zopia/                ← this site
     └── .vitepress/dist ────────────┴──▶  │   └── index.html, assets/…
                                           └── .nojekyll
                                                   │
                                                   ▼
                                     https://komeilm76.github.io/zopia/
```

| # | Rule |
| --- | --- |
| R-231 | The deploy job replaces the **whole** `zopia/` directory of the site repository and touches nothing else in it — other packages published to the same user site are never affected. |
| R-232 | The push credential is a repository secret `PAGES_DEPLOY_TOKEN`: a fine-grained PAT scoped to *Contents: read & write* on `komeilm76/komeilm76.github.io` **only**. It is never printed, and no other workflow uses it. |
| R-233 | `.nojekyll` is kept at the site-repository root so Jekyll never eats VitePress's `_assets`-style paths. |
| R-234 | The site repository stores **built output only**. Documentation sources are never mirrored there; `docs/user/` in this repository stays the single source of truth (R-206). |

## 🗺️ Information architecture

```text
/                         🏠 Landing page (hero, value, features, quick example, CTA)
/guide/
  installation            📦 Installation
  quick-start             ⚡ Quick start
  cli                     ⌨️ CLI reference
  programmatic-api        🧑‍💻 Programmatic API
  configuration           ⚙️ Configuration
  runtime                 🌳 Runtime
/reference/
  conversions             🔄 Conversion rules
  api-docs-format         📂 Generated output format
  components              🧱 Components & $ref
  errors-and-warnings     🧯 Errors & warnings
  concepts                🧩 Glossary
/changelog                📜 Release history (rendered from CHANGELOG.md)
/v0.5/…  /v0.4/…          🔖 Frozen snapshots of previous minors
```

| 🧭 Nav item | Target |
| --- | --- |
| Guide | `/guide/installation` |
| Reference | `/reference/conversions` |
| Changelog | `/changelog` |
| Version switcher | `latest`, `v0.5`, `v0.4`, plus a link to older tags on GitHub |
| GitHub / npm | external icons |

The sidebar is **task-ordered**, not alphabetical: a reader going top to bottom
is taken from "never heard of zopia" to "running it in CI".

## 🎨 Design bar

What "5 out of 5" means, concretely. Each line is a review checklist item.

### 🏠 Landing page

- One-sentence value proposition above the fold, with a `bun add zopia`
  copy-button and two CTAs (**Get started** / **Why zopia?**)
- An animated-free, honest **before/after**: `swagger.json` on the left,
  generated type-safe `index.ts` on the right
- A 6-card feature grid (four engines, dual spec support, round-trip safety,
  CLI, runtime loading, zero runtime dependencies) with icons
- A "works with" strip: TypeScript · Zod v4 · km-api · Bun · Node 20+
- Footer with license, version, repository, npm

### 🧭 Navigation & reading

- Sticky header with search, version switcher, theme toggle, GitHub link
- Sidebar with collapsible groups; the current page is always visible
- Per-page "On this page" outline on wide screens
- Prev/next links on **every** page
- Breadcrumbs implied by the sidebar group label

### 🖋️ Content presentation

- Code blocks with language labels, line highlighting, and a copy button
- **Tabbed install snippets** (bun / npm / pnpm / yarn)
- Option tables rendered as *name · type · default · effect*
- Callouts: `TIP` for shortcuts, `WARNING` for the reverse/config trust model,
  `DANGER` for destructive flags
- Every error and warning code gets a stable anchor so tools can deep-link to
  `/reference/errors-and-warnings#zopia-ref-not-found`

### ♿ Quality floor

| 📏 Metric | 🎯 Bar |
| --- | --- |
| Lighthouse Performance | ≥ 95 |
| Lighthouse Accessibility | 100 |
| Lighthouse Best Practices / SEO | ≥ 95 |
| Contrast | WCAG AA in both themes |
| Keyboard | Full navigation, visible focus rings, search reachable with `/` |
| Mobile | 360 px wide without horizontal scroll |
| Dead links | Zero — the build fails on a broken internal link |

## 🔖 Versioning

**Policy (W-6): `latest` plus the previous two minors.**

| 🔖 Channel | 📍 URL | 📝 Content |
| --- | --- | --- |
| `latest` | `/zopia/` | built from `docs/user/` on `main` |
| previous minor | `/zopia/v0.5/` | frozen snapshot taken at that release |
| minor before that | `/zopia/v0.4/` | frozen snapshot |
| older | — | linked to the GitHub tag; never rebuilt |

| # | Rule |
| --- | --- |
| R-211 | A snapshot is created **at release time**, from the tagged `docs/user/` content, and is never edited afterwards. Fixing a typo in an old version means fixing it in `latest` only. |
| R-212 | Snapshots are stored in `website/versions/<major.minor>/` (frozen `pages/*.md` plus a `meta.json` route table) and committed, so the site is rebuildable from a clean clone without Git archaeology. |
| R-213 | Releasing a new minor adds its predecessor as a snapshot and **prunes** the oldest (`--keep`, default 2), keeping exactly three browsable versions. |
| R-214 | Every non-latest page shows a banner: *"You are reading the documentation for v0.5. The latest version is v0.7."* with a link to the same page in `latest`. |
| R-215 | The version switcher **and** the per-version sidebars are generated from the snapshot directory into `.vitepress/versions.generated.json`, never hand-maintained. |
| R-216b | Releases older than the documentation split keep their original page set (`usage`, `configuration`, `api-docs-format`, `components`, `conversions`, `concepts`); the snapshot tool maps those historic file names onto today's routes so an old version still browses like the current site. |

Patch releases do **not** create snapshots — they update `latest` in place.

## 🔄 Content pipeline

```text
docs/user/**.md  +  CHANGELOG.md
   │  npm run sync              (website/scripts/sync-content.mjs)
   ▼
website/src/guide/**, website/src/reference/**, website/src/changelog.md   ← generated, git-ignored
   │  npm run build             (vitepress build — dead-link gate on)
   ▼
website/.vitepress/dist
   │  docs.yml → push into komeilm76/komeilm76.github.io:/zopia/
   ▼
https://komeilm76.github.io/zopia/
```

| 🧰 Command (in `website/`) | 📝 What it does |
| --- | --- |
| `npm run sync` | regenerates the content tree from `docs/user/`, the snapshots, and `CHANGELOG.md` |
| `npm run dev` | watch-sync + VitePress dev server (hot reload on real source edits) |
| `npm run build` | sync + production build into `.vitepress/dist` (dead links fail) |
| `npm run audit` | static quality audit of the built site |
| `npm run check` | `build` + `audit` — the gate CI runs |
| `npm run snapshot -- <tag>` | freeze a released version into `website/versions/` |
| `npm run preview` | serve the production build locally |

| # | Rule |
| --- | --- |
| R-216 | The sync script is the **only** thing that writes into the website's content directories. Prose is never hand-edited inside `website/`. |
| R-217 | Sync rewrites relative Markdown links (`cli.md` → `/guide/cli`), rewrites changelog links to GitHub, injects VitePress frontmatter (title, description, outline), and strips each page's hand-written trailing "Next" block because VitePress renders prev/next itself. |
| R-218 | Sync fails loudly on an unmapped file: adding a page to `docs/user/` without adding it to the route map is a build error, not a silent omission. |
| R-219 | `CHANGELOG.md` is rendered into `/changelog` by the same script. |

## 🚀 Release flow integration

```text
version bump → release gate → GitHub Release → publish.yml → npm
                                            └→ docs.yml   → snapshot + build + deploy
```

| # | Rule |
| --- | --- |
| R-221 | A push to `main` touching `docs/user/**`, `website/**`, `README.md`, `CHANGELOG.md`, or the workflow itself rebuilds and redeploys `latest` into the public site repository. |
| R-222 | A published GitHub Release additionally runs the snapshot step (R-211/R-213) and commits the result before building. |
| R-223 | The docs workflow is **separate** from `publish.yml`: a website failure must never block or roll back an npm publish, and vice versa. |
| R-224 | The release checklist in [Standards → Release flow](12-standards.md#-release-flow) gains one item: *the website shows the new version and its documentation*. |

`docs/development/docs-workflow.yml.example` → `.github/workflows/docs.yml` (shape):

```yaml
on:
  push: { branches: [main], paths: ['docs/user/**', 'website/**', 'README.md', 'CHANGELOG.md', '.github/workflows/docs.yml'] }
  release: { types: [published] }
  workflow_dispatch:
permissions: { contents: write, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
```

## 🧪 Quality gates

| 🚦 Gate | 🔍 What it checks | 🤖 Where |
| --- | --- | --- |
| `npm run sync` | every `docs/user/` page is mapped; no orphan routes (R-218) | build, CI |
| `vitepress build` | dead internal links **fail the build** | build, CI |
| `npm run audit` | base-path correctness, unique titles/descriptions, `<html lang>`, one `<h1>` and no skipped heading levels, `img` alt text, resolvable internal links, informative link text, no unrendered Markdown, HTML/asset weight budgets | CI |
| `website-contract` test suite | project shape, `/zopia/` base, route coverage, ignored generated paths, deploy workflow, snapshot layout | `bun run test` |
| `documentation-status` test suite | user/development split rules (R-201…R-209), including the R-202/R-204 leakage check | `bun run test` |
| `user-docs-coverage` test suite | R-207: every public export, CLI command/flag, error/warning code, and option key is documented | `bun run test` |
| Example compilation | 🚧 planned — type-check the `ts` samples against the published package | — |
| Lighthouse | the [quality floor](#-quality-floor) thresholds — needs a real browser, so it stays a manual/scheduled check against the deployed site | manual |

> 📌 The audit exists because Lighthouse cannot run on every commit: it needs a
> browser and a server. The audit covers the regressions documentation changes
> actually cause, deterministically and in under a second.

## 📅 Milestones

| # | 🎯 Milestone | 📦 Deliverable |
| --- | --- | --- |
| M1 | **Split** ✅ | `docs/user/` + `docs/development/`, maps updated, package allowlist updated |
| M2 | **Coverage audit** ✅ | every public export, CLI command/flag, error/warning code, and option key documented and **enforced by a contract test**; examples reviewed per R-208 |
| M3 | **Site skeleton** ✅ | `website/` VitePress project (`base: '/zopia/'`), `sync-content.mjs` pipeline, `npm run dev` / `npm run build` green with the dead-link gate on |
| M4 | **Design pass** ✅ | landing page, brand layer, install tabs, dark mode, responsive layout, and the automated quality audit (`npm run audit`) — 27 pages, 2.5 MB of assets, all budgets respected. Lighthouse stays a manual check against the deployed site |
| M5 | **CI deploy** 🚧 | workflow written as `docs/development/docs-workflow.yml.example` (D-26); a maintainer copies it to `.github/workflows/docs.yml`, creates the public site repository, and adds `PAGES_DEPLOY_TOKEN` |
| M6 | **Versioning** ✅ | `snapshot-version.mjs` (immutable snapshots, `--keep` pruning, historic-layout mapping), generated switcher and per-version sidebars, outdated-version banner on every snapshot page. v0.5 and v0.4 are live snapshots cut from their release tags |
| M7 | **Release integration** 🚧 | the workflow snapshots the previous minor on a published release, commits it, rebuilds, audits, and publishes; a real dry-run has to wait for the next release |

## ⚠️ Risks & decisions needed

| ⚠️ Risk | 📝 Mitigation |
| --- | --- |
| ~~**Private repository + GitHub Pages**~~ — **resolved (D-26)**: the site is published from the public `komeilm76/komeilm76.github.io` repository under `/zopia/`, so `komeilm76/zopia` can become private without taking the documentation offline. | Two prerequisites before the switch: the public repository `komeilm76/komeilm76.github.io` must exist with Pages enabled on its default branch, and the secret `PAGES_DEPLOY_TOKEN` must be set in `komeilm76/zopia`. |
| A leaked `PAGES_DEPLOY_TOKEN` could write to the public user site | Fine-grained PAT, single repository, single permission, rotatable; no other workflow consumes it (R-232) |
| A broken docs build silently leaves the old site up | The workflow fails loudly; `latest` only changes on a successful build, which is the safe failure mode (R-223) |
| Content drift between the package and the site | One source directory (R-206) and the same-commit docs rule |
| Snapshot bloat | Only three versions are kept (R-213) |
| Base-path mistakes breaking assets | `base: '/zopia/'` asserted in a test, plus a smoke check of the deployed HTML |
| Build time growth as versions accumulate | Snapshots are prebuilt Markdown, not rebuilt packages |

## 🔗 Next

- 🛠️ [Website setup](15-website-setup.md) — the one-time GitHub steps, click by click
- ✂️ [Documentation split plan](13-documentation-split.md) — what the site publishes
- 🗺️ [Roadmap → Phase 4](03-roadmap.md) — where this sits in the release plan
- 📏 [Standards → Release flow](12-standards.md#-release-flow) — the checklist this extends
