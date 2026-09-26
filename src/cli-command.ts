import { asZopiaError, ZopiaError } from './errors';
import { writeFile } from 'node:fs/promises';
import { openApiToApiDocs } from './conversions/openapi-to-api-docs-public';
import { apiDocsToOpenApi } from './conversions/manifest-to-openapi';
import { formatZopiaWarning, type ZopiaWarning } from './warnings';

/** Output channels used by the CLI command runner. */
export interface ZopiaCliOutput {
  /** Write generated command output without diagnostics. */
  stdout(content: string): void;
  /** Write one diagnostic line without contaminating generated output. */
  stderr(content: string): void;
}

const processOutput: ZopiaCliOutput = {
  stdout: (content) => process.stdout.write(content),
  stderr: (content) => console.error(content),
};

function usage(): never {
  throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'usage: zopia generate <spec.json> <output-dir> [options] | zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]', { hint: "run 'zopia --help' for command syntax" });
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
 */
export async function runCli(argv: string[], output: ZopiaCliOutput = processOutput): Promise<void> {
  if (!Array.isArray(argv) || !argv.every((argument) => typeof argument === 'string')) throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'CLI arguments must be strings', { at: 'argv', hint: "run 'zopia --help' for command syntax" });
  if (!output || typeof output.stdout !== 'function' || typeof output.stderr !== 'function') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'CLI output channels are invalid', { at: 'output', hint: 'provide stdout and stderr functions' });
  if (argv.includes('--help') || argv.includes('-h')) {
    output.stdout('Usage: zopia generate <spec.json> <output-dir> [--mode directory|flat] [--insert-components] [--use-component-as-reference] [--no-manifest]\n');
    output.stdout('       zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]\n');
    return;
  }
  const [command, input, generatedOutput] = argv;
  if (!command || !input) usage();
  if (command === 'generate') {
    if (!generatedOutput) usage();
    const modeIndex = argv.indexOf('--mode');
    const mode = modeIndex >= 0 ? argv[modeIndex + 1] as 'directory' | 'flat' : undefined;
    const insertComponents = argv.includes('--insert-components');
    const useComponentAsReference = argv.includes('--use-component-as-reference');
    const manifest = !argv.includes('--no-manifest');
    if (modeIndex >= 0 && mode !== 'directory' && mode !== 'flat') throw new ZopiaError('ZOPIA_CONFIG_INVALID', 'invalid --mode; expected directory or flat', { at: '--mode', hint: "use '--mode directory' or '--mode flat'" });
    const result = await openApiToApiDocs(input, { outDir: generatedOutput, mode, insertComponents, useComponentAsReference, manifest });
    printWarnings(result.warnings, output);
    return;
  }
  if (command === 'reverse') {
    const versionIndex = argv.indexOf('--version');
    const version = versionIndex >= 0 ? argv[versionIndex + 1] : '3.1';
    if (version !== '3.0' && version !== '3.1') throw new ZopiaError('ZOPIA_CONFIG_INVALID', "invalid --version; expected '3.0' or '3.1'", { at: '--version', hint: "use '--version 3.0' or '--version 3.1'" });
    const result = await apiDocsToOpenApi(input, { version });
    printWarnings(result.warnings, output);
    const outIndex = argv.indexOf('--out');
    const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
    if (outIndex >= 0 && !out) throw new ZopiaError('ZOPIA_CONFIG_INVALID', '--out requires a file path', { at: '--out', hint: 'provide the destination JSON file path' });
    const content = `${JSON.stringify(result.openapi, null, 2)}\n`;
    if (out) {
      try { await writeFile(out, content, 'utf8'); }
      catch (error) { throw asZopiaError(error, 'ZOPIA_FS_WRITE_FAILED', 'unable to write reverse output', { at: out, hint: 'check the destination path and permissions' }); }
    } else output.stdout(content);
    return;
  }
  usage();
}
