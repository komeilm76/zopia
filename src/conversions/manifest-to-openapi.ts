import { asZopiaError, ZopiaError, type ZopiaErrorCode } from '../errors';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zodSchemasToJsonSchema, zodToJsonSchema } from './zod-to-json-schema';
import { jsonSchemaToZod } from './json-schema-to-zod';
import { decodeJsonPointerSegment } from './openapi-ref';
import { extractOperationContracts, isValidResponseStatus } from './openapi-contracts';
import { buildOpenApiOperationIR } from './openapi-ir';
import { webhookRuntimePath } from './api-docs-plan';
import { OPENAPI_METHODS } from './openapi-to-api-docs';
import { ZopiaWarningCollector, type ZopiaWarning } from '../warnings';
import { ZOPIA_MANIFEST_FILE, ZOPIA_MANIFEST_SCHEMA, type ZopiaManifest } from './manifest-writer';
import { ensureFallbackSecurityScheme, normalizeSecurityRequirements } from './reverse-security';
export type { ZopiaManifest } from './manifest-writer';

/** Options for selecting the OpenAPI dialect emitted by reverse conversion. */
export interface ZopiaReverseOptions {
  /**
   * OpenAPI version to emit. Low-level manifest helpers preserve the source dialect when omitted.
   * @default '3.1' for `apiDocsToOpenApi`; preserved source dialect for manifest helpers
   */
  version?: '2.0' | '3.0' | '3.1';
  /**
   * Receive each deterministic structured warning emitted during reverse conversion.
   *
   * @param warning Normalized warning emitted in deterministic order.
   * @returns Nothing.
   * @default undefined
   */
  onWarning?: (warning: ZopiaWarning) => void;
}

/** Result returned by the directory-level reverse-conversion API. */
export interface ZopiaReverseResult {
  /** Reconstructed OpenAPI document. */
  openapi: Record<string, unknown>;
  /** Non-fatal structured conversion warnings. */
  warnings: ZopiaWarning[];
}

type EndpointConfig = Record<string, any>;
type ComponentSchema = Parameters<typeof zodToJsonSchema>[0];
interface ImportedComponents { schemas: Map<number, unknown>; references: Array<readonly [string, ComponentSchema]>; }

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace']);
const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function isEndpointConfig(value: unknown): value is EndpointConfig {
  return isRecord(value) && typeof value.method === 'string' && typeof value.pathShape === 'string' && isRecord(value.request) && isRecord(value.response);
}

function isFileWithinRoot(root: string, file: string): boolean {
  const fromRoot = relative(root, file);
  return Boolean(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function manifestMismatch(message: string, at?: string): ZopiaError {
  return new ZopiaError('ZOPIA_DOCS_MANIFEST_MISMATCH', message, {
    at,
    hint: 'regenerate the api-docs tree or restore the generated file',
  });
}

async function validateManifestFiles(manifest: ZopiaManifest, root: string): Promise<void> {
  const entries: Array<{ file: string; kind: 'endpoint' | 'component' }> = [];
  for (const api of manifest.apis) {
    if (!isRecord(api) || typeof api.file !== 'string' || !api.file) throw manifestMismatch(`manifest API entry does not list a generated file: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    entries.push({ file: api.file, kind: 'endpoint' });
  }
  for (const component of manifest.components ?? []) if (component.file !== undefined && component.file !== null) entries.push({ file: component.file, kind: 'component' });

  for (const { file, kind } of entries) {
    const manifestKind = kind === 'endpoint' ? 'API' : 'component';
    if (isAbsolute(file)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsafe manifest ${manifestKind} file: ${file}`);
    const requested = resolve(root, file);
    if (!isFileWithinRoot(root, requested)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsafe manifest ${manifestKind} file: ${file}`);
    let generatedFile: string;
    try { generatedFile = await realpath(requested); }
    catch (error) {
      if (isMissingFileError(error)) throw manifestMismatch(`generated ${kind} file is missing or renamed: ${file}`, file);
      throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unable to resolve generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`, { at: file, cause: error });
    }
    if (!isFileWithinRoot(root, generatedFile)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsafe manifest ${manifestKind} file: ${file}`);
    let metadata;
    try { metadata = await stat(generatedFile); }
    catch (error) {
      if (isMissingFileError(error)) throw manifestMismatch(`generated ${kind} file is missing or renamed: ${file}`, file);
      throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unable to inspect generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`, { at: file, cause: error });
    }
    if (!metadata.isFile()) throw manifestMismatch(`generated ${kind} file is missing or renamed: ${file}`, file);
  }
}

function isComponentSchema(value: unknown): value is ComponentSchema {
  return isRecord(value) && isRecord(value._zod) && typeof value._zod.run === 'function' && typeof value.parse === 'function';
}

function selectEndpointConfig(module: Record<string, unknown>, operationId: string | undefined, file: string): EndpointConfig {
  const candidates = [...new Set(Object.values(module).filter(isEndpointConfig))];
  const matching = operationId === undefined ? [] : candidates.filter((candidate) => candidate.operationId === operationId);
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Generated endpoint module exports multiple km-api configs for operationId ${operationId}: ${file}`, { at: file });
  if (isEndpointConfig(module.default)) return module.default;
  if (candidates.length === 1) return candidates[0];
  throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Generated endpoint module does not export a unique km-api config: ${file}`, { at: file });
}

function selectComponentSchema(module: Record<string, unknown>, file: string): ComponentSchema {
  if (isComponentSchema(module.default)) return module.default;
  const candidates = [...new Set(Object.values(module).filter(isComponentSchema))];
  if (candidates.length === 1) return candidates[0];
  throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Generated component module does not export a unique Zod schema: ${file}`, { at: file });
}

async function importGeneratedModule(root: string, file: string, kind: 'endpoint' | 'component', modules: Map<string, Record<string, unknown>>, cacheBust = true): Promise<Record<string, unknown>> {
  const manifestKind = kind === 'endpoint' ? 'API' : 'component';
  if (isAbsolute(file)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsafe manifest ${manifestKind} file: ${file}`);
  const requested = resolve(root, file);
  if (!isFileWithinRoot(root, requested)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsafe manifest ${manifestKind} file: ${file}`);
  let generatedFile: string;
  try { generatedFile = await realpath(requested); }
  catch (error) { throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unable to resolve generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`, { at: file, cause: error }); }
  if (!isFileWithinRoot(root, generatedFile)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsafe manifest ${manifestKind} file: ${file}`);
  const moduleKey = `${generatedFile}\0${cacheBust ? 'fresh' : 'shared'}`;
  let generatedModule = modules.get(moduleKey);
  if (!generatedModule) {
    try {
      const url = pathToFileURL(generatedFile);
      if (cacheBust) {
        const digest = createHash('sha256').update(await readFile(generatedFile)).digest('hex');
        url.searchParams.set('zopia-reverse', digest);
      }
      const importUrl = url.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}').replace(/%7E/gi, '~');
      generatedModule = await import(importUrl) as Record<string, unknown>;
    } catch (error) { throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Unable to import generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`, { at: file, cause: error }); }
    modules.set(moduleKey, generatedModule);
  }
  return generatedModule;
}

async function importEndpointConfigs(manifest: ZopiaManifest, root: string, modules: Map<string, Record<string, unknown>>): Promise<Map<number, EndpointConfig>> {
  const configs = new Map<number, EndpointConfig>();
  for (const [index, api] of manifest.apis.entries()) {
    if (!isRecord(api) || typeof api.file !== 'string' || !api.file) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Manifest API file is required: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    const endpointModule = await importGeneratedModule(root, api.file, 'endpoint', modules);
    configs.set(index, selectEndpointConfig(endpointModule, api.operationId, api.file));
  }
  return configs;
}

async function importWebhookConfigs(manifest: ZopiaManifest, root: string, modules: Map<string, Record<string, unknown>>): Promise<Map<number, EndpointConfig>> {
  const configs = new Map<number, EndpointConfig>();
  for (const [index, webhook] of (manifest.webhooks ?? []).entries()) {
    if (!isRecord(webhook) || typeof webhook.file !== 'string' || !webhook.file) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Manifest webhook API file is required: ${String((webhook as any)?.name)} ${String((webhook as any)?.method)}`);
    const endpointModule = await importGeneratedModule(root, webhook.file, 'endpoint', modules);
    configs.set(index, selectEndpointConfig(endpointModule, webhook.operationId, webhook.file));
  }
  return configs;
}

async function importComponentSchemas(manifest: ZopiaManifest, root: string, modules: Map<string, Record<string, unknown>>, warnings?: ZopiaWarningCollector): Promise<ImportedComponents> {
  const shared = new Map<number, ComponentSchema>();
  const imported = new Map<number, ComponentSchema>();
  for (const [index, component] of (manifest.components ?? []).entries()) {
    if (component.file === undefined || component.file === null) continue;
    const sharedModule = await importGeneratedModule(root, component.file, 'component', modules, false);
    shared.set(index, selectComponentSchema(sharedModule, component.file));
    const freshModule = await importGeneratedModule(root, component.file, 'component', modules);
    imported.set(index, selectComponentSchema(freshModule, component.file));
  }
  if (imported.size === 0) return { schemas: new Map(), references: [] };

  const indexByName = new Map((manifest.components ?? []).map((component, index) => [component.name, index]));
  const aliases = new Set<number>();
  for (const [index, schema] of imported) {
    const target = componentRefTarget(manifest.components![index].schema);
    const targetIndex = target === undefined ? undefined : indexByName.get(target);
    if (targetIndex !== undefined && (schema === shared.get(targetIndex) || schema === imported.get(targetIndex))) aliases.add(index);
  }

  const namedSchemas: Array<readonly [string, ComponentSchema]> = [];
  for (const [index, schema] of shared) if (!aliases.has(index)) namedSchemas.push([manifest.components![index].name, schema]);
  for (const [index, schema] of imported) if (!aliases.has(index)) namedSchemas.push([manifest.components![index].name, schema]);
  const target = manifest.source.kind === 'swagger-2.0' ? 'draft-4' : manifest.source.kind === 'openapi-3.0' ? 'openapi-3.0' : 'openapi-3.1';
  const referenceRoot = manifest.source.kind === 'swagger-2.0' ? '#/definitions/' : '#/components/schemas/';
  let converted: Record<string, Record<string, unknown>>;
  try { converted = zodSchemasToJsonSchema(namedSchemas, { target, $schema: false, onWarning: (warning) => warnings?.addRebased([warning], manifest.source.kind === 'swagger-2.0' ? '#/definitions' : '#/components/schemas') }, (name) => `${referenceRoot}${name.replace(/~/g, '~0').replace(/\//g, '~1')}`); }
  catch (error) { throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Unable to convert generated component files: ${error instanceof Error ? error.message : String(error)}`, { at: '#/components/schemas', cause: error }); }

  const schemas = new Map<number, unknown>();
  for (const [index] of imported) {
    const component = manifest.components![index];
    if (aliases.has(index)) schemas.set(index, component.schema);
    else {
      const schema = converted[component.name];
      if (!schema) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Unable to convert generated component file ${String(component.file)}`);
      const normalized = restoreSourceSchemaStructure(normalizeRuntimeSchema(schema, manifest.source.kind), component.schema);
      schemas.set(index, applySchemaOverlayList(normalized, component.overlay, 'component schema', component.schema, manifest.source.kind));
    }
  }
  const references: Array<readonly [string, ComponentSchema]> = [];
  for (const [index, schema] of shared) if (!aliases.has(index) && manifest.components![index].kind !== 'parameter' && manifest.components![index].kind !== 'response') references.push([manifest.components![index].name, schema]);
  return { schemas, references };
}

function componentRefTarget(schema: unknown): string | undefined {
  if (!isRecord(schema) || typeof schema.$ref !== 'string') return undefined;
  const prefix = schema.$ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : schema.$ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  if (!prefix) return undefined;
  const suffix = schema.$ref.slice(prefix.length);
  return suffix.includes('/') ? undefined : decodeJsonPointerSegment(suffix, schema.$ref);
}

function sourceSchemaGeneratesAny(schema: unknown, manifest: ZopiaManifest, seen = new Set<string>()): boolean {
  const target = componentRefTarget(schema);
  if (target !== undefined && isRecord(schema)) {
    const nonValidationKeys = new Set(['$ref', '$defs', 'definitions', '$schema', '$id', '$comment', 'title', 'description', 'examples', 'example', 'readOnly', 'writeOnly', 'deprecated', 'discriminator', 'xml', 'externalDocs']);
    if (Object.keys(schema).every((key) => nonValidationKeys.has(key) || key.startsWith('x-')) && !seen.has(target)) {
      const component = (manifest.components ?? []).find((entry) => entry.name === target);
      if (component !== undefined) return sourceSchemaGeneratesAny(component.schema, manifest, new Set(seen).add(target));
    }
    return false;
  }
  if (typeof schema !== 'boolean' && !isRecord(schema)) return false;
  try { return schemaKind(jsonSchemaToZod(schema as any).schema) === 'any'; }
  catch { return false; }
}

type OpenApiReverseVersion = '2.0' | '3.0' | '3.1';

function reverseVersion(options: ZopiaReverseOptions | undefined): OpenApiReverseVersion | undefined {
  if (options === undefined) return undefined;
  if (!isRecord(options)) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'reverse options must be an object', { at: 'options', hint: 'pass an options object or omit it' });
  const unknown = Object.keys(options).find((key) => key !== 'version' && key !== 'onWarning');
  if (unknown) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unknown reverse option: ${unknown}`, { at: unknown, hint: 'remove the unsupported option' });
  if (options.version !== undefined && options.version !== '2.0' && options.version !== '3.0' && options.version !== '3.1') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `reverse version must be '2.0', '3.0', or '3.1': ${String(options.version)}`, { at: 'version', hint: "use '2.0', '3.0', or '3.1'" });
  if (options.onWarning !== undefined && typeof options.onWarning !== 'function') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'reverse onWarning must be a function', { at: 'onWarning', hint: 'provide a warning callback or omit it' });
  return options.version;
}

function emitReverseWarnings(options: ZopiaReverseOptions | undefined, collector: ZopiaWarningCollector): ZopiaWarning[] {
  const warnings = collector.toArray();
  for (const warning of warnings) options?.onWarning?.(warning);
  return warnings;
}

function rewriteSchemaVersion(value: unknown, sourceKind: string, version: OpenApiReverseVersion): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteSchemaVersion(item, sourceKind, version));
  if (!isRecord(value)) return value;
  const literalKeywords = new Set(['const', 'default', 'enum', 'example', 'examples']);
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, literalKeywords.has(key) || key.startsWith('x-') ? child : rewriteSchemaVersion(child, sourceKind, version)])) as Record<string, any>;
  if (typeof result.$ref === 'string' && result.$ref.startsWith('#/definitions/')) result.$ref = `#/components/schemas/${result.$ref.slice('#/definitions/'.length)}`;
  if (result.type === 'file') { result.type = 'string'; result.format = 'binary'; }
  const nullable = result.nullable === true || result['x-nullable'] === true;
  delete result['x-nullable'];
  if (version === '3.1') {
    delete result.nullable;
    if (nullable) {
      if (typeof result.type === 'string') result.type = [result.type, 'null'];
      else if (Array.isArray(result.type) && !result.type.includes('null')) result.type = [...result.type, 'null'];
      else if (Array.isArray(result.anyOf)) {
        if (!result.anyOf.some((branch: unknown) => isRecord(branch) && branch.type === 'null')) result.anyOf = [...result.anyOf, { type: 'null' }];
      } else {
        const annotations = new Set(['title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly', 'examples']);
        const branch = Object.fromEntries(Object.entries(result).filter(([key]) => !annotations.has(key)));
        for (const key of Object.keys(result)) if (!annotations.has(key)) delete result[key];
        result.anyOf = [branch, { type: 'null' }];
      }
    }
    if ((sourceKind === 'swagger-2.0' || sourceKind === 'openapi-3.0') && typeof result.exclusiveMinimum === 'boolean') {
      if (result.exclusiveMinimum === true && typeof result.minimum === 'number') { result.exclusiveMinimum = result.minimum; delete result.minimum; }
      else delete result.exclusiveMinimum;
    }
    if ((sourceKind === 'swagger-2.0' || sourceKind === 'openapi-3.0') && typeof result.exclusiveMaximum === 'boolean') {
      if (result.exclusiveMaximum === true && typeof result.maximum === 'number') { result.exclusiveMaximum = result.maximum; delete result.maximum; }
      else delete result.exclusiveMaximum;
    }
  } else {
    const nullableKeyword = version === '2.0' ? 'x-nullable' : 'nullable';
    if (nullable) result[nullableKeyword] = true;
    if (result.type === 'null') { result.type = 'string'; result.enum = [null]; result[nullableKeyword] = true; }
    if (Array.isArray(result.type) && result.type.includes('null')) {
      const nonNull = result.type.filter((type: unknown) => type !== 'null');
      if (nonNull.length === 1) { result.type = nonNull[0]; result[nullableKeyword] = true; }
      else { delete result.type; result.anyOf = nonNull.map((type: unknown) => ({ type })); result[nullableKeyword] = true; }
    }
    if (Object.prototype.hasOwnProperty.call(result, 'const')) { result.enum = [result.const]; delete result.const; }
    if ((sourceKind === 'openapi-3.1' || version === '2.0') && typeof result.exclusiveMinimum === 'number') {
      const exclusive = result.exclusiveMinimum;
      if (typeof result.minimum !== 'number' || exclusive >= result.minimum) { result.minimum = exclusive; result.exclusiveMinimum = true; }
      else delete result.exclusiveMinimum;
    }
    if ((sourceKind === 'openapi-3.1' || version === '2.0') && typeof result.exclusiveMaximum === 'number') {
      const exclusive = result.exclusiveMaximum;
      if (typeof result.maximum !== 'number' || exclusive <= result.maximum) { result.maximum = exclusive; result.exclusiveMaximum = true; }
      else delete result.exclusiveMaximum;
    }
  }
  if (version === '2.0') {
    if (typeof result.$ref === 'string') {
      if (result.$ref.startsWith('#/components/schemas/')) result.$ref = `#/definitions/${result.$ref.slice('#/components/schemas/'.length)}`;
      else if (result.$ref.startsWith('#/components/parameters/')) result.$ref = `#/parameters/${result.$ref.slice('#/components/parameters/'.length)}`;
      else if (result.$ref.startsWith('#/components/responses/')) result.$ref = `#/responses/${result.$ref.slice('#/components/responses/'.length)}`;
      else if (result.$ref.startsWith('#/components/')) delete result.$ref;
    }
    if (Array.isArray(result.type) && !result.type.includes('null') && result.type.every((type: unknown) => typeof type === 'string')) {
      result.anyOf = result.type.map((type: unknown) => ({ type }));
      delete result.type;
    }
    if (Array.isArray(result.anyOf)) {
      const pruned = result.anyOf.filter((branch: unknown) => !(isRecord(branch) && branch.type === 'null' && Object.keys(branch).length === 1));
      if (pruned.length !== result.anyOf.length) {
        result['x-nullable'] = true;
        if (pruned.length === 0) delete result.anyOf;
        else if (pruned.length === 1 && isRecord(pruned[0]) && pruned[0].$ref === undefined) {
          const branch = pruned[0];
          delete result.anyOf;
          for (const key of Object.keys(result)) if (!['title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly', 'examples', 'x-nullable'].includes(key) && !key.startsWith('x-')) delete result[key];
          for (const [key, value] of Object.entries(branch)) if (!Object.prototype.hasOwnProperty.call(result, key)) result[key] = value;
        } else result.anyOf = pruned;
      }
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = result[keyword];
      if (!Array.isArray(branches) || branches.length !== 1) continue;
      const branch = branches[0];
      if (!isRecord(branch) || typeof branch.$ref !== 'string' || Object.keys(branch).length !== 1) continue;
      if (Object.keys(result).some((key) => key !== keyword && !['title', 'description', 'readOnly', 'writeOnly', 'deprecated', 'examples', 'x-nullable'].includes(key) && !key.startsWith('x-'))) continue;
      delete result[keyword];
      result.$ref = branch.$ref;
    }
    if (isRecord(result.$defs)) {
      result.definitions = { ...(isRecord(result.definitions) ? result.definitions : {}), ...result.$defs };
      delete result.$defs;
    }
    if (Array.isArray(result.prefixItems)) {
      const items = result.prefixItems;
      delete result.prefixItems;
      result.items = items;
      if (result.additionalItems === undefined && items.length > 0) result.additionalItems = true;
    }
    for (const key of ['$schema', '$id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$comment']) delete result[key];
  }
  return result;
}

