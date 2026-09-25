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

  finalizeSchema(result, target, options.$schema);
  return result as Record<string, unknown>;
}

/** Convert a named set of Zod schemas while preserving references between them. */
export function zodSchemasToJsonSchema(
  schemas: Iterable<readonly [string, z.ZodType]>,
  options: ZodToJsonSchemaOptions = {},
  uri: (name: string) => string = (name) => name,
): Record<string, Record<string, unknown>> {
  const target = options.target ?? 'draft-2020-12';
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of schemas) registry.add(schema, { id: name });
  const converted = z.toJSONSchema(registry, { target, io: options.io ?? 'output', uri }).schemas as Record<string, Record<string, unknown>>;
  for (const schema of Object.values(converted)) {
    finalizeSchema(schema, target, options.$schema);
    delete schema.$id;
  }
  return converted;
}

function finalizeSchema(result: Record<string, unknown>, target: ZodJsonSchemaTarget, includeDialect: boolean | undefined): void {
  // Zod omits the dialect for OpenAPI targets. `$schema: true` is an explicit
  // zopia convenience and uses the OpenAPI-compatible draft-07 dialect.
  if ((target === 'openapi-3.0' || target === 'openapi-3.1') && includeDialect === true && !('$schema' in result)) {
    result.$schema = 'http://json-schema.org/draft-07/schema#';
  }
  if (includeDialect === false) delete result.$schema;
}
