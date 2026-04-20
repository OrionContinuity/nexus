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