function rewriteOperationSchemas(value: unknown, sourceKind: string, version: OpenApiReverseVersion): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteOperationSchemas(item, sourceKind, version));
  if (!isRecord(value)) return value;
  const literalKeys = new Set(['example', 'examples', 'externalValue', 'value']);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, literalKeys.has(key) || key.startsWith('x-') ? child : key === 'schema' ? rewriteSchemaVersion(child, sourceKind, version) : rewriteOperationSchemas(child, sourceKind, version)]));
}

const SWAGGER_SCHEMA_KEYS = new Set(['type', 'format', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'enum', 'default', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems']);

function swaggerInlineSchema(value: Record<string, any>, sourceKind: string, version: OpenApiReverseVersion): Record<string, any> {
  return rewriteSchemaVersion(Object.fromEntries(Object.entries(value).filter(([key]) => SWAGGER_SCHEMA_KEYS.has(key))), sourceKind, version) as Record<string, any>;
}

function swaggerParameterToOpenApi(parameter: Record<string, any>, version: OpenApiReverseVersion): Record<string, any> {
  if (typeof parameter.$ref === 'string' && parameter.$ref.startsWith('#/parameters/')) return { $ref: `#/components/parameters/${parameter.$ref.slice('#/parameters/'.length)}` };
  const metadata = Object.fromEntries(Object.entries(parameter).filter(([key]) => !SWAGGER_SCHEMA_KEYS.has(key) && key !== 'schema' && key !== 'collectionFormat'));
  return { ...metadata, schema: rewriteSchemaVersion(parameter.schema ?? swaggerInlineSchema(parameter, 'swagger-2.0', version), 'swagger-2.0', version) };
}

function swaggerPathsOverlayToOpenApi(pathsOverlay: Record<string, unknown> | undefined, version: OpenApiReverseVersion): Record<string, unknown> | undefined {
  if (pathsOverlay === undefined) return undefined;
  return Object.fromEntries(Object.entries(pathsOverlay).map(([path, metadata]) => {
    if (!isRecord(metadata) || !Array.isArray(metadata.parameters)) return [path, metadata];
    return [path, { ...metadata, parameters: metadata.parameters.map((parameter: unknown) => isRecord(parameter) ? swaggerParameterToOpenApi(parameter, version) : parameter) }];
  }));
}

function swaggerHeaderToOpenApi(header: unknown, version: OpenApiReverseVersion): unknown {
  if (!isRecord(header)) return header;
  const metadata = Object.fromEntries(Object.entries(header).filter(([key]) => !SWAGGER_SCHEMA_KEYS.has(key)));
  return { ...metadata, schema: swaggerInlineSchema(header, 'swagger-2.0', version) };
}

function swaggerResponseToOpenApi(response: unknown, contentTypes: string[], version: OpenApiReverseVersion): unknown {
  if (!isRecord(response)) return response;
  if (typeof response.$ref === 'string' && response.$ref.startsWith('#/responses/')) return { $ref: `#/components/responses/${response.$ref.slice('#/responses/'.length)}` };
  const headers = isRecord(response.headers) ? Object.fromEntries(Object.entries(response.headers).map(([name, header]) => [name, swaggerHeaderToOpenApi(header, version)])) : undefined;
  const examples = isRecord(response.examples) ? response.examples : {};
  const schema = response.schema === undefined ? undefined : rewriteSchemaVersion(response.schema, 'swagger-2.0', version);
  const mediaTypes = new Set<string>(Object.keys(examples));
  if (schema !== undefined) for (const contentType of contentTypes.length ? contentTypes : ['application/json']) mediaTypes.add(contentType);
  const content = schema === undefined && mediaTypes.size === 0 ? undefined : Object.fromEntries([...mediaTypes].map((type) => [type, { ...(Object.prototype.hasOwnProperty.call(examples, type) ? { example: examples[type] } : {}), ...(schema === undefined ? {} : { schema }) }]));
  return { ...Object.fromEntries(Object.entries(response).filter(([key]) => !['schema', 'examples', 'headers'].includes(key))), ...(headers === undefined ? {} : { headers }), ...(content === undefined ? {} : { content }) };
}

function swaggerSecuritySchemeToOpenApi(scheme: unknown): unknown {
  if (!isRecord(scheme)) return scheme;
  if (scheme.type === 'basic') return { type: 'http', scheme: 'basic', ...Object.fromEntries(Object.entries(scheme).filter(([key]) => !['type'].includes(key))) };
  if (scheme.type !== 'oauth2') return { ...scheme };
  const flow = scheme.flow === 'accessCode' ? 'authorizationCode' : scheme.flow === 'application' ? 'clientCredentials' : scheme.flow;
  const flowValue = { ...(scheme.authorizationUrl === undefined ? {} : { authorizationUrl: scheme.authorizationUrl }), ...(scheme.tokenUrl === undefined ? {} : { tokenUrl: scheme.tokenUrl }), scopes: isRecord(scheme.scopes) ? scheme.scopes : {} };
  return { type: 'oauth2', flows: { [flow]: flowValue }, ...Object.fromEntries(Object.entries(scheme).filter(([key]) => !['flow', 'authorizationUrl', 'tokenUrl', 'scopes'].includes(key))) };
}

const MANIFEST_REF_MAP_KEYS = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions', 'responses', 'content', 'headers', 'links', 'encoding', 'callbacks']);
function collectManifestRefs(value: unknown, at = '', mapEntries = false): Array<{ at: string; ref: string; component?: string }> {
  const refs: Array<{ at: string; ref: string; component?: string }> = [];
  if (Array.isArray(value)) value.forEach((child, index) => refs.push(...collectManifestRefs(child, `${at}/${index}`)));
  else if (isRecord(value)) for (const [key, child] of Object.entries(value)) {
    const location = `${at}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (mapEntries) refs.push(...collectManifestRefs(child, location));
    else if (['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-')) continue;
    else if (key === '$ref' && typeof child === 'string') refs.push({ at: location, ref: child, ...(componentRefTarget({ $ref: child }) ? { component: componentRefTarget({ $ref: child }) } : {}) });
    else refs.push(...collectManifestRefs(child, location, MANIFEST_REF_MAP_KEYS.has(key)));
  }
  return refs;
}

function swaggerOperationToOpenApi(operation: Record<string, any>, manifest: ZopiaManifest, version: OpenApiReverseVersion): Record<string, any> {
  const consumes = Array.isArray(operation.consumes) ? operation.consumes : manifest.swaggerConsumes ?? [];
  const produces = Array.isArray(operation.produces) ? operation.produces : manifest.swaggerProduces ?? [];
  const requestTypes = consumes.length ? consumes : ['application/json'];
  const responseTypes = produces.length ? produces : ['application/json'];
  const parameters = (Array.isArray(operation.parameters) ? operation.parameters : []).filter(isRecord).map((raw) => ({ raw, resolved: resolveParameter(raw, manifest) }));
  const body = parameters.find(({ resolved }) => resolved.in === 'body')?.resolved;
  const form = parameters.filter(({ resolved }) => resolved.in === 'formData').map(({ resolved }) => resolved);
  const ordinary = parameters.filter(({ resolved }) => resolved.in !== 'body' && resolved.in !== 'formData').map(({ raw, resolved }) => swaggerParameterToOpenApi(typeof raw.$ref === 'string' ? raw : resolved, version));
  let requestBody: Record<string, any> | undefined;
  if (body) {
    const schema = rewriteSchemaVersion(body.schema ?? {}, 'swagger-2.0', version);
    requestBody = { ...(body.description === undefined ? {} : { description: body.description }), required: body.required === true, content: Object.fromEntries(requestTypes.map((type) => [type, { schema }])) };
  }
  else if (form.length) {
    const properties = Object.fromEntries(form.map((parameter) => [parameter.name, rewriteSchemaVersion(parameter.type === 'file' ? { type: 'string', format: 'binary' } : swaggerInlineSchema(parameter, 'swagger-2.0', version), 'swagger-2.0', version)]));
    const required = form.filter((parameter) => parameter.required === true).map((parameter) => parameter.name);
    const schema = { type: 'object', properties, ...(required.length ? { required } : {}) };
    requestBody = { required: required.length > 0, content: Object.fromEntries(requestTypes.map((type) => [type, { schema }])) };
  }
  const responses = Object.fromEntries(Object.entries(operation.responses ?? {}).map(([status, response]) => [status, swaggerResponseToOpenApi(response, responseTypes, version)]));
  return { ...Object.fromEntries(Object.entries(operation).filter(([key]) => !['parameters', 'responses', 'consumes', 'produces', 'schemes'].includes(key))), ...(ordinary.length ? { parameters: ordinary } : {}), ...(requestBody === undefined ? {} : { requestBody }), responses };
}

const SWAGGER_REQUEST_FORM_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data']);

function openApiInlineConstraintsToSwagger(schema: Record<string, any>, sourceKind: string, at: string, warnings?: ZopiaWarningCollector): Record<string, any> {
  const rewritten = rewriteSchemaVersion(schema, sourceKind, '2.0') as Record<string, any>;
  const type = rewritten.type;
  if (rewritten.$ref !== undefined || !(type === undefined || type === 'string' || type === 'integer' || type === 'number' || type === 'boolean' || type === 'array') || Object.keys(rewritten).some((key) => ['allOf', 'anyOf', 'oneOf', 'not', 'properties', 'patternProperties', '$defs', 'definitions'].includes(key))) {
    warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/schema`, message: 'parameter/header constraint shapes beyond scalar swagger fields degrade to type string in OpenAPI 2.0 output' });
    return { type: 'string' };
  }
  const constraints = Object.fromEntries(Object.entries(rewritten).filter(([key]) => SWAGGER_SCHEMA_KEYS.has(key)));
  if (constraints.type === 'array' && !isRecord(constraints.items)) constraints.items = { type: 'string' };
  return constraints;
}

function openApiParameterToSwagger(parameter: unknown, sourceKind: string, at: string, warnings?: ZopiaWarningCollector): Record<string, any> | undefined {
  if (!isRecord(parameter)) return parameter as Record<string, any>;
  if (typeof parameter.$ref === 'string') {
    if (parameter.$ref.startsWith('#/components/parameters/')) return { $ref: `#/parameters/${parameter.$ref.slice('#/components/parameters/'.length)}` };
    return parameter as Record<string, any>;
  }
  if (parameter.in === 'cookie') {
    warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: 'cookie parameters are omitted because OpenAPI 2.0 cannot represent them' });
    return undefined;
  }
  const metadata = Object.fromEntries(Object.entries(parameter).filter(([key]) => !['schema', 'content', 'style', 'explode', 'example', 'examples'].includes(key)));
  let constraints: Record<string, any>;
  if (isRecord(parameter.schema)) constraints = openApiInlineConstraintsToSwagger(parameter.schema, sourceKind, at, warnings);
  else if (isRecord(parameter.content)) {
    const media = Object.keys(parameter.content)[0];
    const mediaValue = media === undefined ? undefined : parameter.content[media];
    constraints = openApiInlineConstraintsToSwagger(isRecord(mediaValue) && isRecord(mediaValue.schema) ? mediaValue.schema : {}, sourceKind, `${at}/content`, warnings);
  } else constraints = { type: 'string' };
  return { ...metadata, ...constraints };
}

function openApiResponseHeaderToSwagger(header: unknown, sourceKind: string, at: string, warnings?: ZopiaWarningCollector): Record<string, any> | undefined {
  if (!isRecord(header)) return undefined;
  if (typeof header.$ref === 'string') {
    warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: 'reusable header references are omitted because OpenAPI 2.0 headers cannot reference component objects' });
    return undefined;
  }
  const metadata = Object.fromEntries(Object.entries(header).filter(([key]) => !['schema', 'content', 'style', 'explode', 'example', 'examples'].includes(key)));
  const constraints = isRecord(header.schema) ? openApiInlineConstraintsToSwagger(header.schema, sourceKind, at, warnings) : { type: 'string' };
  return { ...metadata, ...constraints };
}

