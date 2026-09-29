import { ZopiaError } from '../errors';
import { isPortableApiDocsSegment } from './api-docs-layout';
import { OPENAPI_METHODS, type OpenApiMethod } from './openapi-to-api-docs';
import { type OpenApiDocument } from './openapi';
import { resolveOpenApiLocalRef } from './openapi-ref';
import type { ZopiaWarning } from '../warnings';

/** Built-in split-generation preset: one api-docs tree per routed bucket. */
export type ZopiaGeneratePreset = 'multi-tag' | 'multi-server';

/** One routed preset bucket: a filtered source document plus its target sub-directory. */
export interface ZopiaPresetBucket {
  /** Human bucket identity: the routing tag, server URL, `'(untagged)'`, or `'(default server)'`. */
  name: string;
  /** Portable sub-directory under the configured output directory (collision-safe). */
  directory: string;
  /** Filtered document holding only this bucket's routed operations, all other source facts verbatim. */
  document: OpenApiDocument;
  /** Routing notices (for example an operation with several tags uses its primary tag). */
  warnings: ZopiaWarning[];
}

/** Summary of one generated preset tree, relative to the output directory. */
export interface ZopiaPresetTree {
  /** Human bucket identity of the tree (`name` of its {@link ZopiaPresetBucket}). */
  name: string;
  /** Portable sub-directory of the tree, relative to the output directory. */
  directory: string;
  /** Manifest path relative to the output directory, present when manifests are enabled. */
  manifestPath?: string;
}

/** All built-in preset names, in CLI-accepted order. */
export const ZOPIA_GENERATE_PRESETS = ['multi-tag', 'multi-server'] as const;

const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');

/** Portable lower-case directory slug for one bucket name (empty/unsafe → `'untagged'`). */
function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return slug && isPortableApiDocsSegment(slug) ? slug : 'untagged';
}

/** Identity of one server entry — the whole object, compared module structurally for routing stability. */
const serverKey = (server: unknown): string => JSON.stringify(server ?? null);

/** Human name for one routed server entry: its URL when available. */
const serverName = (server: unknown): string => {
  if (server && typeof server === 'object' && !Array.isArray(server) && typeof (server as { url?: unknown }).url === 'string') return (server as { url: string }).url;
  return JSON.stringify(server) ?? '(default server)';
};

/** One collected operation with everything bucket routing needs. */
interface PresetOperation {
  /** Stable bucket key for this operation's preset. */
  key: string;
  /** Human bucket label for this operation. */
  name: string;
  /** JSON Pointer of the operation in the source document. */
  at: string;
  /** Item routing fields (`paths`/`webhooks` section, item name, method). */
  section: 'paths' | 'webhooks';
  /** Path template or webhook name. */
  item: string;
  /** HTTP method of the operation. */
  method: OpenApiMethod;
  /** Warning emitted when an operation carries several routing keys. */
  notice?: ZopiaWarning;
}

/** Resolve one item for ROUTING only (read-only; buckets keep the original verbatim). */
function resolveForRouting(document: OpenApiDocument, item: unknown): Record<string, any> | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  let resolved: any = item;
  const seen = new Set<string>();
  while ('$ref' in resolved) {
    if (typeof resolved.$ref !== 'string' || !resolved.$ref || seen.has(resolved.$ref)) return resolved;
    seen.add(resolved.$ref);
    const target = resolveOpenApiLocalRef(document, resolved.$ref);
    if (!target || typeof target !== 'object' || Array.isArray(target)) return resolved;
    resolved = { ...target, ...Object.fromEntries(Object.entries(resolved).filter(([key]) => key !== '$ref')) };
  }
  return resolved;
}

/** First entry of a valid non-empty string array (`undefined` otherwise). */
function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((entry): entry is string => typeof entry === 'string' && entry.length > 0) : undefined;
}

/** Collect every operation from the paths/webhooks sections with its preset routing identity. */
function collectPresetOperations(document: OpenApiDocument, preset: ZopiaGeneratePreset): PresetOperation[] {
  const operations: PresetOperation[] = [];
  const servers = preset === 'multi-server' && document.swagger !== '2.0' ? document.servers : undefined;
  for (const section of ['paths', 'webhooks'] as const) {
    if (section === 'webhooks' && (document.swagger === '2.0' || !document.webhooks)) continue;
    const map = (section === 'paths' ? document.paths : document.webhooks) ?? {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const item of Object.keys(map as Record<string, unknown>)) {
      if (item.startsWith('x-')) continue;
      const resolved = resolveForRouting(document, (map as Record<string, unknown>)[item as string]);
      if (!resolved) continue;
      for (const method of OPENAPI_METHODS) {
        const operation = resolved[method];
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
        const at = `#/${section}/${pointerToken(item)}/${method}`;
        if (preset === 'multi-tag') {
          const tags = Array.isArray(operation.tags) ? (operation.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string' && tag.length > 0) : [];
          const primary = firstString(tags);
          operations.push({
            key: `tag:${primary ?? ''}`,
            name: primary ?? '(untagged)',
            at,
            section,
            item,
            method,
            ...(tags.length > 1 ? { notice: { code: 'ZOPIA_WARN_PRESET_PRIMARY_TAG' as const, at, message: `operation has ${tags.length} tags; using primary tag "${primary}" for --preset multi-tag` } } : {}),
          });
        } else {
          const effective = [operation.servers, resolved.servers, servers].find((list) => Array.isArray(list) && list.length > 0) as unknown[] | undefined;
          const server = effective && effective.length > 0 ? effective[0] : undefined;
          operations.push({
            key: server === undefined ? 'server:' : `server:${serverKey(server)}`,
            name: server === undefined ? '(default server)' : serverName(server),
            at,
            section,
            item,
            method,
          });
        }
      }
    }
  }
  return operations;
}

/** Keep only the routed methods of one item; `$ref`s stay verbatim unless the route takes a proper subset of the item's operations (then the resolved item is inlined). */
function filteredItem(document: OpenApiDocument, item: unknown, routed: Set<OpenApiMethod>): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const resolved = resolveForRouting(document, item) ?? {};
  const allMethods = OPENAPI_METHODS.filter((method) => resolved[method] && typeof resolved[method] === 'object' && !Array.isArray(resolved[method]));
  // When the route covers the item's whole operation set the original stays
  // verbatim (`$ref`s survive for manifest-faithful reverse conversion); a
  // partial route would leak the other operations through the `$ref`, so the
  // resolved item is expanded in place.
  const source = routed.size < allMethods.length ? resolved : item as Record<string, any>;
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(source)) {
    if (OPENAPI_METHODS.includes(key as OpenApiMethod)) {
      if (routed.has(key as OpenApiMethod)) filtered[key] = value;
    } else filtered[key] = value;
  }
  return filtered;
}

