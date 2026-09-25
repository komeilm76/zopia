import { describe, expect, it } from 'vitest';
import { manifestToOpenApi, manifestFileToOpenApi, generateApiDocsFiles } from '../src';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

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
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Test', version: '1' }, components: [{ name: 'Inline', file: null, schema: { type: 'string' } }], apis: [] }), 'utf8'));
    const document = await manifestFileToOpenApi(file) as any;
    expect(document.openapi).toBe('3.1.0');
    expect(document.components.schemas.Inline).toEqual({ type: 'string' });
  });
  it('imports generated endpoint modules and uses edited runtime metadata', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Runtime', version: '1' }, paths: { '/users': { get: { operationId: 'listUsers', summary: 'Original summary', description: 'Original description', tags: ['users'], deprecated: true, security: [], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } } } } } }, { outputDir });
    const endpointFile = join(outputDir, 'users', 'get', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated
      .replace('method: "GET"', 'method: "POST"')
      .replace('pathShape: "/users"', 'pathShape: "/members/:memberId"')
      .replace('operationId: "listUsers"', 'operationId: "listMembers"')
      .replace('summary: "Original summary"', 'summary: "Edited summary"')
      .replace('description: "Original description"', 'description: "Edited description"')
      .replace('tags: ["#users"]', 'tags: ["#members", "public"]')
      .replace("deprecated: 'YES'", "deprecated: 'NO'");
    await writeFile(endpointFile, edited, 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.paths['/users']).toBeUndefined();
    const operation = reversed.paths['/members/{memberId}'].post;
    expect(operation.operationId).toBe('listMembers');
    expect(operation.summary).toBe('Edited summary');
    expect(operation.description).toBe('Edited description');
    expect(operation.tags).toEqual(['members', 'public']);
    expect(operation.deprecated).toBe(false);
    expect(operation.security).toEqual([]);
    expect(operation.responses['200'].content['application/json'].schema).toEqual({ type: 'string' });
  });
  it('imports emitted component modules and uses edited Zod schemas', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Components', version: '1' }, components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, Group: { type: 'object', properties: { owner: { $ref: '#/components/schemas/User' } }, required: ['owner'] }, UserAlias: { $ref: '#/components/schemas/User' } } }, paths: { '/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const manifestFile = join(outputDir, '.zopia-manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    expect((manifestToOpenApi(manifest) as any).components.schemas.User.properties.id.type).toBe('string');

    const componentFile = join(outputDir, 'components', 'User', 'index.ts');
    const generated = await readFile(componentFile, 'utf8');
    expect(generated).not.toContain('\\n');
    await writeFile(componentFile, generated.replace('["id"]: z.string()', '["id"]: z.number().int().min(1), ["active"]: z.boolean()'), 'utf8');

    const reversed = await manifestFileToOpenApi(manifestFile) as any;
    expect(reversed.components.schemas.User.properties.id).toMatchObject({ type: 'integer', minimum: 1 });
    expect(reversed.components.schemas.User.properties.active).toEqual({ type: 'boolean' });
    expect(reversed.components.schemas.User.required).toEqual(['id', 'active']);
    expect(reversed.components.schemas.Group.properties.owner).toEqual({ $ref: '#/components/schemas/User' });
    expect(reversed.components.schemas.UserAlias).toEqual({ $ref: '#/components/schemas/User' });
    expect(reversed.paths['/users'].get.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/User' });

    await writeFile(componentFile, (await readFile(componentFile, 'utf8')).replace('.min(1)', '.min(2)'), 'utf8');
    const rereversed = await manifestFileToOpenApi(manifestFile) as any;
    expect(rereversed.components.schemas.User.properties.id.minimum).toBe(2);
  });
  it('converts imported components to the source Swagger dialect', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Legacy components', version: '1' }, definitions: { Limit: { type: 'number' } }, paths: {} }, { outputDir, insertComponents: true });
    const componentFile = join(outputDir, 'components', 'Limit', 'index.ts');
    const generated = await readFile(componentFile, 'utf8');
    await writeFile(componentFile, generated.replace('z.number()', 'z.number().gt(1)'), 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.definitions.Limit).toEqual({ type: 'number', minimum: 1, exclusiveMinimum: true });
  });
  it('rejects missing, unsafe, and invalid generated endpoint modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-'));
    const source = { kind: 'openapi-3.1', title: 'Test', version: '1' };
    const manifestFile = join(directory, '.zopia-manifest.json');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Manifest API file is required');

    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: 'missing.ts', path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unable to resolve generated endpoint file missing.ts');

    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: join(directory, 'absolute.ts'), path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest API file');

    const outsideDirectory = await mkdtemp(join(tmpdir(), 'zopia-outside-'));
    const outsideFile = join(outsideDirectory, 'outside.ts');
    await writeFile(outsideFile, 'export default {};\n', 'utf8');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: relative(directory, outsideFile), path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest API file');

    await symlink(outsideFile, join(directory, 'linked.ts'));
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: 'linked.ts', path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest API file');

    await writeFile(join(directory, 'invalid.ts'), 'export default {};\n', 'utf8');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: 'invalid.ts', path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('does not export a unique km-api config');
  });
  it('rejects missing, unsafe, and invalid generated component modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zopia-'));
    const source = { kind: 'openapi-3.1', title: 'Test', version: '1' };
    const manifestFile = join(directory, '.zopia-manifest.json');
    const manifest = (file: string) => ({ $schema: 'zopia:manifest@1', source, components: [{ name: 'User', file, schema: { type: 'string' } }], apis: [] });

    await writeFile(manifestFile, JSON.stringify(manifest('missing.ts')), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unable to resolve generated component file missing.ts');

    await writeFile(manifestFile, JSON.stringify(manifest(join(directory, 'absolute.ts'))), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest component file');

    await writeFile(join(directory, 'invalid-component.ts'), 'export default {};\n', 'utf8');
    await writeFile(manifestFile, JSON.stringify(manifest('invalid-component.ts')), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('does not export a unique Zod schema');
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
