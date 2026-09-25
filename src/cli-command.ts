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
  throw new Error('Usage: zopia generate <spec.json> <output-dir> [options] | zopia reverse <docs-dir|manifest.json> [--out file] [--version 3.0|3.1]');
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
    if (modeIndex >= 0 && mode !== 'directory' && mode !== 'flat') throw new Error('Invalid --mode; expected directory or flat');
    const result = await openApiToApiDocs(input, { outDir: generatedOutput, mode, insertComponents, useComponentAsReference, manifest });
    printWarnings(result.warnings, output);
    return;
  }
  if (command === 'reverse') {
    const versionIndex = argv.indexOf('--version');
    const version = versionIndex >= 0 ? argv[versionIndex + 1] : '3.1';
    if (version !== '3.0' && version !== '3.1') throw new Error("Invalid --version; expected '3.0' or '3.1'");
    const result = await apiDocsToOpenApi(input, { version });
    printWarnings(result.warnings, output);
    const outIndex = argv.indexOf('--out');
    const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
    if (outIndex >= 0 && !out) throw new Error('--out requires a file path');
    const content = `${JSON.stringify(result.openapi, null, 2)}\n`;
    if (out) await writeFile(out, content, 'utf8');
    else output.stdout(content);
    return;
  }
  usage();
}
