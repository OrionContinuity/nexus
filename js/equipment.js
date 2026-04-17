/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment Management v1 — Phase 1 MVP
   - Full CRUD for equipment, parts, maintenance
   - QR generation + scan handler + printable sheets
   - Public read-only view (scan without login)
   - List + grid views, location filters, search
   - Integration with nodes graph
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

let equipment = [];
let activeFilter = { location: 'all', status: 'all', category: 'all' };
let viewMode = 'list'; // list | grid
let currentEquipId = null; // currently open equipment detail
let searchQuery = '';

const LOCATIONS = ['Suerte', 'Este', 'Bar Toti'];
const CATEGORIES = [
  { key: 'refrigeration', label: 'Refrigeration', icon: '❄' },
  { key: 'cooking', label: 'Cooking', icon: '🔥' },
  { key: 'ice', label: 'Ice', icon: '🧊' },
  { key: 'hvac', label: 'HVAC', icon: '💨' },
  { key: 'dish', label: 'Dishwashing', icon: '🧼' },
  { key: 'bev', label: 'Beverage', icon: '🥤' },
  { key: 'smallware', label: 'Smallware', icon: '🍴' },
  { key: 'furniture', label: 'Furniture', icon: '🪑' },
  { key: 'other', label: 'Other', icon: '⚙' }
];
const STATUSES = [
  { key: 'operational', label: 'Operational', color: 'var(--green)' },
  { key: 'needs_service', label: 'Needs Service', color: 'var(--amber)' },
  { key: 'down', label: 'Down', color: 'var(--red)' },
  { key: 'retired', label: 'Retired', color: 'var(--muted)' }
];

/* ═══ INIT ═══ */
async function init() {
  // Check for QR scan on load (?equip=eq_xxxxx)
  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');

  await loadEquipment();
  buildUI();

  if (equipParam) {
    const eq = equipment.find(e => e.qr_code === equipParam);
    if (eq) {
      // Navigate to equipment tab, open detail
      document.querySelector('.nav-tab[data-view="equipment"]')?.click();
      document.querySelector('.bnav-btn[data-view="equipment"]')?.click();
      setTimeout(() => openDetail(eq.id), 300);
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('equip');
      window.history.replaceState({}, '', url);
    }
  }
}

/* ═══ LOAD ═══ */
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

/* ═══ UI SKELETON ═══ */
function buildUI() {
  const view = document.getElementById('equipmentView');
  if (!view) return;

  view.innerHTML = `
    <div class="eq-header">
      <div class="eq-title-row">
        <h2 class="eq-title">🔧 Equipment</h2>
        <div class="eq-actions">
          <button class="eq-btn eq-btn-secondary" id="eqPrintQRs" title="Print QR sticker sheet">🖨 QR Sheet</button>
          <button class="eq-btn eq-btn-primary" id="eqAddBtn">+ Add Equipment</button>
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
      </div>

      <div class="eq-stats" id="eqStats"></div>
    </div>

    <div class="eq-list" id="eqList"></div>
  `;

  // Wire events
  document.getElementById('eqAddBtn').addEventListener('click', () => openEditModal(null));
  document.getElementById('eqPrintQRs').addEventListener('click', printQRSheet);
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
      const f = chip.dataset.filter;
      const v = chip.dataset.value;
      activeFilter[f] = v;
      buildUI();
    });
  });

  renderList();
  renderStats();
}

/* ═══ STATS BAR ═══ */
function renderStats() {
  const el = document.getElementById('eqStats');
  if (!el) return;
  const filtered = getFiltered();
  const down = filtered.filter(e => e.status === 'down').length;
  const needs = filtered.filter(e => e.status === 'needs_service').length;
  const pmDue = filtered.filter(e => e.next_pm_date && new Date(e.next_pm_date) <= new Date(Date.now() + 14*86400000)).length;
  const totalCost = filtered.reduce((s, e) => s + (parseFloat(e.cost_this_year) || 0), 0);

  el.innerHTML = `
    <div class="eq-stat"><span class="eq-stat-v">${filtered.length}</span><span class="eq-stat-l">Units</span></div>
    ${down ? `<div class="eq-stat eq-stat-red"><span class="eq-stat-v">${down}</span><span class="eq-stat-l">Down</span></div>` : ''}
    ${needs ? `<div class="eq-stat eq-stat-amber"><span class="eq-stat-v">${needs}</span><span class="eq-stat-l">Needs Service</span></div>` : ''}
    ${pmDue ? `<div class="eq-stat eq-stat-blue"><span class="eq-stat-v">${pmDue}</span><span class="eq-stat-l">PM Due (14d)</span></div>` : ''}
    ${totalCost > 0 ? `<div class="eq-stat"><span class="eq-stat-v">$${Math.round(totalCost).toLocaleString()}</span><span class="eq-stat-l">YTD Repairs</span></div>` : ''}
  `;
}

