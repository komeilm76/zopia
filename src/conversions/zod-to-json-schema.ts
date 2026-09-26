import { z } from 'zod';
import { asZopiaError, ZopiaError } from '../errors';
import { ZopiaWarningCollector, type ZopiaWarning } from '../warnings';

/** Output dialect supported by the Zod-to-JSON-Schema converter. */
export type ZodJsonSchemaTarget =
  | 'draft-07'
  | 'draft-2020-12'
  | 'openapi-3.0'
  | 'openapi-3.1';

/** Options controlling Zod-to-JSON-Schema conversion. */
export interface ZodToJsonSchemaOptions {
  /** Output dialect. Defaults to OpenAPI 3.1 / JSON Schema 2020-12. */
  target?: ZodJsonSchemaTarget;
  /** Include the dialect's `$schema` URI. Defaults to `true`. */
  $schema?: boolean;
  /** Convert the schema's accepted input or produced output type. Defaults to `output`. */
  io?: 'input' | 'output';
  /** Receive every structured warning produced by a lossy conversion. */
  onWarning?: (warning: ZopiaWarning) => void;
}

type InternalZodJsonSchemaTarget = ZodJsonSchemaTarget | 'draft-4';
interface InternalZodToJsonSchemaOptions extends Omit<ZodToJsonSchemaOptions, 'target'> {
  target?: InternalZodJsonSchemaTarget;
}

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const KNOWN_FORMATS = new Set([
  'uuid',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'date-time',
  'date',
  'duration',
  'uri',
]);

// `$schema` is a document header. Every schema keyword after it starts with
// `type`, followed by a fixed validation/annotation dictionary (R-617).
const KEY_ORDER = [
  '$schema',
  'type',
  '$id',
  '$anchor',
  '$dynamicAnchor',
  '$ref',
  '$dynamicRef',
  'format',
  'contentEncoding',
  'contentMediaType',
  'const',
  'enum',
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'prefixItems',
  'items',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'minItems',
  'maxItems',
  'uniqueItems',
  'properties',
  'required',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'patternProperties',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'minProperties',
  'maxProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  '$defs',
  'definitions',
  'nullable',
  'readOnly',
  'writeOnly',
  'deprecated',
  'default',
  'examples',
  'example',
  'title',
  'description',
  '$comment',
] as const;
const KEY_RANK = new Map<string, number>(KEY_ORDER.map((key, index) => [key, index]));
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions']);
const SCHEMA_VALUE_KEYS = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'contains',
  'additionalItems',
  'unevaluatedItems',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
]);
const SCHEMA_ARRAY_KEYS = new Set(['prefixItems', 'allOf', 'anyOf', 'oneOf']);

function validateConversionOptions(options: InternalZodToJsonSchemaOptions, internal: boolean): void {
  if (!isRecord(options)) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'Zod conversion options must be an object', { at: 'options', hint: 'pass an options object or omit it' });
  const unknown = Object.keys(options).find((key) => !['target', '$schema', 'io', 'onWarning'].includes(key));
  if (unknown) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unknown Zod conversion option: ${unknown}`, { at: unknown, hint: 'remove the unsupported option' });
  const targets = internal ? ['draft-4', 'draft-07', 'draft-2020-12', 'openapi-3.0', 'openapi-3.1'] : ['draft-07', 'draft-2020-12', 'openapi-3.0', 'openapi-3.1'];
  if (options.target !== undefined && (typeof options.target !== 'string' || !targets.includes(options.target))) throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported Zod conversion target: ${String(options.target)}`, { at: 'target', hint: `use ${targets.join(', ')}` });
  if (options.$schema !== undefined && typeof options.$schema !== 'boolean') throw new ZopiaError('ZOPIA_CONFIG_INVALID', '$schema must be a boolean', { at: '$schema' });
  if (options.io !== undefined && options.io !== 'input' && options.io !== 'output') throw new ZopiaError('ZOPIA_CONFIG_INVALID', "io must be 'input' or 'output'", { at: 'io' });
  if (options.onWarning !== undefined && typeof options.onWarning !== 'function') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'onWarning must be a function', { at: 'onWarning' });
}

