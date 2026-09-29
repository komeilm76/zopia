/**
 * 📛 Shared endpoint identifier rules (R-732).
 *
 * The single source of truth for deriving safe export identifiers from
 * operation IDs — and for the numeric uniqueness suffix applied when two
 * derived identifiers collide. Generation (Engine ③'s `export const` names
 * and the collectors' deterministic operation IDs) and the runtime tree
 * resolver (`flattenApiDocs` record keys) call these helpers so both surfaces
 * keep producing identical names by construction.
 */

/** ECMAScript keywords and literals never emitted as generated identifiers. */
const RESERVED_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

/**
 * Derive the endpoint export identifier from one operation ID.
 *
 * Applies the fixed naming contract of R-732: split on non-identifier
 * characters, camel-case the parts (camelize), fall back to `endpoint` when
 * nothing remains, prefix `endpoint` when the result starts with a digit or
 * other non-identifier character, and append `Endpoint` when the result is a
 * reserved ECMAScript keyword or literal (e.g. `await` → `awaitEndpoint`).
 *
 * @param operationId Explicit or deterministically derived operation identifier.
 * @returns Safe camel-case TypeScript identifier for the module export.
 */
export function endpointExportName(operationId: string): string {
  const parts = operationId.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  let name = parts.map((part, index) => index === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('') || 'endpoint';
  if (!/^[A-Za-z_$]/.test(name)) name = `endpoint${name}`;
  if (RESERVED_IDENTIFIER_NAMES.has(name)) name = `${name}Endpoint`;
  return name;
}

/**
 * Return the first free variant of a derived identifier, suffixing `2`, `3`, …
 *
 * This is the exact uniqueness rule the operation collectors apply when a
 * derived operation ID collides (`getA` → `getA2` → `getA3`): the first
 * candidate is the base itself, and every subsequent candidate appends the
 * next integer directly to the base.
 *
 * @param base Identifier before any uniqueness suffix.
 * @param used Already-claimed identifiers this derivation must not clobber.
 * @returns `base` itself when free, otherwise the first suffixed variant.
 */
export function uniqueEndpointName(base: string, used: ReadonlySet<string>): string {
  let name = base;
  let suffix = 1;
  while (used.has(name)) name = `${base}${++suffix}`;
  return name;
}
