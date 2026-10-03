# 🧑‍💻 Programmatic API

Calling zopia from TypeScript. This page is the map of the public surface —
every entry point, what it takes, what it returns, and what it does.

```ts
import { /* … */ } from 'zopia';          // engines, config, validation, diff, errors
import { /* … */ } from 'zopia/runtime';  // filesystem tree loading (see Runtime)
```

> 🧷 Option tables with defaults and validation rules live in
> [Configuration](configuration.md). This page is about **functions**.

## 🗺️ Surface at a glance

| 🧩 Area | 🔑 Entry points |
| --- | --- |
| ① Zod → JSON Schema | `zodToJsonSchema` |
| ② JSON Schema → Zod | `jsonSchemaToZod` |
| ③ OpenAPI → api docs | `openApiToApiDocs`, `readOpenApiSourceInput`, `validateOpenApiReferences`, `normalizeOpenApiDocument` |
| ④ api docs → OpenAPI | `apiDocsToOpenApi`, `manifestToOpenApi`, `manifestFileToOpenApi` |
| ⚙️ Configuration | `defineConfig`, `loadZopiaConfig` |
| ✅ Validation | `validateZopia`, `ZOPIA_VALIDATION_CODES` |
| 🔍 Diff | `diffOpenApiSpecs`, `diffOpenApiDocuments` |
| 🧭 Navigation | `loadNavigationIndex`, `navigationIndexFromManifest`, `specPointerAtLine`, `specPointerToLine`, `specPointersToLines` |
| 🧯 Errors & warnings | `ZopiaError`, `isZopiaError`, `asZopiaError`, `ZOPIA_ERROR_CODES`, `ZOPIA_WARNING_CODES` |
| 🧪 Low-level building blocks | `collectOpenApiOperations`, `buildOpenApiOperationIR`, `extractOperationContracts`, `planApiDocsFiles`, `generateApiDocsFiles`, `endpointFilePath`, `resolveOpenApiLocalRef`, … |
| 🌳 Runtime | `createApiDocs`, `flattenApiDocs` (from `zopia/runtime`) |

## ① Engine ① — Zod → JSON Schema

```ts
import { zodToJsonSchema } from 'zopia';
import { z } from 'zod';

const jsonSchema = zodToJsonSchema(
  z.object({ name: z.string().min(1), email: z.email() }),
  { target: 'openapi-3.1', onWarning: (w) => console.warn(w.code, w.at) },
);
```

| 🔧 Parameter | 📏 Type | 📝 Effect |
| --- | --- | --- |
| `schema` | any Zod v4 schema | the source schema |
| `options.target` | `ZodJsonSchemaTarget` (e.g. `'openapi-3.1'`, `'draft-2020-12'`) | which JSON Schema dialect the output must conform to |
| `options.onWarning` | `(warning: ZopiaWarning) => void` | called for every unrepresentable construct (e.g. `z.void()`), deterministically ordered |

Returns a plain JSON Schema object. Constructs Zod can express but the target
dialect cannot are reported as warnings instead of being silently dropped — see
[Conversions](conversions.md).

## ② Engine ② — JSON Schema → Zod

```ts
import { jsonSchemaToZod } from 'zopia';

const { code, schema, warnings, overlays } = jsonSchemaToZod(jsonSchema);
```

| 🔑 Result field | 📏 Type | 📝 What it is |
| --- | --- | --- |
| `code` | `string` | executable Zod v4 TypeScript; lossy nodes carry canonical `// @zopia:warn …` comments |
| `schema` | Zod schema | a runtime schema equivalent to `code` |
| `warnings` | `ZopiaWarning[]` | structured, deduplicated, sorted diagnostics |
| `overlays` | `JsonSchemaOverlay[]` | the exact facts needed to restore the original schema on the way back |

## ③ Engine ③ — OpenAPI → api docs

