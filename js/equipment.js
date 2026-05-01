/* ═══════════════════════════════════════════════════════════════════════════════

   NEXUS EQUIPMENT — unified module
   ────────────────────────────────
   One file. Everything equipment-related lives here.

   This replaces:
     equipment.js, equipment-ai.js, equipment-p3.js, equipment-ux.js,
     equipment-ai-creator.js, equipment-full-editor.js, equipment-p4.js

   Structure:
     1. CONSTANTS & STATE
     2. CORE            — CRUD, filtering, list/grid render
     3. DETAIL          — the detail modal (overview/timeline/parts/manual/qr + intel + family + dispatch)
     4. EDIT            — full editor (6 tabs), add/edit modal, service log, parts
     5. AI              — data plate scanner, manual fetch, BOM extract, pattern detect, cost
     6. AI CREATE       — describe/photo/bulk/dataplate entry points
     7. PRINTING        — QR paper stickers + Zebra ZPL + Labelary preview
     8. PUBLIC SCAN     — no-auth QR view + report issue
     9. ATTACHMENTS     — files, photos, links, notes, custom fields
    10. LINEAGE         — family tree (parent/child equipment)
    11. DISPATCH        — contractor dispatch sheet, dispatch_log
    12. UI INJECTION    — header buttons, detail actions, per-row buttons
    13. UTILITIES       — esc, escAttr, fileToBase64, catIcon, etc.
    14. EXPORT          — NX.modules.equipment

   ═══════════════════════════════════════════════════════════════════════════════ */

(function(){

/* ════════════════════════════════════════════════════════════════════════════
   1. CONSTANTS & STATE
   ════════════════════════════════════════════════════════════════════════════ */

const LOCATIONS = ['Suerte', 'Este', 'Bar Toti'];
const CATEGORIES = [
  { key: 'refrigeration', label: 'Refrigeration', icon: '❄' },
  { key: 'cooking',       label: 'Cooking',       icon: '🔥' },
  { key: 'ice',           label: 'Ice',           icon: '🧊' },
  { key: 'hvac',          label: 'HVAC',          icon: '💨' },
  { key: 'dish',          label: 'Dishwashing',   icon: '🧼' },
  { key: 'bev',           label: 'Beverage',      icon: '🥤' },
  { key: 'smallware',     label: 'Smallware',     icon: '🍴' },
  { key: 'furniture',     label: 'Furniture',     icon: '🪑' },
  { key: 'other',         label: 'Other',         icon: '⚙' }
];
const STATUSES = [
  { key: 'operational',   label: 'Operational',   color: 'var(--green)' },
  { key: 'needs_service', label: 'Needs Service', color: 'var(--amber)' },
  { key: 'down',          label: 'Down',          color: 'var(--red)' },
  { key: 'retired',       label: 'Retired',       color: 'var(--muted)' }
];
const RELATIONSHIP_TYPES = [
  { key: 'depends_on',     label: 'Depends on',     icon: '⬆' },
  { key: 'serves',         label: 'Serves',         icon: '⬇' },
  { key: 'connected_to',   label: 'Connected to',   icon: '⇄' },
  { key: 'feeds',          label: 'Feeds',          icon: '→' },
  { key: 'pairs_with',     label: 'Pairs with',     icon: '⇋' },
  { key: 'shares_circuit', label: 'Shares circuit', icon: '⚡' },
];
const ZEBRA_CONFIG = {
  dpi: 203,
  labelSizes: {
    '2x1': { width: 2, height: 1, widthDots: 406, heightDots: 203 },
    '2x2': { width: 2, height: 2, widthDots: 406, heightDots: 406 },
    '3x2': { width: 3, height: 2, widthDots: 609, heightDots: 406 },
    '4x2': { width: 4, height: 2, widthDots: 812, heightDots: 406 }
  }
};
const ZEBRA_BP_URL = 'http://localhost:9100';

// Module state
let equipment = [];
let activeFilter = { location: 'all', status: 'all', category: 'all', pm: 'all' };
let viewMode = 'list';          // 'list' | 'grid'
let currentEquipId = null;
let searchQuery = '';
let zebraBrowserPrintLoaded = false;


/* ════════════════════════════════════════════════════════════════════════════
   2. CORE — init, load, UI skeleton, list/grid render
   ════════════════════════════════════════════════════════════════════════════ */

async function init() {
  // Check for QR scan on load (?equip=eq_xxxxx)
  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');

  await loadEquipment();
  buildUI();

  if (equipParam) {
    const eq = equipment.find(e => e.qr_code === equipParam);
    if (eq) {
      // v4: toast confirmation so the user sees the app is navigating to the
      // scanned item — silent navigation previously left people wondering if
      // the tap "did anything."
      NX.toast && NX.toast(`📲 Opening ${eq.name}…`, 'info', 2200);
      document.querySelector('.nav-tab[data-view="equipment"]')?.click();
      document.querySelector('.bnav-btn[data-view="equipment"]')?.click();
      setTimeout(() => openDetail(eq.id), 300);
      const url = new URL(window.location.href);
      url.searchParams.delete('equip');
      window.history.replaceState({}, '', url);
    } else {
      // v4: equipment with that QR code not found — surface rather than silently ignoring
      NX.toast && NX.toast(`QR code ${equipParam} not recognized`, 'warn', 4000);
      const url = new URL(window.location.href);
      url.searchParams.delete('equip');
      window.history.replaceState({}, '', url);
    }
  }
}

async function loadEquipment() {
  try {
    const { data, error } = await NX.sb.from('equipment_with_stats')
      .select('*')
      .order('location', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    equipment = data || [];
  } catch (e) {
    console.error('[Equipment] Load failed, trying base table:', e);
    try {
      const { data } = await NX.sb.from('equipment').select('*').order('name');
      equipment = data || [];
    } catch (e2) {
      console.error('[Equipment] Full load failed:', e2);
      equipment = [];
    }
  }
}

function buildUI() {
  const view = document.getElementById('equipmentView');
  if (!view) return;

  // Apply pending filter intent from elsewhere (e.g., home dashboard
  // PM-Due stat tap). Cleared after apply so it doesn't stick between
  // view switches.
  if (NX.equipmentFilterIntent) {
    Object.assign(activeFilter, NX.equipmentFilterIntent);
    NX.equipmentFilterIntent = null;
  }

  view.innerHTML = `
    <div class="eq-header">
      <div class="eq-title-row">
        <h2 class="eq-title">🔧 Equipment</h2>
        <div class="eq-actions">
          <button class="eq-btn eq-btn-primary eq-ai-create-btn" id="eqAiCreateBtn" title="AI create equipment from photo or description">✨ AI Create</button>
          <button class="eq-btn eq-btn-secondary" id="eqPrintQRs" title="Export equipment stickers (full color, multiple sizes)">🖨 Stickers</button>
          <button class="eq-btn eq-btn-secondary" id="eqAddBtn">+ Manual</button>
        </div>
      </div>

      <div class="eq-search-row">
        <input type="text" class="eq-search" id="eqSearch" placeholder="Search equipment, model, serial...">
        <div class="eq-view-toggle">
          <button class="eq-view-btn ${viewMode==='list'?'active':''}" data-mode="list" title="List view">☰</button>
          <button class="eq-view-btn ${viewMode==='grid'?'active':''}" data-mode="grid" title="Grid view">▦</button>
        </div>
      </div>

      <div class="eq-filters">
        <div class="eq-filter-group">
          <span class="eq-filter-label">Location:</span>
          ${['all', ...LOCATIONS].map(loc => `
            <button class="eq-chip ${activeFilter.location===loc?'active':''}" data-filter="location" data-value="${loc}">
              ${loc === 'all' ? 'All' : loc}
            </button>
          `).join('')}
        </div>
        <div class="eq-filter-group">
          <span class="eq-filter-label">Status:</span>
          ${['all', ...STATUSES.map(s=>s.key)].map(s => {
            const label = s === 'all' ? 'All' : STATUSES.find(x=>x.key===s).label;
            return `<button class="eq-chip ${activeFilter.status===s?'active':''}" data-filter="status" data-value="${s}">${label}</button>`;
          }).join('')}
        </div>
        <div class="eq-filter-group">
          <span class="eq-filter-label">PM:</span>
          <button class="eq-chip ${activeFilter.pm==='all'?'active':''}" data-filter="pm" data-value="all">All</button>
          <button class="eq-chip ${activeFilter.pm==='overdue'?'active':''}" data-filter="pm" data-value="overdue">Overdue</button>
          <button class="eq-chip ${activeFilter.pm==='soon'?'active':''}" data-filter="pm" data-value="soon">Due ≤14d</button>
        </div>
      </div>

      <div class="eq-stats" id="eqStats"></div>
    </div>

    <div class="eq-list" id="eqList"></div>
  `;

  // Wire header buttons
  document.getElementById('eqAiCreateBtn').addEventListener('click', openAICreator);
  document.getElementById('eqAddBtn').addEventListener('click', () => openEditModal(null));
  document.getElementById('eqPrintQRs').addEventListener('click', openStickerExport);
  document.getElementById('eqSearch').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  view.querySelectorAll('.eq-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      buildUI();
    });
  });

  view.querySelectorAll('.eq-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter[chip.dataset.filter] = chip.dataset.value;
      buildUI();
    });
  });

  renderList();
  renderStats();
}

function renderStats() {
  const el = document.getElementById('eqStats');
  if (!el) return;
  const filtered = getFiltered();
  const down   = filtered.filter(e => e.status === 'down').length;
  const needs  = filtered.filter(e => e.status === 'needs_service').length;
  const pmDue  = filtered.filter(e => e.next_pm_date && new Date(e.next_pm_date) <= new Date(Date.now() + 14*86400000)).length;
  const totalCost = filtered.reduce((s, e) => s + (parseFloat(e.cost_this_year) || 0), 0);

  el.innerHTML = `
    <div class="eq-stat"><span class="eq-stat-v">${filtered.length}</span><span class="eq-stat-l">Units</span></div>
    ${down ? `<div class="eq-stat eq-stat-red"><span class="eq-stat-v">${down}</span><span class="eq-stat-l">Down</span></div>` : ''}
    ${needs ? `<div class="eq-stat eq-stat-amber"><span class="eq-stat-v">${needs}</span><span class="eq-stat-l">Needs Service</span></div>` : ''}
    ${pmDue ? `<div class="eq-stat eq-stat-blue"><span class="eq-stat-v">${pmDue}</span><span class="eq-stat-l">PM Due (14d)</span></div>` : ''}
    ${totalCost > 0 ? `<div class="eq-stat"><span class="eq-stat-v">$${Math.round(totalCost).toLocaleString()}</span><span class="eq-stat-l">YTD Repairs</span></div>` : ''}
  `;
}

function getFiltered() {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const in14d = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  return equipment.filter(e => {
    if (activeFilter.location !== 'all' && e.location !== activeFilter.location) return false;
    if (activeFilter.status !== 'all' && e.status !== activeFilter.status) return false;
    if (activeFilter.category !== 'all' && e.category !== activeFilter.category) return false;
    if (activeFilter.pm === 'overdue') {
      if (!e.next_pm_date) return false;
      if (e.next_pm_date >= todayIso) return false; // not overdue
    } else if (activeFilter.pm === 'soon') {
      if (!e.next_pm_date) return false;
      if (e.next_pm_date > in14d) return false;     // too far out
    }
    if (searchQuery) {
      const hay = [e.name, e.model, e.serial_number, e.manufacturer, e.area, e.notes].join(' ').toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });
}

function renderList() {
  const list = document.getElementById('eqList');
  if (!list) return;
  const filtered = getFiltered();
  renderStats();

  if (!filtered.length) {
    list.innerHTML = `
      <div class="eq-empty">
        <div class="eq-empty-icon">🔧</div>
        <div class="eq-empty-title">No equipment yet</div>
        <div class="eq-empty-sub">Add your first piece of equipment to get started.</div>
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.openAICreator()">✨ AI Create</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.add()">+ Manual Add</button>
      </div>`;
    return;
  }

  list.className = 'eq-list eq-list-' + viewMode;

  if (viewMode === 'grid') {
    list.innerHTML = filtered.map(e => buildGridCard(e)).join('');
  } else {
    const allOperational = filtered.length > 0 && filtered.every(e =>
      (e.status || 'operational').toLowerCase() === 'operational');
    list.innerHTML = `
      <div class="eq-table${allOperational ? ' eq-table-uniform' : ''}">
        <div class="eq-row eq-row-head">
          <div class="eq-col eq-col-name">Equipment</div>
          <div class="eq-col eq-col-loc">Location</div>
          <div class="eq-col eq-col-status">Status</div>
          <div class="eq-col eq-col-pm">Next PM</div>
          <div class="eq-col eq-col-services">Svcs</div>
        </div>
        ${filtered.map(e => buildListRow(e)).join('')}
      </div>`;
  }

  // Wire rows → detail
  list.querySelectorAll('[data-eq-id]').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.eqId));
  });

  // Inject per-row/card Zebra quick-print buttons (was equipment-ux.js)
  injectRowPrintButtons();
}

function buildListRow(e) {
  const pm = e.next_pm_date ? new Date(e.next_pm_date) : null;
  const pmOverdue = pm && pm < new Date();
  const pmSoon = pm && pm < new Date(Date.now() + 14*86400000);
  const pmStr = pm ? pm.toLocaleDateString([], { month:'short', day:'numeric' }) : '—';
  // Model number is what techs and parts orderers actually search for.
  // Brand is context. Showing model first/bigger and brand subdued reads
  // faster and reduces eye work when scanning a long list. Falls back
  // gracefully if either field is missing.
  const sub = e.model
    ? `${esc(e.model)}${e.manufacturer ? ` · ${esc(e.manufacturer)}` : ''}`
    : esc(e.manufacturer || '');
  // Empty-PM gets a class so CSS can mute the dash to near-invisible.
  // A bright '—' fights for attention with the real dates we want users
  // to scan to.
  const pmCls = pmOverdue ? 'eq-overdue' : pmSoon ? 'eq-soon' : (!pm ? 'eq-pm-empty' : '');

  return `
    <div class="eq-row" data-eq-id="${e.id}">
      <div class="eq-col eq-col-name">
        <span class="eq-cat-icon">${catIcon(e.category)}</span>
        <div style="min-width:0">
          <div class="eq-name">${esc(e.name)}</div>
          <div class="eq-sub">${sub}</div>
        </div>
      </div>
      <div class="eq-col eq-col-loc">${esc(e.location)}${e.area ? ' · ' + esc(e.area) : ''}</div>
      <div class="eq-col eq-col-status">
        <span class="eq-status-dot" style="background:${statusColor(e.status)};color:${statusColor(e.status)}"></span>
        ${statusLabel(e.status)}
      </div>
      <div class="eq-col eq-col-pm ${pmCls}">${pmStr}</div>
      <div class="eq-col eq-col-services">${e.services_this_year || 0}</div>
    </div>`;
}

function buildGridCard(e) {
  const pm = e.next_pm_date ? new Date(e.next_pm_date) : null;
  const pmStr = pm ? pm.toLocaleDateString([], { month:'short', day:'numeric' }) : 'Not set';
  const health = e.health_score ?? 100;
  const healthColor = health >= 80 ? 'var(--green)' : health >= 50 ? 'var(--amber)' : 'var(--red)';

  return `
    <div class="eq-card" data-eq-id="${e.id}">
      <div class="eq-card-top">
        ${e.photo_url
          ? `<img src="${e.photo_url}" class="eq-card-photo">`
          : `<div class="eq-card-photo eq-card-photo-placeholder">${catIcon(e.category)}</div>`}
        <span class="eq-card-status" style="background:${statusColor(e.status)}"></span>
      </div>
      <div class="eq-card-body">
        <div class="eq-card-title">${esc(e.name)}</div>
        <div class="eq-card-sub">${esc(e.location)}${e.area ? ' · ' + esc(e.area) : ''}</div>
        <div class="eq-card-meta">
          <span>${esc(e.manufacturer || '—')}</span>
          <span class="eq-health" style="color:${healthColor}">${health}%</span>
        </div>
        <div class="eq-card-pm">Next PM: ${pmStr}</div>
      </div>
    </div>`;
}


/* ════════════════════════════════════════════════════════════════════════════
   3. DETAIL — the one and only openDetail
   Combines what was in 4 separate wrappers (ai, p3, full-editor, p4) into
   a single linear function with clear sections.
   ════════════════════════════════════════════════════════════════════════════ */

async function openDetail(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  currentEquipId = id;

  // Parallel load: parts, maintenance, attachments, custom fields,
  // plus pending pm_logs (QR-submitted service logs awaiting admin
  // review). We fold pending logs into the timeline so they're
  // discoverable — admin can approve/reject inline instead of
  // hunting for a hidden review dashboard.
  const [partsRes, maintRes, attachRes, customRes, pendingRes] = await Promise.all([
    NX.sb.from('equipment_parts').select('*').eq('equipment_id', id).order('assembly_path'),
    NX.sb.from('equipment_maintenance').select('*').eq('equipment_id', id).order('event_date', { ascending: false }),
    NX.sb.from('equipment_attachments').select('*').eq('equipment_id', id).order('created_at', { ascending: false }),
    NX.sb.from('equipment_custom_fields').select('*').eq('equipment_id', id).order('created_at'),
    NX.sb.from('pm_logs').select('*').eq('equipment_id', id).eq('review_status', 'pending').order('submitted_at', { ascending: false }),
  ]);
  const parts        = partsRes.data   || [];
  const maintenance  = maintRes.data   || [];
  const attachments  = attachRes.data  || [];
  const customFields = customRes.data  || [];
  const pendingLogs  = pendingRes.data || [];

  const modal = document.getElementById('eqModal') || createDetailModal();
  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeDetail()"></div>
    <div class="eq-detail">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeDetail()">✕</button>
        <div class="eq-detail-title">
          <span class="eq-cat-icon-lg">${catIcon(eq.category)}</span>
          <div>
            <h2>${esc(eq.name)}</h2>
            <div class="eq-detail-sub">${esc(eq.location)}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
          </div>
        </div>
        <div class="eq-detail-status">
          <span class="eq-status-dot" style="background:${statusColor(eq.status)}"></span>
          ${statusLabel(eq.status)}
        </div>
      </div>

      <!-- Open cards from the Board, populated async after render -->
      <div id="eqOpenCards-${eq.id}" class="eq-open-cards" style="display:none"></div>

      <div class="eq-detail-tabs">
        <button class="eq-tab active" data-tab="overview">Overview</button>
        <button class="eq-tab" data-tab="timeline">Timeline (${maintenance.length}${pendingLogs.length ? ` <span class="eq-tab-pending-dot" title="${pendingLogs.length} pending review">+${pendingLogs.length}</span>` : ''})</button>
        <button class="eq-tab" data-tab="parts">Parts (${parts.length})</button>
        <button class="eq-tab" data-tab="manual">Manual</button>
        <button class="eq-tab" data-tab="intel">🧠 AI</button>
        <button class="eq-tab" data-tab="qr">QR</button>
      </div>

      <div class="eq-detail-body">
        <div class="eq-tab-panel active" data-panel="overview">${renderOverview(eq, attachments, customFields)}</div>
        <div class="eq-tab-panel" data-panel="timeline">${renderTimeline(eq, maintenance, pendingLogs)}</div>
        <div class="eq-tab-panel" data-panel="parts">${renderParts(eq, parts)}</div>
        <div class="eq-tab-panel" data-panel="manual">${renderManual(eq)}</div>
        <div class="eq-tab-panel" data-panel="intel"><div class="eq-empty-small">Loading intelligence…</div></div>
        <div class="eq-tab-panel" data-panel="qr">${renderQR(eq)}</div>
      </div>

      <div class="eq-detail-actions">
        <button class="eq-btn eq-btn-primary eq-zebra-action-btn" onclick="NX.modules.equipment.quickPrint('${eq.id}')">
          <span class="eq-action-icon">🖨</span><span>Print</span>
        </button>
        <button class="eq-btn eq-call-service-btn" onclick="NX.modules.equipment.callService('${eq.id}')">
          <span class="eq-action-icon">📞</span><span>Call</span>
        </button>
        <button class="eq-btn" onclick="NX.modules.equipment.reportIssue('${eq.id}')">
          <span class="eq-action-icon">🎫</span><span>Report</span>
        </button>
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.openFullEditor('${eq.id}')">
          <span class="eq-action-icon">⚙</span><span>Edit</span>
        </button>
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.logService('${eq.id}')">
          <span class="eq-action-icon">📝</span><span>Log</span>
        </button>
        <div class="eq-overflow-wrap">
          <button class="eq-btn eq-overflow-btn" onclick="NX.modules.equipment.toggleOverflow(event, '${eq.id}')" aria-label="More actions">⋯</button>
          <div class="eq-overflow-menu" id="eqOverflow-${eq.id}" onclick="event.stopPropagation()">
            <button class="eq-overflow-item" onclick="NX.modules.equipment.duplicateEquipment('${eq.id}')">📋 Duplicate equipment</button>
            <button class="eq-overflow-item eq-overflow-danger" onclick="NX.modules.equipment.deleteEquipment('${eq.id}')">🗑 Delete permanently</button>
          </div>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Load open cards linked to this equipment (async — doesn't block initial render)
  loadOpenCardsForEquipment(eq);

  // Wire tabs — lazy-render the Intelligence panel on first click
  modal.querySelectorAll('.eq-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      modal.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = modal.querySelector(`[data-panel="${tab.dataset.tab}"]`);
      panel.classList.add('active');
      if (tab.dataset.tab === 'intel' && !panel.dataset.loaded) {
        panel.dataset.loaded = '1';
        panel.innerHTML = await renderIntelligenceTab(id);
      }
      if (tab.dataset.tab === 'parts') {
        const list = panel.querySelector('.eq-parts-list');
        if (list) enhancePartsList(list);
      }
      if (tab.dataset.tab === 'manual') {
        enhanceManualPanel(panel, id);
      }
    });
  });

  // If Parts panel is already open (tab state), enhance immediately
  const partsPanelInitial = modal.querySelector('[data-panel="parts"].active .eq-parts-list');
  if (partsPanelInitial) enhancePartsList(partsPanelInitial);
  const manualPanelInitial = modal.querySelector('[data-panel="manual"].active');
  if (manualPanelInitial) enhanceManualPanel(manualPanelInitial, id);

  // Wire QR download
  const qrImg = modal.querySelector('.eq-qr-img');
  if (qrImg) generateQRImage(eq.qr_code, qrImg);

  // Render family tree + recent dispatches into the overview panel
  // (these need to run after the HTML is in the DOM)
  renderFamilySection(id);
  refreshDispatchChips(id);

  // Auto-translate the equipment Notes block (free-form field often
  // containing service history written by whichever tech was on shift).
  // Kept after the async tabs finish rendering because we don't want
  // to translate the skeleton loading states.
  if (window.NX?.tr) {
    const notesP = modal.querySelector('.eq-notes p');
    if (notesP) { try { NX.tr.auto(notesP); } catch(_) {} }
  }
}

function closeDetail() {
  const modal = document.getElementById('eqModal');
  if (modal) modal.classList.remove('active');
  currentEquipId = null;
}

function createDetailModal() {
  const m = document.createElement('div');
  m.id = 'eqModal';
  m.className = 'eq-modal';
  document.body.appendChild(m);
  return m;
}

/* ─── Board integration: Open Cards strip + Report Issue ────────────
   These connect the equipment detail modal to the Board module:
     • loadOpenCardsForEquipment — fills the "Open cards" strip after render
     • reportIssue — prompts for an issue, creates a prefilled board card
*/
function ensureBoardStyles() {
  if (document.getElementById('eq-board-bridge-styles')) return;
  const s = document.createElement('style');
  s.id = 'eq-board-bridge-styles';
  s.textContent = `
    .eq-open-cards{background:rgba(200,164,78,0.05);border-top:1px solid rgba(200,164,78,0.12);border-bottom:1px solid rgba(200,164,78,0.12);padding:8px 14px;margin:0;display:flex;flex-direction:column;gap:6px}
    .eq-open-cards-head{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#c8a44e;display:flex;align-items:center;gap:6px}
    .eq-open-card{background:rgba(20,18,14,0.6);border:1px solid rgba(255,255,255,0.06);border-left:3px solid var(--c,#a49c94);border-radius:6px;padding:7px 10px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px}
    .eq-open-card:active{background:rgba(20,18,14,0.85)}
    .eq-open-card-title{flex:1;color:var(--text,#d4c8a5);font-weight:500}
    .eq-open-card-meta{font-size:10px;color:var(--text-dim,#a49c94)}
    .eq-open-card-overdue{color:#e88;font-weight:600;font-size:10px}
  `;
  document.head.appendChild(s);
}

async function loadOpenCardsForEquipment(eq) {
  ensureBoardStyles();
  const container = document.getElementById(`eqOpenCards-${eq.id}`);
  if (!container) return;

  // Fetch via the board module's API if present, otherwise query directly
  let openCards = [];
  try {
    if (NX.modules?.board?.getOpenCardsForEquipment) {
      openCards = await NX.modules.board.getOpenCardsForEquipment(eq.id);
    } else {
      const { data } = await NX.sb.from('kanban_cards')
        .select('id, title, priority, status, due_date, created_at')
        .eq('equipment_id', eq.id)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      openCards = (data || []).filter(c => !['closed', 'done'].includes((c.status || '').toLowerCase()));
    }
  } catch (e) {
    console.warn('[equipment] open cards load failed:', e);
    return;
  }

  if (!openCards.length) {
    container.style.display = 'none';
    return;
  }

  const PRI_COLOR = { urgent:'#d45858', high:'#e8a830', normal:'#a49c94', low:'#5b9bd5' };
  const today = new Date(new Date().toDateString()).getTime();

  container.innerHTML = `
    <div class="eq-open-cards-head">
      🎫 ${openCards.length} open card${openCards.length !== 1 ? 's' : ''} on the board
    </div>
    ${openCards.slice(0, 4).map(c => {
      const overdue = c.due_date && new Date(c.due_date).getTime() < today;
      const color = PRI_COLOR[c.priority] || PRI_COLOR.normal;
      return `<div class="eq-open-card" data-card="${c.id}" style="--c:${color}">
        <div class="eq-open-card-title">${esc(c.title || '(untitled)')}</div>
        ${overdue ? '<span class="eq-open-card-overdue">OVERDUE</span>' : ''}
        <span class="eq-open-card-meta">${esc((c.status || '').replace(/_/g, ' '))}</span>
      </div>`;
    }).join('')}
    ${openCards.length > 4 ? `<div style="font-size:10px;color:var(--text-dim,#a49c94);text-align:center">+ ${openCards.length - 4} more</div>` : ''}
  `;
  container.style.display = '';

  container.querySelectorAll('.eq-open-card').forEach(el => {
    el.addEventListener('click', () => {
      // Jump to Board view, then scroll-focus or open the card
      closeDetail();
      document.querySelector('.nav-tab[data-view="board"]')?.click();
      document.querySelector('.bnav-btn[data-view="board"]')?.click();
      // Reload board and open the card
      setTimeout(async () => {
        if (NX.modules?.board?.reload) await NX.modules.board.reload();
      }, 300);
    });
  });
}

async function reportIssue(equipId) {
  const issue = prompt('What\'s the issue?\n\n(A card will be created on the Board with this equipment linked.)');
  if (!issue || !issue.trim()) return;
  try {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, location').eq('id', equipId).single();
    if (!eq) { NX.toast && NX.toast('Equipment not found', 'error'); return; }
    if (NX.modules?.board?.createFromEquipment) {
      await NX.modules.board.createFromEquipment(eq, issue.trim());
    } else {
      // Fallback — direct insert if board module not loaded yet
      await NX.sb.from('kanban_cards').insert({
        title: `${issue.trim()} — ${eq.name}`,
        description: issue.trim(),
        priority: 'high',
        location: eq.location || null,
        equipment_id: eq.id,
        reported_by: NX.currentUser?.name || null,
        checklist: [], comments: [], labels: [], photo_urls: [],
        archived: false,
      });
      NX.toast && NX.toast('Card created on Board', 'success');
    }
  } catch (e) {
    console.error('[equipment] reportIssue:', e);
    NX.toast && NX.toast('Could not create card', 'error');
  }
}

/* ═══ OVERVIEW TAB (merges base + full-editor enhancements) ═══ */

