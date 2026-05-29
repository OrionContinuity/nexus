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

function renderRMTable(locData) {
  const rows = Object.keys(RM_LABELS).map(key => `
    <tr>
      <td style="width:35%;background:#f3f3f3;"><b>${esc(RM_LABELS[key])}</b></td>
      <td>${nl2br(locData[key] || '')}</td>
    </tr>`).join('');
  return `
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <tr><th colspan="2" style="background:#d9d9d9;text-align:left;"><b>Repairs &amp; Maintenance</b></th></tr>
      ${rows}
    </table>`;
}

function renderVendorCallsTable(locData) {
  const calls = (locData.vendor_calls || []).filter(c =>
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

function renderLocationSection(label, locData) {
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">${esc(label)}</h1>
    ${renderRMTable(locData)}
    <p>&nbsp;</p>
    ${renderVendorCallsTable(locData)}`;
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

// PLACEHOLDER biweekly checklist — final items TBD. Item labels here
// must stay aligned with BIWEEKLY_PLACEHOLDER_ITEMS in js/daily-log.js
// so the Doc renders the same labels the form showed.
const BIWEEKLY_LABELS = {
  item_1: 'Biweekly check — placeholder item 1',
  item_2: 'Biweekly check — placeholder item 2',
  item_3: 'Biweekly check — placeholder item 3',
  item_4: 'Biweekly check — placeholder item 4',
  item_5: 'Biweekly check — placeholder item 5',
};

function renderBiweeklySection(b) {
  if (!b) b = {};
  // Google Docs HTML converter doesn't preserve <input type=checkbox> well,
  // so we render filled-circle / open-circle bullets instead. Always
  // legible in both Google Docs and downloaded .docx.
  const rows = Object.keys(BIWEEKLY_LABELS).map(key => {
    const checked = !!b[key];
    const mark = checked ? '☑' : '☐';
    const style = checked
      ? 'color:#222;'
      : 'color:#888;';
    return `
      <tr>
        <td style="width:32px;text-align:center;font-size:14pt;${style}">${mark}</td>
        <td style="${style}">${esc(BIWEEKLY_LABELS[key])}</td>
      </tr>`;
  }).join('');
  const total = Object.keys(BIWEEKLY_LABELS).length;
  const checkedCount = Object.values(b).filter(Boolean).length;
  return `
    <h1 style="border-bottom:2px solid #333;padding-bottom:4pt;">Biweekly Checklist <span style="font-size:11pt;font-weight:normal;color:#666;">(${checkedCount}/${total})</span></h1>
    <p style="font-style:italic;color:#999;font-size:9pt;">Placeholder — final checklist items pending.</p>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">
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
  ${renderLocationSection('Este', d.este)}
  <p>&nbsp;</p>
  ${renderLocationSection('Suerte', d.suerte)}
  <p>&nbsp;</p>
  ${renderOtherProperties(d.other_properties)}
  <p>&nbsp;</p>
  ${renderCleaningSection(d.cleaning)}
  <p>&nbsp;</p>
  ${renderBiweeklySection(d.biweekly)}
  <p style="margin-top:24pt;font-size:9pt;color:#999;text-align:center;">
    Generated by NEXUS &middot; ${esc(new Date().toISOString())}
  </p>
</body>
</html>`;
}

// ─── Upload via Drive multipart endpoint ────────────────────────────
async function uploadHtmlAsGoogleDoc(opts) {
  // Use a random boundary to avoid collision with body content
  const boundary = 'nexus_boundary_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const metadata = {
    name: opts.filename,
    mimeType: 'application/vnd.google-apps.document',
    parents: [opts.folderId],
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    opts.html + `\r\n` +
    `--${boundary}--`;

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + opts.token,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: body,
    }
  );

  if (!resp.ok) {
    let errMsg = `Drive upload failed (HTTP ${resp.status})`;
    try {
      const errBody = await resp.text();
      // Try to parse Google's error response
      const parsed = JSON.parse(errBody);
      if (parsed.error && parsed.error.message) {
        errMsg += ': ' + parsed.error.message;
      } else {
        errMsg += ': ' + errBody.slice(0, 200);
      }
      // Common cases worth surfacing clearly
      if (resp.status === 401) errMsg = 'Drive authorization expired — please reconnect Drive in Settings';
      else if (resp.status === 403 && /insufficient/i.test(errBody)) errMsg = 'Drive: insufficient permissions — your token may not have drive.file scope. Reconnect Drive.';
      else if (resp.status === 404) errMsg = 'Drive: target folder not found — was it deleted or moved?';
    } catch(_) {/* ignore parse errors, use generic msg */}
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
  DAILY_LOG_FOLDER_ID,
  // Exposed for testing / future modules
  _buildDailyLogHtml: buildDailyLogHtml,
};

console.log('[nx-drive] v18.32 Phase 2 loaded — Daily Log Drive upload ready');

})();
