/* ═══════════════════════════════════════════════════════════════════
   Nexus Code — Transpiler (AST → JavaScript)

   Walks the AST produced by parser.js and emits plain JavaScript.
   Nexus Code runs by being translated to JS — the language your whole
   stack already speaks — so the output here is what actually executes
   (in Node via the CLI, or in a browser).

   The emitted program is wrapped so the runtime builtins (beam, len,
   range, …) are in scope, and the user's code lives in a nested block
   `{ … }` so a user `node len = …` can safely shadow a builtin.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const { BUILTIN_NAMES } = require('./runtime');

// Nexus operators → JavaScript operators.
const BIN_OP = {
  '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
  '==': '===', '!=': '!==',
  '<': '<', '>': '>', '<=': '<=', '>=': '>=',
  'and': '&&', 'or': '||',
};

function transpile(ast) {
  const lines = [];
  let indent = 1; // user body sits inside one wrapper block

  const pad = () => '  '.repeat(indent);
  const emit = (s) => lines.push(pad() + s);

  function genBlock(body) {
    indent++;
    for (const stmt of body) genStatement(stmt);
    indent--;
  }

  function genStatement(node) {
    switch (node.type) {
      case 'Decl':
        emit(`let ${node.name} = ${genExpr(node.value)};`);
        break;

      case 'Assign':
        emit(`${genExpr(node.target)} = ${genExpr(node.value)};`);
        break;

      case 'Signal': {
        emit(`function ${node.name}(${node.params.join(', ')}) {`);
        genBlock(node.body);
        emit(`}`);
        break;
      }

      case 'Emit':
        emit(node.value ? `return ${genExpr(node.value)};` : `return;`);
        break;

      case 'Beam':
        emit(`beam(${genExpr(node.value)});`);
        break;

      case 'When': {
        node.clauses.forEach((clause, idx) => {
          const kw = idx === 0 ? 'if' : '} else if';
          emit(`${kw} (${genExpr(clause.test)}) {`);
          genBlock(clause.body);
        });
        if (node.alternate) {
          emit(`} else {`);
          genBlock(node.alternate);
        }
        emit(`}`);
        break;
      }

      case 'Pulse':
        emit(`while (${genExpr(node.test)}) {`);
        genBlock(node.body);
        emit(`}`);
        break;

      case 'Each':
        emit(`for (const ${node.name} of __rt.iter(${genExpr(node.iterable)})) {`);
        genBlock(node.body);
        emit(`}`);
        break;

      case 'Halt': emit('break;'); break;
      case 'Skip': emit('continue;'); break;

      case 'ExprStmt':
        emit(`${genExpr(node.expr)};`);
        break;

      default:
        throw new Error(`transpile: unknown statement '${node.type}'`);
    }
  }

  function genExpr(node) {
    switch (node.type) {
      case 'Number': return String(node.value);
      case 'String': return JSON.stringify(node.value);
      case 'Bool':   return node.value ? 'true' : 'false';
      case 'Void':   return 'null';
      case 'Identifier': return node.name;

      case 'Binary':
        return `(${genExpr(node.left)} ${BIN_OP[node.op]} ${genExpr(node.right)})`;

      case 'Unary':
        return node.op === 'not'
          ? `(!${genExpr(node.operand)})`
          : `(-${genExpr(node.operand)})`;

      case 'Call':
        return `${genExpr(node.callee)}(${node.args.map(genExpr).join(', ')})`;

      case 'Member':
        return `${genExpr(node.object)}.${node.property}`;

      case 'Index':
        return `${genExpr(node.object)}[${genExpr(node.index)}]`;

      case 'Array':
        return `[${node.elements.map(genExpr).join(', ')}]`;

      case 'Map':
        return `{${node.entries.map(e => `${JSON.stringify(e.key)}: ${genExpr(e.value)}`).join(', ')}}`;

      default:
        throw new Error(`transpile: unknown expression '${node.type}'`);
    }
  }

  for (const stmt of ast.body) genStatement(stmt);
  const userCode = lines.join('\n');

  // Pull each builtin into a local const so user code can call them by
  // bare name (`len(x)`), while still being shadowable inside the block.
  const binds = BUILTIN_NAMES.map(n => `  const ${n} = __rt.${n};`).join('\n');

  return `(function (__rt) {
  'use strict';
${binds}
  {
${userCode}
  }
})`;
}

module.exports = { transpile };