function renderOverview(eq, attachments, customFields) {
  const specs = eq.specs || {};
  const specKeys = Object.keys(specs).filter(k => specs[k]);

  // Links block (manual_source_url + manual_url + attachment links)
  const linkAttachments = attachments.filter(a => a.type === 'link' || a.external_url);
  const hasLinks = eq.manual_source_url || eq.manual_url || linkAttachments.length;

  return `
    ${eq.photo_url ? `<img src="${eq.photo_url}" class="eq-detail-photo">` : ''}
    <div class="eq-fields">
      <div class="eq-field"><label>Manufacturer</label><div>${esc(eq.manufacturer || '—')}</div></div>
      <div class="eq-field"><label>Model</label><div>${esc(eq.model || '—')}</div></div>
      <div class="eq-field"><label>Serial Number</label><div>${esc(eq.serial_number || '—')}</div></div>
      <div class="eq-field"><label>Category</label><div>${catIcon(eq.category)} ${esc(eq.category || '—')}</div></div>
      <div class="eq-field"><label>Install Date</label><div>${eq.install_date ? new Date(eq.install_date).toLocaleDateString() : '—'}</div></div>
      <div class="eq-field"><label>Warranty Until</label><div>${eq.warranty_until ? new Date(eq.warranty_until).toLocaleDateString() : '—'}</div></div>
      <div class="eq-field"><label>Purchase Price</label><div>${eq.purchase_price ? '$' + parseFloat(eq.purchase_price).toLocaleString() : '—'}</div></div>
      <div class="eq-field"><label>Health Score</label><div>${eq.health_score ?? 100}%</div></div>
      <div class="eq-field"><label>Next PM</label><div>${eq.next_pm_date ? new Date(eq.next_pm_date).toLocaleDateString() : 'Not scheduled'}</div></div>
      <div class="eq-field"><label>Services (YTD)</label><div>${eq.services_this_year || 0}${eq.cost_this_year ? ' · $' + Math.round(eq.cost_this_year).toLocaleString() : ''}</div></div>
    </div>

    ${specKeys.length ? `
      <div class="eq-specs">
        <h4>Specs</h4>
        <div class="eq-fields">
          ${specKeys.map(k => `<div class="eq-field"><label>${esc(k)}</label><div>${esc(String(specs[k]))}</div></div>`).join('')}
        </div>
      </div>
    ` : ''}

    ${eq.notes ? `<div class="eq-notes"><h4>Notes</h4><p>${esc(eq.notes)}</p></div>` : ''}

    <div class="eq-overview-section">
      <div class="eq-overview-head">
        <h4>📎 Attachments${attachments.length ? ` (${attachments.length})` : ''}</h4>
      </div>
      ${attachments.length ? `
        <div class="eq-overview-attachments">
          ${attachments.map(a => `
            <a ${a.file_url || a.external_url ? `href="${a.file_url || a.external_url}" target="_blank"` : ''}
               class="eq-attach-badge">
              ${attachmentIcon(a)} ${esc(a.title)}
            </a>
          `).join('')}
        </div>
      ` : '<div class="eq-empty-small">No attachments yet. Add receipts, invoices, warranty cards, installation photos, or anything else.</div>'}
      <div class="eq-attach-add-row">
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'photo', 'detail')">📸 Photo</button>
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'file', 'detail')">📄 File</button>
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'link', 'detail')">🔗 Link</button>
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'note', 'detail')">📝 Note</button>
      </div>
    </div>

    ${customFields.length ? `
      <div class="eq-overview-section">
        <h4>🏷️ Custom Fields</h4>
        <div class="eq-fields">
          ${customFields.map(f => `
            <div class="eq-field">
              <label>${esc(f.field_name)}</label>
              <div>${f.field_type === 'url' && f.field_value ? `<a href="${escAttr(f.field_value)}" target="_blank">${esc(f.field_value)} ↗</a>` :
                    f.field_type === 'boolean' ? (f.field_value === 'true' ? '✓ Yes' : '✗ No') :
                    esc(f.field_value || '—')}</div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

    ${hasLinks ? `
      <div class="eq-overview-section">
        <h4>🔗 Links</h4>
        <div class="eq-overview-links">
          ${eq.manual_source_url ? `<a href="${escAttr(eq.manual_source_url)}" target="_blank" class="eq-link-btn">📘 Manual (source) ↗</a>` : ''}
          ${eq.manual_url ? `<a href="${escAttr(eq.manual_url)}" target="_blank" class="eq-link-btn">📄 Manual PDF ↗</a>` : ''}
        </div>
      </div>` : ''}

    <div class="eq-overview-section">
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.scanDataPlate('${eq.id}')">📷 Scan Data Plate (auto-fill)</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.applyPredictivePM('${eq.id}')" title="Auto-schedule next PM based on repair patterns">🔮 Predictive PM</button>
    </div>

    <!-- Family section gets injected here by renderFamilySection() -->
    <!-- Recent dispatches gets injected here by refreshDispatchChips() -->
  `;
}

function renderTimeline(eq, maint, pending) {
  pending = pending || [];
  const isAdmin = NX.currentUser?.role === 'admin';
  const totalItems = maint.length + pending.length;

  if (!totalItems) {
    return `<div class="eq-empty-small">No service history yet.<br>
      <button class="eq-btn eq-btn-primary eq-mt" onclick="NX.modules.equipment.logService('${eq.id}')">+ Log First Service</button></div>`;
  }

  // Combine pending + approved into one chronological list.
  // Pending entries appear at the top with a distinct "pending review"
  // treatment; approved entries below in their original order.
  const pendingHtml = pending.map(p => {
    const photos = Array.isArray(p.photo_urls) ? p.photo_urls : [];
    return `
      <div class="eq-timeline-item eq-timeline-pending" data-pending-id="${p.id}">
        <div class="eq-timeline-date">
          ${new Date(p.service_date).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})}
          <div class="eq-timeline-pending-badge">⏳ PENDING REVIEW</div>
        </div>
        <div class="eq-timeline-body">
          <div class="eq-timeline-type eq-type-${p.service_type || 'pm'}">${(p.service_type || 'service').toUpperCase()}</div>
          <div class="eq-timeline-desc">${esc(p.work_performed || '')}</div>
          <div class="eq-timeline-who">👤 ${esc(p.contractor_name || 'Anonymous')}${p.contractor_company ? ' · ' + esc(p.contractor_company) : ''}</div>
          ${p.contractor_phone ? `<div class="eq-timeline-detail"><b>Phone:</b> ${esc(p.contractor_phone)}</div>` : ''}
          ${p.cost_amount ? `<div class="eq-timeline-cost">💰 $${parseFloat(p.cost_amount).toLocaleString()}</div>` : ''}
          ${p.parts_replaced ? `<div class="eq-timeline-detail"><b>Parts:</b> ${esc(p.parts_replaced)}</div>` : ''}
          ${p.next_service_date ? `<div class="eq-timeline-detail"><b>Next service:</b> ${esc(p.next_service_date)}</div>` : ''}
          ${photos.length ? `
            <div class="eq-timeline-photos">
              ${photos.map(u => `<a href="${esc(u)}" target="_blank"><img src="${esc(u)}" class="eq-timeline-photo"></a>`).join('')}
            </div>
          ` : ''}
          ${p.pdf_url ? `<div class="eq-timeline-detail"><a href="${esc(p.pdf_url)}" target="_blank">📄 View PDF invoice</a></div>` : ''}
          ${p.signature_data ? `<img src="${esc(p.signature_data)}" class="eq-timeline-signature">` : ''}
          ${p.flagged_spam ? '<div class="eq-timeline-spam-flag">⚠ Honeypot tripped — likely spam</div>' : ''}
          <div class="eq-timeline-submitted-at">Submitted ${new Date(p.submitted_at || p.created_at).toLocaleString()}</div>
          ${isAdmin ? `
            <div class="eq-timeline-review-actions">
              <button class="eq-btn eq-btn-approve" onclick="NX.modules.equipment.approvePmLog('${p.id}', '${eq.id}')">✓ Approve</button>
              <button class="eq-btn eq-btn-reject"  onclick="NX.modules.equipment.rejectPmLog('${p.id}', '${eq.id}')">✕ Reject</button>
              ${p.flagged_spam ? '' : `<button class="eq-btn eq-btn-spam" onclick="NX.modules.equipment.markPmSpam('${p.id}', '${eq.id}')">🚫 Spam</button>`}
            </div>
          ` : '<div class="eq-timeline-review-hint">Awaiting admin review.</div>'}
        </div>
      </div>
    `;
  }).join('');

  const approvedHtml = maint.map(m => `
    <div class="eq-timeline-item">
      <div class="eq-timeline-date">${new Date(m.event_date).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})}</div>
      <div class="eq-timeline-body">
        <div class="eq-timeline-type eq-type-${m.event_type}">${(m.event_type || 'service').toUpperCase()}</div>
        <div class="eq-timeline-desc">${esc(m.description)}</div>
        ${m.performed_by ? `<div class="eq-timeline-who">👤 ${esc(m.performed_by)}</div>` : ''}
        ${m.cost ? `<div class="eq-timeline-cost">💰 $${parseFloat(m.cost).toLocaleString()}</div>` : ''}
        ${m.downtime_hours ? `<div class="eq-timeline-dt">⏱ ${m.downtime_hours}h downtime</div>` : ''}
        ${m.symptoms ? `<div class="eq-timeline-detail"><b>Symptoms:</b> ${esc(m.symptoms)}</div>` : ''}
        ${m.root_cause ? `<div class="eq-timeline-detail"><b>Root cause:</b> ${esc(m.root_cause)}</div>` : ''}
      </div>
      <button class="eq-timeline-del" onclick="NX.modules.equipment.deleteMaintenance('${m.id}', '${eq.id}')" title="Delete">✕</button>
    </div>
  `).join('');

  return `
    <div class="eq-timeline">
      ${pendingHtml}
      ${approvedHtml}
    </div>`;
}

function renderParts(eq, parts) {
  return `
    <div class="eq-parts-head">
      <button class="eq-btn eq-btn-small eq-btn-secondary" onclick="NX.modules.equipment.extractBOMFromManual('${eq.id}')" style="margin-right:6px">✨ Extract from Manual</button>
      <button class="eq-btn eq-btn-small eq-btn-secondary" onclick="NX.modules.equipment.exportPartsCart('${eq.id}')" style="margin-right:6px">🛒 Shopping List</button>
      <h4>Bill of Materials</h4>
      <button class="eq-btn eq-btn-small eq-btn-primary" onclick="NX.modules.equipment.addPart('${eq.id}')" style="margin-right:6px">+ Add Part</button>
      <button class="eq-btn eq-btn-small eq-btn-secondary" onclick="NX.modules.equipment.addPartFromUrl('${eq.id}')">🔗 From URL</button>
    </div>
    ${!parts.length ? '<div class="eq-empty-small">No parts cataloged yet.</div>' : `
      <div class="eq-parts-list" data-multi-vendor="1">
        ${parts.map(p => `
          <div class="eq-part" data-part-id="${p.id}">
            <div class="eq-part-main">
              <div class="eq-part-name">${esc(p.part_name)}</div>
              <div class="eq-part-sub">
                ${p.oem_part_number ? `OEM: ${esc(p.oem_part_number)}` : ''}
                ${p.quantity > 1 ? ` · Qty: ${p.quantity}` : ''}
              </div>
              ${p.assembly_path ? `<div class="eq-part-path">${esc(p.assembly_path)}</div>` : ''}
            </div>
            <div class="eq-part-actions">
              <button class="eq-btn eq-btn-tiny" onclick="NX.modules.equipment.editPart('${p.id}')">✎</button>
              <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="NX.modules.equipment.deletePart('${p.id}', '${eq.id}')">✕</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}`;
}

function renderManual(eq) {
  return `
    <div class="eq-manual" data-eq-id="${eq.id}" data-manual-url="${escAttr(eq.manual_url || '')}">
      ${eq.manual_url ? `
        <iframe src="${eq.manual_url}" class="eq-manual-iframe"></iframe>
        <div class="eq-manual-actions">
          <a href="${eq.manual_url}" target="_blank" class="eq-btn eq-btn-secondary">Open in new tab</a>
          <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.removeManual('${eq.id}')">Remove</button>
        </div>
      ` : `
        <div class="eq-empty-small">
          <p>No manual uploaded.</p>
          ${eq.manual_source_url ? `<p class="eq-mt"><a href="${eq.manual_source_url}" target="_blank">Original source ↗</a></p>` : ''}
        </div>
      `}
      <div class="eq-manual-upgrade">
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadManual('${eq.id}')">📄 Upload PDF</button>
          <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.autoFetchManual('${eq.id}')">🌐 Find Online</button>
        </div>
      </div>
    </div>`;
}

function renderQR(eq) {
  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
  return `
    <div class="eq-qr-section">
      <div class="eq-qr-label">${esc(eq.name)}</div>
      <div class="eq-qr-sub">${esc(eq.location)}</div>
      <canvas class="eq-qr-img" width="220" height="220"></canvas>
      <div class="eq-qr-code">${esc(eq.qr_code)}</div>
      <div class="eq-qr-url">${scanURL}</div>
      <div class="eq-qr-actions">
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.printZebraSingle('${eq.id}')">🏷️ Print on Zebra</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.printSingleQR('${eq.id}')">🖨 Paper Sticker</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.copyQRLink('${eq.qr_code}')">Copy Link</button>
      </div>
    </div>`;
}


/* ════════════════════════════════════════════════════════════════════════════
   4. EDIT — simple add/edit, service log, parts, delete
   ════════════════════════════════════════════════════════════════════════════ */

function openEditModal(id) {
  const eq = id ? equipment.find(e => e.id === id) : {
    name: '', location: 'Suerte', area: '', category: 'refrigeration',
    manufacturer: '', model: '', serial_number: '', status: 'operational',
    install_date: '', warranty_until: '', purchase_price: '',
    pm_interval_days: '', next_pm_date: '', notes: ''
  };

  const modal = document.getElementById('eqEditModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqEditModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeEdit()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeEdit()">✕</button>
        <h2>${id ? 'Edit' : 'Add'} Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <form class="eq-form" id="eqForm">
          <div class="eq-form-group">
            <label>Name *</label>
            <input name="name" value="${esc(eq.name)}" required placeholder="Walk-In Cooler, Kitchen South">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Location *</label>
              <select name="location" required>
                ${LOCATIONS.map(l => `<option value="${l}" ${eq.location===l?'selected':''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Area</label>
              <input name="area" value="${esc(eq.area||'')}" placeholder="Kitchen, Bar, Dining">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Category</label>
              <select name="category">
                ${CATEGORIES.map(c => `<option value="${c.key}" ${eq.category===c.key?'selected':''}>${c.icon} ${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Status</label>
              <select name="status">
                ${STATUSES.map(s => `<option value="${s.key}" ${eq.status===s.key?'selected':''}>${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Manufacturer</label>
              <input name="manufacturer" value="${esc(eq.manufacturer||'')}" placeholder="Hoshizaki">
            </div>
            <div class="eq-form-group">
              <label>Model</label>
              <input name="model" value="${esc(eq.model||'')}" placeholder="KM-320MAH-E">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Serial Number</label>
            <input name="serial_number" value="${esc(eq.serial_number||'')}" placeholder="240317001">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Install Date</label>
              <input type="date" name="install_date" value="${eq.install_date||''}">
            </div>
            <div class="eq-form-group">
              <label>Warranty Until</label>
              <input type="date" name="warranty_until" value="${eq.warranty_until||''}">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Purchase Price ($)</label>
              <input type="number" step="0.01" name="purchase_price" value="${eq.purchase_price||''}">
            </div>
            <div class="eq-form-group">
              <label>PM Interval (days)</label>
              <input type="number" name="pm_interval_days" value="${eq.pm_interval_days||''}" placeholder="90">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Next PM Date</label>
            <input type="date" name="next_pm_date" value="${eq.next_pm_date||''}">
          </div>
          <div class="eq-form-group">
            <label>Notes</label>
            <textarea name="notes" rows="3" placeholder="Any special notes, quirks, service tips...">${esc(eq.notes||'')}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeEdit()">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">${id ? 'Save Changes' : 'Create Equipment'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null) data[k] = v;
    }
    ['purchase_price', 'pm_interval_days'].forEach(k => {
      if (data[k] != null) data[k] = parseFloat(data[k]);
    });

    try {
      if (id) {
        const { error } = await NX.sb.from('equipment').update(data).eq('id', id);
        if (error) throw error;
        NX.toast && NX.toast('Equipment updated ✓', 'success');
      } else {
        const { data: created, error } = await NX.sb.from('equipment').insert(data).select().single();
        if (error) throw error;
        NX.toast && NX.toast('Equipment created ✓', 'success');
        // equipment_created syslog → now handled by Postgres trigger on equipment INSERT
      }
      closeEdit();
      await loadEquipment();
      renderList();
      if (id) openDetail(id);
    } catch (err) {
      console.error('[Equipment] Save error:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

function closeEdit() {
  const m = document.getElementById('eqEditModal');
  if (m) m.classList.remove('active');
}

async function deleteEquipment(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  if (!confirm(`Delete "${eq.name}"? This will also delete all parts and service history. Cannot be undone.`)) return;
  try {
    const { error } = await NX.sb.from('equipment').delete().eq('id', id);
    if (error) throw error;
    NX.toast && NX.toast('Deleted ✓', 'success');
    // equipment_deleted syslog → now handled by Postgres trigger on equipment DELETE
    closeDetail();
    await loadEquipment();
    renderList();
  } catch (err) {
    console.error('[Equipment] Delete error:', err);
    NX.toast && NX.toast('Delete failed: ' + err.message, 'error');
  }
}

// ─── DUPLICATE EQUIPMENT ────────────────────────────────────────────
// Useful when stocking N units of the same model across locations.
// Copies: equipment row (minus serial/dates/identifiers), parts (BOM),
//         custom fields, recurring PM schedule (next_pm_date, interval).
// Skips:  serial_number, install_date, warranty_until, purchase_price,
//         attachments, maintenance history, qr_code, pm_logs, photos,
//         data plate, manual URL (these are unit-specific).
// Names:  appended " — 2", " — 3", etc. User can rename after.
function duplicateEquipment(equipId) {
  const eq = equipment.find(e => e.id === equipId);
  if (!eq) return;

  const modal = document.getElementById('eqDupeModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqDupeModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeDupe()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeDupe()">✕</button>
        <h2>Duplicate Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div style="font-size:13px;color:#d4c8a5;margin-bottom:6px">
          Source: <strong>${esc(eq.name)}</strong>
        </div>
        <div style="font-size:11px;color:#857f75;margin-bottom:14px;line-height:1.5">
          Copies name, manufacturer, model, category, location, notes,
          parts (BOM), custom fields, and PM schedule.<br>
          <strong>Does NOT copy:</strong> serial number, install/purchase dates,
          attachments, service history, QR code, photos.
        </div>

        <form class="eq-form" id="eqDupeForm">
          <div class="eq-form-group" style="margin-bottom:10px">
            <label style="font-size:11px;color:#a89e87;margin-bottom:4px;display:block">
              How many copies?
            </label>
            <input type="number" id="eqDupeCount" value="1" min="1" max="10"
                   style="width:100%;box-sizing:border-box">
            <div style="font-size:10px;color:#857f75;margin-top:4px">
              Up to 10 at once. Each gets a number suffix (e.g. "${esc(eq.name)} — 2").
            </div>
          </div>

          <div class="eq-form-group" style="margin-bottom:10px">
            <label style="font-size:11px;color:#a89e87;margin-bottom:4px;display:block">
              Location for the copies
            </label>
            <select id="eqDupeLocation" style="width:100%;box-sizing:border-box">
              <option value="${esc(eq.location || '')}" selected>Same as source (${esc(eq.location || 'unset')})</option>
              <option value="suerte">Suerte</option>
              <option value="este">Este</option>
              <option value="bartoti">Bar Toti</option>
            </select>
          </div>

          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeDupe()">Cancel</button>
            <button type="button" class="eq-btn eq-btn-primary" id="eqDupeRunBtn">Create Copies</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqDupeRunBtn').addEventListener('click', async () => {
    await runDuplicate(equipId);
  });
}

function closeDupe() {
  const m = document.getElementById('eqDupeModal');
  if (m) m.classList.remove('active');
}

async function runDuplicate(sourceId) {
  const btn = document.getElementById('eqDupeRunBtn');
  if (!btn) return;
  const count = Math.max(1, Math.min(10, parseInt(document.getElementById('eqDupeCount').value) || 1));
  const location = document.getElementById('eqDupeLocation').value;
  btn.disabled = true;
  btn.textContent = `Copying… (0/${count})`;

  let createdIds = [];

  try {
    // 1. Pull complete source: equipment row + parts + custom fields
    const [eqRes, partsRes, customRes] = await Promise.all([
      NX.sb.from('equipment').select('*').eq('id', sourceId).single(),
      NX.sb.from('equipment_parts').select('*').eq('equipment_id', sourceId),
      NX.sb.from('equipment_custom_fields').select('*').eq('equipment_id', sourceId),
    ]);
    if (eqRes.error || !eqRes.data) throw new Error('Could not load source equipment');
    const src       = eqRes.data;
    const srcParts  = partsRes.data  || [];
    const srcCustom = customRes.data || [];

    // 2. Build N equipment copies — strip unit-specific fields
    const baseName = (src.name || 'Equipment').trim();
    const baseRow = { ...src };
    // Fields to drop (unit-specific or auto-generated)
    delete baseRow.id;
    delete baseRow.created_at;
    delete baseRow.updated_at;
    delete baseRow.serial_number;
    delete baseRow.install_date;
    delete baseRow.warranty_until;
    delete baseRow.purchase_price;
    delete baseRow.qr_code;
    delete baseRow.photo_url;
    delete baseRow.data_plate_url;
    delete baseRow.manual_url;
    delete baseRow.health_score;          // recomputed by trigger
    delete baseRow.cost_this_year;        // accrues from new history
    delete baseRow.services_this_year;    // accrues from new history
    delete baseRow.next_pm_date;          // recomputed below from interval
    // Status defaults to active for new units
    baseRow.status = 'active';
    // Apply location override if user picked one
    if (location && location !== src.location) baseRow.location = location;
    // If source had a PM interval, set next_pm_date = today + interval
    if (baseRow.pm_interval_days && Number(baseRow.pm_interval_days) > 0) {
      const next = new Date(Date.now() + Number(baseRow.pm_interval_days) * 86400000);
      baseRow.next_pm_date = next.toISOString().slice(0, 10);
    }

    // 3. Insert each copy, capture IDs
    for (let i = 0; i < count; i++) {
      const suffix = ` — ${i + 2}`; // " — 2", " — 3", ... (matches "Original" being unit 1)
      const row = { ...baseRow, name: baseName + suffix };
      const { data: created, error } = await NX.sb.from('equipment').insert(row).select().single();
      if (error) throw new Error(`Copy ${i + 1}: ${error.message}`);
      createdIds.push(created.id);
      btn.textContent = `Copying… (${i + 1}/${count})`;
    }

    // 4. Fan out child rows to each new equipment_id
    for (const newId of createdIds) {
      const partRows = srcParts.map(p => {
        const row = { ...p };
        delete row.id;
        delete row.created_at;
        delete row.updated_at;
        row.equipment_id = newId;
        return row;
      });
      const customRows = srcCustom.map(c => {
        const row = { ...c };
        delete row.id;
        delete row.created_at;
        delete row.updated_at;
        row.equipment_id = newId;
        return row;
      });
      const childInserts = [];
      if (partRows.length)   childInserts.push(NX.sb.from('equipment_parts').insert(partRows));
      if (customRows.length) childInserts.push(NX.sb.from('equipment_custom_fields').insert(customRows));
      if (childInserts.length) {
        const results = await Promise.all(childInserts);
        for (const r of results) if (r.error) throw new Error(`Child insert: ${r.error.message}`);
      }
    }

    // 5. Done — refresh list, close modal, show source again
    NX.toast && NX.toast(
      `Created ${count} cop${count === 1 ? 'y' : 'ies'} ✓`,
      'success'
    );
    closeDupe();
    await loadEquipment();
    renderList();
    // Reopen the source detail; user can navigate to a copy from the list
    openDetail(sourceId);

  } catch (err) {
    console.error('[Equipment] Duplicate error:', err);
    // Best-effort rollback: delete any equipment rows we created
    if (createdIds.length) {
      try {
        await NX.sb.from('equipment').delete().in('id', createdIds);
        // Child rows are gone too if FK has ON DELETE CASCADE.
        // If not, they were already inserted under the doomed equipment_id;
        // they're orphaned. We surface this in the error below.
      } catch (rbErr) {
        console.error('[Equipment] Rollback failed:', rbErr);
      }
    }
    NX.toast && NX.toast(
      'Duplicate failed: ' + (err.message || err) +
      (createdIds.length ? ' (rolled back)' : ''),
      'error'
    );
    if (btn) { btn.disabled = false; btn.textContent = 'Create Copies'; }
  }
}

function logService(equipId) {
  const eq = equipment.find(e => e.id === equipId);
  if (!eq) return;

  const modal = document.getElementById('eqServiceModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqServiceModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const today = new Date().toISOString().slice(0, 10);

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeService()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeService()">✕</button>
        <h2>Log Service — ${esc(eq.name)}</h2>
      </div>
      <div class="eq-detail-body">
        <form class="eq-form" id="eqServiceForm">
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Type</label>
              <select name="event_type">
                <option value="repair">Repair</option>
                <option value="pm">Preventive Maintenance</option>
                <option value="inspection">Inspection</option>
                <option value="install">Install</option>
                <option value="recall">Recall</option>
              </select>
            </div>
            <div class="eq-form-group">
              <label>Date *</label>
              <input type="date" name="event_date" value="${today}" required>
            </div>
          </div>
          <div class="eq-form-group">
            <label>What was done? *</label>
            <textarea name="description" rows="3" required placeholder="Replaced condenser fan motor..."></textarea>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Performed By</label>
              <input name="performed_by" placeholder="Austin Air & Ice / Tyler">
            </div>
            <div class="eq-form-group">
              <label>Cost ($)</label>
              <input type="number" step="0.01" name="cost" placeholder="450.00">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Downtime (hours)</label>
              <input type="number" step="0.5" name="downtime_hours">
            </div>
            <div class="eq-form-group">
              <label>Labor Hours</label>
              <input type="number" step="0.5" name="labor_hours">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Symptoms</label>
            <textarea name="symptoms" rows="2" placeholder="What was wrong?"></textarea>
          </div>
          <div class="eq-form-group">
            <label>Root Cause</label>
            <textarea name="root_cause" rows="2" placeholder="What did they find?"></textarea>
          </div>
          <div class="eq-form-group">
            <label>Next PM Due (optional)</label>
            <input type="date" name="next_pm_due">
          </div>
          <div class="eq-form-group">
            <label><input type="checkbox" name="warranty_claim"> Warranty claim</label>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeService()">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">Log Service</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqServiceForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { equipment_id: equipId };
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null) {
        if (k === 'warranty_claim') data[k] = true;
        else if (['cost', 'downtime_hours', 'labor_hours'].includes(k)) data[k] = parseFloat(v);
        else data[k] = v;
      }
    }

    try {
      const { error } = await NX.sb.from('equipment_maintenance').insert(data);
      if (error) throw error;
      if (data.next_pm_due) {
        await NX.sb.from('equipment').update({ next_pm_date: data.next_pm_due }).eq('id', equipId);
      }
      try { await NX.sb.rpc('recompute_health_score', { eq_id: equipId }); } catch(e){}

      NX.toast && NX.toast('Service logged ✓', 'success');
      // equipment_service syslog → now handled by Postgres trigger on equipment_maintenance INSERT

      closeService();
      await loadEquipment();
      openDetail(equipId);
    } catch (err) {
      console.error('[Equipment] Service log error:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

function closeService() {
  const m = document.getElementById('eqServiceModal');
  if (m) m.classList.remove('active');
}

async function deleteMaintenance(id, equipId) {
  if (!confirm('Delete this service record?')) return;
  try {
    await NX.sb.from('equipment_maintenance').delete().eq('id', id);
    NX.toast && NX.toast('Deleted ✓', 'success');
    openDetail(equipId);
  } catch(e) { console.error(e); }
}

/* ─── Parts CRUD ─── */

function addPart(equipId) { openPartModal(null, equipId); }

// ─── ADD PART FROM URL ──────────────────────────────────────────────
// Paste a Parts Town / Amazon / etc. URL, server fetches and asks Claude
// to extract structured fields, then you review/edit/check what gets
// saved. If the fetch is bot-walled, we silently swap to a paste-content
// fallback in the same modal so the user never gets stuck.
function addPartFromUrl(equipId) {
  const modal = document.getElementById('eqPartModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqPartModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  // Stage 1: URL input
  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closePart()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closePart()">✕</button>
        <h2>Add Part from URL</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-form">
          <div class="eq-form-group">
            <label>Supplier URL</label>
            <input id="eqPartUrlInput" type="url" placeholder="https://www.partstown.com/..." autocomplete="off"
                   style="font-size:14px">
            <div style="font-size:11px;color:#857f75;margin-top:4px">
              Parts Town, Amazon, WebstaurantStore, manufacturer sites — paste the product page URL.
            </div>
          </div>
          <div id="eqPartUrlPasteWrap" style="display:none">
            <div class="eq-form-group">
              <label>Or paste the page content</label>
              <textarea id="eqPartUrlPaste" rows="6"
                        placeholder="On your phone, open the URL, select all, copy, paste here"></textarea>
              <div style="font-size:11px;color:#857f75;margin-top:4px">
                The site blocked automatic fetch. Open the URL on your phone, copy
                the visible content (long-press → Select All → Copy), and paste here.
              </div>
            </div>
          </div>
          <div id="eqPartUrlStatus" style="font-size:12px;color:#a89e87;min-height:18px;margin:6px 0"></div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closePart()">Cancel</button>
            <button type="button" class="eq-btn eq-btn-primary" id="eqPartUrlFetchBtn">Fetch &amp; Parse</button>
          </div>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  const fetchBtn = document.getElementById('eqPartUrlFetchBtn');
  fetchBtn.addEventListener('click', () => doFetchPartUrl(equipId, false));

  // Pressing Enter in the URL field also fetches
  document.getElementById('eqPartUrlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doFetchPartUrl(equipId, false); }
  });
}

async function doFetchPartUrl(equipId, withPaste) {
  const urlEl = document.getElementById('eqPartUrlInput');
  const pasteEl = document.getElementById('eqPartUrlPaste');
  const statusEl = document.getElementById('eqPartUrlStatus');
  const btn = document.getElementById('eqPartUrlFetchBtn');
  const url = (urlEl?.value || '').trim();
  if (!url) { statusEl.textContent = 'Enter a URL first.'; statusEl.style.color = '#e07b7b'; return; }
  if (!/^https?:\/\//i.test(url)) {
    statusEl.textContent = 'URL must start with http:// or https://';
    statusEl.style.color = '#e07b7b';
    return;
  }

  btn.disabled = true;
  statusEl.style.color = '#a89e87';
  statusEl.textContent = withPaste ? 'Parsing pasted content…' : 'Fetching page…';

  const body = { url };
  if (withPaste) {
    const pasted = (pasteEl?.value || '').trim();
    if (pasted.length < 50) {
      statusEl.textContent = 'Paste at least a paragraph of the page content.';
      statusEl.style.color = '#e07b7b';
      btn.disabled = false;
      return;
    }
    body.html = pasted;
  }

  try {
    const { data, error } = await NX.sb.functions.invoke('parse-part-url', { body });
    if (error) throw new Error(error.message || 'fetch failed');

    if (!data?.ok) {
      // Server returned a structured failure — most often "blocked"
      if (data?.reason === 'blocked' || data?.reason === 'fetch_error' || data?.reason === 'http_403') {
        // Reveal the paste-content fallback
        document.getElementById('eqPartUrlPasteWrap').style.display = '';
        statusEl.style.color = '#d4a44e';
        statusEl.textContent = data.message || 'Site blocked us. Paste page content below.';
        // Repurpose the button for the paste flow
        btn.textContent = 'Parse Pasted Content';
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => doFetchPartUrl(equipId, true));
        newBtn.disabled = false;
        return;
      }
      statusEl.style.color = '#e07b7b';
      statusEl.textContent = data?.message || 'Could not parse — try editing the part manually.';
      btn.disabled = false;
      return;
    }

    // Success — render review screen
    renderPartReview(equipId, url, data.fields, data.source);
  } catch (e) {
    console.error('[parse-part-url]', e);
    statusEl.style.color = '#e07b7b';
    statusEl.textContent = 'Network error. Try again, or paste content below.';
    document.getElementById('eqPartUrlPasteWrap').style.display = '';
    btn.disabled = false;
  }
}

// Stage 2: review extracted fields with checkboxes — uncheck to skip,
// edit values inline, save what's checked.
function renderPartReview(equipId, sourceUrl, fields, source) {
  const modal = document.getElementById('eqPartModal');
  if (!modal) return;
  const f = fields || {};

  // Each row: [internal_key, label, value, db_column_or_null]
  // db_column = null means we fold into `notes` instead of a real column.
  const rows = [
    ['part_name',       'Part Name',       f.part_name       || '', 'part_name'],
    ['oem_part_number', 'OEM Part #',      f.oem_part_number || '', 'oem_part_number'],
    ['mfr_part_number', 'Mfr Part #',      f.mfr_part_number || '', null],
    ['manufacturer',    'Manufacturer',    f.manufacturer    || '', null],
    ['supplier',        'Supplier',        f.supplier        || '', 'supplier'],
    ['price_usd',       'Price (USD)',     f.price_usd != null ? String(f.price_usd) : '', 'last_price'],
    ['description',     'Description',    f.description     || '', null],
    ['fits_models',     'Fits Models',     f.fits_models     || '', null],
  ];

  const conf = (f.confidence || 'medium').toLowerCase();
  const confColor = conf === 'high' ? '#7bc88a' : conf === 'low' ? '#e0a06a' : '#d4a44e';

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closePart()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closePart()">✕</button>
        <h2>Review &amp; Save</h2>
      </div>
      <div class="eq-detail-body">
        <div style="font-size:11px;color:#857f75;margin-bottom:8px">
          Confidence: <span style="color:${confColor};font-weight:600">${conf.toUpperCase()}</span>
          ${source === 'paste' ? ' · from pasted content' : ` · from ${esc(detectDomain(sourceUrl))}`}
        </div>
        <div style="font-size:11px;color:#857f75;margin-bottom:12px">
          Untick any field you don't want saved. Edit values inline.
        </div>
        <form class="eq-form" id="eqPartReviewForm">
          ${rows.map(([key, label, val]) => `
            <div class="eq-form-group" style="margin-bottom:10px">
              <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#a89e87;margin-bottom:4px;cursor:pointer">
                <input type="checkbox" class="eq-part-include" data-key="${key}"
                       ${val ? 'checked' : ''} style="margin:0;flex:0 0 auto">
                <span>${label}</span>
              </label>
              <input class="eq-part-val" data-key="${key}" value="${esc(val)}"
                     placeholder="${val ? '' : '(not found on page)'}"
                     style="width:100%;box-sizing:border-box">
            </div>
          `).join('')}
          <div class="eq-form-group" style="margin-bottom:10px">
            <label style="font-size:11px;color:#a89e87;margin-bottom:4px;display:block">Quantity</label>
            <input type="number" id="eqPartReviewQty" value="1" min="1"
                   style="width:100%;box-sizing:border-box">
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closePart()">Cancel</button>
            <button type="button" class="eq-btn eq-btn-primary" id="eqPartReviewSaveBtn">Save Part</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('eqPartReviewSaveBtn').addEventListener('click', async () => {
    await savePartFromReview(equipId, sourceUrl);
  });
}

// Read the review form, build the equipment_parts row, insert.
async function savePartFromReview(equipId, sourceUrl) {
  const btn = document.getElementById('eqPartReviewSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  // Collect checked rows
  const checked = {};
  document.querySelectorAll('.eq-part-include').forEach(cb => {
    if (cb.checked) {
      const key = cb.dataset.key;
      const val = (document.querySelector(`.eq-part-val[data-key="${key}"]`)?.value || '').trim();
      if (val) checked[key] = val;
    }
  });

  if (!checked.part_name) {
    NX.toast && NX.toast('Part Name is required (check it and try again)', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Save Part'; }
    return;
  }

  // Map to equipment_parts columns. Anything without a real column goes
  // into notes as a labeled line so it's preserved and searchable.
  const data = {
    equipment_id: equipId,
    part_name: checked.part_name,
    quantity: parseInt(document.getElementById('eqPartReviewQty')?.value || '1') || 1,
    supplier_url: sourceUrl,  // always store the source URL for paper trail
  };
  if (checked.oem_part_number) data.oem_part_number = checked.oem_part_number;
  if (checked.supplier)        data.supplier        = checked.supplier;
  if (checked.price_usd) {
    const num = parseFloat(String(checked.price_usd).replace(/[^0-9.]/g, ''));
    if (!isNaN(num)) data.last_price = num;
  }

  const noteLines = [];
  if (checked.mfr_part_number) noteLines.push(`Mfr Part #: ${checked.mfr_part_number}`);
  if (checked.manufacturer)    noteLines.push(`Manufacturer: ${checked.manufacturer}`);
  if (checked.description)     noteLines.push(checked.description);
  if (checked.fits_models)     noteLines.push(`Fits: ${checked.fits_models}`);
  if (noteLines.length) data.notes = noteLines.join('\n');

  try {
    await NX.sb.from('equipment_parts').insert(data);
    NX.toast && NX.toast('Part saved ✓', 'success');
    closePart();
    openDetail(equipId);
  } catch (err) {
    console.error(err);
    NX.toast && NX.toast('Save failed: ' + (err.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Save Part'; }
  }
}

// Helper for the review header — small standalone domain extractor so we
// don't drag in URL parsing edge cases on old phones.
function detectDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url.slice(0, 40); }
}

async function editPart(partId) {
  const { data } = await NX.sb.from('equipment_parts').select('*').eq('id', partId).single();
  if (!data) return;
  openPartModal(data, data.equipment_id);
}

function openPartModal(part, equipId) {
  const p = part || { part_name:'', oem_part_number:'', quantity:1, supplier:'', last_price:'', supplier_url:'', assembly_path:'', notes:'' };

  const modal = document.getElementById('eqPartModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqPartModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closePart()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closePart()">✕</button>
        <h2>${part ? 'Edit' : 'Add'} Part</h2>
      </div>
      <div class="eq-detail-body">
        <form class="eq-form" id="eqPartForm">
          <div class="eq-form-group">
            <label>Part Name *</label>
            <input name="part_name" value="${esc(p.part_name)}" required placeholder="Evaporator fan motor">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>OEM Part Number</label>
              <input name="oem_part_number" value="${esc(p.oem_part_number||'')}">
            </div>
            <div class="eq-form-group">
              <label>Quantity</label>
              <input type="number" name="quantity" value="${p.quantity||1}" min="1">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Supplier</label>
              <input name="supplier" value="${esc(p.supplier||'')}" placeholder="Parts Town">
            </div>
            <div class="eq-form-group">
              <label>Last Price ($)</label>
              <input type="number" step="0.01" name="last_price" value="${p.last_price||''}">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Supplier URL</label>
            <input type="url" name="supplier_url" value="${esc(p.supplier_url||'')}" placeholder="https://partstown.com/...">
          </div>
          <div class="eq-form-group">
            <label>Assembly Path</label>
            <input name="assembly_path" value="${esc(p.assembly_path||'')}" placeholder="compressor > refrigeration > fan">
          </div>
          <div class="eq-form-group">
            <label>Notes</label>
            <textarea name="notes" rows="2">${esc(p.notes||'')}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closePart()">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">${part ? 'Save' : 'Add Part'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqPartForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { equipment_id: equipId };
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null) {
        if (['quantity'].includes(k)) data[k] = parseInt(v);
        else if (['last_price'].includes(k)) data[k] = parseFloat(v);
        else data[k] = v;
      }
    }
    try {
      if (part) {
        await NX.sb.from('equipment_parts').update(data).eq('id', part.id);
      } else {
        await NX.sb.from('equipment_parts').insert(data);
      }
      NX.toast && NX.toast('Saved ✓', 'success');
      closePart();
      openDetail(equipId);
    } catch (err) {
      console.error(err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

function closePart() {
  const m = document.getElementById('eqPartModal');
  if (m) m.classList.remove('active');
}

async function deletePart(id, equipId) {
  if (!confirm('Delete this part?')) return;
  try {
    await NX.sb.from('equipment_parts').delete().eq('id', id);
    NX.toast && NX.toast('Deleted ✓', 'success');
    openDetail(equipId);
  } catch(e) { console.error(e); }
}

/* ════════════════════════════════════════════════════════════════════════════
   MULTI-VENDOR PARTS
   
   Each part has a `vendors` JSONB column on equipment_parts. Each vendor:
     { name, url, oem_number, price, in_stock, notes, last_checked_at, is_preferred }
   
   After renderParts() inserts the .eq-parts-list into the DOM, the tab
   switcher calls enhancePartsList() which finds each .eq-part[data-part-id]
   row, loads its full record, and appends a vendor accordion below.
   
   Legacy data (parts with supplier/supplier_url/last_price but no vendors[])
   auto-migrates to a single preferred vendor.
   ════════════════════════════════════════════════════════════════════════════ */

async function enhancePartsList(list) {
  if (!list || list.dataset.enhanced === '1') return;
  list.dataset.enhanced = '1';
  const rows = list.querySelectorAll('.eq-part[data-part-id]');
  for (const partEl of rows) {
    const partId = partEl.dataset.partId;
    if (!partId) continue;
    await renderVendorsUnderPart(partEl, partId);
  }
}

async function renderVendorsUnderPart(partEl, partId) {
  let part;
  try {
    const { data } = await NX.sb.from('equipment_parts').select('*').eq('id', partId).single();
    part = data;
  } catch (e) {
    console.warn('[parts] could not load', partId, e);
    return;
  }
  if (!part) return;

  // Migrate legacy single-vendor fields to vendors[] if empty
  let vendors = Array.isArray(part.vendors) ? part.vendors.slice() : [];
  if (!vendors.length && (part.supplier || part.supplier_url || part.last_price)) {
    vendors = [{
      name: part.supplier || 'Unknown vendor',
      url: part.supplier_url || null,
      oem_number: part.oem_part_number || null,
      price: part.last_price || null,
      in_stock: null,
      notes: null,
      last_checked_at: null,
      is_preferred: true
    }];
  }

  const container = document.createElement('div');
  container.className = 'eq-part-vendors';
  container.innerHTML = `
    <div class="eq-part-vendors-header">
      <span class="eq-part-vendors-label">Vendors (${vendors.length})</span>
      <button class="eq-part-add-vendor-btn" data-part-id="${partId}">+ Vendor</button>
    </div>
    <div class="eq-part-vendors-list" id="eqVendList-${partId}">
      ${renderVendorsListHTML(vendors, partId)}
    </div>
  `;
  partEl.appendChild(container);
  wireVendorActions(container, part, vendors);
}

function renderVendorsListHTML(vendors, partId) {
  if (!vendors.length) {
    return '<div class="eq-part-vendors-empty">No vendors yet. Tap + Vendor to add one.</div>';
  }
  return vendors.map((v, idx) => `
    <div class="eq-part-vendor${v.is_preferred ? ' is-preferred' : ''}" data-vendor-idx="${idx}">
      <div class="eq-part-vendor-main">
        <div class="eq-part-vendor-row1">
          ${v.is_preferred ? '<span class="eq-part-vendor-star">PREFERRED</span>' : ''}
          <span class="eq-part-vendor-name">${esc(v.name || 'Unnamed')}</span>
        </div>
        <div class="eq-part-vendor-row2">
          ${v.oem_number ? `<span class="eq-part-vendor-oem">${esc(v.oem_number)}</span>` : ''}
          ${v.in_stock === true ? '<span class="eq-part-vendor-stock in">In stock</span>' : ''}
          ${v.in_stock === false ? '<span class="eq-part-vendor-stock out">Out</span>' : ''}
          ${v.last_checked_at ? `<span class="eq-part-vendor-checked">${formatVendorRelative(v.last_checked_at)}</span>` : ''}
        </div>
        ${v.notes ? `<div class="eq-part-vendor-notes">${esc(v.notes)}</div>` : ''}
      </div>
      <div class="eq-part-vendor-price">${v.price ? `$${parseFloat(v.price).toFixed(2)}` : ''}</div>
      <div class="eq-part-vendor-actions">
        ${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="eq-part-vendor-btn order" data-action="order" data-vendor-idx="${idx}">Order</a>` : ''}
        ${!v.is_preferred ? `<button class="eq-part-vendor-btn star-btn" data-action="prefer" data-vendor-idx="${idx}" title="Mark preferred">☆</button>` : ''}
        <button class="eq-part-vendor-btn edit-btn" data-action="edit" data-vendor-idx="${idx}" title="Edit">✎</button>
        <button class="eq-part-vendor-btn remove-btn" data-action="remove" data-vendor-idx="${idx}" title="Remove">✕</button>
      </div>
    </div>
  `).join('');
}

function wireVendorActions(container, part, vendors) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.vendorIdx, 10);

    if (action === 'order') {
      // Log the order action but let the link navigate naturally
      try {
        await NX.sb.from('daily_logs').insert({
          entry: `🛒 [ORDER] ${NX.currentUser?.name || 'User'} opened ${vendors[idx].name} for "${part.part_name}" ($${vendors[idx].price || '?'})`
        });
      } catch (_) {}
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (action === 'prefer') {
      vendors.forEach((v, i) => v.is_preferred = (i === idx));
      await saveVendors(part.id, vendors);
      rerenderVendorList(container, part.id, vendors);
    } else if (action === 'edit') {
      openVendorEditor(vendors[idx], async (updated) => {
        vendors[idx] = updated;
        await saveVendors(part.id, vendors);
        rerenderVendorList(container, part.id, vendors);
      });
    } else if (action === 'remove') {
      if (!confirm(`Remove vendor "${vendors[idx].name}"?`)) return;
      vendors.splice(idx, 1);
      await saveVendors(part.id, vendors);
      rerenderVendorList(container, part.id, vendors);
    }
  });

  const addBtn = container.querySelector('.eq-part-add-vendor-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openVendorEditor(null, async (newVendor) => {
        if (!vendors.length) newVendor.is_preferred = true;
        vendors.push(newVendor);
        await saveVendors(part.id, vendors);
        rerenderVendorList(container, part.id, vendors);
      });
    });
  }
}

function rerenderVendorList(container, partId, vendors) {
  const list = container.querySelector(`#eqVendList-${partId}`);
  if (list) list.innerHTML = renderVendorsListHTML(vendors, partId);
  const label = container.querySelector('.eq-part-vendors-label');
  if (label) label.textContent = `Vendors (${vendors.length})`;
}

async function saveVendors(partId, vendors) {
  try {
    await NX.sb.from('equipment_parts').update({ vendors }).eq('id', partId);
    // Keep legacy single-vendor fields in sync with the preferred vendor
    const preferred = vendors.find(v => v.is_preferred) || vendors[0];
    if (preferred) {
      await NX.sb.from('equipment_parts').update({
        supplier: preferred.name,
        supplier_url: preferred.url,
        oem_part_number: preferred.oem_number,
        last_price: preferred.price
      }).eq('id', partId);
    }
  } catch (e) {
    NX.toast && NX.toast('Save vendors failed: ' + e.message, 'error');
  }
}

function openVendorEditor(existing, onSave) {
  const v = existing || { name: '', url: '', oem_number: '', price: '', in_stock: null, notes: '', is_preferred: false };
  const modal = document.createElement('div');
  modal.className = 'eq-vendor-modal';
  modal.innerHTML = `
    <div class="eq-vendor-bg"></div>
    <div class="eq-vendor-card">
      <div class="eq-vendor-header">
        <div class="eq-vendor-title">${existing ? 'Edit Vendor' : 'Add Vendor'}</div>
        <button class="eq-vendor-close">✕</button>
      </div>
      <div class="eq-vendor-body">
        <label class="eq-vendor-label">Vendor Name</label>
        <input type="text" id="vendName" class="eq-vendor-input" value="${escAttr(v.name)}" placeholder="Parts Town">
        <label class="eq-vendor-label">Order URL</label>
        <input type="url" id="vendUrl" class="eq-vendor-input" value="${escAttr(v.url || '')}" placeholder="https://...">
        <div class="eq-vendor-row">
          <div class="eq-vendor-half">
            <label class="eq-vendor-label">OEM Number</label>
            <input type="text" id="vendOem" class="eq-vendor-input" value="${escAttr(v.oem_number || '')}" placeholder="1701514">
          </div>
          <div class="eq-vendor-half">
            <label class="eq-vendor-label">Price ($)</label>
            <input type="number" step="0.01" id="vendPrice" class="eq-vendor-input" value="${v.price || ''}" placeholder="105.00">
          </div>
        </div>
        <label class="eq-vendor-label">Availability</label>
        <select id="vendStock" class="eq-vendor-input">
          <option value="">Unknown</option>
          <option value="true" ${v.in_stock === true ? 'selected' : ''}>In stock</option>
          <option value="false" ${v.in_stock === false ? 'selected' : ''}>Out of stock</option>
        </select>
        <label class="eq-vendor-label">Notes</label>
        <textarea id="vendNotes" class="eq-vendor-input" rows="2" placeholder="Free shipping over $100">${esc(v.notes || '')}</textarea>
      </div>
      <div class="eq-vendor-actions">
        <button class="eq-vendor-cancel-btn">Cancel</button>
        <button class="eq-vendor-save-btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.eq-vendor-close').addEventListener('click', close);
  modal.querySelector('.eq-vendor-bg').addEventListener('click', close);
  modal.querySelector('.eq-vendor-cancel-btn').addEventListener('click', close);
  modal.querySelector('.eq-vendor-save-btn').addEventListener('click', () => {
    const stockVal = modal.querySelector('#vendStock').value;
    const updated = {
      ...v,
      name: modal.querySelector('#vendName').value.trim(),
      url: modal.querySelector('#vendUrl').value.trim() || null,
      oem_number: modal.querySelector('#vendOem').value.trim() || null,
      price: parseFloat(modal.querySelector('#vendPrice').value) || null,
      in_stock: stockVal === 'true' ? true : stockVal === 'false' ? false : null,
      notes: modal.querySelector('#vendNotes').value.trim() || null,
      last_checked_at: new Date().toISOString()
    };
    if (!updated.name) { NX.toast && NX.toast('Vendor name required', 'info'); return; }
    onSave(updated);
    close();
  });
}

function formatVendorRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  if (days < 365) return Math.floor(days / 30) + 'mo ago';
  return Math.floor(days / 365) + 'y ago';
}

/* ════════════════════════════════════════════════════════════════════════════
   MANUAL VIEWER — PDF card with first-page thumbnail
   
   Called by the tabs wiring when the Manual panel becomes active. Finds the
   iframe that renderManual() rendered, replaces it with a styled card,
   and renders page 1 of the PDF as a thumbnail using window.pdfjsLib.
   ════════════════════════════════════════════════════════════════════════════ */

function enhanceManualPanel(panel, equipId) {
  const root = panel.querySelector('.eq-manual');
  if (!root || root.dataset.enhanced === '1') return;
  const iframe = root.querySelector('.eq-manual-iframe');
  if (!iframe) return;
  root.dataset.enhanced = '1';
  
  const url = iframe.src;
  if (!url) return;
  let fileName = url.split('/').pop().split('?')[0];
  try { fileName = decodeURIComponent(fileName); } catch (_) {}

  const card = document.createElement('div');
  card.className = 'eq-manual-card';
  card.innerHTML = `
    <div class="eq-manual-card-thumb" id="eqManualThumb">
      <div class="eq-manual-card-loading">Loading preview…</div>
    </div>
    <div class="eq-manual-card-info">
      <div class="eq-manual-card-icon">📄</div>
      <div class="eq-manual-card-meta">
        <div class="eq-manual-card-name">${esc(fileName)}</div>
        <div class="eq-manual-card-pages" id="eqManualPages">PDF Document</div>
      </div>
    </div>
    <div class="eq-manual-card-actions">
      <a href="${esc(url)}" target="_blank" rel="noopener" class="eq-manual-card-open-btn">Open Manual ↗</a>
      <button class="eq-manual-card-secondary-btn" id="eqManualRemoveBtn">Remove</button>
    </div>
  `;
  iframe.replaceWith(card);
  
  // Hide the old "Open in new tab / Remove" actions row
  const oldActions = root.querySelector('.eq-manual-actions');
  if (oldActions) oldActions.style.display = 'none';

  // Wire remove
  card.querySelector('#eqManualRemoveBtn').addEventListener('click', () => {
    if (confirm('Remove the manual?')) removeManual(equipId);
  });

  // Render PDF thumbnail in background
  renderPdfThumbnail(url, card.querySelector('#eqManualThumb'), card.querySelector('#eqManualPages'));
}

async function renderPdfThumbnail(url, thumbContainer, pagesEl) {
  if (!window.pdfjsLib) {
    thumbContainer.innerHTML = '<div class="eq-manual-card-thumb-fallback">📄</div>';
    return;
  }
  try {
    const loadingTask = window.pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    if (pagesEl) pagesEl.textContent = `PDF · ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    const targetWidth = 240;
    const scale = targetWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    canvas.className = 'eq-manual-card-thumb-canvas';
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

    thumbContainer.innerHTML = '';
    thumbContainer.appendChild(canvas);
  } catch (err) {
    console.warn('[manual] PDF thumbnail failed:', err);
    thumbContainer.innerHTML = '<div class="eq-manual-card-thumb-fallback">📄</div>';
  }
}

async function removeManual(id) {
  if (!confirm('Remove manual from this equipment?')) return;
  await NX.sb.from('equipment').update({ manual_url: null }).eq('id', id);
  NX.toast && NX.toast('Manual removed', 'success');
  await loadEquipment();
  openDetail(id);
}


/* ════════════════════════════════════════════════════════════════════════════
   5. AI — data plate scanner, manual fetch/upload, pattern detect, cost
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── Data plate scanner ─── */

async function scanDataPlate(existingId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    NX.toast && NX.toast('Reading data plate…', 'info', 8000);

    try {
      const base64 = await fileToBase64(file);
      const mimeType = file.type;

      // Upload photo to storage
      let dataPlateUrl = null;
      try {
        const fname = `data-plate-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
        const { data: upload } = await NX.sb.storage
          .from('equipment-photos')
          .upload(fname, file, { upsert: false, contentType: file.type });
        if (upload) {
          const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
          dataPlateUrl = publicUrl;
        }
      } catch(e) { console.warn('[DataPlate] Upload skipped:', e.message); }

      const prompt = `You are reading a commercial kitchen or HVAC equipment data plate.
Extract ONLY what you can clearly see. Return raw JSON, no markdown:
{
  "manufacturer": "...",
  "model": "...",
  "serial_number": "...",
  "year_manufactured": null or YYYY,
  "specs": {
    "voltage": null or "115V" etc,
    "amperage": null or "10A",
    "hz": null or 60,
    "phase": null or "1" or "3",
    "refrigerant_type": null or "R-290",
    "refrigerant_amount": null or "3.5 oz",
    "btu": null or number,
    "capacity": null or "12 cu ft",
    "max_pressure_psi": null or number,
    "wattage": null or "1500W",
    "gas_type": null or "NG" or "LP"
  },
  "likely_category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
  "confidence": "high | medium | low"
}
Decode year from serial if manufacturer uses a known format (e.g. Hoshizaki: 3rd-4th chars = year).
Return null for any field not clearly visible. Do NOT guess.`;

      const answer = await NX.askClaudeVision(prompt, base64, mimeType);
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response');
      const extracted = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      if (existingId) {
        // Merge into existing equipment
        const updates = {};
        if (extracted.manufacturer) updates.manufacturer = extracted.manufacturer;
        if (extracted.model) updates.model = extracted.model;
        if (extracted.serial_number) updates.serial_number = extracted.serial_number;
        if (extracted.specs && Object.keys(extracted.specs).length) {
          const clean = {};
          for (const [k, v] of Object.entries(extracted.specs)) {
            if (v != null && v !== '') clean[k] = v;
          }
          if (Object.keys(clean).length) updates.specs = clean;
        }
        if (dataPlateUrl) updates.data_plate_url = dataPlateUrl;

        await NX.sb.from('equipment').update(updates).eq('id', existingId);
        NX.toast && NX.toast(`✓ Extracted: ${extracted.manufacturer || ''} ${extracted.model || ''}`, 'success');
        if (NX.syslog) NX.syslog('equipment_scanned', `${extracted.manufacturer} ${extracted.model}`);
        closeDetail();
        await loadEquipment();
        openDetail(existingId);
      } else {
        openPrepopulatedAddModal(extracted, dataPlateUrl);
      }
    } catch (err) {
      console.error('[DataPlate] Extraction failed:', err);
      NX.toast && NX.toast('Could not read plate — try better lighting/angle', 'error', 5000);
    }
  });

  input.click();
}

function openPrepopulatedAddModal(data, dataPlateUrl) {
  const modal = document.getElementById('eqPrepopModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqPrepopModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const catGuess = data.likely_category || 'other';
  const specsStr = data.specs ? JSON.stringify(data.specs, null, 2) : '{}';

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqPrepopModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqPrepopModal').classList.remove('active')">✕</button>
        <h2>✨ Scanned — Confirm Details</h2>
      </div>
      <div class="eq-detail-body">
        ${dataPlateUrl ? `<img src="${dataPlateUrl}" class="eq-detail-photo" style="max-height:150px">` : ''}
        <div class="eq-scan-conf">Confidence: <b>${data.confidence || 'medium'}</b></div>
        <form class="eq-form" id="eqPrepopForm">
          <div class="eq-form-group">
            <label>Name * (you name it)</label>
            <input name="name" required placeholder="e.g. Walk-In Cooler Kitchen">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Location *</label>
              <select name="location" required>
                ${LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Category</label>
              <select name="category">
                ${CATEGORIES.map(c => `<option value="${c.key}" ${catGuess===c.key?'selected':''}>${c.icon} ${c.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Manufacturer (from plate)</label>
              <input name="manufacturer" value="${escAttr(data.manufacturer||'')}">
            </div>
            <div class="eq-form-group">
              <label>Model (from plate)</label>
              <input name="model" value="${escAttr(data.model||'')}">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Serial Number (from plate)</label>
            <input name="serial_number" value="${escAttr(data.serial_number||'')}">
          </div>
          ${data.year_manufactured ? `
          <div class="eq-form-group">
            <label>Install Date (year extracted: ${data.year_manufactured})</label>
            <input type="date" name="install_date" value="${data.year_manufactured}-01-01">
          </div>` : ''}
          <div class="eq-form-group">
            <label>Extracted Specs (auto-filled, edit if needed)</label>
            <textarea name="_specs_json" rows="5" style="font-family:monospace;font-size:12px">${esc(specsStr)}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqPrepopModal').classList.remove('active')">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">Create Equipment</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqPrepopForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null && !k.startsWith('_')) payload[k] = v;
    }
    try {
      const specsJson = fd.get('_specs_json');
      if (specsJson) payload.specs = JSON.parse(specsJson);
    } catch(e) { console.warn('Invalid specs JSON, skipping'); }
    if (dataPlateUrl) payload.data_plate_url = dataPlateUrl;

    try {
      const { data: created, error } = await NX.sb.from('equipment').insert(payload).select().single();
      if (error) throw error;
      NX.toast && NX.toast('Equipment created ✓', 'success');
      // equipment_scanned_created syslog → covered by Postgres trigger on equipment INSERT
      modal.classList.remove('active');
      await loadEquipment();
      openDetail(created.id);
      if (created.manufacturer && created.model) {
        setTimeout(() => autoFetchManual(created.id), 500);
      }
    } catch (err) {
      console.error('[DataPlate] Create failed:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

/* ─── Manual upload ─── */

async function uploadManual(equipId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      NX.toast && NX.toast('PDF too large (max 50MB)', 'error');
      return;
    }

    NX.toast && NX.toast('Uploading manual…', 'info', 5000);

    try {
      const fname = `${equipId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
      const { error } = await NX.sb.storage
        .from('equipment-manuals')
        .upload(fname, file, { upsert: false, contentType: 'application/pdf' });
      if (error) throw error;

      const { data: { publicUrl } } = NX.sb.storage.from('equipment-manuals').getPublicUrl(fname);
      await NX.sb.from('equipment').update({ manual_url: publicUrl }).eq('id', equipId);

      NX.toast && NX.toast('Manual uploaded ✓', 'success');
      if (NX.syslog) NX.syslog('manual_uploaded', `equipment ${equipId}`);
      await loadEquipment();
      openDetail(equipId);
    } catch (err) {
      console.error('[Manual] Upload failed:', err);
      NX.toast && NX.toast('Upload failed: ' + err.message, 'error');
    }
  });

  input.click();
}

/* ─── Auto-fetch manual from the web ─── */

async function autoFetchManual(equipId) {
  const eq = (await NX.sb.from('equipment').select('*').eq('id', equipId).single()).data;
  if (!eq) return;
  if (!eq.manufacturer || !eq.model) {
    NX.toast && NX.toast('Add manufacturer and model first', 'info');
    return;
  }

  NX.toast && NX.toast(`Searching web for ${eq.manufacturer} ${eq.model} manual…`, 'info', 6000);

  try {
    const prompt = `Find the official service/owner manual PDF URL for this commercial kitchen equipment:
Manufacturer: ${eq.manufacturer}
Model: ${eq.model}

Prefer in this order:
1. Manufacturer's official website (e.g. hoshizakiamerica.com, vulcanequipment.com)
2. partstown.com resource center
3. manualslib.com

Return raw JSON, no markdown:
{
  "manual_url": "direct PDF URL or webpage containing manual",
  "source": "manufacturer | partstown | manualslib | other",
  "confidence": "high | medium | low",
  "notes": "brief note about what was found"
}
If nothing found, return {"manual_url": null, "source": null, "confidence": "low", "notes": "..."}`;

    const answer = await NX.askClaude(prompt, [{ role: 'user', content: 'Search now.' }], 800, true);

    const jsonStart = answer.indexOf('{');
    const jsonEnd = answer.lastIndexOf('}');
    if (jsonStart === -1) throw new Error('No JSON found');
    const result = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

    if (result.manual_url) {
      await NX.sb.from('equipment').update({
        manual_source_url: result.manual_url
      }).eq('id', equipId);
      NX.toast && NX.toast(`Found manual (${result.confidence} confidence) — saved link`, 'success', 5000);
      await loadEquipment();
      openDetail(equipId);
    } else {
      NX.toast && NX.toast(`No manual found. Try uploading a PDF directly.`, 'info', 5000);
    }
  } catch (err) {
    console.error('[Manual] Auto-fetch failed:', err);
    NX.toast && NX.toast('Search failed — try uploading manually', 'error');
  }
}

/* ─── Pattern detection + cost analysis ─── */

async function detectPatterns(equipId) {
  const { data: maint } = await NX.sb.from('equipment_maintenance')
    .select('*')
    .eq('equipment_id', equipId)
    .eq('event_type', 'repair')
    .order('event_date', { ascending: true });

  if (!maint || maint.length < 2) {
    return { hasPattern: false, reason: 'Not enough history (need 2+ repairs)' };
  }

  const intervals = [];
  for (let i = 1; i < maint.length; i++) {
    const a = new Date(maint[i - 1].event_date);
    const b = new Date(maint[i].event_date);
    intervals.push(Math.round((b - a) / 86400000));
  }

  const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;
  const variance = intervals.reduce((s, d) => s + Math.pow(d - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const relStdDev = stdDev / avgInterval;

  const lastRepair = new Date(maint[maint.length - 1].event_date);
  const daysSinceLastRepair = Math.round((new Date() - lastRepair) / 86400000);

  const allSymptoms = maint.map(m => (m.symptoms || m.description || '').toLowerCase()).join(' ');
  const keywords = ['compressor', 'fan', 'thermostat', 'refrigerant', 'drain', 'seal', 'gasket', 'motor', 'valve', 'pilot', 'igniter'];
  const topSymptom = keywords.find(k => (allSymptoms.match(new RegExp(k, 'g')) || []).length >= 2);

  const hasPattern = relStdDev < 0.4 && maint.length >= 3;
  const predictedDate = new Date(lastRepair.getTime() + avgInterval * 86400000);
  const daysUntilPredicted = Math.round((predictedDate - new Date()) / 86400000);

  return {
    hasPattern,
    totalRepairs: maint.length,
    avgInterval: Math.round(avgInterval),
    relStdDev: relStdDev.toFixed(2),
    daysSinceLastRepair,
    daysUntilPredicted,
    predictedDate: predictedDate.toISOString().slice(0, 10),
    topSymptom,
    alertLevel: daysUntilPredicted <= 14 && hasPattern ? 'urgent' :
                daysUntilPredicted <= 30 && hasPattern ? 'warning' : 'none'
  };
}

function analyzeCost(eq) {
  const yearlyCost = parseFloat(eq.cost_this_year) || 0;
  const purchasePrice = parseFloat(eq.purchase_price) || 0;
  const servicesThisYear = eq.services_this_year || 0;

  if (purchasePrice > 0 && yearlyCost > purchasePrice * 0.4) {
    return {
      yearlyCost,
      projectedNextYear: Math.round(yearlyCost * 1.3),
      recommendation: 'replace',
      reasoning: `Repairs (${Math.round(yearlyCost / purchasePrice * 100)}% of purchase price) exceed the 40% replacement threshold. A new unit likely pays back within a year.`
    };
  }

  if (servicesThisYear >= 3) {
    return {
      yearlyCost,
      recommendation: 'monitor',
      reasoning: `${servicesThisYear} services this year suggests increasing failure rate. Watch for escalation.`
    };
  }

  return {
    yearlyCost,
    recommendation: 'healthy',
    reasoning: servicesThisYear === 0
      ? 'No repairs this year — running well.'
      : `Only ${servicesThisYear} service${servicesThisYear>1?'s':''} this year — normal maintenance profile.`
  };
}

async function renderIntelligenceTab(equipId) {
  const eq = equipment.find(e => e.id === equipId) ||
             (await NX.sb.from('equipment_with_stats').select('*').eq('id', equipId).single()).data;
  if (!eq) return '<div class="eq-empty-small">Not found</div>';

  const pattern = await detectPatterns(equipId);
  const costAnalysis = analyzeCost(eq);

  let html = '<div class="eq-ai-panel">';

  html += '<div class="eq-ai-card"><h4>🔮 Failure Pattern Analysis</h4>';
  if (pattern.hasPattern) {
    const color = pattern.alertLevel === 'urgent' ? 'var(--red)' : pattern.alertLevel === 'warning' ? 'var(--amber)' : 'var(--green)';
    html += `
      <div class="eq-ai-alert" style="border-color:${color}">
        <div class="eq-ai-big" style="color:${color}">
          ${pattern.daysUntilPredicted < 0
            ? `⚠ Overdue by ${-pattern.daysUntilPredicted} days`
            : pattern.daysUntilPredicted <= 14
            ? `⚠ Service needed in ~${pattern.daysUntilPredicted} days`
            : `${pattern.daysUntilPredicted} days until predicted service`}
        </div>
        <div class="eq-ai-detail">
          Based on ${pattern.totalRepairs} past repairs averaging every ${pattern.avgInterval} days.
          ${pattern.topSymptom ? `<br><b>Common issue:</b> ${pattern.topSymptom}` : ''}
          <br>Last repair: ${pattern.daysSinceLastRepair} days ago
          <br>Predicted next: ${new Date(pattern.predictedDate).toLocaleDateString()}
        </div>
      </div>`;
  } else {
    html += `<div class="eq-ai-neutral">${pattern.reason || `Need more repair history to detect patterns (${pattern.totalRepairs || 0} recorded).`}</div>`;
  }
  html += '</div>';

  html += '<div class="eq-ai-card"><h4>💰 Cost Intelligence</h4>';
  if (costAnalysis.recommendation === 'replace') {
    html += `
      <div class="eq-ai-alert" style="border-color:var(--red)">
        <div class="eq-ai-big" style="color:var(--red)">🔄 Consider Replacement</div>
        <div class="eq-ai-detail">
          Total repairs last 12mo: <b>$${costAnalysis.yearlyCost.toLocaleString()}</b><br>
          ${costAnalysis.projectedNextYear ? `Projected next year: <b>$${costAnalysis.projectedNextYear.toLocaleString()}</b><br>` : ''}
          ${eq.purchase_price ? `Original cost: $${Math.round(eq.purchase_price).toLocaleString()}<br>` : ''}
          <i>${costAnalysis.reasoning}</i>
        </div>
      </div>`;
  } else if (costAnalysis.recommendation === 'monitor') {
    html += `
      <div class="eq-ai-alert" style="border-color:var(--amber)">
        <div class="eq-ai-big" style="color:var(--amber)">⚠ Monitor Costs</div>
        <div class="eq-ai-detail">
          YTD repair cost: <b>$${costAnalysis.yearlyCost.toLocaleString()}</b><br>
          <i>${costAnalysis.reasoning}</i>
        </div>
      </div>`;
  } else {
    html += `
      <div class="eq-ai-neutral">
        YTD repair cost: $${costAnalysis.yearlyCost.toLocaleString()}<br>
        <i>${costAnalysis.reasoning}</i>
      </div>`;
  }
  html += '</div>';

  html += `
    <div class="eq-ai-actions">
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.scanDataPlate('${equipId}')">📷 Re-scan Data Plate</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.autoFetchManual('${equipId}')">🌐 Find Manual Online</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.uploadManual('${equipId}')">📄 Upload Manual PDF</button>
    </div>
  `;
  html += '</div>';
  return html;
}

/* ─── Fleet-wide scan for the morning brief ─── */

async function scanFleet() {
  const { data: allEq } = await NX.sb.from('equipment').select('id, name, location')
    .not('status', 'eq', 'retired');
  if (!allEq || !allEq.length) return [];

  const urgent = [];
  for (const eq of allEq) {
    const p = await detectPatterns(eq.id);
    if (p.hasPattern && p.alertLevel !== 'none') {
      urgent.push({
        id: eq.id, name: eq.name, location: eq.location,
        days: p.daysUntilPredicted, level: p.alertLevel, symptom: p.topSymptom
      });
    }
  }
  return urgent.sort((a, b) => a.days - b.days);
}

/* ─── Predictive PM ─── */

async function suggestPMDate(equipId) {
  const pattern = await detectPatterns(equipId);
  if (!pattern.hasPattern) return null;
  const predicted = new Date(pattern.predictedDate);
  const pmDate = new Date(predicted.getTime() - 14 * 86400000);
  return pmDate.toISOString().slice(0, 10);
}

async function applyPredictivePM(equipId) {
  const suggested = await suggestPMDate(equipId);
  if (!suggested) {
    NX.toast && NX.toast('Not enough history for prediction', 'info');
    return;
  }
  if (!confirm(`Set next PM to ${new Date(suggested).toLocaleDateString()}?\n\nBased on repair pattern, this is 2 weeks before predicted next failure.`)) return;

  await NX.sb.from('equipment').update({ next_pm_date: suggested }).eq('id', equipId);
  NX.toast && NX.toast('Predictive PM scheduled ✓', 'success');
  await loadEquipment();
  openDetail(equipId);
}

/* ─── BOM extraction from manual ─── */

async function extractBOMFromManual(equipId) {
  // Build progress modal so user sees each step
  const modal = document.createElement('div');
  modal.className = 'eq-extract-modal';
  modal.innerHTML = `
    <div class="eq-extract-bg"></div>
    <div class="eq-extract-card">
      <div class="eq-extract-header">
        <div class="eq-extract-title">✨ Extracting Parts from Manual</div>
      </div>
      <div class="eq-extract-body" id="eqExtractBody">
        <div class="eq-extract-step" id="eqExtractStep">Starting…</div>
        <div class="eq-extract-spinner"></div>
      </div>
      <div class="eq-extract-actions">
        <button class="eq-extract-cancel-btn" id="eqExtractCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let cancelled = false;
  modal.querySelector('#eqExtractCancel').addEventListener('click', () => { cancelled = true; modal.remove(); });
  const setStep = (t) => { const el = modal.querySelector('#eqExtractStep'); if (el) el.textContent = t; };
  const showError = (msg) => {
    modal.querySelector('#eqExtractBody').innerHTML = `
      <div class="eq-extract-error">
        <div class="eq-extract-error-icon">⚠</div>
        <div class="eq-extract-error-msg">${esc(msg)}</div>
      </div>`;
    modal.querySelector('#eqExtractCancel').textContent = 'Close';
  };

  try {
    setStep('Loading equipment details…');
    const { data: eq, error: eqErr } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
    if (eqErr) throw new Error('Equipment not found: ' + eqErr.message);
    if (cancelled) return;

    if (!eq.manual_url) { showError('No manual uploaded yet. Go to the Manual tab and upload a PDF first.'); return; }

    const apiKey = 'edge';  // edge function holds the real key
    if (!apiKey) { showError('No Anthropic API key configured. Set it in Admin → API Keys.'); return; }

    setStep('Downloading manual PDF…');
    let pdfRes;
    try { pdfRes = await fetch(eq.manual_url); }
    catch (e) { showError('Could not fetch manual: ' + e.message); return; }
    if (!pdfRes.ok) { showError(`Manual returned HTTP ${pdfRes.status}. The file may have been moved or deleted.`); return; }
    if (cancelled) return;

    setStep('Preparing PDF for analysis…');
    const pdfBlob = await pdfRes.blob();
    const sizeMB = (pdfBlob.size / 1048576).toFixed(2);
    if (pdfBlob.size > 32 * 1048576) { showError(`Manual is ${sizeMB}MB. Claude PDF input is limited to ~32MB.`); return; }
    const pdfBase64 = await blobToBase64(pdfBlob);
    if (cancelled) return;

    setStep(`Sending ${sizeMB}MB PDF to Claude (20–60 seconds)…`);
    const { data, error: invokeErr } = await NX.sb.functions.invoke('chat', {
      body: {
        model: NX.getModel?.() || 'claude-sonnet-4-5',
        max_tokens: 4096,
        user_name: NX.currentUser?.name,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: `You are reading a service/parts manual for commercial kitchen equipment:
Equipment: ${eq.manufacturer || 'Unknown'} ${eq.model || ''}
Name: ${eq.name || ''}

Extract all SERVICEABLE PARTS from the parts list / exploded diagram sections.
Focus on parts someone might need to order (compressors, fans, motors, thermostats, gaskets, filters, valves, pumps, igniters, thermocouples, heating elements, belts, bearings, seals, pilot assemblies, switches, knobs, doors, hinges, lights, drip pans, racks).

Skip: screws, bolts, generic fasteners, cosmetic-only pieces.

Return raw JSON array (no markdown, no preamble):
[
  {
    "part_name": "Evaporator Fan Motor",
    "oem_part_number": "2A1540-00",
    "mfr_part_number": null,
    "quantity": 1,
    "assembly_path": "Refrigeration > Condenser",
    "diagram_page": 24,
    "notes": "Any service note mentioned"
  }
]

If no parts are found, return [].` }
          ]
        }]
      }
    });
    if (cancelled) return;

    if (invokeErr) { showError('Claude API error: ' + (invokeErr.message || 'invoke failed')); return; }
    if (data?.error) { showError('Claude returned error: ' + (typeof data.error === 'string' ? data.error : data.error.message)); return; }

    setStep('Parsing parts list…');
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const arrStart = answer.indexOf('['), arrEnd = answer.lastIndexOf(']');
    if (arrStart === -1 || arrEnd <= arrStart) { showError('Claude did not return a valid parts list. Response started: ' + answer.slice(0, 200)); return; }
    let parts;
    try { parts = JSON.parse(answer.slice(arrStart, arrEnd + 1)); }
    catch (e) { showError('Could not parse response as JSON: ' + e.message); return; }
    if (!Array.isArray(parts) || !parts.length) { showError('No serviceable parts found in this manual.'); return; }

    showExtractionConfirmation(modal, equipId, parts);
  } catch (err) {
    console.error('[extractBOM] failed:', err);
    showError('Unexpected error: ' + err.message);
  }
}

function showExtractionConfirmation(modal, equipId, parts) {
  modal.querySelector('#eqExtractBody').innerHTML = `
    <div class="eq-extract-success">
      <div class="eq-extract-success-icon">✓</div>
      <div class="eq-extract-success-count">Found ${parts.length} part${parts.length === 1 ? '' : 's'}</div>
    </div>
    <div class="eq-extract-parts-list">
      ${parts.map((p, i) => `
        <label class="eq-extract-part">
          <input type="checkbox" checked data-part-idx="${i}">
          <div class="eq-extract-part-info">
            <div class="eq-extract-part-name">${esc(p.part_name)}</div>
            <div class="eq-extract-part-meta">
              ${p.oem_part_number ? `OEM: ${esc(p.oem_part_number)}` : ''}
              ${p.assembly_path ? ` · ${esc(p.assembly_path)}` : ''}
              ${p.quantity > 1 ? ` · Qty: ${p.quantity}` : ''}
            </div>
          </div>
        </label>
      `).join('')}
    </div>
  `;
  modal.querySelector('.eq-extract-actions').innerHTML = `
    <button class="eq-extract-cancel-btn" id="eqExtractCancel2">Cancel</button>
    <button class="eq-extract-save-btn" id="eqExtractSave">Save Selected Parts</button>
  `;
  modal.querySelector('#eqExtractCancel2').addEventListener('click', () => modal.remove());
  modal.querySelector('#eqExtractSave').addEventListener('click', async () => {
    const selectedIdxs = Array.from(modal.querySelectorAll('input[type=checkbox]:checked')).map(cb => parseInt(cb.dataset.partIdx, 10));
    const selectedParts = selectedIdxs.map(i => parts[i]);
    if (!selectedParts.length) { NX.toast && NX.toast('No parts selected', 'info'); return; }
    try {
      const rows = selectedParts.map(p => ({
        equipment_id: equipId,
        part_name: p.part_name,
        oem_part_number: p.oem_part_number || null,
        quantity: p.quantity || 1,
        assembly_path: p.assembly_path || null,
        notes: p.notes || null,
        vendors: []
      }));
      const { error } = await NX.sb.from('equipment_parts').insert(rows);
      if (error) throw error;
      NX.toast && NX.toast(`Saved ${rows.length} part${rows.length === 1 ? '' : 's'}`, 'success');
      modal.remove();
      openDetail(equipId);
    } catch (e) {
      NX.toast && NX.toast('Save failed: ' + e.message, 'error');
    }
  });
}

async function extractBOMFromManual_LEGACY(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq || !eq.manual_url) {
    NX.toast && NX.toast('Upload a manual first', 'info');
    return;
  }

  NX.toast && NX.toast('Reading manual and extracting parts…', 'info', 10000);

  try {
    const pdfRes = await fetch(eq.manual_url);
    if (!pdfRes.ok) throw new Error('Could not fetch manual');
    const pdfBlob = await pdfRes.blob();
    const pdfBase64 = await blobToBase64(pdfBlob);

    const { data, error: invokeErr } = await NX.sb.functions.invoke('chat', {
      body: {
        model: NX.getModel(),
        max_tokens: 4000,
        user_name: NX.currentUser?.name,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: `You are reading a service/parts manual for commercial kitchen equipment:
Equipment: ${eq.manufacturer} ${eq.model}

Extract all SERVICEABLE PARTS from the parts list / exploded diagram sections.
Focus on parts someone might need to order (compressors, fans, motors, thermostats, gaskets, filters, valves, pumps, igniters, thermocouples, heating elements, belts, bearings, seals, pilot assemblies).

Skip: screws, bolts, generic fasteners, cosmetic pieces.

Return raw JSON array (no markdown):
[
  {
    "part_name": "Evaporator Fan Motor",
    "oem_part_number": "2A1540-00",
    "mfr_part_number": null,
    "quantity": 1,
    "assembly_path": "Refrigeration > Condenser",
    "diagram_page": 24,
    "notes": "Any service note mentioned"
  }
]

If no parts are found, return []. Extract only what's explicitly listed.` }
          ]
        }]
      }
    });

    if (invokeErr) throw new Error(invokeErr.message || 'AI request failed');
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message);
    const answer = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';

    const arrStart = answer.indexOf('[');
    const arrEnd = answer.lastIndexOf(']');
    if (arrStart === -1) throw new Error('No parts array in response');
    const parts = JSON.parse(answer.slice(arrStart, arrEnd + 1));

    if (!parts.length) {
      NX.toast && NX.toast('No serviceable parts found in manual', 'info');
      return;
    }

    showBOMConfirmation(equipId, parts);
  } catch (err) {
    console.error('[BOM] Extraction failed:', err);
    NX.toast && NX.toast('Extraction failed: ' + err.message, 'error', 8000);
  }
}

function showBOMConfirmation(equipId, parts) {
  const modal = document.createElement('div');
  modal.className = 'eq-modal active';
  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="this.parentElement.remove()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="this.closest('.eq-modal').remove()">✕</button>
        <h2>✨ Extracted ${parts.length} Parts</h2>
      </div>
      <div class="eq-detail-body">
        <p>Review and deselect any parts you don't want to add:</p>
        <div class="eq-bom-list">
          ${parts.map((p, i) => `
            <label class="eq-bom-item">
              <input type="checkbox" checked data-idx="${i}">
              <div>
                <div class="eq-bom-name">${esc(p.part_name)}</div>
                <div class="eq-bom-sub">
                  ${p.oem_part_number ? 'OEM: ' + esc(p.oem_part_number) : ''}
                  ${p.assembly_path ? ' · ' + esc(p.assembly_path) : ''}
                  ${p.diagram_page ? ' · p.' + p.diagram_page : ''}
                </div>
              </div>
            </label>
          `).join('')}
        </div>
        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="this.closest('.eq-modal').remove()">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="bomConfirmBtn">Add Selected Parts</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#bomConfirmBtn').addEventListener('click', async () => {
    const checked = modal.querySelectorAll('input[type="checkbox"]:checked');
    const selected = Array.from(checked).map(c => parts[parseInt(c.dataset.idx)]);
    if (!selected.length) { modal.remove(); return; }

    const toInsert = selected.map(p => ({
      equipment_id: equipId,
      part_name: p.part_name || 'Unknown',
      oem_part_number: p.oem_part_number || null,
      mfr_part_number: p.mfr_part_number || null,
      quantity: p.quantity || 1,
      assembly_path: p.assembly_path || null,
      diagram_page: p.diagram_page || null,
      notes: p.notes || null,
      supplier: 'Parts Town',
      supplier_url: `https://www.partstown.com/search?searchterm=${encodeURIComponent((p.oem_part_number || p.part_name || '').trim())}`
    }));

    try {
      const { error } = await NX.sb.from('equipment_parts').insert(toInsert);
      if (error) throw error;
      NX.toast && NX.toast(`Added ${toInsert.length} parts ✓`, 'success');
      if (NX.syslog) NX.syslog('bom_extracted', `${toInsert.length} parts from manual`);
      modal.remove();
      openDetail(equipId);
    } catch (err) {
      NX.toast && NX.toast('Insert failed: ' + err.message, 'error');
    }
  });
}

async function exportPartsCart(equipId) {
  const { data: parts } = await NX.sb.from('equipment_parts')
    .select('part_name, oem_part_number, quantity, supplier_url')
    .eq('equipment_id', equipId);

  if (!parts || !parts.length) {
    NX.toast && NX.toast('No parts to export', 'info');
    return;
  }

  const list = parts.map(p => {
    const searchTerm = p.oem_part_number || p.part_name;
    const url = p.supplier_url || `https://www.partstown.com/search?searchterm=${encodeURIComponent(searchTerm)}`;
    return { name: p.part_name, pn: p.oem_part_number || 'N/A', qty: p.quantity || 1, url };
  });

  const modal = document.createElement('div');
  modal.className = 'eq-modal active';
  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="this.parentElement.remove()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="this.closest('.eq-modal').remove()">✕</button>
        <h2>🛒 Parts Shopping List</h2>
      </div>
      <div class="eq-detail-body">
        <p>Click each link to open the part on Parts Town. Each opens in a new tab so you can build your cart there.</p>
        <div class="eq-parts-cart">
          ${list.map(p => `
            <div class="eq-cart-item">
              <div class="eq-cart-info">
                <div class="eq-cart-name">${esc(p.name)}</div>
                <div class="eq-cart-pn">PN: ${esc(p.pn)} · Qty: ${p.qty}</div>
              </div>
              <a href="${p.url}" target="_blank" class="eq-btn eq-btn-primary eq-btn-small">Shop →</a>
            </div>
          `).join('')}
        </div>
        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="
            const text = ${JSON.stringify(list.map(p => `${p.name} | PN: ${p.pn} | Qty: ${p.qty} | ${p.url}`).join('\n'))};
            navigator.clipboard.writeText(text);
            NX.toast && NX.toast('List copied ✓', 'success');
          ">📋 Copy List</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function checkWarranties() {
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await NX.sb.from('equipment')
    .select('id, name, location, warranty_until')
    .not('warranty_until', 'is', null)
    .gte('warranty_until', today)
    .lte('warranty_until', soon);
  return data || [];
}


/* ════════════════════════════════════════════════════════════════════════════
   6. AI CREATE — describe / photo / bulk / dataplate
   ════════════════════════════════════════════════════════════════════════════ */

function openAICreator() {
  const modal = document.getElementById('eqAICreatorModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqAICreatorModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqAICreatorModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqAICreatorModal').classList.remove('active')">✕</button>
        <h2>✨ AI Create Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-ai-intro">Let AI handle the data entry. Pick your method:</div>
        <div class="eq-ai-methods">
          <button class="eq-ai-method" data-method="describe">
            <div class="eq-ai-method-icon">💬</div>
            <div class="eq-ai-method-title">Describe It</div>
            <div class="eq-ai-method-desc">Type or paste details in natural language. AI extracts everything and auto-links contractors, parts, locations.</div>
          </button>
          <button class="eq-ai-method" data-method="photo">
            <div class="eq-ai-method-icon">📸</div>
            <div class="eq-ai-method-title">Photo of Unit</div>
            <div class="eq-ai-method-desc">Take a picture of the equipment. AI identifies make/model from visible details.</div>
          </button>
          <button class="eq-ai-method" data-method="bulk">
            <div class="eq-ai-method-icon">🏢</div>
            <div class="eq-ai-method-title">Scan Whole Room</div>
            <div class="eq-ai-method-desc">Take a photo of your kitchen or bar. AI identifies every piece it sees and adds all of them at once.</div>
          </button>
          <button class="eq-ai-method" data-method="dataplate">
            <div class="eq-ai-method-icon">🔖</div>
            <div class="eq-ai-method-title">Scan Data Plate</div>
            <div class="eq-ai-method-desc">Photograph the metal/plastic data plate. AI extracts exact model/serial/specs.</div>
          </button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal.querySelectorAll('.eq-ai-method').forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.dataset.method;
      modal.classList.remove('active');
      if (method === 'describe') openDescribeDialog();
      else if (method === 'photo') photoIdentify();
      else if (method === 'bulk') bulkIdentify();
      else if (method === 'dataplate') scanDataPlate(null);
    });
  });
}

function openDescribeDialog() {
  const modal = document.getElementById('eqDescribeModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqDescribeModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqDescribeModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqDescribeModal').classList.remove('active')">✕</button>
        <h2>💬 Describe Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-ai-intro">
          Describe the equipment in your own words. AI extracts everything, auto-links contractors and parts from your existing data.
        </div>
        <div class="eq-ai-examples">
          <div class="eq-ai-examples-title">Examples:</div>
          <div class="eq-ai-example" data-fill="Hoshizaki KM-320MAH ice machine at Suerte kitchen, installed March 2023, serial 240317001, Tyler from Austin Air & Ice services it quarterly">📝 Single equipment with contractor</div>
          <div class="eq-ai-example" data-fill="Walk-in cooler at Este, True Manufacturing T-49, bought 2022, warranty until 2027, uses condenser fan 800-5016 and evaporator coil 800-1402. Last serviced by Juan in January">📝 Equipment with parts and history</div>
          <div class="eq-ai-example" data-fill="Vulcan 6-burner range at Bar Toti, gas, natural gas hookup, bought used in 2021. Has pilot issues every few months">📝 Minimal info with issues</div>
        </div>
        <div class="eq-form-group">
          <label>Description (as much or little as you want)</label>
          <textarea id="eqDescribeInput" rows="6" placeholder="e.g. Hoshizaki ice machine at Suerte, installed last year, Tyler services it..."></textarea>
        </div>
        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqDescribeModal').classList.remove('active')">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="eqDescribeGo">✨ Create with AI</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal.querySelectorAll('.eq-ai-example').forEach(ex => {
    ex.addEventListener('click', () => {
      document.getElementById('eqDescribeInput').value = ex.dataset.fill;
      document.getElementById('eqDescribeInput').focus();
    });
  });

  document.getElementById('eqDescribeGo').addEventListener('click', async () => {
    const text = document.getElementById('eqDescribeInput').value.trim();
    if (!text) return;
    const btn = document.getElementById('eqDescribeGo');
    btn.disabled = true;
    btn.textContent = '✨ Thinking…';
    try {
      await createFromDescription(text);
      modal.classList.remove('active');
    } catch (err) {
      console.error('[AI-Create] Describe failed:', err);
      NX.toast && NX.toast('Creation failed: ' + err.message, 'error', 6000);
      btn.disabled = false;
      btn.textContent = '✨ Create with AI';
    }
  });
}

