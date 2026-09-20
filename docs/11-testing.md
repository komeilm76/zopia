# 🧪 Testing

> 🎯 **T-13** — *tests in all scenarios, with Vitest, run with Bun.*
> Every rule in this project (R-…), every target (T-…), and every mapping row
> in [Conversions](06-conversions.md) is **pinned by at least one test**.

## 🛠️ Toolchain

| 🧩 Piece | 📏 Choice | 📝 Why |
| --- | --- | --- |
| Runner | **Vitest** | requested standard (D-02); snapshots, coverage, type-aware assertions |
| Runtime | **Bun** | runs the package, the tests, *and* the generated code (D-08) |
| Types | `tsc --noEmit` (`strict`) | the type-level test gate |
| Fixtures | plain JSON files under `tests/fixtures/` | specs are the unit of integration |

```bash
bun run typecheck     # ✅ strict TS
bun run test          # 🧪 vitest run (CI mode)
bun run test:watch    # 👀 vitest watch
bun run coverage      # 📈 vitest --coverage
bun run golden:update # 📸 regenerate golden trees deliberately (R-112)
```

## 📐 Test pyramid

| 🏔️ Layer | 📍 Where | 🎯 What it proves |
| --- | --- | --- |
| **Unit** | `src/**/*.test.ts` (colocated) | each keyword mapping, each layout function, each error path — in isolation, on plain objects |
| **Integration** | `tests/integration/**/*.test.ts` | full engine runs: spec in → tree out (both modes, both option combos); tree in → spec out |
| **Round-trip** | `tests/roundtrip/**/*.test.ts` | property: `openapi(docs(spec)) ≈ spec` and `zodSchema(zod(jsonSchema(zodSchema))) ≈ schema` (see below) |
| **Golden files** | `tests/fixtures/expected/**` | byte-exact snapshots of generated trees (determinism, P-1) — regenerated deliberately, reviewed in PRs |
| **Contract** | `tests/contract/**/*.test.ts` | the public API shape, JSDoc presence, error codes, manifest schema |

> 📌 **Rule R-111** — *no test touches the network*; *no test writes outside
> a per-test temp directory* (`fs.mkdtemp` under `os.tmpdir()`, cleaned in
> `afterEach`); *no test depends on wall-clock or locale*.

## 🧾 The scenario matrix

The suite **must** cover every cell. A cell is a *spec axis × an output axis*:

### 📄 Spec-input scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-01 | Swagger 2.0 — basic (definitions, body params, consumes/produces, securityDefinitions, host/basePath) | ③ v2 table |
| S-02 | Swagger 2.0 — `formData` (urlencoded *and* multipart) | R-503 |
| S-03 | Swagger 2.0 — primitive params (`type`/`format`/`enum` inline) | v2 param normalization |
| S-04 | OpenAPI 3.0 — cookie params, requestBody, `nullable: true`, single `example` | ③ v3 table |
| S-05 | OpenAPI 3.1 — `type: [t, "null"]`, `const`, numeric `exclusiveMinimum`, `prefixItems`, `examples` array | R-503 |
| S-06 | Both dialects — `deprecated`, tags with descriptions, multiple servers | R-641 |
| S-07 | Error inputs — invalid JSON, unknown version, missing `paths`, unknown/external `$ref` | error model (R-404) |

### 🔗 Ref-graph scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-11 | simple ref (operation → component) | R-402 |
| S-12 | nested refs (component → component → component) | R-811 |
| S-13 | cycle (component → itself) → `z.lazy()` | R-402/R-812 |
| S-14 | same component used by many operations (dedupe in default mode, imports in ref mode) | R-403/R-822 |
| S-15 | missing ref / external ref → typed error | R-404 |

### 📂 Layout scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-21 | `directory` — the canonical Admin API tree (golden file) | R-711…R-714 |
| S-22 | `flat` — same spec, flat names (golden file) | R-721…R-723 |
| S-23 | flat name collision → `-2` suffix | R-722 |
| S-24 | path with a literal segment equal to a method name (`/users/get`) | R-714 |
| S-25 | deep paths (5+ segments) & params at every level | R-711 |

### ⚙️ Option scenarios

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-31 | defaults (`directory`, no components) — self-contained files (imports only `zod`/`km-api`) | R-502, defaults |
| S-32 | `insertComponents: true` — `components/**` + barrel + inlined endpoints | R-801 |
| S-33 | `insertComponents + useComponentAsReference` — barrel imports in endpoints | R-802, R-821 |
| S-34 | `useComponentAsReference` alone → `ZOPIA_CONFIG_INVALID` | R-911 |
| S-35 | manifest written & valid in all of the above (schema test) | D-06 |

### ⚛️ Zod / JSON Schema coverage (engines ① & ②)

