import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { asZopiaError, ZopiaError } from '../errors';
import { buildOpenApiOperationIR } from './openapi-ir';
import { deriveReusableParameterSchema, deriveReusableResponseSchema, extractOperationContracts, reusableDeclarations } from './openapi-contracts';
import { jsonSchemaToZod } from './json-schema-to-zod';
import { planApiDocsFiles, planWebhookDocsFiles, webhookRuntimePath, type ApiDocsFilePlan } from './api-docs-plan';
import { isPortableApiDocsSegment, type ApiDocsMode } from './api-docs-layout';
import type { OpenApiDocument } from './openapi';
import { createZopiaManifest, hashOpenApiDocument, writeZopiaManifest, ZOPIA_MANIFEST_FILE } from './manifest-writer';
import { inspectZopiaManifestStaleness, removeObsoleteManifestFiles } from './manifest-staleness';
import { decodeJsonPointerSegment, resolveOpenApiLocalRef } from './openapi-ref';

/** A low-level generated file record with both relative and absolute paths. */
export interface GeneratedApiDocsFile {
  /** Portable path relative to the configured output directory. */
  file: string;
  /** Absolute filesystem path written by the generator. */
  absolutePath: string;
  /** Endpoint operation ID or component artifact name. */
  operationId: string;
}

/** Low-level file-generator options used by the Engine ③ public wrapper. */
export interface GenerateApiDocsOptions {
  /** Required output directory for the low-level writer. */
  outputDir: string;
  /** Endpoint layout mode. @default 'directory' */
  mode?: ApiDocsMode;
  /** Whether component files are emitted. @default false */
  insertComponents?: boolean;
  /** Whether endpoint schemas import emitted components. @default false */
  useComponentAsReference?: boolean;
  /** Whether the reverse-conversion manifest is emitted. @default true */
  manifest?: boolean;
}

function componentReferenceSuffix(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const prefix = ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  return prefix ? ref.slice(prefix.length) : undefined;
}
function componentTarget(ref: unknown): string | undefined {
  const suffix = componentReferenceSuffix(ref);
  return suffix !== undefined && !suffix.includes('/') ? decodeJsonPointerSegment(suffix, String(ref)) : undefined;
}
function componentExport(ref: unknown): string | undefined {
  const target = componentTarget(ref); return target === undefined ? undefined : componentExportName(target);
}
const STRUCTURAL_REF_MAP_KEYS = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions', 'responses', 'content', 'headers', 'links', 'encoding', 'callbacks']);
function collectComponentRefs(value: unknown, names = new Set<string>(), mapEntries = false): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectComponentRefs(item, names));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (mapEntries) collectComponentRefs(child, names);
    else if (['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-')) continue;
    else if (key === '$ref') { const name = componentExport(child); if (name) names.add(name); }
    else collectComponentRefs(child, names, STRUCTURAL_REF_MAP_KEYS.has(key));
  }
  return names;
}
function schemaCode(schema: unknown, name: string): string {
  const safeName = exportName(name);
  const converted = jsonSchemaToZod(schema === undefined ? true : schema as any, { rootName: safeName });
  const source = converted.code.trimEnd();
  const direct = source.match(new RegExp(`^const ${safeName.replace(/[$]/g, '\\$&')} = ([\\s\\S]*);$`));
  return direct ? direct[1] : `(() => { ${source} return ${safeName}; })()`;
}

function schemaCodeWithDocumentRefs(schema: unknown, name: string, source: OpenApiDocument): string {
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const schemaObject = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema as Record<string, unknown> : undefined;
  const ownDefinitions = schemaObject?.$defs && typeof schemaObject.$defs === 'object' && !Array.isArray(schemaObject.$defs) ? schemaObject.$defs as Record<string, unknown> : {};
  let namespace = '__zopiaComponents';
  while (Object.prototype.hasOwnProperty.call(ownDefinitions, namespace)) namespace += '_';
  let found = false;
  const normalizeRefs = (value: unknown, mapEntries = false): unknown => {
    if (Array.isArray(value)) return value.map((child) => normalizeRefs(child));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if (mapEntries) return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, normalizeRefs(child)]));
    return Object.fromEntries(Object.entries(object).map(([key, child]) => {
      if (key === '$ref') {
        const suffix = componentReferenceSuffix(child);
        if (suffix !== undefined) { found = true; return [key, `#/$defs/${namespace}/${suffix}`]; }
      }
      if (['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-')) return [key, child];
      return [key, normalizeRefs(child, STRUCTURAL_REF_MAP_KEYS.has(key))];
    }));
  };
  const normalized = normalizeRefs(schema);
  if (!found || !normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return schemaCode(normalized, name);
  found = false;
  const normalizedComponents = Object.fromEntries(Object.entries(schemas).map(([componentName, component]) => [componentName, normalizeRefs(component)]));
  const normalizedOwnDefinitions = (normalized as Record<string, unknown>).$defs;
  return schemaCode({
    ...(normalized as Record<string, unknown>),
    $defs: {
      ...(normalizedOwnDefinitions && typeof normalizedOwnDefinitions === 'object' && !Array.isArray(normalizedOwnDefinitions) ? normalizedOwnDefinitions as Record<string, unknown> : {}),
      [namespace]: normalizedComponents,
    },
  }, name);
}

