import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApiDocsFiles } from '../src';

describe('API docs endpoint generation', () => {
  it('writes a complete endpoint file', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/users/{id}': { get: { operationId: 'getUser', summary: 'Get user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } } } } } }, { outputDir });
    expect(files).toHaveLength(1);
    const content = await readFile(join(outputDir, 'users', '{id}', 'get', 'index.ts'), 'utf8');
    expect(content).toContain("import { makeApiConfig } from 'km-api';");
    expect(content).toContain('export const getUser');
    const numericDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/x': { get: { parameters: [{ name: '123', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } } } }, { outputDir: numericDir });
    const numericContent = await readFile(join(numericDir, 'x', 'get', 'index.ts'), 'utf8');
    expect(numericContent).toContain('"123": z.string()');
    const oddDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/x': { get: { operationId: 'get-user', responses: { '200': { description: 'ok' } } } } } }, { outputDir: oddDir });
    expect(await readFile(join(oddDir, 'x', 'get', 'index.ts'), 'utf8')).toContain('export const getUser');
    const reservedDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/reserved': { get: { operationId: 'await', responses: { '200': { description: 'ok' } } } } } }, { outputDir: reservedDir });
    expect(await readFile(join(reservedDir, 'reserved', 'get', 'index.ts'), 'utf8')).toContain('export const awaitEndpoint');
    expect(content).toContain('pathShape: "/users/{id}"');
    expect(content).toContain('responseContentType');
    const metadataDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, security: [{ apiKey: [] }], paths: { '/meta': { get: { operationId: 'meta', tags: ['#users'], security: [], deprecated: true, responses: { '200': { description: 'ok' } } } } } }, { outputDir: metadataDir });
    const metadata = await readFile(join(metadataDir, 'meta', 'get', 'index.ts'), 'utf8');
    expect(metadata).toContain('tags: ["#users"]');
    expect(metadata).toContain('auth: false');
  });
});
