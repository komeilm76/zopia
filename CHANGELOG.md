# 📜 Changelog

All notable changes to **zopia** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 📌 **Convention** — every commit that changes behaviour, the public API, or the
> documentation adds an entry under `Unreleased`. When a release is cut, the
> `Unreleased` section is renamed to the new version with its date.
> See [docs/12-standards.md → Changelog convention](docs/12-standards.md#-changelog-convention).

---

## [Unreleased]

- ⬆️ Updated the km-api dependency and peer dependency to `^0.4.1`; generated deprecated OpenAPI operations now emit `deprecated: 'YES'`.
- 📖 Corrected reverse-conversion documentation to keep `deprecated` separate from `disable`.
- 🔐 Generated endpoint auth metadata now uses km-api's required `'YES' | 'NO'` values.
- 🧪 Endpoint generation now preserves OpenAPI request and response examples in km-api's examples structure, including Swagger 2.0 response examples and local `$ref` targets.
- 📖 Corrected conversion documentation to describe km-api auth as `'YES' | 'NO'` rather than a boolean.
- 🧩 Added initial component-file and sorted component-barrel generation with `insertComponents`.
- 🛡️ Component generation now preserves OpenAPI 3.1 boolean schemas instead of converting them to unconstrained schemas.
- 🧩 Component generation validates names and renders all component contents before writing files, preventing partial output from validation/conversion failures.
- 🧩 `useComponentAsReference` now imports exact endpoint component schema references through the component barrel; component alias files, self-references, and direct object-property references now emit component imports/lazy schemas.
- 📚 Updated component documentation to distinguish implemented exact imports from pending nested/cyclic imports.
- 📦 Component generation results now include the generated `components/index.ts` barrel.

- 🏗️ Added filesystem generation for endpoint `index.ts` files from the validated API-doc plan.
- 🧾 Generated endpoint exports and schema helper names now sanitize non-identifier and reserved names into valid TypeScript names.
- 🏷️ Generated endpoint metadata now preserves normalized tags and explicit security overrides.
- ℹ️ Deprecated operations remain preserved in the validated IR; they are not conflated with km-api's distinct `disable` status.

### ✨ Added
- ⚙️ Started Phase 1 with Zod/JSON Schema conversion, OpenAPI normalization, operation collection, API-doc layout planning, and the optional ergonomic facade.

### 🔄 Changed
- 📚 Updated the roadmap and dependency standards to reflect the published `km-api@0.4.1` npm dependency.
- 🛡️ Added validation for malformed schemas, unsafe paths, references, identifiers, operation IDs, and facade properties.
- 🧬 Added validated OpenAPI operation contract extraction for request/response media types.
- 🔗 Added strict local OpenAPI JSON Pointer reference handling and documentation.
- ✅ Added validation for response status keys, descriptions, request-body content, and chained component references.
- 📤 Added Swagger 2.0 `formData` request-contract extraction and strict field validation.
- 🔗 Local path-item references now support chaining and circular-reference detection.
- 🛡️ JSON Pointer resolution now rejects inherited object properties.
- 📚 Corrected the architecture documentation to reference the implemented local-reference resolvers.
- 🔀 Operation-level parameters now correctly override path-level parameters.

### 🚧 Planned
- 🧩 Continue Phase 1 with component-file generation and component imports.
- 🗂️ Add round-trip fixtures and final release validation.
- 🖥️ Added initial `zopia generate` and `zopia reverse` CLI commands, with generation mode, component-reference, component, manifest, reverse `--out`, and `--help` options; the CLI now uses the project-standard Bun runtime.
- 🔄 Added manifest-driven OpenAPI reconstruction while preserving original operation objects, plus a file-based `manifestFileToOpenApi()` API.
- 📖 Aligned reverse-conversion documentation with the implemented manifest-based API.
- 🔄 Added generated-manifest round-trip regression tests covering operation IDs, explicit security arrays, Swagger `basePath`, Swagger security definitions, and flat generation without a manifest.
- 🛠️ Reverse conversion now validates manifest source kinds and restores Swagger `basePath`, `host`, `schemes`, `consumes`, `produces`, and `securityDefinitions` metadata.
- 📝 Manifests now preserve and restore OpenAPI `info.description`, additional info fields, document extensions, `externalDocs`, `webhooks`, and `jsonSchemaDialect`.
- 📦 Added default `.zopia-manifest.json` generation with source hash, security metadata, component schemas, API file mappings, per-operation `$ref` metadata, operation overlays, and response-header overlays.

- 🔒 Synchronized the lockfile peer dependency range with `km-api: ^0.4.1`.
- 🗂️ Manifest source kinds now normalize versioned OpenAPI values to `openapi-3.0` or `openapi-3.1`.
- 🔐 Manifest source hashes now use canonical key ordering, avoiding false changes when JSON property order differs, and reject circular/unsupported input values explicitly.

## [0.0.1] - 2026-09-24

### ✅ Released
- 📚 Published the Phase 0 documentation and standards baseline.
- 📦 Switched to the published `km-api@^0.4.0` npm dependency.
- 🧭 Established the Phase 1 public API and implementation contract.


### ✨ Added

- 📚 Complete project documentation standard under [`docs/`](docs/) covering:
  overview, targets, roadmap, architecture, concepts, the four conversion
  engines, the api-docs output format, components, configuration, usage,
  testing strategy, and engineering standards.
- 🏠 Project [`README.md`](README.md) with feature overview, quick look, and
  the documentation map.
- 📄 [`CHANGELOG.md`](CHANGELOG.md) using the Keep-a-Changelog format.
- 🔐 [`LICENSE`](LICENSE) (MIT) and [`.gitignore`](.gitignore) for the
  Bun / TypeScript workspace.

### 📝 Decisions

- 🔑 Recorded the first architecture decisions (**D-01 … D-15**) in
  [docs/12-standards.md → Key decisions](docs/12-standards.md#-key-decisions).

### 🔄 Changed
- 📖 Documented the optional ergonomic facade and explicit bracket notation for path parameters.

- 🔗 **km-api is now vendored as a git submodule** (`km-api/`, branch
  `feat/open-unions-v0-4-0`) — the complete 0.4.0 change set (10 src/test
  files + `CHANGES.md` / `README.md` / `rules.md`; **170/170 tests, `tsc`
  clean**) is committed in the clone's own `.git`, kept local and **never
  pushed or published** until the final release step. The earlier handoff
  patch file (`0001-feat-v0.4.0-...patch`) is removed — superseded by the
  submodule. Final step (D-15): push the branch → publish `km-api@0.4.0` →
  remove the submodule → `km-api: ^0.4.0` from npm.
- 🤝 **Aligned with km-api 0.4.0** (`komeilm76/km-api` — the additive
  release now lives in this repository as the `km-api/` git submodule on
  branch `feat/open-unions-v0-4-0`, committed locally and pending the final
  push + publish — see above and D-15):
  `TRACE` method, any custom numeric status code + `default` response key,
  open (any-MIME) content types, and a real `operationId` field.
  Consequences for zopia: all of that is now **emitted as code** —
  `R-642` redefined as the km-api 0.4.0 typecheck contract (D-14); manifest
  keys `skipped` / `requestMediaType` / `responseMediaType` removed;
  `responseOverlay` narrowed to response facts with no km-api home (today:
  response `headers`, R-754); peer dependency → `km-api ^0.4`; test
  scenarios S-26/S-68/S-69 updated to the emission path.

### 🐛 Fixed

- 🎯 Fourth pass — km-api 0.4.0 precision audit (every claim re-checked
  against the submodule source line by line):
  - **security requirements are now part of the contract** — km-api's config
    stores only the `auth` boolean, so the actual requirement lists live in
    the manifest: new `defaultSecurity` (spec-level) and `apis[].security`
    (per-operation, incl. explicit `[]`) fields (R-653/R-656); the missing
    OpenAPI 3.x `security` normalization row added (v2 row corrected);
    scenario S-71 pins a multi-scheme + scopes + `security: []` round-trip
  - `204 → z.void()` reworded — that is **zopia's** marker; km-api's own
    README examples use `z.object({})` for 204 (both typecheck, but the
    docs no longer cite a non-existent km-api convention)
  - method enumeration now uses **km-api's real `IMethod` order**
    (`get, post, put, delete, head, options, patch, trace`) everywhere —
    R-401's canonical file order unified with it (was three different
    orderings across four places)
  - T-7's practical-content list gained `operationId`; stray "latest"
    version references normalized to `0.4.x`
- 🔍 Third documentation review pass (cross-audited against the km-api 0.4.0
  submodule source and live Zod 4.6.5 probes):
  - `z.map()` corrected to **unrepresentable** (R-614) — only `z.record()`
    maps to `additionalProperties` (R-616); `IExamplesMap` is the real
    km-api examples type (not `IEndpointExamples`)
  - stale `km-api ^0.3` references corrected to `0.4.x` (Overview stack
    table, Usage install table); `responseContentType` described with the
    open 0.4.0 union (not the old closed-union guard)
  - fixture examples: `role` gains `.optional()` (it is not in the Admin
    API's `required` list, R-623); the Usage end-to-end tree now shows all
    four operations
  - duplicated blocks removed (Architecture module-tree `ir/`, Roadmap
    Phase 2 bullet); changelog section markers normalized to R-174
  - round-trip property sketch aligned with the public API (`outDir` +
    R-111 temp dirs, no invented `tree.dir`); D-06 / 07 "manifest always
    written" softened to "by default" (the `manifest` option exists —
    Configuration); R-714's disambiguation invariant scoped to the endpoint
    area (component dirs also hold `index.ts`)
  - README project structure and 09's engine-① option pointer corrected
- 🏛️ Deeper review against primary sources (zod.dev, km-api `0.3.3` source,
  OpenAPI specs) — second round:
  - **km-api closed unions are now the documented emission boundary (R-642,
    D-14)** — read from `km-api`'s source: `IMethod` has **no `trace`**
    (TRACE operations are skipped + manifest `skipped[]`);
    `IHttpStatusCode` excludes `419`/`427`/`444`/`499`/`509`/`512+` **and
    `default`** (such responses → manifest `responseOverlay`); content types
    are closed unions (exotic media types → field omitted, actual type kept
    in the manifest)
  - new manifest keys: `skipped`, `apis[].requestMediaType` /
    `responseMediaType`, `apis[].responseOverlay` (R-754)
  - engine ① adopts Zod's native **`io` parameter** (R-615): request schemas
    convert with `io: 'input'` (defaulted fields naturally stay out of
    `required`), responses with `io: 'output'` — replaces the ad-hoc
    `required` normalization
  - R-614 now lists Zod's **official unrepresentable set** (incl.
    `z.void()`, `z.date()`, `z.int64()`, …); 204 → `z.void()` explicitly
    detected *before* engine ① (R-654)
  - R-612/R-633: metadata flows through **`.meta({ title, description,
    examples })`** (verified verbatim in output), not comments
  - `format: 'byte'` → `z.base64()`; unmapped formats generalized to any base
    type; Swagger 2.0 `int32/int64` primitive params pinned (with
    `ZOPIA_WARN_INT64`)
  - non-schema refs (reusable parameters/responses) inlined by the normalizer
    (R-402 scope); malformed or unsupported path-item references are rejected; 3.1
    `webhooks` → warning
  - km-api cheatsheet: source-verified closed-union table, type-level-only
    `makeApiConfig`, `operationId` is not a km-api field
  - new test scenarios S-26/S-52/S-68…S-70 and rule R-126 (golden trees must
    **typecheck** against installed km-api)
