import { describe, expect, it } from 'vitest';
import { planApiDocsFiles } from '../src';

describe('API docs file planning', () => {
  const doc = { openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/a-b': { get: { operationId: 'first' }, delete: { operationId: 'firstDelete' } }, '/a/b': { get: { operationId: 'second' } } } };
  it('plans directory files', () => expect(planApiDocsFiles(doc)[0].file).toBe('a-b/get/index.ts'));
  it('disambiguates flat collisions', () => expect(planApiDocsFiles(doc, 'flat').map((item) => item.file)).toEqual(['a-b/get/index.ts', 'a-b/delete/index.ts', 'a-b-2/get/index.ts']));
  it('disambiguates directory paths that collapse to the same output directory', () => {
    const colliding = {
      openapi: '3.1.0',
      info: { title: 'x', version: '1' },
      paths: {
        '/users//{id}': { get: { operationId: 'repeatedSlash' }, post: { operationId: 'repeatedSlashPost' } },
        '/users/{id}': { get: { operationId: 'singleSlash' } },
        '/': { get: { operationId: 'root' } },
        '/root': { get: { operationId: 'literalRoot' } },
      },
    };

    expect(planApiDocsFiles(colliding).map((item) => item.file)).toEqual([
      'users/{id}/get/index.ts',
      'users/{id}/post/index.ts',
      'users/{id}-2/get/index.ts',
      'root/get/index.ts',
      'root-2/get/index.ts',
    ]);
  });
  it('disambiguates paths that differ only by filesystem case', () => {
    const caseCollisions = {
      openapi: '3.1.0',
      info: { title: 'x', version: '1' },
      paths: { '/Users': { get: { operationId: 'upper' } }, '/users': { get: { operationId: 'lower' } } },
    };
    expect(planApiDocsFiles(caseCollisions).map((item) => item.file)).toEqual(['Users/get/index.ts', 'users-2/get/index.ts']);
    expect(planApiDocsFiles(caseCollisions, 'flat').map((item) => item.file)).toEqual(['Users/get/index.ts', 'users-2/get/index.ts']);
  });
  it('validates mode even when there are no operations', () => expect(() => planApiDocsFiles({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: {} }, 'bad' as any)).toThrow('Unsupported API docs mode'));
});
