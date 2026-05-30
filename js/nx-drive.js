/* ════════════════════════════════════════════════════════════════════════
   NEXUS Drive helper — v18.32 Phase 2 (Daily Log upload)
   ════════════════════════════════════════════════════════════════════════
   Wraps the existing OAuth machinery in js/app.js (driveConnect /
   nexus_drive_token / nexus_drive_expiry) and extends scopes from
   'drive.appdata' → 'drive.file' so we can write into Orion's regular
   Drive folder (not the hidden appdata sandbox).

   Approach for Daily Log document generation:
   ─────────────────────────────────────────────
   Build an HTML string from the daily_logs.data JSONB, then upload to
   Drive via the multipart endpoint with metadata
       mimeType: 'application/vnd.google-apps.document'
   Drive auto-converts HTML → Google Doc on upload, preserving headings,
   tables, bold, italic. The result is a clean Google Doc named
   `YYYY-MM-DD Daily Log` in the target folder.

   Why this approach:
   ─────────────────────
   • No Docs API table-index arithmetic (which is the painful part of
     building tables via the Docs API)
   • No external libraries (no docx-js, no JSZip)
   • No Edge Function or service account — everything browser-side
   • No template modification — the original .docx / Google Doc template
     stays untouched. The template defines the visual format spec; this
     module mirrors that format in HTML.
   • Result is a Google Doc (the natural Drive editor) but Orion can
     File → Download → .docx anytime if he wants a literal Word file.

   Token flow:
   ─────────────────────
   Existing driveConnect() granted scope 'drive.appdata' only — that
   scope can only access a hidden per-app folder, NOT the user's
   visible Drive view. For Daily Log we request the broader scope
   'drive.file' (which lets the app write files into folders the user
   has authorized). On first Daily Log submit, the user sees a Google
   consent screen listing the new scope. After that, the same
   nexus_drive_token works for both old (config backup) and new
   (daily log upload) operations.

   We also track which scopes the stored token has, in
   localStorage.nexus_drive_scopes (space-separated). ensureDriveToken
   checks this list; if the stored token doesn't have a required scope,
   we trigger re-auth. Re-auth is silent (single click) — Google
   remembers the previous consent.
   ════════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

// ─── Config ──────────────────────────────────────────────────────────
// Confirmed by Orion in chat:
// https://drive.google.com/drive/folders/1bsE9Hg6ToBufN-2Yq6ZH10NENE_dnOfS
// Future enhancement: move to nexus_config.daily_log_folder_id so this
// can be changed without redeploying code.
const DAILY_LOG_FOLDER_ID = '1bsE9Hg6ToBufN-2Yq6ZH10NENE_dnOfS';

// Scopes required for Daily Log upload (beyond existing drive.appdata)
const DAILY_LOG_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

// Token expires after 1 hour; we treat it as expired 1min early to avoid
// in-flight expiry. Matches the 55min window app.js already uses.
const TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

// ─── Token management ───────────────────────────────────────────────
function getStoredToken() {
  const token = localStorage.getItem('nexus_drive_token');
  const expiry = parseInt(localStorage.getItem('nexus_drive_expiry') || '0', 10);
  const scopesStr = localStorage.getItem('nexus_drive_scopes') || '';
  if (!token) return null;
  if (Date.now() > expiry - TOKEN_SAFETY_MARGIN_MS) return null;
  return {
    token,
    scopes: scopesStr.split(/\s+/).filter(Boolean),
  };
}

function hasRequiredScopes(grantedScopes, requiredScopes) {
  return requiredScopes.every(s => grantedScopes.includes(s));
}

function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    // Reuse existing tag if present
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      // It's loading but not done yet — poll
      const start = Date.now();
      const poll = setInterval(() => {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          clearInterval(poll); resolve();
        } else if (Date.now() - start > 10000) {
          clearInterval(poll); reject(new Error('Google OAuth script load timed out'));
        }
      }, 100);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google OAuth script'));
    document.head.appendChild(s);
  });
}

async function requestNewToken(scopes) {
  const clientId = NX.getGoogleClientId && NX.getGoogleClientId();
  if (!clientId) {
    throw new Error('No Google Client ID configured — set one in Settings → Connect Drive area');
  }
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(' '),
      callback: (r) => {
        if (r.access_token) {
          localStorage.setItem('nexus_drive_token', r.access_token);
          localStorage.setItem('nexus_drive_expiry', String(Date.now() + 55 * 60 * 1000));
          // Track granted scopes — Google's response includes the actual
          // granted scope string, which may be more or less than requested
          localStorage.setItem('nexus_drive_scopes', r.scope || scopes.join(' '));
          resolve(r.access_token);
        } else {
          reject(new Error('Authorization was denied or the popup was closed'));
        }
      },
      error_callback: (e) => {
        reject(new Error('Google OAuth error: ' + (e && e.message ? e.message : 'unknown')));
      }
    });
    tc.requestAccessToken();
  });
}

/**
 * Get a Drive access token with the required scopes.
 * Reuses the cached nexus_drive_token if it has all required scopes
 * and hasn't expired. Otherwise prompts user for re-auth (one click).
 */
async function ensureDriveToken(opts) {
  opts = opts || {};
  const scopes = opts.scopes || DAILY_LOG_SCOPES;
  const stored = getStoredToken();
  if (stored && hasRequiredScopes(stored.scopes, scopes) && !opts.forcePrompt) {
    return stored.token;
  }
  // Need new token (expired, missing scope, or forced)
  // Request UNION of requested + previously-granted scopes so old
  // features (config backup with drive.appdata) keep working after
  // this re-auth.
  const union = new Set(scopes);
  if (stored && stored.scopes) stored.scopes.forEach(s => union.add(s));
  // Always include drive.appdata to preserve config-backup compatibility
  union.add('https://www.googleapis.com/auth/drive.appdata');
  return await requestNewToken(Array.from(union));
}

