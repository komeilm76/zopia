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

### ✨ Added
- ♻️ **Incremental regeneration + merge-safe custom companions (Phase 3, D-24, S-90)** — generation now writes only files whose rendered bytes differ: byte-identical endpoints, components, and the manifest keep their mtimes, so watch mode and bundler caches stop churning on no-op regenerations. The opt-in `custom` layer (generate option `custom: true`, CLI `--custom`, config `generate.custom`) appends `export * as custom from './custom';` to every endpoint and webhook module and scaffolds a sibling `custom.ts` exactly once — an existing file or symlink at that path is never touched, custom files are never manifest-owned (staleness pruning can't delete them), and toggling the option off removes only the export line via the normal skip-aware rewrite. The manifest records `options.custom` only when enabled; toggling it reports the new `ZOPIA_WARN_STALE_TREE` reason `custom-companions-changed`. Non-boolean `custom` values fail with `ZOPIA_CONFIG_INVALID` at every layer.
- 🧹 **`zopia validate` (Phase 3, S-89)** — new CLI command and `validateZopia()` API: specs are checked for dialect validity, broken local `$ref`s (error at the offending pointer), endpoint-planning failures (name collisions, cross-namespace duplicate `operationId`s), and components no operation can reach — transitively, covering OpenAPI `components.schemas` and Swagger `definitions` with stable `ZOPIA_VALIDATE_UNREACHABLE_COMPONENT` warnings. Generated trees are checked for manifest presence/validity, a complete reverse dry-run, and km-api peer drift (`ZOPIA_VALIDATE_KM_API_DRIFT` — outside the declared `^0.4.1` range or unresolvable near the tree; warning-severity, never blocking). Findings return as deterministic sorted diagnostics `{ severity, code, at, message }`; the CLI prints them to stdout with a summary line and exits `1` only when an error-severity finding exists. Also exported: `readOpenApiSourceInput`, `validateOpenApiReferences`, and `assertUniqueOperationIdsAcrossScopes` (shared between generation and validation).
- 🧭 Dialect reverse hardening (round 3): reversing to 3.0 or 2.0 no longer crashes with `ZOPIA_REF_NOT_FOUND` when a path item `$ref`s into a container the target dialect omits (`components.pathItems` or the webhooks section) — the operation expands in place with the existing `ZOPIA_WARN_DIALECT_DOWNGRADE` diagnostic, while references into surviving containers stay verbatim. Generation now also rejects duplicate `operationId`s across the path and webhook namespaces up front (`ZOPIA_SPEC_INVALID`, document-wide uniqueness per the OpenAPI spec); the reverse guard remains for hand-edited trees.
- 🧷 Webhook round-trip hardening: pure `$ref` webhook items reverse to their verbatim source shape (`webhookItemRef` parity with path-item refs — edited generated modules expand the operation as a spec-legal sibling), empty `x-` webhook entries (for example `x-empty: {}`) survive ③→④ through the webhook order list, and malformed webhook items (`null` / scalar / array) raise `ZOPIA_SPEC_INVALID` instead of an untyped crash. Usage and configuration docs now document `zopia generate --watch`.
- 👀 Watch mode: `zopia generate --watch` keeps engine ③ running against the spec file — the initial generation runs identically to non-watch mode (same options, same warnings, same errors), every file change is coalesced (50 ms) and serialized against in-flight runs, a failure prints the typed error on stderr and keeps watching with the previous tree untouched, and in-place regeneration reuses the stale-tree ownership pipeline (one deterministic `ZOPIA_WARN_STALE_TREE` before refresh). The watcher subscribes to the spec's parent directory and filters on the basename, so atomic saves (write-temp + rename) keep regenerating instead of silently ending the watch. Embedding entry points get the same loop through `runGenerateWatch(input, options, output?, signal?)` in `cli-command` with an `AbortSignal` stop hook (S-88).
- 🪝 OpenAPI 3.1 webhook endpoint generation (D-23): `document.webhooks` operations now emit real endpoint files at `webhooks/<name>/<method>/index.ts` through the same planning, collision-avoidance, and component-reference pipeline as path operations. The manifest gains `webhooks[]` records (file/name/method/operationId/sourceOperation/refs/overlay/responseOverlay/security), a `webhookOrder` list preserving the exact source key order, and a `webhooksOverlay` for item-level metadata (`parameters`, `x-` keys, and `x-` or operation-less entries); non-empty `webhooks` maps move out of `documentOverlay` into these records. Reverse conversion imports the generated webhook modules for runtime refresh, restores local path-item `$ref` items inline, enforces global `operationId` uniqueness across path and webhook operations, and reassembles `document.webhooks` in exact source order for 3.1 output — while 3.0/2.0 output omits webhooks with the source-located `ZOPIA_WARN_WEBHOOKS` warning. Webhook maps with no operations keep the earlier manifest-only behavior with a forward `ZOPIA_WARN_WEBHOOKS`. Non-3.1 manifests carrying `webhooks` fail validation deterministically. New public helpers: `planWebhookDocsFiles`, `collectOpenApiWebhookOperations`, and `webhookRuntimePath`.
- 📝 YAML input for engine ③ (D-13 lifts, D-16): `openApiToApiDocs` and the CLI accept `.yaml`/`.yml` spec paths, inline YAML text, and extension-less YAML files through a new owned, deterministic YAML 1.2 core-schema parser (`src/conversions/yaml.ts`). It supports block/flow collections, plain/single/double-quoted scalars, literal/folded block scalars with chomping and indent indicators, comments, anchors/aliases/`<<` merge keys, `%YAML 1.x` directives and single-document `---`/`...` markers, and parses to exactly the values an equivalent JSON document yields.
- 🚨 `ZOPIA_SPEC_INVALID_YAML` (MINOR error-code addition, R-142): every YAML syntax/structure rejection — tab indentation, duplicate keys, undefined aliases, custom tags, multiple documents, complex `?` keys, non-JSON numbers (`.inf`/`.nan`), and more — fails with a line-located typed error; unreadable or malformed `.yaml`/`.yml` files report the YAML code with the file path in `at`.
- 🔗 External `$ref` resolution for spec files (D-17): `openApiToApiDocs` and the CLI bundle same-folder references — `other.yaml`/`other.json`/`other.yml` with optional `#` JSON Pointers, `./` spellings, and whole-file targets — inline before normalization. Nested cross-file references resolve against their owning file, sibling keys next to a `$ref` win over bundled content, every sibling file is read exactly once, and bundled content is deep-cloned, so generated trees, warnings, reverse conversion, and manifest hashes are byte-identical to an equivalent inline spec; reverse conversion emits the bundled single-file document and never re-splits files.
- 🧭 Deterministic external-ref failure matrix (D-17): targets outside the spec folder (URLs, `../`, absolute paths, subdirectories, drive names, non-spec extensions) and any external ref in object/text inputs keep `ZOPIA_REF_EXTERNAL`; unparsable targets fail with `ZOPIA_SPEC_INVALID_JSON`/`ZOPIA_SPEC_INVALID_YAML` at the file path; missing pointers, bad fragments, circular chains, sibling keys on non-object targets, and expansion past the 512-level guard fail with `ZOPIA_REF_NOT_FOUND` at the referencing pointer.
- ♻️ Reusable parameters and responses as component modules (D-18): in components mode, declared reusable parameters (`#/components/parameters/…`, Swagger 2.0 `#/parameters/…`) and responses (`#/components/responses/…`, Swagger 2.0 `#/responses/…`) now generate their own files `components/parameters/<Name>/index.ts` / `components/responses/<Name>/index.ts` exporting `<Name>Parameter` / `<Name>Response` — the module holds the derived schema only (name/location/`required` stay operation data; schema-less responses render `z.void()` at use sites and emit no module). Bare `$ref` use sites import through the new per-kind barrels (`components/parameters/index.ts`, `components/responses/index.ts`, emitted only when that kind has declarations) — including Swagger 2.0 bare body/`formData` parameters and whole-response references — while sibling-merged `$ref`s keep their inline composition. The manifest records `{ name, kind: "parameter"|"response", file, schema, overlay }` entries; reverse conversion refreshes each declaration from the current module (developer edits win) and restores every use-site `$ref` verbatim from manifest placements, and stale-tree detection owns the new barrels. Chained reusable-parameter declarations (`$ref` → `$ref` → concrete) resolve fully with a cycle guard on both conversions.
- 🧾 Project config file (D-19): the CLI discovers `zopia.config.ts` (then `zopia.config.mts`) next to the working directory, or takes an explicit `--config <path>`; the file is validated `{ generate: { mode, insertComponents, useComponentAsReference, manifest, outDir }, reverse: { version, out } }` defaults with per-key `ZOPIA_CONFIG_INVALID` errors, and merges with immutable precedence **CLI flag > config value > built-in default** (`--no-manifest` always wins). `zopia generate` accepts omitting `<output-dir>` when the config supplies `generate.outDir`; the library exposes `loadZopiaConfig` and `defineConfig`.
- 🧪 Native record-object conversion (D-22): engine ② now maps the exact object form `{ "type": "object", "propertyNames": { "type": "string", "pattern"/"minLength"/"maxLength" }, "additionalProperties": <schema> }` (with no other object-structure keywords) onto `z.record(key, value)` — the same form Zod emits, so these schemas convert with zero warnings and zero frozen overlays while key constraints are enforced natively at runtime. Non-native `propertyNames` spellings (implicit/absent `type`, enums, unions, annotations, companions like `properties`/`required`/count bounds, boolean or absent `additionalProperties`, invalid key patterns) keep the D-12 runtime-refinement + frozen-overlay behavior with byte-exact reverse restoration.
- 📤 OpenAPI 2.0 reverse output (D-20): `apiDocsToOpenApi`/`manifestToOpenApi`/`manifestFileToOpenApi` (and the CLI `--version 2.0` / config `reverse.version`) now convert 3.0/3.1-sourced manifests into Swagger 2.0 documents. The downgrade rewrites manifests into the source-dialect Swagger reconstruction path: `nullable` spellings (3.0 `nullable`, 3.1 `type` unions/`anyOf` with `null`) become `x-nullable`, `requestBody` becomes a `body` parameter — or `formData` parameters for form media types — `components.schemas` becomes `definitions`, reusable parameters/responses move to the top-level `parameters`/`responses` maps with constraint-folded scalar declarations, `servers[0]` decomposes into `host`/`basePath`/`schemes`, and operation/document `consumes`/`produces` derive from request/response media types. Features Swagger 2.0 cannot represent — webhooks, `jsonSchemaDialect`, cookie parameters, response `links`, `callbacks`, multi-flow OAuth2, OIDC/mTLS and non-basic `http` schemes, complex parameter constraints, extra media types, server variables — drop with a deterministic `ZOPIA_WARN_DIALECT_DOWNGRADE` (or the existing `ZOPIA_WARN_WEBHOOKS`) warning at the exact pointer; runtime-native gates (`Swagger 2.0 does not support cookie parameters`, primitive-only parameter shapes) degrade the same way instead of throwing only when the dialect was downgraded, so native Swagger sources keep their strict behavior.

### 🐛 Fixed
- 📝 YAML parser hardening after adversarial review: bare `-` sequence items followed by sibling dashes no longer nest the siblings (each item is `null`); `-` stays a plain scalar in mapping-value position (`k: -`); `#` lines indented as block-scalar content are preserved instead of silently dropped; comments inside multi-line flow collections no longer corrupt quote/depth tracking, and dedented flow closers are accepted; flow collections accept trailing commas; a bare `': '` inside a flow plain scalar terminates it so missing commas fail; block-scalar headers reject junk that is not a comment; multi-line plain continuations that look like a mapping/sequence entry fail instead of folding; content after the `...` marker fails; alias resolutions clone anchored values so downstream walkers never see shared identity.

## [0.1.0] - 2026-09-28

### ✨ Added
- 📦 Prepared the public `zopia@0.1.0` package with complete npm metadata, an allowlisted source distribution, synchronized release identity, executable CLI permissions, packed-consumer library/CLI smoke tests, and a mandatory prepublish release gate.
- 📖 Completed the JSDoc audit: every exported declaration and exposed public shape member now has useful API documentation, public callables specify parameters and return values, optional configuration fields state defaults, the public example is runnable, and an AST contract suite prevents regressions in summaries, tags, links, examples, and named-only exports.
- ⌨️ Completed the CLI contract: `generate` and `reverse` now use strict command-specific parsing, reject missing/extra/unknown/incompatible/duplicate/valueless arguments before engine work, accept options around positionals, expose complete trusted-tree-aware help, preserve stdout/stderr isolation, and return stable success, user-error, and internal-error exit statuses.
- 🟣 Completed the Bun gate: added the authoritative `bun.lock`, pinned-runtime and frozen-install validation, ESM package metadata, one CI-ready gate command, full typecheck/test/coverage checks, direct and packaged CLI smoke tests, and a real Bun generation/reverse cycle that imports generated TypeScript.
- 📈 Completed the coverage gates: `bun run coverage` now measures every `src/**/*.ts` file with Vitest V8, enforces 90% overall line/function and 85% branch coverage, requires 95% aggregate conversion-engine lines and 80% lines in every source file, rejects omitted files, and regression-tests CLI success, output-file, typed-error, and unexpected-error paths.
- 📸 Completed the golden generated-tree contract: checked in deterministic directory, flat, component-reference, and km-api type-surface trees; added deliberate `golden:update` regeneration, complete byte/path comparisons with stale-tree detection, import-boundary checks, and strict no-emit compilation against published `km-api@0.4.1`; arbitrary OpenAPI media types now preserve their exact runtime strings across km-api's enumerated declaration boundary.
- 🔁 Completed the round-trip contract with source-dialect fixture properties for Swagger 2.0 and OpenAPI 3.0/3.1, all layout/component strategies, nested/cyclic/path-item refs, lossy-keyword overlays, exact version/frame/path metadata and example forms, Swagger form constraints, Zod ↔ JSON Schema convergence, and byte-identical regeneration; fixed every mismatch exposed by the new suite.
- ⚠️ Completed the warnings pipeline across all four engines: warning codes are now a stable typed catalogue; diagnostics are validated, sanitized, deduplicated, deterministically sorted, and JSON-Pointer-located; nested/runtime warnings are rebased to their exact source or output nodes; reverse conversion reports runtime Zod losses, legacy info/default-security fallbacks, and OpenAPI 3.1→3.0 omissions through results and `onWarning`; canonical generated-code markers and CLI stderr output keep reverse stdout valid JSON.
- ♻️ Completed manifest staleness handling: regeneration now compares canonical source identity, layout, component options, manifest retention, and owned-file presence; reports invalid/incomplete/drifted trees with `ZOPIA_WARN_STALE_TREE`; safely prunes only obsolete files claimed by a validated prior manifest while preserving custom files; removes old manifests when disabled; and refuses symlinked output ancestors or manifest temporary-file symlinks.
- 🔐 Completed reverse security fallback handling: manifest operation/global requirements remain authoritative and are structurally validated; runtime `auth: 'YES'` with no recorded requirement now reuses one deterministic collision-safe bearer scheme across operations, preserves existing definitions, emits the correct OpenAPI or source-dialect Swagger representation, and reports one exact-pointer warning per fallback operation.
- 🛑 Completed typed error handling across the package: `ZOPIA_ERROR_CODES` now defines one immutable stable catalogue; engines, low-level helpers, manifests, generated-module imports, filesystem writers, warnings, and CLI validation expose `ZopiaError` rather than raw exceptions, with actionable hints, discoverable locations, and preserved causes.
- 📦 Completed the versioned manifest writer/reader contract: engine ③ now delegates to a dedicated canonical, validated, atomic writer that records complete OpenAPI/Swagger frame, component, endpoint, reference, overlay, response, and security metadata; generated manifests are byte-stable, portable-path-safe, literal-aware when collecting `$ref`s, and share their typed contract and source hash with reverse conversion and stale-tree detection.
- 📄 Completed the Engine ③ public API: added `openApiToApiDocs()` with file/object/JSON-text input, validated defaults and typed `ZopiaError`s, sorted result metadata, structured conversion/staleness warnings, reference preflight, and application/json-first media selection; the CLI now delegates to the same API.
- 📐 Completed Engine ②: JSON Schema conversion now accepts `.json` paths, returns structured warnings and manifest-compatible overlays, emits visible `@zopia:warn` markers, preserves annotations, emits lazy local definitions and discriminated unions, and hands lossy schema restorations through endpoint and component manifests for reverse conversion.
- ⚛️ Completed Engine ①: Zod conversion now defaults to OpenAPI 3.1 with dialect markers enabled, preserves metadata without `id`-driven extraction, converts every Zod-reported unrepresentable site to `{}` with structured `ZOPIA_WARN_UNREPRESENTABLE` callbacks, recursively canonicalizes keyword order, and strips built-in format patterns plus safe-integer sentinel bounds.
- 📤 Reverse conversion now selects OpenAPI 3.0 or 3.1 through `ZopiaReverseOptions.version`; the documented `apiDocsToOpenApi()` API and CLI default to 3.1, selected dialects drive runtime schema serialization, and Swagger manifests can be emitted as OpenAPI 3.x.
- ✨ JSON Schema conversion now supports draft-04/06/07 `dependencies` with both property arrays and schema dependencies, including boolean schemas and malformed-entry warnings.
- ✨ Keyword-only object, array, string, and numeric schemas now enforce constraints only for matching JSON instance types while leaving other types valid.
- ✨ JSON Schema conversion now enforces `if`/`then`/`else` conditionals, including boolean branches, typed-parent context, exact keyword-only branch applicability, and malformed-definition warnings.
- 🖥️ The npm CLI now invokes a Node-compatible wrapper that launches the TypeScript CLI through Bun instead of asking Node to execute TypeScript directly; help now lists the component-reference option.
- 🧪 Endpoint generation now preserves OpenAPI request and response examples in km-api's examples structure, including Swagger 2.0 response examples and local `$ref` targets.
- 🧩 Added initial component-file and sorted component-barrel generation with `insertComponents`.
- 🧩 Component generation validates names and renders all component contents before writing files, preventing partial output from validation/conversion failures.
- 🧩 `useComponentAsReference` now imports exact endpoint component schema references through the component barrel; component alias files, self-references, direct object-property references, and direct array-item references now emit safely quoted imports while preserving original component directory names.
- 🧪 Added regression coverage for nested array component imports and safe quoting of their generated paths.
- 🧩 Object and array components now import direct nested references while preserving recursive rendering, tuple rest, `unevaluatedItems`, and tuple/array length and order-independent nested-object uniqueness constraints, nullable recursion, and correct strict/passthrough object behavior; lazy root schemas for direct self-cycles, lazy references for mutual component cycles, nested `oneOf`/`anyOf`/`allOf` compositions, nullable schemas, enums, and constants remain supported; corresponding component documentation was updated; documentation now records direct and mutual cycle support.
- 🧩 JSON Schema conversion now emits valid Zod `.min()`/`.max()` calls for numeric `minimum`/`maximum` constraints, legacy boolean exclusive bounds, valid `.regex(new RegExp(...))` code for `pattern`, hostname (including label validation), IPv4, IPv6, base64, byte, base64url, emoji, time, duration, OpenAPI signed integer formats with int32 bounds, and unsigned integer formats with uint32 bounds, plus base64 and hexadecimal content encoding, with invalid non-string content-encoding usage warnings, and approximates `patternProperties`, `propertyNames` (including enum/const/string rules), `minProperties`, and `maxProperties` with visible Zod catchall/refinement code; array `uniqueItems` and `contains` constraints, positive `multipleOf` (including decimal floating-point values), `unevaluatedProperties`, `dependentRequired`, dependent schemas (with malformed-definition warnings), and `not` exclusions now emit without false unsupported-keyword warnings; invalid `multipleOf` values for numbers and integers produce warnings are emitted as refinements, malformed dependent rules and invalid property-name regexes now produce warnings instead of throwing, and `allOf` combines multiple scalar rules such as password requirements.
- 📦 Component generation results now include the generated `components/index.ts` barrel.
- 🏗️ Added filesystem generation for endpoint `index.ts` files from the validated API-doc plan.
- 🧾 Generated endpoint exports and schema helper names now sanitize non-identifier and reserved names into valid TypeScript names.
- 🏷️ Generated endpoint metadata now preserves normalized tags and explicit security overrides.
- ⚙️ Started Phase 1 with Zod/JSON Schema conversion, OpenAPI normalization, operation collection, API-doc layout planning, and the optional ergonomic facade.
- 🧬 Added validated OpenAPI operation contract extraction for request/response media types.
- 🔗 Added strict local OpenAPI JSON Pointer reference handling and documentation.
- ✅ Added validation for response status keys, descriptions, request-body content, and chained component references.
- 📤 Added Swagger 2.0 `formData` request-contract extraction and strict field validation.
- 🔗 Local path-item references now support chaining and circular-reference detection.
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

### 🔄 Changed
- 🚀 Released Phase 1 as `zopia@0.1.0` and synchronized the release date and repository status for the Phase 2 handoff.
- 📖 Public API documentation is now audited across named-only exports, nested type shapes, callable properties/signatures, parameters, returns, direct throws, defaults, links, and examples that semantically typecheck against the real source API.
- 🧪 Every documented T-13 scenario now carries an executable `S-…` test identifier, with contracts that prevent matrix, documentation-structure, test-hygiene, deterministic-output, and forbidden-runtime behavior from drifting.
- 🚢 The release toolchain now pins Vitest and its V8 coverage provider to 4.1.11, uses Bun for TypeScript utility scripts, validates the complete Bun gate contract, and audits post-release user-visible commits for same-commit changelog updates.
- 🧹 Completed the R-111 test-isolation contract: every test-created temporary tree now uses one shared after-each cleanup helper, including failure and symlink fixtures, and a contract test prevents direct unmanaged temporary-directory creation from returning.
- 🧪 Completed the remaining T-13 scenario-matrix regressions for method-named/deep parameterized paths, all documented format and upper-bound mappings, Zod `fromJSONSchema` behavior parity, and deterministic output from both schema engines.
- 📚 Synchronized current documentation with the completed Phase 1 implementation: status labels, actual source/test layout and pipeline boundaries, generated golden examples, facade/component-reuse behavior, dependency wording, and safety/performance claims now match the repository; added a contract test for documentation links, completion state, concrete paths, and canonical output drift.
- 🔄 File-backed reverse conversion now safely applies manifest `$ref` placement, schema `set`/`remove`/frozen-node overlays, operation overlays, and response overlays after Zod re-serialization while preserving a developer-selected different component reference.
- 🧬 Runtime endpoint and component schemas now take precedence over manifest schema snapshots, including developer edits that switch a `$ref` to a different component.
- 🔄 File-based reverse conversion now re-serializes edited endpoint body, parameter, and response Zod schemas through Engine ① with request-input and response-output semantics across OpenAPI 3.x and Swagger 2.0.
- 🧱 File-based reverse conversion now securely imports emitted component modules, converts edited Zod schemas to the source API dialect, and preserves references between imported components.
- 🔄 File-based reverse conversion now securely imports generated endpoint TypeScript modules and lets edited km-api method, path, operation ID, summary, description, tags, and deprecation metadata override manifest snapshots.
- ⬆️ Updated the km-api dependency and peer dependency to `^0.4.1`; generated deprecated OpenAPI operations now emit `deprecated: 'YES'`.
- 📖 Corrected reverse-conversion documentation to keep `deprecated` separate from `disable`.
- 🔐 Generated endpoint auth metadata now uses km-api's required `'YES' | 'NO'` values.
- 📖 Corrected conversion documentation to describe km-api auth as `'YES' | 'NO'` rather than a boolean.
- 📚 Updated component documentation to cover implemented exact, nested, and cyclic imports.
- ℹ️ Deprecated operations remain preserved in the validated IR; they are not conflated with km-api's distinct `disable` status.
- 📚 Updated the roadmap and dependency standards to reflect the published `km-api@0.4.1` npm dependency.
- 📚 Corrected the architecture documentation to reference the implemented local-reference resolvers.
- 🔀 Operation-level parameters now correctly override path-level parameters.

### 🐛 Fixed
- 🐛 Release validation now audits the release commit itself and accepts the required fresh, empty `Unreleased` section after a version is cut instead of incorrectly demanding an unreleased change.
- 🐛 Canonical generation and round-trip comparison now use explicit code-unit ordering instead of host-locale collation, keeping output identical across machines and locales.
- 🐛 Coverage configuration now follows Vitest 4's include-all-source contract instead of using the removed `coverage.all` option, so the pinned release typecheck and coverage gate remain executable.
- 🐛 T-10 manifests now retain source path order, empty Path Items, and explicit empty schema-component containers; reverse conversion also preserves boolean/tuple/local-definition schema syntax, schema-less media types, absent optional flags, and unconstrained request bodies instead of silently normalizing or deleting them.
- 🐛 T-11 reverse regeneration now keeps source-order-sensitive collision plans and every fixture/layout/component tree byte-identical, recognizes exact `z.never()` and plain `z.enum()` schemas, normalizes generated scalar intersections without round-trip drift, emits whitespace-clean canonical endpoint files, and canonicalizes emitted Zod map/literal key order while reverse conversion conditionally retains source-only structure (boolean spelling, `required` order, empty maps/definitions, object openness, draft tuples, and reference-free frozen schemas) without overriding developer schema, membership, tuple-member, validation, or strictness edits.
- 🐛 T-5/T-6 endpoint planning now keeps method directories leaf-only when literal path segments equal HTTP methods and disambiguates endpoint directories that would collide structurally with `.zopia-manifest.json`; component name `index.ts` is rejected before writes because it conflicts with the component barrel.
- 🐛 T-7/T-8/T-9 generation now rejects null or malformed schema-component shapes, keeps names already ending in `Schema` from gaining a second suffix, applies the complete Engine ② constraint/annotation behavior to emitted components, enforces `$ref` sibling constraints, and ignores `$ref`-looking literal/default/extension data while selecting real component imports—even beneath literal-looking property names such as `default`.
- 🐛 Engine ② now reports malformed definition containers/entries and nested `null` schema nodes with exact warnings instead of silently ignoring them or throwing, and `uniqueItems` now rejects cyclic, coercible, BigInt, and other non-JSON candidates without making `safeParse()` throw.
- 🐛 OpenAPI normalization now rejects ambiguous version fields and dialect-incompatible or typoed root fields instead of selecting one dialect or silently dropping unsupported document data; Swagger 2.0 array parameters also validate every nested Items Object type, and malformed `consumes`/`produces` lists fail instead of accepting illegal item schemas or silently selecting fallback media types.
- 🐛 Engine ② now emits native `z.ipv4()` and `z.ipv6()` schemas instead of silently falling back to unrestricted strings after calling the removed Zod string `.ip()` method.
- 🐛 Engine ① now localizes non-JSON Zod defaults and metadata as unrepresentable schema sites with exact warning pointers instead of silently normalizing non-finite values, dropping functions, or throwing for symbols and other unsupported values.
- 🐛 Engine ② now applies `nullable` and `default` to the complete local-reference schema, rejects non-JSON defaults, constants, enum members, and annotations with structured warnings, preserves structured enums by JSON equality, and retains OpenAPI access/deprecation/XML plus vendor-extension annotations in generated Zod metadata.
- 🐛 Reverse conversion now rejects malformed edited endpoint path templates, path-parameter/template mismatches, dialect-invalid response statuses/descriptions, duplicate reconstructed operation IDs, edited path/method collisions, and invalid in-memory manifest operations instead of returning invalid OpenAPI documents; runtime collisions are classified as generated-module failures.
- 🐛 Source contract validation now rejects path keys containing query strings or fragments, unsupported/typoed path-item fields, missing or unrelated path parameters, dialect-mixed parameter/request/response shapes, multiple Swagger body parameters, illegal Swagger parameter types/locations, and out-of-range response codes instead of silently dropping invalid operation data.
- 🐛 Corrected Engine ② tuple semantics so prefix positions are optional unless required by `minItems`, tuple `minItems`/`maxItems` are enforced with valid refinements, every matching `patternProperties` schema is applied, unmatched and required-but-undeclared keys follow `additionalProperties`, and arbitrary local `$ref` siblings intersect instead of overwriting referenced constraints.
- 🐛 Made endpoint planning collision-safe for repeated slashes, root-like paths, case-only path differences, component artifact conflicts, and colliding derived operation IDs; explicit operation IDs remain authoritative, root endpoint component imports now use their actual planned depth, and generated paths/components are rejected when they are not portable across supported filesystems.
- 🐛 Local references now decode URI-fragment percent escapes and distinguish direct components from nested component pointers; nested pointers are inlined without inventing nonexistent component imports.
- 🐛 File-backed reverse conversion now keys module refreshes by generated-file content, so same-size edits with restored timestamps are not hidden by the runtime module cache.
- 🐛 Engine ③ now validates all endpoint renders before writing component artifacts, classifies endpoint files beneath an OpenAPI `/components` path as endpoints rather than mistaking every `components/` prefix for a generated schema artifact, and reports syntactically valid non-object JSON as `ZOPIA_SPEC_INVALID` instead of invalid JSON.
- 🐛 Reverse dialect translation now preserves literal example/default/enum data, nullable `$ref` semantics, combined exclusive bounds, and every Swagger `consumes`/`produces` media type while omitting 3.1-only document fields from 3.0 output.
- 🐛 File-backed reverse conversion now replaces stale media types and examples after generated-code edits, honors Swagger form-to-body transitions and legacy response examples, and rejects Swagger cookie/object parameters instead of emitting invalid documents.
- 🐛 Escaped JSON Pointer component and reusable-object names now resolve correctly; direct component aliases preserve `$ref` siblings, and generated `~` directories can be imported at runtime.
- 🐛 Multi-config endpoint modules now select the named config matching the manifest operation before an unrelated default export.
- 🐛 Direct component aliases now use distinct lazy Zod schemas so reverse conversion can distinguish an unchanged alias from a developer-selected target.
- 🐛 Runtime endpoint imports now support generated directories containing `{path}` segments, and Swagger body schemas are emitted from normalized operation contracts instead of falling back to `z.any()`.
- 🐛 Generated component schemas now import `additionalProperties` references, keep deeply nested cycles lazy, preserve open-object behavior, annotations, property-count bounds, and flexible tuple cardinality, and round-trip unique arrays plus structured `const`/`enum` values.
- 🐛 OpenAPI 3.1 Zod conversion now emits JSON Schema 2020-12 shapes instead of falling through to legacy tuple forms.
- 🐛 Generated component modules and their barrel now contain real newlines, keeping the emitted TypeScript executable at runtime.
- 🐛 JSON Schema conversion now warns for malformed `not` schemas, ignores malformed mixed `dependentRequired` entries instead of partially enforcing them, and uses own-property dependency checks.
- 🐛 Manifest reverse conversion now preserves non-schema OpenAPI component sections and reusable Swagger parameter and response definitions.
- 🐛 Generated endpoint auth is now `NO` when an OpenAPI security requirement contains an empty alternative that permits anonymous access.
- 🐛 Endpoint generation now honors `useComponentAsReference` for operation- and path-level parameter schemas, preserves nested component references in endpoint schemas, imports their component definitions, and inlines direct or nested local schema references when component imports are disabled.
- 🐛 OpenAPI operation collection now resolves parameter references before duplicate detection and override merging; referenced Swagger body and form-data parameters are extracted correctly.
- 🐛 JSON Schema conversion now honors OpenAPI 3.0 `nullable: true` around the complete schema and warns for malformed nullable flags.
- 🐛 JSON Schema conversion now preserves sibling constraints alongside `enum`, `const`, `oneOf`, `anyOf`, and `allOf`, and validates structured enum/constant values using order-independent JSON object equality.
- 🐛 JSON Schema conversion now preserves empty `prefixItems` and legacy tuple definitions, including typed or forbidden `items`, `additionalItems`, and `unevaluatedItems` rest values.
- 🐛 JSON Schema conversion now honors `false` boolean schemas in `contains` and `propertyNames`, warns for malformed values, and no longer reports empty schemas as unsupported types.

### 🛡️ Security
- 🛡️ Updated and locked the test dependency tree to a zero-vulnerability npm audit resolution while retaining the declared Node 20 compatibility range.
- 🛡️ Warning deduplication now uses collision-free structured identities, and formatted diagnostics/comments escape control characters in locations while sanitizing control characters in messages.
- 🛡️ Manifest file ownership now detects case-insensitive path collisions before trees are written on case-sensitive hosts.
- 🛡️ File-backed reverse conversion now preflights every endpoint and emitted-component path before importing code, reports missing manifests as `ZOPIA_DOCS_MISSING_MANIFEST`, and reports missing or renamed generated files as `ZOPIA_DOCS_MANIFEST_MISMATCH`.
- 🔒 Generated component and parameter Zod shapes now use computed property keys, while example metadata is reconstructed with `JSON.parse`, preserving `__proto__` as ordinary data at runtime.
- 🔒 Endpoint generation now preserves prototype-like request example names without mutating the examples object's prototype or dropping metadata.
- 🔒 Endpoint generation now escapes line terminators in source metadata comments, preventing malformed or injected generated TypeScript.
- 🔒 Reverse conversion now rejects unsafe or duplicate manifest operations and prevents overlays from replacing canonical OpenAPI fields.
- 🛡️ JSON Schema conversion now validates numeric, size, pattern, object, and array keyword values before generating Zod code, warns instead of emitting malformed expressions, and ignores constraints on inapplicable instance types.
- 🔒 Reverse conversion restores manifest overlays with prototype-safe property definition.
- 🛡️ Component generation now preserves OpenAPI 3.1 boolean schemas instead of converting them to unconstrained schemas.
- 🛡️ Added validation for malformed schemas, unsafe paths, references, identifiers, operation IDs, and facade properties.
- 🛡️ JSON Pointer resolution now rejects inherited object properties.

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
