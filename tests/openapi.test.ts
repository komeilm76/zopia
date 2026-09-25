import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '../src';

const base = (version: string) => ({ openapi: version, info: { title: 'Demo', version: '1.0.0' }, paths: {} });

describe('normalizeOpenApiDocument', () => {
  it.each(['3.0.3', '3.1.0'])('accepts OpenAPI %s', (version) => {
    expect(normalizeOpenApiDocument(base(version)).version).toBe(version.startsWith('3.0') ? '3.0' : '3.1');
  });
  it('accepts Swagger 2.0', () => {
    expect(normalizeOpenApiDocument({ swagger: '2.0', info: { title: 'Demo', version: '1' }, paths: {} }).version).toBe('2.0');
  });
  it('accepts JSON text and rejects malformed or incomplete input', () => {
    expect(normalizeOpenApiDocument(JSON.stringify(base('3.0.0'))).title).toBe('Demo');
    expect(() => normalizeOpenApiDocument('{bad')).toThrow('Invalid OpenAPI document');
    expect(() => normalizeOpenApiDocument({ openapi: '3.2.0', info: {}, paths: {} })).toThrow('Unsupported OpenAPI document version');
    expect(() => normalizeOpenApiDocument({ ...base('3.1.0'), info: { title: ' ', version: '1' } })).toThrow('info.title and info.version are required');
    expect(() => normalizeOpenApiDocument({ openapi: '3.1.0', info: { title: 'x', version: '1' } })).toThrow('paths must be an object');
    expect(() => normalizeOpenApiDocument({ ...base('3.1.0'), paths: { users: {} } })).toThrow('path key must start with /');
    expect(normalizeOpenApiDocument({ ...base('3.1.0'), paths: { 'x-note': 'allowed extension' } }).version).toBe('3.1');
    expect(() => normalizeOpenApiDocument({ ...base('3.1.0'), paths: { '/users': null } })).toThrow('path item must be an object');
    expect(() => normalizeOpenApiDocument({ ...base('3.1.0'), paths: { '/users/{id': {} } })).toThrow('malformed path template');
  });
});
