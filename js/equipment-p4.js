/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment Phase 4 — Lineage & Dispatch
   ─────────────────────────────────────────────────────────────────────
   GENEALOGY
   • parent/child equipment relationships (hood → makeup air, etc.)
   • Family tree rendered in overview tab
   • Pick parent / pick children modals
   • DB-side cycle prevention (trigger in EQUIPMENT-PHASE4.sql)

   DISPATCH
   • One-tap "📞 Dispatch" button on every equipment detail
   • Pulls contractors from the nodes graph (category=contractor)
   • Pre-fills message with equipment + ticket context
   • Opens device's native handler (tel:/sms:/mailto:/whatsapp://)
   • Logs every contact to dispatch_log with outcome tracking
   • Shows recent dispatch chips + preferred contractor ★

   Loads after equipment-full-editor.js. Extends NX.modules.equipment via
   Object.assign + hooks openDetail to inject family + dispatch UI.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

if (!NX.modules || !NX.modules.equipment) {
  console.warn('[EquipmentP4] Base equipment module not loaded, retrying…');
  return setTimeout(arguments.callee, 500);
}

const EQ = NX.modules.equipment;

/* ═══════════════════════════════════════════════════════════════════════
   GENEALOGY
   ═══════════════════════════════════════════════════════════════════════ */

// Suggested relationship types (free-text in DB; these are just chips)
const RELATIONSHIP_TYPES = [
  { key: 'depends_on',     label: 'Depends on',     icon: '⬆' },
  { key: 'serves',         label: 'Serves',         icon: '⬇' },
  { key: 'connected_to',   label: 'Connected to',   icon: '⇄' },
  { key: 'feeds',          label: 'Feeds',          icon: '→' },
  { key: 'pairs_with',     label: 'Pairs with',     icon: '⇋' },
  { key: 'shares_circuit', label: 'Shares circuit', icon: '⚡' },
];

const STATUS_COLORS = {
  operational:   'var(--green)',
  needs_service: 'var(--amber)',
  down:          'var(--red)',
  retired:       'var(--faint)',
};

const CATEGORY_ICONS = {
  refrigeration: '❄', cooking: '🔥', ice: '🧊', hvac: '💨',
  dish: '🧼', bev: '🥤', smallware: '🍴', furniture: '🪑',
};

function catIcon(c)   { return CATEGORY_ICONS[c] || '⚙'; }
function statusDot(s) { return STATUS_COLORS[s] || 'var(--muted)'; }

