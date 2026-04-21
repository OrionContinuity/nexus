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
  
  // NUCLEAR OPTION: If a Service Worker is controlling this page, unregister
  // it and reload. The SW has been interfering with blob URL injection (the
  // debug dumps proved this — blob onload fires but script body never runs).
  //
  // After the reload, we'll load without a SW, everything works as plain
  // HTTP + scripts, no interference. The SW will re-register on the next
  // visit, but by then we've already shown the 3-button public view.
  //
  // We use sessionStorage as a flag to prevent infinite reload loops.
  if (navigator.serviceWorker?.controller && !sessionStorage.getItem('_nx_sw_nuked')) {
    console.warn('[public-scan] SW detected, unregistering for clean load');
    sessionStorage.setItem('_nx_sw_nuked', '1');
    navigator.serviceWorker.getRegistrations().then(regs => {
      return Promise.all(regs.map(r => r.unregister()));
    }).then(() => {
      // Also clear all caches so we don't serve stale stuff
      if (window.caches) {
        return caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
      }
    }).then(() => {
      // Hard reload - bypass all caches
      window.location.reload();
    }).catch(err => {
      console.error('[public-scan] SW unregister failed:', err);
      // Proceed anyway
    });
    return; // Don't proceed with normal load — wait for reload
  }

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
    // Strategy: FETCH equipment.js as text, then evaluate it inside an
    // inline <script> block with an explicit NX binding at the top.
    //
    // Why: Loading equipment.js via <script src="..."> relies on the
    // browser resolving the bare `NX` identifier correctly. In our
    // pre-auth flow, app.js may not have run (so no `const NX` at
    // script-scope), and window.NX may not shadow properly depending on
    // how other scripts interact.
    //
    // By fetching as text and injecting as inline code with `var NX = 
    // window.NX;` at the very top, we guarantee the bare `NX` identifier
    // resolves to our window.NX regardless of what app.js may or may not
    // have done.
    //
    // CACHE-BUST with timestamp to guarantee fresh fetch from GitHub Pages.
    
    const cacheBust = '?v=' + Date.now();
    const url = 'js/equipment.js' + cacheBust;
    
    fetch(url, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(source => {
        // Verify we got the consolidated version (has renderPublicScanView)
        if (!source.includes('function renderPublicScanView')) {
          throw new Error(
            `Fetched equipment.js is STALE — missing renderPublicScanView. ` +
            `Size: ${source.length} bytes. Expected ~189KB consolidated version.`
          );
        }
        
        if (!source.includes('renderPublicScanView,')) {
          throw new Error('equipment.js does not export renderPublicScanView');
        }
        
        // Log what we fetched so we can confirm in console
        console.log('[public-scan] fetched source OK:', source.length, 'bytes');
        window._NX_DEBUG = {
          fetched_size: source.length,
          has_render: source.includes('function renderPublicScanView'),
          has_export: source.includes('renderPublicScanView,'),
          first_100: source.substring(0, 100),
          last_100: source.substring(source.length - 100)
        };
        
        const wrappedCode = 
          'window.NX = window.NX || {};\n' +
          'var NX = window.NX;\n' +
          'window._NX_TRACE = "start";\n' +
          'console.log("[wrapper] executing, NX=", typeof NX, "window.NX=", typeof window.NX);\n' +
          'try {\n' +
          'window._NX_TRACE = "entering-iife";\n' +
          source + '\n' +
          'window._NX_TRACE = "iife-completed";\n' +
          'console.log("[wrapper] IIFE done, NX.modules=", typeof window.NX?.modules);\n' +
          '} catch(e) {\n' +
          '  window._NX_PUBLIC_SCAN_ERROR = e;\n' +
          '  window._NX_TRACE = "threw: " + (e.message || e);\n' +
          '  console.error("[equipment.js eval failed]", e);\n' +
          '}\n';
        
        window._NX_DEBUG.wrapped_size = wrappedCode.length;
        
        const blob = new Blob([wrappedCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        window._NX_DEBUG.blob_url = blobUrl;
        console.log('[public-scan] blob URL:', blobUrl);
        
        const wrapper = document.createElement('script');
        wrapper.src = blobUrl;
        
        let loaded = false;
        wrapper.onerror = (e) => {
          window._NX_DEBUG.blob_onerror = e?.type || 'error';
          URL.revokeObjectURL(blobUrl);
          showDebugScreen('Blob script onerror fired');
        };
        wrapper.onload = () => {
          loaded = true;
          window._NX_DEBUG.blob_onload = true;
          URL.revokeObjectURL(blobUrl);
          
          if (window._NX_PUBLIC_SCAN_ERROR) {
            showErrorScreen(window._NX_PUBLIC_SCAN_ERROR);
            return;
          }
          
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
            3000,
            () => showDebugScreen('Timeout waiting for renderPublicScanView')
          );
        };
        
        document.head.appendChild(wrapper);
        window._NX_DEBUG.wrapper_appended = true;
        
        // Also set a hard timeout in case neither onload nor onerror fire
        setTimeout(() => {
          if (!loaded && !window._NX_PUBLIC_SCAN_ERROR) {
            showDebugScreen('Neither onload nor onerror fired after 5s');
          }
        }, 5000);
      })
      .catch(err => {
        console.error('[public-scan] fetch/eval error:', err);
        showErrorScreen(err);
      });
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
  
  function showDebugScreen(reason) {
    const boot = document.getElementById('nxPublicBoot');
    if (!boot) return;
    const dbg = window._NX_DEBUG || {};
    const state = {
      reason,
      trace: window._NX_TRACE || '(none)',
      err: window._NX_PUBLIC_SCAN_ERROR?.message || '(none)',
      window_NX: typeof window.NX,
      NX_modules: typeof window.NX?.modules,
      NX_modules_equipment: typeof window.NX?.modules?.equipment,
      renderPublicScanView: typeof window.NX?.modules?.equipment?.renderPublicScanView,
      sw_controller: !!navigator.serviceWorker?.controller,
      sw_scope: navigator.serviceWorker?.controller?.scriptURL || '(none)',
      ua: navigator.userAgent.substring(0, 80),
      ...dbg
    };
    
    boot.style.background = '#0a0a0f';
    boot.style.alignItems = 'flex-start';
    boot.style.padding = '20px';
    boot.innerHTML = `
      <div style="width: 100%; max-width: 500px; margin: 0 auto; color: #e6dccc;">
        <div style="font-size: 20px; font-weight: 700; color: #c8a44e; margin-bottom: 4px;">
          Debug Info
        </div>
        <div style="font-size: 13px; color: #8a826f; margin-bottom: 20px;">
          Send this to Claude so it can fix the issue.
        </div>
        <pre style="
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          line-height: 1.6;
          background: #15151c;
          border: 1px solid #2a2a33;
          border-radius: 8px;
          padding: 14px;
          white-space: pre-wrap;
          word-break: break-all;
          color: #c8c0b0;
          max-height: 60vh;
          overflow-y: auto;
        ">${Object.entries(state).map(([k, v]) => 
          `<span style="color:#c8a44e">${k}</span>: ${typeof v === 'string' ? v.replace(/</g, '&lt;') : JSON.stringify(v)}`
        ).join('\n')}</pre>
        <button onclick="
          const txt = document.querySelector('pre').innerText;
          navigator.clipboard?.writeText(txt).then(() => {
            this.textContent = 'Copied ✓';
            setTimeout(() => this.textContent = 'Copy Debug Info', 1500);
          });
        " style="
          display: block; width: 100%; margin-top: 16px;
          padding: 12px;
          background: #c8a44e;
          color: #1a1408;
          border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600;
          cursor: pointer;
        ">Copy Debug Info</button>
        <button onclick="location.reload()" style="
          display: block; width: 100%; margin-top: 10px;
          padding: 10px;
          background: transparent;
          color: #8a826f;
          border: 1px solid #3a3a46;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
        ">Reload</button>
      </div>
    `;
  }
})();
