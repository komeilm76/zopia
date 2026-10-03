# 🎯 Targets

These are the **explicit, testable targets** of zopia. Every Phase 1 target maps
to its governing document and automated release-gate coverage — see
[Testing → Scenario matrix](11-testing.md).

> ✅ **Complete** = implemented, documented, and covered by the release gate.
> Deferred work is listed explicitly under [Roadmap → Phase 2](03-roadmap.md#-phase-2--breadth-v02x-).

## 🔄 Conversion targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-1 | **Convert Zod → JSON Schema** | [Conversions → Engine ①](../user/conversions.md) | ✅ |
| T-2 | **Convert JSON Schema → Zod** | [Conversions → Engine ②](../user/conversions.md) | ✅ |
| T-3 | **Convert OpenAPI → api docs** — Swagger 2.0 *and* OpenAPI 3.0/3.1 | [Conversions → Engine ③](../user/conversions.md) | ✅ |
| T-4 | **Convert api docs → OpenAPI** (the reverse direction) | [Conversions → Engine ④](../user/conversions.md) | ✅ |

## 📂 API docs targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-5 | **Layout mode `directory`** — `api_docs/` + path segments as nested directories + a method-named directory at the last level + `index` file | [API docs format → directory mode](../user/api-docs-format.md) | ✅ |
| T-6 | **Layout mode `flat`** — `api_docs/` + one directory per API + method directory + `index` file | [API docs format → flat mode](../user/api-docs-format.md#-mode--flat) | ✅ |
| T-7 | **`index.ts` files are TypeScript** and fill **all practical content** of the endpoint (method, path, operationId, summary, description, tags, auth, content types, request, response, examples) using **`makeApiConfig()` from km-api** (the package's make function) | [API docs format → `index.ts` contract](../user/api-docs-format.md#-the-indexts-contract) | ✅ |
| T-8 | **Option `insertComponents: boolean`** — when `true`, components are written into `api_docs` as their own schema files; **default `false`** | [Components](../user/components.md) · [Configuration](../user/configuration.md) | ✅ |
| T-9 | **Option `useComponentAsReference: boolean`** — endpoints import emitted components recursively; requires `insertComponents: true`; **default `false`** | [Components → option matrix](../user/components.md) | ✅ |

## 🔁 Reverse-conversion targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-10 | **Reversible output** — the generated tree contains everything needed to regenerate the spec (paths, methods, schemas, metadata), guaranteed by the manifest | [API docs format → manifest](../user/api-docs-format.md) | ✅ |
| T-11 | **Round-trip stability** — `openapi → api docs → openapi` and `zod → JSON Schema → zod` converge: re-running the pipeline on its own output is a no-op (idempotent) | [Testing → round-trip tests](11-testing.md#-round-trip-property-tests) | ✅ |

## 🏗️ Engineering targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-12 | **JSDoc everywhere** — every exported function, type, constant, and class is documented (template + rules fixed) | [Standards → JSDoc standard](12-standards.md) | ✅ |
| T-13 | **Tests in all scenarios** — Vitest suite covering the full scenario matrix (spec versions, ref graphs, modes, option combinations, zod features, edge cases), run with Bun | [Testing](11-testing.md) | ✅ |
| T-14 | **Bun runs the project** — install, typecheck, test, coverage, CLI, and generated-TypeScript imports all work through one pinned-Bun gate | [Standards → Bun gate](12-standards.md#-bun-gate) | ✅ |
| T-15 | **Standard documentation** — `docs/` directory with targets, roadmap, architecture, conventions; README links into it; beautiful, icon-based markdown | this document set · [Standards → Docs convention](12-standards.md#-docs-convention) | ✅ |
| T-16 | **Quality bar** — pure, safe, clean code with descriptions; deterministic output; typed errors; no silent lossy conversions | [Standards](12-standards.md) | ✅ |
| T-17 | **Changelog after commits** — `CHANGELOG.md` updated by every user-facing commit under `Unreleased` | [Standards → Changelog convention](12-standards.md#-changelog-convention) | ✅ |

## 📘 Documentation & website targets (Phase 4)

Phase 4 targets are numbered **W-…** and specified in
[Website plan → Targets](14-website.md#-targets); the audience boundary they
depend on is fixed by [Documentation split plan](13-documentation-split.md).

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| W-0 | **Audience split** — `docs/user/` (packed + website source) separated from `docs/development/` (repository-only), with enforced rules R-201…R-209 | [Documentation split](13-documentation-split.md) | ✅ |
| W-1 | **Public documentation site** at <https://komeilm76.github.io/zopia/> — built in `website/`, published into the public user-site repository under `/zopia/` (D-26) | [Website plan](14-website.md) | 🚧 |
| W-2 | **Every feature documented** — symbols, commands, flags, config keys, error/warning codes, enforced by `user-docs-coverage` | [Split → R-207](13-documentation-split.md#-rules) | ✅ |
| W-3 | **Valid, standard examples** everywhere — complete, runnable snippets with real imports and option values (automated compilation of samples is still planned) | [Split → R-208](13-documentation-split.md#-rules) | 🚧 |
| W-4 | **Options documented as name · type · default · effect · failure mode** | [Website plan](14-website.md#-targets) | ✅ |
| W-5 | **5/5 UI & UX** against the published design bar — landing page, brand layer, search, dark mode, responsive layout, and an automated quality audit (Lighthouse verification runs against the deployed site) | [Website plan → Design bar](14-website.md#-design-bar) | 🚧 |
| W-6 | **Versioned documentation** — latest plus the previous two minors, with a generated switcher and outdated-version banners | [Website plan → Versioning](14-website.md#-versioning) | ✅ |
| W-7 | **Automatic updates after every npm release** | [Website plan → Release flow](14-website.md#-release-flow-integration) | 🚧 |
| W-8 | **Reproducible site build** from a clean clone and in CI | [Website plan → Quality gates](14-website.md#-quality-gates) | 🚧 |

## 🗺️ Out of scope for the first phase

> 📌 The reverse-conversion *capability* (T-4/T-10/T-11) **is** in the first
> phase — it is part of the four targets above. What is deferred:

- ~~📝 YAML spec input~~ → shipped in v0.2.x (D-16; `.yaml`/`.yml` files and inline YAML text reach the same normalized model as JSON)
- 🔗 External (multi-file) `$ref`s → [Roadmap Phase 2](03-roadmap.md)
- 🧩 Reusable **parameters / responses** as emitted components (Phase 1 emits `components.schemas` only) → [Roadmap Phase 2](03-roadmap.md)
- ~~🖥️ `zopia validate` (spec linting)~~ → shipped in v0.3.x (S-89; [Roadmap Phase 3](03-roadmap.md)); incremental regeneration remains deferred