function schemaCodeWithComponentImports(schema: unknown, name: string, source: OpenApiDocument, rootComponent: string): { code: string; imports: Map<string, string> } {
  const imports = new Map<string, string>();
  const replacements = new Map<string, string>();
  let markerIndex = 0;
  const rewrite = (value: unknown, root = false, mapEntries = false): unknown => {
    if (Array.isArray(value)) return value.map((child) => rewrite(child));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if (mapEntries) return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, rewrite(child)]));
    const target = componentTarget(object.$ref);
    if (target) {
      const component = componentExportName(target);
      imports.set(component, target);
      let marker = `__zopia_component_reference_${markerIndex++}__`;
      const serialized = JSON.stringify(value) ?? '';
      while (serialized.includes(JSON.stringify(marker))) marker = `__zopia_component_reference_${markerIndex++}__`;
      replacements.set(marker, root || componentReaches(source, target, rootComponent) ? `z.lazy(() => ${component})` : component);
      const siblings = Object.fromEntries(Object.entries(object).filter(([key]) => key !== '$ref').map(([key, child]) => [key, ['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-') ? child : rewrite(child, false, STRUCTURAL_REF_MAP_KEYS.has(key))]));
      if (Object.keys(siblings).length === 0) return { const: marker };
      const existingAllOf = siblings.allOf; delete siblings.allOf;
      const allOf: unknown[] = [{ const: marker }];
      if (Array.isArray(existingAllOf)) allOf.push(...existingAllOf);
      else if (existingAllOf !== undefined) allOf.push({ allOf: existingAllOf });
      return { ...siblings, allOf };
    }
    const entries = Object.entries(object).map(([key, child]) => [key, ['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-') ? child : rewrite(child, false, STRUCTURAL_REF_MAP_KEYS.has(key))] as const);
    const stringConstraints = ['minLength', 'maxLength', 'pattern', 'format', 'contentEncoding', 'contentMediaType'];
    if (object.type === 'string' && Array.isArray(object.enum) && object.enum.every((item) => typeof item === 'string') && !stringConstraints.some((key) => Object.prototype.hasOwnProperty.call(object, key))) return Object.fromEntries(entries.filter(([key]) => key !== 'type'));
    return Object.fromEntries(entries);
  };
  let code = schemaCodeWithDocumentRefs(rewrite(schema, true), name, source);
  for (const [marker, replacement] of replacements) code = code.split(`z.literal(${JSON.stringify(marker)})`).join(replacement);
  return { code, imports };
}

function quoteStatus(status: string): string { return /^\d+$/.test(status) ? status : JSON.stringify(status); }
function stableDataJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : child);
}

