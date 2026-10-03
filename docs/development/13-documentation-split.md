# ✂️ Documentation split plan

Phase 4 splits the documentation set into **two audiences** with two different
distribution channels. This document is the contract: it defines the boundary,
the rules each side obeys, where a new page belongs, and how the split is
enforced.

> 🗺️ The website that publishes the user side is specified in
> [Website plan](14-website.md).

## 🎯 Why

Until v0.6.0 one `docs/` directory served three readers at once: the user who
installs `zopia`, the maintainer who extends it, and the agent that updates and
releases it. The result is a set where a user has to skip phase numbers,
roadmap items, scenario IDs, and coverage gates to find the flag they need — and
where development notes leak into the npm tarball.

| 💸 Problem | 🛠️ What the split does |
| --- | --- |
| Users read internal planning material | User docs never mention phases, roadmap, S-IDs, or coverage |
| Users cannot find "how do I do X" | A task-shaped user set: install → quick start → CLI → API → reference |
| Development docs are optimized for people who already know the codebase | They stay that way, and stop pretending to be a tutorial |
| The npm tarball and the website need different inputs | Both now read exactly one directory: `docs/user/` |

## 🧱 The boundary

| 📂 `docs/user/` — user documentation | 📂 `docs/development/` — development documentation |
| --- | --- |
| Audience: **people who install zopia** | Audience: **maintainers, contributors, release agents** |
| Question answered: *"how do I use this?"* | Question answered: *"how does this work and what ships next?"* |
| Ships: npm package **and** the website | Ships: the Git repository only |
| Versioned: one snapshot per published minor on the website | Versioned: `main` only — history lives in Git |
| Stability: a page URL is a public contract | Stability: free to restructure at any time |

### 📘 `docs/user/` — the set

| 📄 File | Purpose |
| --- | --- |
| `index.md` | entry point and map |
| `installation.md` | requirements, peers, package managers, TypeScript setup |
| `quick-start.md` | the five-minute path, CLI and programmatic |
| `cli.md` | every command, flag, value, default, effect, exit code |
| `programmatic-api.md` | every exported function, parameters and result shapes |
| `configuration.md` | `zopia.config.ts`, every option, default, validation rule |
| `conversions.md` | the exact mapping rules of engines ①–④ |
| `api-docs-format.md` | layouts, the `index.ts` contract, the manifest, regeneration |
| `components.md` | `$ref` handling and the two component options |
| `runtime.md` | `zopia/runtime` — `createApiDocs()` / `flattenApiDocs()` |
| `errors-and-warnings.md` | every stable code, its cause and its fix |
| `concepts.md` | glossary |

### 🛠️ `docs/development/` — the set

| 📄 File | Purpose |
| --- | --- |
| `01-overview.md` | what zopia is, the problem, principles, non-goals |
| `02-targets.md` | the explicit, testable targets |
| `03-roadmap.md` | phases, milestones, definition of done |
| `04-architecture.md` | modules, pipeline, internal model, error model, safety |
| `11-testing.md` | scenario matrix, fixtures, coverage gates |
| `12-standards.md` | code, JSDoc, commits, changelog, releases, key decisions |
| `13-documentation-split.md` | this document |
| `14-website.md` | the documentation website |

> 🔢 The numbers 05–10 are intentionally retired: those documents became the
> user set. Keeping the old numbers free avoids resurrecting broken references.

## 📏 Rules

