/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment Complete Editor v1
   - Every single field editable (specs, photo, tags, custom fields, etc)
   - Attachments: photos, PDFs, receipts, invoices, warranties, anything
   - Custom fields (add any key/value you want)
   - Clickable external links (manufacturer site, manual URL, video, etc)
   - Inline editing from the detail view — no separate modal needed
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

if (!NX.modules || !NX.modules.equipment) {
  console.warn('[EquipFull] Base not loaded, retrying…');
  return setTimeout(arguments.callee, 500);
}

const EQ = NX.modules.equipment;

/* ═══════════════════════════════════════════════════════════════════════
   COMPREHENSIVE EDIT MODAL — literally every field
   ═══════════════════════════════════════════════════════════════════════ */

async function openFullEditor(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq) return;

  // Load attachments and custom fields
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

        <!-- BASIC -->
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
                  <option ${eq.location==='Suerte'?'selected':''}>Suerte</option>
                  <option ${eq.location==='Este'?'selected':''}>Este</option>
                  <option ${eq.location==='Bar Toti'?'selected':''}>Bar Toti</option>
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
                  ${['refrigeration','cooking','ice','hvac','dish','bev','smallware','furniture','other'].map(c=>
                    `<option value="${c}" ${eq.category===c?'selected':''}>${c}</option>`).join('')}
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
                  <option value="operational" ${eq.status==='operational'?'selected':''}>Operational</option>
                  <option value="needs_service" ${eq.status==='needs_service'?'selected':''}>Needs Service</option>
                  <option value="down" ${eq.status==='down'?'selected':''}>Down</option>
                  <option value="retired" ${eq.status==='retired'?'selected':''}>Retired</option>
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

        <!-- SPECS - editable JSON + quick-add fields -->
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

        <!-- PHOTOS - main photo + data plate photo -->
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

        <!-- ATTACHMENTS -->
        <div class="eq-tab-panel" data-panel="attach">
          <div class="eq-attach-actions">
            <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'file')">📄 Upload File (PDF/etc)</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'photo')">📸 Add Photo</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'link')">🔗 Add Link</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'note')">📝 Add Note</button>
          </div>

          <div class="eq-attach-list" id="eqAttachList">
            ${attachments.length ? attachments.map(a => renderAttachment(a)).join('') : '<div class="eq-empty-small">No attachments yet. Upload receipts, invoices, warranty cards, installation docs, videos, or anything else.</div>'}
          </div>
        </div>

        <!-- LINKS - external URLs -->
        <div class="eq-tab-panel" data-panel="links">
          <div class="eq-specs-help">
            External links — manufacturer website, manual URL, training video, etc. Clickable from the equipment detail.
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

          <div class="eq-specs-help" style="margin-top:20px">
            Additional links — add any number via Attachments tab → "Add Link".
          </div>
        </div>

        <!-- CUSTOM FIELDS -->
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

  // Add spec row
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

  // Add custom field row
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

  // Save everything
  document.getElementById('eqFullSave').addEventListener('click', async () => {
    const btn = document.getElementById('eqFullSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      // Gather basic fields
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

      // Gather specs from the editable rows
      const specs = {};
      modal.querySelectorAll('#eqSpecsList .eq-spec-row').forEach(row => {
        const k = row.querySelector('.eq-spec-key').value.trim();
        const v = row.querySelector('.eq-spec-val').value.trim();
        if (k) specs[k] = v;
      });
      updates.specs = specs;

      // Save equipment
      const { error } = await NX.sb.from('equipment').update(updates).eq('id', equipId);
      if (error) throw error;

      // Save custom fields
      const customOps = [];
      modal.querySelectorAll('#eqCustomList .eq-custom-row').forEach(row => {
        const name = row.querySelector('.eq-custom-name').value.trim();
        const val = row.querySelector('.eq-custom-val').value.trim();
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
      if (NX.syslog) NX.syslog('equipment_edited', updates.name || 'equipment');
      closeFullEdit();
      if (EQ.loadEquipment) await EQ.loadEquipment();
      if (EQ.openDetail) EQ.openDetail(equipId);
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

/* ═══════════════════════════════════════════════════════════════════════
   ATTACHMENT MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

function renderAttachment(a) {
  const isImage = (a.mime_type || '').startsWith('image/');
  const isPDF = (a.mime_type || '').includes('pdf');
  const url = a.file_url || a.external_url;
  const icon = a.type === 'link' ? '🔗' :
               a.type === 'note' ? '📝' :
               a.type === 'receipt' ? '🧾' :
               a.type === 'invoice' ? '💰' :
               a.type === 'warranty' ? '🛡️' :
               a.type === 'photo' ? '📸' :
               isImage ? '📸' :
               isPDF ? '📄' : '📎';

  return `
    <div class="eq-attach-item" data-id="${a.id}">
      <div class="eq-attach-icon">${icon}</div>
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

async function addAttachment(equipId, type) {
  if (type === 'link') {
    const title = prompt('Link title:');
    if (!title) return;
    const url = prompt('URL:');
    if (!url) return;
    await NX.sb.from('equipment_attachments').insert({
      equipment_id: equipId,
      type: 'link',
      title: title.slice(0, 200),
      external_url: url,
      uploaded_by: NX.currentUser?.name || 'user'
    });
    NX.toast && NX.toast('Link added ✓', 'success');
    openFullEditor(equipId);
    return;
  }

  if (type === 'note') {
    const title = prompt('Note title:');
    if (!title) return;
    const desc = prompt('Note content:');
    if (!desc) return;
    await NX.sb.from('equipment_attachments').insert({
      equipment_id: equipId,
      type: 'note',
      title: title.slice(0, 200),
      description: desc,
      uploaded_by: NX.currentUser?.name || 'user'
    });
    NX.toast && NX.toast('Note added ✓', 'success');
    openFullEditor(equipId);
    return;
  }

  // File upload (file or photo)
  const input = document.createElement('input');
  input.type = 'file';
  if (type === 'photo') {
    input.accept = 'image/*';
    input.capture = 'environment';
  } else {
    // Accept any file
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

      const { data: { publicUrl } } = NX.sb.storage
        .from('equipment-attachments')
        .getPublicUrl(fname);

      await NX.sb.from('equipment_attachments').insert({
        equipment_id: equipId,
        type: type,
        title: title.slice(0, 200),
        file_url: publicUrl,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: NX.currentUser?.name || 'user'
      });

      NX.toast && NX.toast('Uploaded ✓', 'success');
      openFullEditor(equipId);
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
    // Get the attachment to find the storage path
    const { data: a } = await NX.sb.from('equipment_attachments').select('*').eq('id', id).single();
    if (a && a.file_url) {
      // Extract path from URL
      const match = a.file_url.match(/equipment-attachments\/(.+)$/);
      if (match) {
        await NX.sb.storage.from('equipment-attachments').remove([match[1]]);
      }
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

/* ═══════════════════════════════════════════════════════════════════════
   PHOTO MANAGEMENT (main photo, data plate)
   ═══════════════════════════════════════════════════════════════════════ */

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

      const { data: { publicUrl } } = NX.sb.storage
        .from('equipment-photos')
        .getPublicUrl(fname);

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

function replacePhoto(equipId, field) {
  uploadPhoto(equipId, field);
}

async function removePhoto(equipId, field) {
  if (!confirm('Remove this photo?')) return;
  await NX.sb.from('equipment').update({ [field]: null }).eq('id', equipId);
  NX.toast && NX.toast('Removed ✓', 'success');
  openFullEditor(equipId);
}

/* ═══════════════════════════════════════════════════════════════════════
   CUSTOM FIELD MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

async function deleteCustomField(id, equipId) {
  if (!confirm('Delete this custom field?')) return;
  await NX.sb.from('equipment_custom_fields').delete().eq('id', id);
  NX.toast && NX.toast('Deleted ✓', 'success');
  openFullEditor(equipId);
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW TAB ENHANCEMENT
   Show attachments, custom fields, clickable links
   ═══════════════════════════════════════════════════════════════════════ */

async function enhanceOverview(equipId) {
  // Called after openDetail renders — adds attachments + custom fields + links
  const [attachRes, customRes] = await Promise.all([
    NX.sb.from('equipment_attachments').select('*').eq('equipment_id', equipId).order('created_at', { ascending: false }),
    NX.sb.from('equipment_custom_fields').select('*').eq('equipment_id', equipId).order('created_at')
  ]);
  const attachments = attachRes.data || [];
  const customFields = customRes.data || [];

  const modal = document.getElementById('eqModal');
  if (!modal) return;
  const overviewPanel = modal.querySelector('[data-panel="overview"]');
  if (!overviewPanel || overviewPanel.dataset.enhanced === '1') return;
  overviewPanel.dataset.enhanced = '1';

  // Build enhancement block
  let html = '';

  // Attachments (badges)
  if (attachments.length) {
    html += `<div class="eq-overview-section">
      <h4>📎 Attachments (${attachments.length})</h4>
      <div class="eq-overview-attachments">
        ${attachments.map(a => `
          <a ${a.file_url || a.external_url ? `href="${a.file_url || a.external_url}" target="_blank"` : ''}
             class="eq-attach-badge">
            ${a.type === 'link' ? '🔗' : a.type === 'photo' ? '📸' : a.type === 'receipt' ? '🧾' : a.type === 'invoice' ? '💰' : a.type === 'warranty' ? '🛡️' : a.type === 'note' ? '📝' : '📄'}
            ${esc(a.title)}
          </a>
        `).join('')}
      </div>
    </div>`;
  }

  // Custom fields
  if (customFields.length) {
    html += `<div class="eq-overview-section">
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
    </div>`;
  }

  // Clickable links from manual_source_url
  const { data: eq } = await NX.sb.from('equipment').select('manual_source_url, manual_url').eq('id', equipId).single();
  if (eq && (eq.manual_source_url || eq.manual_url)) {
    html += `<div class="eq-overview-section">
      <h4>🔗 Links</h4>
      <div class="eq-overview-links">
        ${eq.manual_source_url ? `<a href="${escAttr(eq.manual_source_url)}" target="_blank" class="eq-link-btn">📘 Manual (source) ↗</a>` : ''}
        ${eq.manual_url ? `<a href="${escAttr(eq.manual_url)}" target="_blank" class="eq-link-btn">📄 Manual PDF ↗</a>` : ''}
      </div>
    </div>`;
  }

  if (html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    overviewPanel.appendChild(div);
  }

  // Add "✎ Edit Everything" button to the detail actions
  setTimeout(() => {
    const actions = modal.querySelector('.eq-detail-actions');
    if (actions && !actions.querySelector('.eq-full-edit-btn')) {
      const btn = document.createElement('button');
      btn.className = 'eq-btn eq-btn-primary eq-full-edit-btn';
      btn.innerHTML = '✎ Edit Everything';
      btn.addEventListener('click', () => openFullEditor(equipId));
      // Replace existing ✎ Edit with full editor
      const oldEdit = Array.from(actions.querySelectorAll('.eq-btn')).find(b =>
        (b.textContent || '').trim().startsWith('✎ Edit'));
      if (oldEdit) oldEdit.replaceWith(btn);
      else actions.insertBefore(btn, actions.firstChild);
    }
  }, 100);
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatBytes(b) {
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
  return (b / 1048576).toFixed(1) + 'MB';
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT + INJECT
   ═══════════════════════════════════════════════════════════════════════ */

Object.assign(NX.modules.equipment, {
  openFullEditor,
  closeFullEdit,
  addAttachment,
  deleteAttachment,
  editAttachmentDesc,
  uploadPhoto,
  replacePhoto,
  removePhoto,
  deleteCustomField,
  enhanceOverview
});

// Hook into openDetail to enhance overview tab + replace the Edit button
const _origOpen = EQ.openDetail;
EQ.openDetail = async function(id) {
  await _origOpen(id);
  setTimeout(() => enhanceOverview(id), 200);
};

// Also override the edit action - when anything calls EQ.edit, use full editor
EQ.edit = openFullEditor;

console.log('[EquipFull] Loaded');

})();
