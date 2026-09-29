# 📄 API Docs Format

The **api docs** are zopia's main artifact: an `api_docs/` directory where
every endpoint becomes an `index.ts` file built with `makeApiConfig()` from
**km-api** (the make function), validated by **Zod v4** schemas.

Path-level parameters are merged with operation-level parameters; an
operation-level declaration with the same `name` and `in` overrides the
path-level declaration.

This document is the *output contract* — layout, naming, file format, and the
manifest.

> 📌 **Rule R-701** — the generated tree is a *contract*, not a suggestion.
> Any tool (including engine ④) may rely on every invariant stated here.

## 🧪 The canonical example

All layout examples in this document derive from one spec — the **Admin API**
(OpenAPI 3.0.3). It is also the primary golden fixture of the test suite:

```text
📄 Admin API v1.2.0
├── GET   /users/{userId}    → 200 User · 404 Problem   (path: userId uuid)
├── PATCH /users/{userId}    → 200 User · default      (body: CreateUser)
└── GET   /health            → 204                     (public override)

🧱 components.schemas: User · CreateUser
🔐 securitySchemes: oauth (client credentials) — document default; health opts out
```

## 📂 Mode — `directory` (default)

> 🎯 **T-5** — *convert API addresses to nested directories; the last level of
> the path is a directory named after the method; inside it lives the `index` file.*

Each path segment becomes a directory; **then** one more directory named after
the method (lowercase); **then** `index.ts`:

```text
api_docs/
├── .zopia-manifest.json
├── health/
│   └── get/
│       └── index.ts              # 📡 GET   /health
└── users/
    └── {userId}/
        ├── get/
        │   └── index.ts          # 📡 GET   /users/{userId}
        └── patch/
            └── index.ts          # 📡 PATCH /users/{userId}
```

**Invariants**

| # | Invariant |
| --- | --- |
| R-711 | 🛣️ Path segments (including `{param}` segments — braces preserved, so the path is recoverable from the tree alone) form the directory chain under `api_docs/` |
| R-712 | 🧭 The method directory is **always** the child of the path-leaf directory, named with the **lowercase** method — the eight standard methods: `get`, `post`, `put`, `delete`, `head`, `options`, `patch`, `trace` (km-api ≥ 0.4.1) |
| R-713 | 📄 The file is **always** named `index.ts` — `.ts` format, TypeScript (T-7) |
| R-714 | 🔀 A literal segment may equal a method name (e.g. path `/users/get`): within the endpoint area (outside `components/`, whose component dirs also hold an `index.ts`) the tree stays formally unambiguous — **a directory containing `index.ts` is a method directory; every other directory is a path segment** (method dirs hold exactly that one file, R-713). If another path would place directories beneath a method directory, the conflicting literal segment receives `-2`, `-3`, … regardless of source order. The manifest (D-06) remains the *authority* engine ④ reads, tree shape only a convenience |

## 📂 Mode — `flat`

> 🎯 **T-6** — *one directory per API, then the method directory, then the
> `index` file.*

The full path is flattened into **one** directory name: segments joined by
`-`, braces preserved:

```text
api_docs/
├── .zopia-manifest.json
├── health/
│   └── get/
│       └── index.ts              # 📡 GET   /health
└── users-{userId}/
    ├── get/
    │   └── index.ts              # 📡 GET   /users/{userId}
    └── patch/
        └── index.ts              # 📡 PATCH /users/{userId}
```

| # | Invariant |
| --- | --- |
| R-721 | 🏷️ Flat name = path segments (minus leading `/`) joined by `-`; `{param}` segments keep their braces |
| R-722 | ⚠️ Two *different* paths may flatten to the same name (e.g. `/admin/users` and `/admin-users`). The second one gets a numeric suffix `-2`, `-3`, … — the manifest always holds the truth, the name is only an ergonomic label |
| R-723 | 🧭 Method directory + `index.ts` — identical to directory mode (R-712/R-713) |

> 💡 Because flat names can collide *in principle*, **engine ④ relies on the
> manifest, never on tree shape**, in both modes (D-06).

## 🧭 Ergonomic facade-path helper

`apiDocsFacadeAccess(path, method, root?)` returns a safe TypeScript access path
for callers that build an optional nested facade around direct endpoint imports:

```ts
apiDocsFacadeAccess('/applicant/{applicantId}/exame/{examId}', 'get');
// → apiDocs.applicant["{applicantId}"].exame["{examId}"].get
```

