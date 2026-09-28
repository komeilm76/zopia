import { ZopiaError } from '../errors';

/** 🧾 One input line with its 1-based number kept for diagnostics. */
interface YamlLine {
  /** 1-based source line number used in diagnostics. */
  no: number;
  /** Raw line text after BOM/newline normalization. */
  text: string;
}

/** 🔎 A structural line: blank and full-comment lines are already skipped. */
interface SignificantLine {
  /** 1-based source line number used in diagnostics. */
  no: number;
  /** Count of leading spaces (tab indentation is rejected before scanning). */
  indent: number;
  /** Line text after the indentation columns. */
  content: string;
}

/** 🧠 Mutable parse state shared by every nested parse; no environment or I/O access (P-3). */
interface ParserContext {
  /** Normalized source lines; `index` selects the next unconsumed raw line. */
  lines: YamlLine[];
  /** Index of the next raw line to consume. */
  index: number;
  /** Anchor table; anchors are declared before their aliases, so aliases cannot cycle. */
  anchors: Map<string, unknown>;
  /** Recursion depth guard against hostile nesting. */
  depth: number;
}

/** Value position inside a captured flow collection. */
interface FlowCursor {
  /** Complete captured flow text (may span several physical lines). */
  text: string;
  /** Current scan position inside `text`. */
  pos: number;
  /** Source line where the flow collection started, for diagnostics. */
  line: number;
}

/** A single- or double-quote character used as a scalar delimiter. */
type YamlQuote = '"' | "'";

/** 🔍 Result of detecting a `key: …` entry on a line. */
interface KeyProbe {
  /** Decoded key text (quotes removed; plain text verbatim). */
  key: string;
  /** Whether the key was quoted — a quoted `<<` is never a merge indicator. */
  quoted: boolean;
  /** Remainder of the line after the separating colon. */
  rest: string;
}

/** One parsed mapping entry before duplicate/merge resolution. */
interface MappingEntry {
  /** Stringified mapping key (YAML scalar keys become strings). */
  key: string;
  /** Whether the entry is an unquoted `<<` merge indicator. */
  merge: boolean;
  /** Parsed entry value. */
  value: unknown;
}

const YAML_MAX_DEPTH = 512;

/** Every YAML syntax/structure rejection is one stable typed error. */
function invalidYaml(reason: string, line: number): ZopiaError {
  return new ZopiaError('ZOPIA_SPEC_INVALID_YAML', `invalid YAML at line ${line}: ${reason}`, { at: `line ${line}`, hint: 'fix the YAML syntax' });
}

function fail(reason: string, line: number): never {
  throw invalidYaml(reason, line);
}

function normalizeLines(text: string): YamlLine[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const parts = normalized.split('\n');
  // A terminal line break closes the final line; it does not open an extra empty one.
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.map((lineText, index) => ({ no: index + 1, text: lineText }));
}

function measureIndent(line: YamlLine): number {
  let indent = 0;
  while (indent < line.text.length) {
    const character = line.text[indent];
    if (character === ' ') indent += 1;
    else if (character === '\t') fail('tab indentation is not supported; use spaces', line.no);
    else break;
  }
  return indent;
}

function isSkippable(text: string): boolean {
  const trimmed = text.replace(/^[ \t]+/, '');
  return trimmed === '' || trimmed.startsWith('#');
}

function peekSignificant(ctx: ParserContext): SignificantLine | null {
  for (let probe = ctx.index; probe < ctx.lines.length; probe += 1) {
    const line = ctx.lines[probe];
    if (isSkippable(line.text)) continue;
    const indent = measureIndent(line);
    return { no: line.no, indent, content: line.text.slice(indent) };
  }
  return null;
}

function consumeSignificant(ctx: ParserContext): SignificantLine | null {
  const line = peekSignificant(ctx);
  if (!line) return null;
  ctx.index = line.no;
  return line;
}

function isDashEntry(content: string): boolean {
  return content === '-' || (content.startsWith('-') && (content[1] === ' ' || content[1] === '\t'));
}

function isDocumentStart(content: string): boolean {
  return /^---(?:[ \t]|$)/.test(content);
}

function isDocumentEnd(content: string): boolean {
  return /^\.{3}(?:[ \t]|$)/.test(content);
}

function enter(ctx: ParserContext, line: number): void {
  ctx.depth += 1;
  if (ctx.depth > YAML_MAX_DEPTH) fail(`document nesting is too deep (maximum ${YAML_MAX_DEPTH} levels)`, line);
}

const NULL_PATTERN = /^(?:~|null|Null|NULL)$/;
const TRUE_PATTERN = /^(?:true|True|TRUE)$/;
const FALSE_PATTERN = /^(?:false|False|FALSE)$/;
const INT_PATTERN = /^[-+]?[0-9]+$/;
const OCTAL_PATTERN = /^0o[0-7]+$/;
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;
const FLOAT_PATTERN = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const NON_JSON_NUMBER_PATTERN = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

