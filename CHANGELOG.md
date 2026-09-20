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

- 🔑 Recorded the first architecture decisions (**D-01 … D-13**) in
  [docs/12-standards.md → Key decisions](docs/12-standards.md#-key-decisions).

### 🐛 Fixed

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
