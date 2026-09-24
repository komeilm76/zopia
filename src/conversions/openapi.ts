export type OpenApiDocument = Record<string, any>;
export type OpenApiVersion = '2.0' | '3.0' | '3.1';

export interface NormalizedOpenApiDocument {
  document: OpenApiDocument;
  version: OpenApiVersion;
  title?: string;
  versionString?: string;
}

/** Parse and validate the supported OpenAPI/Swagger document envelope. */
export function normalizeOpenApiDocument(input: OpenApiDocument | string): NormalizedOpenApiDocument {
  let document: OpenApiDocument;
  try { document = (typeof input === 'string' ? JSON.parse(input) : input) as OpenApiDocument; }
  catch (error) { throw new TypeError(`Invalid OpenAPI document: ${error instanceof Error ? error.message : String(error)}`); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('Invalid OpenAPI document: expected an object');
  let version: OpenApiVersion;
  if (document.swagger === '2.0') version = '2.0';
  else if (typeof document.openapi === 'string' && /^3\.0(?:\.\d+)?$/.test(document.openapi)) version = '3.0';
  else if (typeof document.openapi === 'string' && /^3\.1(?:\.\d+)?$/.test(document.openapi)) version = '3.1';
  else throw new TypeError('Unsupported OpenAPI document version; expected Swagger 2.0 or OpenAPI 3.0/3.1');
  if (!document.info || typeof document.info !== 'object' || typeof document.info.title !== 'string' || document.info.title.trim() === '' || typeof document.info.version !== 'string' || document.info.version.trim() === '') throw new TypeError('Invalid OpenAPI document: info.title and info.version are required');
  if (!document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) throw new TypeError('Invalid OpenAPI document: paths must be an object');
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/') && !path.startsWith('x-')) throw new TypeError(`Invalid OpenAPI document: path key must start with /: ${path}`);
    if (path.startsWith('x-')) continue;
    if (/[{}]/.test(path) && !/^\/([^{}]|\{[A-Za-z0-9._-]+\})*$/.test(path)) throw new TypeError(`Invalid OpenAPI document: malformed path template: ${path}`);
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Invalid OpenAPI document: path item must be an object: ${path}`);
  }
  return { document, version, title: document.info.title, versionString: document.info.version };
}
