# 🧪 Testing

> 🎯 **T-13** — *tests in all scenarios, with Vitest, run with Bun.*
> Every rule in this project (R-…), every target (T-…), and every mapping row
> in [Conversions](06-conversions.md) is **pinned by at least one test**.

## 🛠️ Toolchain

| 🧩 Piece | 📏 Choice | 📝 Why |
| --- | --- | --- |
| Runner | **Vitest 4.1.11** (exact pin) | requested standard (D-02); snapshots, V8 coverage, type-aware assertions |
| Runtime | **Bun** | runs the package, the tests, *and* the generated code (D-08) |
| Types | `tsc --noEmit` (`strict`) | the type-level test gate |
| Fixtures | plain JSON files under `tests/fixtures/` | specs are the unit of integration |

```bash
bun run typecheck     # ✅ strict TS
bun run test          # 🧪 vitest run (CI mode)
bun run test:watch    # 👀 vitest watch
bun run coverage      # 📈 vitest --coverage
bun run golden:update # 📸 regenerate golden trees deliberately (R-112)
bun run package:check # 📦 exact npm archive + isolated consumer smoke
bun run release:check # 🚢 frozen install + every release check
```

The Bun gate is the release-level wrapper around these individual commands. It
also validates the pinned Bun version and `bun.lock`, executes the package binary,
proves reverse conversion can import freshly generated TypeScript under Bun,
and packs the exact npm artifact for an isolated offline install, package-root
import, and generate/reverse CLI smoke test. `prepublishOnly` delegates to this
same gate so local and publish-time validation cannot drift.

## 📐 Test pyramid

| 🏔️ Layer | 📍 Where | 🎯 What it proves |
| --- | --- | --- |
| **Focused** | `tests/*.test.ts` | schema keywords, OpenAPI helpers, layouts, planning, manifests, warnings, and errors on in-memory values |
| **Integration** | top-level `tests/*generate*.test.ts`, `tests/*public*.test.ts`, and `tests/*to-openapi*.test.ts` | full engine runs: spec in → tree out (both modes/options); trusted generated tree in → spec out |
| **Round-trip** | `tests/roundtrip/**/*.test.ts` | property: `openapi(docs(spec)) ≈ spec` and `zodSchema(zod(jsonSchema(zodSchema))) ≈ schema` (see below) |
| **Golden files** | `tests/fixtures/expected/**` | byte-exact generated trees (determinism, P-1), regenerated deliberately and reviewed with their fixture inputs |
| **Contract** | `tests/contract/**/*.test.ts` | public API/JSDoc, scenario identifiers, quality/forbidden behavior, changelog history, golden output, npm artifact, release metadata, and documentation status |

> 📌 **Rule R-111** — *no test touches the network*; *no test writes outside
> a per-test temp directory*. Every test-created directory goes through the
> shared `useTemporaryDirectories()` helper (`fs.mkdtemp` under `os.tmpdir()`),
> which removes all owned trees in `afterEach`; a hygiene contract rejects direct
> temp-directory factories in test files. The same contract rejects network,
> wall-clock, random, and host-locale behavior in tests.

## 🧾 The scenario matrix

The suite **must** cover every cell. A cell is a *spec axis × an output axis*.
Each `S-…` identifier below appears in the executable test that covers it, and a
contract test compares the complete documented identifier set with the complete
Vitest source tree so a newly documented scenario cannot remain unimplemented:

### 📄 Spec-input scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-01 | Swagger 2.0 — basic (definitions, body params, consumes/produces, securityDefinitions, host/basePath) | ③ v2 table |
| S-02 | Swagger 2.0 — `formData` (urlencoded *and* multipart) | R-503 |
| S-03 | Swagger 2.0 — primitive params (`type`/`format`/`enum` inline) | v2 param normalization |
| S-04 | OpenAPI 3.0 — cookie params, requestBody, `nullable: true`, single `example` | ③ v3 table |
| S-05 | OpenAPI 3.1 — `type: [t, "null"]`, `const`, numeric `exclusiveMinimum`, `prefixItems`, `examples` array | R-503 |
| S-06 | Both dialects — `deprecated`, tags with descriptions, multiple servers | R-641 |
| S-07 | Error inputs — invalid JSON, unknown version, missing `paths`, unknown/external/malformed/circular `$ref` | error model (R-404) |
| S-08 | typed-error boundary matrix — engines ①–④, low-level helpers, warning validation, generated-module imports, filesystem writers, and CLI arguments all fail with a catalogued `ZopiaError`, actionable `hint`, discoverable `at`, and preserved `cause` | R-141…R-143/R-404 |

