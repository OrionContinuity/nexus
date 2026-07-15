// curia_formulary.js — THE FORMULARY: Clippy's library of reusable task-drafts ("the draft email he reuses").
//
// A Formula is a proven plan with blanks. The Senate writes one the FIRST time a task is met; the Consul
// retrieves it and the Vigil replays it every time after — so the heavy brain pays for a task exactly once.
// Dependency-free (Node built-ins only), CommonJS, so clippy_agent.js can just require() it.
//
//   drafts live at   <mcdir>/commons/formulary/<id>.json   (under commons, so the whole trio shares drafts)
//
// A Formula on disk looks like:
//   {
//     "id": "chop_tree",
//     "name": "Chop a tree",
//     "when": { "tags": ["tree","log","wood","gather"], "needs": ["axe?"] },   // retrieval signature
//     "blanks": ["target","dir","count"],                                       // the fill-in-the-blanks
//     "steps": [ {"do":"equip","what":"best_axe"},
//                {"do":"goto","what":"{target}"},
//                {"do":"mine","what":"{target}","times":"{count}"},
//                {"do":"collect","what":"log"} ],
//     "born": 1700000000000, "uses": 0, "wins": 0, "author": "senate"
//   }
// needs ending in "?" are soft (nice-to-have); needs without "?" are hard (an unmet one kills the match).

const fs = require('fs');
const path = require('path');

function dir(mcdir) {
  const d = path.join(mcdir || process.cwd(), 'commons', 'formulary');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}

function safe(id) { return String(id).replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 64); }

// Turn a situation OR a formula's trigger set into a bag of lowercase tokens for overlap scoring.
function bag(x) {
  const out = new Set();
  const push = v => {
    if (v == null) return;
    String(v).toLowerCase().split(/[^a-z0-9:_]+/).forEach(t => { if (t) out.add(t); });
  };
  if (Array.isArray(x)) x.forEach(push);
  else if (x && typeof x === 'object') {
    for (const k of ['tags', 'triggers', 'needs', 'has', 'goal', 'see', 'tag', 'text', 'scene', 'words']) {
      if (x[k] != null) (Array.isArray(x[k]) ? x[k] : [x[k]]).forEach(push);
    }
  } else push(x);
  return out;
}

// Save (or update) a draft. Preserves earned use/win counts across rewrites.
function save(mcdir, formula) {
  if (!formula || !formula.id) throw new Error('formula needs an id');
  const f = Object.assign({ born: Date.now(), uses: 0, wins: 0, author: 'senate' }, formula);
  const p = path.join(dir(mcdir), safe(formula.id) + '.json');
  try {
    const prev = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (prev.uses) f.uses = prev.uses;
    if (prev.wins) f.wins = prev.wins;
    if (prev.born) f.born = prev.born;
  } catch (e) {}
  fs.writeFileSync(p, JSON.stringify(f, null, 2));
  return f;
}

// Read every draft the trio has filed (the shared union).
function all(mcdir) {
  const d = dir(mcdir); const out = [];
  let files = []; try { files = fs.readdirSync(d); } catch (e) {}
  for (const fn of files) {
    if (!fn.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(d, fn), 'utf8'))); } catch (e) {}
  }
  return out;
}

// RETRIEVAL — "know which draft to grab." Weighted token overlap between the live situation and each
// formula's `when`, minus a penalty for hard needs the situation can't satisfy. Deterministic, no deps.
// (Graduates later to embedding cosine computed by the Senate; this signature stays identical.)
function score(formula, situation) {
  const want = bag(formula.when || {});
  if (!want.size) return 0;
  const have = bag(situation);
  const needs = (formula.when && formula.when.needs) || [];
  for (const n of needs) {
    const soft = String(n).endsWith('?');
    const key = String(n).replace(/\?$/, '').toLowerCase();
    if (!soft && !have.has(key)) return 0;                 // unmet HARD need -> not applicable
  }
  let hit = 0; for (const t of want) if (have.has(t)) hit++;
  let s = hit / want.size;                                  // fraction of triggers present
  s += Math.min(0.15, (formula.wins || 0) * 0.01);          // proven drafts float up a little
  return s;
}

function match(mcdir, situation, threshold) {
  // permissive first-cut cutoff: one strong trigger (e.g. "creeper") should be enough to grab an urgent
  // draft. The embedding upgrade replaces this constant with a learned similarity later.
  if (threshold == null) threshold = 0.3;
  let best = null, bestScore = 0;
  for (const f of all(mcdir)) {
    const s = score(f, situation);
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return bestScore >= threshold ? { formula: best, score: +bestScore.toFixed(3) } : null;
}

// FILL — turn a saved draft into a concrete, executable step list by substituting {blanks}.
// Reports any blank left unfilled so the Consul can defer to the Senate instead of acting blind.
function fill(formula, blanks) {
  blanks = blanks || {};
  const sub = s => String(s).replace(/\{(\w+)\}/g, (m, k) => (blanks[k] != null ? blanks[k] : m));
  const steps = (formula.steps || []).map(st => {
    const o = {}; for (const k of Object.keys(st)) o[k] = (typeof st[k] === 'string') ? sub(st[k]) : st[k];
    return o;
  });
  const missing = [];
  const scan = JSON.stringify(steps); const re = /\{(\w+)\}/g; let m;
  while ((m = re.exec(scan))) if (!missing.includes(m[1])) missing.push(m[1]);
  return { id: formula.id, steps, missing };
}

// Feedback — bump uses/wins so good drafts earn priority and bad ones get flagged for a rewrite.
function record(mcdir, id, outcome) {
  const p = path.join(dir(mcdir), safe(id) + '.json');
  let f; try { f = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
  f.uses = (f.uses || 0) + 1;
  if (outcome && outcome.win) f.wins = (f.wins || 0) + 1;
  try { fs.writeFileSync(p, JSON.stringify(f, null, 2)); } catch (e) {}
  return f;
}

module.exports = { dir, save, all, match, score, fill, record, bag, safe };