/**
 * Plan preset buckets of one normalized document. **Pure** — no I/O, no writes.
 *
 * @param document Normalized Swagger/OpenAPI document to split.
 * @param preset Split strategy: `multi-tag` (primary `tags[0]` per operation, untagged operations in `(untagged)`), or `multi-server` (effective first server: operation → path item → document).
 * @returns One bucket per routed group in deterministic directory order, or `undefined` when the strategy has no effect (no tags anywhere / at most one distinct server).
 * @throws {ZopiaError} ZOPIA_CONFIG_INVALID — the preset name is not one of {@link ZOPIA_GENERATE_PRESETS}.
 */
export function planPresetBuckets(document: OpenApiDocument, preset: ZopiaGeneratePreset): ZopiaPresetBucket[] | undefined {
  if (preset !== 'multi-tag' && preset !== 'multi-server') throw new ZopiaError('ZOPIA_CONFIG_INVALID', `unsupported generate preset: ${String(preset)}`, { at: 'preset', hint: `use ${ZOPIA_GENERATE_PRESETS.join(' or ')}` });
  const operations = collectPresetOperations(document, preset);
  if (operations.length === 0) return undefined;
  const keys = new Set(operations.map((operation) => operation.key));
  // A single routed group (one tag / at most one server) renders exactly the
  // normal tree — fall through instead of nesting a pointless sub-directory.
  if (keys.size <= 1) return undefined;

  // Deterministic bucket order: by display name, then collision-safe directory slug.
  const buckets = new Map<string, { name: string; directory: string; operations: PresetOperation[]; warnings: ZopiaWarning[] }>();
  for (const operation of operations) {
    const existing = buckets.get(operation.key);
    if (existing) existing.operations.push(operation);
    else buckets.set(operation.key, { name: operation.name, directory: '', operations: [operation], warnings: [] });
    if (operation.notice) buckets.get(operation.key)?.warnings.push(operation.notice);
  }
  const ordered = [...buckets.entries()].sort((left, right) => left[1].name < right[1].name ? -1 : left[1].name > right[1].name ? 1 : 0);
  const claimed = new Map<string, string>();
  for (const [key, bucket] of ordered) {
    const base = slugify(bucket.name);
    let directory = base;
    let suffix = 2;
    while ([...claimed.values()].includes(directory)) directory = `${base}-${suffix++}`;
    claimed.set(key, directory);
    bucket.directory = directory;
  }

  return ordered.map(([, bucket]) => {
    const document2: OpenApiDocument = { ...document };
    const routed = new Map<string, Set<OpenApiMethod>>();
    for (const operation of bucket.operations) {
      const routeKey = `${operation.section} ${operation.item}`;
      const methods = routed.get(routeKey) ?? new Set<OpenApiMethod>();
      methods.add(operation.method);
      routed.set(routeKey, methods);
    }
    const paths: Record<string, unknown> = {};
    for (const [path, item] of Object.entries((document.paths ?? {}) as Record<string, unknown>)) {
      if (path.startsWith('x-')) { paths[path] = item; continue; }
      const methods = routed.get(`paths ${path}`);
      if (!methods) continue;
      const filtered = filteredItem(document, item, methods);
      if (filtered && typeof filtered === 'object') paths[path] = filtered;
    }
    document2.paths = paths;
    if (document.webhooks !== undefined) {
      const webhooks: Record<string, unknown> = {};
      for (const [name, item] of Object.entries((document.webhooks ?? {}) as Record<string, unknown>)) {
        if (name.startsWith('x-')) { webhooks[name] = item; continue; }
        const methods = routed.get(`webhooks ${name}`);
        if (!methods) { continue; }
        const filtered = filteredItem(document, item, methods);
        if (filtered && typeof filtered === 'object') webhooks[name] = filtered;
      }
      // Drop the section entirely when this bucket kept nothing — an empty map
      // would surface a spurious preserved-webhooks warning during generation.
      if (Object.keys(webhooks).length > 0) document2.webhooks = webhooks;
      else delete document2.webhooks;
    }
    return { name: bucket.name, directory: bucket.directory, document: document2, warnings: bucket.warnings };
  });
}
