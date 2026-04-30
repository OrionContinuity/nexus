/* ═══════════════════════════════════════════════════════════════════
   NEXUS Translation Layer — NX.tr

   A client-side helper that calls the /translate edge function and
   manages per-element UI (buttons, toggles, badges). Unlike the old
   i18n dictionary approach, this handles USER-GENERATED CONTENT —
   vendor emails, ticket notes, comments, chat replies, card
   descriptions — on demand, in place.

   Three surface methods:

   NX.tr.text(str, target?)
     → Promise<string> — raw translation, no UI
     → target defaults to current user's preferred language

   NX.tr.inline(element, opts)
     → Appends a 🌐 button next to the element's text. First tap
       translates + replaces the text, shows a "show original" link.
       Tap again to restore. Preserves innerHTML structure.

   NX.tr.auto(element, opts)
     → Same as inline, but auto-translates on first render if the
       detected content language differs from the user's preference.

   Memory cache (by content hash) in addition to server cache — avoids
   re-hitting the edge function for the same string in one session.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (window.NX?.tr) return; // already loaded

  const SUPPORTED = ['en', 'es', 'fr', 'pt', 'it', 'de', 'zh', 'ja', 'ko', 'vi', 'ar', 'hi'];
  const LANG_NAMES = {
    en: 'English', es: 'Español', fr: 'Français', pt: 'Português',
    it: 'Italiano', de: 'Deutsch', zh: '中文', ja: '日本語',
    ko: '한국어', vi: 'Tiếng Việt', ar: 'العربية', hi: 'हिन्दी',
  };

  // In-memory cache — a Map keyed by `${target}:${hash of text}`.
  // Survives a session but not a reload. Server cache handles reloads.
  const memCache = new Map();

  // Tiny-text detector — skip the API for one-word or all-digit content
  // (numbers, model IDs, proper nouns that don't translate anyway).
  function isTrivial(text) {
    const trimmed = String(text || '').trim();
    if (trimmed.length < 3) return true;
    if (/^[\d\s\-.,:/$€£¥]+$/.test(trimmed)) return true;
    return false;
  }

  // Naive client-side language guess. Just distinguishes Latin vs
  // non-Latin scripts; doesn't try to distinguish Spanish vs Italian.
  // Used only to decide whether to auto-translate — server has the
  // real detection via Claude.
  function quickDetect(text) {
    const sample = String(text || '').slice(0, 500);
    if (!sample) return 'unknown';
    // Chinese/Japanese/Korean
    if (/[\u4e00-\u9fff]/.test(sample)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) return 'ja';
    if (/[\uac00-\ud7af]/.test(sample)) return 'ko';
    if (/[\u0600-\u06ff]/.test(sample)) return 'ar';
    if (/[\u0900-\u097f]/.test(sample)) return 'hi';
    // Spanish / Portuguese / French signatures (rough)
    if (/\b(que|para|con|está|también|más|día|años|también|gracias)\b/i.test(sample)) return 'es';
    if (/\b(que|para|com|não|também|são|você|obrigado)\b/i.test(sample)) return 'pt';
    if (/\b(que|pour|avec|pas|très|merci|aussi|être)\b/i.test(sample)) return 'fr';
    return 'en'; // default — conservative
  }

  // Get the user's preferred language. Falls back to localStorage then
  // English. This is the single source of truth other UI code can read.
  function userLang() {
    return (
      NX.currentUser?.language ||
      localStorage.getItem('nexus_lang') ||
      'en'
    );
  }

  // Core translate — memoized. Calls /translate edge function.
  async function text(input, target) {
    const tgt = target || userLang();
    if (!tgt || !SUPPORTED.includes(tgt)) return input;
    if (isTrivial(input)) return input;
    const key = `${tgt}:${input.length}:${hashString(input)}`;
    if (memCache.has(key)) return memCache.get(key);

    try {
      const cfg = window.NEXUS_CONFIG || {};
      const url = (cfg.SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/translate';
      const apiKey = cfg.SUPABASE_ANON || '';
      if (!cfg.SUPABASE_URL || !apiKey) {
        console.warn('[NX.tr] text: NEXUS_CONFIG missing SUPABASE_URL/SUPABASE_ANON');
        return input;
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'apikey': apiKey,
        },
        body: JSON.stringify({ text: input, target: tgt }),
      });
      if (!resp.ok) {
        console.warn('[NX.tr] translate HTTP ' + resp.status);
        return input;
      }
      const data = await resp.json();
      const out = data?.translated || input;
      memCache.set(key, out);
      return out;
    } catch (e) {
      console.warn('[NX.tr] translate failed:', e?.message || e);
      return input; // graceful fallback — show original on error
    }
  }

  // Quick string hash for cache key (not cryptographic, just dedup).
  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return h.toString(36);
  }

  // Attach an inline 🌐 button to an element. The button toggles
  // between "show translation" and "show original". Preserves the
  // element's other children (badges, icons) by only swapping text
  // nodes. Idempotent — calling twice is a no-op.
  function inline(element, opts = {}) {
    if (!element || element.dataset.trBound === '1') return;
    element.dataset.trBound = '1';
    const originalHTML = element.innerHTML;
    const originalText = element.textContent.trim();
    if (isTrivial(originalText)) return;

    const target = opts.target || userLang();
    if (!target || !SUPPORTED.includes(target)) return;

    // Don't offer translation if content looks like it's already in
    // the user's language.
    const detected = quickDetect(originalText);
    if (detected === target && !opts.forceOffer) return;

    const btn = document.createElement('button');
    btn.className = 'nx-tr-btn';
    btn.title = `Translate to ${LANG_NAMES[target] || target}`;
    btn.textContent = '🌐';
    btn.style.cssText =
      'margin-left:6px;padding:2px 6px;font-size:11px;background:transparent;' +
      'border:1px solid rgba(212,164,78,0.3);border-radius:10px;cursor:pointer;' +
      'color:#c8a44e;font-family:inherit;vertical-align:middle;';
    element.appendChild(document.createTextNode(' '));
    element.appendChild(btn);

    let showingTranslation = false;
    let cached = null;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (showingTranslation) {
        element.innerHTML = originalHTML;
        element.appendChild(document.createTextNode(' '));
        element.appendChild(btn); // re-attach after innerHTML swap
        btn.textContent = '🌐';
        btn.title = `Translate to ${LANG_NAMES[target] || target}`;
        showingTranslation = false;
        return;
      }
      btn.textContent = '…';
      btn.disabled = true;
      try {
        if (!cached) cached = await text(originalText, target);
        // Replace the element's text content while keeping the button.
        // We rebuild innerHTML with the translated text + the original
        // button re-attached.
        element.textContent = cached;
        element.appendChild(document.createTextNode(' '));
        const back = document.createElement('button');
        back.className = 'nx-tr-btn';
        back.textContent = '↺ original';
        back.style.cssText = btn.style.cssText;
        back.addEventListener('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          element.innerHTML = originalHTML;
          element.appendChild(document.createTextNode(' '));
          element.appendChild(btn);
          showingTranslation = false;
        });
        element.appendChild(back);
        showingTranslation = true;
      } catch (err) {
        btn.textContent = '⚠';
        btn.title = 'Translation failed — tap to retry';
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Auto-translate — same as inline(), but triggers translation
  // immediately if detected language differs from target. Shows a
  // small "translated from X" badge above the content.
  async function auto(element, opts = {}) {
    if (!element || element.dataset.trAutoBound === '1') return;
    element.dataset.trAutoBound = '1';
    const target = opts.target || userLang();
    const original = element.textContent.trim();
    if (isTrivial(original)) return;
    const detected = quickDetect(original);
    if (detected === target) {
      // Same-language content — still offer manual translate button in
      // case our detection is wrong.
      inline(element, { target, forceOffer: false });
      return;
    }
    // Different language — translate immediately with a badge.
    const originalHTML = element.innerHTML;
    const badge = document.createElement('div');
    badge.className = 'nx-tr-badge';
    badge.style.cssText =
      'font-size:10px;letter-spacing:0.5px;color:#857f75;margin-bottom:4px;' +
      'text-transform:uppercase;font-weight:600;';
    badge.innerHTML =
      `Translated from ${LANG_NAMES[detected] || detected} ` +
      `<button class="nx-tr-show-original" style="background:none;border:0;color:#c8a44e;cursor:pointer;font-size:10px;padding:0;margin-left:6px;font-family:inherit;">show original</button>`;

    try {
      const translated = await text(original, target);
      if (translated && translated.trim() !== original.trim()) {
        element.textContent = translated;
        element.parentNode?.insertBefore(badge, element);
        let showing = 'translated';
        badge.querySelector('.nx-tr-show-original').addEventListener('click', (e) => {
          e.stopPropagation();
          if (showing === 'translated') {
            element.innerHTML = originalHTML;
            e.target.textContent = 'show translation';
            showing = 'original';
          } else {
            element.textContent = translated;
            e.target.textContent = 'show original';
            showing = 'translated';
          }
        });
      }
    } catch (e) {
      // Silent — leave original content alone on error
    }
  }

  // Initialize NX.tr with only the functions defined IN this IIFE.
  // The second IIFE below adds batch, translatePage, revertPage,
  // setTarget, mountFab, openPicker after they're defined. Previous
  // version referenced those names HERE — but they hadn't been
  // declared yet, so this whole assignment threw a ReferenceError
  // and NX.tr never existed. That's why the FAB never appeared and
  // every NX.tr.translatePage call silently failed.
  NX.tr = {
    text,
    inline,
    auto,
    userLang,
    supported: SUPPORTED,
    names: LANG_NAMES,
  };

  console.log('[NX.tr] ready — default target: ' + userLang());
})();

// ═════════════════════════════════════════════════════════════════════
// PAGE-WIDE TRANSLATION — called via the floating 🌐 FAB
// ═════════════════════════════════════════════════════════════════════
(function(){
  'use strict';
  if (!window.NX?.tr) return;
  const tr = NX.tr;

  const SUPPORTED = tr.supported;
  const LANG_NAMES = tr.names;

  // Tags we never walk into. Inputs/textareas are user-editable (can't
  // swap text mid-edit). Code/pre preserve technical content. Style and
  // script are obviously off-limits.
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
    'CANVAS', 'SVG',
  ]);
  // Classes that opt out of translation (brand marks, our own translate
  // UI, mini widgets that mangle if their text changes).
  const SKIP_CLASSES = [
    'nx-no-tr', 'nx-tr-btn', 'nx-tr-badge',
    'home-mast-brand',                 // "NEXUS" brand word
    'home-mini-galaxy',
    'nx-tr-fab', 'nx-tr-picker',
    'feed-ts', 'chat-time', 'b-card-meta-assignee',
  ];

  // Collect all translatable text nodes beneath `root`. Skips scripts,
  // inputs, our own UI, brand marks, and pure-number/symbol strings.
  function collectTextNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(
      root, NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const t = node.nodeValue;
          if (!t || !t.trim()) return NodeFilter.FILTER_REJECT;
          const trimmed = t.trim();
          if (trimmed.length < 2) return NodeFilter.FILTER_REJECT;
          // Skip pure numbers, dates, prices, model codes
          if (/^[\d\s\-.,:/$€£¥%+*()#@]+$/.test(trimmed)) return NodeFilter.FILTER_REJECT;
          // Walk up, check parent chain for skip conditions
          let p = node.parentElement;
          while (p && p !== root.parentElement) {
            if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
            if (p.classList) {
              for (const c of SKIP_CLASSES) {
                if (p.classList.contains(c)) return NodeFilter.FILTER_REJECT;
              }
            }
            // Skip anything marked contenteditable — user is typing
            if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  // Save the original nodeValue to the text node itself. Using a
  // property (not dataset, which only works on elements) so we survive
  // re-renders only of nodes we still hold references to. If the page
  // re-renders and creates new text nodes, we simply have to translate
  // them fresh — originals are saved lazily.
  function saveOriginal(node) {
    if (node._trOriginal === undefined) {
      node._trOriginal = node.nodeValue;
    }
  }

  // Batch translate — call the edge function directly via fetch.
  // We bypassed `NX.sb.functions.invoke` because supabase-js wraps the
  // call in a way that swallows useful error context and our particular
  // CORS/auth combination kept failing silently. A direct fetch is
  // simpler, gives us the real HTTP error, and the anon key is already
  // public-safe (it's a publishable key, not a secret).
  async function batch(texts, target) {
    const tgt = target || tr.userLang();
    if (!tgt || !SUPPORTED.includes(tgt)) return texts;
    if (!Array.isArray(texts) || texts.length === 0) return texts;

    const cfg = window.NEXUS_CONFIG || {};
    const url = (cfg.SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/translate';
    const key = cfg.SUPABASE_ANON || '';
    if (!cfg.SUPABASE_URL || !key) {
      console.warn('[NX.tr] batch: NEXUS_CONFIG missing SUPABASE_URL/SUPABASE_ANON');
      return texts;
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
          'apikey': key,
        },
        body: JSON.stringify({ texts, target: tgt }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        // Surface a visible toast on first failure so the user knows
        // translation broke instead of silently showing English.
        showToast('Translate ' + resp.status + ': ' + errBody.slice(0, 80));
        console.warn('[NX.tr] batch HTTP ' + resp.status + ':', errBody.slice(0, 300));
        return texts;
      }

      const data = await resp.json();
      if (!data || !Array.isArray(data.translations)) {
        showToast('Translate: bad response shape');
        console.warn('[NX.tr] batch: unexpected response:', data);
        return texts;
      }
      return data.translations;
    } catch (e) {
      showToast('Translate failed: ' + (e?.message || 'network error'));
      console.warn('[NX.tr] batch failed:', e?.message || e);
      return texts;
    }
  }

  // Translate every text node in `root` (or full document) to `target`.
  // Progressive — swaps nodes as batches return, so user sees the page
  // translate in waves rather than waiting for everything.
  async function translatePage(target, opts) {
    const tgt = target || tr.userLang();
    if (!tgt || !SUPPORTED.includes(tgt)) return;
    opts = opts || {};
    const root = opts.root || document.body;
    const onProgress = opts.onProgress || null;

    const nodes = collectTextNodes(root);
    if (nodes.length === 0) { onProgress?.(1); return; }

    // Save originals before any mutation
    nodes.forEach(saveOriginal);

    // Skip nodes whose text already matches target (rough heuristic).
    // Speeds up re-applying the same language after a re-render.
    const pending = nodes.filter(n => {
      const t = (n._trOriginal || n.nodeValue).trim();
      return !isAlreadyTargetLang(t, tgt);
    });

    const BATCH = 20;
    let done = 0;
    for (let i = 0; i < pending.length; i += BATCH) {
      const slot = pending.slice(i, i + BATCH);
      // Always translate from the SAVED ORIGINAL so switching languages
      // repeatedly doesn't compound errors ("English → Spanish → Spanish
      // → Japanese" would degrade; always "English → X" stays clean).
      const texts = slot.map(n => (n._trOriginal || n.nodeValue).trim());
      const translated = await batch(texts, tgt);
      slot.forEach((node, idx) => {
        const original = node._trOriginal || node.nodeValue;
        const lead = original.match(/^\s*/)[0];
        const trail = original.match(/\s*$/)[0];
        const result = translated[idx];
        if (result && result.trim() && result.trim() !== original.trim()) {
          node.nodeValue = lead + result + trail;
        }
      });
      done += slot.length;
      onProgress?.(done / pending.length);
    }
    // Save the applied target so navigation/view-switches know to re-apply
    document._nxTrActive = tgt;
  }

  // Restore all nodes to their saved originals. Idempotent.
  function revertPage(opts) {
    opts = opts || {};
    const root = opts.root || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n._trOriginal !== undefined && n.nodeValue !== n._trOriginal) {
        n.nodeValue = n._trOriginal;
      }
    }
    document._nxTrActive = null;
  }

  // Quick heuristic — is this text clearly already in the target lang?
  // We only check the obvious high-signal cases. Anything ambiguous
  // goes through Claude which will pass through unchanged strings.
  function isAlreadyTargetLang(text, target) {
    if (!text) return true;
    // For script-distinguishable languages, check characters
    if (target === 'zh' && /[\u4e00-\u9fff]/.test(text)) return true;
    if (target === 'ja' && /[\u3040-\u30ff]/.test(text)) return true;
    if (target === 'ko' && /[\uac00-\ud7af]/.test(text)) return true;
    if (target === 'ar' && /[\u0600-\u06ff]/.test(text)) return true;
    if (target === 'hi' && /[\u0900-\u097f]/.test(text)) return true;
    return false;
  }

  // Apply a user's language choice: persist, update i18n if present,
  // then either translate the visible DOM or revert.
  async function setTarget(lang, opts) {
    opts = opts || {};
    const prev = localStorage.getItem('nexus_lang');
    localStorage.setItem('nexus_lang', lang);
    // Sync with legacy dictionary i18n (affects data-i18n elements)
    if (window.NEXUS_I18N?.setLang) {
      try { window.NEXUS_I18N.setLang(lang); } catch(_) {}
    }
    // If user went back to English AND we had translations applied,
    // revert the DOM so they see the true originals (not Claude's
    // attempt at "translating English to English" which can drift).
    if (lang === 'en') {
      revertPage();
      showToast('Showing original (English)');
      return;
    }
    // Otherwise translate the page progressively with a toast
    const toast = showProgressToast(`Translating to ${LANG_NAMES[lang] || lang}…`);
    try {
      await translatePage(lang, {
        onProgress: (pct) => toast.setProgress(pct),
      });
      toast.done(`✓ ${LANG_NAMES[lang] || lang}`);
    } catch (e) {
      console.warn('[NX.tr] setTarget failed:', e);
      toast.fail('Translation failed');
    }
  }

  // ── FAB + PICKER UI ────────────────────────────────────────────────
  // One floating button, bottom-right above the bottom nav. Shows the
  // current target language. Tap → picker modal. Mounted once per app
  // session after login; absent on PIN screen (PIN screen has its own
  // English/Español toggle for pre-auth).
  function mountFab() {
    if (document.getElementById('nxTrFab')) return;
    const fab = document.createElement('button');
    fab.id = 'nxTrFab';
    fab.className = 'nx-tr-fab';
    fab.type = 'button';
    fab.innerHTML = `<span class="nx-tr-fab-icon">🌐</span><span class="nx-tr-fab-lang" id="nxTrFabLang">${currentCode()}</span>`;
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPicker();
    });
    document.body.appendChild(fab);
    // Re-apply saved non-English lang on startup so users don't have to
    // tap the FAB every session. Small delay lets modules finish their
    // first render, then we translate their output.
    const saved = localStorage.getItem('nexus_lang');
    if (saved && saved !== 'en' && SUPPORTED.includes(saved)) {
      setTimeout(() => {
        translatePage(saved).catch(() => {});
      }, 800);
    }
  }

  function currentCode() {
    const l = tr.userLang();
    return (l || 'en').toUpperCase();
  }

  function refreshFab() {
    const el = document.getElementById('nxTrFabLang');
    if (el) el.textContent = currentCode();
  }

  // Picker modal — two big EN/ES buttons on top (the team's primary
  // languages), "More languages" expands the rest. Picking applies
  // immediately and closes the modal.
  function openPicker() {
    const existing = document.getElementById('nxTrPicker');
    if (existing) { existing.remove(); return; }
    const current = tr.userLang();
    const modal = document.createElement('div');
    modal.id = 'nxTrPicker';
    modal.className = 'nx-tr-picker-bg';
    const primary = [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Español' },
    ];
    const others = SUPPORTED.filter(c => !primary.find(p => p.code === c));
    modal.innerHTML = `
      <div class="nx-tr-picker">
        <div class="nx-tr-picker-head">
          <span class="nx-tr-picker-title">Translate this screen</span>
          <button class="nx-tr-picker-close" type="button">✕</button>
        </div>
        <div class="nx-tr-picker-primary">
          ${primary.map(p => `
            <button class="nx-tr-lang-btn${p.code===current?' active':''}" data-lang="${p.code}">
              <span class="nx-tr-lang-name">${p.name}</span>
              ${p.code===current?'<span class="nx-tr-lang-check">✓</span>':''}
            </button>
          `).join('')}
        </div>
        <details class="nx-tr-picker-more">
          <summary>More languages</summary>
          <div class="nx-tr-picker-grid">
            ${others.map(c => `
              <button class="nx-tr-lang-chip${c===current?' active':''}" data-lang="${c}">
                ${LANG_NAMES[c]}
              </button>
            `).join('')}
          </div>
        </details>
        <div class="nx-tr-picker-note">
          Translations are cached — after the first time, they're instant.
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.nx-tr-picker-close').addEventListener('click', close);
    modal.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const lang = btn.dataset.lang;
        close();
        await setTarget(lang);
        refreshFab();
      });
    });
  }

  // ── Progress toast — bottom-center, shows "Translating… 45%" then
  // fades to "✓ Spanish" for 1.5s. Separate from global NX.toast so it
  // can update in place during the translation walk.
  function showToast(msg) {
    const t = showProgressToast(msg);
    t.done(msg);
    return t;
  }

  function showProgressToast(initialMsg) {
    // Dedupe — if one's already up, reuse it
    let el = document.getElementById('nxTrToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nxTrToast';
      el.className = 'nx-tr-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <span class="nx-tr-toast-text">${escapeHtml(initialMsg)}</span>
      <span class="nx-tr-toast-bar"><span class="nx-tr-toast-bar-fill" style="width:5%"></span></span>
    `;
    el.classList.remove('is-done', 'is-fail', 'is-leaving');
    el.classList.add('is-active');

    return {
      setProgress(pct) {
        const fill = el.querySelector('.nx-tr-toast-bar-fill');
        if (fill) fill.style.width = Math.min(100, Math.max(5, pct * 100)) + '%';
      },
      done(msg) {
        el.classList.add('is-done');
        el.innerHTML = `<span class="nx-tr-toast-text">${escapeHtml(msg || '✓ Done')}</span>`;
        setTimeout(() => { el.classList.add('is-leaving'); }, 1500);
        setTimeout(() => { el.remove(); }, 2000);
      },
      fail(msg) {
        el.classList.add('is-fail');
        el.innerHTML = `<span class="nx-tr-toast-text">${escapeHtml(msg || 'Failed')}</span>`;
        setTimeout(() => { el.classList.add('is-leaving'); }, 2500);
        setTimeout(() => { el.remove(); }, 3000);
      },
    };
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Expose
  NX.tr.batch = batch;
  NX.tr.translatePage = translatePage;
  NX.tr.revertPage = revertPage;
  NX.tr.setTarget = setTarget;
  NX.tr.mountFab = mountFab;
  NX.tr.openPicker = openPicker;
})();
