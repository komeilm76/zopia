# 📏 Engineering Standards

How zopia is written, committed, and released. These standards apply to
**source, tests, and documentation equally** — "pure, safe, clean, with
descriptions" (T-16) is the headline; everything below makes that checkable.

## 🟣 Toolchain

| 🧩 Piece | 📏 Standard | 🆔 |
| --- | --- | --- |
| Runtime & toolchain | **Bun ≥ 1.1** — install, run, test, CLI (D-01) | T-14 |
| Language | **TypeScript 5.9+**, `strict: true`, ESM-only (`"type": "module"`), target ES2022 | — |
| Test runner | **Vitest 4.1.11** (exactly pinned; D-02) — `bun run test` | T-13 |
| Package manager lockfiles | authoritative `bun.lock`; npm/Node compatibility `package-lock.json` | — |
| Node compatibility | generated code must also run on Node ≥ 18 (no Bun-only APIs in generated output) | — |

> 📌 Generated `index.ts` files use **no** Bun-only or Node-only APIs — only
> `zod`, `km-api`, and relative imports (R-502), so the tree runs anywhere.

### 🟣 Bun gate

`packageManager` pins the repository's Bun version and the checked-in `bun.lock`
pins every dependency. Run the complete gate with one PowerShell- and shell-valid
command:

```bash
bun run release:check
```

The gate rejects a different runtime/version, performs a frozen Bun install,
runs strict TypeScript, the full Vitest suite, and coverage gates, exercises both
the direct CLI and package binary, then generates and reverses a component-based
tree so Bun itself must import the generated `.ts` modules. It also installs the
exact npm archive in an isolated offline consumer and exercises its package-root
import and CLI. Temporary output is created under `os.tmpdir()` and always
removed. `bun:gate`, `release:check`, and `prepublishOnly` share this one gate
implementation so local, CI, and publish-time validation cannot drift.

`package-lock.json` remains checked in as the npm/Node compatibility resolution;
`bun.lock` is authoritative for the Bun gate and release workflow.

**CI publishing** — `docs/publish-workflow.yml.example` is the ready-made
GitHub Actions workflow: drop it at `.github/workflows/publish.yml` (the
sandbox's GitHub App token cannot push workflow files — adding it once via
the GitHub UI or an owner-shell works), then every GitHub Release publishes
to npm with tag⇄version verification and `npm publish --provenance --access
public` (the `prepublishOnly` hook re-runs the same Bun gate inside CI, so a
publish cannot bypass it). The pipeline reads an `NPM_TOKEN` repository
secret or npm trusted-publishing; credentials never appear in the repository
or in chat.

## 📏 Code standard

