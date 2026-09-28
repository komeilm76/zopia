import { describe, expect, it } from 'vitest';
import { buildOpenApiOperationIR } from '../src';

describe('OpenAPI operation IR', () => {
  it('normalizes operation metadata and security', () => {
    const result = buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, security: [{ bearerAuth: [] }], paths: { '/users': { get: { tags: ['users'], summary: 'List', deprecated: true } } } });
    expect(result[0]).toMatchObject({ method: 'GET', pathShape: '/users', tags: ['#users'], deprecated: true, security: [{ bearerAuth: [] }] });
  });
  it('preserves explicit empty operation security', () => {
    const result = buildOpenApiOperationIR({ openapi: '3.0.3', info: { title: 'x', version: '1' }, security: [{ apiKey: [] }], paths: { '/public': { get: { security: [] } } } });
    expect(result[0].security).toEqual([]);
  });
  it('rejects malformed metadata', () => {
    expect(() => buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { tags: ['ok', 1] } } } })).toThrow('Invalid operation tags');
    expect(() => buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { deprecated: 'yes' } } } })).toThrow('Invalid deprecated flag');
    expect(() => buildOpenApiOperationIR({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { security: [{ bearer: [1] }] } } } })).toThrow('Invalid security requirements');
  });
});
