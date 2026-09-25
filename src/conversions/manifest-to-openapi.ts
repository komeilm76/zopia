import { readFile } from 'node:fs/promises';

export interface ZopiaManifest { $schema?: string; source: { kind: string; title: string; version: string; description?: string }; infoOverlay?: Record<string, unknown>; documentOverlay?: Record<string, unknown>; componentsOverlay?: Record<string, unknown>; mode?: string; servers?: unknown[]; swaggerHost?: string; swaggerSchemes?: string[]; swaggerConsumes?: string[]; swaggerProduces?: string[]; swaggerParameters?: Record<string, unknown>; swaggerResponses?: Record<string, unknown>; tags?: unknown[]; securitySchemes?: Record<string, unknown>; defaultSecurity?: unknown[]; components?: Array<{ name: string; schema: unknown }>; apis: Array<{ path: string; method: string; operationId?: string; sourceOperation?: Record<string, any>; security?: unknown[] }>; }

/** Reconstruct an OpenAPI document from a lossless zopia manifest. */
/** Read a manifest JSON file and reconstruct its OpenAPI document. */
export async function manifestFileToOpenApi(file: string): Promise<Record<string, unknown>> {
  if (typeof file !== 'string' || !file) throw new TypeError('Manifest file path is required');
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new TypeError(`Invalid manifest file: ${error instanceof Error ? error.message : String(error)}`); }
  return manifestToOpenApi(parsed as ZopiaManifest);
}

export function manifestToOpenApi(manifest: ZopiaManifest): Record<string, unknown> {
  const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
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
  for (const api of manifest.apis) {
    if (!isRecord(api) || typeof api.path !== 'string' || !api.path.startsWith('/') || api.path.includes('?') || api.path.includes('#') || typeof api.method !== 'string' || !/^(get|post|put|delete|head|options|patch|trace)$/.test(api.method)) throw new TypeError(`Invalid manifest API: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    if (api.sourceOperation !== undefined && !isRecord(api.sourceOperation)) throw new TypeError(`Invalid manifest source operation: ${api.path} ${api.method}`);
    const pathItem = Object.prototype.hasOwnProperty.call(document.paths, api.path) ? document.paths[api.path] : {};
    if (Object.prototype.hasOwnProperty.call(pathItem, api.method)) throw new TypeError(`Duplicate manifest API: ${api.path} ${api.method}`);
    const operation: Record<string, any> = api.sourceOperation ? { ...api.sourceOperation } : { operationId: api.operationId, responses: { default: { description: 'Generated from manifest' } } };
    if (api.security !== undefined) operation.security = api.security;
    Object.defineProperty(document.paths, api.path, { value: { ...pathItem, [api.method]: operation }, enumerable: true, configurable: true, writable: true });
  }
  return document;
}
