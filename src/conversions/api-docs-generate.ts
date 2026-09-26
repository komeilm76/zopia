import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { asZopiaError, ZopiaError } from '../errors';
import { buildOpenApiOperationIR } from './openapi-ir';
import { extractOperationContracts } from './openapi-contracts';
import { jsonSchemaToZod } from './json-schema-to-zod';
import { planApiDocsFiles } from './api-docs-plan';
import type { ApiDocsMode } from './api-docs-layout';
import type { OpenApiDocument } from './openapi';
import { createZopiaManifest, hashOpenApiDocument, writeZopiaManifest, ZOPIA_MANIFEST_FILE } from './manifest-writer';
import { inspectZopiaManifestStaleness, removeObsoleteManifestFiles } from './manifest-staleness';
import { formatZopiaWarningComment } from '../warnings';
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
  /** Endpoint layout mode. */
  mode?: ApiDocsMode;
  /** Whether component files are emitted. */
  insertComponents?: boolean;
  /** Whether endpoint schemas import emitted components. */
  useComponentAsReference?: boolean;
  /** Whether the reverse-conversion manifest is emitted. */
  manifest?: boolean;
}

function componentTarget(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const prefix = ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  return prefix ? decodeJsonPointerSegment(ref.slice(prefix.length), ref) : undefined;
}
function componentExport(ref: unknown): string | undefined {
  const target = componentTarget(ref); return target === undefined ? undefined : `${exportName(target)}Schema`;
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
  const converted = jsonSchemaToZod(schema === undefined || schema === null ? true : schema as any, { rootName: safeName });
  const source = converted.code.trimEnd();
  const direct = source.match(new RegExp(`^const ${safeName.replace(/[$]/g, '\\$&')} = ([\\s\\S]*);$`));
  return direct ? direct[1] : `(() => { ${source} return ${safeName}; })()`;
}

