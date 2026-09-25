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
  const isSchema = (value: unknown): value is JsonSchema => typeof value === 'boolean' || (value !== null && typeof value === 'object' && !Array.isArray(value));
  const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const isNonNegativeInteger = (value: unknown): value is number => isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
  const canonicalJson = (value: unknown): string | undefined => {
    try { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
    catch { return undefined; }
  };
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
    if (!node || typeof node !== 'object' || Array.isArray(node)) { warnings.push('Schema node is not an object'); return { schema: z.any(), code: 'z.any()' }; }
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
    if (node.nullable !== undefined) {
      const withoutNullable = Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'nullable')) as JsonSchema;
      if (typeof node.nullable !== 'boolean') { warnings.push('Invalid nullable: expected a boolean'); return convert(withoutNullable, resolving); }
      const converted = convert(withoutNullable, resolving);
      return node.nullable ? { schema: converted.schema.nullable(), code: `${converted.code}.nullable()` } : converted;
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
    const withSiblings = (keyword: string, constrained: { schema: z.ZodType; code: string }): { schema: z.ZodType; code: string } => {
      const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== keyword));
      if (Object.keys(siblings).length === 0) return constrained;
      const sibling = convert(siblings, resolving);
      return { schema: (sibling.schema as any).and(constrained.schema), code: `${sibling.code}.and(${constrained.code})` };
    };
    const literalSchema = (value: unknown, keyword: 'enum' | 'const'): { schema: z.ZodType; code: string } | undefined => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)) return { schema: z.literal(value as any), code: `z.literal(${JSON.stringify(value)})` };
      if (value && typeof value === 'object') {
        const canonical = canonicalJson(value);
        if (canonical !== undefined) return {
          schema: z.any().refine((candidate) => canonicalJson(candidate) === canonical),
          code: `z.any().refine((value) => { try { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item) === ${JSON.stringify(canonical)}; } catch { return false; } })`,
        };
      }
      warnings.push(`Invalid ${keyword} value: expected a JSON value`);
      return undefined;
    };
    if ('oneOf' in node || 'anyOf' in node) {
      const key = 'oneOf' in node ? 'oneOf' : 'anyOf';
      if (!Array.isArray(node[key])) { warnings.push(`Invalid ${key}: expected an array`); return withSiblings(key, { schema: z.any(), code: 'z.any()' }); }
      if (key === 'oneOf') warnings.push('oneOf is approximated by z.union and does not enforce exclusivity');
      const items = node[key].map((child: JsonSchema) => convert(child, resolving));
      const combined = items.length === 0
        ? { schema: z.never(), code: 'z.never()' }
        : items.length === 1
          ? items[0]
          : { schema: z.union(items.map((item: { schema: z.ZodType }) => item.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${items.map((item: { code: string }) => item.code).join(', ')}])` };
      return withSiblings(key, combined);
    }
    if ('allOf' in node) {
      if (!Array.isArray(node.allOf)) { warnings.push('Invalid allOf: expected an array'); return withSiblings('allOf', { schema: z.any(), code: 'z.any()' }); }
      const items = node.allOf.map((child: JsonSchema) => convert(child, resolving));
      const combined = items.length === 0
        ? { schema: z.any(), code: 'z.any()' }
        : { schema: items.slice(1).reduce((acc: any, item: { schema: z.ZodType }) => acc.and(item.schema), items[0].schema as any), code: items.slice(1).reduce((code: string, item: { code: string }) => `${code}.and(${item.code})`, items[0].code) };
      return withSiblings('allOf', combined);
    }
    if ('enum' in node) {
      if (!Array.isArray(node.enum)) { warnings.push('Invalid enum: expected an array'); return withSiblings('enum', { schema: z.any(), code: 'z.any()' }); }
      let combined: { schema: z.ZodType; code: string };
      if (node.enum.length === 0) combined = { schema: z.never(), code: 'z.never()' };
      else if (node.enum.every((value: unknown) => typeof value === 'string')) combined = { schema: z.enum(node.enum as [string, ...string[]]), code: `z.enum(${JSON.stringify(node.enum)})` };
      else {
        const literals = node.enum.map((value: unknown) => literalSchema(value, 'enum')).filter((item: { schema: z.ZodType; code: string } | undefined): item is { schema: z.ZodType; code: string } => item !== undefined);
        combined = literals.length === 0
          ? { schema: z.never(), code: 'z.never()' }
          : literals.length === 1
            ? literals[0]
            : { schema: z.union(literals.map((item) => item.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${literals.map((item) => item.code).join(', ')}])` };
      }
      return withSiblings('enum', combined);
    }
    if ('const' in node) {
      const literal = literalSchema(node.const, 'const') ?? { schema: z.any(), code: 'z.any()' };
      return withSiblings('const', literal);
    }
    let result: { schema: z.ZodType; code: string };
    switch (node.type) {
      case 'object': {
        if (node.properties !== undefined && (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties))) { warnings.push('Invalid properties: expected an object'); result = { schema: z.object({}).passthrough(), code: 'z.object({}).passthrough()' }; break; }
        const requiredKeys = Array.isArray(node.required) && node.required.every((key: unknown) => typeof key === 'string') ? node.required as string[] : [];
        if (node.required !== undefined && (!Array.isArray(node.required) || requiredKeys.length !== node.required.length)) warnings.push('Invalid required: expected an array of strings');
        const patternPropertiesValid = node.patternProperties === undefined || (node.patternProperties !== null && typeof node.patternProperties === 'object' && !Array.isArray(node.patternProperties));
        if (!patternPropertiesValid) warnings.push('Invalid patternProperties: expected an object');
        const additionalPropertiesValid = node.additionalProperties === undefined || isSchema(node.additionalProperties);
        if (!additionalPropertiesValid) warnings.push('Invalid additionalProperties: expected a schema');
        const unevaluatedPropertiesValid = node.unevaluatedProperties === undefined || isSchema(node.unevaluatedProperties);
        if (!unevaluatedPropertiesValid) warnings.push('Invalid unevaluatedProperties: expected a schema');
        const shape: Record<string, z.ZodType> = Object.create(null); const parts: string[] = [];
        for (const [key, child] of Object.entries(node.properties ?? {})) { const item = convert(child as JsonSchema, resolving); const required = requiredKeys.includes(key); shape[key] = required ? item.schema : item.schema.optional(); parts.push(`[${JSON.stringify(key)}]: ${required ? item.code : `${item.code}.optional()`}`); }
        for (const key of requiredKeys) if (!(key in shape)) { shape[key] = z.unknown(); parts.push(`[${JSON.stringify(key)}]: z.unknown()`); }
        let objectSchema = z.object(shape); let objectCode = `z.object({ ${parts.join(', ')} })`;
        if (node.additionalProperties === undefined && patternPropertiesValid && node.patternProperties) {
          const patternSchemas = Object.values(node.patternProperties as Record<string, JsonSchema>);
          if (patternSchemas.length) { const pattern = convert(patternSchemas[0], resolving); objectSchema = objectSchema.catchall(pattern.schema); objectCode += `.catchall(${pattern.code})`; }
        }
        if (node.additionalProperties === false || (node.additionalProperties === undefined && node.unevaluatedProperties === false)) { objectSchema = objectSchema.strict(); objectCode += '.strict()'; }
        else if (additionalPropertiesValid && node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') { const item = convert(node.additionalProperties, resolving); objectSchema = objectSchema.catchall(item.schema); objectCode += `.catchall(${item.code})`; }
        else if (node.additionalProperties === undefined && unevaluatedPropertiesValid && node.unevaluatedProperties !== undefined && typeof node.unevaluatedProperties !== 'boolean') { const item = convert(node.unevaluatedProperties, resolving); objectSchema = objectSchema.catchall(item.schema); objectCode += `.catchall(${item.code})`; }
        else { objectSchema = objectSchema.passthrough(); objectCode += '.passthrough()'; }
        result = { schema: objectSchema, code: objectCode }; break;
      }
      case 'array': {
        const prefixItemsValid = node.prefixItems === undefined || Array.isArray(node.prefixItems);
        if (!prefixItemsValid) warnings.push('Invalid prefixItems: expected an array of schemas');
        const itemsValid = node.items === undefined || Array.isArray(node.items) || isSchema(node.items);
        if (!itemsValid) warnings.push('Invalid items: expected a schema or tuple array');
        const additionalItemsValid = node.additionalItems === undefined || isSchema(node.additionalItems);
        if (!additionalItemsValid) warnings.push('Invalid additionalItems: expected a schema');
        const unevaluatedItemsValid = node.unevaluatedItems === undefined || isSchema(node.unevaluatedItems);
        if (!unevaluatedItemsValid) warnings.push('Invalid unevaluatedItems: expected a schema');
        if (itemsValid && node.items === false && !Array.isArray(node.prefixItems)) { result = { schema: z.tuple([]), code: 'z.tuple([])' }; break; }
        if (Array.isArray(node.prefixItems) || (itemsValid && Array.isArray(node.items))) {
          const usesPrefixItems = Array.isArray(node.prefixItems);
          const tupleNodes = (usesPrefixItems ? node.prefixItems : node.items) as JsonSchema[];
          const tuple = tupleNodes.map((item) => convert(item, resolving));
          const schemas = tuple.map((item) => item.schema);
          const codes = tuple.map((item) => item.code);
          let tupleSchema: any = z.tuple(schemas as any); let tupleCode = `z.tuple([${codes.join(', ')}])`;
          const restNode: JsonSchema = usesPrefixItems
            ? itemsValid && node.items !== undefined ? node.items : unevaluatedItemsValid && node.unevaluatedItems !== undefined ? node.unevaluatedItems : true
            : additionalItemsValid && node.additionalItems !== undefined ? node.additionalItems : true;
          if (restNode !== false) { const rest = convert(restNode, resolving); tupleSchema = tupleSchema.rest(rest.schema); tupleCode += `.rest(${rest.code})`; }
          result = { schema: tupleSchema, code: tupleCode };
        } else { const item = convert(itemsValid && node.items !== undefined ? node.items as JsonSchema : true, resolving); result = { schema: z.array(item.schema), code: `z.array(${item.code})` }; }
        break;
      }
      case 'string': result = { schema: z.string(), code: 'z.string()' }; break;
      case 'number': result = { schema: z.number(), code: 'z.number()' }; break;
      case 'integer': result = { schema: z.number().int(), code: 'z.number().int()' }; break;
      case 'boolean': result = { schema: z.boolean(), code: 'z.boolean()' }; break;
      case 'null': result = { schema: z.null(), code: 'z.null()' }; break;
      default:
        if (node.type !== undefined) warnings.push(`Unsupported JSON Schema type: ${String(node.type)}`);
        result = { schema: z.any(), code: 'z.any()' };
    }
    if (node.not) {
      const excluded = convert(node.not as JsonSchema, resolving);
      result = { schema: result.schema.refine((value: unknown) => !excluded.schema.safeParse(value).success), code: `${result.code}.refine((value) => !(${excluded.code}).safeParse(value).success)` };
    }
    if ((node.format === 'int32' || node.format === 'int64') && (node.type === 'integer' || node.type === 'number')) {
      const integer = (result.schema as any).int(); const code = `${result.code}.int()`;
      result = node.format === 'int32' ? { schema: integer.min(-2147483648).max(2147483647), code: `${code}.min(-2147483648).max(2147483647)` } : { schema: integer, code };
    }
    if ((node.format === 'uint32' || node.format === 'uint64') && (node.type === 'integer' || node.type === 'number')) {
      const integer = (result.schema as any).int().nonnegative(); const code = `${result.code}.int().nonnegative()`;
      result = node.format === 'uint32' ? { schema: integer.max(4294967295), code: `${code}.max(4294967295)` } : { schema: integer, code };
    }
    if (node.format && node.type === 'string') {
      const formats: Record<string, { schema: (s: any) => any; code: string }> = {
        email: { schema: (s) => s.email(), code: 'email()' },
        uuid: { schema: (s) => s.uuid(), code: 'uuid()' },
        uri: { schema: (s) => s.url(), code: 'url()' },
        'date-time': { schema: (s) => s.datetime(), code: 'datetime()' },
        date: { schema: (s) => s.date(), code: 'date()' },
        hostname: { schema: (s) => s.regex(/^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/), code: 'regex(/^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/)' },
        ipv4: { schema: (s) => s.ip({ version: 'v4' }), code: "ip({ version: 'v4' })" },
        ipv6: { schema: (s) => s.ip({ version: 'v6' }), code: "ip({ version: 'v6' })" },
        base64: { schema: (s) => s.base64(), code: 'base64()' },
        byte: { schema: (s) => s.base64(), code: 'base64()' },
        'base64url': { schema: (s) => s.base64url(), code: 'base64url()' },
        emoji: { schema: (s) => s.emoji(), code: 'emoji()' },
        time: { schema: (s) => s.time(), code: 'time()' },
        duration: { schema: (s) => s.duration(), code: 'duration()' },
      };
      const format = formats[node.format];
      if (format) { try { result = { schema: format.schema(result.schema), code: `${result.code}.${format.code}` }; } catch { warnings.push(`Unsupported format: ${node.format}`); } }
      else warnings.push(`Unsupported format: ${node.format}`);
    }
    if (node.uniqueItems !== undefined && node.type === 'array' && typeof node.uniqueItems !== 'boolean') warnings.push('Invalid uniqueItems: expected a boolean');
    if (node.uniqueItems === true && node.type === 'array') {
      result = { schema: result.schema.refine((items: any) => new Set(items.map((item: any) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).values()).size === items.length), code: `${result.code}.superRefine((items, ctx) => { if (new Set(items.map((item) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Array items must be unique' }); })` };
    }
    const applyConstraint = (name: string, value: unknown, valid: boolean, expected: string, apply: (schema: any, constraint: any) => any, method: string): void => {
      if (value === undefined) return;
      if (!valid) { warnings.push(`Invalid ${name}: expected ${expected}`); return; }
      try { result = { schema: apply(result.schema, value), code: `${result.code}.${method}(${JSON.stringify(value)})` }; }
      catch { warnings.push(`Unsupported constraint: ${name}`); }
    };
    if (node.type === 'string') {
      applyConstraint('minLength', node.minLength, isNonNegativeInteger(node.minLength), 'a non-negative integer', (schema, value) => schema.min(value), 'min');
      applyConstraint('maxLength', node.maxLength, isNonNegativeInteger(node.maxLength), 'a non-negative integer', (schema, value) => schema.max(value), 'max');
      if (node.pattern !== undefined) {
        if (typeof node.pattern !== 'string') warnings.push('Invalid pattern: expected a string');
        else try { result = { schema: (result.schema as any).regex(new RegExp(node.pattern)), code: `${result.code}.regex(new RegExp(${JSON.stringify(node.pattern)}))` }; }
        catch { warnings.push('Unsupported constraint: pattern'); }
      }
    }
    if (node.type === 'number' || node.type === 'integer') {
      applyConstraint('minimum', node.minimum, isFiniteNumber(node.minimum), 'a finite number', (schema, value) => schema.min(value), 'min');
      applyConstraint('maximum', node.maximum, isFiniteNumber(node.maximum), 'a finite number', (schema, value) => schema.max(value), 'max');
      for (const [name, keyword, fallback, method] of [['exclusiveMinimum', node.exclusiveMinimum, node.minimum, 'gt'], ['exclusiveMaximum', node.exclusiveMaximum, node.maximum, 'lt']] as const) {
        if (keyword === undefined || keyword === false) continue;
        const value = keyword === true ? fallback : keyword;
        if (!isFiniteNumber(value)) { warnings.push(`Invalid ${name}: expected a finite number${keyword === true ? ' in the corresponding inclusive bound' : ''}`); continue; }
        result = { schema: (result.schema as any)[method](value), code: `${result.code}.${method}(${JSON.stringify(value)})` };
      }
    }
    if (node.type === 'array') {
      applyConstraint('minItems', node.minItems, isNonNegativeInteger(node.minItems), 'a non-negative integer', (schema, value) => schema.min(value), 'min');
      applyConstraint('maxItems', node.maxItems, isNonNegativeInteger(node.maxItems), 'a non-negative integer', (schema, value) => schema.max(value), 'max');
    }
    if (node.type === 'object') {
      if (node.minProperties !== undefined) {
        if (!isNonNegativeInteger(node.minProperties)) warnings.push('Invalid minProperties: expected a non-negative integer');
        else result = { schema: result.schema.refine((value: any) => Object.keys(value).length >= node.minProperties), code: `${result.code}.refine((value) => Object.keys(value).length >= ${node.minProperties})` };
      }
      if (node.maxProperties !== undefined) {
        if (!isNonNegativeInteger(node.maxProperties)) warnings.push('Invalid maxProperties: expected a non-negative integer');
        else result = { schema: result.schema.refine((value: any) => Object.keys(value).length <= node.maxProperties), code: `${result.code}.refine((value) => Object.keys(value).length <= ${node.maxProperties})` };
      }
    }
    if (node.multipleOf !== undefined && (node.type === 'number' || node.type === 'integer') && isFiniteNumber(node.multipleOf) && node.multipleOf > 0) {
      const multiple = node.multipleOf;
      result = { schema: result.schema.refine((value: unknown) => typeof value === 'number' && Math.abs(value / multiple - Math.round(value / multiple)) <= Number.EPSILON * Math.max(1, Math.abs(value / multiple))), code: `${result.code}.refine((value) => Math.abs(value / ${multiple} - Math.round(value / ${multiple})) <= Number.EPSILON * Math.max(1, Math.abs(value / ${multiple})))` };
    } else if (node.multipleOf !== undefined && (node.type === 'number' || node.type === 'integer')) warnings.push('Invalid multipleOf: expected a positive number');
    if (node.contains === undefined && (node.minContains !== undefined || node.maxContains !== undefined)) warnings.push('minContains/maxContains require contains and were ignored');
    if (node.additionalItems !== undefined && !Array.isArray(node.items) && !Array.isArray(node.prefixItems)) warnings.push('additionalItems applies only to tuple schemas and was ignored');
    if (node.type === 'object' && node.propertyNames !== undefined) {
      if (typeof node.propertyNames === 'boolean' || (node.propertyNames !== null && typeof node.propertyNames === 'object' && !Array.isArray(node.propertyNames))) {
        const propertyDefinition = typeof node.propertyNames === 'object' ? node.propertyNames as Record<string, unknown> : undefined;
        const propertySchema = convert((propertyDefinition?.type === undefined && propertyDefinition && ('pattern' in propertyDefinition || 'minLength' in propertyDefinition || 'maxLength' in propertyDefinition)) ? { ...propertyDefinition, type: 'string' } as JsonSchema : node.propertyNames as JsonSchema, resolving);
        result = { schema: result.schema.refine((value: any) => Object.keys(value).every((key) => propertySchema.schema.safeParse(key).success)), code: `${result.code}.refine((value) => Object.keys(value).every((key) => (${propertySchema.code}).safeParse(key).success))` };
      } else warnings.push('Invalid propertyNames: expected a schema');
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
    if (node.type === 'object' && node.dependentSchemas !== undefined && (!node.dependentSchemas || typeof node.dependentSchemas !== 'object' || Array.isArray(node.dependentSchemas))) warnings.push('Invalid dependentSchemas: expected an object of schemas');
    if (node.type === 'object' && node.dependentSchemas && typeof node.dependentSchemas === 'object' && !Array.isArray(node.dependentSchemas)) {
      for (const [key, dependency] of Object.entries(node.dependentSchemas as Record<string, JsonSchema>)) {
        const dependent = convert(dependency, resolving);
        result = { schema: result.schema.refine((value: any) => value[key] === undefined || dependent.schema.safeParse(value).success), code: `${result.code}.refine((value) => value[${JSON.stringify(key)}] === undefined || (${dependent.code}).safeParse(value).success)` };
      }
    }
    if (node.type === 'array' && node.contains !== undefined) {
      if (isSchema(node.contains)) {
        const contained = convert(node.contains, resolving);
        const minValid = node.minContains === undefined || isNonNegativeInteger(node.minContains);
        const maxValid = node.maxContains === undefined || isNonNegativeInteger(node.maxContains);
        if (!minValid) warnings.push('Invalid minContains: expected a non-negative integer');
        if (!maxValid) warnings.push('Invalid maxContains: expected a non-negative integer');
        const min = minValid ? node.minContains ?? 1 : 1; const max = maxValid ? node.maxContains : undefined;
        result = { schema: result.schema.refine((items: any) => { const count = items.filter((item: any) => contained.schema.safeParse(item).success).length; return count >= min && (max === undefined || count <= max); }), code: `${result.code}.refine((items) => { const count = items.filter((item) => ${contained.code}.safeParse(item).success).length; return count >= ${min}${max === undefined ? '' : ` && count <= ${max}`}; })` };
      } else warnings.push('Invalid contains: expected a schema');
    }
    const hasIf = Object.prototype.hasOwnProperty.call(node, 'if');
    if (!hasIf && (Object.prototype.hasOwnProperty.call(node, 'then') || Object.prototype.hasOwnProperty.call(node, 'else'))) warnings.push('then/else require if and were ignored');
    if (hasIf) {
      if (!isSchema(node.if)) warnings.push('Invalid if: expected a schema');
      else {
        const contextualize = (schema: JsonSchema): JsonSchema => {
          if (typeof schema === 'boolean' || schema.type !== undefined) return schema;
          if (typeof node.type === 'string') return { ...schema, type: node.type };
          const typeSpecificKeywords = ['properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'dependentRequired', 'dependentSchemas', 'items', 'prefixItems', 'contains', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
          const warning = 'Conditional schema without an explicit parent or branch type may approximate type-specific keyword semantics';
          if (typeSpecificKeywords.some((key) => Object.prototype.hasOwnProperty.call(schema, key)) && !warnings.includes(warning)) warnings.push(warning);
          return schema;
        };
        const condition = convert(contextualize(node.if), resolving);
        let whenTrue: { schema: z.ZodType; code: string } | undefined;
        let whenFalse: { schema: z.ZodType; code: string } | undefined;
        if (Object.prototype.hasOwnProperty.call(node, 'then')) {
          if (!isSchema(node.then)) warnings.push('Invalid then: expected a schema');
          else whenTrue = convert(contextualize(node.then), resolving);
        }
        if (Object.prototype.hasOwnProperty.call(node, 'else')) {
          if (!isSchema(node.else)) warnings.push('Invalid else: expected a schema');
          else whenFalse = convert(contextualize(node.else), resolving);
        }
        if (whenTrue || whenFalse) {
          result = {
            schema: result.schema.refine((value: unknown) => condition.schema.safeParse(value).success ? !whenTrue || whenTrue.schema.safeParse(value).success : !whenFalse || whenFalse.schema.safeParse(value).success),
            code: `${result.code}.refine((value) => (${condition.code}).safeParse(value).success ? ${whenTrue ? `(${whenTrue.code}).safeParse(value).success` : 'true'} : ${whenFalse ? `(${whenFalse.code}).safeParse(value).success` : 'true'})`,
          };
        }
      }
    }
    if (node.contentEncoding === 'base64' && node.type === 'string') result = { schema: (result.schema as any).base64(), code: `${result.code}.base64()` };
    else if (node.contentEncoding === 'base64url' && node.type === 'string') result = { schema: (result.schema as any).base64url(), code: `${result.code}.base64url()` };
    else if (node.contentEncoding === 'hex' && node.type === 'string') result = { schema: (result.schema as any).regex(/^(?:[0-9A-Fa-f]{2})*$/), code: `${result.code}.regex(/^(?:[0-9A-Fa-f]{2})*$/)` };
    else if (node.contentEncoding !== undefined && node.type === 'string') warnings.push(`Unsupported contentEncoding: ${String(node.contentEncoding)}`);
    else if (node.contentEncoding !== undefined && node.type !== 'string') warnings.push('Invalid contentEncoding: expected a string schema');
    if (node.default !== undefined) result = { schema: result.schema.default(node.default), code: `${result.code}.default(${JSON.stringify(node.default)})` };
    return result;
  };
  const converted = convert(source);
  return { code: `const ${rootName} = ${converted.code};`, schema: converted.schema, warnings };
}
