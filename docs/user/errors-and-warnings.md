# 🧯 Errors & warnings

Every diagnostic zopia can produce, what causes it, and how to fix it. Codes
are **stable**: they are part of the public contract and safe to branch on in
scripts and CI.

| 🧩 Kind | ❓ Meaning | 🚦 Effect |
| --- | --- | --- |
| **Error** (`ZOPIA_*`) | the operation cannot continue correctly | throws a `ZopiaError`; CLI exits `1` |
| **Warning** (`ZOPIA_WARN_*`) | the conversion succeeded but is an approximation or needed a decision | non-fatal; collected in `warnings`, printed to stderr |

## 🛑 Errors

### Shape

```ts
import { isZopiaError } from 'zopia';

try { /* … */ } catch (error) {
  if (isZopiaError(error)) {
    error.code;   // 🆔 stable ZopiaErrorCode
    error.message;// 📝 human-readable description
    error.at;     // 📍 JSON Pointer, option name, or file path — when discoverable
    error.hint;   // 💡 the recommended fix
    error.cause;  // 🔗 the wrapped parser / import / filesystem failure
  }
}
```

| 🔧 Helper | 📝 What it does |
| --- | --- |
| `isZopiaError(value)` | type guard |
| `asZopiaError(value, code, message, options?)` | normalizes any thrown value into a `ZopiaError` |
| `ZOPIA_ERROR_CODES` | the frozen list of every code |

### ⚙️ Configuration

| 🆔 Code | 🔍 Cause | 💡 Fix |
| --- | --- | --- |
| `ZOPIA_CONFIG_INVALID` | an invalid option, flag, positional, or config-file key — including `useComponentAsReference` without `insertComponents`, an unknown `mode`, an empty `outDir`, a missing `--config` file, a repeated or valueless flag, or an unmatched `navigate` pointer | correct the invalid option or argument (`at` names the offending key/argument) |

### 📄 Spec input

| 🆔 Code | 🔍 Cause | 💡 Fix |
| --- | --- | --- |
| `ZOPIA_SPEC_INVALID_JSON` | the `.json` input is unreadable or not valid JSON | provide readable, valid JSON |
| `ZOPIA_SPEC_INVALID_YAML` | the `.yaml`/`.yml` input is unreadable or not valid YAML 1.2 core schema | provide readable, valid YAML |
| `ZOPIA_SPEC_INVALID` | the document parses but is not a valid Swagger/OpenAPI document | fix the invalid document |
| `ZOPIA_SPEC_UNSUPPORTED_VERSION` | the dialect is neither `swagger: "2.0"` nor `openapi: 3.0.x / 3.1.x` | use Swagger 2.0, OpenAPI 3.0, or OpenAPI 3.1 |
| `ZOPIA_SPEC_MISSING_PATHS` | the document has no `paths` object | add a `paths` object |
| `ZOPIA_SPEC_PATH_REF` | a path item uses a reference zopia cannot resolve | use a valid local path-item reference |

### 🔗 References & schemas

| 🆔 Code | 🔍 Cause | 💡 Fix |
| --- | --- | --- |
| `ZOPIA_REF_NOT_FOUND` | a local `$ref` JSON Pointer has no target | check that the pointer target exists |
| `ZOPIA_REF_EXTERNAL` | an external (cross-file) reference that cannot be bundled — e.g. the input was text/object rather than a file path, or the target lives outside the spec's folder | replace it with a local reference, or pass the spec as a file path so same-folder refs can be bundled |
| `ZOPIA_SCHEMA_INVALID` | a value passed to engine ① or ② is not a valid Zod schema / JSON Schema | provide a valid schema value |

### 📦 Manifest & generated trees

| 🆔 Code | 🔍 Cause | 💡 Fix |
| --- | --- | --- |
| `ZOPIA_MANIFEST_INVALID` | `.zopia-manifest.json` is malformed or carries invalid metadata | regenerate the tree, or fix the metadata |
| `ZOPIA_DOCS_MISSING_MANIFEST` | reverse / navigate / runtime loading was pointed at a directory with no manifest (often generated with `--no-manifest`) | generate api docs first, or pass the manifest path |
| `ZOPIA_DOCS_PRESET_ROOT` | the target is a `--preset` **split root**, which contains several independent trees | reverse one bucket directory instead (the message lists them) |
| `ZOPIA_DOCS_MANIFEST_MISMATCH` | the manifest and the files on disk disagree | regenerate the tree, or restore the generated files |
| `ZOPIA_DOCS_IMPORT_FAILED` | a generated module threw while being imported during reverse conversion or runtime loading | fix or regenerate the affected module (`cause` carries the original error) |

### 💾 Filesystem

| 🆔 Code | 🔍 Cause | 💡 Fix |
| --- | --- | --- |
| `ZOPIA_FS_OUTSIDE_OUTDIR` | a planned output path escapes the output directory (a safety stop, including after symlink resolution) | keep generated paths inside the output directory |
| `ZOPIA_FS_WRITE_FAILED` | writing failed — permissions, missing parent, read-only volume, disk full | check the output path, permissions, and free space |

### 🧪 Internal

