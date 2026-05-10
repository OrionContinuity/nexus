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

    // Body class signals which pane is active. CSS uses `is-pane-cleaning`
    // to scope the takeover treatment (hide bottom-nav, fixed footer)
    // ONLY to the cleaning pane — ordering keeps its original layout
    // with the bottom-nav visible.
    document.body.classList.remove('is-pane-cleaning', 'is-pane-ordering');
    document.body.classList.add('is-pane-' + name);

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
    // Wire the Training launcher button — separate from the (now-absent)
    // duties tab strip. The launcher lives at the top of the cleanView
    // and navigates the whole app to the dedicated Training view.
    const trainBtn = document.getElementById('dutiesTrainLauncher');
    if (trainBtn && !trainBtn.dataset.wired) {
      trainBtn.dataset.wired = '1';
      trainBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.NX && typeof NX.switchTo === 'function') {
          // The dedicated Education/Training view is registered as
          // 'education' in app.js's moduleMap, NOT 'train'. Sending
          // 'train' was the bug that made tapping the launcher do
          // nothing (or apparently leave you on cleaning).
          NX.switchTo('education');
        } else {
          // Fallback for older builds — synthesize a tab click
          const tab = document.querySelector('[data-view="education"]');
          if (tab) tab.click();
        }
      });
      // Refresh the subtitle once on wiring (no-op if nothing to count)
      refreshTrainingLauncherSubtitle();
    }

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
   * Update the Training launcher's subtitle with the current user's
   * pending count. Best-effort — silently skips if Supabase or user
   * context isn't ready, or if training tables don't exist yet.
   * Cached for 60s so re-entering the duties view doesn't hammer the DB.
   */
  let lastSubRefreshAt = 0;
  let lastSubText      = null;
  async function refreshTrainingLauncherSubtitle(force) {
    const sub = document.getElementById('dutiesTrainLauncherSub');
    const badge = document.getElementById('navTrainBadge');
    // The badge can exist even when the launcher (sub) doesn't (different
    // views). Bail only if NEITHER target is in the DOM.
    if (!sub && !badge) return;
    if (!force && lastSubText && (Date.now() - lastSubRefreshAt) < 60000) {
      if (sub) sub.textContent = lastSubText;
      return;
    }
    try {
      const sb = window.NX && NX.sb;
      const userId = window.NX && NX.currentUser && NX.currentUser.id;
      if (!sb || !userId) return;

      // Count mandatory modules
      const { data: mods, error: modErr } = await sb
        .from('training_modules')
        .select('id, renewal_type, mandatory, archived')
        .eq('archived', false)
        .eq('mandatory', true);
      if (modErr) return;
      const moduleIds = (mods || []).map(m => m.id);
      if (!moduleIds.length) {
        lastSubText = 'No modules yet — open to set up';
        if (sub) sub.textContent = lastSubText;
        lastSubRefreshAt = Date.now();
        return;
      }

      // Get user's most-recent completion per module
      const { data: comps, error: compErr } = await sb
        .from('training_completions')
        .select('module_id, expires_at, completed_at')
        .eq('user_id', userId)
        .order('completed_at', { ascending: false });
      if (compErr) return;

      // Bucket: pending (none done), expiring (≤30d), expired (past)
      const latestByMod = {};
      (comps || []).forEach(c => {
        if (!latestByMod[c.module_id]) latestByMod[c.module_id] = c;
      });
      let pending = 0, expiring = 0, expired = 0;
      const now = Date.now();
      mods.forEach(m => {
        const c = latestByMod[m.id];
        if (!c) { pending++; return; }
        if (c.expires_at) {
          const days = (new Date(c.expires_at) - now) / 86400000;
          if (days < 0)  expired++;
          else if (days <= 30) expiring++;
        }
      });
      const gap = pending + expiring + expired;
      let text;
      if (gap === 0) {
        text = 'All caught up ✓';
      } else {
        const bits = [];
        if (expired)  bits.push(`${expired} expired`);
        if (expiring) bits.push(`${expiring} expiring`);
        if (pending)  bits.push(`${pending} pending`);
        text = bits.join(' · ');
      }
      lastSubText = text;
      if (sub) sub.textContent = text;
      lastSubRefreshAt = Date.now();
      // Visual urgency cue on the launcher itself
      const btn = document.getElementById('dutiesTrainLauncher');
      if (btn) {
        btn.classList.toggle('has-gaps',     expired > 0 || expiring > 0);
        btn.classList.toggle('has-pending',  pending > 0 && expired === 0 && expiring === 0);
      }
      // Bottom-nav training tab badge — same gap data, shown as a dot
      // on the nav tab itself so users see pending training even when
      // they're not on the Duties view.
      const badge = document.getElementById('navTrainBadge');
      if (badge) {
        const total = pending + expiring + expired;
        if (total > 0) {
          badge.removeAttribute('hidden');
          badge.textContent = total > 9 ? '9+' : String(total);
          badge.classList.toggle('is-urgent', expired > 0 || expiring > 0);
        } else {
          badge.setAttribute('hidden', '');
          badge.textContent = '';
        }
      }
    } catch (e) {
      // Tables may not exist yet — silent
    }
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
    refreshTrainingLauncherSubtitle();
    if (activePane === 'ordering' && NX.modules.ordering && NX.modules.ordering.show) {
      try { NX.modules.ordering.show(); }
      catch (e) { console.error('[duties] ordering refresh failed:', e); }
    }
    // Cleaning sub-module's own show() is invoked separately by app.js
    // (since cleaning.js is the primary module under 'clean' view).
  }

  NX.modules.duties = { init, show, activatePane, refreshTrainingStatus: refreshTrainingLauncherSubtitle };
  console.log('[duties] loaded');
})();
