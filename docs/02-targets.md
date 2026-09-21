# 🎯 Targets

These are the **explicit, testable targets** of zopia. Each target maps to at
least one document in this directory and (once implemented) to at least one
Vitest suite — see [Testing → Scenario matrix](11-testing.md).

> ✅ **Spec'd** = fully specified by this documentation set.
> 🚧 **To implement** = built in the Phase 1 implementation pass.
> ✅ **alone** = complete in this phase (Phase 0 — the documentation set itself).

## 🔄 Conversion targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-1 | **Convert Zod → JSON Schema** | [Conversions → Engine ①](06-conversions.md) | ✅ 🚧 |
| T-2 | **Convert JSON Schema → Zod** | [Conversions → Engine ②](06-conversions.md) | ✅ 🚧 |
| T-3 | **Convert OpenAPI → api docs** — Swagger 2.0 *and* OpenAPI 3.0/3.1 | [Conversions → Engine ③](06-conversions.md) | ✅ 🚧 |
| T-4 | **Convert api docs → OpenAPI** (the reverse direction) | [Conversions → Engine ④](06-conversions.md) | ✅ 🚧 |

## 📂 API docs targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-5 | **Layout mode `directory`** — `api_docs/` + path segments as nested directories + a method-named directory at the last level + `index` file | [API docs format → directory mode](07-api-docs.md) | ✅ 🚧 |
| T-6 | **Layout mode `flat`** — `api_docs/` + one directory per API + method directory + `index` file | [API docs format → flat mode](07-api-docs.md#-mode--flat) | ✅ 🚧 |
| T-7 | **`index.ts` files are TypeScript** and fill **all practical content** of the endpoint (method, path, operationId, summary, description, tags, auth, content types, request, response, examples) using **`makeApiConfig()` from km-api** (the package's make function) | [API docs format → `index.ts` contract](07-api-docs.md#-the-indexts-contract) | ✅ 🚧 |
| T-8 | **Option `insertComponents: boolean`** — when `true`, components are written into `api_docs` as their own schema files; **default `false`** | [Components](08-components.md) · [Configuration](09-configuration.md) | ✅ 🚧 |
| T-9 | **Option `useComponentAsReference: boolean`** — available only when `insertComponents` is `true`; when `true`, endpoint files *import* components instead of inlining them; **default `false`** | [Components → option matrix](08-components.md) | ✅ 🚧 |

## 🔁 Reverse-conversion targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-10 | **Reversible output** — the generated tree contains everything needed to regenerate the spec (paths, methods, schemas, metadata), guaranteed by the manifest | [API docs format → manifest](07-api-docs.md) | ✅ 🚧 |
| T-11 | **Round-trip stability** — `openapi → api docs → openapi` and `zod → JSON Schema → zod` converge: re-running the pipeline on its own output is a no-op (idempotent) | [Testing → round-trip tests](11-testing.md#-round-trip-property-tests) | ✅ 🚧 |

## 🏗️ Engineering targets

| # | 🎯 Target | Spec | Status |
| --- | --- | --- | --- |
| T-12 | **JSDoc everywhere** — every exported function, type, constant, and class is documented (template + rules fixed) | [Standards → JSDoc standard](12-standards.md) | ✅ 🚧 |
| T-13 | **Tests in all scenarios** — Vitest suite covering the full scenario matrix (spec versions, ref graphs, modes, option combinations, zod features, edge cases), run with Bun | [Testing](11-testing.md) | ✅ 🚧 |
| T-14 | **Bun runs the project** — install, typecheck, test, coverage, and CLI all work with `bun` | [Standards → Toolchain](12-standards.md#-toolchain) | ✅ 🚧 |
| T-15 | **Standard documentation** — `docs/` directory with targets, roadmap, architecture, conventions; README links into it; beautiful, icon-based markdown | this document set · [Standards → Docs convention](12-standards.md#-docs-convention) | ✅ |
| T-16 | **Quality bar** — pure, safe, clean code with descriptions; deterministic output; typed errors; no silent lossy conversions | [Standards](12-standards.md) | ✅ 🚧 |
| T-17 | **Changelog after commits** — `CHANGELOG.md` updated by every user-facing commit under `Unreleased` | [Standards → Changelog convention](12-standards.md#-changelog-convention) | ✅ |

## 🗺️ Out of scope for the first phase

> 📌 The reverse-conversion *capability* (T-4/T-10/T-11) **is** in the first
> phase — it is part of the four targets above. What is deferred:

- 📝 YAML spec input → [Roadmap Phase 2](03-roadmap.md)
- 🔗 External (multi-file) `$ref`s → [Roadmap Phase 2](03-roadmap.md)
- 🧩 Reusable **parameters / responses** as emitted components (Phase 1 emits `components.schemas` only) → [Roadmap Phase 2](03-roadmap.md)
- 🖥️ `zopia validate` (spec linting) and incremental regeneration → [Roadmap Phase 3](03-roadmap.md)