### 🔗 Ref-graph scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-11 | simple ref (operation → component) | R-402 |
| S-12 | nested refs (component → component → component) | R-811 |
| S-13 | cycle (component → itself) → `z.lazy()` | R-402/R-812 |
| S-14 | same component used by many operations (self-contained inlining in default mode, identity-preserving imports in ref mode) | R-403/R-822 |
| S-15 | missing ref / external ref → typed error | R-404 |

### 📂 Layout scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-21 | `directory` — the canonical Admin API tree (golden file) | R-711…R-714 |
| S-22 | `flat` — same spec, flat names (golden file) | R-721…R-723 |
| S-23 | flat name collision → `-2` suffix | R-722 |
| S-24 | path with a literal segment equal to a method name (`/users/get`) | R-714 |
| S-25 | deep paths (5+ segments) & params at every level | R-711 |
| S-26 | `TRACE` operation → emitted as a `trace/` method dir with `method: 'TRACE'` (km-api ≥ 0.4.1) | R-712/R-642 |

### ⚙️ Option scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-31 | defaults (`directory`, no components) — self-contained files (imports only `zod`/`km-api`) | R-502, defaults |
| S-32 | `insertComponents: true` — `components/**` + barrel + inlined endpoints | R-801 |
| S-33 | `insertComponents + useComponentAsReference` — endpoint schemas import emitted components recursively; cycles stay lazy | R-802, R-821 |
| S-34 | `useComponentAsReference` alone → `ZOPIA_CONFIG_INVALID` | R-911 |
| S-35 | manifest written & valid in all of the above (schema test) | D-06 |
| S-36 | dedicated manifest writer — canonical hash/bytes, complete OpenAPI and Swagger frame metadata, portable paths, literal-aware `$ref` collection, invalid-shape rejection, atomic replacement/cleanup, temporary-symlink refusal, and reader round-trip compatibility | D-06, P-1, R-751…R-754 |
| S-37 | manifest staleness — source/config drift, invalid manifests, missing owned files, canonical key-reordering equivalence, manifest disablement, obsolete-owned-file pruning, custom-file retention, and symlink-ancestor rejection | R-741…R-743/R-406 |

### ⚛️ Zod / JSON Schema coverage (engines ① & ②)

| # | Scenario |
| --- | --- |
| S-41 | every format row of R-627 (email, uuid, url/uri alias, hostname, ipv4/6, date-time, date, time, duration, `byte` → `z.base64()`) + unmapped formats (password, binary, int32/64, float, double, …) → base type + warning + overlay |
| S-42 | every numeric/string/array constraint of R-628 (min/max, int, regex, multipleOf, exclusive bounds both forms) |
| S-43 | enum (string/non-string), const, nullable (both spellings), tuples (both spellings) |
| S-44 | objects: required/optional, `additionalProperties` (false/schema/true), defaults, catchall |
| S-45 | oneOf/anyOf/allOf, discriminator → `discriminatedUnion` (+ fallback case) |
| S-46 | D-12 unsupported keywords → warning + approximation + `// @zopia:warn` comment (uniqueItems, not, if/then/else, patternProperties, propertyNames, min/maxProperties, contains) — and the manifest overlay restores the original keywords verbatim (R-635, asserted in the round-trip) |
| S-47 | ① targets — output diffs between `openapi-3.1` / `openapi-3.0` / `draft-2020-12` / `draft-07` for the same input |
| S-48 | ① unrepresentable (transforms, functions, NaN, `z.set`) → `{}` + warning (R-614) |
| S-49 | ② cross-check: generated code's runtime schema behaves like `z.fromJSONSchema()`'s (experimental) one on the fixture set |
| S-50 | ②/① determinism — same input ⇒ identical output, twice in a row |
| S-51 | ①/④ value normalizations — sentinel integer bounds stripped (R-618), const-literal unions → `enum` (R-654) — asserted before the round-trip comparison |
| S-52 | `io: 'input'` request conversion (R-615) — defaulted request fields stay out of `required`, transformed request fields convert to their *input* type; response schemas use `io: 'output'` |
| S-53 | shared warning normalization — stable-code validation, one-line sanitization, deduplication, deterministic order, JSON Pointer rebasing, and canonical comment/log formatting; nested ② siblings retain distinct exact source locations |

