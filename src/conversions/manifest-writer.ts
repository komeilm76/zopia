import { deriveReusableParameterSchema, deriveReusableResponseSchema, reusableDeclarations } from './openapi-contracts';
import { asZopiaError, ZopiaError } from '../errors';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { jsonSchemaToZod, type JsonSchemaOverlay } from './json-schema-to-zod';
import type { ApiDocsMode } from './api-docs-layout';
import type { ApiDocsFilePlan } from './api-docs-plan';
import type { OpenApiDocument } from './openapi';
import { decodeJsonPointerSegment } from './openapi-ref';

/** Versioned schema identifier written into every zopia manifest. */
export const ZOPIA_MANIFEST_SCHEMA = 'zopia:manifest@1' as const;

/** Portable manifest filename used by generated api-docs trees. */
export const ZOPIA_MANIFEST_FILE = '.zopia-manifest.json' as const;

/** Package version recorded by the current manifest writer. */
export const ZOPIA_VERSION = '0.5.0' as const;

/** Supported source dialect labels stored in a manifest. */
export type ZopiaManifestSourceKind = 'swagger-2.0' | 'openapi-3.0' | 'openapi-3.1';

/** Source identity and human-readable document metadata. */
export interface ZopiaManifestSource {
  /** Source dialect. Writers emit a `ZopiaManifestSourceKind`; readers retain forward compatibility. */
  kind: ZopiaManifestSourceKind | (string & {});
  /** Exact source `openapi` value; absent for Swagger and legacy manifests. */
  openapiVersion?: string;
  /** Original API title. Optional only for legacy reader fallback compatibility. */
  title?: string;
  /** Original API version. Optional only for legacy reader fallback compatibility. */
  version?: string;
  /** Original API description, when present. */
  description?: string;
  /** Canonical SHA-256 digest of the complete source document. */
  sha256?: string;
}

/** Generation options needed to interpret the emitted tree. */
export interface ZopiaManifestGenerationOptions {
  /** Whether component modules were emitted. */
  insertComponents: boolean;
  /** Whether endpoint modules import emitted components. */
  useComponentAsReference: boolean;
  /** Whether endpoint custom companion modules were requested. @default false */
  custom?: boolean;
}

/** Original reference placement relative to one source operation. */
export interface ZopiaManifestRef {
  /** RFC 6901 pointer to the source `$ref` keyword. */
  at: string;
  /** Original local reference value. */
  ref: string;
  /** Referenced schema component name when the target is a schema component. */
  component?: string;
}

/** Schema or operation restoration retained outside generated Zod code. */
export type ZopiaManifestOverlay = JsonSchemaOverlay | {
  /** Operation field restored from the source snapshot. */
  key: 'callbacks' | 'servers' | 'externalDocs' | 'links';
  /** Complete original field value. */
  value: unknown;
};

/** Response facts that km-api cannot store directly. */
export interface ZopiaManifestResponseOverlay {
  /** Response status key. */
  status: string;
  /** Original response headers. */
  headers: unknown;
}

/** One declared source schema component. */
export interface ZopiaManifestComponent {
  /** Exact source component name. */
  name: string;
  /** Component kind: schema module, reusable parameter module, or reusable response module (D-18). Absent means `schema` (legacy manifests). */
  kind?: 'schema' | 'parameter' | 'response';
  /** Emitted module path, or `null` when components were not emitted. Optional only for legacy reader compatibility. */
  file?: string | null;
  /** Complete original component schema. */
  schema: unknown;
  /** Schema-local reverse restorations. Readers also accept legacy overlay shapes. */
  overlay?: unknown;
}

/** One generated endpoint and its reverse-conversion metadata. */
export interface ZopiaManifestApi {
  /** Generated endpoint module path. Optional only for legacy reader compatibility. */
  file?: string;
  /** Original OpenAPI path template. */
  path: string;
  /** Lowercase HTTP method. */
  method: string;
  /** Explicit or deterministically derived operation ID. */
  operationId?: string;
  /** Complete original operation object. */
  sourceOperation?: Record<string, unknown>;
  /** Whether the operation was inherited exclusively through a path-item `$ref`. */
  pathItemRef?: boolean;
  /** Source reference placements. Readers also accept legacy representations. */
  refs?: unknown;
  /** Schema and operation restorations. Readers also accept legacy representations. */
  overlay?: unknown;
  /** Response metadata without a km-api representation. Readers also accept legacy representations. */
  responseOverlay?: unknown;
  /** Explicit operation security requirements, including an empty list. */
  security?: unknown[];
}

/** One generated webhook endpoint and its reverse-conversion metadata (OpenAPI 3.1). */
export interface ZopiaManifestWebhookApi {
  /** Generated endpoint module path. Optional only for legacy reader compatibility. */
  file?: string;
  /** Original OpenAPI webhook name (not a URL path template). */
  name: string;
  /** Lowercase HTTP method. */
  method: string;
  /** Explicit or deterministically derived operation ID. */
  operationId?: string;
  /** Whether the operation was inherited exclusively through a webhook-item `$ref`. */
  webhookItemRef?: boolean;
  /** Complete original operation object. */
  sourceOperation?: Record<string, unknown>;
  /** Source reference placements. Readers also accept legacy representations. */
  refs?: unknown;
  /** Schema and operation restorations. Readers also accept legacy representations. */
  overlay?: unknown;
  /** Response metadata without a km-api representation. Readers also accept legacy representations. */
  responseOverlay?: unknown;
  /** Explicit operation security requirements, including an empty list. */
  security?: unknown[];
}

