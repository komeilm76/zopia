import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planApiDocsFiles } from '../src/conversions/api-docs-plan';
import { manifestToOpenApi } from '../src/conversions/manifest-to-openapi';
import {
  createZopiaManifest,
  hashOpenApiDocument,
  serializeZopiaManifest,
  validateZopiaManifest,
  writeZopiaManifest,
  ZOPIA_MANIFEST_FILE,
  ZOPIA_MANIFEST_SCHEMA,
  ZOPIA_VERSION,
  type GeneratedZopiaManifest,
  type ZopiaManifest,
} from '../src/conversions/manifest-writer';
import type { OpenApiDocument } from '../src/conversions/openapi';

function richOpenApi(): OpenApiDocument {
  return {
    openapi: '3.1.1',
    info: { title: 'Manifest API', version: '2.3.4', description: 'Writer contract', termsOfService: 'https://example.test/terms', 'x-info': true },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    externalDocs: { url: 'https://example.test/docs' },
    webhooks: { event: { post: { responses: { '204': { description: 'accepted' } } } } },
    'x-document': { retained: true },
    servers: [{ url: 'https://api.example.test', description: 'primary' }],
    tags: [{ name: 'things', description: 'Things' }],
    security: [{ oauth: ['read'] }],
    components: {
      schemas: {
        Zed: { type: 'string' },
        Alpha: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], unevaluatedProperties: false },
      },
      securitySchemes: { oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/token', scopes: { read: 'Read' } } } } },
      parameters: { Trace: { name: 'x-trace', in: 'header', schema: { type: 'string' } } },
      responses: { Problem: { description: 'problem' } },
      headers: { Rate: { schema: { type: 'integer' } } },
    },
    paths: {
      '/things/{id}': {
        get: {
          operationId: 'getThing',
          security: [],
          servers: [{ url: 'https://edge.example.test' }],
          externalDocs: { url: 'https://example.test/get-thing' },
          callbacks: { changed: { '{$request.body#/callbackUrl}': { post: { responses: { '204': { description: 'ok' } } } } } },
          links: { related: { operationId: 'listThings' } },
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { default: { $ref: '#/components/schemas/Zed' } } },
                example: { $ref: '#/components/schemas/RequestLiteral' },
              },
            },
          },
          responses: {
            '200': {
              description: 'ok',
              headers: { 'x-rate': { schema: { type: 'integer' } } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Alpha' },
                  example: { $ref: '#/components/schemas/LiteralExample' },
                  examples: { named: { value: { $ref: '#/components/schemas/LiteralExamples' } } },
                },
              },
            },
            default: {
              description: 'fallback',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Zed' } } },
            },
          },
          'x-operation': { $ref: '#/components/schemas/ExtensionLiteral' },
        },
      },
    },
  };
}

function build(source = richOpenApi(), insertComponents = true): GeneratedZopiaManifest {
  return createZopiaManifest(source, planApiDocsFiles(source, 'directory'), {
    mode: 'directory',
    insertComponents,
    useComponentAsReference: insertComponents,
  });
}

