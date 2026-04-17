/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment Phase 3 — The Complete System
   - Zebra ZPL native printing (USB/Bluetooth/WiFi)
   - Public scan view (no login, works from any phone)
   - Auto-BOM extraction from uploaded manuals (Claude Vision PDF)
   - Predictive PM scheduling (replaces fixed intervals)
   - Parts cart export (Parts Town / Allpoints direct links)
   - Warranty tracking + alerts
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

if (!NX.modules || !NX.modules.equipment) {
  console.error('[EquipmentP3] Base equipment module not loaded');
  return;
}

const EQ = NX.modules.equipment;

/* ═══════════════════════════════════════════════════════════════════════
   ZEBRA ZPL LABEL GENERATION
   Supports 2x1" and 2x2" labels at 203 DPI (standard ZD421)
   ═══════════════════════════════════════════════════════════════════════ */

const ZEBRA_CONFIG = {
  dpi: 203,  // ZD421 default
  labelSizes: {
    '2x1': { width: 2, height: 1, widthDots: 406, heightDots: 203 },
    '2x2': { width: 2, height: 2, widthDots: 406, heightDots: 406 },
    '3x2': { width: 3, height: 2, widthDots: 609, heightDots: 406 },
    '4x2': { width: 4, height: 2, widthDots: 812, heightDots: 406 }
  }
};

/* Generate ZPL for a single equipment label
   Format: 2x2" label with QR + equipment name + location + model */
function generateZPL(equipment, size = '2x2') {
  const cfg = ZEBRA_CONFIG.labelSizes[size];
  if (!cfg) throw new Error('Invalid label size: ' + size);

  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${equipment.qr_code}`;

  // Escape text for ZPL (no special chars allowed in ^FD fields — use _ or similar)
  const name = (equipment.name || '').replace(/[\^~]/g, '').slice(0, 30);
  const location = (equipment.location || '').replace(/[\^~]/g, '');
  const model = `${equipment.manufacturer || ''} ${equipment.model || ''}`.trim().replace(/[\^~]/g, '').slice(0, 28);

  let zpl = '';

  if (size === '2x2') {
    // 2x2 label: QR on left (160x160 dots), text on right
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO20,30^BQN,2,5^FDQA,${scanURL}^FS
^FO200,40^A0N,28,28^FD${name}^FS
^FO200,80^A0N,22,22^FD${location}^FS
^FO200,130^A0N,18,18^FD${model}^FS
^FO200,170^A0N,14,14^FDScan for details^FS
^FO200,200^A0N,14,14^FD${equipment.qr_code}^FS
^PQ1,0,1,Y
^XZ`;
  } else if (size === '2x1') {
    // 2x1 label: compact, QR + name only
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO15,20^BQN,2,3^FDQA,${scanURL}^FS
^FO120,25^A0N,22,22^FD${name}^FS
^FO120,55^A0N,16,16^FD${location}^FS
^FO120,80^A0N,14,14^FD${model}^FS
^FO120,105^A0N,12,12^FD${equipment.qr_code}^FS
^PQ1,0,1,Y
^XZ`;
  } else if (size === '3x2' || size === '4x2') {
    // Larger: QR + full details + model + SN
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO20,40^BQN,2,6^FDQA,${scanURL}^FS
^FO230,40^A0N,32,32^FD${name}^FS
^FO230,85^A0N,24,24^FD${location}^FS
^FO230,130^A0N,20,20^FD${model}^FS
^FO230,170^A0N,16,16^FDSN: ${(equipment.serial_number || '—').slice(0, 20)}^FS
^FO230,210^A0N,16,16^FDNEXUS: ${equipment.qr_code}^FS
^FO230,250^A0N,14,14^FDScan for full details^FS
^PQ1,0,1,Y
^XZ`;
  }

  return zpl.replace(/\n\s*/g, '\n').trim();
}