function isZodSchema(value: unknown): value is z.ZodType {
  return isRecord(value) && isRecord(value._zod) && typeof value._zod.run === 'function';
}

/** Convert a Zod 4 schema to canonical JSON Schema or an OpenAPI Schema Object. */
export function zodToJsonSchema(
  schema: z.ZodType,
  options: ZodToJsonSchemaOptions = {},
): Record<string, unknown> {
  validateConversionOptions(options, false);
  if (!isZodSchema(schema)) throw new ZopiaError('ZOPIA_SCHEMA_INVALID', 'expected a Zod 4 schema', { at: '#', hint: 'pass a Zod schema instance' });
  try {
    const target = options.target ?? 'openapi-3.1';
    const warnings: ZopiaWarning[] = [];
    const result = convert(schema, target, options, warnings);
    const collector = new ZopiaWarningCollector(); collector.addAll(warnings);
    for (const warning of collector.toArray()) options.onWarning?.(warning);
    return result;
  } catch (error) {
    throw asZopiaError(error, 'ZOPIA_SCHEMA_INVALID', 'unable to convert Zod schema', { at: '#', hint: 'check the Zod schema and conversion options' });
  }
}

/** Convert a named set of Zod schemas while preserving references between them. */
export function zodSchemasToJsonSchema(
  schemas: Iterable<readonly [string, z.ZodType]>,
  options: InternalZodToJsonSchemaOptions = {},
  uri: (name: string) => string = (name) => name,
): Record<string, Record<string, unknown>> {
  validateConversionOptions(options, true);
  if (typeof uri !== 'function') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'schema URI mapper must be a function', { at: 'uri' });
  try {
    const target = options.target ?? 'openapi-3.1';
    const zodTarget = zodTargetFor(target);
    const entries = [...schemas];
    for (const [name, schema] of entries) {
      if (typeof name !== 'string' || !name) throw new ZopiaError('ZOPIA_SCHEMA_INVALID', 'named Zod schemas require non-empty names', { at: 'schemas' });
      if (!isZodSchema(schema)) throw new ZopiaError('ZOPIA_SCHEMA_INVALID', `invalid named Zod schema: ${name}`, { at: name, hint: 'pass Zod 4 schema instances' });
    }
    const registry = z.registry<{ id?: string }>();
    for (const [name, schema] of entries) registry.add(schema, { id: name });

    const warnings: ZopiaWarning[] = [];
    const unrepresentable = new WeakSet<object>();
    const owners = indexNamedSchemaOwners(entries);
    const converted = z.toJSONSchema(registry, {
      target: zodTarget,
      io: options.io ?? 'output',
      uri,
      metadata: metadataWithoutIds(),
      unrepresentable: warningHandler(warnings, unrepresentable, owners),
      override: ({ zodSchema, jsonSchema }) => finalizeZodNode(zodSchema, jsonSchema, unrepresentable),
    }).schemas as Record<string, Record<string, unknown>>;

    const result: Record<string, Record<string, unknown>> = {};
    for (const [name, schema] of Object.entries(converted)) {
      finalizeDialect(schema, target, options.$schema);
      delete schema.$id;
      define(result, name, canonicalizeSchema(schema));
    }
    const collector = new ZopiaWarningCollector(); collector.addAll(warnings);
    for (const warning of collector.toArray()) options.onWarning?.(warning);
    return result;
  } catch (error) {
    throw asZopiaError(error, 'ZOPIA_SCHEMA_INVALID', 'unable to convert named Zod schemas', { at: 'schemas', hint: 'check schema names, values, and references' });
  }
}

function convert(
  schema: z.ZodType,
  target: ZodJsonSchemaTarget,
  options: ZodToJsonSchemaOptions,
  warnings: ZopiaWarning[],
): Record<string, unknown> {
  const unrepresentable = new WeakSet<object>();
  const result = z.toJSONSchema(schema, {
    target: zodTargetFor(target),
    io: options.io ?? 'output',
    metadata: metadataWithoutIds(),
    unrepresentable: warningHandler(warnings, unrepresentable),
    override: ({ zodSchema, jsonSchema }) => finalizeZodNode(zodSchema, jsonSchema, unrepresentable),
  }) as Record<string, unknown>;
  finalizeDialect(result, target, options.$schema);
  return canonicalizeSchema(result);
}

