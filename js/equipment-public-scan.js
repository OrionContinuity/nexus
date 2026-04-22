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

  // Active session? Go to normal app flow.
  try {
    if (sessionStorage.getItem('nexus_current_user') && 
        sessionStorage.getItem('nexus_session_token')) return;
  } catch (e) {}

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

  const CATEGORY_ICONS = {
    refrigeration: '❄', cooking: '🔥', hvac: '🌬', plumbing: '🚰',
    electrical: '⚡', cleaning: '🧽', dishwashing: '🍽',
    beverage: '🥤', bar: '🍸',
  };
  const catIcon = c => CATEGORY_ICONS[(c || '').toLowerCase()] || '🔧';

  // ─── 5. COMPLETE INLINE STYLESHEET (all scan UI styles) ─────────────
  // Fully self-contained — no dependencies on equipment.css or any other file.
  const UI_CSS = `
    .nx-ps-page {
      background: linear-gradient(180deg, #0d0d12 0%, #111118 100%);
      color: #e8e8ea;
      font-family: 'DM Sans', 'Outfit', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 0 0 calc(env(safe-area-inset-bottom, 0px) + 40px);
    }
    .nx-ps-header {
      padding: 20px;
      text-align: center;
      border-bottom: 1px solid rgba(200, 164, 78, 0.15);
    }
    .nx-ps-brand {
      font-family: 'JetBrains Mono', monospace;
      font-size: 20px;
      font-weight: 600;
      color: #c8a44e;
      letter-spacing: 3px;
    }
    .nx-ps-body {
      padding: 20px 16px;
      max-width: 600px;
      margin: 0 auto;
    }
    .nx-ps-card {
      background: #1a1a22;
      border: 1px solid rgba(200, 164, 78, 0.15);
      border-radius: 14px;
      padding: 22px 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    /* Photo / category placeholder */
    .nx-ps-photo {
      width: 100%;
      max-height: 50vh;
      min-height: 220px;
      object-fit: cover;
      border-radius: 12px;
      margin-bottom: 18px;
      background: #15151c;
      display: block;
    }
    .nx-ps-photo-placeholder {
      width: 100%;
      aspect-ratio: 4 / 3;
      min-height: 180px;
      background: linear-gradient(135deg, #15151c, #1f1f28);
      border: 1px solid rgba(200, 164, 78, 0.15);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 56px;
      color: rgba(200, 164, 78, 0.35);
      margin-bottom: 18px;
    }
    /* Name + location */
    .nx-ps-name {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 6px;
      line-height: 1.15;
      color: #fff;
      letter-spacing: -0.01em;
    }
    .nx-ps-loc {
      font-size: 15px;
      color: #b9b4a8;
      margin: 0 0 16px;
    }
    /* Status pill */
    .nx-ps-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 20px;
      border: 1px solid;
    }
    .nx-ps-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block;
    }
    /* Banners */
    .nx-ps-banner {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 14px;
      border-radius: 12px;
      margin-bottom: 14px;
      border: 1px solid;
    }
    .nx-ps-banner-icon { font-size: 24px; flex-shrink: 0; margin-top: 2px; }
    .nx-ps-banner-title { font-size: 14px; font-weight: 700; margin-bottom: 3px; color: #fff; }
    .nx-ps-banner-sub { font-size: 13px; color: rgba(255,255,255,0.78); line-height: 1.4; }
    .nx-ps-banner-issue   { background: rgba(244, 67, 54, 0.14); border-color: rgba(244, 67, 54, 0.45); }
    .nx-ps-banner-issue   .nx-ps-banner-title { color: #ff8a7a; }
    .nx-ps-banner-overdue { background: rgba(255, 152, 0, 0.14); border-color: rgba(255, 152, 0, 0.45); }
    .nx-ps-banner-overdue .nx-ps-banner-title { color: #ffb84d; }
    .nx-ps-banner-warranty{ background: rgba(33, 150, 243, 0.12); border-color: rgba(33, 150, 243, 0.4); }
    .nx-ps-banner-warranty.nx-ps-banner-title { color: #74bfff; }
    /* Specs grid */
    .nx-ps-specs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px 20px;
      margin: 20px 0 10px;
      padding: 18px 0;
      border-top: 1px solid rgba(200, 164, 78, 0.12);
    }
    .nx-ps-spec-label {
      font-size: 11px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #6b675c;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .nx-ps-spec-val { font-size: 15px; color: #e8e8ea; }
    /* Service history */
    .nx-ps-section-title {
      font-size: 12px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #8a826f;
      font-weight: 600;
      margin: 24px 0 12px;
    }
    .nx-ps-history-row {
      display: grid;
      grid-template-columns: 80px 1fr;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(200, 164, 78, 0.08);
    }
    .nx-ps-history-row:last-child { border-bottom: none; }
    .nx-ps-history-date { font-size: 13px; color: #8a826f; }
    .nx-ps-history-type { font-size: 12px; font-weight: 700; color: #c8a44e; margin-bottom: 4px; letter-spacing: 1px; }
    .nx-ps-history-desc { font-size: 14px; color: #e8e8ea; line-height: 1.4; margin-bottom: 4px; }
    .nx-ps-history-by { font-size: 12px; color: #6b675c; }
    /* Action buttons */
    .nx-ps-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 24px;
    }
    .nx-ps-btn {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 16px 18px;
      border-radius: 12px;
      border: 1px solid;
      background: transparent;
      color: inherit;
      font-family: inherit;
      cursor: pointer;
      text-align: left;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.1s, background 0.15s;
    }
    .nx-ps-btn:active { transform: scale(0.98); }
    .nx-ps-btn-icon { font-size: 28px; flex-shrink: 0; }
    .nx-ps-btn-label { flex: 1; min-width: 0; }
    .nx-ps-btn-title { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
    .nx-ps-btn-sub   { font-size: 12px; opacity: 0.7; }
    /* Primary */
    .nx-ps-btn-primary {
      background: linear-gradient(135deg, #c8a44e 0%, #b08e3f 100%);
      border-color: #c8a44e;
      color: #1a1408;
      padding: 20px;
      box-shadow: 0 4px 20px rgba(200, 164, 78, 0.25);
    }
    .nx-ps-btn-primary .nx-ps-btn-icon { font-size: 32px; }
    .nx-ps-btn-primary .nx-ps-btn-title { font-size: 18px; }
    .nx-ps-btn-primary .nx-ps-btn-sub   { opacity: 0.75; color: #3a2a10; }
    /* Call */
    .nx-ps-btn-call {
      background: rgba(76, 175, 80, 0.12);
      border-color: rgba(76, 175, 80, 0.45);
      color: #7ed281;
    }
    .nx-ps-btn-call .nx-ps-btn-title { color: #a5e6a8; }
    /* Issue */
    .nx-ps-btn-issue {
      background: rgba(244, 67, 54, 0.10);
      border-color: rgba(244, 67, 54, 0.35);
      color: #ff8a7a;
    }
    .nx-ps-btn-issue .nx-ps-btn-title { color: #ff8a7a; }
    /* Login tertiary */
    .nx-ps-btn-login {
      background: transparent;
      border-color: rgba(200, 164, 78, 0.25);
      color: #8a826f;
    }
    .nx-ps-btn-login .nx-ps-btn-title { color: #c8a44e; }
    /* Footer */
    .nx-ps-footer {
      text-align: center;
      margin-top: 32px;
      padding-top: 16px;
      font-size: 11px;
      color: #545046;
      letter-spacing: 1px;
    }
    /* Error / boot screens */
    .nx-ps-error, .nx-ps-boot {
      text-align: center;
      padding: 80px 24px 40px;
      max-width: 340px;
      margin: 0 auto;
    }
    .nx-ps-error-icon { font-size: 56px; color: #c8a44e; margin-bottom: 16px; }
    .nx-ps-error-title { font-size: 18px; font-weight: 600; color: #e6dccc; margin-bottom: 10px; }
    .nx-ps-error-msg { font-size: 13px; color: #8a826f; margin-bottom: 24px; line-height: 1.5; }
    .nx-ps-error-btn {
      padding: 12px 28px;
      background: #c8a44e;
      color: #1a1408;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      font-family: inherit;
    }
    .nx-ps-boot-brand {
      font-family: 'JetBrains Mono', monospace;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 6px;
      color: #c8a44e;
      margin-bottom: 28px;
      animation: nxPsPulse 1.6s ease-in-out infinite;
    }
    .nx-ps-boot-spinner {
      width: 60px; height: 60px; margin: 0 auto 20px;
      border: 4px solid rgba(200, 164, 78, 0.15);
      border-top-color: #c8a44e;
      border-radius: 50%;
      animation: nxPsSpin 0.9s linear infinite;
    }
    .nx-ps-boot-label { font-size: 15px; color: #e6dccc; }
    @keyframes nxPsSpin { to { transform: rotate(360deg); } }
    @keyframes nxPsPulse { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.04); } }

    /* Issue report modal */
    .nx-ps-modal-bg {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.7);
      z-index: 9998;
      display: flex; align-items: flex-end; justify-content: center;
    }
    .nx-ps-modal {
      background: #1a1a22;
      border: 1px solid rgba(200, 164, 78, 0.2);
      border-radius: 20px 20px 0 0;
      padding: 24px 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
      width: 100%;
      max-width: 600px;
      max-height: 90vh;
      overflow-y: auto;
      animation: nxPsSlideUp 0.25s ease-out;
    }
    @keyframes nxPsSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    .nx-ps-modal h2 { font-size: 20px; margin: 0 0 4px; color: #fff; }
    .nx-ps-modal-sub { font-size: 13px; color: #8a826f; margin-bottom: 20px; }
    .nx-ps-modal-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #8a826f; font-weight: 600; margin-bottom: 8px; }
    .nx-ps-modal-input, .nx-ps-modal-textarea {
      width: 100%;
      padding: 12px 14px;
      background: #0d0d12;
      border: 1px solid rgba(200, 164, 78, 0.2);
      border-radius: 10px;
      color: #e8e8ea;
      font-family: inherit;
      font-size: 14px;
      box-sizing: border-box;
      margin-bottom: 16px;
    }
    .nx-ps-modal-textarea { min-height: 100px; resize: vertical; }
    .nx-ps-modal-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .nx-ps-modal-chip {
      padding: 8px 12px;
      background: rgba(200, 164, 78, 0.08);
      border: 1px solid rgba(200, 164, 78, 0.2);
      border-radius: 8px;
      color: #c8a44e;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
    }
    .nx-ps-modal-chip.active {
      background: #c8a44e;
      color: #1a1408;
      font-weight: 700;
    }
    .nx-ps-modal-btns { display: flex; gap: 10px; margin-top: 8px; }
    .nx-ps-modal-btn {
      flex: 1;
      padding: 14px;
      border-radius: 10px;
      border: 1px solid;
      font-family: inherit;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
    }
    .nx-ps-modal-btn-cancel { background: transparent; border-color: rgba(200, 164, 78, 0.2); color: #8a826f; }
    .nx-ps-modal-btn-send { background: #c8a44e; border-color: #c8a44e; color: #1a1408; }
    .nx-ps-modal-btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

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
    const statusMap = {
      operational:   { label: 'Operational',   color: '#4caf50' },
      needs_service: { label: 'Needs Service', color: '#ff9800' },
      down:          { label: 'Down',          color: '#f44336' },
      retired:       { label: 'Retired',       color: '#888'    },
    };
    const status = statusMap[eq.status] || { label: eq.status || 'Unknown', color: '#888' };

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
          <div class="nx-ps-banner-icon">⚠</div>
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
          <div class="nx-ps-banner-icon">⏰</div>
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
          <div class="nx-ps-banner-icon">🛡</div>
          <div>
            <div class="nx-ps-banner-title">Under warranty until ${warranty.toLocaleDateString()}</div>
            <div class="nx-ps-banner-sub">${warrantyDaysLeft} day${warrantyDaysLeft !== 1 ? 's' : ''} remaining — avoid invasive repairs; check warranty first</div>
          </div>
        </div>
      `);
    }

    const photoHTML = eq.photo_url
      ? `<img class="nx-ps-photo" src="${esc(eq.photo_url)}" alt="${esc(eq.name)}">`
      : `<div class="nx-ps-photo-placeholder">${catIcon(eq.category)}</div>`;

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
        <div class="nx-ps-btn-icon">📞</div>
        <div class="nx-ps-btn-label">
          <div class="nx-ps-btn-title">Call ${esc(contact.name)}</div>
          <div class="nx-ps-btn-sub">${esc(contact.phone)}</div>
        </div>
      </button>
    ` : '';

    const html = `
      <div class="nx-ps-page" id="nx-ps-page">
        <div class="nx-ps-header"><div class="nx-ps-brand">NEXUS</div></div>
        <div class="nx-ps-body">
          <div class="nx-ps-card">
            ${photoHTML}
            <h1 class="nx-ps-name">${esc(eq.name)}</h1>
            <div class="nx-ps-loc">📍 ${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
            <div class="nx-ps-status" style="color:${status.color}; border-color:${status.color}40; background:${status.color}14;">
              <span class="nx-ps-status-dot" style="background:${status.color};"></span>
              ${esc(status.label)}
            </div>
            ${banners.join('')}
            <div class="nx-ps-specs">
              <div><div class="nx-ps-spec-label">Manufacturer</div><div class="nx-ps-spec-val">${esc(eq.manufacturer || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Model</div><div class="nx-ps-spec-val">${esc(eq.model || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Serial Number</div><div class="nx-ps-spec-val">${esc(eq.serial_number || '—')}</div></div>
              <div><div class="nx-ps-spec-label">Installed</div><div class="nx-ps-spec-val">${installStr}</div></div>
              <div><div class="nx-ps-spec-label">Warranty</div><div class="nx-ps-spec-val">${warrantyStr}</div></div>
              <div><div class="nx-ps-spec-label">Next PM</div><div class="nx-ps-spec-val">${pmStr}</div></div>
            </div>
            ${historyHTML}
            <div class="nx-ps-actions">
              <button class="nx-ps-btn nx-ps-btn-primary" data-action="log-service">
                <div class="nx-ps-btn-icon">🔧</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Log Service</div>
                  <div class="nx-ps-btn-sub">Contractors — no login needed</div>
                </div>
              </button>
              ${callBtnHTML}
              <button class="nx-ps-btn nx-ps-btn-issue" data-action="report">
                <div class="nx-ps-btn-icon">🚨</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Report Issue</div>
                  <div class="nx-ps-btn-sub">Something's broken or unsafe</div>
                </div>
              </button>
              <button class="nx-ps-btn nx-ps-btn-login" data-action="login">
                <div class="nx-ps-btn-icon">🔐</div>
                <div class="nx-ps-btn-label">
                  <div class="nx-ps-btn-title">Staff Login</div>
                  <div class="nx-ps-btn-sub">Full equipment details</div>
                </div>
              </button>
            </div>
            <div class="nx-ps-footer">Powered by NEXUS · Restaurant Operations Intelligence</div>
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
        if (confirm(`Call ${contact.name} at ${contact.phone}?`)) {
          window.location.href = contact.phoneHref;
        }
      } else if (action === 'report') {
        openReportModal(eq);
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

  // ─── 10. REPORT ISSUE MODAL ─────────────────────────────────────────
  function openReportModal(eq) {
    const commonIssues = [
      'Not cooling', 'Leaking', 'Making noise', 'Not turning on',
      'Temperature wrong', 'Smells strange'
    ];
    const rememberedName = localStorage.getItem('nx_reporter_name') || '';

    const bg = document.createElement('div');
    bg.className = 'nx-ps-modal-bg';
    bg.innerHTML = `
      <div class="nx-ps-modal" onclick="event.stopPropagation()">
        <h2>Report Issue</h2>
        <div class="nx-ps-modal-sub">${esc(eq.name)} · ${esc(eq.location || '')}</div>

        <div class="nx-ps-modal-label">Common issues</div>
        <div class="nx-ps-modal-chips" id="nxRepChips">
          ${commonIssues.map(i => `<button class="nx-ps-modal-chip" data-issue="${esc(i)}" type="button">${esc(i)}</button>`).join('')}
        </div>

        <div class="nx-ps-modal-label">Describe the problem *</div>
        <textarea class="nx-ps-modal-textarea" id="nxRepDesc" placeholder="What's wrong? When did it start?"></textarea>

        <div class="nx-ps-modal-label">Your name *</div>
        <input class="nx-ps-modal-input" id="nxRepName" value="${esc(rememberedName)}" placeholder="So staff know who to follow up with">

        <div class="nx-ps-modal-btns">
          <button class="nx-ps-modal-btn nx-ps-modal-btn-cancel" type="button" id="nxRepCancel">Cancel</button>
          <button class="nx-ps-modal-btn nx-ps-modal-btn-send" type="button" id="nxRepSend" disabled>Send Report</button>
        </div>
      </div>
    `;
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);

    const desc   = bg.querySelector('#nxRepDesc');
    const name   = bg.querySelector('#nxRepName');
    const send   = bg.querySelector('#nxRepSend');
    const cancel = bg.querySelector('#nxRepCancel');
    const chips  = bg.querySelectorAll('.nx-ps-modal-chip');

    const validate = () => { send.disabled = !(desc.value.trim() && name.value.trim()); };
    desc.addEventListener('input', validate);
    name.addEventListener('input', validate);

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const selected = Array.from(chips).filter(c => c.classList.contains('active')).map(c => c.dataset.issue);
        const base = selected.join(', ');
        if (base && !desc.value.toLowerCase().includes(selected[selected.length-1].toLowerCase())) {
          desc.value = desc.value ? `${desc.value}. ${base}` : base;
        }
        validate();
      });
    });
    cancel.addEventListener('click', () => bg.remove());

    send.addEventListener('click', async () => {
      send.disabled = true;
      send.textContent = 'Sending...';
      try {
        localStorage.setItem('nx_reporter_name', name.value.trim());
        const { error } = await sb.from('tickets').insert({
          title: `[Equipment] ${eq.name}: ${desc.value.trim().slice(0, 80)}`,
          description: `Reported via QR scan.\n\nEquipment: ${eq.name}\nLocation: ${eq.location || ''} ${eq.area || ''}\nReporter: ${name.value.trim()}\n\n${desc.value.trim()}`,
          status: 'open',
          priority: 'medium',
          reported_by: name.value.trim(),
          equipment_id: eq.id,
          equipment_qr: eq.qr_code,
        });
        if (error) throw error;
        bg.innerHTML = `
          <div class="nx-ps-modal" style="text-align:center;">
            <div style="font-size:56px; margin-bottom:12px;">✓</div>
            <h2 style="color:#7ed281;">Reported</h2>
            <div class="nx-ps-modal-sub">Staff will follow up. Thanks.</div>
            <button class="nx-ps-modal-btn nx-ps-modal-btn-send" style="margin-top:16px;" onclick="this.closest('.nx-ps-modal-bg').remove()">Close</button>
          </div>
        `;
      } catch (err) {
        console.error('[scan] Report failed:', err);
        send.disabled = false;
        send.textContent = 'Send Report';
        alert('Failed to send: ' + err.message);
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
      <div class="nx-ps-header"><div class="nx-ps-brand">NEXUS</div></div>
      <div class="nx-ps-error">
        <div class="nx-ps-error-icon">⚠</div>
        <div class="nx-ps-error-title">Could not load equipment</div>
        <div class="nx-ps-error-msg">${esc(msg)}</div>
        <button class="nx-ps-error-btn" onclick="location.reload()">Try again</button>
      </div>
    `;
    document.body.appendChild(wrap);
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