function openApiResponseToSwagger(response: unknown, sourceKind: string, at: string, warnings?: ZopiaWarningCollector): Record<string, any> {
  if (!isRecord(response)) return response as Record<string, any>;
  if (typeof response.$ref === 'string') {
    if (response.$ref.startsWith('#/components/responses/')) return { $ref: `#/responses/${response.$ref.slice('#/components/responses/'.length)}` };
    return response as Record<string, any>;
  }
  const content = isRecord(response.content) ? response.content : {};
  const contentTypes = Object.keys(content);
  const mediaType = contentTypes[0];
  const primaryMedia = mediaType === undefined ? undefined : content[mediaType];
  const schema = isRecord(primaryMedia) && primaryMedia.schema !== undefined ? rewriteSchemaVersion(primaryMedia.schema, sourceKind, '2.0') : undefined;
  if (contentTypes.length > 1) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/content`, message: 'additional response media types are reflected only through examples in OpenAPI 2.0 output' });
  const examples: Record<string, unknown> = {};
  for (const [type, mediaValue] of Object.entries(content)) {
    if (!isRecord(mediaValue)) continue;
    if (Object.prototype.hasOwnProperty.call(mediaValue, 'example')) examples[type] = mediaValue.example;
    else if (isRecord(mediaValue.examples)) {
      const name = Object.keys(mediaValue.examples)[0];
      const value = name === undefined ? undefined : mediaValue.examples[name];
      if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'value')) examples[type] = value.value;
    }
  }
  const headers = isRecord(response.headers)
    ? Object.fromEntries(Object.entries(response.headers).flatMap(([name, header]) => {
      const converted = openApiResponseHeaderToSwagger(header, sourceKind, `${at}/headers/${pointerToken(name)}`, warnings);
      return converted === undefined ? [] : [[name, converted]];
    }))
    : undefined;
  if (response.links !== undefined) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/links`, message: 'response links are omitted because OpenAPI 2.0 cannot represent them' });
  const metadata = Object.fromEntries(Object.entries(response).filter(([key]) => !['content', 'headers', 'links'].includes(key)));
  return {
    ...metadata,
    description: typeof response.description === 'string' ? response.description : '',
    ...(headers !== undefined ? { headers } : {}),
    ...(schema === undefined ? {} : { schema }),
    ...(Object.keys(examples).length ? { examples } : {}),
  };
}

function openApiOperationToSwagger(operation: Record<string, any>, manifest: ZopiaManifest, warnings?: ZopiaWarningCollector, operationAt?: string): Record<string, any> {
  const sourceKind = manifest.source.kind;
  const at = operationAt ?? '#';
  const requestBody = isRecord(operation.requestBody) ? operation.requestBody : undefined;
  const content = requestBody !== undefined && isRecord(requestBody.content) ? requestBody.content : {};
  const contentTypes = Object.keys(content);
  const mediaType = contentTypes[0];
  const formType = mediaType !== undefined && SWAGGER_REQUEST_FORM_TYPES.has(mediaType) ? mediaType : undefined;
  const parameters = (Array.isArray(operation.parameters) ? operation.parameters : [])
    .map((parameter, index) => openApiParameterToSwagger(parameter, sourceKind, `${at}/parameters/${index}`, warnings))
    .filter((parameter): parameter is Record<string, any> => parameter !== undefined);
  if (requestBody !== undefined) {
    if (formType !== undefined) {
      const mediaValue = content[formType];
      const schema = isRecord(mediaValue) && isRecord(mediaValue.schema) ? rewriteSchemaVersion(mediaValue.schema, sourceKind, '2.0') as Record<string, any> : {};
      if (schema.type === 'object' || isRecord(schema.properties)) {
        const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : []);
        const properties = isRecord(schema.properties) ? schema.properties : {};
        for (const [name, value] of Object.entries(properties)) {
          const constraints = isRecord(value) ? openApiInlineConstraintsToSwagger(value, sourceKind, `${at}/requestBody/content`, warnings) : { type: 'string' };
          parameters.push({ name, in: 'formData', ...(required.has(name) ? { required: true } : {}), ...constraints });
        }
      } else {
        warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/requestBody`, message: 'form request bodies without an object schema degrade to a body parameter in OpenAPI 2.0 output' });
        parameters.push({ name: 'body', in: 'body', ...(requestBody.required === true ? { required: true } : {}), schema: rewriteSchemaVersion(isRecord(mediaValue) && mediaValue.schema !== undefined ? mediaValue.schema : {}, sourceKind, '2.0') });
      }
    } else if (mediaType !== undefined) {
      if (contentTypes.length > 1) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/requestBody/content`, message: 'additional request body media types are reflected only through consumes in OpenAPI 2.0 output' });
      const mediaValue = content[mediaType];
      parameters.push({
        name: 'body',
        in: 'body',
        ...(requestBody.description === undefined ? {} : { description: requestBody.description }),
        ...(requestBody.required === true ? { required: true } : {}),
        schema: rewriteSchemaVersion(isRecord(mediaValue) && mediaValue.schema !== undefined ? mediaValue.schema : {}, sourceKind, '2.0'),
      });
    } else {
      warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/requestBody`, message: 'empty request bodies are omitted from OpenAPI 2.0 output' });
    }
  }
  const responses = Object.fromEntries((isRecord(operation.responses) ? Object.entries(operation.responses) : []).map(([status, response]) => [status, openApiResponseToSwagger(response, sourceKind, `${at}/responses/${pointerToken(status)}`, warnings)]));
  if (operation.callbacks !== undefined) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${at}/callbacks`, message: 'operation callbacks are omitted because OpenAPI 2.0 cannot represent them' });
  return { ...Object.fromEntries(Object.entries(operation).filter(([key]) => !['parameters', 'requestBody', 'responses', 'callbacks'].includes(key))), ...(parameters.length ? { parameters } : {}), responses };
}

function openApiSecuritySchemeToSwagger(scheme: unknown, at: string, warnings?: ZopiaWarningCollector): Record<string, any> | undefined {
  if (!isRecord(scheme)) return undefined;
  if (typeof scheme.$ref === 'string') {
    warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: 'security scheme references are omitted from OpenAPI 2.0 output' });
    return undefined;
  }
  if (scheme.type === 'basic') return { type: 'basic', ...Object.fromEntries(Object.entries(scheme).filter(([key]) => key !== 'type')) };
  if (scheme.type === 'http') {
    if (scheme.scheme === 'basic') return { type: 'basic', ...Object.fromEntries(Object.entries(scheme).filter(([key]) => !['type', 'scheme'].includes(key))) };
    if (scheme.scheme === 'bearer') { const { type: _type, scheme: _scheme, ...metadata } = scheme; return { type: 'apiKey', name: 'Authorization', in: 'header', ...metadata }; }
    warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: `http security scheme '${String(scheme.scheme)}' is omitted because OpenAPI 2.0 cannot represent it` });
    return undefined;
  }
  if (scheme.type === 'apiKey') return { ...scheme };
  if (scheme.type === 'oauth2' && isRecord(scheme.flows)) {
    const flowNames: Record<string, string> = { implicit: 'implicit', password: 'password', clientCredentials: 'application', authorizationCode: 'accessCode' };
    const names = Object.keys(scheme.flows).filter((name) => flowNames[name] !== undefined).sort((left, right) => flowNames[left] < flowNames[right] ? -1 : flowNames[left] > flowNames[right] ? 1 : 0);
    if (names.length === 0) { warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: 'oauth2 security scheme is omitted because no supported flow remains in OpenAPI 2.0 output' }); return undefined; }
    if (names.length > 1) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: 'additional oauth2 flows are omitted because OpenAPI 2.0 supports a single flow' });
    const flow = isRecord(scheme.flows[names[0]]) ? scheme.flows[names[0]] : {};
    return { type: 'oauth2', flow: flowNames[names[0]], ...(flow.authorizationUrl === undefined ? {} : { authorizationUrl: flow.authorizationUrl }), ...(flow.tokenUrl === undefined ? {} : { tokenUrl: flow.tokenUrl }), scopes: isRecord(flow.scopes) ? flow.scopes : {}, ...Object.fromEntries(Object.entries(scheme).filter(([key]) => !['type', 'flows'].includes(key))) };
  }
  warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at, message: `security scheme '${String(scheme.type)}' is omitted because OpenAPI 2.0 cannot represent it` });
  return undefined;
}

function rewriteOverlaysVersion(overlay: unknown, sourceKind: string, version: OpenApiReverseVersion): unknown {
  if (!Array.isArray(overlay)) return overlay;
  return overlay.map((entry) => {
    if (!isRecord(entry) || typeof entry.key === 'string') return entry;
    let set = isRecord(entry.set) ? rewriteSchemaVersion(entry.set, sourceKind, version) as Record<string, any> : undefined;
    if (set && version === '3.1' && sourceKind !== 'openapi-3.1' && (Object.prototype.hasOwnProperty.call(entry.set, 'nullable') || Object.prototype.hasOwnProperty.call(entry.set, 'x-nullable'))) {
      set = { ...set }; delete set.nullable; delete set['x-nullable']; delete set.anyOf;
    }
    return {
      ...entry,
      ...(set === undefined ? {} : { set }),
      ...(Object.prototype.hasOwnProperty.call(entry, 'node') ? { node: rewriteSchemaVersion(entry.node, sourceKind, version) } : {}),
    };
  });
}

function manifestToSwaggerDialect(manifest: ZopiaManifest, warnings?: ZopiaWarningCollector): ZopiaManifest {
  const sourceKind = manifest.source.kind;
  if ((manifest.webhooks?.length ?? 0) > 0 || manifest.documentOverlay?.webhooks !== undefined) warnings?.add({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'webhooks are omitted because OpenAPI 2.0 cannot represent them' });
  if (manifest.documentOverlay?.jsonSchemaDialect !== undefined) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/jsonSchemaDialect', message: 'jsonSchemaDialect is omitted from OpenAPI 2.0 output' });
  const sourceServers = manifest.servers ?? [];
  let host: string | undefined;
  let schemes: string[] | undefined;
  let basePath = '/';
  if (sourceServers.length > 0) {
    const first = sourceServers[0];
    const rawUrl = isRecord(first) && typeof first.url === 'string' ? first.url : typeof first === 'string' ? first : '/';
    if (sourceServers.length > 1) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/servers', message: 'only the first server entry is kept because OpenAPI 2.0 supports a single host/basePath anchor' });
    let urlText = rawUrl;
    const variables = isRecord(first) && isRecord(first.variables) ? first.variables : {};
    for (const [name, variable] of Object.entries(variables)) {
      const value = isRecord(variable) && typeof variable.default === 'string' ? variable.default : undefined;
      if (value !== undefined) urlText = urlText.split(`{${name}}`).join(value);
    }
    if (/\{[^{}]+\}/.test(urlText) || Object.keys(variables).length > 0) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/servers/0', message: 'server variables are substituted with defaults because OpenAPI 2.0 cannot represent them' });
    try {
      const parsed = new URL(urlText);
      schemes = [parsed.protocol.replace(/:$/, '')];
      host = parsed.host;
      basePath = parsed.pathname === '' ? '/' : parsed.pathname;
    } catch {
      schemes = undefined;
      host = undefined;
      basePath = urlText.startsWith('/') ? urlText : `/${urlText}`;
      if (urlText !== basePath) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/servers/0', message: 'relative server URLs become basePath values because OpenAPI 2.0 cannot represent protocol-relative anchors' });
    }
  }
  const documentOverlay = Object.fromEntries(Object.entries(manifest.documentOverlay ?? {}).filter(([key]) => key !== 'webhooks' && key !== 'jsonSchemaDialect'));
  const overlay = manifest.componentsOverlay ?? {};
  const dropComponentGroups = Object.keys(overlay).filter((key) => !['parameters', 'responses', 'requestBodies'].includes(key) && !key.startsWith('x-'));
  for (const key of dropComponentGroups) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `#/components/${pointerToken(key)}`, message: `components.${key} is omitted because OpenAPI 2.0 cannot represent it` });
  if (overlay.requestBodies !== undefined) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/components/requestBodies', message: 'components.requestBodies become body parameters in OpenAPI 2.0 output' });
  const swaggerParameters = {
    ...Object.fromEntries(Object.entries(isRecord(overlay.parameters) ? overlay.parameters : {}).flatMap(([name, parameter]) => {
      const converted = openApiParameterToSwagger(parameter, sourceKind, `#/components/parameters/${pointerToken(name)}`, warnings);
      return converted === undefined ? [] : [[name, converted]];
    })),
    ...Object.fromEntries(Object.entries(isRecord(overlay.requestBodies) ? overlay.requestBodies : {}).flatMap(([name, requestBody]) => {
      if (!isRecord(requestBody)) return [];
      const content = isRecord(requestBody.content) ? requestBody.content : {};
      const type = Object.keys(content)[0];
      const media = type === undefined ? undefined : content[type];
      return [[name, {
        name,
        in: 'body',
        ...(requestBody.description === undefined ? {} : { description: requestBody.description }),
        ...(requestBody.required === true ? { required: true } : {}),
        schema: rewriteSchemaVersion(isRecord(media) && media.schema !== undefined ? media.schema : {}, sourceKind, '2.0'),
      }]];
    })),
  };
  const swaggerResponses = Object.fromEntries(Object.entries(isRecord(overlay.responses) ? overlay.responses : {}).map(([name, response]) => [name, openApiResponseToSwagger(response, sourceKind, `#/components/responses/${pointerToken(name)}`, warnings)]));
  const apis = manifest.apis.map((api) => {
    const apiAt = `#/paths/${pointerToken(api.path)}/${api.method}`;
    const sourceOperation = api.sourceOperation === undefined ? undefined : openApiOperationToSwagger(api.sourceOperation, manifest, warnings, apiAt);
    const responseOverlay = sourceOperation === undefined ? api.responseOverlay : Object.entries(sourceOperation.responses ?? {}).flatMap(([status, response]) => isRecord(response) && response.headers !== undefined ? [{ status, headers: response.headers }] : []);
    return { ...api, sourceOperation, refs: sourceOperation === undefined ? api.refs : collectManifestRefs(sourceOperation), overlay: rewriteOverlaysVersion(api.overlay, sourceKind, '2.0'), responseOverlay };
  });
  const consumes = new Set<string>();
  const produces = new Set<string>();
  for (const api of manifest.apis) {
    const operation = isRecord(api.sourceOperation) ? api.sourceOperation : {};
    const requestContent = isRecord(operation.requestBody) && isRecord(operation.requestBody.content) ? operation.requestBody.content : {};
    for (const type of Object.keys(requestContent)) consumes.add(type);
    const responses = isRecord(operation.responses) ? operation.responses : {};
    for (const response of Object.values(responses)) if (isRecord(response) && isRecord(response.content)) for (const type of Object.keys(response.content)) produces.add(type);
  }
  const sortedConsumes = [...consumes].sort();
  const sortedProduces = [...produces].sort();
  const components = (manifest.components ?? []).flatMap((component) => {
    if (component.kind === 'parameter') {
      const converted = openApiParameterToSwagger(component.schema, sourceKind, `#/components/parameters/${pointerToken(component.name)}`, warnings);
      return converted === undefined ? [] : [{ ...component, schema: converted, overlay: rewriteOverlaysVersion(component.overlay, sourceKind, '2.0') }];
    }
    if (component.kind === 'response') return [{ ...component, schema: openApiResponseToSwagger(component.schema, sourceKind, `#/components/responses/${pointerToken(component.name)}`, warnings), overlay: rewriteOverlaysVersion(component.overlay, sourceKind, '2.0') }];
    return [{ ...component, schema: rewriteSchemaVersion(component.schema, sourceKind, '2.0'), overlay: rewriteOverlaysVersion(component.overlay, sourceKind, '2.0') }];
  });
  const securitySchemes = Object.fromEntries(Object.entries(manifest.securitySchemes ?? {}).flatMap(([name, scheme]) => {
    const converted = openApiSecuritySchemeToSwagger(scheme, `#/components/securitySchemes/${pointerToken(name)}`, warnings);
    return converted === undefined ? [] : [[name, converted]];
  }));
  const pathsOverlay = manifest.pathsOverlay === undefined ? undefined : Object.fromEntries(Object.entries(manifest.pathsOverlay).map(([path, metadata]) => {
    if (!isRecord(metadata)) return [path, metadata];
    const rewritten: Record<string, unknown> = { ...Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'parameters')) };
    if (Array.isArray(metadata.parameters)) {
      const parameters = metadata.parameters.map((parameter, index) => openApiParameterToSwagger(parameter, sourceKind, `#/paths/${pointerToken(path)}/parameters/${index}`, warnings)).filter((parameter): parameter is Record<string, any> => parameter !== undefined);
      if (parameters.length) rewritten.parameters = parameters;
    }
    return [path, Object.keys(rewritten).length ? rewritten : metadata];
  }));
  return {
    ...manifest,
    source: { ...manifest.source, kind: 'swagger-2.0', openapiVersion: '2.0' },
    documentOverlay,
    pathsOverlay,
    ...(host === undefined && basePath === '/' ? { servers: undefined } : { servers: [basePath] }),
    ...(host === undefined ? {} : { swaggerHost: host }),
    ...(schemes === undefined ? {} : { swaggerSchemes: schemes }),
    ...(sortedConsumes.length ? { swaggerConsumes: sortedConsumes } : { swaggerConsumes: ['application/json'] }),
    ...(sortedProduces.length ? { swaggerProduces: sortedProduces } : { swaggerProduces: ['application/json'] }),
    ...(Object.keys(swaggerParameters).length ? { swaggerParameters } : {}),
    ...(Object.keys(swaggerResponses).length ? { swaggerResponses } : {}),
    components,
    componentsOverlay: undefined,
    ...(Object.keys(securitySchemes).length ? { securitySchemes } : { securitySchemes: undefined }),
    apis,
    webhooks: undefined,
    webhookOrder: undefined,
    webhooksOverlay: undefined,
    dialectDowngraded: true,
  };
}

