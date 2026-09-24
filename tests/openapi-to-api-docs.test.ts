import { describe, expect, it } from 'vitest';
import { collectOpenApiOperations, deriveOperationId } from '../src';

describe('OpenAPI operation collection', () => {
  it('uses canonical method order and operation ids', () => {
    const result = collectOpenApiOperations({ openapi: '3.0.3', info: { title: 'x', version: '1' }, paths: { '/users/{id}': { delete: {}, get: {}, trace: {} } } });
    expect(result.map((item) => item.method)).toEqual(['get', 'delete', 'trace']);
    expect(result[0].operationId).toBe('getUsersId');
  });
  it('preserves explicit operation ids and rejects invalid operations', () => {
    expect(collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { post: { operationId: 'createX' } } } })[0].operationId).toBe('createX');
    expect(() => collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': { get: null } } })).toThrow('Invalid OpenAPI operation');
  });
  it('derives root ids deterministically', () => expect(deriveOperationId('/users', 'get')).toBe('getUsers'));
});