### 🔁 Reverse-conversion scenarios (engine ④)

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-61 | reverse of S-21 (directory) → equals original spec after canonicalization | R-651…R-658 |
| S-62 | reverse of S-22 (flat) → same result as S-61 (mode-independence) | D-06 |
| S-63 | reverse with `insertComponents + refs` on → `components.schemas` + `$ref`s restored | R-821…R-823 |
| S-64 | `version: '3.0'` vs `'3.1'` output diff | D-09 |
| S-84 | `version: '2.0'` dialect downgrade — host/basePath/schemes decomposition, `x-nullable`, body/formData parameters, global `parameters`/`responses` tables, security-scheme mapping, deterministic downgrade warnings, native-Swagger identity | D-20 |
| S-86 | native `z.record` conversion for exact `propertyNames`+`additionalProperties` objects — warning/overlay-free code, runtime key enforcement, verbatim engine ③→④ round-trip; non-native propertyNames forms stay refined + frozen | D-22 |
| S-87 | 3.1 webhook endpoint generation — deterministic `webhooks/` files, manifest `webhooks[]`/`webhookOrder`/`webhooksOverlay` records, exact-order engine ④ round-trip with runtime refresh, derived operationIds, local path-item `$ref` items restored verbatim unchanged (`webhookItemRef`) and expanded on edit, empty `x-` webhook items preserved through the order list, operation-less map preservation, malformed webhook items raise typed `ZOPIA_SPEC_INVALID`, 3.0/2.0 omission warnings with in-place expansion of path-item `$ref`s into omitted containers, cross-scope operationId rejection at ③ plus the defense of record at ④ | D-23 |
| S-91 | spec diff — key-order-insensitive identity across JSON/YAML/object inputs; endpoint add/remove operations labeled by method+path+operationId in path-primary order; shared-operation headers with scalar/parameter/request-body/response/`x-` details (add/remove/change per field); dialect, info, webhooks, components (dialect-aligned `at` pointers), document fields, and root extensions compared; typed failures for unreadable inputs; CLI glyph/stdout-silence/exit-0 contract plus grammar rejection and `--help` coverage; round 6 coverage — component registries (`parameters`/`responses`/`securitySchemes`/`securityDefinitions`/`requestBodies`/`headers`/`links`/`callbacks`/`examples`/`pathItems`) with dialect-aligned pointers, path-item/webhook-item metadata via `$ref` resolution, `x-` entries inside `paths`/`webhooks`, typed `$ref`-chain failures | Phase 3 diff tool |
| S-90 | incremental regeneration (D-24) — byte-identical regen leaves endpoint/manifest mtimes untouched; changed sources refresh them; one scaffolded `custom.ts` per endpoint+webhook in both layouts with the `export * as custom` line; hand edits and symlinks at the path survive regeneration; default off, toggle off drops the export line but keeps the file; staleness message covers the `custom` toggle; non-boolean options rejected at both layers; CLI `--custom` + `--help` coverage; a directory shadowing the companion path is a typed `ZOPIA_FS_OUTSIDE_OUTDIR`, and `custom.ts`-shaped path segments (planner-renamed) still receive a real scaffold file in both layouts |
| S-89 | `zopia validate` — clean spec/docs trees report `ok`, broken `$ref`s error at the offending pointer, cross-namespace duplicate operationIds error, unreachable 3.1 components (including orphan chains) and Swagger 2.0 definitions warn, webhook-only references stay reachable, same-folder external refs bundle before linting, generated trees run a reverse dry-run, missing/tampered manifests report typed errors, km-api outside the peer range or unresolvable warns without failing, CLI grammar/help/stdout-stderr/exit-status contracts | Phase 3 validate |
| S-88 | `zopia generate --watch` — immediate initial run, coalesced spec-change regeneration with in-place stale-tree refresh (one `ZOPIA_WARN_STALE_TREE`), error-recovery across broken edits (previous tree untouched, watching continues), atomic-save survival (write-temp + rename, parent-directory watch), forward warnings surfaced each run, duplicate-flag rejection, `--help` coverage | watch mode |
| S-65 | missing manifest / renamed file / broken export → typed errors | R-651/R-652 |
| S-66 | metadata restoration — titles, examples, servers, tag descriptions, security schemes, multi-content types come back verbatim | R-656/R-657 + honest-limits table |
| S-67 | idempotence — `reverse(generate(spec))` then `generate(…)` ⇒ identical tree, including source-order-sensitive method/path collisions and empty Path Items (T-11) | R-409 |
| S-68 | non-standard status (`419`) + `default` response → emitted as numeric/`default` response keys, round-trips exactly (km-api ≥ 0.4.1) | R-642 |
| S-69 | exotic media type (`application/vnd.custom+json`) → emitted verbatim as the content type, used as the `content` key on reverse (km-api ≥ 0.4.1) | R-642 |
| S-70 | parameter extras (`allowEmptyValue`, `style`, `explode`) + response `headers` → overlay/`responseOverlay`, restored verbatim on reverse | R-635/R-754 |
| S-71 | multiple security schemes + per-operation requirements with scopes (oauth2) + an explicit `security: []` operation → `defaultSecurity` / `apis[].security` manifest fields, round-trips exactly (km-api stores only the `auth` boolean) | R-653/R-656 |
| S-72 | reverse warnings — runtime Zod losses, fallback info/security, and 3.1→3.0 omissions return/callback with exact output pointers; security fallback coverage includes multiple operations, definition-name collisions, manifest-authoritative explicit/global requirements, and OpenAPI/Swagger representations | R-408/R-654/R-656…R-658 |
| S-73 | CLI warning channels — generate/reverse diagnostics go to stderr while reverse stdout remains parseable JSON | R-408/R-933 |
| S-74 | CLI contract — every flag maps to its API option; options may surround positionals; missing/extra arguments, unknown/cross-command/duplicate/valueless flags fail before engine work; help includes the trusted-tree warning; exit statuses distinguish typed and unexpected failures | R-931…R-934 |
| S-75 | JSDoc AST audit — every directly or named-only exported declaration and exposed public/nested-shape member has a useful summary; all callable forms require specific parameters/returns, optional configuration defaults are stated, TypeScript examples semantically typecheck against the source API, and relative `@see` links resolve | T-12/R-131…R-135/R-1003 |
| S-76 | Package/release contract — version and public metadata stay synchronized; Vitest/coverage versions and Bun scripts stay pinned; the npm archive is allowlisted and executable; `prepublishOnly` runs the complete release gate; the exact tarball installs offline and passes package-root import plus generate/reverse CLI smoke tests | R-191…R-193 |
| S-77 | YAML input — `.yaml`/`.yml` paths, inline YAML text, extension-less YAML fallback, and JSON-inside-YAML flow text enter engine ③; byte-identical trees vs JSON twins, reverse round-trips, CLI parity, stable YAML-side error codes | D-16/R-404 |
| S-78 | YAML parser (D-16) — core-schema scalars, nested block/flow collections, quoted escapes, literal/folded block scalars with chomping/indent indicators, anchors/aliases/`<<` merge keys, directives/markers, deterministic failure matrix, recursion guard | D-16/R-1006 |
| S-79 | external `$ref` bundling (D-17) — same-folder YAML/JSON chains resolve inline with clone-on-splice, sibling-key merges, self-file refs, literal/example shielding, and read-once caching; API/CLI generated trees are byte-identical to inline twins, reverse emits the bundled single file, and manifest staleness reacts to sibling-file edits | D-17/P-1 |
| S-80 | external `$ref` failure matrix (D-17) — URL/`../`/absolute/subdirectory/drive/unknown-extension targets keep `ZOPIA_REF_EXTERNAL`; unreadable, unparsable (JSON/YAML), missing-pointer, bad-fragment, circular, >512-deep, and sibling-on-scalar targets fail with typed codes located at the referencing pointer | D-17/R-404 |
| S-81 | reusable parameters & responses generation (D-18) — declarations become `components/parameters/<Name>/index.ts` / `components/responses/<Name>/index.ts` modules with `<Name>Parameter` / `<Name>Response` exports and kind barrels; bare-`$ref` use sites import through the barrel while sibling-merged `$ref`s inline; cross-schema/ref-chain derivations, body/formData slots, manifest `kind` entries, schema-less response exclusion, and invalid-container/collision errors | D-18/P-1 |
| S-82 | reusable parameters & responses round-trip (D-18) — both fixtures (`reusables-3.1.json`, `reusables-2.0.json`) reproduce byte-exactly after canonicalization; edited modules refresh their declarations on reverse (Swagger 2.0 constraints and 3.x content forms) while every use-site `$ref` restores verbatim from manifest placements and declaration chains stay chains | D-18/R-716 |
| S-83 | `zopia.config.ts` project defaults (D-19) — working-directory discovery + explicit `--config` paths, default/named `config` exports, structural validation with key-located `ZOPIA_CONFIG_INVALID`, precedence CLI > config > defaults (`--no-manifest` always wins), optional `<output-dir>` from `generate.outDir`, and reverse `version`/`out` defaults | D-19/R-940 |