/** YAML 1.2 core-schema scalar resolution, keeping parsed values JSON-compatible (D-16). */
function resolvePlainScalar(text: string, line: number): unknown {
  if (NULL_PATTERN.test(text)) return null;
  if (TRUE_PATTERN.test(text)) return true;
  if (FALSE_PATTERN.test(text)) return false;
  if (INT_PATTERN.test(text)) return Number.parseInt(text, 10);
  if (OCTAL_PATTERN.test(text)) return Number.parseInt(text.slice(2), 8);
  if (HEX_PATTERN.test(text)) return Number.parseInt(text.slice(2), 16);
  if (FLOAT_PATTERN.test(text)) return Number.parseFloat(text);
  if (NON_JSON_NUMBER_PATTERN.test(text)) fail(`'${text}' cannot be represented as a JSON number; quote it to keep a string`, line);
  return text;
}

/** Strip a trailing comment from plain text (a `#` after whitespace) and drop trailing separation. */
function cutPlainComment(text: string): string {
  if (text.startsWith('#')) return '';
  const marker = /[ \t]#/.exec(text);
  const cut = marker ? text.slice(0, marker.index + 1) : text;
  return cut.replace(/[ \t]+$/, '');
}

/** Fold pre-cut multi-line content: single breaks become spaces, blank lines keep one break each. */
function assembleMultiline(first: string, continuations: string[]): string {
  let text = first;
  let blanks = 0;
  for (const content of continuations) {
    if (content === '') {
      blanks += 1;
      continue;
    }
    if (blanks > 0) {
      text += `${'\n'.repeat(blanks)}${content}`;
      blanks = 0;
    } else text += ` ${content}`;
  }
  return text;
}

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\u0007',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\u000B',
  f: '\f',
  r: '\r',
  e: '\u001B',
  '"': '"',
  '/': '/',
  '\\': '\\',
  ' ': ' ',
  N: '\u0085',
  _: '\u00A0',
  L: '\u2028',
  P: '\u2029',
};

/** Decode a double-quoted body: YAML escapes, folded line breaks, and escaped-line-break continuations. */
function decodeDoubleQuoted(raw: string, line: number): string {
  let result = '';
  let index = 0;
  while (index < raw.length) {
    const character = raw[index];
    if (character === '\n') {
      let feeds = 0;
      while (index < raw.length && (raw[index] === '\n' || raw[index] === ' ' || raw[index] === '\t')) {
        if (raw[index] === '\n') feeds += 1;
        index += 1;
      }
      result += feeds <= 1 ? ' ' : '\n'.repeat(feeds - 1);
      continue;
    }
    if (character !== '\\') {
      result += character;
      index += 1;
      continue;
    }
    const next = raw[index + 1];
    if (next === '\n') {
      // Escaped line break: the continuation joins the next line without a folded space.
      index += 2;
      while (index < raw.length && (raw[index] === ' ' || raw[index] === '\t')) index += 1;
      continue;
    }
    if (next === 'x' || next === 'u' || next === 'U') {
      const length = next === 'x' ? 2 : next === 'u' ? 4 : 8;
      const digits = raw.slice(index + 2, index + 2 + length);
      if (digits.length !== length || !/^[0-9a-fA-F]+$/.test(digits)) fail(`invalid \\${next} escape in a double-quoted scalar`, line);
      const codePoint = Number.parseInt(digits, 16);
      if (!Number.isFinite(codePoint) || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) fail('invalid Unicode escape in a double-quoted scalar', line);
      result += String.fromCodePoint(codePoint);
      index += 2 + length;
      continue;
    }
    const replacement = next === undefined ? undefined : DOUBLE_QUOTE_ESCAPES[next];
    if (replacement === undefined) fail(`unknown escape '\\${next}' in a double-quoted scalar`, line);
    result += replacement;
    index += 2;
  }
  return result;
}

/** Decode a single-quoted body: the only escape is a doubled quote; line breaks fold like plain text. */
function decodeSingleQuoted(raw: string): string {
  return raw.replace(/''/g, "'").replace(/\n[ \t]*(?:\n[ \t]*)*/g, (breaks) => {
    const feeds = breaks.replace(/[ \t]/g, '').length;
    return feeds <= 1 ? ' ' : '\n'.repeat(feeds - 1);
  });
}

function skipFlowWhitespace(cursor: FlowCursor): void {
  for (;;) {
    const character = cursor.text[cursor.pos];
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') cursor.pos += 1;
    else if (character === '#') {
      while (cursor.pos < cursor.text.length && cursor.text[cursor.pos] !== '\n') cursor.pos += 1;
    } else return;
  }
}

