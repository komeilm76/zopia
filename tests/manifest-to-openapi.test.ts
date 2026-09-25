import { describe, expect, it } from 'vitest';
import { manifestToOpenApi, manifestFileToOpenApi, generateApiDocsFiles } from '../src';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('manifest reverse conversion', () => {
  it('reconstructs the document frame and lossless operations', () => {
    const result = manifestToOpenApi({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Test', version: '1' }, infoOverlay: { contact: { name: 'Team' } }, documentOverlay: { externalDocs: { url: 'https://example.com' }, 'x-vendor': true }, components: [{ name: 'User', schema: { type: 'object' } }], apis: [{ path: '/users', method: 'get', operationId: 'getUsers', sourceOperation: { operationId: 'getUsers', responses: { '200': { description: 'ok' } } } }] });
    expect(result.openapi).toBe('3.1.0');
    const document = result as any;
    expect(document.components.schemas.User).toEqual({ type: 'object' });
    expect(document.info.contact).toEqual({ name: 'Team' });
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect(document.externalDocs.url).toBe('https://example.com');
    expect(document['x-vendor']).toBe(true);
    expect(document.paths['/users'].get.responses['200'].description).toBe('ok');
  });
  it('rejects unsafe, duplicate, and malformed manifest operations', () => {
    const source = { kind: 'openapi-3.1', title: 'Test', version: '1' };
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '__proto__', method: 'get' }] })).toThrow('Invalid manifest API');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/users', method: 'get' }, { path: '/users', method: 'get' }] })).toThrow('Duplicate manifest API');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/users', method: 'get', sourceOperation: [] as any }] })).toThrow('Invalid manifest source operation');
  });
  it('prevents overlays from replacing canonical manifest fields', () => {
    const source = { kind: 'openapi-3.1', title: 'Test', version: '1' };
    for (const key of ['paths', 'openapi', 'info']) {
      expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, documentOverlay: { [key]: null }, apis: [] })).toThrow(`Invalid manifest documentOverlay key: ${key}`);
    }
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, infoOverlay: { title: 'Override' }, apis: [] })).toThrow('Invalid manifest infoOverlay key: title');
  });
  it('loads a manifest from disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-'));
    const file = join(directory, 'manifest.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Test', version: '1' }, apis: [] }), 'utf8'));
    expect((await manifestFileToOpenApi(file) as any).openapi).toBe('3.1.0');
  });
  it('round-trips reusable OpenAPI and Swagger component sections', async () => {
    const openApiDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Reusable', version: '1' }, components: {
      parameters: { Trace: { name: 'trace', in: 'header', schema: { type: 'string' } } },
      responses: { Problem: { description: 'problem', content: { 'application/json': { schema: { type: 'string' } } } } },
      headers: { RateLimit: { schema: { type: 'integer' } } },
    }, paths: { '/x': { get: { parameters: [{ $ref: '#/components/parameters/Trace' }], responses: { '400': { $ref: '#/components/responses/Problem' } } } } } }, { outputDir: openApiDir });
    const openApiManifest = JSON.parse(await readFile(join(openApiDir, '.zopia-manifest.json'), 'utf8'));
    const openApi = manifestToOpenApi(openApiManifest) as any;
    expect(openApi.components.parameters.Trace.name).toBe('trace');
    expect(openApi.components.responses.Problem.description).toBe('problem');
    expect(openApi.components.headers.RateLimit.schema.type).toBe('integer');

    const swaggerDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Reusable', version: '1' }, parameters: { Limit: { name: 'limit', in: 'query', type: 'integer' } }, responses: { Problem: { description: 'problem', schema: { type: 'string' } } }, paths: { '/x': { get: { parameters: [{ $ref: '#/parameters/Limit' }], responses: { '400': { $ref: '#/responses/Problem' } } } } } }, { outputDir: swaggerDir });
    const swaggerManifest = JSON.parse(await readFile(join(swaggerDir, '.zopia-manifest.json'), 'utf8'));
    const swagger = manifestToOpenApi(swaggerManifest) as any;
    expect(swagger.parameters.Limit.type).toBe('integer');
    expect(swagger.responses.Problem.description).toBe('problem');
  });
  it('round-trips Swagger basePath and security definitions', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Legacy', version: '1' }, basePath: '/api', host: 'api.example.com', schemes: ['https'], consumes: ['application/json'], produces: ['application/json'], securityDefinitions: { apiKey: { type: 'apiKey', name: 'X-Key', in: 'header' } }, paths: { '/users': { get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir });
    const result = manifestToOpenApi(JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'))) as any;
    expect(result.basePath).toBe('/api');
    expect(result.host).toBe('api.example.com');
    expect(result.schemes).toEqual(['https']);
    expect(result.consumes).toEqual(['application/json']);
    expect(result.produces).toEqual(['application/json']);
    expect(result.securityDefinitions.apiKey.name).toBe('X-Key');
  });
  it('restores Swagger security definitions', () => {
    const result = manifestToOpenApi({ $schema: 'zopia:manifest@1', source: { kind: 'swagger-2.0', title: 'Test', version: '1' }, securitySchemes: { apiKey: { type: 'apiKey', name: 'X-Key', in: 'header' } }, apis: [] }) as any;
    expect(result.securityDefinitions.apiKey).toEqual({ type: 'apiKey', name: 'X-Key', in: 'header' });
  });
  it('round-trips a generated manifest without losing the operation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Round trip', version: '1' }, paths: { '/users': { get: { operationId: 'listUsers', security: [], responses: { '200': { description: 'ok' } } } } } }, { outputDir });
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    const result = manifestToOpenApi(manifest) as any;
    expect(result.paths['/users'].get.operationId).toBe('listUsers');
    expect(result.paths['/users'].get.security).toEqual([]);
  });
});
