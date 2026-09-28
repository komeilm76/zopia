import { watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { loadZopiaConfig, type ZopiaProjectConfig } from './config';
import { asZopiaError, ZopiaError } from './errors';
import { openApiToApiDocs } from './conversions/openapi-to-api-docs-public';
import { apiDocsToOpenApi } from './conversions/manifest-to-openapi';
import { validateZopia, type ZopiaValidationResult } from './validation';
import { formatZopiaWarning, type ZopiaWarning } from './warnings';

/** Output channels used by the CLI command runner. */
export interface ZopiaCliOutput {
  /**
   * Write generated command output without diagnostics.
   *
   * @param content Command output to write to the standard-output channel.
   * @returns Nothing.
   */
  stdout(content: string): void;
  /**
   * Write one diagnostic line without contaminating generated output.
   *
   * @param content Diagnostic text to write to the standard-error channel.
   * @returns Nothing.
   */
  stderr(content: string): void;
}

interface GenerateArguments {
  input: string;
  outputDirectory?: string;
  mode?: 'directory' | 'flat';
  insertComponents: boolean;
  useComponentAsReference: boolean;
  manifest: boolean;
  config?: string;
  watch: boolean;
}

interface ReverseArguments {
  input: string;
  outputFile?: string;
  version?: '2.0' | '3.0' | '3.1';
  config?: string;
}

interface ValidateArguments {
  input: string;
  config?: string;
}

const HELP_TEXT = `Usage:
  zopia generate <spec.json|spec.yaml> [output-dir] [--mode directory|flat] [--insert-components] [--use-component-as-reference] [--no-manifest] [--watch] [--config path]
  zopia reverse <docs-dir|manifest.json> [--out file] [--version 2.0|3.0|3.1] [--config path]
  zopia validate <spec.json|spec.yaml|docs-dir> [--config path]

Global options:
  -h, --help                       Show this help.
  --config path                    Use an explicit config file instead of discovering zopia.config.ts in the
                                   working directory. CLI flags always override config values; config values
                                   override built-in defaults. With no config value the output directory stays
                                   a required positional argument for generate.

Generate options:
  --mode directory|flat            Select endpoint layout (default: config generate.mode, then directory).
  --insert-components              Emit component schema modules.
  --use-component-as-reference     Import emitted components; requires --insert-components.
  --no-manifest                    Do not write .zopia-manifest.json (overrides config generate.manifest).
  --watch                          Regenerate whenever the spec file changes (Ctrl+C to stop).

Reverse options:
  --out file                       Write JSON to a file instead of stdout (default: config reverse.out, then stdout).
  --version 2.0|3.0|3.1            Select OpenAPI output (default: config reverse.version, then 3.1).

Validate options:
  (none)                           Checks a spec for broken refs, name collisions, and unreachable components,
                                   or a generated tree for manifest problems, reverse dry-run failures, and km-api
                                   drift. Diagnostics print to stdout; exit status is 1 when any error-severity
                                   diagnostic was found.

Security: reverse executes generated TypeScript referenced by the manifest and the config file is executed
JavaScript; use only trusted trees and trusted config files.
`;

const processOutput: ZopiaCliOutput = {
  stdout: (content) => process.stdout.write(content),
  stderr: (content) => console.error(content),
};

function invalid(message: string, at: string, hint: string): never {
  throw new ZopiaError('ZOPIA_CONFIG_INVALID', message, { at, hint });
}

function usage(): never {
  invalid('usage: zopia generate <spec.json|spec.yaml> [output-dir] [options] | zopia reverse <docs-dir|manifest.json> [options]', 'argv', "run 'zopia --help' for command syntax");
}

function markOption(seen: Set<string>, option: string): void {
  if (seen.has(option)) invalid(`duplicate CLI option: ${option}`, option, `remove the repeated ${option} option`);
  seen.add(option);
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) invalid(`${option} requires a value`, option, `provide a value after ${option}`);
  return value;
}

function parseGenerate(argv: string[]): GenerateArguments {
  const positional: string[] = [];
  const seen = new Set<string>();
  let mode: 'directory' | 'flat' | undefined;
  let insertComponents = false;
  let useComponentAsReference = false;
  let manifest = true;
  let config: string | undefined;
  let watchMode = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      markOption(seen, argument);
      const value = optionValue(argv, index, argument);
      if (value !== 'directory' && value !== 'flat') invalid('invalid --mode; expected directory or flat', argument, "use '--mode directory' or '--mode flat'");
      mode = value;
      index += 1;
    } else if (argument === '--insert-components') {
      markOption(seen, argument);
      insertComponents = true;
    } else if (argument === '--use-component-as-reference') {
      markOption(seen, argument);
      useComponentAsReference = true;
    } else if (argument === '--no-manifest') {
      markOption(seen, argument);
      manifest = false;
    } else if (argument === '--config') {
      markOption(seen, argument);
      config = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--watch') {
      markOption(seen, argument);
      watchMode = true;
    } else if (argument.startsWith('-')) {
      invalid(`unknown generate option: ${argument}`, argument, "run 'zopia generate --help' for supported options");
    } else {
      positional.push(argument);
    }
  }

  if (positional.length < 1) invalid('generate requires <spec.json|spec.yaml>', 'argv', 'provide the input spec path');
  if (positional.length > 2) invalid(`unexpected generate argument: ${positional[2]}`, positional[2], 'remove the extra positional argument');
  return { input: positional[0], outputDirectory: positional[1], mode, insertComponents, useComponentAsReference, manifest, config, watch: watchMode };
}