Ordinary segments become normalized camel-case properties; parameter segments
stay in bracket notation. The helper rejects unsafe property names, malformed
templates, duplicate parameters, unsupported methods, and unsafe roots. Engine ③
does not emit a facade module in v0.1.0: direct imports are the generated
file-level API, and the manifest remains authoritative (D-06).

## 🧬 Operation contract extraction

Before rendering an endpoint, zopia normalizes each operation into an
intermediate representation and preserves request/response media types. The
first content-bearing media type is emitted verbatim; malformed content, `null`
schema nodes, malformed schema-component maps, and unresolved request/response
`$ref` values are errors, never silently replaced or dropped. Endpoint rendering
either inlines reusable schema references or imports emitted
components according to the selected component options.

## 📄 The `index.ts` contract

Every endpoint file follows this generated shape (T-7 — *all practical content is
filled with the make function*). This is the checked-in canonical GET endpoint:

```ts
/** Generated by zopia — do not edit by hand. */
import { z } from 'zod';
import { makeApiConfig } from 'km-api';

export const getUser = makeApiConfig({
  method: "GET",
  pathShape: "/users/{userId}",
  operationId: "getUser",

  responseContentType: "application/json" as unknown as import('km-api').IResponseContentType,
  deprecated: 'YES',
  auth: "YES",
  summary: "Get a user",
  description: "Returns one user",
  tags: ["#users"],
  examples: JSON.parse("{\"response\":{\"200\":{\"default\":{\"value\":{\"email\":\"admin@example.test\",\"id\":\"22ccbc6a-436b-4b1c-9e64-7440ce63a90e\",\"role\":\"admin\"}}}}}"),
  request: { body: z.any(),  params: z.object({ ["userId"]: z.string().uuid() }), query: z.object({  }), headers: z.object({ ["X-Trace-Id"]: z.string().optional() }), cookies: z.object({  }) },
  response: { 200: z.object({ ["email"]: z.string().email(), ["id"]: z.string().uuid(), ["nickname"]: z.string().nullable().optional(), ["role"]: z.enum(["admin","viewer"]).optional() }).strict().meta({"title":"User","description":"A user account"}), 404: z.object({  }).passthrough() },
});

export default getUser;
// Source: "Admin API v1.2.0"
```

### 🧾 Field-filling policy (IR → `makeApiConfig`)

| 🧬 IR / spec fact | 📄 Where it lands | 🆔 Rule |
| --- | --- | --- |
| `method` | `method` (uppercase) | R-731 |
| `path` | `pathShape` (OpenAPI `{param}` syntax — D-05) | R-731 |
| `summary` | `summary` | R-731 |
| `description` | `description` (Markdown passes through) | R-731 |
| `tags` | `tags` — km-api convention: each prefixed with `#` | R-731 |
| effective `security` requirements | `auth: 'YES'` when authentication is required; absent/empty requirements or an empty `{}` alternative → `'NO'` (always emitted explicitly). Exact schemes/scopes remain manifest-owned | R-731 |
| `request.body` | `request.body`; *no body* → `z.any()` | R-731 |
| `request.params / query / headers / cookies` | `request.params / query / headers / cookies` — always `z.object(…)` (km-api requires all five) | R-731 |
| `requestContentType` | `requestContentType` — exact MIME string emitted with a type-only `IRequestContentType` boundary assertion because published km-api 0.4.1 enumerates known values while OpenAPI is open; the unchanged runtime string becomes the reverse-trip `content` key | R-731 |
| `responseContentType` | `responseContentType` (from the first content-bearing response) — exact MIME string emitted with the corresponding narrow boundary assertion; the unchanged runtime string becomes the reverse-trip `content` key | R-731 |
| `response.statuses[]` | `response` — `code: schema`; no-content status (204) → `z.void()` — **zopia's own marker**, deliberately not `z.object({})` (the shape km-api's README examples use for 204 — both typecheck, response values accept any Zod schema): `z.void()` is the unambiguous no-content marker, and engine ④ detects it *before* engine ① (Zod lists `z.void()` as unrepresentable, R-614) so it emits **no `content` at all**; a real `z.object({})` stays a schema. Valid custom codes (`100`–`599`) and `default` are emitted as numeric/`default` keys, while OpenAPI-only `1XX`–`5XX` ranges use quoted keys (km-api ≥ 0.4.1); response `headers` have no km-api home → `responseOverlay` (R-754) | R-731 |
| `deprecated: true` | `deprecated: 'YES'` (km-api ≥ 0.4.1); omitted when false | R-731 |
| `examples` | `examples` — km-api's `request` / `response` maps of `IExamplesMap` | R-731 |
| `operationId` | the config's `operationId` field (km-api ≥ 0.4.1) **and** the export identifier (see Naming below) | R-732 |

