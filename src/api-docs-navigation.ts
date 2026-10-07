/**
 * 🧑‍💻 Spec ↔ generated-tree navigation (S-93).
 *
 * Deterministic, manifest-driven index used by the CLI (`zopia navigate`),
 * the VS Code extension, and any tooling that jumps between a Swagger/OpenAPI
 * document and the generated api-docs tree. The index is built directly from
 * the tree's `.zopia-manifest.json`, so every pointer the tree can answer is
 * one generation produced — including custom companions (derived from the
 * manifest's recorded `options.custom`, since companion files are not
 * manifest-owned) and preset sub-trees (each bucket root carries its own
 * manifest and therefore its own index).
 *
 * Everything here is pure data lookup besides {@link loadNavigationIndex},
 * which is the single file-reading call.
 */

import { ZOPIA_MANIFEST_FILE, type ZopiaManifest } from './conversions/manifest-writer';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ZopiaError } from './errors';

/** Category of a navigation target inside a generated tree. */
export type ZopiaNavigationKind = 'endpoint' | 'webhook' | 'component' | 'custom' | 'manifest';

/** One concrete navigation target in the tree. */
export interface ZopiaNavigationLocation {
  /** Category of the target file. */
  kind: ZopiaNavigationKind;
  /** Tree-relative POSIX file path the target lives in. */
  file: string;
  /** JSON Pointer of the target in the source document (`#` for the manifest). */
  pointer: string;
  /** Human label, e.g. `get /pets (listPets)`. */
  label: string;
}

/** Manifest-driven, deterministic navigation index of one generated tree. */
export interface ZopiaNavigationIndex {
  /** The manifest the index was built from (verbatim, unparsed beyond shape checks). */
  manifest: ZopiaManifest;
  /**
   * Map a source-document JSON pointer to every generated file implementing it.
   * Supported shapes: `#` (manifest), `#/paths/&lt;path&gt;` (every method
   * of the item), `#/paths/&lt;path&gt;/&lt;method&gt;`,
   * `#/webhooks/&lt;name&gt;` (or its method), OpenAPI component pointers
   * `#/components/&lt;schemas|parameters|responses&gt;/&lt;name&gt;`, and
   * Swagger component pointers `#/&lt;definitions|parameters|responses&gt;/&lt;name&gt;`.
   * Component container pointers resolve to their barrel when emitted.
   * Companion files follow their endpoint when `options.custom` was recorded.
   * @param pointer Source-document JSON pointer (RFC 6901 fragment form).
   * @returns Navigation locations in deterministic file order.
   * @throws {ZopiaError} `ZOPIA_CONFIG_INVALID` — pointer shape is unsupported, the target declares no generated module (e.g. components emission was disabled), or the pointer matches nothing the tree generated.
   */
  specToLocations(pointer: string): ZopiaNavigationLocation[];
  /**
   * Map one tree-relative file back to its source-document pointer.
   * Companion `custom.ts` files, component barrels, and the manifest resolve as expected.
   * @param file Tree-relative path (`pets/get/index.ts`); `./` prefixes and backslash separators are normalized.
   * @returns The single pointer-backed location owning that file.
   * @throws {ZopiaError} `ZOPIA_CONFIG_INVALID` — the file is not represented in this tree.
   */
  treeToSpecLocation(file: string): ZopiaNavigationLocation;
  /** Resolve one operationId to its pointer (stable for YAML specs that cannot be scanned for structure). @param operationId The declared or derived operationId visible in the spec. @returns The pointer of that operation, or `undefined` when the tree holds no such operation. */
  pointerForOperationId(operationId: string): string | undefined;
  /** All pointer-backed locations in deterministic file order (the jump table). @returns Location list suitable for building source maps. */
  locations(): ZopiaNavigationLocation[];
}

/** Escape one JSON Pointer segment per RFC 6901. */
const escapePointerSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/** Decode one escaped JSON Pointer segment per RFC 6901. */
const decodePointerSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');

/** %{method} %{path|name} (%{operationId}) label shared by both directions. */
const operationLabel = (section: 'paths' | 'webhooks', path: string, method: string, operationId: string | undefined): string =>
  section === 'webhooks'
    ? `webhook ${path} ${method}${operationId ? ` (${operationId})` : ''}`
    : `${method} ${path}${operationId ? ` (${operationId})` : ''}`;

/** Companion `custom.ts` file of one endpoint module (sibling of `index.ts`, both layouts). */
const companionFile = (file: string): string => file.slice(0, -'index.ts'.length) + 'custom.ts';