/** Scan a quoted scalar body inside a captured buffer; reports where the closing quote sits. */
function scanQuotedClose(text: string, quote: YamlQuote): { closed: boolean; end: number; raw: string } {
  let raw = '';
  let index = 1;
  while (index < text.length) {
    const character = text[index];
    if (quote === '"' && character === '\\') {
      raw += character + (index + 1 < text.length ? text[index + 1] : '');
      index += 2;
      continue;
    }
    if (character === quote) {
      if (quote === "'" && text[index + 1] === "'") {
        raw += "''";
        index += 2;
        continue;
      }
      return { closed: true, end: index, raw };
    }
    raw += character;
    index += 1;
  }
  return { closed: false, end: -1, raw };
}

function scanFlowQuoted(cursor: FlowCursor, quote: YamlQuote): string {
  const scan = scanQuotedClose(cursor.text.slice(cursor.pos), quote);
  if (!scan.closed) fail('unterminated quoted scalar inside a flow collection', cursor.line);
  cursor.pos += scan.end + 1;
  return quote === '"' ? decodeDoubleQuoted(scan.raw, cursor.line) : decodeSingleQuoted(scan.raw);
}

function parseFlowValue(ctx: ParserContext, cursor: FlowCursor): unknown {
  enter(ctx, cursor.line);
  try {
    skipFlowWhitespace(cursor);
    const character = cursor.text[cursor.pos];
    if (character === undefined) fail('unexpected end of a flow collection', cursor.line);
    if (character === '{') return parseFlowMapping(ctx, cursor);
    if (character === '[') return parseFlowSequence(ctx, cursor);
    if (character === '&') {
      const anchorText = /^&([A-Za-z0-9_.-]+)/.exec(cursor.text.slice(cursor.pos));
      if (!anchorText) fail('malformed anchor inside a flow collection', cursor.line);
      cursor.pos += anchorText[0].length;
      const value = parseFlowValue(ctx, cursor);
      ctx.anchors.set(anchorText[1], value);
      return value;
    }
    if (character === '*') {
      const aliasText = /^\*([A-Za-z0-9_.-]+)/.exec(cursor.text.slice(cursor.pos));
      if (!aliasText) fail('malformed alias inside a flow collection', cursor.line);
      cursor.pos += aliasText[0].length;
      if (!ctx.anchors.has(aliasText[1])) fail(`undefined alias: *${aliasText[1]}`, cursor.line);
      return cloneValue(ctx.anchors.get(aliasText[1]));
    }
    if (character === '!') fail('YAML tags are not supported in flow collections', cursor.line);
    if (character === '%' || character === '@' || character === '`') fail(`a plain scalar must not start with '${character}'`, cursor.line);
    if (character === "'" || character === '"') return scanFlowQuoted(cursor, character);
    const start = cursor.pos;
    while (cursor.pos < cursor.text.length && ![',', ']', '}', '{', '['].includes(cursor.text[cursor.pos])) {
      if (cursor.text[cursor.pos] === ':') {
        const afterColon = cursor.text[cursor.pos + 1];
        // A ':' followed by separation (or a bracket) ends a flow plain scalar;
        // the missing comma then fails against the collection grammar.
        if (afterColon === undefined || [' ', '\t', ',', ']', '}', '{', '['].includes(afterColon)) break;
      }
      if (cursor.text[cursor.pos] === '#' && cursor.pos > start && (cursor.text[cursor.pos - 1] === ' ' || cursor.text[cursor.pos - 1] === '\t')) break;
      cursor.pos += 1;
    }
    const scalar = cursor.text.slice(start, cursor.pos).replace(/\s+/g, ' ').trim();
    if (scalar === '') fail('expected a value inside the flow collection', cursor.line);
    return resolvePlainScalar(scalar, cursor.line);
  } finally {
    ctx.depth -= 1;
  }
}

/** Earlier merge sources win over later ones; explicit keys always win over merged keys. */
function applyMappingEntries(entries: MappingEntry[], line: number): Record<string, unknown> {
  const explicit = new Map<string, unknown>();
  const merges: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (entry.merge) {
      const sources = Array.isArray(entry.value) ? entry.value : [entry.value];
      for (const source of sources) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) fail('a `<<` merge value must be a mapping or a sequence of mappings (usually aliases)', line);
        merges.push(source as Record<string, unknown>);
      }
      continue;
    }
    if (explicit.has(entry.key)) fail(`duplicate mapping key: '${entry.key}'`, line);
    explicit.set(entry.key, entry.value);
  }
  const result: Record<string, unknown> = {};
  for (const source of merges) for (const [key, value] of Object.entries(source)) if (!(key in result)) result[key] = value;
  for (const [key, value] of explicit) result[key] = value;
  return result;
}

