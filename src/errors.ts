/** Stable error codes exposed by zopia's public APIs. */
export type ZopiaErrorCode =
  | 'ZOPIA_CONFIG_INVALID'
  | 'ZOPIA_SPEC_INVALID_JSON'
  | 'ZOPIA_SPEC_INVALID'
  | 'ZOPIA_SPEC_UNSUPPORTED_VERSION'
  | 'ZOPIA_SPEC_MISSING_PATHS'
  | 'ZOPIA_SPEC_PATH_REF'
  | 'ZOPIA_REF_NOT_FOUND'
  | 'ZOPIA_REF_EXTERNAL'
  | 'ZOPIA_DOCS_MISSING_MANIFEST'
  | 'ZOPIA_DOCS_MANIFEST_MISMATCH'
  | 'ZOPIA_DOCS_IMPORT_FAILED'
  | 'ZOPIA_FS_OUTSIDE_OUTDIR'
  | 'ZOPIA_FS_WRITE_FAILED';

/** A typed public error with a stable code and optional source location and recovery hint. */
export class ZopiaError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: ZopiaErrorCode;

  /** JSON Pointer or file location associated with the error. */
  readonly at?: string;

  /** Actionable recovery suggestion. */
  readonly hint?: string;

  /** Create an error from a stable code, human-readable message, and optional diagnostics. */
  constructor(code: ZopiaErrorCode, message: string, options: { at?: string; hint?: string; cause?: unknown } = {}) {
    super(`${code}: ${message}`, { cause: options.cause });
    this.name = 'ZopiaError';
    this.code = code;
    this.at = options.at;
    this.hint = options.hint;
  }
}
