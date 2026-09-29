/**
 * 🌳 Runtime consumption of a generated api-docs tree (S-94).
 *
 * Opt-in helpers, shipped behind the `zopia/runtime` subpath export, that turn
 * a generated tree directory into the objects an application consumes:
 * {@link createApiDocs} loads every endpoint module named by the tree's
 * manifest(s) into one nested object keyed by the exact URL path segments with
 * the lowercase method as the leaf key, and {@link flattenApiDocs} deep-walks
 * that tree into a flat record keyed by each config's `operationId` (derived
 * with the generator's own naming rules). Generation output is untouched —
 * these helpers only read and import.
 */

import type { IMakeApiConfigEntry } from 'km-api';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asZopiaError, ZopiaError } from '../errors';
import { endpointExportName, uniqueEndpointName } from '../conversions/api-docs-names';
import { deriveOperationId, OPENAPI_METHODS, type OpenApiMethod } from '../conversions/openapi-to-api-docs';
import { ZOPIA_MANIFEST_FILE } from '../conversions/manifest-writer';

/** One generated km-api endpoint configuration — the `export default` value every endpoint module ships (R-732). */
export type ApiDocsEndpointConfig = IMakeApiConfigEntry;

/**
 * Nested runtime view of one generated api-docs tree.
 *
 * Branch keys are the URL path segments **verbatim and in order** (including
 * literal `{param}` segments), the leaf key is the lowercase HTTP method, and
 * the leaf value is the endpoint module's default export. Because which keys
 * exist depends on the source spec, every node is typed permissively as both a
 * deeper branch and an {@link ApiDocsEndpointConfig}, so chained access such as
 * `apiDocs.users['{userId}'].get.method` typechecks and reads the runtime
 * values the tree actually holds.
 */
export interface ApiDocsTree {
  /** Deeper path-segment branch or the method-leaf endpoint config; presence is decided by the source spec at runtime. */
  [segment: string]: ApiDocsTree & ApiDocsEndpointConfig;
}

/** Internal mutable branch node; null-prototype objects keep `{param}` and `__proto__` segments plain own keys. */
type ApiDocsBranch = Record<string, unknown>;

/** One merged, deduplicated manifest endpoint record ready for tree insertion. */
interface MergedApiEntry {
  /** Absolute directory of the manifest this entry came from (its file paths resolve against it). */
  root: string;
  /** Portable endpoint-module path relative to `root`. */
  file: string;
  /** Original OpenAPI path template — the authority for the nested key chain. */
  path: string;
  /** Lowercase HTTP method — the leaf key. */
  method: string;
}

/** One discovered manifest with the directory its relative file paths resolve against. */
interface DiscoveredManifest {
  /** Absolute directory containing this manifest (the tree root or a preset bucket root). */
  root: string;
  /** Validated `apis[]` endpoint records of this manifest, in manifest order. */
  apis: Array<{ file: string; path: string; method: string }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const isMissingFileError = (error: unknown): boolean => isRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** Split one OpenAPI path template into its literal segment keys (empty segments dropped, so `/` has none). */
function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Guard one manifest file reference: relative, POSIX-separated, and unable to escape the tree root. */
function isSafeTreeFile(file: string): boolean {
  if (!file || isAbsolute(file) || file.includes('\\') || /^[A-Za-z]:/.test(file)) return false;
  return file.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Validate one parsed manifest and return its `apis[]` records (reader-tolerant shape, hard on unsafe paths). */
function manifestApiEntries(manifest: unknown, manifestPath: string): Array<{ file: string; path: string; method: string }> {
  if (!isRecord(manifest) || !Array.isArray(manifest.apis)) {
    throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `invalid zopia manifest (expected an object with an apis array): ${manifestPath}`, { at: manifestPath, hint: 'regenerate the tree to rebuild a valid manifest' });
  }
  const entries: Array<{ file: string; path: string; method: string }> = [];
  for (const [index, api] of manifest.apis.entries()) {
    if (!isRecord(api)
      || typeof api.file !== 'string' || !isSafeTreeFile(api.file)
      || typeof api.path !== 'string' || !api.path.startsWith('/')
      || typeof api.method !== 'string' || !(OPENAPI_METHODS as readonly string[]).includes(api.method)) {
      throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `invalid zopia manifest API entry ${index}: ${manifestPath}`, { at: `${manifestPath}#apis/${index}`, hint: 'regenerate the tree to rebuild a valid manifest' });
    }
    entries.push({ file: api.file, path: api.path, method: api.method });
  }
  return entries;
}

