# 🚀 Usage

How to use zopia — installation, the programmatic API (the primary interface),
and the CLI. The API below is the implemented **Phase 1 contract**, pinned by
tests.

## 📦 Installation

```bash
bun add zopia        # 📦 the toolkit (no bundled runtime dependencies)
bun add zod km-api   # ⚛️🧱 peer dependencies for conversion/generated code
```

| 📦 Package | 🏷️ Kind | 📝 Why |
| --- | --- | --- |
| `zopia` | dependency | the engines |
| `zod` `^4` | peer | engines ①/② convert runtime schemas; generated schemas validate at runtime |
| `km-api` `^0.4.1` (0.4.x) | peer | generated files call `makeApiConfig()` and engine ④ imports their results |

## ⚡ Quick start — all four engines

```ts
import {
  zodToJsonSchema,
  jsonSchemaToZod,
  openApiToApiDocs,
  apiDocsToOpenApi,
} from 'zopia';
import { z } from 'zod';

// ── ① Zod → JSON Schema ────────────────────────────────────
const schema = z.object({ name: z.string().min(1), email: z.email() });
const jsonSchema = zodToJsonSchema(schema, { target: 'openapi-3.1' });
// → { type: 'object', properties: { … }, required: ['name', 'email'], … }

// ── ② JSON Schema → Zod ────────────────────────────────────
const { code, schema: back, warnings, overlays } = jsonSchemaToZod(jsonSchema);
// → code: executable Zod v4 TypeScript (lossy nodes include @zopia:warn markers)
// → schema: <runtime Zod schema equivalent to `code`>
// → warnings: structured diagnostics; overlays: exact reverse-conversion restorations

// ── ③ OpenAPI → api docs ───────────────────────────────────
// input: object · JSON/YAML text · .json/.yaml/.yml path (v0.2.x, D-16)
const result = await openApiToApiDocs('swagger.yaml', {
  mode: 'directory',            // 📂 or 'flat'
  insertComponents: false,      // 🧱 default
  useComponentAsReference: false, // 🔗 default
});
// → one api_docs/<path>/<method>/index.ts per operation + .zopia-manifest.json
console.log(result.files, result.warnings);

// ── ④ api docs → OpenAPI ───────────────────────────────────
const { openapi, warnings: w2 } = await apiDocsToOpenApi('api_docs', {
  version: '3.1',
});
// → a complete OpenAPI document, ready for JSON.stringify
```

## 📄 End-to-end — what a developer actually gets

```bash
$ bunx zopia generate openapi.json api_docs --mode directory --insert-components --use-component-as-reference
```

With the canonical Admin API fixture saved as `openapi.json`, that produces:

```text
api_docs/
├── .zopia-manifest.json
├── components/
│   ├── index.ts
│   ├── CreateUser/index.ts
│   └── User/index.ts
├── health/get/index.ts
└── users/{userId}/
    ├── get/index.ts
    └── patch/index.ts
```

