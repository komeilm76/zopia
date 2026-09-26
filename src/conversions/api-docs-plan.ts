import { ZopiaError } from '../errors';
import { collectOpenApiOperations, type OpenApiOperation } from './openapi-to-api-docs';
import { endpointFilePath, type ApiDocsMode } from './api-docs-layout';

/** One normalized operation paired with its collision-safe output path. */
export interface ApiDocsFilePlan extends OpenApiOperation {
  /** Portable endpoint-module path relative to the generation root. */
  file: string;
}

/**
 * Plan generated endpoint files without touching the filesystem.
 *
 * @param input Valid Swagger/OpenAPI object or JSON text.
 * @param mode Directory or flattened endpoint layout.
 * @returns Deterministically ordered operations with portable output paths.
 * @throws {@link ZopiaError} when the source or layout mode is invalid.
 */
export function planApiDocsFiles(input: Record<string, any> | string, mode: ApiDocsMode = 'directory'): ApiDocsFilePlan[] {
  if (mode !== 'directory' && mode !== 'flat') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `Unsupported API docs mode: ${mode}`);
  const operations = collectOpenApiOperations(input); const used = new Set<string>(); const names = new Map<string, string>(); const plan: ApiDocsFilePlan[] = [];
  const isUsed = (name: string): boolean => used.has(name.toLowerCase());
  for (const operation of operations) {
    let name = names.get(operation.path);
    if (name === undefined) {
      if (mode === 'flat') {
        endpointFilePath(operation.path, operation.method, 'directory');
        const segments = operation.path.split('/').filter(Boolean);
        const base = segments.join('-') || 'root';
        name = base;
        let suffix = 1;
        while (isUsed(name)) name = `${base}-${++suffix}`;
      } else {
        const methodSuffix = `/${operation.method}/index.ts`;
        const base = endpointFilePath(operation.path, operation.method, mode).slice(0, -methodSuffix.length);
        name = base;
        let suffix = 1;
        while (isUsed(name)) {
          const segments = base.split('/');
          segments[segments.length - 1] = `${segments[segments.length - 1]}-${++suffix}`;
          name = segments.join('/');
        }
      }
      used.add(name.toLowerCase()); names.set(operation.path, name);
    }
    plan.push({ ...operation, file: `${name}/${operation.method}/index.ts` });
  }
  return plan;
}
