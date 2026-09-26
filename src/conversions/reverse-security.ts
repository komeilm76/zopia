import { ZopiaError } from '../errors';
/** One OpenAPI security-requirement alternative. */
export type OpenApiSecurityRequirement = Record<string, string[]>;

/** Result of selecting or creating zopia's deterministic fallback scheme. */
export interface ZopiaFallbackSecurityScheme {
  /** Scheme name used by the synthesized operation requirement. */
  name: string;
  /** Security-scheme map including the fallback definition. */
  schemes: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate and detach an OpenAPI security requirement list. */
export function normalizeSecurityRequirements(value: unknown, context: string): OpenApiSecurityRequirement[] {
  if (!Array.isArray(value)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid ${context}: expected an array`);
  return value.map((alternative, index) => {
    if (!isRecord(alternative)) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid ${context} alternative ${index}: expected an object`);
    const requirement: OpenApiSecurityRequirement = {};
    for (const [name, scopes] of Object.entries(alternative)) {
      if (!name || !Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) throw new ZopiaError('ZOPIA_MANIFEST_INVALID', `Invalid ${context} alternative ${index}: expected scheme names with string scope arrays`);
      Object.defineProperty(requirement, name, { value: [...scopes], enumerable: true, configurable: true, writable: true });
    }
    return requirement;
  });
}

function isCompatibleFallback(value: unknown, swagger: boolean): boolean {
  if (!isRecord(value)) return false;
  if (swagger) return value.type === 'apiKey' && value.in === 'header' && typeof value.name === 'string' && value.name.toLowerCase() === 'authorization';
  return value.type === 'http' && typeof value.scheme === 'string' && value.scheme.toLowerCase() === 'bearer';
}

/** Add or reuse a collision-safe bearer fallback without replacing existing schemes. */
export function ensureFallbackSecurityScheme(input: Record<string, unknown>, swagger: boolean): ZopiaFallbackSecurityScheme {
  const schemes = { ...input };
  let suffix = 1;
  while (true) {
    const name = suffix === 1 ? 'bearerAuth' : `bearerAuth${suffix}`;
    if (!Object.prototype.hasOwnProperty.call(schemes, name)) {
      Object.defineProperty(schemes, name, {
        value: swagger
          ? { type: 'apiKey', name: 'Authorization', in: 'header' }
          : { type: 'http', scheme: 'bearer' },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return { name, schemes };
    }
    if (isCompatibleFallback(schemes[name], swagger)) return { name, schemes };
    suffix += 1;
  }
}