> 📌 **Rule R-732** — the export identifier is the `operationId` when present
> (camelCased); otherwise derived deterministically: **method + PascalCase of
> every path segment** (parameter braces stripped), e.g.
> `get` + `Admin` + `Users` + `Id` → `getAdminUsersId`. A file has exactly one
> endpoint export — named **and** `default`.

### 📦 Self-contained by default

With the default options (`insertComponents: false`), every `index.ts` imports
**only** `zod` and `km-api` (R-502): each component use is inlined into its
request/parameter/response expression (R-403). Cross-file imports appear
**only** when `useComponentAsReference` is `true` — see
[Components](08-components.md).

## 📦 The manifest — `.zopia-manifest.json`

> 🎯 **T-10** — the manifest is what makes every conversion reversible (D-06).
> It is written by default (the `manifest` option, on unless explicitly
> disabled — [Configuration](09-configuration.md)), has no timestamps or
> environment data (P-1), is always hidden (dotfile), and always versioned
> (`"$schema": "zopia:manifest@1"`). The dedicated writer validates the complete
> writer-owned shape before output, recursively orders object keys, preserves
> semantic array order, and writes through a sibling temporary file before an
> atomic rename. Identical JSON input and generation options therefore produce
> byte-identical manifest content with exactly one trailing newline; a failed
> validation or write never exposes a partial manifest.

```jsonc
{
  "$schema": "zopia:manifest@1",
  "zopiaVersion": "0.1.0",
  "mode": "directory",
  "options": {
    "insertComponents": false,
    "useComponentAsReference": false
  },
  "pathOrder": ["/health", "/users/{userId}"],
  "schemaComponentsPresent": true,
  "source": {
    "kind": "openapi-3.0",
    "openapiVersion": "3.0.3",
    "title": "Admin API",
    "version": "1.2.0",
    "sha256": "de6afdd09c3db1444044438bca0ed29c28a7876d786cb4750f254b898e11ac10"
  },
  "servers": [
    { "description": "Production", "url": "https://api.example.test/v1" },
    { "description": "Staging", "url": "https://staging.example.test/v1" }
  ],
  "tags": [{ "description": "User administration", "name": "users" }],
  "securitySchemes": {
    "oauth": { "type": "oauth2", "flows": { "clientCredentials": { "tokenUrl": "https://auth.example.test/token", "scopes": { "users:read": "Read users", "users:write": "Write users" } } } }
  },
  "defaultSecurity": [{ "oauth": ["users:read"] }],
  "components": [
    // One entry per declaration; file is null in default mode. Schema shortened.
    {
      "file": null,
      "name": "User",
      "overlay": [],
      "schema": { "type": "object", "title": "User", "required": ["id", "email"], "properties": { "…": "…" } }
    }
  ],
  "apis": [
    // Abbreviated getUser entry; the manifest also contains health/updateUser.
    {
      "file": "users/{userId}/get/index.ts",
      "path": "/users/{userId}",
      "method": "get",
      "operationId": "getUser",
      "refs": [
        { "at": "/parameters/0/$ref", "ref": "#/components/parameters/TraceId" },
        { "at": "/responses/200/content/application~1json/schema/$ref", "component": "User", "ref": "#/components/schemas/User" },
        { "at": "/responses/200/content/application~1xml/schema/$ref", "component": "User", "ref": "#/components/schemas/User" },
        { "at": "/responses/404/$ref", "ref": "#/components/responses/Problem" }
      ],
      "overlay": [],
      "responseOverlay": [
        { "status": "200", "headers": { "ETag": { "schema": { "type": "string" } } } }
      ],
      "sourceOperation": { "…": "full detached operation snapshot" }
    }
  ]
}
```

