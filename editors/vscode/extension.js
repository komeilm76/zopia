/**
 * Zopia Navigator — VS Code glue over zopia's manifest-driven navigation core.
 *
 * All mapping rules live in zopia itself (`loadNavigationIndex`,
 * `specToLocations`, `treeToSpecLocation`, `specPointersToLines`,
 * `specPointerAtLine`, `pointerForOperationId`); this file resolves the
 * workspace, opens documents, and reports errors. The extension finds zopia
 * in the workspace (`npm install zopia`) instead of bundling it, so it always
 * matches the exact version and manifest shape of the tree under the cursor.
 *
 * Plain CommonJS on purpose: zero build step, loadable via F5 and `vsce`
 * without a bundler.
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/** Depth limit for upward directory walks (manifest roots, specs). */
const WALK_LIMIT = 40;
/** Candidate glob for spec documents (JSON and YAML). */
const SPEC_GLOB = '**/*.{json,jsonc,yml,yaml}';

/** Import the workspace's zopia install — the version that wrote the tree. */
async function loadZopia(startDir) {
  let resolved;
  try {
    resolved = require.resolve('zopia', { paths: [startDir, process.cwd()] });
  } catch {
    vscode.window.showErrorMessage('zopia is not installed in this workspace — run `npm install zopia` (the extension resolves the version colocated with the tree).');
    return undefined;
  }
  return import(pathToFileURL(resolved).href);
}

