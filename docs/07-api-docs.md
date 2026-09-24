# 📄 API Docs Format

The **api docs** are zopia's main artifact: an `api_docs/` directory where

Path-level parameters are merged with operation-level parameters; an operation-level declaration with the same `name` and `in` overrides the path-level declaration.
every endpoint becomes an `index.ts` file built with `makeApiConfig()` from
**km-api** (the make function), validated by **Zod v4** schemas. This document
is the *output contract* — layout, naming, file format, and the manifest.

> 📌 **Rule R-701** — the generated tree is a *contract*, not a suggestion.
> Any tool (including engine ④) may rely on every invariant stated here.

## 🧪 The canonical example

All layout examples in this document derive from one spec — the **Admin API**
(OpenAPI 3.0.3). It is also the primary golden fixture of the test suite:

```text
📄 Admin API v1.0.0
├── GET    /admin/users          → 200 list · 401          (query: page, limit)
├── POST   /admin/users          → 201 User · 400          (body: UserInput)
├── GET    /admin/users/{id}     → 200 User · 401 · 404    (param: id uuid)
└── DELETE /admin/users/{id}     → 204 · 401 · 404         (param: id uuid)

🧱 components.schemas: User · UserInput · Error
🔐 securitySchemes: bearerAuth (http/bearer/JWT) — used by every operation
```

## 📂 Mode — `directory` (default)

> 🎯 **T-5** — *convert API addresses to nested directories; the last level of
> the path is a directory named after the method; inside it lives the `index` file.*

Each path segment becomes a directory; **then** one more directory named after
the method (lowercase); **then** `index.ts`:

```text
api_docs/
├── .zopia-manifest.json
└── admin/
    └── users/
        ├── get/
        │   └── index.ts          # 📡 GET    /admin/users
        ├── post/
        │   └── index.ts          # 📡 POST   /admin/users
        └── {id}/
            ├── get/
            │   └── index.ts      # 📡 GET    /admin/users/{id}
            └── delete/
                └── index.ts      # 📡 DELETE /admin/users/{id}
```

**Invariants**

| # | Invariant |
| --- | --- |
| R-711 | 🛣️ Path segments (including `{param}` segments — braces preserved, so the path is recoverable from the tree alone) form the directory chain under `api_docs/` |
| R-712 | 🧭 The method directory is **always** the child of the path-leaf directory, named with the **lowercase** method — the eight standard methods: `get`, `post`, `put`, `delete`, `head`, `options`, `patch`, `trace` (km-api ≥ 0.4.0) |
| R-713 | 📄 The file is **always** named `index.ts` — `.ts` format, TypeScript (T-7) |
| R-714 | 🔀 A literal segment may equal a method name (e.g. path `/users/get`): within the endpoint area (outside `components/`, whose component dirs also hold an `index.ts`) the tree stays formally unambiguous — **a directory containing `index.ts` is a method directory; every other directory is a path segment** (method dirs hold exactly that one file, R-713). The manifest (D-06) remains the *authority* engine ④ reads, tree shape only a convenience |

## 📂 Mode — `flat`

> 🎯 **T-6** — *one directory per API, then the method directory, then the
> `index` file.*

The full path is flattened into **one** directory name: segments joined by
`-`, braces preserved:

```text
api_docs/
├── .zopia-manifest.json
├── admin-users/
│   ├── get/
│   │   └── index.ts              # 📡 GET    /admin/users
│   └── post/
│       └── index.ts              # 📡 POST   /admin/users
└── admin-users-{id}/
    ├── get/
    │   └── index.ts              # 📡 GET    /admin/users/{id}
    └── delete/
        └── index.ts              # 📡 DELETE /admin/users/{id}
```

| # | Invariant |
| --- | --- |
| R-721 | 🏷️ Flat name = path segments (minus leading `/`) joined by `-`; `{param}` segments keep their braces |
| R-722 | ⚠️ Two *different* paths may flatten to the same name (e.g. `/admin/users` and `/admin-users`). The second one gets a numeric suffix `-2`, `-3`, … — the manifest always holds the truth, the name is only an ergonomic label |
| R-723 | 🧭 Method directory + `index.ts` — identical to directory mode (R-712/R-713) |

> 💡 Because flat names can collide *in principle*, **engine ④ relies on the
> manifest, never on tree shape**, in both modes (D-06).

