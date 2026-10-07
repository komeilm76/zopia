/**
 * Zopia Navigator — VS Code glue for zopia's manifest-driven navigation map.
 *
 * The extension reads `.zopia-manifest.json` directly instead of dynamically
 * importing the workspace's `zopia` package. That keeps the extension usable in
 * VS Code's Node-based extension host even though zopia itself is Bun-first and
 * publishes TypeScript source. The implementation below intentionally mirrors
 * the public navigation contract: endpoints, webhooks, schema components,
 * reusable parameter/response components, barrels, custom companions, and the
 * manifest all map back to stable source pointers.
 *
 * Plain CommonJS on purpose: zero build step, loadable via F5 and `vsce`
 * without a bundler.
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/** Depth limit for upward directory walks (manifest roots, specs). */
const WALK_LIMIT = 40;
/** Candidate glob for spec documents accepted by zopia (JSON and YAML). */
const SPEC_GLOB = '**/*.{json,yml,yaml}';
/** Stable manifest file name written by zopia. */
const MANIFEST_FILE = '.zopia-manifest.json';

/** Escape one JSON Pointer segment per RFC 6901. */
function escapePointerSegment(segment) { return String(segment).replace(/~/g, '~0').replace(/\//g, '~1'); }
/** Decode one JSON Pointer segment per RFC 6901. */
function decodePointerSegment(segment) { return segment.replace(/~1/g, '/').replace(/~0/g, '~'); }
/** Operation label shared by source/tree directions. */
function operationLabel(section, name, method, operationId) { return section === 'webhooks' ? `webhook ${name} ${method}${operationId ? ` (${operationId})` : ''}` : `${method} ${name}${operationId ? ` (${operationId})` : ''}`; }
/** Companion file next to an endpoint module. */
function companionFile(file) { return file.slice(0, -'index.ts'.length) + 'custom.ts'; }

/** Build the manifest-backed navigation index used by both commands. */
function navigationIndexFromManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.apis)) throw new Error('invalid zopia manifest: expected an object with an apis array');
  const custom = manifest.options?.custom === true;
  const byFile = new Map();
  const byPointer = new Map();
  const byOperationId = new Map();
  const byPointerOperationId = new Map();
  const rememberPointer = (pointer, location) => {
    const existing = byPointer.get(pointer) ?? [];
    existing.push(location);
    byPointer.set(pointer, existing);
  };
  const remember = (location) => {
    byFile.set(location.file, location);
    rememberPointer(location.pointer, location);
  };

  remember({ kind: 'manifest', file: MANIFEST_FILE, pointer: '#', label: 'manifest' });
  for (const api of manifest.apis) {
    if (!api || typeof api !== 'object' || typeof api.file !== 'string' || typeof api.path !== 'string' || typeof api.method !== 'string') continue;
    const pointer = `#/paths/${escapePointerSegment(api.path)}/${api.method}`;
    const location = { kind: 'endpoint', file: api.file, pointer, label: operationLabel('paths', api.path, api.method, api.operationId) };
    remember(location);
    if (custom) remember({ kind: 'custom', file: companionFile(api.file), pointer, label: `${location.label} custom companion` });
    if (typeof api.operationId === 'string') {
      if (!byOperationId.has(api.operationId)) byOperationId.set(api.operationId, pointer);
      if (!byPointerOperationId.has(pointer)) byPointerOperationId.set(pointer, api.operationId);
    }
  }
  for (const webhook of manifest.webhooks ?? []) {
    if (!webhook || typeof webhook !== 'object' || typeof webhook.file !== 'string' || typeof webhook.name !== 'string' || typeof webhook.method !== 'string') continue;
    const pointer = `#/webhooks/${escapePointerSegment(webhook.name)}/${webhook.method}`;
    const location = { kind: 'webhook', file: webhook.file, pointer, label: operationLabel('webhooks', webhook.name, webhook.method, webhook.operationId) };
    remember(location);
    if (custom) remember({ kind: 'custom', file: companionFile(webhook.file), pointer, label: `${location.label} custom companion` });
    if (typeof webhook.operationId === 'string') {
      if (!byOperationId.has(webhook.operationId)) byOperationId.set(webhook.operationId, pointer);
      if (!byPointerOperationId.has(pointer)) byPointerOperationId.set(pointer, webhook.operationId);
    }
  }

  const sourceKind = manifest.source?.kind;
  const swagger = sourceKind === 'swagger-2.0';
  const componentKind = (component) => component?.kind === 'parameter' || component?.kind === 'response' ? component.kind : 'schema';
  const componentContainerPointer = (kind) => {
    if (swagger) return kind === 'schema' ? '#/definitions' : kind === 'parameter' ? '#/parameters' : '#/responses';
    return kind === 'schema' ? '#/components/schemas' : kind === 'parameter' ? '#/components/parameters' : '#/components/responses';
  };
  const componentPointer = (kind, name) => `${componentContainerPointer(kind)}/${escapePointerSegment(name)}`;
  const emittedComponentKinds = new Set();
  for (const component of manifest.components ?? []) {
    if (!component || typeof component !== 'object' || typeof component.file !== 'string' || typeof component.name !== 'string') continue;
    const kind = componentKind(component);
    emittedComponentKinds.add(kind);
    remember({ kind: 'component', file: component.file, pointer: componentPointer(kind, component.name), label: kind === 'schema' ? `component ${component.name}` : `component ${kind} ${component.name}` });
  }
  if (manifest.options?.insertComponents === true || emittedComponentKinds.size > 0) {
    // Mirror the core index: components/index.ts is always the schema barrel,
    // including an empty schema container and parameter/response-only trees.
    remember({ kind: 'component', file: 'components/index.ts', pointer: componentContainerPointer('schema'), label: 'component barrel' });
  }
  if (emittedComponentKinds.has('parameter')) remember({ kind: 'component', file: 'components/parameters/index.ts', pointer: componentContainerPointer('parameter'), label: 'component parameter barrel' });
  if (emittedComponentKinds.has('response')) remember({ kind: 'component', file: 'components/responses/index.ts', pointer: componentContainerPointer('response'), label: 'component response barrel' });

  const locationsSorted = [...byFile.values()].sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
  return {
    manifest,
    locations: () => locationsSorted,
    pointerForOperationId: (operationId) => byOperationId.get(operationId),
    operationIdForPointer: (pointer) => byPointerOperationId.get(pointer),
    specToLocations(pointer) {
      if (pointer === '#') return [{ kind: 'manifest', file: MANIFEST_FILE, pointer: '#', label: 'manifest' }];
      const direct = byPointer.get(pointer);
      if (direct?.length) return direct;
      const segments = pointer.startsWith('#/') ? pointer.slice(2).split('/').map(decodePointerSegment) : [];
      if (segments[0] === 'paths' || segments[0] === 'webhooks') {
        const collected = locationsSorted.filter((location) => location.pointer.startsWith(`${pointer}/`) && !location.pointer.slice(pointer.length + 1).includes('/'));
        if (collected.length) return collected;
      }
      throw new Error(`spec pointer has no generated module: ${pointer}`);
    },
    treeToSpecLocation(file) {
      const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
      const hit = byFile.get(normalized);
      if (hit) return hit;
      throw new Error(`file is not represented in this tree: ${file}`);
    },
  };
}

