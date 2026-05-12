/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · issue detail
   ─────────────────────────────────────────────────────────────────────
   Everything that mounts INSIDE an open issue. equipment.js renders
   the upper panel; this module owns:

     §1   Financial workflow card  — quote + invoice with auto-transitions
     §2   Comments thread          — with system events
     §3   Photo capture            — 📸 button on composer
     §4   Cost anomaly warning     — statistical outlier detection

   Mount via:    NXRM.detail.mount(containerEl, issueId)
   Or place:     <div class="nxrm-detail" data-issue-id="..."></div>
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc } = NXRM;
  const BUCKET = 'issue-photos';
  const MAX_DIM = 1600;
  const JPEG_QUALITY = 0.82;

  const subs = {};                  // issueId → realtime channel
  const pendingPhotos = new Map();  // issueId → [{url, type}]
  const anomalyCache = { baselines: null, loadedAt: 0 };

  // ─────────────────────────────────────────────────────────────────────
  // FETCH
  // ─────────────────────────────────────────────────────────────────────

  async function fetchIssue(id) {
    if (!NX?.sb) return null;
    const { data } = await NX.sb.from('equipment_issues').select('*').eq('id', id).maybeSingle();
    return data;
  }
  async function fetchComments(id) {
    if (!NX?.sb) return [];
    const { data } = await NX.sb.from('equipment_issue_comments')
      .select('*').eq('issue_id', id).order('created_at', { ascending: false }).limit(200);
    return data || [];
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — FINANCIAL WORKFLOW
  // ─────────────────────────────────────────────────────────────────────

  function renderFinancialCard(issue) {
    const awaitingQuote = issue.quote_received_at && !issue.quote_approved_at && !issue.quote_rejected_at;
    const awaitingInv   = issue.invoice_received_at && !issue.invoice_paid_at;

    return `
      <div class="nxrm-finance">
        <div class="nxrm-finance-title">💰 Financial</div>
        <div class="nxrm-finance-grid">

          <div class="nxrm-finance-cell">
            <div class="nxrm-finance-lbl">Quote</div>
            <div class="nxrm-finance-val">${fmt.moneyOrDash(issue.quote_amount)}</div>
            <div class="nxrm-finance-meta">
              ${issue.quote_received_at ? 'Received ' + fmt.date(issue.quote_received_at) : 'Not received yet'}
              ${issue.quote_approved_at ? ' · ✓ Approved ' + fmt.date(issue.quote_approved_at) : ''}
              ${issue.quote_rejected_at ? ' · ✗ Rejected ' + fmt.date(issue.quote_rejected_at) : ''}
            </div>
            ${issue.quote_url ? `<a href="${esc(issue.quote_url)}" target="_blank"
              class="nxrm-finance-attach">📎 View quote PDF</a>` : ''}
            ${issue.quote_notes ? `<div class="nxrm-finance-notes">${esc(issue.quote_notes)}</div>` : ''}
            <div class="nxrm-finance-actions">
              ${!issue.quote_received_at ? `<button class="nxrm-finance-btn" data-fin="record-quote">Record quote</button>` : ''}
              ${awaitingQuote ? `
                <button class="nxrm-finance-btn is-primary" data-fin="approve-quote">✓ Approve</button>
                <button class="nxrm-finance-btn is-danger"  data-fin="reject-quote">✗ Reject</button>
              ` : ''}
              ${issue.quote_received_at && !awaitingQuote ? `<button class="nxrm-finance-btn" data-fin="edit-quote">Edit</button>` : ''}
            </div>
          </div>

          <div class="nxrm-finance-cell">
            <div class="nxrm-finance-lbl">Invoice</div>
            <div class="nxrm-finance-val">${fmt.moneyOrDash(issue.invoice_amount)}</div>
            <div class="nxrm-finance-meta">
              ${issue.invoice_received_at ? 'Received ' + fmt.date(issue.invoice_received_at) : 'Not received yet'}
              ${issue.invoice_paid_at ? ' · ✓ Paid ' + fmt.date(issue.invoice_paid_at) : ''}
            </div>
            ${issue.invoice_url ? `<a href="${esc(issue.invoice_url)}" target="_blank"
              class="nxrm-finance-attach">📎 View invoice PDF</a>` : ''}
            ${issue.invoice_notes ? `<div class="nxrm-finance-notes">${esc(issue.invoice_notes)}</div>` : ''}
            <div class="nxrm-finance-actions">
              ${!issue.invoice_received_at ? `<button class="nxrm-finance-btn" data-fin="record-invoice">Record invoice</button>` : ''}
              ${awaitingInv ? `<button class="nxrm-finance-btn is-primary" data-fin="mark-paid">✓ Mark paid</button>` : ''}
              ${issue.invoice_received_at && !awaitingInv ? `<button class="nxrm-finance-btn" data-fin="edit-invoice">Edit</button>` : ''}
            </div>
          </div>
        </div>

        ${issue.labor_cost || issue.parts_cost || issue.trip_charge ? `
          <div class="nxrm-finance-breakdown">
            ${issue.labor_cost  ? `<span>Labor: ${fmt.money(issue.labor_cost)}</span>` : ''}
            ${issue.parts_cost  ? `<span>Parts: ${fmt.money(issue.parts_cost)}</span>` : ''}
            ${issue.trip_charge ? `<span>Trip: ${fmt.money(issue.trip_charge)}</span>` : ''}
            <span class="nxrm-finance-total">Total: ${fmt.money(issue.total_cost)}</span>
          </div>
        ` : ''}

        ${issue.contractor_company ? `
          <button class="nxrm-finance-dispatch" data-act="dispatch-vendor" data-issue-id="${esc(issue.id)}">
            📞 Dispatch vendor (${esc(issue.contractor_company)})
          </button>
        ` : `
          <button class="nxrm-finance-dispatch" data-act="dispatch-vendor" data-issue-id="${esc(issue.id)}">
            📞 Assign &amp; dispatch vendor
          </button>
        `}
      </div>`;
  }

  async function handleFinanceAction(action, issueId, issue) {
    let updates = {};
    let systemMsg = null;
    let bubbleMsg = null;

    switch (action) {
      case 'record-quote': {
        const amount = prompt('Quote amount ($):', issue.quote_amount || '');
        if (amount == null) return;
        const num = parseFloat(amount);
        if (isNaN(num) || num < 0) return;
        const url = prompt('Quote PDF URL (optional):', issue.quote_url || '') || null;
        const notes = prompt('Notes about this quote (optional):', issue.quote_notes || '') || null;
        updates = {
          quote_amount: num, quote_url: url, quote_notes: notes,
          quote_received_at: new Date().toISOString(),
        };
        systemMsg = `Quote received: ${fmt.money(num)}.${url ? ' PDF attached.' : ''}`;
        break;
      }
      case 'edit-quote': {
        const amount = prompt('Quote amount ($):', issue.quote_amount || '');
        if (amount == null) return;
        const num = parseFloat(amount);
        if (isNaN(num) || num < 0) return;
        updates = { quote_amount: num };
        systemMsg = `Quote amount updated: ${fmt.money(num)}.`;
        break;
      }
      case 'approve-quote': {
        if (!confirm(`Approve quote for ${fmt.money(issue.quote_amount)}?`)) return;
        updates = { quote_approved_at: new Date().toISOString(), status: 'quote_approved' };
        systemMsg = `Quote approved: ${fmt.money(issue.quote_amount)}.`;
        bubbleMsg = 'Quote approved. The orb nods in approval.';
        break;
      }
      case 'reject-quote': {
        const why = prompt('Reason for rejection (optional):');
        if (why === null) return;
        updates = { quote_rejected_at: new Date().toISOString(), status: 'reported' };
        systemMsg = `Quote rejected.${why ? ' Reason: ' + why : ''}`;
        break;
      }
      case 'record-invoice': {
        const amount = prompt('Invoice amount ($):', issue.invoice_amount || issue.quote_amount || '');
        if (amount == null) return;
        const num = parseFloat(amount);
        if (isNaN(num) || num < 0) return;
        const url = prompt('Invoice PDF URL (optional):', issue.invoice_url || '') || null;
        const notes = prompt('Notes about this invoice (optional):', issue.invoice_notes || '') || null;
        updates = {
          invoice_amount: num, invoice_url: url, invoice_notes: notes,
          invoice_received_at: new Date().toISOString(),
          status: 'awaiting_invoice',
        };
        systemMsg = `Invoice received: ${fmt.money(num)}.${url ? ' PDF attached.' : ''}`;
        break;
      }
      case 'edit-invoice': {
        const amount = prompt('Invoice amount ($):', issue.invoice_amount || '');
        if (amount == null) return;
        const num = parseFloat(amount);
        if (isNaN(num) || num < 0) return;
        updates = { invoice_amount: num };
        systemMsg = `Invoice amount updated: ${fmt.money(num)}.`;
        break;
      }
      case 'mark-paid': {
        if (!confirm(`Mark invoice as paid (${fmt.money(issue.invoice_amount)})?`)) return;
        updates = { invoice_paid_at: new Date().toISOString(), status: 'closed' };
        systemMsg = `Invoice paid: ${fmt.money(issue.invoice_amount)}. Issue closed.`;
        bubbleMsg = 'Bzzt — invoice paid. Another work order earns its retirement.';
        break;
      }
      default: return;
    }

    if (!NX?.sb) return;
    const { error } = await NX.sb.from('equipment_issues').update(updates).eq('id', issueId);
    if (error) { alert('Failed to update: ' + error.message); return; }

    if (systemMsg) {
      await NX.sb.from('equipment_issue_comments').insert({
        issue_id: issueId,
        user_id: NX.user?.id || NX.currentUser?.id || null,
        user_name: NX.user?.name || NX.currentUser?.name || 'System',
        body: systemMsg, is_system_event: true,
      });
    }

    if (bubbleMsg) NXRM.notify.bubble(bubbleMsg, { autoHide: 4000, eyebrow: '✓' });
    await refresh(issueId);
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — COMMENTS THREAD
  // ─────────────────────────────────────────────────────────────────────

  function renderCommentsCard(comments, issueId) {
    return `
      <div class="nxrm-comments">
        <div class="nxrm-comments-title">💬 Thread (${comments.length})</div>
        <div class="nxrm-comments-list">
          ${comments.length === 0
            ? `<div class="nxrm-comments-empty">No comments yet. Add the first one below.</div>`
            : comments.map(c => `
              <div class="nxrm-comment ${c.is_system_event ? 'is-system' : ''}">
                <div class="nxrm-comment-meta">
                  <span class="nxrm-comment-author">${esc(c.user_name || 'Unknown')}</span>
                  <span>${fmt.timestamp(c.created_at)}</span>
                </div>
                <div class="nxrm-comment-body">${esc(c.body)}</div>
                ${c.attachment_url ? `
                  <a class="nxrm-comment-attach" href="${esc(c.attachment_url)}" target="_blank">
                    📎 ${esc(c.attachment_type || 'attachment')}
                  </a>` : ''}
              </div>
            `).join('')}
        </div>
        <div class="nxrm-comment-composer">
          <textarea class="nxrm-comment-input" id="nxrmComment-${esc(issueId)}"
                    placeholder="Add a comment…" rows="2"></textarea>
          <button class="nxrm-comment-photo" type="button" data-photo="${esc(issueId)}" title="Attach photo">📸</button>
          <button class="nxrm-comment-send" data-send="${esc(issueId)}" disabled>Send</button>
        </div>
        <div class="nxrm-comment-photos" data-photos="${esc(issueId)}"></div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────
  // §3 — PHOTO CAPTURE (compress + upload + attach)
  // ─────────────────────────────────────────────────────────────────────

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const cnv = document.createElement('canvas');
        cnv.width = w; cnv.height = h;
        cnv.getContext('2d').drawImage(img, 0, 0, w, h);
        cnv.toBlob(b => b ? resolve(b) : reject(new Error('Canvas blob failed')),
                   'image/jpeg', JPEG_QUALITY);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadPhoto(file, issueId) {
    if (!NX?.sb) throw new Error('No Supabase client');
    let blob = file;
    try {
      if (file.type && file.type.startsWith('image/')) blob = await compressImage(file);
    } catch (_) {}
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${issueId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await NX.sb.storage.from(BUCKET).upload(path, blob, {
      cacheControl: '3600', upsert: false, contentType: blob.type || 'image/jpeg',
    });
    if (error) throw error;
    const { data } = NX.sb.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path, type: 'photo', size: blob.size };
  }

  function wirePhotoCapture(container, issueId) {
    const photoBtn = container.querySelector(`[data-photo="${CSS.escape(issueId)}"]`);
    const chipsEl  = container.querySelector(`[data-photos="${CSS.escape(issueId)}"]`);
    if (!photoBtn || !chipsEl) return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.capture = 'environment';
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    photoBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoBtn.classList.add('is-loading');
      photoBtn.textContent = '⏳';
      try {
        const result = await uploadPhoto(file, issueId);
        const existing = pendingPhotos.get(issueId) || [];
        existing.push(result);
        pendingPhotos.set(issueId, existing);
        photoBtn.textContent = '📸';
        photoBtn.classList.remove('is-loading');
        photoBtn.classList.add('has-attached');
        updateChips(chipsEl, issueId);
      } catch (err) {
        photoBtn.textContent = '📸';
        photoBtn.classList.remove('is-loading');
        alert('Photo upload failed: ' + (err.message || err));
      }
      fileInput.value = '';
    });
  }

  function updateChips(chipsEl, issueId) {
    const photos = pendingPhotos.get(issueId) || [];
    chipsEl.innerHTML = photos.map((p, idx) => `
      <span class="nxrm-photo-chip">
        <img src="${esc(p.url)}" alt="photo">
        <button class="nxrm-photo-remove" data-remove="${idx}">×</button>
      </span>
    `).join('');
    chipsEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-remove'), 10);
        const arr = pendingPhotos.get(issueId) || [];
        arr.splice(idx, 1);
        if (arr.length === 0) pendingPhotos.delete(issueId);
        else pendingPhotos.set(issueId, arr);
        updateChips(chipsEl, issueId);
      });
    });
  }

  async function postComment(issueId, body) {
    if (!body || !body.trim()) return false;
    if (!NX?.sb) return false;
    const insert = {
      issue_id: issueId,
      user_id: NX.user?.id || NX.currentUser?.id || null,
      user_name: NX.user?.name || NX.currentUser?.name || 'You',
      body: body.trim(),
      is_system_event: false,
    };
    // Attach first pending photo as the comment's attachment; chain rest into body
    const photos = pendingPhotos.get(issueId) || [];
    if (photos.length > 0) {
      insert.attachment_url = photos[0].url;
      insert.attachment_type = photos[0].type;
      if (photos.length > 1) {
        insert.body += '\n\n' + photos.slice(1).map(p => '📎 ' + p.url).join('\n');
      }
      pendingPhotos.delete(issueId);
    }
    const { error } = await NX.sb.from('equipment_issue_comments').insert(insert);
    if (error) { alert('Failed to post: ' + error.message); return false; }
    return true;
  }

  function wireComments(container, issueId) {
    const input = container.querySelector(`#nxrmComment-${CSS.escape(issueId)}`);
    const send  = container.querySelector(`[data-send="${issueId}"]`);
    if (!input || !send) return;
    const update = () => {
      const hasPhotos = (pendingPhotos.get(issueId) || []).length > 0;
      send.disabled = !input.value.trim() && !hasPhotos;
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); }
    });
    send.addEventListener('click', async () => {
      send.disabled = true; send.textContent = 'Sending…';
      const body = input.value || '';
      const ok = await postComment(issueId, body || '(photo)');
      send.textContent = 'Send';
      if (ok) {
        input.value = '';
        await refresh(issueId);
      }
      update();
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // §4 — COST ANOMALY DETECTION (statistical)
  // ─────────────────────────────────────────────────────────────────────

  async function loadBaselines(force) {
    if (!force && anomalyCache.baselines && Date.now() - anomalyCache.loadedAt < 5 * 60 * 1000) {
      return anomalyCache.baselines;
    }
    if (!NX?.sb) return {};
    try {
      const { data } = await NX.sb.from('v_cost_anomaly').select('*');
      const map = {};
      (data || []).forEach(r => {
        map[r.equipment_id] = {
          equipment_name: r.equipment_name,
          avg: Number(r.avg_invoice) || 0,
          stddev: Number(r.stddev_invoice) || 0,
          max: Number(r.max_invoice) || 0,
          upper: Number(r.upper_threshold) || 0,
          count: Number(r.completed_count) || 0,
        };
      });
      anomalyCache.baselines = map;
      anomalyCache.loadedAt = Date.now();
      return map;
    } catch (_) { return {}; }
  }

  function evaluateAnomaly(equipmentId, amount) {
    if (!anomalyCache.baselines) return { flagged: false };
    const b = anomalyCache.baselines[equipmentId];
    if (!b || b.count < 3) return { flagged: false };
    const num = Number(amount) || 0;
    if (num <= 0) return { flagged: false };

    let severity = null, reason = '';
    if (num > b.upper && b.upper > 0) {
      severity = 'high';
      reason = `${fmt.money(num)} is above the 95th percentile for this equipment (typical: ${fmt.money(b.avg)}, max ever: ${fmt.money(b.max)}).`;
    }
    if (b.max > 0 && num / b.max > 2) {
      severity = 'extreme';
      reason = `${fmt.money(num)} is more than 2× the previous max paid (${fmt.money(b.max)}) — verify with vendor before approving.`;
    }
    if (b.avg > 0 && num / b.avg > 3) {
      severity = 'extreme';
      reason = `${fmt.money(num)} is more than 3× the historical average (${fmt.money(b.avg)} across ${b.count} jobs).`;
    }

    if (!severity) return { flagged: false, baseline: b };
    return { flagged: true, severity, reason, baseline: b };
  }

  function renderAnomalyWarning(warnings, issueId) {
    if (!warnings.length) return '';
    return `
      <div class="nxrm-anomaly-warning">
        ${warnings.map(w => `
          <div class="nxrm-anomaly anomaly-${w.severity}">
            <div class="nxrm-anomaly-glyph">${w.severity === 'extreme' ? '🚨' : '⚠'}</div>
            <div class="nxrm-anomaly-body">
              <div class="nxrm-anomaly-title">
                ${w.severity === 'extreme' ? 'COST ALERT' : 'Cost outlier'}: ${w.kind === 'quote' ? 'Quote' : 'Invoice'} ${fmt.money(w.amount)}
              </div>
              <div class="nxrm-anomaly-reason">${esc(w.reason)}</div>
              <div class="nxrm-anomaly-stats">
                History: ${w.baseline.count} jobs · avg ${fmt.money(w.baseline.avg)} · max ${fmt.money(w.baseline.max)}
              </div>
              <div class="nxrm-anomaly-actions">
                <button class="nxrm-anomaly-btn" data-anomaly="acknowledge" data-issue-id="${esc(issueId)}">
                  Acknowledged — proceed
                </button>
                <button class="nxrm-anomaly-btn is-secondary" data-anomaly="dispute" data-issue-id="${esc(issueId)}">
                  Dispute with vendor
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  function wireAnomaly(container, issueId) {
    container.querySelectorAll('[data-anomaly]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-anomaly');
        if (action === 'acknowledge') {
          const warning = btn.closest('.nxrm-anomaly-warning');
          if (warning) warning.remove();
          await NX.sb.from('equipment_issue_comments').insert({
            issue_id: issueId,
            user_id: NX.user?.id || NX.currentUser?.id || null,
            user_name: NX.user?.name || NX.currentUser?.name || 'You',
            body: 'Cost anomaly acknowledged — proceeding with approval despite higher-than-typical amount.',
            is_system_event: true,
          });
        } else if (action === 'dispute') {
          if (window.NXDispatch?.open) window.NXDispatch.open(issueId);
          else alert('Use the dispatch picker (📞 button below) to contact the vendor.');
        }
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // MOUNT + REFRESH + REALTIME
  // ─────────────────────────────────────────────────────────────────────

  async function mount(container, issueId) {
    if (!container || !issueId) return;
    container.setAttribute('data-issue-detail', issueId);
    await loadBaselines();
    const [issue, comments] = await Promise.all([fetchIssue(issueId), fetchComments(issueId)]);
    if (!issue) {
      container.innerHTML = '<div class="nxrm-empty"><div class="nxrm-empty-body">Issue not found.</div></div>';
      return;
    }

    // Compute anomalies for active money decisions
    const warnings = [];
    if (issue.quote_amount && issue.quote_received_at && !issue.invoice_paid_at) {
      const r = evaluateAnomaly(issue.equipment_id, issue.quote_amount);
      if (r.flagged) warnings.push({ kind: 'quote', amount: issue.quote_amount, ...r });
    }
    if (issue.invoice_amount && issue.invoice_received_at && !issue.invoice_paid_at) {
      const r = evaluateAnomaly(issue.equipment_id, issue.invoice_amount);
      if (r.flagged) warnings.push({ kind: 'invoice', amount: issue.invoice_amount, ...r });
    }

    container.innerHTML =
      renderAnomalyWarning(warnings, issueId) +
      renderFinancialCard(issue) +
      renderCommentsCard(comments, issueId);

    wireAnomaly(container, issueId);
    wireFinance(container, issueId, issue);
    wireComments(container, issueId);
    wirePhotoCapture(container, issueId);
    subscribeIssue(issueId);
  }

  function wireFinance(container, issueId, issue) {
    container.querySelectorAll('[data-fin]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        handleFinanceAction(el.getAttribute('data-fin'), issueId, issue);
      });
    });
  }

  function subscribeIssue(issueId) {
    if (subs[issueId] || !NX?.sb?.channel) return;
    try {
      subs[issueId] = NX.sb.channel('rm-detail-' + issueId)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'equipment_issue_comments',
              filter: 'issue_id=eq.' + issueId },
            () => refresh(issueId))
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'equipment_issues',
              filter: 'id=eq.' + issueId },
            () => refresh(issueId))
        .subscribe();
    } catch (_) {}
  }

  async function refresh(issueId) {
    const container = document.querySelector(`[data-issue-detail="${CSS.escape(issueId)}"]`);
    if (!container) return;
    await mount(container, issueId);
  }

  function unmount(issueId) {
    if (subs[issueId]) {
      try { NX.sb.removeChannel(subs[issueId]); } catch (_) {}
      delete subs[issueId];
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // AUTO-MOUNT — scan for placeholders
  // ─────────────────────────────────────────────────────────────────────

  function autoMount() {
    document.querySelectorAll('.nxrm-detail[data-issue-id]:not([data-issue-detail]), .nx-issue-enhance[data-issue-id]:not([data-issue-detail])').forEach(el => {
      const id = el.getAttribute('data-issue-id');
      if (id) mount(el, id);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(autoMount, 100));
  } else {
    setTimeout(autoMount, 100);
  }
  document.addEventListener('nx-view-changed', () => setTimeout(autoMount, 100));

  const observer = new MutationObserver(() => {
    clearTimeout(autoMount._t);
    autoMount._t = setTimeout(autoMount, 200);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () =>
    observer.observe(document.body, { childList: true, subtree: true }));

  // ─────────────────────────────────────────────────────────────────────
  // BRAIN — cost anomaly tool
  // ─────────────────────────────────────────────────────────────────────

  NXRM.brain.register({
    name: 'get_cost_anomalies',
    description: 'Currently flagged cost anomalies — quotes/invoices significantly above per-equipment historical baseline.',
    params: {},
    run: async () => {
      await loadBaselines(true);
      if (!NX?.sb) return { count: 0, anomalies: [] };
      const { data } = await NX.sb.from('v_issue_summary').select('*')
        .or('awaiting_quote_approval.eq.true,awaiting_invoice_payment.eq.true');
      const out = [];
      (data || []).forEach(i => {
        if (i.awaiting_quote_approval && i.quote_amount) {
          const r = evaluateAnomaly(i.equipment_id, i.quote_amount);
          if (r.flagged) out.push({
            issue_id: i.id, title: i.title, equipment: i.equipment_name, restaurant: i.restaurant,
            kind: 'quote', amount: i.quote_amount,
            severity: r.severity, reason: r.reason,
            baseline_avg: r.baseline?.avg, baseline_max: r.baseline?.max, baseline_count: r.baseline?.count,
          });
        }
        if (i.awaiting_invoice_payment && i.invoice_amount) {
          const r = evaluateAnomaly(i.equipment_id, i.invoice_amount);
          if (r.flagged) out.push({
            issue_id: i.id, title: i.title, equipment: i.equipment_name, restaurant: i.restaurant,
            kind: 'invoice', amount: i.invoice_amount,
            severity: r.severity, reason: r.reason,
            baseline_avg: r.baseline?.avg, baseline_max: r.baseline?.max, baseline_count: r.baseline?.count,
          });
        }
      });
      return { count: out.length, anomalies: out };
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  NXRM.detail = { mount, refresh, unmount };
  window.NXIssueEnhance = NXRM.detail; // back-compat alias
})();
