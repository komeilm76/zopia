import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ZopiaWarning } from '../warnings';

/** A JSON Schema object or boolean schema. */
export type JsonSchema = Record<string, any> | boolean;

/** A manifest-compatible restoration for schema facts that Zod cannot serialize exactly. */
export interface JsonSchemaOverlay {
  /** RFC 6901 pointer relative to the converted schema; the empty string addresses its root. */
  at: string;
  /** Keywords to restore on the runtime-generated schema object. */
  set?: Record<string, unknown>;
  /** Runtime-generated keywords to remove before applying `set`. */
  remove?: string[];
  /** Original subtree to restore verbatim when code edits cannot safely propagate. */
  node?: JsonSchema;
}

/** Options controlling JSON-Schema-to-Zod conversion. */
export interface JsonSchemaToZodOptions {
  /** Identifier used by the emitted root declaration. @default 'schema' */
  rootName?: string;
}

/** Executable Zod output plus every non-fatal diagnostic and round-trip restoration. */
export interface JsonSchemaToZodResult {
  /** TypeScript source containing local definitions and the named root declaration. */
  code: string;
  /** Runtime schema equivalent to `code`. */
  schema: z.ZodType;
  /** Structured warnings for malformed, approximated, or frozen source constructs. */
  warnings: ZopiaWarning[];
  /** Manifest-compatible restorations for non-identity mappings. */
  overlays: JsonSchemaOverlay[];
}

interface AnalysisWarning extends ZopiaWarning { keyword: string; }

const pointer = (at: string, token: string | number): string => `${at}/${String(token).replace(/~/g, '~0').replace(/\//g, '~1')}`;
const warningAt = (at: string): string => at === '' ? '#' : `#${at}`;
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isSchemaValue = (value: unknown): value is JsonSchema => typeof value === 'boolean' || (value !== null && typeof value === 'object' && !Array.isArray(value));

