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
  it('loads a manifest from disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-'));
    const file = join(directory, 'manifest.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Test', version: '1' }, apis: [] }), 'utf8'));
    expect((await manifestFileToOpenApi(file) as any).openapi).toBe('3.1.0');
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