async function createFromDescription(text) {
  const context = await loadExistingContext();
  const system = `You are creating equipment records for a restaurant management system.
Given a natural language description, extract structured data AND identify any references
to existing people, contractors, parts, or locations from this list:

EXISTING CONTRACTORS: ${context.contractors.map(c => c.name).join(', ') || 'none'}
EXISTING PEOPLE: ${context.people.map(p => p.name).join(', ') || 'none'}
EXISTING PARTS: ${context.parts.slice(0, 30).map(p => p.name).join(', ') || 'none'}
LOCATIONS: Suerte, Este, Bar Toti

Extract and return raw JSON (no markdown), can include multiple equipment if described:
{
  "equipment": [
    {
      "name": "descriptive name",
      "location": "Suerte" | "Este" | "Bar Toti",
      "area": "Kitchen" | "Bar" | "Dining" etc or null,
      "category": "refrigeration" | "cooking" | "ice" | "hvac" | "dish" | "bev" | "smallware" | "other",
      "manufacturer": "...",
      "model": "...",
      "serial_number": "...",
      "install_date": "YYYY-MM-DD" or null,
      "warranty_until": "YYYY-MM-DD" or null,
      "status": "operational" | "needs_service" | "down",
      "notes": "any other details like issues, quirks, etc",
      "linked_contractors": ["exact name from EXISTING CONTRACTORS list"],
      "linked_people": ["exact name from EXISTING PEOPLE list"],
      "linked_parts": ["exact name from EXISTING PARTS list"],
      "mentioned_parts_new": [
        {"name": "Condenser Fan", "oem_part_number": "800-5016"}
      ],
      "mentioned_issues": ["pilot issues", "runs warm"]
    }
  ],
  "interpretation_notes": "brief note about what you understood or assumed"
}

If a contractor or person is mentioned but not in the existing list, include their name in linked_contractors anyway — we'll auto-create them.
If the text mentions parts with part numbers, add them to mentioned_parts_new.
Infer reasonable defaults only when obvious.
Return null for fields where info isn't provided. DON'T HALLUCINATE data.`;

  const answer = await NX.askClaude(system, [{ role: 'user', content: text }], 3000);
  const jsonStart = answer.indexOf('{');
  const jsonEnd = answer.lastIndexOf('}');
  if (jsonStart === -1) throw new Error('No JSON in AI response');
  const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

  if (!parsed.equipment || !parsed.equipment.length) {
    throw new Error('No equipment could be extracted');
  }
  showCreationConfirmation(parsed, context);
}

