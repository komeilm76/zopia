import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { jsonSchemaToZod, type JsonSchemaOverlay } from './json-schema-to-zod';
import type { ApiDocsMode } from './api-docs-layout';
import type { ApiDocsFilePlan } from './api-docs-plan';
import type { OpenApiDocument } from './openapi';

/** Versioned schema identifier written into every zopia manifest. */
export const ZOPIA_MANIFEST_SCHEMA = 'zopia:manifest@1' as const;

/** Portable manifest filename used by generated api-docs trees. */
export const ZOPIA_MANIFEST_FILE = '.zopia-manifest.json' as const;

/** Package version recorded by the current manifest writer. */
export const ZOPIA_VERSION = '0.0.1' as const;

/** Supported source dialect labels stored in a manifest. */
export type ZopiaManifestSourceKind = 'swagger-2.0' | 'openapi-3.0' | 'openapi-3.1';

/** Source identity and human-readable document metadata. */
export interface ZopiaManifestSource {
  /** Source dialect. Writers emit a `ZopiaManifestSourceKind`; readers retain forward compatibility. */
  kind: ZopiaManifestSourceKind | (string & {});
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
export type ZopiaManifestOverlay = JsonSchemaOverlay | { key: 'callbacks' | 'servers' | 'externalDocs' | 'links'; value: unknown };

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
  /** Non-canonical source `info` fields. */
  infoOverlay?: Record<string, unknown>;
  /** Document-level extensions and unsupported structures. */
  documentOverlay?: Record<string, unknown>;
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
}

/** Current writer component shape (legacy manifests may omit writer-owned fields). */
export interface GeneratedZopiaManifestComponent extends ZopiaManifestComponent {
  file: string | null;
  overlay: JsonSchemaOverlay[];
}

/** Current writer endpoint shape (legacy manifests may omit writer-owned fields). */
export interface GeneratedZopiaManifestApi extends ZopiaManifestApi {
  file: string;
  operationId: string;
  sourceOperation: Record<string, unknown>;
  refs: ZopiaManifestRef[];
  overlay: ZopiaManifestOverlay[];
  responseOverlay: ZopiaManifestResponseOverlay[];
}

/** Complete manifest shape emitted by the current dedicated writer. */
export interface GeneratedZopiaManifest extends ZopiaManifest {
  $schema: typeof ZOPIA_MANIFEST_SCHEMA;
  zopiaVersion: typeof ZOPIA_VERSION;
  source: ZopiaManifestSource & { kind: ZopiaManifestSourceKind; title: string; version: string; sha256: string };
  mode: ApiDocsMode;
  options: ZopiaManifestGenerationOptions;
  infoOverlay: Record<string, unknown>;
  documentOverlay: Record<string, unknown>;
  servers: unknown[];
  tags: unknown[];
  securitySchemes: Record<string, unknown>;
  components: GeneratedZopiaManifestComponent[];
  apis: GeneratedZopiaManifestApi[];
}

/** Options used by the pure manifest builder. */
export interface CreateZopiaManifestOptions {
  /** Endpoint layout mode. */
  mode: ApiDocsMode;
  /** Whether component files were emitted. */
  insertComponents: boolean;
  /** Whether endpoint modules import component files. */
  useComponentAsReference: boolean;
}

const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

