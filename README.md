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

✅ **Status — Phase 3 complete · v0.6.0 released**

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
- 🧩 **Component options** — `insertComponents` and recursive endpoint component-reference imports are implemented; direct and mutual cyclic imports use lazy schemas
- ⚡ **km-api native** — every `index.ts` builds its endpoint with `makeApiConfig()` from `km-api` (0.4.x)
- 🔒 **Lossless round-trips** — a hidden manifest (`.zopia-manifest.json`) keeps every conversion reversible
- 🧪 **Tested by design** — pinned Vitest 4.1.11 suite covering the full identified scenario matrix, run with Bun
- 📖 **100% JSDoc** — every public symbol and callable shape is contract-audited; every decision is recorded

## 📖 Quick look

> The public API below is the **Phase 1 contract** and is covered by tests.
> See [docs/user/](docs/user/index.md).

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
  useComponentAsReference: false,  // import emitted components (default false)
});
// └─ one <path>/<method>/index.ts per operation + .zopia-manifest.json

// ④ Convert the tree back into a spec
const { openapi } = await apiDocsToOpenApi('api_docs', { version: '3.1' });
```

### 🌳 Consuming the tree at runtime

When wiring endpoints dynamically beats importing generated files one by one,
import the opt-in runtime subpath and point it at any directory zopia ever
generated into (`directory`, `flat`, and `multi-tag` / `multi-server` splits
all resolve through their manifests):

```ts
import { createApiDocs, flattenApiDocs } from 'zopia/runtime';
import type { ApiDocsFlat, ApiDocsTree } from './api_docs/.zopia-tree';

// Nested: URL path segments → lowercase method → the makeApiConfig object
const apiDocs = await createApiDocs<ApiDocsTree>('api_docs');
const getUser = apiDocs.users['{userId}'].get;   // default export of that index.ts