## 🔄 Round-trip property tests

```ts
// 🧪 tests/roundtrip/property.test.ts (implemented)
for (const fixture of fixtures) {
  it(`round-trips ${fixture}`, async () => {
    const outDir = await temporaryDirectory(); // shared R-111 cleanup helper
    await openApiToApiDocs(await loadFixture(fixture), { outDir });
    // Omitting `version` preserves the source dialect, including Swagger 2.0
    // and an exact OpenAPI patch version such as 3.0.3.
    const back = await manifestFileToOpenApi(path.join(outDir, '.zopia-manifest.json'));
    expect(canonicalize(back)).toEqual(canonicalize(await loadFixture(fixture)));
    const regenerated = await temporaryDirectory();
    await openApiToApiDocs(back, { outDir: regenerated });
    expect(await treeSnapshot(regenerated)).toEqual(await treeSnapshot(outDir));
  });
}
```

`canonicalize()` = R-401 key ordering + deep-equal on JSON (whitespace
independent). Value normalizations are **not** part of canonicalization —
engine ④'s serializer applies them (R-654) *before* comparison, so a mismatch
is a real engine bug. Every dialect fixture (S-01…S-06) round-trips against
**its own original**; the canonical Admin API additionally asserts an
**empty `overlay` on every API** — a spec-clean spec must round-trip without a
single frozen subtree or keyword restoration.

