import { describe, expect, it } from 'vitest';
import { planApiDocsFiles } from '../src';

describe('API docs file planning', () => {
  const doc = { openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/a-b': { get: { operationId: 'first' } }, '/a/b': { get: { operationId: 'second' } } } };
  it('plans directory files', () => expect(planApiDocsFiles(doc)[0].file).toBe('a-b/get/index.ts'));
  it('disambiguates flat collisions', () => expect(planApiDocsFiles(doc, 'flat').map((item) => item.file)).toEqual(['a-b/get/index.ts', 'a-b-2/get/index.ts']));
});