/** Versioned manifest consumed by reverse conversion. Optional fields preserve older manifests. */
export interface ZopiaManifest {
  /** Manifest schema identifier. */
  $schema?: string;
  /** Writer package version. */
  zopiaVersion?: string;
  /** Source document identity. */
  source: ZopiaManifestSource;
  /** Generated endpoint layout. */
  mode?: string;
  /** Generation options that affect emitted references. */
  options?: ZopiaManifestGenerationOptions;
  /** Source `paths` key order, including empty Path Items and extensions. */
  pathOrder?: string[];
  /** Whether the source explicitly declared `definitions` or `components.schemas`. */
  schemaComponentsPresent?: boolean;
  /** Non-canonical source `info` fields. */
  infoOverlay?: Record<string, unknown>;
  /** Document-level extensions and unsupported structures. */
  documentOverlay?: Record<string, unknown>;
  /** Path-item metadata and `paths` extensions not represented by endpoint modules. */
  pathsOverlay?: Record<string, unknown>;
  /** Non-schema OpenAPI component sections. */
  componentsOverlay?: Record<string, unknown>;
  /** Original server declarations. */
  servers?: unknown[];
  /** Swagger host. */
  swaggerHost?: string;
  /** Swagger schemes. */
  swaggerSchemes?: string[];
  /** Swagger request media types. */
  swaggerConsumes?: string[];
  /** Swagger response media types. */
  swaggerProduces?: string[];
  /** Internal marker set when the manifest was dialect-downgraded from OpenAPI 3.x to Swagger 2.0 during reverse conversion; never persisted. */
  dialectDowngraded?: true;
  /** Swagger reusable parameters. */
  swaggerParameters?: Record<string, unknown>;
  /** Swagger reusable responses. */
  swaggerResponses?: Record<string, unknown>;
  /** Original tag declarations. */
  tags?: unknown[];
  /** Original security scheme declarations. */
  securitySchemes?: Record<string, unknown>;
  /** Top-level security requirements. */
  defaultSecurity?: unknown[];
  /** Declared schema components. */
  components?: ZopiaManifestComponent[];
  /** Generated endpoint records. */
  apis: ZopiaManifestApi[];
  /** Generated webhook endpoint records (OpenAPI 3.1). Omitted when the source has no webhooks. */
  webhooks?: ZopiaManifestWebhookApi[];
  /** Exact source `webhooks` map key order. Present alongside `webhooks`. */
  webhookOrder?: string[];
  /** Webhook-item metadata retained outside endpoint code (`parameters`, `x-` keys, extension names). */
  webhooksOverlay?: Record<string, unknown>;
}

/** Current writer component shape (legacy manifests may omit writer-owned fields). */
export interface GeneratedZopiaManifestComponent extends ZopiaManifestComponent {
  /** Emitted component path, or `null` when component emission is disabled. */
  file: string | null;
  /** Canonical component schema restorations. */
  overlay: JsonSchemaOverlay[];
}

/** Current writer endpoint shape (legacy manifests may omit writer-owned fields). */
export interface GeneratedZopiaManifestApi extends ZopiaManifestApi {
  /** Portable generated endpoint path. */
  file: string;
  /** Explicit or deterministically derived operation identifier. */
  operationId: string;
  /** Complete original operation object. */
  sourceOperation: Record<string, unknown>;
  /** Canonical source reference placements. */
  refs: ZopiaManifestRef[];
  /** Canonical schema and operation restorations. */
  overlay: ZopiaManifestOverlay[];
  /** Canonical response metadata restorations. */
  responseOverlay: ZopiaManifestResponseOverlay[];
}

/** Current writer webhook endpoint shape (legacy manifests may omit writer-owned fields). */
export interface GeneratedZopiaManifestWebhookApi extends ZopiaManifestWebhookApi {
  /** Portable generated endpoint path. */
  file: string;
  /** Explicit or deterministically derived operation identifier. */
  operationId: string;
  /** Complete original operation object. */
  sourceOperation: Record<string, unknown>;
  /** Canonical source reference placements. */
  refs: ZopiaManifestRef[];
  /** Canonical schema and operation restorations. */
  overlay: ZopiaManifestOverlay[];
  /** Canonical response metadata restorations. */
  responseOverlay: ZopiaManifestResponseOverlay[];
}

/** Complete manifest shape emitted by the current dedicated writer. */
export interface GeneratedZopiaManifest extends ZopiaManifest {
  /** Current manifest schema identifier. */
  $schema: typeof ZOPIA_MANIFEST_SCHEMA;
  /** Current writer package version. */
  zopiaVersion: typeof ZOPIA_VERSION;
  /** Complete canonical source identity. */
  source: ZopiaManifestSource & {
    /** Supported canonical source dialect. */
    kind: ZopiaManifestSourceKind;
    /** Required original API title. */
    title: string;
    /** Required original API version. */
    version: string;
    /** Canonical SHA-256 digest of the complete source document. */
    sha256: string;
  };
  /** Generated endpoint layout. */
  mode: ApiDocsMode;
  /** Generation options that affect emitted modules. */
  options: ZopiaManifestGenerationOptions;
  /** Exact source `paths` key order. */
  pathOrder: string[];
  /** Whether the source explicitly declared its schema-component container. */
  schemaComponentsPresent: boolean;
  /** Canonical non-core `info` fields. */
  infoOverlay: Record<string, unknown>;
  /** Canonical document-level restorations. */
  documentOverlay: Record<string, unknown>;
  /** Canonical path-item restorations. */
  pathsOverlay: Record<string, unknown>;
  /** Original server declarations, when present. */
  servers?: unknown[];
  /** Original tag declarations, when present. */
  tags?: unknown[];
  /** Original security schemes, when present. */
  securitySchemes?: Record<string, unknown>;
  /** Canonical generated component records. */
  components: GeneratedZopiaManifestComponent[];
  /** Canonical generated endpoint records. */
  apis: GeneratedZopiaManifestApi[];
  /** Generated webhook endpoint records, present when the source declares webhooks. */
  webhooks?: GeneratedZopiaManifestWebhookApi[];
}