function generatedWarningComments(schema: unknown, name: string): string {
  const result = jsonSchemaToZod(schema === undefined || schema === null ? true : schema as any, { rootName: exportName(name) });
  if (result.warnings.length === 0) return '';
  return `${result.warnings.map((warning) => formatZopiaWarningComment(warning, 'schema')).join('\n')}\n`;
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
function objectConstraints(expression: string, schema: Record<string, unknown>): string {
  let constrained = expression;
  if (typeof schema.minProperties === 'number') constrained += `.refine((value) => Object.keys(value).length >= ${schema.minProperties}).meta({ minProperties: ${schema.minProperties} })`;
  if (typeof schema.maxProperties === 'number') constrained += `.refine((value) => Object.keys(value).length <= ${schema.maxProperties}).meta({ maxProperties: ${schema.maxProperties} })`;
  return constrained;
}
function componentMetadata(expression: string, schema: unknown): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return expression;
  const object = schema as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'examples'] as const) if (Object.prototype.hasOwnProperty.call(object, key)) metadata[key] = object[key];
  if (!Object.prototype.hasOwnProperty.call(metadata, 'examples') && Object.prototype.hasOwnProperty.call(object, 'example')) metadata.examples = [object.example];
  return Object.keys(metadata).length ? `${expression}.meta(${JSON.stringify(metadata)})` : expression;
}
function componentReaches(source: OpenApiDocument, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const schema = schemas[from];
  if (!schema || typeof schema !== 'object') return false;
  const refs: string[] = [];
  const visit = (value: unknown): void => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(visit); return; } const ref = componentTarget((value as any).$ref); if (ref) refs.push(ref); Object.values(value as Record<string, unknown>).forEach(visit); };
  visit(schema);
  return refs.some((ref) => componentReaches(source, ref, target, seen));
}
function renderNestedSchema(value: unknown, name: string, imports: Map<string, string>, stack = new Set<string>(), source?: OpenApiDocument, root?: string): string {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
  if (object?.const !== undefined) {
    const value = object.const;
    return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? `z.literal(${JSON.stringify(value)})` : `${schemaCode(object, name)}.meta({ const: ${JSON.stringify(value)} })`;
  }
  if (Array.isArray(object?.enum)) {
    const values = object.enum;
    if (values.every((value: unknown) => typeof value === 'string')) return `z.enum(${JSON.stringify(values)})`;
    if (values.every((value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value))) return `z.union([${values.map((value: unknown) => `z.literal(${JSON.stringify(value)})`).join(', ')}])`;
    return `${schemaCode(object, name)}.meta({ enum: ${JSON.stringify(values)} })`;
  }
  if (object?.nullable === true) {
    const withoutNullable = { ...object }; delete withoutNullable.nullable;
    return `z.nullable(${renderNestedSchema(withoutNullable, name, imports, stack, source, root)})`;
  }
  const target = componentTarget(object?.$ref);
  if (target) {
    const ref = `${exportName(target)}Schema`;
    imports.set(ref, target);
    return source && root && componentReaches(source, target, root) ? `z.lazy(() => ${ref})` : ref;
  }
  if (Array.isArray(object?.oneOf) || Array.isArray(object?.anyOf)) {
    const choices = (object.oneOf ?? object.anyOf).map((child: unknown, index: number) => renderNestedSchema(child, `${name}Choice${index}`, imports, stack, source, root));
    return `z.union([${choices.join(', ')}])`;
  }
  if (Array.isArray(object?.allOf)) {
    const choices = object.allOf.map((child: unknown, index: number) => renderNestedSchema(child, `${name}Part${index}`, imports, stack, source, root));
    return choices.length === 0 ? 'z.never()' : choices.slice(1).reduce((left: string, right: string) => `z.intersection(${left}, ${right})`, choices[0]);
  }
  if (object?.type === 'array' && Array.isArray(object.prefixItems)) {
    const minimum = typeof object.minItems === 'number' ? object.minItems : 0;
    const items = object.prefixItems.map((item: unknown, index: number) => {
      const rendered = renderNestedSchema(item, `${name}Item${index}`, imports, stack, source, root);
      return index < minimum ? rendered : `${rendered}.optional()`;
    });
    const hasItems = Object.prototype.hasOwnProperty.call(object, 'items');
    const restSchema = hasItems ? object.items : object.unevaluatedItems;
    const allowsRest = restSchema !== false;
    const rest = allowsRest ? `.rest(${restSchema && typeof restSchema === 'object' ? renderNestedSchema(restSchema, `${name}Rest`, imports, stack, source, root) : 'z.unknown()'})` : '';
    let expression = `z.tuple([${items.join(', ')}])${rest}`;
    if (minimum > object.prefixItems.length) expression += `.refine((items) => items.length >= ${minimum})`;
    if (typeof object.maxItems === 'number') expression += `.refine((items) => items.length <= ${object.maxItems})`;
    const metadata = Object.fromEntries(['prefixItems', 'items', 'minItems', 'maxItems', 'unevaluatedItems'].filter((key) => Object.prototype.hasOwnProperty.call(object, key)).map((key) => [key, object[key]]));
    return `${expression}.meta(${JSON.stringify(metadata)})`;
  }
  if (object?.type === 'array' && object.items !== undefined) {
    let expression = `z.array(${renderNestedSchema(object.items, `${name}Item`, imports, stack, source, root)})`;
    if (typeof object.minItems === 'number') expression += `.min(${object.minItems})`;
    if (typeof object.maxItems === 'number') expression += `.max(${object.maxItems})`;
    if (object.uniqueItems === true) expression += `.refine((items) => new Set(items.map((item) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))).size === items.length).meta({ uniqueItems: true })`;
    return expression;
  }
  if (object?.type === 'object' && object.properties && typeof object.properties === 'object') {
    const required = new Set(Array.isArray(object.required) ? object.required : []);
    const fields = Object.entries(object.properties).map(([key, child]) => `[${JSON.stringify(key)}]: ${renderNestedSchema(child, `${name}${key}`, imports, stack, source, root)}${required.has(key) ? '' : '.optional()'}`);
    const additionalValue = object.additionalProperties;
    const additional = additionalValue && typeof additionalValue === 'object' ? `.catchall(${renderNestedSchema(additionalValue, `${name}Additional`, imports, stack, source, root)})` : additionalValue === false ? '.strict()' : additionalValue === undefined || additionalValue === true ? '.passthrough()' : '';
    return objectConstraints(`z.object({ ${fields.join(', ')} })${additional}`, object);
  }
  return schemaCode(value, name);
}
function renderComponent(name: string, schema: unknown, source: OpenApiDocument): string {
  const componentName = `${exportName(name)}Schema`;
  const warningComments = generatedWarningComments(schema, componentName);
  const directTarget = componentTarget(schema && typeof schema === 'object' ? (schema as any).$ref : undefined);
  const directRef = directTarget === undefined ? undefined : `${exportName(directTarget)}Schema`;
  const directSiblings = schema && typeof schema === 'object' && !Array.isArray(schema) ? Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) : {};
  const directMetadata = Object.keys(directSiblings).length ? `.meta(${JSON.stringify(directSiblings)})` : '';
  if (directRef && directRef !== componentName) return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\nimport { ${directRef} } from ${JSON.stringify(`../${directTarget}/index`)};\n\n${warningComments}export const ${componentName} = z.lazy(() => ${directRef})${directMetadata};\n\nexport default ${componentName};\n`;
  if (directRef === componentName) return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n\n${warningComments}export const ${componentName} = z.lazy(() => ${componentName})${directMetadata};\n\nexport default ${componentName};\n`;
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && (schema as any).type === 'array') {
    const imports = new Map<string, string>();
    const expression = componentMetadata(renderNestedSchema(schema, name, imports, new Set([name]), source, name), schema);
    const importLine = [...imports.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([ref]) => ref !== componentName).map(([ref, target]) => `import { ${ref} } from ${JSON.stringify(`../${target}/index`)};`).join('\n');
    return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n${importLine}${importLine ? '\n' : ''}\n${warningComments}export const ${componentName} = ${expression};\n\nexport default ${componentName};\n`;
  }
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && (schema as any).type === 'object' && ((schema as any).properties && typeof (schema as any).properties === 'object' || (schema as any).additionalProperties !== undefined)) {
    const properties = ((schema as any).properties ?? {}) as Record<string, unknown>;
    const imports = new Map<string, string>();
    const required = new Set(Array.isArray((schema as any).required) ? (schema as any).required : []);
    const fields = Object.entries(properties).map(([key, value]) => `[${JSON.stringify(key)}]: ${renderNestedSchema(value, `${name}${key}`, imports, new Set([name]), source, name)}${required.has(key) ? '' : '.optional()'}`).join(', ');
    const additionalValue = (schema as any).additionalProperties;
    const additional = additionalValue && typeof additionalValue === 'object' ? ` .catchall(${renderNestedSchema(additionalValue, `${name}Additional`, imports, new Set([name]), source, name)})` : additionalValue === false ? ' .strict()' : additionalValue === undefined || additionalValue === true ? ' .passthrough()' : '';
    const importLine = [...imports.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([ref]) => ref !== componentName).map(([ref, target]) => `import { ${ref} } from ${JSON.stringify(`../${target}/index`)};`).join('\n');
    const expression = componentMetadata(objectConstraints(imports.has(componentName) ? `z.lazy(() => z.object({ ${fields} })${additional})` : `z.object({ ${fields} })${additional}`, schema as Record<string, unknown>), schema);
    return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n${importLine}${importLine ? '\n' : ''}\n${warningComments}export const ${componentName} = ${expression};\n\nexport default ${componentName};\n`;
  }
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const normalized = JSON.parse(JSON.stringify(schema, (_key, value) => typeof value === 'string' && (value.startsWith('#/components/schemas/') || value.startsWith('#/definitions/')) ? `#/$defs/${value.includes('/components/schemas/') ? value.slice('#/components/schemas/'.length) : value.slice('#/definitions/'.length)}` : value));
  const componentInput = typeof normalized === 'boolean' || collectComponentRefs(schema).size === 0 ? normalized : { ...(normalized as any), $defs: schemas };
  const converted = schemaCode(componentInput, componentName);
  return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n\nexport const ${exportName(name)}Schema = ${converted};\n\nexport default ${exportName(name)}Schema;\n`;
}
function renderEndpoint(operation: any, source: OpenApiDocument, mode: ApiDocsMode = 'directory', useComponents = false): string {
  const ir = buildOpenApiOperationIR(source).find((candidate) => candidate.operationId === operation.operationId && candidate.path === operation.path && candidate.method.toLowerCase() === operation.method);
  if (!ir) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unable to build operation IR: ${operation.operationId}`);
  const contracts = extractOperationContracts(ir);
  const componentRefs = useComponents ? collectComponentRefs({ operation: operation.operation, parameters: ir.parameters }) : new Set<string>();
  const componentSchema = (schema: unknown, fallback: string) => {
    if (useComponents) {
      const replacements = new Map<string, string>(); let markerIndex = 0;
      const rewrite = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rewrite);
        if (!value || typeof value !== 'object') return value;
        const object = value as Record<string, unknown>;
        const component = componentExport(object.$ref);
        if (component) {
          componentRefs.add(component);
          let marker = `__zopia_component_reference_${markerIndex++}__`;
          const serialized = JSON.stringify(value) ?? '';
          while (serialized.includes(JSON.stringify(marker))) marker = `__zopia_component_reference_${markerIndex++}__`;
          replacements.set(marker, component);
          const siblings = Object.fromEntries(Object.entries(object).filter(([key]) => key !== '$ref').map(([key, child]) => [key, rewrite(child)]));
          if (Object.keys(siblings).length === 0) return { const: marker };
          const existingAllOf = siblings.allOf; delete siblings.allOf;
          const allOf: unknown[] = [{ const: marker }];
          if (Array.isArray(existingAllOf)) allOf.push(...existingAllOf);
          else if (existingAllOf !== undefined) allOf.push({ allOf: existingAllOf });
          return { ...siblings, allOf };
        }
        return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, rewrite(child)]));
      };
      let code = schemaCode(rewrite(schema), fallback);
      for (const [marker, component] of replacements) code = code.split(`z.literal(${JSON.stringify(marker)})`).join(component);
      return code;
    }
    const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
    const schemaObject = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema as Record<string, unknown> : undefined;
    const ownDefinitions = schemaObject?.$defs && typeof schemaObject.$defs === 'object' && !Array.isArray(schemaObject.$defs) ? schemaObject.$defs as Record<string, unknown> : {};
    let namespace = '__zopiaComponents';
    while (Object.prototype.hasOwnProperty.call(ownDefinitions, namespace)) namespace += '_';
    const escapePointer = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');
    const normalizeRefs = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalizeRefs);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        if (key === '$ref') {
          const target = componentTarget(child);
          if (target !== undefined) return [key, `#/$defs/${namespace}/${escapePointer(target)}`];
        }
        return [key, normalizeRefs(child)];
      }));
    };
    const normalized = normalizeRefs(schema);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return schemaCode(normalized, fallback);
    if (collectComponentRefs(schema).size === 0) return schemaCode(normalized, fallback);
    const normalizedComponents = Object.fromEntries(Object.entries(schemas).map(([name, component]) => [name, normalizeRefs(component)]));
    return schemaCode({ ...(normalized as Record<string, unknown>), $defs: { ...ownDefinitions, [namespace]: normalizedComponents } }, fallback);
  };
  const params = (location: string) => contracts.parameters.filter((p) => p.in === location).map((p) => `[${JSON.stringify(p.name)}]: ${componentSchema(p.schema, `param${p.name.replace(/[^A-Za-z0-9]/g, '') || 'Value'}`)}${p.required ? '' : '.optional()'}`).join(', ');
  const rawRequestSchema = contracts.requestBody?.schema;
  const request = `request: { body: ${contracts.requestBody ? componentSchema(rawRequestSchema, 'requestBody') : 'z.any()'},  params: z.object({ ${params('path')} }), query: z.object({ ${params('query')} }), headers: z.object({ ${params('header')} }), cookies: z.object({ ${params('cookie')} }) }`;
  const response = contracts.responses.map((r) => `${quoteStatus(r.status)}: ${r.schema === undefined ? 'z.void()' : componentSchema(r.schema, `response${r.status.replace(/[^A-Za-z0-9]/g, '') || 'Default'}`)}`).join(', ');
  const responseContentType = contracts.responses.find((r) => r.contentType)?.contentType;
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
  const componentImport = useComponents && componentRefs.size ? `\nimport { ${[...componentRefs].sort().join(', ')} } from '${'../'.repeat(mode === 'flat' ? 2 : operation.path.split('/').filter(Boolean).length + 1)}components/index';` : '';
  return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\nimport { makeApiConfig } from 'km-api';${componentImport}\n\nexport const ${exportId} = makeApiConfig({\n  method: ${JSON.stringify(operation.method.toUpperCase())},\n  pathShape: ${JSON.stringify(operation.path)},\n  operationId: ${JSON.stringify(opId)},\n  ${contracts.requestBody ? `requestContentType: ${JSON.stringify(contracts.requestBody.contentType)},` : ''}\n  ${responseContentType ? `responseContentType: ${JSON.stringify(responseContentType)},` : ''}\n  ${ir.deprecated ? "deprecated: 'YES'," : ''}\n  auth: ${JSON.stringify(auth)},\n  summary: ${JSON.stringify(operation.operation.summary ?? '')},\n  description: ${JSON.stringify(operation.operation.description ?? '')},\n  tags: ${JSON.stringify(tags)},\n  ${examples}\n  ${request},\n  response: { ${response} },\n});\n\nexport default ${exportId};\n// Source: ${sourceName}\n`;
}

