#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   nexc — the Nexus Code CLI

   Usage:
     node nexc.js run     <file.nx>     run a program
     node nexc.js build   <file.nx> [out.js]   transpile to JavaScript
     node nexc.js tokens  <file.nx>     dump the token stream
     node nexc.js ast     <file.nx>     dump the parsed AST (JSON)
     node nexc.js repl                  interactive prompt
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const { compile, run, tokenize, parse } = require('./src/index');

function readFileOrDie(file) {
  if (!file) die('no input file given');
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e) { die(`cannot read ${file}: ${e.message}`); }
}

function die(msg) {
  console.error('nexc: ' + msg);
  process.exit(1);
}

function fail(e) {
  // Pretty-print our own error types; rethrow anything unexpected.
  if (['LexError', 'ParseError', 'NexusRuntimeError'].includes(e.name)) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const [, , cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case 'run': {
      run(readFileOrDie(rest[0]));
      break;
    }

    case 'build': {
      const src = readFileOrDie(rest[0]);
      const js = compile(src);
      const out = rest[1];
      if (out) {
        fs.writeFileSync(out, js + '\n');
        console.log(`wrote ${out}`);
      } else {
        process.stdout.write(js + '\n');
      }
      break;
    }

    case 'tokens': {
      const src = readFileOrDie(rest[0]);
      for (const t of tokenize(src)) {
        console.log(`${String(t.line).padStart(3)}:${String(t.col).padStart(3)}  ${t.type.padEnd(8)} ${t.value ?? ''}`);
      }
      break;
    }

    case 'ast': {
      const src = readFileOrDie(rest[0]);
      console.log(JSON.stringify(parse(tokenize(src)), null, 2));
      break;
    }

    case 'repl':
      startRepl();
      break;

    case undefined:
    case '-h':
    case '--help':
    case 'help':
      printHelp();
      break;

    default:
      die(`unknown command '${cmd}'. Try: run | build | tokens | ast | repl`);
  }
} catch (e) {
  fail(e);
}

function printHelp() {
  console.log(`Nexus Code — nexc

  node nexc.js run    <file.nx>            run a program
  node nexc.js build  <file.nx> [out.js]   transpile to JavaScript
  node nexc.js tokens <file.nx>            dump tokens
  node nexc.js ast    <file.nx>            dump the AST
  node nexc.js repl                        interactive prompt

Examples live in ${path.relative(process.cwd(), path.join(__dirname, 'examples'))}/`);
}

function startRepl() {
  const readline = require('readline');
  const { createRuntime } = require('./src/index');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'nx> ' });
  const runtime = createRuntime({ print: (s) => console.log(s) });
  console.log('Nexus Code REPL — type a line, Ctrl+C to exit.');
  rl.prompt();
  rl.on('line', (line) => {
    const code = line.trim();
    if (code) {
      try {
        const js = compile(code);
        const factory = (0, eval)(js); // eslint-disable-line no-eval
        factory(runtime);
      } catch (e) {
        console.error((e && e.message) || String(e));
      }
    }
    rl.prompt();
  }).on('close', () => process.exit(0));
}
