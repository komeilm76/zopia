import { lstat, readFile, realpath, rmdir, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ApiDocsMode } from './api-docs-layout';
import {
  validateZopiaManifest,
  ZOPIA_MANIFEST_FILE,
  type GeneratedZopiaManifest,
  type ZopiaManifest,
} from './manifest-writer';

/** Current source and generation settings compared with an existing manifest. */
export interface ZopiaManifestGenerationIdentity {
  /** Canonical SHA-256 identity of the normalized source document. */
  sourceSha256: string;
  /** Requested endpoint layout. */
  mode: ApiDocsMode;
  /** Whether component modules are requested. */
  insertComponents: boolean;
  /** Whether endpoint modules should import emitted components. */
  useComponentAsReference: boolean;
  /** Whether this generation should retain a manifest. */
  manifest: boolean;
}

/** Stable reason why an existing generated tree is stale. */
export type ZopiaManifestStalenessReason =
  | 'invalid-manifest'
  | 'source-changed'
  | 'mode-changed'
  | 'component-options-changed'
  | 'generated-files-missing'
  | 'manifest-disabled';

/** Result of inspecting the manifest already present in an output directory. */
export interface ZopiaManifestStaleness {
  /** Whether no existing manifest, a matching manifest, or stale metadata was found. */
  status: 'absent' | 'current' | 'stale';
  /** Deterministically ordered causes of staleness. */
  reasons: ZopiaManifestStalenessReason[];
  /** Files safely claimed by a valid current-format manifest. */
  ownedFiles: string[];
}

const isMissing = (error: unknown): boolean => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
const isNotEmpty = (error: unknown): boolean => Boolean(error && typeof error === 'object' && ['ENOTEMPTY', 'EEXIST'].includes(String((error as { code?: unknown }).code)));

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectOwnedFiles(manifest: GeneratedZopiaManifest): string[] {
  const files = new Set<string>([ZOPIA_MANIFEST_FILE]);
  for (const api of manifest.apis) files.add(api.file);
  for (const component of manifest.components) if (component.file !== null) files.add(component.file);
  if (manifest.options.insertComponents) files.add('components/index.ts');
  return [...files].sort(compareText);
}

async function hasMissingOwnedFiles(outputDir: string, ownedFiles: readonly string[]): Promise<boolean> {
  const root = resolve(outputDir);
  const rootReal = await realpath(root);
  for (const file of ownedFiles) {
    if (file === ZOPIA_MANIFEST_FILE) continue;
    const candidate = resolve(root, ...file.split('/'));
    if (!isInside(root, candidate)) return true;
    try {
      const actual = await realpath(candidate);
      if (!isInside(rootReal, actual) || !(await stat(actual)).isFile()) return true;
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }
  }
  return false;
}

/** Inspect an existing manifest without executing generated modules. */
export async function inspectZopiaManifestStaleness(outputDir: string, identity: ZopiaManifestGenerationIdentity): Promise<ZopiaManifestStaleness> {
  const file = join(resolve(outputDir), ZOPIA_MANIFEST_FILE);
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (error) {
    if (isMissing(error)) return { status: 'absent', reasons: [], ownedFiles: [] };
    throw error;
  }

  let manifest: ZopiaManifest;
  try {
    manifest = JSON.parse(source) as ZopiaManifest;
    validateZopiaManifest(manifest);
  } catch {
    return {
      status: 'stale',
      reasons: ['invalid-manifest', ...(!identity.manifest ? ['manifest-disabled' as const] : [])],
      ownedFiles: [ZOPIA_MANIFEST_FILE],
    };
  }

  const generated = manifest as GeneratedZopiaManifest;
  const ownedFiles = collectOwnedFiles(generated);
  const reasons: ZopiaManifestStalenessReason[] = [];
  if (generated.source.sha256 !== identity.sourceSha256) reasons.push('source-changed');
  if (generated.mode !== identity.mode) reasons.push('mode-changed');
  if (generated.options.insertComponents !== identity.insertComponents || generated.options.useComponentAsReference !== identity.useComponentAsReference) reasons.push('component-options-changed');
  if (await hasMissingOwnedFiles(outputDir, ownedFiles)) reasons.push('generated-files-missing');
  if (!identity.manifest) reasons.push('manifest-disabled');
  return {
    status: reasons.length ? 'stale' : 'current',
    reasons,
    ownedFiles,
  };
}

/** Format one deterministic user-facing explanation for a stale manifest. */
export function formatManifestStaleness(reasons: readonly ZopiaManifestStalenessReason[]): string {
  const labels: Record<ZopiaManifestStalenessReason, string> = {
    'invalid-manifest': 'the existing manifest is invalid or unreadable',
    'source-changed': 'the source document changed',
    'mode-changed': 'the layout mode changed',
    'component-options-changed': 'component generation options changed',
    'generated-files-missing': 'manifest-owned generated files are missing or unsafe',
    'manifest-disabled': 'manifest output was disabled',
  };
  const details = reasons.map((reason) => labels[reason]).join('; ');
  const cleanup = reasons.includes('invalid-manifest')
    ? 'generation will replace or remove the manifest, but unknown obsolete files cannot be removed safely'
    : 'manifest-owned obsolete files will be removed after generation';
  return `the existing generated tree is stale: ${details}; ${cleanup}`;
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

async function removeOwnedFile(root: string, rootReal: string, file: string): Promise<boolean> {
  const candidate = resolve(root, ...file.split('/'));
  if (!isInside(root, candidate) || candidate === root) return false;
  const parent = dirname(candidate);
  let parentReal: string;
  try { parentReal = await realpath(parent); }
  catch (error) { if (isMissing(error)) return false; throw error; }
  if (!isInside(rootReal, parentReal) && parentReal !== rootReal) return false;

  let metadata;
  try { metadata = await lstat(candidate); }
  catch (error) { if (isMissing(error)) return false; throw error; }
  if (metadata.isDirectory()) return false;
  await rm(candidate, { force: true });

  let directory = parent;
  while (directory !== root && isInside(root, directory)) {
    let directoryMetadata;
    try { directoryMetadata = await lstat(directory); }
    catch (error) { if (isMissing(error)) break; throw error; }
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) break;
    try { await rmdir(directory); }
    catch (error) { if (isMissing(error) || isNotEmpty(error)) break; throw error; }
    directory = dirname(directory);
  }
  return true;
}

/** Remove only obsolete files claimed by a previously validated manifest. */
export async function removeObsoleteManifestFiles(outputDir: string, previousOwnedFiles: readonly string[], nextOwnedFiles: Iterable<string>): Promise<string[]> {
  if (previousOwnedFiles.length === 0) return [];
  const root = resolve(outputDir);
  let rootReal: string;
  try { rootReal = await realpath(root); }
  catch (error) { if (isMissing(error)) return []; throw error; }
  const retained = new Set(nextOwnedFiles);
  const removed: string[] = [];
  for (const file of [...new Set(previousOwnedFiles)].sort(compareText)) {
    if (retained.has(file)) continue;
    if (await removeOwnedFile(root, rootReal, file)) removed.push(file);
  }
  return removed;
}
