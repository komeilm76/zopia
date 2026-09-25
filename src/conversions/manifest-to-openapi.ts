import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zodSchemasToJsonSchema, zodToJsonSchema } from './zod-to-json-schema';
import { decodeJsonPointerSegment } from './openapi-ref';

export interface ZopiaManifest { $schema?: string; source: { kind: string; title: string; version: string; description?: string }; infoOverlay?: Record<string, unknown>; documentOverlay?: Record<string, unknown>; componentsOverlay?: Record<string, unknown>; mode?: string; servers?: unknown[]; swaggerHost?: string; swaggerSchemes?: string[]; swaggerConsumes?: string[]; swaggerProduces?: string[]; swaggerParameters?: Record<string, unknown>; swaggerResponses?: Record<string, unknown>; tags?: unknown[]; securitySchemes?: Record<string, unknown>; defaultSecurity?: unknown[]; components?: Array<{ name: string; file?: string | null; schema: unknown }>; apis: Array<{ file?: string; path: string; method: string; operationId?: string; sourceOperation?: Record<string, any>; refs?: unknown; overlay?: unknown; responseOverlay?: unknown; security?: unknown[] }>; }

/** Options for selecting the OpenAPI dialect emitted by reverse conversion. */
export interface ZopiaReverseOptions {
  /** OpenAPI version to emit. Omit on low-level manifest helpers to preserve the source dialect. */
  version?: '3.0' | '3.1';
}

/** Result returned by the directory-level reverse-conversion API. */
export interface ZopiaReverseResult {
  /** Reconstructed OpenAPI document. */
  openapi: Record<string, unknown>;
  /** Non-fatal conversion warnings. */
  warnings: string[];
}

type EndpointConfig = Record<string, any>;
type ComponentSchema = Parameters<typeof zodToJsonSchema>[0];
interface ImportedComponents { schemas: Map<number, Record<string, unknown>>; references: Array<readonly [string, ComponentSchema]>; }

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'head', 'options', 'patch', 'trace']);

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

function codedTypeError(code: string, message: string): TypeError & { code: string } {
  const error = new TypeError(`${code}: ${message}`) as TypeError & { code: string };
  error.code = code;
  return error;
}

function manifestMismatch(message: string): TypeError & { code: string } {
  return codedTypeError('ZOPIA_DOCS_MANIFEST_MISMATCH', message);
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
    if (isAbsolute(file)) throw new TypeError(`Unsafe manifest ${manifestKind} file: ${file}`);
    const requested = resolve(root, file);
    if (!isFileWithinRoot(root, requested)) throw new TypeError(`Unsafe manifest ${manifestKind} file: ${file}`);
    let generatedFile: string;
    try { generatedFile = await realpath(requested); }
    catch (error) {
      if (isMissingFileError(error)) throw manifestMismatch(`generated ${kind} file is missing or renamed: ${file}`);
      throw new TypeError(`Unable to resolve generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isFileWithinRoot(root, generatedFile)) throw new TypeError(`Unsafe manifest ${manifestKind} file: ${file}`);
    let metadata;
    try { metadata = await stat(generatedFile); }
    catch (error) {
      if (isMissingFileError(error)) throw manifestMismatch(`generated ${kind} file is missing or renamed: ${file}`);
      throw new TypeError(`Unable to inspect generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!metadata.isFile()) throw manifestMismatch(`generated ${kind} file is missing or renamed: ${file}`);
  }
}

function isComponentSchema(value: unknown): value is ComponentSchema {
  return isRecord(value) && isRecord(value._zod) && typeof value._zod.run === 'function' && typeof value.parse === 'function';
}

function selectEndpointConfig(module: Record<string, unknown>, operationId: string | undefined, file: string): EndpointConfig {
  const candidates = [...new Set(Object.values(module).filter(isEndpointConfig))];
  const matching = operationId === undefined ? [] : candidates.filter((candidate) => candidate.operationId === operationId);
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) throw new TypeError(`Generated endpoint module exports multiple km-api configs for operationId ${operationId}: ${file}`);
  if (isEndpointConfig(module.default)) return module.default;
  if (candidates.length === 1) return candidates[0];
  throw new TypeError(`Generated endpoint module does not export a unique km-api config: ${file}`);
}

function selectComponentSchema(module: Record<string, unknown>, file: string): ComponentSchema {
  if (isComponentSchema(module.default)) return module.default;
  const candidates = [...new Set(Object.values(module).filter(isComponentSchema))];
  if (candidates.length === 1) return candidates[0];
  throw new TypeError(`Generated component module does not export a unique Zod schema: ${file}`);
}