function manifestForOutputVersion(manifest: ZopiaManifest, version: OpenApiReverseVersion | undefined, warnings?: ZopiaWarningCollector): ZopiaManifest {
  if (version === undefined) return manifest;
  const sourceKind = manifest.source.kind;
  if (version === '2.0') return sourceKind === 'swagger-2.0' ? manifest : manifestToSwaggerDialect(manifest, warnings);
  if (version === '3.0' && sourceKind === 'openapi-3.1') {
    if ((manifest.webhooks?.length ?? 0) > 0 || manifest.documentOverlay?.webhooks !== undefined) warnings?.add({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'webhooks are omitted because OpenAPI 3.0 cannot represent them' });
    if (manifest.documentOverlay?.jsonSchemaDialect !== undefined) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/jsonSchemaDialect', message: 'jsonSchemaDialect is omitted from OpenAPI 3.0 output' });
    if (manifest.componentsOverlay?.pathItems !== undefined) warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/components/pathItems', message: 'components.pathItems is omitted from OpenAPI 3.0 output' });
  }
  const targetKind = version === '3.0' ? 'openapi-3.0' : 'openapi-3.1';
  const components = (manifest.components ?? []).map((component) => ({
    ...component,
    schema: rewriteSchemaVersion(component.schema, sourceKind, version),
    overlay: rewriteOverlaysVersion(component.overlay, sourceKind, version),
  }));
  const documentOverlay = version === '3.0' ? Object.fromEntries(Object.entries(manifest.documentOverlay ?? {}).filter(([key]) => key !== 'webhooks' && key !== 'jsonSchemaDialect')) : manifest.documentOverlay;
  if (sourceKind !== 'swagger-2.0') {
    const rewrittenComponents = manifest.componentsOverlay === undefined ? undefined : rewriteOperationSchemas(manifest.componentsOverlay, sourceKind, version) as Record<string, unknown>;
    const dropPathItemRefs = version === '3.0' && sourceKind === 'openapi-3.1' && isRecord(rewrittenComponents?.pathItems);
    const componentsOverlay = version === '3.0' && rewrittenComponents ? Object.fromEntries(Object.entries(rewrittenComponents).filter(([key]) => key !== 'pathItems')) : rewrittenComponents;
    const rewrittenPaths = manifest.pathsOverlay === undefined ? undefined : rewriteOperationSchemas(manifest.pathsOverlay, sourceKind, version) as Record<string, unknown>;
    const pathsOverlay = dropPathItemRefs && rewrittenPaths ? Object.fromEntries(Object.entries(rewrittenPaths).map(([path, metadata]) => [path, isRecord(metadata) ? Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== '$ref')) : metadata])) : rewrittenPaths;
    const dropWebhooks = version === '3.0' && sourceKind === 'openapi-3.1';
    return {
      ...manifest,
      source: { ...manifest.source, kind: targetKind, openapiVersion: `${version}.0` },
      documentOverlay,
      pathsOverlay,
      components,
      componentsOverlay,
      apis: manifest.apis.map((api) => ({
        ...api,
        ...(dropPathItemRefs && api.pathItemRef === true ? { pathItemRef: false } : {}),
        sourceOperation: api.sourceOperation === undefined ? undefined : rewriteOperationSchemas(api.sourceOperation, sourceKind, version) as Record<string, any>,
        overlay: rewriteOverlaysVersion(api.overlay, sourceKind, version),
      })),
      ...(dropWebhooks ? { webhooks: undefined, webhookOrder: undefined, webhooksOverlay: undefined } : {
        ...(manifest.webhooks === undefined ? {} : {
          webhooks: manifest.webhooks.map((webhook) => ({
            ...webhook,
            sourceOperation: webhook.sourceOperation === undefined ? undefined : rewriteOperationSchemas(webhook.sourceOperation, sourceKind, version) as Record<string, any>,
            overlay: rewriteOverlaysVersion(webhook.overlay, sourceKind, version),
          })),
        }),
        ...(manifest.webhooksOverlay === undefined ? {} : { webhooksOverlay: rewriteOperationSchemas(manifest.webhooksOverlay, sourceKind, version) as Record<string, unknown> }),
      }),
    };
  }
  const basePath = typeof manifest.servers?.[0] === 'string' ? manifest.servers[0] : '/';
  const host = manifest.swaggerHost;
  const schemes = manifest.swaggerSchemes?.length ? manifest.swaggerSchemes : ['https'];
  const servers = host ? schemes.map((scheme) => ({ url: `${scheme}://${host}${basePath === '/' ? '' : basePath}` })) : [{ url: basePath }];
  const reusableParameters = Object.fromEntries(Object.entries(manifest.swaggerParameters ?? {}).filter(([, parameter]) => !isRecord(parameter) || parameter.in !== 'body' && parameter.in !== 'formData').map(([name, parameter]) => [name, isRecord(parameter) ? swaggerParameterToOpenApi(parameter, version) : parameter]));
  const responseTypes = manifest.swaggerProduces?.length ? manifest.swaggerProduces : ['application/json'];
  const reusableResponses = Object.fromEntries(Object.entries(manifest.swaggerResponses ?? {}).map(([name, response]) => [name, swaggerResponseToOpenApi(response, responseTypes, version)]));
  const componentsOverlay = { ...(manifest.componentsOverlay ?? {}), ...(Object.keys(reusableParameters).length ? { parameters: reusableParameters } : {}), ...(Object.keys(reusableResponses).length ? { responses: reusableResponses } : {}) };
  const apis = manifest.apis.map((api) => {
    const sourceOperation = api.sourceOperation === undefined ? undefined : swaggerOperationToOpenApi(api.sourceOperation, manifest, version);
    const responseOverlay = sourceOperation === undefined ? api.responseOverlay : Object.entries(sourceOperation.responses ?? {}).flatMap(([status, response]) => isRecord(response) && response.headers !== undefined ? [{ status, headers: response.headers }] : []);
    return { ...api, sourceOperation, refs: sourceOperation === undefined ? api.refs : collectManifestRefs(sourceOperation), overlay: rewriteOverlaysVersion(api.overlay, sourceKind, version), responseOverlay };
  });
  return {
    ...manifest,
    source: { ...manifest.source, kind: targetKind, openapiVersion: `${version}.0` },
    documentOverlay,
    pathsOverlay: swaggerPathsOverlayToOpenApi(manifest.pathsOverlay, version),
    servers,
    components,
    componentsOverlay,
    securitySchemes: Object.fromEntries(Object.entries(manifest.securitySchemes ?? {}).map(([name, scheme]) => [name, swaggerSecuritySchemeToOpenApi(scheme)])),
    apis,
  };
}

function sweepSwaggerDowngradeDocument(document: Record<string, any>): void {
  const rewrite = (schema: unknown): unknown => rewriteSchemaVersion(schema, 'openapi-3.1', '2.0');
  const sweepParameter = (parameter: unknown): void => {
    if (!isRecord(parameter) || typeof parameter.$ref === 'string') return;
    if (parameter.schema !== undefined) parameter.schema = rewrite(parameter.schema);
  };
  const sweepResponses = (responses: unknown): void => {
    if (!isRecord(responses)) return;
    for (const response of Object.values(responses)) {
      if (!isRecord(response) || typeof response.$ref === 'string') continue;
      if (response.schema !== undefined) response.schema = rewrite(response.schema);
    }
  };
  if (isRecord(document.definitions)) for (const name of Object.keys(document.definitions)) document.definitions[name] = rewrite(document.definitions[name]);
  if (isRecord(document.paths)) for (const pathItem of Object.values(document.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const value of Object.values(pathItem)) {
      if (!isRecord(value)) continue;
      if (Array.isArray(value.parameters)) for (const parameter of value.parameters) sweepParameter(parameter);
      sweepResponses(value.responses);
    }
  }
  if (isRecord(document.parameters)) for (const parameter of Object.values(document.parameters)) sweepParameter(parameter);
  sweepResponses(isRecord(document.responses) ? document.responses : undefined);
}

async function manifestFileToOpenApiInternal(file: string, version: OpenApiReverseVersion | undefined, warnings: ZopiaWarningCollector): Promise<Record<string, unknown>> {
  if (typeof file !== 'string' || !file) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'manifest file path is required', { at: 'file', hint: 'provide the .zopia-manifest.json path' });
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (error) {
    if (isMissingFileError(error)) throw new ZopiaError('ZOPIA_DOCS_MISSING_MANIFEST', `manifest file not found: ${file}`, { at: file, hint: 'generate api docs first or pass the manifest path' });
    throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to read manifest file', { at: file, hint: 'check that the manifest is readable JSON' });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch (error) { throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'Invalid manifest file', { at: file, hint: 'fix the manifest JSON syntax or regenerate the tree' }); }
  const manifest = parsed as ZopiaManifest;
  reconstructOpenApi(manifest, undefined, undefined, undefined, warnings);
  const outputManifest = manifestForOutputVersion(manifest, version, warnings);
  const root = await realpath(dirname(resolve(file)));
  await validateManifestFiles(manifest, root);
  const modules = new Map<string, Record<string, unknown>>();
  const endpointConfigs = await importEndpointConfigs(outputManifest, root, modules);
  const webhookConfigs = await importWebhookConfigs(outputManifest, root, modules);
  const components = await importComponentSchemas(outputManifest, root, modules, warnings);
  const document = reconstructOpenApi(outputManifest, endpointConfigs, components.schemas, components.references, warnings, webhookConfigs);
  if (outputManifest.dialectDowngraded === true) sweepSwaggerDowngradeDocument(document);
  return document;
}

/**
 * Read a manifest, import its generated modules, and reconstruct the API document.
 *
 * @param file Filesystem path to a generated Zopia manifest.
 * @param options Target dialect and warning handling configuration.
 * @returns Reconstructed Swagger/OpenAPI document.
 * @throws {@link ZopiaError} when the manifest or a generated module is invalid.
 */
export async function manifestFileToOpenApi(file: string, options?: ZopiaReverseOptions): Promise<Record<string, unknown>> {
  try {
    const version = reverseVersion(options);
    const warnings = new ZopiaWarningCollector();
    const openapi = await manifestFileToOpenApiInternal(file, version, warnings);
    emitReverseWarnings(options, warnings);
    return openapi;
  } catch (error) {
    throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to reconstruct API from manifest', { at: typeof file === 'string' ? file : 'file' });
  }
}

/**
 * Reconstruct an API document from in-memory manifest snapshots without importing files.
 *
 * @param manifest Valid Zopia manifest containing source snapshots.
 * @param options Target dialect and warning handling configuration.
 * @returns Reconstructed Swagger/OpenAPI document.
 * @throws {@link ZopiaError} when the manifest or target version is invalid.
 */
export function manifestToOpenApi(manifest: ZopiaManifest, options?: ZopiaReverseOptions): Record<string, unknown> {
  try {
    const version = reverseVersion(options);
    const warnings = new ZopiaWarningCollector();
    const rewritten = manifestForOutputVersion(manifest, version, warnings);
    const openapi = reconstructOpenApi(rewritten, undefined, undefined, undefined, warnings);
    if (rewritten.dialectDowngraded === true) sweepSwaggerDowngradeDocument(openapi);
    emitReverseWarnings(options, warnings);
    return openapi;
  } catch (error) {
    throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to reconstruct API from manifest', { at: '#' });
  }
}

/**
 * Convert a generated api-docs directory or manifest path to OpenAPI.
 *
 * @param path Generated api-docs directory or manifest JSON path.
 * @param options Target dialect and warning handling configuration.
 * @returns Reconstructed document and deterministically ordered warnings.
 * @throws {@link ZopiaError} when the generated tree cannot be reconstructed.
 */
export async function apiDocsToOpenApi(path: string, options: ZopiaReverseOptions = {}): Promise<ZopiaReverseResult> {
  try { return await apiDocsToOpenApiInternal(path, options); }
  catch (error) { throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to reconstruct API from api-docs', { at: typeof path === 'string' ? path : 'path' }); }
}

async function apiDocsToOpenApiInternal(path: string, options: ZopiaReverseOptions): Promise<ZopiaReverseResult> {
  if (typeof path !== 'string' || !path) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'api-docs path is required', { at: 'path', hint: 'provide an api-docs directory or manifest path' });
  const version = reverseVersion(options) ?? '3.1';
  let manifestFile = path;
  try { if ((await stat(path)).isDirectory()) manifestFile = resolve(path, ZOPIA_MANIFEST_FILE); }
  catch (error) {
    if (!isMissingFileError(error)) throw asZopiaError(error, 'ZOPIA_MANIFEST_INVALID', 'unable to inspect api-docs path', { at: path, hint: 'check that the path is readable' });
    if (!path.toLowerCase().endsWith('.json')) manifestFile = resolve(path, ZOPIA_MANIFEST_FILE);
  }
  const warnings = new ZopiaWarningCollector();
  const openapi = await manifestFileToOpenApiInternal(manifestFile, version, warnings);
  const emitted = emitReverseWarnings(options, warnings);
  return { openapi, warnings: emitted };
}

function schemaKind(schema: ComponentSchema): unknown { return (schema as any)?._zod?.def?.type; }

