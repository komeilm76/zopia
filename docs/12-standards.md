# 📏 Engineering Standards

How zopia is written, committed, and released. These standards apply to
**source, tests, and documentation equally** — "pure, safe, clean, with
descriptions" (T-16) is the headline; everything below makes that checkable.

## 🟣 Toolchain

| 🧩 Piece | 📏 Standard | 🆔 |
| --- | --- | --- |
| Runtime & toolchain | **Bun ≥ 1.1** — install, run, test, CLI (D-01) | T-14 |
| Language | **TypeScript 5.9+**, `strict: true`, ESM-only (`"type": "module"`), target ES2022 | — |
| Test runner | **Vitest** (D-02) — `bun run test` | T-13 |
| Package manager lockfile | `bun.lock` | — |
| Node compatibility | generated code must also run on Node ≥ 18 (no Bun-only APIs in generated output) | — |

> 📌 Generated `index.ts` files use **no** Bun-only or Node-only APIs — only
> `zod`, `km-api`, and relative imports (R-502), so the tree runs anywhere.

## 📏 Code standard

| # | Rule |
| --- | --- |
| R-1001 | 🧼 **Pure by default** — public engine functions are pure (P-3); side effects (fs/process) live in the wrappers & CLI only (R-405) |
| R-1002 | 🚫 **No `any` leakage** — boundaries use `unknown` + narrowing; internal `any` is forbidden (lint-enforced) |
| R-1003 | 📦 **Named exports only** — no default exports anywhere in `src/` (generated files may have defaults: that's their contract, R-732) |
| R-1004 | 🧩 **One concern per module** — a file > ~300 lines gets split; `index.ts` re-exports only |
| R-1005 | 🧵 **No recursion for graphs** — iterative algorithms for ref walking/cycles (Architecture) |
| R-1006 | 🎯 **Determinism (P-1)** — canonical order everywhere (R-401); no `Date.now()`, `Math.random()`, or environment reads in the pure core |
| R-1007 | 🛡️ **Safe I/O** — every write passes the outDir guard (R-406); no shell-out, no `eval`, no `new Function` |

## 📖 JSDoc standard (T-12)

**Every exported symbol** — function, class, interface, type alias, and
constant — carries JSDoc. The template:

```ts
/**
 * 📝 One-line summary — what it does, in the active voice.
 *
 * 📝 Optional longer description: contracts, invariants, edge cases.
 * Links to the governing rule, e.g. "See R-641 for the media-type policy."
 *
 * @param input  📝 What it accepts (units/range when relevant).
 * @param options 📝 Behaviour knobs; each field documented inline.
 * @returns 📝 What it produces.
 * @throws {ZopiaError} 🆔 `ZOPIA_…` — when.
 * @example
 * ```ts
 * const r = await openApiToApiDocs('swagger.json', { mode: 'flat' });
 * ```
 * @see [docs/06-conversions.md → Engine ③](./06-conversions.md)
 */
export function openApiToApiDocs(
  input: string | Record<string, unknown>,
  options?: ZopiaGenerateOptions,
): Promise<ZopiaGenerateResult> { /* … */ }
```

| # | Rule |
| --- | --- |
| R-131 | every `@param`, `@returns`, `@throws` is **specific** — no "the options", always *which* option and *what it does* |
| R-132 | `@default` on every optional config field |
| R-133 | `@example` is **runnable** code (tests may extract and execute them — contract suite) |
| R-134 | internal (non-exported) helpers get a one-line comment when the *why* is non-obvious |
| R-135 | the docs link in `@see` must resolve (checked in CI) |

## 🛑 Errors

| # | Rule |
| --- | --- |
| R-141 | one base class `ZopiaError` (`code`, `at?`, `hint?`) — full table in [Architecture → Error model](04-architecture.md#-error-model) |
| R-142 | codes are stable strings, UPPER_SNAKE, prefixed `ZOPIA_`; adding a code is a **MINOR** change |
| R-143 | `hint` is always an *action* ("enable `insertComponents` first"), never a lecture |
| R-144 | warnings (not errors) for lossy-but-recoverable conversions (D-12) — shape: `{ code, at?, message }` |

## 🛡️ Safety

| # | Rule |
| --- | --- |
| R-151 | **outDir guard** (R-406) — canonicalize + prefix-check every path; unit-tested with traversal attempts |
| R-152 | **Trusted-input contract (D-08)** — engine ④ imports generated `.ts`; the manifest is the trust marker. Documented loudly in [Usage](10-usage.md) and in the CLI help |
| R-153 | **No secret handling** — zopia reads specs and writes docs; it never touches credentials, never sends data anywhere (no network at all) |
| R-154 | **Predictable failure** — partial generation on error leaves a *consistent* tree: files are written to a temp dir and moved into place atomically at the end |

## 🏷️ Naming

| 🧩 Thing | 📏 Convention |
| --- | --- |
| Files | `kebab-case.ts` (`zod-to-json-schema/`) |
| Modules/dirs | `kebab-case`, plural for collections (`render/`, `fixtures/`) |
| Functions | `camelCase`, verb-first (`zodToJsonSchema`, `detectVersion`) |
| Types/interfaces | `PascalCase` (`ZopiaGenerateOptions`, `ApiModel`) |
| Constants | `UPPER_SNAKE_CASE` (`DEFAULT_MODE`) |
| Tests | colocated `*.test.ts`; describe blocks mirror module names; `it()` cites rules (R-122) |
| Generated identifiers | fixed by [API docs → Naming](07-api-docs.md#-naming-conventions-fixed) |

## 📜 Commit convention

[Conventional Commits](https://www.conventionalcommits.org/), no Co-Authored noise:

```text
<type>(<scope>): <imperative summary ≤ 72 chars>

[optional body — WHY, not WHAT]
```

| 🏷️ Type | 📝 Use for |
| --- | --- |
| `feat` | new engine behaviour, option, CLI flag |
| `fix` | bug fixes (mapping corrections count as fixes — they are *spec* corrections) |
| `docs` | documentation-only changes |
| `test` | tests without behaviour change (e.g. new golden fixtures) |
| `refactor` | internal restructuring, zero behaviour change |
| `chore` / `ci` / `build` | tooling, workflows, packaging |

> 📌 **Rule R-161** — *a commit that changes behaviour is not merged without
> its `CHANGELOG.md` entry* (below) and its doc update (if it changes a
> documented contract) — one commit, one story.

## 📜 Changelog convention

> 🎯 **T-17** — *changelog after commits.*

| # | Rule |
| --- | --- |
| R-171 | every user-visible commit appends a bullet under `## [Unreleased]` in `CHANGELOG.md` — same commit (R-161) |
| R-172 | entries are **user-phrased** ("reverse conversion now restores `servers`"), not internal ("fixed serializer.ts:42") |
| R-173 | on release: `[Unreleased]` → `[x.y.z] - YYYY-MM-DD`; a fresh empty `[Unreleased]` is created |
| R-174 | sections per [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): Added / Changed / Deprecated / Removed / Fixed / Security — with the project's emoji markers (✨ 🔄 ⚠️ 🗑️ 🐛 🛡️ 📝 🔑 🚧) |

## 📖 Docs convention

| # | Rule |
| --- | --- |
| R-181 | **docs ship with code** — a behaviour change and its doc change land in the same commit (R-161) |
| R-182 | **Style** — emoji section headers, tables for anything list-like, code blocks with language tags, one idea per paragraph |
| R-183 | **Numbering** — targets `T-…`, rules `R-…`, decisions `D-…`, warnings/errors `ZOPIA_…` — referenced from code & tests |
| R-184 | **Cross-links** — every doc links forward & back; the map in [`docs/README.md`](README.md) stays current |
| R-185 | **Diagrams** — Mermaid for flow, ASCII trees for file layouts (both render on GitHub) |
| R-186 | **Status honesty** — "planned/contract" is labeled 🚧 until implemented; never documented as done |

## 🚢 Release flow

```text
1. 🔖 bump version (SemVer — [Roadmap → Versioning](03-roadmap.md#-versioning))
2. 📜 CHANGELOG: [Unreleased] → [x.y.z] - YYYY-MM-DD
3. 🏷️ git tag  v0.1.0
4. 📦 npm publish  (package.json: name "zopia", peerDeps zod ^4 + km-api ^0.4 —
   at publish time the local submodule has already been replaced by the
   published km-api 0.4.0, D-15)
5. 📝 README status banner updated to the new phase
```

## 📦 Dependencies

| 📦 Dep | 🏷️ Kind | 📝 Rule |
| --- | --- | --- |
| `zod` `^4` | peer + dev | generated code needs it; tests need it |
| `km-api` `^0.4` (latest) | peer + dev | generated code imports it; tests execute it — its type surface (method/status codes/content types/operationId) is part of zopia's output contract (D-14). **Resolution:** local git submodule `km-api/` (branch `feat/open-unions-v0-4-0`) during development → published `0.4.0` from npm after the final step (D-15) |
| *(nothing else at runtime)* | — | **zero runtime dependencies** in Phase 1 (D-11); every new runtime dep needs a D-… decision |

## 🔑 Key decisions

> Every non-obvious choice is recorded here — ID, decision, rationale.
> Changing one is a **MINOR** change that also updates the affected docs.

| 🆔 | Decision | Rationale |
| --- | --- | --- |
| **D-01** | 🟣 Bun is the primary runtime/toolchain (Node ≥ 18 stays compatible for *generated* code) | project standard; speed; native TS execution — required by the "bun must run the project" target (T-14) |
| **D-02** | 🧪 Vitest is the test runner (not `bun:test`) | requested standard; mature snapshot/coverage ecosystem |
| **D-03** | ① builds on Zod v4's built-in `z.toJSONSchema()` | the third-party `zod-to-json-schema` is deprecated (Nov 2025); Zod v4 is self-sufficient; fewer deps (D-11) |
| **D-04** | ② is a custom emitter (Zod's experimental `z.fromJSONSchema()` is test-only) | we control the *style* of emitted code (the product surface); experimental APIs don't sit on an output path; `z.fromJSONSchema` still cross-checks us in S-49 |
| **D-05** | 🛣️ generated `pathShape` uses OpenAPI `{param}` syntax | km-api's dual syntax makes it lossless both ways; matches the spec |
| **D-06** | 📦 every generated tree carries `.zopia-manifest.json` (written by default — the `manifest` option, on unless explicitly disabled; no timestamps) | flat names can collide; component schemas, `$ref` placement (`refs`) and non-representable keywords (`overlay`) have no home in Zod code; the manifest is what makes reverse conversion lossless and deterministic |
| **D-07** | 📂 default layout is `directory` | mirrors the spec's path structure — the most intuitive mapping of "route = directory path" |
| **D-08** | ④ imports generated `.ts` at runtime (Bun) | the files *are* the source of truth (developers may extend them); importing is the only way to read edited schemas; trust is bounded by the manifest (R-152) |
| **D-09** | 📤 reverse output defaults to OpenAPI **3.1** | 3.1 schemas = full JSON Schema 2020-12 (the "same standard" the project is built on); 3.0 remains one flag away |
| **D-10** | 🔐 MIT license | consistency with the whole `km-*` ecosystem |
| **D-11** | 📦 zero runtime dependencies (Phase 1) | `zod` + `km-api` are peers of the *generated* code; a small surface = small attack area (P-6) |
| **D-12** | ⚠️ unsupported keywords never fail silently — warning + nearest approximation + `// @zopia:warn` marker + manifest record | "pure, safe, clean" means *visible* loss; the reverse conversion restores the original verbatim from the manifest |
| **D-13** | 📝 Phase 1 input is JSON only (YAML, external refs, server variables → Phase 2) | keeps the v0.1.0 contract tight; every deferral is listed in [Roadmap](03-roadmap.md) with a date-like horizon |
| **D-14** | 📐 zopia **targets km-api ≥ 0.4.0** — the output contract is "the generated tree **typechecks** against km-api 0.4.x" (enforced by the golden-tree test, R-126). km-api 0.4.0's open type surface (8 methods incl. `trace`, any custom/`default` status code, any MIME type, `operationId`) means every practical API fact is emitted **as code**; the remaining km-api gaps (per-parameter metadata, response `headers`) are preserved in the manifest (overlay / `responseOverlay`, R-635/R-754) | `makeApiConfig` is a type-level factory (no runtime validation) — the typecheck *is* the contract. km-api 0.4.0 was designed with zopia in mind (komeilm76/km-api); re-verify km-api's type surface against its source on every km-api bump |
| **D-15** | 🔗 **km-api is vendored as a git submodule during development** — `km-api/` (branch `feat/open-unions-v0-4-0`) holds the complete, tested 0.4.0 change set, committed in the clone's own `.git`. Until zopia is finished, it is **never pushed and never published**; the final release step is: push the branch to `komeilm76/km-api` → publish `km-api@0.4.0` → `git submodule deinit` + remove the folder → `km-api: ^0.4.0` from the registry → full suite green ([Roadmap → DoD 7](03-roadmap.md#-definition-of-done--phase-1)) | keeps both repos clean while the two packages co-develop; zopia never depends on an unpublished npm version; the swap at the end is a one-line dependency change because the dev surface equals the published one. **Maintenance of the clone:** (1) every change is committed in the clone's own `.git` (its history is the push payload); (2) every touched file's markdown is updated in the same commit (`CHANGES.md`, `README.md`, `rules.md` where relevant); (3) the clone's standards are kept — tests green, `tsc` clean, prettier on touched files, MIT, no API removals (purely additive until 0.4.0 ships) |

## 🔗 Back to

- 🏠 [README](../README.md) · 📖 [Docs home](README.md)
