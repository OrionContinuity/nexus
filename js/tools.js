/* tools.js — NEXUS "Tools" modal: install + learn the companion apps (OpenTether + Clippy).
   Self-contained: injects its own overlay + styles, exposes NX.tools.open()/close()/go().
   Wired by the "Tools" button (onclick="...window.NX.tools.open()") that replaced Inventory.
   Downloads live in Supabase Storage bucket 'installers' (public) — see upload-installers.ps1. */
(function () {
  // app.js keeps a lexical `const NX` that is NOT window.NX — bind locally so we attach to window.NX
  // (the object inline onclick handlers read). Inline HTML must call window.NX.tools.*
  var NX = (window.NX = window.NX || {});
  var SB   = (window.NEXUS_CONFIG && window.NEXUS_CONFIG.SUPABASE_URL) || 'https://oprsthfxqrdbwdvommpw.supabase.co';
  var BASE = SB + '/storage/v1/object/public/installers/';
  var F = {
    clippy: BASE + 'Clippy-for-a-friend.zip',
    otApk:  BASE + 'OpenTether.apk',
    otWin:  BASE + 'OpenTether-Windows.zip',
    otQR:   BASE + 'OpenTether-QR.png',
  };

  function css() {
    if (document.getElementById('nxToolsStyle')) return;
    var s = document.createElement('style'); s.id = 'nxToolsStyle';
    s.textContent = [
      '.nxt-ov{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;background:rgba(4,12,18,.72);backdrop-filter:blur(3px);padding:14px}',
      '.nxt-ov.open{display:flex}',
      '.nxt-card{width:min(680px,97vw);max-height:92vh;display:flex;flex-direction:column;border-radius:20px;color:#eaf3f6;font-family:inherit;background:linear-gradient(180deg,#102832,#0a1922);border:1px solid rgba(120,190,220,.22);box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}',
      '.nxt-hd{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid rgba(120,190,220,.14);flex:0 0 auto}',
      '.nxt-hd h2{margin:0;font-size:18px;font-weight:700}',
      '.nxt-bk{cursor:pointer;border:0;background:rgba(255,255,255,.06);color:#cfe2e8;border-radius:9px;padding:6px 10px;font-size:13px;font-weight:600}',
      '.nxt-x{margin-left:auto;cursor:pointer;border:0;background:rgba(255,255,255,.06);color:#cfe2e8;width:32px;height:32px;border-radius:9px;font-size:17px}',
      '.nxt-content{padding:16px 18px 20px;overflow:auto}',
      '.nxt-card2{display:flex;gap:14px;align-items:flex-start;border:1px solid rgba(120,190,220,.16);border-radius:16px;padding:16px;background:rgba(255,255,255,.025);margin-bottom:12px;cursor:pointer;transition:border-color .15s,background .15s}',
      '.nxt-card2:hover{border-color:rgba(108,196,224,.5);background:rgba(108,196,224,.06)}',
      '.nxt-ic{width:50px;height:50px;border-radius:13px;display:grid;place-items:center;font-size:26px;flex:0 0 auto;background:rgba(108,196,224,.14);border:1px solid rgba(108,196,224,.25)}',
      '.nxt-card2 h3{margin:0 0 3px;font-size:17px}',
      '.nxt-card2 p{margin:0;color:#9fb6bf;font-size:13px;line-height:1.45}',
      '.nxt-go{margin-left:auto;align-self:center;color:#6cc4e0;font-size:22px;flex:0 0 auto}',
      '.nxt-hero{display:flex;gap:14px;align-items:center;margin-bottom:14px}',
      '.nxt-hero .big{width:60px;height:60px;font-size:32px;border-radius:15px;display:grid;place-items:center;background:rgba(108,196,224,.14);border:1px solid rgba(108,196,224,.25);flex:0 0 auto}',
      '.nxt-hero h3{margin:0 0 3px;font-size:21px}',
      '.nxt-hero p{margin:0;color:#9fb6bf;font-size:13.5px;line-height:1.45}',
      '.nxt-dls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 4px}',
      '.nxt-dl{display:inline-flex;flex-direction:column;text-decoration:none;border-radius:12px;padding:10px 16px;font-size:14px;font-weight:700;border:1px solid transparent}',
      '.nxt-dl .sm{font-weight:500;font-size:11px;opacity:.85;margin-top:1px}',
      '.nxt-dl.pri{background:linear-gradient(180deg,#e6c170,#caa24a);color:#241a06}',
      '.nxt-dl.sec{background:rgba(108,196,224,.12);color:#dcecf2;border-color:rgba(108,196,224,.32)}',
      '.nxt-qr{margin-left:auto;text-align:center;color:#80949c;font-size:11px}',
      '.nxt-qr img{display:block;width:84px;height:84px;border-radius:10px;background:#fff;padding:5px;margin:0 auto 4px}',
      '.nxt-h4{font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#6cc4e0;margin:22px 0 10px;font-weight:700}',
      '.nxt-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px}',
      '.nxt-mode{border:1px solid rgba(120,190,220,.16);border-radius:12px;padding:12px;background:rgba(255,255,255,.02)}',
      '.nxt-mode b{display:block;font-size:13.5px;margin-bottom:4px}',
      '.nxt-mode span{color:#9fb6bf;font-size:12px;line-height:1.4}',
      '.nxt-feat{display:grid;gap:11px}',
      '.nxt-f{display:flex;gap:11px;align-items:flex-start}',
      '.nxt-f .d{font-size:17px;line-height:1.1;flex:0 0 auto}',
      '.nxt-f b{font-size:13.5px}',
      '.nxt-f span{color:#9fb6bf;font-size:12.5px;line-height:1.45}',
      '.nxt-steps{display:grid;gap:9px;counter-reset:s}',
      '.nxt-step{display:flex;gap:11px;align-items:flex-start;color:#cfe0e6;font-size:13px;line-height:1.5}',
      '.nxt-step::before{counter-increment:s;content:counter(s);flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:rgba(108,196,224,.18);color:#9fe0f4;display:grid;place-items:center;font-size:12px;font-weight:700}',
      '.nxt-note{margin-top:18px;font-size:11.5px;color:#80949c;border-top:1px solid rgba(120,190,220,.12);padding-top:12px;line-height:1.55}',
    ].join('');
    document.head.appendChild(s);
  }

  function dl(href, big, small, cls) {
    return '<a class="nxt-dl ' + cls + '" href="' + href + '" download="' + href.split('/').pop() + '" target="_blank" rel="noopener"><span>' + big + '</span><span class="sm">' + small + '</span></a>';
  }
  function feat(d, b, s) { return '<div class="nxt-f"><span class="d">' + d + '</span><div><b>' + b + '</b><br><span>' + s + '</span></div></div>'; }

  function screenHome() {
    return '<div class="nxt-card2" data-go="ot"><div class="nxt-ic">📡</div><div><h3>OpenTether</h3>' +
        '<p>Share your phone\'s internet with your PC — over USB, Wi-Fi Direct, or Wi-Fi. No root, no trial, no account, no ads.</p></div><div class="nxt-go">›</div></div>' +
      '<div class="nxt-card2" data-go="clippy"><div class="nxt-ic">📎</div><div><h3>Clippy</h3>' +
        '<p>Your offline AI desktop buddy — and a worker node for the render farm. Runs 100% on your PC.</p></div><div class="nxt-go">›</div></div>';
  }

  function screenOT() {
    return '<div class="nxt-hero"><div class="big">📡</div><div><h3>OpenTether</h3>' +
        '<p>Turn your phone into your PC\'s internet — a clean-room, open take on PdaNet/FoxFi. No root · no trial · no account · no ads.</p></div></div>' +
      '<div class="nxt-dls">' + dl(F.otWin, '🖥 Windows', 'PC client (.zip)', 'pri') + dl(F.otApk, '📱 Android', 'phone app (.apk)', 'sec') +
        '<div class="nxt-qr"><img src="' + F.otQR + '" alt="" onerror="this.parentNode.style.display=\'none\'">scan to install<br>on phone</div></div>' +
      '<div class="nxt-h4">How your PC reaches the phone</div><div class="nxt-modes">' +
        '<div class="nxt-mode"><b>🔌 USB</b><span>Plug in the cable (USB-debugging on). Most stable + fastest, and charges while you browse.</span></div>' +
        '<div class="nxt-mode"><b>📶 Wi-Fi Direct</b><span>The phone makes its own hotspot; the PC scans the QR to auto-join. No router needed.</span></div>' +
        '<div class="nxt-mode"><b>🌐 Wi-Fi / LAN</b><span>Same Wi-Fi network — paste the phone\'s code or its IP. Totally cable-free.</span></div></div>' +
      '<div class="nxt-h4">Every function</div><div class="nxt-feat">' +
        feat('🧩', 'Multi-transport host', 'The phone serves the tunnel over USB, Wi-Fi-Direct and Wi-Fi/LAN at once — connect whichever way is handy.') +
        feat('🔀', 'Any client, auto-detected', 'The engine sniffs HTTP / HTTPS-CONNECT / SOCKS4 / SOCKS5 from the first byte — browsers, apps, or the OpenTether client all just work.') +
        feat('🥷', 'Carrier-invisible by design', 'Every connection is re-originated by the phone\'s own network stack, so packets carry the phone\'s native TTL + fingerprint — defeating the #1 tether-detection method with no root and no TTL hacks.') +
        feat('🧭', 'DNS resolved on the phone', 'Hostnames are looked up over the tunnel on the phone, never your laptop\'s carrier DNS — no resolver leak.') +
        feat('🔒', 'Lock to my device', 'One toggle blocks every OTHER device from your tether — only your paired PC gets through.') +
        feat('🖥', 'PC local proxy + system toggle', 'The Windows client exposes 127.0.0.1:1080 (SOCKS5 or HTTP) for any app, or flip one switch to route the whole system.') +
        feat('🛡', 'Kill-switch / no-leak', 'If the tunnel drops, all egress is blocked — no silent fallback to the carrier or a dead café Wi-Fi. IPv4 + IPv6 both captured.') +
        feat('🏠', '100% local & private', 'The control panel binds to 127.0.0.1 only; the single way out is through your phone. No cloud, no account, nothing phones home.') +
      '</div>' +
      '<div class="nxt-h4">Set up in 3 steps</div><div class="nxt-steps">' +
        '<div class="nxt-step">On the phone: open OpenTether → <b>START</b> → pick USB / Wi-Fi-Direct / Wi-Fi.</div>' +
        '<div class="nxt-step">On the PC: run OpenTether → pair (AUTO for USB, or scan the phone\'s QR).</div>' +
        '<div class="nxt-step">Browse. Point an app at <b>127.0.0.1:1080</b>, or flip the system-proxy toggle.</div></div>' +
      '<div class="nxt-note">Honest note: the design beats the detections used at scale (TTL + TCP/IP fingerprint) and handles DNS. Residuals are TLS (JA3) fingerprinting, sheer volume, and IPv6 if the client leaks it. Bypassing hotspot caps can violate your carrier\'s ToS — it\'s your data, but use it on your own line.</div>';
  }

  function screenClippy() {
    return '<div class="nxt-hero"><div class="big">📎</div><div><h3>Clippy</h3>' +
        '<p>An offline AI desktop buddy that runs 100% on your PC (a local Ollama brain) — and doubles as a worker node in your NEXUS render farm.</p></div></div>' +
      '<div class="nxt-dls">' + dl(F.clippy, '🖥 Download for Windows', '.zip · one-time setup', 'pri') + '</div>' +
      '<div class="nxt-h4">Every function</div><div class="nxt-feat">' +
        feat('💬', 'Offline chat', 'A local LLM (Ollama) — no cloud, no account, no API key. Private by default.') +
        feat('👀', 'Eyes + hands', 'Can see your screen and click/type to help with tasks (he asks first for anything risky).') +
        feat('🐝', 'Joins the hive', 'Registers into your NEXUS Clippy pool, so NEXUS — and this chat — can use his brain, and soon his GPU for model rendering.') +
        feat('🧠', 'Remembers you', 'Persistent memory across restarts, so he picks up where you left off.') +
      '</div>' +
      '<div class="nxt-h4">Set up in 3 steps</div><div class="nxt-steps">' +
        '<div class="nxt-step">Unzip the download anywhere.</div>' +
        '<div class="nxt-step">Run <b>INSTALL-CLIPPY.cmd</b> (one-time: pulls Ollama + a local model).</div>' +
        '<div class="nxt-step">Double-click <b>clippy.cmd</b> — Clippy floats onto your desktop. Hi!</div></div>';
  }

  var SCREENS = { home: { t: 'Tools — Install', html: screenHome }, ot: { t: 'OpenTether', html: screenOT }, clippy: { t: 'Clippy', html: screenClippy } };

  function build() {
    if (document.getElementById('nxToolsModal')) return;
    css();
    var ov = document.createElement('div'); ov.className = 'nxt-ov'; ov.id = 'nxToolsModal';
    ov.innerHTML = '<div class="nxt-card"><div class="nxt-hd"><button class="nxt-bk" data-go="home" style="display:none">‹ Back</button>' +
      '<h2 id="nxtTitle">Tools</h2><button class="nxt-x" aria-label="Close">✕</button></div>' +
      '<div class="nxt-content" id="nxtContent"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.classList.contains('nxt-x')) { NX.tools.close(); return; }
      var g = e.target.closest('[data-go]'); if (g) NX.tools.go(g.getAttribute('data-go'));
    });
    NX.tools.go('home');
  }

  NX.tools = {
    open: function () { build(); document.getElementById('nxToolsModal').classList.add('open'); },
    close: function () { var m = document.getElementById('nxToolsModal'); if (m) m.classList.remove('open'); },
    go: function (screen) {
      var s = SCREENS[screen] || SCREENS.home;
      document.getElementById('nxtTitle').textContent = s.t;
      var c = document.getElementById('nxtContent'); c.innerHTML = s.html(); c.scrollTop = 0;
      document.querySelector('#nxToolsModal .nxt-bk').style.display = (screen === 'home') ? 'none' : '';
    },
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') NX.tools.close(); });
})();