| 🧾 Key | 📝 What engine ④ needs it for |
| --- | --- |
| `source` | 🏷️ rebuild `info`; retain the exact source `openapi` patch string in `source.openapiVersion`; verify the tree matches the spec it claims to come from |
| `pathOrder` | 🧭 retain source `paths` key order so reverse regeneration makes the same collision decisions; it also records operation-free and completely empty Path Items that have no endpoint file or overlay |
| `schemaComponentsPresent` | 🧱 distinguish an absent schema-component container from an explicitly empty Swagger `definitions: {}` or OpenAPI `components.schemas: {}` declaration |
| `servers`, `tags`, `securitySchemes` | 🌍🏷️🔐 document frame that has no home in Zod; presence is retained independently from value, so absent and explicitly empty collections round-trip differently (R-656/R-657) |
| `pathsOverlay` | 🛣️ path-item metadata (`summary`, `description`, shared parameters, local `$ref`, extensions) and `paths` extensions that endpoint modules cannot own |
| `components[].schema` | 🧱 the **full** component JSON Schema — restored verbatim into `components.schemas` (R-655/R-751) |
| `componentsOverlay` | 🧰 non-schema OpenAPI component sections such as reusable parameters, responses, headers, examples, links, callbacks, and path items |
| `swaggerParameters`, `swaggerResponses` | 🧰 Swagger 2.0 reusable parameter and response definitions, restored at the document root |
| `components[].file` | 🧱 where to find the emitted component file (`null` ⇔ not emitted — `insertComponents` was `false`); when set, `manifestFileToOpenApi()` imports its Zod schema and converts it to the source dialect, so developer edits win while cross-component references remain `$ref`s |
| `components[].overlay` | 🩹 schema-local Engine ② restorations for emitted components; applied after runtime Zod serialization, with empty-string `at` addressing the component root |
| `apis[]` | 📡 **exact** file → (path, method, operationId) mapping — `manifestFileToOpenApi()` imports each file and uses its runtime km-api metadata plus request/response Zod schemas; `pathItemRef: true` marks an unchanged operation inherited only through a path-item `$ref`, preventing reverse conversion from duplicating it beside that ref; the manifest supplies unsupported overlays and exact security facts |
| `defaultSecurity` | 🔐 the spec-level `security` requirement list, verbatim — applies to every operation unless the operation declares its own `security`; key absent ⇔ the source had no global `security` |
| `apis[].security` | 🔐 the operation's own `security` requirement list — present only when the operation declares the key (including an explicit `[]` = "no security"); km-api's config can store only the `auth` boolean, so the actual requirement (which schemes, which scopes) lives here (R-653/R-656) |
| `apis[].refs` | 🔗 `$ref` placement: JSON pointer (relative to the operation subtree), exact local `ref`, and schema component name when applicable (R-752/R-659); `$ref`-looking literal data inside examples/defaults/enums/consts/extensions is excluded |
| `apis[].overlay` | 🩹 keyword-level restorations & frozen subtrees — the non-representable facts, verbatim (R-753/R-635) |
| `apis[].responseOverlay` | 🚦 response facts with no km-api home — response `headers` and future non-schema fields, restored after code-derived response schemas/content (R-754) |
| `source.sha256` | 🆔 canonical source identity: regeneration compares it with the normalized new input, alongside `mode` and component options, to detect a stale tree without false positives from object-key order |

Presence is part of the reversible contract: an absent optional field remains absent rather than becoming `false`, and explicit empty schema containers, empty Path Items, unconstrained boolean schemas, schema-less media objects, and schema-local definition containers survive file-backed reverse conversion exactly.

Before importing any code, `manifestFileToOpenApi()` verifies that every `apis[].file` and every non-null `components[].file` still resolves to a regular file inside the manifest directory. Missing or renamed entries fail the whole preflight with `ZOPIA_DOCS_MANIFEST_MISMATCH`; no earlier module is executed.

Security requirements remain manifest-owned because km-api stores only `auth: 'YES' | 'NO'`: an operation-level requirement (including `[]`, or the recoverable `sourceOperation.security` in a legacy manifest) wins first, then `defaultSecurity` applies. Runtime `auth: 'YES'` triggers a reverse fallback only when neither source records a requirement. That fallback emits one `ZOPIA_WARN_DEFAULT_SECURITY` warning per affected operation, reuses one deterministic bearer scheme across operations, and never overwrites an existing incompatible `bearerAuth` definition (it selects `bearerAuth2`, `bearerAuth3`, and so on). OpenAPI 3 output receives an HTTP bearer scheme; source-preserving Swagger 2.0 output receives an `Authorization` header `apiKey` approximation because Swagger 2.0 has no HTTP bearer scheme type.

