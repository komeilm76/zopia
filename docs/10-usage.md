# 🚀 Usage

How to use zopia — installation, the programmatic API (the primary interface),
and the CLI. The API below is the **Phase 1 contract**: fixed by this
documentation, implemented in the next phase, and pinned by tests.

## 📦 Installation

```bash
bun add zopia        # 📦 the toolkit itself (Phase 1: zero runtime deps)
bun add zod km-api   # ⚛️🧱 required by the *generated* files
```

| 📦 Package | 🏷️ Kind | 📝 Why |
| --- | --- | --- |
| `zopia` | dependency | the engines |
| `zod` `^4` | peer | generated schemas validate at runtime |
| `km-api` `^0.4` (0.4.x) | peer | generated files call `makeApiConfig()` |

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
const { code, schema: back, warnings } = jsonSchemaToZod(jsonSchema);
// → code:   'const schema = z.object({\n  name: z.string().min(1),\n  email: z.email(),\n});\n'
// → schema: <runtime Zod object equivalent to `code`>

// ── ③ OpenAPI → api docs ───────────────────────────────────
const result = await openApiToApiDocs('swagger.json', {
  mode: 'directory',            // 📂 or 'flat'
  insertComponents: false,      // 🧱 default
  useComponentAsReference: false, // 🔗 default
});
// → api_docs/admin/users/{id}/get/index.ts …  + .zopia-manifest.json
console.log(result.files, result.warnings);

// ── ④ api docs → OpenAPI ───────────────────────────────────
const { openapi, warnings: w2 } = await apiDocsToOpenApi('api_docs', {
  version: '3.1',
});
// → a complete OpenAPI document, ready for JSON.stringify
```

## 📄 End-to-end — what a developer actually gets

```bash
$ bunx zopia generate swagger.json --mode directory --insert-components --use-component-as-reference
```

```text
api_docs/
├── .zopia-manifest.json
├── components/
│   ├── index.ts
│   ├── User/index.ts
│   ├── UserInput/index.ts
│   └── Error/index.ts
└── admin/users/
    ├── get/index.ts
    ├── post/index.ts
    └── {id}/
        ├── get/index.ts
        └── delete/index.ts
```

…and `api_docs/admin/users/{id}/get/index.ts` is real, runnable, type-safe
code — see the full annotated file in
[API docs format → The `index.ts` contract](07-api-docs.md#-the-indexts-contract).
Drop the tree into your project, import what you need:

```ts
import getUser from './api_docs/admin/users/{id}/get/index';

const url = getUser.makeFullPath({ id: '550e8400-e29b-41d4-a716-446655440000' });
const user = getUser.makeBody(undefined); // type-safe: no body on GET
```

## ⌨️ CLI

> 🚧 The CLI ships with the Phase 1 implementation; flags are already fixed
> by the [Configuration → CLI mapping](09-configuration.md#-cli--options-mapping).

```text
zopia generate <spec.json> <output-dir>   # ③ OpenAPI → api docs
zopia reverse  <manifest.json> [--out openapi.json] # ④ manifest → OpenAPI
```

| 🚩 Command | 📝 What it does | 💡 Example |
| --- | --- | --- |
| `zopia generate` | generates the endpoint tree and manifest | `zopia generate swagger.json api_docs` |
| `zopia reverse` | imports the manifest's endpoint and emitted component modules, then writes the reconstructed OpenAPI document to stdout or `--out` | `zopia reverse api_docs/.zopia-manifest.json --out openapi.json` |

> ⚠️ `zopia reverse` executes the TypeScript modules referenced by `apis[].file`
> and non-null `components[].file` entries. Reverse only trusted generated trees.
> File paths are restricted to the manifest directory (including after symlink
> resolution), while edited runtime km-api metadata and component Zod schemas
> take precedence over their manifest snapshots.

Exit codes: `0` success · `1` user error (bad input/options — message on
stderr, hint included) · `2` internal error (should never happen — report it).

## 🧩 Working with the generated tree

| # | Practice | Rule |
| --- | --- | --- |
| R-101 | 📂 **Import, don't re-type** — your app imports the generated `index.ts` files; their Zod schemas *are* the validation | — |
| R-102 | 🔄 **Spec changed?** re-run `zopia generate` — output is idempotent (P-1) and the manifest warns on stale input (`ZOPIA_WARN_STALE_TREE`) | — |
| R-103 | ✍️ **Hand edits** — Phase 1 overwrites them on regeneration (see the file banner); the merge-safe custom layer arrives in Phase 3 | [07 → Regeneration](07-api-docs.md#-regeneration--manual-edits-phase-1-policy) |
| R-104 | 🧪 **km-api helpers** — `makeFullPath`, `makeParams`, `convertResponseType`, … are available on every generated config for free | [Concepts → km-api](05-concepts.md#-km-api) |
| R-105 | 🚫 **No zopia import in app code** — generated files depend only on `zod` + `km-api` (R-502) | — |

## 🧯 Error handling

```ts
import { openApiToApiDocs, ZopiaError } from 'zopia';

try {
  // Exact component references import through components/index.ts
  await openApiToApiDocs('swagger.json', { insertComponents: true, useComponentAsReference: true });
} catch (e) {
  if (e instanceof ZopiaError) {
    console.error(e.code); // 🆔 'ZOPIA_CONFIG_INVALID'
    console.error(e.hint); // 💡 'enable `insertComponents` first'
    console.error(e.at);   // 📍 where it was found, if applicable
  }
}
```

The full error-code table lives in
[Architecture → Error model](04-architecture.md#-error-model).

## 🔗 Next

- ⚙️ Every option → [Configuration](09-configuration.md)
- 🧪 How all of this is tested → [Testing](11-testing.md)
