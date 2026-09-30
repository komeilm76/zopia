import { ZopiaError } from '../errors';
import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';

/** Filesystem layout used for generated endpoint modules. */
export type ApiDocsMode = 'directory' | 'flat';

/**
 * Split one OpenAPI path template into its literal segment keys.
 *
 * Empty segments are dropped, so the root path `/` has no segments and its
 * methods nest directly at the tree root. This is the single segmentation rule
 * shared by the runtime tree resolver and the generated `.zopia-tree.d.ts`.
 *
 * @param path OpenAPI path template beginning with `/`.
 * @returns Path segments in order, including literal `{param}` segments.
 */
export function apiDocsPathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Compare two endpoint entries by the canonical deterministic tree order:
 * URL path segments lexically, shorter segment chains first, then the
 * canonical method order (`get, post, put, delete, head, options, patch, trace`).
 *
 * The runtime tree resolver inserts keys in this order and the generated
 * `.zopia-tree.d.ts` declares them in this order, so both surfaces enumerate
 * identically (R-732/S-94).
 *
 * @param left Endpoint entry with an OpenAPI `path` and lowercase `method`.
 * @param right Endpoint entry with an OpenAPI `path` and lowercase `method`.
 * @returns Negative when `left` sorts first, positive when `right` does, zero when equal.
 */
export function compareApiDocsEntries(left: { path: string; method: string }, right: { path: string; method: string }): number {
  const leftSegments = apiDocsPathSegments(left.path);
  const rightSegments = apiDocsPathSegments(right.path);
  const depth = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < depth; index += 1) {
    const order = leftSegments[index] < rightSegments[index] ? -1 : leftSegments[index] > rightSegments[index] ? 1 : 0;
    if (order !== 0) return order;
  }
  const lengthOrder = leftSegments.length - rightSegments.length;
  if (lengthOrder !== 0) return lengthOrder;
  const methods = OPENAPI_METHODS as readonly string[];
  return methods.indexOf(left.method) - methods.indexOf(right.method);
}

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
