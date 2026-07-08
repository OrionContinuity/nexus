/* ═══════════════════════════════════════════════════════════════════════════════

   NEXUS EQUIPMENT — unified module
   ────────────────────────────────
   One file. Everything equipment-related lives here.

   This replaces:
     equipment.js, equipment-ai.js, equipment-p3.js, equipment-ux.js,
     equipment-ai-creator.js, equipment-full-editor.js, equipment-p4.js

   Structure:
     1. CONSTANTS & STATE
     2. CORE            — CRUD, filtering, list/grid render
     3. DETAIL          — the detail modal (overview/timeline/parts/manual/qr + intel + family + dispatch)
     4. EDIT            — full editor (6 tabs), add/edit modal, service log, parts
     5. AI              — data plate scanner, manual fetch, BOM extract, pattern detect, cost
     6. AI CREATE       — describe/photo/bulk/dataplate entry points
     7. PRINTING        — QR paper stickers + Zebra ZPL + Labelary preview
     8. PUBLIC SCAN     — no-auth QR view + report issue
     9. ATTACHMENTS     — files, photos, links, notes, custom fields
    10. LINEAGE         — family tree (parent/child equipment)
    11. DISPATCH        — contractor dispatch sheet, dispatch_log
    12. UI INJECTION    — header buttons, detail actions, per-row buttons
    13. UTILITIES       — esc, escAttr, fileToBase64, catIcon, etc.
    14. EXPORT          — NX.modules.equipment

   ═══════════════════════════════════════════════════════════════════════════════ */

(function(){

/* ════════════════════════════════════════════════════════════════════════════
   1. CONSTANTS & STATE
   ════════════════════════════════════════════════════════════════════════════ */

// v18.22 — was `const LOCATIONS`. Changed to `let` so loadLocationsFromDB()
// can replace the array with user-created locations. The hardcoded
// fallback is used only if the `locations` table is missing or empty.
let LOCATIONS = ['Suerte', 'Este', 'Bar Toti'];
// Full per-location metadata loaded from DB (id, label, photo_url,
// address, avatar_hue, sort_order, last_opened_at). Empty until
// loadLocationsFromDB() runs, then populated with whatever's in the
// `locations` table. UI code reads from this for the card view.
let LOCATION_META = [];
// v18.18 — was `const CATEGORIES`. Changed to `let` so loadCategoriesFromDB()
// can replace the array with user-created categories from the
// `equipment_categories` table. The hardcoded list below is now the
// FALLBACK used only if the table doesn't exist or returns empty.
// All consuming code uses `CATEGORIES.map(...)` etc. — works either way.
let CATEGORIES = [
  /* Note: the visual icons for these come from ICON_PATHS below
     (Lucide-derived SVG line art). The previous .icon emoji fields
     were dead code — never read by any render path — so they've
     been dropped to keep the data definition clean. */
  { key: 'refrigeration', label: 'Refrigeration' },
  { key: 'cooking',       label: 'Cooking'       },
  { key: 'ice',           label: 'Ice'           },
  { key: 'hvac',          label: 'HVAC'          },
  { key: 'dish',          label: 'Dishwashing'   },
  { key: 'bev',           label: 'Beverage'      },
  { key: 'smallware',     label: 'Smallware'     },
  { key: 'furniture',     label: 'Furniture'     },
  { key: 'other',         label: 'Other'         },
];

/* ─── Category icon SVG paths ───────────────────────────────────────
   Replaces the emoji icons with clean Lucide-based line art that
   matches the rest of the NEXUS visual language (used elsewhere in
   the public scan and on the QR sticker pages). Emojis render
   inconsistently across devices and feel out-of-place against the
   editorial typography. SVG glyphs scale with parent font-size and
   inherit currentColor, so they pick up the gold accent automatically.
   Paths are lifted from lucide-static (MIT). 24×24 viewBox. */
// v18.18 — was `const ICON_PATHS`. Same reason as CATEGORIES above:
// loadCategoriesFromDB() rebuilds this map from each row's icon_path.
let ICON_PATHS = {
  refrigeration: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M3 10h18"/><path d="M8 6v0"/><path d="M8 14v0"/>',
  cooking:       '<path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>',
  ice:           '<path d="M2 12h20"/><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="m19.07 4.93-14.14 14.14"/>',
  hvac:          '<path d="M12 12v9"/><path d="M12 3v3"/><path d="m4.93 4.93 2.12 2.12"/><path d="m16.95 16.95 2.12 2.12"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m4.93 19.07 2.12-2.12"/><path d="m16.95 7.05 2.12-2.12"/><circle cx="12" cy="12" r="3"/>',
  dish:          '<path d="M3 12c.5-2 1.5-3 3-3 1.5 0 2.5 1 3 3"/><path d="M9 12c.5-2 1.5-3 3-3 1.5 0 2.5 1 3 3"/><path d="M15 12c.5-2 1.5-3 3-3 1.5 0 2.5 1 3 3"/><path d="M3 18h18"/><path d="M5 18l1 3h12l1-3"/>',
  bev:           '<path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2"/>',
  smallware:     '<path d="M8 7V2"/><path d="M11 4V2"/><path d="M5 4V2"/><path d="M5 7c0 4 1 6 3 6h0c2 0 3-2 3-6"/><path d="M8 13v9"/><path d="M16 22V2c2 0 3 1 3 4v7h-3"/>',
  furniture:     '<path d="M2 9V5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v4"/><path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/>',
  other:         '<circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>',
};

/* ════════════════════════════════════════════════════════════════════
   v18.18 — User-creatable categories with custom icons.

   loadCategoriesFromDB() runs during init(), fetches the
   equipment_categories table, and rebuilds the in-memory CATEGORIES
   array + ICON_PATHS map from the rows. If the table is missing or
   empty, the hardcoded fallback above stays in effect.

   openCategoryManager() opens the management overlay where users can
   add/rename/archive/reorder categories and pick or paste icons.
   ════════════════════════════════════════════════════════════════════ */

// Preset icon library — Lucide-derived line art appropriate for a
// restaurant/equipment context. The user picks from this grid OR
// pastes a custom SVG path. Each value is the *inner contents* of an
// SVG (no <svg> wrapper) so the same rendering pipeline as the
// hardcoded ICON_PATHS works without changes.
const PRESET_ICONS = [
  { key: 'thermometer',  label: 'Thermometer', path: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>' },
  { key: 'flame',        label: 'Flame',       path: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>' },
  { key: 'sun',          label: 'Sun',         path: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>' },
  { key: 'umbrella',     label: 'Shade',       path: '<path d="M22 12a10.06 10.06 1 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>' },
  { key: 'box',          label: 'Box',         path: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>' },
  { key: 'table',        label: 'Table',       path: '<path d="M12 3v17"/><path d="M3 8h18"/><path d="M3 8v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8"/>' },
  { key: 'chair',        label: 'Chair',       path: '<path d="M6 19v2"/><path d="M18 19v2"/><path d="M18 9V5a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v4"/><path d="M5 13h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z"/><path d="M5 13V9h14v4"/>' },
  { key: 'wrench',       label: 'Wrench',      path: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
  { key: 'power',        label: 'Power',       path: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>' },
  { key: 'plug',         label: 'Plug',        path: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>' },
  { key: 'lightbulb',    label: 'Light',       path: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>' },
  { key: 'wind',         label: 'Wind',        path: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>' },
  { key: 'wifi',         label: 'WiFi',        path: '<path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><line x1="12" x2="12.01" y1="20" y2="20"/>' },
  { key: 'camera',       label: 'Camera',      path: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>' },
  { key: 'speaker',      label: 'Speaker',     path: '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><circle cx="12" cy="14" r="4"/><line x1="12" x2="12.01" y1="6" y2="6"/>' },
  { key: 'coffee',       label: 'Coffee',      path: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/>' },
  { key: 'beer',         label: 'Beer',        path: '<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5C9.44 3.5 10 3 12 3s2.56.5 3.5.5c.78 0 1.5-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/>' },
  { key: 'utensils',     label: 'Utensils',    path: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>' },
  { key: 'hammer',       label: 'Hammer',      path: '<path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>' },
  { key: 'shield',       label: 'Security',    path: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>' },
  { key: 'truck',        label: 'Delivery',    path: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>' },
  { key: 'monitor',      label: 'Display',     path: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>' },
  { key: 'leaf',         label: 'Plant',       path: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-2.4 17.94-8.2 17.04Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>' },
  { key: 'water-drop',   label: 'Water',       path: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>' },
];

/**
 * Fetch user-created categories from the database. Updates the
 * in-memory CATEGORIES array + ICON_PATHS map so every consumer
 * (editors, dropdowns, grouped-list rendering, icon getters) picks
 * up the new values at next access. Falls back silently to the
 * hardcoded list if the table is missing/empty or the query errors.
 */
async function loadCategoriesFromDB() {
  if (!NX.sb) return;
  try {
    const { data, error } = await NX.sb.from('equipment_categories')
      .select('*').eq('archived', false).order('sort_order');
    if (error) {
      // Pre-migration: table doesn't exist. Hardcoded fallback stays.
      if (!/relation.+does not exist/i.test(error.message || '')) {
        console.warn('[equipment] loadCategoriesFromDB:', error.message);
      }
      return;
    }
    if (!data || !data.length) return;  // fall back to hardcoded
    // Replace CATEGORIES + ICON_PATHS atomically. Existing equipment
    // with a category key not in the new list still renders via the
    // 'other' fallback in getCategoryIcon().
    CATEGORIES = data.map(c => ({ key: c.key, label: c.label, id: c.id }));
    const newIcons = {};
    for (const c of data) {
      if (c.icon_path) newIcons[c.key] = c.icon_path;
    }
    // Preserve any hardcoded icon paths for keys that DB row didn't override
    ICON_PATHS = Object.assign({ other: '<circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>' }, newIcons);
    console.log('[equipment] loaded', CATEGORIES.length, 'categories from DB');
  } catch (e) {
    console.warn('[equipment] loadCategoriesFromDB threw:', e);
  }
}

/**
 * Open the category management overlay. Lists current categories
 * with rename/icon-change/archive/move actions plus an Add button
 * that opens the editor sub-sheet with the icon picker.
 */
function openCategoryManager() {
  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9000';

  const renderList = () => {
    const items = CATEGORIES.slice().sort((a, b) => {
      // sort_order may not be on the in-memory objects if loaded from
      // fallback; treat undefined as 9999 so they go last.
      return (a.sort_order || 9999) - (b.sort_order || 9999);
    });
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:85vh">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Equipment categories</div>
        <div class="eq-bulk-sheet-sub">Tap a category to rename or change its icon. Add new categories like Heaters, Tables, Deck, Shades.</div>
        <div class="eq-bulk-sheet-list" style="max-height:55vh">
          ${items.map((c, i) => `
            <button class="eq-bulk-sheet-item" data-cat-key="${esc(c.key)}" type="button" style="display:flex; align-items:center; gap:12px; text-align:left">
              <div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; background:rgba(212,164,78,0.1); border-radius:8px; flex:0 0 36px">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--nx-gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[c.key] || ICON_PATHS.other}</svg>
              </div>
              <div style="flex:1; min-width:0">
                <div class="eq-bulk-sheet-item-name">${esc(c.label)}</div>
                <div class="eq-bulk-sheet-item-sub" style="opacity:0.6">${esc(c.key)}${c.id ? ' · ID ' + c.id : ' · built-in'}</div>
              </div>
              <div style="display:flex; gap:4px; flex:0 0 auto">
                ${i > 0 ? `<button type="button" data-cat-up="${esc(c.key)}" class="eq-btn eq-btn-tiny" title="Move up" style="padding:6px">↑</button>` : ''}
                ${i < items.length - 1 ? `<button type="button" data-cat-down="${esc(c.key)}" class="eq-btn eq-btn-tiny" title="Move down" style="padding:6px">↓</button>` : ''}
              </div>
            </button>
          `).join('')}
        </div>
        <button class="eq-bulk-sheet-confirm" data-action="add-cat" type="button" style="background:var(--nx-gold); color:#000">
          + Add new category
        </button>
        <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Done</button>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="add-cat"]').addEventListener('click', () => openCategoryEditor(null, renderList));
    overlay.querySelectorAll('[data-cat-key]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Ignore clicks on ↑↓ buttons
        if (e.target.closest('[data-cat-up], [data-cat-down]')) return;
        const cat = CATEGORIES.find(c => c.key === btn.dataset.catKey);
        if (cat) openCategoryEditor(cat, renderList);
      });
    });
    overlay.querySelectorAll('[data-cat-up]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveCategoryOrder(btn.dataset.catUp, -1);
        renderList();
      });
    });
    overlay.querySelectorAll('[data-cat-down]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveCategoryOrder(btn.dataset.catDown, 1);
        renderList();
      });
    });
  };

  renderList();
  document.body.appendChild(overlay);
}

/**
 * Open the editor for a single category (new or existing). Lets the
 * user set the label, pick an icon from the preset grid, or paste a
 * custom SVG path. On Save, writes to equipment_categories and
 * reloads the in-memory list.
 */
function openCategoryEditor(existing, onSaved) {
  const isNew = !existing;
  let label = existing ? existing.label : '';
  let key = existing ? existing.key : '';
  let iconPath = (existing && ICON_PATHS[existing.key]) || PRESET_ICONS[0].path;
  let customSvg = '';

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9100';  // above the manager list

  const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);

  const render = () => {
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:90vh">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">${isNew ? 'New category' : 'Edit ' + esc(existing.label)}</div>

        <div style="padding: 12px 16px 8px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Label</label>
          <input type="text" id="catLabel" value="${esc(label)}" placeholder="e.g. Heaters" maxlength="40" autocomplete="off"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:15px;">
        </div>

        <div style="padding: 4px 16px 8px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Icon — tap to pick</label>
          <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:6px;">
            ${PRESET_ICONS.map(p => `
              <button type="button" data-pick-icon="${esc(p.key)}" title="${esc(p.label)}"
                style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; background:${iconPath === p.path ? 'rgba(212,164,78,0.25)' : 'rgba(255,255,255,0.04)'}; border:1px solid ${iconPath === p.path ? 'var(--nx-gold)' : 'rgba(255,255,255,0.1)'}; border-radius:8px; cursor:pointer; padding:0">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${iconPath === p.path ? 'var(--nx-gold)' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p.path}</svg>
              </button>
            `).join('')}
          </div>
        </div>

        <details style="padding: 8px 16px;">
          <summary style="font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); cursor:pointer; padding:8px 0">Or paste custom SVG path</summary>
          <textarea id="catCustomSvg" placeholder="&lt;path d=&quot;M...&quot;/&gt;  (24×24 viewBox, inner contents only)" rows="3"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:11px; font-family: monospace;">${esc(customSvg)}</textarea>
          <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
            <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:rgba(212,164,78,0.1); border-radius:8px;">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--nx-gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" id="catCustomPreview">${iconPath}</svg>
            </div>
            <button type="button" id="catApplyCustom" class="eq-btn eq-btn-small eq-btn-secondary">Use custom SVG</button>
          </div>
        </details>

        <div style="padding: 12px 16px;">
          <button class="eq-bulk-sheet-confirm" data-action="save" type="button" style="background:var(--nx-gold); color:#000">
            ${isNew ? 'Create category' : 'Save changes'}
          </button>
          ${!isNew && existing.id ? `<button class="eq-bulk-sheet-cancel" data-action="archive" type="button" style="color:#c44; border-color:#c44">Archive this category</button>` : ''}
          <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#catLabel').addEventListener('input', (e) => { label = e.target.value; });
    overlay.querySelectorAll('[data-pick-icon]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = PRESET_ICONS.find(p => p.key === btn.dataset.pickIcon);
        if (p) { iconPath = p.path; render(); }
      });
    });
    const customTextarea = overlay.querySelector('#catCustomSvg');
    customTextarea.addEventListener('input', (e) => { customSvg = e.target.value; });
    overlay.querySelector('#catApplyCustom').addEventListener('click', () => {
      const raw = (customTextarea.value || '').trim();
      if (!raw) { NX.toast && NX.toast('Paste an SVG path first', 'warn', 1500); return; }
      // Cheap safety: strip <script> tags etc.
      if (/<script/i.test(raw) || /\bon\w+\s*=/i.test(raw)) {
        NX.toast && NX.toast('Custom SVG contains a script or event handler — refused', 'error', 3000);
        return;
      }
      iconPath = raw;
      render();
    });
    overlay.querySelector('[data-action="save"]').addEventListener('click', saveCategory);
    const archiveBtn = overlay.querySelector('[data-action="archive"]');
    if (archiveBtn) archiveBtn.addEventListener('click', archiveCategory);
  };

  const saveCategory = async () => {
    if (!label.trim()) { NX.toast && NX.toast('Label required', 'warn', 1500); return; }
    if (!NX.sb) { NX.toast && NX.toast('Database unavailable', 'error', 2000); return; }
    try {
      if (isNew) {
        // Derive key from label; if collision, append a number.
        let candidate = slugify(label);
        let n = 1;
        while (CATEGORIES.some(c => c.key === candidate)) {
          candidate = slugify(label) + '_' + (++n);
        }
        const maxSort = Math.max(0, ...CATEGORIES.map(c => c.sort_order || 0));
        const { error } = await NX.sb.from('equipment_categories').insert({
          key: candidate,
          label: label.trim(),
          icon_path: iconPath,
          sort_order: maxSort + 10,
        });
        if (error) throw error;
        NX.toast && NX.toast(`Category "${label.trim()}" added`, 'success', 1800);
      } else {
        const { error } = await NX.sb.from('equipment_categories')
          .update({ label: label.trim(), icon_path: iconPath, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
        NX.toast && NX.toast('Category updated', 'success', 1500);
      }
      await loadCategoriesFromDB();
      overlay.remove();
      if (typeof onSaved === 'function') onSaved();
      // Re-render equipment view if it's open so the new category appears
      const eqView = document.getElementById('equipmentView');
      if (eqView && eqView.children.length && typeof buildUI === 'function') buildUI();
    } catch (e) {
      console.error('[saveCategory]', e);
      NX.toast && NX.toast('Save failed: ' + (e.message || ''), 'error', 3000);
    }
  };

  const archiveCategory = async () => {
    if (!confirm(`Archive "${existing.label}"? Equipment using this category will still show but the category won't appear in dropdowns.`)) return;
    try {
      const { error } = await NX.sb.from('equipment_categories')
        .update({ archived: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
      NX.toast && NX.toast('Category archived', 'info', 1500);
      await loadCategoriesFromDB();
      overlay.remove();
      if (typeof onSaved === 'function') onSaved();
    } catch (e) {
      console.error('[archiveCategory]', e);
      NX.toast && NX.toast('Archive failed: ' + (e.message || ''), 'error', 3000);
    }
  };

  render();
  document.body.appendChild(overlay);
}

/**
 * Swap sort_order with the adjacent category in the given direction
 * (-1 = up, +1 = down). Used by the ↑↓ buttons in the manager list.
 */
async function moveCategoryOrder(key, direction) {
  if (!NX.sb) return;
  const sorted = CATEGORIES.slice().sort((a, b) => (a.sort_order || 9999) - (b.sort_order || 9999));
  const idx = sorted.findIndex(c => c.key === key);
  if (idx < 0) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  if (!a.id || !b.id) return;  // both must be DB-backed
  try {
    const aSort = a.sort_order || (idx + 1) * 10;
    const bSort = b.sort_order || (swapIdx + 1) * 10;
    await Promise.all([
      NX.sb.from('equipment_categories').update({ sort_order: bSort }).eq('id', a.id),
      NX.sb.from('equipment_categories').update({ sort_order: aSort }).eq('id', b.id),
    ]);
    await loadCategoriesFromDB();
  } catch (e) {
    console.error('[moveCategoryOrder]', e);
  }
}

/* ════════════════════════════════════════════════════════════════════
   v18.18 — Last PM date + auto-countdown progress bar.

   Equipment now stores `last_pm_date` (DATE column added by the
   migration). When `pm_interval_days` is also set, we compute:

     elapsed_days  = today - last_pm_date
     remaining_days = pm_interval_days - elapsed_days
     pct_remaining = remaining_days / pm_interval_days

   The progress bar fill width is `pct_remaining * 100%` — it
   DECREASES as time runs out (full at PM completion, empty when due).
   Color shifts from green → amber → red as the bar empties.
   ════════════════════════════════════════════════════════════════════ */

/**
 * Compute next_pm_date and countdown state from last_pm_date +
 * pm_interval_days. Returns null if either is missing.
 */
function computePmCountdown(eq) {
  if (!eq) return null;
  const interval = parseInt(eq.pm_interval_days, 10);
  if (!interval || interval <= 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // A PM bar needs a REAL maintenance anchor the user has actually engaged
  // with — a logged last PM, or a next-PM date they set. It is NEVER derived
  // from the NEXUS row-creation date or a rough install_date placeholder, so
  // units that merely carry a default cadence (no PM ever logged, no next-PM
  // scheduled) don't show a fabricated countdown. Anchor priority:
  //   1. last_pm_date  → project one interval forward (real service history)
  //   2. next_pm_date  → use it directly (a schedule the user actually set)
  // No real anchor → return null so the bar simply doesn't render. (This
  // matches detailHealthBars, which anchors on the same two fields, so the
  // list/grid and the detail card always agree on which units show a PM bar.)
  let baseStr = null;
  let projected = false;
  let nextIso = null;
  if (eq.last_pm_date) {
    baseStr = String(eq.last_pm_date).slice(0, 10);
    projected = false;
  } else if (eq.next_pm_date) {
    const n = new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00');
    if (isNaN(n)) return null;
    nextIso = n.toISOString().slice(0, 10);
    const b = new Date(n); b.setDate(b.getDate() - interval);   // derive last from the real next
    baseStr = b.toISOString().slice(0, 10);
    projected = false;
  } else {
    return null;
  }
  const last = new Date(baseStr + 'T00:00:00');
  if (isNaN(last)) return null;
  const elapsedDays  = Math.floor((today - last) / 86400000);
  const remainingDays = interval - elapsedDays;
  const pctRemaining = Math.max(0, Math.min(1, remainingDays / interval));
  if (!nextIso) {
    const next = new Date(last);
    next.setDate(next.getDate() + interval);
    nextIso = next.toISOString().slice(0, 10);
  }
  return {
    elapsedDays,
    remainingDays,
    pctRemaining,
    intervalDays: interval,
    nextDate: nextIso,
    isOverdue: remainingDays < 0,
    projected,
  };
}

// Short, friendly date for PM labels: "Jun 30".
function pmShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Render the PM countdown progress bar as inline HTML. Width
 * decreases as time runs out. Color shifts green → amber → red.
 * Returns empty string if equipment has no PM schedule configured.
 */
function renderPmProgressBar(eq, compact) {
  const cd = computePmCountdown(eq);
  if (!cd) {
    // Degraded: a unit with a last PM but no interval used to render BLANK,
    // which read as "no PM at all". Show elapsed + a nudge to set the cadence
    // (a striped bar signals "not yet tracked") instead of nothing.
    if (eq && eq.last_pm_date) {
      const _l = new Date(eq.last_pm_date + 'T00:00:00');
      if (!isNaN(_l)) {
        const _t = new Date(); _t.setHours(0, 0, 0, 0);
        const since = Math.floor((_t - _l) / 86400000);
        if (compact) {
          return `<div class="eq-pm-progress" title="${since}d since last PM — set a PM interval to enable the countdown" style="font-size:9px;color:var(--nx-faint);font-family:'JetBrains Mono',monospace">PM ${since}d ago</div>`;
        }
        return `
          <div class="eq-pm-progress" title="Set a PM interval to enable the countdown">
            <div style="display:flex; justify-content:space-between; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--nx-faint); margin-bottom:4px">
              <span>PM Health</span>
              <span style="font-family:'JetBrains Mono', monospace">${since}d since · set interval</span>
            </div>
            <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden">
              <div style="height:100%; width:100%; background:repeating-linear-gradient(45deg,rgba(212,164,78,0.22),rgba(212,164,78,0.22) 4px,transparent 4px,transparent 8px)"></div>
            </div>
          </div>
        `;
      }
    }
    return '';
  }
  const pct = Math.round(cd.pctRemaining * 100);
  let color = '#3a8d3a';  // green
  if (cd.pctRemaining < 0.1)      color = '#c44';   // red
  else if (cd.pctRemaining < 0.5) color = '#d4a44e'; // gold/amber
  const _dt = pmShortDate(cd.nextDate);
  const _proj = cd.projected ? '~' : '';   // ~ = projected (no PM logged yet)
  const label = cd.isOverdue
    ? `OVERDUE ${Math.abs(cd.remainingDays)}d · was ${_proj}${_dt}`
    : `Next PM ${_proj}${_dt} · ${cd.remainingDays}d`;
  if (compact) {
    return `
      <div class="eq-pm-progress" title="${esc(label)}" style="display:flex; align-items:center; gap:6px; font-size:10px;">
        <div style="flex:1; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden; min-width:40px">
          <div style="height:100%; width:${pct}%; background:${color}; transition:width .3s ease"></div>
        </div>
        <span style="color:${color}; font-family:'JetBrains Mono', monospace; font-size:9px; white-space:nowrap">${cd.isOverdue ? 'OVERDUE' : cd.remainingDays + 'd'}</span>
      </div>
    `;
  }
  return `
    <div class="eq-pm-progress" title="${esc(label)} (next PM ${cd.nextDate})">
      <div style="display:flex; justify-content:space-between; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--nx-faint); margin-bottom:4px">
        <span>PM Health</span>
        <span style="color:${color}; font-family:'JetBrains Mono', monospace">${label}</span>
      </div>
      <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden">
        <div style="height:100%; width:${pct}%; background:${color}; transition:width .3s ease"></div>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════════════
   v18.30 — Multi-cadence health bars (PM · Inspection · Deep clean)

   Generalizes the PM countdown to three independent maintenance
   cadences. Each bar is conditional on having BOTH an interval and a
   last-done date (computeCadenceCountdown returns null otherwise), so
   units without inspection/deep-clean data render EXACTLY as before —
   this is additive and safe to ship ahead of the DB columns. Which
   bars appear is a per-device preference set from the toolbar chooser.
   ════════════════════════════════════════════════════════════════════ */

// Generic cadence countdown — same shape as computePmCountdown but for any
// {last_*_date} + {*_interval_days} pair. No install/created projection
// here (inspection/deep-clean have no natural baseline), so it needs a
// real last-done date. Returns null when not trackable → caller skips it.
function computeCadenceCountdown(eq, lastField, intervalField) {
  if (!eq) return null;
  const interval = parseInt(eq[intervalField], 10);
  if (!interval || interval <= 0) return null;
  const baseStr = eq[lastField];
  if (!baseStr) return null;
  const last = new Date(baseStr + 'T00:00:00');
  if (isNaN(last)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.floor((today - last) / 86400000);
  const remainingDays = interval - elapsedDays;
  const pctRemaining = Math.max(0, Math.min(1, remainingDays / interval));
  const next = new Date(last);
  next.setDate(next.getDate() + interval);
  return {
    elapsedDays, remainingDays, pctRemaining,
    intervalDays: interval,
    nextDate: next.toISOString().slice(0, 10),
    isOverdue: remainingDays < 0,
    projected: false,
  };
}

// Which health bars to show — per-device preference (localStorage).
const EQ_HEALTH_BARS_KEY = 'nexus_eq_health_bars';
const eqHealthBars = { pm: true, inspection: true, deep_clean: true };
(function loadEqHealthBars() {
  try {
    const s = localStorage.getItem(EQ_HEALTH_BARS_KEY);
    if (s) Object.assign(eqHealthBars, JSON.parse(s));
  } catch (_) {}
})();
function saveEqHealthBars() {
  try { localStorage.setItem(EQ_HEALTH_BARS_KEY, JSON.stringify(eqHealthBars)); } catch (_) {}
}
function toggleEqHealthBar(key) {
  if (!(key in eqHealthBars)) return;
  eqHealthBars[key] = !eqHealthBars[key];
  saveEqHealthBars();
  renderList();
}

// The three tracked cadences. PM keeps its projected-baseline countdown
// (computePmCountdown); the other two use the generic helper.
function _eqCadenceCountdowns(eq) {
  return [
    { key: 'pm',         label: 'PM',    cd: computePmCountdown(eq) },
    { key: 'inspection', label: 'INSP',  cd: computeCadenceCountdown(eq, 'last_inspection_date', 'inspection_interval_days') },
    { key: 'deep_clean', label: 'CLEAN', cd: computeCadenceCountdown(eq, 'last_deep_clean_date', 'deep_clean_interval_days') },
  ];
}

// Stacked health bars for a unit, honoring the chooser. `compact` = list
// row (tiny). Full = grid card (also shows the next-due date). Renders
// nothing when no chosen cadence is trackable → callers fall back.
function renderHealthBars(eq, compact) {
  const rows = [];
  for (const c of _eqCadenceCountdowns(eq)) {
    if (!eqHealthBars[c.key] || !c.cd) continue;
    const cd = c.cd;
    const pct = Math.round(cd.pctRemaining * 100);
    let color = '#3fa08f';                              // verdigris (healthy)
    if (cd.pctRemaining < 0.1)      color = '#d24b4b';  // oxblood (overdue/critical)
    else if (cd.pctRemaining < 0.5) color = '#d4a44e';  // gold (due soon)
    const dt = pmShortDate(cd.nextDate);
    const proj = cd.projected ? '~' : '';
    const cdShort = cd.isOverdue ? 'OVER' : cd.remainingDays + 'd';
    const title = cd.isOverdue
      ? `${c.label} overdue ${Math.abs(cd.remainingDays)}d (was ${proj}${dt})`
      : `${c.label} next ${proj}${dt} · ${cd.remainingDays}d`;
    const cdText = compact ? cdShort : `${proj}${dt} · ${cdShort}`;
    rows.push(
      `<div class="eq-hb-row${compact ? '' : ' eq-hb-row-full'}" title="${esc(title)}">` +
        `<span class="eq-hb-lab">${c.label}</span>` +
        `<div class="eq-hb-track"><div class="eq-hb-fill" style="width:${pct}%;background:${color}"></div></div>` +
        `<span class="eq-hb-cd" style="color:${color}">${cdText}</span>` +
      `</div>`
    );
  }
  if (!rows.length) return '';
  return `<div class="eq-health-bars">${rows.join('')}</div>`;
}

// The toolbar chooser — three pills toggling which bars show.
function renderHealthBarChooser() {
  const opts = [
    { key: 'pm',         label: 'PM' },
    { key: 'inspection', label: 'Inspection' },
    { key: 'deep_clean', label: 'Deep clean' },
  ];
  return `<div class="eq-hb-chooser" id="eqHbChooser">` +
    opts.map(o => `<button class="eq-hb-toggle ${eqHealthBars[o.key] ? 'on' : ''}" data-hb="${o.key}">${o.label}</button>`).join('') +
    `</div>`;
}

// Warranty shield — a FILLED navy shield (with a check) when the unit is in
// warranty, or a bare OUTLINE shield when it's out of warranty / none on
// file. The hover/long-press tooltip carries the end date. Driven by
// equipment.warranty_until. Navy is NEXUS's cool complement to the gold.
function warrantyShield(e) {
  const until = e && e.warranty_until;
  let active = false, label = 'No warranty on file';
  if (until) {
    const d = new Date(String(until).slice(0, 10) + 'T00:00:00');
    if (!isNaN(d)) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      active = d >= today;
      const ds = d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      label = active ? `Under warranty until ${ds}` : `Warranty expired ${ds}`;
    }
  }
  const svg = active
    ? `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 2.2l7 2.8v6c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9v-6l7-2.8z" fill="currentColor"/><path d="M8.8 12.1l2.1 2.1 4.3-4.5" fill="none" stroke="#0e1320" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 2.2l7 2.8v6c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9v-6l7-2.8z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  return `<span class="eq-warranty${active ? ' is-active' : ''}" title="${esc(label)}" role="img" aria-label="${esc(label)}">${svg}</span>`;
}

/* ════════════════════════════════════════════════════════════════════
   v18.19 — PM logger with expected-vs-actual date tracking.

   When the user taps "Log PM" on an equipment, openPmLogger opens a
   focused sheet capturing:
     - Expected date (pre-filled from equipment.next_pm_date)
     - Actual date (defaults to today)
     - Live variance display (on time / N days late / N days early)
     - Performed by, cost, notes
     - Invoice file upload (optional)

   On save:
     1. Upload invoice to equipment-attachments storage (if provided)
     2. Insert equipment_attachments row → get attachment_id
     3. Insert equipment_maintenance row with:
          event_type='pm', event_date=actual, expected_pm_date,
          cost, performed_by, description, invoice_attachment_id
     4. Update equipment row:
          last_pm_date = actual, next_pm_date = actual + interval
     5. Refresh open detail view

   The progress bar restarts at 100% the moment the equipment row
   updates — because it computes from last_pm_date.
   ════════════════════════════════════════════════════════════════════ */

function openPmLogger(equipId) {
  const eq = (typeof equipment !== 'undefined' && equipment)
    ? equipment.find(e => String(e.id) === String(equipId))
    : null;
  if (!eq) {
    NX.toast && NX.toast('Equipment not found', 'error', 1800);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let expected = eq.next_pm_date || '';
  let actual   = today;
  let performedBy = '';
  let cost = '';
  let notes = '';
  let invoiceFile = null;

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9200';

  const computeVariance = () => {
    if (!expected || !actual) return null;
    const exp = new Date(expected + 'T00:00:00');
    const act = new Date(actual + 'T00:00:00');
    if (isNaN(exp) || isNaN(act)) return null;
    const diffDays = Math.round((act - exp) / 86400000);
    return diffDays;
  };

  const varianceLabel = () => {
    const d = computeVariance();
    if (d === null) return '';
    if (d === 0)   return `<span style="color:#3a8d3a">● On time</span>`;
    if (d > 0)     return `<span style="color:#c44">● ${d} day${d===1?'':'s'} late</span>`;
    return            `<span style="color:#d4a44e">● ${Math.abs(d)} day${d===-1?'':'s'} early</span>`;
  };

  const render = () => {
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:92vh; overflow-y:auto">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Log PM — ${esc(eq.name)}</div>
        <div class="eq-bulk-sheet-sub">Health countdown restarts from the ACTUAL date you performed the PM.</div>

        <div style="padding: 12px 16px 8px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
            <div>
              <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Expected</label>
              <input type="date" id="pmExpected" value="${esc(expected)}"
                style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:14px;">
              <div style="font-size:10px; color:var(--nx-faint); margin-top:4px">When it was scheduled</div>
            </div>
            <div>
              <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-gold); margin-bottom:6px">Actual *</label>
              <input type="date" id="pmActual" value="${esc(actual)}" required
                style="width:100%; padding:10px 12px; background:rgba(212,164,78,0.08); border:1px solid var(--nx-gold); border-radius:8px; color:var(--nx-text); font-size:14px;">
              <div style="font-size:10px; color:var(--nx-faint); margin-top:4px">When it was performed</div>
            </div>
          </div>
          <div style="margin-top:8px; font-size:12px; text-align:center; padding:6px; background:rgba(255,255,255,0.03); border-radius:6px">
            ${varianceLabel() || '<span style="color:var(--nx-faint)">Set both dates to see variance</span>'}
          </div>
        </div>

        <div style="padding: 4px 16px; position:relative;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-gold); margin-bottom:6px">Performed by * <span style="text-transform:none; letter-spacing:0; color:var(--nx-faint)">— your vendors</span></label>
          <input type="text" id="pmPerformedBy" value="${esc(performedBy)}" placeholder="Search your vendors…" autocomplete="off"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:14px;">
          <div id="pmVendorMenu" style="display:none; position:absolute; left:16px; right:16px; top:100%; margin-top:2px; z-index:60; max-height:240px; overflow-y:auto; background:var(--nx-surface-1,#161a24); border:1px solid rgba(255,255,255,0.14); border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,0.55);"></div>
          <div id="pmVendorHint" style="font-size:10px; margin-top:5px; min-height:12px;"></div>
        </div>

        <div style="padding: 8px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Cost ($)</label>
          <input type="number" id="pmCost" value="${esc(cost)}" step="0.01" placeholder="0.00"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:14px;">
        </div>

        <div style="padding: 8px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Notes</label>
          <textarea id="pmNotes" rows="3" placeholder="Replaced filters, cleaned condenser coils, calibrated thermostat..."
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:13px;">${esc(notes)}</textarea>
        </div>

        <div style="padding: 8px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Invoice (optional)</label>
          <div style="display:flex; gap:8px; align-items:center">
            <button type="button" id="pmInvoiceBtn" class="eq-btn eq-btn-small eq-btn-secondary" style="flex:0 0 auto">
              ${uiSvg('document', '13px')} ${invoiceFile ? 'Change file' : 'Attach invoice'}
            </button>
            <span style="font-size:12px; color:${invoiceFile ? 'var(--nx-gold)' : 'var(--nx-faint)'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${invoiceFile ? esc(invoiceFile.name) : 'No file selected'}</span>
            <input type="file" id="pmInvoiceFile" accept="image/*,application/pdf" hidden>
          </div>
        </div>

        <div style="padding: 12px 16px;">
          <button class="eq-bulk-sheet-confirm" data-action="save" type="button" style="background:var(--nx-gold); color:#000">
            Log PM & restart countdown
          </button>
          <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>
    `;

    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#pmExpected').addEventListener('change', (e) => { expected = e.target.value; render(); });
    overlay.querySelector('#pmActual').addEventListener('change', (e) => { actual = e.target.value; render(); });
    // Performed-by is a VENDOR picker: search the vendors you've made, or create
    // a new one inline. The chosen name is written to equipment_maintenance
    // .performed_by, which is what feeds the vendor's history (vendors.js).
    (function setupVendorPicker() {
      const input = overlay.querySelector('#pmPerformedBy');
      const menu  = overlay.querySelector('#pmVendorMenu');
      const hint  = overlay.querySelector('#pmVendorHint');
      if (!input || !menu) return;
      let vendorCache = null;
      const all = () => {
        if (vendorCache && vendorCache.length) return vendorCache;
        try { return (window.NXVendors && window.NXVendors.getAll && window.NXVendors.getAll()) || []; } catch (_) { return []; }
      };
      // The NXVendors in-memory cache is only warm once the Vendors page has
      // loaded — opening Log PM directly leaves it empty, so the picker showed
      // no vendors. Warm it ourselves (refresh the module, else read the table).
      async function ensureVendors() {
        if (all().length) return;
        try { if (window.NXVendors && NXVendors.refresh) await NXVendors.refresh(); } catch (_) {}
        if (!all().length && NX.sb) {
          try {
            const { data } = await NX.sb.from('vendors')
              .select('id, company, name, category, is_preferred, active')
              .eq('active', true).order('company');
            vendorCache = data || [];
          } catch (_) {}
        }
        if (document.activeElement === input || menu.style.display === 'block') open();
      }
      const vname = (v) => ((v && (v.company || v.name)) || '').trim();
      const matchVendor = (n) => all().find(v => vname(v).toLowerCase() === String(n || '').toLowerCase().trim());
      const setHint = () => {
        if (!performedBy) { hint.innerHTML = '<span style="color:var(--nx-faint)">Pick a vendor so this PM lands in their history.</span>'; return; }
        hint.innerHTML = matchVendor(performedBy)
          ? '<span style="color:#7bd88f">● Linked to vendor — shows in their history</span>'
          : '<span style="color:#d4a44e">● New vendor — will be created on save</span>';
      };
      const close = () => { menu.style.display = 'none'; };
      const open = () => {
        const list = all();
        const q = (input.value || '').toLowerCase().trim();
        const hits = list.filter(v => vname(v).toLowerCase().includes(q)).slice(0, 40);
        let html = '';
        hits.forEach(v => {
          const cat = v.category ? ' · ' + esc(v.category) : '';
          html += '<div class="pm-vendor-opt" data-name="' + esc(vname(v)) + '" style="padding:11px 14px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); font-size:14px; color:var(--nx-text)">' + esc(vname(v)) + '<span style="color:var(--nx-faint); font-size:11px">' + cat + '</span></div>';
        });
        const typed = (input.value || '').trim();
        if (typed && !matchVendor(typed)) {
          html += '<div class="pm-vendor-create" data-name="' + esc(typed) + '" style="padding:11px 14px; cursor:pointer; color:var(--nx-gold); font-size:14px; font-weight:600">＋ Create vendor &ldquo;' + esc(typed) + '&rdquo;</div>';
        }
        if (!html) html = '<div style="padding:12px 14px; color:var(--nx-faint); font-size:12px">' + (list.length ? 'No matches.' : 'No vendors yet — type a name to create one.') + '</div>';
        menu.innerHTML = html;
        menu.style.display = 'block';
      };
      input.addEventListener('focus', open);
      input.addEventListener('input', () => { performedBy = input.value.trim(); setHint(); open(); });
      menu.addEventListener('click', async (e) => {
        const opt = e.target.closest('.pm-vendor-opt');
        const cre = e.target.closest('.pm-vendor-create');
        if (opt) { performedBy = opt.getAttribute('data-name'); input.value = performedBy; close(); setHint(); return; }
        if (cre) {
          const nm = (cre.getAttribute('data-name') || '').trim(); if (!nm) return;
          cre.textContent = 'Creating…';
          try {
            if (window.NX && NX.sb) {
              await NX.sb.from('vendors').insert({ company: nm, active: true });
              if (window.NXVendors && window.NXVendors.refresh) { try { await window.NXVendors.refresh(); } catch (_) {} }
              vendorCache = null;   // force re-read so the new vendor is in the list
            }
            performedBy = nm; input.value = nm; close(); setHint();
            NX.toast && NX.toast('Vendor “' + nm + '” created', 'success', 1800);
          } catch (_) { NX.toast && NX.toast('Could not create vendor', 'warn', 2000); }
          return;
        }
      });
      overlay.addEventListener('click', (e) => { if (!e.target.closest('#pmVendorMenu') && e.target !== input) close(); });
      setHint();
      ensureVendors();   // warm the vendor list even if the Vendors page hasn't been opened
    })();
    overlay.querySelector('#pmCost').addEventListener('input', (e) => { cost = e.target.value; });
    overlay.querySelector('#pmNotes').addEventListener('input', (e) => { notes = e.target.value; });

    const fileInput = overlay.querySelector('#pmInvoiceFile');
    overlay.querySelector('#pmInvoiceBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      invoiceFile = e.target.files && e.target.files[0] || null;
      render();
    });

    overlay.querySelector('[data-action="save"]').addEventListener('click', save);
  };

  const save = async () => {
    if (!actual) { NX.toast && NX.toast('Actual date is required', 'warn', 1500); return; }
    if (!(performedBy || '').trim()) {
      NX.toast && NX.toast('Pick a vendor (or create one) for "Performed by"', 'warn', 2200);
      const pb = overlay.querySelector('#pmPerformedBy');
      if (pb) { pb.focus(); pb.style.borderColor = 'var(--nx-gold)'; }
      return;
    }
    if (!NX.sb) { NX.toast && NX.toast('Database unavailable', 'error', 2000); return; }

    const saveBtn = overlay.querySelector('[data-action="save"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      // Step 1: Upload invoice (if provided) and create attachment row
      let invoiceAttachmentId = null;
      if (invoiceFile) {
        const safeName = invoiceFile.name.replace(/[^a-z0-9.]/gi, '_');
        const path = `${equipId}/pm-${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('equipment-attachments')
          .upload(path, invoiceFile, { upsert: false, contentType: invoiceFile.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = NX.sb.storage.from('equipment-attachments').getPublicUrl(path);
        const { data: attRow, error: attErr } = await NX.sb.from('equipment_attachments').insert({
          equipment_id: equipId,
          type: 'invoice',
          title: `PM invoice — ${actual}`,
          file_url: publicUrl,
          mime_type: invoiceFile.type,
          file_size: invoiceFile.size,
          uploaded_by: NX.currentUser?.name || 'user',
        }).select('id').single();
        if (attErr) throw attErr;
        invoiceAttachmentId = attRow.id;
      }

      // Ensure the performer is one of your vendors so this PM feeds their
      // history (vendors.js matches equipment_maintenance.performed_by by name).
      const perfName = (performedBy || '').trim();
      if (perfName && NX.sb) {
        try {
          let known = [];
          try { known = (window.NXVendors && window.NXVendors.getAll && window.NXVendors.getAll()) || []; } catch (_) {}
          const has = known.some(v => ((v.company || v.name) || '').toLowerCase().trim() === perfName.toLowerCase());
          if (!has) {
            await NX.sb.from('vendors').insert({ company: perfName, active: true });
            if (window.NXVendors && window.NXVendors.refresh) { try { await window.NXVendors.refresh(); } catch (_) {} }
          }
        } catch (_) { /* non-fatal — the PM still logs with the name */ }
      }

      // Step 2: Insert maintenance row
      const maintRow = {
        equipment_id: equipId,
        event_type: 'pm',
        event_date: actual,
        expected_pm_date: expected || null,
        description: notes || 'PM performed',
        performed_by: perfName || null,
        cost: cost ? parseFloat(cost) : null,
      };
      if (invoiceAttachmentId) maintRow.invoice_attachment_id = invoiceAttachmentId;

      const { error: maintErr } = await NX.sb.from('equipment_maintenance').insert(maintRow);
      if (maintErr) {
        // If invoice_attachment_id column doesn't exist yet, retry
        // without it so the migration order doesn't block PM logging.
        if (/column.+invoice_attachment_id.+does not exist/i.test(maintErr.message || '')) {
          delete maintRow.invoice_attachment_id;
          const retry = await NX.sb.from('equipment_maintenance').insert(maintRow);
          if (retry.error) throw retry.error;
        } else if (/column.+expected_pm_date.+does not exist/i.test(maintErr.message || '')) {
          delete maintRow.expected_pm_date;
          const retry = await NX.sb.from('equipment_maintenance').insert(maintRow);
          if (retry.error) throw retry.error;
        } else {
          throw maintErr;
        }
      }

      // Step 3: Advance the PM cadence via the shared helper (js/pm-core.js)
      // — refreshes last_pm_date + next_pm_date, completes the unit's
      // scheduled PM row, and recomputes health. One implementation shared
      // with the QR self-approve and PM-schedule loggers, so the health bar
      // restarts identically everywhere. `actual` is the user-picked date.
      if (NX.pm && NX.pm.advance) {
        await NX.pm.advance(equipId, { serviceDate: actual, isPm: true });
      }

      NX.toast && NX.toast('PM logged ✓ Countdown restarted', 'success', 2200);
      overlay.remove();

      // Refresh equipment list + reopen detail
      if (typeof loadEquipment === 'function') {
        try { await loadEquipment(); } catch (_) {}
      }
      if (typeof openDetail === 'function') openDetail(equipId);

    } catch (err) {
      console.error('[openPmLogger] save failed:', err);
      NX.toast && NX.toast('Save failed: ' + (err.message || ''), 'error', 4000);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Log PM & restart countdown'; }
    }
  };

  render();
  document.body.appendChild(overlay);
}

/* ════════════════════════════════════════════════════════════════════
   v18.20 — Inline tap-to-edit for detail card fields.

   openFieldEditor(equipId, fieldKey, label, currentValue, inputType, opts)
   opens a focused single-field bottom sheet. Date/number/text inputs
   styled to match the rest of the bottom-sheet family. On save:
     1. UPDATE equipment SET <fieldKey> = <value> WHERE id = <equipId>
     2. If opts.cascade is set and the field is last_pm_date, also
        recompute next_pm_date = last_pm_date + pm_interval_days.
     3. Special handling: category type opens a select-style picker
        sourced from the live CATEGORIES list.
     4. Reload equipment + reopen detail so the new value shows.
   ════════════════════════════════════════════════════════════════════ */

function openFieldEditor(equipId, fieldKey, label, currentValue, inputType, opts) {
  opts = opts || {};
  const eq = (typeof equipment !== 'undefined' && equipment)
    ? equipment.find(e => String(e.id) === String(equipId))
    : null;
  if (!eq) return;

  // Normalize current value for input population.
  let displayVal = currentValue;
  if (currentValue == null) displayVal = '';
  // Date inputs expect YYYY-MM-DD. If we got a full ISO, slice it.
  if (inputType === 'date' && typeof displayVal === 'string' && displayVal.length > 10) {
    displayVal = displayVal.slice(0, 10);
  }

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9300';

  let valueBuf = displayVal;

  const renderInput = () => {
    if (inputType === 'category') {
      // Select-style picker from dynamic CATEGORIES list.
      return `
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; max-height:50vh; overflow-y:auto">
          ${CATEGORIES.map(c => {
            const isActive = String(c.key) === String(valueBuf);
            return `
              <button type="button" data-cat-pick="${esc(c.key)}"
                style="display:flex; align-items:center; gap:8px; padding:10px 12px; background:${isActive ? 'rgba(212,164,78,0.2)' : 'rgba(255,255,255,0.04)'}; border:1px solid ${isActive ? 'var(--nx-gold)' : 'rgba(255,255,255,0.1)'}; border-radius:8px; color:var(--nx-text); cursor:pointer; text-align:left">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${isActive ? 'var(--nx-gold)' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[c.key] || ICON_PATHS.other}</svg>
                <span style="font-size:13px">${esc(c.label || c.key)}</span>
              </button>
            `;
          }).join('')}
        </div>
      `;
    }
    if (inputType === 'number') {
      const minAttr = opts.min != null ? ` min="${opts.min}"` : '';
      const maxAttr = opts.max != null ? ` max="${opts.max}"` : '';
      const stepAttr = (fieldKey === 'purchase_price') ? ' step="0.01"' : '';
      return `<input type="number" id="fldInput" value="${esc(valueBuf)}"${minAttr}${maxAttr}${stepAttr} autocomplete="off"
        style="width:100%; padding:12px 14px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:18px; font-family:'JetBrains Mono', monospace;">`;
    }
    if (inputType === 'date') {
      return `<input type="date" id="fldInput" value="${esc(valueBuf)}"
        style="width:100%; padding:12px 14px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:16px;">`;
    }
    // text fallback
    return `<input type="text" id="fldInput" value="${esc(valueBuf)}" autocomplete="off"
      style="width:100%; padding:12px 14px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:16px;">`;
  };

  const render = () => {
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:80vh">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">${esc(label)}</div>
        <div class="eq-bulk-sheet-sub">${esc(eq.name)}${opts.cascade ? ` · saving will recompute ${esc(opts.cascade)}` : ''}</div>

        <div style="padding: 16px;">
          ${renderInput()}
        </div>

        <div style="padding: 0 16px 16px;">
          <button class="eq-bulk-sheet-confirm" data-action="save" type="button" style="background:var(--nx-gold); color:#000">
            Save
          </button>
          ${currentValue != null && currentValue !== '' && inputType !== 'category' ? `
            <button class="eq-bulk-sheet-cancel" data-action="clear" type="button" style="color:#c44; border-color:#c44">Clear value</button>
          ` : ''}
          <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="save"]').addEventListener('click', () => save(valueBuf));
    const clearBtn = overlay.querySelector('[data-action="clear"]');
    if (clearBtn) clearBtn.addEventListener('click', () => save(null));

    if (inputType === 'category') {
      overlay.querySelectorAll('[data-cat-pick]').forEach(btn => {
        btn.addEventListener('click', () => {
          valueBuf = btn.dataset.catPick;
          render();
        });
      });
    } else {
      const input = overlay.querySelector('#fldInput');
      if (input) {
        input.addEventListener('input', (e) => { valueBuf = e.target.value; });
        // Focus + select on open so the user can just start typing.
        setTimeout(() => {
          input.focus();
          if (input.type !== 'date') try { input.select(); } catch (_) {}
        }, 50);
      }
    }
  };

  const save = async (rawValue) => {
    if (!NX.sb) { NX.toast && NX.toast('Database unavailable', 'error', 2000); return; }

    // Normalize value by type
    let value = rawValue;
    if (value === '' || value === undefined) value = null;
    if (inputType === 'number' && value != null) {
      const n = parseFloat(value);
      if (isNaN(n)) {
        NX.toast && NX.toast('Invalid number', 'warn', 1500);
        return;
      }
      if (opts.min != null && n < opts.min) { NX.toast && NX.toast(`Minimum is ${opts.min}`, 'warn', 1500); return; }
      if (opts.max != null && n > opts.max) { NX.toast && NX.toast(`Maximum is ${opts.max}`, 'warn', 1500); return; }
      value = n;
    }

    const update = { [fieldKey]: value };

    // Cascade: when last_pm_date changes, recompute next_pm_date.
    if (opts.cascade === 'next_pm_date' && value && eq.pm_interval_days) {
      const interval = parseInt(eq.pm_interval_days, 10);
      if (interval > 0) {
        const last = new Date(value + 'T00:00:00');
        if (!isNaN(last)) {
          const next = new Date(last);
          next.setDate(next.getDate() + interval);
          update.next_pm_date = next.toISOString().slice(0, 10);
        }
      }
    }
    // If pm_interval_days changed and we have last_pm_date, also recompute.
    if (fieldKey === 'pm_interval_days' && value && eq.last_pm_date) {
      const interval = parseInt(value, 10);
      if (interval > 0) {
        const last = new Date(eq.last_pm_date + 'T00:00:00');
        if (!isNaN(last)) {
          const next = new Date(last);
          next.setDate(next.getDate() + interval);
          update.next_pm_date = next.toISOString().slice(0, 10);
        }
      }
    }

    try {
      const { error } = await NX.sb.from('equipment').update(update).eq('id', equipId);
      if (error) {
        // Common case: column doesn't exist yet (pre-migration). Tell
        // the user explicitly rather than a generic "save failed".
        if (/column.+does not exist/i.test(error.message || '')) {
          NX.toast && NX.toast(`${label} column not in DB — run latest migration`, 'warn', 4000);
        } else {
          throw error;
        }
        return;
      }
      NX.toast && NX.toast(`${label} updated`, 'success', 1500);
      overlay.remove();
      if (typeof loadEquipment === 'function') {
        try { await loadEquipment(); } catch (_) {}
      }
      if (typeof openDetail === 'function') openDetail(equipId);
      // Alfredo's rule: inspection tracking never exists without a vendor
      // from the pool. Setting either inspection cadence field on a unit
      // with no inspection vendor forces the picker; dismissing the picker
      // reverts THIS edit, so half-created inspections can't exist.
      const needsInspVendor =
        (fieldKey === 'last_inspection_date' || fieldKey === 'inspection_interval_days')
        && value != null && !eq.inspection_vendor_id;
      if (needsInspVendor && typeof openInspectionVendorPicker === 'function') {
        const prev = (currentValue === '' || currentValue === undefined) ? null : currentValue;
        NX.toast && NX.toast('Who does this inspection? Pick from your vendors', 'info', 2600);
        openInspectionVendorPicker(equipId, {
          required: true,
          onDismiss: async () => {
            try { await NX.sb.from('equipment').update({ [fieldKey]: prev }).eq('id', equipId); } catch (_) {}
            NX.toast && NX.toast(`${label} not saved — every inspection needs a vendor`, 'warn', 3400);
            if (typeof loadEquipment === 'function') { try { await loadEquipment(); } catch (_) {} }
            if (typeof openDetail === 'function') openDetail(equipId);
          },
        });
      }
    } catch (e) {
      console.error('[openFieldEditor] save failed:', e);
      NX.toast && NX.toast('Save failed: ' + (e.message || ''), 'error', 3000);
    }
  };

  render();
  document.body.appendChild(overlay);
}

/* Inject the .is-editable hover/tap styles once. */
(function injectFieldEditStyles() {
  if (typeof document === 'undefined' || document.getElementById('eq-field-edit-styles')) return;
  const s = document.createElement('style');
  s.id = 'eq-field-edit-styles';
  s.textContent = `
    .eq-detail-card-field.is-editable {
      cursor: pointer;
      transition: background 0.15s ease;
      border-radius: 6px;
      margin: -2px;
      padding: 2px;
    }
    .eq-detail-card-field.is-editable:hover,
    .eq-detail-card-field.is-editable:focus {
      background: rgba(212, 164, 78, 0.08);
      outline: none;
    }
    .eq-detail-card-field.is-editable:active {
      background: rgba(212, 164, 78, 0.15);
    }
  `;
  document.head.appendChild(s);
})();

/* ════════════════════════════════════════════════════════════════════
   v18.22 — Locations as vendor-style cards.

   Replaces the 3-pill location switcher with a scrollable card list
   modeled on ordering's vendor rows. Top-level Equipment view now
   lands on the location card list; tap a card to drill into that
   location's equipment, back arrow returns. Includes universal
   search (equipment + parts) and configurable sort.

   ┌──────────────────────────────────────────────┐
   │  EQUIPMENT                                    │
   │  [🔍 Search equipment, parts...        ]      │
   │  [+ Add Location]   Sort: Attention needed ▼  │
   │                                                │
   │  ┌────────────────────────────────────────┐   │
   │  │ ◯  Suerte                  14 units    │ › │
   │  │    1808 E 6th St           ●3 overdue ⋮│   │
   │  ├────────────────────────────────────────┤   │
   │  │ ◯  Este                    22 units    │ › │
   │  │    2113 Manor Rd           ●All clear ⋮│   │
   │  └────────────────────────────────────────┘   │
   └──────────────────────────────────────────────┘
   ════════════════════════════════════════════════════════════════════ */

async function loadLocationsFromDB() {
  if (!NX.sb) return;
  try {
    const { data, error } = await NX.sb.from('locations')
      .select('*').eq('archived', false).order('sort_order');
    if (error) {
      if (!/relation.+does not exist/i.test(error.message || '')) {
        console.warn('[equipment] loadLocationsFromDB:', error.message);
      }
      return;
    }
    if (!data || !data.length) return;
    LOCATION_META = data;
    LOCATIONS = data.map(l => l.label);
    console.log('[equipment] loaded', LOCATIONS.length, 'locations from DB');
  } catch (e) {
    console.warn('[equipment] loadLocationsFromDB threw:', e);
  }
}

/* Compute per-location dashboard stats. Reads from the global
   `equipment` array (already loaded). Returns counts the location
   card needs to surface attention level + scale. */
function computeLocationStats(label) {
  const eqs = (typeof equipment !== 'undefined' && equipment)
    ? equipment.filter(e => e.location === label && !e.archived_at && !e.archived)
    : [];
  const total = eqs.length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const in14d = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  let overdue = 0, dueSoon = 0, missedScheduled = 0;
  for (const e of eqs) {
    if (e.next_pm_date) {
      if (e.next_pm_date < todayIso) overdue++;
      else if (e.next_pm_date <= in14d) dueSoon++;
    }
    // v18.23 — Count missed scheduled PMs (a scheduled phase whose
    // date has passed without completion). Treated as MORE urgent than
    // an auto-due overdue because it's an explicit broken commitment.
    if (typeof hasMissedScheduledPm === 'function' && hasMissedScheduledPm(e.id)) {
      missedScheduled++;
    }
  }
  const issues = eqs.filter(e => e.status && e.status !== 'operational').length;
  const healthAvg = total > 0
    ? Math.round(eqs.reduce((s, e) => s + (e.health_score ?? 100), 0) / total)
    : 100;
  return { total, overdue, dueSoon, issues, healthAvg, missedScheduled };
}

/* Deterministic 0-360 hue from a string — for avatar fallback when
   no photo uploaded. Same pattern ordering vendors use. */
function hashLocationHue(s) {
  let h = 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/* Sort location metadata according to the selected sort mode. The
   `attention` mode weights overdue PMs heavily, then non-operational
   units, then due-soon PMs — locations needing the most action float
   to the top. */
function sortLocationsByMode(meta, mode) {
  const arr = meta.slice();
  const score = (loc) => {
    const s = computeLocationStats(loc.label);
    // v18.23 — Missed scheduled PMs weight even higher than overdue
    // auto-due dates. A missed commitment is more urgent than a
    // theoretical due date.
    return s.missedScheduled * 500 + s.overdue * 100 + s.issues * 50 + s.dueSoon * 10;
  };
  if (mode === 'attention') {
    arr.sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
  } else if (mode === 'count') {
    arr.sort((a, b) => computeLocationStats(b.label).total - computeLocationStats(a.label).total);
  } else if (mode === 'pm') {
    arr.sort((a, b) => {
      const sa = computeLocationStats(a.label);
      const sb = computeLocationStats(b.label);
      return (sb.overdue + sb.dueSoon) - (sa.overdue + sa.dueSoon);
    });
  } else if (mode === 'recent') {
    arr.sort((a, b) => (b.last_opened_at || '').localeCompare(a.last_opened_at || ''));
  } else if (mode === 'name') {
    arr.sort((a, b) => a.label.localeCompare(b.label));
  } else { // custom
    arr.sort((a, b) => (a.sort_order || 9999) - (b.sort_order || 9999));
  }
  return arr;
}

/* Render the avatar element matching the ordering vendor pattern
   exactly. Uses .ord-vendor-avatar / .ord-vendor-avatar-img classes
   so the styling is shared — 72px circle, hue-driven background for
   initials, contain+center for photos. */
function locationAvatarHTML(loc, size) {
  size = size || 'md';
  const hue = (loc.avatar_hue != null) ? loc.avatar_hue : hashLocationHue(loc.label);
  const initials = (loc.label || '?').trim().charAt(0).toUpperCase();
  if (loc.photo_url) {
    // Image avatar — uses background-image style like ordering's vendorAvatar
    return `<span class="ord-vendor-avatar ord-vendor-avatar-img" style="background-image:url('${esc((loc.photo_url || '').replace(/'/g, '%27'))}');" role="img" aria-label="${esc(loc.label)}"></span>`;
  }
  return `<span class="ord-vendor-avatar" style="--avatar-hue:${hue};" aria-hidden="true">${esc(initials)}</span>`;
}

/* Render one location card using the EXACT vendor row class structure.
   Reuses .ord-vendor-row-wrap, .ord-vendor-row, .ord-vendor-main,
   .ord-vendor-pill, .ord-vendor-warn, .ord-arrow, .ord-vendor-menu —
   inherits all the vendor styling (88px min-height, 72px avatar, 18px
   border-radius, gold-line border, has-issue/has-draft accent bars). */
function renderLocationCard(loc) {
  const stats = computeLocationStats(loc.label);

  // Row classes — drives the left-bar accent. has-issue (amber bar) for
  // overdue PMs or non-operational units. has-draft (gold bg) for due-soon.
  const rowClasses = ['ord-vendor-row'];
  let pillHTML = '';
  let warnHTML = '';
  let previewText = loc.address || '';

  if (stats.missedScheduled > 0) {
    // v18.23 — Highest-urgency state: contractor was booked but didn't
    // show or didn't log. Flashing red pill is more dramatic than just
    // "overdue" — this is an explicit broken promise that needs action.
    rowClasses.push('has-issue');
    pillHTML = `<span class="ord-vendor-pill ord-vendor-pill-issue eq-sched-missed-pill">⚠ ${stats.missedScheduled} PM MISSED</span>`;
  } else if (stats.overdue > 0) {
    rowClasses.push('has-issue');
    pillHTML = `<span class="ord-vendor-pill ord-vendor-pill-issue">${stats.overdue} OVERDUE</span>`;
  } else if (stats.issues > 0) {
    rowClasses.push('has-issue');
    pillHTML = `<span class="ord-vendor-pill ord-vendor-pill-issue">${stats.issues} ${stats.issues === 1 ? 'NEEDS ATTN' : 'NEED ATTN'}</span>`;
  } else if (stats.dueSoon > 0) {
    rowClasses.push('has-draft');
    pillHTML = `<span class="ord-vendor-pill ord-vendor-pill-draft">${stats.dueSoon} DUE SOON</span>`;
  }
  // "All clear" — no pill, no special class. Card reads clean.

  // ! warn — only when location has zero units (so user knows to add some)
  if (stats.total === 0) {
    warnHTML = '<span class="ord-vendor-warn" title="No equipment at this location yet">!</span>';
    if (!pillHTML) previewText = previewText || 'No equipment yet';
  }

  // Top-right "when" slot shows the unit count in mono uppercase —
  // exactly where vendors show the last-activity timestamp.
  const whenHTML = `<div class="ord-vendor-when">${stats.total} UNIT${stats.total === 1 ? '' : 'S'}</div>`;

  return `
    <div class="ord-vendor-row-wrap" data-loc-label="${esc(loc.label)}">
      <button class="${rowClasses.join(' ')}" data-loc-enter="${esc(loc.label)}" type="button">
        <div class="ord-vendor-avatar-wrap">
          ${locationAvatarHTML(loc, 'md')}
        </div>
        <div class="ord-vendor-main">
          <div class="ord-vendor-name-row">
            <div class="ord-vendor-name">${esc(loc.label)}</div>
            ${whenHTML}
          </div>
          <div class="ord-vendor-meta">
            ${pillHTML}
            <span class="ord-vendor-preview">${esc(previewText)}</span>
          </div>
        </div>
        ${warnHTML}
        <div class="ord-arrow" aria-hidden="true">›</div>
      </button>
      <button class="ord-vendor-menu" data-loc-edit="${esc(loc.label)}" aria-label="Edit ${esc(loc.label)}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
    </div>
  `;
}

const LOC_SORT_LABELS = {
  attention: 'Attention needed',
  count:     'Most equipment',
  pm:        'PMs upcoming',
  recent:    'Last opened',
  name:      'Name (A→Z)',
  custom:    'Custom order',
};

/* Render the entire location list landing view. Layout mirrors the
   Ordering vendor list: title + ord-search rounded pill search +
   ord-vendor-sort-bar with sort pill + Add button, then the cards
   list. Uses the .ord-* class family throughout so styling is
   pixel-identical to vendors. */
function renderLocationListView() {
  const sorted = sortLocationsByMode(LOCATION_META, locationView.sort);
  const isSearching = !!(locationView.search && locationView.search.trim());

  return `
    <div class="eq-header eq-header-locations">
      <div class="eq-title-row">
        <h2 class="eq-title"><span class="eq-title-icon">${uiSvg('wrench', '20px')}</span> Equipment</h2>
      </div>

      <div class="ord-search-wrap">
        <input type="search" class="ord-search" id="eqLocationSearch" placeholder="Search equipment, parts, anywhere…" value="${esc(locationView.search)}" autocomplete="off">
      </div>

      ${!isSearching ? `
        <div class="ord-vendor-sort-bar">
          <button class="ord-vendor-sort-pill" id="eqLocationSortPill" role="button" tabindex="0" aria-label="Change sort">
            <span class="ord-vendor-sort-label">SORT</span>
            <span class="ord-vendor-sort-value">${esc(LOC_SORT_LABELS[locationView.sort] || locationView.sort)}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button class="ord-vendor-reorder-btn" id="eqAddLocationBtn" style="background:var(--nx-gold); color:var(--nx-bg); border-color:var(--nx-gold); font-weight:600">+ Add Location</button>
        </div>
      ` : ''}
    </div>

    <div id="eqLocationCardsOrSearch">
      ${isSearching
        ? `<div style="padding: 8px 16px;">${renderSearchResultsView()}</div>`
        : (sorted.length === 0
            ? `<div class="eq-empty-small" style="padding: 32px 16px; text-align:center">No locations yet. Tap <strong>+ Add Location</strong> to create your first one.</div>`
            : `<div class="ord-vendors">${sorted.map(renderLocationCard).join('')}</div>`)}
    </div>
  `;
}

/* Render universal search results when the search bar has a query.
   Two grouped sections: equipment matches, then parts matches.
   Empty groups are hidden. */
function renderSearchResultsView() {
  const q = (locationView.search || '').toLowerCase().trim();
  if (!q) return '';

  // Equipment search — name, manufacturer, model, serial, area, location
  const eqMatches = (equipment || []).filter(e => {
    if (e.archived_at || e.archived) return false;
    return (
      (e.name || '').toLowerCase().includes(q) ||
      (e.manufacturer || '').toLowerCase().includes(q) ||
      (e.model || '').toLowerCase().includes(q) ||
      (e.serial_number || '').toLowerCase().includes(q) ||
      (e.area || '').toLowerCase().includes(q) ||
      (e.location || '').toLowerCase().includes(q)
    );
  }).slice(0, 30);

  // Parts search — uses cached searchResults if available, else triggers async load
  const partMatches = (locationView.searchResults && locationView.searchResults.parts) || [];

  return `
    <div class="eq-search-results">
      ${eqMatches.length ? `
        <div class="eq-search-section-head">EQUIPMENT (${eqMatches.length})</div>
        ${eqMatches.map(e => `
          <button class="eq-search-result-row" data-search-eq="${esc(e.id)}" type="button" style="display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; margin-bottom:6px; cursor:pointer; text-align:left">
            <div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(212,164,78,0.08); border-radius:6px; flex:0 0 32px">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--nx-gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[e.category] || ICON_PATHS.other}</svg>
            </div>
            <div style="flex:1; min-width:0">
              <div style="font-size:14px; color:var(--nx-text); font-weight:500">${esc(e.name)}</div>
              <div style="font-size:11px; color:var(--nx-faint); font-family:'JetBrains Mono', monospace">${esc(e.location || '')}${e.manufacturer ? ' · ' + esc(e.manufacturer) : ''}${e.model ? ' ' + esc(e.model) : ''}</div>
            </div>
            <div style="color:var(--nx-faint); font-size:16px" aria-hidden="true">›</div>
          </button>
        `).join('')}
      ` : ''}

      ${partMatches.length ? `
        <div class="eq-search-section-head" style="margin-top:14px">PARTS (${partMatches.length})</div>
        ${partMatches.map(p => `
          <button class="eq-search-result-row" data-search-part="${esc(p.id)}" type="button" style="display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; margin-bottom:6px; cursor:pointer; text-align:left">
            <div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.04); border-radius:6px; flex:0 0 32px">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>
            </div>
            <div style="flex:1; min-width:0">
              <div style="font-size:14px; color:var(--nx-text); font-weight:500">${esc(p.part_name)}</div>
              <div style="font-size:11px; color:var(--nx-faint); font-family:'JetBrains Mono', monospace">${p.oem_part_number ? 'OEM ' + esc(p.oem_part_number) : 'No OEM'}${p.supplier ? ' · ' + esc(p.supplier) : ''}</div>
            </div>
            <div style="color:var(--nx-faint); font-size:16px" aria-hidden="true">›</div>
          </button>
        `).join('')}
      ` : ''}

      ${(!eqMatches.length && !partMatches.length) ? `
        <div class="eq-empty-small" style="padding:24px; text-align:center">
          No matches for "${esc(q)}"
          ${!locationView.searchResults ? '<div style="margin-top:6px; opacity:0.6; font-size:11px">Searching parts catalog…</div>' : ''}
        </div>
      ` : ''}
    </div>
  `;
}

/* Async parts search — fires when the user types in the search bar.
   Results merge into locationView.searchResults and a re-render
   surfaces them inline. Equipment matches are computed locally; parts
   require a DB hit since the parts catalog isn't pre-loaded. */
async function searchPartsCatalog(q) {
  if (!NX.sb || !q) return [];
  try {
    const term = `%${q}%`;
    const { data, error } = await NX.sb.from('equipment_parts')
      .select('id, part_name, oem_part_number, supplier')
      .or(`part_name.ilike.${term},oem_part_number.ilike.${term},supplier.ilike.${term}`)
      .limit(30);
    if (error) {
      console.warn('[equipment] parts search:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('[equipment] parts search threw:', e);
    return [];
  }
}

/* Enter a location — switch to inside mode, bump last_opened_at,
   re-render via buildUI which now picks the inside-view branch. */
async function enterLocation(label) {
  locationView.mode = 'inside';
  locationView.activeLocation = label;
  activeFilter.location = label;  // keep the existing filter in sync
  // Fire-and-forget update of last_opened_at — used by the "Last opened"
  // sort mode. Doesn't block the navigation.
  if (NX.sb) {
    const loc = LOCATION_META.find(l => l.label === label);
    if (loc && loc.id) {
      NX.sb.from('locations').update({ last_opened_at: new Date().toISOString() }).eq('id', loc.id).then(() => {});
    }
  }
  buildUI();
}

function exitLocation() {
  locationView.mode = 'list';
  locationView.activeLocation = null;
  locationView.search = '';
  locationView.searchResults = null;
  buildUI();
}

/* Bottom-sheet location editor (add or edit). Fields per Orion's
   spec: name (required), photo, address. Picture-style avatar matching
   ordering vendors when no photo is set. */
function openLocationEditor(existing, onSaved) {
  const isNew = !existing;
  let label = existing ? existing.label : '';
  let address = existing ? (existing.address || '') : '';
  let photoUrl = existing ? (existing.photo_url || '') : '';
  let pendingFile = null;

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9000';

  const render = () => {
    const previewLoc = { label: label || '?', photo_url: photoUrl, avatar_hue: existing?.avatar_hue };
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:90vh; overflow-y:auto">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">${isNew ? 'New location' : 'Edit ' + esc(existing.label)}</div>

        <div style="padding: 16px; display:flex; align-items:center; gap:14px;">
          <div id="locEditAvatar" style="flex:0 0 auto">${locationAvatarHTML(previewLoc, 'lg')}</div>
          <div style="flex:1">
            <button type="button" id="locPhotoBtn" class="eq-btn eq-btn-small eq-btn-secondary">${uiSvg('camera', '13px')} ${photoUrl ? 'Change photo' : 'Add photo'}</button>
            ${photoUrl ? `<button type="button" id="locPhotoClear" class="eq-btn eq-btn-tiny eq-btn-danger" style="margin-left:6px">Remove</button>` : ''}
            <input type="file" id="locPhotoFile" accept="image/*" hidden>
            <div style="font-size:10px; color:var(--nx-faint); margin-top:6px">Optional — initials shown if blank</div>
          </div>
        </div>

        <div style="padding: 4px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Name *</label>
          <input type="text" id="locLabel" value="${esc(label)}" placeholder="e.g. Domain Northside" maxlength="60" autocomplete="off"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:15px;">
        </div>

        <div style="padding: 8px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Address</label>
          <input type="text" id="locAddress" value="${esc(address)}" placeholder="1808 E 6th St, Austin TX" maxlength="200" autocomplete="off"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:14px;">
        </div>

        <div style="padding: 12px 16px;">
          <button class="eq-bulk-sheet-confirm" data-action="save" type="button" style="background:var(--nx-gold); color:#000">
            ${isNew ? 'Create location' : 'Save changes'}
          </button>
          ${!isNew && existing.id ? `<button class="eq-bulk-sheet-cancel" data-action="archive" type="button" style="color:#c44; border-color:#c44">Archive this location</button>` : ''}
          <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#locLabel').addEventListener('input', (e) => { label = e.target.value; });
    overlay.querySelector('#locAddress').addEventListener('input', (e) => { address = e.target.value; });

    const fileInput = overlay.querySelector('#locPhotoFile');
    overlay.querySelector('#locPhotoBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      pendingFile = f;
      // Local preview via objectURL until upload completes
      photoUrl = URL.createObjectURL(f);
      render();
    });
    const clearBtn = overlay.querySelector('#locPhotoClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      pendingFile = null;
      photoUrl = '';
      render();
    });

    overlay.querySelector('[data-action="save"]').addEventListener('click', save);
    const arch = overlay.querySelector('[data-action="archive"]');
    if (arch) arch.addEventListener('click', archive);
  };

  const save = async () => {
    if (!label.trim()) { NX.toast && NX.toast('Name required', 'warn', 1500); return; }
    if (!NX.sb) { NX.toast && NX.toast('Database unavailable', 'error', 2000); return; }

    const saveBtn = overlay.querySelector('[data-action="save"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      // Upload photo if a new file was attached (replace existing).
      let finalPhotoUrl = photoUrl;
      if (pendingFile) {
        const safeName = pendingFile.name.replace(/[^a-z0-9.]/gi, '_');
        const path = `locations/${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('equipment-attachments')
          .upload(path, pendingFile, { upsert: false, contentType: pendingFile.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = NX.sb.storage.from('equipment-attachments').getPublicUrl(path);
        finalPhotoUrl = publicUrl;
      } else if (photoUrl && photoUrl.startsWith('blob:')) {
        // Object URL but no pendingFile — shouldn't happen, defensively reset
        finalPhotoUrl = existing?.photo_url || '';
      }

      if (isNew) {
        // Check label uniqueness (case-insensitive)
        const dup = LOCATION_META.find(l => l.label.toLowerCase() === label.trim().toLowerCase());
        if (dup) { NX.toast && NX.toast('A location with that name already exists', 'warn', 2000); if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Create location'; } return; }
        const maxSort = Math.max(0, ...LOCATION_META.map(l => l.sort_order || 0));
        const { error } = await NX.sb.from('locations').insert({
          label: label.trim(),
          address: address.trim() || null,
          photo_url: finalPhotoUrl || null,
          sort_order: maxSort + 10,
        });
        if (error) throw error;
        NX.toast && NX.toast(`Location "${label.trim()}" added`, 'success', 2000);
      } else {
        const newLabel = label.trim();
        const oldLabel = existing.label;
        const labelChanged = oldLabel !== newLabel;

        const { error } = await NX.sb.from('locations').update({
          label: newLabel,
          address: address.trim() || null,
          photo_url: finalPhotoUrl || null,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
        if (error) throw error;

        // If the label changed, propagate to equipment.location so the
        // existing rows stay matched. Wrapped in try/catch so a partial
        // failure (RLS on equipment, etc.) doesn't crash the whole flow
        // and look like a logout. v18.22-fix: was losing app state and
        // appearing to log out because the cascade ran but the in-memory
        // locationView.activeLocation stayed on the OLD label — filter
        // returned zero matches, screen blanked.
        if (labelChanged) {
          try {
            const { error: cascadeErr } = await NX.sb.from('equipment')
              .update({ location: newLabel })
              .eq('location', oldLabel);
            if (cascadeErr) console.warn('[equipment cascade]', cascadeErr.message);
          } catch (cascadeE) {
            console.warn('[equipment cascade threw]', cascadeE);
            // Continue — locations row already saved successfully.
          }
          // Sync in-memory navigation state so the next render doesn't
          // try to filter by a no-longer-existent label.
          if (locationView.activeLocation === oldLabel) locationView.activeLocation = newLabel;
          if (activeFilter.location === oldLabel) activeFilter.location = newLabel;
        }
        NX.toast && NX.toast(labelChanged ? `Renamed to "${newLabel}"` : 'Location updated', 'success', 1800);
      }
      await loadLocationsFromDB();
      await loadEquipment();
      overlay.remove();
      // v18.22-fix: after edit, always return to list mode so the user
      // sees the updated card with new name/photo/address. Re-entering
      // the location gets fresh state. Prevents the "logged out" feel
      // where inside-view filter shows zero rows due to stale label.
      if (!isNew) {
        locationView.mode = 'list';
        locationView.activeLocation = null;
      }
      if (typeof onSaved === 'function') onSaved();
      buildUI();
    } catch (e) {
      console.error('[saveLocation]', e);
      NX.toast && NX.toast('Save failed: ' + (e.message || ''), 'error', 3000);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isNew ? 'Create location' : 'Save changes'; }
    }
  };

  const archive = async () => {
    if (!existing || !existing.id) return;
    if (!confirm(`Archive "${existing.label}"? Equipment at this location stays accessible via search and history; the location just won't appear in the card list.`)) return;
    try {
      const { error } = await NX.sb.from('locations').update({
        archived: true, updated_at: new Date().toISOString()
      }).eq('id', existing.id);
      if (error) throw error;
      NX.toast && NX.toast('Location archived', 'info', 1500);
      await loadLocationsFromDB();
      overlay.remove();
      if (typeof onSaved === 'function') onSaved();
      buildUI();
    } catch (e) {
      console.error('[archiveLocation]', e);
      NX.toast && NX.toast('Archive failed: ' + (e.message || ''), 'error', 3000);
    }
  };

  render();
  document.body.appendChild(overlay);
}

/* Inject the location-card styles once. Avatar styles match ordering
   vendor patterns; pill colors match the existing PM color ladder. */
(function injectLocationCardStyles() {
  if (typeof document === 'undefined' || document.getElementById('eq-loc-card-styles')) return;
  const s = document.createElement('style');
  s.id = 'eq-loc-card-styles';
  s.textContent = `
    .eq-loc-cards { display:flex; flex-direction:column; gap:8px; }
    .eq-loc-card-wrap { display:flex; gap:4px; align-items:stretch; }
    .eq-loc-card {
      flex:1; display:flex; align-items:center; gap:12px;
      padding:14px 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01));
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 10px;
      color: var(--nx-text);
      cursor: pointer;
      text-align: left;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .eq-loc-card:hover, .eq-loc-card:focus {
      background: linear-gradient(180deg, rgba(212,164,78,0.06), rgba(212,164,78,0.02));
      border-color: rgba(212,164,78,0.3);
      outline: none;
    }
    .eq-loc-avatar-wrap { flex:0 0 auto; }
    .eq-loc-avatar {
      width: 44px; height: 44px; border-radius: 50%;
      object-fit: cover;
      display:flex; align-items:center; justify-content:center;
      flex: 0 0 44px;
      font-size: 18px; font-weight: 600;
      letter-spacing: 0.5px;
    }
    .eq-loc-avatar-lg { width: 56px; height: 56px; flex: 0 0 56px; font-size: 22px; }
    .eq-loc-avatar-initials {
      background: hsl(var(--hue, 30), 35%, 22%);
      color: hsl(var(--hue, 30), 65%, 75%);
      border: 1px solid hsl(var(--hue, 30), 40%, 30%);
    }
    .eq-loc-card-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
    .eq-loc-card-name-row { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
    .eq-loc-card-name { font-size:16px; font-weight:600; color:var(--nx-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .eq-loc-card-count { font-size:11px; color:var(--nx-faint); font-family:'JetBrains Mono', monospace; flex:0 0 auto; letter-spacing:0.5px; }
    .eq-loc-card-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .eq-loc-card-pill {
      font-size:10px; padding:2px 8px; border-radius:10px;
      letter-spacing:0.5px; text-transform:uppercase; font-weight:600;
      white-space:nowrap;
    }
    .eq-loc-card-pill.is-clear   { background: rgba(58,141,58,0.15); color:#7bc47b; border:1px solid rgba(58,141,58,0.4); }
    .eq-loc-card-pill.is-soon    { background: rgba(212,164,78,0.15); color:#d4a44e; border:1px solid rgba(212,164,78,0.4); }
    .eq-loc-card-pill.is-overdue { background: rgba(196,68,68,0.15); color:#e08585; border:1px solid rgba(196,68,68,0.4); }
    .eq-loc-card-pill.is-issue   { background: rgba(196,68,68,0.15); color:#e08585; border:1px solid rgba(196,68,68,0.4); }
    .eq-loc-card-address { font-size:11px; color:var(--nx-faint); font-family:'JetBrains Mono', monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .eq-loc-arrow { flex:0 0 auto; font-size:20px; color:var(--nx-faint); padding-right:4px; }
    .eq-loc-menu-btn {
      flex: 0 0 36px; width: 36px;
      background: transparent; border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px; color: var(--nx-faint); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .eq-loc-menu-btn:hover { background: rgba(255,255,255,0.04); color: var(--nx-gold); }

    /* v18.22 — Inside-location header (back arrow + small avatar + name) */
    .eq-inside-loc-header {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 14px;
      padding: 4px 0;
    }
    .eq-inside-back {
      flex: 0 0 36px; width: 36px; height: 36px;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: var(--nx-text);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .eq-inside-back:hover, .eq-inside-back:active {
      background: rgba(255,255,255,0.04);
      border-color: rgba(212,164,78,0.4);
      color: var(--nx-gold);
    }
    /* Override the 72px ord-vendor-avatar inside the inside-header so it
       sizes appropriately for a header context (40px instead of 72px). */
    .eq-inside-avatar.ord-vendor-avatar {
      width: 40px; height: 40px; flex: 0 0 40px;
      font-size: 17px;
      border-radius: 50%;
    }
    .eq-inside-loc-title {
      flex: 1; min-width: 0;
      margin: 0;
      font-family: 'Outfit', sans-serif;
      font-size: 22px;
      font-weight: 600;
      color: var(--nx-text);
      letter-spacing: 0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* v18.22 — Location cards stack the pill ABOVE the address so neither
       gets truncated. Vendor cards put pill + preview on the same line,
       but addresses are denser content than vendor status text — they
       deserve their own line. Card naturally grows taller to fit, which
       matches the "make cards bigger to show full info" requirement.
       Address still wraps to 2 lines via vendor default line-clamp. */
    .ord-vendor-row[data-loc-enter] .ord-vendor-meta {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .ord-vendor-row[data-loc-enter] .ord-vendor-preview {
      width: 100%;
    }

    .eq-search-section-head {
      font-size:10px; letter-spacing:1.2px; color:var(--nx-faint);
      text-transform:uppercase; margin: 4px 0 6px; padding: 0 2px;
    }

    /* (Old .eq-loc-inside-* rules removed — replaced by .eq-inside-* above) */
  `;
  document.head.appendChild(s);
})();

/* Wire all event handlers for the location list view (search,
   sort, card taps, add/edit). Called from buildUI when in list mode. */
function wireLocationListView() {
  let searchDebounce;

  document.getElementById('eqAddLocationBtn')?.addEventListener('click', () => {
    openLocationEditor(null, () => buildUI());
  });

  // Sort pill — opens a bottom sheet picker (vendor-style)
  document.getElementById('eqLocationSortPill')?.addEventListener('click', () => {
    openLocationSortPicker();
  });

  // Tap a location card → enter the location
  document.querySelectorAll('[data-loc-enter]').forEach(el => {
    el.addEventListener('click', () => enterLocation(el.dataset.locEnter));
  });

  // Tap a card's ⋮ → open the editor for that location
  document.querySelectorAll('[data-loc-edit]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const loc = LOCATION_META.find(l => l.label === el.dataset.locEdit);
      if (loc) openLocationEditor(loc, () => buildUI());
    });
  });

  // Search bar — debounced, queries equipment locally + parts via DB
  const searchEl = document.getElementById('eqLocationSearch');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      const q = e.target.value;
      locationView.search = q;
      clearTimeout(searchDebounce);
      const cardWrap = document.getElementById('eqLocationCardsOrSearch');
      if (cardWrap) {
        const trimmed = q.trim();
        if (!trimmed) {
          locationView.searchResults = null;
          buildUI();
          return;
        }
        cardWrap.innerHTML = `<div style="padding:8px 16px">${renderSearchResultsView()}</div>`;
        wireSearchResultClicks();
      }
      const fresh = document.getElementById('eqLocationSearch');
      if (fresh && fresh !== searchEl) {
        fresh.focus();
        try { fresh.setSelectionRange(q.length, q.length); } catch (_) {}
      }
      searchDebounce = setTimeout(async () => {
        const trimmed = (locationView.search || '').trim();
        if (!trimmed) return;
        const parts = await searchPartsCatalog(trimmed);
        locationView.searchResults = { parts };
        if ((locationView.search || '').trim() === trimmed) {
          const wrap = document.getElementById('eqLocationCardsOrSearch');
          if (wrap) wrap.innerHTML = `<div style="padding:8px 16px">${renderSearchResultsView()}</div>`;
          wireSearchResultClicks();
        }
      }, 250);
    });
  }

  wireSearchResultClicks();
}

/* Bottom sheet picker for sort mode. Mirrors how the ordering vendor
   sort pill opens a selection sheet rather than a native <select>. */
function openLocationSortPicker() {
  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9000';
  overlay.innerHTML = `
    <div class="eq-bulk-sheet-backdrop"></div>
    <div class="eq-bulk-sheet">
      <div class="eq-bulk-sheet-handle"></div>
      <div class="eq-bulk-sheet-title">Sort locations by</div>
      <div class="eq-bulk-sheet-list">
        ${Object.entries(LOC_SORT_LABELS).map(([k, v]) => `
          <button class="eq-bulk-sheet-item ${locationView.sort === k ? 'is-selected' : ''}" data-sort="${esc(k)}" type="button">
            <div class="eq-bulk-apply-check">${locationView.sort === k ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
            <div class="eq-bulk-sheet-item-text">
              <div class="eq-bulk-sheet-item-name">${esc(v)}</div>
            </div>
          </button>
        `).join('')}
      </div>
      <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
    </div>
  `;
  const close = () => overlay.remove();
  overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      locationView.sort = btn.dataset.sort;
      close();
      buildUI();
    });
  });
  document.body.appendChild(overlay);
}



/* Wire clicks on search result rows. Called after the search results
   section is rendered (both initially and after async parts arrive). */
function wireSearchResultClicks() {
  document.querySelectorAll('[data-search-eq]').forEach(el => {
    el.addEventListener('click', () => {
      const eqId = el.dataset.searchEq;
      if (typeof openDetail === 'function') openDetail(eqId);
    });
  });
  document.querySelectorAll('[data-search-part]').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.searchPart;
      if (typeof openPartDetail === 'function') openPartDetail(pid);
    });
  });
}



/* ════════════════════════════════════════════════════════════════════
   v18.23 — Contractor-driven PM scheduling.

   `equipment.last_pm_date + pm_interval_days` continues to drive the
   countdown (when it SHOULD be done). Separately, pm_schedules tracks
   when contractors have COMMITTED to come. The two are independent:

   • Countdown / due date / progress bar  — auto, last + interval
   • Scheduled PM(s)                       — explicit contractor commit

   A scheduled PM can have up to 3 phases (e.g. coil clean + control
   inspection on different days). When a PM completes — via the
   internal Log PM sheet, a matching public QR submission, or admin
   approval of a pm_log — the matching pm_schedules row flips to
   'completed' and last_pm_date refreshes (resetting the countdown).
   If scheduled_date passes without completion, the row is treated as
   'missed' and the equipment gets a flashing red pill that propagates
   to the location card attention score.
   ════════════════════════════════════════════════════════════════════ */

// Per-equipment cache of pm_schedules rows. Populated by loadPmSchedules,
// keyed by equipment_id, value is array of rows (scheduled + recently
// completed). Lookups are O(1) per equipment; status filtering is done
// inline at render time.
let pmSchedulesByEquipment = {};

async function loadPmSchedules() {
  if (!NX.sb) return;
  try {
    // Pull all 'scheduled' rows + the most recent 'completed' / 'missed'
    // rows. Old completed history can be fetched on-demand for the
    // equipment timeline; cache stays small.
    const { data, error } = await NX.sb.from('pm_schedules')
      .select('*')
      .in('status', ['scheduled', 'missed'])
      .order('scheduled_date');
    if (error) {
      if (!/relation.+does not exist/i.test(error.message || '')) {
        console.warn('[equipment] loadPmSchedules:', error.message);
      }
      return;
    }
    pmSchedulesByEquipment = {};
    for (const row of (data || [])) {
      if (!pmSchedulesByEquipment[row.equipment_id]) {
        pmSchedulesByEquipment[row.equipment_id] = [];
      }
      pmSchedulesByEquipment[row.equipment_id].push(row);
    }
    // After loading, classify any 'scheduled' rows whose scheduled_date
    // has already passed as 'missed'. This is a CLIENT-side compute —
    // the row stays as 'scheduled' in DB until either marked completed
    // via an actual PM event, or explicitly cancelled. Keeps the DB
    // honest and avoids a server-side cron.
    const todayIso = new Date().toISOString().slice(0, 10);
    for (const eqId in pmSchedulesByEquipment) {
      for (const row of pmSchedulesByEquipment[eqId]) {
        if (row.status === 'scheduled' && row.scheduled_date < todayIso) {
          row._isMissed = true; // virtual flag; doesn't write to DB
        }
      }
    }
    console.log('[equipment] loaded', (data || []).length, 'pm_schedules rows');
  } catch (e) {
    console.warn('[equipment] loadPmSchedules threw:', e);
  }
}

/* Get all upcoming scheduled phases for one equipment, sorted by phase
   order (or by date if phase numbers are tied). */
function getScheduledPhases(equipId) {
  const rows = pmSchedulesByEquipment[equipId] || [];
  return rows
    .filter(r => r.status === 'scheduled')
    .sort((a, b) => (a.phase || 1) - (b.phase || 1) || a.scheduled_date.localeCompare(b.scheduled_date));
}

/* Check if equipment has at least one missed scheduled PM —
   used for the flashing red "PM NOT DONE" pill. */
function hasMissedScheduledPm(equipId) {
  const phases = getScheduledPhases(equipId);
  return phases.some(p => p._isMissed);
}

/* ─── Contractor picker (loaded fresh from nodes table on demand) ──── */

async function loadVendorsForPicker() {
  if (!NX.sb) return [];
  try {
    // Vendor consolidation (Phase 1): the PM scheduler now picks from the
    // real `vendors` table — the single source of truth for service
    // providers — instead of brain nodes. select('*') + client-side active
    // filter is the bulletproof pattern (never errors on an optional column).
    const { data, error } = await NX.sb.from('vendors').select('*').order('company');
    if (error) {
      console.warn('[equipment] loadVendorsForPicker:', error.message);
      return [];
    }
    return (data || [])
      .filter(v => v.active !== false)   // keep active = true OR null
      .map(v => ({
        id: v.id,
        name: v.company || v.name || 'Unnamed vendor',
        phone: v.phone || '',
        category: v.category || '',
      }));
  } catch (e) {
    console.warn('[equipment] loadVendorsForPicker threw:', e);
    return [];
  }
}

/* ─── Inspection vendor picker ──────────────────────────────────────
   POOL-ONLY by design (Alfredo's rule): the vendor who does a unit's
   inspections must come from the vendors table — no free text, no
   inline creation. New vendors get added on the Vendors screen first.
   opts.required: opened as an enforcement step after an inspection
   cadence edit; dismissing it fires opts.onDismiss so the caller can
   revert the edit ("no inspection without a vendor").              */
async function openInspectionVendorPicker(equipId, opts) {
  opts = opts || {};
  const eq = equipment.find(e => String(e.id) === String(equipId));
  if (!eq) return;
  const vendors = await loadVendorsForPicker();

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9300';
  const dismiss = () => {
    overlay.remove();
    if (typeof opts.onDismiss === 'function') opts.onDismiss();
  };

  const rows = vendors.map(v => `
    <button class="eq-sched-contractor-row${String(eq.inspection_vendor_id || '') === String(v.id) ? ' is-selected' : ''}"
            data-iv-id="${esc(v.id)}" data-iv-hay="${esc((v.name + ' ' + v.category).toLowerCase())}" type="button">
      <span class="eq-sched-contractor-name">${esc(v.name)}${v.category ? ` <span style="opacity:.5;font-size:11px">· ${esc(v.category)}</span>` : ''}</span>
      ${String(eq.inspection_vendor_id || '') === String(v.id) ? `<span class="eq-sched-check">${uiSvg('check', '14px')}</span>` : ''}
    </button>
  `).join('');

  overlay.innerHTML = `
    <div class="eq-bulk-sheet-backdrop"></div>
    <div class="eq-bulk-sheet" style="max-height:85vh; overflow-y:auto">
      <div class="eq-bulk-sheet-handle"></div>
      <div class="eq-bulk-sheet-title">Inspection vendor — ${esc(eq.name)}</div>
      <div class="eq-bulk-sheet-sub">${opts.required ? 'Every inspection needs a vendor. ' : ''}Choose from your vendor pool — to use someone new, add them in Vendors first.</div>
      <div style="padding:12px 16px 4px">
        <input type="text" id="ivSearch" placeholder="Search vendors…" autocomplete="off"
          style="width:100%; box-sizing:border-box; padding:11px 13px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:15px">
      </div>
      <div class="eq-sched-contractors" style="padding:8px 16px 6px">
        ${rows || '<div class="eq-sched-empty">No vendors in the pool yet — add one on the Vendors screen.</div>'}
      </div>
      <div style="padding:6px 16px 16px">
        ${(!opts.required && eq.inspection_vendor_id) ? '<button class="eq-bulk-sheet-cancel" data-action="clear" type="button" style="color:#c44; border-color:#c44">Remove inspection vendor</button>' : ''}
        <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
      </div>
    </div>
  `;

  overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', dismiss);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', dismiss);

  const saveVendor = async (vendorId) => {
    try {
      const { error } = await NX.sb.from('equipment')
        .update({ inspection_vendor_id: vendorId }).eq('id', equipId);
      if (error) {
        if (/column.+does not exist/i.test(error.message || '')) {
          NX.toast?.('inspection_vendor_id column missing — run latest migration', 'warn', 4000);
          return;
        }
        throw error;
      }
      eq.inspection_vendor_id = vendorId;
      const v = vendors.find(x => String(x.id) === String(vendorId));
      NX.toast?.(vendorId ? `Inspections by ${v ? v.name : 'vendor'}` : 'Inspection vendor removed', 'success', 1800);
      overlay.remove();   // saved — no onDismiss revert
      if (typeof openDetail === 'function') openDetail(equipId);
    } catch (e) {
      console.error('[inspectionVendorPicker] save:', e);
      NX.toast?.('Could not save vendor', 'error', 2200);
    }
  };

  overlay.querySelectorAll('[data-iv-id]').forEach(b =>
    b.addEventListener('click', () => saveVendor(b.dataset.ivId)));
  const clearBtn = overlay.querySelector('[data-action="clear"]');
  if (clearBtn) clearBtn.addEventListener('click', () => saveVendor(null));
  // Search filters in place — no re-render, keeps focus.
  const si = overlay.querySelector('#ivSearch');
  si.addEventListener('input', () => {
    const q = si.value.trim().toLowerCase();
    overlay.querySelectorAll('[data-iv-id]').forEach(b => {
      b.style.display = (!q || (b.dataset.ivHay || '').includes(q)) ? '' : 'none';
    });
  });

  document.body.appendChild(overlay);
  setTimeout(() => si.focus(), 60);
}

/* ─── Schedule editor bottom sheet ─────────────────────────────────── */

/* The flow:
   Step 1 — pick contractor (or add new inline)
   Step 2 — set up to 3 phase dates with optional labels
   Step 3 — confirm: deletes any existing 'scheduled' rows for this
            equipment and inserts the new set. (Single source of truth.)
*/
async function openScheduleEditor(equipId) {
  const eq = equipment.find(e => String(e.id) === String(equipId));
  if (!eq) { NX.toast?.('Equipment not found', 'error', 1500); return; }

  // Load vendors live — small enough to refetch each open.
  const vendors = await loadVendorsForPicker();
  const current = getScheduledPhases(equipId);

  // Initial selection. New schedules store vendor_id; prefer that. For older
  // schedules that only have a contractor_name (node-era), match a vendor by
  // name so the editor still pre-selects the right one.
  let selectedVendorId = current[0]?.vendor_id || null;
  let selectedVendorName = current[0]?.contractor_name || null;
  if (!selectedVendorId && selectedVendorName) {
    const match = vendors.find(v => v.name.toLowerCase() === selectedVendorName.toLowerCase());
    if (match) selectedVendorId = match.id;
  }
  let selectedVendorPhone = (vendors.find(v => v.id === selectedVendorId) || {}).phone || '';
  let phases = current.length > 0
    ? current.map(s => ({ id: s.id, date: s.scheduled_date, label: s.phase_label || '' }))
    : [{ id: null, date: '', label: '' }];

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9100';

  const render = () => {
    const contractorRows = vendors.map(c => `
      <button class="eq-sched-contractor-row${selectedVendorId == c.id ? ' is-selected' : ''}" data-c-id="${esc(c.id)}" data-c-name="${esc(c.name)}" data-c-phone="${esc(c.phone)}" type="button">
        <span class="eq-sched-contractor-name">${esc(c.name)}${c.category ? ` <span style="opacity:.5;font-size:11px">· ${esc(c.category)}</span>` : ''}</span>
        ${selectedVendorId == c.id ? `<span class="eq-sched-check">${uiSvg('check', '14px')}</span>` : ''}
      </button>
    `).join('');

    const phasesHTML = phases.map((p, i) => `
      <div class="eq-sched-phase-row" data-phase-idx="${i}">
        <div class="eq-sched-phase-head">
          <div class="eq-sched-phase-num">Phase ${i + 1}</div>
          ${phases.length > 1 ? `<button class="eq-sched-phase-del" data-phase-del="${i}" type="button" aria-label="Remove phase">×</button>` : ''}
        </div>
        <input type="date" class="eq-sched-phase-date" data-phase-date="${i}" value="${esc(p.date)}" required>
        <input type="text" class="eq-sched-phase-label" data-phase-label="${i}" value="${esc(p.label)}" placeholder="Phase label (optional) — e.g. Coil clean" maxlength="50">
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:92vh; overflow-y:auto">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Schedule PM for ${esc(eq.name)}</div>

        <!-- Step 1: Vendor -->
        <div class="eq-sched-section">
          <div class="eq-sched-section-label">VENDOR</div>
          <div class="eq-sched-contractors">
            ${contractorRows || '<div class="eq-sched-empty">No vendors yet</div>'}
            <button class="eq-sched-add-contractor" id="eqSchedAddContractor" type="button">
              <span style="font-size:18px; line-height:1">+</span> Add new vendor
            </button>
          </div>
        </div>

        <!-- Step 2: Phases -->
        <div class="eq-sched-section">
          <div class="eq-sched-section-label">PHASES <span style="opacity:0.5; text-transform:none; letter-spacing:0; font-size:10px">${phases.length}/3 — most PMs are 1 visit</span></div>
          <div class="eq-sched-phases">${phasesHTML}</div>
          ${phases.length < 3 ? `<button class="eq-sched-add-phase" id="eqSchedAddPhase" type="button">+ Add phase</button>` : ''}
        </div>

        <!-- Save / clear / cancel -->
        <div style="padding: 14px 16px;">
          <button class="eq-bulk-sheet-confirm" data-action="save" type="button" style="background:var(--nx-gold); color:#000">
            ${current.length > 0 ? 'Update schedule' : 'Save schedule'}
          </button>
          ${current.length > 0 ? `<button class="eq-bulk-sheet-cancel" data-action="clear" type="button" style="color:#c44; border-color:#c44">Cancel all scheduled phases</button>` : ''}
          <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>
    `;

    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());

    // Vendor selection
    overlay.querySelectorAll('[data-c-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedVendorId = btn.dataset.cId;
        selectedVendorName = btn.dataset.cName;
        selectedVendorPhone = btn.dataset.cPhone || '';
        render();
      });
    });

    // Add vendor inline — writes to the vendors table (single source of
    // truth) so it's immediately available everywhere vendors appear.
    overlay.querySelector('#eqSchedAddContractor').addEventListener('click', async () => {
      const name = (prompt('Vendor / company name:') || '').trim();
      if (!name) return;
      const phone = (prompt('Phone (optional):') || '').trim();
      try {
        const { data, error } = await NX.sb.from('vendors')
          .insert({ company: name, name, phone: phone || null, active: true })
          .select('*').single();
        if (error) throw error;
        if (data && data.id) {
          vendors.push({ id: data.id, name: data.company || data.name, phone: data.phone || '', category: data.category || '' });
          selectedVendorId = data.id;
          selectedVendorName = data.company || data.name;
          selectedVendorPhone = data.phone || '';
          render();
        }
      } catch (e) {
        console.warn('[scheduleEditor] add vendor:', e);
        NX.toast?.('Could not save vendor', 'error', 2000);
      }
    });

    // Phase inputs
    overlay.querySelectorAll('[data-phase-date]').forEach(inp => {
      inp.addEventListener('input', e => { phases[parseInt(e.target.dataset.phaseDate, 10)].date = e.target.value; });
    });
    overlay.querySelectorAll('[data-phase-label]').forEach(inp => {
      inp.addEventListener('input', e => { phases[parseInt(e.target.dataset.phaseLabel, 10)].label = e.target.value; });
    });

    // Add phase
    overlay.querySelector('#eqSchedAddPhase')?.addEventListener('click', () => {
      if (phases.length < 3) {
        phases.push({ id: null, date: '', label: '' });
        render();
      }
    });

    // Remove phase
    overlay.querySelectorAll('[data-phase-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        phases.splice(parseInt(btn.dataset.phaseDel, 10), 1);
        render();
      });
    });

    // Save
    overlay.querySelector('[data-action="save"]').addEventListener('click', save);
    // Clear all scheduled
    overlay.querySelector('[data-action="clear"]')?.addEventListener('click', clearAll);
  };

  const save = async () => {
    if (!selectedVendorId) { NX.toast?.('Pick a vendor first', 'warn', 1800); return; }
    const validPhases = phases.filter(p => p.date && p.date.trim());
    if (validPhases.length === 0) { NX.toast?.('At least one phase date required', 'warn', 1800); return; }

    // Soft warning if phase 2 comes before phase 1, etc. — doesn't block.
    for (let i = 1; i < validPhases.length; i++) {
      if (validPhases[i].date < validPhases[i - 1].date) {
        if (!confirm(`Phase ${i + 1} (${validPhases[i].date}) is before Phase ${i} (${validPhases[i - 1].date}). Save anyway?`)) return;
        break;
      }
    }

    const saveBtn = overlay.querySelector('[data-action="save"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      // Strategy: cancel existing scheduled rows (don't delete — keep history),
      // then insert fresh rows. Simpler than diffing in JS, and the reschedule
      // audit naturally bumps reschedule_count on the new rows.
      const rescheduleCount = current.length > 0 ? 1 : 0;

      if (current.length > 0) {
        // Mark prior scheduled rows as cancelled — provides reschedule trail
        await NX.sb.from('pm_schedules').update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        }).eq('equipment_id', equipId).eq('status', 'scheduled');
      }

      const rows = validPhases.map((p, i) => ({
        equipment_id: equipId,
        vendor_id: selectedVendorId,        // NEW — the vendor bridge
        contractor_node_id: null,           // node era retired for new PMs
        contractor_name: selectedVendorName, // kept for display + back-compat
        scheduled_date: p.date,
        phase: i + 1,
        phase_label: p.label.trim() || null,
        // pm_schedules.title is NOT NULL — synthesize from contractor and
        // phase label so the row is meaningful in lists. If the phase has
        // its own label the user typed, prefer that.
        title: p.label.trim()
          || (validPhases.length > 1
              ? `PM Phase ${i + 1} — ${selectedVendorName}`
              : `PM — ${selectedVendorName}`),
        status: 'scheduled',
        reschedule_count: rescheduleCount,
      }));

      const { error } = await NX.sb.from('pm_schedules').insert(rows);
      if (error) throw error;

      // Push the schedule data back onto the equipment row so the detail
      // page's PM fields and the Call Service button stay in sync.
      // Best-effort: failure here doesn't block the save.
      try {
        const earliestDate = validPhases[0].date;
        const eqUpdate = {
          next_pm_date: earliestDate,
          service_vendor_id: selectedVendorId,          // NEW — vendor linkage
          service_contractor_node_id: null,             // node era retired
          service_contractor_name: selectedVendorName,  // display
          service_contractor_phone: selectedVendorPhone || null, // keeps Call Service working
        };
        // Infer pm_interval_days only when there's a prior PM to measure
        // from. Brand-new units with no last_pm_date will populate it on
        // the first completed PM via approvePmLog.
        const { data: priorEq } = await NX.sb.from('equipment')
          .select('last_pm_date').eq('id', equipId).maybeSingle();
        if (priorEq?.last_pm_date) {
          const days = Math.round(
            (new Date(earliestDate) - new Date(priorEq.last_pm_date)) / 86400000
          );
          if (days > 0 && days <= 3650) {
            eqUpdate.pm_interval_days = days;
          }
        }
        await NX.sb.from('equipment').update(eqUpdate).eq('id', equipId);
      } catch (e) {
        console.warn('[scheduleEditor] equipment sync (non-fatal):', e);
      }

      NX.toast?.(`PM scheduled with ${selectedVendorName}`, 'success', 2000);
      await loadPmSchedules();
      overlay.remove();
      if (typeof openDetail === 'function') openDetail(equipId);
    } catch (e) {
      console.error('[scheduleEditor] save', e);
      NX.toast?.('Save failed: ' + (e.message || ''), 'error', 3000);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = current.length > 0 ? 'Update schedule' : 'Save schedule'; }
    }
  };

  const clearAll = async () => {
    if (!confirm('Cancel all scheduled phases for this equipment? The countdown stays anchored to the last completed PM.')) return;
    try {
      await NX.sb.from('pm_schedules').update({
        status: 'cancelled', updated_at: new Date().toISOString(),
      }).eq('equipment_id', equipId).eq('status', 'scheduled');
      NX.toast?.('Schedule cleared', 'info', 1500);
      await loadPmSchedules();
      overlay.remove();
      if (typeof openDetail === 'function') openDetail(equipId);
    } catch (e) {
      console.error('[scheduleEditor] clear', e);
      NX.toast?.('Clear failed: ' + (e.message || ''), 'error', 2500);
    }
  };

  render();
  document.body.appendChild(overlay);
}

/* ─── Render scheduled-PM block for lifecycle card ─────────────────── */

/* Returns HTML for the "PM SCHEDULED" lifecycle field value.
   Three states:
   1. Nothing scheduled → "Not scheduled" (tap to schedule)
   2. Phases scheduled, none missed → "Tyler · Jun 18" or multi-line
   3. Any phase missed (scheduled_date passed) → red flashing pill */
// Module-level date formatter. renderPmScheduledValue (and any other
// module-scope caller) needs this; previously `fmtDate` only existed as a
// local const inside two render functions, so calls from here threw
// "fmtDate is not defined" — which silently rejected openDetail and made
// equipment cards appear un-tappable. Function declaration hoists, so this
// is in scope regardless of position. The two local `const fmtDate` inside
// other functions still shadow this within their own scopes (intentional).
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

function renderPmScheduledValue(equipId) {
  const phases = getScheduledPhases(equipId);
  if (phases.length === 0) {
    return '<span style="opacity:0.6">Not scheduled</span>';
  }
  const contractor = phases[0].contractor_name || '—';
  const anyMissed = phases.some(p => p._isMissed);

  if (phases.length === 1) {
    const p = phases[0];
    const dateStr = fmtDate(p.scheduled_date);
    if (p._isMissed) {
      return `<div style="display:flex; flex-direction:column; gap:2px">
        <span class="eq-sched-missed-pill">⚠ PM NOT DONE</span>
        <span style="font-size:11px; color:var(--nx-faint); font-family:'JetBrains Mono', monospace">${esc(contractor)} · ${esc(dateStr)}</span>
      </div>`;
    }
    return `<div style="display:flex; flex-direction:column; gap:2px">
      <span style="font-size:14px; color:var(--nx-text)">${esc(contractor)}</span>
      <span style="font-size:11px; color:var(--nx-faint); font-family:'JetBrains Mono', monospace">${esc(dateStr)}${p.phase_label ? ' · ' + esc(p.phase_label) : ''}</span>
    </div>`;
  }

  // Multi-phase
  const phaseLines = phases.map(p => {
    const cls = p._isMissed ? 'eq-sched-missed-line' : '';
    const dateStr = fmtDate(p.scheduled_date);
    return `<span class="${cls}" style="font-size:11px; color:${p._isMissed ? '#e08585' : 'var(--nx-faint)'}; font-family:'JetBrains Mono', monospace">P${p.phase}: ${esc(dateStr)}${p.phase_label ? ' · ' + esc(p.phase_label) : ''}</span>`;
  }).join('');

  return `<div style="display:flex; flex-direction:column; gap:2px">
    ${anyMissed ? '<span class="eq-sched-missed-pill">⚠ PHASE MISSED</span>' : ''}
    <span style="font-size:14px; color:var(--nx-text)">${esc(contractor)}</span>
    ${phaseLines}
  </div>`;
}

/* Inject styles for schedule UI — contractor picker, phase rows,
   flashing missed pill. */
(function injectScheduleStyles() {
  if (typeof document === 'undefined' || document.getElementById('eq-sched-styles')) return;
  const s = document.createElement('style');
  s.id = 'eq-sched-styles';
  s.textContent = `
    .eq-sched-section { padding: 12px 16px 4px; }
    .eq-sched-section-label {
      font-size: 10px; letter-spacing: 1.2px; color: var(--nx-faint);
      text-transform: uppercase; margin-bottom: 8px;
    }
    .eq-sched-contractors {
      display: flex; flex-direction: column; gap: 6px;
      max-height: 200px; overflow-y: auto;
    }
    .eq-sched-contractor-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      color: var(--nx-text); cursor: pointer; text-align: left;
      font-size: 14px;
    }
    .eq-sched-contractor-row:hover { background: rgba(212,164,78,0.06); border-color: rgba(212,164,78,0.3); }
    .eq-sched-contractor-row.is-selected {
      background: rgba(212,164,78,0.12);
      border-color: var(--nx-gold);
      color: var(--nx-gold);
    }
    .eq-sched-check { color: var(--nx-gold); }
    .eq-sched-add-contractor {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 12px;
      background: transparent;
      border: 1px dashed rgba(212,164,78,0.3);
      border-radius: 8px;
      color: var(--nx-gold); cursor: pointer; text-align: left;
      font-size: 13px;
    }
    .eq-sched-empty { padding: 12px; text-align: center; color: var(--nx-faint); font-size: 13px; }

    .eq-sched-phases { display: flex; flex-direction: column; gap: 10px; }
    .eq-sched-phase-row {
      display: flex; flex-direction: column; gap: 6px;
      padding: 10px; background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
    }
    .eq-sched-phase-head { display: flex; justify-content: space-between; align-items: center; }
    .eq-sched-phase-num { font-size: 11px; letter-spacing: 1px; color: var(--nx-gold); text-transform: uppercase; }
    .eq-sched-phase-del {
      width: 22px; height: 22px; border-radius: 50%;
      background: transparent; border: 1px solid rgba(196,68,68,0.3);
      color: #c44; cursor: pointer; font-size: 14px; line-height: 1;
    }
    .eq-sched-phase-date, .eq-sched-phase-label {
      width: 100%; padding: 8px 10px;
      background: rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      color: var(--nx-text); font-size: 13px;
    }
    .eq-sched-add-phase {
      margin-top: 8px; padding: 8px 12px;
      background: transparent;
      border: 1px dashed rgba(212,164,78,0.3);
      border-radius: 8px;
      color: var(--nx-gold); cursor: pointer; font-size: 13px;
      width: 100%;
    }

    /* Flashing red "PM NOT DONE" pill — propagates urgency. Uses CSS
       keyframes so it's pure presentation, no JS heartbeat needed. */
    .eq-sched-missed-pill {
      display: inline-flex; align-items: center; gap: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase;
      padding: 3px 8px; border-radius: 999px;
      background: rgba(196,68,68,0.18); color: #e08585;
      border: 1px solid rgba(196,68,68,0.5);
      align-self: flex-start;
      animation: eqSchedPulse 1.4s ease-in-out infinite;
    }
    @keyframes eqSchedPulse {
      0%, 100% { background: rgba(196,68,68,0.18); border-color: rgba(196,68,68,0.5); }
      50%      { background: rgba(196,68,68,0.36); border-color: rgba(196,68,68,0.85); }
    }
    .eq-sched-missed-line { font-weight: 600; }
  `;
  document.head.appendChild(s);
})();

/* ─── Hook into pm_log approval to auto-complete pm_schedules ──────── */

/* Called from approvePmLog after the pm_log is approved and the
   equipment_maintenance row is inserted. Tries to find a matching
   pm_schedules row and mark it 'completed'. Best-effort; failure
   doesn't block the main approval flow.

   Match criteria: same equipment, status='scheduled', and either
   same contractor_node_id OR scheduled_date within ±10 days of the
   service date. */
async function autoCompletePmSchedule(equipId, log, maintenanceId) {
  if (!NX.sb || !equipId || !log) return;
  try {
    const { data: candidates, error } = await NX.sb.from('pm_schedules')
      .select('*')
      .eq('equipment_id', equipId)
      .eq('status', 'scheduled');
    if (error || !candidates || !candidates.length) return;

    const serviceDate = log.service_date || log.pm_date;
    if (!serviceDate) return;

    // Find best match — prefer same contractor + closest date within 10d window
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const dayDiff = Math.abs(
        (new Date(c.scheduled_date) - new Date(serviceDate)) / 86400000
      );
      if (dayDiff > 10) continue;
      let score = dayDiff;
      // Contractor match knocks 100 off the score → essentially always wins
      if (log.contractor_node_id && c.contractor_node_id == log.contractor_node_id) score -= 100;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) return;

    await NX.sb.from('pm_schedules').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_via: log.review_status === 'auto_approved' ? 'auto_match' : 'admin_approve',
      completed_maintenance_id: maintenanceId || null,
      completed_pm_log_id: log.id,
      updated_at: new Date().toISOString(),
    }).eq('id', best.id);

    console.log('[equipment] auto-completed pm_schedule', best.id, 'via pm_log', log.id);
  } catch (e) {
    console.warn('[equipment] autoCompletePmSchedule:', e);
  }
}

/* ── End v18.23 additions ─────────────────────────────────────────── */

/* ── End v18.22 additions ─────────────────────────────────────────── */

/* ── End v18.20 additions ─────────────────────────────────────────── */

/* ── End v18.19 additions ─────────────────────────────────────────── */

/* ── End v18.18 additions ─────────────────────────────────────────── */

/* ─── Action / UI icons — Lucide line art ─────────────────────────────
   Used wherever the equipment module rendered emoji glyphs in UI
   chrome (bottom action bar, tab strip, page header). Emojis render
   as glossy raster on iOS, flat color on Android, monochrome on
   desktop — fights the editorial line-art family used everywhere
   else in NEXUS. SVG paths inherit currentColor and the parent's
   font-size, so they pick up theme accents automatically.
   
   Use via uiSvg('keyName', '1em') or uiSvg('keyName', '18px').      */
const ACTION_ICONS = {
  printer:    '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  phone:      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  ticket:     '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  settings:   '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  pen:        '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  brain:      '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>',
  sparkles:   '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  camera:     '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  qr:         '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  star:       '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  filledStar: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  document:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  documents:  '<path d="M14 4.272A2 2 0 0 1 13 6h-3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3a2 2 0 0 1-1-1.728"/><path d="M16 2H8a2 2 0 0 0-2 2v16"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="15" y2="15"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  close:      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  trash:      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  wrench:     '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.121 2.121 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  user:       '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  dollar:     '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  alert:      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check:      '<polyline points="20 6 9 17 4 12"/>',
  ban:        '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  clock:      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  hourglass:  '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  paperclip:  '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  link:       '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  note:       '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  receipt:    '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  shield:     '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  family:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  search:     '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  message:    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send:       '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  email:      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  building:   '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  crystal:    '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  rocket:     '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  whatsapp:   '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  arrowDown:  '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  arrowUp:    '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  refresh:    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
  moreH:      '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};
function uiSvg(key, size = '1em') {
  const path = ACTION_ICONS[key] || '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0">${path}</svg>`;
}

// All 8 equipment status states — matches what actually appears in the DB
// across cards, scans, and historical rows. The UI dropdown for assigning
// status is a SUBSET of these (see DROPDOWN_STATUSES below) — the other
// states get assigned by other flows (loan tracking, relocation tooling,
// QR-scan-with-not-found-here, etc).
const STATUSES = [
  { key: 'operational',   label: 'Operational',   color: 'var(--green)'  },
  { key: 'needs_service', label: 'Needs Service', color: 'var(--amber)'  },
  { key: 'down',          label: 'Down',          color: 'var(--red)'    },
  { key: 'broken',        label: 'Broken',        color: 'var(--red)'    },
  { key: 'missing',       label: 'Missing',       color: 'var(--purple)' },
  { key: 'loaned',        label: 'Loaned Out',    color: 'var(--blue)'   },
  { key: 'relocated',     label: 'Relocated',     color: 'var(--blue)'   },
  { key: 'retired',       label: 'Retired',       color: 'var(--muted)'  }
];
// What the dropdown selector shows when assigning status manually.
// Other states (missing/loaned/relocated/broken) are set by domain flows
// rather than being user-pickable from this dropdown.
const DROPDOWN_STATUSES = STATUSES.filter(s =>
  ['operational','needs_service','down','retired'].includes(s.key)
);
const RELATIONSHIP_TYPES = [
  { key: 'depends_on',     label: 'Depends on',     icon: '⬆' },
  { key: 'serves',         label: 'Serves',         icon: '⬇' },
  { key: 'connected_to',   label: 'Connected to',   icon: '⇄' },
  { key: 'feeds',          label: 'Feeds',          icon: '→' },
  { key: 'pairs_with',     label: 'Pairs with',     icon: '⇋' },
  { key: 'shares_circuit', label: 'Shares circuit', icon: '±' },
];
const ZEBRA_CONFIG = {
  dpi: 203,
  labelSizes: {
    '2x1': { width: 2, height: 1, widthDots: 406, heightDots: 203 },
    '2x2': { width: 2, height: 2, widthDots: 406, heightDots: 406 },
    '3x2': { width: 3, height: 2, widthDots: 609, heightDots: 406 },
    '4x2': { width: 4, height: 2, widthDots: 812, heightDots: 406 }
  }
};
const ZEBRA_BP_URL = 'http://localhost:9100';

// Module state
let equipment = [];
let activeFilter = { location: LOCATIONS[0], status: 'all', category: 'all', pm: 'all' };

// v18.22 — Top-level navigation state for the vendor-style location card UX.
//   mode='list'   — show the location card grid (no equipment yet)
//   mode='inside' — drilled into a single location's equipment list
//   mode='search' — universal search results (equipment + parts)
// activeLocation is the label of the currently-entered location.
// search holds the query string; sort controls card ordering.
let locationView = {
  mode: 'list',
  activeLocation: null,
  search: '',
  sort: 'attention', // 'attention' | 'count' | 'pm' | 'recent' | 'name' | 'custom'
  searchResults: null,
};

/* Sort + collapse state for the section-grouped list view.
   sortMode  — one of 'custom' | 'name' | 'pm' | 'status'
                 'custom' uses equipment.sort_order (drag-set / move-up /
                          move-down). default for everyone.
                 'name'   alphabetical by equipment name
                 'pm'     soonest PM date first (nulls last)
                 'status' down → needs_service → operational
   collapsedSections  — Set of section names the user has collapsed for
                        the current location. Persisted to localStorage
                        per-location so the SUERTE view remembers its
                        collapsed sections independently of ESTE.
*/
let sortMode = 'custom';
let collapsedSections = new Set();
const COLLAPSED_KEY_PREFIX = 'nexus.equipment.collapsed.';
const SORT_KEY_PREFIX      = 'nexus.equipment.sort.';

function _collapseKey() { return COLLAPSED_KEY_PREFIX + (activeFilter.location || 'all'); }
function _sortKey()     { return SORT_KEY_PREFIX     + (activeFilter.location || 'all'); }

function loadSectionState() {
  try {
    const raw = localStorage.getItem(_collapseKey());
    collapsedSections = new Set(raw ? JSON.parse(raw) : []);
  } catch (_) { collapsedSections = new Set(); }
  try {
    const sm = localStorage.getItem(_sortKey());
    sortMode = (sm && ['custom','name','pm','status'].includes(sm)) ? sm : 'custom';
  } catch (_) { sortMode = 'custom'; }
}
function saveCollapsedState() {
  try { localStorage.setItem(_collapseKey(), JSON.stringify([...collapsedSections])); } catch (_) {}
}
function saveSortMode() {
  try { localStorage.setItem(_sortKey(), sortMode); } catch (_) {}
}

/* Apply the current sortMode to a list of equipment rows.
   Returns a NEW array — never mutates input. Custom mode uses the
   numeric sort_order column (seeded 1000, 2000, 3000... by the
   migration so move-up/move-down can insert between using midpoints). */
function applySortMode(items) {
  const arr = [...items];
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  switch (sortMode) {
    case 'name':
      arr.sort(byName);
      break;
    case 'pm': {
      const FAR = '9999-12-31';
      arr.sort((a, b) => (a.next_pm_date || FAR).localeCompare(b.next_pm_date || FAR) || byName(a, b));
      break;
    }
    case 'status': {
      const rank = { down: 0, needs_service: 1, operational: 2 };
      arr.sort((a, b) => ((rank[a.status] ?? 9) - (rank[b.status] ?? 9)) || byName(a, b));
      break;
    }
    case 'custom':
    default:
      arr.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || byName(a, b));
      break;
  }
  return arr;
}

/* Group equipment rows by their .section field. Returns a Map of
   sectionName → items[], plus an ordered list of section names for
   stable rendering. Section order tracks the lowest sort_order in
   each group so Custom sort drives section order naturally — drag a
   piece of equipment to the top of the list and its section floats
   up too. For non-Custom sort modes, sections appear in alphabetical
   order with Uncategorized first. */
function groupBySection(items) {
  const groups = new Map();
  for (const e of items) {
    const sec = (e.section || '').trim();
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec).push(e);
  }
  let order;
  if (sortMode === 'custom') {
    // Section order = order of first item in each section (already sorted by sort_order)
    order = [];
    const seen = new Set();
    for (const e of items) {
      const sec = (e.section || '').trim();
      if (!seen.has(sec)) { seen.add(sec); order.push(sec); }
    }
  } else {
    // Sort modes other than custom — Uncategorized first, then alpha
    order = [...groups.keys()].sort((a, b) => {
      if (a === '' && b !== '') return -1;
      if (b === '' && a !== '') return 1;
      return a.localeCompare(b);
    });
  }
  return { groups, order };
}

/**
 * Two-level grouper: equipment.category as the OUTER bucket, equipment.section
 * as the INNER. Categories follow the canonical CATEGORIES array order so the
 * surface reads consistently across locations and sort modes (Refrigeration
 * always comes before HVAC, etc.). Inner-section order within each category
 * follows the same first-appearance vs alphabetical rule as the flat grouper
 * keyed off sortMode.
 *
 * Returns:
 *   { cats: Map<categoryKey, {
 *       items: [],                          // every row in this category
 *       byInner: Map<sectionName, items>,   // sub-buckets keyed by section
 *       innerOrder: [sectionName, …]        // sorted section order
 *     }>,
 *     order: [categoryKey, …]               // category render order
 *   }
 *
 * Equipment with a missing/null category is bucketed under 'other'. This
 * matches the implicit fallback used by buildListRow's catIcon call site —
 * the data shouldn't ever be missing in practice, but keeping the bucket
 * stable means a single bad row won't ghost into a phantom outer card.
 */
function groupByCategoryThenSection(items) {
  const cats = new Map();
  for (const e of items) {
    const cat = ((e.category || 'other').trim() || 'other');
    if (!cats.has(cat)) cats.set(cat, { items: [], byInner: new Map() });
    const bucket = cats.get(cat);
    bucket.items.push(e);
    const sec = (e.section || '').trim();
    if (!bucket.byInner.has(sec)) bucket.byInner.set(sec, []);
    bucket.byInner.get(sec).push(e);
  }
  // Outer category render order — canonical CATEGORIES list, only including
  // categories that actually have items. Unknown keys (schema drift) get
  // appended at the end so we don't silently drop data.
  const known = CATEGORIES.map(c => c.key);
  const presentUnknown = [...cats.keys()].filter(k => !known.includes(k));
  const order = [
    ...known.filter(k => cats.has(k)),
    ...presentUnknown,
  ];
  // Inner section order — per-category, follows sortMode rules.
  for (const [, bucket] of cats) {
    const firstAppearance = [];
    const seen = new Set();
    for (const e of bucket.items) {
      const sec = (e.section || '').trim();
      if (!seen.has(sec)) { seen.add(sec); firstAppearance.push(sec); }
    }
    if (sortMode === 'custom') {
      bucket.innerOrder = firstAppearance;
    } else {
      bucket.innerOrder = firstAppearance.slice().sort((a, b) => {
        if (a === '' && b !== '') return -1;
        if (b === '' && a !== '') return 1;
        return a.localeCompare(b);
      });
    }
  }
  return { cats, order };
}

// Collapse-state key helpers for the two-level grouper. Outer category
// keys are prefixed with "__cat:" so they can never collide with a
// user-typed section name. Inner keys are namespaced "<cat>::<section>"
// so the same section name appearing under two different categories
// (e.g. a "Bar" section under both Refrigeration and Beverage) gets two
// independent collapse states. Old flat-section keys still live in
// localStorage from the previous build — they're harmless leftovers
// that don't match any new key, and they get pruned on the next rename.
function _catCollapseKey(catKey)            { return `__cat:${catKey}`; }
function _innerCollapseKey(catKey, secName) { return `${catKey}::${secName}`; }

/* ════════════════════════════════════════════════════════════════════
   EQUIPMENT EVENT LOGGING
   ────────────────────────────────────────────────────────────────────
   Every equipment mutation that's worth seeing in a Timeline/Activity
   view writes a row here. The two read surfaces are:
     - per-equipment Timeline tab (detail view) — single equipment's
       full history, chronologically
     - global Equipment Activity log (per location) — every event
       across all equipment at the active restaurant
   Failures are logged but NEVER block the parent operation. Events
   are observability, not correctness — losing a single log row
   shouldn't make a status change fail.
   ════════════════════════════════════════════════════════════════════ */

async function logEquipmentEvent({ equipmentId, eventType, payload, location }) {
  if (!NX.sb || !equipmentId || !eventType) return;
  try {
    const user = (window.NX && NX.currentUser) || {};
    const actorUserId = (typeof user.id === 'number') ? user.id : null;
    const actorName   = user.name || null;
    // Resolve location from the equipment record if not provided so
    // every event is location-stamped (powers the global filter).
    let loc = location;
    if (!loc) {
      const eq = equipment.find(e => e.id === equipmentId);
      loc = eq && eq.location ? eq.location : null;
    }
    await NX.sb.from('equipment_events').insert({
      equipment_id: equipmentId,
      event_type: eventType,
      payload: payload || {},
      location: loc,
      actor_user_id: actorUserId,
      actor_name: actorName,
    });
  } catch (e) {
    console.warn('[equipment] logEquipmentEvent failed:', e);
  }
}

// v18.32 Phase 3b — expose logEquipmentEvent globally so callers in
// other modules (domain.js, log.js, daily-log.js) can record events
// without going through equipment.js's lazy-loaded module surface.
// The closure variable `equipment` is still used inside for optional
// location resolution; external callers should pass `location`
// explicitly when they have it on hand. This is a best-effort sink —
// failures are logged but don't propagate.
if (typeof window !== 'undefined' && window.NX) {
  window.NX.logEquipmentEvent = logEquipmentEvent;
}

/* ════════════════════════════════════════════════════════════════════
   ACTIVITY READ HELPERS — per-equipment + per-location
   ─────────────────────────────────────────────────────────────────── */

async function loadEquipmentEvents(equipmentId, { limit = 100, beforeOccurredAt = null } = {}) {
  if (!NX.sb || !equipmentId) return [];
  let q = NX.sb.from('equipment_events')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (beforeOccurredAt) q = q.lt('occurred_at', beforeOccurredAt);
  const { data, error } = await q;
  if (error) {
    console.warn('[equipment] loadEquipmentEvents:', error);
    return [];
  }
  return data || [];
}

/* Activity event categorization — used by both UIs (per-equipment +
   global) so labels and icons stay consistent. */
const ACTIVITY_TYPES = {
  status_change:    { label: 'Status',      group: 'status',    icon: 'refresh' },
  location_change:  { label: 'Move',        group: 'location',  icon: 'pin' },
  archived:         { label: 'Archived',    group: 'archive',   icon: 'archive' },
  restored:         { label: 'Restored',    group: 'archive',   icon: 'check' },
  pm_logged:        { label: 'Maintenance', group: 'pm',        icon: 'wrench' },
  fields_edited:    { label: 'Edit',        group: 'edit',      icon: 'edit' },
  note_added:       { label: 'Note',        group: 'note',      icon: 'note' },
  photo_replaced:   { label: 'Photo',       group: 'photo',     icon: 'camera' },
  created:          { label: 'Created',     group: 'create',    icon: 'plus' },
};

function activityIcon(eventType) {
  const cfg = ACTIVITY_TYPES[eventType];
  const iconName = cfg ? cfg.icon : 'dot';
  // uiSvg is the project-wide icon helper. Falls back gracefully if a
  // requested icon name isn't defined.
  try { return uiSvg(iconName, '14px'); } catch (_) { return ''; }
}

function activitySummary(ev) {
  const p = ev.payload || {};
  const eqName = p.equipment_name ? `<span class="eq-act-name">${esc(p.equipment_name)}</span> ` : '';
  switch (ev.event_type) {
    case 'status_change':
      return `${eqName}status: <b>${esc(p.from_label || p.from || '?')}</b> → <b>${esc(p.to_label || p.to || '?')}</b>`;
    case 'location_change': {
      const fromLoc  = p.from || '?';
      const fromArea = p.from_area ? ` · ${p.from_area}` : '';
      const toLoc    = p.to || '?';
      const toArea   = p.to_area ? ` · ${p.to_area}` : '';
      return `${eqName}moved: <b>${esc(fromLoc)}${esc(fromArea)}</b> → <b>${esc(toLoc)}${esc(toArea)}</b>`;
    }
    case 'archived':       return `${eqName}archived`;
    case 'restored':       return `${eqName}restored`;
    case 'pm_logged':      return `${eqName}maintenance logged${p.technician_name ? ` by ${esc(p.technician_name)}` : ''}`;
    case 'fields_edited':  return `${eqName}edited: ${esc((p.changed_fields || []).join(', '))}`;
    case 'note_added':     return `${eqName}note added`;
    case 'photo_replaced': return `${eqName}photo updated`;
    case 'created':        return `${eqName}equipment created`;
    default:               return `${eqName}${esc(ev.event_type)}`;
  }
}

function activityRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* Per-equipment Activity tab body — chronological list with no
   filtering (single equipment, scope is already narrow). */
function renderEquipmentActivity(eq, events) {
  if (!events || !events.length) {
    return `<div class="eq-empty-small">
      No activity logged yet.<br>
      Status changes, location moves, edits, and other changes
      will appear here as they happen.
    </div>`;
  }
  const rows = events.map(ev => {
    const cfg = ACTIVITY_TYPES[ev.event_type] || { label: ev.event_type, group: 'other' };
    const who = ev.actor_name ? ` · ${esc(ev.actor_name)}` : '';
    return `
      <div class="eq-act-row eq-act-row-${esc(cfg.group)}">
        <div class="eq-act-icon">${activityIcon(ev.event_type)}</div>
        <div class="eq-act-body">
          <div class="eq-act-summary">${activitySummary(ev)}</div>
          <div class="eq-act-meta">${esc(activityRelativeTime(ev.occurred_at))}${who}</div>
        </div>
      </div>
    `;
  }).join('');
  return `<div class="eq-act-list">${rows}</div>`;
}

/* ════════════════════════════════════════════════════════════════════
   GLOBAL EQUIPMENT ACTIVITY LOG — per-location subscreen
   ────────────────────────────────────────────────────────────────────
   Mirrors ordering's Transactions view. Pills filter event type,
   search filters by equipment name, time-grouped list, paginated.
   Same component pattern. Cleaning's eventual log can copy this
   shape verbatim.
   ════════════════════════════════════════════════════════════════════ */

const EQ_ACT_PAGE_SIZE = 50;
const EQ_ACT_PILLS = [
  { id: 'all',       label: 'All' },
  { id: 'status',    label: 'Status' },
  { id: 'location',  label: 'Moves' },
  { id: 'pm',        label: 'PMs' },
  { id: 'edit',      label: 'Edits' },
  { id: 'archive',   label: 'Archived' },
  { id: 'create',    label: 'Created' },
];
// Map pill group → which event_types it includes
const EQ_ACT_GROUP_TYPES = {
  all:      null,  // no filter
  status:   ['status_change'],
  location: ['location_change'],
  pm:       ['pm_logged'],
  edit:     ['fields_edited', 'note_added', 'photo_replaced'],
  archive:  ['archived', 'restored'],
  create:   ['created'],
};

let eqActState = {
  group: 'all',
  search: '',
  events: [],
  counts: {},
  loading: false,
  hasMore: true,
};

async function openEquipmentActivityLog() {
  closeEquipmentActivityLog();

  const overlay = document.createElement('div');
  overlay.className = 'eq-act-overlay';
  overlay.id = 'eqActOverlay';
  overlay.innerHTML = renderEqActShell();
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('is-open'));

  eqActState = { group: 'all', search: '', events: [], counts: {}, loading: false, hasMore: true };
  wireEqActOverlay(overlay);

  setEqActLoading(overlay, true);
  await Promise.all([
    loadEqActCounts(),
    loadEqActPage(false),
  ]);
  setEqActLoading(overlay, false);

  renderEqActPills(overlay);
  renderEqActList(overlay);
}

function closeEquipmentActivityLog() {
  const overlay = document.getElementById('eqActOverlay');
  if (overlay) {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 220);
  }
}

function renderEqActShell() {
  return `
    <div class="eq-act-backdrop"></div>
    <div class="eq-act-sheet">
      <header class="eq-act-header">
        <button class="eq-act-back" aria-label="Back" data-eqact-action="back">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="eq-act-title-wrap">
          <h2 class="eq-act-title">Equipment Activity</h2>
          <span class="eq-act-loc-label">${esc(activeFilter.location || '')}</span>
        </div>
      </header>
      <div class="eq-act-pills" id="eqActPills"></div>
      <div class="eq-act-search-wrap">
        <input type="search" class="eq-act-search" id="eqActSearch" placeholder="Search equipment name…" autocomplete="off" spellcheck="false" inputmode="search">
      </div>
      <div class="eq-act-list-wrap" id="eqActList">
        <div class="eq-act-loading">Loading activity…</div>
      </div>
    </div>
  `;
}

function setEqActLoading(overlay, isLoading) {
  eqActState.loading = isLoading;
  const list = overlay.querySelector('#eqActList');
  if (list) list.classList.toggle('is-loading', isLoading);
}

async function loadEqActCounts() {
  if (!NX.sb) return;
  const loc = activeFilter.location;
  const base = () => NX.sb.from('equipment_events').select('id', { count: 'exact', head: true }).eq('location', loc);
  try {
    const queries = [base()];
    for (const pill of EQ_ACT_PILLS.slice(1)) {
      const types = EQ_ACT_GROUP_TYPES[pill.id];
      queries.push(types && types.length ? base().in('event_type', types) : base());
    }
    const results = await Promise.all(queries);
    eqActState.counts = {};
    EQ_ACT_PILLS.forEach((p, i) => {
      eqActState.counts[p.id] = results[i].count || 0;
    });
  } catch (e) {
    console.error('[equipment] loadEqActCounts:', e);
  }
}

async function loadEqActPage(append) {
  if (!NX.sb) return;
  const loc = activeFilter.location;
  let q = NX.sb.from('equipment_events')
    .select('*')
    .eq('location', loc)
    .order('occurred_at', { ascending: false })
    .limit(EQ_ACT_PAGE_SIZE);

  const types = EQ_ACT_GROUP_TYPES[eqActState.group];
  if (types && types.length) q = q.in('event_type', types);

  if (append && eqActState.events.length) {
    const last = eqActState.events[eqActState.events.length - 1];
    if (last.occurred_at) q = q.lt('occurred_at', last.occurred_at);
  }

  try {
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    eqActState.events = append ? [...eqActState.events, ...rows] : rows;
    eqActState.hasMore = rows.length === EQ_ACT_PAGE_SIZE;
  } catch (e) {
    console.error('[equipment] loadEqActPage:', e);
  }
}

function renderEqActPills(overlay) {
  const el = overlay.querySelector('#eqActPills');
  if (!el) return;
  el.innerHTML = EQ_ACT_PILLS.map(p => {
    const count = eqActState.counts[p.id] != null ? eqActState.counts[p.id] : '';
    const active = eqActState.group === p.id;
    return `
      <button class="eq-act-pill${active ? ' active' : ''}" data-eqact-group="${esc(p.id)}">
        <span>${esc(p.label)}</span>
        ${count !== '' ? `<span class="eq-act-pill-count">${count}</span>` : ''}
      </button>
    `;
  }).join('');
}

function renderEqActList(overlay) {
  const el = overlay.querySelector('#eqActList');
  if (!el) return;

  const search = (eqActState.search || '').toLowerCase().trim();
  const filtered = !search ? eqActState.events : eqActState.events.filter(ev => {
    const nm = ((ev.payload && ev.payload.equipment_name) || '').toLowerCase();
    const eq = equipment.find(e => e.id === ev.equipment_id);
    const fallbackNm = (eq && eq.name || '').toLowerCase();
    return nm.includes(search) || fallbackNm.includes(search);
  });

  if (!filtered.length && !eqActState.loading) {
    el.innerHTML = `<div class="eq-act-empty">${search ? 'No activity matches your search.' : 'No activity logged yet at this location.'}</div>`;
    return;
  }

  // Time bucketing — same pattern as ordering's Transactions
  const bucketOf = ts => {
    if (!ts) return 'older';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'today';
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
    const diff = (now - d) / 86400000;
    if (diff < 7)  return 'thisweek';
    if (diff < 30) return 'thismonth';
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `month:${d.getFullYear()}-${mon}`;
  };
  const bucketLabel = b => {
    if (b === 'today') return 'TODAY';
    if (b === 'yesterday') return 'YESTERDAY';
    if (b === 'thisweek') return 'EARLIER THIS WEEK';
    if (b === 'thismonth') return 'EARLIER THIS MONTH';
    if (b.startsWith('month:')) {
      const [, ym] = b.split(':');
      const [year, mon] = ym.split('-');
      return `${mon.toUpperCase()} ${year}`;
    }
    return 'OLDER';
  };

  let lastBucket = null;
  const rowsHTML = filtered.map(ev => {
    const cfg = ACTIVITY_TYPES[ev.event_type] || { group: 'other' };
    const bucket = bucketOf(ev.occurred_at);
    let dividerHTML = '';
    if (bucket !== lastBucket) {
      dividerHTML = `<div class="eq-act-divider">${esc(bucketLabel(bucket))}</div>`;
      lastBucket = bucket;
    }
    const who = ev.actor_name ? ` · ${esc(ev.actor_name)}` : '';
    return `${dividerHTML}
      <button class="eq-act-row eq-act-row-${esc(cfg.group)} eq-act-row-clickable" data-eqact-equip-id="${esc(ev.equipment_id)}">
        <div class="eq-act-icon">${activityIcon(ev.event_type)}</div>
        <div class="eq-act-body">
          <div class="eq-act-summary">${activitySummary(ev)}</div>
          <div class="eq-act-meta">${esc(activityRelativeTime(ev.occurred_at))}${who}</div>
        </div>
        <div class="eq-act-arrow" aria-hidden="true">›</div>
      </button>`;
  }).join('');

  const moreHTML = eqActState.hasMore && !search
    ? `<button class="eq-act-load-more" type="button" data-eqact-action="load-more">Load more</button>`
    : (eqActState.events.length && !search && !eqActState.hasMore
        ? `<div class="eq-act-end">— end of activity —</div>`
        : '');

  el.innerHTML = rowsHTML + moreHTML;

  // Wire row clicks → open that equipment's detail
  el.querySelectorAll('.eq-act-row-clickable').forEach(r => {
    r.addEventListener('click', () => {
      const eqId = r.dataset.eqactEquipId;
      if (!eqId) return;
      closeEquipmentActivityLog();
      // Small delay so the activity overlay finishes its slide-out
      // before the detail overlay slides in — feels less stacked.
      setTimeout(() => openDetail(eqId), 220);
    });
  });

  el.querySelector('[data-eqact-action="load-more"]')?.addEventListener('click', async () => {
    const btn = el.querySelector('[data-eqact-action="load-more"]');
    if (btn) btn.textContent = 'Loading…';
    setEqActLoading(overlay, true);
    await loadEqActPage(true);
    setEqActLoading(overlay, false);
    renderEqActList(overlay);
  });
}

function wireEqActOverlay(overlay) {
  overlay.querySelector('.eq-act-backdrop')?.addEventListener('click', closeEquipmentActivityLog);
  overlay.querySelector('[data-eqact-action="back"]')?.addEventListener('click', closeEquipmentActivityLog);

  overlay.addEventListener('click', async e => {
    const pill = e.target.closest('[data-eqact-group]');
    if (!pill || !overlay.contains(pill)) return;
    const newGroup = pill.dataset.eqactGroup;
    if (newGroup === eqActState.group) return;
    eqActState.group = newGroup;
    eqActState.events = [];
    eqActState.hasMore = true;
    renderEqActPills(overlay);
    const list = overlay.querySelector('#eqActList');
    if (list) list.innerHTML = `<div class="eq-act-loading">Loading…</div>`;
    setEqActLoading(overlay, true);
    await loadEqActPage(false);
    setEqActLoading(overlay, false);
    renderEqActList(overlay);
  });

  const search = overlay.querySelector('#eqActSearch');
  if (search) {
    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        eqActState.search = search.value;
        renderEqActList(overlay);
      }, 150);
    });
  }
}
let viewMode = 'list';          // 'list' | 'grid'
let currentEquipId = null;
let searchQuery = '';
let zebraBrowserPrintLoaded = false;


/* ════════════════════════════════════════════════════════════════════════════
   2. CORE — init, load, UI skeleton, list/grid render
   ════════════════════════════════════════════════════════════════════════════ */

async function init() {
  // Check for QR scan on load (?equip=eq_xxxxx)
  const params = new URLSearchParams(window.location.search);
  const equipParam = params.get('equip');

  // v18.18 — load user-created categories before loadEquipment so any
  // category-keyed render path uses the live list rather than the
  // hardcoded fallback. Awaiting this is cheap (single small query)
  // and prevents a "categories shift after first paint" jump.
  await loadCategoriesFromDB();
  await loadLocationsFromDB();
  await loadEquipment();
  await loadPmSchedules();
  buildUI();

  if (equipParam) {
    const eq = equipment.find(e => e.qr_code === equipParam);
    if (eq) {
      // v4: toast confirmation so the user sees the app is navigating to the
      // scanned item — silent navigation previously left people wondering if
      // the tap "did anything."
      NX.toast && NX.toast(`Opening ${eq.name}…`, 'info', 2200);
      document.querySelector('.nav-tab[data-view="equipment"]')?.click();
      document.querySelector('.bnav-btn[data-view="equipment"]')?.click();
      setTimeout(() => openDetail(eq.id), 300);
      const url = new URL(window.location.href);
      url.searchParams.delete('equip');
      window.history.replaceState({}, '', url);
    } else {
      // v4: equipment with that QR code not found — surface rather than silently ignoring
      NX.toast && NX.toast(`QR code ${equipParam} not recognized`, 'warn', 4000);
      const url = new URL(window.location.href);
      url.searchParams.delete('equip');
      window.history.replaceState({}, '', url);
    }
  }
}

async function loadEquipment() {
  try {
    // Load equipment + manufacturers + open issues in parallel.
    // The manufacturers and issues calls are best-effort: if the table
    // doesn't exist yet (pre-migration) the function returns [] silently
    // and rendering falls back to the legacy category-icon path.
    const [equipResult] = await Promise.all([
      NX.sb.from('equipment_with_stats')
        .select('*')
        .order('location', { ascending: true })
        .order('name', { ascending: true }),
      loadManufacturers(true).catch(() => []),
    ]);
    if (equipResult.error) throw equipResult.error;
    equipment = equipResult.data || [];
  } catch (e) {
    console.error('[Equipment] Load failed, trying base table:', e);
    try {
      const { data } = await NX.sb.from('equipment').select('*').order('name');
      equipment = data || [];
    } catch (e2) {
      console.error('[Equipment] Full load failed:', e2);
      equipment = [];
    }
  }

  // v18.22-fix3 — equipment_with_stats is a VIEW that pre-dates the
  // last_pm_date column. Without this patch the UI shows "Never logged"
  // even after an UPDATE successfully writes the value. Same applies
  // to any other column added after the view was created.
  // Cheap follow-up SELECT to back-fill last_pm_date from the base
  // table so the lifecycle card / progress bar see real values.
  if (equipment && equipment.length) {
    const needsPatch = !('last_pm_date' in equipment[0]);
    if (needsPatch) {
      try {
        const ids = equipment.map(e => e.id);
        const { data, error } = await NX.sb.from('equipment')
          .select('id, last_pm_date')
          .in('id', ids);
        if (!error && data) {
          const map = Object.create(null);
          for (const r of data) map[r.id] = r.last_pm_date;
          for (const eq of equipment) {
            eq.last_pm_date = map[eq.id] || null;
          }
          console.log('[Equipment] patched last_pm_date for', data.length, 'rows');
        }
      } catch (patchErr) {
        console.warn('[Equipment] last_pm_date patch failed:', patchErr);
      }
    }
  }

  // Attach the most recent open issue to each equipment row so the
  // status pill can reflect lifecycle state. Done as a follow-up call
  // so a missing equipment_issues table doesn't break the main load.
  try {
    if (equipment && equipment.length) {
      const ids = equipment.map(e => e.id);
      const issueMap = await loadOpenIssuesByEquipment(ids);
      for (const eq of equipment) {
        eq._openIssue = issueMap[eq.id] || null;
      }
    }
  } catch (e) {
    console.warn('[Equipment] Could not attach open issues:', e.message || e);
  }
}

function buildUI() {
  const view = document.getElementById('equipmentView');
  if (!view) return;

  // Apply pending filter intent from elsewhere (e.g., home dashboard
  // PM-Due stat tap). Cleared after apply so it doesn't stick between
  // view switches.
  if (NX.equipmentFilterIntent) {
    Object.assign(activeFilter, NX.equipmentFilterIntent);
    NX.equipmentFilterIntent = null;
    // If we got an intent for a specific location, also enter it.
    if (activeFilter.location && activeFilter.location !== 'all' && LOCATIONS.includes(activeFilter.location)) {
      locationView.mode = 'inside';
      locationView.activeLocation = activeFilter.location;
    }
  }

  // v18.22 — top-level routing: location card list vs inside-location view
  if (locationView.mode === 'list') {
    view.innerHTML = renderLocationListView();
    wireLocationListView();
    return;
  }

  // Inside a location — keep the existing tools row, search, filters,
  // and list, but replace the pill bar with a back chevron + location
  // title. activeFilter.location is set to locationView.activeLocation
  // so all existing filter logic continues to work unchanged.
  activeFilter.location = locationView.activeLocation;
  const activeLoc = LOCATION_META.find(l => l.label === locationView.activeLocation) || { label: locationView.activeLocation };

  view.innerHTML = `
    <div class="eq-header">
      <div class="eq-inside-loc-header">
        <button class="eq-inside-back" id="eqLocationBack" aria-label="Back to locations" type="button">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="ord-vendor-avatar eq-inside-avatar"${activeLoc.photo_url ? ` style="background-image:url('${esc((activeLoc.photo_url || '').replace(/'/g, '%27'))}'); background-size:cover; background-position:center; color:transparent"` : ` style="--avatar-hue:${(activeLoc.avatar_hue != null) ? activeLoc.avatar_hue : hashLocationHue(activeLoc.label)};"`}>${activeLoc.photo_url ? '' : esc((activeLoc.label || '?').trim().charAt(0).toUpperCase())}</span>
        <h2 class="eq-inside-loc-title">${esc(activeLoc.label)}</h2>
      </div>

      <div class="eq-actions eq-actions-row">
        <button class="eq-btn eq-btn-primary eq-ai-create-btn" id="eqAiCreateBtn" title="AI create equipment from photo or description"><span class="eq-action-icon">${uiSvg('sparkles', '14px')}</span> AI Create</button>
        <button class="eq-btn eq-btn-secondary eq-zebra-header-btn" id="eqZebraHeaderBtn" title="Print labels on Zebra printer">Zebra</button>
        <button class="eq-btn eq-btn-secondary" id="eqPrintQRs" title="Print QR sticker sheet">${uiSvg('qr', '14px')} QR Sheet</button>
        <button class="eq-btn eq-btn-secondary" id="eqExportResQ" title="Export this location's equipment as a CSV ready for ResQ's bulk import">→ ResQ</button>
        <button class="eq-btn eq-btn-secondary" id="eqExportResQTemplate" title="TEMP: export ALL equipment (every location) as ResQ's .xlsx import template">→ ResQ XLSX</button>
        <button class="eq-btn eq-btn-secondary" id="eqAddBtn">+ Manual</button>
      </div>

      <!-- Expanding AI panel — the header "AI Create" button reveals these
           four methods inline (no separate modal). -->
      <div class="eq-ai-expand" id="eqAiExpand" hidden>
        <div class="eq-ai-expand-title">${uiSvg('sparkles','13px')} Let AI handle the data entry — pick a method</div>
        <div class="eq-ai-expand-grid">
          <button class="eq-ai-x" data-ai-method="describe">
            <span class="eq-ai-x-ic">${uiSvg('message','20px')}</span>
            <span class="eq-ai-x-txt"><b>Describe It</b><small>Type or paste details in plain language</small></span>
          </button>
          <button class="eq-ai-x" data-ai-method="photo">
            <span class="eq-ai-x-ic">${uiSvg('camera','20px')}</span>
            <span class="eq-ai-x-txt"><b>Photo of Unit</b><small>AI identifies make/model from a photo</small></span>
          </button>
          <button class="eq-ai-x" data-ai-method="bulk">
            <span class="eq-ai-x-ic">${uiSvg('building','20px')}</span>
            <span class="eq-ai-x-txt"><b>Scan Whole Room</b><small>Adds every piece it sees at once</small></span>
          </button>
          <button class="eq-ai-x" data-ai-method="dataplate">
            <span class="eq-ai-x-ic">${uiSvg('qr','20px')}</span>
            <span class="eq-ai-x-txt"><b>Scan Data Plate</b><small>Exact model / serial / specs</small></span>
          </button>
        </div>
      </div>

      <div class="eq-tools-row" id="eqToolsRow">
        <button class="eq-tool-btn" id="eqToolWorkOrders" title="View all open work orders">
          <span class="eq-tool-icon">${uiSvg('wrench', '14px')}</span>
          <span class="eq-tool-label">Work Orders</span>
        </button>
        <button class="eq-tool-btn" id="eqToolContractors" title="Manage contractors">
          <span class="eq-tool-icon">${uiSvg('user', '14px')}</span>
          <span class="eq-tool-label">Contractors</span>
        </button>
        <button class="eq-tool-btn" id="eqToolParts" title="Browse parts library">
          <span class="eq-tool-icon">${uiSvg('settings', '14px')}</span>
          <span class="eq-tool-label">Parts</span>
        </button>
        <button class="eq-tool-btn" id="eqToolAnalytics" title="Fleet intelligence">
          <span class="eq-tool-icon">${uiSvg('brain', '14px')}</span>
          <span class="eq-tool-label">Analytics</span>
        </button>
        <button class="eq-tool-btn" id="eqToolBrands" title="Brand library">
          <span class="eq-tool-icon">${uiSvg('star', '14px')}</span>
          <span class="eq-tool-label">Brands</span>
        </button>
        <button class="eq-tool-btn" id="eqToolCategories" title="Add/edit equipment categories">
          <span class="eq-tool-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></span>
          <span class="eq-tool-label">Categories</span>
        </button>
      </div>

      <div class="eq-search-row">
        <input type="text" class="eq-search" id="eqSearch" placeholder="Search equipment, model, serial...">
        <div class="eq-view-toggle">
          <button class="eq-view-btn ${viewMode==='list'?'active':''}" data-mode="list" title="List view">${uiSvg("documents","16px")}</button>
          <button class="eq-view-btn ${viewMode==='grid'?'active':''}" data-mode="grid" title="Grid view"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>
        </div>
      </div>

      <div class="eq-filters">
        <div class="eq-filter-group">
          <span class="eq-filter-label">Status:</span>
          ${['all', ...STATUSES.map(s=>s.key)].map(s => {
            const label = s === 'all' ? 'All' : STATUSES.find(x=>x.key===s).label;
            return `<button class="eq-chip ${activeFilter.status===s?'active':''}" data-filter="status" data-value="${s}">${label}</button>`;
          }).join('')}
        </div>
        <div class="eq-filter-group">
          <span class="eq-filter-label">PM:</span>
          <button class="eq-chip ${activeFilter.pm==='all'?'active':''}" data-filter="pm" data-value="all">All</button>
          <button class="eq-chip ${activeFilter.pm==='overdue'?'active':''}" data-filter="pm" data-value="overdue">Overdue</button>
          <button class="eq-chip ${activeFilter.pm==='soon'?'active':''}" data-filter="pm" data-value="soon">Due ≤14d</button>
        </div>
        <div class="eq-filter-group">
          <span class="eq-filter-label">Health bars:</span>
          ${renderHealthBarChooser()}
        </div>
        <div class="eq-filter-group">
          <span class="eq-filter-label">Show:</span>
          <button class="eq-chip ${(activeFilter.archived||'active')==='active'?'active':''}" data-filter="archived" data-value="active">Active</button>
          <button class="eq-chip ${activeFilter.archived==='only'?'active':''}" data-filter="archived" data-value="only">Archived</button>
          <button class="eq-chip ${activeFilter.archived==='all'?'active':''}" data-filter="archived" data-value="all">All</button>
        </div>
        <div class="eq-filter-group">
          <span class="eq-filter-label">Retired:</span>
          <!-- Toggle: retired units are hidden from the mixed "all" view by
               default; flip this to fold them back in. data-value renders as the
               OPPOSITE of the current state so the shared chip handler toggles. -->
          <button class="eq-chip ${activeFilter.showRetired?'active':''}" data-filter="showRetired" data-value="${activeFilter.showRetired?'':'1'}">${activeFilter.showRetired?'Shown':'Hidden'}</button>
        </div>
      </div>

      <div class="eq-stats" id="eqStats"></div>
    </div>

    <div class="eq-list" id="eqList"></div>
  `;

  // Wire the back button — return to location list
  document.getElementById('eqLocationBack')?.addEventListener('click', exitLocation);

  // Wire header buttons
  // AI Create — expand the inline panel instead of popping a modal.
  (() => {
    const aiBtn = document.getElementById('eqAiCreateBtn');
    const aiExpand = document.getElementById('eqAiExpand');
    if (!aiBtn || !aiExpand) return;
    aiBtn.addEventListener('click', () => {
      const isClosed = aiExpand.hasAttribute('hidden');
      if (isClosed) {
        aiExpand.removeAttribute('hidden');
        requestAnimationFrame(() => aiExpand.classList.add('open'));
        aiBtn.classList.add('expanded');
      } else {
        aiExpand.classList.remove('open');
        aiBtn.classList.remove('expanded');
        setTimeout(() => aiExpand.setAttribute('hidden', ''), 260);
      }
    });
    aiExpand.querySelectorAll('[data-ai-method]').forEach(b => {
      b.addEventListener('click', () => {
        aiExpand.classList.remove('open');
        aiBtn.classList.remove('expanded');
        setTimeout(() => aiExpand.setAttribute('hidden', ''), 260);
        const m = b.dataset.aiMethod;
        if (m === 'describe') openDescribeDialog();
        else if (m === 'photo') photoIdentify();
        else if (m === 'bulk') bulkIdentify();
        else if (m === 'dataplate') scanDataPlate(null);
      });
    });
  })();
  document.getElementById('eqZebraHeaderBtn').addEventListener('click', printZebraBatch);
  document.getElementById('eqAddBtn').addEventListener('click', () => openEditModal(null));
  document.getElementById('eqPrintQRs').addEventListener('click', printQRSheet);
  document.getElementById('eqExportResQ').addEventListener('click', exportToResQ);
  document.getElementById('eqExportResQTemplate')?.addEventListener('click', exportResQTemplate);

  // Wire Tools row — workspaces for fleet-wide management
  document.getElementById('eqToolWorkOrders')?.addEventListener('click', () => {
    if (NX.openWorkOrders) NX.openWorkOrders();
    else if (window.NXRM?.view?.switchTo) NXRM.view.switchTo('issues');
  });
  document.getElementById('eqToolContractors')?.addEventListener('click', () => {
    if (typeof openContractors === 'function') openContractors();
    else NX.toast && NX.toast('Contractors not loaded yet', 'warn');
  });
  document.getElementById('eqToolParts')?.addEventListener('click', () => {
    if (typeof openParts === 'function') openParts();
    else NX.toast && NX.toast('Parts library not loaded yet', 'warn');
  });
  document.getElementById('eqToolAnalytics')?.addEventListener('click', () => {
    if (typeof openAnalytics === 'function') openAnalytics();
    else NX.toast && NX.toast('Analytics not loaded yet', 'warn');
  });
  document.getElementById('eqToolBrands')?.addEventListener('click', () => {
    if (typeof openBrandLibrary === 'function') openBrandLibrary();
    else NX.toast && NX.toast('Brand library not loaded yet', 'warn');
  });
  document.getElementById('eqToolCategories')?.addEventListener('click', () => {
    openCategoryManager();
  });
  document.getElementById('eqSearch').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  view.querySelectorAll('.eq-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      buildUI();
    });
  });

  view.querySelectorAll('.eq-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter[chip.dataset.filter] = chip.dataset.value;
      buildUI();
    });
  });

  // Health-bar chooser — toggle which cadence bars show (PM/Inspection/
  // Deep clean). toggleEqHealthBar persists the pref + re-renders the list;
  // we flip the pill's own .on class so the toolbar stays in sync.
  view.querySelectorAll('.eq-hb-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('on');
      toggleEqHealthBar(btn.dataset.hb);
    });
  });

  // Wire the location profile pills at the top of the equipment view.
  // Scoped to #eqLocationBar so it doesn't catch other .eq-loc-tab
  // buttons that might exist in modals/overlays elsewhere.
  view.querySelectorAll('#eqLocationBar .eq-loc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter[btn.dataset.filter] = btn.dataset.value;
      buildUI();
    });
  });

  renderList();
  renderStats();
}

/* ════════════════════════════════════════════════════════════════════
   SECTION MANAGEMENT — rename + move equipment between sections
   ────────────────────────────────────────────────────────────────────
   Sections aren't rows in a separate table; they're a string field
   on each equipment row. So "rename a section" = bulk-update every
   equipment row in that section. "Move to section" = update one
   row's .section. Sections naturally die when emptied (no row =
   no section appears in the list).
   ════════════════════════════════════════════════════════════════════ */

async function promptRenameSection(oldSec, categoryKey = null) {
  const oldLabel = oldSec || 'Uncategorized';
  const next = prompt(`Rename section "${oldLabel}":`, oldSec || '');
  if (next === null) return;                     // user cancelled
  const trimmed = (next || '').trim();
  if (trimmed === oldSec) return;                // unchanged

  // Reject merging into an existing non-empty section in v1 — too
  // easy to accidentally collapse two distinct groups together.
  // Scoped to the same category (when categoryKey is given) so the
  // user CAN have a "Bar" section under both Refrigeration and Beverage
  // — they're distinct buckets in the two-level grouper.
  const matchesCat = (e) => !categoryKey || ((e.category || 'other') === categoryKey);
  const targetExists = equipment.some(e =>
    (e.location === activeFilter.location || activeFilter.location === 'all') &&
    (e.section || '') === trimmed && trimmed !== oldSec &&
    matchesCat(e)
  );
  if (targetExists) {
    if (NX.toast) NX.toast(`A section called "${trimmed}" already exists in this category. Move items there manually if you meant to merge.`, 'warn', 3000);
    return;
  }

  try {
    // Bulk-update every equipment row in the old section at this location
    // AND in this category. Scoping to category prevents cross-category
    // bleed when the same section name lives under two different ones.
    const locFilter = activeFilter.location && activeFilter.location !== 'all'
      ? { location: activeFilter.location } : {};
    let q = NX.sb.from('equipment').update({ section: trimmed }).eq('section', oldSec);
    if (locFilter.location) q = q.eq('location', locFilter.location);
    if (categoryKey)        q = q.eq('category', categoryKey);
    const { error } = await q;
    if (error) throw error;

    // Update local cache.
    for (const e of equipment) {
      if ((!locFilter.location || e.location === locFilter.location)
          && (e.section || '') === oldSec
          && matchesCat(e)) {
        e.section = trimmed;
      }
    }
    // Carry over collapsed state under the new namespaced inner key.
    // Old key: "<cat>::<oldSec>" → New key: "<cat>::<trimmed>". When
    // trimmed is empty (rename to "Uncategorized") we just drop the
    // collapse — the empty inner section will likely be flat-rendered
    // anyway and won't have its own collapse target.
    if (categoryKey) {
      const oldKey = _innerCollapseKey(categoryKey, oldSec);
      const newKey = _innerCollapseKey(categoryKey, trimmed);
      if (collapsedSections.has(oldKey)) {
        collapsedSections.delete(oldKey);
        if (trimmed) collapsedSections.add(newKey);
        saveCollapsedState();
      }
    } else if (collapsedSections.has(oldSec)) {
      // Legacy fallback for the old flat-grouper key shape.
      collapsedSections.delete(oldSec);
      if (trimmed) collapsedSections.add(trimmed);
      saveCollapsedState();
    }
    renderList();
    if (NX.toast) NX.toast(`Renamed to "${trimmed || 'Uncategorized'}"`, 'info', 1400);
  } catch (e) {
    console.error('[equipment] rename section:', e);
    if (NX.toast) NX.toast('Failed to rename section', 'error');
  }
}

/* Move a single equipment row to a different section.
   Picks the largest sort_order in the target section and adds 1000
   so the moved item lands at the bottom. If no items in target, uses
   1000 as the baseline. */
async function moveEquipmentToSection(equipId, newSec) {
  const e = equipment.find(x => x.id === equipId);
  if (!e) return;
  const trimmed = (newSec || '').trim();
  if ((e.section || '') === trimmed) return;       // already there

  // Compute new sort_order = max + 1000 in target section
  const inTarget = equipment.filter(x =>
    x.location === e.location && (x.section || '') === trimmed
  );
  const maxSort = inTarget.reduce((m, x) => Math.max(m, x.sort_order || 0), 0);
  const newSort = maxSort + 1000;

  try {
    const { error } = await NX.sb.from('equipment')
      .update({ section: trimmed, sort_order: newSort })
      .eq('id', equipId);
    if (error) throw error;
    e.section = trimmed;
    e.sort_order = newSort;
    renderList();
    if (NX.toast) NX.toast(`Moved to "${trimmed || 'Uncategorized'}"`, 'info', 1200);
  } catch (err) {
    console.error('[equipment] move to section:', err);
    if (NX.toast) NX.toast('Failed to move', 'error');
  }
}

/* Picker dialog — list of existing sections + "New section..." option.
   Resolves with chosen section name or null if cancelled. */
function pickSection(currentSec, locationScope) {
  return new Promise(resolve => {
    // Collect distinct sections at this location
    const all = equipment
      .filter(e => !locationScope || e.location === locationScope)
      .map(e => (e.section || '').trim());
    const distinct = [...new Set(all)].sort((a, b) => {
      if (a === '' && b !== '') return -1;
      if (b === '' && a !== '') return 1;
      return a.localeCompare(b);
    });

    const overlay = document.createElement('div');
    overlay.className = 'eq-section-picker-backdrop';
    overlay.innerHTML = `
      <div class="eq-section-picker" role="dialog" aria-label="Move to section">
        <div class="eq-section-picker-head">
          <h3>Move to section</h3>
          <button class="eq-section-picker-close" type="button" aria-label="Cancel">×</button>
        </div>
        <ul class="eq-section-picker-list">
          ${distinct.map(s => `
            <li>
              <button type="button" class="eq-section-picker-item${s === currentSec ? ' is-current' : ''}" data-section="${esc(s)}">
                ${esc(s || 'Uncategorized')}
                ${s === currentSec ? '<span class="eq-section-picker-current">current</span>' : ''}
              </button>
            </li>
          `).join('')}
          <li>
            <button type="button" class="eq-section-picker-item is-new" data-action="new">
              + New section...
            </button>
          </li>
        </ul>
      </div>`;

    const cleanup = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
      resolve(val);
    };
    const escHandler = (e) => { if (e.key === 'Escape') cleanup(null); };
    document.addEventListener('keydown', escHandler);

    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
    overlay.querySelector('.eq-section-picker-close').addEventListener('click', () => cleanup(null));
    overlay.querySelectorAll('.eq-section-picker-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'new') {
          const name = prompt('New section name:');
          if (name === null) { cleanup(null); return; }
          const trimmed = (name || '').trim();
          if (!trimmed) { cleanup(null); return; }
          cleanup(trimmed);
        } else {
          cleanup(btn.dataset.section || '');
        }
      });
    });

    document.body.appendChild(overlay);
  });
}

/* Move an equipment row up or down within its current section by
   swapping sort_order with the adjacent sibling. */
async function moveEquipmentInSection(equipId, direction) {
  const e = equipment.find(x => x.id === equipId);
  if (!e) return;
  const sec = e.section || '';

  // Get all items in this section at this location, in current Custom order
  const siblings = equipment
    .filter(x => x.location === e.location && (x.section || '') === sec)
    .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (a.name || '').localeCompare(b.name || ''));

  const idx = siblings.findIndex(x => x.id === equipId);
  if (idx === -1) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings.length) return;   // already at edge

  const target = siblings[targetIdx];
  const aSort = e.sort_order || 0;
  const bSort = target.sort_order || 0;

  try {
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      NX.sb.from('equipment').update({ sort_order: bSort }).eq('id', e.id),
      NX.sb.from('equipment').update({ sort_order: aSort }).eq('id', target.id),
    ]);
    if (e1 || e2) throw (e1 || e2);
    e.sort_order = bSort;
    target.sort_order = aSort;
    // Force Custom mode so the user can SEE their reorder take effect
    if (sortMode !== 'custom') {
      sortMode = 'custom';
      saveSortMode();
    }
    renderList();
  } catch (err) {
    console.error('[equipment] move in section:', err);
    if (NX.toast) NX.toast('Failed to reorder', 'error');
  }
}

function renderStats() {
  const el = document.getElementById('eqStats');
  if (!el) return;
  const filtered = getFiltered();
  const down   = filtered.filter(e => e.status === 'down').length;
  const needs  = filtered.filter(e => e.status === 'needs_service').length;
  const pmDue  = filtered.filter(e => e.next_pm_date && new Date(e.next_pm_date) <= new Date(Date.now() + 14*86400000)).length;
  const totalCost = filtered.reduce((s, e) => s + (parseFloat(e.cost_this_year) || 0), 0);

  el.innerHTML = `
    <div class="eq-stat"><span class="eq-stat-v">${filtered.length}</span><span class="eq-stat-l">Units</span></div>
    ${down ? `<div class="eq-stat eq-stat-red"><span class="eq-stat-v">${down}</span><span class="eq-stat-l">Down</span></div>` : ''}
    ${needs ? `<div class="eq-stat eq-stat-amber"><span class="eq-stat-v">${needs}</span><span class="eq-stat-l">Needs Service</span></div>` : ''}
    ${pmDue ? `<div class="eq-stat eq-stat-blue"><span class="eq-stat-v">${pmDue}</span><span class="eq-stat-l">PM Due (14d)</span></div>` : ''}
    ${totalCost > 0 ? `<div class="eq-stat"><span class="eq-stat-v">$${Math.round(totalCost).toLocaleString()}</span><span class="eq-stat-l">YTD Repairs</span></div>` : ''}
  `;
}

function getFiltered() {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const in14d = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  return equipment.filter(e => {
    // Archive scope: default hides archived; "only" shows only archived;
    // other special values can extend later. Without this filter, soft-
    // deleted equipment stays mixed with active inventory.
    const archScope = (activeFilter.archived || 'active');
    if (archScope === 'active' && (e.archived_at || e.archived)) return false;
    if (archScope === 'only'   && !(e.archived_at || e.archived)) return false;
    if (activeFilter.location !== 'all' && e.location !== activeFilter.location) return false;
    if (activeFilter.status !== 'all' && e.status !== activeFilter.status) return false;
    // Retired units are hidden from the default "all" view — flip the Retired
    // toggle (activeFilter.showRetired) to fold them in, or reach them via the
    // Status → Retired chip (which sets status='retired' and bypasses this).
    if (!activeFilter.showRetired && activeFilter.status === 'all' && String(e.status || '').toLowerCase() === 'retired') return false;
    if (activeFilter.category !== 'all' && e.category !== activeFilter.category) return false;
    if (activeFilter.pm === 'overdue') {
      if (!e.next_pm_date) return false;
      if (e.next_pm_date >= todayIso) return false; // not overdue
    } else if (activeFilter.pm === 'soon') {
      if (!e.next_pm_date) return false;
      if (e.next_pm_date > in14d) return false;     // too far out
    }
    if (searchQuery) {
      const hay = [e.name, e.model, e.serial_number, e.manufacturer, e.area, e.notes].join(' ').toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });
}

function renderList() {
  const list = document.getElementById('eqList');
  if (!list) return;
  loadSectionState();          // re-load per-location prefs each render
  const filtered = getFiltered();
  renderStats();

  if (!filtered.length) {
    list.innerHTML = `
      <div class="eq-empty">
        <div class="eq-empty-icon">${uiSvg("wrench", "32px")}</div>
        <div class="eq-empty-title">No equipment yet</div>
        <div class="eq-empty-sub">Add your first piece of equipment to get started.</div>
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.openAICreator()">${uiSvg("sparkles", "13px")} AI Create</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.add()">+ Manual Add</button>
      </div>`;
    return;
  }

  list.className = 'eq-list eq-list-' + viewMode;

  if (viewMode === 'grid') {
    list.innerHTML = filtered.map(e => buildGridCard(e)).join('');
  } else {
    // Sort, then two-level group: outer = category (fixed enum), inner =
    // section (user-named text). Outer category cards are not renameable
    // since the category set is a closed enum — only inner sections
    // expose the rename pencil. When a category contains exactly one
    // un-named ("Uncategorized") inner section, we render the rows flat
    // inside the category card to avoid the redundant "Uncategorized"
    // sub-header that shows up when the user hasn't bothered naming
    // anything yet.
    const sorted = applySortMode(filtered);
    const { cats, order: catOrder } = groupByCategoryThenSection(sorted);

    // Sort mode picker — small pill bar above the list. Custom is
    // default. Other modes don't change the section grouping, just
    // the order of equipment cards within each section.
    const SORT_MODES = [
      { key: 'custom', label: 'Custom' },
      { key: 'name',   label: 'Name'   },
      { key: 'pm',     label: 'PM Date' },
      { key: 'status', label: 'Status' },
    ];
    const sortPickerHTML = `
      <div class="eq-sort-bar" role="tablist" aria-label="Sort equipment">
        <span class="eq-sort-bar-label">Sort:</span>
        ${SORT_MODES.map(m => `
          <button class="eq-sort-mode${sortMode === m.key ? ' active' : ''}" data-sort="${m.key}" role="tab" aria-selected="${sortMode === m.key ? 'true' : 'false'}">${m.label}</button>
        `).join('')}
      </div>`;

    const renderInnerSection = (catKey, sec, items) => {
      const innerKey = _innerCollapseKey(catKey, sec);
      const isInnerCollapsed = collapsedSections.has(innerKey);
      const safeSec = esc(sec);
      const safeKey = esc(innerKey);
      // Inner sections keep the existing rename + collapse machinery
      // but data-cat is now carried so the rename writes are scoped
      // to a single category — important when "Bar" exists under both
      // Refrigeration and Beverage and the user only wants to rename one.
      return `
        <section class="eq-section is-nested${isInnerCollapsed ? ' is-collapsed' : ''}" data-section="${safeSec}" data-cat="${esc(catKey)}" data-collapse-key="${safeKey}">
          <header class="eq-section-head" data-section="${safeSec}" data-cat="${esc(catKey)}" data-collapse-key="${safeKey}">
            <span class="eq-section-name" data-section="${safeSec}" data-cat="${esc(catKey)}" role="button" tabindex="0" aria-label="Rename section ${safeSec || 'Uncategorized'}">${esc(sec || 'Uncategorized')}</span>
            <span class="eq-section-count" aria-label="${items.length} item${items.length === 1 ? '' : 's'}">${items.length}</span>
            <button type="button" class="eq-section-rename" data-section="${safeSec}" data-cat="${esc(catKey)}" aria-label="Rename section">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button type="button" class="eq-section-collapse" data-collapse-key="${safeKey}" aria-expanded="${!isInnerCollapsed}" aria-label="${isInnerCollapsed ? 'Expand' : 'Collapse'} section">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </header>
          <div class="eq-section-body">
            <div class="eq-rows">
              ${items.map(e => buildListRow(e)).join('')}
            </div>
          </div>
        </section>
      `;
    };

    list.innerHTML = sortPickerHTML + catOrder.map(catKey => {
      const bucket = cats.get(catKey);
      if (!bucket || !bucket.items.length) return '';
      const catLabel = (CATEGORIES.find(c => c.key === catKey) || {}).label || (catKey || 'Other');
      const catCardKey = _catCollapseKey(catKey);
      const isCatCollapsed = collapsedSections.has(catCardKey);
      const innerSecs = bucket.innerOrder;
      // Render flat (no inner sub-headers) when the category has exactly
      // one inner section that's empty/unnamed — the inner "Uncategorized"
      // header would just be visual noise repeating the category name.
      const renderFlat = innerSecs.length === 1 && innerSecs[0] === '';

      return `
        <section class="eq-cat-section${isCatCollapsed ? ' is-collapsed' : ''}" data-cat="${esc(catKey)}">
          <header class="eq-cat-section-head" data-cat="${esc(catKey)}">
            <span class="eq-cat-section-icon" aria-hidden="true">${catIcon(catKey)}</span>
            <span class="eq-cat-section-name">${esc(catLabel)}</span>
            <span class="eq-cat-section-count" aria-label="${bucket.items.length} item${bucket.items.length === 1 ? '' : 's'}">${bucket.items.length}</span>
            <button type="button" class="eq-cat-section-collapse" data-cat="${esc(catKey)}" aria-expanded="${!isCatCollapsed}" aria-label="${isCatCollapsed ? 'Expand' : 'Collapse'} ${esc(catLabel)}">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </header>
          <div class="eq-cat-section-body">
            ${renderFlat
              ? `<div class="eq-rows">${bucket.items.map(e => buildListRow(e)).join('')}</div>`
              : innerSecs.map(sec => renderInnerSection(catKey, sec, bucket.byInner.get(sec) || [])).join('')
            }
          </div>
        </section>
      `;
    }).join('');

    // Wire sort mode picker
    list.querySelectorAll('.eq-sort-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.sort;
        if (next === sortMode) return;
        sortMode = next;
        saveSortMode();
        renderList();
      });
    });

    // Outer category collapse — chevron OR header tap (excluding inner
    // sections which have their own headers). The chevron handler stops
    // propagation so it doesn't double-fire with the body tap.
    list.querySelectorAll('.eq-cat-section-collapse').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cat = btn.dataset.cat || '';
        const key = _catCollapseKey(cat);
        if (collapsedSections.has(key)) collapsedSections.delete(key);
        else collapsedSections.add(key);
        saveCollapsedState();
        renderList();
      });
    });
    list.querySelectorAll('.eq-cat-section-head').forEach(head => {
      head.addEventListener('click', e => {
        // Don't toggle when an inner control was tapped.
        if (e.target.closest('.eq-cat-section-collapse')) return;
        const cat = head.dataset.cat || '';
        const key = _catCollapseKey(cat);
        if (collapsedSections.has(key)) collapsedSections.delete(key);
        else collapsedSections.add(key);
        saveCollapsedState();
        renderList();
      });
    });

    // Inner section collapse — chevron uses data-collapse-key, header tap
    // also derives from data-collapse-key so we don't have to re-build it.
    list.querySelectorAll('.eq-section .eq-section-collapse').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const key = btn.dataset.collapseKey || '';
        if (!key) return;
        if (collapsedSections.has(key)) collapsedSections.delete(key);
        else collapsedSections.add(key);
        saveCollapsedState();
        renderList();
      });
    });
    list.querySelectorAll('.eq-section .eq-section-head').forEach(head => {
      head.addEventListener('click', e => {
        if (e.target.closest('.eq-section-name, .eq-section-rename, .eq-section-collapse')) return;
        const key = head.dataset.collapseKey || '';
        if (!key) return;
        if (collapsedSections.has(key)) collapsedSections.delete(key);
        else collapsedSections.add(key);
        saveCollapsedState();
        renderList();
      });
    });

    // Wire rename — pencil button or tap on section name. Carries the
    // category key so renames stay scoped to a single category (a "Bar"
    // section under Refrigeration won't drag along a "Bar" under Beverage).
    const startRename = (oldSec, catKey) => promptRenameSection(oldSec, catKey);
    list.querySelectorAll('.eq-section .eq-section-rename').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        startRename(btn.dataset.section || '', btn.dataset.cat || null);
      });
    });
    list.querySelectorAll('.eq-section .eq-section-name').forEach(span => {
      span.addEventListener('click', e => {
        e.stopPropagation();
        startRename(span.dataset.section || '', span.dataset.cat || null);
      });
    });
  }

  // "View all activity →" — entry point to the global Equipment
  // Activity Log overlay. Always visible at the bottom of the list
  // so users can reach the canonical history surface from anywhere.
  list.insertAdjacentHTML('beforeend', `
    <button class="eq-act-link" id="eqActLink" type="button" aria-label="View equipment activity">
      <span>View all activity</span>
      <span class="eq-act-link-arrow" aria-hidden="true">→</span>
    </button>
  `);
  list.querySelector('#eqActLink')?.addEventListener('click', () => openEquipmentActivityLog());

  // Wire rows → detail (DELEGATED, bound once). The container #eqList is
  // stable across renders; only its innerHTML changes. Per-row binding
  // silently lost its handlers on every re-render/async populate, so direct
  // taps stopped opening the detail while other entry points (which call
  // openDetail directly) still worked. Delegation survives all re-renders.
  if (!list.__rowClickBound) {
    list.__rowClickBound = true;
    list.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-eq-id]');
      if (!el || !list.contains(el)) return;
      // Suppress the synthetic click that fires right after a long-press
      // opened the dial (timestamp window — a tap can never be permanently
      // blocked).
      if (Date.now() - lastLongPressFireAt < 700) return;
      // If a tap was already handled on pointerup (see onLongPressEnd), the
      // browser's trailing synthetic click would double-fire — skip it.
      if (Date.now() - lastTapHandledAt < 700) return;
      activateEquipmentRow(ev.target);
    });
  }


  // Inject per-row/card Zebra quick-print buttons (was equipment-ux.js)
  injectRowPrintButtons();

  // Wire long-press → expanding action dial. Idempotent — uses event
  // delegation so re-renders don't double-bind.
  wireEquipmentLongPress();
}

function buildListRow(e) {
  // Next-PM date for the row label: the real logged next_pm_date, or the
  // date projected one interval past the last logged PM. computePmCountdown
  // only yields a date when there's a real anchor (last_pm_date or
  // next_pm_date), so a unit with no PM history shows "—" instead of a date
  // fabricated from when it was entered into the app.
  const _pmcd = computePmCountdown(e);
  const _pmIso = e.next_pm_date || (_pmcd && _pmcd.nextDate) || null;
  const pm = _pmIso ? new Date(_pmIso + 'T00:00:00') : null;
  const pmOverdue = pm && pm < new Date();
  const pmSoon = pm && !pmOverdue && pm < new Date(Date.now() + 14 * 86400000);

  // PM date label — short form so it fits on the right edge of the
  // top line. "—" when no date is set; gold tint when soon; red when
  // overdue. Empty PM state is muted via a class so the dash doesn't
  // fight for attention with real dates.
  let pmLabel = '';
  let pmCls = 'eq-row-when-empty';
  if (pm) {
    pmLabel = pm.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (pmOverdue) pmCls = 'is-overdue';
    else if (pmSoon) pmCls = 'is-soon';
    else pmCls = '';
  }

  // Sub line: model + manufacturer + location/area, all consolidated into
  // one mono-formatted line. Gracefully degrades when any field is
  // missing.
  const subParts = [];
  if (e.model) subParts.push(esc(e.model));
  if (e.manufacturer && e.manufacturer !== e.model) subParts.push(esc(e.manufacturer));
  if (e.location) subParts.push(esc(e.location) + (e.area ? ' · ' + esc(e.area) : ''));
  const sub = subParts.join(' · ');

  // Avatar — photo if uploaded, otherwise a colored letter on a
  // hue-driven background. Same visual treatment as ordering's vendor
  // avatar so the two row systems read as one app. Hue is derived
  // deterministically from the equipment name so the same unit always
  // gets the same color across renders. Manufacturer logos and
  // category icons are reserved for the detail view where they have
  // room to breathe; in the row, simpler is better.
  let avatar;
  if (e.photo_url) {
    avatar = `<span class="eq-row-avatar eq-row-avatar-img" style="background-image:url('${escAttr(e.photo_url)}');" data-action="quick-photo" data-eq-id="${e.id}" title="Tap to replace photo"></span>`;
  } else {
    const letter = esc(((e.name || '?').trim().charAt(0) || '?').toUpperCase());
    // Stable string-hash → 0..359 hue. Bit-shifting keeps it int.
    let h = 0;
    const seed = String(e.name || e.id || '');
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(h) % 360;
    avatar = `<span class="eq-row-avatar" style="--avatar-hue:${hue};" data-action="quick-photo" data-eq-id="${e.id}" title="Tap to add photo">${letter}</span>`;
  }

  return `
    <div class="eq-row" data-eq-id="${e.id}">
      ${avatar}
      <div class="eq-row-main">
        <div class="eq-row-top">
          <div class="eq-row-name">${esc(e.name)}</div>
          ${warrantyShield(e)}
          <div class="eq-row-when ${pmCls}">${esc(pmLabel || '—')}</div>
        </div>
        ${sub ? `<div class="eq-row-meta"><span class="eq-row-sub">${sub}</span></div>` : ''}
        ${renderHealthBars(e, true) || renderPmProgressBar(e, true)}
      </div>
      <span class="eq-row-beacon" aria-hidden="true">${lifecycleStatusDot(e)}</span>
    </div>`;
}

// Service coverage for a unit, derived from ANY of the three provider
// mechanisms: current vendor link (service_vendor_id / repair_vendor_id),
// the retired node (service_contractor_node_id), or a plain typed name.
// `legacy` = covered, but with no vendor link yet → flag it to migrate.
function equipmentCoverage(e) {
  if (!e) return { pm:false, rp:false, label:'Uncovered', cls:'none', legacy:false };
  const pmVendor = !!e.service_vendor_id;
  const rpVendor = !!e.repair_vendor_id;
  const pmLegacy = !pmVendor && !!(e.service_contractor_node_id || e.service_contractor_name);
  const rpLegacy = !rpVendor && !!(e.repair_contractor_node_id || e.repair_contractor_name);
  const pm = pmVendor || pmLegacy;
  const rp = rpVendor || rpLegacy;
  let label = 'Uncovered', cls = 'none';
  if (pm && rp) { label = 'PM + Repair'; cls = 'both'; }
  else if (pm)  { label = 'PM only';     cls = 'pm'; }
  else if (rp)  { label = 'Repair only'; cls = 'repair'; }
  return { pm, rp, label, cls, legacy: (pm && pmLegacy) || (rp && rpLegacy) };
}

function buildGridCard(e) {
  const pm = e.next_pm_date ? new Date(e.next_pm_date) : null;
  const pmStr = pm ? pm.toLocaleDateString([], { month:'short', day:'numeric' }) : 'Not set';
  const health = e.health_score ?? 100;
  const healthColor = health >= 80 ? 'var(--green)' : health >= 50 ? 'var(--amber)' : 'var(--red)';

  return `
    <div class="eq-card" data-eq-id="${e.id}">
      <div class="eq-card-top">
        ${e.photo_url
          ? `<img src="${e.photo_url}" class="eq-card-photo">`
          : (e.manufacturer
              ? `<div class="eq-card-photo eq-card-photo-mfg">${manufacturerLogo(e, 'md')}</div>`
              : `<div class="eq-card-photo eq-card-photo-placeholder">${catIcon(e.category)}</div>`)}
        ${lifecycleStatusDot(e)}
        ${warrantyShield(e)}
      </div>
      <div class="eq-card-body">
        <div class="eq-card-title">${esc(e.name)}</div>
        <div class="eq-card-sub">${esc(e.location)}${e.area ? ' · ' + esc(e.area) : ''}</div>
        <div class="eq-card-meta">
          <span>${esc(e.manufacturer || '—')}</span>
          <span class="eq-health" style="color:${healthColor}">${health}%</span>
        </div>
        ${renderHealthBars(e, false) || `<div class="eq-card-pm">Next PM: ${pmStr}</div>`}
        ${(() => {
          const cov = equipmentCoverage(e);
          return `<div class="eq-card-coverage cov-${cov.cls}">${cov.cls === 'none' ? '○' : '✓'} ${cov.label}${cov.legacy ? '<span class="cov-legacy" title="Legacy contractor — not linked to a vendor yet">⚠</span>' : ''}</div>`;
        })()}
      </div>
    </div>`;
}


/* ════════════════════════════════════════════════════════════════════════════
   3. DETAIL — the one and only openDetail
   Combines what was in 4 separate wrappers (ai, p3, full-editor, p4) into
   a single linear function with clear sections.
   ════════════════════════════════════════════════════════════════════════════ */

async function openDetail(id) {
  let eq = equipment.find(e => e.id === id);
  if (!eq) {
    // Resilience: the in-memory list can be stale or mid-populate. Rather
    // than silently doing nothing (a card that won't open), fetch the row
    // directly and fold it in.
    try {
      const { data } = await NX.sb.from('equipment').select('*').eq('id', id).single();
      if (data) { eq = data; equipment.push(data); }
    } catch (e) { if (NX.debug) NX.debug('eq.openDetail.fetch', e); }
  }
  if (!eq) return;
  currentEquipId = id;

  // Parallel load: parts, maintenance, attachments, custom fields,
  // plus pending pm_logs (QR-submitted service logs awaiting admin
  // review). We fold pending logs into the timeline so they're
  // discoverable — admin can approve/reject inline instead of
  // hunting for a hidden review dashboard.
  // Also: if equipment has a service_contractor_node_id (maintenance) and/or
  // a repair_contractor_node_id, pull both contractor records so the overview
  // can show "SERVICED BY" / "REPAIRS BY" with their specialty tags and template
  // status. Avoids a second round trip after the modal renders. The fetcher
  // tolerates schema gaps (template cols, repair_contractor_node_id col) so
  // it keeps working before the migration is run.
  const fetchContractor = (nodeId) => {
    if (!nodeId) return Promise.resolve({ data: null });
    return NX.sb.from('nodes')
      .select('id, name, links, notes, tags, subject_template, body_template')
      .eq('id', nodeId)
      .maybeSingle()
      .then(r => {
        if (r.error && /column.*(subject_template|body_template).*does not exist/i.test(r.error.message || '')) {
          return NX.sb.from('nodes')
            .select('id, name, links, notes, tags')
            .eq('id', nodeId)
            .maybeSingle();
        }
        return r;
      });
  };
  const [partsRes, maintRes, attachRes, customRes, pendingRes, maintContractorRes, repairContractorRes] = await Promise.all([
    // v18.17 — was `.eq('equipment_id', id)` only. v18.20 fix: the `.or()`
    // approach was unreliable because the [X] inside cs.[X] confused
    // PostgREST's comma-separated predicate parser. Now using two parallel
    // queries (primary FK + JSONB contains via .contains()) and dedup in JS.
    // Returns a shape compatible with the original — { data, error }.
    (async () => {
      const [primary, compat] = await Promise.all([
        NX.sb.from('equipment_parts').select('*').eq('equipment_id', id),
        NX.sb.from('equipment_parts').select('*').contains('compatible_equipment_ids', [id]),
      ]);
      // If either errored, surface — but still merge what came back.
      const err = primary.error || compat.error || null;
      const seen = new Set();
      const merged = [];
      for (const p of [...(primary.data || []), ...(compat.data || [])]) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(p);
      }
      // Maintain assembly_path ordering client-side.
      merged.sort((a, b) => (a.assembly_path || '').localeCompare(b.assembly_path || ''));
      return { data: merged, error: err };
    })(),
    NX.sb.from('equipment_maintenance').select('*').eq('equipment_id', id).order('event_date', { ascending: false }),
    NX.sb.from('equipment_attachments').select('*').eq('equipment_id', id).order('created_at', { ascending: false }),
    NX.sb.from('equipment_custom_fields').select('*').eq('equipment_id', id).order('created_at'),
    NX.sb.from('pm_logs').select('*').eq('equipment_id', id).eq('review_status', 'pending').order('submitted_at', { ascending: false }),
    fetchContractor(eq.service_contractor_node_id),
    fetchContractor(eq.repair_contractor_node_id),
  ]);
  const parts        = partsRes.data   || [];
  const maintenance  = maintRes.data   || [];
  const attachments  = attachRes.data  || [];
  const customFields = customRes.data  || [];
  const pendingLogs  = pendingRes.data || [];
  // Attach contractor records to eq so renderOverview can use them.
  // Don't store on the cached `equipment` array — that's shared state
  // and other views shouldn't see this hydration.
  // _contractor preserved as the maintenance/service contractor (back-compat).
  // _repairContractor is the new repair-side contractor (separate person/company).
  eq._contractor       = maintContractorRes && maintContractorRes.data || null;
  eq._repairContractor = repairContractorRes && repairContractorRes.data || null;

  // Vendor-era hydration: equipment linked ONLY through service/repair
  // _vendor_id (no contractor node, no plain-text name) had nothing for
  // the SERVICED BY block to render — so no Call/Email buttons appeared
  // at all. Pull the vendor rows so the block can render from them.
  eq._serviceVendor = null;
  eq._repairVendor  = null;
  eq._inspectionVendor = null;
  try {
    const vids = [eq.service_vendor_id, eq.repair_vendor_id, eq.inspection_vendor_id].filter(Boolean);
    if (vids.length) {
      const { data: vrows } = await NX.sb.from('vendors').select('*').in('id', vids);
      (vrows || []).forEach(v => {
        if (String(v.id) === String(eq.service_vendor_id)) eq._serviceVendor = v;
        if (String(v.id) === String(eq.repair_vendor_id))  eq._repairVendor  = v;
        if (String(v.id) === String(eq.inspection_vendor_id)) eq._inspectionVendor = v;
      });
    }
  } catch (_) {}

  const modal = document.getElementById('eqModal') || createDetailModal();
  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeDetail()"></div>
    <div class="eq-detail">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeDetail()">${uiSvg("close", "16px")}</button>
        <div class="eq-detail-title">
          <span class="eq-cat-icon-lg">${catIcon(eq.category)}</span>
          <div>
            <h2>${esc(eq.name)}</h2>
            <div class="eq-detail-sub">${esc(eq.location)}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
          </div>
        </div>
        <div class="eq-detail-status">
          ${lifecycleStatusPill(eq, 'lg')}
        </div>
      </div>

      <!-- Open cards from the Board, populated async after render -->
      <div id="eqOpenCards-${eq.id}" class="eq-open-cards" style="display:none"></div>

      <div class="eq-detail-tabs">
        <button class="eq-tab active" data-tab="overview">Overview</button>
        <button class="eq-tab" data-tab="timeline">Timeline (${maintenance.length}${pendingLogs.length ? ` <span class="eq-tab-pending-dot" title="${pendingLogs.length} pending review">+${pendingLogs.length}</span>` : ''})</button>
        <button class="eq-tab" data-tab="activity">Activity</button>
        <button class="eq-tab" data-tab="parts">Parts (${parts.length})</button>
        <button class="eq-tab" data-tab="manual">Manual</button>
        <button class="eq-tab" data-tab="intel">${uiSvg('brain', '14px')} AI</button>
        <button class="eq-tab" data-tab="qr">QR</button>
      </div>

      <div class="eq-detail-body">
        <div class="eq-tab-panel active" data-panel="overview">${renderOverview(eq, attachments, customFields, maintenance)}</div>
        <div class="eq-tab-panel" data-panel="timeline">${renderTimeline(eq, maintenance, pendingLogs)}</div>
        <div class="eq-tab-panel" data-panel="activity"><div class="eq-empty-small">Loading activity…</div></div>
        <div class="eq-tab-panel" data-panel="parts">${renderParts(eq, parts, maintenance)}</div>
        <div class="eq-tab-panel" data-panel="manual">${renderManual(eq)}</div>
        <div class="eq-tab-panel" data-panel="intel"><div class="eq-empty-small">Loading intelligence…</div></div>
        <div class="eq-tab-panel" data-panel="qr">${renderQR(eq)}</div>
      </div>

      <div class="eq-detail-actions eq-detail-actions-v2">
        <button class="eq-action-cta" onclick="NX.modules.equipment.callService('${eq.id}')">
          <span class="eq-action-cta-icon">${uiSvg('phone', '18px')}</span>
          <span class="eq-action-cta-label">Call Service</span>
        </button>
        <button class="eq-action-cta eq-action-cta-secondary" onclick="NX.modules.equipment.reportIssue('${eq.id}')">
          <span class="eq-action-cta-icon">${uiSvg('ticket', '18px')}</span>
          <span class="eq-action-cta-label">Report Issue</span>
        </button>
        <div class="eq-overflow-wrap">
          <button class="eq-overflow-btn-v2" onclick="NX.modules.equipment.toggleOverflow(event, '${eq.id}')" aria-label="More actions">${uiSvg('moreH', '20px')}</button>
          <div class="eq-overflow-menu" id="eqOverflow-${eq.id}" onclick="event.stopPropagation()">
            <button class="eq-overflow-item eq-overflow-item-primary" onclick="NX.modules.equipment.openFullEditor('${eq.id}')">${uiSvg('pen', '14px')}<span>Edit equipment</span></button>
            <div class="eq-overflow-divider"></div>
            <div class="eq-overflow-section-label">Operate</div>
            <button class="eq-overflow-item eq-overflow-item-primary" onclick="NX.modules.equipment.openPmLogger('${eq.id}')" style="color:var(--nx-gold)">${uiSvg('clipboard', '14px')}<span>Log PM <small style="opacity:0.6">(restarts countdown)</small></span></button>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.logService('${eq.id}')">${uiSvg('pen', '14px')}<span>Log Service / Repair</span></button>
            ${(eq.service_vendor_id || eq.repair_vendor_id || eq.service_contractor_node_id || eq.repair_contractor_node_id) ? `
            <button class="eq-overflow-item" onclick="NX.modules.equipment.emailVendor('${eq.service_vendor_id || eq.repair_vendor_id || ''}','${eq.id}','${eq.service_vendor_id ? 'maintenance' : 'repair'}')">${uiSvg('mail', '14px')}<span>Email Vendor</span></button>` : ''}
            <button class="eq-overflow-item" onclick="NX.modules.equipment.openIssueTracker('${eq.id}')">${uiSvg('alert', '14px')}<span>Issue Tracker</span></button>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.completeWorkOrder('${eq.id}')">${uiSvg('wrench', '14px')}<span>Complete Issue</span></button>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.openPartsForEquipment('${eq.id}')">${uiSvg('settings', '14px')}<span>View Parts</span></button>
            <div class="eq-overflow-divider"></div>
            <div class="eq-overflow-section-label">Manage</div>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.openFullEditor('${eq.id}')">${uiSvg('settings', '14px')}<span>Edit Everything</span></button>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.schedulePmFromOverflow('${eq.id}')">${uiSvg('clipboard', '14px')}<span>Schedule PM</span></button>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.quickReplacePhoto('${eq.id}')">${uiSvg('camera', '14px')}<span>${eq.photo_url ? 'Replace Photo' : 'Add Photo'}</span></button>
            <button class="eq-overflow-item" onclick="NX.modules.equipment.quickPrint('${eq.id}')">${uiSvg('printer', '14px')}<span>Print Label</span></button>
            <div class="eq-overflow-divider"></div>
            ${(eq.archived_at || eq.archived) ? `
              <button class="eq-overflow-item" onclick="NX.modules.equipment.restoreEquipment('${eq.id}')">${uiSvg('check', '14px')}<span>Restore equipment</span></button>
              <button class="eq-overflow-item eq-overflow-danger" onclick="NX.modules.equipment.deleteEquipment('${eq.id}')">${uiSvg('trash', '14px')}<span>Delete forever</span></button>
            ` : `
              <button class="eq-overflow-item eq-overflow-danger" onclick="NX.modules.equipment.archiveEquipment('${eq.id}')">${uiSvg('trash', '14px')}<span>Archive equipment</span></button>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // v18.20 — Detail card field-edit click delegation. Any
  // [data-edit-field] in the detail modal opens the inline field
  // editor. Lifecycle + Identity fields use this; static rows
  // (Services YTD etc.) lack the attribute so they ignore taps.
  modal.querySelectorAll('[data-edit-field]').forEach(el => {
    el.addEventListener('click', () => {
      const eqId = el.dataset.eqId;
      const fieldKey = el.dataset.editField;
      const label = el.dataset.editLabel;
      const type = el.dataset.editType || 'text';
      const minA = el.dataset.editMin;
      const maxA = el.dataset.editMax;
      const cascade = el.dataset.editCascade;
      // v18.23 — pm_schedule field type routes to the contractor-driven
      // schedule editor instead of the generic single-field editor.
      if (type === 'pm_schedule' || fieldKey === 'pm_schedule') {
        openScheduleEditor(eqId);
        return;
      }
      // Inspection vendor is pool-only — routes to its own picker, never
      // the free-text field editor.
      if (type === 'inspection_vendor' || fieldKey === 'inspection_vendor_id') {
        openInspectionVendorPicker(eqId);
        return;
      }
      const eqRow = equipment.find(e => String(e.id) === String(eqId));
      const currentValue = eqRow ? eqRow[fieldKey] : null;
      openFieldEditor(eqId, fieldKey, label, currentValue, type, {
        min: minA != null ? parseFloat(minA) : null,
        max: maxA != null ? parseFloat(maxA) : null,
        cascade: cascade || null,
      });
    });
    // Keyboard accessibility — Enter/Space on focused field triggers edit
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });

  // Load open cards linked to this equipment (async — doesn't block initial render)
  loadOpenCardsForEquipment(eq);

  // Detail header beacon → quick status menu. Mirrors the list-row
  // beacon behavior so the same affordance works everywhere a status
  // pill appears. The small gold pill in the top-right of the detail
  // is the most prominent representation of the equipment's state, so
  // it's the most natural place to tap to change it.
  const detailBeacon = modal.querySelector('.eq-detail-status .eq-lc-pill');
  if (detailBeacon) {
    detailBeacon.setAttribute('role', 'button');
    detailBeacon.setAttribute('tabindex', '0');
    detailBeacon.setAttribute('aria-label', 'Change equipment status');
    const fire = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openQuickStatusMenuForRow(eq.id, detailBeacon);
    };
    detailBeacon.addEventListener('click', fire);
    detailBeacon.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') fire(ev);
    });
  }

  // Wire tabs — lazy-render the Intelligence panel on first click
  modal.querySelectorAll('.eq-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      modal.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = modal.querySelector(`[data-panel="${tab.dataset.tab}"]`);
      panel.classList.add('active');
      if (tab.dataset.tab === 'intel' && !panel.dataset.loaded) {
        panel.dataset.loaded = '1';
        panel.innerHTML = await renderIntelligenceTab(id);
      }
      if (tab.dataset.tab === 'activity' && !panel.dataset.loaded) {
        panel.dataset.loaded = '1';
        const events = await loadEquipmentEvents(id);
        panel.innerHTML = renderEquipmentActivity(eq, events);
      }
      if (tab.dataset.tab === 'parts') {
        const list = panel.querySelector('.eq-parts-list');
        if (list) enhancePartsList(list);
      }
      if (tab.dataset.tab === 'manual') {
        hydrateManualPanel(panel, id);
      }
    });
  });

  // If Parts panel is already open (tab state), enhance immediately
  const partsPanelInitial = modal.querySelector('[data-panel="parts"].active .eq-parts-list');
  if (partsPanelInitial) enhancePartsList(partsPanelInitial);
  const manualPanelInitial = modal.querySelector('[data-panel="manual"].active');
  if (manualPanelInitial) hydrateManualPanel(manualPanelInitial, id);

  // Wire QR download
  const qrImg = modal.querySelector('.eq-qr-img');
  if (qrImg) generateQRImage(eq.qr_code, qrImg);

  // Render family tree + recent dispatches into the overview panel
  // (these need to run after the HTML is in the DOM)
  renderFamilySection(id);
  refreshDispatchChips(id);

  // Auto-translate the equipment Notes block (free-form field often
  // containing service history written by whichever tech was on shift).
  // Kept after the async tabs finish rendering because we don't want
  // to translate the skeleton loading states.
  if (window.NX?.tr) {
    const notesP = modal.querySelector('.eq-notes p');
    if (notesP) { try { NX.tr.auto(notesP); } catch(_) {} }
  }
}

function closeDetail() {
  const modal = document.getElementById('eqModal');
  if (modal) modal.classList.remove('active');
  currentEquipId = null;
}

function createDetailModal() {
  const m = document.createElement('div');
  m.id = 'eqModal';
  m.className = 'eq-modal';
  document.body.appendChild(m);
  return m;
}

/* ─── Board integration: Open Cards strip + Report Issue ────────────
   These connect the equipment detail modal to the Board module:
     • loadOpenCardsForEquipment — fills the "Open cards" strip after render
     • reportIssue — prompts for an issue, creates a prefilled board card
*/
function ensureBoardStyles() {
  if (document.getElementById('eq-board-bridge-styles')) return;
  const s = document.createElement('style');
  s.id = 'eq-board-bridge-styles';
  s.textContent = `
    .eq-open-cards{background:rgba(212,164,78,0.05);border-top:1px solid rgba(212,164,78,0.12);border-bottom:1px solid rgba(212,164,78,0.12);padding:8px 14px;margin:0;display:flex;flex-direction:column;gap:6px}
    .eq-open-cards-head{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent);display:flex;align-items:center;gap:6px}
    .eq-open-card{background:rgba(24,34,54,0.6);border:1px solid rgba(255,255,255,0.06);border-left:3px solid var(--c);border-radius:6px;padding:7px 10px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px}
    .eq-open-card:active{background:rgba(24,34,54,0.85)}
    .eq-open-card-title{flex:1;color:var(--text);font-weight:500}
    .eq-open-card-meta{font-size:10px;color:var(--text-dim)}
    .eq-open-card-overdue{color:var(--red);font-weight:600;font-size:10px}
  `;
  document.head.appendChild(s);
}

async function loadOpenCardsForEquipment(eq) {
  ensureBoardStyles();
  const container = document.getElementById(`eqOpenCards-${eq.id}`);
  if (!container) return;

  // Fetch via the board module's API if present, otherwise query directly
  let openCards = [];
  try {
    if (NX.modules?.board?.getOpenCardsForEquipment) {
      openCards = await NX.modules.board.getOpenCardsForEquipment(eq.id);
    } else {
      const { data } = await NX.sb.from('kanban_cards')
        .select('id, title, priority, status, due_date, created_at')
        .eq('equipment_id', eq.id)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      openCards = (data || []).filter(c => !['closed', 'done'].includes((c.status || '').toLowerCase()));
    }
  } catch (e) {
    console.warn('[equipment] open cards load failed:', e);
    return;
  }

  if (!openCards.length) {
    container.style.display = 'none';
    return;
  }

  const PRI_COLOR = { urgent:'var(--red)', high:'var(--accent)', normal:'var(--muted)', low:'var(--blue)' };
  const today = new Date(new Date().toDateString()).getTime();

  container.innerHTML = `
    <div class="eq-open-cards-head">
      ${uiSvg("ticket","13px")} ${openCards.length} open card${openCards.length !== 1 ? 's' : ''} on the board
    </div>
    ${openCards.slice(0, 4).map(c => {
      const overdue = c.due_date && new Date(c.due_date).getTime() < today;
      const color = PRI_COLOR[c.priority] || PRI_COLOR.normal;
      return `<div class="eq-open-card" data-card="${c.id}" style="--c:${color}">
        <div class="eq-open-card-title">${esc(c.title || '(untitled)')}</div>
        ${overdue ? '<span class="eq-open-card-overdue">OVERDUE</span>' : ''}
        <span class="eq-open-card-meta">${esc((c.status || '').replace(/_/g, ' '))}</span>
      </div>`;
    }).join('')}
    ${openCards.length > 4 ? `<div style="font-size:10px;color:var(--text-dim);text-align:center">+ ${openCards.length - 4} more</div>` : ''}
  `;
  container.style.display = '';

  container.querySelectorAll('.eq-open-card').forEach(el => {
    el.addEventListener('click', () => {
      // Jump to Board view, then scroll-focus or open the card
      closeDetail();
      document.querySelector('.nav-tab[data-view="board"]')?.click();
      document.querySelector('.bnav-btn[data-view="board"]')?.click();
      // Reload board and open the card
      setTimeout(async () => {
        if (NX.modules?.board?.reload) await NX.modules.board.reload();
      }, 300);
    });
  });
}

async function reportIssue(equipId) {
  // Re-routed to the new issue lifecycle tracker. The legacy "create
  // board card" behavior is preserved as a fallback if the tracker
  // table doesn't exist yet (pre-migration).
  const { data: eq } = await NX.sb.from('equipment')
    .select('id, name, location').eq('id', equipId).single();
  if (!eq) { NX.toast && NX.toast('Equipment not found', 'error'); return; }
  // Open the tracker — gives the full lifecycle UI with all open issues
  // for this equipment, plus a "Report new" button at the bottom.
  return openIssueTracker(equipId);
}

// Legacy reporters that already used commitIssue (board card path) keep
// working — kept as a private helper for fallback flows.
async function _legacyCommitIssueAsBoardCard(eq, issue) {
  try {
    if (NX.modules?.board?.createFromEquipment) {
      await NX.modules.board.createFromEquipment(eq, issue);
    } else {
      await NX.sb.from('kanban_cards').insert({
        title: `${issue} — ${eq.name}`,
        description: issue,
        priority: 'high',
        location: eq.location || null,
        equipment_id: eq.id,
        reported_by: NX.currentUser?.name || null,
        checklist: [], comments: [], labels: [], photo_urls: [],
        archived: false,
      });
      NX.toast && NX.toast('Card created on Board', 'success');
    }
  } catch (e) {
    console.error('[equipment] _legacyCommitIssueAsBoardCard:', e);
    NX.toast && NX.toast('Could not create card', 'error');
  }
}

/* ═══ DETAIL HEALTH BARS + BARS STUDIO (v18.34) ═══════════════════════════
   Animated, configurable maintenance-health bars at the top of the detail.
   Built-in: PM / Inspection / Deep clean (from equipment columns). Custom bars
   (e.g. Compliance) are user-defined {key,label,interval_days,last_date} stored
   in eq.specs._nx.bars; built-in visibility in eq.specs._nx.hidden. No schema
   change — specs is an existing jsonb column; _nx is filtered from the Specs card. */
function _barCountdown(lastIso, intervalDays) {
  const interval = parseInt(intervalDays, 10);
  if (!interval || interval <= 0) return null;
  // No real anchor date → no bar. (Previously this returned a red "Due now ·
  // never logged" bar for any unit that merely had an interval, which lit up
  // dozens of items that have no maintenance history. A bar needs a real
  // last-done / next-due date to mean anything.)
  if (!lastIso) return null;
  const last = new Date(String(lastIso).slice(0, 10) + 'T00:00:00');
  if (isNaN(last)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const elapsed = Math.floor((today - last) / 86400000);
  const remaining = interval - elapsed;
  const pct = Math.max(0, Math.min(1, remaining / interval));
  const next = new Date(last); next.setDate(next.getDate() + interval);
  const nextIso = next.toISOString().slice(0, 10);
  let color = '#3fa08f';
  if (pct < 0.1) color = '#d24b4b'; else if (pct < 0.5) color = '#d4a44e';
  const overdue = remaining < 0;
  const dueText = overdue
    ? `Overdue ${Math.abs(remaining)}d · was due ${pmShortDate(nextIso)}`
    : `Last ${pmShortDate(lastIso)} → due ${pmShortDate(nextIso)} · ${remaining}d left`;
  return { pct: Math.round(pct * 100), color, dueText, overdue };
}
function _eqBarConfig(eq) {
  const nx = (eq.specs && eq.specs._nx) || {};
  return { hidden: Array.isArray(nx.hidden) ? nx.hidden : [], bars: Array.isArray(nx.bars) ? nx.bars : [] };
}
function detailHealthBars(eq) {
  const cfg = _eqBarConfig(eq);
  const hidden = new Set(cfg.hidden);
  let pmLast = eq.last_pm_date;
  if (!pmLast && eq.next_pm_date && eq.pm_interval_days) {
    const d = new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00');
    if (!isNaN(d)) { d.setDate(d.getDate() - parseInt(eq.pm_interval_days, 10)); pmLast = d.toISOString().slice(0, 10); }
  }
  const out = [];
  const add = (key, label, last, interval) => {
    if (hidden.has(key)) return;
    const cd = _barCountdown(last, interval);
    if (cd) out.push({ key, label, cd });
  };
  add('pm', 'PM', pmLast, eq.pm_interval_days);
  add('inspection', 'Inspection', eq.last_inspection_date, eq.inspection_interval_days);
  add('deep_clean', 'Deep clean', eq.last_deep_clean_date, eq.deep_clean_interval_days);
  cfg.bars.forEach(b => { if (b && b.key && b.label) add(b.key, b.label, b.last_date, b.interval_days); });
  return out;
}
function renderDetailHealth(eq) {
  const bars = detailHealthBars(eq);
  const rows = bars.map(b => `
    <div class="eq-hbar ${b.cd.overdue ? 'is-over' : ''}">
      <div class="eq-hbar-top"><span class="eq-hbar-label">${esc(b.label)}</span><span class="eq-hbar-pct" style="color:${b.cd.color}">${b.cd.overdue ? 'OVERDUE' : b.cd.pct + '%'}</span></div>
      <div class="eq-hbar-track"><div class="eq-hbar-fill" style="width:${b.cd.pct}%;--bar:${b.cd.color}"></div></div>
      <div class="eq-hbar-sub">${esc(b.cd.dueText)}</div>
    </div>`).join('');
  return `
    <div class="eq-detail-card eq-health-card">
      <div class="eq-detail-card-head eq-health-head">
        <span>${uiSvg('activity', '12px')} Maintenance health</span>
        <button class="eq-health-gear" onclick="NX.modules.equipment.openBarsStudio('${eq.id}')" title="Customize bars — choose what shows, add your own">${uiSvg('settings', '13px')}</button>
      </div>
      ${rows || '<div class="eq-empty-small">No health bars yet — tap ⚙ to show PM / Inspection / Deep clean, or add your own (e.g. Compliance).</div>'}
    </div>`;
}
async function openBarsStudio(equipId) {
  const eq = equipment.find(e => String(e.id) === String(equipId));
  if (!eq) return;
  const cfg = _eqBarConfig(eq);
  const hidden = new Set(cfg.hidden);
  const builtins = [
    { key: 'pm', label: 'PM', interval: eq.pm_interval_days },
    { key: 'inspection', label: 'Inspection', interval: eq.inspection_interval_days },
    { key: 'deep_clean', label: 'Deep clean', interval: eq.deep_clean_interval_days },
  ];
  let customs = cfg.bars.map(b => Object.assign({}, b));
  const ov = document.createElement('div');
  ov.className = 'eq-studio-ov';
  const customRow = (b, i) => `<div class="eq-studio-crow" data-ci="${i}">
    <input class="eq-studio-in" data-cf="label" value="${escAttr(b.label || '')}" placeholder="Bar name (e.g. Compliance)">
    <div class="eq-studio-crow2">
      <input class="eq-studio-in eq-studio-num" type="number" min="1" data-cf="interval_days" value="${escAttr(b.interval_days || '')}" placeholder="Every N days">
      <input class="eq-studio-in" type="date" data-cf="last_date" value="${escAttr((b.last_date || '').slice(0, 10))}">
      <button class="eq-studio-del" data-del title="Remove">${uiSvg('close', '12px')}</button>
    </div>
  </div>`;
  const collectCustoms = () => {
    const rows = [];
    ov.querySelectorAll('.eq-studio-crow').forEach((r, i) => {
      const label = r.querySelector('[data-cf="label"]').value.trim();
      if (!label) return;
      const interval = r.querySelector('[data-cf="interval_days"]').value;
      const last = r.querySelector('[data-cf="last_date"]').value;
      const existing = customs[i] && customs[i].key;
      rows.push({ key: existing || ('cb' + Date.now() + i), label, interval_days: parseInt(interval, 10) || null, last_date: last || null });
    });
    return rows;
  };
  const wire = () => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.querySelector('[data-cancel]').addEventListener('click', () => ov.remove());
    ov.querySelector('[data-add]').addEventListener('click', () => { customs = collectCustoms(); customs.push({ label: '', interval_days: null, last_date: null }); draw(); });
    ov.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const i = +b.closest('.eq-studio-crow').dataset.ci; customs = collectCustoms(); customs.splice(i, 1); draw(); }));
    ov.querySelector('[data-save]').addEventListener('click', async () => {
      const newHidden = [];
      ov.querySelectorAll('[data-bk]').forEach(cb => { if (!cb.checked) newHidden.push(cb.dataset.bk); });
      const newCustoms = collectCustoms();
      ov.remove();
      await saveBarConfig(equipId, eq, { hidden: newHidden, bars: newCustoms });
    });
  };
  const draw = () => {
    ov.innerHTML = `<div class="eq-studio">
      <div class="eq-studio-grip"></div>
      <div class="eq-studio-title">Customize health bars</div>
      <div class="eq-studio-sub">${esc(eq.name)} — pick what shows, or add your own</div>
      <div class="eq-studio-sec">Built-in</div>
      ${builtins.map(b => `<label class="eq-studio-row"><input type="checkbox" data-bk="${b.key}" ${hidden.has(b.key) ? '' : 'checked'}><span class="eq-studio-rl">${esc(b.label)}</span><span class="eq-studio-rm">${b.interval ? 'every ' + b.interval + 'd' : 'no interval set'}</span></label>`).join('')}
      <div class="eq-studio-sec">Custom bars</div>
      <div id="eqStudioCustoms">${customs.map((b, i) => customRow(b, i)).join('') || '<div class="eq-empty-small">None yet — add a Compliance, Filter-change, Calibration bar…</div>'}</div>
      <button class="eq-studio-add" data-add>${uiSvg('plus', '13px')} Add custom bar</button>
      <div class="eq-studio-actions"><button class="eq-studio-btn" data-cancel>Cancel</button><button class="eq-studio-btn is-primary" data-save>Save</button></div>
    </div>`;
    wire();
  };
  draw();
  document.body.appendChild(ov);
}
async function saveBarConfig(equipId, eq, nx) {
  if (!NX.sb) { NX.toast && NX.toast('Database unavailable', 'error'); return; }
  const specs = Object.assign({}, eq.specs || {});
  specs._nx = Object.assign({}, specs._nx || {}, nx);
  try {
    const { error } = await NX.sb.from('equipment').update({ specs }).eq('id', equipId);
    if (error) throw error;
    NX.toast && NX.toast('Bars saved', 'success', 1500);
    if (typeof loadEquipment === 'function') { try { await loadEquipment(); } catch (_) {} }
    if (typeof openDetail === 'function') openDetail(equipId);
  } catch (e) { console.error('[barsStudio] save:', e); NX.toast && NX.toast('Save failed: ' + (e.message || ''), 'error', 3000); }
}

/* ═══ OVERVIEW TAB (merges base + full-editor enhancements) ═══ */

function renderOverview(eq, attachments, customFields, maintenance) {
  maintenance = maintenance || [];
  const specs = eq.specs || {};
  const specKeys = Object.keys(specs).filter(k => specs[k] && k !== '_nx');

  // Links block (manual_source_url + manual_url + attachment links)
  const linkAttachments = attachments.filter(a => a.type === 'link' || a.external_url);
  const hasLinks = eq.manual_source_url || eq.manual_url || linkAttachments.length;

  // ── SERVICED BY block ──────────────────────────────────────────
  // Surfaces both contractors: who services it (PMs / scheduled) and
  // who repairs it (when it breaks). They can be the same company or
  // different — public QR scans default to the repair contractor since
  // staff usually scan because something is wrong, not because a PM is due.
  // When no contractor is assigned in either slot, render an empty CTA
  // pointing to Edit Everything → Links so the user knows where to set it up.
  const renderContractorBlock = (c, role, plainName, plainPhone, vendorId) => {
    // role: 'maintenance' | 'repair'
    const roleLabel = role === 'repair' ? 'Repairs by' : 'Serviced by';
    const roleClass = role === 'repair' ? 'eq-serviced-by-role-repair' : 'eq-serviced-by-role-maint';
    // When the equipment is linked to a vendor record, offer a jump into the
    // full vendor profile (cross-module deep-link). Hidden when there's no
    // vendor id (plain-text-only contact, or pre-migration schema).
    const viewVendorBtn = vendorId
      ? `<button type="button" class="eq-serviced-by-viewvendor" onclick="(window.NX&&NX.modules&&NX.modules.vendors&&NX.modules.vendors.openVendor)&&NX.modules.vendors.openVendor('${escAttr(String(vendorId))}')" style="margin-top:8px;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;background:var(--nx-gold-faint,rgba(212,164,78,.14));border:1px solid var(--nx-gold-line,rgba(212,164,78,.4));color:var(--nx-gold,#d4a44e);font:inherit;font-size:12px;font-weight:600;padding:8px 12px;border-radius:8px;cursor:pointer">View vendor profile →</button>`
      : '';
    if (c) {
      const phone = extractContractorPhone(c) || plainPhone || '';
      const tags  = Array.isArray(c.tags) ? c.tags.filter(Boolean) : [];
      const hasTemplate = !!(c.subject_template || c.body_template);
      const emails = extractContractorEmails(c);
      const hasEmail = emails && emails.length > 0;
      return `
        <div class="eq-serviced-by ${roleClass}">
          <div class="eq-serviced-by-head">
            <div class="eq-serviced-by-label">${roleLabel}</div>
            <div class="eq-serviced-by-name">${esc(c.name || 'Unnamed contractor')}</div>
          </div>
          ${tags.length ? `
            <div class="eq-serviced-by-tags">
              ${tags.slice(0, 6).map(t => `<span class="eq-serviced-by-tag">${esc(t)}</span>`).join('')}
            </div>
          ` : ''}
          <div class="eq-serviced-by-actions">
            ${phone ? `
              <button type="button" class="eq-serviced-by-call"
                onclick="NX.modules.equipment.callVendor('${escAttr(String(vendorId || ''))}','${escAttr(String(eq.id))}','${escAttr(role)}')">
                ${uiSvg('phone', '14px')}<span>${esc(phone)}</span>
              </button>
            ` : `<span class="eq-serviced-by-nophone">No phone on file</span>`}
            ${(vendorId || hasEmail) ? `
              <button type="button" class="eq-serviced-by-call eq-serviced-by-email"
                onclick="NX.modules.equipment.emailVendor('${escAttr(String(vendorId || ''))}','${escAttr(String(eq.id))}','${escAttr(role)}')">
                ${uiSvg('mail', '14px')}<span>Email</span>
              </button>
            ` : ''}
          </div>
          <div class="eq-serviced-by-status">
            <span class="eq-serviced-by-pip ${hasEmail ? 'is-on' : ''}" title="Email on file">
              ${uiSvg('mail', '11px')}<span>${hasEmail ? 'Email ready' : 'No email'}</span>
            </span>
            <span class="eq-serviced-by-pip ${hasTemplate ? 'is-on' : ''}" title="Custom email template configured">
              ${uiSvg('document', '11px')}<span>${hasTemplate ? 'Template set' : 'Default template'}</span>
            </span>
          </div>
          ${viewVendorBtn}
        </div>
      `;
    }
    // Plain-text fallback: contractor not linked but a phone/name was typed.
    if (plainName || plainPhone) {
      return `
        <div class="eq-serviced-by ${roleClass}">
          <div class="eq-serviced-by-head">
            <div class="eq-serviced-by-label">${roleLabel}</div>
            <div class="eq-serviced-by-name">${esc(plainName || 'Unlinked contact')}</div>
          </div>
          <div class="eq-serviced-by-actions">
            ${plainPhone ? `
              <button type="button" class="eq-serviced-by-call"
                onclick="NX.modules.equipment.callVendor('${escAttr(String(vendorId || ''))}','${escAttr(String(eq.id))}','${escAttr(role)}')">
                ${uiSvg('phone', '14px')}<span>${esc(plainPhone)}</span>
              </button>
            ` : `<span class="eq-serviced-by-nophone">No phone on file</span>`}
            ${vendorId ? `
              <button type="button" class="eq-serviced-by-call eq-serviced-by-email"
                onclick="NX.modules.equipment.emailVendor('${escAttr(String(vendorId))}','${escAttr(String(eq.id))}','${escAttr(role)}')">
                ${uiSvg('mail', '14px')}<span>Email</span>
              </button>
            ` : ''}
          </div>
          ${viewVendorBtn}
        </div>
      `;
    }
    // Vendor-era branch: linked through a vendors-table row only (no
    // contractor node, no plain-text name/phone). Renders from the vendor
    // row hydrated in openDetail — this was the case that previously
    // returned '' and left the equipment page with NO Call/Email buttons.
    const vRow = role === 'repair' ? eq._repairVendor : eq._serviceVendor;
    if (vRow) {
      const vPhone = vRow.phone || '';
      const vHasEmail = !!(vRow.email || (Array.isArray(vRow.emails) && vRow.emails.length));
      return `
        <div class="eq-serviced-by ${roleClass}">
          <div class="eq-serviced-by-head">
            <div class="eq-serviced-by-label">${roleLabel}</div>
            <div class="eq-serviced-by-name">${esc(vRow.company || vRow.name || 'Vendor')}</div>
          </div>
          <div class="eq-serviced-by-actions">
            ${vPhone ? `
              <button type="button" class="eq-serviced-by-call"
                onclick="NX.modules.equipment.callVendor('${escAttr(String(vRow.id))}','${escAttr(String(eq.id))}','${escAttr(role)}')">
                ${uiSvg('phone', '14px')}<span>${esc(vPhone)}</span>
              </button>
            ` : `<span class="eq-serviced-by-nophone">No phone on file</span>`}
            ${vHasEmail ? `
              <button type="button" class="eq-serviced-by-call eq-serviced-by-email"
                onclick="NX.modules.equipment.emailVendor('${escAttr(String(vRow.id))}','${escAttr(String(eq.id))}','${escAttr(role)}')">
                ${uiSvg('mail', '14px')}<span>Email</span>
              </button>
            ` : ''}
          </div>
          ${viewVendorBtn}
        </div>
      `;
    }
    return '';
  };

  const maintBlock  = renderContractorBlock(eq._contractor, 'maintenance', eq.service_contractor_name, eq.service_contractor_phone, eq.service_vendor_id);
  const repairBlock = renderContractorBlock(eq._repairContractor, 'repair',     eq.repair_contractor_name,  eq.repair_contractor_phone, eq.repair_vendor_id);

  let servicedByHTML = '';
  const _cov = equipmentCoverage(eq);
  const _covPill = `<div class="eq-coverage-pill cov-${_cov.cls}">${_cov.cls === 'none' ? '○' : '✓'} ${_cov.label}${_cov.legacy ? ' <span class="cov-legacy" title="Covered by a legacy contractor — not linked to a vendor yet">⚠ legacy</span>' : ''}</div>`;
  if (maintBlock || repairBlock) {
    servicedByHTML = `
      ${_covPill}
      <div class="eq-serviced-by-row">
        ${maintBlock}
        ${repairBlock}
      </div>
    `;
  } else {
    servicedByHTML = `
      ${_covPill}
      <div class="eq-serviced-by eq-serviced-by-empty">
        <div class="eq-serviced-by-empty-msg">No contractors assigned.</div>
        <div class="eq-serviced-by-empty-hint">Edit Everything → Links → Maintenance / Repair Contractor</div>
      </div>
    `;
  }

  // Card-based layout: each logical group lives in its own gold-line
  // bordered card with a monospace header. Mirrors the order-detail
  // pattern from ordering. Empty groups render an em-dash so the user
  // can see at a glance what's blank vs missing.
  // Date-only DB values ("2022-01-01") parse as UTC midnight and roll back a
  // day in negative-UTC timezones; pin them to local midnight so the install/
  // warranty dates read true. Full timestamps pass through unchanged.
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const s = String(iso);
    const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    return isNaN(d) ? '—' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  };
  // v18.20 — Each field now carries an `edit` key (DB column name) so the
  // detail-card click delegation can route into openFieldEditor. Fields
  // without `edit` (derived stats) render as static. The cascade hint
  // on last_pm_date tells the editor to recompute next_pm_date after save.
  const identityFields = [
    { label: 'Manufacturer', value: esc(eq.manufacturer || '—'),     edit: 'manufacturer',   type: 'text' },
    { label: 'Model',        value: esc(eq.model || '—'),            edit: 'model',          type: 'text' },
    { label: 'Serial',       value: esc(eq.serial_number || '—'),    edit: 'serial_number',  type: 'text' },
    { label: 'Category',     value: `${catIcon(eq.category)} <span style="margin-left:4px">${esc(eq.category || '—')}</span>`, edit: 'category', type: 'category' },
  ];
  // ── LIFECYCLE & SERVICE (v18.36 — rebuilt around the health logs) ──
  // Two readable groups: durable lifecycle facts, and the live maintenance/
  // service picture sourced from the SAME cadence anchors that drive the
  // health bars (computePmCountdown / computeCadenceCountdown) plus the
  // equipment_maintenance service log. The cadence rows stay editable (tap =
  // set the last-done date that starts the countdown). The old static "Health
  // score" is demoted to a small secondary stat — it's a server repair-index,
  // not part of the PM/Inspection/Deep-clean health logs.
  const _ageStr = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '';
    const months = Math.max(0, Math.floor((Date.now() - d) / (30.44 * 86400000)));
    const y = Math.floor(months / 12), m = months % 12;
    return y > 0 ? (y + 'y' + (m ? ' ' + m + 'm' : '')) : (months + 'mo');
  };
  const _warrActive = (() => {
    if (!eq.warranty_until) return null;
    const d = new Date(String(eq.warranty_until).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return d >= t;
  })();
  // Cadence summary: "last <date> → due <date> · <Nd | overdue Nd>" from a
  // countdown, or an invite to set it up when there's no real anchor (mirrors
  // the v177 rule: no fabricated bar/countdown without a real last/next date).
  const _cadSummary = (cd, lastIso, intervalDays, noun) => {
    if (cd) {
      const lastTxt = lastIso ? 'last ' + pmShortDate(String(lastIso).slice(0, 10)) + ' → ' : '';
      const dueTxt = 'due ' + pmShortDate(cd.nextDate);
      const cnt = cd.isOverdue
        ? `<span class="eq-detail-card-unit" style="color:#d24b4b"> · overdue ${Math.abs(cd.remainingDays)}d</span>`
        : `<span class="eq-detail-card-unit"> · ${cd.remainingDays}d</span>`;
      return lastTxt + dueTxt + cnt;
    }
    return intervalDays
      ? `<span class="eq-detail-card-unit">every ${intervalDays}d · log ${noun} to start</span>`
      : '<span class="eq-detail-card-unit">not tracked</span>';
  };
  const _pmCd  = computePmCountdown(eq);
  const _insCd = computeCadenceCountdown(eq, 'last_inspection_date', 'inspection_interval_days');
  const _dcCd  = computeCadenceCountdown(eq, 'last_deep_clean_date', 'deep_clean_interval_days');
  // "Last service" reflects real service/PM/repair work — NOT anonymous
  // public status flips (event_type 'status_change', performed_by 'QR scan'),
  // which would otherwise masquerade as a service here. They remain visible in
  // the Timeline; they just don't count as the last service.
  const _lastSvc = maintenance.find(m => m.event_type !== 'status_change') || null;
  const _lastSvcVal = _lastSvc
    ? `${pmShortDate(String(_lastSvc.event_date).slice(0, 10))}<span class="eq-detail-card-unit"> · ${esc((_lastSvc.event_type || 'service').replace(/_/g, ' '))}${_lastSvc.performed_by ? ' · ' + esc(_lastSvc.performed_by) : ''}</span>`
    : 'No service logged yet';

  const lifecycleFields = [
    { label: 'Installed',      value: eq.install_date ? `${fmtDate(eq.install_date)}<span class="eq-detail-card-unit"> · ${_ageStr(eq.install_date)}</span>` : '—', edit: 'install_date', type: 'date' },
    { label: 'Warranty',       value: eq.warranty_until ? `${fmtDate(eq.warranty_until)}<span class="eq-detail-card-unit"${_warrActive ? '' : ' style="color:#d24b4b"'}> · ${_warrActive ? 'active' : 'expired'}</span>` : '—', edit: 'warranty_until', type: 'date' },
    { label: 'Purchase price', value: eq.purchase_price ? `$${parseFloat(eq.purchase_price).toLocaleString()}` : '—', edit: 'purchase_price', type: 'number', min: 0 },
  ];
  // Each cadence row is editable on its last-done date (tap → set the anchor
  // that starts the countdown). PM cascades into next_pm_date. PM scheduled is
  // the contractor-committed visit (distinct from the auto countdown).
  const serviceFields = [
    { label: 'PM',            value: _cadSummary(_pmCd, eq.last_pm_date, eq.pm_interval_days, 'a PM'),                                   edit: 'last_pm_date',           type: 'date', cascade: 'next_pm_date' },
    { label: 'PM every',      value: eq.pm_interval_days ? `${eq.pm_interval_days} days` : '—',                                          edit: 'pm_interval_days',       type: 'number', min: 1, max: 3650 },
    { label: 'PM scheduled',  value: renderPmScheduledValue(eq.id),                                                                      edit: 'pm_schedule',            type: 'pm_schedule' },
    { label: 'Inspection',    value: _cadSummary(_insCd, eq.last_inspection_date, eq.inspection_interval_days, 'an inspection'),         edit: 'last_inspection_date',   type: 'date' },
    { label: 'Inspect every', value: eq.inspection_interval_days ? `${eq.inspection_interval_days} days` : '—',                          edit: 'inspection_interval_days', type: 'number', min: 1, max: 3650 },
    { label: 'Inspected by',  value: eq._inspectionVendor ? esc(eq._inspectionVendor.company || eq._inspectionVendor.name || 'Vendor') : ((eq.last_inspection_date || eq.inspection_interval_days) ? '<span style="color:#d24b4b">required — tap to pick</span>' : '—'), edit: 'inspection_vendor_id', type: 'inspection_vendor' },
    { label: 'Deep clean',    value: _cadSummary(_dcCd, eq.last_deep_clean_date, eq.deep_clean_interval_days, 'a deep clean'),           edit: 'last_deep_clean_date',   type: 'date' },
    { label: 'Clean every',   value: eq.deep_clean_interval_days ? `${eq.deep_clean_interval_days} days` : '—',                          edit: 'deep_clean_interval_days', type: 'number', min: 1, max: 3650 },
    { label: 'Last service',  value: _lastSvc ? `${_lastSvcVal}<span class="eq-detail-card-unit"> · tap for all</span>` : 'No service logged yet<span class="eq-detail-card-unit"> · tap to log</span>', edit: null, action: `NX.modules.equipment.showDetailTab('timeline')` },
    { label: 'Services (YTD)',value: `${eq.services_this_year || 0}${eq.cost_this_year ? ` <span class="eq-detail-card-unit">· $${Math.round(eq.cost_this_year).toLocaleString()}</span>` : ''}`, edit: null, action: `NX.modules.equipment.showDetailTab('timeline')` },
  ];
  const healthDemoted = { label: 'Health index (auto)', value: `<span style="opacity:.55">${eq.health_score ?? 100}%</span>`, edit: 'health_score', type: 'number', min: 0, max: 100 };

  const fieldsHTML = (rows) => `
    <div class="eq-detail-card-grid">
      ${rows.map(row => {
        // Accept legacy [label, value] tuples too for back-compat.
        const f = Array.isArray(row) ? { label: row[0], value: row[1], edit: null } : row;
        const editable = !!f.edit;
        // A row may instead carry an `action` (inline JS) that fires on tap —
        // used for "Last service" / "Services (YTD)" → open the Log Service
        // sheet, so logging is discoverable right where the value is shown.
        const actionable = !editable && !!f.action;
        const dataAttrs = editable
          ? ` data-edit-field="${esc(f.edit)}" data-edit-type="${esc(f.type || 'text')}" data-edit-label="${esc(f.label)}" data-eq-id="${esc(eq.id)}"${f.min != null ? ` data-edit-min="${f.min}"` : ''}${f.max != null ? ` data-edit-max="${f.max}"` : ''}${f.cascade ? ` data-edit-cascade="${esc(f.cascade)}"` : ''} role="button" tabindex="0"`
          : (actionable ? ` onclick="${f.action}" role="button" tabindex="0"` : '');
        const affordance = editable
          ? ' <span style="opacity:0.4; font-size:9px">✎</span>'
          : (actionable ? ' <span style="opacity:0.5; font-size:11px; color:var(--nx-gold)">＋</span>' : '');
        return `
          <div class="eq-detail-card-field${(editable || actionable) ? ' is-editable' : ''}"${dataAttrs}>
            <div class="eq-detail-card-field-label">${f.label}${affordance}</div>
            <div class="eq-detail-card-field-value">${f.value}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  return `
    ${eq.photo_url ? `<img src="${eq.photo_url}" class="eq-detail-photo">` : ''}
    ${renderDetailHealth(eq)}
    ${servicedByHTML}

    <div class="eq-detail-card">
      <div class="eq-detail-card-head">
        ${uiSvg('tag', '12px')}
        <span>Identity</span>
      </div>
      ${fieldsHTML(identityFields)}
    </div>

    <div class="eq-detail-card">
      <div class="eq-detail-card-head">
        ${uiSvg('clipboard', '12px')}
        <span>Lifecycle &amp; Service</span>
      </div>
      <div class="eq-ls-subhead">Lifecycle</div>
      ${fieldsHTML(lifecycleFields)}
      <div class="eq-ls-subhead">Maintenance &amp; service</div>
      ${fieldsHTML(serviceFields)}
      <div class="eq-ls-demoted">${fieldsHTML([healthDemoted])}</div>
    </div>

    ${specKeys.length ? `
      <div class="eq-detail-card">
        <div class="eq-detail-card-head">
          ${uiSvg('settings', '12px')}
          <span>Specs</span>
        </div>
        ${fieldsHTML(specKeys.map(k => [esc(k), esc(String(specs[k]))]))}
      </div>
    ` : ''}

    ${eq.notes ? `
      <div class="eq-detail-card">
        <div class="eq-detail-card-head">
          ${uiSvg('note', '12px')}
          <span>Notes</span>
        </div>
        <p class="eq-detail-card-prose">${esc(eq.notes)}</p>
      </div>
    ` : ''}

    <div class="eq-detail-card">
      <div class="eq-detail-card-head">
        ${uiSvg('paperclip', '12px')}
        <span>Attachments${attachments.length ? ` · ${attachments.length}` : ''}</span>
      </div>
      ${attachments.length ? `
        <div class="eq-overview-attachments">
          ${attachments.map(a => `
            <a ${a.file_url || a.external_url ? `href="${a.file_url || a.external_url}" target="_blank"` : ''}
               class="eq-attach-badge">
              ${attachmentIcon(a)} ${esc(a.title)}
            </a>
          `).join('')}
        </div>
      ` : '<div class="eq-empty-small">No attachments yet. Add receipts, invoices, warranty cards, installation photos, or anything else.</div>'}
      <div class="eq-attach-add-row">
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'photo', 'detail')">${uiSvg('camera', '13px')} Photo</button>
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'file', 'detail')">${uiSvg('document', '13px')} File</button>
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'link', 'detail')">${uiSvg('link', '13px')} Link</button>
        <button class="eq-attach-add-btn" onclick="NX.modules.equipment.addAttachment('${eq.id}', 'note', 'detail')">${uiSvg('note', '13px')} Note</button>
      </div>
    </div>

    ${customFields.length ? `
      <div class="eq-detail-card">
        <div class="eq-detail-card-head">
          ${uiSvg('star', '12px')}
          <span>Custom Fields</span>
        </div>
        ${fieldsHTML(customFields.map(f => [
          esc(f.field_name),
          f.field_type === 'url' && f.field_value
            ? `<a href="${escAttr(f.field_value)}" target="_blank">${esc(f.field_value)} ↗</a>`
            : f.field_type === 'boolean'
              ? (f.field_value === 'true' ? `${uiSvg('check', '12px')} Yes` : `${uiSvg('close', '12px')} No`)
              : esc(f.field_value || '—')
        ]))}
      </div>
    ` : ''}

    ${hasLinks ? `
      <div class="eq-detail-card">
        <div class="eq-detail-card-head">
          ${uiSvg('link', '12px')}
          <span>Links</span>
        </div>
        <div class="eq-overview-links">
          ${eq.manual_source_url ? `<a href="${escAttr(eq.manual_source_url)}" target="_blank" class="eq-link-btn">${uiSvg('document', '13px')} Manual (source) ↗</a>` : ''}
          ${eq.manual_url ? `<a href="${escAttr(eq.manual_url)}" target="_blank" class="eq-link-btn">${uiSvg('document', '13px')} Manual PDF ↗</a>` : ''}
        </div>
      </div>` : ''}

    <div class="eq-overview-section">
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.scanDataPlate('${eq.id}')">${uiSvg('camera', '14px')} Scan Data Plate (auto-fill)</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.applyPredictivePM('${eq.id}')" title="Auto-schedule next PM based on repair patterns">${uiSvg('crystal', '14px')} Predictive PM</button>
    </div>

    <!-- Family section gets injected here by renderFamilySection() -->
    <!-- Recent dispatches gets injected here by refreshDispatchChips() -->
  `;
}

function renderTimeline(eq, maint, pending) {
  pending = pending || [];
  const isAdmin = NX.currentUser?.role === 'admin';
  const totalItems = maint.length + pending.length;

  if (!totalItems) {
    return `<div class="eq-empty-small">No service history yet.<br>
      <button class="eq-btn eq-btn-primary eq-mt" onclick="NX.modules.equipment.logService('${eq.id}')">+ Log First Service</button></div>`;
  }

  // Combine pending + approved into one chronological list.
  // Pending entries appear at the top with a distinct "pending review"
  // treatment; approved entries below in their original order.
  const pendingHtml = pending.map(p => {
    const photos = Array.isArray(p.photo_urls) ? p.photo_urls : [];
    return `
      <div class="eq-timeline-item eq-timeline-pending" data-pending-id="${p.id}">
        <div class="eq-timeline-date">
          ${new Date(p.service_date).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})}
          <div class="eq-timeline-pending-badge">${uiSvg('hourglass', '11px')} PENDING REVIEW</div>
        </div>
        <div class="eq-timeline-body">
          <div class="eq-timeline-type eq-type-${p.service_type || 'pm'}">${(p.service_type || 'service').toUpperCase()}</div>
          <div class="eq-timeline-desc">${esc(p.work_performed || '')}</div>
          <div class="eq-timeline-who">${uiSvg('user', '12px')} ${esc(p.contractor_name || 'Anonymous')}${p.contractor_company ? ' · ' + esc(p.contractor_company) : ''}</div>
          ${p.contractor_phone ? `<div class="eq-timeline-detail"><b>Phone:</b> ${esc(p.contractor_phone)}</div>` : ''}
          ${p.cost_amount ? `<div class="eq-timeline-cost">${uiSvg('dollar', '12px')} $${parseFloat(p.cost_amount).toLocaleString()}</div>` : ''}
          ${p.parts_replaced ? `<div class="eq-timeline-detail"><b>Parts:</b> ${esc(p.parts_replaced)}</div>` : ''}
          ${p.next_service_date ? `<div class="eq-timeline-detail"><b>Next service:</b> ${esc(p.next_service_date)}</div>` : ''}
          ${photos.length ? `
            <div class="eq-timeline-photos">
              ${photos.map(u => `<a href="${esc(u)}" target="_blank"><img src="${esc(u)}" class="eq-timeline-photo" onerror="this.style.display='none'"></a>`).join('')}
            </div>
          ` : ''}
          ${p.pdf_url ? `<div class="eq-timeline-detail"><a href="${esc(p.pdf_url)}" target="_blank">${uiSvg('document', '12px')} View PDF invoice</a></div>` : ''}
          ${p.signature_data ? `<img src="${esc(p.signature_data)}" class="eq-timeline-signature">` : ''}
          ${p.flagged_spam ? `<div class="eq-timeline-spam-flag">${uiSvg('alert', '12px')} Honeypot tripped — likely spam</div>` : ''}
          <div class="eq-timeline-submitted-at">Submitted ${new Date(p.submitted_at || p.created_at).toLocaleString()}</div>
          ${isAdmin ? `
            <div class="eq-timeline-review-actions">
              <button class="eq-btn eq-btn-approve" onclick="NX.modules.equipment.approvePmLog('${p.id}', '${eq.id}')">${uiSvg('check', '12px')} Approve</button>
              <button class="eq-btn eq-btn-reject"  onclick="NX.modules.equipment.rejectPmLog('${p.id}', '${eq.id}')">${uiSvg('close', '12px')} Reject</button>
              ${p.flagged_spam ? '' : `<button class="eq-btn eq-btn-spam" onclick="NX.modules.equipment.markPmSpam('${p.id}', '${eq.id}')">${uiSvg('ban', '12px')} Spam</button>`}
            </div>
          ` : '<div class="eq-timeline-review-hint">Awaiting admin review.</div>'}
        </div>
      </div>
    `;
  }).join('');

  const approvedHtml = maint.map(m => `
    <div class="eq-timeline-item">
      <div class="eq-timeline-date">${new Date(m.event_date).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})}</div>
      <div class="eq-timeline-body">
        <div class="eq-timeline-type eq-type-${m.event_type}">${(m.event_type || 'service').toUpperCase()}</div>
        <div class="eq-timeline-desc">${esc(m.description)}</div>
        ${m.performed_by ? `<div class="eq-timeline-who">${uiSvg('user', '12px')} ${esc(m.performed_by)}</div>` : ''}
        ${m.cost ? `<div class="eq-timeline-cost">${uiSvg('dollar', '12px')} $${parseFloat(m.cost).toLocaleString()}</div>` : ''}
        ${m.downtime_hours ? `<div class="eq-timeline-dt">${uiSvg('clock', '12px')} ${m.downtime_hours}h downtime</div>` : ''}
        ${m.symptoms ? `<div class="eq-timeline-detail"><b>Symptoms:</b> ${esc(m.symptoms)}</div>` : ''}
        ${m.root_cause ? `<div class="eq-timeline-detail"><b>Root cause:</b> ${esc(m.root_cause)}</div>` : ''}
      </div>
      <div class="eq-timeline-actions">
        <button class="eq-timeline-edit" onclick="NX.modules.equipment.logService('${eq.id}', '${m.id}')" title="Edit">${uiSvg('pen', '14px')}</button>
        <button class="eq-timeline-del" onclick="NX.modules.equipment.deleteMaintenance('${m.id}', '${eq.id}')" title="Delete">${uiSvg('close', '14px')}</button>
      </div>
    </div>
  `).join('');

  return `
    <div class="eq-timeline-bar">
      <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.logService('${eq.id}')">+ Log Service</button>
    </div>
    <div class="eq-timeline">
      ${pendingHtml}
      ${approvedHtml}
    </div>`;
}

function renderParts(eq, parts, maintenance) {
  // v18.21 — compute the latest replacement date per part FOR THIS EQUIPMENT
  // by walking the maintenance array (already in scope at call site).
  // Falls back gracefully if part_id column isn't populated yet on older rows.
  const lastReplacedByPart = new Map();
  for (const m of (maintenance || [])) {
    if (m.event_type !== 'part_replacement') continue;
    if (!m.part_id) continue;
    const key = String(m.part_id);
    if (!lastReplacedByPart.has(key) || lastReplacedByPart.get(key) < m.event_date) {
      lastReplacedByPart.set(key, m.event_date);
    }
  }
  const fmtShort = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  };

  // Per-part replacement countdown (months-based): replacement_interval_months
  // + last replaced (this unit's logged replacement, else the catalog field).
  // Returns null when not trackable → the bar is simply omitted.
  const replInfo = (p) => {
    const interval = parseInt(p.replacement_interval_months, 10);
    const lastIso = lastReplacedByPart.get(String(p.id)) || p.last_replaced_at;
    if (!interval || interval <= 0 || !lastIso) return null;
    const last = new Date(lastIso);
    if (isNaN(last)) return null;
    const now = new Date();
    const monthsElapsed = (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth());
    const remaining = interval - monthsElapsed;
    const pct = Math.max(0, Math.min(1, remaining / interval));
    let color = '#3fa08f';
    if (pct < 0.1)       color = '#d24b4b';
    else if (pct < 0.34) color = '#d4a44e';
    return {
      pct: Math.round(pct * 100), color,
      label: remaining <= 0 ? `Overdue ${Math.abs(remaining)}mo` : `Replace in ~${remaining}mo`,
    };
  };

  return `
    <div class="eq-parts-head">
      <button class="eq-btn eq-btn-small eq-btn-secondary" onclick="NX.modules.equipment.extractBOMFromManual('${eq.id}')" style="margin-right:6px">${uiSvg("sparkles", "13px")} Extract from Manual</button>
      <button class="eq-btn eq-btn-small eq-btn-secondary" onclick="NX.modules.equipment.exportPartsCart('${eq.id}')" style="margin-right:6px">Shopping List</button>
      <h4>Bill of Materials</h4>
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center">
        <button class="eq-btn eq-btn-small eq-btn-secondary" onclick="NX.modules.equipment.openEquipmentLinkPartsSheet('${eq.id}')" title="Pick parts from the catalog that also fit this equipment">${uiSvg("settings", "13px")} Link existing</button>
        <button class="eq-btn eq-btn-small eq-btn-primary" onclick="NX.modules.equipment.addPart('${eq.id}')">+ Add Part</button>
      </div>
    </div>
    ${!parts.length ? '<div class="eq-empty-small">No parts cataloged yet.</div>' : `
      <div class="eq-parts-list" data-multi-vendor="1">
        ${parts.map(p => {
          const lastRepl = lastReplacedByPart.get(String(p.id));
          const lastReplLabel = lastRepl ? fmtShort(lastRepl) : null;
          const ri = replInfo(p);
          const buyUrl = (p.supplier_url && /^https?:\/\//i.test(p.supplier_url)) ? p.supplier_url : null;
          const priceLbl = (p.last_price != null && p.last_price !== '') ? ('$' + p.last_price) : null;
          const supplierLbl = p.supplier ? esc(p.supplier) : (buyUrl ? 'Supplier' : null);
          return `
          <div class="eq-part" data-part-id="${p.id}">
            <div class="eq-part-main">
              <div class="eq-part-name">${esc(p.part_name)}${p.pm_required ? ' <span class="eq-part-pmtag">PM part</span>' : ''}</div>
              <div class="eq-part-sub">
                ${p.oem_part_number ? `OEM: ${esc(p.oem_part_number)}` : ''}
                ${p.mfr_part_number ? ` · MFR: ${esc(p.mfr_part_number)}` : ''}
                ${p.quantity > 1 ? ` · Qty: ${p.quantity}` : ''}
                ${p.equipment_id != eq.id ? ' · <span style="color:var(--nx-gold)">linked</span>' : ''}
              </div>
              ${(supplierLbl || priceLbl || buyUrl) ? `<div class="eq-part-buy">
                ${supplierLbl ? `<span class="eq-part-supplier">${supplierLbl}</span>` : ''}
                ${priceLbl ? `<span class="eq-part-price">${esc(priceLbl)}</span>` : ''}
                ${buyUrl ? `<a class="eq-part-buybtn" href="${escAttr(buyUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${uiSvg("link", "11px")} Buy</a>` : ''}
              </div>` : ''}
              ${ri ? `<div class="eq-part-repl"><div class="eq-part-repl-track"><div class="eq-part-repl-fill" style="width:${ri.pct}%;background:${ri.color}"></div></div><span class="eq-part-repl-lab" style="color:${ri.color}">${ri.label}</span></div>` : ''}
              ${p.assembly_path ? `<div class="eq-part-path">${esc(p.assembly_path)}</div>` : ''}
              <div class="eq-part-replaced" style="margin-top:4px; font-size:11px; color:${lastReplLabel ? 'var(--nx-faint)' : '#666'}">
                ${lastReplLabel
                  ? `Last replaced on this unit: <strong style="color:var(--nx-gold); font-family:'JetBrains Mono', monospace">${esc(lastReplLabel)}</strong>`
                  : '<em>Never replaced on this unit</em>'}
              </div>
            </div>
            <div class="eq-part-actions" style="flex-direction:column; gap:4px; align-items:flex-end">
              <button class="eq-btn eq-btn-tiny" onclick="NX.modules.equipment.markPartReplacedOnEquipment('${eq.id}', '${p.id}')" title="Log a replacement of this part on this specific equipment" style="color:var(--nx-gold); border-color:rgba(212,164,78,0.3)">${uiSvg("settings", "11px")} Mark replaced</button>
              <div style="display:flex; gap:4px">
                <button class="eq-btn eq-btn-tiny" onclick="NX.modules.equipment.editPart('${p.id}')">${uiSvg("pen", "13px")}</button>
                <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="NX.modules.equipment.deletePart('${p.id}', '${eq.id}')">${uiSvg("close", "13px")}</button>
              </div>
            </div>
          </div>
          `;
        }).join('')}
      </div>
    `}`;
}

function renderManual(eq) {
  // v14: multi-manual support. The cards are rendered async by
  // hydrateManualPanel() once the panel is visible; this initial markup
  // is just the empty container + the upload/find-online actions.
  return `
    <div class="eq-manual eq-manual-multi" data-eq-id="${eq.id}">
      <div class="eq-manual-list" id="eqManualList-${eq.id}">
        <div class="eq-manual-list-loading">Loading manuals…</div>
      </div>
      <div class="eq-manual-add-row">
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadManual('${eq.id}')">${uiSvg("document", "13px")} Upload PDF</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.autoFetchManual('${eq.id}')">${uiSvg("link", "13px")} Find Online</button>
      </div>
    </div>`;
}

function renderQR(eq) {
  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
  return `
    <div class="eq-qr-section">
      <div class="eq-qr-label">${esc(eq.name)}</div>
      <div class="eq-qr-sub">${esc(eq.location)}</div>
      <canvas class="eq-qr-img" width="220" height="220"></canvas>
      <div class="eq-qr-code">${esc(eq.qr_code)}</div>
      <div class="eq-qr-url">${scanURL}</div>
      <div class="eq-qr-actions">
        <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.printZebraSingle('${eq.id}')">Print on Zebra</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.printSingleQR('${eq.id}')">Paper Sticker</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.printServiceLog('${eq.id}')">Service Log Sheet</button>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.copyQRLink('${eq.qr_code}')">Copy Link</button>
      </div>
    </div>`;
}


/* ════════════════════════════════════════════════════════════════════════════
   4. EDIT — simple add/edit, service log, parts, delete
   ════════════════════════════════════════════════════════════════════════════ */

function openEditModal(id) {
  const eq = id ? equipment.find(e => e.id === id) : {
    name: '', location: 'Suerte', area: '', category: 'refrigeration',
    manufacturer: '', model: '', serial_number: '', status: 'operational',
    install_date: '', warranty_until: '', purchase_price: '',
    pm_interval_days: '', last_pm_date: '', next_pm_date: '', notes: ''
  };

  const modal = document.getElementById('eqEditModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqEditModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeEdit()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeEdit()">${uiSvg("close", "16px")}</button>
        <h2>${id ? 'Edit' : 'Add'} Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <form class="eq-form" id="eqForm">
          <div class="eq-form-group">
            <label>Name *</label>
            <input name="name" value="${esc(eq.name)}" required placeholder="Walk-In Cooler, Kitchen South">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Location *</label>
              <select name="location" required>
                ${LOCATIONS.map(l => `<option value="${l}" ${eq.location===l?'selected':''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Area</label>
              <input name="area" value="${esc(eq.area||'')}" placeholder="Kitchen, Bar, Dining">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Category</label>
              <select name="category">
                ${CATEGORIES.map(c => `<option value="${c.key}" ${eq.category===c.key?'selected':''}>${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Status</label>
              <select name="status">
                ${DROPDOWN_STATUSES.map(s => `<option value="${s.key}" ${eq.status===s.key?'selected':''}>${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Manufacturer</label>
              <input name="manufacturer" value="${esc(eq.manufacturer||'')}" placeholder="Hoshizaki">
            </div>
            <div class="eq-form-group">
              <label>Model</label>
              <input name="model" value="${esc(eq.model||'')}" placeholder="KM-320MAH-E">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Serial Number</label>
            <input name="serial_number" value="${esc(eq.serial_number||'')}" placeholder="240317001">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Install Date</label>
              <input type="date" name="install_date" value="${eq.install_date||''}">
            </div>
            <div class="eq-form-group">
              <label>Warranty Until</label>
              <input type="date" name="warranty_until" value="${eq.warranty_until||''}">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Purchase Price ($)</label>
              <input type="number" step="0.01" name="purchase_price" value="${eq.purchase_price||''}">
            </div>
            <div class="eq-form-group">
              <label>PM Interval (days)</label>
              <input type="number" name="pm_interval_days" value="${eq.pm_interval_days||''}" placeholder="90">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Last PM Date</label>
              <input type="date" name="last_pm_date" value="${eq.last_pm_date||''}" title="Date the last PM happened. NEXUS computes the next PM date and countdown from this + the interval.">
            </div>
            <div class="eq-form-group">
              <label>Next PM Date <small style="opacity:0.6">(auto)</small></label>
              <input type="date" name="next_pm_date" value="${eq.next_pm_date||''}" title="Computed from Last PM + Interval. Override if you want a specific date.">
            </div>
          </div>
          ${(eq.last_pm_date || eq.next_pm_date) && eq.pm_interval_days ? `<div class="eq-form-group">${renderPmProgressBar(eq)}</div>` : ''}
          <div class="eq-form-group">
            <label>Notes</label>
            <textarea name="notes" rows="3" placeholder="Any special notes, quirks, service tips...">${esc(eq.notes||'')}</textarea>
          </div>
          <!-- v18.32 — Current Status Note. Synced with the daily log's
               Equipment Status section: editing here updates what shows
               in the daily log, and vice versa. Only visible when status
               is non-operational since the field is about the active
               problem state. -->
          <div class="eq-form-group" data-show-when="non-operational" ${['operational','retired','archived'].includes(eq.status) ? 'style="display:none;"' : ''}>
            <label>Current Status Note <small style="opacity:0.6;font-weight:normal;">— synced with daily log</small></label>
            <textarea name="status_note" rows="2" placeholder="What's the current story? Parts ordered, vendor coming, etc.">${esc(eq.status_note||'')}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeEdit()">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">${id ? 'Save Changes' : 'Create Equipment'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // v18.32 — Show/hide the Current Status Note field based on the
  // status dropdown. Hidden when status is operational/retired/archived
  // (no active problem to narrate). Listener attached once per modal
  // open. Field is identified by data-show-when="non-operational".
  const statusSel = document.querySelector('#eqForm select[name="status"]');
  const noteGroup = document.querySelector('#eqForm [data-show-when="non-operational"]');
  if (statusSel && noteGroup) {
    statusSel.addEventListener('change', () => {
      const v = statusSel.value;
      noteGroup.style.display = ['operational', 'retired', 'archived'].includes(v) ? 'none' : '';
    });
  }

  document.getElementById('eqForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null) data[k] = v;
    }
    ['purchase_price', 'pm_interval_days'].forEach(k => {
      if (data[k] != null) data[k] = parseFloat(data[k]);
    });

    // v18.32 — When status flips back to operational, clear status_note.
    // The daily-log "Mark Operational" button does the same; this keeps
    // the two surfaces consistent. We explicitly set null (not just
    // skip) so the column gets cleared in the UPDATE payload.
    if (data.status === 'operational' || data.status === 'retired') {
      data.status_note = null;
    }

    // v18.18 — auto-compute next_pm_date from last_pm + interval. Only
    // overrides the field if the user left it blank OR if they
    // updated last_pm_date specifically (we assume they want the
    // computed date in that case). If they entered a specific
    // next_pm_date AND didn't touch last_pm, leave their value alone.
    if (data.last_pm_date && data.pm_interval_days) {
      const last = new Date(data.last_pm_date + 'T00:00:00');
      if (!isNaN(last)) {
        const next = new Date(last);
        next.setDate(next.getDate() + parseInt(data.pm_interval_days, 10));
        const nextIso = next.toISOString().slice(0, 10);
        // Override next_pm_date if it's blank OR if last_pm_date changed
        const priorLast = id ? (equipment.find(e => e.id === id) || {}).last_pm_date : null;
        const lastChanged = priorLast !== data.last_pm_date;
        if (!data.next_pm_date || lastChanged) {
          data.next_pm_date = nextIso;
        }
      }
    }

    try {
      // Auto-link manufacturer text to a manufacturers row so the brand
      // library populates organically. Fires whether new or existing.
      if (data.manufacturer && data.manufacturer.trim()) {
        const mfgId = await autoLinkManufacturer(data.manufacturer);
        if (mfgId) data.manufacturer_id = mfgId;
      } else if ('manufacturer' in data && !data.manufacturer) {
        // User cleared the manufacturer field — null out the FK too.
        data.manufacturer_id = null;
      }

      if (id) {
        // Snapshot the prior record so we can compute a diff after save.
        // Diff drives meaningful event logging — only changes worth
        // surfacing in the timeline get their own typed event; everything
        // else collapses into a single 'fields_edited' summary.
        const prior = equipment.find(e => e.id === id) || {};
        const priorSnap = {
          status: prior.status,
          location: prior.location,
          area: prior.area,
          name: prior.name,
          model: prior.model,
          serial_number: prior.serial_number,
          manufacturer: prior.manufacturer,
          notes: prior.notes,
        };
        const { error } = await NX.sb.from('equipment').update(data).eq('id', id);
        if (error) throw error;
        NX.toast && NX.toast('Equipment updated ✓', 'success');

        // Diff-based event logging — non-blocking
        const eqLoc = (data.location !== undefined ? data.location : priorSnap.location) || null;
        if (data.status !== undefined && data.status !== priorSnap.status) {
          logEquipmentEvent({
            equipmentId: id,
            eventType: 'status_change',
            location: eqLoc,
            payload: {
              from: priorSnap.status, to: data.status,
              from_label: STATUSES.find(s => s.key === priorSnap.status)?.label || priorSnap.status,
              to_label:   STATUSES.find(s => s.key === data.status)?.label || data.status,
              equipment_name: data.name || priorSnap.name,
              source: 'edit_form',
            },
          });
          // Same auto-ticket on the working→problem edge from the full editor.
          autoTicketForStatus(
            { id, name: data.name || priorSnap.name, status_note: (data.status_note !== undefined ? data.status_note : priorSnap.status_note) },
            data.status, priorSnap.status
          );
        }
        if ((data.location !== undefined && data.location !== priorSnap.location) ||
            (data.area !== undefined && data.area !== priorSnap.area)) {
          logEquipmentEvent({
            equipmentId: id,
            eventType: 'location_change',
            location: eqLoc,
            payload: {
              from: priorSnap.location, from_area: priorSnap.area,
              to: data.location !== undefined ? data.location : priorSnap.location,
              to_area: data.area !== undefined ? data.area : priorSnap.area,
              equipment_name: data.name || priorSnap.name,
            },
          });
        }
        // Catch-all "fields_edited" for everything else worth a row.
        const otherChangedFields = ['name','model','serial_number','manufacturer','notes']
          .filter(f => data[f] !== undefined && data[f] !== priorSnap[f]);
        if (otherChangedFields.length) {
          logEquipmentEvent({
            equipmentId: id,
            eventType: 'fields_edited',
            location: eqLoc,
            payload: {
              changed_fields: otherChangedFields,
              equipment_name: data.name || priorSnap.name,
            },
          });
        }
      } else {
        const { data: created, error } = await NX.sb.from('equipment').insert(data).select().single();
        if (error) throw error;
        NX.toast && NX.toast('Equipment created ✓', 'success');
        // Log the created event so new equipment appears at the top of
        // the activity log immediately.
        if (created && created.id) {
          logEquipmentEvent({
            equipmentId: created.id,
            eventType: 'created',
            location: created.location || null,
            payload: { equipment_name: created.name },
          });
        }
        // equipment_created syslog → now handled by Postgres trigger on equipment INSERT
      }
      closeEdit();
      await loadEquipment();
      renderList();
      if (id) openDetail(id);
    } catch (err) {
      console.error('[Equipment] Save error:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

function closeEdit() {
  const m = document.getElementById('eqEditModal');
  if (m) m.classList.remove('active');
}

/* Archive (soft-delete) equipment. Hides from main list while preserving
   all related records (parts, service history, attachments). Restorable
   from the archived view. Run this instead of deleteEquipment for the
   common case — true permanent deletion is now gated behind the archived
   list so the user has to find it twice over before losing data forever.

   Pre-migration safe: if the archived_at column doesn't exist yet, falls
   back to setting the legacy archived=true flag if that column exists. */
async function archiveEquipment(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  confirmArchiveEquipment(eq);
}

function confirmArchiveEquipment(eq) {
  document.querySelectorAll('.eq-confirm-overlay').forEach(n => n.remove());
  const overlay = document.createElement('div');
  overlay.className = 'eq-confirm-overlay';
  overlay.innerHTML = `
    <div class="eq-confirm-backdrop"></div>
    <div class="eq-confirm-modal" role="dialog" aria-label="Archive equipment">
      <div class="eq-confirm-icon">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="21 8 21 21 3 21 3 8"/>
          <rect x="1" y="3" width="22" height="5"/>
          <line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
      </div>
      <div class="eq-confirm-title">Archive this equipment?</div>
      <div class="eq-confirm-body">
        <div class="eq-confirm-line"><strong>${esc(eq.name || 'Unnamed')}</strong></div>
        <div class="eq-confirm-sub">${esc(eq.location || '')}${eq.model ? ' · ' + esc(eq.model) : ''}</div>
        <div class="eq-confirm-warn">It will be hidden from the main list. Parts, service history, and attachments are preserved. You can restore it any time from the <strong>Archived</strong> filter.</div>
      </div>
      <div class="eq-confirm-actions">
        <button class="eq-confirm-cancel" type="button">Cancel</button>
        <button class="eq-confirm-archive" type="button">Archive</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.eq-confirm-backdrop').addEventListener('click', close);
  overlay.querySelector('.eq-confirm-cancel').addEventListener('click', close);
  overlay.querySelector('.eq-confirm-archive').addEventListener('click', async () => {
    const btn = overlay.querySelector('.eq-confirm-archive');
    btn.disabled = true;
    btn.textContent = 'Archiving…';
    try {
      await applyArchiveEquipment(eq.id);
      close();
      closeDetail();
      NX.toast && NX.toast(`Archived ${eq.name}`, 'info', 1800);
    } catch (err) {
      console.error('[Equipment] archive failed:', err);
      btn.disabled = false;
      btn.textContent = 'Archive';
      NX.toast && NX.toast('Could not archive: ' + (err.message || ''), 'error', 3000);
    }
  });
}

async function applyArchiveEquipment(id) {
  // Try modern archived_at column first; fall back to boolean archived
  // for legacy schemas. Either way the in-memory record is updated so
  // the list filters it out without a full reload.
  const eq = equipment.find(e => e.id === id);
  const stamp = new Date().toISOString();
  let res = await NX.sb.from('equipment')
    .update({ archived_at: stamp })
    .eq('id', id);
  if (res.error && /archived_at|column.*does not exist|schema cache/i.test(res.error.message || '')) {
    res = await NX.sb.from('equipment')
      .update({ archived: true })
      .eq('id', id);
  }
  if (res.error) throw res.error;
  if (eq) {
    eq.archived_at = stamp;
    eq.archived = true;
  }
  // Log the activity event — non-blocking
  logEquipmentEvent({
    equipmentId: id,
    eventType: 'archived',
    location: eq && eq.location,
    payload: { archived_at: stamp, equipment_name: eq && eq.name },
  });
  renderList();
}

async function restoreEquipment(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  try {
    let res = await NX.sb.from('equipment')
      .update({ archived_at: null })
      .eq('id', id);
    if (res.error && /archived_at|column.*does not exist|schema cache/i.test(res.error.message || '')) {
      res = await NX.sb.from('equipment')
        .update({ archived: false })
        .eq('id', id);
    }
    if (res.error) throw res.error;
    eq.archived_at = null;
    eq.archived = false;
    // Log the activity event — non-blocking
    logEquipmentEvent({
      equipmentId: id,
      eventType: 'restored',
      location: eq.location,
      payload: { restored_at: new Date().toISOString(), equipment_name: eq.name },
    });
    renderList();
    NX.toast && NX.toast(`Restored ${eq.name}`, 'info', 1800);
  } catch (err) {
    console.error('[Equipment] restore failed:', err);
    NX.toast && NX.toast('Could not restore: ' + (err.message || ''), 'error', 3000);
  }
}

/* Hard delete — kept for the rare "I really mean it" case, surfaced only
   from the archived view (so you have to archive first, then choose to
   remove forever from there). The old name stays so existing call sites
   still work, but the user-facing path is now archive. */
async function deleteEquipment(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  // Already-archived: this is the permanent-delete path
  const isArchived = !!(eq.archived_at || eq.archived);
  const promptText = isArchived
    ? `Delete ${eq.name} forever? Parts, service history, and attachments will all be erased. Cannot be undone.`
    : `Archive ${eq.name}? Hidden from list, restorable later.`;
  if (!isArchived) {
    return archiveEquipment(id);
  }
  if (!confirm(promptText)) return;
  try {
    // The schema has no FK constraints, so deleting only the equipment row
    // would strand its children as orphans — while the confirm above promises
    // they're erased. Clean the equipment-OWNED records first (best-effort per
    // table: a missing table must not block the delete). Cross-domain records
    // (tickets, kanban cards, dispatch history) are deliberately left alone —
    // they belong to other workflows' histories.
    const owned = [
      'equipment_maintenance', 'equipment_parts', 'equipment_attachments',
      'equipment_manuals', 'equipment_custom_fields', 'equipment_compliance',
      'equipment_events', 'equipment_issues', 'pm_schedules', 'pm_logs',
    ];
    for (const t of owned) {
      try { await NX.sb.from(t).delete().eq('equipment_id', id); } catch (_) {}
    }
    const { error } = await NX.sb.from('equipment').delete().eq('id', id);
    if (error) throw error;
    NX.toast && NX.toast('Deleted ✓', 'success');
    closeDetail();
    await loadEquipment();
    renderList();
  } catch (err) {
    console.error('[Equipment] Delete error:', err);
    NX.toast && NX.toast('Delete failed: ' + err.message, 'error');
  }
}

/**
 * Pre-seed bulk selection with one piece of equipment and open the
 * PM scheduler. Used by the overflow menu "Schedule PM" item so users
 * can fire a single-equipment PM date without having to open bulk
 * mode and tap the row first.
 */
function schedulePmFromOverflow(equipId) {
  if (!bulkSelectionState) return;
  bulkSelectionState.active = true;
  bulkSelectionState.selected = new Set([equipId]);
  document.body.classList.add('eq-bulk-mode');
  if (typeof renderBulkToolbar === 'function') renderBulkToolbar();
  if (typeof openBulkPmSchedule === 'function') openBulkPmSchedule();
}

// Programmatically switch the open equipment detail modal to a tab
// (overview/timeline/activity/parts/manual/intel/qr). Reuses the tab's own
// click handler so lazy-loaded panels still hydrate. Used by the Overview's
// "Last service / Services (YTD)" rows to jump to the full service history.
function showDetailTab(tabName) {
  const modal = document.getElementById('eqModal');
  if (!modal) return;
  const tab = modal.querySelector(`.eq-tab[data-tab="${tabName}"]`);
  if (tab) tab.click();
}

async function logService(equipId, editId) {
  const eq = equipment.find(e => e.id === equipId);
  if (!eq) return;

  // Edit mode: pull the existing service record so the form is pre-filled.
  let ev = {};
  if (editId) {
    try {
      const { data } = await NX.sb.from('equipment_maintenance').select('*').eq('id', editId).single();
      if (data) ev = data;
    } catch (e) { NX.toast && NX.toast('Could not load that service', 'error'); }
  }

  const modal = document.getElementById('eqServiceModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqServiceModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const today = new Date().toISOString().slice(0, 10);
  const types = [['repair','Repair'],['pm','Preventive Maintenance'],['inspection','Inspection'],['install','Install'],['recall','Recall']];
  const curType = ev.event_type || 'repair';
  const av = (v) => esc(v == null ? '' : String(v));          // safe value/text
  const dval = (d) => d ? String(d).slice(0, 10) : '';        // ISO date → yyyy-mm-dd

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeService()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeService()">${uiSvg("close", "16px")}</button>
        <h2>${editId ? 'Edit Service' : 'Log Service'} — ${esc(eq.name)}</h2>
      </div>
      <div class="eq-detail-body">
        <form class="eq-form" id="eqServiceForm">
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Type</label>
              <select name="event_type">
                ${types.map(([v, l]) => `<option value="${v}"${v === curType ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Date *</label>
              <input type="date" name="event_date" value="${dval(ev.event_date) || today}" required>
            </div>
          </div>
          <div class="eq-form-group">
            <label>What was done? *</label>
            <textarea name="description" rows="3" required placeholder="Replaced condenser fan motor...">${av(ev.description)}</textarea>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Performed By</label>
              <input name="performed_by" placeholder="Austin Air & Ice / Tyler" value="${av(ev.performed_by)}">
            </div>
            <div class="eq-form-group">
              <label>Cost ($)</label>
              <input type="number" step="0.01" name="cost" placeholder="450.00" value="${av(ev.cost)}">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Downtime (hours)</label>
              <input type="number" step="0.5" name="downtime_hours" value="${av(ev.downtime_hours)}">
            </div>
            <div class="eq-form-group">
              <label>Labor Hours</label>
              <input type="number" step="0.5" name="labor_hours" value="${av(ev.labor_hours)}">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Symptoms</label>
            <textarea name="symptoms" rows="2" placeholder="What was wrong?">${av(ev.symptoms)}</textarea>
          </div>
          <div class="eq-form-group">
            <label>Root Cause</label>
            <textarea name="root_cause" rows="2" placeholder="What did they find?">${av(ev.root_cause)}</textarea>
          </div>
          <div class="eq-form-group">
            <label>Next PM Due (optional)</label>
            <input type="date" name="next_pm_due" value="${dval(ev.next_pm_due)}">
          </div>
          <div class="eq-form-group">
            <label><input type="checkbox" name="warranty_claim"${ev.warranty_claim ? ' checked' : ''}> Warranty claim</label>
          </div>
          <div class="eq-form-actions">
            ${editId ? `<button type="button" class="eq-btn eq-btn-danger" onclick="NX.modules.equipment.deleteMaintenance('${editId}','${equipId}')">Delete</button>` : ''}
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeService()">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">${editId ? 'Save Changes' : 'Log Service'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqServiceForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { equipment_id: equipId };
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null) {
        if (k === 'warranty_claim') data[k] = true;
        else if (['cost', 'downtime_hours', 'labor_hours'].includes(k)) data[k] = parseFloat(v);
        else data[k] = v;
      }
    }

    // ─── Inventory Phase C hook: PM parts consumption ─────────────
    // Before logging the maintenance event, if this is a PM and the
    // inventory module is loaded, show the parts-used modal. Stock
    // counts are decremented and reorder cards are auto-created.
    const persistMaintenance = async () => {
      try {
        // next_pm_due is an equipment field, not a maintenance column — keep
        // it out of the row write, then apply it to the equipment separately.
        const { next_pm_due, ...row } = data;
        const { error } = editId
          ? await NX.sb.from('equipment_maintenance').update(row).eq('id', editId)
          : await NX.sb.from('equipment_maintenance').insert(row);
        if (error) throw error;
        if (next_pm_due) {
          await NX.sb.from('equipment').update({ next_pm_date: next_pm_due }).eq('id', equipId);
        }

        // v18.20 — When event_type='pm', also update equipment.last_pm_date
        // so the countdown progress bar restarts. Auto-compute next_pm_date
        // from last + interval if user didn't already supply one via
        // data.next_pm_due. Defensive: column missing pre-migration is
        // silently ignored so older DBs don't break PM logging.
        if (data.event_type === 'pm' && data.event_date) {
          const eqUpdate = { last_pm_date: data.event_date };
          if (!data.next_pm_due) {
            const eqRow = equipment.find(e => e.id === equipId);
            const interval = eqRow ? parseInt(eqRow.pm_interval_days, 10) : 0;
            if (interval > 0) {
              const last = new Date(data.event_date + 'T00:00:00');
              if (!isNaN(last)) {
                const next = new Date(last);
                next.setDate(next.getDate() + interval);
                eqUpdate.next_pm_date = next.toISOString().slice(0, 10);
              }
            }
          }
          const { error: pmErr } = await NX.sb.from('equipment').update(eqUpdate).eq('id', equipId);
          if (pmErr && !/column.+last_pm_date.+does not exist/i.test(pmErr.message || '')) {
            console.warn('[Equipment] last_pm_date update warning:', pmErr.message);
          }
        }

        try { await NX.sb.rpc('recompute_health_score', { eq_id: equipId }); } catch(e){}

        NX.toast && NX.toast(editId ? 'Service updated ✓' : 'Service logged ✓', 'success');
        // equipment_service syslog → now handled by Postgres trigger on equipment_maintenance INSERT

        closeService();
        await loadEquipment();
        openDetail(equipId);
      } catch (err) {
        console.error('[Equipment] Service log error:', err);
        NX.toast && NX.toast('Save failed: ' + err.message, 'error');
      }
    };

    if (data.event_type === 'pm' && NX.modules?.inventory?.openPmCompletionModal) {
      const eqRow = equipment.find(e => e.id === equipId);
      const eqName = eqRow?.name || 'Equipment';
      NX.modules.inventory.openPmCompletionModal(equipId, eqName, () => {
        // Whether the user confirmed parts or skipped, proceed to log the PM.
        persistMaintenance();
      });
    } else {
      await persistMaintenance();
    }
  });
}

function closeService() {
  const m = document.getElementById('eqServiceModal');
  if (m) m.classList.remove('active');
}

async function deleteMaintenance(id, equipId) {
  if (!confirm('Delete this service record?')) return;
  try {
    await NX.sb.from('equipment_maintenance').delete().eq('id', id);
    NX.toast && NX.toast('Deleted ✓', 'success');
    closeService();                 // close the edit sheet if the delete came from it
    try { await NX.sb.rpc('recompute_health_score', { eq_id: equipId }); } catch(e){}
    await loadEquipment();          // refresh YTD count / aggregates
    openDetail(equipId);
  } catch(e) { console.error(e); NX.toast && NX.toast('Delete failed', 'error'); }
}

/* ─── Parts CRUD ─── */

function addPart(equipId) { openPartModal(null, equipId); }

async function editPart(partId) {
  const { data } = await NX.sb.from('equipment_parts').select('*').eq('id', partId).single();
  if (!data) return;
  openPartModal(data, data.equipment_id);
}

function openPartModal(part, equipId) {
  const p = part || { part_name:'', oem_part_number:'', quantity:1, supplier:'', last_price:'', supplier_url:'', assembly_path:'', notes:'' };
  const isNew = !part;

  const modal = document.getElementById('eqPartModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqPartModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  // Picker block — only shown when adding a new part. Lets the user pick
  // from already-cataloged parts (deduped by name+OEM across all
  // equipment) instead of retyping everything. Picking pre-fills the
  // form including vendors[] so the new row inherits all known sources.
  const pickerHTML = isNew ? `
    <div class="eq-part-picker">
      <label class="eq-part-picker-label">Pick from existing parts <span class="eq-part-form-hint">— or fill in below for a brand-new part</span></label>
      <input type="text" class="eq-part-picker-input" id="eqPartPickerSearch" placeholder="Search by name or OEM…" autocomplete="off">
      <div class="eq-part-picker-results" id="eqPartPickerResults" hidden></div>
    </div>
  ` : '';

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closePart()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closePart()">${uiSvg("close", "16px")}</button>
        <h2>${part ? 'Edit' : 'Add'} Part</h2>
      </div>
      <div class="eq-detail-body">
        ${pickerHTML}
        <form class="eq-form" id="eqPartForm">
          <div class="eq-form-group">
            <label>Part Name *</label>
            <input name="part_name" value="${esc(p.part_name)}" required placeholder="Evaporator fan motor">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>OEM Part Number</label>
              <input name="oem_part_number" value="${esc(p.oem_part_number||'')}">
            </div>
            <div class="eq-form-group">
              <label>Quantity</label>
              <input type="number" name="quantity" value="${p.quantity||1}" min="1">
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Supplier</label>
              <input name="supplier" value="${esc(p.supplier||'')}" placeholder="Parts Town">
            </div>
            <div class="eq-form-group">
              <label>Last Price ($)</label>
              <input type="number" step="0.01" name="last_price" value="${p.last_price||''}">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Supplier URL</label>
            <input type="url" name="supplier_url" value="${esc(p.supplier_url||'')}" placeholder="https://partstown.com/...">
          </div>
          <div class="eq-form-group">
            <label>Assembly Path</label>
            <input name="assembly_path" value="${esc(p.assembly_path||'')}" placeholder="compressor > refrigeration > fan">
          </div>
          <div class="eq-form-group">
            <label>Notes</label>
            <textarea name="notes" rows="2">${esc(p.notes||'')}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closePart()">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">${part ? 'Save' : 'Add Part'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Wire up the picker for new-part mode.
  if (isNew) wirePartLibraryPicker(modal);

  document.getElementById('eqPartForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { equipment_id: equipId };
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null) {
        if (['quantity'].includes(k)) data[k] = parseInt(v);
        else if (['last_price'].includes(k)) data[k] = parseFloat(v);
        else data[k] = v;
      }
    }
    // If the picker pre-loaded vendors[], pass them through so the new
    // part row starts with all the sources from the existing record.
    if (Array.isArray(modal._pickedVendors) && modal._pickedVendors.length) {
      data.vendors = modal._pickedVendors;
    }
    try {
      if (part) {
        await NX.sb.from('equipment_parts').update(data).eq('id', part.id);
      } else {
        await NX.sb.from('equipment_parts').insert(data);
      }
      NX.toast && NX.toast('Saved ✓', 'success');
      closePart();
      openDetail(equipId);
    } catch (err) {
      console.error(err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

/* ────────────────────────────────────────────────────────────────────
   Parts library picker
   ────────────────────────────────────────────────────────────────────
   On open, fetch every part across all equipment, dedupe by
   (name|oem) so each unique part appears once. As user types in the
   search box, filter and show top matches. Tap a match → pre-fill all
   the form fields with its data (and stash its vendors[] so the new
   row inherits sources too).
   ──────────────────────────────────────────────────────────────────── */
async function wirePartLibraryPicker(modal) {
  const searchInput = modal.querySelector('#eqPartPickerSearch');
  const resultsBox  = modal.querySelector('#eqPartPickerResults');
  const form        = modal.querySelector('#eqPartForm');
  if (!searchInput || !resultsBox || !form) return;

  // Pull the catalog. Failure is non-fatal — picker just stays empty.
  let catalog = [];
  try {
    const { data, error } = await NX.sb.from('equipment_parts')
      .select('id, part_name, oem_part_number, supplier, supplier_url, last_price, assembly_path, notes, lead_time_days, replacement_interval_months, vendors')
      .order('part_name', { ascending: true });
    if (error) throw error;
    // Dedupe by lowercase(name)+oem so we don't show the same part 6
    // times because it lives on 6 different units. Keep the most-
    // recently-touched record (assumed first since we ordered by name —
    // but we could refine by created_at/updated_at if needed).
    const seen = new Map();
    for (const row of (data || [])) {
      const key = (row.part_name || '').toLowerCase().trim() + '|' + (row.oem_part_number || '').toLowerCase().trim();
      if (!seen.has(key)) seen.set(key, row);
    }
    catalog = Array.from(seen.values());
  } catch (e) {
    console.warn('[parts] picker catalog load failed:', e);
    return;
  }

  // Render top matches for the current query. Empty query → top 8 by name.
  const renderResults = (q) => {
    const query = (q || '').toLowerCase().trim();
    let matches;
    if (!query) {
      matches = catalog.slice(0, 8);
    } else {
      matches = catalog.filter(row => {
        const n = (row.part_name || '').toLowerCase();
        const o = (row.oem_part_number || '').toLowerCase();
        return n.includes(query) || o.includes(query);
      }).slice(0, 8);
    }

    if (!matches.length) {
      resultsBox.innerHTML = `<div class="eq-part-picker-empty">No matches — fill the form below for a new part.</div>`;
      resultsBox.hidden = false;
      return;
    }

    resultsBox.innerHTML = matches.map((row, idx) => {
      const vendorCount = Array.isArray(row.vendors) ? row.vendors.length : (row.supplier ? 1 : 0);
      const sourcesHint = vendorCount
        ? `${vendorCount} source${vendorCount === 1 ? '' : 's'}`
        : 'no sources yet';
      return `
        <button type="button" class="eq-part-picker-result" data-idx="${idx}">
          <div class="eq-part-picker-result-name">${esc(row.part_name || '(unnamed)')}</div>
          <div class="eq-part-picker-result-meta">
            ${row.oem_part_number ? `<span class="eq-part-picker-result-oem">${esc(row.oem_part_number)}</span>` : ''}
            <span class="eq-part-picker-result-sources">${esc(sourcesHint)}</span>
          </div>
        </button>
      `;
    }).join('');
    resultsBox.hidden = false;

    resultsBox.querySelectorAll('[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = matches[parseInt(btn.dataset.idx, 10)];
        if (row) applyPickedPart(row);
      });
    });
  };

  // Pour the picked record into the form fields. Strips id + equipment_id
  // so the saved row is brand-new for THIS equipment, not a clone of the
  // source equipment's part.
  const applyPickedPart = (row) => {
    const setVal = (name, val) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && val != null) el.value = val;
    };
    setVal('part_name',        row.part_name);
    setVal('oem_part_number',  row.oem_part_number);
    setVal('assembly_path',    row.assembly_path);
    setVal('notes',            row.notes);
    // Source fields: prefer vendors[] preferred entry if present,
    // fall back to legacy single-supplier fields.
    let preferred = null;
    if (Array.isArray(row.vendors) && row.vendors.length) {
      preferred = row.vendors.find(v => v.is_preferred) || row.vendors[0];
      modal._pickedVendors = row.vendors.slice();
    } else if (row.supplier || row.supplier_url || row.last_price) {
      preferred = { name: row.supplier, url: row.supplier_url, price: row.last_price };
    }
    if (preferred) {
      setVal('supplier',     preferred.name  || '');
      setVal('supplier_url', preferred.url   || '');
      setVal('last_price',   preferred.price || '');
    }
    // Hide picker after selection — the form is now pre-filled.
    resultsBox.hidden = true;
    searchInput.value = '';
    NX.toast && NX.toast(`Loaded "${row.part_name}" — review and save`, 'info', 1800);
  };

  // Show on focus, filter on input, hide on outside click.
  searchInput.addEventListener('focus', () => renderResults(searchInput.value));
  searchInput.addEventListener('input', () => renderResults(searchInput.value));
  document.addEventListener('click', (e) => {
    if (!modal.contains(e.target)) return;
    if (!resultsBox.contains(e.target) && e.target !== searchInput) {
      resultsBox.hidden = true;
    }
  });
}

function closePart() {
  const m = document.getElementById('eqPartModal');
  if (m) m.classList.remove('active');
}

async function deletePart(id, equipId) {
  if (!confirm('Delete this part?')) return;
  try {
    await NX.sb.from('equipment_parts').delete().eq('id', id);
    NX.toast && NX.toast('Deleted ✓', 'success');
    openDetail(equipId);
  } catch(e) { console.error(e); }
}

/* ════════════════════════════════════════════════════════════════════════════
   MULTI-VENDOR PARTS
   
   Each part has a `vendors` JSONB column on equipment_parts. Each vendor:
     { name, url, oem_number, price, in_stock, notes, last_checked_at, is_preferred }
   
   After renderParts() inserts the .eq-parts-list into the DOM, the tab
   switcher calls enhancePartsList() which finds each .eq-part[data-part-id]
   row, loads its full record, and appends a vendor accordion below.
   
   Legacy data (parts with supplier/supplier_url/last_price but no vendors[])
   auto-migrates to a single preferred vendor.
   ════════════════════════════════════════════════════════════════════════════ */

async function enhancePartsList(list) {
  if (!list || list.dataset.enhanced === '1') return;
  list.dataset.enhanced = '1';
  const rows = list.querySelectorAll('.eq-part[data-part-id]');
  for (const partEl of rows) {
    const partId = partEl.dataset.partId;
    if (!partId) continue;
    await renderVendorsUnderPart(partEl, partId);
  }
}

async function renderVendorsUnderPart(partEl, partId) {
  let part;
  try {
    const { data } = await NX.sb.from('equipment_parts').select('*').eq('id', partId).single();
    part = data;
  } catch (e) {
    console.warn('[parts] could not load', partId, e);
    return;
  }
  if (!part) return;

  // Migrate legacy single-vendor fields to vendors[] if empty
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
      is_preferred: true
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
      ${renderVendorsListHTML(vendors, partId)}
    </div>
  `;
  partEl.appendChild(container);
  wireVendorActions(container, part, vendors);
}

function renderVendorsListHTML(vendors, partId) {
  if (!vendors.length) {
    return '<div class="eq-part-vendors-empty">No vendors yet. Tap + Vendor to add one.</div>';
  }
  return vendors.map((v, idx) => `
    <div class="eq-part-vendor${v.is_preferred ? ' is-preferred' : ''}" data-vendor-idx="${idx}">
      <div class="eq-part-vendor-main">
        <div class="eq-part-vendor-row1">
          ${v.is_preferred ? `<span class="eq-part-vendor-star">${uiSvg('filledStar', '11px')} PREFERRED</span>` : ''}
          <span class="eq-part-vendor-name">${esc(v.name || 'Unnamed')}</span>
        </div>
        <div class="eq-part-vendor-row2">
          ${v.oem_number ? `<span class="eq-part-vendor-oem">${esc(v.oem_number)}</span>` : ''}
          ${v.in_stock === true ? '<span class="eq-part-vendor-stock in">In stock</span>' : ''}
          ${v.in_stock === false ? '<span class="eq-part-vendor-stock out">Out</span>' : ''}
          ${v.last_checked_at ? `<span class="eq-part-vendor-checked">${formatVendorRelative(v.last_checked_at)}</span>` : ''}
        </div>
        ${v.notes ? `<div class="eq-part-vendor-notes">${esc(v.notes)}</div>` : ''}
      </div>
      <div class="eq-part-vendor-price">${v.price ? `$${parseFloat(v.price).toFixed(2)}` : ''}</div>
      <div class="eq-part-vendor-actions">
        ${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="eq-part-vendor-btn order" data-action="order" data-vendor-idx="${idx}">Order</a>` : ''}
        ${!v.is_preferred ? `<button class="eq-part-vendor-btn star-btn" data-action="prefer" data-vendor-idx="${idx}" title="Mark preferred" aria-label="Mark preferred">${uiSvg('star', '14px')}</button>` : ''}
        <button class="eq-part-vendor-btn edit-btn" data-action="edit" data-vendor-idx="${idx}" title="Edit" aria-label="Edit">${uiSvg('pen', '14px')}</button>
        <button class="eq-part-vendor-btn remove-btn" data-action="remove" data-vendor-idx="${idx}" title="Remove" aria-label="Remove">${uiSvg('close', '14px')}</button>
      </div>
    </div>
  `).join('');
}

function wireVendorActions(container, part, vendors) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.vendorIdx, 10);

    if (action === 'order') {
      // Log the order action but let the link navigate naturally
      try {
        await NX.sb.from('daily_logs').insert({
          entry: `[ORDER] ${NX.currentUser?.name || 'User'} opened ${vendors[idx].name} for "${part.part_name}" ($${vendors[idx].price || '?'})`
        });
      } catch (_) {}
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (action === 'prefer') {
      vendors.forEach((v, i) => v.is_preferred = (i === idx));
      await saveVendors(part.id, vendors);
      rerenderVendorList(container, part.id, vendors);
    } else if (action === 'edit') {
      openVendorEditor(vendors[idx], async (updated) => {
        vendors[idx] = updated;
        await saveVendors(part.id, vendors);
        rerenderVendorList(container, part.id, vendors);
      });
    } else if (action === 'remove') {
      if (!confirm(`Remove vendor "${vendors[idx].name}"?`)) return;
      vendors.splice(idx, 1);
      await saveVendors(part.id, vendors);
      rerenderVendorList(container, part.id, vendors);
    }
  });

  const addBtn = container.querySelector('.eq-part-add-vendor-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openVendorEditor(null, async (newVendor) => {
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
  if (list) list.innerHTML = renderVendorsListHTML(vendors, partId);
  const label = container.querySelector('.eq-part-vendors-label');
  if (label) label.textContent = `Vendors (${vendors.length})`;
}

async function saveVendors(partId, vendors) {
  try {
    await NX.sb.from('equipment_parts').update({ vendors }).eq('id', partId);
    // Keep legacy single-vendor fields in sync with the preferred vendor
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
    NX.toast && NX.toast('Save vendors failed: ' + e.message, 'error');
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
        <button class="eq-vendor-close">${uiSvg("close", "13px")}</button>
      </div>
      <div class="eq-vendor-body">
        <label class="eq-vendor-label">Vendor Name</label>
        <input type="text" id="vendName" class="eq-vendor-input" value="${escAttr(v.name)}" placeholder="Parts Town">
        <label class="eq-vendor-label">Order URL</label>
        <input type="url" id="vendUrl" class="eq-vendor-input" value="${escAttr(v.url || '')}" placeholder="https://...">
        <div class="eq-vendor-row">
          <div class="eq-vendor-half">
            <label class="eq-vendor-label">OEM Number</label>
            <input type="text" id="vendOem" class="eq-vendor-input" value="${escAttr(v.oem_number || '')}" placeholder="1701514">
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
    if (!updated.name) { NX.toast && NX.toast('Vendor name required', 'info'); return; }
    onSave(updated);
    close();
  });
}

function formatVendorRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  if (days < 365) return Math.floor(days / 30) + 'mo ago';
  return Math.floor(days / 365) + 'y ago';
}

/* ════════════════════════════════════════════════════════════════════════════
   MANUAL VIEWER — multi-manual list with PDF thumbnails
   
   Called by the tabs wiring when the Manual panel becomes active. Loads all
   manual rows for the equipment from equipment_manuals, renders each as a
   card with a PDF thumbnail, editable name, and Open / Remove actions.
   v14 evolution of the older single-iframe enhanceManualPanel().
   ════════════════════════════════════════════════════════════════════════════ */

// One-time, idempotent backfill: if this equipment has a legacy
// equipment.manual_url but NO matching row in equipment_manuals, copy
// it over so the multi-manual UI can treat equipment_manuals as the
// source of truth. Handles three cases:
//   1. The SQL migration was never run.
//   2. The migration ran, but this equipment was added afterwards.
//   3. The user uploaded via an old build that only wrote to manual_url.
// Safe to call repeatedly — does nothing once a row exists.
async function ensureLegacyManualMigrated(equipId) {
  try {
    const { data: eq } = await NX.sb.from('equipment')
      .select('manual_url').eq('id', equipId).single();
    if (!eq || !eq.manual_url) return;

    const { count } = await NX.sb.from('equipment_manuals')
      .select('id', { count: 'exact', head: true })
      .eq('equipment_id', equipId)
      .eq('url', eq.manual_url);
    if (count && count > 0) return; // already migrated

    // Best-effort default name from the URL: strip leading "<timestamp>-",
    // drop the .pdf extension, decode URI escapes. Falls back to "Manual"
    // if the URL was opaque.
    let legacyName = (eq.manual_url.split('/').pop() || '').split('?')[0];
    try { legacyName = decodeURIComponent(legacyName); } catch (_) {}
    legacyName = legacyName.replace(/^\d+-/, '').replace(/\.pdf$/i, '').slice(0, 100);
    if (!legacyName) legacyName = 'Manual';

    await NX.sb.from('equipment_manuals').insert({
      equipment_id: equipId,
      name: legacyName,
      url: eq.manual_url,
      kind: 'pdf',
      sort_order: 0
    });
  } catch (err) {
    // Don't block the UI on backfill errors — the legacy fallback card
    // path will still render the user's existing manual.
    console.warn('[manual] backfill skipped:', err.message || err);
  }
}

async function hydrateManualPanel(panel, equipId) {
  const root = panel.querySelector('.eq-manual');
  if (!root || root.dataset.hydrated === '1') return;
  root.dataset.hydrated = '1';

  const list = panel.querySelector(`#eqManualList-${equipId}`);
  if (!list) return;

  // Auto-migrate any legacy manual_url into equipment_manuals so the
  // multi-manual UI shows it as a real card (editable name + Remove)
  // instead of the read-only legacy fallback. Idempotent — no-op once
  // the row exists.
  await ensureLegacyManualMigrated(equipId);

  // Pull all manuals for this equipment, ordered by sort_order then created.
  const { data: manuals, error } = await NX.sb
    .from('equipment_manuals')
    .select('*')
    .eq('equipment_id', equipId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[manual] load failed:', error);
    list.innerHTML = '<div class="eq-empty-small">Could not load manuals.</div>';
    return;
  }

  // Backward-compat fallback: if equipment_manuals returned nothing but the
  // legacy equipment.manual_url is set, surface it as a single read-only
  // card so the user isn't suddenly missing their existing manual. The SQL
  // migration normally handles this, but this protects against the case
  // where the user uploaded before the migration ran.
  if (!manuals || manuals.length === 0) {
    const { data: eq } = await NX.sb.from('equipment')
      .select('manual_url, manual_source_url')
      .eq('id', equipId).single();
    if (eq && eq.manual_url) {
      list.innerHTML = renderLegacyManualCard(eq.manual_url);
      const card = list.querySelector('.eq-manual-card');
      if (card) {
        const thumb = card.querySelector('.eq-manual-card-thumb');
        const pages = card.querySelector('.eq-manual-card-pages');
        renderPdfThumbnail(eq.manual_url, thumb, pages);
      }
      return;
    }
    const sourceLine = (eq && eq.manual_source_url)
      ? `<p class="eq-mt"><a href="${esc(eq.manual_source_url)}" target="_blank">Original source ↗</a></p>`
      : '';
    list.innerHTML = `<div class="eq-empty-small"><p>No manuals yet. Upload a PDF or use Find Online.</p>${sourceLine}</div>`;
    return;
  }

  // Render every manual as a card.
  list.innerHTML = manuals.map(m => renderManualCardFromRow(m)).join('');

  // Kick off PDF thumbnail rendering for each PDF manual.
  manuals.forEach(m => {
    if (m.kind === 'pdf' && m.url) {
      const thumb = list.querySelector(`#eqManualThumb-${m.id}`);
      const pages = list.querySelector(`#eqManualPages-${m.id}`);
      if (thumb && pages) renderPdfThumbnail(m.url, thumb, pages);
    }
  });
}

function renderManualCardFromRow(m) {
  // Best-effort fallback display name if m.name is empty.
  let fallback = (m.url || '').split('/').pop().split('?')[0];
  try { fallback = decodeURIComponent(fallback); } catch (_) {}
  const displayName = m.name && m.name.trim() ? m.name : (fallback || 'Manual');
  const isPdf = m.kind === 'pdf';
  return `
    <div class="eq-manual-card" data-manual-id="${m.id}">
      <div class="eq-manual-card-thumb" id="eqManualThumb-${m.id}">
        ${isPdf
          ? `<div class="eq-manual-card-loading">Loading preview…</div>`
          : `<div class="eq-manual-card-thumb-fallback">${uiSvg('link','32px')}</div>`}
      </div>
      <div class="eq-manual-card-info">
        <div class="eq-manual-card-icon">${uiSvg(isPdf ? 'document' : 'link', '32px')}</div>
        <div class="eq-manual-card-meta">
          <input type="text"
                 class="eq-manual-card-name-input"
                 value="${escAttr(displayName)}"
                 data-orig="${escAttr(displayName)}"
                 onblur="NX.modules.equipment.renameManual('${m.id}', this.value, this.dataset.orig)"
                 onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){this.value=this.dataset.orig;this.blur();}"
                 aria-label="Manual name">
          <div class="eq-manual-card-pages" id="eqManualPages-${m.id}">${isPdf ? 'PDF Document' : 'Web link'}</div>
        </div>
      </div>
      <div class="eq-manual-card-actions">
        <a href="${esc(m.url)}" target="_blank" rel="noopener" class="eq-manual-card-open-btn">Open Manual ↗</a>
        <button class="eq-manual-card-secondary-btn" onclick="NX.modules.equipment.removeManualById('${m.id}')">Remove</button>
      </div>
    </div>`;
}

function renderLegacyManualCard(url) {
  // Used only when equipment.manual_url is set but no equipment_manuals row
  // exists yet (e.g., migration hasn't run). Read-only — the user can still
  // re-upload to get into the new system, but we don't expose rename here.
  let fileName = url.split('/').pop().split('?')[0];
  try { fileName = decodeURIComponent(fileName); } catch (_) {}
  return `
    <div class="eq-manual-card eq-manual-card-legacy">
      <div class="eq-manual-card-thumb">
        <div class="eq-manual-card-loading">Loading preview…</div>
      </div>
      <div class="eq-manual-card-info">
        <div class="eq-manual-card-icon">${uiSvg('document', '32px')}</div>
        <div class="eq-manual-card-meta">
          <div class="eq-manual-card-name">${esc(fileName)}</div>
          <div class="eq-manual-card-pages">PDF Document</div>
        </div>
      </div>
      <div class="eq-manual-card-actions">
        <a href="${esc(url)}" target="_blank" rel="noopener" class="eq-manual-card-open-btn">Open Manual ↗</a>
      </div>
    </div>`;
}

async function renderPdfThumbnail(url, thumbContainer, pagesEl) {
  if (!thumbContainer) return;
  if (!window.pdfjsLib) {
    thumbContainer.innerHTML = `<div class="eq-manual-card-thumb-fallback">${uiSvg('document','32px')}</div>`;
    return;
  }
  try {
    const loadingTask = window.pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    if (pagesEl) pagesEl.textContent = `PDF · ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
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
    console.warn('[manual] PDF thumbnail failed:', err);
    thumbContainer.innerHTML = `<div class="eq-manual-card-thumb-fallback">${uiSvg('document','32px')}</div>`;
  }
}

async function removeManualById(manualId) {
  if (!confirm('Remove this manual?')) return;
  // Look up the manual to find its equipment so we can refresh after.
  const { data: m } = await NX.sb.from('equipment_manuals')
    .select('equipment_id, url')
    .eq('id', manualId).single();
  if (!m) return;

  const { error } = await NX.sb.from('equipment_manuals').delete().eq('id', manualId);
  if (error) {
    console.error('[manual] delete failed:', error);
    NX.toast && NX.toast('Remove failed: ' + error.message, 'error');
    return;
  }

  // Keep equipment.manual_url synced with whichever manual is now first.
  // If we deleted what was pinned to manual_url, point at the next one (or
  // null if none remain). Other code paths (Print Everything, AI scanner,
  // etc.) still reference manual_url as a single primary URL, so this
  // keeps backward compat.
  const { data: remaining } = await NX.sb.from('equipment_manuals')
    .select('url')
    .eq('equipment_id', m.equipment_id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);
  const nextPrimary = (remaining && remaining[0]) ? remaining[0].url : null;
  await NX.sb.from('equipment').update({ manual_url: nextPrimary }).eq('id', m.equipment_id);

  NX.toast && NX.toast('Manual removed', 'success');
  await loadEquipment();
  openDetail(m.equipment_id);
}

// Legacy single-manual remove — preserved for any old call sites that
// might still target the equipment row directly. Nukes both the row in
// equipment_manuals (by url match) and clears equipment.manual_url.
async function removeManual(equipId) {
  if (!confirm('Remove manual from this equipment?')) return;
  const { data: eq } = await NX.sb.from('equipment')
    .select('manual_url').eq('id', equipId).single();
  if (eq && eq.manual_url) {
    await NX.sb.from('equipment_manuals')
      .delete().eq('equipment_id', equipId).eq('url', eq.manual_url);
  }
  await NX.sb.from('equipment').update({ manual_url: null }).eq('id', equipId);
  NX.toast && NX.toast('Manual removed', 'success');
  await loadEquipment();
  openDetail(equipId);
}

async function renameManual(manualId, newName, originalName) {
  const trimmed = (newName || '').trim().slice(0, 100);
  if (!trimmed) {
    // Empty rename — restore original. Don't write empty to DB.
    const input = document.querySelector(`.eq-manual-card[data-manual-id="${manualId}"] .eq-manual-card-name-input`);
    if (input) input.value = originalName || '';
    return;
  }
  if (trimmed === (originalName || '').trim()) return; // no change
  const { error } = await NX.sb.from('equipment_manuals')
    .update({ name: trimmed })
    .eq('id', manualId);
  if (error) {
    console.error('[manual] rename failed:', error);
    NX.toast && NX.toast('Rename failed: ' + error.message, 'error');
    return;
  }
  // Update the input's data-orig so subsequent blur events know the new baseline.
  const input = document.querySelector(`.eq-manual-card[data-manual-id="${manualId}"] .eq-manual-card-name-input`);
  if (input) input.dataset.orig = trimmed;
  NX.toast && NX.toast('Renamed ✓', 'success');
}


/* ════════════════════════════════════════════════════════════════════════════
   5. AI — data plate scanner, manual fetch/upload, pattern detect, cost
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── Data plate scanner ─── */

async function scanDataPlate(existingId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // No `capture` → allow choosing an existing data-plate photo from the
  // library as well as taking one.

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    NX.toast && NX.toast('Reading data plate…', 'info', 8000);

    try {
      const base64 = await fileToBase64(file);
      const mimeType = file.type;

      // Upload photo to storage
      let dataPlateUrl = null;
      try {
        const fname = `data-plate-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
        const { data: upload } = await NX.sb.storage
          .from('equipment-photos')
          .upload(fname, file, { upsert: false, contentType: file.type });
        if (upload) {
          const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
          dataPlateUrl = publicUrl;
        }
      } catch(e) { console.warn('[DataPlate] Upload skipped:', e.message); }

      const prompt = `You are reading a commercial kitchen or HVAC equipment data plate.
Extract ONLY what you can clearly see. Return raw JSON, no markdown:
{
  "manufacturer": "...",
  "model": "...",
  "serial_number": "...",
  "year_manufactured": null or YYYY,
  "specs": {
    "voltage": null or "115V" etc,
    "amperage": null or "10A",
    "hz": null or 60,
    "phase": null or "1" or "3",
    "refrigerant_type": null or "R-290",
    "refrigerant_amount": null or "3.5 oz",
    "btu": null or number,
    "capacity": null or "12 cu ft",
    "max_pressure_psi": null or number,
    "wattage": null or "1500W",
    "gas_type": null or "NG" or "LP"
  },
  "likely_category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
  "confidence": "high | medium | low"
}
Decode year from serial if manufacturer uses a known format (e.g. Hoshizaki: 3rd-4th chars = year).
Return null for any field not clearly visible. Do NOT guess.`;

      const answer = await NX.askClaudeVision(prompt, base64, mimeType);
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response');
      const extracted = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      if (existingId) {
        // Merge into existing equipment
        const updates = {};
        if (extracted.manufacturer) updates.manufacturer = extracted.manufacturer;
        if (extracted.model) updates.model = extracted.model;
        if (extracted.serial_number) updates.serial_number = extracted.serial_number;
        if (extracted.specs && Object.keys(extracted.specs).length) {
          const clean = {};
          for (const [k, v] of Object.entries(extracted.specs)) {
            if (v != null && v !== '') clean[k] = v;
          }
          if (Object.keys(clean).length) updates.specs = clean;
        }
        if (dataPlateUrl) updates.data_plate_url = dataPlateUrl;

        // Auto-link the scanned manufacturer to the brand library.
        if (updates.manufacturer) {
          const mfgId = await autoLinkManufacturer(updates.manufacturer);
          if (mfgId) updates.manufacturer_id = mfgId;
        }

        await NX.sb.from('equipment').update(updates).eq('id', existingId);
        NX.toast && NX.toast(`✓ Extracted: ${extracted.manufacturer || ''} ${extracted.model || ''}`, 'success');
        if (NX.syslog) NX.syslog('equipment_scanned', `${extracted.manufacturer} ${extracted.model}`);
        closeDetail();
        await loadEquipment();
        openDetail(existingId);
      } else {
        openPrepopulatedAddModal(extracted, dataPlateUrl);
      }
    } catch (err) {
      console.error('[DataPlate] Extraction failed:', err);
      // Show the REAL reason when the vision call itself failed (no API key,
      // bad key, model error, no credits, CORS) — only fall back to the
      // "lighting" hint when the image was genuinely read but unparseable.
      const reason = NX._lastVisionError
        || (/No JSON/i.test(err.message || '')
              ? 'Read the image but found no plate details — try better lighting/angle.'
              : 'Could not read plate: ' + (err.message || 'unknown error'));
      NX.toast && NX.toast(reason, 'error', 6000);
    }
  });

  input.click();
}

function openPrepopulatedAddModal(data, dataPlateUrl) {
  const modal = document.getElementById('eqPrepopModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqPrepopModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const catGuess = data.likely_category || 'other';
  const specsStr = data.specs ? JSON.stringify(data.specs, null, 2) : '{}';

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqPrepopModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqPrepopModal').classList.remove('active')">${uiSvg("close", "16px")}</button>
        <h2>${uiSvg("sparkles", "16px")} Scanned — Confirm Details</h2>
      </div>
      <div class="eq-detail-body">
        ${dataPlateUrl ? `<img src="${dataPlateUrl}" class="eq-detail-photo" style="max-height:150px">` : ''}
        <div class="eq-scan-conf">Confidence: <b>${data.confidence || 'medium'}</b></div>
        <form class="eq-form" id="eqPrepopForm">
          <div class="eq-form-group">
            <label>Name * (you name it)</label>
            <input name="name" required placeholder="e.g. Walk-In Cooler Kitchen">
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Location *</label>
              <select name="location" required>
                ${LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('')}
              </select>
            </div>
            <div class="eq-form-group">
              <label>Category</label>
              <select name="category">
                ${CATEGORIES.map(c => `<option value="${c.key}" ${catGuess===c.key?'selected':''}>${c.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="eq-form-row">
            <div class="eq-form-group">
              <label>Manufacturer (from plate)</label>
              <input name="manufacturer" value="${escAttr(data.manufacturer||'')}">
            </div>
            <div class="eq-form-group">
              <label>Model (from plate)</label>
              <input name="model" value="${escAttr(data.model||'')}">
            </div>
          </div>
          <div class="eq-form-group">
            <label>Serial Number (from plate)</label>
            <input name="serial_number" value="${escAttr(data.serial_number||'')}">
          </div>
          ${data.year_manufactured ? `
          <div class="eq-form-group">
            <label>Install Date (year extracted: ${data.year_manufactured})</label>
            <input type="date" name="install_date" value="${data.year_manufactured}-01-01">
          </div>` : ''}
          <div class="eq-form-group">
            <label>Extracted Specs (auto-filled, edit if needed)</label>
            <textarea name="_specs_json" rows="5" style="font-family:monospace;font-size:12px">${esc(specsStr)}</textarea>
          </div>
          <div class="eq-form-actions">
            <button type="button" class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqPrepopModal').classList.remove('active')">Cancel</button>
            <button type="submit" class="eq-btn eq-btn-primary">Create Equipment</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('eqPrepopForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (v !== '' && v != null && !k.startsWith('_')) payload[k] = v;
    }
    try {
      const specsJson = fd.get('_specs_json');
      if (specsJson) payload.specs = JSON.parse(specsJson);
    } catch(e) { console.warn('Invalid specs JSON, skipping'); }
    if (dataPlateUrl) payload.data_plate_url = dataPlateUrl;

    try {
      // Auto-link manufacturer to the brand library.
      if (payload.manufacturer && payload.manufacturer.trim()) {
        const mfgId = await autoLinkManufacturer(payload.manufacturer);
        if (mfgId) payload.manufacturer_id = mfgId;
      }
      const { data: created, error } = await NX.sb.from('equipment').insert(payload).select().single();
      if (error) throw error;
      NX.toast && NX.toast('Equipment created ✓', 'success');
      // equipment_scanned_created syslog → covered by Postgres trigger on equipment INSERT
      modal.classList.remove('active');
      await loadEquipment();
      openDetail(created.id);
      if (created.manufacturer && created.model) {
        setTimeout(() => autoFetchManual(created.id), 500);
      }
    } catch (err) {
      console.error('[DataPlate] Create failed:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
    }
  });
}

/* ─── Manual upload ─── */

async function uploadManual(equipId) {
  // Backfill any legacy manual into equipment_manuals first. Without this,
  // a user with a legacy manual_url uploading a 2nd PDF would lose the
  // first one (the new upload would replace manual_url and the original
  // would be orphaned with no equipment_manuals row).
  await ensureLegacyManualMigrated(equipId);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      NX.toast && NX.toast('PDF too large (max 50MB)', 'error');
      return;
    }

    NX.toast && NX.toast('Uploading manual…', 'info', 5000);

    try {
      const fname = `${equipId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
      const { error: upErr } = await NX.sb.storage
        .from('equipment-manuals')
        .upload(fname, file, { upsert: false, contentType: 'application/pdf' });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = NX.sb.storage.from('equipment-manuals').getPublicUrl(fname);

      // Default name from the original filename, minus the extension. The
      // user can rename inline once the card renders.
      const defaultName = file.name.replace(/\.pdf$/i, '').slice(0, 100) || 'Manual';

      // Determine sort_order = current count (so new manuals append).
      const { count } = await NX.sb.from('equipment_manuals')
        .select('id', { count: 'exact', head: true })
        .eq('equipment_id', equipId);
      const sortOrder = count || 0;

      const { error: insErr } = await NX.sb.from('equipment_manuals').insert({
        equipment_id: equipId,
        name: defaultName,
        url: publicUrl,
        kind: 'pdf',
        sort_order: sortOrder,
        created_by: NX.currentUser?.name || null,
        created_by_id: NX.currentUser?.id || null
      });
      if (insErr) throw insErr;

      // If this is the equipment's first manual, also pin it as the legacy
      // primary so other code paths (Print Everything, AI scanner, etc.)
      // that read equipment.manual_url keep working.
      if (sortOrder === 0) {
        await NX.sb.from('equipment').update({ manual_url: publicUrl }).eq('id', equipId);
      }

      NX.toast && NX.toast('Manual uploaded ✓', 'success');
      if (NX.syslog) NX.syslog('manual_uploaded', `equipment ${equipId}`);
      await loadEquipment();
      openDetail(equipId);
    } catch (err) {
      console.error('[Manual] Upload failed:', err);
      NX.toast && NX.toast('Upload failed: ' + err.message, 'error');
    }
  });

  input.click();
}

/* ─── Auto-fetch manual from the web ─── */

async function autoFetchManual(equipId) {
  const eq = (await NX.sb.from('equipment').select('*').eq('id', equipId).single()).data;
  if (!eq) return;
  if (!eq.manufacturer || !eq.model) {
    NX.toast && NX.toast('Add manufacturer and model first', 'info');
    return;
  }

  NX.toast && NX.toast(`Searching web for ${eq.manufacturer} ${eq.model} manual…`, 'info', 6000);

  try {
    const prompt = `Find the official service/owner manual PDF URL for this commercial kitchen equipment:
Manufacturer: ${eq.manufacturer}
Model: ${eq.model}

Prefer in this order:
1. Manufacturer's official website (e.g. hoshizakiamerica.com, vulcanequipment.com)
2. partstown.com resource center
3. manualslib.com

Return raw JSON, no markdown:
{
  "manual_url": "direct PDF URL or webpage containing manual",
  "source": "manufacturer | partstown | manualslib | other",
  "confidence": "high | medium | low",
  "notes": "brief note about what was found"
}
If nothing found, return {"manual_url": null, "source": null, "confidence": "low", "notes": "..."}`;

    const answer = await NX.askClaude(prompt, [{ role: 'user', content: 'Search now.' }], 800, true);

    const jsonStart = answer.indexOf('{');
    const jsonEnd = answer.lastIndexOf('}');
    if (jsonStart === -1) throw new Error('No JSON found');
    const result = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

    if (result.manual_url) {
      await NX.sb.from('equipment').update({
        manual_source_url: result.manual_url
      }).eq('id', equipId);
      NX.toast && NX.toast(`Found manual (${result.confidence} confidence) — saved link`, 'success', 5000);
      await loadEquipment();
      openDetail(equipId);
    } else {
      NX.toast && NX.toast(`No manual found. Try uploading a PDF directly.`, 'info', 5000);
    }
  } catch (err) {
    console.error('[Manual] Auto-fetch failed:', err);
    NX.toast && NX.toast('Search failed — try uploading manually', 'error');
  }
}

/* ─── Pattern detection + cost analysis ─── */

async function detectPatterns(equipId) {
  const { data: maint } = await NX.sb.from('equipment_maintenance')
    .select('*')
    .eq('equipment_id', equipId)
    .eq('event_type', 'repair')
    .order('event_date', { ascending: true });

  if (!maint || maint.length < 2) {
    return { hasPattern: false, reason: 'Not enough history (need 2+ repairs)' };
  }

  const intervals = [];
  for (let i = 1; i < maint.length; i++) {
    const a = new Date(maint[i - 1].event_date);
    const b = new Date(maint[i].event_date);
    intervals.push(Math.round((b - a) / 86400000));
  }

  const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;
  const variance = intervals.reduce((s, d) => s + Math.pow(d - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const relStdDev = stdDev / avgInterval;

  const lastRepair = new Date(maint[maint.length - 1].event_date);
  const daysSinceLastRepair = Math.round((new Date() - lastRepair) / 86400000);

  const allSymptoms = maint.map(m => (m.symptoms || m.description || '').toLowerCase()).join(' ');
  const keywords = ['compressor', 'fan', 'thermostat', 'refrigerant', 'drain', 'seal', 'gasket', 'motor', 'valve', 'pilot', 'igniter'];
  const topSymptom = keywords.find(k => (allSymptoms.match(new RegExp(k, 'g')) || []).length >= 2);

  const hasPattern = relStdDev < 0.4 && maint.length >= 3;
  const predictedDate = new Date(lastRepair.getTime() + avgInterval * 86400000);
  const daysUntilPredicted = Math.round((predictedDate - new Date()) / 86400000);

  return {
    hasPattern,
    totalRepairs: maint.length,
    avgInterval: Math.round(avgInterval),
    relStdDev: relStdDev.toFixed(2),
    daysSinceLastRepair,
    daysUntilPredicted,
    predictedDate: predictedDate.toISOString().slice(0, 10),
    topSymptom,
    alertLevel: daysUntilPredicted <= 14 && hasPattern ? 'urgent' :
                daysUntilPredicted <= 30 && hasPattern ? 'warning' : 'none'
  };
}

function analyzeCost(eq) {
  const yearlyCost = parseFloat(eq.cost_this_year) || 0;
  const purchasePrice = parseFloat(eq.purchase_price) || 0;
  const servicesThisYear = eq.services_this_year || 0;

  if (purchasePrice > 0 && yearlyCost > purchasePrice * 0.4) {
    return {
      yearlyCost,
      projectedNextYear: Math.round(yearlyCost * 1.3),
      recommendation: 'replace',
      reasoning: `Repairs (${Math.round(yearlyCost / purchasePrice * 100)}% of purchase price) exceed the 40% replacement threshold. A new unit likely pays back within a year.`
    };
  }

  if (servicesThisYear >= 3) {
    return {
      yearlyCost,
      recommendation: 'monitor',
      reasoning: `${servicesThisYear} services this year suggests increasing failure rate. Watch for escalation.`
    };
  }

  return {
    yearlyCost,
    recommendation: 'healthy',
    reasoning: servicesThisYear === 0
      ? 'No repairs this year — running well.'
      : `Only ${servicesThisYear} service${servicesThisYear>1?'s':''} this year — normal maintenance profile.`
  };
}

async function renderIntelligenceTab(equipId) {
  const eq = equipment.find(e => e.id === equipId) ||
             (await NX.sb.from('equipment_with_stats').select('*').eq('id', equipId).single()).data;
  if (!eq) return '<div class="eq-empty-small">Not found</div>';

  const pattern = await detectPatterns(equipId);
  const costAnalysis = analyzeCost(eq);

  let html = '<div class="eq-ai-panel">';

  html += `<div class="eq-ai-card"><h4>${uiSvg('crystal', '14px')} Failure Pattern Analysis</h4>`;
  if (pattern.hasPattern) {
    const color = pattern.alertLevel === 'urgent' ? 'var(--red)' : pattern.alertLevel === 'warning' ? 'var(--amber)' : 'var(--green)';
    html += `
      <div class="eq-ai-alert" style="border-color:${color}">
        <div class="eq-ai-big" style="color:${color}">
          ${pattern.daysUntilPredicted < 0
            ? `${uiSvg('alert', '14px')} Overdue by ${-pattern.daysUntilPredicted} days`
            : pattern.daysUntilPredicted <= 14
            ? `${uiSvg('alert', '14px')} Service needed in ~${pattern.daysUntilPredicted} days`
            : `${pattern.daysUntilPredicted} days until predicted service`}
        </div>
        <div class="eq-ai-detail">
          Based on ${pattern.totalRepairs} past repairs averaging every ${pattern.avgInterval} days.
          ${pattern.topSymptom ? `<br><b>Common issue:</b> ${pattern.topSymptom}` : ''}
          <br>Last repair: ${pattern.daysSinceLastRepair} days ago
          <br>Predicted next: ${new Date(pattern.predictedDate).toLocaleDateString()}
        </div>
      </div>`;
  } else {
    html += `<div class="eq-ai-neutral">${pattern.reason || `Need more repair history to detect patterns (${pattern.totalRepairs || 0} recorded).`}</div>`;
  }
  html += '</div>';

  html += `<div class="eq-ai-card"><h4>${uiSvg('dollar', '14px')} Cost Intelligence</h4>`;
  if (costAnalysis.recommendation === 'replace') {
    html += `
      <div class="eq-ai-alert" style="border-color:var(--red)">
        <div class="eq-ai-big" style="color:var(--red)">${uiSvg('refresh', '14px')} Consider Replacement</div>
        <div class="eq-ai-detail">
          Total repairs last 12mo: <b>$${costAnalysis.yearlyCost.toLocaleString()}</b><br>
          ${costAnalysis.projectedNextYear ? `Projected next year: <b>$${costAnalysis.projectedNextYear.toLocaleString()}</b><br>` : ''}
          ${eq.purchase_price ? `Original cost: $${Math.round(eq.purchase_price).toLocaleString()}<br>` : ''}
          <i>${costAnalysis.reasoning}</i>
        </div>
      </div>`;
  } else if (costAnalysis.recommendation === 'monitor') {
    html += `
      <div class="eq-ai-alert" style="border-color:var(--amber)">
        <div class="eq-ai-big" style="color:var(--amber)">${uiSvg('alert', '14px')} Monitor Costs</div>
        <div class="eq-ai-detail">
          YTD repair cost: <b>$${costAnalysis.yearlyCost.toLocaleString()}</b><br>
          <i>${costAnalysis.reasoning}</i>
        </div>
      </div>`;
  } else {
    html += `
      <div class="eq-ai-neutral">
        YTD repair cost: $${costAnalysis.yearlyCost.toLocaleString()}<br>
        <i>${costAnalysis.reasoning}</i>
      </div>`;
  }
  html += '</div>';

  html += `
    <div class="eq-ai-actions">
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.scanDataPlate('${equipId}')">${uiSvg("camera", "13px")} Re-scan Data Plate</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.autoFetchManual('${equipId}')">${uiSvg("link", "13px")} Find Manual Online</button>
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.uploadManual('${equipId}')">${uiSvg("document", "13px")} Upload Manual PDF</button>
    </div>
  `;
  html += '</div>';
  return html;
}

/* ─── Fleet-wide scan for the morning brief ─── */

async function scanFleet() {
  const { data: allEq } = await NX.sb.from('equipment').select('id, name, location')
    .not('status', 'eq', 'retired');
  if (!allEq || !allEq.length) return [];

  const urgent = [];
  for (const eq of allEq) {
    const p = await detectPatterns(eq.id);
    if (p.hasPattern && p.alertLevel !== 'none') {
      urgent.push({
        id: eq.id, name: eq.name, location: eq.location,
        days: p.daysUntilPredicted, level: p.alertLevel, symptom: p.topSymptom
      });
    }
  }
  return urgent.sort((a, b) => a.days - b.days);
}

/* ─── Predictive PM ─── */

async function suggestPMDate(equipId) {
  const pattern = await detectPatterns(equipId);
  if (!pattern.hasPattern) return null;
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
  await loadEquipment();
  openDetail(equipId);
}

/* ─── BOM extraction from manual ─── */

async function extractBOMFromManual(equipId) {
  // Build progress modal so user sees each step
  const modal = document.createElement('div');
  modal.className = 'eq-extract-modal';
  modal.innerHTML = `
    <div class="eq-extract-bg"></div>
    <div class="eq-extract-card">
      <div class="eq-extract-header">
        <div class="eq-extract-title">${uiSvg("sparkles", "16px")} Extracting Parts from Manual</div>
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
  modal.querySelector('#eqExtractCancel').addEventListener('click', () => { cancelled = true; modal.remove(); });
  const setStep = (t) => { const el = modal.querySelector('#eqExtractStep'); if (el) el.textContent = t; };
  const showError = (msg) => {
    modal.querySelector('#eqExtractBody').innerHTML = `
      <div class="eq-extract-error">
        <div class="eq-extract-error-icon">${uiSvg("alert", "32px")}</div>
        <div class="eq-extract-error-msg">${esc(msg)}</div>
      </div>`;
    modal.querySelector('#eqExtractCancel').textContent = 'Close';
  };

  try {
    setStep('Loading equipment details…');
    const { data: eq, error: eqErr } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
    if (eqErr) throw new Error('Equipment not found: ' + eqErr.message);
    if (cancelled) return;

    if (!eq.manual_url) { showError('No manual uploaded yet. Go to the Manual tab and upload a PDF first.'); return; }

    const apiKey = NX.getApiKey?.() || NX.config?.api_key;
    if (!apiKey) { showError('No Anthropic API key configured. Set it in Admin → API Keys.'); return; }

    setStep('Downloading manual PDF…');
    let pdfRes;
    try { pdfRes = await fetch(eq.manual_url); }
    catch (e) { showError('Could not fetch manual: ' + e.message); return; }
    if (!pdfRes.ok) { showError(`Manual returned HTTP ${pdfRes.status}. The file may have been moved or deleted.`); return; }
    if (cancelled) return;

    setStep('Preparing PDF for analysis…');
    const pdfBlob = await pdfRes.blob();
    const sizeMB = (pdfBlob.size / 1048576).toFixed(2);
    if (pdfBlob.size > 32 * 1048576) { showError(`Manual is ${sizeMB}MB. Claude PDF input is limited to ~32MB.`); return; }
    const pdfBase64 = await blobToBase64(pdfBlob);
    if (cancelled) return;

    setStep(`Sending ${sizeMB}MB PDF to Claude (20–60 seconds)…`);
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: NX.getModel?.() || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: `You are reading a service/parts manual for commercial kitchen equipment:
Equipment: ${eq.manufacturer || 'Unknown'} ${eq.model || ''}
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

If no parts are found, return [].` }
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
    if (data.error) { showError('Claude returned error: ' + data.error.message); return; }

    setStep('Parsing parts list…');
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const arrStart = answer.indexOf('['), arrEnd = answer.lastIndexOf(']');
    if (arrStart === -1 || arrEnd <= arrStart) { showError('Claude did not return a valid parts list. Response started: ' + answer.slice(0, 200)); return; }
    let parts;
    try { parts = JSON.parse(answer.slice(arrStart, arrEnd + 1)); }
    catch (e) { showError('Could not parse response as JSON: ' + e.message); return; }
    if (!Array.isArray(parts) || !parts.length) { showError('No serviceable parts found in this manual.'); return; }

    showExtractionConfirmation(modal, equipId, parts);
  } catch (err) {
    console.error('[extractBOM] failed:', err);
    showError('Unexpected error: ' + err.message);
  }
}

function showExtractionConfirmation(modal, equipId, parts) {
  modal.querySelector('#eqExtractBody').innerHTML = `
    <div class="eq-extract-success">
      <div class="eq-extract-success-icon">${uiSvg("check", "32px")}</div>
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
    const selectedIdxs = Array.from(modal.querySelectorAll('input[type=checkbox]:checked')).map(cb => parseInt(cb.dataset.partIdx, 10));
    const selectedParts = selectedIdxs.map(i => parts[i]);
    if (!selectedParts.length) { NX.toast && NX.toast('No parts selected', 'info'); return; }
    try {
      const rows = selectedParts.map(p => ({
        equipment_id: equipId,
        part_name: p.part_name,
        oem_part_number: p.oem_part_number || null,
        quantity: p.quantity || 1,
        assembly_path: p.assembly_path || null,
        notes: p.notes || null,
        vendors: []
      }));
      const { error } = await NX.sb.from('equipment_parts').insert(rows);
      if (error) throw error;
      NX.toast && NX.toast(`Saved ${rows.length} part${rows.length === 1 ? '' : 's'}`, 'success');
      modal.remove();
      openDetail(equipId);
    } catch (e) {
      NX.toast && NX.toast('Save failed: ' + e.message, 'error');
    }
  });
}

async function extractBOMFromManual_LEGACY(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq || !eq.manual_url) {
    NX.toast && NX.toast('Upload a manual first', 'info');
    return;
  }

  NX.toast && NX.toast('Reading manual and extracting parts…', 'info', 10000);

  try {
    const pdfRes = await fetch(eq.manual_url);
    if (!pdfRes.ok) throw new Error('Could not fetch manual');
    const pdfBlob = await pdfRes.blob();
    const pdfBase64 = await blobToBase64(pdfBlob);

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
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: `You are reading a service/parts manual for commercial kitchen equipment:
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

If no parts are found, return []. Extract only what's explicitly listed.` }
          ]
        }]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    const answer = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';

    const arrStart = answer.indexOf('[');
    const arrEnd = answer.lastIndexOf(']');
    if (arrStart === -1) throw new Error('No parts array in response');
    const parts = JSON.parse(answer.slice(arrStart, arrEnd + 1));

    if (!parts.length) {
      NX.toast && NX.toast('No serviceable parts found in manual', 'info');
      return;
    }

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
        <button class="eq-close" onclick="this.closest('.eq-modal').remove()">${uiSvg("close", "16px")}</button>
        <h2>${uiSvg("sparkles", "16px")} Extracted ${parts.length} Parts</h2>
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
    if (!selected.length) { modal.remove(); return; }

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
      openDetail(equipId);
    } catch (err) {
      NX.toast && NX.toast('Insert failed: ' + err.message, 'error');
    }
  });
}

async function exportPartsCart(equipId) {
  const { data: parts } = await NX.sb.from('equipment_parts')
    .select('part_name, oem_part_number, quantity, supplier_url')
    .eq('equipment_id', equipId);

  if (!parts || !parts.length) {
    NX.toast && NX.toast('No parts to export', 'info');
    return;
  }

  const list = parts.map(p => {
    const searchTerm = p.oem_part_number || p.part_name;
    const url = p.supplier_url || `https://www.partstown.com/search?searchterm=${encodeURIComponent(searchTerm)}`;
    return { name: p.part_name, pn: p.oem_part_number || 'N/A', qty: p.quantity || 1, url };
  });

  const modal = document.createElement('div');
  modal.className = 'eq-modal active';
  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="this.parentElement.remove()"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="this.closest('.eq-modal').remove()">${uiSvg("close", "16px")}</button>
        <h2>Parts Shopping List</h2>
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
          ">Copy List</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

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


/* ════════════════════════════════════════════════════════════════════════════
   6. AI CREATE — describe / photo / bulk / dataplate
   ════════════════════════════════════════════════════════════════════════════ */

function openAICreator() {
  const modal = document.getElementById('eqAICreatorModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqAICreatorModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqAICreatorModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqAICreatorModal').classList.remove('active')">${uiSvg('close', '16px')}</button>
        <h2>${uiSvg("sparkles", "16px")} AI Create Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-ai-intro">Let AI handle the data entry. Pick your method:</div>
        <div class="eq-ai-methods">
          <button class="eq-ai-method" data-method="describe">
            <div class="eq-ai-method-icon">${uiSvg('message', '28px')}</div>
            <div class="eq-ai-method-title">Describe It</div>
            <div class="eq-ai-method-desc">Type or paste details in natural language. AI extracts everything and auto-links contractors, parts, locations.</div>
          </button>
          <button class="eq-ai-method" data-method="photo">
            <div class="eq-ai-method-icon">${uiSvg('camera', '28px')}</div>
            <div class="eq-ai-method-title">Photo of Unit</div>
            <div class="eq-ai-method-desc">Take or upload a photo of the equipment. AI identifies make/model from visible details.</div>
          </button>
          <button class="eq-ai-method" data-method="bulk">
            <div class="eq-ai-method-icon">${uiSvg('building', '28px')}</div>
            <div class="eq-ai-method-title">Scan Whole Room</div>
            <div class="eq-ai-method-desc">Take or upload a photo of your kitchen or bar. AI identifies every piece it sees and adds all of them at once.</div>
          </button>
          <button class="eq-ai-method" data-method="dataplate">
            <div class="eq-ai-method-icon">${uiSvg('qr', '28px')}</div>
            <div class="eq-ai-method-title">Scan Data Plate</div>
            <div class="eq-ai-method-desc">Photograph or upload the data plate. AI extracts exact model/serial/specs.</div>
          </button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal.querySelectorAll('.eq-ai-method').forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.dataset.method;
      modal.classList.remove('active');
      if (method === 'describe') openDescribeDialog();
      else if (method === 'photo') photoIdentify();
      else if (method === 'bulk') bulkIdentify();
      else if (method === 'dataplate') scanDataPlate(null);
    });
  });
}

function openDescribeDialog() {
  const modal = document.getElementById('eqDescribeModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqDescribeModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqDescribeModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqDescribeModal').classList.remove('active')">${uiSvg('close', '16px')}</button>
        <h2>${uiSvg('message', '18px')} Describe Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-ai-intro">
          Describe the equipment in your own words. AI extracts everything, auto-links contractors and parts from your existing data.
        </div>
        <div class="eq-ai-examples">
          <div class="eq-ai-examples-title">Examples:</div>
          <div class="eq-ai-example" data-fill="Hoshizaki KM-320MAH ice machine at Suerte kitchen, installed March 2023, serial 240317001, Tyler from Austin Air & Ice services it quarterly">Single equipment with contractor</div>
          <div class="eq-ai-example" data-fill="Walk-in cooler at Este, True Manufacturing T-49, bought 2022, warranty until 2027, uses condenser fan 800-5016 and evaporator coil 800-1402. Last serviced by Juan in January">Equipment with parts and history</div>
          <div class="eq-ai-example" data-fill="Vulcan 6-burner range at Bar Toti, gas, natural gas hookup, bought used in 2021. Has pilot issues every few months">Minimal info with issues</div>
        </div>
        <div class="eq-form-group">
          <label>Description (as much or little as you want)</label>
          <textarea id="eqDescribeInput" rows="6" placeholder="e.g. Hoshizaki ice machine at Suerte, installed last year, Tyler services it..."></textarea>
        </div>
        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqDescribeModal').classList.remove('active')">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="eqDescribeGo">${uiSvg("sparkles", "13px")} Create with AI</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal.querySelectorAll('.eq-ai-example').forEach(ex => {
    ex.addEventListener('click', () => {
      document.getElementById('eqDescribeInput').value = ex.dataset.fill;
      document.getElementById('eqDescribeInput').focus();
    });
  });

  document.getElementById('eqDescribeGo').addEventListener('click', async () => {
    const text = document.getElementById('eqDescribeInput').value.trim();
    if (!text) return;
    const btn = document.getElementById('eqDescribeGo');
    btn.disabled = true;
    btn.innerHTML = uiSvg('sparkles','13px') + ' Thinking…';
    try {
      await createFromDescription(text);
      modal.classList.remove('active');
    } catch (err) {
      console.error('[AI-Create] Describe failed:', err);
      NX.toast && NX.toast('Creation failed: ' + err.message, 'error', 6000);
      btn.disabled = false;
      btn.innerHTML = uiSvg('sparkles','13px') + ' Create with AI';
    }
  });
}

async function createFromDescription(text) {
  const context = await loadExistingContext();
  const system = `You are creating equipment records for a restaurant management system.
Given a natural language description, extract structured data AND identify any references
to existing people, contractors, parts, or locations from this list:

EXISTING CONTRACTORS: ${context.contractors.map(c => c.name).join(', ') || 'none'}
EXISTING PEOPLE: ${context.people.map(p => p.name).join(', ') || 'none'}
EXISTING PARTS: ${context.parts.slice(0, 30).map(p => p.name).join(', ') || 'none'}
LOCATIONS: Suerte, Este, Bar Toti

Extract and return raw JSON (no markdown), can include multiple equipment if described:
{
  "equipment": [
    {
      "name": "descriptive name",
      "location": "Suerte" | "Este" | "Bar Toti",
      "area": "Kitchen" | "Bar" | "Dining" etc or null,
      "category": "refrigeration" | "cooking" | "ice" | "hvac" | "dish" | "bev" | "smallware" | "other",
      "manufacturer": "...",
      "model": "...",
      "serial_number": "...",
      "install_date": "YYYY-MM-DD" or null,
      "warranty_until": "YYYY-MM-DD" or null,
      "status": "operational" | "needs_service" | "down",
      "notes": "any other details like issues, quirks, etc",
      "linked_contractors": ["exact name from EXISTING CONTRACTORS list"],
      "linked_people": ["exact name from EXISTING PEOPLE list"],
      "linked_parts": ["exact name from EXISTING PARTS list"],
      "mentioned_parts_new": [
        {"name": "Condenser Fan", "oem_part_number": "800-5016"}
      ],
      "mentioned_issues": ["pilot issues", "runs warm"]
    }
  ],
  "interpretation_notes": "brief note about what you understood or assumed"
}

If a contractor or person is mentioned but not in the existing list, include their name in linked_contractors anyway — we'll auto-create them.
If the text mentions parts with part numbers, add them to mentioned_parts_new.
Infer reasonable defaults only when obvious.
Return null for fields where info isn't provided. DON'T HALLUCINATE data.`;

  const answer = await NX.askClaude(system, [{ role: 'user', content: text }], 3000);
  const jsonStart = answer.indexOf('{');
  const jsonEnd = answer.lastIndexOf('}');
  if (jsonStart === -1) throw new Error('No JSON in AI response');
  const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

  if (!parsed.equipment || !parsed.equipment.length) {
    throw new Error('No equipment could be extracted');
  }
  showCreationConfirmation(parsed, context);
}

async function photoIdentify() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // No `capture` → the native picker offers the photo LIBRARY as well as the
  // camera, so users can add an existing image instead of only snapping one.

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    NX.toast && NX.toast('AI identifying equipment…', 'info', 10000);

    try {
      const base64 = await fileToBase64(file);
      const prompt = `You are looking at a photo of commercial restaurant/kitchen equipment.
Identify it as best you can. Return raw JSON (no markdown):
{
  "equipment": [{
    "name": "descriptive name — be specific about what you see",
    "category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
    "subcategory": "walk_in | reach_in | fryer | combi | range | hood | ice_machine | etc",
    "manufacturer": "... (only if visible/identifiable from badges/design)" or null,
    "model": "... (only if readable)" or null,
    "approximate_size": "small | medium | large",
    "condition": "new | good | fair | needs_attention",
    "visible_details": ["any notable features you see"],
    "confidence": "high | medium | low",
    "notes": "what you observed"
  }],
  "scene_description": "brief description of what's in the photo"
}
If you can't identify it clearly, still return a best-guess entry with low confidence.`;

      const answer = await NX.askClaudeVision(prompt, base64, file.type);
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      const photoUrl = await uploadCreatePhoto(file, parsed.equipment[0]);
      if (photoUrl) parsed.equipment[0].photo_url = photoUrl;

      const context = await loadExistingContext();
      showCreationConfirmation(parsed, context, 'photo');
    } catch (err) {
      console.error('[AI-Create] Photo failed:', err);
      NX.toast && NX.toast('Identification failed: ' + (NX._lastVisionError || err.message), 'error', 6000);
    }
  });

  input.click();
}

async function bulkIdentify() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // No `capture` → users can pick an existing room photo from their library,
  // not just shoot a new one.

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    const location = await askLocation();
    if (!location) return;

    NX.toast && NX.toast('AI scanning the room…', 'info', 15000);

    try {
      const base64 = await fileToBase64(file);
      const prompt = `You are looking at a wide-angle photo of a commercial restaurant space (${location}).
Identify EVERY piece of equipment visible in the photo.

Return raw JSON (no markdown):
{
  "equipment": [
    {
      "name": "descriptive name",
      "category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
      "subcategory": "walk_in | reach_in | fryer | combi | range | hood | ice_machine | prep_table | etc",
      "manufacturer": "..." or null (only if visible),
      "model": "..." or null (only if readable),
      "approximate_size": "small | medium | large",
      "location_in_frame": "left | center | right | back | foreground",
      "condition": "new | good | fair | needs_attention",
      "confidence": "high | medium | low",
      "notes": "what you see"
    }
  ],
  "scene_description": "brief description"
}

List EVERY distinct piece of equipment. Even small items like microwaves, coffee makers, prep tables.
Skip: utensils, small hand tools, food, decor items.`;

      const answer = await NX.askClaudeVision(prompt, base64, file.type);
      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      parsed.equipment.forEach(eq => eq.location = location);
      const photoUrl = await uploadCreatePhoto(file, { name: 'bulk-scan' });
      parsed.equipment.forEach(eq => eq.photo_url = photoUrl);

      const context = await loadExistingContext();
      showCreationConfirmation(parsed, context, 'bulk');
    } catch (err) {
      console.error('[AI-Create] Bulk failed:', err);
      NX.toast && NX.toast('Scan failed: ' + (NX._lastVisionError || err.message), 'error', 6000);
    }
  });

  input.click();
}

function askLocation() {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'eq-modal active';
    modal.innerHTML = `
      <div class="eq-detail-bg"></div>
      <div class="eq-detail eq-edit">
        <div class="eq-detail-head"><h2>Which location?</h2></div>
        <div class="eq-detail-body">
          <div class="eq-loc-picker">
            <button class="eq-loc-btn" data-loc="Suerte">Suerte</button>
            <button class="eq-loc-btn" data-loc="Este">Este</button>
            <button class="eq-loc-btn" data-loc="Bar Toti">Bar Toti</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('.eq-loc-btn').forEach(btn => {
      btn.addEventListener('click', () => { resolve(btn.dataset.loc); modal.remove(); });
    });
    modal.querySelector('.eq-detail-bg').addEventListener('click', () => { resolve(null); modal.remove(); });
  });
}

function showCreationConfirmation(parsed, context, source = 'describe') {
  const modal = document.getElementById('eqConfirmModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqConfirmModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const equipList = parsed.equipment || [];
  const multi = equipList.length > 1;

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqConfirmModal').classList.remove('active')"></div>
    <div class="eq-detail">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqConfirmModal').classList.remove('active')">${uiSvg("close", "16px")}</button>
        <h2>${uiSvg("sparkles","16px")} AI Found ${equipList.length} ${multi ? 'Pieces' : 'Piece'}</h2>
      </div>
      <div class="eq-detail-body">
        ${parsed.interpretation_notes || parsed.scene_description ? `
          <div class="eq-ai-interp">
            <b>AI's interpretation:</b> ${esc(parsed.interpretation_notes || parsed.scene_description)}
          </div>
        ` : ''}
        ${multi ? `
          <div class="eq-ai-bulk-actions">
            <button class="eq-btn eq-btn-tiny" onclick="document.querySelectorAll('[data-eq-confirm]').forEach(c => c.checked = true)">Select All</button>
            <button class="eq-btn eq-btn-tiny" onclick="document.querySelectorAll('[data-eq-confirm]').forEach(c => c.checked = false)">Deselect All</button>
          </div>
        ` : ''}
        <div class="eq-confirm-list">
          ${equipList.map((eq, i) => `
            <div class="eq-confirm-card">
              <label class="eq-confirm-head">
                <input type="checkbox" checked data-eq-confirm="${i}">
                <div class="eq-confirm-icon">${catIcon(eq.category)}</div>
                <div class="eq-confirm-title">
                  <div class="eq-confirm-name" contenteditable="true" data-eq-field="name" data-idx="${i}">${esc(eq.name || 'Unnamed')}</div>
                  <div class="eq-confirm-sub">
                    ${esc(eq.manufacturer || '')} ${esc(eq.model || '')}
                    ${eq.confidence ? `<span class="eq-conf eq-conf-${eq.confidence}">${eq.confidence}</span>` : ''}
                  </div>
                </div>
              </label>
              <div class="eq-confirm-details">
                <div class="eq-confirm-field">
                  <label>Location</label>
                  <select data-eq-field="location" data-idx="${i}">
                    ${LOCATIONS.map(l => `<option ${eq.location===l?'selected':''}>${l}</option>`).join('')}
                  </select>
                </div>
                <div class="eq-confirm-field">
                  <label>Area</label>
                  <input data-eq-field="area" data-idx="${i}" value="${esc(eq.area || '')}">
                </div>
                <div class="eq-confirm-field">
                  <label>Category</label>
                  <select data-eq-field="category" data-idx="${i}">
                    ${CATEGORIES.map(c => `<option value="${c.key}" ${eq.category===c.key?'selected':''}>${c.key}</option>`).join('')}
                  </select>
                </div>
                <div class="eq-confirm-field">
                  <label>Status</label>
                  <select data-eq-field="status" data-idx="${i}">
                    <option value="operational" ${eq.status==='operational'?'selected':''}>Operational</option>
                    <option value="needs_service" ${eq.status==='needs_service'?'selected':''}>Needs Service</option>
                    <option value="down" ${eq.status==='down'?'selected':''}>Down</option>
                  </select>
                </div>
              </div>
              ${eq.linked_contractors?.length || eq.linked_people?.length ? `
                <div class="eq-confirm-links">
                  <div class="eq-confirm-links-label">${uiSvg("link", "13px")} Will link to:</div>
                  ${(eq.linked_contractors || []).map(name => {
                    const existing = context.contractors.find(c => c.name.toLowerCase() === name.toLowerCase());
                    return `<span class="eq-link-chip ${existing?'eq-link-existing':'eq-link-new'}">
                      ${existing ? uiSvg('check', '11px') : '+'} ${esc(name)} ${existing ? '' : '(new)'}
                    </span>`;
                  }).join('')}
                  ${(eq.linked_people || []).map(name => {
                    const existing = context.people.find(p => p.name.toLowerCase() === name.toLowerCase());
                    return `<span class="eq-link-chip ${existing?'eq-link-existing':'eq-link-new'}">
                      ${existing ? uiSvg('check', '11px') : '+'} ${esc(name)} ${existing ? '' : '(new)'}
                    </span>`;
                  }).join('')}
                </div>
              ` : ''}
              ${eq.linked_parts?.length || eq.mentioned_parts_new?.length ? `
                <div class="eq-confirm-links">
                  <div class="eq-confirm-links-label">${uiSvg("wrench", "13px")} Parts:</div>
                  ${(eq.linked_parts || []).map(name => `<span class="eq-link-chip eq-link-existing">${uiSvg("check","11px")} ${esc(name)}</span>`).join('')}
                  ${(eq.mentioned_parts_new || []).map(p => `<span class="eq-link-chip eq-link-new">+ ${esc(p.name)} ${p.oem_part_number ? '('+esc(p.oem_part_number)+')' : ''}</span>`).join('')}
                </div>
              ` : ''}
              ${eq.notes ? `<div class="eq-confirm-notes">${uiSvg("note","12px")} ${esc(eq.notes)}</div>` : ''}
              ${eq.mentioned_issues?.length ? `
                <div class="eq-confirm-issues">
                  ${uiSvg("alert", "13px")} Issues mentioned — ticket will be created:
                  ${eq.mentioned_issues.map(i => `<div class="eq-issue">${esc(i)}</div>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqConfirmModal').classList.remove('active')">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="eqConfirmCommit">${uiSvg("check", "13px")} Create ${multi ? 'Selected' : ''}</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal._parsed = parsed;
  modal._context = context;

  document.getElementById('eqConfirmCommit').addEventListener('click', async () => {
    const btn = document.getElementById('eqConfirmCommit');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      modal.querySelectorAll('[data-eq-field]').forEach(el => {
        const idx = parseInt(el.dataset.idx);
        const field = el.dataset.field;
        const val = el.tagName === 'DIV' ? el.textContent.trim() : el.value;
        if (parsed.equipment[idx]) parsed.equipment[idx][field] = val;
      });

      const checked = [];
      modal.querySelectorAll('[data-eq-confirm]').forEach(c => {
        if (c.checked) checked.push(parsed.equipment[parseInt(c.dataset.eqConfirm)]);
      });

      if (!checked.length) {
        NX.toast && NX.toast('Nothing selected', 'info');
        btn.disabled = false;
        btn.innerHTML = uiSvg('check','13px') + ' Create';
        return;
      }

      const results = await commitEquipment(checked, context);
      modal.classList.remove('active');
      
      if (results.created > 0) {
        NX.toast && NX.toast(`✓ Created ${results.created} equipment ${results.created > 1 ? 'pieces' : 'piece'}${results.failed ? ` (${results.failed} failed)` : ''}`, results.failed ? 'warning' : 'success', 6000);
      }
      if (results.failed > 0 && results.created === 0) {
        NX.toast && NX.toast(`Failed to create equipment: ${results.errors[0] || 'unknown error'}`, 'error', 10000);
        console.error('[AI-Create] All failures:', results.errors);
      } else if (results.failed > 0) {
        console.warn('[AI-Create] Partial failure:', results.errors);
      }

      await loadEquipment();
      buildUI();
    } catch (err) {
      console.error('[AI-Create] Commit failed:', err);
      NX.toast && NX.toast('Create failed: ' + err.message, 'error', 8000);
      btn.disabled = false;
      btn.innerHTML = uiSvg('check','13px') + ' Create';
    }
  });
}

async function commitEquipment(equipList, context) {
  const results = { created: 0, failed: 0, errors: [] };
  
  for (const eq of equipList) {
    try {
      const allowed = ['name','location','area','category','subcategory','manufacturer','model',
                       'serial_number','status','install_date','warranty_until','purchase_price',
                       'specs','photo_url','notes','pm_interval_days','next_pm_date'];
      const clean = {};
      for (const f of allowed) {
        if (eq[f] != null && eq[f] !== '') clean[f] = eq[f];
      }
      
      // Sanitize date fields — Postgres rejects empty strings and bad formats
      const dateFields = ['install_date', 'warranty_until', 'next_pm_date'];
      for (const df of dateFields) {
        if (clean[df] != null) {
          const v = String(clean[df]).trim();
          if (!v || v === 'N/A' || v === 'n/a' || v === 'null' || v === 'undefined' || v === 'unknown') {
            delete clean[df];
          } else {
            // Validate it's parseable as a date
            const d = new Date(v);
            if (isNaN(d.getTime())) {
              console.warn(`[AI-Create] Dropping invalid ${df}:`, v);
              delete clean[df];
            } else {
              // Normalize to YYYY-MM-DD
              clean[df] = d.toISOString().slice(0, 10);
            }
          }
        }
      }
      
      // Sanitize numeric fields
      if (clean.purchase_price != null) {
        const n = parseFloat(String(clean.purchase_price).replace(/[^\d.]/g, ''));
        if (isNaN(n)) delete clean.purchase_price;
        else clean.purchase_price = n;
      }
      if (clean.pm_interval_days != null) {
        const n = parseInt(clean.pm_interval_days, 10);
        if (isNaN(n)) delete clean.pm_interval_days;
        else clean.pm_interval_days = n;
      }
      
      // Required: name + location + category + status. If missing, skip.
      if (!clean.name || !clean.location) {
        results.failed++;
        results.errors.push(`Missing name or location on: ${JSON.stringify(eq).slice(0, 80)}`);
        continue;
      }
      clean.status = clean.status || 'operational';
      clean.category = clean.category || 'equipment';

      let notes = eq.notes || '';
      if (eq.visible_details?.length) notes += (notes ? '\n' : '') + 'Observed: ' + eq.visible_details.join(', ');
      if (eq.confidence && eq.confidence !== 'high') notes += (notes ? '\n' : '') + `[AI confidence: ${eq.confidence}]`;
      if (notes) clean.notes = notes;

      // Auto-link manufacturer to the brand library so AI-bulk-created
      // equipment immediately benefits from logo coordination.
      if (clean.manufacturer && clean.manufacturer.trim()) {
        const mfgId = await autoLinkManufacturer(clean.manufacturer);
        if (mfgId) clean.manufacturer_id = mfgId;
      }

      const { data: created, error } = await NX.sb.from('equipment').insert(clean).select().single();
      if (error) {
        console.error('[AI-Create] Equipment insert failed:', { clean, error });
        results.failed++;
        results.errors.push(`${clean.name}: ${error.message}`);
        continue;
      }
      results.created++;

      // Graph linking — don't let failures here abort the main create
      try {
        const { data: eqNode } = await NX.sb.from('nodes').insert({
          name: clean.name,
          category: 'equipment',
          tags: [clean.location, clean.category, clean.manufacturer].filter(Boolean),
          notes: `${clean.manufacturer || ''} ${clean.model || ''}${clean.serial_number ? '\nSN: ' + clean.serial_number : ''}`.trim(),
          links: [], access_count: 1, source_emails: []
        }).select().single();

        if (eqNode) {
          await NX.sb.from('equipment').update({ node_id: eqNode.id }).eq('id', created.id);
          for (const name of (eq.linked_contractors || [])) await linkOrCreateNode(name, 'contractors', eqNode.id);
          for (const name of (eq.linked_people || []))      await linkOrCreateNode(name, 'people', eqNode.id);
          for (const name of (eq.linked_parts || [])) {
            const partNode = context.parts.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (partNode) await linkNodes(eqNode.id, partNode.id);
          }
        }
      } catch(e) { console.warn('[AI-Create] Graph link error (non-fatal):', e); }

      if (eq.mentioned_parts_new?.length) {
        try {
          const partsData = eq.mentioned_parts_new.map(p => ({
            equipment_id: created.id,
            part_name: p.name,
            oem_part_number: p.oem_part_number || null,
            supplier: 'Parts Town',
            supplier_url: `https://www.partstown.com/search?searchterm=${encodeURIComponent(p.oem_part_number || p.name)}`
          }));
          await NX.sb.from('equipment_parts').insert(partsData);
        } catch(e) { console.warn('[AI-Create] Parts insert error (non-fatal):', e); }
      }

      if (eq.mentioned_issues?.length) {
        try {
          for (const issue of eq.mentioned_issues) {
            await NX.work.create({
              title: `[${clean.name}] ${issue}`,
              notes: `Issue mentioned during AI equipment creation:\n${issue}\n\nEquipment: ${clean.name}`,
              priority: 'normal',
              location: clean.location,
              reportedBy: 'AI Create',
              aiCreated: true,
            });
          }
        } catch(e) { console.warn('[AI-Create] Tickets insert error (non-fatal):', e); }
      }

      // equipment_created_ai syslog → covered by Postgres trigger on equipment INSERT
    } catch (err) {
      console.error('[AI-Create] Unexpected error on item:', err, eq);
      results.failed++;
      results.errors.push(`${eq.name || 'Unknown'}: ${err.message}`);
    }
  }
  
  return results;
}

async function linkOrCreateNode(name, category, equipNodeId) {
  const { data: existing } = await NX.sb.from('nodes')
    .select('id').ilike('name', name).eq('category', category).limit(1);

  let nodeId;
  if (existing?.length) {
    nodeId = existing[0].id;
  } else {
    const { data: newNode } = await NX.sb.from('nodes').insert({
      name, category,
      tags: ['auto-created-by-ai'],
      notes: `Auto-created from equipment AI`,
      links: [], access_count: 1, source_emails: []
    }).select().single();
    if (newNode) nodeId = newNode.id;
  }

  if (nodeId && equipNodeId) await linkNodes(equipNodeId, nodeId);
}

async function linkNodes(a, b) {
  try {
    const [{ data: nodeA }, { data: nodeB }] = await Promise.all([
      NX.sb.from('nodes').select('links').eq('id', a).single(),
      NX.sb.from('nodes').select('links').eq('id', b).single()
    ]);
    const aLinks = Array.isArray(nodeA?.links) ? nodeA.links : [];
    const bLinks = Array.isArray(nodeB?.links) ? nodeB.links : [];
    if (!aLinks.includes(b)) aLinks.push(b);
    if (!bLinks.includes(a)) bLinks.push(a);
    await Promise.all([
      NX.sb.from('nodes').update({ links: aLinks }).eq('id', a),
      NX.sb.from('nodes').update({ links: bLinks }).eq('id', b)
    ]);
  } catch(e) { console.warn('Link nodes error:', e); }
}

async function loadExistingContext() {
  const [contractors, people, parts] = await Promise.all([
    NX.sb.from('nodes').select('id, name').eq('category', 'contractors').limit(100),
    NX.sb.from('nodes').select('id, name').eq('category', 'people').limit(100),
    NX.sb.from('nodes').select('id, name').eq('category', 'parts').limit(200)
  ]);
  return {
    contractors: contractors.data || [],
    people: people.data || [],
    parts: parts.data || []
  };
}

async function uploadCreatePhoto(file, eq) {
  try {
    const fname = `${Date.now()}-${(eq.name || 'equip').slice(0, 20).replace(/[^a-z0-9]/gi, '_')}.${(file.type.split('/')[1] || 'jpg')}`;
    const { data } = await NX.sb.storage.from('equipment-photos').upload(fname, file, { upsert: false, contentType: file.type });
    if (data) {
      const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
      return publicUrl;
    }
  } catch(e) { console.warn('Photo upload:', e); }
  return null;
}


/* ════════════════════════════════════════════════════════════════════════════
   7. PRINTING — QR paper stickers + Zebra ZPL
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── QR generation ─── */

function generateQRImage(qrCode, canvas) {
  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${qrCode}`;
  if (typeof QRious !== 'undefined') {
    try {
      new QRious({ element: canvas, value: scanURL, size: 220, foreground: '#000', background: '#fff', level: 'H' });
      return;
    } catch(e) {}
  }
  drawQRFallback(canvas, scanURL);
}

function drawQRFallback(canvas, text) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(text)}`;
}

function copyQRLink(qrCode) {
  const url = `${window.location.origin}${window.location.pathname}?equip=${qrCode}`;
  navigator.clipboard.writeText(url);
  NX.toast && NX.toast('Link copied ✓', 'success');
}

/* ─── Paper sticker printing ─── */

function printSingleQR(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;
  printStickers([eq], { variant: 'single' });
}

/* ─── Sticker print engine — shared by single + sheet + per-location.
   Editorial design: coin wordmark at top, QR center, equipment name
   in Outfit display, status stripe down the left edge, trilingual
   "scan to view" instruction at bottom. SVG-clean for sign-shop output.
   Cream background (not white) to match NEXUS palette and to feel
   like a typeset edition rather than a CMMS dump.
   ─────────────────────────────────────────────────────────────────── */
function printStickers(equipList, opts = {}) {
  if (!equipList || !equipList.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }
  const variant = opts.variant || 'sheet';   // 'single' | 'sheet'
  const labelTitle = opts.title || (
    variant === 'single' ? `QR — ${equipList[0].name}` :
    `NEXUS Equipment QR — ${equipList.length} item${equipList.length===1?'':'s'}`
  );

  // Palette-coherent status colors. Mirror nexus.css tokens but inlined
  // here because the print window has no access to the parent stylesheet.
  const STATUS_COLOR = {
    operational:   'var(--green)',  // olive-bronze
    needs_service: 'var(--accent)',  // brand gold
    down:          'var(--red)',  // oxblood
    retired:       'var(--faint)',  // graphite
  };
  // Coin URL — absolute so the print window can load it. Falls back to
  // Providentia (the default daily advisor). The print preview will
  // briefly show a placeholder until the coin loads from the same origin.
  const coinUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}assets/coin-providentia.png`;

  // Compose each sticker as a self-contained block. Internal layout uses
  // CSS grid so every element has a fixed slot — sign shops can rely on
  // consistent placement when they generate plates from the PDF.
  const stickerHTML = (eq) => {
    const url = opts.urlBuilder
      ? opts.urlBuilder(eq)
      : `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
    // SVG QR — scales infinitely without raster artifacts. Sign shops
    // love SVG because they can pull it directly into Illustrator.
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=svg&ecc=H&margin=0&data=${encodeURIComponent(url)}`;
    const stat = STATUS_COLOR[eq.status] || STATUS_COLOR.operational;
    const stationLine = [eq.location, eq.area].filter(Boolean).join(' · ');
    const modelLine = [eq.manufacturer, eq.model].filter(Boolean).join(' ');

    return `
      <div class="sticker" data-eq="${esc(eq.qr_code)}">
        <!-- Status stripe — left edge, vertical band of palette-coherent color -->
        <div class="status-stripe" style="background:${stat}"></div>

        <!-- Top: coin wordmark (replaces "NEXUS" text) — the strongest
             brand statement. Coin is the seal; nothing else needs to say it. -->
        <div class="head">
          <img class="coin" src="${coinUrl}" alt="NEXUS" crossorigin="anonymous">
          <div class="brand-line">N · E · X · U · S</div>
        </div>

        <!-- Middle: equipment identity — name in display face, station + model muted -->
        <div class="title-block">
          <div class="eq-name">${esc(eq.name)}</div>
          ${stationLine ? `<div class="eq-station">${esc(stationLine)}</div>` : ''}
          ${modelLine   ? `<div class="eq-model">${esc(modelLine)}</div>`     : ''}
        </div>

        <!-- QR — clean, full-contrast, no overlay. Critical: must scan from
             4ft away across a kitchen, so we keep it pure black on cream. -->
        <div class="qr-wrap">
          <img class="qr" src="${qrSrc}" alt="QR code">
          <div class="qr-id">${esc(eq.qr_code)}</div>
        </div>

        <!-- Footer: trilingual scan instruction. English / Spanish for
             your kitchens; Korean intentionally added because Orion
             noted bilingual+ teams. Tiny mono caps so it reads as
             instructional metadata, not body copy. -->
        <div class="foot">
          <div class="instr">SCAN TO VIEW · ESCANEAR PARA VER · 스캔하여 보기</div>
          <div class="cornerpiece tl"></div>
          <div class="cornerpiece tr"></div>
          <div class="cornerpiece bl"></div>
          <div class="cornerpiece br"></div>
        </div>
      </div>
    `;
  };

  const allStickers = equipList.map(stickerHTML).join('');
  // For sheet mode, group into pages of 12 (4 rows × 3 cols on letter)
  // so page breaks land cleanly. CSS handles the actual paging via
  // page-break-inside: avoid on each .sticker.
  const wrapClass = variant === 'single' ? 'single-wrap' : 'sheet-wrap';

  const w = window.open('', '_blank');
  if (!w) { NX.toast && NX.toast('Popup blocked — allow popups to print', 'warn'); return; }

  w.document.write(`<!DOCTYPE html>
<html><head>
<title>${esc(labelTitle)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* ═══ Print sheet — palette + page setup ═══ */
  @page {
    size: letter portrait;
    /* Sign shops need bleed margins. 6mm is generous and matches
       common cutting tolerances. Background extends fully to the edge
       so cuts don't reveal white paper underneath. */
    margin: 6mm;
  }

  :root {
    --cream:  #fdf8ec;     /* sticker face — warm not white */
    --cream-deep: #f3ead4; /* slightly deeper for inner panels */
    --ink:    var(--nx-gold-on);     /* near-black, brown undertone */
    --gold:   var(--accent);     /* brand accent, print-safe */
    --gold-deep: var(--accent);  /* gold-line color, deeper for paper */
    --hairline: rgba(139, 105, 20, 0.22);
  }

  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: #f1ead7;
    font-family: 'DM Sans', system-ui, sans-serif;
    color: var(--ink);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* ═══ Layout — single vs sheet ═══ */
  .single-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 12mm;
  }
  .single-wrap .sticker {
    /* Single mode: standard ~3.5" × 5" portrait sticker, suitable
       for 4×6 thermal label printers OR cut-from-letter. */
    width: 90mm;
    height: 130mm;
  }

  .sheet-wrap {
    display: grid;
    /* 3 cols × 4 rows = 12 per letter page. Each sticker ~60mm × 60mm
       finished. Sign shops can guillotine on the dotted lines. */
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: 88mm;
    gap: 4mm;
    padding: 0;
  }
  .sheet-wrap .sticker {
    width: 100%;
    height: 100%;
  }

  /* ═══ Sticker base — used by both modes ═══ */
  .sticker {
    position: relative;
    background: var(--cream);
    border: 1px solid var(--gold-deep);
    border-radius: 6px;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    padding: 5mm 5mm 4mm 8mm;   /* extra left padding for status stripe */
    color: var(--ink);
    /* Subtle paper-grain feel via two layered radial gradients —
       prints faithfully on both inkjet and offset. */
    background-image:
      radial-gradient(1200px 600px at 30% -10%, rgba(212, 164, 78, 0.06) 0%, transparent 60%),
      radial-gradient(800px 400px at 80% 110%, rgba(139, 105, 20, 0.05) 0%, transparent 60%);
  }

  /* Vertical status stripe down the left edge — visible from across
     the kitchen, palette-coherent (gold/olive/oxblood/graphite, no
     scarlet/green). This is the "from across the room" tell. */
  .status-stripe {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    width: 4mm;
  }

  /* Decorative corner pieces — small gold L-shapes in each corner.
     Editorial flourish; reads as "deliberate" rather than utility. */
  .cornerpiece {
    position: absolute;
    width: 4mm; height: 4mm;
    border: 0.4mm solid var(--gold);
    pointer-events: none;
  }
  .cornerpiece.tl { top: 1.5mm; left: 5.5mm;  border-right: none; border-bottom: none; }
  .cornerpiece.tr { top: 1.5mm; right: 1.5mm; border-left:  none; border-bottom: none; }
  .cornerpiece.bl { bottom: 1.5mm; left: 5.5mm;  border-right: none; border-top: none; }
  .cornerpiece.br { bottom: 1.5mm; right: 1.5mm; border-left:  none; border-top: none; }

  /* ═══ Head — coin in place of "NEXUS" wordmark ═══ */
  .head {
    text-align: center;
    padding-bottom: 2mm;
    border-bottom: 0.3mm solid var(--hairline);
    margin-bottom: 3mm;
  }
  .coin {
    width: 14mm;
    height: 14mm;
    object-fit: contain;
    display: block;
    margin: 0 auto 1mm;
  }
  .single-wrap .coin { width: 22mm; height: 22mm; margin-bottom: 1.5mm; }
  .brand-line {
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 2pt;
    color: var(--gold-deep);
    text-transform: uppercase;
  }
  .single-wrap .brand-line { font-size: 9pt; letter-spacing: 3pt; }

  /* ═══ Title block — equipment identity ═══ */
  .title-block {
    text-align: center;
    margin-bottom: 2mm;
    padding: 0 2mm;
  }
  .eq-name {
    font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
    font-size: 11pt;
    font-weight: 500;
    line-height: 1.15;
    letter-spacing: -0.2pt;
    color: var(--ink);
    /* Truncate gracefully for very long names */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .single-wrap .eq-name { font-size: 18pt; -webkit-line-clamp: 3; }
  .eq-station {
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    font-size: 6.5pt;
    font-weight: 500;
    letter-spacing: 1.5pt;
    color: var(--gold-deep);
    text-transform: uppercase;
    margin-top: 1mm;
  }
  .single-wrap .eq-station { font-size: 9pt; letter-spacing: 2pt; margin-top: 2mm; }
  .eq-model {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 6.5pt;
    color: rgba(28, 20, 8, 0.55);
    margin-top: 0.8mm;
  }
  .single-wrap .eq-model { font-size: 9pt; margin-top: 1mm; }

  /* ═══ QR — black on cream, clean and full contrast ═══ */
  .qr-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5mm;
    margin: 1mm 0;
  }
  .qr {
    /* Square aspect, sized by container. SVG output scales infinitely. */
    width: 38mm;
    height: 38mm;
    /* Wrap in a tiny gold frame — editorial, not utility */
    border: 0.3mm solid var(--gold);
    padding: 1.5mm;
    background: white;
  }
  .single-wrap .qr { width: 60mm; height: 60mm; padding: 2.5mm; }
  .qr-id {
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    font-size: 5.5pt;
    font-weight: 600;
    letter-spacing: 0.8pt;
    color: var(--gold-deep);
  }
  .single-wrap .qr-id { font-size: 8pt; letter-spacing: 1.2pt; }

  /* ═══ Footer — trilingual scan instruction ═══ */
  .foot {
    text-align: center;
    padding-top: 2mm;
    border-top: 0.3mm solid var(--hairline);
  }
  .instr {
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    font-size: 5pt;
    font-weight: 500;
    letter-spacing: 0.5pt;
    color: rgba(28, 20, 8, 0.6);
    /* The Korean glyphs need slightly more room — give the line a touch
       of breathing space top to bottom. */
    line-height: 1.5;
  }
  .single-wrap .instr { font-size: 7pt; letter-spacing: 0.7pt; }

  /* ═══ Sheet-mode-only utility ═══ */
  /* Tiny tear-off line between rows — visual cue for guillotine cuts. */
  @media print {
    body { background: var(--cream); }
    .sheet-wrap { gap: 4mm; }
    .sticker {
      box-shadow: none;
    }
  }
</style>
</head>
<body>
  <div class="${wrapClass}">${allStickers}</div>
  <script>
    // Wait for fonts AND coin AND first QR image to load before printing.
    // Sign shops printing the resulting PDF expect everything resolved.
    Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...Array.from(document.images).map(img => img.complete
        ? Promise.resolve()
        : new Promise(r => { img.onload = img.onerror = r; })
      )
    ]).then(() => setTimeout(() => window.print(), 250));
  </script>
</body></html>`);
  w.document.close();
}

/* ─── Inventory sticker wrapper ─────────────────────────────────────
   Reuses the same editorial sticker template (coin, status stripe,
   trilingual scan footer) for inventory assets and stock parts.
   Adapts the inventory data shape into the equipment shape that
   printStickers expects, and supplies a custom URL builder so the
   QR points at ?inv-asset=XXX or ?inv-stock=XXX instead of ?equip=.

   Inventory items don't have status_color states like equipment does,
   so we map the inventory status to a single sane default (gold for
   in-flight, olive-bronze for stable, oxblood for problems).
*/
function printInventoryStickers(items, type /* 'asset' | 'stock' */) {
  if (!items || !items.length) {
    NX.toast && NX.toast('No items to print', 'info');
    return;
  }
  const param = type === 'asset' ? 'inv-asset' : 'inv-stock';

  // Adapt inventory shape → equipment shape that stickerHTML expects.
  // Pre-color via a synthetic 'status' that maps into STATUS_COLOR.
  const adapted = items.map(item => {
    let synthStatus = 'operational';  // → olive-bronze
    if (type === 'asset') {
      if (item.status === 'broken' || item.status === 'missing') synthStatus = 'down';
      else if (item.status === 'loaned' || item.status === 'relocated') synthStatus = 'needs_service';
      else if (item.status === 'retired') synthStatus = 'retired';
    } else {
      // Stock — coloring by PAR is more useful than a single status
      if (item.is_below_threshold || item.count_on_hand < (item.reorder_threshold ?? 1)) synthStatus = 'down';
      else if (item.is_below_par || item.count_on_hand < (item.par_level ?? 1)) synthStatus = 'needs_service';
    }
    return {
      qr_code:      item.qr_code,
      name:         item.name,
      manufacturer: item.manufacturer,
      model:        item.model || item.manufacturer_pn,  // stock uses OEM PN here
      location:     item.home_location || item.location,
      area:         item.bin_hint,                        // stock bin shown like an "area"
      status:       synthStatus,
    };
  });

  printStickers(adapted, {
    variant: items.length === 1 ? 'single' : 'sheet',
    title: items.length === 1
      ? `QR — ${items[0].name}`
      : `NEXUS Inventory QR — ${items.length} ${type}${items.length === 1 ? '' : 's'}`,
    urlBuilder: (eq) => `${window.location.origin}${window.location.pathname}?${param}=${eq.qr_code}`,
  });
}

/* ─── Service Log Sheet — single-page printable history + handwritten
   future-entries form. Goes in a binder near the equipment, or on a
   clipboard nearby. Editorial design matches the QR sticker aesthetic
   so binders/walls feel like a unified system, not parts from
   different tools.

   Layout (US Letter portrait):
     ┌──────────────────────────────────────────┐
     │  [coin]  N · E · X · U · S    [QR]      │
     │  ─────────────────────────────────────   │
     │  Equipment identity block (specs grid)   │
     │  Status + warranty banner                │
     │  ─────────────────────────────────────   │
     │  Recent service history (last 5)         │
     │  ─────────────────────────────────────   │
     │  Future entries form (12 blank rows)     │
     │  ─────────────────────────────────────   │
     │  Footer: location, print date, scan note │
     └──────────────────────────────────────────┘

   The pre-printed history at the top gives contractors context they
   need before touching the equipment. The blank-row table at the
   bottom is for analog-trusting techs who want to write before they
   sync. The QR at the top right links back to the digital record so
   anything they wrote down can be reconciled with NEXUS later.
   ─────────────────────────────────────────────────────────────── */
async function printServiceLog(id) {
  const eq = equipment.find(e => e.id === id);
  if (!eq) return;

  // Fetch the last 5 service events and the most recent few open
  // tickets (if any). Both are best-effort — a missing table doesn't
  // block the print, the relevant section just renders empty.
  let maint = [];
  let openTicket = null;
  try {
    if (NX.sb) {
      const { data } = await NX.sb.from('equipment_maintenance')
        .select('event_date, event_type, description, performed_by, cost, parts_replaced, next_pm_due')
        .eq('equipment_id', id)
        .order('event_date', { ascending: false })
        .limit(5);
      if (data) maint = data;

      // Latest open ticket (issue) for this equipment, if any
      const { data: tk } = await NX.sb.from('tickets')
        .select('title, created_at, reported_by')
        .contains('linked_equipment_ids', [id])
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1);
      if (tk && tk.length) openTicket = tk[0];
    }
  } catch (e) { /* best-effort, continue with empty history */ }

  const STATUS_COLOR = {
    operational:   'var(--green)',
    needs_service: 'var(--accent)',
    down:          'var(--red)',
    retired:       'var(--faint)',
  };
  const STATUS_LABEL = {
    operational:   'Operational',
    needs_service: 'Needs Service',
    down:          'Down',
    retired:       'Retired',
  };
  const stat   = STATUS_COLOR[eq.status]   || STATUS_COLOR.operational;
  const statL  = STATUS_LABEL[eq.status]   || (eq.status || 'Unknown');

  // Warranty calc — drives the warranty banner color and message.
  const today = new Date();
  const warrantyDate = eq.warranty_until ? new Date(eq.warranty_until) : null;
  const warrantyValid = warrantyDate && warrantyDate > today;
  const warrantyDays = warrantyValid
    ? Math.floor((warrantyDate.getTime() - today.getTime()) / 86400000)
    : 0;

  const nextPM = eq.next_pm_date ? new Date(eq.next_pm_date) : null;
  const pmOverdue = nextPM && nextPM < today;
  const pmDays = pmOverdue ? Math.floor((today.getTime() - nextPM.getTime()) / 86400000) : 0;

  // QR for the small corner code (links back to digital)
  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=svg&ecc=H&margin=0&data=${encodeURIComponent(scanURL)}`;
  // Coin URL — same one used on the QR sticker
  const coinUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}assets/coin-providentia.png`;

  // Format helpers
  const fmtDate = (d) => {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const fmtDateShort = (d) => {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  };
  const fmtCost = (c) => {
    if (c == null || c === '') return '';
    const n = parseFloat(c);
    if (isNaN(n)) return '';
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  // Pre-printed history rows. If none exist, we leave the section header
  // visible but show a "No service events recorded yet" line so the page
  // doesn't look broken — and the contractor knows they're at zero.
  const historyRows = maint.length ? maint.map(m => {
    const eventLabel = (m.event_type || 'service').replace(/_/g, ' ').toUpperCase();
    return `
      <tr>
        <td class="hist-date">${esc(fmtDateShort(m.event_date))}</td>
        <td class="hist-type">${esc(eventLabel)}</td>
        <td class="hist-desc">
          ${esc(m.description || '—')}
          ${m.parts_replaced ? `<div class="hist-parts"><span class="hist-parts-label">Parts:</span> ${esc(m.parts_replaced)}</div>` : ''}
        </td>
        <td class="hist-by">${esc(m.performed_by || '—')}</td>
        <td class="hist-cost">${esc(fmtCost(m.cost))}</td>
      </tr>
    `;
  }).join('') : `
    <tr><td colspan="5" class="hist-empty">No service events recorded in NEXUS yet.</td></tr>
  `;

  // 12 blank entry rows for handwritten future logs. Slightly tall
  // (8mm) so a contractor can write comfortably with a regular pen.
  const blankRows = Array.from({ length: 12 }, () => `
    <tr class="blank-row">
      <td class="blank-date"></td>
      <td class="blank-work"></td>
      <td class="blank-tech"></td>
      <td class="blank-cost"></td>
      <td class="blank-sign"></td>
    </tr>
  `).join('');

  // Status of the equipment as a discrete band — uses the same
  // palette-coherent color as everywhere else (no scarlets, no greens).
  const statusBanner = `
    <div class="status-banner">
      <span class="status-dot" style="background:${stat}"></span>
      <span class="status-label" style="color:${stat}">${esc(statL)}</span>
      ${pmOverdue ? `<span class="status-meta">PM ${pmDays} day${pmDays===1?'':'s'} overdue</span>` :
        nextPM ?    `<span class="status-meta">Next PM ${fmtDate(nextPM)}</span>` : ''}
      ${warrantyValid ? `<span class="status-meta status-warranty">Under warranty — ${warrantyDays} day${warrantyDays===1?'':'s'} left</span>` : ''}
      ${openTicket ? `<span class="status-meta status-issue">Open issue: ${esc((openTicket.title||'').slice(0,40))}</span>` : ''}
    </div>
  `;

  const w = window.open('', '_blank');
  if (!w) { NX.toast && NX.toast('Popup blocked — allow popups to print', 'warn'); return; }

  w.document.write(`<!DOCTYPE html>
<html><head>
<title>Service Log — ${esc(eq.name)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* ═══════════════════════════════════════════════════════════════
     Service Log Sheet — single page, US Letter portrait.
     Editorial palette matches the QR sticker so binders feel unified.
     Print-color-adjust:exact preserves cream + gold + status tint.
     ═══════════════════════════════════════════════════════════════ */
  @page { size: letter portrait; margin: 12mm; }

  :root {
    --cream:      #fdf8ec;
    --cream-deep: #f3ead4;
    --ink:        var(--nx-gold-on);
    --ink-soft:   rgba(28, 20, 8, 0.7);
    --ink-faint:  rgba(28, 20, 8, 0.45);
    --gold:       var(--accent);
    --gold-deep:  var(--accent);
    --hairline:   rgba(139, 105, 20, 0.22);
    --rule:       rgba(139, 105, 20, 0.45);
    --status:     ${stat};
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--cream);
    font-family: 'DM Sans', system-ui, sans-serif;
    color: var(--ink);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-size: 10pt;
    line-height: 1.4;
  }
  .page {
    /* Letter page minus print margins. Single page; nothing should
       overflow or paginate. The blank-row table is sized so 12 rows
       fit comfortably on the same sheet. */
    width: 100%;
    max-width: 186mm;   /* letter width minus 12mm × 2 margins */
    margin: 0 auto;
    padding: 0;
    /* Subtle paper grain — same as sticker */
    background-image:
      radial-gradient(1200px 600px at 30% -10%, rgba(212, 164, 78, 0.05) 0%, transparent 60%),
      radial-gradient(800px 400px at 80% 110%, rgba(139, 105, 20, 0.04) 0%, transparent 60%);
  }

  /* ═══ HEADER — coin + brand line + small QR top-right ═══ */
  .header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10mm;
    padding-bottom: 4mm;
    border-bottom: 0.5mm solid var(--gold-deep);
  }
  .header-coin {
    width: 18mm; height: 18mm;
    object-fit: contain;
  }
  .header-brand {
    text-align: center;
  }
  .brand-mark {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10pt;
    font-weight: 600;
    letter-spacing: 4pt;
    color: var(--gold-deep);
    margin: 0;
  }
  .doc-title {
    font-family: 'Outfit', sans-serif;
    font-size: 18pt;
    font-weight: 500;
    letter-spacing: -0.3pt;
    color: var(--ink);
    margin: 1mm 0 0;
    line-height: 1.1;
  }
  .doc-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    letter-spacing: 1.5pt;
    text-transform: uppercase;
    color: var(--gold-deep);
    margin-top: 1mm;
  }
  .header-qr-block {
    text-align: center;
  }
  .header-qr {
    width: 18mm; height: 18mm;
    border: 0.3mm solid var(--gold);
    padding: 1mm;
    background: white;
    display: block;
  }
  .header-qr-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 6.5pt;
    font-weight: 600;
    letter-spacing: 0.5pt;
    color: var(--gold-deep);
    margin-top: 1mm;
  }

  /* ═══ EQUIPMENT IDENTITY — the spec grid ═══ */
  .identity {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3mm 6mm;
    padding: 5mm 0;
  }
  .spec-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 1.2pt;
    text-transform: uppercase;
    color: var(--gold-deep);
    margin-bottom: 0.5mm;
  }
  .spec-value {
    font-size: 10pt;
    color: var(--ink);
    font-weight: 500;
    line-height: 1.3;
    word-break: break-word;
  }
  .spec-value.dim { color: var(--ink-faint); }

  /* ═══ STATUS BANNER — current state at a glance ═══ */
  .status-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8pt;
    padding: 3mm 4mm;
    border: 0.3mm solid var(--hairline);
    border-left: 1.5mm solid var(--status);
    background: rgba(212, 164, 78, 0.04);
    border-radius: 1.5mm;
    font-size: 9pt;
    margin-bottom: 5mm;
  }
  .status-dot {
    width: 8pt; height: 8pt; border-radius: 50%;
    display: inline-block;
  }
  .status-label {
    font-family: 'Outfit', sans-serif;
    font-weight: 600;
    font-size: 11pt;
    letter-spacing: 0.2pt;
  }
  .status-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    letter-spacing: 0.5pt;
    color: var(--ink-soft);
    padding-left: 8pt;
    border-left: 0.2mm solid var(--hairline);
  }
  .status-meta.status-warranty { color: var(--gold-deep); font-weight: 600; }
  .status-meta.status-issue { color: var(--status); font-weight: 600; }

  /* ═══ SECTION TITLE — gold caps with ruled line below ═══ */
  .section-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9pt;
    font-weight: 600;
    letter-spacing: 2.5pt;
    text-transform: uppercase;
    color: var(--gold-deep);
    margin: 2mm 0 2mm;
    padding-bottom: 1mm;
    border-bottom: 0.4mm solid var(--rule);
  }

  /* ═══ HISTORY TABLE — pre-printed last 5 events ═══ */
  .history-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4mm;
    font-size: 9pt;
  }
  .history-table th {
    text-align: left;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 1pt;
    text-transform: uppercase;
    color: var(--gold-deep);
    padding: 1.5mm 2mm;
    border-bottom: 0.3mm solid var(--rule);
  }
  .history-table td {
    padding: 2mm;
    border-bottom: 0.2mm solid var(--hairline);
    vertical-align: top;
  }
  .hist-date { width: 18mm; font-family: 'JetBrains Mono', monospace; font-size: 8pt; color: var(--ink-soft); }
  .hist-type { width: 22mm; font-family: 'JetBrains Mono', monospace; font-size: 7pt; font-weight: 600; letter-spacing: 0.8pt; color: var(--gold-deep); }
  .hist-desc { font-size: 9pt; }
  .hist-parts { font-size: 8pt; color: var(--ink-soft); margin-top: 1mm; }
  .hist-parts-label { font-family: 'JetBrains Mono', monospace; font-size: 7pt; letter-spacing: 0.5pt; text-transform: uppercase; color: var(--gold-deep); }
  .hist-by   { width: 32mm; font-size: 9pt; color: var(--ink-soft); }
  .hist-cost { width: 16mm; font-family: 'JetBrains Mono', monospace; font-size: 9pt; text-align: right; color: var(--ink-soft); }
  .hist-empty { color: var(--ink-faint); font-style: italic; padding: 4mm 2mm; text-align: center; }

  /* ═══ FUTURE ENTRIES — 12 blank rows for handwriting ═══ */
  .blank-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1mm;
  }
  .blank-table th {
    text-align: left;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 1pt;
    text-transform: uppercase;
    color: var(--gold-deep);
    padding: 1.5mm 2mm;
    border-bottom: 0.4mm solid var(--rule);
  }
  .blank-table td {
    border-bottom: 0.2mm solid var(--hairline);
    height: 8mm;             /* generous writing room */
    padding: 0 2mm;
  }
  .blank-date { width: 22mm; }
  .blank-work { /* takes the rest */ }
  .blank-tech { width: 32mm; }
  .blank-cost { width: 18mm; }
  .blank-sign { width: 26mm; }

  /* ═══ FOOTER — print metadata + scan-to-update note ═══ */
  .foot {
    margin-top: 6mm;
    padding-top: 3mm;
    border-top: 0.4mm solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    letter-spacing: 0.8pt;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .foot strong { color: var(--gold-deep); font-weight: 600; }
  .foot-note { text-align: right; }
  .foot-note .lang {
    display: block;
    font-size: 6.5pt;
    line-height: 1.5;
  }

  /* Decorative gold corner ornaments — same flourish as sticker. */
  .page { position: relative; }
  .corner {
    position: absolute;
    width: 6mm; height: 6mm;
    border: 0.4mm solid var(--gold);
    pointer-events: none;
  }
  .corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
  .corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
  .corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
  .corner.br { bottom: 0; right: 0; border-left: none; border-top: none; }
</style>
</head>
<body>
<div class="page">
  <span class="corner tl"></span>
  <span class="corner tr"></span>
  <span class="corner bl"></span>
  <span class="corner br"></span>

  <!-- Header: coin / title block / QR -->
  <header class="header">
    <img class="header-coin" src="${coinUrl}" alt="NEXUS" crossorigin="anonymous">
    <div class="header-brand">
      <div class="brand-mark">N · E · X · U · S</div>
      <h1 class="doc-title">${esc(eq.name)}</h1>
      <div class="doc-sub">SERVICE LOG · ${esc((eq.location || '').toUpperCase())}${eq.area ? ' · ' + esc(eq.area.toUpperCase()) : ''}</div>
    </div>
    <div class="header-qr-block">
      <img class="header-qr" src="${qrSrc}" alt="QR">
      <div class="header-qr-id">${esc(eq.qr_code)}</div>
    </div>
  </header>

  <!-- Identity grid: 8 spec fields, 4 columns × 2 rows -->
  <div class="identity">
    <div>
      <div class="spec-label">Manufacturer</div>
      <div class="spec-value">${esc(eq.manufacturer || '—')}</div>
    </div>
    <div>
      <div class="spec-label">Model</div>
      <div class="spec-value">${esc(eq.model || '—')}</div>
    </div>
    <div>
      <div class="spec-label">Serial Number</div>
      <div class="spec-value">${esc(eq.serial_number || '—')}</div>
    </div>
    <div>
      <div class="spec-label">Category</div>
      <div class="spec-value">${esc((eq.category || '—').replace(/^\w/, c => c.toUpperCase()))}</div>
    </div>
    <div>
      <div class="spec-label">Installed</div>
      <div class="spec-value">${esc(fmtDate(eq.install_date))}</div>
    </div>
    <div>
      <div class="spec-label">Warranty Until</div>
      <div class="spec-value ${warrantyValid ? '' : 'dim'}">${esc(fmtDate(eq.warranty_until))}${warrantyValid ? '' : eq.warranty_until ? ' (expired)' : ''}</div>
    </div>
    <div>
      <div class="spec-label">Next PM Due</div>
      <div class="spec-value ${pmOverdue ? '' : 'dim'}">${esc(fmtDate(eq.next_pm_date))}${pmOverdue ? ' (overdue)' : ''}</div>
    </div>
    <div>
      <div class="spec-label">Asset ID</div>
      <div class="spec-value">${esc(eq.qr_code)}</div>
    </div>
  </div>

  <!-- Status banner — palette-coherent stripe + condition meta -->
  ${statusBanner}

  <!-- Recent service history (last 5 from equipment_maintenance) -->
  <h2 class="section-title">Recent Service History</h2>
  <table class="history-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Work Performed</th>
        <th>Technician</th>
        <th style="text-align:right">Cost</th>
      </tr>
    </thead>
    <tbody>
      ${historyRows}
    </tbody>
  </table>

  <!-- Future entries — handwritten log -->
  <h2 class="section-title">Future Service Entries</h2>
  <table class="blank-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Work Performed / Notes</th>
        <th>Technician / Company</th>
        <th style="text-align:right">Cost</th>
        <th>Signature</th>
      </tr>
    </thead>
    <tbody>${blankRows}</tbody>
  </table>

  <!-- Footer: print metadata + reconciliation note -->
  <div class="foot">
    <div>
      Printed <strong>${esc(fmtDate(today))}</strong>
      &nbsp;·&nbsp; Sheet: ${esc(eq.qr_code)}
    </div>
    <div class="foot-note">
      <span class="lang">SCAN QR ABOVE TO RECONCILE WITH NEXUS</span>
      <span class="lang">ESCANEE EL CÓDIGO PARA SINCRONIZAR</span>
    </div>
  </div>
</div>

<script>
  // Wait for fonts + coin + QR to fully resolve before triggering print.
  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...Array.from(document.images).map(img => img.complete
      ? Promise.resolve()
      : new Promise(r => { img.onload = img.onerror = r; })
    )
  ]).then(() => setTimeout(() => window.print(), 250));
</script>
</body></html>`);
  w.document.close();
}

/* ─── Mass-print sheet — picks restaurant first, then prints all
   equipment for that location (or "all" across locations).
   Designed for sign-shop output: produces a clean printable PDF the
   shop can pull into Illustrator and run on aluminum or vinyl.
   ─────────────────────────────────────────────────────────────── */
function printQRSheet() {
  // Build a small modal with location chips + "all locations" + a count
  // preview per location. No heavy modal infra — vanilla overlay.
  const all = equipment.filter(e => !e.archived && e.qr_code);
  if (!all.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }

  // Pre-count per location so the user sees "Suerte (47)" not just "Suerte".
  const counts = LOCATIONS.reduce((m, loc) => {
    m[loc] = all.filter(e => (e.location || '') === loc).length;
    return m;
  }, {});
  const totalCount = all.length;

  // Use the existing modal helper if available; otherwise build inline.
  const overlay = document.createElement('div');
  overlay.id = 'eqPrintLocationOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(8, 6, 4, 0.7);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    font-family: 'DM Sans', system-ui, sans-serif;
  `;

  // Location chip helper — same look as the rest of NEXUS.
  const chip = (label, count, value) => `
    <button class="eq-print-chip" data-loc="${esc(value)}" type="button"
      ${count === 0 ? 'disabled' : ''}>
      <span class="chip-label">${esc(label)}</span>
      <span class="chip-count">${count} item${count===1?'':'s'}</span>
    </button>
  `;

  overlay.innerHTML = `
    <div class="eq-print-modal">
      <div class="eq-print-head">
        <div class="eq-print-eyebrow">MASS PRINT · QR STICKERS</div>
        <h2 class="eq-print-title">Which location?</h2>
        <p class="eq-print-sub">Pick a restaurant — every active piece of equipment there gets its own sticker. Send the resulting PDF to your sign shop.</p>
      </div>
      <div class="eq-print-chips">
        ${LOCATIONS.map(loc => chip(loc, counts[loc] || 0, loc)).join('')}
        <button class="eq-print-chip eq-print-chip-all" data-loc="__all__" type="button">
          <span class="chip-label">All locations</span>
          <span class="chip-count">${totalCount} items</span>
        </button>
      </div>
      <div class="eq-print-foot">
        <button class="eq-print-cancel" type="button">Cancel</button>
      </div>
    </div>
    <style>
      .eq-print-modal {
        background: var(--surface);
        border: 1px solid rgba(212, 164, 78, 0.3);
        border-radius: 14px;
        max-width: 420px; width: 100%;
        padding: 28px 24px 22px;
        color: var(--text);
        box-shadow: 0 16px 40px rgba(0,0,0,.5);
      }
      .eq-print-eyebrow {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9.5px; font-weight: 600; letter-spacing: 2.5px;
        color: var(--accent); margin-bottom: 6px;
      }
      .eq-print-title {
        font-family: 'Outfit', sans-serif;
        font-size: 22px; font-weight: 500; margin: 0 0 6px;
        letter-spacing: -0.2px;
      }
      .eq-print-sub {
        font-size: 13px; color: var(--muted);
        margin: 0 0 20px; line-height: 1.5;
      }
      .eq-print-chips {
        display: grid; gap: 8px;
      }
      .eq-print-chip {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 16px;
        background: transparent;
        border: 1px solid rgba(212, 164, 78, 0.18);
        border-radius: 12px;
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        cursor: pointer;
        transition: background .15s, border-color .15s, transform .15s;
        -webkit-tap-highlight-color: transparent;
        text-align: left;
      }
      .eq-print-chip:hover:not(:disabled) {
        background: rgba(212, 164, 78, 0.08);
        border-color: rgba(212, 164, 78, 0.4);
      }
      .eq-print-chip:active:not(:disabled) { transform: scale(.98); }
      .eq-print-chip:disabled {
        opacity: 0.35; cursor: not-allowed;
      }
      .eq-print-chip .chip-label {
        font-weight: 500; letter-spacing: 0.1px;
      }
      .eq-print-chip .chip-count {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px; color: var(--accent);
        letter-spacing: 0.5px;
      }
      .eq-print-chip-all {
        margin-top: 4px;
        background: rgba(212, 164, 78, 0.08);
        border-color: rgba(212, 164, 78, 0.4);
      }
      .eq-print-foot {
        margin-top: 20px;
        display: flex; justify-content: flex-end;
      }
      .eq-print-cancel {
        background: transparent;
        border: 1px solid rgba(212, 164, 78, 0.18);
        border-radius: 10px;
        color: var(--muted);
        font-family: inherit; font-size: 13px;
        padding: 8px 16px; cursor: pointer;
        transition: color .15s, border-color .15s;
      }
      .eq-print-cancel:hover {
        color: var(--accent);
        border-color: rgba(212, 164, 78, 0.4);
      }
      @media (prefers-color-scheme: light) {}
    </style>
  `;

  const close = () => overlay.remove();

  overlay.addEventListener('click', e => {
    // Click on backdrop closes
    if (e.target === overlay) close();
  });
  overlay.querySelector('.eq-print-cancel').addEventListener('click', close);

  overlay.querySelectorAll('.eq-print-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const loc = btn.getAttribute('data-loc');
      const list = loc === '__all__'
        ? all
        : all.filter(e => (e.location || '') === loc);
      if (!list.length) {
        NX.toast && NX.toast(`No equipment for ${loc}`, 'info');
        return;
      }
      // Sort: by location → area → name. Within a sheet, items group
      // visually by station, so the print matches a physical walkthrough.
      list.sort((a, b) =>
        (a.location || '').localeCompare(b.location || '') ||
        (a.area     || '').localeCompare(b.area     || '') ||
        (a.name     || '').localeCompare(b.name     || '')
      );
      close();
      const title = loc === '__all__'
        ? `NEXUS QR Sheet — All locations (${list.length})`
        : `NEXUS QR Sheet — ${loc} (${list.length})`;
      printStickers(list, { variant: 'sheet', title });
    });
  });

  // Esc to close
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

/* ════════════════════════════════════════════════════════════════════════════
   v18.32 — RESQ CSV EXPORT
   ════════════════════════════════════════════════════════════════════════════
   Schema confirmed against ResQ's own CSV export (taken May 29, 2026 — the
   Export button on their Assets page gives the exact column layout their
   importer expects). The actual columns are different from the labels shown
   in their Add Asset form — for instance "Asset Name" in the UI is just
   "Name" in the CSV, "Asset Type" is "Equipment Category", "QR Code/Number"
   is "Bar Code", "Facility" is "Facility Name". Always trust the export.

   ResQ's 12-column schema:
     Id, Name, Manufacturer, Bar Code, Facility Name, Serial Number,
     Model Number, Equipment Category, Status, Cost of Asset,
     Total Spend, Last repair date

   Mapping to NEXUS columns:
     Id                 → blank (ResQ assigns on import for new rows)
     Name               ← eq.name
     Manufacturer       ← eq.manufacturer
     Bar Code           ← eq.qr_code
     Facility Name      ← eq.location, uppercased (their example showed "ESTE")
     Serial Number      ← eq.serial_number
     Model Number       ← eq.model
     Equipment Category ← mapToResQType(eq) — heuristic mapping from
                          NEXUS's broad categories ("refrigeration",
                          "cooking") + the equipment NAME to ResQ's
                          specific types ("Walk-In Cooler", "Fryer").
                          See mapToResQType below for the rules.
     Status             → "ACTIVE" for everything we export (NEXUS down/
                          needs_service are still in-service for ResQ
                          tracking; user flips to DOWN post-import if needed)
     Cost of Asset      ← eq.purchase_price
     Total Spend        → blank (derived by ResQ from work orders)
     Last repair date   → blank (derived by ResQ from work orders)

   Notes, warranty, and photo fields aren't part of ResQ's import schema —
   only addable through their Add Asset form. NEXUS retains those fields,
   they just don't travel through this CSV.

   Archived/retired/missing/relocated equipment is excluded — those aren't
   relevant to forward-looking ResQ tracking.
   ════════════════════════════════════════════════════════════════════════════ */

/* v18.32 — ResQ category mapping.
   Heuristic: NEXUS groups equipment into ~9 broad categories
   (refrigeration, cooking, ice, hvac, dish, bev, smallware, furniture,
   other). ResQ expects specific equipment TYPES ("Walk-In Cooler",
   "Iced Tea Machine", "Combi Oven", ...). This function maps each
   NEXUS equipment row to its best-guess ResQ type by:
     1. Looking at the NEXUS category for the bucket of candidates
     2. Pattern-matching keywords in the equipment NAME to narrow to
        the specific type within that bucket
     3. Falling back to a bucket default if no keyword match

   The mapping is intentionally heuristic — ResQ accepts free-text for
   the Equipment Category column on import, so a "wrong" guess just
   means the user changes it post-import. Better to get 80% right than
   to leave every row blank for manual edit.

   Returns the ResQ type string. */
function mapToResQType(eq) {
  const cat  = String(eq && eq.category || '').toLowerCase().trim();
  const name = String(eq && eq.name     || '').toLowerCase();
  // Test if the equipment name contains any of the given keywords
  const has = (...kws) => kws.some(kw => name.includes(kw));

  switch (cat) {
    case 'refrigeration':
      if (has('walk-in', 'walk in', 'walkin')) {
        if (has('freez')) return 'Walk-In Freezer';
        return 'Walk-In Cooler';
      }
      if (has('reach-in', 'reach in', 'reachin')) {
        if (has('freez')) return 'Reach-In Freezer';
        return 'Reach-In Refrigerator';
      }
      if (has('prep table', 'sandwich', 'pizza table', 'salad table', 'mega top')) return 'Prep Table Refrigerator';
      if (has('undercounter', 'under counter', 'lowboy', 'low boy', 'low-boy')) return 'Undercounter Refrigerator';
      if (has('display case', 'merchandiser', 'deli case', 'glass door')) return 'Display Refrigerator';
      if (has('blast chiller', 'blast freez')) return 'Blast Chiller';
      if (has('freez', 'chest')) return 'Reach-In Freezer';
      if (has('wine', 'beer fridge', 'kegerator', 'keg cooler')) return 'Beverage Cooler';
      return 'Refrigerator';

    case 'cooking':
      if (has('fryer', 'fry station')) return 'Fryer';
      if (has('char broiler', 'charbroiler', 'char-broiler')) return 'Char Broiler';
      if (has('salamander')) return 'Salamander';
      if (has('combi oven', 'combi-oven')) return 'Combi Oven';
      if (has('convection oven', 'conv oven', 'conv. oven')) return 'Convection Oven';
      if (has('pizza oven', 'deck oven', 'hearth oven', 'wood-fired', 'wood fired')) return 'Pizza Oven';
      if (has('rotisserie')) return 'Rotisserie';
      if (has('smoker')) return 'Smoker';
      if (has('steam kettle', 'tilting kettle')) return 'Steam Kettle';
      if (has('steamer')) return 'Steamer';
      if (has('rice cook')) return 'Rice Cooker';
      if (has('wok')) return 'Wok Range';
      if (has('griddle', 'flat top', 'flat-top')) return 'Griddle';
      if (has('grill', 'broiler')) return 'Grill';
      if (has('range', 'cooktop', 'stove')) return 'Range';
      if (has('oven')) return 'Oven';
      if (has('warmer', 'heat lamp', 'holding cabinet', 'warming cabinet')) return 'Food Warmer';
      if (has('induction')) return 'Induction Cooker';
      if (has('microwave')) return 'Microwave';
      return 'Cooking Equipment';

    case 'ice':
      if (has('iced tea', 'tea machine', 'tea brewer')) return 'Iced Tea Machine';
      if (has('ice bin', 'ice well')) return 'Ice Bin';
      if (has('cuber', 'flaker', 'nugget')) return 'Ice Machine';
      return 'Ice Machine';

    case 'hvac':
      if (has('exhaust', 'hood', 'ventilation')) return 'Exhaust Hood';
      if (has('make-up air', 'makeup air', 'mua', 'm.u.a')) return 'Make-Up Air Unit';
      if (has('rooftop', 'rtu')) return 'Rooftop Unit';
      if (has('mini split', 'mini-split', 'ductless')) return 'Mini Split';
      if (has('evap cooler', 'evaporative cooler', 'swamp cooler')) return 'Evaporative Cooler';
      if (has('furnace', 'heater')) return 'Heater';
      if (has('a/c', 'a.c.', 'air condition', 'ac unit')) return 'Air Conditioner';
      if (has('thermostat')) return 'Thermostat';
      return 'HVAC';

    case 'dish':
      if (has('glass washer', 'glasswasher')) return 'Glass Washer';
      if (has('conveyor dish', 'flight type', 'conveyor washer')) return 'Conveyor Dishwasher';
      if (has('dish machine', 'dishwasher')) return 'Dish Machine';
      if (has('booster heater')) return 'Booster Heater';
      if (has('disposal', 'pulper', 'grinder')) return 'Disposal';
      if (has('3 comp', '3-comp', 'three compart', 'three-compart')) return '3 Compartment Sink';
      if (has('hand sink')) return 'Hand Sink';
      if (has('mop sink')) return 'Mop Sink';
      if (has('sink')) return 'Sink';
      return 'Dishwasher';

    case 'bev':
      if (has('espresso')) return 'Espresso Machine';
      if (has('grinder')) return 'Coffee Grinder';
      if (has('coffee', 'brewer', 'drip')) return 'Coffee Brewer';
      if (has('soda', 'fountain', 'bib', 'bag in box')) return 'Soda Fountain';
      if (has('beer tap', 'beer system', 'draft', 'kegerator', 'glycol')) return 'Beer System';
      if (has('wine fridge', 'wine cooler', 'wine cabinet')) return 'Wine Cooler';
      if (has('blender')) return 'Blender';
      if (has('juicer')) return 'Juicer';
      if (has('frozen drink', 'slush', 'margarita')) return 'Frozen Beverage Machine';
      return 'Beverage Equipment';

    case 'smallware':
      // ResQ doesn't typically track smallwares — but if you've added
      // them to NEXUS, classify generically
      return 'Smallware';

    case 'furniture':
      if (has('booth')) return 'Booth';
      if (has('chair', 'stool')) return 'Chair';
      if (has('table')) return 'Table';
      if (has('bench')) return 'Bench';
      if (has('umbrella')) return 'Umbrella';
      if (has('heater')) return 'Patio Heater';
      return 'Furniture';

    case 'other':
    default:
      // Last-resort: if the name has obvious cues, lean on them; otherwise
      // fall through to "Other" — ResQ accepts free text so the user can
      // rename post-import if needed.
      if (has('safe', 'cash drawer')) return 'Cash Equipment';
      if (has('pos', 'terminal', 'monitor', 'printer', 'kds')) return 'POS Equipment';
      if (has('security', 'camera', 'dvr', 'alarm')) return 'Security Equipment';
      if (has('water heater', 'tankless')) return 'Water Heater';
      if (has('grease trap', 'grease interceptor')) return 'Grease Trap';
      return 'Other';
  }
}

function exportToResQ() {
  // Source: the in-memory equipment array, filtered to active location +
  // not archived/retired/missing/relocated. Same data the user is currently
  // looking at, minus anything that's no longer in service.
  const loc = (typeof locationView !== 'undefined' && locationView && locationView.activeLocation) || null;
  const all = (typeof equipment !== 'undefined' && Array.isArray(equipment)) ? equipment : [];
  const SKIP_STATUSES = new Set(['retired', 'missing', 'relocated', 'loaned']);
  const rows = all.filter(eq =>
    !eq.archived &&
    !SKIP_STATUSES.has(String(eq.status || '').toLowerCase()) &&
    (!loc || eq.location === loc)
  );

  if (!rows.length) {
    NX.toast && NX.toast('No equipment to export', 'warn', 2400);
    return;
  }

  // CSV cell escape: RFC 4180 — wrap in quotes if value contains comma,
  // quote, or newline; double up internal quotes.
  const csv = (val) => {
    if (val == null) return '';
    const s = String(val);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  // Facility names in ResQ are uppercase. Their export showed "ESTE", so
  // upper-casing NEXUS's "Este" / "Suerte" / "Bar Toti" matches by default.
  // If the user's ResQ facility is named differently (e.g. "ESTE ATX"),
  // they'll need to find-and-replace in the CSV before upload.
  const mapFacility = (l) => (l || '').toUpperCase();

  // ResQ Status enum on their import is uppercase. We default everything
  // to ACTIVE — equipment marked "down" or "needs_service" in NEXUS is
  // still being tracked, still warrants service requests, so ACTIVE in
  // ResQ. The user can flip individual rows to DOWN post-import if they
  // want ResQ to surface them as unavailable.
  const mapStatus = (_) => 'ACTIVE';

  // ResQ's exact header order from their export
  const headers = [
    'Id',
    'Name',
    'Manufacturer',
    'Bar Code',
    'Facility Name',
    'Serial Number',
    'Model Number',
    'Equipment Category',
    'Status',
    'Cost of Asset',
    'Total Spend',
    'Last repair date',
  ];

  // v18.32 — track which rows fell through to the bucket-default
  // mapping (e.g. "Cooking Equipment" instead of a specific type).
  // These are the ones most likely to want manual review post-export.
  // Tags are used in the toast summary only — the CSV itself stays clean.
  const FALLBACK_TYPES = new Set([
    'Refrigerator', 'Cooking Equipment', 'Ice Machine', 'HVAC',
    'Dishwasher', 'Beverage Equipment', 'Smallware', 'Furniture', 'Other',
  ]);
  let confidentCount = 0;
  let fallbackCount = 0;

  const lines = [headers.join(',')];
  for (const eq of rows) {
    const resqType = mapToResQType(eq);
    if (FALLBACK_TYPES.has(resqType)) fallbackCount++; else confidentCount++;
    lines.push([
      csv(''),                              // Id — blank for new rows
      csv(eq.name),                         // Name
      csv(eq.manufacturer),                 // Manufacturer
      csv(eq.qr_code),                      // Bar Code
      csv(mapFacility(eq.location)),        // Facility Name
      csv(eq.serial_number),                // Serial Number
      csv(eq.model),                        // Model Number
      csv(resqType),                        // Equipment Category — mapped
      csv(mapStatus(eq.status)),            // Status
      csv(eq.purchase_price),               // Cost of Asset
      csv(''),                              // Total Spend — derived
      csv(''),                              // Last repair date — derived
    ].join(','));
  }

  // Excel/Sheets-friendly: UTF-8 BOM so accented characters in restaurant
  // names ("café", "piñata") render correctly in Windows Excel without
  // requiring the user to fiddle with encoding settings on import.
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (loc || 'all-locations').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.href = url;
  a.download = `nexus-resq-${slug}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  // Smarter toast — tells the user what got mapped confidently vs. what
  // fell through to a bucket default. Fallback rows are the ones to
  // skim before importing to ResQ.
  const msg = fallbackCount === 0
    ? `Exported ${rows.length} ${rows.length === 1 ? 'unit' : 'units'} — categories mapped to ResQ types`
    : `Exported ${rows.length} units — ${confidentCount} mapped confidently, ${fallbackCount} fell back to a generic type (review those rows before import)`;
  NX.toast && NX.toast(msg, 'success', 5500);
}

/* ─────────────────────────────────────────────────────────────────────
   TEMP — one-shot ResQ bulk-import export, matching the exact 8-column
   template ResQ provided (Facility, Equipment Name, Equipment Type,
   Manufacturer, Model Number, Serial Number, Warranty Expiration Date,
   Warranty Notes). Unlike exportToResQ() this pulls ALL equipment straight
   from Supabase (every location, not just the current view) and writes a
   real .xlsx via the already-loaded SheetJS. Delete this function, its
   window/NX exposure, and the #eqExportResQTemplate button once the ResQ
   migration is done.
   ───────────────────────────────────────────────────────────────────── */
async function exportResQTemplate() {
  if (!NX || !NX.sb) { NX.toast && NX.toast('Not connected to the database', 'error', 3000); return; }
  if (typeof XLSX === 'undefined') { NX.toast && NX.toast('Spreadsheet engine not loaded', 'error', 3000); return; }
  NX.toast && NX.toast('Building ResQ import…', 'info', 1500);

  // ALL equipment, every location. select('*') tolerates schema gaps.
  let data;
  try {
    const res = await NX.sb.from('equipment').select('*');
    if (res.error) throw res.error;
    data = res.data || [];
  } catch (e) {
    NX.toast && NX.toast('Load failed: ' + (e.message || e), 'error', 4000);
    return;
  }

  // Only live assets — drop archived + out-of-service so ResQ doesn't get junk.
  const SKIP = new Set(['retired', 'missing', 'relocated', 'loaned']);
  const rows = data.filter(e => !e.archived && !SKIP.has(String(e.status || '').toLowerCase()));
  if (!rows.length) { NX.toast && NX.toast('No active equipment to export', 'warn', 2500); return; }

  // Facility → clean Title Case so legacy "SUERTE"/"suerte" land identically.
  // (If ResQ's facility names differ, find/replace in the sheet before upload.)
  const facility = (l) => String(l || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  // Warranty date → YYYY-MM-DD when parseable, else the raw value.
  const wDate = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  };

  // Warranty Notes is the only free-text column, so fold general notes,
  // install date, and purchase price in there too — nothing is lost.
  const wNotes = (e) => [
    e.notes,
    e.warranty_claim ? `Warranty claim: ${e.warranty_claim}` : '',
    e.install_date ? `Installed ${wDate(e.install_date)}` : '',
    (e.purchase_price != null && e.purchase_price !== '') ? `Purchase $${e.purchase_price}` : '',
  ].filter(Boolean).join(' · ');

  const headers = ['Facility', 'Equipment Name', 'Equipment Type', 'Manufacturer',
                   'Model Number', 'Serial Number', 'Warranty Expiration Date', 'Warranty Notes'];

  const sorted = rows.slice().sort((a, b) =>
    facility(a.location).localeCompare(facility(b.location)) ||
    String(a.name || '').localeCompare(String(b.name || '')));

  const aoa = [headers];
  for (const e of sorted) {
    aoa.push([
      facility(e.location),
      e.name || '',
      mapToResQType(e),
      e.manufacturer || '',
      e.model || '',
      e.serial_number || '',
      wDate(e.warranty_until),
      wNotes(e),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 44 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `nexus-resq-import-${new Date().toISOString().slice(0, 10)}.xlsx`);

  const filled = rows.filter(e => e.manufacturer || e.model || e.serial_number).length;
  NX.toast && NX.toast(`ResQ import built — ${rows.length} units (${filled} with make/model/serial)`, 'success', 5000);
}
// TEMP exposure so it can be triggered from anywhere (console or button).
if (typeof window !== 'undefined') window.exportResQTemplate = exportResQTemplate;
try { if (NX) NX.exportResQTemplate = exportResQTemplate; } catch (_) {}

/* ─── Zebra ZPL generation ─── */

function generateZPL(eq, size = '2x2') {
  const cfg = ZEBRA_CONFIG.labelSizes[size];
  if (!cfg) throw new Error('Invalid label size: ' + size);

  const scanURL = `${window.location.origin}${window.location.pathname}?equip=${eq.qr_code}`;
  const name = (eq.name || '').replace(/[\^~]/g, '').slice(0, 30);
  const location = (eq.location || '').replace(/[\^~]/g, '');
  const model = `${eq.manufacturer || ''} ${eq.model || ''}`.trim().replace(/[\^~]/g, '').slice(0, 28);

  let zpl = '';
  if (size === '2x2') {
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO20,30^BQN,2,5^FDQA,${scanURL}^FS
^FO200,40^A0N,28,28^FD${name}^FS
^FO200,80^A0N,22,22^FD${location}^FS
^FO200,130^A0N,18,18^FD${model}^FS
^FO200,170^A0N,14,14^FDScan for details^FS
^FO200,200^A0N,14,14^FD${eq.qr_code}^FS
^PQ1,0,1,Y
^XZ`;
  } else if (size === '2x1') {
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO15,20^BQN,2,3^FDQA,${scanURL}^FS
^FO120,25^A0N,22,22^FD${name}^FS
^FO120,55^A0N,16,16^FD${location}^FS
^FO120,80^A0N,14,14^FD${model}^FS
^FO120,105^A0N,12,12^FD${eq.qr_code}^FS
^PQ1,0,1,Y
^XZ`;
  } else if (size === '3x2' || size === '4x2') {
    zpl = `^XA
^PW${cfg.widthDots}
^LL${cfg.heightDots}
^LH0,0
^FO20,40^BQN,2,6^FDQA,${scanURL}^FS
^FO230,40^A0N,32,32^FD${name}^FS
^FO230,85^A0N,24,24^FD${location}^FS
^FO230,130^A0N,20,20^FD${model}^FS
^FO230,170^A0N,16,16^FDSN: ${(eq.serial_number || '—').slice(0, 20)}^FS
^FO230,210^A0N,16,16^FDNEXUS: ${eq.qr_code}^FS
^FO230,250^A0N,14,14^FDScan for full details^FS
^PQ1,0,1,Y
^XZ`;
  }
  return zpl.replace(/\n\s*/g, '\n').trim();
}

function generateZPLBatch(equipmentList, size = '2x2') {
  return equipmentList.map(eq => generateZPL(eq, size)).join('\n');
}

async function loadZebraBrowserPrint() {
  if (zebraBrowserPrintLoaded) return true;
  try {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/gh/gtomasevic/browser-print-js@master/BrowserPrint-3.0.216.min.js';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
    zebraBrowserPrintLoaded = true;
    return true;
  } catch (e) { return false; }
}

async function printZebraBrowserPrint(zpl) {
  try {
    const devRes = await fetch(ZEBRA_BP_URL + '/default?type=printer');
    if (!devRes.ok) throw new Error('Browser Print not running');
    const device = await devRes.json();

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
        <button class="eq-close" onclick="document.getElementById('zebraPrintModal').classList.remove('active')">${uiSvg("close", "16px")}</button>
        <h2>Print Zebra Labels (${count})</h2>
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
            <button class="eq-btn eq-btn-primary" id="zebraPrintBtn">Print ${count} Label${count > 1 ? 's' : ''}</button>
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
            <button class="eq-btn eq-btn-primary" id="zebraDownloadBtn">${uiSvg("arrowDown", "14px")} Download ZPL File</button>
            <button class="eq-btn eq-btn-secondary" id="zebraCopyBtn">Copy ZPL</button>
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

  checkZebraPrinter();

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
      btn.textContent = `Print ${count} Label${count > 1 ? 's' : ''}`;
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
        el.innerHTML = `<span class="eq-zebra-ok">${uiSvg("check","13px")} ${data.printer.length} printer${data.printer.length>1?'s':''} connected: ${data.printer.map(p=>p.name).join(', ')}</span>`;
      } else {
        el.innerHTML = `<span class="eq-zebra-warn">${uiSvg('alert','13px')} Browser Print running but no printer connected. Plug in your Zebra via USB.</span>`;
      }
    } else throw new Error('Not running');
  } catch (e) {
    el.innerHTML = `<span class="eq-zebra-err">${uiSvg('close','13px')} Zebra Browser Print not running. <a href="https://www.zebra.com/us/en/software/printer-software/browser-print.html" target="_blank">Install it</a> then refresh.</span>`;
  }
}

function renderZebraPreview(eq, size) {
  const el = document.getElementById('zebraPreview');
  if (!el || !eq) return;
  const zpl = generateZPL(eq, size);
  const cfg = ZEBRA_CONFIG.labelSizes[size];
  const apiURL = `https://api.labelary.com/v1/printers/8dpmm/labels/${cfg.width}x${cfg.height}/0/`;

  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Rendering…</div>';

  fetch(apiURL, { method: 'POST', headers: { 'Accept': 'image/png' }, body: zpl })
    .then(r => { if (!r.ok) throw new Error('Preview API error'); return r.blob(); })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      el.innerHTML = `
        <div class="eq-zebra-preview-img-wrap">
          <img src="${url}" class="eq-zebra-preview-img" alt="Label preview">
          <div class="eq-zebra-preview-cap">${size}" label · ${eq.name}</div>
        </div>`;
    })
    .catch(() => {
      el.innerHTML = '<div class="eq-zebra-err">Preview unavailable. The ZPL is still valid and will print correctly.</div>';
    });
}

function printZebraBatch() {
  const filtered = getFiltered();
  if (!filtered.length) {
    NX.toast && NX.toast('No equipment to print', 'info');
    return;
  }
  openZebraPrintDialog(filtered);
}

function printZebraSingle(equipId) {
  const eq = equipment.find(e => e.id === equipId);
  if (!eq) return;
  openZebraPrintDialog([eq]);
}

/* Prefer Zebra if Browser Print available, else fall back to paper sticker */
function quickPrint(equipId) {
  printZebraSingle(equipId);
}


/* ════════════════════════════════════════════════════════════════════════════
   8. PUBLIC SCAN — no-auth QR view
   ════════════════════════════════════════════════════════════════════════════ */

// (renderPublicScanView / loadPublicScan / renderPublicScanHTML lived here —
//  the legacy in-module public-scan renderer, ~380 lines with ZERO callers
//  since the standalone js/equipment-public-scan.js page replaced it.
//  Removed in the equipment consolidation. publicReportIssue below survives
//  as a fallback used by equipment-public-pm.js.)

function publicReportIssue(qrCode) {
  const modal = document.createElement('div');
  modal.className = 'public-report-modal';
  modal.innerHTML = `
    <div class="public-report-bg" onclick="this.parentElement.remove()"></div>
    <div class="public-report">
      <button class="public-report-close" onclick="this.parentElement.parentElement.remove()">${uiSvg("close", "13px")}</button>
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
    const { data: eq } = await NX.sb.from('equipment').select('id, name, location').eq('qr_code', qrCode).single();
    if (!eq) return;

    try {
      await NX.work.create({
        title: `[Equipment] ${eq.name}: ${fd.get('description').slice(0, 60)}`,
        notes: `Reported via QR scan by ${fd.get('reporter')}\n\nEquipment: ${eq.name}\nLocation: ${eq.location}\n\nIssue: ${fd.get('description')}`,
        priority: fd.get('priority'),
        location: eq.location,
        equipmentId: eq.id,
        reportedBy: fd.get('reporter') + ' (QR scan)',
      });
      await NX.sb.from('daily_logs').insert({
        entry: `[SCAN-REPORT] ${eq.name} at ${eq.location}: ${fd.get('description').slice(0, 120)}`,
        user_name: fd.get('reporter')
      });
      modal.innerHTML = `
        <div class="public-report-bg" onclick="this.parentElement.remove()"></div>
        <div class="public-report public-report-success">
          <div style="margin-bottom:12px;color:var(--nx-gold)">${uiSvg("check","48px")}</div>
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


/* ════════════════════════════════════════════════════════════════════════════
   9. ATTACHMENTS & FULL EDITOR — 6-tab editor, custom fields, photo mgmt
   ════════════════════════════════════════════════════════════════════════════ */

async function openFullEditor(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq) return;

  const [attachRes, customRes] = await Promise.all([
    NX.sb.from('equipment_attachments').select('*').eq('equipment_id', equipId).order('created_at', { ascending: false }),
    NX.sb.from('equipment_custom_fields').select('*').eq('equipment_id', equipId).order('created_at')
  ]);
  const attachments = attachRes.data || [];
  const customFields = customRes.data || [];

  const modal = document.getElementById('eqFullEditModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqFullEditModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const specs = eq.specs || {};
  const tags = eq.tags || [];

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="NX.modules.equipment.closeFullEdit()"></div>
    <div class="eq-detail eq-edit-full">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="NX.modules.equipment.closeFullEdit()">${uiSvg("close", "16px")}</button>
        <h2>${uiSvg("pen","16px")} Edit Everything — ${esc(eq.name)}</h2>
      </div>

      <div class="eq-detail-tabs">
        <button class="eq-tab active" data-tab="basic">Basic</button>
        <button class="eq-tab" data-tab="specs">Specs</button>
        <button class="eq-tab" data-tab="photo">Photos</button>
        <button class="eq-tab" data-tab="attach">Attachments (${attachments.length})</button>
        <button class="eq-tab" data-tab="links">Links</button>
        <button class="eq-tab" data-tab="custom">Custom Fields (${customFields.length})</button>
      </div>

      <div class="eq-detail-body">

        <div class="eq-tab-panel active" data-panel="basic">
          <div class="eq-form">
            <div class="eq-form-group">
              <label>Name</label>
              <input data-field="name" value="${escAttr(eq.name)}">
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Location</label>
                <select data-field="location">
                  ${LOCATIONS.map(l => `<option ${eq.location===l?'selected':''}>${l}</option>`).join('')}
                </select>
              </div>
              <div class="eq-form-group">
                <label>Area</label>
                <input data-field="area" value="${escAttr(eq.area||'')}">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Category</label>
                <select data-field="category">
                  ${CATEGORIES.map(c => `<option value="${c.key}" ${eq.category===c.key?'selected':''}>${c.key}</option>`).join('')}
                </select>
              </div>
              <div class="eq-form-group">
                <label>Subcategory</label>
                <input data-field="subcategory" value="${escAttr(eq.subcategory||'')}" placeholder="walk_in, fryer, range, etc">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Status</label>
                <select data-field="status">
                  ${DROPDOWN_STATUSES.map(s => `<option value="${s.key}" ${eq.status===s.key?'selected':''}>${s.label}</option>`).join('')}
                </select>
              </div>
              <div class="eq-form-group">
                <label>Health Score (0-100)</label>
                <input type="number" min="0" max="100" data-field="health_score" value="${eq.health_score ?? 100}">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Manufacturer</label>
                <input data-field="manufacturer" value="${escAttr(eq.manufacturer||'')}">
              </div>
              <div class="eq-form-group">
                <label>Model</label>
                <input data-field="model" value="${escAttr(eq.model||'')}">
              </div>
            </div>
            <div class="eq-form-group">
              <label>Serial Number</label>
              <input data-field="serial_number" value="${escAttr(eq.serial_number||'')}">
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Install Date</label>
                <input type="date" data-field="install_date" value="${eq.install_date||''}">
              </div>
              <div class="eq-form-group">
                <label>Warranty Until</label>
                <input type="date" data-field="warranty_until" value="${eq.warranty_until||''}">
              </div>
            </div>
            <div class="eq-form-row">
              <div class="eq-form-group">
                <label>Purchase Price ($)</label>
                <input type="number" step="0.01" data-field="purchase_price" value="${eq.purchase_price||''}">
              </div>
              <div class="eq-form-group">
                <label>PM Interval (days)</label>
                <input type="number" data-field="pm_interval_days" value="${eq.pm_interval_days||''}">
              </div>
            </div>
            <div class="eq-form-group">
              <label>Next PM Date</label>
              <input type="date" data-field="next_pm_date" value="${eq.next_pm_date||''}">
            </div>
            <div class="eq-form-group">
              <label>Tags (comma-separated)</label>
              <input data-field="_tags" value="${escAttr((tags||[]).join(', '))}" placeholder="critical, backup, rental, etc">
            </div>
            <div class="eq-form-group">
              <label>Notes</label>
              <textarea data-field="notes" rows="4">${esc(eq.notes||'')}</textarea>
            </div>
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="specs">
          <div class="eq-specs-help">
            Structured specs. Common: voltage, amperage, hz, phase, refrigerant_type, refrigerant_amount, btu, capacity, wattage, gas_type.
          </div>
          <div class="eq-specs-list" id="eqSpecsList">
            ${Object.entries(specs).map(([k, v]) => `
              <div class="eq-spec-row" data-spec="${escAttr(k)}">
                <input class="eq-spec-key" value="${escAttr(k)}">
                <input class="eq-spec-val" value="${escAttr(String(v||''))}">
                <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="this.parentElement.remove()">${uiSvg("close", "13px")}</button>
              </div>
            `).join('')}
          </div>
          <button class="eq-btn eq-btn-secondary" id="eqAddSpec">+ Add Spec</button>
        </div>

        <div class="eq-tab-panel" data-panel="photo">
          <div class="eq-photo-section">
            <h4>Main Photo</h4>
            ${eq.photo_url ? `
              <div class="eq-photo-wrap">
                <img src="${eq.photo_url}" class="eq-photo-main">
                <div class="eq-photo-actions">
                  <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.replacePhoto('${equipId}', 'photo_url')">Replace</button>
                  <button class="eq-btn eq-btn-danger" onclick="NX.modules.equipment.removePhoto('${equipId}', 'photo_url')">Remove</button>
                </div>
              </div>
            ` : `
              <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadPhoto('${equipId}', 'photo_url')">${uiSvg("camera", "13px")} Upload Photo</button>
            `}
          </div>
          <div class="eq-photo-section">
            <h4>Data Plate Photo</h4>
            ${eq.data_plate_url ? `
              <div class="eq-photo-wrap">
                <img src="${eq.data_plate_url}" class="eq-photo-main">
                <div class="eq-photo-actions">
                  <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.replacePhoto('${equipId}', 'data_plate_url')">Replace</button>
                  <button class="eq-btn eq-btn-danger" onclick="NX.modules.equipment.removePhoto('${equipId}', 'data_plate_url')">Remove</button>
                </div>
              </div>
            ` : `
              <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.uploadPhoto('${equipId}', 'data_plate_url')">${uiSvg("camera","13px")} Upload Data Plate</button>
            `}
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="attach">
          <div class="eq-attach-actions">
            <button class="eq-btn eq-btn-primary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'file')">${uiSvg("document","13px")} Upload File</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'photo')">${uiSvg("camera","13px")} Add Photo</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'link')">${uiSvg("link", "13px")} Add Link</button>
            <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.addAttachment('${equipId}', 'note')">${uiSvg("note","13px")} Add Note</button>
          </div>
          <div class="eq-attach-list" id="eqAttachList">
            ${attachments.length ? attachments.map(a => renderAttachment(a)).join('') : '<div class="eq-empty-small">No attachments yet. Upload receipts, invoices, warranty cards, installation docs, videos, or anything else.</div>'}
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="links">
          <div class="eq-specs-help">
            External links — manufacturer website, manual URL, training video, etc. Clickable from the equipment detail.
          </div>
          
          <div class="eq-form-group eq-service-contact" style="margin-bottom:14px;padding:14px;background:var(--elevated);border:1px solid var(--border);border-radius:10px">
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              ${uiSvg('phone', '14px')} Maintenance Contractor
              <span style="font-weight:400;font-size:11px;color:var(--muted)">— scheduled PMs / preventive work</span>
            </label>
            <div class="eq-form-row">
              <div class="eq-form-group" style="flex:1">
                <label style="font-size:11px">Contact Name <span style="color:var(--muted)">— pick existing to auto-link</span></label>
                <input data-field="service_contractor_name" id="eqServiceContactName-${eq.id}" value="${escAttr(eq.service_contractor_name||'')}" placeholder="Austin Air and Ice" list="eqContractorOptions-${eq.id}" autocomplete="off">
                <datalist id="eqContractorOptions-${eq.id}"></datalist>
                <input type="hidden" data-field="service_vendor_id" value="${escAttr(eq.service_vendor_id||'')}">
                <div id="eqContractorLinkChip-${eq.id}" class="eq-contractor-link-chip" style="display:none">
                  <span class="eq-contractor-link-chip-icon">🔗</span>
                  <span class="eq-contractor-link-chip-text"></span>
                  <button type="button" class="eq-contractor-link-chip-unlink" title="Unlink (keep name as plain text)">×</button>
                </div>
              </div>
              <div class="eq-form-group" style="flex:1">
                <label style="font-size:11px">Phone Number</label>
                <input type="tel" data-field="service_contractor_phone" id="eqServicePhone-${eq.id}" value="${escAttr(eq.service_contractor_phone||'')}" placeholder="(512) 555-1234">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="eq-btn eq-btn-tiny eq-btn-secondary" onclick="NX.modules.equipment.lookupServicePhoneFromNode('${eq.id}')" style="flex:1">
                ${uiSvg('search', '13px')} Look up phone from contractor
              </button>
              ${eq.service_contractor_phone ? `<a href="tel:${escAttr(eq.service_contractor_phone)}" class="eq-btn eq-btn-tiny" style="flex:0 0 auto">Test Call</a>` : ''}
              ${(eq.service_vendor_id || eq.service_contractor_name || eq.service_contractor_phone) ? `<button type="button" class="eq-btn eq-btn-tiny eq-btn-danger" id="eqServiceClear-${eq.id}" style="flex:0 0 auto">Unassign</button>` : ''}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.4">
              The maintenance contractor handles scheduled PMs. Type a name to link an existing contractor, or leave as plain text.
            </div>
          </div>

          <div class="eq-form-group eq-repair-contact" style="margin-bottom:18px;padding:14px;background:var(--elevated);border:1px solid var(--border);border-radius:10px">
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              ${uiSvg('warning', '14px')} Repair Contractor
              <span style="font-weight:400;font-size:11px;color:var(--muted)">— powers the "Call" button on QR scan</span>
            </label>
            <div class="eq-form-row">
              <div class="eq-form-group" style="flex:1">
                <label style="font-size:11px">Contact Name <span style="color:var(--muted)">— pick existing to auto-link</span></label>
                <input data-field="repair_contractor_name" id="eqRepairContactName-${eq.id}" value="${escAttr(eq.repair_contractor_name||'')}" placeholder="A1 Refrigeration Repair" list="eqRepairContractorOptions-${eq.id}" autocomplete="off">
                <datalist id="eqRepairContractorOptions-${eq.id}"></datalist>
                <input type="hidden" data-field="repair_vendor_id" value="${escAttr(eq.repair_vendor_id||'')}">
                <div id="eqRepairContractorLinkChip-${eq.id}" class="eq-contractor-link-chip" style="display:none">
                  <span class="eq-contractor-link-chip-icon">🔗</span>
                  <span class="eq-contractor-link-chip-text"></span>
                  <button type="button" class="eq-contractor-link-chip-unlink" title="Unlink (keep name as plain text)">×</button>
                </div>
              </div>
              <div class="eq-form-group" style="flex:1">
                <label style="font-size:11px">Phone Number</label>
                <input type="tel" data-field="repair_contractor_phone" id="eqRepairPhone-${eq.id}" value="${escAttr(eq.repair_contractor_phone||'')}" placeholder="(512) 555-1234">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              ${eq.repair_contractor_phone ? `<a href="tel:${escAttr(eq.repair_contractor_phone)}" class="eq-btn eq-btn-tiny" style="flex:0 0 auto">Test Call</a>` : ''}
              ${(eq.repair_vendor_id || eq.repair_contractor_name || eq.repair_contractor_phone) ? `<button type="button" class="eq-btn eq-btn-tiny eq-btn-danger" id="eqRepairClear-${eq.id}" style="flex:0 0 auto">Unassign</button>` : ''}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.4">
              The repair contractor is who you call when something breaks. <strong>Public QR codes default to this contact.</strong> Can be the same as maintenance — or a different specialist.
            </div>
          </div>

          <div class="eq-form-group">
            <label>Manual Source URL</label>
            <div class="eq-url-field">
              <input type="url" data-field="manual_source_url" value="${escAttr(eq.manual_source_url||'')}" placeholder="https://www.hoshizakiamerica.com/...">
              ${eq.manual_source_url ? `<a href="${eq.manual_source_url}" target="_blank" class="eq-btn eq-btn-tiny">Open ↗</a>` : ''}
            </div>
          </div>
          <div class="eq-form-group">
            <label>Manual PDF URL (uploaded)</label>
            <div class="eq-url-field">
              <input type="url" data-field="manual_url" value="${escAttr(eq.manual_url||'')}">
              ${eq.manual_url ? `<a href="${eq.manual_url}" target="_blank" class="eq-btn eq-btn-tiny">Open ↗</a>` : ''}
            </div>
          </div>
        </div>

        <div class="eq-tab-panel" data-panel="custom">
          <div class="eq-specs-help">
            Add any custom fields you need. Perfect for: rental contract #, asset tag #, last inspection ID, accounting code, anything specific to your operation.
          </div>
          <div class="eq-custom-list" id="eqCustomList">
            ${customFields.map(f => `
              <div class="eq-custom-row" data-custom-id="${f.id}">
                <input class="eq-custom-name" value="${escAttr(f.field_name)}" placeholder="Field name">
                <select class="eq-custom-type">
                  <option value="text" ${f.field_type==='text'?'selected':''}>Text</option>
                  <option value="number" ${f.field_type==='number'?'selected':''}>Number</option>
                  <option value="date" ${f.field_type==='date'?'selected':''}>Date</option>
                  <option value="url" ${f.field_type==='url'?'selected':''}>URL</option>
                  <option value="boolean" ${f.field_type==='boolean'?'selected':''}>Yes/No</option>
                </select>
                <input class="eq-custom-val" value="${escAttr(f.field_value||'')}" placeholder="Value">
                <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="NX.modules.equipment.deleteCustomField('${f.id}', '${equipId}')">${uiSvg("close", "13px")}</button>
              </div>
            `).join('')}
          </div>
          <button class="eq-btn eq-btn-secondary" id="eqAddCustom">+ Add Custom Field</button>
        </div>

      </div>

      <div class="eq-detail-actions">
        ${(eq.archived_at || eq.archived) ? `
          <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.restoreEquipment('${equipId}'); NX.modules.equipment.closeFullEdit();" style="color:#3a7;border-color:#3a7">${uiSvg("check","14px")} Restore from log</button>
        ` : `
          <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeFullEdit(); NX.modules.equipment.archiveEquipment('${equipId}');" style="color:#c44;border-color:#c44">${uiSvg("trash","14px")} Archive</button>
        `}
        <span style="flex:1"></span>
        <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.closeFullEdit()">Cancel</button>
        <button class="eq-btn eq-btn-primary" id="eqFullSave">${uiSvg("check", "14px")} Save All Changes</button>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Wire the Service Contact typeahead pickers — one for the maintenance
  // contractor (legacy service_*) and one for the repair contractor.
  // Both pull all contractor nodes, populate their datalists, and on
  // selection auto-fill phone + set the hidden FK field. Without this
  // wiring, the equipment side and contractor side stay disconnected
  // and the user has to type the same name in two places.
  (async () => {
    let contractorCache = [];
    try {
      // Vendor consolidation: the equipment contractor pickers now pull from
      // the vendors table (single source of truth), not legacy brain nodes.
      // select('*') + client-side active filter is the bulletproof pattern.
      const { data } = await NX.sb.from('vendors').select('*').order('company', { ascending: true });
      contractorCache = (data || [])
        .filter(v => v.active !== false)
        .map(v => ({ id: v.id, name: v.company || v.name || 'Unnamed vendor', phone: v.phone || '' }));
    } catch (err) {
      console.warn('[full-editor] vendor lookup failed:', err);
    }

    // Reusable wirer — works for both maintenance ("") and repair ("Repair") slots.
    const wireTypeahead = ({ datalistId, nameInputId, phoneInputId, fkSel, chipId, clearBtnId, fieldNamePrefix }) => {
      const dl    = modal.querySelector(`#${datalistId}`);
      const nameI = modal.querySelector(`#${nameInputId}`);
      const phoneI = modal.querySelector(`#${phoneInputId}`);
      const fkI   = modal.querySelector(fkSel);
      const chip  = modal.querySelector(`#${chipId}`);
      const chipText  = chip?.querySelector('.eq-contractor-link-chip-text');
      const unlinkBtn = chip?.querySelector('.eq-contractor-link-chip-unlink');
      const clearBtn  = clearBtnId ? modal.querySelector(`#${clearBtnId}`) : null;
      if (!dl || !nameI) return;

      // Populate datalist for native typeahead.
      dl.innerHTML = contractorCache.map(c =>
        `<option value="${escAttr(c.name)}"></option>`
      ).join('');

      // Show "linked" chip if equipment already has FK set.
      const refreshChip = () => {
        if (!chip) return;
        if (fkI && fkI.value && contractorCache.length) {
          const linked = contractorCache.find(c => c.id === fkI.value);
          if (linked) {
            chip.style.display = 'inline-flex';
            chipText.textContent = `Linked to ${linked.name}`;
            return;
          }
        }
        chip.style.display = 'none';
      };
      refreshChip();

      // When user types or picks, try to match name to a contractor.
      // If exact match (case-insensitive) → set FK + auto-fill phone if blank.
      // If no match → clear FK (leaves it as a free-text name).
      nameI.addEventListener('input', () => {
        const typed = (nameI.value || '').trim().toLowerCase();
        const match = contractorCache.find(c => (c.name || '').toLowerCase() === typed);
        if (match) {
          fkI.value = match.id;
          // Auto-fill phone if equipment doesn't have one yet.
          if (phoneI && !phoneI.value) {
            const cphone = match.phone || '';
            if (cphone) phoneI.value = cphone;
          }
          refreshChip();
        } else {
          if (fkI.value) {
            fkI.value = '';
            refreshChip();
          }
        }
      });

      // Unlink button: keep the typed name, but drop the FK.
      unlinkBtn?.addEventListener('click', () => {
        fkI.value = '';
        refreshChip();
        NX.toast && NX.toast('Unlinked — name kept as plain text', 'info', 1400);
      });

      // Unassign button: blow away name, phone, AND FK in one tap.
      // The values are flushed to DB on Save All Changes.
      clearBtn?.addEventListener('click', () => {
        if (!confirm(`Unassign the ${fieldNamePrefix} contractor from this equipment?`)) return;
        if (fkI)    fkI.value = '';
        if (nameI)  nameI.value = '';
        if (phoneI) phoneI.value = '';
        refreshChip();
        clearBtn.style.display = 'none';
        NX.toast && NX.toast(`${fieldNamePrefix} contractor cleared — tap Save All Changes to persist`, 'info', 2400);
      });
    };

    // Maintenance slot (legacy service_contractor_*).
    wireTypeahead({
      datalistId:    `eqContractorOptions-${eq.id}`,
      nameInputId:   `eqServiceContactName-${eq.id}`,
      phoneInputId:  `eqServicePhone-${eq.id}`,
      fkSel:         'input[data-field="service_vendor_id"]',
      chipId:        `eqContractorLinkChip-${eq.id}`,
      clearBtnId:    `eqServiceClear-${eq.id}`,
      fieldNamePrefix: 'maintenance',
    });
    // Repair slot (new repair_contractor_*).
    wireTypeahead({
      datalistId:    `eqRepairContractorOptions-${eq.id}`,
      nameInputId:   `eqRepairContactName-${eq.id}`,
      phoneInputId:  `eqRepairPhone-${eq.id}`,
      fkSel:         'input[data-field="repair_vendor_id"]',
      chipId:        `eqRepairContractorLinkChip-${eq.id}`,
      clearBtnId:    `eqRepairClear-${eq.id}`,
      fieldNamePrefix: 'repair',
    });
  })();
  modal.querySelectorAll('.eq-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.eq-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // Add spec / custom rows
  document.getElementById('eqAddSpec').addEventListener('click', () => {
    const list = document.getElementById('eqSpecsList');
    const row = document.createElement('div');
    row.className = 'eq-spec-row';
    row.innerHTML = `
      <input class="eq-spec-key" placeholder="key (e.g. voltage)">
      <input class="eq-spec-val" placeholder="value (e.g. 115V)">
      <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="this.parentElement.remove()">${uiSvg("close", "13px")}</button>
    `;
    list.appendChild(row);
    row.querySelector('.eq-spec-key').focus();
  });

  document.getElementById('eqAddCustom').addEventListener('click', () => {
    const list = document.getElementById('eqCustomList');
    const row = document.createElement('div');
    row.className = 'eq-custom-row';
    row.innerHTML = `
      <input class="eq-custom-name" placeholder="Field name">
      <select class="eq-custom-type">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="date">Date</option>
        <option value="url">URL</option>
        <option value="boolean">Yes/No</option>
      </select>
      <input class="eq-custom-val" placeholder="Value">
      <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="this.parentElement.remove()">${uiSvg("close", "13px")}</button>
    `;
    list.appendChild(row);
    row.querySelector('.eq-custom-name').focus();
  });

  document.getElementById('eqFullSave').addEventListener('click', async () => {
    const btn = document.getElementById('eqFullSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const updates = {};
      modal.querySelectorAll('[data-field]').forEach(el => {
        const field = el.dataset.field;
        let val = el.value;
        if (val === '') val = null;
        if (field === '_tags') {
          updates.tags = val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
          return;
        }
        if (['purchase_price', 'pm_interval_days', 'health_score'].includes(field) && val != null) {
          val = parseFloat(val);
          if (isNaN(val)) val = null;
        }
        updates[field] = val;
      });

      const newSpecs = {};
      modal.querySelectorAll('#eqSpecsList .eq-spec-row').forEach(row => {
        const k = row.querySelector('.eq-spec-key').value.trim();
        const v = row.querySelector('.eq-spec-val').value.trim();
        if (k) newSpecs[k] = v;
      });
      updates.specs = newSpecs;

      // Save with graceful column-missing fallback. If a column the form
      // writes doesn't exist yet (migration not run — e.g. repair_vendor_id,
      // service_vendor_id, repair_contractor_*), Postgres hard-fails the whole
      // UPDATE. Strip the offending column and retry so the rest still saves,
      // and toast a warning so the user knows to run the SQL migration.
      let saveErr;
      {
        let attempt = { ...updates };
        let r = await NX.sb.from('equipment').update(attempt).eq('id', equipId);
        let guard = 0;
        while (r.error && guard < 6) {
          const m = /column "?([a-z_]+)"?.*does not exist/i.exec(r.error.message || '');
          if (!m || !(m[1] in attempt)) break;
          delete attempt[m[1]];
          NX.toast && NX.toast(`Saved without ${m[1]} — run the SQL migration to store it`, 'warn', 4000);
          r = await NX.sb.from('equipment').update(attempt).eq('id', equipId);
          guard++;
        }
        saveErr = r.error;
      }
      if (saveErr) throw saveErr;

      const customOps = [];
      modal.querySelectorAll('#eqCustomList .eq-custom-row').forEach(row => {
        const name = row.querySelector('.eq-custom-name').value.trim();
        const val  = row.querySelector('.eq-custom-val').value.trim();
        const type = row.querySelector('.eq-custom-type').value;
        const existingId = row.dataset.customId;
        if (!name) return;
        if (existingId) {
          customOps.push(NX.sb.from('equipment_custom_fields').update({
            field_name: name, field_value: val, field_type: type
          }).eq('id', existingId));
        } else {
          customOps.push(NX.sb.from('equipment_custom_fields').insert({
            equipment_id: equipId, field_name: name, field_value: val, field_type: type
          }));
        }
      });
      await Promise.all(customOps);

      NX.toast && NX.toast('All changes saved ✓', 'success');
      // equipment_edited syslog → covered by Postgres trigger on equipment UPDATE
      closeFullEdit();
      await loadEquipment();
      openDetail(equipId);
    } catch (err) {
      console.error('[FullEdit] Save failed:', err);
      NX.toast && NX.toast('Save failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = uiSvg('check','13px') + ' Save All Changes';
    }
  });
}

function closeFullEdit() {
  const m = document.getElementById('eqFullEditModal');
  if (m) m.classList.remove('active');
}

/* ─── Attachments ─── */

function renderAttachment(a) {
  const isImage = (a.mime_type || '').startsWith('image/');
  const url = a.file_url || a.external_url;

  return `
    <div class="eq-attach-item" data-id="${a.id}">
      <div class="eq-attach-icon">${attachmentIcon(a)}</div>
      <div class="eq-attach-info">
        <div class="eq-attach-title-row">
          <input class="eq-attach-title" value="${escAttr(a.title)}" data-attach-id="${a.id}" data-attach-field="title">
          <select class="eq-attach-type" data-attach-id="${a.id}" data-attach-field="type">
            ${['file','photo','receipt','invoice','warranty','manual','link','note'].map(t =>
              `<option value="${t}" ${a.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        ${a.description ? `<div class="eq-attach-desc">${esc(a.description)}</div>` : ''}
        ${isImage && url ? `<img src="${url}" class="eq-attach-preview">` : ''}
        <div class="eq-attach-meta">
          ${url ? `<a href="${url}" target="_blank" class="eq-attach-link">↗ Open</a>` : ''}
          ${a.file_size ? ` · ${formatBytes(a.file_size)}` : ''}
          · ${new Date(a.created_at).toLocaleDateString()}
          ${a.uploaded_by ? ` · ${esc(a.uploaded_by)}` : ''}
        </div>
      </div>
      <div class="eq-attach-actions">
        <button class="eq-btn eq-btn-tiny" onclick="NX.modules.equipment.editAttachmentDesc('${a.id}')">${uiSvg("pen", "13px")}</button>
        <button class="eq-btn eq-btn-tiny eq-btn-danger" onclick="NX.modules.equipment.deleteAttachment('${a.id}')">${uiSvg("close", "13px")}</button>
      </div>
    </div>
  `;
}

async function addAttachment(equipId, type, returnTo) {
  // returnTo: 'detail' reloads the equipment detail view after adding
  //           'fullEditor' (default) reloads the full 6-tab editor
  // Overview-tab buttons pass 'detail' so users stay where they are.
  const reopen = () => {
    if (returnTo === 'detail') openDetail(equipId);
    else openFullEditor(equipId);
  };

  if (type === 'link') {
    if (NX.composer?.modal) {
      NX.composer.modal({
        title: 'Add a link',
        subtitle: 'External resource for this equipment',
        buttonLabel: 'Add link',
        fields: [
          { name: 'title', label: 'Link title', placeholder: 'e.g. Manufacturer manual', autofocus: true },
          { name: 'url',   label: 'URL', placeholder: 'https://…' },
        ],
        onSubmit: async ({ title, url }) => {
          if (!title || !url) {
            NX.toast && NX.toast('Both title and URL are required', 'warn');
            throw new Error('missing fields');
          }
          await NX.sb.from('equipment_attachments').insert({
            equipment_id: equipId, type: 'link',
            title: title.slice(0, 200), external_url: url,
            uploaded_by: NX.currentUser?.name || 'user'
          });
          NX.toast && NX.toast('Link added ✓', 'success');
          reopen();
        },
      });
      return;
    }
    // Fallback if composer.js didn't load
    const title = prompt('Link title:');
    if (!title) return;
    const url = prompt('URL:');
    if (!url) return;
    await NX.sb.from('equipment_attachments').insert({
      equipment_id: equipId, type: 'link',
      title: title.slice(0, 200), external_url: url,
      uploaded_by: NX.currentUser?.name || 'user'
    });
    NX.toast && NX.toast('Link added ✓', 'success');
    reopen();
    return;
  }

  if (type === 'note') {
    if (NX.composer?.modal) {
      NX.composer.modal({
        title: 'Add a note',
        subtitle: 'Notes stay attached to this equipment',
        buttonLabel: 'Add note',
        fields: [
          { name: 'title', label: 'Note title', placeholder: 'Short heading', autofocus: true },
          { name: 'desc',  label: 'Content', placeholder: 'Details…', multiline: true, rows: 4 },
        ],
        onSubmit: async ({ title, desc }) => {
          if (!title || !desc) {
            NX.toast && NX.toast('Both title and content are required', 'warn');
            throw new Error('missing fields');
          }
          await NX.sb.from('equipment_attachments').insert({
            equipment_id: equipId, type: 'note',
            title: title.slice(0, 200), description: desc,
            uploaded_by: NX.currentUser?.name || 'user'
          });
          NX.toast && NX.toast('Note added ✓', 'success');
          reopen();
        },
      });
      return;
    }
    // Fallback
    const title = prompt('Note title:');
    if (!title) return;
    const desc = prompt('Note content:');
    if (!desc) return;
    await NX.sb.from('equipment_attachments').insert({
      equipment_id: equipId, type: 'note',
      title: title.slice(0, 200), description: desc,
      uploaded_by: NX.currentUser?.name || 'user'
    });
    NX.toast && NX.toast('Note added ✓', 'success');
    reopen();
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  if (type === 'photo') {
    input.accept = 'image/*';
    input.capture = 'environment';
  } else {
    input.accept = '*/*';
  }

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      NX.toast && NX.toast('File too large (max 100MB)', 'error');
      return;
    }
    const title = prompt('Title for this attachment:', file.name) || file.name;
    NX.toast && NX.toast('Uploading…', 'info', 8000);

    try {
      const fname = `${equipId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
      const { error: upErr } = await NX.sb.storage
        .from('equipment-attachments')
        .upload(fname, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = NX.sb.storage.from('equipment-attachments').getPublicUrl(fname);
      await NX.sb.from('equipment_attachments').insert({
        equipment_id: equipId, type,
        title: title.slice(0, 200),
        file_url: publicUrl,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: NX.currentUser?.name || 'user'
      });
      NX.toast && NX.toast('Uploaded ✓', 'success');
      reopen();
    } catch (err) {
      console.error('[Attach] Upload error:', err);
      NX.toast && NX.toast('Upload failed: ' + err.message, 'error');
    }
  });

  input.click();
}

async function deleteAttachment(id) {
  if (!confirm('Delete this attachment?')) return;
  try {
    const { data: a } = await NX.sb.from('equipment_attachments').select('*').eq('id', id).single();
    if (a && a.file_url) {
      const match = a.file_url.match(/equipment-attachments\/(.+)$/);
      if (match) await NX.sb.storage.from('equipment-attachments').remove([match[1]]);
    }
    await NX.sb.from('equipment_attachments').delete().eq('id', id);
    NX.toast && NX.toast('Deleted ✓', 'success');
    if (a?.equipment_id) openFullEditor(a.equipment_id);
  } catch (err) {
    console.error(err);
    NX.toast && NX.toast('Delete failed', 'error');
  }
}

async function editAttachmentDesc(id) {
  const { data: a } = await NX.sb.from('equipment_attachments').select('*').eq('id', id).single();
  if (!a) return;
  const desc = prompt('Description:', a.description || '');
  if (desc == null) return;
  await NX.sb.from('equipment_attachments').update({ description: desc }).eq('id', id);
  NX.toast && NX.toast('Updated ✓', 'success');
  if (a.equipment_id) openFullEditor(a.equipment_id);
}

/* ─── Photo management ─── */

function uploadPhoto(equipId, field) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    NX.toast && NX.toast('Uploading…', 'info', 5000);

    try {
      const fname = `${equipId}/${field}-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
      const { error } = await NX.sb.storage
        .from('equipment-photos')
        .upload(fname, file, { upsert: false, contentType: file.type });
      if (error) throw error;

      const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
      await NX.sb.from('equipment').update({ [field]: publicUrl }).eq('id', equipId);
      NX.toast && NX.toast('Photo uploaded ✓', 'success');
      openFullEditor(equipId);
    } catch (err) {
      console.error(err);
      NX.toast && NX.toast('Upload failed', 'error');
    }
  });

  input.click();
}

function replacePhoto(equipId, field) { uploadPhoto(equipId, field); }

/**
 * Quick photo upload/replace — designed for the avatar tap on each
 * equipment row. Same as uploadPhoto(equipId, 'photo_url') except it
 * doesn't force-open the full editor on success; it refreshes the
 * equipment list inline so the new photo appears as the row avatar
 * immediately. The user stays in their list flow.
 */
/**
 * Quick status menu — opens a small popover anchored to the tapped
 * beacon in the equipment list. The 4 most common statuses sit one
 * tap away, with the current one highlighted. Picking a status
 * updates the DB and re-renders the list inline.
 *
 * Intentionally minimal: only the four common operational states
 * (Operational, Needs Service, Down, Retired). For the long-tail
 * states (loaned, missing, relocated) the user opens Edit Everything.
 */

/* Snackbar that slides up after a quick status change, offering an
   Undo button for 6 seconds. Tapping Undo reverts both the DB row
   and the in-memory state and re-renders the list. After 6s the
   banner auto-dismisses and the change is permanent.

   This protects against muscle-memory mistakes (tap "Down" when you
   meant "Needs Service") which are by far the most common error
   pattern for quick-status changes. */
function showStatusUndoBanner(eq, priorStatus, newStatus) {
  document.querySelectorAll('.eq-undo-banner').forEach(n => n.remove());
  const labels = {
    operational: 'Operational',
    needs_service: 'Needs Service',
    down: 'Down',
    retired: 'Retired',
  };
  const newLbl = labels[newStatus] || newStatus.replace('_', ' ');
  const priorLbl = labels[priorStatus] || priorStatus.replace('_', ' ');
  const banner = document.createElement('div');
  banner.className = 'eq-undo-banner';
  banner.innerHTML = `
    <div class="eq-undo-banner-icon">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <div class="eq-undo-banner-text">
      <div class="eq-undo-banner-title">${esc(eq.name)} → ${esc(newLbl)}</div>
      <div class="eq-undo-banner-sub" data-eq-undo-countdown>6s to undo</div>
    </div>
    <button class="eq-undo-banner-btn" type="button">Undo</button>
  `;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('is-shown'));

  let remaining = 6;
  const sub = banner.querySelector('[data-eq-undo-countdown]');
  const tick = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) { clearInterval(tick); return; }
    if (sub) sub.textContent = `${remaining}s to undo`;
  }, 1000);
  const dismissTimer = setTimeout(() => {
    banner.classList.remove('is-shown');
    setTimeout(() => banner.remove(), 250);
    clearInterval(tick);
  }, 6000);

  banner.querySelector('.eq-undo-banner-btn').addEventListener('click', async () => {
    clearTimeout(dismissTimer);
    clearInterval(tick);
    const undoBtn = banner.querySelector('.eq-undo-banner-btn');
    undoBtn.disabled = true;
    undoBtn.textContent = 'Undoing…';
    try {
      const { error } = await NX.sb.from('equipment')
        .update({ status: priorStatus })
        .eq('id', eq.id);
      if (error) throw error;
      eq.status = priorStatus;
      eq.updated_at = new Date().toISOString();
      renderList();
      banner.classList.remove('is-shown');
      setTimeout(() => banner.remove(), 250);
      NX.toast && NX.toast(`Reverted to ${priorLbl}`, 'info', 1400);
      // v18.32 Phase 3b — log the revert as its own status_change event
      // (priorStatus is the original pre-bump value being restored, the
      // current eq.status before this update was newStatus, hence the
      // from→to direction here goes newStatus → priorStatus).
      logEquipmentEvent({
        equipmentId: eq.id,
        eventType: 'status_change',
        location: eq.location,
        payload: {
          from: newStatus, to: priorStatus,
          from_label: STATUSES.find(s => s.key === newStatus)?.label || newStatus,
          to_label:   STATUSES.find(s => s.key === priorStatus)?.label || priorStatus,
          equipment_name: eq.name,
          source: 'undo_banner',
        },
      });
    } catch (err) {
      console.error('[Equipment] undo status:', err);
      undoBtn.disabled = false;
      undoBtn.textContent = 'Undo';
      NX.toast && NX.toast('Could not undo: ' + (err.message || ''), 'error', 3000);
    }
  });
}

function openQuickStatusMenuForRow(equipId, anchorEl) {
  if (!equipId) return;
  const eq = equipment.find(x => x.id === equipId);
  if (!eq) return;

  // Tear down any existing popover so consecutive taps don't stack.
  document.querySelectorAll('.eq-quick-status-pop').forEach(n => n.remove());

  const STATES = [
    { key: 'operational',   label: 'Operational',    cls: 'is-operational' },
    { key: 'needs_service', label: 'Needs Service',  cls: 'is-needs-service' },
    { key: 'down',          label: 'Down',           cls: 'is-down' },
    { key: 'retired',       label: 'Retired',        cls: 'is-retired' },
  ];

  const cur = (eq.status || 'operational').toLowerCase();
  const pop = document.createElement('div');
  pop.className = 'eq-quick-status-pop';
  pop.innerHTML = `
    <div class="eq-quick-status-pop-arrow"></div>
    <div class="eq-quick-status-pop-title">${esc(eq.name)}</div>
    <div class="eq-quick-status-pop-options">
      ${STATES.map(s => `
        <button class="eq-quick-status-pop-btn ${s.cls} ${cur === s.key ? 'is-current' : ''}" data-status="${s.key}">
          <span class="eq-quick-status-pop-dot"></span>
          <span class="eq-quick-status-pop-label">${s.label}</span>
          ${cur === s.key ? '<span class="eq-quick-status-pop-check">✓</span>' : ''}
        </button>
      `).join('')}
    </div>
    <button class="eq-quick-status-pop-more" data-action="more">More options →</button>
  `;

  // Anchor positioning — appear above the beacon, right-aligned to it.
  document.body.appendChild(pop);
  const aRect = anchorEl.getBoundingClientRect();
  const pRect = pop.getBoundingClientRect();
  let top  = aRect.top + window.scrollY - pRect.height - 12;
  let left = aRect.right - pRect.width + (window.scrollX || 0);
  // If popping above would clip top of viewport, flip below.
  if (top < window.scrollY + 8) {
    top = aRect.bottom + window.scrollY + 12;
    pop.classList.add('is-below');
  }
  // Don't let it drift off the left edge.
  if (left < 8) left = 8;
  pop.style.top  = top  + 'px';
  pop.style.left = left + 'px';

  // Backdrop click to dismiss (clicking outside the pop closes it).
  const dismiss = (e) => {
    if (pop.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('click', dismiss, true);
  };
  setTimeout(() => document.addEventListener('click', dismiss, true), 0);

  // Wire the buttons.
  pop.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newStatus = btn.dataset.status;
      if (newStatus === cur) { pop.remove(); return; }
      // Optimistic UI: update in-memory + re-render list.
      const priorStatus = cur;
      eq.status = newStatus;
      eq.updated_at = new Date().toISOString();
      renderList();
      pop.remove();
      showStatusUndoBanner(eq, priorStatus, newStatus);

      try {
        const { error } = await NX.sb.from('equipment')
          .update({ status: newStatus })
          .eq('id', equipId);
        if (error) throw error;
        // Brain sync (best effort) so the AI knows about the state change.
        if (NX.eqBrainSync?.syncOne) NX.eqBrainSync.syncOne(equipId);
        // v18.32 Phase 3b — log to activity stream so the change appears
        // in the daily log "equipment activity" feed.
        logEquipmentEvent({
          equipmentId: equipId,
          eventType: 'status_change',
          location: eq.location,
          payload: {
            from: priorStatus, to: newStatus,
            from_label: STATUSES.find(s => s.key === priorStatus)?.label || priorStatus,
            to_label:   STATUSES.find(s => s.key === newStatus)?.label   || newStatus,
            equipment_name: eq.name,
            source: 'quick_status_menu',
          },
        });
        // Auto-open a ticket on the working→problem edge (deduped, best-effort).
        autoTicketForStatus(eq, newStatus, priorStatus);
      } catch (err) {
        // Rollback the optimistic update.
        console.error('[quickStatus] save failed:', err);
        NX.toast && NX.toast(`Could not save: ${err.message || ''}`, 'error', 3000);
        // Reload from DB to repair any drift.
        if (typeof loadEquipment === 'function') await loadEquipment();
      }
    });
  });

  pop.querySelector('[data-action="more"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.remove();
    if (typeof openFullEditor === 'function') openFullEditor(equipId);
  });
}

function quickReplacePhoto(equipId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    NX.toast && NX.toast('Uploading…', 'info', 5000);
    try {
      const fname = `${equipId}/photo_url-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`;
      const { error: upErr } = await NX.sb.storage
        .from('equipment-photos')
        .upload(fname, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
      const { error: dbErr } = await NX.sb.from('equipment').update({ photo_url: publicUrl }).eq('id', equipId);
      if (dbErr) throw dbErr;

      // Update in-memory equipment array so the next render shows the
      // new photo without a network round-trip.
      if (typeof equipment !== 'undefined' && Array.isArray(equipment)) {
        const e = equipment.find(x => x.id === equipId);
        if (e) e.photo_url = publicUrl;
      }
      // Re-render the list inline.
      if (typeof renderList === 'function') renderList();
      NX.toast && NX.toast('Photo updated ✓', 'success', 1400);
    } catch (err) {
      console.error('[equipment] quickReplacePhoto:', err);
      NX.toast && NX.toast('Upload failed: ' + (err.message || ''), 'error');
    }
  });

  input.click();
}

async function removePhoto(equipId, field) {
  if (!confirm('Remove this photo?')) return;
  await NX.sb.from('equipment').update({ [field]: null }).eq('id', equipId);
  NX.toast && NX.toast('Removed ✓', 'success');
  openFullEditor(equipId);
}

async function deleteCustomField(id, equipId) {
  if (!confirm('Delete this custom field?')) return;
  await NX.sb.from('equipment_custom_fields').delete().eq('id', id);
  NX.toast && NX.toast('Deleted ✓', 'success');
  openFullEditor(equipId);
}


/* ════════════════════════════════════════════════════════════════════════════
   10. LINEAGE — parent/child equipment, family tree
   ════════════════════════════════════════════════════════════════════════════ */

async function loadFamily(equipId) {
  try {
    const { data, error } = await NX.sb.rpc('get_family_tree', { eq_id: equipId });
    if (!error && data) return data;
  } catch (e) { /* fall through */ }

  // Fallback: self + parent + direct children (no recursion)
  const { data: self } = await NX.sb.from('equipment')
    .select('id, name, location, category, status, qr_code, parent_equipment_id, relationship_type')
    .eq('id', equipId).single();
  if (!self) return [];

  const out = [{ ...self, depth: 0, branch: 'self' }];

  if (self.parent_equipment_id) {
    const { data: parent } = await NX.sb.from('equipment')
      .select('id, name, location, category, status, qr_code, parent_equipment_id, relationship_type')
      .eq('id', self.parent_equipment_id).single();
    if (parent) out.unshift({ ...parent, depth: -1, branch: 'ancestor' });
  }

  const { data: children } = await NX.sb.from('equipment')
    .select('id, name, location, category, status, qr_code, parent_equipment_id, relationship_type')
    .eq('parent_equipment_id', equipId);
  if (children?.length) {
    children.forEach(c => out.push({ ...c, depth: 1, branch: 'descendant' }));
  }
  return out;
}

function renderFamilyTree(family, selfId) {
  if (!family.length) return `<div class="eq-family-empty">No relationships yet.</div>`;
  return `<div class="eq-family-tree">${
    family.map(node => {
      const isSelf = node.id === selfId;
      const indent = '·'.repeat(Math.abs(node.depth) + 1);
      const handler = isSelf ? '' : `onclick="NX.modules.equipment.openDetail('${node.id}')"`;
      return `
        <div class="eq-family-row ${isSelf ? 'is-self' : ''}" ${handler}>
          <span class="eq-family-indent">${indent}</span>
          <span class="eq-family-icon">${catIcon(node.category)}</span>
          <span class="eq-family-name">${esc(node.name)}</span>
          ${node.relationship_type && !isSelf
            ? `<span class="eq-family-rel" title="${esc(relLabel(node.relationship_type))}">${relIcon(node.relationship_type)} ${esc(relLabel(node.relationship_type))}</span>`
            : ''}
          <span class="eq-family-status-dot" style="background:${statusDot(node.status)}" title="${esc(node.status || '')}"></span>
        </div>
      `;
    }).join('')
  }</div>`;
}

async function renderFamilySection(equipId) {
  const modal = document.getElementById('eqModal');
  if (!modal) return;
  const overviewPanel = modal.querySelector('[data-panel="overview"]');
  if (!overviewPanel) return;
  // Remove existing family section if present (allows re-render after changes)
  const existing = overviewPanel.querySelector('#eqFamilySection');
  if (existing) existing.remove();

  const family = await loadFamily(equipId);
  const self = family.find(n => n.id === equipId) || { parent_equipment_id: null };
  const hasParent = !!self.parent_equipment_id;

  const section = document.createElement('div');
  section.className = 'eq-family-section';
  section.id = 'eqFamilySection';
  section.innerHTML = `
    <h4>${uiSvg('family', '14px')} Family</h4>
    ${renderFamilyTree(family, equipId)}
    <div class="eq-family-actions">
      ${hasParent
        ? `<button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.unsetParent('${equipId}')">Remove Parent</button>`
        : `<button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.pickParent('${equipId}')">+ Set Parent</button>`}
      <button class="eq-btn eq-btn-secondary" onclick="NX.modules.equipment.pickChild('${equipId}')">+ Add Child</button>
    </div>
  `;
  overviewPanel.appendChild(section);
}

async function pickParent(equipId) {
  await openEquipmentPicker({
    title: 'Set parent equipment',
    excludeId: equipId,
    excludeDescendantsOf: equipId,
    showRelationship: true,
    onPick: async (parentId, relationshipType) => {
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ parent_equipment_id: parentId, relationship_type: relationshipType })
          .eq('id', equipId);
        if (error) throw error;
        NX.toast && NX.toast('Parent set ✓', 'success');
        renderFamilySection(equipId);
      } catch (e) {
        const msg = String(e.message || e).includes('cycle')
          ? 'That would create a loop in the family tree.'
          : 'Could not set parent: ' + (e.message || e);
        NX.toast && NX.toast(msg, 'error');
      }
    }
  });
}

async function pickChild(equipId) {
  await openEquipmentPicker({
    title: 'Add child equipment',
    excludeId: equipId,
    excludeAncestorsOf: equipId,
    showRelationship: true,
    onPick: async (childId, relationshipType) => {
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ parent_equipment_id: equipId, relationship_type: relationshipType })
          .eq('id', childId);
        if (error) throw error;
        NX.toast && NX.toast('Child added ✓', 'success');
        renderFamilySection(equipId);
      } catch (e) {
        const msg = String(e.message || e).includes('cycle')
          ? 'That would create a loop in the family tree.'
          : 'Could not add child: ' + (e.message || e);
        NX.toast && NX.toast(msg, 'error');
      }
    }
  });
}

async function unsetParent(equipId) {
  if (!confirm('Remove the parent relationship?')) return;
  const { error } = await NX.sb.from('equipment')
    .update({ parent_equipment_id: null, relationship_type: null })
    .eq('id', equipId);
  if (error) {
    NX.toast && NX.toast('Failed: ' + error.message, 'error');
    return;
  }
  NX.toast && NX.toast('Parent removed', 'info');
  renderFamilySection(equipId);
}

async function openEquipmentPicker(opts) {
  const { data: all } = await NX.sb.from('equipment')
    .select('id, name, location, category, status, parent_equipment_id')
    .neq('status', 'retired')
    .order('location').order('name');
  const candidates = all || [];

  // Build exclusion set
  const exclude = new Set();
  if (opts.excludeId) exclude.add(opts.excludeId);
  if (opts.excludeDescendantsOf) {
    const queue = [opts.excludeDescendantsOf];
    while (queue.length) {
      const cur = queue.shift();
      candidates.filter(c => c.parent_equipment_id === cur).forEach(c => {
        if (!exclude.has(c.id)) { exclude.add(c.id); queue.push(c.id); }
      });
    }
  }
  if (opts.excludeAncestorsOf) {
    let cur = opts.excludeAncestorsOf;
    let hops = 0;
    while (cur && hops < 20) {
      const node = candidates.find(c => c.id === cur);
      if (!node || !node.parent_equipment_id) break;
      exclude.add(node.parent_equipment_id);
      cur = node.parent_equipment_id;
      hops++;
    }
  }

  const filtered = candidates.filter(c => !exclude.has(c.id));

  let overlay = document.getElementById('eqPickerOverlay');
  const isFreshPicker = !overlay;
  if (isFreshPicker) {
    overlay = document.createElement('div');
    overlay.id = 'eqPickerOverlay';
    overlay.className = 'eq-picker-overlay';
    document.body.appendChild(overlay);
  }
  let selectedRel = opts.showRelationship ? 'connected_to' : null;

  const renderList = (query) => {
    const q = (query || '').toLowerCase().trim();
    const matches = q
      ? filtered.filter(c => (c.name + ' ' + (c.location || '')).toLowerCase().includes(q))
      : filtered;
    if (!matches.length) return `<div class="eq-picker-empty">No equipment matches.</div>`;
    return matches.map(c => `
      <div class="eq-picker-item" data-id="${c.id}">
        <span class="eq-picker-item-icon">${catIcon(c.category)}</span>
        <div class="eq-picker-item-body">
          <div class="eq-picker-item-name">${esc(c.name)}</div>
          <div class="eq-picker-item-sub">${esc(c.location || '')}${c.status && c.status !== 'operational' ? ' · ' + esc(c.status) : ''}</div>
        </div>
      </div>
    `).join('');
  };

  overlay.innerHTML = `
    <div class="eq-picker">
      <div class="eq-picker-head">
        <h3>${esc(opts.title)}</h3>
        <button class="eq-picker-close" id="eqPickerClose">${uiSvg("close", "13px")}</button>
      </div>
      <div class="eq-picker-search">
        <input type="text" id="eqPickerSearch" placeholder="Search equipment…" autocomplete="off">
      </div>
      ${opts.showRelationship ? `
        <div class="eq-picker-rel-row" id="eqPickerRelRow">
          ${RELATIONSHIP_TYPES.map(r => `
            <button class="eq-rel-chip ${r.key === selectedRel ? 'active' : ''}" data-rel="${r.key}">
              ${r.icon} ${r.label}
            </button>
          `).join('')}
        </div>` : ''}
      <div class="eq-picker-list" id="eqPickerList">${renderList('')}</div>
    </div>
  `;
  overlay.classList.add('active');

  const close = () => { overlay.classList.remove('active'); overlay.innerHTML = ''; };
  document.getElementById('eqPickerClose').addEventListener('click', close);
  if (isFreshPicker) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const searchInput = document.getElementById('eqPickerSearch');
  searchInput.addEventListener('input', () => {
    document.getElementById('eqPickerList').innerHTML = renderList(searchInput.value);
    wireItems();
  });
  searchInput.focus();

  if (opts.showRelationship) {
    document.getElementById('eqPickerRelRow').addEventListener('click', e => {
      const chip = e.target.closest('.eq-rel-chip');
      if (!chip) return;
      selectedRel = chip.dataset.rel;
      document.querySelectorAll('#eqPickerRelRow .eq-rel-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  }

  function wireItems() {
    document.querySelectorAll('#eqPickerList .eq-picker-item').forEach(el => {
      el.addEventListener('click', () => { close(); opts.onPick(el.dataset.id, selectedRel); });
    });
  }
  wireItems();
}


/* ════════════════════════════════════════════════════════════════════════════
   11. DISPATCH — contractor dispatch sheet, dispatch_log
   ════════════════════════════════════════════════════════════════════════════ */

function extractContact(node) {
  const text = (node.notes || '') + '\n' + JSON.stringify(node.tags || []) + '\n' + (node.name || '');
  const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const links = node.links || {};
  return {
    phone: links.phone || (phoneMatch ? phoneMatch[0].trim() : ''),
    email: links.email || (emailMatch ? emailMatch[0].trim() : ''),
  };
}

function normalizePhone(p) {
  if (!p) return '';
  const cleaned = p.replace(/[^\d+]/g, '');
  if (cleaned.length === 10 && !cleaned.startsWith('+')) return '+1' + cleaned;
  return cleaned;
}

async function loadContractors() {
  let pool = NX.nodes || [];
  if (!pool.length) {
    const { data } = await NX.sb.from('nodes').select('*').limit(2000);
    pool = data || [];
  }
  const isContractor = n => {
    const cat = (n.category || '').toLowerCase();
    if (cat === 'contractor' || cat === 'vendor' || cat === 'service' || cat === 'contractors') return true;
    const tags = (n.tags || []).map(t => String(t).toLowerCase());
    if (tags.some(t => /contract|vendor|service|hvac|plumb|electric|refriger/.test(t))) return true;
    return false;
  };
  return pool
    .filter(isContractor)
    .map(n => ({ ...n, _contact: extractContact(n) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function loadEquipmentForDispatch(equipId) {
  const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
  if (!eq) return null;

  let ticket = null;
  try {
    const { data: tickets } = await NX.sb.from('tickets')
      .select('id, title, body, status, created_at')
      .eq('equipment_id', equipId)
      .neq('status', 'closed').neq('status', 'resolved')
      .order('created_at', { ascending: false }).limit(1);
    if (tickets?.length) ticket = tickets[0];
  } catch (e) {}

  return { eq, ticket };
}

async function loadRecentDispatches(equipId, limit = 3) {
  try {
    const { data } = await NX.sb.from('dispatch_log')
      .select('*').eq('equipment_id', equipId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch (e) { return []; }
}

/* Contact the equipment's linked vendor — note-first, for BOTH email and
   call. Tapping ✉ Email / 📞 Call asks WHY first; the note then:
     1. lands on the board — appended as a timeline comment on the unit's
        existing open card, or a new [EMAIL]/[CALL] ticket + card if none
     2. flips the equipment status to needs_service (never downgrades a
        'down' unit)
     3. drops a row into TODAY's daily notes under that location's
        "Vendor & service calls"
   …and only THEN opens the composer (with the note filling the vendor
   template's {issue}/{description}) or the dialer. No note → no contact. */
async function openVendorContactSheet(vendorId, equipId, role, method) {
  const isEmail = method !== 'call';
  try {
    const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
    if (!eq) { NX.toast && NX.toast('Equipment not found', 'error'); return; }

    let vendor = null;
    if (vendorId) {
      const { data } = await NX.sb.from('vendors').select('*').eq('id', vendorId).maybeSingle();
      vendor = data || null;
    }
    if (!vendor) {
      // Pseudo-vendor from the linked contractor node's contact info.
      const nodeId = role === 'repair' ? eq.repair_contractor_node_id : eq.service_contractor_node_id;
      if (nodeId) {
        try {
          const { data: node } = await NX.sb.from('nodes').select('*').eq('id', nodeId).maybeSingle();
          if (node) {
            const emails = [];
            const links = Array.isArray(node.links) ? node.links : (node.links ? [node.links] : []);
            links.forEach(l => {
              if (l && typeof l === 'object' && l.email) emails.push({ value: String(l.email) });
              else if (typeof l === 'string') {
                const m = l.match(/[\w.+-]+@[\w-]+\.[\w.-]+/); if (m) emails.push({ value: m[0] });
              }
            });
            const nodePhone = (node.links && node.links.phone) || '';
            if (emails.length || nodePhone) vendor = { company: node.name, name: node.name, email: emails[0] && emails[0].value, emails, phone: nodePhone };
          }
        } catch (_) {}
      }
    }
    // Call can proceed on the plain-text phone even without any vendor record.
    if (!vendor && !isEmail) {
      const plainPhone = role === 'repair' ? eq.repair_contractor_phone : eq.service_contractor_phone;
      const plainName  = role === 'repair' ? eq.repair_contractor_name  : eq.service_contractor_name;
      if (plainPhone) vendor = { company: plainName || 'Contractor', name: plainName || 'Contractor', phone: plainPhone };
    }
    if (!vendor) { NX.toast && NX.toast(isEmail ? 'No vendor email on file — link a vendor in Edit → Links.' : 'No phone on file.', 'warning'); return; }

    const vName = vendor.company || vendor.name || 'vendor';
    const phone = vendor.phone || (role === 'repair' ? eq.repair_contractor_phone : eq.service_contractor_phone) || '';
    if (!isEmail && !phone) { NX.toast && NX.toast('No phone on file for this vendor.', 'warning'); return; }
    const verb = isEmail ? 'Email' : 'Call';

    // ── WHY sheet — the contact only proceeds once a reason is entered ──
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9300;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55)';
    overlay.innerHTML = `
      <div style="position:relative;width:100%;max-width:520px;background:var(--surface,#171512);border:1px solid var(--nx-gold-line,rgba(212,164,78,.3));border-radius:16px 16px 0 0;padding:20px 18px 26px">
        <div style="font-size:17px;font-weight:700;margin-bottom:4px">${verb} ${esc(vName)}</div>
        <div style="font-size:12px;color:var(--muted,#9a9284);margin-bottom:12px">${esc(eq.name)} · logs to board + daily notes, flags the unit, then ${isEmail ? 'opens the email' : 'dials'}</div>
        <div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#9a9284);margin-bottom:5px">Why are you ${isEmail ? 'emailing' : 'calling'}? *</div>
        <textarea id="eqContactWhy" rows="3" maxlength="600" placeholder="e.g. Steam setting is not working"
          style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--border,rgba(255,255,255,.12));background:var(--surface-2,rgba(255,255,255,.03));color:var(--text,#ece4d4);font-family:inherit;font-size:15px;resize:vertical"></textarea>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button id="eqContactCancel" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.12));background:none;color:var(--text,#ece4d4);font-family:inherit;cursor:pointer">Cancel</button>
          <button id="eqContactGo" disabled style="flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold,#d4a44e);color:#000;font-weight:700;font-family:inherit;cursor:pointer;opacity:.5">Log &amp; ${verb}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#eqContactCancel').addEventListener('click', close);
    const whyEl = overlay.querySelector('#eqContactWhy');
    const goBtn = overlay.querySelector('#eqContactGo');
    whyEl.addEventListener('input', () => {
      const ok = whyEl.value.trim().length >= 3;
      goBtn.disabled = !ok;
      goBtn.style.opacity = ok ? '1' : '.5';
    });
    setTimeout(() => whyEl.focus(), 60);

    goBtn.addEventListener('click', async () => {
      const why = whyEl.value.trim();
      if (why.length < 3) return;
      goBtn.disabled = true; goBtn.textContent = 'Logging…';
      const reporter = NX.currentUser?.name || 'Staff';
      const primaryEmail = vendor.email || (Array.isArray(vendor.emails) && vendor.emails[0] && (vendor.emails[0].value || vendor.emails[0].email)) || '';
      const glyph = isEmail ? '✉' : '📞';
      const contactLine = isEmail
        ? `Emailing: ${vName}${primaryEmail ? ' (' + primaryEmail + ')' : ''}`
        : `Calling: ${vName}${phone ? ' (' + phone + ')' : ''}`;

      // 1) BOARD — timeline of events. Prefer appending a comment to the
      // unit's existing open card so repeated contacts build one history;
      // create the [EMAIL]/[CALL] ticket + card only when no card is open.
      try {
        const doneRe = /^(done|closed|resolved|complete|completed|archived?)$/i;
        const { data: openCards } = await NX.sb.from('kanban_cards')
          .select('id, comments, column_name, status, archived, created_at')
          .eq('equipment_id', eq.id)
          .eq('archived', false)
          .order('created_at', { ascending: false })
          .limit(5);
        const live = (openCards || []).find(c =>
          !doneRe.test(String(c.column_name || '')) && !doneRe.test(String(c.status || '')));
        if (live) {
          const comments = Array.isArray(live.comments) ? [...live.comments] : [];
          comments.push({
            by: reporter,
            at: new Date().toISOString(),
            text: `${glyph} ${isEmail ? 'Emailed' : 'Called'} ${vName} — ${why}`,
          });
          await NX.sb.from('kanban_cards').update({ comments }).eq('id', live.id);
        } else if (NX.work && typeof NX.work.create === 'function') {
          await NX.work.create({
            title: `[${isEmail ? 'EMAIL' : 'CALL'}] ${eq.name}: ${why.slice(0, 80)}`,
            notes: [
              `Vendor ${isEmail ? 'emailed' : 'called'} from the equipment detail.`,
              ``,
              `Equipment: ${eq.name}`,
              `Location: ${[eq.location, eq.area].filter(Boolean).join(' · ') || '—'}`,
              eq.serial_number ? `Serial: ${eq.serial_number}` : null,
              contactLine,
              ``,
              `Reason:`,
              why,
            ].filter(x => x !== null).join('\n'),
            priority: 'normal',
            location: eq.location || null,
            equipmentId: eq.id,
            reportedBy: reporter,
            priorEqStatus: eq.status || 'operational',
          });
        }
      } catch (e2) {
        console.warn('[equipment] vendor contact trail failed (non-fatal):', e2);
      }

      // 1b) WORK ORDER — the daily log's "call: placed / not logged" line
      // reads the unit's open equipment_issues row. Stamp it (or create
      // it) BEFORE the composer/dialer opens so the contact is on record
      // even if the mail app backgrounds us.
      try {
        await NX.domain?.logVendorContact?.({
          equipmentId: eq.id,
          vendorId: (vendor && vendor.id) || null,
          vendorName: vName,
          why,
          method: isEmail ? 'email' : 'call',
          reporter,
        });
      } catch (_) {}

      // 2) STATUS — contacting a vendor about a unit means it needs
      // attention. Bump operational → needs_service; never downgrade.
      try {
        const rank = { operational: 0, needs_service: 1, down: 2 };
        if ((rank[eq.status || 'operational'] || 0) < 1) {
          await NX.sb.from('equipment').update({
            status: 'needs_service',
            status_note: `${isEmail ? 'Emailed' : 'Called'} ${vName}: ${why.slice(0, 160)}`,
          }).eq('id', eq.id);
        }
      } catch (e3) {
        console.warn('[equipment] status bump failed (non-fatal):', e3);
      }

      // 3) DAILY NOTES — vendor & service calls row for today.
      try {
        NX.domain?.appendVendorCallToDailyNotes?.({
          location: eq.location || '',
          vendor: vName,
          equipment: eq.name || '',
          issue: why,
          status: isEmail ? 'Emailed — awaiting reply' : 'Called — awaiting callback',
        });
      } catch (_) {}

      close();

      // 4) ACT — composer (template-aware) or dialer.
      if (isEmail) {
        const ctx = {
          restaurant:  eq.location || '',
          equipment:   eq.name || '',
          unit:        [eq.manufacturer, eq.model].filter(Boolean).join(' '),
          serial:      eq.serial_number || '',
          area:        eq.area || '',
          issue:       why.slice(0, 140),
          description: why,
          user:        reporter,
        };
        if (window.NX && typeof NX.vendorEmail === 'function') NX.vendorEmail(vendor, ctx);
        else window.location.href = 'mailto:' + encodeURIComponent(primaryEmail);
      } else {
        window.location.href = 'tel:' + String(phone).replace(/[^\d+]/g, '');
      }
      // Refresh the open detail so the new status/note shows immediately.
      try { setTimeout(() => openDetail(eq.id), 600); } catch (_) {}
    });
  } catch (e) {
    console.error('[equipment] openVendorContactSheet:', e);
    NX.toast && NX.toast('Could not open the contact sheet', 'error');
  }
}

function emailVendor(vendorId, equipId, role) { return openVendorContactSheet(vendorId, equipId, role, 'email'); }
function callVendor(vendorId, equipId, role)  { return openVendorContactSheet(vendorId, equipId, role, 'call'); }

function buildDispatchMessage(eq, ticket, contact, userName) {
  const restaurant = eq.location || '';
  const area = eq.area ? ` (${eq.area})` : '';
  const equipName = eq.name;
  const issue = ticket?.title || ticket?.body || '';
  const who = userName || 'NEXUS';
  const greeting = (contact.name || '').split(' ')[0] || 'there';

  let body = `Hi ${greeting}, this is ${who} at ${restaurant}.\n\n`;
  body += `We need service on: ${equipName}${area}\n`;
  if (eq.manufacturer || eq.model) body += `Unit: ${[eq.manufacturer, eq.model].filter(Boolean).join(' ')}\n`;
  if (eq.serial_number) body += `Serial: ${eq.serial_number}\n`;
  if (issue) body += `\nIssue: ${issue}\n`;
  body += `\nWhen can you take a look? Thanks.`;
  return body;
}

/* ═════════════════════════════════════════════════════════════════════════
   LOOKUP SERVICE PHONE FROM NODE
   
   Called from the Links tab in openFullEditor when user clicks "Look up
   from preferred contractor." Reads the preferred contractor node, extracts
   phone + name, and populates the service_contractor_name and service_contractor_phone
   form inputs.
   
   If no preferred contractor is set, falls back to scanning recent
   maintenance records for the most-used contractor and grabbing theirs.
   ═════════════════════════════════════════════════════════════════════════ */

async function lookupServicePhoneFromNode(equipId) {
  try {
    // select('*') tolerates schema gaps (service_vendor_id may be new).
    const { data: eq } = await NX.sb.from('equipment').select('*').eq('id', equipId).single();
    if (!eq) throw new Error('Equipment not found');

    // Load vendors and resolve this equipment's maintenance vendor — by the
    // linked vendor_id first, else by name match against the saved contractor
    // name. Vendor consolidation: phone comes straight off the vendor record.
    let vendor = null;
    try {
      const { data } = await NX.sb.from('vendors').select('*');
      const vendors = (data || []).filter(v => v.active !== false);
      if (eq.service_vendor_id) {
        vendor = vendors.find(v => String(v.id) === String(eq.service_vendor_id)) || null;
      }
      if (!vendor && eq.service_contractor_name) {
        const want = eq.service_contractor_name.toLowerCase();
        vendor = vendors.find(v => (v.company || v.name || '').toLowerCase() === want) || null;
      }
    } catch (_) {}

    if (!vendor) {
      NX.toast && NX.toast('No linked vendor. Type a vendor name in the field, or add one in Vendors.', 'warning');
      return;
    }
    const phone = vendor.phone || '';
    if (!phone) {
      NX.toast && NX.toast(`${vendor.company || vendor.name} has no phone on file. Add one in Vendors.`, 'warning');
      return;
    }

    const modal = document.getElementById('eqFullEditModal');
    if (!modal) return;
    const nameInput  = modal.querySelector('[data-field="service_contractor_name"]');
    const phoneInput = modal.querySelector('[data-field="service_contractor_phone"]');
    const fkInput    = modal.querySelector('[data-field="service_vendor_id"]');
    if (nameInput && !nameInput.value) nameInput.value = vendor.company || vendor.name || '';
    if (phoneInput) phoneInput.value = phone;
    if (fkInput) fkInput.value = vendor.id;

    NX.toast && NX.toast(`✓ Filled from ${vendor.company || vendor.name}`, 'success');
  } catch (err) {
    console.error('[lookupServicePhoneFromNode] failed:', err);
    NX.toast && NX.toast('Lookup failed: ' + err.message, 'error');
  }
}

async function openDispatchSheet(equipId, ticketId) {
  const ctx = await loadEquipmentForDispatch(equipId);
  if (!ctx) { NX.toast && NX.toast('Equipment not found', 'error'); return; }
  const { eq, ticket } = ctx;
  const contractors = await loadContractors();

  let activeTicket = ticket;
  if (ticketId && (!ticket || ticket.id !== ticketId)) {
    try {
      const { data } = await NX.sb.from('tickets').select('*').eq('id', ticketId).single();
      if (data) activeTicket = data;
    } catch (e) {}
  }

  let overlay = document.getElementById('dispatchOverlay');
  const isFreshOverlay = !overlay;
  if (isFreshOverlay) {
    overlay = document.createElement('div');
    overlay.id = 'dispatchOverlay';
    overlay.className = 'dispatch-overlay';
    document.body.appendChild(overlay);
  }

  let stage = 'contact';
  let selectedContact = null;
  let selectedMethod = null;
  let composedMessage = '';
  
  // Auto-select preferred contractor if equipment has one set.
  // Skips the contact picker entirely and jumps straight to the method stage.
  // User can still tap "Back" to change contractor if needed.
  if (eq.service_contractor_node_id) {
    const preferred = contractors.find(c => c.id === eq.service_contractor_node_id);
    if (preferred) {
      selectedContact = preferred;
      stage = 'method';
    }
  }
  
  // If no preferred contractor but the ticket has a recent dispatch to
  // somebody, use them. This handles the "reopen last dispatch" case.
  if (!selectedContact && activeTicket) {
    try {
      const { data: recent } = await NX.sb.from('dispatch_events')
        .select('contractor_node_id')
        .eq('ticket_id', activeTicket.id)
        .not('contractor_node_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent?.contractor_node_id) {
        const c = contractors.find(x => x.id === recent.contractor_node_id);
        if (c) { selectedContact = c; stage = 'method'; }
      }
    } catch (e) {}
  }

  const close = () => { overlay.classList.remove('active'); overlay.innerHTML = ''; };
  if (isFreshOverlay) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const render = () => {
    const headLine = stage === 'contact' ? 'Dispatch contractor'
                  : stage === 'method'  ? `Contact ${selectedContact?.name || ''}`
                                        : `Send ${selectedMethod}`;
    overlay.innerHTML = `
      <div class="dispatch-sheet">
        <div class="dispatch-handle"></div>
        <div class="dispatch-head">
          <h3>${esc(headLine)}</h3>
          <div class="dispatch-context">
            <span class="ctx-tag">${catIcon(eq.category)} ${esc(eq.name)}</span>
            <span class="ctx-tag">${esc(eq.location || '')}</span>
            ${activeTicket ? `<span class="ctx-tag">${uiSvg("ticket","11px")} ${esc((activeTicket.title || '').slice(0, 40))}</span>` : ''}
          </div>
        </div>
        <div class="dispatch-stage" id="dispatchStage">${renderStage()}</div>
        ${renderActions()}
      </div>
    `;
    overlay.classList.add('active');
    wireStage();
  };

  const renderStage = () => {
    if (stage === 'contact') return renderContactStage();
    if (stage === 'method')  return renderMethodStage();
    if (stage === 'compose') return renderComposeStage();
    return '';
  };

  const renderContactStage = () => {
    if (!contractors.length) {
      return `
        <div class="eq-picker-empty">
          No contractors in your brain yet.<br>
          Add them via Ingest, or tag any node as <b>contractor</b>.
        </div>
        <div class="dispatch-add-contact">
          <input id="dispatchAddName"  placeholder="Name (e.g. Joe's Refrigeration)">
          <input id="dispatchAddPhone" placeholder="Phone (optional)">
          <input id="dispatchAddEmail" placeholder="Email (optional)">
          <button class="eq-btn eq-btn-primary" id="dispatchAddBtn">+ Add & continue</button>
        </div>
      `;
    }
    const preferredId = eq.service_contractor_node_id;
    const sorted = [...contractors].sort((a, b) => {
      if (a.id === preferredId) return -1;
      if (b.id === preferredId) return 1;
      return 0;
    });
    return sorted.map(c => {
      const ct = c._contact || {};
      const isPref = c.id === preferredId;
      const initials = (c.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div class="dispatch-contact ${isPref ? 'is-preferred' : ''}" data-id="${c.id}">
          <div class="dispatch-contact-avatar">${esc(initials)}</div>
          <div class="dispatch-contact-body">
            <div class="dispatch-contact-name">
              ${esc(c.name)}
              ${isPref ? `<span class="preferred-star" title="Preferred contractor">${uiSvg('filledStar', '11px')}</span>` : ''}
            </div>
            <div class="dispatch-contact-meta">
              ${ct.phone ? esc(ct.phone) : ''}${ct.phone && ct.email ? ' · ' : ''}${ct.email ? esc(ct.email) : ''}
              ${!ct.phone && !ct.email ? '<span style="color:var(--amber)">Tap to add contact info</span>' : ''}
            </div>
          </div>
          <div class="dispatch-contact-methods">
            ${ct.phone ? uiSvg('phone', '13px') : ''}${ct.phone ? uiSvg('message', '13px') : ''}${ct.email ? uiSvg('email', '13px') : ''}
          </div>
        </div>
      `;
    }).join('');
  };

  const renderMethodStage = () => {
    const ct = selectedContact._contact || {};
    return `
      <div style="margin-bottom:6px">
        <div style="font-size:13px;color:var(--text);font-weight:500">${esc(selectedContact.name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          ${ct.phone ? esc(ct.phone) : ''}${ct.phone && ct.email ? ' · ' : ''}${ct.email ? esc(ct.email) : ''}
        </div>
      </div>
      <div class="dispatch-method-row">
        <button class="dispatch-method-btn" data-method="call"     ${!ct.phone ? 'disabled' : ''}>
          <span class="method-icon">${uiSvg('phone', '18px')}</span><span>Call</span>
        </button>
        <button class="dispatch-method-btn" data-method="sms"      ${!ct.phone ? 'disabled' : ''}>
          <span class="method-icon">${uiSvg('message', '18px')}</span><span>SMS</span>
        </button>
        <button class="dispatch-method-btn" data-method="whatsapp" ${!ct.phone ? 'disabled' : ''}>
          <span class="method-icon">${uiSvg('whatsapp', '18px')}</span><span>WhatsApp</span>
        </button>
        <button class="dispatch-method-btn" data-method="email"    ${!ct.email ? 'disabled' : ''}>
          <span class="method-icon">${uiSvg('email', '18px')}</span><span>Email</span>
        </button>
      </div>
      ${(!ct.phone && !ct.email) ? `
        <div class="dispatch-add-contact">
          <div style="font-size:12px;color:var(--muted)">Add contact info for ${esc(selectedContact.name)}:</div>
          <input id="dispatchEditPhone" placeholder="Phone" value="${escAttr(ct.phone || '')}">
          <input id="dispatchEditEmail" placeholder="Email" value="${escAttr(ct.email || '')}">
          <button class="eq-btn eq-btn-secondary" id="dispatchSaveContact">Save to ${esc(selectedContact.name)}</button>
        </div>
      ` : ''}
    `;
  };

  const renderComposeStage = () => {
    const ct = selectedContact._contact || {};
    const target = selectedMethod === 'email' ? ct.email : normalizePhone(ct.phone);
    composedMessage = composedMessage ||
      buildDispatchMessage(eq, activeTicket, selectedContact, NX.currentUser?.name);
    const isEmail = selectedMethod === 'email';
    return `
      <div class="dispatch-message">
        <div class="dispatch-message-target">
          <b>To:</b> ${esc(selectedContact.name)} <span style="color:var(--faint)">via ${esc(selectedMethod)}</span><br>
          <b>${isEmail ? 'Email' : 'Phone'}:</b> ${esc(target || '—')}
        </div>
        ${selectedMethod === 'call' ? `
          <div style="font-size:13px;color:var(--muted);text-align:center;padding:10px">
            Tap "Place Call" to dial ${esc(target || '')}.<br>
            <span style="font-size:11px;color:var(--faint)">A note will be logged for follow-up.</span>
          </div>
          <textarea id="dispatchNote" placeholder="Optional note about why you're calling…">${esc(composedMessage)}</textarea>
        ` : `
          <textarea id="dispatchBody">${esc(composedMessage)}</textarea>
        `}
      </div>
    `;
  };

  const renderActions = () => {
    if (stage === 'contact') return '';
    if (stage === 'method') {
      return `<div class="dispatch-actions">
        <button class="eq-btn eq-btn-secondary" id="dispatchBack">← Back</button>
      </div>`;
    }
    return `<div class="dispatch-actions">
      <button class="eq-btn eq-btn-secondary" id="dispatchBack">← Back</button>
      <button class="eq-btn eq-btn-primary" id="dispatchSend">
        ${selectedMethod === 'call' ? `${uiSvg('phone', '14px')} Place Call` : `${uiSvg('send', '14px')} Send`}
      </button>
    </div>`;
  };

  const wireStage = () => {
    if (stage === 'contact') {
      overlay.querySelectorAll('.dispatch-contact').forEach(el => {
        el.addEventListener('click', () => {
          selectedContact = contractors.find(c => c.id === el.dataset.id);
          if (!selectedContact) return;
          stage = 'method';
          render();
        });
      });
      const addBtn = document.getElementById('dispatchAddBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const name = document.getElementById('dispatchAddName').value.trim();
          if (!name) { NX.toast && NX.toast('Name required', 'error'); return; }
          const phone = document.getElementById('dispatchAddPhone').value.trim();
          const email = document.getElementById('dispatchAddEmail').value.trim();
          const newNode = await createContractorNode(name, phone, email);
          selectedContact = { ...newNode, _contact: { phone, email } };
          stage = 'method';
          render();
        });
      }
    }

    if (stage === 'method') {
      overlay.querySelectorAll('.dispatch-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          selectedMethod = btn.dataset.method;
          stage = 'compose';
          render();
        });
      });
      const saveBtn = document.getElementById('dispatchSaveContact');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const phone = document.getElementById('dispatchEditPhone').value.trim();
          const email = document.getElementById('dispatchEditEmail').value.trim();
          await saveContactToNode(selectedContact.id, phone, email);
          selectedContact._contact = { phone, email };
          NX.toast && NX.toast('Contact saved ✓', 'success');
          render();
        });
      }
      document.getElementById('dispatchBack')?.addEventListener('click', () => {
        stage = 'contact'; selectedContact = null; render();
      });
    }

    if (stage === 'compose') {
      document.getElementById('dispatchBack')?.addEventListener('click', () => {
        stage = 'method'; selectedMethod = null; composedMessage = ''; render();
      });
      document.getElementById('dispatchSend')?.addEventListener('click', async () => {
        const ta = document.getElementById('dispatchBody') || document.getElementById('dispatchNote');
        composedMessage = ta ? ta.value : composedMessage;
        await executeDispatch({
          contact: selectedContact,
          method: selectedMethod,
          message: composedMessage,
          equipId: eq.id,
          ticketId: activeTicket?.id,
        });
        close();
      });
    }
  };

  render();
}

async function createContractorNode(name, phone, email) {
  const links = {};
  if (phone) links.phone = phone;
  if (email) links.email = email;
  const newNode = {
    name,
    category: 'contractor',
    tags: ['contractor'],
    notes: [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : ''].filter(Boolean).join('\n'),
    links,
    owner_id: null,
    access_count: 0,
  };
  try {
    const { data, error } = await NX.sb.from('nodes').insert(newNode).select().single();
    if (error) throw error;
    if (NX.nodes) NX.nodes.push(data);
    if (NX.allNodes) NX.allNodes.push(data);
    return data;
  } catch (e) {
    console.warn('[Dispatch] Could not persist contractor node:', e);
    return { id: 'ephemeral_' + Date.now(), ...newNode };
  }
}

async function saveContactToNode(nodeId, phone, email) {
  const { data: node } = await NX.sb.from('nodes').select('notes, links').eq('id', nodeId).single();
  const links = { ...(node?.links || {}) };
  if (phone) links.phone = phone;
  if (email) links.email = email;
  const noteAddenda = [];
  if (phone && !(node?.notes || '').includes(phone)) noteAddenda.push(`Phone: ${phone}`);
  if (email && !(node?.notes || '').includes(email)) noteAddenda.push(`Email: ${email}`);
  const newNotes = noteAddenda.length
    ? [(node?.notes || '').trim(), noteAddenda.join('\n')].filter(Boolean).join('\n')
    : node?.notes;
  await NX.sb.from('nodes').update({ links, notes: newNotes }).eq('id', nodeId);
  if (NX.nodes) {
    const cached = NX.nodes.find(n => n.id === nodeId);
    if (cached) { cached.links = links; cached.notes = newNotes; }
  }
}

async function executeDispatch({ contact, method, message, equipId, ticketId }) {
  const ct = contact._contact || {};
  const phone = normalizePhone(ct.phone);
  const email = ct.email;
  let url = '';
  let opened = false;

  if (method === 'call' && phone) {
    url = `tel:${phone}`;
  } else if (method === 'sms' && phone) {
    url = `sms:${phone}?body=${encodeURIComponent(message)}`;
  } else if (method === 'whatsapp' && phone) {
    const waNum = phone.replace(/^\+/, '');
    url = `https://wa.me/${waNum}?text=${encodeURIComponent(message)}`;
  } else if (method === 'email' && email) {
    url = `mailto:${email}?subject=${encodeURIComponent('Service request — NEXUS')}&body=${encodeURIComponent(message)}`;
  }

  if (url) {
    try {
      const a = document.createElement('a');
      a.href = url;
      if (method === 'whatsapp') a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      opened = true;
    } catch (e) {
      console.warn('[Dispatch] Native handler failed:', e);
      try { window.open(url, '_blank'); opened = true; } catch {}
    }
  }

  await logDispatch({
    equipment_id: equipId,
    contractor_node_id: String(contact.id).startsWith('ephemeral_') ? null : contact.id,
    contractor_name: contact.name,
    contractor_phone: phone || null,
    contractor_email: email || null,
    method,
    ticket_id: ticketId || null,
    message,
    dispatched_by: NX.currentUser?.name || null,
    outcome: 'pending',
  });

  if (NX.trackAccess && contact.id && !String(contact.id).startsWith('ephemeral_')) {
    NX.trackAccess([contact.id]);
  }

  try {
    await NX.sb.from('action_chains').insert({
      trigger_text: `Dispatched ${contact.name} via ${method}`,
      actions: [{ type: 'dispatch', equipment_id: equipId, contractor_node_id: contact.id, method }],
      user_name: NX.currentUser?.name,
    });
  } catch (e) {}

  NX.toast && NX.toast(
    opened ? `Opened ${method} to ${contact.name} ✓` : `Logged ${method} attempt`,
    'success'
  );

  refreshDispatchChips(equipId);
}

async function logDispatch(record) {
  try {
    const { error } = await NX.sb.from('dispatch_log').insert(record);
    if (error) throw error;
  } catch (e) {
    console.warn('[Dispatch] Could not log to DB:', e);
    if (window.OfflineQueue) {
      try { await window.OfflineQueue.add({ type: 'dispatch_log', payload: record }); } catch {}
    }
  }
}

async function setOutcome(dispatchId, outcome, notes) {
  const update = { outcome };
  if (notes) update.outcome_notes = notes;
  if (outcome !== 'pending') update.responded_at = new Date().toISOString();
  await NX.sb.from('dispatch_log').update(update).eq('id', dispatchId);
}

async function refreshDispatchChips(equipId) {
  const overviewPanel = document.querySelector('#eqModal [data-panel="overview"]');
  if (!overviewPanel) return;
  const existing = overviewPanel.querySelector('#eqDispatchRecent');
  if (existing) existing.remove();
  const recent = await loadRecentDispatches(equipId, 3);
  if (!recent.length) return;

  const section = document.createElement('div');
  section.className = 'eq-family-section';
  section.id = 'eqDispatchRecent';
  section.innerHTML = `
    <h4>${uiSvg("phone", "14px")} Recent Dispatches</h4>
    <div class="eq-dispatch-recent">
      ${recent.map(d => `
        <div class="eq-dispatch-chip" data-id="${d.id}">
          <span class="chip-method">${methodIcon(d.method)}</span>
          <span class="chip-name">${esc(d.contractor_name || 'Unknown')}</span>
          <span class="chip-outcome outcome-${esc(d.outcome || 'pending')}"
                onclick="NX.modules.equipment.cycleDispatchOutcome('${d.id}', '${equipId}')"
                title="Click to update status">
            ${esc(d.outcome || 'pending')}
          </span>
          <span class="chip-when">${timeAgo(d.created_at)}</span>
        </div>
      `).join('')}
    </div>
  `;
  overviewPanel.appendChild(section);
}

const OUTCOME_CYCLE = ['pending', 'acknowledged', 'scheduled', 'resolved', 'no_response'];

async function cycleDispatchOutcome(dispatchId, equipId) {
  const { data } = await NX.sb.from('dispatch_log').select('outcome').eq('id', dispatchId).single();
  const cur = data?.outcome || 'pending';
  const idx = OUTCOME_CYCLE.indexOf(cur);
  const next = OUTCOME_CYCLE[(idx + 1) % OUTCOME_CYCLE.length];
  await setOutcome(dispatchId, next);
  NX.toast && NX.toast(`Marked: ${next}`, 'info');
  refreshDispatchChips(equipId);
}

function dispatchFromTicket(equipId, ticketId) {
  return openDispatchSheet(equipId, ticketId);
}

// Direct call to service contact. Shows a themed confirm modal before
// dialing so the user sees WHO they're about to call.
//
// Priority for phone lookup:
//   1. Use equipment.service_contractor_phone if set
//   2. Fallback to service_contractor_node_id → nodes.links.phone
//   3. If neither exists, prompt to set one up
async function callService(equipId) {
  try {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, service_contractor_phone, service_contractor_name, service_contractor_node_id')
      .eq('id', equipId).single();
    if (!eq) { NX.toast && NX.toast('Equipment not found', 'error'); return; }
    
    let phone = eq.service_contractor_phone;
    let name = eq.service_contractor_name;
    let source = phone ? 'direct' : null;
    
    // Fallback to contractor node
    if (!phone && eq.service_contractor_node_id) {
      const { data: node } = await NX.sb.from('nodes')
        .select('name, notes, tags, links')
        .eq('id', eq.service_contractor_node_id).single();
      if (node) {
        const text = (node.notes || '') + '\n' + JSON.stringify(node.tags || []) + '\n' + (node.name || '');
        const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        const links = node.links || {};
        phone = links.phone || (phoneMatch ? phoneMatch[0].trim() : '');
        name = name || node.name;
        source = 'contractor';
      }
    }
    
    if (!phone) {
      showNoServiceContactModal(equipId, eq.name);
      return;
    }
    
    showCallConfirmModal({
      equipId,
      equipName: eq.name,
      contactName: name || 'Service',
      phone,
      contractorNodeId: eq.service_contractor_node_id,
      source
    });
  } catch (err) {
    console.error('[callService] failed:', err);
    NX.toast && NX.toast('Call failed: ' + err.message, 'error');
  }
}

// Confirmation modal before dialing
// v18.24 — Major overhaul. The modal now mirrors the public-scan UX:
// priority pills, photo upload, ticket creation that lands on both
// Duties (tickets table) AND the Board (kanban_cards). When a ticket
// is created, the equipment status auto-updates based on severity:
//   urgent → 'down' (red)        won't function / unsafe
//   normal → 'needs_service'     flag for attention
//   low    → no status change    just a tracked observation
// Existing dispatch_events insert is preserved for audit; ticket +
// board card are additive surfaces.
function showCallConfirmModal({ equipId, equipName, contactName, phone, contractorNodeId, source }) {
  // Normalize to tel: format
  const cleaned = phone.replace(/[^\d+]/g, '');
  const telHref = cleaned.length === 10 && !cleaned.startsWith('+') ? '+1' + cleaned : cleaned;
  const prettyPhone = formatPhonePretty(phone);
  const sourceLabel = source === 'direct' ? 'Service contact on file'
                    : source === 'contractor' ? 'Preferred contractor'
                    : 'Service contact';

  const existing = document.getElementById('eqCallConfirm');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'eqCallConfirm';
  modal.className = 'eq-call-confirm';
  modal.innerHTML = `
    <div class="eq-call-confirm-bg"></div>
    <div class="eq-call-confirm-card" style="max-height: 90vh; overflow-y: auto">
      <div class="eq-call-confirm-icon">${uiSvg("phone", "32px")}</div>
      <div class="eq-call-confirm-title">Call ${esc(contactName)}?</div>
      <div class="eq-call-confirm-phone">${esc(prettyPhone)}</div>
      <div class="eq-call-confirm-meta">${esc(sourceLabel)} · ${esc(equipName)}</div>

      <div class="eq-call-confirm-issue-wrap">
        <label class="eq-call-confirm-issue-label" for="eqCallIssue">
          What's the issue? <span class="eq-optional-tag">(required — creates a work order + board ticket)</span>
        </label>
        <textarea class="eq-call-confirm-issue" id="eqCallIssue" rows="2" placeholder="e.g., Compressor not cooling, freezing intermittently..."></textarea>
      </div>

      <!-- v18.24 — Priority pills -->
      <div style="margin: 12px 0 6px;">
        <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Severity</label>
        <div id="eqCallPri" style="display:flex; gap:6px">
          <button type="button" class="eq-call-pri-btn" data-pri="low" style="flex:1; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:12px; cursor:pointer">Low</button>
          <button type="button" class="eq-call-pri-btn active" data-pri="normal" style="flex:1; padding:8px 10px; background:rgba(212,164,78,0.15); border:1px solid var(--nx-gold); border-radius:8px; color:var(--nx-gold); font-size:12px; cursor:pointer">Normal → needs service</button>
          <button type="button" class="eq-call-pri-btn" data-pri="urgent" style="flex:1; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:12px; cursor:pointer">Urgent → DOWN</button>
        </div>
      </div>

      <!-- v18.24 — Photo upload -->
      <div style="margin: 12px 0 6px;">
        <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Photo of issue <span style="opacity:0.5">(optional)</span></label>
        <div id="eqCallPhotoWrap" style="display:flex; gap:8px; align-items:flex-start">
          <button type="button" id="eqCallPhotoBtn" style="display:flex; align-items:center; gap:6px; padding:10px 14px; background:transparent; border:1px dashed rgba(255,255,255,0.15); border-radius:8px; color:var(--nx-faint); cursor:pointer">${uiSvg('camera', '14px')} Add photo</button>
          <input type="file" id="eqCallPhotoFile" accept="image/*" capture="environment" hidden>
          <div id="eqCallPhotoPreview" style="display:none; flex:1; max-width:120px"></div>
        </div>
      </div>

      <div class="eq-call-confirm-actions" style="margin-top:14px">
        <button class="eq-btn eq-btn-secondary" id="eqCallCancel">Cancel</button>
        <a class="eq-btn eq-call-service-btn is-disabled" id="eqCallGo" href="tel:${esc(telHref)}" aria-disabled="true"><i data-lucide="phone" class="eq-btn-icon"></i> Create Work Order & Call</a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('active'));

  const close = () => { modal.classList.remove('active'); setTimeout(() => modal.remove(), 200); };
  const issueEl = modal.querySelector('#eqCallIssue');
  const callBtn = modal.querySelector('#eqCallGo');

  // Enable Call Now only when there's at least 2 chars in the textarea
  issueEl.addEventListener('input', () => {
    const hasText = issueEl.value.trim().length >= 2;
    callBtn.classList.toggle('is-disabled', !hasText);
    callBtn.setAttribute('aria-disabled', hasText ? 'false' : 'true');
  });
  // Autofocus so user can type right away on mobile
  setTimeout(() => issueEl.focus(), 250);

  modal.querySelector('.eq-call-confirm-bg').addEventListener('click', close);
  document.getElementById('eqCallCancel').addEventListener('click', close);

  // Priority selection
  let priority = 'normal';
  const priBtns = modal.querySelectorAll('.eq-call-pri-btn');
  priBtns.forEach(b => b.addEventListener('click', () => {
    priority = b.dataset.pri;
    priBtns.forEach(x => {
      const isActive = x === b;
      x.classList.toggle('active', isActive);
      if (isActive) {
        if (priority === 'urgent') {
          x.style.background = 'rgba(196,68,68,0.15)';
          x.style.borderColor = '#c44';
          x.style.color = '#e08585';
        } else if (priority === 'low') {
          x.style.background = 'rgba(255,255,255,0.06)';
          x.style.borderColor = 'rgba(255,255,255,0.2)';
          x.style.color = 'var(--nx-text)';
        } else {
          x.style.background = 'rgba(212,164,78,0.15)';
          x.style.borderColor = 'var(--nx-gold)';
          x.style.color = 'var(--nx-gold)';
        }
      } else {
        x.style.background = 'rgba(255,255,255,0.03)';
        x.style.borderColor = 'rgba(255,255,255,0.1)';
        x.style.color = 'var(--nx-text)';
      }
    });
  }));

  // Photo selection
  let pendingPhoto = null;
  const photoBtn = modal.querySelector('#eqCallPhotoBtn');
  const photoFile = modal.querySelector('#eqCallPhotoFile');
  const photoPreview = modal.querySelector('#eqCallPhotoPreview');
  photoBtn.addEventListener('click', () => photoFile.click());
  photoFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    pendingPhoto = f;
    const url = URL.createObjectURL(f);
    photoPreview.style.display = 'block';
    photoPreview.innerHTML = `
      <div style="position:relative; display:inline-block">
        <img src="${url}" style="width:120px; height:90px; object-fit:cover; border-radius:8px; border:1px solid rgba(255,255,255,0.1)">
        <button type="button" id="eqCallPhotoClear" style="position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:50%; background:#c44; color:#fff; border:0; cursor:pointer; font-size:14px; line-height:1">×</button>
      </div>`;
    photoBtn.style.display = 'none';
    photoPreview.querySelector('#eqCallPhotoClear').addEventListener('click', () => {
      pendingPhoto = null;
      photoFile.value = '';
      photoPreview.style.display = 'none';
      photoPreview.innerHTML = '';
      photoBtn.style.display = '';
    });
  });

  callBtn.addEventListener('click', async (e) => {
    const issue = issueEl.value.trim();
    if (!issue || issue.length < 2) {
      e.preventDefault();
      issueEl.focus();
      issueEl.style.borderColor = 'var(--red)';
      setTimeout(() => { issueEl.style.borderColor = ''; }, 1200);
      return;
    }

    // Prevent the tel: from firing immediately — we want all the
    // ticketing async work to complete first, then jump to dialer.
    e.preventDefault();
    callBtn.classList.add('is-disabled');

    // Run all the orchestration in parallel where safe; await all.
    const reporter = NX.currentUser?.name || 'Staff';

    // 1) dispatch_events (existing audit trail)
    try {
      const { data: disp } = await NX.sb.from('dispatch_events').insert({
        equipment_id: equipId,
        contractor_node_id: contractorNodeId || null,
        contractor_name: contactName,
        contractor_phone: phone,
        method: 'call',
        issue_description: issue,
        dispatched_by: reporter,
        outcome: 'pending',
      }).select('id').single();
      if (disp?.id && NX.domain?.recordDispatch) {
        try { await NX.domain.recordDispatch({ equipmentId: equipId, dispatchEventId: disp.id }); } catch (_) {}
      }
    } catch (err) { console.warn('dispatch_events log failed:', err); }

    // 2) Photo upload (if attached)
    let photoUrl = null;
    if (pendingPhoto) {
      try {
        const safeName = pendingPhoto.name.replace(/[^a-z0-9.]/gi, '_');
        const path = `tickets/${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('equipment-attachments')
          .upload(path, pendingPhoto, { upsert: false, contentType: pendingPhoto.type });
        if (!upErr) {
          const { data: pub } = NX.sb.storage.from('equipment-attachments').getPublicUrl(path);
          photoUrl = pub?.publicUrl || null;
        }
      } catch (e) { console.warn('[callConfirm] photo upload failed:', e); }
    }

    // 3) Equipment status bump (urgent → down, normal → needs_service)
    let priorStatus = null;
    if (priority === 'urgent' || priority === 'normal') {
      try {
        const { data: curEq } = await NX.sb.from('equipment')
          .select('status').eq('id', equipId).single();
        const currentStatus = curEq?.status || 'operational';
        const desiredStatus = priority === 'urgent' ? 'down' : 'needs_service';
        const rank = { operational: 0, needs_service: 1, down: 2 };
        const curRank = rank[currentStatus] != null ? rank[currentStatus] : 0;
        const desRank = rank[desiredStatus];
        if (desRank > curRank) {
          priorStatus = currentStatus;
          await NX.sb.from('equipment').update({ status: desiredStatus }).eq('id', equipId);
          // v18.32 Phase 3b — log status_change so the bump surfaces in
          // the daily log activity feed alongside the related ticket.
          logEquipmentEvent({
            equipmentId: equipId,
            eventType: 'status_change',
            location: (equipment.find(e => e.id === equipId) || {}).location || null,
            payload: {
              from: currentStatus, to: desiredStatus,
              from_label: STATUSES.find(s => s.key === currentStatus)?.label || currentStatus,
              to_label:   STATUSES.find(s => s.key === desiredStatus)?.label || desiredStatus,
              equipment_name: equipName,
              source: 'ticket_call',
              ticket_priority: priority,
            },
          });
        }
      } catch (err) { console.warn('[callConfirm] status bump failed:', err); }
    }

    // 4) The WORK ORDER — the canonical record (Alfredo: "call service
    //    should make you fill out report issue… make a workorder.
    //    workorder makes a board ticket"). An equipment_issues row born
    //    at 'contractor_called' (we are literally calling them), which
    //    shows in the Work Orders module + daily notes, and — via
    //    ensureIssueCard — a board ticket linked by the issue: label,
    //    filed straight into In Progress by the lane sync.
    try {
      const now = new Date().toISOString();
      const { data: issueRow, error: issueErr } = await NX.sb.from('equipment_issues').insert({
        equipment_id: equipId,
        title: issue.slice(0, 120),
        description: `Reported via Call Service by ${reporter}. Calling ${contactName} (${prettyPhone}).\n\n${issue}`,
        status: 'contractor_called',
        priority,
        reported_at: now,
        contractor_called_at: now,
        contractor_name: contactName || null,
        reported_by: NX.currentUser?.id || null,
        reported_by_name: reporter,
      }).select('id').single();
      if (issueErr) throw issueErr;
      if (issueRow?.id && NX.domain?.ensureIssueCard) {
        const card = await NX.domain.ensureIssueCard(issueRow.id);
        if (card && card.id) {
          const patch = {};
          if (photoUrl) patch.photo_urls = [photoUrl];
          if (priorStatus) patch.prior_eq_status = priorStatus;
          if (Object.keys(patch).length) {
            try { await NX.sb.from('kanban_cards').update(patch).eq('id', card.id); } catch (_) {}
          }
        }
      }
    } catch (err) {
      // Fallback: the old card+ticket dual write, so a schema surprise
      // never leaves the call untracked.
      console.warn('[callConfirm] work order create failed — falling back to card+ticket:', err);
      try {
        await NX.work.create({
          title: `[CALL] ${equipName}: ${issue.slice(0, 80)}`,
          notes: `Internal call. Equipment: ${equipName}\nReporter: ${reporter}\nCalling: ${contactName} (${prettyPhone})\n\nIssue:\n${issue}`,
          priority,
          equipmentId: equipId,
          photoUrl,
          reportedBy: reporter,
          priorEqStatus: priorStatus,
        });
      } catch (_) {}
    }

    NX.toast?.(`Work order created — calling ${contactName}…`, 'success', 1800);

    // 6) Hand off to dialer
    setTimeout(() => {
      window.location.href = `tel:${telHref}`;
      setTimeout(close, 800);
    }, 200);
  });
}

// Shown when no phone is on file anywhere
function showNoServiceContactModal(equipId, equipName) {
  const existing = document.getElementById('eqCallConfirm');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'eqCallConfirm';
  modal.className = 'eq-call-confirm';
  modal.innerHTML = `
    <div class="eq-call-confirm-bg"></div>
    <div class="eq-call-confirm-card">
      <div class="eq-call-confirm-icon" style="color:var(--nx-gold)">${uiSvg("phone","32px")}</div>
      <div class="eq-call-confirm-title">No service contact</div>
      <div class="eq-call-confirm-meta">${esc(equipName)} doesn't have a phone number on file. Add one in the editor to enable quick calling.</div>
      <div class="eq-call-confirm-actions">
        <button class="eq-btn eq-btn-secondary" id="eqCallCancel">Close</button>
        <button class="eq-btn eq-btn-primary" id="eqCallEdit">${uiSvg("settings", "14px")} Open Editor</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('active'));
  
  const close = () => { modal.classList.remove('active'); setTimeout(() => modal.remove(), 200); };
  modal.querySelector('.eq-call-confirm-bg').addEventListener('click', close);
  document.getElementById('eqCallCancel').addEventListener('click', close);
  document.getElementById('eqCallEdit').addEventListener('click', () => {
    close();
    openFullEditor(equipId);
  });
}

// Pretty-format a phone number for display
function formatPhonePretty(p) {
  if (!p) return '';
  const cleaned = p.replace(/[^\d]/g, '');
  // US 10-digit: (512) 555-1234
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
  }
  // US 11-digit starting with 1: 1 (512) 555-1234
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `1 (${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7)}`;
  }
  return p; // Unknown format, return as-is
}

// Three-dot overflow menu in the equipment detail action bar.
// Hides destructive actions (currently just Delete) behind a tap to prevent
// accidental triggers. Auto-closes on outside tap.
function toggleOverflow(event, equipId) {
  // Robust open/close for the equipment-detail overflow menu.
  //
  // Old version used setTimeout + { once: true } with a bubble-phase
  // outside-click listener. Two known footguns:
  //   1) Touch synthesizes click in a way that on some browsers fires
  //      the listener too early (between touchend and the user lifting
  //      their finger), self-removing it via { once: true } — so the
  //      menu would open and immediately close on mobile.
  //   2) The menu element has onclick="event.stopPropagation()", which
  //      prevents the bubble-phase listener from ever seeing inside-menu
  //      clicks at all — fine for the OPEN state, but it also meant that
  //      the listener never got the chance to remove itself cleanly on
  //      menu-item taps, leaking handlers across the session.
  //
  // New version: capture-phase listeners on both click and touchstart,
  // explicit add/remove (no { once: true }), and a closer that stays
  // in place until an actual outside tap happens.
  //
  // BUGFIX 2026-05-08: the menu was rendering BEHIND the cards in the
  // detail body. Cause: the parent .eq-detail-actions has overflow-x:
  // auto, which per CSS spec coerces overflow-y from `visible` to `auto`
  // — so anything popping UPWARD out of the action bar (this menu) gets
  // clipped to the bar's bounds. Fix: when opening, compute the button's
  // viewport rect and switch the menu to position:fixed with bottom/right
  // anchored to the viewport, escaping the parent's clipping box.
  //
  // BUGFIX 2026-05-09: even with position:fixed + z-index:10000, the
  // menu was rendering BEHIND other cards. Cause: the action bar has
  // position:sticky + z-index:5, which makes it a stacking context.
  // Anything inside (including this fixed-positioned menu) is trapped
  // inside that 5-level context — its 10000 only competes against
  // siblings inside the action bar, not against cards outside it.
  // Other content on the page sits at higher z-indexes than 5, so the
  // menu disappears behind them.
  //
  // Real fix: detach the menu from its parent and re-parent to <body>
  // when opening. Now z-index:10000 competes against everything in
  // body's root stacking context — which is what 10000 is supposed to
  // mean. On close, restore it to its original parent so the next
  // open works (and so React-style re-renders find it where they
  // expect).
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const menu = document.getElementById('eqOverflow-' + equipId);
  if (!menu) return;
  const isOpen = menu.classList.contains('active');

  // Wipe inline positioning styles so a previously-positioned menu falls
  // back cleanly when re-opened, and so closed menus don't leave behind
  // stale fixed-coords that could fight with CSS the next time we open.
  const clearPos = (m) => {
    m.style.position = '';
    m.style.top      = '';
    m.style.left     = '';
    m.style.right    = '';
    m.style.bottom   = '';
    m.style.zIndex   = '';
    m.style.maxHeight = '';
    m.style.overflowY = '';
  };

  // Restore a menu to its original parent + position. Looks up the
  // saved data-original-parent attribute we stamped at open time.
  // No-op if the menu was never detached (e.g., never opened).
  const restoreToOriginalParent = (m) => {
    const originalParentSelector = m.dataset.originalParent;
    if (!originalParentSelector) return;
    const originalParent = document.querySelector(originalParentSelector);
    if (originalParent && m.parentElement !== originalParent) {
      originalParent.appendChild(m);
    }
    delete m.dataset.originalParent;
  };

  // Close any other open overflows so we don't stack two open menus.
  document.querySelectorAll('.eq-overflow-menu.active').forEach(m => {
    if (m !== menu) {
      m.classList.remove('active');
      clearPos(m);
      restoreToOriginalParent(m);
    }
  });
  if (isOpen) {
    // Toggle: was open, close it now.
    menu.classList.remove('active');
    clearPos(menu);
    restoreToOriginalParent(menu);
    return;
  }

  // ─── OPENING THE MENU ─────────────────────────────────────────────
  // Look up the trigger button BEFORE detaching (since detaching
  // changes parentElement). The wrap selector is what we'll restore
  // back to on close.
  const wrap = menu.parentElement;
  const btn  = wrap ? wrap.querySelector('button') : null;
  const rect = btn ? btn.getBoundingClientRect() : null;

  // Detach from its current parent and append to body. This is the
  // critical move — escapes any/all stacking-context traps.
  if (wrap && wrap.id) {
    menu.dataset.originalParent = '#' + wrap.id;
  } else if (wrap && wrap.classList.length) {
    // Fallback: use a class-based selector. Less specific but the
    // overflow wrap is always uniquely scoped per-equip-id via the
    // menu's own id, so this only matters for the rare case of
    // synthetic menus without an id'd wrap.
    menu.dataset.originalParent = '.' + wrap.classList[0];
  }
  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add('active');

  // Reposition: viewport coords (same math as before — works the same
  // whether menu is in its original parent or in body, since fixed
  // positioning is always viewport-anchored).
  if (rect) {
    menu.style.position = 'fixed';
    // bottom = distance from viewport bottom to (button top - 8px gap).
    menu.style.bottom   = (window.innerHeight - rect.top + 8) + 'px';
    // right-anchor so the menu's right edge aligns with the button's
    // right edge. Works for buttons in either corner of the action bar.
    menu.style.right    = (window.innerWidth - rect.right) + 'px';
    menu.style.left     = 'auto';
    menu.style.top      = 'auto';
    // 2147483647 = max int32 = the highest z-index possible. Ensures
    // we sit above EVERY other element on the page, no matter what
    // z-index they use. Belt-and-suspenders since we're already in
    // body's stacking context.
    menu.style.zIndex   = '2147483647';
    // Cap height to the available space above the button so a menu with
    // many items can scroll internally rather than extend off-screen.
    const maxH = Math.max(120, rect.top - 16);
    menu.style.maxHeight = maxH + 'px';
    menu.style.overflowY = 'auto';
  }

  // Outside-tap closer. Capture phase (third arg = true) so it sees
  // every event regardless of stopPropagation handlers on children.
  // Bound on next tick so the click that opened the menu doesn't
  // immediately close it.
  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.classList.remove('active');
    clearPos(menu);
    restoreToOriginalParent(menu);
    document.removeEventListener('click',     close, true);
    document.removeEventListener('touchstart', close, true);
  };
  setTimeout(() => {
    document.addEventListener('click',     close, true);
    document.addEventListener('touchstart', close, true);
  }, 0);
}


/* ════════════════════════════════════════════════════════════════════════════
   12. UI INJECTION — per-row/card Zebra print buttons
   (Was MutationObserver dance in equipment-ux.js; now called directly from renderList)
   ════════════════════════════════════════════════════════════════════════════ */

function injectRowPrintButtons() {
  // Deprecated as of v27. The legacy quick-status ⟳ button on each row
  // (and on each grid card) is removed — the lifecycle beacon now
  // carries the visual signal, and status changes are accessible via:
  //   • long-press dial → no direct status change there, but → tap to detail
  //   • detail's overflow ⋯ → Edit Everything → Status field
  //   • the detail header pill (in the future, this could be made tappable)
  //
  // Function kept as a no-op so any other call sites that still invoke
  // it don't break. Safe to remove the call site and this function in a
  // future cleanup pass.
  return;
}

/* ═══ CROSS-SYSTEM CLOSE-OUT ═══════════════════════════════════════════
   When equipment goes back to Operational, cards still open about it
   are likely resolved. Show a compact modal offering to mark them Done
   in one tap — so the user isn't left manually chasing every linked
   ticket across Equip → Board → Calendar. Cards still LIVE in the Done
   column (audit history); they just stop cluttering active workflows.
   ═══════════════════════════════════════════════════════════════════════ */
function offerCardCloseOut(cards, eq) {
  // Remove any existing offer modal
  document.querySelector('.eq-closeout-modal')?.remove();

  const bg = document.createElement('div');
  bg.className = 'eq-closeout-bg';

  const modal = document.createElement('div');
  modal.className = 'eq-closeout-modal';
  const cardCount = cards.length;
  modal.innerHTML = `
    <div class="eq-closeout-head">
      <div class="eq-closeout-icon" style="color:var(--nx-gold)">${uiSvg("check","32px")}</div>
      <div>
        <h3 class="eq-closeout-title">${esc(eq?.name || 'Equipment')} is back up</h3>
        <p class="eq-closeout-sub">${cardCount} open card${cardCount === 1 ? ' is' : 's are'} linked to this equipment. Close ${cardCount === 1 ? 'it' : 'them'} out?</p>
      </div>
    </div>
    <ul class="eq-closeout-cards">
      ${cards.slice(0, 5).map(c => `<li>• ${esc(c.title || 'Untitled card')} <span class="eq-closeout-col">${esc((c.column_name || 'to_do').replace(/_/g, ' '))}</span></li>`).join('')}
      ${cards.length > 5 ? `<li class="eq-closeout-more">+ ${cards.length - 5} more</li>` : ''}
    </ul>
    <p class="eq-closeout-note">Cards will move to Done on the Board — still searchable, but out of your active views and off the calendar.</p>
    <div class="eq-closeout-actions">
      <button class="eq-closeout-btn eq-closeout-btn-secondary" data-action="skip">Keep open</button>
      <button class="eq-closeout-btn eq-closeout-btn-primary" data-action="move">
        ${uiSvg('check', '12px')} Move ${cardCount === 1 ? 'card' : 'all ' + cardCount} to Done
      </button>
    </div>
  `;

  document.body.append(bg, modal);

  const close = () => {
    bg.remove();
    modal.remove();
  };

  bg.addEventListener('click', close);
  modal.querySelector('[data-action="skip"]').addEventListener('click', close);
  modal.querySelector('[data-action="move"]').addEventListener('click', async () => {
    try {
      const ids = cards.map(c => c.id);
      const { error } = await NX.sb.from('kanban_cards')
        .update({ column_name: 'done', status: 'closed' })
        .in('id', ids);
      if (error) throw error;
      NX.toast && NX.toast(`${ids.length} card${ids.length === 1 ? '' : 's'} moved to Done ✓`, 'success');
      // Fire a home pulse so the galaxy/home reacts visually
      if (NX.homeGalaxyPulse) try { NX.homeGalaxyPulse(); } catch (_) {}
      close();
    } catch (err) {
      console.error('[closeout] move failed:', err);
      NX.toast && NX.toast('Move failed: ' + err.message, 'error');
    }
  });
}

/* ═══ QUICK STATUS MENU ════════════════════════════════════════════════
   Tap a row's status button → popup shows all 4 status options with
   color dots. Tap one → writes to DB + reloads list. Admin-only writes
   — for non-admin users, show a toast explaining the restriction.
   Small, mobile-first, dismisses on outside tap. */
function openQuickStatusMenu(equipmentId, anchorBtn) {
  // Remove any existing menu
  document.querySelector('.eq-status-menu')?.remove();

  const isAdmin = NX.currentUser?.role === 'admin';
  if (!isAdmin) {
    NX.toast && NX.toast('Admins only. Report an issue via the detail page instead.', 'info', 3500);
    return;
  }

  const eq = equipment.find(e => e.id === equipmentId);
  const currentKey = eq?.status || 'operational';

  const menu = document.createElement('div');
  menu.className = 'eq-status-menu';
  menu.innerHTML = `
    <div class="eq-status-menu-head">Change status</div>
    ${DROPDOWN_STATUSES.map(s => `
      <button class="eq-status-menu-item ${s.key === currentKey ? 'is-current' : ''}" data-key="${s.key}">
        <span class="eq-status-menu-dot" style="background:${s.color}"></span>
        <span>${s.label}</span>
        ${s.key === currentKey ? `<span class=\"eq-status-menu-check\">${uiSvg('check','11px')}</span>` : ''}
      </button>
    `).join('')}
  `;
  document.body.appendChild(menu);

  // Position next to anchor button
  const rect = anchorBtn.getBoundingClientRect();
  const menuH = 200;
  const top = (rect.bottom + menuH > window.innerHeight) ? rect.top - menuH - 6 : rect.bottom + 6;
  menu.style.top = Math.max(10, top) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';

  menu.querySelectorAll('.eq-status-menu-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newKey = btn.dataset.key;
      menu.remove();
      if (newKey === currentKey) return;
      try {
        const { error } = await NX.sb.from('equipment')
          .update({ status: newKey })
          .eq('id', equipmentId);
        if (error) throw error;
        NX.toast && NX.toast(`Status → ${STATUSES.find(s => s.key === newKey)?.label || newKey}`, 'success');
        if (eq) eq.status = newKey;  // optimistic local update
        // Log the status change as an equipment event — non-blocking,
        // captures from→to so the timeline shows transitions clearly.
        logEquipmentEvent({
          equipmentId,
          eventType: 'status_change',
          location: eq && eq.location,
          payload: {
            from: currentKey,
            to: newKey,
            from_label: STATUSES.find(s => s.key === currentKey)?.label || currentKey,
            to_label:   STATUSES.find(s => s.key === newKey)?.label   || newKey,
            equipment_name: eq && eq.name,
          },
        });
        // Sync to brain so the galaxy/AI reflects the new status
        // without waiting for next full refresh.
        if (NX.eqBrainSync?.syncOne) {
          try { await NX.eqBrainSync.syncOne(equipmentId); } catch (_) {}
        }
        buildUI();  // re-render list

        // ── CROSS-SYSTEM CLOSE-OUT ────────────────────────────────────
        // If equipment is back to Operational, any open card linked to
        // it is likely resolved. Offer to move them to Done so the user
        // doesn't have to manually close every related card.
        if (newKey === 'operational') {
          try {
            const { data: linkedCards } = await NX.sb.from('kanban_cards')
              .select('id, title, column_name, list_id')
              .eq('equipment_id', equipmentId)
              .neq('column_name', 'done')
              .or('archived.is.null,archived.eq.false');
            if (linkedCards && linkedCards.length) {
              offerCardCloseOut(linkedCards, eq);
            }
          } catch (_) { /* non-blocking */ }
        }
      } catch (err) {
        console.error('[status] update failed:', err);
        NX.toast && NX.toast('Update failed: ' + err.message, 'error');
      }
    });
  });

  // Dismiss on outside tap (delay one tick so the opening tap doesn't close it)
  setTimeout(() => {
    document.addEventListener('click', function dismiss(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', dismiss);
      }
    });
  }, 0);
}


/* ════════════════════════════════════════════════════════════════════════════
   13. UTILITIES — single canonical copies of helpers used throughout
   (Previously duplicated across 4+ files)
   ════════════════════════════════════════════════════════════════════════════ */

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function statusColor(s) { return STATUSES.find(x => x.key === s)?.color || 'var(--muted)'; }
function statusLabel(s) { return STATUSES.find(x => x.key === s)?.label || s; }

/* ════════════════════════════════════════════════════════════════════
   LIFECYCLE-AWARE STATUS PILL
   ════════════════════════════════════════════════════════════════════
   Replaces the static status pill with one that surfaces the current
   "state of work" on the equipment. Three layers of priority:

     1. Open issue → lifecycle state colors the pill (reported, called,
        ETA, in progress, awaiting parts).
     2. No open issue, status = operational → glowing gold pill.
     3. No open issue, status = down/broken → ghost outline with no fill.
     4. Other states (needs_service, retired, etc.) → muted pill.

   The pill is a visual signal, not just a label — operators standing
   at the equipment know its state from across the kitchen.
   ════════════════════════════════════════════════════════════════════ */

const LIFECYCLE_PILL_MAP = {
  reported: {
    label: 'REPORTED',
    cls: 'is-reported',
  },
  contractor_called: {
    label: 'CONTRACTOR CALLED',
    cls: 'is-called',
  },
  eta_set: {
    label: 'ETA SET',
    cls: 'is-eta',
  },
  in_progress: {
    label: 'IN PROGRESS',
    cls: 'is-in-progress',
  },
  awaiting_parts: {
    label: 'AWAITING PARTS',
    cls: 'is-awaiting',
  },
};

/**
 * Choose the lifecycle pill state for an equipment row.
 * Returns { label, cls, time? } where time is an optional sub-line
 * (ETA datetime when applicable, etc.).
 */
function pickLifecyclePillState(eq) {
  const issue = eq && eq._openIssue;
  if (issue) {
    const map = LIFECYCLE_PILL_MAP[issue.status] || LIFECYCLE_PILL_MAP.reported;
    let time = null;
    if (issue.status === 'eta_set' && issue.eta_at) {
      const d = new Date(issue.eta_at);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      time = sameDay
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    }
    return { label: map.label, cls: map.cls, time };
  }
  // No open issue — fall back to equipment.status semantics.
  const s = (eq.status || 'operational').toLowerCase();
  if (s === 'operational')              return { label: 'OPERATIONAL',   cls: 'is-operational' };
  if (s === 'down' || s === 'broken')   return { label: s.toUpperCase(), cls: 'is-down' };
  if (s === 'needs_service')            return { label: 'NEEDS SERVICE', cls: 'is-needs-service' };
  if (s === 'missing')                  return { label: 'MISSING',       cls: 'is-missing' };
  if (s === 'loaned')                   return { label: 'LOANED',        cls: 'is-muted' };
  if (s === 'relocated')                return { label: 'RELOCATED',     cls: 'is-muted' };
  if (s === 'retired')                  return { label: 'RETIRED',       cls: 'is-retired' };
  return { label: (s || 'unknown').toUpperCase(), cls: 'is-muted' };
}

/**
 * Render the lifecycle pill HTML. Three sizes for use in different
 * contexts: 'lg' (detail header), 'md' (grid card), 'sm' (list row).
 */
function lifecycleStatusPill(eq, size) {
  const state = pickLifecyclePillState(eq);
  const sizeCls = size === 'lg' ? 'eq-lc-pill-lg'
                : size === 'sm' ? 'eq-lc-pill-sm'
                : 'eq-lc-pill-md';
  return `
    <span class="eq-lc-pill ${sizeCls} ${state.cls}">
      <span class="eq-lc-pill-dot" aria-hidden="true">
        <span class="eq-lc-orbit eq-lc-orbit-fore" aria-hidden="true"></span>
        <span class="eq-lc-orbit eq-lc-orbit-back" aria-hidden="true"></span>
      </span>
      <span class="eq-lc-pill-label">${esc(state.label)}</span>
      ${state.time ? `<span class="eq-lc-pill-time">${esc(state.time)}</span>` : ''}
    </span>
  `;
}

/**
 * A bare-dot indicator for compact contexts (list-row column where
 * space is precious). Same color rules as the pill but no label.
 * The two empty <span class="eq-lc-orbit"> children are styling hooks
 * for orbiting "satellite" particles when the beacon is operational —
 * one passes over the dot (z-index above), one behind (z-index below),
 * giving the beacon a sense of life and depth. CSS controls every-
 * thing else; JS only emits the markup.
 */
function lifecycleStatusDot(eq) {
  const state = pickLifecyclePillState(eq);
  return `<span class="eq-lc-dot ${state.cls}" aria-label="${esc(state.label)}" role="button" tabindex="0">
    <span class="eq-lc-orbit eq-lc-orbit-fore" aria-hidden="true"></span>
    <span class="eq-lc-orbit eq-lc-orbit-back" aria-hidden="true"></span>
  </span>`;
}
/* catIcon — emits a Lucide-style line-art SVG glyph for an equipment
   category. Replaces the emoji approach (inconsistent rendering across
   devices, off-aesthetic). The SVG sizes itself to the parent's
   font-size via 1em width/height, and inherits color via currentColor —
   so existing call sites that style .eq-cat-icon (font-size:22px) and
   .eq-cat-icon-lg (font-size:32px) work without changes. */
function catIcon(c) {
  const path = ICON_PATHS[c] || ICON_PATHS.other;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle">${path}</svg>`;
}

function statusDot(s) {
  const dotColors = {
    operational:   'var(--green)',
    needs_service: 'var(--amber)',
    down:          'var(--red)',
    retired:       'var(--faint)',
  };
  return dotColors[s] || 'var(--muted)';
}

function relIcon(type) {
  const r = RELATIONSHIP_TYPES.find(x => x.key === type);
  return r ? r.icon : '·';
}

function relLabel(type) {
  if (!type) return '';
  const r = RELATIONSHIP_TYPES.find(x => x.key === type);
  return r ? r.label : type.replace(/_/g, ' ');
}

function attachmentIcon(a) {
  const isImage = (a.mime_type || '').startsWith('image/');
  const isPDF   = (a.mime_type || '').includes('pdf');
  return a.type === 'link'     ? uiSvg('link', '13px')
       : a.type === 'note'     ? uiSvg('note', '13px')
       : a.type === 'receipt'  ? uiSvg('receipt', '13px')
       : a.type === 'invoice'  ? uiSvg('dollar', '13px')
       : a.type === 'warranty' ? uiSvg('shield', '13px')
       : a.type === 'photo'    ? uiSvg('camera', '13px')
       : isImage               ? uiSvg('camera', '13px')
       : isPDF                 ? uiSvg('document', '13px')
       :                         uiSvg('paperclip', '13px');
}

function formatBytes(b) {
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
  return (b / 1048576).toFixed(1) + 'MB';
}

function methodIcon(m) {
  return ({
    call:     uiSvg('phone', '13px'),
    sms:      uiSvg('message', '13px'),
    whatsapp: uiSvg('whatsapp', '13px'),
    email:    uiSvg('email', '13px'),
  })[m] || uiSvg('message', '13px');
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(iso).toLocaleDateString();
}


/* ════════════════════════════════════════════════════════════════════════════
   PM LOG INLINE REVIEW — approve/reject/spam from the Timeline tab
   ════════════════════════════════════════════════════════════════════════════
   Contractor submits a PM via the public QR form → row lands in pm_logs with
   review_status='pending'. The Timeline tab surfaces pending logs for admins
   with inline action buttons so they never have to hunt for a hidden review
   dashboard.

   Approve path: updates pm_logs.review_status, inserts a matching row into
   equipment_maintenance (so the approved service appears as a "real" timeline
   event), and triggers the brain sync so the node reflects the new service
   history. Mirrors the existing updateReviewStatus() logic in
   equipment-public-pm.js — single-sourced here so the timeline flow uses the
   same code path as the standalone review dashboard.
   ════════════════════════════════════════════════════════════════════════════ */

async function approvePmLog(logId, equipmentId) {
  if (!confirm('Approve this service log? It will be added to the equipment timeline.')) return;
  try {
    // 1. Update the pm_log review status
    const reviewer = NX.currentUser?.name || 'Admin';
    const { error: upErr } = await NX.sb.from('pm_logs').update({
      review_status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer,
    }).eq('id', logId);
    if (upErr) throw upErr;

    // 2. Fetch the full row to promote it
    const { data: log, error: getErr } = await NX.sb.from('pm_logs').select('*').eq('id', logId).single();
    if (getErr) throw getErr;

    // 3. Insert matching equipment_maintenance row
    const maintDesc = log.work_performed
      + (log.parts_replaced ? '\n\nParts: ' + log.parts_replaced : '');
    const performer = log.contractor_name
      + (log.contractor_company ? ' (' + log.contractor_company + ')' : '');
    const { error: insErr } = await NX.sb.from('equipment_maintenance').insert({
      equipment_id: log.equipment_id,
      event_date: log.service_date,
      event_type: log.service_type || 'pm',
      description: maintDesc,
      performed_by: performer,
      cost: log.cost_amount,
      notes: `Submitted via QR scan${log.contractor_phone ? '. Phone: ' + log.contractor_phone : ''}.`,
      pm_log_id: log.id,
    });
    if (insErr) throw insErr;

    // v18.23 — Try to match a scheduled appointment for this PM and
    // flip it to 'completed'. Closes the loop between scheduling and
    // actual completion. Best-effort — won't fail the approval.
    try { await autoCompletePmSchedule(log.equipment_id, log, null); } catch (_) {}

    // 4. Push the PM dates onto equipment:
    //    - last_pm_date     := when contractor performed the PM
    //    - next_pm_date     := when the next PM is due
    //    - pm_interval_days := inferred from the gap, so the cadence
    //      shows on the detail page (was the missing piece — used to
    //      only update next_pm_date)
    const baseDate = log.pm_date || log.service_date;
    const eqUpdate = {};
    if (baseDate) eqUpdate.last_pm_date = baseDate;
    if (log.next_service_date) eqUpdate.next_pm_date = log.next_service_date;
    if (baseDate && log.next_service_date) {
      const days = Math.round(
        (new Date(log.next_service_date) - new Date(baseDate)) / 86400000
      );
      if (days > 0 && days <= 3650) {
        eqUpdate.pm_interval_days = days;
      }
    }
    if (Object.keys(eqUpdate).length) {
      await NX.sb.from('equipment').update(eqUpdate).eq('id', log.equipment_id);
    }

    // 5. Re-sync the equipment node in the knowledge graph (best effort)
    if (NX.eqBrainSync?.syncOne) {
      try { await NX.eqBrainSync.syncOne(log.equipment_id); } catch (_) {}
    }

    // 6. v18.4 DOMAIN ORCHESTRATION — archive any "Review PM" board
    //    cards that were auto-created when the contractor submitted
    //    via QR. Non-fatal.
    if (NX.domain?.approvePM) {
      try {
        await NX.domain.approvePM({ pmLogId: logId, equipmentId });
      } catch (e) {
        console.warn('[approvePmLog] domain hook failed (non-fatal):', e);
      }
    }

    NX.toast?.('Service log approved ✓', 'success');
    // 7. Reload the equipment detail to reflect the change
    await openDetail(equipmentId);
  } catch (err) {
    console.error('[approvePmLog] failed:', err);
    alert('Failed to approve: ' + err.message);
  }
}

async function rejectPmLog(logId, equipmentId) {
  if (!confirm('Reject this service log? It will be hidden from the timeline.')) return;
  try {
    const { error } = await NX.sb.from('pm_logs').update({
      review_status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: NX.currentUser?.name || 'Admin',
    }).eq('id', logId);
    if (error) throw error;
    // v18.4 DOMAIN — also archive any "Review PM" cards for this equipment
    if (NX.domain?.rejectPM) {
      try { await NX.domain.rejectPM({ pmLogId: logId, equipmentId }); } catch (_) {}
    }
    NX.toast?.('Log rejected', 'info');
    await openDetail(equipmentId);
  } catch (err) {
    console.error('[rejectPmLog] failed:', err);
    alert('Failed to reject: ' + err.message);
  }
}

async function markPmSpam(logId, equipmentId) {
  if (!confirm('Mark this log as spam? It will be hidden and the submitter flagged.')) return;
  try {
    const { error } = await NX.sb.from('pm_logs').update({
      review_status: 'spam',
      reviewed_at: new Date().toISOString(),
      reviewed_by: NX.currentUser?.name || 'Admin',
    }).eq('id', logId);
    if (error) throw error;
    // v18.4 DOMAIN — also archive any "Review PM" cards for this equipment
    if (NX.domain?.rejectPM) {
      try { await NX.domain.rejectPM({ pmLogId: logId, equipmentId }); } catch (_) {}
    }
    NX.toast?.('Marked as spam', 'info');
    await openDetail(equipmentId);
  } catch (err) {
    console.error('[markPmSpam] failed:', err);
    alert('Failed: ' + err.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   14. EXPORT — single flat namespace, no more Object.assign ceremony
   ════════════════════════════════════════════════════════════════════════════ */

if (!NX.modules) NX.modules = {};

/* ════════════════════════════════════════════════════════════════════════════
   15. ISSUE TRACKER — lifecycle (reported → contractor called → eta set →
                       in progress → repaired) + auto-generated emails
   ════════════════════════════════════════════════════════════════════════════
   Mirrors the order detail / lifecycle pattern from the ordering pane.
   Where ordering tracks an order from draft → closed, this tracks an
   equipment issue from "I noticed something's wrong" through "the
   contractor came and fixed it."

   States:
     reported        — chef noticed, logged. Not yet escalated.
     contractor_called — phone call made, voicemail or live conversation.
     eta_set         — contractor has committed to a window.
     in_progress     — contractor is on-site OR has started repairs.
     awaiting_parts  — repair stalled pending part delivery (optional branch)
     repaired        — fixed and verified.

   Each transition stamps a timestamp column. The state machine is
   forward-only EXCEPT awaiting_parts which can return to in_progress
   when parts arrive.

   The tracker is per-issue, not per-equipment. One piece of equipment
   can have multiple open issues (e.g. ice maker has both a slow-fill
   complaint AND a noisy compressor). They each track independently.
   ════════════════════════════════════════════════════════════════════════════ */

const ISSUE_LIFECYCLE = ['reported', 'contractor_called', 'eta_set', 'in_progress', 'awaiting_parts', 'repaired'];
const ISSUE_LIFECYCLE_LABELS = {
  reported:           'Reported',
  contractor_called:  'Contractor called',
  eta_set:            'ETA set',
  in_progress:        'In progress',
  awaiting_parts:     'Awaiting parts',
  repaired:           'Repaired',
};
// Display order in the timeline omits awaiting_parts because it's a
// side-branch off in_progress, not a normal-flow step.
const ISSUE_TIMELINE_STEPS = ['reported', 'contractor_called', 'eta_set', 'in_progress', 'repaired'];

function eqIssueTsForStatus(issue, status) {
  if (!issue) return null;
  switch (status) {
    case 'reported':           return issue.reported_at;
    case 'contractor_called':  return issue.contractor_called_at;
    case 'eta_set':            return issue.eta_set_at;
    case 'in_progress':        return issue.in_progress_at;
    case 'awaiting_parts':     return issue.awaiting_parts_at;
    case 'repaired':           return issue.repaired_at;
    default:                   return null;
  }
}

function eqIssueFmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = (now - d) / 86400000;
  if (diff < 1.5) return 'yesterday';
  if (diff < 7)   return d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Load all open issues (status != 'repaired') for a given equipment. */
async function loadEquipmentIssues(equipmentId, opts) {
  const includeRepaired = opts && opts.includeRepaired;
  if (!NX.sb || !equipmentId) return [];
  let query = NX.sb.from('equipment_issues')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('reported_at', { ascending: false });
  if (!includeRepaired) {
    query = query.neq('status', 'repaired');
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[equipment] loadEquipmentIssues:', error.message || error);
    return [];
  }
  return data || [];
}

// Auto-open a ticket when a unit crosses from a working state to a problem
// state (down / needs_service / broken) via ANY status control. Deduped:
// skips if an open (non-repaired) issue already exists for that unit, so
// routine toggles don't spam tickets. Best-effort + non-blocking — mirrors
// onto the board via the same domain hook the manual "Report issue" uses.
const PROBLEM_STATES = ['down', 'needs_service', 'broken', 'out_of_service'];
async function autoTicketForStatus(eq, newStatus, priorStatus) {
  try {
    if (!eq || !eq.id || !NX.sb) return;
    if (!PROBLEM_STATES.includes(newStatus)) return;      // only problem states
    if (PROBLEM_STATES.includes(priorStatus)) return;     // only the working→problem edge
    const open = await loadEquipmentIssues(eq.id, { includeRepaired: false });
    if (open && open.length) return;                      // dedup: already an open issue
    const isDown = newStatus === 'down' || newStatus === 'broken';
    const priority = isDown ? 'high' : 'normal';
    const title = isDown ? `${eq.name} is down` : `${eq.name} needs service`;
    const { data, error } = await NX.sb.from('equipment_issues').insert({
      equipment_id: eq.id,
      title,
      description: eq.status_note || null,
      status: 'reported',
      reported_at: new Date().toISOString(),
      reported_by: (NX.user && NX.user.id) || (NX.currentUser && NX.currentUser.id) || null,
      reported_by_name: (NX.user && NX.user.name) || (NX.currentUser && NX.currentUser.name) || null,
    }).select('*').single();
    if (error) throw error;
    if (NX.domain && NX.domain.recordEquipmentIssue) {
      await NX.domain.recordEquipmentIssue({ issueId: data.id, equipmentId: eq.id, title: data.title, description: data.description, priority });
    }
    if (NX.toast) NX.toast('🎫 Ticket opened — ' + title, 'info', 3500);
  } catch (e) {
    console.warn('[equipment] autoTicketForStatus failed (non-fatal):', e);
  }
}

/** Load latest open issue per equipment id (for list-view badges). */
async function loadOpenIssuesByEquipment(equipmentIds) {
  if (!NX.sb || !equipmentIds || !equipmentIds.length) return {};
  const { data, error } = await NX.sb.from('equipment_issues')
    .select('id, equipment_id, status, title, reported_at, eta_at')
    .in('equipment_id', equipmentIds)
    .neq('status', 'repaired')
    .order('reported_at', { ascending: false });
  if (error) {
    console.warn('[equipment] loadOpenIssuesByEquipment:', error.message || error);
    return {};
  }
  const map = {};
  for (const i of (data || [])) {
    if (!map[i.equipment_id]) map[i.equipment_id] = i;
  }
  return map;
}

/**
 * Open the issue tracker overlay for an equipment item. Loads existing
 * open issues and renders them in a stack. New-issue button at top
 * creates a fresh issue at status 'reported'.
 */
let issueTrackerState = null;

async function openIssueTracker(equipmentId) {
  if (!equipmentId || !NX.sb) return;
  closeIssueTracker();

  const { data: eq, error } = await NX.sb.from('equipment')
    .select('*').eq('id', equipmentId).single();
  if (error || !eq) {
    NX.toast && NX.toast('Equipment not found', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'eq-itracker-overlay';
  document.body.appendChild(overlay);

  issueTrackerState = { equipment: eq, issues: [], loading: true, overlay };
  renderIssueTracker();

  try {
    const issues = await loadEquipmentIssues(equipmentId, { includeRepaired: true });
    if (!issueTrackerState || issueTrackerState.overlay !== overlay) return;
    issueTrackerState.issues = issues;
    issueTrackerState.loading = false;
    renderIssueTracker();
  } catch (e) {
    console.error('[equipment] openIssueTracker:', e);
    if (issueTrackerState) {
      issueTrackerState.loading = false;
      renderIssueTracker();
    }
  }
}

function closeIssueTracker() {
  if (!issueTrackerState) return;
  if (issueTrackerState.overlay && issueTrackerState.overlay.parentNode) {
    issueTrackerState.overlay.parentNode.removeChild(issueTrackerState.overlay);
  }
  issueTrackerState = null;
}

function renderIssueTracker() {
  if (!issueTrackerState || !issueTrackerState.overlay) return;
  const { equipment, issues, loading, overlay } = issueTrackerState;

  const open = issues.filter(i => i.status !== 'repaired');
  const repaired = issues.filter(i => i.status === 'repaired');

  let bodyHTML;
  if (loading) {
    bodyHTML = `<div class="eq-itracker-loading">Loading issues…</div>`;
  } else if (!issues.length) {
    bodyHTML = `
      <div class="eq-itracker-empty">
        <div class="eq-itracker-empty-title">No issues logged</div>
        <div class="eq-itracker-empty-msg">Tap the button below to report a new issue. The tracker will follow it from "Reported" through to "Repaired."</div>
      </div>`;
  } else {
    bodyHTML = `
      ${open.length ? `<div class="eq-itracker-section-label">Open · ${open.length}</div>` : ''}
      ${open.map(renderIssueCard).join('')}
      ${repaired.length ? `<div class="eq-itracker-section-label eq-itracker-section-faded">Repaired · ${repaired.length}</div>` : ''}
      ${repaired.map(renderIssueCard).join('')}
    `;
  }

  overlay.innerHTML = `
    <div class="eq-itracker-head">
      <button class="eq-itracker-close" aria-label="Close issue tracker">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="eq-itracker-head-text">
        <div class="eq-itracker-vendor">${esc(equipment.name)}</div>
        <div class="eq-itracker-id">${esc(equipment.location || '—')}${equipment.area ? ' · ' + esc(equipment.area) : ''}</div>
      </div>
    </div>

    <div class="eq-itracker-body">
      ${bodyHTML}
    </div>

    <div class="eq-itracker-foot">
      <button class="eq-itracker-action eq-itracker-action-primary" data-action="new-issue">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Report a new issue</span>
      </button>
    </div>
  `;

  overlay.querySelector('.eq-itracker-close').addEventListener('click', closeIssueTracker);
  overlay.querySelector('[data-action="new-issue"]').addEventListener('click', () => {
    promptNewIssue(equipment);
  });
  overlay.querySelectorAll('.eq-itracker-issue-card').forEach(card => {
    const issueId = card.dataset.issueId;
    card.querySelector('[data-action="advance"]')?.addEventListener('click', e => {
      e.stopPropagation();
      const target = e.currentTarget.dataset.target;
      transitionIssueTo(issueId, target);
    });
    card.querySelector('[data-action="email-contractor"]')?.addEventListener('click', e => {
      e.stopPropagation();
      const issue = issues.find(i => i.id === issueId);
      if (issue) emailContractorAboutIssue(equipment, issue);
    });
    card.querySelector('[data-action="set-eta"]')?.addEventListener('click', e => {
      e.stopPropagation();
      promptIssueEta(issueId);
    });
    card.querySelector('[data-action="awaiting-parts"]')?.addEventListener('click', e => {
      e.stopPropagation();
      transitionIssueTo(issueId, 'awaiting_parts');
    });
  });
}

function renderIssueCard(issue) {
  const status = issue.status || 'reported';
  const currentIdx = ISSUE_TIMELINE_STEPS.indexOf(status);
  const isAwaitingParts = status === 'awaiting_parts';
  const isRepaired = status === 'repaired';

  // Timeline: 5 steps. Awaiting parts is a side-branch shown as a
  // tag below the timeline, not as a step in it.
  const timelineHTML = `
    <div class="eq-itracker-timeline">
      ${ISSUE_TIMELINE_STEPS.map((s, i) => {
        const reached = isRepaired ? true : (i <= currentIdx);
        const isCurrent = i === currentIdx && !isRepaired;
        const ts = reached ? eqIssueFmtTs(eqIssueTsForStatus(issue, s)) : '';
        const cls = ['eq-itracker-tl-step'];
        if (reached) cls.push('is-reached');
        if (isCurrent) cls.push('is-current');
        return `
          <div class="${cls.join(' ')}">
            <div class="eq-itracker-tl-marker" aria-hidden="true">
              ${reached
                ? '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                : ''}
            </div>
            <div class="eq-itracker-tl-text">
              <div class="eq-itracker-tl-label">${esc(ISSUE_LIFECYCLE_LABELS[s])}</div>
              ${ts ? `<div class="eq-itracker-tl-ts">${esc(ts)}</div>` : ''}
            </div>
          </div>
          ${i < ISSUE_TIMELINE_STEPS.length - 1 ? `<div class="eq-itracker-tl-bar ${i < currentIdx || isRepaired ? 'is-reached' : ''}"></div>` : ''}
        `;
      }).join('')}
    </div>
    ${isAwaitingParts ? `
      <div class="eq-itracker-side-tag">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Awaiting parts since ${esc(eqIssueFmtTs(issue.awaiting_parts_at))}</span>
      </div>
    ` : ''}
  `;

  // Action buttons depend on current state.
  let actionsHTML = '';
  if (!isRepaired) {
    const nextStep = ISSUE_TIMELINE_STEPS[currentIdx + 1];
    const buttons = [];

    if (nextStep) {
      buttons.push(`<button class="eq-itracker-act-btn eq-itracker-act-advance" data-action="advance" data-target="${esc(nextStep)}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="20 6 9 17 4 12"/></svg>
        Mark ${esc(ISSUE_LIFECYCLE_LABELS[nextStep].toLowerCase())}
      </button>`);
    }

    // ETA button — only meaningful at contractor_called or eta_set.
    if (status === 'contractor_called' || status === 'eta_set') {
      buttons.push(`<button class="eq-itracker-act-btn eq-itracker-act-eta" data-action="set-eta">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${issue.eta_at ? 'Update ETA' : 'Set ETA'}
      </button>`);
    }

    // Awaiting-parts toggle — available once in_progress.
    if (status === 'in_progress' && !isAwaitingParts) {
      buttons.push(`<button class="eq-itracker-act-btn eq-itracker-act-parts" data-action="awaiting-parts">
        Mark awaiting parts
      </button>`);
    }
    if (status === 'awaiting_parts') {
      buttons.push(`<button class="eq-itracker-act-btn eq-itracker-act-advance" data-action="advance" data-target="in_progress">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="20 6 9 17 4 12"/></svg>
        Parts arrived — resume
      </button>`);
      // Also allow direct → repaired from awaiting_parts
      buttons.push(`<button class="eq-itracker-act-btn eq-itracker-act-advance" data-action="advance" data-target="repaired">
        Mark repaired
      </button>`);
    }

    // Email contractor — always available unless repaired.
    buttons.push(`<button class="eq-itracker-act-btn eq-itracker-act-email" data-action="email-contractor">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      Email contractor
    </button>`);

    actionsHTML = `<div class="eq-itracker-actions">${buttons.join('')}</div>`;
  }

  // ETA display (if set and not repaired).
  const etaHTML = (issue.eta_at && !isRepaired) ? `
    <div class="eq-itracker-eta">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>ETA: ${esc(eqIssueFmtTs(issue.eta_at))}</span>
    </div>
  ` : '';

  // Contractor name pill (if assigned).
  const contractorHTML = issue.contractor_name ? `
    <div class="eq-itracker-contractor">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span>${esc(issue.contractor_name)}</span>
    </div>
  ` : '';

  return `
    <div class="eq-itracker-issue-card${isRepaired ? ' is-repaired' : ''}" data-issue-id="${esc(issue.id)}">
      <div class="eq-itracker-issue-head">
        <div class="eq-itracker-issue-title">${esc(issue.title || '(untitled issue)')}</div>
        <div class="eq-itracker-issue-when">${esc(eqIssueFmtTs(issue.reported_at))}</div>
      </div>
      ${issue.description ? `<div class="eq-itracker-issue-desc">${esc(issue.description)}</div>` : ''}
      ${contractorHTML}
      ${etaHTML}
      ${timelineHTML}
      ${actionsHTML}
    </div>
  `;
}

/** Prompt for a new issue title + description, then insert at status 'reported'. */
async function promptNewIssue(equipment) {
  // In-app sheet instead of window.prompt(): native prompt()/confirm() are
  // suppressed in installed PWAs and on mobile browsers, which made "Report a
  // new issue" silently do nothing. A real form always works.
  const prior = document.querySelector('.eq-issue-newsheet');
  if (prior) prior.remove();
  const sheet = document.createElement('div');
  sheet.className = 'eq-issue-newsheet';
  sheet.innerHTML = `
    <div class="eq-issue-newsheet-backdrop"></div>
    <div class="eq-issue-newsheet-card" role="dialog" aria-modal="true" aria-label="Report an issue">
      <div class="eq-issue-newsheet-title">Report an issue</div>
      <div class="eq-issue-newsheet-sub">${esc(equipment.name || 'Equipment')}${equipment.location ? ' · ' + esc(equipment.location) : ''}</div>
      <label class="eq-issue-newsheet-label" for="eqIssueTitle">What's wrong?</label>
      <input class="eq-issue-newsheet-input" id="eqIssueTitle" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Won't cool below 45F">
      <label class="eq-issue-newsheet-label" for="eqIssueDesc">Details (optional)</label>
      <textarea class="eq-issue-newsheet-textarea" id="eqIssueDesc" rows="3" placeholder="What were you doing when it started? Error codes, sounds, smells?"></textarea>
      <label class="eq-issue-newsheet-label">Severity</label>
      <div class="eq-issue-newsheet-pri" id="eqIssuePri">
        <button type="button" data-pri="low">Low</button>
        <button type="button" data-pri="normal" class="active">Normal → needs service</button>
        <button type="button" data-pri="urgent">Urgent → DOWN</button>
      </div>
      <div class="eq-issue-newsheet-actions">
        <button type="button" class="eq-issue-newsheet-btn" data-action="cancel">Cancel</button>
        <button type="button" class="eq-issue-newsheet-btn is-primary" data-action="save">Report issue</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  // Severity → equipment status is AUTOMATIC now (Alfredo: "workorder…
  // automatically changes equipment status"): urgent bumps to DOWN,
  // normal to NEEDS SERVICE, low leaves status alone. Upgrade-only.
  let issuePriority = 'normal';
  sheet.querySelectorAll('#eqIssuePri button').forEach(b => b.addEventListener('click', () => {
    issuePriority = b.dataset.pri;
    sheet.querySelectorAll('#eqIssuePri button').forEach(x => x.classList.toggle('active', x === b));
  }));
  const titleEl = sheet.querySelector('#eqIssueTitle');
  const descEl  = sheet.querySelector('#eqIssueDesc');
  const saveBtn = sheet.querySelector('[data-action="save"]');
  const close = () => { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); };
  setTimeout(() => { try { titleEl.focus(); } catch (_) {} }, 60);
  sheet.querySelector('.eq-issue-newsheet-backdrop').addEventListener('click', close);
  sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);
  titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } });
  titleEl.addEventListener('input', () => titleEl.classList.remove('is-error'));

  saveBtn.addEventListener('click', async () => {
    const title = (titleEl.value || '').trim();
    if (!title) { titleEl.classList.add('is-error'); titleEl.focus(); return; }
    const description = (descEl.value || '').trim() || null;
    saveBtn.disabled = true; saveBtn.textContent = 'Reporting…';
    const payload = {
      equipment_id:     equipment.id,
      title,
      description,
      status:           'reported',
      priority:         issuePriority,
      reported_at:      new Date().toISOString(),
      reported_by:      (NX.currentUser && NX.currentUser.id) || (NX.user && NX.user.id) || null,
      reported_by_name: (NX.currentUser && NX.currentUser.name) || (NX.user && NX.user.name) || null,
    };
    try {
      const { data, error } = await NX.sb.from('equipment_issues').insert(payload).select('*').single();
      if (error) throw error;
      close();
      if (issueTrackerState) { issueTrackerState.issues.unshift(data); renderIssueTracker(); }
      NX.toast && NX.toast('Work order created', 'success', 1500);
      // AUTOMATIC status change from severity (upgrade-only: never
      // downgrades a unit that's already worse than the report implies).
      if (issuePriority === 'urgent' || issuePriority === 'normal') {
        try {
          const desired = issuePriority === 'urgent' ? 'down' : 'needs_service';
          const cur = (equipment.status || 'operational');
          const rank = { operational: 0, needs_service: 1, down: 2 };
          if ((rank[desired] || 0) > (rank[cur] != null ? rank[cur] : 0)) {
            await NX.sb.from('equipment').update({ status: desired }).eq('id', equipment.id);
            logEquipmentEvent({
              equipmentId: equipment.id,
              eventType: 'status_change',
              location: equipment.location || null,
              payload: {
                from: cur, to: desired,
                from_label: STATUSES.find(s => s.key === cur)?.label || cur,
                to_label:   STATUSES.find(s => s.key === desired)?.label || desired,
                equipment_name: equipment.name,
                source: 'issue_report',
                ticket_priority: issuePriority,
              },
            });
            NX.toast && NX.toast(`${equipment.name}: ${desired === 'down' ? 'Down' : 'Needs Service'}`, 'info', 1600);
          }
        } catch (e) { console.warn('[promptNewIssue] auto status failed (non-fatal):', e); }
      }
      // Board ticket, linked by the issue: label (moves lanes with the WO).
      if (NX.domain && NX.domain.recordEquipmentIssue) {
        try {
          await NX.domain.recordEquipmentIssue({ issueId: data.id, equipmentId: data.equipment_id, title: data.title, description: data.description, priority: issuePriority === 'urgent' ? 'urgent' : 'high' });
        } catch (e) { console.warn('[promptNewIssue] domain hook failed (non-fatal):', e); }
      }
    } catch (e) {
      console.error('[equipment] promptNewIssue:', e);
      saveBtn.disabled = false; saveBtn.textContent = 'Report issue';
      const msg = (e.message || '') + '';
      if (/relation.*does not exist|table.*does not exist/i.test(msg)) {
        NX.toast && NX.toast('Issue tracker needs a DB migration', 'warn', 3000);
      } else {
        NX.toast && NX.toast('Could not save: ' + msg, 'error');
      }
    }
  });
}

/** Transition an issue forward in the lifecycle. */
async function transitionIssueTo(issueId, newStatus) {
  if (!NX.sb || !issueId) return;
  if (!ISSUE_LIFECYCLE.includes(newStatus)) return;

  const stamp = new Date().toISOString();
  const update = { status: newStatus };
  switch (newStatus) {
    case 'contractor_called': update.contractor_called_at = stamp; break;
    case 'eta_set':           update.eta_set_at           = stamp; break;
    case 'in_progress':       update.in_progress_at       = stamp; break;
    case 'awaiting_parts':    update.awaiting_parts_at    = stamp; break;
    case 'repaired':          update.repaired_at          = stamp; break;
  }

  const { error } = await NX.sb.from('equipment_issues')
    .update(update).eq('id', issueId);
  if (error) {
    console.error('[equipment] transitionIssueTo:', error);
    NX.toast && NX.toast('Could not update: ' + (error.message || ''), 'error');
    return;
  }
  if (issueTrackerState) {
    const i = issueTrackerState.issues.find(x => x.id === issueId);
    if (i) Object.assign(i, update);
    renderIssueTracker();
  }
  NX.toast && NX.toast(`Marked ${ISSUE_LIFECYCLE_LABELS[newStatus]}`, 'info', 1100);

  // ── DOMAIN ORCHESTRATION ────────────────────────────────────────
  // Propose an equipment.status change. The domain layer decides
  // what makes sense (e.g., 'repaired' + no other open issues →
  // propose 'operational'). User confirms before any flip happens.
  // Restricted to operational/needs_service/down — never touches
  // loaned/relocated/missing/retired/broken.
  if (NX.domain?.transitionEquipmentIssue) {
    // Re-fire through the domain transition to get the proposal.
    // (We already did the DB write above for legacy reasons; the
    // domain version is idempotent — setting status to the same value
    // with a fresh timestamp is fine.)
    try {
      const res = await NX.domain.transitionEquipmentIssue({ issueId, newStatus });
      if (res.statusProposal) {
        const p = res.statusProposal;
        const STATUS_LABEL = { operational: 'Operational', needs_service: 'Needs Service', down: 'Down' };
        const _q = `${p.reason}\n\nMark ${p.equipmentName} as ${STATUS_LABEL[p.suggestedStatus]}?\n(currently: ${STATUS_LABEL[p.currentStatus] || p.currentStatus})`;
        const _ok = (typeof NX.confirm === 'function') ? await NX.confirm(_q) : window.confirm(_q);
        if (_ok) {
          const did = await NX.domain.applyEquipmentStatusChange({
            equipmentId: p.equipmentId, newStatus: p.suggestedStatus,
          });
          if (did) NX.toast?.(`${p.equipmentName}: ${STATUS_LABEL[p.suggestedStatus]}`, 'success', 1300);
        }
      }
    } catch (e) {
      console.warn('[equipment] domain transition proposal failed (non-fatal):', e);
    }
  }
}

/** Prompt for ETA datetime then save it on the issue. */
async function promptIssueEta(issueId) {
  // In-app sheet with a real datetime picker. Native prompt() is suppressed in
  // installed PWAs, which made "Set ETA" silently do nothing — and a date
  // picker beats parsing "tomorrow 2pm" anyway. Reuses the .eq-issue-newsheet CSS.
  const issue = issueTrackerState?.issues.find(i => i.id === issueId);
  const prior = document.querySelector('.eq-issue-newsheet');
  if (prior) prior.remove();
  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = d => (d && !isNaN(d))
    ? (d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()))
    : '';
  // Default: existing ETA, else tomorrow 9am.
  let def;
  if (issue && issue.eta_at) { def = new Date(issue.eta_at); }
  else { def = new Date(); def.setDate(def.getDate() + 1); def.setHours(9, 0, 0, 0); }

  const sheet = document.createElement('div');
  sheet.className = 'eq-issue-newsheet';
  sheet.innerHTML = `
    <div class="eq-issue-newsheet-backdrop"></div>
    <div class="eq-issue-newsheet-card" role="dialog" aria-modal="true" aria-label="Set contractor ETA">
      <div class="eq-issue-newsheet-title">Contractor ETA</div>
      <div class="eq-issue-newsheet-sub">When is the contractor coming?</div>
      <label class="eq-issue-newsheet-label" for="eqEtaInput">Date &amp; time</label>
      <input class="eq-issue-newsheet-input" id="eqEtaInput" type="datetime-local" value="${escAttr(toLocalInput(def))}">
      <div class="eq-issue-newsheet-actions">
        <button type="button" class="eq-issue-newsheet-btn" data-action="cancel">Cancel</button>
        <button type="button" class="eq-issue-newsheet-btn is-primary" data-action="save">Save ETA</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  const inp = sheet.querySelector('#eqEtaInput');
  const saveBtn = sheet.querySelector('[data-action="save"]');
  const close = () => { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); };
  setTimeout(() => { try { inp.focus(); } catch (_) {} }, 60);
  sheet.querySelector('.eq-issue-newsheet-backdrop').addEventListener('click', close);
  sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);
  inp.addEventListener('input', () => inp.classList.remove('is-error'));

  saveBtn.addEventListener('click', async () => {
    const parsed = inp.value ? new Date(inp.value) : null;
    if (!parsed || isNaN(parsed.getTime())) { inp.classList.add('is-error'); inp.focus(); return; }
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const update = { eta_at: parsed.toISOString() };
    if (issue && issue.status === 'contractor_called') {
      update.status = 'eta_set';
      update.eta_set_at = new Date().toISOString();
    }
    const { error } = await NX.sb.from('equipment_issues').update(update).eq('id', issueId);
    if (error) {
      console.error('[equipment] promptIssueEta:', error);
      saveBtn.disabled = false; saveBtn.textContent = 'Save ETA';
      NX.toast && NX.toast('Could not save ETA: ' + (error.message || ''), 'error');
      return;
    }
    close();
    if (issue) Object.assign(issue, update);
    renderIssueTracker();
    // ETA set → the board card follows to In Progress.
    if (update.status) { try { NX.domain?.syncIssueCardList?.(issueId, update.status); } catch (_) {} }
    NX.toast && NX.toast('ETA saved', 'success', 1200);
  });
}

/**
 * Compose an email to the contractor about this issue. Pulls preferred
 * contractor from equipment.service_contractor_node_id (existing field).
 * Pre-fills subject + body modeled on the order REPORT ISSUES email.
 */
async function emailContractorAboutIssue(equipment, issue) {
  if (!NX.sb) return;

  // Look up preferred contractor.
  let contractor = null;
  if (equipment.service_contractor_node_id) {
    // Try fetching with the template columns; fall back if they don't exist.
    let res = await NX.sb.from('nodes')
      .select('id, name, links, notes, subject_template, body_template')
      .eq('id', equipment.service_contractor_node_id).maybeSingle();
    if (res.error && /column.*(subject_template|body_template).*does not exist/i.test(res.error.message || '')) {
      res = await NX.sb.from('nodes')
        .select('id, name, links, notes')
        .eq('id', equipment.service_contractor_node_id).maybeSingle();
    }
    contractor = res.data;
  }

  // Pull all emails with their roles. Falls back to extracting from notes
  // if the structured links column has no email entries.
  const emailRows = extractContractorEmails(contractor || {});
  let toList  = emailRows.filter(e => e.role === 'to').map(e => e.email);
  const ccList  = emailRows.filter(e => e.role === 'cc').map(e => e.email);
  const bccList = emailRows.filter(e => e.role === 'bcc').map(e => e.email);

  // If no emails are explicitly tagged TO but at least one email exists,
  // promote the first one — better than sending to nobody.
  if (!toList.length && emailRows.length) {
    toList = [emailRows[0].email];
  }
  const contractorEmail = toList[0] || '';
  let contractorName = contractor?.name || '';

  const restaurant = equipment.location || '';
  const area = equipment.area ? ` (${equipment.area})` : '';
  const userName = NX.user?.name || NX.currentUser?.name || '';
  const greeting = (contractorName || '').split(' ')[0] || 'there';
  const unitLine = [equipment.manufacturer, equipment.model].filter(Boolean).join(' ');
  const reported = new Date(issue.reported_at).toLocaleString();

  // Token substitution table — used if the contractor has a saved template.
  // Tokens are case-sensitive and use {curly_braces} so they're easy to
  // spot in a saved template and don't collide with email punctuation.
  const tokens = {
    contractor:    contractorName || 'there',
    greeting,
    equipment:     equipment.name || '',
    location:      restaurant,
    area:          equipment.area || '',
    issue:         issue.title || '',
    issue_details: issue.description || '',
    unit:          unitLine,
    serial:        equipment.serial_number || '',
    me:            userName,
    reported,
  };
  const applyTokens = (s) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (tokens[k] != null ? tokens[k] : ''));

  // Subject: use saved template if present, otherwise the built-in default.
  const subject = contractor?.subject_template
    ? applyTokens(contractor.subject_template)
    : `Service request — ${equipment.name}${restaurant ? ' at ' + restaurant : ''}${issue.title ? ' (' + issue.title + ')' : ''}`;

  // Body: use saved template if present, otherwise the built-in default.
  const body = contractor?.body_template
    ? applyTokens(contractor.body_template)
    :
`Hi ${greeting},

${userName ? `${userName} here from ` : ''}${restaurant}. We have an issue with our ${equipment.name}${area}.

  • Issue: ${issue.title || '(see details below)'}
${issue.description ? `  • Details: ${issue.description}\n` : ''}${equipment.manufacturer || equipment.model ? `  • Unit: ${unitLine}\n` : ''}${equipment.serial_number ? `  • Serial: ${equipment.serial_number}\n` : ''}
Reported: ${reported}

When can you take a look? Reply with an ETA and we'll be ready for you.

Thanks for your help.`;

  // Build mailto: URL — handle multiple TO + CC + BCC. Empty contractor
  // email still opens compose so the user can paste an address.
  const enc = s => encodeURIComponent(s || '').replace(/\+/g, '%20');
  const params = [];
  if (ccList.length)  params.push(`cc=${enc(ccList.join(','))}`);
  if (bccList.length) params.push(`bcc=${enc(bccList.join(','))}`);
  params.push(`subject=${enc(subject)}`);
  params.push(`body=${enc(body)}`);
  const toRecipients = toList.length ? toList.join(',') : '';
  const url = `mailto:${enc(toRecipients)}?${params.join('&')}`;

  if (!contractorEmail) {
    NX.toast && NX.toast(contractorName
      ? `No email on file for ${contractorName} — opening blank compose`
      : 'No preferred contractor set — opening blank compose', 'warn', 2200);
  }

  // Auto-advance status to contractor_called if at reported.
  if (issue.status === 'reported') {
    transitionIssueTo(issue.id, 'contractor_called');
  }

  window.location.href = url;
}

/* ════════════════════════════════════════════════════════════════════════════
   16. BULK OPERATIONS — assign contractor / PM date to many at once
   ════════════════════════════════════════════════════════════════════════════
   Multi-select toolbar that appears at the bottom of the equipment list
   when one or more items are selected. From there:

     • "Assign contractor"  — pick a contractor, autofills phone too
     • "Schedule PM"        — pick a date, applies to all selected
     • "Set status"         — quick batch status change

   Selection mode is entered via long-press on a row (mobile-friendly)
   or a "Select" button in the equipment header. Once in selection mode,
   tapping rows toggles their inclusion. The list rows show a checkbox
   marker on the left.
   ════════════════════════════════════════════════════════════════════════════ */

let bulkSelectionState = {
  active: false,
  selected: new Set(),  // equipment ids
};

function toggleBulkSelection(equipmentId) {
  if (!equipmentId) return;
  if (bulkSelectionState.selected.has(equipmentId)) {
    bulkSelectionState.selected.delete(equipmentId);
  } else {
    bulkSelectionState.selected.add(equipmentId);
  }
  renderBulkToolbar();
  // Mark the row visually (the renderList path doesn't know about
  // selection, so we toggle a class manually).
  const row = document.querySelector(`[data-eq-id="${equipmentId}"]`);
  if (row) row.classList.toggle('is-selected', bulkSelectionState.selected.has(equipmentId));
}

function enterBulkMode() {
  bulkSelectionState.active = true;
  bulkSelectionState.selected = new Set();
  document.body.classList.add('eq-bulk-mode');
  renderBulkToolbar();
}

function exitBulkMode() {
  bulkSelectionState.active = false;
  bulkSelectionState.selected = new Set();
  document.body.classList.remove('eq-bulk-mode');
  // Drop is-selected classes from any rows that had them.
  document.querySelectorAll('[data-eq-id].is-selected').forEach(el => {
    el.classList.remove('is-selected');
  });
  const tb = document.getElementById('eqBulkToolbar');
  if (tb) tb.remove();
}

function renderBulkToolbar() {
  const existing = document.getElementById('eqBulkToolbar');
  const count = bulkSelectionState.selected.size;
  if (!bulkSelectionState.active) {
    if (existing) existing.remove();
    return;
  }
  if (existing) existing.remove();

  const tb = document.createElement('div');
  tb.id = 'eqBulkToolbar';
  tb.className = 'eq-bulk-toolbar';
  tb.innerHTML = `
    <div class="eq-bulk-toolbar-count">
      <strong>${count}</strong> selected
    </div>
    <div class="eq-bulk-toolbar-actions">
      <button class="eq-bulk-btn eq-bulk-btn-secondary" data-action="contractor" ${count === 0 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Assign contractor
      </button>
      <button class="eq-bulk-btn eq-bulk-btn-secondary" data-action="pm" ${count === 0 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Schedule PM
      </button>
      <button class="eq-bulk-btn eq-bulk-btn-cancel" data-action="exit">Done</button>
    </div>
  `;
  document.body.appendChild(tb);

  tb.querySelector('[data-action="exit"]').addEventListener('click', exitBulkMode);
  tb.querySelector('[data-action="contractor"]').addEventListener('click', () => {
    if (count > 0) openBulkContractorAssign();
  });
  tb.querySelector('[data-action="pm"]').addEventListener('click', () => {
    if (count > 0) openBulkPmSchedule();
  });
}

/** Bottom sheet listing all contractor nodes; tap one to assign to the selected equipment. */
async function openBulkContractorAssign() {
  if (!NX.sb || !bulkSelectionState.selected.size) return;

  // Load contractor nodes.
  const { data: contractors } = await NX.sb.from('nodes')
    .select('id, name, links, notes')
    .eq('category', 'contractors')
    .order('name', { ascending: true });

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.innerHTML = `
    <div class="eq-bulk-sheet-backdrop"></div>
    <div class="eq-bulk-sheet">
      <div class="eq-bulk-sheet-handle"></div>
      <div class="eq-bulk-sheet-title">Assign contractor to ${bulkSelectionState.selected.size} equipment</div>
      <div class="eq-bulk-sheet-sub">This will also auto-fill the service phone from the contractor's record.</div>
      <div class="eq-bulk-sheet-list">
        ${(contractors || []).map(c => `
          <button class="eq-bulk-sheet-item" data-id="${esc(c.id)}">
            <div class="eq-bulk-sheet-item-name">${esc(c.name)}</div>
            ${c.notes ? `<div class="eq-bulk-sheet-item-sub">${esc((c.notes || '').slice(0, 60))}</div>` : ''}
          </button>
        `).join('') || '<div class="eq-bulk-sheet-empty">No contractors saved yet. Add some via the Address Book first.</div>'}
      </div>
      <button class="eq-bulk-sheet-cancel" data-action="cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

  overlay.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const contractorId = btn.dataset.id;
      const contractor = contractors.find(c => c.id == contractorId);
      if (!contractor) return;

      // Extract phone from contractor record.
      let phone = '';
      if (contractor.links) {
        const links = Array.isArray(contractor.links) ? contractor.links : [contractor.links];
        for (const l of links) {
          const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
          const match = str.match(/(?:tel:)?(\+?[\d\s().-]{7,})/);
          if (match) { phone = match[1].trim(); break; }
        }
      }
      if (!phone && contractor.notes) {
        const match = contractor.notes.match(/(\+?[\d\s().-]{10,})/);
        if (match) phone = match[1].trim();
      }

      // Bulk update — vendor era. The picker picks a contractor NODE, so
      // resolve (or create) the matching vendors row by company name and link
      // THAT, same as the single-assign flow. Writing the retired node-era
      // column here was the last writer keeping the old generation alive.
      const ids = Array.from(bulkSelectionState.selected);
      const update = {};
      if (phone) update.service_contractor_phone = phone;
      if (contractor.name) update.service_contractor_name = contractor.name;
      try {
        let { data: v } = await NX.sb.from('vendors')
          .select('id').ilike('company', contractor.name || '').maybeSingle();
        if (!v && contractor.name) {
          const ins = await NX.sb.from('vendors')
            .insert({ company: contractor.name, active: true }).select('id').single();
          v = ins.data;
        }
        if (v && v.id) {
          update.service_vendor_id = v.id;
          update.service_contractor_node_id = null;   // node era retired
        }
      } catch (mapErr) {
        console.warn('[equipment] bulk assign: vendor mapping failed, name/phone only', mapErr);
      }

      try {
        const { error } = await NX.sb.from('equipment')
          .update(update).in('id', ids);
        if (error) throw error;
        NX.toast && NX.toast(`Assigned ${contractor.name} to ${ids.length} equipment`, 'success', 1800);
        close();
        exitBulkMode();
        // Refresh the list view if the equipment module exposes loadEquipment.
        if (typeof loadEquipment === 'function') await loadEquipment();
        if (typeof renderList === 'function') renderList();
      } catch (e) {
        console.error('[equipment] bulkContractorAssign:', e);
        NX.toast && NX.toast('Could not update: ' + (e.message || ''), 'error');
      }
    });
  });
}

/** Bottom sheet with date picker for bulk PM scheduling. */
function openBulkPmSchedule() {
  if (!bulkSelectionState.selected.size) return;

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  // Default suggested date: 90 days from today.
  const defaultDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  overlay.innerHTML = `
    <div class="eq-bulk-sheet-backdrop"></div>
    <div class="eq-bulk-sheet">
      <div class="eq-bulk-sheet-handle"></div>
      <div class="eq-bulk-sheet-title">Schedule PM for ${bulkSelectionState.selected.size} equipment</div>
      <div class="eq-bulk-sheet-sub">All selected equipment will get this same next-PM date. Use the bulk-contractor option separately to assign who's doing the work.</div>
      <div class="eq-bulk-pm-form">
        <label class="eq-bulk-pm-label" for="eqBulkPmDate">Next PM date</label>
        <input type="date" class="eq-bulk-pm-input" id="eqBulkPmDate" value="${defaultDate}">
        <div class="eq-bulk-pm-presets">
          <button class="eq-bulk-pm-preset" data-days="30">30 days</button>
          <button class="eq-bulk-pm-preset" data-days="60">60 days</button>
          <button class="eq-bulk-pm-preset" data-days="90">90 days</button>
          <button class="eq-bulk-pm-preset" data-days="180">6 months</button>
          <button class="eq-bulk-pm-preset" data-days="365">1 year</button>
        </div>
      </div>
      <button class="eq-bulk-sheet-confirm" data-action="confirm">Apply to ${bulkSelectionState.selected.size} equipment</button>
      <button class="eq-bulk-sheet-cancel" data-action="cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

  // Preset chips just adjust the date input.
  const dateInput = overlay.querySelector('#eqBulkPmDate');
  overlay.querySelectorAll('.eq-bulk-pm-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days, 10);
      const d = new Date(Date.now() + days * 86400000);
      dateInput.value = d.toISOString().slice(0, 10);
    });
  });

  overlay.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date) {
      NX.toast && NX.toast('Pick a date first', 'warn');
      return;
    }
    const ids = Array.from(bulkSelectionState.selected);
    try {
      const { error } = await NX.sb.from('equipment')
        .update({ next_pm_date: date }).in('id', ids);
      if (error) throw error;
      NX.toast && NX.toast(`PM scheduled for ${ids.length} equipment`, 'success', 1800);
      close();
      exitBulkMode();
      if (typeof loadEquipment === 'function') await loadEquipment();
      if (typeof renderList === 'function') renderList();
    } catch (e) {
      console.error('[equipment] bulkPmSchedule:', e);
      NX.toast && NX.toast('Could not update: ' + (e.message || ''), 'error');
    }
  });
}


/* ════════════════════════════════════════════════════════════════════════════
   17. MANUFACTURERS — brand library with shared logos across equipment
   ════════════════════════════════════════════════════════════════════════════
   One manufacturer record per brand (Hoshizaki, True, Vulcan, Welbilt, etc.)
   carrying name, logo, and avatar hue. All equipment sharing that brand
   render the same logo — change the logo once, every Hoshizaki unit in the
   fleet updates.

   Mirrors the vendor avatar pattern from ordering.js exactly. Three render
   modes, in priority order:
     1. Image-mode  — manufacturer.logo_url is set, render as background-image
     2. Hue mode    — manufacturer.avatar_hue is set, render colored initial
     3. Auto mode   — hash the brand name to derive a deterministic color

   Auto-link on save:
     When equipment is saved with a manufacturer text value that doesn't
     match an existing manufacturer record, auto-create a record. Returns
     the manufacturer_id which gets stamped onto the equipment row. This
     means the user gets brand-coherent rendering automatically without
     having to populate a brand library upfront.

   Brand library UI:
     Accessed via a button in the equipment header. Lists all manufacturers
     with their logos + names, lets the user upload/replace logos and pick
     hue overrides. Same patterns as the vendor editor.
   ════════════════════════════════════════════════════════════════════════════ */

let manufacturersCache = null;
let manufacturersCacheById = {};
let manufacturersCacheByName = {};

/**
 * Load all manufacturers and warm caches. Returns the array. Idempotent —
 * subsequent calls return the cached array unless force=true.
 */
async function loadManufacturers(force) {
  if (manufacturersCache && !force) return manufacturersCache;
  if (!NX.sb) return [];
  const { data, error } = await NX.sb.from('manufacturers')
    .select('id, name, logo_url, avatar_hue, notes')
    .order('name', { ascending: true });
  if (error) {
    console.warn('[equipment] loadManufacturers:', error.message || error);
    manufacturersCache = [];
    return [];
  }
  manufacturersCache = data || [];
  manufacturersCacheById = {};
  manufacturersCacheByName = {};
  for (const m of manufacturersCache) {
    manufacturersCacheById[m.id] = m;
    manufacturersCacheByName[(m.name || '').toLowerCase()] = m;
  }
  return manufacturersCache;
}

/**
 * Resolve an equipment row's manufacturer record. Tries (in order):
 *   1. equipment.manufacturer_id → cache lookup
 *   2. equipment.manufacturer text → name-match in cache
 * Returns null if nothing matches.
 */
function resolveManufacturer(equipmentRow) {
  if (!equipmentRow) return null;
  if (equipmentRow.manufacturer_id && manufacturersCacheById[equipmentRow.manufacturer_id]) {
    return manufacturersCacheById[equipmentRow.manufacturer_id];
  }
  const text = (equipmentRow.manufacturer || '').toLowerCase().trim();
  if (text && manufacturersCacheByName[text]) {
    return manufacturersCacheByName[text];
  }
  return null;
}

/**
 * Render a manufacturer logo (or fallback initial avatar). Mirrors the
 * vendorAvatar pattern from ordering.js. Three sizes via the size param:
 *   'sm' → 28px (used in list rows)
 *   'md' → 48px (used in grid cards)
 *   'lg' → 96px (used in equipment detail)
 */
function manufacturerLogo(equipmentRow, size) {
  const m = resolveManufacturer(equipmentRow);
  const name = (m ? m.name : equipmentRow.manufacturer) || '';
  const logoUrl = m?.logo_url || '';
  const hueOverride = (typeof m?.avatar_hue === 'number') ? m.avatar_hue : null;
  const sizeCls = size === 'lg' ? 'eq-mfg-logo-lg'
                : size === 'md' ? 'eq-mfg-logo-md'
                : 'eq-mfg-logo-sm';

  if (logoUrl) {
    const safeAttr = logoUrl.replace(/"/g, '%22');
    return `<div class="eq-mfg-logo eq-mfg-logo-img ${sizeCls}" style="background-image:url(&quot;${safeAttr}&quot;)" role="img" aria-label="${esc(name)}"></div>`;
  }

  const clean = name.trim();
  const initial = clean.charAt(0).toUpperCase() || '?';
  let hue;
  if (typeof hueOverride === 'number') {
    hue = hueOverride;
  } else {
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
    }
    hue = Math.abs(hash) % 360;
  }
  return `<div class="eq-mfg-logo ${sizeCls}" style="--mfg-hue:${hue}">${esc(initial)}</div>`;
}

/**
 * Auto-link an equipment row's manufacturer text to a manufacturers
 * record, creating one if needed. Returns the manufacturer_id (or null
 * if creation failed / no manufacturer text was set).
 *
 * Called from save paths in the equipment editor so the brand library
 * gets populated organically as the user adds equipment, without them
 * having to manage it explicitly.
 */
async function autoLinkManufacturer(name) {
  if (!name || !name.trim() || !NX.sb) return null;
  const clean = name.trim();
  const key = clean.toLowerCase();

  // Make sure the cache is warm.
  if (!manufacturersCache) await loadManufacturers();

  // Existing match?
  if (manufacturersCacheByName[key]) {
    return manufacturersCacheByName[key].id;
  }

  // Create a fresh row.
  try {
    const { data, error } = await NX.sb.from('manufacturers')
      .insert({ name: clean })
      .select('*').single();
    if (error) throw error;
    if (data) {
      manufacturersCache.push(data);
      manufacturersCacheById[data.id] = data;
      manufacturersCacheByName[(data.name || '').toLowerCase()] = data;
      return data.id;
    }
  } catch (e) {
    console.warn('[equipment] autoLinkManufacturer:', e.message || e);
  }
  return null;
}

/* ─── Brand Library — manage logos for every manufacturer ────────── */

let brandLibraryState = null;

async function openBrandLibrary() {
  closeBrandLibrary();
  const overlay = document.createElement('div');
  overlay.className = 'eq-brand-lib-overlay';
  document.body.appendChild(overlay);
  brandLibraryState = { overlay, manufacturers: [], loading: true, editingId: null };
  renderBrandLibrary();

  try {
    const list = await loadManufacturers(true);
    if (!brandLibraryState || brandLibraryState.overlay !== overlay) return;
    brandLibraryState.manufacturers = list;
    brandLibraryState.loading = false;
    renderBrandLibrary();
  } catch (e) {
    console.error('[equipment] openBrandLibrary:', e);
    if (brandLibraryState) {
      brandLibraryState.loading = false;
      renderBrandLibrary();
    }
  }
}

function closeBrandLibrary() {
  if (!brandLibraryState) return;
  if (brandLibraryState.overlay && brandLibraryState.overlay.parentNode) {
    brandLibraryState.overlay.parentNode.removeChild(brandLibraryState.overlay);
  }
  brandLibraryState = null;
}

function renderBrandLibrary() {
  if (!brandLibraryState || !brandLibraryState.overlay) return;
  const { overlay, manufacturers, loading, editingId } = brandLibraryState;

  let bodyHTML;
  if (loading) {
    bodyHTML = `<div class="eq-brand-lib-loading">Loading brand library…</div>`;
  } else if (!manufacturers.length) {
    bodyHTML = `
      <div class="eq-brand-lib-empty">
        <div class="eq-brand-lib-empty-title">No brands yet</div>
        <div class="eq-brand-lib-empty-msg">Add equipment with a manufacturer name and they'll show up here automatically.</div>
      </div>`;
  } else {
    bodyHTML = manufacturers.map(m => renderBrandLibraryRow(m, m.id === editingId)).join('');
  }

  overlay.innerHTML = `
    <div class="eq-brand-lib-head">
      <button class="eq-brand-lib-close" aria-label="Close brand library">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="eq-brand-lib-head-text">
        <div class="eq-brand-lib-title">Brand Library</div>
        <div class="eq-brand-lib-sub">${manufacturers.length} ${manufacturers.length === 1 ? 'brand' : 'brands'} · upload logos to coordinate equipment cards</div>
      </div>
      <button class="eq-brand-lib-add" data-action="add-new" aria-label="Add new brand">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
    <div class="eq-brand-lib-body">
      ${bodyHTML}
    </div>
  `;

  overlay.querySelector('.eq-brand-lib-close').addEventListener('click', closeBrandLibrary);
  overlay.querySelector('[data-action="add-new"]').addEventListener('click', addNewBrand);

  manufacturers.forEach(m => {
    const row = overlay.querySelector(`[data-mfg-id="${m.id}"]`);
    if (!row) return;
    row.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
      brandLibraryState.editingId = (editingId === m.id) ? null : m.id;
      renderBrandLibrary();
    });
    if (m.id === editingId) {
      wireBrandRowEditor(row, m);
    }
  });
}

function renderBrandLibraryRow(m, isEditing) {
  const equipmentForBrand = equipment ? equipment.filter(e =>
    e.manufacturer_id === m.id ||
    (e.manufacturer || '').toLowerCase() === (m.name || '').toLowerCase()
  ).length : 0;

  const summary = `
    <div class="eq-brand-lib-row" data-mfg-id="${esc(m.id)}">
      <div class="eq-brand-lib-row-summary">
        ${manufacturerLogo({ manufacturer_id: m.id, manufacturer: m.name }, 'md')}
        <div class="eq-brand-lib-row-text">
          <div class="eq-brand-lib-row-name">${esc(m.name)}</div>
          <div class="eq-brand-lib-row-meta">${equipmentForBrand} ${equipmentForBrand === 1 ? 'unit' : 'units'} in fleet${m.logo_url ? ' · logo set' : ' · no logo'}</div>
        </div>
        <button class="eq-brand-lib-edit-btn" data-action="edit" aria-label="${isEditing ? 'Close editor' : 'Edit logo'}">
          ${isEditing
            ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>'
            : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'}
        </button>
      </div>
      ${isEditing ? renderBrandRowEditor(m) : ''}
    </div>
  `;
  return summary;
}

function renderBrandRowEditor(m) {
  return `
    <div class="eq-brand-lib-editor">
      <div class="eq-brand-lib-editor-photo">
        <button class="eq-brand-lib-photo-btn" data-action="upload" aria-label="Upload logo">
          ${manufacturerLogo({ manufacturer_id: m.id, manufacturer: m.name }, 'lg')}
          <span class="eq-brand-lib-photo-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </span>
        </button>
        <input type="file" class="eq-brand-lib-file" accept="image/*" hidden>
      </div>
      <div class="eq-brand-lib-editor-fields">
        <label class="eq-brand-lib-label">Logo URL <span class="eq-brand-lib-label-hint">— or upload via the photo button</span></label>
        <input type="url" class="eq-brand-lib-input eq-brand-lib-url" value="${esc(m.logo_url || '')}" placeholder="https://example.com/logo.png">
        <label class="eq-brand-lib-label">Avatar color <span class="eq-brand-lib-label-hint">— used when no logo is set</span></label>
        <div class="eq-brand-lib-hue-picker" data-selected="${typeof m.avatar_hue === 'number' ? m.avatar_hue : 'auto'}">
          <button type="button" class="eq-brand-lib-hue-swatch eq-brand-lib-hue-auto${typeof m.avatar_hue !== 'number' ? ' active' : ''}" data-hue="auto" aria-label="Auto">A</button>
          ${[15, 35, 55, 90, 130, 165, 200, 230, 265, 295, 325, 355].map(h =>
            `<button type="button" class="eq-brand-lib-hue-swatch${m.avatar_hue === h ? ' active' : ''}" data-hue="${h}" style="--mfg-hue:${h}" aria-label="Hue ${h}"></button>`
          ).join('')}
        </div>
        <div class="eq-brand-lib-editor-actions">
          <button class="eq-brand-lib-save-btn" data-action="save">Save</button>
          <button class="eq-brand-lib-remove-btn" data-action="remove-photo" ${m.logo_url ? '' : 'disabled'}>Remove logo</button>
        </div>
      </div>
    </div>
  `;
}

function wireBrandRowEditor(row, m) {
  const photoBtn = row.querySelector('.eq-brand-lib-photo-btn');
  const fileInput = row.querySelector('.eq-brand-lib-file');
  const urlInput = row.querySelector('.eq-brand-lib-url');
  const huePicker = row.querySelector('.eq-brand-lib-hue-picker');
  const saveBtn = row.querySelector('[data-action="save"]');
  const removeBtn = row.querySelector('[data-action="remove-photo"]');
  const previewImg = row.querySelector('.eq-brand-lib-photo-btn .eq-mfg-logo');

  // Tap photo button → file picker.
  photoBtn?.addEventListener('click', () => fileInput?.click());

  // File picker change → downscale + set URL.
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      NX.toast && NX.toast('Please pick an image file', 'warn');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      NX.toast && NX.toast('Image too large (12 MB max)', 'warn');
      return;
    }
    try {
      // Use the same downscale function the vendor editor uses, exposed
      // via the ordering module if available; otherwise inline a copy.
      const dataUrl = await downscaleEquipmentImage(file, 384, 0.85);
      urlInput.value = dataUrl;
      // Live preview update.
      if (previewImg) {
        previewImg.style.backgroundImage = `url("${dataUrl}")`;
        previewImg.classList.add('eq-mfg-logo-img');
        previewImg.textContent = '';
      }
      NX.toast && NX.toast('Logo set — tap Save to apply', 'info', 1500);
    } catch (err) {
      console.warn('[equipment] brand logo upload failed:', err);
      NX.toast && NX.toast('Could not process that image', 'error');
    }
  });

  // URL input live preview.
  urlInput?.addEventListener('input', () => {
    const url = urlInput.value.trim();
    if (previewImg) {
      if (url) {
        previewImg.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
        previewImg.classList.add('eq-mfg-logo-img');
        previewImg.textContent = '';
      } else {
        previewImg.style.backgroundImage = '';
        previewImg.classList.remove('eq-mfg-logo-img');
        previewImg.textContent = (m.name || '?').charAt(0).toUpperCase();
      }
    }
  });

  // Hue picker.
  huePicker?.querySelectorAll('.eq-brand-lib-hue-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      huePicker.querySelectorAll('.eq-brand-lib-hue-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      huePicker.dataset.selected = btn.dataset.hue;
      // Live preview if no logo is set.
      if (!urlInput.value.trim() && previewImg) {
        const hue = btn.dataset.hue === 'auto' ? null : parseInt(btn.dataset.hue, 10);
        if (typeof hue === 'number') {
          previewImg.style.setProperty('--mfg-hue', hue);
        } else {
          let h = 0;
          for (let i = 0; i < (m.name || '').length; i++) h = ((h << 5) - h + m.name.charCodeAt(i)) | 0;
          previewImg.style.setProperty('--mfg-hue', Math.abs(h) % 360);
        }
      }
    });
  });

  saveBtn?.addEventListener('click', () => saveBrandRow(m, row));
  removeBtn?.addEventListener('click', () => removeBrandLogo(m));
}

async function saveBrandRow(m, row) {
  if (!NX.sb) return;
  const urlInput = row.querySelector('.eq-brand-lib-url');
  const huePicker = row.querySelector('.eq-brand-lib-hue-picker');
  const url = urlInput?.value.trim() || null;
  let avatarHue = null;
  if (huePicker) {
    const sel = huePicker.dataset.selected;
    if (sel && sel !== 'auto') {
      const n = Number(sel);
      if (Number.isFinite(n) && n >= 0 && n < 360) avatarHue = n;
    }
  }
  try {
    const { error } = await NX.sb.from('manufacturers')
      .update({ logo_url: url, avatar_hue: avatarHue })
      .eq('id', m.id);
    if (error) throw error;
    Object.assign(m, { logo_url: url, avatar_hue: avatarHue });
    manufacturersCacheById[m.id] = m;
    manufacturersCacheByName[(m.name || '').toLowerCase()] = m;
    NX.toast && NX.toast('Brand updated — equipment cards will reflect on next refresh', 'success', 1800);
    brandLibraryState.editingId = null;
    renderBrandLibrary();
    // Refresh the equipment list if visible.
    if (typeof renderList === 'function') renderList();
  } catch (e) {
    console.error('[equipment] saveBrandRow:', e);
    NX.toast && NX.toast('Could not save: ' + (e.message || ''), 'error');
  }
}

async function removeBrandLogo(m) {
  if (!NX.sb) return;
  if (!confirm(`Remove logo for ${m.name}?`)) return;
  try {
    const { error } = await NX.sb.from('manufacturers')
      .update({ logo_url: null }).eq('id', m.id);
    if (error) throw error;
    m.logo_url = null;
    manufacturersCacheById[m.id] = m;
    manufacturersCacheByName[(m.name || '').toLowerCase()] = m;
    NX.toast && NX.toast('Logo removed', 'info', 1100);
    renderBrandLibrary();
    if (typeof renderList === 'function') renderList();
  } catch (e) {
    console.error('[equipment] removeBrandLogo:', e);
    NX.toast && NX.toast('Could not remove: ' + (e.message || ''), 'error');
  }
}

async function addNewBrand() {
  const name = prompt('Manufacturer name:');
  if (!name || !name.trim()) return;
  try {
    const { data, error } = await NX.sb.from('manufacturers')
      .insert({ name: name.trim() }).select('*').single();
    if (error) throw error;
    if (data) {
      manufacturersCache.push(data);
      manufacturersCacheById[data.id] = data;
      manufacturersCacheByName[(data.name || '').toLowerCase()] = data;
      brandLibraryState.manufacturers = manufacturersCache.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      brandLibraryState.editingId = data.id;     // open the editor immediately
      renderBrandLibrary();
      NX.toast && NX.toast('Brand added — upload a logo now', 'info', 1500);
    }
  } catch (e) {
    console.error('[equipment] addNewBrand:', e);
    NX.toast && NX.toast('Could not add brand: ' + (e.message || ''), 'error');
  }
}

/**
 * Same downscale-to-square algorithm as the vendor editor uses. Inlined
 * here so equipment doesn't have to depend on the ordering module.
 */
function downscaleEquipmentImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const sz = Math.min(img.width, img.height);
          const sx = (img.width  - sz) / 2;
          const sy = (img.height - sz) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = maxDim;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, maxDim, maxDim);
          ctx.drawImage(img, sx, sy, sz, sz, 0, 0, maxDim, maxDim);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}


/* ════════════════════════════════════════════════════════════════════════════
   18. ANALYTICS — brand health, failure patterns, warranty roster, digest
   ════════════════════════════════════════════════════════════════════════════
   The "best-in-market" pillar. Four cohesive subsystems sharing data:

     1. BRAND HEALTH   — per-manufacturer dashboard (units, %op, $YTD, MTBF)
     2. FAILURE PATTERNS — cross-fleet failure clustering with PM nudges
     3. WARRANTY ROSTER — units with warranty expiring in 30/60/90 days
     4. WEEKLY DIGEST  — owner-ready summary email of the operation

   All four share a single "fleet snapshot" computation that runs once
   per analytics open. Sub-views render off the same data — no
   redundant queries, no inconsistency between views.

   Open via: NX.modules.equipment.openAnalytics()
   Subnav:   Brand Health · Patterns · Warranty · Digest
   ════════════════════════════════════════════════════════════════════════════ */

let analyticsState = null;

const ANALYTICS_TABS = [
  { key: 'brand-health',  label: 'Brand Health' },
  { key: 'patterns',      label: 'Patterns'     },
  { key: 'warranty',      label: 'Warranty'     },
  { key: 'digest',        label: 'Digest'       },
];

async function openAnalytics(initialTab) {
  closeAnalytics();
  const overlay = document.createElement('div');
  overlay.className = 'eq-analytics-overlay';
  document.body.appendChild(overlay);

  analyticsState = {
    overlay,
    activeTab: initialTab && ANALYTICS_TABS.find(t => t.key === initialTab) ? initialTab : 'brand-health',
    snapshot: null,
    loading: true,
  };
  renderAnalytics();

  try {
    const snapshot = await computeFleetSnapshot();
    if (!analyticsState || analyticsState.overlay !== overlay) return;
    analyticsState.snapshot = snapshot;
    analyticsState.loading = false;
    renderAnalytics();
  } catch (e) {
    console.error('[equipment] openAnalytics:', e);
    if (analyticsState) {
      analyticsState.loading = false;
      analyticsState.error = e.message || String(e);
      renderAnalytics();
    }
  }
}

function closeAnalytics() {
  if (!analyticsState) return;
  if (analyticsState.overlay && analyticsState.overlay.parentNode) {
    analyticsState.overlay.parentNode.removeChild(analyticsState.overlay);
  }
  analyticsState = null;
}

function renderAnalytics() {
  if (!analyticsState || !analyticsState.overlay) return;
  const { overlay, activeTab, snapshot, loading, error } = analyticsState;

  let bodyHTML;
  if (loading) {
    bodyHTML = `<div class="eq-analytics-loading">Crunching fleet data…</div>`;
  } else if (error) {
    bodyHTML = `<div class="eq-analytics-error">Couldn't load analytics: ${esc(error)}</div>`;
  } else if (!snapshot) {
    bodyHTML = `<div class="eq-analytics-empty">No fleet data yet.</div>`;
  } else {
    switch (activeTab) {
      case 'brand-health':  bodyHTML = renderBrandHealthTab(snapshot);  break;
      case 'patterns':      bodyHTML = renderPatternsTab(snapshot);     break;
      case 'warranty':      bodyHTML = renderWarrantyTab(snapshot);     break;
      case 'digest':        bodyHTML = renderDigestTab(snapshot);       break;
      default:              bodyHTML = `<div class="eq-analytics-empty">Unknown tab.</div>`;
    }
  }

  overlay.innerHTML = `
    <div class="eq-analytics-head">
      <button class="eq-analytics-close" aria-label="Close analytics">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="eq-analytics-head-text">
        <div class="eq-analytics-title">Fleet Intelligence</div>
        <div class="eq-analytics-sub">${snapshot ? `${snapshot.units.length} units · ${Object.keys(snapshot.byBrand).length} brands` : ''}</div>
      </div>
    </div>

    <div class="eq-analytics-tabs" role="tablist">
      ${ANALYTICS_TABS.map(t => `
        <button class="eq-analytics-tab${t.key === activeTab ? ' is-active' : ''}" data-tab="${esc(t.key)}" role="tab" aria-selected="${t.key === activeTab}">${esc(t.label)}</button>
      `).join('')}
    </div>

    <div class="eq-analytics-body">
      ${bodyHTML}
    </div>
  `;

  overlay.querySelector('.eq-analytics-close').addEventListener('click', closeAnalytics);
  overlay.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      analyticsState.activeTab = btn.dataset.tab;
      renderAnalytics();
    });
  });

  // Tab-specific interactions
  if (activeTab === 'digest' && snapshot) {
    overlay.querySelector('[data-action="copy-digest"]')?.addEventListener('click', () => copyDigestToClipboard(snapshot));
    overlay.querySelector('[data-action="email-digest"]')?.addEventListener('click', () => emailDigest(snapshot));
  }
  if (activeTab === 'brand-health' && snapshot) {
    overlay.querySelectorAll('[data-brand-id]').forEach(card => {
      card.addEventListener('click', () => {
        const brandId = card.dataset.brandId;
        const brandName = card.dataset.brandName;
        // Filter equipment list to this brand and close.
        if (typeof filterToBrand === 'function') {
          filterToBrand(brandId, brandName);
        }
        closeAnalytics();
      });
    });
  }
  if (activeTab === 'warranty' && snapshot) {
    overlay.querySelectorAll('[data-eq-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.eqId;
        closeAnalytics();
        if (typeof openDetail === 'function') openDetail(id);
      });
    });
  }
  if (activeTab === 'patterns' && snapshot) {
    overlay.querySelectorAll('[data-action="schedule-pm-batch"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ids = (btn.dataset.eqIds || '').split(',').filter(Boolean);
        if (!ids.length) return;
        // Pre-seed bulk selection and open the schedule sheet.
        bulkSelectionState.active = true;
        bulkSelectionState.selected = new Set(ids);
        document.body.classList.add('eq-bulk-mode');
        renderBulkToolbar();
        closeAnalytics();
        // Slight delay so the overlay close completes first.
        setTimeout(() => openBulkPmSchedule(), 150);
      });
    });
  }
}

/* ──────────────────────────────────────────────────────────────────
   Fleet snapshot — single computation backing all four tabs.
   Runs once per openAnalytics() to amortize the work.
   ────────────────────────────────────────────────────────────────── */

async function computeFleetSnapshot() {
  // Make sure manufacturers cache is warm (analytics relies on it).
  if (!manufacturersCache) await loadManufacturers(true);

  // Pull all maintenance records for analysis. We fetch enough to cover
  // 24 months — patterns need history. If the list is huge (>5k rows)
  // a future enhancement could partition by date or stream.
  const cutoff = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  let maintenance = [];
  try {
    const { data } = await NX.sb.from('equipment_maintenance')
      .select('id, equipment_id, event_date, event_type, description, performed_by, cost, parts_replaced, next_pm_due')
      .gte('event_date', cutoff)
      .order('event_date', { ascending: true });
    maintenance = data || [];
  } catch (e) {
    console.warn('[equipment] computeFleetSnapshot maintenance load:', e.message || e);
  }

  // Pull open issues for cross-reference (warranty roster, digest).
  let openIssues = [];
  try {
    const { data } = await NX.sb.from('equipment_issues')
      .select('id, equipment_id, status, title, reported_at, eta_at')
      .neq('status', 'repaired')
      .order('reported_at', { ascending: false });
    openIssues = data || [];
  } catch (e) {
    console.warn('[equipment] computeFleetSnapshot issues load:', e.message || e);
  }

  // Use the in-memory equipment array — already loaded by buildUI.
  const units = (typeof equipment !== 'undefined' && equipment) ? equipment : [];

  // Bucket maintenance by equipment_id for fast lookup.
  const maintByEq = {};
  for (const m of maintenance) {
    if (!maintByEq[m.equipment_id]) maintByEq[m.equipment_id] = [];
    maintByEq[m.equipment_id].push(m);
  }
  // Bucket open issues by equipment_id.
  const issuesByEq = {};
  for (const i of openIssues) {
    if (!issuesByEq[i.equipment_id]) issuesByEq[i.equipment_id] = [];
    issuesByEq[i.equipment_id].push(i);
  }

  // Per-brand aggregation.
  const byBrand = {};
  for (const u of units) {
    const m = resolveManufacturer(u);
    const brandId = m ? m.id : null;
    const brandName = m ? m.name : (u.manufacturer || '(no brand)');
    const key = brandId || '__nobrand_' + brandName.toLowerCase();
    if (!byBrand[key]) {
      byBrand[key] = {
        id: brandId,
        name: brandName,
        record: m,
        units: [],
        operationalCount: 0,
        ytdSpend: 0,
        servicesYTD: 0,
        servicesAllTime: 0,
        totalServiceMonths: 0,
      };
    }
    byBrand[key].units.push(u);
    if ((u.status || 'operational').toLowerCase() === 'operational') {
      byBrand[key].operationalCount += 1;
    }
    const myMaint = maintByEq[u.id] || [];
    const ytdCutoff = new Date(new Date().getFullYear(), 0, 1);
    for (const ev of myMaint) {
      const cost = parseFloat(ev.cost) || 0;
      const evDate = new Date(ev.event_date);
      byBrand[key].servicesAllTime += 1;
      if (evDate >= ytdCutoff) {
        byBrand[key].ytdSpend += cost;
        byBrand[key].servicesYTD += 1;
      }
    }
  }

  // Failure pattern detection — group by (manufacturer, model) and count
  // recurring repair events. A "pattern" is 3+ equipment units of the
  // same model with the same repair type within similar age windows.
  const patterns = detectFailurePatterns(units, maintByEq);

  // Warranty roster — units with warranty_until set, expiring 0–90 days.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const warrantyRoster = units
    .filter(u => u.warranty_until)
    .map(u => {
      const until = new Date(u.warranty_until);
      const daysLeft = Math.floor((until - today) / 86400000);
      return { equipment: u, until, daysLeft };
    })
    .filter(w => w.daysLeft >= -30 && w.daysLeft <= 90)  // include just-expired (last 30d)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Counts for header.
  const totalUnits = units.length;
  const operational = units.filter(u => (u.status || 'operational').toLowerCase() === 'operational').length;
  const totalYtd = Object.values(byBrand).reduce((s, b) => s + b.ytdSpend, 0);

  return {
    units,
    maintenance,
    maintByEq,
    issuesByEq,
    openIssues,
    byBrand,
    patterns,
    warrantyRoster,
    totalUnits,
    operational,
    operationalPct: totalUnits ? Math.round((operational / totalUnits) * 100) : 0,
    totalYtd,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Detect failure patterns across the fleet. Returns a list of patterns,
 * each describing a recurring failure mode in a brand+model cohort.
 * Heuristic — refines as more data lands.
 *
 * Algorithm:
 *   1. Group equipment by (manufacturer, model)
 *   2. For each group with 3+ units, examine maintenance events
 *   3. If 50%+ of units in the cohort had a similar event description
 *      (matching keywords), flag it as a pattern
 *   4. Compute average age-at-failure for the cohort to recommend
 *      preventive PM timing
 */
function detectFailurePatterns(units, maintByEq) {
  // Group by (manufacturer, model). Skip rows missing either field.
  const groups = {};
  for (const u of units) {
    if (!u.manufacturer || !u.model) continue;
    const key = (u.manufacturer + '|' + u.model).toLowerCase();
    if (!groups[key]) groups[key] = { manufacturer: u.manufacturer, model: u.model, units: [] };
    groups[key].units.push(u);
  }

  const patterns = [];
  const KEYWORDS = [
    { tag: 'compressor', words: ['compressor', 'compress'], pmHint: 'coil cleaning + compressor amperage check' },
    { tag: 'condenser',  words: ['condenser', 'coil', 'condense'], pmHint: 'condenser coil cleaning' },
    { tag: 'thermostat', words: ['thermostat', 'thermo', 'temp control', 'controller'], pmHint: 'thermostat calibration check' },
    { tag: 'gasket',     words: ['gasket', 'door seal', 'seal'], pmHint: 'door gasket inspection' },
    { tag: 'fan',        words: ['fan', 'evap', 'evaporator'], pmHint: 'evaporator fan motor check' },
    { tag: 'ice-build',  words: ['ice build', 'frost', 'icing'], pmHint: 'defrost cycle adjustment' },
    { tag: 'water-leak', words: ['leak', 'water'], pmHint: 'water line + drain inspection' },
    { tag: 'filter',     words: ['filter'], pmHint: 'filter replacement' },
    { tag: 'belt',       words: ['belt'], pmHint: 'belt tension + wear check' },
    { tag: 'igniter',    words: ['igniter', 'ignition', 'pilot'], pmHint: 'igniter cleaning + pilot check' },
  ];

  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.units.length < 3) continue;

    // For each keyword set, count units that have a matching maintenance event.
    for (const kw of KEYWORDS) {
      const affected = [];
      const ages = [];
      for (const u of g.units) {
        const events = maintByEq[u.id] || [];
        const match = events.find(ev => {
          const text = (ev.description || ev.event_type || '').toLowerCase();
          return kw.words.some(w => text.includes(w));
        });
        if (match) {
          affected.push(u);
          if (u.install_date) {
            const ageMonths = Math.round((new Date(match.event_date) - new Date(u.install_date)) / (30 * 86400000));
            if (ageMonths > 0) ages.push(ageMonths);
          }
        }
      }
      // Pattern threshold: 50%+ of cohort affected, minimum 3 units.
      if (affected.length >= 3 && (affected.length / g.units.length) >= 0.5) {
        const avgAge = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null;
        const minAge = ages.length ? Math.min(...ages) : null;
        const recommendAt = avgAge ? Math.max(6, avgAge - 3) : null;
        patterns.push({
          manufacturer: g.manufacturer,
          model: g.model,
          tag: kw.tag,
          pmHint: kw.pmHint,
          cohortSize: g.units.length,
          affectedCount: affected.length,
          avgAgeMonths: avgAge,
          minAgeMonths: minAge,
          recommendAtMonths: recommendAt,
          affectedIds: affected.map(u => u.id),
          allCohortIds: g.units.map(u => u.id),
        });
      }
    }
  }

  // Sort by impact: highest affected fraction first.
  patterns.sort((a, b) => (b.affectedCount / b.cohortSize) - (a.affectedCount / a.cohortSize));
  return patterns;
}

/* ──────────────────────────────────────────────────────────────────
   TAB 1: BRAND HEALTH
   ────────────────────────────────────────────────────────────────── */

function renderBrandHealthTab(snap) {
  const brands = Object.values(snap.byBrand)
    .filter(b => b.units.length > 0)
    .sort((a, b) => b.units.length - a.units.length);

  if (!brands.length) {
    return `<div class="eq-analytics-empty">No equipment with manufacturers yet. Add some equipment to see brand-level analytics here.</div>`;
  }

  // Top-line summary tiles.
  const summaryHTML = `
    <div class="eq-analytics-summary">
      <div class="eq-analytics-stat">
        <div class="eq-analytics-stat-value">${snap.totalUnits}</div>
        <div class="eq-analytics-stat-label">Total Units</div>
      </div>
      <div class="eq-analytics-stat">
        <div class="eq-analytics-stat-value eq-analytics-stat-pct">${snap.operationalPct}<span>%</span></div>
        <div class="eq-analytics-stat-label">Operational</div>
      </div>
      <div class="eq-analytics-stat">
        <div class="eq-analytics-stat-value">${formatMoney(snap.totalYtd)}</div>
        <div class="eq-analytics-stat-label">Service YTD</div>
      </div>
      <div class="eq-analytics-stat">
        <div class="eq-analytics-stat-value">${snap.openIssues.length}</div>
        <div class="eq-analytics-stat-label">Open Issues</div>
      </div>
    </div>
  `;

  const cardsHTML = brands.map(b => {
    const opPct = Math.round((b.operationalCount / b.units.length) * 100);
    const opCls = opPct >= 90 ? 'is-good' : opPct >= 70 ? 'is-caution' : 'is-bad';
    const avgServicesPerUnit = b.units.length > 0 ? (b.servicesYTD / b.units.length).toFixed(1) : '0';
    const fakeUnit = { manufacturer_id: b.id, manufacturer: b.name };

    return `
      <div class="eq-brand-health-card" data-brand-id="${esc(b.id || '')}" data-brand-name="${esc(b.name)}">
        <div class="eq-brand-health-head">
          ${manufacturerLogo(fakeUnit, 'md')}
          <div class="eq-brand-health-head-text">
            <div class="eq-brand-health-name">${esc(b.name)}</div>
            <div class="eq-brand-health-meta">${b.units.length} ${b.units.length === 1 ? 'unit' : 'units'}</div>
          </div>
        </div>
        <div class="eq-brand-health-stats">
          <div class="eq-brand-health-stat">
            <div class="eq-brand-health-stat-label">Operational</div>
            <div class="eq-brand-health-stat-value eq-brand-health-pct ${opCls}">${opPct}%</div>
          </div>
          <div class="eq-brand-health-stat">
            <div class="eq-brand-health-stat-label">Spend YTD</div>
            <div class="eq-brand-health-stat-value">${formatMoney(b.ytdSpend)}</div>
          </div>
          <div class="eq-brand-health-stat">
            <div class="eq-brand-health-stat-label">Calls YTD</div>
            <div class="eq-brand-health-stat-value">${b.servicesYTD} <span class="eq-brand-health-stat-sub">(${avgServicesPerUnit}/unit)</span></div>
          </div>
        </div>
        <div class="eq-brand-health-bar">
          <div class="eq-brand-health-bar-fill ${opCls}" style="width:${opPct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    ${summaryHTML}
    <div class="eq-analytics-section-label">By manufacturer · sorted by fleet size</div>
    <div class="eq-brand-health-list">${cardsHTML}</div>
  `;
}

/* ──────────────────────────────────────────────────────────────────
   TAB 2: PATTERNS
   ────────────────────────────────────────────────────────────────── */

function renderPatternsTab(snap) {
  if (!snap.patterns.length) {
    return `
      <div class="eq-analytics-empty">
        <div class="eq-analytics-empty-title">No failure patterns detected yet</div>
        <div class="eq-analytics-empty-msg">Patterns surface when 3+ units of the same brand+model show a recurring repair type. Keep logging service work — patterns will appear as your dataset grows.</div>
      </div>
    `;
  }

  return `
    <div class="eq-analytics-intro">
      Cross-fleet analysis. Each pattern below means 50% or more of your <strong>brand+model</strong> cohort had a similar repair. Use the recommended PM windows to catch the issue before it breaks the next one.
    </div>
    <div class="eq-pattern-list">
      ${snap.patterns.map(p => {
        const pct = Math.round((p.affectedCount / p.cohortSize) * 100);
        const ageMsg = p.avgAgeMonths
          ? `Avg age at failure: <strong>${p.avgAgeMonths} months</strong>`
          : 'Install dates not set — age unknown';
        const recommendMsg = p.recommendAtMonths
          ? `Recommend preventive ${p.pmHint} at <strong>${p.recommendAtMonths} months</strong>`
          : `Recommend regular ${p.pmHint}`;
        return `
          <div class="eq-pattern-card">
            <div class="eq-pattern-head">
              <div class="eq-pattern-tag eq-pattern-tag-${esc(p.tag)}">${esc(p.tag.replace('-', ' ').toUpperCase())}</div>
              <div class="eq-pattern-cohort">${p.affectedCount} of ${p.cohortSize}</div>
            </div>
            <div class="eq-pattern-title">${esc(p.manufacturer)} ${esc(p.model)}</div>
            <div class="eq-pattern-stat">
              <div class="eq-pattern-pct-bar">
                <div class="eq-pattern-pct-fill" style="width:${pct}%"></div>
              </div>
              <div class="eq-pattern-pct-label">${pct}% of cohort affected</div>
            </div>
            <div class="eq-pattern-meta">${ageMsg}</div>
            <div class="eq-pattern-recommendation">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <span>${recommendMsg}</span>
            </div>
            <button class="eq-pattern-cta" data-action="schedule-pm-batch" data-eq-ids="${esc((p.allCohortIds || []).join(','))}">
              Schedule PM for all ${p.cohortSize} ${esc(p.manufacturer)} ${esc(p.model)} units
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ──────────────────────────────────────────────────────────────────
   TAB 3: WARRANTY
   ────────────────────────────────────────────────────────────────── */

function renderWarrantyTab(snap) {
  if (!snap.warrantyRoster.length) {
    return `
      <div class="eq-analytics-empty">
        <div class="eq-analytics-empty-title">Nothing on the warranty roster</div>
        <div class="eq-analytics-empty-msg">Equipment with a Warranty Until date set, expiring in the next 90 days (or just-expired in the last 30), will appear here. Set warranty dates in the equipment editor to populate the roster.</div>
      </div>
    `;
  }

  // Bucket by urgency.
  const expired   = snap.warrantyRoster.filter(w => w.daysLeft < 0);
  const urgent    = snap.warrantyRoster.filter(w => w.daysLeft >= 0  && w.daysLeft <= 30);
  const upcoming  = snap.warrantyRoster.filter(w => w.daysLeft > 30  && w.daysLeft <= 60);
  const watching  = snap.warrantyRoster.filter(w => w.daysLeft > 60  && w.daysLeft <= 90);

  const renderBucket = (bucket, title, cls) => {
    if (!bucket.length) return '';
    return `
      <div class="eq-analytics-section-label eq-analytics-section-label-${cls}">${esc(title)} · ${bucket.length}</div>
      <div class="eq-warranty-list">
        ${bucket.map(w => {
          const daysLabel = w.daysLeft < 0
            ? `Expired ${Math.abs(w.daysLeft)}d ago`
            : w.daysLeft === 0
              ? 'Expires today'
              : `${w.daysLeft} days left`;
          return `
            <div class="eq-warranty-card eq-warranty-card-${cls}" data-eq-id="${esc(w.equipment.id)}">
              <div class="eq-warranty-card-icon">
                ${w.equipment.manufacturer ? manufacturerLogo(w.equipment, 'sm') : `<span class="eq-cat-icon-fallback">${catIcon(w.equipment.category)}</span>`}
              </div>
              <div class="eq-warranty-card-body">
                <div class="eq-warranty-card-name">${esc(w.equipment.name)}</div>
                <div class="eq-warranty-card-meta">${esc(w.equipment.location || '—')}${w.equipment.manufacturer ? ' · ' + esc(w.equipment.manufacturer) : ''}${w.equipment.model ? ' ' + esc(w.equipment.model) : ''}</div>
              </div>
              <div class="eq-warranty-card-days">
                <div class="eq-warranty-card-days-num">${daysLabel}</div>
                <div class="eq-warranty-card-days-date">${esc(w.until.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  };

  return `
    <div class="eq-analytics-intro">
      Equipment with warranty windows expiring soon. <strong>Schedule any pending service before the warranty drops</strong> — manufacturer covers the labor and parts under warranty.
    </div>
    ${renderBucket(expired,  'Just expired (last 30d)', 'expired')}
    ${renderBucket(urgent,   'Expiring in 30 days',     'urgent')}
    ${renderBucket(upcoming, 'Expiring in 60 days',     'upcoming')}
    ${renderBucket(watching, 'Expiring in 90 days',     'watching')}
  `;
}

/* ──────────────────────────────────────────────────────────────────
   TAB 4: WEEKLY DIGEST
   ────────────────────────────────────────────────────────────────── */

function buildDigestText(snap) {
  const todayStr = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const lines = [];
  lines.push(`NEXUS Fleet Digest — ${todayStr}`);
  lines.push('');
  lines.push(`Fleet at a glance:`);
  lines.push(`  • ${snap.totalUnits} total units across ${Object.keys(snap.byBrand).length} brands`);
  lines.push(`  • ${snap.operational} operational (${snap.operationalPct}%)`);
  lines.push(`  • ${formatMoney(snap.totalYtd)} in service spend YTD`);
  lines.push(`  • ${snap.openIssues.length} open issues`);
  lines.push('');

  // Open issues by status
  if (snap.openIssues.length) {
    lines.push(`Open issues:`);
    const byStatus = {};
    for (const i of snap.openIssues) {
      const s = i.status || 'reported';
      if (!byStatus[s]) byStatus[s] = [];
      byStatus[s].push(i);
    }
    const statusOrder = ['reported', 'contractor_called', 'eta_set', 'in_progress', 'awaiting_parts'];
    for (const s of statusOrder) {
      if (!byStatus[s]) continue;
      lines.push(`  ${ISSUE_LIFECYCLE_LABELS[s] || s} (${byStatus[s].length}):`);
      for (const issue of byStatus[s]) {
        const eq = snap.units.find(u => u.id === issue.equipment_id);
        const eqLabel = eq ? `${eq.name}${eq.location ? ' @ ' + eq.location : ''}` : 'Unknown unit';
        const reportedAgo = Math.floor((Date.now() - new Date(issue.reported_at).getTime()) / 86400000);
        const ageStr = reportedAgo === 0 ? 'today' : reportedAgo === 1 ? 'yesterday' : `${reportedAgo}d ago`;
        const etaStr = issue.eta_at ? ` (ETA: ${new Date(issue.eta_at).toLocaleString()})` : '';
        lines.push(`    - ${issue.title} — ${eqLabel} (reported ${ageStr})${etaStr}`);
      }
    }
    lines.push('');
  }

  // Warranty alerts
  const warrantyExpiring = snap.warrantyRoster.filter(w => w.daysLeft >= 0 && w.daysLeft <= 30);
  if (warrantyExpiring.length) {
    lines.push(`Warranty alerts (expiring ≤30 days):`);
    for (const w of warrantyExpiring) {
      lines.push(`  • ${w.equipment.name}${w.equipment.location ? ' @ ' + w.equipment.location : ''} — ${w.daysLeft}d left (until ${w.until.toLocaleDateString()})`);
    }
    lines.push('');
  }

  // Top failure patterns
  if (snap.patterns.length) {
    lines.push(`Failure patterns detected:`);
    for (const p of snap.patterns.slice(0, 3)) {
      lines.push(`  • ${p.manufacturer} ${p.model}: ${p.affectedCount}/${p.cohortSize} units affected by ${p.tag.replace('-', ' ')}${p.avgAgeMonths ? ` (avg ${p.avgAgeMonths}mo old)` : ''}`);
      lines.push(`      Recommend: ${p.pmHint}${p.recommendAtMonths ? ` at ${p.recommendAtMonths}mo` : ''}`);
    }
    lines.push('');
  }

  // Brand spend leaderboard
  const topSpend = Object.values(snap.byBrand)
    .filter(b => b.ytdSpend > 0)
    .sort((a, b) => b.ytdSpend - a.ytdSpend)
    .slice(0, 5);
  if (topSpend.length) {
    lines.push(`Brand spend YTD (top ${topSpend.length}):`);
    for (const b of topSpend) {
      lines.push(`  ${b.name}: ${formatMoney(b.ytdSpend)} across ${b.servicesYTD} service calls (${b.units.length} units in fleet)`);
    }
    lines.push('');
  }

  lines.push('— Generated by NEXUS');
  return lines.join('\n');
}

function renderDigestTab(snap) {
  const text = buildDigestText(snap);
  return `
    <div class="eq-analytics-intro">
      Sunday-night-ready summary. Copy or send via email to anyone who needs the operational pulse.
    </div>
    <div class="eq-digest-actions">
      <button class="eq-digest-btn eq-digest-btn-primary" data-action="email-digest">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        <span>Email this digest</span>
      </button>
      <button class="eq-digest-btn eq-digest-btn-secondary" data-action="copy-digest">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>Copy to clipboard</span>
      </button>
    </div>
    <pre class="eq-digest-preview">${esc(text)}</pre>
  `;
}

async function copyDigestToClipboard(snap) {
  const text = buildDigestText(snap);
  try {
    await navigator.clipboard.writeText(text);
    NX.toast && NX.toast('Digest copied to clipboard', 'success', 1400);
  } catch (e) {
    // Clipboard API can fail on insecure contexts or certain mobile browsers.
    // Fall back to a textarea select-and-copy maneuver.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      NX.toast && NX.toast('Digest copied to clipboard', 'success', 1400);
    } catch (_) {
      NX.toast && NX.toast('Could not copy — long-press the text to copy manually', 'warn', 2200);
    }
    document.body.removeChild(ta);
  }
}

function emailDigest(snap) {
  const text = buildDigestText(snap);
  const todayStr = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  const subject = `NEXUS Fleet Digest — ${todayStr}`;
  const enc = s => encodeURIComponent(s).replace(/\+/g, '%20');
  const url = `mailto:?subject=${enc(subject)}&body=${enc(text)}`;
  window.location.href = url;
  NX.toast && NX.toast('Opening email…', 'info', 1100);
}

/**
 * Apply a brand filter to the equipment list view. Sets a global
 * filter state that the existing filter pipeline picks up and re-
 * renders the list. If the user already has a different filter
 * mode active, this overrides it.
 */
function filterToBrand(brandId, brandName) {
  // The simplest path that won't fight with the existing filter UI:
  // jam the brand name into the search input. This works because
  // getFiltered already searches manufacturer text. Crude but robust.
  const search = document.getElementById('eqSearch');
  if (search) {
    search.value = brandName || '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (typeof renderList === 'function') {
    // Fallback: just re-render. Future enhancement: add a proper
    // brand-filter chip to the equipment list filter bar.
    renderList();
  }
  NX.toast && NX.toast(`Showing ${brandName} only — clear search to reset`, 'info', 1800);
}

/** Compact money formatter — $1,234 / $1,234.56 / $12.3K. */
function formatMoney(n) {
  const v = parseFloat(n) || 0;
  if (v === 0) return '$0';
  if (Math.abs(v) >= 10000) {
    return '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}


/* ════════════════════════════════════════════════════════════════════════════
   19. CONTRACTORS — full management overlay
   ════════════════════════════════════════════════════════════════════════════
   Dedicated workspace for managing the people who service your equipment.
   Mirrors the brand library + analytics overlay pattern: full-screen, two
   modes (list + detail), shared state object.

   List view:
     • Cards for each contractor with avatar/initials, name, primary
       phone, last activity date.
     • Search bar filters by name or specialty tag.
     • "+ Add contractor" button at top-right of header.

   Detail view (per contractor):
     • Header: avatar + name + edit/done button
     • Stats strip: equipment serviced, calls YTD, avg response time, $YTD
     • Three tabs:
         Activity — chronological feed of every dispatch / maintenance /
                    issue this contractor has handled
         Equipment — list of equipment assigned to this contractor as
                     service_contractor_node_id, plus equipment they've
                     historically performed work on
         Edit — full editable form: name, phone, email, address, hours,
                specialties (chip-input), notes
     • Sticky footer with "Email" and "Call" actions

   Data model:
     Contractors live in the `nodes` table with category='contractors'.
     Their fields are loose — name + notes + links (jsonb) + tags (jsonb).
     We also write a structured `phone` and `email` to nodes.links so the
     dispatch sheet and bulk-assign helpers can find them deterministically.

   Activity sources:
     • equipment_maintenance.performed_by — string match by contractor name
     • equipment_issues — contractor_node_id (FK) + contractor_name fallback
     • dispatch_log — when available, joined by node_id
   ════════════════════════════════════════════════════════════════════════════ */

let contractorsState = null;

async function openContractors() {
  closeContractors();
  // ─── DIAGNOSTIC v35 ────────────────────────────────────────────────
  // Hardcoded version stamp so the user can verify in a screenshot
  // exactly which JS code is running. If you don't see this toast,
  // the service worker is serving stale cached code.
  NX.toast && NX.toast('NEXUS contractors v41 — opening…', 'info', 1400);

  const overlay = document.createElement('div');
  overlay.className = 'eq-contractors-overlay';
  document.body.appendChild(overlay);

  // Pull persisted location filter so the pill picker remembers the
  // last "profile" the user was in across sessions. Mirrors the
  // ordering module's per-location persistence pattern. 'all' means
  // show everything across the three restaurants — this is the default
  // when there's no saved preference, and it's the only valid fallback
  // if localStorage is corrupt.
  let savedLoc = 'all';
  try {
    const v = localStorage.getItem('nexus.contractors.activeLocation');
    if (v && (v === 'all' || LOCATIONS.includes(v))) savedLoc = v;
  } catch (_) {}

  contractorsState = {
    overlay,
    mode: 'list',        // 'list' | 'detail'
    list: [],
    activeId: null,
    activeContractor: null,
    activity: [],
    assignedEquipment: [],
    historicalEquipment: [],
    detailTab: 'activity',
    editing: false,
    loading: true,
    search: '',
    activeLocation: savedLoc, // 'all' | 'Suerte' | 'Este' | 'Bar Toti'
  };
  renderContractors();

  try {
    await loadContractorsList();
    if (!contractorsState || contractorsState.overlay !== overlay) return;
    contractorsState.loading = false;
    renderContractors();
  } catch (e) {
    console.error('[equipment] openContractors:', e);
    NX.toast && NX.toast(`🔴 Crashed: ${e.message || e}`, 'error', 6000);
    if (contractorsState) {
      contractorsState.loading = false;
      contractorsState.error = e.message || String(e);
      renderContractors();
    }
  }
}

function closeContractors() {
  if (!contractorsState) return;
  if (contractorsState.overlay && contractorsState.overlay.parentNode) {
    contractorsState.overlay.parentNode.removeChild(contractorsState.overlay);
  }
  contractorsState = null;
}

/**
 * Load all contractor nodes with derived summary stats. The stats are
 * computed in JS from one bulk fetch of equipment_maintenance + equipment
 * + equipment_issues so we avoid N+1 queries.
 */
async function loadContractorsList() {
  if (!NX.sb) {
    NX.toast && NX.toast('🔴 NX.sb is not set — Supabase client missing', 'error', 5000);
    return;
  }
  // (Old "Step 1: querying nodes…" toast removed — it was diagnostic
  // noise from a past session where the contractors list was empty.
  // Now we just log to console for trace visibility.)
  console.log('[loadContractorsList] querying nodes…');

  // Fetch contractors + supporting data in parallel.
  // The select includes subject_template + body_template; if those columns
  // don't exist yet on the nodes table, the query fails and we retry without.
  let nodesRes;
  {
    const tryFull = await NX.sb.from('nodes')
      .select('id, name, notes, links, tags, category, created_at, subject_template, body_template')
      .eq('category', 'contractors')
      .order('name', { ascending: true });
    if (tryFull.error && /column.*(subject_template|body_template).*does not exist/i.test(tryFull.error.message || '')) {
      console.warn('[contractors] template columns missing, falling back');
      nodesRes = await NX.sb.from('nodes')
        .select('id, name, notes, links, tags, category, created_at')
        .eq('category', 'contractors')
        .order('name', { ascending: true });
    } else {
      nodesRes = tryFull;
    }
  }
  const [maintRes, issuesRes, equipRes] = await Promise.all([
    NX.sb.from('equipment_maintenance')
      .select('id, equipment_id, event_date, event_type, description, performed_by, cost')
      .gte('event_date', new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10))
      .order('event_date', { ascending: false }),
    NX.sb.from('equipment_issues')
      .select('id, equipment_id, status, contractor_node_id, contractor_name, reported_at, contractor_called_at, repaired_at')
      .order('reported_at', { ascending: false }).then(r => r).catch(() => ({ data: [] })),
    // Try the full select including repair_contractor_*. Fall back to the
    // legacy select if the migration hasn't been run yet — the repair
    // contractor columns simply won't be available for matching.
    (async () => {
      const FULL = 'id, name, location, area, manufacturer, model, service_contractor_node_id, service_contractor_name, service_contractor_phone, repair_contractor_node_id, repair_contractor_name, repair_contractor_phone';
      const LEGACY = 'id, name, location, area, manufacturer, model, service_contractor_node_id, service_contractor_name, service_contractor_phone';
      const r = await NX.sb.from('equipment').select(FULL);
      if (r.error && /column.+repair_contractor.+does not exist/i.test(r.error.message || '')) {
        return await NX.sb.from('equipment').select(LEGACY);
      }
      return r;
    })(),
  ]);

  // ─── Surface every error (this is the whole point of v37) ────────
  const errs = [];
  if (nodesRes?.error) errs.push('nodes: ' + (nodesRes.error.message || nodesRes.error.code));
  if (maintRes?.error) errs.push('maint: ' + (maintRes.error.message || maintRes.error.code));
  if (equipRes?.error) errs.push('equip: ' + (equipRes.error.message || equipRes.error.code));
  if (errs.length) {
    console.error('[loadContractorsList] errors:', errs);
    NX.toast && NX.toast('🔴 Read errors: ' + errs.join(' | '), 'error', 7000);
  }

  const contractors = nodesRes?.data || [];
  const maint = maintRes?.data || [];
  const issues = (issuesRes && issuesRes.data) || [];
  const eqList = equipRes?.data || [];

  // Stash diagnostic info that the empty-state box will display.
  // This is the whole bug-finding strategy in v37: if the list ends
  // up empty, the user can SEE exactly why right inside the overlay
  // — no devtools, no console, no relying on toasts being noticed.
  contractorsState._debug = {
    rowCount: contractors.length,
    errMsg: nodesRes?.error?.message || (errs.length ? errs.join(' | ') : null),
    status: nodesRes?.status,
    eqCount: eqList.length,
    maintCount: maint.length,
    timestamp: new Date().toLocaleTimeString(),
  };

  console.log('[loadContractorsList] counts:', {
    contractors: contractors.length,
    maint: maint.length,
    issues: issues.length,
    equipment: eqList.length,
  });

  // Old "Step 2: read N contractors" toast — only fire it as a visible
  // toast on the failure case (zero contractors loaded). On success we
  // just log; no need to spam a toast every time the list refreshes.
  console.log('[loadContractorsList] read', contractors.length, 'contractors,', eqList.length, 'equipment');
  if (contractors.length === 0) {
    NX.toast && NX.toast(
      'No contractors found in database',
      'warn',
      3000
    );
  }

  const ytdCutoff = new Date(new Date().getFullYear(), 0, 1);

  for (const c of contractors) {
    // Match maintenance records by performed_by string (case-insensitive
    // includes match — handles "Tyler from Austin Air & Ice" matching
    // contractor named "Austin Air & Ice").
    const nameLower = (c.name || '').toLowerCase();
    const myMaint = maint.filter(m => {
      const pb = (m.performed_by || '').toLowerCase();
      return pb && (pb.includes(nameLower) || nameLower.includes(pb));
    });
    const myIssues = issues.filter(i =>
      i.contractor_node_id == c.id ||
      ((i.contractor_name || '').toLowerCase() === nameLower && nameLower)
    );

    // Stats.
    c._maint = myMaint;
    c._issues = myIssues;
    c._callsYtd = myMaint.filter(m => new Date(m.event_date) >= ytdCutoff).length;
    c._ytdSpend = myMaint
      .filter(m => new Date(m.event_date) >= ytdCutoff)
      .reduce((s, m) => s + (parseFloat(m.cost) || 0), 0);
    c._totalCalls = myMaint.length;

    // Average response time across resolved issues.
    const responses = myIssues
      .filter(i => i.contractor_called_at && i.reported_at)
      .map(i => (new Date(i.contractor_called_at) - new Date(i.reported_at)) / (3600 * 1000)); // hours
    c._avgResponseHrs = responses.length
      ? Math.round(responses.reduce((s, r) => s + r, 0) / responses.length * 10) / 10
      : null;

    // Last activity (most recent maintenance, issue contact, or assignment).
    let lastDates = [];
    if (myMaint.length) lastDates.push(myMaint[0].event_date);
    if (myIssues.length) lastDates.push(myIssues[0].reported_at);
    c._lastActivity = lastDates.length
      ? lastDates.sort().reverse()[0]
      : null;

    // Equipment they're linked to. Match by EITHER role:
    //   1. service_contractor_node_id FK (maintenance — strong link)
    //   2. service_contractor_name string (maintenance — informal name link)
    //   3. repair_contractor_node_id FK (repair — strong link)
    //   4. repair_contractor_name string (repair — informal name link)
    // Equipment in the second/fourth bucket can be promoted to FK via a
    // one-tap action in the Equipment tab.
    c._assignedCount = eqList.filter(e =>
      e.service_contractor_node_id == c.id ||
      e.repair_contractor_node_id  == c.id ||
      ((e.service_contractor_name || '').toLowerCase().trim() === nameLower && nameLower) ||
      ((e.repair_contractor_name  || '').toLowerCase().trim() === nameLower && nameLower)
    ).length;
    // Unique equipment they've serviced historically.
    const servicedIds = new Set(myMaint.map(m => m.equipment_id));
    c._historicalCount = servicedIds.size;
  }

  // Sort: most-active first, then alphabetical.
  contractors.sort((a, b) => {
    const aA = a._lastActivity ? new Date(a._lastActivity).getTime() : 0;
    const bA = b._lastActivity ? new Date(b._lastActivity).getTime() : 0;
    if (aA !== bA) return bA - aA;
    return (a.name || '').localeCompare(b.name || '');
  });

  contractorsState.list = contractors;
  contractorsState.maint = maint;
  contractorsState.issues = issues;
  contractorsState.equipmentLite = eqList;
}

/**
 * Extract a phone number from a contractor node's links/notes blob.
 * Returns the first phone-shaped string found, or empty.
 */
function extractContractorPhone(c) {
  if (!c) return '';
  if (c.links) {
    const links = Array.isArray(c.links) ? c.links : [c.links];
    for (const l of links) {
      // Support {phone: "..."} structured form first.
      if (l && typeof l === 'object' && l.phone) return l.phone;
      const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
      const m = str.match(/(?:tel:)?(\+?[\d\s().-]{10,})/);
      if (m) return m[1].trim();
    }
  }
  if (c.notes) {
    const m = c.notes.match(/(\+?[\d\s().-]{10,})/);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * Extract ALL phones from a contractor's links + notes. Returns an
 * array of `{phone, label}` objects. The first entry is treated as
 * primary by callers (Call button, public scan). Used by the public
 * scan, the email/call buttons in contractor detail, and bulk
 * propagation when a contractor is assigned to equipment.
 */
function extractContractorPhones(c) {
  if (!c) return [];
  const out = [];
  const seen = new Set();
  const add = (phone, label) => {
    const norm = (phone || '').trim();
    if (!norm) return;
    const key = norm.replace(/\D/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ phone: norm, label: label || '' });
  };
  if (c.links) {
    const links = Array.isArray(c.links) ? c.links : [c.links];
    for (const l of links) {
      if (l && typeof l === 'object' && l.phone) {
        add(l.phone, l.label || '');
        continue;
      }
      const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
      const m = str.match(/(?:tel:)?(\+?[\d\s().-]{10,})/);
      if (m) add(m[1], '');
    }
  }
  if (c.notes) {
    const matches = c.notes.match(/(\+?[\d\s().-]{10,})/g) || [];
    matches.forEach(m => add(m, ''));
  }
  return out;
}

function extractContractorEmail(c) {
  if (!c) return '';
  if (c.links) {
    const links = Array.isArray(c.links) ? c.links : [c.links];
    for (const l of links) {
      if (l && typeof l === 'object' && l.email) return l.email;
      const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
      const m = str.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (m) return m[0];
    }
  }
  if (c.notes) {
    const m = c.notes.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m) return m[0];
  }
  return '';
}

/**
 * Extract ALL emails from a contractor's links + notes, with their role
 * (to/cc/bcc). Returns an array of `{email, role, label}` where role
 * defaults to 'to' (primary recipient). Drives the public scan's email
 * button — primary in to:, others in cc:.
 */
function extractContractorEmails(c) {
  if (!c) return [];
  const out = [];
  const seen = new Set();
  const add = (email, role, label) => {
    const norm = (email || '').trim().toLowerCase();
    if (!norm || !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(norm)) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push({ email: norm, role: role || 'to', label: label || '' });
  };
  if (c.links) {
    const links = Array.isArray(c.links) ? c.links : [c.links];
    for (const l of links) {
      if (l && typeof l === 'object' && l.email) {
        add(l.email, l.role || 'to', l.label || '');
        continue;
      }
      const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
      const m = str.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (m) add(m[0], 'to', '');
    }
  }
  if (c.notes) {
    const matches = c.notes.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    matches.forEach(m => add(m, 'to', ''));
  }
  return out;
}

function extractContractorTags(c) {
  if (!c || !c.tags) return [];
  if (Array.isArray(c.tags)) return c.tags;
  if (typeof c.tags === 'string') return c.tags.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return [];
}

/**
 * Build a deterministic colored-initial avatar for contractors.
 * Mirrors the manufacturer logo helper but with a distinct CSS class
 * so we can tune contractor avatars separately.
 */
/* ──────────────────────────────────────────────────────────────────────
 * openContractorEditor — engine-based contractor edit overlay
 *
 * Uses the shared NX.recordEditor (js/record-editor.js) — same engine
 * as the vendor editor in ordering.js. Opens cards for Identity, Contacts
 * (TO / CC / BCC email chip groups + phone numbers), Specialties (tag
 * chips), Notes, and a Danger zone. Save writes back to the nodes table.
 *
 * The PM "Email contractor" flow (emailContractorAboutIssue) reads the
 * same role-tagged emails this editor stores, so CC/BCC contacts set
 * here will be pre-filled when the user opens a service-request email.
 * ────────────────────────────────────────────────────────────────────── */
async function openContractorEditor(contractor) {
  if (!window.NX || !NX.recordEditor) {
    if (NX.toast) NX.toast('Editor engine not loaded — refresh the page', 'error', 3000);
    return;
  }
  // Wrap everything in try/catch so any engine-internal throw surfaces
  // as a toast instead of vanishing silently. Bug-hunting only — fine
  // to leave in production since the catch is harmless on the happy path.
  try {
  const RX = NX.recordEditor;
  const c = contractor || {};
  const isNew = !c.id;

  console.log('[openContractorEditor] entry', { c, isNew });

  // Bucket existing email rows by role into separate chip arrays.
  const emailRows = extractContractorEmails(c);
  const toArr  = emailRows.filter(e => e.role === 'to').map(e => e.email);
  const ccArr  = emailRows.filter(e => e.role === 'cc').map(e => e.email);
  const bccArr = emailRows.filter(e => e.role === 'bcc').map(e => e.email);

  // Phones: chip values look like "(512) 555-1234" — labels are stored
  // as meta on each chip ("dispatch", "after-hours", etc.).
  const phoneRows = extractContractorPhones(c);
  const phoneArr  = phoneRows.map(p => p.phone);
  // Keep a side-map of phone → label so we can reconstruct on save.
  const phoneLabels = Object.create(null);
  phoneRows.forEach(p => { if (p.phone) phoneLabels[p.phone] = p.label || ''; });

  const tagsArr = extractContractorTags(c);

  const emailValidator = (e) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? null : 'Invalid email';
  };
  const phoneValidator = (p) => {
    // Allow "+1 512 555 1234", "(512) 555-1234", etc. — at least 7 digits.
    const digits = (p.match(/\d/g) || []).length;
    return digits >= 7 ? null : 'Need at least 7 digits';
  };

  const cards = [];

  // ─── Identity (just name — contractors don't have photos in current schema) ──
  cards.push({
    key: 'identity',
    title: 'Identity',
    expanded: true,
    body: `
      <div class="rx-form-field">
        <label class="rx-form-label">Contractor name</label>
        <input type="text" class="rx-form-input" data-rx-cc-name value="${esc(c.name || '')}" placeholder="e.g. Austin Air & Ice" autocomplete="off">
      </div>
    `,
  });

  // ─── Contacts (TO / CC / BCC emails + phones) ──
  // Phones are passed as {value, meta} so the chip displays "name · phone"
  // when a label exists. The "Phone names" sub-form lets the user attach
  // (or edit) a name for any phone — which then powers the QR-scan
  // public page ("Call dispatch", "Call Mike", etc).
  const phoneItemsForChips = phoneArr.map(p => ({ value: p, meta: phoneLabels[p] || null }));
  cards.push({
    key: 'contacts',
    title: 'Contacts',
    expanded: true,
    body: `
      ${RX.buildChipGroupHTML(toArr,  'to',  { label: 'TO',    hint: 'primary recipient(s) — service request goes here', inputType: 'email', inputMode: 'email', placeholder: 'dispatch@example.com',    addLabel: 'Add TO' })}
      ${RX.buildChipGroupHTML(ccArr,  'cc',  { label: 'CC',    hint: 'always copied on every service email',             inputType: 'email', inputMode: 'email', placeholder: 'cc@example.com',          addLabel: 'Add CC' })}
      ${RX.buildChipGroupHTML(bccArr, 'bcc', { label: 'BCC',   hint: "silent copies — others can't see them",            inputType: 'email', inputMode: 'email', placeholder: 'bcc@example.com',         addLabel: 'Add BCC' })}
      ${RX.buildChipGroupHTML(phoneItemsForChips, 'phone', { label: 'PHONE', hint: 'first one powers the Call button on QR scan',    inputType: 'tel',   inputMode: 'tel',   placeholder: '(512) 555-1234',          addLabel: 'Add phone' })}

      <div class="rx-form-field rx-cc-phone-names" id="rxCcPhoneNamesField" ${phoneArr.length ? '' : 'hidden'}>
        <label class="rx-form-label">Names for phones <span class="rx-form-hint">— optional, shown on QR scan ("Call Mike")</span></label>
        <div class="rx-cc-phone-names-list" id="rxCcPhoneNamesList">
          ${phoneArr.map(p => `
            <div class="rx-cc-phone-name-row" data-phone="${esc(p)}">
              <span class="rx-cc-phone-name-num">${esc(p)}</span>
              <input class="rx-form-input rx-cc-phone-name-input" data-phone-label-for="${esc(p)}" type="text" value="${esc(phoneLabels[p] || '')}" placeholder="dispatch · main · cell · Mike" maxlength="30" autocomplete="off">
            </div>
          `).join('')}
        </div>
      </div>
    `,
  });

  // ─── Email template ──
  // Per-contractor service-request template. Tokens get substituted at
  // send time in emailContractorAboutIssue. Empty values fall back to
  // the standard built-in template — the editor doesn't force the user
  // to fill these in, they're an override for contractors who need a
  // specific tone/format (e.g. "Tyler — emergency at {location}, ETA?").
  cards.push({
    key: 'templates',
    title: 'Email template',
    expanded: false,
    body: `
      <div class="rx-form-field">
        <label class="rx-form-label">Subject line</label>
        <input type="text" class="rx-form-input" data-rx-cc-subject value="${esc(c.subject_template || '')}" placeholder="Service request — {equipment} at {location}" autocomplete="off">
        <div class="rx-form-hint">Tokens: <code>{equipment}</code> <code>{location}</code> <code>{area}</code> <code>{issue}</code> <code>{contractor}</code></div>
      </div>
      <div class="rx-form-field">
        <label class="rx-form-label">Body template</label>
        <textarea class="rx-form-input" data-rx-cc-body rows="6" placeholder="Leave blank to use the standard format. If you set this, your text replaces the body." style="height:auto;min-height:120px;padding:10px 12px;resize:vertical">${esc(c.body_template || '')}</textarea>
        <div class="rx-form-hint">Tokens: <code>{greeting}</code> <code>{equipment}</code> <code>{location}</code> <code>{area}</code> <code>{issue}</code> <code>{issue_details}</code> <code>{unit}</code> <code>{serial}</code> <code>{me}</code> <code>{reported}</code></div>
      </div>
    `,
  });

  // ─── Specialties (tag chips) ──
  cards.push({
    key: 'tags',
    title: 'In charge of',
    expanded: false,
    body: `
      <div class="rx-form-field">
        <label class="rx-form-label">Specialties <span class="rx-form-hint">— what they cover</span></label>
        ${RX.buildChipGroupHTML(tagsArr, 'tags', { placeholder: 'e.g. refrigeration', addLabel: 'Add specialty' })}
      </div>
    `,
  });

  // ─── Notes ──
  cards.push({
    key: 'notes',
    title: 'Notes',
    expanded: false,
    body: `
      <div class="rx-form-field">
        <textarea class="rx-form-input" data-rx-cc-notes rows="4" placeholder="Hours, address, billing rate, anything else — only you see this" style="height:auto;min-height:96px;padding:10px 12px;resize:vertical">${esc(c.notes || '')}</textarea>
      </div>
    `,
  });

  // ─── Danger zone (existing contractors only) ──
  if (!isNew) {
    cards.push({
      key: 'danger',
      title: 'Danger zone',
      expanded: false,
      danger: true,
      body: `
        <button class="ord-veditor-archive-btn" type="button" data-rx-cc-delete>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
          <span>Delete contractor</span>
        </button>
        <div class="rx-form-hint" style="text-align:center">Deleting a contractor unlinks them from all equipment but does not affect service history.</div>
      `,
    });
  }

  RX.openOverlay({
    title:    isNew ? 'New contractor' : (c.name || 'Contractor'),
    subtitle: isNew ? null : ((tagsArr || []).slice(0, 3).join(' · ') || null),
    cards,
    saveLabel:   isNew ? 'Create contractor' : 'Save changes',
    cancelLabel: 'Cancel',
    state: {
      chips: { to: toArr, cc: ccArr, bcc: bccArr, phone: phoneArr, tags: tagsArr },
    },

    onMount: (overlay, state) => {
      // Email chip groups — same email validator across to/cc/bcc.
      ['to', 'cc', 'bcc'].forEach(kind => {
        RX.wireChipGroup(overlay, kind, state, {
          label: kind.toUpperCase(),
          inputType: 'email',
          inputMode: 'email',
          placeholder: 'email@example.com',
          addLabel: `Add ${kind.toUpperCase()}`,
          validate: emailValidator,
        });
      });
      // Phone chip group — different validator + input type.
      // Plus: keep the "Names for phones" sub-form below in sync.
      // When a phone is added, append a row. When removed, drop it.
      // When a name input changes, write to phoneLabels (used at save).
      const refreshPhoneNamesUI = () => {
        const wrap = overlay.querySelector('#rxCcPhoneNamesField');
        const list = overlay.querySelector('#rxCcPhoneNamesList');
        if (!wrap || !list) return;
        const phones = state.chips.phone || [];
        wrap.hidden = phones.length === 0;
        // Rebuild the list — small UI, no need to be incremental.
        list.innerHTML = phones.map(p => {
          const phone = (typeof p === 'string') ? p : (p && p.value) || '';
          const safePhone = (phone || '').replace(/"/g, '&quot;');
          const safeLabel = (phoneLabels[phone] || '').replace(/"/g, '&quot;');
          return `
            <div class="rx-cc-phone-name-row" data-phone="${safePhone}">
              <span class="rx-cc-phone-name-num">${safePhone}</span>
              <input class="rx-form-input rx-cc-phone-name-input" data-phone-label-for="${safePhone}" type="text" value="${safeLabel}" placeholder="dispatch · main · cell · Mike" maxlength="30" autocomplete="off">
            </div>
          `;
        }).join('');
        // Wire each input
        list.querySelectorAll('.rx-cc-phone-name-input').forEach(input => {
          input.addEventListener('input', () => {
            const phone = input.dataset.phoneLabelFor;
            phoneLabels[phone] = input.value || '';
            // Live-update the chip's "name · phone" meta display
            const chip = overlay.querySelector(`.rx-chip[data-rx-chip="${phone.replace(/"/g, '\\"')}"][data-kind="phone"]`);
            if (chip) {
              let metaEl = chip.querySelector('.rx-chip-meta');
              const removeBtn = chip.querySelector('.rx-chip-remove');
              if (input.value) {
                if (!metaEl) {
                  metaEl = document.createElement('span');
                  metaEl.className = 'rx-chip-meta';
                  if (removeBtn) chip.insertBefore(metaEl, removeBtn);
                }
                metaEl.textContent = input.value;
              } else if (metaEl) {
                metaEl.remove();
              }
            }
          });
        });
      };

      RX.wireChipGroup(overlay, 'phone', state, {
        label: 'PHONE',
        inputType: 'tel',
        inputMode: 'tel',
        placeholder: '(512) 555-1234',
        addLabel: 'Add phone',
        validate: phoneValidator,
        onAdd: () => refreshPhoneNamesUI(),
        onRemove: (removed) => {
          delete phoneLabels[removed];
          refreshPhoneNamesUI();
        },
      });
      // Initial wire — covers existing rows rendered server-side
      refreshPhoneNamesUI();
      // Tag chip group — no validator, free text.
      RX.wireChipGroup(overlay, 'tags', state, {
        placeholder: 'e.g. HVAC',
        addLabel: 'Add specialty',
      });

      // Delete button — confirm + clear FKs from equipment + delete + close
      const delBtn = overlay.querySelector('[data-rx-cc-delete]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete ${c.name}? This unlinks them from all equipment (both maintenance and repair roles).`)) return;
          try {
            // ─── PRECONDITION: clear FK references on equipment ─────────
            // The equipment table has FK constraints on service_contractor_node_id
            // and (after migration) repair_contractor_node_id. If those are
            // RESTRICT/NO ACTION, the DELETE on nodes fails with code 23503.
            // Pre-emptively NULL out both FKs (and the parallel name strings,
            // so the contractor doesn't reappear as a name-only loose link
            // after the FK is gone). This makes delete work whether the FK
            // is RESTRICT, SET NULL, or absent — the only safe ordering.
            // Repair columns are stripped on column-missing so pre-migration
            // databases still complete the delete.
            const clearMaint = NX.sb.from('equipment')
              .update({ service_contractor_node_id: null, service_contractor_name: null })
              .eq('service_contractor_node_id', c.id);
            const clearRepair = NX.sb.from('equipment')
              .update({ repair_contractor_node_id: null, repair_contractor_name: null })
              .eq('repair_contractor_node_id', c.id);
            const [mRes, rRes] = await Promise.all([clearMaint, clearRepair.then(r => r).catch(e => ({ error: e }))]);
            if (mRes.error) throw mRes.error;
            if (rRes.error && !/column.+repair_contractor.+does not exist/i.test(rRes.error.message || '')) {
              // Real error on repair clear (not just missing column) — bubble up.
              throw rRes.error;
            }

            const { error } = await NX.sb.from('nodes').delete().eq('id', c.id);
            if (error) throw error;
            if (NX.toast) NX.toast('Contractor deleted', 'info', 1400);
            RX.close();
            // Refresh the contractors list view if it's open.
            if (typeof contractorsState !== 'undefined' && contractorsState && contractorsState.overlay) {
              contractorsState.mode = 'list';
              contractorsState.activeId = null;
              contractorsState.activeContractor = null;
              if (typeof loadContractorsList === 'function') {
                await loadContractorsList();
              }
              if (typeof renderContractors === 'function') renderContractors();
            }
            // Also reload the global equipment array since we just
            // mutated FK columns on potentially many rows.
            if (typeof loadEquipment === 'function') {
              try { await loadEquipment(); } catch (_) {}
            }
          } catch (err) {
            console.error('[contractor] delete failed:', err);
            if (NX.toast) NX.toast('Failed to delete: ' + (err.message || ''), 'error', 4000);
          }
        });
      }
    },

    onSave: async (overlay, state) => {
      const name = (overlay.querySelector('[data-rx-cc-name]') || {}).value || '';
      if (!name.trim()) {
        if (NX.toast) NX.toast('Name is required', 'warn', 1800);
        return false;
      }
      const notes = (overlay.querySelector('[data-rx-cc-notes]') || {}).value || '';

      // Reconstruct nodes.links from the four chip groups.
      // Schema convention (matches existing extract* helpers):
      //   { phone, type:'phone', label }
      //   { email, type:'email', role: 'to'|'cc'|'bcc', label }
      const links = [];
      // Preserve any non-phone/email links already on the contractor
      // (URLs, etc.) so saving doesn't blow them away.
      const existingLinks = Array.isArray(c.links) ? c.links : [];
      for (const l of existingLinks) {
        if (!l) continue;
        const isPhone = (typeof l === 'object' && l.phone) || (typeof l === 'string' && /(?:tel:)?(\+?[\d\s().-]{7,})/.test(l));
        const isEmail = (typeof l === 'object' && l.email) || (typeof l === 'string' && /[\w.+-]+@[\w-]+\.[\w.-]+/.test(l));
        if (isPhone || isEmail) continue;
        links.push(l);
      }
      for (const ph of (state.chips.phone || [])) {
        const t = String(ph).trim();
        if (!t) continue;
        links.push({ phone: t, type: 'phone', label: phoneLabels[t] || null });
      }
      for (const em of (state.chips.to  || [])) { const t = String(em).trim(); if (t) links.push({ email: t, type: 'email', role: 'to'  }); }
      for (const em of (state.chips.cc  || [])) { const t = String(em).trim(); if (t) links.push({ email: t, type: 'email', role: 'cc'  }); }
      for (const em of (state.chips.bcc || [])) { const t = String(em).trim(); if (t) links.push({ email: t, type: 'email', role: 'bcc' }); }

      const tags = Array.from(new Set((state.chips.tags || []).map(t => String(t).trim()).filter(Boolean)));

      // Email template (subject + body). Empty strings → null so the
      // send flow knows to fall back to the standard built-in template.
      const subjectTpl = (overlay.querySelector('[data-rx-cc-subject]') || {}).value || '';
      const bodyTpl    = (overlay.querySelector('[data-rx-cc-body]')    || {}).value || '';

      const payload = {
        name: name.trim(),
        notes: notes.trim() || null,
        tags,
        links,
        subject_template: subjectTpl.trim() || null,
        body_template:    bodyTpl.trim()    || null,
      };

      // If the new template columns don't exist yet on the nodes table,
      // strip them and retry. The user can run the migration later
      // (`alter table nodes add column subject_template text`,
      //  `alter table nodes add column body_template text`) — until then,
      // every other field still saves cleanly.
      // Same pattern for the `kind` column — older databases don't have
      // it. The contractor save still works without it; `kind: 'org'`
      // is purely for sub-classifying nodes (org / person / equipment).
      const stripTplCols = (p) => {
        const { subject_template, body_template, ...rest } = p;
        return rest;
      };
      const stripKindCol = (p) => {
        const { kind, ...rest } = p;
        return rest;
      };
      const isMissingColumn = (err, ...names) => {
        const msg = (err && err.message) || '';
        return names.some(n =>
          new RegExp(`column.*${n}.*does not exist`, 'i').test(msg) ||
          new RegExp(`find.*['"\`]${n}['"\`] column`, 'i').test(msg)
        );
      };
      let templatesStripped = false;
      let kindStripped = false;

      try {
        if (isNew) {
          // Insert as a new node with category='contractors'.
          let insertPayload = { ...payload, category: 'contractors', kind: 'org' };
          let res = await NX.sb.from('nodes').insert(insertPayload).select('*').single();
          // If `kind` column is missing on the schema, strip + retry.
          if (res.error && isMissingColumn(res.error, 'kind')) {
            kindStripped = true;
            insertPayload = stripKindCol(insertPayload);
            res = await NX.sb.from('nodes').insert(insertPayload).select('*').single();
          }
          // If the template columns aren't on the schema yet, strip + retry
          if (res.error && isMissingColumn(res.error, 'subject_template', 'body_template')) {
            templatesStripped = true;
            insertPayload = stripTplCols(insertPayload);
            res = await NX.sb.from('nodes').insert(insertPayload).select('*').single();
          }
          if (res.error) throw res.error;
          if (NX.toast) NX.toast(templatesStripped
            ? 'Created — but email template not saved (run the SQL migration to enable)'
            : 'Contractor created', templatesStripped ? 'warn' : 'info', templatesStripped ? 5000 : 1400);
          // Refresh list + open detail
          if (typeof loadContractors === 'function') await loadContractors();
          if (typeof renderContractors === 'function') renderContractors();
        } else {
          let updatePayload = { ...payload };
          let res = await NX.sb.from('nodes').update(updatePayload).eq('id', c.id);
          // Same strip-on-missing-column pattern for updates
          if (res.error && isMissingColumn(res.error, 'kind')) {
            kindStripped = true;
            updatePayload = stripKindCol(updatePayload);
            res = await NX.sb.from('nodes').update(updatePayload).eq('id', c.id);
          }
          if (res.error && isMissingColumn(res.error, 'subject_template', 'body_template')) {
            templatesStripped = true;
            updatePayload = stripTplCols(updatePayload);
            res = await NX.sb.from('nodes').update(updatePayload).eq('id', c.id);
          }
          if (res.error) throw res.error;
          // Update the in-memory copy so subsequent reads (e.g. the email
          // PM flow) see the new roles immediately.
          Object.assign(c, payload);
          if (NX.toast) NX.toast(templatesStripped
            ? 'Saved — but email template not saved (DB columns missing)'
            : 'Saved', templatesStripped ? 'warn' : 'info', templatesStripped ? 5000 : 1200);
          // Refresh the detail view if it's currently rendered.
          if (typeof contractorsState !== 'undefined' && contractorsState && contractorsState.activeContractor && contractorsState.activeContractor.id === c.id) {
            Object.assign(contractorsState.activeContractor, payload);
            if (typeof renderContractors === 'function') renderContractors();
          }
        }
        return true;
      } catch (err) {
        console.error('[contractor] save failed:', err);
        if (NX.toast) NX.toast('Failed to save: ' + (err.message || ''), 'error', 3000);
        return false;
      }
    },
  });
  console.log('[openContractorEditor] RX.openOverlay returned successfully');
  } catch (err) {
    console.error('[openContractorEditor] threw:', err);
    if (NX.toast) NX.toast('openContractorEditor crashed: ' + (err && err.message), 'error', 6000);
  }
}


function contractorAvatar(c, size) {
  const name = (c && c.name) || '';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const sizeCls = size === 'lg' ? 'eq-contractor-avatar-lg'
                : size === 'md' ? 'eq-contractor-avatar-md'
                : 'eq-contractor-avatar-sm';
  return `<div class="eq-contractor-avatar ${sizeCls}" style="--mfg-hue:${hue}">${esc(initial)}</div>`;
}

function fmtContractorSince(ts) {
  if (!ts) return 'No activity yet';
  const d = new Date(ts);
  const diffDays = Math.round((Date.now() - d.getTime()) / 86400000);
  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.round(diffDays / 30)}mo ago`;
  return `${Math.round(diffDays / 365)}y ago`;
}

function renderContractors() {
  if (!contractorsState || !contractorsState.overlay) return;
  const { overlay, mode } = contractorsState;
  if (mode === 'detail') {
    renderContractorsDetail();
  } else {
    renderContractorsList();
  }
}

/* ─── List view ──────────────────────────────────────────────────── */

function renderContractorsList() {
  const { overlay, list, loading, error, search } = contractorsState;

  let bodyHTML;
  if (loading) {
    bodyHTML = `<div class="eq-contractors-loading">Loading contractors…</div>`;
  } else if (error) {
    bodyHTML = `<div class="eq-contractors-error">Couldn't load: ${esc(error)}</div>`;
  } else if (!list.length) {
    // ─── DIAGNOSTIC EMPTY STATE ────────────────────────────────────
    // We don't just say "no contractors yet" — we expose every fact
    // we can pull about the load attempt so the user can SEE why the
    // list is empty without devtools.
    const dbg = contractorsState._debug || {};
    bodyHTML = `
      <div class="eq-contractors-empty">
        <div class="eq-contractors-empty-title">No contractors yet</div>
        <div class="eq-contractors-empty-msg">Tap the <strong>+</strong> button at the top to add your first contractor.</div>
        <div style="margin-top:24px;padding:14px;background:rgba(212,164,78,0.05);border:1px dashed var(--nx-gold-line);border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--nx-faint);text-align:left;line-height:1.7">
          <div style="color:var(--nx-gold);margin-bottom:6px;font-weight:600">DIAGNOSTIC v41</div>
          <div>NX.sb defined: <strong>${typeof NX !== 'undefined' && NX.sb ? 'YES' : 'NO'}</strong></div>
          <div>Query rows returned: <strong>${dbg.rowCount ?? '—'}</strong></div>
          <div>Query error: <strong>${dbg.errMsg ? esc(dbg.errMsg) : '(none)'}</strong></div>
          <div>Query status: <strong>${dbg.status ?? '—'}</strong></div>
          <div>Equipment rows: <strong>${dbg.eqCount ?? '—'}</strong></div>
          <div>Maint rows: <strong>${dbg.maintCount ?? '—'}</strong></div>
          <div>Run at: <strong>${dbg.timestamp ?? '—'}</strong></div>
        </div>
      </div>`;
  } else {
    const q = (search || '').toLowerCase().trim();
    const filtered = q
      ? list.filter(c => {
          if ((c.name || '').toLowerCase().includes(q)) return true;
          const tags = extractContractorTags(c).map(t => t.toLowerCase());
          return tags.some(t => t.includes(q));
        })
      : list;

    if (!filtered.length) {
      bodyHTML = `<div class="eq-contractors-empty"><div class="eq-contractors-empty-msg">No contractors match "${esc(q)}".</div></div>`;
    } else {
      bodyHTML = `
        <div class="eq-contractors-list">
          ${filtered.map(renderContractorListCard).join('')}
        </div>
      `;
    }
  }

  overlay.innerHTML = `
    <div class="eq-contractors-head">
      <button class="eq-contractors-close" aria-label="Close contractors">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="eq-contractors-head-text">
        <div class="eq-contractors-title">Contractors</div>
        <div class="eq-contractors-sub">${list.length} ${list.length === 1 ? 'contractor' : 'contractors'} on file${(() => {
          const dupGroups = findContractorDuplicateGroups();
          return dupGroups.length ? ` · <span class="eq-contractors-dup-hint" data-action="dedupe">${dupGroups.length} duplicate ${dupGroups.length === 1 ? 'group' : 'groups'}</span>` : '';
        })()}</div>
      </div>
      <button class="eq-contractors-add" data-action="add" aria-label="Add new contractor">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>

    ${list.length > 4 ? `
      <div class="eq-contractors-search-wrap">
        <input type="search" class="eq-contractors-search" id="eqContractorsSearch" placeholder="Search by name or specialty…" value="${esc(search || '')}" autocomplete="off">
      </div>
    ` : ''}

    <div class="eq-contractors-body">
      ${bodyHTML}
    </div>
  `;

  overlay.querySelector('.eq-contractors-close').addEventListener('click', closeContractors);
  overlay.querySelector('[data-action="add"]').addEventListener('click', addNewContractor);
  overlay.querySelector('[data-action="dedupe"]')?.addEventListener('click', openDuplicateMergeOverlay);
  const searchInput = overlay.querySelector('#eqContractorsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      contractorsState.search = e.target.value;
      // Re-render only the list portion so the input doesn't lose focus.
      const body = overlay.querySelector('.eq-contractors-body');
      if (!body) return;
      const q = (contractorsState.search || '').toLowerCase().trim();
      const filtered = q
        ? list.filter(c => {
            if ((c.name || '').toLowerCase().includes(q)) return true;
            const tags = extractContractorTags(c).map(t => t.toLowerCase());
            return tags.some(t => t.includes(q));
          })
        : list;
      body.innerHTML = filtered.length
        ? `<div class="eq-contractors-list">${filtered.map(renderContractorListCard).join('')}</div>`
        : `<div class="eq-contractors-empty"><div class="eq-contractors-empty-msg">No contractors match "${esc(q)}".</div></div>`;
      // Re-wire the row clicks.
      body.querySelectorAll('[data-contractor-id]').forEach(card => {
        card.addEventListener('click', () => openContractorDetail(card.dataset.contractorId));
      });
    });
  }

  overlay.querySelectorAll('[data-contractor-id]').forEach(card => {
    card.addEventListener('click', () => openContractorDetail(card.dataset.contractorId));
  });
}

function renderContractorListCard(c) {
  const phone = extractContractorPhone(c);
  const tags = extractContractorTags(c);
  const lastSeen = c._lastActivity ? fmtContractorSince(c._lastActivity) : null;
  // Stats — compact mono format. No "YTD" suffix; the year context is
  // implied. Helps the line fit on one row even when chevron + lastSeen
  // are eating the right edge.
  const stats = [];
  if (c._assignedCount)   stats.push(`${c._assignedCount} assigned`);
  if (c._historicalCount) stats.push(`${c._historicalCount} serviced`);
  if (c._callsYtd)        stats.push(`${c._callsYtd} call${c._callsYtd === 1 ? '' : 's'}`);

  // Meta line bundles phone + tags + "last seen" in one row. This keeps
  // the right column reserved JUST for the chevron, giving the card
  // body the full width without awkward two-line wraps.
  const metaParts = [];
  if (phone)        metaParts.push(`<span class="eq-contractor-card-phone">${esc(phone)}</span>`);
  if (tags.length)  metaParts.push(`<span class="eq-contractor-card-tags">${tags.slice(0, 3).map(t => esc(t)).join(' · ')}</span>`);
  if (lastSeen)     metaParts.push(`<span class="eq-contractor-card-when-inline">${esc(lastSeen)}</span>`);

  return `
    <div class="eq-contractor-card" data-contractor-id="${esc(c.id)}">
      ${contractorAvatar(c, 'md')}
      <div class="eq-contractor-card-body">
        <div class="eq-contractor-card-name">${esc(c.name)}</div>
        ${metaParts.length ? `<div class="eq-contractor-card-meta">${metaParts.join('<span class="eq-contractor-card-sep">·</span>')}</div>` : ''}
        ${stats.length ? `<div class="eq-contractor-card-stats">${stats.join(' · ')}</div>` : ''}
      </div>
      <div class="eq-contractor-card-chev">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `;
}

/* ─── Detail view ────────────────────────────────────────────────── */

async function openContractorDetail(contractorId) {
  if (!contractorsState) return;
  const c = contractorsState.list.find(x => x.id == contractorId);
  if (!c) return;

  contractorsState.mode = 'detail';
  contractorsState.activeId = contractorId;
  contractorsState.activeContractor = c;
  contractorsState.detailTab = 'activity';
  contractorsState.editing = false;

  // Build the activity feed and equipment lists from already-loaded data.
  buildContractorDetailDerived();
  renderContractors();
}

/**
 * Unassign one piece of equipment from a contractor. Per-role aware: if
 * the equipment is linked as both repair AND maintenance, we ask which
 * role to clear; if only one, we just clear that one with confirmation.
 *
 * Always nulls BOTH the FK column and the matching plain-text name so
 * the equipment side stops referencing this contractor in any form.
 * Phone is preserved (it's just a free-text contact number — clearing
 * it would require manual re-entry if the user wanted to keep calling
 * the same number under a new contractor).
 *
 * Tolerates the repair_contractor_* migration not being run yet — only
 * touches columns that actually exist (fall back on column-missing).
 */
async function unassignEquipmentFromContractor(eq, contractor) {
  if (!eq || !contractor) return;
  const both = eq._isMaint && eq._isRepair;

  // Decide which role(s) to clear.
  let clearMaint  = false;
  let clearRepair = false;
  if (both) {
    const choice = (window.prompt(
      `Unassign ${eq.name} from ${contractor.name}?\n\n` +
      `Linked as BOTH repair and maintenance.\n\n` +
      `Type:\n  R = unassign as Repair only\n  M = unassign as Maintenance only\n  B = unassign Both\n\n` +
      `Or cancel to keep all links.`,
      'B'
    ) || '').trim().toUpperCase();
    if (!choice) return; // cancel
    if (choice === 'R')      clearRepair = true;
    else if (choice === 'M') clearMaint  = true;
    else if (choice === 'B') { clearMaint = true; clearRepair = true; }
    else { NX.toast && NX.toast('Cancelled — type R, M, or B', 'info', 1800); return; }
  } else if (eq._isMaint) {
    if (!confirm(`Unassign ${eq.name} from ${contractor.name} as the maintenance contractor?`)) return;
    clearMaint = true;
  } else if (eq._isRepair) {
    if (!confirm(`Unassign ${eq.name} from ${contractor.name} as the repair contractor?`)) return;
    clearRepair = true;
  } else {
    return;
  }

  const update = {};
  if (clearMaint) {
    update.service_contractor_node_id = null;
    update.service_contractor_name    = null;
  }
  if (clearRepair) {
    update.repair_contractor_node_id = null;
    update.repair_contractor_name    = null;
  }
  // Don't write columns that the migration hasn't created yet.
  try {
    let res = await NX.sb.from('equipment').update(update).eq('id', eq.id);
    if (res.error && /column.+repair_contractor.+does not exist/i.test(res.error.message || '')) {
      const stripped = { ...update };
      delete stripped.repair_contractor_node_id;
      delete stripped.repair_contractor_name;
      if (Object.keys(stripped).length === 0) {
        // Nothing left to update — the only thing to clear was the
        // repair role and the column doesn't exist yet.
        NX.toast && NX.toast('Repair contractor column missing — run the SQL migration first', 'warn', 4000);
        return;
      }
      res = await NX.sb.from('equipment').update(stripped).eq('id', eq.id);
    }
    if (res.error) throw res.error;
    NX.toast && NX.toast(`${eq.name} unassigned`, 'success', 1600);

    // Refresh: reload contractor list + equipment lite so the next
    // detail render reflects the new state.
    contractorsState.loading = true;
    renderContractors();
    if (typeof loadEquipment === 'function') await loadEquipment();
    await loadContractorsList();
    const refreshed = contractorsState.list.find(x => x.id == contractor.id);
    if (refreshed) {
      contractorsState.activeContractor = refreshed;
      buildContractorDetailDerived();
    }
    contractorsState.loading = false;
    renderContractors();
  } catch (err) {
    console.error('[equipment] unassignEquipmentFromContractor:', err);
    NX.toast && NX.toast('Could not unassign: ' + (err.message || ''), 'error', 4000);
  }
}

function buildContractorDetailDerived() {
  const c = contractorsState.activeContractor;
  if (!c) return;

  const allEqLite = contractorsState.equipmentLite || [];
  const issues = c._issues || [];
  const maint = c._maint || [];

  // Apply the active location filter ("profile") — same pattern the
  // ordering module uses: switching the pill switches the entire view's
  // data scope. activeLocation === 'all' means show every restaurant.
  // We filter equipmentLite first, then derive everything else from
  // that filtered set so equipment, activity, and stats are all
  // consistently scoped to the same restaurant.
  const activeLoc = contractorsState.activeLocation || 'all';
  const eqLite = activeLoc === 'all'
    ? allEqLite
    : allEqLite.filter(e => (e.location || '') === activeLoc);

  // Activity feed — interleave maintenance + issues, sort desc by date.
  // When a location filter is active, drop events whose equipment lives
  // at a different restaurant. Events whose equipment record is missing
  // are dropped only when filtered (we can't tell their location).
  const events = [];
  for (const m of maint) {
    const eq = eqLite.find(e => e.id === m.equipment_id);
    if (activeLoc !== 'all' && !eq) continue;
    events.push({
      type: 'maintenance',
      date: m.event_date,
      title: m.event_type ? m.event_type.replace(/_/g, ' ') : 'Service',
      description: m.description || '',
      cost: parseFloat(m.cost) || 0,
      equipment: eq,
      raw: m,
    });
  }
  for (const i of issues) {
    const eq = eqLite.find(e => e.id === i.equipment_id);
    if (activeLoc !== 'all' && !eq) continue;
    events.push({
      type: 'issue',
      date: i.reported_at,
      title: 'Issue assigned',
      description: i.contractor_name || c.name,
      status: i.status,
      equipment: eq,
      raw: i,
    });
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  contractorsState.activity = events;

  // Equipment assignments + historical.
  // Two paths to "assigned" PER ROLE:
  //   maintenance: service_contractor_node_id FK | service_contractor_name string
  //   repair:      repair_contractor_node_id  FK | repair_contractor_name  string
  // Equipment in the name-string buckets can be promoted to FK via a
  // one-tap action in the Equipment tab. Each row is tagged with role
  // flags so the UI can show MAINT/REPAIR chips and per-role unassign.
  const nameLower = (c.name || '').toLowerCase().trim();
  const matchMaintFk   = (e) => e.service_contractor_node_id == c.id;
  const matchRepairFk  = (e) => e.repair_contractor_node_id  == c.id;
  const matchMaintName = (e) => nameLower && (e.service_contractor_name || '').toLowerCase().trim() === nameLower;
  const matchRepairName= (e) => nameLower && (e.repair_contractor_name  || '').toLowerCase().trim() === nameLower;

  contractorsState.assignedEquipment = eqLite.filter(e =>
    matchMaintFk(e) || matchRepairFk(e) || matchMaintName(e) || matchRepairName(e)
  );
  // Per-role + per-link-type flags for renderContractorEquipmentTab.
  for (const e of contractorsState.assignedEquipment) {
    e._isMaint       = matchMaintFk(e)  || matchMaintName(e);
    e._isRepair      = matchRepairFk(e) || matchRepairName(e);
    e._maintLinkType = matchMaintFk(e)  ? 'fk' : (matchMaintName(e)  ? 'name' : null);
    e._repairLinkType= matchRepairFk(e) ? 'fk' : (matchRepairName(e) ? 'name' : null);
    // Legacy flag — true if ANY link is name-only. The "Promote name-only
    // links" button keys off this so it can upgrade both FKs in one pass.
    e._linkType = (e._maintLinkType === 'fk' || e._repairLinkType === 'fk') ? 'fk' : 'name';
  }
  const assignedIds = new Set(contractorsState.assignedEquipment.map(e => e.id));
  const servicedIds = new Set(maint.map(m => m.equipment_id));
  contractorsState.historicalEquipment = eqLite.filter(e =>
    servicedIds.has(e.id) && !assignedIds.has(e.id)
  );

  // ─── SCOPED STATS for the summary cards ───────────────────────────
  // When a location filter is active, the global per-contractor stats
  // computed in loadContractorsList no longer match what the user is
  // looking at. Recompute the four dashboard numbers (assigned, calls
  // YTD, avg response, spend YTD) from the *filtered* dataset so the
  // summary card reads the same restaurant the equipment + activity
  // lists are showing. activeLocation === 'all' bypasses recomputation
  // and falls back to the cheap precomputed globals.
  if (activeLoc === 'all') {
    contractorsState.scopedStats = null; // signals "use c._* globals"
  } else {
    const ytdCutoff = new Date(new Date().getFullYear(), 0, 1);
    const scopedMaint = events.filter(ev => ev.type === 'maintenance' && new Date(ev.date) >= ytdCutoff);
    const scopedIssues = events.filter(ev => ev.type === 'issue');
    const responseHrs = scopedIssues
      .map(ev => ev.raw)
      .filter(i => i.contractor_called_at && i.reported_at)
      .map(i => (new Date(i.contractor_called_at) - new Date(i.reported_at)) / 3600000);
    contractorsState.scopedStats = {
      assignedCount: contractorsState.assignedEquipment.length,
      callsYtd: scopedMaint.length,
      ytdSpend: scopedMaint.reduce((s, ev) => s + (parseFloat(ev.cost) || 0), 0),
      avgResponseHrs: responseHrs.length
        ? Math.round(responseHrs.reduce((s, r) => s + r, 0) / responseHrs.length * 10) / 10
        : null,
    };
  }
}

function renderContractorsDetail() {
  const { overlay, activeContractor: c, detailTab, editing } = contractorsState;
  if (!c) {
    contractorsState.mode = 'list';
    renderContractors();
    return;
  }

  const phone = extractContractorPhone(c);
  const email = extractContractorEmail(c);
  const tags = extractContractorTags(c);
  // Per-location scoped stats — populated by buildContractorDetailDerived
  // when activeLocation is anything other than 'all'. When it's 'all',
  // scoped is null and we fall back to the cheap precomputed globals
  // hanging off the contractor record (c._assignedCount, c._callsYtd, …).
  const scoped = contractorsState.scopedStats || null;

  let tabBody;
  if (detailTab === 'activity') {
    tabBody = renderContractorActivityTab();
  } else if (detailTab === 'equipment') {
    tabBody = renderContractorEquipmentTab();
  } else if (detailTab === 'edit') {
    tabBody = renderContractorEditTab();
  }

  overlay.innerHTML = `
    <div class="eq-contractors-head">
      <button class="eq-contractors-back" aria-label="Back to contractors list">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="eq-contractors-head-text">
        <div class="eq-contractors-title">${esc(c.name)}</div>
        <div class="eq-contractors-sub">
          ${tags.length
            ? tags.slice(0, 3).map(t => esc(t)).join(' · ')
            : 'Contractor'}
        </div>
      </div>
      ${phone ? `
        <a class="eq-contractors-call" href="tel:${esc(phone.replace(/\s+/g, ''))}" aria-label="Call ${esc(c.name)}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </a>
      ` : ''}
    </div>

    <div class="eq-contractor-loc-picker" role="tablist" aria-label="Restaurant profile">
      <button class="eq-contractor-loc-btn${(contractorsState.activeLocation || 'all') === 'all' ? ' active' : ''}" data-loc="all" role="tab" aria-selected="${(contractorsState.activeLocation || 'all') === 'all' ? 'true' : 'false'}">All</button>
      ${LOCATIONS.map(loc => {
        const label = loc.replace(/^Bar\s+/i, '');
        const isActive = (contractorsState.activeLocation || 'all') === loc;
        return `<button class="eq-contractor-loc-btn${isActive ? ' active' : ''}" data-loc="${esc(loc)}" role="tab" aria-selected="${isActive ? 'true' : 'false'}">${esc(label)}</button>`;
      }).join('')}
    </div>

    <div class="eq-contractor-summary">
      ${contractorAvatar(c, 'lg')}
      <div class="eq-contractor-summary-stats">
        <div class="eq-contractor-stat">
          <div class="eq-contractor-stat-value">${(scoped ? scoped.assignedCount : c._assignedCount) || 0}</div>
          <div class="eq-contractor-stat-label">Assigned</div>
        </div>
        <div class="eq-contractor-stat">
          <div class="eq-contractor-stat-value">${(scoped ? scoped.callsYtd : c._callsYtd) || 0}</div>
          <div class="eq-contractor-stat-label">Calls YTD</div>
        </div>
        <div class="eq-contractor-stat">
          <div class="eq-contractor-stat-value">${(scoped ? scoped.avgResponseHrs : c._avgResponseHrs) != null ? fmtResponseHrs(scoped ? scoped.avgResponseHrs : c._avgResponseHrs) : '—'}</div>
          <div class="eq-contractor-stat-label">Avg Response</div>
        </div>
        <div class="eq-contractor-stat">
          <div class="eq-contractor-stat-value">${formatMoney((scoped ? scoped.ytdSpend : c._ytdSpend) || 0)}</div>
          <div class="eq-contractor-stat-label">Spend YTD</div>
        </div>
      </div>
    </div>

    <div class="eq-contractors-tabs" role="tablist">
      <button class="eq-contractors-tab${detailTab === 'activity' ? ' is-active' : ''}" data-detail-tab="activity">Activity</button>
      <button class="eq-contractors-tab${detailTab === 'equipment' ? ' is-active' : ''}" data-detail-tab="equipment">Equipment</button>
      <button class="eq-contractors-tab${detailTab === 'edit' ? ' is-active' : ''}" data-detail-tab="edit">Edit</button>
    </div>

    <div class="eq-contractors-body">
      ${tabBody}
    </div>

    ${(phone || email) && detailTab !== 'edit' ? `
      <div class="eq-contractors-foot">
        ${email ? `
          <a class="eq-contractors-foot-btn eq-contractors-foot-btn-secondary" href="mailto:${esc(email)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Email
          </a>
        ` : ''}
        ${phone ? `
          <a class="eq-contractors-foot-btn eq-contractors-foot-btn-primary" href="tel:${esc(phone.replace(/\s+/g, ''))}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Call ${esc(phone)}
          </a>
        ` : ''}
      </div>
    ` : ''}
  `;

  overlay.querySelector('.eq-contractors-back').addEventListener('click', () => {
    contractorsState.mode = 'list';
    contractorsState.activeId = null;
    contractorsState.activeContractor = null;
    contractorsState.editing = false;
    renderContractors();
  });

  // Location pill picker — same UX shape as ordering's ord-loc-picker.
  // Switching pill = switching the entire detail's data scope to that
  // restaurant. The choice persists to localStorage so the next session
  // opens to whatever profile the user was last looking at.
  overlay.querySelectorAll('.eq-contractor-loc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const loc = btn.dataset.loc || 'all';
      if (loc === contractorsState.activeLocation) return;
      contractorsState.activeLocation = loc;
      try { localStorage.setItem('nexus.contractors.activeLocation', loc); } catch (_) {}
      buildContractorDetailDerived();
      renderContractors();
    });
  });
  overlay.querySelectorAll('[data-detail-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      // ─── DEEP DIAGNOSTICS ─────────────────────────────────────────────
      // Every step toasts a marker so we can see exactly where the chain
      // dies. If you tap Edit and see no toasts at all, the click never
      // reaches this handler (something is blocking the event upstream
      // — overlay covering the button, etc).
      //
      // v15.4: success-path toasts removed. They're noise once everything
      // works. FAILURE toasts remain — they only fire when something is
      // actually broken, so they stay quiet during normal operation.
      // Console logs at every step also remain (silent unless dev tools
      // are open) so failures are still traceable post-mortem.
      // ─────────────────────────────────────────────────────────────────
      if (btn.dataset.detailTab === 'edit') {
        // Step 1 — handler reached
        console.log('[contractors:edit] step 1 — click handler running', { btn });

        // Step 2 — engine present
        if (!window.NX || !NX.recordEditor) {
          if (NX.toast) NX.toast('[2/5] FAIL: NX.recordEditor missing — record-editor.js did not load', 'error', 5000);
          console.error('[contractors:edit] step 2 FAIL — NX.recordEditor missing', { NX: window.NX });
          return;
        }
        console.log('[contractors:edit] step 2 — engine loaded');

        // Step 3 — function present
        if (typeof openContractorEditor !== 'function') {
          if (NX.toast) NX.toast('[3/5] FAIL: openContractorEditor undefined — equipment.js did not load this build', 'error', 5000);
          console.error('[contractors:edit] step 3 FAIL — openContractorEditor undefined');
          return;
        }
        console.log('[contractors:edit] step 3 — openContractorEditor is a function');

        // Step 4 — contractor present
        const c = contractorsState && contractorsState.activeContractor;
        if (!c) {
          if (NX.toast) NX.toast('[4/5] FAIL: activeContractor is null — go back, tap contractor again', 'warn', 5000);
          console.warn('[contractors:edit] step 4 FAIL — activeContractor is null', { contractorsState });
          return;
        }
        console.log('[contractors:edit] step 4 — contractor', c);

        // Step 5 — call the function
        try {
          console.log('[contractors:edit] step 5 — calling openContractorEditor');
          openContractorEditor(c);
        } catch (err) {
          if (NX.toast) NX.toast('[5/5] THREW: ' + (err && err.message), 'error', 6000);
          console.error('[contractors:edit] step 5 THREW', err);
          return;
        }

        // Step 6 — verify the overlay actually mounted to the DOM
        // The engine appends a .rx-overlay to body. If it's not there
        // 250ms after the call, the engine silently failed (no error
        // thrown). Most likely cause: the engine threw during onMount.
        setTimeout(() => {
          const rxOverlay = document.querySelector('.rx-overlay');
          if (!rxOverlay) {
            if (NX.toast) NX.toast('[5/5] FAIL: openOverlay returned but no .rx-overlay in DOM — engine silent fail', 'error', 6000);
            console.error('[contractors:edit] step 5 SILENT FAIL — no .rx-overlay element after 250ms');
            return;
          }
          // Check it's actually visible (not hidden by CSS)
          const rect = rxOverlay.getBoundingClientRect();
          const cs = getComputedStyle(rxOverlay);
          if (rect.width === 0 || rect.height === 0 || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
            if (NX.toast) NX.toast(`[5/5] FAIL: overlay in DOM but invisible (w=${rect.width} h=${rect.height} disp=${cs.display})`, 'error', 6000);
            console.error('[contractors:edit] step 5 INVISIBLE', { rect, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, zIndex: cs.zIndex });
            return;
          }
          console.log('[contractors:edit] step 5 SUCCESS — overlay in DOM, visible', { rect, zIndex: cs.zIndex });
        }, 250);

        return;
      }
      contractorsState.detailTab = btn.dataset.detailTab;
      renderContractors();
    });
  });

  // Tab-specific wiring.
  if (detailTab === 'edit') {
    wireContractorEditForm();
  } else if (detailTab === 'equipment') {
    overlay.querySelectorAll('[data-action="open-eq"]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.eqId;
        closeContractors();
        if (typeof openDetail === 'function') openDetail(id);
      });
    });
    // Per-row unassign — strip this contractor from one or both role
    // FKs/names on the equipment, depending on what's set. Kept in a
    // helper so it can be reused by future bulk-unassign flows.
    overlay.querySelectorAll('[data-action="unassign-eq"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.eqId;
        const eq = (contractorsState.assignedEquipment || []).find(x => x.id == id);
        if (!eq) return;
        await unassignEquipmentFromContractor(eq, contractorsState.activeContractor);
      });
    });
    // Promote name-only links to proper FK links.
    overlay.querySelector('[data-action="promote-all"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await promoteContractorNameLinks();
    });
    // Open assign-equipment multi-select sheet.
    overlay.querySelector('[data-action="assign-equipment"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openContractorAssignSheet();
    });
    // Open the bulk-PM scheduler with all currently-assigned equipment.
    overlay.querySelector('[data-action="bulk-pm"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      schedulePmsForContractor();
    });
    // Per-location PM scheduler — separate contracts per location, so
    // separate PM rounds. Each location header has its own button.
    overlay.querySelectorAll('[data-action="bulk-pm-loc"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        schedulePmsForContractor(btn.dataset.loc);
      });
    });
  } else if (detailTab === 'activity') {
    overlay.querySelectorAll('[data-event-eq-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.eventEqId;
        if (!id) return;
        closeContractors();
        if (typeof openDetail === 'function') openDetail(id);
      });
    });
  }
}

function fmtResponseHrs(hrs) {
  if (hrs == null) return '—';
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24 * 10) / 10}d`;
}

function renderContractorActivityTab() {
  const events = contractorsState.activity || [];
  if (!events.length) {
    return `
      <div class="eq-contractors-empty">
        <div class="eq-contractors-empty-title">No activity yet</div>
        <div class="eq-contractors-empty-msg">Once this contractor logs service calls or gets assigned to issues, the work history will populate here.</div>
      </div>
    `;
  }

  // Group by month for visual scannability.
  const groups = {};
  for (const ev of events) {
    const d = new Date(ev.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = { label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }), events: [] };
    groups[key].events.push(ev);
  }

  return Object.keys(groups).sort().reverse().map(key => {
    const g = groups[key];
    return `
      <div class="eq-contractor-activity-group">
        <div class="eq-contractor-activity-month">${esc(g.label)}</div>
        ${g.events.map(ev => {
          const dt = new Date(ev.date);
          const dateStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
          const eqId = ev.equipment ? ev.equipment.id : '';
          const eqName = ev.equipment ? ev.equipment.name : '(equipment removed)';
          const eqLoc = ev.equipment ? ev.equipment.location : '';
          const cls = ev.type === 'issue' ? 'eq-contractor-event-issue' : 'eq-contractor-event-maintenance';
          return `
            <div class="eq-contractor-activity-row ${cls}" ${eqId ? `data-event-eq-id="${esc(eqId)}"` : ''}>
              <div class="eq-contractor-activity-date">${esc(dateStr)}</div>
              <div class="eq-contractor-activity-body">
                <div class="eq-contractor-activity-title">${esc(ev.title)}${ev.cost ? ` · ${formatMoney(ev.cost)}` : ''}</div>
                <div class="eq-contractor-activity-eq">${esc(eqName)}${eqLoc ? ` · ${esc(eqLoc)}` : ''}</div>
                ${ev.description ? `<div class="eq-contractor-activity-desc">${esc(ev.description)}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

function renderContractorEquipmentTab() {
  // ─── BUGFIX 2026-05-08 ──────────────────────────────────────────────
  // Earlier build referenced `c.name` inside renderEqRow without defining
  // `c` here. Result: a ReferenceError mid-template-literal that aborted
  // every render of this tab, so tapping the Equipment header tab in the
  // contractor detail did nothing visible (Activity stayed shown). Pull
  // the active contractor up here so renderEqRow can read its name for
  // the per-row unassign tooltip without crashing.
  const c = (contractorsState && contractorsState.activeContractor) || { name: 'this contractor' };
  const assigned = contractorsState.assignedEquipment || [];
  const historical = contractorsState.historicalEquipment || [];

  // Top-level actions: assign more equipment, or schedule PMs across
  // ALL assigned (one button). Per-location PM scheduling lives inside
  // each location group below — separate contracts per location, so
  // separate PM rounds.
  const topActions = `
    <div class="eq-contractor-eq-actions">
      <button class="eq-contractor-eq-action-btn eq-contractor-eq-action-primary" data-action="assign-equipment">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Assign equipment to this contractor
      </button>
    </div>
  `;

  if (!assigned.length && !historical.length) {
    return `
      ${topActions}
      <div class="eq-contractors-empty">
        <div class="eq-contractors-empty-title">No equipment linked yet</div>
        <div class="eq-contractors-empty-msg">Tap <strong>Assign equipment</strong> above to multi-pick units this contractor is in charge of, or set the contractor on a piece of equipment via its editor's Links tab.</div>
      </div>
    `;
  }

  // Group ASSIGNED equipment by location. With 3 restaurants (Suerte,
  // Este, Bar Toti) the contractor likely has separate contracts per
  // location, so we surface each location as its own group with its
  // own bulk-PM trigger. The user can run a separate PM round at each
  // restaurant in one tap.
  const byLocation = new Map();
  for (const e of assigned) {
    const loc = (e.location || 'Unspecified').trim() || 'Unspecified';
    if (!byLocation.has(loc)) byLocation.set(loc, []);
    byLocation.get(loc).push(e);
  }
  // Sort locations alphabetically; within each, sort equipment by name.
  const locationGroups = Array.from(byLocation.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([loc, items]) => [loc, items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))]);

  // Count loose name-matched links across the whole assigned set.
  const looseCount = assigned.filter(e => e._linkType === 'name').length;

  const renderEqRow = (e) => {
    const isLooseM = e._maintLinkType  === 'name';
    const isLooseR = e._repairLinkType === 'name';
    const isLoose = isLooseM || isLooseR;
    return `
      <div class="eq-contractor-eq-row${isLoose ? ' is-loose-link' : ''}" data-eq-id="${esc(e.id)}">
        <div class="eq-contractor-eq-body-text" data-action="open-eq" data-eq-id="${esc(e.id)}">
          <div class="eq-contractor-eq-name">
            ${esc(e.name)}
            ${isLoose ? '<span class="eq-contractor-eq-loose-chip" title="Linked by name only — tap Promote to make permanent">↗ name only</span>' : ''}
          </div>
          <div class="eq-contractor-eq-roles">
            ${e._isMaint  ? '<span class="eq-contractor-eq-role-chip eq-contractor-eq-role-maint"  title="Maintenance contractor (scheduled PMs)">MAINT</span>'  : ''}
            ${e._isRepair ? '<span class="eq-contractor-eq-role-chip eq-contractor-eq-role-repair" title="Repair contractor (powers public QR Call button)">REPAIR</span>' : ''}
          </div>
          <div class="eq-contractor-eq-meta">${e.area ? esc(e.area) + ' · ' : ''}${e.manufacturer ? esc(e.manufacturer) : ''}${e.model ? ' ' + esc(e.model) : ''}</div>
        </div>
        <button class="eq-contractor-eq-unassign-btn" data-action="unassign-eq" data-eq-id="${esc(e.id)}" title="Unassign this equipment from ${esc(c.name)}" aria-label="Unassign">
          ${uiSvg('close', '13px')}
        </button>
      </div>
    `;
  };

  return `
    ${topActions}
    ${locationGroups.length ? locationGroups.map(([loc, items]) => `
      <div class="eq-contractor-loc-group">
        <div class="eq-contractor-loc-header">
          <div class="eq-contractor-loc-name">${esc(loc)}</div>
          <div class="eq-contractor-loc-count">${items.length} ${items.length === 1 ? 'unit' : 'units'}</div>
        </div>
        <div class="eq-contractor-eq-list">${items.map(renderEqRow).join('')}</div>
        <button class="eq-contractor-loc-pm-btn" data-action="bulk-pm-loc" data-loc="${esc(loc)}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Schedule PMs · ${esc(loc)} · ${items.length}
        </button>
      </div>
    `).join('') : ''}

    ${looseCount > 0 ? `
      <div class="eq-contractor-loc-promote">
        <button class="eq-contractor-eq-promote-btn" data-action="promote-all">Promote ${looseCount} name-only ${looseCount === 1 ? 'link' : 'links'} to permanent</button>
      </div>
    ` : ''}

    ${assigned.length > 1 ? `
      <button class="eq-contractor-eq-action-btn eq-contractor-eq-action-secondary" data-action="bulk-pm" style="margin-top:14px">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Schedule PMs · all ${assigned.length} across all locations
      </button>
    ` : ''}

    ${historical.length ? `
      <div class="eq-contractor-eq-group-label" style="margin-top:18px">Previously serviced · ${historical.length}</div>
      <div class="eq-contractor-eq-list">${historical.map(renderEqRow).join('')}</div>
    ` : ''}
  `;
}

function renderContractorEditTab() {
  const c = contractorsState.activeContractor;
  if (!c) return '';
  const phones = extractContractorPhones(c);
  const emails = extractContractorEmails(c);
  const tags = extractContractorTags(c);

  // Ensure at least one row of each so the form is fillable from empty.
  const phoneRows = phones.length ? phones : [{ phone: '', label: '' }];
  const emailRows = emails.length ? emails : [{ email: '', role: 'to', label: '' }];

  return `
    <form class="eq-contractor-edit-form" id="eqContractorEditForm">
      <div class="eq-contractor-edit-field">
        <label class="eq-contractor-edit-label" for="ccName">Name</label>
        <input class="eq-contractor-edit-input" id="ccName" name="name" type="text" value="${esc(c.name || '')}" required>
      </div>

      <div class="eq-contractor-edit-field">
        <label class="eq-contractor-edit-label">
          Phones
          <span class="eq-contractor-edit-hint">— first one powers the Call button on QR scan</span>
        </label>
        <div class="eq-contractor-multi-list" id="ccPhoneList">
          ${phoneRows.map((p, i) => `
            <div class="eq-contractor-multi-row" data-multi="phone">
              <input class="eq-contractor-edit-input eq-contractor-multi-input" name="phone[]" type="tel" value="${esc(p.phone || '')}" placeholder="(512) 800-2228">
              <input class="eq-contractor-edit-input eq-contractor-multi-label" name="phone_label[]" type="text" value="${esc(p.label || '')}" placeholder="${i === 0 ? 'main · dispatch · cell' : 'after-hours · cell · etc'}" maxlength="20">
              <button type="button" class="eq-contractor-multi-remove" data-action="remove" aria-label="Remove">×</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="eq-contractor-multi-add" data-add="phone">+ Add another phone</button>
      </div>

      <div class="eq-contractor-edit-field">
        <label class="eq-contractor-edit-label">
          Emails
          <span class="eq-contractor-edit-hint">— first one is the recipient; mark others as CC to send copies</span>
        </label>
        <div class="eq-contractor-multi-list" id="ccEmailList">
          ${emailRows.map((e, i) => `
            <div class="eq-contractor-multi-row" data-multi="email">
              <input class="eq-contractor-edit-input eq-contractor-multi-input" name="email[]" type="email" value="${esc(e.email || '')}" placeholder="dispatch@vendor.com">
              <select class="eq-contractor-edit-input eq-contractor-multi-role" name="email_role[]">
                <option value="to" ${e.role === 'to' || !e.role ? 'selected' : ''}>TO</option>
                <option value="cc" ${e.role === 'cc' ? 'selected' : ''}>CC</option>
                <option value="bcc" ${e.role === 'bcc' ? 'selected' : ''}>BCC</option>
              </select>
              <button type="button" class="eq-contractor-multi-remove" data-action="remove" aria-label="Remove">×</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="eq-contractor-multi-add" data-add="email">+ Add another email</button>
      </div>

      <div class="eq-contractor-edit-field">
        <label class="eq-contractor-edit-label" for="ccTags">In charge of <span class="eq-contractor-edit-hint">— comma-separated specialties (refrigeration, HVAC, plumbing)</span></label>
        <input class="eq-contractor-edit-input" id="ccTags" name="tags" type="text" value="${esc(tags.join(', '))}" placeholder="refrigeration, ice machines, walk-ins">
      </div>
      <div class="eq-contractor-edit-field">
        <label class="eq-contractor-edit-label" for="ccNotes">Notes <span class="eq-contractor-edit-hint">— hours, address, billing rate, anything else</span></label>
        <textarea class="eq-contractor-edit-textarea" id="ccNotes" name="notes" rows="5" placeholder="M-F 8a-6p · Saturdays after-hours · $125/hr labor + parts at cost · Service area: Austin metro">${esc(c.notes || '')}</textarea>
      </div>
      <div class="eq-contractor-edit-actions">
        <button type="button" class="eq-contractor-edit-btn eq-contractor-edit-btn-danger" data-action="delete">
          Delete contractor
        </button>
        <button type="submit" class="eq-contractor-edit-btn eq-contractor-edit-btn-primary">
          Save changes
        </button>
      </div>
    </form>
  `;
}

function wireContractorEditForm() {
  const overlay = contractorsState.overlay;
  const form = overlay.querySelector('#eqContractorEditForm');
  if (!form) return;

  // Wire + Add and × Remove buttons for the multi-row phone/email lists.
  const wireMultiRow = (row) => {
    row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
      const list = row.parentElement;
      // Don't allow removing the last row — keep at least one for the
      // user to type into. Just clear its values instead.
      if (list && list.children.length === 1) {
        row.querySelectorAll('input, select').forEach(el => {
          if (el.tagName === 'SELECT') el.selectedIndex = 0;
          else el.value = '';
        });
        return;
      }
      row.remove();
    });
  };
  form.querySelectorAll('.eq-contractor-multi-row').forEach(wireMultiRow);

  form.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.add;
      const list = form.querySelector(kind === 'phone' ? '#ccPhoneList' : '#ccEmailList');
      if (!list) return;
      const row = document.createElement('div');
      row.className = 'eq-contractor-multi-row';
      row.dataset.multi = kind;
      if (kind === 'phone') {
        row.innerHTML = `
          <input class="eq-contractor-edit-input eq-contractor-multi-input" name="phone[]" type="tel" value="" placeholder="(512) 555-1234">
          <input class="eq-contractor-edit-input eq-contractor-multi-label" name="phone_label[]" type="text" value="" placeholder="after-hours · cell" maxlength="20">
          <button type="button" class="eq-contractor-multi-remove" data-action="remove" aria-label="Remove">×</button>
        `;
      } else {
        row.innerHTML = `
          <input class="eq-contractor-edit-input eq-contractor-multi-input" name="email[]" type="email" value="" placeholder="dispatch@vendor.com">
          <select class="eq-contractor-edit-input eq-contractor-multi-role" name="email_role[]">
            <option value="to">TO</option>
            <option value="cc" selected>CC</option>
            <option value="bcc">BCC</option>
          </select>
          <button type="button" class="eq-contractor-multi-remove" data-action="remove" aria-label="Remove">×</button>
        `;
      }
      list.appendChild(row);
      wireMultiRow(row);
      row.querySelector('input')?.focus();
    });
  });

  // ─── SAVE WIRING (v40) — proof-of-life on click ──────────────────
  // Aggressive instrumentation: we wire BOTH click AND pointerdown
  // AND touchend to the save button. The very first thing each handler
  // does is change the button text to "Saving…" — visible proof the
  // event fired. If you tap save and the button text doesn't change,
  // NO event handler is firing at all, which points to a blocker
  // (z-index, pointer-events, an overlay capturing the touch).
  const saveBtn = form.querySelector('button[type="submit"]');
  if (saveBtn) {
    let saveInFlight = false;
    const handleSave = async (e, source) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (saveInFlight) return;
      saveInFlight = true;
      // INSTANT visible feedback so you know the event fired.
      saveBtn.textContent = `Saving… (${source})`;
      saveBtn.disabled = true;
      try {
        await saveContractorChanges(form, saveBtn);
      } finally {
        // Reset only if we're still on this form — otherwise the form
        // may have been torn down by a re-render during save success.
        if (saveBtn.isConnected) {
          saveBtn.disabled = false;
          saveBtn.textContent = saveBtn.dataset.origLabel || 'Save changes';
        }
        saveInFlight = false;
      }
    };
    saveBtn.dataset.origLabel = saveBtn.textContent || 'Save changes';
    saveBtn.addEventListener('click',     (e) => handleSave(e, 'click'));
    saveBtn.addEventListener('pointerdown', (e) => handleSave(e, 'pointer'));
    // Form submit (Enter key) as a final fallback
    form.addEventListener('submit', (e) => handleSave(e, 'submit'));
  }

  form.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const c = contractorsState.activeContractor;
    if (!confirm(`Delete ${c.name}? This will unlink them from all equipment (both maintenance and repair roles).`)) return;
    try {
      // Clear FK references on equipment first — same precondition as
      // the rx-overlay delete path. See that handler for the full
      // rationale (FK RESTRICT vs SET NULL, pre-migration safety).
      const clearMaint = NX.sb.from('equipment')
        .update({ service_contractor_node_id: null, service_contractor_name: null })
        .eq('service_contractor_node_id', c.id);
      const clearRepair = NX.sb.from('equipment')
        .update({ repair_contractor_node_id: null, repair_contractor_name: null })
        .eq('repair_contractor_node_id', c.id);
      const [mRes, rRes] = await Promise.all([clearMaint, clearRepair.then(r => r).catch(e => ({ error: e }))]);
      if (mRes.error) throw mRes.error;
      if (rRes.error && !/column.+repair_contractor.+does not exist/i.test(rRes.error.message || '')) {
        throw rRes.error;
      }

      const { error } = await NX.sb.from('nodes').delete().eq('id', c.id);
      if (error) throw error;
      contractorsState.list = contractorsState.list.filter(x => x.id !== c.id);
      contractorsState.mode = 'list';
      contractorsState.activeId = null;
      contractorsState.activeContractor = null;
      renderContractors();
      NX.toast && NX.toast('Contractor deleted', 'info', 1200);
      // Reload equipment so the now-orphaned FKs are reflected app-wide.
      if (typeof loadEquipment === 'function') {
        try { await loadEquipment(); } catch (_) {}
      }
    } catch (err) {
      console.error('[equipment] deleteContractor:', err);
      NX.toast && NX.toast('Could not delete: ' + (err.message || ''), 'error', 4000);
    }
  });
}

/**
 * Standalone contractor save function. Called by both the click handler
 * on the save button (primary path) and the form submit (Enter-key
 * fallback). Heavily instrumented — every step shows a diagnostic
 * toast or surfaces a clear error so a stuck save can be debugged
 * from the UI without opening DevTools.
 */
async function saveContractorChanges(form, saveBtn) {
  // Loud first-line toast — proves saveContractorChanges actually ran.
  // If you don't see this toast when you tap Save, the button click
  // isn't reaching this function and we have a wiring problem upstream.
  NX.toast && NX.toast('💾 Save fired — building payload…', 'info', 1400);

  if (!form || !contractorsState) {
    NX.toast && NX.toast('Form vanished — try reopening the contractor', 'error', 3000);
    return;
  }
  const c = contractorsState.activeContractor;
  if (!c || !c.id) {
    NX.toast && NX.toast('No contractor loaded — try reopening', 'error', 3000);
    return;
  }
  if (!NX.sb) {
    NX.toast && NX.toast('Supabase not connected', 'error', 3000);
    return;
  }

  try {
    // ─── Collect form values ────────────────────────────────────────
    const name = (form.querySelector('[name="name"]')?.value || '').trim();
    if (!name) {
      NX.toast && NX.toast('Name is required', 'warn', 1800);
      return;
    }
    const tagsRaw = form.querySelector('[name="tags"]')?.value || '';
    const notes = (form.querySelector('[name="notes"]')?.value || '').trim();
    const tags = tagsRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean);

    const phones = [];
    form.querySelectorAll('.eq-contractor-multi-row[data-multi="phone"]').forEach(row => {
      const phone = (row.querySelector('[name="phone[]"]')?.value || '').trim();
      const label = (row.querySelector('[name="phone_label[]"]')?.value || '').trim();
      if (phone) phones.push({ phone, type: 'phone', label: label || null });
    });

    const emails = [];
    form.querySelectorAll('.eq-contractor-multi-row[data-multi="email"]').forEach(row => {
      const email = (row.querySelector('[name="email[]"]')?.value || '').trim();
      const role = row.querySelector('[name="email_role[]"]')?.value || 'to';
      if (email) emails.push({ email, type: 'email', role });
    });

    const existingLinks = (c.links && Array.isArray(c.links)) ? c.links : [];
    const otherLinks = existingLinks.filter(l => {
      if (l && typeof l === 'object' && (l.phone || l.email)) return false;
      const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
      if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(str)) return false;
      if (/(?:tel:)?(\+?[\d\s().-]{10,})/.test(str)) return false;
      return true;
    });
    const newLinks = [...otherLinks, ...phones, ...emails];

    const payload = { name, notes: notes || null, tags, links: newLinks };
    console.log('[saveContractor] id=%s payload=', c.id, payload);

    // No auth gate here — NEXUS uses PIN auth, not Supabase Auth, so
    // auth.getUser() always returns null. Authorization is handled
    // entirely by the nodes_anon_all RLS policy (USING=true,
    // WITH_CHECK=true) which lets the anon role write.

    // ─── Do the update ──────────────────────────────────────────────
    const { data, error, status, statusText } = await NX.sb.from('nodes')
      .update(payload)
      .eq('id', c.id)
      .select('*');

    console.log('[saveContractor] response:', { status, statusText, error, returnedRows: data?.length });

    if (error) {
      console.error('[saveContractor] DB error:', error);
      NX.toast && NX.toast(
        `DB error: ${error.message || error.code || 'unknown'}`,
        'error',
        4000
      );
      return;
    }

    if (!data || !data.length) {
      // Update succeeded but returned no rows. Most common cause: RLS
      // SELECT policy doesn't let this user read the row they just
      // updated. The data was written but the round-trip can't return.
      // We trust the write succeeded and update local state anyway.
      console.warn('[saveContractor] update returned 0 rows — likely RLS SELECT policy missing');
      NX.toast && NX.toast(
        'Saved (but RLS may be blocking reads — check Supabase policies)',
        'warn',
        3500
      );
      Object.assign(c, payload);
    } else {
      Object.assign(c, data[0]);
      NX.toast && NX.toast(
        `Saved · ${phones.length} ${phones.length === 1 ? 'phone' : 'phones'} · ${emails.length} ${emails.length === 1 ? 'email' : 'emails'}`,
        'success',
        1800
      );
    }

    // Re-derive UI state (best-effort).
    try { buildContractorDetailDerived(); } catch (e) { console.warn(e); }
    contractorsState.detailTab = 'activity';
    renderContractors();

    // Reload list from DB so the next list render is fresh.
    try {
      await loadContractorsList();
      const refreshed = contractorsState.list.find(x => x.id == c.id);
      if (refreshed) {
        contractorsState.activeContractor = refreshed;
        buildContractorDetailDerived();
        renderContractors();
      } else {
        console.warn('[saveContractor] row not found in fresh list — RLS SELECT may be blocking');
      }
    } catch (reloadErr) {
      console.warn('[saveContractor] reload failed (non-fatal):', reloadErr);
    }
  } catch (err) {
    console.error('[saveContractor] unexpected:', err);
    NX.toast && NX.toast(`Save crashed: ${err.message || err}`, 'error', 4000);
  }
  // Note: button label/disabled state is reset by the wrapper handler
  // in wireContractorEditForm.handleSave's finally block, not here.
}

/**
 * Bulk-upgrade equipment that's "linked by name only" (matches the
 * contractor's name string in equipment.service_contractor_name but has no
 * service_contractor_node_id FK) to a proper FK link. Also propagates
 * the contractor's phone to equipment.service_contractor_phone if the equipment
 * row's phone is missing.
 *
 * This is the "the contractor and equipment now talk to each other" fix
 * — once promoted, both sides carry the same identity and changing the
 * contractor's phone in one place will be picked up everywhere via the
 * existing lookupServicePhoneFromNode helper.
 */
async function promoteContractorNameLinks() {
  if (!contractorsState || !contractorsState.activeContractor) return;
  const c = contractorsState.activeContractor;
  const loose = (contractorsState.assignedEquipment || []).filter(e => e._linkType === 'name');
  if (!loose.length) return;

  if (!confirm(
    `Link ${loose.length} equipment ${loose.length === 1 ? 'unit' : 'units'} to ${c.name} permanently?\n\n` +
    `This sets the FK on each equipment row so the contractor's contact info syncs automatically. The equipment's typed name + phone stays as-is.`
  )) return;

  const phone = extractContractorPhone(c);
  const ids = loose.map(e => e.id);

  try {
    // Build update payload — set FK on every loose-linked equipment.
    // We don't overwrite service_contractor_phone if the equipment already has one;
    // we just fill it from the contractor when blank.
    let updated = 0;
    for (const eq of loose) {
      const update = { service_contractor_node_id: c.id };
      if (!eq.service_contractor_phone && phone) update.service_contractor_phone = phone;
      const { error } = await NX.sb.from('equipment').update(update).eq('id', eq.id);
      if (error) throw error;
      updated++;
    }

    NX.toast && NX.toast(`Linked ${updated} equipment to ${c.name}`, 'success', 1800);

    // Refresh: rebuild assignment derivations against the updated FK values.
    // The simplest path is to reload the contractor list which re-derives
    // all the assignment data.
    contractorsState.loading = true;
    renderContractors();
    await loadContractorsList();
    // Re-resolve the active contractor (its underlying ref may be stale).
    const refreshed = contractorsState.list.find(x => x.id == c.id);
    if (refreshed) {
      contractorsState.activeContractor = refreshed;
      buildContractorDetailDerived();
    }
    contractorsState.loading = false;
    renderContractors();
  } catch (e) {
    console.error('[equipment] promoteContractorNameLinks:', e);
    NX.toast && NX.toast('Could not promote: ' + (e.message || ''), 'error');
  }
}

/**
 * Multi-select bottom sheet — pick equipment to assign to the active
 * contractor. Same idiom as the parts-compatibility bulk-apply sheet:
 * checkbox row per eligible piece of equipment, same-category units
 * floated to top with a "MATCHES SPECIALTY" badge, single confirm
 * button does a batch update of service_contractor_node_id.
 *
 * "Eligible" = equipment NOT already assigned to this contractor.
 * Equipment already assigned to a *different* contractor is included
 * but with a warning chip — assigning steals it from the other.
 */
function openContractorAssignSheet() {
  if (!contractorsState || !contractorsState.activeContractor) return;
  const c = contractorsState.activeContractor;
  const eqListAll = (typeof equipment !== 'undefined' && equipment) ? equipment : (contractorsState.equipmentLite || []);
  // Honor the active location profile — the pill at the top of the detail
  // view sets a scope, and the assign sheet should respect it so the user
  // sees only the restaurant they're currently working in. 'all' falls
  // through unchanged. This keeps the picker scannable on a phone screen
  // and prevents cross-location mistakes (assigning a Suerte unit to
  // a contractor while looking at the Este profile).
  const activeLoc = (contractorsState.activeLocation || 'all');
  const eqList = activeLoc === 'all' ? eqListAll : eqListAll.filter(e => (e.location || '') === activeLoc);
  // Already assigned (FK-linked) IDs to exclude — covers BOTH role FKs.
  const assignedIds = new Set();
  for (const e of (contractorsState.assignedEquipment || [])) {
    // Only exclude if already FK-linked in BOTH roles. If the equipment
    // is FK-linked in only one role, we want the user to be able to
    // pick the other role here.
    if (e._maintLinkType === 'fk' && e._repairLinkType === 'fk') {
      assignedIds.add(e.id);
    }
  }
  const candidates = eqList.filter(e => !assignedIds.has(e.id));

  if (!candidates.length) {
    NX.toast && NX.toast(activeLoc === 'all'
      ? 'All equipment is already assigned to this contractor in both roles'
      : `No assignable equipment at ${activeLoc} (already linked, or none on file)`, 'info', 2200);
    return;
  }

  // Sort: equipment whose category matches one of the contractor's
  // specialties floats to the top (most likely candidates).
  const tags = extractContractorTags(c).map(t => t.toLowerCase());
  const matchesSpecialty = (e) => {
    const cat = (e.category || '').toLowerCase();
    return tags.some(t => t.includes(cat) || cat.includes(t));
  };
  candidates.sort((a, b) => {
    const aM = matchesSpecialty(a) ? 1 : 0;
    const bM = matchesSpecialty(b) ? 1 : 0;
    if (aM !== bM) return bM - aM;
    return (a.name || '').localeCompare(b.name || '');
  });

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  const selected = new Set();
  // Default role: "both". Most contractors do both. The user can flip
  // to repair-only or maintenance-only if they want a specialist.
  let role = 'both'; // 'both' | 'repair' | 'maintenance'

  const renderSheet = () => {
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Assign equipment to ${esc(c.name)}</div>
        <div class="eq-bulk-sheet-sub">Pick the units this contractor is in charge of, then choose the role. Public QR codes call the <strong>repair</strong> contractor; PMs go to the <strong>maintenance</strong> contractor.</div>

        <div class="eq-bulk-role-picker" role="radiogroup" aria-label="Assignment role">
          <button type="button" class="eq-bulk-role-btn ${role === 'both' ? 'is-active' : ''}" data-role="both">
            <span class="eq-bulk-role-label">Both</span>
            <span class="eq-bulk-role-hint">repair + maintenance</span>
          </button>
          <button type="button" class="eq-bulk-role-btn ${role === 'repair' ? 'is-active' : ''}" data-role="repair">
            <span class="eq-bulk-role-label">Repair only</span>
            <span class="eq-bulk-role-hint">QR Call button</span>
          </button>
          <button type="button" class="eq-bulk-role-btn ${role === 'maintenance' ? 'is-active' : ''}" data-role="maintenance">
            <span class="eq-bulk-role-label">Maintenance only</span>
            <span class="eq-bulk-role-hint">scheduled PMs</span>
          </button>
        </div>

        <div class="eq-bulk-sheet-list">
          ${candidates.map(e => {
            // Bug fix 2026-05-08: data-id from HTML is always a string while
            // e.id from Supabase comes back as an integer. selected.has() does
            // strict equality on Set keys, so storing "123" and checking 123
            // never matched — checkmarks would render briefly then vanish on
            // every re-render. Stringify both sides so the comparison is stable
            // regardless of whether equipment.id is integer or uuid.
            const eid = String(e.id);
            const isSel = selected.has(eid);
            const matches = matchesSpecialty(e);
            // Warn if this slot is already held by a DIFFERENT contractor.
            const conflictMaint  = role !== 'repair'      && e.service_contractor_node_id && e.service_contractor_node_id !== c.id;
            const conflictRepair = role !== 'maintenance' && e.repair_contractor_node_id  && e.repair_contractor_node_id  !== c.id;
            const conflict = conflictMaint || conflictRepair;
            return `
              <button class="eq-bulk-sheet-item eq-bulk-apply-item ${isSel ? 'is-selected' : ''} ${matches ? 'is-same-brand' : ''}" data-id="${esc(eid)}" type="button">
                <div class="eq-bulk-apply-check">
                  ${isSel ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </div>
                <div class="eq-bulk-sheet-item-text">
                  <div class="eq-bulk-sheet-item-name">${esc(e.name)}</div>
                  <div class="eq-bulk-sheet-item-sub">${esc(e.location || '')}${e.manufacturer ? ' · ' + esc(e.manufacturer) : ''}${e.model ? ' ' + esc(e.model) : ''}${conflict ? ' · ⚠ replaces existing' : ''}</div>
                </div>
                ${matches ? '<span class="eq-bulk-apply-badge">MATCHES</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
        <button class="eq-bulk-sheet-confirm" data-action="confirm" ${selected.size === 0 ? 'disabled' : ''} type="button">
          Assign ${selected.size} ${selected.size === 1 ? 'unit' : 'units'} as ${role === 'both' ? 'repair + maintenance' : role}
        </button>
        <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.querySelectorAll('[data-role]').forEach(btn => {
      btn.addEventListener('click', () => {
        role = btn.dataset.role;
        renderSheet();
      });
    });
    overlay.querySelectorAll('[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (selected.has(id)) selected.delete(id);
        else                  selected.add(id);
        renderSheet();
      });
    });
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', applyConfirm);
  };

  const close = () => overlay.remove();

  const applyConfirm = async () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    const phone = extractContractorPhone(c);
    const writeMaint  = role === 'both' || role === 'maintenance';
    const writeRepair = role === 'both' || role === 'repair';
    try {
      let updated = 0;
      let repairColumnsMissing = false;
      for (const id of ids) {
        // ids holds stringified equipment ids; equipment.id from Supabase
        // is numeric. Use loose equality so the candidate lookup matches
        // regardless of side. Supabase's .eq() filter coerces types
        // server-side so passing the string to PostgREST is fine.
        const eq = candidates.find(e => String(e.id) === id);
        const update = {};
        if (writeMaint) {
          update.service_contractor_node_id = c.id;
          update.service_contractor_name = c.name;
          if (phone && eq && !eq.service_contractor_phone) update.service_contractor_phone = phone;
        }
        if (writeRepair) {
          update.repair_contractor_node_id = c.id;
          update.repair_contractor_name = c.name;
          if (phone && eq && !eq.repair_contractor_phone) update.repair_contractor_phone = phone;
        }
        let res = await NX.sb.from('equipment').update(update).eq('id', id);
        if (res.error && /column.+repair_contractor.+does not exist/i.test(res.error.message || '')) {
          repairColumnsMissing = true;
          const stripped = { ...update };
          delete stripped.repair_contractor_node_id;
          delete stripped.repair_contractor_name;
          delete stripped.repair_contractor_phone;
          if (Object.keys(stripped).length === 0) continue; // repair-only and no migration — skip
          res = await NX.sb.from('equipment').update(stripped).eq('id', id);
        }
        if (res.error) throw res.error;
        updated++;
      }
      if (repairColumnsMissing) {
        NX.toast && NX.toast(`${updated} updated — but repair role NOT stored (run the SQL migration)`, 'warn', 5000);
      } else {
        NX.toast && NX.toast(`${updated} ${updated === 1 ? 'unit' : 'units'} assigned to ${c.name}`, 'success', 1800);
      }
      close();

      // Refresh — reload contractor list so derivations update.
      contractorsState.loading = true;
      renderContractors();
      // Also reload the global equipment array so the new FK reflects in the
      // main equipment list view next time it's opened.
      if (typeof loadEquipment === 'function') await loadEquipment();
      await loadContractorsList();
      const refreshed = contractorsState.list.find(x => x.id == c.id);
      if (refreshed) {
        contractorsState.activeContractor = refreshed;
        buildContractorDetailDerived();
      }
      contractorsState.loading = false;
      renderContractors();
    } catch (err) {
      console.error('[equipment] openContractorAssignSheet:', err);
      NX.toast && NX.toast('Could not assign: ' + (err.message || ''), 'error');
    }
  };

  document.body.appendChild(overlay);
  renderSheet();
}

/**
 * Pre-seed the bulk-PM scheduler with every piece of equipment currently
 * assigned to the active contractor (FK-linked or name-linked). Opens
 * the existing scheduler sheet which lets the user pick a date and
 * apply it to all selected at once.
 *
 * If a `locationFilter` string is passed, only equipment at that
 * location is pre-selected — used by the per-location buttons in each
 * location group. The user has 3 restaurants (Suerte, Este, Bar Toti)
 * and each may run on its own PM cadence even with the same contractor.
 *
 * The user's mental model: "schedule next PM for everything Austin
 * Air and Ice handles AT BAR TOTI" → one tap.
 */
function schedulePmsForContractor(locationFilter) {
  if (!contractorsState || !contractorsState.activeContractor) return;
  const c = contractorsState.activeContractor;
  let assigned = contractorsState.assignedEquipment || [];
  if (locationFilter) {
    assigned = assigned.filter(e =>
      ((e.location || '').trim() || 'Unspecified') === locationFilter
    );
  }
  if (!assigned.length) {
    NX.toast && NX.toast(
      locationFilter
        ? `No equipment at ${locationFilter} for this contractor`
        : 'No equipment is assigned to this contractor yet',
      'warn', 1800
    );
    return;
  }
  if (!bulkSelectionState) return;

  const ids = assigned.map(e => e.id);
  bulkSelectionState.active = true;
  bulkSelectionState.selected = new Set(ids);
  document.body.classList.add('eq-bulk-mode');
  // Close the contractor overlay so the bulk PM sheet has the surface.
  closeContractors();
  // Re-render the equipment list to show selection highlights.
  if (typeof renderList === 'function') renderList();
  if (typeof renderBulkToolbar === 'function') renderBulkToolbar();
  // Open the scheduler sheet.
  if (typeof openBulkPmSchedule === 'function') {
    openBulkPmSchedule();
  }
  const label = locationFilter
    ? `${ids.length} ${ids.length === 1 ? 'unit' : 'units'} at ${locationFilter}`
    : `${ids.length} ${ids.length === 1 ? 'unit' : 'units'} from ${c.name}`;
  NX.toast && NX.toast(`Pre-selected ${label}`, 'info', 1500);
}

/**
 * Group contractors by case-insensitive name match. Returns groups of
 * 2+ contractors that share a name. Used to surface duplicates so the
 * user can merge them (combining phones/emails/notes/tags and
 * reassigning equipment).
 *
 * Naming variation handling: we strip leading "+", trailing whitespace,
 * collapse internal whitespace, and lowercase before matching. So
 * "Austin Air and Ice", "austin air and ice ", and " Austin Air And Ice"
 * all collapse to the same group.
 */
function findContractorDuplicateGroups() {
  if (!contractorsState || !contractorsState.list) return [];
  const groups = new Map();
  for (const c of contractorsState.list) {
    const key = (c.name || '')
      .toLowerCase()
      .replace(/^\+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  // Only return groups with 2+ entries.
  return Array.from(groups.values()).filter(g => g.length > 1);
}

/**
 * Pick the canonical contractor from a duplicate group. Heuristic:
 *   1. Most data (phones + emails + tags + notes length) — preserve work
 *   2. Most recent activity — likely the "active" record
 *   3. Oldest created_at — original record
 * The canonical absorbs all data from the others and keeps its own ID.
 */
function pickCanonicalContractor(group) {
  const score = (c) => {
    const phones = extractContractorPhones(c).length;
    const emails = extractContractorEmails(c).length;
    const tags   = (c.tags || []).length;
    const notes  = (c.notes || '').length;
    const data   = phones * 5 + emails * 5 + tags * 3 + Math.min(notes / 20, 10);
    const lastT  = c._lastActivity ? new Date(c._lastActivity).getTime() : 0;
    const oldT   = c.created_at ? new Date(c.created_at).getTime() : Date.now();
    // Higher score = better canonical.
    return data * 1000 + (lastT / 1e10) - (oldT / 1e12);
  };
  return [...group].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Open the merge overlay. Lists every duplicate group with side-by-side
 * preview of all entries. User taps "Merge" → we run the merge in DB
 * and refresh.
 */
function openDuplicateMergeOverlay() {
  const groups = findContractorDuplicateGroups();
  if (!groups.length) {
    NX.toast && NX.toast('No duplicates found', 'info', 1400);
    return;
  }

  // Sort groups by size (most duplicates first), then by name.
  groups.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return (a[0].name || '').localeCompare(b[0].name || '');
  });

  // Tear down any existing overlay so consecutive opens don't stack.
  document.querySelectorAll('.eq-dedupe-overlay').forEach(n => n.remove());

  const overlay = document.createElement('div');
  overlay.className = 'eq-dedupe-overlay';
  overlay.innerHTML = `
    <div class="eq-dedupe-backdrop"></div>
    <div class="eq-dedupe-panel">
      <div class="eq-dedupe-head">
        <button class="eq-dedupe-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="eq-dedupe-head-text">
          <div class="eq-dedupe-title">Find duplicates</div>
          <div class="eq-dedupe-sub">${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${groups.reduce((s, g) => s + g.length, 0)} contractors total</div>
        </div>
      </div>
      <div class="eq-dedupe-body">
        ${groups.map((group, idx) => {
          const canonical = pickCanonicalContractor(group);
          const others = group.filter(c => c.id !== canonical.id);
          return `
            <div class="eq-dedupe-group" data-group-idx="${idx}">
              <div class="eq-dedupe-group-name">${esc(group[0].name)}</div>
              <div class="eq-dedupe-group-cards">
                ${[canonical, ...others].map((c, ci) => {
                  const isCanon = c.id === canonical.id;
                  const phones  = extractContractorPhones(c);
                  const emails  = extractContractorEmails(c);
                  const tags    = (c.tags || []).filter(Boolean);
                  const equipCount = (contractorsState.equipmentLite || [])
                    .filter(e => e.service_contractor_node_id == c.id).length;
                  return `
                    <div class="eq-dedupe-card ${isCanon ? 'is-canonical' : ''}">
                      <div class="eq-dedupe-card-head">
                        <span class="eq-dedupe-card-id">#${c.id}</span>
                        ${isCanon ? '<span class="eq-dedupe-card-keep">KEEP</span>' : '<span class="eq-dedupe-card-merge">MERGE IN</span>'}
                      </div>
                      <div class="eq-dedupe-card-stats">
                        ${phones.length ? `<div>📞 ${phones.length} ${phones.length === 1 ? 'phone' : 'phones'}</div>` : ''}
                        ${emails.length ? `<div>✉ ${emails.length} ${emails.length === 1 ? 'email' : 'emails'}</div>` : ''}
                        ${tags.length   ? `<div>🏷 ${tags.slice(0, 3).map(esc).join(', ')}</div>` : ''}
                        ${equipCount    ? `<div>🔧 ${equipCount} equipment linked</div>` : ''}
                        ${c.notes       ? `<div>📝 has notes</div>` : ''}
                        ${c._lastActivity ? `<div>🕒 active ${fmtContractorSince(c._lastActivity)}</div>` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
              <button class="eq-dedupe-merge-btn" data-action="merge-group" data-group-idx="${idx}">
                Merge ${group.length} into one
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.eq-dedupe-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.eq-dedupe-backdrop').addEventListener('click', () => overlay.remove());

  overlay.querySelectorAll('[data-action="merge-group"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.groupIdx, 10);
      const group = groups[idx];
      if (!group) return;
      const canonical = pickCanonicalContractor(group);
      const others = group.filter(c => c.id !== canonical.id);
      if (!confirm(
        `Merge ${group.length} "${group[0].name}" records into one?\n\n` +
        `• Phones, emails, tags, and notes from all ${group.length} records will be combined into the master record (#${canonical.id})\n` +
        `• Equipment assigned to the duplicates will be reassigned to the master\n` +
        `• The ${others.length} duplicate ${others.length === 1 ? 'record' : 'records'} will be deleted\n\n` +
        `This can't be undone. Proceed?`
      )) return;

      btn.disabled = true;
      btn.textContent = 'Merging…';
      try {
        await mergeContractorGroup(canonical, others);
        NX.toast && NX.toast(`Merged ${group.length} → 1`, 'success', 1800);
        // Remove this group's card from the overlay (or close if it was the last).
        const groupEl = overlay.querySelector(`.eq-dedupe-group[data-group-idx="${idx}"]`);
        if (groupEl) groupEl.remove();
        const remaining = overlay.querySelectorAll('.eq-dedupe-group').length;
        if (!remaining) {
          overlay.remove();
        }
        // Reload list so the contractors view reflects the merged state.
        contractorsState.loading = true;
        renderContractors();
        await loadContractorsList();
        contractorsState.loading = false;
        renderContractors();
      } catch (err) {
        console.error('[mergeContractorGroup] failed:', err);
        NX.toast && NX.toast(`Merge failed: ${err.message || ''}`, 'error', 3500);
        btn.disabled = false;
        btn.textContent = `Merge ${group.length} into one`;
      }
    });
  });
}

/**
 * The actual merge — called per group. Steps:
 *   1. Build combined links/tags/notes by deduping across all records
 *   2. Update the canonical record with the merged data
 *   3. Re-point any equipment.service_contractor_node_id from a dupe to canonical
 *   4. Delete the duplicate records
 *
 * If any step fails, the canonical update may have already happened —
 * but it's idempotent, so re-running the merge later is safe.
 */
async function mergeContractorGroup(canonical, others) {
  if (!NX.sb || !canonical) throw new Error('No DB or canonical contractor');
  if (!others.length) return;

  const all = [canonical, ...others];

  // ─── 1. Combine phones (dedupe by digits) ───────────────────────
  const seenPhones = new Set();
  const allPhones = [];
  for (const c of all) {
    for (const p of extractContractorPhones(c)) {
      const key = (p.phone || '').replace(/\D/g, '');
      if (!key || seenPhones.has(key)) continue;
      seenPhones.add(key);
      allPhones.push({ phone: p.phone, type: 'phone', label: p.label || null });
    }
  }

  // ─── 2. Combine emails (dedupe by lowercased) ───────────────────
  const seenEmails = new Set();
  const allEmails = [];
  for (const c of all) {
    for (const e of extractContractorEmails(c)) {
      const key = (e.email || '').toLowerCase().trim();
      if (!key || seenEmails.has(key)) continue;
      seenEmails.add(key);
      allEmails.push({ email: e.email, type: 'email', role: e.role || 'to' });
    }
  }

  // ─── 3. Combine non-phone/email links ───────────────────────────
  const otherLinks = [];
  for (const c of all) {
    const links = Array.isArray(c.links) ? c.links : [];
    for (const l of links) {
      if (l && typeof l === 'object' && (l.phone || l.email)) continue; // already handled
      const str = (typeof l === 'string') ? l : (l?.url || l?.href || '');
      if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(str)) continue;
      if (/(?:tel:)?(\+?[\d\s().-]{10,})/.test(str)) continue;
      otherLinks.push(l);
    }
  }

  // ─── 4. Combine tags + notes ────────────────────────────────────
  const tagSet = new Set();
  for (const c of all) {
    for (const t of (c.tags || [])) {
      if (t && t.trim()) tagSet.add(t.trim());
    }
  }
  const allTags = Array.from(tagSet);

  const notesParts = all
    .map(c => (c.notes || '').trim())
    .filter(Boolean);
  // Dedupe identical notes.
  const seenNotes = new Set();
  const uniqueNotes = notesParts.filter(n => {
    if (seenNotes.has(n)) return false;
    seenNotes.add(n);
    return true;
  });
  const mergedNotes = uniqueNotes.length
    ? uniqueNotes.join('\n\n— —\n\n')
    : null;

  // Pick the cleanest name (the canonical's, but stripped of leading +/digits
  // if it's a phone-number-name from auto-creation).
  let mergedName = canonical.name;
  for (const c of all) {
    const n = (c.name || '').trim();
    // Prefer a name without a leading + or pure digits — that's a real
    // company name vs an auto-created phone-only entry.
    if (n && !/^\+?\d/.test(n) && /[a-zA-Z]/.test(n)) {
      mergedName = n;
      break;
    }
  }

  const mergedLinks = [...otherLinks, ...allPhones, ...allEmails];

  // ─── 5. Update the canonical record ─────────────────────────────
  const { error: upErr } = await NX.sb.from('nodes').update({
    name: mergedName,
    notes: mergedNotes,
    tags: allTags,
    links: mergedLinks,
  }).eq('id', canonical.id);
  if (upErr) throw new Error('Update canonical failed: ' + upErr.message);

  // ─── 6. Reassign equipment from duplicates to canonical ─────────
  const dupIds = others.map(c => c.id);
  if (dupIds.length) {
    const { error: eqErr } = await NX.sb.from('equipment')
      .update({ service_contractor_node_id: canonical.id })
      .in('service_contractor_node_id', dupIds);
    if (eqErr) {
      // Non-fatal — log and continue. The canonical is already merged;
      // worst case some equipment still points at the (about to be
      // deleted) duplicate, which our SET NULL on delete would handle.
      console.warn('[mergeContractor] equipment reassign failed:', eqErr);
    }
  }

  // ─── 7. Delete the duplicates ───────────────────────────────────
  if (dupIds.length) {
    const { error: delErr } = await NX.sb.from('nodes')
      .delete()
      .in('id', dupIds);
    if (delErr) throw new Error('Delete duplicates failed: ' + delErr.message);
  }
}

async function addNewContractor() {
  // Open the shared editor with an empty contractor. The engine's
  // onSave handler runs the actual INSERT once the user fills in name
  // (and any contacts they want pre-set). Avoids the old two-step flow:
  // prompt for name → DB insert → open detail → switch to edit tab.
  if (typeof openContractorEditor === 'function') {
    openContractorEditor(null);
    return;
  }
  // Legacy fallback if the editor function isn't loaded for some reason.
  const name = prompt('New contractor name:');
  if (!name || !name.trim()) return;
  try {
    const { data, error } = await NX.sb.from('nodes').insert({
      name: name.trim(),
      category: 'contractors',
      tags: [],
      links: [],
    }).select('*').single();
    if (error) throw error;
    Object.assign(data, {
      _maint: [], _issues: [],
      _callsYtd: 0, _ytdSpend: 0, _totalCalls: 0,
      _avgResponseHrs: null, _lastActivity: null,
      _assignedCount: 0, _historicalCount: 0,
    });
    contractorsState.list.unshift(data);
    NX.toast && NX.toast('Contractor added — fill in their details', 'info', 1500);
    openContractorDetail(data.id);
    contractorsState.detailTab = 'edit';
    renderContractors();
  } catch (e) {
    console.error('[equipment] addNewContractor:', e);
    NX.toast && NX.toast('Could not add: ' + (e.message || ''), 'error');
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   20. LONG-PRESS ACTIONS — expanding dial on equipment rows
   ════════════════════════════════════════════════════════════════════════════
   Long-press an equipment row for 2 seconds → expanding action dial
   slides up with bulk-mode entry, contractor email, issue tracker, and
   schedule PM. Mirrors the duties speed-dial visual idiom (stacked
   label-chip + gold-circle rows above the bottom nav, with staggered
   slide-up animation and dimming backdrop blur).

   While holding:
     • A radial progress ring fills around the touch point
     • Subtle haptic vibration when the threshold is reached (iOS/Android)
     • The row visually compresses (scale 0.985) to give tactile feedback

   On release before 2s: timer cancels, ring fades, no action.
   Significant finger movement (>10px): timer cancels (it was a scroll).
   At 2s: dial opens. The row that was held becomes the active selection.

   Wired into both list rows (.eq-row) and grid cards (.eq-card).
   ════════════════════════════════════════════════════════════════════════════ */

const LONGPRESS_DURATION_MS = 1000;          // 1.0s hold to trigger
const LONGPRESS_MOVE_TOLERANCE = 10;         // pixels of movement that cancels
let longpressState = null;
let lastLongPressFireAt = 0;   // ms timestamp of the most recent long-press fire
let lastTapHandledAt = 0;      // ms timestamp a tap was activated via pointerup

/**
 * Shared row/card activation. Used by BOTH the delegated click handler and
 * the pointer-up tap path (onLongPressEnd). On touch, the synthetic click
 * that should follow a tap has proven unreliable on some devices — it can
 * land outside the delegated container and never open the detail. The
 * long-press machinery already owns the pointer stream on these rows (and
 * long-press works), so a clean tap is activated straight from pointerup,
 * with the trailing click suppressed via lastTapHandledAt.
 *
 * `target` is the element actually under the pointer (for beacon/avatar
 * sub-target detection).
 */
function activateEquipmentRow(target) {
  const DBG = !!(window.NX && (NX.debugEnabled || /[?&]debug\b/.test(location.search) ||
    (function () { try { return localStorage.getItem('nx_debug') === '1'; } catch (_) { return false; } })()));
  if (!target || !target.closest) { if (DBG && window.NX && NX.toast) NX.toast('activate: no target', 'error', 2000); return; }
  const el = target.closest('[data-eq-id]');
  if (DBG && window.NX && NX.toast) NX.toast('activate el=' + (el ? el.dataset.eqId : 'NONE') + ' · tgt=' + (target.className || target.tagName || '?'), 'info', 2600);
  if (!el) return;
  // Beacon tap → quick status menu (cycles status in one tap).
  const beaconTarget = target.closest('.eq-lc-pill, .eq-row-beacon');
  if (beaconTarget && el.contains(beaconTarget)) {
    openQuickStatusMenuForRow(el.dataset.eqId, beaconTarget);
    return;
  }
  // Avatar tap → quick photo replace flow.
  const photoTarget = target.closest('[data-action="quick-photo"]');
  if (photoTarget && el.contains(photoTarget)) {
    const id = photoTarget.dataset.eqId || el.dataset.eqId;
    if (id) quickReplacePhoto(id);
    return;
  }
  // Bulk mode → toggle selection instead of opening.
  if (bulkSelectionState && bulkSelectionState.active) {
    toggleBulkSelection(el.dataset.eqId);
    return;
  }
  // Open the detail. With ?debug on, drop a visible on-device breadcrumb so
  // tap delivery can be confirmed without DevTools. ALWAYS surface a thrown
  // error as a toast — openDetail is async, so a silent rejection would look
  // exactly like "nothing happened".
  if (DBG && window.NX && NX.toast) NX.toast('tap → openDetail ' + el.dataset.eqId, 'info', 1600);
  const fail = (err) => {
    if (window.NX && NX.debug) NX.debug('openDetail.error', err);
    if (window.NX && NX.toast) NX.toast('Open failed: ' + (err && err.message ? err.message : err), 'error', 6000);
  };
  try {
    const r = openDetail(el.dataset.eqId);
    if (r && typeof r.then === 'function') {
      r.then(() => { if (DBG && window.NX && NX.toast) NX.toast('openDetail resolved', 'success', 1400); }).catch(fail);
    }
  } catch (err) { fail(err); }
}

/**
 * Wire long-press handlers onto the equipment list container. Called
 * once after each renderList() so newly-rendered rows pick up the
 * handlers. Idempotent — uses event delegation so we only attach
 * one listener to the container regardless of row count.
 */
function wireEquipmentLongPress() {
  const list = document.getElementById('eqList');
  if (!list) return;
  // Avoid double-binding on re-renders.
  if (list.__longpressBound) return;
  list.__longpressBound = true;

  list.addEventListener('pointerdown', onLongPressStart, { passive: false });
  list.addEventListener('pointermove', onLongPressMove,  { passive: true  });
  list.addEventListener('pointerup',   onLongPressEnd,   { passive: true  });
  list.addEventListener('pointercancel', onLongPressCancel, { passive: true });
  list.addEventListener('pointerleave',  onLongPressCancel, { passive: true });
  // Suppress the iOS/Android context menu that long-press triggers natively
  // — it would compete with our dial.
  list.addEventListener('contextmenu', e => {
    if (longpressState && longpressState.active) e.preventDefault();
  });
}

function onLongPressStart(e) {
  // Skip if already in bulk mode (different gesture set applies).
  if (bulkSelectionState && bulkSelectionState.active) return;
  // Only react to primary pointer (touch finger or left mouse button).
  if (e.button !== undefined && e.button !== 0) return;

  // Find the equipment row/card under the pointer.
  const row = e.target.closest('[data-eq-id]');
  if (!row) return;
  const equipId = row.dataset.eqId;
  if (!equipId) return;

  // Cancel any active timer first.
  cancelLongPress();

  longpressState = {
    active: true,
    fired: false,
    equipId,
    row,
    startX: e.clientX,
    startY: e.clientY,
    pointerId: e.pointerId,
    timerId: null,
    progressEl: null,
  };

  // Build a progress ring overlay positioned at the touch point.
  // SVG circle that fills its stroke-dasharray over LONGPRESS_DURATION_MS.
  const ring = document.createElement('div');
  ring.className = 'eq-longpress-ring';
  ring.style.left = `${e.clientX}px`;
  ring.style.top = `${e.clientY}px`;
  ring.innerHTML = `
    <svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
      <circle class="eq-longpress-ring-track" cx="30" cy="30" r="26"/>
      <circle class="eq-longpress-ring-fill"  cx="30" cy="30" r="26"/>
    </svg>
  `;
  document.body.appendChild(ring);
  longpressState.progressEl = ring;

  // Visual compression on the row.
  row.classList.add('eq-longpress-active');

  // Schedule the trigger.
  longpressState.timerId = setTimeout(() => onLongPressFire(), LONGPRESS_DURATION_MS);

  // Force the ring fill animation by toggling a class on the next frame.
  requestAnimationFrame(() => {
    if (longpressState && longpressState.progressEl) {
      longpressState.progressEl.classList.add('is-running');
    }
  });
}

function onLongPressMove(e) {
  if (!longpressState || !longpressState.active) return;
  const dx = Math.abs(e.clientX - longpressState.startX);
  const dy = Math.abs(e.clientY - longpressState.startY);
  if (dx > LONGPRESS_MOVE_TOLERANCE || dy > LONGPRESS_MOVE_TOLERANCE) {
    cancelLongPress();
  }
}

function onLongPressEnd(e) {
  if (!longpressState || !longpressState.active) return;
  // If the timer already fired and opened the dial, don't cancel.
  if (longpressState.fired) {
    cleanupLongPressVisual();
    longpressState = null;   // never leave a stuck fired-state that would
    return;                  // swallow every subsequent row tap
  }
  // Not fired and the gesture is still alive at pointerup → this was a clean
  // TAP. (A scroll/drag would have nulled longpressState in onLongPressMove,
  // so we wouldn't reach here.) Activate directly from the pointer stream
  // rather than waiting on the unreliable synthetic click. Guard the trailing
  // click so it doesn't double-open.
  const row = longpressState.row;
  const target = (e && e.target && e.target.closest) ? e.target : row;
  cancelLongPress();
  if (row && document.contains(row)) {
    lastTapHandledAt = Date.now();
    activateEquipmentRow(target || row);
  }
}

function onLongPressCancel() {
  if (!longpressState || !longpressState.active) return;
  cancelLongPress();
}

function cancelLongPress() {
  if (!longpressState) return;
  if (longpressState.timerId) {
    clearTimeout(longpressState.timerId);
    longpressState.timerId = null;
  }
  cleanupLongPressVisual();
  longpressState = null;
}

function cleanupLongPressVisual() {
  if (!longpressState) return;
  if (longpressState.row) {
    longpressState.row.classList.remove('eq-longpress-active');
  }
  if (longpressState.progressEl && longpressState.progressEl.parentNode) {
    longpressState.progressEl.classList.add('is-completing');
    const el = longpressState.progressEl;
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  }
}

function onLongPressFire() {
  if (!longpressState || !longpressState.active) return;
  longpressState.fired = true;
  lastLongPressFireAt = Date.now();

  // Haptic feedback if available.
  if (navigator.vibrate) {
    try { navigator.vibrate(15); } catch (_) {}
  }

  // Pulse the ring to confirm completion.
  if (longpressState.progressEl) {
    longpressState.progressEl.classList.add('is-fired');
  }

  const equipId = longpressState.equipId;
  // Slight delay so the user sees the ring complete before the dial opens.
  setTimeout(() => {
    cleanupLongPressVisual();
    longpressState = null;
    openEquipmentActionsDial(equipId);
  }, 120);
}

/* ─── The dial itself — duties-style speed-dial with equipment actions ─── */

function openEquipmentActionsDial(equipId) {
  closeEquipmentActionsDial();

  const eq = (typeof equipment !== 'undefined' && equipment) ? equipment.find(e => e.id === equipId) : null;
  if (!eq) return;

  const overlay = document.createElement('div');
  overlay.className = 'eq-actions-dial';
  overlay.setAttribute('role', 'menu');
  overlay.setAttribute('aria-hidden', 'false');

  // The "current selection" pill at the top of the stack — shows what's
  // about to be acted on, so the dial is unambiguous.
  const pill = `
    <div class="eq-actions-dial-target">
      <div class="eq-actions-dial-target-name">${esc(eq.name)}</div>
      <div class="eq-actions-dial-target-loc">${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
    </div>
  `;

  // Action rows. Order matters — most-likely-action first (closest to thumb).
  const actions = [
    {
      key: 'select-multi',
      label: 'Bulk select',
      sub:   'Tap more rows to select',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    },
    {
      key: 'move-to-section',
      label: 'Move to section',
      sub:   'Reassign to a section group',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18"/><path d="M3 12h12"/><path d="M3 17h6"/><path d="M16 14l4 4-4 4"/></svg>',
    },
    {
      key: 'move-up',
      label: 'Move up',
      sub:   'Reorder within section',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    },
    {
      key: 'move-down',
      label: 'Move down',
      sub:   'Reorder within section',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    },
    {
      key: 'report-issue',
      label: 'Report issue',
      sub:   'Open issue tracker',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    },
    {
      key: 'view-parts',
      label: 'View parts',
      sub:   'Browse + replace components',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    },
    {
      key: 'edit-equipment',
      label: 'Edit equipment',
      sub:   'Name, photo, SN, specs — all of it',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    },
    {
      key: 'schedule-pm',
      label: 'Schedule PM',
      sub:   'Set next maintenance date',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    },
    {
      key: 'email-contractor',
      label: 'Email contractor',
      sub:   'Compose service request',
      iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    },
  ];

  overlay.innerHTML = `
    <div class="eq-actions-dial-backdrop" data-dial-close></div>
    <div class="eq-actions-dial-stack">
      ${pill}
      ${actions.map(a => `
        <button class="eq-actions-dial-action" data-target="${esc(a.key)}" role="menuitem">
          <span class="eq-actions-dial-text">
            <span class="eq-actions-dial-label">${esc(a.label)}</span>
            <span class="eq-actions-dial-sub">${esc(a.sub)}</span>
          </span>
          <span class="eq-actions-dial-icon">${a.iconSvg}</span>
        </button>
      `).join('')}
      <button class="eq-actions-dial-cancel" data-target="cancel" role="menuitem">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Trigger the slide-up animation on next frame.
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  // Wire actions.
  const close = closeEquipmentActionsDial;
  overlay.querySelector('[data-dial-close]').addEventListener('click', close);
  overlay.querySelector('[data-target="cancel"]').addEventListener('click', close);
  overlay.querySelectorAll('.eq-actions-dial-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.target;
      close();
      // Slight delay so the close animation completes before action UI opens.
      setTimeout(() => handleEquipmentDialAction(target, eq), 120);
    });
  });

  // ESC to close on desktop.
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);
}

function closeEquipmentActionsDial() {
  const existing = document.querySelector('.eq-actions-dial');
  if (!existing) return;
  existing.classList.remove('is-open');
  existing.classList.add('is-closing');
  setTimeout(() => {
    if (existing.parentNode) existing.parentNode.removeChild(existing);
  }, 220);
}

async function handleEquipmentDialAction(action, eq) {
  switch (action) {
    case 'select-multi': {
      // Enter bulk mode and pre-select the equipment that was held.
      if (typeof enterBulkMode === 'function') {
        enterBulkMode();
        if (typeof toggleBulkSelection === 'function') {
          toggleBulkSelection(eq.id);
        }
      }
      break;
    }
    case 'move-to-section': {
      // Open the section picker, then reassign on selection
      const target = await pickSection(eq.section || '', eq.location);
      if (target !== null) {
        await moveEquipmentToSection(eq.id, target);
      }
      break;
    }
    case 'move-up':   await moveEquipmentInSection(eq.id, 'up');   break;
    case 'move-down': await moveEquipmentInSection(eq.id, 'down'); break;
    case 'report-issue': {
      if (typeof openIssueTracker === 'function') {
        openIssueTracker(eq.id);
      } else if (typeof reportIssue === 'function') {
        reportIssue(eq.id);
      }
      break;
    }
    case 'view-parts': {
      // Open the parts overlay scoped to this equipment.
      if (typeof openPartsForEquipment === 'function') {
        openPartsForEquipment(eq.id);
      }
      break;
    }
    case 'edit-equipment': {
      // Open the full 6-tab editor (Basic / Specs / Photos / Attachments / Links / Custom Fields).
      if (typeof openFullEditor === 'function') {
        openFullEditor(eq.id);
      }
      break;
    }
    case 'schedule-pm': {
      // Pre-seed bulk selection with just this one and open the schedule sheet.
      if (typeof enterBulkMode === 'function' && typeof openBulkPmSchedule === 'function') {
        bulkSelectionState.active = true;
        bulkSelectionState.selected = new Set([eq.id]);
        document.body.classList.add('eq-bulk-mode');
        renderBulkToolbar();
        // Mark the row visually so the user knows what they're scheduling for.
        const row = document.querySelector(`[data-eq-id="${eq.id}"]`);
        if (row) row.classList.add('is-selected');
        openBulkPmSchedule();
      }
      break;
    }
    case 'email-contractor': {
      // We need an open issue to attach the email to. If there isn't one,
      // create a placeholder issue first so the email has a thread to track
      // against.
      if (typeof loadEquipmentIssues === 'function' && typeof emailContractorAboutIssue === 'function') {
        const open = await loadEquipmentIssues(eq.id, { includeRepaired: false });
        if (open && open.length) {
          emailContractorAboutIssue(eq, open[0]);
        } else {
          // No open issue — create a quick one then email.
          const title = prompt(`What's the issue with ${eq.name}?\n\nBrief title (e.g. "won't cool below 45°F")`);
          if (!title || !title.trim()) return;
          try {
            const { data, error } = await NX.sb.from('equipment_issues').insert({
              equipment_id:    eq.id,
              title:           title.trim(),
              status:          'reported',
              reported_at:     new Date().toISOString(),
              reported_by:     NX.user?.id || null,
              reported_by_name: NX.user?.name || null,
            }).select('*').single();
            if (error) throw error;
            // Mirror onto the board (work-order card) just like the tracker
            // path does — this quick path previously skipped it.
            if (NX.domain && NX.domain.recordEquipmentIssue) {
              try { await NX.domain.recordEquipmentIssue({ issueId: data.id, equipmentId: eq.id, title: data.title, description: data.description, priority: 'high' }); } catch (_) {}
            }
            // Fire the email — it will auto-advance to contractor_called.
            emailContractorAboutIssue(eq, data);
          } catch (err) {
            console.error('[equipment] long-press email-contractor:', err);
            NX.toast && NX.toast('Could not log issue: ' + (err.message || ''), 'error');
          }
        }
      }
      break;
    }
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   21. PARTS — fleet-wide management overlay
   ════════════════════════════════════════════════════════════════════════════
   Standalone workspace for browsing every replaceable part across the
   entire fleet. The existing per-equipment Parts tab still works — this
   adds a higher-altitude view that lets you:

     • Browse all parts at once, grouped by parent equipment
     • Search by part name, OEM number, or supplier
     • Open any part for full-detail editing with photo + replacement
       history + cross-equipment compatibility
     • See "Used by N equipment" badges on parts that fit multiple units
     • Mark a part as replaced — auto-stamps last_replaced_at, prompts
       cost + supplier, optionally creates an equipment_maintenance row
     • Calculate next-due-by-interval from replacement_interval_months

   Schema additions (best-effort — gracefully degrades if missing):
     photo_url                  text
     lead_time_days             int
     replacement_interval_months int
     last_replaced_at           timestamptz
     replacement_history        jsonb     [{date, cost, vendor, by}]
     compatible_equipment_ids   jsonb     [uuid, uuid, ...]
     manufacturer_id            uuid      FK to manufacturers (optional)

   Open via:
     NX.modules.equipment.openParts()              — fleet-wide
     NX.modules.equipment.openPartsForEquipment(id) — filtered to one unit
     NX.modules.equipment.openPartDetail(partId)    — straight to detail

   Long-press dial gets a 5th action that takes the held equipment as
   the filter context.
   ════════════════════════════════════════════════════════════════════════════ */

let partsState = null;

const PARTS_TABS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'history',      label: 'Replacement History' },
  { key: 'compatibility', label: 'Compatibility' },
];

// ═══ ARCHIVE WORLD (v14) ═══════════════════════════════════════════════
// Opens the equipment view filtered to archived items + adds a body
// class so CSS can apply a distinctive "you're in the archive" look:
// muted colors, an Archive banner across the top with an X back-button,
// and a slight vignette. Called from the Equipment speed-dial's
// Archive option. Exit clears the body class AND the filter (going back
// to the default Active view).
//
// Why this lives here (not as a separate module): the Archive is a
// *view treatment* of the existing equipment list, not a parallel
// data system. Same data, same components, just a focused mode.
function openArchiveWorld() {
  // (1) Set the underlying filter
  if (typeof activeFilter !== 'undefined' && activeFilter) {
    activeFilter.archived = 'only';
  }
  // (2) Apply the body class — CSS keys off this for the distinctive look
  document.body.classList.add('is-equipment-archive-world');
  // (3) Re-render so the filter takes effect + the chip becomes active
  if (typeof buildUI === 'function') {
    try { buildUI(); } catch (e) { console.warn('[equipment] openArchiveWorld buildUI:', e); }
  }
  // (4) Inject the Archive banner if it doesn't exist yet. The banner
  // gets prepended to the equipment view so it sits above the chips
  // and serves as both a label ("ARCHIVE") and a way out (X button).
  const eqView = document.getElementById('equipmentView');
  if (eqView && !eqView.querySelector('.eq-archive-banner')) {
    const banner = document.createElement('div');
    banner.className = 'eq-archive-banner';
    banner.innerHTML = `
      <button class="eq-archive-banner-close" type="button" aria-label="Exit archive">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="eq-archive-banner-titles">
        <div class="eq-archive-banner-title">Archive</div>
        <div class="eq-archive-banner-sub">Showing only archived equipment</div>
      </div>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eq-archive-banner-icon" aria-hidden="true">
        <rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>
      </svg>
    `;
    eqView.insertBefore(banner, eqView.firstChild);
    banner.querySelector('.eq-archive-banner-close').addEventListener('click', closeArchiveWorld);
  }
}

function closeArchiveWorld() {
  document.body.classList.remove('is-equipment-archive-world');
  if (typeof activeFilter !== 'undefined' && activeFilter) {
    activeFilter.archived = 'active';
  }
  // Remove the banner
  document.querySelectorAll('.eq-archive-banner').forEach(b => b.remove());
  if (typeof buildUI === 'function') {
    try { buildUI(); } catch (_) {}
  }
}


async function openParts(opts) {
  closeParts();
  const overlay = document.createElement('div');
  overlay.className = 'eq-parts-overlay';
  document.body.appendChild(overlay);

  partsState = {
    overlay,
    mode: 'list',                 // 'list' | 'detail'
    list: [],
    activeId: null,
    activePart: null,
    detailTab: 'overview',
    loading: true,
    search: '',
    filterEquipId: (opts && opts.equipmentId) || null,
    filterEquipName: (opts && opts.equipmentName) || null,
  };
  renderParts2();

  try {
    await loadPartsList();
    if (!partsState || partsState.overlay !== overlay) return;
    partsState.loading = false;

    // If opts.partId is set, jump straight to that part's detail.
    if (opts && opts.partId) {
      const p = partsState.list.find(x => x.id === opts.partId);
      if (p) {
        partsState.mode = 'detail';
        partsState.activeId = p.id;
        partsState.activePart = p;
      }
    }
    renderParts2();
  } catch (e) {
    console.error('[equipment] openParts:', e);
    if (partsState) {
      partsState.loading = false;
      partsState.error = e.message || String(e);
      renderParts2();
    }
  }
}

function openPartsForEquipment(equipmentId) {
  const eq = (typeof equipment !== 'undefined' && equipment) ? equipment.find(e => e.id === equipmentId) : null;
  return openParts({
    equipmentId,
    equipmentName: eq ? eq.name : null,
  });
}

function openPartDetail(partId) {
  return openParts({ partId });
}

function closeParts() {
  if (!partsState) return;
  if (partsState.overlay && partsState.overlay.parentNode) {
    partsState.overlay.parentNode.removeChild(partsState.overlay);
  }
  partsState = null;
}

/**
 * Load every part across the fleet plus a lite equipment lookup so we
 * can render parent-equipment context on each card. Single bulk fetch.
 */
async function loadPartsList() {
  if (!NX.sb) return;
  const [partsRes, equipRes] = await Promise.all([
    NX.sb.from('equipment_parts')
      .select('*')
      .order('part_name', { ascending: true }),
    NX.sb.from('equipment').select('id, name, location, area, manufacturer, model'),
  ]);

  const parts = partsRes.data || [];
  const eqList = equipRes.data || [];
  const eqById = {};
  for (const e of eqList) eqById[e.id] = e;

  // Annotate each part with its parent equipment + compatible equipment.
  for (const p of parts) {
    p._equipment = eqById[p.equipment_id] || null;
    const compatIds = Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids : [];
    p._compatible = compatIds.map(id => eqById[id]).filter(Boolean);

    // Compute "used by" — primary equipment + compatibles, deduped.
    const usedBy = new Set();
    if (p.equipment_id) usedBy.add(p.equipment_id);
    for (const id of compatIds) usedBy.add(id);
    p._usedByCount = usedBy.size;

    // Next-due calc if we have last_replaced_at + interval.
    if (p.last_replaced_at && p.replacement_interval_months) {
      const last = new Date(p.last_replaced_at);
      const next = new Date(last);
      next.setMonth(next.getMonth() + (parseInt(p.replacement_interval_months, 10) || 0));
      p._nextDue = next;
      const daysLeft = Math.floor((next - Date.now()) / 86400000);
      p._nextDueDaysLeft = daysLeft;
    } else {
      p._nextDue = null;
      p._nextDueDaysLeft = null;
    }
  }

  partsState.list = parts;
  partsState.equipmentLookup = eqById;
}

function renderParts2() {
  if (!partsState || !partsState.overlay) return;
  if (partsState.mode === 'detail') {
    renderPartsDetail();
  } else {
    renderPartsList();
  }
}

/* ─── List view ──────────────────────────────────────────────────── */

function renderPartsList() {
  const { overlay, list, loading, error, search, filterEquipId, filterEquipName } = partsState;

  let filtered = list;
  if (filterEquipId) {
    filtered = filtered.filter(p =>
      p.equipment_id === filterEquipId ||
      (Array.isArray(p.compatible_equipment_ids) && p.compatible_equipment_ids.includes(filterEquipId))
    );
  }
  const q = (search || '').toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(p => {
      if ((p.part_name || '').toLowerCase().includes(q)) return true;
      if ((p.oem_part_number || '').toLowerCase().includes(q)) return true;
      if ((p.supplier || '').toLowerCase().includes(q)) return true;
      if ((p.assembly_path || '').toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // Group by parent equipment for visual clarity.
  const groups = {};
  for (const p of filtered) {
    const eqId = p.equipment_id || '__unassigned';
    if (!groups[eqId]) {
      groups[eqId] = {
        equipment: p._equipment,
        equipmentId: eqId,
        parts: [],
      };
    }
    groups[eqId].parts.push(p);
  }
  const orderedKeys = Object.keys(groups).sort((a, b) => {
    const aN = (groups[a].equipment?.name || '').toLowerCase();
    const bN = (groups[b].equipment?.name || '').toLowerCase();
    return aN.localeCompare(bN);
  });

  let bodyHTML;
  if (loading) {
    bodyHTML = `<div class="eq-parts-loading">Loading parts catalog…</div>`;
  } else if (error) {
    bodyHTML = `<div class="eq-parts-error">Couldn't load: ${esc(error)}</div>`;
  } else if (!filtered.length) {
    if (q) {
      bodyHTML = `<div class="eq-parts-empty"><div class="eq-parts-empty-msg">No parts match "${esc(q)}".</div></div>`;
    } else if (filterEquipId) {
      bodyHTML = `
        <div class="eq-parts-empty">
          <div class="eq-parts-empty-title">No parts logged for this equipment yet</div>
          <div class="eq-parts-empty-msg">Tap the <strong>+</strong> button at top to add the first part — name, OEM number, supplier, and you're set.</div>
        </div>
      `;
    } else {
      bodyHTML = `
        <div class="eq-parts-empty">
          <div class="eq-parts-empty-title">No parts in the catalog yet</div>
          <div class="eq-parts-empty-msg">Add parts from each equipment's detail view, or use AI to extract a bill-of-materials from the manual.</div>
        </div>
      `;
    }
  } else {
    bodyHTML = orderedKeys.map(eqId => {
      const g = groups[eqId];
      const eqLabel = g.equipment
        ? `${esc(g.equipment.name)}${g.equipment.location ? ' · ' + esc(g.equipment.location) : ''}`
        : 'Unassigned parts';
      const subtitle = g.equipment
        ? [g.equipment.manufacturer, g.equipment.model].filter(Boolean).map(esc).join(' ')
        : '';
      return `
        <div class="eq-parts-group">
          <div class="eq-parts-group-head">
            <div class="eq-parts-group-title">${eqLabel}</div>
            ${subtitle ? `<div class="eq-parts-group-sub">${subtitle}</div>` : ''}
            <div class="eq-parts-group-count">${g.parts.length} ${g.parts.length === 1 ? 'part' : 'parts'}</div>
          </div>
          <div class="eq-parts-group-list">
            ${g.parts.map(renderPartListCard).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  // Filter chip if we're scoped to one equipment.
  const filterChipHTML = filterEquipId ? `
    <div class="eq-parts-filter-chip">
      <span class="eq-parts-filter-chip-label">Filtered by:</span>
      <span class="eq-parts-filter-chip-name">${esc(filterEquipName || 'equipment')}</span>
      <button class="eq-parts-filter-chip-clear" data-action="clear-filter" aria-label="Clear filter">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  ` : '';

  overlay.innerHTML = `
    <div class="eq-parts-head">
      <button class="eq-parts-close" aria-label="Close parts catalog">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="eq-parts-head-text">
        <div class="eq-parts-title">Parts Catalog</div>
        <div class="eq-parts-sub">${list.length} ${list.length === 1 ? 'part' : 'parts'} across ${Object.keys(groups).length} ${Object.keys(groups).length === 1 ? 'unit' : 'units'}</div>
      </div>
      <button class="eq-parts-add" data-action="add" aria-label="Add new part">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>

    <div class="eq-parts-search-wrap">
      <input type="search" class="eq-parts-search" id="eqPartsSearch" placeholder="Search by name, OEM number, supplier…" value="${esc(search || '')}" autocomplete="off">
    </div>

    ${filterChipHTML}

    <div class="eq-parts-body">
      ${bodyHTML}
    </div>
  `;

  overlay.querySelector('.eq-parts-close').addEventListener('click', closeParts);
  overlay.querySelector('[data-action="add"]').addEventListener('click', () => addNewPart(filterEquipId));
  overlay.querySelector('[data-action="clear-filter"]')?.addEventListener('click', () => {
    partsState.filterEquipId = null;
    partsState.filterEquipName = null;
    renderParts2();
  });
  const searchInput = overlay.querySelector('#eqPartsSearch');
  searchInput?.addEventListener('input', e => {
    partsState.search = e.target.value;
    // Re-render the body only to preserve focus on the search input.
    const body = overlay.querySelector('.eq-parts-body');
    if (!body) return;
    // Recompute filtered + groups inline (mirror of above).
    let f = list;
    if (filterEquipId) f = f.filter(p =>
      p.equipment_id === filterEquipId ||
      (Array.isArray(p.compatible_equipment_ids) && p.compatible_equipment_ids.includes(filterEquipId))
    );
    const q2 = (e.target.value || '').toLowerCase().trim();
    if (q2) f = f.filter(p =>
      (p.part_name || '').toLowerCase().includes(q2) ||
      (p.oem_part_number || '').toLowerCase().includes(q2) ||
      (p.supplier || '').toLowerCase().includes(q2) ||
      (p.assembly_path || '').toLowerCase().includes(q2)
    );
    const g2 = {};
    for (const p of f) {
      const k = p.equipment_id || '__unassigned';
      if (!g2[k]) g2[k] = { equipment: p._equipment, parts: [] };
      g2[k].parts.push(p);
    }
    const keys = Object.keys(g2).sort((a, b) => (g2[a].equipment?.name || '').toLowerCase().localeCompare((g2[b].equipment?.name || '').toLowerCase()));
    body.innerHTML = f.length
      ? keys.map(k => `
          <div class="eq-parts-group">
            <div class="eq-parts-group-head">
              <div class="eq-parts-group-title">${g2[k].equipment ? esc(g2[k].equipment.name) : 'Unassigned parts'}</div>
              <div class="eq-parts-group-count">${g2[k].parts.length} ${g2[k].parts.length === 1 ? 'part' : 'parts'}</div>
            </div>
            <div class="eq-parts-group-list">${g2[k].parts.map(renderPartListCard).join('')}</div>
          </div>
        `).join('')
      : `<div class="eq-parts-empty"><div class="eq-parts-empty-msg">No parts match "${esc(q2)}".</div></div>`;
    body.querySelectorAll('[data-part-id]').forEach(card => {
      card.addEventListener('click', () => openPartDetailById(card.dataset.partId));
    });
  });

  overlay.querySelectorAll('[data-part-id]').forEach(card => {
    card.addEventListener('click', () => openPartDetailById(card.dataset.partId));
  });
}

function renderPartListCard(p) {
  const photo = p.photo_url
    ? `<div class="eq-part-card-photo" style="background-image:url('${esc((p.photo_url || '').replace(/'/g, '%27'))}')"></div>`
    : `<div class="eq-part-card-photo eq-part-card-photo-empty">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </div>`;

  const subBits = [];
  if (p.oem_part_number) subBits.push(`<span class="eq-part-card-oem">${esc(p.oem_part_number)}</span>`);
  if (p.supplier) subBits.push(`<span>${esc(p.supplier)}</span>`);
  if (p.last_price) subBits.push(`<span>$${parseFloat(p.last_price).toFixed(2)}</span>`);

  // Status badges.
  const badges = [];
  if (p._usedByCount > 1) {
    badges.push(`<span class="eq-part-card-badge eq-part-card-badge-shared">Used by ${p._usedByCount} units</span>`);
  }
  if (p._nextDueDaysLeft != null) {
    if (p._nextDueDaysLeft < 0) {
      badges.push(`<span class="eq-part-card-badge eq-part-card-badge-overdue">Replace overdue (${Math.abs(p._nextDueDaysLeft)}d)</span>`);
    } else if (p._nextDueDaysLeft <= 30) {
      badges.push(`<span class="eq-part-card-badge eq-part-card-badge-soon">Replace in ${p._nextDueDaysLeft}d</span>`);
    }
  }

  return `
    <div class="eq-part-card" data-part-id="${esc(p.id)}">
      ${photo}
      <div class="eq-part-card-body">
        <div class="eq-part-card-name">${esc(p.part_name || '(unnamed part)')}${p.quantity && p.quantity > 1 ? ` <span class="eq-part-card-qty">×${p.quantity}</span>` : ''}</div>
        ${subBits.length ? `<div class="eq-part-card-sub">${subBits.join(' · ')}</div>` : ''}
        ${p.assembly_path ? `<div class="eq-part-card-path">${esc(p.assembly_path)}</div>` : ''}
        ${badges.length ? `<div class="eq-part-card-badges">${badges.join('')}</div>` : ''}
      </div>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eq-part-card-arrow" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `;
}

/* ─── Detail view ────────────────────────────────────────────────── */

function openPartDetailById(partId) {
  if (!partsState) return;
  const p = partsState.list.find(x => x.id === partId);
  if (!p) return;
  partsState.mode = 'detail';
  partsState.activeId = partId;
  partsState.activePart = p;
  partsState.detailTab = 'overview';
  renderParts2();
}

function renderPartsDetail() {
  const { overlay, activePart: p, detailTab } = partsState;
  if (!p) {
    partsState.mode = 'list';
    renderParts2();
    return;
  }

  let tabBody;
  if (detailTab === 'overview')           tabBody = renderPartOverviewTab(p);
  else if (detailTab === 'history')       tabBody = renderPartHistoryTab(p);
  else if (detailTab === 'compatibility') tabBody = renderPartCompatibilityTab(p);

  overlay.innerHTML = `
    <div class="eq-parts-head">
      <button class="eq-parts-back" aria-label="Back to parts list">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="eq-parts-head-text">
        <div class="eq-parts-title">${esc(p.part_name || '(unnamed part)')}</div>
        <div class="eq-parts-sub">
          ${p.oem_part_number ? `OEM ${esc(p.oem_part_number)}` : 'No OEM number'}
          ${p._equipment ? ` · ${esc(p._equipment.name)}` : ''}
        </div>
      </div>
      ${p.supplier_url ? `
        <a class="eq-parts-link" href="${esc(p.supplier_url)}" target="_blank" rel="noopener" aria-label="Open supplier page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      ` : ''}
    </div>

    <div class="eq-parts-tabs" role="tablist">
      ${PARTS_TABS.map(t => `
        <button class="eq-parts-tab${t.key === detailTab ? ' is-active' : ''}" data-detail-tab="${esc(t.key)}">${esc(t.label)}</button>
      `).join('')}
    </div>

    <div class="eq-parts-body">
      ${tabBody}
    </div>

    ${detailTab === 'overview' ? `
      <div class="eq-parts-foot">
        <button class="eq-parts-foot-btn eq-parts-foot-btn-primary" data-action="save" style="flex:1">
          Save changes
        </button>
      </div>
    ` : ''}
  `;

  overlay.querySelector('.eq-parts-back').addEventListener('click', () => {
    partsState.mode = 'list';
    partsState.activeId = null;
    partsState.activePart = null;
    renderParts2();
  });
  overlay.querySelectorAll('[data-detail-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      partsState.detailTab = btn.dataset.detailTab;
      renderParts2();
    });
  });

  if (detailTab === 'overview') {
    wirePartOverviewForm(p);
    overlay.querySelector('[data-action="save"]').addEventListener('click', () => savePartOverview(p));
    // v18.21 — global "Mark replaced" removed. Replacement is now
    // logged per (equipment, part) from the equipment Parts tab so
    // we know WHICH unit the part was swapped on. A part fits N
    // machines; "replaced 5/12" is meaningless without the unit.
  } else if (detailTab === 'compatibility') {
    wirePartCompatibilityTab(p);
  } else if (detailTab === 'history') {
    overlay.querySelectorAll('[data-event-eq-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.eventEqId;
        if (!id) return;
        closeParts();
        if (typeof openDetail === 'function') openDetail(id);
      });
    });
  }
}

/* ─── Overview tab ───────────────────────────────────────────────── */

function renderPartOverviewTab(p) {
  return `
    <div class="eq-part-overview">
      <div class="eq-part-photo-wrap">
        <button class="eq-part-photo-btn" data-action="upload-photo" aria-label="Upload part photo">
          ${p.photo_url
            ? `<img src="${esc(p.photo_url)}" class="eq-part-photo-img" alt="">`
            : `<div class="eq-part-photo-placeholder">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </div>`}
          <span class="eq-part-photo-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </span>
        </button>
        <input type="file" class="eq-part-photo-file" accept="image/*" hidden>
      </div>

      <form class="eq-part-form">
        <div class="eq-part-form-field">
          <label class="eq-part-form-label" for="ppName">Part name</label>
          <input class="eq-part-form-input" id="ppName" name="part_name" value="${esc(p.part_name || '')}" required>
        </div>

        <div class="eq-part-form-row">
          <div class="eq-part-form-field">
            <label class="eq-part-form-label" for="ppOem">OEM number</label>
            <input class="eq-part-form-input" id="ppOem" name="oem_part_number" value="${esc(p.oem_part_number || '')}">
          </div>
          <div class="eq-part-form-field">
            <label class="eq-part-form-label" for="ppQty">Quantity</label>
            <input class="eq-part-form-input" id="ppQty" name="quantity" type="number" min="1" value="${p.quantity || 1}">
          </div>
        </div>

        <div class="eq-part-form-field">
          <label class="eq-part-form-label" for="ppPath">Assembly path <span class="eq-part-form-hint">— how to find it ("compressor → fan motor")</span></label>
          <input class="eq-part-form-input" id="ppPath" name="assembly_path" value="${esc(p.assembly_path || '')}" placeholder="compressor → refrigeration → fan">
        </div>

        <div class="eq-part-form-section">Sourcing <span class="eq-part-form-hint">— add as many sources as you like, mark one preferred</span></div>
        <div class="eq-part-vendors-inline" data-part-id="${esc(p.id || '')}" id="eqPartVendorsInline-${esc(p.id || 'new')}">
          <div class="eq-part-vendors-loading">Loading sources…</div>
        </div>
        <div class="eq-part-form-field">
          <label class="eq-part-form-label" for="ppLead">Lead time (days)</label>
          <input class="eq-part-form-input" id="ppLead" name="lead_time_days" type="number" min="0" value="${p.lead_time_days || ''}" placeholder="3">
        </div>

        <div class="eq-part-form-section">Replacement schedule <span class="eq-part-form-hint">— catalog default; actual replacement dates live per equipment</span></div>
        <div class="eq-part-form-row">
          <div class="eq-part-form-field">
            <label class="eq-part-form-label" for="ppInterval">Interval (months)</label>
            <input class="eq-part-form-input" id="ppInterval" name="replacement_interval_months" type="number" min="0" value="${p.replacement_interval_months || ''}" placeholder="12">
          </div>
        </div>
        <div style="padding:10px 12px; background:rgba(212,164,78,0.05); border:1px solid rgba(212,164,78,0.15); border-radius:8px; font-size:12px; color:var(--nx-faint); margin-top:8px; line-height:1.4">
          ${uiSvg('alert', '12px')} <strong>To log a replacement</strong>, open the equipment that had this part swapped → Parts tab → tap <strong style="color:var(--nx-gold)">Mark replaced</strong> next to the part. Each equipment tracks its own replacement history.
        </div>

        <div class="eq-part-form-section">Notes</div>
        <div class="eq-part-form-field">
          <textarea class="eq-part-form-textarea" id="ppNotes" name="notes" rows="4" placeholder="Tools needed, common gotchas, where it sits…">${esc(p.notes || '')}</textarea>
        </div>

        <button type="button" class="eq-part-form-delete" data-action="delete">Delete this part</button>
      </form>
    </div>
  `;
}

function wirePartOverviewForm(p) {
  const overlay = partsState.overlay;
  const photoBtn = overlay.querySelector('[data-action="upload-photo"]');
  const fileInput = overlay.querySelector('.eq-part-photo-file');

  photoBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      NX.toast && NX.toast('Please pick an image file', 'warn');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      NX.toast && NX.toast('Image too large (12 MB max)', 'warn');
      return;
    }
    try {
      // Reuse the equipment-side downscaler (added in the brand-library batch).
      const dataUrl = await downscaleEquipmentImage(file, 512, 0.85);
      // Live preview.
      const wrap = overlay.querySelector('.eq-part-photo-btn');
      if (wrap) {
        wrap.querySelector('.eq-part-photo-placeholder')?.remove();
        let img = wrap.querySelector('.eq-part-photo-img');
        if (!img) {
          img = document.createElement('img');
          img.className = 'eq-part-photo-img';
          wrap.insertBefore(img, wrap.firstChild);
        }
        img.src = dataUrl;
      }
      // Stash the new URL on the active part so saveOverview picks it up.
      p._pendingPhotoUrl = dataUrl;
      NX.toast && NX.toast('Photo set — tap Save to apply', 'info', 1400);
    } catch (err) {
      console.error('[equipment] part photo upload:', err);
      NX.toast && NX.toast('Could not process that image', 'error');
    }
  });

  overlay.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${p.part_name}" from the catalog? This can't be undone.`)) return;
    try {
      const { error } = await NX.sb.from('equipment_parts').delete().eq('id', p.id);
      if (error) throw error;
      partsState.list = partsState.list.filter(x => x.id !== p.id);
      partsState.mode = 'list';
      partsState.activeId = null;
      partsState.activePart = null;
      renderParts2();
      NX.toast && NX.toast('Part deleted', 'info', 1100);
    } catch (e) {
      console.error('[equipment] deletePart:', e);
      NX.toast && NX.toast('Could not delete: ' + (e.message || ''), 'error');
    }
  });

  // ── Inline multi-source list ─────────────────────────────────────────
  // Surface the existing vendors[] JSONB editor here, the same one shown
  // as an accordion under each part on the list view. Reuses
  // renderVendorsListHTML + wireVendorActions so the data shape stays
  // consistent with the rest of the system.
  const inlineHost = overlay.querySelector(`#eqPartVendorsInline-${p.id || 'new'}`);
  if (inlineHost) {
    // Migrate legacy single-vendor fields → vendors[] when empty.
    let vendors = Array.isArray(p.vendors) ? p.vendors.slice() : [];
    if (!vendors.length && (p.supplier || p.supplier_url || p.last_price)) {
      vendors = [{
        name: p.supplier || 'Unknown source',
        url: p.supplier_url || null,
        oem_number: p.oem_part_number || null,
        price: p.last_price || null,
        in_stock: null,
        notes: null,
        last_checked_at: null,
        is_preferred: true,
      }];
    }

    // Replace the loading placeholder with the live list + add button.
    inlineHost.innerHTML = `
      <div class="eq-part-vendors-header">
        <span class="eq-part-vendors-label">Sources (${vendors.length})</span>
        <button type="button" class="eq-part-add-vendor-btn" data-part-id="${p.id}">+ Source</button>
      </div>
      <div class="eq-part-vendors-list" id="eqVendList-${p.id}">
        ${vendors.length
          ? renderVendorsListHTML(vendors, p.id)
          : '<div class="eq-part-vendors-empty">No sources yet. Tap "+ Source" to add the first one.</div>'}
      </div>
    `;

    // Wire actions (edit, remove, prefer, add). The handler closes over
    // `vendors` so subsequent edits see the current array; saveVendors
    // also keeps the legacy supplier/last_price/supplier_url columns in
    // sync with the preferred vendor for back-compat.
    wireVendorActions(inlineHost, p, vendors);

    // Mirror updates back into the part object so savePartOverview's
    // legacy-column writes don't clobber what the vendor editor wrote.
    p._vendorsRef = vendors;
  }
}

async function savePartOverview(p) {
  const overlay = partsState.overlay;
  const form = overlay.querySelector('.eq-part-form');
  if (!form) return;

  const fd = new FormData(form);
  const update = {};
  // Part-level string fields. Note that supplier/supplier_url no longer
  // live on the form — they're managed inside the inline sources list,
  // and saveVendors() syncs the legacy columns from the preferred vendor.
  for (const key of ['part_name', 'oem_part_number', 'assembly_path', 'notes']) {
    const v = (fd.get(key) || '').toString().trim();
    update[key] = v || null;
  }
  // Numeric fields.
  for (const key of ['quantity', 'lead_time_days', 'replacement_interval_months']) {
    const v = (fd.get(key) || '').toString().trim();
    update[key] = v ? parseInt(v, 10) : null;
  }
  // last_price is now managed per-source inside the vendors[] JSONB.
  // saveVendors() syncs the legacy last_price column from the preferred
  // source, so we deliberately don't write it from the part-level form.
  // v18.21 — last_replaced_at input removed from this form. Replacement
  // tracking is now per-equipment via markPartReplacedOnEquipment, which
  // writes to equipment_maintenance. Don't overwrite the legacy column
  // here — leave whatever's there for back-compat reads.
  // Photo.
  if (p._pendingPhotoUrl) update.photo_url = p._pendingPhotoUrl;

  try {
    const { data, error } = await NX.sb.from('equipment_parts')
      .update(update).eq('id', p.id).select('*').single();
    if (error) {
      // If a column doesn't exist, retry with only the always-existing columns.
      if (/column.*does not exist/i.test(error.message || '')) {
        const safe = {};
        for (const k of ['part_name', 'oem_part_number', 'quantity', 'supplier', 'supplier_url', 'last_price', 'assembly_path', 'notes']) {
          if (k in update) safe[k] = update[k];
        }
        const retry = await NX.sb.from('equipment_parts').update(safe).eq('id', p.id).select('*').single();
        if (retry.error) throw retry.error;
        Object.assign(p, retry.data);
        NX.toast && NX.toast('Saved — some new fields need a DB migration', 'warn', 2400);
      } else {
        throw error;
      }
    } else {
      Object.assign(p, data);
    }
    delete p._pendingPhotoUrl;
    // Recompute next-due hints.
    if (p.last_replaced_at && p.replacement_interval_months) {
      const last = new Date(p.last_replaced_at);
      const next = new Date(last);
      next.setMonth(next.getMonth() + (parseInt(p.replacement_interval_months, 10) || 0));
      p._nextDue = next;
      p._nextDueDaysLeft = Math.floor((next - Date.now()) / 86400000);
    }
    renderParts2();
    NX.toast && NX.toast('Part saved', 'success', 1400);
  } catch (e) {
    console.error('[equipment] savePartOverview:', e);
    NX.toast && NX.toast('Could not save: ' + (e.message || ''), 'error');
  }
}

async function markPartReplaced(p) {
  const cost = prompt(`Replacement cost for ${p.part_name}? (leave blank to skip)`);
  const supplier = cost != null ? prompt(`Supplier this time? (default: ${p.supplier || 'unknown'})`) : null;

  const now = new Date().toISOString();
  const update = { last_replaced_at: now };
  if (cost && parseFloat(cost) > 0) update.last_price = parseFloat(cost);
  if (supplier && supplier.trim()) update.supplier = supplier.trim();

  // Append to replacement_history (best-effort — column may not exist).
  const history = Array.isArray(p.replacement_history) ? p.replacement_history.slice() : [];
  history.unshift({
    date: now,
    cost: update.last_price || null,
    vendor: update.supplier || p.supplier || null,
    by: NX.user?.name || NX.currentUser?.name || null,
  });
  update.replacement_history = history;

  try {
    const { data, error } = await NX.sb.from('equipment_parts')
      .update(update).eq('id', p.id).select('*').single();
    if (error) {
      // Try without replacement_history if the column doesn't exist.
      if (/column.*does not exist/i.test(error.message || '')) {
        delete update.replacement_history;
        const retry = await NX.sb.from('equipment_parts').update(update).eq('id', p.id).select('*').single();
        if (retry.error) throw retry.error;
        Object.assign(p, retry.data);
      } else throw error;
    } else {
      Object.assign(p, data);
    }

    // Optionally log a maintenance event so the timeline reflects it.
    if (p.equipment_id) {
      try {
        await NX.sb.from('equipment_maintenance').insert({
          equipment_id: p.equipment_id,
          event_date: now.slice(0, 10),
          event_type: 'part_replacement',
          description: `Replaced ${p.part_name}${p.oem_part_number ? ` (OEM ${p.oem_part_number})` : ''}`,
          performed_by: NX.user?.name || null,
          cost: update.last_price || null,
        });
      } catch (mE) {
        console.warn('[equipment] could not log maintenance for part replacement:', mE.message || mE);
      }
    }

    // Recompute next-due.
    if (p.last_replaced_at && p.replacement_interval_months) {
      const last = new Date(p.last_replaced_at);
      const next = new Date(last);
      next.setMonth(next.getMonth() + (parseInt(p.replacement_interval_months, 10) || 0));
      p._nextDue = next;
      p._nextDueDaysLeft = Math.floor((next - Date.now()) / 86400000);
    }
    renderParts2();
    NX.toast && NX.toast('Replacement logged ✓', 'success', 1500);
  } catch (e) {
    console.error('[equipment] markPartReplaced:', e);
    NX.toast && NX.toast('Could not log: ' + (e.message || ''), 'error');
  }
}

/* ════════════════════════════════════════════════════════════════════
   v18.21 — Per-equipment part replacement (the right way).

   Replaces the global "Mark replaced" on the part detail with a
   context-aware action on the equipment side. From Equipment > Parts
   tab, each part row has its own "Mark replaced" button that opens
   this sheet. Each replacement gets a maintenance row tied to BOTH
   equipment_id AND part_id, so we can show "last replaced on this
   unit" per (equipment, part) pair — not as a global stat.

   Why this matters: a coffee nozzle might fit 5 espresso machines.
   "Nozzle replaced 05/12/2026" doesn't tell you WHICH machine.
   Logging per (equipment, part) answers "when was the nozzle on
   Cameo Eversys last replaced?" — which is the real question.
   ════════════════════════════════════════════════════════════════════ */

async function markPartReplacedOnEquipment(equipId, partId) {
  if (!NX.sb) { NX.toast && NX.toast('Database unavailable', 'error', 2000); return; }

  // Fetch the part + equipment so we can label the sheet meaningfully.
  const eq = (typeof equipment !== 'undefined' && equipment)
    ? equipment.find(e => String(e.id) === String(equipId))
    : null;
  if (!eq) { NX.toast && NX.toast('Equipment not found', 'error', 1800); return; }

  let part = null;
  try {
    const { data, error } = await NX.sb.from('equipment_parts').select('*').eq('id', partId).single();
    if (error) throw error;
    part = data;
  } catch (e) {
    console.error('[markPartReplacedOnEquipment] load part:', e);
    NX.toast && NX.toast('Part not found', 'error', 1800);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let dateBuf = today;
  let costBuf = '';
  let notesBuf = '';
  let invoiceFile = null;

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  overlay.style.zIndex = '9300';

  const render = () => {
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet" style="max-height:92vh; overflow-y:auto">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Mark replaced</div>
        <div class="eq-bulk-sheet-sub">${esc(part.part_name)}${part.oem_part_number ? ` · OEM ${esc(part.oem_part_number)}` : ''} on <strong style="color:var(--nx-gold)">${esc(eq.name)}</strong></div>

        <div style="padding: 12px 16px 8px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-gold); margin-bottom:6px">Replaced on *</label>
          <input type="date" id="prDate" value="${esc(dateBuf)}" required
            style="width:100%; padding:12px 14px; background:rgba(212,164,78,0.08); border:1px solid var(--nx-gold); border-radius:8px; color:var(--nx-text); font-size:15px;">
        </div>

        <div style="padding: 4px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Cost ($)</label>
          <input type="number" id="prCost" value="${esc(costBuf)}" step="0.01" placeholder="0.00"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:14px;">
        </div>

        <div style="padding: 8px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Notes</label>
          <textarea id="prNotes" rows="2" placeholder="Why was it replaced? Any related work?"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:13px;">${esc(notesBuf)}</textarea>
        </div>

        <div style="padding: 8px 16px;">
          <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--nx-faint); margin-bottom:6px">Invoice (optional)</label>
          <div style="display:flex; gap:8px; align-items:center">
            <button type="button" id="prInvoiceBtn" class="eq-btn eq-btn-small eq-btn-secondary" style="flex:0 0 auto">
              ${uiSvg('document', '13px')} ${invoiceFile ? 'Change file' : 'Attach invoice'}
            </button>
            <span style="font-size:12px; color:${invoiceFile ? 'var(--nx-gold)' : 'var(--nx-faint)'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${invoiceFile ? esc(invoiceFile.name) : 'No file selected'}</span>
            <input type="file" id="prInvoiceFile" accept="image/*,application/pdf" hidden>
          </div>
        </div>

        <div style="padding: 12px 16px;">
          <button class="eq-bulk-sheet-confirm" data-action="save" type="button" style="background:var(--nx-gold); color:#000">
            Log replacement
          </button>
          <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#prDate').addEventListener('change', (e) => { dateBuf = e.target.value; });
    overlay.querySelector('#prCost').addEventListener('input', (e) => { costBuf = e.target.value; });
    overlay.querySelector('#prNotes').addEventListener('input', (e) => { notesBuf = e.target.value; });
    const fileInput = overlay.querySelector('#prInvoiceFile');
    overlay.querySelector('#prInvoiceBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      invoiceFile = e.target.files && e.target.files[0] || null;
      render();
    });
    overlay.querySelector('[data-action="save"]').addEventListener('click', save);
  };

  const save = async () => {
    if (!dateBuf) { NX.toast && NX.toast('Date required', 'warn', 1500); return; }

    const saveBtn = overlay.querySelector('[data-action="save"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      // Upload invoice if attached
      let invoiceAttachmentId = null;
      if (invoiceFile) {
        const safeName = invoiceFile.name.replace(/[^a-z0-9.]/gi, '_');
        const path = `${equipId}/part-${partId}-${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('equipment-attachments')
          .upload(path, invoiceFile, { upsert: false, contentType: invoiceFile.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = NX.sb.storage.from('equipment-attachments').getPublicUrl(path);
        const { data: attRow, error: attErr } = await NX.sb.from('equipment_attachments').insert({
          equipment_id: equipId,
          type: 'invoice',
          title: `${part.part_name} replaced — ${dateBuf}`,
          file_url: publicUrl,
          mime_type: invoiceFile.type,
          file_size: invoiceFile.size,
          uploaded_by: NX.currentUser?.name || 'user',
        }).select('id').single();
        if (attErr) throw attErr;
        invoiceAttachmentId = attRow.id;
      }

      // Insert maintenance row tied to BOTH equipment AND part.
      const row = {
        equipment_id: equipId,
        part_id: partId,
        event_type: 'part_replacement',
        event_date: dateBuf,
        description: `Replaced ${part.part_name}${part.oem_part_number ? ` (OEM ${part.oem_part_number})` : ''}${notesBuf ? ' — ' + notesBuf : ''}`,
        performed_by: NX.currentUser?.name || null,
        cost: costBuf ? parseFloat(costBuf) : null,
      };
      if (invoiceAttachmentId) row.invoice_attachment_id = invoiceAttachmentId;

      const { error: insErr } = await NX.sb.from('equipment_maintenance').insert(row);
      if (insErr) {
        // Retry on missing columns (defensive against migration order)
        if (/column.+part_id.+does not exist/i.test(insErr.message || '')) {
          NX.toast && NX.toast('Run v18.21 SQL to enable per-equipment tracking', 'warn', 4000);
          delete row.part_id;
          const retry = await NX.sb.from('equipment_maintenance').insert(row);
          if (retry.error) throw retry.error;
        } else if (/column.+invoice_attachment_id.+does not exist/i.test(insErr.message || '')) {
          delete row.invoice_attachment_id;
          const retry = await NX.sb.from('equipment_maintenance').insert(row);
          if (retry.error) throw retry.error;
        } else {
          throw insErr;
        }
      }

      NX.toast && NX.toast(`Replacement logged on ${eq.name}`, 'success', 2000);
      overlay.remove();
      // Refresh the equipment detail so the row's "Last replaced" updates
      if (typeof openDetail === 'function') openDetail(equipId);
    } catch (err) {
      console.error('[markPartReplacedOnEquipment] save failed:', err);
      NX.toast && NX.toast('Save failed: ' + (err.message || ''), 'error', 3000);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Log replacement'; }
    }
  };

  render();
  document.body.appendChild(overlay);
}

/* ── End v18.21 additions ─────────────────────────────────────────── */

/* ─── History tab ────────────────────────────────────────────────── */

function renderPartHistoryTab(p) {
  const history = Array.isArray(p.replacement_history) ? p.replacement_history : [];
  if (!history.length) {
    return `
      <div class="eq-parts-empty">
        <div class="eq-parts-empty-title">No replacement history yet</div>
        <div class="eq-parts-empty-msg">Tap <strong>Mark replaced</strong> at the bottom when this part gets swapped — the date, cost, and supplier get logged here.</div>
      </div>
    `;
  }

  return `
    <div class="eq-part-history">
      ${history.map((h, i) => {
        const d = new Date(h.date);
        const isLatest = i === 0;
        return `
          <div class="eq-part-history-row ${isLatest ? 'is-latest' : ''}">
            <div class="eq-part-history-marker">
              <div class="eq-part-history-dot"></div>
              ${i < history.length - 1 ? '<div class="eq-part-history-line"></div>' : ''}
            </div>
            <div class="eq-part-history-body">
              <div class="eq-part-history-date">${esc(d.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }))}${isLatest ? ' <span class="eq-part-history-badge">latest</span>' : ''}</div>
              <div class="eq-part-history-meta">
                ${h.cost ? `<span class="eq-part-history-cost">$${parseFloat(h.cost).toFixed(2)}</span>` : ''}
                ${h.cost && h.vendor ? ` · ` : ''}
                ${h.vendor ? `<span>${esc(h.vendor)}</span>` : ''}
                ${(h.cost || h.vendor) && h.by ? ` · ` : ''}
                ${h.by ? `<span class="eq-part-history-by">by ${esc(h.by)}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ─── Compatibility tab ──────────────────────────────────────────── */

function renderPartCompatibilityTab(p) {
  const allEquip = (typeof equipment !== 'undefined' && equipment) ? equipment : [];
  const compatIds = new Set(Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids : []);

  const primary = p._equipment;
  const linked = allEquip.filter(e => compatIds.has(e.id));
  const candidates = allEquip.filter(e => !compatIds.has(e.id) && e.id !== p.equipment_id);

  return `
    <div class="eq-parts-intro">
      <strong>Cross-equipment compatibility.</strong> Mark every piece of equipment this part fits — when one breaks, you'll know if a spare from a different unit can be cannibalized, and bulk PM scheduling can include all units that need this part replaced.
    </div>

    ${primary ? `
      <div class="eq-parts-section-label">Primary equipment</div>
      <div class="eq-part-compat-list">
        <div class="eq-part-compat-row is-primary">
          <div class="eq-part-compat-name">${esc(primary.name)}</div>
          <div class="eq-part-compat-meta">${esc(primary.location || '')}${primary.area ? ' · ' + esc(primary.area) : ''}${primary.manufacturer ? ' · ' + esc(primary.manufacturer) : ''}${primary.model ? ' ' + esc(primary.model) : ''}</div>
        </div>
      </div>
    ` : ''}

    ${linked.length ? `
      <div class="eq-parts-section-label">Also fits · ${linked.length}</div>
      <div class="eq-part-compat-list">
        ${linked.map(e => `
          <div class="eq-part-compat-row" data-equip-id="${esc(e.id)}">
            <div class="eq-part-compat-info">
              <div class="eq-part-compat-name">${esc(e.name)}</div>
              <div class="eq-part-compat-meta">${esc(e.location || '')}${e.area ? ' · ' + esc(e.area) : ''}${e.manufacturer ? ' · ' + esc(e.manufacturer) : ''}${e.model ? ' ' + esc(e.model) : ''}</div>
            </div>
            <button class="eq-part-compat-remove" data-remove-equip="${esc(e.id)}" aria-label="Remove">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${candidates.length ? `
      <div class="eq-parts-section-label">Add to more equipment</div>
      <button class="eq-part-compat-bulk-btn" data-action="open-bulk-compat" type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span>Pick multiple equipment at once</span>
      </button>
      <div class="eq-part-compat-or">— or pick one —</div>
      <select class="eq-part-compat-add" id="ppCompatAdd">
        <option value="">— pick equipment to link —</option>
        ${candidates.map(e => `
          <option value="${esc(e.id)}">${esc(e.name)}${e.location ? ' (' + esc(e.location) + ')' : ''}${e.manufacturer ? ' — ' + esc(e.manufacturer) : ''}${e.model ? ' ' + esc(e.model) : ''}</option>
        `).join('')}
      </select>
    ` : ''}
  `;
}

function wirePartCompatibilityTab(p) {
  const overlay = partsState.overlay;
  const select = overlay.querySelector('#ppCompatAdd');
  select?.addEventListener('change', async (e) => {
    const eqId = e.target.value;
    if (!eqId) return;
    const compatIds = new Set(Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids : []);
    compatIds.add(eqId);
    await persistPartCompatibility(p, Array.from(compatIds));
  });

  // Bulk-pick button → opens a multi-select sheet.
  const bulkBtn = overlay.querySelector('[data-action="open-bulk-compat"]');
  bulkBtn?.addEventListener('click', () => openBulkCompatibilitySheet(p));

  overlay.querySelectorAll('[data-remove-equip]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const eqId = btn.dataset.removeEquip;
      const compatIds = new Set(Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids : []);
      compatIds.delete(eqId);
      await persistPartCompatibility(p, Array.from(compatIds));
    });
  });
}

/**
 * Open a bottom sheet with checkboxes for every piece of equipment NOT
 * already linked to this part. Equipment of the same manufacturer
 * floats to the top — most likely candidates for sharing the OEM part.
 *
 * The Zumex use case in one screen: the Versatile, Speed Pro, and
 * Essential all use the same OEM filter. From the part's compat tab,
 * tap "Pick multiple", check all 3, hit "Apply to 3 equipment".
 */
function openBulkCompatibilitySheet(p) {
  const allEquip = (typeof equipment !== 'undefined' && equipment) ? equipment : [];
  const compatIds = new Set(Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids : []);
  // Eligible: not already linked AND not the primary equipment.
  const candidates = allEquip.filter(e => !compatIds.has(e.id) && e.id !== p.equipment_id);

  // Sort by same-manufacturer-first.
  const primary = p._equipment;
  const primaryMfg = (primary?.manufacturer || '').toLowerCase();
  candidates.sort((a, b) => {
    const aMatch = primaryMfg && (a.manufacturer || '').toLowerCase() === primaryMfg ? 1 : 0;
    const bMatch = primaryMfg && (b.manufacturer || '').toLowerCase() === primaryMfg ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return (a.name || '').localeCompare(b.name || '');
  });

  if (!candidates.length) {
    NX.toast && NX.toast('All equipment is already linked to this part', 'info', 1800);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  const selected = new Set();

  const renderSheet = () => {
    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Mark this part compatible with which equipment?</div>
        <div class="eq-bulk-sheet-sub">${primaryMfg ? `Same-brand units (${esc(primary.manufacturer)}) are listed first — most likely to share OEM parts.` : 'Pick every piece of equipment this part fits.'}</div>
        <div class="eq-bulk-sheet-list">
          ${candidates.map(e => {
            // Same string/number coercion fix as openContractorAssignSheet —
            // dataset.id is always string, e.id may be int.
            const eid = String(e.id);
            const isSel = selected.has(eid);
            const sameBrand = primaryMfg && (e.manufacturer || '').toLowerCase() === primaryMfg;
            return `
              <button class="eq-bulk-sheet-item eq-bulk-apply-item ${isSel ? 'is-selected' : ''} ${sameBrand ? 'is-same-brand' : ''}" data-id="${esc(eid)}" type="button">
                <div class="eq-bulk-apply-check">
                  ${isSel ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </div>
                <div class="eq-bulk-sheet-item-text">
                  <div class="eq-bulk-sheet-item-name">${esc(e.name)}</div>
                  <div class="eq-bulk-sheet-item-sub">${esc(e.location || '')}${e.manufacturer ? ' · ' + esc(e.manufacturer) : ''}${e.model ? ' ' + esc(e.model) : ''}</div>
                </div>
                ${sameBrand ? '<span class="eq-bulk-apply-badge">SAME BRAND</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
        <button class="eq-bulk-sheet-confirm" data-action="confirm" ${selected.size === 0 ? 'disabled' : ''} type="button">
          Apply to ${selected.size} equipment
        </button>
        <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
      </div>
    `;
    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.querySelectorAll('[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (selected.has(id)) selected.delete(id);
        else                  selected.add(id);
        renderSheet();
      });
    });
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', applyConfirm);
  };

  const close = () => overlay.remove();

  const applyConfirm = async () => {
    if (!selected.size) return;
    // Add all selected ids to the existing compatibility array.
    const newIds = Array.from(new Set([...compatIds, ...selected]));
    close();
    await persistPartCompatibility(p, newIds);
    NX.toast && NX.toast(`Linked to ${selected.size} more equipment`, 'success', 1800);
  };

  document.body.appendChild(overlay);
  renderSheet();
}

/* ─── Equipment → Link existing parts (inverted bulk sheet) ───────
 *
 * Mirror of openBulkCompatibilitySheet, but from the equipment side.
 * On a part: "this part fits which equipment?" — picks equipment.
 * On an equipment: "which existing parts also fit this unit?" — picks
 * parts. Both write to the same column (compatible_equipment_ids on
 * each selected part), so the link surfaces in both views.
 *
 * Sorted same-manufacturer-first: if this is a Hoshizaki ice machine,
 * parts whose PRIMARY equipment is also Hoshizaki float to the top
 * with a "SAME BRAND" badge. Most likely shared-OEM parts.
 */
async function openEquipmentLinkPartsSheet(equipId) {
  // Need the target equipment + the full parts catalog.
  const eqList = (typeof equipment !== 'undefined' && equipment) ? equipment : [];
  const targetEq = eqList.find(e => String(e.id) === String(equipId));
  if (!targetEq) {
    NX.toast && NX.toast('Equipment not found', 'error', 1800);
    return;
  }

  // Pull all parts from the catalog. Annotate each with its primary
  // equipment (for same-brand sorting) and current compatible set.
  let allParts = [];
  try {
    const { data, error } = await NX.sb.from('equipment_parts').select('*').order('part_name');
    if (error) throw error;
    allParts = data || [];
  } catch (e) {
    console.error('[openEquipmentLinkPartsSheet] load:', e);
    NX.toast && NX.toast('Could not load parts catalog: ' + (e.message || ''), 'error', 3000);
    return;
  }

  // Annotate with primary-equipment lookup.
  const eqById = {};
  for (const e of eqList) eqById[e.id] = e;

  // Exclude parts already linked to this equipment (either primary or
  // already in the compatible_equipment_ids array). The user wants to
  // ADD links, not re-link existing ones.
  const candidates = allParts.filter(p => {
    if (String(p.equipment_id) === String(equipId)) return false;
    const compatIds = Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids : [];
    if (compatIds.some(id => String(id) === String(equipId))) return false;
    return true;
  });

  if (!candidates.length) {
    NX.toast && NX.toast('Every part in the catalog is already linked to this unit', 'info', 2400);
    return;
  }

  // Sort same-brand-first. A part's "brand" is its primary equipment's
  // manufacturer. If we don't have it, the part still appears but
  // doesn't get the badge.
  const targetMfg = (targetEq.manufacturer || '').toLowerCase().trim();
  candidates.sort((a, b) => {
    const aMfg = (eqById[a.equipment_id]?.manufacturer || '').toLowerCase().trim();
    const bMfg = (eqById[b.equipment_id]?.manufacturer || '').toLowerCase().trim();
    const aMatch = targetMfg && aMfg === targetMfg ? 1 : 0;
    const bMatch = targetMfg && bMfg === targetMfg ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return (a.part_name || '').localeCompare(b.part_name || '');
  });

  const overlay = document.createElement('div');
  overlay.className = 'eq-bulk-sheet-overlay';
  const selected = new Set();
  let searchQ = '';

  const renderSheet = () => {
    const q = searchQ.toLowerCase().trim();
    const visible = q
      ? candidates.filter(p =>
          (p.part_name || '').toLowerCase().includes(q) ||
          (p.oem_part_number || '').toLowerCase().includes(q) ||
          (p.supplier || '').toLowerCase().includes(q)
        )
      : candidates;

    overlay.innerHTML = `
      <div class="eq-bulk-sheet-backdrop"></div>
      <div class="eq-bulk-sheet">
        <div class="eq-bulk-sheet-handle"></div>
        <div class="eq-bulk-sheet-title">Link parts to ${esc(targetEq.name)}</div>
        <div class="eq-bulk-sheet-sub">${targetMfg ? `Same-brand parts (${esc(targetEq.manufacturer)}) are listed first — most likely OEM-compatible.` : 'Pick any existing parts in the catalog that also fit this unit.'}</div>

        <div style="padding: 0 16px 8px;">
          <input type="search" id="ordEqLinkPartsSearch" placeholder="Search part name, OEM, supplier…" value="${esc(searchQ)}" autocomplete="off"
            style="width:100%; padding:10px 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--nx-text); font-size:13px;">
        </div>

        <div class="eq-bulk-sheet-list">
          ${visible.length === 0 ? `<div style="padding:24px; text-align:center; color:var(--nx-faint); font-size:13px;">No parts match "${esc(searchQ)}"</div>` : visible.map(p => {
            const pid = String(p.id);
            const isSel = selected.has(pid);
            const primaryEq = eqById[p.equipment_id];
            const primaryMfg = (primaryEq?.manufacturer || '').toLowerCase().trim();
            const sameBrand = targetMfg && primaryMfg === targetMfg;
            const subParts = [];
            if (p.oem_part_number) subParts.push(`OEM ${esc(p.oem_part_number)}`);
            if (primaryEq) subParts.push(`fits ${esc(primaryEq.name)}`);
            if (p.supplier) subParts.push(esc(p.supplier));
            return `
              <button class="eq-bulk-sheet-item eq-bulk-apply-item ${isSel ? 'is-selected' : ''} ${sameBrand ? 'is-same-brand' : ''}" data-id="${esc(pid)}" type="button">
                <div class="eq-bulk-apply-check">
                  ${isSel ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </div>
                <div class="eq-bulk-sheet-item-text">
                  <div class="eq-bulk-sheet-item-name">${esc(p.part_name)}</div>
                  ${subParts.length ? `<div class="eq-bulk-sheet-item-sub">${subParts.join(' · ')}</div>` : ''}
                </div>
                ${sameBrand ? '<span class="eq-bulk-apply-badge">SAME BRAND</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
        <button class="eq-bulk-sheet-confirm" data-action="confirm" ${selected.size === 0 ? 'disabled' : ''} type="button">
          Link ${selected.size} ${selected.size === 1 ? 'part' : 'parts'}
        </button>
        <button class="eq-bulk-sheet-cancel" data-action="cancel" type="button">Cancel</button>
      </div>
    `;

    overlay.querySelector('.eq-bulk-sheet-backdrop').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.querySelectorAll('[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        renderSheet();
      });
    });
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', applyConfirm);
    const searchInput = overlay.querySelector('#ordEqLinkPartsSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQ = e.target.value;
        // Re-render only the list portion; preserves input focus by
        // capturing cursor position. Simple approach for now: full
        // re-render, then re-focus.
        const pos = e.target.selectionStart;
        renderSheet();
        const fresh = overlay.querySelector('#ordEqLinkPartsSearch');
        if (fresh) { fresh.focus(); try { fresh.setSelectionRange(pos, pos); } catch (_) {} }
      });
    }
  };

  const close = () => overlay.remove();

  const applyConfirm = async () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;
    for (const partId of ids) {
      const p = candidates.find(x => String(x.id) === partId);
      if (!p) continue;
      const existing = Array.isArray(p.compatible_equipment_ids) ? p.compatible_equipment_ids.slice() : [];
      // Avoid duplicates (defensive — candidates filter already excluded
      // already-linked, but parallel edits could race).
      if (!existing.some(id => String(id) === String(equipId))) {
        existing.push(typeof equipId === 'string' ? equipId : Number(equipId));
      }
      try {
        const { error } = await NX.sb.from('equipment_parts')
          .update({ compatible_equipment_ids: existing })
          .eq('id', p.id);
        if (error) throw error;
        succeeded++;
      } catch (e) {
        console.error('[openEquipmentLinkPartsSheet] update', partId, e);
        failed++;
      }
    }
    overlay.remove();
    if (succeeded > 0) {
      NX.toast && NX.toast(`Linked ${succeeded} part${succeeded === 1 ? '' : 's'} to ${targetEq.name}`, 'success', 2200);
      // Reload the equipment detail to show the newly-linked parts.
      if (typeof openDetail === 'function') {
        openDetail(equipId);
      }
    }
    if (failed > 0) {
      NX.toast && NX.toast(`${failed} link${failed === 1 ? '' : 's'} failed — check console`, 'error', 3000);
    }
  };

  renderSheet();
  document.body.appendChild(overlay);
}

async function persistPartCompatibility(p, ids) {
  try {
    const { data, error } = await NX.sb.from('equipment_parts')
      .update({ compatible_equipment_ids: ids }).eq('id', p.id).select('*').single();
    if (error) throw error;
    Object.assign(p, data);
    // Re-derive _compatible from the in-memory equipment list.
    const eqList = (typeof equipment !== 'undefined' && equipment) ? equipment : [];
    p._compatible = ids.map(id => eqList.find(e => e.id === id)).filter(Boolean);
    p._usedByCount = (p.equipment_id ? 1 : 0) + ids.filter(id => id !== p.equipment_id).length;
    renderParts2();
    NX.toast && NX.toast('Compatibility updated', 'success', 1100);
  } catch (e) {
    console.error('[equipment] persistPartCompatibility:', e);
    const msg = (e.message || '') + '';
    if (/column.*does not exist/i.test(msg)) {
      NX.toast && NX.toast('Compatibility needs a DB migration — see notes', 'warn', 2400);
    } else {
      NX.toast && NX.toast('Could not save: ' + msg, 'error');
    }
  }
}

/* ─── Add new part ───────────────────────────────────────────────── */

async function addNewPart(prefilledEquipId) {
  // Need an equipment to attach to. If we're in a filtered view, use that.
  // Otherwise prompt-pick from the equipment list.
  let equipId = prefilledEquipId;
  if (!equipId) {
    const eqList = (typeof equipment !== 'undefined' && equipment) ? equipment : [];
    if (!eqList.length) {
      NX.toast && NX.toast('No equipment yet — add equipment first', 'warn');
      return;
    }
    // Quick-and-dirty: prompt with a numbered list. Future: bottom-sheet picker.
    const lines = eqList.slice(0, 30).map((e, i) => `${i + 1}. ${e.name}${e.location ? ' — ' + e.location : ''}`).join('\n');
    const choice = prompt(`Which equipment owns this part?\n\n${lines}${eqList.length > 30 ? `\n\n…and ${eqList.length - 30} more (type the name to search)` : ''}\n\nType a number or name:`);
    if (!choice) return;
    let pick = null;
    const idx = parseInt(choice, 10);
    if (Number.isFinite(idx) && idx > 0 && idx <= eqList.length) {
      pick = eqList[idx - 1];
    } else {
      const lower = choice.toLowerCase();
      pick = eqList.find(e => (e.name || '').toLowerCase().includes(lower));
    }
    if (!pick) {
      NX.toast && NX.toast('Could not match that equipment', 'warn');
      return;
    }
    equipId = pick.id;
  }

  const name = prompt('Part name:');
  if (!name || !name.trim()) return;

  try {
    const { data, error } = await NX.sb.from('equipment_parts').insert({
      equipment_id: equipId,
      part_name: name.trim(),
      quantity: 1,
    }).select('*').single();
    if (error) throw error;
    // Annotate the new row with derived fields and open detail.
    const eqLookup = partsState.equipmentLookup || {};
    data._equipment = eqLookup[equipId] || null;
    data._compatible = [];
    data._usedByCount = 1;
    data._nextDue = null;
    data._nextDueDaysLeft = null;
    partsState.list.unshift(data);
    partsState.mode = 'detail';
    partsState.activeId = data.id;
    partsState.activePart = data;
    partsState.detailTab = 'overview';
    renderParts2();
    NX.toast && NX.toast('Part created — fill in the details', 'info', 1500);
  } catch (e) {
    console.error('[equipment] addNewPart:', e);
    NX.toast && NX.toast('Could not add: ' + (e.message || ''), 'error');
  }
}


// v18.15 — three layers of protection for NX.modules.equipment.
//
// PROBLEM: Inline onclick handlers throughout equipment.js (76 of them,
// covering 57 functions: archiveEquipment, openParts, openDetail,
// uploadPhoto, deletePart, etc.) all dispatch through
// NX.modules.equipment.X(...). Production reports of those handlers
// silently failing (the button does nothing, no error visible) plus
// the FAB dial diagnostic showing "NX.modules missing" prove that
// something downstream is clearing the namespace. Static analysis
// can't find what's doing it — no `NX.modules =` assignments, no
// `delete` operations. So we engineer for resilience.
//
// THREE LAYERS:
//   1. window.__nxe — permanent backup reference. Any caller can use
//      window.__nxe.archiveEquipment(id) and it will always work.
//   2. Object.defineProperty installs a non-configurable getter on
//      NX.modules.equipment. Direct overwrites silently fail and log
//      a stack trace pointing at the offending caller.
//   3. Watchdog (200ms) detects if NX.modules itself gets replaced
//      with a different object and reinstalls protection on the new
//      one. Catches the "wholesale replacement" case that bypasses
//      defineProperty.
//
// Plus the existing window.__nxOpenParts / __nxOpenArchiveWorld that
// the FAB dial uses as its primary path.

// QR deep-link opener. Resolves a scanned qr_code to its equipment row
// and opens the detail sheet. Used by the post-login redirect in app.js
// (scan sticker → PIN → land on the unit). Tries the already-loaded list
// first (no query); falls back to a direct lookup so it still works
// before loadEquipment() has populated the list, then surfaces a clear
// toast if the code genuinely matches nothing.
async function openDetailByQr(qrCode) {
  if (!qrCode) return;
  const local = (equipment || []).find(e => e.qr_code === qrCode);
  if (local) { openDetail(local.id); return; }
  try {
    const { data, error } = await NX.sb.from('equipment')
      .select('id').eq('qr_code', qrCode).maybeSingle();
    if (error) {
      console.error('[equipment] openDetailByQr lookup failed:', error.message);
      NX.toast && NX.toast('Could not load that unit — check your connection.', 'error', 3000);
      return;
    }
    if (data?.id) { openDetail(data.id); return; }
  } catch (err) {
    console.error('[equipment] openDetailByQr threw:', err);
  }
  NX.toast && NX.toast(`QR code ${qrCode} not recognized`, 'warn', 4000);
}

// Staff-side one-tap work-order completion — mirror of the contractor's
// "Complete Work Order" button on the public QR scan. Routes through the
// same consolidated NX.work.fulfillForEquipment cascade (mark issue
// repaired → close card + ticket → restore status → log maintenance), so
// both surfaces behave identically. Smart about empty state: if the unit
// has nothing open, it says so instead of pretending to close something.
async function completeWorkOrder(equipmentId) {
  if (!equipmentId) return;
  const W = window.NX && NX.work;
  if (!W || !W.fulfillForEquipment) {
    NX.toast && NX.toast('Work API not loaded', 'error', 2600);
    return;
  }
  let open = null;
  try { open = W.findOpenForEquipment ? await W.findOpenForEquipment({ equipmentId }) : { unknown: true }; } catch (_) {}
  if (open === null) {
    NX.toast && NX.toast('No open work order for this unit', 'info', 2600);
    return;
  }
  if (!confirm('Mark this work order complete? This closes the board card and logs the service.')) return;
  try {
    const who = (NX.currentUser && NX.currentUser.name) || 'Staff';
    const res = await W.fulfillForEquipment({ equipmentId, performedBy: who });
    if (res && res.ok) {
      NX.toast && NX.toast('Work order completed', 'success', 2600);
      try { closeDetail(); } catch (_) {}
      try { await loadEquipment(); buildUI(); } catch (_) {}
    } else {
      NX.toast && NX.toast('Could not complete the work order', 'error', 3000);
    }
  } catch (e) {
    console.error('[equipment] completeWorkOrder:', e);
    NX.toast && NX.toast('Could not complete the work order', 'error', 3000);
  }
}

const __nxeExports = {
  // Lifecycle
  init,
  show: buildUI,
  add: () => openEditModal(null),
  edit: openFullEditor,           // The canonical "edit" is the full 6-tab editor

  // List/detail
  openDetail,
  openDetailByQr,    // QR deep-link → detail (used by app.js post-login redirect)
  completeWorkOrder, // staff one-tap WO completion (mirrors public scan)
  emailVendor,       // ✉ Email on SERVICED BY / REPAIRS BY → note → trail → composer
  callVendor,        // 📞 Call — same note-first flow, then dials
  closeDetail,
  loadEquipment,
  buildUI,
  getFiltered,
  reportIssue,       // Creates a board card prefilled with this equipment

  // Live read-only handle to the loaded equipment array. Exposed as a
  // getter (not a value) because loadEquipment() REASSIGNS `equipment`,
  // so a captured value would go stale. equipment-context-menu.js reads
  // this to resolve a unit's name for soft-delete confirms.
  get _allEquipment() { return equipment; },

  // Activity log (per-location global view)
  openEquipmentActivityLog,
  closeEquipmentActivityLog,
  // v18.32 Phase 3b — expose the event writer so other modules can log
  // (also available as NX.logEquipmentEvent for non-module-aware callers)
  logEquipmentEvent,

  // Add/edit modal (simple form)
  closeEdit,
  deleteEquipment,
  archiveEquipment,
  restoreEquipment,

  // Service log + parts
  logService,
  showDetailTab,
  exportToResQ,
  closeService,
  deleteMaintenance,
  approvePmLog,
  rejectPmLog,
  markPmSpam,
  addPart,
  editPart,
  deletePart,
  closePart,

  // Manual
  removeManual,
  removeManualById,
  renameManual,
  uploadManual,
  autoFetchManual,
  hydrateManualPanel,
  enhanceManualPanel: hydrateManualPanel, // alias for back-compat with any old call sites

  // AI intelligence
  scanDataPlate,
  detectPatterns,
  analyzeCost,
  renderIntelligenceTab,
  scanFleet,
  suggestPMDate,
  applyPredictivePM,
  extractBOMFromManual,
  exportPartsCart,
  checkWarranties,

  // AI create
  openAICreator,
  openDescribeDialog,
  photoIdentify,
  bulkIdentify,
  createFromDescription,

  // Full editor + attachments
  openFullEditor,
  closeFullEdit,
  addAttachment,
  deleteAttachment,
  editAttachmentDesc,
  uploadPhoto,
  replacePhoto,
  quickReplacePhoto,
  openQuickStatusMenuForRow,
  removePhoto,
  deleteCustomField,

  // Printing
  generateZPL,
  generateZPLBatch,
  openZebraPrintDialog,
  printZebraSingle,
  printZebraBatch,
  quickPrint,
  printSingleQR,
  printQRSheet,
  printServiceLog,
  copyQRLink,
  printInventoryStickers,    // Phase C — inventory uses the same sticker engine

  // Public scan (pre-auth)
  publicReportIssue,

  // Lineage
  loadFamily,
  pickParent,
  pickChild,
  unsetParent,

  // Dispatch
  openDispatchSheet,
  loadContractors,
  cycleDispatchOutcome,
  dispatchFromTicket,
  callService,
  lookupServicePhoneFromNode,
  toggleOverflow,
  enhancePartsList,
  openBarsStudio,

  // Issue tracker (lifecycle)
  openIssueTracker,
  closeIssueTracker,
  loadEquipmentIssues,
  loadOpenIssuesByEquipment,
  transitionIssueTo,
  emailContractorAboutIssue,

  // Bulk operations
  enterBulkMode,
  exitBulkMode,
  toggleBulkSelection,
  openBulkContractorAssign,
  openBulkPmSchedule,
  schedulePmFromOverflow,

  // Manufacturers / brand library
  loadManufacturers,
  resolveManufacturer,
  manufacturerLogo,
  autoLinkManufacturer,
  openBrandLibrary,
  closeBrandLibrary,

  // Fleet Intelligence — analytics
  openAnalytics,
  closeAnalytics,
  computeFleetSnapshot,
  buildDigestText,
  detectFailurePatterns,

  // Contractors — full management overlay
  openContractors,
  closeContractors,
  openContractorDetail,
  addNewContractor,

  // Long-press action dial
  wireEquipmentLongPress,
  openEquipmentActionsDial,
  closeEquipmentActionsDial,

  // Parts catalog (fleet-wide)
  openParts,
  openPartsForEquipment,
  openEquipmentLinkPartsSheet,
  openCategoryManager,
  loadCategoriesFromDB,
  renderPmProgressBar,
  computePmCountdown,
  openPmLogger,
  openFieldEditor,
  markPartReplacedOnEquipment,
  openLocationEditor,
  loadLocationsFromDB,
  enterLocation,
  exitLocation,
  openScheduleEditor,
  loadPmSchedules,
  openPartDetail,
  closeParts,
  loadPartsList,
  markPartReplaced,

  // Archive world (v14) — focused view for archived equipment with banner
  openArchiveWorld,
  closeArchiveWorld,

  // Section management — collapse, rename, move equipment
  promptRenameSection,
  moveEquipmentToSection,
  moveEquipmentInSection,
  pickSection,
};

// ─── Three layers of protection (see explanation above) ───────────────
window.__nxe = __nxeExports;
window.__nxOpenParts = openParts;
window.__nxOpenArchiveWorld = openArchiveWorld;

function __nxe_get() { return __nxeExports; }
function __nxe_set(v) {
  console.warn('[equipment] BLOCKED overwrite of NX.modules.equipment with:', v);
  try { console.warn(new Error().stack); } catch(_) {}
}
function __nxe_install(target) {
  if (!target) return;
  try {
    const desc = Object.getOwnPropertyDescriptor(target, 'equipment');
    if (desc && desc.get === __nxe_get) return;  // already installed
    if (desc && !desc.configurable) {
      // Existing non-configurable descriptor — can't replace it. Best
      // we can do is leave it alone; if it's not our getter, it's the
      // direct value, which is still __nxeExports anyway.
      return;
    }
    Object.defineProperty(target, 'equipment', {
      get: __nxe_get,
      set: __nxe_set,
      configurable: false,
      enumerable: true,
    });
  } catch (e) {
    console.error('[equipment] __nxe_install failed:', e);
    try { target.equipment = __nxeExports; } catch (_) {}  // best-effort fallback
  }
}
__nxe_install(NX.modules);

// Watchdog — catches the case where NX.modules itself gets replaced
// with a different object (bypassing the immutable property on the
// old one). Reinstalls protection on the new object. 200ms is cheap
// (~1µs per check) and catches replacement within a tick.
let __nxe_lastM = NX.modules;
setInterval(() => {
  if (!window.NX) window.NX = {};
  const m = window.NX.modules;
  if (!m) {
    window.NX.modules = {};
    __nxe_install(window.NX.modules);
    console.warn('[equipment] NX.modules was undefined — recreated + reinstalled');
  } else if (m !== __nxe_lastM) {
    __nxe_install(m);
    console.warn('[equipment] NX.modules was replaced — reinstalled protection');
  }
  __nxe_lastM = window.NX.modules;
}, 200);

console.log('[Equipment] unified module loaded — ' + Object.keys(__nxeExports).length + ' exports, protected');

// ─── Self-test: contractor editor wiring ──────────────────────────────
// Runs once shortly after equipment.js loads. If any required piece is
// missing (engine not loaded, function not defined, etc.) we log loudly
// to the console — that's diagnosable without UI access. The tap-Edit
// path adds toasts on top of these for the actual user-facing test.
setTimeout(() => {
  const checks = [
    ['window.NX exists',            () => !!window.NX],
    ['NX.recordEditor loaded',      () => !!(window.NX && NX.recordEditor)],
    ['NX.recordEditor.openOverlay', () => !!(window.NX && NX.recordEditor && typeof NX.recordEditor.openOverlay === 'function')],
    ['openContractorEditor defined',() => typeof openContractorEditor === 'function'],
    ['extractContractorEmails',     () => typeof extractContractorEmails === 'function'],
    ['extractContractorPhones',     () => typeof extractContractorPhones === 'function'],
    ['extractContractorTags',       () => typeof extractContractorTags === 'function'],
    ['NX.sb (Supabase client)',     () => !!(window.NX && NX.sb)],
  ];
  console.group('[contractor edit self-test]');
  let allPass = true;
  for (const [name, fn] of checks) {
    let pass = false;
    try { pass = !!fn(); } catch (_) { pass = false; }
    console.log((pass ? '✓' : '✗') + ' ' + name);
    if (!pass) allPass = false;
  }
  console.groupEnd();
  if (!allPass) {
    console.error('[contractor edit self-test] FAILURES — Edit button will not work');
  }
}, 500);

})();
