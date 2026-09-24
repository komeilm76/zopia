export interface ZopiaManifest { $schema?: string; source: { kind: string; title: string; version: string }; mode?: string; servers?: unknown[]; tags?: unknown[]; securitySchemes?: Record<string, unknown>; defaultSecurity?: unknown[]; components?: Array<{ name: string; schema: unknown }>; apis: Array<{ path: string; method: string; operationId?: string; sourceOperation?: Record<string, any>; security?: unknown[] }>; }

/** Reconstruct an OpenAPI document from a lossless zopia manifest. */
export function manifestToOpenApi(manifest: ZopiaManifest): Record<string, unknown> {
  if (!manifest || typeof manifest !== 'object' || manifest.$schema !== 'zopia:manifest@1' || !manifest.source || !Array.isArray(manifest.apis)) throw new TypeError('Invalid zopia manifest');
  if (!['swagger-2.0', 'openapi-3.0', 'openapi-3.1'].includes(manifest.source.kind)) throw new TypeError(`Unsupported manifest source kind: ${manifest.source.kind}`);
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const document: Record<string, any> = isSwagger
    ? { swagger: '2.0', info: { title: manifest.source.title, version: manifest.source.version }, paths: {} }
    : { openapi: manifest.source.kind === 'openapi-3.0' ? '3.0.0' : '3.1.0', info: { title: manifest.source.title, version: manifest.source.version }, paths: {} };
  if (manifest.servers?.length && !isSwagger) document.servers = manifest.servers;
  if (manifest.servers?.length && isSwagger && typeof manifest.servers[0] === 'string') document.basePath = manifest.servers[0];
  if (manifest.tags?.length) document.tags = manifest.tags;
  if (manifest.securitySchemes) {
    if (isSwagger) document.securityDefinitions = manifest.securitySchemes;
    else document.components = { securitySchemes: manifest.securitySchemes };
  }
  if (manifest.defaultSecurity !== undefined) document.security = manifest.defaultSecurity;
  const schemas = Object.fromEntries((manifest.components ?? []).map((component) => [component.name, component.schema]));
  if (Object.keys(schemas).length) {
    if (isSwagger) document.definitions = schemas;
    else document.components = { ...(document.components ?? {}), schemas };
  }
  for (const api of manifest.apis) {
    if (!api.path || !/^(get|post|put|delete|head|options|patch|trace)$/.test(api.method)) throw new TypeError(`Invalid manifest API: ${api.path} ${api.method}`);
    const operation: Record<string, any> = api.sourceOperation ? { ...api.sourceOperation } : { operationId: api.operationId, responses: { default: { description: 'Generated from manifest' } } };
    if (api.security !== undefined) operation.security = api.security;
    document.paths[api.path] = { ...(document.paths[api.path] ?? {}), [api.method]: operation };
  }
  return document;
}
