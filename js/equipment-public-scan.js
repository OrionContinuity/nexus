/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Public Scan Detector
   Load this BEFORE other scripts. If ?equip=XXX is in URL and NOT ?login=1,
   shows public read-only equipment view instead of the login/auth flow.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');
  const forceLogin = params.get('login') === '1';

  if (!equipParam || forceLogin) return; // Normal flow

  // Check if a session already exists — if so, proceed normally
  try {
    const existingSession = localStorage.getItem('nx_session') || localStorage.getItem('sb-auth');
    if (existingSession) {
      // Logged in — normal flow will pick up the equip param
      return;
    }
  } catch(e) {}

  // Mark this as a public scan so the app doesn't try to auth
  window._NX_PUBLIC_SCAN = equipParam;

  // Wait for Supabase to be initialized, then render public view
  function waitForNX() {
    if (window.NX && window.NX.sb && window.NX.modules?.equipment?.renderPublicScanView) {
      window.NX.modules.equipment.renderPublicScanView(equipParam);
    } else {
      setTimeout(waitForNX, 100);
    }
  }
  waitForNX();
})();