/** Nearest directory at or above `filePath` holding a .zopia-manifest.json. */
function treeRootFor(filePath) {
  let dir = path.extname(filePath) ? path.dirname(filePath) : filePath;
  for (let depth = 0; depth < WALK_LIMIT; depth += 1) {
    if (fs.existsSync(path.join(dir, '.zopia-manifest.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** All manifest roots under the workspace folders (node_modules excluded). */
async function workspaceTreeRoots() {
  const manifests = await vscode.workspace.findFiles('**/.zopia-manifest.json', '**/node_modules/**', 64);
  return [...new Set(manifests.map((uri) => path.dirname(uri.fsPath)))].sort();
}

/** Spec document candidates whose info.title matches the manifest's source title. */
async function specCandidates(index, treeRoot) {
  const manifestTitle = index.manifest?.source?.title;
  const active = vscode.window.activeTextEditor;
  const found = await vscode.workspace.findFiles(SPEC_GLOB, '**/node_modules/**', 200);
  const candidates = [];
  if (active && ['json', 'jsonc', 'yaml'].includes(active.document.languageId) && active.document.uri.scheme === 'file') {
    candidates.push(active.document.uri.fsPath);
  }
  for (const candidate of found) candidates.push(candidate.fsPath);
  const unique = [...new Set(candidates)].filter((file) => !file.startsWith(treeRoot + path.sep));
  if (manifestTitle === undefined) return unique;
  const titled = [];
  for (const file of unique) {
    let head;
    try { head = fs.readFileSync(file, 'utf8').slice(0, 4096); } catch { continue; }
    if (head.includes(`"title"`) || head.includes('title:')) {
      if (head.includes(`"${manifestTitle}"`) || head.includes(`title: ${manifestTitle}`) || head.includes(`'${manifestTitle}'`)) titled.push(file);
    }
  }
  return titled.length > 0 ? titled : unique;
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

/** The operationId inside a `... (id)` label, when present. */
function labelOperationId(label) {
  const match = /\(([^()]*)\)$/.exec(label);
  return match ? match[1] : undefined;
}

/** From code → spec: locate the pointer owning the file under the cursor and jump. */
async function openSpecLocation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') return;
  const filePath = editor.document.uri.fsPath;
  const treeRoot = treeRootFor(filePath);
  if (treeRoot === undefined) { vscode.window.showInformationMessage(`No .zopia-manifest.json above ${path.basename(filePath)} — generate the api-docs tree first.`); return; }
  const zopia = await loadZopia(treeRoot);
  if (!zopia) return;
  let index;
  try { index = await zopia.loadNavigationIndex(treeRoot); }
  catch (error) { vscode.window.showErrorMessage(`Cannot read the manifest of ${treeRoot}: ${error?.message ?? error}`); return; }
  const relative = path.relative(treeRoot, filePath).split(path.sep).join('/');
  let location;
  try { location = index.treeToSpecLocation(relative); }
  catch (error) { vscode.window.showInformationMessage(error?.message ?? `The file is not represented in this tree: ${relative}`); return; }
  const candidates = await specCandidates(index, treeRoot);
  if (candidates.length === 0) { vscode.window.showWarningMessage(`No spec document matching this tree (${location.pointer}) was found in the workspace.`); return; }
  const chosen = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map((file) => ({ label: path.basename(file), description: path.relative(treeRoot, file), file })), { placeHolder: `Jump to ${location.pointer}` }))?.file;
  if (!chosen) return;
  // JSON specs jump exactly on the declaration line; YAML falls back to the
  // operationId marker (line structure differs, documented best-effort).
  let line;
  try {
    const text = fs.readFileSync(chosen, 'utf8');
    if (/\.(json|jsonc)$/i.test(chosen)) {
      line = zopia.specPointerToLine(text, location.pointer);
    } else {
      const operationId = labelOperationId(location.label);
      if (operationId !== undefined) {
        const offset = text.search(new RegExp(`^\\s*operationId:\\s*['"]?${operationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm'));
        if (offset >= 0) line = text.slice(0, offset).split('\n').length;
      }
    }
  } catch { /* fall through — open at the top */ }
  await openAt(chosen, line);
}

/** From spec → code: resolve the operation enclosing the cursor and jump to its module. */
async function openGeneratedCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.(json|jsonc|yaml|yml)$/i.test(editor.document.uri.fsPath)) {
    vscode.window.showInformationMessage('Run from a Swagger/OpenAPI document (.json, .yaml, .yml).');
    return;
  }
  const specPath = editor.document.uri.fsPath;
  let roots = await workspaceTreeRoots();
  if (roots.length === 0) { vscode.window.showInformationMessage('No .zopia-manifest.json in this workspace — generate the api-docs tree first.'); return; }
  const treeRoot = roots.length === 1 && treeRootFor(specPath) === undefined
    ? roots[0]
    : (treeRootFor(specPath) ?? (await vscode.window.showQuickPick(roots.map((root) => ({ label: path.basename(root), description: root, root })), { placeHolder: 'Which api-docs tree should receive the cursor?' }))?.root);
  if (treeRoot === undefined) { vscode.window.showInformationMessage(`The spec file lives inside a generated tree — run from the spec workspace, not from ${path.basename(treeRootFor(specPath) ?? '')}.`); return; }
  const zopia = await loadZopia(treeRoot);
  if (!zopia) return;
  let index;
  try { index = await zopia.loadNavigationIndex(treeRoot); }
  catch (error) { vscode.window.showErrorMessage(`Cannot read the manifest of ${treeRoot}: ${error?.message ?? error}`); return; }
  const text = editor.document.getText();
  const cursorLine = editor.selection.active.line + 1;
  const pointers = index.locations().filter((location) => location.kind === 'endpoint' || location.kind === 'webhook' || location.kind === 'component').map((location) => location.pointer);
  let pointer;
  const isJson = /\.(json|jsonc)$/i.test(specPath);
  if (isJson) {
    try { pointer = zopia.specPointerAtLine(text, cursorLine, pointers); }
    catch { vscode.window.showErrorMessage('The active document is not valid JSON — fix the syntax and retry.'); return; }
  } else {
    // YAML: nearest operationId marker at-or-above the cursor (documented best-effort)
    const lines = text.split('\n').slice(0, cursorLine);
    for (let lineNumber = lines.length - 1; lineNumber >= 0; lineNumber -= 1) {
      const match = /^\s*operationId:\s*['"]?([\w./-]+)['"]?\s*$/.exec(lines[lineNumber]);
      if (match) { pointer = index.pointerForOperationId(match[1]); if (pointer !== undefined) break; }
    }
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