| # | Rule |
| --- | --- |
| R-201 | **One audience per file.** Every Markdown file lives in exactly one of `docs/user/` or `docs/development/`. No file serves both. |
| R-202 | **No upward leakage.** A `docs/user/` page never references a phase number, roadmap item, scenario ID (`S-…`), coverage gate, or internal file path under `src/` or `tests/`. Rule IDs (`R-…`) may appear only where they name a user-visible contract (CLI parsing, option validation). |
| R-203 | **No downward duplication.** A `docs/development/` page never re-explains user-facing usage; it links to the user page instead. |
| R-204 | **Links stay relative and resolvable.** User pages link to user pages with bare relative paths (`cli.md`) so the same Markdown renders correctly on GitHub, in the npm tarball, and on the website. A user page must never link into `../development/`. |
| R-205 | **Development pages may link into `../user/`** — that direction is allowed and expected. |
| R-206 | **`docs/user/` is the single source of truth** for both the npm tarball and the website. Website-only content (landing page, version switcher, search config) lives in `website/`, never duplicated prose. |
| R-207 | **Feature coverage.** Every exported symbol, CLI command, CLI flag, config key, error code, and warning code is documented in `docs/user/` with its type, default, and effect. New public surface is not "done" until its user page is updated in the same commit. |
| R-208 | **Standard, valid examples.** Every example is complete enough to run: real imports, real option values, no `…` placeholders in executable positions. Code fences always declare a language. |
| R-209 | **The split is enforced by tests.** The documentation contract suite checks the file sets, the absence of leakage, link resolution, and the packed-archive contents. |

## 🧭 Where does a new page go?

```text
Does the reader need it to *use* the published package?
├── yes → docs/user/
│         └── Is it a task ("how do I…")?   → guide page (installation, quick-start, cli)
│             Is it a lookup ("what is X")? → reference page (configuration, errors, concepts)
└── no  → docs/development/
          └── Is it a decision or convention? → 12-standards.md (a D-/R- entry)
              Is it a plan?                   → 03-roadmap.md or a numbered plan document
```

## 📦 Distribution

| 🎯 Channel | 📂 Input | 🔒 Enforced by |
| --- | --- | --- |
| npm tarball | `docs/user/**` (plus `README`, `CHANGELOG`, `LICENSE`, `bin/`, `src/`) | `package.json#files` allowlist + `scripts/package-check.ts` + the package-release contract test |
| Website | `docs/user/**` | the website build reads the same directory — see [Website plan](14-website.md) |
| Repository | everything | — |

`README.md` carries both maps: user pages via relative links (so the npm page
renders them), development pages via absolute GitHub URLs (so they still work
from the npm page even though the files are not packed).

## 🚚 Migration map (v0.6.0 → Phase 4)

| ⬅️ Was | ➡️ Is |
| --- | --- |
| `docs/01-overview.md` | `docs/development/01-overview.md` |
| `docs/02-targets.md` | `docs/development/02-targets.md` |
| `docs/03-roadmap.md` | `docs/development/03-roadmap.md` |
| `docs/04-architecture.md` | `docs/development/04-architecture.md` |
| `docs/05-concepts.md` | `docs/user/concepts.md` |
| `docs/06-conversions.md` | `docs/user/conversions.md` |
| `docs/07-api-docs.md` | `docs/user/api-docs-format.md` |
| `docs/08-components.md` | `docs/user/components.md` |
| `docs/09-configuration.md` | `docs/user/configuration.md` |
| `docs/10-usage.md` | split into `installation.md`, `quick-start.md`, `cli.md`, `programmatic-api.md`, `runtime.md` |
| *(new)* | `docs/user/index.md`, `docs/user/errors-and-warnings.md` |
| `docs/11-testing.md` | `docs/development/11-testing.md` |
| `docs/12-standards.md` | `docs/development/12-standards.md` |

> ⚠️ **Breaking for deep links.** Anyone who bookmarked `docs/07-api-docs.md`
> on GitHub gets a 404. This is accepted: the website becomes the canonical
> place to link, and the old paths only ever existed on `main`.

## ✅ Definition of done

- [x] Files moved; every internal link resolves
- [x] `docs/user/` covers installation, quick start, CLI, programmatic API, configuration, conversions, output format, components, runtime, errors/warnings, concepts
- [x] `README.md` and `docs/README.md` carry the two-audience map
- [x] `package.json#files` packs `docs/user/**` and nothing else from `docs/`
- [x] `scripts/package-check.ts` and the contract tests assert the new layout
- [ ] R-202 leakage check automated in the documentation contract suite
- [ ] Every public symbol audited against R-207 (tracked in [Roadmap → Phase 4](03-roadmap.md))

## 🔗 Next

- 🌐 [Website plan](14-website.md) — how `docs/user/` reaches users
- 📏 [Standards](12-standards.md) — docs convention and release flow
- 🗺️ [Roadmap](03-roadmap.md) — Phase 4 milestones
