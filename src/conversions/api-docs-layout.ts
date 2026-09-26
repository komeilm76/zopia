import { ZopiaError } from '../errors';
import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';

export type ApiDocsMode = 'directory' | 'flat';

/** Return a portable relative POSIX path for one generated endpoint file. */
export function endpointFilePath(path: string, method: OpenApiMethod, mode: ApiDocsMode = 'directory'): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid API path: ${path}`);
  if (!(OPENAPI_METHODS as readonly string[]).includes(method)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsupported HTTP method: ${String(method)}`);
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0') || segment.includes('\\') || segment.includes(':'))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsafe API path segment: ${path}`);
  if (mode === 'flat') {
    const base = segments.join('-') || 'root';
    return `${base}/${method}/index.ts`;
  }
  if (mode !== 'directory') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `Unsupported API docs mode: ${mode}`, { at: 'mode', hint: "use 'directory' or 'flat'" });
  return [...(segments.length ? segments : ['root']), method, 'index.ts'].join('/');
}
