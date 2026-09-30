import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { openApiToApiDocs } from '../src';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories('zopia-typecheck-');
const repositoryRoot = join(fileURLToPath(import.meta.url), '..', '..');

/** Strict-mode options mirroring how consumers check generated trees in their editors. */
const compilerOptions: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  paths: {
    zod: [join(repositoryRoot, 'node_modules', 'zod', 'index.d.ts')],
    'km-api': [join(repositoryRoot, 'node_modules', 'km-api', 'build', 'types', 'index.d.ts')],
  },
  strict: true,
  target: ts.ScriptTarget.ES2022,
};

const strictModeErrors = async (spec: Record<string, unknown>, endpoint: string): Promise<string[]> => {
  const outputDir = await temporaryDirectory();
  await openApiToApiDocs(spec, { outDir: outputDir });
  const file = join(outputDir, endpoint);
  const program = ts.createProgram([file], compilerOptions);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.file?.fileName === file)
    .map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
};

describe('generated code typechecks cleanly (issue #5)', () => {
  it('uniqueItems on primitive arrays emits a toJSON guard that compiles under strict mode', async () => {
    // The canonical-JSON helper is invoked per item with the item's own (primitive) type,
    // so `typeof value === 'object'` used to narrow `value` to never and `value.toJSON`
    // raised TS2339 in editors — the exact report of issue #5.
    const errors = await strictModeErrors({
      openapi: '3.0.3',
      info: { title: 'Filters', version: '1' },
      paths: {
        '/filters': {
          post: {
            operationId: 'createFilter',
            requestBody: { required: true, content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                scores: { type: 'array', items: { type: 'integer', format: 'int32' }, uniqueItems: true },
                flags: { type: 'array', items: { type: 'boolean' }, uniqueItems: true },
              },
              required: ['tags'],
            } } } },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }, 'filters/post/index.ts');
    expect(errors).toEqual([]);
  }, 120_000);

  it('object const and object enum comparisons compile under strict mode', async () => {
    // The same canonical-JSON helper behind z.any().refine(...) — pins the other call sites.
    const errors = await strictModeErrors({
      openapi: '3.1.0',
      info: { title: 'Modes', version: '1' },
      paths: {
        '/modes': {
          post: {
            operationId: 'createMode',
            requestBody: { required: true, content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                anchor: { const: { kind: 'home', primary: true } },
                mode: { enum: [{ kind: 'fast' }, { kind: 'slow' }] },
                tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              },
              required: ['anchor', 'mode'],
            } } } },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }, 'modes/post/index.ts');
    expect(errors).toEqual([]);
  }, 120_000);
});
