import { z } from 'zod';

export interface JsonSchemaToZodResult {
  code: string;
  schema: z.ZodType;
  warnings: string[];
}

type JsonSchema = Record<string, any> | boolean;

/** Convert a JSON Schema value into executable Zod 4 code and a Zod schema. */
export function jsonSchemaToZod(input: JsonSchema | string, options: { rootName?: string } = {}): JsonSchemaToZodResult {
  const rootName = options.rootName ?? 'schema';
  const reservedNames = new Set(['arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rootName) || reservedNames.has(rootName)) throw new TypeError(`Invalid rootName: ${rootName}`);
  const warnings: string[] = [];
  let source: JsonSchema;
  try { source = (typeof input === 'string' ? JSON.parse(input) : input) as JsonSchema; }
  catch (error) { throw new TypeError(`Invalid JSON Schema input: ${error instanceof Error ? error.message : String(error)}`); }
  const resolveLocalRef = (ref: string): JsonSchema | undefined => {
    if (ref !== '#' && !ref.startsWith('#/')) return undefined;
    if (ref === '#') return source;
    return ref.slice(2).split('/').map((part) => {
      if (/~(?![01])/.test(part)) return undefined;
      return part.replace(/~1/g, '/').replace(/~0/g, '~');
    }).reduce<any>((value, key) => {
      if (key === undefined || value === null || (typeof value !== 'object' && typeof value !== 'function') || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
      return value[key];
    }, source);
  };
  const convert = (node: JsonSchema, resolving = new Set<string>()): { schema: z.ZodType; code: string } => {
    if (node === true) return { schema: z.any(), code: 'z.any()' };
    if (node === false) return { schema: z.never(), code: 'z.never()' };
    if (!node || typeof node !== 'object') { warnings.push('Schema node is not an object'); return { schema: z.any(), code: 'z.any()' }; }
    for (const keyword of ['not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas']) {
      if (keyword in node) warnings.push(`Unsupported JSON Schema keyword: ${keyword}`);
    }
    if ('$ref' in node) {
      if (typeof node.$ref !== 'string' || node.$ref.length === 0) { warnings.push('Invalid $ref: expected a non-empty string'); return { schema: z.any(), code: 'z.any()' }; }
      const ref = node.$ref; const target = resolveLocalRef(ref);
      if (!target) { warnings.push(`Unsupported $ref: ${ref}`); return { schema: z.any(), code: 'z.any()' }; }
      if (resolving.has(ref)) { warnings.push(`Recursive $ref cannot be eagerly materialized: ${ref}`); return { schema: z.any(), code: 'z.any()' }; }
      const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref'));
      const targetAny: any = target;
      const resolved: JsonSchema = Object.keys(siblings).length
        ? targetAny === true ? siblings : targetAny === false ? false : { ...targetAny, ...siblings }
        : targetAny;
      return convert(resolved, new Set(resolving).add(ref));
    }
    if (Array.isArray(node.type)) {
      const allowedTypes = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
      if (node.type.length === 0 || !node.type.every((type: unknown) => typeof type === 'string' && allowedTypes.has(type))) { warnings.push('Invalid type: expected a non-empty array of valid JSON Schema type names'); return { schema: z.any(), code: 'z.any()' }; }
      const variants = node.type.map((type: string) => {
        const branch: JsonSchema = { ...node, type };
        if (type === 'null') {
          delete branch.format; delete branch.minLength; delete branch.maxLength;
          delete branch.pattern; delete branch.minimum; delete branch.maximum;
          delete branch.exclusiveMinimum; delete branch.exclusiveMaximum;
        }
        return convert(branch, resolving);
      });
      if (variants.length === 1) return variants[0];
      return { schema: z.union(variants.map((item: { schema: z.ZodType }) => item.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${variants.map((item: { code: string }) => item.code).join(', ')}])` };
    }
    if ('oneOf' in node || 'anyOf' in node) {
      const key = 'oneOf' in node ? 'oneOf' : 'anyOf';
      if (!Array.isArray(node[key])) { warnings.push(`Invalid ${key}: expected an array`); return { schema: z.any(), code: 'z.any()' }; }
      if (key === 'oneOf') warnings.push('oneOf is approximated by z.union and does not enforce exclusivity');
      const items = node[key].map((child: JsonSchema) => convert(child, resolving));
      if (items.length === 0) return { schema: z.never(), code: 'z.never()' };
      if (items.length === 1) return items[0];
      return { schema: z.union(items.map((item: { schema: z.ZodType }) => item.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${items.map((item: { code: string }) => item.code).join(', ')}])` };
    }
    if ('allOf' in node) {
      if (!Array.isArray(node.allOf)) { warnings.push('Invalid allOf: expected an array'); return { schema: z.any(), code: 'z.any()' }; }
      const items = node.allOf.map((child: JsonSchema) => convert(child, resolving));
      if (items.length === 0) return { schema: z.any(), code: 'z.any()' };
      const schema = items.slice(1).reduce((acc: any, item: { schema: z.ZodType }) => acc.and(item.schema), items[0].schema as any);
      return { schema, code: items.slice(1).reduce((code: string, item: { code: string }) => `${code}.and(${item.code})`, items[0].code) };
    }
    if ('enum' in node) {
      if (!Array.isArray(node.enum)) { warnings.push('Invalid enum: expected an array'); return { schema: z.any(), code: 'z.any()' }; }
      if (node.enum.length === 0) return { schema: z.never(), code: 'z.never()' };
      if (node.enum.every((v: unknown) => typeof v === 'string')) return { schema: z.enum(node.enum as [string, ...string[]]), code: `z.enum(${JSON.stringify(node.enum)})` };
      const values = node.enum.map((v: unknown) => JSON.stringify(v)).join(', ');
      const literals = node.enum.map((v: unknown) => z.literal(v as any));
      if (literals.length === 1) return { schema: literals[0], code: `z.literal(${values})` };
      return { schema: z.union(literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${node.enum.map((value: unknown) => `z.literal(${JSON.stringify(value)})`).join(', ')}])` };
    }
    if ('const' in node) return { schema: z.literal(node.const), code: `z.literal(${JSON.stringify(node.const)})` };
    let result: { schema: z.ZodType; code: string };
    switch (node.type) {
      case 'object': {
        if (node.properties !== undefined && (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties))) { warnings.push('Invalid properties: expected an object'); result = { schema: z.object({}).passthrough(), code: 'z.object({}).passthrough()' }; break; }
        if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every((key: unknown) => typeof key === 'string'))) warnings.push('Invalid required: expected an array of strings');
        const shape: Record<string, z.ZodType> = Object.create(null); const parts: string[] = [];
        for (const [key, child] of Object.entries(node.properties ?? {})) { const item = convert(child as JsonSchema, resolving); const required = Array.isArray(node.required) && node.required.includes(key); shape[key] = required ? item.schema : item.schema.optional(); parts.push(`[${JSON.stringify(key)}]: ${required ? item.code : `${item.code}.optional()`}`); }
        if (Array.isArray(node.required)) for (const key of node.required) if (!(key in shape)) { shape[key] = z.unknown(); parts.push(`[${JSON.stringify(key)}]: z.unknown()`); }
        let objectSchema = z.object(shape); let objectCode = `z.object({ ${parts.join(', ')} })`;
        if (node.additionalProperties === undefined && node.patternProperties && typeof node.patternProperties === 'object') {
          const patternSchemas = Object.values(node.patternProperties as Record<string, JsonSchema>);
          if (patternSchemas.length) { const pattern = convert(patternSchemas[0], resolving); objectSchema = objectSchema.catchall(pattern.schema); objectCode += `.catchall(${pattern.code})`; }
        }
        if (typeof node.minProperties === 'number') { objectSchema = objectSchema.refine((value) => Object.keys(value).length >= node.minProperties); objectCode += `.refine((value) => Object.keys(value).length >= ${node.minProperties})`; }
        if (typeof node.maxProperties === 'number') { objectSchema = objectSchema.refine((value) => Object.keys(value).length <= node.maxProperties); objectCode += `.refine((value) => Object.keys(value).length <= ${node.maxProperties})`; }
        if (node.additionalProperties === false) { objectSchema = objectSchema.strict(); objectCode += '.strict()'; }
        else if (node.additionalProperties && typeof node.additionalProperties === 'object') { const item = convert(node.additionalProperties as JsonSchema, resolving); objectSchema = objectSchema.catchall(item.schema); objectCode += `.catchall(${item.code})`; }
        else { objectSchema = objectSchema.passthrough(); objectCode += '.passthrough()'; }
        result = { schema: objectSchema, code: objectCode }; break;
      }
      case 'array': {
        if (node.items === false && !Array.isArray(node.prefixItems)) { result = { schema: z.tuple([]), code: 'z.tuple([])' }; break; }
        if (Array.isArray(node.prefixItems) || Array.isArray(node.items)) {
          const tupleNodes = (Array.isArray(node.prefixItems) ? node.prefixItems : node.items) as JsonSchema[];
          const tuple = tupleNodes.map((item) => convert(item, resolving));
          const schemas = tuple.map((item) => item.schema);
          const codes = tuple.map((item) => item.code);
          if (tuple.length) {
            let tupleSchema: any = z.tuple(schemas as [z.ZodType, ...z.ZodType[]]); let tupleCode = `z.tuple([${codes.join(', ')}])`;
            if (node.items && !Array.isArray(node.items) && node.items !== false) { const rest = convert(node.items as JsonSchema, resolving); tupleSchema = tupleSchema.rest(rest.schema); tupleCode += `.rest(${rest.code})`; }
            else if (node.additionalItems && typeof node.additionalItems === 'object') { const rest = convert(node.additionalItems as JsonSchema, resolving); tupleSchema = tupleSchema.rest(rest.schema); tupleCode += `.rest(${rest.code})`; }
            else if (node.items !== false && node.additionalItems !== false && node.prefixItems) { tupleSchema = tupleSchema.rest(z.any()); tupleCode += '.rest(z.any())'; }
            result = { schema: tupleSchema, code: tupleCode };
          } else result = { schema: z.array(z.any()), code: 'z.array(z.any())' };
        } else { const item = convert((node.items ?? {}) as JsonSchema, resolving); result = { schema: z.array(item.schema), code: `z.array(${item.code})` }; }
        break;
      }
      case 'string': result = { schema: z.string(), code: 'z.string()' }; break;
      case 'number': result = { schema: z.number(), code: 'z.number()' }; break;
      case 'integer': result = { schema: z.number().int(), code: 'z.number().int()' }; break;
      case 'boolean': result = { schema: z.boolean(), code: 'z.boolean()' }; break;
      case 'null': result = { schema: z.null(), code: 'z.null()' }; break;
      default: warnings.push(`Unsupported JSON Schema type: ${String(node.type)}`); result = { schema: z.any(), code: 'z.any()' };
    }
    if (node.not) {
      const excluded = convert(node.not as JsonSchema, resolving);
      result = { schema: result.schema.refine((value: unknown) => !excluded.schema.safeParse(value).success), code: `${result.code}.refine((value) => !(${excluded.code}).safeParse(value).success)` };
    }
    if (node.format && node.type === 'string') {
      const formats: Record<string, { schema: (s: any) => any; code: string }> = {
        email: { schema: (s) => s.email(), code: 'email()' },
        uuid: { schema: (s) => s.uuid(), code: 'uuid()' },
        uri: { schema: (s) => s.url(), code: 'url()' },
        'date-time': { schema: (s) => s.datetime(), code: 'datetime()' },
        date: { schema: (s) => s.date(), code: 'date()' },
      };
      const format = formats[node.format];
      if (format) { try { result = { schema: format.schema(result.schema), code: `${result.code}.${format.code}` }; } catch { warnings.push(`Unsupported format: ${node.format}`); } }
      else warnings.push(`Unsupported format: ${node.format}`);
    }
    if (node.uniqueItems === true && node.type === 'array') {
      result = { schema: result.schema.refine((items: any) => new Set(items.map((item: any) => JSON.stringify(item, item !== null && typeof item === 'object' ? Object.keys(item).sort() : undefined)).values()).size === items.length), code: `${result.code}.superRefine((items, ctx) => { if (new Set(items.map((item) => JSON.stringify(item, item !== null && typeof item === 'object' ? Object.keys(item).sort() : undefined))).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Array items must be unique' }); })` };
    }
    const methods: Array<[string, unknown, (schema: any, value: any) => any]> = [
      ['minLength', node.minLength, (s, v) => s.min(v)],
      ['maxLength', node.maxLength, (s, v) => s.max(v)],
      ['pattern', node.pattern, (s, v) => s.regex(new RegExp(v))],
      ['minimum', node.minimum, (s, v) => s.min(v)],
      ['maximum', node.maximum, (s, v) => s.max(v)],
      ['exclusiveMinimum', node.exclusiveMinimum, (s, v) => s.gt(v)],
      ['exclusiveMaximum', node.exclusiveMaximum, (s, v) => s.lt(v)],
      ['minItems', node.minItems, (s, v) => s.min(v)],
      ['maxItems', node.maxItems, (s, v) => s.max(v)],
    ];
    for (const [name, value, apply] of methods) {
      if (value === undefined) continue;
      try { const method = name === 'pattern' ? `regex(new RegExp(${JSON.stringify(value)}))` : `${name === 'exclusiveMinimum' ? 'gt' : name === 'exclusiveMaximum' ? 'lt' : name === 'minItems' ? 'min' : name === 'maxItems' ? 'max' : name === 'minLength' ? 'min' : name === 'maxLength' ? 'max' : name === 'minimum' ? 'min' : name === 'maximum' ? 'max' : name}(${JSON.stringify(value)})`; result = { schema: apply(result.schema, value), code: `${result.code}.${method}` }; }
      catch { warnings.push(`Unsupported constraint: ${name}`); }
    }
    if (node.multipleOf !== undefined && node.type === 'number') warnings.push('multipleOf is not represented by a basic Zod method');
    if (node.contains === undefined && (node.minContains !== undefined || node.maxContains !== undefined)) warnings.push('minContains/maxContains require contains and were ignored');
    if (node.additionalItems !== undefined && !Array.isArray(node.items) && !Array.isArray(node.prefixItems)) warnings.push('additionalItems applies only to tuple schemas and was ignored');
    if (node.type === 'object' && (node.minProperties !== undefined || node.maxProperties !== undefined)) {
      const min = node.minProperties; const max = node.maxProperties;
      result = { schema: result.schema.refine((value: any) => Object.keys(value).length >= (min ?? 0) && (max === undefined || Object.keys(value).length <= max)), code: `${result.code}.refine((value) => Object.keys(value).length >= ${min ?? 0}${max === undefined ? '' : ` && Object.keys(value).length <= ${max}`})` };
    }
    if (node.type === 'object' && node.propertyNames && typeof (node.propertyNames as any).pattern === 'string') {
      const pattern = (node.propertyNames as any).pattern;
      try {
        const expression = new RegExp(pattern);
        result = { schema: result.schema.refine((value: any) => Object.keys(value).every((key) => expression.test(key))), code: `${result.code}.refine((value) => Object.keys(value).every((key) => new RegExp(${JSON.stringify(pattern)}).test(key)))` };
      } catch { warnings.push(`Unsupported propertyNames pattern: ${pattern}`); }
    }
    if (node.type === 'object' && node.dependentRequired !== undefined && (!node.dependentRequired || typeof node.dependentRequired !== 'object' || Array.isArray(node.dependentRequired))) warnings.push('Invalid dependentRequired: expected an object of string arrays');
    if (node.type === 'object' && node.dependentRequired && typeof node.dependentRequired === 'object' && !Array.isArray(node.dependentRequired)) {
      const dependencies = Object.entries(node.dependentRequired as Record<string, unknown>).filter(([, value]) => { if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) warnings.push('Invalid dependentRequired entry: expected an array of strings'); return Array.isArray(value); });
      for (const [key, requiredKeys] of dependencies) {
        const keys = (requiredKeys as unknown[]).filter((item): item is string => typeof item === 'string');
        if (!keys.length) continue;
        result = { schema: result.schema.refine((value: any) => value[key] === undefined || keys.every((requiredKey) => value[requiredKey] !== undefined)), code: `${result.code}.refine((value) => value[${JSON.stringify(key)}] === undefined || ${JSON.stringify(keys)}.every((requiredKey) => value[requiredKey] !== undefined))` };
      }
    }
    if (node.type === 'array' && node.contains) {
      const contained = convert(node.contains as JsonSchema, resolving);
      const min = node.minContains ?? 1; const max = node.maxContains;
      result = { schema: result.schema.refine((items: any) => { const count = items.filter((item: any) => contained.schema.safeParse(item).success).length; return count >= min && (max === undefined || count <= max); }), code: `${result.code}.refine((items) => { const count = items.filter((item) => ${contained.code}.safeParse(item).success).length; return count >= ${min}${max === undefined ? '' : ` && count <= ${max}`}; })` };
    }
    if (node.default !== undefined) result = { schema: result.schema.default(node.default), code: `${result.code}.default(${JSON.stringify(node.default)})` };
    return result;
  };
  const converted = convert(source);
  return { code: `const ${rootName} = ${converted.code};`, schema: converted.schema, warnings };
}
