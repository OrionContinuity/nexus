# Nexus Code (`.nx`)

A small but **real** programming language, built from scratch: a hand-written
lexer, a recursive-descent parser, and a **translator (transpiler) that emits
JavaScript** — the language the rest of NEXUS already runs on. Nexus Code
doesn't execute directly; it's translated to JS and that JS runs (in Node via
the CLI, or in a browser).

```
nexus-lang/
├── nexc.js            ← the CLI (run / build / tokens / ast / repl)
├── test.js            ← the test suite (19 tests)
├── src/
│   ├── lexer.js       ← source text  → tokens
│   ├── parser.js      ← tokens       → AST
│   ├── transpiler.js  ← AST          → JavaScript
│   ├── runtime.js     ← the standard library (builtins)
│   └── index.js       ← compile() / run() public API
└── examples/          ← hello.nx, fizzbuzz.nx, data.nx
```

> On "unhackable because nobody's seen it": a novel syntax is **obfuscation,
> not security** — the code is translated to ordinary JavaScript that anyone
> can read at runtime. Nexus Code is built here as a genuine language project,
> not a security control.

## Quick start

```bash
node nexus-lang/nexc.js run   nexus-lang/examples/fizzbuzz.nx   # run it
node nexus-lang/nexc.js build nexus-lang/examples/hello.nx      # see the JS it compiles to
node nexus-lang/nexc.js tokens nexus-lang/examples/hello.nx     # see the tokens
node nexus-lang/nexc.js ast    nexus-lang/examples/hello.nx     # see the AST
node nexus-lang/test.js                                         # run the tests
```

## The language

It reads like a normal scripting language with a NEXUS-flavored keyword set.

### Comments
```
~ everything after a tilde is a comment
```

### Values
- Numbers: `42`, `3.14`
- Text (strings): `"hello"` with escapes `\n \t \" \\`
- Booleans: `true`, `false`
- Nothing: `void`
- Lists: `[1, 2, 3]`
- Maps: `{ title: "scan", priority: 3 }`

### Variables — `node`
```
node x = 10      ~ declare
x = x + 1        ~ reassign
```

### Output — `beam`
```
beam "result: " + str(x)
```

### Functions — `signal` … `emit`
```
signal add(a, b) {
  emit a + b      ~ emit = return; bare `emit` returns void
}
beam add(2, 3)    ~ 5
```

### Conditionals — `when` / `elsewhen` / `otherwise`
```
when (score >= 90) {
  beam "A"
} elsewhen (score >= 80) {
  beam "B"
} otherwise {
  beam "C"
}
```

### Loops — `pulse` (while) and `each … in` (for)
```
node i = 0
pulse (i < 3) {        ~ while
  beam i
  i = i + 1
}

each n in [10, 20, 30] {   ~ for-each over a list
  beam n
}

each k in { a: 1, b: 2 } { ~ over a map → yields keys
  beam k
}
```
Use `skip` to continue and `halt` to break.

### Operators
| Kind | Operators |
|---|---|
| Arithmetic | `+` `-` `*` `/` `%` |
| Comparison | `==` `!=` `<` `>` `<=` `>=` |
| Logical | `and` `or` `not` |

Strings concatenate with `+`. Lines may break after a binary operator:
```
node total = 1 +
             2 +
             3
```

## Standard library (builtins)

Callable by bare name; any of them can be shadowed by a `node` of the same name.

| | |
|---|---|
| **Generic** | `len(x)` `str(x)` `num(x)` `bool(x)` `type(x)` |
| **Lists/maps** | `keys(m)` `values(m)` `push(a,x)` `pop(a)` `has(c,k)` `slice(v,a,b)` `join(a,sep)` `split(s,sep)` |
| **Numbers** | `range(n)` / `range(a,b)` / `range(a,b,step)` `floor` `ceil` `round` `abs` `min` `max` `sqrt` `rand(a,b)` |
| **Text** | `upper(s)` `lower(s)` `trim(s)` `replace(s,a,b)` |
| **Data** | `json(v)` `parse(s)` |
| **Misc** | `assert(cond, msg)` |

`type()` reports Nexus types: `number`, `text`, `bool`, `list`, `map`, `signal`, `void`.

## Embedding it

```js
const nx = require('./nexus-lang/src/index');

nx.compile('beam "hi"');              // → JavaScript source string
const { output } = nx.run('beam 1 + 1', { capture: true }); // output === ['2']
```

## How it works (the pipeline)

```
source.nx ──lexer──▶ tokens ──parser──▶ AST ──transpiler──▶ JavaScript ──▶ run
```

1. **Lexer** (`src/lexer.js`) scans characters into tokens, handling strings,
   numbers, comments, and significant newlines.
2. **Parser** (`src/parser.js`) is recursive-descent with precedence climbing
   for expressions; newlines separate statements but are skipped inside
   brackets and after operators.
3. **Transpiler** (`src/transpiler.js`) walks the AST and emits JavaScript,
   wrapped so the runtime builtins are in scope.
4. **Runtime** (`src/runtime.js`) is the standard library the emitted code
   calls into; the host decides where `beam` output goes.

## Known limits (it's a toy — by design)

- No closures-as-values / first-class functions passed around (functions are
  declared with `signal` and called by name).
- The REPL evaluates each line fresh, so `node` bindings don't persist between
  REPL lines (use a `.nx` file for multi-statement programs).
- JavaScript reserved words can't be used as identifier names.
- No modules/imports, exceptions, or async.