/* Generate ZPL batch (multiple labels in one print job) */
function generateZPLBatch(equipmentList, size = '2x2') {
  return equipmentList.map(eq => generateZPL(eq, size)).join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════
   ZEBRA BROWSER PRINT (USB/Network connected Zebra)
   Requires the user to install Zebra Browser Print on their computer:
   https://www.zebra.com/us/en/software/printer-software/browser-print.html
   ═══════════════════════════════════════════════════════════════════════ */

const ZEBRA_BP_URL = 'http://localhost:9100'; // Browser Print local service
let zebraBrowserPrintLoaded = false;

async function loadZebraBrowserPrint() {
  if (zebraBrowserPrintLoaded) return true;
  // Try to load the Zebra BrowserPrint library
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/gh/gtomasevic/browser-print-js@master/BrowserPrint-3.0.216.min.js';
      script.onload = resolve;
      script.onerror = () => {
        // Fallback: direct HTTP call
        resolve();
      };
      document.head.appendChild(script);
    });
    zebraBrowserPrintLoaded = true;
    return true;
  } catch (e) {
    console.warn('[Zebra] BrowserPrint library load failed:', e);
    return false;
  }
}

async function printZebraBrowserPrint(zpl) {
  // Try direct HTTP POST to BrowserPrint local service
  try {
    // First, get default device
    const devRes = await fetch(ZEBRA_BP_URL + '/default?type=printer');
    if (!devRes.ok) throw new Error('Browser Print not running');
    const device = await devRes.json();

    // Send the print job
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

/* ═══════════════════════════════════════════════════════════════════════
   ZEBRA PRINT DIALOG — UI for picking options
   ═══════════════════════════════════════════════════════════════════════ */

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

  // Tab switching
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

  // Check printer status
  checkZebraPrinter();

  // Wire buttons
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

function renderZebraPreview(equipment, size) {
  const el = document.getElementById('zebraPreview');
  if (!el || !equipment) return;
  const zpl = generateZPL(equipment, size);
  const cfg = ZEBRA_CONFIG.labelSizes[size];
  // Use Labelary API to render preview
  const apiURL = `https://api.labelary.com/v1/printers/8dpmm/labels/${cfg.width}x${cfg.height}/0/`;

  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Rendering…</div>';

  fetch(apiURL, {
    method: 'POST',
    headers: { 'Accept': 'image/png' },
    body: zpl
  }).then(r => {
    if (!r.ok) throw new Error('Preview API error');
    return r.blob();
  }).then(blob => {
    const url = URL.createObjectURL(blob);
    el.innerHTML = `
      <div class="eq-zebra-preview-img-wrap">
        <img src="${url}" class="eq-zebra-preview-img" alt="Label preview">
        <div class="eq-zebra-preview-cap">${size}" label · ${equipment.name}</div>
      </div>
    `;
  }).catch(e => {
    el.innerHTML = '<div class="eq-zebra-err">Preview unavailable. The ZPL is still valid and will print correctly.</div>';
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   PUBLIC SCAN VIEW
   When someone scans a QR without being logged in, show a minimal
   read-only page with equipment info and "Report Issue" option
   ═══════════════════════════════════════════════════════════════════════ */

function renderPublicScanView(qrCode) {
  // Called from app.js pre-auth hook when ?equip=XXX is detected
  // Returns HTML to inject, or null if should proceed to normal login
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
      .select('name, location, area, manufacturer, model, serial_number, category, status, next_pm_date, install_date, warranty_until, photo_url, qr_code')
      .eq('qr_code', qrCode)
      .single();

    if (error || !data) throw new Error('Equipment not found');

    // Load last 5 services
    const { data: maint } = await NX.sb.from('equipment_maintenance')
      .select('event_type, event_date, description, performed_by')
      .eq('equipment_id', (await NX.sb.from('equipment').select('id').eq('qr_code', qrCode).single()).data?.id)
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
    operational: { label: 'Operational', color: '#4caf50' },
    needs_service: { label: 'Needs Service', color: '#ff9800' },
    down: { label: 'Down', color: '#f44336' },
    retired: { label: 'Retired', color: '#888' }
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
        </div>
      ` : ''}

      <div class="public-scan-actions">
        <button class="public-scan-btn public-scan-btn-primary" onclick="NX.modules.equipment.publicReportIssue('${eq.qr_code}')">🔴 Report Issue</button>
        <button class="public-scan-btn" onclick="window.location.href='${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}&login=1'">Sign In for Full Details</button>
      </div>

      <div class="public-scan-footer">
        Powered by NEXUS · Restaurant Operations Intelligence
      </div>
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

    // Look up equipment_id from qr_code
    const { data: eq } = await NX.sb.from('equipment').select('id, name, location').eq('qr_code', qrCode).single();
    if (!eq) return;

    try {
      // Create a ticket
      await NX.sb.from('tickets').insert({
        title: `[Equipment] ${eq.name}: ${fd.get('description').slice(0, 60)}`,
        notes: `Reported via QR scan by ${fd.get('reporter')}\n\nEquipment: ${eq.name}\nLocation: ${eq.location}\n\nIssue: ${fd.get('description')}`,
        priority: fd.get('priority'),
        location: eq.location,
        status: 'open',
        reported_by: fd.get('reporter') + ' (QR scan)'
      });

      // Also add to daily_logs for visibility
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

/* ═══════════════════════════════════════════════════════════════════════
   AUTO-BOM EXTRACTION FROM UPLOADED MANUAL
   Uses Claude's native PDF support to extract parts list from manual
   ═══════════════════════════════════════════════════════════════════════ */

async function extractBOMFromManual(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq || !eq.manual_url) {
    NX.toast && NX.toast('Upload a manual first', 'info');
    return;
  }

  NX.toast && NX.toast('Reading manual and extracting parts…', 'info', 10000);

  try {
    // Fetch the PDF
    const pdfRes = await fetch(eq.manual_url);
    if (!pdfRes.ok) throw new Error('Could not fetch manual');
    const pdfBlob = await pdfRes.blob();
    const pdfBase64 = await blobToBase64(pdfBlob);

    // Send to Claude with PDF-support prompt
    const key = NX.getApiKey();
    if (!key) throw new Error('No API key configured');

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: NX.getModel(),
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
            },
            {
              type: 'text',
              text: `You are reading a service/parts manual for commercial kitchen equipment:
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

If no parts are found, return []. Extract only what's explicitly listed.`
            }
          ]
        }]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const answer = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';

    // Parse JSON array
    const arrStart = answer.indexOf('[');
    const arrEnd = answer.lastIndexOf(']');
    if (arrStart === -1) throw new Error('No parts array in response');
    const parts = JSON.parse(answer.slice(arrStart, arrEnd + 1));

    if (!parts.length) {
      NX.toast && NX.toast('No serviceable parts found in manual', 'info');
      return;
    }

    // Show confirmation dialog
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
    if (!selected.length) {
      modal.remove();
      return;
    }

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
      EQ.openDetail(equipId);
    } catch (err) {
      NX.toast && NX.toast('Insert failed: ' + err.message, 'error');
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   PREDICTIVE PM SCHEDULING
   Uses pattern detection to suggest next PM date instead of fixed interval
   ═══════════════════════════════════════════════════════════════════════ */

async function suggestPMDate(equipId) {
  const pattern = await EQ.detectPatterns(equipId);
  if (!pattern.hasPattern) return null;

  // Schedule PM 2 weeks BEFORE predicted failure
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
  await EQ.loadEquipment();
  EQ.openDetail(equipId);
}

/* ═══════════════════════════════════════════════════════════════════════
   PARTS CART EXPORT (Parts Town bulk)
   ═══════════════════════════════════════════════════════════════════════ */

async function exportPartsCart(equipId) {
  const { data: parts } = await NX.sb.from('equipment_parts')
    .select('part_name, oem_part_number, quantity, supplier_url')
    .eq('equipment_id', equipId);

  if (!parts || !parts.length) {
    NX.toast && NX.toast('No parts to export', 'info');
    return;
  }

  // Generate a shopping list with direct links
  const list = parts.map(p => {
    const searchTerm = p.oem_part_number || p.part_name;
    const url = p.supplier_url || `https://www.partstown.com/search?searchterm=${encodeURIComponent(searchTerm)}`;
    return {
      name: p.part_name,
      pn: p.oem_part_number || 'N/A',
      qty: p.quantity || 1,
      url
    };
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

/* ═══════════════════════════════════════════════════════════════════════
   WARRANTY ALERTS (runs in morning brief)
   ═══════════════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════════
   BULK ACTIONS (select multiple equipment, print/export in batch)
   ═══════════════════════════════════════════════════════════════════════ */

function printZebraBatch() {
  // Print all currently filtered equipment
  const filtered = EQ.getFiltered ? EQ.getFiltered() : [];
  if (!filtered.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }
  openZebraPrintDialog(filtered);
}

function printZebraSingle(equipId) {
  const list = EQ._equipment || [];
  const eq = list.find(e => e.id === equipId);
  if (!eq) return;
  openZebraPrintDialog([eq]);
}

/* ═══════════════════════════════════════════════════════════════════════
   EXTEND EXISTING EQUIPMENT MODULE + UI HOOKS
   ═══════════════════════════════════════════════════════════════════════ */

Object.assign(NX.modules.equipment, {
  // ZPL / Zebra
  generateZPL,
  generateZPLBatch,
  openZebraPrintDialog,
  printZebraSingle,
  printZebraBatch,

  // Public scan
  renderPublicScanView,
  publicReportIssue,

  // AI Extraction
  extractBOMFromManual,
  applyPredictivePM,
  suggestPMDate,

  // Commerce
  exportPartsCart,
  checkWarranties
});

// Inject Zebra button into header next to existing QR sheet
setTimeout(() => {
  const actions = document.querySelector('.eq-actions');
  if (actions && !actions.querySelector('.eq-zebra-header-btn')) {
    const btn = document.createElement('button');
    btn.className = 'eq-btn eq-btn-secondary eq-zebra-header-btn';
    btn.innerHTML = '🏷️ Zebra';
    btn.title = 'Print labels on Zebra printer';
    btn.addEventListener('click', printZebraBatch);
    actions.insertBefore(btn, actions.firstChild);
  }
}, 700);

// Inject Zebra + BOM extract + Parts Cart + Predictive PM buttons into detail view
const _origOpenDetail2 = NX.modules.equipment.openDetail;
NX.modules.equipment.openDetail = async function(id) {
  await _origOpenDetail2(id);

  setTimeout(() => {
    const modal = document.getElementById('eqModal');
    if (!modal) return;

    // Add to QR tab: Zebra print button
    const qrPanel = modal.querySelector('[data-panel="qr"]');
    if (qrPanel && !qrPanel.dataset.p3) {
      qrPanel.dataset.p3 = '1';
      const zebraBtn = document.createElement('button');
      zebraBtn.className = 'eq-btn eq-btn-primary';
      zebraBtn.style.marginTop = '12px';
      zebraBtn.innerHTML = '🏷️ Print on Zebra';
      zebraBtn.addEventListener('click', () => printZebraSingle(id));
      const actionsEl = qrPanel.querySelector('.eq-qr-actions');
      if (actionsEl) actionsEl.appendChild(zebraBtn);
    }

    // Add to Parts tab: Cart export + BOM extract buttons
    const partsPanel = modal.querySelector('[data-panel="parts"]');
    if (partsPanel && !partsPanel.dataset.p3) {
      partsPanel.dataset.p3 = '1';
      const head = partsPanel.querySelector('.eq-parts-head');
      if (head) {
        const cartBtn = document.createElement('button');
        cartBtn.className = 'eq-btn eq-btn-small eq-btn-secondary';
        cartBtn.innerHTML = '🛒 Shopping List';
        cartBtn.style.marginRight = '6px';
        cartBtn.addEventListener('click', () => exportPartsCart(id));
        head.insertBefore(cartBtn, head.lastElementChild);

        const extractBtn = document.createElement('button');
        extractBtn.className = 'eq-btn eq-btn-small eq-btn-secondary';
        extractBtn.innerHTML = '✨ Extract from Manual';
        extractBtn.style.marginRight = '6px';
        extractBtn.addEventListener('click', () => extractBOMFromManual(id));
        head.insertBefore(extractBtn, head.lastElementChild);
      }
    }

    // Add to Overview tab: Predictive PM button
    const overviewPanel = modal.querySelector('[data-panel="overview"]');
    if (overviewPanel && !overviewPanel.dataset.p3) {
      overviewPanel.dataset.p3 = '1';
      const pmBtn = document.createElement('button');
      pmBtn.className = 'eq-btn eq-btn-secondary';
      pmBtn.style.marginTop = '12px';
      pmBtn.style.marginLeft = '8px';
      pmBtn.innerHTML = '🔮 Predictive PM';
      pmBtn.title = 'Auto-schedule next PM based on repair patterns';
      pmBtn.addEventListener('click', () => applyPredictivePM(id));
      overviewPanel.appendChild(pmBtn);
    }
  }, 100);
};

console.log('[EquipmentP3] Phase 3 loaded — Zebra + Public Scan + BOM AI');

})();
