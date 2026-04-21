/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Public Scan v3 — Self-Contained
   
   Previous versions tried to load equipment.js dynamically and call
   renderPublicScanView from inside it. This failed on mobile Chrome due
   to Service Worker interference with dynamically-injected scripts (both
   src=... AND blob:).
   
   v3 approach: render the public scan view DIRECTLY from this file. No
   dependency on equipment.js. We just need NX.sb (Supabase client), which
   we can either borrow from app.js or create ourselves.
   
   This file is loaded as a static <script> in index.html <head>, so it
   always executes normally — no dynamic injection, no SW interference.
   
   What this file does:
     1. Detects ?equip=XXX in URL (and no login override)
     2. Renders boot loader immediately
     3. Initializes Supabase client (from app.js or own)
     4. Looks up equipment by qr_code
     5. Renders full public scan view inline (no equipment.js needed)
     6. equipment-public-pm.js hooks its PM Logger button via a global
        callback window._NX_PUBLIC_PM_OPEN
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';
  
  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');
  const forceLogin = params.get('login') === '1';

  if (!equipParam || forceLogin) return; // Normal flow

  // Active session? Skip public view, let normal flow handle it.
  try {
    const activeUser = sessionStorage.getItem('nexus_current_user');
    const activeToken = sessionStorage.getItem('nexus_session_token');
    if (activeUser && activeToken) return;
  } catch(e) {}

  // Mark so app.js skips PIN setup
  window._NX_PUBLIC_SCAN = equipParam;

  // Immediate loading UI
  renderBootLoader(equipParam);

  // Wait for Supabase client — either from app.js or self-initialized
  waitForSupabase(startLoad, 8000, () => {
    showError('Supabase client not available (app.js + CDN both failed to initialize)');
  });

  /* ═════════════════════════════════════════════════════════════════════
     SUPABASE BOOTSTRAP
     ═════════════════════════════════════════════════════════════════════ */

  function waitForSupabase(onReady, timeoutMs, onTimeout) {
    const start = Date.now();
    const poll = () => {
      if (window.NX?.sb) return onReady();
      
      // After 4s, try to init our own client using the CDN + hardcoded creds
      if (Date.now() - start > 4000 && window.supabase?.createClient) {
        window.NX = window.NX || {};
        window.NX.sb = window.supabase.createClient(
          'https://oprsthfxqrdbwdvommpw.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnN0aGZ4cXJkYndkdm9tbXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDU2MzMsImV4cCI6MjA5MTE4MTYzM30.1Yy5BNXWy19Xzdt-ZdcoF0_MF6vvr1rYN5mcDsRYSWY'
        );
        return onReady();
      }
      
      if (Date.now() - start > timeoutMs) {
        if (onTimeout) onTimeout();
        return;
      }
      setTimeout(poll, 80);
    };
    poll();
  }

  /* ═════════════════════════════════════════════════════════════════════
     LOAD + RENDER — replicated from equipment.js renderPublicScanView
     so we don't need to load the full equipment module (which was
     failing via dynamic injection on mobile Chrome).
     ═════════════════════════════════════════════════════════════════════ */

  async function startLoad() {
    renderShell(equipParam);
    try {
      const { data: eq, error } = await NX.sb.from('equipment')
        .select('id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code')
        .eq('qr_code', equipParam)
        .single();
      if (error || !eq) throw new Error('Equipment not found for QR: ' + equipParam);

      const { data: maint } = await NX.sb.from('equipment_maintenance')
        .select('event_type, event_date, description, performed_by')
        .eq('equipment_id', eq.id)
        .order('event_date', { ascending: false })
        .limit(5);

      renderDetails(eq, maint || []);
      
      // Let equipment-public-pm.js know the eq is ready; it can enhance
      // the PM Logger button with real functionality
      window._NX_PUBLIC_SCAN_EQ = eq;
      window.dispatchEvent(new CustomEvent('nx-public-scan-ready', { detail: { eq } }));
    } catch (err) {
      console.error('[public-scan] load failed:', err);
      showError(err.message || 'Could not load equipment');
    }
  }

  function renderShell(qrCode) {
    document.body.innerHTML = `
      <div class="public-scan-container">
        <div class="public-scan-header">
          <div class="public-scan-brand">NEXUS</div>
        </div>
        <div class="public-scan-body" id="publicScanBody">
          <div class="public-scan-loading">Loading equipment details…</div>
        </div>
      </div>
    `;
  }

  function renderDetails(eq, maint) {
    const statusMap = {
      operational:    { label: 'Operational',    color: '#4caf50' },
      needs_service:  { label: 'Needs Service',  color: '#ff9800' },
      down:           { label: 'Down',           color: '#f44336' },
      retired:        { label: 'Retired',        color: '#888' }
    };
    const status = statusMap[eq.status] || { label: eq.status, color: '#888' };
    const pm = eq.next_pm_date ? new Date(eq.next_pm_date) : null;
    const pmStr = pm ? pm.toLocaleDateString() : 'Not scheduled';
    const pmOverdue = pm && pm < new Date();
    const loginUrl = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}&login=1`;
    
    const body = document.getElementById('publicScanBody');
    if (!body) return;
    body.innerHTML = `
      <div class="public-scan-card">
        ${eq.photo_url ? `<img src="${esc(eq.photo_url)}" class="public-scan-photo">` : ''}
        <h1 class="public-scan-name">${esc(eq.name)}</h1>
        <div class="public-scan-loc">📍 ${esc(eq.location)}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
        <div class="public-scan-status" style="background:${status.color}22;border-color:${status.color}">
          <span class="public-scan-dot" style="background:${status.color}"></span>
          <span style="color:${status.color}">${status.label}</span>
        </div>
        <div class="public-scan-fields">
          ${eq.manufacturer ? `<div><label>Manufacturer</label><div>${esc(eq.manufacturer)}</div></div>` : ''}
          ${eq.model ? `<div><label>Model</label><div>${esc(eq.model)}</div></div>` : ''}
          ${eq.serial_number ? `<div><label>Serial Number</label><div>${esc(eq.serial_number)}</div></div>` : ''}
          ${eq.install_date ? `<div><label>Installed</label><div>${new Date(eq.install_date).toLocaleDateString()}</div></div>` : ''}
          ${eq.warranty_until ? `<div><label>Warranty</label><div>${new Date(eq.warranty_until).toLocaleDateString()}</div></div>` : ''}
          <div><label>Next PM</label><div ${pmOverdue ? 'style="color:#f44336"' : ''}>${pmStr}${pmOverdue ? ' (overdue)' : ''}</div></div>
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
          <button class="public-scan-btn public-scan-btn-primary" onclick="(window._NX_PUBLIC_PM_OPEN||alert)('${eq.qr_code}')">🔧 PM Logger</button>
          <button class="public-scan-btn" onclick="window.location.href='${loginUrl}'">🔐 Sign In for Full Details</button>
          <button class="public-scan-btn public-scan-btn-danger" onclick="(window._NX_PUBLIC_REPORT_OPEN||alert)('${eq.qr_code}')">🚨 Report Issue</button>
        </div>
        <div class="public-scan-footer">Powered by NEXUS · Restaurant Operations Intelligence</div>
      </div>
    `;
  }

  /* ═════════════════════════════════════════════════════════════════════
     BOOT LOADER + ERROR SCREEN
     ═════════════════════════════════════════════════════════════════════ */

  function renderBootLoader(qrCode) {
    const boot = document.createElement('div');
    boot.id = 'nxPublicBoot';
    boot.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: #0a0a0f;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #c8a44e;
    `;
    boot.innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 11px; letter-spacing: 2px; opacity: 0.6; margin-bottom: 16px;">NEXUS</div>
        <div style="
          width: 40px; height: 40px; margin: 0 auto 20px;
          border: 3px solid rgba(200, 164, 78, 0.2);
          border-top-color: #c8a44e;
          border-radius: 50%;
          animation: nxBootSpin 0.8s linear infinite;
        "></div>
        <div style="font-size: 13px; opacity: 0.75; margin-bottom: 6px;">Loading equipment…</div>
        <div style="font-size: 10px; opacity: 0.4; font-family: 'JetBrains Mono', monospace;">${esc(qrCode)}</div>
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

  function showError(msg) {
    const container = document.getElementById('nxPublicBoot') || document.getElementById('publicScanBody');
    if (!container) return;
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; max-width: 340px; margin: 0 auto;">
        <div style="font-size: 40px; margin-bottom: 12px; color: #c8a44e;">⚠</div>
        <div style="font-size: 16px; font-weight: 600; color: #e6dccc; margin-bottom: 8px;">
          Could not load equipment
        </div>
        <div style="font-size: 12px; color: #8a826f; margin-bottom: 20px; line-height: 1.5;">
          ${esc(msg)}
        </div>
        <button onclick="location.reload()" style="
          padding: 10px 24px;
          background: #c8a44e;
          color: #1a1408;
          border: none; border-radius: 8px;
          font-size: 13px; font-weight: 600;
        ">Reload</button>
        <button onclick="location.href=location.pathname" style="
          display: block; margin: 12px auto 0;
          padding: 8px 20px;
          background: transparent;
          color: #8a826f;
          border: 1px solid #3a3a46;
          border-radius: 8px;
          font-size: 12px;
        ">Go to NEXUS</button>
      </div>
    `;
  }

  /* ═════════════════════════════════════════════════════════════════════
     UTILITY
     ═════════════════════════════════════════════════════════════════════ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  console.log('[public-scan v3] self-contained mode, eq=', equipParam);
})();
