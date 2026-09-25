import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ZopiaError } from '../errors';
import type { ZopiaWarning } from '../warnings';
import { generateApiDocsFiles } from './api-docs-generate';
import type { ApiDocsMode } from './api-docs-layout';
import { extractOperationContracts } from './openapi-contracts';
import { buildOpenApiOperationIR } from './openapi-ir';
import { resolveOpenApiLocalRef } from './openapi-ref';
import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';
import { jsonSchemaToZod, type JsonSchema } from './json-schema-to-zod';
import { hashOpenApiDocument, ZOPIA_MANIFEST_FILE } from './manifest-writer';

/** Options for generating an api-docs tree from Swagger or OpenAPI. */
export interface ZopiaGenerateOptions {
  /** Directory in which generated files are written. @default 'api_docs' */
  outDir?: string;
  /** Endpoint directory layout. @default 'directory' */
  mode?: ApiDocsMode;
  /** Emit one file per declared schema component. @default false */
  insertComponents?: boolean;
  /** Import emitted components from endpoint files. Requires `insertComponents`. @default false */
  useComponentAsReference?: boolean;
  /** Write the reverse-conversion manifest. @default true */
  manifest?: boolean;
}

/** One file written by Engine ③, relative to its output directory. */
export interface ZopiaGeneratedFile {
  /** Portable path relative to `outDir`. */
  path: string;
  /** Generated artifact category. */
  kind: 'endpoint' | 'component' | 'manifest';
}

/** Result returned by the Engine ③ public API. */
export interface ZopiaGenerateResult {
  /** Every file written, sorted by portable relative path. */
  files: ZopiaGeneratedFile[];
  /** Structured, non-fatal conversion diagnostics. */
  warnings: ZopiaWarning[];
  /** Manifest path relative to `outDir`, absent when `manifest` is false. */
  manifestPath?: string;
}

interface ValidatedOptions {
  outDir: string;
  mode: ApiDocsMode;
  insertComponents: boolean;
  useComponentAsReference: boolean;
  manifest: boolean;
}

const escapePointer = (value: string | number): string => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const childPointer = (at: string, value: string | number): string => `${at}/${escapePointer(value)}`;

function validateOptions(options: ZopiaGenerateOptions | undefined): ValidatedOptions {
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
    throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'generate options must be an object', { hint: 'pass an options object or omit it' });
  }
  const value = options ?? {};
  const known = new Set(['outDir', 'mode', 'insertComponents', 'useComponentAsReference', 'manifest']);
  const unknown = Object.keys(value).find((key) => !known.has(key));
  if (unknown) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unknown generate option: ${unknown}`, { at: unknown, hint: 'remove the unsupported option' });
  if (value.outDir !== undefined && (typeof value.outDir !== 'string' || value.outDir.trim() === '' || value.outDir.includes('\0'))) {
    throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'outDir must be a non-empty path', { at: 'outDir', hint: 'provide a writable output directory' });
  }
  if (value.mode !== undefined && value.mode !== 'directory' && value.mode !== 'flat') {
    throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported layout mode: ${String(value.mode)}`, { at: 'mode', hint: "use 'directory' or 'flat'" });
  }
  for (const key of ['insertComponents', 'useComponentAsReference', 'manifest'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `${key} must be a boolean`, { at: key });
  }
  if (value.useComponentAsReference === true && value.insertComponents !== true) {
    throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'useComponentAsReference requires insertComponents', { at: 'useComponentAsReference', hint: 'enable `insertComponents` first' });
  }
  return {
    outDir: value.outDir ?? 'api_docs',
    mode: value.mode ?? 'directory',
    insertComponents: value.insertComponents ?? false,
    useComponentAsReference: value.useComponentAsReference ?? false,
    manifest: value.manifest ?? true,
  };
}

