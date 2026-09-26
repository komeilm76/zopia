import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ZOPIA_ERROR_CODES,
  ZopiaError,
  apiDocsToOpenApi,
  asZopiaError,
  endpointFilePath,
  isZopiaError,
  jsonSchemaToZod,
  manifestToOpenApi,
  normalizeOpenApiDocument,
  openApiToApiDocs,
  zodToJsonSchema,
} from '../src';
import { runCli } from '../src/cli-command';
import { normalizeZopiaWarnings } from '../src/warnings';

describe('typed errors', () => {
  it('exposes one immutable, unique, stable error-code catalogue', () => {
    expect(Object.isFrozen(ZOPIA_ERROR_CODES)).toBe(true);
    expect(new Set(ZOPIA_ERROR_CODES).size).toBe(ZOPIA_ERROR_CODES.length);
    expect(ZOPIA_ERROR_CODES).toEqual([...ZOPIA_ERROR_CODES].sort());
    for (const code of ZOPIA_ERROR_CODES) expect(code).toMatch(/^ZOPIA_[A-Z0-9_]+$/);
    expect(ZOPIA_ERROR_CODES).toEqual(expect.arrayContaining([
      'ZOPIA_SCHEMA_INVALID',
      'ZOPIA_MANIFEST_INVALID',
      'ZOPIA_WARNING_INVALID',
    ]));
  });

  it('retains structured diagnostics and causal failures', () => {
    const cause = new Error('disk failed');
    const error = new ZopiaError('ZOPIA_FS_WRITE_FAILED', 'unable to write output', { at: 'api_docs', cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ZopiaError');
    expect(error).toMatchObject({
      code: 'ZOPIA_FS_WRITE_FAILED',
      at: 'api_docs',
      hint: expect.stringContaining('check'),
      cause,
    });
    expect(error.message).toBe('ZOPIA_FS_WRITE_FAILED: unable to write output');
    expect(isZopiaError(error)).toBe(true);
    expect(isZopiaError(cause)).toBe(false);
    expect(asZopiaError(error, 'ZOPIA_SPEC_INVALID', 'ignored')).toBe(error);
    expect(asZopiaError(cause, 'ZOPIA_SPEC_INVALID', 'invalid input', { at: '#' })).toMatchObject({
      code: 'ZOPIA_SPEC_INVALID',
      at: '#',
      cause,
    });
    const parserError = (() => { try { normalizeOpenApiDocument('{'); } catch (caught) { return caught; } })();
    expect(parserError).toMatchObject({ code: 'ZOPIA_SPEC_INVALID_JSON', at: '#', cause: expect.any(SyntaxError) });
  });

  it('uses typed errors at schema-engine and warning boundaries', () => {
    const cases: Array<[() => unknown, string]> = [
      [() => zodToJsonSchema(null as any), 'ZOPIA_SCHEMA_INVALID'],
      [() => zodToJsonSchema(z.string(), { target: 'other' } as any), 'ZOPIA_CONFIG_INVALID'],
      [() => jsonSchemaToZod([] as any), 'ZOPIA_SCHEMA_INVALID'],
      [() => jsonSchemaToZod({}, { rootName: 'not-valid' }), 'ZOPIA_CONFIG_INVALID'],
      [() => normalizeZopiaWarnings([{ code: 'UNKNOWN', message: 'bad' } as any]), 'ZOPIA_WARNING_INVALID'],
    ];

    for (const [action, code] of cases) {
      const error = (() => { try { action(); } catch (caught) { return caught; } })();
      expect(error).toBeInstanceOf(ZopiaError);
      expect(error).toMatchObject({ code, hint: expect.any(String) });
    }
  });

  it('uses typed errors at OpenAPI, layout, and manifest boundaries', () => {
    expect(() => manifestToOpenApi({ source: { kind: 'openapi-3.1' }, apis: [] } as any)).toThrow(expect.objectContaining({ code: 'ZOPIA_MANIFEST_INVALID', at: '#' }));
    const cases: Array<[() => unknown, string]> = [
      [() => normalizeOpenApiDocument('{'), 'ZOPIA_SPEC_INVALID_JSON'],
      [() => normalizeOpenApiDocument({ openapi: '4.0.0' } as any), 'ZOPIA_SPEC_UNSUPPORTED_VERSION'],
      [() => endpointFilePath('unsafe', 'get'), 'ZOPIA_SPEC_INVALID'],
      [() => manifestToOpenApi({ source: { kind: 'openapi-3.1' }, apis: [] } as any), 'ZOPIA_MANIFEST_INVALID'],
      [() => manifestToOpenApi({} as any, { unknown: true } as any), 'ZOPIA_CONFIG_INVALID'],
    ];

    for (const [action, code] of cases) {
      const error = (() => { try { action(); } catch (caught) { return caught; } })();
      expect(error).toBeInstanceOf(ZopiaError);
      expect(error).toMatchObject({ code, hint: expect.any(String) });
    }
  });

  it('uses typed errors at asynchronous public and CLI boundaries', async () => {
    await expect(openApiToApiDocs({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: {} }, { mode: 'bad' } as any)).rejects.toMatchObject({
      name: 'ZopiaError',
      code: 'ZOPIA_CONFIG_INVALID',
      at: 'mode',
    });
    await expect(apiDocsToOpenApi('')).rejects.toMatchObject({
      name: 'ZopiaError',
      code: 'ZOPIA_CONFIG_INVALID',
      at: 'path',
    });
    await expect(runCli(['reverse', 'docs', '--version', '2.0'])).rejects.toMatchObject({
      name: 'ZopiaError',
      code: 'ZOPIA_CONFIG_INVALID',
      at: '--version',
    });
  });
});