| 🆔 Code | 🔍 Cause | 💡 Fix |
| --- | --- | --- |
| `ZOPIA_WARNING_INVALID` | a warning object handed to the warnings pipeline has an unknown code, an empty location, or an empty message (only reachable when constructing warnings yourself) | provide a valid code, location, and message |

## ⚠️ Warnings

### Shape

```ts
interface ZopiaWarning {
  code: ZopiaWarningCode; // 🆔 stable, machine-readable
  at?: string;            // 📍 escaped JSON Pointer, when a location is known
  message: string;        // 📝 human-readable context
}
```

Warnings are **deduplicated** and sorted deterministically by location, then
code, then message — the same input always produces the same list, so they are
safe to snapshot in tests. Collect them via the `warnings` result field or the
`onWarning` callback; the CLI prints them to stderr as
`Warning: ZOPIA_WARN_<CODE> <pointer>: <message>`.

### 🔄 Schema conversion (engines ① / ②)

| 🆔 Code | 🔍 What happened |
| --- | --- |
| `ZOPIA_WARN_UNREPRESENTABLE` | the construct has no equivalent in the target dialect (e.g. `z.void()` in JSON Schema) and was dropped or approximated |
| `ZOPIA_WARN_INVALID_SCHEMA` | a schema node is not valid for the dialect and was skipped rather than silently emitted |
| `ZOPIA_WARN_ONE_OF` | a `oneOf` had to be approximated (Zod unions are `anyOf`-shaped — exclusivity is not enforced) |
| `ZOPIA_WARN_NOT` | `not` has no direct Zod equivalent; an approximation was emitted |
| `ZOPIA_WARN_UNIQUE_ITEMS` | `uniqueItems` cannot be expressed structurally in Zod; the constraint is documented, not enforced |
| `ZOPIA_WARN_CUSTOM_FORMAT` | a `format` value outside the known set was preserved as metadata but is not validated |
| `ZOPIA_WARN_CONTENT_ENCODING` | `contentEncoding` / `contentMediaType` were preserved as metadata only |
| `ZOPIA_WARN_INT64` | a 64-bit integer format exceeds the safe JavaScript number range |
| `ZOPIA_WARN_LEGACY_EXCLUSIVE_BOUND` | draft-4 style boolean `exclusiveMinimum` / `exclusiveMaximum` were translated to the modern numeric form |
| `ZOPIA_WARN_REF` | a `$ref` could not be turned into an import and was inlined or approximated |

### 📄 Spec → tree (engine ③)

| 🆔 Code | 🔍 What happened |
| --- | --- |
| `ZOPIA_WARN_MULTI_CONTENT` | an operation declares several media types; one was selected for the typed contract and the rest documented |
| `ZOPIA_WARN_SERVER_VARIABLES` | templated `servers` variables were resolved to their defaults |
| `ZOPIA_WARN_WEBHOOKS` | webhook entries required special handling (they have no URL path of their own) |
| `ZOPIA_WARN_PRESET_PRIMARY_TAG` | `--preset multi-tag` routed an operation by `tags[0]` because it carries several tags |
| `ZOPIA_WARN_STALE_TREE` | the existing tree disagrees with the current source or options — regeneration pruned obsolete manifest-owned files |
| `ZOPIA_WARN_FROZEN_SUBTREE` | a subtree was left untouched because it is not owned by the manifest (e.g. `custom.ts` companions) |

### 🔁 Tree → spec (engine ④)

| 🆔 Code | 🔍 What happened |
| --- | --- |
| `ZOPIA_WARN_DIALECT_DOWNGRADE` | the requested output dialect cannot express something the source had (typically 3.1 → 3.0 or → 2.0) |
| `ZOPIA_WARN_COLLECTION_FORMAT` | a Swagger 2.0 `collectionFormat` has no 3.x spelling; it was preserved as `x-collectionFormat` |
| `ZOPIA_WARN_DEFAULT_INFO` | the manifest had no `info` block, so a deterministic default was synthesized |
| `ZOPIA_WARN_DEFAULT_SECURITY` | a security requirement had no matching scheme, so a collision-safe bearer scheme was synthesized |

## 🧰 Patterns

### Fail CI on any warning

```ts
const result = await openApiToApiDocs('openapi.yaml', { outDir: 'api_docs' });
if (result.warnings.length) {
  for (const w of result.warnings) console.error(`${w.code} ${w.at ?? ''} ${w.message}`);
  process.exitCode = 1;
}
```

### Allow-list the warnings you accept

```ts
const ALLOWED = new Set(['ZOPIA_WARN_MULTI_CONTENT', 'ZOPIA_WARN_CUSTOM_FORMAT']);
const unexpected = result.warnings.filter((w) => !ALLOWED.has(w.code));
```

### Exit codes in shell

```bash
zopia validate openapi.yaml || echo "spec has error-severity findings"
```

## 🔗 Next

- ⌨️ [CLI reference](cli.md) — exit codes and output streams
- 🧑‍💻 [Programmatic API](programmatic-api.md) — `onWarning` and result shapes
- 🔄 [Conversions](conversions.md) — why a given construct is lossy