async function loadFamily(equipId) {
  // Uses the get_family_tree() SQL function for one-shot ancestor+descendant load.
  // Falls back to two queries if RPC isn't available (e.g. during a partial migration).
  try {
    const { data, error } = await NX.sb.rpc('get_family_tree', { eq_id: equipId });
    if (!error && data) return data;
  } catch (e) { /* fall through */ }

  // Fallback: load self, parent, and direct children (no recursion)
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

function relIcon(type) {
  const r = RELATIONSHIP_TYPES.find(x => x.key === type);
  return r ? r.icon : '·';
}
function relLabel(type) {
  if (!type) return '';
  const r = RELATIONSHIP_TYPES.find(x => x.key === type);
  return r ? r.label : type.replace(/_/g, ' ');
}

function renderFamilyTree(family, selfId) {
  if (!family.length) {
    return `<div class="eq-family-empty">No relationships yet.</div>`;
  }
  return `<div class="eq-family-tree">${
    family.map(node => {
      const isSelf = node.id === selfId;
      const indent = '·'.repeat(Math.abs(node.depth) + 1);
      const handler = isSelf ? '' :
        `onclick="NX.modules.equipment.openDetail('${node.id}')"`;
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
  // Append a Family section to the overview panel (idempotent — won't double-render).
  const modal = document.getElementById('eqModal');
  if (!modal) return;
  const overviewPanel = modal.querySelector('[data-panel="overview"]');
  if (!overviewPanel || overviewPanel.dataset.familyRendered === '1') return;
  overviewPanel.dataset.familyRendered = '1';

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

/* ─── PICKERS ─── */

async function pickParent(equipId) {
  await openEquipmentPicker({
    title: '👪 Set parent equipment',
    excludeId: equipId,           // can't pick self
    excludeDescendantsOf: equipId, // can't pick own descendants (would create cycle)
    showRelationship: true,
    onPick: async (parentId, relationshipType) => {
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ parent_equipment_id: parentId, relationship_type: relationshipType })
          .eq('id', equipId);
        if (error) throw error;
        if (NX.toast) NX.toast('Parent set ✓', 'success');
        // Refresh detail
        const sec = document.getElementById('eqFamilySection');
        if (sec) sec.remove();
        const overviewPanel = document.querySelector('#eqModal [data-panel="overview"]');
        if (overviewPanel) overviewPanel.dataset.familyRendered = '0';
        renderFamilySection(equipId);
      } catch (e) {
        // The trigger throws on cycle attempts — show a clean message.
        const msg = String(e.message || e).includes('cycle')
          ? 'That would create a loop in the family tree.'
          : 'Could not set parent: ' + (e.message || e);
        if (NX.toast) NX.toast(msg, 'error');
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
        if (NX.toast) NX.toast('Child added ✓', 'success');
        const sec = document.getElementById('eqFamilySection');
        if (sec) sec.remove();
        const overviewPanel = document.querySelector('#eqModal [data-panel="overview"]');
        if (overviewPanel) overviewPanel.dataset.familyRendered = '0';
        renderFamilySection(equipId);
      } catch (e) {
        const msg = String(e.message || e).includes('cycle')
          ? 'That would create a loop in the family tree.'
          : 'Could not add child: ' + (e.message || e);
        if (NX.toast) NX.toast(msg, 'error');
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
    if (NX.toast) NX.toast('Failed: ' + error.message, 'error');
    return;
  }
  if (NX.toast) NX.toast('Parent removed', 'info');
  const sec = document.getElementById('eqFamilySection');
  if (sec) sec.remove();
  const overviewPanel = document.querySelector('#eqModal [data-panel="overview"]');
  if (overviewPanel) overviewPanel.dataset.familyRendered = '0';
  renderFamilySection(equipId);
}

/**
 * Generic equipment picker modal.
 * opts: {
 *   title, excludeId, excludeAncestorsOf, excludeDescendantsOf,
 *   showRelationship: bool, onPick: (id, relType) => void
 * }
 */
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
    // Walk descendants in memory using the candidates list.
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

  // Build modal
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
    if (!matches.length) {
      return `<div class="eq-picker-empty">No equipment matches.</div>`;
    }
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
  if (isFreshPicker) {
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

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
      el.addEventListener('click', () => {
        close();
        opts.onPick(el.dataset.id, selectedRel);
      });
    });
  }
  wireItems();
}


/* ═══════════════════════════════════════════════════════════════════════
   DISPATCH
   ═══════════════════════════════════════════════════════════════════════ */

// Pull phone/email out of free-text node notes (best-effort regex).
// Most contractors are ingested as nodes with phone/email buried in notes.
function extractContact(node) {
  const text = (node.notes || '') + '\n' + JSON.stringify(node.tags || []) + '\n' + (node.name || '');
  // E.164 + common US formats. Captures: (555) 555-5555, 555-555-5555, +15555555555
  const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  // Also check if phone/email are stored in a structured `links` JSONB field
  const links = node.links || {};
  return {
    phone: links.phone || (phoneMatch ? phoneMatch[0].trim() : ''),
    email: links.email || (emailMatch ? emailMatch[0].trim() : ''),
  };
}

function normalizePhone(p) {
  if (!p) return '';
  // Strip everything except digits and leading +
  const cleaned = p.replace(/[^\d+]/g, '');
  // Add US country code if it's 10 digits and no +
  if (cleaned.length === 10 && !cleaned.startsWith('+')) return '+1' + cleaned;
  return cleaned;
}

async function loadContractors() {
  // Contractors are nodes — by category, tag, or explicit role.
  // Query is permissive: any node tagged or categorized as contractor/vendor/service.
  // NX.nodes is already loaded into memory, so prefer that — but fall back to DB.
  let pool = NX.nodes || [];
  if (!pool.length) {
    const { data } = await NX.sb.from('nodes').select('*').limit(2000);
    pool = data || [];
  }

  const isContractor = n => {
    const cat = (n.category || '').toLowerCase();
    if (cat === 'contractor' || cat === 'vendor' || cat === 'service') return true;
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

  // Fetch most recent open ticket for context (if any)
  let ticket = null;
  try {
    const { data: tickets } = await NX.sb.from('tickets')
      .select('id, title, body, status, created_at')
      .eq('equipment_id', equipId)
      .neq('status', 'closed')
      .neq('status', 'resolved')
      .order('created_at', { ascending: false })
      .limit(1);
    if (tickets?.length) ticket = tickets[0];
  } catch (e) { /* tickets may not have equipment_id column — ok */ }

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
  // Default template — user can edit before sending
  const restaurant = eq.location || '';
  const area = eq.area ? ` (${eq.area})` : '';
  const equipName = eq.name;
  const issue = ticket?.title || ticket?.body || '';
  const who = userName || 'NEXUS';
  const greeting = (contact.name || '').split(' ')[0] || 'there';

  let body = `Hi ${greeting}, this is ${who} at ${restaurant}.\n\n`;
  body += `We need service on: ${equipName}${area}\n`;
  if (eq.manufacturer || eq.model) {
    body += `Unit: ${[eq.manufacturer, eq.model].filter(Boolean).join(' ')}\n`;
  }
  if (eq.serial_number) body += `Serial: ${eq.serial_number}\n`;
  if (issue) body += `\nIssue: ${issue}\n`;
  body += `\nWhen can you take a look? Thanks.`;
  return body;
}

/**
 * Open the dispatch sheet — three stages in one drawer:
 *   1. Pick contractor
 *   2. Pick method (call/sms/email/whatsapp)
 *   3. Compose + send (opens native handler, logs)
 */
async function openDispatchSheet(equipId, ticketId) {
  const ctx = await loadEquipmentForDispatch(equipId);
  if (!ctx) {
    if (NX.toast) NX.toast('Equipment not found', 'error');
    return;
  }
  const { eq, ticket } = ctx;
  const contractors = await loadContractors();

  // If ticketId was passed explicitly, prefer it over auto-detected
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

  let stage = 'contact';   // contact | method | compose
  let selectedContact = null;
  let selectedMethod = null;
  let composedMessage = '';

  const close = () => { overlay.classList.remove('active'); overlay.innerHTML = ''; };

  // Bind close-on-backdrop ONCE per overlay lifetime (not per render)
  if (isFreshOverlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

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
    // Sort: preferred first, then alpha
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
      // Click an existing contact
      overlay.querySelectorAll('.dispatch-contact').forEach(el => {
        el.addEventListener('click', () => {
          selectedContact = contractors.find(c => c.id === el.dataset.id);
          if (!selectedContact) return;
          stage = 'method';
          render();
        });
      });
      // Add a new contact inline
      const addBtn = document.getElementById('dispatchAddBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const name = document.getElementById('dispatchAddName').value.trim();
          if (!name) { if (NX.toast) NX.toast('Name required', 'error'); return; }
          const phone = document.getElementById('dispatchAddPhone').value.trim();
          const email = document.getElementById('dispatchAddEmail').value.trim();
          // Create a node so it persists for next time
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
          if (NX.toast) NX.toast('Contact saved ✓', 'success');
          render(); // re-render method stage so buttons enable
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
    owner_id: null,         // shared
    access_count: 0,
  };
  try {
    const { data, error } = await NX.sb.from('nodes').insert(newNode).select().single();
    if (error) throw error;
    // Update in-memory cache so the rest of the app sees it
    if (NX.nodes) NX.nodes.push(data);
    if (NX.allNodes) NX.allNodes.push(data);
    return data;
  } catch (e) {
    console.warn('[Dispatch] Could not persist contractor node:', e);
    // Return ephemeral object so dispatch can still proceed
    return { id: 'ephemeral_' + Date.now(), ...newNode };
  }
}

async function saveContactToNode(nodeId, phone, email) {
  // Fetch existing first so we don't clobber other links/notes
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
  // Update in-memory
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

  // Build the URI for the device's native handler
  if (method === 'call' && phone) {
    url = `tel:${phone}`;
  } else if (method === 'sms' && phone) {
    // iOS uses ?body=, Android accepts both ? and &; we use ? for max compatibility
    url = `sms:${phone}?body=${encodeURIComponent(message)}`;
  } else if (method === 'whatsapp' && phone) {
    // wa.me strips the + automatically
    const waNum = phone.replace(/^\+/, '');
    url = `https://wa.me/${waNum}?text=${encodeURIComponent(message)}`;
  } else if (method === 'email' && email) {
    const subject = `Service request — ${contact.name ? '' : ''}NEXUS`;
    url = `mailto:${email}?subject=${encodeURIComponent('Service request — NEXUS')}&body=${encodeURIComponent(message)}`;
  }

  if (url) {
    try {
      // Use a temp anchor so target=_blank works on iOS without popup blockers
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
      // Fall back to window.open
      try { window.open(url, '_blank'); opened = true; } catch {}
    }
  }

  // Always log the attempt — even if the handler failed, the user may have called manually
  await logDispatch({
    equipment_id: equipId,
    contractor_node_id: contact.id?.startsWith?.('ephemeral_') ? null : contact.id,
    contractor_name: contact.name,
    contractor_phone: phone || null,
    contractor_email: email || null,
    method,
    ticket_id: ticketId || null,
    message,
    dispatched_by: NX.currentUser?.name || null,
    outcome: 'pending',
  });

  // Increment node access_count (signal of importance for galaxy sizing)
  if (NX.trackAccess && contact.id && !String(contact.id).startsWith('ephemeral_')) {
    NX.trackAccess([contact.id]);
  }

  // Record an action_chains entry for the morning brief / weekly reflection
  try {
    await NX.sb.from('action_chains').insert({
      trigger_text: `Dispatched ${contact.name} via ${method}`,
      actions: [{ type: 'dispatch', equipment_id: equipId, contractor_node_id: contact.id, method }],
      user_name: NX.currentUser?.name,
    });
  } catch (e) { /* action_chains table may not exist on older deploys — non-fatal */ }

  if (NX.toast) {
    NX.toast(opened ? `Opened ${method} to ${contact.name} ✓` : `Logged ${method} attempt`, 'success');
  }

  // Refresh dispatch chips on the open detail view (if any)
  refreshDispatchChips(equipId);
}