…and `api_docs/users/{userId}/get/index.ts` is real, runnable, type-safe code —
see its exact checked-in output in
[API docs format → The `index.ts` contract](07-api-docs.md#-the-indexts-contract).
Drop the tree into your project, import what you need:

```ts
import getUser from './api_docs/users/{userId}/get/index';

const url = getUser.makeFullPath({ userId: '550e8400-e29b-41d4-a716-446655440000' });
const user = getUser.makeBody(undefined); // type-safe: no body on GET
```

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

Exact duplicates are removed and results/callbacks are sorted by location,
code, then message. Engine ② also writes canonical `// @zopia:warn …` comments
into emitted code. A manifest preserves restorable schema facts; a warning
still remains visible because the generated Zod expression itself is an
approximation.

## ⌨️ CLI

> The CLI delegates generation to the same validated Engine ③ public API; its
> flags map to [Configuration](09-configuration.md#-cli--options-mapping).

```text
zopia generate <spec.json|spec.yaml> [output-dir] [--mode directory|flat] [--preset multi-tag|multi-server]
    [--insert-components] [--use-component-as-reference] [--custom] [--no-manifest]
    [--watch] [--config path]
zopia reverse <docs-dir|manifest.json> [--out openapi.json]
    [--version 2.0|3.0|3.1] [--config path]
zopia validate <spec.json|spec.yaml|docs-dir> [--config path]
zopia diff <old.json|old.yaml> <new.json|new.yaml> [--config path]
zopia navigate <docs-dir> (--to-code <spec-pointer> | --to-spec <tree-file>) [--config path]
```

| 🚩 Command | 📝 What it does | 💡 Example |
| --- | --- | --- |
| `zopia generate` | generates the endpoint tree and manifest; `--watch` keeps it running and regenerates whenever the spec file changes (survives atomic editor saves; Ctrl+C stops) | `zopia generate swagger.json api_docs`, `zopia generate swagger.yaml api_docs --watch` |
| `zopia reverse` | imports the manifest's endpoint and emitted component modules, then writes the reconstructed OpenAPI document to stdout or `--out`. Swagger 2.0 sources keep their wire format in 3.x output (`collectionFormat` → `style`/`explode`/`encoding`, `type: file` → `format: binary`); values 3.x cannot spell are kept as `x-collectionFormat` with a `ZOPIA_WARN_COLLECTION_FORMAT` warning. One tree per run: pointing at a `--preset` split root fails with `ZOPIA_DOCS_PRESET_ROOT` listing the bucket directories to choose from | `zopia reverse api_docs/.zopia-manifest.json --out openapi.json`, `zopia reverse api_docs/users` |
| `zopia validate` | lints a spec (broken refs, name collisions, cross-namespace duplicate operationIds, unreachable components) or checks a generated tree (manifest validity, reverse dry-run, km-api peer drift); prints sorted diagnostics and a summary line to stdout | `zopia validate openapi.yaml`, `zopia validate api_docs` |
| `zopia diff` | compares two specs semantically (dialect, info, endpoints with parameter/request-body/response details, webhooks, schema components and named registries (security schemes, reusable parameters/responses, request bodies…), path-item and webhook-item metadata, document fields, `x-` extensions) — key order is ignored and JSON/YAML inputs mix freely; prints `+`/`-`/`~` lines plus a summary to stdout; differences are data, so a changed pair still exits `0` | `zopia diff v1.json v2.yaml` |
| `zopia navigate` | manifest-driven jump table between a generated tree and its source spec (S-93): `--to-code '#/paths/~1pets/get'` prints the generated file(s) implementing the pointer (endpoints, webhooks, components, plus custom companions when enabled); `--to-spec pets/get/index.ts` prints the owning pointer — both directions print one stable line per location and exit non-zero with `ZOPIA_CONFIG_INVALID` for unmatched pointers/files or `ZOPIA_DOCS_MISSING_MANIFEST` for generation-less roots | `zopia navigate api_docs --to-spec pets/get/index.ts` |

### 📏 CLI contract

| # | Contract |
| --- | --- |
| R-931 | Boolean flags are additive and default to `false` when absent; `--custom` enables the merge-safe companion layer ([07 → R-744](07-api-docs.md#-regeneration--manual-edits-phase-1-policy)); `--no-manifest` is the explicit inverse of the default-on manifest option; `--watch` (S-88) is generate-only and requires a spec **file path** — it watches the spec's parent directory so atomic editor saves (`write-temp` + rename) still trigger a regeneration, coalesces change bursts, prints per-run errors to stderr while continuing, and never writes a partial tree beyond the failing run's first output. With a [project config file](09-configuration.md#-zopiaconfigts--project-defaults-v02x-d-19), config values fill every option the flags leave unset, and every explicit flag still wins (D-19); the `<output-dir>` positional is required unless the config supplies `generate.outDir`. |
| R-932 | Parsing is strict and completes before either engine runs: options may surround positional arguments, but unknown, command-incompatible, repeated, or valueless options and missing/extra positionals fail with `ZOPIA_CONFIG_INVALID` at the offending argument. |
| R-933 | Data uses stdout (or the selected `--out` file); warnings and errors use stderr. Exit status is `0` success, `1` typed user/configuration failure, and `2` unexpected internal failure. |
| R-934 | `-h`/`--help` lists the complete grammar and warns that reverse conversion executes generated TypeScript from trusted trees. `--config <path>` selects an explicit config file on every command; loading, discovery, and validation rules live in [09-configuration](09-configuration.md#-zopiaconfigts--project-defaults-v02x-d-19). `zopia validate`, `zopia diff`, and `zopia navigate` have no configurable knobs yet — a named config file only needs to load. |

Both commands print warnings only to stderr as
`Warning: ZOPIA_WARN_* <pointer>: <message>`. In particular, `zopia reverse`
keeps stdout as valid OpenAPI JSON even when warnings are present; `--out`
writes only JSON to the selected file. `zopia validate` instead prints every
diagnostic to **stdout** (`Error|Warning: <CODE> <pointer>: <message>`) followed
by one summary line, keeping stderr for the typed failure tail; exit status is
`1` exactly when an error-severity diagnostic exists (S-89). The same coverage
is available programmatically as `validateZopia(input)` returning
`{ ok, kind, target, diagnostics }`.

> ⚠️ `zopia reverse` executes the TypeScript modules referenced by `apis[].file`
> and non-null `components[].file` entries. Reverse only trusted generated trees,
> and only commit config files you trust — `zopia.config.ts` is executed
> JavaScript under the same model. File paths are restricted to the manifest
> directory (including after symlink resolution), while edited runtime km-api
> metadata and endpoint/component Zod schemas take precedence over their
> manifest snapshots.

Exit codes: `0` success · `1` user error (bad input/options — message on
stderr, hint included) · `2` internal error (should never happen — report it).

## 🧩 Working with the generated tree

| # | Practice | Rule |
| --- | --- | --- |
| R-101 | 📂 **Import, don't re-type** — your app imports the generated `index.ts` files; their Zod schemas *are* the validation | — |
| R-102 | 🔄 **Spec or generation options changed?** re-run `zopia generate` — output is idempotent (P-1); manifest staleness warns on source/config/incomplete-tree drift and safely prunes only obsolete manifest-owned files (`ZOPIA_WARN_STALE_TREE`) | [07 → Regeneration](07-api-docs.md#-regeneration--manual-edits-phase-1-policy) |
| R-103 | ✍️ **Hand edits** — Phase 1 overwrites them on regeneration (see the file banner); the merge-safe custom layer arrives in Phase 3 | [07 → Regeneration](07-api-docs.md#-regeneration--manual-edits-phase-1-policy) |
| R-104 | 🧪 **km-api helpers** — `makeFullPath`, `makeParams`, `convertResponseType`, … are available on every generated config for free | [Concepts → km-api](https://github.com/komeilm76/zopia/blob/main/docs/05-concepts.md#-km-api) |
| R-105 | 🚫 **No zopia import in app code** — generated files depend only on `zod` + `km-api` (R-502) | — |
| R-106 | 🌳 **Runtime tree loading** — when wiring endpoints dynamically beats importing files one by one, `createApiDocs()` from the opt-in `zopia/runtime` subpath turns the whole directory into one nested object (plus the `flattenApiDocs` flat record); generation output is untouched | [07 → Runtime tree consumption](07-api-docs.md#-runtime-tree-consumption--createapidocs) |

### 🌳 Consuming the tree at runtime

Import the dedicated subpath (the package root stays free of
filesystem-importing APIs) and point it at any directory zopia ever generated
into — `directory`, `flat`, and split `multi-tag` / `multi-server` trees all
resolve through their manifests:

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

The type import is optional — without it the results stay permissively typed —
but with it every key is exact: `apiDocs.users.` autocompletes `{userId}`,
`endpoints.` autocompletes the endpoint names, and misspelled keys are compile
errors.

Failures are typed `ZopiaError`s with `at`/`hint` — see
[API docs → Runtime tree consumption](07-api-docs.md#-runtime-tree-consumption--createapidocs).

## 🧯 Error handling

```ts
import { openApiToApiDocs, isZopiaError } from 'zopia';

try {
  // Exact component references import through components/index.ts
  await openApiToApiDocs('swagger.json', { insertComponents: true, useComponentAsReference: true });
} catch (e) {
  if (isZopiaError(e)) {
    console.error(e.code);  // 🆔 'ZOPIA_CONFIG_INVALID'
    console.error(e.hint);  // 💡 'enable `insertComponents` first'
    console.error(e.at);    // 📍 JSON Pointer, option, or file, when discoverable
    console.error(e.cause); // 🔗 original parser/import/filesystem failure, when wrapped
  }
}
```

The full error-code table lives in
[Architecture → Error model](https://github.com/komeilm76/zopia/blob/main/docs/04-architecture.md#-error-model).

## 🔗 Next

- ⚙️ Every option → [Configuration](09-configuration.md)
- 🧪 How all of this is tested → [Testing](https://github.com/komeilm76/zopia/blob/main/docs/11-testing.md)
