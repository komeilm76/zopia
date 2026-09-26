import { ZopiaError } from '../errors';
import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';

function propertyName(segment: string): string {
  const raw = segment.replace(/^\{(.*)\}$/, '$1');
  const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((word, index) => index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (!name || ['__proto__', 'prototype', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'].includes(name)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsafe facade property from path segment: ${segment}`);
  return name;
}

/** Return the ergonomic dot-access path for an endpoint facade. */
export function apiDocsFacadeAccess(path: string, method: OpenApiMethod, root = 'apiDocs'): string {
  if (typeof root !== 'string' || !/^[$A-Za-z_][$A-Za-z0-9_]*$/.test(root) || ['__proto__', 'prototype', 'constructor', 'eval', 'arguments'].includes(root)) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `Invalid facade root: ${root}`, { at: 'root', hint: 'use a safe TypeScript identifier' });
  if (!(OPENAPI_METHODS as readonly string[]).includes(method)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Unsupported HTTP method: ${String(method)}`);
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('\0') || path.includes('\\')) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid API path: ${path}`);
  const rawSegments = path.split('/').filter(Boolean);
  if (rawSegments.some((segment) => /[{}]/.test(segment) && !/^\{[A-Za-z0-9._-]+\}$/.test(segment))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid API path template: ${path}`);
  const parameterNames = new Set<string>();
  const parts: Array<{ name: string; parameter: boolean }> = rawSegments.map((segment) => {
    const parameter = /^\{[A-Za-z0-9._-]+\}$/.test(segment);
    if (parameter) {
      const normalized = propertyName(segment);
      if (parameterNames.has(normalized)) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Duplicate path parameter: ${normalized}`);
      parameterNames.add(normalized);
    }
    return { name: parameter ? segment : propertyName(segment), parameter };
  });
  const methodName = propertyName(method);
  return [root, ...parts.map((part) => part.name), methodName].map((name) => {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return `.${name}`;
    return `[${JSON.stringify(name)}]`;
  }).join('').replace(/^\./, '');
}