/** Generate the planned endpoint files on disk. Existing generated files are overwritten. */
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
  const plans = planApiDocsFiles(source, mode);
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
  }) : undefined;
  const root = resolve(options.outputDir);
  const previouslyOwned = new Set(previous.ownedFiles);
  const generated: GeneratedApiDocsFile[] = [];
  if (insertComponents) {
    const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
    const names = Object.keys(schemas).sort();
    const componentExports = new Map<string, string>();
    for (const name of names) {
      const componentExport = `${exportName(name)}Schema`;
      const previous = componentExports.get(componentExport);
      if (previous) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Component export name collision: ${previous} and ${name}`);
      componentExports.set(componentExport, name);
    }
    const renderedComponents = names.map((name) => {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsafe component name: ${name}`);
      return { name, content: renderComponent(name, schemas[name], source) };
    });
    for (const { name, content } of renderedComponents) {
      const file = `components/${name}/index.ts`;
      const absolutePath = await writeGeneratedFile(root, file, content, previouslyOwned);
      generated.push({ file, absolutePath, operationId: name });
    }
    const barrel = names.map((name) => `export { ${exportName(name)}Schema } from ${JSON.stringify(`./${name}/index`)};`).join('\n') + (names.length ? '\n' : '');
    const barrelFile = 'components/index.ts';
    const barrelPath = await writeGeneratedFile(root, barrelFile, barrel, previouslyOwned);
    generated.push({ file: barrelFile, absolutePath: barrelPath, operationId: 'components' });
  }
  for (const plan of plans) {
    const absolutePath = await writeGeneratedFile(root, plan.file, renderEndpoint(plan, source, mode, useComponentAsReference), previouslyOwned);
    generated.push({ file: plan.file, absolutePath, operationId: plan.operationId });
  }
  if (manifest) {
    const manifestPath = await writeZopiaManifest(root, manifest);
    generated.push({ file: ZOPIA_MANIFEST_FILE, absolutePath: manifestPath, operationId: 'manifest' });
  }
  await removeObsoleteManifestFiles(root, previous.ownedFiles, generated.map(({ file }) => file));
  return generated;
}
