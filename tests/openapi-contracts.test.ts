import { describe, expect, it } from 'vitest';
import { buildOpenApiOperationIR, extractOperationContracts } from '../src';

describe('OpenAPI operation contracts', () => {
  it('extracts request and response media types', () => {
    const [ir] = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '201': { description: 'created', content: { 'application/json': { schema: { type: 'string' } } } } } } } } });
    expect(extractOperationContracts(ir)).toEqual({ requestBody: { contentType: 'application/json', schema: { type: 'object' }, required: true }, responses: [{ status: '201', description: 'created', contentType: 'application/json', schema: { type: 'string' } }] });
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
