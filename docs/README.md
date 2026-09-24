# 📖 zopia — Documentation

Welcome to the **zopia** documentation home. This directory is the single
source of truth for *how zopia works, what it must do, and how it is built*.

> 📌 **Rule** — behaviour and documentation change together. If a commit
> changes what zopia does, the matching document in this directory changes in
> the **same** commit. See [Standards → Docs convention](12-standards.md#-docs-convention).

## 🗺️ Map

| # | 📄 Document | Read it when… |
| --- | --- | --- |
| 1 | 🧭 [Overview](01-overview.md) | You want to know **what** zopia is and **why** it exists |
| 2 | 🎯 [Targets](02-targets.md) | You want the **explicit, testable goals** of the project |
| 3 | 🗺️ [Roadmap](03-roadmap.md) | You want to know **what ships in which phase** |
| 4 | 🏗️ [Architecture](04-architecture.md) | You are **implementing** — modules, pipeline, internal model, errors |
| 5 | 🧩 [Concepts](05-concepts.md) | You need the **glossary** — Swagger 2.0, OpenAPI 3.x, JSON Schema, `$ref`, Zod v4, km-api |
| 6 | 🔄 [Conversions](06-conversions.md) | You need the **exact mapping rules** of the four engines |
| 7 | 📄 [API docs format](07-api-docs.md) | You need the **output contract** — layouts, `index.ts`, manifest |
| 8 | 🧱 [Components](08-components.md) | You work with **`$ref`s** and the component options |
| 9 | ⚙️ [Configuration](09-configuration.md) | You want the **full option reference** with defaults |
| 10 | 🚀 [Usage](10-usage.md) | You want to **use** zopia — programmatic API & CLI |
| 11 | 🧪 [Testing](11-testing.md) | You are **writing tests** — scenario matrix, fixtures, coverage gates |
| 12 | 📏 [Standards](12-standards.md) | You are **consuming the project** — code, JSDoc, commits, changelog, decisions |

## 🧭 Suggested paths

- 🆕 **New here** → [Overview](01-overview.md) → [Targets](02-targets.md) →
  [Concepts](05-concepts.md) → [Usage](10-usage.md)
- 🛠️ **Implementing Phase 1** → [Architecture](04-architecture.md) →
  [Conversions](06-conversions.md) → [API docs format](07-api-docs.md) →
  [Testing](11-testing.md)
- 🤔 **Question about a decision?** → [Standards → Key decisions](12-standards.md#-key-decisions)

## ✅ How this documentation is written

- 🎨 Every document uses consistent emoji section headers and tables
- 🔗 Documents cross-link each other — follow a link, don't re-read
- 🔢 Rules are numbered (**R-…**), decisions are numbered (**D-…**), targets are
  numbered (**T-…**) so they can be referenced from anywhere (code, tests, PRs)
- 🧾 Every non-trivial design choice is recorded as a key decision with its rationale