## 🧭 Optional ergonomic facade

In addition to direct file imports, generated API docs may expose a nested facade:

```ts
import apiDocs from './api_docs';

apiDocs.applicant.exame.all["{id}"].get({ id: 'exam-123' });
```

Ordinary path segments use normalized camel-case properties. Path parameters are
kept in explicit bracket notation, so they cannot be confused with ordinary path
segments:

```text
/applicant/{applicantId}/exame/{examId}
→ apiDocs.applicant["{applicantId}"].exame["{examId}"].get
```

The facade is optional; direct imports remain the canonical file-level API. The
facade rejects unsafe property names, malformed templates, duplicate parameters,
and unsupported methods. The generated manifest remains authoritative (D-06).

## 🧬 Operation contract extraction

Before rendering an endpoint, zopia normalizes each operation into an
intermediate representation and preserves request/response media types. The
first content-bearing media type is emitted verbatim; malformed content and
unresolved request/response `$ref` values are errors, never silently dropped.
A later components phase resolves reusable references.

## 📄 The `index.ts` contract

Every endpoint file has exactly this shape (T-7 — *all practical content is
filled with the make function*):

```ts
/**
 * ⚠️ Generated by zopia v0.1.0 — do not edit by hand;
 *    manual edits are overwritten on regeneration (Phase 1).
 *
 * Endpoint : GET /admin/users/{id}
 * Source   : Admin API v1.0.0
 */
import { z } from 'zod';
import { makeApiConfig } from 'km-api';

// ⤵ hoisted: used by 401 *and* 404 (R-403)
const error = z.object({
  message: z.string(),
});

/**
 * Get user by ID
 *
 * Retrieves a single user by their unique identifier.
 */
export const getUser = makeApiConfig({
  method: 'GET',
  pathShape: '/admin/users/{id}',
  auth: 'YES',
  operationId: 'getUser',
  responseContentType: 'application/json',
  summary: 'Get user by ID',
  description: 'Retrieves a single user by their unique identifier.',
  tags: ['#admin', '#users'],
  request: {
    body: z.any(), // ⤵ no body on GET — km-api requires the field
    params: z.object({
      id: z.uuid(),
    }),
    query: z.object({}),
    headers: z.object({}),
    cookies: z.object({}),
  },
  response: {
    200: z.object({
      id: z.uuid(),
      name: z.string().min(1),
      email: z.email(),
      role: z.enum(['admin', 'editor', 'viewer']).optional(), // ⤵ not in `required` (R-623)
    }),
    401: error,
    404: error,
  },
});

export default getUser;
```

### 🧾 Field-filling policy (IR → `makeApiConfig`)

| 🧬 IR / spec fact | 📄 Where it lands | 🆔 Rule |
| --- | --- | --- |
| `method` | `method` (uppercase) | R-731 |
| `path` | `pathShape` (OpenAPI `{param}` syntax — D-05) | R-731 |
| `summary` | `summary` | R-731 |
| `description` | `description` (Markdown passes through) | R-731 |
| `tags` | `tags` — km-api convention: each prefixed with `#` | R-731 |
| any `security` requirement | `auth: 'YES'` (else `'NO'` — always emitted explicitly) | R-731 |
| `request.body` | `request.body`; *no body* → `z.any()` | R-731 |
| `request.params / query / headers / cookies` | `request.params / query / headers / cookies` — always `z.object(…)` (km-api requires all five) | R-731 |
| `requestContentType` | `requestContentType` — emitted verbatim (km-api 0.4.0 accepts any MIME type); doubles as the `content` key on the reverse trip | R-731 |
| `responseContentType` | `responseContentType` (from the first content-bearing response) — emitted verbatim (km-api 0.4.0 accepts any MIME type); doubles as the `content` key on the reverse trip | R-731 |
| `response.statuses[]` | `response` — `code: schema`; no-content status (204) → `z.void()` — **zopia's own marker**, deliberately not `z.object({})` (the shape km-api's README examples use for 204 — both typecheck, response values accept any Zod schema): `z.void()` is the unambiguous no-content marker, and engine ④ detects it *before* engine ① (Zod lists `z.void()` as unrepresentable, R-614) so it emits **no `content` at all**; a real `z.object({})` stays a schema. Custom codes (`419`, `499`, …) and `default` are emitted as numeric/`default` keys (km-api ≥ 0.4.0); response `headers` have no km-api home → `responseOverlay` (R-754) | R-731 |
| `deprecated` | `disable: 'YES'` | R-731 |
| `examples` | `examples` — km-api's `request` / `response` maps of `IExamplesMap` | R-731 |
| `operationId` | the config's `operationId` field (km-api ≥ 0.4.0) **and** the export identifier (see Naming below) | R-732 |