The implemented matrix also runs flat mode, emitted-but-inlined components,
emitted component references, nested and cyclic refs, and frozen overlays. For
every fixture/layout/component case it asserts that reverse output reproduces
the source and regenerates a byte-identical tree; separate properties cover
same-input regeneration and collision-sensitive path plans. It checks source-preserving
Swagger → OpenAPI selection separately, covers explicit empty schema containers,
empty Path Items, boolean/tuple/local-definition schemas, schema-less media and
absent optional flags, and verifies that supported Zod → JSON Schema → Zod
pipelines (including `z.never()`) converge on the same canonical schema. Every temporary tree is removed after its test (R-111).

## 🧰 Fixtures

```text
tests/fixtures/
├── specs/
│   ├── admin-api-3.0.json        # ⭐ the canonical Admin API (docs/07)
│   ├── admin-api-3.0.yaml        # 📝 YAML twin — parses/generates byte-identically (S-77)
│   ├── admin-api-2.0.json        # same API as Swagger 2.0
│   ├── admin-api-2.0.yaml        # 📝 YAML twin (S-77)
│   ├── petstore-mini-3.1.json    # 3.1 keywords (const, prefixItems, …)
│   ├── cycle-comment.json        # 🌀 self-referential component
│   ├── nested-refs.json          # 🧩 component → component → component
│   ├── formdata-2.0.json         # 🧾 formData multipart + urlencoded
│   ├── cookies-3.0.json          # 🍪 cookie parameters
│   ├── unsupported-keywords.json # 🚫 D-12 matrix in one spec
│   ├── path-item-ref-3.1.json    # 🔗 local path-item reference identity
│   ├── km-api-contract-3.1.json  # 📐 trace/custom/default/extension type surface
│   ├── external-refs/            # 🔗 spec folder with sibling YAML/JSON shards (D-17/S-79)
│   │   ├── admin-3.0.yaml        # root — cross-file refs, sibling merges, self-file refs
│   │   ├── shared-schemas.yaml   # schemas with local + cross-file refs of their own
│   │   ├── shared-responses.yaml # reusable response target
│   │   └── common.json           # JSON leaf with its own local refs
│   └── external-refs-inline/     # 🔗 fully-inline twin — byte-identical generated tree (S-79)
│       └── admin-3.0-inline.json
└── expected/
    ├── admin-api-3.0.directory/  # 📸 golden tree (defaults)
    ├── admin-api-3.0.flat/       # 📸 golden tree (flat)
    ├── admin-api-3.0.components/ # 📸 golden tree (components + refs)
    ├── km-api-0.4.1.contract/    # 📐 generated open-value type contract
    └── tsconfig.json             # 🔒 dedicated strict no-emit gate
```

