# ⚙️ Configuration

The complete option reference. Every option is **explicit, typed, and
validated** — invalid combinations fail fast with `ZOPIA_CONFIG_INVALID`
(they are never silently coerced).

> 📌 **Rule R-901** — in Phase 1, options are passed **programmatically**
> (or as CLI flags — see [Usage](10-usage.md#-cli)). A project config file
> (`zopia.config.ts`) is reserved for Phase 2; the option names below are
> already the future config shape.

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
}
```

| ⚙️ Option | 📏 Type | 🆔 Default | 📝 Notes |
| --- | --- | --- | --- |
| `outDir` | `string` | `'api_docs'` | relative or absolute; created if missing; **never deleted recursively without this exact dir** (safety R-406) |
| `mode` | `'directory' \| 'flat'` | `'directory'` | the two layouts of [API docs format](07-api-docs.md) |
| `insertComponents` | `boolean` | `false` | T-8 — emits `components/**` |
| `useComponentAsReference` | `boolean` | `false` | T-9 — imports in endpoint files; **requires** `insertComponents: true` |
| `manifest` | `boolean` | `true` | disabling it makes engine ④ impossible for that tree — a deliberate escape hatch only |

### ✅ Validation rules

| # | Invalid input | 🛑 Result |
| --- | --- | --- |
| R-911 | `useComponentAsReference: true` + `insertComponents: false` (or omitted) | `ZOPIA_CONFIG_INVALID` — hint: *"enable `insertComponents` first"* |
| R-912 | `mode` outside `'directory' \| 'flat'` | `ZOPIA_CONFIG_INVALID` |
| R-913 | `outDir` empty string | `ZOPIA_CONFIG_INVALID` |

## 📄 `ZopiaReverseOptions` — engine ④ (`apiDocsToOpenApi`)

```ts
interface ZopiaReverseOptions {
  /** 🏷️ Spec version to emit. @default '3.1' (D-09) */
  version?: '3.0' | '3.1';
}
```

| # | Invalid input | 🛑 Result |
| --- | --- | --- |
| R-921 | `version` outside `'3.0' \| '3.1'` | `ZOPIA_CONFIG_INVALID` |

## 📄 `ZodToJsonSchemaOptions` — engine ①

See [Conversions → Engine ①](06-conversions.md)
(`target`, `$schema`).

## 📄 `JsonSchemaToZodOptions` — engine ②

| ⚙️ Option | 📏 Type | 🆔 Default | 📝 Notes |
| --- | --- | --- | --- |
| `namePrefix` | `string` | `''` | prefix for the generated root const name (`'models'` → `modelsUserSchema`) |
| `rootName` | `string` | `'schema'` | name of the root const (components keep their spec name) |

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
zopia generate <spec.json> [--out <dir>] [--mode <directory|flat>]
    [--insert-components] [--use-component-as-reference]
zopia reverse  <docs-dir>  [--out <file.json>] [--version <3.0|3.1>]
```

| 🚩 Flag | ⚙️ Option |
| --- | --- |
| `--out <dir>` | `outDir` |
| `--mode <directory\|flat>` | `mode` |
| `--insert-components` | `insertComponents: true` |
| `--use-component-as-reference` | `useComponentAsReference: true` |
| `--out <file.json>` (reverse) | output file path |
| `--version <3.0\|3.1>` | `version` |

> 📌 **Rule R-931** — flags are *additive booleans*: absence = the option's
> default (never `true`). Long flags only; no camelCase/kebab ambiguity.

## 🔗 Next

- 🚀 How options are used end-to-end → [Usage](10-usage.md)
- 📂 What each option changes in the tree → [API docs format](07-api-docs.md) · [Components](08-components.md)
