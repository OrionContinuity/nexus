#!/usr/bin/env node
'use strict';
/*
 * integration-conformance.cjs — cross-body integration harness for Clippy/NEXUS.
 *
 * PURPOSE
 *   Prove, with a STATIC / STRUCTURAL check that needs NO live DB, that the
 *   cross-body integration (the desktop agent ⇄ the web pet ⇄ soul/mens/manus/
 *   power/games) is wired end-to-end — so "he can fully do everything" is
 *   VERIFIABLE, not aspirational. Prints PASS/FAIL per check; exits non-zero if
 *   any check fails.
 *
 * HOW IT WORKS
 *   - Check 1 (ANIMA codec parity) reuses the approach of
 *     scripts/anima-conformance.cjs: it requires the real js/clippy-anima.js and
 *     asserts the inline codec constants (_TEMPER/_INERT) embedded in
 *     clippy_agent.js still produce a byte-identical genesis strand. If the two
 *     souls ever drift apart, the desktop agent and the pet stop understanding
 *     each other's ANIMA — this catches that.
 *   - Check 2 is a set of wiring-presence greps: each integration hook must be
 *     literally present in its source file. These are the seams between the
 *     bodies (askPoolTxt, the minecraft/desktop realm bridge, self-report,
 *     game presence, the write-hand work-order flow, the power gate, etc.).
 *
 * WHEN TO RUN
 *   This harness is IDEMPOTENT and safe to run repeatedly — it only reads files.
 *   NOTE: the wiring-presence greps in Check 2 pass only AFTER the sibling build
 *   agents that add those hooks have landed. When the agents run concurrently,
 *   expect FAILs until each seam is written. It is meant to be run by the
 *   ORCHESTRATOR once all agents have landed, as the final go/no-go gate.
 *
 * DEPENDENCIES: none (stdlib only). Node >= 12.
 * USAGE: node scripts/integration-conformance.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function abs(p) { return path.join(ROOT, p); }

// ── result tracking ────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(label, note) {
  pass++;
  console.log('  PASS  ' + label + (note ? '  — ' + note : ''));
}
function bad(label, note) {
  fail++;
  console.log('  FAIL  ' + label + (note ? '  — ' + note : ''));
}
function check(label, cond, noteOnFail, noteOnPass) {
  if (cond) ok(label, noteOnPass); else bad(label, noteOnFail);
  return !!cond;
}

// ── file helpers ───────────────────────────────────────────────────────────
function readSrc(rel) {
  try { return fs.readFileSync(abs(rel), 'utf8'); }
  catch (e) { return null; }
}
// Assert a literal substring is present in a source file. A missing file is a
// clean FAIL (not a crash) so the harness is safe to run before agents land.
function contains(label, rel, needle) {
  const src = readSrc(rel);
  if (src == null) return bad(label, 'file missing: ' + rel);
  if (src.indexOf(needle) !== -1) return ok(label);
  return bad(label, 'not found in ' + rel + ': ' + JSON.stringify(needle));
}
// Assert ANY of several needles is present (for a widened map where wording may
// vary between agents' implementations).
function containsAny(label, rel, needles) {
  const src = readSrc(rel);
  if (src == null) return bad(label, 'file missing: ' + rel);
  for (const n of needles) if (src.indexOf(n) !== -1) return ok(label, 'via ' + JSON.stringify(n));
  return bad(label, 'none of ' + JSON.stringify(needles) + ' in ' + rel);
}

// ── codec parity helpers (mirror js/clippy-anima.js, no eval of the agent) ───
function seedOf(str) {                     // FNV-1a 32-bit → 4 bytes
  let h = 0x811c9dc5;
  str = String(str || 'clippy');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
}
function q(x) { const c = x < 0 ? 0 : x > 1 ? 1 : x; return Math.max(0, Math.min(255, Math.round(c * 255))); }
function encodeGenesisFrom(temper, inert) {
  const seed = seedOf('clippy:origin');
  const out = seed.slice(0, 4);
  for (let i = 0; i < 12; i++) out.push(q(temper[i]));   // x
  for (let i = 0; i < 12; i++) out.push(q(temper[i]));   // b
  for (let i = 0; i < 12; i++) out.push(q(inert[i]));    // v
  out.push(1 & 255, 0 & 255, 0 & 255, 0 & 255);          // inc, fork, drift, drift-frac
  return out.map(function (b) { return String.fromCharCode(0x2800 + (b & 255)); }).join('');
}
// Pull a numeric array literal named `name` out of a source string.
function parseArray(src, name) {
  if (src == null) return null;
  const re = new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]');
  const m = src.match(re);
  if (!m) return null;
  const nums = m[1].split(',').map(function (s) { return parseFloat(s.trim()); });
  if (nums.some(function (n) { return Number.isNaN(n); })) return null;
  return nums;
}
function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ═════════════════════════════════════════════════════════════════════════
// CHECK 1 — ANIMA codec parity (agent's inline soul vs the real module)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] ANIMA codec parity  (clippy_agent.js inline codec ⇄ js/clippy-anima.js)');
let A = null;
try {
  A = require(abs('js/clippy-anima.js'));
} catch (e) {
  bad('anima module loads', String(e && e.message || e));
}

if (A) {
  ok('anima module loads');
  const agentSrc = readSrc('clippy_agent.js');
  const inlineTemper = parseArray(agentSrc, '_TEMPER');
  const inlineInert = parseArray(agentSrc, '_INERT');

  check('agent _TEMPER parsed from clippy_agent.js', !!inlineTemper, 'could not locate/parse _TEMPER array');
  check('agent _INERT parsed from clippy_agent.js', !!inlineInert, 'could not locate/parse _INERT array');

  // Derive the module's baselines from a genesis soul — the single source of
  // truth (the module exports TEMPERAMENT but not INERTIA; genesis().v is it).
  let baseTemper = null, baseInert = null;
  try { const g = A.genesis('clippy:origin'); baseTemper = g.b; baseInert = g.v; } catch (e) { /* handled below */ }

  // Constant-array parity against the real module's baselines.
  check('_TEMPER matches clippy-anima temperament (genesis.b)',
    inlineTemper && baseTemper && arraysEqual(inlineTemper, baseTemper),
    'inline temperament drifted from the module baseline');
  check('_INERT matches clippy-anima inertia (genesis.v)',
    inlineInert && baseInert && arraysEqual(inlineInert, baseInert),
    'inline inertia drifted from the module baseline');

  // The load-bearing assertion: genesis strand must be BYTE-IDENTICAL, so the
  // agent and the pet encode/decode the same soul.
  let realGenesis = null;
  try { realGenesis = A.encode(A.genesis('clippy:origin')); } catch (e) { /* handled below */ }
  check('module genesis encodes to a 44-cell braille strand',
    typeof realGenesis === 'string' && realGenesis.length === 44,
    'unexpected genesis strand: ' + JSON.stringify(realGenesis));

  if (inlineTemper && inlineInert && realGenesis) {
    const inlineGenesis = encodeGenesisFrom(inlineTemper, inlineInert);
    check('agent inline codec genesis === module genesis (byte-identical)',
      inlineGenesis === realGenesis,
      'strands differ\n         inline: ' + JSON.stringify(inlineGenesis) +
      '\n         module: ' + JSON.stringify(realGenesis));
  } else {
    bad('agent inline codec genesis === module genesis (byte-identical)',
      'skipped — prerequisite parse/encode failed');
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CHECK 2 — wiring-presence assertions (the seams between the bodies)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] Wiring presence  (integration hooks exist in source)');

