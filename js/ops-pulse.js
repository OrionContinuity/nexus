/* ═══════════════════════════════════════════════════════════════════════════
   ops-pulse.js — THE PULSE. One honest read of the shop's true state.

   MENS (clippy-mens.js) perceives the house in PROSE, when asked a question.
   The PULSE is the quantitative twin: a single cross-domain snapshot —
   equipment, cleaning, ordering, below-par — as COUNTS plus a blended
   concern score. It exists so two things can finally know the whole shop at
   once: Clippy's face (his all-day mood), and the Morning Whisper.

   Every existing aggregator (the brief, home widgets, the notify cron) knows
   equipment but is blind to cleaning and ordering — the two domains Alfredo
   touches every day. The Pulse closes that gap.

   Design:
     • Read-only. The Pulse perceives; it never writes or acts.
     • Self-contained for the simple domains (equipment, below-par): direct,
       fail-soft Supabase reads, so it works even when no screen has loaded.
     • Delegates the two rule-heavy domains to their home modules —
       NX.orderingPulse() (delivery/cutoff schedule) and NX.cleaningOverdue()
       (the freshness engine) — so the rules live in ONE place, not two.
     • ~60s cached: the mood poll (90s) and the Whisper share one fetch.

   Laws honored (CLAUDE.md): pars are reference-only — below-par is surfaced
   as an FYI count, NEVER as a prompt to order, and it is deliberately kept
   OUT of the concern score. Nothing here auto-closes or modifies a record.

   Exposed as NX.opsPulse().
   ═══════════════════════════════════════════════════════════════════════════ */
