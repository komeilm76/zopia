import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApiDocsFiles } from '../src';

describe('API docs endpoint generation', () => {
  it('generates component files and a sorted barrel', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Zebra: true, Alpha: { type: 'object', properties: { name: { type: 'string' } } } } }, paths: {} }, { outputDir, insertComponents: true });
    expect(files.map((file) => file.file)).toEqual(['components/Alpha/index.ts', 'components/Zebra/index.ts', 'components/index.ts', '.zopia-manifest.json']);
    expect(await readFile(join(outputDir, 'components/index.ts'), 'utf8')).toContain('export { AlphaSchema } from "./Alpha/index";');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.source.kind).toBe('openapi-3.1');
    expect(manifest.apis).toEqual([]);
    const reorderedDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ components: { schemas: { Zebra: true, Alpha: { type: 'object', properties: { name: { type: 'string' } } } } }, paths: {}, info: { version: '1', title: 'Test' }, openapi: '3.1.0' }, { outputDir: reorderedDir, insertComponents: true });
    expect(JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')).source.sha256).toBe(JSON.parse(await readFile(join(reorderedDir, '.zopia-manifest.json'), 'utf8')).source.sha256);
    await expect(generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { 'A-B': { type: 'string' }, AB: { type: 'string' } } }, paths: {} }, { outputDir, insertComponents: true })).rejects.toThrow('Component export name collision');
  });
  it('preserves original component directory names in generated imports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' }, 'User Profile': { $ref: '#/components/schemas/User' } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'User Profile', 'index.ts'), 'utf8');
    expect(content).toContain('from "../User/index"');
  });
  it('imports exact component response references', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' } } }, paths: { '/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const content = await readFile(join(outputDir, 'users', 'get', 'index.ts'), 'utf8');
    expect(content).toContain("import { UserSchema } from '../../components/index';");
    expect(content).toContain('200: UserSchema');
  });
  it('rejects circular input before writing a manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const input: any = { openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {} }; input.self = input;
    await expect(generateApiDocsFiles(input, { outputDir })).rejects.toThrow('circular OpenAPI document');
  });
  it('supports flat generation without a manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/users': { get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir, mode: 'flat', manifest: false });
    expect(files[0].file).toBe('users/get/index.ts');
    await expect(readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')).rejects.toThrow();
  });
  it('writes a complete endpoint file', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/users/{id}': { get: { operationId: 'getUser', summary: 'Get user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' }, example: { id: 'u1' } } } } } } } } }, { outputDir });
    expect(files).toHaveLength(2);
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
    expect(content).toContain('examples:');
    expect(content).toContain('u1');
    const metadataDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, security: [{ apiKey: [] }], paths: { '/meta': { get: { operationId: 'meta', tags: ['#users'], security: [], deprecated: true, responses: { '200': { description: 'ok' } } } } } }, { outputDir: metadataDir });
    const metadata = await readFile(join(metadataDir, 'meta', 'get', 'index.ts'), 'utf8');
    expect(metadata).toContain('tags: ["#users"]');
    expect(metadata).toContain('auth: "NO"');
    expect(metadata).toContain("deprecated: 'YES'");
    const swaggerDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Test', version: '1' }, paths: { '/legacy': { get: { responses: { '200': { description: 'ok', examples: { 'application/json': { id: 'legacy' } } } } } } } }, { outputDir: swaggerDir });
    expect(await readFile(join(swaggerDir, 'legacy', 'get', 'index.ts'), 'utf8')).toContain('legacy');
  });
});