/** Options used by the pure manifest builder. */
export interface CreateZopiaManifestOptions {
  /** Endpoint layout mode. */
  mode: ApiDocsMode;
  /** Whether component files were emitted. */
  insertComponents: boolean;
  /** Whether endpoint modules import component files. */
  useComponentAsReference: boolean;
  /** Whether endpoint custom companion modules were requested. @default false */
  custom?: boolean;
}

const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

function stableJson(value: unknown, stack = new Set<object>()): string {
  if (Array.isArray(value)) {
    if (stack.has(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Cannot serialize a circular JSON value');
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Cannot serialize a non-JSON array');
    stack.add(value);
    const output = `[${value.map((item) => stableJson(item, stack)).join(',')}]`;
    stack.delete(value);
    return output;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length > 0) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Cannot serialize a non-JSON object');
    if (stack.has(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Cannot serialize a circular JSON value');
    stack.add(value);
    const object = value as Record<string, unknown>;
    const output = `{${Object.keys(object).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableJson(object[key], stack)}`).join(',')}}`;
    stack.delete(value);
    return output;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Cannot serialize a non-JSON number: ${String(value)}`);
  const output = JSON.stringify(value);
  if (output === undefined) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Cannot serialize a non-JSON value: ${String(value)}`);
  return output;
}

function canonicalValue(value: unknown, stack = new Set<object>()): unknown {
  if (Array.isArray(value)) {
    if (stack.has(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Cannot serialize a circular JSON value');
    stack.add(value);
    const output = value.map((item) => canonicalValue(item, stack));
    stack.delete(value);
    return output;
  }
  if (value && typeof value === 'object') {
    if (stack.has(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Cannot serialize a circular JSON value');
    stack.add(value);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) Object.defineProperty(output, key, { value: canonicalValue((value as Record<string, unknown>)[key], stack), enumerable: true, configurable: true, writable: true });
    stack.delete(value);
    return output;
  }
  if (JSON.stringify(value) === undefined) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Cannot serialize a non-JSON value: ${String(value)}`);
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(stableJson(value)) as T;
}

function sortDerivedRecords<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareText(stableJson(left), stableJson(right)));
}

function componentName(ref: string): string | undefined {
  const prefix = ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  if (!prefix) return undefined;
  const encoded = ref.slice(prefix.length);
  if (encoded.includes('/')) return undefined;
  try { return decodeJsonPointerSegment(encoded, ref); }
  catch { return undefined; }
}

const STRUCTURAL_MAP_KEYS = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions', 'responses', 'content', 'headers', 'links', 'encoding', 'callbacks']);

function collectRefs(value: unknown, at = '', mapEntries = false): ZopiaManifestRef[] {
  const refs: ZopiaManifestRef[] = [];
  if (Array.isArray(value)) value.forEach((child, index) => refs.push(...collectRefs(child, `${at}/${index}`)));
  else if (isRecord(value)) {
    const literals = new Set(['example', 'examples', 'default', 'enum', 'const']);
    for (const [key, child] of Object.entries(value)) {
      const location = `${at}/${pointerToken(key)}`;
      if (mapEntries) refs.push(...collectRefs(child, location));
      else if (literals.has(key) || key.startsWith('x-')) continue;
      else if (key === '$ref' && typeof child === 'string') {
        const component = componentName(child);
        refs.push({ at: location, ref: child, ...(component === undefined ? {} : { component }) });
      } else refs.push(...collectRefs(child, location, STRUCTURAL_MAP_KEYS.has(key)));
    }
  }
  return refs;
}

function manifestSchemaOverlays(schema: unknown): JsonSchemaOverlay[] {
  return jsonSchemaToZod(schema as any).overlays.filter((overlay) => !(Object.prototype.hasOwnProperty.call(overlay, 'node') && typeof overlay.node === 'boolean'));
}

function prefixedSchemaOverlays(schema: unknown, at: string): JsonSchemaOverlay[] {
  if (schema === undefined || schema === null) return [];
  return manifestSchemaOverlays(schema).map((overlay) => ({ ...overlay, at: `${at}${overlay.at}` }));
}

const SWAGGER_SCHEMA_KEYS = new Set(['type', 'format', 'items', 'collectionFormat', 'default', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'enum', 'multipleOf']);

function collectOperationSchemaOverlays(value: unknown, swagger: boolean, at = ''): JsonSchemaOverlay[] {
  if (Array.isArray(value)) return value.flatMap((child, index) => collectOperationSchemaOverlays(child, swagger, `${at}/${index}`));
  if (!isRecord(value)) return [];
  const overlays: JsonSchemaOverlay[] = [];
  if (swagger && typeof value.in === 'string' && typeof value.name === 'string' && value.in !== 'body' && [...SWAGGER_SCHEMA_KEYS].some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    overlays.push(...prefixedSchemaOverlays(Object.fromEntries(Object.entries(value).filter(([key]) => SWAGGER_SCHEMA_KEYS.has(key))), at));
  }
  const literalContainers = new Set(['example', 'examples', 'default', 'enum', 'const', 'x-example']);
  for (const [key, child] of Object.entries(value)) {
    if (literalContainers.has(key) || key.startsWith('x-')) continue;
    const childAt = `${at}/${pointerToken(key)}`;
    if (key === 'schema' && (typeof child === 'boolean' || isRecord(child))) overlays.push(...prefixedSchemaOverlays(child, childAt));
    else overlays.push(...collectOperationSchemaOverlays(child, swagger, childAt));
  }
  return overlays;
}

