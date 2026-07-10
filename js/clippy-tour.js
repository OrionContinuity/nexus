/* ════════════════════════════════════════════════════════════════════
   clippy-tour.js — Clippy guides new users through NEXUS
   ────────────────────────────────────────────────────────────────────
   v18.33 — net-new. Follows the clippy-games.js pattern: late-binding
   init that polls for NX.clippy._internal, then attaches its public
   surface as NX.clippy.tour.

   WHAT IT DOES
     • Offers a guided walkthrough to new users (low session count, tour
       never completed), a few seconds after login.
     • Each step navigates to a view (permission-gated via
       NX.hasPermission), pulses the matching nav button, and Clippy
       explains the room in his own voice. Next / Skip on every bubble.
     • Welcome + finish use NX.clippy.moment (center-stage). Finish
       drops confetti and marks preferences.tour_completed so it never
       auto-offers again. Restartable any time via NX.clippy.tour.start()
       (wired into Clippy's long-press menu by clippy.js).

   PUBLIC API
     NX.clippy.tour.start()   — run the tour from the top
     NX.clippy.tour.isDone()  — has this user finished/declined it

   LOADED via a separate <script> tag in index.html, AFTER clippy.js.
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  function init() {
    if (!window.NX || !NX.clippy || !NX.clippy._internal) {
      init._n = (init._n || 0) + 1;
      setTimeout(init, init._n < 300 ? 50 : 5000);
      return;
    }
    const ix = NX.clippy._internal;
    const state           = ix.state;
    const bubble          = ix.bubble;
    const actionBubble    = ix.actionBubble;
    const closeBubble     = ix.closeActionBubble;
    const mood            = ix.mood;
    const spawnParticles  = ix.spawnParticles;
    const playTone        = ix.playTone;
    const savePreferences = ix.savePreferences || function () {};
    const trackTimeout    = ix.trackTimeout    || function (fn, ms) { return setTimeout(fn, ms); };
    const trackListener   = ix.trackListener   || function (el, ev, fn) { el.addEventListener(ev, fn); };

    // ─── The script ──────────────────────────────────────────────────
    // view: null = no navigation (Clippy talks where he stands).
    // Perm keys match app.js PERM_RESOURCES; steps the user can't see
    // are skipped silently.
    const STEPS = [
      { view: 'home', perm: 'home', mood: 'happy',
        text: 'Home is the pulse: what’s down, what’s overdue, what needs a human with keys. I refresh it obsessively. One of us has to.' },
      { view: 'clean', perm: 'clean', mood: 'disgusted',
        text: 'Cleaning lives here — today’s checklist, zone by zone. Some tasks want a photo before they count. The dish pit knows when it’s been skipped. I’ve seen it.' },
      { view: 'board', perm: 'board', mood: 'strategist',
        text: 'The board. To Do, In Progress, Done — cards ride left to right. When a machine breaks, a card appears here on its own. That’s me. You’re welcome.' },
      { view: 'equipment', perm: 'equipment', mood: 'genius',
        text: 'Every unit in the building, with its full history. Scan the QR on a machine to report an issue or call its vendor. The machines can’t talk. I translate.' },
      { view: 'dailylog', perm: 'dailylog', mood: 'thinking',
        text: 'Daily notes. Every morning this writes itself from the board and the equipment — and I do the opening line. The comedy is contractual.' },
    ];

    let running = false;
    let spotEl = null;

    function isDone() {
      return !!(state.preferences && state.preferences.tour_completed);
    }
    function markDone() {
      try {
        state.preferences.tour_completed = new Date().toISOString();
        savePreferences();
      } catch (_) {}
    }

    // Pulse the nav button that leads to a view — desktop tab or bottom
    // nav, whichever is visible.
    function spotlight(view) {
      unspot();
      if (!view) return;
      const btns = document.querySelectorAll(
        '.nav-tab[data-view="' + view + '"], .bnav-btn[data-view="' + view + '"]');
      btns.forEach(b => b.classList.add('clippy-tour-spot'));
      spotEl = btns;
    }
    function unspot() {
      if (spotEl) { spotEl.forEach(b => b.classList.remove('clippy-tour-spot')); spotEl = null; }
      document.querySelectorAll('.clippy-tour-spot')
        .forEach(b => b.classList.remove('clippy-tour-spot'));
    }

    function visibleSteps() {
      return STEPS.filter(s => {
        try {
          if (s.perm && NX.hasPermission && !NX.hasPermission(s.perm)) return false;
          if (s.view && !document.getElementById(s.view + 'View')) return false;
          return true;
        } catch (_) { return true; }
      });
    }

    function endTour(finished) {
      running = false;
      unspot();
      markDone();
      if (finished) {
        try { NX.clippy.processInteraction && NX.clippy.processInteraction('achievement_earned'); } catch (_) {}
        mood('super_excited', 6000);
        spawnParticles({ count: 24, type: 'confetti' });
        playTone('milestone');
        const closer = 'That’s the tour. Tap me any time — hold three seconds for the full menu. I also run an arcade. Nobody asked for one. I’m still proud of it.';
        if (NX.clippy.moment && NX.clippy.moment({ text: closer, eyebrow: '🧭 TOUR', mood: 'proud',
          actions: [{ label: 'Thanks, Clippy', cls: 'is-primary', onClick: () => closeBubble() }] })) return;
        bubble(closer, { eyebrow: '🧭 TOUR' });
      } else {
        bubble('Fair. The building explains itself eventually — usually the hard way. I’m here if you want the short version.', { autoHide: 4200 });
        mood('happy', 3000);
      }
    }

    function runStep(steps, i) {
      if (!running) return;
      if (i >= steps.length) { endTour(true); return; }
      const s = steps[i];
      try { if (s.view && NX.switchTo) NX.switchTo(s.view); } catch (_) {}
      spotlight(s.view);
      if (s.mood) mood(s.mood, 6000);
      // Small beat so the view finishes rendering before he speaks.
      trackTimeout(() => {
        if (!running) return;
        const n = i + 1;
        actionBubble(s.text, {
          eyebrow: '🧭 TOUR · ' + n + '/' + steps.length,
          autoHide: 0,
          actions: [
            { label: n < steps.length ? 'Next ›' : 'Finish', cls: 'is-primary',
              onClick: () => { closeBubble(); runStep(steps, i + 1); } },
            { label: 'Skip tour', onClick: () => { closeBubble(); endTour(false); } },
          ],
          onDismiss: () => { if (running) { running = false; unspot(); } },
        });
      }, 420);
    }

    function start() {
      if (running) return;
      const steps = visibleSteps();
      if (!steps.length) return;
      running = true;
      const opener = 'Welcome to NEXUS. I live here — officially the facilities daemon, unofficially the only employee who never clocks out. Want the tour? Takes a minute. I’ve done the route.';
      const opts = {
        text: opener, eyebrow: '👋 WELCOME', mood: 'happy',
        actions: [
          { label: 'Show me around', cls: 'is-primary', onClick: () => { closeBubble(); runStep(steps, 0); } },
          { label: 'Maybe later', onClick: () => { closeBubble(); running = false; } },
        ],
      };
      // moment() center-stages him; returns false when he's busy — fall
      // back to a regular sticky bubble so start() always works.
      let ok = false;
      try { ok = NX.clippy.moment ? NX.clippy.moment(opts) : false; } catch (_) {}
      if (!ok) {
        actionBubble(opener, { eyebrow: '👋 WELCOME', autoHide: 0, actions: opts.actions });
      }
    }

    // ─── Auto-offer for new users ────────────────────────────────────
    // A few seconds after login: user accepted Clippy, has never done
    // the tour, and is still new (few sessions). Once per browser
    // session so a decline isn't nagged.
    function maybeOffer() {
      try {
        if (isDone()) return;
        if (!state.preferences || !state.preferences.accepted_at) return;
        if ((state.preferences.session_count || 0) > 4) return;
        // v18.57 — offer ONCE EVER, not once per tab-session. Alfredo:
        // "this pops up a lot — have it pop up only once ever." sessionStorage
        // reset on every fresh app open, so the welcome re-nagged forever.
        // A persistent, per-user flag fixes it; the tour is still restartable
        // any time from Clippy's long-press menu.
        var offerKey = 'nx_clippy_tour_offered_ever:' +
          ((window.NX && NX.currentUser && (NX.currentUser.id || NX.currentUser.name)) || 'anon');
        if (localStorage.getItem(offerKey)) return;
        try { localStorage.setItem(offerKey, '1'); } catch (_) {}
        trackTimeout(() => {
          if (!running && !state.bubble && !state.suppressed) start();
        }, 9000);
      } catch (_) {}
    }
    trackListener(document, 'nexus:user-change', maybeOffer);
    maybeOffer();

    NX.clippy.tour = { start, isDone };
  }

  init();
})();
