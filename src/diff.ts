import { ZopiaError } from './errors';
import { collectOpenApiOperations, collectOpenApiWebhookOperations, type OpenApiOperation } from './conversions/openapi-to-api-docs';
import { normalizeOpenApiDocument, type OpenApiDocument, type OpenApiVersion } from './conversions/openapi';
import { readOpenApiSourceInput } from './conversions/openapi-to-api-docs-public';

/** Category of one reported change. */
export type ZopiaDiffKind = 'added' | 'removed' | 'changed';

/** Area of the documents a change belongs to. */
export type ZopiaDiffArea = 'dialect' | 'info' | 'endpoint' | 'webhook' | 'component' | 'document';

/** One structured, human-readable change between two spec inputs. */
export interface ZopiaDiffEntry {
  /** Whether this change adds, removes, or alters something present in the `after` input. */
  kind: ZopiaDiffKind;
  /** Document area the change belongs to, used for grouped, deterministic ordering. */
  area: ZopiaDiffArea;
  /** JSON Pointer of the changed node — into the `after` input for additions/changes, into the `before` input for removals. */
  at: string;
  /** Human-readable description without the kind glyph or indentation. */
  message: string;
  /** Nesting depth: `0` top-level lines, `1` details under a changed endpoint/webhook header. */
  depth: 0 | 1;
}

/** Grouped change counts of one diff run. */
export interface ZopiaDiffCounts {
  /** Entries with kind `added`. */
  added: number;
  /** Entries with kind `removed`. */
  removed: number;
  /** Entries with kind `changed`. */
  changed: number;
}

/** Result of comparing two Swagger/OpenAPI documents. */
export interface ZopiaDiffResult {
  /** `true` when both inputs are semantically identical (key order ignored). */
  identical: boolean;
  /** Every detected change, deterministically ordered: dialect, info, endpoints, webhooks, components, document. */
  changes: ZopiaDiffEntry[];
  /** Per-kind entry counts. */
  counts: ZopiaDiffCounts;
}

const escapePointer = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

/** Canonical key-order-insensitive serialization for value comparison (arrays stay order-sensitive). */
function canonical(value: unknown, at: string, stack: Set<object> = new Set()): string {
  if (value === undefined) return '∅';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '∅';
  if (stack.has(value as object)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'circular in-memory OpenAPI value', { at, hint: 'use JSON references instead of JavaScript object cycles' });
  stack.add(value as object);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item, at, stack)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(object[key], at, stack)}`).join(',')}}`;
  } finally {
    stack.delete(value as object);
  }
}

/** Short inline rendering for scalar values; other values diffuse to a bare `changed` line. */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length <= 40) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  return undefined;
}

/** `"a" -> "b"` for renderable scalar pairs, otherwise a bare `changed`. */
function transition(left: unknown, right: unknown): string {
  const from = scalar(left); const to = scalar(right);
  return from !== undefined && to !== undefined ? `${from} -> ${to}` : 'changed';
}

/** Collect parameters of one operation, keyed by the `name`/`in` identity pair. */
function parameterMap(operation: OpenApiOperation): Map<string, { name: string; where: string; value: unknown }> {
  const map = new Map<string, { name: string; where: string; value: unknown }>();
  for (const parameter of operation.parameters) {
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) continue;
    const name = typeof parameter.name === 'string' ? parameter.name : undefined;
    const where = typeof parameter.in === 'string' ? parameter.in : undefined;
    if (name === undefined || where === undefined) continue;
    map.set(`${JSON.stringify(where)}/${JSON.stringify(name)}`, { name, where, value: parameter });
  }
  return map;
}

/** Sorted union key collection for deterministic difference emission. */
function unionKeys(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): string[] {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  return [...keys].sort();
}

/** Response status keys in plan order: numeric statuses ascending, then `default` and extensions. */
const responseStatusOrder = (keys: string[]): string[] => {
  const numeric = keys.filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
  const other = keys.filter((key) => !/^\d+$/.test(key)).sort();
  return [...numeric, ...other];
};

interface OperationPair { key: string; older?: OpenApiOperation; newer?: OpenApiOperation; }