function referenceUri(manifest: ZopiaManifest, name: string, kind?: "schema" | "parameter" | "response"): string {
  const root = kind === 'parameter' ? (manifest.source.kind === 'swagger-2.0' ? '#/parameters/' : '#/components/parameters/')
    : kind === 'response' ? (manifest.source.kind === 'swagger-2.0' ? '#/responses/' : '#/components/responses/')
      : manifest.source.kind === 'swagger-2.0' ? '#/definitions/' : '#/components/schemas/';
  return `${root}${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function convertRuntimeSchema(schema: unknown, io: 'input' | 'output', manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, context: string, warningAt: string, warnings?: ZopiaWarningCollector): Record<string, any> {
  if (!isComponentSchema(schema)) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint ${context} schema`);
  const direct = references.find(([, candidate]) => candidate === schema);
  if (direct) return { $ref: referenceUri(manifest, direct[0]) };
  let name = '__zopia_runtime_schema__';
  const names = new Set(references.map(([candidate]) => candidate));
  while (names.has(name)) name += '_';
  const target = manifest.source.kind === 'swagger-2.0' ? 'draft-4' : manifest.source.kind === 'openapi-3.0' ? 'openapi-3.0' : 'openapi-3.1';
  try {
    const runtimePointer = `#/${pointerToken(name)}`;
    const converted = zodSchemasToJsonSchema([...references, [name, schema]], { target, $schema: false, io, onWarning: (warning) => {
      if (warning.at === undefined) warnings?.addRebased([warning], warningAt);
      else if (warning.at === runtimePointer || warning.at.startsWith(`${runtimePointer}/`)) {
        const suffix = warning.at.slice(runtimePointer.length);
        warnings?.addRebased([{ ...warning, at: suffix ? `#${suffix}` : '#' }], warningAt);
      }
    } }, (component) => referenceUri(manifest, component));
    const result = converted[name];
    if (!result) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'schema conversion produced no output');
    return normalizeRuntimeSchema(result, manifest.source.kind);
  } catch (error) {
    throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Unable to convert generated endpoint ${context} schema: ${error instanceof Error ? error.message : String(error)}`, { at: warningAt, cause: error });
  }
}

function normalizeRuntimeSchema(value: Record<string, any>, outputKind?: string): Record<string, any> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const normalized = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      const variants = normalized[keyword];
      if (Array.isArray(variants) && variants.length > 0 && variants.every((variant) => isRecord(variant) && Object.prototype.hasOwnProperty.call(variant, 'const'))) {
        normalized.enum = variants.map((variant) => variant.const);
        delete normalized[keyword];
      }
    }
    if (Array.isArray(normalized.allOf) && normalized.allOf.length > 0 && normalized.allOf.every(isRecord)) {
      const branches = normalized.allOf as Record<string, unknown>[];
      const branchTypes = new Set(branches.map((branch) => branch.type).filter((type): type is string => typeof type === 'string'));
      const scalarType = branchTypes.size === 1 && ['string', 'number', 'integer', 'boolean', 'null'].includes([...branchTypes][0]);
      if (scalarType) {
        const merged: Record<string, unknown> = {};
        let compatible = true;
        for (const branch of branches) for (const [key, child] of Object.entries(branch)) {
          if (Object.prototype.hasOwnProperty.call(merged, key) && !sameSchema(merged[key], child)) { compatible = false; break; }
          merged[key] = child;
        }
        if (compatible) { delete normalized.allOf; Object.assign(normalized, merged); }
      }
    }
    if (outputKind === 'openapi-3.0' && Array.isArray(normalized.anyOf) && normalized.anyOf.length === 2) {
      const nullIndex = normalized.anyOf.findIndex((variant: unknown) => isRecord(variant) && (variant.type === 'null' || variant.nullable === true && Array.isArray(variant.enum) && variant.enum.length === 1 && variant.enum[0] === null));
      if (nullIndex >= 0) {
        const nonNull = normalized.anyOf[nullIndex === 0 ? 1 : 0];
        if (isRecord(nonNull)) {
          delete normalized.anyOf;
          if (typeof nonNull.$ref === 'string') {
            const { $ref, ...siblings } = nonNull;
            Object.assign(normalized, siblings, { allOf: [{ $ref }], nullable: true });
          } else Object.assign(normalized, nonNull, { nullable: true });
        }
      }
    }
    if (normalized.minimum === -9007199254740991) delete normalized.minimum;
    if (normalized.maximum === 9007199254740991) delete normalized.maximum;
    return normalized;
  };
  return visit(value) as Record<string, any>;
}

function manifestPointerTokens(pointer: unknown, kind: string): string[] {
  if (typeof pointer !== 'string' || pointer !== '' && !pointer.startsWith('/')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ${kind} pointer: ${String(pointer)}`);
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map((token) => decodeJsonPointerSegment(token, pointer));
}

function legacyPointerTokens(root: unknown, pointer: string): string[] | undefined {
  if (!pointer.startsWith('/')) return undefined;
  const parts = pointer.slice(1).split('/').map((token) => decodeJsonPointerSegment(token, pointer));
  const visit = (value: unknown, index: number): string[] | undefined => {
    if (index === parts.length) return [];
    if (Array.isArray(value)) {
      const token = parts[index];
      if (!/^(?:0|[1-9]\d*)$/.test(token) || Number(token) >= value.length) return undefined;
      const tail = visit(value[Number(token)], index + 1);
      return tail === undefined ? undefined : [token, ...tail];
    }
    if (!isRecord(value)) return undefined;
    for (let end = parts.length; end > index; end -= 1) {
      const key = parts.slice(index, end).join('/');
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const tail = visit(value[key], end);
      if (tail !== undefined) return [key, ...tail];
    }
    return undefined;
  };
  const tokens = visit(root, 0);
  if (tokens === undefined) return undefined;
  return tokens;
}

function pointerValue(root: unknown, tokens: string[]): unknown {
  let value = root;
  for (const token of tokens) {
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token) || Number(token) >= value.length) return undefined;
      value = value[Number(token)];
    } else if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, token)) value = value[token];
    else return undefined;
  }
  return value;
}

function setPointerValue(root: unknown, tokens: string[], value: unknown): boolean {
  if (tokens.length === 0) return false;
  const parent = pointerValue(root, tokens.slice(0, -1));
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= parent.length) return false;
    parent[Number(key)] = value;
    return true;
  }
  if (!isRecord(parent)) return false;
  Object.defineProperty(parent, key, { value, enumerable: true, configurable: true, writable: true });
  return true;
}

function pointerStartsWith(tokens: string[], prefix: string[]): boolean {
  return prefix.length <= tokens.length && prefix.every((token, index) => tokens[index] === token);
}

function applyManifestRefs(operation: Record<string, any>, sourceOperation: Record<string, any>, api: ZopiaManifest['apis'][number], manifest: ZopiaManifest): string[][] {
  if (api.refs === undefined) return [];
  if (!Array.isArray(api.refs)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest refs');
  const skipped: string[][] = [];
  for (const entry of api.refs) {
    if (!isRecord(entry)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest ref entry');
    let tokens = manifestPointerTokens(entry.at, 'ref');
    if (typeof entry.at === 'string' && pointerValue(sourceOperation, tokens) === undefined) tokens = legacyPointerTokens(sourceOperation, entry.at) ?? tokens;
    const ref = typeof entry.ref === 'string' && entry.ref
      ? entry.ref
      : typeof entry.component === 'string' && entry.component ? referenceUri(manifest, entry.component) : undefined;
    if (ref === undefined || ref !== '#' && !ref.startsWith('#/')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ref: ${String(entry.ref ?? entry.component)}`);
    if (ref.startsWith('#/')) manifestPointerTokens(ref.slice(1), 'ref target');
    const nodeTokens = tokens[tokens.length - 1] === '$ref' ? tokens.slice(0, -1) : tokens;
    if (nodeTokens.length === 0) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ref pointer: ${String(entry.at)}`);
    const runtimeNode = pointerValue(operation, nodeTokens);
    if (!isRecord(runtimeNode)) continue;
    if (typeof runtimeNode.$ref === 'string' && runtimeNode.$ref !== ref) { skipped.push(nodeTokens); continue; }
    const sourceNode = pointerValue(sourceOperation, nodeTokens);
    const replacement = isRecord(sourceNode) && sourceNode.$ref === ref ? { ...sourceNode } : { $ref: ref };
    setPointerValue(operation, nodeTokens, replacement);
  }
  return skipped;
}

function overlayMatchesEditableStructure(target: unknown, source: unknown, frozenNode = false, sourceKind?: string, io?: 'input' | 'output'): boolean {
  if (isRecord(source) && source.type === 'array' && Array.isArray(source.items)) {
    if (!isRecord(target)) return false;
    const generatedTuple = Array.isArray(target.prefixItems) ? target.prefixItems : Array.isArray(target.items) ? target.items : undefined;
    if (generatedTuple === undefined) return false;
    const restoredPrefix = restoreSourceSchemaStructure(JSON.parse(JSON.stringify(generatedTuple)), source.items);
    if (!sameSchema(restoredPrefix, source.items)) return false;
  }
  if (!frozenNode || !isRecord(source) || sourceKind === undefined) return true;
  const containsReference = (value: unknown): boolean => Array.isArray(value)
    ? value.some(containsReference)
    : isRecord(value) && (typeof value.$ref === 'string' || Object.entries(value).some(([key, child]) => !['example', 'examples', 'default', 'enum', 'const'].includes(key) && !key.startsWith('x-') && containsReference(child)));
  if (containsReference(source)) return true;
  try {
    const targetDialect = sourceKind === 'swagger-2.0' ? 'draft-4' : sourceKind === 'openapi-3.0' ? 'openapi-3.0' : 'openapi-3.1';
    const runtime = jsonSchemaToZod(source as any).schema;
    const baseline = zodSchemasToJsonSchema([['__zopia_overlay_baseline__', runtime]], { target: targetDialect, $schema: false, ...(io === undefined ? {} : { io }) }).__zopia_overlay_baseline__;
    if (!baseline) return true;
    return sameSchema(restoreSourceSchemaStructure(normalizeRuntimeSchema(baseline, sourceKind), source), target);
  } catch { return true; }
}

function applySchemaOverlayList(value: unknown, overlay: unknown, context: string, source?: unknown, sourceKind?: string): unknown {
  if (overlay === undefined) return value;
  if (!Array.isArray(overlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ${context} overlays`);
  let result = value;
  for (const entry of overlay) {
    if (!isRecord(entry) || typeof entry.at !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ${context} overlay entry`);
    const tokens = manifestPointerTokens(entry.at, `${context} overlay`);
    const overlayTarget = tokens.length === 0 ? result : pointerValue(result, tokens);
    const sourceTarget = tokens.length === 0 ? source : pointerValue(source, tokens);
    const hasNode = Object.prototype.hasOwnProperty.call(entry, 'node');
    if (!overlayMatchesEditableStructure(overlayTarget, sourceTarget, hasNode, sourceKind)) continue;
    if (entry.set !== undefined && !isRecord(entry.set)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ${context} overlay set`);
    if (entry.remove !== undefined && (!Array.isArray(entry.remove) || !entry.remove.every((key: unknown) => typeof key === 'string'))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ${context} overlay remove`);
    if (!hasNode && entry.set === undefined && entry.remove === undefined) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest ${context} overlay entry`);
    if (hasNode) {
      if (tokens.length === 0) result = entry.node;
      else setPointerValue(result, tokens, entry.node);
      continue;
    }
    const target = tokens.length === 0 ? result : pointerValue(result, tokens);
    if (!isRecord(target)) continue;
    for (const key of entry.remove ?? []) delete target[key];
    for (const [key, replacement] of Object.entries(entry.set ?? {})) Object.defineProperty(target, key, { value: replacement, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function applyManifestSchemaOverlays(operation: Record<string, any>, api: ZopiaManifest['apis'][number], skippedRefs: string[][], sourceKind: string): Record<string, any> {
  if (api.overlay === undefined) return operation;
  if (!Array.isArray(api.overlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest schema overlays');
  let result = operation;
  for (const entry of api.overlay) {
    if (!isRecord(entry)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest schema overlay entry');
    if (typeof entry.key === 'string' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
      if (!['callbacks', 'servers', 'externalDocs', 'links'].includes(entry.key)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest operation overlay key: ${entry.key}`);
      Object.defineProperty(result, entry.key, { value: entry.value, enumerable: true, configurable: true, writable: true });
      continue;
    }
    const tokens = manifestPointerTokens(entry.at, 'schema overlay');
    if (skippedRefs.some((prefix) => pointerStartsWith(tokens, prefix))) continue;
    const hasNode = Object.prototype.hasOwnProperty.call(entry, 'node');
    const io = tokens[0] === 'responses' ? 'output' : 'input';
    if (!overlayMatchesEditableStructure(pointerValue(result, tokens), pointerValue(api.sourceOperation, tokens), hasNode, sourceKind, io)) continue;
    if (entry.set !== undefined && !isRecord(entry.set)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest schema overlay set');
    if (entry.remove !== undefined && (!Array.isArray(entry.remove) || !entry.remove.every((key: unknown) => typeof key === 'string'))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest schema overlay remove');
    if (!hasNode && entry.set === undefined && entry.remove === undefined) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest schema overlay entry');
    if (hasNode) {
      if (tokens.length === 0) {
        if (!isRecord(entry.node)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest root schema overlay node');
        result = { ...entry.node };
      } else setPointerValue(result, tokens, entry.node);
      continue;
    }
    const target = pointerValue(result, tokens);
    if (!isRecord(target)) continue;
    for (const key of entry.remove ?? []) delete target[key];
    for (const [key, value] of Object.entries(entry.set ?? {})) Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function applyManifestResponseOverlays(operation: Record<string, any>, api: ZopiaManifest['apis'][number]): void {
  if (api.responseOverlay === undefined) return;
  const entries: Array<{ status: string; overlay: Record<string, any> }> = [];
  if (Array.isArray(api.responseOverlay)) {
    for (const entry of api.responseOverlay) {
      if (!isRecord(entry) || typeof entry.status !== 'string') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest response overlay entry');
      const overlay = isRecord(entry.response) ? entry.response : Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'status'));
      entries.push({ status: entry.status, overlay });
    }
  } else if (isRecord(api.responseOverlay)) {
    for (const [status, overlay] of Object.entries(api.responseOverlay)) {
      if (!isRecord(overlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest response overlay entry');
      entries.push({ status, overlay });
    }
  } else throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest response overlays');
  if (!isRecord(operation.responses)) return;
  for (const { status, overlay } of entries) {
    if (!Object.prototype.hasOwnProperty.call(operation.responses, status)) continue;
    const response = operation.responses[status];
    if (!isRecord(response)) continue;
    for (const [key, value] of Object.entries(overlay)) {
      if (key === '$ref' || key === 'schema' || key === 'content' || key === 'examples') continue;
      Object.defineProperty(response, key, { value, enumerable: true, configurable: true, writable: true });
    }
  }
}

function resolveParameter(parameter: Record<string, any>, manifest: ZopiaManifest, seen = new Set<string>()): Record<string, any> {
  if (typeof parameter.$ref !== 'string') return parameter;
  const openApiPrefix = '#/components/parameters/';
  const swaggerPrefix = '#/parameters/';
  const source = parameter.$ref.startsWith(openApiPrefix)
    ? (manifest.componentsOverlay as any)?.parameters?.[decodeJsonPointerSegment(parameter.$ref.slice(openApiPrefix.length), parameter.$ref)]
    : parameter.$ref.startsWith(swaggerPrefix) ? manifest.swaggerParameters?.[decodeJsonPointerSegment(parameter.$ref.slice(swaggerPrefix.length), parameter.$ref)] : undefined;
  if (!isRecord(source)) return parameter;
  const merged = { ...source, ...Object.fromEntries(Object.entries(parameter).filter(([key]) => key !== '$ref')) };
  // Declaration chains (`#/components/parameters/A` → `B` → concrete) resolve fully, with a cycle guard.
  if (typeof merged.$ref !== 'string' || seen.has(merged.$ref)) return merged;
  return resolveParameter(merged, manifest, new Set([...seen, parameter.$ref]));
}

function parameterIdentity(parameter: unknown, manifest: ZopiaManifest): string | undefined {
  if (!isRecord(parameter)) return undefined;
  const resolved = resolveParameter(parameter, manifest);
  return typeof resolved.name === 'string' && typeof resolved.in === 'string' ? `${resolved.in}\0${resolved.name}` : undefined;
}

function removeInheritedPathParameters(operation: Record<string, any>, sourceOperation: Record<string, any>, pathItem: Record<string, any> | undefined, manifest: ZopiaManifest): void {
  if (!pathItem || !Array.isArray(pathItem.parameters) || !Array.isArray(operation.parameters)) return;
  const inherited = new Set(pathItem.parameters.map((parameter: unknown) => parameterIdentity(parameter, manifest)).filter((identity): identity is string => identity !== undefined));
  const declared = new Set((Array.isArray(sourceOperation.parameters) ? sourceOperation.parameters : []).map((parameter: unknown) => parameterIdentity(parameter, manifest)).filter((identity): identity is string => identity !== undefined));
  operation.parameters = operation.parameters.filter((parameter: unknown) => {
    const identity = parameterIdentity(parameter, manifest);
    return identity === undefined || !inherited.has(identity) || declared.has(identity);
  });
  if (operation.parameters.length === 0) delete operation.parameters;
}

const SWAGGER_PARAMETER_SCHEMA_KEYS = new Set(['schema', 'content', 'type', 'format', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'enum', 'default', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems']);

function swaggerParameterShape(schema: unknown, previous: Record<string, any> = {}, context = 'parameter', downgrade?: { at: string; warnings?: ZopiaWarningCollector }): Record<string, unknown> {
  const shape = isRecord(schema) ? { ...schema } : {};
  if (previous.type === 'file' && shape.type === 'string') { shape.type = 'file'; delete shape.format; }
  if (!['string', 'number', 'integer', 'boolean', 'array', 'file'].includes(String(shape.type)) || Object.prototype.hasOwnProperty.call(shape, '$ref')) {
    if (downgrade !== undefined) {
      downgrade.warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: downgrade.at, message: `${context}s degrade to type string because OpenAPI 2.0 parameters cannot represent their schema shape` });
      return { type: 'string' };
    }
    throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Swagger 2.0 ${context} must serialize to a primitive, array, or file schema`);
  }
  return shape;
}

function serializeParameters(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, operationAt: string, warnings?: ZopiaWarningCollector): Record<string, any>[] {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const locations = [['path', 'params'], ['query', 'query'], ['header', 'headers'], ['cookie', 'cookies']] as const;
  const groups = new Map<string, { properties: Record<string, any>; required: Set<string> }>();
  for (const [location, field] of locations) {
    if (!isComponentSchema(config.request[field]) || schemaKind(config.request[field]) !== 'object') throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint ${location} parameters schema`);
    const schema = convertRuntimeSchema(config.request[field], 'input', manifest, references, `${location} parameters`, `${operationAt}/parameters/${location}`, warnings);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    groups.set(location, { properties, required: new Set(Array.isArray(schema.required) ? schema.required : []) });
  }
  if (isSwagger && Object.keys(groups.get('cookie')!.properties).length > 0) {
    if (manifest.dialectDowngraded === true) {
      warnings?.add({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: `${operationAt}/parameters`, message: 'cookie parameters are omitted because OpenAPI 2.0 cannot represent them' });
      groups.get('cookie')!.properties = {};
      groups.get('cookie')!.required = new Set();
    } else throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', 'Swagger 2.0 does not support cookie parameters');
  }
  const used = new Map<string, Set<string>>(locations.map(([location]) => [location, new Set()]));
  const parameters: Record<string, any>[] = [];
  for (const raw of Array.isArray(operation.parameters) ? operation.parameters : []) {
    if (!isRecord(raw)) continue;
    const parameter = resolveParameter(raw, manifest);
    if (parameter.in === 'body' || parameter.in === 'formData') continue;
    if (!['path', 'query', 'header', 'cookie'].includes(parameter.in) || typeof parameter.name !== 'string') { parameters.push(raw); continue; }
    const group = groups.get(parameter.in)!;
    if (!Object.prototype.hasOwnProperty.call(group.properties, parameter.name)) continue;
    let schema = group.properties[parameter.name];
    const sourceParameterSchema = isSwagger
      ? parameter
      : isRecord(parameter.content)
        ? (Object.values(parameter.content).find(isRecord) as Record<string, any> | undefined)?.schema
        : parameter.schema;
    schema = restoreSourceSchemaStructure(schema, sourceParameterSchema);
    used.get(parameter.in)!.add(parameter.name);
    const required = parameter.in === 'path' || group.required.has(parameter.name);
    const requiredField = required ? { required: true } : Object.prototype.hasOwnProperty.call(parameter, 'required') ? { required: false } : {};
    if (isSwagger) {
      const metadata = Object.fromEntries(Object.entries(parameter).filter(([key]) => !SWAGGER_PARAMETER_SCHEMA_KEYS.has(key) && key !== '$ref'));
      parameters.push({ ...metadata, name: parameter.name, in: parameter.in, ...requiredField, ...swaggerParameterShape(schema, parameter, `${parameter.in} parameter ${parameter.name}`, manifest.dialectDowngraded === true ? { at: `${operationAt}/parameters`, warnings } : undefined) });
    } else if (isRecord(parameter.content) && Object.keys(parameter.content).length) {
      const [contentType, media] = Object.entries(parameter.content)[0];
      const mediaValue = isRecord(media) ? media : {};
      const serializedMedia = !Object.prototype.hasOwnProperty.call(mediaValue, 'schema') && Object.keys(schema).length === 0 ? mediaValue : { ...mediaValue, schema };
      parameters.push({ ...parameter, name: parameter.name, in: parameter.in, ...requiredField, content: { ...parameter.content, [contentType]: serializedMedia } });
    } else parameters.push({ ...parameter, name: parameter.name, in: parameter.in, ...requiredField, schema });
  }
  for (const [location] of locations) {
    const group = groups.get(location)!;
    for (const [name, schema] of Object.entries(group.properties)) if (!used.get(location)!.has(name)) {
      if (isSwagger) parameters.push({ name, in: location, required: location === 'path' || group.required.has(name), ...swaggerParameterShape(schema, {}, `${location} parameter ${name}`, manifest.dialectDowngraded === true ? { at: `${operationAt}/parameters`, warnings } : undefined) });
      else parameters.push({ name, in: location, required: location === 'path' || group.required.has(name), schema });
    }
  }
  return parameters;
}

function validateReconstructedPathParameters(path: string, parameters: Record<string, any>[], code: ZopiaErrorCode, subject: string): void {
  const placeholders = new Set([...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]));
  const pathParameters = new Map(parameters
    .filter((parameter) => parameter.in === 'path' && typeof parameter.name === 'string')
    .map((parameter) => [parameter.name, parameter]));
  const missing = [...placeholders].find((name) => !pathParameters.has(name));
  if (missing) throw new ZopiaError(code, `${subject} path parameter is not defined: ${missing}`);
  const unrelated = [...pathParameters.keys()].find((name) => !placeholders.has(name));
  if (unrelated) throw new ZopiaError(code, `${subject} path parameter is not present in the template: ${unrelated}`);
  const optional = [...pathParameters.values()].find((parameter) => parameter.required !== true);
  if (optional) throw new ZopiaError(code, `${subject} path parameter must be required: ${optional.name}`);
}

function canonicalJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : child);
  } catch { return undefined; }
}

