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
| Hosting | **GitHub Pages**, project site, built by GitHub Actions | Same approach already proven in `komeilm76/km-geoboard`. |

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

> ⚠️ `base: '/zopia/'` is mandatory for a project Pages site. Getting it wrong
> produces a page that loads HTML but no CSS/JS — the classic "broken Pages"
> symptom.

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
| R-212 | Snapshots are stored in `website/versions/<major.minor>/` and committed, so the site is rebuildable from a clean clone without Git archaeology. |
| R-213 | Releasing a new minor adds its predecessor as a snapshot and **prunes** the oldest, keeping exactly three browsable versions. |
| R-214 | Every non-latest page shows a banner: *"You are reading the documentation for v0.5. The latest version is v0.7."* with a link to the same page in `latest`. |
| R-215 | The version switcher is generated from the directory listing, never hand-maintained. |

Patch releases do **not** create snapshots — they update `latest` in place.

## 🔄 Content pipeline

```text
docs/user/**.md
   │  bun run docs:sync          (website/scripts/sync-content.ts)
   ▼
website/guide/**, website/reference/**     ← generated, git-ignored
   │  vitepress build
   ▼
website/.vitepress/dist
   │  actions/upload-pages-artifact → actions/deploy-pages
   ▼
https://komeilm76.github.io/zopia/
```

| # | Rule |
| --- | --- |
| R-216 | The sync script is the **only** thing that writes into the website's content directories. Prose is never hand-edited inside `website/`. |
| R-217 | Sync rewrites relative Markdown links (`cli.md` → `/zopia/guide/cli`) and injects VitePress frontmatter (title, description, outline). |
| R-218 | Sync fails loudly on an unmapped file: adding a page to `docs/user/` without adding it to the route map is a build error, not a silent omission. |
| R-219 | `CHANGELOG.md` is rendered into `/changelog` by the same script. |

## 🚀 Release flow integration

```text
version bump → release gate → GitHub Release → publish.yml → npm
                                            └→ docs.yml   → snapshot + build + deploy
```

| # | Rule |
| --- | --- |
| R-221 | A push to `main` touching `docs/user/**`, `website/**`, `README.md`, or `CHANGELOG.md` rebuilds and redeploys `latest`. |
| R-222 | A published GitHub Release additionally runs the snapshot step (R-211/R-213) and commits the result before building. |
| R-223 | The docs workflow is **separate** from `publish.yml`: a website failure must never block or roll back an npm publish, and vice versa. |
| R-224 | The release checklist in [Standards → Release flow](12-standards.md#-release-flow) gains one item: *the website shows the new version and its documentation*. |

`.github/workflows/docs.yml` (shape):

```yaml
on:
  push: { branches: [main], paths: ['docs/user/**', 'website/**', 'README.md', 'CHANGELOG.md', '.github/workflows/docs.yml'] }
  release: { types: [published] }
  workflow_dispatch:
permissions: { contents: write, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
```

## 🧪 Quality gates

| 🚦 Gate | 🔍 What it checks |
| --- | --- |
| `docs:sync` | every `docs/user/` page is mapped; no orphan routes |
| `vitepress build` | dead internal links fail the build |
| Markdown contract test | user/development split rules (R-201…R-209) |
| Example check | code fences tagged `ts`/`bash` parse; `ts` samples typecheck against the package |
| Link check | external links resolve (scheduled, non-blocking) |
| Lighthouse CI | the [quality floor](#-quality-floor) thresholds (non-blocking at first, blocking once green) |

## 📅 Milestones

| # | 🎯 Milestone | 📦 Deliverable |
| --- | --- | --- |
| M1 | **Split** ✅ | `docs/user/` + `docs/development/`, maps updated, package allowlist updated |
| M2 | **Coverage audit** | every symbol/flag/code documented per R-207; examples validated per R-208 |
| M3 | **Site skeleton** | `website/` VitePress project, sync script, local `docs:dev` works |
| M4 | **Design pass** | landing page, brand layer, tabs/callouts, dark mode, responsive; quality floor met |
| M5 | **CI deploy** | `docs.yml`, Pages enabled, `latest` live at the public URL |
| M6 | **Versioning** | snapshot tooling, version switcher, outdated-version banner |
| M7 | **Release integration** | release flow updated, checklist item added, dry-run on a patch release |

## ⚠️ Risks & decisions needed

| ⚠️ Risk | 📝 Mitigation |
| --- | --- |
| **Private repository + GitHub Pages** — Pages for a private repository requires GitHub Pro/Team/Enterprise. If `komeilm76/zopia` becomes private on a Free plan, the site stops being publishable from this repository. | Decide before flipping visibility: (a) upgrade the plan, or (b) keep a **separate public repository** that receives the built `dist` (the workflow pushes the artifact), or (c) publish the user site from the existing public `komeilm76.github.io` repository under `/zopia/`. Option (b) also keeps the source private while the docs stay public. |
| Content drift between the package and the site | One source directory (R-206) and the same-commit docs rule |
| Snapshot bloat | Only three versions are kept (R-213) |
| Base-path mistakes breaking assets | `base: '/zopia/'` asserted in a test, plus a smoke check of the deployed HTML |
| Build time growth as versions accumulate | Snapshots are prebuilt Markdown, not rebuilt packages |

## 🔗 Next

- ✂️ [Documentation split plan](13-documentation-split.md) — what the site publishes
- 🗺️ [Roadmap → Phase 4](03-roadmap.md) — where this sits in the release plan
- 📏 [Standards → Release flow](12-standards.md#-release-flow) — the checklist this extends