/**
 * Build a navigation index directly from a trusted manifest. **Pure** — no I/O.
 *
 * @param manifest The tree's `.zopia-manifest.json` as JSON (already validated manifests accepted as-is).
 * @returns The navigation index.
 * @throws {ZopiaError} `ZOPIA_MANIFEST_INVALID` — the manifest is not an object or lacks the `apis` array.
 */
export function navigationIndexFromManifest(manifest: ZopiaManifest): ZopiaNavigationIndex {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray((manifest as { apis?: unknown }).apis)) {
    throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'invalid manifest for navigation: expected an object with an apis array', { at: '#', hint: 'regenerate the tree to rebuild a valid manifest' });
  }
  const custom = (manifest.options as { custom?: unknown } | undefined)?.custom === true;
  const byFile = new Map<string, ZopiaNavigationLocation>();
  const byPointer = new Map<string, ZopiaNavigationLocation[]>();
  const byOperationId = new Map<string, string>();
  const rememberPointer = (pointer: string, location: ZopiaNavigationLocation): void => {
    const existing = byPointer.get(pointer) ?? [];
    existing.push(location); byPointer.set(pointer, existing);
  };
  const remember = (location: ZopiaNavigationLocation): void => {
    byFile.set(location.file, location);
    rememberPointer(location.pointer, location);
  };
  remember({ kind: 'manifest', file: ZOPIA_MANIFEST_FILE, pointer: '#', label: 'manifest' });

  for (const api of manifest.apis) {
    if (!api || typeof api !== 'object') continue;
    const file = api.file;
    if (typeof file !== 'string' || typeof api.path !== 'string' || typeof api.method !== 'string') continue;
    const pointer = `#/paths/${escapePointerSegment(api.path)}/${api.method}`;
    const location: ZopiaNavigationLocation = { kind: 'endpoint', file, pointer, label: operationLabel('paths', api.path, api.method, api.operationId) };
    remember(location);
    if (custom) remember({ kind: 'custom', file: companionFile(file), pointer, label: `${location.label} custom companion` });
    if (api.operationId !== undefined && !byOperationId.has(api.operationId)) byOperationId.set(api.operationId, pointer);
  }
  for (const webhook of manifest.webhooks ?? []) {
    if (!webhook || typeof webhook !== 'object') continue;
    const file = webhook.file;
    if (typeof file !== 'string' || typeof webhook.name !== 'string' || typeof webhook.method !== 'string') continue;
    const pointer = `#/webhooks/${escapePointerSegment(webhook.name)}/${webhook.method}`;
    const location: ZopiaNavigationLocation = { kind: 'webhook', file, pointer, label: operationLabel('webhooks', webhook.name, webhook.method, webhook.operationId) };
    remember(location);
    if (custom) remember({ kind: 'custom', file: companionFile(file), pointer, label: `${location.label} custom companion` });
    if (webhook.operationId !== undefined && !byOperationId.has(webhook.operationId)) byOperationId.set(webhook.operationId, pointer);
  }
  const components = manifest.components ?? [];
  const sourceKind = (manifest.source as { kind?: string } | undefined)?.kind;
  const swagger = sourceKind === 'swagger-2.0';
  const componentKind = (component: { kind?: unknown }): 'schema' | 'parameter' | 'response' => component.kind === 'parameter' || component.kind === 'response' ? component.kind : 'schema';
  const componentContainerPointer = (kind: 'schema' | 'parameter' | 'response'): string => {
    if (swagger) return kind === 'schema' ? '#/definitions' : kind === 'parameter' ? '#/parameters' : '#/responses';
    return kind === 'schema' ? '#/components/schemas' : kind === 'parameter' ? '#/components/parameters' : '#/components/responses';
  };
  const componentPointer = (kind: 'schema' | 'parameter' | 'response', name: string): string => `${componentContainerPointer(kind)}/${escapePointerSegment(name)}`;
  const emittedComponentKinds = new Set<'schema' | 'parameter' | 'response'>();
  for (const component of components) {
    if (!component || typeof component !== 'object') continue;
    if (typeof component.file !== 'string' || typeof component.name !== 'string') continue;
    const kind = componentKind(component);
    emittedComponentKinds.add(kind);
    const label = kind === 'schema' ? `component ${component.name}` : `component ${kind} ${component.name}`;
    remember({ kind: 'component', file: component.file, pointer: componentPointer(kind, component.name), label });
  }
  if (manifest.options?.insertComponents === true || emittedComponentKinds.size > 0) {
    // components/index.ts is always the schema barrel whenever components are
    // emitted — including an empty schema container. Generated parameter and
    // response containers have their own kind barrels below.
    remember({ kind: 'component', file: 'components/index.ts', pointer: componentContainerPointer('schema'), label: 'component barrel' });
  }
  if (emittedComponentKinds.has('parameter')) remember({ kind: 'component', file: 'components/parameters/index.ts', pointer: componentContainerPointer('parameter'), label: 'component parameter barrel' });
  if (emittedComponentKinds.has('response')) remember({ kind: 'component', file: 'components/responses/index.ts', pointer: componentContainerPointer('response'), label: 'component response barrel' });

  const locationsSorted = [...byFile.values()].sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
  const index: ZopiaNavigationIndex = {
    manifest,
    specToLocations(pointer) {
      if (pointer === '#') return [{ kind: 'manifest', file: ZOPIA_MANIFEST_FILE, pointer: '#', label: 'manifest' }];
      const segments = pointer.startsWith('#/') ? pointer.slice(2).split('/').map(decodePointerSegment) : undefined;
      if (!segments || segments.length === 0) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported spec pointer for navigation: ${pointer}`, { at: pointer, hint: "use '#', '#/paths/<path>[/<method>]', '#/webhooks/<name>[/<method>]', or a source-dialect component pointer such as '#/components/schemas/<name>' or '#/definitions/<name>'" });
      const [section, ...rest] = segments;
      if (section === 'paths' || section === 'webhooks') {
        const [name, method, ...extra] = rest;
        if (name === undefined || extra.length > 0) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported spec pointer for navigation: ${pointer}`, { at: pointer, hint: `use '${section === 'paths' ? '#/paths/<path>/<method>' : '#/webhooks/<name>/<method>'}'` });
        if (method === undefined) {
          // Item-level pointer: every routed operation of the item (plus companions).
          const collected: ZopiaNavigationLocation[] = [];
          for (const location of locationsSorted) {
            if (!location.pointer.startsWith(`${pointer}/`)) continue;
            if (location.pointer.slice(pointer.length + 1).includes('/')) continue;
            collected.push(location);
          }
          if (collected.length > 0) return collected;
          throw new ZopiaError('ZOPIA_CONFIG_INVALID', `spec pointer has no generated module: ${pointer}`, { at: pointer, hint: 'check the item name, or regenerate from a newer source document' });
        }
        const hits = byPointer.get(pointer);
        if (hits && hits.length > 0) return hits;
        // exact pointer has no implementation — distinguish unheard targets from disabled sections
        if (section === 'webhooks') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `spec pointer has no generated module: ${pointer}`, { at: pointer, hint: 'check the webhook name and method, or regenerate from a newer source document' });
        throw new ZopiaError('ZOPIA_CONFIG_INVALID', `spec pointer has no generated module: ${pointer}`, { at: pointer, hint: 'check the path and method, or regenerate from a newer source document' });
      }
      const componentPointerShape = (): { kind: 'schema' | 'parameter' | 'response'; name?: string; container: string } | undefined => {
        if (section === 'components' && (rest[0] === 'schemas' || rest[0] === 'parameters' || rest[0] === 'responses')) {
          const kind = rest[0] === 'parameters' ? 'parameter' : rest[0] === 'responses' ? 'response' : 'schema';
          return rest.length <= 2 ? { kind, name: rest[1], container: `#/components/${rest[0]}` } : undefined;
        }
        if ((section === 'definitions' || section === 'parameters' || section === 'responses') && rest.length <= 1) {
          const kind = section === 'parameters' ? 'parameter' : section === 'responses' ? 'response' : 'schema';
          return { kind, name: rest[0], container: `#/${section}` };
        }
        return undefined;
      };
      const componentShape = componentPointerShape();
      if (componentShape) {
        if (componentShape.name === undefined) {
          const hits = byPointer.get(componentShape.container);
          if (hits && hits.length > 0) return hits;
          throw new ZopiaError('ZOPIA_CONFIG_INVALID', `spec pointer has no generated module: ${pointer}`, { at: pointer, hint: 'regenerate with insertComponents (--insert-components) to emit component modules' });
        }
        const expectedPointer = componentPointer(componentShape.kind, componentShape.name);
        if (pointer !== expectedPointer) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported spec pointer for navigation: ${pointer}`, { at: pointer, hint: `use '${componentContainerPointer(componentShape.kind)}/<name>' for this source dialect` });
        const hits = byPointer.get(pointer);
        if (hits && hits.length > 0) return hits;
        if (components.some((component) => component && typeof component === 'object' && componentKind(component) === componentShape.kind && component.name === componentShape.name)) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `component ${componentShape.name} declares no generated module: ${pointer}`, { at: pointer, hint: 'regenerate with insertComponents (--insert-components) to emit component modules' });
        throw new ZopiaError('ZOPIA_CONFIG_INVALID', `spec pointer has no generated module: ${pointer}`, { at: pointer, hint: 'check the component name, or regenerate from a newer source document' });
      }
      throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported spec pointer for navigation: ${pointer}`, { at: pointer, hint: "use '#', '#/paths/<path>[/<method>]', '#/webhooks/<name>[/<method>]', or a source-dialect component pointer such as '#/components/parameters/<name>' or '#/responses/<name>'" });
    },
    treeToSpecLocation(file) {
      const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
      const hit = byFile.get(normalized);
      if (hit) return hit;
      throw new ZopiaError('ZOPIA_CONFIG_INVALID', `file is not represented in this tree: ${file}`, { at: file, hint: 'pass a generated path relative to the tree root, e.g. pets/get/index.ts' });
    },
    pointerForOperationId(operationId) {
      return byOperationId.get(operationId);
    },
    locations() {
      return locationsSorted;
    },
  };
  return index;
}