function parseFlowMapping(ctx: ParserContext, cursor: FlowCursor): Record<string, unknown> {
  enter(ctx, cursor.line);
  try {
    const entries: MappingEntry[] = [];
    cursor.pos += 1;
    skipFlowWhitespace(cursor);
    if (cursor.text[cursor.pos] === '}') {
      cursor.pos += 1;
      return {};
    }
    for (;;) {
      skipFlowWhitespace(cursor);
      const character = cursor.text[cursor.pos];
      if (character === undefined) fail('unterminated flow mapping', cursor.line);
      if (character === '}' || character === ',') fail(`unexpected '${character}' inside a flow mapping`, cursor.line);
      let key: string;
      let quoted = false;
      if (character === "'" || character === '"') {
        quoted = true;
        key = scanFlowQuoted(cursor, character);
      } else {
        const start = cursor.pos;
        while (cursor.pos < cursor.text.length && ![':', ',', '}', '{', '['].includes(cursor.text[cursor.pos])) cursor.pos += 1;
        key = cursor.text.slice(start, cursor.pos).replace(/\s+/g, ' ').trim();
        if (key === '') fail('a flow mapping key must not be empty', cursor.line);
        if (cursor.text[cursor.pos] !== ':' && cursor.text[cursor.pos] !== ',' && cursor.text[cursor.pos] !== '}') fail('complex flow mapping keys are not supported', cursor.line);
        if (key !== '<<') key = String(resolvePlainScalar(key, cursor.line));
      }
      skipFlowWhitespace(cursor);
      let value: unknown = null;
      if (cursor.text[cursor.pos] === ':') {
        cursor.pos += 1;
        skipFlowWhitespace(cursor);
        if (cursor.text[cursor.pos] === undefined) fail('unterminated flow mapping', cursor.line);
        if (cursor.text[cursor.pos] !== ',' && cursor.text[cursor.pos] !== '}') value = parseFlowValue(ctx, cursor);
      }
      entries.push({ key, merge: key === '<<' && !quoted, value });
      skipFlowWhitespace(cursor);
      if (cursor.text[cursor.pos] === ',') {
        cursor.pos += 1;
        skipFlowWhitespace(cursor);
        if (cursor.text[cursor.pos] === '}') {
          cursor.pos += 1;
          return applyMappingEntries(entries, cursor.line);
        }
        continue;
      }
      if (cursor.text[cursor.pos] === '}') {
        cursor.pos += 1;
        return applyMappingEntries(entries, cursor.line);
      }
      fail("expected ',' or '}' inside the flow mapping", cursor.line);
    }
  } finally {
    ctx.depth -= 1;
  }
}

function parseFlowSequence(ctx: ParserContext, cursor: FlowCursor): unknown[] {
  enter(ctx, cursor.line);
  try {
    const items: unknown[] = [];
    cursor.pos += 1;
    skipFlowWhitespace(cursor);
    if (cursor.text[cursor.pos] === ']') {
      cursor.pos += 1;
      return items;
    }
    for (;;) {
      skipFlowWhitespace(cursor);
      if (cursor.text[cursor.pos] === undefined) fail('unterminated flow sequence', cursor.line);
      if (cursor.text[cursor.pos] === ',') fail("unexpected ',' inside a flow sequence", cursor.line);
      items.push(parseFlowValue(ctx, cursor));
      skipFlowWhitespace(cursor);
      if (cursor.text[cursor.pos] === ',') {
        cursor.pos += 1;
        skipFlowWhitespace(cursor);
        if (cursor.text[cursor.pos] === ']') {
          cursor.pos += 1;
          return items;
        }
        continue;
      }
      if (cursor.text[cursor.pos] === ']') {
        cursor.pos += 1;
        return items;
      }
      fail("expected ',' or ']' inside the flow sequence", cursor.line);
    }
  } finally {
    ctx.depth -= 1;
  }
}

/** The remainder after an inline value must be only separation and an optional comment. */
function assertNoTrailingContent(rest: string, line: number): void {
  const trimmed = rest.replace(/^[ \t]+/, '');
  if (trimmed !== '' && !trimmed.startsWith('#')) fail(`unexpected content after the value: '${trimmed.slice(0, 32)}'`, line);
}

/** Capture a (possibly multi-line) flow collection that starts at `[` or `{`, then parse it. */
function parseFlowNode(ctx: ParserContext, rest: string, lineNo: number, parentIndent: number): unknown {
  let buffer = rest;
  let depth = 0;
  let quote: YamlQuote | undefined;
  let index = 0;
  for (;;) {
    const character = buffer[index];
    if (character === undefined) {
      let extended = false;
      while (ctx.index < ctx.lines.length) {
        const line = ctx.lines[ctx.index];
        if (isSkippable(line.text) && line.text.replace(/^[ \t]+/, '') === '') {
          buffer += '\n';
          ctx.index += 1;
          continue;
        }
        // Flow collections ignore indentation: the closing bracket may be dedented.
        buffer += `\n${line.text}`;
        ctx.index += 1;
        extended = true;
        break;
      }
      if (!extended) fail('unterminated flow collection', lineNo);
      continue;
    }
    if (quote) {
      if (quote === '"' && character === '\\') index += 2;
      else if (character === quote) {
        if (quote === "'" && buffer[index + 1] === "'") index += 2;
        else {
          quote = undefined;
          index += 1;
        }
      } else index += 1;
      continue;
    }
    const previous = index > 0 ? buffer[index - 1] : '\\n';
    if (character === '#' && (previous === ' ' || previous === '\\t' || previous === '\\n')) {
      // Comments inside a captured flow collection are skipped for capture so
      // quotes/braces inside them cannot corrupt quote- or depth-tracking.
      while (index < buffer.length && buffer[index] !== '\\n') index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) {
        assertNoTrailingContent(buffer.slice(index + 1), lineNo);
        return parseFlowValue(ctx, { text: buffer, pos: 0, line: lineNo });
      }
    }
    index += 1;
  }
}

