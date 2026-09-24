import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { generateApiDocsFiles, type GenerateApiDocsOptions, type GeneratedApiDocsFile } from './api-docs-generate';
import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';
import { planApiDocsFiles } from './api-docs-plan';

/** Options for generating an API-docs tree. */
export interface OpenApiToApiDocsOptions extends Omit<GenerateApiDocsOptions, 'outputDir'> { outputDir?: string; manifest?: boolean; }
/** Result of generating an API-docs tree. */
export interface OpenApiToApiDocsResult { files: GeneratedApiDocsFile[]; manifestPath: string; warnings: string[]; }
/** Options for reversing an API-docs tree. */
export interface ApiDocsToOpenApiOptions { version?: '3.0' | '3.1'; }
/** Result of reversing an API-docs tree. */
export interface ApiDocsToOpenApiResult { openapi: OpenApiDocument; warnings: string[]; }

async function loadDocument(input: string | OpenApiDocument): Promise<OpenApiDocument> {
  const value = typeof input === 'string' ? JSON.parse(await readFile(input, 'utf8')) : input;
  return normalizeOpenApiDocument(value).document;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Convert an OpenAPI or Swagger document into generated API-docs files and a reversible manifest. */
export async function openApiToApiDocs(input: string | OpenApiDocument, options: OpenApiToApiDocsOptions = {}): Promise<OpenApiToApiDocsResult> {
  const document = await loadDocument(input);
  const outputDir = resolve(options.outputDir ?? 'api_docs');
  const mode = options.mode ?? 'directory';
  const files = await generateApiDocsFiles(document, { ...options, outputDir });
  const manifestPath = join(outputDir, '.zopia-manifest.json');
  if (options.manifest !== false) {
    await mkdir(outputDir, { recursive: true });
    const plans = planApiDocsFiles(document, mode);
    const schemas = document.openapi ? document.components?.schemas ?? {} : document.definitions ?? {};
    const manifest = {
      '$schema': 'zopia:manifest@1', zopiaVersion: '0.1.0', mode,
      options: { insertComponents: options.insertComponents ?? false, useComponentAsReference: options.useComponentAsReference ?? false },
      source: { kind: document.openapi ? `openapi-${document.openapi.slice(0, 3)}` : 'swagger-2.0', title: document.info.title, version: document.info.version, sha256: hash(document) },
      servers: document.servers ?? [], tags: document.tags ?? [], securitySchemes: document.openapi ? document.components?.securitySchemes ?? {} : {},
      defaultSecurity: document.security, components: Object.keys(schemas).sort().map((name) => ({ name, file: options.insertComponents ? `components/${name}/index.ts` : null, title: name, example: null, schema: schemas[name] })),
      apis: plans.map((p) => ({ file: p.file, path: p.path, method: p.method, operationId: p.operationId, refs: [], overlay: [], responseOverlay: [] })),
      document,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  return { files, manifestPath, warnings: [] };
}

/** Reconstruct the source OpenAPI document recorded by a generated manifest. */
export async function apiDocsToOpenApi(docsDir: string, _options: ApiDocsToOpenApiOptions = {}): Promise<ApiDocsToOpenApiResult> {
  const manifestPath = join(resolve(docsDir), '.zopia-manifest.json');
  let manifest: any;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new Error('ZOPIA_DOCS_MISSING_MANIFEST'); }
  if (manifest?.['$schema'] !== 'zopia:manifest@1' || !manifest.document || !Array.isArray(manifest.apis) || !Array.isArray(manifest.components)) throw new Error('ZOPIA_DOCS_MANIFEST_MISMATCH');
  const declaredFiles = [
    ...manifest.apis.map((api: any) => api?.file),
    ...manifest.components.filter((component: any) => component?.file !== null).map((component: any) => component?.file),
  ];
  if (declaredFiles.some((file: unknown) => typeof file !== 'string' || file.length === 0 || file.startsWith('/') || file.includes('\0') || file.split('/').some((part: string) => part === '..'))) throw new Error('ZOPIA_DOCS_MANIFEST_MISMATCH');
  for (const file of declaredFiles) {
    try { await access(join(resolve(docsDir), file)); } catch { throw new Error('ZOPIA_DOCS_MANIFEST_MISMATCH'); }
  }
  if (manifest.source?.sha256 && manifest.source.sha256 !== hash(manifest.document)) throw new Error('ZOPIA_DOCS_MANIFEST_MISMATCH');
  const source = JSON.parse(JSON.stringify(manifest.document)) as OpenApiDocument;
  const version = _options.version ?? '3.1';
  if (version !== '3.0' && version !== '3.1') throw new TypeError(`Unsupported OpenAPI output version: ${version}`);
  if (source.swagger === '2.0') {
    delete source.swagger;
    source.openapi = version === '3.0' ? '3.0.3' : '3.1.0';
  } else if (typeof source.openapi === 'string') {
    source.openapi = version === '3.0' ? '3.0.3' : '3.1.0';
  }
  return { openapi: source, warnings: [] };
}
