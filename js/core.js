/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · core
   ─────────────────────────────────────────────────────────────────────
   Single source of truth for the NXRM namespace. Other modules in the
   nexus-rm package assume this file loaded first and expose:

     NXRM.fmt        — formatters (currency, age, dates, hours)
     NXRM.esc        — HTML escaper
     NXRM.score      — urgency / vendor grade / health score
     NXRM.csv        — CSV export utilities
     NXRM.brain      — AI tool registry + register helper
     NXRM.kb         — keyboard shortcut router
     NXRM.realtime   — Supabase channel subscribe helpers
     NXRM.view       — view container helpers
     NXRM.notify     — Trajan bubble + toast (graceful no-op if absent)

   Nothing in this file renders anything. It is plumbing.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const NXRM = window.NXRM = window.NXRM || {};
  NXRM.version = '1.0.0';

  // ─────────────────────────────────────────────────────────────────────
  // FORMATTERS — small, predictable, allocation-free where possible
  // ─────────────────────────────────────────────────────────────────────

  const fmt = NXRM.fmt = {
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
    money(n, fallback) {
      if (n == null || n === '') return fallback != null ? fallback : '$0';
      return '$' + (Number(n) || 0).toLocaleString('en-US', {
        minimumFractionDigits: 0, maximumFractionDigits: 0,
      });
    },
    moneyOrDash(n) { return n == null || n === '' ? '—' : fmt.money(n); },
    age(hours) {
      if (hours == null) return '—';
      if (hours < 1)  return Math.round(hours * 60) + 'm';
      if (hours < 24) return Math.round(hours) + 'h';
      const days = Math.floor(hours / 24);
      if (days < 14) return days + 'd';
      return Math.floor(days / 7) + 'wk';
    },
    hours(h) {
      if (h == null) return '—';
      if (h < 1)  return Math.round(h * 60) + 'm';
      if (h < 24) return Math.round(h * 10) / 10 + 'h';
      return Math.round(h / 24 * 10) / 10 + 'd';
    },
    days(d) {
      if (d == null) return '—';
      if (d < 0)  return Math.abs(Math.round(d)) + 'd overdue';
      if (d < 1)  return 'today';
      if (d < 2)  return 'tomorrow';
      if (d < 14) return 'in ' + Math.round(d) + ' days';
      return 'in ' + Math.round(d / 7) + ' weeks';
    },
    date(ts) {
      if (!ts) return '—';
      return new Date(ts).toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric' });
    },
    timestamp(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      const sameDay = d.toDateString() === new Date().toDateString();
      if (sameDay) {
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
             ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    },
    sinceWords(ts) {
      if (!ts) return 'never';
      const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
      if (days < 1)  return 'today';
      if (days < 7)  return days + 'd ago';
      if (days < 60) return Math.floor(days / 7) + 'w ago';
      return Math.floor(days / 30) + 'mo ago';
    },
    ymd() {
      return new Date().toISOString().slice(0, 10);
    },
  };
  NXRM.esc = fmt.esc;

  // ─────────────────────────────────────────────────────────────────────
  // STATUS + PRIORITY METADATA — used by inbox, brief, detail
  // ─────────────────────────────────────────────────────────────────────

  NXRM.STATUS = {
    reported:           { label: 'Reported',          tone: 'tone-warn',  glyph: '🔴' },
    contractor_called:  { label: 'Contractor Called', tone: 'tone-info',  glyph: '📞' },
    eta_set:            { label: 'ETA Set',           tone: 'tone-info',  glyph: '⏱'  },
    awaiting_quote:     { label: 'Awaiting Quote',    tone: 'tone-warn',  glyph: '💰' },
    quote_approved:     { label: 'Quote Approved',    tone: 'tone-ok',    glyph: '✓'  },
    in_progress:        { label: 'In Progress',       tone: 'tone-info',  glyph: '🔧' },
    awaiting_parts:     { label: 'Awaiting Parts',    tone: 'tone-warn',  glyph: '📦' },
    repaired:           { label: 'Repaired',          tone: 'tone-ok',    glyph: '✅' },
    awaiting_invoice:   { label: 'Awaiting Invoice',  tone: 'tone-warn',  glyph: '🧾' },
    invoice_paid:       { label: 'Paid',              tone: 'tone-ok',    glyph: '💵' },
    closed:             { label: 'Closed',            tone: 'tone-mute',  glyph: '🗄'  },
    cancelled:          { label: 'Cancelled',         tone: 'tone-mute',  glyph: '✗'  },
  };

  NXRM.PRIORITY = {
    critical: { label: 'Critical', tone: 'tone-critical', weight: 4 },
    high:     { label: 'High',     tone: 'tone-high',     weight: 3 },
    normal:   { label: 'Normal',   tone: 'tone-normal',   weight: 2 },
    low:      { label: 'Low',      tone: 'tone-low',      weight: 1 },
  };

  NXRM.URGENCY = {
    overdue:  { label: 'Overdue',  tone: 'tone-critical', weight: 4, glyph: '🔴' },
    due_soon: { label: 'Due Soon', tone: 'tone-warn',     weight: 3, glyph: '🟠' },
    upcoming: { label: 'Upcoming', tone: 'tone-info',     weight: 2, glyph: '🟡' },
    distant:  { label: 'Distant',  tone: 'tone-mute',     weight: 1, glyph: '⚪' },
  };

  // ─────────────────────────────────────────────────────────────────────
  // SCORING — urgency, vendor grade, equipment health
  // ─────────────────────────────────────────────────────────────────────

  NXRM.score = {
    urgency(issue) {
      const pri = NXRM.PRIORITY[issue.priority] || NXRM.PRIORITY.normal;
      let s = pri.weight * 10;
      s += Math.min(issue.age_hours || 0, 168) / 24;
      if (issue.awaiting_quote_approval)   s += 25;
      if (issue.awaiting_invoice_payment)  s += 15;
      if (issue.status === 'reported' && issue.age_hours > 24) s += 30;
      return s;
    },
    vendorGrade(v) {
      const completed = Number(v.completed_jobs) || 0;
      const total     = Number(v.total_jobs) || 0;
      const resp      = Number(v.avg_response_hours);
      const ttf       = Number(v.avg_time_to_fix_hours);

      if (total < 2) return { letter: '—', tone: 'tone-mute', label: 'New' };

      let s = 0;
      if (total > 0) s += (completed / total) * 40;
      if (resp != null && !isNaN(resp) && resp > 0) {
        if (resp < 4)       s += 30;
        else if (resp < 24) s += 25;
        else if (resp < 48) s += 18;
        else if (resp < 72) s += 10;
        else                s += 5;
      } else s += 15;
      if (ttf != null && !isNaN(ttf) && ttf > 0) {
        if (ttf < 8)        s += 30;
        else if (ttf < 24)  s += 25;
        else if (ttf < 72)  s += 18;
        else                s += 10;
      } else s += 15;

      if (s >= 85) return { letter: 'A', tone: 'tone-ok',       label: 'Excellent' };
      if (s >= 70) return { letter: 'B', tone: 'tone-good',     label: 'Good' };
      if (s >= 55) return { letter: 'C', tone: 'tone-warn',     label: 'OK' };
      if (s >= 40) return { letter: 'D', tone: 'tone-warn',     label: 'Below avg' };
      return                    { letter: 'F', tone: 'tone-critical', label: 'Poor' };
    },
    health(eq, opts) {
      const o = opts || {};
      const ctx = {
        age_years:           o.age_years           ?? null,
        expected_life_years: o.expected_life_years ?? 10,
        purchase_price:      Number(o.purchase_price ?? eq.purchase_price) || 0,
        spend_ytd:           Number(o.spend_ytd    ?? eq.spend_ytd) || 0,
        open_issues:         Number(o.open_issues  ?? eq.open_issues_count) || 0,
        total_downtime_hours: Number(o.total_downtime_hours ?? eq.total_downtime_hours) || 0,
        issues_this_year:    Number(o.issues_this_year ?? 0),
      };
      let score = 100;
      const factors = [];
      if (ctx.age_years != null && ctx.expected_life_years > 0) {
        const p = Math.min(30, Math.round((ctx.age_years / ctx.expected_life_years) * 30));
        score -= p;
        if (p > 0) factors.push({ name: 'age', impact: -p });
      }
      if (ctx.purchase_price > 0) {
        const p = Math.min(40, Math.round((ctx.spend_ytd / ctx.purchase_price) * 100));
        score -= p;
        if (p > 0) factors.push({ name: 'spend_ratio', impact: -p });
      }
      if (ctx.issues_this_year > 0) {
        const p = Math.min(20, ctx.issues_this_year * 4);
        score -= p; factors.push({ name: 'issue_frequency', impact: -p });
      }
      if (ctx.open_issues > 0) {
        const p = Math.min(15, ctx.open_issues * 5);
        score -= p; factors.push({ name: 'open_issues', impact: -p });
      }
      if (ctx.total_downtime_hours > 24) {
        const p = Math.min(15, Math.floor(ctx.total_downtime_hours / 24));
        score -= p; factors.push({ name: 'downtime', impact: -p });
      }
      score = Math.max(0, Math.min(100, Math.round(score)));
      let grade, color, label;
      if (score >= 85)      { grade = 'A'; color = '#6cd09a'; label = 'Healthy'; }
      else if (score >= 70) { grade = 'B'; color = '#a8d870'; label = 'Good'; }
      else if (score >= 55) { grade = 'C'; color = '#ffc870'; label = 'Watch'; }
      else if (score >= 40) { grade = 'D'; color = '#ff9c78'; label = 'Concerning'; }
      else                  { grade = 'F'; color = '#ff7088'; label = 'Replace soon'; }
      return { score, grade, color, label, factors };
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // CSV — export utilities for tax / insurance / 1099 / records
  // ─────────────────────────────────────────────────────────────────────

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  NXRM.csv = {
    toCsv(headers, rows) {
      return [headers.map(csvEscape).join(','),
              ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
    },
    download(filename, csv) {
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    },
    async issues(opts) {
      if (!NX?.sb) return;
      const options = opts || {};
      let q = NX.sb.from('v_issue_summary').select('*');
      if (options.openOnly)   q = q.eq('is_open', true);
      if (options.restaurant) q = q.eq('restaurant', options.restaurant);
      const { data, error } = await q.order('reported_at', { ascending: false }).limit(2000);
      if (error) { alert('Export failed: ' + error.message); return; }
      const headers = [
        'Issue ID', 'Title', 'Status', 'Priority', 'Equipment', 'Restaurant', 'Category',
        'Reported By', 'Reported At', 'Contractor Company',
        'Contractor Called At', 'ETA Set At', 'In Progress At', 'Awaiting Parts At', 'Repaired At',
        'Quote Amount', 'Quote Received At', 'Quote Approved At',
        'Invoice Amount', 'Invoice Received At', 'Invoice Paid At',
        'Total Cost', 'Downtime Hours',
      ];
      const rows = (data || []).map(i => [
        i.id, i.title, i.status, i.priority,
        i.equipment_name, i.restaurant, i.equipment_category,
        i.reported_by_name, i.reported_at, i.contractor_company,
        i.contractor_called_at, i.eta_set_at, i.in_progress_at, i.awaiting_parts_at, i.repaired_at,
        i.quote_amount, i.quote_received_at, i.quote_approved_at,
        i.invoice_amount, i.invoice_received_at, i.invoice_paid_at,
        i.total_cost, i.downtime_hours,
      ]);
      NXRM.csv.download(`nexus-issues-${fmt.ymd()}.csv`, NXRM.csv.toCsv(headers, rows));
    },
    async spend() {
      if (!NX?.sb) return;
      const { data, error } = await NX.sb.from('v_spend_rollup').select('*');
      if (error) { alert('Export failed: ' + error.message); return; }
      const headers = [
        'Equipment', 'Restaurant', 'Category', 'Purchase Price',
        'Spend YTD', 'Spend MTD', 'Total Spend (Lifetime)',
        'Paid Issues', 'Open Issues', 'Total Downtime (hours)', 'Repair-vs-Replace Flagged',
      ];
      const rows = (data || []).map(r => [
        r.equipment_name, r.restaurant, r.equipment_category, r.purchase_price,
        r.spend_ytd, r.spend_mtd, r.total_spend,
        r.paid_issues_count, r.open_issues_count, r.total_downtime_hours,
        r.repair_vs_replace_flag ? 'YES' : 'no',
      ]);
      NXRM.csv.download(`nexus-spend-${fmt.ymd()}.csv`, NXRM.csv.toCsv(headers, rows));
    },
    async vendors() {
      if (!NX?.sb) return;
      try {
        const { data, error } = await NX.sb.from('v_vendor_performance').select('*');
        if (error) throw error;
        const headers = [
          'Vendor', 'Category', 'Phone', 'Email', 'Preferred', 'Emergency',
          'Total Jobs', 'Completed', 'Active', 'Total Spend',
          'Avg Response (hours)', 'Avg Time-to-Fix (hours)',
          'Equipment Touched', 'Last Job At',
        ];
        const rows = (data || []).map(v => [
          v.display_name, v.category, v.phone, v.email,
          v.is_preferred ? 'YES' : 'no', v.is_emergency ? 'YES' : 'no',
          v.total_jobs, v.completed_jobs, v.active_jobs, v.total_spend,
          v.avg_response_hours, v.avg_time_to_fix_hours,
          v.equipment_serviced_count, v.last_job_at,
        ]);
        NXRM.csv.download(`nexus-vendors-${fmt.ymd()}.csv`, NXRM.csv.toCsv(headers, rows));
      } catch (e) { alert('Export failed: ' + e.message); }
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // BRAIN — AI tool registry
  // ─────────────────────────────────────────────────────────────────────

  const brainTools = {};
  NXRM.brain = {
    register(tool) {
      if (!tool || !tool.name) return;
      brainTools[tool.name] = tool;
      if (window.NX) {
        NX.brain = NX.brain || {};
        NX.brain.tools = NX.brain.tools || {};
        NX.brain.tools[tool.name] = tool;
      }
      window.NX_AI_TOOLS = window.NX_AI_TOOLS || [];
      if (!window.NX_AI_TOOLS.find(t => t.name === tool.name)) {
        window.NX_AI_TOOLS.push(tool);
      }
    },
    list() { return Object.values(brainTools); },
    get(name) { return brainTools[name]; },
    async run(name, args) {
      const t = brainTools[name];
      if (!t) return { error: 'Unknown tool: ' + name };
      try { return await t.run(args || {}); }
      catch (e) { return { error: e.message || String(e) }; }
    },
  };

  // Register core tools immediately. Other modules register theirs on init.
  NXRM.brain.register({
    name: 'get_open_issues',
    description:
      'Returns currently-open work orders. Optional filters: restaurant, priority, equipment_id.',
    params: {
      restaurant:   { type: 'string', optional: true },
      priority:     { type: 'string', optional: true },
      equipment_id: { type: 'string', optional: true },
      limit:        { type: 'number', optional: true },
    },
    run: async (args) => {
      if (!NX?.sb) return { error: 'No Supabase client' };
      let q = NX.sb.from('v_issue_summary').select('*').eq('is_open', true);
      if (args.restaurant)   q = q.eq('restaurant', args.restaurant);
      if (args.priority)     q = q.eq('priority', args.priority);
      if (args.equipment_id) q = q.eq('equipment_id', args.equipment_id);
      const { data, error } = await q.order('reported_at', { ascending: false })
        .limit(Math.min(args.limit || 25, 100));
      if (error) return { error: error.message };
      return {
        count: data.length,
        issues: data.map(i => ({
          id: i.id, title: i.title, status: i.status, priority: i.priority,
          equipment: i.equipment_name, restaurant: i.restaurant,
          contractor: i.contractor_company,
          age_hours: Math.round(i.age_hours || 0),
          quote_amount: i.quote_amount, invoice_amount: i.invoice_amount,
          awaiting_quote_approval: i.awaiting_quote_approval,
          awaiting_invoice_payment: i.awaiting_invoice_payment,
        })),
      };
    },
  });

  NXRM.brain.register({
    name: 'get_overdue_quotes',
    description: 'Quotes received but not approved/rejected. Money decisions waiting on you.',
    params: {},
    run: async () => {
      if (!NX?.sb) return { error: 'No Supabase client' };
      const { data, error } = await NX.sb.from('v_issue_summary').select('*')
        .eq('awaiting_quote_approval', true).order('quote_received_at', { ascending: true });
      if (error) return { error: error.message };
      return {
        count: data.length,
        total_pending: data.reduce((s, i) => s + (Number(i.quote_amount) || 0), 0),
        quotes: data.map(i => ({
          id: i.id, title: i.title, equipment: i.equipment_name, restaurant: i.restaurant,
          quote_amount: i.quote_amount, quote_url: i.quote_url,
          quote_received_at: i.quote_received_at, contractor: i.contractor_company,
          days_pending: Math.floor((Date.now() - new Date(i.quote_received_at).getTime()) / 86400000),
        })),
      };
    },
  });

  NXRM.brain.register({
    name: 'get_unpaid_invoices',
    description: 'Invoices received but not paid.',
    params: {},
    run: async () => {
      if (!NX?.sb) return { error: 'No Supabase client' };
      const { data, error } = await NX.sb.from('v_issue_summary').select('*')
        .eq('awaiting_invoice_payment', true).order('invoice_received_at', { ascending: true });
      if (error) return { error: error.message };
      return {
        count: data.length,
        total_unpaid: data.reduce((s, i) => s + (Number(i.invoice_amount) || 0), 0),
        invoices: data.map(i => ({
          id: i.id, title: i.title, equipment: i.equipment_name, restaurant: i.restaurant,
          invoice_amount: i.invoice_amount, invoice_url: i.invoice_url,
          invoice_received_at: i.invoice_received_at, contractor: i.contractor_company,
          days_overdue: Math.floor((Date.now() - new Date(i.invoice_received_at).getTime()) / 86400000),
        })),
      };
    },
  });

  NXRM.brain.register({
    name: 'get_total_spend',
    description: 'Total R&M spend for a period (ytd/mtd/all), grouped by restaurant/category/equipment.',
    params: {
      period:   { type: 'string', optional: true },
      group_by: { type: 'string', optional: true },
    },
    run: async (args) => {
      if (!NX?.sb) return { error: 'No Supabase client' };
      const { data, error } = await NX.sb.from('v_spend_rollup').select('*');
      if (error) return { error: error.message };
      const period   = args.period || 'ytd';
      const groupBy  = args.group_by || 'restaurant';
      const field    = period === 'mtd' ? 'spend_mtd' : period === 'all' ? 'total_spend' : 'spend_ytd';
      const gField   = groupBy === 'category' ? 'equipment_category'
                     : groupBy === 'equipment' ? 'equipment_name' : 'restaurant';
      const grouped = {};
      data.forEach(r => {
        const k = r[gField] || '—';
        grouped[k] = (grouped[k] || 0) + (Number(r[field]) || 0);
      });
      const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
      return {
        period, group_by: groupBy,
        total: sorted.reduce((s, [, v]) => s + v, 0),
        breakdown: sorted.map(([k, v]) => ({ name: k, amount: v, display: fmt.money(v) })),
      };
    },
  });

  NXRM.brain.register({
    name: 'get_top_spenders',
    description: 'Top-N most expensive equipment by R&M spend in a period.',
    params: {
      period: { type: 'string', optional: true },
      limit:  { type: 'number', optional: true },
    },
    run: async (args) => {
      if (!NX?.sb) return { error: 'No Supabase client' };
      const period = args.period || 'ytd';
      const field = period === 'mtd' ? 'spend_mtd' : period === 'all' ? 'total_spend' : 'spend_ytd';
      const { data, error } = await NX.sb.from('v_spend_rollup').select('*');
      if (error) return { error: error.message };
      const sorted = (data || [])
        .filter(r => (Number(r[field]) || 0) > 0)
        .sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0))
        .slice(0, args.limit || 5);
      return {
        period,
        top: sorted.map(r => ({
          equipment: r.equipment_name, restaurant: r.restaurant, category: r.equipment_category,
          spend: Number(r[field]) || 0, spend_display: fmt.money(r[field]),
          purchase_price: r.purchase_price,
          pct_of_purchase: r.purchase_price > 0 ? Math.round((Number(r[field]) / r.purchase_price) * 100) : null,
          open_issues: r.open_issues_count, downtime_hours: r.total_downtime_hours,
        })),
      };
    },
  });

  NXRM.brain.register({
    name: 'get_repair_vs_replace',
    description: 'Equipment flagged for replacement (>40% of purchase price spent YTD).',
    params: {},
    run: async () => {
      if (!NX?.sb) return { error: 'No Supabase client' };
      const { data, error } = await NX.sb.from('v_spend_rollup')
        .select('*').eq('repair_vs_replace_flag', true);
      if (error) return { error: error.message };
      return {
        count: data.length,
        flagged: data.map(r => ({
          equipment: r.equipment_name, restaurant: r.restaurant, category: r.equipment_category,
          purchase_price: r.purchase_price,
          spend_ytd: Number(r.spend_ytd) || 0, spend_ytd_display: fmt.money(r.spend_ytd),
          pct_of_purchase: r.purchase_price > 0 ? Math.round((Number(r.spend_ytd) / r.purchase_price) * 100) : null,
        })),
      };
    },
  });

  NXRM.brain.register({
    name: 'get_issue_detail',
    description: 'Full details + comment thread for one work order.',
    params: { issue_id: { type: 'string', required: true } },
    run: async (args) => {
      if (!NX?.sb || !args.issue_id) return { error: 'Missing issue_id' };
      const [{ data: issue }, { data: comments }] = await Promise.all([
        NX.sb.from('v_issue_summary').select('*').eq('id', args.issue_id).maybeSingle(),
        NX.sb.from('equipment_issue_comments').select('*').eq('issue_id', args.issue_id)
          .order('created_at', { ascending: true }),
      ]);
      if (!issue) return { error: 'Issue not found' };
      return {
        issue: {
          id: issue.id, title: issue.title, status: issue.status,
          priority: issue.priority, severity: issue.severity,
          equipment: issue.equipment_name, restaurant: issue.restaurant,
          reported_at: issue.reported_at, reported_by: issue.reported_by_name,
          contractor: issue.contractor_company,
          quote_amount: issue.quote_amount,
          quote_status: issue.quote_received_at
            ? (issue.quote_approved_at ? 'approved'
              : issue.quote_rejected_at ? 'rejected' : 'awaiting_approval')
            : 'not_received',
          invoice_amount: issue.invoice_amount,
          invoice_status: issue.invoice_received_at
            ? (issue.invoice_paid_at ? 'paid' : 'awaiting_payment')
            : 'not_received',
          total_cost: issue.total_cost, downtime_hours: issue.downtime_hours,
        },
        comment_count: comments.length,
        comments: comments.map(c => ({
          author: c.user_name, body: c.body, timestamp: c.created_at,
          is_system: c.is_system_event, attachment_url: c.attachment_url,
        })),
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // REALTIME — channel helpers
  // ─────────────────────────────────────────────────────────────────────

  const channels = {};
  NXRM.realtime = {
    subscribe(name, configs) {
      if (channels[name] || !NX?.sb?.channel) return null;
      try {
        let ch = NX.sb.channel(name);
        configs.forEach(c => {
          ch = ch.on('postgres_changes', c.filter, c.handler);
        });
        ch.subscribe();
        channels[name] = ch;
        return ch;
      } catch (e) {
        console.warn('[NXRM.realtime] subscribe failed', name, e);
        return null;
      }
    },
    unsubscribe(name) {
      const ch = channels[name];
      if (ch) {
        try { NX.sb.removeChannel(ch); } catch (_) {}
        delete channels[name];
      }
    },
    debounce(fn, ms) {
      let t = null;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms || 600); };
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // VIEW — container helpers
  // ─────────────────────────────────────────────────────────────────────

  NXRM.view = {
    ensure(id, dataView) {
      let v = document.getElementById(id);
      if (!v) {
        v = document.createElement('div');
        v.className = 'view';
        v.id = id;
        if (dataView) v.setAttribute('data-view', dataView);
        const main = document.querySelector('.views') || document.body;
        main.appendChild(v);
      }
      return v;
    },
    switchTo(name) {
      if (window.NX?.switchTo) NX.switchTo(name);
    },
    onSwitch(handler) {
      document.addEventListener('nx-view-changed', handler);
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // NOTIFY — Trajan bubble (graceful no-op if orb absent)
  // ─────────────────────────────────────────────────────────────────────

  NXRM.notify = {
    bubble(text, opts) {
      try {
        if (window.clippy?.bubble) window.clippy.bubble(text, opts || {});
      } catch (_) {}
    },
    toast(text) {
      // Lightweight fallback toast in case the orb isn't around
      let t = document.querySelector('.nxrm-toast');
      if (!t) {
        t = document.createElement('div');
        t.className = 'nxrm-toast';
        document.body.appendChild(t);
      }
      t.textContent = text;
      t.classList.add('is-visible');
      clearTimeout(NXRM.notify._toastT);
      NXRM.notify._toastT = setTimeout(() => t.classList.remove('is-visible'), 3000);
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // KEYBOARD — g-prefix navigation + n/?/'/'
  // ─────────────────────────────────────────────────────────────────────

  const ROUTES = {
    'g h': 'home', 'g b': 'brief',  'g i': 'issues',
    'g s': 'spend','g v': 'vendors','g p': 'pm-schedules',
    'g e': 'equipment','g c': 'board',
  };

  let kbBuffer = '';
  let kbTimer = null;
  function resetKb() { kbBuffer = ''; }

  function handleKey(e) {
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();

    if (kbBuffer === '' && k === 'n') {
      e.preventDefault();
      if (window.NXQuickCreate?.open) window.NXQuickCreate.open();
      return;
    }
    if (kbBuffer === '' && k === '?') {
      e.preventDefault();
      NXRM.kb.showHelp();
      return;
    }
    if (kbBuffer === '' && k === '/') {
      e.preventDefault();
      const s = document.querySelector('.nxrm-search, #issuesSearchInput, #vendorsSearch, #pmSearch');
      if (s) s.focus();
      return;
    }

    if (k === 'g' && kbBuffer === '') {
      kbBuffer = 'g';
      clearTimeout(kbTimer);
      kbTimer = setTimeout(resetKb, 1500);
      return;
    }
    if (kbBuffer === 'g') {
      const route = ROUTES['g ' + k];
      if (route) { e.preventDefault(); NXRM.view.switchTo(route); }
      resetKb();
    }
  }

  NXRM.kb = {
    showHelp() {
      const existing = document.getElementById('nxrmShortcutsHelp');
      if (existing) { existing.remove(); return; }
      const ov = document.createElement('div');
      ov.id = 'nxrmShortcutsHelp';
      ov.className = 'nxrm-overlay is-visible';
      ov.innerHTML = `
        <div class="nxrm-card">
          <div class="nxrm-card-head">
            <div class="nxrm-eyebrow">KEYBOARD</div>
            <div class="nxrm-h1">Get around fast</div>
            <button class="nxrm-close" data-close>✕</button>
          </div>
          <div class="nxrm-kb">
            <div class="nxrm-kb-group">
              <div class="nxrm-kb-grouptitle">Navigate</div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>h</kbd><span>Home</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>b</kbd><span>Daily Brief</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>i</kbd><span>Work Orders</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>s</kbd><span>Spend</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>v</kbd><span>Vendors</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>p</kbd><span>PM Schedules</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>e</kbd><span>Equipment</span></div>
              <div class="nxrm-kb-row"><kbd>g</kbd> <kbd>c</kbd><span>Board</span></div>
            </div>
            <div class="nxrm-kb-group">
              <div class="nxrm-kb-grouptitle">Actions</div>
              <div class="nxrm-kb-row"><kbd>n</kbd><span>New work order</span></div>
              <div class="nxrm-kb-row"><kbd>/</kbd><span>Focus search</span></div>
              <div class="nxrm-kb-row"><kbd>?</kbd><span>This help</span></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(ov);
      ov.querySelector('[data-close]').addEventListener('click', () => ov.remove());
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    },
  };

  document.addEventListener('keydown', handleKey);

  // ─────────────────────────────────────────────────────────────────────
  // OVERLAY — modal helper used by quick-create, dispatch, troubleshoot
  // ─────────────────────────────────────────────────────────────────────

  NXRM.overlay = {
    open(html, opts) {
      const ov = document.createElement('div');
      ov.className = 'nxrm-overlay';
      ov.innerHTML = `<div class="nxrm-card${opts?.cardClass ? ' ' + opts.cardClass : ''}">${html}</div>`;
      document.body.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add('is-visible'));
      const close = () => {
        ov.classList.remove('is-visible');
        setTimeout(() => { try { ov.remove(); } catch (_) {} }, 240);
      };
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
      return { el: ov, close };
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // Done. Modules that depend on NXRM can now run.
  // ─────────────────────────────────────────────────────────────────────

  console.log('[NEXUS·R&M] core ready · v' + NXRM.version);
})();