function analyzeSchema(source: JsonSchema): { warnings: AnalysisWarning[]; overlays: JsonSchemaOverlay[] } {
  const warnings: AnalysisWarning[] = [];
  const overlays: JsonSchemaOverlay[] = [];
  const warn = (code: string, at: string, keyword: string, message: string): void => {
    warnings.push({ code, at: warningAt(at), keyword, message });
  };
  const addOverlay = (entry: JsonSchemaOverlay): void => {
    const frozenParent = overlays.find((existing) => Object.prototype.hasOwnProperty.call(existing, 'node') && (existing.at === '' || entry.at === existing.at || entry.at.startsWith(`${existing.at}/`)));
    if (frozenParent) return;
    if (Object.prototype.hasOwnProperty.call(entry, 'node')) {
      for (let index = overlays.length - 1; index >= 0; index -= 1) if (overlays[index].at === entry.at || overlays[index].at.startsWith(`${entry.at}/`)) overlays.splice(index, 1);
      overlays.push(entry);
      return;
    }
    const existing = overlays.find((candidate) => candidate.at === entry.at && !Object.prototype.hasOwnProperty.call(candidate, 'node'));
    if (!existing) { overlays.push(entry); return; }
    if (entry.set) existing.set = { ...(existing.set ?? {}), ...entry.set };
    if (entry.remove) existing.remove = [...new Set([...(existing.remove ?? []), ...entry.remove])].filter((key) => !Object.prototype.hasOwnProperty.call(existing.set ?? {}, key));
  };
  const freeze = (node: Record<string, any>, at: string, code: string, keyword: string, message: string): void => {
    warn(code, at, keyword, message);
    addOverlay({ at, node: cloneJson(node) });
  };
  const visit = (node: JsonSchema, at = ''): void => {
    if (typeof node === 'boolean') return;

    if (Object.prototype.hasOwnProperty.call(node, 'not')) {
      freeze(node, at, 'ZOPIA_WARN_NOT', 'not', '`not` is enforced by a Zod refinement and frozen for exact reverse conversion');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'allOf')) {
      freeze(node, at, 'ZOPIA_WARN_FROZEN_SUBTREE', 'allOf', '`allOf` structure is frozen because Zod intersections can serialize with a different shape');
      return;
    }
    if (['if', 'then', 'else'].some((key) => Object.prototype.hasOwnProperty.call(node, key))) {
      freeze(node, at, 'ZOPIA_WARN_FROZEN_SUBTREE', 'if', 'conditional schema structure is frozen because Zod has no serializable conditional equivalent');
      return;
    }
    const refinementKeyword = ['patternProperties', 'propertyNames', 'minProperties', 'maxProperties', 'contains', 'minContains', 'maxContains', 'dependencies', 'dependentRequired', 'dependentSchemas'].find((key) => Object.prototype.hasOwnProperty.call(node, key));
    if (refinementKeyword) {
      freeze(node, at, 'ZOPIA_WARN_FROZEN_SUBTREE', refinementKeyword, `\`${refinementKeyword}\` is implemented with runtime refinements and frozen for exact reverse conversion`);
      return;
    }

    if (Array.isArray(node.oneOf)) {
      warn('ZOPIA_WARN_ONE_OF', at, 'oneOf', '`oneOf` requires an overlay because Zod unions do not serialize exclusivity and discriminator metadata identically');
      addOverlay({ at, set: { oneOf: cloneJson(node.oneOf), ...(node.discriminator === undefined ? {} : { discriminator: cloneJson(node.discriminator) }) }, remove: ['anyOf'] });
    }
    if (node.uniqueItems === true) {
      warn('ZOPIA_WARN_UNIQUE_ITEMS', at, 'uniqueItems', '`uniqueItems` is enforced by a refinement and restored by an overlay');
      addOverlay({ at, set: { uniqueItems: true } });
    }

    for (const [name, bound] of [['exclusiveMinimum', node.exclusiveMinimum], ['exclusiveMaximum', node.exclusiveMaximum]] as const) {
      if (bound !== true) continue;
      warn('ZOPIA_WARN_LEGACY_EXCLUSIVE_BOUND', at, name, `legacy boolean \`${name}\` is approximated by a Zod numeric bound`);
      const inclusive = name === 'exclusiveMinimum' ? 'minimum' : 'maximum';
      addOverlay({ at, set: { [name]: true, ...(Object.prototype.hasOwnProperty.call(node, inclusive) ? { [inclusive]: node[inclusive] } : {}) } });
    }

    if (typeof node.format === 'string') {
      const exact = new Set(['email', 'uuid', 'hostname', 'ipv4', 'ipv6', 'date-time', 'date', 'duration', 'uri']);
      const acceptsString = node.type === undefined || node.type === 'string' || (Array.isArray(node.type) && node.type.includes('string'));
      const aliases: Record<string, { set: Record<string, unknown>; remove?: string[]; code?: string }> = {
        url: { set: { format: 'url' }, code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        time: { set: { format: 'time' }, remove: ['pattern'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        byte: { set: { format: 'byte' }, remove: ['pattern', 'contentEncoding'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        base64: { set: { format: 'base64' }, remove: ['pattern', 'contentEncoding'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        base64url: { set: { format: 'base64url' }, remove: ['pattern', 'contentEncoding'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        emoji: { set: { format: 'emoji' }, remove: ['pattern'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        int32: { set: { format: 'int32' }, remove: ['minimum', 'maximum'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        int64: { set: { format: 'int64' }, remove: ['minimum', 'maximum'], code: 'ZOPIA_WARN_INT64' },
        uint32: { set: { format: 'uint32' }, remove: ['minimum', 'maximum'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
        uint64: { set: { format: 'uint64' }, remove: ['minimum', 'maximum'], code: 'ZOPIA_WARN_CUSTOM_FORMAT' },
      };
      const alias = aliases[node.format];
      if (alias) {
        warn(alias.code ?? 'ZOPIA_WARN_CUSTOM_FORMAT', at, 'format', `format \`${node.format}\` requires an overlay for exact reverse conversion`);
        const sourceKeywords = Object.fromEntries((alias.remove ?? []).filter((key) => Object.prototype.hasOwnProperty.call(node, key)).map((key) => [key, cloneJson(node[key])]));
        const remove = (alias.remove ?? []).filter((key) => !Object.prototype.hasOwnProperty.call(node, key));
        addOverlay({ at, set: { ...alias.set, ...sourceKeywords }, ...(remove.length ? { remove } : {}) });
      } else if (!exact.has(node.format) || !acceptsString) {
        warn('ZOPIA_WARN_CUSTOM_FORMAT', at, 'format', `format \`${node.format}\` has no exact Zod representation for this schema type`);
        addOverlay({ at, set: { format: node.format } });
      }
    }

    if (node.contentEncoding !== undefined) {
      const acceptsString = node.type === undefined || node.type === 'string' || (Array.isArray(node.type) && node.type.includes('string'));
      const supported = acceptsString && ['base64', 'base64url'].includes(String(node.contentEncoding));
      if (supported) addOverlay({ at, set: { contentEncoding: node.contentEncoding }, remove: ['format', 'pattern'] });
      else if (node.contentEncoding === 'hex' && acceptsString) {
        warn('ZOPIA_WARN_CONTENT_ENCODING', at, 'contentEncoding', '`hex` content encoding is enforced by a pattern and restored by an overlay');
        addOverlay({ at, set: { contentEncoding: 'hex' }, remove: ['pattern'] });
      } else {
        warn('ZOPIA_WARN_CONTENT_ENCODING', at, 'contentEncoding', `content encoding \`${String(node.contentEncoding)}\` has no exact Zod representation for this schema type`);
        addOverlay({ at, set: { contentEncoding: cloneJson(node.contentEncoding) } });
      }
    }
    if (Object.prototype.hasOwnProperty.call(node, 'contentMediaType')) {
      warn('ZOPIA_WARN_CONTENT_ENCODING', at, 'contentMediaType', '`contentMediaType` is annotation-only in Zod and restored by an overlay');
      addOverlay({ at, set: { contentMediaType: cloneJson(node.contentMediaType) } });
    }
    if (Object.prototype.hasOwnProperty.call(node, 'example') && !Object.prototype.hasOwnProperty.call(node, 'examples')) {
      addOverlay({ at, set: { example: cloneJson(node.example) }, remove: ['examples'] });
    }
    const ignored = Object.fromEntries(['$schema', '$id', '$comment'].filter((key) => Object.prototype.hasOwnProperty.call(node, key)).map((key) => [key, cloneJson(node[key])]));
    if (Object.keys(ignored).length) addOverlay({ at, set: ignored });

    const applicableKeywords = new Set([
      'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties', 'dependencies', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties',
      'items', 'prefixItems', 'additionalItems', 'unevaluatedItems', 'contains', 'minContains', 'maxContains', 'minItems', 'maxItems', 'uniqueItems',
      'minLength', 'maxLength', 'pattern', 'format', 'contentEncoding', 'contentMediaType',
      'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    ]);
    if (node.type === undefined && Object.keys(node).some((key) => applicableKeywords.has(key))) {
      freeze(node, at, 'ZOPIA_WARN_FROZEN_SUBTREE', 'type', 'keyword-only schema applicability is emitted as a Zod union and frozen for exact reverse conversion');
      return;
    }
    if (Array.isArray(node.type)) {
      freeze(node, at, 'ZOPIA_WARN_FROZEN_SUBTREE', 'type', 'type-array structure is emitted as a Zod union and frozen for exact reverse conversion');
      return;
    }

    const visitChild = (key: string, value: unknown): void => { if (isSchemaValue(value)) visit(value, pointer(at, key)); };
    if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) for (const [key, child] of Object.entries(node.properties)) if (isSchemaValue(child)) visit(child, pointer(pointer(at, 'properties'), key));
    if (node.patternProperties && typeof node.patternProperties === 'object' && !Array.isArray(node.patternProperties)) for (const [key, child] of Object.entries(node.patternProperties)) if (isSchemaValue(child)) visit(child, pointer(pointer(at, 'patternProperties'), key));
    for (const key of ['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else'] as const) visitChild(key, node[key]);
    for (const key of ['items', 'prefixItems', 'allOf', 'anyOf', 'oneOf'] as const) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child, index) => { if (isSchemaValue(child)) visit(child, pointer(pointer(at, key), index)); });
      else visitChild(key, value);
    }
    for (const key of ['$defs', 'definitions', 'dependentSchemas'] as const) if (node[key] && typeof node[key] === 'object' && !Array.isArray(node[key])) for (const [name, child] of Object.entries(node[key])) if (isSchemaValue(child)) visit(child, pointer(pointer(at, key), name));
  };
  visit(source);
  return { warnings, overlays };
}

function warningCode(message: string): string {
  if (message.startsWith('oneOf')) return 'ZOPIA_WARN_ONE_OF';
  if (message.startsWith('Unsupported format:')) return 'ZOPIA_WARN_CUSTOM_FORMAT';
  if (message.includes('$ref')) return 'ZOPIA_WARN_REF';
  if (message.startsWith('Unsupported contentEncoding:')) return 'ZOPIA_WARN_CONTENT_ENCODING';
  return 'ZOPIA_WARN_INVALID_SCHEMA';
}

function warningKeyword(message: string): string {
  const match = message.match(/(?:Invalid|Unsupported) ([A-Za-z$][A-Za-z0-9$]*)/);
  return match?.[1] ?? (message.includes('$ref') ? '$ref' : 'schema');
}

function warningComment(warning: AnalysisWarning): string {
  const message = warning.message.replace(/[\r\n\u2028\u2029]+/g, ' ');
  return `// @zopia:warn ${warning.code} ${warning.keyword} — ${message}${warning.at ? ` (${warning.at})` : ''}`;
}

/** Convert a JSON Schema value, JSON text, or `.json` file into executable Zod 4 code and a runtime schema. */
export function jsonSchemaToZod(input: JsonSchema | string, options: JsonSchemaToZodOptions = {}): JsonSchemaToZodResult {
  const rootName = options.rootName ?? 'schema';
  const reservedNames = new Set(['arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rootName) || reservedNames.has(rootName)) throw new TypeError(`Invalid rootName: ${rootName}`);
  const warningMessages: string[] = [];
  const isSchema = (value: unknown): value is JsonSchema => typeof value === 'boolean' || (value !== null && typeof value === 'object' && !Array.isArray(value));
  const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const isNonNegativeInteger = (value: unknown): value is number => isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
  const canonicalJson = (value: unknown): string | undefined => {
    try { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
    catch { return undefined; }
  };
  let source: JsonSchema;
  try {
    if (typeof input !== 'string') source = input;
    else {
      const text = input.toLowerCase().endsWith('.json') ? readFileSync(input, 'utf8') : input;
      source = JSON.parse(text) as JsonSchema;
    }
  } catch (error) { throw new TypeError(`Invalid JSON Schema input: ${error instanceof Error ? error.message : String(error)}`); }
  if (!isSchema(source)) throw new TypeError('Invalid JSON Schema input: expected an object or boolean schema');
  const analysis = analyzeSchema(source);
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
  type Converted = { schema: z.ZodType; code: string };
  let convert: (node: JsonSchema, resolving?: Set<string>) => Converted;
  const definitionEntries: Array<{ ref: string; name: string; schema: JsonSchema }> = [];
  const usedNames = new Set([rootName]);
  if (typeof source === 'object') for (const keyword of ['$defs', 'definitions'] as const) {
    const definitions = source[keyword];
    if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) continue;
    for (const [rawName, definition] of Object.entries(definitions)) {
      if (!isSchema(definition)) continue;
      const words = rawName.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
      let name = words.map((word, index) => index === 0 ? word[0]?.toLowerCase() + word.slice(1) : word[0]?.toUpperCase() + word.slice(1)).join('') || 'definition';
      if (!/^[A-Za-z_$]/.test(name) || reservedNames.has(name)) name = `definition${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`;
      const base = name; let suffix = 2;
      while (usedNames.has(name)) name = `${base}${suffix++}`;
      usedNames.add(name);
      definitionEntries.push({ ref: `#/${keyword}/${rawName.replace(/~/g, '~0').replace(/\//g, '~1')}`, name, schema: definition });
    }
  }
  const definitionNames = new Map(definitionEntries.map((entry) => [entry.ref, entry.name]));
  const usedDefinitionRefs = new Set<string>();
  const definitionResults = new Map<string, Converted>();
  let rootResult: Converted | undefined;

  const convertCore = (node: JsonSchema, resolving = new Set<string>()): Converted => {
    if (node === true) return { schema: z.any(), code: 'z.any()' };
    if (node === false) return { schema: z.never(), code: 'z.never()' };
    if (!node || typeof node !== 'object' || Array.isArray(node)) { warningMessages.push('Schema node is not an object'); return { schema: z.any(), code: 'z.any()' }; }
    if ('$ref' in node) {
      if (typeof node.$ref !== 'string' || node.$ref.length === 0) { warningMessages.push('Invalid $ref: expected a non-empty string'); return { schema: z.any(), code: 'z.any()' }; }
      const ref = node.$ref; const target = resolveLocalRef(ref);
      if (!target) { warningMessages.push(`Unsupported $ref: ${ref}`); return { schema: z.any(), code: 'z.any()' }; }
      const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => !['$ref', '$defs', 'definitions', '$schema', '$id', '$comment', 'title', 'description', 'examples', 'example'].includes(key)));
      const definitionName = definitionNames.get(ref);
      if (definitionName) {
        usedDefinitionRefs.add(ref);
        const referenced: Converted = { schema: z.lazy(() => definitionResults.get(ref)?.schema ?? z.never()), code: `z.lazy(() => ${definitionName})` };
        if (Object.keys(siblings).length === 0) return referenced;
        const sibling = convert(siblings);
        return { schema: referenced.schema.and(sibling.schema), code: `${referenced.code}.and(${sibling.code})` };
      }
      if (ref === '#') {
        const referenced: Converted = { schema: z.lazy(() => rootResult?.schema ?? z.never()), code: `z.lazy(() => ${rootName})` };
        if (Object.keys(siblings).length === 0) return referenced;
        const sibling = convert(siblings);
        return { schema: referenced.schema.and(sibling.schema), code: `${referenced.code}.and(${sibling.code})` };
      }
      if (resolving.has(ref)) { warningMessages.push(`Recursive $ref cannot be materialized outside a named definition: ${ref}`); return { schema: z.any(), code: 'z.any()' }; }
      const targetAny: any = target;
      const resolved: JsonSchema = Object.keys(siblings).length
        ? targetAny === true ? siblings : targetAny === false ? false : { ...targetAny, ...siblings }
        : targetAny;
      return convert(resolved, new Set(resolving).add(ref));
    }
    if (node.nullable !== undefined) {
      const withoutNullable = Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'nullable')) as JsonSchema;
      if (typeof node.nullable !== 'boolean') { warningMessages.push('Invalid nullable: expected a boolean'); return convert(withoutNullable, resolving); }
      const converted = convert(withoutNullable, resolving);
      return node.nullable ? { schema: converted.schema.nullable(), code: `${converted.code}.nullable()` } : converted;
    }
    if (Array.isArray(node.type)) {
      const allowedTypes = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
      if (node.type.length === 0 || !node.type.every((type: unknown) => typeof type === 'string' && allowedTypes.has(type))) { warningMessages.push('Invalid type: expected a non-empty array of valid JSON Schema type names'); return { schema: z.any(), code: 'z.any()' }; }
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
    const withSiblings = (keyword: string, constrained: { schema: z.ZodType; code: string }, ignored: string[] = []): { schema: z.ZodType; code: string } => {
      const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== keyword && !ignored.includes(key)));
      if (Object.keys(siblings).length === 0) return constrained;
      const sibling = convert(siblings, resolving);
      return { schema: (sibling.schema as any).and(constrained.schema), code: `${sibling.code}.and(${constrained.code})` };
    };
    const literalSchema = (value: unknown, keyword: 'enum' | 'const'): { schema: z.ZodType; code: string } | undefined => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)) return { schema: z.literal(value as any), code: `z.literal(${JSON.stringify(value)})` };
      if (value && typeof value === 'object') {
        const canonical = canonicalJson(value);
        if (canonical !== undefined) return {
          schema: z.any().refine((candidate) => canonicalJson(candidate) === canonical).meta({ [keyword]: value }),
          code: `z.any().refine((value) => { try { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item) === ${JSON.stringify(canonical)}; } catch { return false; } }).meta({ ${keyword}: ${JSON.stringify(value)} })`,
        };
      }
      warningMessages.push(`Invalid ${keyword} value: expected a JSON value`);
      return undefined;
    };
    if ('oneOf' in node || 'anyOf' in node) {
      const key = 'oneOf' in node ? 'oneOf' : 'anyOf';
      if (!Array.isArray(node[key])) { warningMessages.push(`Invalid ${key}: expected an array`); return withSiblings(key, { schema: z.any(), code: 'z.any()' }); }
      const items = node[key].map((child: JsonSchema) => convert(child, resolving));
      const propertyName = key === 'oneOf' && node.discriminator && typeof node.discriminator === 'object' && typeof node.discriminator.propertyName === 'string' ? node.discriminator.propertyName : undefined;
      const discriminated = propertyName !== undefined && (node[key] as JsonSchema[]).every((child) => {
        const resolved = typeof child === 'object' && typeof child.$ref === 'string' ? resolveLocalRef(child.$ref) : child;
        if (!resolved || typeof resolved === 'boolean' || resolved.type !== 'object' || !resolved.properties || typeof resolved.properties !== 'object') return false;
        const discriminator = resolved.properties[propertyName];
        return discriminator && typeof discriminator === 'object' && (Object.prototype.hasOwnProperty.call(discriminator, 'const') || Array.isArray(discriminator.enum));
      });
      let combined: Converted;
      if (discriminated && items.length > 1) {
        try {
          combined = {
            schema: z.discriminatedUnion(propertyName!, items.map((item) => item.schema) as any),
            code: `z.discriminatedUnion(${JSON.stringify(propertyName)}, [${items.map((item) => item.code).join(', ')}])`,
          };
        } catch {
          warningMessages.push('oneOf discriminator could not be represented by z.discriminatedUnion; z.union was used');
          combined = { schema: z.union(items.map((item) => item.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${items.map((item) => item.code).join(', ')}])` };
        }
      } else {
        if (key === 'oneOf') warningMessages.push('oneOf is approximated by z.union and does not enforce exclusivity');
        combined = items.length === 0
          ? { schema: z.never(), code: 'z.never()' }
          : items.length === 1
            ? items[0]
            : { schema: z.union(items.map((item: { schema: z.ZodType }) => item.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]), code: `z.union([${items.map((item: { code: string }) => item.code).join(', ')}])` };
      }
      return withSiblings(key, combined, propertyName ? ['discriminator'] : []);
    }
    if ('allOf' in node) {
      if (!Array.isArray(node.allOf)) { warningMessages.push('Invalid allOf: expected an array'); return withSiblings('allOf', { schema: z.any(), code: 'z.any()' }); }
      const items = node.allOf.map((child: JsonSchema) => convert(child, resolving));
      const combined = items.length === 0
        ? { schema: z.any(), code: 'z.any()' }
        : { schema: items.slice(1).reduce((acc: any, item: { schema: z.ZodType }) => acc.and(item.schema), items[0].schema as any), code: items.slice(1).reduce((code: string, item: { code: string }) => `${code}.and(${item.code})`, items[0].code) };
      return withSiblings('allOf', combined);
    }
    if ('enum' in node) {
      if (!Array.isArray(node.enum)) { warningMessages.push('Invalid enum: expected an array'); return withSiblings('enum', { schema: z.any(), code: 'z.any()' }); }
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
    const keywordGroups = [
      { type: 'object', keywords: new Set(['properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties', 'dependencies', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties']) },
      { type: 'array', keywords: new Set(['items', 'prefixItems', 'additionalItems', 'unevaluatedItems', 'contains', 'minContains', 'maxContains', 'minItems', 'maxItems', 'uniqueItems']) },
      { type: 'string', keywords: new Set(['minLength', 'maxLength', 'pattern', 'format', 'contentEncoding', 'contentMediaType']) },
      { type: 'number', keywords: new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) },
    ] as const;
    const numberFormats = new Set(['int32', 'int64', 'uint32', 'uint64']);
    const keywordGroup = node.type === undefined
      ? numberFormats.has(String(node.format)) ? keywordGroups[3] : keywordGroups.find((group) => Object.keys(node).some((key) => group.keywords.has(key)))
      : undefined;
    if (keywordGroup) {
      const typedNode = { type: keywordGroup.type, ...Object.fromEntries(Object.entries(node).filter(([key]) => keywordGroup.keywords.has(key))) } as JsonSchema;
      const typedResult = convert(typedNode, resolving);
      const jsonTypes = [
        { type: 'object', schema: z.object({}).passthrough(), code: 'z.object({}).passthrough()' },
        { type: 'array', schema: z.array(z.any()), code: 'z.array(z.any())' },
        { type: 'string', schema: z.string(), code: 'z.string()' },
        { type: 'number', schema: z.number(), code: 'z.number()' },
        { type: 'boolean', schema: z.boolean(), code: 'z.boolean()' },
        { type: 'null', schema: z.null(), code: 'z.null()' },
      ];
      const alternatives = [{ type: keywordGroup.type, schema: typedResult.schema, code: typedResult.code }, ...jsonTypes.filter((candidate) => candidate.type !== keywordGroup.type)];
      const applicable = {
        schema: z.union(alternatives.map((candidate) => candidate.schema) as [z.ZodType, z.ZodType, ...z.ZodType[]]),
        code: `z.union([${alternatives.map((candidate) => candidate.code).join(', ')}])`,
      };
      const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => !keywordGroup.keywords.has(key)));
      if (Object.keys(siblings).length === 0) return applicable;
      const siblingResult = convert(siblings, resolving);
      return { schema: (siblingResult.schema as any).and(applicable.schema), code: `${siblingResult.code}.and(${applicable.code})` };
    }
    let result: { schema: z.ZodType; code: string };
    switch (node.type) {
      case 'object': {
        if (node.properties !== undefined && (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties))) { warningMessages.push('Invalid properties: expected an object'); result = { schema: z.object({}).passthrough(), code: 'z.object({}).passthrough()' }; break; }
        const requiredKeys = Array.isArray(node.required) && node.required.every((key: unknown) => typeof key === 'string') ? node.required as string[] : [];
        if (node.required !== undefined && (!Array.isArray(node.required) || requiredKeys.length !== node.required.length)) warningMessages.push('Invalid required: expected an array of strings');
        const patternPropertiesValid = node.patternProperties === undefined || (node.patternProperties !== null && typeof node.patternProperties === 'object' && !Array.isArray(node.patternProperties));
        if (!patternPropertiesValid) warningMessages.push('Invalid patternProperties: expected an object');
        const additionalPropertiesValid = node.additionalProperties === undefined || isSchema(node.additionalProperties);
        if (!additionalPropertiesValid) warningMessages.push('Invalid additionalProperties: expected a schema');
        const unevaluatedPropertiesValid = node.unevaluatedProperties === undefined || isSchema(node.unevaluatedProperties);
        if (!unevaluatedPropertiesValid) warningMessages.push('Invalid unevaluatedProperties: expected a schema');
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
        if (!prefixItemsValid) warningMessages.push('Invalid prefixItems: expected an array of schemas');
        const itemsValid = node.items === undefined || Array.isArray(node.items) || isSchema(node.items);
        if (!itemsValid) warningMessages.push('Invalid items: expected a schema or tuple array');
        const additionalItemsValid = node.additionalItems === undefined || isSchema(node.additionalItems);
        if (!additionalItemsValid) warningMessages.push('Invalid additionalItems: expected a schema');
        const unevaluatedItemsValid = node.unevaluatedItems === undefined || isSchema(node.unevaluatedItems);
        if (!unevaluatedItemsValid) warningMessages.push('Invalid unevaluatedItems: expected a schema');
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
        if (node.type !== undefined) warningMessages.push(`Unsupported JSON Schema type: ${String(node.type)}`);
        result = { schema: z.any(), code: 'z.any()' };
    }
    if (Object.prototype.hasOwnProperty.call(node, 'not')) {
      if (!isSchema(node.not)) warningMessages.push('Invalid not: expected a schema');
      else if (node.not !== false) {
        const excluded = convert(node.not, resolving);
        result = { schema: result.schema.refine((value: unknown) => !excluded.schema.safeParse(value).success), code: `${result.code}.refine((value) => !(${excluded.code}).safeParse(value).success)` };
      }
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
      const formats: Record<string, { schema: (s: any) => any; code: string; replace?: boolean }> = {
        email: { schema: (s) => s.email(), code: 'email()' },
        uuid: { schema: (s) => s.uuid(), code: 'uuid()' },
        uri: { schema: (s) => s.url(), code: 'url()' },
        url: { schema: (s) => s.url(), code: 'url()' },
        'date-time': { schema: (s) => s.datetime(), code: 'datetime()' },
        date: { schema: (s) => s.date(), code: 'date()' },
        hostname: { schema: () => z.hostname(), code: 'z.hostname()', replace: true },
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
      if (format) {
        try {
          if (format.replace && result.code === 'z.string()') result = { schema: format.schema(result.schema), code: format.code };
          else if (format.replace) result = { schema: result.schema.and(format.schema(result.schema)), code: `${result.code}.and(${format.code})` };
          else result = { schema: format.schema(result.schema), code: `${result.code}.${format.code}` };
        } catch { warningMessages.push(`Unsupported format: ${node.format}`); }
      } else warningMessages.push(`Unsupported format: ${node.format}`);
    }
    if (node.uniqueItems !== undefined && node.type === 'array' && typeof node.uniqueItems !== 'boolean') warningMessages.push('Invalid uniqueItems: expected a boolean');
    if (node.uniqueItems === true && node.type === 'array') {
      result = { schema: result.schema.refine((items: any) => new Set(items.map((item: any) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).values()).size === items.length), code: `${result.code}.superRefine((items, ctx) => { if (new Set(items.map((item) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Array items must be unique' }); })` };
    }
    const applyConstraint = (name: string, value: unknown, valid: boolean, expected: string, apply: (schema: any, constraint: any) => any, method: string): void => {
      if (value === undefined) return;
      if (!valid) { warningMessages.push(`Invalid ${name}: expected ${expected}`); return; }
      try { result = { schema: apply(result.schema, value), code: `${result.code}.${method}(${JSON.stringify(value)})` }; }
      catch { warningMessages.push(`Unsupported constraint: ${name}`); }
    };
    if (node.type === 'string') {
      applyConstraint('minLength', node.minLength, isNonNegativeInteger(node.minLength), 'a non-negative integer', (schema, value) => schema.min(value), 'min');
      applyConstraint('maxLength', node.maxLength, isNonNegativeInteger(node.maxLength), 'a non-negative integer', (schema, value) => schema.max(value), 'max');
      if (node.pattern !== undefined) {
        if (typeof node.pattern !== 'string') warningMessages.push('Invalid pattern: expected a string');
        else try { result = { schema: (result.schema as any).regex(new RegExp(node.pattern)), code: `${result.code}.regex(new RegExp(${JSON.stringify(node.pattern)}))` }; }
        catch { warningMessages.push('Unsupported constraint: pattern'); }
      }
    }
    if (node.type === 'number' || node.type === 'integer') {
      applyConstraint('minimum', node.minimum, isFiniteNumber(node.minimum), 'a finite number', (schema, value) => schema.min(value), 'min');
      applyConstraint('maximum', node.maximum, isFiniteNumber(node.maximum), 'a finite number', (schema, value) => schema.max(value), 'max');
      for (const [name, keyword, fallback, method] of [['exclusiveMinimum', node.exclusiveMinimum, node.minimum, 'gt'], ['exclusiveMaximum', node.exclusiveMaximum, node.maximum, 'lt']] as const) {
        if (keyword === undefined || keyword === false) continue;
        const value = keyword === true ? fallback : keyword;
        if (!isFiniteNumber(value)) { warningMessages.push(`Invalid ${name}: expected a finite number${keyword === true ? ' in the corresponding inclusive bound' : ''}`); continue; }
        result = { schema: (result.schema as any)[method](value), code: `${result.code}.${method}(${JSON.stringify(value)})` };
      }
    }
    if (node.type === 'array') {
      applyConstraint('minItems', node.minItems, isNonNegativeInteger(node.minItems), 'a non-negative integer', (schema, value) => schema.min(value), 'min');
      applyConstraint('maxItems', node.maxItems, isNonNegativeInteger(node.maxItems), 'a non-negative integer', (schema, value) => schema.max(value), 'max');
    }
    if (node.type === 'object') {
      if (node.minProperties !== undefined) {
        if (!isNonNegativeInteger(node.minProperties)) warningMessages.push('Invalid minProperties: expected a non-negative integer');
        else result = { schema: result.schema.refine((value: any) => Object.keys(value).length >= node.minProperties), code: `${result.code}.refine((value) => Object.keys(value).length >= ${node.minProperties})` };
      }
      if (node.maxProperties !== undefined) {
        if (!isNonNegativeInteger(node.maxProperties)) warningMessages.push('Invalid maxProperties: expected a non-negative integer');
        else result = { schema: result.schema.refine((value: any) => Object.keys(value).length <= node.maxProperties), code: `${result.code}.refine((value) => Object.keys(value).length <= ${node.maxProperties})` };
      }
    }
    if (node.multipleOf !== undefined && (node.type === 'number' || node.type === 'integer') && isFiniteNumber(node.multipleOf) && node.multipleOf > 0) {
      const multiple = node.multipleOf;
      result = { schema: (result.schema as any).multipleOf(multiple), code: `${result.code}.multipleOf(${multiple})` };
    } else if (node.multipleOf !== undefined && (node.type === 'number' || node.type === 'integer')) warningMessages.push('Invalid multipleOf: expected a positive number');
    if (node.contains === undefined && (node.minContains !== undefined || node.maxContains !== undefined)) warningMessages.push('minContains/maxContains require contains and were ignored');
    if (node.additionalItems !== undefined && !Array.isArray(node.items) && !Array.isArray(node.prefixItems)) warningMessages.push('additionalItems applies only to tuple schemas and was ignored');
    if (node.type === 'object' && node.propertyNames !== undefined) {
      if (typeof node.propertyNames === 'boolean' || (node.propertyNames !== null && typeof node.propertyNames === 'object' && !Array.isArray(node.propertyNames))) {
        const propertyDefinition = typeof node.propertyNames === 'object' ? node.propertyNames as Record<string, unknown> : undefined;
        const propertySchema = convert((propertyDefinition?.type === undefined && propertyDefinition && ('pattern' in propertyDefinition || 'minLength' in propertyDefinition || 'maxLength' in propertyDefinition)) ? { ...propertyDefinition, type: 'string' } as JsonSchema : node.propertyNames as JsonSchema, resolving);
        result = { schema: result.schema.refine((value: any) => Object.keys(value).every((key) => propertySchema.schema.safeParse(key).success)), code: `${result.code}.refine((value) => Object.keys(value).every((key) => (${propertySchema.code}).safeParse(key).success))` };
      } else warningMessages.push('Invalid propertyNames: expected a schema');
    }
    if (node.type === 'object' && node.dependencies !== undefined) {
      if (!node.dependencies || typeof node.dependencies !== 'object' || Array.isArray(node.dependencies)) warningMessages.push('Invalid dependencies: expected an object');
      else for (const [key, dependency] of Object.entries(node.dependencies as Record<string, unknown>)) {
        if (Array.isArray(dependency)) {
          if (!dependency.every((item) => typeof item === 'string')) { warningMessages.push('Invalid dependencies entry: expected a string array or schema'); continue; }
          const requiredKeys = dependency as string[];
          if (requiredKeys.length) result = {
            schema: result.schema.refine((value: any) => !Object.prototype.hasOwnProperty.call(value, key) || requiredKeys.every((requiredKey) => Object.prototype.hasOwnProperty.call(value, requiredKey))),
            code: `${result.code}.refine((value) => !Object.prototype.hasOwnProperty.call(value, ${JSON.stringify(key)}) || ${JSON.stringify(requiredKeys)}.every((requiredKey) => Object.prototype.hasOwnProperty.call(value, requiredKey)))`,
          };
        } else if (isSchema(dependency)) {
          const dependent = convert(dependency, resolving);
          result = {
            schema: result.schema.refine((value: any) => !Object.prototype.hasOwnProperty.call(value, key) || dependent.schema.safeParse(value).success),
            code: `${result.code}.refine((value) => !Object.prototype.hasOwnProperty.call(value, ${JSON.stringify(key)}) || (${dependent.code}).safeParse(value).success)`,
          };
        } else warningMessages.push('Invalid dependencies entry: expected a string array or schema');
      }
    }
    if (node.type === 'object' && node.dependentRequired !== undefined && (!node.dependentRequired || typeof node.dependentRequired !== 'object' || Array.isArray(node.dependentRequired))) warningMessages.push('Invalid dependentRequired: expected an object of string arrays');
    if (node.type === 'object' && node.dependentRequired && typeof node.dependentRequired === 'object' && !Array.isArray(node.dependentRequired)) {
      const dependencies = Object.entries(node.dependentRequired as Record<string, unknown>).filter(([, value]) => {
        const valid = Array.isArray(value) && value.every((item) => typeof item === 'string');
        if (!valid) warningMessages.push('Invalid dependentRequired entry: expected an array of strings');
        return valid;
      });
      for (const [key, requiredKeys] of dependencies) {
        const keys = requiredKeys as string[];
        if (!keys.length) continue;
        result = { schema: result.schema.refine((value: any) => !Object.prototype.hasOwnProperty.call(value, key) || keys.every((requiredKey) => Object.prototype.hasOwnProperty.call(value, requiredKey))), code: `${result.code}.refine((value) => !Object.prototype.hasOwnProperty.call(value, ${JSON.stringify(key)}) || ${JSON.stringify(keys)}.every((requiredKey) => Object.prototype.hasOwnProperty.call(value, requiredKey)))` };
      }
    }
    if (node.type === 'object' && node.dependentSchemas !== undefined && (!node.dependentSchemas || typeof node.dependentSchemas !== 'object' || Array.isArray(node.dependentSchemas))) warningMessages.push('Invalid dependentSchemas: expected an object of schemas');
    if (node.type === 'object' && node.dependentSchemas && typeof node.dependentSchemas === 'object' && !Array.isArray(node.dependentSchemas)) {
      for (const [key, dependency] of Object.entries(node.dependentSchemas as Record<string, JsonSchema>)) {
        const dependent = convert(dependency, resolving);
        result = { schema: result.schema.refine((value: any) => !Object.prototype.hasOwnProperty.call(value, key) || dependent.schema.safeParse(value).success), code: `${result.code}.refine((value) => !Object.prototype.hasOwnProperty.call(value, ${JSON.stringify(key)}) || (${dependent.code}).safeParse(value).success)` };
      }
    }
    if (node.type === 'array' && node.contains !== undefined) {
      if (isSchema(node.contains)) {
        const contained = convert(node.contains, resolving);
        const minValid = node.minContains === undefined || isNonNegativeInteger(node.minContains);
        const maxValid = node.maxContains === undefined || isNonNegativeInteger(node.maxContains);
        if (!minValid) warningMessages.push('Invalid minContains: expected a non-negative integer');
        if (!maxValid) warningMessages.push('Invalid maxContains: expected a non-negative integer');
        const min = minValid ? node.minContains ?? 1 : 1; const max = maxValid ? node.maxContains : undefined;
        result = { schema: result.schema.refine((items: any) => { const count = items.filter((item: any) => contained.schema.safeParse(item).success).length; return count >= min && (max === undefined || count <= max); }), code: `${result.code}.refine((items) => { const count = items.filter((item) => ${contained.code}.safeParse(item).success).length; return count >= ${min}${max === undefined ? '' : ` && count <= ${max}`}; })` };
      } else warningMessages.push('Invalid contains: expected a schema');
    }
    const hasIf = Object.prototype.hasOwnProperty.call(node, 'if');
    if (!hasIf && (Object.prototype.hasOwnProperty.call(node, 'then') || Object.prototype.hasOwnProperty.call(node, 'else'))) warningMessages.push('then/else require if and were ignored');
    if (hasIf) {
      if (!isSchema(node.if)) warningMessages.push('Invalid if: expected a schema');
      else {
        const contextualize = (schema: JsonSchema): JsonSchema => {
          if (typeof schema === 'boolean' || schema.type !== undefined) return schema;
          return typeof node.type === 'string' ? { ...schema, type: node.type } : schema;
        };
        const condition = convert(contextualize(node.if), resolving);
        let whenTrue: { schema: z.ZodType; code: string } | undefined;
        let whenFalse: { schema: z.ZodType; code: string } | undefined;
        if (Object.prototype.hasOwnProperty.call(node, 'then')) {
          if (!isSchema(node.then)) warningMessages.push('Invalid then: expected a schema');
          else whenTrue = convert(contextualize(node.then), resolving);
        }
        if (Object.prototype.hasOwnProperty.call(node, 'else')) {
          if (!isSchema(node.else)) warningMessages.push('Invalid else: expected a schema');
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
    else if (node.contentEncoding !== undefined && node.type === 'string') warningMessages.push(`Unsupported contentEncoding: ${String(node.contentEncoding)}`);
    else if (node.contentEncoding !== undefined && node.type !== 'string') warningMessages.push('Invalid contentEncoding: expected a string schema');
    if (node.default !== undefined) result = { schema: result.schema.default(node.default), code: `${result.code}.default(${JSON.stringify(node.default)})` };
    return result;
  };

  convert = (node: JsonSchema, resolving = new Set<string>()): Converted => {
    const converted = convertCore(node, resolving);
    if (typeof node === 'boolean') return converted;
    const metadata: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'examples'] as const) if (Object.prototype.hasOwnProperty.call(node, key) && node[key] !== undefined) metadata[key] = node[key];
    if (!Object.prototype.hasOwnProperty.call(metadata, 'examples') && Object.prototype.hasOwnProperty.call(node, 'example') && node.example !== undefined) metadata.examples = [node.example];
    if (Object.keys(metadata).length === 0) return converted;
    return { schema: converted.schema.meta(metadata), code: `${converted.code}.meta(${JSON.stringify(metadata)})` };
  };

  for (const entry of definitionEntries) definitionResults.set(entry.ref, convert(entry.schema));
  rootResult = convert(source);

  const details: AnalysisWarning[] = [...analysis.warnings];
  for (const message of warningMessages) {
    const code = warningCode(message);
    if (code === 'ZOPIA_WARN_ONE_OF' && details.some((warning) => warning.code === code)) continue;
    if (code === 'ZOPIA_WARN_CUSTOM_FORMAT' && details.some((warning) => warning.code === code)) continue;
    const warning: AnalysisWarning = { code, at: '#', keyword: warningKeyword(message), message };
    if (!details.some((existing) => existing.code === warning.code && existing.at === warning.at && existing.message === warning.message)) details.push(warning);
  }
  const comments = details.map(warningComment);
  const expression = comments.length
    ? `(\n${comments.map((comment) => `  ${comment}`).join('\n')}\n  ${rootResult.code.replace(/\n/g, '\n  ')}\n)`
    : rootResult.code;
  const declarations = definitionEntries.filter((entry) => usedDefinitionRefs.has(entry.ref)).map((entry) => `const ${entry.name} = ${definitionResults.get(entry.ref)!.code};`);
  const documentation = typeof source === 'object'
    ? [source.title, source.description].filter((value): value is string => typeof value === 'string' && value.length > 0).flatMap((value) => value.split(/\r?\n/))
    : [];
  const jsDoc = documentation.length ? `/**\n${documentation.map((line) => ` * ${line.replace(/\*\//g, '*\\/')}`).join('\n')}\n */\n` : '';
  declarations.push(`${jsDoc}const ${rootName} = ${expression};`);
  const warnings: ZopiaWarning[] = details.map(({ keyword: _keyword, ...warning }) => warning);
  return { code: `${declarations.join('\n')}\n`, schema: rootResult.schema, warnings, overlays: analysis.overlays };
}