/**
 * Load the navigation index of one generated tree by reading its manifest.
 * Each preset bucket root carries its own manifest and therefore its own index.
 *
 * @param outDir Directory holding a `.zopia-manifest.json` (tree root or preset bucket root).
 * @returns The navigation index for that tree.
 * @throws {ZopiaError} `ZOPIA_DOCS_MISSING_MANIFEST` — no readable manifest at `outDir` (generate first, with manifests enabled).
 * @throws {ZopiaError} `ZOPIA_MANIFEST_INVALID` — the manifest is not valid JSON or lacks the `apis` array.
 */
export async function loadNavigationIndex(outDir: string): Promise<ZopiaNavigationIndex> {
  const manifestPath = join(outDir, ZOPIA_MANIFEST_FILE);
  let text: string;
  try { text = await readFile(manifestPath, 'utf8'); }
  catch (error) { throw new ZopiaError('ZOPIA_DOCS_MISSING_MANIFEST', `Unable to load the manifest: ${error instanceof Error ? error.message : String(error)}`, { at: manifestPath, hint: 'generate the tree first (regeneration keeps manifests enabled by default)' }); }
  let manifest: ZopiaManifest;
  try { manifest = JSON.parse(text) as ZopiaManifest; }
  catch { throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'invalid manifest for navigation: not valid JSON', { at: manifestPath, hint: 'regenerate the tree to rebuild a valid manifest' }); }
  return navigationIndexFromManifest(manifest);
}

