/** Stable error-code catalogue exposed by every zopia public API. */
export const ZOPIA_ERROR_CODES = Object.freeze([
  'ZOPIA_CONFIG_INVALID',
  'ZOPIA_DOCS_IMPORT_FAILED',
  'ZOPIA_DOCS_MANIFEST_MISMATCH',
  'ZOPIA_DOCS_MISSING_MANIFEST',
  'ZOPIA_DOCS_PRESET_ROOT',
  'ZOPIA_FS_OUTSIDE_OUTDIR',
  'ZOPIA_FS_WRITE_FAILED',
  'ZOPIA_MANIFEST_INVALID',
  'ZOPIA_REF_EXTERNAL',
  'ZOPIA_REF_NOT_FOUND',
  'ZOPIA_SCHEMA_INVALID',
  'ZOPIA_SPEC_INVALID',
  'ZOPIA_SPEC_INVALID_JSON',
  'ZOPIA_SPEC_INVALID_YAML',
  'ZOPIA_SPEC_MISSING_PATHS',
  'ZOPIA_SPEC_PATH_REF',
  'ZOPIA_SPEC_UNSUPPORTED_VERSION',
  'ZOPIA_WARNING_INVALID',
] as const);

/** Stable machine-readable error code exposed by zopia's public APIs. */
export type ZopiaErrorCode = typeof ZOPIA_ERROR_CODES[number];

/** Optional source location, recovery hint, and causal error metadata. */
export interface ZopiaErrorOptions {
  /**
   * JSON Pointer, option name, or portable file location associated with the error.
   * @default undefined
   */
  at?: string;
  /**
   * Concise action the caller can take to resolve the error.
   * @default Code-specific recovery guidance.
   */
  hint?: string;
  /**
   * Original exception when zopia translates a lower-level failure.
   * @default undefined
   */
  cause?: unknown;
}

const DEFAULT_ERROR_HINTS: Record<ZopiaErrorCode, string> = {
  ZOPIA_CONFIG_INVALID: 'correct the invalid option or argument',
  ZOPIA_SPEC_INVALID_JSON: 'provide readable, valid JSON',
  ZOPIA_SPEC_INVALID_YAML: 'provide readable, valid YAML',
  ZOPIA_SPEC_INVALID: 'fix the invalid Swagger/OpenAPI document',
  ZOPIA_SPEC_UNSUPPORTED_VERSION: 'use Swagger 2.0, OpenAPI 3.0, or OpenAPI 3.1',
  ZOPIA_SPEC_MISSING_PATHS: 'add a paths object to the API document',
  ZOPIA_SPEC_PATH_REF: 'use a valid local path-item reference',
  ZOPIA_SCHEMA_INVALID: 'provide a valid Zod or JSON Schema value',
  ZOPIA_REF_NOT_FOUND: 'check that the local JSON Pointer target exists',
  ZOPIA_REF_EXTERNAL: 'replace the external reference with a local reference',
  ZOPIA_MANIFEST_INVALID: 'regenerate the manifest or fix its invalid metadata',
  ZOPIA_DOCS_MISSING_MANIFEST: 'generate api docs first or pass the manifest path',
  ZOPIA_DOCS_PRESET_ROOT: 'reverse one preset bucket directory instead of the preset root',
  ZOPIA_DOCS_MANIFEST_MISMATCH: 'regenerate the api-docs tree or restore its generated files',
  ZOPIA_DOCS_IMPORT_FAILED: 'fix or regenerate the affected generated module',
  ZOPIA_FS_OUTSIDE_OUTDIR: 'keep generated paths inside the output directory',
  ZOPIA_FS_WRITE_FAILED: 'check the output path, permissions, and available disk space',
  ZOPIA_WARNING_INVALID: 'provide a valid warning code, location, and message',
};

/** A typed public error with a stable code and optional source location and actionable recovery hint. */
export class ZopiaError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: ZopiaErrorCode;

  /** JSON Pointer or file location associated with the error. */
  readonly at?: string;

  /** Actionable recovery suggestion. */
  readonly hint: string;

  /**
   * Create an error from a stable code, human-readable message, and optional diagnostics.
   *
   * @param code Stable machine-readable failure code.
   * @param message Human-readable failure description.
   * @param options Optional source location, recovery hint, and cause.
   */
  constructor(code: ZopiaErrorCode, message: string, options: ZopiaErrorOptions = {}) {
    super(`${code}: ${message}`, { cause: options.cause });
    this.name = 'ZopiaError';
    this.code = code;
    this.at = options.at;
    this.hint = options.hint ?? DEFAULT_ERROR_HINTS[code];
  }
}

/**
 * Test whether an unknown thrown value is a zopia typed error.
 *
 * @param error Unknown caught or rejected value.
 * @returns Whether `error` is a {@link ZopiaError} instance.
 */
export function isZopiaError(error: unknown): error is ZopiaError {
  return error instanceof ZopiaError;
}

/**
 * Preserve an existing typed error or wrap an unknown failure with public diagnostics.
 *
 * @param error Unknown caught or rejected value.
 * @param code Stable code to use when wrapping an untyped failure.
 * @param message Context prepended to an untyped failure's message.
 * @param options Optional source location and recovery hint for a wrapped failure.
 * @returns The existing typed error or a newly wrapped {@link ZopiaError}.
 */
export function asZopiaError(error: unknown, code: ZopiaErrorCode, message: string, options: Omit<ZopiaErrorOptions, 'cause'> = {}): ZopiaError {
  if (error instanceof ZopiaError) return error;
  const detail = error instanceof Error && error.message ? `: ${error.message}` : error === undefined ? '' : `: ${String(error)}`;
  return new ZopiaError(code, `${message}${detail}`, { ...options, cause: error });
}