async function photoIdentify() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    NX.toast && NX.toast('AI identifying equipment…', 'info', 10000);

    try {
      const base64 = await fileToBase64(file);
      const prompt = `You are looking at a photo of commercial restaurant/kitchen equipment.
Identify it as best you can. Return raw JSON (no markdown):
{
  "equipment": [{
    "name": "descriptive name — be specific about what you see",
    "category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
    "subcategory": "walk_in | reach_in | fryer | combi | range | hood | ice_machine | etc",
    "manufacturer": "... (only if visible/identifiable from badges/design)" or null,
    "model": "... (only if readable)" or null,
    "approximate_size": "small | medium | large",
    "condition": "new | good | fair | needs_attention",
    "visible_details": ["any notable features you see"],
    "confidence": "high | medium | low",
    "notes": "what you observed"
  }],
  "scene_description": "brief description of what's in the photo"
}
If you can't identify it clearly, still return a best-guess entry with low confidence.`;

      const answer = await NX.askClaudeVision(prompt, base64, file.type);
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      const photoUrl = await uploadCreatePhoto(file, parsed.equipment[0]);
      if (photoUrl) parsed.equipment[0].photo_url = photoUrl;

      const context = await loadExistingContext();
      showCreationConfirmation(parsed, context, 'photo');
    } catch (err) {
      console.error('[AI-Create] Photo failed:', err);
      NX.toast && NX.toast('Identification failed: ' + err.message, 'error', 6000);
    }
  });

  input.click();
}

async function bulkIdentify() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    const location = await askLocation();
    if (!location) return;

    NX.toast && NX.toast('AI scanning the room…', 'info', 15000);

    try {
      const base64 = await fileToBase64(file);
      const prompt = `You are looking at a wide-angle photo of a commercial restaurant space (${location}).
Identify EVERY piece of equipment visible in the photo.

Return raw JSON (no markdown):
{
  "equipment": [
    {
      "name": "descriptive name",
      "category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
      "subcategory": "walk_in | reach_in | fryer | combi | range | hood | ice_machine | prep_table | etc",
      "manufacturer": "..." or null (only if visible),
      "model": "..." or null (only if readable),
      "approximate_size": "small | medium | large",
      "location_in_frame": "left | center | right | back | foreground",
      "condition": "new | good | fair | needs_attention",
      "confidence": "high | medium | low",
      "notes": "what you see"
    }
  ],
  "scene_description": "brief description"
}

List EVERY distinct piece of equipment. Even small items like microwaves, coffee makers, prep tables.
Skip: utensils, small hand tools, food, decor items.`;

      const answer = await NX.askClaudeVision(prompt, base64, file.type);
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      parsed.equipment.forEach(eq => eq.location = location);
      const photoUrl = await uploadCreatePhoto(file, { name: 'bulk-scan' });
      parsed.equipment.forEach(eq => eq.photo_url = photoUrl);

      const context = await loadExistingContext();
      showCreationConfirmation(parsed, context, 'bulk');
    } catch (err) {
      console.error('[AI-Create] Bulk failed:', err);
      NX.toast && NX.toast('Scan failed: ' + err.message, 'error', 6000);
    }
  });

  input.click();
}

function askLocation() {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'eq-modal active';
    modal.innerHTML = `
      <div class="eq-detail-bg"></div>
      <div class="eq-detail eq-edit">
        <div class="eq-detail-head"><h2>Which location?</h2></div>
        <div class="eq-detail-body">
          <div class="eq-loc-picker">
            <button class="eq-loc-btn" data-loc="Suerte">🌴 Suerte</button>
            <button class="eq-loc-btn" data-loc="Este">🐟 Este</button>
            <button class="eq-loc-btn" data-loc="Bar Toti">🥃 Bar Toti</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('.eq-loc-btn').forEach(btn => {
      btn.addEventListener('click', () => { resolve(btn.dataset.loc); modal.remove(); });
    });
    modal.querySelector('.eq-detail-bg').addEventListener('click', () => { resolve(null); modal.remove(); });
  });
}

function showCreationConfirmation(parsed, context, source = 'describe') {
  const modal = document.getElementById('eqConfirmModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqConfirmModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const equipList = parsed.equipment || [];
  const multi = equipList.length > 1;

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqConfirmModal').classList.remove('active')"></div>
    <div class="eq-detail">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqConfirmModal').classList.remove('active')">✕</button>
        <h2>✨ AI Found ${equipList.length} ${multi ? 'Pieces' : 'Piece'}</h2>
      </div>
      <div class="eq-detail-body">
        ${parsed.interpretation_notes || parsed.scene_description ? `
          <div class="eq-ai-interp">
            <b>AI's interpretation:</b> ${esc(parsed.interpretation_notes || parsed.scene_description)}
          </div>
        ` : ''}
        ${multi ? `
          <div class="eq-ai-bulk-actions">
            <button class="eq-btn eq-btn-tiny" onclick="document.querySelectorAll('[data-eq-confirm]').forEach(c => c.checked = true)">Select All</button>
            <button class="eq-btn eq-btn-tiny" onclick="document.querySelectorAll('[data-eq-confirm]').forEach(c => c.checked = false)">Deselect All</button>
          </div>
        ` : ''}
        <div class="eq-confirm-list">
          ${equipList.map((eq, i) => `
            <div class="eq-confirm-card">
              <label class="eq-confirm-head">
                <input type="checkbox" checked data-eq-confirm="${i}">
                <div class="eq-confirm-icon">${catIcon(eq.category)}</div>
                <div class="eq-confirm-title">
                  <div class="eq-confirm-name" contenteditable="true" data-eq-field="name" data-idx="${i}">${esc(eq.name || 'Unnamed')}</div>
                  <div class="eq-confirm-sub">
                    ${esc(eq.manufacturer || '')} ${esc(eq.model || '')}
                    ${eq.confidence ? `<span class="eq-conf eq-conf-${eq.confidence}">${eq.confidence}</span>` : ''}
                  </div>
                </div>
              </label>
              <div class="eq-confirm-details">
                <div class="eq-confirm-field">
                  <label>Location</label>
                  <select data-eq-field="location" data-idx="${i}">
                    ${LOCATIONS.map(l => `<option ${eq.location===l?'selected':''}>${l}</option>`).join('')}
                  </select>
                </div>
                <div class="eq-confirm-field">
                  <label>Area</label>
                  <input data-eq-field="area" data-idx="${i}" value="${esc(eq.area || '')}">
                </div>
                <div class="eq-confirm-field">
                  <label>Category</label>
                  <select data-eq-field="category" data-idx="${i}">
                    ${CATEGORIES.map(c => `<option value="${c.key}" ${eq.category===c.key?'selected':''}>${c.key}</option>`).join('')}
                  </select>
                </div>
                <div class="eq-confirm-field">
                  <label>Status</label>
                  <select data-eq-field="status" data-idx="${i}">
                    <option value="operational" ${eq.status==='operational'?'selected':''}>Operational</option>
                    <option value="needs_service" ${eq.status==='needs_service'?'selected':''}>Needs Service</option>
                    <option value="down" ${eq.status==='down'?'selected':''}>Down</option>
                  </select>
                </div>
              </div>
              ${eq.linked_contractors?.length || eq.linked_people?.length ? `
                <div class="eq-confirm-links">
                  <div class="eq-confirm-links-label">🔗 Will link to:</div>
                  ${(eq.linked_contractors || []).map(name => {
                    const existing = context.contractors.find(c => c.name.toLowerCase() === name.toLowerCase());
                    return `<span class="eq-link-chip ${existing?'eq-link-existing':'eq-link-new'}">
                      ${existing ? '✓' : '+'} ${esc(name)} ${existing ? '' : '(new)'}
                    </span>`;
                  }).join('')}
                  ${(eq.linked_people || []).map(name => {
                    const existing = context.people.find(p => p.name.toLowerCase() === name.toLowerCase());
                    return `<span class="eq-link-chip ${existing?'eq-link-existing':'eq-link-new'}">
                      ${existing ? '✓' : '+'} ${esc(name)} ${existing ? '' : '(new)'}
                    </span>`;
                  }).join('')}
                </div>
              ` : ''}
              ${eq.linked_parts?.length || eq.mentioned_parts_new?.length ? `
                <div class="eq-confirm-links">
                  <div class="eq-confirm-links-label">🔧 Parts:</div>
                  ${(eq.linked_parts || []).map(name => `<span class="eq-link-chip eq-link-existing">✓ ${esc(name)}</span>`).join('')}
                  ${(eq.mentioned_parts_new || []).map(p => `<span class="eq-link-chip eq-link-new">+ ${esc(p.name)} ${p.oem_part_number ? '('+esc(p.oem_part_number)+')' : ''}</span>`).join('')}
                </div>
              ` : ''}
              ${eq.notes ? `<div class="eq-confirm-notes">📝 ${esc(eq.notes)}</div>` : ''}
              ${eq.mentioned_issues?.length ? `
                <div class="eq-confirm-issues">
                  ⚠ Issues mentioned — ticket will be created:
                  ${eq.mentioned_issues.map(i => `<div class="eq-issue">${esc(i)}</div>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqConfirmModal').classList.remove('active')">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="eqConfirmCommit">✅ Create ${multi ? 'Selected' : ''}</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal._parsed = parsed;
  modal._context = context;

  document.getElementById('eqConfirmCommit').addEventListener('click', async () => {
    const btn = document.getElementById('eqConfirmCommit');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      modal.querySelectorAll('[data-eq-field]').forEach(el => {
        const idx = parseInt(el.dataset.idx);
        const field = el.dataset.field;
        const val = el.tagName === 'DIV' ? el.textContent.trim() : el.value;
        if (parsed.equipment[idx]) parsed.equipment[idx][field] = val;
      });

      const checked = [];
      modal.querySelectorAll('[data-eq-confirm]').forEach(c => {
        if (c.checked) checked.push(parsed.equipment[parseInt(c.dataset.eqConfirm)]);
      });

      if (!checked.length) {
        NX.toast && NX.toast('Nothing selected', 'info');
        btn.disabled = false;
        btn.textContent = '✅ Create';
        return;
      }

      const results = await commitEquipment(checked, context);
      modal.classList.remove('active');
      
      if (results.created > 0) {
        NX.toast && NX.toast(`✓ Created ${results.created} equipment ${results.created > 1 ? 'pieces' : 'piece'}${results.failed ? ` (${results.failed} failed)` : ''}`, results.failed ? 'warning' : 'success', 6000);
      }
      if (results.failed > 0 && results.created === 0) {
        NX.toast && NX.toast(`Failed to create equipment: ${results.errors[0] || 'unknown error'}`, 'error', 10000);
        console.error('[AI-Create] All failures:', results.errors);
      } else if (results.failed > 0) {
        console.warn('[AI-Create] Partial failure:', results.errors);
      }

      await loadEquipment();
      buildUI();
    } catch (err) {
      console.error('[AI-Create] Commit failed:', err);
      NX.toast && NX.toast('Create failed: ' + err.message, 'error', 8000);
      btn.disabled = false;
      btn.textContent = '✅ Create';
    }
  });
}

async function commitEquipment(equipList, context) {
  const results = { created: 0, failed: 0, errors: [] };
  
  for (const eq of equipList) {
    try {
      const allowed = ['name','location','area','category','subcategory','manufacturer','model',
                       'serial_number','status','install_date','warranty_until','purchase_price',
                       'specs','photo_url','notes','pm_interval_days','next_pm_date'];
      const clean = {};
      for (const f of allowed) {
        if (eq[f] != null && eq[f] !== '') clean[f] = eq[f];
      }
      
      // Sanitize date fields — Postgres rejects empty strings and bad formats
      const dateFields = ['install_date', 'warranty_until', 'next_pm_date'];
      for (const df of dateFields) {
        if (clean[df] != null) {
          const v = String(clean[df]).trim();
          if (!v || v === 'N/A' || v === 'n/a' || v === 'null' || v === 'undefined' || v === 'unknown') {
            delete clean[df];
          } else {
            // Validate it's parseable as a date
            const d = new Date(v);
            if (isNaN(d.getTime())) {
              console.warn(`[AI-Create] Dropping invalid ${df}:`, v);
              delete clean[df];
            } else {
              // Normalize to YYYY-MM-DD
              clean[df] = d.toISOString().slice(0, 10);
            }
          }
        }
      }
      
      // Sanitize numeric fields
      if (clean.purchase_price != null) {
        const n = parseFloat(String(clean.purchase_price).replace(/[^\d.]/g, ''));
        if (isNaN(n)) delete clean.purchase_price;
        else clean.purchase_price = n;
      }
      if (clean.pm_interval_days != null) {
        const n = parseInt(clean.pm_interval_days, 10);
        if (isNaN(n)) delete clean.pm_interval_days;
        else clean.pm_interval_days = n;
      }
      
      // Required: name + location + category + status. If missing, skip.
      if (!clean.name || !clean.location) {
        results.failed++;
        results.errors.push(`Missing name or location on: ${JSON.stringify(eq).slice(0, 80)}`);
        continue;
      }
      clean.status = clean.status || 'operational';
      clean.category = clean.category || 'equipment';

      let notes = eq.notes || '';
      if (eq.visible_details?.length) notes += (notes ? '\n' : '') + 'Observed: ' + eq.visible_details.join(', ');
      if (eq.confidence && eq.confidence !== 'high') notes += (notes ? '\n' : '') + `[AI confidence: ${eq.confidence}]`;
      if (notes) clean.notes = notes;

      const { data: created, error } = await NX.sb.from('equipment').insert(clean).select().single();
      if (error) {
        console.error('[AI-Create] Equipment insert failed:', { clean, error });
        results.failed++;
        results.errors.push(`${clean.name}: ${error.message}`);
        continue;
      }
      results.created++;

      // Graph linking — don't let failures here abort the main create
      try {
        const { data: eqNode } = await NX.sb.from('nodes').insert({
          name: clean.name,
          category: 'equipment',
          tags: [clean.location, clean.category, clean.manufacturer].filter(Boolean),
          notes: `${clean.manufacturer || ''} ${clean.model || ''}${clean.serial_number ? '\nSN: ' + clean.serial_number : ''}`.trim(),
          links: [], access_count: 1, source_emails: []
        }).select().single();

        if (eqNode) {
          await NX.sb.from('equipment').update({ node_id: eqNode.id }).eq('id', created.id);
          for (const name of (eq.linked_contractors || [])) await linkOrCreateNode(name, 'contractors', eqNode.id);
          for (const name of (eq.linked_people || []))      await linkOrCreateNode(name, 'people', eqNode.id);
          for (const name of (eq.linked_parts || [])) {
            const partNode = context.parts.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (partNode) await linkNodes(eqNode.id, partNode.id);
          }
        }
      } catch(e) { console.warn('[AI-Create] Graph link error (non-fatal):', e); }

      if (eq.mentioned_parts_new?.length) {
        try {
          const partsData = eq.mentioned_parts_new.map(p => ({
            equipment_id: created.id,
            part_name: p.name,
            oem_part_number: p.oem_part_number || null,
            supplier: 'Parts Town',
            supplier_url: `https://www.partstown.com/search?searchterm=${encodeURIComponent(p.oem_part_number || p.name)}`
          }));
          await NX.sb.from('equipment_parts').insert(partsData);
        } catch(e) { console.warn('[AI-Create] Parts insert error (non-fatal):', e); }
      }

      if (eq.mentioned_issues?.length) {
        try {
          for (const issue of eq.mentioned_issues) {
            const ticketData = {
              title: `[${clean.name}] ${issue}`,
              notes: `Issue mentioned during AI equipment creation:\n${issue}\n\nEquipment: ${clean.name}`,
              priority: 'normal',
              location: clean.location,
              status: 'open',
              reported_by: 'AI Create'
            };
            await NX.sb.from('tickets').insert(ticketData);
            // Stage S: push notification. AI-discovered issues are
            // surfacing problems nobody specifically reported, so
            // managers should know about them.
            if (NX.notifyTicketCreated) NX.notifyTicketCreated(ticketData);
          }
        } catch(e) { console.warn('[AI-Create] Tickets insert error (non-fatal):', e); }
      }

      // equipment_created_ai syslog → covered by Postgres trigger on equipment INSERT
    } catch (err) {
      console.error('[AI-Create] Unexpected error on item:', err, eq);
      results.failed++;
      results.errors.push(`${eq.name || 'Unknown'}: ${err.message}`);
    }
  }
  
  return results;
}

async function linkOrCreateNode(name, category, equipNodeId) {
  const { data: existing } = await NX.sb.from('nodes')
    .select('id').ilike('name', name).eq('category', category).limit(1);

  let nodeId;
  if (existing?.length) {
    nodeId = existing[0].id;
  } else {
    const { data: newNode } = await NX.sb.from('nodes').insert({
      name, category,
      tags: ['auto-created-by-ai'],
      notes: `Auto-created from equipment AI`,
      links: [], access_count: 1, source_emails: []
    }).select().single();
    if (newNode) nodeId = newNode.id;
  }

  if (nodeId && equipNodeId) await linkNodes(equipNodeId, nodeId);
}

async function linkNodes(a, b) {
  try {
    const [{ data: nodeA }, { data: nodeB }] = await Promise.all([
      NX.sb.from('nodes').select('links').eq('id', a).single(),
      NX.sb.from('nodes').select('links').eq('id', b).single()
    ]);
    const aLinks = Array.isArray(nodeA?.links) ? nodeA.links : [];
    const bLinks = Array.isArray(nodeB?.links) ? nodeB.links : [];
    if (!aLinks.includes(b)) aLinks.push(b);
    if (!bLinks.includes(a)) bLinks.push(a);
    await Promise.all([
      NX.sb.from('nodes').update({ links: aLinks }).eq('id', a),
      NX.sb.from('nodes').update({ links: bLinks }).eq('id', b)
    ]);
  } catch(e) { console.warn('Link nodes error:', e); }
}

async function loadExistingContext() {
  const [contractors, people, parts] = await Promise.all([
    NX.sb.from('nodes').select('id, name').eq('category', 'contractors').limit(100),
    NX.sb.from('nodes').select('id, name').eq('category', 'people').limit(100),
    NX.sb.from('nodes').select('id, name').eq('category', 'parts').limit(200)
  ]);
  return {
    contractors: contractors.data || [],
    people: people.data || [],
    parts: parts.data || []
  };
}

async function uploadCreatePhoto(file, eq) {
  try {
    const fname = `${Date.now()}-${(eq.name || 'equip').slice(0, 20).replace(/[^a-z0-9]/gi, '_')}.${(file.type.split('/')[1] || 'jpg')}`;
    const { data } = await NX.sb.storage.from('equipment-photos').upload(fname, file, { upsert: false, contentType: file.type });
    if (data) {
      const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
      return publicUrl;
    }
  } catch(e) { console.warn('Photo upload:', e); }
  return null;
}


/* ════════════════════════════════════════════════════════════════════════════
   7. PRINTING — QR paper stickers + Zebra ZPL
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── QR generation ─── */

function generateQRImage(qrCode, canvas) {
  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${qrCode}`;
  if (typeof QRious !== 'undefined') {
    try {
      new QRious({ element: canvas, value: scanURL, size: 220, foreground: '#000', background: '#fff', level: 'H' });
      return;
    } catch(e) {}
  }
  drawQRFallback(canvas, scanURL);
}

function drawQRFallback(canvas, text) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(text)}`;
}

function copyQRLink(qrCode) {
  const url = `${window.location.origin}${window.location.pathname}?equip=${qrCode}`;
  navigator.clipboard.writeText(url);
  NX.toast && NX.toast('Link copied ✓', 'success');
}

/* ─── Paper sticker printing ─── */

