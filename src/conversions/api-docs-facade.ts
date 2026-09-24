import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';

function propertyName(segment: string): string {
  const raw = segment.replace(/^\{(.*)\}$/, '$1');
  const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((word, index) => index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (!name || ['__proto__', 'prototype', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'].includes(name)) throw new TypeError(`Unsafe facade property from path segment: ${segment}`);
  return name;
}

/** Return the ergonomic dot-access path for an endpoint facade. */
export function apiDocsFacadeAccess(path: string, method: OpenApiMethod, root = 'apiDocs'): string {
  if (!/^[$A-Za-z_][$A-Za-z0-9_]*$/.test(root)) throw new TypeError(`Invalid facade root: ${root}`);
  if (!(OPENAPI_METHODS as readonly string[]).includes(method)) throw new TypeError(`Unsupported HTTP method: ${String(method)}`);
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) throw new TypeError(`Invalid API path: ${path}`);
  const segments = path.split('/').filter(Boolean).map((segment) => propertyName(segment));
  const methodName = propertyName(method);
  return [root, ...segments, methodName].map((name) => {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return `.${name}`;
    return `[${JSON.stringify(name)}]`;
  }).join('').replace(/^\./, '');
}
