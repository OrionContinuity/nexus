/* ═══════════════════════════════════════════════════════════════════
   Nexus Code — Runtime (the standard library)

   The transpiled program is handed a single `__rt` object and pulls
   each builtin into local scope. Keep this list and BUILTIN_NAMES in
   sync — every name a Nexus program can call by itself lives here.

   `createRuntime({ print })` lets the host capture output (the CLI
   prints to stdout; tests collect into an array).
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

// Every name a Nexus program may reference without declaring it.
const BUILTIN_NAMES = [
  'beam', 'len', 'str', 'num', 'type', 'bool',
  'keys', 'values', 'push', 'pop', 'has', 'slice', 'join', 'split',
  'range', 'upper', 'lower', 'trim', 'replace',
  'floor', 'ceil', 'round', 'abs', 'min', 'max', 'sqrt', 'rand',
  'json', 'parse', 'iter', 'assert',
];

function createRuntime(opts = {}) {
  const print = opts.print || ((s) => console.log(s));

  // Nexus's idea of a printable / string form. Maps and arrays render
  // as JSON; void renders as "void"; everything else via String().
  function show(v) {
    if (v === null || v === undefined) return 'void';
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v) || (typeof v === 'object')) {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  }

  const rt = {
    beam(v) { print(show(v)); return v; },

    // ── Generic ──────────────────────────────────────────────────
    len(v) {
      if (v == null) return 0;
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      if (typeof v === 'object') return Object.keys(v).length;
      return 0;
    },
    str(v) { return show(v); },
    num(v) {
      const n = Number(v);
      if (Number.isNaN(n)) throw new NexusRuntimeError(`cannot convert to number: ${show(v)}`);
      return n;
    },
    bool(v) { return !!v; },
    type(v) {
      if (v === null || v === undefined) return 'void';
      if (Array.isArray(v)) return 'list';
      if (typeof v === 'object') return 'map';
      if (typeof v === 'number') return 'number';
      if (typeof v === 'string') return 'text';
      if (typeof v === 'boolean') return 'bool';
      if (typeof v === 'function') return 'signal';
      return typeof v;
    },

    // ── Lists & maps ─────────────────────────────────────────────
    keys(v) { return v && typeof v === 'object' ? Object.keys(v) : []; },
    values(v) { return v && typeof v === 'object' ? Object.values(v) : []; },
    push(arr, x) { requireList(arr, 'push'); arr.push(x); return arr; },
    pop(arr) { requireList(arr, 'pop'); return arr.pop(); },
    has(coll, k) {
      if (Array.isArray(coll)) return coll.includes(k);
      if (coll && typeof coll === 'object') return Object.prototype.hasOwnProperty.call(coll, k);
      if (typeof coll === 'string') return coll.includes(k);
      return false;
    },
    slice(v, a, b) { return v == null ? v : v.slice(a, b); },
    join(arr, sep) { requireList(arr, 'join'); return arr.map(show).join(sep == null ? '' : sep); },
    split(s, sep) { return String(s).split(sep == null ? '' : sep); },

    // ── Numbers ──────────────────────────────────────────────────
    range(a, b, step) {
      // range(n) → 0..n-1 ; range(a, b) → a..b-1 ; range(a, b, step)
      let start = 0, end, st = step == null ? 1 : step;
      if (b === undefined) { end = a; } else { start = a; end = b; }
      const out = [];
      if (st === 0) throw new NexusRuntimeError('range step cannot be 0');
      if (st > 0) for (let i = start; i < end; i += st) out.push(i);
      else for (let i = start; i > end; i += st) out.push(i);
      return out;
    },
    floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs,
    min: (...a) => Math.min(...a.flat()), max: (...a) => Math.max(...a.flat()),
    sqrt: Math.sqrt,
    rand(a, b) {
      const r = Math.random();
      if (a === undefined) return r;
      if (b === undefined) return Math.floor(r * a);
      return Math.floor(r * (b - a)) + a;
    },

    // ── Text ─────────────────────────────────────────────────────
    upper(s) { return String(s).toUpperCase(); },
    lower(s) { return String(s).toLowerCase(); },
    trim(s) { return String(s).trim(); },
    replace(s, a, b) { return String(s).split(a).join(b); },

    // ── Data ─────────────────────────────────────────────────────
    json(v) { return JSON.stringify(v); },
    parse(s) {
      try { return JSON.parse(s); }
      catch { throw new NexusRuntimeError(`cannot parse: ${show(s)}`); }
    },

    // ── Misc ─────────────────────────────────────────────────────
    assert(cond, msg) {
      if (!cond) throw new NexusRuntimeError(msg ? show(msg) : 'assertion failed');
      return true;
    },

    // Used by the transpiled `each` loop — makes maps iterable by key.
    iter(v) {
      if (v == null) return [];
      if (Array.isArray(v) || typeof v === 'string') return v;
      if (typeof v === 'object') return Object.keys(v);
      throw new NexusRuntimeError(`cannot iterate over ${rt.type(v)}`);
    },

    _show: show,
  };

  function requireList(v, fn) {
    if (!Array.isArray(v)) throw new NexusRuntimeError(`${fn}() needs a list, got ${rt.type(v)}`);
  }

  return rt;
}

class NexusRuntimeError extends Error {
  constructor(msg) { super(msg); this.name = 'NexusRuntimeError'; }
}

module.exports = { createRuntime, BUILTIN_NAMES, NexusRuntimeError };
