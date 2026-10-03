# ⚡ Quick start

From an OpenAPI file to type-safe, runnable endpoint code — in five minutes.

> 📦 Not installed yet? → [Installation](installation.md)

## 1️⃣ Generate the tree

```bash
bunx zopia generate openapi.json api_docs
```

Input may be **Swagger 2.0** or **OpenAPI 3.0/3.1**, as `.json`, `.yaml`, or
`.yml`. The command writes one `index.ts` per operation plus a manifest:

```text
api_docs/
├── .zopia-manifest.json
├── health/get/index.ts
└── users/{userId}/
    ├── get/index.ts
    └── patch/index.ts
```

Add components when your spec reuses schemas:

```bash
bunx zopia generate openapi.json api_docs \
  --mode directory \
  --insert-components \
  --use-component-as-reference
```

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

> 🧱 What those two flags do, and when you want them, is explained in
> [Components](components.md).

## 2️⃣ Use the generated endpoint

Every `index.ts` default-exports a **km-api** config object with Zod schemas
attached — it is real, runnable, type-safe code:

```ts
import getUser from './api_docs/users/{userId}/get/index';

const url = getUser.makeFullPath({ userId: '550e8400-e29b-41d4-a716-446655440000' });
const body = getUser.makeBody(undefined); // type-safe: GET has no body
```

Helpers such as `makeFullPath`, `makeParams`, and `convertResponseType` come
from km-api for free. The exact file contract is in
[API docs format → the `index.ts` contract](api-docs-format.md#-the-indexts-contract).

> 🚫 Your application never imports `zopia` — the generated files depend only
> on `zod` and `km-api`.

## 3️⃣ Go back to a spec

```bash
bunx zopia reverse api_docs --out openapi.json
```

Engine ④ reads `.zopia-manifest.json`, imports the generated modules, and
rebuilds a complete OpenAPI document. Round-trips are idempotent: regenerating
from the regenerated spec produces the same tree.

## 4️⃣ Keep it honest

```bash
bunx zopia validate openapi.json   # lint the spec: broken refs, collisions, unreachable components
bunx zopia validate api_docs       # check the tree: manifest validity, reverse dry-run, peer drift
bunx zopia diff v1.json v2.yaml    # semantic diff between two specs
bunx zopia generate openapi.json api_docs --watch   # regenerate on every spec save
```

## ⚡ Quick start — the four engines from TypeScript

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
// → schema: a runtime Zod schema equivalent to `code`
// → warnings: structured diagnostics; overlays: exact reverse-conversion restorations

// ── ③ OpenAPI → api docs ───────────────────────────────────
// input: object · JSON/YAML text · .json/.yaml/.yml path
const result = await openApiToApiDocs('swagger.yaml', {
  mode: 'directory',              // 📂 or 'flat'
  insertComponents: false,        // 🧱 default
  useComponentAsReference: false, // 🔗 default
});
console.log(result.files, result.warnings);

// ── ④ api docs → OpenAPI ───────────────────────────────────
const { openapi, warnings: reverseWarnings } = await apiDocsToOpenApi('api_docs', {
  version: '3.1',
});
// → a complete OpenAPI document, ready for JSON.stringify
```

## 5️⃣ Put the options in a config file

```ts
// zopia.config.ts
import { defineConfig } from 'zopia';

export default defineConfig({
  generate: { mode: 'directory', insertComponents: true, useComponentAsReference: true, outDir: 'api_docs' },
  reverse: { version: '3.1', out: 'openapi.json' },
});
```

```bash
bunx zopia generate openapi.json   # output dir and flags now come from the config
```

Explicit CLI flags always beat config values, which always beat built-in
defaults — see [Configuration](configuration.md).

## 🔗 Next

- ⌨️ Every command and flag → [CLI reference](cli.md)
- 🧑‍💻 Every exported function → [Programmatic API](programmatic-api.md)
- 🌳 Load the whole tree at runtime → [Runtime](runtime.md)
- 🧯 Something failed → [Errors & warnings](errors-and-warnings.md)
