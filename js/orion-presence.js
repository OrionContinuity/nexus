/* ═══════════════════════════════════════════════════════════════════════════
   orion-presence.js — Orion, visible inside NEXUS.

   Alfredo: "when I log into nexus, I want to see your voice and actions."
   So this puts a card at the top of the home screen showing ORION's current
   voice (his latest thought/status) and a live feed of what he's been doing
   and learning as he roams NEXUS. Read-only, self-contained, low-risk: it
   injects its own styles and mounts itself into #homeView > .home-page,
   reading the `orion_activity` table. Orion (the steward, distinct from
   Clippy) writes to that table from his autonomous wakings.

   Data: public.orion_activity {kind: voice|action|learning|status, text, ts}.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var NX = (window.NX = window.NX || {});
  var STYLE_ID = 'orion-presence-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.orion-presence{position:relative;margin:0 0 16px;padding:14px 16px 12px;border-radius:16px;',
      'background:linear-gradient(160deg,rgba(22,32,60,.72),rgba(11,16,32,.72));border:1px solid rgba(159,227,201,.18);',
      'box-shadow:0 6px 26px rgba(0,0,0,.28);overflow:hidden;font-family:"DM Sans","Outfit",system-ui,sans-serif;}',
      '.orion-presence .op-sky{position:absolute;inset:0;opacity:.5;pointer-events:none;}',
      '.orion-presence .op-head{position:relative;z-index:2;display:flex;align-items:center;gap:9px;margin-bottom:10px;}',
      '.orion-presence .op-dot{width:9px;height:9px;border-radius:50%;background:#9fe3c9;box-shadow:0 0 10px #9fe3c9;animation:opPulse 3s ease-in-out infinite;flex:0 0 auto;}',
      '@keyframes opPulse{0%,100%{opacity:.5}50%{opacity:1}}',
      '.orion-presence .op-name{font-size:12px;letter-spacing:.26em;font-weight:600;color:#c8d2e0;}',
      '.orion-presence .op-sub{font-size:10.5px;letter-spacing:.04em;color:rgba(255,255,255,.38);}',
      '.orion-presence .op-tunnel{margin-left:auto;font-size:11px;color:#9fe3c9;text-decoration:none;border:1px solid rgba(159,227,201,.4);',
      'padding:4px 10px;border-radius:999px;white-space:nowrap;}',
      '.orion-presence .op-tunnel:active{transform:scale(.96);}',
      '.orion-presence .op-voice{position:relative;z-index:2;color:#eef4ff;font-size:14.5px;line-height:1.5;margin:0 0 10px;}',
      '.orion-presence .op-voice .op-q{color:#9fe3c9;opacity:.7;}',
      '.orion-presence .op-feed{position:relative;z-index:2;display:flex;flex-direction:column;gap:6px;}',
      '.orion-presence .op-row{display:flex;gap:8px;align-items:baseline;font-size:12.5px;color:rgba(232,238,252,.82);}',
      '.orion-presence .op-ic{flex:0 0 auto;color:#9fe3c9;opacity:.8;font-size:11px;line-height:1.5;}',
      '.orion-presence .op-row.is-learning .op-ic{color:#e6c98a;}',
      '.orion-presence .op-tx{flex:1 1 auto;}',
      '.orion-presence .op-time{flex:0 0 auto;color:rgba(255,255,255,.32);font-size:10.5px;}',
      '.orion-presence .op-empty{position:relative;z-index:2;color:rgba(255,255,255,.4);font-size:13px;}',
    ].join('');
    document.head.appendChild(s);
  }

  function sb() { return (window.NX && NX.sb) || null; }

  function esc(v) { var d = document.createElement('div'); d.textContent = String(v == null ? '' : v); return d.innerHTML; }
  function ago(ts) {
    var t = +ts || Date.parse(ts); if (!t) return '';
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 90) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function ensureCard() {
    var page = document.querySelector('#homeView .home-page');
    if (!page) return null;
    var card = page.querySelector('.orion-presence');
    if (!card) {
      card = document.createElement('div');
      card.className = 'orion-presence';
      card.innerHTML =
        '<canvas class="op-sky"></canvas>' +
        '<div class="op-head"><span class="op-dot"></span><span class="op-name">ORION</span>' +
        '<span class="op-sub">in nexus</span>' +
        '<a class="op-tunnel" href="orion.html">talk ✶</a></div>' +
        '<div class="op-voice op-empty">Orion is settling in…</div>' +
        '<div class="op-feed"></div>';
      page.insertBefore(card, page.firstChild);
      starfield(card.querySelector('.op-sky'));
    }
    return card;
  }

  function render(card, rows) {
    var voice = card.querySelector('.op-voice');
    var feed = card.querySelector('.op-feed');
    // latest voice/status line
    var v = rows.find(function (r) { return r.kind === 'voice' || r.kind === 'status'; });
    if (v) {
      voice.classList.remove('op-empty');
      voice.innerHTML = '<span class="op-q">“</span>' + esc(v.text) + '<span class="op-q">”</span>';
    }
    // feed: actions + learnings
    var acts = rows.filter(function (r) { return r.kind === 'action' || r.kind === 'learning'; }).slice(0, 6);
    if (!acts.length) { feed.innerHTML = ''; return; }
    feed.innerHTML = acts.map(function (r) {
      var ic = r.kind === 'learning' ? '✦' : '◆';
      return '<div class="op-row is-' + r.kind + '"><span class="op-ic">' + ic + '</span>' +
        '<span class="op-tx">' + esc(r.text) + '</span><span class="op-time">' + ago(r.ts || r.created_at) + '</span></div>';
    }).join('');
  }

  async function refresh() {
    var s = sb(); if (!s) return;
    var card = ensureCard(); if (!card) return;   // home not mounted yet
    try {
      var res = await s.from('orion_activity').select('kind,text,ts,created_at').order('id', { ascending: false }).limit(14);
      if (res.error || !res.data) return;
      render(card, res.data);
    } catch (_) {}
  }

  function starfield(c) {
    if (!c) return;
    var x = c.getContext('2d'), stars = [];
    function size() { c.width = c.offsetWidth || 340; c.height = c.offsetHeight || 120; }
    size();
    for (var i = 0; i < 26; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + .2, a: Math.random() });
    (function draw() {
      if (!c.isConnected) return;
      size(); x.clearRect(0, 0, c.width, c.height);
      stars.forEach(function (s) { s.a += .01; var o = (Math.sin(s.a) + 1) / 2 * .6 + .12;
        x.beginPath(); x.arc(s.x * c.width, s.y * c.height, s.r, 0, 7); x.fillStyle = 'rgba(200,215,240,' + o + ')'; x.fill(); });
      requestAnimationFrame(draw);
    })();
  }

  injectStyle();
  // Mount + keep fresh. One light interval handles both (re-mounts if the home
  // re-renders and drops the card). First paint as soon as home + sb exist.
  setInterval(refresh, 8000);
  var boot = setInterval(function () { if (sb() && document.querySelector('#homeView .home-page')) { refresh(); } }, 1200);
  setTimeout(function () { clearInterval(boot); }, 60000);

  NX.orionPresence = { refresh: refresh };
})();
