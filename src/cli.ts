#!/usr/bin/env bun
import { ZopiaError } from './errors';
import { runCli } from './cli-command';

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof ZopiaError && error.hint) console.error(`Hint: ${error.hint}`);
  process.exitCode = 1;
});