function parseReverse(argv: string[]): ReverseArguments {
  const positional: string[] = [];
  const seen = new Set<string>();
  let outputFile: string | undefined;
  let version: '2.0' | '3.0' | '3.1' | undefined;
  let config: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') {
      markOption(seen, argument);
      outputFile = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--version') {
      markOption(seen, argument);
      const value = optionValue(argv, index, argument);
      if (value !== '2.0' && value !== '3.0' && value !== '3.1') invalid("invalid --version; expected '2.0', '3.0', or '3.1'", argument, "use '--version 2.0', '--version 3.0', or '--version 3.1'");
      version = value;
      index += 1;
    } else if (argument === '--config') {
      markOption(seen, argument);
      config = optionValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('-')) {
      invalid(`unknown reverse option: ${argument}`, argument, "run 'zopia reverse --help' for supported options");
    } else {
      positional.push(argument);
    }
  }

  if (positional.length < 1) invalid('reverse requires <docs-dir|manifest.json>', 'argv', 'provide a generated docs directory or manifest path');
  if (positional.length > 1) invalid(`unexpected reverse argument: ${positional[1]}`, positional[1], 'remove the extra positional argument');
  return { input: positional[0], outputFile, version, config };
}

function printWarnings(warnings: readonly ZopiaWarning[], output: ZopiaCliOutput): void {
  for (const warning of warnings) output.stderr(`Warning: ${formatZopiaWarning(warning)}`);
}

function parseValidate(argv: string[]): ValidateArguments {
  const positional: string[] = [];
  const seen = new Set<string>();
  let config: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config') {
      markOption(seen, argument);
      config = optionValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('-')) {
      invalid(`unknown validate option: ${argument}`, argument, "run 'zopia validate --help' for supported options");
    } else {
      positional.push(argument);
    }
  }

  if (positional.length < 1) invalid('validate requires <spec.json|spec.yaml|docs-dir>', 'argv', 'provide the spec path or generated docs directory');
  if (positional.length > 1) invalid(`unexpected validate argument: ${positional[1]}`, positional[1], 'remove the extra positional argument');
  return { input: positional[0], config };
}

function printValidation(result: ZopiaValidationResult, output: ZopiaCliOutput): void {
  for (const issue of result.diagnostics) {
    output.stdout(`${issue.severity === 'error' ? 'Error' : 'Warning'}: ${issue.code}${issue.at ? ` ${issue.at}` : ''}: ${issue.message}\n`);
  }
  const errors = result.diagnostics.filter((issue) => issue.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  output.stdout(`zopia validate ${result.kind} ${result.target}: ${errors === 0 ? 'ok' : 'failed'} (${errors} errors, ${warnings} warnings)\n`);
}

/**
 * Repeat engine ③ whenever the spec file changes.
 *
 * The initial run always executes once (surfacing the exact same errors as
 * non-watch generate). Subsequent runs are coalesced: bursts within 50 ms are
 * collapsed, and a change observed while a run is executing is re-run once the
 * active run settles. Warnings land on stderr in deterministic order; run
 * failures print the error and keep watching (spec edits are the natural fix).
 *
 * @param input Spec path to watch (JSON or YAML).
 * @param options Resolved generate options shared by every run.
 * @param output Destinations for generated output and diagnostics.
 * @param signal Optional abort signal that stops watching and settles the returned promise (CLI usage passes none).
 * @returns A promise that never resolves while watching (it resolves only if the watcher stops after a fatal error or abort).
 * @throws {@link ZopiaError} when the watched spec cannot be resolved to a file.
 */
export async function runGenerateWatch(input: string, options: Parameters<typeof openApiToApiDocs>[1], output: ZopiaCliOutput = processOutput, signal?: AbortSignal): Promise<never> {
  if (!input || typeof input !== 'string') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'watch mode requires a spec file path', { at: 'input', hint: 'pass a JSON or YAML spec path to `zopia generate --watch`' });
  const run = async (): Promise<void> => {
    try {
      const result = await openApiToApiDocs(input, options);
      printWarnings(result.warnings, output);
    } catch (error) {
      const typed = asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'watch run failed', { at: input });
      output.stderr(`Error: ${typed.message}`);
    }
  };
  await run();
  let running = false;
  let queued = false;
  const trigger = (): void => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void run().finally(() => {
      running = false;
      if (queued) {
        queued = false;
        trigger();
      }
    });
  };
  let debounce: ReturnType<typeof setTimeout> | undefined;
  // Watch the parent directory and filter on the spec basename: editors saving
  // atomically (write-temp + rename) replace the inode a naive file watcher is
  // bound to, which would silently end regeneration on Linux.
  const directory = dirname(input);
  const name = basename(input);
  const watcher = watch(directory, (eventType, filename) => {
    if (filename !== null && filename.toString() !== name) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(trigger, 50);
  });
  watcher.on('error', (error) => {
    output.stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    watcher.close();
  });
  return new Promise<never>((resolve) => {
    if (!signal) return;
    if (signal.aborted) {
      if (debounce) clearTimeout(debounce);
      watcher.close();
      resolve(undefined as never);
      return;
    }
    signal.addEventListener('abort', () => {
      if (debounce) clearTimeout(debounce);
      watcher.close();
      resolve(undefined as never);
    }, { once: true });
  });
}

