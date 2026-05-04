/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Public Scan v5 — ground-up rewrite (2026-04-22)
   
   KEY ARCHITECTURAL DECISIONS (why this looks different from v4):
   
   1. FULLY SELF-CONTAINED STYLING
      v4 relied on equipment-fixes.css (loaded globally from index.html)
      to provide scroll behaviour. That file sets `html, body { overflow-y: auto }`
      but in practice the scroll wasn't working — probably due to cascade 
      interactions with nexus.css that I couldn't reproduce in analysis. 
      
      v5 ignores the main app's CSS entirely for layout. It injects its 
      own stylesheet LAST in <head> (so it wins cascade on source order)
      AND sets critical scroll properties inline via 
      `element.style.setProperty('prop', 'val', 'important')` — inline 
      styles with !important beat every external CSS rule, period.
      
   2. HTML IS THE SCROLL CONTAINER (not body)
      The standard well-supported pattern for long mobile pages:
        html { overflow-y: auto; height: auto; }
        body { overflow: visible; min-height: 100vh; }
      When html has overflow:auto and body is taller than the viewport,
      html becomes the scroll container. This is how every long article
      or blog post on the internet works.
      
   3. SELF-DIAGNOSTIC
      If the page still doesn't scroll, `window._NX_SCAN_DIAG()` in the
      browser console will dump the computed styles + heights. This lets
      us (or any developer) see exactly WHY in 2 seconds instead of 
      guessing.
      
   4. NO INNERHTML RESET
      v4 did `document.body.innerHTML = ...` which nuked the pin-screen
      and boot loader simultaneously. v5 keeps the pin-screen hidden (via
      display:none) and builds the scan UI as a new appended node. 
      Cleaner, more predictable.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ─── 1. DETECT PUBLIC SCAN ──────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const qr = params.get('equip');
  const forceLogin = params.get('login') === '1';
  if (!qr || forceLogin) return;

  // NOTE: We INTENTIONALLY do NOT check for an active session here.
  // The public PM page is the landing UI for every QR scan, whether the
  // scanner is a logged-out contractor or a logged-in staff member. This
  // keeps the UX predictable: a QR sticker always shows the same thing
  // when you scan it.
  //
  // If the scanner is staff who wants to dig into the equipment record,
  // they tap the "Login" button on the public PM page, which redirects
  // to ?equip=XXX&login=1 → PIN screen → post-login redirect lands on
  // that equipment's detail view (handled in app.js post-auth hook).

  // Tell app.js: skip PIN setup, this is a public scan.
  window._NX_PUBLIC_SCAN = qr;

  const SB_URL  = window.NEXUS_CONFIG?.SUPABASE_URL  || 'https://oprsthfxqrdbwdvommpw.supabase.co';
  const SB_KEY  = window.NEXUS_CONFIG?.SUPABASE_ANON || 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9';

  // ─── 2. SCROLL GUARANTEE — THE MOST IMPORTANT FUNCTION IN THIS FILE ──
  //
  // Three layers of enforcement:
  //   a) <style> tag injected as LAST element in <head> — wins cascade
  //      order against any external CSS that has equal specificity
  //   b) class `nx-ps` on html + body so our selectors match
  //   c) Inline setProperty(..., 'important') — inline !important beats
  //      ALL external CSS (highest priority in cascade)
  //
  // This is called immediately, again on DOMContentLoaded, and again
  // after renderScan so nothing can possibly override it.
  function guaranteeScroll() {
    // Add classes
    document.documentElement.classList.add('nx-ps');
    if (document.body) document.body.classList.add('nx-ps');

    // Inject stylesheet if not already present. Append to end of head.
    let style = document.getElementById('nx-ps-reset');
    if (!style) {
      style = document.createElement('style');
      style.id = 'nx-ps-reset';
      // CRITICAL: html is the scroll container; body overflows naturally
      style.textContent = `
        html.nx-ps {
          overflow-x: hidden !important;
          overflow-y: auto !important;
          height: auto !important;
          max-height: none !important;
          min-height: 100% !important;
          -webkit-overflow-scrolling: touch !important;
          position: static !important;
        }
        body.nx-ps {
          overflow: visible !important;
          height: auto !important;
          max-height: none !important;
          min-height: 100vh !important;
          min-height: 100dvh !important;
          margin: 0 !important;
          padding: 0 !important;
          position: static !important;
        }
        /* Hide anything from main app that might be positioned over us */
        body.nx-ps #pinScreen,
        body.nx-ps .pin-screen,
        body.nx-ps .main,
        body.nx-ps .bottom-nav,
        body.nx-ps .offline-banner,
        body.nx-ps .toast-container {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Inline !important — beats ALL external CSS
    const setImp = (el, prop, val) => el.style.setProperty(prop, val, 'important');
    setImp(document.documentElement, 'overflow-y', 'auto');
    setImp(document.documentElement, 'overflow-x', 'hidden');
    setImp(document.documentElement, 'height', 'auto');
    if (document.body) {
      setImp(document.body, 'overflow', 'visible');
      setImp(document.body, 'height', 'auto');
      setImp(document.body, 'min-height', '100vh');
    }
  }

  // Run NOW (html exists immediately; body may not until DOMContentLoaded)
  guaranteeScroll();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guaranteeScroll, { once: true });
  }

  // ─── 3. SELF-DIAGNOSTIC (available in console) ──────────────────────
  window._NX_SCAN_DIAG = function() {
    const bs = getComputedStyle(document.body);
    const hs = getComputedStyle(document.documentElement);
    const report = {
      // Computed
      body_overflow_y: bs.overflowY,
      body_overflow_x: bs.overflowX,
      body_height: bs.height,
      body_min_height: bs.minHeight,
      body_position: bs.position,
      html_overflow_y: hs.overflowY,
      html_overflow_x: hs.overflowX,
      html_height: hs.height,
      // Measured
      body_scroll_height: document.body.scrollHeight,
      body_client_height: document.body.clientHeight,
      body_offset_height: document.body.offsetHeight,
      html_scroll_height: document.documentElement.scrollHeight,
      html_client_height: document.documentElement.clientHeight,
      window_inner_height: window.innerHeight,
      // Computed conclusions
      can_body_scroll: bs.overflowY === 'auto' || bs.overflowY === 'scroll',
      can_html_scroll: hs.overflowY === 'auto' || hs.overflowY === 'scroll',
      content_exceeds_viewport: document.body.scrollHeight > window.innerHeight,
      scroll_delta_px: document.body.scrollHeight - window.innerHeight,
    };
    console.table(report);
    return report;
  };

  // ─── 4. UTILITIES ──────────────────────────────────────────────────
  const esc = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function telHref(phone) {
    if (!phone) return '';
    const cleaned = String(phone).replace(/[^\d+]/g, '');
    if (cleaned.length === 10 && !cleaned.startsWith('+')) return 'tel:+1' + cleaned;
    return 'tel:' + cleaned;
  }

  function relDate(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86400000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    if (days < 365) return Math.floor(days / 30) + ' months ago';
    return Math.floor(days / 365) + ' years ago';
  }

  // ─── Lucide-style inline SVGs ───────────────────────────────────────
  // Using inline SVGs (not data-lucide) so icons render instantly, no
  // need to wait for the lucide library to finish its async load.
  // Stroke-based, monoline — matches the NEXUS visual language.
  const ICON = (path, size = 20) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  // Paths extracted from lucide-static (MIT licensed).
  const ICONS = {
    // category
    refrigeration: '<path d="M12 2v20"/><path d="m4.93 10.93 14.14 2.14"/><path d="m4.93 13.07 14.14-2.14"/><path d="M12 2 9 5"/><path d="m12 2 3 3"/><path d="M12 22l-3-3"/><path d="m12 22 3-3"/>',
    cooking:       '<path d="M8 21h8"/><path d="M12 21v-4"/><path d="M7 8h10l-1 9H8z"/><path d="M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/>',
    hvac:          '<path d="M12 12v9"/><path d="M12 3v3"/><path d="m4.93 4.93 2.12 2.12"/><path d="m16.95 16.95 2.12 2.12"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m4.93 19.07 2.12-2.12"/><path d="m16.95 7.05 2.12-2.12"/><circle cx="12" cy="12" r="3"/>',
    plumbing:      '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"/>',
    electrical:    '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    cleaning:      '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    dishwashing:   '<path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="m2 16 20 6-6-20A20 20 0 0 0 2 16"/><path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4"/>',
    beverage:      '<path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2"/>',
    bar:           '<path d="M8 22h8"/><path d="M12 11v11"/><path d="m19 3-7 8-7-8Z"/>',
    _default:      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',

    // banners / status
    warning:  '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    shield:   '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    dot:      '<circle cx="12" cy="12" r="5" fill="currentColor"/>',

    // location
    mapPin:   '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',

    // action buttons
    wrench:   '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    phone:    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    alert:    '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    lock:     '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    refresh:  '<path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M21 3v6h-6"/>',
  };

  function icon(name, size) {
    return ICON(ICONS[name] || ICONS._default, size);
  }
  function categoryIconSvg(category, size) {
    const key = (category || '').toLowerCase();
    return ICON(ICONS[key] || ICONS._default, size);
  }

  // ─── 5. COMPLETE INLINE STYLESHEET (all scan UI styles) ─────────────
  // Fully self-contained — no dependencies on equipment.css or any other file.
  // ─── 5. COMPLETE INLINE STYLESHEET — NEXUS brand-aligned ────────────
  // Design tokens mirror nexus.css :root variables so this fits the
  // existing visual language. 60/30/10 rule: surfaces 60%, text 30%,
  // gold accent 10%. Semantic colors are used sparingly and desaturated.
  const UI_CSS = `
    :root {
      --ps-bg: #111116;
      --ps-surface: #1b1b24;
      --ps-elevated: #24242e;
      --ps-text: #ede9e0;
      --ps-muted: #a49c94;
      --ps-faint: #857f75;
      --ps-accent: #d4a44e;
      --ps-border: rgba(212, 182, 138, 0.08);
      --ps-border-strong: rgba(212, 182, 138, 0.18);
      --ps-glow: rgba(212, 164, 78, 0.18);
      /* Palette-coherent status colors — no greens, no scarlets.
         Operational: olive-bronze. Needs service: brand gold (= accent).
         Down: oxblood. Retired: graphite. */
      --ps-green: #9c8a3e;
      --ps-amber: #d4a44e;
      --ps-red:   #a83e3e;
      --ps-blue:  #7a8db8;
      /* Per-page status tint — set inline on .nx-ps-page from JS. */
      --ps-status-tint: var(--ps-accent);
    }

    /* ─── Light-theme palette ─────────────────────────────────────
       Triggered when html[data-theme="light"] (set by the coin tap).
       Cream/parchment surfaces, deep-gold text, charcoal lines.
       Same editorial family as the post-login app's light theme so the
       transition into the main app feels seamless. */
    html[data-theme="light"] .nx-ps-page,
    html[data-theme="light"].nx-ps {
      --ps-bg: #f4ecd8;          /* cream / parchment */
      --ps-surface: #ede2c8;
      --ps-elevated: #e2d4b3;
      --ps-text: #2a2008;        /* deep brown-black, easier on eyes than pure black */
      --ps-muted: #6b5f3e;
      --ps-faint: #968864;
      --ps-accent: #8b6914;      /* deep gold — readable on cream */
      --ps-border: rgba(70, 50, 18, 0.12);
      --ps-border-strong: rgba(70, 50, 18, 0.22);
      --ps-glow: rgba(139, 105, 20, 0.16);
      --ps-green: #6b6014;       /* desaturated olive */
      --ps-amber: #8b6914;
      --ps-red:   #7a2828;       /* deep oxblood */
      --ps-blue:  #4a5878;
    }

    /* Page shell — relative for the absolute stripe child */
    .nx-ps-page {
      background: var(--ps-bg);
      color: var(--ps-text);
      font-family: 'DM Sans', 'Outfit', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 0 0 calc(env(safe-area-inset-bottom, 0px) + 48px);
      font-feature-settings: 'ss01', 'cv11';
      -webkit-font-smoothing: antialiased;
      position: relative;
    }
    /* Status stripe — full-width band at the very top of the page.
       Color comes from --ps-status-tint set inline per-equipment.
       Visible-but-subtle (3px tall) so the page identity (gold-on-dark)
       wins; the stripe is an accent that says "this thing's status"
       without dominating. Soft fade-in from the top edge. */
    .nx-ps-status-stripe {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--ps-status-tint);
      box-shadow: 0 0 24px var(--ps-status-tint);
      opacity: 0.85;
      pointer-events: none;
      z-index: 1;
    }
    /* Header — coin masthead on left, wordmark on right.
       The coin is the same metaphor as the post-login app: tap to flip
       persona (Trajan ↔ Providentia) which also flips theme (light ↔
       dark). State persists to the same localStorage keys the main app
       reads, so the user's choice carries through after they sign in. */
    .nx-ps-header {
      padding: 18px 20px 16px;
      border-bottom: 1px solid var(--ps-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .nx-ps-brand {
      font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
      font-size: 13px;
      font-weight: 600;
      color: var(--ps-accent);
      letter-spacing: 4px;
    }
    .nx-ps-coin {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .nx-ps-coin img {
      width: 48px; height: 48px;
      border-radius: 50%;
      display: block;
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4));
      animation: nx-ps-coin-bob 6s ease-in-out infinite;
      transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
    }
    .nx-ps-coin:hover img { animation-play-state: paused; }
    .nx-ps-coin.is-flipped img {
      transform: rotateY(360deg);
      animation: none;
    }
    .nx-ps-coin-name {
      font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
      font-size: 8.5px;
      font-weight: 600;
      letter-spacing: 1.8px;
      text-transform: uppercase;
      color: var(--ps-accent);
    }
    @keyframes nx-ps-coin-bob {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(-2px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .nx-ps-coin img { animation: none; transition: none; }
    }
    .nx-ps-body {
      padding: 24px 16px;
      max-width: 600px;
      margin: 0 auto;
    }

    /* Photo / category icon hero */
    .nx-ps-photo {
      width: 100%;
      aspect-ratio: 16 / 10;
      max-height: 44vh;
      object-fit: cover;
      border-radius: 14px;
      margin-bottom: 20px;
      background: var(--ps-surface);
      display: block;
      border: 1px solid var(--ps-border);
    }
    .nx-ps-photo-placeholder {
      width: 100%;
      aspect-ratio: 16 / 10;
      max-height: 44vh;
      background:
        radial-gradient(circle at 50% 45%, rgba(212, 164, 78, 0.06) 0%, transparent 60%),
        linear-gradient(180deg, var(--ps-surface) 0%, var(--ps-bg) 100%);
      border: 1px solid var(--ps-border);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .nx-ps-photo-placeholder svg {
      width: 72px;
      height: 72px;
      color: var(--ps-accent);
      opacity: 0.45;
      stroke-width: 1.25;
    }

    /* Name + location */
    .nx-ps-name {
      font-family: 'Outfit', 'DM Sans', sans-serif;
      font-size: 26px;
      font-weight: 600;
      margin: 0 0 4px;
      line-height: 1.18;
      color: var(--ps-text);
      letter-spacing: -0.01em;
    }
    .nx-ps-loc {
      font-size: 13px;
      color: var(--ps-muted);
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      gap: 5px;
      letter-spacing: 0.1px;
    }
    .nx-ps-loc svg { width: 13px; height: 13px; stroke-width: 2; opacity: 0.7; }

    /* Status pill — use NEXUS accent tints, not raw green/red */
    .nx-ps-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 13px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      margin-bottom: 22px;
      border: 1px solid;
      background: rgba(212, 182, 138, 0.04);
    }
    .nx-ps-status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      display: inline-block;
      box-shadow: 0 0 8px currentColor;
    }

    /* Banners — tonal surface cards, accent-tinted left border */
    .nx-ps-banner {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 13px 14px 13px 13px;
      background: var(--ps-surface);
      border: 1px solid var(--ps-border);
      border-left-width: 3px;
      border-radius: 10px;
      margin-bottom: 10px;
    }
    .nx-ps-banner-icon {
      width: 20px; height: 20px;
      flex-shrink: 0;
      margin-top: 1px;
      stroke-width: 2;
    }
    .nx-ps-banner-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 2px;
      color: var(--ps-text);
      letter-spacing: 0.1px;
    }
    .nx-ps-banner-sub {
      font-size: 12.5px;
      color: var(--ps-muted);
      line-height: 1.45;
    }
    .nx-ps-banner-issue    { border-left-color: var(--ps-red); }
    .nx-ps-banner-issue    .nx-ps-banner-icon { color: var(--ps-red); }
    .nx-ps-banner-overdue  { border-left-color: var(--ps-amber); }
    .nx-ps-banner-overdue  .nx-ps-banner-icon { color: var(--ps-amber); }
    .nx-ps-banner-warranty { border-left-color: var(--ps-blue); }
    .nx-ps-banner-warranty .nx-ps-banner-icon { color: var(--ps-blue); }

    /* Specs — clean key-value grid */
    .nx-ps-specs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px 24px;
      margin: 22px 0 6px;
      padding: 20px 0 4px;
      border-top: 1px solid var(--ps-border);
    }
    .nx-ps-spec-label {
      font-size: 10px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: var(--ps-faint);
      margin-bottom: 5px;
      font-weight: 600;
    }
    .nx-ps-spec-val {
      font-size: 14.5px;
      color: var(--ps-text);
      font-weight: 500;
      letter-spacing: 0.1px;
    }
    .nx-ps-spec-val.dim { color: var(--ps-muted); font-weight: 400; }

    /* Service history */
    .nx-ps-section-title {
      font-size: 10px;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      color: var(--ps-faint);
      font-weight: 600;
      margin: 26px 0 10px;
      padding-top: 16px;
      border-top: 1px solid var(--ps-border);
    }
    .nx-ps-history-row {
      display: grid;
      grid-template-columns: 70px 1fr;
      gap: 12px;
      padding: 11px 0;
      border-bottom: 1px solid var(--ps-border);
    }
    .nx-ps-history-row:last-child { border-bottom: none; }
    .nx-ps-history-date {
      font-size: 12px;
      color: var(--ps-faint);
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
    }
    .nx-ps-history-type {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      color: var(--ps-accent);
      margin-bottom: 3px;
      letter-spacing: 1.2px;
    }
    .nx-ps-history-desc {
      font-size: 13.5px;
      color: var(--ps-text);
      line-height: 1.45;
      margin-bottom: 3px;
    }
    .nx-ps-history-by {
      font-size: 11.5px;
      color: var(--ps-muted);
    }

    /* Actions — single hero CTA, others tonal */
    .nx-ps-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 28px;
    }

    /* All buttons share: icon + two-line label layout */
    .nx-ps-btn {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 15px 16px;
      border-radius: 12px;
      border: 1px solid var(--ps-border);
      background: var(--ps-surface);
      color: var(--ps-text);
      font-family: inherit;
      cursor: pointer;
      text-align: left;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.08s ease, background 0.15s ease, border-color 0.15s ease;
    }
    .nx-ps-btn:active { transform: scale(0.985); }
    .nx-ps-btn-icon-wrap {
      width: 36px; height: 36px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      background: rgba(212, 182, 138, 0.06);
    }
    .nx-ps-btn-icon-wrap svg {
      width: 18px; height: 18px;
      stroke-width: 1.8;
    }
    .nx-ps-btn-label { flex: 1; min-width: 0; }
    .nx-ps-btn-title {
      font-size: 14.5px;
      font-weight: 600;
      color: var(--ps-text);
      letter-spacing: 0.1px;
      margin-bottom: 1px;
    }
    .nx-ps-btn-sub {
      font-size: 12px;
      color: var(--ps-muted);
      letter-spacing: 0.1px;
    }
    .nx-ps-btn-arrow {
      color: var(--ps-faint);
      flex-shrink: 0;
      stroke-width: 2;
    }
    .nx-ps-btn-arrow svg { width: 16px; height: 16px; }

    /* Primary — the only place we go full gold */
    .nx-ps-btn-primary {
      background: linear-gradient(135deg, #d4a44e 0%, #b88a38 100%);
      border-color: transparent;
      box-shadow: 0 6px 20px -4px rgba(212, 164, 78, 0.4),
                  0 1px 0 0 rgba(255, 230, 180, 0.18) inset;
      padding: 17px 18px;
    }
    .nx-ps-btn-primary .nx-ps-btn-icon-wrap {
      background: rgba(26, 20, 8, 0.16);
    }
    .nx-ps-btn-primary .nx-ps-btn-icon-wrap svg { color: #2a1f08; }
    .nx-ps-btn-primary .nx-ps-btn-title { color: #1a1408; font-size: 15px; font-weight: 700; }
    .nx-ps-btn-primary .nx-ps-btn-sub   { color: rgba(26, 20, 8, 0.68); }
    .nx-ps-btn-primary .nx-ps-btn-arrow { color: rgba(26, 20, 8, 0.55); }

    /* Secondary (call) — accent tint */
    .nx-ps-btn-call .nx-ps-btn-icon-wrap { background: rgba(212, 182, 138, 0.1); }
    .nx-ps-btn-call .nx-ps-btn-icon-wrap svg { color: var(--ps-accent); }

    /* Issue — subtle red tint, not aggressive */
    .nx-ps-btn-issue .nx-ps-btn-icon-wrap { background: rgba(168, 62, 62, 0.1); }
    .nx-ps-btn-issue .nx-ps-btn-icon-wrap svg { color: #e88080; }

    /* Login — neutral */
    .nx-ps-btn-login { background: transparent; }
    .nx-ps-btn-login .nx-ps-btn-icon-wrap { background: rgba(212, 182, 138, 0.05); }
    .nx-ps-btn-login .nx-ps-btn-icon-wrap svg { color: var(--ps-muted); }
    .nx-ps-btn-login .nx-ps-btn-title { color: var(--ps-muted); }

    /* Footer */
    .nx-ps-footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--ps-border);
      font-size: 10px;
      color: var(--ps-faint);
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .nx-ps-footer-brand { color: var(--ps-accent); font-weight: 500; }

    /* Error + boot screens */
    .nx-ps-error, .nx-ps-boot {
      text-align: center;
      padding: 80px 24px 40px;
      max-width: 340px;
      margin: 0 auto;
    }
    .nx-ps-error-icon {
      width: 48px; height: 48px;
      margin: 0 auto 20px;
      color: var(--ps-accent);
      opacity: 0.8;
    }
    .nx-ps-error-title {
      font-size: 17px;
      font-weight: 600;
      color: var(--ps-text);
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }
    .nx-ps-error-msg {
      font-size: 13px;
      color: var(--ps-muted);
      margin-bottom: 28px;
      line-height: 1.5;
    }
    .nx-ps-error-btn {
      padding: 13px 28px;
      background: var(--ps-accent);
      color: #1a1408;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      font-size: 13.5px;
      letter-spacing: 0.3px;
      cursor: pointer;
      font-family: inherit;
    }
    .nx-ps-boot-brand {
      font-family: 'JetBrains Mono', monospace;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: 8px;
      color: var(--ps-accent);
      margin-bottom: 32px;
      animation: nxPsPulse 1.8s ease-in-out infinite;
    }
    .nx-ps-boot-spinner {
      width: 46px; height: 46px; margin: 0 auto 20px;
      border: 2.5px solid var(--ps-border-strong);
      border-top-color: var(--ps-accent);
      border-radius: 50%;
      animation: nxPsSpin 0.85s linear infinite;
    }
    .nx-ps-boot-label {
      font-size: 13px;
      color: var(--ps-muted);
      letter-spacing: 0.2px;
    }
    @keyframes nxPsSpin { to { transform: rotate(360deg); } }
    @keyframes nxPsPulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }

    /* Report Issue modal — bottom sheet on mobile */
    .nx-ps-modal-bg {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 9998;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      animation: nxPsFadeIn 0.2s ease;
    }
    @keyframes nxPsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .nx-ps-modal {
      background: var(--ps-surface);
      border-top: 1px solid var(--ps-border-strong);
      border-radius: 18px 18px 0 0;
      padding: 22px 20px calc(env(safe-area-inset-bottom, 0px) + 22px);
      width: 100%;
      max-width: 600px;
      max-height: 92vh;
      overflow-y: auto;
      animation: nxPsSlideUp 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    @keyframes nxPsSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    .nx-ps-modal-grip {
      width: 36px; height: 4px;
      background: var(--ps-border-strong);
      border-radius: 3px;
      margin: -6px auto 14px;
    }
    .nx-ps-modal h2 {
      font-family: 'Outfit', 'DM Sans', sans-serif;
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 4px;
      color: var(--ps-text);
      letter-spacing: -0.01em;
    }
    .nx-ps-modal-sub {
      font-size: 13px;
      color: var(--ps-muted);
      margin-bottom: 22px;
    }
    .nx-ps-modal-label {
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--ps-faint);
      font-weight: 600;
      margin-bottom: 8px;
    }
    .nx-ps-modal-input, .nx-ps-modal-textarea {
      width: 100%;
      padding: 12px 14px;
      background: var(--ps-bg);
      border: 1px solid var(--ps-border-strong);
      border-radius: 10px;
      color: var(--ps-text);
      font-family: inherit;
      font-size: 14px;
      box-sizing: border-box;
      margin-bottom: 18px;
      transition: border-color 0.15s;
    }
    .nx-ps-modal-input:focus, .nx-ps-modal-textarea:focus {
      outline: none;
      border-color: var(--ps-accent);
    }
    .nx-ps-modal-textarea { min-height: 96px; resize: vertical; }
    .nx-ps-modal-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 18px; }
    .nx-ps-modal-chip {
      padding: 7px 12px;
      background: var(--ps-bg);
      border: 1px solid var(--ps-border-strong);
      border-radius: 8px;
      color: var(--ps-muted);
      font-size: 12.5px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.12s;
    }
    .nx-ps-modal-chip.active {
      background: var(--ps-accent);
      border-color: var(--ps-accent);
      color: #1a1408;
      font-weight: 700;
    }
    .nx-ps-modal-btns { display: flex; gap: 10px; margin-top: 6px; }
    .nx-ps-modal-btn {
      flex: 1;
      padding: 14px;
      border-radius: 10px;
      border: 1px solid;
      font-family: inherit;
      font-weight: 600;
      font-size: 13.5px;
      letter-spacing: 0.2px;
      cursor: pointer;
    }
    .nx-ps-modal-btn-cancel {
      background: transparent;
      border-color: var(--ps-border-strong);
      color: var(--ps-muted);
    }
    .nx-ps-modal-btn-send {
      background: var(--ps-accent);
      border-color: var(--ps-accent);
      color: #1a1408;
    }
    .nx-ps-modal-btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Modal header — icon badge + title stacked next to it */
    .nx-ps-modal-header {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 20px;
    }
    .nx-ps-modal-header h2 { margin-bottom: 2px; }
    .nx-ps-modal-header .nx-ps-modal-sub { margin-bottom: 0; }
    .nx-ps-modal-header-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .nx-ps-modal-header-icon.is-call {
      background: rgba(212, 182, 138, 0.12);
      color: var(--ps-accent);
    }
    .nx-ps-modal-header-icon.is-report {
      background: rgba(168, 62, 62, 0.12);
      color: #e88080;
    }

    /* Priority pills */
    .nx-ps-modal-priority {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 18px;
    }
    .nx-ps-modal-pri-btn {
      padding: 11px 10px;
      background: var(--ps-bg);
      border: 1px solid var(--ps-border-strong);
      border-radius: 10px;
      color: var(--ps-muted);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .nx-ps-modal-pri-btn[data-pri="low"].active {
      background: rgba(107, 155, 240, 0.14);
      border-color: var(--ps-blue);
      color: #9cc0ff;
    }
    .nx-ps-modal-pri-btn[data-pri="normal"].active {
      background: rgba(212, 182, 138, 0.14);
      border-color: var(--ps-accent);
      color: var(--ps-accent);
    }
    .nx-ps-modal-pri-btn[data-pri="urgent"].active {
      background: rgba(168, 62, 62, 0.14);
      border-color: var(--ps-red);
      color: #e88080;
    }

    /* Success state inside modal */
    .nx-ps-modal-success {
      text-align: center;
      padding: 24px 8px 8px;
    }
    .nx-ps-modal-success-icon {
      width: 72px; height: 72px;
      margin: 0 auto 18px;
      border-radius: 50%;
      background: rgba(212, 182, 138, 0.1);
      color: var(--ps-accent);
      display: flex; align-items: center; justify-content: center;
    }
    .nx-ps-modal-success h2 {
      font-family: 'Outfit', 'DM Sans', sans-serif;
      margin-bottom: 6px;
    }
    .nx-ps-modal-success .nx-ps-modal-sub { margin-bottom: 20px; }
    .nx-ps-modal-success-close {
      width: 100%;
      padding: 14px;
    }
  `;


  // ─── 5b. COIN MASTHEAD ──────────────────────────────────────────────
  // The coin is the same metaphor as the post-login app: tap to flip
  // persona, which also flips theme. State persists to localStorage so
  // the user's choice carries through into the main app when they sign
  // in. First-paint reads the saved preference (default Providentia +
  // dark for new visitors).
  function applyThemeFromPersona() {
    try {
      let pref = localStorage.getItem('nexus_theme_pref');
      if (!pref) {
        const legacy = localStorage.getItem('nexus_theme');
        pref = (legacy === 'dark' || legacy === 'light') ? legacy : 'auto';
      }
      let theme;
      if (pref === 'dark' || pref === 'light') theme = pref;
      else {
        const persona = localStorage.getItem('nexus_active_persona') || 'providentia';
        theme = persona === 'trajan' ? 'light' : 'dark';
      }
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) { /* ignore */ }
  }
  applyThemeFromPersona();  // run immediately at module evaluation

  function coinHTML() {
    const persona = (function() {
      try { return localStorage.getItem('nexus_active_persona') || 'providentia'; }
      catch (_) { return 'providentia'; }
    })();
    const src = persona === 'trajan' ? 'assets/coin-trajan.png' : 'assets/coin-providentia.png';
    const name = persona === 'trajan' ? 'Trajan' : 'Providentia';
    return `<button class="nx-ps-coin" id="nxPsCoin" type="button" aria-label="Flip coin — change theme">
      <img src="${src}" alt="${name}" draggable="false">
      <span class="nx-ps-coin-name">${name}</span>
    </button>`;
  }

  function wireCoin(root) {
    const coin = root.querySelector('#nxPsCoin');
    if (!coin) return;
    coin.addEventListener('click', () => {
      let cur;
      try { cur = localStorage.getItem('nexus_active_persona') || 'providentia'; }
      catch (_) { cur = 'providentia'; }
      const next = cur === 'trajan' ? 'providentia' : 'trajan';
      const newTheme = next === 'trajan' ? 'light' : 'dark';
      try {
        localStorage.setItem('nexus_active_persona', next);
        localStorage.setItem('nexus_theme_pref', 'auto');
      } catch (_) { /* private browsing — flip in-memory only */ }
      document.documentElement.setAttribute('data-theme', newTheme);
      const img = coin.querySelector('img');
      const lbl = coin.querySelector('.nx-ps-coin-name');
      if (img) {
        img.src = next === 'trajan' ? 'assets/coin-trajan.png' : 'assets/coin-providentia.png';
        img.alt = next === 'trajan' ? 'Trajan' : 'Providentia';
      }
      if (lbl) lbl.textContent = next === 'trajan' ? 'Trajan' : 'Providentia';
      coin.classList.add('is-flipped');
      setTimeout(() => coin.classList.remove('is-flipped'), 600);
    });
  }


  // ─── 6. BOOT LOADER ─────────────────────────────────────────────────
  function renderBoot() {
    // Inject styles first
    if (!document.getElementById('nx-ps-ui-styles')) {
      const st = document.createElement('style');
      st.id = 'nx-ps-ui-styles';
      st.textContent = UI_CSS;
      document.head.appendChild(st);
    }

    // Build boot screen as an independent node (don't nuke body yet)
    const boot = document.createElement('div');
    boot.id = 'nx-ps-boot';
    boot.className = 'nx-ps-page';
    boot.innerHTML = `
      <div class="nx-ps-boot">
        <div class="nx-ps-boot-brand">NEXUS</div>
        <div class="nx-ps-boot-spinner"></div>
        <div class="nx-ps-boot-label">Loading equipment...</div>
      </div>
    `;

    const attachBoot = () => {
      // Hide all existing body children (don't remove — preserves any
      // scripts that might still be running). Append boot on top.
      Array.from(document.body.children).forEach(c => {
        if (c.tagName !== 'SCRIPT') c.style.display = 'none';
      });
      document.body.appendChild(boot);
      guaranteeScroll();
    };

    if (document.body) attachBoot();
    else document.addEventListener('DOMContentLoaded', attachBoot, { once: true });
  }

  renderBoot();

  // ─── 7. SUPABASE CLIENT ─────────────────────────────────────────────
  let sb = null;
  async function ensureSupabase() {
    // App may have already created one on window.NX.sb — reuse it
    if (window.NX?.sb) { sb = window.NX.sb; return; }
    // Wait for CDN library
    const start = Date.now();
    while (!window.supabase?.createClient) {
      if (Date.now() - start > 8000) throw new Error('Supabase library failed to load');
      await new Promise(r => setTimeout(r, 50));
    }
    sb = window.supabase.createClient(SB_URL, SB_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // ─── 8. FETCH EQUIPMENT + CONTACTS ──────────────────────────────────
  async function fetchScanData() {
    // Full select — fallback if service_phone columns not migrated
    let eq, eqErr;
    try {
      const res = await sb.from('equipment')
        .select('id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code, service_phone, service_contact_name, preferred_contractor_node_id')
        .eq('qr_code', qr).single();
      eq = res.data; eqErr = res.error;
    } catch (e) {
      console.warn('[scan] full select failed, fallback:', e?.message);
      const res = await sb.from('equipment')
        .select('id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code, preferred_contractor_node_id')
        .eq('qr_code', qr).single();
      eq = res.data; eqErr = res.error;
    }
    if (eqErr || !eq) throw new Error(eqErr?.message || 'Equipment not registered');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const [ticketRes, maintRes, contractorRes] = await Promise.all([
      sb.from('tickets')
        .select('id, title, created_at, reported_by, priority, status')
        .ilike('title', `%${eq.name.slice(0, 30)}%`)
        .eq('status', 'open')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(1),
      sb.from('equipment_maintenance')
        .select('event_type, event_date, description, performed_by')
        .eq('equipment_id', eq.id)
        .order('event_date', { ascending: false })
        .limit(4),
      (!eq.service_phone && eq.preferred_contractor_node_id)
        ? sb.from('nodes').select('id, name, notes, tags, links')
            .eq('id', eq.preferred_contractor_node_id).single()
        : Promise.resolve({ data: null }),
    ]);

    // Build contact object
    let contact = null;
    if (eq.service_phone) {
      contact = {
        name: eq.service_contact_name || 'Service',
        phone: eq.service_phone,
        phoneHref: telHref(eq.service_phone),
      };
    } else if (contractorRes?.data) {
      const node = contractorRes.data;
      const links = node.links || {};
      let phone = links.phone || '';
      if (!phone) {
        const text = (node.notes || '') + ' ' + JSON.stringify(node.tags || []) + ' ' + (node.name || '');
        const m = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (m) phone = m[0].trim();
      }
      if (phone) {
        contact = { name: node.name || 'Service', phone, phoneHref: telHref(phone) };
      }
    }

    return {
      eq,
      activeTicket: (ticketRes.data || [])[0] || null,
      maint: maintRes.data || [],
      contact,
    };
  }

  // ─── 9. RENDER SCAN PAGE ────────────────────────────────────────────
  function renderScan({ eq, activeTicket, maint, contact }) {
    // Palette-coherent status colors — no greens, no scarlets.
    // Olive-bronze for operational (settled), gold for needs_service
    // (= brand accent, "look at me"), oxblood for down (authoritative,
    // not panicked), graphite for retired.
    const statusMap = {
      operational:   { label: 'Operational',   color: '#9c8a3e' },
      needs_service: { label: 'Needs Service', color: '#d4a44e' },
      down:          { label: 'Down',          color: '#a83e3e' },
      retired:       { label: 'Retired',       color: '#6b6258' },
    };
    const status = statusMap[eq.status] || { label: eq.status || 'Unknown', color: '#857f75' };

    const pm = eq.next_pm_date ? new Date(eq.next_pm_date) : null;
    const pmStr = pm ? pm.toLocaleDateString() : 'Not scheduled';
    const pmOverdue = pm && pm < new Date();
    const pmDaysOverdue = pmOverdue ? Math.floor((Date.now() - pm.getTime()) / 86400000) : 0;

    const warranty = eq.warranty_until ? new Date(eq.warranty_until) : null;
    const warrantyValid = warranty && warranty > new Date();
    const warrantyDaysLeft = warrantyValid ? Math.floor((warranty.getTime() - Date.now()) / 86400000) : 0;

    const installStr = eq.install_date ? new Date(eq.install_date).toLocaleDateString() : '—';
    const warrantyStr = warranty ? (warranty.toLocaleDateString() + (warrantyValid ? '' : ' (expired)')) : '—';

    const loginUrl = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}&login=1`;

    // Banners in priority order
    const banners = [];
    if (activeTicket) {
      const who = activeTicket.reported_by || 'Someone';
      const issueText = (activeTicket.title || 'Issue reported')
        .replace(/^\[Equipment\]\s*[^:]*:\s*/, '').slice(0, 140);
      banners.push(`
        <div class="nx-ps-banner nx-ps-banner-issue">
          <div class="nx-ps-banner-icon">${icon('warning')}</div>
          <div>
            <div class="nx-ps-banner-title">Active issue filed ${esc(relDate(activeTicket.created_at))}</div>
            <div class="nx-ps-banner-sub"><strong>${esc(who)}</strong> reported: ${esc(issueText)}</div>
          </div>
        </div>
      `);
    }
    if (pmOverdue) {
      banners.push(`
        <div class="nx-ps-banner nx-ps-banner-overdue">
          <div class="nx-ps-banner-icon">${icon('clock')}</div>
          <div>
            <div class="nx-ps-banner-title">Preventative maintenance overdue</div>
            <div class="nx-ps-banner-sub">Was due ${pmDaysOverdue} day${pmDaysOverdue !== 1 ? 's' : ''} ago (${pmStr})</div>
          </div>
        </div>
      `);
    }
    if (warrantyValid) {
      banners.push(`
        <div class="nx-ps-banner nx-ps-banner-warranty">
          <div class="nx-ps-banner-icon">${icon('shield')}</div>
          <div>
            <div class="nx-ps-banner-title">Under warranty until ${warranty.toLocaleDateString()}</div>
            <div class="nx-ps-banner-sub">${warrantyDaysLeft} day${warrantyDaysLeft !== 1 ? 's' : ''} remaining — avoid invasive repairs; check warranty first</div>
          </div>
        </div>
      `);
    }

    const photoHTML = eq.photo_url
      ? `<img class="nx-ps-photo" src="${esc(eq.photo_url)}" alt="${esc(eq.name)}">`
      : `<div class="nx-ps-photo-placeholder">${categoryIconSvg(eq.category, 72)}</div>`;

    const historyHTML = maint.length ? `
      <div class="nx-ps-section-title">Recent Service History</div>
      ${maint.map(m => `
        <div class="nx-ps-history-row">
          <div class="nx-ps-history-date">${esc(m.event_date ? new Date(m.event_date).toLocaleDateString() : '')}</div>
          <div>
            <div class="nx-ps-history-type">${esc((m.event_type || '').replace(/_/g, ' ').toUpperCase())}</div>
            <div class="nx-ps-history-desc">${esc(m.description || '')}</div>
            ${m.performed_by ? `<div class="nx-ps-history-by">${esc(m.performed_by)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    ` : '';

    const callBtnHTML = contact ? `
      <button class="nx-ps-btn nx-ps-btn-call" data-action="call">
        <div class="nx-ps-btn-icon-wrap">${icon('phone')}</div>
        <div class="nx-ps-btn-label">
          <div class="nx-ps-btn-title">Call ${esc(contact.name)}</div>
          <div class="nx-ps-btn-sub">${esc(contact.phone)}</div>
        </div>
        <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
      </button>
    ` : '';

    const html = `
      <div class="nx-ps-page" id="nx-ps-page" style="--ps-status-tint:${status.color}">
        <div class="nx-ps-status-stripe" aria-hidden="true"></div>
        <div class="nx-ps-header">${coinHTML()}<div class="nx-ps-brand">NEXUS</div></div>
        <div class="nx-ps-body">
          <div class="nx-ps-card">
            ${photoHTML}
            <h1 class="nx-ps-name">${esc(eq.name)}</h1>
            <div class="nx-ps-loc">${icon('mapPin', 13)} ${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
            <div class="nx-ps-status" style="color:${status.color}; border-color:${status.color}40;">
              <span class="nx-ps-status-dot" style="background:${status.color};"></span>
              ${esc(status.label)}
            </div>
            ${banners.join('')}
            <div class="nx-ps-specs">
              <div><div class="nx-ps-spec-label">Manufacturer</div><div class="nx-ps-spec-val">${esc(eq.manufacturer || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Model</div><div class="nx-ps-spec-val">${esc(eq.model || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Serial Number</div><div class="nx-ps-spec-val">${esc(eq.serial_number || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Installed</div><div class="nx-ps-spec-val">${installStr}</div></div>
              <div><div class="nx-ps-spec-label">Warranty</div><div class="nx-ps-spec-val ${warrantyValid ? '' : 'dim'}">${warrantyStr}</div></div>
              <div><div class="nx-ps-spec-label">Next PM</div><div class="nx-ps-spec-val ${pmOverdue ? '' : 'dim'}">${pmStr}</div></div>
            </div>
            ${historyHTML}
            <div class="nx-ps-actions">
              <button class="nx-ps-btn nx-ps-btn-primary" data-action="log-service">
                <div class="nx-ps-btn-icon-wrap">${icon('wrench')}</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Log Service</div>
                  <div class="nx-ps-btn-sub">Contractors — no login needed</div>
                </div>
                <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
              </button>
              ${callBtnHTML}
              <button class="nx-ps-btn nx-ps-btn-issue" data-action="report">
                <div class="nx-ps-btn-icon-wrap">${icon('alert')}</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Report Issue</div>
                  <div class="nx-ps-btn-sub">Something's broken or unsafe</div>
                </div>
                <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
              </button>
              <button class="nx-ps-btn nx-ps-btn-login" data-action="login">
                <div class="nx-ps-btn-icon-wrap">${icon('lock')}</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Staff Login</div>
                  <div class="nx-ps-btn-sub">Full equipment details</div>
                </div>
                <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
              </button>
            </div>
            <div class="nx-ps-footer">Powered by <span class="nx-ps-footer-brand">NEXUS</span></div>
          </div>
        </div>
      </div>
    `;

    // Remove boot, append scan page
    document.getElementById('nx-ps-boot')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'nx-ps-root';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    wireCoin(wrap);  // tap-to-flip persona+theme

    // Wire up button actions
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'log-service') {
        const fn = window._NX_PUBLIC_PM_OPEN;
        if (fn) fn(eq.qr_code);
        else alert('PM Logger not loaded');
      } else if (action === 'call') {
        // Require context capture before dialing — creates a ticket so
        // staff have a record of who called the contractor and why.
        openIssueModal(eq, { mode: 'call', contact });
      } else if (action === 'report') {
        openIssueModal(eq, { mode: 'report' });
      } else if (action === 'login') {
        window.location.href = loginUrl;
      }
    });

    // Make context available to PM logger
    window._NX_PUBLIC_SCAN_EQ = eq;
    window._NX_PUBLIC_SCAN_CONTACT = contact;
    window.dispatchEvent(new CustomEvent('nx-public-scan-ready', { detail: { eq, contact } }));

    // FINAL scroll guarantee after DOM is fully painted
    guaranteeScroll();
    requestAnimationFrame(guaranteeScroll);
    setTimeout(guaranteeScroll, 100);

    // Self-diagnostic to console
    setTimeout(() => {
      const d = window._NX_SCAN_DIAG();
      if (!d.content_exceeds_viewport) {
        console.warn('[scan] Content fits in viewport — scrolling not needed');
      } else if (!d.can_html_scroll && !d.can_body_scroll) {
        console.error('[scan] CANNOT SCROLL — neither html nor body has overflow:auto/scroll');
      } else {
        console.log('[scan] ✓ scroll configured; scrollDelta=' + d.scroll_delta_px + 'px');
      }
    }, 300);
  }

  // ─── 10. UNIFIED ISSUE MODAL — used for both "Report Issue" and "Call"
  //
  // We never let anyone call the contractor without leaving a paper trail.
  // Both actions go through this modal:
  //   mode='report' → creates ticket, shows success state, no phone action
  //   mode='call'   → creates ticket with [CALLED CONTRACTOR], then dials
  //
  // Staff can see on the board EXACTLY who called the contractor, why,
  // when, and which equipment — so no one calls behind anyone's back and
  // no issue ever disappears into a phone tree. Same modal serves both
  // paths so UX is consistent.
  function openIssueModal(eq, { mode, contact } = {}) {
    const isCall = mode === 'call';
    const commonIssues = [
      'Not cooling', 'Leaking', 'Making noise', 'Not turning on',
      'Temperature wrong', 'Smells strange', 'Fan issue', 'Ice buildup'
    ];
    const rememberedName = localStorage.getItem('nx_reporter_name') || '';

    const title       = isCall ? 'Call Contractor' : 'Report Issue';
    const subLine     = isCall
      ? `${esc(eq.name)} · Will create ticket then call ${esc(contact?.name || 'contractor')}`
      : `${esc(eq.name)} · ${esc(eq.location || '')}`;
    const sendLabel   = isCall ? `Create ticket & Call` : 'Send Report';
    const iconHTML    = icon(isCall ? 'phone' : 'alert', 28);

    const bg = document.createElement('div');
    bg.className = 'nx-ps-modal-bg';
    bg.innerHTML = `
      <div class="nx-ps-modal" onclick="event.stopPropagation()">
        <div class="nx-ps-modal-grip"></div>
        <div class="nx-ps-modal-header">
          <div class="nx-ps-modal-header-icon ${isCall ? 'is-call' : 'is-report'}">${iconHTML}</div>
          <div>
            <h2>${title}</h2>
            <div class="nx-ps-modal-sub">${subLine}</div>
          </div>
        </div>

        <div class="nx-ps-modal-label">What's happening? Pick any that apply</div>
        <div class="nx-ps-modal-chips" id="nxRepChips">
          ${commonIssues.map(i => `<button class="nx-ps-modal-chip" data-issue="${esc(i)}" type="button">${esc(i)}</button>`).join('')}
        </div>

        <div class="nx-ps-modal-label">Describe the problem *</div>
        <textarea class="nx-ps-modal-textarea" id="nxRepDesc" placeholder="What's wrong? When did it start? Any error codes or unusual sounds?"></textarea>

        <div class="nx-ps-modal-label">Priority</div>
        <div class="nx-ps-modal-priority" id="nxRepPri">
          <button type="button" class="nx-ps-modal-pri-btn" data-pri="low">Low</button>
          <button type="button" class="nx-ps-modal-pri-btn active" data-pri="normal">Normal</button>
          <button type="button" class="nx-ps-modal-pri-btn" data-pri="urgent">Urgent</button>
        </div>

        <div class="nx-ps-modal-label">Your name *</div>
        <input class="nx-ps-modal-input" id="nxRepName" value="${esc(rememberedName)}" placeholder="So staff know who to follow up with">

        <div class="nx-ps-modal-btns">
          <button class="nx-ps-modal-btn nx-ps-modal-btn-cancel" type="button" id="nxRepCancel">Cancel</button>
          <button class="nx-ps-modal-btn nx-ps-modal-btn-send" type="button" id="nxRepSend" disabled>${sendLabel}</button>
        </div>
      </div>
    `;
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);

    const desc    = bg.querySelector('#nxRepDesc');
    const nameEl  = bg.querySelector('#nxRepName');
    const send    = bg.querySelector('#nxRepSend');
    const cancel  = bg.querySelector('#nxRepCancel');
    const chips   = bg.querySelectorAll('.nx-ps-modal-chip');
    const priBtns = bg.querySelectorAll('.nx-ps-modal-pri-btn');

    let priority = 'normal';

    const validate = () => {
      send.disabled = !(desc.value.trim().length >= 3 && nameEl.value.trim().length >= 2);
    };
    desc.addEventListener('input', validate);
    nameEl.addEventListener('input', validate);

    // Chip toggles — clicking adds the phrase to the description if not there
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const wasActive = chip.classList.contains('active');
        chip.classList.toggle('active');
        const phrase = chip.dataset.issue;
        const lcDesc = desc.value.toLowerCase();
        if (!wasActive && !lcDesc.includes(phrase.toLowerCase())) {
          desc.value = desc.value
            ? `${desc.value.replace(/[.,\s]+$/, '')}. ${phrase}`
            : phrase;
          // Auto-bump to urgent for serious words if not already
          if (/leak|fire|smoke|electr/i.test(phrase) && priority !== 'urgent') {
            priority = 'urgent';
            priBtns.forEach(b => b.classList.toggle('active', b.dataset.pri === 'urgent'));
          }
        }
        validate();
      });
    });

    // Priority pills
    priBtns.forEach(b => b.addEventListener('click', () => {
      priority = b.dataset.pri;
      priBtns.forEach(x => x.classList.toggle('active', x === b));
    }));

    cancel.addEventListener('click', () => bg.remove());

    send.addEventListener('click', async () => {
      const reporter = nameEl.value.trim();
      const problem  = desc.value.trim();
      send.disabled = true;
      send.textContent = isCall ? 'Creating ticket...' : 'Sending...';

      try {
        localStorage.setItem('nx_reporter_name', reporter);

        // Build ticket. Schema reference (see brain-chat.js:406, ai-writer.js:450):
        //   title, notes, location, priority (low|normal|urgent),
        //   status ('open'|'closed'), reported_by, photo_url, ai_troubleshoot
        // No equipment_id column — equipment reference lives in title/notes.
        const locStr = [eq.location, eq.area].filter(Boolean).join(' · ');
        const titlePrefix = isCall ? '[CALL]' : '[Equipment]';
        const ticketTitle = `${titlePrefix} ${eq.name}: ${problem.slice(0, 80)}`;

        const notesParts = [
          isCall
            ? `Contractor called via QR scan landing page.`
            : `Reported via QR scan landing page.`,
          ``,
          `Equipment: ${eq.name}`,
          `Location: ${locStr || '—'}`,
          eq.manufacturer ? `Manufacturer: ${eq.manufacturer}` : null,
          eq.model ? `Model: ${eq.model}` : null,
          eq.serial_number ? `Serial: ${eq.serial_number}` : null,
          eq.qr_code ? `QR: ${eq.qr_code}` : null,
          `Reporter: ${reporter}`,
          isCall && contact ? `Calling: ${contact.name} (${contact.phone})` : null,
          ``,
          `Problem description:`,
          problem,
        ].filter(x => x !== null).join('\n');

        const ticketData = {
          title: ticketTitle,
          notes: notesParts,
          location: eq.location || null,
          priority,              // 'low' | 'normal' | 'urgent' — schema-correct
          status: 'open',
          reported_by: reporter,
        };
        const { error } = await sb.from('tickets').insert(ticketData);
        if (error) throw error;

        // Stage S: push notification to managers + admins. Fire and
        // forget — a failed push must not block the ticket flow.
        // NX may not be available in public-scan context (kiosk mode)
        // so check for it. When it IS available, push.
        if (typeof NX !== 'undefined' && NX && NX.notifyTicketCreated) {
          NX.notifyTicketCreated(ticketData);
        } else {
          // Public scan context has its own `sb` client — call the
          // edge function directly with the same broadcast shape so
          // QR reports STILL notify managers even without NX loaded.
          try {
            const priority_label = (priority || 'normal').toLowerCase();
            const icon = priority_label === 'urgent' ? '🚨' : priority_label === 'high' ? '⚠️' : '🎫';
            const locLabel = eq.location ? ` · ${eq.location.toUpperCase()}` : '';
            sb.functions.invoke('predictive-notify', {
              body: {
                broadcast: {
                  title: `${icon} New ticket${locLabel}`,
                  body: `${eq.name}: ${problem.slice(0, 100)} — by ${reporter}`.slice(0, 180),
                  audience: 'managers',
                  priority: (priority_label === 'urgent' || priority_label === 'high') ? 'high' : 'normal',
                  view: 'board',
                }
              }
            }).catch(e => console.warn('[scan] push fail (non-fatal):', e?.message));
          } catch (e) { /* non-fatal */ }
        }

        // Also drop a line into daily_logs so it shows up on the log
        // view alongside everything else happening today. Non-fatal if fails.
        try {
          const logIcon = isCall ? '📞' : '🔧';
          const logPrefix = isCall ? 'CONTRACTOR CALLED' : 'TICKET';
          const logLoc = eq.location || 'unknown';
          await sb.from('daily_logs').insert({
            entry: `${logIcon} ${logPrefix} [${priority.toUpperCase()}] by ${reporter} @ ${logLoc}: ${eq.name} — ${problem.slice(0, 160)}${isCall && contact ? ` → calling ${contact.name}` : ''}`
          });
        } catch (logErr) {
          console.warn('[scan] daily_logs insert failed (non-fatal):', logErr?.message);
        }

        if (isCall) {
          // Dial the contractor. iOS/Android will handle tel: natively.
          // Show a brief confirmation flash first so user knows the ticket
          // landed before we kick them to the dialer.
          bg.querySelector('.nx-ps-modal').innerHTML = `
            <div class="nx-ps-modal-success">
              <div class="nx-ps-modal-success-icon">${icon('phone', 40)}</div>
              <h2>Ticket created</h2>
              <div class="nx-ps-modal-sub">Calling ${esc(contact.name)}…</div>
            </div>
          `;
          setTimeout(() => {
            window.location.href = contact.phoneHref;
            setTimeout(() => bg.remove(), 1200);
          }, 700);
        } else {
          bg.querySelector('.nx-ps-modal').innerHTML = `
            <div class="nx-ps-modal-success">
              <div class="nx-ps-modal-success-icon">${icon('shield', 40)}</div>
              <h2>Reported</h2>
              <div class="nx-ps-modal-sub">Staff have been notified. Thanks for letting us know.</div>
              <button class="nx-ps-modal-btn nx-ps-modal-btn-send nx-ps-modal-success-close">Close</button>
            </div>
          `;
          bg.querySelector('.nx-ps-modal-success-close').addEventListener('click', () => bg.remove());
        }
      } catch (err) {
        console.error('[scan] Ticket submit failed:', err);
        send.disabled = false;
        send.textContent = sendLabel;
        alert('Failed to submit: ' + (err.message || 'Unknown error'));
      }
    });
  }

  // ─── 11. ERROR DISPLAY ──────────────────────────────────────────────
  function renderError(msg) {
    document.getElementById('nx-ps-boot')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'nx-ps-root';
    wrap.className = 'nx-ps-page';
    wrap.innerHTML = `
      <div class="nx-ps-header">${coinHTML()}<div class="nx-ps-brand">NEXUS</div></div>
      <div class="nx-ps-error">
        <div class="nx-ps-error-icon">${icon('warning', 48)}</div>
        <div class="nx-ps-error-title">Could not load equipment</div>
        <div class="nx-ps-error-msg">${esc(msg)}</div>
        <button class="nx-ps-error-btn" onclick="location.reload()">Try again</button>
      </div>
    `;
    document.body.appendChild(wrap);
    wireCoin(wrap);
  }

  // ─── 12. MAIN ───────────────────────────────────────────────────────
  async function main() {
    try {
      await ensureSupabase();
      const data = await fetchScanData();
      renderScan(data);
    } catch (err) {
      console.error('[scan] fatal:', err);
      renderError(err.message || 'Unknown error');
    }
  }

  main();
})();