async function readInput(input: string | Record<string, unknown>): Promise<OpenApiDocument> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ZopiaError('ZOPIA_SPEC_INVALID_JSON', 'input must be a JSON object, JSON text, or .json file path', { hint: 'pass a Swagger/OpenAPI JSON object or file' });
  }
  let text = input;
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    try { text = await readFile(input, 'utf8'); }
    catch (error) {
      throw new ZopiaError('ZOPIA_SPEC_INVALID_JSON', `unable to read JSON input: ${input}`, { at: input, hint: 'check that the JSON file exists and is readable', cause: error });
    }
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('expected a JSON object');
    return parsed as OpenApiDocument;
  } catch (error) {
    throw new ZopiaError('ZOPIA_SPEC_INVALID_JSON', `invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { at: typeof input === 'string' && text !== input ? input : undefined, hint: 'fix the JSON syntax', cause: error });
  }
}

function normalizePublic(document: OpenApiDocument): OpenApiDocument {
  try { return normalizeOpenApiDocument(document).document; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unsupported OpenAPI document version')) {
      throw new ZopiaError('ZOPIA_SPEC_UNSUPPORTED_VERSION', message, { at: '#', hint: 'supported: Swagger 2.0, OpenAPI 3.0, and OpenAPI 3.1' });
    }
    if (message.includes('paths must be an object')) throw new ZopiaError('ZOPIA_SPEC_MISSING_PATHS', message, { at: '#/paths' });
    throw new ZopiaError('ZOPIA_SPEC_INVALID', message, { at: '#', hint: 'fix the invalid Swagger/OpenAPI document', cause: error });
  }
}

function validateReferences(document: OpenApiDocument): void {
  const stack = new Set<object>();
  const structuralMaps = new Set(['paths', 'schemas', 'definitions', '$defs', 'properties', 'patternProperties', 'dependentSchemas', 'responses', 'content', 'headers', 'links', 'encoding', 'callbacks', 'parameters', 'requestBodies', 'securitySchemes', 'securityDefinitions', 'pathItems']);
  type VisitMode = 'normal' | 'map' | 'example-map' | 'example-object';
  const visit = (value: unknown, at: string, mode: VisitMode = 'normal'): void => {
    if (!value || typeof value !== 'object') return;
    if (stack.has(value as object)) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'circular in-memory OpenAPI value', { at, hint: 'use JSON references instead of JavaScript object cycles' });
    stack.add(value as object);
    if (Array.isArray(value)) value.forEach((child, index) => visit(child, childPointer(at, index)));
    else {
      const object = value as Record<string, unknown>;
      if ((mode === 'normal' || mode === 'example-object') && Object.prototype.hasOwnProperty.call(object, '$ref')) {
        const refAt = childPointer(at, '$ref');
        if (typeof object.$ref !== 'string' || object.$ref.length === 0) throw new ZopiaError('ZOPIA_REF_NOT_FOUND', 'reference must be a non-empty string', { at: refAt, hint: 'use a valid local JSON Pointer' });
        if (!object.$ref.startsWith('#')) throw new ZopiaError('ZOPIA_REF_EXTERNAL', `external reference is not supported: ${object.$ref}`, { at: refAt, hint: 'multi-file references land in Phase 2' });
        try { resolveOpenApiLocalRef(document, object.$ref); }
        catch (error) { throw new ZopiaError('ZOPIA_REF_NOT_FOUND', `unresolved local reference: ${object.$ref}`, { at: refAt, hint: 'check the local JSON Pointer', cause: error }); }
      }
      for (const [key, child] of Object.entries(object)) {
        const childAt = childPointer(at, key);
        if (mode === 'map') visit(child, childAt);
        else if (mode === 'example-map') visit(child, childAt, 'example-object');
        else if (mode === 'example-object' && key === 'value') continue;
        else if (['example', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-')) continue;
        else if (key === 'examples') {
          if (document.swagger !== '2.0' && !Array.isArray(child)) visit(child, childAt, 'example-map');
        } else visit(child, childAt, structuralMaps.has(key) ? 'map' : 'normal');
      }
    }
    stack.delete(value as object);
  };
  visit(document, '#');
}

function primaryContent(content: unknown): [string, Record<string, any>] | undefined {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
  const entries = Object.entries(content as Record<string, Record<string, any>>);
  return entries.find(([type]) => type.toLowerCase() === 'application/json') ?? entries[0];
}

function warningsForDocument(document: OpenApiDocument): ZopiaWarning[] {
  const warnings: ZopiaWarning[] = [];
  const push = (warning: ZopiaWarning): void => { warnings.push(warning); };
  const schemaWithoutRefs = (value: unknown): unknown => {
    if (typeof value === 'boolean') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === 'string') {
      const siblings = Object.fromEntries(Object.entries(object).filter(([key]) => key !== '$ref'));
      return Object.keys(siblings).length ? schemaWithoutRefs(siblings) : true;
    }
    const literalKeys = new Set(['example', 'examples', 'default', 'enum', 'const']);
    return Object.fromEntries(Object.entries(object).map(([key, child]) => {
      if (literalKeys.has(key) || key.startsWith('x-')) return [key, child];
      if (Array.isArray(child)) return [key, child.map((item) => item && typeof item === 'object' ? schemaWithoutRefs(item) : item)];
      if (child && typeof child === 'object') return [key, schemaWithoutRefs(child)];
      return [key, child];
    }));
  };
  const resolveReusable = (value: any): any => {
    let current = value;
    const seen = new Set<string>();
    while (current && typeof current === 'object' && typeof current.$ref === 'string' && !seen.has(current.$ref)) {
      seen.add(current.$ref);
      const resolved = resolveOpenApiLocalRef(document, current.$ref);
      if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) break;
      current = { ...(resolved as Record<string, unknown>), ...Object.fromEntries(Object.entries(current).filter(([key]) => key !== '$ref')) };
    }
    return current;
  };
  const addSchemaWarnings = (schema: unknown, at: string): void => {
    if (schema === undefined) return;
    const result = jsonSchemaToZod(schemaWithoutRefs(schema) as JsonSchema);
    for (const warning of result.warnings) {
      const suffix = warning.at && warning.at !== '#' ? warning.at.slice(1) : '';
      push({ ...warning, at: `${at}${suffix}` });
    }
  };
  const addMultiContentWarning = (content: unknown, at: string): void => {
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new TypeError(`Invalid content at ${at}: expected an object`);
    for (const [mediaType, media] of Object.entries(content)) if (!mediaType || !media || typeof media !== 'object' || Array.isArray(media)) throw new TypeError(`Invalid media type content at ${at}/${escapePointer(mediaType)}`);
    const mediaTypes = Object.keys(content);
    if (mediaTypes.length > 1) push({ code: 'ZOPIA_WARN_MULTI_CONTENT', at, message: `using ${primaryContent(content)?.[0]} as the generated primary media type; all ${mediaTypes.length} entries remain in the manifest` });
  };

  if (Array.isArray(document.servers)) document.servers.forEach((server: any, index: number) => {
    if (server && typeof server === 'object' && server.variables !== undefined) push({ code: 'ZOPIA_WARN_SERVER_VARIABLES', at: `#/servers/${index}/variables`, message: 'server variables are preserved in the manifest but are not represented in generated endpoint code' });
  });
  if (document.webhooks !== undefined) push({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'webhooks are preserved in the manifest but are not emitted as endpoint files' });

  if (document.swagger !== '2.0' && document.components !== undefined && (!document.components || typeof document.components !== 'object' || Array.isArray(document.components))) throw new TypeError('Invalid OpenAPI components: expected an object');
  const schemas = document.swagger === '2.0' ? document.definitions : document.components?.schemas;
  if (schemas !== undefined && (!schemas || typeof schemas !== 'object' || Array.isArray(schemas))) throw new TypeError('Invalid schema components: expected an object');
  if (schemas && typeof schemas === 'object' && !Array.isArray(schemas)) for (const [name, schema] of Object.entries(schemas)) {
    addSchemaWarnings(schema, `${document.swagger === '2.0' ? '#/definitions' : '#/components/schemas'}/${escapePointer(name)}`);
  }

  for (const [path, rawItem] of Object.entries(document.paths ?? {})) {
    if (path.startsWith('x-') || !rawItem || typeof rawItem !== 'object') continue;
    let item = rawItem as Record<string, any>;
    const pathRefs = new Set<string>();
    while (typeof item.$ref === 'string' && !pathRefs.has(item.$ref)) {
      pathRefs.add(item.$ref);
      const resolved = resolveOpenApiLocalRef(document, item.$ref);
      if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) break;
      item = { ...(resolved as Record<string, any>), ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== '$ref')) };
    }
    for (const method of ['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace']) {
      const operation = item[method];
      if (!operation || typeof operation !== 'object') continue;
      const operationAt = `#/paths/${escapePointer(path)}/${method}`;
      const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
      parameters.forEach((rawParameter: any, index: number) => {
        const parameter = resolveReusable(rawParameter);
        if (!parameter || typeof parameter !== 'object') return;
        const parameterAt = `${operationAt}/parameters/${index}`;
        if (parameter.schema !== undefined) addSchemaWarnings(parameter.schema, `${parameterAt}/schema`);
        else if (parameter.in === 'body') addSchemaWarnings(parameter.schema, `${parameterAt}/schema`);
        else if (document.swagger === '2.0' && parameter.type !== undefined) {
          const keys = ['type', 'format', 'items', 'default', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'enum', 'multipleOf'];
          addSchemaWarnings(Object.fromEntries(Object.entries(parameter).filter(([key]) => keys.includes(key))), parameterAt);
        }
      });
      const requestBody = resolveReusable(operation.requestBody);
      if (requestBody?.content) {
        addMultiContentWarning(requestBody.content, `${operationAt}/requestBody/content`);
        for (const [mediaType, media] of Object.entries(requestBody.content as Record<string, any>)) addSchemaWarnings(media?.schema, `${operationAt}/requestBody/content/${escapePointer(mediaType)}/schema`);
      }
      for (const [status, rawResponse] of Object.entries(operation.responses ?? {})) {
        const response = resolveReusable(rawResponse);
        if (!response || typeof response !== 'object') continue;
        const responseAt = `${operationAt}/responses/${escapePointer(status)}`;
        if (response.content) {
          addMultiContentWarning(response.content, `${responseAt}/content`);
          for (const [mediaType, media] of Object.entries(response.content as Record<string, any>)) addSchemaWarnings(media?.schema, `${responseAt}/content/${escapePointer(mediaType)}/schema`);
        } else addSchemaWarnings(response.schema, `${responseAt}/schema`);
      }
      if (document.swagger === '2.0') {
        const consumes = Array.isArray(operation.consumes) ? operation.consumes : document.consumes;
        const produces = Array.isArray(operation.produces) ? operation.produces : document.produces;
        if (Array.isArray(consumes) && consumes.length > 1) push({ code: 'ZOPIA_WARN_MULTI_CONTENT', at: `${operationAt}/consumes`, message: `using ${consumes.find((type: unknown) => typeof type === 'string' && (/[/+]json$/i.test(type) || type === 'application/json')) ?? consumes[0]} as the generated request media type; all entries remain in the manifest` });
        if (Array.isArray(produces) && produces.length > 1) push({ code: 'ZOPIA_WARN_MULTI_CONTENT', at: `${operationAt}/produces`, message: `using ${produces.find((type: unknown) => typeof type === 'string' && (/[/+]json$/i.test(type) || type === 'application/json')) ?? produces[0]} as the generated response media type; all entries remain in the manifest` });
      }
    }
  }

  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}\0${warning.at ?? ''}\0${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => {
    const a = `${left.at ?? ''}\0${left.code}\0${left.message}`;
    const b = `${right.at ?? ''}\0${right.code}\0${right.message}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function mapGenerationError(error: unknown): ZopiaError {
  if (error instanceof ZopiaError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('path-item $ref') || message.includes('path item $ref')) return new ZopiaError('ZOPIA_SPEC_PATH_REF', message, { hint: 'path-item references must be valid local references', cause: error });
  return new ZopiaError('ZOPIA_SPEC_INVALID', message, { hint: 'fix the invalid Swagger/OpenAPI document', cause: error });
}

/**
 * Generate a reversible api-docs tree from Swagger 2.0 or OpenAPI 3.0/3.1.
 *
 * Accepts an in-memory JSON object, JSON text, or a `.json` file path. See R-641
 * for primary-media selection and R-408 for structured warning behavior.
 *
 * @param input Swagger/OpenAPI object, JSON text, or readable JSON file path.
 * @param options Output directory, layout, component, reference, and manifest controls.
 * @returns Sorted written-file metadata, structured warnings, and the optional manifest path.
 * @throws {ZopiaError} `ZOPIA_CONFIG_INVALID` for invalid options and `ZOPIA_SPEC_*` or `ZOPIA_REF_*` for invalid input.
 * @example
 * ```ts
 * const result = await openApiToApiDocs('swagger.json', { outDir: 'api_docs', mode: 'flat' });
 * ```
 * @see [docs/06-conversions.md → Engine ③](../../docs/06-conversions.md)
 */
export async function openApiToApiDocs(input: string | Record<string, unknown>, options?: ZopiaGenerateOptions): Promise<ZopiaGenerateResult> {
  const config = validateOptions(options);
  const parsed = await readInput(input);
  const document = normalizePublic(parsed);
  validateReferences(document);

  let hash: string;
  try { hash = hashOpenApiDocument(document); }
  catch (error) { throw mapGenerationError(error); }

  let warnings: ZopiaWarning[];
  try {
    warnings = warningsForDocument(document);
    const operations = buildOpenApiOperationIR(document);
    for (const operation of operations) extractOperationContracts(operation);
  } catch (error) { throw mapGenerationError(error); }

  if (config.manifest) {
    try {
      const previous = JSON.parse(await readFile(join(config.outDir, ZOPIA_MANIFEST_FILE), 'utf8')) as any;
      if (typeof previous?.source?.sha256 === 'string' && previous.source.sha256 !== hash) warnings.push({ code: 'ZOPIA_WARN_STALE_TREE', at: ZOPIA_MANIFEST_FILE, message: 'the existing generated tree came from a different input document and will be overwritten' });
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw new ZopiaError('ZOPIA_FS_WRITE_FAILED', 'unable to inspect the existing output manifest', { at: config.outDir, cause: error });
    }
  }

  let generated;
  try {
    generated = await generateApiDocsFiles(document, {
      outputDir: config.outDir,
      mode: config.mode,
      insertComponents: config.insertComponents,
      useComponentAsReference: config.useComponentAsReference,
      manifest: config.manifest,
    });
  } catch (error: any) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EROFS' || error?.code === 'ENOSPC') throw new ZopiaError('ZOPIA_FS_WRITE_FAILED', `unable to write api-docs tree: ${error.message}`, { at: config.outDir, cause: error });
    throw mapGenerationError(error);
  }

  const files: ZopiaGeneratedFile[] = generated.map(({ file }): ZopiaGeneratedFile => ({
    path: file,
    kind: file === ZOPIA_MANIFEST_FILE ? 'manifest' : file.startsWith('components/') ? 'component' : 'endpoint',
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  warnings.sort((left, right) => {
    const a = `${left.at ?? ''}\0${left.code}\0${left.message}`;
    const b = `${right.at ?? ''}\0${right.code}\0${right.message}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { files, warnings, ...(config.manifest ? { manifestPath: ZOPIA_MANIFEST_FILE } : {}) };
}
