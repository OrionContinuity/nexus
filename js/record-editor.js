/* ═══════════════════════════════════════════════════════════════════════
 * NEXUS — record editor engine (shared)
 *
 * One overlay shell + a set of UI primitives used by BOTH the ordering
 * module's vendor editor AND the equipment module's contractor editor.
 * The engine is intentionally NOT schema-aware: callers build their own
 * card bodies using these helpers, then pass them to openOverlay() with
 * a save callback that knows their own table.
 *
 * Design philosophy:
 *   - Engine = chrome + reusable widgets. Caller = composition + save.
 *   - All HTML is built as strings; wire functions hook handlers after mount.
 *   - State (chips, photo file, hue) lives in a single object the caller
 *     hands to the engine; helpers mutate it; save reads from it.
 *
 * Surface (all under NX.recordEditor):
 *   .openOverlay(config)              — top-level open
 *   .buildCardHTML(key, title, ...)   — collapsible card markup
 *   .buildChipGroupHTML(items, kind, opts)
 *   .buildIdentityCardBody(opts)      — name + photo + color picker
 *   .wireCardToggles(root, state)     — collapse handlers on all cards
 *   .wireChipGroup(root, kind, state, opts)
 *   .wirePhotoPicker(root, state, opts)
 *   .wireHuePicker(root, state)
 *   .readIdentityValues(root)         — pulls back name/photo/hue/pinned
 *
 * Convention:
 *   - Class prefix "rx-" = record editor.
 *   - data-rx-* attributes are engine-owned; data-* without the prefix
 *     belong to callers.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (NX) {
  'use strict';

  /* ── small utilities ──────────────────────────────────────────────── */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function svg(inner, size = 18, sw = 2) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }
  const ICON = {
    chevronDown: svg('<polyline points="6 9 12 15 18 9"/>', 20, 2.4),
    plus:        svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    arrowLeft:   svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
    camera:      svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    trash:       svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
    x:           svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  };

  /* ── overlay element bookkeeping ─────────────────────────────────── */
  let activeOverlay = null;            // { el, config, state, escHandler }

  function getInitials(name) {
    const s = String(name || '').trim();
    if (!s) return '?';
    const parts = s.split(/\s+/).slice(0, 2);
    return parts.map(p => p[0]).join('').toUpperCase();
  }

  /* Hash a string to a hue 0-359 — same logic as ordering.js's vendorAvatar
   * so colors are consistent across the app for any given name. */
  function hashHue(s) {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return h % 360;
  }

  /* ── card builder ─────────────────────────────────────────────────── */
  function buildCardHTML(key, title, expanded, bodyHTML, opts) {
    opts = opts || {};
    const cls = ['rx-card'];
    if (!expanded) cls.push('is-collapsed');
    if (opts.danger) cls.push('rx-card-danger');
    if (opts.compact) cls.push('rx-card-compact');
    const subtitle = opts.subtitle ? `<span class="rx-card-subtitle">${esc(opts.subtitle)}</span>` : '';
    return `
      <div class="${cls.join(' ')}" data-rx-card="${esc(key)}">
        <button class="rx-card-head" type="button" data-rx-card-toggle="${esc(key)}" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="rx-card-title-wrap">
            <span class="rx-card-title">${esc(title)}</span>
            ${subtitle}
          </span>
          <span class="rx-card-chevron" aria-hidden="true">${ICON.chevronDown}</span>
        </button>
        <div class="rx-card-body">${bodyHTML || ''}</div>
      </div>
    `;
  }

  function wireCardToggles(root, state) {
    if (!root) return;
    state.expandedCards = state.expandedCards || new Set();
    root.querySelectorAll('[data-rx-card-toggle]').forEach(btn => {
      if (btn._rxBound) return;
      btn._rxBound = true;
      btn.addEventListener('click', () => {
        const key = btn.dataset.rxCardToggle;
        const card = btn.closest('.rx-card');
        if (!card) return;
        const wasCollapsed = card.classList.contains('is-collapsed');
        if (wasCollapsed) {
          card.classList.remove('is-collapsed');
          state.expandedCards.add(key);
          btn.setAttribute('aria-expanded', 'true');
        } else {
          card.classList.add('is-collapsed');
          state.expandedCards.delete(key);
          btn.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  /* ── chip group ───────────────────────────────────────────────────────
   * Items: array of strings (emails, phones, etc.) or objects with .text.
   * State.chips[kind] = array of chip values (strings).
   * Callbacks: optional { onAdd, onRemove, onChange } for the caller to
   * react to mutations (e.g. mark dirty, refresh derived UI). */
  function buildChipHTML(value, kind, opts) {
    opts = opts || {};
    const meta = opts.meta ? `<span class="rx-chip-meta">${esc(opts.meta)}</span>` : '';
    return `
      <span class="rx-chip" data-rx-chip="${esc(value)}" data-kind="${esc(kind)}">
        <span class="rx-chip-text">${esc(value)}</span>
        ${meta}
        <button type="button" class="rx-chip-remove" aria-label="Remove ${esc(value)}">${ICON.x}</button>
      </span>
    `;
  }

  function buildChipGroupHTML(items, kind, opts) {
    opts = opts || {};
    const list = Array.isArray(items) ? items : [];
    const labelPill = opts.label
      ? `<span class="rx-chip-pill rx-chip-pill-${esc(kind)}">${esc(opts.label)}</span>`
      : '';
    const hint = opts.hint
      ? `<span class="rx-chip-hint">${esc(opts.hint)}</span>`
      : '';
    const head = (labelPill || hint)
      ? `<div class="rx-chip-group-head">${labelPill}${hint}</div>`
      : '';
    const chipsHTML = list.map(v => {
      const value = (typeof v === 'string') ? v : (v && v.value) || '';
      const meta  = (v && typeof v === 'object') ? v.meta : null;
      return buildChipHTML(value, kind, { meta });
    }).join('');
    const addLabel = opts.addLabel || `Add ${kind}`;
    const inputType = opts.inputType || 'text';
    const placeholder = opts.placeholder || '';
    const inputMode = opts.inputMode ? ` inputmode="${esc(opts.inputMode)}"` : '';
    return `
      <div class="rx-chip-group" data-rx-chip-group="${esc(kind)}">
        ${head}
        <div class="rx-chip-list">
          ${chipsHTML}
          <button type="button" class="rx-chip-add" data-rx-chip-add="${esc(kind)}">
            ${ICON.plus}<span>${esc(addLabel)}</span>
          </button>
        </div>
        <div class="rx-chip-input-wrap" hidden>
          <input type="${esc(inputType)}" class="rx-chip-input" data-rx-chip-input="${esc(kind)}" placeholder="${esc(placeholder)}" autocomplete="off"${inputMode} spellcheck="false">
          <button type="button" class="rx-chip-input-save" data-rx-chip-save="${esc(kind)}">Add</button>
          <button type="button" class="rx-chip-input-cancel" data-rx-chip-cancel="${esc(kind)}">Cancel</button>
        </div>
      </div>
    `;
  }

  function _refreshChipGroup(root, kind, state, opts) {
    if (!root) return;
    const groupEl = root.querySelector(`[data-rx-chip-group="${kind}"]`);
    if (!groupEl) return;
    const items = (state.chips && state.chips[kind]) || [];
    const fresh = buildChipGroupHTML(items, kind, opts);
    const tmp = document.createElement('div');
    tmp.innerHTML = fresh;
    groupEl.replaceWith(tmp.firstElementChild);
    wireChipGroup(root, kind, state, opts);
  }

  function wireChipGroup(root, kind, state, opts) {
    opts = opts || {};
    if (!root) return;
    state.chips = state.chips || {};
    state.chips[kind] = state.chips[kind] || [];

    // Remove (×) on chips
    root.querySelectorAll(`.rx-chip[data-kind="${kind}"] .rx-chip-remove`).forEach(btn => {
      if (btn._rxBound) return;
      btn._rxBound = true;
      btn.addEventListener('click', () => {
        const chip = btn.closest('.rx-chip');
        if (!chip) return;
        const value = chip.dataset.rxChip;
        state.chips[kind] = state.chips[kind].filter(v => {
          const vv = (typeof v === 'string') ? v : (v && v.value);
          return vv !== value;
        });
        if (opts.onChange) opts.onChange(state.chips[kind]);
        if (opts.onRemove) opts.onRemove(value);
        _refreshChipGroup(root, kind, state, opts);
      });
    });

    // "+ Add ..." button — reveals the input
    const addBtn = root.querySelector(`[data-rx-chip-add="${kind}"]`);
    if (addBtn && !addBtn._rxBound) {
      addBtn._rxBound = true;
      addBtn.addEventListener('click', () => {
        const wrap = root.querySelector(`[data-rx-chip-group="${kind}"] .rx-chip-input-wrap`);
        if (!wrap) return;
        wrap.hidden = false;
        addBtn.style.display = 'none';
        const input = wrap.querySelector('input');
        if (input) { input.focus(); input.value = ''; }
      });
    }

    // Cancel button — hide input
    const cancelBtn = root.querySelector(`[data-rx-chip-cancel="${kind}"]`);
    if (cancelBtn && !cancelBtn._rxBound) {
      cancelBtn._rxBound = true;
      cancelBtn.addEventListener('click', () => {
        const wrap = root.querySelector(`[data-rx-chip-group="${kind}"] .rx-chip-input-wrap`);
        if (wrap) wrap.hidden = true;
        if (addBtn) addBtn.style.display = '';
      });
    }

    // Save button (and Enter key on input) — adds the chip
    const commitAdd = () => {
      const input = root.querySelector(`[data-rx-chip-input="${kind}"]`);
      if (!input) return;
      const raw = (input.value || '').trim();
      if (!raw) return;
      // Validate via opts.validate if provided. Returns null/undefined on
      // pass, or a string error message on fail.
      if (opts.validate) {
        const err = opts.validate(raw, state.chips[kind]);
        if (err) {
          input.classList.add('rx-input-error');
          input.placeholder = err;
          input.value = '';
          setTimeout(() => input.classList.remove('rx-input-error'), 1500);
          return;
        }
      }
      // Dedup
      const exists = state.chips[kind].some(v => {
        const vv = (typeof v === 'string') ? v : (v && v.value);
        return vv === raw;
      });
      if (exists) {
        input.classList.add('rx-input-error');
        input.placeholder = 'Already added';
        input.value = '';
        setTimeout(() => input.classList.remove('rx-input-error'), 1500);
        return;
      }
      state.chips[kind].push(raw);
      if (opts.onChange) opts.onChange(state.chips[kind]);
      if (opts.onAdd) opts.onAdd(raw);
      _refreshChipGroup(root, kind, state, opts);
      // After the refresh the chip-group DOM is brand new, including the
      // input wrap which renders `hidden` by default. Re-show it and
      // refocus the input so the user can keep adding emails without
      // having to re-tap the "+ Add" button each time. iOS keyboards
      // stay open when focus moves to a freshly inserted input.
      const newWrap   = root.querySelector(`[data-rx-chip-group="${esc(kind)}"] .rx-chip-input-wrap`);
      const newInput  = root.querySelector(`[data-rx-chip-input="${esc(kind)}"]`);
      const newAddBtn = root.querySelector(`[data-rx-chip-add="${esc(kind)}"]`);
      if (newWrap)   newWrap.hidden = false;
      if (newAddBtn) newAddBtn.style.display = 'none';
      if (newInput) {
        newInput.value = '';
        // rAF so focus lands after the browser settles the new layout
        requestAnimationFrame(() => {
          try { newInput.focus(); } catch (_) {}
        });
      }
    };

    const saveBtn = root.querySelector(`[data-rx-chip-save="${kind}"]`);
    if (saveBtn && !saveBtn._rxBound) {
      saveBtn._rxBound = true;
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        commitAdd();
      });
    }
    const input = root.querySelector(`[data-rx-chip-input="${kind}"]`);
    if (input && !input._rxBound) {
      input._rxBound = true;
      // keydown — primary path, fires on Enter on most platforms
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commitAdd();
        } else if (e.key === 'Escape') {
          const wrap = root.querySelector(`[data-rx-chip-group="${kind}"] .rx-chip-input-wrap`);
          if (wrap) wrap.hidden = true;
          if (addBtn) addBtn.style.display = '';
        }
      });
      // keyup as a backup (some iOS/Android keyboards swallow keydown
      // for the Go/Done key but still emit keyup).
      input.addEventListener('keyup', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // commitAdd is idempotent (early-return if input is empty),
          // so calling it twice does nothing harmful.
          commitAdd();
        }
      });
      // blur — if the user types an email and just taps elsewhere
      // (or hits Save without committing), commit on focus loss.
      input.addEventListener('blur', () => {
        // Tiny delay so a click on the Add button still routes there
        // first (otherwise we double-add).
        setTimeout(() => {
          if (input.value && input.value.trim()) commitAdd();
        }, 100);
      });
    }
  }

  /* ── identity card body (name + photo + color picker) ─────────────── */
  function buildIdentityCardBody(opts) {
    opts = opts || {};
    const name = opts.name || '';
    const photoUrl = opts.photoUrl || '';
    const hue = (typeof opts.hue === 'number') ? opts.hue : 'auto';
    const previewHue = (typeof opts.hue === 'number') ? opts.hue : hashHue(name);
    const initials = getInitials(name);
    const photoStyle = photoUrl ? `style="background-image:url('${esc(photoUrl)}')"` : '';
    const photoCls = photoUrl ? 'rx-avatar-preview has-photo' : 'rx-avatar-preview';
    const swatchHues = [15, 35, 55, 90, 130, 165, 200, 230, 265, 295, 325, 355];
    const showPin = !!opts.showPin;
    const pinned = !!opts.pinned;
    const pinTitle = opts.pinTitle || 'Pin to top';
    const pinSub = opts.pinSub || '';
    const nameLabel = opts.nameLabel || 'Name';
    const namePlaceholder = opts.namePlaceholder || 'e.g. Acme Co.';

    return `
      <div class="rx-identity-row">
        <button type="button" class="rx-avatar-btn" data-rx-avatar aria-label="Upload photo">
          <div class="${photoCls}" data-rx-avatar-preview style="--avatar-hue:${previewHue}" ${photoStyle}>
            ${photoUrl ? '' : `<span class="rx-avatar-initials">${esc(initials)}</span>`}
          </div>
          <span class="rx-avatar-badge" aria-hidden="true">${ICON.camera}</span>
        </button>
        <input type="file" data-rx-photo-file accept="image/*" hidden>
        <div class="rx-identity-name-wrap">
          <label class="rx-form-label" data-rx-name-label>${esc(nameLabel)}</label>
          <input type="text" class="rx-form-input" data-rx-name value="${esc(name)}" placeholder="${esc(namePlaceholder)}" autocomplete="off">
        </div>
      </div>
      <div class="rx-form-field">
        <label class="rx-form-label">Photo <span class="rx-form-hint">— tap the circle, or paste a URL</span></label>
        <div class="rx-photo-actions">
          <button type="button" class="rx-photo-action" data-rx-photo-upload>${ICON.camera}<span>Upload</span></button>
          <button type="button" class="rx-photo-action rx-photo-action-clear" data-rx-photo-clear>${ICON.trash}<span>Remove</span></button>
        </div>
        <input type="url" class="rx-form-input" data-rx-photo-url value="${esc(photoUrl)}" placeholder="https://example.com/logo.png  (optional URL)" autocomplete="off" inputmode="url" style="margin-top:8px">
      </div>
      <div class="rx-form-field">
        <label class="rx-form-label">Avatar color <span class="rx-form-hint">— only when there's no photo</span></label>
        <div class="rx-hue-picker" data-rx-hue-picker data-selected="${hue}">
          <button type="button" class="rx-hue-swatch rx-hue-auto${hue === 'auto' ? ' active' : ''}" data-hue="auto" aria-label="Auto color from name">A</button>
          ${swatchHues.map(h => `<button type="button" class="rx-hue-swatch${hue === h ? ' active' : ''}" data-hue="${h}" style="--avatar-hue:${h}" aria-label="Hue ${h}"></button>`).join('')}
        </div>
      </div>
      ${showPin ? `
        <label class="rx-form-toggle">
          <input type="checkbox" data-rx-pinned ${pinned ? 'checked' : ''}>
          <span class="rx-form-toggle-track"><span class="rx-form-toggle-thumb"></span></span>
          <span class="rx-form-toggle-text">
            <span class="rx-form-toggle-title">${esc(pinTitle)}</span>
            ${pinSub ? `<span class="rx-form-toggle-sub">${esc(pinSub)}</span>` : ''}
          </span>
        </label>
      ` : ''}
    `;
  }

  function _refreshAvatarPreview(root, state) {
    const preview = root.querySelector('[data-rx-avatar-preview]');
    if (!preview) return;
    // Photo wins over hue. Photo source = (in priority): pendingFile → URL → none.
    if (state._photoDataUrl) {
      preview.classList.add('has-photo');
      preview.style.backgroundImage = `url('${state._photoDataUrl}')`;
      preview.querySelector('.rx-avatar-initials')?.remove();
    } else {
      const urlInput = root.querySelector('[data-rx-photo-url]');
      const url = urlInput ? urlInput.value.trim() : '';
      if (url) {
        preview.classList.add('has-photo');
        preview.style.backgroundImage = `url('${url}')`;
        preview.querySelector('.rx-avatar-initials')?.remove();
      } else {
        preview.classList.remove('has-photo');
        preview.style.backgroundImage = '';
        if (!preview.querySelector('.rx-avatar-initials')) {
          const nameInput = root.querySelector('[data-rx-name]');
          const initials = getInitials(nameInput ? nameInput.value : '');
          const span = document.createElement('span');
          span.className = 'rx-avatar-initials';
          span.textContent = initials;
          preview.appendChild(span);
        } else {
          const nameInput = root.querySelector('[data-rx-name]');
          preview.querySelector('.rx-avatar-initials').textContent = getInitials(nameInput ? nameInput.value : '');
        }
      }
      // Update hue
      const picker = root.querySelector('[data-rx-hue-picker]');
      const sel = picker ? picker.dataset.selected : 'auto';
      if (sel === 'auto') {
        const nameInput = root.querySelector('[data-rx-name]');
        preview.style.setProperty('--avatar-hue', String(hashHue(nameInput ? nameInput.value : '')));
      } else {
        preview.style.setProperty('--avatar-hue', String(sel));
      }
    }
  }

  function wirePhotoPicker(root, state, opts) {
    opts = opts || {};
    if (!root) return;

    const avatarBtn = root.querySelector('[data-rx-avatar]');
    const uploadBtn = root.querySelector('[data-rx-photo-upload]');
    const clearBtn  = root.querySelector('[data-rx-photo-clear]');
    const fileInput = root.querySelector('[data-rx-photo-file]');
    const urlInput  = root.querySelector('[data-rx-photo-url]');
    const nameInput = root.querySelector('[data-rx-name]');

    const triggerFile = () => fileInput && fileInput.click();
    if (avatarBtn && !avatarBtn._rxBound) {
      avatarBtn._rxBound = true;
      avatarBtn.addEventListener('click', triggerFile);
    }
    if (uploadBtn && !uploadBtn._rxBound) {
      uploadBtn._rxBound = true;
      uploadBtn.addEventListener('click', triggerFile);
    }
    if (clearBtn && !clearBtn._rxBound) {
      clearBtn._rxBound = true;
      clearBtn.addEventListener('click', () => {
        state._photoDataUrl = null;
        state._photoFile = null;
        if (urlInput) urlInput.value = '';
        _refreshAvatarPreview(root, state);
      });
    }
    if (fileInput && !fileInput._rxBound) {
      fileInput._rxBound = true;
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = '';   // allow re-picking the same file later
        if (!f) return;
        if (opts.maxBytes && f.size > opts.maxBytes) {
          if (window.NX && NX.toast) NX.toast(opts.tooLargeMsg || 'Image too large', 'warn', 2000);
          return;
        }
        if (f.type && !f.type.startsWith('image/')) {
          if (window.NX && NX.toast) NX.toast('Please pick an image file', 'warn', 2000);
          return;
        }
        try {
          let dataUrl;
          if (opts.processFile) {
            // Caller-supplied processor — usually a downscaler. Returns a
            // data URL that gets stored as the avatar source.
            dataUrl = await opts.processFile(f);
          } else {
            dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload  = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
          }
          state._photoFile = f;
          state._photoDataUrl = dataUrl;
          // Mirror to the URL input so the Save handler picks it up via
          // readIdentityValues without needing to know about the file.
          if (urlInput) urlInput.value = dataUrl;
          _refreshAvatarPreview(root, state);
        } catch (err) {
          console.error('[recordEditor] photo process failed:', err);
          if (window.NX && NX.toast) NX.toast('Could not process that image', 'error', 2500);
        }
      });
    }
    if (urlInput && !urlInput._rxBound) {
      urlInput._rxBound = true;
      urlInput.addEventListener('input', () => {
        // URL takes precedence over previously-chosen file
        state._photoFile = null;
        state._photoDataUrl = null;
        _refreshAvatarPreview(root, state);
      });
    }
    if (nameInput && !nameInput._rxBound) {
      nameInput._rxBound = true;
      nameInput.addEventListener('input', () => _refreshAvatarPreview(root, state));
    }
  }

  function wireHuePicker(root, state) {
    if (!root) return;
    const picker = root.querySelector('[data-rx-hue-picker]');
    if (!picker || picker._rxBound) return;
    picker._rxBound = true;
    picker.querySelectorAll('.rx-hue-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        picker.querySelectorAll('.rx-hue-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        picker.dataset.selected = sw.dataset.hue;
        _refreshAvatarPreview(root, state);
      });
    });
  }

  /* ── reading values back from the identity card ───────────────────── */
  function readIdentityValues(root, state) {
    if (!root) return null;
    const nameEl = root.querySelector('[data-rx-name]');
    const urlEl  = root.querySelector('[data-rx-photo-url]');
    const picker = root.querySelector('[data-rx-hue-picker]');
    const pinEl  = root.querySelector('[data-rx-pinned]');
    const sel = picker ? picker.dataset.selected : 'auto';
    return {
      name: nameEl ? nameEl.value.trim() : '',
      photoUrl: urlEl ? urlEl.value.trim() : '',
      photoFile: (state && state._photoFile) || null,
      photoDataUrl: (state && state._photoDataUrl) || null,
      avatarHue: (sel === 'auto') ? null : Number(sel),
      pinned: pinEl ? pinEl.checked : false,
    };
  }

  /* ── overlay shell ────────────────────────────────────────────────── */
  function _close() {
    if (!activeOverlay) return;
    document.removeEventListener('keydown', activeOverlay.escHandler);
    if (activeOverlay.el && activeOverlay.el.parentNode) {
      activeOverlay.el.parentNode.removeChild(activeOverlay.el);
    }
    if (activeOverlay.config && activeOverlay.config.onClose) {
      try { activeOverlay.config.onClose(); } catch (_) {}
    }
    activeOverlay = null;
  }

  function openOverlay(config) {
    if (activeOverlay) _close();

    const state = config.state || {};
    state.expandedCards = state.expandedCards || new Set(
      (config.cards || []).filter(c => c.expanded !== false).map(c => c.key)
    );
    state.chips = state.chips || {};

    const cardsHTML = (config.cards || []).map(c => {
      const expanded = state.expandedCards.has(c.key);
      return buildCardHTML(c.key, c.title, expanded, c.body || '', { danger: !!c.danger, subtitle: c.subtitle, compact: !!c.compact });
    }).join('');

    const titleHTML = `
      <div class="rx-overlay-title">${esc(config.title || '')}</div>
      ${config.subtitle ? `<div class="rx-overlay-subtitle">${esc(config.subtitle)}</div>` : ''}
    `;
    const countChip = config.countChip
      ? `<div class="rx-overlay-count">${esc(config.countChip.num)}<span>${esc(config.countChip.label || '')}</span></div>`
      : '<div class="rx-overlay-spacer"></div>';
    const saveLabel = config.saveLabel || 'Save';
    const cancelLabel = config.cancelLabel || 'Cancel';

    const el = document.createElement('div');
    el.className = 'rx-overlay';
    el.innerHTML = `
      <div class="rx-overlay-head">
        <button class="rx-overlay-close" type="button" aria-label="Close">${ICON.arrowLeft}</button>
        <div class="rx-overlay-title-block">${titleHTML}</div>
        ${countChip}
      </div>
      <div class="rx-overlay-body">${cardsHTML}</div>
      <div class="rx-overlay-foot">
        <button class="rx-overlay-cancel" type="button">${esc(cancelLabel)}</button>
        <button class="rx-overlay-save" type="button">${esc(saveLabel)}</button>
      </div>
    `;
    document.body.appendChild(el);

    // Wire chrome
    el.querySelector('.rx-overlay-close').addEventListener('click', _close);
    el.querySelector('.rx-overlay-cancel').addEventListener('click', _close);

    const saveBtn = el.querySelector('.rx-overlay-save');
    saveBtn.addEventListener('click', async () => {
      if (!config.onSave) { _close(); return; }
      saveBtn.disabled = true;
      const oldLabel = saveBtn.textContent;
      saveBtn.textContent = 'Saving…';
      try {
        const result = await config.onSave(el, state);
        if (result !== false) _close();
      } catch (err) {
        console.error('[recordEditor] save failed:', err);
        if (window.NX && NX.toast) NX.toast(err && err.message ? err.message : 'Save failed', 'error', 3000);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = oldLabel;
      }
    });

    // Wire collapsibles
    wireCardToggles(el, state);

    // ESC closes
    const escHandler = (e) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', escHandler);

    activeOverlay = { el, config, state, escHandler };

    // Mount-time hook so callers can wire their card-specific widgets
    if (config.onMount) {
      try { config.onMount(el, state); } catch (err) { console.error('[recordEditor] onMount:', err); }
    }
    return el;
  }

  /* ── public API ───────────────────────────────────────────────────── */
  NX.recordEditor = {
    openOverlay,
    close: _close,

    // Builders
    buildCardHTML,
    buildChipGroupHTML,
    buildChipHTML,
    buildIdentityCardBody,

    // Wirers
    wireCardToggles,
    wireChipGroup,
    wirePhotoPicker,
    wireHuePicker,

    // Readers
    readIdentityValues,

    // Helpers (exposed for callers that want them)
    _utils: { esc, hashHue, getInitials, ICON },
  };
})(typeof NX !== 'undefined' ? NX : (window.NX = window.NX || {}));
/*
 * NOTE on the NX reference above:
 * app.js declares `const NX = {...}` at top level — a LEXICAL binding
 * visible to subsequent non-module scripts, but NOT a property on
 * window. So we must attach to that lexical NX (the one ordering.js
 * and equipment.js see) — not to window.NX, which would be a
 * different object. The ternary picks the lexical one if app.js
 * has loaded first; otherwise we create window.NX as a fallback.
 * This means record-editor.js MUST be loaded AFTER app.js in
 * index.html for the engine path to be reachable.
 */
