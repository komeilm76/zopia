/* Project-level configuration (v0.2.x, D-19). The CLI discovers `zopia.config.ts` (or
 * `zopia.config.mts`) next to the current working directory — or an explicit path given with
 * `--config` — and applies it as defaults: explicit CLI flags always win, the config file
 * fills the gaps, and built-in defaults remain last. The file is executed JavaScript like
 * any generated module, so only trusted projects should be configured this way (the CLI
 * help and configuration docs repeat that warning). */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZopiaError } from './errors';

/**
 * Defaults for `zopia generate` resolved from a project config file.
 */
export interface ZopiaProjectGenerateConfig {
  /** Endpoint layout used when `--mode` is absent. */
  mode?: 'directory' | 'flat';
  /** Write component modules when `--insert-components` is absent. */
  insertComponents?: boolean;
  /** Import emitted components when `--use-component-as-reference` is absent; requires `insertComponents: true`. */
  useComponentAsReference?: boolean;
  /** Write `.zopia-manifest.json`; `--no-manifest` on the CLI always overrides. */
  manifest?: boolean;
  /** Output directory used when the positional `<output-dir>` is omitted. */
  outDir?: string;
}

/**
 * Defaults for `zopia reverse` resolved from a project config file.
 */
export interface ZopiaProjectReverseConfig {
  /** OpenAPI output version used when `--version` is absent. */
  version?: '2.0' | '3.0' | '3.1';
  /** JSON destination used when `--out` is absent; without any value the CLI keeps writing to stdout. */
  out?: string;
}

/**
 * Complete `zopia.config.ts` shape. Only the purposeful defaults above are loadable;
 * unknown keys or incorrectly typed values are rejected with `ZOPIA_CONFIG_INVALID`.
 */
export interface ZopiaProjectConfig {
  /** Defaults for `zopia generate`. */
  generate?: ZopiaProjectGenerateConfig;
  /** Defaults for `zopia reverse`. */
  reverse?: ZopiaProjectReverseConfig;
}

/** Options accepted by {@link loadZopiaConfig}. */
export interface ZopiaConfigLoadOptions {
  /** Directory searched for `zopia.config.ts` / `zopia.config.mts`. @default process.cwd() */
  cwd?: string;
  /** Explicit config path (CLI `--config`), resolved from `cwd`; errors when missing instead of silently skipping discovery. @default undefined (directory discovery) */
  file?: string;
}

const CONFIG_FILE_NAMES = ['zopia.config.ts', 'zopia.config.mts'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidConfig(message: string, at: string, hint: string, cause?: unknown): never {
  throw new ZopiaError('ZOPIA_CONFIG_INVALID', message, { at, hint, ...(cause === undefined ? {} : { cause }) });
}

const isFile = async (path: string): Promise<boolean> => {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
};

function validateStringOption(value: unknown, at: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) invalidConfig(`${at} must be a non-empty string`, at, 'set a valid string value');
  return value;
}

function validateBooleanOption(value: unknown, at: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalidConfig(`${at} must be a boolean`, at, 'set true or false');
  return value;
}

function validateUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown !== undefined) invalidConfig(`unknown ${context} config option: ${unknown}`, context === 'config' ? unknown : `${context}.${unknown}`, 'remove the unsupported option');
}

/**
 * Type a project config file without changing its value.
 *
 * @param config Configuration object to type-check statically.
 * @returns The same configuration object.
 */
export function defineConfig<T extends ZopiaProjectConfig>(config: T): T {
  return config;
}

