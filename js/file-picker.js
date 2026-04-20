/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Universal File Picker v1
   
   One consistent file-picker popup used across the entire app:
     📷 Take Photo       (opens camera, single photo)
     🖼 Photo Library    (device gallery, supports multi-select)
     📎 Files            (any file type — PDFs, docs, etc)
   
   Usage:
     NX.filePicker.open({
       accept: 'image/*',      // MIME pattern, default 'image/*,application/pdf'
       multiple: false,        // allow multi-select
       onSelect: (files) => {} // callback with File[] array
     });
   
   Uses native Capacitor Camera when available (better UX inside APK),
   falls back to web file input. The popup is always shown first so user
   picks the source explicitly — no more "the camera opens when I wanted
   to pick from gallery" frustration.
   
   Load order: BEFORE all modules that use it. Safe to load globally in
   index.html right after supabase init.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('Read failed'));
      r.readAsDataURL(file);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     MAIN PICKER
     
     opts = {
       accept:   'image/*' | 'image/*,application/pdf' | '.pdf' etc
       multiple: boolean
       sources:  ['camera', 'library', 'files']  (subset to limit options)
       onSelect: (files: File[]) => void
       title:    custom popup title
     }
     ═════════════════════════════════════════════════════════════════════════ */

  function open(opts = {}) {
    const accept = opts.accept || 'image/*,application/pdf';
    const multiple = opts.multiple !== false;  // default true
    const sources = opts.sources || ['camera', 'library', 'files'];
    const title = opts.title || 'Add';
    const onSelect = opts.onSelect || (() => {});

    // Always dismiss any existing picker first
    document.querySelectorAll('.nx-fp-popup').forEach(p => p.remove());

    const popup = document.createElement('div');
    popup.className = 'nx-fp-popup';
    
    // Decide which buttons to show based on accept pattern + sources list
    const acceptsImage = /image/i.test(accept);
    const acceptsPdf = /pdf/i.test(accept);
    const acceptsAny = accept === '*' || accept === '*/*';
    
    const buttons = [];
    
    // CAMERA — only if the accept pattern wants images
    if (sources.includes('camera') && (acceptsImage || acceptsAny)) {
      buttons.push({
        key: 'camera',
        icon: '📷',
        name: 'Take Photo',
        sub: 'Use rear camera'
      });
    }
    
    // LIBRARY — only if accepts images
    if (sources.includes('library') && (acceptsImage || acceptsAny)) {
      buttons.push({
        key: 'library',
        icon: '🖼️',
        name: 'Photo Library',
        sub: multiple ? 'Choose one or many' : 'Choose one'
      });
    }
    
    // FILES — always available (respects accept filter)
    if (sources.includes('files')) {
      buttons.push({
        key: 'files',
        icon: '📎',
        name: 'Files',
        sub: fileTypesLabel(accept)
      });
    }

    popup.innerHTML = `
      <div class="nx-fp-bg"></div>
      <div class="nx-fp-card">
        <div class="nx-fp-title">${esc(title)}</div>
        <div class="nx-fp-options">
          ${buttons.map(b => `
            <button class="nx-fp-btn" data-source="${b.key}">
              <span class="nx-fp-icon">${b.icon}</span>
              <span class="nx-fp-name">${esc(b.name)}</span>
              <span class="nx-fp-sub">${esc(b.sub)}</span>
            </button>
          `).join('')}
        </div>
        <button class="nx-fp-cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(popup);

    const close = () => popup.remove();
    popup.querySelector('.nx-fp-bg').addEventListener('click', close);
    popup.querySelector('.nx-fp-cancel').addEventListener('click', close);
    
    popup.querySelectorAll('.nx-fp-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const source = btn.dataset.source;
        close();
        try {
          const files = await collectFiles(source, accept, multiple);
          if (files && files.length) onSelect(files);
        } catch (e) {
          console.warn('[file-picker] collection failed:', e);
        }
      });
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SOURCE-SPECIFIC COLLECTORS
     ═════════════════════════════════════════════════════════════════════════ */

  async function collectFiles(source, accept, multiple) {
    if (source === 'camera') {
      return await collectFromCamera();
    } else if (source === 'library') {
      return await collectFromFileInput(accept, multiple, false);  // no capture
    } else {
      // 'files' = general file picker, no capture
      return await collectFromFileInput(accept, multiple, false);
    }
  }

  // CAMERA — prefers native Capacitor plugin if running in the APK,
  // falls back to web <input capture="environment"> which on mobile opens
  // the camera app directly.
  async function collectFromCamera() {
    // Try native Capacitor Camera first
    if (window.Capacitor?.Plugins?.Camera) {
      try {
        const Camera = window.Capacitor.Plugins.Camera;
        const photo = await Camera.getPhoto({
          quality: 85,
          resultType: 'base64',
          source: 'CAMERA',
          width: 2000,
          correctOrientation: true
        });
        if (photo?.base64String) {
          // Convert base64 back to a File object so callers have consistent interface
          const byteStr = atob(photo.base64String);
          const mime = 'image/' + (photo.format || 'jpeg');
          const bytes = new Uint8Array(byteStr.length);
          for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
          const blob = new Blob([bytes], { type: mime });
          const file = new File([blob], `photo-${Date.now()}.${photo.format || 'jpg'}`, { type: mime });
          return [file];
        }
      } catch (e) {
        if (e.message?.includes('cancelled') || e.message?.includes('User cancelled')) {
          return [];
        }
        console.warn('[file-picker] native camera failed, falling back:', e.message);
      }
    }

    // Web fallback — file input with capture attribute
    return await collectFromFileInput('image/*', false, true);
  }

  // Generic file input — capture=true means force-camera, false means 
  // user picks from gallery/files on native mobile browsers.
  function collectFromFileInput(accept, multiple, capture) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (multiple) input.multiple = true;
      if (capture) input.capture = 'environment';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      
      let settled = false;
      input.onchange = () => {
        if (settled) return;
        settled = true;
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      };
      
      // iOS sometimes never fires 'change' if user cancels, detect via focus
      const onFocus = () => {
        setTimeout(() => {
          if (settled) return;
          if (!input.files || !input.files.length) {
            settled = true;
            input.remove();
            resolve([]);
          }
        }, 500);
      };
      window.addEventListener('focus', onFocus, { once: true });
      
      document.body.appendChild(input);
      input.click();
    });
  }

  function fileTypesLabel(accept) {
    if (!accept || accept === '*' || accept === '*/*') return 'Any file type';
    const types = accept.split(',').map(t => t.trim());
    const pretty = types.map(t => {
      if (t === 'image/*') return 'images';
      if (t === 'application/pdf') return 'PDF';
      if (t === 'video/*') return 'video';
      if (t === 'audio/*') return 'audio';
      if (t.startsWith('.')) return t.slice(1).toUpperCase();
      if (t.startsWith('application/')) return t.split('/')[1].toUpperCase();
      return t;
    });
    // Dedupe
    return [...new Set(pretty)].join(', ');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     HELPERS — convenience wrappers
     ═════════════════════════════════════════════════════════════════════════ */

  // Promise-based: returns the file(s) instead of using callback
  function pick(opts = {}) {
    return new Promise((resolve) => {
      open({ ...opts, onSelect: resolve });
    });
  }

  // Convert File → base64 (for API uploads)
  async function fileToB64(file) {
    return await fileToBase64(file);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     EXPOSE
     ═════════════════════════════════════════════════════════════════════════ */

  window.NX = window.NX || {};
  NX.filePicker = {
    open,
    pick,
    fileToBase64: fileToB64
  };

  console.log('[file-picker] ready');
})();
