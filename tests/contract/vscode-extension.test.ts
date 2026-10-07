import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const extensionRoot = join(repositoryRoot, 'editors', 'vscode');
const extensionPath = join(extensionRoot, 'extension.js');
const extensionSource = readFileSync(extensionPath, 'utf8');

interface ExtensionHarness {
  navigationIndexFromManifest(manifest: unknown): {
    specToLocations(pointer: string): Array<Record<string, unknown>>;
    treeToSpecLocation(file: string): Record<string, unknown>;
  };
  specCandidates(index: { manifest: Record<string, unknown> }, treeRoot: string): Promise<string[]>;
  yamlOperationIdFromLine(line: string): string | undefined;
  yamlOperationIdLine(text: string, operationId: string): number | undefined;
  yamlOperationIdAtOrAbove(text: string, targetLine: number): string | undefined;
  specPointerToLine(text: string, pointer: string): number | undefined;
}

/** Evaluate the zero-build extension with only a stubbed `vscode` import. */
function harness(vscode: unknown = { window: {}, workspace: { findFiles: async () => [] } }): ExtensionHarness {
  const require = createRequire(import.meta.url);
  const context = vm.createContext({
    console,
    module: { exports: {} },
    exports: {},
    require(identifier: string) {
      if (identifier === 'vscode') return vscode;
      return require(identifier);
    },
  });
  vm.runInContext(`${extensionSource}\n;globalThis.__zopiaExtensionHarness = { navigationIndexFromManifest, specCandidates, yamlOperationIdFromLine, yamlOperationIdLine, yamlOperationIdAtOrAbove, specPointerToLine };`, context);
  return context.__zopiaExtensionHarness as ExtensionHarness;
}

describe('VS Code extension contract', () => {
  it('keeps the extension zero-build, syntax-valid, and independent of the Bun-first package entry point', () => {
    const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')) as {
      main?: string;
      activationEvents?: string[];
      contributes?: { menus?: { 'editor/context'?: Array<{ command?: string; when?: string }> } };
    };

    expect(manifest.main).toBe('./extension.js');
    expect(manifest.activationEvents).toEqual(['onLanguage:json', 'onLanguage:yaml', 'onLanguage:typescript']);
    expect(JSON.stringify(manifest.contributes)).not.toContain('jsonc');
    expect(extensionSource).not.toContain('loadZopia');
    expect(extensionSource).not.toContain("import('zopia')");
    expect(() => execFileSync(process.execPath, ['--check', extensionPath], { encoding: 'utf8' })).not.toThrow();
  });

  it('mirrors reusable Swagger component navigation without importing zopia', () => {
    const index = harness().navigationIndexFromManifest({
      source: { kind: 'swagger-2.0' },
      options: { custom: false },
      apis: [],
      components: [
        { kind: 'parameter', name: 'Trace', file: 'components/parameters/Trace/index.ts', schema: { type: 'string' } },
        { kind: 'response', name: 'Problem', file: 'components/responses/Problem/index.ts', schema: { type: 'object' } },
      ],
    });

    expect(index.specToLocations('#/parameters/Trace')).toEqual([
      { kind: 'component', file: 'components/parameters/Trace/index.ts', pointer: '#/parameters/Trace', label: 'component parameter Trace' },
    ]);
    expect(index.specToLocations('#/responses/Problem')).toEqual([
      { kind: 'component', file: 'components/responses/Problem/index.ts', pointer: '#/responses/Problem', label: 'component response Problem' },
    ]);
    expect(index.treeToSpecLocation('components/parameters/index.ts')).toMatchObject({ pointer: '#/parameters' });
  });

  it('mirrors the core schema barrel for an empty component container', () => {
    const index = harness().navigationIndexFromManifest({
      source: { kind: 'openapi-3.1' },
      options: { custom: false, insertComponents: true },
      apis: [],
      components: [],
    });

    expect(index.treeToSpecLocation('components/index.ts')).toMatchObject({ pointer: '#/components/schemas', label: 'component barrel' });
    expect(index.specToLocations('#/components/schemas')).toEqual([
      { kind: 'component', file: 'components/index.ts', pointer: '#/components/schemas', label: 'component barrel' },
    ]);
  });

  it('still finds a spec colocated with the manifest when generation targets the workspace root', async () => {
    const treeRoot = join(repositoryRoot, 'tests', 'fixtures');
    const spec = join(treeRoot, 'openapi.json');
    const extension = harness({
      window: {},
      workspace: { findFiles: async () => [{ fsPath: spec }, { fsPath: join(treeRoot, '.zopia-manifest.json') }] },
    });

    await expect(extension.specCandidates({ manifest: { source: {}, apis: [] } }, treeRoot)).resolves.toEqual([spec]);
  });

  it('parses plain, quoted, escaped, and commented YAML operationId markers beyond identifier characters', () => {
    const extension = harness();
    expect(extension.yamlOperationIdFromLine('operationId: deploy service # exact ID')).toBe('deploy service');
    expect(extension.yamlOperationIdFromLine("operationId: 'don''t stop' # quoted")).toBe("don't stop");
    expect(extension.yamlOperationIdFromLine('operationId: "deploy (v1) \\\"prod\\\""')).toBe('deploy (v1) "prod"');
    expect(extension.yamlOperationIdAtOrAbove('paths:\n  /pets:\n    get:\n      operationId: listPets\n      responses: {}\n', 5)).toBe('listPets');
    expect(extension.yamlOperationIdAtOrAbove('paths:\n  /pets:\n    get:\n      operationId: listPets\ncomponents:\n  schemas: {}\n', 6)).toBeUndefined();
    expect(extension.yamlOperationIdLine('operationId: first\noperationId: deploy service # exact ID\n', 'deploy service')).toBe(2);
  });

  it('keeps the embedded JSON pointer scanner strict about malformed scalar tokens and JSON whitespace', () => {
    expect(() => harness().specPointerToLine('{"a": 01}', '#/a')).toThrow('Invalid JSON during pointer scan');
    expect(() => harness().specPointerToLine('{"a":\f1}', '#/a')).toThrow('Invalid JSON during pointer scan');
  });
});
