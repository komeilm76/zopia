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

**Done when:** a new contributor can read only `docs/` and implement Phase 1
without asking questions. ✅ *That bar is the acceptance test of this phase.*

## 🚀 Phase 1 — The four engines (v0.1.0)

Everything in [Targets](02-targets.md) marked ✅ 🚧:

- [x] ⚙️ Package scaffold — ESM `package.json` (Bun-first, zero runtime deps,
      `zod` peer + `km-api ^0.4.1` from npm — D-15), strict `tsconfig`,
      Vitest/V8, pinned Bun, and checked-in `bun.lock`
- [x] ① **Engine 1** — `zodToJsonSchema()` on top of `z.toJSONSchema()`
      ([rules](06-conversions.md))
- [x] ② **Engine 2** — `jsonSchemaToZod()` recursive emitter
      ([rules](06-conversions.md))
- [x] ③ **Engine 3** — `openApiToApiDocs()` — normalize v2/v3 → internal model
      → render `directory` / `flat` trees of `index.ts` files
      ([rules](06-conversions.md),
      [format](07-api-docs.md))
- [ ] ④ **Engine 4** — `apiDocsToOpenApi()` — manifest-driven reverse
      conversion to OpenAPI 3.0/3.1
      ([rules](06-conversions.md))
- [ ] 🧱 Component options — `insertComponents`, `useComponentAsReference`
      ([rules](08-components.md))
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
- [ ] 🧪 Vitest suite — remaining full scenario matrix and other contract suites
      (round-trip properties, golden trees, and coverage gates are complete;
      [testing](11-testing.md))
- [x] 📖 **JSDoc audit** — every exported declaration and exposed interface/class
      member has a useful summary; public callables document parameters and return
      values; optional configuration fields state defaults; examples and links are
      checked; and named-only exports are enforced by an AST contract suite (T-12,
      R-131…R-135/R-1003)
- [ ] 📜 First versioned entry in `CHANGELOG.md` → **v0.1.0**

### ✅ Definition of done — Phase 1

A Phase 1 release is complete when **all** of the following hold:

1. 📄 `bun run test` is green — unit + integration + round-trip suites
2. 📈 Coverage gates are met (see [Testing → Coverage gates](11-testing.md#-coverage-gates))
3. 🔁 Round-trip: for every fixture spec, `openapi(docs(spec))` equals `spec` after canonicalization
4. 🧩 All four engine docs sections are implemented exactly as specified (mapping tables are the contract)
5. 📖 Every public symbol has JSDoc; `tsc --noEmit` (strict) passes
6. 📜 `CHANGELOG.md` v0.1.0 entry exists and `README` status banner is updated
7. ✅ **km-api dependency gate** (D-15) — `km-api@0.4.1` is published and zopia
   uses `km-api: ^0.4.1` from npm; no Git submodule or unpublished commit remains.
   The dependency must remain installed and type-checkable throughout Phase 1.

## 🧰 Phase 2 — Breadth (v0.2.x)

- 📝 **YAML input** — accept `swagger.yaml` / `openapi.yaml` (D-13 lifts)
- 🔗 **External `$ref`s** — resolve references to other files in the same folder
- 🧩 **Reusable parameters & responses** — emitted as their own component files
  (Phase 1 inlines them at every use site; km-api has no
  standalone-parameter concept — a Phase 2 design decision)
- 🧾 **`zopia.config.ts`** — project-level config file (CLI flags stay available)
- 📤 **OpenAPI 2.0 output** from engine ④ (`version: '2.0'`) for legacy targets
- 🧪 More JSON Schema keywords — `patternProperties`, `if/then/else`,
  `minProperties/maxProperties`, `propertyNames`, `contains`
  (Phase 1: documented approximation + warning, D-12)
- 🪝 3.1 `webhooks` support and path-item `$ref` (Phase 1: warning / typed error)
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
