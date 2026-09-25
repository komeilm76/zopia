import { describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApiToApiDocs } from '../src';

const operation = (description = 'ok') => ({ get: { responses: { '200': { description } } } });
const document = (paths: Record<string, unknown>, components?: Record<string, unknown>) => ({
  openapi: '3.1.0',
  info: { title: 'Staleness', version: '1' },
  ...(components ? { components: { schemas: components } } : {}),
  paths,
});

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT') return false;
    throw error;
  }
}

describe('manifest staleness', () => {
  it('warns for changed source and prunes only obsolete manifest-owned files', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    await openApiToApiDocs(document({ '/before': operation(), '/obsolete': operation() }), { outDir });
    const custom = join(outDir, 'before', 'get', 'custom.ts');
    await writeFile(custom, 'export const keep = true;\n', 'utf8');

    const result = await openApiToApiDocs(document({ '/after': operation() }), { outDir });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZOPIA_WARN_STALE_TREE',
      at: '.zopia-manifest.json',
      message: expect.stringContaining('the source document changed'),
    }));
    expect(await exists(join(outDir, 'before', 'get', 'index.ts'))).toBe(false);
    expect(await readFile(custom, 'utf8')).toContain('keep');
    expect(await exists(join(outDir, 'obsolete'))).toBe(false);
    expect(await exists(join(outDir, 'after', 'get', 'index.ts'))).toBe(true);
  });

  it('detects and repairs missing manifest-owned generated files', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const source = document({ '/repair': operation() });
    const endpoint = join(outDir, 'repair', 'get', 'index.ts');
    await openApiToApiDocs(source, { outDir });
    await rm(endpoint);

    const result = await openApiToApiDocs(source, { outDir });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZOPIA_WARN_STALE_TREE',
      message: expect.stringContaining('generated files are missing or unsafe'),
    }));
    expect(await exists(endpoint)).toBe(true);
  });

  it('refuses stale-tree symlink ancestors instead of writing outside outDir', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const outside = await mkdtemp(join(tmpdir(), 'zopia-outside-'));
    const source = document({ '/safe': operation() });
    await openApiToApiDocs(source, { outDir });
    await rm(join(outDir, 'safe', 'get'), { recursive: true });
    await symlink(outside, join(outDir, 'safe', 'get'), 'dir');

    await expect(openApiToApiDocs(source, { outDir })).rejects.toMatchObject({
      code: 'ZOPIA_FS_OUTSIDE_OUTDIR',
      at: 'safe/get/index.ts',
    });
    expect(await exists(join(outside, 'index.ts'))).toBe(false);
  });

  it('detects layout and component-option drift while removing obsolete artifacts', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const source = document(
      { '/users/{id}': operation() },
      { User: { type: 'object', properties: { id: { type: 'string' } } } },
    );
    await openApiToApiDocs(source, {
      outDir,
      mode: 'directory',
      insertComponents: true,
      useComponentAsReference: true,
    });

    const result = await openApiToApiDocs(source, { outDir, mode: 'flat' });

    const stale = result.warnings.find((warning) => warning.code === 'ZOPIA_WARN_STALE_TREE');
    expect(stale?.message).toContain('the layout mode changed');
    expect(stale?.message).toContain('component generation options changed');
    expect(await exists(join(outDir, 'users', '{id}', 'get', 'index.ts'))).toBe(false);
    expect(await exists(join(outDir, 'users-{id}', 'get', 'index.ts'))).toBe(true);
    expect(await exists(join(outDir, 'components', 'User', 'index.ts'))).toBe(false);
    expect(await exists(join(outDir, 'components', 'index.ts'))).toBe(false);
  });

  it('removes an old manifest when manifest output is disabled', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const source = document({ '/health': operation() });
    await openApiToApiDocs(source, { outDir });

    const result = await openApiToApiDocs(source, { outDir, manifest: false });

    expect(result.manifestPath).toBeUndefined();
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZOPIA_WARN_STALE_TREE',
      message: expect.stringContaining('manifest output was disabled'),
    }));
    expect(await exists(join(outDir, '.zopia-manifest.json'))).toBe(false);
    expect(await exists(join(outDir, 'health', 'get', 'index.ts'))).toBe(true);
  });

  it('reports an invalid existing manifest without deleting files of unknown ownership', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const unknown = join(outDir, 'unknown', 'index.ts');
    await mkdir(join(outDir, 'unknown'), { recursive: true });
    await writeFile(unknown, 'export const userOwned = true;\n', 'utf8');
    await writeFile(join(outDir, '.zopia-manifest.json'), '{ not json', 'utf8');

    const result = await openApiToApiDocs(document({ '/new': operation() }), { outDir });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZOPIA_WARN_STALE_TREE',
      message: expect.stringContaining('manifest is invalid or unreadable'),
    }));
    expect(await readFile(unknown, 'utf8')).toContain('userOwned');
    expect(JSON.parse(await readFile(join(outDir, '.zopia-manifest.json'), 'utf8')).$schema).toBe('zopia:manifest@1');
  });

  it('removes an invalid manifest when manifest output is disabled without pruning unknown files', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const unknown = join(outDir, 'unknown.ts');
    await writeFile(unknown, 'export const keep = true;\n', 'utf8');
    await writeFile(join(outDir, '.zopia-manifest.json'), '{ broken', 'utf8');

    const result = await openApiToApiDocs(document({ '/plain': operation() }), { outDir, manifest: false });

    const stale = result.warnings.find((warning) => warning.code === 'ZOPIA_WARN_STALE_TREE');
    expect(stale?.message).toContain('manifest is invalid or unreadable');
    expect(stale?.message).toContain('manifest output was disabled');
    expect(await exists(join(outDir, '.zopia-manifest.json'))).toBe(false);
    expect(await readFile(unknown, 'utf8')).toContain('keep');
  });

  it('does not report staleness for canonically equivalent source key ordering', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zopia-stale-'));
    const first = document({ '/same': operation() }, { Value: { type: 'string', minLength: 1 } });
    const reordered = {
      paths: first.paths,
      components: { schemas: { Value: { minLength: 1, type: 'string' } } },
      info: { version: '1', title: 'Staleness' },
      openapi: '3.1.0',
    };
    await openApiToApiDocs(first, { outDir });

    const result = await openApiToApiDocs(reordered, { outDir });

    expect(result.warnings.some((warning) => warning.code === 'ZOPIA_WARN_STALE_TREE')).toBe(false);
  });
});
