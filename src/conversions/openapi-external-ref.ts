import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { ZopiaError } from '../errors';
import { resolveOpenApiLocalRef } from './openapi-ref';
import type { OpenApiDocument } from './openapi';
import { parseYaml } from './yaml';

/** One normalized external reference target: a file in the spec folder plus a JSON Pointer. */
interface ExternalLocation {
  /** Normalized filesystem key used for caching and cycle detection. */
  fileKey: string;
  /** Display name of the file (as written in the reference, without `./`). */
  name: string;
  /** Path used for reading. */
  path: string;
  /** Raw pointer text after `#` ('' = whole document) or undefined when the fragment is unsupported. */
  pointer: string | undefined;
}

interface BundleContext {
  /** Normalized key of the root input file; self-file references resolve into the root document. */
  rootKey: string;
  /** Root document (host of self-file references and pointer validation). */
  root: OpenApiDocument;
  /** Parsed-file cache; every external file is read and parsed exactly once. */
  cache: Map<string, Promise<unknown>>;
  /** Locations currently on the expansion stack (`fileKey|pointer`) for cycle detection. */
  chain: string[];
  /** Active expansion depth for the nesting guard. */
  depth: number;
  /** Folder of the root spec file; all supported external files live here. */
  sourceDir: string;
}

/** Maximum external-reference expansion depth before failing deterministically (R-1006). */
const EXTERNAL_REF_DEPTH_LIMIT = 512;

/** Same-folder grammar: a plain file name (no separators, no `..`/`:`/NUL, no scheme/drive) with a spec extension. */
const EXTERNAL_FILE_PATTERN = /^(?:\.\/)?([^/\\]+\.(?:json|ya?ml))#?(.*)$/i;

const escapePointer = (value: string | number): string => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const childPointer = (at: string, value: string | number): string => `${at}/${escapePointer(value)}`;

/** Structural container keys whose children are nodes (kept in sync with the preflight reference walker). */
const STRUCTURAL_CONTAINER_KEYS = new Set(['paths', 'schemas', 'definitions', '$defs', 'properties', 'patternProperties', 'dependentSchemas', 'responses', 'content', 'headers', 'links', 'encoding', 'callbacks', 'parameters', 'requestBodies', 'securitySchemes', 'securityDefinitions', 'pathItems']);

/** Literal/demo positions that must not be interpreted as real references (kept in sync with the preflight walker). */
const LITERAL_VALUE_KEYS = new Set(['example', 'default', 'enum', 'const']);

type VisitMode = 'normal' | 'map' | 'example-map' | 'example-object';

/** Parse and validate a non-local `$ref` against the same-folder grammar (D-17). */
function classifyExternalRef(ref: string, refAt: string, sourceDir: string): ExternalLocation {
  const match = EXTERNAL_FILE_PATTERN.exec(ref);
  const name = match?.[1];
  if (!match || !name || name === '.' || name === '..' || name.includes('\0') || name.includes(':')) {
    throw new ZopiaError('ZOPIA_REF_EXTERNAL', `external reference is not supported outside the spec folder: ${ref}`, { at: refAt, hint: 'use a JSON/YAML file in the same folder as the spec' });
  }
  const path = join(sourceDir, name);
  return { fileKey: normalize(path), name, path, pointer: match[2] ?? '' };
}

/** Read and parse a referenced file exactly once, mirroring the input pipeline's JSON/YAML selection. */
async function loadExternalFile(ctx: BundleContext, location: ExternalLocation, refAt: string): Promise<unknown> {
  const cached = ctx.cache.get(location.fileKey);
  if (cached) return cached;
  const task = (async (): Promise<unknown> => {
    let text: string;
    try { text = await readFile(location.path, 'utf8'); }
    catch (error) {
      throw new ZopiaError('ZOPIA_REF_EXTERNAL', `unable to read external reference target: ${location.name}`, { at: refAt, hint: `check that ${location.name} exists next to the spec and is readable`, cause: error });
    }
    if (/\.ya?ml$/i.test(location.name)) {
      try { return parseYaml(text); }
      catch (error) {
        if (error instanceof ZopiaError && error.code === 'ZOPIA_SPEC_INVALID_YAML') {
          throw new ZopiaError('ZOPIA_SPEC_INVALID_YAML', error.message.slice(`${error.code}: `.length), { at: location.path, hint: error.hint, cause: error });
        }
        throw error;
      }
    }
    try { return JSON.parse(text) as unknown; }
    catch (error) {
      throw new ZopiaError('ZOPIA_SPEC_INVALID_JSON', `invalid JSON in external reference target ${location.name}: ${error instanceof Error ? error.message : String(error)}`, { at: location.path, hint: 'fix the JSON syntax', cause: error });
    }
  })();
  ctx.cache.set(location.fileKey, task);
  return task;
}