const isMissingPath = (error: unknown): boolean => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
function outputPathError(file: string): ZopiaError {
  return new ZopiaError('ZOPIA_FS_OUTSIDE_OUTDIR', `generated path is unsafe: ${file}`, { at: file, hint: 'remove symlinks or non-directory ancestors from the output tree' });
}
function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
async function writeGeneratedFile(root: string, file: string, content: string, previouslyOwned: ReadonlySet<string>): Promise<string> {
  const absolutePath = resolve(root, ...file.split('/'));
  if (!isInside(root, absolutePath) || absolutePath === root) throw outputPathError(file);
  const parent = dirname(absolutePath);
  const parentRelative = relative(root, parent);
  let cursor = root;
  for (const segment of parentRelative ? parentRelative.split(sep) : []) {
    cursor = join(cursor, segment);
    try {
      const metadata = await lstat(cursor);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw outputPathError(file);
    } catch (error) {
      if (isMissingPath(error)) break;
      throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to inspect generated output path', { at: file, hint: 'check output-directory permissions and symlinks' });
    }
  }
  try { await mkdir(parent, { recursive: true }); }
  catch (error) { throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to create generated output directory', { at: file, hint: 'check output-directory permissions' }); }
  try {
    const metadata = await lstat(absolutePath);
    if (metadata.isDirectory()) throw outputPathError(file);
    if (metadata.isSymbolicLink()) {
      if (!previouslyOwned.has(file)) throw outputPathError(file);
      await rm(absolutePath, { force: true });
    }
  } catch (error) {
    if (!isMissingPath(error)) throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to inspect generated output file', { at: file, hint: 'check output-directory permissions and file types' });
  }
  try { await writeFile(absolutePath, content, 'utf8'); }
  catch (error) { throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to write generated output file', { at: file, hint: 'check output-directory permissions and available disk space' }); }
  return absolutePath;
}

function resolveObject(value: unknown, source: OpenApiDocument): any {
  let current = value; const seen = new Set<string>();
  while (current && typeof current === 'object' && !Array.isArray(current) && '$ref' in current) {
    const ref = (current as any).$ref;
    if (typeof ref !== 'string' || seen.has(ref)) return current;
    seen.add(ref); const target = resolveOpenApiLocalRef(source, ref);
    if (!target || typeof target !== 'object' || Array.isArray(target)) return current;
    current = { ...(target as any), ...Object.fromEntries(Object.entries(current as any).filter(([key]) => key !== '$ref')) };
  }
  return current;
}
function exportName(operationId: string): string {
  const parts = operationId.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  let name = parts.map((part, index) => index === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('') || 'endpoint';
  if (!/^[A-Za-z_$]/.test(name)) name = `endpoint${name}`;
  if (['arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'].includes(name)) name = `${name}Endpoint`;
  return name;
}
function componentExportName(componentName: string): string {
  const name = exportName(componentName);
  return name.endsWith('Schema') ? name : `${name}Schema`;
}
function componentParameterExportName(componentName: string): string {
  const name = exportName(componentName);
  return name.endsWith('Parameter') ? name : `${name}Parameter`;
}
function componentResponseExportName(componentName: string): string {
  const name = exportName(componentName);
  return name.endsWith('Response') ? name : `${name}Response`;
}
function componentReaches(source: OpenApiDocument, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const schema = schemas[from];
  if (!schema || typeof schema !== 'object') return false;
  const refs: string[] = [];
  const visit = (value: unknown, mapEntries = false): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((child) => visit(child)); return; }
    const object = value as Record<string, unknown>;
    if (mapEntries) { for (const child of Object.values(object)) visit(child); return; }
    const ref = componentTarget(object.$ref);
    if (ref) refs.push(ref);
    for (const [key, child] of Object.entries(object)) if (!['example', 'examples', 'default', 'enum', 'const'].includes(key) && !key.startsWith('x-')) visit(child, STRUCTURAL_REF_MAP_KEYS.has(key));
  };
  visit(schema);
  return refs.some((ref) => componentReaches(source, ref, target, seen));
}
function renderComponent(name: string, schema: unknown, source: OpenApiDocument, exportNameFor: (componentName: string) => string = componentExportName, schemaImportPrefix = '../'): string {
  const componentName = exportNameFor(name);
  const { code, imports } = schemaCodeWithComponentImports(schema, componentName, source, name);
  const importLine = [...imports.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([ref]) => ref !== componentName).map(([ref, target]) => `import { ${ref} } from ${JSON.stringify(`${schemaImportPrefix}${target}/index`)};`).join('\n');
  return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n${importLine}${importLine ? '\n' : ''}\nexport const ${componentName} = ${code};\n\nexport default ${componentName};\n`;
}
function renderEndpoint(operation: any, source: OpenApiDocument, mode: ApiDocsMode = 'directory', useComponents = false, runtimePath?: string): string {
  const ir = buildOpenApiOperationIR(source).find((candidate) => candidate.operationId === operation.operationId && candidate.path === operation.path && candidate.method.toLowerCase() === operation.method);
  if (!ir) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unable to build operation IR: ${operation.operationId}`);
  const contracts = extractOperationContracts(ir);
  const componentRefs = useComponents ? collectComponentRefs({ operation: operation.operation, parameters: ir.parameters }) : new Set<string>();
  const componentSchema = (schema: unknown, fallback: string) => {
    if (useComponents) {
      const replacements = new Map<string, string>(); let markerIndex = 0;
      const rewrite = (value: unknown, mapEntries = false): unknown => {
        if (Array.isArray(value)) return value.map((child) => rewrite(child));
        if (!value || typeof value !== 'object') return value;
        const object = value as Record<string, unknown>;
        if (mapEntries) return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, rewrite(child)]));
        const component = componentExport(object.$ref);
        if (component) {
          componentRefs.add(component);
          let marker = `__zopia_component_reference_${markerIndex++}__`;
          const serialized = JSON.stringify(value) ?? '';
          while (serialized.includes(JSON.stringify(marker))) marker = `__zopia_component_reference_${markerIndex++}__`;
          replacements.set(marker, component);
          const siblings = Object.fromEntries(Object.entries(object).filter(([key]) => key !== '$ref').map(([key, child]) => [key, ['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-') ? child : rewrite(child, STRUCTURAL_REF_MAP_KEYS.has(key))]));
          if (Object.keys(siblings).length === 0) return { const: marker };
          const existingAllOf = siblings.allOf; delete siblings.allOf;
          const allOf: unknown[] = [{ const: marker }];
          if (Array.isArray(existingAllOf)) allOf.push(...existingAllOf);
          else if (existingAllOf !== undefined) allOf.push({ allOf: existingAllOf });
          return { ...siblings, allOf };
        }
        return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, ['example', 'examples', 'default', 'enum', 'const'].includes(key) || key.startsWith('x-') ? child : rewrite(child, STRUCTURAL_REF_MAP_KEYS.has(key))]));
      };
      let code = schemaCodeWithDocumentRefs(rewrite(schema), fallback, source);
      for (const [marker, component] of replacements) code = code.split(`z.literal(${JSON.stringify(marker)})`).join(component);
      return code;
    }
    return schemaCodeWithDocumentRefs(schema, fallback, source);
  };
  const reusableUses = { parameter: new Set<string>(), response: new Set<string>() };
  const reusableParameterExport = (reusable: string): string => { const name = componentParameterExportName(reusable); reusableUses.parameter.add(name); return name; };
  const params = (location: string) => contracts.parameters.filter((p) => p.in === location).map((p) => `[${JSON.stringify(p.name)}]: ${useComponents && p.reusable ? reusableParameterExport(p.reusable) : componentSchema(p.schema, `param${p.name.replace(/[^A-Za-z0-9]/g, '') || 'Value'}`)}${p.required ? '' : '.optional()'}`).join(', ');
  const rawRequestSchema = contracts.requestBody?.schema;
  const formDataMarkers: Array<readonly [string, string]> = [];
  let requestSchema = rawRequestSchema;
  if (useComponents && contracts.requestBody?.formDataReusable && requestSchema && typeof requestSchema === 'object' && !Array.isArray(requestSchema)) {
    const object = requestSchema as Record<string, unknown>;
    if (object.properties && typeof object.properties === 'object' && !Array.isArray(object.properties)) {
      const serialized = JSON.stringify(requestSchema) ?? '';
      const properties = { ...(object.properties as Record<string, unknown>) };
      for (const [property, reusable] of Object.entries(contracts.requestBody.formDataReusable)) {
        if (!Object.prototype.hasOwnProperty.call(properties, property)) continue;
        let marker = `__zopia_reusable_reference_${formDataMarkers.length}__`;
        while (serialized.includes(JSON.stringify(marker))) marker = `__zopia_reusable_reference_${formDataMarkers.length}_${marker.split('_').length}__`;
        formDataMarkers.push([marker, reusableParameterExport(reusable)]);
        properties[property] = { const: marker };
      }
      requestSchema = { ...object, properties };
    }
  }
  let requestBodyCode = contracts.requestBody ? componentSchema(requestSchema, 'requestBody') : 'z.any()';
  if (useComponents && contracts.requestBody?.reusable) requestBodyCode = reusableParameterExport(contracts.requestBody.reusable);
  for (const [marker, exportId] of formDataMarkers) requestBodyCode = requestBodyCode.split(`z.literal(${JSON.stringify(marker)})`).join(exportId);
  const request = `request: { body: ${requestBodyCode},  params: z.object({ ${params('path')} }), query: z.object({ ${params('query')} }), headers: z.object({ ${params('header')} }), cookies: z.object({ ${params('cookie')} }) }`;
  const response = contracts.responses.map((r) => `${quoteStatus(r.status)}: ${useComponents && r.reusable && r.schema !== undefined ? (() => { const name = componentResponseExportName(r.reusable); reusableUses.response.add(name); return name; })() : r.schema === undefined ? 'z.void()' : componentSchema(r.schema, `response${r.status.replace(/[^A-Za-z0-9]/g, '') || 'Default'}`)}`).join(', ');
  const responseContentType = contracts.responses.find((r) => r.contentType)?.contentType;
  // OpenAPI media-type keys are open strings, while km-api 0.4.1's declarations
  // enumerate known values. Keep the exact runtime value across that narrow boundary.
  const kmApiContentType = (value: string, type: 'IRequestContentType' | 'IResponseContentType'): string =>
    `${JSON.stringify(value)} as unknown as import('km-api').${type}`;
  const requestExamples: Record<string, unknown> = Object.create(null);
  const requestBody = resolveObject(operation.operation.requestBody, source);
  const requestMedia = requestBody?.content && contracts.requestBody?.contentType ? requestBody.content[contracts.requestBody.contentType] : undefined;
  if (requestMedia?.example !== undefined) requestExamples.default = { value: requestMedia.example };
  if (requestMedia?.examples && typeof requestMedia.examples === 'object') Object.assign(requestExamples, requestMedia.examples);
  const responseExamples: Record<string, unknown> = {};
  for (const [status, value] of Object.entries(operation.operation.responses ?? {})) {
    const raw = resolveObject(value, source);
    const selectedContentType = contracts.responses.find((response) => response.status === status)?.contentType;
    const media = raw && typeof raw === 'object' && (raw as any).content && selectedContentType ? (raw as any).content[selectedContentType] : undefined;
    if (media?.example !== undefined) responseExamples[status] = { default: { value: media.example } };
    if (media?.examples && typeof media.examples === 'object') responseExamples[status] = media.examples;
    const legacyExamples = raw && typeof raw === 'object' ? (raw as any).examples : undefined;
    if (legacyExamples && typeof legacyExamples === 'object') responseExamples[status] = Object.fromEntries(Object.entries(legacyExamples).map(([contentType, value]) => [contentType, { value }]));
  }
  const examplesValue = { ...(Object.keys(requestExamples).length ? { request: requestExamples } : {}), ...(Object.keys(responseExamples).length ? { response: responseExamples } : {}) };
  const examples = Object.keys(examplesValue).length ? `examples: JSON.parse(${JSON.stringify(stableDataJson(examplesValue))}),` : '';
  const opId = operation.operationId;
  const exportId = exportName(opId);
  const tags = ir.tags;
  const auth = ir.security !== undefined && ir.security.length > 0 && ir.security.every((requirement) => Object.keys(requirement as Record<string, unknown>).length > 0) ? 'YES' : 'NO';
  const sourceName = JSON.stringify(`${source.info.title} v${source.info.version}`).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const endpointDepth = typeof operation.file === 'string' ? operation.file.split('/').length - 1 : mode === 'flat' ? 2 : operation.path.split('/').filter(Boolean).length + 1;
  const depthPrefix = '../'.repeat(endpointDepth);
  const componentImports: string[] = [];
  if (useComponents && componentRefs.size) componentImports.push(`import { ${[...componentRefs].sort().join(', ')} } from '${depthPrefix}components/index';`);
  if (useComponents && reusableUses.parameter.size) componentImports.push(`import { ${[...reusableUses.parameter].sort().join(', ')} } from '${depthPrefix}components/parameters/index';`);
  if (useComponents && reusableUses.response.size) componentImports.push(`import { ${[...reusableUses.response].sort().join(', ')} } from '${depthPrefix}components/responses/index';`);
  const componentImport = componentImports.length ? `\n${componentImports.join('\n')}` : '';
  return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\nimport { makeApiConfig } from 'km-api';${componentImport}\n\nexport const ${exportId} = makeApiConfig({\n  method: ${JSON.stringify(operation.method.toUpperCase())},\n  pathShape: ${JSON.stringify(runtimePath ?? operation.path)},\n  operationId: ${JSON.stringify(opId)},\n  ${contracts.requestBody ? `requestContentType: ${kmApiContentType(contracts.requestBody.contentType, 'IRequestContentType')},` : ''}\n  ${responseContentType ? `responseContentType: ${kmApiContentType(responseContentType, 'IResponseContentType')},` : ''}\n  ${ir.deprecated ? "deprecated: 'YES'," : ''}\n  auth: ${JSON.stringify(auth)},\n  summary: ${JSON.stringify(operation.operation.summary ?? '')},\n  description: ${JSON.stringify(operation.operation.description ?? '')},\n  tags: ${JSON.stringify(tags)},\n  ${examples}\n  ${request},\n  response: { ${response} },\n});\n\nexport default ${exportId};\n// Source: ${sourceName}\n`.replace(/[ \t]+$/gm, '');
}