/* ═══ FILTERING ═══ */
function getFiltered() {
  return equipment.filter(e => {
    if (activeFilter.location !== 'all' && e.location !== activeFilter.location) return false;
    if (activeFilter.status !== 'all' && e.status !== activeFilter.status) return false;
    if (activeFilter.category !== 'all' && e.category !== activeFilter.category) return false;
    if (searchQuery) {
      const hay = [e.name, e.model, e.serial_number, e.manufacturer, e.area, e.notes].join(' ').toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });
}

/* ═══ LIST/GRID RENDER ═══ */
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
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.add()">+ Add Equipment</button>
      </div>`;
    return;
  }

  list.className = 'eq-list eq-list-' + viewMode;

  if (viewMode === 'grid') {
    list.innerHTML = filtered.map(e => buildGridCard(e)).join('');
  } else {
    list.innerHTML = `
      <div class="eq-table">
        <div class="eq-row eq-row-head">
          <div class="eq-col eq-col-name">Equipment</div>
          <div class="eq-col eq-col-loc">Location</div>
          <div class="eq-col eq-col-status">Status</div>
          <div class="eq-col eq-col-pm">Next PM</div>
          <div class="eq-col eq-col-services">Services</div>
        </div>
        ${filtered.map(e => buildListRow(e)).join('')}
      </div>`;
  }

  list.querySelectorAll('[data-eq-id]').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.eqId));
  });
}

function statusColor(s) { return STATUSES.find(x=>x.key===s)?.color || 'var(--muted)'; }
function statusLabel(s) { return STATUSES.find(x=>x.key===s)?.label || s; }
function catIcon(c) { return CATEGORIES.find(x=>x.key===c)?.icon || '⚙'; }

function buildListRow(e) {
  const pm = e.next_pm_date ? new Date(e.next_pm_date) : null;
  const pmOverdue = pm && pm < new Date();
  const pmSoon = pm && pm < new Date(Date.now() + 14*86400000);
  const pmStr = pm ? pm.toLocaleDateString([], { month:'short', day:'numeric' }) : '—';

  return `
    <div class="eq-row" data-eq-id="${e.id}">
      <div class="eq-col eq-col-name">
        <span class="eq-cat-icon">${catIcon(e.category)}</span>
        <div>
          <div class="eq-name">${esc(e.name)}</div>
          <div class="eq-sub">${esc(e.manufacturer || '')} ${esc(e.model || '')}</div>
        </div>
      </div>
      <div class="eq-col eq-col-loc">${esc(e.location)}${e.area ? ' · ' + esc(e.area) : ''}</div>
      <div class="eq-col eq-col-status">
        <span class="eq-status-dot" style="background:${statusColor(e.status)}"></span>
        ${statusLabel(e.status)}
      </div>
      <div class="eq-col eq-col-pm ${pmOverdue?'eq-overdue':pmSoon?'eq-soon':''}">${pmStr}</div>
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

/* ═══ DETAIL VIEW ═══ */
async function openDetail(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  currentEquipId = id;

  // Load parts and maintenance in parallel
  const [partsRes, maintRes] = await Promise.all([
    NX.sb.from('equipment_parts').select('*').eq('equipment_id', id).order('assembly_path'),
    NX.sb.from('equipment_maintenance').select('*').eq('equipment_id', id).order('event_date', { ascending: false })
  ]);
  const parts = partsRes.data || [];
  const maintenance = maintRes.data || [];

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

      <div class="eq-detail-tabs">
        <button class="eq-tab active" data-tab="overview">Overview</button>
        <button class="eq-tab" data-tab="timeline">Timeline (${maintenance.length})</button>
        <button class="eq-tab" data-tab="parts">Parts (${parts.length})</button>
        <button class="eq-tab" data-tab="manual">Manual</button>
        <button class="eq-tab" data-tab="qr">QR</button>
      </div>

      <div class="eq-detail-body">
        <div class="eq-tab-panel active" data-panel="overview">${renderOverview(eq)}</div>
        <div class="eq-tab-panel" data-panel="timeline">${renderTimeline(eq, maintenance)}</div>
        <div class="eq-tab-panel" data-panel="parts">${renderParts(eq, parts)}</div>
        <div class="eq-tab-panel" data-panel="manual">${renderManual(eq)}</div>
        <div class="eq-tab-panel" data-panel="qr">${renderQR(eq)}</div>
      </div>

      <div class="eq-detail-actions">
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.edit('${eq.id}')">✎ Edit</button>
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.logService('${eq.id}')">+ Log Service</button>
        <button class="eq-btn eq-btn-danger" onclick="NX.modules.equipment.deleteEquipment('${eq.id}')">🗑 Delete</button>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Wire tab switching
  modal.querySelectorAll('.eq-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // Wire QR download
  const qrImg = modal.querySelector('.eq-qr-img');
  if (qrImg) generateQRImage(eq.qr_code, qrImg);
}

function renderOverview(eq) {
  const specs = eq.specs || {};
  const specKeys = Object.keys(specs).filter(k => specs[k]);
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
  `;
}

function renderTimeline(eq, maint) {
  if (!maint.length) {
    return `<div class="eq-empty-small">No service history yet.<br>
      <button class="eq-btn eq-btn-primary eq-mt" onclick="NX.modules.equipment.logService('${eq.id}')">+ Log First Service</button></div>`;
  }
  return `
    <div class="eq-timeline">
      ${maint.map(m => `
        <div class="eq-timeline-item">
          <div class="eq-timeline-date">${new Date(m.event_date).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})}</div>
          <div class="eq-timeline-body">
            <div class="eq-timeline-type eq-type-${m.event_type}">${m.event_type.toUpperCase()}</div>
            <div class="eq-timeline-desc">${esc(m.description)}</div>
            ${m.performed_by ? `<div class="eq-timeline-who">👤 ${esc(m.performed_by)}</div>` : ''}
            ${m.cost ? `<div class="eq-timeline-cost">💰 $${parseFloat(m.cost).toLocaleString()}</div>` : ''}
            ${m.downtime_hours ? `<div class="eq-timeline-dt">⏱ ${m.downtime_hours}h downtime</div>` : ''}
            ${m.symptoms ? `<div class="eq-timeline-detail"><b>Symptoms:</b> ${esc(m.symptoms)}</div>` : ''}
            ${m.root_cause ? `<div class="eq-timeline-detail"><b>Root cause:</b> ${esc(m.root_cause)}</div>` : ''}
          </div>
          <button class="eq-timeline-del" onclick="NX.modules.equipment.deleteMaintenance('${m.id}', '${eq.id}')" title="Delete">✕</button>
        </div>
      `).join('')}
    </div>`;
}

function renderParts(eq, parts) {
  return `
    <div class="eq-parts-head">
      <h4>Bill of Materials</h4>
      <button class="eq-btn eq-btn-small eq-btn-primary" onclick="NX.modules.equipment.addPart('${eq.id}')">+ Add Part</button>
    </div>
    ${!parts.length ? '<div class="eq-empty-small">No parts cataloged yet.</div>' : `
      <div class="eq-parts-list">
        ${parts.map(p => `
          <div class="eq-part">
            <div class="eq-part-main">
              <div class="eq-part-name">${esc(p.part_name)}</div>
              <div class="eq-part-sub">
                ${p.oem_part_number ? `OEM: ${esc(p.oem_part_number)}` : ''}
                ${p.supplier ? ` · ${esc(p.supplier)}` : ''}
                ${p.last_price ? ` · $${parseFloat(p.last_price).toFixed(2)}` : ''}
                ${p.quantity > 1 ? ` · Qty: ${p.quantity}` : ''}
              </div>
              ${p.assembly_path ? `<div class="eq-part-path">${esc(p.assembly_path)}</div>` : ''}
            </div>
            <div class="eq-part-actions">
              ${p.supplier_url ? `<a href="${p.supplier_url}" target="_blank" class="eq-btn eq-btn-tiny">Order</a>` : ''}
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
    <div class="eq-manual">
      ${eq.manual_url ? `
        <iframe src="${eq.manual_url}" class="eq-manual-iframe"></iframe>
        <div class="eq-manual-actions">
          <a href="${eq.manual_url}" target="_blank" class="eq-btn eq-btn-secondary">Open in new tab</a>
          <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.removeManual('${eq.id}')">Remove</button>
        </div>
      ` : `
        <div class="eq-empty-small">
          <p>No manual uploaded.</p>
          <input type="file" id="eqManualUpload" accept="application/pdf" style="display:none">
          <button class="eq-btn eq-btn-primary" onclick="document.getElementById('eqManualUpload').click()">📄 Upload PDF</button>
          ${eq.manual_source_url ? `<p class="eq-mt"><a href="${eq.manual_source_url}" target="_blank">Original source</a></p>` : ''}
        </div>
      `}
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
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.printSingleQR('${eq.id}')">🖨 Print Sticker</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.copyQRLink('${eq.qr_code}')">Copy Link</button>
      </div>
    </div>`;
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

/* ═══ ADD/EDIT EQUIPMENT ═══ */
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
    // Numeric coercion
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
        if (NX.syslog) NX.syslog('equipment_created', created.name);
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

/* ═══ DELETE EQUIPMENT ═══ */
async function deleteEquipment(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  if (!confirm(`Delete "${eq.name}"? This will also delete all parts and service history. Cannot be undone.`)) return;
  try {
    const { error } = await NX.sb.from('equipment').delete().eq('id', id);
    if (error) throw error;
    NX.toast && NX.toast('Deleted ✓', 'success');
    if (NX.syslog) NX.syslog('equipment_deleted', eq.name);
    closeDetail();
    await loadEquipment();
    renderList();
  } catch (err) {
    console.error('[Equipment] Delete error:', err);
    NX.toast && NX.toast('Delete failed: ' + err.message, 'error');
  }
}

/* ═══ LOG SERVICE ═══ */
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

      // Update equipment next_pm_date if provided
      if (data.next_pm_due) {
        await NX.sb.from('equipment').update({ next_pm_date: data.next_pm_due }).eq('id', equipId);
      }

      // Recompute health score
      try { await NX.sb.rpc('recompute_health_score', { eq_id: equipId }); } catch(e){}

      NX.toast && NX.toast('Service logged ✓', 'success');
      if (NX.syslog) NX.syslog('equipment_service', `${eq.name}: ${data.description.slice(0, 60)}`);

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

/* ═══ PARTS ═══ */
function addPart(equipId) {
  openPartModal(null, equipId);
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

/* ═══ QR CODE GENERATION ═══
   Uses the qrcode.js library already loaded in NEXUS */
function generateQRImage(qrCode, canvas) {
  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${qrCode}`;
  if (typeof QRCode !== 'undefined') {
    // qrcode.js renders to a DOM element; we'll use the canvas API version
    try {
      if (typeof QRious !== 'undefined') {
        new QRious({ element: canvas, value: scanURL, size: 220, foreground: '#000', background: '#fff', level: 'H' });
      } else {
        // Fallback using qrcode-generator approach
        drawQRFallback(canvas, scanURL);
      }
    } catch(e) { drawQRFallback(canvas, scanURL); }
  } else {
    drawQRFallback(canvas, scanURL);
  }
}

function drawQRFallback(canvas, text) {
  // Use a public QR generator image as fallback
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

/* ═══ QR STICKER PRINT ═══ */
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

function printQRSheet() {
  const filtered = getFiltered();
  if (!filtered.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }

  const stickers = filtered.map(eq => {
    const url = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
    const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    return `
      <div class="sticker">
        <h3>${esc(eq.name)}</h3>
        <div class="loc">${esc(eq.location)}${eq.area?' · '+esc(eq.area):''}</div>
        <img src="${qrImgSrc}" alt="QR">
        <div class="model">${esc(eq.manufacturer||'')} ${esc(eq.model||'')}</div>
      </div>`;
  }).join('');

  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html><html><head><title>NEXUS Equipment QR Sheet</title>
    <style>
      @page { size: letter; margin: 10mm; }
      body{font-family:sans-serif;margin:0;padding:0}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}
      .sticker{border:1.5px solid #000;padding:5mm;text-align:center;break-inside:avoid;page-break-inside:avoid}
      h3{font-size:11pt;margin:0 0 2mm 0}
      .loc{font-size:9pt;color:#555;margin-bottom:2mm}
      .model{font-size:7pt;color:#666;margin-top:2mm}
      img{width:35mm;height:35mm}
    </style></head><body>
    <div class="grid">${stickers}</div>
    <script>setTimeout(()=>window.print(),1000)</script>
    </body></html>
  `);
  w.document.close();
}

/* ═══ MANUAL UPLOAD/REMOVE ═══ */
async function removeManual(id) {
  if (!confirm('Remove manual from this equipment?')) return;
  await NX.sb.from('equipment').update({ manual_url: null }).eq('id', id);
  NX.toast && NX.toast('Manual removed', 'success');
  await loadEquipment();
  openDetail(id);
}

/* ═══ UTILITIES ═══ */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═══ EXPORT ═══ */
NX.modules = NX.modules || {};
NX.modules.equipment = {
  init,
  show: () => { loadEquipment().then(renderList); },
  add: () => openEditModal(null),
  edit: openEditModal,
  closeEdit,
  closeDetail,
  closeService,
  closePart,
  deleteEquipment,
  deleteMaintenance,
  logService,
  addPart,
  editPart,
  deletePart,
  printSingleQR,
  copyQRLink,
  removeManual,
  openDetail
};

})();
