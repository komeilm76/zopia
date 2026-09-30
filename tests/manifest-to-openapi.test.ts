import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { apiDocsToOpenApi, manifestToOpenApi, manifestFileToOpenApi, generateApiDocsFiles, openApiToApiDocs, type ZopiaError } from '../src';
import { mkdir, readFile, rename, symlink, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const temporaryDirectory = useTemporaryDirectories();

/** Swagger 2.0 serialization fixture: a shared `collectionFormat` query parameter plus `formData` uploads. */
const SERIALIZATION_SPEC = {
  swagger: '2.0',
  info: { title: 'Serialization API', version: '1.0.0' },
  parameters: {
    TagsParam: { name: 'tags', in: 'query', type: 'array', items: { type: 'string' }, collectionFormat: 'csv' },
  },
  paths: {
    '/things': {
      get: { operationId: 'listThings', parameters: [{ $ref: '#/parameters/TagsParam' }], responses: { '200': { description: 'OK' } } },
    },
    '/uploads': {
      post: {
        operationId: 'uploadForm',
        consumes: ['multipart/form-data'],
        parameters: [
          { name: 'file', in: 'formData', type: 'file', required: true },
          { name: 'labels', in: 'formData', type: 'array', items: { type: 'string' }, collectionFormat: 'multi' },
          { name: 'flags', in: 'formData', type: 'array', items: { type: 'string' }, collectionFormat: 'pipes' },
          { name: 'notes', in: 'formData', type: 'array', items: { type: 'integer' }, collectionFormat: 'ssv' },
        ],
        responses: { '201': { description: 'Created' } },
      },
    },
  },
};

describe('manifest reverse conversion', () => {
  it('S-66: reconstructs the document frame and lossless operations', () => {
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
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [
      { path: '/users', method: 'get', sourceOperation: { operationId: 'duplicate', responses: { '200': { description: 'ok' } } } },
      { path: '/groups', method: 'get', sourceOperation: { operationId: 'duplicate', responses: { '200': { description: 'ok' } } } },
    ] })).toThrow('Duplicate reconstructed operationId: duplicate');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/users/{id}', method: 'get', sourceOperation: { responses: { '200': { description: 'ok' } } } }] })).toThrow('Manifest operation path parameter is not defined: id');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/users', method: 'get', sourceOperation: { responses: { '999': { description: 'bad' } } } }] })).toThrow('Invalid reconstructed responses');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/users', method: 'get', sourceOperation: { responses: { '200': { description: 1 } } } }] })).toThrow('Invalid reconstructed responses');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/users', method: 'post', sourceOperation: { requestBody: {}, responses: { '200': { description: 'ok' } } } }] })).toThrow('Invalid reconstructed OpenAPI document');
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
    const directory = await temporaryDirectory('zopia-');
    const file = join(directory, 'manifest.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Test', version: '1' }, components: [{ name: 'Inline', file: null, schema: { type: 'string' } }], apis: [] }), 'utf8'));
    const document = await manifestFileToOpenApi(file) as any;
    expect(document.openapi).toBe('3.1.0');
    expect(document.components.schemas.Inline).toEqual({ type: 'string' });
  });
  it('S-64: selects OpenAPI 3.0 or 3.1 for file-backed runtime schemas', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Versions', version: '1' }, components: { schemas: { MaybeName: { type: ['string', 'null'] }, User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } }, paths: { '/name': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: ['string', 'null'] } } } } } } }, '/user': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { anyOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const manifestFile = join(outputDir, '.zopia-manifest.json');

    const openApi30 = await manifestFileToOpenApi(manifestFile, { version: '3.0' }) as any;
    expect(openApi30.openapi).toBe('3.0.0');
    expect(openApi30.components.schemas.MaybeName).toMatchObject({ type: 'string', nullable: true });
    expect(openApi30.paths['/name'].get.responses['200'].content['application/json'].schema).toMatchObject({ type: 'string', nullable: true });
    expect(openApi30.paths['/user'].get.responses['200'].content['application/json'].schema).toEqual({ allOf: [{ $ref: '#/components/schemas/User' }], nullable: true });

    const openApi31 = await manifestFileToOpenApi(manifestFile, { version: '3.1' }) as any;
    expect(openApi31.openapi).toBe('3.1.0');
    expect(openApi31.components.schemas.MaybeName.type).toEqual(['string', 'null']);
    expect(openApi31.paths['/name'].get.responses['200'].content['application/json'].schema.type).toEqual(['string', 'null']);

    const literalData = manifestToOpenApi({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.0', title: 'Literal data', version: '1' }, components: [{ name: 'Payload', file: null, schema: { type: 'object', example: { type: 'file' }, default: { type: 'file' }, properties: { choice: { enum: [{ type: 'file' }] } } } }], apis: [] }, { version: '3.1' }) as any;
    expect(literalData.components.schemas.Payload.example).toEqual({ type: 'file' });
    expect(literalData.components.schemas.Payload.default).toEqual({ type: 'file' });
    expect(literalData.components.schemas.Payload.properties.choice.enum).toEqual([{ type: 'file' }]);

    const nullableRef = manifestToOpenApi({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.0', title: 'Nullable ref', version: '1' }, components: [{ name: 'User', file: null, schema: { type: 'object' } }, { name: 'MaybeUser', file: null, schema: { $ref: '#/components/schemas/User', nullable: true } }], apis: [] }, { version: '3.1' }) as any;
    expect(nullableRef.components.schemas.MaybeUser).toEqual({ anyOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] });

    const constrained = manifestToOpenApi({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Bounds', version: '1' }, documentOverlay: { webhooks: { event: {} }, jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema', 'x-value': true }, componentsOverlay: { pathItems: { Shared: {} } }, components: [{ name: 'Range', file: null, schema: { type: 'number', minimum: 5, exclusiveMinimum: 1, maximum: 5, exclusiveMaximum: 10 } }], apis: [] }, { version: '3.0' }) as any;
    expect(constrained.components.schemas.Range).toEqual({ type: 'number', minimum: 5, maximum: 5 });
    expect(constrained.webhooks).toBeUndefined();
    expect(constrained.jsonSchemaDialect).toBeUndefined();
    expect(constrained['x-value']).toBe(true);
    expect(constrained.components.pathItems).toBeUndefined();
  });
  it('uses OpenAPI 3.1 by default in the documented apiDocsToOpenApi API', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.0.3', info: { title: 'Default version', version: '1' }, paths: { '/value': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { example: { schema: { type: 'file' } }, schema: { type: 'string', nullable: true } } } } } } } } }, { outputDir });
    const result = await apiDocsToOpenApi(outputDir);
    expect((result.openapi as any).openapi).toBe('3.1.0');
    expect((result.openapi as any).paths['/value'].get.responses['200'].content['application/json'].schema.type).toEqual(['string', 'null']);
    expect((result.openapi as any).paths['/value'].get.responses['200'].content['application/json'].example).toEqual({ schema: { type: 'file' } });
    expect(result.warnings).toEqual([]);
  });
  it('converts Swagger manifests to the selected OpenAPI output version', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Legacy selection', version: '1' }, host: 'api.example.com', schemes: ['https'], basePath: '/v1', consumes: ['application/json', 'application/xml'], produces: ['application/json', 'application/xml'], securityDefinitions: { basicAuth: { type: 'basic' } }, definitions: { User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }, paths: { '/users': { post: { parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/User' } }], responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/User' } }, '204': { description: 'empty' } } } } } }, { outputDir });
    const result = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'), { version: '3.0' }) as any;
    expect(result.swagger).toBeUndefined();
    expect(result.openapi).toBe('3.0.0');
    expect(result.servers).toEqual([{ url: 'https://api.example.com/v1' }]);
    expect(result.components.securitySchemes.basicAuth).toEqual({ type: 'http', scheme: 'basic' });
    expect(result.paths['/users'].post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/User' });
    expect(result.paths['/users'].post.requestBody.content['application/xml'].schema).toEqual({ $ref: '#/components/schemas/User' });
    expect(result.paths['/users'].post.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/User' });
    expect(result.paths['/users'].post.responses['200'].content['application/xml'].schema).toEqual({ $ref: '#/components/schemas/User' });
    expect(result.paths['/users'].post.responses['204']).toEqual({ description: 'empty' });
    const snapshot = manifestToOpenApi(JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')), { version: '3.1' }) as any;
    expect(snapshot.paths['/users'].post.responses['204']).toEqual({ description: 'empty' });
  });
  it('rejects unsupported reverse output versions before importing generated code', async () => {
    const source = { $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Test', version: '1' }, apis: [] } as any;
    expect(() => manifestToOpenApi(source, { version: '4.0' } as any)).toThrow("ZOPIA_CONFIG_INVALID: reverse version must be '2.0', '3.0', or '3.1'");
    const directory = await temporaryDirectory('zopia-');
    const manifestFile = join(directory, '.zopia-manifest.json');
    await writeFile(manifestFile, JSON.stringify(source), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile, { version: '4.0' } as any)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID' });
    await expect(apiDocsToOpenApi(directory, null as any)).rejects.toMatchObject({ code: 'ZOPIA_CONFIG_INVALID' });
  });
  it('S-65: reports a missing manifest distinctly from malformed manifest content', async () => {
    const directory = await temporaryDirectory('zopia-');
    const missingError = await manifestFileToOpenApi(join(directory, '.zopia-manifest.json')).catch((error: unknown) => error);
    expect(missingError).toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST', message: expect.stringContaining('manifest file not found') });
    const malformed = join(directory, 'malformed.json');
    await writeFile(malformed, '{', 'utf8');
    await expect(manifestFileToOpenApi(malformed)).rejects.toMatchObject({ code: 'ZOPIA_MANIFEST_INVALID', at: malformed, message: expect.stringContaining('Invalid manifest file') });
  });
  it('imports generated endpoint modules and uses edited runtime metadata', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Runtime', version: '1' }, paths: { '/users': { get: { operationId: 'listUsers', summary: 'Original summary', description: 'Original description', tags: ['users'], deprecated: true, security: [], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } } } } } }, { outputDir });
    const endpointFile = join(outputDir, 'users', 'get', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated
      .replace('method: "GET"', 'method: "POST"')
      .replace('pathShape: "/users"', 'pathShape: "/members/:memberId"')
      .replace('params: z.object({  })', 'params: z.object({ ["memberId"]: z.string() })')
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
    expect(operation.parameters).toContainEqual({ name: 'memberId', in: 'path', required: true, schema: { type: 'string' } });
    expect(operation.responses['200'].content['application/json'].schema).toEqual({ type: 'string' });

    await writeFile(endpointFile, edited.replace('params: z.object({ ["memberId"]: z.string() })', 'params: z.object({  })'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toThrow('Generated endpoint path parameter is not defined: memberId');

    await writeFile(endpointFile, edited.replace('pathShape: "/members/:memberId"', 'pathShape: "/members"'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toThrow('Generated endpoint path parameter is not present in the template: memberId');

    await writeFile(endpointFile, edited.replace('pathShape: "/members/:memberId"', 'pathShape: "/members/{broken"'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toThrow('Invalid generated endpoint path: /members/{broken');
  });
  it('validates edited response statuses against the output dialect', async () => {
    const cases = [
      { document: { openapi: '3.1.0', info: { title: 'Status', version: '1' }, paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } } }, status: '999' },
      { document: { swagger: '2.0', info: { title: 'Status', version: '1' }, paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } } }, status: '4XX' },
    ];
    for (const { document, status } of cases) {
      const outputDir = await temporaryDirectory('zopia-status-');
      await generateApiDocsFiles(document, { outputDir });
      const endpointFile = join(outputDir, 'x', 'get', 'index.ts');
      const replacement = status === '4XX' ? 'response: { ["4XX"]:' : `response: { ${status}:`;
      await writeFile(endpointFile, (await readFile(endpointFile, 'utf8')).replace('response: { 200:', replacement), 'utf8');
      await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toMatchObject({
        code: 'ZOPIA_DOCS_IMPORT_FAILED',
        message: expect.stringContaining(`Invalid generated endpoint response status: ${status}`),
      });
    }
  });
  it('classifies edited runtime endpoint collisions as generated-module failures', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Collision', version: '1' }, paths: {
      '/one': { get: { operationId: 'one', responses: { '200': { description: 'ok' } } } },
      '/two': { get: { operationId: 'two', responses: { '200': { description: 'ok' } } } },
    } }, { outputDir });
    const secondFile = join(outputDir, 'two', 'get', 'index.ts');
    await writeFile(secondFile, (await readFile(secondFile, 'utf8')).replace('pathShape: "/two"', 'pathShape: "/one"'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toMatchObject({
      code: 'ZOPIA_DOCS_IMPORT_FAILED',
      at: 'two/get/index.ts',
      message: expect.stringContaining('Duplicate reconstructed endpoint: /one get'),
    });
  });
  it('reloads edited endpoint content even when file size and timestamps are unchanged', async () => {
    const outputDir = await temporaryDirectory('zopia-cache-');
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Cache', version: '1' },
      paths: { '/status': { get: { responses: { '200': { description: 'ok' } } } } },
    }, { outputDir });
    const endpointFile = join(outputDir, 'status', 'get', 'index.ts');
    const manifestFile = join(outputDir, '.zopia-manifest.json');
    const fixedTime = new Date('2020-01-02T03:04:05.000Z');
    await utimes(endpointFile, fixedTime, fixedTime);

    const before = await manifestFileToOpenApi(manifestFile) as any;
    expect(before.paths['/status'].get).toBeDefined();

    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated.replace('method: "GET"', 'method: "PUT"');
    expect(edited).toHaveLength(generated.length);
    await writeFile(endpointFile, edited, 'utf8');
    await utimes(endpointFile, fixedTime, fixedTime);

    const after = await manifestFileToOpenApi(manifestFile) as any;
    expect(after.paths['/status'].get).toBeUndefined();
    expect(after.paths['/status'].put).toBeDefined();
  });
  it('S-71: keeps manifest security authoritative when runtime auth conflicts', async () => {
    const outputDir = await temporaryDirectory('zopia-security-');
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Security authority', version: '1' },
      components: { securitySchemes: {
        globalAuth: { type: 'apiKey', name: 'X-Global-Key', in: 'header' },
        localAuth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://example.test/token', scopes: { read: 'Read access' } } } },
      } },
      security: [{ globalAuth: [] }],
      paths: {
        '/anonymous': { get: { security: [], responses: { '200': { description: 'ok' } } } },
        '/inherited': { get: { responses: { '200': { description: 'ok' } } } },
        '/optional': { get: { security: [{}, { globalAuth: [] }], responses: { '200': { description: 'ok' } } } },
        '/scoped': { get: { security: [{ localAuth: ['read'] }], responses: { '200': { description: 'ok' } } } },
      },
    }, { outputDir });
    const editAuth = async (name: string, before: 'YES' | 'NO', after: 'YES' | 'NO'): Promise<void> => {
      const file = join(outputDir, name, 'get', 'index.ts');
      const generated = await readFile(file, 'utf8');
      expect(generated).toContain(`auth: "${before}"`);
      await writeFile(file, generated.replace(`auth: "${before}"`, `auth: "${after}"`), 'utf8');
    };
    await editAuth('anonymous', 'NO', 'YES');
    await editAuth('inherited', 'YES', 'NO');
    await editAuth('optional', 'NO', 'YES');

    const reversed = await apiDocsToOpenApi(outputDir);
    const document = reversed.openapi as any;

    expect(document.security).toEqual([{ globalAuth: [] }]);
    expect(document.paths['/anonymous'].get.security).toEqual([]);
    expect(document.paths['/inherited'].get.security).toBeUndefined();
    expect(document.paths['/optional'].get.security).toEqual([{}, { globalAuth: [] }]);
    expect(document.paths['/scoped'].get.security).toEqual([{ localAuth: ['read'] }]);
    expect(reversed.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_DEFAULT_SECURITY')).toEqual([]);

    const manifestFile = join(outputDir, '.zopia-manifest.json');
    const legacyManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    delete legacyManifest.apis.find((api: any) => api.path === '/scoped').security;
    await writeFile(manifestFile, JSON.stringify(legacyManifest), 'utf8');
    const legacy = await apiDocsToOpenApi(outputDir);
    expect((legacy.openapi as any).paths['/scoped'].get.security).toEqual([{ localAuth: ['read'] }]);
    expect(legacy.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_DEFAULT_SECURITY')).toEqual([]);

    const anonymousDefaultDir = await temporaryDirectory('zopia-security-');
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Anonymous default', version: '1' },
      security: [],
      paths: { '/public': { get: { responses: { '200': { description: 'ok' } } } } },
    }, { outputDir: anonymousDefaultDir });
    const publicEndpoint = join(anonymousDefaultDir, 'public', 'get', 'index.ts');
    const publicSource = await readFile(publicEndpoint, 'utf8');
    await writeFile(publicEndpoint, publicSource.replace('auth: "NO"', 'auth: "YES"'), 'utf8');
    const anonymousDefault = await apiDocsToOpenApi(anonymousDefaultDir);
    expect((anonymousDefault.openapi as any).security).toEqual([]);
    expect((anonymousDefault.openapi as any).paths['/public'].get.security).toBeUndefined();
    expect(anonymousDefault.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_DEFAULT_SECURITY')).toEqual([]);
  });
  it('reuses one collision-safe fallback for every operation that lacks manifest security', async () => {
    const outputDir = await temporaryDirectory('zopia-security-');
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Security fallback', version: '1' },
      components: { securitySchemes: {
        bearerAuth: { type: 'apiKey', name: 'X-Existing-Key', in: 'header' },
        bearerAuth2: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      } },
      paths: {
        '/alpha': { get: { responses: { '200': { description: 'ok' } } } },
        '/beta': { post: { responses: { '204': { description: 'ok' } } } },
      },
    }, { outputDir });
    for (const [name, method] of [['alpha', 'get'], ['beta', 'post']] as const) {
      const file = join(outputDir, name, method, 'index.ts');
      const generated = await readFile(file, 'utf8');
      await writeFile(file, generated.replace('auth: "NO"', 'auth: "YES"'), 'utf8');
    }

    const reversed = await apiDocsToOpenApi(outputDir);
    const document = reversed.openapi as any;

    expect(document.paths['/alpha'].get.security).toEqual([{ bearerAuth2: [] }]);
    expect(document.paths['/beta'].post.security).toEqual([{ bearerAuth2: [] }]);
    expect(document.components.securitySchemes.bearerAuth).toEqual({ type: 'apiKey', name: 'X-Existing-Key', in: 'header' });
    expect(document.components.securitySchemes.bearerAuth2).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(reversed.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_DEFAULT_SECURITY').map((warning) => warning.at)).toEqual([
      '#/paths/~1alpha/get/security',
      '#/paths/~1beta/post/security',
    ]);
  });
  it('uses a Swagger-compatible fallback while preserving colliding definitions', async () => {
    const outputDir = await temporaryDirectory('zopia-security-');
    await generateApiDocsFiles({
      swagger: '2.0',
      info: { title: 'Swagger fallback', version: '1' },
      securityDefinitions: { bearerAuth: { type: 'apiKey', name: 'X-Existing-Key', in: 'header' } },
      paths: { '/legacy': { get: { responses: { '200': { description: 'ok' } } } } },
    }, { outputDir });
    const endpoint = join(outputDir, 'legacy', 'get', 'index.ts');
    const generated = await readFile(endpoint, 'utf8');
    await writeFile(endpoint, generated.replace('auth: "NO"', 'auth: "YES"'), 'utf8');
    const warnings: Array<{ code: string; at?: string; message: string }> = [];

    const swagger = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'), { onWarning: (warning) => warnings.push(warning) }) as any;

    expect(swagger.swagger).toBe('2.0');
    expect(swagger.paths['/legacy'].get.security).toEqual([{ bearerAuth2: [] }]);
    expect(swagger.securityDefinitions.bearerAuth).toEqual({ type: 'apiKey', name: 'X-Existing-Key', in: 'header' });
    expect(swagger.securityDefinitions.bearerAuth2).toEqual({
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
    });
    expect(warnings).toEqual([{
      code: 'ZOPIA_WARN_DEFAULT_SECURITY',
      at: '#/paths/~1legacy/get/security',
      message: 'auth is YES but the manifest has no security requirement; using bearerAuth2',
    }]);

    const openApi = await apiDocsToOpenApi(outputDir, { version: '3.0' });
    expect((openApi.openapi as any).openapi).toBe('3.0.0');
    expect((openApi.openapi as any).paths['/legacy'].get.security).toEqual([{ bearerAuth2: [] }]);
    expect((openApi.openapi as any).components.securitySchemes.bearerAuth2).toEqual({ type: 'http', scheme: 'bearer' });
  });
  it('rejects malformed manifest security requirements explicitly', () => {
    const source = { kind: 'openapi-3.1', title: 'Security validation', version: '1' };
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, defaultSecurity: {} as any, apis: [] })).toThrow('Invalid manifest defaultSecurity: expected an array');
    expect(() => manifestToOpenApi({ $schema: 'zopia:manifest@1', source, securitySchemes: { bad: null } as any, apis: [] })).toThrow('Invalid manifest securitySchemes');
    expect(() => manifestToOpenApi({
      $schema: 'zopia:manifest@1',
      source,
      apis: [{ path: '/bad', method: 'get', security: [{ apiKey: ['ok', 42] }] as any }],
    })).toThrow('Invalid manifest security for /bad get alternative 0');
  });
  it('re-serializes edited request and response Zod schemas', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Runtime schemas', version: '1' }, paths: { '/users/{id}': { post: {
      parameters: [
        { name: 'id', in: 'path', required: true, description: 'User ID', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
      ],
      requestBody: { required: true, description: 'Payload', content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } } },
      responses: {
        '201': { description: 'Created', headers: { 'X-Trace': { schema: { type: 'string' } } }, content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } } },
        '204': { description: 'No content' },
        '400': { description: 'Problem', content: { 'application/problem+json': { schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } } },
        '4XX': { description: 'Any client error' },
      },
    } } } }, { outputDir });
    const endpointFile = join(outputDir, 'users', '{id}', 'post', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated
      .replace('body: z.object({ ["name"]: z.string() }).passthrough()', 'body: z.object({ ["name"]: z.string(), ["age"]: z.number().int().min(18), ["role"]: z.string().default("user") }).passthrough()')
      .replace('params: z.object({ ["id"]: z.string() })', 'params: z.object({ ["id"]: z.uuid() })')
      .replace('query: z.object({ ["limit"]: z.number().int().optional() })', 'query: z.object({ ["limit"]: z.number().int().min(1) })')
      .replace('201: z.object({ ["id"]: z.string() }).passthrough()', '201: z.object({ ["id"]: z.uuid(), ["active"]: z.boolean(), ["version"]: z.string().default("1") }).passthrough()')
      .replace('204: z.void()', '202: z.array(z.string()), 204: z.void()');
    await writeFile(endpointFile, edited, 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    const operation = reversed.paths['/users/{id}'].post;
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true, description: 'User ID', schema: expect.objectContaining({ type: 'string', format: 'uuid' }) }),
      expect.objectContaining({ name: 'limit', in: 'query', required: true, schema: expect.objectContaining({ type: 'integer', minimum: 1 }) }),
    ]);
    expect(operation.requestBody).toMatchObject({ required: true, description: 'Payload', content: { 'application/json': { schema: {
      type: 'object',
      properties: { name: { type: 'string' }, age: expect.objectContaining({ type: 'integer', minimum: 18 }), role: { type: 'string', default: 'user' } },
      required: ['name', 'age'],
    } } } });
    expect(operation.responses['201']).toMatchObject({ description: 'Created', headers: { 'X-Trace': { schema: { type: 'string' } } }, content: { 'application/json': { schema: {
      type: 'object', properties: { id: expect.objectContaining({ type: 'string', format: 'uuid' }), active: { type: 'boolean' }, version: { type: 'string', default: '1' } }, required: ['id', 'active', 'version'],
    } } } });
    expect(operation.responses['202']).toMatchObject({ description: 'Generated response', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } });
    expect(operation.responses['204']).toEqual({ description: 'No content' });
    expect(Object.keys(operation.responses['400'].content)).toEqual(['application/problem+json']);
    expect(operation.responses['400'].content['application/problem+json'].schema.properties.message).toEqual({ type: 'string' });
    expect(operation.responses['4XX']).toEqual({ description: 'Any client error' });

    const withoutContent = edited
      .replace('body: z.object({ ["name"]: z.string(), ["age"]: z.number().int().min(18), ["role"]: z.string().default("user") }).passthrough()', 'body: z.any()')
      .replace('query: z.object({ ["limit"]: z.number().int().min(1) })', 'query: z.object({})')
      .replace('201: z.object({ ["id"]: z.uuid(), ["active"]: z.boolean(), ["version"]: z.string().default("1") }).passthrough()', '201: z.void()');
    await writeFile(endpointFile, withoutContent, 'utf8');
    const rereversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    const stripped = rereversed.paths['/users/{id}'].post;
    expect(stripped.requestBody).toBeUndefined();
    expect(stripped.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
    expect(stripped.responses['201']).toEqual({ description: 'Created', headers: { 'X-Trace': { schema: { type: 'string' } } } });
  });
  it('replaces edited media types and treats runtime examples as authoritative', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Media edits', version: '1' }, paths: { '/messages': { post: {
      requestBody: { content: { 'application/json': { example: { message: 'old request' }, schema: { type: 'string' } } } },
      responses: { '200': { description: 'ok', content: { 'application/json': { example: { message: 'old response' }, schema: { type: 'string' } } } } },
    } } } }, { outputDir });
    const endpointFile = join(outputDir, 'messages', 'post', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated
      .replace('requestContentType: "application/json"', 'requestContentType: "application/xml"')
      .replace('responseContentType: "application/json"', 'responseContentType: "application/xml"')
      .replace(/^  examples: .*,$/m, '  examples: { request: { edited: { value: "new request" } }, response: { 200: { edited: { value: "new response" } } } },');
    await writeFile(endpointFile, edited, 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    const operation = reversed.paths['/messages'].post;
    expect(Object.keys(operation.requestBody.content)).toEqual(['application/xml']);
    expect(operation.requestBody.content['application/xml']).toMatchObject({ examples: { edited: { value: 'new request' } }, schema: { type: 'string' } });
    expect(operation.requestBody.content['application/xml'].example).toBeUndefined();
    expect(Object.keys(operation.responses['200'].content)).toEqual(['application/xml']);
    expect(operation.responses['200'].content['application/xml']).toMatchObject({ examples: { edited: { value: 'new response' } }, schema: { type: 'string' } });
    expect(operation.responses['200'].content['application/xml'].example).toBeUndefined();

    await writeFile(endpointFile, edited.replace(/^  examples: .*\n/m, ''), 'utf8');
    const withoutExamples = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(withoutExamples.paths['/messages'].post.requestBody.content['application/xml'].examples).toBeUndefined();
    expect(withoutExamples.paths['/messages'].post.responses['200'].content['application/xml'].examples).toBeUndefined();
  });
  it('S-70: applies manifest refs, schema overlays, and response overlays after runtime serialization', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Overlays', version: '1' }, components: { schemas: {
      User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    } }, paths: { '/events': { post: {
      callbacks: { onEvent: { '{$request.body#/callbackUrl}': { post: { responses: { '204': { description: 'received' } } } } } },
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { clock: { type: 'string', format: 'time' }, frozen: { type: 'string' } }, required: ['clock', 'frozen'] } } } },
      responses: { '200': { description: 'ok', headers: { 'X-Trace': { description: 'trace', schema: { type: 'string' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
    } } } }, { outputDir });
    const manifestFile = join(outputDir, '.zopia-manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const api = manifest.apis[0];
    expect(api.refs).toContainEqual(expect.objectContaining({ at: '/responses/200/content/application~1json/schema/$ref', ref: '#/components/schemas/User' }));
    delete api.sourceOperation.callbacks;
    delete api.sourceOperation.responses['200'].headers;
    api.overlay.push(
      { at: '/requestBody/content/application~1json/schema/properties/clock', set: { format: 'time', readOnly: true }, remove: ['pattern'] },
      { at: '/requestBody/content/application~1json/schema/properties/frozen', node: { allOf: [{ type: 'string' }, { minLength: 2 }], 'x-frozen': true } },
    );
    api.responseOverlay.push({ status: '__proto__', polluted: true });
    await writeFile(manifestFile, JSON.stringify(manifest), 'utf8');

    const reversed = await manifestFileToOpenApi(manifestFile) as any;
    const operation = reversed.paths['/events'].post;
    expect(operation.requestBody.content['application/json'].schema.properties.clock).toEqual({ type: 'string', format: 'time', readOnly: true });
    expect(operation.requestBody.content['application/json'].schema.properties.frozen).toEqual({ allOf: [{ type: 'string' }, { minLength: 2 }], 'x-frozen': true });
    expect(operation.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/User' });
    expect(operation.responses['200'].headers).toEqual({ 'X-Trace': { description: 'trace', schema: { type: 'string' } } });
    expect(operation.callbacks.onEvent).toBeDefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
  it('re-serializes edited Swagger request and response schemas', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Legacy runtime schemas', version: '1' }, consumes: ['application/json', 'application/xml'], produces: ['application/json', 'application/xml'], paths: { '/items/{id}': { post: {
      parameters: [
        { name: 'id', in: 'path', required: true, type: 'string' },
        { name: 'limit', in: 'query', type: 'integer' },
        { name: 'payload', in: 'body', required: true, schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      ],
      responses: { '200': { description: 'OK', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }, '204': { description: 'Empty' } },
    } } } }, { outputDir });
    const endpointFile = join(outputDir, 'items', '{id}', 'post', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated
      .replace('body: z.object({ ["name"]: z.string() }).passthrough()', 'body: z.object({ ["count"]: z.number().int().min(1) }).passthrough()')
      .replace('params: z.object({ ["id"]: z.string() })', 'params: z.object({ ["id"]: z.uuid() })')
      .replace('query: z.object({ ["limit"]: z.number().int().optional() })', 'query: z.object({ ["limit"]: z.number().int().min(2) })')
      .replace('200: z.object({ ["ok"]: z.boolean() }).passthrough()', '200: z.object({ ["ok"]: z.boolean(), ["message"]: z.string() }).passthrough()');
    await writeFile(endpointFile, edited, 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    const operation = reversed.paths['/items/{id}'].post;
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true, type: 'string', format: 'uuid' }),
      expect.objectContaining({ name: 'limit', in: 'query', required: true, type: 'integer', minimum: 2 }),
      expect.objectContaining({ name: 'payload', in: 'body', required: true, schema: expect.objectContaining({ properties: { count: expect.objectContaining({ type: 'integer', minimum: 1 }) }, required: ['count'] }) }),
    ]);
    expect(operation.responses['200']).toMatchObject({ description: 'OK', schema: { properties: { ok: { type: 'boolean' }, message: { type: 'string' } }, required: ['ok', 'message'] } });
    expect(operation.responses['204']).toEqual({ description: 'Empty' });

    const selected = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'), { version: '3.1' }) as any;
    const selectedOperation = selected.paths['/items/{id}'].post;
    expect(selectedOperation.requestBody.content['application/json'].schema.properties.count.minimum).toBe(1);
    expect(selectedOperation.requestBody.content['application/xml'].schema.properties.count.minimum).toBe(1);
    expect(selectedOperation.responses['200'].content['application/json'].schema.properties.message).toEqual({ type: 'string' });
    expect(selectedOperation.responses['200'].content['application/xml'].schema.properties.message).toEqual({ type: 'string' });
  });
  it('honors Swagger form-to-body content edits and edited legacy examples', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Swagger media', version: '1' }, consumes: ['multipart/form-data'], produces: ['application/json'], paths: { '/upload': { post: {
      parameters: [{ name: 'name', in: 'formData', required: true, type: 'string' }],
      responses: { '200': { description: 'ok', schema: { type: 'string' }, examples: { 'application/json': 'old response' } } },
    } } } }, { outputDir });
    const endpointFile = join(outputDir, 'upload', 'post', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');
    const edited = generated
      .replace('requestContentType: "multipart/form-data"', 'requestContentType: "application/json"')
      .replace('responseContentType: "application/json"', 'responseContentType: "application/xml"')
      .replace(/^  examples: .*,$/m, '  examples: { response: { 200: { "application/xml": { value: "new response" } } } },');
    await writeFile(endpointFile, edited, 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    const operation = reversed.paths['/upload'].post;
    expect(operation.parameters.filter((parameter: any) => parameter.in === 'formData')).toEqual([]);
    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: 'body', in: 'body', schema: expect.objectContaining({ type: 'object', required: ['name'] }) }));
    expect(operation.consumes).toEqual(['application/json']);
    expect(operation.produces).toEqual(['application/xml']);
    expect(operation.responses['200'].examples).toEqual({ 'application/xml': 'new response' });
  });
  it('rejects Swagger-only parameter shapes that cannot be represented', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Swagger params', version: '1' }, paths: { '/items': { get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir });
    const endpointFile = join(outputDir, 'items', 'get', 'index.ts');
    const generated = await readFile(endpointFile, 'utf8');

    await writeFile(endpointFile, generated.replace('cookies: z.object({  })', 'cookies: z.object({ ["session"]: z.string() })'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toThrow('Swagger 2.0 does not support cookie parameters');

    await writeFile(endpointFile, generated.replace('query: z.object({  })', 'query: z.object({ ["filter"]: z.object({ ["id"]: z.string() }) })'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toThrow('Swagger 2.0 query parameter filter must serialize to a primitive, array, or file schema');
  });
  it('imports emitted component modules and uses edited Zod schemas', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Components', version: '1' }, components: { schemas: { User: { type: 'object', title: 'User', description: 'A user', properties: { id: { type: 'string' } }, required: ['id'] }, Group: { type: 'object', properties: { owner: { $ref: '#/components/schemas/User' } }, required: ['owner'] }, UserAlias: { $ref: '#/components/schemas/User' } } }, paths: { '/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserAlias' } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
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
    expect(reversed.components.schemas.User).toMatchObject({ title: 'User', description: 'A user' });
    expect(reversed.components.schemas.Group.properties.owner).toEqual({ $ref: '#/components/schemas/User' });
    expect(reversed.components.schemas.UserAlias).toEqual({ $ref: '#/components/schemas/User' });
    expect(reversed.paths['/users'].get.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/UserAlias' });

    await writeFile(componentFile, (await readFile(componentFile, 'utf8')).replace('.min(1)', '.min(2)').replace('.passthrough()', '.strict()'), 'utf8');
    const rereversed = await manifestFileToOpenApi(manifestFile) as any;
    expect(rereversed.components.schemas.User.properties.id.minimum).toBe(2);
    expect(rereversed.components.schemas.User.additionalProperties).toBe(false);

    const endpointFile = join(outputDir, 'users', 'get', 'index.ts');
    const endpoint = await readFile(endpointFile, 'utf8');
    await writeFile(endpointFile, endpoint.replace('{ UserAliasSchema }', '{ GroupSchema }').replace('200: UserAliasSchema', '200: GroupSchema'), 'utf8');
    const editedManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    editedManifest.apis[0].overlay.push({ at: '/responses/200/content/application~1json/schema', set: { 'x-source-ref': true } });
    await writeFile(manifestFile, JSON.stringify(editedManifest), 'utf8');
    const referenceEdited = await manifestFileToOpenApi(manifestFile) as any;
    expect(referenceEdited.paths['/users'].get.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Group' });
  });
  it('keeps edited component openness authoritative over source structure', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({
      openapi: '3.1.0', info: { title: 'Openness', version: '1' },
      components: { schemas: { Closed: { type: 'object', properties: { id: { type: 'string' }, blocked: false }, required: ['id'], additionalProperties: false } } },
      paths: {},
    }, { outputDir, insertComponents: true });
    const componentFile = join(outputDir, 'components', 'Closed', 'index.ts');
    const generated = await readFile(componentFile, 'utf8');
    await writeFile(componentFile, generated.replace('.strict()', '.passthrough()').replace('["blocked"]: z.never().optional()', '["blocked"]: z.string().optional()'), 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.components.schemas.Closed.additionalProperties).toEqual({});
    expect(reversed.components.schemas.Closed.properties.blocked).toEqual({ type: 'string' });
  });
  it('keeps edited draft tuple members authoritative over tuple-spelling overlays', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({
      swagger: '2.0', info: { title: 'Tuple edits', version: '1' },
      definitions: { Pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }], additionalItems: false } }, paths: {},
    }, { outputDir, insertComponents: true });
    const componentFile = join(outputDir, 'components', 'Pair', 'index.ts');
    const generated = await readFile(componentFile, 'utf8');
    await writeFile(componentFile, generated.replace('z.string().optional()', 'z.boolean().optional()'), 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.definitions.Pair.items[0]).toEqual({ type: 'boolean' });
  });
  it('does not let frozen overlays overwrite edited component validation', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({
      openapi: '3.1.0', info: { title: 'Frozen edits', version: '1' },
      components: { schemas: { Name: { allOf: [{ type: 'string', minLength: 2 }, { type: 'string', maxLength: 8 }] } } }, paths: {},
    }, { outputDir, insertComponents: true });
    const componentFile = join(outputDir, 'components', 'Name', 'index.ts');
    const generated = await readFile(componentFile, 'utf8');
    await writeFile(componentFile, generated.replace('.min(2)', '.min(3)'), 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.components.schemas.Name.minLength).toBe(3);
    expect(reversed.components.schemas.Name).not.toHaveProperty('allOf');
  });
  it('round-trips emitted root and nested component annotations through generated code', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({
      openapi: '3.1.0', info: { title: 'Annotations', version: '1' },
      components: { schemas: { Annotated: {
        type: 'object', deprecated: true, readOnly: true, 'x-root': 'kept',
        properties: { nested: { type: 'object', description: 'Nested', writeOnly: true, 'x-nested': 1, properties: { value: { type: 'string' } } } },
      } } }, paths: {},
    }, { outputDir, insertComponents: true });

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.components.schemas.Annotated).toMatchObject({ deprecated: true, readOnly: true, 'x-root': 'kept' });
    expect(reversed.components.schemas.Annotated.properties.nested).toMatchObject({ description: 'Nested', writeOnly: true, 'x-nested': 1 });
  });
  it('round-trips escaped component names and direct-ref siblings through generated code', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Escaped refs', version: '1' }, components: { schemas: {
      'User~Model': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      'Alias~Model': { $ref: '#/components/schemas/User~0Model', description: 'Alias schema', maxProperties: 2 },
    } }, paths: { '/alias': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Alias~0Model' } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });

    const aliasFile = await readFile(join(outputDir, 'components', 'Alias~Model', 'index.ts'), 'utf8');
    expect(aliasFile).toContain('from "../User~Model/index"');
    expect(aliasFile).toContain('z.lazy(() => UserModelSchema)');
    expect(aliasFile).toContain('Object.keys(value).length <= 2');
    expect(aliasFile).toContain('.meta({"description":"Alias schema"})');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.components.schemas['Alias~Model']).toEqual({ description: 'Alias schema', maxProperties: 2, $ref: '#/components/schemas/User~0Model' });
    expect(reversed.paths['/alias'].get.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Alias~0Model' });
  });
  it('imports nested cyclic component graphs without eager initialization failures', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Cycles', version: '1' }, components: { schemas: {
      Left: { type: 'object', properties: { nested: { type: 'object', properties: { right: { $ref: '#/components/schemas/Right' } }, required: ['right'] } }, required: ['nested'] },
      Right: { type: 'object', properties: { nested: { type: 'object', properties: { left: { $ref: '#/components/schemas/Left' } }, required: ['left'] } }, required: ['nested'] },
    } }, paths: {} }, { outputDir, insertComponents: true });

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.components.schemas.Left.properties.nested.properties.right).toEqual({ $ref: '#/components/schemas/Right' });
    expect(reversed.components.schemas.Right.properties.nested.properties.left).toEqual({ $ref: '#/components/schemas/Left' });
  });
  it('preserves unique array semantics through imported component schemas', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Unique', version: '1' }, components: { schemas: {
      Tags: { type: 'array', title: 'Tags', description: 'Unique tags', items: { type: 'string' }, uniqueItems: true },
      Constants: { type: 'object', properties: { coordinates: { const: [1, 2] }, choice: { enum: [{ kind: 'a' }, { kind: 'b' }] } }, required: ['coordinates', 'choice'] },
      Bounded: { type: 'object', properties: { value: { type: 'string' } }, minProperties: 1, maxProperties: 2 },
      FlexibleTuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], minItems: 1, maxItems: 3 },
    } }, paths: {} }, { outputDir, insertComponents: true });

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.components.schemas.Tags).toMatchObject({ type: 'array', title: 'Tags', description: 'Unique tags', items: { type: 'string' }, uniqueItems: true });
    expect(reversed.components.schemas.Constants.properties.coordinates.const).toEqual([1, 2]);
    expect(reversed.components.schemas.Constants.properties.choice.enum).toEqual([{ kind: 'a' }, { kind: 'b' }]);
    expect(reversed.components.schemas.Bounded).toMatchObject({ minProperties: 1, maxProperties: 2 });
    expect(reversed.components.schemas.FlexibleTuple).toMatchObject({
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 1,
      maxItems: 3,
    });
  });
  it('restores Engine ② schema overlays for endpoints and emitted components', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    const frozen = { type: 'string', not: { const: 'blocked' } };
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Overlay API', version: '1' },
      components: { schemas: { Clock: { type: 'string', format: 'time' } } },
      paths: {
        '/overlays': { post: {
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
            website: { type: 'string', format: 'url' },
            ids: { type: 'array', uniqueItems: true, items: { type: 'string' } },
          } } } } },
          responses: {
            '200': { description: 'ok', content: { 'application/json': { schema: frozen } } },
          },
        } },
      },
    }, { outputDir, insertComponents: true });

    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.apis[0].overlay).toEqual(expect.arrayContaining([
      expect.objectContaining({ at: '/requestBody/content/application~1json/schema/properties/website', set: { format: 'url' } }),
      expect.objectContaining({ at: '/requestBody/content/application~1json/schema/properties/ids', set: { uniqueItems: true } }),
      expect.objectContaining({ at: '/responses/200/content/application~1json/schema', node: frozen }),
    ]));
    expect(manifest.components[0].overlay).toEqual([{ at: '', set: { format: 'time' }, remove: ['pattern'] }]);
    const componentSource = await readFile(join(outputDir, 'components', 'Clock', 'index.ts'), 'utf8');
    expect(componentSource).toMatch(/export const ClockSchema = \(\n\s*\/\/ @zopia:warn ZOPIA_WARN_CUSTOM_FORMAT/);
    const endpointSource = await readFile(join(outputDir, manifest.apis[0].file), 'utf8');
    expect(endpointSource).toContain('@zopia:warn ZOPIA_WARN_CUSTOM_FORMAT');
    expect(endpointSource).toContain('@zopia:warn ZOPIA_WARN_UNIQUE_ITEMS');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    const operation = reversed.paths['/overlays'].post;
    expect(operation.requestBody.content['application/json'].schema.properties.website).toEqual({ type: 'string', format: 'url' });
    expect(operation.requestBody.content['application/json'].schema.properties.ids).toMatchObject({ type: 'array', uniqueItems: true, items: { type: 'string' } });
    expect(operation.responses['200'].content['application/json'].schema).toEqual(frozen);
    expect(reversed.components.schemas.Clock).toEqual({ type: 'string', format: 'time' });
  });
  it('converts imported components to the source Swagger dialect', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Legacy components', version: '1' }, definitions: { Limit: { type: 'number' } }, paths: {} }, { outputDir, insertComponents: true });
    const componentFile = join(outputDir, 'components', 'Limit', 'index.ts');
    const generated = await readFile(componentFile, 'utf8');
    await writeFile(componentFile, generated.replace('z.number()', 'z.number().gt(1)'), 'utf8');

    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.definitions.Limit).toEqual({ type: 'number', minimum: 1, exclusiveMinimum: true });
  });
  it('selects a matching named endpoint config before a different default export', async () => {
    const directory = await temporaryDirectory('zopia-');
    const endpointFile = join(directory, 'endpoints.ts');
    await writeFile(endpointFile, `import { z } from 'zod';\nimport { makeApiConfig } from 'km-api';\nconst request = { body: z.any(), params: z.object({}), query: z.object({}), headers: z.object({}), cookies: z.object({}) };\nexport const first = makeApiConfig({ method: 'GET', pathShape: '/first', operationId: 'first', auth: 'NO', request, response: { 200: z.string() } });\nexport const second = makeApiConfig({ method: 'POST', pathShape: '/second', operationId: 'second', auth: 'NO', request, response: { 201: z.number() } });\nexport default first;\n`, 'utf8');
    const manifestFile = join(directory, '.zopia-manifest.json');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Multiple', version: '1' }, apis: [
      { file: 'endpoints.ts', path: '/first', method: 'get', operationId: 'first', sourceOperation: { operationId: 'first', responses: { '200': { description: 'first' } } } },
      { file: 'endpoints.ts', path: '/second', method: 'post', operationId: 'second', sourceOperation: { operationId: 'second', responses: { '201': { description: 'second' } } } },
    ] }), 'utf8');

    const reversed = await manifestFileToOpenApi(manifestFile) as any;
    expect(reversed.paths['/first'].get.responses['200'].content['application/json'].schema).toEqual({ type: 'string' });
    expect(reversed.paths['/second'].post.responses['201'].content['application/json'].schema).toEqual({ type: 'number' });
  });
  it('detects renamed generated files before importing any listed module', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Rename', version: '1' }, paths: { '/users': { get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir });
    const endpointFile = join(outputDir, 'users', 'get', 'index.ts');
    await rename(endpointFile, join(outputDir, 'users', 'get', 'renamed.ts'));
    const mismatch = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')).catch((error: unknown) => error);
    expect(mismatch).toMatchObject({ code: 'ZOPIA_DOCS_MANIFEST_MISMATCH', message: expect.stringContaining('generated endpoint file is missing or renamed: users/get/index.ts') });

    const directory = await temporaryDirectory('zopia-');
    await writeFile(join(directory, 'first.ts'), `import { writeFileSync } from 'node:fs';\nimport { z } from 'zod';\nimport { makeApiConfig } from 'km-api';\nwriteFileSync(new URL('./executed.txt', import.meta.url), 'executed');\nexport default makeApiConfig({ method: 'GET', pathShape: '/first', operationId: 'first', auth: 'NO', request: { body: z.any(), params: z.object({}), query: z.object({}), headers: z.object({}), cookies: z.object({}) }, response: { 200: z.void() } });\n`, 'utf8');
    const manifestFile = join(directory, '.zopia-manifest.json');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source: { kind: 'openapi-3.1', title: 'Preflight', version: '1' }, apis: [
      { file: 'first.ts', path: '/first', method: 'get', operationId: 'first' },
      { file: 'renamed.ts', path: '/second', method: 'get', operationId: 'second' },
    ] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('ZOPIA_DOCS_MANIFEST_MISMATCH: generated endpoint file is missing or renamed: renamed.ts');
    await expect(readFile(join(directory, 'executed.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects missing, unsafe, and invalid generated endpoint modules', async () => {
    const directory = await temporaryDirectory('zopia-');
    const source = { kind: 'openapi-3.1', title: 'Test', version: '1' };
    const manifestFile = join(directory, '.zopia-manifest.json');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('ZOPIA_DOCS_MANIFEST_MISMATCH: manifest API entry does not list a generated file');

    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: 'missing.ts', path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('ZOPIA_DOCS_MANIFEST_MISMATCH: generated endpoint file is missing or renamed: missing.ts');

    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: join(directory, 'absolute.ts'), path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest API file');

    const outsideDirectory = await temporaryDirectory('zopia-outside-');
    const outsideFile = join(outsideDirectory, 'outside.ts');
    await writeFile(outsideFile, 'export default {};\n', 'utf8');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: relative(directory, outsideFile), path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest API file');

    await symlink(outsideFile, join(directory, 'linked.ts'));
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: 'linked.ts', path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest API file');

    await writeFile(join(directory, 'invalid.ts'), 'export default {};\n', 'utf8');
    await writeFile(manifestFile, JSON.stringify({ $schema: 'zopia:manifest@1', source, apis: [{ file: 'invalid.ts', path: '/x', method: 'get' }] }), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_IMPORT_FAILED', at: 'invalid.ts', message: expect.stringContaining('does not export a unique km-api config') });
  });
  it('rejects missing, unsafe, and invalid generated component modules', async () => {
    const directory = await temporaryDirectory('zopia-');
    const source = { kind: 'openapi-3.1', title: 'Test', version: '1' };
    const manifestFile = join(directory, '.zopia-manifest.json');
    const manifest = (file: string) => ({ $schema: 'zopia:manifest@1', source, components: [{ name: 'User', file, schema: { type: 'string' } }], apis: [] });

    await writeFile(manifestFile, JSON.stringify(manifest('missing.ts')), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('ZOPIA_DOCS_MANIFEST_MISMATCH: generated component file is missing or renamed: missing.ts');

    await writeFile(manifestFile, JSON.stringify(manifest(join(directory, 'absolute.ts'))), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toThrow('Unsafe manifest component file');

    await writeFile(join(directory, 'invalid-component.ts'), 'export default {};\n', 'utf8');
    await writeFile(manifestFile, JSON.stringify(manifest('invalid-component.ts')), 'utf8');
    await expect(manifestFileToOpenApi(manifestFile)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_IMPORT_FAILED', at: 'invalid-component.ts', message: expect.stringContaining('does not export a unique Zod schema') });
  });
  it('round-trips reusable OpenAPI and Swagger component sections', async () => {
    const openApiDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Reusable', version: '1' }, components: {
      parameters: { 'Trace~Header': { name: 'trace', in: 'header', description: 'trace header', schema: { type: 'string' } } },
      responses: { 'Problem~Response': { description: 'problem', content: { 'application/json': { schema: { type: 'string' } } } } },
      headers: { RateLimit: { schema: { type: 'integer' } } },
    }, paths: { '/x': { get: { parameters: [{ $ref: '#/components/parameters/Trace~0Header' }], responses: { '400': { $ref: '#/components/responses/Problem~0Response' } } } } } }, { outputDir: openApiDir });
    const openApiManifest = JSON.parse(await readFile(join(openApiDir, '.zopia-manifest.json'), 'utf8'));
    const openApi = manifestToOpenApi(openApiManifest) as any;
    expect(openApi.components.parameters['Trace~Header'].name).toBe('trace');
    expect(openApi.components.responses['Problem~Response'].description).toBe('problem');
    expect(openApi.components.headers.RateLimit.schema.type).toBe('integer');
    const openApiRuntime = await manifestFileToOpenApi(join(openApiDir, '.zopia-manifest.json')) as any;
    expect(openApiRuntime.paths['/x'].get.parameters).toEqual([{ $ref: '#/components/parameters/Trace~0Header' }]);
    expect(openApiRuntime.paths['/x'].get.responses['400']).toEqual({ $ref: '#/components/responses/Problem~0Response' });

    const swaggerDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Reusable', version: '1' }, parameters: { Limit: { name: 'limit', in: 'query', type: 'integer' } }, responses: { Problem: { description: 'problem', schema: { type: 'string' } } }, paths: { '/x': { get: { parameters: [{ $ref: '#/parameters/Limit' }], responses: { '400': { $ref: '#/responses/Problem' } } } } } }, { outputDir: swaggerDir });
    const swaggerManifest = JSON.parse(await readFile(join(swaggerDir, '.zopia-manifest.json'), 'utf8'));
    const swagger = manifestToOpenApi(swaggerManifest) as any;
    expect(swagger.parameters.Limit.type).toBe('integer');
    expect(swagger.responses.Problem.description).toBe('problem');
  });
  it('round-trips Swagger basePath and security definitions', async () => {
    const outputDir = await temporaryDirectory('zopia-');
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
  it('S-96/S-97: restores Swagger 2.0 collectionFormat and file uploads in OpenAPI 3.x output', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await openApiToApiDocs(SERIALIZATION_SPEC, { outDir: outputDir });

    for (const version of ['3.1', '3.0'] as const) {
      const { openapi, warnings } = await apiDocsToOpenApi(outputDir, { version });
      const document = openapi as any;
      expect(document.components.parameters.TagsParam).toEqual({
        in: 'query',
        name: 'tags',
        style: 'form',
        explode: false,
        schema: { type: 'array', items: { type: 'string' } },
      });
      expect(document.paths['/uploads'].post.requestBody.content['multipart/form-data']).toEqual({
        schema: {
          type: 'object',
          properties: {
            file: { type: 'string', format: 'binary' },
            flags: { type: 'array', items: { type: 'string' } },
            labels: { type: 'array', items: { type: 'string' } },
            notes: { type: 'array', items: { type: 'integer' } },
          },
          required: ['file'],
        },
        encoding: {
          labels: { style: 'form', explode: true },
          flags: { style: 'form', explode: true, 'x-collectionFormat': 'pipes' },
          notes: { style: 'form', explode: true, 'x-collectionFormat': 'ssv' },
        },
      });
      expect(warnings).toEqual(expect.arrayContaining([
        { code: 'ZOPIA_WARN_COLLECTION_FORMAT', at: '#/paths/~1uploads/post/requestBody/content/multipart~1form-data/encoding/flags', message: expect.stringContaining('pipes') },
        { code: 'ZOPIA_WARN_COLLECTION_FORMAT', at: '#/paths/~1uploads/post/requestBody/content/multipart~1form-data/encoding/notes', message: expect.stringContaining('ssv') },
      ]));
      expect(warnings.filter((warning) => warning.code === 'ZOPIA_WARN_COLLECTION_FORMAT')).toHaveLength(2);
    }

    const legacy = await apiDocsToOpenApi(outputDir, { version: '2.0' });
    const swagger = legacy.openapi as any;
    expect(swagger.parameters.TagsParam).toEqual({ name: 'tags', in: 'query', type: 'array', items: { type: 'string' }, collectionFormat: 'csv' });
    expect(swagger.paths['/things'].get.parameters).toEqual([{ $ref: '#/parameters/TagsParam' }]);
    const formData = Object.fromEntries((swagger.paths['/uploads'].post.parameters as any[]).map((parameter) => [parameter.name, parameter]));
    expect(formData.file).toEqual({ name: 'file', in: 'formData', required: true, type: 'file' });
    expect(formData.labels.collectionFormat).toBe('multi');
    expect(formData.flags.collectionFormat).toBe('pipes');
    expect(formData.notes.collectionFormat).toBe('ssv');
    expect(legacy.warnings.filter((warning) => warning.code === 'ZOPIA_WARN_COLLECTION_FORMAT')).toEqual([]);
  });
  it('S-98: reports a preset split root distinctly from a genuinely missing manifest', async () => {
    const root = await temporaryDirectory('zopia-');
    const outDir = join(root, 'api_docs');
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Preset root', version: '1.0.0' },
      paths: {
        '/users': { get: { operationId: 'listUsers', tags: ['users'], responses: { '200': { description: 'OK' } } } },
        '/orders': { get: { operationId: 'listOrders', tags: ['orders'], responses: { '200': { description: 'OK' } } } },
        '/health': { get: { operationId: 'health', responses: { '200': { description: 'OK' } } } },
      },
    }, { outDir, preset: 'multi-tag' });

    const presetRootError = await apiDocsToOpenApi(outDir).catch((error: unknown) => error) as ZopiaError;
    expect(presetRootError).toMatchObject({ code: 'ZOPIA_DOCS_PRESET_ROOT', at: outDir, hint: expect.any(String) });
    expect(presetRootError.message).toContain('this directory is a preset split (3 trees: orders, untagged, users)');
    expect(presetRootError.message).toContain('zopia reverse api_docs/orders');

    const bucket = await apiDocsToOpenApi(join(outDir, 'users'));
    expect(Object.keys((bucket.openapi as any).paths)).toEqual(['/users']);

    const empty = await temporaryDirectory('zopia-');
    await expect(apiDocsToOpenApi(empty)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST' });
    const shallow = await temporaryDirectory('zopia-');
    await mkdir(join(shallow, 'nested'), { recursive: true });
    await expect(apiDocsToOpenApi(shallow)).rejects.toMatchObject({ code: 'ZOPIA_DOCS_MISSING_MANIFEST' });
  });
  it('S-99: round-trips an authored OpenAPI 3.1 inclusive/exclusive numeric bound pair', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'Bounds API', version: '1.0.0' },
      paths: {
        '/things/{thingId}': {
          get: {
            operationId: 'getThing',
            parameters: [{ name: 'thingId', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } } },
          },
        },
      },
      components: { schemas: { Thing: { type: 'object', properties: { age: { type: 'integer', minimum: 0, exclusiveMinimum: 0, maximum: 150 } } } } },
    }, { outDir: outputDir, insertComponents: true });

    const generated = await readFile(join(outputDir, 'components', 'Thing', 'index.ts'), 'utf8');
    expect(generated).toContain('.min(0)');
    expect(generated).toContain('.gt(0)');

    const { openapi } = await apiDocsToOpenApi(outputDir);
    expect((openapi as any).components.schemas.Thing.properties.age).toEqual({ type: 'integer', minimum: 0, exclusiveMinimum: 0, maximum: 150 });
  });
  it('round-trips a generated manifest without losing the operation', async () => {
    const outputDir = await temporaryDirectory('zopia-');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Round trip', version: '1' }, paths: { '/users': { get: { operationId: 'listUsers', security: [], responses: { '200': { description: 'ok' } } } } } }, { outputDir });
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    const result = manifestToOpenApi(manifest) as any;
    expect(result.paths['/users'].get.operationId).toBe('listUsers');
    expect(result.paths['/users'].get.security).toEqual([]);
  });
});
