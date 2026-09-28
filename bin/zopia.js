#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const cli = resolve(directory, '..', 'src', 'cli.ts');
const child = spawn('bun', [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error('zopia requires Bun to run its CLI. Install Bun from https://bun.sh');
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