function isPortableManifestPath(file: string): boolean {
  if (!file || isAbsolute(file) || file.includes('\\') || /^[A-Za-z]:/.test(file)) return false;
  return file.split('/').every((segment) => {
    if (segment === '' || segment === '.' || segment === '..' || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment)) return false;
    const basename = segment.split('.')[0];
    return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(basename);
  });
}

function validatePointer(value: string, context: string): void {
  if (value !== '' && !value.startsWith('/')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid ${context} pointer: ${value}`);
  if (/~(?![01])/.test(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid ${context} pointer escape: ${value}`);
}

function validateKeys(value: object, allowed: readonly string[], context: string): void {
  const invalid = Object.keys(value).find((key) => !allowed.includes(key));
  if (invalid !== undefined) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${context} key: ${invalid}`);
}

/**
 * Compute the canonical SHA-256 identity used for manifest staleness checks.
 *
 * @param document JSON-compatible Swagger/OpenAPI source document.
 * @returns Lowercase hexadecimal SHA-256 digest of the canonical document.
 * @throws {@link ZopiaError} when the document contains non-JSON or circular values.
 */
export function hashOpenApiDocument(document: OpenApiDocument): string {
  try {
    return createHash('sha256').update(stableJson(document)).digest('hex');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('circular JSON value')) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'cannot hash a circular OpenAPI document', { at: '#', hint: 'use JSON references instead of object cycles', cause: error });
    if (message.includes('non-JSON')) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'cannot hash an unsupported OpenAPI value', { at: '#', hint: 'replace functions, symbols, and non-finite numbers with JSON values', cause: error });
    throw asZopiaError(error, 'ZOPIA_SPEC_INVALID', 'unable to hash OpenAPI document', { at: '#', hint: 'provide a JSON-compatible document' });
  }
}

/**
 * Build a detached, deterministic manifest snapshot without touching the filesystem.
 *
 * @param source Normalized Swagger/OpenAPI source document.
 * @param plans Planned endpoint files represented by the source document.
 * @param options Layout and component-generation settings to record.
 * @param webhookPlans Planned webhook endpoint files represented by the source `webhooks` map.
 * @returns Validated canonical current-writer manifest.
 * @throws {@link ZopiaError} when the source, plans, or options are invalid.
 */
export function createZopiaManifest(source: OpenApiDocument, plans: readonly ApiDocsFilePlan[], options: CreateZopiaManifestOptions, webhookPlans: readonly ApiDocsFilePlan[] = []): GeneratedZopiaManifest {
  if (!isRecord(source) || !isRecord(source.info) || !isRecord(source.paths)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid manifest source document', { at: '#', hint: 'provide a normalized Swagger/OpenAPI document' });
  if (!isRecord(options) || !['directory', 'flat'].includes(options.mode) || typeof options.insertComponents !== 'boolean' || typeof options.useComponentAsReference !== 'boolean' || (options.custom !== undefined && typeof options.custom !== 'boolean')) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'Invalid manifest generation options', { at: 'options' });
  if (options.useComponentAsReference && !options.insertComponents) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'useComponentAsReference requires insertComponents', { at: 'useComponentAsReference', hint: 'enable `insertComponents` first' });
  const sourceHash = hashOpenApiDocument(source);
  const swagger = source.swagger === '2.0';
  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(source, key);
  const schemas = swagger ? source.definitions ?? {} : source.components?.schemas ?? {};
  if (!isRecord(schemas)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid source schema components', { at: swagger ? '#/definitions' : '#/components/schemas' });
  const sortedPlans = [...plans].sort((left, right) => compareText(left.file, right.file));
  const components: GeneratedZopiaManifestComponent[] = Object.entries(schemas).sort(([left], [right]) => compareText(left, right)).map(([name, schema]) => ({
    name,
    file: options.insertComponents ? `components/${name}/index.ts` : null,
    schema: cloneJson(schema),
    overlay: cloneJson(sortDerivedRecords(manifestSchemaOverlays(schema))),
  }));
  if (options.insertComponents) {
    const declared = reusableDeclarations(source);
    for (const [kind, map, derive] of [['parameter', declared.parameter, deriveReusableParameterSchema], ['response', declared.response, deriveReusableResponseSchema]] as const) {
      components.push(...Object.entries(map).sort(([left], [right]) => compareText(left, right)).flatMap(([name, declaration]) => {
        const schema = derive(source, name, declaration);
        // Schema-less responses render `z.void()` at use sites and carry no reusable schema (D-18).
        if (kind === 'response' && schema === undefined) return [];
        return [{ name, kind, file: `components/${kind}s/${name}/index.ts`, schema: cloneJson(schema), overlay: cloneJson(sortDerivedRecords(manifestSchemaOverlays(schema))) }];
      }));
    }
  }
  const apis: GeneratedZopiaManifestApi[] = sortedPlans.map((plan) => ({
    file: plan.file,
    path: plan.path,
    method: plan.method,
    operationId: plan.operationId,
    sourceOperation: cloneJson(plan.operation),
    ...(isRecord(source.paths?.[plan.path]) && typeof source.paths[plan.path].$ref === 'string' && !Object.prototype.hasOwnProperty.call(source.paths[plan.path], plan.method) ? { pathItemRef: true } : {}),
    refs: sortDerivedRecords(collectRefs(plan.operation)),
    overlay: cloneJson(sortDerivedRecords([
      ...collectOperationSchemaOverlays(plan.operation, swagger),
      ...(['callbacks', 'servers', 'externalDocs', 'links'] as const).filter((key) => Object.prototype.hasOwnProperty.call(plan.operation, key)).map((key) => ({ key, value: plan.operation[key] })),
    ])),
    responseOverlay: cloneJson(sortDerivedRecords(Object.entries(plan.operation.responses ?? {}).flatMap(([status, response]) => isRecord(response) && response.headers !== undefined ? [{ status, headers: response.headers }] : []))),
    ...(Object.prototype.hasOwnProperty.call(plan.operation, 'security') ? { security: cloneJson(plan.operation.security) as unknown[] } : {}),
  }));
  const webhookNames = isRecord(source.webhooks) ? Object.keys(source.webhooks) : [];
  const webhooks: GeneratedZopiaManifestWebhookApi[] = [...webhookPlans].sort((left, right) => compareText(left.file, right.file)).map((plan) => ({
    file: plan.file,
    name: plan.path,
    method: plan.method,
    operationId: plan.operationId,
    sourceOperation: cloneJson(plan.operation),
    ...(isRecord(source.webhooks?.[plan.path]) && typeof source.webhooks[plan.path].$ref === 'string' && !Object.prototype.hasOwnProperty.call(source.webhooks[plan.path], plan.method) ? { webhookItemRef: true } : {}),
    refs: sortDerivedRecords(collectRefs(plan.operation)),
    overlay: cloneJson(sortDerivedRecords([
      ...collectOperationSchemaOverlays(plan.operation, swagger),
      ...(['callbacks', 'servers', 'externalDocs', 'links'] as const).filter((key) => Object.prototype.hasOwnProperty.call(plan.operation, key)).map((key) => ({ key, value: plan.operation[key] })),
    ])),
    responseOverlay: cloneJson(sortDerivedRecords(Object.entries(plan.operation.responses ?? {}).flatMap(([status, response]) => isRecord(response) && response.headers !== undefined ? [{ status, headers: response.headers }] : []))),
    ...(Object.prototype.hasOwnProperty.call(plan.operation, 'security') ? { security: cloneJson(plan.operation.security) as unknown[] } : {}),
  }));
  const manifest: GeneratedZopiaManifest = {
    $schema: ZOPIA_MANIFEST_SCHEMA,
    zopiaVersion: ZOPIA_VERSION,
    mode: options.mode,
    options: { insertComponents: options.insertComponents, useComponentAsReference: options.useComponentAsReference, ...(options.custom === true ? { custom: true } : {}) },
    pathOrder: Object.keys(source.paths),
    schemaComponentsPresent: swagger
      ? Object.prototype.hasOwnProperty.call(source, 'definitions')
      : isRecord(source.components) && Object.prototype.hasOwnProperty.call(source.components, 'schemas'),
    source: {
      kind: swagger ? 'swagger-2.0' : typeof source.openapi === 'string' && /^3\.0/.test(source.openapi) ? 'openapi-3.0' : 'openapi-3.1',
      ...(swagger ? {} : { openapiVersion: source.openapi }),
      title: source.info.title,
      version: source.info.version,
      ...(source.info.description === undefined ? {} : { description: cloneJson(source.info.description) }),
      sha256: sourceHash,
    },
    infoOverlay: cloneJson(Object.fromEntries(Object.entries(source.info).filter(([key]) => !['title', 'version', 'description'].includes(key)))),
    documentOverlay: cloneJson(Object.fromEntries(Object.entries(source).filter(([key]) => key === 'externalDocs' || (key === 'webhooks' && webhookNames.length === 0) || key === 'jsonSchemaDialect' || key.startsWith('x-')))),
    pathsOverlay: cloneJson(Object.fromEntries(Object.entries(source.paths ?? {}).flatMap(([path, item]) => {
      if (path.startsWith('x-')) return [[path, item]];
      if (!isRecord(item)) return [];
      const metadata = Object.fromEntries(Object.entries(item).filter(([key]) => !['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(key)));
      return Object.keys(metadata).length ? [[path, metadata]] : [];
    }))),
    ...(swagger
      ? hasOwn('basePath') ? { servers: [cloneJson(source.basePath)] } : {}
      : hasOwn('servers') ? { servers: cloneJson(source.servers) } : {}),
    ...(swagger ? {
      ...(source.host === undefined ? {} : { swaggerHost: cloneJson(source.host) }),
      ...(source.schemes === undefined ? {} : { swaggerSchemes: cloneJson(source.schemes) }),
      ...(source.consumes === undefined ? {} : { swaggerConsumes: cloneJson(source.consumes) }),
      ...(source.produces === undefined ? {} : { swaggerProduces: cloneJson(source.produces) }),
      ...(source.parameters === undefined ? {} : { swaggerParameters: cloneJson(source.parameters) }),
      ...(source.responses === undefined ? {} : { swaggerResponses: cloneJson(source.responses) }),
    } : {
      ...(hasOwn('components') ? { componentsOverlay: cloneJson(Object.fromEntries(Object.entries(source.components ?? {}).filter(([key]) => key !== 'schemas' && key !== 'securitySchemes'))) } : {}),
    }),
    ...(hasOwn('tags') ? { tags: cloneJson(source.tags) } : {}),
    ...(swagger
      ? hasOwn('securityDefinitions') ? { securitySchemes: cloneJson(source.securityDefinitions) } : {}
      : isRecord(source.components) && Object.prototype.hasOwnProperty.call(source.components, 'securitySchemes') ? { securitySchemes: cloneJson(source.components.securitySchemes) } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'security') ? { defaultSecurity: cloneJson(source.security) } : {}),
    components,
    apis,
    ...(webhookNames.length ? { webhookOrder: webhookNames } : {}),
    ...(isRecord(source.webhooks) ? { webhooksOverlay: cloneJson(Object.fromEntries(webhookNames.flatMap((name) => {
      const item = (source.webhooks as Record<string, unknown>)[name];
      if (!isRecord(item)) return [];
      const metadata = Object.fromEntries(Object.entries(item).filter(([key]) => !['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(key)));
      return Object.keys(metadata).length ? [[name, metadata]] : [];
    }))) } : {}),
    ...(webhooks.length ? { webhooks } : {}),
  };
  validateZopiaManifest(manifest);
  return manifest;
}

function validateSecurityRequirements(value: unknown, context: string): void {
  if (!Array.isArray(value) || value.some((alternative) => !isRecord(alternative)
    || Object.entries(alternative).some(([name, scopes]) => !name || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')))) {
    throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${context}`);
  }
}

