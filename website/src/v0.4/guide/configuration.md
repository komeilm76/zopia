---
title: "Configuration (v0.4)"
description: "Configuration — zopia 0.4.0 documentation snapshot."
outline: [2, 3]
---

# ⚙️ Configuration

::: warning YOU ARE READING OLD DOCUMENTATION
This page documents zopia **v0.4.0**. The latest version is **v0.6.0** —
[read the current documentation](/guide/introduction) or [browse the v0.4.0 sources](https://github.com/komeilm76/zopia/blob/v0.4.0/docs).
:::

The complete option reference. Every option is **explicit, typed, and
validated** — invalid combinations fail fast with `ZOPIA_CONFIG_INVALID`
(they are never silently coerced).

> 📌 **Rule R-901** — options may come from three sources with one fixed
> precedence: **explicit CLI flags win over config-file values, and
> config-file values win over built-in defaults.** A project config file
> (`zopia.config.ts`, D-19) is discovered next to the working directory; the
> option names below are exactly its shape.

## 🧾 `zopia.config.ts` — project defaults (v0.2.x, D-19)

```ts
import { defineConfig } from 'zopia';

export default defineConfig({
  generate: {
    mode: 'directory',
    insertComponents: true,
    useComponentAsReference: true,
    custom: true,
    outDir: 'api_docs',
  },
  reverse: { version: '3.1', out: 'openapi.json' },
});
```

| # | Rule |
| --- | --- |
| R-940 | The CLI discovers `zopia.config.ts`, then `zopia.config.mts`, next to the **working directory** (`process.cwd()`); `--config <path>` selects an explicit file instead (bare paths resolve from the working directory) and a missing explicit file fails with `ZOPIA_CONFIG_INVALID`. Library users call `loadZopiaConfig({ cwd?, file? })` for the same discovery. |
| R-941 | The config module accepts a `default` export or a named `config` export (default wins). Its shape is exactly `{ generate?: …, reverse?: … }` with the option keys below; unknown keys, non-`Options` nesting, and mistyped values fail with `ZOPIA_CONFIG_INVALID` located at the offending key (`generate.mode`, `reverse.version`, …). |
| R-942 | Precedence is stable: **CLI flag > config value > built-in default.** `--no-manifest` overrides `generate.manifest: true`; omitted generate flags adopt `generate.*` booleans; `generate.outDir`/`reverse.out`/`reverse.version` apply only when the positional/flag is absent. Without `generate.outDir` the `<output-dir>` positional stays required for `zopia generate`. |
| R-943 | The config file is **executed JavaScript** under the same trust model as reverse conversion — only trusted projects should carry one; evaluation failures surface as `ZOPIA_CONFIG_INVALID` with the module's error chained. |

## 📄 `ZopiaGenerateOptions` — engine ③ (`openApiToApiDocs`)

```ts
interface ZopiaGenerateOptions {
  /** 📂 Where the tree is written. @default 'api_docs' */
  outDir?: string;

  /** 📂 Layout mode. @default 'directory' */
  mode?: 'directory' | 'flat';

  /** 🧱 Write components/** with one file per component. @default false (T-8) */
  insertComponents?: boolean;

  /** 🔗 Endpoints import components instead of inlining.
   *  Requires insertComponents: true. @default false (T-9) */
  useComponentAsReference?: boolean;

  /** 📦 Write .zopia-manifest.json (needed by engine ④ — keep it on). @default true */
  manifest?: boolean;

  /** 🧩 Write merge-safe custom.ts companions per endpoint. @default false (D-24) */
  custom?: boolean;

  /** 🧰 Split generation into per-bucket sub-trees: `multi-tag` (per primary tag)
   *  or `multi-server` (per effective first server). @default undefined (S-92) */
  preset?: 'multi-tag' | 'multi-server';
}

interface ZopiaGenerateResult {
  files: GeneratedFile[];
  warnings: ZopiaWarning[];
  manifestPath?: string; // absent when manifest: false or a preset split ran
  trees?: ZopiaPresetTree[]; // {name, directory, manifestPath?} per routed bucket (S-92)
}
```

| ⚙️ Option | 📏 Type | 🆔 Default | 📝 Notes |
| --- | --- | --- | --- |
| `outDir` | `string` | `'api_docs'` | relative or absolute; created if missing; **never deleted recursively without this exact dir** (safety R-406) |
| `mode` | `'directory' \| 'flat'` | `'directory'` | the two layouts of [API docs format](/v0.4/reference/api-docs-format) |
| `insertComponents` | `boolean` | `false` | T-8 — emits `components/**` (schemas plus reusable `components/parameters/**` / `components/responses/**` modules, v0.2.x — D-18) |
| `useComponentAsReference` | `boolean` | `false` | T-9 — imports exact structural component schema references in endpoints and recursively renders nested references through the complete Engine ② schema surface; literal `$ref`-looking data is untouched, aliases/cycles use lazy schemas, and valid `$ref` siblings keep their constraints; **requires** `insertComponents: true` |
| `manifest` | `boolean` | `true` | disabling it makes engine ④ impossible for that tree — a deliberate escape hatch only; regeneration removes a previous manifest and warns that the tree configuration changed |
| `custom` | `boolean` | `false` | D-24 — every endpoint/webhook module exports `export * as custom from './custom';` and a sibling `custom.ts` is scaffolded once and never overwritten; CLI flag `--custom`, config key `generate.custom` |
| `preset` | `'multi-tag' \| 'multi-server'` | `undefined` | S-92 — splits generation into one api-docs sub-tree per routed bucket: `multi-tag` routes each operation by its primary tag (`tags[0]`, warning `ZOPIA_WARN_PRESET_PRIMARY_TAG` when several), `multi-server` by the effective first server (operation → path item → document). Untagged/default-server operations land in `untagged` / `https-default-server`-style buckets; the result gains `trees[]` and every bucket is an independently reverse-convertible tree with its own manifest. Collision-safe lowercase slugs; **nothing to split → the normal single tree** and no `trees[]` |

### ✅ Validation rules

| # | Invalid input | 🛑 Result |
| --- | --- | --- |
| R-911 | `useComponentAsReference: true` + `insertComponents: false` (or omitted) | `ZOPIA_CONFIG_INVALID` — hint: *"enable `insertComponents` first"* |
| R-912 | `mode` outside `'directory' \| 'flat'` | `ZOPIA_CONFIG_INVALID` |
| R-913 | `outDir` empty string | `ZOPIA_CONFIG_INVALID` |
| R-914 | unknown option keys or non-boolean boolean flags | `ZOPIA_CONFIG_INVALID` |
| R-915 | `preset` outside `'multi-tag' \| 'multi-server'` (options or `generate.preset`) | `ZOPIA_CONFIG_INVALID` |

## 📄 `ZopiaReverseOptions` — engine ④ (`apiDocsToOpenApi`)

```ts
interface ZopiaReverseOptions {
  /** 🏷️ Spec version to emit. @default '3.1' (D-09, D-20) */
  version?: '2.0' | '3.0' | '3.1';
  /** ⚠️ Receive every normalized reverse-conversion warning. */
  onWarning?: (warning: ZopiaWarning) => void;
}
```

| # | Invalid input | 🛑 Result |
| --- | --- | --- |
| R-921 | `version` outside `'3.0' \| '3.1'` | `ZOPIA_CONFIG_INVALID` |

## 📄 `ZodToJsonSchemaOptions` — engine ①

See [Conversions → Engine ①](https://github.com/komeilm76/zopia/blob/v0.4.0/docs/https://github.com/komeilm76/zopia/blob/main/docs/06-conversions.md)
(`target`, `$schema`, `io`).

## 📄 `JsonSchemaToZodOptions` — engine ②

| ⚙️ Option | 📏 Type | 🆔 Default | 📝 Notes |
| --- | --- | --- | --- |
| `rootName` | `string` | `'schema'` | name of the root const (component files always keep their spec name — `<ComponentName>Schema`) |

## 🧮 Defaults at a glance

```ts
// 🆔 The implicit default configuration of engine ③:
{
  outDir: 'api_docs',
  mode: 'directory',
  insertComponents: false,          // 🎯 T-8 default
  useComponentAsReference: false,   // 🎯 T-9 default
  manifest: true,
}
```

> 💡 The defaults produce the **simplest possible tree**: self-contained
> `index.ts` files, no component files, plus the manifest that keeps the
> reverse conversion alive. Developers opt *into* complexity only when they
> want it.

## ⌨️ CLI ↔ options mapping

```text
zopia generate <spec.json> <output-dir> [--mode <directory|flat>]
    [--insert-components] [--use-component-as-reference] [--custom] [--no-manifest] [--watch]
zopia reverse  <docs-dir>  [--out <file.json>] [--version <2.0|3.0|3.1>]
zopia validate <spec|docs-dir>             (no options yet; `--config path` accepted for parity)
zopia diff <old-spec> <new-spec>          (no options yet; `--config path` accepted for parity)
```

| 🚩 Flag | ⚙️ Option |
| --- | --- |
| positional `<output-dir>` (generate) | `outDir` |
| `--mode <directory\|flat>` | `mode` |
| `--insert-components` | `insertComponents: true` |
| `--use-component-as-reference` | `useComponentAsReference: true` |
| `--custom` | `custom: true` |
| `--preset <multi-tag\|multi-server>` | `preset` |
| `--no-manifest` | `manifest: false` |
| `--watch` | no config equivalent — CLI-only; watches the spec file's parent directory (survives atomic editor saves) and regenerates on change |
| `--out <file.json>` (reverse) | output file path |
| `--version <3.0\|3.1>` | `version` |

> 📌 **Rule R-931** — positive boolean flags are additive: absence = `false`.
> `--no-manifest` is the one explicit inverse because manifests default on.
> Long flags only; no camelCase/kebab ambiguity.