describe('dedicated manifest writer', () => {
  it('captures complete OpenAPI frame, component, endpoint, overlay, and security metadata', () => {
    const source = richOpenApi();
    const manifest = build(source);

    expect(manifest.$schema).toBe(ZOPIA_MANIFEST_SCHEMA);
    expect(manifest.zopiaVersion).toBe(ZOPIA_VERSION);
    expect(manifest.source).toMatchObject({ kind: 'openapi-3.1', openapiVersion: '3.1.1', title: 'Manifest API', version: '2.3.4', description: 'Writer contract' });
    expect(manifest.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.options).toEqual({ insertComponents: true, useComponentAsReference: true });
    expect(manifest.infoOverlay).toEqual({ termsOfService: 'https://example.test/terms', 'x-info': true });
    expect(manifest.documentOverlay).toEqual({
      externalDocs: source.externalDocs,
      jsonSchemaDialect: source.jsonSchemaDialect,
      webhooks: source.webhooks,
      'x-document': source['x-document'],
    });
    expect(manifest.pathsOverlay).toEqual({});
    expect(manifest.servers).toEqual(source.servers);
    expect(manifest.tags).toEqual(source.tags);
    expect(manifest.securitySchemes).toEqual(source.components.securitySchemes);
    expect(manifest.defaultSecurity).toEqual(source.security);
    expect(manifest.componentsOverlay).toEqual({
      headers: source.components.headers,
      parameters: source.components.parameters,
      responses: source.components.responses,
    });
    expect(manifest.components.map(({ name, file }) => ({ name, file }))).toEqual([
      { name: 'Alpha', file: 'components/Alpha/index.ts' },
      { name: 'Zed', file: 'components/Zed/index.ts' },
    ]);
    expect(manifest.components[0].schema).toEqual(source.components.schemas.Alpha);
    expect(Array.isArray(manifest.components[0].overlay)).toBe(true);

    const api = manifest.apis[0];
    expect(api).toMatchObject({ file: 'things/{id}/get/index.ts', path: '/things/{id}', method: 'get', operationId: 'getThing', security: [] });
    expect(api.sourceOperation).toEqual(source.paths['/things/{id}'].get);
    expect(api.refs).toEqual([
      { at: '/requestBody/content/application~1json/schema/properties/default/$ref', ref: '#/components/schemas/Zed', component: 'Zed' },
      { at: '/responses/200/content/application~1json/schema/$ref', ref: '#/components/schemas/Alpha', component: 'Alpha' },
      { at: '/responses/default/content/application~1json/schema/$ref', ref: '#/components/schemas/Zed', component: 'Zed' },
    ]);
    expect(api.overlay).toEqual(expect.arrayContaining([
      { key: 'callbacks', value: source.paths['/things/{id}'].get.callbacks },
      { key: 'servers', value: source.paths['/things/{id}'].get.servers },
      { key: 'externalDocs', value: source.paths['/things/{id}'].get.externalDocs },
      { key: 'links', value: source.paths['/things/{id}'].get.links },
    ]));
    expect(api.responseOverlay).toEqual([{ status: '200', headers: source.paths['/things/{id}'].get.responses['200'].headers }]);

    source.info.title = 'mutated';
    source.components.schemas.Alpha.properties.id.type = 'number';
    expect(manifest.source.title).toBe('Manifest API');
    expect((manifest.components[0].schema as any).properties.id.type).toBe('string');
  });

  it('captures the complete Swagger frame without serializing absent optional fields', () => {
    const source: OpenApiDocument = {
      swagger: '2.0',
      info: { title: 'Legacy', version: '1', description: 'Swagger source' },
      host: 'legacy.example.test',
      basePath: '/v1',
      schemes: ['https'],
      consumes: ['application/json'],
      produces: ['application/json', 'application/problem+json'],
      security: [{ key: [] }],
      securityDefinitions: { key: { type: 'apiKey', name: 'x-key', in: 'header' } },
      parameters: { Limit: { name: 'limit', in: 'query', type: 'integer' } },
      responses: { Missing: { description: 'missing', schema: { $ref: '#/definitions/Error' } } },
      definitions: { Error: { type: 'object', properties: { message: { type: 'string' } } } },
      paths: { '/legacy': { get: { operationId: 'legacy', responses: { '200': { description: 'ok' } } } } },
    };
    const manifest = build(source, false);

    expect(manifest.source.kind).toBe('swagger-2.0');
    expect(manifest.servers).toEqual(['/v1']);
    expect(manifest).toMatchObject({
      swaggerHost: source.host,
      swaggerSchemes: source.schemes,
      swaggerConsumes: source.consumes,
      swaggerProduces: source.produces,
      swaggerParameters: source.parameters,
      swaggerResponses: source.responses,
      securitySchemes: source.securityDefinitions,
      defaultSecurity: source.security,
    });
    expect(manifest.components).toEqual([expect.objectContaining({ name: 'Error', file: null, schema: source.definitions.Error })]);
    expect(serializeZopiaManifest(manifest)).not.toContain('undefined');

    const minimal: OpenApiDocument = { swagger: '2.0', info: { title: 'Minimal', version: '1' }, paths: {} };
    const minimalManifest = build(minimal, false);
    expect(minimalManifest).not.toHaveProperty('swaggerHost');
    expect(minimalManifest).not.toHaveProperty('servers');
    expect(minimalManifest).not.toHaveProperty('tags');
    expect(minimalManifest).not.toHaveProperty('securitySchemes');
    expect(() => serializeZopiaManifest(minimalManifest)).not.toThrow();
  });

  it('produces canonical hashes and byte-identical manifests regardless of object or plan ordering', async () => {
    const first = richOpenApi();
    const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)]))
      : value;
    const reordered = reorder(first) as OpenApiDocument;

    const firstPlans = planApiDocsFiles(first, 'directory');
    const firstManifest = createZopiaManifest(first, firstPlans, { mode: 'directory', insertComponents: true, useComponentAsReference: true });
    const secondManifest = createZopiaManifest(reordered, [...planApiDocsFiles(reordered, 'directory')].reverse(), { mode: 'directory', insertComponents: true, useComponentAsReference: true });
    const firstBytes = serializeZopiaManifest(firstManifest);
    const secondBytes = serializeZopiaManifest(secondManifest);

    expect(hashOpenApiDocument(first)).toBe(hashOpenApiDocument(reordered));
    expect(firstBytes).toBe(secondBytes);
    expect(firstBytes.endsWith('\n')).toBe(true);
    expect(firstBytes.endsWith('\n\n')).toBe(false);
    expect(firstBytes.indexOf('"$schema"')).toBeLessThan(firstBytes.indexOf('"apis"'));
    expect(firstBytes).not.toMatch(/timestamp|generatedAt|\/tmp\//i);
    expect(() => hashOpenApiDocument({ ...first, invalid: Number.NaN })).toThrow('unsupported OpenAPI value');
    expect(() => hashOpenApiDocument({ ...first, invalid: new Date(0) })).toThrow('unsupported OpenAPI value');
    const sparse: unknown[] = []; sparse.length = 1;
    expect(() => hashOpenApiDocument({ ...first, invalid: sparse })).toThrow('unsupported OpenAPI value');

    const firstDir = await mkdtemp(join(tmpdir(), 'zopia-manifest-'));
    const secondDir = await mkdtemp(join(tmpdir(), 'zopia-manifest-'));
    await writeZopiaManifest(firstDir, firstManifest);
    await writeZopiaManifest(secondDir, secondManifest);
    expect(await readFile(join(firstDir, ZOPIA_MANIFEST_FILE), 'utf8')).toBe(await readFile(join(secondDir, ZOPIA_MANIFEST_FILE), 'utf8'));
  });

  it('rejects malformed identities, metadata, paths, duplicates, refs, and overlays', () => {
    const valid = build();
    const invalidCases: Array<[string, (manifest: any) => void]> = [
      ['schema', (manifest) => { manifest.$schema = 'zopia:manifest@2'; }],
      ['writer version', (manifest) => { delete manifest.zopiaVersion; }],
      ['environment metadata', (manifest) => { manifest.generatedAt = new Date(0).toISOString(); }],
      ['source hash', (manifest) => { manifest.source.sha256 = 'nope'; }],
      ['source OpenAPI version', (manifest) => { manifest.source.openapiVersion = '4.0.0'; }],
      ['paths overlay', (manifest) => { manifest.pathsOverlay['/invalid'] = { get: {} }; }],
      ['path-item reference flag', (manifest) => { manifest.apis[0].pathItemRef = 'yes'; }],
      ['generation options', (manifest) => { manifest.options.insertComponents = false; }],
      ['security scheme', (manifest) => { manifest.securitySchemes.oauth = 'invalid'; }],
      ['default security', (manifest) => { manifest.defaultSecurity = [{ oauth: ['read', 42] }]; }],
      ['API security', (manifest) => { manifest.apis[0].security = [{ oauth: 'read' }]; }],
      ['component', (manifest) => { manifest.components.push({ ...manifest.components[0] }); }],
      ['component file', (manifest) => { manifest.components[0].name = 'CON'; manifest.components[0].file = 'components/CON/index.ts'; }],
      ['API', (manifest) => { manifest.apis.push({ ...manifest.apis[0] }); }],
      ['file', (manifest) => { manifest.apis[0].file = '../escape.ts'; }],
      ['ref target', (manifest) => { manifest.apis[0].refs[0].ref = 'external.json#/Thing'; }],
      ['ref pointer escape', (manifest) => { manifest.apis[0].refs[0].at = '/bad~2pointer'; }],
      ['schema overlay', (manifest) => { manifest.apis[0].overlay.push({ at: 'not-a-pointer', set: { type: 'string' } }); }],
      ['response overlay', (manifest) => { manifest.apis[0].responseOverlay[0] = { status: '200' }; }],
    ];

    for (const [message, mutate] of invalidCases) {
      const candidate = structuredClone(valid) as ZopiaManifest;
      mutate(candidate);
      expect(() => validateZopiaManifest(candidate), message).toThrow();
      expect(() => serializeZopiaManifest(candidate), message).toThrow();
    }
  });

  it('writes through a sibling temporary file, preserves an existing manifest on validation failure, and cleans up after rename failure', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-manifest-'));
    const manifest = build();
    const path = await writeZopiaManifest(outputDir, manifest);
    const original = await readFile(path, 'utf8');
    expect(path).toBe(resolve(outputDir, ZOPIA_MANIFEST_FILE));
    expect(await readdir(outputDir)).toEqual([ZOPIA_MANIFEST_FILE]);

    const invalid = structuredClone(manifest) as ZopiaManifest;
    invalid.source.sha256 = 'invalid';
    await expect(writeZopiaManifest(outputDir, invalid)).rejects.toThrow('source hash');
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(outputDir)).toEqual([ZOPIA_MANIFEST_FILE]);

    const blockedDir = await mkdtemp(join(tmpdir(), 'zopia-manifest-'));
    await mkdir(join(blockedDir, ZOPIA_MANIFEST_FILE));
    await expect(writeZopiaManifest(blockedDir, manifest)).rejects.toThrow();
    expect(await readdir(blockedDir)).toEqual([ZOPIA_MANIFEST_FILE]);
  });

  it('does not follow a pre-existing manifest temporary-file symlink', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-manifest-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'zopia-manifest-outside-'));
    const outside = join(outsideDir, 'protected.txt');
    await writeFile(outside, 'protected\n', 'utf8');
    await symlink(outside, join(outputDir, `${ZOPIA_MANIFEST_FILE}.tmp`));

    await expect(writeZopiaManifest(outputDir, build())).rejects.toMatchObject({
      code: 'ZOPIA_FS_WRITE_FAILED',
      at: join(outputDir, ZOPIA_MANIFEST_FILE),
      cause: { code: 'EEXIST' },
    });
    expect(await readFile(outside, 'utf8')).toBe('protected\n');
  });

  it('remains compatible with manifest-driven reverse conversion', () => {
    const manifest = build();
    const reconstructed = manifestToOpenApi(manifest);

    expect(reconstructed.openapi).toBe('3.1.1');
    expect(reconstructed.info).toEqual(richOpenApi().info);
    expect(reconstructed.servers).toEqual(richOpenApi().servers);
    expect((reconstructed as any).components.schemas).toEqual(richOpenApi().components.schemas);
    expect((reconstructed as any).components.parameters).toEqual(richOpenApi().components.parameters);
    expect((reconstructed as any).paths['/things/{id}'].get.security).toEqual([]);
    expect((reconstructed as any).paths['/things/{id}'].get.responses['200'].headers).toEqual(richOpenApi().paths['/things/{id}'].get.responses['200'].headers);
  });
});