function validateSchemaOverlay(overlay: unknown, context: string): void {
  if (!isRecord(overlay) || typeof overlay.at !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${context}`);
  validateKeys(overlay, ['at', 'set', 'remove', 'node'], context);
  validatePointer(overlay.at, context);
  if (overlay.set !== undefined && !isRecord(overlay.set)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${context} set`);
  if (overlay.remove !== undefined && (!Array.isArray(overlay.remove) || overlay.remove.some((key: unknown) => typeof key !== 'string'))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${context} remove`);
  if (!Object.prototype.hasOwnProperty.call(overlay, 'node') && overlay.set === undefined && overlay.remove === undefined) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Empty zopia manifest ${context}`);
}

/**
 * Validate the writer-owned manifest contract before serialization or disk output.
 *
 * @param manifest Candidate manifest to validate in place.
 * @returns Nothing; success narrows `manifest` to the current writer shape.
 * @throws {@link ZopiaError} when any manifest field violates the contract.
 */
export function validateZopiaManifest(manifest: ZopiaManifest): asserts manifest is GeneratedZopiaManifest {
  if (!isRecord(manifest) || manifest.$schema !== ZOPIA_MANIFEST_SCHEMA) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest schema');
  validateKeys(manifest, ['$schema', 'zopiaVersion', 'source', 'mode', 'options', 'pathOrder', 'schemaComponentsPresent', 'infoOverlay', 'documentOverlay', 'pathsOverlay', 'componentsOverlay', 'servers', 'swaggerHost', 'swaggerSchemes', 'swaggerConsumes', 'swaggerProduces', 'swaggerParameters', 'swaggerResponses', 'tags', 'securitySchemes', 'defaultSecurity', 'components', 'apis', 'webhooks', 'webhookOrder', 'webhooksOverlay'], 'root');
  if (manifest.zopiaVersion !== ZOPIA_VERSION) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest writer version');
  if (manifest.mode !== 'directory' && manifest.mode !== 'flat') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest mode');
  if (!isRecord(manifest.options) || typeof manifest.options.insertComponents !== 'boolean' || typeof manifest.options.useComponentAsReference !== 'boolean' || manifest.options.useComponentAsReference && !manifest.options.insertComponents || (manifest.options.custom !== undefined && typeof manifest.options.custom !== 'boolean')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest generation options');
  validateKeys(manifest.options, ['insertComponents', 'useComponentAsReference', 'custom'], 'options');
  if (!Array.isArray(manifest.pathOrder) || manifest.pathOrder.some((path) => typeof path !== 'string' || !path.startsWith('/') && !path.startsWith('x-')) || new Set(manifest.pathOrder).size !== manifest.pathOrder.length) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest path order');
  if (typeof manifest.schemaComponentsPresent !== 'boolean') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest schema-component presence');
  if (!isRecord(manifest.source) || !['swagger-2.0', 'openapi-3.0', 'openapi-3.1'].includes(manifest.source.kind)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest source');
  validateKeys(manifest.source, ['kind', 'openapiVersion', 'title', 'version', 'description', 'sha256'], 'source');
  if (manifest.source.openapiVersion !== undefined && (manifest.source.kind === 'swagger-2.0' || typeof manifest.source.openapiVersion !== 'string' || !/^3\.[01](?:\.\d+)?$/.test(manifest.source.openapiVersion))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest source OpenAPI version');
  if (typeof manifest.source.title !== 'string' || !manifest.source.title.trim() || typeof manifest.source.version !== 'string' || !manifest.source.version.trim()) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest source title or version');
  if (manifest.source.description !== undefined && typeof manifest.source.description !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest source description');
  if (typeof manifest.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.source.sha256)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest source hash');
  for (const [name, value] of [['infoOverlay', manifest.infoOverlay], ['documentOverlay', manifest.documentOverlay], ['pathsOverlay', manifest.pathsOverlay]] as const) {
    if (!isRecord(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${name}`);
  }
  if (manifest.securitySchemes !== undefined && (!isRecord(manifest.securitySchemes) || Object.entries(manifest.securitySchemes).some(([name, scheme]) => !name || !isRecord(scheme)))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest security scheme');
  for (const [name, value] of [['componentsOverlay', manifest.componentsOverlay], ['swaggerParameters', manifest.swaggerParameters], ['swaggerResponses', manifest.swaggerResponses]] as const) {
    if (value !== undefined && !isRecord(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${name}`);
  }
  const invalidInfoKey = Object.keys(manifest.infoOverlay!).find((key) => ['title', 'version', 'description'].includes(key));
  if (invalidInfoKey) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest infoOverlay key: ${invalidInfoKey}`);
  const invalidDocumentKey = Object.keys(manifest.documentOverlay!).find((key) => !['externalDocs', 'webhooks', 'jsonSchemaDialect'].includes(key) && !key.startsWith('x-'));
  if (invalidDocumentKey) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest documentOverlay key: ${invalidDocumentKey}`);
  for (const [path, metadata] of Object.entries(manifest.pathsOverlay!)) {
    if (!manifest.pathOrder.includes(path)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Missing zopia manifest path-order entry: ${path}`);
    if (path.startsWith('x-')) continue;
    if (!path.startsWith('/') || !isRecord(metadata) || Object.keys(metadata).some((key) => ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(key))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest pathsOverlay entry: ${path}`);
  }
  if (manifest.componentsOverlay && ('schemas' in manifest.componentsOverlay || 'securitySchemes' in manifest.componentsOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest componentsOverlay key');
  for (const [name, value] of [['servers', manifest.servers], ['tags', manifest.tags]] as const) {
    if (value !== undefined && !Array.isArray(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${name}`);
  }
  for (const [name, value] of [['swaggerSchemes', manifest.swaggerSchemes], ['swaggerConsumes', manifest.swaggerConsumes], ['swaggerProduces', manifest.swaggerProduces]] as const) {
    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ${name}`);
  }
  if (manifest.swaggerHost !== undefined && typeof manifest.swaggerHost !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest swaggerHost');
  if (manifest.defaultSecurity !== undefined) validateSecurityRequirements(manifest.defaultSecurity, 'default security');
  if (!Array.isArray(manifest.apis)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest APIs');
  if (!Array.isArray(manifest.components)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest components');
  if (!manifest.schemaComponentsPresent && manifest.components.some((component) => isRecord(component) && (!component.kind || component.kind === 'schema'))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Schema components require a declared source container');

  const componentNames = new Set<string>();
  const files = new Set<string>();
  for (const component of manifest.components) {
    const kind = isRecord(component) ? component.kind : undefined;
    if (!isRecord(component) || kind !== undefined && kind !== 'schema' && kind !== 'parameter' && kind !== 'response' || typeof component.name !== 'string' || !component.name) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid or duplicate zopia manifest component: ${String((component as any)?.name)}`);
    const identity = `${kind === 'parameter' || kind === 'response' ? kind : 'schema'}:${component.name}`;
    if (componentNames.has(identity)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid or duplicate zopia manifest component: ${component.name}`);
    validateKeys(component, ['name', 'kind', 'file', 'schema', 'overlay'], 'component');
    componentNames.add(identity);
    if (!Object.prototype.hasOwnProperty.call(component, 'schema')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Missing zopia manifest component schema: ${component.name}`);
    const kindDirectory = kind === 'parameter' ? 'components/parameters' : kind === 'response' ? 'components/responses' : 'components';
    const expectedFile = manifest.options.insertComponents ? `${kindDirectory}/${component.name}/index.ts` : null;
    if ((manifest.options.insertComponents && component.name.includes('/')) || component.file !== expectedFile || (component.file !== null && !isPortableManifestPath(component.file))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest component file: ${String(component.file)}`);
    if (component.file !== null) {
      const fileKey = component.file.toLowerCase();
      if (files.has(fileKey)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Duplicate zopia manifest file: ${component.file}`);
      files.add(fileKey);
    }
    if (!Array.isArray(component.overlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest component overlay: ${component.name}`);
    for (const overlay of component.overlay) validateSchemaOverlay(overlay, `component overlay: ${component.name}`);
  }

  const operations = new Set<string>();
  for (const api of manifest.apis) {
    if (!isRecord(api) || typeof api.file !== 'string' || !isPortableManifestPath(api.file) || typeof api.path !== 'string' || !api.path.startsWith('/') || typeof api.method !== 'string' || !['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(api.method)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest API: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    if (!manifest.pathOrder.includes(api.path)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Missing zopia manifest path-order entry: ${api.path}`);
    validateKeys(api, ['file', 'path', 'method', 'operationId', 'sourceOperation', 'pathItemRef', 'refs', 'overlay', 'responseOverlay', 'security'], 'API');
    if (api.pathItemRef !== undefined && typeof api.pathItemRef !== 'boolean') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest path-item reference flag: ${api.file}`);
    if (typeof api.operationId !== 'string' || !api.operationId) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest operation ID: ${api.file}`);
    const operation = `${api.method}\0${api.path}`;
    if (operations.has(operation)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Duplicate zopia manifest API: ${api.method.toUpperCase()} ${api.path}`);
    operations.add(operation);
    const fileKey = api.file.toLowerCase();
    if (files.has(fileKey)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Duplicate zopia manifest file: ${api.file}`);
    files.add(fileKey);
    if (!isRecord(api.sourceOperation) || !Array.isArray(api.refs) || !Array.isArray(api.overlay) || !Array.isArray(api.responseOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest API metadata: ${api.file}`);
    if (Object.prototype.hasOwnProperty.call(api, 'security')) validateSecurityRequirements(api.security, `API security: ${api.file}`);
    for (const ref of api.refs) {
      if (!isRecord(ref) || typeof ref.at !== 'string' || typeof ref.ref !== 'string' || ref.component !== undefined && typeof ref.component !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ref: ${api.file}`);
      validateKeys(ref, ['at', 'ref', 'component'], 'ref');
      validatePointer(ref.at, 'ref');
      if (ref.ref !== '#' && !ref.ref.startsWith('#/')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ref target: ${ref.ref}`);
    }
    for (const overlay of api.overlay) {
      if (!isRecord(overlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest overlay: ${api.file}`);
      if ('key' in overlay) {
        if (typeof overlay.key !== 'string' || !['callbacks', 'servers', 'externalDocs', 'links'].includes(overlay.key) || !Object.prototype.hasOwnProperty.call(overlay, 'value')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest operation overlay: ${String(overlay.key)}`);
        validateKeys(overlay, ['key', 'value'], 'operation overlay');
      } else validateSchemaOverlay(overlay, `schema overlay: ${api.file}`);
    }
    for (const overlay of api.responseOverlay) {
      if (!isRecord(overlay) || typeof overlay.status !== 'string' || !overlay.status || !Object.prototype.hasOwnProperty.call(overlay, 'headers')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest response overlay: ${api.file}`);
      validateKeys(overlay, ['status', 'headers'], 'response overlay');
    }
  }

  if (manifest.webhooks !== undefined) {
    if (manifest.source.kind !== 'openapi-3.1') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest webhooks for this source kind');
    if (!Array.isArray(manifest.webhooks) || !Array.isArray(manifest.webhookOrder) || manifest.webhookOrder.some((name) => typeof name !== 'string' || !name) || new Set(manifest.webhookOrder).size !== manifest.webhookOrder.length) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest webhook order');
    if (manifest.webhooksOverlay !== undefined && !isRecord(manifest.webhooksOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest webhooksOverlay');
    for (const [name, item] of Object.entries(manifest.webhooksOverlay ?? {})) {
      if (!name.startsWith('x-') && (!isRecord(item) || Object.keys(item).some((key) => ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(key)))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest webhooksOverlay entry: ${name}`);
    }
    const webhookOperations = new Set<string>();
    for (const webhook of manifest.webhooks) {
      if (!isRecord(webhook) || typeof webhook.file !== 'string' || !isPortableManifestPath(webhook.file) || typeof webhook.name !== 'string' || !webhook.name || webhook.name.startsWith('x-') || typeof webhook.method !== 'string' || !['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(webhook.method)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest webhook API: ${String((webhook as any)?.name)} ${String((webhook as any)?.method)}`);
      if (!manifest.webhookOrder.includes(webhook.name)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Missing zopia manifest webhook-order entry: ${webhook.name}`);
      validateKeys(webhook, ['file', 'name', 'method', 'operationId', 'sourceOperation', 'webhookItemRef', 'refs', 'overlay', 'responseOverlay', 'security'], 'webhook API');
      if (webhook.webhookItemRef !== undefined && typeof webhook.webhookItemRef !== 'boolean') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest webhook-item reference flag: ${webhook.file}`);
      if (typeof webhook.operationId !== 'string' || !webhook.operationId) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest webhook operation ID: ${webhook.file}`);
      // Paths and webhooks are separate OpenAPI namespaces; a webhook named like a
      // path template must not trip the path collision check (`operations`). Their
      // shared identity constraint is operationId uniqueness, enforced on reverse.
      const operation = `webhook\0${webhook.method}\0${webhook.name}`;
      if (webhookOperations.has(operation)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Duplicate zopia manifest webhook API: ${webhook.method.toUpperCase()} ${webhook.name}`);
      webhookOperations.add(operation);
      const fileKey = webhook.file.toLowerCase();
      if (files.has(fileKey)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Duplicate zopia manifest file: ${webhook.file}`);
      files.add(fileKey);
      if (!isRecord(webhook.sourceOperation) || !Array.isArray(webhook.refs) || !Array.isArray(webhook.overlay) || !Array.isArray(webhook.responseOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest webhook API metadata: ${webhook.file}`);
      if (Object.prototype.hasOwnProperty.call(webhook, 'security')) validateSecurityRequirements(webhook.security, `webhook API security: ${webhook.file}`);
      for (const ref of webhook.refs) {
        if (!isRecord(ref) || typeof ref.at !== 'string' || typeof ref.ref !== 'string' || ref.component !== undefined && typeof ref.component !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ref: ${webhook.file}`);
        validateKeys(ref, ['at', 'ref', 'component'], 'ref');
        validatePointer(ref.at, 'ref');
        if (ref.ref !== '#' && !ref.ref.startsWith('#/')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest ref target: ${ref.ref}`);
      }
      for (const overlay of webhook.overlay) {
        if (!isRecord(overlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest overlay: ${webhook.file}`);
        if ('key' in overlay) {
          if (typeof overlay.key !== 'string' || !['callbacks', 'servers', 'externalDocs', 'links'].includes(overlay.key) || !Object.prototype.hasOwnProperty.call(overlay, 'value')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest operation overlay: ${String(overlay.key)}`);
          validateKeys(overlay, ['key', 'value'], 'operation overlay');
        } else validateSchemaOverlay(overlay, `schema overlay: ${webhook.file}`);
      }
      for (const overlay of webhook.responseOverlay) {
        if (!isRecord(overlay) || typeof overlay.status !== 'string' || !overlay.status || !Object.prototype.hasOwnProperty.call(overlay, 'headers')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid zopia manifest response overlay: ${webhook.file}`);
        validateKeys(overlay, ['status', 'headers'], 'response overlay');
      }
    }
  }
  stableJson(manifest);
}
/**
 * Serialize a validated manifest with canonical object-key order and one trailing newline.
 *
 * @param manifest Candidate manifest to validate and serialize.
 * @returns Pretty-printed canonical JSON ending in one newline.
 * @throws {@link ZopiaError} when the manifest is invalid.
 */
export function serializeZopiaManifest(manifest: ZopiaManifest): string {
  validateZopiaManifest(manifest);
  return `${JSON.stringify(canonicalValue(manifest), null, 2)}\n`;
}

/**
 * Atomically write a validated manifest and return its absolute path.
 *
 * @param outputDir Destination api-docs directory.
 * @param manifest Candidate manifest to validate and write.
 * @returns Absolute path to the written manifest file.
 * @throws {@link ZopiaError} when validation or filesystem output fails.
 */
export async function writeZopiaManifest(outputDir: string, manifest: ZopiaManifest): Promise<string> {
  if (typeof outputDir !== 'string' || outputDir.trim() === '' || outputDir.includes('\0')) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'invalid manifest output directory', { at: 'outputDir', hint: 'provide a non-empty output-directory path' });
  const root = resolve(outputDir);
  const file = join(root, ZOPIA_MANIFEST_FILE);
  const temporary = `${file}.tmp`;
  const content = serializeZopiaManifest(manifest);
  if (await readFile(file, 'utf8').catch(() => undefined) === content) return file;
  let temporaryWritten = false;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    temporaryWritten = true;
    await rename(temporary, file);
  } catch (error) {
    if (temporaryWritten) await rm(temporary, { force: true }).catch(() => undefined);
    throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to write zopia manifest', { at: file, hint: 'check output-directory permissions and temporary-file conflicts' });
  }
  return file;
}