(function (LEX) {
  'use strict';
  var NX = (window.NX = window.NX || {});

  // The three houses, however they were spelled. (Mirrors clippy-mens.js so
  // the two faculties speak the same location tongue.)
  function locNorm(s) {
    s = String(s || '').toLowerCase();
    if (s.indexOf('toti') >= 0) return 'toti';
    if (s.indexOf('este') >= 0) return 'este';
    if (s.indexOf('suerte') >= 0) return 'suerte';
    return s.trim();
  }
  var LOC_KEYS = ['suerte', 'este', 'toti'];
  var LOC_LABEL = { suerte: 'Suerte', este: 'Este', toti: 'Bar Toti' };
  function locLabel(k) { return LOC_LABEL[k] || (k ? k[0].toUpperCase() + k.slice(1) : ''); }

  // Statuses that mean "deliberately out of service" — NOT a problem to flag.
  // Reuses equipment.js's set when exposed (single source), else this copy.
  function benignSet() {
    if (NX.EQUIP_BENIGN_STATUS && typeof NX.EQUIP_BENIGN_STATUS.has === 'function') return NX.EQUIP_BENIGN_STATUS;
    return new Set(['operational', 'retired', 'archived', 'missing', 'relocated', 'loaned']);
  }
  var DOWN_STATUS = { down: 1, broken: 1 };

  function sbClient() { var n = window.NX || NX; return (n && n.sb) || null; }

  // ordering.js and cleaning.js are LAZY (loaded when their screen first opens),
  // so their Ops-Pulse hooks (NX.orderingPulse / NX.cleaningOverdue) may not
  // exist yet at boot — the moment the Whisper needs them most. Ensure the
  // module is present (NX.loadScript dedupes + fires the cb immediately when the
  // script tag already exists), then the hook is defined synchronously by its
  // IIFE. No screen renders — the module just registers its exports.
  function ensureScript(src) {
    return new Promise(function (res) {
      try {
        if (window.NX && typeof NX.loadScript === 'function') NX.loadScript(src, res);
        else res();
      } catch (_) { res(); }
    });
  }

  // supabase-js RESOLVES with {error}; a try/catch is a dead catch. Always
  // destructure. Returns [] on any failure so the Pulse degrades to "less
  // known" instead of throwing.
  async function q(builderFn) {
    try { var res = await builderFn(); if (!res || res.error) return []; return res.data || []; }
    catch (_) { return []; }
  }

  function todayISO() {
    // America/Chicago wall-clock date — the shop runs on Central.
    var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    var y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function blankLoc() {
    return { downUnits: 0, attnUnits: 0, openIssues: 0, overduePM: 0, cleaningOverdue: 0, ordersDue: 0, cutoffSoon: 0, orderIssues: 0, belowPar: 0 };
  }

  // ── EQUIPMENT — direct, fail-soft. Mirrors computeLocationStats' rule. ────
  async function readEquipment(byLoc) {
    var sb = sbClient(); if (!sb) return;
    var benign = benignSet();
    var todayIso = todayISO();
    var rows = await q(function () {
      return sb.from('equipment')
        .select('id,location,status,next_pm_date,archived,archived_at')
        .eq('is_deleted', false).limit(2000);
    });
    rows.forEach(function (e) {
      if (e.archived || e.archived_at) return;   // deliberately out of the fleet
      var k = locNorm(e.location); var L = byLoc[k]; if (!L) return;
      var st = String(e.status || '').toLowerCase();
      if (DOWN_STATUS[st]) L.downUnits++;
      else if (st && !benign.has(st)) L.attnUnits++;   // needs-service / other active problem
      if (e.next_pm_date && String(e.next_pm_date).slice(0, 10) < todayIso) L.overduePM++;
    });
    // Open equipment_issues, bucketed by the parent unit's house.
    var issues = await q(function () {
      return sb.from('equipment_issues')
        .select('id,status,equipment(location)')
        .neq('status', 'repaired').limit(500);
    });
    issues.forEach(function (i) {
      var k = locNorm(i.equipment && i.equipment.location); var L = byLoc[k]; if (!L) return;
      L.openIssues++;
    });
  }

  // ── BELOW-PAR — FYI count only (pars are reference-only; never an order). ──
  async function readBelowPar(byLoc) {
    var sb = sbClient(); if (!sb) return;
    var rows = await q(function () {
      return sb.from('inventory_stock_with_status').select('location,is_below_par').limit(2000);
    });
    rows.forEach(function (r) {
      if (!r.is_below_par) return; var k = locNorm(r.location); var L = byLoc[k]; if (!L) return; L.belowPar++;
    });
  }

  // ── ORDERING — delegate to ordering.js's schedule rules when present. ─────
  async function readOrdering(byLoc) {
    try {
      if (typeof NX.orderingPulse !== 'function') await ensureScript('js/ordering.js');
      if (typeof NX.orderingPulse !== 'function') return;
      var p = await NX.orderingPulse();
      if (!p || !p.byLoc) return;
      LOC_KEYS.forEach(function (k) {
        var c = p.byLoc[k]; if (!c) return; var L = byLoc[k];
        L.ordersDue = c.needsOrdering || 0;
        L.cutoffSoon = c.cutoffSoon || 0;
        L.orderIssues = c.issues || 0;
      });
    } catch (_) {}
  }

  // ── CLEANING — delegate to cleaning.js's freshness engine when present. ───
  async function readCleaning(byLoc) {
    try {
      if (typeof NX.cleaningOverdue !== 'function') await ensureScript('js/cleaning.js');
      if (typeof NX.cleaningOverdue !== 'function') return;
      var o = await NX.cleaningOverdue();
      if (!o) return;
      LOC_KEYS.forEach(function (k) { if (byLoc[k] && o[k] != null) byLoc[k].cleaningOverdue = o[k]; });
    } catch (_) {}
  }

  // ── Concern score (0-100). Below-par is FYI — deliberately excluded. ──────
  function scoreConcern(t) {
    var raw = (t.downUnits || 0) * 3.0
            + (t.orderIssues || 0) * 1.5
            + (t.cutoffSoon || 0) * 2.0
            + (t.openIssues || 0) * 1.0
            + (t.attnUnits || 0) * 1.0
            + (t.overduePM || 0) * 0.5
            + (t.cleaningOverdue || 0) * 0.6
            + (t.ordersDue || 0) * 0.8;
    return Math.min(100, Math.round(raw * 4));
  }

  // ── Human lines — the honest, spoken-ready summary per house. ─────────────
  function buildLines(byLoc) {
    var lines = [];
    LOC_KEYS.forEach(function (k) {
      var L = byLoc[k]; var bits = [];
      if (L.downUnits) bits.push(L.downUnits + (L.downUnits === 1 ? ' unit down' : ' units down'));
      if (L.attnUnits) bits.push(L.attnUnits + ' needing service');
      if (L.openIssues) bits.push(L.openIssues + ' open issue' + (L.openIssues === 1 ? '' : 's'));
      if (L.overduePM) bits.push(L.overduePM + ' PM overdue');
      if (L.cleaningOverdue) bits.push(L.cleaningOverdue + ' cleaning overdue');
      if (L.cutoffSoon) bits.push(L.cutoffSoon + ' cutoff' + (L.cutoffSoon === 1 ? '' : 's') + ' soon');
      if (L.ordersDue) bits.push(L.ordersDue + ' to order');
      if (L.orderIssues) bits.push(L.orderIssues + ' order issue' + (L.orderIssues === 1 ? '' : 's'));
      if (bits.length) lines.push(locLabel(k) + ': ' + bits.join(', ') + '.');
      else lines.push(locLabel(k) + ': clear.');
    });
    return lines;
  }

  var _cache = null, _at = 0;
  var TTL = 60 * 1000;

  async function opsPulse(opts) {
    opts = opts || {};
    if (!opts.fresh && _cache && (Date.now() - _at) < TTL) return _cache;
    var byLoc = {};
    LOC_KEYS.forEach(function (k) { byLoc[k] = blankLoc(); });

    if (!sbClient() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      // Offline / no client — return a calm empty pulse rather than throw.
      var empty = { byLoc: byLoc, totals: blankLoc(), worst: null, concern: 0, lines: buildLines(byLoc), at: Date.now(), offline: true };
      return empty;
    }

    // Simple domains read directly; the two rule-heavy ones delegate home.
    await Promise.all([
      readEquipment(byLoc),
      readBelowPar(byLoc),
      readOrdering(byLoc),
      readCleaning(byLoc),
    ]);

    // Totals + worst house (by its own concern weight).
    var totals = blankLoc();
    var worst = null, worstScore = -1;
    LOC_KEYS.forEach(function (k) {
      var L = byLoc[k];
      Object.keys(totals).forEach(function (f) { totals[f] += (L[f] || 0); });
      var s = scoreConcern(L);
      if (s > worstScore) { worstScore = s; worst = (s > 0 ? k : worst); }
    });

    var pulse = {
      byLoc: byLoc,
      totals: totals,
      worst: worst,
      worstLabel: worst ? locLabel(worst) : null,
      concern: scoreConcern(totals),
      lines: buildLines(byLoc),
      at: Date.now(),
    };
    _cache = pulse; _at = Date.now();
    return pulse;
  }

  NX.opsPulse = opsPulse;
  // DUAL-NX: bind to app.js's lexical global too (the Lexical-NX trap).
  try { if (LEX && LEX !== NX) LEX.opsPulse = opsPulse; } catch (_) {}
})(typeof NX !== 'undefined' ? NX : null);
