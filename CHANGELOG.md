# 📜 Changelog

All notable changes to **zopia** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] - 2026-10-07

### 🛡️ Security

- 🛡️ Cleared npm audit findings in both the root package and the VitePress website: the website now overrides Vite to `6.4.4` (pulling patched `esbuild`), and both root dependency lockfiles (`package-lock.json` and `bun.lock`) now use `source-map-js@1.2.2`.

### 🐛 Fixed

- 🧭 Navigation now rejects malformed JSON scalar tokens and non-JSON whitespace during pointer scanning, resolves reusable parameter/response component pointers in their real namespaces (including Swagger 2.0 `#/parameters` and `#/responses`), keeps `components/index.ts` assigned to schema components even in parameter/response-only trees so kind-barrel navigation stays unambiguous, and reports reusable component files as `component` results instead of endpoint files.
- 🛠️ The VS Code extension no longer dynamically imports the Bun-first `zopia` package from Node, no longer advertises unsupported JSONC spec sources, finds source specs colocated with a workspace-root manifest, and its best-effort YAML operationId matching now respects YAML mapping boundaries while handling quoted/commented IDs and IDs outside identifier characters.
- 🧹 Validation reachability now distinguishes literal annotation values from schema properties with the same names, no longer confuses operation-side properties named `schemas`/`definitions` with the source document's component container, auto-detects Windows-style `.zopia-manifest.json` paths as docs targets, and reports inline spec text as `(inline document)` instead of echoing the full document.
- 🌐 Website sync no longer rewrites absolute `.md` links into malformed doubled GitHub URLs, preserves non-HTTP schemes such as `mailto:`, and the site audit now rejects links containing multiple protocols.
- 📚 Documentation links and version examples were refreshed for the current `v0.6`/`v0.5` snapshot set and the supported reverse `--version 2.0|3.0|3.1` values.
- 🧷 Watch mode now verifies that the spec's parent directory can be watched before installing `fs.watch`; a missing or unwatchable parent exits 1 with typed `ZOPIA_CONFIG_INVALID` after the initial attempt instead of crashing with Node's raw watcher `ENOENT` (exit 2).
- 🧩 Generated component and endpoint modules now allocate collision-free internal component/formData markers, so source literals that happen to equal strings such as `__zopia_component_reference_0__` are preserved verbatim instead of being rewritten to a component schema.
- 🗂️ The documentation snapshot CLI now parses `--keep` separately from the optional release tag: `node website/scripts/snapshot-version.mjs --keep 2` no longer treats `2` as a tag, and unknown flags or extra positional values fail instead of being silently ignored.
- 🔍 The diff command and `diffOpenApiSpecs()` now bundle same-folder external `$ref`s from file-backed inputs exactly like generation and validation; an external path-item file therefore compares semantically identical to its inline expansion instead of failing with `ZOPIA_REF_EXTERNAL`.
- 🧭 Navigation and the VS Code extension recognize the always-emitted `components/index.ts` schema barrel even when component generation has no modules to export, and keep it owned by the schema container (`#/components/schemas` or Swagger `#/definitions`).

## [0.7.0] - 2026-10-03

### ✨ Added

- 🌐 **A documentation website** (VitePress) built from `docs/user/`, with per-version documentation, a version switcher, local search, and an automated quality audit. Two ready deployment templates ship in `docs/development/`: `docs-workflow.yml.example` (D-26, private repository) and `docs-workflow-public.yml.example` (D-26b, public repository, native GitHub Pages pipeline).
- 🧭 The website now emits `sitemap.xml` and ships a brand favicon, and documentation tables wrap instead of overflowing on phone-sized screens.
- 🛠️ `docs/development/15-website-setup.md` — the one-time setup checklist for both deployment paths.

### 🐛 Fixed

- 🔗 ✏️ The website's "Suggest changes to this page" links pointed at `docs/user/<section>/<page>.md`, a path that does not exist — every edit link was a 404. The route→source mapping is now explicit, the changelog page links to `CHANGELOG.md`, and frozen version snapshots carry no edit link at all (they are immutable, R-211).
- ⏱️ `tests/watch-mode.test.ts` failed at random: two legitimate filesystem-watcher waits can exceed Vitest's 5 s default test timeout under parallel load. The suite now allows 30 s per test, and the stale-tree warning assertion no longer depends on how many change events the OS coalesces.
- 📘 Two `ts` examples (`configuration.md` defaults, `conversions.md` engine ① output) were bare object literals that do not parse as TypeScript; they are now valid declarations.
- 🧪 The km-api hand-off example in `api-docs-format.md` called `.parse()` on endpoint schemas, which km-api types structurally — the snippet did not compile. It now names the Zod type explicitly and typechecks.
- 🏷️ The outdated-version banner linked old sources through `/blob/<tag>/docs`; directory listings use `/tree/` now.
- 🚀 Both deploy workflow templates checked out the release **tag** on a `release` event, so the snapshot commit would have been pushed from a detached HEAD; they now check out `main` explicitly, skip snapshotting idempotently, and the public-repository template no longer cancels an in-flight Pages deployment.

### 🔄 Changed
- ✂️ **The documentation set is split by audience.** `docs/user/` holds
  everything a consumer of the package needs — it ships inside the npm archive
  and is the single source of truth for the forthcoming documentation website.
  `docs/development/` holds the repository-only material (overview, targets,
  roadmap, architecture, testing, standards, plans). The boundary, its rules
  (R-201…R-209), the migration map, and the "where does a new page go" decision
  tree are specified in `docs/development/13-documentation-split.md`;
  `README.md` and `docs/README.md` now carry the two-audience map, and the new
  conventions are recorded as R-187/R-188.
- 📘 **New and restructured user pages.** `docs/10-usage.md` was split into
  `installation.md`, `quick-start.md`, `cli.md`, `programmatic-api.md`, and
  `runtime.md`; `docs/user/index.md` and `docs/user/errors-and-warnings.md`
  (every stable error and warning code with its cause and fix) are new;
  `05-concepts`, `06-conversions`, `07-api-docs`, `08-components`, and
  `09-configuration` moved to `docs/user/` under descriptive names. The CLI
  reference now documents every command, flag, value, default, effect, and exit
  code; the programmatic page maps the complete public export surface.
- 🌐 **Documentation website planned.** `docs/development/14-website.md`
  specifies the VitePress site for <https://komeilm76.github.io/zopia/> —
  targets W-1…W-8, information architecture, design bar, versioning policy
  (latest plus the previous two minors), content pipeline, release-flow
  integration, quality gates, milestones, and the GitHub Pages visibility risk.
  Phase 4 is tracked in the roadmap and targets.
- 🌐 **The documentation website is scaffolded.** `website/` holds a VitePress
  project configured for the `/zopia/` base path, with a custom landing page,
  a zopia brand layer over the accessible default theme, local search, edit
  links, and the dead-link gate enabled. `website/scripts/sync-content.mjs`
  renders `docs/user/**` and `CHANGELOG.md` into the site's content tree —
  rewriting cross-page links, injecting frontmatter, and failing on any
  unmapped page — so `docs/user/` remains the single source of truth for both
  the npm archive and the site. `npm run dev` additionally watches the real
  sources.
- 🚀 **Website hosting decided (D-26).** A docs workflow template
  (`docs/development/docs-workflow.yml.example`, to be copied to
  `.github/workflows/docs.yml`) builds
  the site and publishes it into the **public**
  `komeilm76/komeilm76.github.io` repository under `/zopia/` using a scoped
  `PAGES_DEPLOY_TOKEN`, which keeps the documentation public at
  <https://komeilm76.github.io/zopia/> after `komeilm76/zopia` becomes private.
  The pipeline is independent of `publish.yml`, replaces only the `zopia/`
  sub-directory of the site repository, and verifies the built HTML references
  the `/zopia/` base path. A new website contract suite pins all of this.
- 🔖 **Versioned documentation.** `website/scripts/snapshot-version.mjs`
  freezes a released tag into `website/versions/<vX.Y>/` (immutable once
  written, pruned to the previous two minors), mapping pre-split page names
  onto today's routes so older releases still browse like the current site.
  The version switcher, the per-version sidebars, and the
  "you are reading old documentation" banner are all generated from those
  snapshots. **v0.6 and v0.5 are published** alongside the latest docs.
- 🔍 **Automated site quality gate.** `website/scripts/audit.mjs` checks the
  built output on every CI run: `/zopia/` base-path correctness, unique
  non-empty titles and meta descriptions, `<html lang>`, exactly one `<h1>`
  with no skipped heading levels, image alt text, resolvable internal links,
  informative link text, no unrendered Markdown, and HTML/asset weight
  budgets. The release path of the docs workflow now also snapshots the
  previous minor before rebuilding.