// ─── HTML generation for the Daily Log ─────────────────────────────
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

const RM_LABELS = {
  hvac: 'HVAC',
  refrigeration: 'Refrigeration',
  cooking: 'Cooking Equipment',
  plumbing: 'Plumbing',
  electrical: 'Electrical / IT / Internet',
  interior: 'Interior',
  landscaping: 'Landscaping / Exterior',
  furniture: 'Furniture',
  restrooms: 'Restrooms',
  safety: 'Safety / Security',
};

const CLEANING_LABELS = {
  attendance:       'Attendance / Coverage',
  performance:      'Performance & Recognition',
  training:         'Training & Assignments',
  requested_tasks:  'Requested Cleaning Tasks (by Mgmt)',
  weekly_tasks:     'Upcoming Weekly Tasks',
  monthly_tasks:    'Upcoming Monthly Tasks',
  quarterly_tasks:  'Upcoming Quarterly Tasks',
};

function friendlyDate(iso) {
  if (!iso) return '';
  // Use noon-time to avoid timezone shifting the date
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

// ─── HTML section renderers ─────────────────────────────────────────
// Drive's HTML → Google Doc converter handles a known subset of HTML.
// What works well: h1/h2/h3, p, b/i/u, table with border/cellpadding,
// br, simple inline styles (background, width, text-align, font-style).
// What doesn't survive: CSS classes, external stylesheets, fancy CSS.
// So we use only inline attributes + basic HTML.

function renderHeaderTable(d) {
  return `
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr><td style="width:35%;background:#f3f3f3;"><b>Date</b></td><td>${esc(d.header.date)}</td></tr>
      <tr><td style="background:#f3f3f3;"><b>Weather</b></td><td>${nl2br(d.header.weather)}</td></tr>
      <tr><td style="background:#f3f3f3;"><b>Significant Events or Disruptions</b></td><td>${nl2br(d.header.significant_events)}</td></tr>
    </table>`;
}

function renderPlanningSection(d) {
  return `
    <h2>Planning</h2>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr><td style="width:35%;background:#f3f3f3;"><b>Tomorrow&rsquo;s Plan</b><br><i style="color:#666;font-size:9pt;">Concrete tasks, appointments, urgent</i></td><td>${nl2br(d.planning.tomorrow_plan)}</td></tr>
      <tr><td style="background:#f3f3f3;"><b>This Week / Farther Out</b><br><i style="color:#666;font-size:9pt;">Projects in flight, things being pushed</i></td><td>${nl2br(d.planning.this_week)}</td></tr>
      <tr><td style="background:#f3f3f3;"><b>Side Notes &amp; Observations</b><br><i style="color:#666;font-size:9pt;">Patterns, conversations, lessons</i></td><td>${nl2br(d.planning.side_notes)}</td></tr>
    </table>`;
}

function renderRMTable(rm) {
  // v18.32 Phase 3a — takes the rm sub-object directly (was the whole
  // location which mixed rm + vendor_calls in one bag).
  const rows = Object.keys(RM_LABELS).map(key => `
    <tr>
      <td style="width:35%;background:#f3f3f3;"><b>${esc(RM_LABELS[key])}</b></td>
      <td>${nl2br((rm && rm[key]) || '')}</td>
    </tr>`).join('');
  return `
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr><th colspan="2" style="background:#d9d9d9;text-align:left;"><b>Repairs &amp; Maintenance</b></th></tr>
      ${rows}
    </table>`;
}

function renderVendorCallsTable(vendor_calls) {
  // v18.32 Phase 3a — takes the vendor_calls array directly
  const calls = (vendor_calls || []).filter(c =>
    c && (c.date || c.vendor || c.equipment || c.issue || c.status)
  );
  const headerRow = `
    <tr><th colspan="5" style="background:#d9d9d9;text-align:left;"><b>Vendor &amp; Service Calls</b></th></tr>
    <tr style="background:#f3f3f3;">
      <th><b>Date Opened</b></th>
      <th><b>Vendor</b></th>
      <th><b>Equipment</b></th>
      <th><b>Issue</b></th>
      <th><b>Status / Next Steps</b></th>
    </tr>`;
  if (!calls.length) {
    return `
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;margin-top:12pt;">
        ${headerRow}
        <tr><td colspan="5" style="font-style:italic;color:#999;">No vendor calls logged.</td></tr>
      </table>`;
  }
  const rows = calls.map(c => `
    <tr>
      <td>${esc(c.date || '')}</td>
      <td>${esc(c.vendor || '')}</td>
      <td>${esc(c.equipment || '')}</td>
      <td>${nl2br(c.issue || '')}</td>
      <td>${nl2br(c.status || '')}</td>
    </tr>`).join('');
  return `
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;margin-top:12pt;">
      ${headerRow}
      ${rows}
    </table>`;
}

function renderLocationSection(loc) {
  // v18.32 Phase 3a — takes a full location object (id, label, rm, vendor_calls)
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">${esc(loc.label)}</h1>
    ${renderRMTable(loc.rm || {})}
    <p>&nbsp;</p>
    ${renderVendorCallsTable(loc.vendor_calls || [])}`;
}

function renderOtherProperties(arr) {
  const filtered = (arr || []).filter(p =>
    p && (p.property_name || p.notes)
  );
  if (!filtered.length) {
    return `
      <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Other Properties</h1>
      <p style="font-style:italic;color:#999;">No other properties logged.</p>`;
  }
  const rows = filtered.map(p => `
    <tr>
      <td style="width:30%;background:#f3f3f3;"><b>${esc(p.property_name || '')}</b></td>
      <td>${nl2br(p.notes || '')}</td>
    </tr>`).join('');
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Other Properties</h1>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr style="background:#d9d9d9;">
        <th style="width:30%;text-align:left;"><b>Property Name</b></th>
        <th style="text-align:left;"><b>Notes / Repairs / Tasks Completed or Pending</b></th>
      </tr>
      ${rows}
    </table>`;
}

function renderCleaningSection(c) {
  const rows = Object.keys(CLEANING_LABELS).map(key => `
    <tr>
      <td style="width:35%;background:#f3f3f3;"><b>${esc(CLEANING_LABELS[key])}</b></td>
      <td>${nl2br(c[key] || '')}</td>
    </tr>`).join('');
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Cleaning</h1>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      ${rows}
    </table>`;
}

// v18.32 Phase 3b — Equipment Activity section in the Drive doc.
// Receives the snapshot frozen into data.equipment_activity at upload
// time by daily-log.js commitSave. Each event becomes one table row
// with timestamp + equipment + location + event description. Notes
// from data.equipment_activity_notes (a single shared text field for
// the day's events) render above the table.
function renderEquipmentActivitySection(activity, notes) {
  const events = Array.isArray(activity) ? activity : [];
  const notesBlock = notes
    ? `<p style="font-style:italic;color:#555;margin-top:6pt;">${nl2br(notes)}</p>`
    : '';
  if (!events.length) {
    return `
      <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Today's Equipment Activity</h1>
      <p style="font-style:italic;color:#999;">No equipment activity logged for this date.</p>
      ${notesBlock}`;
  }
  const rows = events.map(ev => {
    const eqName = (ev.payload && ev.payload.equipment_name) || '—';
    const loc = ev.location || '—';
    let detail = '';
    if (ev.event_type === 'status_change') {
      const fromL = (ev.payload && ev.payload.from_label) || (ev.payload && ev.payload.from) || '?';
      const toL   = (ev.payload && ev.payload.to_label)   || (ev.payload && ev.payload.to)   || '?';
      const flipNote = (ev.payload && ev.payload._is_net && ev.payload._flip_count > 1)
        ? ` (net of ${ev.payload._flip_count} flips)` : '';
      detail = `Status: ${esc(fromL)} → <b>${esc(toL)}</b>${esc(flipNote)}`;
    } else if (ev.event_type === 'pm_logged') {
      detail = '<b>PM completed</b>';
    } else if (ev.event_type === 'location_change') {
      detail = `Moved: ${esc(ev.payload?.from || '?')} → <b>${esc(ev.payload?.to || '?')}</b>`;
    } else if (ev.event_type === 'archived')   detail = '<b>Archived</b>';
    else   if (ev.event_type === 'restored')   detail = '<b>Restored</b> from archive';
    else   if (ev.event_type === 'created')    detail = '<b>New equipment</b> created';
    else   if (ev.event_type === 'issue_opened') {
      const title = (ev.payload && ev.payload.title) || 'Work order opened';
      const pri = (ev.payload && ev.payload.priority) || '';
      detail = `<b>Work order opened</b>: ${esc(String(title).slice(0, 80))}${pri && pri !== 'normal' ? ' <small>(' + esc(pri) + ')</small>' : ''}`;
    }
    else   if (ev.event_type === 'issue_paid') {
      const title = (ev.payload && ev.payload.title) || 'Work order';
      const amt = ev.payload && ev.payload.invoice_amount;
      const amtLabel = (amt && !isNaN(amt)) ? ` — <b>$${Math.round(Number(amt)).toLocaleString()}</b>` : '';
      detail = `<b>Invoice paid</b>: ${esc(String(title).slice(0, 80))}${amtLabel}`;
    }
    else  detail = esc(String(ev.event_type).replace(/_/g, ' '));
    const time = ev.occurred_at
      ? new Date(ev.occurred_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    const actor = ev.actor_name ? esc(ev.actor_name) : '';
    return `
      <tr>
        <td style="width:60px;font-size:9pt;color:#666;">${esc(time)}</td>
        <td><b>${esc(eqName)}</b></td>
        <td style="font-size:9pt;color:#666;">${esc(loc)}</td>
        <td>${detail}</td>
        <td style="font-size:9pt;color:#666;">${actor}</td>
      </tr>`;
  }).join('');
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Today's Equipment Activity</h1>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr style="background:#d9d9d9;text-align:left;">
        <th><b>Time</b></th>
        <th><b>Equipment</b></th>
        <th><b>Location</b></th>
        <th><b>Event</b></th>
        <th><b>By</b></th>
      </tr>
      ${rows}
    </table>
    ${notesBlock}`;
}

// ─── BIWEEKLY DRIVE DOC (v18.32 Phase 3d) ───────────────────────────
// Biweekly review's Drive doc now renders the frozen rollup metrics
// snapshotted by biweekly-log.js at upload time. Falls back gracefully
// if data.metrics is missing (e.g., pre-3d row uploaded before metrics
// existed — renders a placeholder note instead of breaking).

// PLACEHOLDER labels used as a fallback when the saved log doesn't carry
// a snapshot of its own checklist item labels. New rows (v18.32 polish
// onwards) include `checklist_items` in their data — if present we use
// THAT instead so each Drive doc renders the labels that were in effect
// at upload time, even if the user has since edited the org-wide list.
const BIWEEKLY_PLACEHOLDER_LABELS = {
  item_1: 'Biweekly check — placeholder item 1',
  item_2: 'Biweekly check — placeholder item 2',
  item_3: 'Biweekly check — placeholder item 3',
  item_4: 'Biweekly check — placeholder item 4',
  item_5: 'Biweekly check — placeholder item 5',
};

function renderBiweeklyChecklistTable(checklist, itemsOverride) {
  const c = checklist || {};
  // Prefer the per-row snapshot if present, otherwise fall back to the
  // legacy placeholder labels so old rows (uploaded before this feature)
  // still render with something readable.
  const items = (Array.isArray(itemsOverride) && itemsOverride.length)
    ? itemsOverride
    : Object.keys(BIWEEKLY_PLACEHOLDER_LABELS).map(key => ({ key, label: BIWEEKLY_PLACEHOLDER_LABELS[key] }));

  const rows = items.map(item => {
    const checked = !!c[item.key];
    const mark = checked ? '☑' : '☐';
    const style = checked ? 'color:#222;' : 'color:#888;';
    return `
      <tr>
        <td style="width:32px;text-align:center;font-size:14pt;${style}">${mark}</td>
        <td style="${style}">${esc(item.label)}</td>
      </tr>`;
  }).join('');
  const total = items.length;
  const checkedCount = items.reduce((n, it) => n + (c[it.key] ? 1 : 0), 0);
  return `
    <h2>Checklist <span style="font-size:11pt;font-weight:normal;color:#666;">(${checkedCount}/${total})</span></h2>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      ${rows}
    </table>`;
}

// Render the chronic-problem ticket list — most important section,
// surfaced at the top of the doc so it can't be missed.
function renderBiweeklyAgedTickets(aged) {
  const items = Array.isArray(aged) ? aged : [];
  if (!items.length) {
    return `
      <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Chronic — Open &gt; 2 Weeks</h2>
      <p style="font-style:italic;color:#67c08c;">No tickets open longer than two weeks. 🎉</p>`;
  }
  const rows = items.map(t => {
    const pri = (t.priority || 'normal').toLowerCase();
    return `
      <tr>
        <td style="width:80px;font-size:9pt;text-transform:uppercase;color:#555;"><b>${esc(pri)}</b></td>
        <td><b>${esc(t.title || 'Untitled ticket')}</b></td>
        <td style="font-size:9pt;color:#666;">${esc(t.location || '—')}</td>
        <td style="width:90px;text-align:right;font-family:monospace;color:#a83e3e;"><b>${t.age_days}d open</b></td>
      </tr>`;
  }).join('');
  return `
    <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Chronic — Open &gt; 2 Weeks <span style="font-size:11pt;font-weight:normal;color:#666;">(${items.length})</span></h2>
    <p style="font-style:italic;color:#999;font-size:9pt;">Tickets created before this review's window and not yet resolved. These roll forward every biweekly until closed.</p>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr style="background:#d9d9d9;">
        <th style="text-align:left;"><b>Priority</b></th>
        <th style="text-align:left;"><b>Title</b></th>
        <th style="text-align:left;"><b>Location</b></th>
        <th style="text-align:right;"><b>Age</b></th>
      </tr>
      ${rows}
    </table>`;
}

// 2x2 stat-cards grid for opened / closed / PMs / activity rollups
function renderBiweeklyRollupTable(metrics) {
  const opened   = (metrics && metrics.tickets_opened)   || { total: 0, by_location: {}, by_priority: {} };
  const closed   = (metrics && metrics.tickets_closed)   || { total: 0, by_location: {}, avg_resolution_hours: null };
  const pms      = (metrics && metrics.pms_completed)    || { total: 0, by_location: {} };
  const activity = (metrics && metrics.equipment_activity)|| { total: 0, by_type: {}, currently_down: 0 };

  const fmtAvg = (h) => {
    if (h == null) return '—';
    if (h < 1)   return `${Math.round(h * 60)} min`;
    if (h < 48)  return `${h.toFixed(1)} hr`;
    return `${(h / 24).toFixed(1)} days`;
  };
  const renderBreakdown = (obj) => {
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<span style="color:#999;font-style:italic;">none</span>';
    return entries.map(([k, v]) => `<b>${v}</b> ${esc(k)}`).join(' &middot; ');
  };

  return `
    <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Rollup &mdash; 14-Day Window</h2>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;">
      <tr>
        <td style="width:50%;vertical-align:top;background:#f3f3f3;">
          <p style="margin:0 0 4pt;"><b style="font-size:14pt;">${opened.total}</b> &nbsp;<span style="color:#555;">tickets opened</span></p>
          <p style="margin:2pt 0;font-size:10pt;color:#555;">By location: ${renderBreakdown(opened.by_location)}</p>
          <p style="margin:2pt 0;font-size:10pt;color:#555;">By priority: ${renderBreakdown(opened.by_priority)}</p>
        </td>
        <td style="width:50%;vertical-align:top;background:#f3f3f3;">
          <p style="margin:0 0 4pt;"><b style="font-size:14pt;">${closed.total}</b> &nbsp;<span style="color:#555;">tickets closed</span></p>
          <p style="margin:2pt 0;font-size:10pt;color:#555;">By location: ${renderBreakdown(closed.by_location)}</p>
          <p style="margin:2pt 0;font-size:10pt;color:#555;">Avg resolution: <b>${esc(fmtAvg(closed.avg_resolution_hours))}</b></p>
        </td>
      </tr>
      <tr>
        <td style="vertical-align:top;background:#f3f3f3;">
          <p style="margin:0 0 4pt;"><b style="font-size:14pt;">${pms.total}</b> &nbsp;<span style="color:#555;">PMs completed</span></p>
          <p style="margin:2pt 0;font-size:10pt;color:#555;">By location: ${renderBreakdown(pms.by_location)}</p>
        </td>
        <td style="vertical-align:top;background:#f3f3f3;">
          <p style="margin:0 0 4pt;"><b style="font-size:14pt;">${activity.total}</b> &nbsp;<span style="color:#555;">equipment events</span></p>
          <p style="margin:2pt 0;font-size:10pt;color:#555;">By type: ${renderBreakdown(activity.by_type)}</p>
          <p style="margin:2pt 0;font-size:10pt;color:${activity.currently_down > 0 ? '#a83e3e' : '#555'};">Ended period down: <b>${activity.currently_down}</b></p>
        </td>
      </tr>
    </table>`;
}

// Render the four-textarea annotations block (Trends / Wins / Concerns
// / Focus). Falls back to single-string `notes` if data is from a
// pre-3d row that wasn't migrated yet.
function renderBiweeklyAnnotations(notes) {
  // 3c → 3d defensive fallback
  if (typeof notes === 'string') {
    return notes ? `
      <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Notes</h2>
      <p>${nl2br(notes)}</p>` : '';
  }
  const n = notes || {};
  const sections = [
    { key: 'trends',   label: 'Trends',   hint: 'Overall direction' },
    { key: 'wins',     label: 'Wins',     hint: 'What went well' },
    { key: 'concerns', label: 'Concerns', hint: 'Warning signs' },
    { key: 'focus',    label: 'Next 2 Weeks Focus', hint: 'Forward-looking priorities' },
  ];
  const blocks = sections.map(s => {
    const val = (n[s.key] || '').trim();
    return `
      <h3 style="margin-top:14pt;margin-bottom:4pt;color:#333;">${esc(s.label)}</h3>
      ${val ? `<p>${nl2br(val)}</p>` : `<p style="font-style:italic;color:#999;">(no notes)</p>`}`;
  }).join('');
  return `
    <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Annotations</h2>
    ${blocks}`;
}

// v18.32 Vendor V2 — Biweekly vendor performance section in the Drive doc.
// Mirrors the in-app card: highlights row at the top (best/slowest/spend)
// + a table with grade, name, window stats, lifetime stats.
function renderBiweeklyVendorPerformance(perf) {
  if (!perf || !perf.items || !perf.items.length) {
    return `
      <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Vendor Performance</h2>
      <p style="font-style:italic;color:#999;">No vendor activity in this window.</p>`;
  }

  const fmtMoney = (n) => {
    if (!n || isNaN(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  const fmtHours = (h) => {
    if (h == null || isNaN(h)) return '—';
    if (h < 1)   return Math.round(h * 60) + 'm';
    if (h < 48)  return Math.round(h * 10) / 10 + 'h';
    return Math.round(h / 24 * 10) / 10 + 'd';
  };

  const hl = perf.highlights || {};
  const highlightsBlock = (hl.best || hl.slow || hl.big) ? `
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;margin-bottom:8pt;">
      <tr style="background:#f3f3f3;">
        ${hl.best ? `<td><b>Best:</b> ${esc(hl.best.company)} <small style="color:#666;">(grade ${esc(hl.best.grade)})</small></td>` : '<td>&nbsp;</td>'}
        ${hl.slow ? `<td><b>Slowest:</b> ${esc(hl.slow.company)} <small style="color:#666;">(${esc(fmtHours(hl.slow.response_hours))})</small></td>` : '<td>&nbsp;</td>'}
        ${hl.big  ? `<td><b>Biggest spend:</b> ${esc(hl.big.company)} <small style="color:#666;">(${esc(fmtMoney(hl.big.spend))})</small></td>` : '<td>&nbsp;</td>'}
      </tr>
    </table>` : '';

  const rows = perf.items.map(v => {
    const grade = (v.grade && v.grade.letter) || '—';
    return `
      <tr>
        <td style="width:42px;text-align:center;font-size:14pt;"><b>${esc(grade)}</b></td>
        <td>
          <b>${esc(v.company)}</b>
          ${v.category ? `<br><small style="color:#666;">${esc(v.category)}</small>` : ''}
        </td>
        <td style="text-align:right;"><b>${v.window_opened}</b><br><small style="color:#666;">opened</small></td>
        <td style="text-align:right;"><b>${v.window_closed}</b><br><small style="color:#666;">closed</small></td>
        <td style="text-align:right;"><b>${esc(fmtMoney(v.window_spend))}</b><br><small style="color:#666;">window spend</small></td>
        <td style="text-align:right;"><b>${v.lifetime.total_jobs}</b><br><small style="color:#666;">lifetime jobs</small></td>
        <td style="text-align:right;"><b>${esc(fmtHours(v.lifetime.avg_response_hours))}</b><br><small style="color:#666;">avg response</small></td>
      </tr>`;
  }).join('');

  return `
    <h2 style="border-bottom:2px solid #333;padding-bottom:4pt;">Vendor Performance <span style="font-size:11pt;font-weight:normal;color:#666;">(${perf.items.length})</span></h2>
    ${highlightsBlock}
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr style="background:#d9d9d9;">
        <th><b>Grade</b></th>
        <th style="text-align:left;"><b>Vendor</b></th>
        <th><b>Opened</b></th>
        <th><b>Closed</b></th>
        <th><b>Spend</b></th>
        <th><b>Lifetime jobs</b></th>
        <th><b>Avg response</b></th>
      </tr>
      ${rows}
    </table>`;
}

function buildBiweeklyLogHtml(logData) {
  const d = logData || {};
  const endDate   = (d.header && d.header.date) || new Date().toISOString().slice(0, 10);
  const startDate = (d.header && d.header.window_start) || computeWindowStart(endDate);
  const endLabel   = friendlyDate(endDate);
  const startLabel = friendlyDate(startDate);
  const metrics = d.metrics || null;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Biweekly Review — ${esc(endDate)}</title>
</head>
<body>
  <h1 style="text-align:center;border:none;">BIWEEKLY FACILITIES REVIEW</h1>
  <h3 style="text-align:center;color:#555;font-weight:normal;">${esc(startLabel)} &mdash; ${esc(endLabel)}</h3>
  <p>&nbsp;</p>

  ${metrics ? renderBiweeklyAgedTickets(metrics.aged_open_tickets) : '<p style="font-style:italic;color:#999;">Metrics snapshot not available — upload while connected to capture.</p>'}
  <p>&nbsp;</p>

  ${metrics ? renderBiweeklyRollupTable(metrics) : ''}
  <p>&nbsp;</p>

  ${metrics && metrics.vendor_performance ? renderBiweeklyVendorPerformance(metrics.vendor_performance) : ''}
  <p>&nbsp;</p>

  ${renderBiweeklyAnnotations(d.notes)}
  <p>&nbsp;</p>

  ${renderBiweeklyChecklistTable(d.checklist, d.checklist_items)}

  <p style="margin-top:24pt;font-size:9pt;color:#999;text-align:center;">
    Generated by NEXUS &middot; ${esc(new Date().toISOString())}
  </p>
</body>
</html>`;
}

// Compute the start of the 14-day window ending on `endDateIso`.
function computeWindowStart(endDateIso) {
  if (!endDateIso) return '';
  const d = new Date(endDateIso + 'T12:00:00');
  d.setDate(d.getDate() - 13);
  return d.toISOString().slice(0, 10);
}

// v18.32 Phase 3e — Daily tickets continuity in the Drive doc.
// Three slices for the day: Open as of, Closed today, Newly opened.
// Driven by the frozen snapshot in data.tickets + notes from
// data.ticket_notes. If data.tickets is missing (older logs uploaded
// before 3e), the section is skipped entirely.
function renderDailyTicketsSection(slices, notes) {
  if (!slices) return '';
  const n = notes || {};
  const ticketTable = (items, emptyMsg) => {
    const rows = (items || []).filter(t => t && t.title).map(t => {
      const pri = (t.priority || 'normal').toLowerCase();
      return `
        <tr>
          <td style="width:80px;font-size:9pt;text-transform:uppercase;color:#555;"><b>${esc(pri)}</b></td>
          <td><b>${esc(t.title)}</b></td>
          <td style="width:30%;font-size:9pt;color:#666;">${esc(t.location || '—')}</td>
        </tr>`;
    }).join('');
    if (!rows) return `<p style="font-style:italic;color:#999;">${esc(emptyMsg)}</p>`;
    return `
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
        <tr style="background:#d9d9d9;">
          <th style="text-align:left;"><b>Priority</b></th>
          <th style="text-align:left;"><b>Title</b></th>
          <th style="text-align:left;"><b>Location</b></th>
        </tr>
        ${rows}
      </table>`;
  };

  const block = (label, items, noteText, emptyMsg) => `
    <h3 style="margin-top:14pt;margin-bottom:4pt;color:#333;">${esc(label)} <span style="font-size:11pt;font-weight:normal;color:#666;">(${(items || []).length})</span></h3>
    ${ticketTable(items, emptyMsg)}
    ${noteText ? `<p style="font-style:italic;color:#555;margin-top:6pt;">${nl2br(noteText)}</p>` : ''}`;

  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Tickets</h1>
    ${block('Open as of today',   slices.open_as_of,   n.open,   'No tickets currently open.')}
    ${block('Closed today',       slices.closed_today, n.closed, 'No tickets closed today.')}
    ${block('Newly opened today', slices.opened_today, n.opened, 'No new tickets opened today.')}`;
}

// v18.32 Vendor V1 — Daily vendor activity in the Drive doc.
// Aggregates vendor names mentioned across all locations' vendor_calls
// for the day, with their associated locations and issues. Renders
// regardless of whether the vendor is in the canonical vendors table —
// the doc is a human-readable record, not a relational view.
function renderDailyVendorActivity(d) {
  // Walk the locations array, collecting unique vendor names with the
  // locations they appeared at + a deduplicated list of issues they
  // were called about.
  const byVendor = new Map();
  ((d && d.locations) || []).forEach(loc => {
    (loc.vendor_calls || []).forEach(vc => {
      const display = (vc && vc.vendor || '').trim();
      if (!display) return;
      const key = display.toLowerCase();
      if (!byVendor.has(key)) byVendor.set(key, { display, locations: new Set(), issues: [], statuses: [] });
      const entry = byVendor.get(key);
      entry.locations.add(loc.label);
      if (vc.issue)  entry.issues.push(vc.issue);
      if (vc.status) entry.statuses.push(vc.status);
    });
  });

  const notes = (d && d.vendor_activity_notes) || '';
  if (!byVendor.size && !notes) return '';

  const rows = Array.from(byVendor.values()).map(v => {
    const locs = Array.from(v.locations).filter(Boolean).join(', ');
    const issueText = v.issues.length
      ? v.issues.join(' &middot; ')
      : '<span style="color:#999;font-style:italic;">no issue notes</span>';
    return `
      <tr>
        <td><b>${esc(v.display)}</b></td>
        <td style="font-size:9pt;color:#666;">${esc(locs || '—')}</td>
        <td style="font-size:10pt;">${esc(issueText)}</td>
      </tr>`;
  }).join('');

  const notesBlock = notes
    ? `<p style="font-style:italic;color:#555;margin-top:6pt;">${nl2br(notes)}</p>`
    : '';

  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Vendor Activity</h1>
    ${byVendor.size
      ? `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
          <tr style="background:#d9d9d9;">
            <th style="text-align:left;"><b>Vendor</b></th>
            <th style="text-align:left;"><b>Location(s)</b></th>
            <th style="text-align:left;"><b>Issue / Notes</b></th>
          </tr>
          ${rows}
        </table>`
      : '<p style="font-style:italic;color:#999;">No vendor calls logged for this date.</p>'}
    ${notesBlock}`;
}

// v18.32 — Equipment Status section in the daily Drive doc.
// Renders the "what's currently not operational" list with the
// status_note for each, frozen at upload time. Different from
// Today's Equipment Activity (which is transient events).
function renderDailyEquipmentStatus(items) {
  if (!Array.isArray(items) || !items.length) {
    return '';   // Suppress section entirely when nothing's down
  }
  const statusLabel = (k) => ({
    down: 'DOWN', needs_service: 'NEEDS SERVICE', broken: 'BROKEN'
  })[k] || (k || '').toUpperCase();
  const rows = items.map(eq => {
    const note = eq.status_note || '<span style="color:#999;font-style:italic;">no note</span>';
    return `
      <tr>
        <td style="width:120px;font-size:9pt;"><b>${esc(statusLabel(eq.status))}</b></td>
        <td><b>${esc(eq.name || 'Untitled')}</b><br><small style="color:#666;">${esc(eq.location || '')}</small></td>
        <td>${esc(eq.status_note) || '<span style="color:#999;font-style:italic;">no note</span>'}</td>
      </tr>`;
  }).join('');
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Equipment Status <span style="font-size:11pt;font-weight:normal;color:#666;">(${items.length})</span></h1>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr style="background:#d9d9d9;">
        <th style="text-align:left;"><b>Status</b></th>
        <th style="text-align:left;"><b>Equipment</b></th>
        <th style="text-align:left;"><b>Note</b></th>
      </tr>
      ${rows}
    </table>`;
}

function buildDailyLogHtml(logData) {
  const d = logData;
  const dateLabel = friendlyDate(d.header && d.header.date);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Daily Facilities Log — ${esc(d.header && d.header.date)}</title>
</head>
<body>
  <h1 style="text-align:center;border:none;">DAILY FACILITIES LOG</h1>
  <h3 style="text-align:center;color:#555;font-weight:normal;">${esc(dateLabel)}</h3>
  <p>&nbsp;</p>
  ${renderHeaderTable(d)}
  <p>&nbsp;</p>
  ${renderPlanningSection(d)}
  <p>&nbsp;</p>
  ${renderAllLocations(d)}
  ${renderDailyEquipmentStatus(d.equipment_status)}
  <p>&nbsp;</p>
  ${renderEquipmentActivitySection(d.equipment_activity, d.equipment_activity_notes)}
  <p>&nbsp;</p>
  ${renderDailyVendorActivity(d)}
  <p>&nbsp;</p>
  ${renderDailyTicketsSection(d.tickets, d.ticket_notes)}
  <p>&nbsp;</p>
  ${renderOtherProperties(d.other_properties)}
  <p>&nbsp;</p>
  ${renderCleaningSection(d.cleaning)}
  <p style="margin-top:24pt;font-size:9pt;color:#999;text-align:center;">
    Generated by NEXUS &middot; ${esc(new Date().toISOString())}
  </p>
</body>
</html>`;
}

// v18.32 Phase 3a — dynamic locations rendering with old-shape migration.
// Three input cases (mirrors hydrateData in daily-log.js):
//   1. d.locations is a non-empty array → render each in order
//   2. d.este or d.suerte present (old shape, not yet migrated by save)
//      → render them in legacy order using legacy keys
//   3. neither → render no location sections (degenerate empty log)
function renderAllLocations(d) {
  const sections = [];
  if (Array.isArray(d.locations) && d.locations.length) {
    d.locations.forEach(loc => {
      sections.push(renderLocationSection(loc));
    });
  } else {
    // Legacy migration path — daily-log.js's hydrateData has already
    // converted these in memory, but this guards against any code path
    // that builds the doc directly from a stale data row.
    if (d.este)   sections.push(renderLocationSection({ label: 'Este',   rm: d.este,   vendor_calls: d.este.vendor_calls   || [] }));
    if (d.suerte) sections.push(renderLocationSection({ label: 'Suerte', rm: d.suerte, vendor_calls: d.suerte.vendor_calls || [] }));
  }
  return sections.join('<p>&nbsp;</p>') + (sections.length ? '<p>&nbsp;</p>' : '');
}

// ─── Upload via Drive multipart endpoint ────────────────────────────
// v18.32 Phase 3a — Two modes:
//   • CREATE (no opts.existingFileId): POST to /files?uploadType=multipart,
//     parents=[folderId] in metadata, Drive auto-converts HTML → Google Doc.
//   • UPDATE (opts.existingFileId set): PATCH to /files/{id}?uploadType=multipart,
//     parents NOT in metadata (Drive 400s if you try to change parents in an
//     update). Same boundary structure, same HTML body — Drive replaces the
//     doc's content in place. The file ID and webViewLink stay the same.
// On 404 in UPDATE mode (e.g., the file was deleted from Drive between
// uploads), we transparently fall back to CREATE so the user just gets a
// new file in their folder rather than a hard error.
async function uploadHtmlAsGoogleDoc(opts) {
  const isUpdate = !!opts.existingFileId;
  const boundary = 'nexus_boundary_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  const metadata = {
    name: opts.filename,
    mimeType: 'application/vnd.google-apps.document',
  };
  // parents is only valid on CREATE. Drive returns 400 if it appears in a
  // PATCH metadata — use the addParents query param if you ever need to
  // move a file (not needed here since we keep files in their folder).
  if (!isUpdate) {
    metadata.parents = [opts.folderId];
  }

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    opts.html + `\r\n` +
    `--${boundary}--`;

  const url = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(opts.existingFileId)}?uploadType=multipart&fields=id,webViewLink,name`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name`;
  const method = isUpdate ? 'PATCH' : 'POST';

  const resp = await fetch(url, {
    method,
    headers: {
      'Authorization': 'Bearer ' + opts.token,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: body,
  });

  // Transparent fallback: if updating a file that no longer exists in
  // Drive (deleted by user, trashed, permission revoked), retry as a
  // create instead. Caller gets a new fileId back; daily-log.js will
  // persist it on the next save and subsequent updates will use it.
  if (isUpdate && resp.status === 404) {
    console.warn('[nx-drive] update target file not found (404) — falling back to create');
    return uploadHtmlAsGoogleDoc({
      html: opts.html,
      filename: opts.filename,
      folderId: opts.folderId,
      token: opts.token,
      // omit existingFileId → recursive call uses CREATE path
    });
  }

  if (!resp.ok) {
    let errMsg = `Drive ${isUpdate ? 'update' : 'upload'} failed (HTTP ${resp.status})`;
    try {
      const errBody = await resp.text();
      const parsed = JSON.parse(errBody);
      if (parsed.error && parsed.error.message) {
        errMsg += ': ' + parsed.error.message;
      } else {
        errMsg += ': ' + errBody.slice(0, 200);
      }
      if (resp.status === 401) errMsg = 'Drive authorization expired — please reconnect Drive in Settings';
      else if (resp.status === 403 && /insufficient/i.test(errBody)) errMsg = 'Drive: insufficient permissions — your token may not have drive.file scope. Reconnect Drive.';
      else if (resp.status === 404 && !isUpdate) errMsg = 'Drive: target folder not found — was it deleted or moved?';
    } catch(_) {/* ignore parse errors */}
    throw new Error(errMsg);
  }
  return await resp.json();  // { id, webViewLink, name }
}

// ─── Public API ──────────────────────────────────────────────────────
/**
 * Generate a Google Doc from daily log data and drop it in the configured
 * folder. Returns { fileId, webViewLink, filename }. Throws on failure.
 *
 * @param {Object} logData  The data shape stored in daily_logs.data
 * @param {Object} [options]
 * @param {string} [options.folderId]  Override the default Daily Log folder
 * @param {string} [options.filename]  Override the auto-generated filename
 */
async function uploadDailyLog(logData, options) {
  options = options || {};
  const folderId = options.folderId || DAILY_LOG_FOLDER_ID;
  const dateStr = (logData && logData.header && logData.header.date)
    || new Date().toISOString().slice(0, 10);
  const filename = options.filename || `${dateStr} Daily Log`;

  const token = await ensureDriveToken({ scopes: DAILY_LOG_SCOPES });
  const html = buildDailyLogHtml(logData);
  const result = await uploadHtmlAsGoogleDoc({
    html, filename, folderId, token,
    existingFileId: options.existingFileId || null,
  });

  return {
    fileId: result.id,
    webViewLink: result.webViewLink,
    filename: result.name,
  };
}

/**
 * v18.32 Phase 3c — Generate a Biweekly Review Google Doc and drop it
 * in the same Drive folder as the daily logs. Filename pattern:
 *   "YYYY-MM-DD Biweekly Review"
 * where YYYY-MM-DD is the end date of the 14-day window the review
 * covers (logData.header.date). Returns { fileId, webViewLink, filename }.
 *
 * Same Drive auth + create-or-update flow as uploadDailyLog — if
 * options.existingFileId is passed, the same Drive file gets refreshed
 * in place. New uploads create a new file in the folder.
 */
async function uploadBiweeklyLog(logData, options) {
  options = options || {};
  const folderId = options.folderId || DAILY_LOG_FOLDER_ID;
  const dateStr = (logData && logData.header && logData.header.date)
    || new Date().toISOString().slice(0, 10);
  const filename = options.filename || `${dateStr} Biweekly Review`;

  const token = await ensureDriveToken({ scopes: DAILY_LOG_SCOPES });
  const html = buildBiweeklyLogHtml(logData);
  const result = await uploadHtmlAsGoogleDoc({
    html, filename, folderId, token,
    existingFileId: options.existingFileId || null,
  });

  return {
    fileId: result.id,
    webViewLink: result.webViewLink,
    filename: result.name,
  };
}

// Expose on global NX namespace
window.NX = window.NX || {};
NX.drive = {
  ensureDriveToken,
  uploadDailyLog,
  uploadBiweeklyLog,
  DAILY_LOG_FOLDER_ID,
  // Exposed for testing / future modules
  _buildDailyLogHtml: buildDailyLogHtml,
  _buildBiweeklyLogHtml: buildBiweeklyLogHtml,
};

console.log('[nx-drive] v18.32 Phase 3c loaded — Daily Log + Biweekly Review Drive upload ready');

})();
