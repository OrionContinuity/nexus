/* ═══════════════════════════════════════════════════════════════════
   Nexus Code — Lexer (tokenizer)

   Turns raw .nx source text into a flat list of tokens. The parser
   consumes these. Newlines are emitted as NEWLINE tokens (consecutive
   blank lines collapse to one) and the parser decides where they
   matter — see parser.js skipNewlines().

   Comments start with `~` and run to end of line.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const KEYWORDS = new Set([
  'node', 'signal', 'emit', 'beam',
  'when', 'elsewhen', 'otherwise',
  'pulse', 'each', 'in',
  'and', 'or', 'not',
  'true', 'false', 'void',
  'halt', 'skip',
]);

// Multi-char operators must be tested before single-char ones.
const OPERATORS = [
  '==', '!=', '<=', '>=',
  '+', '-', '*', '/', '%',
  '=', '<', '>',
  '(', ')', '[', ']', '{', '}',
  ',', '.', ':',
];

class LexError extends Error {
  constructor(msg, line, col) {
    super(`Lex error (line ${line}:${col}): ${msg}`);
    this.name = 'LexError';
    this.line = line;
    this.col = col;
  }
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  const peek = (k = 0) => src[i + k];
  const push = (type, value) => tokens.push({ type, value, line, col });

  const advance = () => {
    const ch = src[i++];
    if (ch === '\n') { line++; col = 1; } else { col++; }
    return ch;
  };

  while (i < n) {
    const ch = peek();

    // Spaces / tabs / carriage returns — insignificant.
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }

    // Newline — significant as a statement separator.
    if (ch === '\n') {
      advance();
      // Collapse runs of newlines into a single NEWLINE token.
      if (tokens.length && tokens[tokens.length - 1].type !== 'NEWLINE') {
        tokens.push({ type: 'NEWLINE', value: '\\n', line, col });
      }
      continue;
    }

    // Comment — `~` to end of line.
    if (ch === '~') {
      while (i < n && peek() !== '\n') advance();
      continue;
    }

    // String literal — double quoted, with escapes.
    if (ch === '"') {
      const startLine = line, startCol = col;
      advance(); // opening quote
      let str = '';
      while (i < n && peek() !== '"') {
        let c = advance();
        if (c === '\n') throw new LexError('unterminated string', startLine, startCol);
        if (c === '\\') {
          const esc = advance();
          c = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' }[esc];
          if (c === undefined) throw new LexError(`bad escape \\${esc}`, line, col);
        }
        str += c;
      }
      if (i >= n) throw new LexError('unterminated string', startLine, startCol);
      advance(); // closing quote
      tokens.push({ type: 'STRING', value: str, line: startLine, col: startCol });
      continue;
    }

    // Number — int or float.
    if (isDigit(ch)) {
      const startCol = col;
      let num = '';
      while (i < n && isDigit(peek())) num += advance();
      if (peek() === '.' && isDigit(peek(1))) {
        num += advance(); // the dot
        while (i < n && isDigit(peek())) num += advance();
      }
      tokens.push({ type: 'NUMBER', value: Number(num), line, col: startCol });
      continue;
    }

    // Identifier / keyword.
    if (isIdentStart(ch)) {
      const startCol = col;
      let name = '';
      while (i < n && isIdentPart(peek())) name += advance();
      const type = KEYWORDS.has(name) ? 'KEYWORD' : 'IDENT';
      tokens.push({ type, value: name, line, col: startCol });
      continue;
    }

    // Operators / punctuation.
    const two = ch + (peek(1) || '');
    if (OPERATORS.includes(two)) {
      const startCol = col;
      advance(); advance();
      tokens.push({ type: 'OP', value: two, line, col: startCol });
      continue;
    }
    if (OPERATORS.includes(ch)) {
      const startCol = col;
      advance();
      tokens.push({ type: 'OP', value: ch, line, col: startCol });
      continue;
    }

    throw new LexError(`unexpected character '${ch}'`, line, col);
  }

  tokens.push({ type: 'EOF', value: null, line, col });
  return tokens;
}

function isDigit(c) { return c >= '0' && c <= '9'; }
function isIdentStart(c) { return /[A-Za-z_]/.test(c || ''); }
function isIdentPart(c) { return /[A-Za-z0-9_]/.test(c || ''); }

module.exports = { tokenize, KEYWORDS, LexError };
