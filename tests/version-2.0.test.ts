import { useTemporaryDirectories } from './test-temporary-directories';
import { describe, expect, it } from 'vitest';
import { generateApiDocsFiles, manifestFileToOpenApi, manifestToOpenApi } from '../src';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const temporaryDirectory = useTemporaryDirectories();

async function manifestFrom(document: Record<string, unknown>): Promise<string> {
  const outputDir = await temporaryDirectory('zopia-');
  await generateApiDocsFiles(document as any, { outputDir, insertComponents: true, useComponentAsReference: true });
  return join(outputDir, '.zopia-manifest.json');
}

describe('OpenAPI 2.0 reverse output (D-20)', () => {
  it('S-84: converts 3.x manifests into swagger-2.0 shaped reconstruction inputs', async () => {
    const manifestFile = await manifestFrom({
      openapi: '3.1.0',
      info: { title: 'Versions', version: '1' },
      servers: [{ url: 'https://api.example.com/v1' }],
      components: { schemas: { User: { type: 'object', properties: { name: { anyOf: [{ type: 'string' }, { type: 'null' }] } } } } },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
            responses: { '201': { description: 'created', content: { 'application/json': { schema: { type: ['string', 'null'] } } } } },
          },
        },
      },
    });
    const document = await manifestFileToOpenApi(manifestFile, { version: '2.0' }) as any;
    expect(document.swagger).toBe('2.0');
    expect(document.openapi).toBeUndefined();
    expect(document.host).toBe('api.example.com');
    expect(document.basePath).toBe('/v1');
    expect(document.schemes).toEqual(['https']);
    expect(document.definitions.User).toMatchObject({ properties: { name: { type: 'string', 'x-nullable': true } } });
    const post = document.paths['/users'].post;
    expect(post.parameters).toContainEqual(expect.objectContaining({ in: 'body', name: 'body', required: true, schema: { $ref: '#/definitions/User' } }));
    expect(post.responses['201'].schema).toMatchObject({ type: 'string', 'x-nullable': true });
    expect(document.consumes).toEqual(['application/json']);
    expect(document.produces).toEqual(['application/json']);
  });

  it('S-84: degrades unrepresentable 3.x features with deterministic downgrade warnings', async () => {
    const manifestFile = await manifestFrom({
      openapi: '3.1.0',
      info: { title: 'Rich', version: '1' },
      webhooks: { onUser: { post: { responses: { '200': { description: 'ok' } } } } },
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ name: 'trace', in: 'cookie', schema: { type: 'string' } }],
            responses: { '200': { description: 'ok', links: { next: {} } } },
          },
        },
      },
    });
    const warnings: Array<{ code: string; at?: string }> = [];
    const document = await manifestFileToOpenApi(manifestFile, { version: '2.0', onWarning: (warning) => warnings.push(warning) }) as any;
    expect(document.swagger).toBe('2.0');
    expect(document.webhooks).toBeUndefined();
    expect(document.jsonSchemaDialect).toBeUndefined();
    expect(document.paths['/users'].get.parameters ?? []).toHaveLength(0);
    expect(document.paths['/users'].get.responses['200'].links).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks' }));
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_DIALECT_DOWNGRADE', at: '#/jsonSchemaDialect' }));
    expect(warnings.some((warning) => warning.code === 'ZOPIA_WARN_DIALECT_DOWNGRADE' && (warning.at ?? '').includes('/parameters/0'))).toBe(true);
    expect(warnings.some((warning) => (warning.at ?? '').endsWith('/links'))).toBe(true);
  });

  it('S-84: converts reusable 3.1 parameters and responses into global swagger tables', async () => {
    const manifestFile = await manifestFrom(JSON.parse(await readFile(join(__dirname, 'fixtures/specs/reusables-3.1.json'), 'utf8')) as Record<string, unknown>);
    const document = await manifestFileToOpenApi(manifestFile, { version: '2.0' }) as any;
    expect(document.swagger).toBe('2.0');
    expect(document.parameters.PageSize).toMatchObject({ name: 'pageSize', in: 'query', type: 'integer', minimum: 1 });
    expect(document.responses.NotFound).toMatchObject({ description: 'missing', schema: { $ref: '#/definitions/Widget' } });
    const parameters = document.paths['/widgets'].get.parameters;
    expect(parameters.some((value: any) => value?.$ref === '#/parameters/PageSize')).toBe(true);
    expect(document.paths['/widgets'].get.responses['404']).toEqual({ $ref: '#/responses/NotFound' });
  });

  it('S-84: rewrites form request bodies into formData parameters', async () => {
    const manifestFile = await manifestFrom({
      openapi: '3.1.0',
      info: { title: 'Forms', version: '1' },
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { avatar: { type: 'string', format: 'binary' }, caption: { type: 'string', minLength: 2 } }, required: ['avatar'] } } } },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
    const document = await manifestFileToOpenApi(manifestFile, { version: '2.0' }) as any;
    expect(document.consumes).toEqual(['multipart/form-data']);
    expect(document.paths['/upload'].post.parameters).toEqual([
      expect.objectContaining({ in: 'formData', name: 'avatar', required: true }),
      expect.objectContaining({ in: 'formData', name: 'caption', type: 'string', minLength: 2 }),
    ]);
  });

  it('S-84: maps 3.x security schemes onto the swagger vocabulary', async () => {
    const manifestFile = await manifestFrom({
      openapi: '3.1.0',
      info: { title: 'Security', version: '1' },
      components: {
        securitySchemes: {
          Session: { type: 'http', scheme: 'basic' },
          Bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          Oauth: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token', scopes: { read: 'read all' } } } },
        },
      },
      paths: {},
    });
    const document = await manifestFileToOpenApi(manifestFile, { version: '2.0' }) as any;
    expect(document.securityDefinitions.Session).toMatchObject({ type: 'basic' });
    expect(document.securityDefinitions.Bearer).toMatchObject({ type: 'apiKey', name: 'Authorization', in: 'header' });
    expect(document.securityDefinitions.Oauth).toMatchObject({ type: 'oauth2', flow: 'accessCode', authorizationUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token', scopes: { read: 'read all' } });
  });

  it('S-84: leaves swagger-sourced manifests untouched for 2.0 output', () => {
    const source = { $schema: 'zopia:manifest@1', source: { kind: 'swagger-2.0', title: 'Legacy', version: '1' }, swaggerHost: 'legacy.example.com', swaggerSchemes: ['https'], swaggerConsumes: ['application/json'], swaggerProduces: ['text/plain'], apis: [] } as any;
    const document = manifestToOpenApi(source, { version: '2.0' }) as any;
    expect(document.swagger).toBe('2.0');
    expect(document.host).toBe('legacy.example.com');
    expect(document.produces).toEqual(['text/plain']);
  });
});