- 🔍 **Complete, enforced user-documentation coverage.** The programmatic API
  page now documents the **entire** public surface — validation, diff,
  navigation, and every low-level building block, result type, and option
  type — and the runtime page documents `ApiDocsTree` / `ApiDocsEndpointConfig`.
  `tests/contract/user-docs-coverage.test.ts` fails the build when a new
  export, CLI flag, error code, warning code, or option key is not documented
  (R-207), and the documentation contract now also rejects internal planning
  vocabulary (phase numbers, scenario/target IDs, `src/` paths) and relative
  links into `docs/development/` from user pages (R-202/R-204).
- 📦 The npm archive now packs the whole `docs/user/**` set instead of three
  individual guides, and `package.json#homepage` points at the documentation
  website. `scripts/package-check.ts` and the package/documentation contract
  suites assert the new layout.

## [0.6.0] - 2026-09-30

### 🐛 Fixed
- 🐛 **Swagger 2.0 `collectionFormat` was dropped when reversing to OpenAPI
  3.x.** Array parameters generated from a Swagger 2.0 source came back as
  bare 3.x parameters, silently changing the wire format from (for example)
  `?tags=a,b` to `?tags=a&tags=b`. Reverse conversion now maps the recorded
  format onto its 3.x spelling: on `query` parameters `csv` →
  `style: "form", explode: false`, `multi` → `style: "form", explode: true`,
  `pipes` → `style: "pipeDelimited"`, `ssv` → `style: "spaceDelimited"`; on
  `path`/`header` `csv` → `style: "simple", explode: false`. `formData`
  array serialization now lands in the media type's `encoding` map
  (`csv` → `form` + `explode: false`, `multi` → `form` + `explode: true`).
  Inline parameters and shared `#/parameters/<Name>` declarations (which
  reverse into `components.parameters`) take the same mapping. Formats with
  no legal 3.x spelling — `tsv` anywhere, plus `pipes`/`ssv`/`tsv` inside
  `encoding` objects or on `path`/`header` — keep the original value in an
  `x-collectionFormat` extension and emit the new
  `ZOPIA_WARN_COLLECTION_FORMAT` warning at the affected pointer instead of
  discarding it (D-12). Reversing to `'2.0'` still restores every
  `collectionFormat` verbatim and warning-free.
- 🐛 **Swagger 2.0 `type: "file"` lost its binary format in 3.x output.**
  Multipart file properties reversed to a plain `{ "type": "string" }`,
  which describes a text field, because the version-rewrite pass stripped
  the `format: "binary"` the operation builder had already produced.
  Reversing to `'3.0'`/`'3.1'` now yields
  `{ "type": "string", "format": "binary" }`; reversing to `'2.0'` still
  restores `type: "file"`.
- 🐛 **Reversing a `--preset` split root reported a misleading missing
  manifest.** `apiDocsToOpenApi()` (and `zopia reverse`) pointed at a preset
  root — where the manifests live one directory down, one per bucket —
  failed with `ZOPIA_DOCS_MISSING_MANIFEST`, which reads as "you never
  generated anything". It now fails with the new typed
  `ZOPIA_DOCS_PRESET_ROOT` code, naming the bucket directories that actually
  contain a manifest in alphabetical order plus the command for a single
  bucket, e.g. `this directory is a preset split (3 trees: orders,
  untagged, users). Reverse one bucket (zopia reverse api_docs/orders) to
  convert a single tree.` Directories with no bucket manifest anywhere keep
  `ZOPIA_DOCS_MISSING_MANIFEST`.
- 🐛 **Authored numeric bound pairs were lost on the OpenAPI 3.1 round
  trip.** A schema carrying both an inclusive and an exclusive bound on the
  same side (e.g. `{ "minimum": 0, "exclusiveMinimum": 0 }`) generated the
  correct Zod (`.min(0)` … `.gt(0)`), but `z.toJSONSchema()` keeps only the
  tighter keyword, so reverse conversion emitted just
  `{ "exclusiveMinimum": 0 }`. Generation now records the authored pair in
  the manifest overlay — the same mechanism already used for legacy boolean
  exclusive bounds — and reverse conversion restores both keywords verbatim
  for endpoint-local **and** component schemas. Schemas with a single bound
  on a side are unaffected and record no overlay.

## [0.5.2] - 2026-09-30

### 🐛 Fixed
- 🐛 **`toJSON` property error in generated `index.ts` files (#5).** The
  canonical-JSON helper emitted into schemas using `uniqueItems` (and object
  `const`/`enum` comparisons) guarded against `toJSON` methods with
  `typeof value.toJSON === 'function'`. Because the helper is invoked per
  item with the item's own type, primitive element types (e.g.
  `uniqueItems` on a string array) let TypeScript narrow `value` to `never`,
  and editors reported `TS2339: Property 'toJSON' does not exist on type
  'never'`. The guard now reads `typeof Object(value).toJSON === 'function'`
  — identical runtime behavior (short-circuited for non-objects,
  `Object(obj) === obj` for objects), but valid TypeScript for every element
  type. Generated code stays plain JavaScript (no type annotations were
  added), and a new suite typechecks generated endpoints end-to-end under
  `strict: true` with `ts.createProgram`, so generated files are now held to
  the same compile-cleanly bar as the IntelliSense declarations.

## [0.5.1] - 2026-09-30

### 🐛 Fixed
- 🐛 **Duplicate `.int()` in generated Zod schemas for `int32` and `int64`
  formats (#4).** Integer properties carrying an integer format emitted
  `z.number().int().int()...` — the `integer` type already appends `.int()`
  and the format branch appended it again. Now every combination
  (`integer`/`number` × `int32`/`int64`/`uint32`/`uint64`) emits exactly one
  `.int()`, with bounds (`int32` → `-2147483648...2147483647`,
  `uint32` → `0...4294967295`) and `.nonnegative()` for the unsigned formats
  unchanged. Runtime validation, warning codes, and reverse-conversion
  overlays are untouched; covered by new unit and end-to-end regression
  tests that assert the emitted code (not just parse behavior).

## [0.5.0] - 2026-09-29

### ✨ Added
- 🧠 **Exact IntelliSense for runtime tree consumption (S-95).** Every tree
  generated with a manifest now also carries a types-only
  **`.zopia-tree.d.ts`** declaration beside the manifest, and
  `createApiDocs` / `flattenApiDocs` accept it as a type argument — turning the
  permissive runtime typing into **exact** typing:
  ```ts
  import { createApiDocs, flattenApiDocs } from 'zopia/runtime';
  import type { ApiDocsTree, ApiDocsFlat } from './api_docs/.zopia-tree';

  const apiDocs = await createApiDocs<ApiDocsTree>('./api_docs');
  apiDocs.users['{userId}'].get.pathShape;   // literal "/users/{userId}", autocompleted
  const endpoints = flattenApiDocs<ApiDocsFlat>(apiDocs);
  endpoints.getUser;                          // exact key, same leaf object
  ```
  Segment and method keys autocomplete exactly (unknown keys are **compile
  errors**, not `any`), every leaf is typed as the generated module's own
  `makeApiConfig()` export (literal `method`/`pathShape`, exact Zod request /
  response shapes), and the flat record's keys derive through the same shared
  naming rules as the generator's export identifiers (camelize,
  reserved-word guard, `2`/`3`… collision suffixes) — parity with the runtime
  keys is pinned by tests. The declaration is emitted in both layouts and in
  every preset bucket root, follows the manifest lifecycle (pruned when
  manifests are disabled, refreshed on regeneration, and a deleted declaration
  reports `ZOPIA_WARN_STALE_TREE`), and is types-only: it imports nothing
  beyond the tree itself (R-502 holds). `zopia generate` results report the
  file with a new `kind: 'types'`. Conflicting paths that cannot share one
  nested tree (below a method leaf, trailing-slash twins) render the
  permissive intersection shape — matching the runtime's typed
  `ZOPIA_SPEC_INVALID` failure. The shared deterministic tree ordering
  (path segments, then canonical method order) moved to
  `src/conversions/api-docs-layout.ts` so the runtime resolver and the
  declaration emitter enumerate identically.

## [0.4.0] - 2026-09-29

### 🔄 Changed
- 📦 **Slimmer npm package — practical docs only.** The published archive now
  ships just the user-facing guides (`docs/07-api-docs.md`,
  `docs/09-configuration.md`, `docs/10-usage.md`) next to `README.md` /
  `CHANGELOG.md`; the development documentation (overview, targets, roadmap,
  architecture, concepts, conversions, components, testing, standards, the
  docs map, and the publish-workflow example) stays in the GitHub repository
  and is linked from the README — npm users installing the package get
  usage/installation docs, not project management artifacts. The tarball
  shrinks **239 KB → 182 KB packed (915 KB → 750 KB unpacked, 50 → 39
  files)**; `npm` force-includes `README*` from any directory, so the docs map
  is explicitly negated (`!docs/README.md`) in `files`. `package:check` and
  the release contract now enforce the slim archive: a missing practical doc
  fails, and any development doc leaking into the pack fails. The release
  standard (R-192) and the docs map describe the split.