/** Resolve an optional pointer inside a parsed external file (or the root document). */
function resolveTarget(document: unknown, name: string, pointer: string | undefined, refAt: string): unknown {
  if (pointer !== '' && pointer !== undefined && !pointer.startsWith('/')) {
    throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `unsupported reference fragment: ${name}#${pointer}`, { at: refAt, hint: 'use a JSON Pointer after `#` (or omit it for the whole file)' });
  }
  if (!pointer) return document;
  try { return resolveOpenApiLocalRef(document as OpenApiDocument, `#${pointer}`); }
  catch (error) {
    if (error instanceof ZopiaError && error.code === 'ZOPIA_REF_NOT_FOUND') {
      throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `unresolved external reference: ${name}#${pointer}`, { at: refAt, hint: `check that ${name} contains the pointer ${pointer}`, cause: error });
    }
    throw error;
  }
}

/** Deep-clone plain document content so spliced subtrees never share identity with their source file. */
function cloneSpecValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneSpecValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneSpecValue(entry)]));
  return value;
}

/** Walk data structures exactly like the preflight reference walker, expanding supported external refs. */
async function bundleSubtree(ctx: BundleContext, value: unknown, at: string, ownerFile: string | undefined, mode: VisitMode = 'normal'): Promise<unknown> {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const [index, item] of value.entries()) items.push(await bundleSubtree(ctx, item, childPointer(at, index), ownerFile, 'normal'));
    return items;
  }
  const object = value as Record<string, unknown>;
  if ((mode === 'normal' || mode === 'example-object') && Object.prototype.hasOwnProperty.call(object, '$ref') && typeof object.$ref === 'string' && object.$ref.length > 0) {
    let ref = object.$ref;
    if (ref.startsWith('#')) {
      if (ownerFile === undefined) return object; // host-document reference: stays local
      ref = `${ownerFile}${ref}`; // a local reference inside bundled content belongs to its owning file
    }
    return bundleReference(ctx, object, ref, childPointer(at, '$ref'), at, ownerFile);
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    result[key] = await bundleChild(ctx, key, child, at, ownerFile, mode);
  }
  return result;
}

/** Bundle one child value under the preflight walker's per-key mode rules (structural maps, literals, 2.0-vs-3.x examples). */
function bundleChild(ctx: BundleContext, key: string, child: unknown, at: string, ownerFile: string | undefined, mode: VisitMode): Promise<unknown> | unknown {
  if (mode === 'map') return bundleSubtree(ctx, child, childPointer(at, key), ownerFile, 'normal');
  if (mode === 'example-map') return bundleSubtree(ctx, child, childPointer(at, key), ownerFile, 'example-object');
  if (mode === 'example-object' && key === 'value') return child;
  if (LITERAL_VALUE_KEYS.has(key) || key.startsWith('x-')) return child;
  if (key === 'examples') {
    return ctx.root.swagger !== '2.0' && !Array.isArray(child)
      ? bundleSubtree(ctx, child, childPointer(at, key), ownerFile, 'example-map')
      : child;
  }
  return bundleSubtree(ctx, child, childPointer(at, key), ownerFile, STRUCTURAL_CONTAINER_KEYS.has(key) ? 'map' : 'normal');
}

function checkDepthLimit(ctx: BundleContext, at: string): void {
  if (ctx.depth > EXTERNAL_REF_DEPTH_LIMIT) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `external reference expansion exceeds ${EXTERNAL_REF_DEPTH_LIMIT} levels at ${at}`, { at, hint: 'reduce external reference nesting' });
}

