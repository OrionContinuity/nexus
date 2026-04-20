/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Equipment Fixes v1
   
   Five coordinated fixes for the equipment detail view:
   
   1. BOTTOM ACTION BAR — collapsed to 3 visible buttons + overflow menu.
      Was: 5+ buttons crammed and wrapping.
      Now: Print | Dispatch | More(...). More menu has Edit/Edit Everything/
      Log Service/Predictive PM/Shopping List/Delete.
   
   2. DISPATCH — replaces the generic dispatch button with smart contractor
      lookup. Knows who services THIS equipment, shows their phone, lets
      you call directly, and logs the dispatch event.
   
   3. MANUAL VIEWER — replaces ugly browser-default PDF box with a styled
      card showing the first page rendered as an image, file name, page
      count, and "Open" button.
   
   4. MULTI-VENDOR PARTS — every part can now have multiple vendors with
      comparison: name, price, stock, last-checked, preferred flag.
      Existing single-vendor data migrates automatically.
   
   5. EXTRACT FROM MANUAL — was failing silently. Now shows step-by-step
      progress, surfaces errors clearly, and pre-populates extracted parts
      with empty vendors[] arrays for downstream multi-vendor entry.
   
   Load order: AFTER equipment.js, equipment-p3.js, equipment-full-editor.js,
   equipment-ai.js, equipment-ux.js. This file PATCHES those modules.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // Wait for the dependencies to load
  function whenReady(check, fn, maxWait = 5000) {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) {
        clearInterval(interval);
        fn();
      } else if (Date.now() - start > maxWait) {
        clearInterval(interval);
        console.warn('[eq-fixes] dependency check timed out');
      }
    }, 100);
  }

  whenReady(
    () => NX && NX.modules && NX.modules.equipment && NX.sb,
    () => init()
  );

  function init() {
    console.log('[eq-fixes] initializing equipment fixes v1');
    patchActionBar();
    patchManualViewer();
    patchPartsRendering();
    patchExtractFromManual();
    installDispatchSystem();
    console.log('[eq-fixes] all patches installed');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     UTILITIES
     ═════════════════════════════════════════════════════════════════════════ */
  
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, type, duration) {
    if (NX.toast) NX.toast(msg, type, duration);
    else console.log('[eq-fixes]', type || 'info', msg);
  }

  // Find all contractor nodes (people/companies tagged for service work)
  async function getContractorNodes() {
    try {
      const { data } = await NX.sb.from('nodes')
        .select('id, name, category, notes, tags')
        .in('category', ['contractors', 'vendors'])
        .order('name', { ascending: true });
      return data || [];
    } catch (e) {
      console.warn('[eq-fixes] getContractorNodes failed:', e);
      return [];
    }
  }

  // Extract a phone number from a contractor's notes field (best-effort)
  function extractPhoneFromNotes(notes) {
    if (!notes) return null;
    // Match common US phone formats: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, 10-digit
    const m = String(notes).match(/(\+?1[\s\-\.]?)?\(?(\d{3})\)?[\s\-\.]?(\d{3})[\s\-\.]?(\d{4})/);
    if (!m) return null;
    return `${m[2]}-${m[3]}-${m[4]}`;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     1. BOTTOM ACTION BAR — clean redesign with overflow menu
     
     Strategy: After the original detail modal renders, find the
     .eq-detail-actions container and rebuild it with:
       [Print Label] [📞 Dispatch] [⋯ More]
     
     The More menu drops up from the bottom and contains everything else.
     This survives all the other scripts that try to inject into the bar
     because we run LAST and own the rebuild.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchActionBar() {
    // Use a MutationObserver — when the detail modal opens and the actions bar
    // appears, we rebuild it. This way we catch every render path.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Find any new .eq-detail-actions inside the added subtree
          const actionsBars = node.matches?.('.eq-detail-actions') 
            ? [node] 
            : Array.from(node.querySelectorAll?.('.eq-detail-actions') || []);
          for (const bar of actionsBars) {
            // Wait one tick so other scripts can inject their buttons first,
            // then we collapse them into our overflow menu.
            setTimeout(() => rebuildActionBar(bar), 50);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function rebuildActionBar(bar) {
    // Skip if we've already processed this bar
    if (bar.dataset.eqFixesProcessed === '1') return;
    bar.dataset.eqFixesProcessed = '1';

    // Find equipment ID from the modal context
    const modal = bar.closest('.eq-modal, .eq-detail');
    const equipId = modal?.querySelector('[data-eq-id]')?.dataset.eqId
                 || modal?.dataset.eqId
                 || extractEquipIdFromButtons(bar);

    // Snapshot all existing buttons so we can categorize them
    const existingButtons = Array.from(bar.querySelectorAll('button, a'));
    const buttonData = existingButtons.map(b => ({
      el: b,
      label: b.textContent.trim(),
      onclick: b.getAttribute('onclick'),
      classList: Array.from(b.classList)
    }));

    // Categorize into primary (always visible) vs secondary (in overflow menu)
    const PRIMARY_PATTERNS = [
      /print.*label/i,
      /🏷/,
      /zebra/i
    ];
    const HIDE_PATTERNS = [
      /^delete$/i,
      /🗑/  // delete goes in overflow only
    ];

    const primary = buttonData.filter(b => PRIMARY_PATTERNS.some(p => p.test(b.label)));
    // Everything that isn't primary becomes a "secondary" overflow item
    const secondary = buttonData.filter(b => !PRIMARY_PATTERNS.some(p => p.test(b.label)));

    // Clear the bar and rebuild
    bar.innerHTML = '';
    bar.classList.add('eq-actionbar-clean');

    // Slot 1: DISPATCH — always shown (was slot 3)
    // NOTE: Print + Zebra buttons removed per user feedback — the QR tab
    // already provides a clean print trio (Print on Zebra / Paper Sticker /
    // Copy Link). Leaving them in the bottom bar was redundant.
    const dispatchBtn = document.createElement('button');
    dispatchBtn.className = 'eq-actionbar-btn eq-actionbar-dispatch';
    dispatchBtn.innerHTML = '<span class="eq-ab-icon">📞</span><span class="eq-ab-label">Dispatch</span>';
    dispatchBtn.addEventListener('click', () => openDispatchModal(equipId));
    bar.appendChild(dispatchBtn);

    // Slot 2: OVERFLOW — More menu containing all secondary actions
    // (Will be replaced by ⋯ trigger from equipment-context-menu.js)
    if (secondary.length) {
      const moreWrap = document.createElement('div');
      moreWrap.className = 'eq-actionbar-more-wrap';

      const moreBtn = document.createElement('button');
      moreBtn.className = 'eq-actionbar-btn eq-actionbar-more';
      moreBtn.innerHTML = '<span class="eq-ab-icon">⋯</span><span class="eq-ab-label">More</span>';

      const menu = document.createElement('div');
      menu.className = 'eq-actionbar-menu';
      for (const item of secondary) {
        const menuItem = document.createElement('button');
        menuItem.className = 'eq-actionbar-menu-item';
        // Detect dangerous actions and style accordingly
        const isDanger = HIDE_PATTERNS.some(p => p.test(item.label)) 
                       || item.classList.includes('eq-btn-danger');
        if (isDanger) menuItem.classList.add('danger');
        menuItem.textContent = item.label;
        menuItem.addEventListener('click', () => {
          item.el.click();
          menu.classList.remove('open');
        });
        menu.appendChild(menuItem);
      }
      moreWrap.appendChild(moreBtn);
      moreWrap.appendChild(menu);
      bar.appendChild(moreWrap);

      // Toggle menu open/close
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      });
      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!moreWrap.contains(e.target)) menu.classList.remove('open');
      }, { capture: true });
    }
  }

  function extractEquipIdFromButtons(bar) {
    // Look at button onclick handlers to find equipment.something('id')
    const buttons = bar.querySelectorAll('button[onclick]');
    for (const b of buttons) {
      const m = b.getAttribute('onclick').match(/['"]([\w-]+)['"]/);
      if (m) return m[1];
    }
    return null;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     2. DISPATCH SYSTEM
     
     Tap Dispatch → looks up the service contractor for this equipment.
     If one is set: show their info + Call button (tel: link) + log entry.
     If not set: contractor picker, save selection for next time.
     
     Logs every dispatch to dispatch_events table for audit history.
     ═════════════════════════════════════════════════════════════════════════ */

  function installDispatchSystem() {
    // Expose globally so other modules can call it
    NX.modules.equipment.dispatch = openDispatchModal;
  }

  async function openDispatchModal(equipId) {
    if (!equipId) {
      toast('No equipment context for dispatch', 'error');
      return;
    }

    // Fetch equipment + contractor info
    let eq;
    try {
      const { data, error } = await NX.sb.from('equipment')
        .select('*')
        .eq('id', equipId)
        .single();
      if (error) throw error;
      eq = data;
    } catch (e) {
      toast('Could not load equipment: ' + e.message, 'error');
      return;
    }

    // Resolve contractor info (use stored, or fetch from linked node)
    let contractor = null;
    if (eq.service_contractor_node_id) {
      try {
        const { data } = await NX.sb.from('nodes')
          .select('id, name, notes, tags')
          .eq('id', eq.service_contractor_node_id)
          .single();
        if (data) {
          contractor = {
            id: data.id,
            name: eq.service_contractor_name || data.name,
            phone: eq.service_contractor_phone || extractPhoneFromNotes(data.notes),
            notes: data.notes
          };
        }
      } catch (_) { /* fall through to picker */ }
    } else if (eq.service_contractor_name || eq.service_contractor_phone) {
      // Stored without a node link
      contractor = {
        id: null,
        name: eq.service_contractor_name,
        phone: eq.service_contractor_phone,
        notes: null
      };
    }

    // Render the dispatch modal
    const modal = document.createElement('div');
    modal.className = 'eq-dispatch-modal';
    modal.innerHTML = `
      <div class="eq-dispatch-bg"></div>
      <div class="eq-dispatch-card">
        <div class="eq-dispatch-header">
          <div class="eq-dispatch-title">📞 Dispatch Service</div>
          <button class="eq-dispatch-close">✕</button>
        </div>
        <div class="eq-dispatch-eq">
          <div class="eq-dispatch-eq-name">${esc(eq.name)}</div>
          <div class="eq-dispatch-eq-meta">
            ${eq.location ? esc(eq.location) : ''}
            ${eq.manufacturer ? ' · ' + esc(eq.manufacturer) : ''}
            ${eq.model ? ' ' + esc(eq.model) : ''}
          </div>
        </div>
        <div class="eq-dispatch-body" id="eqDispatchBody"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.eq-dispatch-close').addEventListener('click', close);
    modal.querySelector('.eq-dispatch-bg').addEventListener('click', close);

    const body = modal.querySelector('#eqDispatchBody');

    if (contractor && contractor.phone) {
      renderDispatchReady(body, eq, contractor, close);
    } else if (contractor && !contractor.phone) {
      renderDispatchNoPhone(body, eq, contractor, close);
    } else {
      await renderDispatchPicker(body, eq, close);
    }
  }

  function renderDispatchReady(body, eq, contractor, close) {
    const telHref = 'tel:' + contractor.phone.replace(/[^\d+]/g, '');
    body.innerHTML = `
      <div class="eq-dispatch-contractor">
        <div class="eq-dispatch-contractor-label">Service Contractor</div>
        <div class="eq-dispatch-contractor-name">${esc(contractor.name)}</div>
        <div class="eq-dispatch-contractor-phone">${esc(contractor.phone)}</div>
      </div>
      
      <div class="eq-dispatch-issue-wrap">
        <label class="eq-dispatch-label">What's the issue? (optional)</label>
        <textarea class="eq-dispatch-issue" id="eqDispatchIssue" rows="2" 
          placeholder="e.g., Compressor not cooling, freezing intermittently..."></textarea>
      </div>
      
      <div class="eq-dispatch-actions">
        <a href="${telHref}" class="eq-dispatch-call-btn" id="eqDispatchCallBtn">
          📞 Call ${esc(contractor.name)}
        </a>
        <button class="eq-dispatch-secondary-btn" id="eqDispatchChangeBtn">
          Change Contractor
        </button>
      </div>
      
      <div class="eq-dispatch-tip">
        Tapping Call will dial the number and log this dispatch event.
      </div>
    `;

    body.querySelector('#eqDispatchCallBtn').addEventListener('click', async () => {
      // Log the dispatch event before the user leaves
      const issue = body.querySelector('#eqDispatchIssue').value.trim();
      await logDispatchEvent(eq, contractor, issue);
      // Don't preventDefault — let the tel: link fire
      setTimeout(close, 500);
    });

    body.querySelector('#eqDispatchChangeBtn').addEventListener('click', async () => {
      body.innerHTML = '';
      await renderDispatchPicker(body, eq, close);
    });
  }

  function renderDispatchNoPhone(body, eq, contractor, close) {
    body.innerHTML = `
      <div class="eq-dispatch-contractor">
        <div class="eq-dispatch-contractor-label">Service Contractor</div>
        <div class="eq-dispatch-contractor-name">${esc(contractor.name)}</div>
        <div class="eq-dispatch-contractor-no-phone">No phone number on file.</div>
      </div>
      
      <div class="eq-dispatch-issue-wrap">
        <label class="eq-dispatch-label">Add phone number</label>
        <input type="tel" class="eq-dispatch-phone-input" id="eqDispatchPhone" 
          placeholder="(512) 555-1234" autocomplete="tel">
      </div>
      
      <div class="eq-dispatch-actions">
        <button class="eq-dispatch-call-btn" id="eqDispatchSavePhoneBtn">
          Save & Call
        </button>
        <button class="eq-dispatch-secondary-btn" id="eqDispatchChangeBtn">
          Change Contractor
        </button>
      </div>
    `;

    body.querySelector('#eqDispatchSavePhoneBtn').addEventListener('click', async () => {
      const phone = body.querySelector('#eqDispatchPhone').value.trim();
      if (!phone) { toast('Enter a phone number', 'info'); return; }
      try {
        await NX.sb.from('equipment')
          .update({ service_contractor_phone: phone })
          .eq('id', eq.id);
        contractor.phone = phone;
        body.innerHTML = '';
        renderDispatchReady(body, eq, contractor, close);
      } catch (e) {
        toast('Save failed: ' + e.message, 'error');
      }
    });

    body.querySelector('#eqDispatchChangeBtn').addEventListener('click', async () => {
      body.innerHTML = '';
      await renderDispatchPicker(body, eq, close);
    });
  }

  async function renderDispatchPicker(body, eq, close) {
    body.innerHTML = `
      <div class="eq-dispatch-picker-header">
        Choose a service contractor for this equipment.
        It'll be saved and used next time you tap Dispatch.
      </div>
      <input type="text" class="eq-dispatch-search" id="eqDispatchSearch" 
        placeholder="Search contractors...">
      <div class="eq-dispatch-list" id="eqDispatchList">Loading…</div>
      <div class="eq-dispatch-actions">
        <button class="eq-dispatch-secondary-btn" id="eqDispatchAddNewBtn">
          + Create New Contractor
        </button>
      </div>
    `;

    const contractors = await getContractorNodes();
    const list = body.querySelector('#eqDispatchList');
    const search = body.querySelector('#eqDispatchSearch');

    function renderList(filter) {
      const f = (filter || '').toLowerCase();
      const filtered = contractors.filter(c => 
        !f || c.name.toLowerCase().includes(f) || (c.notes || '').toLowerCase().includes(f)
      );
      if (!filtered.length) {
        list.innerHTML = '<div class="eq-dispatch-empty">No contractors found.</div>';
        return;
      }
      list.innerHTML = filtered.map(c => {
        const phone = extractPhoneFromNotes(c.notes);
        return `
          <button class="eq-dispatch-list-item" data-contractor-id="${c.id}" 
            data-contractor-name="${esc(c.name)}" 
            data-contractor-phone="${esc(phone || '')}">
            <div class="eq-dispatch-list-name">${esc(c.name)}</div>
            ${phone ? `<div class="eq-dispatch-list-phone">${esc(phone)}</div>` : 
              '<div class="eq-dispatch-list-no-phone">No phone on file</div>'}
          </button>
        `;
      }).join('');
      list.querySelectorAll('.eq-dispatch-list-item').forEach(item => {
        item.addEventListener('click', async () => {
          const cid = parseInt(item.dataset.contractorId, 10);
          const cname = item.dataset.contractorName;
          const cphone = item.dataset.contractorPhone || null;
          // Save selection
          try {
            await NX.sb.from('equipment').update({
              service_contractor_node_id: cid,
              service_contractor_name: cname,
              service_contractor_phone: cphone
            }).eq('id', eq.id);
            // Re-render the modal with this contractor
            const contractor = { id: cid, name: cname, phone: cphone, notes: null };
            body.innerHTML = '';
            if (cphone) renderDispatchReady(body, eq, contractor, close);
            else renderDispatchNoPhone(body, eq, contractor, close);
          } catch (e) {
            toast('Save failed: ' + e.message, 'error');
          }
        });
      });
    }

    renderList('');
    search.addEventListener('input', () => renderList(search.value));

    body.querySelector('#eqDispatchAddNewBtn').addEventListener('click', () => {
      const name = prompt('Contractor name:');
      if (!name || !name.trim()) return;
      const phone = prompt('Phone number:');
      createNewContractor(name.trim(), phone ? phone.trim() : null, eq, body, close);
    });
  }

  async function createNewContractor(name, phone, eq, body, close) {
    try {
      // Create the node
      const noteText = phone ? `Phone: ${phone}` : '';
      const { data, error } = await NX.sb.from('nodes').insert({
        name,
        category: 'contractors',
        notes: noteText,
        tags: ['service'],
        links: [],
        access_count: 1
      }).select().single();
      if (error) throw error;
      // Save to equipment
      await NX.sb.from('equipment').update({
        service_contractor_node_id: data.id,
        service_contractor_name: name,
        service_contractor_phone: phone
      }).eq('id', eq.id);
      // Refresh local nodes cache so it shows in galaxy
      if (NX.nodes) NX.nodes.push(data);
      const contractor = { id: data.id, name, phone, notes: noteText };
      body.innerHTML = '';
      if (phone) renderDispatchReady(body, eq, contractor, close);
      else renderDispatchNoPhone(body, eq, contractor, close);
    } catch (e) {
      toast('Could not create contractor: ' + e.message, 'error');
    }
  }

  async function logDispatchEvent(eq, contractor, issue) {
    try {
      // Log to dispatch_events
      await NX.sb.from('dispatch_events').insert({
        equipment_id: eq.id,
        contractor_node_id: contractor.id,
        contractor_name: contractor.name,
        contractor_phone: contractor.phone,
        issue_description: issue || null,
        dispatched_by: NX.currentUser?.name || 'Unknown',
        status: 'called'
      });
      // Also log to daily_logs for the daily activity stream
      const issueStr = issue ? ` for "${issue}"` : '';
      await NX.sb.from('daily_logs').insert({
        entry: `📞 [DISPATCH] ${NX.currentUser?.name || 'Unknown'} called ${contractor.name} (${contractor.phone || 'no phone'})${issueStr} re: ${eq.name}${eq.location ? ' @ ' + eq.location : ''}`
      });
    } catch (e) {
      console.warn('[eq-fixes] dispatch log failed:', e);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     3. MANUAL VIEWER — replace ugly browser default with styled card
     
     Strategy: When the manual tab panel is rendered, find its iframe and
     replace it with a custom card. Use PDF.js to render page 1 as a
     thumbnail image. Show file name, page count, and an Open button.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchManualViewer() {
    // Watch for the manual tab panel becoming visible
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const panels = node.matches?.('[data-panel="manual"]') 
            ? [node]
            : Array.from(node.querySelectorAll?.('[data-panel="manual"]') || []);
          for (const panel of panels) {
            const iframe = panel.querySelector('.eq-manual-iframe');
            if (iframe) replaceManualIframe(panel, iframe);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function replaceManualIframe(panel, iframe) {
    if (panel.dataset.eqFixesManualReplaced === '1') return;
    panel.dataset.eqFixesManualReplaced = '1';

    const url = iframe.src;
    if (!url) return;

    // Extract a clean filename from the URL
    let fileName = url.split('/').pop().split('?')[0];
    try { fileName = decodeURIComponent(fileName); } catch (_) {}

    // Build the styled card
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
        <a href="${esc(url)}" target="_blank" rel="noopener" class="eq-manual-card-open-btn">
          Open Manual ↗
        </a>
        <button class="eq-manual-card-secondary-btn" id="eqManualRemoveBtn">
          Remove
        </button>
      </div>
    `;

    // Replace iframe with card
    iframe.replaceWith(card);

    // Wire the remove button
    card.querySelector('#eqManualRemoveBtn').addEventListener('click', () => {
      // Find equipment ID from the original panel context — fallback to onclick on existing remove
      const oldRemoveBtn = panel.querySelector('button[onclick*="removeManual"]');
      if (oldRemoveBtn) {
        oldRemoveBtn.click();
      } else if (NX.modules?.equipment?.removeManual) {
        const equipId = panel.closest('[data-eq-id]')?.dataset.eqId;
        if (equipId && confirm('Remove the manual?')) {
          NX.modules.equipment.removeManual(equipId);
        }
      }
    });

    // Hide the old "Open in new tab / Remove" actions row that was rendered alongside
    const oldActions = panel.querySelector('.eq-manual-actions');
    if (oldActions) oldActions.style.display = 'none';

    // Render the PDF thumbnail in the background — this can take a sec
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

      // Update page count
      if (pagesEl) pagesEl.textContent = `PDF · ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;

      // Render page 1 to a small canvas
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.0 });
      // Constrain to 240px wide for the thumbnail
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
      console.warn('[eq-fixes] PDF thumbnail failed:', err);
      thumbContainer.innerHTML = '<div class="eq-manual-card-thumb-fallback">📄</div>';
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     4. MULTI-VENDOR PARTS
     
     Each part can have multiple vendors. We patch the rendering of the parts
     panel to show all vendors per part, with management UI.
     
     Approach: After parts panel renders, we look for .eq-part rows and append
     a vendor sub-list under each one.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchPartsRendering() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const partLists = node.matches?.('.eq-parts-list')
            ? [node]
            : Array.from(node.querySelectorAll?.('.eq-parts-list') || []);
          for (const list of partLists) enhancePartsList(list);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function enhancePartsList(list) {
    if (list.dataset.eqFixesEnhanced === '1') return;
    list.dataset.eqFixesEnhanced = '1';

    // For each part row, find the part ID and load its vendors[] array
    const parts = list.querySelectorAll('.eq-part');
    for (const partEl of parts) {
      const editBtn = partEl.querySelector('button[onclick*="editPart"]');
      const partId = editBtn?.getAttribute('onclick').match(/['"]([\w-]+)['"]/)?.[1];
      if (!partId) continue;
      await renderVendorsUnderPart(partEl, partId);
    }
  }

  async function renderVendorsUnderPart(partEl, partId) {
    let part;
    try {
      const { data } = await NX.sb.from('equipment_parts')
        .select('*')
        .eq('id', partId)
        .single();
      part = data;
    } catch (e) {
      console.warn('[eq-fixes] could not load part', partId, e);
      return;
    }
    if (!part) return;

    // Build the vendors list — start with the legacy single-vendor data if vendors[] is empty
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
        is_preferred: true  // legacy single vendor is the preferred one
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
        ${renderVendorsList(vendors, partId)}
      </div>
    `;
    partEl.appendChild(container);
    wireVendorActions(container, part, vendors);
  }

  function renderVendorsList(vendors, partId) {
    if (!vendors.length) {
      return '<div class="eq-part-vendors-empty">No vendors yet. Tap + Vendor to add one.</div>';
    }
    return vendors.map((v, idx) => `
      <div class="eq-part-vendor" data-vendor-idx="${idx}">
        <div class="eq-part-vendor-main">
          <div class="eq-part-vendor-row1">
            ${v.is_preferred ? '<span class="eq-part-vendor-star">★</span>' : ''}
            <span class="eq-part-vendor-name">${esc(v.name || 'Unnamed')}</span>
            ${v.price ? `<span class="eq-part-vendor-price">$${parseFloat(v.price).toFixed(2)}</span>` : ''}
          </div>
          <div class="eq-part-vendor-row2">
            ${v.oem_number ? `<span class="eq-part-vendor-oem">OEM: ${esc(v.oem_number)}</span>` : ''}
            ${v.in_stock === true ? '<span class="eq-part-vendor-stock in">In stock</span>' : ''}
            ${v.in_stock === false ? '<span class="eq-part-vendor-stock out">Out of stock</span>' : ''}
            ${v.last_checked_at ? `<span class="eq-part-vendor-checked">Checked ${formatRelative(v.last_checked_at)}</span>` : ''}
          </div>
          ${v.notes ? `<div class="eq-part-vendor-notes">${esc(v.notes)}</div>` : ''}
        </div>
        <div class="eq-part-vendor-actions">
          ${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="eq-part-vendor-btn order" data-action="order" data-vendor-idx="${idx}">Order</a>` : ''}
          ${!v.is_preferred ? `<button class="eq-part-vendor-btn star-btn" data-action="prefer" data-vendor-idx="${idx}" title="Mark preferred">☆</button>` : ''}
          <button class="eq-part-vendor-btn edit-btn" data-action="edit" data-vendor-idx="${idx}">✎</button>
          <button class="eq-part-vendor-btn remove-btn" data-action="remove" data-vendor-idx="${idx}">✕</button>
        </div>
      </div>
    `).join('');
  }

  function wireVendorActions(container, part, vendors) {
    // Use event delegation since the list re-renders frequently
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const idx = parseInt(btn.dataset.vendorIdx, 10);

      if (action === 'order') {
        // Let the link navigate, but log the order action
        try {
          await NX.sb.from('daily_logs').insert({
            entry: `🛒 [ORDER] ${NX.currentUser?.name || 'User'} opened ${vendors[idx].name} for "${part.part_name}" ($${vendors[idx].price || '?'})`
          });
        } catch (_) {}
        return;  // let link work
      }

      e.preventDefault();
      e.stopPropagation();

      if (action === 'prefer') {
        // Mark this vendor preferred, unmark others
        vendors.forEach((v, i) => v.is_preferred = (i === idx));
        await saveVendors(part.id, vendors);
        rerenderVendorList(container, part.id, vendors);
      } else if (action === 'edit') {
        openVendorEditor(vendors[idx], (updated) => {
          vendors[idx] = updated;
          saveVendors(part.id, vendors).then(() => 
            rerenderVendorList(container, part.id, vendors)
          );
        });
      } else if (action === 'remove') {
        if (!confirm(`Remove vendor "${vendors[idx].name}"?`)) return;
        vendors.splice(idx, 1);
        await saveVendors(part.id, vendors);
        rerenderVendorList(container, part.id, vendors);
      }
    });

    // Add vendor button
    const addBtn = container.querySelector('.eq-part-add-vendor-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        openVendorEditor(null, async (newVendor) => {
          // If this is the first vendor, mark as preferred
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
    if (list) list.innerHTML = renderVendorsList(vendors, partId);
    const label = container.querySelector('.eq-part-vendors-label');
    if (label) label.textContent = `Vendors (${vendors.length})`;
  }

  async function saveVendors(partId, vendors) {
    try {
      await NX.sb.from('equipment_parts')
        .update({ vendors })
        .eq('id', partId);
      // Also sync the legacy single-vendor fields from the preferred vendor
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
      toast('Save vendors failed: ' + e.message, 'error');
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
          <input type="text" id="vendName" class="eq-vendor-input" value="${esc(v.name)}" placeholder="Parts Town">
          
          <label class="eq-vendor-label">Order URL</label>
          <input type="url" id="vendUrl" class="eq-vendor-input" value="${esc(v.url || '')}" placeholder="https://...">
          
          <div class="eq-vendor-row">
            <div class="eq-vendor-half">
              <label class="eq-vendor-label">OEM Number</label>
              <input type="text" id="vendOem" class="eq-vendor-input" value="${esc(v.oem_number || '')}" placeholder="1701514">
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
      if (!updated.name) { toast('Vendor name required', 'info'); return; }
      onSave(updated);
      close();
    });
  }

  function formatRelative(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  /* ═════════════════════════════════════════════════════════════════════════
     5. EXTRACT FROM MANUAL — fix and surface progress/errors
     
     Wraps the existing extractBOMFromManual function with detailed progress
     feedback, better error reporting, and ensures extracted parts are saved
     with empty vendors[] so the multi-vendor UI works on them.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchExtractFromManual() {
    // Watch for the Extract from Manual button to be added, then re-wire it
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const buttons = node.querySelectorAll?.('button') || [];
          for (const btn of buttons) {
            if (/extract.*from.*manual/i.test(btn.textContent) && !btn.dataset.eqFixesWired) {
              btn.dataset.eqFixesWired = '1';
              const originalOnClick = btn.onclick;
              btn.onclick = null;
              btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Find equipment ID from context
                const modal = btn.closest('.eq-modal, .eq-detail');
                const equipId = modal?.dataset.eqId
                  || extractEquipIdFromButtons(modal)
                  || extractEquipIdFromContext(btn);
                if (!equipId) {
                  toast('Could not find equipment ID', 'error');
                  return;
                }
                await runExtractWithProgress(equipId);
              }, { capture: true });
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function extractEquipIdFromContext(btn) {
    // Look for any nearby element with data-eq-id
    let cur = btn;
    while (cur && cur !== document.body) {
      if (cur.dataset?.eqId) return cur.dataset.eqId;
      cur = cur.parentElement;
    }
    // Try query.equipment.editPart pattern in the parts panel
    const partsList = document.querySelector('.eq-parts-list');
    if (partsList) {
      const editBtn = partsList.querySelector('button[onclick*="editPart"]');
      if (editBtn) {
        // editPart is called with a part ID, not equipment ID — useless here
      }
    }
    return null;
  }

  async function runExtractWithProgress(equipId) {
    // Build a progress modal
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
    modal.querySelector('#eqExtractCancel').addEventListener('click', () => {
      cancelled = true;
      modal.remove();
    });

    const setStep = (text) => {
      const step = modal.querySelector('#eqExtractStep');
      if (step) step.textContent = text;
    };

    const showError = (msg) => {
      modal.querySelector('#eqExtractBody').innerHTML = `
        <div class="eq-extract-error">
          <div class="eq-extract-error-icon">⚠</div>
          <div class="eq-extract-error-msg">${esc(msg)}</div>
        </div>
      `;
      modal.querySelector('#eqExtractCancel').textContent = 'Close';
    };

    try {
      // Step 1: Fetch equipment
      setStep('Loading equipment details…');
      const { data: eq, error: eqErr } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
      if (eqErr) throw new Error('Equipment not found: ' + eqErr.message);
      if (cancelled) return;

      // Step 2: Check manual exists
      if (!eq.manual_url) {
        showError('No manual uploaded yet. Go to the Manual tab and upload a PDF first.');
        return;
      }

      // Step 3: Check API key
      const apiKey = NX.getApiKey?.() || NX.config?.api_key;
      if (!apiKey) {
        showError('No Anthropic API key configured. Set it in Admin → API Keys.');
        return;
      }

      // Step 4: Fetch the PDF
      setStep('Downloading manual PDF…');
      let pdfRes;
      try {
        pdfRes = await fetch(eq.manual_url);
      } catch (e) {
        showError('Could not fetch manual: ' + e.message);
        return;
      }
      if (!pdfRes.ok) {
        showError(`Manual returned HTTP ${pdfRes.status}. The file may have been moved or deleted.`);
        return;
      }
      if (cancelled) return;

      // Step 5: Convert to base64
      setStep('Preparing PDF for analysis…');
      const pdfBlob = await pdfRes.blob();
      const sizeMB = (pdfBlob.size / 1048576).toFixed(2);
      if (pdfBlob.size > 32 * 1048576) {
        showError(`Manual is ${sizeMB}MB. Claude PDF input is limited to ~32MB. Try a smaller manual.`);
        return;
      }
      const pdfBase64 = await blobToBase64(pdfBlob);
      if (cancelled) return;

      // Step 6: Send to Claude
      setStep(`Sending ${sizeMB}MB PDF to Claude (this can take 20–60 seconds)…`);
      const model = NX.getModel?.() || 'claude-sonnet-4-5';
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
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
Equipment: ${eq.manufacturer || 'Unknown manufacturer'} ${eq.model || ''}
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

If no parts are found, return [].`
              }
            ]
          }]
        })
      });
      if (cancelled) return;

      if (!resp.ok) {
        const errBody = await resp.text();
        showError(`Claude API error (${resp.status}): ${errBody.slice(0, 300)}`);
        return;
      }

      const data = await resp.json();
      if (data.error) {
        showError('Claude returned error: ' + data.error.message);
        return;
      }

      // Step 7: Parse the response
      setStep('Parsing parts list…');
      const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const arrStart = answer.indexOf('[');
      const arrEnd = answer.lastIndexOf(']');
      if (arrStart === -1 || arrEnd <= arrStart) {
        showError('Claude did not return a valid parts list. Response started with: ' + answer.slice(0, 200));
        return;
      }
      let parts;
      try {
        parts = JSON.parse(answer.slice(arrStart, arrEnd + 1));
      } catch (e) {
        showError('Could not parse Claude\'s response as JSON: ' + e.message);
        return;
      }
      if (!Array.isArray(parts) || !parts.length) {
        showError('No serviceable parts found in this manual.');
        return;
      }

      // Step 8: Show confirmation
      showExtractionConfirmation(modal, eq.id, parts);

    } catch (err) {
      console.error('[eq-fixes] extract error:', err);
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
      const selectedIdxs = Array.from(modal.querySelectorAll('input[type=checkbox]:checked'))
        .map(cb => parseInt(cb.dataset.partIdx, 10));
      const selectedParts = selectedIdxs.map(i => parts[i]);
      if (!selectedParts.length) { toast('No parts selected', 'info'); return; }
      try {
        const rows = selectedParts.map(p => ({
          equipment_id: equipId,
          part_name: p.part_name,
          oem_part_number: p.oem_part_number || null,
          quantity: p.quantity || 1,
          assembly_path: p.assembly_path || null,
          notes: p.notes || null,
          vendors: []  // empty so user can add via multi-vendor UI
        }));
        const { error } = await NX.sb.from('equipment_parts').insert(rows);
        if (error) throw error;
        toast(`Saved ${rows.length} part${rows.length === 1 ? '' : 's'}`, 'success');
        modal.remove();
        // Refresh the equipment detail so parts appear
        if (NX.modules?.equipment?.show) NX.modules.equipment.show(equipId);
      } catch (e) {
        toast('Save failed: ' + e.message, 'error');
      }
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('FileReader failed'));
      r.readAsDataURL(blob);
    });
  }

})();