### ✨ Added
- 🌳 **Runtime tree consumption — `zopia/runtime` (S-94).** New opt-in subpath
  export (`import { createApiDocs, flattenApiDocs } from 'zopia/runtime'`) that
  turns a generated api-docs directory into the objects an application
  consumes, with **zero changes to generation output**. `createApiDocs(dir)` —
  the entire consumer DX — discovers the root `.zopia-manifest.json` plus every
  one-level-deep preset bucket manifest (`multi-tag`/`multi-server`), merges
  them (deduplicating by `${path}#${method}`, root manifest first), sorts
  deterministically (path segments, then the canonical method order), and
  returns one nested object keyed by the exact URL path segments with the
  lowercase method as leaf key holding the endpoint module's `export default`
  (loaded via `pathToFileURL`, Windows-safe). `flattenApiDocs(tree)` is the
  flat freebie: a `Record<string, config>` keyed by `operationId`, deriving
  missing names and collision suffixes through the **same shared rules the
  generator uses for its export identifiers** (extracted to
  `src/conversions/api-docs-names.ts`: camelize, reserved-word guard,
  leading-numeric guard, `2`/`3`… suffixing — `await` → `awaitEndpoint`).
  Missing/garbled manifests, unsafe manifest paths, import failures, and
  modules without default exports fail typed (`ZOPIA_DOCS_MISSING_MANIFEST`,
  `ZOPIA_MANIFEST_INVALID`, `ZOPIA_DOCS_IMPORT_FAILED`); paths that cannot
  share one nested tree (below a method leaf, trailing-slash twins) fail typed
  `ZOPIA_SPEC_INVALID`. Documented in
  [docs/user/api-docs-format.md → Runtime tree consumption](docs/user/api-docs-format.md).
- 📦 **npm publish pipeline** — `.github/workflows/publish.yml` publishes on GitHub Release creation (or manually) with the pinned Bun toolchain, verifies the release tag matches `package.json`'s version, and runs `npm publish --provenance --access public`. Its only credential is the repository-secret `NODE_AUTH_TOKEN` (npm `NPM_TOKEN`) — never handled in chat or commits; npm trusted-publishing (OIDC) is supported by the declared `id-token` permission.

### 🐛 Fixed
- 🧪 Release-gate coverage regression (round 9): the full Bun release gate (`bun run release:check`, invoked by `prepublishOnly`) exposed **branch coverage 84.41% < the 85% threshold** — a genuine release blocker invisible to the plain test suite. Recovered to **85.08%** with 12 targeted behavior tests: exported warning helpers (`normalizeZopiaWarnings`/`rebaseZopiaWarning`/`formatZopiaWarning`/`formatZopiaWarningComment` — previously uncovered public API), scanner array rigs (nested arrays/malformed bodies), invalid generate-option shapes (object/array/unknown key/`outDir`/mode/booleans), input shapes (JSON text/YAML text/file paths/invalid JSON), duplicate `operationId` rejection with deterministic derived-rename (verifying reverse round-trips the original `undefined`), diff `$ref` guard shapes, invalid reusable-parameter declarations for both dialects, and navigation manifest-shape guards (malformed entries, operationId first-wins, absent-id labels, every unsupported-pointer hint).

## [0.3.0] - 2026-09-29

### 🐛 Fixed
- 🧭 Item-level navigation pointers (round 8): the navigation core's documented `#/paths/<path>` (every method of the item) and `#/webhooks/<name>` shapes silently failed with an "unsupported spec pointer" error — item-level pointers now enumerate every routed operation of the item plus its custom companions in deterministic file order, and unknown items keep their typed `ZOPIA_CONFIG_INVALID` failure (`spec pointer has no generated module`).
- 🧰 Preset routing holes (round 7): op-less path/webhook items — shared `parameters` blocks, `summary`/item `x-` metadata, `x-` webhook-map entries' namesakes — silently disappeared from **every** preset bucket (documented as traveling verbatim like components and `x-` map entries; they now ride with every bucket), and an explicit empty `servers: []` override on an operation or path item was treated as *inherit the parent servers* instead of the specification-mandated default server `/` (an unlucky set could silently collapse the whole multi-server split into a fallthrough); the nearest explicit `servers` array is now decisive, empty or not. The presets added entry from the previous commit was also seated in a floating `### ✨ Added` block **outside** `## [Unreleased]` and has been moved into it.
- 🔍 Diff coverage holes (round 6): changes to the named component registries — `components.parameters`/`responses`/`securitySchemes`/`requestBodies`/`headers`/`links`/`callbacks`/`examples`/`pathItems` (3.x) and `parameters`/`responses`/`securityDefinitions` (Swagger 2.0, cross-dialect aligned with side-appropriate pointers — an auth-scheme change reported nothing) — plus path-item and webhook-item metadata (`summary`/`description`/`servers`, item `x-` keys, resolved through `@ref` chains with sibling-wins semantics and the generation-era typed failures) and `x-` extension entries inside `paths`/`webhooks` are now reported instead of silently invisible.
- 🛡️ Custom companion hardening (round 5): a **directory** at a companion's `custom.ts` path (which would shadow the sibling module's `./custom` import) now fails with a typed `ZOPIA_FS_OUTSIDE_OUTDIR` instead of silently emitting a broken tree; companion paths are derived through a dedicated helper that rejects endpoint modules not living in their own directory; path segments literally named `custom.ts` keep working both layouts through planner renaming and now have scaffold coverage asserting every generated module's companion is a real file.

### ✨ Added
- 🧭 **Spec ↔ code navigation + VS Code extension (Phase 3, S-93).** New
  manifest-driven navigation core in zopia: `loadNavigationIndex()` /
  `navigationIndexFromManifest()` build a deterministic index of any
  generated tree (or preset bucket root) answering both directions —
  `specToLocations()` (pointer → endpoint/webhook/component files plus
  `custom.ts` companions when enabled) and `treeToSpecLocation()` (file →
  pointer, including component barrels and the manifest itself). Editor
  integrations get a dependency-free single-pass JSON scanner:
  `specPointersToLines()` / `specPointerToLine()` (exact declaration
  lines, RFC-6901 escaping, minified documents), `specPointerAtLine()`
  (cursor rule), and `pointerForOperationId()` (YAML fallback). New CLI
  `zopia navigate <docs-dir> --to-code <pointer> | --to-spec <file>` prints
  one stable line per location; unmatched queries fail with typed
  `ZOPIA_CONFIG_INVALID`/`ZOPIA_DOCS_MISSING_MANIFEST`. The VS Code
  extension ships under `editors/vscode/` as a zero-build CommonJS package
  resolving the workspace's own zopia install: `Zopia: Open generated code`
  (spec cursor → module) and `Zopia: Open spec location` (tree file →
  spec declaration line, exact for JSON, `operationId`-marker fallback for
  YAML).
- 🧰 **Split-generation presets (S-92).** `openApiToApiDocs` gains a `preset`
  option — `multi-tag` routes each operation by its primary tag and
  `multi-server` by the effective first server (operation → path item →
  document) — generating one independently reverse-convertible api-docs
  sub-tree per bucket under collision-safe lowercase slug directories
  (`untagged`, `https-api.example.com`, `pet-store`, `pet-store-2`, …). The
  pure planner is exported as `planPresetBuckets()`; results report
  `trees[]` (`{ name, directory, manifestPath? }`) and multi-tagged
  operations emit `ZOPIA_WARN_PRESET_PRIMARY_TAG`. When a spec has nothing to
  split (no tags / one effective server) zopia falls through to the normal
  single tree. CLI `--preset multi-tag|multi-server` prints
  `zopia generate <input>: N preset trees in <outDir> (…)`, and
  `generate.preset` configures project defaults.

