/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Badge Print Choice v1
   
   Patches the inline 🏷 badge on each equipment row/card so tapping it
   pops up a small menu with two options:
     • 🏷 Zebra     — print thermal sticker (if printer available)
     • 📄 Paper     — print HTML/Avery sticker (any printer)
   
   This way when the Zebra is down, you still have a print path.
   
   Load order: AFTER equipment-ux.js (which defines quickPrint).
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  function whenReady(check, fn, maxWait = 5000) {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); fn(); }
      else if (Date.now() - start > maxWait) { clearInterval(interval); }
    }, 80);
  }

  whenReady(
    () => NX && NX.modules && NX.modules.equipment,
    () => init()
  );

  function init() {
    console.log('[badge-choice] initializing badge print choice');
    patchQuickPrint();
  }

  function patchQuickPrint() {
    // The original quickPrint goes straight to Zebra. We replace it with
    // a popup choice. The originals are kept available as Zebra-direct and
    // HTML-direct paths.
    
    const EQ = NX.modules.equipment;
    
    // Save original Zebra-direct path (if exists)
    const originalZebraPath = EQ.printZebraSingle || EQ.quickPrint;
    
    // Override quickPrint to show choice popup
    EQ.quickPrint = function(equipId) {
      showBadgeChoicePopup(equipId, originalZebraPath);
    };
  }

  function showBadgeChoicePopup(equipId, zebraFn) {
    // Remove any existing popup
    document.querySelectorAll('.badge-choice-popup').forEach(p => p.remove());
    
    const popup = document.createElement('div');
    popup.className = 'badge-choice-popup';
    popup.innerHTML = `
      <div class="badge-choice-bg"></div>
      <div class="badge-choice-card">
        <div class="badge-choice-title">Print Label</div>
        <div class="badge-choice-options">
          <button class="badge-choice-btn" id="badgeChoiceZebra">
            <span class="badge-choice-icon">🏷</span>
            <span class="badge-choice-name">Zebra</span>
            <span class="badge-choice-sub">Thermal sticker</span>
          </button>
          <button class="badge-choice-btn" id="badgeChoicePaper">
            <span class="badge-choice-icon">📄</span>
            <span class="badge-choice-name">Paper</span>
            <span class="badge-choice-sub">HTML print</span>
          </button>
        </div>
        <button class="badge-choice-cancel" id="badgeChoiceCancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(popup);
    
    const close = () => popup.remove();
    popup.querySelector('.badge-choice-bg').addEventListener('click', close);
    popup.querySelector('#badgeChoiceCancel').addEventListener('click', close);
    
    popup.querySelector('#badgeChoiceZebra').addEventListener('click', () => {
      close();
      // Try Zebra path. If it errors silently (the cleanup module suppresses
      // toast spam), fall back to HTML print.
      try {
        if (typeof zebraFn === 'function') {
          zebraFn(equipId);
        } else if (NX.ctxMenu?.printSingleLabel) {
          NX.ctxMenu.printSingleLabel(equipId);
        }
      } catch (e) {
        console.warn('[badge-choice] Zebra failed, falling back:', e);
        if (NX.ctxMenu?.printSingleLabel) NX.ctxMenu.printSingleLabel(equipId);
      }
    });
    
    popup.querySelector('#badgeChoicePaper').addEventListener('click', () => {
      close();
      // Direct HTML print — uses the centered single label format
      if (NX.ctxMenu?.printSingleLabel) {
        NX.ctxMenu.printSingleLabel(equipId);
      } else {
        alert('Print module not loaded yet — try again in a moment');
      }
    });
  }

})();
