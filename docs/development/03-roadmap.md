# 🗺️ Roadmap

zopia ships in phases. **Phase 0 is this documentation set** — the contracts
are fixed before a line of code is written, so implementation never re-decides
anything.

## 🚦 Phase 0 — Documentation & standards ✅

The standard documentation of the project:

- 📚 `docs/` — overview, targets, roadmap, architecture, concepts, conversions,
  api-docs format, components, configuration, usage, testing, standards
- 🏠 `README.md` — project home with the documentation map
- 📜 `CHANGELOG.md` — Keep-a-Changelog format + the "changelog after commits" rule
- 🔐 `LICENSE` (MIT) · 🧹 `.gitignore`
- 🔑 Key decisions **D-01 … D-15** recorded in [Standards](12-standards.md#-key-decisions)

**Completed:** the documentation fixed the Phase 1 contracts before
implementation; it now describes the implemented v0.1.0 behavior and deferred scope.

## 🚀 Phase 1 — The four engines (v0.1.0) ✅

**Released:** 2026-09-28. Everything in [Targets](02-targets.md) is marked ✅:

- [x] ⚙️ Package scaffold — ESM `package.json` (Bun-first, zero direct runtime
      dependencies; `zod` + `km-api ^0.4.1` peers from npm — D-15), strict `tsconfig`,
      Vitest/V8, pinned Bun, and checked-in `bun.lock`
- [x] ① **Engine 1** — `zodToJsonSchema()` on top of `z.toJSONSchema()`
      ([rules](../user/conversions.md))
- [x] ② **Engine 2** — `jsonSchemaToZod()` recursive emitter
      ([rules](../user/conversions.md))
- [x] ③ **Engine 3** — `openApiToApiDocs()` — normalize v2/v3 → operation IR
      → render `directory` / `flat` trees of `index.ts` files
      ([rules](../user/conversions.md),
      [format](../user/api-docs-format.md))
- [x] ④ **Engine 4** — `apiDocsToOpenApi()` — manifest-driven reverse
      conversion to OpenAPI 3.0/3.1
      ([rules](../user/conversions.md))
- [x] 🧱 Component options — `insertComponents`, `useComponentAsReference`,
      nested references, and direct/mutual cycles ([rules](../user/components.md))
- [x] 📝 **YAML input** — owned deterministic YAML 1.2 core-schema parser,
      `.yaml`/`.yml` paths and inline YAML text, anchors/aliases/merge keys,
      stable `ZOPIA_SPEC_INVALID_YAML` ([rules](../user/conversions.md#engine-③--openapi--api-docs), D-16)
- [x] 🔗 **External `$ref`s** — same-folder references bundled inline for
      spec file paths, byte-identical to inline twins ([rules](../user/conversions.md#engine-③--openapi--api-docs), D-17)
- [x] 📦 Manifest writer/reader — `.zopia-manifest.json` (D-06)
- [x] ⚠️ **Warnings pipeline** — stable typed codes, exact JSON Pointer locations,
      deterministic collection/callbacks, generated-code markers, and CLI stderr
      reporting across engines ①–④ (R-144/R-408/D-12)
- [x] ♻️ **Manifest staleness** — canonical source/config comparison, invalid and
      incomplete-tree detection, source-located warnings, safe obsolete-artifact
      pruning, and symlink-safe regeneration (R-741…R-743)
- [x] 🔐 **Reverse security fallback** — manifest-authoritative requirements,
      validated metadata, collision-safe deterministic bearer synthesis,
      OpenAPI/Swagger representations, and operation-located warnings (R-656)
- [x] 🛑 **Typed errors** — one immutable stable-code catalogue and `ZopiaError`
      boundary across engines, manifests, generated-module imports, filesystem
      operations, warnings, and CLI validation, with locations, hints, and causes
      (R-141…R-143/R-404)
- [x] 🔁 **Round-trip contract** — fixture-backed source-dialect identity across
      Swagger 2.0 and OpenAPI 3.0/3.1, every layout/component mode, refs/cycles,
      lossy-keyword overlays, path-item metadata, and byte-identical regeneration;
      supported Zod ↔ JSON Schema pipelines converge after canonicalization
      (T-10/T-11/R-409)
- [x] ⌨️ **CLI contract** — strict `generate` / `reverse` grammar, complete option
      mapping and help, isolated stdout/stderr channels, stable exit statuses,
      trusted-tree disclosure, and direct/package execution ([usage](../user/cli.md))
- [x] 📸 **Golden generated-tree contract** — deliberate reproducible updates,
      complete byte-for-byte tree comparisons in all canonical layouts, and
      strict compilation against installed published `km-api@0.4.1`, including
      `trace`, custom/default statuses, and extension media types (R-112/R-126)
- [x] 📈 **Coverage gates** — V8 measures every source file; overall line/function
      coverage is gated at 90%, branches at 85%, conversion engines at 95% lines,
      and every source file at 80% lines, with omitted-file detection
- [x] 🟣 **Bun gate** — pinned Bun 1.2.21, frozen `bun.lock` installation,
      typecheck, Vitest, coverage, direct/package CLI smoke tests, and Bun-native
      generated-TypeScript reverse imports run through one command (T-14/D-01)
- [x] 🧪 **Vitest suite** — unit, integration, round-trip, golden-tree, JSDoc,
      CLI, and package-release contracts run in the pinned Bun gate
      ([testing](11-testing.md))
- [x] 📖 **JSDoc audit** — every exported declaration and exposed interface/class
      member has a useful summary; public callables document parameters and return
      values; optional configuration fields state defaults; examples and links are
      checked; and named-only exports are enforced by an AST contract suite (T-12,
      R-131…R-135/R-1003)
- [x] 📦 **Package/release readiness** — public npm metadata, an allowlisted
      source archive, executable CLI, isolated packed-consumer import and CLI
      smoke tests, and a mandatory prepublish gate (R-191…R-193)
- [x] 📚 **Documentation status sync** — current module/test layouts, generated
      examples, Phase 1 completion labels, and deferred boundaries agree with
      the implementation and are guarded by a documentation contract test
- [x] 📜 First versioned entry in `CHANGELOG.md` → **v0.1.0**

### ✅ Definition of done — Phase 1 (met)

The v0.1.0 release satisfies all of the following:

1. 📄 `bun run test` is green — unit + integration + round-trip suites
2. 📈 Coverage gates are met (see [Testing → Coverage gates](11-testing.md#-coverage-gates))
3. 🔁 Round-trip: for every fixture spec, `openapi(docs(spec))` equals `spec` after canonicalization
4. 🧩 All four engine docs sections are implemented exactly as specified (mapping tables are the contract)
5. 📖 Every public symbol has JSDoc; `tsc --noEmit` (strict) passes
6. 📜 `CHANGELOG.md` v0.1.0 entry exists and `README` status banner is updated
7. ✅ **km-api dependency gate** (D-15) — `km-api@0.4.1` is published and zopia
   uses `km-api: ^0.4.1` from npm; no Git submodule or unpublished commit remains.
   The dependency remains installed and type-checkable in every release gate.

## 🧰 Phase 2 — Breadth (v0.2.x) ✅

- 📝 **YAML input** — ✅ accept `swagger.yaml` / `openapi.yaml` (D-13 lifts → D-16)
- 🔗 **External `$ref`s** — ✅ resolve references to other files in the same folder (D-17)
- 🧩 **Reusable parameters & responses** — ✅ emitted as their own component
  files `components/parameters/<Name>/index.ts` and
  `components/responses/<Name>/index.ts` with `<Name>Parameter` / `<Name>Response`
  exports, kind barrels, manifest `kind` entries, and a reverse conversion that
  refreshes declarations from the modules while restoring every use-site `$ref`
  verbatim (D-18; km-api has no standalone-parameter concept, so modules hold the
  derived schema only — name/location/`required` remain operation data)
- 🧾 **`zopia.config.ts`** — ✅ project-level config file with working-directory
  discovery, explicit `--config` paths, validated `{ generate, reverse }` defaults,
  and stable precedence CLI flag > config value > built-in default (D-19);
  CLI flags stay available
- 📤 **OpenAPI 2.0 output** — ✅ engine ④ accepts `version: '2.0'` (CLI
  `--version 2.0`, config `reverse.version`) and downgrades 3.x-sourced
  manifests into Swagger 2.0 documents: `nullable` becomes `x-nullable`,
  `requestBody` becomes `body`/`formData` parameters, `components` becomes
  top-level `definitions`/`parameters`/`responses`, `servers` decomposes into
  `host`/`basePath`/`schemes`, and unrepresentable 3.x features (webhooks,
  `jsonSchemaDialect`, cookie params, `links`, multi-flow OAuth2, …) drop with
  deterministic `ZOPIA_WARN_DIALECT_DOWNGRADE` warnings (D-20)
- 🧪 **More JSON Schema keywords** — ✅ `propertyNames` graduates from the D-12
  approximation to native conversion: the exact
  `{ type: 'object', propertyNames: { type: 'string', <pattern/length constraints> }, additionalProperties: <schema> }`
  form now converts to `z.record(key, value)` (and back) with no warning or
  frozen overlay (D-22); every other listed keyword keeps its runtime-refinement
  + frozen-overlay round-trip (`patternProperties`, `if/then/else`,
  `minProperties/maxProperties`, non-native `propertyNames` forms, `contains`) (Phase 1: documented approximation + warning, D-12)
- 🪝 **3.1 webhook endpoint generation** — ✅ `document.webhooks` operations now
  generate real endpoint files under `webhooks/<name>/<method>/index.ts`
  alongside path operations (D-23). The manifest records `webhooks[]` entries
  with the same reference/overlay/security metadata as path endpoints plus
  `webhookOrder` and a `webhooksOverlay` (item-level metadata, `x-` names, and
  operation-less items stay verbatim), so engine ④ reassembles webhooks in exact
  source order for 3.1 output and omits them with source-located
  `ZOPIA_WARN_WEBHOOKS` warnings for 3.0/2.0 output. Operation-less webhook maps
  keep the Phase 1 manifest-only behavior (no endpoint files, forward warning)
- 👀 **Watch mode** — ✅ `zopia generate --watch` regenerates whenever the spec
  file changes (S-88): an immediate initial run, 50 ms-coalesced re-runs that
  serialize against in-flight generation, run errors printed to stderr while
  watching continues, and abort/cleanup on exit. Uses `fs.watch` with the
  existing stale-tree/prune pipeline, so spec edits refresh owned files in place

## 🌌 Phase 3 — Ecosystem (v0.3+) ✅

- 🧹 **`zopia validate`** — ✅ CLI command + `validateZopia()` API lint specs
  and generated trees (S-89): specs are checked for dialect validity, broken
  local `$ref`s, endpoint-planning failures (name collisions, cross-namespace
  duplicate operationIds), and components unreachable from any operation
  (transitive; Swagger `definitions` included). Generated trees are checked for
  manifest presence/validity, a successful reverse dry-run, and km-api peer
  drift. Findings are deterministic sorted diagnostics with stable
  `ZOPIA_VALIDATE_*` lint codes; the CLI prints them on stdout and exits `1`
  when any error-severity finding exists
- ♻️ **Incremental regeneration** — ✅ unchanged generated files keep their
  mtimes (byte-identical regeneration writes nothing); the opt-in merge-safe
  custom layer (D-24, S-90) exports a `custom` companion namespace per
  endpoint/webhook scaffolded once and never overwritten (`--custom`,
  `generate.custom`, or the `custom` generate option)
- 🔍 **Diff tool** — ✅ `zopia diff old.json new.json` + `diffOpenApiSpecs()`
  API (S-91): semantic comparison of dialect, info, endpoints (with
  parameter/request-body/response details), webhooks, schema components,
  document fields, and `x-` extensions; key order is ignored; deterministic
  `+`/`-`/`~` human-readable lines with a summary; differences are data on
  stdout, so the CLI exits `0` for changed pairs
- 🧩 **Presets** — ✅ split-generation layouts (S-92): `--preset multi-tag`
  routes each operation by its primary tag, `--preset multi-server` by the
  effective first server (repeatedly), producing one independently
  reverse-convertible api-docs sub-tree per bucket; untagged/default-server
  operations land in `untagged`/`https-default-server`-style buckets; nothing
  to split → the normal single tree. Programmatic `preset` option plus
  `generate.preset` configuration; `planPresetBuckets()` exposes the pure
  deterministic planner (collision-safe slugs, `ZOPIA_WARN_PRESET_PRIMARY_TAG`
  on multi-tagged operations) and results report `trees[]`
- 🧑‍💻 **VS Code extension** — ✅ navigate spec ↔ generated code both ways
  (S-93): manifest-driven navigation core (`loadNavigationIndex`,
  `specToLocations`/`treeToSpecLocation`, one-pass JSON
  `specPointersToLines`/`specPointerAtLine` cursor resolution, YAML
  operationId fallback) plus the `zopia navigate` CLI (`--to-code` /
  `--to-spec`) and a plain-JS extension package under `editors/vscode/`
  resolving the workspace's own zopia install

## 📘 Phase 4 — Documentation & website (v0.7) 🚧

The audience split and a first-class documentation site. Contracts:
[Documentation split plan](13-documentation-split.md) ·
[Website plan](14-website.md). Targets **W-1 … W-8**.

- [x] ✂️ **Audience split** — `docs/user/` (packed with npm, powers the site)
      and `docs/development/` (repository-only); maps in `README.md` and
      `docs/README.md`; the npm allowlist packs `docs/user/**`
- [x] 📘 **User documentation set** — installation, quick start, CLI reference,
      programmatic API, configuration, conversions, output format, components,
      runtime, errors & warnings, concepts
- [x] 🔍 **Coverage audit (M2)** — every exported symbol, CLI command/flag,
      config key, error code, and warning code is documented with its type,
      default, and effect, **enforced** by `tests/contract/user-docs-coverage.test.ts`;
      user pages are free of internal planning vocabulary (R-202/R-204, also
      enforced). Automated compilation of the `ts` samples remains open
- [x] 🧱 **Site skeleton (M3)** — VitePress project in `website/`
      (`base: '/zopia/'`, local search, edit links), the `sync-content.mjs`
      pipeline that renders `docs/user/` + `CHANGELOG.md` into the site, and
      `npm run dev` / `npm run build` with the dead-link gate enabled
- [x] 🎨 **Design pass (M4)** — landing page, brand layer, install tabs, dark
      mode, responsive layout, plus `npm run audit`: a deterministic quality
      gate over the built site (base path, unique metadata, `<html lang>`,
      heading order, image alt text, resolvable links, informative link text,
      HTML/asset budgets). Lighthouse itself needs a browser, so it stays a
      manual check against the deployed site
- [ ] 🚀 **CI deploy (M5)** — the docs workflow (template
      `docs/development/docs-workflow.yml.example`, copied to
      `.github/workflows/docs.yml` by a maintainer) builds here and
      publishes the built site into the public `komeilm76/komeilm76.github.io`
      repository under `/zopia/` (D-26); it needs that repository to exist with
      Pages enabled and a `PAGES_DEPLOY_TOKEN` secret
- [x] 🔖 **Versioned docs (M6)** — `latest` plus the previous two minors
      (R-211…R-215): `website/scripts/snapshot-version.mjs` freezes a released
      tag into `website/versions/<vX.Y>/`, prunes older snapshots, and maps
      pre-split page names onto today's routes; the switcher and per-version
      sidebars are generated; every snapshot page carries an
      outdated-version banner. **v0.5 and v0.4 are already published** from
      their release tags
- [ ] 🔁 **Release integration (M7)** — the docs workflow snapshots the
      previous minor on a published release, commits it, rebuilds, audits, and
      publishes, independently of `publish.yml` (R-221…R-224). Verified on the
      next real release

> ✅ **Hosting decided (D-26)** — the site is published from the **public**
> `komeilm76/komeilm76.github.io` repository under `/zopia/`, so
> `komeilm76/zopia` can become private without taking the documentation
> offline. Two prerequisites before flipping visibility: create that public
> repository with Pages enabled, and add the `PAGES_DEPLOY_TOKEN` secret here.
> See [Website plan → Deployment topology](14-website.md#-deployment-topology-d-26).

## 🧮 Versioning

SemVer, strictly:

| 🔖 Bump | When |
| --- | --- |
| `MAJOR` | A generated-file format or manifest format breaks (`zopia:manifest@1` → `@2`) |
| `MINOR` | New option, new engine feature, new CLI flag — backward compatible |
| `PATCH` | Bug fixes, doc corrections, mapping-table clarifications |

## 🔗 Next

- 🎯 The exact list of what Phase 1 builds → [Targets](02-targets.md)
- 🏗️ How the pieces fit → [Architecture](04-architecture.md)
