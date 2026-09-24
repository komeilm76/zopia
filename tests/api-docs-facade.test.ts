import { describe, expect, it } from 'vitest';
import { apiDocsFacadeAccess } from '../src';

describe('API docs facade access', () => {
  it('maps a parameterized path to ergonomic access', () => {
    expect(apiDocsFacadeAccess('/applicant/Exame/all/{id}', 'get')).toBe('apiDocs.applicant.exame.all.id.get');
  });
  it('camel-cases compound segments and supports a custom root', () => {
    expect(apiDocsFacadeAccess('/user-profiles/{user_id}', 'delete', 'client')).toBe('client.userProfiles.userId.delete');
  });
  it('rejects unsafe roots and query paths', () => {
    expect(() => apiDocsFacadeAccess('/users?id=1', 'get')).toThrow('Invalid API path');
    expect(() => apiDocsFacadeAccess('/users', 'get', 'not-valid' as any)).toThrow('Invalid facade root');
  });
});
