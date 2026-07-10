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
(function () {
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

  NX.clippyManus = {
    suggest: suggest,
    navigate: navigate,
    _viewFor: VIEW_FOR,
  };
})();