function sameSchema(left: unknown, right: unknown): boolean {
  const leftJson = canonicalJson(left);
  return leftJson !== undefined && leftJson === canonicalJson(right);
}

/** Restore source-only schema structure while leaving semantic developer edits authoritative. */
function restoreSourceSchemaStructure(generated: unknown, source: unknown): unknown {
  if (source === true && isRecord(generated) && Object.keys(generated).length === 0) return true;
  if (source === false && isRecord(generated) && isRecord(generated.not) && Object.keys(generated).length === 1 && Object.keys(generated.not).length === 0) return false;
  if (Array.isArray(generated)) {
    if (Array.isArray(source)) generated.forEach((child, index) => { generated[index] = restoreSourceSchemaStructure(child, source[index]); });
    return generated;
  }
  if (!isRecord(generated) || !isRecord(source)) return generated;
  if (Array.isArray(source.required) && source.required.every((key: unknown) => typeof key === 'string')) {
    const generatedRequired = Array.isArray(generated.required) && generated.required.every((key: unknown) => typeof key === 'string') ? generated.required as string[] : [];
    const sourceRequired = source.required as string[];
    const sortedGenerated = [...generatedRequired].sort();
    const sortedSource = [...sourceRequired].sort();
    if (sortedGenerated.length === sortedSource.length && sortedGenerated.every((key, index) => key === sortedSource[index])) {
      Object.defineProperty(generated, 'required', { value: [...sourceRequired], enumerable: true, configurable: true, writable: true });
    }
  }
  if (source.type === 'object') {
    const generatedAdditional = generated.additionalProperties;
    const generatedIsPassThrough = isRecord(generatedAdditional) && Object.keys(generatedAdditional).length === 0;
    if (!Object.prototype.hasOwnProperty.call(source, 'additionalProperties') && generatedIsPassThrough) delete generated.additionalProperties;
    else if (source.additionalProperties === true && generatedIsPassThrough) generated.additionalProperties = true;
    if (isRecord(source.properties) && Object.keys(source.properties).length === 0 && generated.properties === undefined) generated.properties = {};
  }
  for (const keyword of ['$defs', 'definitions'] as const) {
    if (!isRecord(source[keyword])) continue;
    if (!isRecord(generated[keyword])) generated[keyword] = {};
    for (const [name, definition] of Object.entries(source[keyword])) {
      if (!Object.prototype.hasOwnProperty.call(generated[keyword], name)) generated[keyword][name] = JSON.parse(JSON.stringify(definition));
    }
  }
  for (const [key, child] of Object.entries(generated)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) generated[key] = restoreSourceSchemaStructure(child, source[key]);
  }
  return generated;
}

function mediaExamples(media: Record<string, any>): Record<string, unknown> | undefined {
  if (isRecord(media.examples)) return media.examples;
  if (Object.prototype.hasOwnProperty.call(media, 'example')) return { default: { value: media.example } };
  return undefined;
}

function legacyResponseExamples(examples: unknown): Record<string, unknown> | undefined {
  return isRecord(examples) ? Object.fromEntries(Object.entries(examples).map(([contentType, value]) => [contentType, { value }])) : undefined;
}

function resolvedRequestBody(operation: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (!isRecord(operation.requestBody)) return {};
  if (typeof operation.requestBody.$ref !== 'string') return operation.requestBody;
  const prefix = '#/components/requestBodies/';
  const source = operation.requestBody.$ref.startsWith(prefix) ? (manifest.componentsOverlay as any)?.requestBodies?.[decodeJsonPointerSegment(operation.requestBody.$ref.slice(prefix.length), operation.requestBody.$ref)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(operation.requestBody).filter(([key]) => key !== '$ref')) } : {};
}

function serializeRequestBody(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, parameters: Record<string, any>[], operationAt: string, warnings?: ZopiaWarningCollector): void {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const body = config.request.body;
  if (!isComponentSchema(body)) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', 'Invalid generated endpoint body schema');
  const originalParameters = isSwagger && Array.isArray(operation.parameters) ? operation.parameters.filter(isRecord) : [];
  const sourceHasBody = isSwagger
    ? originalParameters.some((parameter) => ['body', 'formData'].includes(String(resolveParameter(parameter, manifest).in)))
    : isRecord(operation.requestBody);
  const previousRequestBody = isSwagger ? {} : resolvedRequestBody(operation, manifest);
  const sourceContent = isRecord(previousRequestBody.content) ? previousRequestBody.content : {};
  const sourceType = Object.keys(sourceContent)[0];
  const sourceMedia = sourceType !== undefined && isRecord(sourceContent[sourceType]) ? sourceContent[sourceType] : undefined;
  const swaggerBody = isSwagger ? originalParameters.map((parameter) => resolveParameter(parameter, manifest)).find((parameter) => parameter.in === 'body') : undefined;
  const sourceSchema = isSwagger ? swaggerBody?.schema : sourceMedia?.schema;
  if (schemaKind(body) === 'any') {
    if (!sourceHasBody) { delete operation.requestBody; operation.parameters = parameters; return; }
    if (!isSwagger && sourceMedia !== undefined && !Object.prototype.hasOwnProperty.call(sourceMedia, 'schema')) {
      operation.requestBody = previousRequestBody;
      operation.parameters = parameters;
      return;
    }
    if (!sourceSchemaGeneratesAny(sourceSchema, manifest)) { delete operation.requestBody; operation.parameters = parameters; return; }
  }
  const warningAt = manifest.source.kind === 'swagger-2.0' ? `${operationAt}/parameters/body/schema` : `${operationAt}/requestBody/schema`;
  const schema = restoreSourceSchemaStructure(convertRuntimeSchema(body, 'input', manifest, references, 'request body', warningAt, warnings), sourceSchema) as Record<string, any>;
  const contentType = typeof config.requestContentType === 'string' && config.requestContentType ? config.requestContentType : undefined;
  if (isSwagger) {
    const original = (Array.isArray(operation.parameters) ? operation.parameters : []).filter(isRecord);
    const form = original.filter((parameter) => parameter.in === 'formData');
    const baselineContentType = (Array.isArray(operation.consumes) ? operation.consumes[0] : undefined) ?? manifest.swaggerConsumes?.[0];
    const contentTypeEdited = contentType !== undefined && typeof baselineContentType === 'string' && contentType !== baselineContentType;
    const formContentType = contentType === 'multipart/form-data' || contentType === 'application/x-www-form-urlencoded';
    if (contentTypeEdited ? formContentType : form.length > 0 || formContentType) {
      const properties = isRecord((schema as any).properties) ? (schema as any).properties : {};
      const required = new Set(Array.isArray((schema as any).required) ? (schema as any).required : []);
      for (const [name, property] of Object.entries(properties)) {
        const previous = form.find((parameter) => parameter.name === name) ?? {};
        const metadata = Object.fromEntries(Object.entries(previous).filter(([key]) => !SWAGGER_PARAMETER_SCHEMA_KEYS.has(key)));
        const requiredField = required.has(name) ? { required: true } : Object.prototype.hasOwnProperty.call(previous, 'required') ? { required: false } : {};
        parameters.push({ ...metadata, name, in: 'formData', ...requiredField, ...swaggerParameterShape(property, previous, `formData parameter ${name}`, manifest.dialectDowngraded === true ? { at: `${operationAt}/parameters`, warnings } : undefined) });
      }
    } else {
      const previous = original.find((parameter) => parameter.in === 'body') ?? {};
      const requiredField = previous.required === true ? { required: true } : Object.prototype.hasOwnProperty.call(previous, 'required') ? { required: false } : {};
      parameters.push({ ...previous, name: typeof previous.name === 'string' ? previous.name : 'body', in: 'body', ...requiredField, schema });
    }
    operation.parameters = parameters;
    if (contentType && (Object.prototype.hasOwnProperty.call(operation, 'consumes') || contentTypeEdited)) {
      const retainedConsumes = Array.isArray(operation.consumes) ? operation.consumes.filter((value: unknown) => value !== contentType && (!contentTypeEdited || value !== baselineContentType)) : [];
      operation.consumes = [contentType, ...retainedConsumes];
    }
    return;
  }
  const previous = resolvedRequestBody(operation, manifest);
  const previousContent = isRecord(previous.content) ? previous.content : {};
  const previousType = Object.keys(previousContent)[0];
  const selectedType = contentType ?? previousType ?? 'application/json';
  const contentTypeEdited = contentType !== undefined && previousType !== undefined && contentType !== previousType;
  const primaryMedia = previousType !== undefined && isRecord(previousContent[previousType]) ? previousContent[previousType] : {};
  const retainedContent = Object.fromEntries(Object.entries(previousContent).filter(([type]) => !contentTypeEdited || type !== previousType).map(([type, media]) => [type, isRecord(media) && type !== selectedType && sameSchema(media.schema, primaryMedia.schema) ? { ...media, schema } : media]));
  const previousMedia = isRecord(previousContent[selectedType]) ? previousContent[selectedType] : {};
  const configuredExamples = isRecord(config.examples?.request) ? config.examples.request : undefined;
  const examplesUnchanged = sameSchema(configuredExamples, mediaExamples(previousMedia));
  const retainedMedia = examplesUnchanged ? previousMedia : Object.fromEntries(Object.entries(previousMedia).filter(([key]) => key !== 'example' && key !== 'examples'));
  const examples = !examplesUnchanged && configuredExamples !== undefined ? { examples: configuredExamples } : {};
  operation.requestBody = { ...previous, content: { ...retainedContent, [selectedType]: { ...retainedMedia, ...examples, schema } } };
  operation.parameters = parameters;
}

function resolveResponse(response: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (typeof response.$ref !== 'string') return response;
  const openApiPrefix = '#/components/responses/';
  const swaggerPrefix = '#/responses/';
  const source = response.$ref.startsWith(openApiPrefix)
    ? (manifest.componentsOverlay as any)?.responses?.[decodeJsonPointerSegment(response.$ref.slice(openApiPrefix.length), response.$ref)]
    : response.$ref.startsWith(swaggerPrefix) ? manifest.swaggerResponses?.[decodeJsonPointerSegment(response.$ref.slice(swaggerPrefix.length), response.$ref)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(response).filter(([key]) => key !== '$ref')) } : {};
}

