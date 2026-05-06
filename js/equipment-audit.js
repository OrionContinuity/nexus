/* ─────────────────────────────────────────────────────────────────────────
 * NEXUS — Equipment Audit Module
 *
 * Diagnostic surface that surfaces data-quality problems on equipment
 * records. Self-discovers schema (defensive against column-name drift —
 * see hard-won lesson #2 in NEXUS-CONTEXT.md). Calm by design: no pulses,
 * no auto-refresh.
 *
 * Mount triggers:
 *   - location.hash === '#audit'  → auto-mount as full-screen overlay
 *   - NX.modules.equipmentAudit.mount()  → manual mount
 *
 * Dismount:
 *   - tap back arrow / escape key / hash change away from #audit
 *
 * Depends on: NX.sb (Supabase client), optionally NX.toast.
 * Files: /css/equipment-audit.css, /js/equipment-audit.js
 * ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.NX = window.NX || {});
  NS.modules = NS.modules || {};

  /* ── State ─────────────────────────────────────────────────────────── */
  let _root = null;        // overlay root element
  let _data = null;        // { equipment, contractorMap, fieldKeys, loadedAt, ms }
  let _filter = 'all';     // active filter code: 'all' | issue-code | 'clean'
  let _expanded = new Set();// equipment IDs whose raw-row debug panel is open
  let _loading = false;
  let _error = null;       // last error message
  let _hashListenerBound = false;

  /* ── Constants: issue codes ────────────────────────────────────────── */
  const ISSUE = {
    NO_NAME:         { sev: 'error', label: 'NO NAME' },
    NO_LOCATION:     { sev: 'error', label: 'NO LOCATION' },
    BAD_LOCATION:    { sev: 'warn',  label: 'UNKNOWN LOCATION' },
    NO_STATUS:       { sev: 'error', label: 'NO STATUS' },
    NO_SVC_FK:       { sev: 'error', label: 'NO PRIMARY CONTRACTOR' },
    ORPHAN_SVC_FK:   { sev: 'error', label: 'ORPHAN SERVICE FK' },
    SVC_NAME_DRIFT:  { sev: 'error', label: 'SERVICE NAME OUT OF SYNC' },
    NO_BKP_FK:       { sev: 'warn',  label: 'NO BACKUP CONTRACTOR' },
    ORPHAN_BKP_FK:   { sev: 'error', label: 'ORPHAN BACKUP FK' },
    BKP_NAME_DRIFT:  { sev: 'warn',  label: 'BACKUP NAME OUT OF SYNC' },
    NO_SERIAL:       { sev: 'warn',  label: 'NO SERIAL' },
    NO_MODEL:        { sev: 'warn',  label: 'NO MODEL' },
    NO_MAKE:         { sev: 'warn',  label: 'NO MANUFACTURER' },
    NO_INSTALL:      { sev: 'warn',  label: 'NO INSTALL DATE' },
    FUTURE_INSTALL:  { sev: 'warn',  label: 'INSTALL DATE IN FUTURE' },
    NO_PHOTO:        { sev: 'warn',  label: 'NO PHOTO' },
    NO_QR:           { sev: 'warn',  label: 'NO QR CODE' },
    NO_PM_INTERVAL:  { sev: 'warn',  label: 'NO PM INTERVAL' },
    NO_LAST_SVC:     { sev: 'info',  label: 'NEVER SERVICED' },
  };

  const KNOWN_LOCATIONS = ['suerte', 'este', 'bar toti', 'bar_toti', 'bartoti'];

  /* ── Utilities ─────────────────────────────────────────────────────── */
  function sb() {
    if (!NS.sb) throw new Error('NX.sb is not initialized — main app must boot first.');
    return NS.sb;
  }

  function toast(msg, level) {
    if (typeof NS.toast === 'function') NS.toast(msg, level || 'info');
    else console.log('[audit]', level || 'info', msg);
  }

  function isEmpty(v) {
    if (v == null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
  }

  function findKey(sample, candidates) {
    if (!sample) return null;
    for (let i = 0; i < candidates.length; i++) {
      if (Object.prototype.hasOwnProperty.call(sample, candidates[i])) {
        return candidates[i];
      }
    }
    return null;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (k.startsWith('data-') || k === 'role' || k === 'aria-label' || k === 'tabindex' || k === 'type' || k === 'title') {
          node.setAttribute(k, attrs[k]);
        } else {
          node[k] = attrs[k];
        }
      }
    }
    if (children) {
      const arr = Array.isArray(children) ? children : [children];
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function fmtDate(v) {
    if (!v) return '—';
    try {
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toISOString().slice(0, 10);
    } catch (_) {
      return String(v);
    }
  }

  function pretty(v) {
    if (v == null) return null;
    if (typeof v === 'object') {
      try { return JSON.stringify(v, null, 2); }
      catch (_) { return String(v); }
    }
    return String(v);
  }

  /* ── Schema discovery ──────────────────────────────────────────────── */
  function resolveFieldKeys(sample) {
    return {
      id:          findKey(sample, ['id', 'equipment_id', 'uuid']),
      name:        findKey(sample, ['name', 'equipment_name', 'title']),
      location:    findKey(sample, ['location', 'restaurant', 'site', 'location_name']),
      status:      findKey(sample, ['status', 'lifecycle', 'lifecycle_status', 'state', 'operational_status']),
      serial:      findKey(sample, ['serial_number', 'serial', 'serial_no', 'serialnumber']),
      model:       findKey(sample, ['model', 'model_number', 'model_no', 'model_name']),
      make:        findKey(sample, ['manufacturer', 'make', 'brand', 'mfr']),
      installDate: findKey(sample, ['install_date', 'installed_at', 'install_at', 'purchase_date', 'acquired_at', 'commissioned_at']),
      lastService: findKey(sample, ['last_service_date', 'last_serviced_at', 'last_pm_date', 'last_service_at']),
      pmInterval:  findKey(sample, ['pm_interval_days', 'pm_frequency_days', 'pm_days', 'service_interval_days']),
      photo:       findKey(sample, ['photo_url', 'photo', 'image_url', 'image', 'primary_photo_url']),
      qr:          findKey(sample, ['qr_code', 'qr', 'qr_id', 'qr_token', 'qr_slug']),
      svcId:       findKey(sample, ['service_contractor_node_id']),
      svcName:     findKey(sample, ['service_contractor_name']),
      svcPhone:    findKey(sample, ['service_contractor_phone']),
      bkpId:       findKey(sample, ['backup_contractor_node_id']),
      bkpName:     findKey(sample, ['backup_contractor_name']),
      bkpPhone:    findKey(sample, ['backup_contractor_phone']),
    };
  }

  /* ── Audit logic (per equipment row) ───────────────────────────────── */
  function audit(row, k, contractorMap) {
    const issues = [];
    const get = (key) => (key ? row[key] : undefined);

    if (k.name && isEmpty(get(k.name))) issues.push('NO_NAME');

    if (k.location) {
      const loc = get(k.location);
      if (isEmpty(loc)) {
        issues.push('NO_LOCATION');
      } else {
        const norm = String(loc).trim().toLowerCase();
        const ok = KNOWN_LOCATIONS.some(L => norm === L || norm.indexOf(L) !== -1);
        if (!ok) issues.push('BAD_LOCATION');
      }
    }

    if (k.status && isEmpty(get(k.status))) issues.push('NO_STATUS');

    /* primary contractor */
    if (k.svcId) {
      const svcId = get(k.svcId);
      if (svcId == null || svcId === '') {
        issues.push('NO_SVC_FK');
      } else {
        const c = contractorMap.get(Number(svcId));
        if (!c) {
          issues.push('ORPHAN_SVC_FK');
        } else if (k.svcName) {
          const denorm = get(k.svcName);
          if (!isEmpty(denorm) && c.name && String(denorm).trim() !== String(c.name).trim()) {
            issues.push('SVC_NAME_DRIFT');
          }
        }
      }
    }

    /* backup contractor */
    if (k.bkpId) {
      const bkpId = get(k.bkpId);
      if (bkpId == null || bkpId === '') {
        issues.push('NO_BKP_FK');
      } else {
        const c = contractorMap.get(Number(bkpId));
        if (!c) {
          issues.push('ORPHAN_BKP_FK');
        } else if (k.bkpName) {
          const denorm = get(k.bkpName);
          if (!isEmpty(denorm) && c.name && String(denorm).trim() !== String(c.name).trim()) {
            issues.push('BKP_NAME_DRIFT');
          }
        }
      }
    }

    if (k.serial && isEmpty(get(k.serial))) issues.push('NO_SERIAL');
    if (k.model  && isEmpty(get(k.model)))  issues.push('NO_MODEL');
    if (k.make   && isEmpty(get(k.make)))   issues.push('NO_MAKE');

    if (k.installDate) {
      const d = get(k.installDate);
      if (isEmpty(d)) {
        issues.push('NO_INSTALL');
      } else {
        const t = new Date(d).getTime();
        if (!isNaN(t) && t > Date.now()) issues.push('FUTURE_INSTALL');
      }
    }

    if (k.photo      && isEmpty(get(k.photo)))      issues.push('NO_PHOTO');
    if (k.qr         && isEmpty(get(k.qr)))         issues.push('NO_QR');
    if (k.pmInterval && isEmpty(get(k.pmInterval))) issues.push('NO_PM_INTERVAL');
    if (k.lastService && isEmpty(get(k.lastService))) issues.push('NO_LAST_SVC');

    return issues;
  }

  function topSeverity(issueCodes) {
    let top = 'clean';
    for (let i = 0; i < issueCodes.length; i++) {
      const sev = (ISSUE[issueCodes[i]] || {}).sev;
      if (sev === 'error') return 'error';
      if (sev === 'warn'  && top !== 'error') top = 'warn';
      if (sev === 'info'  && top !== 'error' && top !== 'warn') top = 'info';
    }
    return top;
  }

  /* ── Data fetch ────────────────────────────────────────────────────── */
  async function loadData() {
    _loading = true; _error = null; render();

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const client = sb();

    /* equipment — select * to discover all columns */
    const eqRes = await client.from('equipment').select('*');
    if (eqRes.error) {
      _loading = false;
      _error = 'equipment query: ' + (eqRes.error.message || JSON.stringify(eqRes.error));
      render();
      return;
    }
    const equipment = eqRes.data || [];
    const sample = equipment[0] || null;
    const fieldKeys = resolveFieldKeys(sample);

    /* gather every referenced contractor node id from equipment, then
     * fetch only those nodes — far cheaper than scanning all 2838 nodes */
    const referencedIds = new Set();
    if (fieldKeys.svcId || fieldKeys.bkpId) {
      for (let i = 0; i < equipment.length; i++) {
        const r = equipment[i];
        if (fieldKeys.svcId) {
          const v = r[fieldKeys.svcId];
          if (v != null && v !== '') referencedIds.add(Number(v));
        }
        if (fieldKeys.bkpId) {
          const v = r[fieldKeys.bkpId];
          if (v != null && v !== '') referencedIds.add(Number(v));
        }
      }
    }

    const contractorMap = new Map();
    let contractorCount = 0;
    if (referencedIds.size > 0) {
      const idArr = Array.from(referencedIds);
      const res = await client.from('nodes').select('id, name, category').in('id', idArr);
      if (res.error) {
        _loading = false;
        _error = 'contractor lookup: ' + (res.error.message || JSON.stringify(res.error));
        render();
        return;
      }
      const rows = res.data || [];
      for (let i = 0; i < rows.length; i++) {
        contractorMap.set(Number(rows[i].id), rows[i]);
      }
      contractorCount = rows.length;
    }

    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    _data = {
      equipment,
      contractorMap,
      contractorCount,
      referencedCount: referencedIds.size,
      fieldKeys,
      loadedAt: new Date(),
      ms: Math.round(t1 - t0),
    };
    _loading = false;
    render();
  }

  /* ── Aggregates from current data ──────────────────────────────────── */
  function buildAggregates() {
    if (!_data) return null;
    const { equipment, contractorMap, fieldKeys } = _data;

    const audited = [];
    const issueCounts = {}; // code -> count
    let nErr = 0, nWarn = 0, nInfo = 0, nClean = 0;

    for (let i = 0; i < equipment.length; i++) {
      const row = equipment[i];
      const codes = audit(row, fieldKeys, contractorMap);
      const sev = topSeverity(codes);
      audited.push({ row, codes, sev });

      for (let j = 0; j < codes.length; j++) {
        issueCounts[codes[j]] = (issueCounts[codes[j]] || 0) + 1;
      }
      if (sev === 'error') nErr++;
      else if (sev === 'warn') nWarn++;
      else if (sev === 'info') nInfo++;
      else nClean++;
    }

    return { audited, issueCounts, nErr, nWarn, nInfo, nClean };
  }

  /* ── Filter ────────────────────────────────────────────────────────── */
  function applyFilter(audited) {
    if (_filter === 'all') return audited;
    if (_filter === 'clean') return audited.filter(a => a.sev === 'clean');
    return audited.filter(a => a.codes.indexOf(_filter) !== -1);
  }

  /* ── Render: shell ─────────────────────────────────────────────────── */
  function render() {
    if (!_root) return;
    _root.innerHTML = '';

    _root.appendChild(renderHeader());
    const body = el('div', { class: 'nx-audit__body' });
    _root.appendChild(body);

    if (_loading) {
      body.appendChild(renderState('LOADING', 'Querying equipment + contractor index…'));
      return;
    }
    if (_error) {
      body.appendChild(renderState('ERROR', 'Audit could not run.', _error));
      return;
    }
    if (!_data || !_data.equipment.length) {
      body.appendChild(renderState('EMPTY', 'No equipment rows returned.', 'The equipment table is empty or RLS blocked the query.'));
      return;
    }

    const agg = buildAggregates();
    body.appendChild(renderSummary(agg));
    body.appendChild(renderFilters(agg));
    body.appendChild(renderList(agg));
    body.appendChild(renderFoot());
  }

  /* ── Render: header ────────────────────────────────────────────────── */
  function renderHeader() {
    const back = el('button', {
      class: 'nx-audit__back',
      type: 'button',
      'aria-label': 'Close audit',
      title: 'Close',
      onClick: () => unmount({ resetHash: true }),
      text: '←'
    });

    const title = el('div', { class: 'nx-audit__title' }, [
      el('span', { class: 'nx-audit__title-eyebrow', text: 'NEXUS · DIAGNOSTIC' }),
      el('span', { class: 'nx-audit__title-text', text: 'Equipment Audit' }),
    ]);

    const refresh = el('button', {
      class: 'nx-audit__refresh',
      type: 'button',
      'aria-label': 'Refresh',
      title: 'Refresh',
      onClick: () => { loadData(); },
      text: '↻'
    });

    return el('header', { class: 'nx-audit__header' }, [back, title, refresh]);
  }

  /* ── Render: state cards ───────────────────────────────────────────── */
  function renderState(eyebrow, message, detail) {
    return el('div', { class: 'nx-audit__state' }, [
      el('div', { class: 'nx-audit__state-eyebrow', text: eyebrow }),
      el('div', { class: 'nx-audit__state-message', text: message }),
      detail ? el('div', { class: 'nx-audit__state-detail', text: detail }) : null,
    ]);
  }

  /* ── Render: summary panel ─────────────────────────────────────────── */
  function renderSummary(agg) {
    const total = _data.equipment.length;
    const stat = (label, num, modCls) => el('div', { class: 'nx-audit__stat' }, [
      el('div', { class: 'nx-audit__stat-num' + (modCls ? ' ' + modCls : ''), text: String(num) }),
      el('div', { class: 'nx-audit__stat-label', text: label }),
    ]);

    return el('div', { class: 'nx-audit__summary' }, [
      stat('TOTAL',   total),
      stat('ERRORS',  agg.nErr,   'nx-audit__stat-num--err'),
      stat('WARNINGS', agg.nWarn, 'nx-audit__stat-num--warn'),
      stat('CLEAN',   agg.nClean, 'nx-audit__stat-num--clean'),
    ]);
  }

  /* ── Render: filter chips ──────────────────────────────────────────── */
  function renderFilters(agg) {
    const wrap = el('div', { class: 'nx-audit__filters', role: 'tablist' });

    const makeChip = (code, label, count, sev) => {
      const isActive = _filter === code;
      const chip = el('button', {
        class: 'nx-audit__chip',
        type: 'button',
        'data-active': isActive ? 'true' : 'false',
        'data-sev': sev || 'all',
        onClick: () => { _filter = code; render(); }
      }, [
        document.createTextNode(label),
        el('span', { class: 'nx-audit__chip-count', text: String(count) })
      ]);
      return chip;
    };

    wrap.appendChild(makeChip('all', 'ALL', _data.equipment.length, 'all'));
    wrap.appendChild(makeChip('clean', 'CLEAN', agg.nClean, 'clean'));

    /* sort issue chips: errors first, then warns, then infos; descending count within each */
    const codes = Object.keys(agg.issueCounts);
    codes.sort((a, b) => {
      const order = { error: 0, warn: 1, info: 2 };
      const sa = order[(ISSUE[a] || {}).sev] ?? 9;
      const sb = order[(ISSUE[b] || {}).sev] ?? 9;
      if (sa !== sb) return sa - sb;
      return agg.issueCounts[b] - agg.issueCounts[a];
    });

    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const meta = ISSUE[c] || { sev: 'info', label: c };
      wrap.appendChild(makeChip(c, meta.label, agg.issueCounts[c], meta.sev));
    }

    return wrap;
  }

  /* ── Render: equipment cards ───────────────────────────────────────── */
  function renderList(agg) {
    const filtered = applyFilter(agg.audited);

    if (!filtered.length) {
      return el('div', { class: 'nx-audit__state' }, [
        el('div', { class: 'nx-audit__state-eyebrow', text: 'EMPTY FILTER' }),
        el('div', { class: 'nx-audit__state-message', text: 'No equipment matches that filter.' }),
      ]);
    }

    /* sort: errors first, then warnings, then info, then clean.
     * within a tier, by issue count desc, then by name */
    const k = _data.fieldKeys;
    const sevOrder = { error: 0, warn: 1, info: 2, clean: 3 };
    filtered.sort((a, b) => {
      const sa = sevOrder[a.sev], sb = sevOrder[b.sev];
      if (sa !== sb) return sa - sb;
      if (a.codes.length !== b.codes.length) return b.codes.length - a.codes.length;
      const an = (k.name && a.row[k.name]) || '';
      const bn = (k.name && b.row[k.name]) || '';
      return String(an).localeCompare(String(bn));
    });

    const list = el('div', { class: 'nx-audit__list' });
    for (let i = 0; i < filtered.length; i++) {
      list.appendChild(renderCard(filtered[i]));
    }
    return list;
  }

  function renderCard(item) {
    const k = _data.fieldKeys;
    const row = item.row;
    const id = k.id ? row[k.id] : null;
    const name = (k.name && row[k.name]) || '(unnamed)';
    const location = (k.location && row[k.location]) || null;
    const status = (k.status && row[k.status]) || null;

    const card = el('article', {
      class: 'nx-audit__card',
      'data-sev': item.sev,
      'data-id': id != null ? String(id) : ''
    });

    /* head */
    const head = el('div', { class: 'nx-audit__card-head' }, [
      el('div', { class: 'nx-audit__card-name', text: String(name) }),
      el('div', { class: 'nx-audit__card-id', text: id != null ? '#' + String(id) : '' }),
    ]);
    card.appendChild(head);

    /* meta */
    const metaParts = [];
    if (location) metaParts.push(String(location));
    if (status)   metaParts.push(String(status));
    if (k.serial && row[k.serial]) metaParts.push('SN ' + String(row[k.serial]));

    if (metaParts.length) {
      const meta = el('div', { class: 'nx-audit__card-meta' });
      for (let i = 0; i < metaParts.length; i++) {
        if (i > 0) meta.appendChild(el('span', { class: 'nx-audit__card-meta-sep', text: '·' }));
        meta.appendChild(document.createTextNode(metaParts[i]));
      }
      card.appendChild(meta);
    }

    /* issues OR clean badge */
    if (item.codes.length === 0) {
      card.appendChild(el('div', { class: 'nx-audit__card-clean', text: '✓ CLEAN' }));
    } else {
      const issuesWrap = el('div', { class: 'nx-audit__card-issues' });
      /* sort issues by severity within card */
      const sortedCodes = item.codes.slice().sort((a, b) => {
        const order = { error: 0, warn: 1, info: 2 };
        return (order[(ISSUE[a] || {}).sev] ?? 9) - (order[(ISSUE[b] || {}).sev] ?? 9);
      });
      for (let i = 0; i < sortedCodes.length; i++) {
        const c = sortedCodes[i];
        const meta = ISSUE[c] || { sev: 'info', label: c };
        issuesWrap.appendChild(el('span', {
          class: 'nx-audit__issue',
          'data-sev': meta.sev,
          text: meta.label
        }));
      }
      card.appendChild(issuesWrap);
    }

    /* actions */
    const isExpanded = id != null && _expanded.has(String(id));
    const actions = el('div', { class: 'nx-audit__card-actions' }, [
      el('button', {
        class: 'nx-audit__card-btn',
        type: 'button',
        text: isExpanded ? 'HIDE FIELDS' : 'SHOW FIELDS',
        onClick: () => {
          if (id == null) return;
          const key = String(id);
          if (_expanded.has(key)) _expanded.delete(key); else _expanded.add(key);
          render();
        }
      }),
    ]);
    card.appendChild(actions);

    if (isExpanded) {
      card.appendChild(renderRaw(row));
    }

    return card;
  }

  function renderRaw(row) {
    const wrap = el('div', { class: 'nx-audit__raw' });
    const keys = Object.keys(row).sort();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const val = row[key];
      const valNode = (val == null || val === '')
        ? el('span', { class: 'nx-audit__raw-val nx-audit__raw-val--null', text: 'null' })
        : el('span', { class: 'nx-audit__raw-val', text: pretty(val) });
      wrap.appendChild(el('div', { class: 'nx-audit__raw-row' }, [
        el('span', { class: 'nx-audit__raw-key', text: key }),
        valNode,
      ]));
    }
    return wrap;
  }

  /* ── Render: footer ────────────────────────────────────────────────── */
  function renderFoot() {
    const k = _data.fieldKeys;
    const fk = Object.keys(k).filter(name => k[name]).length;
    const total = Object.keys(k).length;
    const dt = _data.loadedAt ? _data.loadedAt.toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—';
    const ref = _data.referencedCount || 0;
    const got = _data.contractorCount || 0;
    return el('div', { class: 'nx-audit__foot' }, [
      el('span', { text: 'SCHEMA ' + fk + '/' + total + ' · CONTRACTOR FKS ' + got + '/' + ref + ' RESOLVED · ' + _data.ms + 'ms' }),
      el('span', { text: dt }),
    ]);
  }

  /* ── Mount / unmount ───────────────────────────────────────────────── */
  function ensureRoot() {
    if (_root && document.body.contains(_root)) return _root;
    _root = el('div', {
      class: 'nx-audit',
      role: 'dialog',
      'aria-label': 'Equipment Audit'
    });
    return _root;
  }

  function mount() {
    if (!NS.sb) {
      console.warn('[audit] NX.sb not ready — retrying in 250ms');
      setTimeout(mount, 250);
      return;
    }
    ensureRoot();
    if (!document.body.contains(_root)) {
      document.body.appendChild(_root);
      document.documentElement.classList.add('nx-audit-open');
      document.addEventListener('keydown', onKey);
    }
    render();
    if (!_data && !_loading) loadData();
  }

  function unmount(opts) {
    if (_root && _root.parentNode) _root.parentNode.removeChild(_root);
    document.documentElement.classList.remove('nx-audit-open');
    document.removeEventListener('keydown', onKey);
    _expanded.clear();
    if (opts && opts.resetHash && location.hash === '#audit') {
      /* clear hash without scrolling */
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (_) {
        location.hash = '';
      }
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') unmount({ resetHash: true });
  }

  function onHashChange() {
    if (location.hash === '#audit') mount();
    else if (_root && _root.parentNode) unmount({ resetHash: false });
  }

  function init() {
    if (_hashListenerBound) return;
    _hashListenerBound = true;
    window.addEventListener('hashchange', onHashChange);
    /* initial check, but wait a tick so NX.sb has time to attach */
    setTimeout(onHashChange, 200);
  }

  /* ── Expose ────────────────────────────────────────────────────────── */
  NS.modules.equipmentAudit = {
    mount: mount,
    unmount: unmount,
    refresh: loadData,
    /* dev helpers */
    _state: function () { return { data: _data, filter: _filter, loading: _loading, error: _error }; },
  };

  /* boot */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