> 📌 **Rule R-112** — golden trees are checked in and reviewed like code.
> Changing one requires a deliberate `bun run golden:update` run and a PR
> showing the diff — determinism regressions are visible in review.
>
> The implemented updater removes and recreates only the governed output trees
> from their checked-in JSON fixtures. The contract suite generates each variant
> into a cleaned `os.tmpdir()` directory, compares the complete relative-path →
> UTF-8-byte map (so extra files fail too), and verifies that `expected/` itself
> contains no ungoverned tree.

## 📈 Coverage gates

| 📏 Gate | 🎯 Threshold |
| --- | --- |
| Lines / functions | ≥ **90%** overall |
| Branches | ≥ **85%** overall |
| `src/conversions/**` | ≥ **95%** lines — these files implement engines ①–④ and their mapping tables |
| Any single `src/**/*.ts` file | never below **80%** lines |

`bun run coverage` runs Vitest's V8 provider over **all** `src/**/*.ts` files,
including files that no test imported. Vitest enforces the overall thresholds;
`scripts/check-coverage.ts` then inventories source files against the JSON
summary, enforces the aggregate conversion-engine and per-file line gates, and
exits non-zero on any omission or shortfall. Warnings paths (D-12) are tested —
a warning that never fires in tests is a red flag, not a shrug.

## 📏 Writing tests (standard)

| # | Rule |
| --- | --- |
| R-121 | **AAA** — Arrange / Act / Assert sections, one behaviour per `it()` |
| R-122 | **Name = spec** — test names cite the rule they pin: `it('R-627: format email → z.email()', …)` |
| R-123 | **Errors assert on `code`** (R-404), never on message text |
| R-124 | **New rule ⇒ new test** — adding an R-… row to any doc requires the matching test in the same PR |
| R-125 | **No skipped tests in main** — `it.skip` is allowed only with a linked issue and a removal date |
| R-126 | **Golden trees typecheck** — the contract suite runs dedicated strict, no-emit `tsc` over every golden `api_docs` tree against installed published `km-api@0.4.1` (D-15), without skipping declaration checks. The contract fixture pins `trace`, custom and `default` statuses, and an arbitrary extension media type. `makeApiConfig` remains the actual call-site gate rather than a source-text substitute (D-14/R-642) |

## 🔗 Next

- 📏 The rules being tested → [Standards](12-standards.md)
- 🔄 The engines' exact contracts → [Conversions](06-conversions.md)