function serializeResponses(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, operationAt: string, warnings?: ZopiaWarningCollector): void {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const original = isRecord(operation.responses) ? operation.responses : {};
  const responses: Record<string, any> = {};
  const contentType = typeof config.responseContentType === 'string' && config.responseContentType ? config.responseContentType : undefined;
  const baselineContentType = isSwagger
    ? (Array.isArray(operation.produces) ? operation.produces[0] : undefined) ?? manifest.swaggerProduces?.[0]
    : Object.values(original).map((value) => isRecord(value) && isRecord(value.content) ? Object.keys(value.content)[0] : undefined).find((value) => value !== undefined);
  const contentTypeEdited = contentType !== undefined && typeof baselineContentType === 'string' && contentType !== baselineContentType;
  if (Object.keys(config.response).length === 0) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', 'Generated endpoint must define at least one response');
  for (const [status, runtimeSchema] of Object.entries(config.response)) {
    if (!isValidResponseStatus(status, isSwagger)) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint response status: ${status}`);
    if (!isComponentSchema(runtimeSchema)) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint response schema: ${status}`);
    const previous = isRecord(original[status]) ? resolveResponse(original[status], manifest) : {};
    const response: Record<string, any> = { ...previous, description: typeof previous.description === 'string' && previous.description ? previous.description : 'Generated response' };
    const configuredExamples = config.examples?.response?.[status];
    if (isSwagger && !sameSchema(configuredExamples, legacyResponseExamples(previous.examples))) {
      if (isRecord(configuredExamples)) response.examples = Object.fromEntries(Object.entries(configuredExamples).map(([type, example]) => [type, isRecord(example) && Object.prototype.hasOwnProperty.call(example, 'value') ? example.value : example]));
      else delete response.examples;
    }
    if (schemaKind(runtimeSchema) === 'void') {
      const sourceContent = isRecord(previous.content) ? previous.content : undefined;
      const sourceType = sourceContent === undefined ? undefined : Object.keys(sourceContent)[0];
      const sourceMedia = sourceType === undefined || sourceContent === undefined ? undefined : sourceContent[sourceType];
      const sourceHadSchemaLessContent = sourceContent !== undefined && (sourceType === undefined || isRecord(sourceMedia) && !Object.prototype.hasOwnProperty.call(sourceMedia, 'schema'));
      if (!sourceHadSchemaLessContent) delete response.content;
      delete response.schema;
      responses[status] = response;
      continue;
    }
    const warningAt = manifest.source.kind === 'swagger-2.0' ? `${operationAt}/responses/${pointerToken(status)}/schema` : `${operationAt}/responses/${pointerToken(status)}/content/schema`;
    let schema: any = convertRuntimeSchema(runtimeSchema, 'output', manifest, references, `response ${status}`, warningAt, warnings);
    if (isSwagger) {
      schema = restoreSourceSchemaStructure(schema, previous.schema);
      response.schema = schema;
    } else {
      const previousContent = isRecord(previous.content) ? previous.content : {};
      const previousType = Object.keys(previousContent)[0];
      const selectedType = contentTypeEdited ? contentType! : previousType ?? contentType ?? 'application/json';
      const primaryMedia = previousType !== undefined && isRecord(previousContent[previousType]) ? previousContent[previousType] : {};
      const retainedContent = Object.fromEntries(Object.entries(previousContent).filter(([type]) => !contentTypeEdited || type !== previousType || previousType === selectedType).map(([type, media]) => [type, isRecord(media) && type !== selectedType && sameSchema(media.schema, primaryMedia.schema) ? { ...media, schema } : media]));
      const previousMedia = isRecord(previousContent[selectedType]) ? previousContent[selectedType] : {};
      schema = restoreSourceSchemaStructure(schema, previousMedia.schema);
      const examplesUnchanged = sameSchema(isRecord(configuredExamples) ? configuredExamples : undefined, mediaExamples(previousMedia));
      const retainedMedia = examplesUnchanged ? previousMedia : Object.fromEntries(Object.entries(previousMedia).filter(([key]) => key !== 'example' && key !== 'examples'));
      const runtimeExamples = !examplesUnchanged && isRecord(configuredExamples) ? { examples: configuredExamples } : {};
      response.content = { ...retainedContent, [selectedType]: { ...retainedMedia, ...runtimeExamples, schema } };
    }
    responses[status] = response;
  }
  operation.responses = responses;
  if (isSwagger && contentType && (Object.prototype.hasOwnProperty.call(operation, 'produces') || contentTypeEdited)) {
    const retainedProduces = Array.isArray(operation.produces) ? operation.produces.filter((value: unknown) => value !== contentType && (!contentTypeEdited || value !== baselineContentType)) : [];
    operation.produces = [contentType, ...retainedProduces];
  }
}

function runtimeOperation(api: ZopiaManifest['apis'][number], sourceOperation: Record<string, any>, pathItem: Record<string, any> | undefined, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, warnings?: ZopiaWarningCollector): { path: string; method: string; operation: Record<string, any> } {
  const method = config.method.toLowerCase();
  if (!HTTP_METHODS.has(method)) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint method: ${String(config.method)}`);
  let path: unknown;
  try { path = typeof config.makeOpenApiPathShape === 'function' ? config.makeOpenApiPathShape() : config.pathShape.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}'); }
  catch (error) { throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Unable to read generated endpoint path ${api.file}: ${error instanceof Error ? error.message : String(error)}`, { at: api.file, cause: error }); }
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#') || /[{}]/.test(path) && !/^\/([^{}]|\{[A-Za-z0-9._-]+\})*$/.test(path)) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint path: ${String(path)}`);
  if (config.operationId !== undefined && (typeof config.operationId !== 'string' || !config.operationId.trim())) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint operationId: ${String(config.operationId)}`);
  for (const field of ['summary', 'description'] as const) if (config[field] !== undefined && typeof config[field] !== 'string') throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint ${field}: ${String(config[field])}`);
  if (config.tags !== undefined && (!Array.isArray(config.tags) || !config.tags.every((tag: unknown) => typeof tag === 'string'))) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', 'Invalid generated endpoint tags');
  if (config.deprecated !== undefined && config.deprecated !== 'YES' && config.deprecated !== 'NO') throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint deprecated status: ${String(config.deprecated)}`);
  if (config.auth !== undefined && config.auth !== 'YES' && config.auth !== 'NO') throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint auth status: ${String(config.auth)}`);

  let operation = { ...sourceOperation };
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
  for (const field of ['requestContentType', 'responseContentType'] as const) if (config[field] !== undefined && (typeof config[field] !== 'string' || !config[field])) throw new ZopiaError('ZOPIA_DOCS_IMPORT_FAILED', `Invalid generated endpoint ${field}: ${String(config[field])}`);
  const operationAt = `#/paths/${pointerToken(path)}/${method}`;
  const parameters = serializeParameters(operation, config, manifest, references, operationAt, warnings);
  validateReconstructedPathParameters(path, parameters, 'ZOPIA_DOCS_IMPORT_FAILED', 'Generated endpoint');
  serializeRequestBody(operation, config, manifest, references, parameters, operationAt, warnings);
  serializeResponses(operation, config, manifest, references, operationAt, warnings);
  if (Array.isArray(operation.parameters) && operation.parameters.length === 0) delete operation.parameters;
  removeInheritedPathParameters(operation, sourceOperation, pathItem, manifest);
  const skippedRefs = applyManifestRefs(operation, sourceOperation, api, manifest);
  operation = applyManifestSchemaOverlays(operation, api, skippedRefs, manifest.source.kind);
  applyManifestResponseOverlays(operation, api);
  return { path, method, operation };
}

/** Refresh one reusable parameter/response declaration with the schema converted from its current module (D-18). */
function refreshReusableDeclaration(kind: 'parameter' | 'response', container: unknown, name: string, schema: unknown, downgrade?: { at: string; warnings?: ZopiaWarningCollector }): void {
  if (!isRecord(container)) return;
  const item = container[name];
  if (!isRecord(item) || schema === undefined) return;
  if (typeof item.$ref === 'string' && !Object.prototype.hasOwnProperty.call(item, 'schema') && !Object.prototype.hasOwnProperty.call(item, 'content')) return; // declaration chains stay verbatim; the chain end is refreshed
  const primaryMedia = isRecord(item.content) ? Object.entries(item.content).find(([, value]) => isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'schema')) : undefined;
  if (Object.prototype.hasOwnProperty.call(item, 'schema')) { item.schema = schema; return; }
  if (kind === 'response') {
    if (primaryMedia) item.content = { ...(item.content as Record<string, unknown>), [primaryMedia[0]]: { ...(primaryMedia[1] as Record<string, unknown>), schema } };
    return;
  }
  if (primaryMedia) { item.content = { ...(item.content as Record<string, unknown>), [primaryMedia[0]]: { ...(primaryMedia[1] as Record<string, unknown>), schema } }; return; }
  // Swagger 2.0 parameter shape: schema constraints live directly on the parameter object.
  if (!isRecord(schema)) return;
  const constraints = downgrade === undefined ? schema : openApiInlineConstraintsToSwagger(schema, 'openapi-3.1', downgrade.at, downgrade.warnings);
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) if (!SWAGGER_PARAMETER_SCHEMA_KEYS.has(key) && key !== 'schema' && key !== 'content') next[key] = value;
  for (const [key, value] of Object.entries(constraints)) next[key] = value;
  for (const key of Object.keys(item)) delete item[key];
  Object.assign(item, next);
}

