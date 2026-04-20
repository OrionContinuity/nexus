/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Equipment Cleanup v1
   
   Strips visual clutter and fixes UX nits:
   
   1. List header: removes "🖨 QR Sheet" (legacy) + "🏷️ Zebra" (Phase 3 batch).
      Both are replaced by the per-row Zebra badge + the bottom-bar Print
      that auto-prints the active tab.
   
   2. Parts tab head: removes "🛒 Shopping List" + "✨ Extract from Manual".
      These move into the ⋯ menu in equipment-context-menu.js.
   
   3. Hides the legacy "Order" link in the LEFT side of each part row.
      Order buttons live ONLY inside vendor cards now.
   
   4. Hides "FAMILY / Set Parent / Add Child" section from Overview.
      Moves to ⋯ menu instead.
   
   5. Patches quickPrint() in equipment-ux.js so a missing Zebra printer
      no longer spams "Print failed: Failed to fetch" toasts. Silent
      fallback to HTML print.
   
   Load order: AFTER equipment-fixes.js, BEFORE equipment-context-menu.js.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  function whenReady(check, fn, maxWait = 5000) {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); fn(); }
      else if (Date.now() - start > maxWait) { clearInterval(interval); }
    }, 100);
  }

  whenReady(
    () => NX && NX.modules && NX.modules.equipment,
    () => init()
  );

  function init() {
    console.log('[eq-cleanup] initializing UI cleanup');
    cleanupListHeader();
    cleanupPartsHead();
    hideFamilySection();
    hideLegacyOrderLink();
    silenceZebraToastSpam();
    console.log('[eq-cleanup] done');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     1+2: Strip clutter buttons via MutationObserver — these get re-injected
     by equipment-p3.js + equipment.js, so we observe and remove on every
     re-render rather than just doing a one-shot at startup.
     ═════════════════════════════════════════════════════════════════════════ */

  function cleanupListHeader() {
    const observer = new MutationObserver(() => {
      // QR Sheet button (rendered in equipment.js buildUI)
      const qrBtn = document.getElementById('eqPrintQRs');
      if (qrBtn) qrBtn.remove();
      
      // Zebra batch button (injected by equipment-p3.js)
      document.querySelectorAll('.eq-zebra-header-btn').forEach(b => b.remove());
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Initial pass
    setTimeout(() => {
      const qrBtn = document.getElementById('eqPrintQRs');
      if (qrBtn) qrBtn.remove();
      document.querySelectorAll('.eq-zebra-header-btn').forEach(b => b.remove());
    }, 100);
  }

  function cleanupPartsHead() {
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.eq-parts-head').forEach(head => {
        // Find buttons by their text content
        head.querySelectorAll('button').forEach(btn => {
          const t = btn.textContent.trim();
          if (/Shopping List|Extract from Manual/i.test(t)) {
            btn.remove();
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     3: Hide the legacy "Order" link in the LEFT side of part rows.
        It's an <a> tag with class eq-btn-tiny inside .eq-part-actions.
        The vendor cards (rendered by equipment-fixes.js) have their own
        "Order" buttons that should remain.
     ═════════════════════════════════════════════════════════════════════════ */

  function hideLegacyOrderLink() {
    // Inject a one-time CSS rule that hides the legacy Order link inside
    // .eq-part-actions but NOT inside .eq-part-vendors (the new vendor cards).
    const style = document.createElement('style');
    style.id = 'eq-cleanup-styles';
    style.textContent = `
      /* Hide legacy single-Order link on part rows */
      .eq-part > .eq-part-actions > a.eq-btn-tiny,
      .eq-part-main + .eq-part-actions > a {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     4: Hide the FAMILY section (Set Parent / Add Child).
        These move to the ⋯ menu so they're available but not in the way.
        We identify the section by its label "FAMILY" or by the buttons
        "+ Set Parent" / "+ Add Child" in the Overview panel.
     ═════════════════════════════════════════════════════════════════════════ */

  function hideFamilySection() {
    const observer = new MutationObserver(() => {
      document.querySelectorAll('[data-panel="overview"]').forEach(panel => {
        // Find the FAMILY label and walk to its container
        const labels = panel.querySelectorAll('div, h4, h3, span, label');
        for (const lbl of labels) {
          const text = (lbl.textContent || '').trim();
          if (text === 'FAMILY' || text === '👥 FAMILY' || /^👥?\s*FAMILY\s*$/.test(text)) {
            // Find the container (parent that includes the buttons)
            let container = lbl;
            // Walk up until we find a container that also includes the Set Parent btn
            for (let i = 0; i < 5; i++) {
              if (!container.parentElement) break;
              container = container.parentElement;
              if (container.querySelector('button')) {
                const btnText = container.textContent;
                if (btnText.includes('Set Parent') || btnText.includes('Add Child')) {
                  break;
                }
              }
            }
            // Hide the whole family block
            if (container && !container.dataset.familyHidden) {
              container.dataset.familyHidden = '1';
              container.style.display = 'none';
            }
            break;
          }
        }
        // Belt-and-suspenders: also directly hide buttons by text
        panel.querySelectorAll('button').forEach(btn => {
          const t = btn.textContent.trim();
          if (/^\+\s*Set Parent$/i.test(t) || /^\+\s*Add Child$/i.test(t)) {
            // Hide the parent row containing both buttons
            const row = btn.closest('div');
            if (row && !row.dataset.familyHidden) {
              row.dataset.familyHidden = '1';
              row.style.display = 'none';
            }
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     5: Silence the "Print failed: Failed to fetch" toast spam.
        equipment-ux.js's quickPrint() calls printZebraSingle which fails
        when no Zebra Browser Print server is running. Wrap it so failure
        silently falls back to HTML print instead of toasting.
     ═════════════════════════════════════════════════════════════════════════ */

  function silenceZebraToastSpam() {
    whenReady(
      () => NX.modules.equipment.quickPrint,
      () => {
        const original = NX.modules.equipment.quickPrint;
        NX.modules.equipment.quickPrint = function(equipId) {
          // Try Zebra silently. If it fails, fall back to HTML print
          // without toasting an error.
          try {
            // Wrap NX.toast briefly to suppress Zebra error toasts
            const realToast = NX.toast;
            let suppressedErrors = 0;
            NX.toast = function(msg, type, dur) {
              if (type === 'error' && /Print failed|Zebra|BrowserPrint|Failed to fetch/i.test(msg)) {
                suppressedErrors++;
                console.warn('[eq-cleanup] suppressed Zebra error toast:', msg);
                return;
              }
              return realToast.call(NX, msg, type, dur);
            };
            
            try {
              original.call(this, equipId);
            } catch (e) {
              console.warn('[eq-cleanup] quickPrint threw, falling back to HTML:', e);
            }
            
            // Restore real toast after 2s
            setTimeout(() => { 
              NX.toast = realToast;
              // If Zebra failed silently, fall back to HTML print
              if (suppressedErrors > 0 && NX.ctxMenu?.printSingleLabel) {
                NX.ctxMenu.printSingleLabel(equipId);
              }
            }, 2000);
          } catch (e) {
            // Last resort — HTML print
            if (NX.ctxMenu?.printSingleLabel) NX.ctxMenu.printSingleLabel(equipId);
          }
        };
        console.log('[eq-cleanup] quickPrint patched — Zebra failures now silent');
      }
    );
  }

})();