/** Alias resolutions clone the anchored value so shared identity never reaches downstream walkers. */
function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneValue(entry)]));
  return value;
}

/** Literal/folded block scalar with every chomping mode and optional indent indicators. */
function parseBlockScalar(ctx: ParserContext, style: '|' | '>', header: string, lineNo: number, parentIndent: number): string {
  let chomping: '+' | '-' | undefined;
  let digit: number | undefined;
  let index = 1;
  for (; index < header.length; index += 1) {
    const character = header[index];
    if ((character === '+' || character === '-') && chomping === undefined) chomping = character as '+' | '-';
    else if (/^[1-9]$/.test(character) && digit === undefined) digit = Number.parseInt(character, 10);
    else break;
  }
  const remainder = header.slice(index);
  if (!/^[ \t]*(?:#.*)?$/.test(remainder)) fail(`unexpected content in the block scalar header: '${remainder.replace(/^[ \t]+/, '').slice(0, 16)}'`, lineNo);
  let contentIndent = digit !== undefined ? parentIndent + digit : undefined;
  const rows: Array<{ blank: boolean; text: string; extraIndent: number }> = [];
  while (ctx.index < ctx.lines.length) {
    const line = ctx.lines[ctx.index];
    const trimmed = line.text.replace(/^[ \t]+/, '');
    if (trimmed === '') {
      rows.push({ blank: true, text: '', extraIndent: 0 });
      ctx.index += 1;
      continue;
    }
    const indent = measureIndent(line);
    if (trimmed.startsWith('#')) {
      // A '#' line indented as deeply as the content is literal block-scalar
      // content (block scalars embed no comments); a shallower '#' line is an
      // ignorable comment that neither terminates nor folds the scalar.
      const isContent = contentIndent === undefined ? indent > parentIndent : indent >= contentIndent;
      if (isContent) {
        if (contentIndent === undefined) contentIndent = indent;
        rows.push({ blank: false, text: line.text.slice(contentIndent), extraIndent: indent - contentIndent });
      }
      ctx.index += 1;
      continue;
    }
    if (contentIndent === undefined) {
      if (indent <= parentIndent) break;
      contentIndent = indent;
    }
    if (indent < contentIndent) break;
    rows.push({ blank: false, text: line.text.slice(contentIndent), extraIndent: indent - contentIndent });
    ctx.index += 1;
  }
  const lastContent = rows.reduce((last, row, index) => (row.blank ? last : index), -1);
  const body = rows.slice(0, lastContent + 1);
  const trailing = rows.length - body.length;
  let text: string;
  if (style === '|') text = body.map((row) => row.text).join('\n');
  else {
    // Folded style: empty lines keep exactly one break each; breaks around
    // more-indented lines stay literal; every other line break folds to a space.
    text = '';
    let blanks = 0;
    let previousExtra = 0;
    let firstContent = true;
    for (const row of body) {
      if (row.blank) {
        blanks += 1;
        continue;
      }
      if (firstContent) {
        text = `${'\n'.repeat(blanks)}${row.text}`;
        firstContent = false;
      } else text += `${blanks > 0 ? '\n'.repeat(blanks) : previousExtra > 0 || row.extraIndent > 0 ? '\n' : ' '}${row.text}`;
      blanks = 0;
      previousExtra = row.extraIndent;
    }
  }
  if (lastContent === -1) return chomping === '+' ? '\n'.repeat(trailing) : '';
  if (chomping === '-') return text;
  if (chomping === '+') return `${text}\n${'\n'.repeat(trailing)}`;
  return `${text}\n`;
}

/** Scan a possibly multi-line quoted scalar; the closing line must carry nothing but a comment. */
function parseQuotedNode(ctx: ParserContext, firstText: string, lineNo: number, parentIndent: number, quote: YamlQuote): string {
  let text = firstText;
  for (;;) {
    const scan = scanQuotedClose(text, quote);
    if (scan.closed) {
      assertNoTrailingContent(text.slice(scan.end + 1), lineNo);
      return quote === '"' ? decodeDoubleQuoted(scan.raw, lineNo) : decodeSingleQuoted(scan.raw);
    }
    const line = ctx.lines[ctx.index];
    if (!line) fail(`unterminated ${quote === '"' ? 'double' : 'single'}-quoted scalar`, lineNo);
    const trimmed = line.text.replace(/^[ \t]+/, '');
    if (trimmed !== '' && measureIndent(line) <= parentIndent) fail(`unterminated ${quote === '"' ? 'double' : 'single'}-quoted scalar`, lineNo);
    text += `\n${line.text}`;
    ctx.index += 1;
  }
}

/** Detect a `key: …` entry on a line; returns null when the line does not start a mapping entry. */
function probeMappingKey(content: string, line: number): KeyProbe | null {
  const first = content[0];
  if (first === undefined || '[{]},&*!|>%@`'.includes(first)) return null;
  if (first === "'" || first === '"') {
    const scan = scanQuotedClose(content, first);
    if (!scan.closed) return null;
    const rest = content.slice(scan.end + 1).replace(/^[ \t]+/, '');
    if (!rest.startsWith(':')) return null;
    const afterColon = rest.slice(1);
    if (afterColon !== '' && !/^[ \t]/.test(afterColon)) return null;
    return { key: first === '"' ? decodeDoubleQuoted(scan.raw, line) : decodeSingleQuoted(scan.raw), quoted: true, rest: afterColon };
  }
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== ':') continue;
    const after = content[index + 1];
    if (after !== undefined && after !== ' ' && after !== '\t') continue;
    return { key: content.slice(0, index).replace(/[ \t]+$/, ''), quoted: false, rest: content.slice(index + 1) };
  }
  return null;
}

