import { ZopiaError } from '../errors';
import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';

/** Filesystem layout used for generated endpoint modules. */
export type ApiDocsMode = 'directory' | 'flat';

/**
 * Return whether one generated-tree path segment is portable across supported filesystems.
 *
 * @param segment Candidate path segment without separators.
 * @returns Whether the segment is safe on POSIX and Windows filesystems.
 */
export function isPortableApiDocsSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..' || segment.includes('\\') || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment)) return false;
  const basename = segment.split('.')[0];
  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(basename);
}

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
  if (segments.some((segment) => !isPortableApiDocsSegment(segment))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsafe API path segment: ${path}`);
  if (mode === 'flat') {
    const base = segments.join('-') || 'root';
    return `${base}/${method}/index.ts`;
  }
  if (mode !== 'directory') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `Unsupported API docs mode: ${mode}`, { at: 'mode', hint: "use 'directory' or 'flat'" });
  return [...(segments.length ? segments : ['root']), method, 'index.ts'].join('/');
}