- 📐 Document review against the real libraries (Zod **4.6.5**, run locally):
  - engine ① now specifies **R-618** — stripping of Zod's redundant
    built-in `format`+`pattern` pairs and safe-integer sentinel bounds
    (`±(2⁵³−1)`), so output stays spec-clean and round-trips exact
  - engine ②: removed the non-existent `z.string().openFormat()` mapping —
    custom formats become `z.string()` + warning + manifest overlay; `time`
    and `url`/`uri` alias drift handled by overlay (R-627/R-635)
  - `z.set` documented as **unrepresentable** (`{}` + warning), not as
    `uniqueItems`; `z.map`/`z.record` mapped to their native Zod shape
  - engine ④ serializer value normalizations pinned (R-654): sentinel
    bounds, const-literal unions → `enum`, defaulted keys out of `required`
  - manifest redesigned (R-751…R-753): full component schemas **always**
    carried, per-API `refs` pointers restore `$ref` placement, `overlay`
    entries restore non-representable keywords — the reverse trip is now
    lossless in **all** modes, not only with components emitted
  - Swagger 2.0 `examples` (legacy media-type → value shape) normalization
    corrected; v2 nullability claim corrected
  - status banner, module tree, rule numbering, and cross-links audited
    and made consistent

### 🚧 Planned (Phase 1 implementation)

- 🔄 Conversion engines: `zod → JSON Schema`, `JSON Schema → zod`,
  `OpenAPI → api docs`, `api docs → OpenAPI`.
- 📂 `directory` and `flat` api-docs layouts, `.ts` index files built with
  `makeApiConfig()` from `km-api`.
- 🧱 `insertComponents` and `useComponentAsReference` options.
- 🧪 Vitest suite covering the full scenario matrix.
