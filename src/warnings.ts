/** Stable warning codes emitted by zopia's conversion pipelines. */
export const ZOPIA_WARNING_CODES = [
  'ZOPIA_WARN_CONTENT_ENCODING',
  'ZOPIA_WARN_CUSTOM_FORMAT',
  'ZOPIA_WARN_DEFAULT_INFO',
  'ZOPIA_WARN_DEFAULT_SECURITY',
  'ZOPIA_WARN_DIALECT_DOWNGRADE',
  'ZOPIA_WARN_FROZEN_SUBTREE',
  'ZOPIA_WARN_INT64',
  'ZOPIA_WARN_INVALID_SCHEMA',
  'ZOPIA_WARN_LEGACY_EXCLUSIVE_BOUND',
  'ZOPIA_WARN_MULTI_CONTENT',
  'ZOPIA_WARN_NOT',
  'ZOPIA_WARN_ONE_OF',
  'ZOPIA_WARN_REF',
  'ZOPIA_WARN_SERVER_VARIABLES',
  'ZOPIA_WARN_STALE_TREE',
  'ZOPIA_WARN_UNIQUE_ITEMS',
  'ZOPIA_WARN_UNREPRESENTABLE',
  'ZOPIA_WARN_WEBHOOKS',
] as const;

/** Stable, machine-readable warning code. */
export type ZopiaWarningCode = typeof ZOPIA_WARNING_CODES[number];

/** A non-fatal, structured diagnostic produced by a lossy conversion. */
export interface ZopiaWarning {
  /** Stable, machine-readable warning code. */
  code: ZopiaWarningCode;
  /** JSON Pointer identifying the affected source or output location, when available. */
  at?: string;
  /** Human-readable description of the approximation or loss. */
  message: string;
}

const cleanText = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
const warningKey = (warning: ZopiaWarning): string => `${warning.at ?? ''}\0${warning.code}\0${warning.message}`;

function normalizeWarning(warning: ZopiaWarning): ZopiaWarning {
  if (!ZOPIA_WARNING_CODES.includes(warning.code)) throw new TypeError(`Unknown zopia warning code: ${String(warning.code)}`);
  if (warning.at !== undefined && (typeof warning.at !== 'string' || warning.at.length === 0)) throw new TypeError('Warning location must be a non-empty string');
  if (typeof warning.message !== 'string' || cleanText(warning.message).length === 0) throw new TypeError('Warning message must be a non-empty string');
  return { code: warning.code, ...(warning.at === undefined ? {} : { at: warning.at }), message: cleanText(warning.message) };
}

/** Return detached, deduplicated warnings in deterministic location/code/message order. */
export function normalizeZopiaWarnings(warnings: Iterable<ZopiaWarning>): ZopiaWarning[] {
  const unique = new Map<string, ZopiaWarning>();
  for (const input of warnings) {
    const warning = normalizeWarning(input);
    unique.set(warningKey(warning), warning);
  }
  return [...unique.values()].sort((left, right) => {
    const a = warningKey(left); const b = warningKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Prefix a warning's JSON Pointer with a containing source location. */
export function rebaseZopiaWarning(warning: ZopiaWarning, base: string): ZopiaWarning {
  if (typeof base !== 'string' || !base.startsWith('#')) throw new TypeError(`Invalid warning base pointer: ${base}`);
  const suffix = warning.at === undefined || warning.at === '#' ? '' : warning.at.startsWith('#/') ? warning.at.slice(1) : warning.at;
  return normalizeWarning({ ...warning, at: `${base}${suffix}` });
}

/** Format a warning for stderr or logs without multiline injection. */
export function formatZopiaWarning(warning: ZopiaWarning): string {
  const value = normalizeWarning(warning);
  return `${value.code}${value.at ? ` ${value.at}` : ''}: ${value.message}`;
}

/** Format the canonical generated-code marker required by D-12. */
export function formatZopiaWarningComment(warning: ZopiaWarning, subject: string): string {
  const value = normalizeWarning(warning);
  const label = cleanText(subject) || 'schema';
  return `// @zopia:warn ${value.code} ${label} — ${value.message}${value.at ? ` (${value.at})` : ''}`;
}

/** Deterministic warning accumulator shared by public engine wrappers. */
export class ZopiaWarningCollector {
  readonly #warnings = new Map<string, ZopiaWarning>();

  /** Add one warning after validating and normalizing it. */
  add(input: ZopiaWarning): void {
    const warning = normalizeWarning(input);
    this.#warnings.set(warningKey(warning), warning);
  }

  /** Add all warnings from an iterable. */
  addAll(inputs: Iterable<ZopiaWarning>): void {
    for (const warning of inputs) this.add(warning);
  }

  /** Add warnings rebased beneath one containing JSON Pointer. */
  addRebased(inputs: Iterable<ZopiaWarning>, base: string): void {
    for (const warning of inputs) this.add(rebaseZopiaWarning(warning, base));
  }

  /** Return a detached, deduplicated, deterministically sorted snapshot. */
  toArray(): ZopiaWarning[] {
    return normalizeZopiaWarnings(this.#warnings.values());
  }
}
