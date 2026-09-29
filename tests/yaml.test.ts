import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifestFileToOpenApi, openApiToApiDocs } from '../src';
import { runCli } from '../src/cli-command';
import { ZOPIA_ERROR_CODES } from '../src/errors';
import { parseYaml } from '../src/conversions/yaml';
import { useTemporaryDirectories } from './test-temporary-directories';

const fixtureDirectory = join(import.meta.dirname, 'fixtures', 'specs');
const temporaryDirectory = useTemporaryDirectories('zopia-yaml-');

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

async function treeSnapshot(root: string, directory = root): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await treeSnapshot(root, path));
    else if (entry.isFile()) snapshot[path.slice(root.length + 1).replace(/\\/g, '/')] = await readFile(path, 'utf8');
  }
  return Object.fromEntries(Object.entries(snapshot).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixtureDirectory, name), 'utf8');
}

const MINIMAL_YAML = `openapi: 3.0.0
info:
  title: Mini
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        '204': { description: Healthy }
`;

const MINIMAL_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Mini', version: '1.0.0' },
  paths: { '/health': { get: { responses: { 204: { description: 'Healthy' } } } } },
});

describe('yaml engine ③ input (S-77, D-16)', () => {
  it.each(['admin-api-3.0', 'admin-api-2.0'])('S-77: fixture %s parses to an object identical to its JSON twin', async (fixture) => {
    // Arrange / Act
    const fromJson = JSON.parse(await readFixture(`${fixture}.json`));
    const fromYaml = parseYaml(await readFixture(`${fixture}.yaml`));

    // Assert
    expect(fromYaml).toEqual(fromJson);
  });

  it.each(['admin-api-3.0', 'admin-api-2.0'])('S-77: a .yaml spec generates a byte-identical tree to its .json twin', async (fixture) => {
    // Arrange
    const yamlOut = await temporaryDirectory();
    const jsonOut = await temporaryDirectory();

    // Act
    const yamlResult = await openApiToApiDocs(join(fixtureDirectory, `${fixture}.yaml`), { outDir: yamlOut, insertComponents: true, useComponentAsReference: true });
    const jsonResult = await openApiToApiDocs(join(fixtureDirectory, `${fixture}.json`), { outDir: jsonOut, insertComponents: true, useComponentAsReference: true });

    // Assert
    expect(yamlResult.files).toEqual(jsonResult.files);
    expect(yamlResult.warnings).toEqual(jsonResult.warnings);
    expect(await treeSnapshot(yamlOut)).toEqual(await treeSnapshot(jsonOut));
  });

  it.each(['admin-api-3.0', 'admin-api-2.0'])('S-77/T-11: reverse conversion of a YAML-generated tree reproduces the source after canonicalization', async (fixture) => {
    // Arrange
    const outDir = await temporaryDirectory();

    // Act
    await openApiToApiDocs(join(fixtureDirectory, `${fixture}.yaml`), { outDir });
    const reversed = await manifestFileToOpenApi(join(outDir, '.zopia-manifest.json'));
    const source = JSON.parse(await readFixture(`${fixture}.json`));

    // Assert
    expect(canonicalize(reversed)).toEqual(canonicalize(source));
  });

  it('S-77: inline YAML text input generates the same tree as equivalent JSON text', async () => {
    // Arrange
    const yamlOut = await temporaryDirectory();
    const jsonOut = await temporaryDirectory();

    // Act
    await openApiToApiDocs(MINIMAL_YAML, { outDir: yamlOut });
    await openApiToApiDocs(MINIMAL_JSON, { outDir: jsonOut });

    // Assert
    expect(await treeSnapshot(yamlOut)).toEqual(await treeSnapshot(jsonOut));
  });

  it('S-77: a .yml extension is accepted', async () => {
    // Arrange
    const directory = await temporaryDirectory();
    const ymlPath = join(directory, 'spec.yml');
    await writeFile(ymlPath, MINIMAL_YAML, 'utf8');

    // Act
    const result = await openApiToApiDocs(ymlPath, { outDir: join(directory, 'docs') });

    // Assert
    expect(result.files.some((file) => file.path.endsWith('index.ts'))).toBe(true);
    expect(result.manifestPath).toBe('.zopia-manifest.json');
  });

  it('S-77: an extension-less spec file falls back to YAML when it is not JSON', async () => {
    // Arrange
    const directory = await temporaryDirectory();
    const specPath = join(directory, 'spec-file');
    await writeFile(specPath, MINIMAL_YAML, 'utf8');

    // Act
    const result = await openApiToApiDocs(specPath, { outDir: join(directory, 'docs') });

    // Assert
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('S-77/R-931…R-934: the CLI generates from a .yaml path', async () => {
    // Arrange
    const directory = await temporaryDirectory();
    const outDir = join(directory, 'api_docs');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const output = { stdout: (content: string) => { stdout.push(content); }, stderr: (content: string) => { stderr.push(content); } };

    // Act
    await runCli(['generate', join(fixtureDirectory, 'admin-api-3.0.yaml'), outDir], output);

    // Assert
    expect(await treeSnapshot(outDir)).toHaveProperty('.zopia-manifest.json');
    expect(stdout).toEqual([]);
    expect(stderr.every((line) => line.startsWith('Warning: ZOPIA_WARN_'))).toBe(true);
  });

  it('S-77: input-shape errors map to stable codes for YAML inputs', async () => {
    // Arrange
    const directory = await temporaryDirectory();
    const missingYaml = join(directory, 'missing.yaml');
    const brokenYaml = join(directory, 'broken.yaml');
    await writeFile(brokenYaml, 'a: 1\na: 2\n', 'utf8');

    // Act / Assert
    await expect(openApiToApiDocs(missingYaml, { outDir: join(directory, 'a') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_YAML', at: missingYaml });
    await expect(openApiToApiDocs(brokenYaml, { outDir: join(directory, 'b') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_YAML', at: brokenYaml });
    await expect(openApiToApiDocs('x: [1,', { outDir: join(directory, 'c') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_YAML', at: 'line 1' });
    await expect(openApiToApiDocs('null', { outDir: join(directory, 'd') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID_JSON', at: 'null' });
    await expect(openApiToApiDocs('- scalar\n', { outDir: join(directory, 'e') })).rejects.toMatchObject({ code: 'ZOPIA_SPEC_INVALID', at: '#' });
    expect(ZOPIA_ERROR_CODES).toContain('ZOPIA_SPEC_INVALID_YAML');
  });

  it('S-77: JSON-looking text in a .yaml file still parses (flow YAML)', async () => {
    // Arrange
    const directory = await temporaryDirectory();
    const yamlPath = join(directory, 'spec.yaml');
    await writeFile(yamlPath, MINIMAL_JSON, 'utf8');

    // Act
    const result = await openApiToApiDocs(yamlPath, { outDir: join(directory, 'docs') });

    // Assert
    expect(result.files.length).toBeGreaterThan(0);
  });
});

describe('parseYaml language coverage (S-78, D-16)', () => {
  it('S-78: resolves YAML 1.2 core-schema scalars and rejects non-JSON numbers', () => {
    // Arrange / Act / Assert
    expect(parseYaml('a: null\nb: ~\nc:\n')).toEqual({ a: null, b: null, c: null });
    expect(parseYaml('a: True\nb: FALSE\nc: on\nd: yes\n')).toEqual({ a: true, b: false, c: 'on', d: 'yes' });
    expect(parseYaml('a: 42\nb: -7\nc: 0x1F\nd: 0o17\ne: 3.5\nf: 1e3\ng: .5\n')).toEqual({ a: 42, b: -7, c: 31, d: 15, e: 3.5, f: 1000, g: 0.5 });
    expect(parseYaml('a: 2024-01-01\nb: 1.2.0\n')).toEqual({ a: '2024-01-01', b: '1.2.0' });
    expect(() => parseYaml('x: .inf\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(() => parseYaml('x: .NaN\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
  });

  it('S-78: parses nested block mappings and sequences, including same-indent sequences under a key', () => {
    expect(parseYaml('a:\n  b:\n    c: 1\n  d: 2\n')).toEqual({ a: { b: { c: 1 }, d: 2 } });
    expect(parseYaml('a:\n- 1\n- 2\nb: c\n')).toEqual({ a: [1, 2], b: 'c' });
    expect(parseYaml('- name: a\n  in: q\n- name: b\n  additional:\n    - { name: x }\n')).toEqual([
      { name: 'a', in: 'q' },
      { name: 'b', additional: [{ name: 'x' }] },
    ]);
    expect(parseYaml('- - a\n  - b\n- c\n')).toEqual([['a', 'b'], 'c']);
  });

  it('S-78: parses flow collections inline and across lines', () => {
    expect(parseYaml('a: {m: 1, n: [x, y], o: {p: two}}\n')).toEqual({ a: { m: 1, n: ['x', 'y'], o: { p: 'two' } } });
    expect(parseYaml('a: [1,\n 2,\n 3]\n')).toEqual({ a: [1, 2, 3] });
    expect(parseYaml('a: {}\nb: []\n')).toEqual({ a: {}, b: [] });
    expect(parseYaml('a: {"quoted key": 1}\n')).toEqual({ a: { 'quoted key': 1 } });
    expect(parseYaml('a: [http://example.test/x, {url: https://example.test}]\n')).toEqual({ a: ['http://example.test/x', { url: 'https://example.test' }] });
  });

  it('S-78: quoted scalars decode escapes and fold multi-line content', () => {
    expect(parseYaml("a: 'it''s ok'\n")).toEqual({ a: "it's ok" });
    expect(parseYaml('a: "tab\\t nl\\n hex\\x41 u\\u0042 U\\U00000043"\n')).toEqual({ a: 'tab\t nl\n hexA uB UC' });
    expect(parseYaml('a: "multi\n  line\n\n  folded"\n')).toEqual({ a: 'multi line\nfolded' });
    expect(parseYaml("a: 'single\n  line'\n")).toEqual({ a: 'single line' });
    expect(parseYaml('a: "join\\\n  continued"\n')).toEqual({ a: 'joincontinued' });
    expect(parseYaml('"quoted: key": 1\n')).toEqual({ 'quoted: key': 1 });
  });

  it('S-78: block scalars support literal/folded styles, chomping modes, and indent indicators', () => {
    expect(parseYaml('a: |\n  x\n  y\n')).toEqual({ a: 'x\ny\n' });
    expect(parseYaml('a: |-\n  x\n  y\n')).toEqual({ a: 'x\ny' });
    expect(parseYaml('a: |+\n  x\n\n\n')).toEqual({ a: 'x\n\n\n' });
    expect(parseYaml('a: >\n  x\n  y\n')).toEqual({ a: 'x y\n' });
    expect(parseYaml('a: >-\n  x\n\n  y\n')).toEqual({ a: 'x\ny' });
    expect(parseYaml('a: >\n  x\n    deeper\n  y\n')).toEqual({ a: 'x\n  deeper\ny\n' });
    expect(parseYaml('a: |2\n    x\n    y\n')).toEqual({ a: '  x\n  y\n' });
    expect(parseYaml('a: >4-\n      x\n      y\n')).toEqual({ a: '  x\n  y' });
  });

  it('S-78: comments parse everywhere and trailing comments are stripped', () => {
    expect(parseYaml('# head\na: 1 # tail\n# full\nb: 2\n')).toEqual({ a: 1, b: 2 });
    expect(parseYaml('a: v#not-comment\nb: v2 # comment\n')).toEqual({ a: 'v#not-comment', b: 'v2' });
  });

  it('S-78: anchors, aliases, and merge keys resolve with explicit keys winning', () => {
    expect(parseYaml('base: &b\n  x: 1\n  y: 2\nderived:\n  <<: *b\n  y: 3\n')).toEqual({ base: { x: 1, y: 2 }, derived: { x: 1, y: 3 } });
    expect(parseYaml('a: &a 1\nb: *a\n')).toEqual({ a: 1, b: 1 });
    expect(parseYaml('one: &one { x: 1 }\ntwo: &two { y: 2 }\nmerged: { <<: [*one, *two], z: 3 }\n')).toEqual({ one: { x: 1 }, two: { y: 2 }, merged: { x: 1, y: 2, z: 3 } });
    expect(parseYaml("m: { '<<': literal }\n")).toEqual({ m: { '<<': 'literal' } });
  });

  it('S-78: directives and document markers frame a single document', () => {
    expect(parseYaml('%YAML 1.2\n---\na: 1\n...\n')).toEqual({ a: 1 });
    expect(parseYaml('---\na: 1\n')).toEqual({ a: 1 });
    expect(parseYaml('--- {a: 1}\n')).toEqual({ a: 1 });
    expect(parseYaml('a: 1\n...\n')).toEqual({ a: 1 });
  });

  it('S-78: stringifies non-string mapping keys like a JSON round-trip', () => {
    expect(parseYaml('200: ok\ntrue: yes\nnull: n\n3.5: v\n')).toEqual({ 200: 'ok', true: 'yes', null: 'n', '3.5': 'v' });
    expect(parseYaml("'200': ok\n")).toEqual({ 200: 'ok' });
  });

  it('S-78: empty sequence items stay at their own level and indentless sequences under keys still work', () => {
    // Regression: a bare '-' item followed by a sibling dash must be null, not
    // a nested sequence that swallows the sibling (A1/A2).
    expect(parseYaml('-\n- b\n')).toEqual([null, 'b']);
    expect(parseYaml('-\n-\n- 3\n')).toEqual([null, null, 3]);
    expect(parseYaml('k:\n- a\n- b\n')).toEqual({ k: ['a', 'b'] });
    expect(parseYaml('-\n  - deep\n- b\n')).toEqual([['deep'], 'b']);
    expect(parseYaml('- - \n- c\n')).toEqual([[null], 'c']);
    expect(parseYaml('- # comment\n- 2\n')).toEqual([null, 2]);
  });

  it('S-78: a lone dash after a mapping key is the plain scalar', () => {
    // Regression (C1): `k: -` parsed as an empty sequence instead of the scalar.
    expect(parseYaml('k: -\n')).toEqual({ k: '-' });
    expect(parseYaml('k: - # comment\n')).toEqual({ k: '-' });
    expect(parseYaml('[-, -]\n')).toEqual(['-', '-']);
  });

  it('S-78: `#` lines indented as content are literal block-scalar content', () => {
    // Regression (B1/B2/B3): comment lines at content indent were silently
    // dropped from block scalars (real descriptions lost lines).
    expect(parseYaml('k: |\n  a\n  # note\n  b\n')).toEqual({ k: 'a\n# note\nb\n' });
    expect(parseYaml('k: >\n  a\n  # note\n  b\n')).toEqual({ k: 'a # note b\n' });
    expect(parseYaml('k: |\n  a\n# note\n  b\nq: 1\n')).toEqual({ k: 'a\nb\n', q: 1 });
    expect(parseYaml('k: |\n  # only\n')).toEqual({ k: '# only\n' });
    expect(parseYaml('k: |2\n  # via indicator\n')).toEqual({ k: '# via indicator\n' });
  });

  it('S-78: comments inside multi-line flow collections cannot corrupt quote/depth tracking', () => {
    // Regression (D1/D2): a quote or unbalanced brace inside a flow comment
    // broke capture of the enclosing collection.
    expect(parseYaml("a: [1, 2,\n  # don't stop\n  3]\n")).toEqual({ a: [1, 2, 3] });
    expect(parseYaml('a: [1, 2,\n  # see {usage} note\n  3]\n')).toEqual({ a: [1, 2, 3] });
    expect(parseYaml("a: {m: 1,\n  # don't stop\n  n: 2}\n")).toEqual({ a: { m: 1, n: 2 } });
    expect(parseYaml('a: [1,\n  # plain\n  3]\n')).toEqual({ a: [1, 3] });
  });

  it('S-78: block scalar headers reject content that is not a comment', () => {
    // Regression (E1): `k: | junk` was silently accepted.
    expect(() => parseYaml('k: | junk\n  a\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(() => parseYaml('k: |- junk\n  a\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(parseYaml('k: | # comment\n  a\n')).toEqual({ k: 'a\n' });
    expect(parseYaml('k: |2 #comment\n  a\n')).toEqual({ k: 'a\n' });
  });

  it('S-78: structure-looking plain continuations fail instead of silently folding', () => {
    // Regression (F1/F2): `k: word` followed by a deeper `a: b` or `- x` line
    // silently folded into the scalar ("word a: b") instead of erroring.
    expect(() => parseYaml('k: word\n  a: b\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(() => parseYaml('k: word\n  - x\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(() => parseYaml('k: word\n  # c\n  a: b\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(parseYaml('k: word\n  word2\n')).toEqual({ k: 'word word2' });
    expect(parseYaml("k: word\n  'quoted'\n")).toEqual({ k: "word 'quoted'" });
  });

  it('S-78: trailing commas are allowed inside flow collections', () => {
    // Regression (G1/G2): YAML permits a trailing comma before the closer.
    expect(parseYaml('a: [1, 2,]\n')).toEqual({ a: [1, 2] });
    expect(parseYaml('a: {b: 1,}\n')).toEqual({ a: { b: 1 } });
    expect(parseYaml('a: [1,\n 2,\n]\n')).toEqual({ a: [1, 2] });
    expect(() => parseYaml('a: [1,, 2]\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
  });

  it('S-78: aliases clone the anchored value (no shared identity downstream)', () => {
    // Regression (I1): aliases handed the same object instance to every
    // consumer; mutation or visited-set walkers could misbehave.
    const parsed = parseYaml('defaults: &d {a: 1}\nx: *d\ny: *d\n') as Record<string, Record<string, unknown>>;
    expect(parsed.x).toEqual({ a: 1 });
    expect(parsed.y).toEqual({ a: 1 });
    expect(parsed.x).not.toBe(parsed.y);
    expect(parsed.x.a).not.toBeUndefined();
  });

  it('S-78: the end-of-document marker must stand alone', () => {
    // Regression (O1): `... x` was silently accepted and one fix iteration
    // briefly swallowed the line after `...`.
    expect(() => parseYaml('a: 1\n... x\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(() => parseYaml('a: 1\n...\nb: 2\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(parseYaml('a: 1\n... # comment\n')).toEqual({ a: 1 });
  });

  it('S-78: flow collections take comments, blank lines, spanning quotes, and document entries', () => {
    // Regression: a bare ': ' inside a flow plain scalar terminates it, so a
    // missing comma in a flow mapping becomes a clear error (G1-class).
    expect(() => parseYaml('a: {b: 1 c: 2}\n')).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    expect(parseYaml('a: [one two, three]\n')).toEqual({ a: ['one two', 'three'] });
    expect(parseYaml('a: [http://example.test/x]\n')).toEqual({ a: ['http://example.test/x'] });
    expect(parseYaml('a: {"url:quoted: ok": 1}\n')).toEqual({ a: { 'url:quoted: ok': 1 } });
    expect(parseYaml('a: {url: http://x}\n')).toEqual({ a: { url: 'http://x' } });
    expect(parseYaml('a: [1,\n\n 2]\n')).toEqual({ a: [1, 2] });
    expect(parseYaml('a: [1,\n 2,\n]\n')).toEqual({ a: [1, 2] });
    expect(parseYaml('a: ["q\\"s",\n 2]\n')).toEqual({ a: ['q"s', 2] });
    expect(parseYaml("a: ['it''s',\n 2]\n")).toEqual({ a: ["it's", 2] });
    expect(parseYaml("a: [1, # don't\n 2]\n")).toEqual({ a: [1, 2] });
  });

  it('S-78: anchors and aliases work inside flow collections', () => {
    expect(parseYaml('a: {v: &x 1, w: *x}\n')).toEqual({ a: { v: 1, w: 1 } });
    expect(parseYaml('a: [&y {m: 2}]\nb: *y\n')).toEqual({ a: [{ m: 2 }], b: { m: 2 } });
  });

  it('S-78/R-404: malformed and unsupported YAML fails with ZOPIA_SPEC_INVALID_YAML', () => {
    const flowErrors: Array<[string, string]> = [
      ['entries missing a comma in a flow mapping', 'a: {b: 1 c: 2}\n'],
      ['a bare `key: value` pair entry inside a flow sequence', 'a: [k: v]\n'],
      ['a comma at the start of a flow mapping', 'a: {,b: 1}\n'],
      ['a comma at the start of a flow sequence', 'a: [,1]\n'],
      ['complex flow mapping keys', 'a: {{k: v}: 1}\n'],
      ['unterminated quoted scalars-in-flow', 'a: {"kl: 1}\n'],
      ['tags inside a flow collection', 'a: [!!str 1]\n'],
      ['reserved indicator starts inside a flow scalar', 'a: [`x]\n'],
      ['malformed anchors inside a flow collection', 'a: [& 1]\n'],
      ['malformed aliases inside a flow collection', 'a: [*]\n'],
      ['out-of-range unicode escapes', 'a: "\\U00110000"\n'],
      ['unicode surrogate escapes', 'a: "\\uD800"\n'],
      ['structure-looking continuations after a mapping-like start', 'a: word\n  b: c\n'],
    ];
    for (const [label, text] of flowErrors) {
      expect(() => parseYaml(text), label).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    }
  });

  it('S-78/R-404: malformed and unsupported YAML fails with ZOPIA_SPEC_INVALID_YAML', () => {
    const cases: Array<[string, string]> = [
      ['tabs', 'a:\n\tb: 1\n'],
      ['duplicate keys', 'a: 1\na: 2\n'],
      ['duplicate flow keys', 'a: {x: 1, x: 2}\n'],
      ['undefined aliases', 'x: *missing\n'],
      ['undefined flow aliases', 'x: [*missing]\n'],
      ['multiple documents', 'a: 1\n---\nb: 2\n'],
      ['content after `...`', 'a: 1\n...\nb: 2\n'],
      ['custom tags', 'x: !!str 1\n'],
      ['unknown escapes', 'x: "\\q"\n'],
      ['invalid unicode escapes', 'x: "\\u12"\n'],
      ['unterminated flows', 'x: [1, 2\n'],
      ['unterminated quoted scalars', "x: 'abc\n"],
      ["value-position ':'", 'x: a: b\n'],
      ['inline nested mappings', 'x: k: v\n'],
      ['sequence after an inline value', 'a: b\n- c\n'],
      ['complex keys', '? a\n: 1\n'],
      ['bad merge sources', 'a: &a [1, 2]\nb: { <<: *a, x: 1 }\n'],
      ['scalar merge values', 'a: &a 1\nb:\n  <<: *a\n'],
      ['empty flow keys', 'a: {: 1}\n'],
      ['anchors on aliases', 'a: 1\nb: &b *missing\n'],
      ['unsupported directives', '%TAG ! !\n---\na: 1\n'],
      ['directives without `---`', '%YAML 1.2\na: 1\n'],
      ['empty documents', '# nothing here\n'],
      ['empty input', ''],
      ['bad block headers', 'a: |x\n  t\n'],
      ['plain scalars starting with ?', 'a: ?orly\n'],
    ];
    for (const [label, text] of cases) {
      expect(() => parseYaml(text), label).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
    }
  });

  it('S-78/R-1006: documents deeper than the recursion guard fail deterministically', () => {
    // Arrange
    const deep = `a:\n${Array.from({ length: 600 }, (_, index) => `${'  '.repeat(index + 1)}n${index}:`).join('\n')}\n${'  '.repeat(601)}v: 1\n`;

    // Act / Assert
    expect(() => parseYaml(deep)).toThrowError(expect.objectContaining({ code: 'ZOPIA_SPEC_INVALID_YAML' }));
  });

  it('S-78/P-1: parsing is deterministic across runs', () => {
    const text = MINIMAL_YAML;
    expect(JSON.stringify(parseYaml(text))).toBe(JSON.stringify(parseYaml(text)));
  });
});
