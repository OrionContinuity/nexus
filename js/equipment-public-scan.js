/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Public Scan v4 — Self-Contained
   
   Changes from v3:
   
     • Bigger, more confident boot loader (pulsing brand + larger spinner)
     • Equipment name grows on mobile (was shrinking — wrong direction)
     • Photo capped at 50vh, not 200px — the photo IS the contractor's
       visual confirmation
     • ACTIVE ISSUE BANNER: if there's an open ticket <30d old, surface it
       at the top so arriving contractors see "Maria filed: Making noise"
     • WARRANTY VALID BANNER: red warning if still under warranty — do not
       perform invasive work without checking (voids coverage)
     • OVERDUE PM BANNER: prominent red bar, not a tiny text field
     • Button hierarchy: Primary PM Logger visually dominates
     • Report Issue modal v2: photo upload, common-issue chips, remembered
       name, camera-capture on mobile
   
   Loaded as static <script> in index.html <head> before app.js.
   Kept the v3 routing contract (window._NX_PUBLIC_PM_OPEN, etc.) so
   equipment-public-pm.js continues to plug in without changes.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');
  const forceLogin = params.get('login') === '1';

  if (!equipParam || forceLogin) return; // Normal flow, not a public scan

  // Active session? Skip public view.
  try {
    const activeUser = sessionStorage.getItem('nexus_current_user');
    const activeToken = sessionStorage.getItem('nexus_session_token');
    if (activeUser && activeToken) return;
  } catch(e) {}

  const SUPABASE_URL = window.NEXUS_CONFIG?.SUPABASE_URL  || 'https://oprsthfxqrdbwdvommpw.supabase.co';
  // Prefers window.NEXUS_CONFIG.SUPABASE_ANON (from js/config.js).
  // Falls back to the hardcoded value so the file still works if
  // config.js was forgotten. Publishable keys are safe to commit.
  const SUPABASE_ANON = window.NEXUS_CONFIG?.SUPABASE_ANON || 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9';

  // ─── Utilities ──────────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function daysAgo(dateStr) {
    if (!dateStr) return null;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }
  function fmtRelative(dateStr) {
    const d = daysAgo(dateStr);
    if (d == null) return '';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d} days ago`;
    if (d < 30) return `${Math.floor(d/7)} weeks ago`;
    if (d < 365) return `${Math.floor(d/30)} months ago`;
    return `${Math.floor(d/365)} years ago`;
  }

  // ─── Supabase client ───────────────────────────────────────────────
  let sb = null;
  async function ensureSupabase() {
    if (window.NX?.sb) { sb = window.NX.sb; return sb; }
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return sb;
  }

  // ─── Force scroll — nexus.css has body{overflow:hidden} for its SPA.
  //     Multiple approaches belt-and-braces:
  //       1. Add a class to html+body so CSS selectors have higher specificity
  //       2. Inject CSS with !important targeting that class
  //       3. Also set inline styles via setProperty (respects !important)
  //       4. Reassert after a tick in case app.js's DOMContentLoaded handler
  //          tries to stamp body styles.
  function forceScrollOn() {
    document.documentElement.classList.add('nx-public-scan');
    document.body.classList.add('nx-public-scan');

    const styleId = 'nxPublicScanScrollFix';
    if (!document.getElementById(styleId)) {
      const st = document.createElement('style');
      st.id = styleId;
      // High-specificity selector + !important beats nexus.css's bare "body {}"
      st.textContent = `
        html.nx-public-scan,
        body.nx-public-scan,
        html.nx-public-scan body.nx-public-scan {
          overflow: visible !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          height: auto !important;
          min-height: 100vh !important;
          min-height: 100dvh !important;
          -webkit-overflow-scrolling: touch !important;
          position: static !important;
        }
      `;
      document.head.appendChild(st);
    }

    // Also set inline styles with setProperty (honors !important)
    const setImp = (el, prop, val) => el.style.setProperty(prop, val, 'important');
    [document.documentElement, document.body].forEach(el => {
      setImp(el, 'overflow', 'visible');
      setImp(el, 'overflow-y', 'auto');
      setImp(el, 'overflow-x', 'hidden');
      setImp(el, 'height', 'auto');
      setImp(el, 'min-height', '100vh');
    });
  }

  // ─── Inject styles once ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('nxPublicScanStyles')) return;
    const style = document.createElement('style');
    style.id = 'nxPublicScanStyles';
    style.textContent = `
      /* v4 polish overrides — apply on top of equipment.css */
      .public-scan-name {
        font-size: 28px !important;
        line-height: 1.15 !important;
        letter-spacing: -0.01em;
      }
      @media (min-width: 600px) {
        .public-scan-name { font-size: 32px !important; }
      }
      .public-scan-loc {
        font-size: 15px !important;
        margin-bottom: 16px !important;
      }
      .public-scan-photo {
        width: 100% !important;
        max-height: 50vh !important;
        min-height: 220px !important;
        object-fit: cover !important;
        border-radius: 12px !important;
        margin-bottom: 18px !important;
        background: #15151c;
      }
      .public-scan-photo-placeholder {
        width: 100%;
        aspect-ratio: 4 / 3;
        min-height: 180px;
        background: linear-gradient(135deg, #15151c, #1f1f28);
        border: 1px solid rgba(200, 164, 78, 0.15);
        border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 56px; color: rgba(200, 164, 78, 0.35);
        margin-bottom: 18px;
      }
      .public-scan-card { padding: 22px 20px !important; }
      .public-scan-status {
        padding: 8px 16px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
      }

      /* v4 BANNERS — surface critical info immediately */
      .ps-banner {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 14px 14px; margin-bottom: 14px;
        border-radius: 12px;
        border: 1px solid;
      }
      .ps-banner-icon {
        font-size: 24px; line-height: 1; flex-shrink: 0; margin-top: 2px;
      }
      .ps-banner-body { flex: 1; min-width: 0; }
      .ps-banner-title {
        font-size: 14px; font-weight: 700;
        color: #fff; margin-bottom: 3px;
      }
      .ps-banner-sub {
        font-size: 12.5px; color: rgba(255,255,255,0.78);
        line-height: 1.4;
      }
      .ps-banner-issue {
        background: rgba(244, 67, 54, 0.14);
        border-color: rgba(244, 67, 54, 0.45);
      }
      .ps-banner-issue .ps-banner-title { color: #ff8a7a; }
      .ps-banner-overdue {
        background: rgba(255, 152, 0, 0.14);
        border-color: rgba(255, 152, 0, 0.45);
      }
      .ps-banner-overdue .ps-banner-title { color: #ffb84d; }
      .ps-banner-warranty {
        background: rgba(33, 150, 243, 0.12);
        border-color: rgba(33, 150, 243, 0.4);
      }
      .ps-banner-warranty .ps-banner-title { color: #74bfff; }

      /* Button hierarchy — PM Logger primary, others secondary */
      .pm-public-btn-primary {
        padding: 20px !important;
        transform: scale(1);
        box-shadow: 0 4px 20px rgba(200, 164, 78, 0.25);
      }
      .pm-public-btn-primary .pm-public-btn-icon { font-size: 34px !important; }
      .pm-public-btn-primary .pm-public-btn-title { font-size: 17px !important; }
      .pm-public-btn-primary .pm-public-btn-sub { font-size: 12.5px !important; }

      /* Boot loader */
      @keyframes nxBootPulse {
        0%, 100% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.04); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Boot loader (v4 — bigger, pulsing brand) ───────────────────────
  function renderBootLoader(qrCode) {
    injectStyles();
    forceScrollOn();
    const boot = document.createElement('div');
    boot.id = 'nxPublicBoot';
    boot.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: radial-gradient(circle at 50% 40%, #14141c, #0a0a0f);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    boot.innerHTML = `
      <div style="text-align: center; padding: 24px; max-width: 320px;">
        <div style="
          font-family: 'JetBrains Mono', monospace;
          font-size: 22px; font-weight: 600;
          letter-spacing: 6px; color: #c8a44e;
          margin-bottom: 28px;
          animation: nxBootPulse 1.6s ease-in-out infinite;
        ">NEXUS</div>
        <div style="
          width: 64px; height: 64px; margin: 0 auto 24px;
          border: 4px solid rgba(200, 164, 78, 0.15);
          border-top-color: #c8a44e;
          border-radius: 50%;
          animation: nxBootSpin 0.9s linear infinite;
        "></div>
        <div style="
          font-size: 16px; color: #e6dccc;
          font-weight: 500; margin-bottom: 8px;
        ">Loading equipment…</div>
        <div style="
          font-size: 11px; color: rgba(200, 164, 78, 0.5);
          font-family: 'JetBrains Mono', monospace;
          padding: 4px 10px; background: rgba(200, 164, 78, 0.05);
          border-radius: 6px; display: inline-block;
        ">${esc(qrCode)}</div>
      </div>
      <style>
        @keyframes nxBootSpin { to { transform: rotate(360deg); } }
      </style>
    `;
    if (document.body) {
      document.body.appendChild(boot);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.body.appendChild(boot));
    }
  }

  function removeBootLoader() {
    document.getElementById('nxPublicBoot')?.remove();
  }

  // ─── Render shell (static container for details) ─────────────────
  function renderShell() {
    forceScrollOn();

    document.body.innerHTML = `
      <div class="public-scan-container">
        <div class="public-scan-header">
          <div class="public-scan-brand">NEXUS</div>
        </div>
        <div class="public-scan-body" id="publicScanBody"></div>
      </div>
    `;

    // Re-apply classes (body.innerHTML doesn't nuke classList but be safe)
    forceScrollOn();
    // app.js DOMContentLoaded handler may fire AFTER this and stomp on
    // body styles — reassert after a tick to win the race.
    setTimeout(forceScrollOn, 50);
    setTimeout(forceScrollOn, 500);
  }

  // ─── Render details view (v4) ───────────────────────────────────────
  function renderDetails(eq, maint, contractor, activeTicket) {
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

    const loginUrl = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}&login=1`;

    // Contractor call button — only shown if equipment has a preferred
    // contractor with a valid phone number.
    const callBtnHtml = contractor ? `
      <button class="pm-public-btn pm-public-btn-call" type="button" onclick='window._NX_OPEN_PUBLIC_CALL(${JSON.stringify({name:contractor.name,phone:contractor.phone,phoneHref:contractor.phoneHref,equipId:eq.id,equipName:eq.name,qrCode:eq.qr_code}).replace(/'/g,"&#39;")})'>
        <span class="pm-public-btn-icon">📞</span>
        <span class="pm-public-btn-label">
          <span class="pm-public-btn-title">Call ${esc(contractor.name)}</span>
          <span class="pm-public-btn-sub">${esc(contractor.phone)}</span>
        </span>
      </button>
    ` : '';

    // Build banners HTML — rendered in priority order (most-urgent first).
    const banners = [];
    if (activeTicket) {
      const when = activeTicket.created_at ? fmtRelative(activeTicket.created_at) : '';
      const who = activeTicket.reported_by || 'someone';
      const issueText = activeTicket.title || 'Issue reported';
      banners.push(`
        <div class="ps-banner ps-banner-issue">
          <div class="ps-banner-icon">⚠</div>
          <div class="ps-banner-body">
            <div class="ps-banner-title">Active issue filed ${esc(when)}</div>
            <div class="ps-banner-sub">
              <strong>${esc(who)}</strong> reported: ${esc(issueText.replace(/^\[Equipment\]\s*[^:]*:\s*/, '').slice(0, 140))}
            </div>
          </div>
        </div>
      `);
    }
    if (pmOverdue) {
      banners.push(`
        <div class="ps-banner ps-banner-overdue">
          <div class="ps-banner-icon">⏰</div>
          <div class="ps-banner-body">
            <div class="ps-banner-title">Preventative maintenance overdue</div>
            <div class="ps-banner-sub">Was due ${pmDaysOverdue} day${pmDaysOverdue !== 1 ? 's' : ''} ago (${pmStr})</div>
          </div>
        </div>
      `);
    }
    if (warrantyValid) {
      const warrantyStr = warranty.toLocaleDateString();
      banners.push(`
        <div class="ps-banner ps-banner-warranty">
          <div class="ps-banner-icon">🛡</div>
          <div class="ps-banner-body">
            <div class="ps-banner-title">Under warranty until ${warrantyStr}</div>
            <div class="ps-banner-sub">${warrantyDaysLeft} day${warrantyDaysLeft !== 1 ? 's' : ''} remaining — avoid invasive repairs; check warranty terms first</div>
          </div>
        </div>
      `);
    }

    const photoBlock = eq.photo_url
      ? `<img src="${esc(eq.photo_url)}" class="public-scan-photo" alt="${esc(eq.name)}">`
      : `<div class="public-scan-photo-placeholder">${catIcon(eq.category)}</div>`;

    const body = document.getElementById('publicScanBody');
    if (!body) return;
    body.innerHTML = `
      <div class="public-scan-card">
        ${photoBlock}
        <h1 class="public-scan-name">${esc(eq.name)}</h1>
        <div class="public-scan-loc">📍 ${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
        <div class="public-scan-status" style="background:${status.color}22;border-color:${status.color}">
          <span class="public-scan-dot" style="background:${status.color}"></span>
          <span style="color:${status.color}">${status.label}</span>
        </div>

        ${banners.join('')}

        <div class="public-scan-fields">
          ${eq.manufacturer ? `<div><label>Manufacturer</label><div>${esc(eq.manufacturer)}</div></div>` : ''}
          ${eq.model ? `<div><label>Model</label><div>${esc(eq.model)}</div></div>` : ''}
          ${eq.serial_number ? `<div><label>Serial Number</label><div>${esc(eq.serial_number)}</div></div>` : ''}
          ${eq.install_date ? `<div><label>Installed</label><div>${new Date(eq.install_date).toLocaleDateString()}</div></div>` : ''}
          ${!warrantyValid && eq.warranty_until ? `<div><label>Warranty</label><div>${new Date(eq.warranty_until).toLocaleDateString()} (expired)</div></div>` : ''}
          ${!pmOverdue ? `<div><label>Next PM</label><div>${pmStr}</div></div>` : ''}
        </div>

        ${maint.length ? `
          <div class="public-scan-section">
            <h3>Recent Service History</h3>
            ${maint.map(m => `
              <div class="public-scan-history">
                <div class="public-scan-hist-date">${new Date(m.event_date).toLocaleDateString()}</div>
                <div>
                  <div class="public-scan-hist-type">${esc((m.event_type || 'service').toUpperCase())}</div>
                  <div class="public-scan-hist-desc">${esc(m.description || '')}</div>
                  ${m.performed_by ? `<div class="public-scan-hist-who">${esc(m.performed_by)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>` : ''}

        <div class="public-scan-actions" id="publicScanActions">
          <button class="pm-public-btn pm-public-btn-primary" onclick="(window._NX_PUBLIC_PM_OPEN||(()=>alert('PM Logger not loaded')))('${eq.qr_code}')">
            <span class="pm-public-btn-icon">🔧</span>
            <span class="pm-public-btn-label">
              <span class="pm-public-btn-title">Log Service</span>
              <span class="pm-public-btn-sub">Contractors — no login needed</span>
            </span>
          </button>
          ${callBtnHtml}
          <button class="pm-public-btn pm-public-btn-tertiary" onclick="window._NX_OPEN_REPORT_ISSUE('${eq.qr_code}')">
            <span class="pm-public-btn-icon">🚨</span>
            <span class="pm-public-btn-label">
              <span class="pm-public-btn-title">Report Issue</span>
              <span class="pm-public-btn-sub">Something's broken or unsafe</span>
            </span>
          </button>
          <button class="pm-public-btn pm-public-btn-secondary" onclick="window.location.href='${loginUrl}'">
            <span class="pm-public-btn-icon">🔐</span>
            <span class="pm-public-btn-label">
              <span class="pm-public-btn-title">Staff Login</span>
              <span class="pm-public-btn-sub">Full equipment details</span>
            </span>
          </button>
        </div>
        <div class="public-scan-footer">Powered by NEXUS · Restaurant Operations Intelligence</div>
      </div>
    `;
  }

  function catIcon(category) {
    const map = {
      refrigeration: '❄', cooking: '🔥', hvac: '🌬', plumbing: '🚰',
      electrical: '⚡', cleaning: '🧽', dishwashing: '🍽',
      beverage: '🥤', bar: '🍸',
    };
    return map[(category || '').toLowerCase()] || '🔧';
  }

  // ─── Error screen ─────────────────────────────────────────────────
  function showError(msg) {
    const container = document.getElementById('nxPublicBoot') || document.getElementById('publicScanBody');
    if (!container) return;
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 24px; max-width: 340px; margin: 0 auto;">
        <div style="font-size: 56px; margin-bottom: 16px; color: #c8a44e;">⚠</div>
        <div style="font-size: 18px; font-weight: 600; color: #e6dccc; margin-bottom: 10px;">
          Could not load equipment
        </div>
        <div style="font-size: 13px; color: #8a826f; margin-bottom: 24px; line-height: 1.5;">
          ${esc(msg)}
        </div>
        <button onclick="location.reload()" style="
          padding: 12px 28px; background: #c8a44e; color: #1a1408;
          border: none; border-radius: 10px;
          font-size: 14px; font-weight: 600; cursor: pointer;
        ">Try again</button>
        <button onclick="location.href=location.pathname" style="
          display: block; margin: 14px auto 0;
          padding: 10px 22px; background: transparent; color: #8a826f;
          border: 1px solid #3a3a46; border-radius: 10px;
          font-size: 13px; cursor: pointer;
        ">Go to NEXUS</button>
      </div>
    `;
  }

  // ─── Report Issue modal (v2 — photo + chips + remembered name) ─────
  // Global hook called by the Report Issue button.
  window._NX_OPEN_REPORT_ISSUE = async function(qrCode) {
    // Guard: if multiple rapid taps, skip
    if (document.getElementById('nxReportModal')) return;

    const COMMON_ISSUES = [
      { key: 'not_cold', label: '❄ Not cold', prefix: 'Not cooling properly. ' },
      { key: 'leaking', label: '💧 Leaking', prefix: 'Leaking. ' },
      { key: 'noise', label: '🔊 Loud noise', prefix: 'Making unusual noise. ' },
      { key: 'wont_start', label: '⚡ Won\'t start', prefix: 'Won\'t turn on. ' },
      { key: 'smell', label: '👃 Strange smell', prefix: 'Unusual smell. ' },
      { key: 'other', label: '…', prefix: '' },
    ];
    const rememberedName = (() => { try { return localStorage.getItem('nexus_public_reporter_name') || ''; } catch { return ''; } })();

    const modal = document.createElement('div');
    modal.id = 'nxReportModal';
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(8,8,14,0.88); backdrop-filter: blur(6px);
      display: flex; align-items: flex-end; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: nxReportFade 0.18s ease-out;
    `;
    modal.innerHTML = `
      <style>
        @keyframes nxReportFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes nxReportSlide { from { transform: translateY(20px) } to { transform: translateY(0) } }
      </style>
      <div style="
        position: relative; width: 100%; max-width: 460px;
        max-height: 94vh; overflow-y: auto;
        background: #15151c; border-top: 1px solid #2a2a33;
        border-radius: 18px 18px 0 0;
        padding: 22px 20px 28px; color: #e6dccc;
        animation: nxReportSlide 0.22s ease-out;
      ">
        <button id="nxReportClose" style="
          position: absolute; top: 10px; right: 10px;
          width: 34px; height: 34px; border: none;
          background: rgba(255,255,255,0.06); color: #8a826f;
          border-radius: 50%; font-size: 18px; cursor: pointer;
        ">✕</button>

        <h2 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #fff;">Report Issue</h2>
        <p style="margin: 0 0 18px; font-size: 12.5px; color: #8a826f;">The team will be notified immediately.</p>

        <label style="display:block;font-size:11.5px;font-weight:600;letter-spacing:.4px;color:#b0a89a;margin-bottom:8px;">WHAT'S HAPPENING? (Tap one)</label>
        <div id="nxReportChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
          ${COMMON_ISSUES.map(i => `
            <button type="button" data-chip="${i.key}" data-prefix="${esc(i.prefix)}" style="
              padding:8px 12px; font-size:13px; font-family:inherit;
              background: rgba(255,255,255,0.04);
              border: 1px solid rgba(255,255,255,0.1);
              color: #d4c8a5; border-radius: 10px; cursor: pointer;
            ">${i.label}</button>
          `).join('')}
        </div>

        <label style="display:block;font-size:11.5px;font-weight:600;letter-spacing:.4px;color:#b0a89a;margin-bottom:6px;">DETAILS</label>
        <textarea id="nxReportDesc" rows="3" placeholder="What's wrong? What were you doing when it happened?" style="
          width: 100%; padding: 12px 14px; font-size: 14px;
          font-family: inherit; resize: vertical;
          background: rgba(0,0,0,0.25); color: #fff;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px; margin-bottom: 14px;
          box-sizing: border-box;
        "></textarea>

        <label style="display:block;font-size:11.5px;font-weight:600;letter-spacing:.4px;color:#b0a89a;margin-bottom:6px;">PHOTO (optional — but hugely helpful)</label>
        <div id="nxReportPhotoWrap" style="margin-bottom: 14px;">
          <input type="file" id="nxReportPhotoInput" accept="image/*" capture="environment" style="display:none">
          <button type="button" id="nxReportPhotoBtn" style="
            width: 100%; padding: 14px;
            background: rgba(200,164,78,0.08);
            border: 1px dashed rgba(200,164,78,0.3);
            color: #c8a44e; font-size: 14px;
            font-family: inherit; border-radius: 10px; cursor: pointer;
          ">📷 Take photo or choose from library</button>
          <div id="nxReportPhotoPreview" style="margin-top:8px;display:none;">
            <img id="nxReportPhotoImg" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;">
            <button type="button" id="nxReportPhotoRemove" style="margin-top:4px;padding:4px 10px;font-size:11px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:#8a826f;border-radius:6px;cursor:pointer;">Remove photo</button>
          </div>
        </div>

        <label style="display:block;font-size:11.5px;font-weight:600;letter-spacing:.4px;color:#b0a89a;margin-bottom:6px;">YOUR NAME</label>
        <input type="text" id="nxReportName" value="${esc(rememberedName)}" placeholder="Who are you?" style="
          width: 100%; padding: 12px 14px; font-size: 14px;
          font-family: inherit;
          background: rgba(0,0,0,0.25); color: #fff;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px; margin-bottom: 14px;
          box-sizing: border-box;
        ">

        <label style="display:block;font-size:11.5px;font-weight:600;letter-spacing:.4px;color:#b0a89a;margin-bottom:6px;">PRIORITY</label>
        <div id="nxReportPrio" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:20px;">
          <button type="button" data-prio="low" style="padding:10px;font-size:13px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#d4c8a5;border-radius:10px;cursor:pointer;font-family:inherit;">Low</button>
          <button type="button" data-prio="normal" class="prio-active" style="padding:10px;font-size:13px;background:rgba(200,164,78,0.15);border:1px solid rgba(200,164,78,0.4);color:#c8a44e;border-radius:10px;cursor:pointer;font-family:inherit;">Normal</button>
          <button type="button" data-prio="urgent" style="padding:10px;font-size:13px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#d4c8a5;border-radius:10px;cursor:pointer;font-family:inherit;">🚨 Urgent</button>
        </div>

        <button type="button" id="nxReportSubmit" style="
          width: 100%; padding: 16px;
          background: linear-gradient(135deg, #c8a44e, #d4b86a);
          color: #1a1408; border: none;
          font-size: 15px; font-weight: 700;
          border-radius: 12px; cursor: pointer;
          font-family: inherit;
          box-shadow: 0 4px 14px rgba(200,164,78,0.25);
        ">Submit Report</button>
        <div id="nxReportStatus" style="margin-top:10px;font-size:12px;text-align:center;min-height:18px;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    // State
    let selectedChip = null;
    let selectedPrio = 'normal';
    let photoFile = null;

    // Chip selection — prepends prefix to description
    modal.querySelectorAll('[data-chip]').forEach(b => {
      b.addEventListener('click', () => {
        modal.querySelectorAll('[data-chip]').forEach(x => {
          x.style.background = 'rgba(255,255,255,0.04)';
          x.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        b.style.background = 'rgba(200,164,78,0.15)';
        b.style.borderColor = 'rgba(200,164,78,0.4)';
        selectedChip = b.dataset.chip;
        const desc = modal.querySelector('#nxReportDesc');
        const prefix = b.dataset.prefix || '';
        // Only prepend if description doesn't already start with a known prefix
        const currentVal = desc.value.trim();
        const anyPrefix = COMMON_ISSUES.find(i => currentVal.startsWith(i.prefix.trim()));
        if (anyPrefix) {
          desc.value = prefix + currentVal.slice(anyPrefix.prefix.trim().length).trim();
        } else if (prefix) {
          desc.value = prefix + currentVal;
        }
        desc.focus();
      });
    });

    // Priority buttons
    modal.querySelectorAll('[data-prio]').forEach(b => {
      b.addEventListener('click', () => {
        modal.querySelectorAll('[data-prio]').forEach(x => {
          x.style.background = 'rgba(255,255,255,0.04)';
          x.style.borderColor = 'rgba(255,255,255,0.1)';
          x.style.color = '#d4c8a5';
        });
        const p = b.dataset.prio;
        const colors = {
          low: ['rgba(100,140,200,0.15)', 'rgba(100,140,200,0.4)', '#78a4d4'],
          normal: ['rgba(200,164,78,0.15)', 'rgba(200,164,78,0.4)', '#c8a44e'],
          urgent: ['rgba(244,67,54,0.15)', 'rgba(244,67,54,0.5)', '#ff8a7a'],
        };
        const [bg, bd, c] = colors[p] || colors.normal;
        b.style.background = bg; b.style.borderColor = bd; b.style.color = c;
        selectedPrio = p;
      });
    });

    // Photo
    const photoInput = modal.querySelector('#nxReportPhotoInput');
    const photoBtn = modal.querySelector('#nxReportPhotoBtn');
    const photoPreview = modal.querySelector('#nxReportPhotoPreview');
    const photoImg = modal.querySelector('#nxReportPhotoImg');
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
      const f = photoInput.files?.[0];
      if (!f) return;
      photoFile = f;
      const r = new FileReader();
      r.onload = e => {
        photoImg.src = e.target.result;
        photoPreview.style.display = '';
        photoBtn.style.display = 'none';
      };
      r.readAsDataURL(f);
    });
    modal.querySelector('#nxReportPhotoRemove').addEventListener('click', () => {
      photoFile = null; photoInput.value = '';
      photoPreview.style.display = 'none';
      photoBtn.style.display = '';
    });

    // Close
    const close = () => modal.remove();
    modal.querySelector('#nxReportClose').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Submit
    modal.querySelector('#nxReportSubmit').addEventListener('click', async () => {
      const name = modal.querySelector('#nxReportName').value.trim();
      const desc = modal.querySelector('#nxReportDesc').value.trim();
      const status = modal.querySelector('#nxReportStatus');
      const submitBtn = modal.querySelector('#nxReportSubmit');

      if (!name) {
        status.textContent = '⚠ Please enter your name';
        status.style.color = '#ff8a7a';
        return;
      }
      if (!desc) {
        status.textContent = '⚠ Please describe the issue';
        status.style.color = '#ff8a7a';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      submitBtn.style.opacity = '0.7';
      status.textContent = '';

      try {
        try { localStorage.setItem('nexus_public_reporter_name', name); } catch {}

        await ensureSupabase();
        const { data: eq, error: eqErr } = await sb.from('equipment').select('id, name, location').eq('qr_code', qrCode).single();
        if (eqErr || !eq) throw new Error('Equipment not found');

        // Upload photo if present — best-effort, don't block on failure
        let photoUrl = null;
        if (photoFile) {
          try {
            const path = `public-reports/${Date.now()}-${photoFile.name.replace(/[^a-z0-9._-]/gi, '_')}`;
            const { error: upErr } = await sb.storage.from('nexus-files').upload(path, photoFile, {
              contentType: photoFile.type, upsert: false,
            });
            if (!upErr) {
              const { data: pub } = sb.storage.from('nexus-files').getPublicUrl(path);
              photoUrl = pub?.publicUrl || null;
            }
          } catch (e) { console.warn('[public-report] photo upload failed:', e); }
        }

        const ticketRow = {
          title: `[Equipment] ${eq.name}: ${desc.slice(0, 60)}`,
          notes: `Reported via QR scan by ${name}\n\nEquipment: ${eq.name}\nLocation: ${eq.location || ''}\n\nIssue: ${desc}${photoUrl ? '\n\nPhoto: ' + photoUrl : ''}`,
          priority: selectedPrio,
          location: eq.location,
          status: 'open',
          reported_by: `${name} (QR scan)`,
        };
        const { error: tkErr } = await sb.from('tickets').insert(ticketRow);
        if (tkErr) throw tkErr;

        const logEntry = `🚨 QR scan report - ${eq.name} at ${eq.location || 'unknown'}: ${desc.slice(0, 120)}${photoUrl ? ' [photo]' : ''}`;
        await sb.from('daily_logs').insert({ entry: logEntry, user_name: name }).select();

        // Success screen
        modal.querySelector('div[style*="position: relative"]').innerHTML = `
          <div style="padding: 40px 20px; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 18px;">✓</div>
            <h2 style="margin: 0 0 10px; font-size: 22px; font-weight: 700; color: #fff;">Report sent</h2>
            <p style="margin: 0 0 6px; font-size: 14px; color: #b0a89a; line-height:1.5;">
              Thanks, ${esc(name)}. The team has been notified${photoUrl ? ' (with your photo)' : ''}.
            </p>
            <p style="margin: 0 0 24px; font-size: 12px; color: #746c5e;">
              Priority: ${selectedPrio}${selectedPrio === 'urgent' ? ' — phones will vibrate' : ''}
            </p>
            <button onclick="document.getElementById('nxReportModal').remove()" style="
              padding: 12px 32px; background: #c8a44e; color: #1a1408;
              border: none; border-radius: 10px; font-size: 14px;
              font-weight: 700; cursor: pointer; font-family: inherit;
            ">Done</button>
          </div>
        `;
      } catch (err) {
        console.error('[public-report] submit failed:', err);
        status.textContent = '❌ Submit failed — ' + (err.message || 'try again');
        status.style.color = '#ff8a7a';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try again';
        submitBtn.style.opacity = '1';
      }
    });

    // Auto-focus description
    setTimeout(() => modal.querySelector('#nxReportDesc')?.focus(), 150);
  };

  // ─── Call-confirm hook (reused from equipment-public-pm.js contract) ──
  // If equipment-public-pm.js provides _NX_OPEN_PUBLIC_CALL, great.
  // If not, provide a minimal fallback so Call button still works.
  if (!window._NX_OPEN_PUBLIC_CALL) {
    window._NX_OPEN_PUBLIC_CALL = function(info) {
      if (confirm(`Call ${info.name} at ${info.phone}?`)) {
        window.location.href = info.phoneHref || `tel:${info.phone.replace(/[^\d+]/g, '')}`;
      }
    };
  }

  // ─── Main boot sequence ────────────────────────────────────────────
  async function main() {
    renderBootLoader(equipParam);

    try {
      await ensureSupabase();

      // Fetch equipment with the right schema — service_phone and
      // service_contact_name live directly on the row; preferred_contractor_node_id
      // (NOTE: suffix is _node_id, not _id) is the fallback FK to the nodes table.
      const { data: eq, error: eqErr } = await sb.from('equipment')
        .select('id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code, service_phone, service_contact_name, preferred_contractor_node_id')
        .eq('qr_code', equipParam)
        .single();

      if (eqErr || !eq) {
        throw new Error(eqErr?.message || 'Equipment not registered');
      }

      // Now that we have equipment.id, fetch the ticket + maintenance + contractor
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const [ticketQ, maintQ, contractorQ] = await Promise.all([
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
        // Only look up a contractor node if no direct service_phone is set —
        // direct phone on equipment always wins.
        (!eq.service_phone && eq.preferred_contractor_node_id)
          ? sb.from('nodes').select('id, name, notes, tags, links').eq('id', eq.preferred_contractor_node_id).single()
          : Promise.resolve({ data: null }),
      ]);

      const activeTicket = (ticketQ.data || [])[0] || null;
      const maint = maintQ.data || [];

      // Build the contractor object. Preference order:
      //   1. equipment.service_phone (direct field) — use as-is
      //   2. preferred_contractor_node_id → node.links.phone or regex scan
      let contractor = null;
      if (eq.service_phone) {
        contractor = {
          name: eq.service_contact_name || 'Service',
          phone: eq.service_phone,
          phoneHref: 'tel:' + String(eq.service_phone).replace(/[^\d+]/g, ''),
        };
      } else if (contractorQ?.data) {
        const node = contractorQ.data;
        const links = node.links || {};
        let phone = links.phone || '';
        if (!phone) {
          // Fallback: regex-scan notes + name + tags for a phone number
          const text = (node.notes || '') + ' ' + JSON.stringify(node.tags || []) + ' ' + (node.name || '');
          const m = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
          if (m) phone = m[0].trim();
        }
        if (phone) {
          contractor = {
            name: node.name || 'Service',
            phone,
            phoneHref: 'tel:' + phone.replace(/[^\d+]/g, ''),
          };
        }
      }

      injectStyles();
      renderShell();
      removeBootLoader();
      renderDetails(eq, maint, contractor, activeTicket);
    } catch (err) {
      console.error('[public-scan v4] boot failed:', err);
      showError(err.message || 'Unknown error');
    }
  }

  main();
})();
