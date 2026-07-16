/* ═══════════════════════════════════════════════════════════════════════════
   clippy-mens.js — MENS. Clippy's rational mind.

   ANIMA is his soul (what he feels). Moneta is his memory (what he remembers).
   MENS is his MIND: the faculty that perceives the true state of his own house
   before he speaks, so he answers from what IS rather than from what sounds
   right. A grounded mind. Retrieval, in the plain tongue.

   Given a question, MENS:
     1. classify()  — which domains does this touch? which location?
     2. perceive()  — pull the real, live rows from Supabase for those domains
     3. brief()     — render them as compact ground-truth for his brain to read

   The brief rides the deep-brain call next to the Inheritance. If MENS finds
   nothing, it returns null and stays silent — grounding only speaks when there
   is ground to stand on. Every query is capped and wrapped: a mind that cannot
   perceive still lets him talk, it just lets him guess again.

   Read-only. MENS perceives; it does not act. (Action is a later faculty.)
   Exposed as NX.clippyMens.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (LEX) {
  'use strict';
  var NX = (window.NX = window.NX || {});

  // The three houses, however they were spelled the day someone typed them.
  function locNorm(s) {
    s = String(s || '').toLowerCase();
    if (s.indexOf('toti') >= 0) return 'toti';
    if (s.indexOf('este') >= 0) return 'este';
    if (s.indexOf('suerte') >= 0) return 'suerte';
    return s.trim();
  }
  var LOC_LABEL = { suerte: 'Suerte', este: 'Este', toti: 'Bar Toti' };
  // Equipment statuses that mean "fine" — not worth surfacing as a flag.
  var NORMAL_EQ_STATUS = { operational: 1, ok: 1, active: 1, healthy: 1, online: 1, working: 1, good: 1 };
  function locLabel(k) { return LOC_LABEL[k] || (k ? k[0].toUpperCase() + k.slice(1) : ''); }

  function detectLoc(q) {
    q = String(q || '').toLowerCase();
    if (/\bbar\s*toti\b|\btoti\b/.test(q)) return 'toti';
    if (/\beste\b/.test(q)) return 'este';
    if (/\bsuerte\b/.test(q)) return 'suerte';
    return null;
  }

  // ── The router. Deterministic, cheap, no model. Which faculties wake. ─────
  var DOMAIN_RX = {
    work: /\b(broke|broken|break|repair|repairs|fix|fixed|fixing|work\s?orders?|workorders?|ticket|tickets|issue|issues|problem|problems|\bdown\b|not\s+working|doesn'?t\s+work|out\s+of\s+order|leak|leaking|pending|outstanding|to.?do|todo|what'?s\s+wrong|needs?\s+(?:fix|repair|attention))\b/i,
    equipment: /\b(equipment|machine|fridge|refrigerat\w*|freezer|walk.?in|walkin|hood|oven|range|dishwasher|dish.?machine|compressor|ice\s*machine|ice\s*maker|chiller|glycol|serial|model\s*(?:number|#)?|warranty|\bpm\b|preventive|maintenance|serviced?|last\s+service|health\s*score)\b/i,
    ordering: /\b(order|orders|ordered|ordering|deliver\w*|invoice\w*|purchas\w*|\bpar\b|\bpars\b|\bsku\b|produce|supplier|supply|stock|reorder|restock|order\s*guide)\b/i,
    cleaning: /\b(clean|cleaning|cleaned|sanitiz\w*|\bmop\b|sweep|deep.?clean|scrub|dishpit|sidework)\b/i,
    vendors: /\b(vendor|vendors|contractor|contractors|plumber|plumbing|electrician|electrical|hvac|refrigeration\s+(?:tech|company)|technician|company|who\s+(?:do|should|can)\s+(?:we|i)\s+call|phone\s*(?:number)?|contact|reach\s+out)\b/i,
  };

  // Trade → how it shows up in the vendors table, for "who do we call for X".
  var TRADE_RX = /\b(plumb\w*|electric\w*|hvac|refrigerat\w*|glycol|gas|fire|hood|grease|pest|lock\w*|glass|applian\w*|handyman|general|equipment\s+repair)\b/gi;
  // Equipment nouns worth an ilike search when the question names one.
  var EQ_TERMS = ['walk-in', 'walkin', 'walk in', 'reach-in', 'reach in', 'freezer', 'fridge', 'refrigerator', 'cooler',
    'ice machine', 'ice maker', 'ice', 'hood', 'oven', 'range', 'grill', 'fryer', 'dishwasher', 'dish machine',
    'compressor', 'chiller', 'glycol', 'espresso', 'boiler', 'water heater', 'hvac', 'ac', 'mini split', 'kegerator', 'draft'];

  function classify(question) {
    var q = String(question || '');
    var domains = [];
    Object.keys(DOMAIN_RX).forEach(function (d) { if (DOMAIN_RX[d].test(q)) domains.push(d); });
    // "work order(s)" contains "order" — but it's the repair board he means,
    // not a produce delivery. Don't wake the supplier-orders faculty for it.
    if (/work\s?orders?|workorders?/i.test(q) && domains.indexOf('work') >= 0) {
      domains = domains.filter(function (d) { return d !== 'ordering'; });
    }
    return { domains: domains, location: detectLoc(q) };
  }

  // ── isReport(): is this chat line a REPORT of something broken/needed? ────
  // Not a build/insert itself — just the perception that his hand MIGHT offer
  // to log a work order (the confirm UI in clippy.js is the conscience). We are
  // deliberately conservative: a question is never a report; only 'work' or
  // 'equipment' lines qualify; and it must actually ASSERT a fault or a need.
  var REPORT_ASSERT_RX = /\b(broke|broken|down|out|leak(?:s|ing|ed)?|not\s+working|dead|failing|busted|jammed|stuck|tripped|off)\b/i;
  var REPORT_NEED_RX = /\bneeds?\s+(?:fix(?:ing|ed)?|repair(?:s|ed|ing)?|replace(?:d|ment)?|attention|servic(?:e|ing|ed))\b/i;
  function isReport(question) {
    var q = String(question || '').trim();
    if (!q) return false;
    // Interrogative openings are asking, not reporting — never a report.
    if (/^\s*(?:what|which|where|when|who|how|is|are|do|does|did|can|could|any|show|list|tell)\b/i.test(q)) return false;
    // Only the two faculties a work order belongs to.
    var d = classify(q).domains;
    if (d.indexOf('work') < 0 && d.indexOf('equipment') < 0) return false;
    // Must assert a broken thing OR a stated need.
    return REPORT_ASSERT_RX.test(q) || REPORT_NEED_RX.test(q);
  }

  function sbClient() {
    var n = window.NX || NX;
    return (n && n.sb) || null;
  }

  // supabase-js RESOLVES with {error}; a try/catch is a dead catch. Always
  // destructure. These helpers return [] on any failure so grounding degrades
  // to "he guesses" instead of "chat breaks".
  async function q(builderFn) {
    try {
      var res = await builderFn();
      if (!res || res.error) return [];
      return res.data || [];
    } catch (_) { return []; }
  }

  function fmtDate(d) {
    if (!d) return '';
    var s = String(d).slice(0, 10);
    return s;
  }
  function ago(ts) {
    if (!ts) return '';
    var t = Date.parse(ts); if (isNaN(t)) return '';
    var days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return '1d';
    if (days < 30) return days + 'd';
    var mo = Math.floor(days / 30);
    return mo + 'mo';
  }

  // ── Perceivers. Each returns { lines:[...], truncated:bool } or null. ─────

  async function perceiveWork(loc) {
    var sb = sbClient(); if (!sb) return null;
    var tickets = await q(function () {
      return sb.from('tickets')
        .select('id,title,notes,location,status,priority,created_at,equipment_id')
        .eq('status', 'open').order('created_at', { ascending: false }).limit(25);
    });
    var issues = await q(function () {
      return sb.from('equipment_issues')
        .select('id,title,status,priority,severity,reported_at,equipment_id')
        .neq('status', 'repaired').order('reported_at', { ascending: false }).limit(15);
    });
    var cards = await q(function () {
      return sb.from('kanban_cards')
        .select('id,title,column_name,status,location,priority,created_at')
        .neq('column_name', 'done').eq('is_deleted', false).eq('is_archived', false)
        .order('created_at', { ascending: false }).limit(25);
    });
    tickets = tickets.filter(function (t) { return !t.is_deleted && (!loc || locNorm(t.location) === loc); });
    cards = cards.filter(function (c) { return (c.status !== 'closed') && (!loc || locNorm(c.location) === loc); });

    var lines = [];
    tickets.slice(0, 10).forEach(function (t) {
      var p = t.priority && t.priority !== 'normal' ? ' [' + t.priority + ']' : '';
      lines.push('• #' + t.id + ' ' + (t.title || t.notes || 'untitled').slice(0, 60) +
        ' — ' + locLabel(locNorm(t.location)) + p + ' · open ' + ago(t.created_at));
    });
    issues.slice(0, 6).forEach(function (i) {
      lines.push('• equip-issue: ' + (i.title || 'issue').slice(0, 60) + ' — ' + (i.status || '') +
        (i.priority ? ' [' + i.priority + ']' : '') + ' · ' + ago(i.reported_at));
    });
    // Board cards that aren't already mirrored as tickets (avoid dupes by title).
    var seen = {}; tickets.forEach(function (t) { seen[(t.title || '').toLowerCase().trim()] = 1; });
    cards.slice(0, 8).forEach(function (c) {
      if (seen[(c.title || '').toLowerCase().trim()]) return;
      lines.push('• board: ' + (c.title || 'card').slice(0, 60) + ' — ' + locLabel(locNorm(c.location)) +
        ' · ' + (c.column_name || c.status || 'active'));
    });
    if (!lines.length) return { lines: ['(no open work orders' + (loc ? ' at ' + locLabel(loc) : '') + ' right now)'], empty: true };
    return { lines: lines };
  }

  async function perceiveEquipment(loc, question) {
    var sb = sbClient(); if (!sb) return null;
    var ql = String(question || '').toLowerCase();
    var term = null;
    for (var i = 0; i < EQ_TERMS.length; i++) { if (ql.indexOf(EQ_TERMS[i]) >= 0) { term = EQ_TERMS[i]; break; } }
    var sel = 'id,name,location,area,category,status,status_note,manufacturer,model,serial_number,health_score,last_pm_date,next_pm_date,service_contractor_name';
    var rows;
    if (term) {
      var like = '%' + term.replace(/[-\s]/g, '%') + '%';
      rows = await q(function () {
        return sb.from('equipment').select(sel).eq('is_deleted', false).ilike('name', like).limit(12);
      });
    } else {
      rows = await q(function () {
        return sb.from('equipment').select(sel).eq('is_deleted', false)
          .order('next_pm_date', { ascending: true, nullsFirst: false }).limit(40);
      });
    }
    if (loc) rows = rows.filter(function (r) { return locNorm(r.location) === loc; });
    if (!rows.length) return null;
    var lines = [];
    rows.slice(0, term ? 10 : 12).forEach(function (r) {
      var bits = [locLabel(locNorm(r.location))];
      if (r.area) bits.push(r.area);
      var head = (r.name || 'equipment').slice(0, 48) + ' (' + bits.join(' · ') + ')';
      var tail = [];
      if (r.manufacturer || r.model) tail.push(((r.manufacturer || '') + ' ' + (r.model || '')).trim());
      if (r.status && !NORMAL_EQ_STATUS[String(r.status).toLowerCase()]) tail.push('status: ' + r.status + (r.status_note ? ' — ' + String(r.status_note).slice(0, 40) : ''));
      if (r.health_score != null) tail.push('health ' + r.health_score);
      if (r.last_pm_date) tail.push('last PM ' + fmtDate(r.last_pm_date));
      if (r.next_pm_date) tail.push('next PM ' + fmtDate(r.next_pm_date));
      if (r.serial_number && term) tail.push('S/N ' + r.serial_number);
      if (r.service_contractor_name) tail.push('services: ' + r.service_contractor_name);
      lines.push('• ' + head + (tail.length ? ' — ' + tail.filter(Boolean).join(' · ') : ''));
    });
    return { lines: lines, note: term ? ('matching "' + term + '"') : null };
  }

  async function perceiveOrdering(loc) {
    var sb = sbClient(); if (!sb) return null;
    var orders = await q(function () {
      return sb.from('orders').select('id,location,delivery_date,status,vendor_id,created_at')
        .in('status', ['draft', 'sent']).order('created_at', { ascending: false }).limit(15);
    });
    if (loc) orders = orders.filter(function (o) { return locNorm(o.location) === loc; });
    var vmap = {};
    var vids = orders.map(function (o) { return o.vendor_id; }).filter(Boolean);
    if (vids.length) {
      var vends = await q(function () { return sb.from('order_vendors').select('id,name,alias_short').in('id', vids); });
      vends.forEach(function (v) { vmap[v.id] = v.alias_short || v.name; });
    }
    if (!orders.length) return { lines: ['(no open/draft orders' + (loc ? ' at ' + locLabel(loc) : '') + ')'], empty: true };
    var lines = [];
    orders.slice(0, 10).forEach(function (o) {
      lines.push('• ' + (vmap[o.vendor_id] || 'order') + ' — ' + locLabel(locNorm(o.location)) +
        ' · ' + (o.status || '') + (o.delivery_date ? ' · deliver ' + fmtDate(o.delivery_date) : '') +
        ' · placed ' + ago(o.created_at));
    });
    return { lines: lines };
  }

  async function perceiveCleaning(loc) {
    var sb = sbClient(); if (!sb) return null;
    var rows = await q(function () {
      return sb.from('cleaning_tasks').select('id,location,section_en,name_en,frequency_type,frequency_days')
        .eq('archived', false).limit(400);
    });
    if (loc) rows = rows.filter(function (r) { return locNorm(r.location) === loc; });
    if (!rows.length) return null;
    // Summarise: count per section, a few task names.
    var bySection = {};
    rows.forEach(function (r) {
      var k = (r.section_en || 'general');
      (bySection[k] = bySection[k] || []).push(r.name_en || '');
    });
    var lines = [];
    if (loc) {
      lines.push('• ' + locLabel(loc) + ': ' + rows.length + ' active cleaning tasks across ' + Object.keys(bySection).length + ' sections');
      Object.keys(bySection).slice(0, 8).forEach(function (s) {
        lines.push('  · ' + s + ' (' + bySection[s].length + '): ' + bySection[s].slice(0, 4).filter(Boolean).join(', '));
      });
    } else {
      ['suerte', 'este', 'toti'].forEach(function (L) {
        var n = rows.filter(function (r) { return locNorm(r.location) === L; }).length;
        if (n) lines.push('• ' + locLabel(L) + ': ' + n + ' active cleaning tasks');
      });
    }
    return { lines: lines };
  }

  async function perceiveVendors(loc, question) {
    var sb = sbClient(); if (!sb) return null;
    var ql = String(question || '').toLowerCase();
    var trades = (ql.match(TRADE_RX) || []).map(function (s) { return s.toLowerCase(); });
    var rows = await q(function () {
      return sb.from('vendors').select('name,company,category,phone,contact_name,is_preferred,is_emergency,restaurants,active')
        .eq('active', true).limit(60);
    });
    if (!rows.length) return null;
    var filtered = rows;
    if (trades.length) {
      filtered = rows.filter(function (v) {
        var hay = ((v.category || '') + ' ' + (v.company || '') + ' ' + (v.name || '')).toLowerCase();
        return trades.some(function (t) { return hay.indexOf(t.slice(0, 5)) >= 0; });
      });
      if (!filtered.length) filtered = rows; // no trade match — show the roster
    }
    filtered.sort(function (a, b) { return (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0); });
    var lines = [];
    filtered.slice(0, 10).forEach(function (v) {
      var tag = [];
      if (v.is_preferred) tag.push('preferred');
      if (v.is_emergency) tag.push('emergency');
      lines.push('• ' + (v.name || v.company || 'vendor') + (v.category ? ' — ' + v.category : '') +
        (v.phone ? ' · ' + v.phone : '') + (tag.length ? ' · ' + tag.join('/') : ''));
    });
    return { lines: lines, note: trades.length ? ('for ' + trades.join('/')) : null };
  }

  var PERCEIVERS = {
    work: { title: 'OPEN WORK', fn: perceiveWork },
    equipment: { title: 'EQUIPMENT', fn: perceiveEquipment },
    ordering: { title: 'ORDERS', fn: perceiveOrdering },
    cleaning: { title: 'CLEANING', fn: perceiveCleaning },
    vendors: { title: 'VENDORS', fn: perceiveVendors },
  };

  // ── ground(): the whole faculty. classify → perceive → recall → brief. ────
  async function ground(question, opts) {
    opts = opts || {};
    try {
      if (!sbClient()) return { brief: null, domains: [], hits: 0 };
      var c = classify(question);
      // WALK WITH ME (clippy-buddy.js): while Alfredo walks a house, every
      // grounded answer wears it — his tap outranks keyword detection.
      // Normalize: perceivers speak location KEYS ('suerte'), the scope
      // global carries the display label ('Suerte').
      var loc = (typeof window !== 'undefined' && window._NX_HOUSE_SCOPE)
        ? locNorm(window._NX_HOUSE_SCOPE)
        : c.location;
      // Perceivers (live records) and MONETA MIND (semantic memory) run
      // concurrently. Memory can carry a brief alone — recall by meaning
      // catches what keyword domain classification misses.
      var perceiverWork = c.domains.length
        ? Promise.all(c.domains.map(function (d) {
            var P = PERCEIVERS[d]; if (!P) return null;
            return Promise.resolve(P.fn(loc, question)).then(function (r) { return { d: d, r: r }; }).catch(function () { return null; });
          }))
        : Promise.resolve([]);
      var NXR = (typeof NX !== 'undefined' && NX) ? NX : window.NX;
      // 0.78 floor: gte-small cosines run high on this corpus (~0.78-0.83
      // for genuinely related nodes) — only near matches may enter the chat.
      var memoryWork = (NXR && NXR.moneta && String(question || '').length >= 6)
        ? NXR.moneta.recall(question, { k: 3, minSimilarity: 0.78 }).catch(function () { return []; })
        : Promise.resolve([]);
      var both = await Promise.all([perceiverWork, memoryWork]);
      var results = both[0] || [];
      var memories = both[1] || [];
      var sections = [], hits = 0;
      results.forEach(function (x) {
        if (!x || !x.r || !x.r.lines || !x.r.lines.length) return;
        if (!x.r.empty) hits += x.r.lines.length;
        var P = PERCEIVERS[x.d];
        var head = P.title + (x.r.note ? ' (' + x.r.note + ')' : '') + (loc && x.d !== 'vendors' && x.d !== 'cleaning' ? ' · ' + locLabel(loc) : '') + ':';
        sections.push(head + '\n' + x.r.lines.join('\n'));
      });
      if (memories.length) {
        hits += memories.length;
        sections.push('MONETA MEMORY · what the galaxy remembers (by meaning):\n' +
          memories.map(function (m) {
            return '• ' + (m.name || 'memory') + ' — ' + String(m.notes || '').replace(/\s+/g, ' ').slice(0, 170);
          }).join('\n'));
      }
      if (!sections.length) return { brief: null, domains: c.domains, hits: 0 };
      var now = new Date();
      var stamp = now.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var brief =
        '━━ NEXUS LIVE STATE · what MENS sees right now (' + stamp + ' CT) ━━\n' +
        'These are REAL current records from the database. Answer from them exactly — ' +
        'names, numbers, counts. If the answer is not here, say you don\'t see it in the ' +
        'system rather than inventing one. Do not read these facts aloud like a report; ' +
        'answer the actual question, grounded in them.\n\n' +
        sections.join('\n\n');
      // Keep context lean.
      if (brief.length > 2400) brief = brief.slice(0, 2380) + '\n…(more in NEXUS)';
      return { brief: brief, domains: c.domains, hits: hits };
    } catch (e) {
      return { brief: null, domains: [], hits: 0 };
    }
  }

  NX.clippyMens = {
    ground: ground,
    classify: classify,
    isReport: isReport,
    _locNorm: locNorm,
    _perceivers: PERCEIVERS,
  };
  // DUAL-NX: also bind to app.js's lexical global so bare `NX.clippyMens`
  // resolves there too (the Lexical-NX trap — see steward digest).
  try { if (LEX && LEX !== NX) LEX.clippyMens = NX.clippyMens; } catch (_) {}
})(typeof NX !== 'undefined' ? NX : null);
