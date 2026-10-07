import { existsSync, readFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { asZopiaError, ZopiaError, type ZopiaErrorCode } from './errors';
import type { ZopiaWarningCode } from './warnings';
import { normalizeOpenApiDocument, type OpenApiDocument } from './conversions/openapi';
import { bundleExternalOpenApiRefs } from './conversions/openapi-external-ref';
import { readOpenApiSourceInput, validateOpenApiReferences } from './conversions/openapi-to-api-docs-public';
import { collectOpenApiOperations, collectOpenApiWebhookOperations } from './conversions/openapi-to-api-docs';
import { assertUniqueOperationIdsAcrossScopes, planApiDocsFiles, planWebhookDocsFiles } from './conversions/api-docs-plan';
import { apiDocsToOpenApi } from './conversions/manifest-to-openapi';
import { validateZopiaManifest, ZOPIA_MANIFEST_FILE, type ZopiaManifest } from './conversions/manifest-writer';

/** Stable lint codes emitted only by the validator ({@link validateZopia}). */
export const ZOPIA_VALIDATION_CODES = Object.freeze([
  'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT',
  'ZOPIA_VALIDATE_KM_API_DRIFT',
] as const);

/** Stable, machine-readable validator lint code. */
export type ZopiaValidationCode = typeof ZOPIA_VALIDATION_CODES[number];

/** One deterministic validator finding, either a hard failure or a lint observation. */
export interface ZopiaValidationIssue {
  /** Whether the finding blocks validity (`error`) or is advisory (`warning`). */
  severity: 'error' | 'warning';
  /** Stable code: a validator lint code, or the caught engine {@link ZopiaErrorCode} / warning code. */
  code: ZopiaValidationCode | ZopiaErrorCode | ZopiaWarningCode;
  /** JSON Pointer or file location associated with the finding, when known. */
  at?: string;
  /** Human-readable finding description. */
  message: string;
}

/** Deterministic validator outcome for one target. */
export interface ZopiaValidationResult {
  /** Whether no error-severity issues were found. */
  ok: boolean;
  /** How the validator classified the target. */
  kind: 'spec' | 'docs';
  /** The input as the validator understood it (path, or a placeholder for inline text/objects). */
  target: string;
  /** Findings sorted by severity (errors first), pointer, code, and message. */
  diagnostics: ZopiaValidationIssue[];
}

/** Options for {@link validateZopia}. */
export interface ZopiaValidateOptions {
  /**
   * Force target classification instead of auto-detecting from the input.
   *
   * @default 'auto'
   */
  kind?: 'spec' | 'docs' | 'auto';
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function sortDiagnostics(issues: ZopiaValidationIssue[]): ZopiaValidationIssue[] {
  return [...issues].sort((left, right) => {
    const key = (issue: ZopiaValidationIssue): string => [issue.severity === 'error' ? '0' : '1', issue.at ?? '', issue.code, issue.message].join('\u0000');
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function issueError(error: unknown): ZopiaValidationIssue {
  const typed = error instanceof ZopiaError ? error : asZopiaError(error, 'ZOPIA_SPEC_INVALID', 'validation failure');
  return { severity: 'error', code: typed.code, ...(typed.at === undefined ? {} : { at: typed.at }), message: typed.message.slice(`${typed.code}: `.length) };
}

/** One `#/components/schemas/…`/`#/definitions/…` reference plus whether it can seed reachability. */
interface SchemaRefOccurrence {
  /** Referenced component name with `~`-escapes unescaped. */
  name: string;
  /** Whether the occurrence lives outside the schema map itself and may act as a reachability root. */
  root: boolean;
}

const decodePointerSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');

type SchemaRefWalkMode = 'root' | 'components-container' | 'normal' | 'schema-map';

const SCHEMA_REF_LITERAL_KEYS = new Set(['example', 'examples', 'default', 'enum', 'const']);
// Keywords whose object values are maps of *schema names* to schema values.
// Inside those maps a key such as `default` is a schema name, not a literal
// annotation. `definitions` is included as the legacy JSON Schema map keyword;
// the OpenAPI/Swagger component map itself is entered only from the document
// root below so an operation-side property literally named `schemas` or
// `definitions` is never mistaken for the component container.
const SCHEMA_REF_SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

function walkSchemaRefs(value: unknown, inSchemaMap: boolean, inLiteral: boolean, stack: Set<object>, out: SchemaRefOccurrence[], pattern: RegExp, schemaKey: string, mode: SchemaRefWalkMode = 'normal'): void {
  if (!value || typeof value !== 'object' || stack.has(value as object)) return;
  stack.add(value as object);
  try {
    if (Array.isArray(value)) {
      for (const child of value) walkSchemaRefs(child, inSchemaMap, inLiteral, stack, out, pattern, schemaKey, 'normal');
      return;
    }
    const object = value as Record<string, unknown>;
    // Track the path (not the whole graph) so a subtree shared between a literal
    // annotation and a schema position in an in-memory document still reports the
    // schema occurrence. Literal JSON Schema/OpenAPI value positions (`default`,
    // `example(s)`, `enum`, `const`) do not seed reachability; same-named schema
    // properties under `properties` still do.
    if (!inLiteral && typeof object.$ref === 'string') {
      const match = pattern.exec(object.$ref);
      if (match) out.push({ name: decodePointerSegment(match[1]), root: !inSchemaMap });
    }
    for (const [key, child] of Object.entries(object)) {
      let childMode: SchemaRefWalkMode = 'normal';
      let childInSchemaMap = inSchemaMap;
      if (mode === 'root') {
        // Only the document's own component container changes reachability
        // classification. A nested schema property that happens to be named
        // `schemas`/`definitions` remains an ordinary operation-side schema map.
        if (key === schemaKey) {
          childMode = 'schema-map';
          childInSchemaMap = true;
        } else if (key === 'components') {
          childMode = 'components-container';
        }
      } else if (mode === 'components-container' && key === schemaKey) {
        childMode = 'schema-map';
        childInSchemaMap = true;
      } else if (SCHEMA_REF_SCHEMA_MAP_KEYS.has(key)) {
        childMode = 'schema-map';
      }
      const childInLiteral = inLiteral || (mode !== 'schema-map' && SCHEMA_REF_LITERAL_KEYS.has(key));
      walkSchemaRefs(child, childInSchemaMap, childInLiteral, stack, out, pattern, schemaKey, childMode);
    }
  } finally {
    stack.delete(value as object);
  }
}

/**
 * List components never reachable from any operation-side `$ref` (transitively).
 * Examples do not seed reachability; schemas reachable only through other
 * unreachable schemas stay unreachable.
 */
function lintUnreachableComponents(document: OpenApiDocument, version: string): ZopiaValidationIssue[] {
  const isSwagger = version === '2.0';
  const mapPointer = isSwagger ? '/definitions' : '/components/schemas';
  const schemas = isSwagger
    ? document.definitions
    : isRecord(document.components) ? document.components.schemas : undefined;
  if (!isRecord(schemas)) return [];
  const pattern = isSwagger ? /^#\/definitions\/([^/]+)$/ : /^#\/components\/schemas\/([^/]+)$/;
  const schemaKey = isSwagger ? 'definitions' : 'schemas';
  const occurrences: SchemaRefOccurrence[] = [];
  walkSchemaRefs(document, false, false, new Set(), occurrences, pattern, schemaKey, 'root');
  const reached = new Set<string>();
  const queue = occurrences.filter((occurrence) => occurrence.root).map((occurrence) => occurrence.name);
  while (queue.length) {
    const name = queue.pop()!;
    if (reached.has(name)) continue;
    reached.add(name);
    const schema = schemas[name];
    if (schema === undefined) continue;
    const nested: SchemaRefOccurrence[] = [];
    walkSchemaRefs(schema, true, false, new Set(), nested, pattern, schemaKey);
    for (const occurrence of nested) queue.push(occurrence.name);
  }
  return Object.keys(schemas)
    .filter((name) => !reached.has(name) && name !== '')
    .map((name) => ({
      severity: 'warning' as const,
      code: 'ZOPIA_VALIDATE_UNREACHABLE_COMPONENT' as const,
      at: `#${mapPointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      message: `component is never referenced: ${name}`,
    }));
}

const KMAPI_DRIFT = 'ZOPIA_VALIDATE_KM_API_DRIFT' as const;

/** Mirror the source reader's text/path distinction without re-parsing the document. */
function looksLikeInlineSpecText(input: string): boolean {
  const trimmed = input.trimStart();
  return trimmed.startsWith('{')
    || trimmed.startsWith('[')
    || input.includes('\n')
    || /^---(?:\s|$)/.test(trimmed)
    || /^[^:#{}[\],&*!|>%@`][^:]*:(?:\s|$)/.test(trimmed);
}

/** Read the km-api peer range zopia was built with. */
function zopiaKmApiPeerRange(): string | undefined {
  try {
    const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const peer = (JSON.parse(text) as { peerDependencies?: Record<string, unknown> }).peerDependencies?.['km-api'];
    return typeof peer === 'string' ? peer : undefined;
  } catch { return undefined; }
}

/** Resolve the installed km-api version visible from the validated tree (no exports-map dependence). */
function installedKmApiVersion(treeRoot: string): string | undefined {
  let directory = resolve(treeRoot);
  for (;;) {
    try {
      const candidate = join(directory, 'node_modules', 'km-api', 'package.json');
      const version = (JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown }).version;
      if (typeof version === 'string') return version;
    } catch { /* keep walking upward */ }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Minimal caret-range check (`^x.y.z`), matching the form zopia declares. */
function satisfiesCaretRange(version: string, range: string): boolean {
  const base = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.replace(/^[^0-9]*/, ''));
  const wanted = /^\^0*(\d+)(?:\.0*(\d+))?(?:\.0*(\d+))?/.exec(range.trim());
  if (!base || !wanted) return true; // unparsable: never accuse drift on data we cannot read
  const [major, minor, patch] = [Number(base[1]), Number(base[2]), Number(base[3])];
  const [baseMajor, baseMinor, basePatch] = [Number(wanted[1]), Number(wanted[2] ?? 0), Number(wanted[3] ?? 0)];
  if (baseMajor > 0) return major === baseMajor && (minor > baseMinor || (minor === baseMinor && patch >= basePatch));
  return major === 0 && minor === baseMinor && patch >= basePatch;
}

function kmApiDriftDiagnostics(treeRoot: string): ZopiaValidationIssue[] {
  const range = zopiaKmApiPeerRange();
  if (range === undefined) return [];
  const version = installedKmApiVersion(treeRoot);
  if (version === undefined) {
    return [{ severity: 'warning', code: KMAPI_DRIFT, at: treeRoot, message: `km-api could not be resolved near the generated tree; generated modules require peer ${range}` }];
  }
  if (!satisfiesCaretRange(version, range)) {
    return [{ severity: 'warning', code: KMAPI_DRIFT, at: treeRoot, message: `installed km-api ${version} is outside the required peer range ${range}` }];
  }
  return [];
}

async function validateDocsTarget(path: string): Promise<ZopiaValidationResult> {
  const issues: ZopiaValidationIssue[] = [];
  const stats = existsSync(path) ? await lstat(path) : undefined;
  const manifestFile = stats?.isDirectory() === true ? join(path, ZOPIA_MANIFEST_FILE) : path;
  const treeRoot = stats?.isDirectory() === true ? path : dirname(path);
  let manifest: ZopiaManifest | undefined;
  if (!existsSync(manifestFile)) {
    issues.push({ severity: 'error', code: 'ZOPIA_DOCS_MISSING_MANIFEST', at: manifestFile, message: 'manifest file not found; generate api docs first or pass the manifest path' });
  } else {
    try {
      const parsed = JSON.parse(await readFile(manifestFile, 'utf8')) as ZopiaManifest;
      validateZopiaManifest(parsed);
      manifest = parsed;
    } catch (error) {
      issues.push(issueError(error));
    }
  }
  if (manifest !== undefined) {
    try {
      const reversed = await apiDocsToOpenApi(manifestFile);
      for (const warning of reversed.warnings) issues.push({ severity: 'warning', code: warning.code, ...(warning.at === undefined ? {} : { at: warning.at }), message: warning.message });
    } catch (error) {
      issues.push(issueError(error));
    }
    issues.push(...kmApiDriftDiagnostics(treeRoot));
  }
  const diagnostics = sortDiagnostics(issues);
  return { ok: !diagnostics.some((issue) => issue.severity === 'error'), kind: 'docs', target: path, diagnostics };
}

async function validateSpecTarget(input: string | Record<string, unknown>, target: string): Promise<ZopiaValidationResult> {
  const issues: ZopiaValidationIssue[] = [];
  let document: OpenApiDocument;
  try {
    let read = await readOpenApiSourceInput(input);
    const bundled = read.sourceFile ? await bundleExternalOpenApiRefs(read.document, read.sourceFile) : read.document;
    document = normalizeOpenApiDocument(bundled).document;
  } catch (error) {
    issues.push(issueError(error));
    const diagnostics = sortDiagnostics(issues);
    return { ok: false, kind: 'spec', target, diagnostics };
  }
  try { validateOpenApiReferences(document); }
  catch (error) {
    issues.push(issueError(error));
    const diagnostics = sortDiagnostics(issues);
    return { ok: false, kind: 'spec', target, diagnostics };
  }
  const collectorsOk = { paths: false, webhooks: false };
  try { collectOpenApiOperations(document); collectorsOk.paths = true; }
  catch (error) { issues.push(issueError(error)); }
  try { collectOpenApiWebhookOperations(document); collectorsOk.webhooks = true; }
  catch (error) { issues.push(issueError(error)); }
  if (collectorsOk.paths) {
    try {
      const plans = planApiDocsFiles(document);
      if (collectorsOk.webhooks) {
        try { assertUniqueOperationIdsAcrossScopes(plans, planWebhookDocsFiles(document)); }
        catch (error) { issues.push(issueError(error)); }
      }
    } catch (error) { issues.push(issueError(error)); }
  }
  if (collectorsOk.paths) issues.push(...lintUnreachableComponents(document, document.openapi ?? document.swagger ?? '3.1'));
  const diagnostics = sortDiagnostics(issues);
  return { ok: !diagnostics.some((issue) => issue.severity === 'error'), kind: 'spec', target, diagnostics };
}

/**
 * Lint or validate a Swagger/OpenAPI spec or a generated api-docs tree (Phase 3).
 *
 * Specs are checked for dialect validity, broken local references, endpoint
 * planning failures (name collisions, cross-namespace duplicate operationIds),
 * and components no operation can reach. Generated trees are checked for a
 * readable manifest, a successful reverse dry-run, and km-api peer drift.
 * Unlike the engines, validation never fails fast: every detectable problem is
 * reported as a deterministic diagnostic and the result only signals validity
 * through `ok`.
 *
 * @param input Spec object/text/path, generated docs directory, or manifest file path.
 * @param options Optional target classification override.
 * @returns Validation outcome with sorted diagnostics; `ok` ignores warning-severity findings.
 * @throws {@link ZopiaError} `ZOPIA_CONFIG_INVALID` when the input or options are unusable.
 * @example
 * ```ts
 * import { validateZopia } from 'zopia';
 *
 * const result = await validateZopia('openapi.yaml');
 * for (const issue of result.diagnostics) console.error(issue.code, issue.at, issue.message);
 * ```
 */
export async function validateZopia(input: string | Record<string, unknown>, options: ZopiaValidateOptions = {}): Promise<ZopiaValidationResult> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'validate options must be an object', { at: 'options' });
  const kind = options.kind ?? 'auto';
  if (kind !== 'spec' && kind !== 'docs' && kind !== 'auto') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `invalid validate kind: ${String(kind)}`, { at: 'kind', hint: "use 'spec', 'docs', or 'auto'" });
  const looksLikeManifestPath = typeof input === 'string' && input.replace(/\\/g, '/').split('/').pop()?.toLowerCase() === ZOPIA_MANIFEST_FILE;
  const resolvedKind = kind === 'auto'
    ? (typeof input === 'string' && ((existsSync(input) && (await lstat(input)).isDirectory()) || looksLikeManifestPath) ? 'docs' : 'spec' as const)
    : kind;
  if (resolvedKind === 'docs') {
    if (typeof input !== 'string' || input.trim() === '') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'docs validation requires a docs directory or manifest path', { at: 'input', hint: 'pass the generated api-docs directory or its .zopia-manifest.json' });
    return validateDocsTarget(input);
  }
  const target = typeof input === 'string' ? (looksLikeInlineSpecText(input) ? '(inline document)' : input) : '(in-memory document)';
  return validateSpecTarget(input, target);
}
