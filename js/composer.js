/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Composer — replaces native prompt() everywhere
   ────────────────────────────────────────────────────
   Two patterns, one module:
   
   1. NX.composer.inline(triggerEl, opts)
      The trigger element (a + Add button) is hidden and replaced with
      a textarea + submit pill + ✕ cancel. After submit the composer
      stays open for batch entry. Tap outside, ESC, or empty-submit
      closes. Used for: + Add card, + Add list, + Add board.
   
   2. NX.composer.modal(opts)
      A small focused dialog overlaid on the page. Backdrop blur, gold
      accent, title + textarea(s) + submit/cancel. Used for: Report
      issue (equipment), Custom cleaning extra (bilingual), Add link
      (equipment), Edit notes, etc. — anywhere the action isn't anchored
      to a + button.
   
   Both patterns:
     • Enter submits (Shift+Enter for newline)
     • Escape cancels
     • Click outside cancels
     • Submit fires opts.onSubmit(value) — async, can throw
     • Failed submit re-enables button + shows error toast (handled by caller)
   
   Loaded by index.html before any module that uses it.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  if (window.NX && NX.composer) return;  // idempotent
  window.NX = window.NX || {};

  /* ─── INLINE COMPOSER ──────────────────────────────────────────────── */
  function inline(triggerEl, opts) {
    if (!triggerEl) return;
    const placeholder = opts?.placeholder || 'Enter a title…';
    const buttonLabel = opts?.buttonLabel || 'Add';
    const onSubmit = opts?.onSubmit;
    const minRows = opts?.minRows || 2;

    const composer = document.createElement('div');
    composer.className = 'nx-composer';
    composer.innerHTML = `
      <textarea class="nx-composer-input" rows="${minRows}" placeholder="${esc(placeholder)}"></textarea>
      <div class="nx-composer-actions">
        <button type="button" class="nx-composer-submit">${esc(buttonLabel)}</button>
        <button type="button" class="nx-composer-cancel" title="Cancel" aria-label="Cancel">✕</button>
      </div>
    `;

    const parent = triggerEl.parentElement;
    if (!parent) return;
    triggerEl.style.display = 'none';
    parent.insertBefore(composer, triggerEl.nextSibling);

    const ta = composer.querySelector('.nx-composer-input');
    const submitBtn = composer.querySelector('.nx-composer-submit');
    const cancelBtn = composer.querySelector('.nx-composer-cancel');

    requestAnimationFrame(() => ta.focus());

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      composer.remove();
      triggerEl.style.display = '';
      document.removeEventListener('mousedown', onOutside, true);
    };
    const submit = async () => {
      const text = ta.value.trim();
      if (!text) { close(); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = '…';
      try {
        await onSubmit?.(text);
        ta.value = '';
        submitBtn.disabled = false;
        submitBtn.textContent = buttonLabel;
        ta.focus();
      } catch (e) {
        console.error('[composer.inline] submit failed:', e);
        submitBtn.disabled = false;
        submitBtn.textContent = buttonLabel;
        NX.toast && NX.toast('Add failed — try again', 'error');
      }
    };

    const onOutside = (e) => {
      if (!composer.contains(e.target)) {
        if (ta.value.trim()) submit();
        else close();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', close);
  }

  /* ─── MODAL COMPOSER ────────────────────────────────────────────────
     A focused floating dialog. Single field by default; can take
     multiple fields via opts.fields. Used wherever a + button anchor
     isn't natural (action menu items, "Report issue", etc.). */
  function modal(opts) {
    const title = opts?.title || 'New';
    const subtitle = opts?.subtitle || '';
    const buttonLabel = opts?.buttonLabel || 'Save';
    const onSubmit = opts?.onSubmit;
    const fields = opts?.fields
      || [{ name: 'value', placeholder: opts?.placeholder || '', autofocus: true, multiline: true, value: opts?.value || '' }];

    const bg = document.createElement('div');
    bg.className = 'nx-composer-modal-bg';

    // Build fields markup
    const fieldsHtml = fields.map((f, i) => {
      const id = `nxComp_${i}`;
      const tag = f.multiline ? 'textarea' : 'input';
      const rows = f.multiline ? (f.rows || 3) : '';
      const label = f.label
        ? `<label class="nx-composer-label" for="${id}">${esc(f.label)}</label>`
        : '';
      const attrs = [
        `id="${id}"`,
        `class="nx-composer-modal-field"`,
        `data-name="${esc(f.name)}"`,
        f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
        f.multiline ? `rows="${rows}"` : 'type="text"',
      ].filter(Boolean).join(' ');
      const value = esc(f.value || '');
      const inner = f.multiline ? value : '';
      const valueAttr = f.multiline ? '' : `value="${value}"`;
      return `<div class="nx-composer-field-wrap">${label}<${tag} ${attrs} ${valueAttr}>${inner}</${tag}></div>`;
    }).join('');

    bg.innerHTML = `
      <div class="nx-composer-modal" role="dialog" aria-label="${esc(title)}">
        <div class="nx-composer-modal-head">
          <div class="nx-composer-modal-title">${esc(title)}</div>
          ${subtitle ? `<div class="nx-composer-modal-sub">${esc(subtitle)}</div>` : ''}
        </div>
        <div class="nx-composer-modal-body">
          ${fieldsHtml}
        </div>
        <div class="nx-composer-modal-actions">
          <button type="button" class="nx-composer-modal-cancel">Cancel</button>
          <button type="button" class="nx-composer-modal-submit">${esc(buttonLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    const submitBtn = bg.querySelector('.nx-composer-modal-submit');
    const cancelBtn = bg.querySelector('.nx-composer-modal-cancel');
    const fieldEls = Array.from(bg.querySelectorAll('.nx-composer-modal-field'));

    // Focus first field
    requestAnimationFrame(() => {
      const focusTarget = fieldEls.find(el => el.dataset.name === fields.find(f => f.autofocus)?.name)
        || fieldEls[0];
      focusTarget?.focus();
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      bg.classList.add('is-leaving');
      setTimeout(() => bg.remove(), 180);
    };
    const collect = () => {
      const out = {};
      fieldEls.forEach(el => { out[el.dataset.name] = el.value.trim(); });
      // Convenience: if there's only one field, return its value directly
      if (fields.length === 1) return out[fields[0].name];
      return out;
    };
    const submit = async () => {
      const value = collect();
      // Empty single-field submit = cancel; multi-field allows partial
      if (fields.length === 1 && !value) { close(); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = '…';
      try {
        await onSubmit?.(value);
        close();
      } catch (e) {
        console.error('[composer.modal] submit failed:', e);
        submitBtn.disabled = false;
        submitBtn.textContent = buttonLabel;
        NX.toast && NX.toast('Failed — try again', 'error');
      }
    };

    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    cancelBtn.addEventListener('click', close);
    submitBtn.addEventListener('click', submit);

    fieldEls.forEach(el => {
      el.addEventListener('keydown', e => {
        // Enter on an input (not textarea) submits.
        // Cmd/Ctrl+Enter on a textarea submits.
        if (e.key === 'Enter') {
          if (el.tagName === 'INPUT') { e.preventDefault(); submit(); }
          else if (e.metaKey || e.ctrlKey) { e.preventDefault(); submit(); }
        } else if (e.key === 'Escape') {
          e.preventDefault(); close();
        }
      });
    });

    return { close };
  }

  /* ─── HELPERS ───────────────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ─── EXPORT ────────────────────────────────────────────────────── */
  NX.composer = { inline, modal };
})();