async function logDispatch(record) {
  try {
    const { error } = await NX.sb.from('dispatch_log').insert(record);
    if (error) throw error;
  } catch (e) {
    console.warn('[Dispatch] Could not log to DB:', e);
    // Queue offline if we have OfflineQueue
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


/* ─── Dispatch chips + button on detail view ─── */

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
  // Tap the outcome chip to advance it through the cycle
  const { data } = await NX.sb.from('dispatch_log').select('outcome').eq('id', dispatchId).single();
  const cur = data?.outcome || 'pending';
  const idx = OUTCOME_CYCLE.indexOf(cur);
  const next = OUTCOME_CYCLE[(idx + 1) % OUTCOME_CYCLE.length];
  await setOutcome(dispatchId, next);
  if (NX.toast) NX.toast(`Marked: ${next}`, 'info');
  refreshDispatchChips(equipId);
}


/* ─── Inject Dispatch button into detail actions ─── */

function injectDispatchButton(equipId) {
  const modal = document.getElementById('eqModal');
  if (!modal) return;
  const actions = modal.querySelector('.eq-detail-actions');
  if (!actions || actions.querySelector('.eq-dispatch-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'eq-btn eq-dispatch-btn';
  btn.innerHTML = '📞 Dispatch';
  btn.addEventListener('click', () => openDispatchSheet(equipId));
  actions.insertBefore(btn, actions.firstChild);
}


/* ═══════════════════════════════════════════════════════════════════════
   HOOK INTO openDetail
   Each prior phase wraps openDetail and re-exports it. We do the same so
   that Family + Dispatch UI appears reliably whenever a detail opens.
   ═══════════════════════════════════════════════════════════════════════ */

const _origOpenDetail = EQ.openDetail;
EQ.openDetail = async function(id) {
  await _origOpenDetail(id);
  // Wait a beat for prior hooks (full editor enhanceOverview) to run first
  setTimeout(() => {
    renderFamilySection(id);
    refreshDispatchChips(id);
    injectDispatchButton(id);
  }, 250);
};


/* ═══════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════ */

Object.assign(NX.modules.equipment, {
  // Genealogy
  loadFamily,
  pickParent,
  pickChild,
  unsetParent,
  // Dispatch
  openDispatchSheet,
  loadContractors,
  cycleDispatchOutcome,
  // Allow other modules to dispatch from a ticket
  dispatchFromTicket: (equipId, ticketId) => openDispatchSheet(equipId, ticketId),
});


/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES (matching style of other phase modules)
   ═══════════════════════════════════════════════════════════════════════ */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

console.log('[EquipmentP4] Lineage & Dispatch loaded');

})();
