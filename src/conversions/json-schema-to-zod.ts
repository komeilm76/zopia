import { z } from 'zod';

export interface JsonSchemaToZodResult {
  code: string;
  schema: z.ZodType;
  warnings: string[];
}

type JsonSchema = Record<string, any>;

/** Convert a JSON Schema value into executable Zod 4 code and a Zod schema. */
export function jsonSchemaToZod(input: JsonSchema | string, options: { rootName?: string } = {}): JsonSchemaToZodResult {
  const rootName = options.rootName ?? 'schema';
  const source = typeof input === 'string' ? JSON.parse(input) : input;
  const warnings: string[] = [];
  const convert = (node: JsonSchema): { schema: z.ZodType; code: string } => {
    if (!node || typeof node !== 'object') { warnings.push('Schema node is not an object'); return { schema: z.any(), code: 'z.any()' }; }
    if (node.$ref) { warnings.push(`Unsupported $ref: ${node.$ref}`); return { schema: z.any(), code: 'z.any()' }; }
    if (node.enum) {
      if (node.enum.length === 0) return { schema: z.never(), code: 'z.never()' };
      if (node.enum.every((v: unknown) => typeof v === 'string')) return { schema: z.enum(node.enum as [string, ...string[]]), code: `z.enum(${JSON.stringify(node.enum)})` };
      const values = node.enum.map((v: unknown) => JSON.stringify(v)).join(', ');
      const literals = node.enum.map((v: unknown) => z.literal(v as any));
      if (literals.length === 1) return { schema: literals[0], code: `z.literal(${values})` };
      return { schema: z.union(literals as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${values}].map((value) => z.literal(value)))` };
    }
    if ('const' in node) return { schema: z.literal(node.const), code: `z.literal(${JSON.stringify(node.const)})` };
    let result: { schema: z.ZodType; code: string };
    switch (node.type) {
      case 'object': {
        const shape: Record<string, z.ZodType> = {}; const parts: string[] = [];
        for (const [key, child] of Object.entries(node.properties ?? {})) { const item = convert(child as JsonSchema); const required = (node.required ?? []).includes(key); shape[key] = required ? item.schema : item.schema.optional(); parts.push(`${JSON.stringify(key)}: ${required ? item.code : `${item.code}.optional()`}`); }
        result = { schema: z.object(shape), code: `z.object({ ${parts.join(', ')} })` }; break;
      }
      case 'array': { const item = convert((node.items ?? {}) as JsonSchema); result = { schema: z.array(item.schema), code: `z.array(${item.code})` }; break; }
      case 'string': result = { schema: z.string(), code: 'z.string()' }; break;
      case 'number': result = { schema: z.number(), code: 'z.number()' }; break;
      case 'integer': result = { schema: z.number().int(), code: 'z.number().int()' }; break;
      case 'boolean': result = { schema: z.boolean(), code: 'z.boolean()' }; break;
      case 'null': result = { schema: z.null(), code: 'z.null()' }; break;
      default: warnings.push(`Unsupported JSON Schema type: ${String(node.type)}`); result = { schema: z.any(), code: 'z.any()' };
    }
    if (node.default !== undefined) result = { schema: result.schema.default(node.default), code: `${result.code}.default(${JSON.stringify(node.default)})` };
    return result;
  };
  const converted = convert(source);
  return { code: `const ${rootName} = ${converted.code};`, schema: converted.schema, warnings };
}
