import { z } from 'zod';

export type ZodJsonSchemaTarget =
  | 'draft-4'
  | 'draft-07'
  | 'draft-2020-12'
  | 'openapi-3.0'
  | 'openapi-3.1';

export interface ZodToJsonSchemaOptions {
  target?: ZodJsonSchemaTarget;
  $schema?: boolean;
  io?: 'input' | 'output';
}

/** Convert a Zod 4 schema to JSON Schema or an OpenAPI Schema Object. */
export function zodToJsonSchema(
  schema: z.ZodType,
  options: ZodToJsonSchemaOptions = {},
): Record<string, unknown> {
  const target = options.target ?? 'draft-2020-12';
  const result = z.toJSONSchema(schema, {
    target,
    io: options.io ?? 'output',
    ...(options.$schema === undefined ? {} : { $schema: options.$schema }),
  });

  // Zod omits the dialect for OpenAPI targets. `$schema: true` is an explicit
  // zopia convenience and uses the OpenAPI-compatible draft-07 dialect.
  if (target === 'openapi-3.0' && options.$schema === true && !('$schema' in result)) {
    result.$schema = 'http://json-schema.org/draft-07/schema#';
  }
  if (options.$schema === false) delete result.$schema;
  return result as Record<string, unknown>;
}
