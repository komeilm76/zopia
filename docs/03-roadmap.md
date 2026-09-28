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
      ([rules](06-conversions.md))
- [x] ② **Engine 2** — `jsonSchemaToZod()` recursive emitter
      ([rules](06-conversions.md))
- [x] ③ **Engine 3** — `openApiToApiDocs()` — normalize v2/v3 → operation IR
      → render `directory` / `flat` trees of `index.ts` files
      ([rules](06-conversions.md),
      [format](07-api-docs.md))
- [x] ④ **Engine 4** — `apiDocsToOpenApi()` — manifest-driven reverse
      conversion to OpenAPI 3.0/3.1
      ([rules](06-conversions.md))
- [x] 🧱 Component options — `insertComponents`, `useComponentAsReference`,
      nested references, and direct/mutual cycles ([rules](08-components.md))
- [x] 📝 **YAML input** — owned deterministic YAML 1.2 core-schema parser,
      `.yaml`/`.yml` paths and inline YAML text, anchors/aliases/merge keys,
      stable `ZOPIA_SPEC_INVALID_YAML` ([rules](06-conversions.md#engine-③--openapi--api-docs), D-16)
- [x] 🔗 **External `$ref`s** — same-folder references bundled inline for
      spec file paths, byte-identical to inline twins ([rules](06-conversions.md#engine-③--openapi--api-docs), D-17)
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
      trusted-tree disclosure, and direct/package execution ([usage](10-usage.md#-cli))
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

## 🧰 Phase 2 — Breadth (v0.2.x)

- 📝 **YAML input** — ✅ accept `swagger.yaml` / `openapi.yaml` (D-13 lifts → D-16)
- 🔗 **External `$ref`s** — ✅ resolve references to other files in the same folder (D-17)
- 🧩 **Reusable parameters & responses** — emitted as their own component files
  (v0.1.0 resolves them for endpoint code and preserves/restores their reusable
  declarations through the manifest; km-api has no standalone-parameter concept)
- 🧾 **`zopia.config.ts`** — project-level config file (CLI flags stay available)
- 📤 **OpenAPI 2.0 output** from engine ④ (`version: '2.0'`) for legacy targets
- 🧪 More JSON Schema keywords — `patternProperties`, `if/then/else`,
  `minProperties/maxProperties`, `propertyNames`, `contains`
  (Phase 1: documented approximation + warning, D-12)
- 🪝 **3.1 webhook endpoint generation** — v0.1.0 preserves webhooks in the
  manifest and restores them for 3.1 output with `ZOPIA_WARN_WEBHOOKS`, but does
  not generate endpoint files for them (valid local path-item `$ref`s already
  resolve and round-trip in v0.1.0)
- 👀 **Watch mode** — `zopia generate --watch` for spec-driven development

## 🌌 Phase 3 — Ecosystem (v0.3+)

- 🧹 **`zopia validate`** — lint/validate specs and generated trees (broken
  refs, name collisions, unreachable components, km-api version drift)
- ♻️ **Incremental regeneration** — only re-emit files whose inputs changed;
  merge-safe custom layer for manual edits (a `custom` companion file per endpoint)
- 🔍 **Diff tool** — `zopia diff old.json new.json` → human-readable changes
- 🧩 **Presets** — monorepo / multi-server / multi-tag layouts
- 🧑‍💻 **VS Code extension** — navigate spec ↔ generated code both ways

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