```ts
import { openApiToApiDocs } from 'zopia';

const result = await openApiToApiDocs('swagger.yaml', {
  outDir: 'api_docs',
  mode: 'directory',
  insertComponents: true,
  useComponentAsReference: true,
  custom: false,
  manifest: true,
  onWarning: (w) => console.warn(w.code, w.at, w.message),
});
```

| 🔧 Input form | 📝 Accepted |
| --- | --- |
| object | an already-parsed OpenAPI/Swagger document |
| string | JSON or YAML **text** |
| path | `.json`, `.yaml`, `.yml` file path (enables same-folder external `$ref` bundling) |

| 🔑 Result field | 📏 Type | 📝 What it is |
| --- | --- | --- |
| `files` | `ZopiaGeneratedFile[]` | every written file, in deterministic order |
| `warnings` | `ZopiaWarning[]` | collected diagnostics |
| `manifestPath` | `string \| undefined` | absent when `manifest: false` or a preset split ran |
| `trees` | `ZopiaPresetTree[] \| undefined` | `{ name, directory, manifestPath? }` per routed bucket when `preset` is used |

Supporting helpers:

| 🔧 Function | 📝 Use it when |
| --- | --- |
| `readOpenApiSourceInput(input)` | you need the normalized source text/document (and its origin) without generating |
| `validateOpenApiReferences(document)` | you want the `$ref` graph checked before generating |
| `normalizeOpenApiDocument(document)` | you want the dialect-neutral model (`NormalizedOpenApiDocument`) that both v2 and v3 collapse into |

Every option, its default, and its validation rule →
[Configuration → `ZopiaGenerateOptions`](configuration.md).

## ④ Engine ④ — api docs → OpenAPI

```ts
import { apiDocsToOpenApi, manifestFileToOpenApi } from 'zopia';

const { openapi, warnings } = await apiDocsToOpenApi('api_docs', { version: '3.1' });
await Bun.write('openapi.json', JSON.stringify(openapi, null, 2));
```

| 🔧 Function | 📝 Input |
| --- | --- |
| `apiDocsToOpenApi(dir, options)` | a generated tree directory |
| `manifestFileToOpenApi(path, options)` | a `.zopia-manifest.json` path |
| `manifestToOpenApi(manifest, options)` | an in-memory `ZopiaManifest` |

| ⚙️ Option | 📏 Type | 🆔 Default | 📝 Effect |
| --- | --- | --- | --- |
| `version` | `'2.0' \| '3.0' \| '3.1'` | `'3.1'` | output dialect |
| `onWarning` | callback | — | per-warning notification |

> ⚠️ Reverse conversion **imports and executes** the generated modules. Only
> run it on trees you trust.

## ⚙️ Configuration helpers

```ts
import { defineConfig, loadZopiaConfig } from 'zopia';

export default defineConfig({
  generate: { mode: 'directory', insertComponents: true, outDir: 'api_docs' },
  reverse: { version: '3.1', out: 'openapi.json' },
});

const config = await loadZopiaConfig({ cwd: process.cwd() }); // same discovery as the CLI
```

`defineConfig` is a typed identity helper — it exists for editor completion and
compile-time validation of the config shape. `loadZopiaConfig({ cwd?, file? })`
performs the CLI's discovery rules (`zopia.config.ts`, then `zopia.config.mts`).

## ✅ Validation

```ts
import { validateZopia } from 'zopia';

const { ok, kind, target, diagnostics } = await validateZopia('openapi.yaml');
for (const issue of diagnostics) console.log(issue.severity, issue.code, issue.at, issue.message);
```

`kind` tells you whether a spec or a generated tree was inspected. `ok` is
`false` exactly when an error-severity diagnostic exists — the same rule the
CLI uses for its exit status.

## 🔍 Diff

```ts
import { diffOpenApiSpecs } from 'zopia';

const result = await diffOpenApiSpecs('v1.json', 'v2.yaml');
// result.entries: { kind: '+' | '-' | '~', area, at, message }
// result.counts:  per-area tallies
```

