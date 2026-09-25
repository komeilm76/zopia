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

- [ ] ⚙️ Package scaffold — `package.json` (Bun-first, zero runtime deps,
      `zod` peer + `km-api ^0.4.1` from npm — D-15), strict
      `tsconfig`, Vitest + Bun setup
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
- [ ] ⌨️ CLI — `zopia generate` / `zopia reverse` ([usage](10-usage.md#-cli))
- [ ] 🧪 Vitest suite — full scenario matrix, golden files, round-trip
      property tests ([testing](11-testing.md))
- [ ] 📖 JSDoc on every public symbol (T-12)
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
