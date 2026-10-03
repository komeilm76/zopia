# 📘 zopia — User Documentation

Everything you need to **use** zopia. This directory is the user-facing
documentation set: it ships inside the npm package and is the single source
of truth for the [documentation website](https://komeilm76.github.io/zopia/).

> 🛠️ Looking for how zopia is *built* (architecture, testing, standards,
> roadmap)? That lives in [`docs/development/`](../development/) and is **not**
> part of the user documentation.

## 🚦 Start here

| # | 📄 Page | Read it when… |
| --- | --- | --- |
| 1 | 📦 [Installation](installation.md) | You are adding zopia to a project |
| 2 | ⚡ [Quick start](quick-start.md) | You want a working result in five minutes |
| 3 | ⌨️ [CLI reference](cli.md) | You run zopia from the terminal or CI |
| 4 | 🧑‍💻 [Programmatic API](programmatic-api.md) | You call zopia from TypeScript |
| 5 | ⚙️ [Configuration](configuration.md) | You need every option, default, and effect |

## 📚 Reference

| 📄 Page | What it covers |
| --- | --- |
| 🔄 [Conversions](conversions.md) | The exact mapping rules of the four engines |
| 📂 [API docs format](api-docs-format.md) | The shape of the generated tree, `index.ts`, and the manifest |
| 🧱 [Components](components.md) | `$ref` handling, `insertComponents`, `useComponentAsReference` |
| 🌳 [Runtime](runtime.md) | Loading a generated tree at runtime with `zopia/runtime` |
| 🧯 [Errors & warnings](errors-and-warnings.md) | Every stable code, what causes it, and how to fix it |
| 🧩 [Concepts](concepts.md) | Glossary — Swagger 2.0, OpenAPI 3.x, JSON Schema, `$ref`, Zod v4, km-api |

## 🧭 Suggested paths

- 🆕 **New to zopia** → [Installation](installation.md) → [Quick start](quick-start.md) → [CLI](cli.md)
- 🏗️ **Generating code from a spec** → [CLI](cli.md) → [Configuration](configuration.md) → [API docs format](api-docs-format.md) → [Components](components.md)
- 🔁 **Going back to a spec** → [Programmatic API](programmatic-api.md) → [API docs format → manifest](api-docs-format.md)
- 🧪 **Converting schemas only** → [Conversions](conversions.md) → [Programmatic API](programmatic-api.md)
- 🆘 **Something failed** → [Errors & warnings](errors-and-warnings.md)

## 🔖 Versions

Each published minor version has its own documentation snapshot on the website.
The copy you are reading matches the version of the package it shipped with —
check `CHANGELOG.md` for what changed between versions.
