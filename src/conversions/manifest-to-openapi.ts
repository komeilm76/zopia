import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zodSchemasToJsonSchema, zodToJsonSchema } from './zod-to-json-schema';

export interface ZopiaManifest { $schema?: string; source: { kind: string; title: string; version: string; description?: string }; infoOverlay?: Record<string, unknown>; documentOverlay?: Record<string, unknown>; componentsOverlay?: Record<string, unknown>; mode?: string; servers?: unknown[]; swaggerHost?: string; swaggerSchemes?: string[]; swaggerConsumes?: string[]; swaggerProduces?: string[]; swaggerParameters?: Record<string, unknown>; swaggerResponses?: Record<string, unknown>; tags?: unknown[]; securitySchemes?: Record<string, unknown>; defaultSecurity?: unknown[]; components?: Array<{ name: string; file?: string | null; schema: unknown }>; apis: Array<{ file?: string; path: string; method: string; operationId?: string; sourceOperation?: Record<string, any>; security?: unknown[] }>; }

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

function isComponentSchema(value: unknown): value is ComponentSchema {
  return isRecord(value) && isRecord(value._zod) && typeof value._zod.run === 'function' && typeof value.parse === 'function';
}

function selectEndpointConfig(module: Record<string, unknown>, operationId: string | undefined, file: string): EndpointConfig {
  if (isEndpointConfig(module.default)) return module.default;
  const candidates = [...new Set(Object.values(module).filter(isEndpointConfig))];
  const matching = operationId === undefined ? [] : candidates.filter((candidate) => candidate.operationId === operationId);
  if (matching.length === 1) return matching[0];
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
      const importUrl = url.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
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
      schemas.set(index, schema);
    }
  }
  const references: Array<readonly [string, ComponentSchema]> = [];
  for (const [index, schema] of shared) if (!aliases.has(index)) references.push([manifest.components![index].name, schema]);
  return { schemas, references };
}

function componentRefTarget(schema: unknown): string | undefined {
  if (!isRecord(schema) || typeof schema.$ref !== 'string') return undefined;
  const prefix = schema.$ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : schema.$ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  return prefix ? schema.$ref.slice(prefix.length) : undefined;
}

/** Read a manifest, import its generated endpoint and component modules, and reconstruct the API document. */
export async function manifestFileToOpenApi(file: string): Promise<Record<string, unknown>> {
  if (typeof file !== 'string' || !file) throw new TypeError('Manifest file path is required');
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new TypeError(`Invalid manifest file: ${error instanceof Error ? error.message : String(error)}`); }
  const manifest = parsed as ZopiaManifest;
  reconstructOpenApi(manifest);
  const root = await realpath(dirname(resolve(file)));
  const modules = new Map<string, Record<string, unknown>>();
  const endpointConfigs = await importEndpointConfigs(manifest, root, modules);
  const components = await importComponentSchemas(manifest, root, modules);
  return reconstructOpenApi(manifest, endpointConfigs, components.schemas, components.references);
}

