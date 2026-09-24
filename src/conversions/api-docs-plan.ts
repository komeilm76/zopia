import { collectOpenApiOperations, type OpenApiOperation } from './openapi-to-api-docs';
import { endpointFilePath, type ApiDocsMode } from './api-docs-layout';

export interface ApiDocsFilePlan extends OpenApiOperation { file: string; }

/** Plan generated endpoint files without touching the filesystem. */
export function planApiDocsFiles(input: Record<string, any> | string, mode: ApiDocsMode = 'directory'): ApiDocsFilePlan[] {
  const operations = collectOpenApiOperations(input); const used = new Set<string>(); const plan: ApiDocsFilePlan[] = [];
  for (const operation of operations) {
    let file: string;
    if (mode === 'flat') {
      const segments = operation.path.split('/').filter(Boolean); const base = segments.join('-') || 'root';
      let name = base; let suffix = 1;
      while (used.has(name)) name = `${base}-${++suffix}`;
      used.add(name); file = `${name}/${operation.method}/index.ts`;
    } else file = endpointFilePath(operation.path, operation.method, mode);
    plan.push({ ...operation, file });
  }
  return plan;
}
