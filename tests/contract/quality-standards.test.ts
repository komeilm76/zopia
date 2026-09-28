import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceRoot = join(repositoryRoot, 'src');

function files(directory: string, extension?: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path, extension);
    return entry.isFile() && (extension === undefined || extname(entry.name) === extension) ? [path] : [];
  }).sort();
}

describe('quality standards contract', () => {
  it('T-16/R-1006/R-111: production transforms avoid locale, clock, random, and environment-dependent behavior', () => {
    const forbidden = [
      ['locale', 'Compare'].join(''),
      ['Date', '.now'].join(''),
      ['Math', '.random'].join(''),
      ['process', '.env'].join(''),
    ];
    const offenders: string[] = [];
    for (const file of files(sourceRoot, '.ts')) {
      const source = readFileSync(file, 'utf8');
      for (const token of forbidden) if (source.includes(token)) offenders.push(`${relative(repositoryRoot, file)}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it('T-16/R-1004: the package entry module contains re-exports only', () => {
    const file = join(sourceRoot, 'index.ts');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(source.statements.filter((statement) => !ts.isExportDeclaration(statement)).map((statement) => ts.SyntaxKind[statement.kind])).toEqual([]);
  });

  it('T-16/R-1007: conversion and public API modules do not evaluate strings or spawn commands', () => {
    const forbidden = [
      ['eval', '('].join(''),
      ['new', ' Function'].join(''),
      ["node:", 'child_process'].join(''),
    ];
    const offenders: string[] = [];
    for (const file of files(sourceRoot, '.ts')) {
      const source = readFileSync(file, 'utf8');
      for (const token of forbidden) if (source.includes(token)) offenders.push(`${relative(repositoryRoot, file)}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it('T-16/R-401: checked-in generated trees contain no trailing whitespace', () => {
    const expectedRoot = join(repositoryRoot, 'tests', 'fixtures', 'expected');
    const offenders: string[] = [];
    for (const file of files(expectedRoot)) {
      const content = readFileSync(file, 'utf8');
      content.split(/\r?\n/).forEach((line, index) => {
        if (/[ \t]+$/.test(line)) offenders.push(`${relative(repositoryRoot, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