function printSingleQR(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  const url = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
  const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;

  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html><html><head><title>QR — ${esc(eq.name)}</title>
    <style>
      body{font-family:sans-serif;margin:0;padding:20mm;display:flex;justify-content:center;align-items:center;min-height:100vh}
      .sticker{border:2px solid #000;padding:10mm;text-align:center;width:80mm}
      h1{font-size:14pt;margin:0 0 4mm 0}
      .loc{font-size:11pt;color:#555;margin-bottom:4mm}
      .model{font-size:9pt;color:#666;margin-top:4mm}
      img{width:60mm;height:60mm}
      @media print{ body{padding:0} }
    </style></head><body>
    <div class="sticker">
      <h1>${esc(eq.name)}</h1>
      <div class="loc">${esc(eq.location)}</div>
      <img src="${qrImgSrc}" alt="QR">
      <div class="model">${esc(eq.manufacturer||'')} ${esc(eq.model||'')}</div>
      <div class="model">Scan to view details</div>
    </div>
    <script>setTimeout(()=>window.print(),500)</script>
    </body></html>
  `);
  w.document.close();
}

// ═══════════════════════════════════════════════════════════════════
//  STICKER EXPORT — full-color equipment labels for Traffic Jet print
//
//  User picks:
//    • Size (2x2 through 4x6, six built-in standards)
//    • Location filter (All / Suerte / Este / Bar Toti)
//    • Layout (auto-calculates stickers-per-page from size)
//
//  Output: opens a print preview window with a sheet of stickers
//  ready to send to a professional Traffic Jet inkjet printer.
//  Design: cream/honey background, charcoal type, gold rule accents,
//  NEXUS wordmark, prominent name, location subtitle, large QR,
//  monospace ID, scan instruction. Editorial × terminal aesthetic.
// ═══════════════════════════════════════════════════════════════════

const STICKER_SIZES = [
  { id: '2x2', label: '2" × 2" — Small',         w: 2,   h: 2,   perPage: 12, qrSize: 130 },
  { id: '2x3', label: '2" × 3" — Vertical',      w: 2,   h: 3,   perPage: 9,  qrSize: 140 },
  { id: '3x3', label: '3" × 3" — Standard ★',    w: 3,   h: 3,   perPage: 6,  qrSize: 200 },
  { id: '3x4', label: '3" × 4" — Vertical Tall', w: 3,   h: 4,   perPage: 4,  qrSize: 220 },
  { id: '4x4', label: '4" × 4" — Large',         w: 4,   h: 4,   perPage: 4,  qrSize: 280 },
  { id: '4x6', label: '4" × 6" — Extra Large',   w: 4,   h: 6,   perPage: 2,  qrSize: 320 },
];

function openStickerExport() {
  const filtered = getFiltered();
  if (!filtered.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }

  // Build location filter options from actual equipment data, plus "All"
  const locations = [...new Set(equipment.map(e => e.location).filter(Boolean))].sort();

  const modal = document.getElementById('eqStickerModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqStickerModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeStickerExport()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeStickerExport()">✕</button>
        <h2>Export Equipment Stickers</h2>
      </div>
      <div class="eq-detail-body">
        <div style="font-size:12px;color:#857f75;margin-bottom:14px;line-height:1.5">
          Generates a print-ready sheet of stickers with QR codes, designed for
          full-color professional printing on Traffic Jet inkjet printers.
        </div>

        <form class="eq-form" id="eqStickerForm">
          <div class="eq-form-group" style="margin-bottom:12px">
            <label style="font-size:11px;color:#a89e87;margin-bottom:4px;display:block">
              Sticker Size
            </label>
            <select id="eqStickerSize" style="width:100%;box-sizing:border-box">
              ${STICKER_SIZES.map(s => `
                <option value="${s.id}" ${s.id === '3x3' ? 'selected' : ''}>${s.label}</option>
              `).join('')}
            </select>
            <div style="font-size:10px;color:#857f75;margin-top:4px" id="eqStickerSizeNote">
              6 stickers per US Letter page · 200px QR
            </div>
          </div>

          <div class="eq-form-group" style="margin-bottom:12px">
            <label style="font-size:11px;color:#a89e87;margin-bottom:4px;display:block">
              Filter by Location
            </label>
            <select id="eqStickerLocation" style="width:100%;box-sizing:border-box">
              <option value="">All locations (${equipment.length} equipment)</option>
              ${locations.map(loc => {
                const count = equipment.filter(e => e.location === loc).length;
                return `<option value="${esc(loc)}">${esc(loc)} (${count} equipment)</option>`;
              }).join('')}
            </select>
          </div>

          <div class="eq-form-group" style="margin-bottom:12px">
            <label style="font-size:11px;color:#a89e87;margin-bottom:4px;display:block">
              Use current search/filter
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d4c8a5;cursor:pointer">
              <input type="checkbox" id="eqStickerUseFiltered" checked>
              <span>Only stickers for equipment matching current page filter (${filtered.length} equipment)</span>
            </label>
          </div>

          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeStickerExport()">Cancel</button>
            <button type="button" class="eq-btn eq-btn-primary" id="eqStickerExportBtn">Generate Stickers</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Live update the size note when picker changes
  const sizeSelect = document.getElementById('eqStickerSize');
  const sizeNote   = document.getElementById('eqStickerSizeNote');
  const updateNote = () => {
    const cfg = STICKER_SIZES.find(s => s.id === sizeSelect.value);
    if (cfg) sizeNote.textContent = `${cfg.perPage} stickers per US Letter page · ${cfg.qrSize}px QR`;
  };
  sizeSelect.addEventListener('change', updateNote);
  updateNote();

  document.getElementById('eqStickerExportBtn').addEventListener('click', () => {
    const sizeId   = sizeSelect.value;
    const location = document.getElementById('eqStickerLocation').value;
    const useFiltered = document.getElementById('eqStickerUseFiltered').checked;
    closeStickerExport();
    printStickers({ sizeId, location, useFiltered });
  });
}

function closeStickerExport() {
  const m = document.getElementById('eqStickerModal');
  if (m) m.classList.remove('active');
}

// Generate the print-ready sticker sheet HTML and open in a new window.
function printStickers({ sizeId, location, useFiltered }) {
  const cfg = STICKER_SIZES.find(s => s.id === sizeId) || STICKER_SIZES[2];

  // Decide which equipment to include
  let list = useFiltered ? getFiltered() : [...equipment];
  if (location) list = list.filter(e => e.location === location);
  // Skip equipment without a QR code (shouldn't happen, but defensive)
  list = list.filter(e => e.qr_code);

  if (!list.length) {
    NX.toast && NX.toast('No equipment matched those filters', 'info');
    return;
  }

  // Build each sticker's HTML
  const stickers = list.map(eq => {
    const url = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
    // Use qrserver.com — same provider already used for the QR tab.
    // Black on white square, optimal for scanning.
    const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${cfg.qrSize}x${cfg.qrSize}&data=${encodeURIComponent(url)}&margin=0&ecc=M`;
    return `
      <div class="sticker">
        <div class="sticker-inner">
          <div class="sticker-top">
            <span class="sticker-brand">NEXUS</span>
            <span class="sticker-rule"></span>
          </div>
          <div class="sticker-name">${esc(eq.name || 'Untitled')}</div>
          <div class="sticker-loc">${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
          <div class="sticker-qr-wrap">
            <img class="sticker-qr" src="${qrImgSrc}" alt="QR">
          </div>
          <div class="sticker-id">${esc(eq.qr_code || '')}</div>
          <div class="sticker-instr">Scan to view · log · report</div>
          <div class="sticker-bottom">
            <span class="sticker-rule"></span>
            <span class="sticker-mark">★</span>
            <span class="sticker-rule"></span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const w = window.open('', '_blank');
  if (!w) {
    NX.toast && NX.toast('Pop-up blocked — allow pop-ups to print stickers', 'error');
    return;
  }

  // CSS sized to physical inches. Print rendering will honor @page + inch units.
  // The browser's Print dialog will let you choose paper size; default is US Letter.
  // Each sticker is sized exactly to cfg.w × cfg.h inches.
  // perPage controls the grid columns based on what fits in 8.5" × 11" with margins.
  const cols = (() => {
    if (cfg.w <= 2)        return 4;     // 2x2 → 4 cols (8" wide)
    if (cfg.w === 3)       return 2;     // 3x3 / 3x4 → 2 cols (6" wide)
    return 2;                            // 4x4 / 4x6 → 2 cols (8" wide)
  })();

  const labelCount  = list.length;
  const filterLabel = location ? location : 'All locations';

  w.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>NEXUS Equipment Stickers — ${esc(filterLabel)} (${labelCount})</title>
<style>
  @page { size: letter; margin: 0.4in; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: 'Outfit', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #f4ecd8;
    color: #1c1814;
  }
  /* Print-only header on first page (hidden when printing) */
  .header {
    padding: 12px 16px;
    background: #1c1814;
    color: #d4c8a5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }
  .header strong { color: #d4a44e; letter-spacing: 1px; }
  .header button {
    background: #d4a44e;
    color: #1c1814;
    border: none;
    padding: 8px 16px;
    font-weight: 600;
    cursor: pointer;
    border-radius: 4px;
    font-family: inherit;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(${cols}, ${cfg.w}in);
    gap: 0.15in;
    padding: 0.15in;
    justify-content: center;
  }

  .sticker {
    width: ${cfg.w}in;
    height: ${cfg.h}in;
    background: #f4ecd8;
    border: 1px dashed #c8a44e;
    page-break-inside: avoid;
    break-inside: avoid;
    overflow: hidden;
    position: relative;
  }
  .sticker-inner {
    width: 100%;
    height: 100%;
    padding: ${Math.max(0.08, cfg.w * 0.04)}in;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    text-align: center;
  }

  /* Top branding row */
  .sticker-top, .sticker-bottom {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sticker-top {
    margin-bottom: ${cfg.w * 0.02}in;
  }
  .sticker-bottom {
    margin-top: ${cfg.w * 0.02}in;
    justify-content: center;
  }
  .sticker-brand {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: ${Math.max(7, cfg.w * 3)}pt;
    font-weight: 700;
    color: #1c1814;
    letter-spacing: 2px;
    flex-shrink: 0;
  }
  .sticker-rule {
    flex: 1;
    height: 1px;
    background: #c8a44e;
  }
  .sticker-mark {
    color: #c8a44e;
    font-size: ${Math.max(8, cfg.w * 3)}pt;
    flex-shrink: 0;
  }

  /* Name — most prominent text */
  .sticker-name {
    font-size: ${Math.max(9, cfg.w * 4.2)}pt;
    font-weight: 700;
    color: #1c1814;
    line-height: 1.15;
    margin: ${cfg.w * 0.015}in 0 ${cfg.w * 0.005}in 0;
    word-break: break-word;
    /* Cap at 3 lines so very long names don't blow out the layout */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .sticker-loc {
    font-size: ${Math.max(7, cfg.w * 2.8)}pt;
    color: #5a5247;
    font-weight: 500;
    margin-bottom: ${cfg.w * 0.04}in;
    letter-spacing: 0.3px;
  }

  /* QR — central element, white background for scan reliability */
  .sticker-qr-wrap {
    background: #ffffff;
    padding: ${cfg.w * 0.025}in;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .sticker-qr {
    width: ${cfg.qrSize}px;
    height: ${cfg.qrSize}px;
    max-width: ${cfg.w * 0.65}in;
    max-height: ${cfg.w * 0.65}in;
    display: block;
  }

  /* ID — monospace, technical */
  .sticker-id {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: ${Math.max(6, cfg.w * 2.2)}pt;
    color: #5a5247;
    margin-top: ${cfg.w * 0.03}in;
    letter-spacing: 0.5px;
  }

  /* Instruction */
  .sticker-instr {
    font-size: ${Math.max(5.5, cfg.w * 2)}pt;
    color: #857f75;
    font-style: italic;
    margin-top: ${cfg.w * 0.01}in;
  }

  /* Print-specific overrides */
  @media print {
    .header { display: none !important; }
    body { background: #f4ecd8; }
    .grid { padding: 0; gap: 0.1in; }
    .sticker { border: 1px dashed #c8a44e; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <strong>NEXUS</strong> — Equipment Stickers ·
      ${labelCount} stickers · ${cfg.w}″ × ${cfg.h}″ · ${esc(filterLabel)}
    </div>
    <button onclick="window.print()">🖨 Print</button>
  </div>
  <div class="grid">${stickers}</div>
  <script>
    // Auto-trigger print dialog after QR images load (avoids printing
    // before QR codes have fetched from qrserver.com).
    window.addEventListener('load', () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      if (imgs.length === 0) return;
      let loaded = 0;
      const done = () => {
        if (++loaded >= imgs.length) {
          setTimeout(() => window.print(), 600);
        }
      };
      imgs.forEach(img => {
        if (img.complete) done();
        else { img.addEventListener('load', done); img.addEventListener('error', done); }
      });
    });
  </script>
</body></html>`);
  w.document.close();
}



/* ─── Zebra ZPL generation ─── */

function generateZPL(eq, size = '2x2') {
  const cfg = ZEBRA_CONFIG.labelSizes[size];
  if (!cfg) throw new Error('Invalid label size: ' + size);

  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
  const name = (eq.name || '').replace(/[\^~]/g, '').slice(0, 30);
  const location = (eq.location || '').replace(/[\^~]/g, '');
  const model = `${eq.manufacturer || ''} ${eq.model || ''}`.trim().replace(/[\^~]/g, '').slice(0, 28);

  let zpl = '';
  if (size === '2x2') {
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO20,30^BQN,2,5^FDQA,${scanURL}^FS
^FO200,40^A0N,28,28^FD${name}^FS
^FO200,80^A0N,22,22^FD${location}^FS
^FO200,130^A0N,18,18^FD${model}^FS
^FO200,170^A0N,14,14^FDScan for details^FS
^FO200,200^A0N,14,14^FD${eq.qr_code}^FS
^PQ1,0,1,Y
^XZ`;
  } else if (size === '2x1') {
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO15,20^BQN,2,3^FDQA,${scanURL}^FS
^FO120,25^A0N,22,22^FD${name}^FS
^FO120,55^A0N,16,16^FD${location}^FS
^FO120,80^A0N,14,14^FD${model}^FS
^FO120,105^A0N,12,12^FD${eq.qr_code}^FS
^PQ1,0,1,Y
^XZ`;
  } else if (size === '3x2' || size === '4x2') {
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO20,40^BQN,2,6^FDQA,${scanURL}^FS
^FO230,40^A0N,32,32^FD${name}^FS
^FO230,85^A0N,24,24^FD${location}^FS
^FO230,130^A0N,20,20^FD${model}^FS
^FO230,170^A0N,16,16^FDSN: ${(eq.serial_number || '—').slice(0, 20)}^FS
^FO230,210^A0N,16,16^FDNEXUS: ${eq.qr_code}^FS
^FO230,250^A0N,14,14^FDScan for full details^FS
^PQ1,0,1,Y
^XZ`;
  }
  return zpl.replace(/\n\s*/g, '\n').trim();
}

function generateZPLBatch(equipmentList, size = '2x2') {
  return equipmentList.map(eq => generateZPL(eq, size)).join('\n');
}

async function loadZebraBrowserPrint() {
  if (zebraBrowserPrintLoaded) return true;
  try {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/gh/gtomasevic/browser-print-js@master/BrowserPrint-3.0.216.min.js';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
    zebraBrowserPrintLoaded = true;
    return true;
  } catch (e) { return false; }
}

async function printZebraBrowserPrint(zpl) {
  try {
    const devRes = await fetch(ZEBRA_BP_URL + '/default?type=printer');
    if (!devRes.ok) throw new Error('Browser Print not running');
    const device = await devRes.json();

    const printRes = await fetch(ZEBRA_BP_URL + '/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, data: zpl })
    });
    if (!printRes.ok) throw new Error('Print failed: ' + printRes.status);
    return { success: true, device: device.name };
  } catch (err) {
    console.error('[Zebra] Browser Print error:', err);
    return { success: false, error: err.message };
  }
}

function openZebraPrintDialog(equipmentList, preselectedSize) {
  const modal = document.getElementById('zebraPrintModal') || (() => {
    const m = document.createElement('div');
    m.id = 'zebraPrintModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const count = equipmentList.length;
  const defaultSize = preselectedSize || '2x2';

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('zebraPrintModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('zebraPrintModal').classList.remove('active')">✕</button>
        <h2>🏷️ Print Zebra Labels (${count})</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-zebra-tabs">
          <button class="eq-zebra-tab active" data-method="direct">Direct to Printer</button>
          <button class="eq-zebra-tab" data-method="download">Download ZPL</button>
          <button class="eq-zebra-tab" data-method="preview">Preview</button>
        </div>

        <div class="eq-zebra-panel active" data-panel="direct">
          <div class="eq-zebra-note">
            Requires <a href="https://www.zebra.com/us/en/software/printer-software/browser-print.html" target="_blank">Zebra Browser Print</a>
            installed on this computer with your ZD421 connected via USB or network.
          </div>
          <div id="zebraPrinterStatus" class="eq-zebra-status">Checking printer…</div>
          <div class="eq-form-group">
            <label>Label Size</label>
            <select id="zebraLabelSize">
              <option value="2x2" ${defaultSize==='2x2'?'selected':''}>2" × 2" (recommended for equipment)</option>
              <option value="2x1" ${defaultSize==='2x1'?'selected':''}>2" × 1" (compact)</option>
              <option value="3x2" ${defaultSize==='3x2'?'selected':''}>3" × 2" (large with details)</option>
              <option value="4x2" ${defaultSize==='4x2'?'selected':''}>4" × 2" (extra large)</option>
            </select>
          </div>
          <div class="eq-form-actions">
            <button class="eq-btn eq-btn-primary" id="zebraPrintBtn">🖨️ Print ${count} Label${count > 1 ? 's' : ''}</button>
          </div>
        </div>

        <div class="eq-zebra-panel" data-panel="download">
          <div class="eq-zebra-note">
            Download the ZPL file and send to any Zebra printer via Zebra Setup Utilities,
            USB transfer, or email to a network-connected printer.
          </div>
          <div class="eq-form-group">
            <label>Label Size</label>
            <select id="zebraDownloadSize">
              <option value="2x2">2" × 2"</option>
              <option value="2x1">2" × 1"</option>
              <option value="3x2">3" × 2"</option>
              <option value="4x2">4" × 2"</option>
            </select>
          </div>
          <div class="eq-form-actions">
            <button class="eq-btn eq-btn-primary" id="zebraDownloadBtn">💾 Download ZPL File</button>
            <button class="eq-btn eq-btn-secondary" id="zebraCopyBtn">📋 Copy ZPL</button>
          </div>
        </div>

        <div class="eq-zebra-panel" data-panel="preview">
          <div class="eq-zebra-note">Preview rendered via Labelary.com — shows roughly what the Zebra will print.</div>
          <div class="eq-form-group">
            <label>Size</label>
            <select id="zebraPreviewSize">
              <option value="2x2">2" × 2"</option>
              <option value="2x1">2" × 1"</option>
              <option value="3x2">3" × 2"</option>
              <option value="4x2">4" × 2"</option>
            </select>
          </div>
          <div id="zebraPreview" class="eq-zebra-preview"></div>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal.querySelectorAll('.eq-zebra-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.eq-zebra-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-zebra-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`[data-panel="${tab.dataset.method}"]`).classList.add('active');
      if (tab.dataset.method === 'preview') {
        renderZebraPreview(equipmentList[0], document.getElementById('zebraPreviewSize').value);
      }
    });
  });

  checkZebraPrinter();

  document.getElementById('zebraPrintBtn').addEventListener('click', async () => {
    const size = document.getElementById('zebraLabelSize').value;
    const btn = document.getElementById('zebraPrintBtn');
    btn.disabled = true;
    btn.textContent = 'Printing…';

    const zpl = generateZPLBatch(equipmentList, size);
    const result = await printZebraBrowserPrint(zpl);

    if (result.success) {
      NX.toast && NX.toast(`Printed ${count} label${count>1?'s':''} to ${result.device} ✓`, 'success', 5000);
      if (NX.syslog) NX.syslog('zebra_print', `${count} labels (${size})`);
      modal.classList.remove('active');
    } else {
      NX.toast && NX.toast('Print failed: ' + result.error, 'error', 8000);
      btn.disabled = false;
      btn.textContent = `🖨️ Print ${count} Label${count > 1 ? 's' : ''}`;
    }
  });

  document.getElementById('zebraDownloadBtn').addEventListener('click', () => {
    const size = document.getElementById('zebraDownloadSize').value;
    const zpl = generateZPLBatch(equipmentList, size);
    const blob = new Blob([zpl], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-labels-${size}-${new Date().toISOString().slice(0,10)}.zpl`;
    a.click();
    URL.revokeObjectURL(url);
    NX.toast && NX.toast('ZPL file downloaded ✓', 'success');
  });

  document.getElementById('zebraCopyBtn').addEventListener('click', () => {
    const size = document.getElementById('zebraDownloadSize').value;
    const zpl = generateZPLBatch(equipmentList, size);
    navigator.clipboard.writeText(zpl);
    NX.toast && NX.toast('ZPL copied to clipboard ✓', 'success');
  });

  document.getElementById('zebraPreviewSize').addEventListener('change', e => {
    renderZebraPreview(equipmentList[0], e.target.value);
  });
}

async function checkZebraPrinter() {
  const el = document.getElementById('zebraPrinterStatus');
  if (!el) return;
  try {
    const res = await fetch(ZEBRA_BP_URL + '/available', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      if (data.printer && data.printer.length) {
        el.innerHTML = `<span class="eq-zebra-ok">✓ ${data.printer.length} printer${data.printer.length>1?'s':''} connected: ${data.printer.map(p=>p.name).join(', ')}</span>`;
      } else {
        el.innerHTML = '<span class="eq-zebra-warn">⚠ Browser Print running but no printer connected. Plug in your Zebra via USB.</span>';
      }
    } else throw new Error('Not running');
  } catch (e) {
    el.innerHTML = '<span class="eq-zebra-err">❌ Zebra Browser Print not running. <a href="https://www.zebra.com/us/en/software/printer-software/browser-print.html" target="_blank">Install it</a> then refresh.</span>';
  }
}

function renderZebraPreview(eq, size) {
  const el = document.getElementById('zebraPreview');
  if (!el || !eq) return;
  const zpl = generateZPL(eq, size);
  const cfg = ZEBRA_CONFIG.labelSizes[size];
  const apiURL = `https://api.labelary.com/v1/printers/8dpmm/labels/${cfg.width}x${cfg.height}/0/`;

  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Rendering…</div>';

  fetch(apiURL, { method: 'POST', headers: { 'Accept': 'image/png' }, body: zpl })
    .then(r => { if (!r.ok) throw new Error('Preview API error'); return r.blob(); })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      el.innerHTML = `
        <div class="eq-zebra-preview-img-wrap">
          <img src="${url}" class="eq-zebra-preview-img" alt="Label preview">
          <div class="eq-zebra-preview-cap">${size}" label · ${eq.name}</div>
        </div>`;
    })
    .catch(() => {
      el.innerHTML = '<div class="eq-zebra-err">Preview unavailable. The ZPL is still valid and will print correctly.</div>';
    });
}

function printZebraBatch() {
  const filtered = getFiltered();
  if (!filtered.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }
  openZebraPrintDialog(filtered);
}

function printZebraSingle(equipId) {
  const eq = equipment.find(e => e.id === equipId);
  if (!eq) return;
  openZebraPrintDialog([eq]);
}

/* Prefer Zebra if Browser Print available, else fall back to paper sticker */
function quickPrint(equipId) {
  printZebraSingle(equipId);
}


/* ════════════════════════════════════════════════════════════════════════════
   8. PUBLIC SCAN — no-auth QR view
   ════════════════════════════════════════════════════════════════════════════ */

function renderPublicScanView(qrCode) {
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
  loadPublicScan(qrCode);
}

async function loadPublicScan(qrCode) {
  try {
    const { data, error } = await NX.sb.from('equipment')
      .select('id, name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code')
      .eq('qr_code', qrCode)
      .single();
    if (error || !data) throw new Error('Equipment not found');

    const { data: maint } = await NX.sb.from('equipment_maintenance')
      .select('event_type, event_date, description, performed_by')
      .eq('equipment_id', data.id)
      .order('event_date', { ascending: false })
      .limit(5);

    renderPublicScanHTML(data, maint || []);
  } catch (err) {
    document.getElementById('publicScanBody').innerHTML = `
      <div class="public-scan-error">
        <h2>Equipment Not Found</h2>
        <p>This QR code isn't registered or has been removed.</p>
        <button onclick="window.location.href='${window.location.origin}${window.location.pathname}'">Go to NEXUS</button>
      </div>`;
  }
}

