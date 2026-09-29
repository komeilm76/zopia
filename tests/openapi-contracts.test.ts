import { describe, expect, it } from 'vitest';
import { buildOpenApiOperationIR, extractOperationContracts } from '../src';
import { deriveReusableParameterSchema } from '../src/conversions/openapi-contracts';
import { ZopiaError } from '../src/errors';

describe('OpenAPI operation contracts', () => {
  it('S-03: extracts Swagger primitive parameter types', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'limit', type: 'integer', format: 'int32' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).parameters[0].schema).toEqual({ type: 'integer', format: 'int32' });
    const [invalid] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'values', type: 'array' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('Invalid Swagger parameter type');
    const [file] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'upload', type: 'file' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(file)).toThrow('Invalid Swagger parameter type: upload');
    const [object] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'filter', type: 'object' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(object)).toThrow('Invalid Swagger parameter type: filter');
    const [objectItems] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'filters', type: 'array', items: { type: 'object' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(objectItems)).toThrow('Invalid Swagger parameter type: filters');
    const [missingNestedItems] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'matrix', type: 'array', items: { type: 'array' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(missingNestedItems)).toThrow('Invalid Swagger parameter type: matrix');
    const circularItems: any = { type: 'array' }; circularItems.items = circularItems;
    const [circular] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'loop', type: 'array', items: circularItems }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(circular)).toThrow('Invalid Swagger parameter type: loop');
    const [cookie] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'cookie', name: 'session', type: 'string' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(cookie)).toThrow('Invalid parameter: GET /x');
    const [schemaShaped] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'limit', schema: { type: 'integer' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(schemaShaped)).toThrow('Swagger non-body parameter must use top-level type keywords: limit');
  });
  it('S-02: extracts Swagger formData parameters', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/upload': { post: { consumes: ['multipart/form-data'], parameters: [{ in: 'formData', name: 'file', type: 'file', required: true }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).requestBody).toEqual({ contentType: 'multipart/form-data', schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] }, required: true });
    const [referenced] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, parameters: { File: { in: 'formData', name: 'file', type: 'file', required: true } }, paths: { '/upload': { post: { parameters: [{ $ref: '#/parameters/File' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(referenced).requestBody?.contentType).toBe('multipart/form-data');
    const [invalid] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/upload': { post: { parameters: [{ in: 'formData', name: 'file', type: 'file', required: 'yes' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('Invalid Swagger formData required');
    const [object] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/upload': { post: { parameters: [{ in: 'formData', name: 'metadata', type: 'object' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(object)).toThrow('Invalid Swagger formData parameter');
    const [fileItems] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/upload': { post: { parameters: [{ in: 'formData', name: 'files', type: 'array', items: { type: 'file' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(fileItems)).toThrow('Invalid Swagger formData parameter');
  });
  it('extracts Swagger body parameters', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, consumes: ['application/json'], paths: { '/x': { parameters: [{ in: 'body', name: 'payload', required: true, schema: { type: 'object' } }], post: { responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).requestBody).toEqual({ contentType: 'application/json', schema: { type: 'object' }, required: true });
    const [referenced] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, consumes: ['application/json'], parameters: { Payload: { in: 'body', name: 'payload', required: true, schema: { type: 'string' } } }, paths: { '/x': { post: { parameters: [{ $ref: '#/parameters/Payload' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(referenced).requestBody).toEqual({ contentType: 'application/json', schema: { type: 'string' }, required: true, reusable: 'Payload' });
    const [invalid] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { parameters: [{ in: 'body', name: 'payload', required: 'yes', schema: { type: 'object' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('Invalid Swagger body parameter required');
    const [nameless] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { parameters: [{ in: 'body', schema: { type: 'object' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(nameless)).toThrow('Invalid Swagger body parameter: POST /x');
    const [multiple] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { parameters: [
      { in: 'body', name: 'first', schema: { type: 'object' } },
      { in: 'body', name: 'second', schema: { type: 'string' } },
    ], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(multiple)).toThrow('Swagger operation cannot define multiple body parameters');
    const [requestBody] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { content: { 'application/json': { schema: { type: 'string' } } } }, responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(requestBody)).toThrow('Swagger 2.0 does not support requestBody');
  });
  it('prefers JSON-ish Swagger media types over earlier non-JSON entries', () => {
    const [ir] = buildOpenApiOperationIR({
      swagger: '2.0', info: { title: 'x', version: '1' },
      consumes: ['text/plain', 'application/vnd.example+json'],
      produces: ['application/xml', 'application/json'],
      paths: { '/x': { post: {
        parameters: [{ in: 'body', name: 'payload', schema: { type: 'object' } }],
        responses: { '200': { description: 'ok', schema: { type: 'string' } } },
      } } },
    });
    const contracts = extractOperationContracts(ir);
    expect(contracts.requestBody?.contentType).toBe('application/vnd.example+json');
    expect(contracts.responses[0].contentType).toBe('application/json');
  });
  it('rejects malformed Swagger media-type lists instead of using fallbacks', () => {
    const operation = (operationFields: Record<string, unknown> = {}, documentFields: Record<string, unknown> = {}) => buildOpenApiOperationIR({
      swagger: '2.0', info: { title: 'x', version: '1' }, ...documentFields,
      paths: { '/x': { get: { ...operationFields, responses: { '200': { description: 'ok' } } } } },
    })[0];
    expect(() => extractOperationContracts(operation({ consumes: 'application/json' }))).toThrow('Invalid Swagger consumes: GET /x');
    expect(() => extractOperationContracts(operation({ produces: [''] }))).toThrow('Invalid Swagger produces: GET /x');
    expect(() => extractOperationContracts(operation({}, { consumes: [42] }))).toThrow('Invalid Swagger consumes: #');
  });
  it('requires path parameters to match every path-template placeholder', () => {
    const operation = (path: string, parameters: unknown[]) => buildOpenApiOperationIR({
      openapi: '3.1.0', info: { title: 'x', version: '1' },
      paths: { [path]: { get: { parameters, responses: { '200': { description: 'ok' } } } } },
    })[0];
    expect(() => extractOperationContracts(operation('/users/{id}', []))).toThrow('Path template parameter is not defined: id');
    expect(() => extractOperationContracts(operation('/users', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]))).toThrow('Path parameter is not present in the template: id');
    expect(extractOperationContracts(operation('/users/{id}', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }])).parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });
  it('extracts OpenAPI parameter content schemas', () => {
    const [legacy] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { parameters: [{ name: 'payload', in: 'body', schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(legacy)).toThrow('OpenAPI 3 does not support body parameters');
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ name: 'filter', in: 'query', content: { 'application/json': { schema: { type: 'object' } } } }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).parameters[0].schema).toEqual({ type: 'object' });
    const [invalid] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ name: 'filter', in: 'query', schema: { type: 'string' }, content: { 'application/json': {} } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('both schema and content');
    const [swaggerShaped] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ name: 'limit', in: 'query', type: 'integer' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(swaggerShaped)).toThrow('OpenAPI 3 parameter must place schema keywords under schema: limit');
  });
  it('extracts Swagger response schemas too', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { produces: ['application/json'], responses: { '200': { description: 'ok', schema: { type: 'string' } } } } } } });
    expect(extractOperationContracts(ir).responses[0].schema).toEqual({ type: 'string' });
    const [withProduces] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, produces: ['application/json'], paths: { '/x': { get: { responses: { '200': { description: 'ok', schema: { type: 'string' } } } } } } });
    expect(extractOperationContracts(withProduces).responses[0].contentType).toBe('application/json');
    const [content] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } } } } } });
    expect(() => extractOperationContracts(content)).toThrow('Swagger response must use schema and operation-level produces');
  });
  it('extracts request and response media types', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '201': { description: 'created', content: { 'application/json': { schema: { type: 'string' } } } } } } } } });
    expect(extractOperationContracts(ir)).toEqual({ parameters: [], requestBody: { contentType: 'application/json', schema: { type: 'object' }, required: true }, responses: [{ status: '201', description: 'created', contentType: 'application/json', schema: { type: 'string' } }] });
    const [legacyResponse] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { '200': { description: 'ok', schema: { type: 'string' } } } } } } });
    expect(() => extractOperationContracts(legacyResponse)).toThrow('OpenAPI 3 response must place schemas under content');
  });
  it('rejects malformed responses', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: null } } } });
    expect(() => extractOperationContracts(ir)).toThrow('Invalid responses');
  });
  it('does not silently drop referenced contracts', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { $ref: '#/components/requestBodies/X' }, responses: { '200': { $ref: '#/components/responses/X' } } } } } });
    expect(() => extractOperationContracts(ir)).toThrow('Unresolved OpenAPI reference');
  });
  it('rejects malformed media content', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { content: { 'application/json': null } }, responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(ir)).toThrow('Invalid media type content');
  });
  it('rejects invalid request and response metadata', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { required: 'yes' }, responses: { '200': { description: 1 } } } } } });
    expect(() => extractOperationContracts(ir)).toThrow('Invalid requestBody.required');
  });
  it('rejects empty responses and body without content', () => {
    const [empty] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: {} } } } });
    expect(() => extractOperationContracts(empty)).toThrow('Invalid responses');
    const [body] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: {}, responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(body)).toThrow('Invalid requestBody.content');
    const [emptyBody] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { content: {} }, responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(emptyBody)).toThrow('Invalid requestBody.content');
    const [missingDescription] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { '200': {} } } } } });
    expect(() => extractOperationContracts(missingDescription)).toThrow('Invalid response description');
  });
  it('resolves chained local references', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, components: { responses: { Alias: { $ref: '#/components/responses/Actual' }, Actual: { description: 'ok' } } }, paths: { '/x': { get: { responses: { '200': { $ref: '#/components/responses/Alias' } } } } } });
    expect(extractOperationContracts(ir).responses[0].description).toBe('ok');
    const [withSibling] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, components: { responses: { Actual: { description: 'component' } } }, paths: { '/x': { get: { responses: { '200': { $ref: '#/components/responses/Actual', description: 'operation' } } } } } });
    expect(extractOperationContracts(withSibling).responses[0].description).toBe('operation');
  });
  it('rejects invalid response status keys', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { nope: { description: 'bad' } } } } } });
    expect(() => extractOperationContracts(ir)).toThrow('Invalid response status');
    const [invalidNumber] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { '999': { description: 'bad' } } } } } });
    expect(() => extractOperationContracts(invalidNumber)).toThrow('Invalid response status: 999');
    const [swaggerRange] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { '2XX': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(swaggerRange)).toThrow('Invalid response status: 2XX');
    const [openApiRange] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { responses: { '2XX': { description: 'ok' } } } } } });
    expect(extractOperationContracts(openApiRange).responses[0].status).toBe('2XX');
  });
});

