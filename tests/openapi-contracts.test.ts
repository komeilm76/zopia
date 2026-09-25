import { describe, expect, it } from 'vitest';
import { buildOpenApiOperationIR, extractOperationContracts } from '../src';

describe('OpenAPI operation contracts', () => {
  it('extracts Swagger primitive parameter types', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'limit', type: 'integer', format: 'int32' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).parameters[0].schema).toEqual({ type: 'integer', format: 'int32' });
    const [invalid] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'values', type: 'array' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('Invalid Swagger parameter type');
    const [file] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ in: 'query', name: 'upload', type: 'file' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(file).parameters[0].schema).toEqual({ type: 'string', format: 'binary' });
  });
  it('extracts Swagger formData parameters', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/upload': { post: { consumes: ['multipart/form-data'], parameters: [{ in: 'formData', name: 'file', type: 'file', required: true }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).requestBody).toEqual({ contentType: 'multipart/form-data', schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] }, required: true });
    const [referenced] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, parameters: { File: { in: 'formData', name: 'file', type: 'file', required: true } }, paths: { '/upload': { post: { parameters: [{ $ref: '#/parameters/File' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(referenced).requestBody?.contentType).toBe('multipart/form-data');
    const [invalid] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/upload': { post: { parameters: [{ in: 'formData', name: 'file', type: 'file', required: 'yes' }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('Invalid Swagger formData required');
  });
  it('extracts Swagger body parameters', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, consumes: ['application/json'], paths: { '/x': { parameters: [{ in: 'body', name: 'payload', required: true, schema: { type: 'object' } }], post: { responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).requestBody).toEqual({ contentType: 'application/json', schema: { type: 'object' }, required: true });
    const [referenced] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, consumes: ['application/json'], parameters: { Payload: { in: 'body', name: 'payload', required: true, schema: { type: 'string' } } }, paths: { '/x': { post: { parameters: [{ $ref: '#/parameters/Payload' }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(referenced).requestBody).toEqual({ contentType: 'application/json', schema: { type: 'string' }, required: true });
    const [invalid] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { parameters: [{ in: 'body', name: 'payload', required: 'yes', schema: { type: 'object' } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('Invalid Swagger body parameter required');
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
  it('extracts OpenAPI parameter content schemas', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ name: 'filter', in: 'query', content: { 'application/json': { schema: { type: 'object' } } } }], responses: { '200': { description: 'ok' } } } } } });
    expect(extractOperationContracts(ir).parameters[0].schema).toEqual({ type: 'object' });
    const [invalid] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { parameters: [{ name: 'filter', in: 'query', schema: { type: 'string' }, content: { 'application/json': {} } }], responses: { '200': { description: 'ok' } } } } } });
    expect(() => extractOperationContracts(invalid)).toThrow('both schema and content');
  });
  it('extracts Swagger response schemas too', () => {
    const [ir] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { produces: ['application/json'], responses: { '200': { description: 'ok', schema: { type: 'string' } } } } } } });
    expect(extractOperationContracts(ir).responses[0].schema).toEqual({ type: 'string' });
    const [withProduces] = buildOpenApiOperationIR({ swagger: '2.0', info: { title: 'x', version: '1' }, produces: ['application/json'], paths: { '/x': { get: { responses: { '200': { description: 'ok', schema: { type: 'string' } } } } } } });
    expect(extractOperationContracts(withProduces).responses[0].contentType).toBe('application/json');
  });
  it('extracts request and response media types', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '201': { description: 'created', content: { 'application/json': { schema: { type: 'string' } } } } } } } } });
    expect(extractOperationContracts(ir)).toEqual({ parameters: [], requestBody: { contentType: 'application/json', schema: { type: 'object' }, required: true }, responses: [{ status: '201', description: 'created', contentType: 'application/json', schema: { type: 'string' } }] });
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
  });
});
