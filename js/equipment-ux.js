/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment UX Patches v1
   - Zebra print button prominent on every equipment detail
   - Zebra quick-print on every list row (swipe or tap)
   - Grid cards get Zebra icon
   - Works even if Phase 3 isn't loaded (falls back to paper sticker)
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

if (!NX.modules || !NX.modules.equipment) {
  console.warn('[EquipUX] Base equipment module not loaded, retrying…');
  return setTimeout(arguments.callee, 500);
}

const EQ = NX.modules.equipment;

/* ═══ Helper: print via Zebra if loaded, else paper sticker ═══ */
function quickPrint(equipId) {
  // Prefer Zebra (Phase 3)
  if (EQ.printZebraSingle) {
    EQ.printZebraSingle(equipId);
  } else if (EQ.printSingleQR) {
    // Paper sticker fallback (Phase 1)
    EQ.printSingleQR(equipId);
  } else {
    NX.toast && NX.toast('Print module not available', 'error');
  }
}

/* ═══ Expose globally for onclick handlers ═══ */
NX.modules.equipment.quickPrint = quickPrint;

/* ═══ Intercept openDetail to add prominent Zebra button in action bar ═══ */
const _originalOpen = EQ.openDetail;
EQ.openDetail = async function(id) {
  await _originalOpen(id);

  // Add Zebra print as a prominent button in the action bar
  setTimeout(() => {
    const modal = document.getElementById('eqModal');
    if (!modal) return;
    const actions = modal.querySelector('.eq-detail-actions');
    if (!actions || actions.querySelector('.eq-zebra-action-btn')) return;

    // Insert Print Label as PRIMARY action (left of Edit)
    const printBtn = document.createElement('button');
    printBtn.className = 'eq-btn eq-btn-primary eq-zebra-action-btn';
    printBtn.innerHTML = '🏷️ Print Label';
    printBtn.title = 'Print QR label on Zebra printer';
    printBtn.addEventListener('click', () => quickPrint(id));

    // Insert at the very beginning so it's the first/most prominent
    actions.insertBefore(printBtn, actions.firstChild);
  }, 150);
};

/* ═══ Add per-row Print button on list view ═══ */
const _originalBuildUI = EQ.buildUI;
if (_originalBuildUI) {
  EQ.buildUI = function() {
    _originalBuildUI.apply(this, arguments);
    injectListRowButtons();
  };
}

function injectListRowButtons() {
  // Watch for list re-renders
  const list = document.getElementById('eqList');
  if (!list) return;

  // Use MutationObserver to catch re-renders
  if (list._uxObserverAdded) return;
  list._uxObserverAdded = true;

  const observer = new MutationObserver(() => {
    list.querySelectorAll('.eq-row[data-eq-id]').forEach(row => {
      if (row.dataset.ux === '1') return;
      row.dataset.ux = '1';

      // Add print icon to every row (except header)
      if (row.classList.contains('eq-row-head')) return;

      const id = row.dataset.eqId;
      const printBtn = document.createElement('button');
      printBtn.className = 'eq-row-print';
      printBtn.innerHTML = '🏷️';
      printBtn.title = 'Print label';
      printBtn.addEventListener('click', e => {
        e.stopPropagation();
        quickPrint(id);
      });
      row.appendChild(printBtn);
    });

    // Grid cards
    list.querySelectorAll('.eq-card[data-eq-id]').forEach(card => {
      if (card.dataset.ux === '1') return;
      card.dataset.ux = '1';
      const id = card.dataset.eqId;
      const printBtn = document.createElement('button');
      printBtn.className = 'eq-card-print';
      printBtn.innerHTML = '🏷️';
      printBtn.title = 'Print label';
      printBtn.addEventListener('click', e => {
        e.stopPropagation();
        quickPrint(id);
      });
      card.querySelector('.eq-card-top')?.appendChild(printBtn);
    });
  });

  observer.observe(list, { childList: true, subtree: true });

  // Trigger initial pass
  setTimeout(() => {
    list.querySelectorAll('.eq-row[data-eq-id], .eq-card[data-eq-id]').forEach(el => {
      el.dataset.ux = '';
    });
    observer.takeRecords(); // force callback
    list.dispatchEvent(new Event('DOMSubtreeModified')); // trigger
  }, 100);
}

// Call once on load
setTimeout(injectListRowButtons, 200);
setTimeout(injectListRowButtons, 1000);
setTimeout(injectListRowButtons, 3000);

console.log('[EquipUX] Loaded');

})();
