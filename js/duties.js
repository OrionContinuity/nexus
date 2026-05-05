/* ═══════════════════════════════════════════════════════════════════
   duties.js — Cleaning / Ordering tab orchestrator
   ═══════════════════════════════════════════════════════════════════
   The "Duties" view (formerly "Cleaning") is now a wrapper for two
   sub-modules: cleaning (the existing shift tracker) and ordering (a
   new vendor email composer). This file owns the tab strip on top of
   the view and toggles which sub-pane is visible. The two sub-modules
   render into their own panes and don't know about each other.

   Wiring:
   - app.js loads cleaning.js → ordering.js → duties.js when the user
     first navigates to the 'clean' view, then calls duties.init().
   - On every re-activation of the 'clean' view, app.js calls
     duties.show() so the active pane can refresh time-sensitive
     content (e.g. recent orders may have arrived).
   - duties.activatePane(name) is the public API; it persists the
     last-active pane to localStorage so the user comes back to where
     they left off.

   Pane lifecycle:
   - Cleaning is the default pane and is initialized by cleaning.js
     before duties.js loads. We don't touch its lifecycle.
   - Ordering's init runs lazily on first activation (saves a query
     round-trip if the user only ever uses Cleaning).
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (window.NX && window.NX.modules && window.NX.modules.duties) return;
  window.NX = window.NX || {}; NX.modules = NX.modules || {};

  const STORAGE_KEY      = 'nexus_duties_active_pane';
  const VALID_PANES      = ['cleaning', 'ordering'];
  const DEFAULT_PANE     = 'cleaning';
  let   activePane       = null;
  let   orderingInitDone = false;
  let   wired            = false;

  function readPersisted() {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID_PANES.includes(v) ? v : DEFAULT_PANE;
  }

  function persist(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (_) {}
  }

  /**
   * Switch to the named pane. Hides others, updates tab visual state,
   * lazy-initializes ordering on first visit, and calls the relevant
   * sub-module's show() so it can refresh.
   */
  function activatePane(name) {
    if (!VALID_PANES.includes(name)) name = DEFAULT_PANE;
    activePane = name;
    persist(name);

    // Tab visual state
    document.querySelectorAll('.duties-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.pane === name);
    });

    // Pane visibility
    document.querySelectorAll('.duties-pane').forEach(p => {
      const match = p.dataset.pane === name;
      p.hidden = !match;
    });

    // Lazy-init ordering on first activation
    if (name === 'ordering' && NX.modules.ordering) {
      if (!orderingInitDone && NX.modules.ordering.init) {
        try { NX.modules.ordering.init(); orderingInitDone = true; }
        catch (e) { console.error('[duties] ordering init failed:', e); }
      } else if (NX.modules.ordering.show) {
        try { NX.modules.ordering.show(); }
        catch (e) { console.error('[duties] ordering show failed:', e); }
      }
    }
  }

  /**
   * Wire tab buttons. Idempotent — re-running attaches no extra
   * listeners since we use a `wired` flag.
   */
  function wireTabs() {
    if (wired) return;
    const tabs = document.querySelectorAll('.duties-tab');
    if (!tabs.length) {
      // The tab strip isn't in the DOM yet — bail. init() will retry
      // on the next show() pass after the cleaning markup is mounted.
      return;
    }
    tabs.forEach(t => {
      t.addEventListener('click', (e) => {
        e.preventDefault();
        activatePane(t.dataset.pane);
      });
    });
    wired = true;
  }

  /**
   * Called once after duties.js loads. Wires tabs, restores last-
   * active pane (default: cleaning).
   */
  function init() {
    wireTabs();
    activatePane(readPersisted());
  }

  /**
   * Called every time the 'clean' view is shown. We re-wire in case
   * the DOM was rebuilt (rare), and ping the active pane's sub-module
   * so it can refresh.
   */
  function show() {
    wireTabs();
    if (activePane === 'ordering' && NX.modules.ordering && NX.modules.ordering.show) {
      try { NX.modules.ordering.show(); }
      catch (e) { console.error('[duties] ordering refresh failed:', e); }
    }
    // Cleaning sub-module's own show() is invoked separately by app.js
    // (since cleaning.js is the primary module under 'clean' view).
  }

  NX.modules.duties = { init, show, activatePane };
  console.log('[duties] loaded');
})();