function validateProjectConfig(candidate: unknown, file: string): ZopiaProjectConfig {
  if (!isRecord(candidate)) invalidConfig('zopia config must export an object', file, 'export default defineConfig({ generate: { … }, reverse: { … } })');
  validateUnknownKeys(candidate, ['generate', 'reverse'], 'config');
  const config: ZopiaProjectConfig = {};
  if (candidate.generate !== undefined) {
    if (!isRecord(candidate.generate)) invalidConfig('generate config must be an object', 'generate', 'provide generate conversion defaults');
    validateUnknownKeys(candidate.generate, ['mode', 'insertComponents', 'useComponentAsReference', 'manifest', 'outDir'], 'generate');
    const mode = candidate.generate.mode;
    if (mode !== undefined && mode !== 'directory' && mode !== 'flat') invalidConfig("generate.mode must be 'directory' or 'flat'", 'generate.mode', "use '--mode directory' or '--mode flat'");
    const booleans: Partial<Pick<ZopiaProjectGenerateConfig, 'insertComponents' | 'useComponentAsReference' | 'manifest'>> = {};
    for (const key of ['insertComponents', 'useComponentAsReference', 'manifest'] as const) {
      const value = validateBooleanOption(candidate.generate[key], `generate.${key}`);
      if (value !== undefined) booleans[key] = value;
    }
    config.generate = {
      ...(mode === undefined ? {} : { mode }),
      ...booleans,
      ...(candidate.generate.outDir === undefined ? {} : { outDir: validateStringOption(candidate.generate.outDir, 'generate.outDir') }),
    };
  }
  if (candidate.reverse !== undefined) {
    if (!isRecord(candidate.reverse)) invalidConfig('reverse config must be an object', 'reverse', 'provide reverse conversion defaults');
    validateUnknownKeys(candidate.reverse, ['version', 'out'], 'reverse');
    const version = candidate.reverse.version;
    if (version !== undefined && version !== '2.0' && version !== '3.0' && version !== '3.1') invalidConfig("reverse.version must be '2.0', '3.0', or '3.1'", 'reverse.version', "use '--version 2.0', '--version 3.0', or '--version 3.1'");
    config.reverse = {
      ...(version === undefined ? {} : { version }),
      ...(candidate.reverse.out === undefined ? {} : { out: validateStringOption(candidate.reverse.out, 'reverse.out') }),
    };
  }
  return config;
}

/**
 * Load the project config file for the current working directory (or an explicit `--config` path).
 *
 * Discovery checks `zopia.config.ts` then `zopia.config.mts` in `cwd`; an explicit `file`
 * must exist. The module is executed exactly like generated modules (trusted projects
 * only); the `default` export wins over a named `config` export. The result is structurally
 * validated — unknown keys and wrongly typed values fail with `ZOPIA_CONFIG_INVALID`.
 *
 * @param options Load options; defaults to running-directory discovery.
 * @returns The validated project config, or `undefined` when discovery finds no file.
 */
export async function loadZopiaConfig(options: ZopiaConfigLoadOptions = {}): Promise<ZopiaProjectConfig | undefined> {
  if (!isRecord(options)) invalidConfig('config load options must be an object', 'options', 'pass an options object or omit it');
  validateUnknownKeys(options, ['cwd', 'file'], 'config load');
  const cwd = options.cwd === undefined ? process.cwd() : options.cwd;
  if (typeof cwd !== 'string' || !cwd) invalidConfig('cwd must be a non-empty string', 'cwd', 'provide a working directory');
  if (options.file !== undefined && (typeof options.file !== 'string' || !options.file)) invalidConfig('file must be a non-empty string', 'file', 'provide a config file path');

  let candidate: string | undefined;
  let explicit = false;
  if (options.file) {
    candidate = isAbsolute(options.file) ? options.file : resolve(cwd, options.file);
    explicit = true;
    if (!await isFile(candidate)) invalidConfig(`config file not found: ${options.file}`, options.file, 'create zopia.config.ts or pass an existing --config path');
  } else {
    for (const name of CONFIG_FILE_NAMES) {
      const discovered = resolve(cwd, name);
      if (await isFile(discovered)) { candidate = discovered; break; }
    }
  }
  if (candidate === undefined) return undefined;

  let resolved: string;
  try { resolved = await realpath(candidate); }
  catch (error) { invalidConfig(`Unable to resolve config file ${explicit ? options.file! : candidate}: ${error instanceof Error ? error.message : String(error)}`, explicit ? options.file! : candidate, 'check the config file path and permissions', error); }

  let module: Record<string, unknown>;
  try {
    const url = pathToFileURL(resolved);
    const digest = createHash('sha256').update(await readFile(resolved)).digest('hex');
    url.searchParams.set('zopia-config', digest);
    module = await import(url.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}').replace(/%7E/gi, '~')) as Record<string, unknown>;
  } catch (error) {
    invalidConfig(`Unable to import config file ${resolved}: ${error instanceof Error ? error.message : String(error)}`, resolved, 'fix the config module; it is executed JavaScript and must evaluate cleanly', error);
  }

  const selected = 'default' in module ? module.default : 'config' in module ? module.config : undefined;
  if (selected === undefined) invalidConfig('zopia config must default-export (or named-export `config`) an object', resolved, "export default defineConfig({ … }) or export const config = defineConfig({ … })");
  return validateProjectConfig(selected, resolved);
}