| # | Scenario |
| --- | --- |
| S-41 | every string format of R-627 (email, uuid, url/uri alias, hostname, ipv4/6, date-time, date, time, duration) + custom formats → `z.string()` + warning + overlay |
| S-42 | every numeric/string/array constraint of R-628 (min/max, int, regex, multipleOf, exclusive bounds both forms) |
| S-43 | enum (string/non-string), const, nullable (both spellings), tuples (both spellings) |
| S-44 | objects: required/optional, `additionalProperties` (false/schema/true), defaults, catchall |
| S-45 | oneOf/anyOf/allOf, discriminator → `discriminatedUnion` (+ fallback case) |
| S-46 | D-12 unsupported keywords → warning + approximation + `// @zopia:warn` comment (uniqueItems, not, if/then/else, patternProperties, propertyNames, min/maxProperties, contains) — and the manifest overlay restores the original keywords verbatim (R-635, asserted in the round-trip) |
| S-47 | ① targets — output diffs between `openapi-3.1` / `openapi-3.0` / `draft-2020-12` / `draft-07` for the same input |
| S-48 | ① unrepresentable (transforms, functions, NaN, `z.set`) → `{}` + warning (R-614) |
| S-49 | ② cross-check: generated code's runtime schema behaves like `z.fromJSONSchema()`'s (experimental) one on the fixture set |
| S-50 | ②/① determinism — same input ⇒ identical output, twice in a row |
| S-51 | ①/④ value normalizations — sentinel integer bounds stripped (R-618), const-literal unions → `enum`, defaulted keys dropped from `required` (R-654) — asserted before the round-trip comparison |

### 🔁 Reverse-conversion scenarios (engine ④)

| # | Scenario | 🆔 Rules pinned |
| --- | --- | --- |
| S-61 | reverse of S-21 (directory) → equals original spec after canonicalization | R-651…R-658 |
| S-62 | reverse of S-22 (flat) → same result as S-61 (mode-independence) | D-06 |
| S-63 | reverse with `insertComponents + refs` on → `components.schemas` + `$ref`s restored | R-821…R-823 |
| S-64 | `version: '3.0'` vs `'3.1'` output diff | D-09 |
| S-65 | missing manifest / renamed file / broken export → typed errors | R-651/R-652 |
| S-66 | metadata restoration — titles, examples, servers, tag descriptions, security schemes, multi-content types come back verbatim | R-656/R-657 + honest-limits table |
| S-67 | idempotence — `reverse(generate(spec))` then `generate(…)` ⇒ identical tree (T-11) | R-409 |

## 🔄 Round-trip property tests

```ts
// 🧪 tests/roundtrip/property.test.ts (sketch)
for (const fixture of loadFixtures('specs/*.json')) {
  it(`round-trips ${fixture.name}`, async () => {
    const tree = await openApiToApiDocs(fixture.json, DEFAULTS);
    const back = await apiDocsToOpenApi(tree.dir, { version: fixture.version });
    expect(canonicalize(back.openapi)).toEqual(canonicalize(fixture.json));
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

## 🧰 Fixtures

```text
tests/fixtures/
├── specs/
│   ├── admin-api-3.0.json        # ⭐ the canonical Admin API (docs/07)
│   ├── admin-api-2.0.json        # same API as Swagger 2.0
│   ├── petstore-mini-3.1.json    # 3.1 keywords (const, prefixItems, …)
│   ├── cycle-comment.json        # 🌀 self-referential component
│   ├── nested-refs.json          # 🧩 component → component → component
│   ├── formdata-2.0.json         # 🧾 formData multipart + urlencoded
│   ├── cookies-3.0.json          # 🍪 cookie parameters
│   ├── unsupported-keywords.json # 🚫 D-12 matrix in one spec
│   └── edge/                     # S-07 error fixtures (invalid JSON, bad refs, …)
└── expected/
    ├── admin-api-3.0.directory/  # 📸 golden tree (defaults)
    ├── admin-api-3.0.flat/       # 📸 golden tree (flat)
    └── admin-api-3.0.components/ # 📸 golden tree (components + refs)
```

> 📌 **Rule R-112** — golden trees are checked in and reviewed like code.
> Changing one requires a deliberate `bun run golden:update` run and a PR
> showing the diff — determinism regressions are visible in review.

## 📈 Coverage gates

| 📏 Gate | 🎯 Threshold |
| --- | --- |
| Lines / functions | ≥ **90%** overall |
| Branches | ≥ **85%** overall |
| `src/engines/**` | ≥ **95%** lines — the mapping tables are the product |
| Any single file | never below **80%** lines |

`bun run coverage` fails CI below the gates. Warnings paths (D-12) are
tested — a warning that never fires in tests is a red flag, not a shrug.

## 📏 Writing tests (standard)

| # | Rule |
| --- | --- |
| R-121 | **AAA** — Arrange / Act / Assert sections, one behaviour per `it()` |
| R-122 | **Name = spec** — test names cite the rule they pin: `it('R-627: format email → z.email()', …)` |
| R-123 | **Errors assert on `code`** (R-404), never on message text |
| R-124 | **New rule ⇒ new test** — adding an R-… row to any doc requires the matching test in the same PR |
| R-125 | **No skipped tests in main** — `it.skip` is allowed only with a linked issue and a removal date |

## 🔗 Next

- 📏 The rules being tested → [Standards](12-standards.md)
- 🔄 The engines' exact contracts → [Conversions](06-conversions.md)