/** Read and parse one manifest file; a missing file resolves to `undefined`, garbled JSON fails typed. */
async function readManifestFile(file: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to read zopia manifest', { at: file, hint: 'check that the manifest is readable JSON' });
  }
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `invalid zopia manifest JSON: ${file}`, { at: file, hint: 'regenerate the tree to rebuild a valid manifest', cause: error }); }
}

/**
 * Discover every manifest of one output root: the root `.zopia-manifest.json`
 * plus the one-level-deep preset bucket roots (`multi-tag` / `multi-server`
 * splits write one manifest per bucket directory). Real directories only —
 * symlinked children never masquerade as bucket roots.
 */
async function discoverApiDocsManifests(root: string): Promise<DiscoveredManifest[]> {
  const discovered: DiscoveredManifest[] = [];
  const rootManifestPath = join(root, ZOPIA_MANIFEST_FILE);
  const rootManifest = await readManifestFile(rootManifestPath);
  if (rootManifest !== undefined) discovered.push({ root, apis: manifestApiEntries(rootManifest, rootManifestPath) });
  let directories: string[] = [];
  try {
    directories = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareText);
  } catch (error) {
    // A missing root simply has no buckets; anything else is an unreadable tree.
    if (!isMissingFileError(error)) throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to scan the api-docs directory', { at: root, hint: 'check that the directory is readable' });
  }
  for (const directory of directories) {
    const bucketRoot = join(root, directory);
    const bucketManifestPath = join(bucketRoot, ZOPIA_MANIFEST_FILE);
    const bucketManifest = await readManifestFile(bucketManifestPath);
    if (bucketManifest !== undefined) discovered.push({ root: bucketRoot, apis: manifestApiEntries(bucketManifest, bucketManifestPath) });
  }
  return discovered;
}

/**
 * Merge discovered manifests into one deterministically sorted entry list.
 * Duplicates are dropped by `${path}#${method}` identity (the root manifest
 * wins over bucket manifests, buckets in sorted directory order); the sort is
 * path segments first, then the canonical method order
 * (`get, post, put, delete, head, options, patch, trace`).
 */
