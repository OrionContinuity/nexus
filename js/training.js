/* ════════════════════════════════════════════════════════════════════════════
   NEXUS Training v1 — staff certifications, videos, in-person sign-offs
   ────────────────────────────────────────────────────────────────────────────
   Same architectural pattern as the cleaning module (v12): DB-backed catalog,
   bilingual content, per-section cards with inline edit forms, photo evidence,
   email reports via the shared NX.email engine, archive via NX.archive.

   Concepts:
     • Module — one piece of training (a video, a doc, an in-person walkthrough,
       a quiz, or a certification with expiration). Lives in training_modules.
     • Completion — one row in training_completions per (user × module). New
       row for each renewal cycle; the most recent one determines current status.
     • Status (per module per user):
         done       — completed, not expiring within 30d
         expiring   — completed, expires in ≤ 30d
         expired    — completed but past expiration
         pending    — never completed (and required_for_role matches)
         na         — not required for this user's role

   Three view modes (segmented control at top, like cleaning):
     mine     — current user only: pending + expiring + expired up top
     team     — manager view: matrix of users vs modules
     catalog  — admin view: edit modules, add/archive

   Shares: NX.composer, NX.toast, NX.email, NX.archive, NX.i18n, NX.currentUser.
   Dependencies on cleaning are zero — this is a parallel module.
   ════════════════════════════════════════════════════════════════════════════ */

