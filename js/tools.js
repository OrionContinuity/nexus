/* tools.js — NEXUS "Tools" hub. A button grid (like the Duties dial) that opens:
   • Nodes      — every Clippy node: online, OS, version, model, GPU, telemetry
   • Activity   — live: what each node is doing now + in-flight jobs (tail) + feed
   • Push update— ship the latest Clippy to all nodes (installer lives in Supabase)
   • Install    — Clippy + OpenTether installers (Supabase Storage)
   Fully themed to NEXUS (uses --nx-* theme tokens, adapts dark/light).
   Self-contained: reads the bus over Supabase REST with the public anon key, so
   it needs no app internals. Exposes NX.tools.open()/close()/go(). */
(function () {
  var NX  = (window.NX = window.NX || {});
  var CFG = window.NEXUS_CONFIG || {};
  var SB   = CFG.SUPABASE_URL  || 'https://oprsthfxqrdbwdvommpw.supabase.co';
  var ANON = CFG.SUPABASE_ANON || 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9';
  var BASE = SB + '/storage/v1/object/public/installers/';
  var RB   = SB + '/rest/v1/clippy_sync';
  var F = {
    clippy: BASE + 'Clippy-for-a-friend.zip',
    otApk:  BASE + 'OpenTether.apk',
    otWin:  BASE + 'OpenTether-Windows.zip',
    otQR:   BASE + 'OpenTether-QR.png',
    // The self-update script nodes download + run. Served straight from the
    // repo (always present, no manual upload). Swap to the Supabase installers
    // bucket (BASE + 'clippy-update.ps1') once you've uploaded it there.
    updater: 'https://raw.githubusercontent.com/orioncontinuity/nexus/main/clippy-update.ps1',
  };

  // ─── bus over REST (anon key; clippy_sync is anon-readable) ──────────────
  function H(extra) { return Object.assign({ apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, extra || {}); }
  function busGet(id) {
    return fetch(RB + '?id=eq.' + encodeURIComponent(id) + '&select=data', { headers: H() })
      .then(function (r) { return r.json(); }).then(function (j) { return (j[0] && j[0].data) || null; }).catch(function () { return null; });
  }
  function busList(prefix) {
    return fetch(RB + '?id=like.' + encodeURIComponent(prefix + '*') + '&select=id,data', { headers: H() })
      .then(function (r) { return r.json(); }).catch(function () { return []; });
  }
  function busPost(row) {
    return fetch(RB, { method: 'POST', headers: H({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(row) });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function ago(ms) { var s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + 's' : (s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'); }
  function fresh(n) { return (Date.now() / 1000 - (n.ts || 0)) < 120; }
  function nodeId(n) { return n.id || n.name || 'node'; }

  // ─── styles — NEXUS theme tokens (dark/light aware) ──────────────────────
  function css() {
    if (document.getElementById('nxToolsStyle')) return;
    var s = document.createElement('style'); s.id = 'nxToolsStyle';
    s.textContent = [
      '.nxt-ov{position:fixed;inset:0;z-index:9000;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.58);backdrop-filter:blur(3px)}',
      '.nxt-ov.open{display:flex}',
      '@media(min-width:700px){.nxt-ov{align-items:center}}',
      '.nxt-card{width:min(680px,100vw);max-height:92vh;display:flex;flex-direction:column;border-radius:22px 22px 0 0;color:var(--nx-text);font-family:var(--nx-font-body,inherit);background:var(--nx-surface-solid);border:1px solid var(--nx-border);box-shadow:0 -10px 60px rgba(0,0,0,.5)}',
      '@media(min-width:700px){.nxt-card{border-radius:22px;box-shadow:0 24px 80px rgba(0,0,0,.5)}}',
      '.nxt-hd{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid var(--nx-gold-line);flex:0 0 auto}',
      '.nxt-hd h2{margin:0;font-size:18px;font-weight:600;font-family:var(--nx-font-display,inherit);color:var(--nx-text)}',
      '.nxt-bk,.nxt-x{cursor:pointer;border:1px solid var(--nx-gold-line);background:var(--nx-gold-faint);color:var(--nx-text);border-radius:10px;font-size:13px;font-weight:600}',
      '.nxt-bk{padding:6px 11px}.nxt-x{margin-left:auto;width:34px;height:34px;font-size:16px}',
      '.nxt-content{padding:16px;overflow:auto}',
      // hub grid
      '.nxt-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:11px}',
      '@media(min-width:560px){.nxt-grid{grid-template-columns:repeat(3,1fr)}}',
      '.nxt-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:18px 10px;min-height:96px;border-radius:var(--nx-radius-card,16px);border:1px solid var(--nx-gold-line);background:var(--nx-surface-2);color:var(--nx-text);cursor:pointer;text-align:center;transition:border-color .15s,background .15s,transform .12s}',
      '.nxt-btn:hover{border-color:var(--nx-gold-line-2);background:var(--nx-gold-faint)}.nxt-btn:active{transform:scale(.97)}',
      '.nxt-btn .ic{font-size:26px;line-height:1}',
      '.nxt-btn .lb{font-size:13.5px;font-weight:600}',
      '.nxt-btn .sb{font-size:10.5px;color:var(--nx-muted);line-height:1.3}',
      '.nxt-btn .pip{font-size:10px;color:var(--nx-gold);font-family:var(--nx-font-mono,monospace)}',
      // node cards
      '.nxt-node{border:1px solid var(--nx-highlight-faint);border-radius:14px;background:var(--nx-surface-2);padding:12px 13px;margin-bottom:10px}',
      '.nxt-node.off{opacity:.55}',
      '.nxt-node-top{display:flex;align-items:center;gap:8px}',
      '.nxt-dot{width:8px;height:8px;border-radius:50%;background:var(--nx-muted);flex:0 0 auto}',
      '.nxt-node.on .nxt-dot{background:var(--nx-green);box-shadow:0 0 7px var(--nx-green)}',
      '.nxt-node-name{font-weight:650;font-size:14px}',
      '.nxt-tag{margin-left:auto;font-size:9.5px;font-family:var(--nx-font-mono,monospace);text-transform:uppercase;letter-spacing:.06em;color:var(--nx-muted);border:1px solid var(--nx-gold-line);border-radius:999px;padding:1px 7px}',
      '.nxt-kv{display:grid;grid-template-columns:repeat(2,1fr);gap:3px 14px;margin-top:9px}',
      '.nxt-kv div{font-size:11.5px;color:var(--nx-muted)}',
      '.nxt-kv b{color:var(--nx-text);font-weight:600}',
      '.nxt-caps{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}',
      '.nxt-cap{font-size:9.5px;font-family:var(--nx-font-mono,monospace);text-transform:uppercase;padding:1px 7px;border-radius:999px;border:1px solid var(--nx-gold-line);color:var(--nx-gold)}',
      '.nxt-cap.no{color:var(--nx-faint);border-color:var(--nx-highlight-tint);opacity:.7}',
      // activity
      '.nxt-h4{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--nx-gold);margin:16px 2px 8px;font-weight:700;font-family:var(--nx-font-mono,monospace)}',
      '.nxt-h4:first-child{margin-top:2px}',
      '.nxt-job{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;border:1px solid var(--nx-highlight-tint);border-radius:9px;padding:7px 9px;margin-bottom:7px}',
      '.nxt-jk{font-family:var(--nx-font-mono,monospace);font-size:9px;text-transform:uppercase;padding:1px 6px;border-radius:999px;border:1px solid var(--nx-gold-line);color:var(--nx-gold)}',
      '.nxt-jk.vision{color:var(--nx-purple);border-color:var(--nx-purple)}.nxt-jk.cmd{color:var(--nx-red);border-color:var(--nx-red-line)}',
      '.nxt-jage{margin-left:auto;font-family:var(--nx-font-mono,monospace);font-size:10px;color:var(--nx-faint)}',
      '.nxt-tail{flex-basis:100%;font-family:var(--nx-font-mono,monospace);font-size:10px;color:var(--nx-faint);white-space:pre-wrap;word-break:break-word;background:var(--nx-surface-1);border-radius:6px;padding:5px 7px}',
      '.nxt-feeditem{font-size:11.5px;color:var(--nx-muted);display:flex;gap:7px;padding:3px 0}',
      '.nxt-feeditem .a{font-family:var(--nx-font-mono,monospace);font-size:10px;color:var(--nx-faint);min-width:30px}',
      '.nxt-empty{font-size:12px;color:var(--nx-muted);padding:14px 2px;text-align:center}',
      // primary action
      '.nxt-cta{display:block;width:100%;padding:13px;border-radius:var(--nx-radius-pill,999px);border:none;background:linear-gradient(180deg,var(--nx-gold),var(--nx-gold-deep));color:#241a06;font-weight:700;font-size:14px;cursor:pointer;margin-top:6px}',
      '.nxt-cta:disabled{opacity:.5;cursor:default}',
      '.nxt-ghost{display:block;width:100%;padding:11px;border-radius:var(--nx-radius-pill,999px);border:1px solid var(--nx-gold-line);background:transparent;color:var(--nx-text);font-weight:600;font-size:13px;cursor:pointer;margin-top:8px;text-align:center;text-decoration:none}',
      '.nxt-info{font-size:12px;color:var(--nx-muted);line-height:1.55;margin:2px 0 12px}',
      // install screens (themed)
      '.nxt-hero{display:flex;gap:13px;align-items:center;margin-bottom:14px}',
      '.nxt-hero .big{width:56px;height:56px;font-size:30px;border-radius:15px;display:grid;place-items:center;background:var(--nx-gold-faint);border:1px solid var(--nx-gold-line);flex:0 0 auto}',
      '.nxt-hero h3{margin:0 0 3px;font-size:20px;color:var(--nx-text)}.nxt-hero p{margin:0;color:var(--nx-muted);font-size:13px;line-height:1.45}',
      '.nxt-dls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 4px}',
      '.nxt-dl{display:inline-flex;flex-direction:column;text-decoration:none;border-radius:12px;padding:10px 15px;font-size:14px;font-weight:700;border:1px solid var(--nx-gold-line)}',
      '.nxt-dl .sm{font-weight:500;font-size:11px;opacity:.8;margin-top:1px}',
      '.nxt-dl.pri{background:linear-gradient(180deg,var(--nx-gold),var(--nx-gold-deep));color:#241a06;border:none}',
      '.nxt-dl.sec{background:var(--nx-gold-faint);color:var(--nx-text)}',
      '.nxt-feat{display:grid;gap:11px}.nxt-f{display:flex;gap:11px;align-items:flex-start}',
      '.nxt-f .d{font-size:17px;flex:0 0 auto}.nxt-f b{font-size:13.5px;color:var(--nx-text)}.nxt-f span{color:var(--nx-muted);font-size:12.5px;line-height:1.45}',
      '.nxt-steps{display:grid;gap:9px;counter-reset:s}',
      '.nxt-step{display:flex;gap:11px;align-items:flex-start;color:var(--nx-text);font-size:13px;line-height:1.5}',
      '.nxt-step::before{counter-increment:s;content:counter(s);flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--nx-gold-faint);color:var(--nx-gold);display:grid;place-items:center;font-size:12px;font-weight:700}',
      '.nxt-note{margin-top:18px;font-size:11.5px;color:var(--nx-faint);border-top:1px solid var(--nx-gold-line);padding-top:12px;line-height:1.55}',
    ].join('');
    document.head.appendChild(s);
  }

  function dl(href, big, small, cls) { return '<a class="nxt-dl ' + cls + '" href="' + href + '" download target="_blank" rel="noopener"><span>' + big + '</span><span class="sm">' + small + '</span></a>'; }
  function feat(d, b, s) { return '<div class="nxt-f"><span class="d">' + d + '</span><div><b>' + b + '</b><br><span>' + s + '</span></div></div>'; }
  function kindOf(d) { return d.cmd ? 'cmd' : ((d.vision || d.image_b64) ? 'vision' : 'text'); }

  // ─── HUB ─────────────────────────────────────────────────────────────────
  function screenHub(host) {
    host.innerHTML = '<div class="nxt-grid">' +
      btn('nodes', '🖥', 'Nodes', 'PCs in the pool') +
      btn('activity', '📊', 'Activity', 'live — what they\'re doing') +
      btn('push', '⬆', 'Push update', 'ship latest Clippy') +
      btn('clippy', '📎', 'Install Clippy', 'desktop buddy + node') +
      btn('ot', '📡', 'OpenTether', 'phone → PC internet') +
      '</div>';
    // live pill on Nodes/Activity buttons
    busGet('clippy_nodes').then(function (arr) {
      if (!Array.isArray(arr)) return;
      var on = arr.filter(fresh).length;
      [].forEach.call(host.querySelectorAll('[data-go="nodes"] .pip,[data-go="activity"] .pip'), function (p) {
        p.textContent = on ? ('● ' + on + ' online') : '○ none online';
      });
    });
  }
  function btn(go, ic, lb, sb) {
    return '<button class="nxt-btn" data-go="' + go + '"><span class="ic">' + ic + '</span><span class="lb">' + lb + '</span><span class="sb">' + sb + '</span><span class="pip"></span></button>';
  }

  // ─── NODES ───────────────────────────────────────────────────────────────
  function screenNodes(host) {
    host.innerHTML = '<div class="nxt-empty">Loading nodes…</div>';
    busGet('clippy_nodes').then(function (arr) {
      if (!Array.isArray(arr) || !arr.length) { host.innerHTML = '<div class="nxt-empty">○ No Clippy nodes registered.<br>Start the poller on a PC, then pull to refresh.</div>'; return; }
      arr.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      host.innerHTML = arr.map(function (n) {
        var on = fresh(n);
        var caps = (n.caps || []).reduce(function (m, c) { m[c] = 1; return m; }, {});
        var capChip = function (k, lb) { return '<span class="nxt-cap ' + ((caps[k] || (k === 'vision' && n.vision) || (k === 'cmd' && n.cmd)) ? '' : 'no') + '">' + lb + '</span>'; };
        var kv = function (k, v) { return v == null || v === '' ? '' : '<div>' + k + ' <b>' + esc(v) + '</b></div>'; };
        return '<div class="nxt-node ' + (on ? 'on' : 'off') + '">' +
          '<div class="nxt-node-top"><span class="nxt-dot"></span><span class="nxt-node-name">' + esc(nodeId(n)) + '</span>' +
            '<span class="nxt-tag">' + (on ? (n.busy ? 'working' : 'online') : 'offline ' + ago((n.ts || 0) * 1000)) + '</span></div>' +
          (n.current ? '<div class="nxt-info" style="margin:8px 0 0">▸ ' + esc(n.current) + '</div>' : '') +
          '<div class="nxt-kv">' +
            kv('OS', n.os) + kv('Host', n.role) + kv('Version', n.version) + kv('Model', n.model) +
            kv('GPU', n.gpu) + kv('CUDA', n.cuda == null ? '' : (n.cuda ? 'yes' : 'no')) +
            kv('CPU', n.cpu_pct != null ? n.cpu_pct + '%' : '') + kv('RAM', n.ram_pct != null ? n.ram_pct + '%' : '') +
            kv('Jobs done', n.jobs_done) + kv('Power', n.power) +
          '</div>' +
          '<div class="nxt-caps">' + capChip('ask', 'chat') + capChip('vision', 'vision') + capChip('cmd', 'commands') + '</div>' +
        '</div>';
      }).join('');
    });
  }

  // ─── ACTIVITY ────────────────────────────────────────────────────────────
  function screenActivity(host) {
    host.innerHTML = '<div class="nxt-empty">Loading activity…</div>';
    Promise.all([busGet('clippy_nodes'), busList('job:'), busGet('clippy_activity')]).then(function (res) {
      var nodes = Array.isArray(res[0]) ? res[0].filter(fresh) : [];
      var jobs = (res[1] || []).map(function (r) { return r.data; }).filter(Boolean);
      var feed = Array.isArray(res[2]) ? res[2] : [];
      var now = Date.now();
      var live = jobs.filter(function (d) { return ['pending', 'claimed', 'running'].indexOf(d.status) >= 0 && (now - (d.ts || 0) < 180000); });
      var html = '';
      html += '<div class="nxt-h4">Nodes</div>';
      html += nodes.length ? nodes.map(function (n) {
        var jb = live.filter(function (d) { return d.node === nodeId(n) && d.status !== 'pending'; })[0];
        var busy = !!jb || !!n.busy;
        return '<div class="nxt-node ' + (busy ? 'on' : '') + '"><div class="nxt-node-top"><span class="nxt-dot"></span>' +
          '<span class="nxt-node-name">' + esc(nodeId(n)) + '</span><span class="nxt-tag">' + (busy ? 'working' : 'idle') + '</span></div>' +
          (n.current || jb ? '<div class="nxt-info" style="margin:8px 0 0">▸ ' + esc(n.current || (kindOf(jb) + ' job')) + '</div>' : '') + '</div>';
      }).join('') : '<div class="nxt-empty">○ no nodes online</div>';
      if (live.length) {
        html += '<div class="nxt-h4">In flight (' + live.length + ')</div>';
        html += live.map(function (d) {
          var tail = d.tail || d.progress || '';
          return '<div class="nxt-job"><span class="nxt-jk ' + kindOf(d) + '">' + kindOf(d) + '</span><span style="color:var(--nx-muted)">' + esc(d.status) + '</span>' +
            '<span class="nxt-jage">' + ago(d.ts || now) + '</span>' + (tail ? '<div class="nxt-tail">' + esc(String(tail).slice(-220)) + '</div>' : '') + '</div>';
        }).join('');
      }
      if (feed.length) {
        html += '<div class="nxt-h4">Recent</div>' + feed.slice(-12).reverse().map(function (f) {
          return '<div class="nxt-feeditem"><span class="a">' + (f.ts ? ago(f.ts) : '') + '</span><span>' + esc((f.node ? f.node + ' · ' : '') + (f.msg || f.kind || '')) + '</span></div>';
        }).join('');
      }
      host.innerHTML = html;
    });
  }

  // ─── PUSH UPDATE ─────────────────────────────────────────────────────────
  function screenPush(host) {
    host.innerHTML = '<div class="nxt-empty">Loading…</div>';
    Promise.all([busGet('clippy_nodes'), busGet('clippy_release')]).then(function (res) {
      var nodes = (Array.isArray(res[0]) ? res[0] : []).filter(fresh);
      var rel = res[1] || {};
      var latest = rel.version || null;
      var rows = nodes.length ? nodes.map(function (n) {
        var stale = latest && n.version && String(n.version) !== String(latest);
        return '<div class="nxt-node on"><div class="nxt-node-top"><span class="nxt-dot"></span><span class="nxt-node-name">' + esc(nodeId(n)) + '</span>' +
          '<span class="nxt-tag">v' + esc(n.version || '?') + (stale ? ' · update' : ' · current') + '</span></div></div>';
      }).join('') : '<div class="nxt-empty">○ no nodes online to update</div>';
      host.innerHTML =
        '<div class="nxt-info">Ships the latest Clippy to every online node. The node downloads <code>clippy-update.ps1</code> from Supabase Storage and runs it (PowerShell), then restarts. Watch it stream under <b>Activity</b>.</div>' +
        '<div class="nxt-h4">Latest release</div>' +
        '<div class="nxt-info" style="margin-top:0">' + (latest ? ('v<b>' + esc(latest) + '</b>' + (rel.notes ? ' — ' + esc(rel.notes) : '')) : 'No release recorded yet. Upload <code>clippy-update.ps1</code> + the build to the <b>installers</b> bucket and set a <code>clippy_release</code> row.') + '</div>' +
        '<div class="nxt-h4">Online nodes</div>' + rows +
        '<button class="nxt-cta" id="nxtPush"' + (nodes.length ? '' : ' disabled') + '>⬆ Push update to ' + nodes.length + ' node' + (nodes.length === 1 ? '' : 's') + '</button>' +
        '<button class="nxt-ghost" id="nxtStopOld"' + (nodes.length ? '' : ' disabled') + '>⏻ Stop legacy v2.4.4 poller on all nodes</button>' +
        '<a class="nxt-ghost" href="' + F.updater + '" target="_blank" rel="noopener">View / download the updater script</a>' +
        '<div class="nxt-note">Command execution is token-gated per node. When a node is provisioned with <code>-CmdToken</code>, the daemon <b>auto-publishes the token to the bus</b>, so Push works here with no manual entry. (Trade-off: the bus is anon-readable, so that makes command-exec reachable by anyone with the site — drop the token to keep it manual.)</div>';
      var pb = document.getElementById('nxtPush');
      if (pb) pb.addEventListener('click', function () { pushUpdate(nodes, pb); });
      var so = document.getElementById('nxtStopOld');
      if (so) so.addEventListener('click', function () { stopOldPoller(nodes, so); });
    });
  }

  // Resolve the cmd token (bus-published → saved → prompt), then run cb(token).
  function withToken(cb, onCancel) {
    busGet('clippy_cmd').then(function (c) {
      var token = (c && c.token) || localStorage.getItem('nx_clippy_cmd_token') || '';
      if (!token) token = (window.prompt('Enter the CLIPPY_CMD_TOKEN set on your nodes (stored on this device only):') || '').trim();
      if (!token) { if (onCancel) onCancel(); return; }
      try { localStorage.setItem('nx_clippy_cmd_token', token); } catch (e) {}
      cb(token);
    });
  }
  function sendCmd(nodes, cmd, idPrefix, token) {
    var ts = Date.now();
    return Promise.all(nodes.map(function (n, i) {
      return busPost({ id: 'job:' + idPrefix + '-' + ts + '-' + i, from_id: 'nexus', data: { status: 'pending', cmd: cmd, token: token, shell: 'powershell', ts: ts } });
    }));
  }
  function pushUpdate(nodes, pb) {
    pb.disabled = true; pb.textContent = 'Pushing…';
    withToken(function (token) {
      var cmd = "$u='" + F.updater + "'; $o=\"$env:TEMP\\clippy-update.ps1\"; Invoke-WebRequest $u -OutFile $o; powershell -ExecutionPolicy Bypass -File $o";
      sendCmd(nodes, cmd, 'update', token).then(function () {
        pb.textContent = '✓ Sent — see Activity'; setTimeout(function () { NX.tools.go('activity'); }, 700);
      }).catch(function () { pb.disabled = false; pb.textContent = '⬆ Retry push'; });
    }, function () { pb.disabled = false; pb.textContent = '⬆ Push update'; });
  }
  function stopOldPoller(nodes, so) {
    so.disabled = true; so.textContent = 'Stopping…';
    withToken(function (token) {
      var cmd = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'clippy_brain' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force; \"stopped $($_.ProcessId)\" } catch {} }; 'old poller stopped'";
      sendCmd(nodes, cmd, 'stopold', token).then(function () {
        so.textContent = '✓ Sent — see Activity'; setTimeout(function () { NX.tools.go('activity'); }, 700);
      }).catch(function () { so.disabled = false; so.textContent = '⏻ Stop legacy v2.4.4 poller'; });
    }, function () { so.disabled = false; so.textContent = '⏻ Stop legacy v2.4.4 poller'; });
  }

  // ─── INSTALL screens (themed) ────────────────────────────────────────────
  function screenOT(host) {
    host.innerHTML = '<div class="nxt-hero"><div class="big">📡</div><div><h3>OpenTether</h3>' +
        '<p>Turn your phone into your PC\'s internet — open take on PdaNet/FoxFi. No root · no trial · no account · no ads.</p></div></div>' +
      '<div class="nxt-dls">' + dl(F.otWin, '🖥 Windows', 'PC client (.zip)', 'pri') + dl(F.otApk, '📱 Android', 'phone app (.apk)', 'sec') +
        '<div style="margin-left:auto;text-align:center;color:var(--nx-faint);font-size:11px"><img src="' + F.otQR + '" alt="" style="display:block;width:80px;height:80px;border-radius:10px;background:#fff;padding:5px;margin:0 auto 4px" onerror="this.parentNode.style.display=\'none\'">scan to install</div></div>' +
      '<div class="nxt-h4">Every function</div><div class="nxt-feat">' +
        feat('🧩', 'Multi-transport host', 'Serves the tunnel over USB, Wi-Fi-Direct and Wi-Fi/LAN at once.') +
        feat('🥷', 'Carrier-invisible', 'Re-originates every connection from the phone\'s own stack — defeats TTL/fingerprint detection, no root.') +
        feat('🧭', 'DNS on the phone', 'Lookups happen over the tunnel, never your laptop\'s carrier DNS — no resolver leak.') +
        feat('🛡', 'Kill-switch', 'Tunnel drops → all egress blocked. No silent fallback to the carrier. IPv4 + IPv6.') +
      '</div>' +
      '<div class="nxt-h4">Set up</div><div class="nxt-steps">' +
        '<div class="nxt-step">Phone: open OpenTether → <b>START</b> → pick USB / Wi-Fi-Direct / Wi-Fi.</div>' +
        '<div class="nxt-step">PC: run OpenTether → pair (AUTO for USB, or scan the QR).</div>' +
        '<div class="nxt-step">Point an app at <b>127.0.0.1:1080</b>, or flip the system-proxy toggle.</div></div>';
  }
  function screenClippy(host) {
    host.innerHTML = '<div class="nxt-hero"><div class="big">📎</div><div><h3>Clippy</h3>' +
        '<p>An offline AI desktop buddy (local Ollama brain) — and a worker node in your NEXUS pool that answers chat + vision jobs.</p></div></div>' +
      '<div class="nxt-dls">' + dl(F.clippy, '🖥 Download for Windows', '.zip · one-time setup', 'pri') + '</div>' +
      '<div class="nxt-h4">Every function</div><div class="nxt-feat">' +
        feat('💬', 'Offline chat', 'A local LLM (Ollama) — no cloud, no account, no API key.') +
        feat('👀', 'Vision', 'Reads photos (Scan Plate) with a local vision model — image never leaves the LAN.') +
        feat('🐝', 'Joins the hive', 'Registers into your Clippy pool so NEXUS uses its brain + GPU.') +
        feat('🧠', 'Remembers you', 'Persistent memory across restarts.') +
      '</div>' +
      '<div class="nxt-h4">Set up</div><div class="nxt-steps">' +
        '<div class="nxt-step">Unzip anywhere.</div>' +
        '<div class="nxt-step">Run <b>INSTALL-CLIPPY.cmd</b> (pulls Ollama + a local model).</div>' +
        '<div class="nxt-step">Double-click <b>clippy.cmd</b> — Clippy floats onto your desktop.</div></div>';
  }

  // ─── router ──────────────────────────────────────────────────────────────
  var SCREENS = {
    hub:      { t: 'Tools',          fn: screenHub,      live: false },
    nodes:    { t: 'Nodes',          fn: screenNodes,    live: true },
    activity: { t: 'Activity',       fn: screenActivity, live: true },
    push:     { t: 'Push update',    fn: screenPush,     live: false },
    clippy:   { t: 'Install Clippy', fn: screenClippy,   live: false },
    ot:       { t: 'OpenTether',     fn: screenOT,       live: false },
  };
  var timer = null;
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function build() {
    if (document.getElementById('nxToolsModal')) return;
    css();
    var ov = document.createElement('div'); ov.className = 'nxt-ov'; ov.id = 'nxToolsModal';
    ov.innerHTML = '<div class="nxt-card"><div class="nxt-hd">' +
      '<button class="nxt-bk" data-go="hub" style="display:none">‹ Back</button>' +
      '<h2 id="nxtTitle">Tools</h2><button class="nxt-x" aria-label="Close">✕</button></div>' +
      '<div class="nxt-content" id="nxtContent"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.classList.contains('nxt-x')) { NX.tools.close(); return; }
      var g = e.target.closest('[data-go]'); if (g) NX.tools.go(g.getAttribute('data-go'));
    });
  }

  NX.tools = {
    open: function () { build(); document.getElementById('nxToolsModal').classList.add('open'); NX.tools.go('hub'); },
    close: function () { stopTimer(); var m = document.getElementById('nxToolsModal'); if (m) m.classList.remove('open'); },
    go: function (screen) {
      stopTimer();
      var s = SCREENS[screen] || SCREENS.hub;
      document.getElementById('nxtTitle').textContent = s.t;
      var host = document.getElementById('nxtContent'); host.scrollTop = 0;
      s.fn(host);
      document.querySelector('#nxToolsModal .nxt-bk').style.display = (screen === 'hub') ? 'none' : '';
      if (s.live) timer = setInterval(function () {
        var m = document.getElementById('nxToolsModal');
        if (!m || !m.classList.contains('open')) { stopTimer(); return; }
        s.fn(host);
      }, 3500);
    },
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') NX.tools.close(); });
})();
