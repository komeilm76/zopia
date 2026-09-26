import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceRoot = join(repositoryRoot, 'src');

interface ParsedSource {
  file: string;
  source: ts.SourceFile;
  text: string;
}

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(entry.name) === '.ts' ? [path] : [];
  }).sort();
}

function parse(file: string): ParsedSource {
  const text = readFileSync(file, 'utf8');
  return {
    file,
    source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    text,
  };
}

const parsedSources = sourceFiles().map(parse);
const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean => Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
const isExported = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.ExportKeyword);

function jsDoc(node: ts.Node, text: string): string | undefined {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const range = [...ranges].reverse().find((candidate) => text.slice(candidate.pos, candidate.end).startsWith('/**'));
  return range ? text.slice(range.pos, range.end) : undefined;
}

function summary(comment: string): string {
  const body = comment.slice(3, -2).split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join(' ');
  return body.split(/\s@[A-Za-z]+\b/, 1)[0].trim();
}

function line(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function label(node: ts.Node, source: ts.SourceFile): string {
  if ('name' in node && node.name && ts.isIdentifier(node.name as ts.Node)) return (node.name as ts.Identifier).text;
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((declaration) => declaration.name.getText(source)).join(', ');
  return ts.SyntaxKind[node.kind];
}

function auditedDeclarations(source: ts.SourceFile): ts.DeclarationStatement[] {
  return source.statements.filter((node): node is ts.DeclarationStatement => isExported(node) && (
    ts.isClassDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isFunctionDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isVariableStatement(node)
  ));
}

function publicMembers(node: ts.ClassDeclaration | ts.InterfaceDeclaration): readonly ts.ClassElement[] | readonly ts.TypeElement[] {
  if (ts.isInterfaceDeclaration(node)) return node.members;
  return node.members.filter((member) => !hasModifier(member, ts.SyntaxKind.PrivateKeyword)
    && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
    && !(member.name && ts.isPrivateIdentifier(member.name)));
}

function nestedShapeMembers(node: ts.DeclarationStatement): ts.TypeElement[] {
  const members: ts.TypeElement[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isTypeLiteralNode(child)) members.push(...child.members);
    ts.forEachChild(child, visit);
  };
  if (ts.isTypeAliasDeclaration(node)) visit(node.type);
  else if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
    for (const member of node.members) {
      const type = (member as ts.Node & { type?: ts.TypeNode }).type;
      if (type) visit(type);
    }
  }
  return members;
}

function functionLikeDeclarations(node: ts.DeclarationStatement): Array<ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration> {
  if (ts.isFunctionDeclaration(node)) return [node];
  if (!ts.isClassDeclaration(node)) return [];
  return publicMembers(node).filter((member): member is ts.MethodDeclaration | ts.ConstructorDeclaration => ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member));
}

function parameterName(parameter: ts.ParameterDeclaration, source: ts.SourceFile): string {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : parameter.name.getText(source);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('public JSDoc contract', () => {
  it('T-12: every exported declaration has a useful summary', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        const comment = jsDoc(declaration, parsed.text);
        if (!comment || summary(comment).length < 12) {
          failures.push(`${relative(repositoryRoot, parsed.file)}:${line(declaration, parsed.source)} ${label(declaration, parsed.source)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('T-12: every exposed interface and class member has a useful summary', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        const members = ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)
          ? [...publicMembers(declaration), ...nestedShapeMembers(declaration)]
          : nestedShapeMembers(declaration);
        for (const member of members) {
          const comment = jsDoc(member, parsed.text);
          if (!comment || summary(comment).length < 8) {
            failures.push(`${relative(repositoryRoot, parsed.file)}:${line(member, parsed.source)} ${label(declaration, parsed.source)}.${label(member, parsed.source)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-131: exported callables document every parameter and return value specifically', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        for (const callable of functionLikeDeclarations(declaration)) {
          const comment = jsDoc(callable, parsed.text) ?? '';
          const subject = `${relative(repositoryRoot, parsed.file)}:${line(callable, parsed.source)} ${label(declaration, parsed.source)}`;
          for (const parameter of callable.parameters) {
            const name = parameterName(parameter, parsed.source);
            const parameterTag = new RegExp(`@param\\s+${escapeRegularExpression(name)}\\s+\\S`);
            if (!parameterTag.test(comment)) failures.push(`${subject} missing specific @param ${name}`);
          }
          if (!ts.isConstructorDeclaration(callable) && !/@returns\s+\S/.test(comment)) failures.push(`${subject} missing specific @returns`);
          for (const throwsTag of comment.matchAll(/@throws(?:\s+\{[^}]+\})?\s*([^\r\n*]*)/g)) {
            if (!throwsTag[1].trim()) failures.push(`${subject} has an empty @throws`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-132: every optional field in exported configuration shapes states its default', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        if (!ts.isInterfaceDeclaration(declaration) || !declaration.name.text.endsWith('Options')) continue;
        for (const member of declaration.members) {
          if (!member.questionToken) continue;
          const comment = jsDoc(member, parsed.text) ?? '';
          if (!/@default\s+\S/.test(comment)) {
            failures.push(`${relative(repositoryRoot, parsed.file)}:${line(member, parsed.source)} ${declaration.name.text}.${label(member, parsed.source)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-133: TypeScript examples are syntactically executable modules', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        const comment = jsDoc(declaration, parsed.text) ?? '';
        const exampleTags = [...comment.matchAll(/@example\b/g)];
        const examples = [...comment.matchAll(/@example[\s\S]*?```ts\s*\n([\s\S]*?)```/g)];
        if (exampleTags.length !== examples.length) {
          failures.push(`${relative(repositoryRoot, parsed.file)} ${label(declaration, parsed.source)} has an invalid @example block`);
        }
        for (const [index, match] of examples.entries()) {
          const code = match[1].split(/\r?\n/).map((entry) => entry.replace(/^\s*\*\s?/, '')).join('\n');
          const result = ts.transpileModule(code, {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
            fileName: 'example.ts',
            reportDiagnostics: true,
          });
          const diagnostics = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
          if (diagnostics.length) failures.push(`${relative(repositoryRoot, parsed.file)} ${label(declaration, parsed.source)} example ${index + 1}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-135: relative documentation links in @see tags resolve', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        const comment = jsDoc(declaration, parsed.text) ?? '';
        const seeTags = [...comment.matchAll(/@see\b/g)];
        const links = [...comment.matchAll(/@see[^\r\n]*\]\(([^)]+)\)/g)];
        if (seeTags.length !== links.length) {
          failures.push(`${relative(repositoryRoot, parsed.file)} ${label(declaration, parsed.source)} has an invalid @see link`);
        }
        for (const match of links) {
          const target = match[1].split('#', 1)[0];
          if (!/^[a-z]+:/i.test(target) && !existsSync(resolve(dirname(parsed.file), target))) {
            failures.push(`${relative(repositoryRoot, parsed.file)} ${label(declaration, parsed.source)}: ${match[1]}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-1003: production modules do not use default exports', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      const visit = (node: ts.Node): void => {
        if (ts.isExportAssignment(node) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
          failures.push(`${relative(repositoryRoot, parsed.file)}:${line(node, parsed.source)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed.source);
    }
    expect(failures).toEqual([]);
  });
});
