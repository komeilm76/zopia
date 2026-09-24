<div align="center">

# 🧬 zopia

**Type-safe OpenAPI ↔ Zod toolkit** for generating, validating, and transforming API schemas.

`Swagger 2.0` · `OpenAPI 3.x` · `JSON Schema` · `Zod v4` · `km-api`

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%2B-blue.svg)](https://www.typescriptlang.org/)
[![Zod](https://img.shields.io/badge/Zod-4.x-purple.svg)](https://zod.dev/)
[![km-api](https://img.shields.io/badge/km--api-0.4.x-0ea5e9.svg)](https://www.npmjs.com/package/km-api)
[![Runtime](https://img.shields.io/badge/Runtime-Bun%201.x-black.svg)](https://bun.sh/)
[![Tests](https://img.shields.io/badge/Tests-vitest-10b981.svg)](https://vitest.dev/)

🚧 **Status — Phase 0 complete (documentation & standards) · Phase 1 implementation in progress**

</div>

---

## ✨ What is zopia?

**zopia** turns the documents your API already has — `swagger.json` / OpenAPI
files — into **type-safe, ready-to-use endpoint code**, and turns that code back
into a spec. It is the bridge between four formats an API team lives in:

```text
┌─────────────┐  ③ openapi → api docs  ┌───────────────────┐
│ swagger.json│───────────────────────▶│ api_docs/**       │
│ (v2 / v3)   │◀───────────────────────│ .ts · km-api · zod│
└─────────────┘  ④ api docs → openapi  └───────────────────┘

┌────────┐  ① zod → JSON Schema   ┌────────────┐
│ Zod v4 │───────────────────────▶│ JSON Schema│
│ schemas│◀───────────────────────│            │
└────────┘  ② JSON Schema → zod   └────────────┘
```

Developers stop hand-writing validation, schemas, and documentation. zopia
generates **valid, documented, type-safe** artifacts in seconds — and every
artifact can be converted back, so nothing is ever lost.

## 🎯 Why zopia?

| 💸 Pain today | 🛠️ What zopia does |
| --- | --- |
| The spec and the code drift apart | Code is **generated from** the spec — or the spec is **regenerated from** the code |
| Hand-written validation is slow and error-prone | **Zod v4** schemas produced from JSON Schema keywords, losslessly |
| Reused components are copy-pasted everywhere | `$ref` graphs (component → component) resolved into clean imports |
| Swagger 2.0 ↔ OpenAPI 3.x differences are confusing | One internal model normalizes **both** dialects |

## 🚀 Features

- 🔄 **Four conversion engines**
  1. `zod → JSON Schema` — powered by Zod v4's built-in `z.toJSONSchema()`
  2. `JSON Schema → zod` — custom emitter producing idiomatic, readable Zod v4 code
  3. `OpenAPI → api docs` — Swagger 2.0 & OpenAPI 3.0/3.1 → tree of `.ts` endpoint files
  4. `api docs → OpenAPI` — regenerate a full spec from the generated tree (lossless)
- 📖 **Dual spec support** — `swagger: "2.0"` and `openapi: "3.0.x" / "3.1.x"`
- 🧱 **`$ref` resolution** — nested component references and circular schemas (via `z.lazy()`)
- 📂 **Two output layouts** — `directory` (path → nested folders) and `flat` (one folder per endpoint)
- 🧩 **Component options** — `insertComponents` is implemented; `useComponentAsReference` is reserved and fails explicitly until endpoint imports are implemented
- ⚡ **km-api native** — every `index.ts` builds its endpoint with `makeApiConfig()` from `km-api` (0.4.x)
- 🔒 **Lossless round-trips** — a hidden manifest (`.zopia-manifest.json`) keeps every conversion reversible
- 🧪 **Tested by design** — Vitest suite covering the full scenario matrix, run with Bun
- 📖 **100% JSDoc** — every public symbol is documented; every decision is recorded

## 📖 Quick look

> The public API below is the **Phase 1 contract** — it is fixed now, implemented in
> the next phase, and covered by tests. See [docs/10-usage.md](docs/10-usage.md).

```ts
import {
  zodToJsonSchema,   // ①  Zod v4 → JSON Schema
  jsonSchemaToZod,   // ②  JSON Schema → Zod v4 (code + runtime schema)
  openApiToApiDocs,  // ③  swagger.json / openapi.json → api_docs/**
  apiDocsToOpenApi,  // ④  api_docs/** → openapi.json
} from 'zopia';

// ③ Generate a tree of type-safe endpoint files from any spec
await openApiToApiDocs('swagger.json', {
  mode: 'directory',               // 'directory' (default) | 'flat'
  insertComponents: false,         // emit components/**          (default false)
  useComponentAsReference: false,  // reserved until endpoint imports are implemented
});
// └─ api_docs/admin/users/{id}/get/index.ts  →  makeApiConfig({ method: 'GET', pathShape: '/admin/users/{id}', … })

// ④ Convert the tree back into a spec
const { openapi } = await apiDocsToOpenApi('api_docs', { version: '3.1' });
```

## 📚 Documentation

Everything about the project — targets, architecture, conversion rules,
output format, configuration, testing, standards — lives in [`docs/`](docs/).

| 📄 Document | Contents |
| --- | --- |
| 🧭 [Overview](docs/01-overview.md) | What zopia is, the problem it solves, principles, non-goals |
| 🎯 [Targets](docs/02-targets.md) | The explicit, testable targets of this project |
| 🗺️ [Roadmap](docs/03-roadmap.md) | Phases, milestones, definition of done |
| 🏗️ [Architecture](docs/04-architecture.md) | Modules, pipeline, internal model, error model, safety |
| 🧩 [Concepts](docs/05-concepts.md) | Glossary — Swagger 2.0, OpenAPI 3.x, JSON Schema, `$ref`, Zod v4, km-api |
| 🔄 [Conversions](docs/06-conversions.md) | The four engines: algorithms, mapping tables, edge cases |
| 📄 [API docs format](docs/07-api-docs.md) | `directory` & `flat` layouts, `index.ts` contract, manifest |
| 🧱 [Components](docs/08-components.md) | `insertComponents` / `useComponentAsReference`, `$ref` graphs |
| ⚙️ [Configuration](docs/09-configuration.md) | Full option reference, defaults, validation rules |
| 🚀 [Usage](docs/10-usage.md) | Installation, programmatic API, CLI, end-to-end example |
| 🧪 [Testing](docs/11-testing.md) | Vitest strategy, scenario matrix, fixtures, coverage gates |
| 📏 [Standards](docs/12-standards.md) | Code, JSDoc, commits, changelog, releases, key decisions |

## 🏗️ Project structure

```text
zopia/
├── README.md                 # 🏠 This file
├── CHANGELOG.md              # 📜 Keep-a-Changelog history
├── LICENSE                   # 🔐 MIT
├── package.json              # 📦 npm dependency on km-api ^0.4.1
├── docs/                     # 📚 Project documentation (the standard)
│   ├── README.md             #    📖 Documentation map
│   ├── 01-overview.md        #    🧭 Overview
│   ├── 02-targets.md         #    🎯 Targets
│   ├── 03-roadmap.md         #    🗺️ Roadmap
│   ├── 04-architecture.md    #    🏗️ Architecture
│   ├── 05-concepts.md        #    🧩 Concepts & glossary
│   ├── 06-conversions.md     #    🔄 Conversion engines
│   ├── 07-api-docs.md        #    📄 API docs format
│   ├── 08-components.md      #    🧱 Components
│   ├── 09-configuration.md   #    ⚙️ Configuration
│   ├── 10-usage.md           #    🚀 Usage
│   ├── 11-testing.md         #    🧪 Testing
│   └── 12-standards.md       #    📏 Engineering standards
├── src/                      # ⚙️ Package source (Phase 1 implementation)
└── tests/                    # 🧪 Integration & round-trip suites (Phase 1 implementation)
```

## 🧪 Development

zopia is a **Bun-first** project (see [docs/12-standards.md](docs/12-standards.md)):

```bash
bun install        # 📦 install dependencies
bun run typecheck  # ✅ strict TypeScript
bun run test       # 🧪 vitest (all scenarios)
bun run coverage   # 📈 coverage report
```

> 🚧 The scripts above land with the Phase 1 implementation; the commands are
> already fixed by the standards so tooling is never re-decided.

## 🤝 Contributing

Read [docs/12-standards.md](docs/12-standards.md) first — it defines code style,
JSDoc rules, the commit convention, and the changelog rule. Every feature ships
**with** its documentation in the same commit.

## 📄 License

Released under the [MIT License](LICENSE) — the same standard as the rest of
the `km-*` package family.