/**
 * Run one zopia CLI command with independently routable output channels.
 *
 * @param argv Command arguments after the executable name.
 * @param output Destinations for generated output and diagnostics.
 * @returns A promise that resolves when generation or reverse conversion finishes.
 * @throws {@link ZopiaError} when arguments, conversion input, or filesystem output is invalid.
 */
export async function runCli(argv: string[], output: ZopiaCliOutput = processOutput): Promise<void> {
  if (!Array.isArray(argv) || !argv.every((argument) => typeof argument === 'string')) invalid('CLI arguments must be strings', 'argv', "run 'zopia --help' for command syntax");
  if (!output || typeof output.stdout !== 'function' || typeof output.stderr !== 'function') invalid('CLI output channels are invalid', 'output', 'provide stdout and stderr functions');
  if (argv.includes('--help') || argv.includes('-h')) {
    output.stdout(HELP_TEXT);
    return;
  }

  const [command, ...commandArguments] = argv;
  if (!command) usage();

  if (command === 'generate') {
    const parsed = parseGenerate(commandArguments);
    const project = await loadZopiaConfig({ file: parsed.config });
    const generateDefaults = project?.generate;
    const outputDirectory = parsed.outputDirectory ?? generateDefaults?.outDir;
    if (outputDirectory === undefined) invalid('generate requires <spec.json|spec.yaml> and <output-dir>', 'argv', 'provide both input and output paths, or set generate.outDir in zopia.config.ts');
    const options = {
      outDir: outputDirectory,
      mode: parsed.mode ?? generateDefaults?.mode,
      insertComponents: parsed.insertComponents || (generateDefaults?.insertComponents ?? false),
      useComponentAsReference: parsed.useComponentAsReference || (generateDefaults?.useComponentAsReference ?? false),
      // `--no-manifest` is explicit and always wins over config defaults.
      manifest: parsed.manifest && (generateDefaults?.manifest ?? true),
    };
    if (parsed.watch) {
      await runGenerateWatch(parsed.input, options, output);
      return;
    }
    const result = await openApiToApiDocs(parsed.input, options);
    printWarnings(result.warnings, output);
    return;
  }

  if (command === 'validate') {
    const parsed = parseValidate(commandArguments);
    // `--config` is accepted for grammar parity and future validate defaults (D-19);
    // validation currently has no configurable knobs, so the project file only needs
    // to load successfully when explicitly named.
    await loadZopiaConfig({ file: parsed.config });
    const result = await validateZopia(parsed.input);
    printValidation(result, output);
    const errors = result.diagnostics.filter((issue) => issue.severity === 'error').length;
    if (errors > 0) invalid(`zopia validate failed with ${errors} error${errors === 1 ? '' : 's'}`, parsed.input, 'resolve the reported error diagnostics');
    return;
  }

  if (command === 'reverse') {
    const parsed = parseReverse(commandArguments);
    const project = await loadZopiaConfig({ file: parsed.config });
    const reverseDefaults = project?.reverse;
    const outputFile = parsed.outputFile ?? reverseDefaults?.out;
    const result = await apiDocsToOpenApi(parsed.input, { version: parsed.version ?? reverseDefaults?.version ?? '3.1' });
    printWarnings(result.warnings, output);
    const content = `${JSON.stringify(result.openapi, null, 2)}\n`;
    if (outputFile) {
      try { await writeFile(outputFile, content, 'utf8'); }
      catch (error) { throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to write reverse output', { at: outputFile, hint: 'check the destination path and permissions' }); }
    } else output.stdout(content);
    return;
  }

  invalid(`unknown CLI command: ${command}`, command, "use 'zopia generate', 'zopia reverse', 'zopia validate', or 'zopia --help'");
}

/**
 * Run the CLI entry point and convert failures to deterministic diagnostics and
 * process-compatible exit codes.
 *
 * @param argv Command arguments after the executable name.
 * @param output Destinations for command output and diagnostics.
 * @returns `0` for success, `1` for a typed user error, or `2` for an unexpected failure.
 */
export async function runCliEntrypoint(argv: string[], output: ZopiaCliOutput = processOutput): Promise<0 | 1 | 2> {
  try {
    await runCli(argv, output);
    return 0;
  } catch (error) {
    if (error instanceof ZopiaError) {
      output.stderr(error.message);
      if (error.at) output.stderr(`At: ${error.at}`);
      output.stderr(`Hint: ${error.hint}`);
      return 1;
    }
    output.stderr(`Unexpected zopia failure: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