/** Expand one validated external reference: load, resolve, clone, bundle, then re-attach sibling keys. */
async function bundleReference(ctx: BundleContext, object: Record<string, unknown>, ref: string, refAt: string, at: string, ownerFile: string | undefined): Promise<unknown> {
  const location = classifyExternalRef(ref, refAt, ctx.sourceDir);
  const chainKey = `${location.fileKey}|${location.pointer ?? ''}`;
  if (ctx.chain.includes(chainKey)) {
    const display = [...ctx.chain, chainKey].map((entry) => entry.replace(ctx.sourceDir === '.' ? '' : `${ctx.sourceDir}/`, '').replace('|', '#'));
    throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `circular external reference: ${display.join(' → ')}`, { at: refAt, hint: 'break the external reference cycle' });
  }
  const isRoot = location.fileKey === ctx.rootKey;
  const targetDocument = isRoot ? ctx.root : await loadExternalFile(ctx, location, refAt);
  const clone = cloneSpecValue(resolveTarget(targetDocument, location.name, location.pointer, refAt));
  ctx.chain.push(chainKey);
  ctx.depth += 1;
  checkDepthLimit(ctx, at);
  let bundled: unknown;
  try { bundled = await bundleSubtree(ctx, clone, at, isRoot ? undefined : location.name); }
  finally {
    ctx.depth -= 1;
    ctx.chain.pop();
  }
  const siblingEntries = Object.entries(object).filter(([key]) => key !== '$ref');
  if (siblingEntries.length === 0) return bundled;
  if (!bundled || typeof bundled !== 'object' || Array.isArray(bundled)) {
    throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `external reference ${ref} with sibling keys must target an object`, { at: refAt, hint: 'remove the sibling keys or target a mapping' });
  }
  // Preflight parity: sibling keys are visited with the same per-key rules as any other node,
  // so sibling-held external references resolve too (and sibling-held literals stay literal).
  const siblings: Record<string, unknown> = {};
  for (const [key, value] of siblingEntries) siblings[key] = await bundleChild(ctx, key, value, at, ownerFile, 'normal');
  return { ...(bundled as Record<string, unknown>), ...siblings };
}

/**
 * 🔗 Bundle same-folder external `$ref`s into a file-backed OpenAPI document (D-17).
 *
 * References of the form `other.yaml#/pointer` (including `other.json`,
 * `other.yml`, and `./…` spellings) are resolved against the folder of the
 * spec file path that produced `document`, read and parsed with the same
 * JSON/YAML rules as the primary input, and spliced in place before
 * normalization. Nested/cross-file references inside bundled content resolve
 * against their owning file, while local references of the host document are
 * untouched. Locations outside the spec folder (URLs, absolute paths, `../`,
 * subdirectories, schemes/drives) fail with `ZOPIA_REF_EXTERNAL`; unreadable
 * targets keep that code with the file as `cause`, unparsable targets surface
 * `ZOPIA_SPEC_INVALID_JSON`/`ZOPIA_SPEC_INVALID_YAML` at the target path, and
 * missing pointers or circular external chains fail with
 * `ZOPIA_REF_NOT_FOUND`. Each referenced file is read exactly once (P-1),
 * spliced content is deep-cloned so the returned document never shares object
 * identity with another document, and traversal skips literal/example payload
 * positions exactly like the preflight reference walker. Reverse conversion
 * emits the bundled single-file document and does not re-split files (D-17).
 *
 * @param document Parsed OpenAPI document read from a spec file.
 * @param sourceFile Path of the spec file the document was read from; its folder bounds resolution.
 * @returns A new document with every supported external reference resolved inline.
 * @throws {ZopiaError} `ZOPIA_REF_*` for unsupported/unreadable/circular targets; `ZOPIA_SPEC_INVALID_JSON`/`ZOPIA_SPEC_INVALID_YAML` for unparsable targets.
 * @example
 * ```ts
 * import { readFile } from 'node:fs/promises';
 * import { bundleExternalOpenApiRefs } from './src/conversions/openapi-external-ref';
 *
 * const document = JSON.parse(await readFile('spec/openapi.json', 'utf8')) as Record<string, unknown>;
 * const bundled = await bundleExternalOpenApiRefs(document as never, 'spec/openapi.json');
 * console.log(bundled);
 * ```
 * @see [docs/06-conversions.md → Engine ③](../../docs/06-conversions.md)
 */
export async function bundleExternalOpenApiRefs(document: OpenApiDocument, sourceFile: string): Promise<OpenApiDocument> {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'expected a Swagger/OpenAPI document object', { at: '#', hint: 'provide a Swagger/OpenAPI document object' });
  const ctx: BundleContext = {
    rootKey: normalize(sourceFile),
    root: document,
    cache: new Map(),
    chain: [],
    depth: 0,
    sourceDir: dirname(sourceFile),
  };
  return (await bundleSubtree(ctx, document, '#', undefined)) as OpenApiDocument;
}