function avoidReservedFileCollisions(plans: readonly ApiDocsFilePlan[], reservedFiles: Iterable<string>): ApiDocsFilePlan[] {
  const reserved = [...reservedFiles].map((file) => file.split('/').map((segment) => segment.toLowerCase()));
  const used = new Set(reserved.map((segments) => segments.join('/')));
  const groups = new Map<string, ApiDocsFilePlan[]>();
  const assigned: Array<{ segments: string[]; methods: string[] }> = [];
  for (const plan of plans) {
    const group = groups.get(plan.path);
    if (group) group.push(plan);
    else groups.set(plan.path, [plan]);
  }
  const startsWith = (value: readonly string[], prefix: readonly string[]): boolean => prefix.length <= value.length && prefix.every((segment, index) => value[index].toLowerCase() === segment.toLowerCase());
  const filesByPath = new Map<string, Map<string, string>>();
  for (const [path, group] of groups) {
    const originalSegments = group[0].file.split('/').slice(0, -2);
    const candidate = [...originalSegments];
    const methods = group.map((plan) => plan.method);
    const suffixes = new Map<number, number>();
    const conflictIndex = (): number | undefined => {
      const candidateFiles = methods.map((method) => `${candidate.join('/')}/${method}/index.ts`.toLowerCase());
      if (candidateFiles.some((file) => used.has(file))) return candidate.length - 1;
      for (const file of reserved) if (startsWith(candidate, file)) return file.length - 1;
      for (const previous of assigned) {
        if (candidate.length === previous.segments.length && startsWith(candidate, previous.segments)) return candidate.length - 1;
        for (const method of previous.methods) if (startsWith(candidate, [...previous.segments, method])) return previous.segments.length;
        for (const method of methods) if (startsWith(previous.segments, [...candidate, method])) return candidate.length - 1;
      }
      return undefined;
    };
    let conflict = conflictIndex();
    while (conflict !== undefined) {
      const suffix = (suffixes.get(conflict) ?? 1) + 1;
      suffixes.set(conflict, suffix);
      candidate[conflict] = `${originalSegments[conflict]}-${suffix}`;
      conflict = conflictIndex();
    }
    const candidateFiles = group.map((plan) => `${candidate.join('/')}/${plan.method}/index.ts`);
    filesByPath.set(path, new Map(group.map((plan, index) => [plan.method, candidateFiles[index]])));
    for (const file of candidateFiles) used.add(file.toLowerCase());
    assigned.push({ segments: candidate, methods });
  }
  return plans.map((plan) => ({ ...plan, file: filesByPath.get(plan.path)!.get(plan.method)! }));
}

