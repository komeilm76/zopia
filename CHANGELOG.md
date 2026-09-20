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

### 🚧 Planned (Phase 1 implementation)

- 🔄 Conversion engines: `zod → JSON Schema`, `JSON Schema → zod`,
  `OpenAPI → api docs`, `api docs → OpenAPI`.
- 📂 `directory` and `flat` api-docs layouts, `.ts` index files built with
  `makeApiConfig()` from `km-api`.
- 🧱 `insertComponents` and `useComponentAsReference` options.
- 🧪 Vitest suite covering the full scenario matrix.