/** Reconstruct an API document from in-memory manifest snapshots without importing generated files. */
export function manifestToOpenApi(manifest: ZopiaManifest): Record<string, unknown> {
  return reconstructOpenApi(manifest);
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
    return normalizeRuntimeSchema(result);
  } catch (error) {
    throw new TypeError(`Unable to convert generated endpoint ${context} schema: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeRuntimeSchema(value: Record<string, any>): Record<string, any> {
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
    if (normalized.minimum === -9007199254740991) delete normalized.minimum;
    if (normalized.maximum === 9007199254740991) delete normalized.maximum;
    return normalized;
  };
  return visit(value) as Record<string, any>;
}

function restoreComponentRefs(runtime: unknown, source: unknown): unknown {
  if (Array.isArray(runtime)) return runtime.map((value, index) => restoreComponentRefs(value, Array.isArray(source) ? source[index] : undefined));
  if (!isRecord(runtime)) return runtime;
  if (isRecord(source) && componentRefTarget(source) !== undefined && componentRefTarget(runtime) !== undefined) return { ...runtime, $ref: source.$ref };
  return Object.fromEntries(Object.entries(runtime).map(([key, value]) => [key, restoreComponentRefs(value, isRecord(source) ? source[key] : undefined)]));
}

function parameterSchema(parameter: Record<string, any>): unknown {
  if (parameter.schema !== undefined) return parameter.schema;
  if (isRecord(parameter.content)) {
    const media = Object.values(parameter.content).find(isRecord);
    return media?.schema;
  }
  if (parameter.type !== undefined) {
    const { type, format, items, ...rest } = parameter;
    return { type: type === 'file' ? 'string' : type, ...(format === undefined ? {} : { format }), ...(items === undefined ? {} : { items }), ...Object.fromEntries(Object.entries(rest).filter(([key]) => ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'enum', 'default', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems'].includes(key))) };
  }
  return undefined;
}

function resolveParameter(parameter: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (typeof parameter.$ref !== 'string') return parameter;
  const openApiPrefix = '#/components/parameters/';
  const swaggerPrefix = '#/parameters/';
  const source = parameter.$ref.startsWith(openApiPrefix)
    ? (manifest.componentsOverlay as any)?.parameters?.[parameter.$ref.slice(openApiPrefix.length)]
    : parameter.$ref.startsWith(swaggerPrefix) ? manifest.swaggerParameters?.[parameter.$ref.slice(swaggerPrefix.length)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(parameter).filter(([key]) => key !== '$ref')) } : parameter;
}

const SWAGGER_PARAMETER_SCHEMA_KEYS = new Set(['schema', 'content', 'type', 'format', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'enum', 'default', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems']);

function swaggerParameterShape(schema: unknown, previous: Record<string, any> = {}): Record<string, unknown> {
  const shape = isRecord(schema) ? { ...schema } : {};
  if (previous.type === 'file' && shape.type === 'string' && shape.format === 'binary') { shape.type = 'file'; delete shape.format; }
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
  const used = new Map<string, Set<string>>(locations.map(([location]) => [location, new Set()]));
  const parameters: Record<string, any>[] = [];
  for (const raw of Array.isArray(operation.parameters) ? operation.parameters : []) {
    if (!isRecord(raw)) continue;
    const parameter = resolveParameter(raw, manifest);
    if (parameter.in === 'body' || parameter.in === 'formData') continue;
    if (!['path', 'query', 'header', 'cookie'].includes(parameter.in) || typeof parameter.name !== 'string') { parameters.push(raw); continue; }
    const group = groups.get(parameter.in)!;
    if (!Object.prototype.hasOwnProperty.call(group.properties, parameter.name)) continue;
    const schema = restoreComponentRefs(group.properties[parameter.name], parameterSchema(parameter));
    used.get(parameter.in)!.add(parameter.name);
    if (isSwagger) {
      const metadata = Object.fromEntries(Object.entries(parameter).filter(([key]) => !SWAGGER_PARAMETER_SCHEMA_KEYS.has(key) && key !== '$ref'));
      parameters.push({ ...metadata, name: parameter.name, in: parameter.in, required: parameter.in === 'path' || group.required.has(parameter.name), ...swaggerParameterShape(schema, parameter) });
    } else if (isRecord(parameter.content) && Object.keys(parameter.content).length) {
      const [contentType, media] = Object.entries(parameter.content)[0];
      parameters.push({ ...parameter, name: parameter.name, in: parameter.in, required: parameter.in === 'path' || group.required.has(parameter.name), content: { ...parameter.content, [contentType]: { ...(isRecord(media) ? media : {}), schema } } });
    } else parameters.push({ ...parameter, name: parameter.name, in: parameter.in, required: parameter.in === 'path' || group.required.has(parameter.name), schema });
  }
  for (const [location] of locations) {
    const group = groups.get(location)!;
    for (const [name, schema] of Object.entries(group.properties)) if (!used.get(location)!.has(name)) {
      if (isSwagger) parameters.push({ name, in: location, required: location === 'path' || group.required.has(name), ...swaggerParameterShape(schema) });
      else parameters.push({ name, in: location, required: location === 'path' || group.required.has(name), schema });
    }
  }
  return parameters;
}

function resolvedRequestBody(operation: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (!isRecord(operation.requestBody)) return {};
  if (typeof operation.requestBody.$ref !== 'string') return operation.requestBody;
  const prefix = '#/components/requestBodies/';
  const source = operation.requestBody.$ref.startsWith(prefix) ? (manifest.componentsOverlay as any)?.requestBodies?.[operation.requestBody.$ref.slice(prefix.length)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(operation.requestBody).filter(([key]) => key !== '$ref')) } : {};
}

function existingBodySchema(operation: Record<string, any>, manifest: ZopiaManifest): unknown {
  if (manifest.source.kind === 'swagger-2.0') return (Array.isArray(operation.parameters) ? operation.parameters : []).map((value: unknown) => isRecord(value) ? value : {}).find((value: Record<string, any>) => value.in === 'body')?.schema;
  const content = resolvedRequestBody(operation, manifest).content;
  if (!isRecord(content)) return undefined;
  const media = Object.values(content).find(isRecord);
  return media?.schema;
}

function serializeRequestBody(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>, parameters: Record<string, any>[]): void {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const body = config.request.body;
  if (!isComponentSchema(body)) throw new TypeError('Invalid generated endpoint body schema');
  if (schemaKind(body) === 'any') { delete operation.requestBody; operation.parameters = parameters; return; }
  const schema = restoreComponentRefs(convertRuntimeSchema(body, 'input', manifest, references, 'request body'), existingBodySchema(operation, manifest));
  const contentType = typeof config.requestContentType === 'string' && config.requestContentType ? config.requestContentType : undefined;
  if (isSwagger) {
    const original = (Array.isArray(operation.parameters) ? operation.parameters : []).filter(isRecord);
    const form = original.filter((parameter) => parameter.in === 'formData');
    if (form.length || contentType === 'multipart/form-data' || contentType === 'application/x-www-form-urlencoded') {
      const properties = isRecord((schema as any).properties) ? (schema as any).properties : {};
      const required = new Set(Array.isArray((schema as any).required) ? (schema as any).required : []);
      for (const [name, property] of Object.entries(properties)) {
        const previous = form.find((parameter) => parameter.name === name) ?? {};
        const metadata = Object.fromEntries(Object.entries(previous).filter(([key]) => !SWAGGER_PARAMETER_SCHEMA_KEYS.has(key)));
        parameters.push({ ...metadata, name, in: 'formData', required: required.has(name), ...swaggerParameterShape(property, previous) });
      }
    } else {
      const previous = original.find((parameter) => parameter.in === 'body') ?? {};
      parameters.push({ ...previous, name: typeof previous.name === 'string' ? previous.name : 'body', in: 'body', required: previous.required === true, schema });
    }
    operation.parameters = parameters;
    if (contentType) operation.consumes = [contentType, ...(Array.isArray(operation.consumes) ? operation.consumes.filter((value: unknown) => value !== contentType) : [])];
    return;
  }
  const previous = resolvedRequestBody(operation, manifest);
  const previousContent = isRecord(previous.content) ? previous.content : {};
  const previousType = Object.keys(previousContent)[0];
  const selectedType = contentType ?? previousType ?? 'application/json';
  const previousMedia = isRecord(previousContent[selectedType]) ? previousContent[selectedType] : {};
  const examples = isRecord(config.examples?.request) ? { examples: config.examples.request } : {};
  operation.requestBody = { ...previous, content: { ...previousContent, [selectedType]: { ...previousMedia, ...examples, schema } } };
  operation.parameters = parameters;
}

function resolveResponse(response: Record<string, any>, manifest: ZopiaManifest): Record<string, any> {
  if (typeof response.$ref !== 'string') return response;
  const openApiPrefix = '#/components/responses/';
  const swaggerPrefix = '#/responses/';
  const source = response.$ref.startsWith(openApiPrefix)
    ? (manifest.componentsOverlay as any)?.responses?.[response.$ref.slice(openApiPrefix.length)]
    : response.$ref.startsWith(swaggerPrefix) ? manifest.swaggerResponses?.[response.$ref.slice(swaggerPrefix.length)] : undefined;
  return isRecord(source) ? { ...source, ...Object.fromEntries(Object.entries(response).filter(([key]) => key !== '$ref')) } : {};
}

function responseSchema(response: Record<string, any>, isSwagger: boolean): unknown {
  if (isSwagger) return response.schema;
  if (!isRecord(response.content)) return undefined;
  return Object.values(response.content).find(isRecord)?.schema;
}

function serializeResponses(operation: Record<string, any>, config: EndpointConfig, manifest: ZopiaManifest, references: Array<readonly [string, ComponentSchema]>): void {
  const isSwagger = manifest.source.kind === 'swagger-2.0';
  const original = isRecord(operation.responses) ? operation.responses : {};
  const responses: Record<string, any> = {};
  const contentType = typeof config.responseContentType === 'string' && config.responseContentType ? config.responseContentType : undefined;
  const baselineContentType = Object.values(original).map((value) => isRecord(value) && isRecord(value.content) ? Object.keys(value.content)[0] : undefined).find((value) => value !== undefined);
  const contentTypeEdited = contentType !== undefined && baselineContentType !== undefined && contentType !== baselineContentType;
  if (Object.keys(config.response).length === 0) throw new TypeError('Generated endpoint must define at least one response');
  for (const [status, runtimeSchema] of Object.entries(config.response)) {
    if (status !== 'default' && !/^(?:\d{3}|[1-5]XX)$/.test(status)) throw new TypeError(`Invalid generated endpoint response status: ${status}`);
    if (!isComponentSchema(runtimeSchema)) throw new TypeError(`Invalid generated endpoint response schema: ${status}`);
    const previous = isRecord(original[status]) ? resolveResponse(original[status], manifest) : {};
    const response: Record<string, any> = { ...previous, description: typeof previous.description === 'string' && previous.description ? previous.description : 'Generated response' };
    if (schemaKind(runtimeSchema) === 'void') { delete response.content; delete response.schema; responses[status] = response; continue; }
    const schema = restoreComponentRefs(convertRuntimeSchema(runtimeSchema, 'output', manifest, references, `response ${status}`), responseSchema(previous, isSwagger));
    if (isSwagger) response.schema = schema;
    else {
      const previousContent = isRecord(previous.content) ? previous.content : {};
      const previousType = Object.keys(previousContent)[0];
      const selectedType = contentTypeEdited ? contentType! : previousType ?? contentType ?? 'application/json';
      const previousMedia = isRecord(previousContent[selectedType]) ? previousContent[selectedType] : {};
      const runtimeExamples = isRecord(config.examples?.response?.[status]) ? { examples: config.examples.response[status] } : {};
      response.content = { ...previousContent, [selectedType]: { ...previousMedia, ...runtimeExamples, schema } };
    }
    responses[status] = response;
  }
  operation.responses = responses;
  if (isSwagger && contentType) operation.produces = [contentType, ...(Array.isArray(operation.produces) ? operation.produces.filter((value: unknown) => value !== contentType) : [])];
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
  for (const field of ['requestContentType', 'responseContentType'] as const) if (config[field] !== undefined && (typeof config[field] !== 'string' || !config[field])) throw new TypeError(`Invalid generated endpoint ${field}: ${String(config[field])}`);
  const parameters = serializeParameters(operation, config, manifest, references);
  serializeRequestBody(operation, config, manifest, references, parameters);
  serializeResponses(operation, config, manifest, references);
  if (Array.isArray(operation.parameters) && operation.parameters.length === 0) delete operation.parameters;
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
