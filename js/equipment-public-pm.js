/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Public PM Logger v1
   
   Loaded when a public scan URL hits with ?equip=XXX (no login).
   Replaces the "Sign In for Full Details" only path with a two-button
   landing screen:
   
     [ 🔐 Login to view equipment ]   — existing login flow
     [ 🔧 PM Logger (no login) ]      — contractor service log form
   
   PM Logger features:
     • Pre-fills contractor name on subsequent visits (localStorage)
     • Single-equipment OR mass PM mode (same contractor batch-logs N units)
     • Photo upload (multi)
     • PDF invoice upload  
     • Finger-drawn signature
     • Honeypot anti-spam
     • All submissions go to pending_review queue
   
   Mass PM workflow:
     1. Scan a QR code → land on equipment screen
     2. Tap "PM Logger" → form opens
     3. Toggle "Mass PM mode" → checklist of similar equipment appears
        (filtered to same category by default — e.g., all refrigeration)
     4. Check off the equipment you serviced
     5. Fill form once → submits N rows sharing batch_id
   
   Load order: BEFORE equipment-public-scan.js so it can hook the choice screen.
   But the public-scan.js calls renderPublicScanView in equipment-p3.js, so
   we patch that function instead.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* ═════════════════════════════════════════════════════════════════════════
     ICONS — line-art SVG, replacing emoji glyphs throughout the public PM
     ─────────────────────────────────────────────────────────────────────
     Emojis render inconsistently across platforms (iOS shows glossy raster
     glyphs, Android shows another set, Windows yet another) — they fight
     the editorial line-art used everywhere else in the app. These are
     Lucide-derived paths sized to inherit currentColor and the parent's
     font-size. Use via svg('iconKey').
     ═════════════════════════════════════════════════════════════════════════ */
  const ICONS = {
    wrench:   '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.121 2.121 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    lock:     '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone:    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    close:    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    list:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    camera:   '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
    shield:   '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    check:    '<polyline points="20 6 9 17 4 12"/>',
    triangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    ban:      '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    spinner:  '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    pen:      '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  };
  function svg(key, sizeEm = 1) {
    const path = ICONS[key] || '';
    return `<svg viewBox="0 0 24 24" width="${sizeEm}em" height="${sizeEm}em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle">${path}</svg>`;
  }

  // Wait for NX + supabase
  function whenReady(check, fn, maxWait = 8000) {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); fn(); }
      else if (Date.now() - start > maxWait) { clearInterval(interval); }
    }, 80);
  }

  whenReady(
    () => window.NX && NX.sb,
    () => init()
  );

  function init() {
    console.log('[pm-logger] initializing');
    patchPublicScanView();
    // Expose for in-app testing too
    NX.pmLogger = { 
      openLoggerForm, 
      openMassMode,
      reviewPendingLogs 
    };
    // Expose the public contract that equipment-public-scan.js calls when
    // the "Log Service" button is tapped. Without this, the scan page
    // shows "PM Logger not loaded" because the fallback alert fires.
    window._NX_PUBLIC_PM_OPEN = openLoggerForm;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     UTILITIES
     ═════════════════════════════════════════════════════════════════════════ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getStoredContractor() {
    try {
      const raw = localStorage.getItem('nx_contractor_info');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function storeContractor(info) {
    try {
      localStorage.setItem('nx_contractor_info', JSON.stringify({
        name: info.name, company: info.company, 
        phone: info.phone, email: info.email
      }));
    } catch (_) {}
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PATCH THE PUBLIC SCAN VIEW
     
     The existing equipment-p3.js renderPublicScanHTML shows equipment info
     plus a "Report Issue" + "Sign In" button row. We replace that bottom
     row with our new two-button landing.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchPublicScanView() {
    // Watch for the public scan card to render, then inject our buttons
    const observer = new MutationObserver(() => {
      const actions = document.querySelector('.public-scan-actions');
      if (actions && !actions.dataset.pmReplaced) {
        actions.dataset.pmReplaced = '1';
        // Find the equipment QR code from the existing Sign In button
        const signInBtn = actions.querySelector('button[onclick*="login=1"]');
        const qrMatch = signInBtn?.getAttribute('onclick')?.match(/equip=([^&'"]+)/);
        const qrCode = qrMatch ? qrMatch[1] : null;
        
        if (qrCode) {
          replacePublicActions(actions, qrCode);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function replacePublicActions(actionsEl, qrCode) {
    // Pull the contact info that public-scan.js already loaded (if any)
    const contact = window._NX_PUBLIC_SCAN_CONTACT || null;
    
    const callBtnHtml = contact ? `
        <button class="pm-public-btn pm-public-btn-call" id="pmCallBtn" type="button">
          <span class="pm-public-btn-icon">${svg('phone', 1.4)}</span>
          <span class="pm-public-btn-label">
            <span class="pm-public-btn-title">Call ${esc(contact.name || 'Service')}</span>
            <span class="pm-public-btn-sub">${esc(contact.phone || '')}</span>
          </span>
        </button>
    ` : '';
    
    actionsEl.innerHTML = `
      <div class="pm-public-actions">
        <button class="pm-public-btn pm-public-btn-primary" id="pmLogBtn">
          <span class="pm-public-btn-icon">${svg('wrench', 1.4)}</span>
          <span class="pm-public-btn-label">
            <span class="pm-public-btn-title">PM Logger</span>
            <span class="pm-public-btn-sub">Service contractors — no login</span>
          </span>
        </button>
        
        <button class="pm-public-btn pm-public-btn-secondary" id="pmLoginBtn">
          <span class="pm-public-btn-icon">${svg('lock', 1.4)}</span>
          <span class="pm-public-btn-label">
            <span class="pm-public-btn-title">Login</span>
            <span class="pm-public-btn-sub">Restaurant staff</span>
          </span>
        </button>
        
        ${callBtnHtml}
        
        <button class="pm-public-btn pm-public-btn-tertiary" id="pmReportIssueBtn">
          <span class="pm-public-btn-icon">${svg('alert', 1.4)}</span>
          <span class="pm-public-btn-label">
            <span class="pm-public-btn-title">Report Issue</span>
            <span class="pm-public-btn-sub">Something's broken or unsafe</span>
          </span>
        </button>
      </div>
    `;
    
    document.getElementById('pmLoginBtn').addEventListener('click', () => {
      window.location.href = `${window.location.origin}${window.location.pathname}?equip=${qrCode}&login=1`;
    });
    document.getElementById('pmLogBtn').addEventListener('click', () => {
      openLoggerForm(qrCode);
    });
    document.getElementById('pmReportIssueBtn').addEventListener('click', () => {
      if (typeof window._NX_OPEN_REPORT_ISSUE === 'function') {
        window._NX_OPEN_REPORT_ISSUE(qrCode);
      } else if (NX.modules?.equipment?.publicReportIssue) {
        NX.modules.equipment.publicReportIssue(qrCode);
      }
    });
    
    // Call button — opens a confirm modal that collects the issue before dialing
    const callBtn = document.getElementById('pmCallBtn');
    if (callBtn && contact) {
      callBtn.addEventListener('click', () => {
        openPublicCallConfirm(contact, qrCode);
      });
    }
    
    // Also re-run when public-scan signals contact data is ready, so if the
    // contact loaded AFTER this override ran, we re-render with the Call button
    if (!contact && !actionsEl.dataset.pmContactListener) {
      actionsEl.dataset.pmContactListener = '1';
      window.addEventListener('nx-public-scan-ready', (e) => {
        if (e.detail?.contact) {
          // Force re-render
          delete actionsEl.dataset.pmReplaced;
          replacePublicActions(actionsEl, qrCode);
        }
      }, { once: true });
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PM LOGGER FORM
     ═════════════════════════════════════════════════════════════════════════ */

  async function openLoggerForm(qrCode) {
    // Resolve the equipment from QR code
    const { data: eq, error } = await NX.sb.from('equipment')
      .select('id, name, location, area, category, manufacturer, model, next_pm_date')
      .eq('qr_code', qrCode)
      .single();
    if (error || !eq) { alert('Equipment not found'); return; }

    const stored = getStoredContractor() || {};
    const today = new Date().toISOString().slice(0, 10);
    
    const modal = document.createElement('div');
    modal.className = 'pm-logger-modal';
    modal.innerHTML = `
      <div class="pm-logger-bg"></div>
      <div class="pm-logger-card">
        <div class="pm-logger-header">
          <div class="pm-logger-title"><span class="pm-logger-title-icon">${svg('wrench', 1)}</span> Log Service</div>
          <button class="pm-logger-close" id="pmFormClose" aria-label="Close">${svg('close', 1)}</button>
        </div>
        
        <div class="pm-logger-eq">
          <div class="pm-logger-eq-name">${esc(eq.name)}</div>
          <div class="pm-logger-eq-meta">${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
        </div>
        
        <div class="pm-logger-mass-toggle" id="pmMassToggle">
          <span><span class="pm-logger-toggle-icon">${svg('list', 1)}</span> Mass PM mode — log multiple units at once</span>
          <input type="checkbox" id="pmMassCheckbox">
        </div>
        
        <div class="pm-logger-mass-list" id="pmMassList" style="display:none;"></div>
        
        <form class="pm-logger-form" id="pmLoggerForm" autocomplete="off">
          <!-- Honeypot field — hidden from users, bots fill it -->
          <input type="text" name="website" id="pmHoneypot" 
            tabindex="-1" autocomplete="off" 
            style="position:absolute;left:-9999px;opacity:0;height:1px;width:1px;">
          
          <div class="pm-form-section">
            <h3>Your Info</h3>
            <label class="pm-label">Name *</label>
            <input type="text" id="pmName" class="pm-input" required 
              value="${esc(stored.name || '')}" placeholder="Your full name">
            
            <label class="pm-label">Company</label>
            <input type="text" id="pmCompany" class="pm-input" 
              value="${esc(stored.company || '')}" placeholder="Austin Air and Ice">
            
            <div class="pm-form-row">
              <div class="pm-form-half">
                <label class="pm-label">Phone</label>
                <input type="tel" id="pmPhone" class="pm-input" 
                  value="${esc(stored.phone || '')}" placeholder="(512) 555-1234">
              </div>
              <div class="pm-form-half">
                <label class="pm-label">Email</label>
                <input type="email" id="pmEmail" class="pm-input" 
                  value="${esc(stored.email || '')}" placeholder="optional">
              </div>
            </div>
          </div>
          
          <div class="pm-form-section">
            <h3>Service Details</h3>
            
            <div class="pm-form-row">
              <div class="pm-form-half">
                <label class="pm-label">Date *</label>
                <input type="date" id="pmDate" class="pm-input" required value="${today}">
              </div>
              <div class="pm-form-half">
                <label class="pm-label">Type *</label>
                <select id="pmType" class="pm-input" required>
                  <option value="pm">Preventive Maintenance</option>
                  <option value="repair">Repair</option>
                  <option value="inspection">Inspection</option>
                  <option value="emergency">Emergency Service</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            
            <label class="pm-label">What was done? *</label>
            <textarea id="pmWork" class="pm-input" rows="4" required 
              placeholder="Cleaned condenser coils, checked refrigerant levels, replaced air filter..."></textarea>
            
            <label class="pm-label">Parts replaced (optional)</label>
            <textarea id="pmParts" class="pm-input" rows="2" 
              placeholder="Air filter (model XYZ-123), Drain pan gasket"></textarea>
            
            <div class="pm-form-row">
              <div class="pm-form-half">
                <label class="pm-label">Cost ($)</label>
                <input type="number" step="0.01" id="pmCost" class="pm-input" placeholder="225.00">
              </div>
              <div class="pm-form-half">
                <label class="pm-label">Next service due</label>
                <input type="date" id="pmNext" class="pm-input">
              </div>
            </div>
          </div>
          
          <div class="pm-form-section">
            <h3>Attachments (optional)</h3>
            
            <label class="pm-label"><span class="pm-label-icon">${svg('camera', 1)}</span> Photos</label>
            <input type="file" id="pmPhotos" class="pm-input pm-file" 
              accept="image/*" multiple>
            <div class="pm-photo-preview" id="pmPhotoPreview"></div>
            
            <label class="pm-label"><span class="pm-label-icon">${svg('document', 1)}</span> Invoice / Report PDF</label>
            <input type="file" id="pmPdf" class="pm-input pm-file" accept="application/pdf">
            <div class="pm-pdf-preview" id="pmPdfPreview"></div>
          </div>
          
          <div class="pm-form-section">
            <h3>Signature</h3>
            <div class="pm-signature-wrap">
              <canvas id="pmSigCanvas" class="pm-signature-canvas" width="600" height="200"></canvas>
              <button type="button" class="pm-sig-clear" id="pmSigClear">Clear</button>
            </div>
            <div class="pm-sig-hint">Sign with your finger above</div>
          </div>
          
          <div class="pm-logger-actions">
            <button type="button" class="pm-cancel-btn" id="pmCancelBtn">Cancel</button>
            <button type="submit" class="pm-submit-btn" id="pmSubmitBtn">Submit Log</button>
          </div>
          
          <div class="pm-logger-tip">
            <span class="pm-tip-icon">${svg('shield', 1)}</span> Your submission goes to a review queue before it appears on the equipment record.
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById('pmFormClose').addEventListener('click', close);
    document.getElementById('pmCancelBtn').addEventListener('click', close);
    modal.querySelector('.pm-logger-bg').addEventListener('click', close);

    // Setup signature canvas
    setupSignaturePad(modal.querySelector('#pmSigCanvas'), modal.querySelector('#pmSigClear'));

    // Photo previews
    setupFilePreview(modal.querySelector('#pmPhotos'), modal.querySelector('#pmPhotoPreview'), 'photo');
    setupFilePreview(modal.querySelector('#pmPdf'), modal.querySelector('#pmPdfPreview'), 'pdf');

    // Mass mode toggle
    setupMassMode(modal, eq);

    // Form submit
    modal.querySelector('#pmLoggerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitPmLog(modal, eq, qrCode);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SIGNATURE PAD — finger-drawing canvas
     ═════════════════════════════════════════════════════════════════════════ */

  function setupSignaturePad(canvas, clearBtn) {
    const ctx = canvas.getContext('2d');
    // Match canvas internal pixel size to display size for sharp drawing
    const dpr = window.devicePixelRatio || 1;
    const rect = () => canvas.getBoundingClientRect();
    function resizeCanvas() {
      const r = rect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1a1408';
    }
    setTimeout(resizeCanvas, 100);
    
    let drawing = false;
    function pos(e) {
      const r = rect();
      const t = e.touches?.[0];
      const x = (t ? t.clientX : e.clientX) - r.left;
      const y = (t ? t.clientY : e.clientY) - r.top;
      return { x, y };
    }
    function start(e) {
      e.preventDefault();
      drawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    function end() { drawing = false; }
    
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    
    clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     FILE PREVIEW
     ═════════════════════════════════════════════════════════════════════════ */

  function setupFilePreview(input, preview, kind) {
    input.addEventListener('change', () => {
      preview.innerHTML = '';
      const files = Array.from(input.files || []);
      files.forEach(file => {
        if (kind === 'photo' && file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.className = 'pm-photo-thumb';
          img.src = URL.createObjectURL(file);
          preview.appendChild(img);
        } else if (kind === 'pdf' && file.type === 'application/pdf') {
          const div = document.createElement('div');
          div.className = 'pm-pdf-chip';
          div.innerHTML = `${svg("document", 1)} ${esc(file.name)} <span class="pm-file-size">(${(file.size/1024).toFixed(0)} KB)</span>`;
          preview.appendChild(div);
        }
      });
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     MASS PM MODE
     ═════════════════════════════════════════════════════════════════════════ */

  function setupMassMode(modal, currentEq) {
    const checkbox = modal.querySelector('#pmMassCheckbox');
    const list = modal.querySelector('#pmMassList');
    const toggleRow = modal.querySelector('#pmMassToggle');
    
    toggleRow.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        checkbox.checked = !checkbox.checked;
      }
      checkbox.dispatchEvent(new Event('change'));
    });
    
    checkbox.addEventListener('change', async () => {
      if (!checkbox.checked) {
        list.style.display = 'none';
        return;
      }
      list.style.display = 'block';
      list.innerHTML = '<div class="pm-mass-loading">Loading equipment…</div>';
      
      // Default filter: same category as scanned equipment
      const { data: similar } = await NX.sb.from('equipment')
        .select('id, name, location, area, category')
        .eq('is_deleted', false)
        .eq('category', currentEq.category)
        .order('location').order('name');
      
      const items = similar || [];
      
      list.innerHTML = `
        <div class="pm-mass-header">
          <span>${items.length} ${currentEq.category} units found</span>
          <button type="button" class="pm-mass-all" id="pmMassAll">Select all</button>
        </div>
        <div class="pm-mass-items">
          ${items.map(it => `
            <label class="pm-mass-item">
              <input type="checkbox" class="pm-mass-eq" value="${esc(it.id)}" 
                ${it.id === currentEq.id ? 'checked' : ''}>
              <div class="pm-mass-eq-info">
                <div class="pm-mass-eq-name">${esc(it.name)}</div>
                <div class="pm-mass-eq-loc">${esc(it.location || '')}${it.area ? ' · ' + esc(it.area) : ''}</div>
              </div>
            </label>
          `).join('')}
        </div>
      `;
      
      modal.querySelector('#pmMassAll').addEventListener('click', () => {
        const allBoxes = modal.querySelectorAll('.pm-mass-eq');
        const allChecked = Array.from(allBoxes).every(b => b.checked);
        allBoxes.forEach(b => b.checked = !allChecked);
      });
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SUBMIT
     ═════════════════════════════════════════════════════════════════════════ */

  async function submitPmLog(modal, eq, qrCode) {
    const submitBtn = modal.querySelector('#pmSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading…';

    try {
      // Collect form data
      const honeypot = modal.querySelector('#pmHoneypot').value;
      const data = {
        contractor_name: modal.querySelector('#pmName').value.trim(),
        contractor_company: modal.querySelector('#pmCompany').value.trim() || null,
        contractor_phone: modal.querySelector('#pmPhone').value.trim() || null,
        contractor_email: modal.querySelector('#pmEmail').value.trim() || null,
        service_date: modal.querySelector('#pmDate').value,
        service_type: modal.querySelector('#pmType').value,
        work_performed: modal.querySelector('#pmWork').value.trim(),
        parts_replaced: modal.querySelector('#pmParts').value.trim() || null,
        cost_amount: parseFloat(modal.querySelector('#pmCost').value) || null,
        next_service_date: modal.querySelector('#pmNext').value || null,
        submitted_user_agent: navigator.userAgent.slice(0, 500),
        flagged_spam: !!honeypot.trim(),  // Honeypot tripped
        review_status: 'pending'
      };

      if (!data.contractor_name || !data.work_performed) {
        throw new Error('Name and work description are required');
      }

      // Store contractor info for next time
      storeContractor({
        name: data.contractor_name,
        company: data.contractor_company,
        phone: data.contractor_phone,
        email: data.contractor_email
      });

      // Determine which equipment IDs to log against
      const massBoxes = modal.querySelectorAll('.pm-mass-eq:checked');
      const equipIds = massBoxes.length 
        ? Array.from(massBoxes).map(b => b.value)
        : [eq.id];
      
      const batchId = equipIds.length > 1 ? uuid() : null;

      // Upload photos
      submitBtn.textContent = 'Uploading photos…';
      const photoUrls = await uploadFiles(modal.querySelector('#pmPhotos').files, 'photos');

      // Upload PDF
      submitBtn.textContent = 'Uploading PDF…';
      const pdfFiles = modal.querySelector('#pmPdf').files;
      const pdfUrl = pdfFiles.length ? (await uploadFiles(pdfFiles, 'pdfs'))[0] : null;

      // Capture signature
      const sigCanvas = modal.querySelector('#pmSigCanvas');
      const signatureData = isCanvasNonEmpty(sigCanvas) ? sigCanvas.toDataURL('image/png') : null;

      // Insert one row per equipment
      submitBtn.textContent = 'Saving…';
      const rows = equipIds.map(id => ({
        ...data,
        equipment_id: id,
        photo_urls: photoUrls,
        pdf_url: pdfUrl,
        signature_data: signatureData,
        batch_id: batchId
      }));

      const { error } = await NX.sb.from('pm_logs').insert(rows);
      if (error) throw error;

      // Sync each affected equipment's brain node so the AI is aware
      // a service submission exists even before admin approval. The
      // sync reads pm_logs to include "N pending review" in the
      // equipment node's notes — searchable via search_nodes tool.
      if (NX.eqBrainSync?.syncOne) {
        for (const eqId of equipIds) {
          try { NX.eqBrainSync.syncOne(eqId); } catch (_) {}
        }
      }

      // Show success screen
      showSuccessScreen(modal, eq, equipIds.length, data);

    } catch (err) {
      console.error('[pm-logger] submit failed:', err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Log';
      alert('Submit failed: ' + err.message);
    }
  }

  function isCanvasNonEmpty(canvas) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  }

  async function uploadFiles(fileList, folder) {
    const files = Array.from(fileList || []);
    const urls = [];
    for (const file of files) {
      try {
        const ext = file.name.split('.').pop() || 'bin';
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        const { data, error } = await NX.sb.storage
          .from('pm-attachments')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        const { data: urlData } = NX.sb.storage.from('pm-attachments').getPublicUrl(path);
        if (urlData?.publicUrl) urls.push(urlData.publicUrl);
      } catch (e) {
        console.warn('[pm-logger] file upload failed:', e);
      }
    }
    return urls;
  }

  function showSuccessScreen(modal, eq, count, data) {
    const card = modal.querySelector('.pm-logger-card');
    card.innerHTML = `
      <div class="pm-success">
        <div class="pm-success-icon">${svg('check', 1.5)}</div>
        <div class="pm-success-title">Service Logged</div>
        <div class="pm-success-msg">
          ${count > 1 
            ? `Logged service for <strong>${count} units</strong>.` 
            : `Logged service for <strong>${esc(eq.name)}</strong>.`}
          <br><br>
          The restaurant team will be notified.
          Thank you, ${esc(data.contractor_name)}!
        </div>
        <div class="pm-success-summary">
          <div class="pm-success-row"><span>Type:</span> <strong>${esc(data.service_type)}</strong></div>
          <div class="pm-success-row"><span>Date:</span> <strong>${esc(data.service_date)}</strong></div>
          ${data.cost_amount ? `<div class="pm-success-row"><span>Cost:</span> <strong>$${data.cost_amount}</strong></div>` : ''}
        </div>
        <button class="pm-success-btn" id="pmSuccessClose">Done</button>
      </div>
    `;
    document.getElementById('pmSuccessClose').addEventListener('click', () => {
      modal.remove();
      // Optional: refresh public scan view to show this in recent history
      // (won't show until approved, but the page might reload anyway)
    });
  }

  function openMassMode(qrCode) {
    // Helper for in-app testing — same as openLoggerForm but auto-toggles mass mode
    openLoggerForm(qrCode).then(() => {
      setTimeout(() => {
        const cb = document.getElementById('pmMassCheckbox');
        if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      }, 200);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     ADMIN: Review pending PM logs
     ═════════════════════════════════════════════════════════════════════════ */

  async function reviewPendingLogs() {
    const modal = document.createElement('div');
    modal.className = 'pm-logger-modal';
    modal.innerHTML = `
      <div class="pm-logger-bg"></div>
      <div class="pm-logger-card pm-review-card">
        <div class="pm-logger-header">
          <div class="pm-logger-title"><span class="pm-logger-title-icon">${svg("list", 1)}</span> Pending PM Logs</div>
          <button class="pm-logger-close" id="pmReviewClose" aria-label="Close">${svg("close", 1)}</button>
        </div>
        <div class="pm-review-body" id="pmReviewBody">Loading…</div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('pmReviewClose').addEventListener('click', () => modal.remove());
    modal.querySelector('.pm-logger-bg').addEventListener('click', () => modal.remove());

    const body = document.getElementById('pmReviewBody');
    
    try {
      const { data, error } = await NX.sb.from('pm_logs_pending_review').select('*');
      if (error) throw error;
      
      if (!data?.length) {
        body.innerHTML = '<div class="pm-review-empty">No pending logs to review.</div>';
        return;
      }
      
      body.innerHTML = data.map(log => `
        <div class="pm-review-item" data-id="${log.id}">
          <div class="pm-review-eq">
            <strong>${esc(log.equipment_name || 'Unknown equipment')}</strong>
            <span class="pm-review-loc">${esc(log.equipment_location || '')}</span>
          </div>
          <div class="pm-review-contractor">
            ${log.flagged_spam ? `<span class="pm-review-spam-flag">${svg('triangle', 0.85)} Honeypot tripped</span>` : ''}
            ${esc(log.contractor_name)}${log.contractor_company ? ' · ' + esc(log.contractor_company) : ''}
            ${log.contractor_phone ? ' · ' + esc(log.contractor_phone) : ''}
          </div>
          <div class="pm-review-meta">
            ${esc(log.service_type)} · ${esc(log.service_date)} 
            ${log.cost_amount ? ' · $' + log.cost_amount : ''}
            · Submitted ${new Date(log.submitted_at).toLocaleString()}
          </div>
          <div class="pm-review-work">${esc(log.work_performed)}</div>
          ${log.parts_replaced ? `<div class="pm-review-parts">Parts: ${esc(log.parts_replaced)}</div>` : ''}
          
          ${log.photo_urls?.length ? `
            <div class="pm-review-photos">
              ${log.photo_urls.map(url => `<a href="${esc(url)}" target="_blank"><img src="${esc(url)}" class="pm-review-photo"></a>`).join('')}
            </div>
          ` : ''}
          
          ${log.pdf_url ? `<div class="pm-review-pdf">${svg("document", 0.95)} <a href="${esc(log.pdf_url)}" target="_blank">View PDF Invoice</a></div>` : ''}
          
          ${log.signature_data ? `<img src="${esc(log.signature_data)}" class="pm-review-signature">` : ''}
          
          ${log.batch_id ? `<div class="pm-review-batch">Part of batch: ${esc(log.batch_id.slice(0, 8))}…</div>` : ''}
          
          <div class="pm-review-actions">
            <button class="pm-review-approve" data-id="${log.id}">${svg('check', 0.95)} Approve</button>
            <button class="pm-review-reject" data-id="${log.id}">${svg('close', 0.95)} Reject</button>
            <button class="pm-review-spam" data-id="${log.id}">${svg('ban', 0.95)} Mark Spam</button>
          </div>
        </div>
      `).join('');
      
      // Wire actions
      body.querySelectorAll('.pm-review-approve').forEach(btn => {
        btn.addEventListener('click', () => updateReviewStatus(btn.dataset.id, 'approved', body));
      });
      body.querySelectorAll('.pm-review-reject').forEach(btn => {
        btn.addEventListener('click', () => updateReviewStatus(btn.dataset.id, 'rejected', body));
      });
      body.querySelectorAll('.pm-review-spam').forEach(btn => {
        btn.addEventListener('click', () => updateReviewStatus(btn.dataset.id, 'spam', body));
      });
      
    } catch (e) {
      body.innerHTML = '<div class="pm-review-error">Failed to load: ' + esc(e.message) + '</div>';
    }
  }

  async function updateReviewStatus(id, status, body) {
    try {
      const { error } = await NX.sb.from('pm_logs').update({
        review_status: status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: NX.currentUser?.name || 'Admin'
      }).eq('id', id);
      if (error) throw error;
      
      // If approved, also create a maintenance record on the equipment
      if (status === 'approved') {
        const { data: log } = await NX.sb.from('pm_logs').select('*').eq('id', id).single();
        if (log) {
          await NX.sb.from('equipment_maintenance').insert({
            equipment_id: log.equipment_id,
            event_date: log.service_date,
            event_type: log.service_type,
            description: log.work_performed + (log.parts_replaced ? '\n\nParts: ' + log.parts_replaced : ''),
            performed_by: log.contractor_name + (log.contractor_company ? ' (' + log.contractor_company + ')' : ''),
            cost: log.cost_amount,
            notes: `Submitted via QR scan. Phone: ${log.contractor_phone || 'n/a'}.`,
            pm_log_id: log.id  // Link so Timeline detail modal can pull photos/PDF/signature
          });
          // Re-sync brain
          if (NX.eqBrainSync?.syncOne) NX.eqBrainSync.syncOne(log.equipment_id);
        }
      }
      
      // Remove the row visually
      body.querySelector(`[data-id="${id}"]`)?.remove();
      if (!body.querySelector('.pm-review-item')) {
        body.innerHTML = '<div class="pm-review-empty">No pending logs to review.</div>';
      }
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PUBLIC CALL CONFIRM MODAL
     
     Shown when a contractor taps "Call <Service>" on the public QR landing.
     Collects the contractor's name (who's calling) and the issue before
     dialing. Logs the dispatch to dispatch_events so restaurant staff can
     see the full trail when they review.
     ═════════════════════════════════════════════════════════════════════════ */
  
  function openPublicCallConfirm(contact, qrCode) {
    const existing = document.getElementById('pmCallConfirm');
    if (existing) existing.remove();
    
    const telHref = 'tel:' + (contact.phoneHref || String(contact.phone || '').replace(/[^\d+]/g, ''));
    const modal = document.createElement('div');
    modal.id = 'pmCallConfirm';
    modal.className = 'eq-call-confirm pm-call-confirm';
    modal.innerHTML = `
      <div class="eq-call-confirm-bg"></div>
      <div class="eq-call-confirm-card">
        <div class="eq-call-confirm-icon">${svg("phone", 1.5)}</div>
        <div class="eq-call-confirm-title">Call ${esc(contact.name || 'Service')}?</div>
        <div class="eq-call-confirm-phone">${esc(contact.phone || '')}</div>
        <div class="eq-call-confirm-meta">Service contact on file</div>
        
        <div class="eq-call-confirm-issue-wrap">
          <label class="eq-call-confirm-issue-label" for="pmCallerName">
            Your name <span class="eq-optional-tag">(required)</span>
          </label>
          <input type="text" class="eq-call-confirm-issue" id="pmCallerName" placeholder="e.g., Mike from Austin Air" autocomplete="name" style="min-height:44px;resize:none">
        </div>
        
        <div class="eq-call-confirm-issue-wrap">
          <label class="eq-call-confirm-issue-label" for="pmCallIssue">
            What's the issue? <span class="eq-optional-tag">(required)</span>
          </label>
          <textarea class="eq-call-confirm-issue" id="pmCallIssue" rows="2" placeholder="e.g., Compressor not cooling, freezing intermittently..."></textarea>
        </div>
        
        <div class="eq-call-confirm-actions">
          <button class="eq-btn eq-btn-secondary" type="button" id="pmCallCancel">Cancel</button>
          <a class="eq-btn eq-call-service-btn is-disabled" id="pmCallGo" href="${esc(telHref)}" aria-disabled="true">${svg('phone', 1)} Call Now</a>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('active'));
    
    const close = () => { modal.classList.remove('active'); setTimeout(() => modal.remove(), 200); };
    const nameEl = modal.querySelector('#pmCallerName');
    const issueEl = modal.querySelector('#pmCallIssue');
    const callBtn = modal.querySelector('#pmCallGo');
    
    const validate = () => {
      const hasName = nameEl.value.trim().length >= 2;
      const hasIssue = issueEl.value.trim().length >= 2;
      const ok = hasName && hasIssue;
      callBtn.classList.toggle('is-disabled', !ok);
      callBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
    };
    nameEl.addEventListener('input', validate);
    issueEl.addEventListener('input', validate);
    setTimeout(() => nameEl.focus(), 250);
    
    modal.querySelector('.eq-call-confirm-bg').addEventListener('click', close);
    modal.querySelector('#pmCallCancel').addEventListener('click', close);
    
    callBtn.addEventListener('click', async (e) => {
      const callerName = nameEl.value.trim();
      const issue = issueEl.value.trim();
      if (!callerName || callerName.length < 2 || !issue || issue.length < 2) {
        e.preventDefault();
        const target = !callerName || callerName.length < 2 ? nameEl : issueEl;
        target.focus();
        target.style.borderColor = '#e07070';
        setTimeout(() => { target.style.borderColor = ''; }, 1200);
        return;
      }
      // Log the dispatch before the browser hands off to the dialer
      try {
        // Look up equipment_id from qr_code
        const { data: eq } = await NX.sb.from('equipment').select('id,name').eq('qr_code', qrCode).maybeSingle();
        await NX.sb.from('dispatch_events').insert({
          equipment_id: eq?.id || null,
          contractor_name: contact.name || 'Service',
          contractor_phone: contact.phone || null,
          method: 'call',
          issue_description: issue,
          dispatched_by: callerName + ' (public QR)',
          outcome: 'pending',
        });
        await NX.sb.from('daily_logs').insert({
          entry: `[PUBLIC-DISPATCH] ${callerName} called ${contact.name || 'Service'} (${contact.phone || 'no phone'}) for "${issue}" re: ${eq?.name || qrCode}`
        });
      } catch (err) { console.warn('public dispatch log failed:', err); }
      setTimeout(close, 100);
    });
  }

})();