/**
 * Generate the planned endpoint files on disk. Existing generated files are overwritten.
 *
 * @param input Valid Swagger/OpenAPI object or JSON text.
 * @param options Validated low-level filesystem generation options.
 * @returns Generated endpoint, component, barrel, and manifest file records.
 * @throws {@link ZopiaError} when conversion, validation, or filesystem output fails.
 */
export async function generateApiDocsFiles(input: OpenApiDocument | string, options: GenerateApiDocsOptions): Promise<GeneratedApiDocsFile[]> {
  try { return await generateApiDocsFilesInternal(input, options); }
  catch (error) {
    if (error instanceof ZopiaError && (error.code === 'ZOPIA_SCHEMA_INVALID' || error.code === 'ZOPIA_MANIFEST_INVALID')) {
      const message = error.message.slice(`${error.code}: `.length);
      throw new ZopiaError('ZOPIA_SPEC_INVALID', message, { at: error.at ?? '#', cause: error });
    }
    throw asZopiaError(error, 'ZOPIA_SPEC_INVALID', 'unable to generate api-docs files', { at: '#', hint: 'check the source document and generation options' });
  }
}

async function generateApiDocsFilesInternal(input: OpenApiDocument | string, options: GenerateApiDocsOptions): Promise<GeneratedApiDocsFile[]> {
  if (!options || typeof options !== 'object' || Array.isArray(options) || typeof options.outputDir !== 'string' || !options.outputDir || options.outputDir.includes('\0')) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'outputDir is required', { at: 'outputDir', hint: 'provide a generated-tree output directory' });
  const unknown = Object.keys(options).find((key) => !['outputDir', 'mode', 'insertComponents', 'useComponentAsReference', 'manifest'].includes(key));
  if (unknown) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unknown generation option: ${unknown}`, { at: unknown, hint: 'remove the unsupported option' });
  for (const key of ['insertComponents', 'useComponentAsReference', 'manifest'] as const) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `${key} must be a boolean`, { at: key });
  let source: OpenApiDocument;
  try { source = typeof input === 'string' ? JSON.parse(input) as OpenApiDocument : input; }
  catch (error) { throw asZopiaError(error, 'ZOPIA_SPEC_INVALID_JSON', 'invalid OpenAPI JSON text', { at: '#', hint: 'fix the JSON syntax' }); }
  if (options.useComponentAsReference && !options.insertComponents) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'useComponentAsReference requires insertComponents', { at: 'useComponentAsReference', hint: 'enable `insertComponents` first' });
  const mode = options.mode ?? 'directory';
  const insertComponents = options.insertComponents === true;
  const useComponentAsReference = options.useComponentAsReference === true;
  const retainManifest = options.manifest !== false;
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const componentNames = insertComponents ? Object.keys(schemas).sort() : [];
  const reservedFiles = componentNames.map((name) => `components/${name}/index.ts`);
  if (insertComponents) {
    reservedFiles.push('components/index.ts');
    const declaredReusable = reusableDeclarations(source);
    for (const [directory, map, derive] of [['components/parameters', declaredReusable.parameter, deriveReusableParameterSchema], ['components/responses', declaredReusable.response, deriveReusableResponseSchema]] as const) {
      const names = Object.keys(map).sort().filter((name) => {
        const value = map[name];
        if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return true; // surfaced later as a typed derivation error
        return derive === deriveReusableParameterSchema || derive(source, name, value) !== undefined;
      });
      if (!names.length) continue;
      reservedFiles.push(`${directory}/index.ts`, ...names.map((name) => `${directory}/${name}/index.ts`));
    }
  }
  if (retainManifest) reservedFiles.push(ZOPIA_MANIFEST_FILE);
  const plans = avoidReservedFileCollisions(planApiDocsFiles(source, mode), reservedFiles);
  const webhookPlans = avoidReservedFileCollisions(planWebhookDocsFiles(source, mode), [...reservedFiles, ...plans.map((plan) => plan.file)]);
  const previous = await inspectZopiaManifestStaleness(options.outputDir, {
    sourceSha256: hashOpenApiDocument(source),
    mode,
    insertComponents,
    useComponentAsReference,
    manifest: retainManifest,
  });
  const manifest = retainManifest ? createZopiaManifest(source, plans, {
    mode,
    insertComponents,
    useComponentAsReference,
  }, webhookPlans) : undefined;
  const root = resolve(options.outputDir);
  const previouslyOwned = new Set(previous.ownedFiles);
  const renderedEndpoints = plans.map((plan) => ({ plan, content: renderEndpoint(plan, source, mode, useComponentAsReference) }));
  const renderedWebhooks = webhookPlans.map((plan) => ({ plan, content: renderEndpoint(plan, source, mode, useComponentAsReference, webhookRuntimePath(plan.path)) }));
  const generated: GeneratedApiDocsFile[] = [];
  if (insertComponents) {
    const componentExports = new Map<string, string>();
    const componentDirectories = new Map<string, string>();
    for (const name of componentNames) {
      if (name.toLowerCase() === 'index.ts') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component file name collides with the barrel: ${name}`);
      const existingDirectory = componentDirectories.get(name.toLowerCase());
      if (existingDirectory) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component file name collision: ${existingDirectory} and ${name}`);
      componentDirectories.set(name.toLowerCase(), name);
      const componentExport = componentExportName(name);
      const previous = componentExports.get(componentExport);
      if (previous) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component export name collision: ${previous} and ${name}`);
      componentExports.set(componentExport, name);
    }
    const renderedComponents = componentNames.map((name) => {
      if (name.includes('/') || !isPortableApiDocsSegment(name)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsafe component name: ${name}`);
      return { name, content: renderComponent(name, schemas[name], source) };
    });
    for (const { name, content } of renderedComponents) {
      const file = `components/${name}/index.ts`;
      const absolutePath = await writeGeneratedFile(root, file, content, previouslyOwned);
      generated.push({ file, absolutePath, operationId: name });
    }
    const barrel = componentNames.map((name) => `export { ${componentExportName(name)} } from ${JSON.stringify(`./${name}/index`)};`).join('\n') + (componentNames.length ? '\n' : '');
    const barrelFile = 'components/index.ts';
    const barrelPath = await writeGeneratedFile(root, barrelFile, barrel, previouslyOwned);
    generated.push({ file: barrelFile, absolutePath: barrelPath, operationId: 'components' });
  }
  if (insertComponents) {
    const swagger = source.swagger === '2.0';
    const declarations = reusableDeclarations(source);
    for (const table of [
      { kind: 'parameter', directory: 'components/parameters', raw: swagger ? source.parameters : source.components?.parameters, containerAt: swagger ? '#/parameters' : '#/components/parameters', declared: declarations.parameter, exportNameFor: componentParameterExportName, derive: deriveReusableParameterSchema },
      { kind: 'response', directory: 'components/responses', raw: swagger ? source.responses : source.components?.responses, containerAt: swagger ? '#/responses' : '#/components/responses', declared: declarations.response, exportNameFor: componentResponseExportName, derive: deriveReusableResponseSchema },
    ] as const) {
      if (table.raw !== undefined && (!table.raw || typeof table.raw !== 'object' || Array.isArray(table.raw))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid reusable ${table.kind} components: expected an object`, { at: table.containerAt });
      const names = Object.keys(table.declared).sort();
      if (!names.length) continue;
      const exportUses = new Map<string, string>();
      const directories = new Map<string, string>();
      for (const name of names) {
        if (name.toLowerCase() === 'index.ts') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component file name collides with the barrel: ${name}`);
        const previousDirectory = directories.get(name.toLowerCase());
        if (previousDirectory) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component file name collision: ${previousDirectory} and ${name}`);
        directories.set(name.toLowerCase(), name);
        const exportId = table.exportNameFor(name);
        const previousExport = exportUses.get(exportId);
        if (previousExport) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component export name collision: ${previousExport} and ${name}`);
        exportUses.set(exportId, name);
      }
      const derived = new Map(names.map((name) => [name, table.derive(source, name, table.declared[name])]));
      // Schema-less responses render `z.void()` at use sites — there is no shared schema to centralize (D-18).
      const emitted = names.filter((name) => table.kind === 'parameter' || derived.get(name) !== undefined);
      if (!emitted.length) continue;
      for (const name of emitted) {
        if (name.includes('/') || !isPortableApiDocsSegment(name)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsafe component name: ${name}`);
        const absolutePath = await writeGeneratedFile(root, `${table.directory}/${name}/index.ts`, renderComponent(name, derived.get(name), source, table.exportNameFor, '../../'), previouslyOwned);
        generated.push({ file: `${table.directory}/${name}/index.ts`, absolutePath, operationId: name });
      }
      const barrel = emitted.map((name) => `export { ${table.exportNameFor(name)} } from ${JSON.stringify(`./${name}/index`)};`).join('\n') + '\n';
      const barrelFile = `${table.directory}/index.ts`;
      const barrelPath = await writeGeneratedFile(root, barrelFile, barrel, previouslyOwned);
      generated.push({ file: barrelFile, absolutePath: barrelPath, operationId: table.directory });
    }
  }
  for (const { plan, content } of renderedEndpoints) {
    const absolutePath = await writeGeneratedFile(root, plan.file, content, previouslyOwned);
    generated.push({ file: plan.file, absolutePath, operationId: plan.operationId });
  }
  for (const { plan, content } of renderedWebhooks) {
    const absolutePath = await writeGeneratedFile(root, plan.file, content, previouslyOwned);
    generated.push({ file: plan.file, absolutePath, operationId: plan.operationId });
  }
  if (manifest) {
    const manifestPath = await writeZopiaManifest(root, manifest);
    generated.push({ file: ZOPIA_MANIFEST_FILE, absolutePath: manifestPath, operationId: 'manifest' });
  }
  await removeObsoleteManifestFiles(root, previous.ownedFiles, generated.map(({ file }) => file));
  return generated;
}
