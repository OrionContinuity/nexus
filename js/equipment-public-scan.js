/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Public Scan Detector v2
   
   When a ?equip=XXX URL is opened (QR code scan) and no login is forced,
   show the public equipment scan view — which gives contractors three
   options: PM Logger / Login / Report Issue.
   
   Fix vs v1: The v1 detector waited for NX.modules.equipment.renderPublicScanView
   to appear in global scope — but that function is defined inside 
   equipment-p3.js which is lazy-loaded only when the user navigates to
   the Equipment tab AFTER logging in. So for unauthenticated QR scans,
   that function never existed and the polling ran forever — the app
   would fall through to the login screen.
   
   v2 eagerly loads the equipment scripts the public view needs:
     • equipment.js (base module)
     • equipment-p3.js (defines renderPublicScanView)
     • equipment-public-pm.js is already loaded globally (PM Logger button)
   ═══════════════════════════════════════════════════════════════════════ */

(function(){
  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');
  const forceLogin = params.get('login') === '1';

  if (!equipParam || forceLogin) return; // Normal flow

  // Check if a session already exists — if so, proceed normally.
  // NOTE: NEXUS uses sessionStorage for session (nexus_current_user +
  // nexus_session_token). We only skip the public view if a REAL session
  // is active — not just localStorage junk from other apps.
  try {
    const activeUser = sessionStorage.getItem('nexus_current_user');
    const activeToken = sessionStorage.getItem('nexus_session_token');
    if (activeUser && activeToken) {
      // Logged in — normal flow will pick up the equip param
      return;
    }
  } catch(e) {}

  // Mark this as a public scan so the app doesn't try to auth
  window._NX_PUBLIC_SCAN = equipParam;

  // Show a loading state immediately — otherwise there's a 1-2 second
  // period where the user sees nothing while scripts load
  renderBootLoader(equipParam);

  // Wait for Supabase to be initialized. Two paths:
  //  1. app.js runs its init() and sets NX.sb — normal flow (fast)
  //  2. app.js is slow to parse (long chain of blocking scripts before it)
  //     — we fall back to creating our own Supabase client from the CDN
  //     using the hardcoded credentials also present in app.js
  //
  // Timeout bumped to 15s to accommodate slow phones + slow networks.
  // The original 5s was too tight — on a cold phone with bad wifi, the
  // blocking scripts in <body> (PDF.js, mammoth, xlsx) can push app.js
  // initialization past 5 seconds.
  waitFor(() => window.NX && window.NX.sb, () => {
    proceedWithScriptLoad();
  }, 8000, () => {
    // Fallback: app.js hasn't initialized Supabase yet. Create our own
    // client using the CDN global + hardcoded creds.
    console.warn('[public-scan] app.js slow, initializing own Supabase client');
    if (!window.supabase || !window.supabase.createClient) {
      showErrorScreen(new Error('Supabase CDN did not load'));
      return;
    }
    window.NX = window.NX || {};
    window.NX.sb = window.supabase.createClient(
      'https://oprsthfxqrdbwdvommpw.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnN0aGZ4cXJkYndkdm9tbXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDU2MzMsImV4cCI6MjA5MTE4MTYzM30.1Yy5BNXWy19Xzdt-ZdcoF0_MF6vvr1rYN5mcDsRYSWY'
    );
    proceedWithScriptLoad();
  });

  function proceedWithScriptLoad() {
    // Now eagerly load the equipment script needed for the public view.
    // renderPublicScanView is now inside equipment.js (consolidated — was
    // previously in equipment-p3.js). equipment.js is lazy-loaded only
    // when user taps Equipment tab AFTER logging in — but the public view
    // runs pre-auth, so we load it now.
    loadScript('js/equipment.js', () => {
      // Wait for the function to actually be defined on NX.modules.equipment
      waitFor(
        () => window.NX?.modules?.equipment?.renderPublicScanView,
        () => {
          try {
            window.NX.modules.equipment.renderPublicScanView(equipParam);
          } catch (e) {
            console.error('[public-scan] render failed:', e);
            showErrorScreen(e);
          }
        },
        5000,
        () => showErrorScreen(new Error('renderPublicScanView not found after equipment.js loaded'))
      );
    }, () => showErrorScreen(new Error('equipment.js failed to load')));
  }

  /* ─── Helpers ───────────────────────────────────────────────────────── */

  function loadScript(src, onLoad, onError) {
    // Check if already loaded
    if (document.querySelector(`script[src="${src}"]`)) {
      if (onLoad) onLoad();
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 2;
    
    function tryLoad() {
      attempts++;
      const s = document.createElement('script');
      s.src = src + (attempts > 1 ? '?retry=' + attempts : '');
      s.onload = () => { if (onLoad) onLoad(); };
      s.onerror = () => {
        console.warn(`[public-scan] ${src} attempt ${attempts} failed`);
        s.remove();
        if (attempts < maxAttempts) {
          // Retry after short delay — mobile networks often recover
          setTimeout(tryLoad, 600);
        } else {
          if (onError) onError();
        }
      };
      document.head.appendChild(s);
    }
    
    tryLoad();
  }

  function waitFor(check, onReady, timeoutMs, onTimeout) {
    const start = Date.now();
    const poll = () => {
      if (check()) return onReady();
      if (timeoutMs && Date.now() - start > timeoutMs) {
        if (onTimeout) onTimeout();
        return;
      }
      setTimeout(poll, 80);
    };
    poll();
  }

  function renderBootLoader(qrCode) {
    // Inject a minimal loading screen so users see immediate feedback
    // while scripts load. Styled to match the public scan aesthetic.
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
        <div style="font-size: 10px; opacity: 0.4; font-family: 'JetBrains Mono', monospace;">${qrCode}</div>
      </div>
      <style>
        @keyframes nxBootSpin { to { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(boot);
  }

  function showErrorScreen(err) {
    const boot = document.getElementById('nxPublicBoot');
    if (!boot) return;
    boot.innerHTML = `
      <div style="text-align: center; padding: 24px; max-width: 340px;">
        <div style="font-size: 40px; margin-bottom: 12px;">⚠</div>
        <div style="font-size: 16px; font-weight: 600; color: #e6dccc; margin-bottom: 8px;">
          Could not load equipment
        </div>
        <div style="font-size: 12px; color: #8a826f; margin-bottom: 20px; line-height: 1.5;">
          ${err?.message || 'Unknown error'}
        </div>
        <button onclick="location.reload()" style="
          padding: 10px 24px;
          background: #c8a44e;
          color: #1a1408;
          border: none; border-radius: 8px;
          font-size: 13px; font-weight: 600;
          cursor: pointer;
        ">Reload</button>
        <button onclick="location.href=location.pathname" style="
          display: block; margin: 12px auto 0;
          padding: 8px 20px;
          background: transparent;
          color: #8a826f;
          border: 1px solid #3a3a46;
          border-radius: 8px;
          font-size: 12px;
          cursor: pointer;
        ">Go to NEXUS</button>
      </div>
    `;
  }
})();