function stableJson(value: unknown, stack = new Set<object>()): string {
  if (Array.isArray(value)) {
    if (stack.has(value)) throw new TypeError('Cannot serialize a circular JSON value');
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) throw new TypeError('Cannot serialize a non-JSON array');
    stack.add(value);
    const output = `[${value.map((item) => stableJson(item, stack)).join(',')}]`;
    stack.delete(value);
    return output;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('Cannot serialize a non-JSON object');
    if (stack.has(value)) throw new TypeError('Cannot serialize a circular JSON value');
    stack.add(value);
    const object = value as Record<string, unknown>;
    const output = `{${Object.keys(object).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableJson(object[key], stack)}`).join(',')}}`;
    stack.delete(value);
    return output;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`Cannot serialize a non-JSON number: ${String(value)}`);
  const output = JSON.stringify(value);
  if (output === undefined) throw new TypeError(`Cannot serialize a non-JSON value: ${String(value)}`);
  return output;
}

function canonicalValue(value: unknown, stack = new Set<object>()): unknown {
  if (Array.isArray(value)) {
    if (stack.has(value)) throw new TypeError('Cannot serialize a circular JSON value');
    stack.add(value);
    const output = value.map((item) => canonicalValue(item, stack));
    stack.delete(value);
    return output;
  }
  if (value && typeof value === 'object') {
    if (stack.has(value)) throw new TypeError('Cannot serialize a circular JSON value');
    stack.add(value);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) Object.defineProperty(output, key, { value: canonicalValue((value as Record<string, unknown>)[key], stack), enumerable: true, configurable: true, writable: true });
    stack.delete(value);
    return output;
  }
  if (JSON.stringify(value) === undefined) throw new TypeError(`Cannot serialize a non-JSON value: ${String(value)}`);
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
  if (/~(?![01])/.test(encoded)) return undefined;
  return encoded.replace(/~1/g, '/').replace(/~0/g, '~');
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

function prefixedSchemaOverlays(schema: unknown, at: string): JsonSchemaOverlay[] {
  if (schema === undefined || schema === null) return [];
  return jsonSchemaToZod(schema as any).overlays.map((overlay) => ({ ...overlay, at: `${at}${overlay.at}` }));
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
  if (value !== '' && !value.startsWith('/')) throw new TypeError(`Invalid ${context} pointer: ${value}`);
  if (/~(?![01])/.test(value)) throw new TypeError(`Invalid ${context} pointer escape: ${value}`);
}

function validateKeys(value: object, allowed: readonly string[], context: string): void {
  const invalid = Object.keys(value).find((key) => !allowed.includes(key));
  if (invalid !== undefined) throw new TypeError(`Invalid zopia manifest ${context} key: ${invalid}`);
}

/** Compute the canonical SHA-256 identity used for manifest staleness checks. */
export function hashOpenApiDocument(document: OpenApiDocument): string {
  try {
    return createHash('sha256').update(stableJson(document)).digest('hex');
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('circular JSON value')) throw new TypeError('Cannot hash a circular OpenAPI document');
    if (error instanceof TypeError && error.message.includes('non-JSON')) throw new TypeError('Cannot hash an unsupported OpenAPI value');
    throw error;
  }
}

/** Build a detached, deterministic manifest snapshot without touching the filesystem. */
export function createZopiaManifest(source: OpenApiDocument, plans: readonly ApiDocsFilePlan[], options: CreateZopiaManifestOptions): GeneratedZopiaManifest {
  if (!isRecord(source) || !isRecord(source.info)) throw new TypeError('Invalid manifest source document');
  if (!['directory', 'flat'].includes(options.mode) || typeof options.insertComponents !== 'boolean' || typeof options.useComponentAsReference !== 'boolean') throw new TypeError('Invalid manifest generation options');
  if (options.useComponentAsReference && !options.insertComponents) throw new TypeError('useComponentAsReference requires insertComponents');
  const sourceHash = hashOpenApiDocument(source);
  const swagger = source.swagger === '2.0';
  const schemas = swagger ? source.definitions ?? {} : source.components?.schemas ?? {};
  if (!isRecord(schemas)) throw new TypeError('Invalid source schema components');
  const sortedPlans = [...plans].sort((left, right) => compareText(left.file, right.file));
  const components: GeneratedZopiaManifestComponent[] = Object.entries(schemas).sort(([left], [right]) => compareText(left, right)).map(([name, schema]) => ({
    name,
    file: options.insertComponents ? `components/${name}/index.ts` : null,
    schema: cloneJson(schema),
    overlay: cloneJson(sortDerivedRecords(jsonSchemaToZod(schema as any).overlays)),
  }));
  const apis: GeneratedZopiaManifestApi[] = sortedPlans.map((plan) => ({
    file: plan.file,
    path: plan.path,
    method: plan.method,
    operationId: plan.operationId,
    sourceOperation: cloneJson(plan.operation),
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
    options: { insertComponents: options.insertComponents, useComponentAsReference: options.useComponentAsReference },
    source: {
      kind: swagger ? 'swagger-2.0' : typeof source.openapi === 'string' && /^3\.0/.test(source.openapi) ? 'openapi-3.0' : 'openapi-3.1',
      title: source.info.title,
      version: source.info.version,
      ...(source.info.description === undefined ? {} : { description: cloneJson(source.info.description) }),
      sha256: sourceHash,
    },
    infoOverlay: cloneJson(Object.fromEntries(Object.entries(source.info).filter(([key]) => !['title', 'version', 'description'].includes(key)))),
    documentOverlay: cloneJson(Object.fromEntries(Object.entries(source).filter(([key]) => key === 'externalDocs' || key === 'webhooks' || key === 'jsonSchemaDialect' || key.startsWith('x-')))),
    servers: cloneJson(source.servers ?? (source.basePath ? [source.basePath] : ['/'])),
    ...(swagger ? {
      ...(source.host === undefined ? {} : { swaggerHost: cloneJson(source.host) }),
      ...(source.schemes === undefined ? {} : { swaggerSchemes: cloneJson(source.schemes) }),
      ...(source.consumes === undefined ? {} : { swaggerConsumes: cloneJson(source.consumes) }),
      ...(source.produces === undefined ? {} : { swaggerProduces: cloneJson(source.produces) }),
      ...(source.parameters === undefined ? {} : { swaggerParameters: cloneJson(source.parameters) }),
      ...(source.responses === undefined ? {} : { swaggerResponses: cloneJson(source.responses) }),
    } : {
      componentsOverlay: cloneJson(Object.fromEntries(Object.entries(source.components ?? {}).filter(([key]) => key !== 'schemas' && key !== 'securitySchemes'))),
    }),
    tags: cloneJson(source.tags ?? []),
    securitySchemes: cloneJson(source.components?.securitySchemes ?? source.securityDefinitions ?? {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'security') ? { defaultSecurity: cloneJson(source.security) } : {}),
    components,
    apis,
  };
  validateZopiaManifest(manifest);
  return manifest;
}

function validateSecurityRequirements(value: unknown, context: string): void {
  if (!Array.isArray(value) || value.some((alternative) => !isRecord(alternative)
    || Object.entries(alternative).some(([name, scopes]) => !name || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')))) {
    throw new TypeError(`Invalid zopia manifest ${context}`);
  }
}

function validateSchemaOverlay(overlay: unknown, context: string): void {
  if (!isRecord(overlay) || typeof overlay.at !== 'string') throw new TypeError(`Invalid zopia manifest ${context}`);
  validateKeys(overlay, ['at', 'set', 'remove', 'node'], context);
  validatePointer(overlay.at, context);
  if (overlay.set !== undefined && !isRecord(overlay.set)) throw new TypeError(`Invalid zopia manifest ${context} set`);
  if (overlay.remove !== undefined && (!Array.isArray(overlay.remove) || overlay.remove.some((key: unknown) => typeof key !== 'string'))) throw new TypeError(`Invalid zopia manifest ${context} remove`);
  if (!Object.prototype.hasOwnProperty.call(overlay, 'node') && overlay.set === undefined && overlay.remove === undefined) throw new TypeError(`Empty zopia manifest ${context}`);
}

/** Validate the writer-owned manifest contract before serialization or disk output. */
export function validateZopiaManifest(manifest: ZopiaManifest): asserts manifest is GeneratedZopiaManifest {
  if (!isRecord(manifest) || manifest.$schema !== ZOPIA_MANIFEST_SCHEMA) throw new TypeError('Invalid zopia manifest schema');
  validateKeys(manifest, ['$schema', 'zopiaVersion', 'source', 'mode', 'options', 'infoOverlay', 'documentOverlay', 'componentsOverlay', 'servers', 'swaggerHost', 'swaggerSchemes', 'swaggerConsumes', 'swaggerProduces', 'swaggerParameters', 'swaggerResponses', 'tags', 'securitySchemes', 'defaultSecurity', 'components', 'apis'], 'root');
  if (manifest.zopiaVersion !== ZOPIA_VERSION) throw new TypeError('Invalid zopia manifest writer version');
  if (manifest.mode !== 'directory' && manifest.mode !== 'flat') throw new TypeError('Invalid zopia manifest mode');
  if (!isRecord(manifest.options) || typeof manifest.options.insertComponents !== 'boolean' || typeof manifest.options.useComponentAsReference !== 'boolean' || manifest.options.useComponentAsReference && !manifest.options.insertComponents) throw new TypeError('Invalid zopia manifest generation options');
  validateKeys(manifest.options, ['insertComponents', 'useComponentAsReference'], 'options');
  if (!isRecord(manifest.source) || !['swagger-2.0', 'openapi-3.0', 'openapi-3.1'].includes(manifest.source.kind)) throw new TypeError('Invalid zopia manifest source');
  validateKeys(manifest.source, ['kind', 'title', 'version', 'description', 'sha256'], 'source');
  if (typeof manifest.source.title !== 'string' || !manifest.source.title.trim() || typeof manifest.source.version !== 'string' || !manifest.source.version.trim()) throw new TypeError('Invalid zopia manifest source title or version');
  if (manifest.source.description !== undefined && typeof manifest.source.description !== 'string') throw new TypeError('Invalid zopia manifest source description');
  if (typeof manifest.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.source.sha256)) throw new TypeError('Invalid zopia manifest source hash');
  for (const [name, value] of [['infoOverlay', manifest.infoOverlay], ['documentOverlay', manifest.documentOverlay], ['securitySchemes', manifest.securitySchemes]] as const) {
    if (!isRecord(value)) throw new TypeError(`Invalid zopia manifest ${name}`);
  }
  if (Object.entries(manifest.securitySchemes!).some(([name, scheme]) => !name || !isRecord(scheme))) throw new TypeError('Invalid zopia manifest security scheme');
  for (const [name, value] of [['componentsOverlay', manifest.componentsOverlay], ['swaggerParameters', manifest.swaggerParameters], ['swaggerResponses', manifest.swaggerResponses]] as const) {
    if (value !== undefined && !isRecord(value)) throw new TypeError(`Invalid zopia manifest ${name}`);
  }
  const invalidInfoKey = Object.keys(manifest.infoOverlay!).find((key) => ['title', 'version', 'description'].includes(key));
  if (invalidInfoKey) throw new TypeError(`Invalid zopia manifest infoOverlay key: ${invalidInfoKey}`);
  const invalidDocumentKey = Object.keys(manifest.documentOverlay!).find((key) => !['externalDocs', 'webhooks', 'jsonSchemaDialect'].includes(key) && !key.startsWith('x-'));
  if (invalidDocumentKey) throw new TypeError(`Invalid zopia manifest documentOverlay key: ${invalidDocumentKey}`);
  if (manifest.componentsOverlay && ('schemas' in manifest.componentsOverlay || 'securitySchemes' in manifest.componentsOverlay)) throw new TypeError('Invalid zopia manifest componentsOverlay key');
  for (const [name, value] of [['servers', manifest.servers], ['tags', manifest.tags]] as const) {
    if (!Array.isArray(value)) throw new TypeError(`Invalid zopia manifest ${name}`);
  }
  for (const [name, value] of [['swaggerSchemes', manifest.swaggerSchemes], ['swaggerConsumes', manifest.swaggerConsumes], ['swaggerProduces', manifest.swaggerProduces]] as const) {
    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) throw new TypeError(`Invalid zopia manifest ${name}`);
  }
  if (manifest.swaggerHost !== undefined && typeof manifest.swaggerHost !== 'string') throw new TypeError('Invalid zopia manifest swaggerHost');
  if (manifest.defaultSecurity !== undefined) validateSecurityRequirements(manifest.defaultSecurity, 'default security');
  if (!Array.isArray(manifest.apis)) throw new TypeError('Invalid zopia manifest APIs');
  if (!Array.isArray(manifest.components)) throw new TypeError('Invalid zopia manifest components');

  const componentNames = new Set<string>();
  const files = new Set<string>();
  for (const component of manifest.components) {
    if (!isRecord(component) || typeof component.name !== 'string' || !component.name || componentNames.has(component.name)) throw new TypeError(`Invalid or duplicate zopia manifest component: ${String((component as any)?.name)}`);
    validateKeys(component, ['name', 'file', 'schema', 'overlay'], 'component');
    componentNames.add(component.name);
    if (!Object.prototype.hasOwnProperty.call(component, 'schema')) throw new TypeError(`Missing zopia manifest component schema: ${component.name}`);
    const expectedFile = manifest.options.insertComponents ? `components/${component.name}/index.ts` : null;
    if ((manifest.options.insertComponents && component.name.includes('/')) || component.file !== expectedFile || (component.file !== null && !isPortableManifestPath(component.file))) throw new TypeError(`Invalid zopia manifest component file: ${String(component.file)}`);
    if (component.file !== null) {
      if (files.has(component.file)) throw new TypeError(`Duplicate zopia manifest file: ${component.file}`);
      files.add(component.file);
    }
    if (!Array.isArray(component.overlay)) throw new TypeError(`Invalid zopia manifest component overlay: ${component.name}`);
    for (const overlay of component.overlay) validateSchemaOverlay(overlay, `component overlay: ${component.name}`);
  }

  const operations = new Set<string>();
  for (const api of manifest.apis) {
    if (!isRecord(api) || typeof api.file !== 'string' || !isPortableManifestPath(api.file) || typeof api.path !== 'string' || !api.path.startsWith('/') || typeof api.method !== 'string' || !['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace'].includes(api.method)) throw new TypeError(`Invalid zopia manifest API: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    validateKeys(api, ['file', 'path', 'method', 'operationId', 'sourceOperation', 'refs', 'overlay', 'responseOverlay', 'security'], 'API');
    if (typeof api.operationId !== 'string' || !api.operationId) throw new TypeError(`Invalid zopia manifest operation ID: ${api.file}`);
    const operation = `${api.method}\0${api.path}`;
    if (operations.has(operation)) throw new TypeError(`Duplicate zopia manifest API: ${api.method.toUpperCase()} ${api.path}`);
    operations.add(operation);
    if (files.has(api.file)) throw new TypeError(`Duplicate zopia manifest file: ${api.file}`);
    files.add(api.file);
    if (!isRecord(api.sourceOperation) || !Array.isArray(api.refs) || !Array.isArray(api.overlay) || !Array.isArray(api.responseOverlay)) throw new TypeError(`Invalid zopia manifest API metadata: ${api.file}`);
    if (Object.prototype.hasOwnProperty.call(api, 'security')) validateSecurityRequirements(api.security, `API security: ${api.file}`);
    for (const ref of api.refs) {
      if (!isRecord(ref) || typeof ref.at !== 'string' || typeof ref.ref !== 'string' || ref.component !== undefined && typeof ref.component !== 'string') throw new TypeError(`Invalid zopia manifest ref: ${api.file}`);
      validateKeys(ref, ['at', 'ref', 'component'], 'ref');
      validatePointer(ref.at, 'ref');
      if (ref.ref !== '#' && !ref.ref.startsWith('#/')) throw new TypeError(`Invalid zopia manifest ref target: ${ref.ref}`);
    }
    for (const overlay of api.overlay) {
      if (!isRecord(overlay)) throw new TypeError(`Invalid zopia manifest overlay: ${api.file}`);
      if ('key' in overlay) {
        if (typeof overlay.key !== 'string' || !['callbacks', 'servers', 'externalDocs', 'links'].includes(overlay.key) || !Object.prototype.hasOwnProperty.call(overlay, 'value')) throw new TypeError(`Invalid zopia manifest operation overlay: ${String(overlay.key)}`);
        validateKeys(overlay, ['key', 'value'], 'operation overlay');
      } else validateSchemaOverlay(overlay, `schema overlay: ${api.file}`);
    }
    for (const overlay of api.responseOverlay) {
      if (!isRecord(overlay) || typeof overlay.status !== 'string' || !overlay.status || !Object.prototype.hasOwnProperty.call(overlay, 'headers')) throw new TypeError(`Invalid zopia manifest response overlay: ${api.file}`);
      validateKeys(overlay, ['status', 'headers'], 'response overlay');
    }
  }
  stableJson(manifest);
}
/** Serialize a validated manifest with canonical object-key order and one trailing newline. */
export function serializeZopiaManifest(manifest: ZopiaManifest): string {
  validateZopiaManifest(manifest);
  return `${JSON.stringify(canonicalValue(manifest), null, 2)}\n`;
}

/** Atomically write a validated manifest and return its absolute path. */
export async function writeZopiaManifest(outputDir: string, manifest: ZopiaManifest): Promise<string> {
  if (typeof outputDir !== 'string' || outputDir.trim() === '' || outputDir.includes('\0')) throw new TypeError('Invalid manifest output directory');
  const root = resolve(outputDir);
  const file = join(root, ZOPIA_MANIFEST_FILE);
  const temporary = `${file}.tmp`;
  const content = serializeZopiaManifest(manifest);
  await mkdir(root, { recursive: true });
  let temporaryWritten = false;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    temporaryWritten = true;
    await rename(temporary, file);
  } catch (error) {
    if (temporaryWritten) await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return file;
}
