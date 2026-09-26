import { ZopiaError } from '../errors';
import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';

/** Filesystem layout used for generated endpoint modules. */
export type ApiDocsMode = 'directory' | 'flat';

/**
 * Return a portable relative POSIX path for one generated endpoint file.
 *
 * @param path OpenAPI path template beginning with `/`.
 * @param method Supported lowercase HTTP method.
 * @param mode Directory or flattened endpoint layout.
 * @returns Portable endpoint-module path relative to the output directory.
 * @throws {@link ZopiaError} when the path, method, or mode is invalid or unsafe.
 */
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