> 📌 **Convention** — every commit that changes behaviour, the public API, or the
> documentation adds an entry under `Unreleased`. When a release is cut, the
> `Unreleased` section is renamed to the new version with its date.
> See [docs/development/12-standards.md → Changelog convention](docs/development/12-standards.md#-changelog-convention).

---
- 🔍 **Spec diff tool (Phase 3, S-91)** — new `zopia diff old.json new.json` CLI command plus `diffOpenApiSpecs()` / `diffOpenApiDocuments()` APIs: semantic comparison of two Swagger 2.0 / OpenAPI 3.0/3.1 inputs (JSON paths, YAML paths, inline text, or objects — loaded with the same rules as generation). Changes are grouped and deterministically ordered: dialect, `info` fields, endpoints (added/removed labeled `METHOD path (operationId)` in path-primary order; shared operations emit a header plus scalar `->` transitions, parameter add/remove/change, request-body presence/content, response status adds/removals/changes, security, tags, and `x-` extensions), webhooks, schema components (dialect-aligned `#/definitions/…` vs `#/components/schemas/…` pointers), document fields, and root extensions. Object-key order never counts as a change; detected changes print as `+`/`-`/`~` lines with a `zopia diff …: N changes (A added, R removed, C changed)` summary to stdout, stderr stays silent, and changed pairs exit `0` (differences are data). Unreadable/invalid inputs fail with the existing typed `ZOPIA_SPEC_*` codes.
- ♻️ **Incremental regeneration + merge-safe custom companions (Phase 3, D-24, S-90)** — generation now writes only files whose rendered bytes differ: byte-identical endpoints, components, and the manifest keep their mtimes, so watch mode and bundler caches stop churning on no-op regenerations. The opt-in `custom` layer (generate option `custom: true`, CLI `--custom`, config `generate.custom`) appends `export * as custom from './custom';` to every endpoint and webhook module and scaffolds a sibling `custom.ts` exactly once — an existing file or symlink at that path is never touched, custom files are never manifest-owned (staleness pruning can't delete them), and toggling the option off removes only the export line via the normal skip-aware rewrite. The manifest records `options.custom` only when enabled; toggling it reports the new `ZOPIA_WARN_STALE_TREE` reason `custom-companions-changed`. Non-boolean `custom` values fail with `ZOPIA_CONFIG_INVALID` at every layer.
- 🧹 **`zopia validate` (Phase 3, S-89)** — new CLI command and `validateZopia()` API: specs are checked for dialect validity, broken local `$ref`s (error at the offending pointer), endpoint-planning failures (name collisions, cross-namespace duplicate `operationId`s), and components no operation can reach — transitively, covering OpenAPI `components.schemas` and Swagger `definitions` with stable `ZOPIA_VALIDATE_UNREACHABLE_COMPONENT` warnings. Generated trees are checked for manifest presence/validity, a complete reverse dry-run, and km-api peer drift (`ZOPIA_VALIDATE_KM_API_DRIFT` — outside the declared `^0.4.1` range or unresolvable near the tree; warning-severity, never blocking). Findings return as deterministic sorted diagnostics `{ severity, code, at, message }`; the CLI prints them to stdout with a summary line and exits `1` only when an error-severity finding exists. Also exported: `readOpenApiSourceInput`, `validateOpenApiReferences`, and `assertUniqueOperationIdsAcrossScopes` (shared between generation and validation).
- 🧭 Dialect reverse hardening (round 3): reversing to 3.0 or 2.0 no longer crashes with `ZOPIA_REF_NOT_FOUND` when a path item `$ref`s into a container the target dialect omits (`components.pathItems` or the webhooks section) — the operation expands in place with the existing `ZOPIA_WARN_DIALECT_DOWNGRADE` diagnostic, while references into surviving containers stay verbatim. Generation now also rejects duplicate `operationId`s across the path and webhook namespaces up front (`ZOPIA_SPEC_INVALID`, document-wide uniqueness per the OpenAPI spec); the reverse guard remains for hand-edited trees.
- 🧷 Webhook round-trip hardening: pure `$ref` webhook items reverse to their verbatim source shape (`webhookItemRef` parity with path-item refs — edited generated modules expand the operation as a spec-legal sibling), empty `x-` webhook entries (for example `x-empty: {}`) survive ③→④ through the webhook order list, and malformed webhook items (`null` / scalar / array) raise `ZOPIA_SPEC_INVALID` instead of an untyped crash. Usage and configuration docs now document `zopia generate --watch`.
- 👀 Watch mode: `zopia generate --watch` keeps engine ③ running against the spec file — the initial generation runs identically to non-watch mode (same options, same warnings, same errors), every file change is coalesced (50 ms) and serialized against in-flight runs, a failure prints the typed error on stderr and keeps watching with the previous tree untouched, and in-place regeneration reuses the stale-tree ownership pipeline (one deterministic `ZOPIA_WARN_STALE_TREE` before refresh). The watcher subscribes to the spec's parent directory and filters on the basename, so atomic saves (write-temp + rename) keep regenerating instead of silently ending the watch. Embedding entry points get the same loop through `runGenerateWatch(input, options, output?, signal?)` in `cli-command` with an `AbortSignal` stop hook (S-88).
- 🪝 OpenAPI 3.1 webhook endpoint generation (D-23): `document.webhooks` operations now emit real endpoint files at `webhooks/<name>/<method>/index.ts` through the same planning, collision-avoidance, and component-reference pipeline as path operations. The manifest gains `webhooks[]` records (file/name/method/operationId/sourceOperation/refs/overlay/responseOverlay/security), a `webhookOrder` list preserving the exact source key order, and a `webhooksOverlay` for item-level metadata (`parameters`, `x-` keys, and `x-` or operation-less entries); non-empty `webhooks` maps move out of `documentOverlay` into these records. Reverse conversion imports the generated webhook modules for runtime refresh, restores local path-item `$ref` items inline, enforces global `operationId` uniqueness across path and webhook operations, and reassembles `document.webhooks` in exact source order for 3.1 output — while 3.0/2.0 output omits webhooks with the source-located `ZOPIA_WARN_WEBHOOKS` warning. Webhook maps with no operations keep the earlier manifest-only behavior with a forward `ZOPIA_WARN_WEBHOOKS`. Non-3.1 manifests carrying `webhooks` fail validation deterministically. New public helpers: `planWebhookDocsFiles`, `collectOpenApiWebhookOperations`, and `webhookRuntimePath`.
- 📝 YAML input for engine ③ (D-13 lifts, D-16): `openApiToApiDocs` and the CLI accept `.yaml`/`.yml` spec paths, inline YAML text, and extension-less YAML files through a new owned, deterministic YAML 1.2 core-schema parser (`src/conversions/yaml.ts`). It supports block/flow collections, plain/single/double-quoted scalars, literal/folded block scalars with chomping and indent indicators, comments, anchors/aliases/`<<` merge keys, `%YAML 1.x` directives and single-document `---`/`...` markers, and parses to exactly the values an equivalent JSON document yields.
- 🚨 `ZOPIA_SPEC_INVALID_YAML` (MINOR error-code addition, R-142): every YAML syntax/structure rejection — tab indentation, duplicate keys, undefined aliases, custom tags, multiple documents, complex `?` keys, non-JSON numbers (`.inf`/`.nan`), and more — fails with a line-located typed error; unreadable or malformed `.yaml`/`.yml` files report the YAML code with the file path in `at`.
- 🔗 External `$ref` resolution for spec files (D-17): `openApiToApiDocs` and the CLI bundle same-folder references — `other.yaml`/`other.json`/`other.yml` with optional `#` JSON Pointers, `./` spellings, and whole-file targets — inline before normalization. Nested cross-file references resolve against their owning file, sibling keys next to a `$ref` win over bundled content, every sibling file is read exactly once, and bundled content is deep-cloned, so generated trees, warnings, reverse conversion, and manifest hashes are byte-identical to an equivalent inline spec; reverse conversion emits the bundled single-file document and never re-splits files.
- 🧭 Deterministic external-ref failure matrix (D-17): targets outside the spec folder (URLs, `../`, absolute paths, subdirectories, drive names, non-spec extensions) and any external ref in object/text inputs keep `ZOPIA_REF_EXTERNAL`; unparsable targets fail with `ZOPIA_SPEC_INVALID_JSON`/`ZOPIA_SPEC_INVALID_YAML` at the file path; missing pointers, bad fragments, circular chains, sibling keys on non-object targets, and expansion past the 512-level guard fail with `ZOPIA_REF_NOT_FOUND` at the referencing pointer.
- ♻️ Reusable parameters and responses as component modules (D-18): in components mode, declared reusable parameters (`#/components/parameters/…`, Swagger 2.0 `#/parameters/…`) and responses (`#/components/responses/…`, Swagger 2.0 `#/responses/…`) now generate their own files `components/parameters/<Name>/index.ts` / `components/responses/<Name>/index.ts` exporting `<Name>Parameter` / `<Name>Response` — the module holds the derived schema only (name/location/`required` stay operation data; schema-less responses render `z.void()` at use sites and emit no module). Bare `$ref` use sites import through the new per-kind barrels (`components/parameters/index.ts`, `components/responses/index.ts`, emitted only when that kind has declarations) — including Swagger 2.0 bare body/`formData` parameters and whole-response references — while sibling-merged `$ref`s keep their inline composition. The manifest records `{ name, kind: "parameter"|"response", file, schema, overlay }` entries; reverse conversion refreshes each declaration from the current module (developer edits win) and restores every use-site `$ref` verbatim from manifest placements, and stale-tree detection owns the new barrels. Chained reusable-parameter declarations (`$ref` → `$ref` → concrete) resolve fully with a cycle guard on both conversions.
- 🧾 Project config file (D-19): the CLI discovers `zopia.config.ts` (then `zopia.config.mts`) next to the working directory, or takes an explicit `--config <path>`; the file is validated `{ generate: { mode, insertComponents, useComponentAsReference, manifest, outDir }, reverse: { version, out } }` defaults with per-key `ZOPIA_CONFIG_INVALID` errors, and merges with immutable precedence **CLI flag > config value > built-in default** (`--no-manifest` always wins). `zopia generate` accepts omitting `<output-dir>` when the config supplies `generate.outDir`; the library exposes `loadZopiaConfig` and `defineConfig`.
- 🧪 Native record-object conversion (D-22): engine ② now maps the exact object form `{ "type": "object", "propertyNames": { "type": "string", "pattern"/"minLength"/"maxLength" }, "additionalProperties": <schema> }` (with no other object-structure keywords) onto `z.record(key, value)` — the same form Zod emits, so these schemas convert with zero warnings and zero frozen overlays while key constraints are enforced natively at runtime. Non-native `propertyNames` spellings (implicit/absent `type`, enums, unions, annotations, companions like `properties`/`required`/count bounds, boolean or absent `additionalProperties`, invalid key patterns) keep the D-12 runtime-refinement + frozen-overlay behavior with byte-exact reverse restoration.
- 📤 OpenAPI 2.0 reverse output (D-20): `apiDocsToOpenApi`/`manifestToOpenApi`/`manifestFileToOpenApi` (and the CLI `--version 2.0` / config `reverse.version`) now convert 3.0/3.1-sourced manifests into Swagger 2.0 documents. The downgrade rewrites manifests into the source-dialect Swagger reconstruction path: `nullable` spellings (3.0 `nullable`, 3.1 `type` unions/`anyOf` with `null`) become `x-nullable`, `requestBody` becomes a `body` parameter — or `formData` parameters for form media types — `components.schemas` becomes `definitions`, reusable parameters/responses move to the top-level `parameters`/`responses` maps with constraint-folded scalar declarations, `servers[0]` decomposes into `host`/`basePath`/`schemes`, and operation/document `consumes`/`produces` derive from request/response media types. Features Swagger 2.0 cannot represent — webhooks, `jsonSchemaDialect`, cookie parameters, response `links`, `callbacks`, multi-flow OAuth2, OIDC/mTLS and non-basic `http` schemes, complex parameter constraints, extra media types, server variables — drop with a deterministic `ZOPIA_WARN_DIALECT_DOWNGRADE` (or the existing `ZOPIA_WARN_WEBHOOKS`) warning at the exact pointer; runtime-native gates (`Swagger 2.0 does not support cookie parameters`, primitive-only parameter shapes) degrade the same way instead of throwing only when the dialect was downgraded, so native Swagger sources keep their strict behavior.

### 🐛 Fixed
- 📝 YAML parser hardening after adversarial review: bare `-` sequence items followed by sibling dashes no longer nest the siblings (each item is `null`); `-` stays a plain scalar in mapping-value position (`k: -`); `#` lines indented as block-scalar content are preserved instead of silently dropped; comments inside multi-line flow collections no longer corrupt quote/depth tracking, and dedented flow closers are accepted; flow collections accept trailing commas; a bare `': '` inside a flow plain scalar terminates it so missing commas fail; block-scalar headers reject junk that is not a comment; multi-line plain continuations that look like a mapping/sequence entry fail instead of folding; content after the `...` marker fails; alias resolutions clone anchored values so downstream walkers never see shared identity.

## [0.1.0] - 2026-09-28

### ✨ Added
- 📦 Prepared the public `zopia@0.1.0` package with complete npm metadata, an allowlisted source distribution, synchronized release identity, executable CLI permissions, packed-consumer library/CLI smoke tests, and a mandatory prepublish release gate.
- 📖 Completed the JSDoc audit: every exported declaration and exposed public shape member now has useful API documentation, public callables specify parameters and return values, optional configuration fields state defaults, the public example is runnable, and an AST contract suite prevents regressions in summaries, tags, links, examples, and named-only exports.
- ⌨️ Completed the CLI contract: `generate` and `reverse` now use strict command-specific parsing, reject missing/extra/unknown/incompatible/duplicate/valueless arguments before engine work, accept options around positionals, expose complete trusted-tree-aware help, preserve stdout/stderr isolation, and return stable success, user-error, and internal-error exit statuses.
- 🟣 Completed the Bun gate: added the authoritative `bun.lock`, pinned-runtime and frozen-install validation, ESM package metadata, one CI-ready gate command, full typecheck/test/coverage checks, direct and packaged CLI smoke tests, and a real Bun generation/reverse cycle that imports generated TypeScript.
- 📈 Completed the coverage gates: `bun run coverage` now measures every `src/**/*.ts` file with Vitest V8, enforces 90% overall line/function and 85% branch coverage, requires 95% aggregate conversion-engine lines and 80% lines in every source file, rejects omitted files, and regression-tests CLI success, output-file, typed-error, and unexpected-error paths.
- 📸 Completed the golden generated-tree contract: checked in deterministic directory, flat, component-reference, and km-api type-surface trees; added deliberate `golden:update` regeneration, complete byte/path comparisons with stale-tree detection, import-boundary checks, and strict no-emit compilation against published `km-api@0.4.1`; arbitrary OpenAPI media types now preserve their exact runtime strings across km-api's enumerated declaration boundary.
- 🔁 Completed the round-trip contract with source-dialect fixture properties for Swagger 2.0 and OpenAPI 3.0/3.1, all layout/component strategies, nested/cyclic/path-item refs, lossy-keyword overlays, exact version/frame/path metadata and example forms, Swagger form constraints, Zod ↔ JSON Schema convergence, and byte-identical regeneration; fixed every mismatch exposed by the new suite.
- ⚠️ Completed the warnings pipeline across all four engines: warning codes are now a stable typed catalogue; diagnostics are validated, sanitized, deduplicated, deterministically sorted, and JSON-Pointer-located; nested/runtime warnings are rebased to their exact source or output nodes; reverse conversion reports runtime Zod losses, legacy info/default-security fallbacks, and OpenAPI 3.1→3.0 omissions through results and `onWarning`; canonical generated-code markers and CLI stderr output keep reverse stdout valid JSON.
- ♻️ Completed manifest staleness handling: regeneration now compares canonical source identity, layout, component options, manifest retention, and owned-file presence; reports invalid/incomplete/drifted trees with `ZOPIA_WARN_STALE_TREE`; safely prunes only obsolete files claimed by a validated prior manifest while preserving custom files; removes old manifests when disabled; and refuses symlinked output ancestors or manifest temporary-file symlinks.
- 🔐 Completed reverse security fallback handling: manifest operation/global requirements remain authoritative and are structurally validated; runtime `auth: 'YES'` with no recorded requirement now reuses one deterministic collision-safe bearer scheme across operations, preserves existing definitions, emits the correct OpenAPI or source-dialect Swagger representation, and reports one exact-pointer warning per fallback operation.
- 🛑 Completed typed error handling across the package: `ZOPIA_ERROR_CODES` now defines one immutable stable catalogue; engines, low-level helpers, manifests, generated-module imports, filesystem writers, warnings, and CLI validation expose `ZopiaError` rather than raw exceptions, with actionable hints, discoverable locations, and preserved causes.
- 📦 Completed the versioned manifest writer/reader contract: engine ③ now delegates to a dedicated canonical, validated, atomic writer that records complete OpenAPI/Swagger frame, component, endpoint, reference, overlay, response, and security metadata; generated manifests are byte-stable, portable-path-safe, literal-aware when collecting `$ref`s, and share their typed contract and source hash with reverse conversion and stale-tree detection.
- 📄 Completed the Engine ③ public API: added `openApiToApiDocs()` with file/object/JSON-text input, validated defaults and typed `ZopiaError`s, sorted result metadata, structured conversion/staleness warnings, reference preflight, and application/json-first media selection; the CLI now delegates to the same API.
- 📐 Completed Engine ②: JSON Schema conversion now accepts `.json` paths, returns structured warnings and manifest-compatible overlays, emits visible `@zopia:warn` markers, preserves annotations, emits lazy local definitions and discriminated unions, and hands lossy schema restorations through endpoint and component manifests for reverse conversion.
- ⚛️ Completed Engine ①: Zod conversion now defaults to OpenAPI 3.1 with dialect markers enabled, preserves metadata without `id`-driven extraction, converts every Zod-reported unrepresentable site to `{}` with structured `ZOPIA_WARN_UNREPRESENTABLE` callbacks, recursively canonicalizes keyword order, and strips built-in format patterns plus safe-integer sentinel bounds.
- 📤 Reverse conversion now selects OpenAPI 3.0 or 3.1 through `ZopiaReverseOptions.version`; the documented `apiDocsToOpenApi()` API and CLI default to 3.1, selected dialects drive runtime schema serialization, and Swagger manifests can be emitted as OpenAPI 3.x.
- ✨ JSON Schema conversion now supports draft-04/06/07 `dependencies` with both property arrays and schema dependencies, including boolean schemas and malformed-entry warnings.
- ✨ Keyword-only object, array, string, and numeric schemas now enforce constraints only for matching JSON instance types while leaving other types valid.
- ✨ JSON Schema conversion now enforces `if`/`then`/`else` conditionals, including boolean branches, typed-parent context, exact keyword-only branch applicability, and malformed-definition warnings.
- 🖥️ The npm CLI now invokes a Node-compatible wrapper that launches the TypeScript CLI through Bun instead of asking Node to execute TypeScript directly; help now lists the component-reference option.
- 🧪 Endpoint generation now preserves OpenAPI request and response examples in km-api's examples structure, including Swagger 2.0 response examples and local `$ref` targets.
- 🧩 Added initial component-file and sorted component-barrel generation with `insertComponents`.
- 🧩 Component generation validates names and renders all component contents before writing files, preventing partial output from validation/conversion failures.
- 🧩 `useComponentAsReference` now imports exact endpoint component schema references through the component barrel; component alias files, self-references, direct object-property references, and direct array-item references now emit safely quoted imports while preserving original component directory names.
- 🧪 Added regression coverage for nested array component imports and safe quoting of their generated paths.
- 🧩 Object and array components now import direct nested references while preserving recursive rendering, tuple rest, `unevaluatedItems`, and tuple/array length and order-independent nested-object uniqueness constraints, nullable recursion, and correct strict/passthrough object behavior; lazy root schemas for direct self-cycles, lazy references for mutual component cycles, nested `oneOf`/`anyOf`/`allOf` compositions, nullable schemas, enums, and constants remain supported; corresponding component documentation was updated; documentation now records direct and mutual cycle support.
- 🧩 JSON Schema conversion now emits valid Zod `.min()`/`.max()` calls for numeric `minimum`/`maximum` constraints, legacy boolean exclusive bounds, valid `.regex(new RegExp(...))` code for `pattern`, hostname (including label validation), IPv4, IPv6, base64, byte, base64url, emoji, time, duration, OpenAPI signed integer formats with int32 bounds, and unsigned integer formats with uint32 bounds, plus base64 and hexadecimal content encoding, with invalid non-string content-encoding usage warnings, and approximates `patternProperties`, `propertyNames` (including enum/const/string rules), `minProperties`, and `maxProperties` with visible Zod catchall/refinement code; array `uniqueItems` and `contains` constraints, positive `multipleOf` (including decimal floating-point values), `unevaluatedProperties`, `dependentRequired`, dependent schemas (with malformed-definition warnings), and `not` exclusions now emit without false unsupported-keyword warnings; invalid `multipleOf` values for numbers and integers produce warnings are emitted as refinements, malformed dependent rules and invalid property-name regexes now produce warnings instead of throwing, and `allOf` combines multiple scalar rules such as password requirements.
- 📦 Component generation results now include the generated `components/index.ts` barrel.
- 🏗️ Added filesystem generation for endpoint `index.ts` files from the validated API-doc plan.
- 🧾 Generated endpoint exports and schema helper names now sanitize non-identifier and reserved names into valid TypeScript names.
- 🏷️ Generated endpoint metadata now preserves normalized tags and explicit security overrides.
- ⚙️ Started Phase 1 with Zod/JSON Schema conversion, OpenAPI normalization, operation collection, API-doc layout planning, and the optional ergonomic facade.
- 🧬 Added validated OpenAPI operation contract extraction for request/response media types.
- 🔗 Added strict local OpenAPI JSON Pointer reference handling and documentation.
- ✅ Added validation for response status keys, descriptions, request-body content, and chained component references.
- 📤 Added Swagger 2.0 `formData` request-contract extraction and strict field validation.
- 🔗 Local path-item references now support chaining and circular-reference detection.
- 🖥️ Added initial `zopia generate` and `zopia reverse` CLI commands, with generation mode, component-reference, component, manifest, reverse `--out`, and `--help` options; the CLI now uses the project-standard Bun runtime.
- 🔄 Added manifest-driven OpenAPI reconstruction while preserving original operation objects, plus a file-based `manifestFileToOpenApi()` API.
- 📖 Aligned reverse-conversion documentation with the implemented manifest-based API.
- 🔄 Added generated-manifest round-trip regression tests covering operation IDs, explicit security arrays, Swagger `basePath`, Swagger security definitions, and flat generation without a manifest.
- 🛠️ Reverse conversion now validates manifest source kinds and restores Swagger `basePath`, `host`, `schemes`, `consumes`, `produces`, and `securityDefinitions` metadata.
- 📝 Manifests now preserve and restore OpenAPI `info.description`, additional info fields, document extensions, `externalDocs`, `webhooks`, and `jsonSchemaDialect`.
- 📦 Added default `.zopia-manifest.json` generation with source hash, security metadata, component schemas, API file mappings, per-operation `$ref` metadata, operation overlays, and response-header overlays.
- 🔒 Synchronized the lockfile peer dependency range with `km-api: ^0.4.1`.
- 🗂️ Manifest source kinds now normalize versioned OpenAPI values to `openapi-3.0` or `openapi-3.1`.
- 🔐 Manifest source hashes now use canonical key ordering, avoiding false changes when JSON property order differs, and reject circular/unsupported input values explicitly.

### 🔄 Changed
- 🚀 Released Phase 1 as `zopia@0.1.0` and synchronized the release date and repository status for the Phase 2 handoff.
- 📖 Public API documentation is now audited across named-only exports, nested type shapes, callable properties/signatures, parameters, returns, direct throws, defaults, links, and examples that semantically typecheck against the real source API.
- 🧪 Every documented T-13 scenario now carries an executable `S-…` test identifier, with contracts that prevent matrix, documentation-structure, test-hygiene, deterministic-output, and forbidden-runtime behavior from drifting.
- 🚢 The release toolchain now pins Vitest and its V8 coverage provider to 4.1.11, uses Bun for TypeScript utility scripts, validates the complete Bun gate contract, and audits post-release user-visible commits for same-commit changelog updates.
- 🧹 Completed the R-111 test-isolation contract: every test-created temporary tree now uses one shared after-each cleanup helper, including failure and symlink fixtures, and a contract test prevents direct unmanaged temporary-directory creation from returning.
- 🧪 Completed the remaining T-13 scenario-matrix regressions for method-named/deep parameterized paths, all documented format and upper-bound mappings, Zod `fromJSONSchema` behavior parity, and deterministic output from both schema engines.
- 📚 Synchronized current documentation with the completed Phase 1 implementation: status labels, actual source/test layout and pipeline boundaries, generated golden examples, facade/component-reuse behavior, dependency wording, and safety/performance claims now match the repository; added a contract test for documentation links, completion state, concrete paths, and canonical output drift.
- 🔄 File-backed reverse conversion now safely applies manifest `$ref` placement, schema `set`/`remove`/frozen-node overlays, operation overlays, and response overlays after Zod re-serialization while preserving a developer-selected different component reference.
- 🧬 Runtime endpoint and component schemas now take precedence over manifest schema snapshots, including developer edits that switch a `$ref` to a different component.
- 🔄 File-based reverse conversion now re-serializes edited endpoint body, parameter, and response Zod schemas through Engine ① with request-input and response-output semantics across OpenAPI 3.x and Swagger 2.0.
- 🧱 File-based reverse conversion now securely imports emitted component modules, converts edited Zod schemas to the source API dialect, and preserves references between imported components.
- 🔄 File-based reverse conversion now securely imports generated endpoint TypeScript modules and lets edited km-api method, path, operation ID, summary, description, tags, and deprecation metadata override manifest snapshots.
- ⬆️ Updated the km-api dependency and peer dependency to `^0.4.1`; generated deprecated OpenAPI operations now emit `deprecated: 'YES'`.
- 📖 Corrected reverse-conversion documentation to keep `deprecated` separate from `disable`.
- 🔐 Generated endpoint auth metadata now uses km-api's required `'YES' | 'NO'` values.
- 📖 Corrected conversion documentation to describe km-api auth as `'YES' | 'NO'` rather than a boolean.
- 📚 Updated component documentation to cover implemented exact, nested, and cyclic imports.
- ℹ️ Deprecated operations remain preserved in the validated IR; they are not conflated with km-api's distinct `disable` status.
- 📚 Updated the roadmap and dependency standards to reflect the published `km-api@0.4.1` npm dependency.
- 📚 Corrected the architecture documentation to reference the implemented local-reference resolvers.
- 🔀 Operation-level parameters now correctly override path-level parameters.

### 🐛 Fixed
- 🐛 Release validation now audits the release commit itself and accepts the required fresh, empty `Unreleased` section after a version is cut instead of incorrectly demanding an unreleased change.
- 🐛 Canonical generation and round-trip comparison now use explicit code-unit ordering instead of host-locale collation, keeping output identical across machines and locales.
- 🐛 Coverage configuration now follows Vitest 4's include-all-source contract instead of using the removed `coverage.all` option, so the pinned release typecheck and coverage gate remain executable.
- 🐛 T-10 manifests now retain source path order, empty Path Items, and explicit empty schema-component containers; reverse conversion also preserves boolean/tuple/local-definition schema syntax, schema-less media types, absent optional flags, and unconstrained request bodies instead of silently normalizing or deleting them.
- 🐛 T-11 reverse regeneration now keeps source-order-sensitive collision plans and every fixture/layout/component tree byte-identical, recognizes exact `z.never()` and plain `z.enum()` schemas, normalizes generated scalar intersections without round-trip drift, emits whitespace-clean canonical endpoint files, and canonicalizes emitted Zod map/literal key order while reverse conversion conditionally retains source-only structure (boolean spelling, `required` order, empty maps/definitions, object openness, draft tuples, and reference-free frozen schemas) without overriding developer schema, membership, tuple-member, validation, or strictness edits.
- 🐛 T-5/T-6 endpoint planning now keeps method directories leaf-only when literal path segments equal HTTP methods and disambiguates endpoint directories that would collide structurally with `.zopia-manifest.json`; component name `index.ts` is rejected before writes because it conflicts with the component barrel.
- 🐛 T-7/T-8/T-9 generation now rejects null or malformed schema-component shapes, keeps names already ending in `Schema` from gaining a second suffix, applies the complete Engine ② constraint/annotation behavior to emitted components, enforces `$ref` sibling constraints, and ignores `$ref`-looking literal/default/extension data while selecting real component imports—even beneath literal-looking property names such as `default`.
- 🐛 Engine ② now reports malformed definition containers/entries and nested `null` schema nodes with exact warnings instead of silently ignoring them or throwing, and `uniqueItems` now rejects cyclic, coercible, BigInt, and other non-JSON candidates without making `safeParse()` throw.
- 🐛 OpenAPI normalization now rejects ambiguous version fields and dialect-incompatible or typoed root fields instead of selecting one dialect or silently dropping unsupported document data; Swagger 2.0 array parameters also validate every nested Items Object type, and malformed `consumes`/`produces` lists fail instead of accepting illegal item schemas or silently selecting fallback media types.
- 🐛 Engine ② now emits native `z.ipv4()` and `z.ipv6()` schemas instead of silently falling back to unrestricted strings after calling the removed Zod string `.ip()` method.
- 🐛 Engine ① now localizes non-JSON Zod defaults and metadata as unrepresentable schema sites with exact warning pointers instead of silently normalizing non-finite values, dropping functions, or throwing for symbols and other unsupported values.
- 🐛 Engine ② now applies `nullable` and `default` to the complete local-reference schema, rejects non-JSON defaults, constants, enum members, and annotations with structured warnings, preserves structured enums by JSON equality, and retains OpenAPI access/deprecation/XML plus vendor-extension annotations in generated Zod metadata.
- 🐛 Reverse conversion now rejects malformed edited endpoint path templates, path-parameter/template mismatches, dialect-invalid response statuses/descriptions, duplicate reconstructed operation IDs, edited path/method collisions, and invalid in-memory manifest operations instead of returning invalid OpenAPI documents; runtime collisions are classified as generated-module failures.
- 🐛 Source contract validation now rejects path keys containing query strings or fragments, unsupported/typoed path-item fields, missing or unrelated path parameters, dialect-mixed parameter/request/response shapes, multiple Swagger body parameters, illegal Swagger parameter types/locations, and out-of-range response codes instead of silently dropping invalid operation data.
- 🐛 Corrected Engine ② tuple semantics so prefix positions are optional unless required by `minItems`, tuple `minItems`/`maxItems` are enforced with valid refinements, every matching `patternProperties` schema is applied, unmatched and required-but-undeclared keys follow `additionalProperties`, and arbitrary local `$ref` siblings intersect instead of overwriting referenced constraints.
- 🐛 Made endpoint planning collision-safe for repeated slashes, root-like paths, case-only path differences, component artifact conflicts, and colliding derived operation IDs; explicit operation IDs remain authoritative, root endpoint component imports now use their actual planned depth, and generated paths/components are rejected when they are not portable across supported filesystems.
- 🐛 Local references now decode URI-fragment percent escapes and distinguish direct components from nested component pointers; nested pointers are inlined without inventing nonexistent component imports.
- 🐛 File-backed reverse conversion now keys module refreshes by generated-file content, so same-size edits with restored timestamps are not hidden by the runtime module cache.
- 🐛 Engine ③ now validates all endpoint renders before writing component artifacts, classifies endpoint files beneath an OpenAPI `/components` path as endpoints rather than mistaking every `components/` prefix for a generated schema artifact, and reports syntactically valid non-object JSON as `ZOPIA_SPEC_INVALID` instead of invalid JSON.
- 🐛 Reverse dialect translation now preserves literal example/default/enum data, nullable `$ref` semantics, combined exclusive bounds, and every Swagger `consumes`/`produces` media type while omitting 3.1-only document fields from 3.0 output.
- 🐛 File-backed reverse conversion now replaces stale media types and examples after generated-code edits, honors Swagger form-to-body transitions and legacy response examples, and rejects Swagger cookie/object parameters instead of emitting invalid documents.
- 🐛 Escaped JSON Pointer component and reusable-object names now resolve correctly; direct component aliases preserve `$ref` siblings, and generated `~` directories can be imported at runtime.
- 🐛 Multi-config endpoint modules now select the named config matching the manifest operation before an unrelated default export.
- 🐛 Direct component aliases now use distinct lazy Zod schemas so reverse conversion can distinguish an unchanged alias from a developer-selected target.
- 🐛 Runtime endpoint imports now support generated directories containing `{path}` segments, and Swagger body schemas are emitted from normalized operation contracts instead of falling back to `z.any()`.
- 🐛 Generated component schemas now import `additionalProperties` references, keep deeply nested cycles lazy, preserve open-object behavior, annotations, property-count bounds, and flexible tuple cardinality, and round-trip unique arrays plus structured `const`/`enum` values.
- 🐛 OpenAPI 3.1 Zod conversion now emits JSON Schema 2020-12 shapes instead of falling through to legacy tuple forms.
- 🐛 Generated component modules and their barrel now contain real newlines, keeping the emitted TypeScript executable at runtime.
- 🐛 JSON Schema conversion now warns for malformed `not` schemas, ignores malformed mixed `dependentRequired` entries instead of partially enforcing them, and uses own-property dependency checks.
- 🐛 Manifest reverse conversion now preserves non-schema OpenAPI component sections and reusable Swagger parameter and response definitions.
- 🐛 Generated endpoint auth is now `NO` when an OpenAPI security requirement contains an empty alternative that permits anonymous access.
- 🐛 Endpoint generation now honors `useComponentAsReference` for operation- and path-level parameter schemas, preserves nested component references in endpoint schemas, imports their component definitions, and inlines direct or nested local schema references when component imports are disabled.
- 🐛 OpenAPI operation collection now resolves parameter references before duplicate detection and override merging; referenced Swagger body and form-data parameters are extracted correctly.
- 🐛 JSON Schema conversion now honors OpenAPI 3.0 `nullable: true` around the complete schema and warns for malformed nullable flags.
- 🐛 JSON Schema conversion now preserves sibling constraints alongside `enum`, `const`, `oneOf`, `anyOf`, and `allOf`, and validates structured enum/constant values using order-independent JSON object equality.
- 🐛 JSON Schema conversion now preserves empty `prefixItems` and legacy tuple definitions, including typed or forbidden `items`, `additionalItems`, and `unevaluatedItems` rest values.
- 🐛 JSON Schema conversion now honors `false` boolean schemas in `contains` and `propertyNames`, warns for malformed values, and no longer reports empty schemas as unsupported types.

### 🛡️ Security
- 🛡️ Updated and locked the test dependency tree to a zero-vulnerability npm audit resolution while retaining the declared Node 20 compatibility range.
- 🛡️ Warning deduplication now uses collision-free structured identities, and formatted diagnostics/comments escape control characters in locations while sanitizing control characters in messages.
- 🛡️ Manifest file ownership now detects case-insensitive path collisions before trees are written on case-sensitive hosts.
- 🛡️ File-backed reverse conversion now preflights every endpoint and emitted-component path before importing code, reports missing manifests as `ZOPIA_DOCS_MISSING_MANIFEST`, and reports missing or renamed generated files as `ZOPIA_DOCS_MANIFEST_MISMATCH`.
- 🔒 Generated component and parameter Zod shapes now use computed property keys, while example metadata is reconstructed with `JSON.parse`, preserving `__proto__` as ordinary data at runtime.
- 🔒 Endpoint generation now preserves prototype-like request example names without mutating the examples object's prototype or dropping metadata.
- 🔒 Endpoint generation now escapes line terminators in source metadata comments, preventing malformed or injected generated TypeScript.
- 🔒 Reverse conversion now rejects unsafe or duplicate manifest operations and prevents overlays from replacing canonical OpenAPI fields.
- 🛡️ JSON Schema conversion now validates numeric, size, pattern, object, and array keyword values before generating Zod code, warns instead of emitting malformed expressions, and ignores constraints on inapplicable instance types.
- 🔒 Reverse conversion restores manifest overlays with prototype-safe property definition.
- 🛡️ Component generation now preserves OpenAPI 3.1 boolean schemas instead of converting them to unconstrained schemas.
- 🛡️ Added validation for malformed schemas, unsafe paths, references, identifiers, operation IDs, and facade properties.
- 🛡️ JSON Pointer resolution now rejects inherited object properties.

## [0.0.1] - 2026-09-24

### ✅ Released
- 📚 Published the Phase 0 documentation and standards baseline.
- 📦 Switched to the published `km-api@^0.4.0` npm dependency.
- 🧭 Established the Phase 1 public API and implementation contract.

### ✨ Added

- 📚 Complete project documentation standard under [`docs/`](docs/) covering:
  overview, targets, roadmap, architecture, concepts, the four conversion
  engines, the api-docs output format, components, configuration, usage,
  testing strategy, and engineering standards.
- 🏠 Project [`README.md`](README.md) with feature overview, quick look, and
  the documentation map.
- 📄 [`CHANGELOG.md`](CHANGELOG.md) using the Keep-a-Changelog format.
- 🔐 [`LICENSE`](LICENSE) (MIT) and [`.gitignore`](.gitignore) for the
  Bun / TypeScript workspace.

### 📝 Decisions

- 🔑 Recorded the first architecture decisions (**D-01 … D-15**) in
  [docs/development/12-standards.md → Key decisions](docs/development/12-standards.md#-key-decisions).

### 🔄 Changed
- 📖 Documented the optional ergonomic facade and explicit bracket notation for path parameters.

- 🔗 **km-api is now vendored as a git submodule** (`km-api/`, branch
  `feat/open-unions-v0-4-0`) — the complete 0.4.0 change set (10 src/test
  files + `CHANGES.md` / `README.md` / `rules.md`; **170/170 tests, `tsc`
  clean**) is committed in the clone's own `.git`, kept local and **never
  pushed or published** until the final release step. The earlier handoff
  patch file (`0001-feat-v0.4.0-...patch`) is removed — superseded by the
  submodule. Final step (D-15): push the branch → publish `km-api@0.4.0` →
  remove the submodule → `km-api: ^0.4.0` from npm.
- 🤝 **Aligned with km-api 0.4.0** (`komeilm76/km-api` — the additive
  release now lives in this repository as the `km-api/` git submodule on
  branch `feat/open-unions-v0-4-0`, committed locally and pending the final
  push + publish — see above and D-15):
  `TRACE` method, any custom numeric status code + `default` response key,
  open (any-MIME) content types, and a real `operationId` field.
  Consequences for zopia: all of that is now **emitted as code** —
  `R-642` redefined as the km-api 0.4.0 typecheck contract (D-14); manifest
  keys `skipped` / `requestMediaType` / `responseMediaType` removed;
  `responseOverlay` narrowed to response facts with no km-api home (today:
  response `headers`, R-754); peer dependency → `km-api ^0.4`; test
  scenarios S-26/S-68/S-69 updated to the emission path.

### 🐛 Fixed

- 🎯 Fourth pass — km-api 0.4.0 precision audit (every claim re-checked
  against the submodule source line by line):
  - **security requirements are now part of the contract** — km-api's config
    stores only the `auth` boolean, so the actual requirement lists live in
    the manifest: new `defaultSecurity` (spec-level) and `apis[].security`
    (per-operation, incl. explicit `[]`) fields (R-653/R-656); the missing
    OpenAPI 3.x `security` normalization row added (v2 row corrected);
    scenario S-71 pins a multi-scheme + scopes + `security: []` round-trip
  - `204 → z.void()` reworded — that is **zopia's** marker; km-api's own
    README examples use `z.object({})` for 204 (both typecheck, but the
    docs no longer cite a non-existent km-api convention)
  - method enumeration now uses **km-api's real `IMethod` order**
    (`get, post, put, delete, head, options, patch, trace`) everywhere —
    R-401's canonical file order unified with it (was three different
    orderings across four places)
  - T-7's practical-content list gained `operationId`; stray "latest"
    version references normalized to `0.4.x`
- 🔍 Third documentation review pass (cross-audited against the km-api 0.4.0
  submodule source and live Zod 4.6.5 probes):
  - `z.map()` corrected to **unrepresentable** (R-614) — only `z.record()`
    maps to `additionalProperties` (R-616); `IExamplesMap` is the real
    km-api examples type (not `IEndpointExamples`)
  - stale `km-api ^0.3` references corrected to `0.4.x` (Overview stack
    table, Usage install table); `responseContentType` described with the
    open 0.4.0 union (not the old closed-union guard)
  - fixture examples: `role` gains `.optional()` (it is not in the Admin
    API's `required` list, R-623); the Usage end-to-end tree now shows all
    four operations
  - duplicated blocks removed (Architecture module-tree `ir/`, Roadmap
    Phase 2 bullet); changelog section markers normalized to R-174
  - round-trip property sketch aligned with the public API (`outDir` +
    R-111 temp dirs, no invented `tree.dir`); D-06 / 07 "manifest always
    written" softened to "by default" (the `manifest` option exists —
    Configuration); R-714's disambiguation invariant scoped to the endpoint
    area (component dirs also hold `index.ts`)
  - README project structure and 09's engine-① option pointer corrected
- 🏛️ Deeper review against primary sources (zod.dev, km-api `0.3.3` source,
  OpenAPI specs) — second round:
  - **km-api closed unions are now the documented emission boundary (R-642,
    D-14)** — read from `km-api`'s source: `IMethod` has **no `trace`**
    (TRACE operations are skipped + manifest `skipped[]`);
    `IHttpStatusCode` excludes `419`/`427`/`444`/`499`/`509`/`512+` **and
    `default`** (such responses → manifest `responseOverlay`); content types
    are closed unions (exotic media types → field omitted, actual type kept
    in the manifest)
  - new manifest keys: `skipped`, `apis[].requestMediaType` /
    `responseMediaType`, `apis[].responseOverlay` (R-754)
  - engine ① adopts Zod's native **`io` parameter** (R-615): request schemas
    convert with `io: 'input'` (defaulted fields naturally stay out of
    `required`), responses with `io: 'output'` — replaces the ad-hoc
    `required` normalization
  - R-614 now lists Zod's **official unrepresentable set** (incl.
    `z.void()`, `z.date()`, `z.int64()`, …); 204 → `z.void()` explicitly
    detected *before* engine ① (R-654)
  - R-612/R-633: metadata flows through **`.meta({ title, description,
    examples })`** (verified verbatim in output), not comments
  - `format: 'byte'` → `z.base64()`; unmapped formats generalized to any base
    type; Swagger 2.0 `int32/int64` primitive params pinned (with
    `ZOPIA_WARN_INT64`)
  - non-schema refs (reusable parameters/responses) inlined by the normalizer
    (R-402 scope); malformed or unsupported path-item references are rejected; 3.1
    `webhooks` → warning
  - km-api cheatsheet: source-verified closed-union table, type-level-only
    `makeApiConfig`, `operationId` is not a km-api field
  - new test scenarios S-26/S-52/S-68…S-70 and rule R-126 (golden trees must
    **typecheck** against installed km-api)
- 📐 Document review against the real libraries (Zod **4.6.5**, run locally):
  - engine ① now specifies **R-618** — stripping of Zod's redundant
    built-in `format`+`pattern` pairs and safe-integer sentinel bounds
    (`±(2⁵³−1)`), so output stays spec-clean and round-trips exact
  - engine ②: removed the non-existent `z.string().openFormat()` mapping —
    custom formats become `z.string()` + warning + manifest overlay; `time`
    and `url`/`uri` alias drift handled by overlay (R-627/R-635)
  - `z.set` documented as **unrepresentable** (`{}` + warning), not as
    `uniqueItems`; `z.map`/`z.record` mapped to their native Zod shape
  - engine ④ serializer value normalizations pinned (R-654): sentinel
    bounds, const-literal unions → `enum`, defaulted keys out of `required`
  - manifest redesigned (R-751…R-753): full component schemas **always**
    carried, per-API `refs` pointers restore `$ref` placement, `overlay`
    entries restore non-representable keywords — the reverse trip is now
    lossless in **all** modes, not only with components emitted
  - Swagger 2.0 `examples` (legacy media-type → value shape) normalization
    corrected; v2 nullability claim corrected
  - status banner, module tree, rule numbering, and cross-links audited
    and made consistent

### 🚧 Planned (Phase 1 implementation)

- 🔄 Conversion engines: `zod → JSON Schema`, `JSON Schema → zod`,
  `OpenAPI → api docs`, `api docs → OpenAPI`.
- 📂 `directory` and `flat` api-docs layouts, `.ts` index files built with
  `makeApiConfig()` from `km-api`.
- 🧱 `insertComponents` and `useComponentAsReference` options.
- 🧪 Vitest suite covering the full scenario matrix.