| # | Rule |
| --- | --- |
| R-1001 | 🧼 **Pure transforms, explicit adapters** — in-memory schema/operation transforms are pure; documented file reads, generated-tree writes/imports, and process output live at public adapter/CLI boundaries (R-405) |
| R-1002 | 🧭 **Narrow at decisions** — user-facing option/result contracts are concrete; deliberately open JSON/OpenAPI records are narrowed before branching, rendering, or filesystem use |
| R-1003 | 📦 **Named exports only** — no default exports anywhere in `src/` (generated files may have defaults: that's their contract, R-732) |
| R-1004 | 🧩 **One concern per module** — modules are divided by conversion/boundary responsibility; `src/index.ts` remains re-exports only |
| R-1005 | 🧵 **Cycle-aware traversal** — reference chains carry seen sets and schema definition/dependency traversals carry cycle state; cycles terminate as errors or `z.lazy()` according to reference kind (R-402) |
| R-1006 | 🎯 **Determinism (P-1)** — canonical code-unit order everywhere (R-401), never host-locale collation; no `Date.now()`, `Math.random()`, or environment reads in the pure core |
| R-1007 | 🛡️ **Safe I/O** — every generated write passes the outDir guard (R-406); no shell-out, `eval`, or `new Function` in conversion paths |

## 📖 JSDoc standard (T-12)

**Every exported symbol** — function, class, interface, type alias, enum, and
constant — carries JSDoc, including declarations exposed through a named export
list rather than an `export` modifier. The audited public boundary also includes
every exposed member of an exported interface, class, or nested type-literal
shape; public methods, constructors, call/construct signatures, and
function-valued properties are callables. Private and protected implementation
members are excluded. The AST contract suite scans every production module
under `src/`, not only the package-root re-export list. The template:

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
| R-133 | `@example` is **runnable** code; the contract suite extracts each TypeScript block and typechecks it semantically against the real public source API |
| R-134 | internal (non-exported) helpers get a one-line comment when the *why* is non-obvious |
| R-135 | the docs link in `@see` must resolve (checked in CI) |

## 🛑 Errors

| # | Rule |
| --- | --- |
| R-141 | one base class `ZopiaError` (`code`, `at?`, actionable `hint`, preserved `cause?`) at every public/CLI boundary; `ZOPIA_ERROR_CODES` is the immutable runtime catalogue and TypeScript-union source — full table in [Architecture → Error model](04-architecture.md#-error-model) |
| R-142 | codes are stable strings, UPPER_SNAKE, prefixed `ZOPIA_`; adding a code is a **MINOR** change |
| R-143 | `hint` is always an *action* ("enable `insertComponents` first"), never a lecture; translated parser/import/filesystem failures retain the original value in `cause` |
| R-144 | warnings (not errors) for lossy-but-recoverable conversions (D-12) — shape: `{ code: ZopiaWarningCode, at?: string, message: string }`; codes come from the stable `ZOPIA_WARNING_CODES` catalogue, `at` is an escaped JSON Pointer when discoverable, and public emission is sanitized, deduplicated, deterministic, and callback/result consistent |

## 🛡️ Safety

| # | Rule |
| --- | --- |
| R-151 | **outDir guard** (R-406) — canonicalize + prefix-check every path, reject symlinked generated ancestors, exclusively create manifest temporary files, and prune only paths owned by a validated prior manifest; unit-tested with traversal/symlink attempts |
| R-152 | **Trusted-input contract (D-08)** — engine ④ imports generated `.ts`; the manifest is the trust marker. Documented loudly in [Usage](10-usage.md) and in the CLI help |
| R-153 | **No secret handling** — zopia reads specs and writes docs; it never touches credentials, never sends data anywhere (no network at all) |
| R-154 | **Predictable failure** — configuration, source, layout, and component-render validation happen before governed writes; every surfaced write/import failure is typed. Individual manifest replacement is atomic, while the generated tree is updated as ordered guarded file writes rather than as one directory transaction |

## 🏷️ Naming

| 🧩 Thing | 📏 Convention |
| --- | --- |
| Files | `kebab-case.ts` (`zod-to-json-schema.ts`) |
| Modules/dirs | `kebab-case`, plural for collections (`conversions/`, `fixtures/`) |
| Functions | `camelCase`, verb-first (`zodToJsonSchema`, `normalizeOpenApiDocument`) |
| Types/interfaces | `PascalCase` (`GenerateApiDocsOptions`, `OpenApiOperationIR`) |
| Constants | `UPPER_SNAKE_CASE` (`ZOPIA_MANIFEST_SCHEMA`) |
| Tests | centralized under `tests/` as `*.test.ts`; contract and round-trip suites use dedicated subdirectories; `it()` cites rules (R-122) |
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

The contract suite audits every post-release commit that changes `src/`, public
documentation, the package entry points, or package metadata and fails unless
that same commit also changes `CHANGELOG.md`. The static Unreleased check remains
active in shallow/source-only environments where the release boundary is absent.

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
3. 📝 README status banner updated to the new phase
4. 🚢 bun run release:check
5. 🏷️ git tag v0.1.0
6. 📦 npm publish  (package.json: name "zopia", peerDeps zod ^4 + km-api ^0.4 —
   the published `km-api@0.4.1` dependency is installed, D-15)
```

| # | Release-readiness rule |
| --- | --- |
| R-191 | **One release identity** — `package.json`, the manifest writer, lockfile, versioned changelog heading, and README status agree on the SemVer version |
| R-192 | **Minimal verified artifact** — npm receives only `bin/`, `src/`, the practical guides (`docs/07-api-docs.md`, `docs/09-configuration.md`, `docs/10-usage.md`), and the package/legal markdown; the development documentation stays in the repository and is linked from the README via GitHub URLs. The exact archive is installed in isolation and must pass library-import, generate/reverse CLI, and `zopia/runtime` subpath smoke tests |
| R-193 | **Publish guard** — `prepublishOnly` runs the pinned-Bun release gate, including typecheck, all tests, coverage, direct runtime checks, and R-192's packed-consumer check |

Preparing these artifacts does not publish or tag a release. Those external steps
remain explicit maintainer actions after the committed release gate is green.

## 📦 Dependencies

| 📦 Dep | 🏷️ Kind | 📝 Rule |
| --- | --- | --- |
| `zod` `^4` | peer + dev | engines ①/② and generated schemas use it at runtime; tests exercise both paths |
| `km-api` `^0.4.1` (0.4.x) | peer + dev | generated code imports it and engine ④ loads those results — its type surface (method/status codes/content types/operationId) is part of zopia's output contract (D-14). **Resolution:** published npm package `km-api@^0.4.1` (D-15) |
| *(no `dependencies` entries)* | — | **zero direct/bundled runtime dependencies** in v0.1.0 (D-11); runtime capabilities are declared as peers and every new dependency needs a D-… decision |

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
| **D-11** | 📦 zero direct/bundled runtime dependencies in v0.1.0 | `zod` + `km-api` are explicit peers used by conversion/generated-code paths; a small owned dependency surface reduces install and security risk (P-6) |
| **D-12** | ⚠️ unsupported facts never fail silently — every engine emits the shared structured warning; schema emission adds a canonical `// @zopia:warn` marker; restorable source facts also enter the manifest; CLI diagnostics use stderr only | "pure, safe, clean" means *visible* loss without corrupting generated output; reverse conversion restores manifest-recorded facts verbatim where the target dialect permits |
| **D-13** | 📝 v0.1.0 input is JSON only (external `$ref` resolution → Phase 2, same-folder in v0.2.x via D-17; **YAML input lifted in v0.2.x via D-16**); server variables are manifest-preserved but warn because endpoint modules cannot represent them | keeps the v0.1.0 parsing/resolution contract tight while round-tripping document-frame data |
| **D-14** | 📐 zopia **targets km-api ≥ 0.4.1** — the output contract is "the generated tree **typechecks** against installed published km-api 0.4.1" (enforced by the golden-tree test, R-126). Eight methods including `trace`, custom/`default` statuses, arbitrary MIME strings, and `operationId` are emitted as code. Published 0.4.1 enumerates known MIME values, so exact OpenAPI extension strings cross one narrow type-only assertion; non-representable parameter metadata and response `headers` remain in manifest overlays (R-635/R-754) | `makeApiConfig` is a type-level factory with no runtime validation. The dedicated strict golden `tsc` gate verifies its real published declarations; exact runtime MIME values remain reversible. Re-verify the boundary on every km-api bump |
| **D-15** | 📦 **km-api is consumed from npm** — zopia depends on the published `km-api@^0.4.1`; no Git submodule or unpublished commit is required. | reproducible fresh clones and published dependency resolution |
| **D-16** | 📝 **v0.2.x YAML input is parsed by an owned, deterministic YAML 1.2 core-schema parser** (`src/conversions/yaml.ts`) — block/flow collections, plain/single/double-quoted scalars, literal/folded block scalars with chomping/indent indicators, comments, anchors/aliases/`<<` merge keys (explicit keys win), `%YAML 1.x` directives, single `---`/`...` document; keys are stringified like a JSON round-trip; tab indentation, duplicate keys, undefined aliases, custom tags, multi-document streams, complex `?` keys, and non-JSON numbers (`.inf`/`.nan`) fail with `ZOPIA_SPEC_INVALID_YAML` | a dependency (D-11) would import parser state we cannot pin for determinism (P-1); the subset covers real-world `spec.yaml` files fully, and every rejection is a typed, line-located diagnostic instead of silent approximation (P-4) |
| **D-17** | 🔗 **v0.2.x file input resolves same-folder external `$ref`s by bundling them inline before normalization** (`src/conversions/openapi-external-ref.ts`) — `other.(json|yaml|yml)` with `./…` spellings, an optional `#` JSON Pointer ('' = whole file); sibling files are read once (P-1), bundled content is deep-cloned, nested cross-file refs resolve against their owning file, and sibling keys win over bundled content; URLs, `../`, absolute paths, subdirectories, drives, and non-spec extensions keep `ZOPIA_REF_EXTERNAL`; unreadable targets, missing pointers, circular chains, sibling-on-scalar targets, and >512-level expansion fail typed; reverse conversion emits the bundled single file and never re-splits | one predictable grammar keeps resolution deterministic (P-1/P-4) with zero network access or directory walking, while object/text inputs keep their original semantics byte-for-byte |

## 🔗 Back to

- 🏠 [README](../README.md) · 📖 [Docs home](README.md)