> 📌 **Rule R-751** — the manifest carries a **full** `schema` for every
> declared component, in every mode. `schemaComponentsPresent` separately
> retains an explicitly empty declaration. The component snapshot is the
> verbatim source of `components.schemas` on the reverse trip; when `file` is set, the imported
> file takes precedence (the code is the truth, D-08), followed only by the
> component's R-635 overlay for facts Zod cannot serialize.
>
> 📌 **Rule R-752** — `refs` entries address **the source operation subtree**
> with RFC 6901 pointers relative to `paths.<path>.<method>` (so `/` inside a
> media type is encoded as `~1`). File-based reverse conversion restores that
> placement after schema serialization. If runtime code already emits a
> different component `$ref`, both the source ref and overlays beneath it are
> skipped so the developer-selected target wins. Older manifests whose media
> type segments were not escaped remain readable.
>
> 📌 **Rule R-753** — `overlay` entries are `{ at, set?, remove?, node? }`
> (R-635). `node`-form entries retain a subtree's original form while the
> generated reference-free subtree still matches its deterministic baseline;
> an edit skips that restoration. Reference-bearing frozen subtrees remain
> manifest-owned when no independent local baseline can be built. The generated
> position carries a `// @zopia:warn ZOPIA_WARN_FROZEN_SUBTREE` comment so
> developers can see the boundary.
>
> 📌 **Rule R-754** — `apis[].responseOverlay` records the response facts that
> have no home in km-api (today: response `headers`; any future
> non-expressible response field joins it). Engine ④ merges those fields into
> response statuses that still exist after code conversion; code-derived
> `content`, Swagger `schema`, examples, and changed/removed statuses remain
> authoritative. Everything else km-api can express — incl. `trace` operations, custom status
> codes, `default` responses, and arbitrary media types (km-api ≥ 0.4.1, R-642)
> — lives in the generated code.

## 🏷️ Naming conventions (fixed)

| 🧩 Thing | 📏 Convention | Example |
| --- | --- | --- |
| Endpoint export (with `operationId`) | `operationId` camelCased | `getUser` |
| Endpoint export (derived) | `method + PascalCase(segments)` — braces stripped; synthetic collisions receive `2`, `3`, while explicit IDs remain authoritative | `getAdminUsersId` |
| Directory-mode directories | path segments verbatim (braces preserved); collapsed/root/case/component-file collisions receive `-2`, `-3` on the conflicting segment or leaf, including method-directory prefix conflicts | `admin/users/{id}` |
| Flat-mode directory | segments joined by `-` (braces preserved); collisions → `-2`, `-3`; a name equal to the enabled `.zopia-manifest.json` file is also disambiguated | `admin-users-{id}` |
| Method directories | lowercase method | `get` |
| Component directories | exact component name (case preserved — round-trip) | `User`, `CreateUser` |
| Component export | `<ComponentName>Schema` (a name already ending in `Schema` is kept as-is) | `UserSchema` |
| The file | always `index.ts` | — |

## 🔄 Regeneration & manual edits (Phase 1 policy)

| # | Rule |
| --- | --- |
| R-741 | ♻️ **Idempotent** — same input + options ⇒ byte-identical tree (P-1); canonical hashing ignores object-key order, so a semantically identical reorder is not stale |
| R-742 | ✍️ **Overwrite & prune ownership** — generation rewrites files whose rendered bytes differ and skips byte-identical files entirely, so unchanged files keep their mtimes and watch-mode/bundler tooling stays quiet (D-24); after a successful generation it removes obsolete files listed by the previous valid manifest and then removes only empty generated directories. Unlisted/custom files are never pruned |
| R-743 | ⚠️ **Stale tree** — source-hash drift, layout/component/`custom`-option drift, missing manifest-owned files, disabling manifest output, and invalid existing manifests produce one deterministic `ZOPIA_WARN_STALE_TREE` at `.zopia-manifest.json`. Invalid manifests are replaced/removed but are not trusted to identify old artifacts. Unsafe symlinked path ancestors instead fail with `ZOPIA_FS_OUTSIDE_OUTDIR` before that path is written |
| R-744 | 🧩 **Merge-safe custom companions** (D-24, opt-in) — with `custom: true` (CLI `--custom`) every endpoint and webhook module appends `export * as custom from './custom';` and zopia scaffolds a sibling `custom.ts` **exactly once**: any existing file or symlink at that path is left untouched, never overwritten and never deleted by staleness pruning, and toggling the option off only drops the export line. Components get no companions |

## 🔗 Next

- 🧱 What changes when components are emitted → [Components](08-components.md)
- ⚙️ Every option that shapes this output → [Configuration](09-configuration.md)
