import type { OpenApiMethod } from './openapi-to-api-docs';

export type ApiDocsMode = 'directory' | 'flat';

/** Return a portable relative POSIX path for one generated endpoint file. */
export function endpointFilePath(path: string, method: OpenApiMethod, mode: ApiDocsMode = 'directory'): string {
  if (!path.startsWith('/')) throw new TypeError(`API path must start with /: ${path}`);
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0') || segment.includes('\\') || segment.includes(':'))) throw new TypeError(`Unsafe API path segment: ${path}`);
  if (mode === 'flat') {
    const base = segments.join('-') || 'root';
    return `${base}/${method}/index.ts`;
  }
  if (mode !== 'directory') throw new TypeError(`Unsupported API docs mode: ${mode}`);
  return [...(segments.length ? segments : ['root']), method, 'index.ts'].join('/');
}
