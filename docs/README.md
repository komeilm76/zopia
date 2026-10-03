# 📖 zopia — Documentation

The zopia documentation is split into **two audiences**. Pick yours.

| 👤 Audience | 📂 Directory | 📝 What it is |
| --- | --- | --- |
| 🧑‍💻 **Users of the package** | [`user/`](user/index.md) | How to install, configure, and use zopia — ships inside the npm package and powers the [documentation website](https://komeilm76.github.io/zopia/) |
| 🛠️ **Maintainers, contributors, agents** | [`development/`](development/) | How zopia is designed, built, tested, released, and what ships next — repository-only |

> 📌 **Rule** — behaviour and documentation change together. If a commit changes
> what zopia does, the matching document changes in the **same** commit. See
> [Standards → Docs convention](development/12-standards.md#-docs-convention).

## 📘 User documentation — [`user/`](user/index.md)

| 📄 Document | Read it when… |
| --- | --- |
| 📦 [Installation](user/installation.md) | You are adding zopia to a project |
| ⚡ [Quick start](user/quick-start.md) | You want a working result in five minutes |
| ⌨️ [CLI reference](user/cli.md) | You run zopia from the terminal or CI |
| 🧑‍💻 [Programmatic API](user/programmatic-api.md) | You call zopia from TypeScript |
| ⚙️ [Configuration](user/configuration.md) | You need every option, default, and effect |
| 🔄 [Conversions](user/conversions.md) | You need the exact mapping rules of the four engines |
| 📂 [API docs format](user/api-docs-format.md) | You need the output contract — layouts, `index.ts`, manifest |
| 🧱 [Components](user/components.md) | You work with `$ref`s and the component options |
| 🌳 [Runtime](user/runtime.md) | You load a generated tree with `zopia/runtime` |
| 🧯 [Errors & warnings](user/errors-and-warnings.md) | A diagnostic code needs explaining |
| 🧩 [Concepts](user/concepts.md) | You need the glossary — Swagger 2.0, OpenAPI 3.x, JSON Schema, `$ref`, Zod v4, km-api |

## 🛠️ Development documentation — [`development/`](development/)

| # | 📄 Document | Read it when… |
| --- | --- | --- |
| 1 | 🧭 [Overview](development/01-overview.md) | You want to know **what** zopia is and **why** it exists |
| 2 | 🎯 [Targets](development/02-targets.md) | You want the **explicit, testable goals** of the project |
| 3 | 🗺️ [Roadmap](development/03-roadmap.md) | You want to know **what ships in which phase** |
| 4 | 🏗️ [Architecture](development/04-architecture.md) | You are **maintaining or extending** modules, pipelines, representations, errors |
| 11 | 🧪 [Testing](development/11-testing.md) | You are **writing tests** — scenario matrix, fixtures, coverage gates |
| 12 | 📏 [Standards](development/12-standards.md) | You need code, JSDoc, commit, changelog, and release conventions |
| 13 | ✂️ [Documentation split plan](development/13-documentation-split.md) | You need the user/development boundary and where a new page belongs |
| 14 | 🌐 [Website plan](development/14-website.md) | You are building or releasing the documentation website |
| 15 | 🛠️ [Website setup](development/15-website-setup.md) | You are doing the **one-time** GitHub setup: site repository, deploy token, workflow |

## 📦 What ships where

| 🎯 Channel | 📂 Contents |
| --- | --- |
| **npm package** | the complete [`docs/user/`](user/index.md) set |
| **Website** ([komeilm76.github.io/zopia](https://komeilm76.github.io/zopia/)) | the same `docs/user/` set, rendered per version |
| **Repository only** | everything in [`development/`](development/) |

## ✅ How this documentation is written

- 🎨 Every document uses consistent emoji section headers and tables
- 🔗 Documents cross-link each other — follow a link, don't re-read
- 🔢 Rules are numbered (**R-…**), decisions are numbered (**D-…**), targets are
  numbered (**T-…**) so they can be referenced from anywhere (code, tests, PRs)
- 🧾 Every non-trivial design choice is recorded as a key decision with its rationale
- 🚧 User documentation never references internal phase numbers, roadmap items,
  or test scenario IDs — see [Documentation split plan](development/13-documentation-split.md)
