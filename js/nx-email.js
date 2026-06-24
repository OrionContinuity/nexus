/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Email Engine — shared mailto: composer
   ─────────────────────────────────────────────
   Extracted from ordering.js so other modules (cleaning, equipment,
   board) can compose mailto: links with the same formatting language —
   so an Order email and a Cleaning Report and an Equipment Issue all
   read like they came from the same system.

   Exposes: NX.email = { buildMailtoUrl, sectionHeader, rule, encode,
                         BODY_WARN_LEN, fillTemplate }

   The visual design — same horizontal-rule width (45 chars), same
   middle-dot bullet (\u00B7), same uppercase section labels — is the
   contract here. Don't drift from it without updating both ordering's
   email builder + cleaning's report builder together.

   Loaded once via index.html before any module that uses it. Idempotent.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  // v18.11 — same TDZ fix as nx-archive.js. Was `if (window.NX && NX.email)`
  // which crashes the IIFE silently when window.NX is already truthy
  // (which it always is by load time). Reference NX.email via window.NX.
  if (window.NX && window.NX.email) return;  // idempotent
  const NX = window.NX = window.NX || {};

  /* mailto: URLs need %20 for spaces, not + (which URLSearchParams emits).
     Manual encode for that, plus comma-joined CC/BCC lists. */
  function encode(s) {
    return encodeURIComponent(String(s || '')).replace(/\+/g, '%20');
  }

  function buildMailtoUrl(to, subject, body, cc, bcc) {
    const params = [`subject=${encode(subject)}`, `body=${encode(body)}`];
    // CC/BCC — comma-separated, each address URL-encoded
    if (cc && cc.length) {
      params.push(`cc=${cc.map(e => encodeURIComponent(e)).join(',')}`);
    }
    if (bcc && bcc.length) {
      params.push(`bcc=${bcc.map(e => encodeURIComponent(e)).join(',')}`);
    }
    // TO can be one address or an array (comma-separated)
    const toStr = Array.isArray(to)
      ? to.map(e => encodeURIComponent(e)).join(',')
      : encodeURIComponent(to || '');
    return `mailto:${toStr}?${params.join('&')}`;
  }

  /* Visual section header inside the body — pads to 45 chars total so
     consecutive sections line up:  "─── PRODUCE ─────────── 4 items"
     Used by both order emails and cleaning reports. */
  function sectionHeader(label, suffix) {
    const lbl = String(label || '').toUpperCase();
    const suf = suffix == null ? '' : ' ' + String(suffix);
    const TARGET = 45;
    // Format:  ─── LABEL ──────── SUFFIX
    const left  = '─── ' + lbl + ' ';
    const used  = left.length + suf.length;
    const fill  = Math.max(3, TARGET - used);
    return left + '─'.repeat(fill) + suf;
  }

  /* Plain horizontal divider, same width as a sectionHeader. Used to
     close out the body before the closing line / signature. */
  function rule() {
    return '─'.repeat(45);
  }

  /* Lightweight {placeholder} substitution for subject/body templates.
     Case-insensitive; missing keys substitute as empty string so the
     output never has dangling {tokens}. */
  function fillTemplate(template, ctx) {
    if (!template) return '';
    return String(template).replace(/\{([a-zA-Z_]+)\}/g, (_, key) => {
      const k = key.toLowerCase();
      // Try exact + lowercase + delivery_date alias for {date}
      if (ctx[key] != null) return String(ctx[key]);
      if (ctx[k]   != null) return String(ctx[k]);
      if (k === 'date' && ctx.delivery_date != null) return String(ctx.delivery_date);
      return '';
    });
  }

  /* Soft-warn threshold for body length. Some mail apps truncate
     >2000 chars; we surface a confirm() at this size and let the user
     decide. Cleaning's full report can blow past this; ordering's
     usually doesn't. */
  const BODY_WARN_LEN = 1900;

  /* ── Robust draft opener (shared by ordering + the composer) ──────────
     Desktop mailto: is unreliable: a long body (a full order or a daily-log
     recap, 2000+ chars) gets truncated/dropped by the OS handler, and many
     desktops have no mail client registered at all — so `location.href =
     mailto:` silently does nothing and the draft never appears ("email
     unable to be made"). On desktop we route to Gmail's web composer, which
     handles long bodies and always works in a browser; touch/mobile keeps
     native mailto (the OS mail apps handle it well). The body is copied to
     the clipboard as a belt-and-suspenders fallback. */
  function isDesktop() {
    try { return window.matchMedia('(min-width: 900px)').matches && !('ontouchstart' in window); }
    catch (_) { return false; }
  }
  function gmailComposeUrl(to, subject, body, cc, bcc) {
    const toStr = Array.isArray(to) ? to.join(',') : (to || '');
    let u = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1';
    if (toStr) u += '&to=' + encodeURIComponent(toStr);
    if (cc && cc.length)  u += '&cc='  + encodeURIComponent(cc.join(','));
    if (bcc && bcc.length) u += '&bcc=' + encodeURIComponent(bcc.join(','));
    u += '&su=' + encodeURIComponent(subject || '');
    u += '&body=' + encodeURIComponent(body || '');
    return u;
  }
  // Open a mail draft. Returns true if a window/handler was triggered.
  function openDraft(to, subject, body, cc, bcc) {
    if (isDesktop()) {
      const win = window.open(gmailComposeUrl(to, subject, body, cc, bcc), '_blank', 'noopener');
      try { if (navigator.clipboard) navigator.clipboard.writeText(body || ''); } catch (_) {}
      if (win) { if (NX.toast) NX.toast('Opening Gmail draft…', 'info'); return true; }
      if (NX.toast) NX.toast('Pop-up blocked — email body copied, paste it into your mail app', 'error');
      // fall through to mailto, body already copied
    }
    const a = document.createElement('a');
    a.href = buildMailtoUrl(to, subject, body, cc, bcc);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    return true;
  }

  NX.email = {
    buildMailtoUrl,
    sectionHeader,
    rule,
    encode,
    fillTemplate,
    BODY_WARN_LEN,
    openDraft,
    isDesktop,
    gmailComposeUrl,
  };
})();