// Flat freebie: keyed by operationId, same leaf objects, deterministic order
const endpoints = flattenApiDocs<ApiDocsFlat>(apiDocs);
endpoints.getUser === getUser;                    // → true
```

Every generated tree also ships a types-only `.zopia-tree.d.ts` — pass its
types as shown and IntelliSense becomes **exact**: keys autocomplete, and
misspelled segments, methods, or endpoint names are compile errors.

Generation output is untouched — the resolver only reads manifests and imports
modules. See [API docs format → Runtime tree consumption](docs/user/api-docs-format.md#-runtime-tree-consumption--createapidocs).

## 📚 Documentation

📖 **Full documentation website → [komeilm76.github.io/zopia](https://komeilm76.github.io/zopia/)**

The documentation is split by audience:

- 📘 **User documentation** — [`docs/user/`](docs/user/index.md) — ships inside
  the npm package and powers the website
- 🛠️ **Development documentation** — [`docs/development/`](https://github.com/komeilm76/zopia/tree/main/docs/development)
  — repository-only: targets, roadmap, architecture, testing, standards

**📦 User guides (packed with npm, relative links in `docs/user/`):**

| 📄 Document | Contents |
| --- | --- |
| 📦 [Installation](docs/user/installation.md) | Requirements, peers, package managers, TypeScript setup |
| ⚡ [Quick start](docs/user/quick-start.md) | Generate, consume, reverse, validate — in five minutes |
| ⌨️ [CLI reference](docs/user/cli.md) | Every command, flag, default, exit code |
| 🧑‍💻 [Programmatic API](docs/user/programmatic-api.md) | Every exported function and result shape |
| ⚙️ [Configuration](docs/user/configuration.md) | Full option reference, defaults, validation rules |
| 🔄 [Conversions](docs/user/conversions.md) | The four engines: algorithms, mapping tables, edge cases |
| 📄 [API docs format](docs/user/api-docs-format.md) | `directory` & `flat` layouts, `index.ts` contract, manifest |
| 🧱 [Components](docs/user/components.md) | `insertComponents` / `useComponentAsReference`, `$ref` graphs |
| 🌳 [Runtime](docs/user/runtime.md) | `createApiDocs()` / `flattenApiDocs()` |
| 🧯 [Errors & warnings](docs/user/errors-and-warnings.md) | Every stable code, cause, and fix |
| 🧩 [Concepts](docs/user/concepts.md) | Glossary — Swagger 2.0, OpenAPI 3.x, JSON Schema, Zod v4, km-api |

**🐙 GitHub-only (development docs, not packed):**

| 📄 Document | Contents |
| --- | --- |
| 🧭 [Overview](https://github.com/komeilm76/zopia/blob/main/docs/development/01-overview.md) | What zopia is, the problem it solves, principles, non-goals |
| 🎯 [Targets](https://github.com/komeilm76/zopia/blob/main/docs/development/02-targets.md) | The explicit, testable targets of this project |
| 🗺️ [Roadmap](https://github.com/komeilm76/zopia/blob/main/docs/development/03-roadmap.md) | Phases, milestones, definition of done |
| 🏗️ [Architecture](https://github.com/komeilm76/zopia/blob/main/docs/development/04-architecture.md) | Modules, pipeline, internal model, error model, safety |
| 🧪 [Testing](https://github.com/komeilm76/zopia/blob/main/docs/development/11-testing.md) | Vitest strategy, scenario matrix, fixtures, coverage gates |
| 📏 [Standards](https://github.com/komeilm76/zopia/blob/main/docs/development/12-standards.md) | Code, JSDoc, commits, changelog, releases, key decisions |
| ✂️ [Documentation split](https://github.com/komeilm76/zopia/blob/main/docs/development/13-documentation-split.md) | The user/development boundary and where a new page belongs |
| 🌐 [Website plan](https://github.com/komeilm76/zopia/blob/main/docs/development/14-website.md) | Documentation website targets, IA, versioning, release flow |
| 🛠️ [Website setup](https://github.com/komeilm76/zopia/blob/main/docs/development/15-website-setup.md) | One-time setup: site repository, deploy token, workflow activation |

## 🏗️ Project structure

```text
zopia/
├── README.md                 # 🏠 This file
├── CHANGELOG.md              # 📜 Keep-a-Changelog history
├── LICENSE                   # 🔐 MIT
├── package.json              # 📦 npm dependency on km-api ^0.4.1
├── docs/                     # 📚 Project documentation
│   ├── README.md             #    📖 Documentation map
│   ├── user/                 #    📘 User docs (packed with npm + website source)
│   │   ├── index.md          #       📘 User docs home
│   │   ├── installation.md   #       📦 Installation
│   │   ├── quick-start.md    #       ⚡ Quick start
│   │   ├── cli.md            #       ⌨️ CLI reference
│   │   ├── programmatic-api.md #     🧑‍💻 Programmatic API
│   │   ├── configuration.md  #       ⚙️ Configuration
│   │   ├── conversions.md    #       🔄 Conversion engines
│   │   ├── api-docs-format.md #      📄 API docs format
│   │   ├── components.md     #       🧱 Components
│   │   ├── runtime.md        #       🌳 Runtime tree loading
│   │   ├── errors-and-warnings.md #  🧯 Errors & warnings
│   │   └── concepts.md       #       🧩 Concepts & glossary
│   └── development/          #    🛠️ Development docs (repository-only)
│       ├── 01-overview.md    #       🧭 Overview
│       ├── 02-targets.md     #       🎯 Targets
│       ├── 03-roadmap.md     #       🗺️ Roadmap
│       ├── 04-architecture.md #      🏗️ Architecture
│       ├── 11-testing.md     #       🧪 Testing
│       ├── 12-standards.md   #       📏 Engineering standards
│       ├── 13-documentation-split.md # ✂️ Documentation split plan
│       ├── 14-website.md     #       🌐 Website plan
│       └── 15-website-setup.md #     🛠️ One-time website setup
├── website/                  # 🌐 VitePress documentation site
├── src/                      # ⚙️ Published package source
└── tests/                    # 🧪 Unit, integration, contract & round-trip suites
```

## 🌐 Documentation website

The site at **<https://komeilm76.github.io/zopia/>** is built from
[`docs/user/`](docs/user/index.md) with [VitePress](https://vitepress.dev) and
lives in [`website/`](website). CI publishes the built output into the public
`komeilm76/komeilm76.github.io` repository under `/zopia/`, so this repository
can stay private (D-26).

```bash
cd website
npm install
npm run dev              # 🔁 sync docs/user/ (watched) + dev server
npm run check            # 🏗️ production build + quality audit (what CI runs)
npm run snapshot -- v0.6 # 🔖 freeze a released version for the switcher
npm run preview          # 👀 serve the production build
```

The site serves the latest release at the root and keeps the previous two
minors under `/v0.5/`, `/v0.4/` — snapshots live in `website/versions/` and the
switcher, sidebars, and outdated-version banners are generated from them.

> 📌 Prose is **never** hand-edited inside `website/` — edit `docs/user/` and
> the sync script regenerates the site content
> ([plan](https://github.com/komeilm76/zopia/blob/main/docs/development/14-website.md)).

## 🧪 Development

zopia is a **Bun-first** project (see [docs/12-standards.md](https://github.com/komeilm76/zopia/blob/main/docs/development/12-standards.md)):

```bash
bun install --frozen-lockfile # 📦 reproducible install from bun.lock
bun run typecheck             # ✅ strict TypeScript
bun run test                  # 🧪 vitest (all scenarios)
bun run coverage              # 📈 enforced coverage report
bun run package:check         # 📦 pack, install, import, and run the npm artifact
bun run release:check         # 🚢 complete pinned-Bun prepublish gate
```

> ✅ `bun run release:check` is the CI-equivalent prepublish check: it verifies
> the pinned Bun version and frozen lockfile, then runs TypeScript, Vitest,
> coverage, direct CLI generation/reverse smoke tests, and an isolated install
> of the exact npm archive with packed-library and packed-CLI smoke tests.

## 🤝 Contributing

Read [docs/12-standards.md](https://github.com/komeilm76/zopia/blob/main/docs/development/12-standards.md) first — it defines code style,
JSDoc rules, the commit convention, and the changelog rule. Every feature ships
**with** its documentation in the same commit.

## 📄 License

Released under the [MIT License](LICENSE) — the same standard as the rest of
the `km-*` package family.
