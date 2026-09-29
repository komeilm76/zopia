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

type AuditedDeclaration = ts.ClassDeclaration | ts.EnumDeclaration | ts.FunctionDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.VariableStatement;

function declarationNames(node: AuditedDeclaration): string[] {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
  }
  return 'name' in node && node.name && ts.isIdentifier(node.name as ts.Node) ? [(node.name as ts.Identifier).text] : [];
}

function auditedDeclarations(source: ts.SourceFile): AuditedDeclaration[] {
  const namedExports = new Set(source.statements.flatMap((node) => ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)
    ? node.exportClause.elements.map((element) => (element.propertyName ?? element.name).text)
    : []));
  return source.statements.filter((node): node is AuditedDeclaration => (
    ts.isClassDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isFunctionDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isVariableStatement(node)
  ) && (isExported(node) || declarationNames(node).some((name) => namedExports.has(name))));
}

function publicMembers(node: ts.ClassDeclaration | ts.InterfaceDeclaration): readonly ts.ClassElement[] | readonly ts.TypeElement[] {
  if (ts.isInterfaceDeclaration(node)) return node.members;
  return node.members.filter((member) => !hasModifier(member, ts.SyntaxKind.PrivateKeyword)
    && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
    && !(member.name && ts.isPrivateIdentifier(member.name)));
}

function nestedShapeMembers(node: AuditedDeclaration): ts.TypeElement[] {
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

function functionLikeDeclarations(node: AuditedDeclaration): Array<ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration> {
  if (ts.isFunctionDeclaration(node)) return [node];
  if (!ts.isClassDeclaration(node)) return [];
  return publicMembers(node).filter((member): member is ts.MethodDeclaration | ts.ConstructorDeclaration => ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member));
}

interface ShapeCallable {
  documentationNode: ts.Node;
  parameters: readonly ts.ParameterDeclaration[];
}

function variableCallables(node: AuditedDeclaration): ShapeCallable[] {
  if (!ts.isVariableStatement(node)) return [];
  return node.declarationList.declarations.flatMap((declaration) => {
    if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
      return [{ documentationNode: node, parameters: declaration.initializer.parameters }];
    }
    if (declaration.type && ts.isFunctionTypeNode(declaration.type)) {
      return [{ documentationNode: node, parameters: declaration.type.parameters }];
    }
    return [];
  });
}

function shapeCallables(node: AuditedDeclaration): ShapeCallable[] {
  const members = ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    ? [...publicMembers(node), ...nestedShapeMembers(node)]
    : nestedShapeMembers(node);
  const callables: ShapeCallable[] = [];
  if (ts.isTypeAliasDeclaration(node) && ts.isFunctionTypeNode(node.type)) callables.push({ documentationNode: node, parameters: node.type.parameters });
  for (const member of members) {
    if (ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
      callables.push({ documentationNode: member, parameters: member.parameters });
    } else if ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) && member.type && ts.isFunctionTypeNode(member.type)) {
      callables.push({ documentationNode: member, parameters: member.type.parameters });
    } else if (ts.isPropertyDeclaration(member) && member.initializer && (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))) {
      callables.push({ documentationNode: member, parameters: member.initializer.parameters });
    }
  }
  return callables;
}

function containsThrow(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (ts.isThrowStatement(child)) found = true;
    else if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function parameterName(parameter: ts.ParameterDeclaration, source: ts.SourceFile): string {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : parameter.name.getText(source);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exampleDiagnostics(code: string): readonly ts.Diagnostic[] {
  const file = join(repositoryRoot, '.zopia-jsdoc-example.ts');
  const options: ts.CompilerOptions = {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: { zopia: ['./src/index.ts'] },
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (candidate) => candidate === file || fileExists(candidate);
  host.readFile = (candidate) => candidate === file ? code : readFile(candidate);
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => candidate === file
    ? ts.createSourceFile(file, code, languageVersion, true, ts.ScriptKind.TS)
    : getSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
}

describe('public JSDoc contract', () => {
  it('S-75/T-12: every exported declaration has a useful summary', () => {
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
        const members: readonly ts.Node[] = ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)
          ? [...publicMembers(declaration), ...nestedShapeMembers(declaration)]
          : ts.isEnumDeclaration(declaration) ? declaration.members : nestedShapeMembers(declaration);
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
        const inspect = (documentationNode: ts.Node, parameters: readonly ts.ParameterDeclaration[], returns: boolean, mayThrow: boolean): void => {
          const comment = jsDoc(documentationNode, parsed.text) ?? '';
          const subject = `${relative(repositoryRoot, parsed.file)}:${line(documentationNode, parsed.source)} ${label(declaration, parsed.source)}`;
          for (const parameter of parameters) {
            const name = parameterName(parameter, parsed.source);
            const parameterTag = new RegExp(`@param\\s+${escapeRegularExpression(name)}\\s+\\S`);
            if (!parameterTag.test(comment)) failures.push(`${subject} missing specific @param ${name}`);
          }
          if (returns && !/@returns\s+\S/.test(comment)) failures.push(`${subject} missing specific @returns`);
          if (mayThrow && !/@throws(?:\s+\{[^}]+\})?\s+\S/.test(comment)) failures.push(`${subject} missing specific @throws`);
          for (const throwsTag of comment.matchAll(/@throws(?:\s+\{[^}]+\})?\s*([^\r\n*]*)/g)) {
            if (!throwsTag[1].trim()) failures.push(`${subject} has an empty @throws`);
          }
        };
        for (const callable of functionLikeDeclarations(declaration)) inspect(callable, callable.parameters, !ts.isConstructorDeclaration(callable), containsThrow(callable));
        for (const callable of variableCallables(declaration)) inspect(callable.documentationNode, callable.parameters, true, containsThrow(callable.documentationNode));
        for (const callable of shapeCallables(declaration)) inspect(callable.documentationNode, callable.parameters, true, false);
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-132: every optional field in exported configuration shapes states its default', () => {
    const failures: string[] = [];
    for (const parsed of parsedSources) {
      for (const declaration of auditedDeclarations(parsed.source)) {
        const [name] = declarationNames(declaration);
        if (!name?.endsWith('Options')) continue;
        const members = ts.isInterfaceDeclaration(declaration) ? [...declaration.members]
          : ts.isTypeAliasDeclaration(declaration) ? nestedShapeMembers(declaration) : [];
        for (const member of members) {
          if (!member.questionToken) continue;
          const comment = jsDoc(member, parsed.text) ?? '';
          if (!/@default\s+\S/.test(comment)) {
            failures.push(`${relative(repositoryRoot, parsed.file)}:${line(member, parsed.source)} ${name}.${label(member, parsed.source)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('R-133: TypeScript examples are syntactically and semantically valid modules', () => {
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
          const diagnostics = exampleDiagnostics(code).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
          if (diagnostics.length) failures.push(`${relative(repositoryRoot, parsed.file)} ${label(declaration, parsed.source)} example ${index + 1}: ${diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

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
