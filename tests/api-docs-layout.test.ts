import { describe, expect, it } from 'vitest';
import { endpointFilePath } from '../src';

describe('API docs layout', () => {
  it('creates directory and flat endpoint paths', () => {
    expect(endpointFilePath('/admin/users/{id}', 'get')).toBe('admin/users/{id}/get/index.ts');
    expect(endpointFilePath('/admin/users/{id}', 'delete', 'flat')).toBe('admin-users-{id}/delete/index.ts');
    expect(endpointFilePath('/', 'get')).toBe('root/get/index.ts');
  });
  it('rejects unsafe paths and modes', () => {
    expect(() => endpointFilePath('/../secret', 'get')).toThrow('Unsafe API path segment');
    expect(() => endpointFilePath('/users\\secret', 'get')).toThrow('Unsafe API path segment');
    expect(() => endpointFilePath('/C:drive', 'get')).toThrow('Unsafe API path segment');
    expect(() => endpointFilePath('/users', 'get', 'unknown' as any)).toThrow('Unsupported API docs mode');
    expect(() => endpointFilePath('/users', '../write' as any)).toThrow('Unsupported HTTP method');
  });
});
