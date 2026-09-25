import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ZopiaManifest { $schema?: string; source: { kind: string; title: string; version: string; description?: string }; infoOverlay?: Record<string, unknown>; documentOverlay?: Record<string, unknown>; componentsOverlay?: Record<string, unknown>; mode?: string; servers?: unknown[]; swaggerHost?: string; swaggerSchemes?: string[]; swaggerConsumes?: string[]; swaggerProduces?: string[]; swaggerParameters?: Record<string, unknown>; swaggerResponses?: Record<string, unknown>; tags?: unknown[]; securitySchemes?: Record<string, unknown>; defaultSecurity?: unknown[]; components?: Array<{ name: string; schema: unknown }>; apis: Array<{ file?: string; path: string; method: string; operationId?: string; sourceOperation?: Record<string, any>; security?: unknown[] }>; }

type EndpointConfig = Record<string, any>;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace']);

function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function isEndpointConfig(value: unknown): value is EndpointConfig {
  return isRecord(value) && typeof value.method === 'string' && typeof value.pathShape === 'string' && isRecord(value.request) && isRecord(value.response);
}

function isFileWithinRoot(root: string, file: string): boolean {
  const fromRoot = relative(root, file);
  return Boolean(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function selectEndpointConfig(module: Record<string, unknown>, operationId: string | undefined, file: string): EndpointConfig {
  if (isEndpointConfig(module.default)) return module.default;
  const candidates = [...new Set(Object.values(module).filter(isEndpointConfig))];
  const matching = operationId === undefined ? [] : candidates.filter((candidate) => candidate.operationId === operationId);
  if (matching.length === 1) return matching[0];
  if (candidates.length === 1) return candidates[0];
  throw new TypeError(`Generated endpoint module does not export a unique km-api config: ${file}`);
}

async function importEndpointConfigs(manifest: ZopiaManifest, manifestFile: string): Promise<Map<number, EndpointConfig>> {
  const root = await realpath(dirname(resolve(manifestFile)));
  const modules = new Map<string, Record<string, unknown>>();
  const configs = new Map<number, EndpointConfig>();
  for (const [index, api] of manifest.apis.entries()) {
    if (!isRecord(api) || typeof api.file !== 'string' || !api.file) throw new TypeError(`Manifest API file is required: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    if (isAbsolute(api.file)) throw new TypeError(`Unsafe manifest API file: ${api.file}`);
    const requested = resolve(root, api.file);
    if (!isFileWithinRoot(root, requested)) throw new TypeError(`Unsafe manifest API file: ${api.file}`);
    let endpointFile: string;
    try { endpointFile = await realpath(requested); }
    catch (error) { throw new TypeError(`Unable to resolve generated endpoint file ${api.file}: ${error instanceof Error ? error.message : String(error)}`); }
    if (!isFileWithinRoot(root, endpointFile)) throw new TypeError(`Unsafe manifest API file: ${api.file}`);
    let endpointModule = modules.get(endpointFile);
    if (!endpointModule) {
      try {
        const metadata = await stat(endpointFile);
        const url = pathToFileURL(endpointFile); url.searchParams.set('zopia-reverse', `${metadata.mtimeMs}-${metadata.size}`);
        endpointModule = await import(url.href) as Record<string, unknown>;
      } catch (error) { throw new TypeError(`Unable to import generated endpoint file ${api.file}: ${error instanceof Error ? error.message : String(error)}`); }
      modules.set(endpointFile, endpointModule);
    }
    configs.set(index, selectEndpointConfig(endpointModule, api.operationId, api.file));
  }
  return configs;
}

/** Read a manifest, import its generated endpoint modules, and reconstruct the API document. */
export async function manifestFileToOpenApi(file: string): Promise<Record<string, unknown>> {
  if (typeof file !== 'string' || !file) throw new TypeError('Manifest file path is required');
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new TypeError(`Invalid manifest file: ${error instanceof Error ? error.message : String(error)}`); }
  const manifest = parsed as ZopiaManifest;
  reconstructOpenApi(manifest);
  const endpointConfigs = await importEndpointConfigs(manifest, file);
  return reconstructOpenApi(manifest, endpointConfigs);
}

/** Reconstruct an API document from in-memory manifest snapshots without importing generated files. */
export function manifestToOpenApi(manifest: ZopiaManifest): Record<string, unknown> {
  return reconstructOpenApi(manifest);
}

function runtimeOperation(api: ZopiaManifest['apis'][number], sourceOperation: Record<string, any>, config: EndpointConfig): { path: string; method: string; operation: Record<string, any> } {
  const method = config.method.toLowerCase();
  if (!HTTP_METHODS.has(method)) throw new TypeError(`Invalid generated endpoint method: ${String(config.method)}`);
  let path: unknown;
  try { path = typeof config.makeOpenApiPathShape === 'function' ? config.makeOpenApiPathShape() : config.pathShape.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}'); }
  catch (error) { throw new TypeError(`Unable to read generated endpoint path ${api.file}: ${error instanceof Error ? error.message : String(error)}`); }
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#')) throw new TypeError(`Invalid generated endpoint path: ${String(path)}`);
  if (config.operationId !== undefined && (typeof config.operationId !== 'string' || !config.operationId.trim())) throw new TypeError(`Invalid generated endpoint operationId: ${String(config.operationId)}`);
  for (const field of ['summary', 'description'] as const) if (config[field] !== undefined && typeof config[field] !== 'string') throw new TypeError(`Invalid generated endpoint ${field}: ${String(config[field])}`);
  if (config.tags !== undefined && (!Array.isArray(config.tags) || !config.tags.every((tag: unknown) => typeof tag === 'string'))) throw new TypeError('Invalid generated endpoint tags');
  if (config.deprecated !== undefined && config.deprecated !== 'YES' && config.deprecated !== 'NO') throw new TypeError(`Invalid generated endpoint deprecated status: ${String(config.deprecated)}`);
  if (config.auth !== undefined && config.auth !== 'YES' && config.auth !== 'NO') throw new TypeError(`Invalid generated endpoint auth status: ${String(config.auth)}`);

  const operation = { ...sourceOperation };
  if (Object.prototype.hasOwnProperty.call(sourceOperation, 'operationId') || config.operationId !== api.operationId) {
    if (config.operationId === undefined) delete operation.operationId;
    else operation.operationId = config.operationId;
  }
  for (const field of ['summary', 'description'] as const) {
    const value = config[field];
    if (Object.prototype.hasOwnProperty.call(sourceOperation, field) || value !== undefined && value !== '') {
      if (value === undefined) delete operation[field];
      else operation[field] = value;
    }
  }
  const tags = config.tags?.map((tag: string) => tag.startsWith('#') ? tag.slice(1) : tag);
  if (Object.prototype.hasOwnProperty.call(sourceOperation, 'tags') || tags?.length) operation.tags = tags ?? [];
  else delete operation.tags;
  const deprecated = config.deprecated === 'YES';
  if (Object.prototype.hasOwnProperty.call(sourceOperation, 'deprecated') || deprecated) operation.deprecated = deprecated;
  else delete operation.deprecated;
  return { path, method, operation };
}

function reconstructOpenApi(manifest: ZopiaManifest, endpointConfigs = new Map<number, EndpointConfig>()): Record<string, unknown> {
  if (!isRecord(manifest) || manifest.$schema !== 'zopia:manifest@1' || !isRecord(manifest.source) || !Array.isArray(manifest.apis)) throw new TypeError('Invalid zopia manifest');
  if (!['swagger-2.0', 'openapi-3.0', 'openapi-3.1'].includes(manifest.source.kind)) throw new TypeError(`Unsupported manifest source kind: ${manifest.source.kind}`);
  if (typeof manifest.source.title !== 'string' || !manifest.source.title.trim() || typeof manifest.source.version !== 'string' || !manifest.source.version.trim()) throw new TypeError('Invalid manifest source title or version');
  if (manifest.infoOverlay !== undefined && !isRecord(manifest.infoOverlay)) throw new TypeError('Invalid manifest infoOverlay');
  if (manifest.documentOverlay !== undefined && !isRecord(manifest.documentOverlay)) throw new TypeError('Invalid manifest documentOverlay');
  if (manifest.componentsOverlay !== undefined && !isRecord(manifest.componentsOverlay)) throw new TypeError('Invalid manifest componentsOverlay');
  if (manifest.swaggerParameters !== undefined && !isRecord(manifest.swaggerParameters)) throw new TypeError('Invalid manifest swaggerParameters');
  if (manifest.swaggerResponses !== undefined && !isRecord(manifest.swaggerResponses)) throw new TypeError('Invalid manifest swaggerResponses');
  if (manifest.componentsOverlay && ('schemas' in manifest.componentsOverlay || 'securitySchemes' in manifest.componentsOverlay)) throw new TypeError('Invalid manifest componentsOverlay: schemas and securitySchemes are reserved');
  const reservedInfoKeys = new Set(['title', 'version', 'description']);
  const invalidInfoKey = Object.keys(manifest.infoOverlay ?? {}).find((key) => reservedInfoKeys.has(key));
  if (invalidInfoKey) throw new TypeError(`Invalid manifest infoOverlay key: ${invalidInfoKey}`);
  const allowedDocumentKey = (key: string): boolean => key === 'externalDocs' || key === 'webhooks' || key === 'jsonSchemaDialect' || key.startsWith('x-');
  const invalidDocumentKey = Object.keys(manifest.documentOverlay ?? {}).find((key) => !allowedDocumentKey(key));
  if (invalidDocumentKey) throw new TypeError(`Invalid manifest documentOverlay key: ${invalidDocumentKey}`);
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const document: Record<string, any> = isSwagger
    ? { swagger: '2.0', info: { title: manifest.source.title, version: manifest.source.version, ...(manifest.source.description === undefined ? {} : { description: manifest.source.description }) }, paths: {} }
    : { openapi: manifest.source.kind === 'openapi-3.0' ? '3.0.0' : '3.1.0', info: { title: manifest.source.title, version: manifest.source.version, ...(manifest.source.description === undefined ? {} : { description: manifest.source.description }) }, paths: {} };
  const assignOverlay = (target: Record<string, unknown>, overlay: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(overlay)) Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  };
  if (manifest.infoOverlay) assignOverlay(document.info, manifest.infoOverlay);
  if (manifest.documentOverlay) assignOverlay(document, manifest.documentOverlay);
  if (manifest.servers?.length && !isSwagger) document.servers = manifest.servers;
  if (manifest.servers?.length && isSwagger && typeof manifest.servers[0] === 'string') document.basePath = manifest.servers[0];
  if (isSwagger) { if (manifest.swaggerHost) document.host = manifest.swaggerHost; if (manifest.swaggerSchemes?.length) document.schemes = manifest.swaggerSchemes; if (manifest.swaggerConsumes?.length) document.consumes = manifest.swaggerConsumes; if (manifest.swaggerProduces?.length) document.produces = manifest.swaggerProduces; if (manifest.swaggerParameters) document.parameters = manifest.swaggerParameters; if (manifest.swaggerResponses) document.responses = manifest.swaggerResponses; }
  else if (manifest.componentsOverlay && Object.keys(manifest.componentsOverlay).length) document.components = { ...manifest.componentsOverlay };
  if (manifest.tags?.length) document.tags = manifest.tags;
  if (manifest.securitySchemes) {
    if (!isRecord(manifest.securitySchemes)) throw new TypeError('Invalid manifest securitySchemes');
    if (isSwagger) document.securityDefinitions = manifest.securitySchemes;
    else document.components = { ...(document.components ?? {}), securitySchemes: manifest.securitySchemes };
  }
  if (manifest.defaultSecurity !== undefined) document.security = manifest.defaultSecurity;
  const schemas = Object.fromEntries((manifest.components ?? []).map((component) => [component.name, component.schema]));
  if (Object.keys(schemas).length) {
    if (isSwagger) document.definitions = schemas;
    else document.components = { ...(document.components ?? {}), schemas };
  }
  for (const [index, api] of manifest.apis.entries()) {
    if (!isRecord(api) || typeof api.path !== 'string' || !api.path.startsWith('/') || api.path.includes('?') || api.path.includes('#') || typeof api.method !== 'string' || !HTTP_METHODS.has(api.method)) throw new TypeError(`Invalid manifest API: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    if (api.sourceOperation !== undefined && !isRecord(api.sourceOperation)) throw new TypeError(`Invalid manifest source operation: ${api.path} ${api.method}`);
    const sourceOperation: Record<string, any> = api.sourceOperation ? { ...api.sourceOperation } : { operationId: api.operationId, responses: { default: { description: 'Generated from manifest' } } };
    const runtime = endpointConfigs.get(index);
    const reconstructed = runtime ? runtimeOperation(api, sourceOperation, runtime) : { path: api.path, method: api.method, operation: sourceOperation };
    if (api.security !== undefined) reconstructed.operation.security = api.security;
    const pathItem = Object.prototype.hasOwnProperty.call(document.paths, reconstructed.path) ? document.paths[reconstructed.path] : {};
    if (Object.prototype.hasOwnProperty.call(pathItem, reconstructed.method)) throw new TypeError(`Duplicate manifest API: ${reconstructed.path} ${reconstructed.method}`);
    Object.defineProperty(document.paths, reconstructed.path, { value: { ...pathItem, [reconstructed.method]: reconstructed.operation }, enumerable: true, configurable: true, writable: true });
  }
  return document;
}
