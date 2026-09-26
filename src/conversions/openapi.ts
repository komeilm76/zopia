import { asZopiaError, ZopiaError } from '../errors';
export type OpenApiDocument = Record<string, any>;
export type OpenApiVersion = '2.0' | '3.0' | '3.1';

export interface NormalizedOpenApiDocument {
  document: OpenApiDocument;
  version: OpenApiVersion;
  title?: string;
  versionString?: string;
}

const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

/** Parse and validate the supported OpenAPI/Swagger document envelope. */
export function normalizeOpenApiDocument(input: OpenApiDocument | string): NormalizedOpenApiDocument {
  let document: OpenApiDocument;
  try { document = (typeof input === 'string' ? JSON.parse(input) : input) as OpenApiDocument; }
  catch (error) { throw asZopiaError(error, 'ZOPIA_SPEC_INVALID_JSON', 'Invalid OpenAPI document', { at: '#', hint: 'fix the JSON syntax' }); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid OpenAPI document: expected an object', { at: '#' });
  let version: OpenApiVersion;
  if (document.swagger === '2.0') version = '2.0';
  else if (typeof document.openapi === 'string' && /^3\.0(?:\.\d+)?$/.test(document.openapi)) version = '3.0';
  else if (typeof document.openapi === 'string' && /^3\.1(?:\.\d+)?$/.test(document.openapi)) version = '3.1';
  else throw new ZopiaError('ZOPIA_SPEC_UNSUPPORTED_VERSION', 'Unsupported OpenAPI document version; expected Swagger 2.0 or OpenAPI 3.0/3.1', { at: '#', hint: 'use Swagger 2.0, OpenAPI 3.0, or OpenAPI 3.1' });
  if (!document.info || typeof document.info !== 'object' || typeof document.info.title !== 'string' || document.info.title.trim() === '' || typeof document.info.version !== 'string' || document.info.version.trim() === '') throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid OpenAPI document: info.title and info.version are required', { at: '#/info', hint: 'provide non-empty info.title and info.version strings' });
  if (!document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) throw new ZopiaError('ZOPIA_SPEC_MISSING_PATHS', 'invalid OpenAPI document: paths must be an object', { at: '#/paths', hint: 'add a paths object to the API document' });
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/') && !path.startsWith('x-')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: path key must start with /: ${path}`, { at: `#/paths/${pointerToken(path)}`, hint: "start API path keys with '/'" });
    if (path.startsWith('x-')) continue;
    if (/[{}]/.test(path) && !/^\/([^{}]|\{[A-Za-z0-9._-]+\})*$/.test(path)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: malformed path template: ${path}`, { at: `#/paths/${pointerToken(path)}`, hint: 'use balanced {parameter} path segments' });
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: path item must be an object: ${path}`, { at: `#/paths/${pointerToken(path)}`, hint: 'provide a Path Item object' });
  }
  return { document, version, title: document.info.title, versionString: document.info.version };
}