function zodTargetFor(target: InternalZodJsonSchemaTarget): 'draft-4' | 'draft-07' | 'draft-2020-12' | 'openapi-3.0' {
  return target === 'openapi-3.1' ? 'draft-2020-12' : target;
}

function warningHandler(warnings: ZopiaWarning[], unrepresentable: WeakSet<object>, owners?: WeakMap<object, Set<string>>) {
  return ({ zodSchema, path, message }: { zodSchema: z.core.$ZodType; path: (string | number)[]; message: string }): 'any' => {
    unrepresentable.add(zodSchema);
    const names = owners?.get(zodSchema);
    if (names?.size) for (const name of names) warnings.push({
      code: 'ZOPIA_WARN_UNREPRESENTABLE',
      at: jsonPointer([name, ...path]),
      message,
    });
    else warnings.push({
      code: 'ZOPIA_WARN_UNREPRESENTABLE',
      ...(path.length === 0 ? {} : { at: jsonPointer(path) }),
      message,
    });
    return 'any';
  };
}

function indexNamedSchemaOwners(entries: Array<readonly [string, z.ZodType]>): WeakMap<object, Set<string>> {
  const owners = new WeakMap<object, Set<string>>();
  const roots = new WeakSet<object>(entries.map(([, schema]) => schema));
  for (const [name, root] of entries) {
    const seen = new WeakSet<object>();
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const record = value as Record<string, unknown>;
      if (record._zod && typeof record._zod === 'object') {
        if (value !== root && roots.has(value)) return;
        const names = owners.get(value) ?? new Set<string>();
        names.add(name);
        owners.set(value, names);
        visit((record._zod as Record<string, unknown>).def);
        return;
      }
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value instanceof Map || value instanceof Set) for (const child of value.values()) visit(child);
      else for (const child of Object.values(record)) visit(child);
    };
    visit(root);
  }
  return owners;
}