/** Human label of one operation: `GET /pets (listPets)`. */
function operationLabel(operation: OpenApiOperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}${operation.operationId ? ` (${operation.operationId})` : ''}`;
}

/** All per-section differences of one operation kept by both inputs. */
function diffSharedOperation(entry: (e: Omit<ZopiaDiffEntry, 'depth'>) => void, detail: (e: Omit<ZopiaDiffEntry, 'depth'>) => void, area: ZopiaDiffArea, at: string, older: OpenApiOperation, newer: OpenApiOperation, label: string): void {
  const details: Array<{ kind: ZopiaDiffKind; at: string; message: string }> = [];
  for (const field of ['summary', 'description', 'operationId', 'deprecated'] as const) {
    const before = older.operation[field]; const after = newer.operation[field];
    if (before === undefined && after === undefined || canonical(before, `${at}/${field}`) === canonical(after, `${at}/${field}`)) continue;
    if (before === undefined) details.push({ kind: 'added', at: `${at}/${field}`, message: `${field}: ${scalar(after) ?? 'added'}` });
    else if (after === undefined) details.push({ kind: 'removed', at: `${at}/${field}`, message: `${field}: ${scalar(before) ?? 'removed'}` });
    else details.push({ kind: 'changed', at: `${at}/${field}`, message: `${field}: ${transition(before, after)}` });
  }
  if (canonical(older.operation.tags, `${at}/tags`) !== canonical(newer.operation.tags, `${at}/tags`)) {
    details.push({ kind: 'changed', at: `${at}/tags`, message: `tags: ${transition(older.operation.tags, newer.operation.tags)}` });
  }
  const olderParameters = parameterMap(older); const newerParameters = parameterMap(newer);
  for (const key of [...new Set([...olderParameters.keys(), ...newerParameters.keys()])].sort()) {
    const before = olderParameters.get(key); const after = newerParameters.get(key);
    const parameterAt = `${at}/parameters|${key}`;
    if (before && !after) details.push({ kind: 'removed', at: parameterAt, message: `parameter ${before.name} (${before.where}) removed` });
    else if (!before && after) details.push({ kind: 'added', at: parameterAt, message: `parameter ${after.name} (${after.where}) added` });
    else if (before && after && canonical(before.value, parameterAt) !== canonical(after.value, parameterAt)) details.push({ kind: 'changed', at: parameterAt, message: `parameter ${before.name} (${before.where}) changed` });
  }
  const olderBody = older.operation.requestBody; const newerBody = newer.operation.requestBody;
  if (olderBody !== undefined || newerBody !== undefined) {
    if (olderBody === undefined) details.push({ kind: 'added', at: `${at}/requestBody`, message: 'request body added' });
    else if (newerBody === undefined) details.push({ kind: 'removed', at: `${at}/requestBody`, message: 'request body removed' });
    else if (canonical(olderBody, `${at}/requestBody`) !== canonical(newerBody, `${at}/requestBody`)) details.push({ kind: 'changed', at: `${at}/requestBody`, message: 'request body changed' });
  }
  const olderResponses = (older.operation.responses ?? {}) as Record<string, unknown>; const newerResponses = (newer.operation.responses ?? {}) as Record<string, unknown>;
  for (const status of responseStatusOrder(unionKeys(olderResponses, newerResponses))) {
    const statusAt = `${at}/responses/${escapePointer(status)}`;
    if (!(status in olderResponses)) details.push({ kind: 'added', at: statusAt, message: `response ${status} added` });
    else if (!(status in newerResponses)) details.push({ kind: 'removed', at: statusAt, message: `response ${status} removed` });
    else if (canonical(olderResponses[status], statusAt) !== canonical(newerResponses[status], statusAt)) details.push({ kind: 'changed', at: statusAt, message: `response ${status} changed` });
  }
  if (canonical(older.operation.security, `${at}/security`) !== canonical(newer.operation.security, `${at}/security`)) details.push({ kind: 'changed', at: `${at}/security`, message: 'security changed' });
  const extensions = [...new Set([...Object.keys(older.operation), ...Object.keys(newer.operation)])].filter((key) => key.startsWith('x-')).sort();
  for (const key of extensions) {
    const extensionAt = `${at}/${escapePointer(key)}`;
    if (older.operation[key] === undefined && newer.operation[key] === undefined) continue;
    if (older.operation[key] === undefined) details.push({ kind: 'added', at: extensionAt, message: `${key}: ${scalar(newer.operation[key]) ?? 'added'}` });
    else if (newer.operation[key] === undefined) details.push({ kind: 'removed', at: extensionAt, message: `${key}: ${scalar(older.operation[key]) ?? 'removed'}` });
    else if (canonical(older.operation[key], extensionAt) !== canonical(newer.operation[key], extensionAt)) details.push({ kind: 'changed', at: extensionAt, message: `${key}: ${transition(older.operation[key], newer.operation[key])}` });
  }
  if (details.length === 0 && canonical(older.operation, at) !== canonical(newer.operation, at)) details.push({ kind: 'changed', at, message: 'operation content changed' });
  if (details.length === 0) return;
  entry({ kind: 'changed', area, at, message: label });
  for (const item of details) detail({ kind: item.kind, area, at: item.at, message: item.message });
}

/** Match the operations of both inputs by display identity and emit the endpoint/webhook sections. */
function diffOperationSections(collect: (e: { kind: ZopiaDiffKind; area: ZopiaDiffArea; at: string; message: string; depth: 0 | 1 }) => void, area: ZopiaDiffArea, section: 'paths' | 'webhooks', olderOperations: readonly OpenApiOperation[], newerOperations: readonly OpenApiOperation[]): void {
  const olderByKey = new Map<string, OpenApiOperation>(olderOperations.map((operation) => [`${operation.method.toUpperCase()} ${operation.path}`, operation]));
  const newerByKey = new Map<string, OpenApiOperation>(newerOperations.map((operation) => [`${operation.method.toUpperCase()} ${operation.path}`, operation]));
  const operationOrder = (left: string, right: string): number => {
    const [leftMethod, ...leftPath] = left.split(' '); const [rightMethod, ...rightPath] = right.split(' ');
    const leftPathText = leftPath.join(' '); const rightPathText = rightPath.join(' ');
    return leftPathText < rightPathText ? -1 : leftPathText > rightPathText ? 1 : leftMethod < rightMethod ? -1 : leftMethod > rightMethod ? 1 : 0;
  };
  for (const key of [...new Set([...olderByKey.keys(), ...newerByKey.keys()])].sort(operationOrder)) {
    const older = olderByKey.get(key); const newer = newerByKey.get(key);
    const method = key.split(' ')[0].toLowerCase(); const path = key.slice(method.length + 1);
    const at = `#/${section}/${escapePointer(path)}/${method}`;
    const singular = area === 'webhook' ? 'webhook' : 'endpoint';
    if (older && !newer) collect({ kind: 'removed', area, at, message: `${singular} ${operationLabel(older)}`, depth: 0 });
    else if (!older && newer) collect({ kind: 'added', area, at, message: `${singular} ${operationLabel(newer)}`, depth: 0 });
    else if (older && newer) diffSharedOperation(
      (e) => collect({ ...e, depth: 0 }),
      (e) => collect({ ...e, depth: 1 }),
      area, at, older, newer, `${singular} ${operationLabel(newer)}`,
    );
  }
}