/** Load one tree's navigation index from disk. */
function loadNavigationIndex(treeRoot) {
  const manifestPath = path.join(treeRoot, MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return navigationIndexFromManifest(manifest);
}

/** Map JSON pointers to 1-based declaration lines in a JSON document. */
function specPointersToLines(jsonText, pointers) {
  const targets = new Map();
  for (const pointer of pointers) targets.set(pointer, pointer.startsWith('#/') ? pointer.slice(2).split('/').map(decodePointerSegment) : null);
  const found = new Map();
  let index = 0;
  let line = 1;
  const text = jsonText;
  const invalidJson = () => new Error('Invalid JSON during pointer scan');
  const advance = () => { while (index < text.length && ' \t\r\n'.includes(text[index])) { if (text[index] === '\n') line += 1; index += 1; } };
  const scanString = () => {
    let closed = false;
    let end = index + 1;
    while (end < text.length) {
      const char = text[end];
      if (char === '\\') { if (text[end + 1] === '\n') throw invalidJson(); end += 2; }
      else if (char === '"') { closed = true; end += 1; break; }
      else { if (char === '\n') throw invalidJson(); end += 1; }
    }
    if (!closed) throw invalidJson();
    let value;
    try { value = JSON.parse(text.slice(index, end)); }
    catch { throw invalidJson(); }
    line += (text.slice(index + 1, end - 1).match(/\n/g) ?? []).length;
    index = end;
    return value;
  };
  const pathStack = [];
  const scanValue = () => {
    advance();
    if (index >= text.length) throw invalidJson();
    const char = text[index];
    if (char === '{') { scanObject(); return; }
    if (char === '[') { scanArray(); return; }
    if (char === '"') { scanString(); return; }
    const scalars = new Set(['t', 'f', 'n', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    if (!scalars.has(char)) throw invalidJson();
    const start = index;
    while (index < text.length && !' \t\r\n,}]'.includes(text[index])) index += 1;
    try { JSON.parse(text.slice(start, index)); }
    catch { throw invalidJson(); }
  };
  const scanObject = () => {
    index += 1;
    advance();
    if (text[index] === '}') { index += 1; return; }
    while (true) {
      advance();
      if (text[index] !== '"') throw invalidJson();
      const keyStartLine = line;
      const key = scanString();
      pathStack.push(key);
      for (const [pointer, segments] of targets) {
        if (segments === null || found.has(pointer) || segments.length !== pathStack.length) continue;
        if (segments.every((segment, depth) => segment === pathStack[depth])) found.set(pointer, keyStartLine);
      }
      advance();
      if (text[index] !== ':') throw invalidJson();
      index += 1;
      scanValue();
      pathStack.pop();
      advance();
      if (text[index] === ',') { index += 1; continue; }
      if (text[index] === '}') { index += 1; return; }
      throw invalidJson();
    }
  };
  const scanArray = () => {
    index += 1;
    advance();
    if (text[index] === ']') { index += 1; return; }
    pathStack.push('');
    while (true) {
      scanValue();
      advance();
      if (text[index] === ',') { index += 1; continue; }
      if (text[index] === ']') { index += 1; pathStack.pop(); return; }
      throw invalidJson();
    }
  };
  scanValue();
  advance();
  if (index < text.length) throw invalidJson();
  return found;
}

function specPointerToLine(jsonText, pointer) { return specPointersToLines(jsonText, [pointer]).get(pointer); }
function specPointerAtLine(jsonText, targetLine, pointers) {
  const lines = specPointersToLines(jsonText, pointers);
  let winner;
  let winnerLine = -1;
  for (const pointer of pointers) {
    const found = lines.get(pointer);
    if (found === undefined || found > targetLine) continue;
    if (found > winnerLine || (found === winnerLine && winner !== undefined && (pointer.length > winner.length || pointer.length === winner.length && pointer < winner))) {
      winner = pointer;
      winnerLine = found;
    }
  }
  return winner;
}

/** Nearest directory at or above `filePath` holding a .zopia-manifest.json. */
function treeRootFor(filePath) {
  let dir = path.extname(filePath) ? path.dirname(filePath) : filePath;
  for (let depth = 0; depth < WALK_LIMIT; depth += 1) {
    if (fs.existsSync(path.join(dir, MANIFEST_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** All manifest roots under the workspace folders (node_modules excluded). */
async function workspaceTreeRoots() {
  const manifests = await vscode.workspace.findFiles(`**/${MANIFEST_FILE}`, '**/node_modules/**', 64);
  return [...new Set(manifests.map((uri) => path.dirname(uri.fsPath)))].sort();
}

/** Spec document candidates whose info.title matches the manifest's source title. */
async function specCandidates(index, treeRoot) {
  const manifestTitle = index.manifest?.source?.title;
  const active = vscode.window.activeTextEditor;
  const found = await vscode.workspace.findFiles(SPEC_GLOB, '**/node_modules/**', 200);
  const candidates = [];
  if (active && ['json', 'yaml'].includes(active.document.languageId) && active.document.uri.scheme === 'file') candidates.push(active.document.uri.fsPath);
  for (const candidate of found) candidates.push(candidate.fsPath);
  const isInsideTree = (file) => {
    const relative = path.relative(treeRoot, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  const unique = [...new Set(candidates)].filter((file) => path.basename(file) !== MANIFEST_FILE);
  // Generated trees are normally dedicated folders, but `outDir` may be the
  // workspace/spec folder itself. Prefer candidates outside the tree; when
  // everything lives under its root, retain those files rather than returning
  // no source document at all. Generated modules are TypeScript, so excluding
  // the manifest is sufficient for JSON/YAML candidates.
  const outsideTree = unique.filter((file) => !isInsideTree(file));
  const pool = outsideTree.length > 0 ? outsideTree : unique;
  if (manifestTitle === undefined) return pool;
  const titled = [];
  for (const file of pool) {
    let head;
    try { head = fs.readFileSync(file, 'utf8').slice(0, 4096); } catch { continue; }
    if ((head.includes('"title"') || head.includes('title:')) && (head.includes(`"${manifestTitle}"`) || head.includes(`title: ${manifestTitle}`) || head.includes(`'${manifestTitle}'`))) titled.push(file);
  }
  return titled.length > 0 ? titled : pool;
}

/** Open the file, optionally centered on a 1-based line. */
async function openAt(filePath, line) {
  const document = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(document);
  if (line !== undefined && line >= 1 && line <= document.lineCount) {
    const position = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

/**
 * Parse the scalar value of one simple `operationId:` YAML mapping line.
 * This intentionally covers the documented best-effort marker form rather
 * than duplicating a full YAML parser, but it handles quoted IDs, escapes,
 * comments, and IDs beyond a small identifier character set.
 */
function yamlOperationIdFromLine(line) {
  const match = /^\s*operationId\s*:\s*(.*?)\s*$/.exec(line);
  if (!match) return undefined;
  const raw = match[1];
  if (raw === '') return undefined;
  const doubleQuoted = /^"((?:\\.|[^"\\])*)"(?:\s+#.*)?$/.exec(raw);
  if (doubleQuoted) {
    try { return JSON.parse(`"${doubleQuoted[1]}"`); }
    catch { return undefined; }
  }
  const singleQuoted = /^'((?:''|[^'])*)'(?:\s+#.*)?$/.exec(raw);
  if (singleQuoted) return singleQuoted[1].replace(/''/g, "'");
  return raw.replace(/\s+#.*$/, '').trim();
}

/** Line number (1-based) whose simple YAML marker declares exactly this operationId. */
function yamlOperationIdLine(text, operationId) {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (yamlOperationIdFromLine(lines[index]) === operationId) return index + 1;
  }
  return undefined;
}

/**
 * Last simple YAML operationId marker at-or-above a 1-based line, provided the
 * cursor did not visibly leave that marker's mapping afterward. This keeps a
 * cursor inside a later `components:` section from inheriting the operationId
 * of the last path operation.
 */
function yamlOperationIdAtOrAbove(text, targetLine) {
  const lines = text.split('\n').slice(0, targetLine);
  const indentation = (line) => line.match(/^[ \t]*/)?.[0].length ?? 0;
  candidates: for (let lineNumber = lines.length - 1; lineNumber >= 0; lineNumber -= 1) {
    const operationId = yamlOperationIdFromLine(lines[lineNumber]);
    if (operationId === undefined || operationId === '') continue;
    const markerIndent = indentation(lines[lineNumber]);
    for (let index = lineNumber + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      if (indentation(line) < markerIndent) continue candidates;
    }
    return operationId;
  }
  return undefined;
}

/** From code → spec: locate the pointer owning the file under the cursor and jump. */
async function openSpecLocation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') return;
  const filePath = editor.document.uri.fsPath;
  const treeRoot = treeRootFor(filePath);
  if (treeRoot === undefined) { vscode.window.showInformationMessage(`No ${MANIFEST_FILE} above ${path.basename(filePath)} — generate the api-docs tree first.`); return; }
  let index;
  try { index = loadNavigationIndex(treeRoot); }
  catch (error) { vscode.window.showErrorMessage(`Cannot read the manifest of ${treeRoot}: ${error?.message ?? error}`); return; }
  const relative = path.relative(treeRoot, filePath).split(path.sep).join('/');
  let location;
  try { location = index.treeToSpecLocation(relative); }
  catch (error) { vscode.window.showInformationMessage(error?.message ?? `The file is not represented in this tree: ${relative}`); return; }
  const candidates = await specCandidates(index, treeRoot);
  if (candidates.length === 0) { vscode.window.showWarningMessage(`No spec document matching this tree (${location.pointer}) was found in the workspace.`); return; }
  const chosen = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map((file) => ({ label: path.basename(file), description: path.relative(treeRoot, file), file })), { placeHolder: `Jump to ${location.pointer}` }))?.file;
  if (!chosen) return;
  let line;
  try {
    const text = fs.readFileSync(chosen, 'utf8');
    if (/\.json$/i.test(chosen)) line = specPointerToLine(text, location.pointer);
    else {
      const operationId = index.operationIdForPointer(location.pointer);
      if (operationId !== undefined) line = yamlOperationIdLine(text, operationId);
    }
  } catch { /* fall through — open at the top */ }
  await openAt(chosen, line);
}

/** From spec → code: resolve the operation enclosing the cursor and jump to its module. */
async function openGeneratedCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.(json|yaml|yml)$/i.test(editor.document.uri.fsPath)) {
    vscode.window.showInformationMessage('Run from a Swagger/OpenAPI document (.json, .yaml, .yml).');
    return;
  }
  const specPath = editor.document.uri.fsPath;
  const roots = await workspaceTreeRoots();
  if (roots.length === 0) { vscode.window.showInformationMessage(`No ${MANIFEST_FILE} in this workspace — generate the api-docs tree first.`); return; }
  const treeRoot = roots.length === 1 && treeRootFor(specPath) === undefined
    ? roots[0]
    : (treeRootFor(specPath) ?? (await vscode.window.showQuickPick(roots.map((root) => ({ label: path.basename(root), description: root, root })), { placeHolder: 'Which api-docs tree should receive the cursor?' }))?.root);
  if (treeRoot === undefined) { vscode.window.showInformationMessage(`The spec file lives inside a generated tree — run from the spec workspace, not from ${path.basename(treeRootFor(specPath) ?? '')}.`); return; }
  let index;
  try { index = loadNavigationIndex(treeRoot); }
  catch (error) { vscode.window.showErrorMessage(`Cannot read the manifest of ${treeRoot}: ${error?.message ?? error}`); return; }
  const text = editor.document.getText();
  const cursorLine = editor.selection.active.line + 1;
  const pointers = index.locations().filter((location) => location.kind === 'endpoint' || location.kind === 'webhook' || location.kind === 'component').map((location) => location.pointer);
  let pointer;
  const isJson = /\.json$/i.test(specPath);
  if (isJson) {
    try { pointer = specPointerAtLine(text, cursorLine, pointers); }
    catch { vscode.window.showErrorMessage('The active document is not valid JSON — fix the syntax and retry.'); return; }
  } else {
    const operationId = yamlOperationIdAtOrAbove(text, cursorLine);
    if (operationId !== undefined) pointer = index.pointerForOperationId(operationId);
  }
  if (pointer === undefined) { vscode.window.showInformationMessage(`No known operation or schema at-or-above cursor line ${cursorLine} (tree: ${path.basename(treeRoot)}).`); return; }
  let locations;
  try { locations = index.specToLocations(pointer); }
  catch (error) { vscode.window.showInformationMessage(error?.message ?? `Nothing generated for ${pointer}.`); return; }
  const primary = locations.find((location) => location.kind === 'endpoint' || location.kind === 'webhook' || location.kind === 'component') ?? locations[0];
  await openAt(path.join(treeRoot, primary.file), 1);
}

/** Register the two jump commands. @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('zopia.openSpecLocation', openSpecLocation),
    vscode.commands.registerCommand('zopia.openGeneratedCode', openGeneratedCode),
  );
}

/** Nothing to clean up. */
function deactivate() {}

module.exports = { activate, deactivate };