`diffOpenApiDocuments(before, after)` is the in-memory variant. Differences are
**data**, never thrown errors.

## 🧭 Navigation

```ts
import { loadNavigationIndex, specPointerToLine } from 'zopia';

const index = await loadNavigationIndex('api_docs');
```

The index maps spec JSON Pointers ↔ generated files (endpoints, webhooks,
components, custom companions). `specPointerAtLine` / `specPointerToLine` /
`specPointersToLines` translate between pointers and source-file lines —
this is what editor integrations build on.

## 🧯 Error handling

```ts
import { openApiToApiDocs, isZopiaError } from 'zopia';

try {
  await openApiToApiDocs('swagger.json', { insertComponents: false, useComponentAsReference: true });
} catch (error) {
  if (isZopiaError(error)) {
    console.error(error.code);  // 🆔 'ZOPIA_CONFIG_INVALID'
    console.error(error.hint);  // 💡 'enable `insertComponents` first'
    console.error(error.at);    // 📍 JSON Pointer, option name, or file — when discoverable
    console.error(error.cause); // 🔗 the wrapped parser/import/filesystem failure
  }
}
```

`asZopiaError(unknown)` normalizes any thrown value into a `ZopiaError`. Every
code is listed in [Errors & warnings](errors-and-warnings.md).

## ⚠️ Handling warnings

Warnings are structured, deterministic, and non-fatal. `code` is a stable
`ZopiaWarningCode`; `at` is an escaped JSON Pointer when a location is known.
Use codes for automation and treat `message` as human-readable context.

```ts
import { apiDocsToOpenApi, zodToJsonSchema, type ZopiaWarning } from 'zopia';

const observed: ZopiaWarning[] = [];
zodToJsonSchema(schema, { onWarning: (warning) => observed.push(warning) });

const result = await apiDocsToOpenApi('api_docs', {
  version: '3.1',
  onWarning: (warning) => observed.push(warning),
});

for (const warning of result.warnings) {
  console.error(warning.code, warning.at, warning.message);
}
```

Exact duplicates are removed, and results and callbacks are ordered by
location, then code, then message. Engine ② additionally writes canonical
`// @zopia:warn …` comments into the emitted code: a manifest preserves
restorable schema facts, but the warning stays visible because the generated
Zod expression itself is an approximation.

## 🧩 Working with the generated tree

| # | Practice | Rule |
| --- | --- | --- |
| R-101 | 📂 **Import, don't re-type** — your app imports the generated `index.ts` files; their Zod schemas *are* the validation | — |
| R-102 | 🔄 **Spec or options changed?** re-run generation — output is idempotent; manifest staleness warns on source/config/incomplete-tree drift and safely prunes only obsolete manifest-owned files (`ZOPIA_WARN_STALE_TREE`) | [API docs format → Regeneration](api-docs-format.md#-regeneration--manual-edits-phase-1-policy) |
| R-103 | ✍️ **Hand edits** — generated files are overwritten on regeneration (see the file banner); put hand-written code in the `custom.ts` companions (`custom: true`) | [API docs format → Regeneration](api-docs-format.md#-regeneration--manual-edits-phase-1-policy) |
| R-104 | 🧪 **km-api helpers** — `makeFullPath`, `makeParams`, `convertResponseType`, … are available on every generated config for free | [Concepts → km-api](concepts.md#-km-api) |
| R-105 | 🚫 **No zopia import in app code** — generated files depend only on `zod` + `km-api` | — |
| R-106 | 🌳 **Runtime tree loading** — `createApiDocs()` from `zopia/runtime` turns a whole directory into one nested object | [Runtime](runtime.md) |

## 🔗 Next

- ⚙️ Options, defaults, and validation → [Configuration](configuration.md)
- 🌳 Loading a tree at runtime → [Runtime](runtime.md)
- 🔄 Exact conversion rules → [Conversions](conversions.md)
