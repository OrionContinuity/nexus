/* ═══════════════════════════════════════════════════════════════════════
   NEXUS INVENTORY — Phase B + C
   ─────────────────────────────────────────────────────────────────────
   Replaces the Phase A placeholder. Full implementation:
     • Dashboard with alerts (below-PAR, missing assets, audit due)
     • Assets list + detail (with photo gallery + history timeline)
     • Stock list + detail (with count flow + receive flow)
     • Audit walkthrough (guided count for quarterly counts)
     • Equipment-parts integration (Phase C)
     • PM completion modal (Phase C)
     • QR scan dispatch — ?inv-asset=XXX, ?inv-stock=XXX URL params

   File structure:
     1. CONSTANTS & STATE
     2. UTILITIES — esc, fmtDate, ICONS
     3. STYLES — injected once
     4. SCAN DISPATCH — URL param handling
     5. DATA LOADING
     6. DASHBOARD render
     7. ASSETS list + detail + actions
     8. STOCK list + detail + actions
     9. AUDITS list + walkthrough
    10. ADD / EDIT modals
    11. PHOTO upload helper
    12. EQUIPMENT-PARTS integration (Phase C)
    13. PM COMPLETION modal (Phase C)
    14. REORDER CARD creation
    15. UI plumbing — modal, render orchestration
    16. EXPORT
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  if (!window.NX) { console.error('[inventory] NX not loaded'); return; }

  /* ════════════════════════════════════════════════════════════════
     1. CONSTANTS & STATE
     ════════════════════════════════════════════════════════════════ */

  const LOCATIONS = ['Suerte', 'Este', 'Bar Toti'];

  const ASSET_CATEGORIES = [
    { key: 'power_tools',  label: 'Power Tools' },
    { key: 'measurement',  label: 'Measurement' },
    { key: 'cutlery',      label: 'Cutlery' },
    { key: 'specialty',    label: 'Specialty' },
    { key: 'electronics',  label: 'Electronics' },
    { key: 'safety',       label: 'Safety' },
    { key: 'other',        label: 'Other' },
  ];

  const STOCK_CATEGORIES = [
    { key: 'refrigeration',          label: 'Refrigeration' },
    { key: 'cooking',                label: 'Cooking' },
    { key: 'ice',                    label: 'Ice' },
    { key: 'water_plumbing',         label: 'Water/Plumbing' },
    { key: 'electrical',             label: 'Electrical' },
    { key: 'hvac',                   label: 'HVAC' },
    { key: 'dish_chemicals',         label: 'Dish Chemicals' },
    { key: 'cleaning',               label: 'Cleaning' },
    { key: 'smallware_replacements', label: 'Smallware' },
    { key: 'foh_consumables',        label: 'FOH' },
    { key: 'safety',                 label: 'Safety' },
    { key: 'other',                  label: 'Other' },
  ];

  const ASSET_STATUSES = [
    { key: 'on_shelf',  label: 'On Shelf',   color: '#9c8a3e' },
    { key: 'in_use',    label: 'In Use',     color: '#9c8a3e' },
    { key: 'loaned',    label: 'Loaned',     color: '#d4a44e' },
    { key: 'relocated', label: 'Relocated',  color: '#d4a44e' },
    { key: 'broken',    label: 'Broken',     color: '#a83e3e' },
    { key: 'missing',   label: 'Missing',    color: '#a83e3e' },
    { key: 'retired',   label: 'Retired',    color: '#6b6258' },
  ];

  const state = {
    activeTab:    'dashboard',
    assets:       [],
    stock:        [],
    audits:       [],
    schedules:    [],
    users:        [],
    filters: {
      assetSearch:    '', assetLocation:  'all', assetCategory:  'all', assetStatus: 'all',
      stockSearch:    '', stockLocation:  'all', stockCategory:  'all', stockBelowPar:  false,
    },
    currentAuditId: null,
    auditDeltas:    {},
  };

  /* ════════════════════════════════════════════════════════════════
     2. UTILITIES
     ════════════════════════════════════════════════════════════════ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function fmtRelative(d) {
    if (!d) return 'never';
    const dt = (d instanceof Date) ? d : new Date(d);
    const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
    if (days < 0) return `in ${-days}d`;
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  function fmtCost(c) {
    if (c == null || c === '') return '';
    const n = parseFloat(c);
    if (isNaN(n)) return '';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusPill(status) {
    const s = ASSET_STATUSES.find(x => x.key === status) || ASSET_STATUSES[0];
    return `<span class="inv-pill" style="--pill-c:${s.color}">${esc(s.label)}</span>`;
  }

  // Lucide-style category icons. Each path is the inner of a 24x24 SVG.
  const ICONS = {
    power_tools:  '<path d="M12 2v4"/><path d="m6.34 6.34-2.83-2.83"/><path d="m17.66 6.34 2.83-2.83"/><circle cx="12" cy="14" r="6"/><path d="m9 14 2 2 4-4"/>',
    measurement:  '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12v2M10 12v2M14 12v2M18 12v2"/><path d="M6 8v2M10 8v2M14 8v2M18 8v2"/>',
    cutlery:      '<path d="M14.121 14.121 6 22"/><path d="M14.121 14.121 22 6"/><path d="M14.121 14.121 9 9"/><path d="M9 9 4.5 4.5"/>',
    specialty:    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    electronics:  '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    safety:       '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    other:        '<circle cx="12" cy="12" r="3"/>',
    refrigeration:          '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14"/><line x1="9" y1="6" x2="9.01" y2="6"/><line x1="9" y1="14" x2="9.01" y2="14"/>',
    cooking:                '<path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>',
    ice:                    '<path d="M2 12h20"/><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="m19.07 4.93-14.14 14.14"/>',
    water_plumbing:         '<path d="M12 2.69a17.47 17.47 0 0 1 5.16 4.85L18 9c.74 1 1 2.18 1 3.27A7 7 0 0 1 5 12.27c0-1.09.26-2.27 1-3.27l.84-1.46A17.47 17.47 0 0 1 12 2.69Z"/>',
    electrical:             '<path d="m13 2-3 7h6l-3 11"/>',
    hvac:                   '<path d="M12 12v9"/><path d="M12 3v3"/><path d="m4.93 4.93 2.12 2.12"/><circle cx="12" cy="12" r="3"/>',
    dish_chemicals:         '<path d="M14 4V2H10v2"/><path d="M9 4h6l3 16H6L9 4Z"/><path d="M8 12h8"/>',
    cleaning:               '<path d="M3 22h18"/><path d="M6 18V8a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v10"/><path d="M9 5V3h6v2"/>',
    smallware_replacements: '<path d="M11 11.5V14"/><path d="m6 11 11.5 11.5"/><path d="m12.5 5.5 4-4 4 4-4 4Z"/>',
    foh_consumables:        '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
  };

  function catIcon(cat) {
    const path = ICONS[cat] || ICONS.other;
    return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle">${path}</svg>`;
  }

  function getCategoryLabel(type, key) {
    const list = type === 'asset' ? ASSET_CATEGORIES : STOCK_CATEGORIES;
    return (list.find(c => c.key === key) || { label: key }).label;
  }

  /* ════════════════════════════════════════════════════════════════
     3. STYLES — injected once
     ════════════════════════════════════════════════════════════════ */

  const STYLES = `
    #inventoryView {
      font-family: 'DM Sans', system-ui, sans-serif;
      color: var(--nx-text);
      padding: 0 0 80px;
    }
    .inv-wrap { max-width: 720px; margin: 0 auto; padding: 18px 16px 0; }

    .inv-tabs {
      display: flex; gap: 4px; margin: 0 0 18px; padding: 4px;
      background: var(--nx-surface-1); border: 1px solid var(--nx-gold-line);
      border-radius: 999px; overflow-x: auto; scrollbar-width: none;
    }
    .inv-tabs::-webkit-scrollbar { display: none; }
    .inv-tab {
      flex: 1; padding: 8px 14px; min-height: 36px; border: none;
      background: transparent; color: var(--nx-muted); font-family: inherit;
      font-size: 12.5px; font-weight: 500; letter-spacing: 0.3px;
      border-radius: 999px; cursor: pointer; white-space: nowrap;
      transition: color .15s, background .15s;
      -webkit-tap-highlight-color: transparent;
    }
    .inv-tab:hover { color: var(--nx-text); }
    .inv-tab.active {
      background: var(--nx-gold-soft, rgba(200, 164, 78, 0.1));
      color: var(--nx-gold); font-weight: 600;
    }

    .inv-hero { margin: 0 0 18px; }
    .inv-hero-title {
      font-family: 'Outfit', sans-serif; font-size: 24px; font-weight: 400;
      letter-spacing: -0.3px; margin: 0 0 4px; color: var(--nx-text);
    }
    .inv-hero-sub {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      letter-spacing: 1.5px; color: var(--nx-faint); text-transform: uppercase;
    }

    .inv-alerts {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 8px; margin: 16px 0 18px;
    }
    .inv-alert {
      padding: 12px 10px; border: 1px solid var(--nx-gold-line);
      border-radius: 12px; background: var(--nx-surface-1); text-align: center;
      cursor: pointer; transition: border-color .15s, background .15s, transform .12s;
      -webkit-tap-highlight-color: transparent;
    }
    .inv-alert:active { transform: scale(.97); }
    .inv-alert.is-active {
      border-color: var(--nx-gold);
      background: var(--nx-gold-soft, rgba(200, 164, 78, 0.06));
    }
    .inv-alert.alert-danger.is-active {
      border-color: #a83e3e; background: rgba(168, 62, 62, 0.08);
    }
    .inv-alert-num {
      font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 700;
      color: var(--nx-text); line-height: 1; display: block; margin-bottom: 4px;
    }
    .inv-alert.is-active .inv-alert-num { color: var(--nx-gold); }
    .inv-alert.alert-danger.is-active .inv-alert-num { color: #c8625e; }
    .inv-alert-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600;
      letter-spacing: 1.2px; text-transform: uppercase; color: var(--nx-faint);
    }
    .inv-alert.is-active .inv-alert-label { color: var(--nx-gold); }

    .inv-scan-btn {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 14px; min-height: 50px; border: none;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--nx-gold), var(--nx-gold-deep));
      color: var(--nx-gold-on, #1c1408);
      font-family: 'Outfit', sans-serif; font-size: 15px; font-weight: 600;
      letter-spacing: 0.3px; cursor: pointer;
      box-shadow: 0 4px 12px rgba(200, 164, 78, 0.2);
      transition: transform .15s; margin-bottom: 18px;
    }
    .inv-scan-btn:active { transform: scale(.98); }
    .inv-scan-btn svg { width: 20px; height: 20px; }

    .inv-listhead { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .inv-search {
      width: 100%; padding: 11px 14px; background: var(--nx-surface-1);
      border: 1px solid var(--nx-gold-line); border-radius: 999px;
      color: var(--nx-text); font-family: inherit; font-size: 14px;
      transition: border-color .15s;
    }
    .inv-search:focus { outline: none; border-color: var(--nx-gold); }
    .inv-search::placeholder { color: var(--nx-faint); }

    .inv-filter-row {
      display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
      padding-bottom: 4px; -webkit-overflow-scrolling: touch;
    }
    .inv-filter-row::-webkit-scrollbar { display: none; }
    .inv-chip {
      flex-shrink: 0; padding: 6px 12px; min-height: 30px;
      border: 1px solid var(--nx-gold-line); background: transparent;
      color: var(--nx-faint); font-family: 'JetBrains Mono', monospace;
      font-size: 10.5px; font-weight: 500; letter-spacing: 0.5px;
      text-transform: uppercase; border-radius: 999px; cursor: pointer;
      transition: color .15s, border-color .15s, background .15s;
      -webkit-tap-highlight-color: transparent; white-space: nowrap;
    }
    .inv-chip:hover { color: var(--nx-text); }
    .inv-chip.active {
      color: var(--nx-gold); border-color: var(--nx-gold);
      background: var(--nx-gold-soft, rgba(200, 164, 78, 0.06));
    }

    .inv-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .inv-row {
      display: grid; grid-template-columns: 36px 1fr auto;
      align-items: center; gap: 12px; padding: 12px 14px;
      background: var(--nx-surface-1); border: 1px solid var(--nx-gold-line);
      border-radius: 12px; cursor: pointer;
      transition: border-color .15s, background .15s, transform .12s;
      -webkit-tap-highlight-color: transparent;
    }
    .inv-row:active { transform: scale(.99); }
    .inv-row-icon {
      width: 36px; height: 36px; border-radius: 50%;
      background: var(--nx-gold-soft, rgba(200, 164, 78, 0.08));
      color: var(--nx-gold); font-size: 18px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .inv-row-img {
      width: 36px; height: 36px; border-radius: 8px;
      object-fit: cover; flex-shrink: 0;
    }
    .inv-row-body { min-width: 0; }
    .inv-row-title {
      font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 500;
      color: var(--nx-text); letter-spacing: 0.05px; line-height: 1.3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .inv-row-sub {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: var(--nx-faint); letter-spacing: 0.5px; text-transform: uppercase;
      margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .inv-row-right { flex-shrink: 0; text-align: right; }
    .inv-row-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
      font-weight: 500; color: var(--nx-faint); letter-spacing: 0.4px;
    }
    .inv-row-meta.below-par { color: #c8625e; font-weight: 600; }
    .inv-row-meta.below-par-warn { color: var(--nx-gold); font-weight: 600; }

    .inv-pill {
      display: inline-block; padding: 3px 10px; border-radius: 999px;
      background: color-mix(in srgb, var(--pill-c, #9c8a3e) 15%, transparent);
      color: var(--pill-c, #9c8a3e);
      font-family: 'JetBrains Mono', monospace;
      font-size: 9.5px; font-weight: 600; letter-spacing: 0.8px;
      text-transform: uppercase;
      border: 1px solid color-mix(in srgb, var(--pill-c, #9c8a3e) 30%, transparent);
    }

    .inv-empty { text-align: center; padding: 48px 24px; color: var(--nx-faint); }
    .inv-empty-icon { font-size: 48px; color: var(--nx-gold-line-2, rgba(200, 164, 78, 0.3)); margin-bottom: 12px; display: flex; justify-content: center; }
    .inv-empty-icon svg { width: 48px; height: 48px; }
    .inv-empty-title {
      font-family: 'Outfit', sans-serif; font-size: 18px;
      color: var(--nx-text); margin-bottom: 6px;
    }
    .inv-empty-msg {
      font-size: 13px; color: var(--nx-muted); line-height: 1.5;
      max-width: 320px; margin: 0 auto 18px;
    }
    .inv-empty-cta {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 20px; border: 1px solid var(--nx-gold);
      background: transparent; color: var(--nx-gold);
      font-family: inherit; font-size: 13px; font-weight: 500;
      border-radius: 999px; cursor: pointer; transition: background .15s;
    }
    .inv-empty-cta:hover { background: var(--nx-gold-soft, rgba(200, 164, 78, 0.08)); }

    .inv-add-fab {
      position: fixed;
      right: calc(env(safe-area-inset-right, 0px) + 16px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 78px);
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(180deg, var(--nx-gold), var(--nx-gold-deep));
      color: var(--nx-gold-on, #1c1408); border: none;
      box-shadow: 0 6px 16px rgba(200, 164, 78, 0.3); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      z-index: 100; transition: transform .15s;
    }
    .inv-add-fab:active { transform: scale(.92); }
    .inv-add-fab svg { width: 24px; height: 24px; }

    .inv-detail {
      position: fixed; inset: 0; background: var(--nx-bg);
      z-index: 1000; overflow-y: auto;
      animation: invSlideUp .25s ease-out;
    }
    @keyframes invSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .inv-detail-head {
      position: sticky; top: 0; background: var(--nx-bg);
      border-bottom: 1px solid var(--nx-gold-line);
      padding: 12px 16px; display: flex; align-items: center;
      gap: 12px; z-index: 10;
    }
    .inv-detail-back {
      width: 36px; height: 36px; border: none;
      background: var(--nx-surface-1); color: var(--nx-text);
      border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .inv-detail-back svg { width: 18px; height: 18px; }
    .inv-detail-pn {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: var(--nx-faint); letter-spacing: 1px;
    }
    .inv-detail-actions { margin-left: auto; display: flex; gap: 6px; }
    .inv-detail-action {
      width: 36px; height: 36px; border: 1px solid var(--nx-gold-line);
      background: transparent; color: var(--nx-muted); border-radius: 50%;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: color .15s, border-color .15s;
    }
    .inv-detail-action:hover { color: var(--nx-gold); border-color: var(--nx-gold); }
    .inv-detail-action svg { width: 18px; height: 18px; }
    .inv-detail-body {
      max-width: 640px; margin: 0 auto; padding: 18px 16px 80px;
    }

    .inv-detail-photo {
      width: 100%; aspect-ratio: 4/3; object-fit: cover;
      border-radius: 14px; margin-bottom: 18px; background: var(--nx-surface-1);
    }
    .inv-detail-photo-empty {
      width: 100%; aspect-ratio: 4/3; border-radius: 14px;
      margin-bottom: 18px; background: var(--nx-surface-1);
      border: 1px dashed var(--nx-gold-line-2, rgba(200, 164, 78, 0.3));
      display: flex; align-items: center; justify-content: center;
      color: var(--nx-faint); font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 1px;
    }

    .inv-detail-titleblock { margin-bottom: 18px; }
    .inv-detail-cat {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      letter-spacing: 2px; color: var(--nx-gold);
      text-transform: uppercase; margin-bottom: 4px;
    }
    .inv-detail-title {
      font-family: 'Outfit', sans-serif; font-size: 26px; font-weight: 400;
      letter-spacing: -0.4px; margin: 0 0 6px; line-height: 1.15; color: var(--nx-text);
    }
    .inv-detail-sub {
      font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--nx-muted);
    }

    .inv-specs {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 14px 18px; margin: 18px 0; padding: 16px;
      background: var(--nx-surface-1); border: 1px solid var(--nx-gold-line);
      border-radius: 12px;
    }
    .inv-spec-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600;
      letter-spacing: 1.2px; color: var(--nx-faint);
      text-transform: uppercase; margin-bottom: 3px;
    }
    .inv-spec-value {
      font-size: 13.5px; color: var(--nx-text); line-height: 1.35; word-break: break-word;
    }
    .inv-spec-value.dim { color: var(--nx-faint); }

    .inv-actions {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px; margin: 18px 0;
    }
    .inv-action-btn {
      padding: 12px 14px; min-height: 44px;
      border: 1px solid var(--nx-gold-line); background: var(--nx-surface-1);
      color: var(--nx-text); font-family: 'Outfit', sans-serif;
      font-size: 13px; font-weight: 500; border-radius: 10px; cursor: pointer;
      transition: border-color .15s, background .15s, transform .12s;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .inv-action-btn:hover { border-color: var(--nx-gold); }
    .inv-action-btn:active { transform: scale(.97); }
    .inv-action-btn.primary {
      background: linear-gradient(180deg, var(--nx-gold), var(--nx-gold-deep));
      color: var(--nx-gold-on, #1c1408); border-color: var(--nx-gold); font-weight: 600;
    }
    .inv-action-btn.danger {
      color: #c8625e; border-color: rgba(168, 62, 62, 0.3);
    }
    .inv-action-btn.danger:hover {
      border-color: #a83e3e; background: rgba(168, 62, 62, 0.06);
    }

    .inv-section-h {
      font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600;
      letter-spacing: 2px; text-transform: uppercase; color: var(--nx-gold);
      margin: 24px 0 10px; padding-bottom: 8px;
      border-bottom: 1px solid var(--nx-gold-line);
    }

    .inv-tl {
      display: flex; flex-direction: column; gap: 0;
      position: relative; padding-left: 14px;
    }
    .inv-tl::before {
      content: ''; position: absolute; top: 8px; bottom: 8px; left: 4px;
      width: 1px; background: var(--nx-gold-line-2, rgba(200, 164, 78, 0.25));
    }
    .inv-tl-item { position: relative; padding: 8px 0 12px; }
    .inv-tl-item::before {
      content: ''; position: absolute; left: -14px; top: 13px;
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--nx-bg);
      border: 2px solid var(--nx-gold-line-2, rgba(200, 164, 78, 0.4));
    }
    .inv-tl-item.is-recent::before { border-color: var(--nx-gold); }
    .inv-tl-when {
      font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
      letter-spacing: 1px; color: var(--nx-faint);
      text-transform: uppercase; margin-bottom: 2px;
    }
    .inv-tl-what { font-size: 13px; color: var(--nx-text); line-height: 1.4; }
    .inv-tl-who { font-size: 11px; color: var(--nx-muted); margin-top: 2px; }

    .inv-gallery {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 6px; margin: 8px 0;
    }
    .inv-gallery-thumb {
      aspect-ratio: 1; object-fit: cover; border-radius: 8px;
      cursor: pointer; border: 1px solid var(--nx-gold-line);
    }
    .inv-gallery-add {
      aspect-ratio: 1; border-radius: 8px;
      border: 1px dashed var(--nx-gold-line-2, rgba(200, 164, 78, 0.4));
      background: transparent; color: var(--nx-gold); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .inv-gallery-add svg { width: 24px; height: 24px; }

    .inv-par-block {
      padding: 18px; background: var(--nx-surface-1);
      border: 1px solid var(--nx-gold-line); border-radius: 12px; margin: 18px 0;
    }
    .inv-par-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
    .inv-par-count {
      font-family: 'JetBrains Mono', monospace; font-size: 36px; font-weight: 700;
      color: var(--nx-text); line-height: 1;
    }
    .inv-par-count.below { color: #c8625e; }
    .inv-par-count.warn { color: var(--nx-gold); }
    .inv-par-of {
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
      color: var(--nx-faint); letter-spacing: 1px; text-transform: uppercase;
    }
    .inv-par-bar {
      height: 6px; background: var(--nx-gold-line); border-radius: 3px;
      overflow: hidden; position: relative;
    }
    .inv-par-bar-fill {
      height: 100%; background: var(--nx-gold); border-radius: 3px;
      transition: width .3s ease-out;
    }
    .inv-par-bar-fill.below { background: #a83e3e; }
    .inv-par-status {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: 0.8px; color: var(--nx-faint); margin-top: 8px;
      text-transform: uppercase;
    }
    .inv-par-status.warn { color: var(--nx-gold); font-weight: 600; }
    .inv-par-status.below { color: #c8625e; font-weight: 600; }

    .inv-modal-overlay {
      position: fixed; inset: 0; background: rgba(8, 6, 4, 0.7);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      z-index: 2000; display: flex; align-items: flex-end;
      justify-content: center; animation: invFadeIn .2s ease-out;
    }
    [data-theme="light"] .inv-modal-overlay { background: rgba(70, 50, 18, 0.4); }
    @keyframes invFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @media (min-width: 600px) { .inv-modal-overlay { align-items: center; } }
    .inv-modal {
      background: var(--nx-surface-1); border-top: 1px solid var(--nx-gold);
      border-radius: 18px 18px 0 0; max-width: 560px; width: 100%;
      max-height: 90vh; overflow-y: auto; padding: 22px 18px 18px;
      animation: invSlideUp .25s ease-out; position: relative;
    }
    @media (min-width: 600px) {
      .inv-modal { border: 1px solid var(--nx-gold); border-radius: 18px; }
    }
    .inv-modal-title {
      font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 500;
      color: var(--nx-text); margin: 0 0 4px;
    }
    .inv-modal-sub {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      letter-spacing: 1.5px; color: var(--nx-faint);
      text-transform: uppercase; margin-bottom: 18px;
    }
    .inv-modal-close {
      position: absolute; top: 14px; right: 14px;
      width: 32px; height: 32px; background: transparent;
      border: none; color: var(--nx-faint); cursor: pointer;
      border-radius: 50%;
    }
    .inv-modal-close svg { width: 18px; height: 18px; }

    .inv-field { margin-bottom: 14px; }
    .inv-field-label {
      display: block; font-family: 'JetBrains Mono', monospace;
      font-size: 9.5px; font-weight: 600; letter-spacing: 1.2px;
      color: var(--nx-faint); text-transform: uppercase; margin-bottom: 6px;
    }
    .inv-field-input, .inv-field-select, .inv-field-textarea {
      width: 100%; padding: 11px 14px; background: var(--nx-bg);
      border: 1px solid var(--nx-gold-line); border-radius: 10px;
      color: var(--nx-text); font-family: 'DM Sans', sans-serif; font-size: 14px;
    }
    .inv-field-input:focus, .inv-field-select:focus, .inv-field-textarea:focus {
      outline: none; border-color: var(--nx-gold);
    }
    .inv-field-textarea { resize: vertical; min-height: 64px; }
    .inv-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .inv-modal-foot {
      display: flex; gap: 10px; margin-top: 18px; padding-top: 14px;
      border-top: 1px solid var(--nx-gold-line);
    }
    .inv-modal-foot .inv-action-btn { flex: 1; }

    .inv-audit-card { max-width: 480px; margin: 0 auto; padding: 32px 24px; text-align: center; }
    .inv-audit-progress {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: 1.5px; color: var(--nx-faint);
      text-transform: uppercase; margin-bottom: 20px;
    }
    .inv-audit-cat {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      letter-spacing: 2px; color: var(--nx-gold); text-transform: uppercase; margin-bottom: 6px;
    }
    .inv-audit-name {
      font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 400;
      letter-spacing: -0.4px; color: var(--nx-text); margin-bottom: 4px;
    }
    .inv-audit-pn {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: 1px; color: var(--nx-faint); margin-bottom: 6px;
    }
    .inv-audit-bin { font-size: 13px; color: var(--nx-muted); margin-bottom: 26px; }
    .inv-audit-current {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: var(--nx-faint); letter-spacing: 1px; margin-bottom: 12px;
      text-transform: uppercase;
    }
    .inv-audit-input {
      display: block; width: 200px; margin: 0 auto 24px;
      padding: 18px 14px; background: var(--nx-bg);
      border: 2px solid var(--nx-gold-line-2, rgba(200, 164, 78, 0.4));
      border-radius: 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 36px; font-weight: 700; text-align: center;
      color: var(--nx-text);
    }
    .inv-audit-input:focus { outline: none; border-color: var(--nx-gold); }
    .inv-audit-nav { display: flex; gap: 8px; max-width: 320px; margin: 0 auto; }
    .inv-audit-nav .inv-action-btn { flex: 1; }
    .inv-audit-skip {
      margin-top: 18px; background: transparent; border: none;
      color: var(--nx-faint); font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
      cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
    }
    .inv-audit-summary-stat {
      display: flex; justify-content: space-between; padding: 10px 0;
      border-bottom: 1px solid var(--nx-gold-line); font-size: 13px;
    }
    .inv-audit-summary-stat strong {
      font-family: 'JetBrains Mono', monospace; color: var(--nx-gold);
    }

    @media (max-width: 380px) {
      .inv-wrap { padding: 14px 12px 0; }
      .inv-alerts { gap: 6px; }
      .inv-alert { padding: 10px 6px; }
      .inv-alert-num { font-size: 22px; }
      .inv-detail-title { font-size: 22px; }
      .inv-specs { padding: 14px; gap: 10px 14px; }
      .inv-actions { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .inv-detail, .inv-modal, .inv-modal-overlay { animation: none; }
      .inv-par-bar-fill { transition: none; }
    }
  `;

  function injectStyles() {
    if (document.getElementById('nxInvStyles')) {
      document.getElementById('nxInvStyles').remove();
    }
    const style = document.createElement('style');
    style.id = 'nxInvStyles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════════
     4. SCAN DISPATCH — URL params
     ════════════════════════════════════════════════════════════════ */
  function handleScanRedirect() {
    const params = new URLSearchParams(window.location.search);
    const assetQr = params.get('inv-asset');
    const stockQr = params.get('inv-stock');
    if (!assetQr && !stockQr) return false;

    if (typeof NX.switchTo === 'function') NX.switchTo('inventory');

    setTimeout(async () => {
      if (assetQr) {
        const asset = await fetchAssetByQr(assetQr);
        if (asset) openAssetDetail(asset);
        else NX.toast?.('Asset not found: ' + assetQr, 'error');
      } else if (stockQr) {
        const stock = await fetchStockByQr(stockQr);
        if (stock) openStockDetail(stock);
        else NX.toast?.('Stock item not found: ' + stockQr, 'error');
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('inv-asset');
      url.searchParams.delete('inv-stock');
      window.history.replaceState({}, '', url.toString());
    }, 400);
    return true;
  }

  /* ════════════════════════════════════════════════════════════════
     5. DATA LOADING
     ════════════════════════════════════════════════════════════════ */
  async function loadAll() {
    if (!NX.sb) return;
    try {
      const [aRes, sRes, schRes] = await Promise.all([
        NX.sb.from('inventory_assets').select('*')
          .is('archived_at', null).order('created_at', { ascending: false }),
        NX.sb.from('inventory_stock_with_status').select('*')
          .order('name', { ascending: true }),
        NX.sb.from('inventory_audit_schedules').select('*')
          .eq('active', true).order('next_due_date', { ascending: true }),
      ]);
      state.assets    = aRes.data || [];
      state.stock     = sRes.data || [];
      state.schedules = schRes.data || [];
    } catch (e) {
      console.warn('[inventory] loadAll', e);
    }
  }

  async function loadUsers() {
    if (state.users.length) return state.users;
    try {
      const { data, error } = await NX.sb.rpc('list_user_names');
      if (!error && Array.isArray(data)) {
        state.users = data;
        return data;
      }
      const fb = await NX.sb.from('nexus_users').select('id, name, role').order('name');
      if (!fb.error) state.users = fb.data || [];
    } catch (_) { state.users = []; }
    return state.users;
  }

  async function fetchAssetByQr(qr) {
    if (!NX.sb || !qr) return null;
    const { data } = await NX.sb.from('inventory_assets').select('*')
      .eq('qr_code', qr).maybeSingle();
    return data;
  }
  async function fetchStockByQr(qr) {
    if (!NX.sb || !qr) return null;
    const { data } = await NX.sb.from('inventory_stock_with_status').select('*')
      .eq('qr_code', qr).maybeSingle();
    return data;
  }
  async function fetchAssetEvents(assetId) {
    if (!NX.sb || !assetId) return [];
    const { data } = await NX.sb.from('inventory_asset_events').select('*')
      .eq('asset_id', assetId).order('created_at', { ascending: false }).limit(50);
    return data || [];
  }
  async function fetchStockEvents(stockId) {
    if (!NX.sb || !stockId) return [];
    const { data } = await NX.sb.from('inventory_stock_events').select('*')
      .eq('stock_id', stockId).order('created_at', { ascending: false }).limit(50);
    return data || [];
  }
  async function fetchEquipmentUsingStock(stockId) {
    if (!NX.sb || !stockId) return [];
    const { data } = await NX.sb.from('equipment_parts')
      .select('id, equipment_id, part_name, pm_required, equipment:equipment_id(id, name, location)')
      .eq('stock_id', stockId);
    return data || [];
  }

  /* ════════════════════════════════════════════════════════════════
     6. DASHBOARD
     ════════════════════════════════════════════════════════════════ */
  function dashboardHTML() {
    const belowPar = state.stock.filter(s => s.is_below_par).length;
    const missing = state.assets.filter(a => a.status === 'missing').length;
    const auditDue = state.schedules.filter(sch => {
      if (!sch.next_due_date) return false;
      const due = new Date(sch.next_due_date);
      const days = Math.floor((due - Date.now()) / 86400000);
      return days <= 14;
    }).length;
    const hasData = state.assets.length || state.stock.length;

    return `
      <div class="inv-hero">
        <h1 class="inv-hero-title">Inventory</h1>
        <div class="inv-hero-sub">${state.assets.length} ASSETS · ${state.stock.length} STOCK ITEMS</div>
      </div>
      <div class="inv-alerts">
        <button class="inv-alert ${belowPar > 0 ? 'is-active alert-danger' : ''}" data-jump="below-par">
          <span class="inv-alert-num">${belowPar}</span>
          <span class="inv-alert-label">Below PAR</span>
        </button>
        <button class="inv-alert ${missing > 0 ? 'is-active alert-danger' : ''}" data-jump="missing">
          <span class="inv-alert-num">${missing}</span>
          <span class="inv-alert-label">Missing</span>
        </button>
        <button class="inv-alert ${auditDue > 0 ? 'is-active' : ''}" data-jump="audits">
          <span class="inv-alert-num">${auditDue}</span>
          <span class="inv-alert-label">Audits Due</span>
        </button>
      </div>
      <button class="inv-scan-btn" id="invScanBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/></svg>
        Scan QR
      </button>
      ${!hasData ? renderEmptyDashboard() : renderDashboardActivity()}
    `;
  }

  function renderEmptyDashboard() {
    return `
      <div class="inv-empty">
        <div class="inv-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/></svg>
        </div>
        <h3 class="inv-empty-title">Start with one item</h3>
        <p class="inv-empty-msg">
          Add an asset (Vitamix, scale, knife) or a stock part (gasket, filter).
          Each gets its own QR sticker. The system grows from there.
        </p>
        <button class="inv-empty-cta" id="invEmptyAdd">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add your first item
        </button>
      </div>
    `;
  }

  function renderDashboardActivity() {
    const below = state.stock.filter(s => s.is_below_par).slice(0, 3);
    const missing = state.assets.filter(a => a.status === 'missing').slice(0, 3);
    let html = '';
    if (below.length) {
      html += `<h3 class="inv-section-h">Below PAR</h3><div class="inv-list">`;
      html += below.map(s => stockRowHTML(s)).join('');
      html += '</div>';
    }
    if (missing.length) {
      html += `<h3 class="inv-section-h">Missing assets</h3><div class="inv-list">`;
      html += missing.map(a => assetRowHTML(a)).join('');
      html += '</div>';
    }
    if (!below.length && !missing.length) {
      html += `<div class="inv-empty">
        <div class="inv-empty-title" style="font-size:15px">All clear</div>
        <div class="inv-empty-msg">No items below PAR, no missing assets. Quarterly audits on schedule.</div>
      </div>`;
    }
    return html;
  }

  /* ════════════════════════════════════════════════════════════════
     7. ASSETS — list + detail + actions
     ════════════════════════════════════════════════════════════════ */
  function filteredAssets() {
    const f = state.filters;
    let list = state.assets.slice();
    if (f.assetSearch) {
      const q = f.assetSearch.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.manufacturer || '').toLowerCase().includes(q) ||
        (a.model || '').toLowerCase().includes(q) ||
        (a.serial_number || '').toLowerCase().includes(q) ||
        (a.internal_pn || '').toLowerCase().includes(q)
      );
    }
    if (f.assetLocation !== 'all') list = list.filter(a => a.home_location === f.assetLocation);
    if (f.assetCategory !== 'all') list = list.filter(a => a.category === f.assetCategory);
    if (f.assetStatus !== 'all')   list = list.filter(a => a.status === f.assetStatus);
    return list;
  }

  function assetRowHTML(a) {
    const iconBlock = a.primary_photo_url
      ? `<img class="inv-row-img" src="${esc(a.primary_photo_url)}" alt="">`
      : `<div class="inv-row-icon">${catIcon(a.category)}</div>`;
    return `
      <div class="inv-row" data-asset-id="${a.id}">
        ${iconBlock}
        <div class="inv-row-body">
          <div class="inv-row-title">${esc(a.name)}</div>
          <div class="inv-row-sub">${esc(a.internal_pn)} · ${esc(a.home_location)}${a.custodian_user_id ? ' · loaned' : ''}</div>
        </div>
        <div class="inv-row-right">${statusPill(a.status)}</div>
      </div>
    `;
  }

  function assetsViewHTML() {
    const list = filteredAssets();
    return `
      <div class="inv-listhead">
        <input type="text" class="inv-search" id="invAssetSearch" placeholder="Search assets…" value="${esc(state.filters.assetSearch)}">
        <div class="inv-filter-row">
          <button class="inv-chip ${state.filters.assetLocation === 'all' ? 'active' : ''}" data-filter="assetLocation" data-val="all">All sites</button>
          ${LOCATIONS.map(loc => `<button class="inv-chip ${state.filters.assetLocation === loc ? 'active' : ''}" data-filter="assetLocation" data-val="${esc(loc)}">${esc(loc)}</button>`).join('')}
        </div>
        <div class="inv-filter-row">
          <button class="inv-chip ${state.filters.assetCategory === 'all' ? 'active' : ''}" data-filter="assetCategory" data-val="all">All cats</button>
          ${ASSET_CATEGORIES.map(c => `<button class="inv-chip ${state.filters.assetCategory === c.key ? 'active' : ''}" data-filter="assetCategory" data-val="${esc(c.key)}">${esc(c.label)}</button>`).join('')}
        </div>
      </div>
      ${list.length ? `<div class="inv-list">${list.map(assetRowHTML).join('')}</div>` :
        renderEmptyList('asset', state.filters.assetSearch || state.filters.assetLocation !== 'all' || state.filters.assetCategory !== 'all')}
    `;
  }

  function renderEmptyList(type, hasFilters) {
    if (hasFilters) {
      return `<div class="inv-empty">
        <div class="inv-empty-title" style="font-size:15px">Nothing matches</div>
        <div class="inv-empty-msg">Try clearing some filters.</div>
      </div>`;
    }
    return `<div class="inv-empty">
      <div class="inv-empty-title" style="font-size:15px">No ${type === 'asset' ? 'assets' : 'stock items'} yet</div>
      <div class="inv-empty-msg">Tap the + button to add your first one.</div>
    </div>`;
  }

  async function openAssetDetail(asset) {
    if (!asset) return;
    const events = await fetchAssetEvents(asset.id);
    await loadUsers();
    const overlay = document.createElement('div');
    overlay.className = 'inv-detail';
    overlay.innerHTML = renderAssetDetail(asset, events);
    document.body.appendChild(overlay);
    wireAssetDetail(overlay, asset);
  }

  function renderAssetDetail(a, events) {
    const cat = ASSET_CATEGORIES.find(c => c.key === a.category) || { label: 'Other' };
    const photos = Array.isArray(a.photos) ? a.photos : [];
    const allPhotos = a.primary_photo_url
      ? [{ url: a.primary_photo_url, type: 'identity' }, ...photos]
      : photos;
    const custName = a.custodian_user_id
      ? (state.users.find(u => u.id === a.custodian_user_id)?.name || 'Unknown')
      : null;
    const locDisplay = a.status === 'loaned' || a.status === 'relocated'
      ? (a.current_location || a.home_location)
      : a.home_location;

    return `
      <div class="inv-detail-head">
        <button class="inv-detail-back" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div><div class="inv-detail-pn">${esc(a.internal_pn)}</div></div>
        <div class="inv-detail-actions">
          <button class="inv-detail-action" data-act="qr" aria-label="QR">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/></svg>
          </button>
          <button class="inv-detail-action" data-act="edit" aria-label="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
      </div>
      <div class="inv-detail-body">
        ${a.primary_photo_url
          ? `<img class="inv-detail-photo" src="${esc(a.primary_photo_url)}" alt="">`
          : `<div class="inv-detail-photo-empty">NO PHOTO YET</div>`}
        <div class="inv-detail-titleblock">
          <div class="inv-detail-cat">${esc(cat.label)}</div>
          <h1 class="inv-detail-title">${esc(a.name)}</h1>
          <div class="inv-detail-sub">${esc(a.manufacturer || '')}${a.model ? ' · ' + esc(a.model) : ''}</div>
        </div>
        <div class="inv-actions">
          ${a.status === 'on_shelf' || a.status === 'in_use' ? `<button class="inv-action-btn primary" data-act="check-out">Check Out</button>` : ''}
          ${a.status === 'loaned' || a.status === 'relocated' ? `<button class="inv-action-btn primary" data-act="check-in">Check In</button>` : ''}
          ${a.status !== 'missing' ? `<button class="inv-action-btn danger" data-act="mark-missing">Mark Missing</button>` : ''}
          ${a.status === 'missing' ? `<button class="inv-action-btn primary" data-act="mark-found">Mark Found</button>` : ''}
          ${a.status !== 'broken' && a.status !== 'retired' ? `<button class="inv-action-btn" data-act="mark-broken">Mark Broken</button>` : ''}
        </div>
        <div class="inv-specs">
          <div><div class="inv-spec-label">Status</div><div class="inv-spec-value">${statusPill(a.status)}</div></div>
          <div><div class="inv-spec-label">Location</div><div class="inv-spec-value">${esc(locDisplay)}</div></div>
          ${a.serial_number ? `<div><div class="inv-spec-label">Serial #</div><div class="inv-spec-value">${esc(a.serial_number)}</div></div>` : ''}
          ${custName ? `<div><div class="inv-spec-label">Custodian</div><div class="inv-spec-value">${esc(custName)}</div></div>` : ''}
          ${a.return_by_date ? `<div><div class="inv-spec-label">Return by</div><div class="inv-spec-value">${esc(fmtDate(a.return_by_date))}</div></div>` : ''}
          ${a.purchase_date ? `<div><div class="inv-spec-label">Purchased</div><div class="inv-spec-value">${esc(fmtDate(a.purchase_date))}</div></div>` : ''}
          ${a.purchase_cost ? `<div><div class="inv-spec-label">Cost</div><div class="inv-spec-value">${esc(fmtCost(a.purchase_cost))}</div></div>` : ''}
          ${a.warranty_until ? `<div><div class="inv-spec-label">Warranty until</div><div class="inv-spec-value ${new Date(a.warranty_until) > new Date() ? '' : 'dim'}">${esc(fmtDate(a.warranty_until))}</div></div>` : ''}
        </div>
        ${a.notes ? `<h3 class="inv-section-h">Notes</h3>
          <div style="padding: 12px 14px; background: var(--nx-surface-1); border: 1px solid var(--nx-gold-line); border-radius: 10px; font-size: 13.5px; color: var(--nx-text); line-height: 1.55;">${esc(a.notes)}</div>` : ''}
        ${allPhotos.length > 0 ? `
          <h3 class="inv-section-h">Photos (${allPhotos.length})</h3>
          <div class="inv-gallery">
            ${allPhotos.map(p => `<img class="inv-gallery-thumb" src="${esc(p.url)}" alt="">`).join('')}
            <button class="inv-gallery-add" data-act="add-photo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        ` : `<button class="inv-action-btn" data-act="add-photo" style="margin-top:18px">+ Add photo</button>`}
        <h3 class="inv-section-h">History</h3>
        ${events.length ? `<div class="inv-tl">${events.slice(0, 20).map((e, i) => renderTimelineItem(e, i === 0)).join('')}</div>` : `<div style="color: var(--nx-faint); font-size: 12px; padding: 12px 0;">No events yet.</div>`}
      </div>
    `;
  }

  function renderTimelineItem(e, isRecent) {
    const eventLabels = {
      created: 'Created', check_out: 'Checked out', check_in: 'Returned',
      relocate: 'Relocated', status_change: 'Status changed', note: 'Note',
      damage: 'Damage reported', calibration: 'Calibrated', photo_added: 'Photo added',
    };
    const label = eventLabels[e.event_type] || e.event_type;
    let detail = '';
    const p = e.payload || {};
    if (e.event_type === 'check_out') {
      detail = `to ${esc(p.custodian_name || 'someone')}${p.return_by_date ? `, return by ${esc(fmtDate(p.return_by_date))}` : ''}`;
    } else if (e.event_type === 'check_in') {
      detail = p.from_location ? `from ${esc(p.from_location)}` : '';
    } else if (e.event_type === 'status_change') {
      detail = p.from_status && p.to_status ? `${esc(p.from_status)} → ${esc(p.to_status)}` : '';
    } else if (e.event_type === 'relocate') {
      detail = `${esc(p.from_location || '?')} → ${esc(p.to_location || '?')}`;
    } else if (e.notes) {
      detail = esc(e.notes);
    }
    return `
      <div class="inv-tl-item ${isRecent ? 'is-recent' : ''}">
        <div class="inv-tl-when">${esc(fmtDateTime(e.created_at))}</div>
        <div class="inv-tl-what"><strong>${esc(label)}</strong>${detail ? ' · ' + detail : ''}</div>
        ${e.by_user_name ? `<div class="inv-tl-who">by ${esc(e.by_user_name)}</div>` : ''}
      </div>
    `;
  }

  function wireAssetDetail(overlay, asset) {
    const close = () => { overlay.remove(); refreshActiveTab(); };
    overlay.querySelector('.inv-detail-back')?.addEventListener('click', close);
    overlay.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        try {
          if (act === 'check-out')         { await checkOutAsset(asset, close); }
          else if (act === 'check-in')     { await checkInAsset(asset, close); }
          else if (act === 'mark-missing') { await markAssetStatus(asset, 'missing', close); }
          else if (act === 'mark-found')   { await markAssetStatus(asset, 'on_shelf', close); }
          else if (act === 'mark-broken')  { await markAssetStatus(asset, 'broken', close); }
          else if (act === 'edit')         { close(); openAssetEditModal(asset); }
          else if (act === 'qr')           { showQrPreview(asset, 'asset'); }
          else if (act === 'add-photo')    { uploadAssetPhoto(asset, close); }
        } catch (e) {
          console.warn('[inventory]', e);
          NX.toast?.('Action failed: ' + e.message, 'error');
        }
      });
    });
  }

  async function checkOutAsset(asset, onDone) {
    const users = await loadUsers();
    if (!users.length) { NX.toast?.('No users found', 'error'); return; }
    const html = `
      <h2 class="inv-modal-title">Check out</h2>
      <div class="inv-modal-sub">${esc(asset.name)} · ${esc(asset.internal_pn)}</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="inv-field">
        <label class="inv-field-label">Custodian</label>
        <select class="inv-field-select" id="invCheckoutUser">
          ${users.map(u => `<option value="${u.id}" ${u.id === NX.currentUser?.id ? 'selected' : ''}>${esc(u.name)}${u.role ? ` (${esc(u.role)})` : ''}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label class="inv-field-label">To location</label>
        <select class="inv-field-select" id="invCheckoutLoc">
          ${LOCATIONS.map(l => `<option value="${esc(l)}" ${l !== asset.home_location ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Return by</label>
          <input type="date" class="inv-field-input" id="invCheckoutReturn" value="${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}">
        </div>
        <div class="inv-field">
          <label class="inv-field-label">Type</label>
          <select class="inv-field-select" id="invCheckoutType">
            <option value="loaned">Loaned (returns home)</option>
            <option value="relocated">Relocated (new home)</option>
          </select>
        </div>
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Note (optional)</label>
        <input type="text" class="inv-field-input" id="invCheckoutNote" placeholder="Reason / context">
      </div>
      <div class="inv-modal-foot">
        <button class="inv-action-btn" data-close>Cancel</button>
        <button class="inv-action-btn primary" id="invCheckoutSubmit">Check out</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      overlay.querySelector('#invCheckoutSubmit').addEventListener('click', async () => {
        const userId = parseInt(overlay.querySelector('#invCheckoutUser').value);
        const toLoc = overlay.querySelector('#invCheckoutLoc').value;
        const returnBy = overlay.querySelector('#invCheckoutReturn').value;
        const type = overlay.querySelector('#invCheckoutType').value;
        const note = overlay.querySelector('#invCheckoutNote').value;
        const user = users.find(u => u.id === userId);
        const newStatus = type === 'relocated' ? 'relocated' : 'loaned';
        const updates = {
          status: newStatus, custodian_user_id: userId, current_location: toLoc,
          return_by_date: type === 'loaned' ? (returnBy || null) : null,
          updated_at: new Date().toISOString(),
        };
        if (type === 'relocated') updates.home_location = toLoc;
        const { error } = await NX.sb.from('inventory_assets').update(updates).eq('id', asset.id);
        if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
        await NX.sb.from('inventory_asset_events').insert({
          asset_id: asset.id,
          event_type: type === 'relocated' ? 'relocate' : 'check_out',
          by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
          payload: type === 'relocated'
            ? { from_location: asset.home_location, to_location: toLoc }
            : { custodian_user_id: userId, custodian_name: user?.name, to_location: toLoc, return_by_date: returnBy },
          notes: note || null,
        });
        overlay.remove();
        NX.toast?.(`${asset.name} ${type === 'relocated' ? 'relocated' : 'checked out'}`, 'success');
        onDone?.();
      });
    });
  }

  async function checkInAsset(asset, onDone) {
    const updates = {
      status: 'on_shelf', custodian_user_id: null,
      current_location: null, return_by_date: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await NX.sb.from('inventory_assets').update(updates).eq('id', asset.id);
    if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
    await NX.sb.from('inventory_asset_events').insert({
      asset_id: asset.id, event_type: 'check_in',
      by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
      payload: { from_location: asset.current_location || asset.home_location },
    });
    NX.toast?.(`${asset.name} checked in`, 'success');
    onDone?.();
  }

  async function markAssetStatus(asset, newStatus, onDone) {
    const updates = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'on_shelf') {
      updates.custodian_user_id = null;
      updates.current_location = null;
      updates.return_by_date = null;
    }
    const { error } = await NX.sb.from('inventory_assets').update(updates).eq('id', asset.id);
    if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
    await NX.sb.from('inventory_asset_events').insert({
      asset_id: asset.id, event_type: 'status_change',
      by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
      payload: { from_status: asset.status, to_status: newStatus },
    });
    NX.toast?.(`${asset.name} → ${newStatus}`, 'success');
    onDone?.();
  }

  /* ════════════════════════════════════════════════════════════════
     8. STOCK — list + detail + actions
     ════════════════════════════════════════════════════════════════ */
  function filteredStock() {
    const f = state.filters;
    let list = state.stock.slice();
    if (f.stockSearch) {
      const q = f.stockSearch.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.manufacturer || '').toLowerCase().includes(q) ||
        (s.manufacturer_pn || '').toLowerCase().includes(q) ||
        (s.internal_pn || '').toLowerCase().includes(q)
      );
    }
    if (f.stockLocation !== 'all') list = list.filter(s => s.location === f.stockLocation);
    if (f.stockCategory !== 'all') list = list.filter(s => s.category === f.stockCategory);
    if (f.stockBelowPar) list = list.filter(s => s.is_below_par);
    return list;
  }

  function stockRowHTML(s) {
    const metaCls = s.is_below_threshold ? 'below-par' : (s.is_below_par ? 'below-par-warn' : '');
    return `
      <div class="inv-row" data-stock-id="${s.id}">
        <div class="inv-row-icon">${catIcon(s.category)}</div>
        <div class="inv-row-body">
          <div class="inv-row-title">${esc(s.name)}</div>
          <div class="inv-row-sub">${esc(s.manufacturer_pn || s.internal_pn)} · ${esc(s.location)}${s.bin_hint ? ' · ' + esc(s.bin_hint) : ''}</div>
        </div>
        <div class="inv-row-right">
          <div class="inv-row-meta ${metaCls}">${s.count_on_hand} / ${s.par_level}</div>
        </div>
      </div>
    `;
  }

  function stockViewHTML() {
    const list = filteredStock();
    return `
      <div class="inv-listhead">
        <input type="text" class="inv-search" id="invStockSearch" placeholder="Search parts…" value="${esc(state.filters.stockSearch)}">
        <div class="inv-filter-row">
          <button class="inv-chip ${state.filters.stockLocation === 'all' ? 'active' : ''}" data-filter="stockLocation" data-val="all">All sites</button>
          ${LOCATIONS.map(loc => `<button class="inv-chip ${state.filters.stockLocation === loc ? 'active' : ''}" data-filter="stockLocation" data-val="${esc(loc)}">${esc(loc)}</button>`).join('')}
          <button class="inv-chip ${state.filters.stockBelowPar ? 'active' : ''}" data-filter="stockBelowPar" data-val="toggle">Below PAR</button>
        </div>
        <div class="inv-filter-row">
          <button class="inv-chip ${state.filters.stockCategory === 'all' ? 'active' : ''}" data-filter="stockCategory" data-val="all">All cats</button>
          ${STOCK_CATEGORIES.map(c => `<button class="inv-chip ${state.filters.stockCategory === c.key ? 'active' : ''}" data-filter="stockCategory" data-val="${esc(c.key)}">${esc(c.label)}</button>`).join('')}
        </div>
      </div>
      ${list.length ? `<div class="inv-list">${list.map(stockRowHTML).join('')}</div>` :
        renderEmptyList('stock', state.filters.stockSearch || state.filters.stockLocation !== 'all' || state.filters.stockCategory !== 'all' || state.filters.stockBelowPar)}
    `;
  }

  async function openStockDetail(stock) {
    if (!stock) return;
    const [events, equipment] = await Promise.all([
      fetchStockEvents(stock.id),
      fetchEquipmentUsingStock(stock.id),
    ]);
    const overlay = document.createElement('div');
    overlay.className = 'inv-detail';
    overlay.innerHTML = renderStockDetail(stock, events, equipment);
    document.body.appendChild(overlay);
    wireStockDetail(overlay, stock);
  }

  function renderStockDetail(s, events, equipment) {
    const cat = STOCK_CATEGORIES.find(c => c.key === s.category) || { label: 'Other' };
    const pct = Math.min(100, (s.count_on_hand / Math.max(1, s.par_level)) * 100);
    const fillCls = s.is_below_threshold ? 'below' : '';
    const countCls = s.is_below_threshold ? 'below' : (s.is_below_par ? 'warn' : '');
    const statusCls = s.is_below_threshold ? 'below' : (s.is_below_par ? 'warn' : '');
    const statusText = s.is_below_threshold ? 'REORDER NEEDED'
                       : s.is_below_par ? 'BELOW PAR'
                       : 'IN STOCK';
    const lastCount = s.last_counted_at
      ? `Last counted ${esc(fmtRelative(s.last_counted_at))}`
      : 'Never counted';

    return `
      <div class="inv-detail-head">
        <button class="inv-detail-back" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div><div class="inv-detail-pn">${esc(s.internal_pn)}</div></div>
        <div class="inv-detail-actions">
          <button class="inv-detail-action" data-act="qr" aria-label="QR">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/></svg>
          </button>
          <button class="inv-detail-action" data-act="edit" aria-label="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
      </div>
      <div class="inv-detail-body">
        <div class="inv-detail-titleblock">
          <div class="inv-detail-cat">${esc(cat.label)}</div>
          <h1 class="inv-detail-title">${esc(s.name)}</h1>
          <div class="inv-detail-sub">${esc(s.manufacturer || '—')}${s.manufacturer_pn ? ' · ' + esc(s.manufacturer_pn) : ''}</div>
        </div>
        <div class="inv-par-block">
          <div class="inv-par-row">
            <div class="inv-par-count ${countCls}">${s.count_on_hand}</div>
            <div class="inv-par-of">of PAR ${s.par_level}</div>
          </div>
          <div class="inv-par-bar">
            <div class="inv-par-bar-fill ${fillCls}" style="width:${pct}%"></div>
          </div>
          <div class="inv-par-status ${statusCls}">${statusText} · ${esc(lastCount)}</div>
        </div>
        <div class="inv-actions">
          <button class="inv-action-btn primary" data-act="quick-count">Quick Count</button>
          <button class="inv-action-btn" data-act="receive">Receive Shipment</button>
          <button class="inv-action-btn" data-act="adjust">Adjust</button>
        </div>
        <div class="inv-specs">
          <div><div class="inv-spec-label">Location</div><div class="inv-spec-value">${esc(s.location)}</div></div>
          <div><div class="inv-spec-label">Bin</div><div class="inv-spec-value ${s.bin_hint ? '' : 'dim'}">${esc(s.bin_hint || '—')}</div></div>
          <div><div class="inv-spec-label">PAR / Reorder</div><div class="inv-spec-value">${s.par_level} / ${s.reorder_threshold}</div></div>
          ${s.unit_cost ? `<div><div class="inv-spec-label">Unit cost</div><div class="inv-spec-value">${esc(fmtCost(s.unit_cost))}</div></div>` : ''}
          ${s.primary_supplier ? `<div><div class="inv-spec-label">Supplier</div><div class="inv-spec-value">${esc(s.primary_supplier)}</div></div>` : ''}
          ${s.last_ordered_at ? `<div><div class="inv-spec-label">Last ordered</div><div class="inv-spec-value">${esc(fmtRelative(s.last_ordered_at))}</div></div>` : ''}
        </div>
        ${equipment.length ? `
          <h3 class="inv-section-h">Used by</h3>
          <div class="inv-list">
            ${equipment.map(ep => {
              const eq = ep.equipment;
              if (!eq) return '';
              return `<div class="inv-row" data-equip-id="${eq.id}">
                <div class="inv-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg></div>
                <div class="inv-row-body">
                  <div class="inv-row-title">${esc(eq.name)}</div>
                  <div class="inv-row-sub">${esc(eq.location || '')}${ep.pm_required ? ' · PM PART' : ''}</div>
                </div>
                <div class="inv-row-right"><div class="inv-row-meta">→</div></div>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
        ${s.notes ? `<h3 class="inv-section-h">Notes</h3>
          <div style="padding: 12px 14px; background: var(--nx-surface-1); border: 1px solid var(--nx-gold-line); border-radius: 10px; font-size: 13.5px; line-height: 1.55;">${esc(s.notes)}</div>` : ''}
        <h3 class="inv-section-h">History</h3>
        ${events.length ? `<div class="inv-tl">${events.slice(0, 20).map((e, i) => renderStockTimelineItem(e, i === 0)).join('')}</div>` : `<div style="color: var(--nx-faint); font-size: 12px; padding: 12px 0;">No events yet.</div>`}
      </div>
    `;
  }

  function renderStockTimelineItem(e, isRecent) {
    const labels = {
      count: 'Counted', adjust: 'Adjusted', consume: 'Consumed',
      receive: 'Received', reorder_placed: 'Order placed', reorder_card: 'Reorder card created',
    };
    const sign = e.delta > 0 ? '+' : '';
    const what = `${labels[e.event_type] || e.event_type} (${sign}${e.delta}) → ${e.count_after}`;
    return `
      <div class="inv-tl-item ${isRecent ? 'is-recent' : ''}">
        <div class="inv-tl-when">${esc(fmtDateTime(e.created_at))}</div>
        <div class="inv-tl-what">${esc(what)}</div>
        ${e.by_user_name ? `<div class="inv-tl-who">by ${esc(e.by_user_name)}${e.reason ? ' · ' + esc(e.reason) : ''}</div>` : (e.reason ? `<div class="inv-tl-who">${esc(e.reason)}</div>` : '')}
      </div>
    `;
  }

  function wireStockDetail(overlay, stock) {
    const close = () => { overlay.remove(); refreshActiveTab(); };
    overlay.querySelector('.inv-detail-back')?.addEventListener('click', close);
    overlay.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        try {
          if (act === 'quick-count')   { await stockQuickCount(stock, close); }
          else if (act === 'receive')   { await stockReceive(stock, close); }
          else if (act === 'adjust')    { await stockAdjust(stock, close); }
          else if (act === 'edit')      { close(); openStockEditModal(stock); }
          else if (act === 'qr')        { showQrPreview(stock, 'stock'); }
        } catch (e) {
          console.warn('[inventory]', e);
          NX.toast?.('Action failed: ' + e.message, 'error');
        }
      });
    });
    overlay.querySelectorAll('[data-equip-id]').forEach(row => {
      row.addEventListener('click', () => {
        const equipId = row.getAttribute('data-equip-id');
        if (NX.modules?.equipment?.openDetail) {
          close();
          NX.switchTo?.('equipment');
          setTimeout(() => NX.modules.equipment.openDetail(parseInt(equipId)), 200);
        }
      });
    });
  }

  async function stockQuickCount(stock, onDone) {
    const html = `
      <h2 class="inv-modal-title">Count</h2>
      <div class="inv-modal-sub">${esc(stock.name)}</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="inv-field">
        <label class="inv-field-label">How many do you actually have?</label>
        <input type="number" class="inv-field-input" id="invCountInput" min="0" value="${stock.count_on_hand}">
      </div>
      <div style="text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--nx-faint); letter-spacing: 1px; margin-bottom: 12px;">
        Current: ${stock.count_on_hand} · PAR: ${stock.par_level}
      </div>
      <div class="inv-modal-foot">
        <button class="inv-action-btn" data-close>Cancel</button>
        <button class="inv-action-btn primary" id="invCountSubmit">Save count</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      const input = overlay.querySelector('#invCountInput');
      input.focus(); input.select();
      overlay.querySelector('#invCountSubmit').addEventListener('click', async () => {
        const newCount = parseInt(input.value);
        if (isNaN(newCount) || newCount < 0) { NX.toast?.('Enter a valid count', 'error'); return; }
        const delta = newCount - stock.count_on_hand;
        const { error } = await NX.sb.from('inventory_stock').update({
          count_on_hand: newCount, last_counted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', stock.id);
        if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
        await NX.sb.from('inventory_stock_events').insert({
          stock_id: stock.id, event_type: 'count', delta: delta, count_after: newCount,
          by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
          reason: 'manual count',
        });
        if (newCount < stock.reorder_threshold) {
          await createReorderCard({ ...stock, count_on_hand: newCount }, newCount);
        }
        overlay.remove();
        NX.toast?.(`Counted ${stock.name}: ${newCount}`, 'success');
        onDone?.();
      });
    });
  }

  async function stockReceive(stock, onDone) {
    const html = `
      <h2 class="inv-modal-title">Receive shipment</h2>
      <div class="inv-modal-sub">${esc(stock.name)}</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="inv-field">
        <label class="inv-field-label">How many received?</label>
        <input type="number" class="inv-field-input" id="invRecvInput" min="1" value="1">
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Note (optional)</label>
        <input type="text" class="inv-field-input" id="invRecvNote" placeholder="PO #, supplier, etc.">
      </div>
      <div style="text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--nx-faint); letter-spacing: 1px; margin-bottom: 12px;">
        Current: ${stock.count_on_hand} → after: <span id="invRecvAfter">${stock.count_on_hand + 1}</span>
      </div>
      <div class="inv-modal-foot">
        <button class="inv-action-btn" data-close>Cancel</button>
        <button class="inv-action-btn primary" id="invRecvSubmit">Receive</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      const input = overlay.querySelector('#invRecvInput');
      const after = overlay.querySelector('#invRecvAfter');
      input.addEventListener('input', () => {
        const n = parseInt(input.value) || 0;
        after.textContent = stock.count_on_hand + n;
      });
      input.focus(); input.select();
      overlay.querySelector('#invRecvSubmit').addEventListener('click', async () => {
        const qty = parseInt(input.value);
        if (isNaN(qty) || qty <= 0) { NX.toast?.('Enter a valid quantity', 'error'); return; }
        const newCount = stock.count_on_hand + qty;
        const note = overlay.querySelector('#invRecvNote').value;
        const { error } = await NX.sb.from('inventory_stock').update({
          count_on_hand: newCount, last_ordered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', stock.id);
        if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
        await NX.sb.from('inventory_stock_events').insert({
          stock_id: stock.id, event_type: 'receive', delta: qty, count_after: newCount,
          by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
          reason: note || null,
        });
        overlay.remove();
        NX.toast?.(`Received ${qty} × ${stock.name}`, 'success');
        onDone?.();
      });
    });
  }

  async function stockAdjust(stock, onDone) {
    const isManager = ['admin', 'manager', 'owner'].includes(NX.currentUser?.role);
    if (!isManager) { NX.toast?.('Adjustments require manager role', 'warn'); return; }
    const html = `
      <h2 class="inv-modal-title">Adjust count</h2>
      <div class="inv-modal-sub">${esc(stock.name)} · Manager only</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="inv-field">
        <label class="inv-field-label">New count</label>
        <input type="number" class="inv-field-input" id="invAdjInput" min="0" value="${stock.count_on_hand}">
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Reason (required)</label>
        <input type="text" class="inv-field-input" id="invAdjReason" placeholder="Damaged, lost, miscount...">
      </div>
      <div class="inv-modal-foot">
        <button class="inv-action-btn" data-close>Cancel</button>
        <button class="inv-action-btn primary" id="invAdjSubmit">Save adjustment</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      overlay.querySelector('#invAdjSubmit').addEventListener('click', async () => {
        const newCount = parseInt(overlay.querySelector('#invAdjInput').value);
        const reason = overlay.querySelector('#invAdjReason').value.trim();
        if (isNaN(newCount) || newCount < 0) { NX.toast?.('Enter a valid count', 'error'); return; }
        if (!reason) { NX.toast?.('Reason required for adjustments', 'error'); return; }
        const delta = newCount - stock.count_on_hand;
        const { error } = await NX.sb.from('inventory_stock').update({
          count_on_hand: newCount, updated_at: new Date().toISOString(),
        }).eq('id', stock.id);
        if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
        await NX.sb.from('inventory_stock_events').insert({
          stock_id: stock.id, event_type: 'adjust', delta: delta, count_after: newCount,
          by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name, reason: reason,
        });
        overlay.remove();
        NX.toast?.(`Adjusted ${stock.name}: ${stock.count_on_hand} → ${newCount}`, 'success');
        onDone?.();
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     9. AUDITS — list + walkthrough
     ════════════════════════════════════════════════════════════════ */
  function auditsViewHTML() {
    const today = new Date();
    const html = state.schedules.map(sch => {
      const due = sch.next_due_date ? new Date(sch.next_due_date) : null;
      const days = due ? Math.floor((due - today) / 86400000) : null;
      const cls = days != null && days <= 0 ? 'below-par' : days != null && days <= 14 ? 'below-par-warn' : '';
      const status = days == null ? 'No date' : days <= 0 ? `${-days}d overdue` : `${days}d`;
      const stockCount = state.stock.filter(s => s.location === sch.location).length;
      return `
        <div class="inv-row" data-schedule-id="${sch.id}">
          <div class="inv-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div class="inv-row-body">
            <div class="inv-row-title">${esc(sch.location)}</div>
            <div class="inv-row-sub">${stockCount} STOCK ITEMS · EVERY ${sch.frequency_days}D</div>
          </div>
          <div class="inv-row-right"><div class="inv-row-meta ${cls}">${esc(status)}</div></div>
        </div>
      `;
    }).join('');
    return `
      <h3 class="inv-section-h" style="margin-top:0">Quarterly audits</h3>
      <p style="font-size: 13px; color: var(--nx-muted); margin: 0 0 14px; line-height: 1.5;">
        Tap a location to start a walkthrough count. Each audit creates count events and updates stock totals atomically.
      </p>
      <div class="inv-list">${html}</div>
    `;
  }

  async function startAuditWalkthrough(scheduleId) {
    const schedule = state.schedules.find(s => s.id === scheduleId);
    if (!schedule) return;
    const items = state.stock.filter(s => s.location === schedule.location);
    if (!items.length) { NX.toast?.('No stock items at this location', 'info'); return; }

    const { data: audit, error } = await NX.sb.from('inventory_audits').insert({
      schedule_id: scheduleId, location: schedule.location,
      by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
      items_total: items.length, status: 'in_progress',
    }).select().single();
    if (error) { NX.toast?.('Failed to start audit: ' + error.message, 'error'); return; }

    state.currentAuditId = audit.id;
    state.auditDeltas = {};
    runAuditWalkthrough(items, 0, audit);
  }

  function runAuditWalkthrough(items, idx, audit) {
    if (idx >= items.length) {
      finishAuditWalkthrough(items, audit);
      return;
    }
    const item = items[idx];
    const cat = STOCK_CATEGORIES.find(c => c.key === item.category) || { label: 'Other' };
    const overlay = document.createElement('div');
    overlay.className = 'inv-detail';
    overlay.innerHTML = `
      <div class="inv-detail-head">
        <button class="inv-detail-back" aria-label="Cancel audit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div><div class="inv-detail-pn">AUDIT · ${esc(audit.location)}</div></div>
      </div>
      <div class="inv-audit-card">
        <div class="inv-audit-progress">${idx + 1} of ${items.length}</div>
        <div class="inv-audit-cat">${esc(cat.label)}</div>
        <div class="inv-audit-name">${esc(item.name)}</div>
        <div class="inv-audit-pn">${esc(item.manufacturer_pn || item.internal_pn)}</div>
        <div class="inv-audit-bin">${esc(item.bin_hint || 'No bin set')}</div>
        <div class="inv-audit-current">CURRENTLY: ${item.count_on_hand} · PAR: ${item.par_level}</div>
        <input type="number" class="inv-audit-input" id="invAuditInput" min="0" value="${item.count_on_hand}">
        <div class="inv-audit-nav">
          <button class="inv-action-btn" id="invAuditSkip">Skip</button>
          <button class="inv-action-btn primary" id="invAuditNext">${idx + 1 === items.length ? 'Finish' : 'Next →'}</button>
        </div>
        <button class="inv-audit-skip" id="invAuditCancel">Pause audit</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#invAuditInput');
    setTimeout(() => { input.focus(); input.select(); }, 100);

    const advance = () => {
      const v = parseInt(input.value);
      if (!isNaN(v) && v >= 0) state.auditDeltas[item.id] = v;
      overlay.remove();
      runAuditWalkthrough(items, idx + 1, audit);
    };
    const skip = () => {
      overlay.remove();
      runAuditWalkthrough(items, idx + 1, audit);
    };
    const cancel = () => {
      overlay.remove();
      NX.sb.from('inventory_audits').update({
        status: 'cancelled', completed_at: new Date().toISOString(),
      }).eq('id', audit.id).then(() => {});
      state.currentAuditId = null;
      state.auditDeltas = {};
      NX.toast?.('Audit paused', 'info');
      refreshActiveTab();
    };
    overlay.querySelector('#invAuditNext').addEventListener('click', advance);
    overlay.querySelector('#invAuditSkip').addEventListener('click', skip);
    overlay.querySelector('#invAuditCancel').addEventListener('click', cancel);
    overlay.querySelector('.inv-detail-back').addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') advance(); });
  }

  async function finishAuditWalkthrough(items, audit) {
    const variances = Object.entries(state.auditDeltas)
      .map(([id, newCount]) => {
        const item = items.find(i => i.id == id);
        if (!item) return null;
        const delta = newCount - item.count_on_hand;
        return { item, delta, newCount };
      })
      .filter(v => v && v.delta !== 0);

    const counted = Object.keys(state.auditDeltas).length;
    const totalCost = variances.reduce((sum, v) => sum + Math.abs(v.delta) * (parseFloat(v.item.unit_cost) || 0), 0);

    const html = `
      <h2 class="inv-modal-title">Audit complete</h2>
      <div class="inv-modal-sub">${esc(audit.location)}</div>
      <div style="margin: 18px 0;">
        <div class="inv-audit-summary-stat"><span>Items counted</span><strong>${counted} / ${items.length}</strong></div>
        <div class="inv-audit-summary-stat"><span>Items with variance</span><strong>${variances.length}</strong></div>
        <div class="inv-audit-summary-stat"><span>Variance value</span><strong>${esc(fmtCost(totalCost) || '$0.00')}</strong></div>
      </div>
      ${variances.length ? `
        <div class="inv-section-h" style="margin-top: 18px">Variances</div>
        <div style="max-height: 240px; overflow-y: auto; font-size: 12.5px;">
          ${variances.map(v => `
            <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom: 1px solid var(--nx-gold-line);">
              <span>${esc(v.item.name)}</span>
              <strong style="color: ${v.delta < 0 ? '#c8625e' : 'var(--nx-gold)'}; font-family: 'JetBrains Mono', monospace;">${v.delta > 0 ? '+' : ''}${v.delta}</strong>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="inv-modal-foot">
        <button class="inv-action-btn primary" id="invAuditCommit">Commit audit</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      overlay.querySelector('#invAuditCommit').addEventListener('click', async () => {
        const { error } = await NX.sb.rpc('inventory_complete_audit', {
          p_audit_id: audit.id,
          p_deltas: state.auditDeltas,
          p_by_user_id: NX.currentUser?.id,
        });
        if (error) { NX.toast?.('Commit failed: ' + error.message, 'error'); return; }
        await loadAll();
        const newlyBelow = state.stock.filter(s =>
          state.auditDeltas[s.id] != null && s.is_below_threshold
        );
        for (const s of newlyBelow) await createReorderCard(s, s.count_on_hand);
        state.currentAuditId = null;
        state.auditDeltas = {};
        overlay.remove();
        NX.toast?.(`Audit complete: ${variances.length} variances, ${newlyBelow.length} reorder cards`, 'success');
        refreshActiveTab();
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     10. ADD / EDIT modals
     ════════════════════════════════════════════════════════════════ */
  function openAssetEditModal(asset) {
    const a = asset || {
      id: null, name: '', manufacturer: '', model: '', serial_number: '',
      category: 'power_tools', home_location: LOCATIONS[0],
      purchase_date: '', purchase_cost: '', warranty_until: '', notes: '',
    };
    const isEdit = !!asset;
    const html = `
      <h2 class="inv-modal-title">${isEdit ? 'Edit' : 'Add'} asset</h2>
      <div class="inv-modal-sub">${isEdit ? esc(a.internal_pn) : 'NEW · A new internal PN will be assigned'}</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="inv-field">
        <label class="inv-field-label">Name</label>
        <input type="text" class="inv-field-input" id="invAName" value="${esc(a.name)}" placeholder="Vitamix 5200 Pro">
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Manufacturer</label>
          <input type="text" class="inv-field-input" id="invAMfr" value="${esc(a.manufacturer || '')}" placeholder="Vitamix">
        </div>
        <div class="inv-field">
          <label class="inv-field-label">Model</label>
          <input type="text" class="inv-field-input" id="invAModel" value="${esc(a.model || '')}" placeholder="5200">
        </div>
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Serial number</label>
        <input type="text" class="inv-field-input" id="invASerial" value="${esc(a.serial_number || '')}" placeholder="Optional">
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Category</label>
          <select class="inv-field-select" id="invACat">
            ${ASSET_CATEGORIES.map(c => `<option value="${c.key}" ${a.category === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="inv-field">
          <label class="inv-field-label">Home location</label>
          <select class="inv-field-select" id="invALoc">
            ${LOCATIONS.map(l => `<option value="${l}" ${a.home_location === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Purchase date</label>
          <input type="date" class="inv-field-input" id="invADate" value="${a.purchase_date || ''}">
        </div>
        <div class="inv-field">
          <label class="inv-field-label">Cost</label>
          <input type="number" step="0.01" class="inv-field-input" id="invACost" value="${a.purchase_cost || ''}" placeholder="0.00">
        </div>
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Warranty until</label>
        <input type="date" class="inv-field-input" id="invAWarranty" value="${a.warranty_until || ''}">
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Notes</label>
        <textarea class="inv-field-textarea" id="invANotes" placeholder="Anything to remember">${esc(a.notes || '')}</textarea>
      </div>
      <div class="inv-modal-foot">
        ${isEdit ? `<button class="inv-action-btn danger" id="invADelete">Delete</button>` : `<button class="inv-action-btn" data-close>Cancel</button>`}
        <button class="inv-action-btn primary" id="invASubmit">${isEdit ? 'Save' : 'Add asset'}</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      overlay.querySelector('#invASubmit').addEventListener('click', async () => {
        const data = {
          name: overlay.querySelector('#invAName').value.trim(),
          manufacturer: overlay.querySelector('#invAMfr').value.trim() || null,
          model: overlay.querySelector('#invAModel').value.trim() || null,
          serial_number: overlay.querySelector('#invASerial').value.trim() || null,
          category: overlay.querySelector('#invACat').value,
          home_location: overlay.querySelector('#invALoc').value,
          purchase_date: overlay.querySelector('#invADate').value || null,
          purchase_cost: parseFloat(overlay.querySelector('#invACost').value) || null,
          warranty_until: overlay.querySelector('#invAWarranty').value || null,
          notes: overlay.querySelector('#invANotes').value.trim() || null,
          updated_at: new Date().toISOString(),
        };
        if (!data.name) { NX.toast?.('Name is required', 'error'); return; }

        if (isEdit) {
          const { error } = await NX.sb.from('inventory_assets').update(data).eq('id', a.id);
          if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
          NX.toast?.('Saved', 'success');
        } else {
          const nextSeq = await getNextAssetSeq();
          const pn = `NEXUS-A-${String(nextSeq).padStart(4, '0')}`;
          data.internal_pn = pn;
          data.qr_code = pn;
          data.status = 'on_shelf';
          const { data: inserted, error } = await NX.sb.from('inventory_assets').insert(data).select().single();
          if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
          await NX.sb.from('inventory_asset_events').insert({
            asset_id: inserted.id, event_type: 'created',
            by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
          });
          NX.toast?.(`Added ${pn}`, 'success');
        }
        overlay.remove();
        await loadAll();
        refreshActiveTab();
      });
      const delBtn = overlay.querySelector('#invADelete');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete ${a.name}? (soft-delete; can be restored)`)) return;
          const { error } = await NX.sb.from('inventory_assets').update({
            archived_at: new Date().toISOString(),
          }).eq('id', a.id);
          if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
          overlay.remove();
          await loadAll();
          refreshActiveTab();
          NX.toast?.('Asset archived', 'success');
        });
      }
    });
  }

  function openStockEditModal(stock) {
    const s = stock || {
      id: null, name: '', manufacturer: '', manufacturer_pn: '',
      category: 'refrigeration', location: LOCATIONS[0], bin_hint: '',
      count_on_hand: 0, par_level: 1, reorder_threshold: 1,
      unit_cost: '', primary_supplier: '', notes: '',
    };
    const isEdit = !!stock;
    const html = `
      <h2 class="inv-modal-title">${isEdit ? 'Edit' : 'Add'} stock item</h2>
      <div class="inv-modal-sub">${isEdit ? esc(s.internal_pn) : 'NEW · A new internal PN will be assigned'}</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="inv-field">
        <label class="inv-field-label">Name</label>
        <input type="text" class="inv-field-input" id="invSName" value="${esc(s.name)}" placeholder="True low boy door gasket">
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Manufacturer</label>
          <input type="text" class="inv-field-input" id="invSMfr" value="${esc(s.manufacturer || '')}" placeholder="True">
        </div>
        <div class="inv-field">
          <label class="inv-field-label">OEM Part #</label>
          <input type="text" class="inv-field-input" id="invSPn" value="${esc(s.manufacturer_pn || '')}" placeholder="GSK-2024">
        </div>
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Category</label>
          <select class="inv-field-select" id="invSCat">
            ${STOCK_CATEGORIES.map(c => `<option value="${c.key}" ${s.category === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="inv-field">
          <label class="inv-field-label">Location</label>
          <select class="inv-field-select" id="invSLoc">
            ${LOCATIONS.map(l => `<option value="${l}" ${s.location === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Bin hint</label>
        <input type="text" class="inv-field-input" id="invSBin" value="${esc(s.bin_hint || '')}" placeholder="BOH shelf 3, gasket bin">
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">${isEdit ? 'Current count' : 'Initial count'}</label>
          <input type="number" class="inv-field-input" id="invSCount" value="${s.count_on_hand}" min="0">
        </div>
        <div class="inv-field">
          <label class="inv-field-label">PAR level</label>
          <input type="number" class="inv-field-input" id="invSPar" value="${s.par_level}" min="1">
        </div>
      </div>
      <div class="inv-field-row">
        <div class="inv-field">
          <label class="inv-field-label">Reorder threshold</label>
          <input type="number" class="inv-field-input" id="invSThreshold" value="${s.reorder_threshold}" min="0">
        </div>
        <div class="inv-field">
          <label class="inv-field-label">Unit cost</label>
          <input type="number" step="0.01" class="inv-field-input" id="invSCost" value="${s.unit_cost || ''}" placeholder="0.00">
        </div>
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Supplier</label>
        <input type="text" class="inv-field-input" id="invSSup" value="${esc(s.primary_supplier || '')}" placeholder="Restaurant Depot, Webstaurant">
      </div>
      <div class="inv-field">
        <label class="inv-field-label">Notes</label>
        <textarea class="inv-field-textarea" id="invSNotes" placeholder="Anything to remember">${esc(s.notes || '')}</textarea>
      </div>
      <div class="inv-modal-foot">
        ${isEdit ? `<button class="inv-action-btn danger" id="invSDelete">Delete</button>` : `<button class="inv-action-btn" data-close>Cancel</button>`}
        <button class="inv-action-btn primary" id="invSSubmit">${isEdit ? 'Save' : 'Add stock'}</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      overlay.querySelector('#invSSubmit').addEventListener('click', async () => {
        const data = {
          name: overlay.querySelector('#invSName').value.trim(),
          manufacturer: overlay.querySelector('#invSMfr').value.trim() || null,
          manufacturer_pn: overlay.querySelector('#invSPn').value.trim() || null,
          category: overlay.querySelector('#invSCat').value,
          location: overlay.querySelector('#invSLoc').value,
          bin_hint: overlay.querySelector('#invSBin').value.trim() || null,
          count_on_hand: parseInt(overlay.querySelector('#invSCount').value) || 0,
          par_level: parseInt(overlay.querySelector('#invSPar').value) || 1,
          reorder_threshold: parseInt(overlay.querySelector('#invSThreshold').value) || 1,
          unit_cost: parseFloat(overlay.querySelector('#invSCost').value) || null,
          primary_supplier: overlay.querySelector('#invSSup').value.trim() || null,
          notes: overlay.querySelector('#invSNotes').value.trim() || null,
          updated_at: new Date().toISOString(),
        };
        if (!data.name) { NX.toast?.('Name is required', 'error'); return; }

        if (isEdit) {
          const { error } = await NX.sb.from('inventory_stock').update(data).eq('id', s.id);
          if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
          NX.toast?.('Saved', 'success');
        } else {
          const nextSeq = await getNextStockSeq();
          const pn = `NEXUS-S-${String(nextSeq).padStart(4, '0')}`;
          data.internal_pn = pn;
          data.qr_code = pn;
          const { data: inserted, error } = await NX.sb.from('inventory_stock').insert(data).select().single();
          if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
          if (data.count_on_hand > 0) {
            await NX.sb.from('inventory_stock_events').insert({
              stock_id: inserted.id, event_type: 'receive',
              delta: data.count_on_hand, count_after: data.count_on_hand,
              by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
              reason: 'initial stock',
            });
          }
          NX.toast?.(`Added ${pn}`, 'success');
        }
        overlay.remove();
        await loadAll();
        refreshActiveTab();
      });
      const delBtn = overlay.querySelector('#invSDelete');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete ${s.name}? (soft-delete; can be restored)`)) return;
          const { error } = await NX.sb.from('inventory_stock').update({
            archived_at: new Date().toISOString(),
          }).eq('id', s.id);
          if (error) { NX.toast?.('Failed: ' + error.message, 'error'); return; }
          overlay.remove();
          await loadAll();
          refreshActiveTab();
          NX.toast?.('Stock item archived', 'success');
        });
      }
    });
  }

  async function getNextAssetSeq() {
    const { data } = await NX.sb.from('inventory_assets')
      .select('internal_pn').order('id', { ascending: false }).limit(1);
    if (!data?.length) return 1;
    const m = data[0].internal_pn.match(/NEXUS-A-(\d+)/);
    return m ? parseInt(m[1]) + 1 : 1;
  }
  async function getNextStockSeq() {
    const { data } = await NX.sb.from('inventory_stock')
      .select('internal_pn').order('id', { ascending: false }).limit(1);
    if (!data?.length) return 1;
    const m = data[0].internal_pn.match(/NEXUS-S-(\d+)/);
    return m ? parseInt(m[1]) + 1 : 1;
  }

  /* ════════════════════════════════════════════════════════════════
     11. PHOTO upload
     ════════════════════════════════════════════════════════════════ */
  async function uploadAssetPhoto(asset, onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const compressed = await compressImage(file, 1280, 0.75);
        const filename = `asset-${asset.id}-${Date.now()}.jpg`;
        const { error } = await NX.sb.storage
          .from('inventory-photos')
          .upload(filename, compressed, { contentType: 'image/jpeg' });
        if (error) { NX.toast?.('Upload failed: ' + error.message, 'error'); return; }
        const { data: urlData } = NX.sb.storage.from('inventory-photos').getPublicUrl(filename);
        const photoUrl = urlData.publicUrl;

        const updates = !asset.primary_photo_url
          ? { primary_photo_url: photoUrl, updated_at: new Date().toISOString() }
          : {
              photos: [...(asset.photos || []), {
                type: 'identity', url: photoUrl,
                taken_at: new Date().toISOString(),
                by_user_id: NX.currentUser?.id,
              }],
              updated_at: new Date().toISOString(),
            };
        await NX.sb.from('inventory_assets').update(updates).eq('id', asset.id);
        await NX.sb.from('inventory_asset_events').insert({
          asset_id: asset.id, event_type: 'photo_added',
          by_user_id: NX.currentUser?.id, by_user_name: NX.currentUser?.name,
          photo_url: photoUrl,
        });
        NX.toast?.('Photo added', 'success');
        onDone?.();
      } catch (e) {
        console.warn('[inventory] photo upload', e);
        NX.toast?.('Upload error: ' + e.message, 'error');
      }
    });
    input.click();
  }

  async function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
                      'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = URL.createObjectURL(file);
    });
  }

  /* ════════════════════════════════════════════════════════════════
     12. EQUIPMENT-PARTS integration (Phase C)
     ════════════════════════════════════════════════════════════════ */
  async function getPmPartsForEquipment(equipmentId) {
    if (!NX.sb || !equipmentId) return [];
    const { data, error } = await NX.sb.from('equipment_parts')
      .select(`
        id, equipment_id, part_name, oem_part_number, quantity,
        pm_required, pm_default_quantity, stock_id,
        stock:stock_id (
          id, name, internal_pn, count_on_hand, par_level,
          reorder_threshold, location, bin_hint, unit_cost
        )
      `)
      .eq('equipment_id', equipmentId)
      .eq('pm_required', true);
    if (error) { console.warn('[inventory] getPmParts', error); return []; }
    return data || [];
  }

  /* ════════════════════════════════════════════════════════════════
     13. PM COMPLETION modal (Phase C)
     ════════════════════════════════════════════════════════════════ */
  async function openPmCompletionModal(equipmentId, equipmentName, onComplete) {
    const parts = await getPmPartsForEquipment(equipmentId);
    if (!parts.length) { onComplete?.({ partsConsumed: 0 }); return; }

    const html = `
      <h2 class="inv-modal-title">Parts used</h2>
      <div class="inv-modal-sub">${esc(equipmentName)} · PM completion</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <p style="font-size: 13px; color: var(--nx-muted); margin: 0 0 16px; line-height: 1.5;">
        Confirm what was actually used. Stock counts will decrement and reorder cards will auto-create if anything drops below threshold.
      </p>
      ${parts.map(p => {
        const stock = p.stock;
        return `
          <div class="inv-field" data-part-id="${p.id}" data-stock-id="${stock?.id || ''}">
            <label class="inv-field-label">
              ${esc(p.part_name || stock?.name || 'Unnamed part')}
              ${stock ? ` <span style="color: var(--nx-faint); font-weight: 400;">· ${stock.count_on_hand} in stock</span>` : ' <span style="color:#c8625e">· not linked to stock</span>'}
            </label>
            <input type="number" class="inv-field-input" min="0" max="99"
                   value="${p.pm_default_quantity || p.quantity || 1}"
                   ${!stock ? 'disabled' : ''}>
          </div>
        `;
      }).join('')}
      <div class="inv-modal-foot">
        <button class="inv-action-btn" data-close>Skip parts</button>
        <button class="inv-action-btn primary" id="invPmSubmit">Confirm</button>
      </div>
    `;
    showModal(html, async (overlay) => {
      overlay.querySelector('#invPmSubmit').addEventListener('click', async () => {
        const fields = overlay.querySelectorAll('[data-part-id]');
        let consumed = 0;
        for (const f of fields) {
          const stockId = parseInt(f.getAttribute('data-stock-id'));
          if (!stockId) continue;
          const qty = parseInt(f.querySelector('input').value) || 0;
          if (qty <= 0) continue;
          const { data, error } = await NX.sb.rpc('inventory_consume_stock', {
            p_stock_id: stockId, p_qty: qty,
            p_by_user_id: NX.currentUser?.id,
            p_reason: `PM on ${equipmentName}`,
          });
          if (error) { console.warn('[inventory] consume failed', error); continue; }
          consumed++;
          if (data?.below_threshold) {
            const { data: stockNow } = await NX.sb.from('inventory_stock')
              .select('*').eq('id', stockId).single();
            if (stockNow) await createReorderCard(stockNow, data.count_after);
          }
        }
        overlay.remove();
        if (consumed > 0) {
          NX.toast?.(`Consumed ${consumed} part${consumed === 1 ? '' : 's'}`, 'success');
        }
        onComplete?.({ partsConsumed: consumed });
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     14. REORDER CARD creation
     ════════════════════════════════════════════════════════════════ */
  async function createReorderCard(stock, currentCount) {
    if (!NX.sb) return;
    try {
      const { data: boards } = await NX.sb.from('boards').select('id, name').limit(5);
      const opsBoard = boards?.find(b => /operation/i.test(b.name)) || boards?.[0];
      if (!opsBoard) return;

      const { data: cols } = await NX.sb.from('board_columns')
        .select('id, name, position').eq('board_id', opsBoard.id)
        .order('position').limit(1);
      const col = cols?.[0];
      if (!col) return;

      const cardTitle = `Reorder: ${stock.name}`;
      const { data: existing } = await NX.sb.from('cards')
        .select('id, status, title')
        .ilike('title', cardTitle)
        .neq('status', 'done')
        .limit(1);
      if (existing?.length) {
        await NX.sb.from('inventory_stock_events').insert({
          stock_id: stock.id, event_type: 'reorder_card', delta: 0,
          count_after: currentCount,
          related_card_id: existing[0].id,
          reason: 'card already exists',
        });
        return;
      }

      const description = `Stock dropped to ${currentCount} (PAR ${stock.par_level}, threshold ${stock.reorder_threshold}).
Location: ${stock.location}${stock.bin_hint ? ' · ' + stock.bin_hint : ''}
${stock.manufacturer_pn ? 'OEM PN: ' + stock.manufacturer_pn : ''}
${stock.primary_supplier ? 'Supplier: ' + stock.primary_supplier : ''}
Suggested order: ${(stock.par_level - currentCount) * 2} units (rebuild buffer)`;

      const { data: newCard, error } = await NX.sb.from('cards').insert({
        board_id: opsBoard.id, column_id: col.id,
        title: cardTitle, description: description,
        priority: 'high', status: 'todo',
        location: stock.location, position: 0,
      }).select().single();
      if (error) { console.warn('[inventory] reorder card insert failed', error); return; }
      await NX.sb.from('inventory_stock_events').insert({
        stock_id: stock.id, event_type: 'reorder_card', delta: 0,
        count_after: currentCount, related_card_id: newCard?.id,
      });
    } catch (e) {
      console.warn('[inventory] createReorderCard', e);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     15. UI plumbing — modal, QR preview, render orchestration
     ════════════════════════════════════════════════════════════════ */
  function showModal(html, onMounted) {
    const overlay = document.createElement('div');
    overlay.className = 'inv-modal-overlay';
    overlay.innerHTML = `<div class="inv-modal">${html}</div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => overlay.remove());
    });
    document.body.appendChild(overlay);
    onMounted?.(overlay);
  }

  function showQrPreview(item, type) {
    const qrUrl = `${window.location.origin}${window.location.pathname}?inv-${type}=${item.qr_code}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&format=svg&ecc=H&margin=2&data=${encodeURIComponent(qrUrl)}`;
    const html = `
      <h2 class="inv-modal-title">QR Code</h2>
      <div class="inv-modal-sub">${esc(item.internal_pn)} · ${esc(item.name)}</div>
      <button class="inv-modal-close" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div style="text-align: center; padding: 12px 0;">
        <img src="${qrSrc}" alt="QR code" style="width: 240px; height: 240px; background: white; padding: 8px; border-radius: 8px;">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--nx-faint); margin-top: 12px; word-break: break-all; letter-spacing: 0.5px;">${esc(qrUrl)}</div>
      </div>
      <div class="inv-modal-foot">
        <button class="inv-action-btn" data-close>Close</button>
        <button class="inv-action-btn primary" id="invQrPrint">Print Sticker</button>
      </div>
    `;
    showModal(html, (overlay) => {
      overlay.querySelector('#invQrPrint').addEventListener('click', () => {
        // Defer to equipment.js's existing printStickers engine if available.
        // We pass an array with a single inventory item (asset or stock) so
        // the sticker renderer can pick up the editorial template.
        if (NX.modules?.equipment?.printInventoryStickers) {
          NX.modules.equipment.printInventoryStickers([item], type);
        } else {
          // Fallback: open the QR in a new tab for browser printing.
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(`<html><head><title>${esc(item.internal_pn)}</title></head><body style="margin:40px;text-align:center;font-family:sans-serif"><img src="${qrSrc}" style="width:300px;height:300px"><div style="margin-top:20px;font-size:14px"><strong>${esc(item.name)}</strong></div><div style="font-size:11px;color:#666;margin-top:4px">${esc(item.internal_pn)}</div><script>setTimeout(()=>window.print(),300);</scr` + `ipt></body></html>`);
            w.document.close();
          }
        }
      });
    });
  }

  // Build the full module HTML based on the active tab
  function buildHtml() {
    const tabs = ['dashboard', 'assets', 'stock', 'audits'];
    const labels = {
      dashboard: 'Overview',
      assets:    'Assets',
      stock:     'Stock',
      audits:    'Audits',
    };
    const tabBar = `
      <div class="inv-tabs">
        ${tabs.map(t => `<button class="inv-tab ${state.activeTab === t ? 'active' : ''}" data-tab="${t}">${labels[t]}</button>`).join('')}
      </div>
    `;
    let body = '';
    if (state.activeTab === 'dashboard') body = dashboardHTML();
    else if (state.activeTab === 'assets') body = assetsViewHTML();
    else if (state.activeTab === 'stock')  body = stockViewHTML();
    else if (state.activeTab === 'audits') body = auditsViewHTML();

    // FAB only on assets / stock tabs
    const fab = (state.activeTab === 'assets' || state.activeTab === 'stock')
      ? `<button class="inv-add-fab" id="invAddFab" aria-label="Add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`
      : '';

    return `<div class="inv-wrap">${tabBar}${body}</div>${fab}`;
  }

  function render() {
    const root = document.getElementById('inventoryView');
    if (!root) return;
    root.innerHTML = buildHtml();
    wireEvents(root);
  }

  function refreshActiveTab() {
    render();
  }

  function wireEvents(root) {
    // Tab switch
    root.querySelectorAll('.inv-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.getAttribute('data-tab');
        render();
      });
    });

    // Dashboard alerts → jump to filtered list
    root.querySelectorAll('[data-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const jump = btn.getAttribute('data-jump');
        if (jump === 'below-par') {
          state.activeTab = 'stock';
          state.filters.stockBelowPar = true;
          render();
        } else if (jump === 'missing') {
          state.activeTab = 'assets';
          state.filters.assetStatus = 'missing';
          render();
        } else if (jump === 'audits') {
          state.activeTab = 'audits';
          render();
        }
      });
    });

    // Empty-state CTA
    root.querySelector('#invEmptyAdd')?.addEventListener('click', () => {
      // Default to assets when starting fresh — that's where most setup begins
      state.activeTab = 'assets';
      render();
      setTimeout(() => openAssetEditModal(null), 100);
    });

    // Scan button — wire to existing equipment scanner if it exists
    root.querySelector('#invScanBtn')?.addEventListener('click', () => {
      if (NX.modules?.equipment?.openScanner) {
        NX.modules.equipment.openScanner();
      } else {
        NX.toast?.('Scanner not available', 'warn');
      }
    });

    // Search inputs
    root.querySelector('#invAssetSearch')?.addEventListener('input', (e) => {
      state.filters.assetSearch = e.target.value;
      // Re-render only the list portion to preserve focus
      const list = root.querySelector('.inv-list');
      const empty = root.querySelector('.inv-empty');
      if (list || empty) {
        const filtered = filteredAssets();
        const newHtml = filtered.length ? `<div class="inv-list">${filtered.map(assetRowHTML).join('')}</div>` : renderEmptyList('asset', true);
        if (list) list.outerHTML = newHtml;
        else if (empty) empty.outerHTML = newHtml;
        // Re-bind row clicks
        root.querySelectorAll('[data-asset-id]').forEach(row => {
          row.addEventListener('click', () => {
            const id = parseInt(row.getAttribute('data-asset-id'));
            const asset = state.assets.find(a => a.id === id);
            if (asset) openAssetDetail(asset);
          });
        });
      }
    });
    root.querySelector('#invStockSearch')?.addEventListener('input', (e) => {
      state.filters.stockSearch = e.target.value;
      const list = root.querySelector('.inv-list');
      const empty = root.querySelector('.inv-empty');
      if (list || empty) {
        const filtered = filteredStock();
        const newHtml = filtered.length ? `<div class="inv-list">${filtered.map(stockRowHTML).join('')}</div>` : renderEmptyList('stock', true);
        if (list) list.outerHTML = newHtml;
        else if (empty) empty.outerHTML = newHtml;
        root.querySelectorAll('[data-stock-id]').forEach(row => {
          row.addEventListener('click', () => {
            const id = parseInt(row.getAttribute('data-stock-id'));
            const stock = state.stock.find(s => s.id === id);
            if (stock) openStockDetail(stock);
          });
        });
      }
    });

    // Filter chips
    root.querySelectorAll('[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        const filter = chip.getAttribute('data-filter');
        const val = chip.getAttribute('data-val');
        if (filter === 'stockBelowPar') {
          state.filters.stockBelowPar = !state.filters.stockBelowPar;
        } else {
          state.filters[filter] = val;
        }
        render();
      });
    });

    // Row clicks — assets
    root.querySelectorAll('[data-asset-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = parseInt(row.getAttribute('data-asset-id'));
        const asset = state.assets.find(a => a.id === id);
        if (asset) openAssetDetail(asset);
      });
    });

    // Row clicks — stock
    root.querySelectorAll('[data-stock-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = parseInt(row.getAttribute('data-stock-id'));
        const stock = state.stock.find(s => s.id === id);
        if (stock) openStockDetail(stock);
      });
    });

    // Audit schedule rows → start walkthrough
    root.querySelectorAll('[data-schedule-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = parseInt(row.getAttribute('data-schedule-id'));
        startAuditWalkthrough(id);
      });
    });

    // FAB
    root.querySelector('#invAddFab')?.addEventListener('click', () => {
      if (state.activeTab === 'assets') openAssetEditModal(null);
      else if (state.activeTab === 'stock') openStockEditModal(null);
    });
  }

  /* ════════════════════════════════════════════════════════════════
     16. EXPORT
     ════════════════════════════════════════════════════════════════ */
  NX.modules = NX.modules || {};
  NX.modules.inventory = {
    async init() {
      injectStyles();
      await loadAll();
      render();
      // Handle ?inv-asset=XXX or ?inv-stock=XXX in URL
      handleScanRedirect();
    },
    async show() {
      // Refresh data on every tab activation — counts may have changed
      await loadAll();
      render();
    },
    // Public API for equipment.js / brain-chat.js / PM completion flow
    openPmCompletionModal,
    getPmPartsForEquipment,
    openAssetDetailById: async (id) => {
      const { data } = await NX.sb.from('inventory_assets').select('*').eq('id', id).maybeSingle();
      if (data) openAssetDetail(data);
    },
    openStockDetailById: async (id) => {
      const { data } = await NX.sb.from('inventory_stock_with_status').select('*').eq('id', id).maybeSingle();
      if (data) openStockDetail(data);
    },
  };

  console.log('[inventory] Phase B+C module loaded');
})();
