/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Education v1
   ─────────────────────────────────────────────────────────────────────
   Replaces the v12 Training feature. Cards-in-cards content library:

     Categories  →  Guides  →  Content
     (Dining)        (How to mop)   (text | video | pdf | embed | steps)

   Designed for "dirty hands" usage on a kitchen tablet:
     - Full-screen takeover viewer (no fiddly panels)
     - Large tap targets (60px+ on critical actions)
     - Step-by-step mode shows ONE step per screen with huge Next/Prev
     - Context hint banner tells staff WHEN this technique applies
     - Required supplies checklist at the top before starting

   Linked to cleaning_tasks via cleaning_task_guides (M2M). Cleaning view
   surfaces a 📖 button on rows with linked guides.

   Storage: education-content bucket (public read, anon write).
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────
  let initialized = false;
  let categories = [];
  let guidesByCategoryId = {};
  let allGuides = [];
  let stepsByGuideId = {};
  let activeCategoryId = null;
  let viewingGuideId = null;          // when set → takeover open
  let stepIndex = 0;                  // current step in step-mode viewer
  let editingGuide = null;            // guide object being edited (null=new)
  let editingCategory = null;
  let editingSteps = null;            // array currently in editor

  // ─── Utilities ──────────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function svg(name, size = 14, stroke = 2) {
    const s = size, sw = stroke;
    const paths = {
      x:        `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
      check:    `<polyline points="20 6 9 17 4 12"/>`,
      plus:     `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
      pen:      `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>`,
      trash:    `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
      chevR:    `<polyline points="9 18 15 12 9 6"/>`,
      chevL:    `<polyline points="15 18 9 12 15 6"/>`,
      chevD:    `<polyline points="6 9 12 15 18 9"/>`,
      book:     `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`,
      video:    `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`,
      pdf:      `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
      list:     `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
      link:     `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
      info:     `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
      upload:   `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
      play:     `<polygon points="5 3 19 12 5 21 5 3"/>`,
      arrow_l:  `<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`,
      arrow_r:  `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>`,
      utensils: `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>`,
      flame:    `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
      droplets: `<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>`,
      leaf:     `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c.7 6.7-2.5 14.04-8.2 17.04z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>`,
      sprout:   `<path d="M7 20h10"/><path d="M10 20c5.5-2.5.42-6.5 5-10"/><path d="M9.3 14.5C5.7 13 4.07 9 5 5c4 0 8 4 8 9.5"/>`,
      calendar: `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
      shield:   `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
      tag:      `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`,
      clock:    `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
      alert:    `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    };
    const p = paths[name] || paths.info;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }
  function toast(msg, kind = 'info', ms = 2500) {
    if (window.NX && typeof NX.toast === 'function') return NX.toast(msg, kind, ms);
    console.log(`[education ${kind}]`, msg);
  }

  // Sanitize a filename for storage (ASCII-only, lowercase, no spaces)
  function safeFileName(name) {
    return (name || 'file')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9.-]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      || 'file';
  }
  function fmtDuration(seconds) {
    if (!seconds || seconds < 1) return '';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  function getCurrentUserId() {
    try { return (window.NX && NX.currentUser && NX.currentUser.id) || null; }
    catch (e) { return null; }
  }
  function getUserName() {
    try { return (window.NX && NX.currentUser && NX.currentUser.name) || ''; }
    catch (e) { return ''; }
  }

  // ─── Data layer ─────────────────────────────────────────────────────
  async function loadCategories() {
    if (!NX.sb) return [];
    try {
      const { data, error } = await NX.sb.from('education_categories')
        .select('*')
        .eq('archived', false)
        .order('sort_order', { ascending: true });
      if (error) { console.error('[education] loadCategories:', error); return []; }
      return data || [];
    } catch (e) { console.error('[education] loadCategories ex:', e); return []; }
  }

  async function loadGuides() {
    if (!NX.sb) return [];
    try {
      const { data, error } = await NX.sb.from('education_guides')
        .select('*')
        .eq('archived', false)
        .order('sort_order', { ascending: true });
      if (error) { console.error('[education] loadGuides:', error); return []; }
      return data || [];
    } catch (e) { console.error('[education] loadGuides ex:', e); return []; }
  }

  async function loadStepsForGuide(guideId) {
    if (!NX.sb) return [];
    try {
      const { data, error } = await NX.sb.from('education_guide_steps')
        .select('*')
        .eq('guide_id', guideId)
        .order('step_order', { ascending: true });
      if (error) { console.error('[education] loadSteps:', error); return []; }
      return data || [];
    } catch (e) { console.error('[education] loadSteps ex:', e); return []; }
  }

  async function loadAll() {
    categories = await loadCategories();
    allGuides = await loadGuides();
    guidesByCategoryId = {};
    for (const cat of categories) guidesByCategoryId[cat.id] = [];
    for (const g of allGuides) {
      if (g.category_id && guidesByCategoryId[g.category_id]) {
        guidesByCategoryId[g.category_id].push(g);
      }
    }
    if (!activeCategoryId && categories.length) activeCategoryId = categories[0].id;
  }

  // ─── Storage upload ─────────────────────────────────────────────────
  async function uploadFile(file, kind) {
    // kind: 'video' | 'pdf' | 'photo' | 'audio'
    const ts = Date.now();
    const safe = safeFileName(file.name);
    const path = `${kind}/${ts}-${safe}`;
    const { error: upErr } = await NX.sb.storage
      .from('education-content')
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) throw upErr;
    const { data } = NX.sb.storage.from('education-content').getPublicUrl(path);
    return data.publicUrl;
  }

  // ─── Render: top-level (category picker + guide list) ───────────────
  async function show() {
    const view = document.getElementById('educationView');
    if (!view) return;
    view.innerHTML = `<div class="edu-loading">Loading…</div>`;
    await loadAll();
    if (viewingGuideId) {
      renderTakeover();
    } else {
      renderListView();
    }
    // The header has the close button (top-left) and the + Module button
    // (top-right). Clippy lives in the top-right by default and can land
    // on top of + Module. Politely ask him to relocate to a less busy
    // corner when this view becomes visible.
    if (window.NX && NX.clippy && typeof NX.clippy.moveToEmptyCorner === 'function') {
      setTimeout(() => NX.clippy.moveToEmptyCorner(), 250);
    }
  }

  function renderListView() {
    const view = document.getElementById('educationView');
    if (!view) return;

    const activeCat = categories.find(c => c.id === activeCategoryId);
    const guides = activeCat ? (guidesByCategoryId[activeCategoryId] || []) : [];

    view.innerHTML = `
      <div class="edu-header">
        <button class="edu-close" id="eduClose" aria-label="Close">${svg('x', 18, 2.4)}</button>
        <div class="edu-title-row">
          <div class="edu-eyebrow">TRAINING</div>
          <div class="edu-title">School of NEXUS</div>
          <div class="edu-subtitle">${esc(categories.length ? `${categories.length} module${categories.length === 1 ? '' : 's'} · ${allGuides.length} lesson${allGuides.length === 1 ? '' : 's'}` : 'Build the curriculum')}</div>
        </div>
        <button class="edu-add-cat-btn" id="eduAddCat" aria-label="Add module">${svg('plus', 14)} <span>Module</span></button>
      </div>

      <div class="edu-cat-picker-wrap">
        <div class="edu-cat-picker" id="eduCatPicker">
          ${categories.map(cat => `
            <button class="edu-cat-btn ${cat.id === activeCategoryId ? 'active' : ''}"
                    data-cat-id="${esc(cat.id)}">
              ${svg(cat.icon || 'graduation', 13)}
              <span>${esc(cat.name_en)}</span>
              ${cat.id === activeCategoryId ? `
                <span class="edu-cat-btn-edit" data-edit-cat="${esc(cat.id)}" role="button" tabindex="0" aria-label="Edit module ${esc(cat.name_en)}">${svg('pen', 11)}</span>
              ` : ''}
            </button>
          `).join('')}
        </div>
      </div>

      ${activeCat && activeCat.description ? `
        <div class="edu-module-context">
          ${svg('info', 12)} <span>${esc(activeCat.description)}</span>
        </div>
      ` : ''}

      <div class="edu-guides-list" id="eduGuidesList">
        ${activeCat ? renderGuidesForCategory(activeCat, guides) : `
          <div class="edu-empty">
            <div class="edu-empty-emblem">${svg('graduation', 48, 1.4)}</div>
            <div class="edu-empty-title">No modules yet</div>
            <div class="edu-empty-hint">Tap <b>+ Module</b> above to create your first one. Each module holds lessons (text, video, PDF books, photo guides, study material).</div>
          </div>
        `}
      </div>

      ${activeCat ? `
        <button class="edu-add-guide-fab" id="eduAddGuide" type="button" aria-label="Add lesson to ${esc(activeCat.name_en)}">
          ${svg('plus', 18, 2.4)} <span>Add lesson</span>
        </button>
      ` : ''}
    `;

    // Wire close
    document.getElementById('eduClose').addEventListener('click', () => {
      if (window.NX && typeof NX.switchTo === 'function') NX.switchTo('home');
    });

    // Wire category picker — taps on the body switch the active module;
    // taps on the small edit pin (visible on the active module) open
    // the editor. Tapping the already-active pill ALSO opens the editor
    // as a redundant discoverability path.
    view.querySelectorAll('[data-cat-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Edit-pin tap → open editor (and don't change selection)
        const pin = e.target.closest('[data-edit-cat]');
        if (pin) {
          e.stopPropagation();
          const cat = categories.find(c => c.id === pin.dataset.editCat);
          if (cat) openCategoryEditor(cat);
          return;
        }
        const tappedId = btn.dataset.catId;
        // Re-tap of the already-active pill → open editor too
        if (tappedId === activeCategoryId) {
          const cat = categories.find(c => c.id === tappedId);
          if (cat) openCategoryEditor(cat);
          return;
        }
        activeCategoryId = tappedId;
        renderListView();
      });
    });

    // Add category
    document.getElementById('eduAddCat').addEventListener('click', () => openCategoryEditor(null));

    // Add guide
    const addGuideBtn = document.getElementById('eduAddGuide');
    if (addGuideBtn) {
      addGuideBtn.addEventListener('click', () => {
        openGuideEditor(null, activeCategoryId);
      });
    }

    // Wire guide cards
    view.querySelectorAll('[data-guide-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit-guide]')) return;
        viewingGuideId = card.dataset.guideId;
        stepIndex = 0;
        renderTakeover();
      });
    });
    view.querySelectorAll('[data-edit-guide]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const g = allGuides.find(x => x.id === btn.dataset.editGuide);
        if (g) openGuideEditor(g, g.category_id);
      });
    });
  }

  function renderGuidesForCategory(cat, guides) {
    if (!guides.length) {
      const kindIcon = cat.icon || 'graduation';
      return `
        <div class="edu-empty">
          <div class="edu-empty-emblem">${svg(kindIcon, 48, 1.4)}</div>
          <div class="edu-empty-title">No lessons in ${esc(cat.name_en)} yet</div>
          <div class="edu-empty-hint">Tap <b>Add lesson</b> below to create the first one. Lessons can be text, video, PDF book, photo guide, embedded URL, or step-by-step study material.</div>
        </div>
      `;
    }
    return guides.map(g => {
      const kindIcon = {
        text:'document', video:'video', pdf:'book', embed:'external', steps:'scroll'
      }[g.primary_kind] || 'graduation';
      const supplies = (g.required_supplies || []).length
        ? `<span class="edu-card-meta-chip">${svg('list', 11)} ${g.required_supplies.length}</span>` : '';
      const dur = g.duration_seconds
        ? `<span class="edu-card-meta-chip">${svg('clock', 11)} ${esc(fmtDuration(g.duration_seconds))}</span>` : '';
      const tags = (g.tags || []).slice(0, 3).map(t =>
        `<span class="edu-card-tag">${esc(t)}</span>`).join('');
      const hint = g.context_hint
        ? `<div class="edu-card-context">${svg('info', 11)} ${esc(g.context_hint)}</div>` : '';
      return `
        <div class="edu-card" data-guide-id="${esc(g.id)}">
          <div class="edu-card-thumb edu-card-thumb-${esc(g.primary_kind)}">
            ${g.thumbnail_url
              ? `<img src="${esc(g.thumbnail_url)}" alt="">`
              : svg(kindIcon, 28, 1.6)}
          </div>
          <div class="edu-card-body">
            <div class="edu-card-title">${esc(g.title_en)}</div>
            ${g.description ? `<div class="edu-card-desc">${esc(g.description)}</div>` : ''}
            ${hint}
            <div class="edu-card-meta-row">
              <span class="edu-card-kind">${svg(kindIcon, 11)} ${esc(g.primary_kind)}</span>
              ${dur}
              ${supplies}
              ${tags}
            </div>
          </div>
          <button class="edu-card-edit" data-edit-guide="${esc(g.id)}" aria-label="Edit lesson">${svg('pen', 13)}</button>
          <div class="edu-card-chev">${svg('chevR', 16)}</div>
        </div>
      `;
    }).join('');
  }

  // ─── Render: takeover viewer ────────────────────────────────────────
  async function renderTakeover() {
    const view = document.getElementById('educationView');
    if (!view) return;
    const guide = allGuides.find(g => g.id === viewingGuideId);
    if (!guide) {
      viewingGuideId = null;
      renderListView();
      return;
    }

    // Load steps if needed
    if (guide.primary_kind === 'steps' && !stepsByGuideId[guide.id]) {
      stepsByGuideId[guide.id] = await loadStepsForGuide(guide.id);
    }
    const steps = stepsByGuideId[guide.id] || [];

    // Header always visible
    const headerHTML = `
      <div class="edu-takeover-header">
        <button class="edu-takeover-close" id="eduTkClose" aria-label="Close">${svg('x', 20, 2.4)}</button>
        <div class="edu-takeover-title-row">
          <div class="edu-takeover-eyebrow">${esc(categories.find(c => c.id === guide.category_id)?.name_en || 'Lesson')}</div>
          <div class="edu-takeover-title">${esc(guide.title_en)}</div>
        </div>
        <button class="edu-takeover-edit" id="eduTkEdit" aria-label="Edit">${svg('pen', 16)}</button>
      </div>
    `;

    // Context hint banner — the "when this matters" message
    const contextHTML = guide.context_hint ? `
      <div class="edu-context-banner">
        ${svg('info', 16)}
        <div>
          <div class="edu-context-label">When to use this</div>
          <div class="edu-context-text">${esc(guide.context_hint)}</div>
        </div>
      </div>
    ` : '';

    // Required supplies checklist
    const suppliesHTML = (guide.required_supplies || []).length ? `
      <div class="edu-supplies">
        <div class="edu-supplies-label">You'll need</div>
        <ul class="edu-supplies-list">
          ${guide.required_supplies.map(s => `<li>${esc(s)}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    // Tags as chips
    const tagsHTML = (guide.tags || []).length ? `
      <div class="edu-tags-row">
        ${guide.tags.map(t => `<span class="edu-tag">${esc(t)}</span>`).join('')}
      </div>
    ` : '';

    // Body — depends on primary_kind
    let bodyHTML = '';
    switch (guide.primary_kind) {
      case 'text':
        bodyHTML = `<div class="edu-text-body">${renderMarkdownBasic(guide.primary_text || '')}</div>`;
        break;
      case 'video':
        bodyHTML = guide.primary_url
          ? `<div class="edu-video-wrap"><video src="${esc(guide.primary_url)}" controls playsinline preload="metadata" class="edu-video"></video></div>`
          : `<div class="edu-empty-content">No video uploaded yet.</div>`;
        break;
      case 'pdf':
        bodyHTML = guide.primary_url ? `
          <div class="edu-pdf-wrap">
            <iframe src="${esc(guide.primary_url)}" class="edu-pdf-iframe" title="PDF"></iframe>
            <a class="edu-pdf-open" href="${esc(guide.primary_url)}" target="_blank" rel="noopener">${svg('upload', 14)} Open in new tab</a>
          </div>
        ` : `<div class="edu-empty-content">No PDF uploaded yet.</div>`;
        break;
      case 'embed':
        bodyHTML = guide.primary_url ? `
          <div class="edu-embed-wrap">
            <iframe src="${esc(toEmbedUrl(guide.primary_url))}"
                    class="edu-embed-iframe"
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    referrerpolicy="strict-origin-when-cross-origin"
                    loading="lazy"
                    allowfullscreen></iframe>
          </div>
          <a class="edu-embed-fallback" href="${esc(guide.primary_url)}" target="_blank" rel="noopener">
            ${svg('external', 14)} <span>If the video doesn't load, open on ${esc(getEmbedSourceName(guide.primary_url))}</span>
          </a>
        ` : `<div class="edu-empty-content">No embed URL set.</div>`;
        break;
      case 'steps':
        return renderStepsTakeover(guide, steps, headerHTML);
    }

    view.innerHTML = `
      <div class="edu-takeover">
        ${headerHTML}
        <div class="edu-takeover-scroll">
          ${contextHTML}
          ${suppliesHTML}
          ${tagsHTML}
          ${guide.description ? `<div class="edu-takeover-desc">${esc(guide.description)}</div>` : ''}
          ${bodyHTML}
        </div>
      </div>
    `;
    document.getElementById('eduTkClose').addEventListener('click', closeTakeoverAndReturn);
    document.getElementById('eduTkEdit').addEventListener('click', () => {
      openGuideEditor(guide, guide.category_id);
    });
  }

  function renderStepsTakeover(guide, steps, headerHTML) {
    const view = document.getElementById('educationView');
    if (!steps.length) {
      view.innerHTML = `
        <div class="edu-takeover">
          ${headerHTML}
          <div class="edu-takeover-scroll">
            <div class="edu-empty-content">
              <div class="edu-empty-title">No steps yet</div>
              <div class="edu-empty-hint">Tap edit to add steps.</div>
            </div>
          </div>
        </div>
      `;
      document.getElementById('eduTkClose').addEventListener('click', closeTakeoverAndReturn);
      document.getElementById('eduTkEdit').addEventListener('click', () => {
        openGuideEditor(guide, guide.category_id);
      });
      return;
    }

    if (stepIndex >= steps.length) stepIndex = steps.length - 1;
    if (stepIndex < 0) stepIndex = 0;
    const step = steps[stepIndex];
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length - 1;

    view.innerHTML = `
      <div class="edu-takeover edu-takeover-steps">
        ${headerHTML}
        <div class="edu-step-progress">
          ${steps.map((_, i) => `<div class="edu-step-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}"></div>`).join('')}
          <div class="edu-step-counter">Step ${stepIndex + 1} of ${steps.length}</div>
        </div>
        <div class="edu-step-scroll">
          ${step.photo_url ? `<div class="edu-step-photo"><img src="${esc(step.photo_url)}" alt=""></div>` : ''}
          ${step.title ? `<div class="edu-step-title">${esc(step.title)}</div>` : ''}
          ${step.context_hint ? `
            <div class="edu-step-context">
              ${svg('info', 14)} <span>${esc(step.context_hint)}</span>
            </div>
          ` : ''}
          ${step.body ? `<div class="edu-step-body">${renderMarkdownBasic(step.body)}</div>` : ''}
          ${step.duration_seconds ? `<div class="edu-step-duration">${svg('clock', 13)} ~${esc(fmtDuration(step.duration_seconds))}</div>` : ''}
        </div>
        <div class="edu-step-nav">
          <button class="edu-step-btn edu-step-prev" id="eduStepPrev" ${isFirst ? 'disabled' : ''}>
            ${svg('arrow_l', 22, 2.4)} <span>Prev</span>
          </button>
          ${isLast ? `
            <button class="edu-step-btn edu-step-done" id="eduStepDone">
              ${svg('check', 22, 2.4)} <span>Done</span>
            </button>
          ` : `
            <button class="edu-step-btn edu-step-next" id="eduStepNext">
              <span>Next</span> ${svg('arrow_r', 22, 2.4)}
            </button>
          `}
        </div>
      </div>
    `;

    document.getElementById('eduTkClose').addEventListener('click', closeTakeoverAndReturn);
    document.getElementById('eduTkEdit').addEventListener('click', () => {
      openGuideEditor(guide, guide.category_id);
    });
    const prevBtn = document.getElementById('eduStepPrev');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (stepIndex > 0) { stepIndex--; renderTakeover(); }
    });
    const nextBtn = document.getElementById('eduStepNext');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (stepIndex < steps.length - 1) { stepIndex++; renderTakeover(); }
    });
    const doneBtn = document.getElementById('eduStepDone');
    if (doneBtn) doneBtn.addEventListener('click', () => {
      viewingGuideId = null;
      renderListView();
      toast('Guide complete', 'success', 1800);
    });
  }

  // Very basic markdown — paragraphs + bold + italic + links + lists.
  // Avoids pulling a markdown lib for v1.
  function renderMarkdownBasic(s) {
    if (!s) return '';
    s = String(s);
    // Escape first
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Bold + italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bullet lists (- or *)
    s = s.replace(/(^|\n)([-*] .+(?:\n[-*] .+)*)/g, (_, pre, block) => {
      const items = block.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean).map(l => `<li>${l}</li>`).join('');
      return pre + `<ul>${items}</ul>`;
    });
    // Paragraphs
    s = s.split(/\n{2,}/).map(p => {
      if (/^<(ul|ol|li|h\d|p|pre|blockquote)/.test(p.trim())) return p;
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');
    return s;
  }

  // Coerce common video URLs to embed format
  // Convert a user-pasted URL into something we can iframe-embed.
  // Handles YouTube (watch, youtu.be, shorts, live, embed) and Vimeo.
  // Falls back to the original URL if we can't recognize it (which
  // probably won't iframe-embed, but the fallback link below covers it).
  function toEmbedUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^(www|m|music)\./, '');

      // YouTube
      if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
        let id = '';
        if (host === 'youtu.be') {
          id = u.pathname.slice(1);
        } else {
          const path = u.pathname;
          if (path.startsWith('/watch'))  id = u.searchParams.get('v') || '';
          else if (path.startsWith('/shorts/'))   id = path.replace('/shorts/', '');
          else if (path.startsWith('/live/'))     id = path.replace('/live/', '');
          else if (path.startsWith('/embed/'))    return url;   // already embeddable
        }
        // Strip any trailing path segments / query
        id = (id || '').split('/')[0].split('?')[0].split('&')[0];
        if (id) {
          // Preserve a start time if present (?t= or ?start=)
          const t = u.searchParams.get('t') || u.searchParams.get('start');
          const start = t ? `?start=${parseInt(t, 10) || 0}` : '';
          return `https://www.youtube.com/embed/${id}${start}`;
        }
      }

      // Vimeo
      if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        if (u.pathname.startsWith('/video/')) return url;       // already embeddable
        const m = u.pathname.match(/\/(\d+)/);
        if (m) return `https://player.vimeo.com/video/${m[1]}`;
      }
    } catch (e) {}
    return url;
  }

  // Display name for the embed source — used in the "Open on …" fallback
  function getEmbedSourceName(url) {
    try {
      const h = new URL(url).hostname.replace(/^(www|m)\./, '');
      if (h.includes('youtube') || h === 'youtu.be') return 'YouTube';
      if (h.includes('vimeo')) return 'Vimeo';
      return h;
    } catch (e) { return 'source'; }
  }

  // ─── Editors ────────────────────────────────────────────────────────
  function openCategoryEditor(cat) {
    editingCategory = cat ? Object.assign({}, cat) : {
      name_en: '', name_es: '', icon: 'book', description: '', sort_order: categories.length
    };
    const isNew = !cat;
    const sheet = document.createElement('div');
    sheet.className = 'edu-sheet';
    sheet.innerHTML = `
      <div class="edu-sheet-bg"></div>
      <div class="edu-sheet-card">
        <div class="edu-sheet-head">
          <div class="edu-sheet-title">${isNew ? 'New module' : 'Edit module'}</div>
          <button class="edu-sheet-close" aria-label="Close">${svg('x', 16)}</button>
        </div>
        <div class="edu-sheet-body">
          <label class="edu-field">
            <span class="edu-field-label">Name (English)</span>
            <input type="text" class="edu-input" data-field="name_en" value="${esc(editingCategory.name_en)}" placeholder="e.g. Dining">
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Name (Spanish)</span>
            <input type="text" class="edu-input" data-field="name_es" value="${esc(editingCategory.name_es || '')}" placeholder="e.g. Comedor">
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Icon</span>
            <select class="edu-input" data-field="icon">
              ${['book','utensils','flame','droplets','leaf','sprout','calendar','shield','tag','clock','alert'].map(ic =>
                `<option value="${ic}" ${ic === editingCategory.icon ? 'selected' : ''}>${ic}</option>`).join('')}
            </select>
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Description (optional)</span>
            <textarea class="edu-input" data-field="description" rows="2" placeholder="e.g. Dining room cleaning techniques">${esc(editingCategory.description || '')}</textarea>
          </label>
        </div>
        <div class="edu-sheet-actions">
          <button class="edu-sheet-cancel">Cancel</button>
          ${cat ? '<button class="edu-sheet-archive">Delete</button>' : ''}
          <button class="edu-sheet-save">${isNew ? 'Create' : 'Save'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.edu-sheet-bg').addEventListener('click', close);
    sheet.querySelector('.edu-sheet-close').addEventListener('click', close);
    sheet.querySelector('.edu-sheet-cancel').addEventListener('click', close);

    sheet.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        editingCategory[el.dataset.field] = el.value;
      });
    });

    sheet.querySelector('.edu-sheet-save').addEventListener('click', async () => {
      if (!editingCategory.name_en.trim()) { toast('Name is required', 'error'); return; }
      try {
        if (cat) {
          const { error } = await NX.sb.from('education_categories').update({
            name_en: editingCategory.name_en.trim(),
            name_es: editingCategory.name_es.trim() || null,
            icon: editingCategory.icon || 'book',
            description: editingCategory.description.trim() || null,
          }).eq('id', cat.id);
          if (error) throw error;
        } else {
          const { error } = await NX.sb.from('education_categories').insert({
            name_en: editingCategory.name_en.trim(),
            name_es: editingCategory.name_es.trim() || null,
            icon: editingCategory.icon || 'book',
            description: editingCategory.description.trim() || null,
            sort_order: editingCategory.sort_order,
          });
          if (error) throw error;
        }
        close();
        await loadAll();
        renderListView();
        toast(cat ? 'Category updated' : 'Category created', 'success');
      } catch (e) {
        console.error(e);
        toast('Save failed: ' + e.message, 'error', 4000);
      }
    });

    const archiveBtn = sheet.querySelector('.edu-sheet-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        if (!confirm(`Delete the "${cat.name_en}" module? Lessons inside it will remain but become uncategorized — you can move them to another module.`)) return;
        try {
          const { error } = await NX.sb.from('education_categories').update({ archived: true }).eq('id', cat.id);
          if (error) throw error;
          close();
          if (activeCategoryId === cat.id) activeCategoryId = null;
          await loadAll();
          renderListView();
          toast('Module deleted', 'info');
        } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
      });
    }
  }

  function openGuideEditor(guide, categoryId) {
    editingGuide = guide ? Object.assign({}, guide) : {
      category_id: categoryId,
      title_en: '', title_es: '', description: '',
      primary_kind: 'text', primary_url: '', primary_text: '',
      thumbnail_url: '', context_hint: '',
      required_supplies: [], tags: [],
    };
    if (!editingGuide.required_supplies) editingGuide.required_supplies = [];
    if (!editingGuide.tags) editingGuide.tags = [];
    const isNew = !guide;

    // Load existing steps if it's a steps guide
    editingSteps = null;
    if (guide && guide.primary_kind === 'steps') {
      loadStepsForGuide(guide.id).then(s => {
        editingSteps = s.slice();
        const stepsHost = document.querySelector('[data-steps-host]');
        if (stepsHost) renderStepsEditor(stepsHost);
      });
    } else {
      editingSteps = [];
    }

    const sheet = document.createElement('div');
    sheet.className = 'edu-sheet edu-sheet-large';
    sheet.innerHTML = `
      <div class="edu-sheet-bg"></div>
      <div class="edu-sheet-card edu-sheet-card-large">
        <div class="edu-sheet-head">
          <div class="edu-sheet-title">${isNew ? 'New lesson' : 'Edit lesson'}</div>
          <button class="edu-sheet-close" aria-label="Close">${svg('x', 16)}</button>
        </div>
        <div class="edu-sheet-body edu-guide-editor-body">
          <label class="edu-field">
            <span class="edu-field-label">Category</span>
            <select class="edu-input" data-field="category_id">
              ${categories.map(c => `<option value="${esc(c.id)}" ${c.id === editingGuide.category_id ? 'selected' : ''}>${esc(c.name_en)}</option>`).join('')}
            </select>
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Title (English)</span>
            <input type="text" class="edu-input" data-field="title_en" value="${esc(editingGuide.title_en)}" placeholder="e.g. How to mop">
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Title (Spanish)</span>
            <input type="text" class="edu-input" data-field="title_es" value="${esc(editingGuide.title_es || '')}" placeholder="e.g. Cómo trapear">
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Description (optional)</span>
            <textarea class="edu-input" data-field="description" rows="2" placeholder="One-line summary">${esc(editingGuide.description || '')}</textarea>
          </label>

          <label class="edu-field">
            <span class="edu-field-label">When to use this <span class="edu-field-hint">— tells staff WHEN this technique applies</span></span>
            <textarea class="edu-input" data-field="context_hint" rows="2" placeholder="e.g. When grease buildup is visible on the hood">${esc(editingGuide.context_hint || '')}</textarea>
          </label>

          <label class="edu-field">
            <span class="edu-field-label">Required supplies <span class="edu-field-hint">— comma separated</span></span>
            <input type="text" class="edu-input" data-field="_supplies" value="${esc((editingGuide.required_supplies || []).join(', '))}" placeholder="Mop, Bucket, Floor cleaner">
          </label>
          <label class="edu-field">
            <span class="edu-field-label">Tags <span class="edu-field-hint">— gloves, slippery, chemical, hot…</span></span>
            <input type="text" class="edu-input" data-field="_tags" value="${esc((editingGuide.tags || []).join(', '))}" placeholder="gloves, chemical">
          </label>

          <label class="edu-field">
            <span class="edu-field-label">Content type</span>
            <select class="edu-input" data-field="primary_kind">
              <option value="text"  ${editingGuide.primary_kind === 'text'  ? 'selected' : ''}>Text / article</option>
              <option value="video" ${editingGuide.primary_kind === 'video' ? 'selected' : ''}>Video lesson (upload)</option>
              <option value="pdf"   ${editingGuide.primary_kind === 'pdf'   ? 'selected' : ''}>Book / PDF (upload)</option>
              <option value="embed" ${editingGuide.primary_kind === 'embed' ? 'selected' : ''}>Embedded URL (YouTube, Vimeo, web)</option>
              <option value="steps" ${editingGuide.primary_kind === 'steps' ? 'selected' : ''}>Step-by-step study</option>
            </select>
          </label>

          <div class="edu-content-host" data-content-host></div>
        </div>
        <div class="edu-sheet-actions">
          <button class="edu-sheet-cancel">Cancel</button>
          ${guide ? '<button class="edu-sheet-archive">Archive</button>' : ''}
          <button class="edu-sheet-save">${isNew ? 'Create' : 'Save'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.edu-sheet-bg').addEventListener('click', close);
    sheet.querySelector('.edu-sheet-close').addEventListener('click', close);
    sheet.querySelector('.edu-sheet-cancel').addEventListener('click', close);

    // Field bindings
    sheet.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        const f = el.dataset.field;
        if (f === '_supplies') {
          editingGuide.required_supplies = el.value.split(',').map(s => s.trim()).filter(Boolean);
        } else if (f === '_tags') {
          editingGuide.tags = el.value.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          editingGuide[f] = el.value;
        }
        if (f === 'primary_kind') {
          renderContentHost(sheet.querySelector('[data-content-host]'));
        }
      });
    });

    // Initial content host render
    renderContentHost(sheet.querySelector('[data-content-host]'));

    sheet.querySelector('.edu-sheet-save').addEventListener('click', async () => {
      if (!editingGuide.title_en.trim()) { toast('Title required', 'error'); return; }
      try {
        const payload = {
          category_id: editingGuide.category_id || null,
          title_en: editingGuide.title_en.trim(),
          title_es: (editingGuide.title_es || '').trim() || null,
          description: (editingGuide.description || '').trim() || null,
          primary_kind: editingGuide.primary_kind,
          primary_url: editingGuide.primary_url || null,
          primary_text: editingGuide.primary_text || null,
          thumbnail_url: editingGuide.thumbnail_url || null,
          context_hint: (editingGuide.context_hint || '').trim() || null,
          required_supplies: editingGuide.required_supplies.length ? editingGuide.required_supplies : null,
          tags: editingGuide.tags.length ? editingGuide.tags : null,
        };
        let saved;
        if (guide) {
          const { data, error } = await NX.sb.from('education_guides')
            .update(payload).eq('id', guide.id).select().single();
          if (error) throw error;
          saved = data;
        } else {
          payload.created_by = getUserName();
          payload.created_by_id = getCurrentUserId();
          const { data, error } = await NX.sb.from('education_guides')
            .insert(payload).select().single();
          if (error) throw error;
          saved = data;
        }

        // If steps mode, persist the steps array
        if (editingGuide.primary_kind === 'steps' && editingSteps) {
          await persistSteps(saved.id, editingSteps);
        }

        close();
        await loadAll();
        // Invalidate steps cache for this guide
        if (saved.id) delete stepsByGuideId[saved.id];
        renderListView();
        toast(guide ? 'Guide updated' : 'Guide created', 'success');
      } catch (e) {
        console.error(e);
        toast('Save failed: ' + (e.message || e), 'error', 4000);
      }
    });

    const archiveBtn = sheet.querySelector('.edu-sheet-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        if (!confirm('Archive this lesson?')) return;
        try {
          const { error } = await NX.sb.from('education_guides').update({ archived: true }).eq('id', guide.id);
          if (error) throw error;
          close();
          await loadAll();
          renderListView();
          toast('Guide archived', 'info');
        } catch (e) { toast('Archive failed: ' + e.message, 'error'); }
      });
    }
  }

  function renderContentHost(host) {
    if (!host) return;
    const k = editingGuide.primary_kind;

    if (k === 'text') {
      host.innerHTML = `
        <label class="edu-field">
          <span class="edu-field-label">Content (markdown supported: **bold**, *italic*, [link](url), - bullets)</span>
          <textarea class="edu-input edu-textarea-large" data-field="primary_text" rows="10" placeholder="Write the lesson…">${esc(editingGuide.primary_text || '')}</textarea>
        </label>
      `;
      host.querySelector('[data-field]').addEventListener('input', (e) => {
        editingGuide.primary_text = e.target.value;
      });
    } else if (k === 'video') {
      host.innerHTML = `
        <div class="edu-field">
          <span class="edu-field-label">Video file (mp4, mov, webm — up to 200MB)</span>
          ${editingGuide.primary_url ? `
            <div class="edu-uploaded">
              <video src="${esc(editingGuide.primary_url)}" controls preload="metadata" style="max-width:100%;border-radius:8px"></video>
              <button class="edu-remove-upload" type="button">Remove</button>
            </div>
          ` : `
            <label class="edu-upload-btn">
              ${svg('upload', 18)} <span>Choose video</span>
              <input type="file" accept="video/*" capture="environment" hidden>
            </label>
          `}
        </div>
      `;
      const fileInput = host.querySelector('input[type=file]');
      if (fileInput) {
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 200 * 1024 * 1024) { toast('Video too big (200MB max)', 'error'); return; }
          toast('Uploading video…', 'info', 8000);
          try {
            const url = await uploadFile(file, 'video');
            editingGuide.primary_url = url;
            renderContentHost(host);
            toast('Video uploaded', 'success');
          } catch (e) { toast('Upload failed: ' + e.message, 'error'); }
        });
      }
      const removeBtn = host.querySelector('.edu-remove-upload');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          editingGuide.primary_url = '';
          renderContentHost(host);
        });
      }
    } else if (k === 'pdf') {
      host.innerHTML = `
        <div class="edu-field">
          <span class="edu-field-label">PDF file (up to 200MB)</span>
          ${editingGuide.primary_url ? `
            <div class="edu-uploaded">
              <a href="${esc(editingGuide.primary_url)}" target="_blank" rel="noopener" class="edu-pdf-link">${svg('pdf', 18)} View uploaded PDF</a>
              <button class="edu-remove-upload" type="button">Remove</button>
            </div>
          ` : `
            <label class="edu-upload-btn">
              ${svg('upload', 18)} <span>Choose PDF</span>
              <input type="file" accept="application/pdf" hidden>
            </label>
          `}
        </div>
      `;
      const fileInput = host.querySelector('input[type=file]');
      if (fileInput) {
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 200 * 1024 * 1024) { toast('PDF too big (200MB max)', 'error'); return; }
          toast('Uploading PDF…', 'info', 8000);
          try {
            const url = await uploadFile(file, 'pdf');
            editingGuide.primary_url = url;
            renderContentHost(host);
            toast('PDF uploaded', 'success');
          } catch (e) { toast('Upload failed: ' + e.message, 'error'); }
        });
      }
      const removeBtn = host.querySelector('.edu-remove-upload');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          editingGuide.primary_url = '';
          renderContentHost(host);
        });
      }
    } else if (k === 'embed') {
      host.innerHTML = `
        <label class="edu-field">
          <span class="edu-field-label">URL <span class="edu-field-hint">— YouTube or Vimeo link</span></span>
          <input type="url" class="edu-input" data-field="primary_url" value="${esc(editingGuide.primary_url || '')}" placeholder="https://www.youtube.com/watch?v=…">
        </label>
      `;
      host.querySelector('[data-field]').addEventListener('input', (e) => {
        editingGuide.primary_url = e.target.value;
      });
    } else if (k === 'steps') {
      host.innerHTML = `
        <div class="edu-field">
          <span class="edu-field-label">Steps <span class="edu-field-hint">— numbered breakdown shown one per screen</span></span>
          <div data-steps-host></div>
          <button class="edu-add-step-btn" type="button">${svg('plus', 13)} Add step</button>
        </div>
      `;
      const stepsHost = host.querySelector('[data-steps-host]');
      renderStepsEditor(stepsHost);
      host.querySelector('.edu-add-step-btn').addEventListener('click', () => {
        if (!editingSteps) editingSteps = [];
        editingSteps.push({
          step_order: editingSteps.length + 1,
          title: '', body: '', photo_url: '', context_hint: '', duration_seconds: null,
        });
        renderStepsEditor(stepsHost);
      });
    }
  }

  function renderStepsEditor(host) {
    if (!host) return;
    if (!editingSteps) {
      host.innerHTML = `<div class="edu-loading-inline">Loading steps…</div>`;
      return;
    }
    if (!editingSteps.length) {
      host.innerHTML = `<div class="edu-empty-inline">No steps yet — tap Add step.</div>`;
      return;
    }
    host.innerHTML = editingSteps.map((s, i) => `
      <div class="edu-step-edit-card" data-step-i="${i}">
        <div class="edu-step-edit-head">
          <div class="edu-step-edit-num">Step ${i + 1}</div>
          <button class="edu-step-edit-up" type="button" data-step-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="edu-step-edit-dn" type="button" data-step-dn="${i}" ${i === editingSteps.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button class="edu-step-edit-rm" type="button" data-step-rm="${i}" aria-label="Remove">${svg('trash', 13)}</button>
        </div>
        <input type="text" class="edu-input" data-step-field="title" data-step-i="${i}" value="${esc(s.title || '')}" placeholder="Title (e.g. Prepare bucket)">
        <textarea class="edu-input" data-step-field="body" data-step-i="${i}" rows="2" placeholder="Description / instructions">${esc(s.body || '')}</textarea>
        <input type="text" class="edu-input" data-step-field="context_hint" data-step-i="${i}" value="${esc(s.context_hint || '')}" placeholder='e.g. "Make sure floor is still wet"'>
        <div class="edu-step-edit-photo">
          ${s.photo_url ? `
            <img src="${esc(s.photo_url)}" alt="">
            <button class="edu-step-photo-rm" type="button" data-step-photo-rm="${i}">Remove photo</button>
          ` : `
            <label class="edu-upload-btn edu-upload-btn-sm">
              ${svg('upload', 13)} <span>Add photo</span>
              <input type="file" accept="image/*" data-step-photo-pick="${i}" hidden>
            </label>
          `}
        </div>
      </div>
    `).join('');

    host.querySelectorAll('[data-step-field]').forEach(el => {
      el.addEventListener('input', () => {
        const i = parseInt(el.dataset.stepI, 10);
        editingSteps[i][el.dataset.stepField] = el.value;
      });
    });
    host.querySelectorAll('[data-step-up]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.stepUp, 10);
        if (i > 0) {
          [editingSteps[i-1], editingSteps[i]] = [editingSteps[i], editingSteps[i-1]];
          renderStepsEditor(host);
        }
      });
    });
    host.querySelectorAll('[data-step-dn]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.stepDn, 10);
        if (i < editingSteps.length - 1) {
          [editingSteps[i+1], editingSteps[i]] = [editingSteps[i], editingSteps[i+1]];
          renderStepsEditor(host);
        }
      });
    });
    host.querySelectorAll('[data-step-rm]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.stepRm, 10);
        if (confirm(`Remove step ${i + 1}?`)) {
          editingSteps.splice(i, 1);
          renderStepsEditor(host);
        }
      });
    });
    host.querySelectorAll('[data-step-photo-rm]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.stepPhotoRm, 10);
        editingSteps[i].photo_url = '';
        renderStepsEditor(host);
      });
    });
    host.querySelectorAll('[data-step-photo-pick]').forEach(input => {
      input.addEventListener('change', async () => {
        const i = parseInt(input.dataset.stepPhotoPick, 10);
        const file = input.files && input.files[0];
        if (!file) return;
        toast('Uploading photo…', 'info', 6000);
        try {
          const url = await uploadFile(file, 'photo');
          editingSteps[i].photo_url = url;
          renderStepsEditor(host);
          toast('Photo uploaded', 'success');
        } catch (e) { toast('Upload failed: ' + e.message, 'error'); }
      });
    });
  }

  async function persistSteps(guideId, steps) {
    // Strategy: delete all existing rows for this guide, insert the new
    // ordered set. Simpler than diffing per-row.
    await NX.sb.from('education_guide_steps').delete().eq('guide_id', guideId);
    if (!steps.length) return;
    const rows = steps.map((s, i) => ({
      guide_id: guideId,
      step_order: i + 1,
      title: s.title || null,
      body: s.body || null,
      photo_url: s.photo_url || null,
      audio_url: s.audio_url || null,
      context_hint: s.context_hint || null,
      duration_seconds: s.duration_seconds || null,
    }));
    const { error } = await NX.sb.from('education_guide_steps').insert(rows);
    if (error) throw error;
  }

  // ─── Public API ─────────────────────────────────────────────────────
  // Used by cleaning.js to populate the "Link guides" picker, and to
  // surface guides on cleaning task rows.
  async function getGuidesForTask(taskId) {
    if (!NX.sb) return [];
    try {
      const { data, error } = await NX.sb.from('cleaning_task_guides')
        .select('guide_id, sort_order, education_guides(*)')
        .eq('task_id', taskId)
        .order('sort_order', { ascending: true });
      if (error) { console.error(error); return []; }
      return (data || []).map(r => r.education_guides).filter(Boolean);
    } catch (e) { return []; }
  }

  async function listAllGuides() {
    if (!allGuides.length) {
      allGuides = await loadGuides();
    }
    return allGuides.slice();
  }

  async function listAllCategories() {
    if (!categories.length) {
      categories = await loadCategories();
    }
    return categories.slice();
  }

  async function linkGuideToTask(taskId, guideId) {
    const { error } = await NX.sb.from('cleaning_task_guides')
      .insert({ task_id: taskId, guide_id: guideId, sort_order: 0 });
    if (error && error.code !== '23505') throw error;  // 23505 = unique violation, already linked
  }

  async function unlinkGuideFromTask(taskId, guideId) {
    const { error } = await NX.sb.from('cleaning_task_guides')
      .delete().eq('task_id', taskId).eq('guide_id', guideId);
    if (error) throw error;
  }

  // v18.6 — track where the guide viewer was opened FROM so the close
  // button can return there instead of always dumping the user on the
  // education list view. Set by openGuideViewer({returnToView:'clean'})
  // and consumed by the three eduTkClose handlers below.
  let _returnToView = null;

  // Open the takeover viewer directly for a given guide id (called from
  // the cleaning view's 📖 button).
  //
  // PARAMS:
  //   guideId — required, equipment_guides.id (or whatever your guides
  //             primary key is named in your schema)
  //   opts.returnToView — optional view name ('clean', 'equipment',
  //             etc.) to switch back to when the takeover closes.
  //             When set, the close button calls NX.switchTo(returnView)
  //             instead of falling through to renderListView().
  async function openGuideViewer(guideId, opts) {
    // Make sure an educationView exists; if not, navigate
    let view = document.getElementById('educationView');
    if (!view) {
      if (window.NX && typeof NX.switchTo === 'function') NX.switchTo('education');
      view = document.getElementById('educationView');
      if (!view) { toast('Education view not available'); return; }
    }
    if (!allGuides.length) await loadAll();
    viewingGuideId = guideId;
    stepIndex = 0;
    _returnToView = (opts && opts.returnToView) || null;
    if (window.NX && typeof NX.switchTo === 'function') NX.switchTo('education');
    renderTakeover();
  }

  // Internal helper used by all three eduTkClose handlers. If a
  // returnToView was set when openGuideViewer was called, switch back
  // to that view; otherwise fall through to the education list.
  function closeTakeoverAndReturn() {
    viewingGuideId = null;
    const target = _returnToView;
    _returnToView = null;   // clear so the next visit starts clean
    if (target && window.NX && typeof NX.switchTo === 'function') {
      NX.switchTo(target);
    } else {
      renderListView();
    }
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    // First-load render. Without this, app.js calls init() exactly once
    // on the FIRST navigation, init() does nothing visible, and the
    // educationView div sits empty — that's the "blank canvas" bug.
    // On subsequent navigations app.js calls show() directly, which is
    // why later visits worked but the first one didn't.
    await show();
  }

  // ─── Exports ────────────────────────────────────────────────────────
  if (!window.NX) window.NX = {};
  if (!NX.modules) NX.modules = {};
  NX.modules.education = { init, show };
  NX.educationAPI = {
    getGuidesForTask,
    listAllGuides,
    listAllCategories,
    linkGuideToTask,
    unlinkGuideFromTask,
    openGuideViewer,
  };
})();