function resolveMappingKey(probe: KeyProbe, line: number): string {
  if (probe.quoted) return probe.key;
  if (probe.key === '') fail('a mapping key must not be empty', line);
  if (probe.key === '<<') return probe.key;
  const value = resolvePlainScalar(probe.key, line);
  return typeof value === 'string' ? value : String(value);
}

/** Plain (unquoted) scalar, possibly folded across more-indented continuation lines. */
function parsePlainNode(ctx: ParserContext, first: string, lineNo: number, parentIndent: number): unknown {
  const firstLine = cutPlainComment(first);
  if (/:[ \t]/.test(firstLine) || firstLine.endsWith(':')) fail("a plain scalar must not contain ': ' or end with ':'", lineNo);
  const continuations: string[] = [];
  while (ctx.index < ctx.lines.length) {
    const line = ctx.lines[ctx.index];
    if (isSkippable(line.text)) {
      // Blank lines fold to breaks; comment lines inside a multi-line plain scalar are invisible.
      if (line.text.replace(/^[ \t]+/, '') === '') continuations.push('');
      ctx.index += 1;
      continue;
    }
    const indent = measureIndent(line);
    if (indent <= parentIndent) break;
    const content = line.text.slice(indent);
    if (isDashEntry(content)) fail('a multi-line plain continuation must not start a sequence entry (bad indentation)', line.no);
    const probe = probeMappingKey(content, line.no);
    if (probe) fail(`a multi-line plain continuation must not start a mapping entry (bad indentation): '${probe.key}:'`, line.no);
    continuations.push(cutPlainComment(content));
    ctx.index += 1;
  }
  while (continuations.length > 0 && continuations[continuations.length - 1] === '') continuations.pop();
  return resolvePlainScalar(assembleMultiline(firstLine, continuations), lineNo);
}

/** One mapping entry: its value may live inline or on nested following lines. */
function readMappingEntry(ctx: ParserContext, probe: KeyProbe, line: number, mappingIndent: number): MappingEntry {
  const key = resolveMappingKey(probe, line);
  if (!probe.quoted && probe.key === '?') fail('explicit `?` mapping keys are not supported', line);
  const value = parseInlineNode(ctx, probe.rest, line, mappingIndent, mappingIndent + 2, false);
  return { key, merge: key === '<<' && !probe.quoted, value };
}

/** Collect every `key: value` line at `mappingIndent`, starting with an already-read inline entry. */
function collectMappingEntries(ctx: ParserContext, mappingIndent: number, inlineStart?: { probe: KeyProbe; line: number }): MappingEntry[] {
  const entries: MappingEntry[] = [];
  if (inlineStart) entries.push(readMappingEntry(ctx, inlineStart.probe, inlineStart.line, mappingIndent));
  for (;;) {
    const line = peekSignificant(ctx);
    if (!line || line.indent !== mappingIndent || isDashEntry(line.content)) break;
    if (isDocumentStart(line.content) || isDocumentEnd(line.content)) break;
    const probe = probeMappingKey(line.content, line.no);
    if (!probe) fail('expected a `key: value` mapping entry', line.no);
    consumeSignificant(ctx);
    entries.push(readMappingEntry(ctx, probe, line.no, mappingIndent));
  }
  return entries;
}