function renderPublicScanHTML(eq, maint) {
  const status = {
    operational:    { label: 'Operational',    color: '#4caf50' },
    needs_service:  { label: 'Needs Service',  color: '#ff9800' },
    down:           { label: 'Down',           color: '#f44336' },
    retired:        { label: 'Retired',        color: '#888' }
  }[eq.status] || { label: eq.status, color: '#888' };

  const pm = eq.next_pm_date ? new Date(eq.next_pm_date) : null;
  const pmStr = pm ? pm.toLocaleDateString() : 'Not scheduled';
  const pmOverdue = pm && pm < new Date();

  document.getElementById('publicScanBody').innerHTML = `
    <div class="public-scan-card">
      ${eq.photo_url ? `<img src="${eq.photo_url}" class="public-scan-photo">` : ''}
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
        <div><label>Next PM</label><div ${pmOverdue?'style="color:#f44336"':''}>${pmStr}${pmOverdue?' (overdue)':''}</div></div>
      </div>
      ${maint.length ? `
        <div class="public-scan-section">
          <h3>Recent Service History</h3>
          ${maint.map(m => `
            <div class="public-scan-history">
              <div class="public-scan-hist-date">${new Date(m.event_date).toLocaleDateString()}</div>
              <div>
                <div class="public-scan-hist-type">${(m.event_type || 'service').toUpperCase()}</div>
                <div class="public-scan-hist-desc">${esc(m.description || '')}</div>
                ${m.performed_by ? `<div class="public-scan-hist-who">${esc(m.performed_by)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>` : ''}
      <div class="public-scan-actions">
        <button class="public-scan-btn public-scan-btn-primary" onclick="NX.modules.equipment.publicReportIssue('${eq.qr_code}')">🔴 Report Issue</button>
        <button class="public-scan-btn" onclick="window.location.href='${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}&login=1'">Sign In for Full Details</button>
      </div>
      <div class="public-scan-footer">Powered by NEXUS · Restaurant Operations Intelligence</div>
    </div>
  `;
}

function publicReportIssue(qrCode) {
  const modal = document.createElement('div');
  modal.className = 'public-report-modal';
  modal.innerHTML = `
    <div class="public-report-bg" onclick="this.parentElement.remove()"></div>
    <div class="public-report">
      <button class="public-report-close" onclick="this.parentElement.parentElement.remove()">✕</button>
      <h2>Report Issue</h2>
      <form id="publicReportForm">
        <div class="public-report-field">
          <label>Your Name</label>
          <input name="reporter" required placeholder="Your name">
        </div>
        <div class="public-report-field">
          <label>What's wrong?</label>
          <textarea name="description" rows="4" required placeholder="Describe the problem..."></textarea>
        </div>
        <div class="public-report-field">
          <label>Priority</label>
          <select name="priority">
            <option value="low">Low - Not urgent</option>
            <option value="normal" selected>Normal</option>
            <option value="urgent">Urgent - Not working</option>
          </select>
        </div>
        <div class="public-report-actions">
          <button type="button" class="public-scan-btn" onclick="this.parentElement.parentElement.parentElement.parentElement.remove()">Cancel</button>
          <button type="submit" class="public-scan-btn public-scan-btn-primary">Submit Report</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#publicReportForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { data: eq } = await NX.sb.from('equipment').select('id, name, location').eq('qr_code', qrCode).single();
    if (!eq) return;

    try {
      const ticketData = {
        title: `[Equipment] ${eq.name}: ${fd.get('description').slice(0, 60)}`,
        notes: `Reported via QR scan by ${fd.get('reporter')}\n\nEquipment: ${eq.name}\nLocation: ${eq.location}\n\nIssue: ${fd.get('description')}`,
        priority: fd.get('priority'),
        location: eq.location,
        status: 'open',
        reported_by: fd.get('reporter') + ' (QR scan)'
      };
      await NX.sb.from('tickets').insert(ticketData);
      // Stage S: push notification to managers — QR reports are
      // often from staff in the field and managers need them fast
      if (NX.notifyTicketCreated) NX.notifyTicketCreated(ticketData);
      await NX.sb.from('daily_logs').insert({
        entry: `🚨 QR scan report - ${eq.name} at ${eq.location}: ${fd.get('description').slice(0, 120)}`,
        user_name: fd.get('reporter')
      });
      modal.innerHTML = `
        <div class="public-report-bg" onclick="this.parentElement.remove()"></div>
        <div class="public-report public-report-success">
          <div style="font-size:48px;margin-bottom:12px">✓</div>
          <h2>Report Sent</h2>
          <p>Thanks! The team has been notified and will address this shortly.</p>
          <button class="public-scan-btn public-scan-btn-primary" onclick="this.parentElement.parentElement.remove()">Done</button>
        </div>
      `;
    } catch (err) {
      console.error('[Public] Report failed:', err);
      alert('Failed to submit report: ' + err.message);
    }
  });
}


/* ════════════════════════════════════════════════════════════════════════════
   9. ATTACHMENTS & FULL EDITOR — 6-tab editor, custom fields, photo mgmt
   ════════════════════════════════════════════════════════════════════════════ */

async function openFullEditor(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq) return;

  const [attachRes, customRes] = await Promise.all([
    NX.sb.from('equipment_attachments').select('*').eq('equipment_id', equipId).order('created_at', { ascending: false }),
    NX.sb.from('equipment_custom_fields').select('*').eq('equipment_id', equipId).order('created_at')
  ]);
  const attachments = attachRes.data || [];
  const customFields = customRes.data || [];

  const modal = document.getElementById('eqFullEditModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqFullEditModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const specs = eq.specs || {};
  const tags = eq.tags || [];

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeFullEdit()"></div>
    <div class="eq-detail eq-edit-full">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeFullEdit()">✕</button>
        <h2>✎ Edit Everything — ${esc(eq.name)}</h2>
      </div>

      <div class="eq-detail-tabs">
        <button class="eq-tab active" data-tab="basic">Basic</button>
        <button class="eq-tab" data-tab="specs">Specs</button>
        <button class="eq-tab" data-tab="photo">Photos</button>
        <button class="eq-tab" data-tab="attach">Attachments (${attachments.length})</button>
        <button class="eq-tab" data-tab="links">Links</button>
        <button class="eq-tab" data-tab="custom">Custom Fields (${customFields.length})</button>
      </div>

      <div class="eq-detail-body">

        <div class="eq-tab-panel active" data-panel="basic">
          <div class="eq-form">
            <div class="eq-form-group">
              <label>Name</label>
              <input data-field="name" value="${escAttr(eq.name)}">
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Location</label>
                <select data-field="location">
                  ${LOCATIONS.map(l => `<option ${eq.location===l?'selected':''}>${l}</option>`).join('')}
                </select>
              </div>
              <div class="eq-form-group">
                <label>Area</label>
                <input data-field="area" value="${escAttr(eq.area||'')}">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Category</label>
                <select data-field="category">
                  ${CATEGORIES.map(c => `<option value="${c.key}" ${eq.category===c.key?'selected':''}>${c.key}</option>`).join('')}
                </select>
              </div>
              <div class="eq-form-group">
                <label>Subcategory</label>
                <input data-field="subcategory" value="${escAttr(eq.subcategory||'')}" placeholder="walk_in, fryer, range, etc">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Status</label>
                <select data-field="status">
                  ${STATUSES.map(s => `<option value="${s.key}" ${eq.status===s.key?'selected':''}>${s.label}</option>`).join('')}
                </select>
              </div>
              <div class="eq-form-group">
                <label>Health Score (0-100)</label>
                <input type="number" min="0" max="100" data-field="health_score" value="${eq.health_score ?? 100}">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Manufacturer</label>
                <input data-field="manufacturer" value="${escAttr(eq.manufacturer||'')}">
              </div>
              <div class="eq-form-group">
                <label>Model</label>
                <input data-field="model" value="${escAttr(eq.model||'')}">
              </div>
            </div>
            <div class="eq-form-group">
              <label>Serial Number</label>
              <input data-field="serial_number" value="${escAttr(eq.serial_number||'')}">
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Install Date</label>
                <input type="date" data-field="install_date" value="${eq.install_date||''}">
              </div>
              <div class="eq-form-group">
                <label>Warranty Until</label>
                <input type="date" data-field="warranty_until" value="${eq.warranty_until||''}">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Purchase Price ($)</label>
                <input type="number" step="0.01" data-field="purchase_price" value="${eq.purchase_price||''}">
              </div>
              <div class="eq-form-group">
                <label>PM Interval (days)</label>
                <input type="number" data-field="pm_interval_days" value="${eq.pm_interval_days||''}">
              </div>
            </div>
            <div class="eq-form-group">
              <label>Next PM Date</label>
              <input type="date" data-field="next_pm_date" value="${eq.next_pm_date||''}">
            </div>
            <div class="eq-form-group">
              <label>Tags (comma-separated)</label>
              <input data-field="_tags" value="${escAttr((tags||[]).join(', '))}" placeholder="critical, backup, rental, etc">
            </div>
            <div class="eq-form-group">
              <label>Notes</label>
              <textarea data-field="notes" rows="4">${esc(eq.notes||'')}</textarea>
            </div>
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="specs">
          <div class="eq-specs-help">
            Structured specs. Common: voltage, amperage, hz, phase, refrigerant_type, refrigerant_amount, btu, capacity, wattage, gas_type.
          </div>
          <div class="eq-specs-list" id="eqSpecsList">
            ${Object.entries(specs).map(([k, v]) => `
              <div class="eq-spec-row" data-spec="${escAttr(k)}">
                <input class="eq-spec-key" value="${escAttr(k)}">
                <input class="eq-spec-val" value="${escAttr(String(v||''))}">
                <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="this.parentElement.remove()">✕</button>
              </div>
            `).join('')}
          </div>
          <button class="eq-btn eq-btn-secondary" id="eqAddSpec">+ Add Spec</button>
        </div>

        <div class="eq-tab-panel" data-panel="photo">
          <div class="eq-photo-section">
            <h4>Main Photo</h4>
            ${eq.photo_url ? `
              <div class="eq-photo-wrap">
                <img src="${eq.photo_url}" class="eq-photo-main">
                <div class="eq-photo-actions">
                  <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.replacePhoto('${equipId}', 'photo_url')">Replace</button>
                  <button class="eq-btn eq-btn-danger" onclick="NX.modules.equipment.removePhoto('${equipId}', 'photo_url')">Remove</button>
                </div>
              </div>
            ` : `
              <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadPhoto('${equipId}', 'photo_url')">📸 Upload Photo</button>
            `}
          </div>
          <div class="eq-photo-section">
            <h4>Data Plate Photo</h4>
            ${eq.data_plate_url ? `
              <div class="eq-photo-wrap">
                <img src="${eq.data_plate_url}" class="eq-photo-main">
                <div class="eq-photo-actions">
                  <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.replacePhoto('${equipId}', 'data_plate_url')">Replace</button>
                  <button class="eq-btn eq-btn-danger" onclick="NX.modules.equipment.removePhoto('${equipId}', 'data_plate_url')">Remove</button>
                </div>
              </div>
            ` : `
              <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadPhoto('${equipId}', 'data_plate_url')">📸 Upload Data Plate</button>
            `}
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="attach">
          <div class="eq-attach-actions">
            <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'file')">📄 Upload File</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'photo')">📸 Add Photo</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'link')">🔗 Add Link</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'note')">📝 Add Note</button>
          </div>
          <div class="eq-attach-list" id="eqAttachList">
            ${attachments.length ? attachments.map(a => renderAttachment(a)).join('') : '<div class="eq-empty-small">No attachments yet. Upload receipts, invoices, warranty cards, installation docs, videos, or anything else.</div>'}
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="links">
          <div class="eq-specs-help">
            External links — manufacturer website, manual URL, training video, etc. Clickable from the equipment detail.
          </div>
          
          <div class="eq-form-group eq-service-contact" style="margin-bottom:18px;padding:14px;background:var(--elevated,#15151c);border:1px solid var(--border,#2a2a33);border-radius:10px">
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              📞 Service Contact
              <span style="font-weight:400;font-size:11px;color:var(--muted,#8a826f)">— Powers the "Call" button on QR scan</span>
            </label>
            <div class="eq-form-row">
              <div class="eq-form-group" style="flex:1">
                <label style="font-size:11px">Contact Name (optional)</label>
                <input data-field="service_contact_name" value="${escAttr(eq.service_contact_name||'')}" placeholder="Austin Air and Ice">
              </div>
              <div class="eq-form-group" style="flex:1">
                <label style="font-size:11px">Phone Number</label>
                <input type="tel" data-field="service_phone" value="${escAttr(eq.service_phone||'')}" placeholder="(512) 555-1234">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="eq-btn eq-btn-tiny eq-btn-secondary" onclick="NX.modules.equipment.lookupServicePhoneFromNode('${eq.id}')" style="flex:1">
                🔍 Look up from preferred contractor
              </button>
              ${eq.service_phone ? `<a href="tel:${escAttr(eq.service_phone)}" class="eq-btn eq-btn-tiny" style="flex:0 0 auto">Test Call</a>` : ''}
            </div>
            <div style="font-size:11px;color:var(--muted,#8a826f);margin-top:8px;line-height:1.4">
              Leave blank to auto-fall-back to the preferred contractor's phone.
            </div>
          </div>

          <div class="eq-form-group">
            <label>Manual Source URL</label>
            <div class="eq-url-field">
              <input type="url" data-field="manual_source_url" value="${escAttr(eq.manual_source_url||'')}" placeholder="https://www.hoshizakiamerica.com/...">
              ${eq.manual_source_url ? `<a href="${eq.manual_source_url}" target="_blank" class="eq-btn eq-btn-tiny">Open ↗</a>` : ''}
            </div>
          </div>
          <div class="eq-form-group">
            <label>Manual PDF URL (uploaded)</label>
            <div class="eq-url-field">
              <input type="url" data-field="manual_url" value="${escAttr(eq.manual_url||'')}">
              ${eq.manual_url ? `<a href="${eq.manual_url}" target="_blank" class="eq-btn eq-btn-tiny">Open ↗</a>` : ''}
            </div>
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="custom">
          <div class="eq-specs-help">
            Add any custom fields you need. Perfect for: rental contract #, asset tag #, last inspection ID, accounting code, anything specific to your operation.
          </div>
          <div class="eq-custom-list" id="eqCustomList">
            ${customFields.map(f => `
              <div class="eq-custom-row" data-custom-id="${f.id}">
                <input class="eq-custom-name" value="${escAttr(f.field_name)}" placeholder="Field name">
                <select class="eq-custom-type">
                  <option value="text" ${f.field_type==='text'?'selected':''}>Text</option>
                  <option value="number" ${f.field_type==='number'?'selected':''}>Number</option>
                  <option value="date" ${f.field_type==='date'?'selected':''}>Date</option>
                  <option value="url" ${f.field_type==='url'?'selected':''}>URL</option>
                  <option value="boolean" ${f.field_type==='boolean'?'selected':''}>Yes/No</option>
                </select>
                <input class="eq-custom-val" value="${escAttr(f.field_value||'')}" placeholder="Value">
                <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="NX.modules.equipment.deleteCustomField('${f.id}', '${equipId}')">✕</button>
              </div>
            `).join('')}
          </div>
          <button class="eq-btn eq-btn-secondary" id="eqAddCustom">+ Add Custom Field</button>
        </div>

      </div>

      <div class="eq-detail-actions">
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeFullEdit()">Cancel</button>
        <button class="eq-btn eq-btn-primary" id="eqFullSave">💾 Save All Changes</button>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Tab switching
  modal.querySelectorAll('.eq-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // Add spec / custom rows
  document.getElementById('eqAddSpec').addEventListener('click', () => {
    const list = document.getElementById('eqSpecsList');
    const row = document.createElement('div');
    row.className = 'eq-spec-row';
    row.innerHTML = `
      <input class="eq-spec-key" placeholder="key (e.g. voltage)">
      <input class="eq-spec-val" placeholder="value (e.g. 115V)">
      <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="this.parentElement.remove()">✕</button>
    `;
    list.appendChild(row);
    row.querySelector('.eq-spec-key').focus();
  });

  document.getElementById('eqAddCustom').addEventListener('click', () => {
    const list = document.getElementById('eqCustomList');
    const row = document.createElement('div');
    row.className = 'eq-custom-row';
    row.innerHTML = `
      <input class="eq-custom-name" placeholder="Field name">
      <select class="eq-custom-type">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="date">Date</option>
        <option value="url">URL</option>
        <option value="boolean">Yes/No</option>
      </select>
      <input class="eq-custom-val" placeholder="Value">
      <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="this.parentElement.remove()">✕</button>
    `;
    list.appendChild(row);
    row.querySelector('.eq-custom-name').focus();
  });

  document.getElementById('eqFullSave').addEventListener('click', async () => {
    const btn = document.getElementById('eqFullSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const updates = {};
      modal.querySelectorAll('[data-field]').forEach(el => {
        const field = el.dataset.field;
        let val = el.value;
        if (val === '') val = null;
        if (field === '_tags') {
          updates.tags = val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
          return;
        }
        if (['purchase_price', 'pm_interval_days', 'health_score'].includes(field) && val != null) {
          val = parseFloat(val);
          if (isNaN(val)) val = null;
        }
        updates[field] = val;
      });

      const newSpecs = {};
      modal.querySelectorAll('#eqSpecsList .eq-spec-row').forEach(row => {
        const k = row.querySelector('.eq-spec-key').value.trim();
        const v = row.querySelector('.eq-spec-val').value.trim();
        if (k) newSpecs[k] = v;
      });
      updates.specs = newSpecs;

      const { error } = await NX.sb.from('equipment').update(updates).eq('id', equipId);
      if (error) throw error;

      const customOps = [];
      modal.querySelectorAll('#eqCustomList .eq-custom-row').forEach(row => {
        const name = row.querySelector('.eq-custom-name').value.trim();
        const val  = row.querySelector('.eq-custom-val').value.trim();
        const type = row.querySelector('.eq-custom-type').value;
        const existingId = row.dataset.customId;
        if (!name) return;
        if (existingId) {
          customOps.push(NX.sb.from('equipment_custom_fields').update({
            field_name: name, field_value: val, field_type: type
          }).eq('id', existingId));
        } else {
          customOps.push(NX.sb.from('equipment_custom_fields').insert({
            equipment_id: equipId, field_name: name, field_value: val, field_type: type
          }));
        }
      });
      await Promise.all(customOps);

      NX.toast && NX.toast('All changes saved ✓', 'success');
      // equipment_edited syslog → covered by Postgres trigger on equipment UPDATE
      closeFullEdit();
      await loadEquipment();
      openDetail(equipId);
    } catch (err) {
      console.error('[FullEdit] Save failed:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '💾 Save All Changes';
    }
  });
}

function closeFullEdit() {
  const m = document.getElementById('eqFullEditModal');
  if (m) m.classList.remove('active');
}

/* ─── Attachments ─── */

function renderAttachment(a) {
  const isImage = (a.mime_type || '').startsWith('image/');
  const url = a.file_url || a.external_url;

  return `
    <div class="eq-attach-item" data-id="${a.id}">
      <div class="eq-attach-icon">${attachmentIcon(a)}</div>
      <div class="eq-attach-info">
        <div class="eq-attach-title-row">
          <input class="eq-attach-title" value="${escAttr(a.title)}" data-attach-id="${a.id}" data-attach-field="title">
          <select class="eq-attach-type" data-attach-id="${a.id}" data-attach-field="type">
            ${['file','photo','receipt','invoice','warranty','manual','link','note'].map(t =>
              `<option value="${t}" ${a.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        ${a.description ? `<div class="eq-attach-desc">${esc(a.description)}</div>` : ''}
        ${isImage && url ? `<img src="${url}" class="eq-attach-preview">` : ''}
        <div class="eq-attach-meta">
          ${url ? `<a href="${url}" target="_blank" class="eq-attach-link">↗ Open</a>` : ''}
          ${a.file_size ? ` · ${formatBytes(a.file_size)}` : ''}
          · ${new Date(a.created_at).toLocaleDateString()}
          ${a.uploaded_by ? ` · ${esc(a.uploaded_by)}` : ''}
        </div>
      </div>
      <div class="eq-attach-actions">
        <button class="eq-btn eq-btn-tiny" onclick="NX.modules.equipment.editAttachmentDesc('${a.id}')">✎</button>
        <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="NX.modules.equipment.deleteAttachment('${a.id}')">✕</button>
      </div>
    </div>
  `;
}

async function addAttachment(equipId, type, returnTo) {
  // returnTo: 'detail' reloads the equipment detail view after adding
  //           'fullEditor' (default) reloads the full 6-tab editor
  // Overview-tab buttons pass 'detail' so users stay where they are.
  const reopen = () => {
    if (returnTo === 'detail') openDetail(equipId);
    else openFullEditor(equipId);
  };

  if (type === 'link') {
    const title = prompt('Link title:');
    if (!title) return;
    const url = prompt('URL:');
    if (!url) return;
    await NX.sb.from('equipment_attachments').insert({
      equipment_id: equipId, type: 'link',
      title: title.slice(0, 200), external_url: url,
      uploaded_by: NX.currentUser?.name || 'user'
    });
    NX.toast && NX.toast('Link added ✓', 'success');
    reopen();
    return;
  }

  if (type === 'note') {
    const title = prompt('Note title:');
    if (!title) return;
    const desc = prompt('Note content:');
    if (!desc) return;
    await NX.sb.from('equipment_attachments').insert({
      equipment_id: equipId, type: 'note',
      title: title.slice(0, 200), description: desc,
      uploaded_by: NX.currentUser?.name || 'user'
    });
    NX.toast && NX.toast('Note added ✓', 'success');
    reopen();
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  if (type === 'photo') {
    input.accept = 'image/*';
    input.capture = 'environment';
  } else {
    input.accept = '*/*';
  }

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      NX.toast && NX.toast('File too large (max 100MB)', 'error');
      return;
    }
    const title = prompt('Title for this attachment:', file.name) || file.name;
    NX.toast && NX.toast('Uploading…', 'info', 8000);

    try {
      const fname = `${equipId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
      const { error: upErr } = await NX.sb.storage
        .from('equipment-attachments')
        .upload(fname, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = NX.sb.storage.from('equipment-attachments').getPublicUrl(fname);
      await NX.sb.from('equipment_attachments').insert({
        equipment_id: equipId, type,
        title: title.slice(0, 200),
        file_url: publicUrl,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: NX.currentUser?.name || 'user'
      });
      NX.toast && NX.toast('Uploaded ✓', 'success');
      reopen();
    } catch (err) {
      console.error('[Attach] Upload error:', err);
      NX.toast && NX.toast('Upload failed: ' + err.message, 'error');
    }
  });

  input.click();
}

async function deleteAttachment(id) {
  if (!confirm('Delete this attachment?')) return;
  try {
    const { data: a } = await NX.sb.from('equipment_attachments').select('*').eq('id', id).single();
    if (a && a.file_url) {
      const match = a.file_url.match(/equipment-attachments\/(.+)$/);
      if (match) await NX.sb.storage.from('equipment-attachments').remove([match[1]]);
    }
    await NX.sb.from('equipment_attachments').delete().eq('id', id);
    NX.toast && NX.toast('Deleted ✓', 'success');
    if (a?.equipment_id) openFullEditor(a.equipment_id);
  } catch (err) {
    console.error(err);
    NX.toast && NX.toast('Delete failed', 'error');
  }
}

async function editAttachmentDesc(id) {
  const { data: a } = await NX.sb.from('equipment_attachments').select('*').eq('id', id).single();
  if (!a) return;
  const desc = prompt('Description:', a.description || '');
  if (desc == null) return;
  await NX.sb.from('equipment_attachments').update({ description: desc }).eq('id', id);
  NX.toast && NX.toast('Updated ✓', 'success');
  if (a.equipment_id) openFullEditor(a.equipment_id);
}

/* ─── Photo management ─── */

function uploadPhoto(equipId, field) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    NX.toast && NX.toast('Uploading…', 'info', 5000);

    try {
      const fname = `${equipId}/${field}-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
      const { error } = await NX.sb.storage
        .from('equipment-photos')
        .upload(fname, file, { upsert: false, contentType: file.type });
      if (error) throw error;

      const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
      await NX.sb.from('equipment').update({ [field]: publicUrl }).eq('id', equipId);
      NX.toast && NX.toast('Photo uploaded ✓', 'success');
      openFullEditor(equipId);
    } catch (err) {
      console.error(err);
      NX.toast && NX.toast('Upload failed', 'error');
    }
  });

  input.click();
}

function replacePhoto(equipId, field) { uploadPhoto(equipId, field); }

async function removePhoto(equipId, field) {
  if (!confirm('Remove this photo?')) return;
  await NX.sb.from('equipment').update({ [field]: null }).eq('id', equipId);
  NX.toast && NX.toast('Removed ✓', 'success');
  openFullEditor(equipId);
}

async function deleteCustomField(id, equipId) {
  if (!confirm('Delete this custom field?')) return;
  await NX.sb.from('equipment_custom_fields').delete().eq('id', id);
  NX.toast && NX.toast('Deleted ✓', 'success');
  openFullEditor(equipId);
}


/* ════════════════════════════════════════════════════════════════════════════
   10. LINEAGE — parent/child equipment, family tree
   ════════════════════════════════════════════════════════════════════════════ */

async function loadFamily(equipId) {
  try {
    const { data, error } = await NX.sb.rpc('get_family_tree', { eq_id: equipId });
    if (!error && data) return data;
  } catch (e) { /* fall through */ }

  // Fallback: self + parent + direct children (no recursion)
  const { data: self } = await NX.sb.from('equipment')
    .select('id, name, location, category, status, qr_code, parent_equipment_id, relationship_type')
    .eq('id', equipId).single();
  if (!self) return [];

  const out = [{ ...self, depth: 0, branch: 'self' }];

  if (self.parent_equipment_id) {
    const { data: parent } = await NX.sb.from('equipment')
      .select('id, name, location, category, status, qr_code, parent_equipment_id, relationship_type')
      .eq('id', self.parent_equipment_id).single();
    if (parent) out.unshift({ ...parent, depth: -1, branch: 'ancestor' });
  }

  const { data: children } = await NX.sb.from('equipment')
    .select('id, name, location, category, status, qr_code, parent_equipment_id, relationship_type')
    .eq('parent_equipment_id', equipId);
  if (children?.length) {
    children.forEach(c => out.push({ ...c, depth: 1, branch: 'descendant' }));
  }
  return out;
}

function renderFamilyTree(family, selfId) {
  if (!family.length) return `<div class="eq-family-empty">No relationships yet.</div>`;
  return `<div class="eq-family-tree">${
    family.map(node => {
      const isSelf = node.id === selfId;
      const indent = '·'.repeat(Math.abs(node.depth) + 1);
      const handler = isSelf ? '' : `onclick="NX.modules.equipment.openDetail('${node.id}')"`;
      return `
        <div class="eq-family-row ${isSelf ? 'is-self' : ''}" ${handler}>
          <span class="eq-family-indent">${indent}</span>
          <span class="eq-family-icon">${catIcon(node.category)}</span>
          <span class="eq-family-name">${esc(node.name)}</span>
          ${node.relationship_type && !isSelf
            ? `<span class="eq-family-rel" title="${esc(relLabel(node.relationship_type))}">${relIcon(node.relationship_type)} ${esc(relLabel(node.relationship_type))}</span>`
            : ''}
          <span class="eq-family-status-dot" style="background:${statusDot(node.status)}" title="${esc(node.status || '')}"></span>
        </div>
      `;
    }).join('')
  }</div>`;
}

async function renderFamilySection(equipId) {
  const modal = document.getElementById('eqModal');
  if (!modal) return;
  const overviewPanel = modal.querySelector('[data-panel="overview"]');
  if (!overviewPanel) return;
  // Remove existing family section if present (allows re-render after changes)
  const existing = overviewPanel.querySelector('#eqFamilySection');
  if (existing) existing.remove();

  const family = await loadFamily(equipId);
  const self = family.find(n => n.id === equipId) || { parent_equipment_id: null };
  const hasParent = !!self.parent_equipment_id;

  const section = document.createElement('div');
  section.className = 'eq-family-section';
  section.id = 'eqFamilySection';
  section.innerHTML = `
    <h4>👪 Family</h4>
    ${renderFamilyTree(family, equipId)}
    <div class="eq-family-actions">
      ${hasParent
        ? `<button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.unsetParent('${equipId}')">Remove Parent</button>`
        : `<button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.pickParent('${equipId}')">+ Set Parent</button>`}
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.pickChild('${equipId}')">+ Add Child</button>
    </div>
  `;
  overviewPanel.appendChild(section);
}

async function pickParent(equipId) {
  await openEquipmentPicker({
    title: '👪 Set parent equipment',
    excludeId: equipId,
    excludeDescendantsOf: equipId,
    showRelationship: true,
    onPick: async (parentId, relationshipType) => {
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ parent_equipment_id: parentId, relationship_type: relationshipType })
          .eq('id', equipId);
        if (error) throw error;
        NX.toast && NX.toast('Parent set ✓', 'success');
        renderFamilySection(equipId);
      } catch (e) {
        const msg = String(e.message || e).includes('cycle')
          ? 'That would create a loop in the family tree.'
          : 'Could not set parent: ' + (e.message || e);
        NX.toast && NX.toast(msg, 'error');
      }
    }
  });
}

async function pickChild(equipId) {
  await openEquipmentPicker({
    title: '👪 Add child equipment',
    excludeId: equipId,
    excludeAncestorsOf: equipId,
    showRelationship: true,
    onPick: async (childId, relationshipType) => {
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ parent_equipment_id: equipId, relationship_type: relationshipType })
          .eq('id', childId);
        if (error) throw error;
        NX.toast && NX.toast('Child added ✓', 'success');
        renderFamilySection(equipId);
      } catch (e) {
        const msg = String(e.message || e).includes('cycle')
          ? 'That would create a loop in the family tree.'
          : 'Could not add child: ' + (e.message || e);
        NX.toast && NX.toast(msg, 'error');
      }
    }
  });
}

async function unsetParent(equipId) {
  if (!confirm('Remove the parent relationship?')) return;
  const { error } = await NX.sb.from('equipment')
    .update({ parent_equipment_id: null, relationship_type: null })
    .eq('id', equipId);
  if (error) {
    NX.toast && NX.toast('Failed: ' + error.message, 'error');
    return;
  }
  NX.toast && NX.toast('Parent removed', 'info');
  renderFamilySection(equipId);
}

async function openEquipmentPicker(opts) {
  const { data: all } = await NX.sb.from('equipment')
    .select('id, name, location, category, status, parent_equipment_id')
    .neq('status', 'retired')
    .order('location').order('name');
  const candidates = all || [];

  // Build exclusion set
  const exclude = new Set();
  if (opts.excludeId) exclude.add(opts.excludeId);
  if (opts.excludeDescendantsOf) {
    const queue = [opts.excludeDescendantsOf];
    while (queue.length) {
      const cur = queue.shift();
      candidates.filter(c => c.parent_equipment_id === cur).forEach(c => {
        if (!exclude.has(c.id)) { exclude.add(c.id); queue.push(c.id); }
      });
    }
  }
  if (opts.excludeAncestorsOf) {
    let cur = opts.excludeAncestorsOf;
    let hops = 0;
    while (cur && hops < 20) {
      const node = candidates.find(c => c.id === cur);
      if (!node || !node.parent_equipment_id) break;
      exclude.add(node.parent_equipment_id);
      cur = node.parent_equipment_id;
      hops++;
    }
  }

  const filtered = candidates.filter(c => !exclude.has(c.id));

  let overlay = document.getElementById('eqPickerOverlay');
  const isFreshPicker = !overlay;
  if (isFreshPicker) {
    overlay = document.createElement('div');
    overlay.id = 'eqPickerOverlay';
    overlay.className = 'eq-picker-overlay';
    document.body.appendChild(overlay);
  }
  let selectedRel = opts.showRelationship ? 'connected_to' : null;

  const renderList = (query) => {
    const q = (query || '').toLowerCase().trim();
    const matches = q
      ? filtered.filter(c => (c.name + ' ' + (c.location || '')).toLowerCase().includes(q))
      : filtered;
    if (!matches.length) return `<div class="eq-picker-empty">No equipment matches.</div>`;
    return matches.map(c => `
      <div class="eq-picker-item" data-id="${c.id}">
        <span class="eq-picker-item-icon">${catIcon(c.category)}</span>
        <div class="eq-picker-item-body">
          <div class="eq-picker-item-name">${esc(c.name)}</div>
          <div class="eq-picker-item-sub">${esc(c.location || '')}${c.status && c.status !== 'operational' ? ' · ' + esc(c.status) : ''}</div>
        </div>
      </div>
    `).join('');
  };

  overlay.innerHTML = `
    <div class="eq-picker">
      <div class="eq-picker-head">
        <h3>${esc(opts.title)}</h3>
        <button class="eq-picker-close" id="eqPickerClose">✕</button>
      </div>
      <div class="eq-picker-search">
        <input type="text" id="eqPickerSearch" placeholder="Search equipment…" autocomplete="off">
      </div>
      ${opts.showRelationship ? `
        <div class="eq-picker-rel-row" id="eqPickerRelRow">
          ${RELATIONSHIP_TYPES.map(r => `
            <button class="eq-rel-chip ${r.key === selectedRel ? 'active' : ''}" data-rel="${r.key}">
              ${r.icon} ${r.label}
            </button>
          `).join('')}
        </div>` : ''}
      <div class="eq-picker-list" id="eqPickerList">${renderList('')}</div>
    </div>
  `;
  overlay.classList.add('active');

  const close = () => { overlay.classList.remove('active'); overlay.innerHTML = ''; };
  document.getElementById('eqPickerClose').addEventListener('click', close);
  if (isFreshPicker) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const searchInput = document.getElementById('eqPickerSearch');
  searchInput.addEventListener('input', () => {
    document.getElementById('eqPickerList').innerHTML = renderList(searchInput.value);
    wireItems();
  });
  searchInput.focus();

  if (opts.showRelationship) {
    document.getElementById('eqPickerRelRow').addEventListener('click', e => {
      const chip = e.target.closest('.eq-rel-chip');
      if (!chip) return;
      selectedRel = chip.dataset.rel;
      document.querySelectorAll('#eqPickerRelRow .eq-rel-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  }

  function wireItems() {
    document.querySelectorAll('#eqPickerList .eq-picker-item').forEach(el => {
      el.addEventListener('click', () => { close(); opts.onPick(el.dataset.id, selectedRel); });
    });
  }
  wireItems();
}


/* ════════════════════════════════════════════════════════════════════════════
   11. DISPATCH — contractor dispatch sheet, dispatch_log
   ════════════════════════════════════════════════════════════════════════════ */

function extractContact(node) {
  const text = (node.notes || '') + '\n' + JSON.stringify(node.tags || []) + '\n' + (node.name || '');
  const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const links = node.links || {};
  return {
    phone: links.phone || (phoneMatch ? phoneMatch[0].trim() : ''),
    email: links.email || (emailMatch ? emailMatch[0].trim() : ''),
  };
}

function normalizePhone(p) {
  if (!p) return '';
  const cleaned = p.replace(/[^\d+]/g, '');
  if (cleaned.length === 10 && !cleaned.startsWith('+')) return '+1' + cleaned;
  return cleaned;
}

async function loadContractors() {
  let pool = NX.nodes || [];
  if (!pool.length) {
    const { data } = await NX.sb.from('nodes').select('*').limit(2000);
    pool = data || [];
  }
  const isContractor = n => {
    const cat = (n.category || '').toLowerCase();
    if (cat === 'contractor' || cat === 'vendor' || cat === 'service' || cat === 'contractors') return true;
    const tags = (n.tags || []).map(t => String(t).toLowerCase());
    if (tags.some(t => /contract|vendor|service|hvac|plumb|electric|refriger/.test(t))) return true;
    return false;
  };
  return pool
    .filter(isContractor)
    .map(n => ({ ...n, _contact: extractContact(n) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function loadEquipmentForDispatch(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq) return null;

  let ticket = null;
  try {
    const { data: tickets } = await NX.sb.from('tickets')
      .select('id, title, body, status, created_at')
      .eq('equipment_id', equipId)
      .neq('status', 'closed').neq('status', 'resolved')
      .order('created_at', { ascending: false }).limit(1);
    if (tickets?.length) ticket = tickets[0];
  } catch (e) {}

  return { eq, ticket };
}

async function loadRecentDispatches(equipId, limit = 3) {
  try {
    const { data } = await NX.sb.from('dispatch_log')
      .select('*').eq('equipment_id', equipId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch (e) { return []; }
}

function buildDispatchMessage(eq, ticket, contact, userName) {
  const restaurant = eq.location || '';
  const area = eq.area ? ` (${eq.area})` : '';
  const equipName = eq.name;
  const issue = ticket?.title || ticket?.body || '';
  const who = userName || 'NEXUS';
  const greeting = (contact.name || '').split(' ')[0] || 'there';

  let body = `Hi ${greeting}, this is ${who} at ${restaurant}.\n\n`;
  body += `We need service on: ${equipName}${area}\n`;
  if (eq.manufacturer || eq.model) body += `Unit: ${[eq.manufacturer, eq.model].filter(Boolean).join(' ')}\n`;
  if (eq.serial_number) body += `Serial: ${eq.serial_number}\n`;
  if (issue) body += `\nIssue: ${issue}\n`;
  body += `\nWhen can you take a look? Thanks.`;
  return body;
}

/* ═════════════════════════════════════════════════════════════════════════
   LOOKUP SERVICE PHONE FROM NODE
   
   Called from the Links tab in openFullEditor when user clicks "Look up
   from preferred contractor." Reads the preferred contractor node, extracts
   phone + name, and populates the service_contact_name and service_phone
   form inputs.
   
   If no preferred contractor is set, falls back to scanning recent
   maintenance records for the most-used contractor and grabbing theirs.
   ═════════════════════════════════════════════════════════════════════════ */

async function lookupServicePhoneFromNode(equipId) {
  try {
    const { data: eq } = await NX.sb.from('equipment')
      .select('preferred_contractor_node_id, name')
      .eq('id', equipId).single();
    if (!eq) throw new Error('Equipment not found');

    let node = null;
    
    // Primary: preferred contractor
    if (eq.preferred_contractor_node_id) {
      const { data } = await NX.sb.from('nodes')
        .select('id, name, notes, tags, links')
        .eq('id', eq.preferred_contractor_node_id).single();
      node = data;
    }
    
    // Fallback: find most recent maintenance record with a performed_by,
    // then match that string against contractor nodes
    if (!node) {
      const { data: maint } = await NX.sb.from('equipment_maintenance')
        .select('performed_by')
        .eq('equipment_id', equipId)
        .not('performed_by', 'is', null)
        .order('event_date', { ascending: false })
        .limit(5);
      
      if (maint?.length) {
        // Get the most common contractor name
        const counts = {};
        maint.forEach(m => {
          if (m.performed_by) counts[m.performed_by] = (counts[m.performed_by] || 0) + 1;
        });
        const topName = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        
        // Search contractor nodes matching that name
        const pool = NX.nodes || [];
        node = pool.find(n => {
          const cat = (n.category || '').toLowerCase();
          if (cat !== 'contractor' && cat !== 'vendor' && cat !== 'service') return false;
          return (n.name || '').toLowerCase().includes(topName.toLowerCase().split(/\s+/)[0]);
        });
      }
    }
    
    if (!node) {
      NX.toast && NX.toast('No contractor found. Set a preferred contractor first via the Dispatch sheet.', 'warning');
      return;
    }
    
    // Extract phone from node (links.phone OR regex from notes)
    const text = (node.notes || '') + '\n' + JSON.stringify(node.tags || []) + '\n' + (node.name || '');
    const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const links = node.links || {};
    const phone = links.phone || (phoneMatch ? phoneMatch[0].trim() : '');
    
    if (!phone) {
      NX.toast && NX.toast(`Found ${node.name} but no phone on file. Add one to their node in Brain first.`, 'warning');
      return;
    }
    
    // Populate form inputs
    const modal = document.getElementById('eqFullEditModal');
    if (!modal) return;
    const nameInput = modal.querySelector('[data-field="service_contact_name"]');
    const phoneInput = modal.querySelector('[data-field="service_phone"]');
    if (nameInput && !nameInput.value) nameInput.value = node.name || '';
    if (phoneInput) phoneInput.value = phone;
    
    NX.toast && NX.toast(`✓ Filled from ${node.name}`, 'success');
  } catch (err) {
    console.error('[lookupServicePhoneFromNode] failed:', err);
    NX.toast && NX.toast('Lookup failed: ' + err.message, 'error');
  }
}

async function openDispatchSheet(equipId, ticketId) {
  const ctx = await loadEquipmentForDispatch(equipId);
  if (!ctx) { NX.toast && NX.toast('Equipment not found', 'error'); return; }
  const { eq, ticket } = ctx;
  const contractors = await loadContractors();

  let activeTicket = ticket;
  if (ticketId && (!ticket || ticket.id !== ticketId)) {
    try {
      const { data } = await NX.sb.from('tickets').select('*').eq('id', ticketId).single();
      if (data) activeTicket = data;
    } catch (e) {}
  }

  let overlay = document.getElementById('dispatchOverlay');
  const isFreshOverlay = !overlay;
  if (isFreshOverlay) {
    overlay = document.createElement('div');
    overlay.id = 'dispatchOverlay';
    overlay.className = 'dispatch-overlay';
    document.body.appendChild(overlay);
  }

  let stage = 'contact';
  let selectedContact = null;
  let selectedMethod = null;
  let composedMessage = '';
  
  // Auto-select preferred contractor if equipment has one set.
  // Skips the contact picker entirely and jumps straight to the method stage.
  // User can still tap "Back" to change contractor if needed.
  if (eq.preferred_contractor_node_id) {
    const preferred = contractors.find(c => c.id === eq.preferred_contractor_node_id);
    if (preferred) {
      selectedContact = preferred;
      stage = 'method';
    }
  }
  
  // If no preferred contractor but the ticket has a recent dispatch to
  // somebody, use them. This handles the "reopen last dispatch" case.
  if (!selectedContact && activeTicket) {
    try {
      const { data: recent } = await NX.sb.from('dispatch_events')
        .select('contractor_node_id')
        .eq('ticket_id', activeTicket.id)
        .not('contractor_node_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent?.contractor_node_id) {
        const c = contractors.find(x => x.id === recent.contractor_node_id);
        if (c) { selectedContact = c; stage = 'method'; }
      }
    } catch (e) {}
  }

  const close = () => { overlay.classList.remove('active'); overlay.innerHTML = ''; };
  if (isFreshOverlay) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const render = () => {
    const headLine = stage === 'contact' ? 'Dispatch contractor'
                  : stage === 'method'  ? `Contact ${selectedContact?.name || ''}`
                                        : `Send ${selectedMethod}`;
    overlay.innerHTML = `
      <div class="dispatch-sheet">
        <div class="dispatch-handle"></div>
        <div class="dispatch-head">
          <h3>${esc(headLine)}</h3>
          <div class="dispatch-context">
            <span class="ctx-tag">${catIcon(eq.category)} ${esc(eq.name)}</span>
            <span class="ctx-tag">${esc(eq.location || '')}</span>
            ${activeTicket ? `<span class="ctx-tag">🎫 ${esc((activeTicket.title || '').slice(0, 40))}</span>` : ''}
          </div>
        </div>
        <div class="dispatch-stage" id="dispatchStage">${renderStage()}</div>
        ${renderActions()}
      </div>
    `;
    overlay.classList.add('active');
    wireStage();
  };

  const renderStage = () => {
    if (stage === 'contact') return renderContactStage();
    if (stage === 'method')  return renderMethodStage();
    if (stage === 'compose') return renderComposeStage();
    return '';
  };

  const renderContactStage = () => {
    if (!contractors.length) {
      return `
        <div class="eq-picker-empty">
          No contractors in your brain yet.<br>
          Add them via Ingest, or tag any node as <b>contractor</b>.
        </div>
        <div class="dispatch-add-contact">
          <input id="dispatchAddName"  placeholder="Name (e.g. Joe's Refrigeration)">
          <input id="dispatchAddPhone" placeholder="Phone (optional)">
          <input id="dispatchAddEmail" placeholder="Email (optional)">
          <button class="eq-btn eq-btn-primary" id="dispatchAddBtn">+ Add & continue</button>
        </div>
      `;
    }
    const preferredId = eq.preferred_contractor_node_id;
    const sorted = [...contractors].sort((a, b) => {
      if (a.id === preferredId) return -1;
      if (b.id === preferredId) return 1;
      return 0;
    });
    return sorted.map(c => {
      const ct = c._contact || {};
      const isPref = c.id === preferredId;
      const initials = (c.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div class="dispatch-contact ${isPref ? 'is-preferred' : ''}" data-id="${c.id}">
          <div class="dispatch-contact-avatar">${esc(initials)}</div>
          <div class="dispatch-contact-body">
            <div class="dispatch-contact-name">
              ${esc(c.name)}
              ${isPref ? '<span class="preferred-star" title="Preferred contractor">★</span>' : ''}
            </div>
            <div class="dispatch-contact-meta">
              ${ct.phone ? esc(ct.phone) : ''}${ct.phone && ct.email ? ' · ' : ''}${ct.email ? esc(ct.email) : ''}
              ${!ct.phone && !ct.email ? '<span style="color:var(--amber)">Tap to add contact info</span>' : ''}
            </div>
          </div>
          <div class="dispatch-contact-methods">
            ${ct.phone ? '📞' : ''}${ct.phone ? '💬' : ''}${ct.email ? '✉' : ''}
          </div>
        </div>
      `;
    }).join('');
  };

  const renderMethodStage = () => {
    const ct = selectedContact._contact || {};
    return `
      <div style="margin-bottom:6px">
        <div style="font-size:13px;color:var(--text);font-weight:500">${esc(selectedContact.name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          ${ct.phone ? esc(ct.phone) : ''}${ct.phone && ct.email ? ' · ' : ''}${ct.email ? esc(ct.email) : ''}
        </div>
      </div>
      <div class="dispatch-method-row">
        <button class="dispatch-method-btn" data-method="call"     ${!ct.phone ? 'disabled' : ''}>
          <span class="method-icon">📞</span><span>Call</span>
        </button>
        <button class="dispatch-method-btn" data-method="sms"      ${!ct.phone ? 'disabled' : ''}>
          <span class="method-icon">💬</span><span>SMS</span>
        </button>
        <button class="dispatch-method-btn" data-method="whatsapp" ${!ct.phone ? 'disabled' : ''}>
          <span class="method-icon">🟢</span><span>WhatsApp</span>
        </button>
        <button class="dispatch-method-btn" data-method="email"    ${!ct.email ? 'disabled' : ''}>
          <span class="method-icon">✉</span><span>Email</span>
        </button>
      </div>
      ${(!ct.phone && !ct.email) ? `
        <div class="dispatch-add-contact">
          <div style="font-size:12px;color:var(--muted)">Add contact info for ${esc(selectedContact.name)}:</div>
          <input id="dispatchEditPhone" placeholder="Phone" value="${escAttr(ct.phone || '')}">
          <input id="dispatchEditEmail" placeholder="Email" value="${escAttr(ct.email || '')}">
          <button class="eq-btn eq-btn-secondary" id="dispatchSaveContact">Save to ${esc(selectedContact.name)}</button>
        </div>
      ` : ''}
    `;
  };

  const renderComposeStage = () => {
    const ct = selectedContact._contact || {};
    const target = selectedMethod === 'email' ? ct.email : normalizePhone(ct.phone);
    composedMessage = composedMessage ||
      buildDispatchMessage(eq, activeTicket, selectedContact, NX.currentUser?.name);
    const isEmail = selectedMethod === 'email';
    return `
      <div class="dispatch-message">
        <div class="dispatch-message-target">
          <b>To:</b> ${esc(selectedContact.name)} <span style="color:var(--faint)">via ${esc(selectedMethod)}</span><br>
          <b>${isEmail ? 'Email' : 'Phone'}:</b> ${esc(target || '—')}
        </div>
        ${selectedMethod === 'call' ? `
          <div style="font-size:13px;color:var(--muted);text-align:center;padding:10px">
            Tap "Place Call" to dial ${esc(target || '')}.<br>
            <span style="font-size:11px;color:var(--faint)">A note will be logged for follow-up.</span>
          </div>
          <textarea id="dispatchNote" placeholder="Optional note about why you're calling…">${esc(composedMessage)}</textarea>
        ` : `
          <textarea id="dispatchBody">${esc(composedMessage)}</textarea>
        `}
      </div>
    `;
  };

  const renderActions = () => {
    if (stage === 'contact') return '';
    if (stage === 'method') {
      return `<div class="dispatch-actions">
        <button class="eq-btn eq-btn-secondary" id="dispatchBack">← Back</button>
      </div>`;
    }
    return `<div class="dispatch-actions">
      <button class="eq-btn eq-btn-secondary" id="dispatchBack">← Back</button>
      <button class="eq-btn eq-btn-primary" id="dispatchSend">
        ${selectedMethod === 'call' ? '📞 Place Call' : '🚀 Send'}
      </button>
    </div>`;
  };

  const wireStage = () => {
    if (stage === 'contact') {
      overlay.querySelectorAll('.dispatch-contact').forEach(el => {
        el.addEventListener('click', () => {
          selectedContact = contractors.find(c => c.id === el.dataset.id);
          if (!selectedContact) return;
          stage = 'method';
          render();
        });
      });
      const addBtn = document.getElementById('dispatchAddBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const name = document.getElementById('dispatchAddName').value.trim();
          if (!name) { NX.toast && NX.toast('Name required', 'error'); return; }
          const phone = document.getElementById('dispatchAddPhone').value.trim();
          const email = document.getElementById('dispatchAddEmail').value.trim();
          const newNode = await createContractorNode(name, phone, email);
          selectedContact = { ...newNode, _contact: { phone, email } };
          stage = 'method';
          render();
        });
      }
    }

    if (stage === 'method') {
      overlay.querySelectorAll('.dispatch-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          selectedMethod = btn.dataset.method;
          stage = 'compose';
          render();
        });
      });
      const saveBtn = document.getElementById('dispatchSaveContact');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const phone = document.getElementById('dispatchEditPhone').value.trim();
          const email = document.getElementById('dispatchEditEmail').value.trim();
          await saveContactToNode(selectedContact.id, phone, email);
          selectedContact._contact = { phone, email };
          NX.toast && NX.toast('Contact saved ✓', 'success');
          render();
        });
      }
      document.getElementById('dispatchBack')?.addEventListener('click', () => {
        stage = 'contact'; selectedContact = null; render();
      });
    }

    if (stage === 'compose') {
      document.getElementById('dispatchBack')?.addEventListener('click', () => {
        stage = 'method'; selectedMethod = null; composedMessage = ''; render();
      });
      document.getElementById('dispatchSend')?.addEventListener('click', async () => {
        const ta = document.getElementById('dispatchBody') || document.getElementById('dispatchNote');
        composedMessage = ta ? ta.value : composedMessage;
        await executeDispatch({
          contact: selectedContact,
          method: selectedMethod,
          message: composedMessage,
          equipId: eq.id,
          ticketId: activeTicket?.id,
        });
        close();
      });
    }
  };

  render();
}

