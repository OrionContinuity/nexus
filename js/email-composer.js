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
  // Supabase-backed recipients (they rarely change → keep them server-side so
  // they survive a device wipe and sync across machines). Table:
  //   email_recipients(recipient_key text primary key, data jsonb, updated_at)
  // Degrades gracefully to localStorage-only if the table/connection is absent.
  function loadRemote(key) {
    if (!key || !(T && T.sb)) return Promise.resolve(null);
    return T.sb.from('email_recipients').select('data').eq('recipient_key', key).maybeSingle()
      .then(function (r) { return (r && !r.error && r.data) ? r.data.data : null; })
      .catch(function () { return null; });
  }
  function saveRemote(key, data) {
    if (!key || !(T && T.sb)) return Promise.resolve(false);
    return T.sb.from('email_recipients')
      .upsert({ recipient_key: key, data: data, updated_at: new Date().toISOString() }, { onConflict: 'recipient_key' })
      .then(function (r) { return !(r && r.error); })
      .catch(function () { return false; });
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

  // Send via the shared engine (nx-email.js → NX.email.openDraft): desktop →
  // Gmail web composer (mailto: drops long bodies / when no mail client is
  // registered — "email unable to be made"); mobile → native mailto. Falls
  // back to a local anchor-click mailto only if the engine isn't loaded.
  function sendDraft(to, subject, body, cc, bcc) {
    // The shared engine lives on window.NX.email — NOT the lexical `NX`
    // (app.js's const) that `T` resolves to, which is a different object.
    var E = (window.NX && window.NX.email) || T.email;
    if (E && E.openDraft) { E.openDraft(to, subject, body, cc || [], bcc || []); return; }
    var a = document.createElement('a');
    a.href = buildMailto(to, subject, body, cc, bcc); a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }

  // ── Styled (HTML) sending via the Gmail API ──────────────────────────
  // When composeEmail gets opts.htmlRender, the SAME Send button sends a
  // real multipart email (the typed plain text + its styled HTML render)
  // through gmail.googleapis.com, using the Google login the app already
  // holds for Drive uploads (one extra consent for gmail.send on first
  // use). Any failure falls back to the classic plain draft — the send
  // path is never worse than the original.
  function b64url(str) {
    var utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function mimeHeader(s) {
    return /[^\x20-\x7E]/.test(String(s || ''))
      ? '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?='
      : String(s || '');
  }
  var GMAIL_SEND_SCOPE = ['https://www.googleapis.com/auth/gmail.send'];
  var STYLED_ENGINE_BUILD = 'v200';   // shown in the status strip — ends "which file am I running" forever

  // ── SELF-CONTAINED token machinery ─────────────────────────────────
  // Styled send must not depend on ANY other file being fresh (zombie
  // caches served a stale nx-drive for days — same reason work-orders.js
  // carries its own completion cascade). Prefers NX.drive.ensureDriveToken
  // when present (keeps its scope-union logic); otherwise does the same
  // dance itself against the same localStorage token slots.
  function resolveDrive() {
    return (T && T.drive) || (window.NX && window.NX.drive) || null;
  }
  function gmailClientId() {
    var lex = null; try { lex = NX; } catch (_) {}
    try {
      return (lex && lex.getGoogleClientId && lex.getGoogleClientId())
        || (window.NX && window.NX.getGoogleClientId && window.NX.getGoogleClientId())
        || localStorage.getItem('nexus_google_client_id')
        || (lex && lex.GOOGLE_CLIENT_ID)
        || null;
    } catch (_) { return null; }
  }
  function gmailStoredToken() {
    try {
      var t = localStorage.getItem('nexus_drive_token');
      var exp = parseInt(localStorage.getItem('nexus_drive_expiry') || '0', 10);
      var sc = (localStorage.getItem('nexus_drive_scopes') || '').split(/\s+/).filter(Boolean);
      if (!t || Date.now() > exp - 60000) return null;
      for (var i = 0; i < GMAIL_SEND_SCOPE.length; i++) if (sc.indexOf(GMAIL_SEND_SCOPE[i]) === -1) return null;
      return t;
    } catch (_) { return null; }
  }
  function gmailLoadGsi() {
    return new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) { resolve(); return; }
      var existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (!existing) {
        existing = document.createElement('script');
        existing.src = 'https://accounts.google.com/gsi/client';
        existing.async = true;
        document.head.appendChild(existing);
      }
      var start = Date.now();
      var poll = setInterval(function () {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) { clearInterval(poll); resolve(); }
        else if (Date.now() - start > 10000) { clearInterval(poll); reject(new Error('Google auth script load timed out')); }
      }, 100);
    });
  }
  function gmailGetToken() {
    var drive = resolveDrive();
    if (drive && drive.ensureDriveToken) {
      return Promise.resolve(drive.ensureDriveToken({ scopes: GMAIL_SEND_SCOPE }));
    }
    var cached = gmailStoredToken();
    if (cached) return Promise.resolve(cached);
    var clientId = gmailClientId();
    if (!clientId) return Promise.reject(new Error('No Google Client ID on this device — connect Drive in Settings once'));
    return gmailLoadGsi().then(function () {
      return new Promise(function (resolve, reject) {
        // Request the UNION of gmail.send + previously granted scopes so the
        // Drive upload permissions survive this re-auth.
        var prev = (localStorage.getItem('nexus_drive_scopes') || '').split(/\s+/).filter(Boolean);
        var union = GMAIL_SEND_SCOPE.slice();
        prev.forEach(function (s) { if (union.indexOf(s) === -1) union.push(s); });
        var tc = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: union.join(' '),
          callback: function (r) {
            if (r && r.access_token) {
              try {
                localStorage.setItem('nexus_drive_token', r.access_token);
                localStorage.setItem('nexus_drive_expiry', String(Date.now() + 55 * 60 * 1000));
                localStorage.setItem('nexus_drive_scopes', r.scope || union.join(' '));
              } catch (_) {}
              resolve(r.access_token);
            } else reject(new Error('Authorization was denied or the popup was closed'));
          },
          error_callback: function (e) {
            reject(new Error('Google OAuth error: ' + ((e && (e.message || e.type)) || 'popup blocked or closed')));
          },
        });
        tc.requestAccessToken();
      });
    });
  }

  // Resolves {ok:true} or {ok:false, err:'human-readable reason'} — the
  // reason is SHOWN to the user on fallback (a silent false left everyone
  // guessing why "the old text email appeared").
  function sendGmailHtml(to, cc, bcc, subject, textBody, htmlBody) {
    if (!window.fetch) return Promise.resolve({ ok: false, err: 'no fetch in this browser' });
    return gmailGetToken()
      .then(function (token) {
        if (!token) return { ok: false, err: 'Google did not return a token' };
        var bnd = 'nx' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        var lines = [
          'To: ' + to,
          (cc && cc.length) ? 'Cc: ' + cc.join(', ') : null,
          (bcc && bcc.length) ? 'Bcc: ' + bcc.join(', ') : null,
          'Subject: ' + mimeHeader(subject),
          'MIME-Version: 1.0',
          'Content-Type: multipart/alternative; boundary="' + bnd + '"',
          '',
          '--' + bnd,
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          textBody || '',
          '',
          '--' + bnd,
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          htmlBody || '',
          '',
          '--' + bnd + '--',
        ].filter(function (l) { return l !== null; });
        return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: b64url(lines.join('\r\n')) }),
        }).then(function (res) {
          if (res && res.ok) return { ok: true };
          return res.text().then(function (t) {
            var msg = 'Gmail API ' + (res ? res.status : '?');
            try { var j = JSON.parse(t); if (j && j.error && j.error.message) msg += ': ' + j.error.message; } catch (_) {}
            return { ok: false, err: msg };
          }).catch(function () { return { ok: false, err: 'Gmail API ' + (res ? res.status : 'error') }; });
        });
      })
      .catch(function (e) {
        if (T.debug) T.debug('composer.gmailSend', e);
        return { ok: false, err: (e && e.message) ? e.message : 'unexpected error' };
      });
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
      '.nx-cmp-chip-new{animation:nxCmpChipIn .5s ease}' +
      '@keyframes nxCmpChipIn{0%{transform:scale(.7);background:var(--nx-gold,#d4a44e);color:var(--nx-gold-on,#101626)}60%{background:var(--nx-gold-soft,rgba(212,164,78,.4))}100%{transform:scale(1)}}' +
      '.nx-cmp-status{min-height:16px;padding:0 18px;font-size:12px;text-align:center;color:var(--nx-muted,#9aa3b2);transition:color .15s}' +
      '.nx-cmp-status.is-ok{color:var(--nx-green,#67c08c)}' +
      '.nx-cmp-status.is-warn{color:var(--nx-gold,#d4a44e)}' +
      '.nx-cmp-poweredby{text-align:center;font-family:var(--nx-font-mono,"JetBrains Mono",monospace);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--nx-faintest,#4e5666);padding:2px 0 calc(8px + env(safe-area-inset-bottom))}' +
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
    // opts.htmlRender(bodyText) → styled HTML of the CURRENT body text.
    // A function (not a static string) so edits made in the Message box
    // are re-rendered at send time — the styled email always matches the
    // text the user actually sent.
    var htmlRender = (typeof opts.htmlRender === 'function') ? opts.htmlRender : null;

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
        '<div class="nx-cmp-head"><h3>' + escHtml(opts.title || 'Compose email') + '</h3>' +
          (htmlRender ? '<button type="button" class="nx-cmp-btn" data-preview style="padding:6px 14px;font-size:12px">✨ Preview</button>' : '') +
        '</div>' +
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
        '<div class="nx-cmp-status" id="nxCmpStatus"></div>' +
        '<div class="nx-cmp-foot">' +
          '<button type="button" class="nx-cmp-btn" data-cancel>Cancel</button>' +
          '<button type="button" class="nx-cmp-btn nx-cmp-btn-send" data-send>Send</button>' +
        '</div>' +
        '<div class="nx-cmp-poweredby">powered by NEXUS</div>' +
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
          if (state[kind]) { state[kind].splice(i, 1); rerenderChips(kind); persistRecipients(); }
        };
      });
    }
    function addFrom(kind) {
      var input = bg.querySelector('[data-add-input="' + kind + '"]');
      if (!input) return;
      var v = (input.value || '').trim();
      if (!validEmail(v)) { input.focus(); input.style.borderColor = 'var(--nx-red,#d24b4b)'; return; }
      var dup = (state[kind] || []).indexOf(v) !== -1;
      if (!dup) state[kind].push(v);
      input.value = '';
      input.style.borderColor = '';
      rerenderChips(kind);
      // Immediate acknowledgement: flash the new chip + toast right away (the
      // inline status then updates to 'saved & synced' once Supabase confirms).
      var chips = bg.querySelectorAll('[data-chips="' + kind + '"] .nx-cmp-chip');
      var last = chips[chips.length - 1];
      if (last) { last.classList.add('nx-cmp-chip-new'); setTimeout(function () { if (last) last.classList.remove('nx-cmp-chip-new'); }, 1300); }
      if (T.toast) T.toast(dup ? (kind.toUpperCase() + ' already added') : (kind.toUpperCase() + ' added: ' + v), dup ? 'info' : 'success');
      input.focus();
      persistRecipients(kind, v);   // then persist + sync, updating the inline status
    }

    // Current To/CC/BCC snapshot (To pulled live from the field).
    function snapshot() {
      var toEl = bg.querySelector('[data-to]');
      return { to: toEl ? (toEl.value || '').trim() : state.to, cc: state.cc.slice(), bcc: state.bcc.slice() };
    }
    // Persist recipients locally + to Supabase; toast a confirmation when an
    // address was just added (addedKind/addedAddr provided).
    function setCmpStatus(msg, kind) {
      var el = bg.querySelector('#nxCmpStatus');
      if (el) { el.textContent = msg; el.className = 'nx-cmp-status' + (kind ? ' is-' + kind : ''); }
    }
    function persistRecipients(addedKind, addedAddr) {
      var snap = snapshot();
      var who = addedKind ? (addedKind.toUpperCase() + ' ' + (addedAddr || '') + ' ') : 'Recipients ';
      if (key) store(key, snap);  // instant local
      if (key && T && T.sb) {
        setCmpStatus(who + 'saving…', 'warn');
        saveRemote(key, snap).then(function (ok) {
          var msg = who + (ok ? 'saved & synced to NEXUS ✓' : 'saved on this device (run email_recipients.sql to sync)');
          setCmpStatus(msg, ok ? 'ok' : 'warn');
          if (T.toast && addedKind) T.toast(msg, ok ? 'success' : 'info');
        });
      } else if (addedKind) {
        // No recipientsKey → can't persist across emails, but still confirm.
        setCmpStatus(who + 'added (this email only)', 'warn');
        if (T.toast) T.toast(who + 'added', 'info');
      }
    }
    // On open, pull saved recipients from Supabase (they rarely change) and
    // fill any the caller didn't pass — so the CC list is always there.
    if (key && T && T.sb) {
      loadRemote(key).then(function (remote) {
        if (!remote) return;
        var changed = false;
        if (!(opts.cc && opts.cc.length) && Array.isArray(remote.cc) && remote.cc.length && !state.cc.length) { state.cc = remote.cc.slice(); changed = true; }
        if (!(opts.bcc && opts.bcc.length) && Array.isArray(remote.bcc) && remote.bcc.length && !state.bcc.length) { state.bcc = remote.bcc.slice(); changed = true; }
        if (!opts.to && remote.to) { var toEl = bg.querySelector('[data-to]'); if (toEl && !toEl.value) { toEl.value = remote.to; state.to = remote.to; changed = true; } }
        if (changed) { rerenderChips('cc'); rerenderChips('bcc'); }
      });
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
      persistRecipients();   // local + Supabase
      var finish = function () {
        close();
        if (typeof opts.onSend === 'function') { try { opts.onSend({ to: to, cc: state.cc, bcc: state.bcc, subject: subj, body: bod }); } catch (_) {} }
      };
      if (htmlRender) {
        // Styled path: send the real email (plain + HTML) via the Gmail API.
        // First use asks for the gmail.send permission once (same Google
        // account as the Drive upload). Any failure → classic plain draft.
        var sendBtn = bg.querySelector('[data-send]');
        sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
        var html = '';
        try { html = htmlRender(bod) || ''; } catch (e) { if (T.debug) T.debug('composer.htmlRender', e); }
        (html ? sendGmailHtml(to, state.cc, state.bcc, subj, bod, html) : Promise.resolve({ ok: false, err: 'styled render came back empty' }))
          .then(function (r) {
            if (r && r.ok) {
              if (T.toast) T.toast('Sent ✓ — styled email delivered', 'success', 3200);
              finish();
            } else {
              // Tell the user WHY, then fall back — a silent downgrade to the
              // plain draft looked like the feature simply didn't exist.
              var why = (r && r.err) ? r.err : 'unknown reason';
              if (T.toast) T.toast('Styled send failed (' + why + ') — opening the classic draft instead', 'warn', 6000);
              try { sendDraft(to, subj, bod, state.cc, state.bcc); } catch (e) { if (T.debug) T.debug('composer.send', e); }
              finish();
            }
          });
        return;
      }
      try { sendDraft(to, subj, bod, state.cc, state.bcc); } catch (e) { if (T.debug) T.debug('composer.send', e); }
      finish();
    });

    // ✨ Preview — full-screen render of the CURRENT body text as styled HTML.
    var pvBtn = bg.querySelector('[data-preview]');
    if (pvBtn && htmlRender) pvBtn.addEventListener('click', function () {
      var bod = bg.querySelector('[data-body]').value || '';
      var html = '';
      try { html = htmlRender(bod) || ''; } catch (_) {}
      if (!html) { if (T.toast) T.toast('Nothing to preview', 'info'); return; }
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:10005;display:flex;flex-direction:column;background:rgba(10,8,5,.75)';
      ov.innerHTML =
        '<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--nx-surface-solid,#161d2e);border-bottom:1px solid var(--nx-gold-line,rgba(212,164,78,.3))">' +
          '<div style="font-weight:700;font-size:14px;color:var(--nx-text-strong,#f3ede1)">How it will look</div>' +
          '<button type="button" class="nx-cmp-btn" data-pv-close style="padding:6px 16px">Back</button>' +
        '</div>' +
        '<iframe style="flex:1;border:none;background:#f4eddc" sandbox="allow-same-origin"></iframe>';
      document.body.appendChild(ov);
      ov.querySelector('iframe').srcdoc = /^\s*<!DOCTYPE/i.test(html) ? html : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">' + html + '</body></html>';
      ov.querySelector('[data-pv-close]').addEventListener('click', function () { ov.remove(); });
    });

    // Styled-send readiness — shown in the status strip the moment the sheet
    // opens, so auth problems are visible BEFORE Send instead of after. Also
    // pre-warms the Google auth script so the consent popup opens inside the
    // Send tap (a script load mid-gesture gets popup-blocked).
    if (htmlRender) {
      // Fully self-contained readiness check — no other file needs to be
      // fresh for styled send to work. The build tag makes the running
      // version visible so cache confusion is diagnosable at a glance.
      var tag = ' · engine ' + STYLED_ENGINE_BUILD;
      if (gmailStoredToken()) setCmpStatus('✨ Styled send ready' + tag, 'ok');
      else if (gmailClientId()) setCmpStatus('✨ Send will ask for one Google permission (send email) the first time.' + tag, '');
      else setCmpStatus('⚠ Google isn’t connected on this device — Send will open the classic draft. Connect Drive in Settings once.' + tag, 'warn');
      try { gmailLoadGsi().catch(function () {}); } catch (_) {}
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('open'); });
  };

  /* ─── NX.vendorEmail — vendor service-request email, template-aware ────
     The ONE shared path for every "email this vendor" button (Vendors view,
     equipment detail SERVICED BY, QR scan page). Renders the vendor's saved
     dispatch_subject / dispatch_template with {tokens}, falls back to a
     generic service request, then opens the NX.composeEmail engine with the
     vendor's primary address in To and every extra address in CC.

     Tokens: {restaurant} {location} {equipment} {unit} {model} {serial}
             {area} {issue} {priority} {description} {user}
     A token whose value is UNKNOWN in this context is left visible
     (e.g. "{issue}") so the sender sees exactly what to fill in. */
  function vendorTplCtx(ctx) {
    ctx = ctx || {};
    var user = ctx.user
      || (T.currentUser && T.currentUser.name)
      || (T.user && T.user.name) || '';
    return {
      restaurant:  ctx.restaurant != null ? ctx.restaurant : ctx.location,
      location:    ctx.location != null ? ctx.location : ctx.restaurant,
      equipment:   ctx.equipment,
      unit:        ctx.unit != null ? ctx.unit : ctx.model,
      model:       ctx.model != null ? ctx.model : ctx.unit,
      serial:      ctx.serial,
      area:        ctx.area,
      issue:       ctx.issue,
      priority:    ctx.priority,
      description: ctx.description,
      user:        user,
    };
  }
  T.renderVendorTemplate = function (tpl, ctx) {
    var map = vendorTplCtx(ctx);
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, key) {
      var v = map[key.toLowerCase()];
      return (v == null || v === '') ? m : String(v);   // unknown → keep token visible
    });
  };
  T.vendorEmail = function (vendor, ctx) {
    if (!vendor) return;
    ctx = ctx || {};
    // Addresses: vendors.emails is [{value,label}] (R&M vendors) but scan-page
    // contacts carry [{email,role}] — accept both shapes.
    var all = [];
    var push = function (e) {
      var v = e && (e.value || e.email) ? String(e.value || e.email).trim() : String(e || '').trim();
      if (v && validEmail(v) && all.indexOf(v) === -1) all.push(v);
    };
    if (Array.isArray(vendor.emails)) vendor.emails.forEach(push);
    push(vendor.email);
    if (!all.length) { if (T.toast) T.toast('No email on file for this vendor.', 'warning'); return; }
    var to = all[0], cc = all.slice(1);

    var map = vendorTplCtx(ctx);
    var company = vendor.company || vendor.name || 'vendor';
    var subject = vendor.dispatch_subject
      ? T.renderVendorTemplate(vendor.dispatch_subject, ctx)
      : ('Service Request — ' + ([map.restaurant, map.equipment].filter(Boolean).join(' · ') || company));
    var body;
    if (vendor.dispatch_template) {
      body = T.renderVendorTemplate(vendor.dispatch_template, ctx);
    } else {
      var lines = ['Hi ' + (String(company).split(' ')[0]) + ' team,', ''];
      lines.push('We need service on:');
      lines.push('• Equipment: ' + (map.equipment || '{equipment}'));
      lines.push('• Unit: ' + (map.unit || '{unit}'));
      lines.push('• Serial: ' + (map.serial || '{serial}'));
      lines.push('• Location: ' + (map.restaurant || '{restaurant}') + (map.area ? ' · ' + map.area : ''));
      lines.push('');
      lines.push('Issue: ' + (map.issue || '{issue}'));
      if (map.description) { lines.push(''); lines.push(map.description); }
      lines.push(''); lines.push('Please reply with your ETA and a quote if available.');
      lines.push(''); lines.push('Thanks,'); lines.push(map.user || '');
      body = lines.join('\n');
    }

    if (typeof T.composeEmail === 'function') {
      T.composeEmail({
        recipientsKey: 'vendor:' + (vendor.id || company),
        to: to,
        cc: cc,
        subject: subject,
        body: body,
        onSend: ctx.onSend,
      });
    } else {
      // Engine missing (shouldn't happen — same file) — encoded mailto.
      var enc = function (s) { return encodeURIComponent(s).replace(/\+/g, '%20'); };
      window.location.href = 'mailto:' + encodeURIComponent(to)
        + '?subject=' + enc(subject) + '&body=' + enc(body)
        + (cc.length ? '&cc=' + encodeURIComponent(cc.join(',')) : '');
      if (typeof ctx.onSend === 'function') { try { ctx.onSend({ to: to, cc: cc, subject: subject, body: body }); } catch (_) {} }
    }
  };
})();
