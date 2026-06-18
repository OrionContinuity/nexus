/* ═══════════════════════════════════════════════════════════════════════
   notifications-bell.js — top-right bell = the single "needs doing" center
   ───────────────────────────────────────────────────────────────────────
   Replaces the scattered red badges (#ticketBadge on Settings, #notifyCount
   on the NEXUS wordmark) with one bell in the masthead. The bell:
     • counts the live pending-work alerts and shows them on the badge
     • opens a themed panel listing exactly what needs doing, each row
       tapping through to the right view (Work Orders / Board / PM)
     • keeps push on/off as a quiet footer control

   Pending sources (same tables/filters the app already trusts):
     • tickets   status=open & priority in (urgent,high,critical)  -> Work Orders
     • kanban_cards  archived=false & due_date < today             -> Board
     • pm_logs   review_status=pending & not deleted               -> PM

   Refreshes on open, when you return to the app (visibilitychange), and
   after you act — no polling, battery-safe. Remove this one file + the
   #navBell markup to revert.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function today() { return new Date().toISOString().slice(0, 10); }
  function NXref() { return (typeof NX !== 'undefined' && NX) ? NX : (window.NX || null); }

  function injectStyles() {
    if (document.getElementById('nx-bell-style')) return;
    var st = document.createElement('style');
    st.id = 'nx-bell-style';
    st.textContent =
      /* the bell replaces the old red indicators */
      '#ticketBadge,#notifyCount{display:none !important}' +
      '.nav-bell{position:relative;flex-shrink:0;background:transparent;border:none;cursor:pointer;padding:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--nx-faint,#7c89a0);transition:color .2s,transform .1s}' +
      '.nav-bell:hover{color:var(--nx-gold,#d4a44e)}' +
      '.nav-bell:active{transform:scale(.9)}' +
      '.nav-bell .nav-icon{width:22px;height:22px}' +
      '.nav-bell-count{position:absolute;top:-1px;right:-1px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--nx-red,#d24b4b);color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center;box-shadow:0 0 0 2px var(--nx-bg,#0e1320)}' +
      '.nx-notif-bg{position:fixed;inset:0;z-index:10001;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.5);opacity:0;transition:opacity .18s ease}' +
      '.nx-notif-bg.open{opacity:1}' +
      '.nx-notif{width:100%;max-width:480px;background:var(--nx-surface-solid,#161d2e);border:1px solid var(--nx-gold-line,rgba(212,164,78,.24));border-bottom:none;border-radius:22px 22px 0 0;padding:20px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.35);transform:translateY(18px);transition:transform .2s cubic-bezier(.4,0,.2,1);max-height:80vh;overflow-y:auto}' +
      '.nx-notif-bg.open .nx-notif{transform:translateY(0)}' +
      '.nx-notif-grip{width:36px;height:4px;border-radius:999px;background:var(--nx-border-strong,rgba(255,255,255,.15));margin:0 auto 16px}' +
      '.nx-notif-head{display:flex;align-items:center;gap:10px;margin:0 2px 16px}' +
      '.nx-notif-head h3{font-family:var(--nx-font-display,"Outfit",sans-serif);font-weight:700;font-size:19px;color:var(--nx-text-strong,#f6f0e2);margin:0}' +
      '.nx-notif-bell-ico{color:var(--nx-gold,#d4a44e);display:inline-flex}' +
      '.nx-notif-list{display:flex;flex-direction:column;gap:10px}' +
      '.nx-notif-item{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;padding:15px 14px;border-radius:16px;background:var(--nx-elevated,#1f2940);border:1px solid var(--nx-border,rgba(212,164,78,.16));border-left:3px solid var(--nx-gold,#d4a44e);color:var(--nx-text,#ece4d4);font-family:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:transform .1s}' +
      '.nx-notif-item:active{transform:scale(.99)}' +
      '.nx-notif-item.danger{border-left-color:var(--nx-red,#d24b4b)}' +
      '.nx-notif-item.warn{border-left-color:var(--nx-gold,#d4a44e)}' +
      '.nx-notif-item-txt{flex:1;line-height:1.35}' +
      '.nx-notif-item-go{color:var(--nx-faint,#7c89a0);font-size:20px;font-weight:400;flex-shrink:0}' +
      '.nx-notif-empty{display:flex;align-items:center;gap:10px;padding:18px 14px;border-radius:16px;background:var(--nx-elevated,#1f2940);border:1px solid var(--nx-border,rgba(212,164,78,.16));color:var(--nx-green,#3fa08f);font-size:15px;font-weight:600}' +
      '.nx-notif-foot{margin-top:18px;padding-top:14px;border-top:1px solid var(--nx-border,rgba(212,164,78,.14));display:flex;align-items:center;justify-content:space-between;gap:12px}' +
      '.nx-notif-foot-label{font-size:13.5px;color:var(--nx-muted,#9aa3b2)}' +
      '.nx-notif-foot-label b{color:var(--nx-text,#ece4d4);font-weight:700}' +
      '.nx-notif-toggle{padding:9px 16px;border-radius:999px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--nx-gold,#d4a44e);background:var(--nx-gold-faint,rgba(212,164,78,.08));color:var(--nx-gold,#d4a44e);white-space:nowrap}' +
      '.nx-notif-toggle.off{border-color:var(--nx-border-strong,rgba(255,255,255,.18));background:transparent;color:var(--nx-text,#ece4d4)}' +
      '.nx-notif-toggle:disabled{opacity:.5;cursor:default}' +
      '@media (prefers-reduced-motion:reduce){.nx-notif-bg,.nx-notif,.nav-bell,.nx-notif-item{transition:none}}';
    document.head.appendChild(st);
  }

  // ── Pending-work data ───────────────────────────────────────────────────
  async function loadPending() {
    var T = NXref();
    if (!T || !T.sb) return null;          // not ready
    var sb = T.sb, t = today();
    async function cnt(fn) {
      try { var r = await fn(); return (r && typeof r.count === 'number') ? r.count : 0; }
      catch (e) { if (T.debug) T.debug('bell.count', e); return 0; }
    }
    var urgent = await cnt(function () {
      return sb.from('tickets').select('*', { count: 'exact', head: true })
        .eq('status', 'open').in('priority', ['urgent', 'high', 'critical']);
    });
    var overdue = await cnt(function () {
      return sb.from('kanban_cards').select('*', { count: 'exact', head: true })
        .eq('archived', false).lt('due_date', t).not('due_date', 'is', null);
    });
    var pmPend = await cnt(function () {
      return sb.from('pm_logs').select('*', { count: 'exact', head: true })
        .eq('review_status', 'pending').eq('is_deleted', false);
    });
    var down = await cnt(function () {
      return sb.from('equipment').select('*', { count: 'exact', head: true }).eq('status', 'down');
    });
    var quotes = await cnt(function () {
      return sb.from('equipment_issues').select('*', { count: 'exact', head: true }).eq('awaiting_quote_approval', true);
    });
    var unpaid = await cnt(function () {
      return sb.from('equipment_issues').select('*', { count: 'exact', head: true }).eq('awaiting_invoice_payment', true);
    });
    var rows = [];
    if (urgent > 0)  rows.push({ label: urgent + ' urgent work order' + (urgent > 1 ? 's' : '') + ' open', view: 'issues', cls: 'danger' });
    if (down > 0)    rows.push({ label: down + ' unit' + (down > 1 ? 's' : '') + ' down', view: 'equipment', cls: 'danger' });
    if (overdue > 0) rows.push({ label: overdue + ' card' + (overdue > 1 ? 's' : '') + ' overdue', view: 'board', cls: overdue >= 50 ? 'danger' : 'warn' });
    if (pmPend > 0)  rows.push({ label: pmPend + ' PM log' + (pmPend > 1 ? 's' : '') + ' pending review', view: 'pm', cls: 'warn' });
    if (quotes > 0)  rows.push({ label: quotes + ' quote' + (quotes > 1 ? 's' : '') + ' awaiting approval', view: 'issues', cls: 'warn' });
    if (unpaid > 0)  rows.push({ label: unpaid + ' invoice' + (unpaid > 1 ? 's' : '') + ' unpaid', view: 'issues', cls: 'warn' });
    return rows;
  }

  var _rows = [];
  function setBadge(n) {
    var b = document.getElementById('navBellCount');
    if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
    else b.hidden = true;
  }
  async function refresh() {
    var rows = await loadPending();
    if (rows === null) return false;       // sb not ready; caller may retry
    _rows = rows;
    setBadge(_rows.length);
    return true;
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  var BELL_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  function close(bg) { bg.classList.remove('open'); setTimeout(function () { bg.remove(); }, 200); refresh(); }

  function listHtml() {
    if (!_rows.length) return '<div class="nx-notif-empty"><span>\u2713</span><span>You\u2019re all caught up.</span></div>';
    return '<div class="nx-notif-list">' + _rows.map(function (r) {
      return '<button class="nx-notif-item ' + r.cls + '" data-view="' + r.view + '">' +
        '<span class="nx-notif-item-txt">' + r.label + '</span>' +
        '<span class="nx-notif-item-go">\u203a</span></button>';
    }).join('') + '</div>';
  }

  async function renderPushFoot(footEl) {
    var T = NXref();
    if (!T || typeof T.getPushStatus !== 'function') { footEl.innerHTML = ''; return; }
    var s; try { s = await T.getPushStatus(); } catch (_) { s = {}; }
    s = s || {};
    if (s.supported === false) { footEl.innerHTML = '<span class="nx-notif-foot-label">Push not supported on this device</span>'; return; }
    var on = s.subscribed && s.permission === 'granted';
    var blocked = s.permission === 'denied';
    footEl.innerHTML =
      '<span class="nx-notif-foot-label">Push alerts <b>' + (blocked ? 'Blocked' : on ? 'On' : 'Off') + '</b></span>' +
      (blocked ? '' : '<button class="nx-notif-toggle ' + (on ? '' : 'off') + '" data-push="' + (on ? 'off' : 'on') + '">' + (on ? 'Turn off' : 'Turn on') + '</button>');
    var btn = footEl.querySelector('[data-push]');
    if (btn) btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        if (btn.getAttribute('data-push') === 'on') {
          var r = await T.ensurePush({ force: true });
          if (r && (r.ok || r.already)) T.toast && T.toast('Push alerts on \u2713', 'success');
          else if (r && r.reason === 'permission_denied') T.toast && T.toast('Blocked in browser settings', 'error');
        } else { await T.disablePush(); }
      } catch (_) {}
      renderPushFoot(footEl);
    });
  }

  function openPanel() {
    injectStyles();
    document.querySelectorAll('.nx-notif-bg').forEach(function (n) { n.remove(); });
    var bg = document.createElement('div');
    bg.className = 'nx-notif-bg';
    bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', 'Notifications');
    bg.innerHTML =
      '<div class="nx-notif">' +
        '<div class="nx-notif-grip"></div>' +
        '<div class="nx-notif-head"><span class="nx-notif-bell-ico">' + BELL_SVG + '</span><h3>Needs doing</h3></div>' +
        '<div class="nx-notif-body">' + listHtml() + '</div>' +
        '<div class="nx-notif-foot" id="nxNotifFoot"></div>' +
      '</div>';
    bg.addEventListener('click', function (e) { if (e.target === bg) close(bg); });
    function onKey(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey, true); close(bg); } }
    document.addEventListener('keydown', onKey, true);

    bg.querySelectorAll('.nx-notif-item').forEach(function (it) {
      it.addEventListener('click', function () {
        var v = it.getAttribute('data-view');
        var T = NXref();
        document.removeEventListener('keydown', onKey, true);
        close(bg);
        if (T && typeof T.switchTo === 'function') T.switchTo(v);
      });
    });

    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('open'); });
    renderPushFoot(bg.querySelector('#nxNotifFoot'));

    // Refresh in the background; if the list changed, re-render it live.
    refresh().then(function (ok) {
      if (!ok) return;
      var body = bg.querySelector('.nx-notif-body');
      if (body) {
        body.innerHTML = listHtml();
        bg.querySelectorAll('.nx-notif-item').forEach(function (it) {
          it.addEventListener('click', function () {
            var v = it.getAttribute('data-view'); var T = NXref();
            document.removeEventListener('keydown', onKey, true);
            close(bg);
            if (T && typeof T.switchTo === 'function') T.switchTo(v);
          });
        });
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    var bell = document.getElementById('navBell');
    if (bell && !bell.__nxBound) {
      bell.__nxBound = true;
      bell.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openPanel(); });
    }
    // First load, retrying briefly until NX.sb is ready (no infinite polling).
    var tries = 0;
    (function attempt() {
      refresh().then(function (ok) {
        if (!ok && tries < 6) { tries++; setTimeout(attempt, 1500 * tries); }
      });
    })();
    // Refresh when the user returns to the app — event-driven, not polling.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
