import { writeFile } from 'node:fs/promises';
import { asZopiaError, ZopiaError } from './errors';
import { openApiToApiDocs } from './conversions/openapi-to-api-docs-public';
import { apiDocsToOpenApi } from './conversions/manifest-to-openapi';
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
  outputDirectory: string;
  mode?: 'directory' | 'flat';
  insertComponents: boolean;
  useComponentAsReference: boolean;
  manifest: boolean;
}

interface ReverseArguments {
  input: string;
  outputFile?: string;
  version: '3.0' | '3.1';
}

const HELP_TEXT = `Usage:
  zopia generate <spec.json|spec.yaml> <output-dir> [--mode directory|flat] [--insert-components] [--use-component-as-reference] [--no-manifest]
  zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]

Global option:
  -h, --help                       Show this help.

Generate options:
  --mode directory|flat            Select endpoint layout (default: directory).
  --insert-components              Emit component schema modules.
  --use-component-as-reference     Import emitted components; requires --insert-components.
  --no-manifest                    Do not write .zopia-manifest.json.

Reverse options:
  --out file                       Write JSON to a file instead of stdout.
  --version 3.0|3.1                Select OpenAPI output (default: 3.1).

Security: reverse executes generated TypeScript referenced by the manifest; use only trusted trees.
`;

const processOutput: ZopiaCliOutput = {
  stdout: (content) => process.stdout.write(content),
  stderr: (content) => console.error(content),
};

function invalid(message: string, at: string, hint: string): never {
  throw new ZopiaError('ZOPIA_CONFIG_INVALID', message, { at, hint });
}

function usage(): never {
  invalid('usage: zopia generate <spec.json|spec.yaml> <output-dir> [options] | zopia reverse <docs-dir|manifest.json> [options]', 'argv', "run 'zopia --help' for command syntax");
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
    } else if (argument.startsWith('-')) {
      invalid(`unknown generate option: ${argument}`, argument, "run 'zopia generate --help' for supported options");
    } else {
      positional.push(argument);
    }
  }

  if (positional.length < 2) invalid('generate requires <spec.json|spec.yaml> and <output-dir>', 'argv', 'provide both input and output paths');
  if (positional.length > 2) invalid(`unexpected generate argument: ${positional[2]}`, positional[2], 'remove the extra positional argument');
  return { input: positional[0], outputDirectory: positional[1], mode, insertComponents, useComponentAsReference, manifest };
}

function parseReverse(argv: string[]): ReverseArguments {
  const positional: string[] = [];
  const seen = new Set<string>();
  let outputFile: string | undefined;
  let version: '3.0' | '3.1' = '3.1';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') {
      markOption(seen, argument);
      outputFile = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--version') {
      markOption(seen, argument);
      const value = optionValue(argv, index, argument);
      if (value !== '3.0' && value !== '3.1') invalid("invalid --version; expected '3.0' or '3.1'", argument, "use '--version 3.0' or '--version 3.1'");
      version = value;
      index += 1;
    } else if (argument.startsWith('-')) {
      invalid(`unknown reverse option: ${argument}`, argument, "run 'zopia reverse --help' for supported options");
    } else {
      positional.push(argument);
    }
  }

  if (positional.length < 1) invalid('reverse requires <docs-dir|manifest.json>', 'argv', 'provide a generated docs directory or manifest path');
  if (positional.length > 1) invalid(`unexpected reverse argument: ${positional[1]}`, positional[1], 'remove the extra positional argument');
  return { input: positional[0], outputFile, version };
}

function printWarnings(warnings: readonly ZopiaWarning[], output: ZopiaCliOutput): void {
  for (const warning of warnings) output.stderr(`Warning: ${formatZopiaWarning(warning)}`);
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
    const result = await openApiToApiDocs(parsed.input, {
      outDir: parsed.outputDirectory,
      mode: parsed.mode,
      insertComponents: parsed.insertComponents,
      useComponentAsReference: parsed.useComponentAsReference,
      manifest: parsed.manifest,
    });
    printWarnings(result.warnings, output);
    return;
  }

  if (command === 'reverse') {
    const parsed = parseReverse(commandArguments);
    const result = await apiDocsToOpenApi(parsed.input, { version: parsed.version });
    printWarnings(result.warnings, output);
    const content = `${JSON.stringify(result.openapi, null, 2)}\n`;
    if (parsed.outputFile) {
      try { await writeFile(parsed.outputFile, content, 'utf8'); }
      catch (error) { throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to write reverse output', { at: parsed.outputFile, hint: 'check the destination path and permissions' }); }
    } else output.stdout(content);
    return;
  }

  invalid(`unknown CLI command: ${command}`, command, "use 'zopia generate', 'zopia reverse', or 'zopia --help'");
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