/** Sequence items at a fixed indent; inline starts are dispatched through `parseInlineNode`. */
function parseSequenceFrom(ctx: ParserContext, sequenceIndent: number, inline?: { content: string; line: number; itemIndent: number }, leading: unknown[] = []): unknown[] {
  const items: unknown[] = [...leading];
  if (inline) items.push(parseInlineNode(ctx, inline.content, inline.line, sequenceIndent, inline.itemIndent, true));
  for (;;) {
    const line = peekSignificant(ctx);
    if (!line || line.indent !== sequenceIndent || !isDashEntry(line.content)) break;
    consumeSignificant(ctx);
    const afterDash = line.content.slice(1);
    const leadingSpaces = afterDash.length - afterDash.replace(/^[ \t]+/, '').length;
    const content = afterDash.slice(leadingSpaces);
    if (content === '' || content.startsWith('#')) items.push(parseNestedBlock(ctx, sequenceIndent, false));
    else items.push(parseInlineNode(ctx, content, line.no, sequenceIndent, sequenceIndent + 1 + leadingSpaces, true));
  }
  return items;
}

/** A value that may start a nested block sequence/mapping deeper, or a sequence at the parent indent. */
function parseNestedBlock(ctx: ParserContext, parentIndent: number, allowSiblingSequence = true): unknown {
  const line = peekSignificant(ctx);
  if (!line) return null;
  if (line.indent > parentIndent) return parseBlockNode(ctx, line.indent);
  // Only a mapping key may open an indentless sibling sequence; an empty `-`
  // item must leave same-indent dashes for its own (outer) sequence loop.
  if (allowSiblingSequence && line.indent === parentIndent && isDashEntry(line.content)) return parseSequenceFrom(ctx, parentIndent);
  return null;
}

/** Dispatch a node whose first significant line sits at `nodeIndent`. */
function parseBlockNode(ctx: ParserContext, nodeIndent: number): unknown {
  const line = peekSignificant(ctx);
  if (!line || line.indent !== nodeIndent) fail('could not parse the nested block', line?.no ?? 1);
  if (isDashEntry(line.content)) return parseSequenceFrom(ctx, nodeIndent);
  const probe = probeMappingKey(line.content, line.no);
  if (probe) {
    consumeSignificant(ctx);
    return applyMappingEntries(collectMappingEntries(ctx, nodeIndent, { probe, line: line.no }), line.no);
  }
  consumeSignificant(ctx);
  return parseInlineNode(ctx, line.content, line.no, nodeIndent - 1, nodeIndent + 1, true);
}

/**
 * Value that starts inline on an already-consumed line (after `key:` or `- `).
 * `allowInlineMapping` is true only where YAML permits a mapping to begin
 * inline (sequence items), so `key: a: b` stays a hard error.
 */