function jsonPointer(path: (string | number)[]): string {
  return `#/${path.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

function metadataWithoutIds(): typeof z.globalRegistry {
  return {
    get(schema: z.core.$ZodType): Record<string, unknown> | undefined {
      const metadata = z.globalRegistry.get(schema);
      if (!metadata) return undefined;
      const copy: Record<string, unknown> = { ...metadata };
      delete copy.id;
      return copy;
    },
  } as typeof z.globalRegistry;
}

function finalizeZodNode(
  schema: z.core.$ZodType,
  jsonSchema: Record<string, unknown>,
  unrepresentable: WeakSet<object>,
): void {
  if (unrepresentable.has(schema)) {
    for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
    return;
  }

  stripSafeIntegerBounds(jsonSchema);
  stripBuiltInFormatPattern(schema, jsonSchema);
}

function stripSafeIntegerBounds(schema: Record<string, unknown>): void {
  if (schema.minimum === -MAX_SAFE_INTEGER) delete schema.minimum;
  if (schema.maximum === MAX_SAFE_INTEGER) delete schema.maximum;
}

function stripBuiltInFormatPattern(schema: z.core.$ZodType, jsonSchema: Record<string, unknown>): void {
  const format = typeof jsonSchema.format === 'string' ? jsonSchema.format : undefined;
  if (!format || !KNOWN_FORMATS.has(format)) return;

  const patterns = builtInPatternsFor(schema, format);
  if (patterns.size === 0) return;
  if (typeof jsonSchema.pattern === 'string' && patterns.has(jsonSchema.pattern)) delete jsonSchema.pattern;

  if (!Array.isArray(jsonSchema.allOf)) return;
  const remaining = jsonSchema.allOf.filter((member) => {
    if (!isRecord(member) || typeof member.pattern !== 'string' || !patterns.has(member.pattern)) return true;
    const keys = Object.keys(member);
    return !keys.every((key) => key === 'type' || key === 'pattern') || (member.type !== undefined && member.type !== 'string');
  });
  if (remaining.length === 0) delete jsonSchema.allOf;
  else jsonSchema.allOf = remaining;
}

function builtInPatternsFor(schema: z.core.$ZodType, outputFormat: string): Set<string> {
  const patterns = new Set<string>();
  const definition = schema._zod.def as unknown as Record<string, unknown>;
  const checks = [
    ...(definition.check === 'string_format' ? [schema] : []),
    ...(Array.isArray(definition.checks) ? definition.checks : []),
  ];

  for (const check of checks) {
    if (!isRecord(check) || !isRecord(check._zod) || !isRecord(check._zod.def)) continue;
    const checkDefinition = check._zod.def;
    if (checkDefinition.check !== 'string_format') continue;
    const checkFormat = normalizedFormat(checkDefinition.format);
    const pattern = checkDefinition.pattern;
    if (checkFormat === outputFormat && pattern instanceof RegExp) patterns.add(pattern.source);
  }
  return patterns;
}

function normalizedFormat(format: unknown): string | undefined {
  if (format === 'guid') return 'uuid';
  if (format === 'url') return 'uri';
  if (format === 'datetime') return 'date-time';
  return typeof format === 'string' ? format : undefined;
}

function finalizeDialect(
  result: Record<string, unknown>,
  target: InternalZodJsonSchemaTarget,
  includeDialect: boolean | undefined,
): void {
  const include = includeDialect ?? true;
  if (!include) {
    delete result.$schema;
    return;
  }

  if (target === 'openapi-3.0') result.$schema = 'http://json-schema.org/draft-07/schema#';
  else if (target === 'openapi-3.1') result.$schema = 'https://json-schema.org/draft/2020-12/schema';
}

function collapseRedundantLiteralIntersection(schema: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(schema).length !== 1 || !Array.isArray(schema.allOf) || schema.allOf.length !== 2) return schema;
  const [base, literal] = schema.allOf;
  if (!isRecord(base) || !isRecord(literal) || Object.keys(base).length !== 1 || base.type !== literal.type || !Object.prototype.hasOwnProperty.call(literal, 'const')) return schema;
  return { ...literal };
}

function canonicalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const collapsed = collapseRedundantLiteralIntersection(schema);
  const normalized = { ...collapsed };
  if (isRecord(normalized.properties) && Object.keys(normalized.properties).length === 0) delete normalized.properties;
  if (isRecord(normalized.propertyNames) && Object.keys(normalized.propertyNames).length === 1 && normalized.propertyNames.type === 'string') delete normalized.propertyNames;
  const result: Record<string, unknown> = {};
  const entries = Object.entries(normalized).sort(([left], [right]) => {
    const leftRank = KEY_RANK.get(left) ?? Number.POSITIVE_INFINITY;
    const rightRank = KEY_RANK.get(right) ?? Number.POSITIVE_INFINITY;
    return leftRank - rightRank || (left < right ? -1 : left > right ? 1 : 0);
  });

  for (const [key, value] of entries) define(result, key, canonicalizeKeywordValue(key, value));
  return result;
}

function canonicalizeKeywordValue(key: string, value: unknown): unknown {
  if (SCHEMA_MAP_KEYS.has(key) && isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [name, schema] of Object.entries(value)) {
      define(result, name, isRecord(schema) ? canonicalizeSchema(schema) : schema);
    }
    return result;
  }

  if ((key === 'items' || SCHEMA_ARRAY_KEYS.has(key)) && Array.isArray(value)) {
    return value.map((schema) => isRecord(schema) ? canonicalizeSchema(schema) : schema);
  }
  if ((key === 'items' || SCHEMA_VALUE_KEYS.has(key)) && isRecord(value)) return canonicalizeSchema(value);

  if (key === 'dependencies' && isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [name, dependency] of Object.entries(value)) {
      define(result, name, isRecord(dependency) ? canonicalizeSchema(dependency) : dependency);
    }
    return result;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
