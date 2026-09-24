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
    expect(content).toContain('pathShape: "/users/{id}"');
    expect(content).toContain('responseContentType');
  });
});