/** Schema component maps, dialect-aligned (Swagger 2.0 {#/definitions}, OpenAPI 3.x {#/components/schemas}). */
function schemaContainer(document: OpenApiDocument, version: OpenApiVersion): { map: Record<string, unknown>; at: string } {
  if (version === '2.0') return { map: (document.definitions ?? {}) as Record<string, unknown>, at: '#/definitions' };
  return { map: (document.components?.schemas ?? {}) as Record<string, unknown>, at: '#/components/schemas' };
}

/** Document-level fields compared as whole values, in dialect order. */
const documentFields = ['servers', 'host', 'basePath', 'schemes', 'consumes', 'produces', 'security', 'tags', 'externalDocs', 'jsonSchemaDialect'] as const;

/**
 * Compare two normalized-or-raw documents byte-deeply: endpoints, webhooks, schema components, `info`, and document fields.
 *
 * @param before Older Swagger 2.0 or OpenAPI 3.0/3.1 document object.
 * @param after Newer Swagger 2.0 or OpenAPI 3.0/3.1 document object.
 * @returns Deterministically ordered structured changes; empty when semantically identical (key order ignored).
 * @throws {@link ZopiaError} `ZOPIA_SPEC_*`/`ZOPIA_SPEC_PATH_REF` when either document envelope, path item, or webhook item is invalid.
 */
