# ⌨️ CLI reference

The `zopia` binary. Every command, every flag, its type, its default, and the
effect it has on the output.

```bash
bunx zopia --help      # or: npx zopia --help
```

> 🔁 The CLI is a thin, validated wrapper over the same public API documented
> in [Programmatic API](programmatic-api.md). Anything you can do here, you can
> do from TypeScript — and vice versa.

## 🧭 Grammar

```text
zopia generate <spec.json|spec.yaml> [output-dir] [--mode directory|flat] [--preset multi-tag|multi-server]
    [--insert-components] [--use-component-as-reference] [--custom] [--no-manifest]
    [--watch] [--config path]
zopia reverse  <docs-dir|manifest.json> [--out openapi.json] [--version 2.0|3.0|3.1] [--config path]
zopia validate <spec.json|spec.yaml|docs-dir> [--config path]
zopia diff     <old.json|old.yaml> <new.json|new.yaml> [--config path]
zopia navigate <docs-dir> (--to-code <spec-pointer> | --to-spec <tree-file>) [--config path]
```

| 🚩 Command | 📝 What it does |
| --- | --- |
| [`generate`](#-zopia-generate) | spec → `api_docs/**` endpoint tree + manifest |
| [`reverse`](#-zopia-reverse) | generated tree → OpenAPI document |
| [`validate`](#-zopia-validate) | lint a spec, or check a generated tree |
| [`diff`](#-zopia-diff) | semantic comparison of two specs |
| [`navigate`](#-zopia-navigate) | jump between a spec pointer and the generated file |

## 🌍 Global options

| 🚩 Flag | 📏 Value | 🆔 Default | 📝 Effect |
| --- | --- | --- | --- |
| `-h`, `--help` | — | — | prints the full grammar (including the reverse-conversion trust warning) and exits `0` |
| `--config <path>` | file path | discovered `zopia.config.ts` / `zopia.config.mts` next to `process.cwd()` | loads an explicit config file; a missing explicit file fails with `ZOPIA_CONFIG_INVALID`. Available on **every** command — `validate`, `diff`, and `navigate` have no configurable knobs yet, so the file only needs to load |

**Precedence (R-901/R-942)** — explicit CLI flag → config-file value → built-in
default. `--no-manifest` overrides `generate.manifest: true`; omitted boolean
flags adopt the config value; `generate.outDir` / `reverse.out` /
`reverse.version` apply only when the positional or flag is absent.

## 📂 `zopia generate`

Converts a spec into the endpoint tree (engine ③).

```bash
zopia generate openapi.json api_docs --mode directory --insert-components --use-component-as-reference
zopia generate swagger.yaml api_docs --watch
zopia generate openapi.json                   # output dir supplied by generate.outDir in the config
```

### Positionals

| 📍 Position | 📏 Type | 🆔 Required | 📝 Effect |
| --- | --- | --- | --- |
| `<spec>` | path to `.json`, `.yaml`, or `.yml` | ✅ | the source document; Swagger 2.0 and OpenAPI 3.0/3.1 are both accepted and normalized to the same internal model |
| `[output-dir]` | directory path | ⚠️ required **unless** the config supplies `generate.outDir` | where the tree is written; created if missing |

### Options

| 🚩 Flag | 📏 Value | 🆔 Default | 📝 Effect |
| --- | --- | --- | --- |
| `--mode` | `directory` \| `flat` | `directory` | layout of the tree. `directory` nests real URL path segments; `flat` creates one directory per API. See [API docs format](api-docs-format.md) |
| `--insert-components` | boolean flag | `false` | writes `components/**` — one module per reusable schema (plus reusable parameters/responses). Required by `--use-component-as-reference` |
| `--use-component-as-reference` | boolean flag | `false` | endpoints **import** the emitted component modules instead of inlining their schemas; nested references and cycles resolve recursively through lazy schemas. **Fails with `ZOPIA_CONFIG_INVALID`** unless `--insert-components` is also set |
| `--custom` | boolean flag | `false` | scaffolds a merge-safe `custom.ts` next to every endpoint/webhook module and re-exports it (`export * as custom from './custom'`). Written **once** and never overwritten on regeneration — the safe place for hand-written code |
| `--no-manifest` | boolean flag | manifest **on** | suppresses `.zopia-manifest.json`. ⚠️ Without it `zopia reverse`, `zopia navigate`, and `zopia/runtime` cannot work for that tree — an escape hatch, not a default |
| `--preset` | `multi-tag` \| `multi-server` | *(none)* | splits generation into one independently reversible sub-tree per bucket: `multi-tag` routes each operation by `tags[0]` (warning `ZOPIA_WARN_PRESET_PRIMARY_TAG` when several exist), `multi-server` by the effective first server (operation → path item → document). Untagged / default-server operations land in `untagged` / `https-default-server`-style buckets. Nothing to split → the normal single tree |
| `--watch` | boolean flag | `false` | keeps running and regenerates whenever the spec changes. Requires a spec **file path**; watches the spec's parent directory so atomic editor saves (write-temp + rename) still trigger a run, coalesces bursts, prints per-run errors to stderr and continues. Ctrl+C stops |

### What you get

- one `index.ts` per operation, each default-exporting a km-api config
- `components/**` when `--insert-components` is on
- `.zopia-manifest.json` unless `--no-manifest`
- warnings on stderr; output is **deterministic and idempotent** — the same
  spec plus the same options always produces byte-identical files

## 🔁 `zopia reverse`

Rebuilds an OpenAPI document from a generated tree (engine ④).

```bash
zopia reverse api_docs --out openapi.json
zopia reverse api_docs/.zopia-manifest.json
zopia reverse api_docs/users          # a single preset bucket
```

| 🚩 Flag / positional | 📏 Value | 🆔 Default | 📝 Effect |
| --- | --- | --- | --- |
| `<docs-dir\|manifest.json>` | path | ✅ required | the tree (or its manifest) to read. Pointing at a `--preset` split **root** fails with `ZOPIA_DOCS_PRESET_ROOT`, listing the bucket directories to choose from — one tree per run |
| `--out <file>` | file path | stdout (or `reverse.out` from the config) | writes the JSON document to a file instead of stdout |
| `--version` | `2.0` \| `3.0` \| `3.1` | `3.1` (or `reverse.version`) | the OpenAPI dialect of the output |

Swagger 2.0 sources keep their wire semantics in 3.x output
(`collectionFormat` → `style`/`explode`/`encoding`, `type: file` →
`format: binary`); values 3.x cannot express are preserved as
`x-collectionFormat` with a `ZOPIA_WARN_COLLECTION_FORMAT` warning.

> ⚠️ **Trust model** — `reverse` *executes* the TypeScript modules referenced by
> the manifest, and `zopia.config.ts` is executed JavaScript. Only reverse trees
> and load config files you trust. File paths are restricted to the manifest
> directory, including after symlink resolution. Edited runtime km-api metadata
> and Zod schemas take precedence over their manifest snapshots.

## ✅ `zopia validate`

```bash
zopia validate openapi.yaml   # lint a spec
zopia validate api_docs       # check a generated tree
```

| 🎯 Target | 🔍 What is checked |
| --- | --- |
| a spec file | broken `$ref`s, name collisions, cross-namespace duplicate `operationId`s, unreachable components |
| a generated tree | manifest validity, a reverse dry-run, km-api peer drift |

Diagnostics print to **stdout** as `Error|Warning: <CODE> <pointer>: <message>`,
sorted, followed by one summary line; stderr is reserved for the typed failure
tail. Exit status is `1` exactly when an error-severity diagnostic exists.
The same coverage is available programmatically as `validateZopia(input)`.

## 🔍 `zopia diff`

```bash
zopia diff v1.json v2.yaml
```

Compares two specs **semantically** — key order is ignored and JSON/YAML inputs
mix freely. Covered areas: dialect, `info`, endpoints (with parameter,
request-body and response details), webhooks, schema components, named
registries (security schemes, reusable parameters/responses, request bodies…),
path-item and webhook-item metadata, document fields, and `x-` extensions.

Output is `+` / `-` / `~` lines plus a summary on stdout. Differences are
**data, not failures**: a changed pair still exits `0`.

## 🧭 `zopia navigate`

A manifest-driven jump table between a generated tree and its source spec.

```bash
zopia navigate api_docs --to-code '#/paths/~1pets/get'
zopia navigate api_docs --to-spec pets/get/index.ts
```

| 🚩 Flag | 📏 Value | 📝 Effect |
| --- | --- | --- |
| `--to-code <spec-pointer>` | escaped JSON Pointer | prints the generated file(s) implementing that pointer — endpoints, webhooks, components, and custom companions when enabled |
| `--to-spec <tree-file>` | tree-relative file path | prints the source pointer that owns the file |

Both directions print one stable line per location. Unmatched pointers or files
exit non-zero with `ZOPIA_CONFIG_INVALID`; a root with no manifest fails with
`ZOPIA_DOCS_MISSING_MANIFEST`.

## 📏 Parsing & I/O contract

| # | Contract |
| --- | --- |
| R-931 | Boolean flags are **additive** and default to `false` when absent. `--no-manifest` is the explicit inverse of the default-on manifest option. `--watch` is generate-only and requires a spec file path. With a project config file, config values fill every option the flags leave unset and every explicit flag still wins; `<output-dir>` is required unless `generate.outDir` is configured |
| R-932 | Parsing is **strict and complete before either engine runs**: options may surround positional arguments, but unknown, command-incompatible, repeated, or valueless options and missing/extra positionals fail with `ZOPIA_CONFIG_INVALID` located at the offending argument |
| R-933 | **Data → stdout** (or the `--out` file); **warnings and errors → stderr**. `validate` and `diff` are the deliberate exceptions: their diagnostics *are* the data, so they go to stdout |
| R-934 | `-h`/`--help` lists the complete grammar and warns that reverse conversion executes generated TypeScript. `--config <path>` works on every command |

### 🚦 Exit codes

| 🔢 Code | 📝 Meaning |
| --- | --- |
| `0` | success (including `diff` finding differences) |
| `1` | typed user / configuration failure — message and hint on stderr; also `validate` finding an error-severity diagnostic |
| `2` | unexpected internal failure — should never happen; please [report it](https://github.com/komeilm76/zopia/issues) |

### ⚠️ Warning output

Warnings print to stderr as:

```text
Warning: ZOPIA_WARN_<CODE> <pointer>: <message>
```

`zopia reverse` keeps stdout valid OpenAPI JSON even when warnings exist, and
`--out` writes only JSON to the selected file. Every code is listed in
[Errors & warnings](errors-and-warnings.md).

## 🔗 Next

- ⚙️ Config file and option types → [Configuration](configuration.md)
- 📂 What the generated files look like → [API docs format](api-docs-format.md)
- 🧑‍💻 The same features from TypeScript → [Programmatic API](programmatic-api.md)
