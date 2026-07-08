/* ═══════════════════════════════════════════════════════════════════════
   nx-backup.js — off-platform data backup to Google Drive.

   Layer 2 of the NEXUS backup system:
     Layer 1  vault-backup edge function → NIGHTLY full snapshot (service
              role, ALL 90+ tables incl. locked ones) → private Supabase
              Storage bucket 'backups' (snapshots/YYYY-MM-DD.json.gz),
              30-day retention. pg_cron job 'vault-backup-nightly',
              4:23am Austin. Protects against bad code/migrations/deletes.
     Layer 2  THIS — weekly (or on-demand) export of every anon-readable
              table → gzipped JSON in Alfredo's own Google Drive
              ("NEXUS Backups" folder). OFF-platform: survives Supabase
              project loss or lockout. RLS-respecting by construction, so
              locked tables (PINs, API secrets) never land in Drive.
     Layer 3  git — code + moneta vault pressings (already standing).

   Exposes NX.backup = { run(opts), maybeAuto(), lastRun() }.
   Wired into Tools (🛟 Backup tile) + a weekly auto-run on app use.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var T = (typeof NX !== 'undefined' && NX) ? NX : (window.NX = window.NX || {});
  if (T.backup) return;

  var FOLDER_NAME = 'NEXUS Backups';
  var DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.file'];

  function gzip(str) {
    var stream = new Blob([new TextEncoder().encode(str)]).stream()
      .pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function getToken() {
    var drive = (T && T.drive) || (window.NX && window.NX.drive);
    if (!drive || !drive.ensureDriveToken) return Promise.reject(new Error('Drive module missing — close & reopen NEXUS'));
    return Promise.resolve(drive.ensureDriveToken({ scopes: DRIVE_SCOPE }));
  }

  // Find-or-create the backups folder; id cached, cache invalidated on 404.
  function ensureFolder(tok) {
    var cached = null;
    try { cached = localStorage.getItem('nx_backup_folder_id'); } catch (_) {}
    if (cached) return Promise.resolve(cached);
    var q = encodeURIComponent("name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)', {
      headers: { Authorization: 'Bearer ' + tok },
    }).then(function (r) { return r.json(); }).then(function (j) {
      var id = j.files && j.files[0] && j.files[0].id;
      if (id) return id;
      return fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      }).then(function (r) { return r.json(); }).then(function (j2) { return j2.id; });
    }).then(function (id) {
      if (!id) throw new Error('could not create the Drive folder');
      try { localStorage.setItem('nx_backup_folder_id', id); } catch (_) {}
      return id;
    });
  }

  // Multipart upload with a BINARY media part (Blob body — string
  // concatenation corrupts gzip bytes).
  function uploadGz(tok, folderId, name, bytes) {
    var boundary = 'nxb' + Math.random().toString(36).slice(2);
    var pre = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: name, parents: [folderId] }) +
      '\r\n--' + boundary + '\r\nContent-Type: application/gzip\r\n\r\n';
    var post = '\r\n--' + boundary + '--';
    return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: new Blob([pre, bytes, post]),
    }).then(function (r) {
      if (r.status === 404) {
        try { localStorage.removeItem('nx_backup_folder_id'); } catch (_) {}
        throw new Error('backup folder vanished — run backup again');
      }
      if (!r.ok) throw new Error('Drive upload failed (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  async function run(opts) {
    opts = opts || {};
    if (!T.sb) throw new Error('Database not connected');
    var toast = function (m, k, ms) { if (!opts.silent && T.toast) T.toast(m, k, ms || 2600); };
    toast('Backing up all data…', 'info', 3500);

    var { data: tables, error: tErr } = await T.sb.rpc('backup_public_table_list');
    if (tErr || !Array.isArray(tables) || !tables.length) {
      throw new Error('table list unavailable' + (tErr ? ' — ' + tErr.message : ''));
    }

    var dump = {}, counts = {}, failures = {};
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var rows = [], from = 0;
      for (;;) {
        var res = await T.sb.from(t).select('*').range(from, from + 999);
        if (res.error) { failures[t] = res.error.message; break; }
        rows = rows.concat(res.data || []);
        if (!res.data || res.data.length < 1000) break;
        from += 1000;
      }
      dump[t] = rows;
      counts[t] = rows.length;
    }

    var payload = {
      vault: 'NEXUS-DRIVE-BACKUP',
      taken_at: new Date().toISOString(),
      tables: tables.length,
      row_counts: counts,
      failures: failures,
      note: 'RLS-scope export (Layer 2). Locked tables (users/config/auth) live only in the nightly Layer-1 snapshots inside Supabase Storage.',
      data: dump,
    };
    var name = 'nexus-backup-' + new Date().toISOString().slice(0, 10) + '.json.gz';
    var bytes = await gzip(JSON.stringify(payload));
    var tok = await getToken();
    if (!tok) throw new Error('Google authorization unavailable');
    var folder = await ensureFolder(tok);
    var up = await uploadGz(tok, folder, name, bytes);

    try { localStorage.setItem('nx_last_drive_backup', String(Date.now())); } catch (_) {}
    var totalRows = 0;
    Object.keys(counts).forEach(function (k) { totalRows += counts[k]; });
    toast('✓ Backup saved to Drive — ' + tables.length + ' tables · ' + totalRows.toLocaleString() + ' rows · ' + Math.round(bytes.length / 1024) + ' KB', 'success', 5200);
    return { fileId: up.id, link: up.webViewLink, name: name, tables: tables.length, rows: totalRows, kb: Math.round(bytes.length / 1024), failures: failures };
  }

  function lastRun() {
    try { return parseInt(localStorage.getItem('nx_last_drive_backup') || '0', 10) || null; } catch (_) { return null; }
  }

  // Weekly auto-backup that piggybacks on normal app use. Runs ONLY when a
  // Drive token with the right scope is already cached — it never pops a
  // Google screen uninvited. Failures stay silent: the nightly Layer-1
  // snapshot is the guaranteed one; this is the off-platform bonus copy.
  function maybeAuto() {
    try {
      var last = lastRun() || 0;
      if (Date.now() - last < 7 * 86400000) return;
      var scopes = localStorage.getItem('nexus_drive_scopes') || '';
      var fresh = localStorage.getItem('nexus_drive_token') &&
        parseInt(localStorage.getItem('nexus_drive_expiry') || '0', 10) > Date.now() + 60000 &&
        scopes.indexOf('drive.file') !== -1;
      if (!fresh) return;
      setTimeout(function () {
        run({ silent: true }).then(function () {
          if (T.toast) T.toast('Weekly backup saved to Drive ✓', 'info', 2600);
        }).catch(function (e) { console.warn('[nx-backup] weekly auto failed:', e && e.message); });
      }, 15000);   // let the app finish booting first
    } catch (_) {}
  }

  T.backup = { run: run, maybeAuto: maybeAuto, lastRun: lastRun };
  try { maybeAuto(); } catch (_) {}
  console.log('[nx-backup] ready — Layer 2 (Drive) backup');
})();
