/* ═══════════════════════════════════════════════════════════════════════════
   clippy-manus.js — MANUS. The hand of the mind.

   MENS perceives the true state of the house; MANUS lets Clippy ACT on it.
   A mind that can only see and speak is half a mind. This is the other half —
   small, for now: when a grounded answer is about work, equipment, orders,
   cleaning or vendors, MANUS offers to TAKE YOU THERE — one tap from his reply
   to the actual screen. No guessing which tab; his hand is already on it.

   This first hand is navigation only — it opens views, it writes nothing. It
   reuses MENS's classifier (pure, instant, no network) to know where "there"
   is, and only offers a jump the current user is actually allowed to take.

   (Alfredo's law: never modify records without asking. So when MANUS grows a
   writing hand, every write will pass through his explicit yes — a hand with
   a conscience. Not yet; navigation first.)

   Exposed as NX.clippyManus.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (LEX) {
  'use strict';
  var NX = (window.NX = window.NX || {});

  // Primary domain → the screen that answers it. Labels are what the button
  // says; views are the real data-view names (verified against index.html).
  var VIEW_FOR = {
    work:      { view: 'issues',    label: 'Open Work Orders' },
    equipment: { view: 'equipment', label: 'Open Equipment' },
    ordering:  { view: 'inventory', label: 'Open Inventory' },
    cleaning:  { view: 'clean',     label: 'Open Cleaning' },
    vendors:   { view: 'vendors',   label: 'Open Vendors' },
  };

  // A tab the user can actually reach — present AND visible. Permission and
  // login state hide tabs with display:none (offsetParent goes null), so this
  // doubles as "is this screen available to whoever is asking".
  function tabFor(view) {
    try {
      var els = document.querySelectorAll('.nav-tab[data-view="' + view + '"], .bnav-btn[data-view="' + view + '"]');
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.offsetParent !== null || (e.getClientRects && e.getClientRects().length > 0)) return e;
      }
      return null;
    } catch (_) { return null; }
  }

  // Actually go. Mirrors the deep-link router's own nav(): click whichever
  // control exists (desktop tab or bottom-nav button).
  function navigate(view) {
    var hit = false;
    try {
      var t = document.querySelector('.nav-tab[data-view="' + view + '"]');
      if (t) { t.click(); hit = true; }
      var b = document.querySelector('.bnav-btn[data-view="' + view + '"]');
      if (b) { b.click(); hit = true; }
    } catch (_) {}
    return hit;
  }

  // Given a question, where — if anywhere — should his hand offer to go?
  // Returns { view, label, domain, location } or null. Null when the question
  // touches no domain, or when the user can't reach that screen anyway.
  function suggest(question) {
    try {
      var M = NX.clippyMens || (window.NX && window.NX.clippyMens);
      if (!M || typeof M.classify !== 'function') return null;
      var c = M.classify(question);
      if (!c.domains || !c.domains.length) return null;
      // Prefer the most specific faculty when several fired: a "who do we call"
      // that also mentions equipment should still land on vendors, etc. Order
      // of preference, most-actionable first.
      var order = ['vendors', 'equipment', 'work', 'ordering', 'cleaning'];
      var domain = null;
      for (var i = 0; i < order.length; i++) {
        if (c.domains.indexOf(order[i]) >= 0) { domain = order[i]; break; }
      }
      if (!domain) domain = c.domains[0];
      var v = VIEW_FOR[domain];
      if (!v || !tabFor(v.view)) return null;   // no such screen for this user
      return { view: v.view, label: v.label, domain: domain, location: c.location };
    } catch (_) { return null; }
  }

  // ── The writing hand, with a conscience. ─────────────────────────────────
  // MENS perceives a report; MANUS proposes a work order; the confirm UI in
  // clippy.js is the conscience (Alfredo's law: never modify records without
  // asking). proposeWorkOrder() only DESCRIBES — it writes nothing.
  // commitWorkOrder() performs the insert, and is called ONLY after the user
  // has explicitly tapped confirm.

  // Resolve clippyMens from whichever NX carries it (feature-detect window.NX).
  function mens() {
    return (NX && NX.clippyMens) || (window.NX && window.NX.clippyMens) || (LEX && LEX.clippyMens) || null;
  }
  function sbClient() {
    return (NX && NX.sb) || (window.NX && window.NX.sb) || (LEX && LEX.sb) || null;
  }
  function currentUser() {
    return (LEX && LEX.currentUser) || (NX && NX.currentUser) || (window.NX && window.NX.currentUser) || null;
  }

  // Given a chat line, if MENS reads it as a report of something broken/needed,
  // return a draft work order for the confirm UI to show. Otherwise null.
  function proposeWorkOrder(question) {
    try {
      var M = mens();
      if (!M || typeof M.isReport !== 'function' || typeof M.classify !== 'function') return null;
      if (!M.isReport(question)) return null;
      var q = String(question || '').trim();
      var c = M.classify(q);
      var priority = /urgent|emergency|asap|now|flood|gas|fire|no\s+(?:heat|hot\s+water|power)/i.test(q) ? 'high' : 'normal';
      return { title: q.slice(0, 80), location: c.location, priority: priority };
    } catch (_) { return null; }
  }

  // Perform the insert. CALLED ONLY after explicit confirmation. Returns
  // { ok:true, card } or { ok:false, error }. supabase-js resolves with
  // {error} — every call is destructured and checked (no dead catch).
  var LOC = { suerte: 'Suerte', este: 'Este', toti: 'Bar Toti' };
  async function commitWorkOrder(order) {
    try {
      var sb = sbClient();
      if (!sb) return { ok: false, error: 'no database connection' };
      order = order || {};
      var u = currentUser();
      var who = (u && u.name) || 'someone';
      var priority = order.priority || 'normal';
      var locKey = order.location ? String(order.location).toLowerCase() : '';
      var location = LOC[locKey] || order.location || null;
      var desc = 'Logged from a Clippy chat, confirmed by ' + who + '.';

      var row = {
        title: order.title,
        description: desc,
        column_name: 'todo',
        priority: priority,
        location: location,
        reported_by: who,
        checklist: [],
        comments: [],
        labels: ['clippy-logged'],
        photo_urls: [],
        archived: false,
      };

      // Column-drift fallback: schemas differ across boards; if a column the
      // payload names doesn't exist, drop it and retry (mirrors js/domain.js).
      var payload = Object.assign({}, row);
      var created = null;
      for (var attempt = 0; attempt < 8; attempt++) {
        var res = await sb.from('kanban_cards').insert(payload).select('*').single();
        if (!res || !res.error) { created = res && res.data; break; }
        var m = /column "?([a-z0-9_]+)"?.*does not exist/i.exec(res.error.message || '');
        if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) { delete payload[m[1]]; continue; }
        return { ok: false, error: res.error.message || 'insert failed' };
      }
      if (!created) return { ok: false, error: 'could not create card' };

      // Mirror into tickets so it shows on the work-order surfaces too. A mirror
      // failure does not undo the card — but we still {error}-check the call.
      try {
        var tRes = await sb.from('tickets').insert({
          title: order.title,
          notes: desc,
          location: location,
          priority: priority,
          status: 'open',
          reported_by: who,
          board_card_id: created.id,
        });
        if (tRes && tRes.error) { /* card stands; mirror is best-effort */ }
      } catch (_) {}

      return { ok: true, card: created };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'error' };
    }
  }

  NX.clippyManus = {
    suggest: suggest,
    navigate: navigate,
    proposeWorkOrder: proposeWorkOrder,
    commitWorkOrder: commitWorkOrder,
    _viewFor: VIEW_FOR,
  };
  // DUAL-NX: also bind to app.js's lexical global so bare `NX.clippyManus`
  // resolves there too (the Lexical-NX trap — see steward digest).
  try { if (LEX && LEX !== NX) LEX.clippyManus = NX.clippyManus; } catch (_) {}
})(typeof NX !== 'undefined' ? NX : null);
