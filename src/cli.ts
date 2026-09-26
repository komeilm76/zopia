#!/usr/bin/env bun
import { runCliEntrypoint } from './cli-command';

process.exitCode = await runCliEntrypoint(process.argv.slice(2));