async function createContractorNode(name, phone, email) {
  const links = {};
  if (phone) links.phone = phone;
  if (email) links.email = email;
  const newNode = {
    name,
    category: 'contractor',
    tags: ['contractor'],
    notes: [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : ''].filter(Boolean).join('\n'),
    links,
    owner_id: null,
    access_count: 0,
  };
  try {
    const { data, error } = await NX.sb.from('nodes').insert(newNode).select().single();
    if (error) throw error;
    if (NX.nodes) NX.nodes.push(data);
    if (NX.allNodes) NX.allNodes.push(data);
    return data;
  } catch (e) {
    console.warn('[Dispatch] Could not persist contractor node:', e);
    return { id: 'ephemeral_' + Date.now(), ...newNode };
  }
}

async function saveContactToNode(nodeId, phone, email) {
  const { data: node } = await NX.sb.from('nodes').select('notes, links').eq('id', nodeId).single();
  const links = { ...(node?.links || {}) };
  if (phone) links.phone = phone;
  if (email) links.email = email;
  const noteAddenda = [];
  if (phone && !(node?.notes || '').includes(phone)) noteAddenda.push(`Phone: ${phone}`);
  if (email && !(node?.notes || '').includes(email)) noteAddenda.push(`Email: ${email}`);
  const newNotes = noteAddenda.length
    ? [(node?.notes || '').trim(), noteAddenda.join('\n')].filter(Boolean).join('\n')
    : node?.notes;
  await NX.sb.from('nodes').update({ links, notes: newNotes }).eq('id', nodeId);
  if (NX.nodes) {
    const cached = NX.nodes.find(n => n.id === nodeId);
    if (cached) { cached.links = links; cached.notes = newNotes; }
  }
}

async function executeDispatch({ contact, method, message, equipId, ticketId }) {
  const ct = contact._contact || {};
  const phone = normalizePhone(ct.phone);
  const email = ct.email;
  let url = '';
  let opened = false;

  if (method === 'call' && phone) {
    url = `tel:${phone}`;
  } else if (method === 'sms' && phone) {
    url = `sms:${phone}?body=${encodeURIComponent(message)}`;
  } else if (method === 'whatsapp' && phone) {
    const waNum = phone.replace(/^\+/, '');
    url = `https://wa.me/${waNum}?text=${encodeURIComponent(message)}`;
  } else if (method === 'email' && email) {
    url = `mailto:${email}?subject=${encodeURIComponent('Service request — NEXUS')}&body=${encodeURIComponent(message)}`;
  }

  if (url) {
    try {
      const a = document.createElement('a');
      a.href = url;
      if (method === 'whatsapp') a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      opened = true;
    } catch (e) {
      console.warn('[Dispatch] Native handler failed:', e);
      try { window.open(url, '_blank'); opened = true; } catch {}
    }
  }

  await logDispatch({
    equipment_id: equipId,
    contractor_node_id: String(contact.id).startsWith('ephemeral_') ? null : contact.id,
    contractor_name: contact.name,
    contractor_phone: phone || null,
    contractor_email: email || null,
    method,
    ticket_id: ticketId || null,
    message,
    dispatched_by: NX.currentUser?.name || null,
    outcome: 'pending',
  });

  if (NX.trackAccess && contact.id && !String(contact.id).startsWith('ephemeral_')) {
    NX.trackAccess([contact.id]);
  }

  try {
    await NX.sb.from('action_chains').insert({
      trigger_text: `Dispatched ${contact.name} via ${method}`,
      actions: [{ type: 'dispatch', equipment_id: equipId, contractor_node_id: contact.id, method }],
      user_name: NX.currentUser?.name,
    });
  } catch (e) {}

  NX.toast && NX.toast(
    opened ? `Opened ${method} to ${contact.name} ✓` : `Logged ${method} attempt`,
    'success'
  );

  refreshDispatchChips(equipId);
}

async function logDispatch(record) {
  try {
    const { error } = await NX.sb.from('dispatch_log').insert(record);
    if (error) throw error;
  } catch (e) {
    console.warn('[Dispatch] Could not log to DB:', e);
    if (window.OfflineQueue) {
      try { await window.OfflineQueue.add({ type: 'dispatch_log', payload: record }); } catch {}
    }
  }
}

async function setOutcome(dispatchId, outcome, notes) {
  const update = { outcome };
  if (notes) update.outcome_notes = notes;
  if (outcome !== 'pending') update.responded_at = new Date().toISOString();
  await NX.sb.from('dispatch_log').update(update).eq('id', dispatchId);
}

async function refreshDispatchChips(equipId) {
  const overviewPanel = document.querySelector('#eqModal [data-panel="overview"]');
  if (!overviewPanel) return;
  const existing = overviewPanel.querySelector('#eqDispatchRecent');
  if (existing) existing.remove();
  const recent = await loadRecentDispatches(equipId, 3);
  if (!recent.length) return;

  const section = document.createElement('div');
  section.className = 'eq-family-section';
  section.id = 'eqDispatchRecent';
  section.innerHTML = `
    <h4>📞 Recent Dispatches</h4>
    <div class="eq-dispatch-recent">
      ${recent.map(d => `
        <div class="eq-dispatch-chip" data-id="${d.id}">
          <span class="chip-method">${methodIcon(d.method)}</span>
          <span class="chip-name">${esc(d.contractor_name || 'Unknown')}</span>
          <span class="chip-outcome outcome-${esc(d.outcome || 'pending')}"
                onclick="NX.modules.equipment.cycleDispatchOutcome('${d.id}', '${equipId}')"
                title="Click to update status">
            ${esc(d.outcome || 'pending')}
          </span>
          <span class="chip-when">${timeAgo(d.created_at)}</span>
        </div>
      `).join('')}
    </div>
  `;
  overviewPanel.appendChild(section);
}

const OUTCOME_CYCLE = ['pending', 'acknowledged', 'scheduled', 'resolved', 'no_response'];

async function cycleDispatchOutcome(dispatchId, equipId) {
  const { data } = await NX.sb.from('dispatch_log').select('outcome').eq('id', dispatchId).single();
  const cur = data?.outcome || 'pending';
  const idx = OUTCOME_CYCLE.indexOf(cur);
  const next = OUTCOME_CYCLE[(idx + 1) % OUTCOME_CYCLE.length];
  await setOutcome(dispatchId, next);
  NX.toast && NX.toast(`Marked: ${next}`, 'info');
  refreshDispatchChips(equipId);
}

function dispatchFromTicket(equipId, ticketId) {
  return openDispatchSheet(equipId, ticketId);
}

// Direct call to service contact. Shows a themed confirm modal before
// dialing so the user sees WHO they're about to call.
//
// Priority for phone lookup:
//   1. Use equipment.service_phone if set
//   2. Fallback to preferred_contractor_node_id → nodes.links.phone
//   3. If neither exists, prompt to set one up
async function callService(equipId) {
  try {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, service_phone, service_contact_name, preferred_contractor_node_id')
      .eq('id', equipId).single();
    if (!eq) { NX.toast && NX.toast('Equipment not found', 'error'); return; }
    
    let phone = eq.service_phone;
    let name = eq.service_contact_name;
    let source = phone ? 'direct' : null;
    
    // Fallback to contractor node
    if (!phone && eq.preferred_contractor_node_id) {
      const { data: node } = await NX.sb.from('nodes')
        .select('name, notes, tags, links')
        .eq('id', eq.preferred_contractor_node_id).single();
      if (node) {
        const text = (node.notes || '') + '\n' + JSON.stringify(node.tags || []) + '\n' + (node.name || '');
        const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        const links = node.links || {};
        phone = links.phone || (phoneMatch ? phoneMatch[0].trim() : '');
        name = name || node.name;
        source = 'contractor';
      }
    }
    
    if (!phone) {
      showNoServiceContactModal(equipId, eq.name);
      return;
    }
    
    showCallConfirmModal({
      equipId,
      equipName: eq.name,
      contactName: name || 'Service',
      phone,
      contractorNodeId: eq.preferred_contractor_node_id,
      source
    });
  } catch (err) {
    console.error('[callService] failed:', err);
    NX.toast && NX.toast('Call failed: ' + err.message, 'error');
  }
}

// Confirmation modal before dialing
function showCallConfirmModal({ equipId, equipName, contactName, phone, contractorNodeId, source }) {
  // Normalize to tel: format
  const cleaned = phone.replace(/[^\d+]/g, '');
  const telHref = cleaned.length === 10 && !cleaned.startsWith('+') ? '+1' + cleaned : cleaned;
  const prettyPhone = formatPhonePretty(phone);
  const sourceLabel = source === 'direct' ? 'Service contact on file'
                    : source === 'contractor' ? 'Preferred contractor'
                    : 'Service contact';
  
  const existing = document.getElementById('eqCallConfirm');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'eqCallConfirm';
  modal.className = 'eq-call-confirm';
  modal.innerHTML = `
    <div class="eq-call-confirm-bg"></div>
    <div class="eq-call-confirm-card">
      <div class="eq-call-confirm-icon">📞</div>
      <div class="eq-call-confirm-title">Call ${esc(contactName)}?</div>
      <div class="eq-call-confirm-phone">${esc(prettyPhone)}</div>
      <div class="eq-call-confirm-meta">${esc(sourceLabel)} · ${esc(equipName)}</div>
      <div class="eq-call-confirm-issue-wrap">
        <label class="eq-call-confirm-issue-label" for="eqCallIssue">
          What's the issue? <span class="eq-optional-tag">(required — helps log the call)</span>
        </label>
        <textarea class="eq-call-confirm-issue" id="eqCallIssue" rows="2" placeholder="e.g., Compressor not cooling, freezing intermittently..."></textarea>
      </div>
      <div class="eq-call-confirm-actions">
        <button class="eq-btn eq-btn-secondary" id="eqCallCancel">Cancel</button>
        <a class="eq-btn eq-call-service-btn is-disabled" id="eqCallGo" href="tel:${esc(telHref)}" aria-disabled="true">📞 Call Now</a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('active'));
  
  const close = () => { modal.classList.remove('active'); setTimeout(() => modal.remove(), 200); };
  const issueEl = modal.querySelector('#eqCallIssue');
  const callBtn = modal.querySelector('#eqCallGo');
  
  // Enable Call Now only when there's at least 2 chars in the textarea
  issueEl.addEventListener('input', () => {
    const hasText = issueEl.value.trim().length >= 2;
    callBtn.classList.toggle('is-disabled', !hasText);
    callBtn.setAttribute('aria-disabled', hasText ? 'false' : 'true');
  });
  // Autofocus so user can type right away on mobile
  setTimeout(() => issueEl.focus(), 250);
  
  modal.querySelector('.eq-call-confirm-bg').addEventListener('click', close);
  document.getElementById('eqCallCancel').addEventListener('click', close);
  callBtn.addEventListener('click', async (e) => {
    const issue = issueEl.value.trim();
    // Guard — if somehow disabled state was bypassed
    if (!issue || issue.length < 2) {
      e.preventDefault();
      issueEl.focus();
      issueEl.style.borderColor = '#e07070';
      setTimeout(() => { issueEl.style.borderColor = ''; }, 1200);
      return;
    }
    // Log to dispatch_events (structured audit trail).
    // The Postgres trigger on dispatch_events INSERT writes a rich "[SYS] 📞 call_made"
    // entry to daily_logs automatically — no direct daily_logs insert needed.
    try {
      await NX.sb.from('dispatch_events').insert({
        equipment_id: equipId,
        contractor_node_id: contractorNodeId || null,
        contractor_name: contactName,
        contractor_phone: phone,
        method: 'call',
        issue_description: issue,
        dispatched_by: NX.currentUser?.name || null,
        outcome: 'pending',
      });
    } catch (err) { console.warn('dispatch_events log failed:', err); }
    setTimeout(close, 100);
  });
}

// Shown when no phone is on file anywhere
function showNoServiceContactModal(equipId, equipName) {
  const existing = document.getElementById('eqCallConfirm');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'eqCallConfirm';
  modal.className = 'eq-call-confirm';
  modal.innerHTML = `
    <div class="eq-call-confirm-bg"></div>
    <div class="eq-call-confirm-card">
      <div class="eq-call-confirm-icon" style="filter:grayscale(0.5)">📞</div>
      <div class="eq-call-confirm-title">No service contact</div>
      <div class="eq-call-confirm-meta">${esc(equipName)} doesn't have a phone number on file. Add one in the editor to enable quick calling.</div>
      <div class="eq-call-confirm-actions">
        <button class="eq-btn eq-btn-secondary" id="eqCallCancel">Close</button>
        <button class="eq-btn eq-btn-primary" id="eqCallEdit">⚙ Open Editor</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('active'));
  
  const close = () => { modal.classList.remove('active'); setTimeout(() => modal.remove(), 200); };
  modal.querySelector('.eq-call-confirm-bg').addEventListener('click', close);
  document.getElementById('eqCallCancel').addEventListener('click', close);
  document.getElementById('eqCallEdit').addEventListener('click', () => {
    close();
    openFullEditor(equipId);
  });
}

// Pretty-format a phone number for display
function formatPhonePretty(p) {
  if (!p) return '';
  const cleaned = p.replace(/[^\d]/g, '');
  // US 10-digit: (512) 555-1234
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
  }
  // US 11-digit starting with 1: 1 (512) 555-1234
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `1 (${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7)}`;
  }
  return p; // Unknown format, return as-is
}

// Three-dot overflow menu in the equipment detail action bar.
// Hides destructive actions (currently just Delete) behind a tap to prevent
// accidental triggers. Auto-closes on outside tap.
function toggleOverflow(event, equipId) {
  event.stopPropagation();
  const menu = document.getElementById('eqOverflow-' + equipId);
  if (!menu) return;
  const isOpen = menu.classList.contains('active');
  // Close any other open overflows first
  document.querySelectorAll('.eq-overflow-menu.active').forEach(m => m.classList.remove('active'));
  if (!isOpen) {
    menu.classList.add('active');
    // Close on next outside click
    setTimeout(() => {
      document.addEventListener('click', function closeOverflow(e) {
        if (!menu.contains(e.target)) {
          menu.classList.remove('active');
          document.removeEventListener('click', closeOverflow);
        }
      }, { once: true });
    }, 0);
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   12. UI INJECTION — per-row/card Zebra print buttons
   (Was MutationObserver dance in equipment-ux.js; now called directly from renderList)
   ════════════════════════════════════════════════════════════════════════════ */

function injectRowPrintButtons() {
  const list = document.getElementById('eqList');
  if (!list) return;

  // NOTE: Despite the legacy function name, this now injects a
  // "quick status change" button on each row — admins can flip
  // equipment status (Operational / Needs Service / Down / Retired)
  // without opening the detail view. The old label-print icon was
  // moved to the full editor's Print section (still accessible via
  // Edit → Print on Zebra or Paper Sticker).
  list.querySelectorAll('.eq-row[data-eq-id]').forEach(row => {
    if (row.classList.contains('eq-row-head')) return;
    if (row.querySelector('.eq-row-status-btn')) return;
    const id = row.dataset.eqId;
    const btn = document.createElement('button');
    btn.className = 'eq-row-status-btn';
    btn.innerHTML = '⟳';
    btn.title = 'Change status';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openQuickStatusMenu(id, btn);
    });
    row.appendChild(btn);
  });

  list.querySelectorAll('.eq-card[data-eq-id]').forEach(card => {
    if (card.querySelector('.eq-card-status-btn')) return;
    const id = card.dataset.eqId;
    const btn = document.createElement('button');
    btn.className = 'eq-card-status-btn';
    btn.innerHTML = '⟳';
    btn.title = 'Change status';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openQuickStatusMenu(id, btn);
    });
    card.querySelector('.eq-card-top')?.appendChild(btn);
  });
}

/* ═══ CROSS-SYSTEM CLOSE-OUT ═══════════════════════════════════════════
   When equipment goes back to Operational, cards still open about it
   are likely resolved. Show a compact modal offering to mark them Done
   in one tap — so the user isn't left manually chasing every linked
   ticket across Equip → Board → Calendar. Cards still LIVE in the Done
   column (audit history); they just stop cluttering active workflows.
   ═══════════════════════════════════════════════════════════════════════ */
function offerCardCloseOut(cards, eq) {
  // Remove any existing offer modal
  document.querySelector('.eq-closeout-modal')?.remove();

  const bg = document.createElement('div');
  bg.className = 'eq-closeout-bg';

  const modal = document.createElement('div');
  modal.className = 'eq-closeout-modal';
  const cardCount = cards.length;
  modal.innerHTML = `
    <div class="eq-closeout-head">
      <div class="eq-closeout-icon">✓</div>
      <div>
        <h3 class="eq-closeout-title">${esc(eq?.name || 'Equipment')} is back up</h3>
        <p class="eq-closeout-sub">${cardCount} open card${cardCount === 1 ? ' is' : 's are'} linked to this equipment. Close ${cardCount === 1 ? 'it' : 'them'} out?</p>
      </div>
    </div>
    <ul class="eq-closeout-cards">
      ${cards.slice(0, 5).map(c => `<li>• ${esc(c.title || 'Untitled card')} <span class="eq-closeout-col">${esc((c.column_name || 'to_do').replace(/_/g, ' '))}</span></li>`).join('')}
      ${cards.length > 5 ? `<li class="eq-closeout-more">+ ${cards.length - 5} more</li>` : ''}
    </ul>
    <p class="eq-closeout-note">Cards will move to Done on the Board — still searchable, but out of your active views and off the calendar.</p>
    <div class="eq-closeout-actions">
      <button class="eq-closeout-btn eq-closeout-btn-secondary" data-action="skip">Keep open</button>
      <button class="eq-closeout-btn eq-closeout-btn-primary" data-action="move">
        ✓ Move ${cardCount === 1 ? 'card' : 'all ' + cardCount} to Done
      </button>
    </div>
  `;

  document.body.append(bg, modal);

  const close = () => {
    bg.remove();
    modal.remove();
  };

  bg.addEventListener('click', close);
  modal.querySelector('[data-action="skip"]').addEventListener('click', close);
  modal.querySelector('[data-action="move"]').addEventListener('click', async () => {
    try {
      const ids = cards.map(c => c.id);
      const { error } = await NX.sb.from('kanban_cards')
        .update({ column_name: 'done', status: 'closed' })
        .in('id', ids);
      if (error) throw error;
      NX.toast && NX.toast(`${ids.length} card${ids.length === 1 ? '' : 's'} moved to Done ✓`, 'success');
      // Fire a home pulse so the galaxy/home reacts visually
      if (NX.homeGalaxyPulse) try { NX.homeGalaxyPulse(); } catch (_) {}
      close();
    } catch (err) {
      console.error('[closeout] move failed:', err);
      NX.toast && NX.toast('Move failed: ' + err.message, 'error');
    }
  });
}

/* ═══ QUICK STATUS MENU ════════════════════════════════════════════════
   Tap a row's status button → popup shows all 4 status options with
   color dots. Tap one → writes to DB + reloads list. Admin-only writes
   — for non-admin users, show a toast explaining the restriction.
   Small, mobile-first, dismisses on outside tap. */
function openQuickStatusMenu(equipmentId, anchorBtn) {
  // Remove any existing menu
  document.querySelector('.eq-status-menu')?.remove();

  const isAdmin = NX.currentUser?.role === 'admin';
  if (!isAdmin) {
    NX.toast && NX.toast('Admins only. Report an issue via the detail page instead.', 'info', 3500);
    return;
  }

  const eq = equipment.find(e => e.id === equipmentId);
  const currentKey = eq?.status || 'operational';

  const menu = document.createElement('div');
  menu.className = 'eq-status-menu';
  menu.innerHTML = `
    <div class="eq-status-menu-head">Change status</div>
    ${STATUSES.map(s => `
      <button class="eq-status-menu-item ${s.key === currentKey ? 'is-current' : ''}" data-key="${s.key}">
        <span class="eq-status-menu-dot" style="background:${s.color}"></span>
        <span>${s.label}</span>
        ${s.key === currentKey ? '<span class="eq-status-menu-check">✓</span>' : ''}
      </button>
    `).join('')}
  `;
  document.body.appendChild(menu);

  // Position next to anchor button
  const rect = anchorBtn.getBoundingClientRect();
  const menuH = 200;
  const top = (rect.bottom + menuH > window.innerHeight) ? rect.top - menuH - 6 : rect.bottom + 6;
  menu.style.top = Math.max(10, top) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';

  menu.querySelectorAll('.eq-status-menu-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newKey = btn.dataset.key;
      menu.remove();
      if (newKey === currentKey) return;
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ status: newKey })
          .eq('id', equipmentId);
        if (error) throw error;
        NX.toast && NX.toast(`Status → ${STATUSES.find(s => s.key === newKey)?.label || newKey}`, 'success');
        if (eq) eq.status = newKey;  // optimistic local update
        // Sync to brain so the galaxy/AI reflects the new status
        // without waiting for next full refresh.
        if (NX.eqBrainSync?.syncOne) {
          try { await NX.eqBrainSync.syncOne(equipmentId); } catch (_) {}
        }
        buildUI();  // re-render list

        // ── CROSS-SYSTEM CLOSE-OUT ────────────────────────────────────
        // If equipment is back to Operational, any open card linked to
        // it is likely resolved. Offer to move them to Done so the user
        // doesn't have to manually close every related card.
        if (newKey === 'operational') {
          try {
            const { data: linkedCards } = await NX.sb.from('kanban_cards')
              .select('id, title, column_name, list_id')
              .eq('equipment_id', equipmentId)
              .neq('column_name', 'done')
              .or('archived.is.null,archived.eq.false');
            if (linkedCards && linkedCards.length) {
              offerCardCloseOut(linkedCards, eq);
            }
          } catch (_) { /* non-blocking */ }
        }
      } catch (err) {
        console.error('[status] update failed:', err);
        NX.toast && NX.toast('Update failed: ' + err.message, 'error');
      }
    });
  });

  // Dismiss on outside tap (delay one tick so the opening tap doesn't close it)
  setTimeout(() => {
    document.addEventListener('click', function dismiss(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', dismiss);
      }
    });
  }, 0);
}


/* ════════════════════════════════════════════════════════════════════════════
   13. UTILITIES — single canonical copies of helpers used throughout
   (Previously duplicated across 4+ files)
   ════════════════════════════════════════════════════════════════════════════ */

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function statusColor(s) { return STATUSES.find(x => x.key === s)?.color || 'var(--muted)'; }
function statusLabel(s) { return STATUSES.find(x => x.key === s)?.label || s; }
function catIcon(c)     { return CATEGORIES.find(x => x.key === c)?.icon  || '⚙'; }

function statusDot(s) {
  const dotColors = {
    operational:   'var(--green)',
    needs_service: 'var(--amber)',
    down:          'var(--red)',
    retired:       'var(--faint)',
  };
  return dotColors[s] || 'var(--muted)';
}

function relIcon(type) {
  const r = RELATIONSHIP_TYPES.find(x => x.key === type);
  return r ? r.icon : '·';
}

function relLabel(type) {
  if (!type) return '';
  const r = RELATIONSHIP_TYPES.find(x => x.key === type);
  return r ? r.label : type.replace(/_/g, ' ');
}

function attachmentIcon(a) {
  const isImage = (a.mime_type || '').startsWith('image/');
  const isPDF   = (a.mime_type || '').includes('pdf');
  return a.type === 'link'     ? '🔗'
       : a.type === 'note'     ? '📝'
       : a.type === 'receipt'  ? '🧾'
       : a.type === 'invoice'  ? '💰'
       : a.type === 'warranty' ? '🛡️'
       : a.type === 'photo'    ? '📸'
       : isImage               ? '📸'
       : isPDF                 ? '📄'
       :                         '📎';
}

function formatBytes(b) {
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
  return (b / 1048576).toFixed(1) + 'MB';
}

function methodIcon(m) {
  return { call: '📞', sms: '💬', whatsapp: '🟢', email: '✉' }[m] || '📨';
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(iso).toLocaleDateString();
}


/* ════════════════════════════════════════════════════════════════════════════
   PM LOG INLINE REVIEW — approve/reject/spam from the Timeline tab
   ════════════════════════════════════════════════════════════════════════════
   Contractor submits a PM via the public QR form → row lands in pm_logs with
   review_status='pending'. The Timeline tab surfaces pending logs for admins
   with inline action buttons so they never have to hunt for a hidden review
   dashboard.

   Approve path: updates pm_logs.review_status, inserts a matching row into
   equipment_maintenance (so the approved service appears as a "real" timeline
   event), and triggers the brain sync so the node reflects the new service
   history. Mirrors the existing updateReviewStatus() logic in
   equipment-public-pm.js — single-sourced here so the timeline flow uses the
   same code path as the standalone review dashboard.
   ════════════════════════════════════════════════════════════════════════════ */

async function approvePmLog(logId, equipmentId) {
  if (!confirm('Approve this service log? It will be added to the equipment timeline.')) return;
  try {
    // 1. Update the pm_log review status
    const reviewer = NX.currentUser?.name || 'Admin';
    const { error: upErr } = await NX.sb.from('pm_logs').update({
      review_status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer,
    }).eq('id', logId);
    if (upErr) throw upErr;

    // 2. Fetch the full row to promote it
    const { data: log, error: getErr } = await NX.sb.from('pm_logs').select('*').eq('id', logId).single();
    if (getErr) throw getErr;

    // 3. Insert matching equipment_maintenance row
    const maintDesc = log.work_performed
      + (log.parts_replaced ? '\n\nParts: ' + log.parts_replaced : '');
    const performer = log.contractor_name
      + (log.contractor_company ? ' (' + log.contractor_company + ')' : '');
    const { error: insErr } = await NX.sb.from('equipment_maintenance').insert({
      equipment_id: log.equipment_id,
      event_date: log.service_date,
      event_type: log.service_type || 'pm',
      description: maintDesc,
      performed_by: performer,
      cost: log.cost_amount,
      notes: `Submitted via QR scan${log.contractor_phone ? '. Phone: ' + log.contractor_phone : ''}.`,
      pm_log_id: log.id,
    });
    if (insErr) throw insErr;

    // 4. If this PM has a next_service_date, update equipment's next_pm_date
    if (log.next_service_date) {
      await NX.sb.from('equipment')
        .update({ next_pm_date: log.next_service_date })
        .eq('id', log.equipment_id);
    }

    // 5. Re-sync the equipment node in the knowledge graph (best effort)
    if (NX.eqBrainSync?.syncOne) {
      try { await NX.eqBrainSync.syncOne(log.equipment_id); } catch (_) {}
    }

    NX.toast?.('Service log approved ✓', 'success');
    // 6. Reload the equipment detail to reflect the change
    await openDetail(equipmentId);
  } catch (err) {
    console.error('[approvePmLog] failed:', err);
    alert('Failed to approve: ' + err.message);
  }
}

async function rejectPmLog(logId, equipmentId) {
  if (!confirm('Reject this service log? It will be hidden from the timeline.')) return;
  try {
    const { error } = await NX.sb.from('pm_logs').update({
      review_status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: NX.currentUser?.name || 'Admin',
    }).eq('id', logId);
    if (error) throw error;
    NX.toast?.('Log rejected', 'info');
    await openDetail(equipmentId);
  } catch (err) {
    console.error('[rejectPmLog] failed:', err);
    alert('Failed to reject: ' + err.message);
  }
}

async function markPmSpam(logId, equipmentId) {
  if (!confirm('Mark this log as spam? It will be hidden and the submitter flagged.')) return;
  try {
    const { error } = await NX.sb.from('pm_logs').update({
      review_status: 'spam',
      reviewed_at: new Date().toISOString(),
      reviewed_by: NX.currentUser?.name || 'Admin',
    }).eq('id', logId);
    if (error) throw error;
    NX.toast?.('Marked as spam', 'info');
    await openDetail(equipmentId);
  } catch (err) {
    console.error('[markPmSpam] failed:', err);
    alert('Failed: ' + err.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   14. EXPORT — single flat namespace, no more Object.assign ceremony
   ════════════════════════════════════════════════════════════════════════════ */

if (!NX.modules) NX.modules = {};

NX.modules.equipment = {
  // Lifecycle
  init,
  show: buildUI,
  add: () => openEditModal(null),
  edit: openFullEditor,           // The canonical "edit" is the full 6-tab editor

  // List/detail
  openDetail,
  closeDetail,
  loadEquipment,
  buildUI,
  getFiltered,
  reportIssue,       // Creates a board card prefilled with this equipment

  // Add/edit modal (simple form)
  closeEdit,
  deleteEquipment,
  duplicateEquipment,
  closeDupe,

  // Service log + parts
  logService,
  closeService,
  deleteMaintenance,
  approvePmLog,
  rejectPmLog,
  markPmSpam,
  addPart,
  addPartFromUrl,
  editPart,
  deletePart,
  closePart,

  // Manual
  removeManual,
  uploadManual,
  autoFetchManual,

  // AI intelligence
  scanDataPlate,
  detectPatterns,
  analyzeCost,
  renderIntelligenceTab,
  scanFleet,
  suggestPMDate,
  applyPredictivePM,
  extractBOMFromManual,
  exportPartsCart,
  checkWarranties,

  // AI create
  openAICreator,
  openDescribeDialog,
  photoIdentify,
  bulkIdentify,
  createFromDescription,

  // Full editor + attachments
  openFullEditor,
  closeFullEdit,
  addAttachment,
  deleteAttachment,
  editAttachmentDesc,
  uploadPhoto,
  replacePhoto,
  removePhoto,
  deleteCustomField,

  // Printing
  generateZPL,
  generateZPLBatch,
  openZebraPrintDialog,
  printZebraSingle,
  printZebraBatch,
  quickPrint,
  printSingleQR,
  openStickerExport,
  closeStickerExport,
  printStickers,
  copyQRLink,

  // Public scan (pre-auth)
  renderPublicScanView,
  publicReportIssue,

  // Lineage
  loadFamily,
  pickParent,
  pickChild,
  unsetParent,

  // Dispatch
  openDispatchSheet,
  loadContractors,
  cycleDispatchOutcome,
  dispatchFromTicket,
  callService,
  lookupServicePhoneFromNode,
  toggleOverflow,
  enhancePartsList,
  enhanceManualPanel,
};

console.log('[Equipment] unified module loaded — ' + Object.keys(NX.modules.equipment).length + ' exports');

})();


/* ═══════════════════════════════════════════════════════════════════════════
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   CONSOLIDATED MODULES — formerly separate files
 *
 *   The following sections were previously loaded as standalone scripts after
 *   equipment.js. They've been folded in here for a single source of truth.
 *
 *   Original load order (preserved):
 *     1. equipment-ai.js          — Phase 2 AI features (data plate, manual fetch)
 *     2. equipment-brain-sync.js  — auto-sync equipment ↔ nodes table
 *     3. equipment-badge-choice.js — Zebra/Paper print picker on row badges
 *
 *   NOT consolidated (stays separate):
 *     • equipment-context-menu.js — also loaded by log view standalone
 *     • equipment-cleanup.js      — DELETED, its job is no longer needed
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment Phase 2 — AI Layer
   - Data plate scanner (Claude Vision → auto-populate)
   - Manual PDF upload to Supabase Storage
   - Web auto-fetch manuals from manufacturer
   - Pattern-based failure prediction
   - Cost intelligence (replace vs. repair analysis)
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

if (!NX.modules || !NX.modules.equipment) {
  console.error('[EquipmentAI] Base equipment module not loaded');
  return;
}

const EQ = NX.modules.equipment;

/* ═══════════════════════════════════════════════════════════════════════
   DATA PLATE SCANNER
   User snaps photo of equipment's data plate → Claude Vision extracts
   manufacturer, model, serial, specs → auto-populates form
   ═══════════════════════════════════════════════════════════════════════ */

async function scanDataPlate(existingId) {
  // Use universal file picker — shows 3-option popup (Take Photo / Library / Files)
  let file = null;
  if (NX.filePicker) {
    const files = await NX.filePicker.pick({
      accept: 'image/*',
      multiple: false,
      title: 'Scan data plate'
    });
    if (!files || !files.length) return;
    file = files[0];
  } else {
    // Legacy fallback
    file = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = e => resolve(e.target.files[0] || null);
      input.click();
    });
    if (!file) return;
  }

  await processDataPlateFile(file, existingId);
}

