/* ═══════════════════════════════════════════════════════════════════
   Nexus Code — Parser

   Recursive-descent parser that turns the token list into an AST.
   Newlines separate statements at the top level and inside `{ }`
   blocks. Inside `( )`, `[ ]`, and `{ }` map/arg lists, newlines are
   skipped so expressions can span lines. Newlines are also skipped
   right after a binary operator, so `a +\n b` keeps going.

   Grammar (informal):
     program    := stmt*
     stmt       := decl | assign | beam | emit | when | pulse | each
                 | halt | skip | exprStmt
     decl       := 'node' IDENT '=' expr
     signal     := 'signal' IDENT '(' params ')' block
     when       := 'when' '(' expr ')' block
                   ('elsewhen' '(' expr ')' block)*
                   ('otherwise' block)?
     pulse      := 'pulse' '(' expr ')' block
     each       := 'each' IDENT 'in' expr block
     expr       := logic-or  (precedence climbing below)
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

class ParseError extends Error {
  constructor(msg, tok) {
    super(`Parse error (line ${tok ? tok.line : '?'}:${tok ? tok.col : '?'}): ${msg}`);
    this.name = 'ParseError';
    this.token = tok;
  }
}

// Binary operator precedence — higher binds tighter.
const PRECEDENCE = {
  'or': 1,
  'and': 2,
  '==': 3, '!=': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

function parse(tokens) {
  let pos = 0;

  const peek = (k = 0) => tokens[pos + k];
  const at = (type, value) => {
    const t = peek();
    if (t.type !== type) return false;
    return value === undefined || t.value === value;
  };
  const next = () => tokens[pos++];
  const skipNewlines = () => { while (at('NEWLINE')) pos++; };

  // Look past any newlines for a keyword WITHOUT consuming — used to
  // decide if `elsewhen`/`otherwise` continues a `when`, so we don't
  // swallow the newline that terminates the statement when it doesn't.
  const peekKeywordAcrossNewlines = (kw) => {
    let k = pos;
    while (tokens[k] && tokens[k].type === 'NEWLINE') k++;
    return tokens[k] && tokens[k].type === 'KEYWORD' && tokens[k].value === kw;
  };

  function expect(type, value, what) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new ParseError(
        `expected ${what || value || type}, got '${t.value ?? t.type}'`, t);
    }
    return next();
  }

  // ── Program ─────────────────────────────────────────────────────
  function parseProgram() {
    const body = [];
    skipNewlines();
    while (!at('EOF')) {
      body.push(parseStatement());
      // A statement is terminated by a newline, EOF, or a closing brace.
      if (!at('EOF') && !at('OP', '}')) {
        if (at('NEWLINE')) skipNewlines();
        else throw new ParseError(`unexpected '${peek().value}' after statement`, peek());
      }
      skipNewlines();
    }
    return { type: 'Program', body };
  }

  function parseBlock() {
    expect('OP', '{', "'{'");
    const body = [];
    skipNewlines();
    while (!at('OP', '}') && !at('EOF')) {
      body.push(parseStatement());
      if (!at('OP', '}') && !at('EOF')) {
        if (at('NEWLINE')) skipNewlines();
        else throw new ParseError(`unexpected '${peek().value}' in block`, peek());
      }
      skipNewlines();
    }
    expect('OP', '}', "'}'");
    return body;
  }

  // ── Statements ──────────────────────────────────────────────────
  function parseStatement() {
    const t = peek();

    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'node':   return parseDecl();
        case 'signal': return parseSignal();
        case 'emit':   return parseEmit();
        case 'beam':   return parseBeam();
        case 'when':   return parseWhen();
        case 'pulse':  return parsePulse();
        case 'each':   return parseEach();
        case 'halt':   next(); return { type: 'Halt', line: t.line };
        case 'skip':   next(); return { type: 'Skip', line: t.line };
      }
    }

    // Otherwise: an assignment (`target = expr`) or a bare expression.
    const expr = parseExpression();
    if (at('OP', '=')) {
      next();
      skipNewlines();
      const value = parseExpression();
      if (!isAssignable(expr)) throw new ParseError('invalid assignment target', t);
      return { type: 'Assign', target: expr, value, line: t.line };
    }
    return { type: 'ExprStmt', expr, line: t.line };
  }

  function isAssignable(node) {
    return node.type === 'Identifier' || node.type === 'Member' || node.type === 'Index';
  }

  function parseDecl() {
    const kw = next(); // node
    const name = expect('IDENT', undefined, 'variable name').value;
    expect('OP', '=', "'='");
    skipNewlines();
    const value = parseExpression();
    return { type: 'Decl', name, value, line: kw.line };
  }

  function parseSignal() {
    const kw = next(); // signal
    const name = expect('IDENT', undefined, 'function name').value;
    expect('OP', '(', "'('");
    const params = [];
    skipNewlines();
    while (!at('OP', ')')) {
      params.push(expect('IDENT', undefined, 'parameter name').value);
      skipNewlines();
      if (at('OP', ',')) { next(); skipNewlines(); }
      else break;
    }
    expect('OP', ')', "')'");
    const body = parseBlock();
    return { type: 'Signal', name, params, body, line: kw.line };
  }

  function parseEmit() {
    const kw = next(); // emit
    // `emit` with no expression returns void.
    if (at('NEWLINE') || at('OP', '}') || at('EOF')) {
      return { type: 'Emit', value: null, line: kw.line };
    }
    const value = parseExpression();
    return { type: 'Emit', value, line: kw.line };
  }

  function parseBeam() {
    const kw = next(); // beam
    const value = parseExpression();
    return { type: 'Beam', value, line: kw.line };
  }

  function parseWhen() {
    const kw = next(); // when
    expect('OP', '(', "'('");
    skipNewlines();
    const test = parseExpression();
    skipNewlines();
    expect('OP', ')', "')'");
    const consequent = parseBlock();
    const clauses = [{ test, body: consequent }];
    let alternate = null;

    while (peekKeywordAcrossNewlines('elsewhen')) {
      skipNewlines();
      next();
      expect('OP', '(', "'('");
      skipNewlines();
      const t = parseExpression();
      skipNewlines();
      expect('OP', ')', "')'");
      clauses.push({ test: t, body: parseBlock() });
    }
    if (peekKeywordAcrossNewlines('otherwise')) {
      skipNewlines();
      next();
      alternate = parseBlock();
    }
    return { type: 'When', clauses, alternate, line: kw.line };
  }

  function parsePulse() {
    const kw = next(); // pulse
    expect('OP', '(', "'('");
    skipNewlines();
    const test = parseExpression();
    skipNewlines();
    expect('OP', ')', "')'");
    const body = parseBlock();
    return { type: 'Pulse', test, body, line: kw.line };
  }

  function parseEach() {
    const kw = next(); // each
    const name = expect('IDENT', undefined, 'loop variable').value;
    expect('KEYWORD', 'in', "'in'");
    const iterable = parseExpression();
    const body = parseBlock();
    return { type: 'Each', name, iterable, body, line: kw.line };
  }

  // ── Expressions (precedence climbing) ───────────────────────────
  function parseExpression(minPrec = 0) {
    let left = parseUnary();
    while (true) {
      const t = peek();
      const op = (t.type === 'OP' || (t.type === 'KEYWORD' && (t.value === 'and' || t.value === 'or')))
        ? t.value : null;
      const prec = op != null ? PRECEDENCE[op] : undefined;
      if (prec === undefined || prec < minPrec) break;
      next(); // consume operator
      skipNewlines(); // allow line break after a binary operator
      const right = parseExpression(prec + 1);
      left = { type: 'Binary', op, left, right, line: t.line };
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (at('KEYWORD', 'not')) {
      next();
      return { type: 'Unary', op: 'not', operand: parseUnary(), line: t.line };
    }
    if (at('OP', '-')) {
      next();
      return { type: 'Unary', op: '-', operand: parseUnary(), line: t.line };
    }
    return parsePostfix();
  }

  // Handles calls f(...), member a.b, and index a[i] chains.
  function parsePostfix() {
    let node = parsePrimary();
    while (true) {
      if (at('OP', '(')) {
        next();
        const args = [];
        skipNewlines();
        while (!at('OP', ')')) {
          args.push(parseExpression());
          skipNewlines();
          if (at('OP', ',')) { next(); skipNewlines(); }
          else break;
        }
        expect('OP', ')', "')'");
        node = { type: 'Call', callee: node, args, line: node.line };
      } else if (at('OP', '.')) {
        next();
        const prop = expect('IDENT', undefined, 'property name').value;
        node = { type: 'Member', object: node, property: prop, line: node.line };
      } else if (at('OP', '[')) {
        next();
        skipNewlines();
        const index = parseExpression();
        skipNewlines();
        expect('OP', ']', "']'");
        node = { type: 'Index', object: node, index, line: node.line };
      } else {
        break;
      }
    }
    return node;
  }

  function parsePrimary() {
    const t = peek();

    if (t.type === 'NUMBER') { next(); return { type: 'Number', value: t.value, line: t.line }; }
    if (t.type === 'STRING') { next(); return { type: 'String', value: t.value, line: t.line }; }

    if (t.type === 'KEYWORD') {
      if (t.value === 'true')  { next(); return { type: 'Bool', value: true, line: t.line }; }
      if (t.value === 'false') { next(); return { type: 'Bool', value: false, line: t.line }; }
      if (t.value === 'void')  { next(); return { type: 'Void', line: t.line }; }
    }

    if (t.type === 'IDENT') { next(); return { type: 'Identifier', name: t.value, line: t.line }; }

    // Grouping: ( expr )
    if (at('OP', '(')) {
      next();
      skipNewlines();
      const expr = parseExpression();
      skipNewlines();
      expect('OP', ')', "')'");
      return expr;
    }

    // Array literal: [ a, b, c ]
    if (at('OP', '[')) {
      next();
      const elements = [];
      skipNewlines();
      while (!at('OP', ']')) {
        elements.push(parseExpression());
        skipNewlines();
        if (at('OP', ',')) { next(); skipNewlines(); }
        else break;
      }
      expect('OP', ']', "']'");
      return { type: 'Array', elements, line: t.line };
    }

    // Map literal: { key: value, "str": value }
    if (at('OP', '{')) {
      next();
      const entries = [];
      skipNewlines();
      while (!at('OP', '}')) {
        let key;
        if (at('STRING')) key = next().value;
        else if (at('IDENT')) key = next().value;
        else throw new ParseError('expected map key', peek());
        expect('OP', ':', "':'");
        skipNewlines();
        const value = parseExpression();
        entries.push({ key, value });
        skipNewlines();
        if (at('OP', ',')) { next(); skipNewlines(); }
        else break;
      }
      expect('OP', '}', "'}'");
      return { type: 'Map', entries, line: t.line };
    }

    throw new ParseError(`unexpected '${t.value ?? t.type}'`, t);
  }

  const program = parseProgram();
  expect('EOF', undefined, 'end of input');
  return program;
}

module.exports = { parse, ParseError };
