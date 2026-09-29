import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { endpointExportName, uniqueEndpointName } from '../src/conversions/api-docs-names';
import { collectOpenApiOperations, generateApiDocsFiles, openApiToApiDocs } from '../src';
import { createApiDocs, flattenApiDocs } from '../src/runtime';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories('zopia-names-');

describe('shared endpoint identifier rules (R-732)', () => {
  it('R-732: endpointExportName camelizes, guards reserved words, and guards leading digits', () => {
    expect(endpointExportName('getUser')).toBe('getUser');
    expect(endpointExportName('get-user')).toBe('getUser');
    // `_` is an identifier character, so snake_case ids stay verbatim.
    expect(endpointExportName('get_user')).toBe('get_user');
    expect(endpointExportName('get user id')).toBe('getUserId');
    expect(endpointExportName('get.users.{id}')).toBe('getUsersId');
    expect(endpointExportName('A B')).toBe('AB');
    expect(endpointExportName('$x')).toBe('$x');
    expect(endpointExportName('await')).toBe('awaitEndpoint');
    expect(endpointExportName('class')).toBe('classEndpoint');
    expect(endpointExportName('yield')).toBe('yieldEndpoint');
    expect(endpointExportName('123')).toBe('endpoint123');
    expect(endpointExportName('9lives')).toBe('endpoint9lives');
    expect(endpointExportName('###')).toBe('endpoint');
    expect(endpointExportName('')).toBe('endpoint');
  });

  it('R-732: uniqueEndpointName suffixes 2, 3, … without clobbering claimed names', () => {
    expect(uniqueEndpointName('getA', new Set())).toBe('getA');
    expect(uniqueEndpointName('getA', new Set(['getA']))).toBe('getA2');
    expect(uniqueEndpointName('getA', new Set(['getA', 'getA2', 'getA3']))).toBe('getA4');
    expect(uniqueEndpointName('getA', new Set(['getA', 'getA2', 'getB']))).toBe('getA3');
  });

  it('R-732: the generator names module exports through the shared helper (await → awaitEndpoint)', async () => {
    const outputDir = await temporaryDirectory();
    await generateApiDocsFiles({
      openapi: '3.1.0',
      info: { title: 'Names', version: '1' },
      paths: {
        '/reserved': { get: { operationId: 'await', responses: { '200': { description: 'ok' } } } },
        '/odd': { get: { operationId: 'get-user', responses: { '200': { description: 'ok' } } } },
        '/numeric': { get: { operationId: '123', responses: { '200': { description: 'ok' } } } },
      },
    }, { outputDir });
    expect(await readFile(join(outputDir, 'reserved', 'get', 'index.ts'), 'utf8')).toContain('export const awaitEndpoint');
    expect(await readFile(join(outputDir, 'odd', 'get', 'index.ts'), 'utf8')).toContain('export const getUser');
    expect(await readFile(join(outputDir, 'numeric', 'get', 'index.ts'), 'utf8')).toContain('export const endpoint123');
  });

  it('R-732: derived duplicate operation IDs keep the shared 2, 3 suffix rule across both call-sites', async () => {
    const paths = {
      '/a-b': { get: { responses: { '200': { description: 'ok' } } } },
      '/a/b': { get: { responses: { '200': { description: 'ok' } } } },
      '/a/b/c': { get: { responses: { '200': { description: 'ok' } } } },
    };
    const operations = collectOpenApiOperations({ openapi: '3.1.0', info: { title: 'Names', version: '1' }, paths });
    expect(operations.map((operation) => operation.operationId)).toEqual(['getAB', 'getAB2', 'getABC']);

    const outputDir = await temporaryDirectory();
    await openApiToApiDocs({ openapi: '3.1.0', info: { title: 'Names', version: '1' }, paths }, { outDir: outputDir });
    const flat = flattenApiDocs(await createApiDocs(outputDir));
    // The flat record keys are the generator's export identifiers, and the ORDER is the
    // nested tree's deterministic leaf order — segment-sorted paths, not operationId order.
    expect(Object.keys(flat)).toEqual(['getAB2', 'getABC', 'getAB']);
    expect(flat.getAB.pathShape).toBe('/a-b');
    expect(flat.getAB2.pathShape).toBe('/a/b');
    expect(flat.getABC.pathShape).toBe('/a/b/c');
  });
});