export function diffOpenApiDocuments(before: OpenApiDocument, after: OpenApiDocument): ZopiaDiffResult {
  const older = normalizeOpenApiDocument(before);
  const newer = normalizeOpenApiDocument(after);
  const changes: ZopiaDiffEntry[] = [];
  const collect = (e: ZopiaDiffEntry): void => { changes.push(e); };

  const olderVersion = older.version === '2.0' ? `swagger ${older.document.swagger}` : `openapi ${older.document.openapi}`;
  const newerVersion = newer.version === '2.0' ? `swagger ${newer.document.swagger}` : `openapi ${newer.document.openapi}`;
  if (olderVersion !== newerVersion) collect({ kind: 'changed', area: 'dialect', at: '#', message: `dialect: ${olderVersion} -> ${newerVersion}`, depth: 0 });

  const olderInfo = (older.document.info ?? {}) as Record<string, unknown>; const newerInfo = (newer.document.info ?? {}) as Record<string, unknown>;
  for (const field of unionKeys(olderInfo, newerInfo)) {
    const at = `#/info/${escapePointer(field)}`;
    if (!(field in olderInfo)) collect({ kind: 'added', area: 'info', at, message: `info.${field}: ${scalar(newerInfo[field]) ?? 'added'}`, depth: 0 });
    else if (!(field in newerInfo)) collect({ kind: 'removed', area: 'info', at, message: `info.${field}: ${scalar(olderInfo[field]) ?? 'removed'}`, depth: 0 });
    else if (canonical(olderInfo[field], at) !== canonical(newerInfo[field], at)) collect({ kind: 'changed', area: 'info', at, message: `info.${field}: ${transition(olderInfo[field], newerInfo[field])}`, depth: 0 });
  }

  diffOperationSections(collect, 'endpoint', 'paths', collectOpenApiOperations(older.document), collectOpenApiOperations(newer.document));
  diffOperationSections(collect, 'webhook', 'webhooks', collectOpenApiWebhookOperations(older.document), collectOpenApiWebhookOperations(newer.document));

  const olderSchemas = schemaContainer(older.document, older.version); const newerSchemas = schemaContainer(newer.document, newer.version);
  for (const name of unionKeys(olderSchemas.map, newerSchemas.map)) {
    const at = `${newerSchemas.map[name] !== undefined || olderSchemas.map[name] === undefined ? newerSchemas.at : olderSchemas.at}/${escapePointer(name)}`;
    if (!(name in olderSchemas.map)) collect({ kind: 'added', area: 'component', at, message: `component ${name}`, depth: 0 });
    else if (!(name in newerSchemas.map)) collect({ kind: 'removed', area: 'component', at, message: `component ${name}`, depth: 0 });
    else if (canonical(olderSchemas.map[name], at) !== canonical(newerSchemas.map[name], at)) collect({ kind: 'changed', area: 'component', at, message: `component ${name}: schema changed`, depth: 0 });
  }

  const rootKeys = new Set([...Object.keys(older.document), ...Object.keys(newer.document)]);
  const extensions = [...rootKeys].filter((key) => key.startsWith('x-')).sort();
  for (const field of [...documentFields, ...extensions]) {
    const before = older.document[field]; const after = newer.document[field];
    if (before === undefined && after === undefined) continue;
    const at = `#/${escapePointer(field)}`;
    if (before === undefined) collect({ kind: 'added', area: 'document', at, message: `${field}: ${scalar(after) ?? 'added'}`, depth: 0 });
    else if (after === undefined) collect({ kind: 'removed', area: 'document', at, message: `${field}: ${scalar(before) ?? 'removed'}`, depth: 0 });
    else if (canonical(before, at) !== canonical(after, at)) collect({ kind: 'changed', area: 'document', at, message: `${field}: ${transition(before, after)}`, depth: 0 });
  }

  const counts = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) counts[change.kind] += 1;
  return { identical: changes.length === 0, changes, counts };
}

/**
 * Compare two Swagger/OpenAPI spec inputs — file paths (JSON/YAML), inline text, or in-memory objects — each loaded with the same rules as {@link openApiToApiDocs}.
 *
 * @param before Older spec input (file path, inline JSON/YAML text, or document object).
 * @param after Newer spec input (file path, inline JSON/YAML text, or document object).
 * @returns Deterministically ordered structured changes; empty when semantically identical (key order ignored).
 * @throws {@link ZopiaError} `ZOPIA_SPEC_INVALID*` when an input cannot be read or parsed, and `ZOPIA_SPEC_*` for invalid documents.
 */
export async function diffOpenApiSpecs(before: string | OpenApiDocument, after: string | OpenApiDocument): Promise<ZopiaDiffResult> {
  const older = await readOpenApiSourceInput(before);
  const newer = await readOpenApiSourceInput(after);
  return diffOpenApiDocuments(older.document, newer.document);
}