async function processDataPlateFile(file, existingId) {
    NX.toast && NX.toast('Reading data plate…', 'info', 8000);

    try {
      // Convert to base64
      const base64 = await fileToBase64(file);
      const mimeType = file.type;

      // Upload the photo itself to storage for the data_plate_url
      let dataPlateUrl = null;
      try {
        const fname = `data-plate-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
        const { data: upload } = await NX.sb.storage
          .from('equipment-photos')
          .upload(fname, file, { upsert: false, contentType: file.type });
        if (upload) {
          const { data: { publicUrl } } = NX.sb.storage
            .from('equipment-photos')
            .getPublicUrl(fname);
          dataPlateUrl = publicUrl;
        }
      } catch(e) { console.warn('[DataPlate] Upload skipped:', e.message); }

      // Ask Claude to extract structured data
      const prompt = `You are reading a commercial kitchen or HVAC equipment data plate.
Extract ONLY what you can clearly see. Return raw JSON, no markdown:
{
  "manufacturer": "...",
  "model": "...",
  "serial_number": "...",
  "year_manufactured": null or YYYY,
  "specs": {
    "voltage": null or "115V" etc,
    "amperage": null or "10A",
    "hz": null or 60,
    "phase": null or "1" or "3",
    "refrigerant_type": null or "R-290",
    "refrigerant_amount": null or "3.5 oz",
    "btu": null or number,
    "capacity": null or "12 cu ft",
    "max_pressure_psi": null or number,
    "wattage": null or "1500W",
    "gas_type": null or "NG" or "LP"
  },
  "likely_category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
  "confidence": "high | medium | low"
}
Decode year from serial if manufacturer uses a known format (e.g. Hoshizaki: 3rd-4th chars = year).
Return null for any field not clearly visible. Do NOT guess.`;

      const answer = await NX.askClaudeVision(prompt, base64, mimeType);

      // Parse JSON robustly
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response');
      const extracted = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      // If updating existing equipment, merge and save
      if (existingId) {
        const updates = {};
        if (extracted.manufacturer) updates.manufacturer = extracted.manufacturer;
        if (extracted.model) updates.model = extracted.model;
        if (extracted.serial_number) updates.serial_number = extracted.serial_number;
        if (extracted.specs && Object.keys(extracted.specs).length) {
          // Merge specs — filter nulls
          const clean = {};
          for (const [k, v] of Object.entries(extracted.specs)) {
            if (v != null && v !== '') clean[k] = v;
          }
          if (Object.keys(clean).length) updates.specs = clean;
        }
        if (dataPlateUrl) updates.data_plate_url = dataPlateUrl;

        await NX.sb.from('equipment').update(updates).eq('id', existingId);
        NX.toast && NX.toast(`✓ Extracted: ${extracted.manufacturer || ''} ${extracted.model || ''}`, 'success');
        if (NX.syslog) NX.syslog('equipment_scanned', `${extracted.manufacturer} ${extracted.model}`);
        EQ.closeDetail();
        await EQ.loadEquipment();
        EQ.openDetail(existingId);
      } else {
        // New equipment — open add modal pre-populated
        openPrepopulatedAddModal(extracted, dataPlateUrl);
      }
    } catch (err) {
      console.error('[DataPlate] Extraction failed:', err);
      NX.toast && NX.toast('Could not read plate — try better lighting/angle', 'error', 5000);
    }
}

function openPrepopulatedAddModal(data, dataPlateUrl) {
  const modal = document.getElementById('eqPrepopModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqPrepopModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const catGuess = data.likely_category || 'other';
  const specsStr = data.specs ? JSON.stringify(data.specs, null, 2) : '{}';

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqPrepopModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqPrepopModal').classList.remove('active')">✕</button>
        <h2>✨ Scanned — Confirm Details</h2>
      </div>
      <div class="eq-detail-body">
        ${dataPlateUrl ? `<img src="${dataPlateUrl}" class="eq-detail-photo" style="max-height:150px">` : ''}
        <div class="eq-scan-conf">Confidence: <b>${data.confidence || 'medium'}</b></div>
        <form class="eq-form" id="eqPrepopForm">
          <div class="eq-form-group">
            <label>Name * (you name it)</label>
            <input name="name" required placeholder="e.g. Walk-In Cooler Kitchen">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Location *</label>
              <select name="location" required>
                <option value="Suerte">Suerte</option>
                <option value="Este">Este</option>
                <option value="Bar Toti">Bar Toti</option>
              </select>
            </div>
            <div class="eq-form-group">
              <label>Category</label>
              <select name="category">
                <option value="refrigeration" ${catGuess==='refrigeration'?'selected':''}>❄ Refrigeration</option>
                <option value="cooking" ${catGuess==='cooking'?'selected':''}>🔥 Cooking</option>
                <option value="ice" ${catGuess==='ice'?'selected':''}>🧊 Ice</option>
                <option value="hvac" ${catGuess==='hvac'?'selected':''}>💨 HVAC</option>
                <option value="dish" ${catGuess==='dish'?'selected':''}>🧼 Dishwashing</option>
                <option value="bev" ${catGuess==='bev'?'selected':''}>🥤 Beverage</option>
                <option value="smallware" ${catGuess==='smallware'?'selected':''}>🍴 Smallware</option>
                <option value="other" ${catGuess==='other'?'selected':''}>⚙ Other</option>
              </select>
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Manufacturer (from plate)</label>
              <input name="manufacturer" value="${escAttr(data.manufacturer||'')}">
            </div>
            <div class="eq-form-group">
              <label>Model (from plate)</label>
              <input name="model" value="${escAttr(data.model||'')}">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Serial Number (from plate)</label>
            <input name="serial_number" value="${escAttr(data.serial_number||'')}">
          </div>
          ${data.year_manufactured ? `
          <div class="eq-form-group">
            <label>Install Date (year extracted: ${data.year_manufactured})</label>
            <input type="date" name="install_date" value="${data.year_manufactured}-01-01">
          </div>` : ''}
          <div class="eq-form-group">
            <label>Extracted Specs (auto-filled, edit if needed)</label>
            <textarea name="_specs_json" rows="5" style="font-family:monospace;font-size:12px">${escHTML(specsStr)}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqPrepopModal').classList.remove('active')">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">Create Equipment</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqPrepopForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null && !k.startsWith('_')) payload[k] = v;
    }
    // Parse specs
    try {
      const specsJson = fd.get('_specs_json');
      if (specsJson) payload.specs = JSON.parse(specsJson);
    } catch(e) { console.warn('Invalid specs JSON, skipping'); }
    if (dataPlateUrl) payload.data_plate_url = dataPlateUrl;

    try {
      const { data: created, error } = await NX.sb.from('equipment').insert(payload).select().single();
      if (error) throw error;
      NX.toast && NX.toast('Equipment created ✓', 'success');
      if (NX.syslog) NX.syslog('equipment_scanned_created', created.name);
      modal.classList.remove('active');
      await EQ.loadEquipment();
      EQ.openDetail(created.id);

      // Auto-trigger manual fetch in background
      if (created.manufacturer && created.model) {
        setTimeout(() => autoFetchManual(created.id), 500);
      }
    } catch (err) {
      console.error('[DataPlate] Create failed:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MANUAL PDF UPLOAD
   Upload to Supabase Storage bucket 'equipment-manuals'
   Save URL to equipment.manual_url
   ═══════════════════════════════════════════════════════════════════════ */

async function uploadManual(equipId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      NX.toast && NX.toast('PDF too large (max 50MB)', 'error');
      return;
    }

    NX.toast && NX.toast('Uploading manual…', 'info', 5000);

    try {
      const fname = `${equipId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
      const { error } = await NX.sb.storage
        .from('equipment-manuals')
        .upload(fname, file, { upsert: false, contentType: 'application/pdf' });
      if (error) throw error;

      const { data: { publicUrl } } = NX.sb.storage
        .from('equipment-manuals')
        .getPublicUrl(fname);

      await NX.sb.from('equipment').update({ manual_url: publicUrl }).eq('id', equipId);

      NX.toast && NX.toast('Manual uploaded ✓', 'success');
      if (NX.syslog) NX.syslog('manual_uploaded', `equipment ${equipId}`);
      await EQ.loadEquipment();
      EQ.openDetail(equipId);
    } catch (err) {
      console.error('[Manual] Upload failed:', err);
      NX.toast && NX.toast('Upload failed: ' + err.message, 'error');
    }
  });

  input.click();
}

/* ═══════════════════════════════════════════════════════════════════════
   WEB AUTO-FETCH MANUAL
   Given manufacturer + model, search the web for official manual PDF
   Store the source URL (fetching and hosting the PDF requires CORS proxy)
   ═══════════════════════════════════════════════════════════════════════ */

async function autoFetchManual(equipId) {
  const eq = (await NX.sb.from('equipment').select('*').eq('id', equipId).single()).data;
  if (!eq) return;
  if (!eq.manufacturer || !eq.model) {
    NX.toast && NX.toast('Add manufacturer and model first', 'info');
    return;
  }

  NX.toast && NX.toast(`Searching web for ${eq.manufacturer} ${eq.model} manual…`, 'info', 6000);

  try {
    const prompt = `Find the official service/owner manual PDF URL for this commercial kitchen equipment:
Manufacturer: ${eq.manufacturer}
Model: ${eq.model}

Prefer in this order:
1. Manufacturer's official website (e.g. hoshizakiamerica.com, vulcanequipment.com)
2. partstown.com resource center
3. manualslib.com

Return raw JSON, no markdown:
{
  "manual_url": "direct PDF URL or webpage containing manual",
  "source": "manufacturer | partstown | manualslib | other",
  "confidence": "high | medium | low",
  "notes": "brief note about what was found"
}
If nothing found, return {"manual_url": null, "source": null, "confidence": "low", "notes": "..."}`;

    const answer = await NX.askClaude(prompt, [{ role: 'user', content: 'Search now.' }], 800, true);

    const jsonStart = answer.indexOf('{');
    const jsonEnd = answer.lastIndexOf('}');
    if (jsonStart === -1) throw new Error('No JSON found');
    const result = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

    if (result.manual_url) {
      await NX.sb.from('equipment').update({
        manual_source_url: result.manual_url
      }).eq('id', equipId);

      NX.toast && NX.toast(`Found manual (${result.confidence} confidence) — saved link`, 'success', 5000);
      await EQ.loadEquipment();
      EQ.openDetail(equipId);
    } else {
      NX.toast && NX.toast(`No manual found. Try uploading a PDF directly.`, 'info', 5000);
    }
  } catch (err) {
    console.error('[Manual] Auto-fetch failed:', err);
    NX.toast && NX.toast('Search failed — try uploading manually', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   FAILURE PATTERN DETECTION
   Analyzes repair history for pattern (e.g. "compressor every 4 months")
   Runs for all equipment — returns predictions for morning brief
   ═══════════════════════════════════════════════════════════════════════ */

async function detectPatterns(equipId) {
  const { data: maint } = await NX.sb.from('equipment_maintenance')
    .select('*')
    .eq('equipment_id', equipId)
    .eq('event_type', 'repair')
    .order('event_date', { ascending: true });

  if (!maint || maint.length < 2) {
    return { hasPattern: false, reason: 'Not enough history (need 2+ repairs)' };
  }

  // Calculate intervals between repairs (in days)
  const intervals = [];
  for (let i = 1; i < maint.length; i++) {
    const a = new Date(maint[i - 1].event_date);
    const b = new Date(maint[i].event_date);
    intervals.push(Math.round((b - a) / 86400000));
  }

  const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;
  const variance = intervals.reduce((s, d) => s + Math.pow(d - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const relStdDev = stdDev / avgInterval; // lower = more regular pattern

  const lastRepair = new Date(maint[maint.length - 1].event_date);
  const daysSinceLastRepair = Math.round((new Date() - lastRepair) / 86400000);

  // Extract common symptom keywords
  const allSymptoms = maint.map(m => (m.symptoms || m.description || '').toLowerCase()).join(' ');
  const keywords = ['compressor', 'fan', 'thermostat', 'refrigerant', 'drain', 'seal', 'gasket', 'motor', 'valve', 'pilot', 'igniter'];
  const topSymptom = keywords.find(k => (allSymptoms.match(new RegExp(k, 'g')) || []).length >= 2);

  // Strong pattern: stddev is < 40% of mean AND we have 3+ data points
  const hasPattern = relStdDev < 0.4 && maint.length >= 3;
  const predictedDate = new Date(lastRepair.getTime() + avgInterval * 86400000);
  const daysUntilPredicted = Math.round((predictedDate - new Date()) / 86400000);

  return {
    hasPattern,
    totalRepairs: maint.length,
    avgInterval: Math.round(avgInterval),
    relStdDev: relStdDev.toFixed(2),
    daysSinceLastRepair,
    daysUntilPredicted,
    predictedDate: predictedDate.toISOString().slice(0, 10),
    topSymptom,
    alertLevel: daysUntilPredicted <= 14 && hasPattern ? 'urgent' :
                daysUntilPredicted <= 30 && hasPattern ? 'warning' : 'none'
  };
}

async function renderIntelligenceTab(equipId) {
  const eq = NX._equipmentCache?.find(e => e.id === equipId) ||
             (await NX.sb.from('equipment_with_stats').select('*').eq('id', equipId).single()).data;
  if (!eq) return '<div class="eq-empty-small">Not found</div>';

  const pattern = await detectPatterns(equipId);
  const costAnalysis = analyzeCost(eq);

  let html = '<div class="eq-ai-panel">';

  // Pattern prediction
  html += '<div class="eq-ai-card"><h4>🔮 Failure Pattern Analysis</h4>';
  if (pattern.hasPattern) {
    const color = pattern.alertLevel === 'urgent' ? 'var(--red)' : pattern.alertLevel === 'warning' ? 'var(--amber)' : 'var(--green)';
    html += `
      <div class="eq-ai-alert" style="border-color:${color}">
        <div class="eq-ai-big" style="color:${color}">
          ${pattern.daysUntilPredicted < 0
            ? `⚠ Overdue by ${-pattern.daysUntilPredicted} days`
            : pattern.daysUntilPredicted <= 14
            ? `⚠ Service needed in ~${pattern.daysUntilPredicted} days`
            : `${pattern.daysUntilPredicted} days until predicted service`}
        </div>
        <div class="eq-ai-detail">
          Based on ${pattern.totalRepairs} past repairs averaging every ${pattern.avgInterval} days.
          ${pattern.topSymptom ? `<br><b>Common issue:</b> ${pattern.topSymptom}` : ''}
          <br>Last repair: ${pattern.daysSinceLastRepair} days ago
          <br>Predicted next: ${new Date(pattern.predictedDate).toLocaleDateString()}
        </div>
      </div>`;
  } else {
    html += `<div class="eq-ai-neutral">${pattern.reason || `Need more repair history to detect patterns (${pattern.totalRepairs || 0} recorded).`}</div>`;
  }
  html += '</div>';

  // Cost analysis
  html += '<div class="eq-ai-card"><h4>💰 Cost Intelligence</h4>';
  if (costAnalysis.recommendation === 'replace') {
    html += `
      <div class="eq-ai-alert" style="border-color:var(--red)">
        <div class="eq-ai-big" style="color:var(--red)">🔄 Consider Replacement</div>
        <div class="eq-ai-detail">
          Total repairs last 12mo: <b>$${costAnalysis.yearlyCost.toLocaleString()}</b><br>
          ${costAnalysis.projectedNextYear ? `Projected next year: <b>$${costAnalysis.projectedNextYear.toLocaleString()}</b><br>` : ''}
          ${eq.purchase_price ? `Original cost: $${Math.round(eq.purchase_price).toLocaleString()}<br>` : ''}
          <i>${costAnalysis.reasoning}</i>
        </div>
      </div>`;
  } else if (costAnalysis.recommendation === 'monitor') {
    html += `
      <div class="eq-ai-alert" style="border-color:var(--amber)">
        <div class="eq-ai-big" style="color:var(--amber)">⚠ Monitor Costs</div>
        <div class="eq-ai-detail">
          YTD repair cost: <b>$${costAnalysis.yearlyCost.toLocaleString()}</b><br>
          <i>${costAnalysis.reasoning}</i>
        </div>
      </div>`;
  } else {
    html += `
      <div class="eq-ai-neutral">
        YTD repair cost: $${costAnalysis.yearlyCost.toLocaleString()}<br>
        <i>${costAnalysis.reasoning}</i>
      </div>`;
  }
  html += '</div>';

  // Actions
  html += `
    <div class="eq-ai-actions">
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.scanDataPlate('${equipId}')">📷 Re-scan Data Plate</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.autoFetchManual('${equipId}')">🌐 Find Manual Online</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.uploadManual('${equipId}')">📄 Upload Manual PDF</button>
    </div>
  `;

  html += '</div>';
  return html;
}

function analyzeCost(eq) {
  const yearlyCost = parseFloat(eq.cost_this_year) || 0;
  const purchasePrice = parseFloat(eq.purchase_price) || 0;
  const servicesThisYear = eq.services_this_year || 0;

  // Simple heuristic: if yearly repair cost > 40% of purchase price → replace
  if (purchasePrice > 0 && yearlyCost > purchasePrice * 0.4) {
    return {
      yearlyCost,
      projectedNextYear: Math.round(yearlyCost * 1.3), // 30% escalation
      recommendation: 'replace',
      reasoning: `Repairs (${Math.round(yearlyCost / purchasePrice * 100)}% of purchase price) exceed the 40% replacement threshold. A new unit likely pays back within a year.`
    };
  }

  // Monitor if 3+ services in a year
  if (servicesThisYear >= 3) {
    return {
      yearlyCost,
      recommendation: 'monitor',
      reasoning: `${servicesThisYear} services this year suggests increasing failure rate. Watch for escalation.`
    };
  }

  return {
    yearlyCost,
    recommendation: 'healthy',
    reasoning: servicesThisYear === 0
      ? 'No repairs this year — running well.'
      : `Only ${servicesThisYear} service${servicesThisYear>1?'s':''} this year — normal maintenance profile.`
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   FLEET-WIDE PATTERN SCAN (for morning brief)
   Runs across all equipment, returns prediction summary
   ═══════════════════════════════════════════════════════════════════════ */

async function scanFleet() {
  const { data: allEq } = await NX.sb.from('equipment').select('id, name, location')
    .not('status', 'eq', 'retired');
  if (!allEq || !allEq.length) return [];

  const urgent = [];
  for (const eq of allEq) {
    const p = await detectPatterns(eq.id);
    if (p.hasPattern && p.alertLevel !== 'none') {
      urgent.push({
        id: eq.id,
        name: eq.name,
        location: eq.location,
        days: p.daysUntilPredicted,
        level: p.alertLevel,
        symptom: p.topSymptom
      });
    }
  }
  return urgent.sort((a, b) => a.days - b.days);
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escHTML(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════════
   EXTEND EXISTING EQUIPMENT MODULE
   ═══════════════════════════════════════════════════════════════════════ */

Object.assign(NX.modules.equipment, {
  scanDataPlate,
  uploadManual,
  autoFetchManual,
  detectPatterns,
  renderIntelligenceTab,
  scanFleet,
  analyzeCost,
  // Expose for external loading
  loadEquipment: NX.modules.equipment.loadEquipment || (async () => {
    const { data } = await NX.sb.from('equipment_with_stats').select('*');
    NX._equipmentCache = data || [];
  })
});

// Inject "Intelligence" tab and data plate scan button into existing detail modal
// by hooking into modal creation
const _origOpenDetail = NX.modules.equipment.openDetail;
NX.modules.equipment.openDetail = async function(id) {
  await _origOpenDetail(id);

  // Add Intelligence tab after render
  setTimeout(() => {
    const modal = document.getElementById('eqModal');
    if (!modal) return;

    const tabs = modal.querySelector('.eq-detail-tabs');
    const body = modal.querySelector('.eq-detail-body');
    if (!tabs || !body) return;

    // Skip if already added
    if (tabs.querySelector('[data-tab="intel"]')) return;

    // Add Intelligence tab button
    const intelTab = document.createElement('button');
    intelTab.className = 'eq-tab';
    intelTab.dataset.tab = 'intel';
    intelTab.innerHTML = '🧠 AI';
    tabs.appendChild(intelTab);

    // Add Intelligence panel
    const intelPanel = document.createElement('div');
    intelPanel.className = 'eq-tab-panel';
    intelPanel.dataset.panel = 'intel';
    intelPanel.innerHTML = '<div class="eq-empty-small">Loading intelligence…</div>';
    body.appendChild(intelPanel);

    // Wire click
    intelTab.addEventListener('click', async () => {
      modal.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-tab-panel').forEach(p => p.classList.remove('active'));
      intelTab.classList.add('active');
      intelPanel.classList.add('active');
      intelPanel.innerHTML = await renderIntelligenceTab(id);
    });

    // Upgrade Manual tab with real upload + auto-fetch buttons
    const manualPanel = modal.querySelector('[data-panel="manual"]');
    if (manualPanel && !manualPanel.dataset.upgraded) {
      manualPanel.dataset.upgraded = '1';
      // Add upload/fetch buttons (works whether manual exists or not)
      const uploadBtn = document.createElement('div');
      uploadBtn.className = 'eq-manual-upgrade';
      uploadBtn.innerHTML = `
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadManual('${id}')">📄 Upload PDF</button>
          <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.autoFetchManual('${id}')">🌐 Find Online</button>
        </div>`;
      manualPanel.appendChild(uploadBtn);
    }

    // Add "Scan Data Plate" button to Overview tab
    const overviewPanel = modal.querySelector('[data-panel="overview"]');
    if (overviewPanel && !overviewPanel.dataset.upgraded) {
      overviewPanel.dataset.upgraded = '1';
      const scanBtn = document.createElement('button');
      scanBtn.className = 'eq-btn eq-btn-secondary';
      scanBtn.style.marginTop = '16px';
      scanBtn.innerHTML = '📷 Scan Data Plate (auto-fill)';
      scanBtn.addEventListener('click', () => scanDataPlate(id));
      overviewPanel.appendChild(scanBtn);
    }
  }, 50);
};

// Also add "Scan Data Plate" as an alternative to + Add Equipment
// by injecting after the add button is rendered
const _origBuildUI = NX.modules.equipment.buildUI;
if (_origBuildUI) {
  NX.modules.equipment.buildUI = function() {
    _origBuildUI();
    injectScanButton();
  };
}

function injectScanButton() {
  const actions = document.querySelector('.eq-actions');
  if (!actions || actions.querySelector('.eq-scan-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'eq-btn eq-btn-secondary eq-scan-btn';
  btn.innerHTML = '📷 Scan Plate';
  btn.title = 'Scan equipment data plate with camera';
  btn.addEventListener('click', () => scanDataPlate(null));
  actions.insertBefore(btn, actions.firstChild);
}

// On init, inject the scan button once everything is ready
setTimeout(injectScanButton, 500);

console.log('[EquipmentAI] Phase 2 loaded');

})();


/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Equipment ↔ Brain Sync v1
   
   Auto-syncs equipment rows into the nodes table as category='equipment'
   so the brain/galaxy renders them as nebulae and the AI can query them.
   
   Sync rules:
     - On equipment list load → upsert each non-deleted equipment as a node
     - On equipment edit/save → re-sync that one row
     - On part add/edit/delete → re-sync the parent equipment node
     - On dispatch event → re-sync (status note)
     - On maintenance log → re-sync (last service date)
     - On soft delete → soft-delete the matching node
     - On soft restore → restore the node
   
   Node structure for equipment:
     name = equipment.name
     category = 'equipment'
     notes = rich summary string with all key facts (model, location, 
             status, parts count, last service, contractor info, etc.)
             AI search reads notes — this is where the queryable text lives
     tags = [location, equipment_category, status, manufacturer]
     links = [related_node_ids]  (contractors, parts vendors)
     source_emails = []
     access_count = updated to current time
     
   Node ID strategy:
     We use a deterministic node ID derived from equipment.id so re-syncs
     UPSERT cleanly without duplicates. Format: 'eq:<equipment_id>'
     This requires nodes.id to be text. If it's bigint, we use a separate
     equipment_node_id column on equipment to track the link.
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
    () => NX && NX.modules && NX.modules.equipment && NX.sb,
    () => init()
  );

  let nodesIdType = null;  // Detected at runtime: 'text', 'bigint', 'uuid'

  async function init() {
    console.log('[eq-brain-sync] initializing equipment→brain sync');
    await detectNodesIdType();
    patchSyncHooks();
    // Initial bulk sync after a moment so equipment data is loaded
    setTimeout(syncAllEquipment, 1500);
  }

  async function detectNodesIdType() {
    // Sniff a node to determine the id column type
    try {
      const { data } = await NX.sb.from('nodes').select('id').limit(1).single();
      if (data && data.id != null) {
        const v = data.id;
        if (typeof v === 'number') nodesIdType = 'bigint';
        else if (typeof v === 'string' && /^[0-9a-f]{8}-/i.test(v)) nodesIdType = 'uuid';
        else nodesIdType = 'text';
      } else {
        nodesIdType = 'bigint';  // safe default
      }
      console.log('[eq-brain-sync] detected nodes.id type:', nodesIdType);
    } catch (e) {
      nodesIdType = 'bigint';
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     BUILD NODE PAYLOAD from equipment row
     ═════════════════════════════════════════════════════════════════════════ */

  function buildNodePayload(eq, parts, recentMaint, recentDispatches) {
    parts = parts || [];
    recentMaint = recentMaint || [];
    recentDispatches = recentDispatches || [];
    
    // Build a rich, AI-searchable notes string. Format is plain natural language
    // so embeddings/search work well.
    const lines = [];
    lines.push(`${eq.name || 'Equipment'} — ${eq.category || 'uncategorized'}`);
    if (eq.location || eq.area) {
      lines.push(`Location: ${eq.location || ''}${eq.area ? ' · ' + eq.area : ''}`);
    }
    if (eq.manufacturer || eq.model) {
      lines.push(`Make/Model: ${eq.manufacturer || ''} ${eq.model || ''}`.trim());
    }
    if (eq.serial_number) lines.push(`Serial: ${eq.serial_number}`);
    if (eq.status) lines.push(`Status: ${eq.status}`);
    if (eq.health_score != null) lines.push(`Health: ${eq.health_score}%`);
    if (eq.install_date) lines.push(`Installed: ${eq.install_date}`);
    if (eq.warranty_until) lines.push(`Warranty until: ${eq.warranty_until}`);
    if (eq.purchase_price) lines.push(`Cost: $${eq.purchase_price}`);
    if (eq.next_pm_date) lines.push(`Next PM: ${eq.next_pm_date}`);
    if (eq.notes) lines.push(`Notes: ${eq.notes}`);
    
    // Service contractor info
    if (eq.service_contractor_name) {
      lines.push(`Service contractor: ${eq.service_contractor_name}${eq.service_contractor_phone ? ' (' + eq.service_contractor_phone + ')' : ''}`);
    }
    if (eq.backup_contractor_name) {
      lines.push(`Backup contractor: ${eq.backup_contractor_name}${eq.backup_contractor_phone ? ' (' + eq.backup_contractor_phone + ')' : ''}`);
    }
    
    // Parts catalog
    if (parts.length) {
      lines.push(`Parts catalog (${parts.length}):`);
      parts.slice(0, 20).forEach(p => {
        const vendorCount = Array.isArray(p.vendors) ? p.vendors.length : 0;
        const vendorStr = vendorCount > 0 
          ? ` — ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`
          : (p.supplier ? ` — ${p.supplier}` : '');
        lines.push(`  • ${p.part_name}${p.oem_part_number ? ' (OEM: ' + p.oem_part_number + ')' : ''}${vendorStr}`);
      });
      if (parts.length > 20) lines.push(`  …and ${parts.length - 20} more parts`);
    }
    
    // Recent maintenance
    if (recentMaint.length) {
      lines.push(`Recent service:`);
      recentMaint.slice(0, 5).forEach(m => {
        const dateStr = m.event_date ? new Date(m.event_date).toLocaleDateString() : '';
        lines.push(`  • ${dateStr} — ${m.event_type || 'service'}${m.notes ? ': ' + m.notes : ''}`);
      });
    }
    
    // Recent dispatches
    if (recentDispatches.length) {
      lines.push(`Recent dispatches:`);
      recentDispatches.slice(0, 5).forEach(d => {
        const dateStr = d.dispatched_at ? new Date(d.dispatched_at).toLocaleDateString() : '';
        lines.push(`  • ${dateStr} — called ${d.contractor_name || 'contractor'}${d.issue_description ? ' for: ' + d.issue_description : ''}`);
      });
    }
    
    // Manual link
    if (eq.manual_url) lines.push(`Manual: ${eq.manual_url}`);

    // Tags = filterable / facetable terms
    const tags = ['equipment'];
    if (eq.location) tags.push(eq.location);
    if (eq.category) tags.push(eq.category);
    if (eq.status) tags.push(eq.status);
    if (eq.manufacturer) tags.push(eq.manufacturer);

    return {
      name: eq.name || 'Unnamed equipment',
      category: 'equipment',
      notes: lines.join('\n'),
      tags,
      links: [],
      source_emails: [],
      access_count: Date.now()
    };
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SYNC ONE equipment row → its corresponding node
     Uses the equipment_node_id column on equipment (added by SQL migration)
     to track which node represents which equipment.
     ═════════════════════════════════════════════════════════════════════════ */

  async function syncOneEquipment(equipId) {
    try {
      // Load full equipment + parts + recent events
      const [{ data: eq }, { data: parts }, { data: maint }, { data: dispatches }] = await Promise.all([
        NX.sb.from('equipment').select('*').eq('id', equipId).single(),
        NX.sb.from('equipment_parts').select('*').eq('equipment_id', equipId).eq('is_deleted', false).order('part_name'),
        NX.sb.from('equipment_maintenance').select('*').eq('equipment_id', equipId).order('event_date', { ascending: false }).limit(5),
        NX.sb.from('dispatch_events').select('*').eq('equipment_id', equipId).order('dispatched_at', { ascending: false }).limit(5)
      ]);

      if (!eq) return;
      
      // Soft-deleted equipment? Soft-delete the matching node too
      if (eq.is_deleted) {
        if (eq.equipment_node_id) {
          await NX.sb.from('nodes').update({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: 'auto-sync',
            deleted_reason: 'parent equipment was deleted'
          }).eq('id', eq.equipment_node_id);
        }
        return;
      }
      
      const payload = buildNodePayload(eq, parts, maint, dispatches);
      
      if (eq.equipment_node_id) {
        // Update existing node — also restore if it was soft-deleted
        const { error } = await NX.sb.from('nodes').update({
          ...payload,
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          deleted_reason: null
        }).eq('id', eq.equipment_node_id);
        if (error) {
          // Node probably got hard-deleted — create a new one
          console.warn('[eq-brain-sync] update failed, creating new node:', error.message);
          await createNewNodeForEquipment(eq, payload);
        }
      } else {
        // No linked node — create one
        await createNewNodeForEquipment(eq, payload);
      }
    } catch (e) {
      console.warn('[eq-brain-sync] sync failed for', equipId, e);
    }
  }

  async function createNewNodeForEquipment(eq, payload) {
    try {
      const { data, error } = await NX.sb.from('nodes').insert(payload).select().single();
      if (error) throw error;
      // Link the new node ID back to the equipment
      await NX.sb.from('equipment').update({ equipment_node_id: data.id }).eq('id', eq.id);
      // Add to local NX.nodes cache so galaxy picks it up
      if (NX.nodes && Array.isArray(NX.nodes)) NX.nodes.push(data);
    } catch (e) {
      console.warn('[eq-brain-sync] create node failed:', e);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     BULK SYNC — runs once after equipment view loads. Catches any equipment
     that doesn't have a linked node yet and creates them.
     ═════════════════════════════════════════════════════════════════════════ */

  async function syncAllEquipment() {
    try {
      const { data: allEq } = await NX.sb.from('equipment')
        .select('id, equipment_node_id, is_deleted')
        .eq('is_deleted', false);
      if (!allEq?.length) return;
      
      // Only sync the ones missing a node link OR that haven't been synced recently
      const needsSync = allEq.filter(e => !e.equipment_node_id);
      if (!needsSync.length) {
        console.log('[eq-brain-sync] all equipment already synced');
        return;
      }
      
      console.log(`[eq-brain-sync] bulk syncing ${needsSync.length} equipment to brain…`);
      // Sync in parallel batches of 5 to avoid hammering Supabase
      for (let i = 0; i < needsSync.length; i += 5) {
        const batch = needsSync.slice(i, i + 5);
        await Promise.all(batch.map(e => syncOneEquipment(e.id)));
      }
      console.log('[eq-brain-sync] bulk sync done');
    } catch (e) {
      console.warn('[eq-brain-sync] bulk sync error:', e);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PATCH HOOKS — re-sync the relevant equipment whenever data changes
     ═════════════════════════════════════════════════════════════════════════ */

  function patchSyncHooks() {
    const EQ = NX.modules.equipment;
    if (!EQ) return;

    // Wrap saveEquipment / updateEquipment if they exist
    ['saveEquipment', 'updateEquipment', 'edit'].forEach(fn => {
      if (typeof EQ[fn] === 'function') {
        const orig = EQ[fn];
        EQ[fn] = async function(...args) {
          const result = await orig.apply(this, args);
          // First arg is usually the equipment ID
          const id = typeof args[0] === 'string' ? args[0] : args[0]?.id;
          if (id) setTimeout(() => syncOneEquipment(id), 500);
          return result;
        };
      }
    });

    // Wrap addPart/editPart/deletePart — re-sync parent equipment
    ['addPart', 'editPart', 'savePart'].forEach(fn => {
      if (typeof EQ[fn] === 'function') {
        const orig = EQ[fn];
        EQ[fn] = async function(...args) {
          const result = await orig.apply(this, args);
          // Try to extract the equipId from the most-recently-opened detail
          const equipId = NX.currentEquipId || EQ.currentEquipId;
          if (equipId) setTimeout(() => syncOneEquipment(equipId), 500);
          return result;
        };
      }
    });

    // Wrap dispatch logging via the eq-fixes openDispatchModal
    if (EQ.dispatch) {
      const orig = EQ.dispatch;
      EQ.dispatch = async function(equipId) {
        const result = await orig.call(this, equipId);
        if (equipId) setTimeout(() => syncOneEquipment(equipId), 1500);
        return result;
      };
    }

    // Wrap logService
    if (typeof EQ.logService === 'function') {
      const orig = EQ.logService;
      EQ.logService = async function(equipId, ...rest) {
        const result = await orig.call(this, equipId, ...rest);
        if (equipId) setTimeout(() => syncOneEquipment(equipId), 1000);
        return result;
      };
    }
    
    console.log('[eq-brain-sync] hooks patched');
  }

  // Expose for manual sync from console / AI tools
  NX.eqBrainSync = {
    syncOne: syncOneEquipment,
    syncAll: syncAllEquipment,
    buildNodePayload
  };

})();


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
