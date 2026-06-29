/* ═══════════════════════════════════════════════════════════════════
   Nexus Code — Public API

   compile(source)        → JavaScript source string
   run(source, opts)      → executes; returns { output: string[] }
   tokenize / parse       → re-exported for tooling / tests
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { transpile } = require('./transpiler');
const { createRuntime } = require('./runtime');

// Source → JavaScript (the wrapped IIFE-factory string from transpile).
function compile(source) {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  return transpile(ast);
}

// Source → run it. By default output goes to an array AND stdout unless
// `capture: true` (then only the array). Returns { output }.
function run(source, opts = {}) {
  const js = compile(source);
  const output = [];
  const runtime = createRuntime({
    print: (s) => {
      output.push(s);
      if (!opts.capture) console.log(s);
    },
  });

  // The compiled code is a factory `(function(__rt){...})`. Evaluate it
  // to get the factory, then invoke with the runtime.
  // eslint-disable-next-line no-eval
  const factory = (0, eval)(js);
  factory(runtime);
  return { output };
}

module.exports = { compile, run, tokenize, parse, transpile, createRuntime };