function mergeApiEntries(manifests: readonly DiscoveredManifest[]): MergedApiEntry[] {
  const seen = new Set<string>();
  const merged: MergedApiEntry[] = [];
  for (const { root, apis } of manifests) {
    for (const api of apis) {
      const identity = `${api.path}#${api.method}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push({ root, file: api.file, path: api.path, method: api.method });
    }
  }
  return merged.sort((left, right) => {
    const leftSegments = pathSegments(left.path);
    const rightSegments = pathSegments(right.path);
    const depth = Math.min(leftSegments.length, rightSegments.length);
    for (let index = 0; index < depth; index += 1) {
      const order = compareText(leftSegments[index], rightSegments[index]);
      if (order !== 0) return order;
    }
    const lengthOrder = leftSegments.length - rightSegments.length;
    if (lengthOrder !== 0) return lengthOrder;
    const methods = OPENAPI_METHODS as readonly string[];
    return methods.indexOf(left.method) - methods.indexOf(right.method);
  });
}

/** Import one generated endpoint module through its file URL — `pathToFileURL` keeps absolute (Windows-style) paths safe. */
async function importEndpointModule(root: string, file: string): Promise<Record<string, unknown>> {
  try {
    return await import(pathToFileURL(join(root, file)).href) as Record<string, unknown>;
  } catch (error) {
    throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `unable to import generated endpoint module: ${file}`, { at: file, hint: 'fix or regenerate the affected generated module', cause: error });
  }
}

/** Create one null-prototype branch node so every path segment becomes a plain own enumerable key. */
function createBranch(): ApiDocsBranch {
  return Object.create(null) as ApiDocsBranch;
}

/** Whether one tree node is a branch this resolver created (null prototype) rather than an endpoint config leaf. */
function isBranch(value: unknown): value is ApiDocsBranch {
  return isRecord(value) && Object.getPrototypeOf(value) === null;
}

/** Typed failure for paths whose nested key chains cannot coexist in one tree (below a method leaf, or trailing-slash twins). */
function treeConflictError(file: string, detail: string): ZopiaError {
  return new ZopiaError('ZOPIA_SPEC_INVALID', `the nested api-docs tree cannot represent this path: ${detail}`, { at: file, hint: 'rename the colliding path, or consume its endpoint module through a direct import / flattenApiDocs' });
}

/** Insert one endpoint config at its segment chain, failing typed when another path already owns a conflicting key. */
function insertEndpoint(root: ApiDocsBranch, segments: readonly string[], method: string, config: unknown, file: string): void {
  let node = root;
  for (const segment of segments) {
    const existing = node[segment];
    if (existing === undefined) {
      const branch = createBranch();
      node[segment] = branch;
      node = branch;
    } else if (isBranch(existing)) {
      node = existing;
    } else {
      throw treeConflictError(file, `segment '${segment}' is already the method leaf of another path`);
    }
  }
  if (node[method] !== undefined) {
    throw treeConflictError(file, `method leaf '${method}' is already occupied at this tree node by another path with the same segments (paths differing only by a trailing slash collapse to one another)`);
  }
  node[method] = config;
}

/** Whether one tree value is a km-api endpoint config leaf (string `method` + `pathShape`, object `request` + `response`). */
function isEndpointConfig(value: unknown): value is ApiDocsEndpointConfig & Record<string, unknown> {
  return isRecord(value) && typeof value.method === 'string' && typeof value.pathShape === 'string' && isRecord(value.request) && isRecord(value.response);
}

/**
 * Load a generated api-docs tree into one nested endpoint object.
 *
 * The resolver is layout- and path-preserving: it discovers the root
 * `.zopia-manifest.json` plus every one-level-deep preset bucket manifest
 * (`multi-tag` / `multi-server`), merges them (deduplicating by
 * `${path}#${method}`), and accepts any directory that was ever a zopia output
 * root — tree roots and preset bucket roots alike. Endpoint modules are loaded
 * with dynamic `import()` through `pathToFileURL`, and every leaf is the
 * module's **default export** (its named export stays available on the module
 * itself). Keys are inserted in the deterministic manifest order, so the same
 * tree always enumerates its keys in the same order. The tree is only read and
 * imported — nothing on disk is written.
 *
 * @param docsDir Generated api-docs output directory (tree root or preset bucket root; absolute or relative).
 * @returns Nested tree keyed by exact URL path segments with lowercase-method leaves holding the endpoint configs.
 * @throws {ZopiaError} `ZOPIA_CONFIG_INVALID` when `docsDir` is not a usable path.
 * @throws {ZopiaError} `ZOPIA_DOCS_MISSING_MANIFEST` when no root or bucket manifest exists under `docsDir`.
 * @throws {ZopiaError} `ZOPIA_MANIFEST_INVALID` when a discovered manifest is garbled JSON or has unusable `apis[]` records.
 * @throws {ZopiaError} `ZOPIA_DOCS_IMPORT_FAILED` when an endpoint module cannot be imported or has no default export.
 * @throws {ZopiaError} `ZOPIA_SPEC_INVALID` when two paths cannot coexist in one nested tree (a path continuing below another path's method leaf, or trailing-slash twins).
 * @example
 * ```ts
 * import { createApiDocs } from './src/runtime';
 *
 * const apiDocs = await createApiDocs('api_docs');
 * const endpoint = apiDocs.users['{userId}'].get;
 * console.log(endpoint.method, endpoint.pathShape);
 * ```
 * @see [docs/07-api-docs.md → Runtime tree consumption](../../docs/07-api-docs.md)
 */
export async function createApiDocs(docsDir: string): Promise<ApiDocsTree> {
  if (typeof docsDir !== 'string' || docsDir.trim() === '' || docsDir.includes('\0')) {
    throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'docsDir must be a non-empty directory path', { at: 'docsDir', hint: 'provide the generated api-docs output directory (tree root or preset bucket root)' });
  }
  const root = resolve(docsDir);
  const manifests = await discoverApiDocsManifests(root);
  if (manifests.length === 0) {
    throw new ZopiaError('ZOPIA_DOCS_MISSING_MANIFEST', `no zopia manifest found under ${docsDir}`, { at: join(docsDir, ZOPIA_MANIFEST_FILE), hint: 'generate api docs first (manifests stay enabled by default), or pass a tree or preset-bucket root' });
  }
  const entries = mergeApiEntries(manifests);
  const tree = createBranch();
  for (const entry of entries) {
    const endpointModule = await importEndpointModule(entry.root, entry.file);
    const config = endpointModule.default;
    if (!isRecord(config)) {
      throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `generated endpoint module has no default export: ${entry.file}`, { at: entry.file, hint: "regenerate the tree, or restore the module's default endpoint-config export" });
    }
    insertEndpoint(tree, pathSegments(entry.path), entry.method, config, entry.file);
  }
  return tree as ApiDocsTree;
}

/**
 * Flatten one runtime api-docs tree into a record keyed by endpoint name.
 *
 * Deep-walks the tree produced by {@link createApiDocs} in its deterministic
 * leaf order and registers every endpoint config under its `operationId`. When
 * a leaf has no usable `operationId`, the key is derived by the **same rules
 * the generator uses for its export identifiers** (method + PascalCase path
 * segments, camelize, reserved-word guard, leading-numeric guard), and
 * collisions receive the generator's `2`, `3`, … uniqueness suffix — a later
 * duplicate never clobbers an already-registered name. The returned record has
 * a null prototype, so even an `operationId` spelled `__proto__` stays a plain
 * own key.
 *
 * @param apiDocs Nested tree returned by {@link createApiDocs}.
 * @returns Flat record of every endpoint config keyed by its derived endpoint name, in tree leaf order.
 * @throws {ZopiaError} `ZOPIA_CONFIG_INVALID` when `apiDocs` is not the nested tree object (a non-object input or a non-tree value inside it).
 * @throws {ZopiaError} `ZOPIA_SPEC_INVALID` when a leaf without a usable `operationId` cannot be named (its `pathShape` is not an OpenAPI `/`-rooted template or its `method` is not one of the eight standard methods).
 * @example
 * ```ts
 * import { createApiDocs, flattenApiDocs } from './src/runtime';
 *
 * const endpoints = flattenApiDocs(await createApiDocs('api_docs'));
 * console.log(endpoints.getUser.pathShape);
 * ```
 * @see [docs/07-api-docs.md → Runtime tree consumption](../../docs/07-api-docs.md)
 */
export function flattenApiDocs(apiDocs: ApiDocsTree): Record<string, ApiDocsEndpointConfig> {
  if (!isRecord(apiDocs)) {
    throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'flattenApiDocs expects the tree object returned by createApiDocs', { at: 'apiDocs', hint: 'pass the createApiDocs result (a nested object of endpoint configs)' });
  }
  const flat: Record<string, ApiDocsEndpointConfig> = createBranch() as Record<string, ApiDocsEndpointConfig>;
  const used = new Set<string>();
  const register = (config: ApiDocsEndpointConfig & Record<string, unknown>): void => {
    const operationId = typeof config.operationId === 'string' && config.operationId.trim() !== '' ? config.operationId : undefined;
    const base = endpointExportName(operationId ?? deriveOperationId(config.pathShape, config.method.toLowerCase() as OpenApiMethod));
    const key = uniqueEndpointName(base, used);
    used.add(key);
    flat[key] = config;
  };
  const walk = (node: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(node)) {
      if (isEndpointConfig(value)) register(value);
      else if (isRecord(value)) walk(value);
      else throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unexpected value in the api-docs tree at key '${key}': ${typeof value}`, { at: key, hint: 'pass the createApiDocs result (every value is a branch or an endpoint config)' });
    }
  };
  walk(apiDocs);
  return flat;
}
