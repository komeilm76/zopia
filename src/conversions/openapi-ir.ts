import { ZopiaError } from '../errors';
import { collectOpenApiOperations, collectOpenApiWebhookOperations, type OpenApiOperation } from './openapi-to-api-docs';
import { normalizeOpenApiDocument, type OpenApiDocument } from './openapi';

/** Validated operation-level intermediate representation used by Engine ③. */
export interface OpenApiOperationIR {
  /** Original OpenAPI path template. */
  path: string;
  /** Uppercase HTTP method emitted to km-api. */
  method: Uppercase<OpenApiOperation['method']>;
  /** km-api path shape, preserving OpenAPI parameter braces. */
  pathShape: string;
  /** Explicit or deterministically derived operation identifier. */
  operationId: string;
  /** Optional operation summary. */
  summary?: string;
  /** Optional operation description. */
  description?: string;
  /** km-api tags, normalized with `#` prefixes. */
  tags: string[];
  /** Whether the source operation is deprecated. */
  deprecated: boolean;
  /** Effective operation or document security requirements. */
  security?: unknown[];
  /** Original operation object. */
  operation: Record<string, any>;
  /** Merged path-level and operation-level parameters. */
  parameters: any[];
  /** Complete normalized source document used for local reference resolution. */
  document: OpenApiDocument;
}

function security(value: unknown, context: string): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => item && typeof item === 'object' && !Array.isArray(item) && Object.entries(item).every(([name, scopes]) => name.length > 0 && Array.isArray(scopes) && scopes.every((scope) => typeof scope === 'string')))) throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid security requirements: ${context}`);
  return value;
}

function tags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) throw new ZopiaError('ZOPIA_SPEC_INVALID', 'Invalid operation tags: expected an array of strings');
  return value.map((tag) => tag.startsWith('#') ? tag : `#${tag}`);
}

/**
 * Build the validated operation-level IR used by endpoint rendering.
 *
 * @param input Valid Swagger/OpenAPI object or JSON text.
 * @returns Canonically ordered validated operation records.
 * @throws {@link ZopiaError} when source operation metadata is invalid.
 */
export function buildOpenApiOperationIR(input: OpenApiDocument | string): OpenApiOperationIR[] {
  const { document } = normalizeOpenApiDocument(input);
  return [...collectOpenApiOperations(document), ...collectOpenApiWebhookOperations(document)].map((entry) => {
    const operation = entry.operation;
    if (operation.summary !== undefined && typeof operation.summary !== 'string') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid summary: ${entry.method.toUpperCase()} ${entry.path}`);
    if (operation.description !== undefined && typeof operation.description !== 'string') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid description: ${entry.method.toUpperCase()} ${entry.path}`);
    if (operation.deprecated !== undefined && typeof operation.deprecated !== 'boolean') throw new ZopiaError('ZOPIA_SPEC_INVALID', `Invalid deprecated flag: ${entry.method.toUpperCase()} ${entry.path}`);
    return {
      path: entry.path,
      method: entry.method.toUpperCase() as Uppercase<OpenApiOperation['method']>,
      pathShape: entry.path,
      operationId: entry.operationId,
      summary: operation.summary,
      description: operation.description,
      tags: tags(operation.tags),
      deprecated: operation.deprecated === true,
      security: Object.prototype.hasOwnProperty.call(operation, 'security') ? security(operation.security, `${entry.method.toUpperCase()} ${entry.path}`) : security(document.security, 'document'),
      operation,
      parameters: entry.parameters,
      document,
    };
  });
}