// -- clippy_agent.js : the desktop agent's bridges --
contains('agent · askPoolTxt (subscription text lane)', 'clippy_agent.js', 'askPoolTxt');
contains('agent · realm=in.(minecraft,desktop) (memory realm bridge)', 'clippy_agent.js', 'realm=in.(minecraft,desktop)');
contains('agent · animaSelfReport (soul self-report)', 'clippy_agent.js', 'animaSelfReport');
contains('agent · clippy_desktop_presence (presence beacon sink)', 'clippy_agent.js', 'clippy_desktop_presence');

// -- js/clippy.js : the web pet's integration hooks --
contains('pet · pullMinecraftMemories (game→memory bridge)', 'js/clippy.js', 'pullMinecraftMemories');
contains('pet · pollGamePresence (game presence poll)', 'js/clippy.js', 'pollGamePresence');
contains('pet · beaconDesktopPresence (desktop presence beacon)', 'js/clippy.js', 'beaconDesktopPresence');
containsAny('pet · widened FF whisper map (new moods)', 'js/clippy.js', ['determined', 'melancholy']);
contains('pet · proposeWorkOrder (write-hand UI hook)', 'js/clippy.js', 'proposeWorkOrder');

// -- js/clippy-soul.js : the eyes + self-report --
contains('soul · clippy_eyes (vision channel)', 'js/clippy-soul.js', 'clippy_eyes');
contains('soul · selfReport (soul self-report)', 'js/clippy-soul.js', 'selfReport');

// -- MENS (mind) + MANUS (hand) : the write-hand flow --
contains('mens · isReport (report classifier)', 'js/clippy-mens.js', 'isReport');
contains('manus · proposeWorkOrder (offer to log a work order)', 'js/clippy-manus.js', 'proposeWorkOrder');
contains('manus · commitWorkOrder (confirmed write)', 'js/clippy-manus.js', 'commitWorkOrder');

// -- js/clippy-power.js : the power gate (must exist) --
(function () {
  const rel = 'js/clippy-power.js';
  const src = readSrc(rel);
  if (src == null) {
    bad('power · js/clippy-power.js exists', 'file missing: ' + rel);
    bad('power · isFullPower (full-power gate)', 'file missing: ' + rel);
    bad('power · clippy:power-change (power-change event)', 'file missing: ' + rel);
    return;
  }
  ok('power · js/clippy-power.js exists');
  check('power · isFullPower (full-power gate)', src.indexOf('isFullPower') !== -1, 'not found in ' + rel);
  check('power · clippy:power-change (power-change event)', src.indexOf('clippy:power-change') !== -1, 'not found in ' + rel);
})();

// -- js/clippy-games.js : mid-game reactions --
contains('games · reactMidGame (in-play reactions)', 'js/clippy-games.js', 'reactMidGame');

// ═════════════════════════════════════════════════════════════════════════
console.log('\nINTEGRATION-CONFORMANCE: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
