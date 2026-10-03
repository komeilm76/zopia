# 🌳 Runtime

Loading a generated tree as **one object** instead of importing files one by
one — the `zopia/runtime` subpath.

> 🔌 This is a **separate entry point on purpose**: the package root stays free
> of filesystem-importing APIs, so bundling `zopia` into a browser build never
> pulls in `node:fs`.

## 📥 Import

```ts
import { createApiDocs, flattenApiDocs } from 'zopia/runtime';
```

## ⚡ Usage

```ts
import { createApiDocs, flattenApiDocs } from 'zopia/runtime';
import type { ApiDocsFlat, ApiDocsTree } from './api_docs/.zopia-tree';

// Nested: exact URL path segments, lowercase method leaf, default-export config
const apiDocs = await createApiDocs<ApiDocsTree>('api_docs');
const getUser = apiDocs.users['{userId}'].get;   // the makeApiConfig object

// Flat: keyed by operationId (derived with the generator's own naming rules)
const endpoints = flattenApiDocs<ApiDocsFlat>(apiDocs);
endpoints.getUser === getUser;                    // → true
```

| 🔧 Symbol | 📏 Signature / shape | 📝 What it does |
| --- | --- | --- |
| `createApiDocs<T>(dir)` | `(dir: string) => Promise<T>` | reads the directory's manifest, imports every endpoint module, and returns one nested object mirroring the URL structure |
| `flattenApiDocs<T>(tree)` | `(tree: object) => T` | collapses that nested object into a flat record keyed by `operationId` |
| `ApiDocsTree` | recursive index type | the nested shape: every segment is both a deeper branch and a possible endpoint, so `apiDocs.users['{userId}'].get` type-checks |
| `ApiDocsEndpointConfig` | km-api config entry | the leaf type — exactly what a generated `index.ts` default-exports |

Both types are also emitted per tree into `.zopia-tree` (as `ApiDocsTree` and
`ApiDocsFlat`), which is what makes the exact-key autocompletion below work.

## 🧭 Which trees work

Any directory zopia has ever generated into — `directory` mode, `flat` mode,
and split `multi-tag` / `multi-server` preset buckets — resolves through its
manifest. Generation output is untouched by using this API.

> 📦 The tree **must** have a manifest. A directory generated with
> `--no-manifest` fails with `ZOPIA_DOCS_MISSING_MANIFEST`.

## 🔠 Typing the tree

The type import is optional. Without it, results stay permissively typed. With
it, every key is exact:

- `apiDocs.users.` autocompletes `{userId}`
- `endpoints.` autocompletes the endpoint names
- misspelled keys are **compile errors**

## ⚠️ Trust model

`createApiDocs()` imports — and therefore **executes** — the generated
TypeScript modules the manifest points at. Paths are restricted to the manifest
directory, including after symlink resolution. Load only trees you trust.

## 🧯 Failures

Every failure is a typed `ZopiaError` with `code`, `at`, and `hint`:

| 🆔 Code | 📝 Cause |
| --- | --- |
| `ZOPIA_DOCS_MISSING_MANIFEST` | the directory has no `.zopia-manifest.json` |
| `ZOPIA_MANIFEST_INVALID` | the manifest exists but does not match the expected shape |
| `ZOPIA_DOCS_IMPORT_FAILED` | an endpoint/component module threw while being imported |
| `ZOPIA_DOCS_MANIFEST_MISMATCH` | the manifest and the files on disk disagree |
| `ZOPIA_DOCS_PRESET_ROOT` | the path is a preset **split root**; pick one of the listed bucket directories |

See [Errors & warnings](errors-and-warnings.md) for the full catalogue, and
[API docs format → Runtime tree consumption](api-docs-format.md#-runtime-tree-consumption--createapidocs)
for the exact contract.

## 🔗 Next

- 📂 [API docs format](api-docs-format.md) — what is in the tree
- 🧑‍💻 [Programmatic API](programmatic-api.md) — the rest of the surface
