/* ═══════════════════════════════════════════════════════════════════════
   email-composer.js — NX.composeEmail
   ───────────────────────────────────────────────────────────────────────
   A themed email composer that mirrors the ordering flow: an editable TO
   address, CC and BCC managed as add/remove chips, an editable subject and
   body, then Send — which opens the mail draft via the shared
   NX.email.buildMailtoUrl (To + CC + BCC), exactly like openVendorEmail.

   Recipients persist per `recipientsKey` (e.g. "dlog:Suerte"), so each
   restaurant remembers its addresses between sends.

       NX.composeEmail({
         recipientsKey: 'dlog:Suerte',
         to: 'suerte@...',        // optional seed; saved value wins if present
         cc: ['gm@...'],          // optional seed
         subject: 'Daily Log — Suerte — ...',
         body: '...editable recap...'
       });

   Self-contained (own injected styles, Venice tokens). Remove this one file
   + its <script> tag to revert.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var T = (typeof NX !== 'undefined' && NX) ? NX : (window.NX = window.NX || {});
  if (T.composeEmail) return;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function validEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim()); }

  function recall(key) {
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem('nx_recip_' + key) || 'null'); } catch (_) { return null; }
  }
  function store(key, data) {
    if (!key) return;
    try { localStorage.setItem('nx_recip_' + key, JSON.stringify(data)); } catch (e) { if (T.debug) T.debug('composer.store', e); }
  }

  function buildMailto(to, subject, body, cc, bcc) {
    if (T.email && T.email.buildMailtoUrl) return T.email.buildMailtoUrl(to, subject || '', body || '', cc || [], bcc || []);
    var p = [];
    if (cc && cc.length)  p.push('cc=' + encodeURIComponent(cc.join(',')));
    if (bcc && bcc.length) p.push('bcc=' + encodeURIComponent(bcc.join(',')));
    p.push('subject=' + encodeURIComponent(subject || ''));
    // `+` → %20 so spaces survive in mail clients that read '+' literally
    // (the old `.replace(/%20/g,'%20')` was a no-op). Matches nx-email.js.
    p.push('body=' + encodeURIComponent(body || '').replace(/\+/g, '%20'));
    return 'mailto:' + encodeURIComponent(to || '') + '?' + p.join('&');
  }

  function injectStyles() {
    if (document.getElementById('nx-compose-style')) return;
    var st = document.createElement('style');
    st.id = 'nx-compose-style';
    st.textContent =
      '.nx-cmp-bg{position:fixed;inset:0;z-index:10002;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);opacity:0;transition:opacity .18s ease}' +
      '.nx-cmp-bg.open{opacity:1}' +
      '.nx-cmp{width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;background:var(--nx-surface-solid,#161d2e);border:1px solid var(--nx-gold-line,rgba(212,164,78,.24));border-bottom:none;border-radius:22px 22px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.4);transform:translateY(20px);transition:transform .2s cubic-bezier(.4,0,.2,1)}' +
      '.nx-cmp-bg.open .nx-cmp{transform:translateY(0)}' +
      '.nx-cmp-grip{width:36px;height:4px;border-radius:999px;background:var(--nx-border-strong,rgba(255,255,255,.15));margin:14px auto 6px}' +
      '.nx-cmp-head{display:flex;align-items:center;justify-content:space-between;padding:6px 18px 12px;border-bottom:1px solid var(--nx-border,rgba(212,164,78,.14))}' +
      '.nx-cmp-head h3{font-family:var(--nx-font-display,"Outfit",sans-serif);font-weight:700;font-size:18px;color:var(--nx-text-strong,#f6f0e2);margin:0}' +
      '.nx-cmp-body{overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px}' +
      '.nx-cmp-field{display:flex;flex-direction:column;gap:6px}' +
      '.nx-cmp-pill{display:inline-flex;align-items:center;justify-content:center;min-width:34px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:.05em}' +
      '.nx-cmp-pill-to{background:var(--nx-gold-faint,rgba(212,164,78,.14));color:var(--nx-gold,#d4a44e)}' +
      '.nx-cmp-pill-cc{background:rgba(63,120,181,.16);color:var(--nx-blue,#3f78b5)}' +
      '.nx-cmp-pill-bcc{background:rgba(154,163,178,.16);color:var(--nx-muted,#9aa3b2)}' +
      '.nx-cmp-label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--nx-muted,#9aa3b2)}' +
      '.nx-cmp-input,.nx-cmp-textarea{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:14px;border:1px solid var(--nx-border,rgba(212,164,78,.16));background:var(--nx-bg,#0e1320);color:var(--nx-text,#ece4d4);font-family:inherit;font-size:16px}' +
      '.nx-cmp-input:focus,.nx-cmp-textarea:focus{outline:none;border-color:var(--nx-gold,#d4a44e)}' +
      '.nx-cmp-textarea{min-height:200px;resize:vertical;line-height:1.5;font-size:14px}' +
      '.nx-cmp-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
      '.nx-cmp-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:var(--nx-elevated,#1f2940);border:1px solid var(--nx-border,rgba(212,164,78,.16));color:var(--nx-text,#ece4d4);font-size:13px}' +
      '.nx-cmp-chip-x{border:none;background:transparent;color:var(--nx-faint,#7c89a0);cursor:pointer;font-size:16px;line-height:1;padding:0 2px}' +
      '.nx-cmp-chip-x:hover{color:var(--nx-red,#d24b4b)}' +
      '.nx-cmp-chip-add{display:inline-flex;align-items:center;gap:4px;padding:7px 12px;border-radius:999px;border:1px dashed var(--nx-border-strong,rgba(255,255,255,.2));background:transparent;color:var(--nx-muted,#9aa3b2);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
      '.nx-cmp-chip-add:hover{color:var(--nx-gold,#d4a44e);border-color:var(--nx-gold-line)}' +
      '.nx-cmp-addrow{display:flex;gap:8px;margin-top:8px}' +
      '.nx-cmp-addrow input{flex:1}' +
      '.nx-cmp-addrow button{padding:0 16px;border-radius:12px;border:1px solid var(--nx-gold,#d4a44e);background:var(--nx-gold-faint,rgba(212,164,78,.1));color:var(--nx-gold,#d4a44e);font-weight:700;cursor:pointer}' +
      '.nx-cmp-foot{display:flex;gap:10px;padding:12px 18px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--nx-border,rgba(212,164,78,.14))}' +
      '.nx-cmp-btn{flex:1;padding:14px;border-radius:14px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;border:1px solid var(--nx-border-strong,rgba(255,255,255,.18));background:transparent;color:var(--nx-text,#ece4d4)}' +
      '.nx-cmp-btn-send{border-color:var(--nx-gold,#d4a44e);background:var(--nx-gold-faint,rgba(212,164,78,.1));color:var(--nx-gold,#d4a44e)}' +
      '.nx-cmp-btn-send:disabled{opacity:.5;cursor:default}' +
      '@media (prefers-reduced-motion:reduce){.nx-cmp-bg,.nx-cmp{transition:none}}';
    document.head.appendChild(st);
  }

  T.composeEmail = function (opts) {
    opts = opts || {};
    injectStyles();

    var key = opts.recipientsKey || '';
    var saved = recall(key) || {};
    var state = {
      to: (opts.to || saved.to || ''),
      cc: (opts.cc && opts.cc.length ? opts.cc.slice() : (saved.cc || []).slice()),
      bcc: (opts.bcc && opts.bcc.length ? opts.bcc.slice() : (saved.bcc || []).slice()),
    };
    var subject = opts.subject || '';
    var body = opts.body || '';

    document.querySelectorAll('.nx-cmp-bg').forEach(function (n) { n.remove(); });
    var bg = document.createElement('div');
    bg.className = 'nx-cmp-bg';
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');
    bg.setAttribute('aria-label', 'Compose email');

    function chipGroup(kind) {
      var list = state[kind] || [];
      var pillClass = kind === 'cc' ? 'nx-cmp-pill-cc' : 'nx-cmp-pill-bcc';
      var label = kind.toUpperCase();
      var chips = list.map(function (e, i) {
        return '<span class="nx-cmp-chip" data-kind="' + kind + '" data-i="' + i + '"><span>' + escHtml(e) + '</span>' +
          '<button type="button" class="nx-cmp-chip-x" data-rm="' + kind + ':' + i + '" aria-label="Remove ' + escHtml(e) + '">×</button></span>';
      }).join('');
      return '<div class="nx-cmp-field">' +
        '<div class="nx-cmp-label"><span class="nx-cmp-pill ' + pillClass + '">' + label + '</span>' +
        (kind === 'bcc' ? '<span>silent copies</span>' : '<span>copied on this report</span>') + '</div>' +
        '<div class="nx-cmp-chips" data-chips="' + kind + '">' + chips + '</div>' +
        '<div class="nx-cmp-addrow"><input type="email" class="nx-cmp-input" data-add-input="' + kind + '" placeholder="add ' + label + ' address" inputmode="email" autocomplete="off">' +
        '<button type="button" data-add-btn="' + kind + '">Add</button></div>' +
        '</div>';
    }

    bg.innerHTML =
      '<div class="nx-cmp">' +
        '<div class="nx-cmp-grip"></div>' +
        '<div class="nx-cmp-head"><h3>' + escHtml(opts.title || 'Compose email') + '</h3></div>' +
        '<div class="nx-cmp-body">' +
          '<div class="nx-cmp-field">' +
            '<div class="nx-cmp-label"><span class="nx-cmp-pill nx-cmp-pill-to">TO</span><span>primary recipient</span></div>' +
            '<input type="email" class="nx-cmp-input" data-to value="' + escHtml(state.to) + '" placeholder="manager@restaurant.com" inputmode="email" autocomplete="off">' +
          '</div>' +
          chipGroup('cc') +
          chipGroup('bcc') +
          '<div class="nx-cmp-field">' +
            '<div class="nx-cmp-label"><span>Subject</span></div>' +
            '<input type="text" class="nx-cmp-input" data-subject value="' + escHtml(subject) + '">' +
          '</div>' +
          '<div class="nx-cmp-field">' +
            '<div class="nx-cmp-label"><span>Message</span></div>' +
            '<textarea class="nx-cmp-textarea" data-body>' + escHtml(body) + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="nx-cmp-foot">' +
          '<button type="button" class="nx-cmp-btn" data-cancel>Cancel</button>' +
          '<button type="button" class="nx-cmp-btn nx-cmp-btn-send" data-send>Send</button>' +
        '</div>' +
      '</div>';

    function close() {
      bg.classList.remove('open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(function () { bg.remove(); }, 200);
    }
    function onKey(e) { if (e.key === 'Escape') { close(); } }

    function rerenderChips(kind) {
      var wrap = bg.querySelector('[data-chips="' + kind + '"]');
      if (!wrap) return;
      wrap.innerHTML = (state[kind] || []).map(function (em, i) {
        return '<span class="nx-cmp-chip"><span>' + escHtml(em) + '</span>' +
          '<button type="button" class="nx-cmp-chip-x" data-rm="' + kind + ':' + i + '" aria-label="Remove ' + escHtml(em) + '">×</button></span>';
      }).join('');
      wireRemoves();
    }
    function wireRemoves() {
      bg.querySelectorAll('[data-rm]').forEach(function (b) {
        b.onclick = function () {
          var parts = b.getAttribute('data-rm').split(':');
          var kind = parts[0], i = parseInt(parts[1], 10);
          if (state[kind]) { state[kind].splice(i, 1); rerenderChips(kind); }
        };
      });
    }
    function addFrom(kind) {
      var input = bg.querySelector('[data-add-input="' + kind + '"]');
      if (!input) return;
      var v = (input.value || '').trim();
      if (!validEmail(v)) { input.focus(); input.style.borderColor = 'var(--nx-red,#d24b4b)'; return; }
      if ((state[kind] || []).indexOf(v) === -1) state[kind].push(v);
      input.value = '';
      input.style.borderColor = '';
      rerenderChips(kind);
      input.focus();
    }

    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-cancel]').addEventListener('click', close);
    ['cc', 'bcc'].forEach(function (kind) {
      bg.querySelector('[data-add-btn="' + kind + '"]').addEventListener('click', function () { addFrom(kind); });
      bg.querySelector('[data-add-input="' + kind + '"]').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addFrom(kind); }
      });
    });
    wireRemoves();

    bg.querySelector('[data-send]').addEventListener('click', function () {
      var to = (bg.querySelector('[data-to]').value || '').trim();
      var subj = (bg.querySelector('[data-subject]').value || '').trim();
      var bod = bg.querySelector('[data-body]').value || '';
      if (!to || !validEmail(to)) {
        var toEl = bg.querySelector('[data-to]');
        toEl.focus(); toEl.style.borderColor = 'var(--nx-red,#d24b4b)';
        if (T.toast) T.toast('Add a valid recipient', 'error');
        return;
      }
      state.to = to;
      if (key) store(key, { to: state.to, cc: state.cc, bcc: state.bcc });
      try { window.location.href = buildMailto(to, subj, bod, state.cc, state.bcc); } catch (e) { if (T.debug) T.debug('composer.send', e); }
      close();
      if (typeof opts.onSend === 'function') { try { opts.onSend({ to: to, cc: state.cc, bcc: state.bcc, subject: subj, body: bod }); } catch (_) {} }
    });

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('open'); });
  };
})();
