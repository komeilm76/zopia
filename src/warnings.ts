/** A non-fatal, structured diagnostic produced by a lossy conversion. */
export interface ZopiaWarning {
  /** Stable, machine-readable warning code. */
  code: string;
  /** JSON Pointer identifying the affected output location, when available. */
  at?: string;
  /** Human-readable description of the approximation or loss. */
  message: string;
}
