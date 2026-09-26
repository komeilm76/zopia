#!/usr/bin/env bun
import { ZopiaError } from './errors';
import { runCli } from './cli-command';

runCli(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ZopiaError) {
    console.error(error.message);
    if (error.at) console.error(`At: ${error.at}`);
    console.error(`Hint: ${error.hint}`);
    process.exitCode = 1;
    return;
  }
  console.error(`Unexpected zopia failure: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
