import { describe, expect, it } from 'vitest';
import { collectOpenApiOperations, deriveOperationId } from '../src';

describe('OpenAPI operation collection', () => {
  it('uses canonical method order and operation ids', () => {
    const result = collectOpenApiOperations({ openapi: '3.0.3', info: { title: 'x', version: '1' }, paths: { '/users/{id}': { delete: {}, get: {}, trace: {} } } });
    expect(result.map((item) => item.method)).toEqual(['get', 'delete', 'trace']);
    expect(result[0].operationId).toBe('getUsersId');
  });
  it('lets operation parameters override path parameters', () => {
    const [result] = collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }] } } } });
    expect(result.parameters).toHaveLength(1);
    expect(result.parameters[0].schema.type).toBe('integer');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { parameters: [{ name: 'q', in: 'query' }, { name: 'q', in: 'query' }], get: {} } } })).toThrow('Duplicate path-level parameter');
  });
  it('preserves explicit operation ids and rejects invalid operations', () => {
    expect(collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { operationId: 'createX' } } } })[0].operationId).toBe('createX');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: null } } })).toThrow('Invalid OpenAPI operation');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { $ref: '#/components/pathItems/X' } } })).toThrow('Unresolved OpenAPI reference');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { $ref: 1 } } })).toThrow('Invalid path-item $ref');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { operationId: 1 } } } })).toThrow('Invalid operationId');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: { operationId: 'same' } }, '/y': { get: { operationId: 'same' } } } })).toThrow('Duplicate operationId');
  });
  it('resolves local path-item references', () => {
    const result = collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, components: { pathItems: { Shared: { get: { operationId: 'sharedGet' } } } }, paths: { '/x': { $ref: '#/components/pathItems/Shared' } } });
    expect(result[0].operationId).toBe('sharedGet');
  });
  it('derives root ids deterministically', () => expect(deriveOperationId('/users', 'get')).toBe('getUsers'));
});