> 📌 **Rule R-732** — the export identifier is the `operationId` when present
> (camelCased); otherwise derived deterministically: **method + PascalCase of
> every path segment** (parameter braces stripped), e.g.
> `get` + `Admin` + `Users` + `Id` → `getAdminUsersId`. A file has exactly one
> endpoint export — named **and** `default`.

### 📦 Self-contained by default

With the default options (`insertComponents: false`), every `index.ts` imports
**only** `zod` and `km-api` (R-502): components are inlined, repeated shapes
are hoisted to local consts (R-403). Cross-file imports appear **only** when
`useComponentAsReference` is `true` — see [Components](08-components.md).

## 📦 The manifest — `.zopia-manifest.json`

> 🎯 **T-10** — the manifest is what makes every conversion reversible (D-06).
> It is written by default (the `manifest` option, on unless explicitly
> disabled — [Configuration](09-configuration.md)), has no timestamps or
> environment data (P-1), is always hidden (dotfile), and always versioned
> (`"$schema": "zopia:manifest@1"`).

```jsonc
{
  "$schema": "zopia:manifest@1",
  "zopiaVersion": "0.1.0",
  "mode": "directory",
  "options": {
    "insertComponents": false,
    "useComponentAsReference": false
  },
  "source": {
    "kind": "openapi-3.0",
    "title": "Admin API",
    "version": "1.0.0",
    "sha256": "9f2c4d7a1b8e3056c1d4a9f7e2b6c8d0a13f5e7b9c2d4a6e8f0b1c3d5a7e9f1b"
  },
  "servers": ["/"],
  "tags": [
    { "name": "admin", "description": "Admin area" },
    { "name": "users", "description": "User management" }
  ],
  "securitySchemes": {
    "bearerAuth": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" }
  },
  "defaultSecurity": [{ "bearerAuth": [] }], // ⤵ global `security` requirement list, verbatim
  "components": [
    // ⤵ one entry per declared component, always — even when not emitted.
    //    `file` is null while insertComponents is false; `schema` is the full
    //    JSON Schema, restored verbatim by engine ④ (R-751). Content elided here.
    {
      "name": "User",
      "file": null,
      "title": "User",
      "example": null,
      "schema": { "type": "object", "required": ["id", "name", "email"], "properties": { "…": "…" } }
    }
  ],
  "apis": [
    // ⤵ full shape shown for one API; the other three entries share the same
    //    structure (listUsers, createUser, deleteUser).
    {
      "file": "admin/users/{id}/get/index.ts",
      "path": "/admin/users/{id}",
      "method": "get",
      "operationId": "getUser",
      // ⤵ no `security` key — the operation declares none of its own, so the
      //    top-level `defaultSecurity` applies (an operation that *does*
      //    declare `security` — even `[]` — gets its own key here, verbatim)
      "refs": [
        { "at": "/responses/200/content/application/json/schema", "component": "User" },
        { "at": "/responses/401/content/application/json/schema", "component": "Error" },
        { "at": "/responses/404/content/application/json/schema", "component": "Error" }
      ],
      "overlay": [],         // ⤵ empty — the Admin API uses no lossy keywords (asserted in tests)
      "responseOverlay": []  // ⤵ response facts with no km-api home (e.g. response headers)
    }
  ]
}
```

