#!/usr/bin/env node
/* Nexus Code — test suite. Run: node nexus-lang/test.js  */
'use strict';

const assert = require('assert');
const { run } = require('./src/index');

let passed = 0, failed = 0;

// Run nexus source with output captured; return the printed lines.
function out(src) {
  return run(src, { capture: true }).output;
}

function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.message || e)); }
}

console.log('Nexus Code tests\n');

test('beam + string concat', () => {
  assert.deepStrictEqual(out('beam "a" + "b"'), ['ab']);
});

test('arithmetic precedence', () => {
  assert.deepStrictEqual(out('beam 2 + 3 * 4'), ['14']);
  assert.deepStrictEqual(out('beam (2 + 3) * 4'), ['20']);
});

test('decl and reassign', () => {
  assert.deepStrictEqual(out('node x = 1\nx = x + 41\nbeam x'), ['42']);
});

test('comparison and bools', () => {
  assert.deepStrictEqual(out('beam 3 > 2\nbeam 3 == 4'), ['true', 'false']);
});

test('logical and/or/not', () => {
  assert.deepStrictEqual(out('beam true and false\nbeam true or false\nbeam not true'),
    ['false', 'true', 'false']);
});

test('when / elsewhen / otherwise', () => {
  const src = `
    signal grade(n) {
      when (n >= 90) { emit "A" }
      elsewhen (n >= 80) { emit "B" }
      otherwise { emit "C" }
    }
    beam grade(95)
    beam grade(85)
    beam grade(50)`;
  assert.deepStrictEqual(out(src), ['A', 'B', 'C']);
});

test('pulse (while) loop', () => {
  const src = 'node i = 0\nnode s = 0\npulse (i < 5) { s = s + i\ni = i + 1 }\nbeam s';
  assert.deepStrictEqual(out(src), ['10']);
});

test('each over list + range', () => {
  assert.deepStrictEqual(out('each n in range(3) { beam n }'), ['0', '1', '2']);
});

test('recursion (factorial)', () => {
  const src = 'signal f(n) { when (n <= 1) { emit 1 }\nemit n * f(n - 1) }\nbeam f(5)';
  assert.deepStrictEqual(out(src), ['120']);
});

test('lists: index, len, push', () => {
  const src = 'node a = [10, 20]\npush(a, 30)\nbeam a[2]\nbeam len(a)';
  assert.deepStrictEqual(out(src), ['30', '3']);
});

test('maps: literal, member set, index get', () => {
  const src = 'node m = { x: 1 }\nm.y = 2\nbeam m["x"] + m.y';
  assert.deepStrictEqual(out(src), ['3']);
});

test('each over map yields keys', () => {
  assert.deepStrictEqual(out('node m = { a: 1, b: 2 }\neach k in m { beam k }'), ['a', 'b']);
});

test('halt (break) and skip (continue)', () => {
  const src = `
    each n in range(10) {
      when (n == 3) { skip }
      when (n == 5) { halt }
      beam n
    }`;
  assert.deepStrictEqual(out(src), ['0', '1', '2', '4']);
});

test('string builtins', () => {
  assert.deepStrictEqual(out('beam upper("hi")\nbeam len("hello")'), ['HI', '5']);
});

test('json + parse round trip', () => {
  assert.deepStrictEqual(out('node m = parse("{\\"n\\": 7}")\nbeam m.n'), ['7']);
});

test('multi-line expression after operator', () => {
  assert.deepStrictEqual(out('beam 1 +\n  2 +\n  3'), ['6']);
});

test('user var shadows a builtin', () => {
  assert.deepStrictEqual(out('node len = 99\nbeam len'), ['99']);
});

test('type() reports nexus types', () => {
  const src = 'beam type([1])\nbeam type({a:1})\nbeam type("x")\nbeam type(3)\nbeam type(void)';
  assert.deepStrictEqual(out(src), ['list', 'map', 'text', 'number', 'void']);
});

test('negative numbers and unary minus', () => {
  assert.deepStrictEqual(out('node x = 5\nbeam -x\nbeam 3 - -2'), ['-5', '5']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
