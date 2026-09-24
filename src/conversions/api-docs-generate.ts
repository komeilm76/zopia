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

function componentExport(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const prefix = ref.startsWith('#/components/schemas/') ? '#/components/schemas/' : ref.startsWith('#/definitions/') ? '#/definitions/' : undefined;
  return prefix ? `${exportName(ref.slice(prefix.length))}Schema` : undefined;
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
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
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
function renderComponent(name: string, schema: unknown, source: OpenApiDocument): string {
  const schemas = source.openapi ? source.components?.schemas ?? {} : source.definitions ?? {};
  const normalized = JSON.parse(JSON.stringify(schema, (_key, value) => typeof value === 'string' && (value.startsWith('#/components/schemas/') || value.startsWith('#/definitions/')) ? `#/$defs/${value.includes('/components/schemas/') ? value.slice('#/components/schemas/'.length) : value.slice('#/definitions/'.length)}` : value));
  const componentInput = typeof normalized === 'boolean' ? normalized : { ...(normalized as any), $defs: schemas };
  const converted = jsonSchemaToZod(componentInput as any, { rootName: `${exportName(name)}Schema` }).code.replace(/^const [^=]+ = /, '').replace(/;$/, '');
  return `/** Generated by zopia — do not edit by hand. */\nimport { z } from 'zod';\n\nexport const ${exportName(name)}Schema = ${converted};\n\nexport default ${exportName(name)}Schema;\n`;
}
function renderEndpoint(operation: any, source: OpenApiDocument, mode: ApiDocsMode = 'directory', useComponents = false): string {
  const ir = buildOpenApiOperationIR(source).find((candidate) => candidate.operationId === operation.operationId && candidate.path === operation.path && candidate.method.toLowerCase() === operation.method);
  if (!ir) throw new TypeError(`Unable to build operation IR: ${operation.operationId}`);
  const contracts = extractOperationContracts(ir);
  const componentRefs = useComponents ? collectComponentRefs(operation.operation) : new Set<string>();
  const componentSchema = (schema: unknown, fallback: string) => useComponents && schema && typeof schema === 'object' && componentExport((schema as any).$ref) ? componentExport((schema as any).$ref)! : schemaCode(schema, fallback);
  const params = (location: string) => contracts.parameters.filter((p) => p.in === location).map((p) => `${JSON.stringify(p.name)}: ${schemaCode(p.schema, `param${p.name.replace(/[^A-Za-z0-9]/g, '') || 'Value'}`)}${p.required ? '' : '.optional()'}`).join(', ');
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
  const auth = ir.security !== undefined && ir.security.length > 0 ? 'YES' : 'NO';
  const sourceName = `${source.info.title} v${source.info.version}`;
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
    const barrel = names.map((name) => `export { ${exportName(name)}Schema } from './${name}/index';`).join('\\n') + (names.length ? '\\n' : '');
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
      source: { kind: source.swagger === '2.0' ? 'swagger-2.0' : /^3\.0/.test(source.openapi) ? 'openapi-3.0' : 'openapi-3.1', title: source.info.title, version: source.info.version, sha256: createHash('sha256').update(stableStringify(source)).digest('hex') },
      servers: source.servers ?? (source.basePath ? [source.basePath] : ['/']), tags: source.tags ?? [], securitySchemes: source.components?.securitySchemes ?? source.securityDefinitions ?? {},
      ...(source.security === undefined ? {} : { defaultSecurity: source.security }),
      components: Object.entries(schemas).map(([name, schema]) => ({ name, file: options.insertComponents ? `components/${name}/index.ts` : null, schema })),
      apis: plans.map((plan) => ({ file: plan.file, path: plan.path, method: plan.method, operationId: plan.operationId, refs: collectRefs(plan.operation), overlay: [], responseOverlay: [], ...(Object.prototype.hasOwnProperty.call(plan.operation, 'security') ? { security: plan.operation.security } : {}) })),
    };
    const manifestFile = '.zopia-manifest.json'; const manifestPath = join(root, manifestFile);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    generated.push({ file: manifestFile, absolutePath: manifestPath, operationId: 'manifest' });
  }
  return generated;
}