(function () {

  // ─── INLINE SVGS ───────────────────────────────────────────────────────
  const ICONS = {
    check:    '<polyline points="20 6 9 17 4 12"/>',
    circle:   '<circle cx="12" cy="12" r="9"/>',
    close:    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    pen:      '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    chevron:  '<polyline points="6 9 12 15 18 9"/>',
    play:     '<polygon points="5 3 19 12 5 21 5 3"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    award:    '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    camera:   '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    archive:  '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
    mail:     '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  };
  function svg(key, size = 14, stroke = 2) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0">${ICONS[key] || ''}</svg>`;
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // ─── CONSTANTS ────────────────────────────────────────────────────────
  const KIND_DEFS = [
    { type: 'video',         label: 'Video',         icon: 'play',     selfComplete: true  },
    { type: 'document',      label: 'Document',      icon: 'document', selfComplete: true  },
    { type: 'in_person',     label: 'In-person',     icon: 'user',     selfComplete: false },
    { type: 'quiz',          label: 'Quiz',          icon: 'check',    selfComplete: true  },
    { type: 'certification', label: 'Certification', icon: 'award',    selfComplete: true  },
  ];
  const KIND_BY_TYPE = Object.fromEntries(KIND_DEFS.map(k => [k.type, k]));

  const RENEWAL_DEFS = [
    { type: 'one_time', label: 'One-time',  days: null  },
    { type: 'annual',   label: 'Yearly',    days: 365   },
    { type: 'biennial', label: 'Every 2 yrs', days: 730 },
    { type: 'custom',   label: 'Custom',    days: null  },
  ];
  const RENEWAL_BY_TYPE = Object.fromEntries(RENEWAL_DEFS.map(r => [r.type, r]));

  const ROLE_DEFS = [
    { value: 'all',      label: 'Everyone' },
    { value: 'foh',      label: 'Front of house' },
    { value: 'boh',      label: 'Back of house' },
    { value: 'manager',  label: 'Managers' },
  ];

  // Status thresholds (days before expiry to flag as "expiring")
  const EXPIRING_SOON_DAYS = 30;

  const VIEW_MODES = ['mine', 'team', 'catalog'];

  // ─── STATE ────────────────────────────────────────────────────────────
  let modules = [];                // array of catalog modules
  let completionsByModule = {};    // { moduleId: [completions sorted desc by completed_at] }
  let attachmentsByCompletion = {};
  // Module-level attachments — SOP PDFs/diagrams/images uploaded ONCE
  // for the module itself (not per completion). Distributed to all
  // staff so they can review materials inline. Keyed by module_id.
  let attachmentsByModule = {};
  let usersList = [];              // all users for assignee/team views
  let viewMode = (() => {
    try {
      const v = localStorage.getItem('nexus_train_view');
      return VIEW_MODES.includes(v) ? v : 'mine';
    } catch (e) { return 'mine'; }
  })();
  let editingModuleId = null;
  let addingToCategory = null;
  let collapsedCategories = new Set();

  function setViewMode(m) {
    if (!VIEW_MODES.includes(m)) return;
    viewMode = m;
    try { localStorage.setItem('nexus_train_view', m); } catch (e) {}
    render();
  }

  // ─── ENVIRONMENT HELPERS ──────────────────────────────────────────────
  function getUserName() {
    return (window.NX && NX.currentUser && NX.currentUser.name) || 'Unknown';
  }
  function getCurrentUserId() {
    return (window.NX && NX.currentUser && NX.currentUser.id) || null;
  }
  function getRole() {
    return (window.NX && NX.currentUser && NX.currentUser.role) || 'staff';
  }
  function isManager() {
    const r = getRole();
    return r === 'manager' || r === 'admin';
  }
  function getLang() {
    return (window.NX && NX.i18n && typeof NX.i18n.getLang === 'function')
      ? NX.i18n.getLang() : 'en';
  }
  function toast(msg, kind, ms) {
    if (window.NX && NX.toast) NX.toast(msg, kind || 'info', ms || 1800);
  }

  // ─── DATE HELPERS ─────────────────────────────────────────────────────
  function daysBetween(a, b) {
    return Math.floor((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
  }
  function daysUntil(d) {
    return Math.floor((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
  }
  function fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString([], {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  // ─── DB: load catalog ────────────────────────────────────────────────
  async function loadModules() {
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('training_modules')
        .select('*')
        .eq('archived', false)
        .order('category_order', { ascending: true })
        .order('module_order',   { ascending: true });
      if (error) { console.warn('[training] loadModules:', error); return; }
      modules = data || [];
    } catch (e) {
      console.error('[training] loadModules:', e);
    }
  }

  // ─── DB: load completions for all modules (latest per user) ──────────
  async function loadCompletions() {
    completionsByModule = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('training_completions')
        .select('id, module_id, user_id, user_name, completed_at, expires_at, score, signed_off_by, notes')
        .order('completed_at', { ascending: false })
        .limit(2000);
      if (error) { console.warn('[training] loadCompletions:', error); return; }
      (data || []).forEach(c => {
        if (!completionsByModule[c.module_id]) completionsByModule[c.module_id] = [];
        completionsByModule[c.module_id].push(c);
      });
    } catch (e) {
      console.error('[training] loadCompletions:', e);
    }
  }

  async function loadAttachments() {
    attachmentsByCompletion = {};
    attachmentsByModule = {};
    if (!NX.sb || NX.paused) return;
    try {
      // Per-completion attachments (certificates from staff)
      const { data: comps, error: compErr } = await NX.sb.from('training_attachments')
        .select('id, completion_id, file_url, mime_type, caption, uploaded_by, created_at')
        .not('completion_id', 'is', null)
        .order('created_at', { ascending: true });
      if (compErr) { console.warn('[training] loadAttachments comp:', compErr); }
      (comps || []).forEach(a => {
        if (!attachmentsByCompletion[a.completion_id]) attachmentsByCompletion[a.completion_id] = [];
        attachmentsByCompletion[a.completion_id].push(a);
      });

      // Module-level attachments (SOP PDFs/diagrams admin-uploaded for everyone)
      const { data: mods, error: modErr } = await NX.sb.from('training_attachments')
        .select('id, module_id, file_url, mime_type, caption, uploaded_by, created_at')
        .not('module_id', 'is', null)
        .order('created_at', { ascending: true });
      if (modErr) { console.warn('[training] loadAttachments mod:', modErr); }
      (mods || []).forEach(a => {
        if (!attachmentsByModule[a.module_id]) attachmentsByModule[a.module_id] = [];
        attachmentsByModule[a.module_id].push(a);
      });
    } catch (e) {
      console.error('[training] loadAttachments:', e);
    }
  }

  async function loadUsers() {
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.rpc('list_user_names');
      if (!error && Array.isArray(data)) { usersList = data; return; }
      const fb = await NX.sb.from('nexus_users').select('id, name, role').order('name');
      if (!fb.error) usersList = fb.data || [];
    } catch (e) {
      console.warn('[training] loadUsers:', e);
      usersList = [];
    }
  }

  // ─── HELPERS: status calc per module per user ────────────────────────
  function latestCompletionFor(moduleId, userId) {
    const list = completionsByModule[moduleId] || [];
    return list.find(c => c.user_id === userId) || null;
  }

  function statusForModule(mod, userId) {
    // Role gate first
    if (mod.required_for_role && mod.required_for_role !== 'all') {
      const role = (usersList.find(u => u.id === userId)?.role || 'staff').toLowerCase();
      if (role !== mod.required_for_role && role !== 'admin' && role !== 'manager') {
        return 'na';
      }
    }
    const c = latestCompletionFor(mod.id, userId);
    if (!c) return 'pending';
    if (c.expires_at) {
      const d = daysUntil(c.expires_at);
      if (d < 0) return 'expired';
      if (d <= EXPIRING_SOON_DAYS) return 'expiring';
    }
    return 'done';
  }

  function statusClass(status) {
    return ({
      done:     'is-done',
      expiring: 'is-expiring',
      expired:  'is-expired',
      pending:  'is-pending',
      na:       'is-na',
    })[status] || '';
  }

  function statusLabel(status, completion) {
    if (status === 'done') {
      const expStr = completion?.expires_at ? ` · expires ${fmtDate(completion.expires_at)}` : '';
      return `Done${expStr}`;
    }
    if (status === 'expiring' && completion?.expires_at) {
      const d = daysUntil(completion.expires_at);
      return `Expiring · ${d === 0 ? 'today' : `${d}d left`}`;
    }
    if (status === 'expired' && completion?.expires_at) {
      const d = -daysUntil(completion.expires_at);
      return `Expired ${d}d ago`;
    }
    if (status === 'pending') return 'Pending';
    if (status === 'na')      return 'N/A';
    return '';
  }

  // ─── GROUP modules by category ───────────────────────────────────────
  function modulesByCategory() {
    const groups = new Map();
    modules.forEach(m => {
      if (!groups.has(m.category_es)) {
        groups.set(m.category_es, {
          category_es:    m.category_es,
          category_en:    m.category_en,
          category_order: m.category_order,
          modules: [],
        });
      }
      groups.get(m.category_es).modules.push(m);
    });
    return Array.from(groups.values()).sort((a, b) => a.category_order - b.category_order);
  }

  // ─── COMPLETIONS: mark complete for current user ─────────────────────
  async function markComplete(mod, options = {}) {
    if (!NX.sb) { toast('Database unavailable', 'error'); return; }
    const userId = getCurrentUserId();
    if (!userId) { toast('Not signed in', 'warn'); return; }

    // Compute expires_at based on renewal type
    const renewal = RENEWAL_BY_TYPE[mod.renewal_type] || RENEWAL_BY_TYPE.one_time;
    let expiresAt = null;
    if (renewal.days) {
      expiresAt = new Date(Date.now() + renewal.days * 86400000).toISOString();
    } else if (mod.renewal_type === 'custom' && mod.expires_after_days) {
      expiresAt = new Date(Date.now() + mod.expires_after_days * 86400000).toISOString();
    }

    try {
      const { data, error } = await NX.sb.from('training_completions').insert({
        module_id:        mod.id,
        user_id:          userId,
        user_name:        getUserName(),
        completed_at:     new Date().toISOString(),
        expires_at:       expiresAt,
        score:            options.score || null,
        signed_off_by:    options.signedOffBy || null,
        signed_off_by_id: options.signedOffById || null,
        notes:            options.notes || null,
      }).select().single();
      if (error) throw error;
      await loadCompletions();
      render();
      refreshNavBadge();
      toast(`Marked complete${expiresAt ? ` · expires ${fmtDate(expiresAt)}` : ''}`, 'info', 2200);
      return data;
    } catch (e) {
      console.error('[training] markComplete:', e);
      toast('Could not save: ' + (e.message || ''), 'error');
    }
  }

  async function unmarkLatestCompletion(mod) {
    if (!NX.sb) return;
    const userId = getCurrentUserId();
    if (!userId) return;
    const c = latestCompletionFor(mod.id, userId);
    if (!c) return;
    if (!confirm(`Remove your completion of "${mod.name_en}"?`)) return;
    try {
      const { error } = await NX.sb.from('training_completions').delete().eq('id', c.id);
      if (error) throw error;
      await loadCompletions();
      render();
      refreshNavBadge();
      toast('Completion removed', 'info', 1600);
    } catch (e) {
      toast('Could not remove: ' + (e.message || ''), 'error');
    }
  }

  // Manager sign-off: completes a module on behalf of another user.
  function openSignOffDialog(mod) {
    if (!NX.composer?.modal) return;
    if (!isManager()) { toast('Manager-only action', 'warn'); return; }
    const userOptions = ['<option value="">Select staff…</option>']
      .concat(usersList.map(u =>
        `<option value="${u.id}">${esc(u.name)}${u.role ? ` · ${esc(u.role)}` : ''}</option>`
      )).join('');
    NX.composer.modal({
      title: `Sign off: ${mod.name_en}`,
      subtitle: `Record an in-person completion. Your name (${getUserName()}) goes on the record.`,
      buttonLabel: 'Sign off',
      fields: [
        { name: 'user_id', label: 'For staff member', type: 'select',
          options: usersList.map(u => ({ value: u.id, label: u.name })),
          autofocus: true },
        { name: 'notes',   label: 'Notes (optional)' },
      ],
      onSubmit: async ({ user_id, notes }) => {
        const uid = parseInt(user_id, 10);
        if (!uid) throw new Error('Pick a staff member');
        const u = usersList.find(x => x.id === uid);
        const renewal = RENEWAL_BY_TYPE[mod.renewal_type] || RENEWAL_BY_TYPE.one_time;
        let expiresAt = null;
        if (renewal.days) {
          expiresAt = new Date(Date.now() + renewal.days * 86400000).toISOString();
        }
        const { error } = await NX.sb.from('training_completions').insert({
          module_id:        mod.id,
          user_id:          uid,
          user_name:        u?.name || null,
          completed_at:     new Date().toISOString(),
          expires_at:       expiresAt,
          signed_off_by:    getUserName(),
          signed_off_by_id: getCurrentUserId(),
          notes:            notes || null,
        });
        if (error) throw error;
        await loadCompletions();
        render();
        refreshNavBadge();
        toast(`Signed off for ${u?.name || 'staff'}`, 'info', 2200);
      },
    });
  }

  // ─── PHOTO / CERTIFICATE UPLOAD ──────────────────────────────────────
  async function uploadCertificateForCompletion(completionId, mod) {
    if (!NX.sb) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const MAX_SIZE = 15 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        toast('File too large (max 15MB)', 'error', 4000);
        return;
      }
      toast('Uploading…', 'info', 8000);
      try {
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_');
        const fname = `${mod.id}/${completionId}-${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('training-attachments')
          .upload(fname, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = NX.sb.storage
          .from('training-attachments').getPublicUrl(fname);
        const { error: dbErr } = await NX.sb.from('training_attachments').insert({
          completion_id:  completionId,
          file_url:       publicUrl,
          mime_type:      file.type,
          file_size:      file.size,
          uploaded_by:    getUserName(),
          uploaded_by_id: getCurrentUserId(),
        });
        if (dbErr) throw dbErr;
        await loadAttachments();
        render();
        toast('Certificate saved', 'info', 1600);
      } catch (e) {
        console.error('[training] upload:', e);
        toast('Upload failed: ' + (e.message || ''), 'error', 4500);
      }
    });
    input.click();
  }

  async function deleteAttachment(id, fileUrl) {
    if (!confirm('Delete this attachment?')) return;
    if (!NX.sb) return;
    try {
      const m = (fileUrl || '').match(/training-attachments\/(.+)$/);
      if (m && m[1]) {
        await NX.sb.storage.from('training-attachments').remove([m[1]]);
      }
      await NX.sb.from('training_attachments').delete().eq('id', id);
      await loadAttachments();
      render();
      toast('Removed', 'info', 1400);
    } catch (e) {
      toast('Could not delete', 'error');
    }
  }

  function openAttachmentViewer(url) {
    // PDFs open in a new tab; images render inline in the lightbox.
    const isPdf = /\.pdf(\?|$)/i.test(url) || /pdf/i.test(url);
    if (isPdf) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const v = document.createElement('div');
    v.className = 'train-photo-viewer';
    v.innerHTML = `
      <div class="train-photo-viewer-bg"></div>
      <img class="train-photo-viewer-img" src="${esc(url)}" alt="">
      <button class="train-photo-viewer-close">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    const close = () => v.remove();
    v.querySelector('.train-photo-viewer-bg').addEventListener('click', close);
    v.querySelector('.train-photo-viewer-close').addEventListener('click', close);
    document.body.appendChild(v);
  }


  // ═══ MODULE-LEVEL ATTACHMENTS (v13) ══════════════════════════════════
  // Upload reference docs (PDFs, diagrams, photos) to a training module
  // itself — distinct from per-completion certificates. Visible to all
  // staff in their Mine view + in the catalog. Replaces "must follow an
  // external link" with self-contained training inside NEXUS.
  async function uploadModuleAttachment(mod) {
    if (!NX.sb) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const MAX_SIZE = 25 * 1024 * 1024;  // 25MB for module SOPs
      if (file.size > MAX_SIZE) {
        toast('File too large (max 25MB)', 'error', 4000);
        return;
      }
      toast('Uploading…', 'info', 8000);
      try {
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_');
        const fname = `module/${mod.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('training-attachments')
          .upload(fname, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = NX.sb.storage
          .from('training-attachments').getPublicUrl(fname);
        const { error: dbErr } = await NX.sb.from('training_attachments').insert({
          module_id:      mod.id,
          file_url:       publicUrl,
          mime_type:      file.type,
          file_size:      file.size,
          caption:        file.name,
          uploaded_by:    getUserName(),
          uploaded_by_id: getCurrentUserId(),
        });
        if (dbErr) throw dbErr;
        await loadAttachments();
        render();
        toast('Resource uploaded', 'info', 1600);
      } catch (e) {
        console.error('[training] module upload:', e);
        toast('Upload failed: ' + (e.message || ''), 'error', 4500);
      }
    });
    input.click();
  }


  // ═══ BULK SIGN-OFF (v13) ═════════════════════════════════════════════
  // Manager picks a module + multi-selects staff → one INSERT per staff.
  // Used for in-person training sessions where the manager runs through
  // the topic with multiple hires at once and certifies everyone.
  function openBulkSignOffDialog(preselectedModuleId) {
    if (!isManager()) { toast('Manager-only action', 'warn'); return; }
    if (!modules.length) { toast('No modules to sign off', 'info'); return; }
    if (!usersList.length) { toast('No staff loaded', 'info'); return; }

    const sheet = document.createElement('div');
    sheet.className = 'train-bulk-sheet';
    sheet.innerHTML = `
      <div class="train-bulk-bg"></div>
      <div class="train-bulk-card">
        <div class="train-bulk-head">
          <div class="train-bulk-title">Bulk sign-off</div>
          <button class="train-bulk-close" aria-label="Close">×</button>
        </div>
        <div class="train-bulk-sub">Pick a module, then check staff to sign off in one action. Useful for in-person training sessions.</div>

        <label class="train-bulk-label">Module</label>
        <select class="train-bulk-select" data-module-select>
          <option value="">— Pick a module —</option>
          ${modules.map(m => `
            <option value="${esc(m.id)}" ${m.id === preselectedModuleId ? 'selected' : ''}>${esc(m.name_en)} · ${esc(m.category_en)}</option>
          `).join('')}
        </select>

        <label class="train-bulk-label">Staff (tap to toggle)</label>
        <div class="train-bulk-staff" data-staff-list>
          ${usersList.map(u => `
            <label class="train-bulk-staff-row">
              <input type="checkbox" class="train-bulk-staff-cb" data-user-id="${esc(u.id)}">
              <span class="train-bulk-staff-name">${esc(u.name)}</span>
              ${u.role ? `<span class="train-bulk-staff-role">${esc(u.role)}</span>` : ''}
            </label>
          `).join('')}
        </div>

        <div class="train-bulk-actions">
          <button class="train-bulk-cancel">Cancel</button>
          <button class="train-bulk-confirm">Sign off (<span data-bulk-count>0</span>)</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.train-bulk-bg').addEventListener('click', close);
    sheet.querySelector('.train-bulk-close').addEventListener('click', close);
    sheet.querySelector('.train-bulk-cancel').addEventListener('click', close);

    // Update count on each checkbox change
    const updateCount = () => {
      const count = sheet.querySelectorAll('.train-bulk-staff-cb:checked').length;
      sheet.querySelector('[data-bulk-count]').textContent = count;
    };
    sheet.querySelectorAll('.train-bulk-staff-cb').forEach(cb => {
      cb.addEventListener('change', updateCount);
    });

    sheet.querySelector('.train-bulk-confirm').addEventListener('click', async () => {
      const moduleId = sheet.querySelector('[data-module-select]').value;
      const userIds = Array.from(sheet.querySelectorAll('.train-bulk-staff-cb:checked'))
        .map(cb => parseInt(cb.dataset.userId, 10));
      if (!moduleId) { toast('Pick a module', 'warn'); return; }
      if (!userIds.length) { toast('Pick at least one staff member', 'warn'); return; }

      const mod = modules.find(m => m.id === moduleId);
      if (!mod) { toast('Module not found', 'error'); return; }

      // Compute expires_at once for all
      const renewal = RENEWAL_BY_TYPE[mod.renewal_type] || RENEWAL_BY_TYPE.one_time;
      let expiresAt = null;
      if (renewal.days) expiresAt = new Date(Date.now() + renewal.days * 86400000).toISOString();
      else if (mod.renewal_type === 'custom' && mod.expires_after_days) {
        expiresAt = new Date(Date.now() + mod.expires_after_days * 86400000).toISOString();
      }

      const confirmBtn = sheet.querySelector('.train-bulk-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Signing off…';
      try {
        const rows = userIds.map(uid => {
          const u = usersList.find(x => x.id === uid);
          return {
            module_id:        moduleId,
            user_id:          uid,
            user_name:        u?.name || null,
            completed_at:     new Date().toISOString(),
            expires_at:       expiresAt,
            signed_off_by:    getUserName(),
            signed_off_by_id: getCurrentUserId(),
            notes:            'Bulk sign-off',
          };
        });
        const { error } = await NX.sb.from('training_completions').insert(rows);
        if (error) throw error;
        close();
        await loadCompletions();
        render();
        refreshNavBadge();
        toast(`Signed off ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}`, 'info', 2400);
      } catch (e) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = `Sign off (${userIds.length})`;
        toast('Bulk sign-off failed: ' + (e.message || ''), 'error', 4500);
      }
    });
  }


  // ─── DB: save / archive / restore module ─────────────────────────────
  async function saveModule(existingId, payload) {
    if (!NX.sb) throw new Error('Database unavailable');
    if (existingId) {
      const { error } = await NX.sb.from('training_modules').update(payload).eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await NX.sb.from('training_modules').insert(payload);
      if (error) throw error;
    }
  }

  async function archiveModule(moduleId) {
    if (!NX.sb) return;
    const { error } = await NX.sb.from('training_modules')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('id', moduleId);
    if (error) throw error;
  }

  async function restoreModule(moduleId) {
    if (!NX.sb) return;
    const { error } = await NX.sb.from('training_modules')
      .update({ archived: false, archived_at: null })
      .eq('id', moduleId);
    if (error) throw error;
    await loadModules();
    render();
  }

  async function fetchArchivedModules() {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb.from('training_modules')
      .select('*').eq('archived', true)
      .order('archived_at', { ascending: false }).limit(200);
    if (error) { console.warn('[training] fetchArchived:', error); return []; }
    return data || [];
  }

  // ═══ RENDER ════════════════════════════════════════════════════════════

  function render() {
    const list = document.getElementById('trainList');
    if (!list) return;
    list.innerHTML = '';

    // Top toggle: Mine | Team | Catalog (Team hidden for non-managers)
    const toggle = document.createElement('div');
    toggle.className = 'train-view-toggle';
    const tabs = isManager()
      ? [['mine','Mine'], ['team','Team'], ['catalog','Catalog']]
      : [['mine','Mine'], ['catalog','Catalog']];
    toggle.innerHTML = tabs.map(([v, label]) =>
      `<button class="train-view-toggle-btn ${viewMode === v ? 'is-active' : ''}" data-view="${v}">${esc(label)}</button>`
    ).join('');
    toggle.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });
    list.appendChild(toggle);

    if (!modules.length) {
      list.innerHTML += `
        <div class="train-empty">
          <div class="train-empty-title">No training modules</div>
          <div class="train-empty-hint">Switch to <b>Catalog</b> and tap <b>+ Add module</b> to start building.</div>
        </div>`;
      if (isManager()) renderCatalogFooter(list);
      return;
    }

    if (viewMode === 'mine')        renderMineView(list);
    else if (viewMode === 'team')   renderTeamView(list);
    else if (viewMode === 'catalog') renderCatalogView(list);
  }

  // ─── MINE VIEW ───────────────────────────────────────────────────────
  function renderMineView(list) {
    const userId = getCurrentUserId();
    if (!userId) {
      list.innerHTML += '<div class="train-empty"><div class="train-empty-title">Not signed in</div></div>';
      return;
    }

    // Bucket modules by status for the current user
    const buckets = { expired: [], expiring: [], pending: [], done: [] };
    for (const m of modules) {
      const s = statusForModule(m, userId);
      if (s === 'na') continue;
      if (buckets[s]) buckets[s].push(m);
    }

    // Top summary card
    const summary = document.createElement('div');
    summary.className = 'train-summary';
    summary.innerHTML = `
      <div class="train-summary-title">${esc(getUserName())}</div>
      <div class="train-summary-stats">
        <div class="train-summary-stat is-pending"><span class="train-summary-num">${buckets.pending.length}</span><span class="train-summary-lbl">Pending</span></div>
        <div class="train-summary-stat is-expiring"><span class="train-summary-num">${buckets.expiring.length}</span><span class="train-summary-lbl">Expiring</span></div>
        <div class="train-summary-stat is-expired"><span class="train-summary-num">${buckets.expired.length}</span><span class="train-summary-lbl">Expired</span></div>
        <div class="train-summary-stat is-done"><span class="train-summary-num">${buckets.done.length}</span><span class="train-summary-lbl">Done</span></div>
      </div>`;
    list.appendChild(summary);

    // Render each bucket as its own pseudo-section if non-empty
    const order = [
      ['expired',  'Expired',       'is-expired'],
      ['expiring', 'Expiring soon', 'is-expiring'],
      ['pending',  'Pending',       'is-pending'],
      ['done',     'Completed',     'is-done'],
    ];
    for (const [key, label, cls] of order) {
      if (!buckets[key].length) continue;
      const section = document.createElement('div');
      section.className = `train-section ${cls}`;
      section.innerHTML = `
        <div class="train-section-head">
          <span class="train-section-title">${esc(label)}</span>
          <span class="train-section-count">${buckets[key].length}</span>
        </div>
        <div class="train-section-body" data-bucket="${key}"></div>
      `;
      list.appendChild(section);
      const body = section.querySelector(`[data-bucket="${key}"]`);
      buckets[key].forEach(mod => {
        body.appendChild(renderMineRow(mod, userId, key));
      });
    }
  }

  function renderMineRow(mod, userId, status) {
    const lang = getLang();
    const completion = latestCompletionFor(mod.id, userId);
    const kindDef = KIND_BY_TYPE[mod.kind];
    const renewal = RENEWAL_BY_TYPE[mod.renewal_type];
    const row = document.createElement('div');
    row.className = `train-row ${statusClass(status)}`;

    const primary   = lang === 'es' ? mod.name_es : mod.name_en;
    const secondary = lang === 'es' ? mod.name_en : mod.name_es;
    const desc      = lang === 'es' ? mod.description_es : mod.description_en;

    // Status-dependent action button
    let actionBtn;
    if (status === 'done') {
      actionBtn = `<button class="train-row-action is-secondary" data-action="undo">Mark not done</button>`;
    } else if (kindDef && kindDef.selfComplete) {
      actionBtn = `<button class="train-row-action" data-action="complete">${svg('check', 14, 2.5)} <span>Mark complete</span></button>`;
    } else {
      actionBtn = `<button class="train-row-action is-secondary" data-action="request">Awaiting sign-off</button>`;
    }

    // Resource link button (if URL exists)
    const resourceBtn = mod.resource_url ? `
      <a class="train-row-resource" href="${esc(mod.resource_url)}" target="_blank" rel="noopener noreferrer">
        ${svg(kindDef?.icon || 'external', 14)} <span>Open</span>
      </a>` : '';

    // Cert / photo thumbnails for completion
    const photos = completion ? (attachmentsByCompletion[completion.id] || []) : [];
    const photosHTML = photos.length ? `
      <div class="train-row-photos">
        ${photos.map(p => `
          <button class="train-row-photo" data-photo-url="${esc(p.file_url)}" data-photo-id="${esc(p.id)}">
            <img src="${esc(p.file_url)}" alt="" loading="lazy">
          </button>`).join('')}
      </div>` : '';

    // Module-level attachments (SOPs, diagrams, reference PDFs) — same
    // for everyone, distinct from per-completion certs above.
    const modAtts = attachmentsByModule[mod.id] || [];
    const modAttsHTML = modAtts.length ? `
      <div class="train-row-resources">
        <div class="train-row-resources-label">${svg('document', 11)} Resources</div>
        ${modAtts.map(a => {
          const isPdf = /pdf/i.test(a.mime_type || '') || /\.pdf(\?|$)/i.test(a.file_url);
          const fileName = a.caption || (a.file_url.split('/').pop() || 'File');
          return `
            <button class="train-row-resource-item" data-mod-att-url="${esc(a.file_url)}">
              ${svg(isPdf ? 'document' : 'camera', 12)}
              <span>${esc(fileName.length > 32 ? fileName.slice(0, 30) + '…' : fileName)}</span>
            </button>`;
        }).join('')}
      </div>` : '';

    row.innerHTML = `
      <div class="train-row-body">
        <div class="train-row-head">
          <div class="train-row-name">${esc(primary)}</div>
          <span class="train-status-pill ${statusClass(status)}">${esc(statusLabel(status, completion))}</span>
        </div>
        <div class="train-row-meta">
          ${secondary && secondary !== primary ? `<span class="train-row-secondary">${esc(secondary)}</span>` : ''}
          <span class="train-kind-tag">${svg(kindDef?.icon || 'document', 11)} ${esc(kindDef?.label || mod.kind)}</span>
          ${renewal && renewal.type !== 'one_time' ? `<span class="train-renewal-tag">${svg('clock', 11)} ${esc(renewal.label)}</span>` : ''}
          ${mod.mandatory ? '<span class="train-mandatory-tag">Required</span>' : ''}
        </div>
        ${desc ? `<div class="train-row-desc">${esc(desc)}</div>` : ''}
        ${modAttsHTML}
        ${photosHTML}
      </div>
      <div class="train-row-side">
        ${resourceBtn}
        ${actionBtn}
        ${completion ? `<button class="train-row-cert" data-action="add-cert" title="Attach certificate">${svg('camera', 14)}</button>` : ''}
      </div>
    `;

    // Tap a module-level attachment → viewer (PDFs open in new tab)
    row.querySelectorAll('[data-mod-att-url]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAttachmentViewer(btn.dataset.modAttUrl);
      });
    });

    // Wire actions
    row.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'complete') {
          await markComplete(mod);
        } else if (action === 'undo') {
          await unmarkLatestCompletion(mod);
        } else if (action === 'request') {
          toast('Ask a manager for an in-person sign-off', 'info', 2400);
        } else if (action === 'add-cert' && completion) {
          await uploadCertificateForCompletion(completion.id, mod);
        }
      });
    });

    // Photo thumbnail viewers
    row.querySelectorAll('[data-photo-url]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAttachmentViewer(btn.dataset.photoUrl);
      });
      let pressTimer = null;
      const startPress = () => {
        pressTimer = setTimeout(() => {
          deleteAttachment(btn.dataset.photoId, btn.dataset.photoUrl);
        }, 700);
      };
      const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
      btn.addEventListener('touchstart', startPress, { passive: true });
      btn.addEventListener('touchend',   cancelPress);
      btn.addEventListener('touchcancel', cancelPress);
      btn.addEventListener('mousedown',  startPress);
      btn.addEventListener('mouseup',    cancelPress);
      btn.addEventListener('mouseleave', cancelPress);
    });

    return row;
  }

  // ─── TEAM VIEW ───────────────────────────────────────────────────────
  // Matrix: rows = users, columns = mandatory modules.
  function renderTeamView(list) {
    if (!isManager()) {
      list.innerHTML += '<div class="train-empty"><div class="train-empty-title">Manager-only view</div></div>';
      return;
    }
    if (!usersList.length) {
      list.innerHTML += '<div class="train-empty"><div class="train-empty-title">No users loaded</div></div>';
      return;
    }
    // Aggregate compliance by user — count of (pending + expiring + expired)
    const summary = usersList.map(u => {
      let pending = 0, expiring = 0, expired = 0, done = 0, na = 0;
      for (const m of modules) {
        if (!m.mandatory) continue;
        const s = statusForModule(m, u.id);
        if (s === 'pending')  pending++;
        else if (s === 'expiring') expiring++;
        else if (s === 'expired')  expired++;
        else if (s === 'done')     done++;
        else if (s === 'na')       na++;
      }
      return { user: u, pending, expiring, expired, done, na };
    });
    // Sort: most-gaps first
    summary.sort((a, b) =>
      (b.pending + b.expiring + b.expired) - (a.pending + a.expiring + a.expired));

    const wrap = document.createElement('div');
    wrap.className = 'train-team';
    wrap.innerHTML = `
      <div class="train-team-head">
        <span>Staff</span>
        <span class="train-team-head-sub">Compliance gaps first</span>
        <button class="train-team-bulk-btn" data-bulk-signoff>${svg('check', 11, 2.5)} <span>Bulk sign-off</span></button>
      </div>
      ${summary.map(s => {
        const gap = s.pending + s.expiring + s.expired;
        const cls = gap === 0 ? 'is-clean' : (gap <= 2 ? 'is-warn' : 'is-bad');
        return `
          <div class="train-team-row ${cls}" data-user-id="${esc(s.user.id)}">
            <div class="train-team-name">
              <span class="train-team-name-text">${esc(s.user.name)}</span>
              ${s.user.role ? `<span class="train-team-role">${esc(s.user.role)}</span>` : ''}
            </div>
            <div class="train-team-stats">
              ${s.expired  ? `<span class="train-team-stat is-expired"  title="Expired">${s.expired}</span>` : ''}
              ${s.expiring ? `<span class="train-team-stat is-expiring" title="Expiring">${s.expiring}</span>` : ''}
              ${s.pending  ? `<span class="train-team-stat is-pending"  title="Pending">${s.pending}</span>`  : ''}
              <span class="train-team-stat is-done" title="Done">${s.done}</span>
            </div>
            <button class="train-team-expand" data-expand-user="${esc(s.user.id)}" aria-label="Show details">${svg('chevron', 14)}</button>
          </div>
          <div class="train-team-detail" data-detail-for="${esc(s.user.id)}" hidden></div>
        `;
      }).join('')}
    `;
    list.appendChild(wrap);

    // Wire the bulk-signoff button in the team header
    const bulkBtn = wrap.querySelector('[data-bulk-signoff]');
    if (bulkBtn) {
      bulkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openBulkSignOffDialog();
      });
    }

    // Wire row expansion
    wrap.querySelectorAll('[data-expand-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = parseInt(btn.dataset.expandUser, 10);
        const detail = wrap.querySelector(`[data-detail-for="${uid}"]`);
        if (!detail) return;
        const wasOpen = !detail.hasAttribute('hidden');
        // Close all other details
        wrap.querySelectorAll('.train-team-detail').forEach(d => d.setAttribute('hidden', ''));
        if (wasOpen) return;
        detail.removeAttribute('hidden');
        detail.innerHTML = renderUserModuleList(uid);
        // Wire sign-off buttons in the detail
        detail.querySelectorAll('[data-signoff-mod]').forEach(b => {
          b.addEventListener('click', () => {
            const m = modules.find(x => x.id === b.dataset.signoffMod);
            if (m) openSignOffDialog(m);
          });
        });
      });
    });
  }

  function renderUserModuleList(userId) {
    const lines = [];
    const groups = modulesByCategory();
    for (const g of groups) {
      const mandModules = g.modules.filter(m => m.mandatory);
      if (!mandModules.length) continue;
      lines.push(`<div class="train-team-detail-cat">${esc(g.category_en)}</div>`);
      for (const m of mandModules) {
        const s = statusForModule(m, userId);
        if (s === 'na') continue;
        const c = latestCompletionFor(m.id, userId);
        lines.push(`
          <div class="train-team-detail-row ${statusClass(s)}">
            <span class="train-team-detail-name">${esc(m.name_en)}</span>
            <span class="train-team-detail-status">${esc(statusLabel(s, c))}</span>
            ${(s === 'pending' || s === 'expired' || s === 'expiring')
              ? `<button class="train-team-signoff" data-signoff-mod="${esc(m.id)}">Sign off</button>` : ''}
          </div>
        `);
      }
    }
    return lines.join('') || '<div class="train-team-detail-empty">No mandatory modules.</div>';
  }

  // ─── CATALOG VIEW ────────────────────────────────────────────────────
  function renderCatalogView(list) {
    const groups = modulesByCategory();
    groups.forEach(group => {
      list.appendChild(renderCategoryCard(group));
    });
    renderCatalogFooter(list);
  }

  function renderCatalogFooter(list) {
    const wrap = document.createElement('div');
    wrap.className = 'train-footer-toolbar';
    wrap.innerHTML = `
      <button class="train-add-cat-btn" type="button">${svg('plus', 14)} <span>Add category</span></button>
    `;
    wrap.querySelector('.train-add-cat-btn').addEventListener('click', addNewCategory);
    list.appendChild(wrap);
  }

  function renderCategoryCard(group) {
    const isCollapsed = collapsedCategories.has(group.category_es);
    const lang = getLang();
    const card = document.createElement('div');
    card.className = 'train-card' + (isCollapsed ? ' is-collapsed' : '');

    const head = document.createElement('div');
    head.className = 'train-card-head';
    head.innerHTML = `
      <div class="train-card-titles">
        <div class="train-card-title">${esc(lang === 'es' ? group.category_es : group.category_en)}</div>
        <div class="train-card-sub">${esc(lang === 'es' ? group.category_en : group.category_es)} · ${group.modules.length} module${group.modules.length === 1 ? '' : 's'}</div>
      </div>
      <button class="train-card-chev" aria-label="Toggle">${svg('chevron', 18)}</button>
    `;
    head.querySelector('.train-card-titles').addEventListener('click', () => {
      if (isCollapsed) collapsedCategories.delete(group.category_es);
      else             collapsedCategories.add(group.category_es);
      render();
    });
    head.querySelector('.train-card-chev').addEventListener('click', () => {
      if (isCollapsed) collapsedCategories.delete(group.category_es);
      else             collapsedCategories.add(group.category_es);
      render();
    });
    card.appendChild(head);

    if (!isCollapsed) {
      const body = document.createElement('div');
      body.className = 'train-card-body';

      group.modules.forEach(mod => {
        if (editingModuleId === mod.id) {
          body.appendChild(renderModuleEditForm(mod));
        } else {
          body.appendChild(renderCatalogRow(mod));
        }
      });

      if (addingToCategory === group.category_es) {
        body.appendChild(renderModuleEditForm({
          id: 'new',
          category_es: group.category_es,
          category_en: group.category_en,
          category_order: group.category_order,
          module_order: group.modules.length,
          name_es: '', name_en: '',
          description_es: '', description_en: '',
          kind: 'in_person',
          renewal_type: 'one_time',
          required_for_role: 'all',
          mandatory: true,
        }));
      } else {
        const addBtn = document.createElement('button');
        addBtn.className = 'train-add-mod-btn';
        addBtn.innerHTML = `${svg('plus', 14)} <span>Add module</span>`;
        addBtn.addEventListener('click', () => {
          addingToCategory = group.category_es;
          editingModuleId = null;
          render();
        });
        body.appendChild(addBtn);
      }

      card.appendChild(body);
    }
    return card;
  }

  function renderCatalogRow(mod) {
    const lang = getLang();
    const kindDef = KIND_BY_TYPE[mod.kind];
    const renewal = RENEWAL_BY_TYPE[mod.renewal_type];
    const completionsCount = (completionsByModule[mod.id] || []).length;
    const row = document.createElement('div');
    row.className = 'train-cat-row';
    const primary   = lang === 'es' ? mod.name_es : mod.name_en;
    const secondary = lang === 'es' ? mod.name_en : mod.name_es;

    row.innerHTML = `
      <div class="train-cat-row-body">
        <div class="train-cat-row-name">${esc(primary)}</div>
        <div class="train-cat-row-meta">
          <span class="train-kind-tag">${svg(kindDef?.icon || 'document', 11)} ${esc(kindDef?.label || mod.kind)}</span>
          ${renewal && renewal.type !== 'one_time' ? `<span class="train-renewal-tag">${svg('clock', 11)} ${esc(renewal.label)}</span>` : ''}
          ${mod.required_for_role && mod.required_for_role !== 'all' ? `<span class="train-role-tag">${esc(ROLE_DEFS.find(r => r.value === mod.required_for_role)?.label || mod.required_for_role)}</span>` : ''}
          ${mod.mandatory ? '<span class="train-mandatory-tag">Required</span>' : ''}
          <span class="train-completions-tag">${completionsCount} done</span>
        </div>
        ${secondary && secondary !== primary ? `<div class="train-cat-row-secondary">${esc(secondary)}</div>` : ''}
      </div>
      <button class="train-cat-row-edit" aria-label="Edit module" data-edit-mod>${svg('pen', 14)}</button>
    `;
    row.querySelector('[data-edit-mod]').addEventListener('click', () => {
      editingModuleId = mod.id;
      addingToCategory = null;
      render();
    });
    return row;
  }

  function renderModuleEditForm(mod) {
    const isNew = mod.id === 'new';
    const wrap = document.createElement('div');
    wrap.className = 'train-edit-form';

    const kindOptions = KIND_DEFS.map(k =>
      `<option value="${k.type}" ${mod.kind === k.type ? 'selected' : ''}>${esc(k.label)}</option>`
    ).join('');
    const renewalOptions = RENEWAL_DEFS.map(r =>
      `<option value="${r.type}" ${mod.renewal_type === r.type ? 'selected' : ''}>${esc(r.label)}${r.days ? ` (${r.days}d)` : ''}</option>`
    ).join('');
    const roleOptions = ROLE_DEFS.map(r =>
      `<option value="${r.value}" ${mod.required_for_role === r.value ? 'selected' : ''}>${esc(r.label)}</option>`
    ).join('');

    const showCustom = mod.renewal_type === 'custom';

    wrap.innerHTML = `
      <div class="train-edit-row">
        <label class="train-edit-label">Nombre (Español)</label>
        <input type="text" class="train-edit-input" data-field="name_es" value="${esc(mod.name_es || '')}" placeholder="p.ej. Manejo de cuchillos">
      </div>
      <div class="train-edit-row">
        <label class="train-edit-label">Name (English)</label>
        <input type="text" class="train-edit-input" data-field="name_en" value="${esc(mod.name_en || '')}" placeholder="e.g. Knife Safety">
      </div>
      <div class="train-edit-row">
        <label class="train-edit-label">Description (English)</label>
        <textarea class="train-edit-textarea" data-field="description_en" rows="2" placeholder="Short description for staff.">${esc(mod.description_en || '')}</textarea>
      </div>
      <div class="train-edit-row">
        <label class="train-edit-label">Descripción (Español)</label>
        <textarea class="train-edit-textarea" data-field="description_es" rows="2" placeholder="Descripción breve.">${esc(mod.description_es || '')}</textarea>
      </div>
      <div class="train-edit-row train-edit-row-2col">
        <div>
          <label class="train-edit-label">Kind</label>
          <select class="train-edit-select" data-field="kind">${kindOptions}</select>
        </div>
        <div>
          <label class="train-edit-label">Renewal</label>
          <select class="train-edit-select" data-field="renewal_type">${renewalOptions}</select>
        </div>
      </div>
      <div class="train-edit-row" data-custom-days style="${showCustom ? '' : 'display:none'}">
        <label class="train-edit-label">Expires after (days)</label>
        <input type="number" class="train-edit-input" data-field="expires_after_days" min="1" max="3650" value="${esc(mod.expires_after_days || 365)}">
      </div>
      <div class="train-edit-row">
        <label class="train-edit-label">Resource URL <span class="train-edit-hint">(video/document/cert template)</span></label>
        <input type="url" class="train-edit-input" data-field="resource_url" value="${esc(mod.resource_url || '')}" placeholder="https://…">
      </div>
      <div class="train-edit-row train-edit-row-2col">
        <div>
          <label class="train-edit-label">Required for</label>
          <select class="train-edit-select" data-field="required_for_role">${roleOptions}</select>
        </div>
        <div>
          <label class="train-edit-label">Mandatory</label>
          <label class="train-edit-checkbox">
            <input type="checkbox" data-field="mandatory" ${mod.mandatory ? 'checked' : ''}>
            <span>Required by policy</span>
          </label>
        </div>
      </div>
      ${isNew ? '' : `
      <div class="train-edit-row">
        <label class="train-edit-label">Resources <span class="train-edit-hint">(SOPs, diagrams, reference PDFs — visible to all staff)</span></label>
        <div class="train-edit-mod-atts">
          ${(attachmentsByModule[mod.id] || []).map(a => {
            const isPdf = /pdf/i.test(a.mime_type || '') || /\.pdf(\?|$)/i.test(a.file_url);
            const fileName = a.caption || (a.file_url.split('/').pop() || 'File');
            return `
              <div class="train-edit-mod-att">
                ${isPdf
                  ? `<span class="train-edit-mod-att-icon">${svg('document', 14)}</span>`
                  : `<img src="${esc(a.file_url)}" class="train-edit-mod-att-thumb" alt="">`}
                <span class="train-edit-mod-att-name">${esc(fileName.length > 30 ? fileName.slice(0,28) + '…' : fileName)}</span>
                <button class="train-edit-mod-att-x" type="button" data-del-att="${esc(a.id)}" data-del-url="${esc(a.file_url)}" aria-label="Remove">×</button>
              </div>
            `;
          }).join('')}
          <button class="train-edit-mod-att-add" type="button" data-mod-att-add>${svg('plus', 12)} <span>Upload resource</span></button>
        </div>
      </div>
      `}
      <div class="train-edit-actions">
        <button class="train-edit-cancel" type="button">Cancel</button>
        ${isNew ? '' : '<button class="train-edit-archive" type="button">Archive</button>'}
        <button class="train-edit-save" type="button">${isNew ? 'Add module' : 'Save'}</button>
      </div>
    `;

    // Show/hide custom-days when renewal type changes
    wrap.querySelector('[data-field="renewal_type"]').addEventListener('change', (e) => {
      wrap.querySelector('[data-custom-days]').style.display =
        e.target.value === 'custom' ? '' : 'none';
    });

    // Cancel
    wrap.querySelector('.train-edit-cancel').addEventListener('click', () => {
      editingModuleId = null;
      addingToCategory = null;
      render();
    });

    // Module attachments — upload + per-attachment delete
    const modAttAddBtn = wrap.querySelector('[data-mod-att-add]');
    if (modAttAddBtn) {
      modAttAddBtn.addEventListener('click', () => uploadModuleAttachment(mod));
    }
    wrap.querySelectorAll('[data-del-att]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteAttachment(btn.dataset.delAtt, btn.dataset.delUrl);
      });
    });

    // Archive
    const archiveBtn = wrap.querySelector('.train-edit-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        if (!confirm(`Archive "${mod.name_en}"? Past completions are preserved.`)) return;
        archiveBtn.disabled = true;
        archiveBtn.textContent = 'Archiving…';
        try {
          await archiveModule(mod.id);
          editingModuleId = null;
          await loadModules();
          render();
          toast('Archived — restore from Archive', 'info', 2400);
        } catch (e) {
          archiveBtn.disabled = false;
          archiveBtn.textContent = 'Archive';
          toast('Could not archive: ' + (e.message || ''), 'error');
        }
      });
    }

    // Save
    wrap.querySelector('.train-edit-save').addEventListener('click', async () => {
      const get = (sel) => wrap.querySelector('[data-field="' + sel + '"]')?.value || '';
      const checked = (sel) => wrap.querySelector('[data-field="' + sel + '"]')?.checked || false;
      const name_es = get('name_es').trim();
      const name_en = get('name_en').trim();
      if (!name_es && !name_en) { toast('Name required', 'warn'); return; }

      const renewal_type = get('renewal_type') || 'one_time';
      let expires_after_days = null;
      if (renewal_type === 'custom') {
        expires_after_days = parseInt(get('expires_after_days'), 10) || 365;
      }

      const payload = {
        category_es:        mod.category_es,
        category_en:        mod.category_en,
        category_order:     mod.category_order,
        module_order:       mod.module_order,
        name_es:            name_es || name_en,
        name_en:            name_en || name_es,
        description_es:     get('description_es').trim() || null,
        description_en:     get('description_en').trim() || null,
        kind:               get('kind') || 'in_person',
        resource_url:       get('resource_url').trim() || null,
        renewal_type,
        expires_after_days,
        required_for_role:  get('required_for_role') || 'all',
        mandatory:          checked('mandatory'),
      };

      const saveBtn = wrap.querySelector('.train-edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await saveModule(isNew ? null : mod.id, payload);
        editingModuleId = null;
        addingToCategory = null;
        await loadModules();
        render();
        toast(isNew ? 'Module added' : 'Saved', 'info', 1400);
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? 'Add module' : 'Save';
        toast('Could not save: ' + (e.message || ''), 'error');
      }
    });

    return wrap;
  }

  function addNewCategory() {
    if (!NX.composer?.modal) {
      const cat_es = prompt('Categoría (Español):');
      if (!cat_es) return;
      const cat_en = prompt('Category (English):') || cat_es;
      createCategoryWithFirstModule(cat_es, cat_en);
      return;
    }
    NX.composer.modal({
      title: 'New training category',
      subtitle: 'Adds a category card with one starter module.',
      buttonLabel: 'Create',
      fields: [
        { name: 'cat_es', label: 'Category (Español)', placeholder: 'p.ej. Vinos', autofocus: true },
        { name: 'cat_en', label: 'Category (English)', placeholder: 'e.g. Wine Program' },
      ],
      onSubmit: async ({ cat_es, cat_en }) => {
        const a = (cat_es || '').trim();
        const b = (cat_en || '').trim();
        if (!a && !b) throw new Error('Need a category name');
        await createCategoryWithFirstModule(a || b, b || a);
      },
    });
  }

  async function createCategoryWithFirstModule(cat_es, cat_en) {
    const existingOrders = modules.map(m => m.category_order);
    const nextOrder = existingOrders.length ? Math.max(...existingOrders) + 1 : 0;
    try {
      await NX.sb.from('training_modules').insert({
        category_es:    cat_es,
        category_en:    cat_en,
        category_order: nextOrder,
        module_order:   0,
        name_es:        '(nuevo módulo)',
        name_en:        '(new module)',
        kind:           'in_person',
        renewal_type:   'one_time',
        required_for_role: 'all',
        mandatory:      true,
      });
      await loadModules();
      const newMod = modules.find(m => m.category_es === cat_es && m.module_order === 0);
      if (newMod) {
        editingModuleId = newMod.id;
        collapsedCategories.delete(cat_es);
      }
      render();
    } catch (e) {
      toast('Could not create: ' + (e.message || ''), 'error');
    }
  }

  // ═══ ARCHIVE INTEGRATION ═════════════════════════════════════════════
  function registerArchiveContributor() {
    if (!window.NX || !NX.archive) return;
    NX.archive.register({
      key: 'training',
      label: 'Training',
      empty: 'No archived modules. Edit a module and tap Archive to send it here.',
      fetch: fetchArchivedModules,
      renderRow: (row, ctx) => {
        const e = ctx.esc;
        const when = row.archived_at
          ? new Date(row.archived_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        const kind = KIND_BY_TYPE[row.kind]?.label || row.kind;
        return `
          <div class="nx-archive-row-title">${e(row.name_en || row.name_es)}</div>
          <div class="nx-archive-row-meta">
            <span class="nx-archive-row-loc">${e(row.category_en)}</span>
            <span class="nx-archive-row-dot">·</span>
            <span>${e(kind)}</span>
            ${when ? `<span class="nx-archive-row-dot">·</span><span>archived ${e(when)}</span>` : ''}
          </div>
          ${row.name_es && row.name_es !== row.name_en
            ? `<div class="nx-archive-row-secondary">${e(row.name_es)}</div>` : ''}
        `;
      },
      restore: async (id) => { await restoreModule(id); },
    });
  }

  // ═══ EMAIL SUBMIT ════════════════════════════════════════════════════
  function buildEmailSubject() {
    const date = new Date();
    const wk = date.toLocaleDateString([], { weekday: 'short' });
    const md = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Training Status · ${wk} ${md}`;
  }

  function buildEmailBody() {
    const E = (window.NX && NX.email) || null;
    const sectionHeader = E ? E.sectionHeader : (l, s) => `--- ${l.toUpperCase()} ---${s ? ' ' + s : ''}`;
    const rule = E ? E.rule : () => '─'.repeat(45);
    const lines = [];
    const date = new Date();
    const dateStr = date.toLocaleDateString([], {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    lines.push(`Training Status — ${dateStr}`);
    lines.push(`Compiled by ${getUserName()}`);
    lines.push('');

    // Aggregate by user, mandatory modules only
    const summary = usersList.map(u => {
      let pending = 0, expiring = 0, expired = 0, done = 0, na = 0;
      for (const m of modules) {
        if (!m.mandatory) continue;
        const s = statusForModule(m, u.id);
        if (s === 'pending')       pending++;
        else if (s === 'expiring') expiring++;
        else if (s === 'expired')  expired++;
        else if (s === 'done')     done++;
        else if (s === 'na')       na++;
      }
      return { user: u, pending, expiring, expired, done, na };
    });

    const totalGap = summary.reduce((acc, s) => acc + s.pending + s.expiring + s.expired, 0);
    lines.push(`Compliance gaps: ${totalGap} across ${usersList.length} staff`);
    lines.push('');

    // ─── COMPLIANCE GAPS section ─────────────────────────────
    const gappy = summary.filter(s => (s.pending + s.expiring + s.expired) > 0)
                          .sort((a, b) => (b.pending + b.expiring + b.expired) - (a.pending + a.expiring + a.expired));
    if (gappy.length) {
      lines.push(sectionHeader('GAPS', `${gappy.length} staff`));
      gappy.forEach(s => {
        const bits = [];
        if (s.expired)  bits.push(`${s.expired} expired`);
        if (s.expiring) bits.push(`${s.expiring} expiring`);
        if (s.pending)  bits.push(`${s.pending} pending`);
        lines.push(`  ${s.user.name.padEnd(22)} ${bits.join(', ')}`);
        // Detail per-module
        for (const m of modules) {
          if (!m.mandatory) continue;
          const st = statusForModule(m, s.user.id);
          if (st === 'pending' || st === 'expiring' || st === 'expired') {
            const c = latestCompletionFor(m.id, s.user.id);
            lines.push(`    · ${m.name_en} — ${statusLabel(st, c)}`);
          }
        }
      });
      lines.push('');
    }

    // ─── EXPIRING SOON section (across whole team) ──────────
    const expiring = [];
    for (const m of modules) {
      const list = completionsByModule[m.id] || [];
      list.forEach(c => {
        if (!c.expires_at) return;
        const d = daysUntil(c.expires_at);
        if (d >= 0 && d <= EXPIRING_SOON_DAYS) {
          expiring.push({ mod: m, completion: c, days: d });
        }
      });
    }
    expiring.sort((a, b) => a.days - b.days);
    if (expiring.length) {
      lines.push(sectionHeader('EXPIRING SOON', `${expiring.length} item${expiring.length === 1 ? '' : 's'}`));
      expiring.forEach(e => {
        lines.push(`  ${(e.completion.user_name || '').padEnd(20)} ${e.mod.name_en.padEnd(28)} ${e.days}d (${fmtDate(e.completion.expires_at)})`);
      });
      lines.push('');
    }

    // ─── MODULE COUNTS ─────────────────────────────────────
    lines.push(sectionHeader('CATALOG', `${modules.length} modules`));
    const byCategory = modulesByCategory();
    byCategory.forEach(g => {
      const count = g.modules.length;
      lines.push(`  ${g.category_en.padEnd(24)} ${count} module${count === 1 ? '' : 's'}`);
    });
    lines.push('');

    lines.push(rule());
    lines.push('Full status + certificates in NEXUS.');
    return lines.join('\n');
  }

  async function submitTrainingReport() {
    const E = (window.NX && NX.email) || null;
    const subject = buildEmailSubject();
    const body    = buildEmailBody();
    const warnLen = E ? E.BODY_WARN_LEN : 1900;
    if (body.length > warnLen) {
      const ok = confirm(`Email is long (${body.length} chars). Send anyway?`);
      if (!ok) return;
    }
    const toAddress = (NX.currentUser && NX.currentUser.email) || '';
    const url = E ? E.buildMailtoUrl(toAddress, subject, body)
                  : `mailto:${encodeURIComponent(toAddress)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (!toAddress) toast('No email on file — fill it in your mail app', 'info', 3000);
    setTimeout(() => { window.location.href = url; }, 100);
  }

  // ═══ INIT + SHOW ═════════════════════════════════════════════════════
  let initialized = false;

  // Tells duties.js (if loaded) to refresh its training-status display:
  // updates both the launcher subtitle on the Duties view AND the badge
  // on the bottom-nav Training tab. Bypasses the 60s cache so a freshly-
  // completed module reflects immediately.
  function refreshNavBadge() {
    try {
      const fn = window.NX?.modules?.duties?.refreshTrainingStatus;
      if (typeof fn === 'function') fn(true);  // force = true
    } catch (e) { /* silent */ }
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    // Wire footer buttons
    const submitBtn = document.getElementById('trainSubmit');
    if (submitBtn) submitBtn.addEventListener('click', submitTrainingReport);
    const archiveBtn = document.getElementById('trainArchive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', () => {
        if (NX.archive) NX.archive.open();
        else toast('Archive unavailable', 'warn');
      });
    }

    await loadModules();
    await loadUsers();
    await loadCompletions();
    await loadAttachments();
    registerArchiveContributor();
    render();
    refreshNavBadge();
  }

  async function show() {
    await loadModules();
    await loadCompletions();
    await loadAttachments();
    render();
    refreshNavBadge();
  }

  // ═══ EXPORTS ══════════════════════════════════════════════════════════
  if (!window.NX) window.NX = {};
  if (!NX.modules) NX.modules = {};
  NX.modules.train = { init, show };

  // Public API for AI brain / other modules
  NX.trainingAPI = {
    markComplete:      (moduleId) => {
      const m = modules.find(x => x.id === moduleId);
      if (m) markComplete(m);
    },
    listModules:       () => modules.slice(),
    listCompletions:   (userId) => {
      const out = [];
      Object.values(completionsByModule).forEach(arr => arr.forEach(c => {
        if (!userId || c.user_id === userId) out.push(c);
      }));
      return out;
    },
  };

})();
