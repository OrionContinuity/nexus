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
    // Add classes. `nx-ps` controls v5's own scroll/layout rules.
    // `public-view` is the scope that public-views.css uses to override
    // the legacy equipment-public-pm-system.css palette tokens — it
    // makes --pm-bg, --pm-surface, etc theme-aware so the modal flips
    // dark/light along with the rest of the page when the coin is
    // tapped. Both classes set on both <html> and <body> for max reach.
    document.documentElement.classList.add('nx-ps');
    document.documentElement.classList.add('public-view');
    if (document.body) {
      document.body.classList.add('nx-ps');
      document.body.classList.add('public-view');
    }

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
      --ps-bg: var(--bg);
      --ps-surface: var(--surface);
      --ps-elevated: var(--elevated);
      --ps-text: var(--text);
      --ps-muted: var(--muted);
      --ps-faint: var(--faint);
      --ps-accent: var(--accent);
      --ps-border: rgba(212, 182, 138, 0.08);
      --ps-border-strong: rgba(212, 182, 138, 0.18);
      --ps-glow: rgba(212, 164, 78, 0.18);
      /* Palette-coherent status colors — no greens, no scarlets.
         Operational: olive-bronze. Needs service: brand gold (= accent).
         Down: oxblood. Retired: graphite. */
      --ps-green: var(--green);
      --ps-amber: var(--accent);
      --ps-red:   var(--red);
      --ps-blue:  var(--blue);
      /* Per-page status tint — set inline on .nx-ps-page from JS. */
      --ps-status-tint: var(--ps-accent);
    }

    /* ─── Light-theme palette ─────────────────────────────────────
       Triggered when html[data-theme="light"] (set by the coin tap).
       Cream/parchment surfaces with EXPLICIT readable hex colors.
       The previous version inherited from var(--accent) / var(--nx-gold-on)
       which aren't always defined on this self-contained module
       (it boots before the main app's variables exist), leaving the
       page faded gray-on-cream and unreadable. Now: deep brown-black
       text on warm cream, deep gold accents, warm muted browns. */
    html[data-theme="light"] .nx-ps-page,
    html[data-theme="light"].nx-ps {
      --ps-bg:        #fdf6ec;          /* warm cream / parchment */
      --ps-surface:   #f3e8d0;          /* slightly tinted card */
      --ps-elevated:  #e8d8b6;          /* deeper card edge */
      --ps-text:      #1a1408;          /* deep brown-black, max contrast */
      --ps-muted:     #5a4a30;          /* warm dark brown for secondary */
      --ps-faint:     #8a7a55;          /* mid-brown for tertiary */
      --ps-accent:    #8b6914;          /* deep gold — readable on cream */
      --ps-border:    rgba(70, 50, 18, 0.16);
      --ps-border-strong: rgba(70, 50, 18, 0.28);
      --ps-glow:      rgba(139, 105, 20, 0.20);
      --ps-green:     #6b7f3a;          /* sage olive */
      --ps-amber:     #b8862c;          /* warm amber */
      --ps-red:       #7a2828;          /* deep oxblood */
      --ps-blue:      #4a5878;
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

    /* Status pill — now a tappable BUTTON. Tapping opens the status-
       change sheet so a contractor at the unit can update its state
       directly. Bigger gold beacon with animated orbit particles when
       operational, calm flash when needs-service, struggling-bulb
       flicker when down. Same character as the equipment-list beacons
       in the main app — one design system across both surfaces. */
    .nx-ps-status {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px 10px 14px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      margin-bottom: 22px;
      border: 1px solid var(--ps-border-strong);
      background: rgba(212, 164, 78, 0.08);
      color: var(--ps-accent);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: transform 120ms ease, background 140ms ease, border-color 140ms ease;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      position: relative;
      overflow: visible;
    }
    .nx-ps-status:hover { background: rgba(212, 164, 78, 0.14); }
    .nx-ps-status:active { transform: scale(0.97); }
    .nx-ps-status:focus-visible {
      outline: 2px solid var(--ps-accent);
      outline-offset: 3px;
    }
    .nx-ps-status-edit-hint {
      margin-left: 4px;
      opacity: 0.55;
      font-size: 10px;
      letter-spacing: 0.8px;
    }

    /* The beacon dot — gold, 14px, multi-layer halo, animated. */
    .nx-ps-status-dot {
      position: relative;
      display: block;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      flex-shrink: 0;
      overflow: visible;
      background: #d4a44e;
    }
    .nx-ps-status-dot.is-operational {
      animation: nx-ps-beacon-pulse 2.4s ease-in-out infinite;
      box-shadow:
        0 0 8px rgba(212, 164, 78, 0.85),
        0 0 16px rgba(212, 164, 78, 0.55),
        0 0 28px rgba(212, 164, 78, 0.30);
    }
    .nx-ps-status-dot.is-needs-service,
    .nx-ps-status-dot.is-reported,
    .nx-ps-status-dot.is-called {
      animation: nx-ps-beacon-flash 1.8s ease-in-out infinite;
    }
    .nx-ps-status-dot.is-down,
    .nx-ps-status-dot.is-broken {
      background: #5a4a30;
      animation: nx-ps-beacon-bulb-dying 5.4s steps(1, end) infinite;
    }
    .nx-ps-status-dot.is-retired,
    .nx-ps-status-dot.is-missing {
      background: #8a8580;
      opacity: 0.55;
    }

    /* Orbit particles — only for operational. fore = white-gold above
       beacon, back = larger gold behind. ::before/::after for two more
       tiny particles. Different orbital periods so they never sync. */
    .nx-ps-orbit { position: absolute; top: 50%; left: 50%; border-radius: 50%; pointer-events: none; opacity: 0; }
    .nx-ps-status-dot.is-operational .nx-ps-orbit-fore,
    .nx-ps-status-dot.is-operational .nx-ps-orbit-back { opacity: 1; }
    .nx-ps-status-dot.is-operational .nx-ps-orbit-fore {
      width: 3px; height: 3px;
      margin: -1.5px 0 0 -1.5px;
      background: #fff7d8;
      box-shadow: 0 0 4px rgba(255, 220, 130, 1), 0 0 8px rgba(212, 164, 78, 0.85);
      z-index: 3;
      animation: nx-ps-orbit-fore 2.6s linear infinite;
    }
    .nx-ps-status-dot.is-operational .nx-ps-orbit-back {
      width: 5px; height: 5px;
      margin: -2.5px 0 0 -2.5px;
      background: #d4a44e;
      box-shadow: 0 0 6px rgba(212, 164, 78, 0.85), 0 0 14px rgba(212, 164, 78, 0.45);
      z-index: 0;
      animation: nx-ps-orbit-back 4.4s linear infinite reverse;
    }
    .nx-ps-status-dot.is-operational::before,
    .nx-ps-status-dot.is-operational::after {
      content: ''; position: absolute; top: 50%; left: 50%;
      border-radius: 50%; pointer-events: none;
    }
    .nx-ps-status-dot.is-operational::before {
      width: 2px; height: 2px; margin: -1px 0 0 -1px;
      background: #fff7d8;
      box-shadow: 0 0 3px rgba(255, 220, 130, 1);
      z-index: 4;
      animation: nx-ps-orbit-tiny-a 1.9s linear infinite;
    }
    .nx-ps-status-dot.is-operational::after {
      width: 2.5px; height: 2.5px; margin: -1.25px 0 0 -1.25px;
      background: #d4a44e;
      box-shadow: 0 0 4px rgba(212, 164, 78, 0.9);
      z-index: 1;
      animation: nx-ps-orbit-tiny-b 3.2s linear infinite reverse;
    }

    @keyframes nx-ps-beacon-pulse {
      0%, 100% { box-shadow: 0 0 8px rgba(212,164,78,0.85), 0 0 16px rgba(212,164,78,0.55), 0 0 28px rgba(212,164,78,0.30); }
      50%      { box-shadow: 0 0 12px rgba(212,164,78,1),    0 0 22px rgba(212,164,78,0.75), 0 0 36px rgba(212,164,78,0.40); }
    }
    @keyframes nx-ps-beacon-flash {
      0%, 100% { box-shadow: 0 0 4px rgba(212,164,78,0.40); transform: scale(1.0); }
      50%      { box-shadow: 0 0 8px rgba(212,164,78,0.85), 0 0 16px rgba(212,164,78,0.45); transform: scale(1.06); }
    }
    @keyframes nx-ps-beacon-bulb-dying {
      0%   { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      4%   { background: #8a6a30; box-shadow: 0 0 5px rgba(212,164,78,0.40); }
      6%   { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      17%  { background: #a8842a; box-shadow: 0 0 7px rgba(212,164,78,0.55); }
      19%  { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      31%  { background: #8a6a30; box-shadow: 0 0 5px rgba(212,164,78,0.40); }
      33%  { background: #8a6a30; box-shadow: 0 0 5px rgba(212,164,78,0.40); }
      34%  { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      47%  { background: #f0c870; box-shadow: 0 0 12px rgba(255,200,100,0.95), 0 0 22px rgba(212,164,78,0.55); }
      48%  { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      73%  { background: #a8842a; box-shadow: 0 0 7px rgba(212,164,78,0.55); }
      74%  { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      76%  { background: #c89a48; box-shadow: 0 0 9px rgba(212,164,78,0.7);  }
      77%  { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
      100% { background: #5a4a30; box-shadow: 0 0 3px rgba(212,164,78,0.20); }
    }
    @keyframes nx-ps-orbit-fore {
      0%   { transform: rotate(0deg)   translateX(9px) rotate(0deg); opacity: 1; }
      50%  { transform: rotate(180deg) translateX(9px) rotate(-180deg); opacity: 0.35; }
      100% { transform: rotate(360deg) translateX(9px) rotate(-360deg); opacity: 1; }
    }
    @keyframes nx-ps-orbit-back {
      0%   { transform: rotate(0deg)   translateX(13px) rotate(0deg); opacity: 0.5; }
      50%  { transform: rotate(180deg) translateX(13px) rotate(-180deg); opacity: 1; }
      100% { transform: rotate(360deg) translateX(13px) rotate(-360deg); opacity: 0.5; }
    }
    @keyframes nx-ps-orbit-tiny-a {
      0%   { transform: rotate(45deg)  translateX(7px) rotate(-45deg); opacity: 0.85; }
      50%  { opacity: 0.3; }
      100% { transform: rotate(405deg) translateX(7px) rotate(-405deg); opacity: 0.85; }
    }
    @keyframes nx-ps-orbit-tiny-b {
      0%   { transform: rotate(135deg) translateX(11px) rotate(-135deg); opacity: 0.45; }
      50%  { opacity: 1; }
      100% { transform: rotate(495deg) translateX(11px) rotate(-495deg); opacity: 0.45; }
    }
    @media (prefers-reduced-motion: reduce) {
      .nx-ps-status-dot, .nx-ps-orbit,
      .nx-ps-status-dot::before, .nx-ps-status-dot::after { animation: none !important; }
    }

    /* ─── STATUS-CHANGE SHEET ────────────────────────────────────
       Bottom-sheet that opens when the beacon is tapped. Lets a
       contractor at the unit pick what was done, then writes
       equipment.status + a maintenance log entry. */
    .nx-ps-status-sheet-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      pointer-events: none;
    }
    .nx-ps-status-sheet-bg {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      opacity: 0;
      pointer-events: auto;
      transition: opacity 200ms ease;
    }
    .nx-ps-status-sheet-overlay.is-open .nx-ps-status-sheet-bg { opacity: 1; }
    .nx-ps-status-sheet {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      background: var(--ps-bg);
      color: var(--ps-text);
      border-top: 1px solid var(--ps-border-strong);
      border-radius: 18px 18px 0 0;
      padding: 8px 18px calc(env(safe-area-inset-bottom, 0px) + 18px);
      max-height: 88vh;
      overflow-y: auto;
      transform: translateY(100%);
      transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
      pointer-events: auto;
      box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.45);
    }
    .nx-ps-status-sheet-overlay.is-open .nx-ps-status-sheet { transform: translateY(0); }
    .nx-ps-status-sheet-handle {
      width: 40px; height: 4px;
      background: var(--ps-border-strong);
      border-radius: 999px;
      margin: 8px auto 16px;
    }
    .nx-ps-status-sheet-title {
      font-family: 'Outfit', sans-serif;
      font-size: 19px;
      font-weight: 700;
      color: var(--ps-text);
      margin-bottom: 2px;
    }
    .nx-ps-status-sheet-sub {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: var(--ps-faint);
      margin-bottom: 18px;
    }

    /* State group */
    .nx-ps-status-sheet-group {
      margin-bottom: 14px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--ps-border);
    }
    .nx-ps-status-sheet-group:last-of-type { border-bottom: 0; }
    .nx-ps-status-sheet-group-head {
      margin: 4px 0 8px;
    }
    .nx-ps-status-sheet-group-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 11px;
      border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      border: 1px solid var(--ps-border-strong);
      background: rgba(212, 164, 78, 0.06);
      color: var(--ps-accent);
    }
    .nx-ps-status-sheet-group-dot {
      width: 7px; height: 7px;
      background: #d4a44e;
      border-radius: 50%;
      box-shadow: 0 0 4px rgba(212,164,78,0.7);
    }
    .nx-ps-status-sheet-group-pill.is-down .nx-ps-status-sheet-group-dot { background: #5a4a30; box-shadow: none; }

    /* Selectable row */
    .nx-ps-status-sheet-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 14px;
      margin-bottom: 6px;
      background: var(--ps-surface);
      border: 1px solid var(--ps-border);
      border-radius: 10px;
      color: var(--ps-text);
      font-family: 'Outfit', sans-serif;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      text-align: left;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .nx-ps-status-sheet-row:hover {
      background: var(--ps-elevated);
      border-color: var(--ps-border-strong);
    }
    .nx-ps-status-sheet-row.is-selected {
      background: rgba(212, 164, 78, 0.18);
      border-color: var(--ps-accent);
      box-shadow: 0 0 0 2px rgba(212, 164, 78, 0.20);
    }
    .nx-ps-status-sheet-row-text { flex: 1; min-width: 0; }
    .nx-ps-status-sheet-row-label {
      font-size: 14.5px;
      font-weight: 600;
      color: var(--ps-text);
      margin-bottom: 2px;
    }
    .nx-ps-status-sheet-row-hint {
      font-size: 12px;
      color: var(--ps-faint);
    }
    .nx-ps-status-sheet-row-check {
      width: 22px; height: 22px;
      border-radius: 50%;
      border: 1.5px solid var(--ps-border-strong);
      flex-shrink: 0;
      position: relative;
      transition: background 120ms, border-color 120ms;
    }
    .nx-ps-status-sheet-row.is-selected .nx-ps-status-sheet-row-check {
      background: var(--ps-accent);
      border-color: var(--ps-accent);
    }
    .nx-ps-status-sheet-row.is-selected .nx-ps-status-sheet-row-check::after {
      content: '';
      position: absolute;
      top: 5px; left: 8px;
      width: 5px; height: 9px;
      border-right: 2px solid #fff;
      border-bottom: 2px solid #fff;
      transform: rotate(45deg);
    }

    /* Notes + actions */
    .nx-ps-status-sheet-notes-label {
      display: block;
      margin: 16px 0 6px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: var(--ps-faint);
    }
    .nx-ps-status-sheet-notes {
      width: 100%;
      padding: 10px 12px;
      background: var(--ps-surface);
      border: 1px solid var(--ps-border-strong);
      border-radius: 10px;
      color: var(--ps-text);
      font-family: 'Outfit', sans-serif;
      font-size: 14px;
      resize: vertical;
      min-height: 70px;
    }
    .nx-ps-status-sheet-notes:focus {
      outline: none;
      border-color: var(--ps-accent);
    }
    .nx-ps-status-sheet-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }
    .nx-ps-status-sheet-cancel,
    .nx-ps-status-sheet-confirm {
      flex: 1;
      padding: 14px 16px;
      border-radius: 12px;
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background 140ms ease, transform 100ms ease;
    }
    .nx-ps-status-sheet-cancel {
      background: transparent;
      border: 1px solid var(--ps-border-strong);
      color: var(--ps-text);
    }
    .nx-ps-status-sheet-cancel:hover { background: var(--ps-surface); }
    .nx-ps-status-sheet-confirm {
      background: linear-gradient(135deg, #d4a44e 0%, #8b6914 100%);
      border: 0;
      color: #1a1408;
      box-shadow: 0 6px 18px -4px rgba(212, 164, 78, 0.45);
    }
    .nx-ps-status-sheet-confirm:disabled {
      background: var(--ps-elevated);
      color: var(--ps-faint);
      box-shadow: none;
      cursor: not-allowed;
    }
    .nx-ps-status-sheet-confirm:not(:disabled):active { transform: scale(0.97); }

    /* Soft success toast after save */
    .nx-ps-status-toast {
      position: fixed;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
      transform: translateX(-50%) translateY(40px);
      padding: 11px 18px;
      background: rgba(28, 20, 8, 0.92);
      color: #d4a44e;
      border: 1px solid rgba(212, 164, 78, 0.4);
      border-radius: 999px;
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 10001;
      opacity: 0;
      transition: opacity 220ms ease, transform 220ms ease;
      box-shadow: 0 8px 28px rgba(0,0,0,0.5);
      pointer-events: none;
    }
    .nx-ps-status-toast.is-on {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
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
      background: linear-gradient(135deg, var(--accent) 0%, var(--nx-gold-deep) 100%);
      border-color: transparent;
      box-shadow: 0 6px 20px -4px rgba(212, 164, 78, 0.4),
                  0 1px 0 0 rgba(255, 230, 180, 0.18) inset;
      padding: 17px 18px;
    }
    .nx-ps-btn-primary .nx-ps-btn-icon-wrap {
      background: rgba(26, 20, 8, 0.16);
    }
    .nx-ps-btn-primary .nx-ps-btn-icon-wrap svg { color: var(--nx-gold-on); }
    .nx-ps-btn-primary .nx-ps-btn-title { color: var(--nx-gold-on); font-size: 15px; font-weight: 700; }
    .nx-ps-btn-primary .nx-ps-btn-sub   { color: rgba(26, 20, 8, 0.68); }
    .nx-ps-btn-primary .nx-ps-btn-arrow { color: rgba(26, 20, 8, 0.55); }

    /* Secondary (call) — accent tint */
    .nx-ps-btn-call .nx-ps-btn-icon-wrap { background: rgba(212, 182, 138, 0.1); }
    .nx-ps-btn-call .nx-ps-btn-icon-wrap svg { color: var(--ps-accent); }

    /* Email vendor — same accent family as call */
    .nx-ps-btn-email .nx-ps-btn-icon-wrap { background: rgba(212, 182, 138, 0.1); }
    .nx-ps-btn-email .nx-ps-btn-icon-wrap svg { color: var(--ps-accent); }

    /* Issue — subtle red tint, not aggressive */
    .nx-ps-btn-issue .nx-ps-btn-icon-wrap { background: rgba(168, 62, 62, 0.1); }
    .nx-ps-btn-issue .nx-ps-btn-icon-wrap svg { color: var(--red); }

    /* Login — neutral */
    .nx-ps-btn-login { background: transparent; }
    .nx-ps-btn-login .nx-ps-btn-icon-wrap { background: rgba(212, 182, 138, 0.05); }
    .nx-ps-btn-login .nx-ps-btn-icon-wrap svg { color: var(--ps-muted); }
    .nx-ps-btn-login .nx-ps-btn-title { color: var(--ps-muted); }

    /* SERVICED BY — surfaces the assigned contractor + their specialty
       tags right on the public scan page. Phone tap-to-call lives
       inside this block when phone is set, so the user sees who
       handles this unit + how to reach them in one grouped surface. */
    .nx-ps-serviced-by {
      margin: 8px 0 4px;
      padding: 14px 16px;
      background: rgba(212, 182, 138, 0.06);
      border: 1px solid rgba(212, 182, 138, 0.22);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .nx-ps-serviced-by-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: var(--ps-accent);
    }
    .nx-ps-serviced-by-name {
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 17px;
      font-weight: 600;
      color: var(--ps-text);
      line-height: 1.2;
    }
    .nx-ps-serviced-by-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: -2px;
    }
    .nx-ps-serviced-by-tag {
      display: inline-flex;
      align-items: center;
      padding: 3px 9px;
      border: 1px solid rgba(212, 182, 138, 0.3);
      border-radius: 999px;
      font-size: 11px;
      color: var(--ps-muted);
      text-transform: lowercase;
      letter-spacing: 0.02em;
    }
    .nx-ps-serviced-by-call {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      align-self: flex-start;
      padding: 9px 16px;
      margin-top: 4px;
      background: var(--ps-accent);
      border: 1px solid var(--ps-accent);
      border-radius: 999px;
      color: var(--nx-gold-on, #1a1408);
      text-decoration: none;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      -webkit-tap-highlight-color: transparent;
      transition: transform 120ms ease;
    }
    .nx-ps-serviced-by-call:active { transform: scale(0.96); }
    .nx-ps-serviced-by-call svg { color: var(--nx-gold-on, #1a1408); }

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
      color: var(--nx-gold-on);
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
      color: var(--nx-gold-on);
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
      color: var(--nx-gold-on);
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
      color: var(--red);
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
      color: var(--red);
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
    // Try the full select. If it errors (e.g. a column doesn't exist
    // because someone hasn't run migrations), fall back to a minimal
    // select that only requests columns guaranteed to exist.
    //
    // Supabase JS DOES NOT throw on schema errors — it returns
    // {data: null, error: {...}} — so we check error explicitly. The
    // previous try/catch never fired and silently broke the page.
    let eq, eqErr;
    const FULL = 'id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code, service_contractor_phone, service_contractor_name, service_contractor_node_id, repair_contractor_phone, repair_contractor_name, repair_contractor_node_id';
    const NO_REPAIR = 'id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code, service_contractor_phone, service_contractor_name, service_contractor_node_id';
    const MINIMAL = 'id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code';
    const fullRes = await sb.from('equipment').select(FULL).eq('qr_code', qr).single();
    if (fullRes.error && /column.+repair_contractor.+does not exist/i.test(fullRes.error.message || '')) {
      // Pre-migration: fall back to legacy columns only.
      const r = await sb.from('equipment').select(NO_REPAIR).eq('qr_code', qr).single();
      eq = r.data; eqErr = r.error;
    } else if (fullRes.error && /column.+does not exist/i.test(fullRes.error.message || '')) {
      console.warn('[scan] full select failed (column missing), falling back to minimal select:', fullRes.error.message);
      const minRes = await sb.from('equipment').select(MINIMAL).eq('qr_code', qr).single();
      eq = minRes.data; eqErr = minRes.error;
    } else {
      eq = fullRes.data; eqErr = fullRes.error;
    }
    if (eqErr || !eq) throw new Error(eqErr?.message || 'Equipment not registered');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    // Choose which contractor to pull. The QR scan defaults to the
    // REPAIR contractor (staff scan because something is broken). Fall
    // back to the maintenance/service contractor only if no repair
    // contractor is set on the equipment.
    const preferredContractorNodeId = eq.repair_contractor_node_id || eq.service_contractor_node_id || null;
    const usingRepair = !!eq.repair_contractor_node_id;
    const [ticketRes, maintRes, contractorRes, issueRes] = await Promise.all([
      sb.from('tickets')
        .select('id, title, created_at, reported_by, priority, status')
        .eq('equipment_id', eq.id)
        .eq('status', 'open')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(1),
      sb.from('equipment_maintenance')
        .select('event_type, event_date, description, performed_by')
        .eq('equipment_id', eq.id)
        .order('event_date', { ascending: false })
        .limit(4),
      preferredContractorNodeId
        ? sb.from('nodes').select('id, name, notes, tags, links')
            .eq('id', preferredContractorNodeId).maybeSingle()
        : Promise.resolve({ data: null }),
      // Open work order (equipment_issues) for this unit — catches a
      // staff-raised issue that has no ticket, so "Complete Work Order"
      // shows whenever there is genuinely open work, not only ticket-backed.
      sb.from('equipment_issues')
        .select('id, status')
        .eq('equipment_id', eq.id)
        .not('status', 'in', '(repaired,closed,resolved)')
        .order('reported_at', { ascending: false })
        .limit(1),
    ]);

    // Build contact object — also exposes specialty tags ("duties") so
    // the scan page can show what the contractor handles, and the
    // contractor name standalone so we render even without a phone.
    // Resolution order matches preferredContractorNodeId above:
    //   1. repair_contractor_phone (plain-text, repair side)
    //   2. linked repair contractor node (multi-phone, multi-email)
    //   3. service_contractor_phone (plain-text, maintenance fallback)
    //   4. linked service contractor node (maintenance fallback)
    let contact = null;
    const repairPhone  = eq.repair_contractor_phone  || '';
    const repairName   = eq.repair_contractor_name   || '';
    const servicePhone = eq.service_contractor_phone || '';
    const serviceName  = eq.service_contractor_name  || '';

    if (repairPhone) {
      contact = {
        name: repairName || (usingRepair && contractorRes?.data?.name) || 'Repair',
        phone: repairPhone,
        phoneHref: telHref(repairPhone),
        tags: [],
      };
      if (usingRepair && contractorRes?.data) {
        const node = contractorRes.data;
        contact.tags = Array.isArray(node.tags) ? node.tags.filter(Boolean) : [];
        contact.contractorId = node.id;
      }
    } else if (usingRepair && contractorRes?.data) {
      const node = contractorRes.data;
      const links = node.links || {};
      let phone = links.phone || '';
      if (!phone) {
        const text = (node.notes || '') + ' ' + JSON.stringify(node.tags || []) + ' ' + (node.name || '');
        const m = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (m) phone = m[0].trim();
      }
      const tags = Array.isArray(node.tags) ? node.tags.filter(Boolean) : [];
      if (phone || tags.length || node.name) {
        contact = {
          name: node.name || 'Repair',
          phone,
          phoneHref: phone ? telHref(phone) : '',
          tags,
          contractorId: node.id,
        };
      }
    } else if (servicePhone) {
      contact = {
        name: serviceName || 'Service',
        phone: servicePhone,
        phoneHref: telHref(servicePhone),
        tags: [],
      };
      if (!usingRepair && contractorRes?.data) {
        const node = contractorRes.data;
        contact.tags = Array.isArray(node.tags) ? node.tags.filter(Boolean) : [];
        contact.contractorId = node.id;
      }
    } else if (!usingRepair && contractorRes?.data) {
      const node = contractorRes.data;
      const links = node.links || {};
      let phone = links.phone || '';
      if (!phone) {
        const text = (node.notes || '') + ' ' + JSON.stringify(node.tags || []) + ' ' + (node.name || '');
        const m = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (m) phone = m[0].trim();
      }
      const tags = Array.isArray(node.tags) ? node.tags.filter(Boolean) : [];
      if (phone || tags.length || node.name) {
        contact = {
          name: node.name || 'Service',
          phone,
          phoneHref: phone ? telHref(phone) : '',
          tags,
          contractorId: node.id,
        };
      }
    }

    // Emails ride along whenever a contractor NODE was resolved, regardless of
    // which branch above built the contact (plain-text phone branches still
    // have the linked node's emails available). Same extraction shape as the
    // staff side: structured {email, role} entries in links, then a regex
    // sweep of string links and notes. Powers the "Email <vendor>" action.
    if (contact && contractorRes?.data) {
      const node = contractorRes.data;
      const out = []; const seen = new Set();
      const addEm = (email, role) => {
        const norm = String(email || '').trim().toLowerCase();
        if (!norm || !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(norm) || seen.has(norm)) return;
        seen.add(norm); out.push({ email: norm, role: role || 'to' });
      };
      const links = Array.isArray(node.links) ? node.links : (node.links ? [node.links] : []);
      for (const l of links) {
        if (l && typeof l === 'object' && l.email) { addEm(l.email, l.role); continue; }
        const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
        const m = str.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (m) addEm(m[0], 'to');
      }
      (String(node.notes || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach(m => addEm(m, 'to'));
      contact.emails = out;
    }

    return {
      eq,
      activeTicket: (ticketRes.data || [])[0] || null,
      activeIssue: (issueRes.data || [])[0] || null,
      maint: maintRes.data || [],
      contact,
    };
  }

  // ─── 9. RENDER SCAN PAGE ────────────────────────────────────────────
  function renderScan({ eq, activeTicket, activeIssue, maint, contact }) {
    // Palette-coherent status colors — no greens, no scarlets.
    // Olive-bronze for operational (settled), gold for needs_service
    // (= brand accent, "look at me"), oxblood for down (authoritative,
    // not panicked), graphite for retired.
    const statusMap = {
      operational:   { label: 'Operational',   color: 'var(--green)' },
      needs_service: { label: 'Needs Service', color: 'var(--accent)' },
      down:          { label: 'Down',          color: 'var(--red)' },
      retired:       { label: 'Retired',       color: 'var(--faint)' },
    };
    const status = statusMap[eq.status] || { label: eq.status || 'Unknown', color: 'var(--faint)' };

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

    // SERVICED BY block — surfaces the contractor + a tap-to-call CTA.
    // Specialty tags ("hvac", "ac", "lowboy") were removed in v15.4 —
    // the contractor's name is enough at a glance, and the chips
    // crowded an already-busy card. The big Call button below the
    // actions list now carries the phone CTA.
    const servicedByHTML = contact ? `
      <div class="nx-ps-serviced-by">
        <div class="nx-ps-serviced-by-label">Serviced by</div>
        <div class="nx-ps-serviced-by-name">${esc(contact.name)}</div>
      </div>
    ` : '';

    // Big Call button at the top of actions — same prominence as
    // Log Service. Always shown when a contractor phone exists.
    const callBtnHTML = (contact && contact.phone) ? `
      <button class="nx-ps-btn nx-ps-btn-call" data-action="call">
        <div class="nx-ps-btn-icon-wrap">${icon('phone')}</div>
        <div class="nx-ps-btn-label">
          <div class="nx-ps-btn-title">Call ${esc(contact.name)}</div>
          <div class="nx-ps-btn-sub">${esc(contact.phone)}</div>
        </div>
        <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
      </button>
    ` : '';

    // Email the vendor — restores the composer that the old scan page had.
    // Shown whenever the contractor has an email on file; opens the shared
    // NX.composeEmail engine (editable To/CC/BCC, recipients persist per
    // vendor) prefilled with a service request for THIS unit.
    const primaryEmail = (contact && contact.emails && contact.emails.length)
      ? (contact.emails.find(e => e.role === 'to') || contact.emails[0]).email : '';
    const emailBtnHTML = primaryEmail ? `
      <button class="nx-ps-btn nx-ps-btn-email" data-action="email">
        <div class="nx-ps-btn-icon-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
        <div class="nx-ps-btn-label">
          <div class="nx-ps-btn-title">Email ${esc(contact.name)}</div>
          <div class="nx-ps-btn-sub">${esc(primaryEmail)}${contact.emails.length > 1 ? ' +' + (contact.emails.length - 1) : ''}</div>
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
            <button class="nx-ps-status" data-action="status-change" type="button" aria-label="Change equipment status">
              <span class="nx-ps-status-dot is-${esc(eq.status || 'operational')}" aria-hidden="true">
                <span class="nx-ps-orbit nx-ps-orbit-fore"></span>
                <span class="nx-ps-orbit nx-ps-orbit-back"></span>
              </span>
              <span class="nx-ps-status-label">${esc(status.label)}</span>
              <span class="nx-ps-status-edit-hint">tap to change</span>
            </button>
            ${banners.join('')}
            <div class="nx-ps-specs">
              <div><div class="nx-ps-spec-label">Manufacturer</div><div class="nx-ps-spec-val">${esc(eq.manufacturer || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Model</div><div class="nx-ps-spec-val">${esc(eq.model || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Serial Number</div><div class="nx-ps-spec-val">${esc(eq.serial_number || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Installed</div><div class="nx-ps-spec-val">${installStr}</div></div>
              <div><div class="nx-ps-spec-label">Warranty</div><div class="nx-ps-spec-val ${warrantyValid ? '' : 'dim'}"><span class="nx-ps-warranty${warrantyValid ? ' is-active' : ''}" title="${esc(warrantyValid ? ('Under warranty until ' + warranty.toLocaleDateString()) : (warranty ? 'Warranty expired ' + warranty.toLocaleDateString() : 'No warranty on file'))}" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12">${warrantyValid ? '<path d="M12 2.2l7 2.8v6c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9v-6l7-2.8z" fill="currentColor"/><path d="M8.8 12.1l2.1 2.1 4.3-4.5" fill="none" stroke="#0e1320" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M12 2.2l7 2.8v6c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9v-6l7-2.8z" fill="none" stroke="currentColor" stroke-width="1.5"/>'}</svg></span> ${warrantyStr}</div></div>
              <div><div class="nx-ps-spec-label">Next PM</div><div class="nx-ps-spec-val ${pmOverdue ? '' : 'dim'}">${pmStr}</div></div>
            </div>
            ${historyHTML}
            ${servicedByHTML}
            ${(() => {
              // v18.30 — at-a-glance maintenance health on the scan landing.
              // Countdown from the equipment's next PM (+ inspection/deep-clean
              // next dates if present). Self-contained inline styles so it
              // renders regardless of which stylesheet the public page loaded.
              const bars = [];
              const add = (label, nextIso) => {
                if (!nextIso) return;
                const next = new Date(String(nextIso).slice(0, 10) + 'T00:00:00');
                if (isNaN(next)) return;
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const days = Math.round((next - today) / 86400000);
                const overdue = days < 0;
                const color = overdue ? '#d24b4b' : (days < 14 ? '#d4a44e' : '#3fa08f');
                const pct = overdue ? 100 : Math.max(6, Math.min(100, Math.round((days / 90) * 100)));
                const lab = overdue ? (Math.abs(days) + 'd overdue') : (days + 'd');
                bars.push(`<div style="display:flex;align-items:center;gap:8px;margin-top:7px"><span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#9aa3b2;width:62px;flex-shrink:0">${label}</span><div style="flex:1;height:5px;border-radius:3px;background:rgba(212,164,78,0.14);overflow:hidden"><div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div></div><span style="font-family:'JetBrains Mono',monospace;font-size:9.5px;color:${color};width:78px;text-align:right;flex-shrink:0">${lab}</span></div>`);
              };
              add('PM', eq.next_pm_date);
              add('Inspection', eq.next_inspection_date);
              add('Deep clean', eq.next_deep_clean_date);
              if (!bars.length) return '';
              return `<div class="nx-ps-health" style="margin:14px 0 0;padding:13px 14px;background:rgba(212,164,78,0.06);border:1px solid rgba(212,164,78,0.22);border-radius:14px"><div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:#d4a44e;margin-bottom:4px">Maintenance health</div>${bars.join('')}</div>`;
            })()}
            <div class="nx-ps-actions">
              ${(activeTicket || activeIssue) ? `
              <button class="nx-ps-btn nx-ps-btn-primary nx-ps-btn-complete" data-action="complete-wo">
                <div class="nx-ps-btn-icon-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Complete Issue</div>
                  <div class="nx-ps-btn-sub">Mark this job done — closes the card</div>
                </div>
                <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
              </button>` : ''}
              ${callBtnHTML}
              ${emailBtnHTML}
              <button class="nx-ps-btn nx-ps-btn-primary" data-action="log-service">
                <div class="nx-ps-btn-icon-wrap">${icon('wrench')}</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Log Service</div>
                  <div class="nx-ps-btn-sub">Contractors — no login needed</div>
                </div>
                <div class="nx-ps-btn-arrow">${icon('chevronRight', 16)}</div>
              </button>
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
      if (action === 'complete-wo') {
        if (btn.dataset.busy) return;
        btn.dataset.busy = '1';
        const titleEl = btn.querySelector('.nx-ps-btn-title');
        const prevTitle = titleEl ? titleEl.textContent : '';
        if (titleEl) titleEl.textContent = 'Completing…';
        const done = ok => {
          if (ok) { location.reload(); return; }
          if (titleEl) titleEl.textContent = prevTitle;
          delete btn.dataset.busy;
          alert('Could not complete the work order. Please try again.');
        };
        const api = window.NX && NX.work && NX.work.fulfillForEquipment;
        if (!api) { console.error('[scan] NX.work not loaded'); done(false); return; }
        Promise.resolve(NX.work.fulfillForEquipment({ equipmentId: eq.id, performedBy: 'QR scan' }))
          .then(res => done(!!(res && res.ok)))
          .catch(err => { console.error('[scan] complete-wo failed:', err); done(false); });
      } else if (action === 'log-service') {
        const fn = window._NX_PUBLIC_PM_OPEN;
        if (fn) fn(eq.qr_code);
        else alert('PM Logger not loaded');
      } else if (action === 'call' || action === 'call-direct') {
        // Prevent the raw <a href="tel:"> default — we want the issue
        // modal to capture context FIRST, then dial. Same audit trail
        // whether the user tapped the standalone Call CTA or the call
        // chip embedded in the SERVICED BY block.
        e.preventDefault();
        openIssueModal(eq, { mode: 'call', contact });
      } else if (action === 'email') {
        // Compose a service-request email to the vendor. Prefer the shared
        // composer engine (editable To/CC/BCC, recipients remembered per
        // vendor); degrade to a plain mailto: draft if it isn't loaded.
        e.preventDefault();
        const ems = (contact && contact.emails) || [];
        const tos  = ems.filter(x => x.role === 'to' || !x.role).map(x => x.email);
        const ccs  = ems.filter(x => x.role === 'cc').map(x => x.email);
        const bccs = ems.filter(x => x.role === 'bcc').map(x => x.email);
        const to = tos[0] || (ems[0] && ems[0].email) || '';
        const subject = `Service request — ${eq.name}${eq.location ? ' at ' + eq.location : ''}`;
        const body =
`Hi${contact && contact.name ? ' ' + contact.name : ''},

We need service on the following equipment:

  ${eq.name}
  Location: ${eq.location || ''}${eq.area ? ' · ' + eq.area : ''}
${eq.manufacturer || eq.model ? `  Unit: ${[eq.manufacturer, eq.model].filter(Boolean).join(' ')}\n` : ''}${eq.serial_number ? `  Serial: ${eq.serial_number}\n` : ''}
Please let us know your earliest availability.

Thanks.`;
        if (window.NX && typeof NX.composeEmail === 'function') {
          NX.composeEmail({
            recipientsKey: 'vendor:' + ((contact && contact.contractorId) || (contact && contact.name) || 'unknown'),
            to, cc: ccs, bcc: bccs, subject, body,
            title: 'Email ' + ((contact && contact.name) || 'vendor'),
          });
        } else {
          const enc = s => encodeURIComponent(s || '').replace(/\+/g, '%20');
          const params = [`subject=${enc(subject)}`, `body=${enc(body)}`];
          if (ccs.length)  params.push(`cc=${enc(ccs.join(','))}`);
          if (bccs.length) params.push(`bcc=${enc(bccs.join(','))}`);
          window.location.href = `mailto:${enc(to)}?${params.join('&')}`;
        }
      } else if (action === 'report') {
        openIssueModal(eq, { mode: 'report' });
      } else if (action === 'login') {
        window.location.href = loginUrl;
      } else if (action === 'status-change') {
        openStatusChangeSheet(eq, sb);
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
  // ─── 9.5  STATUS CHANGE SHEET — bottom-sheet that lets a contractor
  // at the unit update its current status. Tapped from the beacon at
  // the top of the scan card. Writes equipment.status + an
  // equipment_maintenance log entry so the change is auditable.
  //
  // Each option maps to a target equipment.status:
  //    operational  → "Repaired", "Serviced", "Cleaned"
  //    needs_service→ "Waiting on parts (functional)", "Service scheduled", "Performance degraded"
  //    down         → "Waiting on parts (down)", "Awaiting contractor", "Out of service"
  //
  // Optional notes textarea + Confirm button. After save, the page
  // re-renders the beacon to reflect the new state.
  function openStatusChangeSheet(eq, sb) {
    // Define the status options grouped by target state. Each row
    // carries the human label, the target status, and a short hint.
    const OPTIONS = [
      // OPERATIONAL — back to working
      { key: 'repaired',     label: 'Repaired',                target: 'operational',   hint: 'Back to full working order' },
      { key: 'serviced',     label: 'Serviced',                target: 'operational',   hint: 'Routine maintenance done' },
      { key: 'cleaned',      label: 'Cleaned & restored',      target: 'operational',   hint: 'Cleaned, back in service' },
      // NEEDS SERVICE — degraded but functional
      { key: 'parts_func',   label: 'Waiting on parts (still functional)', target: 'needs_service', hint: 'Works but degraded — parts on order' },
      { key: 'svc_sched',    label: 'Service scheduled',       target: 'needs_service', hint: 'Service appt booked' },
      { key: 'degraded',     label: 'Performance degraded',    target: 'needs_service', hint: 'Working but underperforming' },
      // DOWN — not functional
      { key: 'parts_down',   label: 'Waiting on parts (down)', target: 'down',          hint: 'Not working — parts on order' },
      { key: 'await_contr',  label: 'Awaiting contractor',     target: 'down',          hint: 'Need someone to come look' },
      { key: 'out_of_svc',   label: 'Out of service',          target: 'down',          hint: 'Cannot use until further notice' },
    ];

    // Build the sheet
    const sheet = document.createElement('div');
    sheet.className = 'nx-ps-status-sheet-overlay';
    sheet.innerHTML = `
      <div class="nx-ps-status-sheet-bg" data-action="close-sheet"></div>
      <div class="nx-ps-status-sheet">
        <div class="nx-ps-status-sheet-handle"></div>
        <div class="nx-ps-status-sheet-title">Update status</div>
        <div class="nx-ps-status-sheet-sub">${esc(eq.name)} — what's been done?</div>

        <div class="nx-ps-status-sheet-group" data-group="operational">
          <div class="nx-ps-status-sheet-group-head">
            <span class="nx-ps-status-sheet-group-pill is-operational">
              <span class="nx-ps-status-sheet-group-dot"></span> Operational
            </span>
          </div>
          ${OPTIONS.filter(o => o.target === 'operational').map(o => `
            <button class="nx-ps-status-sheet-row" type="button" data-status-key="${esc(o.key)}" data-status-target="${esc(o.target)}" data-status-label="${esc(o.label)}">
              <div class="nx-ps-status-sheet-row-text">
                <div class="nx-ps-status-sheet-row-label">${esc(o.label)}</div>
                <div class="nx-ps-status-sheet-row-hint">${esc(o.hint)}</div>
              </div>
              <span class="nx-ps-status-sheet-row-check"></span>
            </button>
          `).join('')}
        </div>

        <div class="nx-ps-status-sheet-group" data-group="needs_service">
          <div class="nx-ps-status-sheet-group-head">
            <span class="nx-ps-status-sheet-group-pill is-needs-service">
              <span class="nx-ps-status-sheet-group-dot"></span> Needs Service
            </span>
          </div>
          ${OPTIONS.filter(o => o.target === 'needs_service').map(o => `
            <button class="nx-ps-status-sheet-row" type="button" data-status-key="${esc(o.key)}" data-status-target="${esc(o.target)}" data-status-label="${esc(o.label)}">
              <div class="nx-ps-status-sheet-row-text">
                <div class="nx-ps-status-sheet-row-label">${esc(o.label)}</div>
                <div class="nx-ps-status-sheet-row-hint">${esc(o.hint)}</div>
              </div>
              <span class="nx-ps-status-sheet-row-check"></span>
            </button>
          `).join('')}
        </div>

        <div class="nx-ps-status-sheet-group" data-group="down">
          <div class="nx-ps-status-sheet-group-head">
            <span class="nx-ps-status-sheet-group-pill is-down">
              <span class="nx-ps-status-sheet-group-dot"></span> Down
            </span>
          </div>
          ${OPTIONS.filter(o => o.target === 'down').map(o => `
            <button class="nx-ps-status-sheet-row" type="button" data-status-key="${esc(o.key)}" data-status-target="${esc(o.target)}" data-status-label="${esc(o.label)}">
              <div class="nx-ps-status-sheet-row-text">
                <div class="nx-ps-status-sheet-row-label">${esc(o.label)}</div>
                <div class="nx-ps-status-sheet-row-hint">${esc(o.hint)}</div>
              </div>
              <span class="nx-ps-status-sheet-row-check"></span>
            </button>
          `).join('')}
        </div>

        <label class="nx-ps-status-sheet-notes-label">Notes (optional)</label>
        <textarea class="nx-ps-status-sheet-notes" id="nxPsStatusNotes" rows="3" placeholder="Anything else — names, part numbers, ETA…" maxlength="500"></textarea>

        <div class="nx-ps-status-sheet-actions">
          <button class="nx-ps-status-sheet-cancel" type="button" data-action="close-sheet">Cancel</button>
          <button class="nx-ps-status-sheet-confirm" type="button" disabled id="nxPsStatusConfirm">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('is-open'));

    let selectedKey = null;
    let selectedTarget = null;
    let selectedLabel = null;

    const close = () => {
      sheet.classList.remove('is-open');
      setTimeout(() => sheet.remove(), 200);
    };

    sheet.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-action="close-sheet"]')) { close(); return; }
      const row = t.closest('[data-status-key]');
      if (row) {
        // Visually toggle: clear all, set this one
        sheet.querySelectorAll('.nx-ps-status-sheet-row').forEach(r => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
        selectedKey    = row.dataset.statusKey;
        selectedTarget = row.dataset.statusTarget;
        selectedLabel  = row.dataset.statusLabel;
        const confirm = sheet.querySelector('#nxPsStatusConfirm');
        if (confirm) {
          confirm.disabled = false;
          confirm.textContent = `Confirm: ${selectedLabel}`;
        }
        return;
      }
      if (t.closest('#nxPsStatusConfirm')) {
        if (!selectedTarget) return;
        const notes = (sheet.querySelector('#nxPsStatusNotes') || {}).value || '';
        const confirmBtn = sheet.querySelector('#nxPsStatusConfirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving…';
        try {
          // 1. Update equipment.status
          const { error: updErr } = await sb.from('equipment')
            .update({ status: selectedTarget })
            .eq('id', eq.id);
          if (updErr) throw updErr;

          // 2. Write a maintenance log entry — auditable trail of who
          // changed status to what, when. event_type 'status_change'
          // distinguishes these from regular service/PM events.
          const { error: logErr } = await sb.from('equipment_maintenance').insert({
            equipment_id: eq.id,
            event_type: 'status_change',
            description: `${selectedLabel}${notes ? ' — ' + notes.trim() : ''}`,
            performed_by: 'QR scan',
            event_date: new Date().toISOString(),
          });
          if (logErr) {
            // Status update succeeded; log entry failed. Not fatal —
            // user might be on a database without the trigger / table
            // permissions. Surface a softer warning rather than
            // rolling back.
            console.warn('[scan] maint log failed:', logErr);
          }

          // 3. Update the in-memory eq + re-render the beacon dot
          //    in place so the user sees the new state immediately.
          eq.status = selectedTarget;
          const dot = document.querySelector('.nx-ps-status-dot');
          if (dot) {
            dot.className = `nx-ps-status-dot is-${selectedTarget}`;
          }
          // Update the visible label too (status.label was computed
          // earlier; we'll uppercase the target for now).
          const lbl = document.querySelector('.nx-ps-status-label');
          if (lbl) lbl.textContent = selectedTarget.replace(/_/g, ' ').toUpperCase();

          close();
          // Soft success indicator — temporary toast
          const toast = document.createElement('div');
          toast.className = 'nx-ps-status-toast';
          toast.textContent = `✓ Status updated: ${selectedLabel}`;
          document.body.appendChild(toast);
          requestAnimationFrame(() => toast.classList.add('is-on'));
          setTimeout(() => {
            toast.classList.remove('is-on');
            setTimeout(() => toast.remove(), 250);
          }, 2400);
        } catch (err) {
          console.error('[scan] status update failed:', err);
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Save failed — try again`;
        }
      }
    });
  }

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
        <textarea class="nx-ps-modal-textarea" id="nxRepDesc" maxlength="1000" placeholder="What's wrong? When did it start? Any error codes or unusual sounds?"></textarea>

        <!-- v18.24 — Photo of the issue. Optional but high-signal; a single
             photo of an error display, leak, or broken part is worth a
             paragraph of description. Camera capture preference set so
             mobile defaults to the rear lens. -->
        <div class="nx-ps-modal-label">Photo of the issue <span style="opacity:0.5">(optional)</span></div>
        <div id="nxRepPhotoWrap" style="display:flex; gap:8px; align-items:flex-start; margin-bottom:10px">
          <button type="button" id="nxRepPhotoBtn" class="nx-ps-modal-btn" style="display:flex; align-items:center; gap:6px; padding:10px 14px; flex:0 0 auto; background:transparent; border:1px dashed rgba(255,255,255,0.15); color:var(--nx-faint,#888); cursor:pointer">
            ${icon('camera', 16)} Add photo
          </button>
          <input type="file" id="nxRepPhotoFile" accept="image/*" capture="environment" hidden>
          <div id="nxRepPhotoPreview" style="display:none; flex:1; max-width:120px"></div>
        </div>

        <div class="nx-ps-modal-label">Priority</div>
        <div class="nx-ps-modal-priority" id="nxRepPri">
          <button type="button" class="nx-ps-modal-pri-btn" data-pri="low">Low</button>
          <button type="button" class="nx-ps-modal-pri-btn active" data-pri="normal">Normal</button>
          <button type="button" class="nx-ps-modal-pri-btn" data-pri="urgent">Urgent</button>
        </div>

        <div class="nx-ps-modal-label">Your name *</div>
        <input class="nx-ps-modal-input" id="nxRepName" maxlength="80" value="${esc(rememberedName)}" placeholder="So staff know who to follow up with">

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

    // v18.24 — Photo selection: file picker → object-URL preview.
    // The actual upload happens during submit so a user who picks but
    // then cancels doesn't leave storage objects behind.
    let pendingPhoto = null;
    const photoBtn     = bg.querySelector('#nxRepPhotoBtn');
    const photoFile    = bg.querySelector('#nxRepPhotoFile');
    const photoPreview = bg.querySelector('#nxRepPhotoPreview');
    photoBtn.addEventListener('click', () => photoFile.click());
    photoFile.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      pendingPhoto = f;
      const url = URL.createObjectURL(f);
      photoPreview.style.display = 'block';
      photoPreview.innerHTML = `
        <div style="position:relative; display:inline-block">
          <img src="${url}" style="width:120px; height:90px; object-fit:cover; border-radius:8px; border:1px solid rgba(255,255,255,0.1)">
          <button type="button" id="nxRepPhotoClear" style="position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:50%; background:#c44; color:#fff; border:0; cursor:pointer; font-size:14px; line-height:1">×</button>
        </div>
      `;
      photoBtn.style.display = 'none';
      photoPreview.querySelector('#nxRepPhotoClear').addEventListener('click', () => {
        pendingPhoto = null;
        photoFile.value = '';
        photoPreview.style.display = 'none';
        photoPreview.innerHTML = '';
        photoBtn.style.display = '';
      });
    });

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
          equipment_id: eq.id,   // v18.24 — link to equipment
        };

        // v18.24 — Upload photo first if one was attached. Upload is
        // fire-and-fail-graceful: a storage error doesn't block the
        // ticket from being created. We just lose the image and surface
        // a console warning.
        let photoUrl = null;
        if (pendingPhoto && pendingPhoto.size <= 12 * 1024 * 1024 && (pendingPhoto.type || '').indexOf('image/') === 0) {
          try {
            send.textContent = 'Uploading photo…';
            const safeName = pendingPhoto.name.replace(/[^a-z0-9.]/gi, '_');
            const path = `tickets/${Date.now()}-${safeName}`;
            const { error: upErr } = await sb.storage
              .from('equipment-attachments')
              .upload(path, pendingPhoto, { upsert: false, contentType: pendingPhoto.type });
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from('equipment-attachments').getPublicUrl(path);
            photoUrl = pub?.publicUrl || null;
            ticketData.photo_url = photoUrl;
          } catch (photoErr) {
            console.warn('[scan] photo upload failed (non-fatal):', photoErr);
          }
        }

        // v18.24 — Severity → equipment status mapping. Save the prior
        // status onto the ticket so closing it can restore.
        //   urgent → 'down'         (red — won't function safely)
        //   normal → 'needs_service' (amber — flag for attention)
        //   low    → no change       (just a tracked observation)
        //
        // Skipped if equipment is already in a more-severe state (don't
        // downgrade a 'down' to 'needs_service' from a normal-priority
        // call). Status hierarchy: down > needs_service > operational.
        if (priority === 'urgent' || priority === 'normal') {
          const desiredStatus = priority === 'urgent' ? 'down' : 'needs_service';
          const currentStatus = eq.status || 'operational';
          const rank = { operational: 0, needs_service: 1, down: 2 };
          const curRank = rank[currentStatus] != null ? rank[currentStatus] : 0;
          const desRank = rank[desiredStatus];
          if (desRank > curRank) {
            ticketData.prior_eq_status = currentStatus;
            try {
              await sb.from('equipment')
                .update({ status: desiredStatus })
                .eq('id', eq.id);
            } catch (statusErr) {
              console.warn('[scan] eq status bump failed (non-fatal):', statusErr);
            }
          }
        }

        send.textContent = isCall ? 'Creating ticket…' : 'Sending…';
        const { data: ticketRow, error } = await sb.from('tickets').insert(ticketData).select().single();
        if (error) throw error;

        // UNIFY — a reported problem is a WORK ORDER, not just a ticket.
        // Create the equipment_issues row so the report shows in "Open WO"
        // and the Work Orders feed (which count equipment_issues), and label
        // the board card with issue:<id> so the card→done cascade and
        // NX.work.fulfillForEquipment recognise it — exactly like a
        // staff-raised issue. Report mode only ([CALL] logs aren't new work
        // orders). Best-effort: on failure we fall back to ticket-only, the
        // prior behaviour. Uses the public `sb` client so it works even in
        // kiosk mode where the full NX app isn't loaded.
        let issueId = null;
        if (!isCall) {
          try {
            const issuePriority = priority === 'urgent' ? 'critical' : priority === 'low' ? 'low' : 'normal';
            const issueSeverity = priority === 'urgent' ? 'high'     : priority === 'low' ? 'low' : 'medium';
            const { data: issueRow, error: issueErr } = await sb.from('equipment_issues').insert({
              equipment_id: eq.id,
              title: `${eq.name}: ${problem.slice(0, 80)}`,
              description: problem,
              status: 'reported',
              priority: issuePriority,
              severity: issueSeverity,
              reported_by_name: reporter,
            }).select('id').single();
            if (issueErr) throw issueErr;
            issueId = issueRow && issueRow.id;
          } catch (issueErr) {
            console.warn('[scan] work-order (equipment_issues) create failed (non-fatal):', issueErr?.message || issueErr);
          }
        }
        const issueLabels = issueId ? [`issue:${issueId}`] : [];

        // v18.24 — Mirror the ticket onto the Operations board as a
        // kanban_card. The two surfaces (Duties ticket list + Board)
        // now stay in sync: same priority, same description, same photo.
        // Cross-link via tickets.board_card_id ↔ kanban_cards.ticket_id.
        // Best-effort — a board-side failure shouldn't crash the ticket
        // flow; the ticket still exists in Duties.
        try {
          // Find the first non-archived board + its first list ("To Do").
          const { data: boards } = await sb.from('boards')
            .select('id').eq('archived', false).order('position').limit(1);
          const boardId = boards?.[0]?.id;
          if (boardId) {
            const { data: lists } = await sb.from('board_lists')
              .select('id').eq('board_id', boardId).order('position').limit(1);
            const listId = lists?.[0]?.id;
            if (listId) {
              // Position = current card count in that list (append to end)
              const { count } = await sb.from('kanban_cards')
                .select('id', { count: 'exact', head: true })
                .eq('list_id', listId);
              const cardData = {
                title: ticketTitle,
                description: notesParts,
                board_id: boardId,
                list_id: listId,
                column_name: '',
                position: count || 0,
                priority,
                location: eq.location || null,
                equipment_id: eq.id,
                reported_by: reporter,
                checklist: [], comments: [], labels: issueLabels,
                photo_urls: photoUrl ? [photoUrl] : [],
                archived: false,
                ticket_id: ticketRow?.id || null,
              };
              const { data: cardRow } = await sb.from('kanban_cards')
                .insert(cardData).select().single();
              // Back-link ticket → card so admin/timeline can navigate either way
              if (cardRow?.id && ticketRow?.id) {
                await sb.from('tickets')
                  .update({ board_card_id: cardRow.id })
                  .eq('id', ticketRow.id);
              }
            }
          }
        } catch (boardErr) {
          console.warn('[scan] board card creation failed (non-fatal):', boardErr);
        }

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
            // No HTML in push titles — phones render notification text as
            // plain text, so the old <i data-lucide=...> markup appeared
            // literally on managers' lock screens.
            const locLabel = eq.location ? ` · ${eq.location.toUpperCase()}` : '';
            sb.functions.invoke('predictive-notify', {
              body: {
                broadcast: {
                  title: `New ticket${locLabel}`,
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
          const logIconName = isCall ? 'phone' : 'wrench';
        const logIcon = `<i data-lucide="${logIconName}"></i>`;
          const logPrefix = isCall ? 'CONTRACTOR CALLED' : 'TICKET';
          const logLoc = eq.location || 'unknown';
          await sb.from('daily_logs').insert({
            user_name: reporter || null,
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
