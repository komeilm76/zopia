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
  const operations = collectOpenApiOperations(input);
  const names = new Map<string, string>();
  const methodsByPath = new Map<string, string[]>();
  const assigned: Array<{ segments: string[]; methods: string[] }> = [];
  const plan: ApiDocsFilePlan[] = [];
  for (const operation of operations) {
    const methods = methodsByPath.get(operation.path);
    if (methods) methods.push(operation.method);
    else methodsByPath.set(operation.path, [operation.method]);
  }
  const startsWith = (value: readonly string[], prefix: readonly string[]): boolean => prefix.length <= value.length && prefix.every((segment, index) => value[index].toLowerCase() === segment.toLowerCase());
  const conflictIndex = (candidate: readonly string[], methods: readonly string[]): number | undefined => {
    for (const previous of assigned) {
      if (candidate.length === previous.segments.length && startsWith(candidate, previous.segments)) return candidate.length - 1;
      for (const method of previous.methods) {
        const methodDirectory = [...previous.segments, method];
        if (startsWith(candidate, methodDirectory)) return previous.segments.length;
      }
      for (const method of methods) if (startsWith(previous.segments, [...candidate, method])) return candidate.length - 1;
    }
    return undefined;
  };
  for (const operation of operations) {
    let name = names.get(operation.path);
    if (name === undefined) {
      let originalSegments: string[];
      if (mode === 'flat') {
        endpointFilePath(operation.path, operation.method, 'directory');
        originalSegments = [operation.path.split('/').filter(Boolean).join('-') || 'root'];
      } else {
        const methodSuffix = `/${operation.method}/index.ts`;
        originalSegments = endpointFilePath(operation.path, operation.method, mode).slice(0, -methodSuffix.length).split('/');
      }
      const candidate = [...originalSegments];
      const suffixes = new Map<number, number>();
      let conflict = conflictIndex(candidate, methodsByPath.get(operation.path)!);
      while (conflict !== undefined) {
        const suffix = (suffixes.get(conflict) ?? 1) + 1;
        suffixes.set(conflict, suffix);
        candidate[conflict] = `${originalSegments[conflict]}-${suffix}`;
        conflict = conflictIndex(candidate, methodsByPath.get(operation.path)!);
      }
      name = candidate.join('/');
      names.set(operation.path, name);
      assigned.push({ segments: candidate, methods: methodsByPath.get(operation.path)! });
    }
    plan.push({ ...operation, file: `${name}/${operation.method}/index.ts` });
  }
  return plan;
}