async function importGeneratedModule(root: string, file: string, kind: 'endpoint' | 'component', modules: Map<string, Record<string, unknown>>, cacheBust = true): Promise<Record<string, unknown>> {
  const manifestKind = kind === 'endpoint' ? 'API' : 'component';
  if (isAbsolute(file)) throw new TypeError(`Unsafe manifest ${manifestKind} file: ${file}`);
  const requested = resolve(root, file);
  if (!isFileWithinRoot(root, requested)) throw new TypeError(`Unsafe manifest ${manifestKind} file: ${file}`);
  let generatedFile: string;
  try { generatedFile = await realpath(requested); }
  catch (error) { throw new TypeError(`Unable to resolve generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!isFileWithinRoot(root, generatedFile)) throw new TypeError(`Unsafe manifest ${manifestKind} file: ${file}`);
  const moduleKey = `${generatedFile}\0${cacheBust ? 'fresh' : 'shared'}`;
  let generatedModule = modules.get(moduleKey);
  if (!generatedModule) {
    try {
      const url = pathToFileURL(generatedFile);
      if (cacheBust) {
        const metadata = await stat(generatedFile);
        url.searchParams.set('zopia-reverse', `${metadata.mtimeMs}-${metadata.size}`);
      }
      const importUrl = url.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}').replace(/%7E/gi, '~');
      generatedModule = await import(importUrl) as Record<string, unknown>;
    } catch (error) { throw new TypeError(`Unable to import generated ${kind} file ${file}: ${error instanceof Error ? error.message : String(error)}`); }
    modules.set(moduleKey, generatedModule);
  }
  return generatedModule;
}

async function importEndpointConfigs(manifest: ZopiaManifest, root: string, modules: Map<string, Record<string, unknown>>): Promise<Map<number, EndpointConfig>> {
  const configs = new Map<number, EndpointConfig>();
  for (const [index, api] of manifest.apis.entries()) {
    if (!isRecord(api) || typeof api.file !== 'string' || !api.file) throw new TypeError(`Manifest API file is required: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    const endpointModule = await importGeneratedModule(root, api.file, 'endpoint', modules);
    configs.set(index, selectEndpointConfig(endpointModule, api.operationId, api.file));
  }
  return configs;
}

async function importComponentSchemas(manifest: ZopiaManifest, root: string, modules: Map<string, Record<string, unknown>>): Promise<ImportedComponents> {
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
  try { converted = zodSchemasToJsonSchema(namedSchemas, { target, $schema: false }, (name) => `${referenceRoot}${name.replace(/~/g, '~0').replace(/\//g, '~1')}`); }
  catch (error) { throw new TypeError(`Unable to convert generated component files: ${error instanceof Error ? error.message : String(error)}`); }

  const schemas = new Map<number, Record<string, unknown>>();
  for (const [index] of imported) {
    const component = manifest.components![index];
    if (aliases.has(index)) schemas.set(index, component.schema as Record<string, unknown>);
    else {
      const schema = converted[component.name];
      if (!schema) throw new TypeError(`Unable to convert generated component file ${String(component.file)}`);
      schemas.set(index, normalizeRuntimeSchema(schema, manifest.source.kind));
    }
  }
  const references: Array<readonly [string, ComponentSchema]> = [];
  for (const [index, schema] of shared) if (!aliases.has(index)) references.push([manifest.components![index].name, schema]);
  return { schemas, references };
}

function componentRefTarget(schema: unknown): string | undefined {
  if (!isRecord(schema) || typeof schema.$ref !== 'string') return undefined;
  const prefix = schema.$ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : schema.$ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  return prefix ? decodeJsonPointerSegment(schema.$ref.slice(prefix.length), schema.$ref) : undefined;
}

function reverseVersion(options: ZopiaReverseOptions | undefined): '3.0' | '3.1' | undefined {
  if (options === undefined) return undefined;
  if (!isRecord(options) || options.version !== undefined && options.version !== '3.0' && options.version !== '3.1') throw codedTypeError('ZOPIA_CONFIG_INVALID', `reverse version must be '3.0' or '3.1': ${String((options as any)?.version)}`);
  return options.version;
}

function rewriteSchemaVersion(value: unknown, sourceKind: string, version: '3.0' | '3.1'): unknown {
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
      else if (!Array.isArray(result.anyOf) || !result.anyOf.some((branch: unknown) => isRecord(branch) && branch.type === 'null')) result.anyOf = [...(Array.isArray(result.anyOf) ? result.anyOf : []), { type: 'null' }];
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
    if (nullable) result.nullable = true;
    if (Array.isArray(result.type) && result.type.includes('null')) {
      const nonNull = result.type.filter((type: unknown) => type !== 'null');
      if (nonNull.length === 1) { result.type = nonNull[0]; result.nullable = true; }
      else { delete result.type; result.anyOf = nonNull.map((type: unknown) => ({ type })); result.nullable = true; }
    }
    if (Object.prototype.hasOwnProperty.call(result, 'const')) { result.enum = [result.const]; delete result.const; }
    if (sourceKind === 'openapi-3.1' && typeof result.exclusiveMinimum === 'number') { result.minimum = result.exclusiveMinimum; result.exclusiveMinimum = true; }
    if (sourceKind === 'openapi-3.1' && typeof result.exclusiveMaximum === 'number') { result.maximum = result.exclusiveMaximum; result.exclusiveMaximum = true; }
  }
  return result;
}

function rewriteOperationSchemas(value: unknown, sourceKind: string, version: '3.0' | '3.1'): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteOperationSchemas(item, sourceKind, version));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'schema' ? rewriteSchemaVersion(child, sourceKind, version) : rewriteOperationSchemas(child, sourceKind, version)]));
}