describe('deriveReusableParameterSchema — invalid declarations (round 9 coverage)', () => {
  const swagger = { swagger: '2.0' as const, info: { title: 'T', version: '1' }, paths: {} };
  const modern = { openapi: '3.0.3' as const, info: { title: 'T', version: '1' }, paths: {}, components: {} };
  it('rejects Swagger declarations without name/in, body schema, or a supported type', () => {
    expect(() => deriveReusableParameterSchema(swagger as any, 'p', { name: 'p' })).toThrow(ZopiaError);
    expect(() => deriveReusableParameterSchema(swagger as any, 'p', { name: 'p', in: 'body' })).toThrow('Invalid Swagger body parameter');
    expect(() => deriveReusableParameterSchema(swagger as any, 'p', { name: 'p', in: 'query', type: 'weird' })).toThrow('Invalid Swagger parameter type');
    expect(deriveReusableParameterSchema(swagger as any, 'p', { name: 'p', in: 'body', schema: { type: 'string' } })).toEqual({ type: 'string' });
  });
  it('rejects 3.x declarations with unsupported in, schema+content conflicts, or schema-less content', () => {
    expect(() => deriveReusableParameterSchema(modern as any, 'p', { name: 'p' })).toThrow('Invalid reusable parameter');
    expect(() => deriveReusableParameterSchema(modern as any, 'p', { name: 'p', in: 'body' })).toThrow('Invalid reusable parameter');
    expect(() => deriveReusableParameterSchema(modern as any, 'p', { name: 'p', in: 'query', schema: {}, content: {} })).toThrow('cannot define both schema and content');
    expect(() => deriveReusableParameterSchema(modern as any, 'p', { name: 'p', in: 'query', content: { 'text/plain': {} } })).toThrow('requires schema or content');
    expect(deriveReusableParameterSchema(modern as any, 'p', { name: 'p', in: 'query', content: { 'text/plain': { schema: { type: 'integer' } } } })).toEqual({ type: 'integer' });
    expect(deriveReusableParameterSchema(modern as any, 'p', { name: 'p', in: 'query', schema: { type: 'boolean' } })).toEqual({ type: 'boolean' });
  });
});
