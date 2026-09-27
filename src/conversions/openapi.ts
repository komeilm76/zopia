import { asZopiaError, ZopiaError } from '../errors';

/** Mutable JSON-like Swagger/OpenAPI document accepted by normalization helpers. */
export type OpenApiDocument = Record<string, any>;

/** Supported normalized source dialect family. */
export type OpenApiVersion = '2.0' | '3.0' | '3.1';

/** Validated source envelope and its normalized dialect metadata. */
export interface NormalizedOpenApiDocument {
  /** Validated source document. */
  document: OpenApiDocument;
  /** Detected Swagger/OpenAPI dialect family. */
  version: OpenApiVersion;
  /** Source `info.title`, when available after validation. */
  title?: string;
  /** Source `info.version`, when available after validation. */
  versionString?: string;
}

const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');
const PATH_ITEM_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * Parse and validate the supported OpenAPI/Swagger document envelope.
 *
 * @param input Swagger/OpenAPI object or JSON text.
 * @returns Validated document with detected dialect and info metadata.
 * @throws {@link ZopiaError} when parsing or envelope validation fails.
 */
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
    if (path.includes('?') || path.includes('#')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: path must not contain a query or fragment: ${path}`, { at: `#/paths/${pointerToken(path)}`, hint: 'move query values into parameter objects and remove URL fragments' });
    if (/[{}]/.test(path) && !/^\/([^{}]|\{[A-Za-z0-9._-]+\})*$/.test(path)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: malformed path template: ${path}`, { at: `#/paths/${pointerToken(path)}`, hint: 'use balanced {parameter} path segments' });
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: path item must be an object: ${path}`, { at: `#/paths/${pointerToken(path)}`, hint: 'provide a Path Item object' });
    const allowedPathItemFields = new Set(['$ref', 'parameters', ...PATH_ITEM_METHODS, ...(version === '2.0' ? [] : ['summary', 'description', 'servers'])]);
    const unsupportedField = Object.keys(item).find((key) => !allowedPathItemFields.has(key) && !key.startsWith('x-'));
    if (unsupportedField) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid OpenAPI document: unsupported path-item field: ${unsupportedField}`, { at: `#/paths/${pointerToken(path)}/${pointerToken(unsupportedField)}`, hint: 'use a supported HTTP method or an x- extension' });
  }
  return { document, version, title: document.info.title, versionString: document.info.version };
}