function reconstructOpenApi(manifest: ZopiaManifest, endpointConfigs = new Map<number, EndpointConfig>(), componentSchemas = new Map<number, unknown>, componentReferences: Array<readonly [string, ComponentSchema]> = [], warnings?: ZopiaWarningCollector, webhookConfigs = new Map<number, EndpointConfig>()): Record<string, unknown> {
  if (!isRecord(manifest) || manifest.$schema !== ZOPIA_MANIFEST_SCHEMA || !isRecord(manifest.source) || !Array.isArray(manifest.apis)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid zopia manifest', { at: '#' });
  if (!['swagger-2.0', 'openapi-3.0', 'openapi-3.1'].includes(manifest.source.kind)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Unsupported manifest source kind: ${manifest.source.kind}`);
  if (manifest.source.openapiVersion !== undefined && (typeof manifest.source.openapiVersion !== 'string' || (manifest.source.kind === 'swagger-2.0' ? manifest.source.openapiVersion !== '2.0' : !/^3\.[01](?:\.\d+)?$/.test(manifest.source.openapiVersion)))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest OpenAPI version: ${String(manifest.source.openapiVersion)}`);
  if (manifest.source.title !== undefined && (typeof manifest.source.title !== 'string' || !manifest.source.title.trim()) || manifest.source.version !== undefined && (typeof manifest.source.version !== 'string' || !manifest.source.version.trim())) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest source title or version');
  const title = manifest.source.title ?? 'Zopia API';
  const sourceVersion = manifest.source.version ?? '0.0.0';
  if (manifest.source.title === undefined) warnings?.add({ code: 'ZOPIA_WARN_DEFAULT_INFO', at: '#/info/title', message: 'manifest source title is missing; using Zopia API' });
  if (manifest.source.version === undefined) warnings?.add({ code: 'ZOPIA_WARN_DEFAULT_INFO', at: '#/info/version', message: 'manifest source version is missing; using 0.0.0' });
  if (manifest.infoOverlay !== undefined && !isRecord(manifest.infoOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest infoOverlay');
  if (manifest.documentOverlay !== undefined && !isRecord(manifest.documentOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest documentOverlay');
  if (manifest.pathsOverlay !== undefined && (!isRecord(manifest.pathsOverlay) || Object.entries(manifest.pathsOverlay).some(([path, metadata]) => !path.startsWith('/') && !path.startsWith('x-') || path.startsWith('/') && (!isRecord(metadata) || Object.keys(metadata).some((key) => HTTP_METHODS.has(key)))))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest pathsOverlay');
  if (manifest.componentsOverlay !== undefined && !isRecord(manifest.componentsOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest componentsOverlay');
  if (manifest.swaggerParameters !== undefined && !isRecord(manifest.swaggerParameters)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest swaggerParameters');
  if (manifest.swaggerResponses !== undefined && !isRecord(manifest.swaggerResponses)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest swaggerResponses');
  if (manifest.components !== undefined && !Array.isArray(manifest.components)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest components');
  if (manifest.pathOrder !== undefined && (!Array.isArray(manifest.pathOrder) || manifest.pathOrder.some((path) => typeof path !== 'string' || !path.startsWith('/') && !path.startsWith('x-')) || new Set(manifest.pathOrder).size !== manifest.pathOrder.length)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest path order');
  if (manifest.schemaComponentsPresent !== undefined && typeof manifest.schemaComponentsPresent !== 'boolean') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest schema-component presence');
  const componentNames = new Set<string>();
  for (const component of manifest.components ?? []) {
    if (!isRecord(component) || component.kind !== undefined && component.kind !== 'schema' && component.kind !== 'parameter' && component.kind !== 'response' || typeof component.name !== 'string' || !component.name || !Object.prototype.hasOwnProperty.call(component, 'schema') || component.file !== undefined && component.file !== null && (typeof component.file !== 'string' || !component.file)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest component');
    const identity = `${component.kind === 'parameter' || component.kind === 'response' ? component.kind : 'schema'}:${component.name}`;
    if (componentNames.has(identity)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Duplicate manifest component: ${identity}`);
    componentNames.add(identity);
  }
  if (manifest.componentsOverlay && ('schemas' in manifest.componentsOverlay || 'securitySchemes' in manifest.componentsOverlay)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest componentsOverlay: schemas and securitySchemes are reserved');
  const reservedInfoKeys = new Set(['title', 'version', 'description']);
  const invalidInfoKey = Object.keys(manifest.infoOverlay ?? {}).find((key) => reservedInfoKeys.has(key));
  if (invalidInfoKey) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest infoOverlay key: ${invalidInfoKey}`);
  const allowedDocumentKey = (key: string): boolean => key === 'externalDocs' || key === 'webhooks' || key === 'jsonSchemaDialect' || key.startsWith('x-');
  const invalidDocumentKey = Object.keys(manifest.documentOverlay ?? {}).find((key) => !allowedDocumentKey(key));
  if (invalidDocumentKey) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest documentOverlay key: ${invalidDocumentKey}`);
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const document: Record<string, any> = isSwagger
    ? { swagger: '2.0', info: { title, version: sourceVersion, ...(manifest.source.description === undefined ? {} : { description: manifest.source.description }) }, paths: {} }
    : { openapi: manifest.source.openapiVersion ?? (manifest.source.kind === 'openapi-3.0' ? '3.0.0' : '3.1.0'), info: { title, version: sourceVersion, ...(manifest.source.description === undefined ? {} : { description: manifest.source.description }) }, paths: {} };
  const assignOverlay = (target: Record<string, unknown>, overlay: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(overlay)) Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  };
  if (manifest.infoOverlay) assignOverlay(document.info, manifest.infoOverlay);
  if (manifest.documentOverlay) assignOverlay(document, manifest.documentOverlay);
  const sourceApiPaths = new Set(manifest.apis.map((api) => isRecord(api) && typeof api.path === 'string' ? api.path : '').filter(Boolean));
  const operationOnlyPathPlaceholders = new Set<string>();
  for (const path of manifest.pathOrder ?? []) {
    const hasOverlay = manifest.pathsOverlay !== undefined && Object.prototype.hasOwnProperty.call(manifest.pathsOverlay, path);
    const metadata = hasOverlay ? manifest.pathsOverlay![path] : {};
    Object.defineProperty(document.paths, path, { value: metadata, enumerable: true, configurable: true, writable: true });
    if (!hasOverlay && sourceApiPaths.has(path)) operationOnlyPathPlaceholders.add(path);
  }
  if (manifest.pathsOverlay) for (const [path, metadata] of Object.entries(manifest.pathsOverlay)) if (!Object.prototype.hasOwnProperty.call(document.paths, path)) Object.defineProperty(document.paths, path, { value: metadata, enumerable: true, configurable: true, writable: true });
  if (manifest.servers !== undefined && !isSwagger) document.servers = manifest.servers;
  if (manifest.servers !== undefined && isSwagger && typeof manifest.servers[0] === 'string') document.basePath = manifest.servers[0];
  if (isSwagger) { if (manifest.swaggerHost !== undefined) document.host = manifest.swaggerHost; if (manifest.swaggerSchemes !== undefined) document.schemes = manifest.swaggerSchemes; if (manifest.swaggerConsumes !== undefined) document.consumes = manifest.swaggerConsumes; if (manifest.swaggerProduces !== undefined) document.produces = manifest.swaggerProduces; if (manifest.swaggerParameters !== undefined) document.parameters = manifest.swaggerParameters; if (manifest.swaggerResponses !== undefined) document.responses = manifest.swaggerResponses; }
  else if (manifest.componentsOverlay !== undefined) document.components = { ...manifest.componentsOverlay };
  if (manifest.tags !== undefined) document.tags = manifest.tags;
  if (manifest.securitySchemes !== undefined && (!isRecord(manifest.securitySchemes)
    || Object.entries(manifest.securitySchemes).some(([name, scheme]) => !name || !isRecord(scheme)))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest securitySchemes');
  let securitySchemes: Record<string, unknown> = { ...(manifest.securitySchemes ?? {}) };
  const writeSecuritySchemes = (): void => {
    if (isSwagger) document.securityDefinitions = securitySchemes;
    else document.components = { ...(document.components ?? {}), securitySchemes };
  };
  if (manifest.securitySchemes !== undefined) writeSecuritySchemes();
  const defaultSecurity = manifest.defaultSecurity === undefined
    ? undefined
    : normalizeSecurityRequirements(manifest.defaultSecurity, 'manifest defaultSecurity');
  if (defaultSecurity !== undefined) document.security = defaultSecurity;
  for (const [index, component] of (manifest.components ?? []).entries()) {
    if ((component.kind !== 'parameter' && component.kind !== 'response') || !componentSchemas.has(index)) continue;
    const container: unknown = isSwagger
      ? (component.kind === 'parameter' ? document.parameters : document.responses)
      : isRecord(document.components)
        ? document.components[component.kind === 'parameter' ? 'parameters' : 'responses']
        : undefined;
    refreshReusableDeclaration(component.kind, container, component.name, componentSchemas.get(index), manifest.dialectDowngraded === true ? { at: `#/${manifest.source.kind === 'swagger-2.0' ? '' : 'components/'}${component.kind === 'parameter' ? 'parameters' : 'responses'}/${pointerToken(component.name)}`, warnings } : undefined);
  }
  const schemas = Object.fromEntries((manifest.components ?? []).flatMap((component, index) => component.kind !== 'parameter' && component.kind !== 'response' ? [[component.name, componentSchemas.has(index) ? componentSchemas.get(index) : component.schema]] as const : []));
  const schemaComponentsPresent = manifest.schemaComponentsPresent ?? Object.keys(schemas).length > 0;
  if (schemaComponentsPresent) {
    if (isSwagger) document.definitions = schemas;
    else document.components = { ...(document.components ?? {}), schemas };
  }
  const operationIds = new Map<string, string>();
  const pathIndexes = new Map((manifest.pathOrder ?? []).map((path, index) => [path, index]));
  const methodIndexes = new Map([...HTTP_METHODS].map((method, index) => [method, index]));
  const apiEntries = [...manifest.apis.entries()].sort(([leftIndex, left], [rightIndex, right]) => {
    const leftPath = isRecord(left) && typeof left.path === 'string' ? pathIndexes.get(left.path) : undefined;
    const rightPath = isRecord(right) && typeof right.path === 'string' ? pathIndexes.get(right.path) : undefined;
    if (leftPath !== rightPath) return (leftPath ?? Number.MAX_SAFE_INTEGER) - (rightPath ?? Number.MAX_SAFE_INTEGER);
    const leftMethod = isRecord(left) && typeof left.method === 'string' ? methodIndexes.get(left.method) : undefined;
    const rightMethod = isRecord(right) && typeof right.method === 'string' ? methodIndexes.get(right.method) : undefined;
    if (leftMethod !== rightMethod) return (leftMethod ?? Number.MAX_SAFE_INTEGER) - (rightMethod ?? Number.MAX_SAFE_INTEGER);
    return leftIndex - rightIndex;
  });
  for (const [index, api] of apiEntries) {
    if (!isRecord(api) || typeof api.path !== 'string' || !api.path.startsWith('/') || api.path.includes('?') || api.path.includes('#') || typeof api.method !== 'string' || !HTTP_METHODS.has(api.method)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest API: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    if (api.sourceOperation !== undefined && !isRecord(api.sourceOperation)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest source operation: ${api.path} ${api.method}`);
    if (api.pathItemRef !== undefined && typeof api.pathItemRef !== 'boolean') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest path-item reference flag: ${api.path} ${api.method}`);
    const sourceOperation: Record<string, any> = api.sourceOperation ? { ...api.sourceOperation } : { operationId: api.operationId, responses: { default: { description: 'Generated from manifest' } } };
    const runtime = endpointConfigs.get(index);
    const sourcePathItem = isRecord(manifest.pathsOverlay?.[api.path]) ? manifest.pathsOverlay[api.path] as Record<string, any> : undefined;
    let reconstructed: { path: string; method: string; operation: Record<string, any> };
    try { reconstructed = runtime ? runtimeOperation(api, sourceOperation, sourcePathItem, runtime, manifest, componentReferences, warnings) : { path: api.path, method: api.method, operation: sourceOperation }; }
    catch (error) {
      if (error instanceof ZopiaError && error.at === undefined) {
        const message = error.message.slice(`${error.code}: `.length);
        throw new ZopiaError(error.code, message, { at: api.file ?? `#/apis/${index}`, hint: error.hint, cause: error.cause ?? error });
      }
      throw asZopiaError(error, 'ZOPIA_DOCS_IMPORT_FAILED', 'unable to reconstruct generated endpoint', { at: api.file ?? `#/apis/${index}` });
    }
    if (!runtime && api.pathItemRef !== true) {
      const pathParameters = sourcePathItem?.parameters;
      const operationParameters = reconstructed.operation.parameters;
      if ((pathParameters !== undefined && !Array.isArray(pathParameters)) || (operationParameters !== undefined && !Array.isArray(operationParameters))) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid reconstructed parameters: ${api.path} ${api.method}`);
      const rawParameters = [...(Array.isArray(pathParameters) ? pathParameters : []), ...(Array.isArray(operationParameters) ? operationParameters : [])];
      if (!rawParameters.every(isRecord)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid reconstructed parameters: ${api.path} ${api.method}`);
      validateReconstructedPathParameters(reconstructed.path, rawParameters.map((parameter) => resolveParameter(parameter, manifest)), 'ZOPIA_MANIFEST_INVALID', 'Manifest operation');
      const responses = reconstructed.operation.responses;
      if (!isRecord(responses) || Object.keys(responses).length === 0 || Object.entries(responses).some(([status, response]) => {
        if (!isValidResponseStatus(status, isSwagger) || !isRecord(response)) return true;
        const resolved = resolveResponse(response, manifest);
        return typeof resolved.description !== 'string' || !resolved.description.trim();
      })) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid reconstructed responses: ${api.path} ${api.method}`);
    }
    const operationId = reconstructed.operation.operationId;
    if (operationId !== undefined && (typeof operationId !== 'string' || !operationId.trim())) {
      throw new ZopiaError(runtime ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID', `Invalid reconstructed operationId: ${String(operationId)}`, { at: runtime ? api.file : `#/apis/${index}/sourceOperation/operationId` });
    }
    if (typeof operationId === 'string') {
      const previous = operationIds.get(operationId);
      if (previous !== undefined) throw new ZopiaError(runtime ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID', `Duplicate reconstructed operationId: ${operationId}`, { at: runtime ? api.file : `#/apis/${index}/sourceOperation/operationId` });
      operationIds.set(operationId, api.file ?? `#/apis/${index}`);
    }
    const operationSecurity = api.security === undefined
      ? undefined
      : normalizeSecurityRequirements(api.security, `manifest security for ${api.path} ${api.method}`);
    const legacyOperationSecurity = operationSecurity === undefined
      && Object.prototype.hasOwnProperty.call(sourceOperation, 'security')
      ? normalizeSecurityRequirements(sourceOperation.security, `legacy manifest security for ${api.path} ${api.method}`)
      : undefined;
    if (operationSecurity !== undefined) reconstructed.operation.security = operationSecurity;
    else if (legacyOperationSecurity !== undefined) reconstructed.operation.security = legacyOperationSecurity;
    else if (runtime?.auth === 'YES' && defaultSecurity === undefined) {
      const fallback = ensureFallbackSecurityScheme(securitySchemes, isSwagger);
      securitySchemes = fallback.schemes;
      writeSecuritySchemes();
      reconstructed.operation.security = [{ [fallback.name]: [] }];
      warnings?.add({
        code: 'ZOPIA_WARN_DEFAULT_SECURITY',
        at: `#/paths/${pointerToken(reconstructed.path)}/${reconstructed.method}/security`,
        message: `auth is YES but the manifest has no security requirement; using ${fallback.name}`,
      });
    }
    if (api.pathItemRef === true && reconstructed.path === api.path && reconstructed.method === api.method && sameSchema(reconstructed.operation, sourceOperation)) continue;
    const pathItem = Object.prototype.hasOwnProperty.call(document.paths, reconstructed.path) ? document.paths[reconstructed.path] : {};
    if (Object.prototype.hasOwnProperty.call(pathItem, reconstructed.method)) {
      throw new ZopiaError(runtime ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID', `${runtime ? 'Duplicate reconstructed endpoint' : 'Duplicate manifest API'}: ${reconstructed.path} ${reconstructed.method}`, { at: runtime ? api.file : `#/apis/${index}` });
    }
    Object.defineProperty(document.paths, reconstructed.path, { value: { ...pathItem, [reconstructed.method]: reconstructed.operation }, enumerable: true, configurable: true, writable: true });
  }
  for (const path of operationOnlyPathPlaceholders) if (isRecord(document.paths[path]) && Object.keys(document.paths[path]).length === 0) delete document.paths[path];
  const looseWebhooks = (manifest as ZopiaManifest & { webhooks?: unknown }).webhooks;
  if (looseWebhooks !== undefined && !Array.isArray(looseWebhooks)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest webhooks');
  const webhookEntries: Array<readonly [number, Record<string, any>]> = (Array.isArray(looseWebhooks) ? looseWebhooks : []).map((webhook, webhookIndex) => [webhookIndex, webhook] as const);
  const hasWebhookState = webhookEntries.length > 0
    || Array.isArray((manifest as { webhookOrder?: unknown }).webhookOrder) && ((manifest as { webhookOrder?: unknown }).webhookOrder as unknown[]).length > 0
    || isRecord((manifest as { webhooksOverlay?: unknown }).webhooksOverlay) && Object.keys((manifest as { webhooksOverlay?: Record<string, unknown> }).webhooksOverlay as Record<string, unknown>).length > 0;
  if (hasWebhookState) {
    if (manifest.source.kind !== 'openapi-3.1') throw new ZopiaError('ZOPIA_MANIFEST_INVALID', 'Invalid manifest webhooks for this source kind');
    document.webhooks = {} as Record<string, any>;
    const declaredOrder = Array.isArray((manifest as { webhookOrder?: unknown }).webhookOrder) ? ((manifest as { webhookOrder?: unknown }).webhookOrder as unknown[]).filter((name): name is string => typeof name === 'string' && name.length > 0) : [];
    const seenOrder = new Set<string>();
    const orderedNames = declaredOrder.filter((name) => { if (seenOrder.has(name)) return false; seenOrder.add(name); return true; });
    for (const name of [...new Set(webhookEntries.map(([, webhook]) => isRecord(webhook) ? String((webhook as any).name) : ''))]) if (name && !seenOrder.has(name)) { orderedNames.push(name); seenOrder.add(name); }
    const methodOrder = new Map(OPENAPI_METHODS.map((method, methodIndex) => [method, methodIndex]));
    const overlayItems = isRecord((manifest as { webhooksOverlay?: unknown }).webhooksOverlay) ? (manifest as { webhooksOverlay?: Record<string, unknown> }).webhooksOverlay as Record<string, unknown> : {};
    for (const name of orderedNames) {
      if (name.startsWith('x-')) {
        // Extension entries keep their verbatim value; an empty extension item (an x-
        // name present in the order but absent from the overlay) must still restore.
        document.webhooks[name] = isRecord(overlayItems[name])
          ? { ...(overlayItems[name] as Record<string, unknown>) }
          : overlayItems[name] ?? {};
        continue;
      }
      const entries = webhookEntries
        .filter(([, webhook]) => isRecord(webhook) && (webhook as any).name === name)
        .sort((left, right) => (methodOrder.get((left[1] as any).method) ?? 99) - (methodOrder.get((right[1] as any).method) ?? 99) || left[0] - right[0]);
      const item: Record<string, any> = isRecord(overlayItems[name]) ? { ...(overlayItems[name] as Record<string, any>) } : {};
      document.webhooks[name] = item;
      for (const [webhookIndex, webhook] of entries) {
        if (!isRecord(webhook) || typeof webhook.name !== 'string' || !webhook.name || typeof webhook.method !== 'string' || !HTTP_METHODS.has(webhook.method)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest webhook API: ${String((webhook as any)?.name)} ${String((webhook as any)?.method)}`);
        if (webhook.sourceOperation !== undefined && !isRecord(webhook.sourceOperation)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid manifest source operation: webhook ${webhook.name} ${webhook.method}`);
        const sourceOperation: Record<string, any> = webhook.sourceOperation ? { ...webhook.sourceOperation } : { operationId: webhook.operationId, responses: { default: { description: 'Generated from manifest' } } };
        const runtime = webhookConfigs.get(webhookIndex);
        const sourceWebhookItem = isRecord(overlayItems[name]) ? overlayItems[name] as Record<string, any> : undefined;
        // The runtime parity rule deletes `operationId` when it merely derivates from the
        // manifest value and the source operation never declared one; webhooks need the
        // derived identity to survive exactly like path operations do, so omit the hook.
        const { operationId: _webhookManifestOperationId, ...webhookWithoutManifestOperationId } = webhook;
        const apiView = { ...webhookWithoutManifestOperationId, path: webhookRuntimePath(webhook.name) } as unknown as ZopiaManifest['apis'][number];
        let reconstructed: { path: string; method: string; operation: Record<string, any> };
        try { reconstructed = runtime ? runtimeOperation(apiView, sourceOperation, sourceWebhookItem, runtime, manifest, componentReferences, warnings) : { path: apiView.path, method: webhook.method, operation: sourceOperation }; }
        catch (error) {
          if (error instanceof ZopiaError && error.at === undefined) {
            const message = error.message.slice(`${error.code}: `.length);
            throw new ZopiaError(error.code, message, { at: webhook.file ?? `#/webhooks/${webhookIndex}`, hint: error.hint, cause: error.cause ?? error });
          }
          throw asZopiaError(error, 'ZOPIA_DOCS_IMPORT_FAILED', 'unable to reconstruct generated webhook endpoint', { at: webhook.file ?? `#/webhooks/${webhookIndex}` });
        }
        const operationId = reconstructed.operation.operationId;
        if (operationId !== undefined && (typeof operationId !== 'string' || !operationId.trim())) {
          throw new ZopiaError(runtime ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID', `Invalid reconstructed operationId: ${String(operationId)}`, { at: runtime ? webhook.file : `#/webhooks/${webhookIndex}/sourceOperation/operationId` });
        }
        if (typeof operationId === 'string') {
          const previous = operationIds.get(operationId);
          if (previous !== undefined) throw new ZopiaError(runtime ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID', `Duplicate reconstructed operationId: ${operationId}`, { at: runtime ? webhook.file : `#/webhooks/${webhookIndex}/sourceOperation/operationId` });
          operationIds.set(operationId, webhook.file ?? `#/webhooks/${webhookIndex}`);
        }
        const webhookSecurity = webhook.security === undefined ? undefined : normalizeSecurityRequirements(webhook.security, `manifest security for webhook ${webhook.name} ${webhook.method}`);
        const legacyWebhookSecurity = webhookSecurity === undefined
          && Object.prototype.hasOwnProperty.call(sourceOperation, 'security')
          ? normalizeSecurityRequirements(sourceOperation.security, `legacy manifest security for webhook ${webhook.name} ${webhook.method}`)
          : undefined;
        if (webhookSecurity !== undefined) reconstructed.operation.security = webhookSecurity;
        else if (legacyWebhookSecurity !== undefined) reconstructed.operation.security = legacyWebhookSecurity;
        else if (runtime?.auth === 'YES' && defaultSecurity === undefined) {
          const fallback = ensureFallbackSecurityScheme(securitySchemes, isSwagger);
          securitySchemes = fallback.schemes;
          writeSecuritySchemes();
          reconstructed.operation.security = [{ [fallback.name]: [] }];
          warnings?.add({
            code: 'ZOPIA_WARN_DEFAULT_SECURITY',
            at: `#/webhooks/${pointerToken(webhook.name)}/${reconstructed.method}/security`,
            message: `auth is YES but the manifest has no security requirement; using ${fallback.name}`,
          });
        }
        if (webhook.webhookItemRef === true && reconstructed.method === webhook.method && sameSchema(reconstructed.operation, sourceOperation)) continue;
        if (Object.prototype.hasOwnProperty.call(item, webhook.method)) throw new ZopiaError(runtime ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID', `${runtime ? 'Duplicate reconstructed webhook endpoint' : 'Duplicate manifest webhook API'}: ${webhook.name} ${webhook.method}`, { at: runtime ? webhook.file : `#/webhooks/${webhookIndex}` });
        item[webhook.method] = reconstructed.operation;
      }
    }
  }
  try {
    for (const operation of buildOpenApiOperationIR(document)) extractOperationContracts(operation);
  } catch (error) {
    const code = endpointConfigs.size ? 'ZOPIA_DOCS_IMPORT_FAILED' : 'ZOPIA_MANIFEST_INVALID';
    const detail = error instanceof Error ? error.message.replace(/^ZOPIA_[A-Z_]+: /, '') : String(error);
    throw new ZopiaError(code, `Invalid reconstructed OpenAPI document: ${detail}`, { cause: error });
  }
  return document;
}
