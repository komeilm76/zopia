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
  for (const operation of operations) {
    let file: string;
    if (mode === 'flat') {
      endpointFilePath(operation.path, operation.method, 'directory');
      let name = names.get(operation.path);
      if (!name) {
        const segments = operation.path.split('/').filter(Boolean); const base = segments.join('-') || 'root'; name = base; let suffix = 1;
        while (used.has(name)) name = `${base}-${++suffix}`;
        used.add(name); names.set(operation.path, name);
      }
      file = `${name}/${operation.method}/index.ts`;
    } else file = endpointFilePath(operation.path, operation.method, mode);
    plan.push({ ...operation, file });
  }
  return plan;
}