| 🧾 Key | 📝 What engine ④ needs it for |
| --- | --- |
| `source` | 🏷️ rebuild `info`; verify the tree matches the spec it claims to come from |
| `servers`, `tags`, `securitySchemes` | 🌍🏷️🔐 document frame that has no home in Zod (R-656/R-657) |
| `components[].schema` | 🧱 the **full** component JSON Schema — restored verbatim into `components.schemas` (R-655/R-751) |
| `components[].file` | 🧱 where to find the emitted component file (`null` ⇔ not emitted — `insertComponents` was `false`); when set, the imported file wins over `schema` (developer edits) |
| `apis[]` | 📡 **exact** file → (path, method, operationId) mapping — the single source of truth for engine ④ |
| `defaultSecurity` | 🔐 the spec-level `security` requirement list, verbatim — applies to every operation unless the operation declares its own `security`; key absent ⇔ the source had no global `security` |
| `apis[].security` | 🔐 the operation's own `security` requirement list — present only when the operation declares the key (including an explicit `[]` = "no security"); km-api's config can store only the `auth` boolean, so the actual requirement (which schemes, which scopes) lives here (R-653/R-656) |
| `apis[].refs` | 🔗 `$ref` placement: JSON pointer (relative to the operation subtree) → component name (R-752/R-659) |
| `apis[].overlay` | 🩹 keyword-level restorations & frozen subtrees — the non-representable facts, verbatim (R-753/R-635) |
| `apis[].responseOverlay` | 🚦 response facts with no km-api home — response `headers` (and any future non-expressible response fields) — full Response Objects, re-emitted verbatim (R-754) |
| `source.sha256` | 🆔 staleness detection: regeneration warns when the tree's manifest hash differs from the new input |

> 📌 **Rule R-751** — the manifest carries a **full** `schema` for every
> declared component, in every mode. It is the verbatim source of
> `components.schemas` on the reverse trip; when `file` is set, the imported
> file takes precedence (the code is the truth, D-08).
>
> 📌 **Rule R-752** — `refs` entries address **the source operation subtree**
> (pointer relative to `paths.<path>.<method>`). Engine ④ applies them after
> conversion, so `$ref` placement — including refs *inside* inlined schemas —
> is restored exactly (R-659).
>
> 📌 **Rule R-753** — `overlay` entries are `{ at, set?, remove?, node? }`
> (R-635). `node`-form entries freeze a subtree to its original form; the
> corresponding generated position carries a `// @zopia:warn
> ZOPIA_WARN_FROZEN_SUBTREE` comment, so developers see what is not live.
>
> 📌 **Rule R-754** — `apis[].responseOverlay` records the response facts that
> have no home in km-api (today: response `headers`; any future
> non-expressible response field joins it). Entries are full OpenAPI Response
> Objects keyed by status code (or `default`); engine ④ re-emits them verbatim
> (R-654c), so the boundary is a *code* convenience, never a data loss.
> Everything else km-api can express — incl. `trace` operations, custom status
> codes, `default` responses, and arbitrary media types (km-api ≥ 0.4.0, R-642)
> — lives in the generated code.

## 🏷️ Naming conventions (fixed)

| 🧩 Thing | 📏 Convention | Example |
| --- | --- | --- |
| Endpoint export (with `operationId`) | `operationId` camelCased | `getUser` |
| Endpoint export (derived) | `method + PascalCase(segments)` — braces stripped | `getAdminUsersId` |
| Directory-mode directories | path segments verbatim (braces preserved) | `admin/users/{id}` |
| Flat-mode directory | segments joined by `-` (braces preserved); collisions → `-2`, `-3` | `admin-users-{id}` |
| Method directories | lowercase method | `get` |
| Component directories | exact component name (case preserved — round-trip) | `User`, `UserInput` |
| Component export | `<ComponentName>Schema` (a name already ending in `Schema` is kept as-is) | `UserSchema` |
| Local hoisted consts (R-403) | component name camelCased, else first property camelCased | `error`, `user` |
| The file | always `index.ts` | — |

## 🔄 Regeneration & manual edits (Phase 1 policy)

| # | Rule |
| --- | --- |
| R-741 | ♻️ **Idempotent** — same input + options ⇒ byte-identical tree (P-1); safe to re-run any time |
| R-742 | ✍️ **Overwrite** — Phase 1 overwrites generated files; the header banner says so. A merge-safe custom layer (companion `custom` files) is a Phase 3 feature |
| R-743 | ⚠️ **Stale input** — if the new input spec's hash differs from the manifest, generation proceeds **and** the result carries warning `ZOPIA_WARN_STALE_TREE` |

## 🔗 Next

- 🧱 What changes when components are emitted → [Components](08-components.md)
- ⚙️ Every option that shapes this output → [Configuration](09-configuration.md)