function parseInlineNode(ctx: ParserContext, text: string, lineNo: number, parentIndent: number, itemIndent: number, allowInlineMapping: boolean): unknown {
  enter(ctx, lineNo);
  try {
    let rest = text.replace(/^[ \t]+/, '');
    let anchor: string | undefined;
    for (;;) {
      const anchored = /^&([A-Za-z0-9_.-]+)(?=$|[ \t#])/.exec(rest);
      if (!anchored) break;
      anchor = anchored[1];
      rest = rest.slice(anchored[0].length).replace(/^[ \t]+/, '');
    }
    const finish = (resolved: unknown): unknown => {
      if (anchor !== undefined) ctx.anchors.set(anchor, resolved);
      return resolved;
    };
    if (rest === '' || rest.startsWith('#')) return finish(parseNestedBlock(ctx, parentIndent));
    const aliased = /^\*([A-Za-z0-9_.-]+)(?=$|[ \t#])/.exec(rest);
    if (aliased) {
      if (anchor !== undefined) fail('an anchor cannot prefix an alias', lineNo);
      assertNoTrailingContent(rest.slice(aliased[0].length), lineNo);
      if (!ctx.anchors.has(aliased[1])) fail(`undefined alias: *${aliased[1]}`, lineNo);
      return cloneValue(ctx.anchors.get(aliased[1]));
    }
    const probe = probeMappingKey(rest, lineNo);
    if (probe) {
      if (!allowInlineMapping) fail(`a mapping value cannot start another inline mapping ('${probe.key}: …' is not allowed in this position)`, lineNo);
      return finish(applyMappingEntries(collectMappingEntries(ctx, itemIndent, { probe, line: lineNo }), lineNo));
    }
    const first = rest[0];
    if (first === '!') fail('YAML tags are not supported', lineNo);
    if (first === '%' || first === '@' || first === '`') fail(`a plain scalar must not start with '${first}'`, lineNo);
    if (first === '|' || first === '>') return finish(parseBlockScalar(ctx, first, rest, lineNo, parentIndent));
    if (first === '{' || first === '[') return finish(parseFlowNode(ctx, rest, lineNo, parentIndent));
    if (first === "'" || first === '"') return finish(parseQuotedNode(ctx, rest, lineNo, parentIndent, first));
    if (first === '-' && (rest === '-' || rest[1] === ' ' || rest[1] === '\\t')) {
      // An inline dash starts a nested sequence whose items continue at the dash column.
      const afterDash = rest.slice(1);
      const leadingSpaces = afterDash.length - afterDash.replace(/^[ \\t]+/, '').length;
      let content = afterDash.slice(leadingSpaces);
      if (content.startsWith('#')) content = '';
      if (content === '') {
        // A lone dash is the plain scalar '-' after a mapping key; after a
        // sequence dash it opens a nested block sequence with an empty item.
        if (!allowInlineMapping) return finish(parsePlainNode(ctx, '-', lineNo, parentIndent));
        return finish(parseSequenceFrom(ctx, itemIndent, undefined, [null]));
      }
      return finish(parseSequenceFrom(ctx, itemIndent, { content, line: lineNo, itemIndent: itemIndent + 1 + leadingSpaces }));
    }
    if (first === '?' || first === ':' || first === ',') fail(`a plain scalar must not start with '${first}'`, lineNo);
    return finish(parsePlainNode(ctx, rest, lineNo, parentIndent));
  } finally {
    ctx.depth -= 1;
  }
}

/** Root node: after directives/markers, everything else is one complete document. */
function parseDocumentRoot(ctx: ParserContext, first: SignificantLine | null): unknown {
  enter(ctx, first?.no ?? 1);
  try {
    let line = first;
    if (line && isDocumentStart(line.content)) {
      const afterMarker = line.content.slice(3).replace(/^[ \t]+/, '');
      consumeSignificant(ctx);
      if (afterMarker !== '' && !afterMarker.startsWith('#')) return parseInlineNode(ctx, afterMarker, line.no, -1, 4, true);
      line = peekSignificant(ctx);
    }
    if (!line || isDocumentEnd(line.content)) fail('YAML document is empty', line?.no ?? 1);
    return parseBlockNode(ctx, line.indent);
  } finally {
    ctx.depth -= 1;
  }
}

/**
 * 🧾 Parse YAML spec text into JSON-compatible values (single-document YAML 1.2 core schema).
 *
 * Supported: block/flow mappings and sequences, plain/single/double-quoted
 * scalars, literal and folded block scalars with every chomping mode and
 * indent indicators, comments, anchors, aliases, `<<` merge keys, `%YAML 1.x`
 * directives, and `---`/`...` document markers. Rejected with a typed error:
 * tab indentation, duplicate mapping keys, undefined aliases, custom tags,
 * multiple documents, complex `?` keys, and the non-JSON numbers
 * `.inf`/`.nan`. Output values are plain JavaScript (objects, arrays,
 * strings, numbers, booleans, null) so the OpenAPI pipeline sees exactly what
 * an equivalent JSON document would produce (D-16).
 *
 * @param text YAML document text read from a `.yaml`/`.yml` spec or passed inline.
 * @returns Plain JavaScript values (`Record`, arrays, strings, numbers, booleans, or null).
 * @throws {ZopiaError} 🆔 `ZOPIA_SPEC_INVALID_YAML` — malformed structure, unsupported constructs, or non-JSON values.
 * @example
 * ```ts
 * import { parseYaml } from './src/conversions/yaml';
 *
 * const document = parseYaml("paths:\n  /health:\n    get:\n      responses: {}\n");
 * console.log(document);
 * ```
 * @see [docs/06-conversions.md → Engine ③](../../docs/06-conversions.md)
 */
export function parseYaml(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ZopiaError('ZOPIA_SPEC_INVALID_YAML', 'invalid YAML: document is empty', { at: 'line 1', hint: 'provide non-empty YAML spec text' });
  }
  const ctx: ParserContext = { lines: normalizeLines(text), index: 0, anchors: new Map(), depth: 0 };
  let line = peekSignificant(ctx);
  let directive = false;
  while (line && line.content.startsWith('%')) {
    if (!/^%YAML[ \t]+1\.[0-9]+[ \t]*$/.test(line.content)) fail(`unsupported YAML directive: ${line.content}`, line.no);
    directive = true;
    consumeSignificant(ctx);
    line = peekSignificant(ctx);
  }
  if (directive && (!line || !isDocumentStart(line.content))) fail("YAML directives must be followed by a '---' document start", line?.no ?? 1);
  const root = parseDocumentRoot(ctx, line);
  const trailing = peekSignificant(ctx);
  if (trailing) {
    if (isDocumentEnd(trailing.content)) {
      if (!/^\.{3}(?:[ \t]+#.*)?$/.test(trailing.content)) fail("unexpected content after the end-of-document marker '...'", trailing.no);
      consumeSignificant(ctx);
      const beyond = peekSignificant(ctx);
      if (beyond) fail('unexpected content after the end-of-document marker', beyond.no);
    } else if (isDocumentStart(trailing.content)) fail('multiple YAML documents are not supported', trailing.no);
    else fail(`unexpected content: '${trailing.content.slice(0, 32)}'`, trailing.no);
  }
  return root;
}