const SWAGGER_SCHEMA_KEYS = new Set(['type', 'format', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'enum', 'default', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems']);

function swaggerInlineSchema(value: Record<string, any>, sourceKind: string, version: '3.0' | '3.1'): Record<string, any> {
  return rewriteSchemaVersion(Object.fromEntries(Object.entries(value).filter(([key]) => SWAGGER_SCHEMA_KEYS.has(key))), sourceKind, version) as Record<string, any>;
}

function swaggerParameterToOpenApi(parameter: Record<string, any>, version: '3.0' | '3.1'): Record<string, any> {
  if (typeof parameter.$ref === 'string' && parameter.$ref.startsWith('#/parameters/')) return { $ref: `#/components/parameters/${parameter.$ref.slice('#/parameters/'.length)}` };
  const metadata = Object.fromEntries(Object.entries(parameter).filter(([key]) => !SWAGGER_SCHEMA_KEYS.has(key) && key !== 'schema' && key !== 'collectionFormat'));
  return { ...metadata, schema: rewriteSchemaVersion(parameter.schema ?? swaggerInlineSchema(parameter, 'swagger-2.0', version), 'swagger-2.0', version) };
}

function swaggerHeaderToOpenApi(header: unknown, version: '3.0' | '3.1'): unknown {
  if (!isRecord(header)) return header;
  const metadata = Object.fromEntries(Object.entries(header).filter(([key]) => !SWAGGER_SCHEMA_KEYS.has(key)));
  return { ...metadata, schema: swaggerInlineSchema(header, 'swagger-2.0', version) };
}

function swaggerResponseToOpenApi(response: unknown, contentType: string, version: '3.0' | '3.1'): unknown {
  if (!isRecord(response)) return response;
  if (typeof response.$ref === 'string' && response.$ref.startsWith('#/responses/')) return { $ref: `#/components/responses/${response.$ref.slice('#/responses/'.length)}` };
  const headers = isRecord(response.headers) ? Object.fromEntries(Object.entries(response.headers).map(([name, header]) => [name, swaggerHeaderToOpenApi(header, version)])) : undefined;
  const examples = isRecord(response.examples) ? response.examples : {};
  const schema = response.schema === undefined ? undefined : rewriteSchemaVersion(response.schema, 'swagger-2.0', version);
  const mediaTypes = new Set<string>(Object.keys(examples));
  if (schema !== undefined) mediaTypes.add(contentType);
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

function collectManifestRefs(value: unknown, at = ''): Array<{ at: string; ref: string; component?: string }> {
  const refs: Array<{ at: string; ref: string; component?: string }> = [];
  if (Array.isArray(value)) value.forEach((child, index) => refs.push(...collectManifestRefs(child, `${at}/${index}`)));
  else if (isRecord(value)) for (const [key, child] of Object.entries(value)) {
    const location = `${at}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (key === '$ref' && typeof child === 'string') refs.push({ at: location, ref: child, ...(componentRefTarget({ $ref: child }) ? { component: componentRefTarget({ $ref: child }) } : {}) });
    else refs.push(...collectManifestRefs(child, location));
  }
  return refs;
}

function swaggerOperationToOpenApi(operation: Record<string, any>, manifest: ZopiaManifest, version: '3.0' | '3.1'): Record<string, any> {
  const consumes = Array.isArray(operation.consumes) ? operation.consumes : manifest.swaggerConsumes ?? [];
  const produces = Array.isArray(operation.produces) ? operation.produces : manifest.swaggerProduces ?? [];
  const requestType = consumes[0] ?? 'application/json';
  const responseType = produces[0] ?? 'application/json';
  const parameters = (Array.isArray(operation.parameters) ? operation.parameters : []).map((parameter: unknown) => isRecord(parameter) ? resolveParameter(parameter, manifest) : parameter).filter(isRecord);
  const body = parameters.find((parameter) => parameter.in === 'body');
  const form = parameters.filter((parameter) => parameter.in === 'formData');
  const ordinary = parameters.filter((parameter) => parameter.in !== 'body' && parameter.in !== 'formData').map((parameter) => swaggerParameterToOpenApi(parameter, version));
  let requestBody: Record<string, any> | undefined;
  if (body) requestBody = { ...(body.description === undefined ? {} : { description: body.description }), required: body.required === true, content: { [requestType]: { schema: rewriteSchemaVersion(body.schema ?? {}, 'swagger-2.0', version) } } };
  else if (form.length) {
    const properties = Object.fromEntries(form.map((parameter) => [parameter.name, rewriteSchemaVersion(parameter.type === 'file' ? { type: 'string', format: 'binary' } : swaggerInlineSchema(parameter, 'swagger-2.0', version), 'swagger-2.0', version)]));
    const required = form.filter((parameter) => parameter.required === true).map((parameter) => parameter.name);
    requestBody = { required: required.length > 0, content: { [requestType]: { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } } };
  }
  const responses = Object.fromEntries(Object.entries(operation.responses ?? {}).map(([status, response]) => [status, swaggerResponseToOpenApi(response, responseType, version)]));
  return { ...Object.fromEntries(Object.entries(operation).filter(([key]) => !['parameters', 'responses', 'consumes', 'produces', 'schemes'].includes(key))), ...(ordinary.length ? { parameters: ordinary } : {}), ...(requestBody === undefined ? {} : { requestBody }), responses };
}

function rewriteOverlaysVersion(overlay: unknown, sourceKind: string, version: '3.0' | '3.1'): unknown {
  if (!Array.isArray(overlay)) return overlay;
  return overlay.map((entry) => {
    if (!isRecord(entry) || typeof entry.key === 'string') return entry;
    let set = isRecord(entry.set) ? rewriteSchemaVersion(entry.set, sourceKind, version) as Record<string, any> : undefined;
    if (set && version === '3.1' && sourceKind !== 'openapi-3.1' && (entry.set.nullable === true || entry.set['x-nullable'] === true)) {
      set = { ...set }; delete set.nullable; delete set.anyOf;
    }
    return {
      ...entry,
      ...(set === undefined ? {} : { set }),
      ...(Object.prototype.hasOwnProperty.call(entry, 'node') ? { node: rewriteSchemaVersion(entry.node, sourceKind, version) } : {}),
    };
  });
}

function manifestForOutputVersion(manifest: ZopiaManifest, version: '3.0' | '3.1' | undefined): ZopiaManifest {
  if (version === undefined) return manifest;
  const sourceKind = manifest.source.kind;
  const targetKind = version === '3.0' ? 'openapi-3.0' : 'openapi-3.1';
  const components = (manifest.components ?? []).map((component) => ({ ...component, schema: rewriteSchemaVersion(component.schema, sourceKind, version) }));
  if (sourceKind !== 'swagger-2.0') return {
    ...manifest,
    source: { ...manifest.source, kind: targetKind },
    components,
    componentsOverlay: manifest.componentsOverlay === undefined ? undefined : rewriteOperationSchemas(manifest.componentsOverlay, sourceKind, version) as Record<string, unknown>,
    apis: manifest.apis.map((api) => ({
      ...api,
      sourceOperation: api.sourceOperation === undefined ? undefined : rewriteOperationSchemas(api.sourceOperation, sourceKind, version) as Record<string, any>,
      overlay: rewriteOverlaysVersion(api.overlay, sourceKind, version),
    })),
  };
  const basePath = typeof manifest.servers?.[0] === 'string' ? manifest.servers[0] : '/';
  const host = manifest.swaggerHost;
  const schemes = manifest.swaggerSchemes?.length ? manifest.swaggerSchemes : ['https'];
  const servers = host ? schemes.map((scheme) => ({ url: `${scheme}://${host}${basePath === '/' ? '' : basePath}` })) : [{ url: basePath }];
  const reusableParameters = Object.fromEntries(Object.entries(manifest.swaggerParameters ?? {}).filter(([, parameter]) => !isRecord(parameter) || parameter.in !== 'body' && parameter.in !== 'formData').map(([name, parameter]) => [name, isRecord(parameter) ? swaggerParameterToOpenApi(parameter, version) : parameter]));
  const responseType = manifest.swaggerProduces?.[0] ?? 'application/json';
  const reusableResponses = Object.fromEntries(Object.entries(manifest.swaggerResponses ?? {}).map(([name, response]) => [name, swaggerResponseToOpenApi(response, responseType, version)]));
  const componentsOverlay = { ...(manifest.componentsOverlay ?? {}), ...(Object.keys(reusableParameters).length ? { parameters: reusableParameters } : {}), ...(Object.keys(reusableResponses).length ? { responses: reusableResponses } : {}) };
  const apis = manifest.apis.map((api) => {
    const sourceOperation = api.sourceOperation === undefined ? undefined : swaggerOperationToOpenApi(api.sourceOperation, manifest, version);
    const responseOverlay = sourceOperation === undefined ? api.responseOverlay : Object.entries(sourceOperation.responses ?? {}).flatMap(([status, response]) => isRecord(response) && response.headers !== undefined ? [{ status, headers: response.headers }] : []);
    return { ...api, sourceOperation, refs: sourceOperation === undefined ? api.refs : collectManifestRefs(sourceOperation), overlay: rewriteOverlaysVersion(api.overlay, sourceKind, version), responseOverlay };
  });
  return {
    ...manifest,
    source: { ...manifest.source, kind: targetKind },
    servers,
    components,
    componentsOverlay,
    securitySchemes: Object.fromEntries(Object.entries(manifest.securitySchemes ?? {}).map(([name, scheme]) => [name, swaggerSecuritySchemeToOpenApi(scheme)])),
    apis,
  };
}

/** Read a manifest, import its generated endpoint and component modules, and reconstruct the API document. */
export async function manifestFileToOpenApi(file: string, options?: ZopiaReverseOptions): Promise<Record<string, unknown>> {
  if (typeof file !== 'string' || !file) throw new TypeError('Manifest file path is required');
  const version = reverseVersion(options);
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (error) {
    if (isMissingFileError(error)) throw codedTypeError('ZOPIA_DOCS_MISSING_MANIFEST', `manifest file not found: ${file}`);
    throw new TypeError(`Invalid manifest file: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch (error) { throw new TypeError(`Invalid manifest file: ${error instanceof Error ? error.message : String(error)}`); }
  const manifest = parsed as ZopiaManifest;
  reconstructOpenApi(manifest);
  const outputManifest = manifestForOutputVersion(manifest, version);
  const root = await realpath(dirname(resolve(file)));
  await validateManifestFiles(manifest, root);
  const modules = new Map<string, Record<string, unknown>>();
  const endpointConfigs = await importEndpointConfigs(outputManifest, root, modules);
  const components = await importComponentSchemas(outputManifest, root, modules);
  return reconstructOpenApi(outputManifest, endpointConfigs, components.schemas, components.references);
}

/** Reconstruct an API document from in-memory manifest snapshots without importing generated files. */
export function manifestToOpenApi(manifest: ZopiaManifest, options?: ZopiaReverseOptions): Record<string, unknown> {
  return reconstructOpenApi(manifestForOutputVersion(manifest, reverseVersion(options)));
}

/** Convert a generated api-docs directory (or manifest path) to OpenAPI. */
export async function apiDocsToOpenApi(path: string, options: ZopiaReverseOptions = {}): Promise<ZopiaReverseResult> {
  if (typeof path !== 'string' || !path) throw new TypeError('API docs path is required');
  const version = reverseVersion(options) ?? '3.1';
  let manifestFile = path;
  try { if ((await stat(path)).isDirectory()) manifestFile = resolve(path, '.zopia-manifest.json'); }
  catch (error) {
    if (!isMissingFileError(error)) throw error;
    if (!path.toLowerCase().endsWith('.json')) manifestFile = resolve(path, '.zopia-manifest.json');
  }
  return { openapi: await manifestFileToOpenApi(manifestFile, { version }), warnings: [] };
}

function schemaKind(schema: ComponentSchema): unknown { return (schema as any)?._zod?.def?.type; }

function referenceUri(manifest: ZopiaManifest, name: string): string {
  const root = manifest.source.kind === 'swagger-2.0' ? '#/definitions/' : '#/components/schemas/';
  return `${root}${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function convertRuntimeSchema(schema: unknown, io: 'input' | 'output', manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, context: string): Record<string, any> {
  if (!isComponentSchema(schema)) throw new TypeError(`Invalid generated endpoint ${context} schema`);
  const direct = references.find(([, candidate]) => candidate === schema);
  if (direct) return { $ref: referenceUri(manifest, direct[0]) };
  let name = '__zopia_runtime_schema__';
  const names = new Set(references.map(([candidate]) => candidate));
  while (names.has(name)) name += '_';
  const target = manifest.source.kind === 'swagger-2.0' ? 'draft-4' : manifest.source.kind === 'openapi-3.0' ? 'openapi-3.0' : 'openapi-3.1';
  try {
    const converted = zodSchemasToJsonSchema([...references, [name, schema]], { target, $schema: false, io }, (component) => referenceUri(manifest, component));
    const result = converted[name];
    if (!result) throw new TypeError('schema conversion produced no output');
    return normalizeRuntimeSchema(result, manifest.source.kind);
  } catch (error) {
    throw new TypeError(`Unable to convert generated endpoint ${context} schema: ${error instanceof Error ? error.message : String(error)}`);
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
    if (outputKind === 'openapi-3.0' && Array.isArray(normalized.anyOf) && normalized.anyOf.length === 2) {
      const nullIndex = normalized.anyOf.findIndex((variant: unknown) => isRecord(variant) && (variant.type === 'null' || variant.nullable === true && Array.isArray(variant.enum) && variant.enum.length === 1 && variant.enum[0] === null));
      if (nullIndex >= 0) {
        const nonNull = normalized.anyOf[nullIndex === 0 ? 1 : 0];
        if (isRecord(nonNull)) { delete normalized.anyOf; Object.assign(normalized, nonNull, { nullable: true }); }
      }
    }
    if (normalized.minimum === -9007199254740991) delete normalized.minimum;
    if (normalized.maximum === 9007199254740991) delete normalized.maximum;
    return normalized;
  };
  return visit(value) as Record<string, any>;
}

function manifestPointerTokens(pointer: unknown, kind: string): string[] {
  if (typeof pointer !== 'string' || pointer !== '' && !pointer.startsWith('/')) throw new TypeError(`Invalid manifest ${kind} pointer: ${String(pointer)}`);
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
  if (!Array.isArray(api.refs)) throw new TypeError('Invalid manifest refs');
  const skipped: string[][] = [];
  for (const entry of api.refs) {
    if (!isRecord(entry)) throw new TypeError('Invalid manifest ref entry');
    let tokens = manifestPointerTokens(entry.at, 'ref');
    if (typeof entry.at === 'string' && pointerValue(sourceOperation, tokens) === undefined) tokens = legacyPointerTokens(sourceOperation, entry.at) ?? tokens;
    const ref = typeof entry.ref === 'string' && entry.ref
      ? entry.ref
      : typeof entry.component === 'string' && entry.component ? referenceUri(manifest, entry.component) : undefined;
    if (ref === undefined || ref !== '#' && !ref.startsWith('#/')) throw new TypeError(`Invalid manifest ref: ${String(entry.ref ?? entry.component)}`);
    if (ref.startsWith('#/')) manifestPointerTokens(ref.slice(1), 'ref target');
    const nodeTokens = tokens[tokens.length - 1] === '$ref' ? tokens.slice(0, -1) : tokens;
    if (nodeTokens.length === 0) throw new TypeError(`Invalid manifest ref pointer: ${String(entry.at)}`);
    const runtimeNode = pointerValue(operation, nodeTokens);
    if (!isRecord(runtimeNode)) continue;
    if (typeof runtimeNode.$ref === 'string' && runtimeNode.$ref !== ref) { skipped.push(nodeTokens); continue; }
    const sourceNode = pointerValue(sourceOperation, nodeTokens);
    const replacement = isRecord(sourceNode) && sourceNode.$ref === ref ? { ...sourceNode } : { $ref: ref };
    setPointerValue(operation, nodeTokens, replacement);
  }
  return skipped;
}

function applyManifestSchemaOverlays(operation: Record<string, any>, api: ZopiaManifest['apis'][number], skippedRefs: string[][]): Record<string, any> {
  if (api.overlay === undefined) return operation;
  if (!Array.isArray(api.overlay)) throw new TypeError('Invalid manifest schema overlays');
  let result = operation;
  for (const entry of api.overlay) {
    if (!isRecord(entry)) throw new TypeError('Invalid manifest schema overlay entry');
    if (typeof entry.key === 'string' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
      if (!['callbacks', 'servers', 'externalDocs', 'links'].includes(entry.key)) throw new TypeError(`Invalid manifest operation overlay key: ${entry.key}`);
      Object.defineProperty(result, entry.key, { value: entry.value, enumerable: true, configurable: true, writable: true });
      continue;
    }
    const tokens = manifestPointerTokens(entry.at, 'schema overlay');
    if (skippedRefs.some((prefix) => pointerStartsWith(tokens, prefix))) continue;
    if (entry.set !== undefined && !isRecord(entry.set)) throw new TypeError('Invalid manifest schema overlay set');
    if (entry.remove !== undefined && (!Array.isArray(entry.remove) || !entry.remove.every((key: unknown) => typeof key === 'string'))) throw new TypeError('Invalid manifest schema overlay remove');
    const hasNode = Object.prototype.hasOwnProperty.call(entry, 'node');
    if (!hasNode && entry.set === undefined && entry.remove === undefined) throw new TypeError('Invalid manifest schema overlay entry');
    if (hasNode) {
      if (tokens.length === 0) {
        if (!isRecord(entry.node)) throw new TypeError('Invalid manifest root schema overlay node');
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
      if (!isRecord(entry) || typeof entry.status !== 'string') throw new TypeError('Invalid manifest response overlay entry');
      const overlay = isRecord(entry.response) ? entry.response : Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'status'));
      entries.push({ status: entry.status, overlay });
    }
  } else if (isRecord(api.responseOverlay)) {
    for (const [status, overlay] of Object.entries(api.responseOverlay)) {
      if (!isRecord(overlay)) throw new TypeError('Invalid manifest response overlay entry');
      entries.push({ status, overlay });
    }
  } else throw new TypeError('Invalid manifest response overlays');
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

function resolveParameter(parameter: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (typeof parameter.$ref !== 'string') return parameter;
  const openApiPrefix = '#/components/parameters/';
  const swaggerPrefix = '#/parameters/';
  const source = parameter.$ref.startsWith(openApiPrefix)
    ? (manifest.componentsOverlay as any)?.parameters?.[decodeJsonPointerSegment(parameter.$ref.slice(openApiPrefix.length), parameter.$ref)]
    : parameter.$ref.startsWith(swaggerPrefix) ? manifest.swaggerParameters?.[decodeJsonPointerSegment(parameter.$ref.slice(swaggerPrefix.length), parameter.$ref)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(parameter).filter(([key]) => key !== '$ref')) } : parameter;
}

const SWAGGER_PARAMETER_SCHEMA_KEYS = new Set(['schema', 'content', 'type', 'format', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'enum', 'default', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems']);

function swaggerParameterShape(schema: unknown, previous: Record<string, any> = {}, context = 'parameter'): Record<string, unknown> {
  const shape = isRecord(schema) ? { ...schema } : {};
  if (previous.type === 'file' && shape.type === 'string' && shape.format === 'binary') { shape.type = 'file'; delete shape.format; }
  if (!['string', 'number', 'integer', 'boolean', 'array', 'file'].includes(String(shape.type)) || Object.prototype.hasOwnProperty.call(shape, '$ref')) throw new TypeError(`Swagger 2.0 ${context} must serialize to a primitive, array, or file schema`);
  return shape;
}

function serializeParameters(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>): Record<string, any>[] {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const locations = [['path', 'params'], ['query', 'query'], ['header', 'headers'], ['cookie', 'cookies']] as const;
  const groups = new Map<string, { properties: Record<string, any>; required: Set<string> }>();
  for (const [location, field] of locations) {
    if (!isComponentSchema(config.request[field]) || schemaKind(config.request[field]) !== 'object') throw new TypeError(`Invalid generated endpoint ${location} parameters schema`);
    const schema = convertRuntimeSchema(config.request[field], 'input', manifest, references, `${location} parameters`);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    groups.set(location, { properties, required: new Set(Array.isArray(schema.required) ? schema.required : []) });
  }
  if (isSwagger && Object.keys(groups.get('cookie')!.properties).length > 0) throw new TypeError('Swagger 2.0 does not support cookie parameters');
  const used = new Map<string, Set<string>>(locations.map(([location]) => [location, new Set()]));
  const parameters: Record<string, any>[] = [];
  for (const raw of Array.isArray(operation.parameters) ? operation.parameters : []) {
    if (!isRecord(raw)) continue;
    const parameter = resolveParameter(raw, manifest);
    if (parameter.in === 'body' || parameter.in === 'formData') continue;
    if (!['path', 'query', 'header', 'cookie'].includes(parameter.in) || typeof parameter.name !== 'string') { parameters.push(raw); continue; }
    const group = groups.get(parameter.in)!;
    if (!Object.prototype.hasOwnProperty.call(group.properties, parameter.name)) continue;
    const schema = group.properties[parameter.name];
    used.get(parameter.in)!.add(parameter.name);
    if (isSwagger) {
      const metadata = Object.fromEntries(Object.entries(parameter).filter(([key]) => !SWAGGER_PARAMETER_SCHEMA_KEYS.has(key) && key !== '$ref'));
      parameters.push({ ...metadata, name: parameter.name, in: parameter.in, required: parameter.in === 'path' || group.required.has(parameter.name), ...swaggerParameterShape(schema, parameter, `${parameter.in} parameter ${parameter.name}`) });
    } else if (isRecord(parameter.content) && Object.keys(parameter.content).length) {
      const [contentType, media] = Object.entries(parameter.content)[0];
      parameters.push({ ...parameter, name: parameter.name, in: parameter.in, required: parameter.in === 'path' || group.required.has(parameter.name), content: { ...parameter.content, [contentType]: { ...(isRecord(media) ? media : {}), schema } } });
    } else parameters.push({ ...parameter, name: parameter.name, in: parameter.in, required: parameter.in === 'path' || group.required.has(parameter.name), schema });
  }
  for (const [location] of locations) {
    const group = groups.get(location)!;
    for (const [name, schema] of Object.entries(group.properties)) if (!used.get(location)!.has(name)) {
      if (isSwagger) parameters.push({ name, in: location, required: location === 'path' || group.required.has(name), ...swaggerParameterShape(schema, {}, `${location} parameter ${name}`) });
      else parameters.push({ name, in: location, required: location === 'path' || group.required.has(name), schema });
    }
  }
  return parameters;
}

function resolvedRequestBody(operation: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (!isRecord(operation.requestBody)) return {};
  if (typeof operation.requestBody.$ref !== 'string') return operation.requestBody;
  const prefix = '#/components/requestBodies/';
  const source = operation.requestBody.$ref.startsWith(prefix) ? (manifest.componentsOverlay as any)?.requestBodies?.[decodeJsonPointerSegment(operation.requestBody.$ref.slice(prefix.length), operation.requestBody.$ref)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(operation.requestBody).filter(([key]) => key !== '$ref')) } : {};
}

function serializeRequestBody(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, parameters: Record<string, any>[]): void {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const body = config.request.body;
  if (!isComponentSchema(body)) throw new TypeError('Invalid generated endpoint body schema');
  if (schemaKind(body) === 'any') { delete operation.requestBody; operation.parameters = parameters; return; }
  const schema = convertRuntimeSchema(body, 'input', manifest, references, 'request body');
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
        parameters.push({ ...metadata, name, in: 'formData', required: required.has(name), ...swaggerParameterShape(property, previous, `formData parameter ${name}`) });
      }
    } else {
      const previous = original.find((parameter) => parameter.in === 'body') ?? {};
      parameters.push({ ...previous, name: typeof previous.name === 'string' ? previous.name : 'body', in: 'body', required: previous.required === true, schema });
    }
    operation.parameters = parameters;
    if (contentType) {
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
  const retainedContent = contentTypeEdited ? Object.fromEntries(Object.entries(previousContent).filter(([type]) => type !== previousType)) : previousContent;
  const previousMedia = isRecord(previousContent[selectedType]) ? previousContent[selectedType] : {};
  const retainedMedia = Object.fromEntries(Object.entries(previousMedia).filter(([key]) => key !== 'example' && key !== 'examples'));
  const examples = isRecord(config.examples?.request) ? { examples: config.examples.request } : {};
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

function serializeResponses(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>): void {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const original = isRecord(operation.responses) ? operation.responses : {};
  const responses: Record<string, any> = {};
  const contentType = typeof config.responseContentType === 'string' && config.responseContentType ? config.responseContentType : undefined;
  const baselineContentType = isSwagger
    ? (Array.isArray(operation.produces) ? operation.produces[0] : undefined) ?? manifest.swaggerProduces?.[0]
    : Object.values(original).map((value) => isRecord(value) && isRecord(value.content) ? Object.keys(value.content)[0] : undefined).find((value) => value !== undefined);
  const contentTypeEdited = contentType !== undefined && typeof baselineContentType === 'string' && contentType !== baselineContentType;
  if (Object.keys(config.response).length === 0) throw new TypeError('Generated endpoint must define at least one response');
  for (const [status, runtimeSchema] of Object.entries(config.response)) {
    if (status !== 'default' && !/^(?:\d{3}|[1-5]XX)$/.test(status)) throw new TypeError(`Invalid generated endpoint response status: ${status}`);
    if (!isComponentSchema(runtimeSchema)) throw new TypeError(`Invalid generated endpoint response schema: ${status}`);
    const previous = isRecord(original[status]) ? resolveResponse(original[status], manifest) : {};
    const response: Record<string, any> = { ...previous, description: typeof previous.description === 'string' && previous.description ? previous.description : 'Generated response' };
    const configuredExamples = config.examples?.response?.[status];
    if (isSwagger) {
      if (isRecord(configuredExamples)) response.examples = Object.fromEntries(Object.entries(configuredExamples).map(([type, example]) => [type, isRecord(example) && Object.prototype.hasOwnProperty.call(example, 'value') ? example.value : example]));
      else delete response.examples;
    }
    if (schemaKind(runtimeSchema) === 'void') { delete response.content; delete response.schema; responses[status] = response; continue; }
    const schema = convertRuntimeSchema(runtimeSchema, 'output', manifest, references, `response ${status}`);
    if (isSwagger) response.schema = schema;
    else {
      const previousContent = isRecord(previous.content) ? previous.content : {};
      const previousType = Object.keys(previousContent)[0];
      const selectedType = contentTypeEdited ? contentType! : previousType ?? contentType ?? 'application/json';
      const retainedContent = contentTypeEdited && previousType !== selectedType ? Object.fromEntries(Object.entries(previousContent).filter(([type]) => type !== previousType)) : previousContent;
      const previousMedia = isRecord(previousContent[selectedType]) ? previousContent[selectedType] : {};
      const retainedMedia = Object.fromEntries(Object.entries(previousMedia).filter(([key]) => key !== 'example' && key !== 'examples'));
      const runtimeExamples = isRecord(configuredExamples) ? { examples: configuredExamples } : {};
      response.content = { ...retainedContent, [selectedType]: { ...retainedMedia, ...runtimeExamples, schema } };
    }
    responses[status] = response;
  }
  operation.responses = responses;
  if (isSwagger && contentType) {
    const retainedProduces = Array.isArray(operation.produces) ? operation.produces.filter((value: unknown) => value !== contentType && (!contentTypeEdited || value !== baselineContentType)) : [];
    operation.produces = [contentType, ...retainedProduces];
  }
}

function runtimeOperation(api: ZopiaManifest['apis'][number], sourceOperation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>): { path: string; method: string; operation: Record<string, any> } {
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
  for (const field of ['requestContentType', 'responseContentType'] as const) if (config[field] !== undefined && (typeof config[field] !== 'string' || !config[field])) throw new TypeError(`Invalid generated endpoint ${field}: ${String(config[field])}`);
  const parameters = serializeParameters(operation, config, manifest, references);
  serializeRequestBody(operation, config, manifest, references, parameters);
  serializeResponses(operation, config, manifest, references);
  if (Array.isArray(operation.parameters) && operation.parameters.length === 0) delete operation.parameters;
  const skippedRefs = applyManifestRefs(operation, sourceOperation, api, manifest);
  operation = applyManifestSchemaOverlays(operation, api, skippedRefs);
  applyManifestResponseOverlays(operation, api);
  return { path, method, operation };
}

function reconstructOpenApi(manifest: ZopiaManifest, endpointConfigs = new Map<number, EndpointConfig>(), componentSchemas = new Map<number, Record<string, unknown>>(), componentReferences: Array<readonly [string, ComponentSchema]> = []): Record<string, unknown> {
  if (!isRecord(manifest) || manifest.$schema !== 'zopia:manifest@1' || !isRecord(manifest.source) || !Array.isArray(manifest.apis)) throw new TypeError('Invalid zopia manifest');
  if (!['swagger-2.0', 'openapi-3.0', 'openapi-3.1'].includes(manifest.source.kind)) throw new TypeError(`Unsupported manifest source kind: ${manifest.source.kind}`);
  if (typeof manifest.source.title !== 'string' || !manifest.source.title.trim() || typeof manifest.source.version !== 'string' || !manifest.source.version.trim()) throw new TypeError('Invalid manifest source title or version');
  if (manifest.infoOverlay !== undefined && !isRecord(manifest.infoOverlay)) throw new TypeError('Invalid manifest infoOverlay');
  if (manifest.documentOverlay !== undefined && !isRecord(manifest.documentOverlay)) throw new TypeError('Invalid manifest documentOverlay');
  if (manifest.componentsOverlay !== undefined && !isRecord(manifest.componentsOverlay)) throw new TypeError('Invalid manifest componentsOverlay');
  if (manifest.swaggerParameters !== undefined && !isRecord(manifest.swaggerParameters)) throw new TypeError('Invalid manifest swaggerParameters');
  if (manifest.swaggerResponses !== undefined && !isRecord(manifest.swaggerResponses)) throw new TypeError('Invalid manifest swaggerResponses');
  if (manifest.components !== undefined && !Array.isArray(manifest.components)) throw new TypeError('Invalid manifest components');
  const componentNames = new Set<string>();
  for (const component of manifest.components ?? []) {
    if (!isRecord(component) || typeof component.name !== 'string' || !component.name || !Object.prototype.hasOwnProperty.call(component, 'schema') || component.file !== undefined && component.file !== null && (typeof component.file !== 'string' || !component.file)) throw new TypeError('Invalid manifest component');
    if (componentNames.has(component.name)) throw new TypeError(`Duplicate manifest component: ${component.name}`);
    componentNames.add(component.name);
  }
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
  const schemas = Object.fromEntries((manifest.components ?? []).map((component, index) => [component.name, componentSchemas.has(index) ? componentSchemas.get(index) : component.schema]));
  if (Object.keys(schemas).length) {
    if (isSwagger) document.definitions = schemas;
    else document.components = { ...(document.components ?? {}), schemas };
  }
  for (const [index, api] of manifest.apis.entries()) {
    if (!isRecord(api) || typeof api.path !== 'string' || !api.path.startsWith('/') || api.path.includes('?') || api.path.includes('#') || typeof api.method !== 'string' || !HTTP_METHODS.has(api.method)) throw new TypeError(`Invalid manifest API: ${String((api as any)?.path)} ${String((api as any)?.method)}`);
    if (api.sourceOperation !== undefined && !isRecord(api.sourceOperation)) throw new TypeError(`Invalid manifest source operation: ${api.path} ${api.method}`);
    const sourceOperation: Record<string, any> = api.sourceOperation ? { ...api.sourceOperation } : { operationId: api.operationId, responses: { default: { description: 'Generated from manifest' } } };
    const runtime = endpointConfigs.get(index);
    const reconstructed = runtime ? runtimeOperation(api, sourceOperation, runtime, manifest, componentReferences) : { path: api.path, method: api.method, operation: sourceOperation };
    if (api.security !== undefined) reconstructed.operation.security = api.security;
    const pathItem = Object.prototype.hasOwnProperty.call(document.paths, reconstructed.path) ? document.paths[reconstructed.path] : {};
    if (Object.prototype.hasOwnProperty.call(pathItem, reconstructed.method)) throw new TypeError(`Duplicate manifest API: ${reconstructed.path} ${reconstructed.method}`);
    Object.defineProperty(document.paths, reconstructed.path, { value: { ...pathItem, [reconstructed.method]: reconstructed.operation }, enumerable: true, configurable: true, writable: true });
  }
  return document;
}