/**
 * Map JSON-pointers to their declaration line (1-based) in one JSON document
 * **text** — a single-pass whitespace/token scanner, no parser dependency.
 * Absent from the returned map = pointer not declared in this document;
 * the first occurrence wins for duplicate JSON keys.
 *
 * @param jsonText Raw JSON source text (`.json` spec files).
 * @param pointers Fragment pointers such as `#/paths/~1pets/get`.
 * @returns Map of found pointer → 1-based declaration line.
 * @throws {ZopiaError} `ZOPIA_SPEC_INVALID_JSON` — the text is not valid JSON.
 */
export function specPointersToLines(jsonText: string, pointers: string[]): Map<string, number> {
  const targets = new Map<string, string[] | null>();
  for (const pointer of pointers) {
    targets.set(pointer, pointer.startsWith('#/') ? pointer.slice(2).split('/').map(decodePointerSegment) : null);
  }
  const found = new Map<string, number>();
  let index = 0;
  let line = 1;
  const text = jsonText;
  const advance = (): void => { while (index < text.length && ' \t\r\n'.includes(text[index])) { if (text[index] === '\n') line += 1; index += 1; } };
  const scanString = (): string => {
    // Caller positioned index at the opening quote; scanString returns the decoded value.
    let depth = 0;
    let end = index + 1;
    while (end < text.length) {
      const char = text[end];
      if (char === '\\') { if (text[end + 1] === '\n') { throw invalidJson(); } end += 2; }
      else if (char === '"') { depth = 1; end += 1; break; }
      else { if (char === '\n') { // raw newline inside a string is invalid JSON
                throw invalidJson();
      } end += 1; }
    }
    if (end > text.length || depth !== 1) throw invalidJson();
    let value: string;
    try { value = JSON.parse(text.slice(index, end)) as string; }
    catch { throw invalidJson(); }
    const stringBody = text.slice(index + 1, end - 1);
    const newlineCount = (stringBody.match(/\n/g) ?? []).length;
    line += newlineCount;
    index = end;
    return value;
  };
  const invalidJson = (): ZopiaError => new ZopiaError('ZOPIA_SPEC_INVALID_JSON', 'Invalid JSON during pointer scan', { at: '#', hint: 'fix the JSON syntax' });
  const scanValue = (): void => {
    advance();
    if (index >= text.length) throw invalidJson();
    const char = text[index];
    if (char === '{') { scanObject(); return; }
    if (char === '[') { scanArray(); return; }
    if (char === '"') { scanString(); return; }
    // scalars: number/true/false/null — consume until a structural boundary,
    // then validate the token with JSON.parse so malformed scalars (`tru`, `01`,
    // `1e`, `nullx`, …) are rejected instead of being treated as valid JSON.
    const scalars = new Set(['t', 'f', 'n', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    if (!scalars.has(char)) throw invalidJson();
    const start = index;
    while (index < text.length && !' \t\r\n,}]'.includes(text[index])) index += 1;
    try { JSON.parse(text.slice(start, index)); }
    catch { throw invalidJson(); }
  };
  /** Stack of object-key segments along the current path ('' inside arrays). */
  const path: string[] = [];
  const scanObject = (): void => {
    index += 1; // '{'
    advance();
    if (text[index] === '}') { index += 1; return; }
    // empty object
    while (true) {
      advance();
      if (text[index] !== '"') throw invalidJson();
      const keyStartLine = line;
      const key = scanString();
      path.push(key);
      for (const [pointer, segments] of targets) {
        if (segments === null || found.has(pointer)) continue;
        if (segments.length !== path.length) continue;
        let match = true;
        for (let depth = 0; depth < segments.length; depth += 1) { if (segments[depth] !== path[depth]) { match = false; break; } }
        if (match) found.set(pointer, keyStartLine);
      }
      advance();
      if (text[index] !== ':') throw invalidJson();
      index += 1;
      scanValue();
      path.pop();
      advance();
      if (text[index] === ',') { index += 1; continue; }
      if (text[index] === '}') { index += 1; return; }
      throw invalidJson();
    }
  };
  const scanArray = (): void => {
    index += 1; // '['
    advance();
    if (text[index] === ']') { index += 1; return; }
    // elements share the enclosing key path ('' placeholder keeps depth honest)
    path.push('');
    while (true) {
      scanValue();
      advance();
      if (text[index] === ',') { index += 1; continue; }
      if (text[index] === ']') { index += 1; path.pop(); return; }
      throw invalidJson();
    }
  };
  scanValue();
  advance();
  if (index < text.length) throw invalidJson();
  return found;
}

/**
 * Map ONE pointer to its declaration line — convenience wrapper of
 * {@link specPointersToLines}.
 *
 * @param jsonText Raw JSON source text.
 * @param pointer Fragment pointer such as `#/paths/~1pets/get`.
 * @returns The 1-based declaration line, or `undefined` when not declared.
 * @throws {ZopiaError} `ZOPIA_SPEC_INVALID_JSON` — the text is not valid JSON.
 */
export function specPointerToLine(jsonText: string, pointer: string): number | undefined {
  return specPointersToLines(jsonText, [pointer]).get(pointer);
}

/**
 * Choose the pointer whose declaration line most closely precedes (or equals)
 * a given line — the "which operation am I standing in" rule editors use.
 * Ties prefer the longer (deeper) pointer, then lexical order for determinism.
 *
 * @param jsonText Raw JSON source text.
 * @param line 1-based target line (e.g. the cursor line).
 * @param pointers Candidate pointers (typically `index.locations()` pointers).
 * @returns The winning pointer, or `undefined` when none is at-or-before the line.
 * @throws {ZopiaError} `ZOPIA_SPEC_INVALID_JSON` — the text is not valid JSON.
 */
export function specPointerAtLine(jsonText: string, line: number, pointers: string[]): string | undefined {
  const lines = specPointersToLines(jsonText, pointers);
  let winner: string | undefined;
  let winnerLine = -1;
  for (const pointer of pointers) {
    const found = lines.get(pointer);
    if (found === undefined || found > line) continue;
    if (found > winnerLine || (found === winnerLine && winner !== undefined && (pointer.length > winner.length || pointer.length === winner.length && pointer < winner))) {
      winner = pointer; winnerLine = found;
    }
  }
  return winner;
}
