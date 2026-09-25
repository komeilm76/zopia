import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { buildOpenApiOperationIR } from './openapi-ir';
import { extractOperationContracts } from './openapi-contracts';
import { jsonSchemaToZod } from './json-schema-to-zod';
import { planApiDocsFiles } from './api-docs-plan';
import type { ApiDocsMode } from './api-docs-layout';
import type { OpenApiDocument } from './openapi';
import { resolveOpenApiLocalRef } from './openapi-ref';

export interface GeneratedApiDocsFile { file: string; absolutePath: string; operationId: string; }
export interface GenerateApiDocsOptions { outputDir: string; mode?: ApiDocsMode; insertComponents?: boolean; useComponentAsReference?: boolean; manifest?: boolean; }

function componentTarget(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const prefix = ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  return prefix ? ref.slice(prefix.length) : undefined;
}
function componentExport(ref: unknown): string | undefined {
  const target = componentTarget(ref); return target === undefined ? undefined : `${exportName(target)}Schema`;
}
function collectComponentRefs(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectComponentRefs(item, names));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (key === '$ref') { const name = componentExport(child); if (name) names.add(name); }
    else collectComponentRefs(child, names);
  }
  return names;
}
function collectRefs(value: unknown, at = ''): Array<{ at: string; ref: string; component?: string }> {
  const refs: Array<{ at: string; ref: string; component?: string }> = [];
  if (Array.isArray(value)) value.forEach((child, index) => refs.push(...collectRefs(child, `${at}/${index}`)));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    const location = `${at}/${key}`;
    if (key === '$ref' && typeof child === 'string') refs.push({ at: location, ref: child, ...(componentExport(child) ? { component: componentExport(child)!.replace(/Schema$/, '') } : {}) });
    else refs.push(...collectRefs(child, location));
  }
  return refs;
}
function schemaCode(schema: unknown, name: string): string {
  const safeName = exportName(name);
  return jsonSchemaToZod(schema === undefined || schema === null ? true : schema as any, { rootName: safeName }).code.replace(/^const [^=]+ = /, '').replace(/;$/, '');
}
function stableStringify(value: unknown, seen = new Set<object>()): string {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Cannot hash a circular OpenAPI document');
    seen.add(value); const result = `[${value.map((item) => stableStringify(item, seen)).join(',')}]`; seen.delete(value); return result;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Cannot hash a circular OpenAPI document');
    seen.add(value); const result = `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key], seen)}`).join(',')}}`; seen.delete(value); return result;
  }
  const result = JSON.stringify(value); if (result === undefined) throw new TypeError('Cannot hash an unsupported OpenAPI value'); return result;
}
function quoteStatus(status: string): string { return /^\d+$/.test(status) ? status : JSON.stringify(status); }
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
  if (object?.const !== undefined) return `z.literal(${JSON.stringify(object.const)})`;
  if (Array.isArray(object?.enum)) {
    const values = object.enum;
    return values.every((value: unknown) => typeof value === 'string') ? `z.enum(${JSON.stringify(values)})` : `z.union([${values.map((value: unknown) => `z.literal(${JSON.stringify(value)})`).join(', ')}])`;
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
    const items = object.prefixItems.map((item: unknown, index: number) => renderNestedSchema(item, `${name}Item${index}`, imports, stack, source, root));
    const restSchema = object.items !== undefined && object.items !== false ? object.items : object.unevaluatedItems;
    const rest = restSchema && typeof restSchema === 'object' ? `.rest(${renderNestedSchema(restSchema, `${name}Rest`, imports, stack, source, root)})` : '';
    let expression = `z.tuple([${items.join(', ')}])${rest}`;
    if (typeof object.minItems === 'number') expression += `.refine((items) => items.length >= ${object.minItems})`;
    if (typeof object.maxItems === 'number') expression += `.refine((items) => items.length <= ${object.maxItems})`;
    return expression;
  }
  if (object?.type === 'array' && object.items !== undefined) {
    let expression = `z.array(${renderNestedSchema(object.items, `${name}Item`, imports, stack, source, root)})`;
    if (typeof object.minItems === 'number') expression += `.min(${object.minItems})`;
    if (typeof object.maxItems === 'number') expression += `.max(${object.maxItems})`;
    if (object.uniqueItems === true) expression += `.refine((items) => new Set(items.map((item) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))).size === items.length)`;
    return expression;
  }
  if (object?.type === 'object' && object.properties && typeof object.properties === 'object') {
    const required = new Set(Array.isArray(object.required) ? object.required : []);
    const fields = Object.entries(object.properties).map(([key, child]) => `${JSON.stringify(key)}: ${renderNestedSchema(child, `${name}${key}`, imports, stack)}${required.has(key) ? '' : '.optional()'}`);
    return `z.object({ ${fields.join(', ')} })`;
  }
  return schemaCode(value, name);
}
function renderComponent(name: string, schema: unknown, source: OpenApiDocument): string {
  const componentName = `${exportName(name)}Schema`;
  const directTarget = componentTarget(schema && typeof schema === 'object' ? (schema as any).$ref : undefined);
  const directRef = directTarget === undefined ? undefined : `${exportName(directTarget)}Schema`;
  if (directRef && directRef !== componentName) return `/** Generated by zopia — do not edit by hand. */\nimport { ${directRef} } from ${JSON.stringify(`../${directTarget}/index`)};\n\nexport const ${componentName} = ${directRef};\n\nexport default ${componentName};\n`;
  if (directRef === componentName) return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n\nexport const ${componentName} = z.lazy(() => ${componentName});\n\nexport default ${componentName};\n`;
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && (schema as any).type === 'array') {
    const imports = new Map<string, string>();
    const expression = renderNestedSchema(schema, name, imports, new Set([name]), source, name);
    const importLine = [...imports.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([ref]) => ref !== componentName).map(([ref, target]) => `import { ${ref} } from ${JSON.stringify(`../${target}/index`)};`).join('\\n');
    return `/** Generated by zopia — do not edit by hand. */\\nimport { z } from 'zod';\\n${importLine}${importLine ? '\\n' : ''}\\nexport const ${componentName} = ${expression};\\n\\nexport default ${componentName};\\n`;
  }
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && (schema as any).type === 'object' && ((schema as any).properties && typeof (schema as any).properties === 'object' || (schema as any).additionalProperties !== undefined)) {
    const properties = ((schema as any).properties ?? {}) as Record<string, unknown>;
    const imports = new Map<string, string>();
    const required = new Set(Array.isArray((schema as any).required) ? (schema as any).required : []);
    const fields = Object.entries(properties).map(([key, value]) => `${JSON.stringify(key)}: ${renderNestedSchema(value, `${name}${key}`, imports, new Set([name]), source, name)}${required.has(key) ? '' : '.optional()'}`).join(', ');
    const importLine = [...imports.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([ref]) => ref !== componentName).map(([ref, target]) => `import { ${ref} } from ${JSON.stringify(`../${target}/index`)};`).join('\\n');
    const additionalValue = (schema as any).additionalProperties;
    const additional = additionalValue && typeof additionalValue === 'object' ? ` .catchall(${renderNestedSchema(additionalValue, `${name}Additional`, imports)})` : additionalValue === false ? ' .strict()' : additionalValue === undefined ? ' .passthrough()' : '';
    const expression = imports.has(componentName) ? `z.lazy(() => z.object({ ${fields} })${additional})` : `z.object({ ${fields} })${additional}`;
    return `/** Generated by zopia — do not edit by hand. */\\nimport { z } from 'zod';\\n${importLine}${importLine ? '\\n' : ''}\\nexport const ${componentName} = ${expression};\\n\\nexport default ${componentName};\\n`;
  }
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const normalized = JSON.parse(JSON.stringify(schema, (_key, value) => typeof value === 'string' && (value.startsWith('#/components/schemas/') || value.startsWith('#/definitions/')) ? `#/$defs/${value.includes('/components/schemas/') ? value.slice('#/components/schemas/'.length) : value.slice('#/definitions/'.length)}` : value));
  const componentInput = typeof normalized === 'boolean' ? normalized : { ...(normalized as any), $defs: schemas };
  const converted = jsonSchemaToZod(componentInput as any, { rootName: componentName }).code.replace(/^const [^=]+ = /, '').replace(/;$/, '');
  return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n\nexport const ${exportName(name)}Schema = ${converted};\n\nexport default ${exportName(name)}Schema;\n`;
}
function renderEndpoint(operation: any, source: OpenApiDocument, mode: ApiDocsMode = 'directory', useComponents = false): string {
  const ir = buildOpenApiOperationIR(source).find((candidate) => candidate.operationId === operation.operationId && candidate.path === operation.path && candidate.method.toLowerCase() === operation.method);
  if (!ir) throw new TypeError(`Unable to build operation IR: ${operation.operationId}`);
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
    const normalizedComponents = Object.fromEntries(Object.entries(schemas).map(([name, component]) => [name, normalizeRefs(component)]));
    return schemaCode({ ...(normalized as Record<string, unknown>), $defs: { ...ownDefinitions, [namespace]: normalizedComponents } }, fallback);
  };
  const params = (location: string) => contracts.parameters.filter((p) => p.in === location).map((p) => `${JSON.stringify(p.name)}: ${componentSchema(p.schema, `param${p.name.replace(/[^A-Za-z0-9]/g, '') || 'Value'}`)}${p.required ? '' : '.optional()'}`).join(', ');
  const rawRequestSchema = resolveObject(operation.operation.requestBody, source)?.content ? (Object.values(resolveObject(operation.operation.requestBody, source).content)[0] as any)?.schema : undefined;
  const request = `request: { body: ${contracts.requestBody ? componentSchema(rawRequestSchema, 'requestBody') : 'z.any()'},  params: z.object({ ${params('path')} }), query: z.object({ ${params('query')} }), headers: z.object({ ${params('header')} }), cookies: z.object({ ${params('cookie')} }) }`;
  const response = contracts.responses.map((r) => { const raw = resolveObject(operation.operation.responses?.[r.status], source); const rawSchema = raw?.content ? (Object.values(raw.content)[0] as any)?.schema : raw?.schema; return `${quoteStatus(r.status)}: ${r.schema === undefined ? 'z.void()' : componentSchema(rawSchema, `response${r.status.replace(/[^A-Za-z0-9]/g, '') || 'Default'}`)}`; }).join(', ');
  const responseContentType = contracts.responses.find((r) => r.contentType)?.contentType;
  const requestExamples: Record<string, unknown> = {};
  const requestBody = resolveObject(operation.operation.requestBody, source);
  const requestMedia = requestBody?.content ? Object.values(requestBody.content as Record<string, any>)[0] as any : undefined;
  if (requestMedia?.example !== undefined) requestExamples.default = { value: requestMedia.example };
  if (requestMedia?.examples && typeof requestMedia.examples === 'object') Object.assign(requestExamples, requestMedia.examples);
  const responseExamples: Record<string, unknown> = {};
  for (const [status, value] of Object.entries(operation.operation.responses ?? {})) {
    const raw = resolveObject(value, source);
    const media = raw && typeof raw === 'object' && (raw as any).content ? Object.values((raw as any).content)[0] as any : undefined;
    if (media?.example !== undefined) responseExamples[status] = { default: { value: media.example } };
    if (media?.examples && typeof media.examples === 'object') responseExamples[status] = media.examples;
    const legacyExamples = raw && typeof raw === 'object' ? (raw as any).examples : undefined;
    if (legacyExamples && typeof legacyExamples === 'object') responseExamples[status] = Object.fromEntries(Object.entries(legacyExamples).map(([contentType, value]) => [contentType, { value }]));
  }
  const examples = Object.keys(requestExamples).length || Object.keys(responseExamples).length ? `examples: ${JSON.stringify({ ...(Object.keys(requestExamples).length ? { request: requestExamples } : {}), ...(Object.keys(responseExamples).length ? { response: responseExamples } : {}) })},` : '';
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
  if (!options || typeof options.outputDir !== 'string' || !options.outputDir) throw new TypeError('outputDir is required');
  const source = typeof input === 'string' ? JSON.parse(input) : input;
  if (options.useComponentAsReference && !options.insertComponents) throw new TypeError('useComponentAsReference requires insertComponents');
  const plans = planApiDocsFiles(source, options.mode ?? 'directory');
  const root = resolve(options.outputDir); const generated: GeneratedApiDocsFile[] = [];
  if (options.insertComponents) {
    const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
    const names = Object.keys(schemas).sort();
    const componentExports = new Map<string, string>();
    for (const name of names) {
      const componentExport = `${exportName(name)}Schema`;
      const previous = componentExports.get(componentExport);
      if (previous) throw new TypeError(`Component export name collision: ${previous} and ${name}`);
      componentExports.set(componentExport, name);
    }
    const renderedComponents = names.map((name) => {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) throw new TypeError(`Unsafe component name: ${name}`);
      return { name, content: renderComponent(name, schemas[name], source) };
    });
    for (const { name, content } of renderedComponents) {
      const file = `components/${name}/index.ts`; const absolutePath = join(root, file);
      await mkdir(resolve(absolutePath, '..'), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
      generated.push({ file, absolutePath, operationId: name });
    }
    const barrel = names.map((name) => `export { ${exportName(name)}Schema } from ${JSON.stringify(`./${name}/index`)};`).join('\\n') + (names.length ? '\\n' : '');
    const barrelFile = 'components/index.ts';
    const barrelPath = join(root, barrelFile); await mkdir(resolve(barrelPath, '..'), { recursive: true }); await writeFile(barrelPath, barrel, 'utf8');
    generated.push({ file: barrelFile, absolutePath: barrelPath, operationId: 'components' });
  }
  for (const plan of plans) {
    const absolutePath = join(root, plan.file);
    await mkdir(resolve(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, renderEndpoint(plan, source, options.mode ?? 'directory', options.useComponentAsReference === true), 'utf8');
    generated.push({ file: plan.file, absolutePath, operationId: plan.operationId });
  }
  if (options.manifest !== false) {
    const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
    const manifest = {
      $schema: 'zopia:manifest@1', zopiaVersion: '0.0.1', mode: options.mode ?? 'directory',
      options: { insertComponents: options.insertComponents === true, useComponentAsReference: Boolean(options.useComponentAsReference) },
      source: { kind: source.swagger === '2.0' ? 'swagger-2.0' : /^3\.0/.test(source.openapi) ? 'openapi-3.0' : 'openapi-3.1', title: source.info.title, version: source.info.version, ...(source.info.description === undefined ? {} : { description: source.info.description }), sha256: createHash('sha256').update(stableStringify(source)).digest('hex') }, infoOverlay: Object.fromEntries(Object.entries(source.info).filter(([key]) => !['title', 'version', 'description'].includes(key))), documentOverlay: Object.fromEntries(Object.entries(source).filter(([key]) => key === 'externalDocs' || key === 'webhooks' || key === 'jsonSchemaDialect' || key.startsWith('x-'))),
      servers: source.servers ?? (source.basePath ? [source.basePath] : ['/']), ...(source.swagger === '2.0' ? { swaggerHost: source.host, swaggerSchemes: source.schemes, swaggerConsumes: source.consumes, swaggerProduces: source.produces } : {}), tags: source.tags ?? [], securitySchemes: source.components?.securitySchemes ?? source.securityDefinitions ?? {},
      ...(source.security === undefined ? {} : { defaultSecurity: source.security }),
      components: Object.entries(schemas).map(([name, schema]) => ({ name, file: options.insertComponents ? `components/${name}/index.ts` : null, schema })),
      apis: plans.map((plan) => ({ file: plan.file, path: plan.path, method: plan.method, operationId: plan.operationId, sourceOperation: plan.operation, refs: collectRefs(plan.operation), overlay: ['callbacks', 'servers', 'externalDocs', 'links'].filter((key) => Object.prototype.hasOwnProperty.call(plan.operation, key)).map((key) => ({ key, value: plan.operation[key] })), responseOverlay: Object.entries(plan.operation.responses ?? {}).flatMap(([status, response]) => response && typeof response === 'object' && (response as any).headers ? [{ status, headers: (response as any).headers }] : []), ...(Object.prototype.hasOwnProperty.call(plan.operation, 'security') ? { security: plan.operation.security } : {}) })),
    };
    const manifestFile = '.zopia-manifest.json'; const manifestPath = join(root, manifestFile);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    generated.push({ file: manifestFile, absolutePath: manifestPath, operationId: 'manifest' });
  }
  return generated;
}
