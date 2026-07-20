// ═══════════════════════════════════════════════════════════════════════════
// 🎮 CLIPPY CONTROLLER PANEL — a control panel for the F310 game mapping.
// Lives inside Clippy's long-press menu ("🎮 Controller"). Every button, every
// speed, every deadzone — editable from NEXUS, no antimicrox GUI needed.
//
// How a change reaches the PC: Save upserts ONE bus row
//   clippy_sync/clippy_controller_cfg   { games: { minecraft: {...} }, ts }
// The worker on each controller-enabled node polls that row, regenerates the
// game's .amgp from the config (same XML rules as the committed profile),
// kills the running mapper, and the daemon revives it with the new profile
// within seconds. Empty/absent row = the committed repo profile stands.
//
// Defaults below mirror minecraft.gamecontroller.amgp v2 (the agent-researched
// toddler map, 2026-07-18) — so the panel opens showing the live truth.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var NX = window.NX = window.NX || {};
  function sb() { return NX && NX.sb ? NX.sb : null; }

  var ROW_ID = 'clippy_controller_cfg';

  // ── The action catalog — everything a control can emit ────────────────────
  // qt = Qt key hex for keyboard slots; mb = antimicrox mousebutton code.
  var ACTIONS = [
    { id: 'none',      label: '— nothing (safe) —' },
    { id: 'jump',      label: 'Jump (Space)',            qt: 0x20 },
    { id: 'sneak',     label: 'Sneak / dismount (Shift)', qt: 0x1000020 },
    { id: 'sprint',    label: 'Sprint (Ctrl)',           qt: 0x1000021 },
    { id: 'inventory', label: 'Inventory (E)',           qt: 0x45 },
    { id: 'camera',    label: 'Camera view (F5)',        qt: 0x1000034 },
    { id: 'swap',      label: 'Swap offhand (F)',        qt: 0x46 },
    { id: 'drop',      label: 'Drop item (Q) ⚠',         qt: 0x51 },
    { id: 'pause',     label: 'Pause menu (Esc) ⚠',      qt: 0x1000000 },
    { id: 'chat',      label: 'Chat (T) ⚠',              qt: 0x54 },
    { id: 'attack',    label: 'Mine / attack (left mouse)',  mb: 1 },
    { id: 'use',       label: 'Place / use (right mouse)',   mb: 3 },
    { id: 'hotprev',   label: 'Hotbar previous (wheel up)',  mb: 4, wheel: true },
    { id: 'hotnext',   label: 'Hotbar next (wheel down)',    mb: 5, wheel: true },
    { id: 'slot1', label: 'Hotbar slot 1', qt: 0x31 }, { id: 'slot2', label: 'Hotbar slot 2', qt: 0x32 },
    { id: 'slot3', label: 'Hotbar slot 3', qt: 0x33 }, { id: 'slot4', label: 'Hotbar slot 4', qt: 0x34 },
    { id: 'slot5', label: 'Hotbar slot 5', qt: 0x35 }, { id: 'slot6', label: 'Hotbar slot 6', qt: 0x36 },
    { id: 'slot7', label: 'Hotbar slot 7', qt: 0x37 }, { id: 'slot8', label: 'Hotbar slot 8', qt: 0x38 },
    { id: 'slot9', label: 'Hotbar slot 9', qt: 0x39 },
  ];
  function actionById(id) { for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i]; return ACTIONS[0]; }

  // ── The mappable controls (F310 in X mode) ───────────────────────────────
  var CONTROLS = [
    { key: 'a',     label: 'A',                  hint: 'green button' },
    { key: 'b',     label: 'B',                  hint: 'red button' },
    { key: 'x',     label: 'X',                  hint: 'blue button' },
    { key: 'y',     label: 'Y',                  hint: 'yellow button' },
    { key: 'lt',    label: 'LT (left trigger)',  hint: 'front lower left' },
    { key: 'rt',    label: 'RT (right trigger)', hint: 'front lower right' },
    { key: 'lb',    label: 'LB (left bumper)',   hint: 'front upper left' },
    { key: 'rb',    label: 'RB (right bumper)',  hint: 'front upper right' },
    { key: 'start', label: 'Start',              hint: '≡' },
    { key: 'back',  label: 'Back',               hint: '⧉' },
    { key: 'l3',    label: 'L3 (left stick click)',  hint: 'press the stick' },
    { key: 'r3',    label: 'R3 (right stick click)', hint: 'press the stick' },
    { key: 'dup',    label: 'D-pad Up',    hint: '' },
    { key: 'ddown',  label: 'D-pad Down',  hint: '' },
    { key: 'dleft',  label: 'D-pad Left',  hint: '' },
    { key: 'dright', label: 'D-pad Right', hint: '' },
  ];

  // ── Presets ──────────────────────────────────────────────────────────────
  // Toddler = the committed v2 profile, exactly. Adult = fuller classic map.
  var PRESETS = {
    toddler: {
      label: '📎 Toddler (recommended)',
      buttons: { a: 'jump', b: 'sneak', x: 'camera', y: 'inventory', lt: 'use', rt: 'attack',
                 lb: 'hotprev', rb: 'hotnext', start: 'none', back: 'none', l3: 'none', r3: 'none',
                 dup: 'none', ddown: 'none', dleft: 'none', dright: 'none' },
      tuning: { camX: 35, camY: 22, easing: 'easing-quadratic', easingDur: 1.0,   // v330: 35/22 matches the committed minecraft.gamecontroller.amgp (the x1.6 raise, commit 2370c01) — the old 22/14 here silently reverted it on any panel Save
                rightDead: 7500, rightMax: 30000, leftDead: 6000, diagRange: 25,
                stickDelay: 10, wheelSpeed: 1, trigDead: 2000 },
    },
    adult: {
      label: '🧑 Adult',
      buttons: { a: 'jump', b: 'sneak', x: 'inventory', y: 'swap', lt: 'use', rt: 'attack',
                 lb: 'hotprev', rb: 'hotnext', start: 'pause', back: 'camera', l3: 'sprint', r3: 'none',
                 dup: 'none', ddown: 'drop', dleft: 'none', dright: 'none' },
      tuning: { camX: 50, camY: 35, easing: 'easing-cubic', easingDur: 0.5,
                rightDead: 6000, rightMax: 30000, leftDead: 5000, diagRange: 25,
                stickDelay: 0, wheelSpeed: 1, trigDead: 2000 },
    },
  };

  // Numeric tuning fields: [key, label, min, max, step, unit, help]
  var TUNING = [
    ['camX',       'Camera speed — horizontal', 5, 100, 1, '', 'higher = faster look left/right (toddler 35, adult 50)'],
    ['camY',       'Camera speed — vertical',   5, 100, 1, '', 'keep ~64% of horizontal so the sky/feet stare stops (toddler 22)'],
    ['easingDur',  'Camera ramp-up time',       0.1, 2, 0.1, 's', 'how long a full tilt takes to reach top speed'],
    ['rightDead',  'Camera stick dead zone',    2000, 15000, 500, '', 'bigger = ignores more resting-thumb wobble (toddler 7500)'],
    ['leftDead',   'Move stick dead zone',      2000, 15000, 500, '', 'when walking starts (toddler 6000)'],
    ['diagRange',  'Move diagonal range',       15, 45, 1, '°', 'smaller = "mostly forward" snaps to pure forward (toddler 25)'],
    ['stickDelay', 'Move debounce',             0, 100, 5, 'ms', 'kills accidental double-tap sprint (toddler 10)'],
    ['wheelSpeed', 'Hotbar scroll speed',       1, 20, 1, '', '1 = one slot per tap (toddler 1; the old 20 spun ~20 slots/s)'],
    ['trigDead',   'Trigger dead zone',         500, 8000, 250, '', 'how far to pull before mine/place fires (default 2000)'],
  ];
  var EASINGS = [
    ['linear',           'Linear (no ramp)'],
    ['easing-quadratic', 'Gentle ramp (toddler)'],
    ['easing-cubic',     'Snappy ramp (adult)'],
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function defaults() { return clone(PRESETS.toddler); }

  // ── Bus IO ───────────────────────────────────────────────────────────────
  async function loadCfg(game) {
    try {
      var c = sb(); if (!c) return null;
      var r = await c.from('clippy_sync').select('data').eq('id', ROW_ID).maybeSingle();
      if (r.error || !r.data || !r.data.data) return null;
      var g = r.data.data.games && r.data.data.games[game];
      return g ? clone(g) : null;
    } catch (_) { return null; }
  }
  async function saveCfg(game, cfg) {
    var c = sb(); if (!c) return { error: 'no bus' };
    // v330: start from the WHOLE existing row, not a games-only skeleton — the old code discarded
    // top-level keys (esp. enable_all) on every save, and treated a failed pre-read as an empty
    // row, wiping every other game's config. Abort on read error instead.
    var r = await c.from('clippy_sync').select('data').eq('id', ROW_ID).maybeSingle();
    if (r.error) return { error: 'could not read existing config: ' + (r.error.message || 'read failed') };
    var full = (r.data && r.data.data && typeof r.data.data === 'object') ? clone(r.data.data) : {};
    if (!full.games) full.games = {};
    full.games[game] = cfg;
    full.ts = Date.now(); full.by = 'nexus-panel';
    var w = await c.from('clippy_sync').upsert({ id: ROW_ID, data: full, from_id: 'nexus' }, { onConflict: 'id' });
    return { error: w.error ? (w.error.message || 'save failed') : null };
  }
  async function clearCfg(game) {
    var c = sb(); if (!c) return { error: 'no bus' };
    // v330: report the outcome (Reset used to always claim success even when the clear failed) and
    // abort on read error so a flaky read can't blow away every other game's override.
    var r = await c.from('clippy_sync').select('data').eq('id', ROW_ID).maybeSingle();
    if (r.error) return { error: 'could not read existing config: ' + (r.error.message || 'read failed') };
    var full = (r.data && r.data.data && typeof r.data.data === 'object') ? clone(r.data.data) : { games: {} };
    if (full.games) delete full.games[game];
    full.ts = Date.now(); full.by = 'nexus-panel';
    var w = await c.from('clippy_sync').upsert({ id: ROW_ID, data: full, from_id: 'nexus' }, { onConflict: 'id' });
    return { error: w.error ? (w.error.message || 'clear failed') : null };
  }
  async function setEnableAll(on) {
    // One switch for every machine: workers see enable_all on the bus and
    // create/remove their local controller.on flag — no per-PC setup ever.
    var c = sb(); if (!c) return { error: 'no bus' };
    // v330: abort on read error (was proceeding with an empty skeleton → wiped all game configs)
    var r = await c.from('clippy_sync').select('data').eq('id', ROW_ID).maybeSingle();
    if (r.error) return { error: 'could not read existing config: ' + (r.error.message || 'read failed') };
    var full = (r.data && r.data.data && typeof r.data.data === 'object') ? clone(r.data.data) : {};
    if (!full.games) full.games = {};
    full.enable_all = { on: !!on, ts: Date.now() };
    var w = await c.from('clippy_sync').upsert({ id: ROW_ID, data: full, from_id: 'nexus' }, { onConflict: 'id' });
    return { error: w.error ? (w.error.message || 'save failed') : null };
  }

  async function listGames() {
    // The committed registry is served by Pages right next to the app.
    try {
      var res = await fetch('controller-profiles.json', { cache: 'no-store' });
      if (res.ok) {
        var j = await res.json();
        if (j && j.games && j.games.length) return j.games;
      }
    } catch (_) {}
    return [{ name: 'minecraft', title: 'Minecraft Java' }];
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  var panel = null;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function close() { if (panel) { try { panel.remove(); } catch (_) {} panel = null; } }

  async function show() {
    close();
    var games = await listGames();
    var game = games[0].name;
    var cfg = (await loadCfg(game)) || defaults();
    if (!cfg.buttons) cfg.buttons = defaults().buttons;
    if (!cfg.tuning) cfg.tuning = defaults().tuning;

    panel = el('div', 'clippy-ctrl-overlay');
    var card = el('div', 'clippy-ctrl-card');
    panel.appendChild(card);

    // header
    var head = el('div', 'clippy-ctrl-head');
    head.appendChild(el('div', 'clippy-ctrl-title', '🎮 Controller — every button, every speed'));
    var closeBtn = el('button', 'clippy-ctrl-x', '✕');
    closeBtn.onclick = close;
    head.appendChild(closeBtn);
    card.appendChild(head);

    var sub = el('div', 'clippy-ctrl-sub');
    sub.textContent = 'Changes save to the cloud; the PC applies them within ~a minute (next game launch at the latest).';
    card.appendChild(sub);

    // game selector
    var gameRow = el('div', 'clippy-ctrl-gamerow');
    gameRow.appendChild(el('label', null, 'Game'));
    var gameSel = el('select', 'clippy-ctrl-select');
    games.forEach(function (g) {
      var o = el('option', null, g.title || g.name); o.value = g.name; gameSel.appendChild(o);
    });
    gameRow.appendChild(gameSel);
    card.appendChild(gameRow);

    // enable-everywhere switch — the '🎮 works on every machine' button
    var enRow = el('div', 'clippy-ctrl-presets');
    var enBtn = el('button', 'clippy-ctrl-preset', '🖥️ Enable controller on ALL machines');
    enBtn.onclick = async function () {
      enBtn.disabled = true; setStatus('Enabling everywhere…');
      var r = await setEnableAll(true);
      enBtn.disabled = false;
      setStatus(r.error ? ('⚠ ' + r.error) : '✓ Every machine enables its controller within ~a minute (mapper installs itself at first game launch).');
    };
    var disBtn = el('button', 'clippy-ctrl-preset', '⏸ Disable everywhere');
    disBtn.onclick = async function () {
      disBtn.disabled = true; setStatus('Disabling everywhere…');
      var r = await setEnableAll(false);
      disBtn.disabled = false;
      setStatus(r.error ? ('⚠ ' + r.error) : '✓ Controller mapping turns off on every machine within ~a minute.');
    };
    enRow.appendChild(enBtn); enRow.appendChild(disBtn);
    card.appendChild(enRow);

    // presets
    var presetRow = el('div', 'clippy-ctrl-presets');
    Object.keys(PRESETS).forEach(function (pk) {
      var b = el('button', 'clippy-ctrl-preset', PRESETS[pk].label);
      b.onclick = function () { cfg = clone(PRESETS[pk]); delete cfg.label; renderBody(); setStatus('Preset loaded — not saved yet.'); };
      presetRow.appendChild(b);
    });
    card.appendChild(presetRow);

    var body = el('div', 'clippy-ctrl-body');
    card.appendChild(body);

    function renderBody() {
      body.innerHTML = '';
      // buttons grid
      body.appendChild(el('div', 'clippy-ctrl-sect', 'Buttons'));
      CONTROLS.forEach(function (c) {
        var row = el('div', 'clippy-ctrl-row');
        var lab = el('label', null, c.label);
        if (c.hint) lab.title = c.hint;
        row.appendChild(lab);
        var sel = el('select', 'clippy-ctrl-select');
        ACTIONS.forEach(function (a) {
          var o = el('option', null, a.label); o.value = a.id; sel.appendChild(o);
        });
        sel.value = cfg.buttons[c.key] || 'none';
        sel.onchange = function () { cfg.buttons[c.key] = sel.value; setStatus('Changed — not saved yet.'); };
        row.appendChild(sel);
        body.appendChild(row);
      });
      // sticks note
      var note = el('div', 'clippy-ctrl-note');
      note.textContent = 'Left stick always moves (WASD) · Right stick always looks (mouse). Tune their feel below.';
      body.appendChild(note);
      // tuning sliders
      body.appendChild(el('div', 'clippy-ctrl-sect', 'Feel'));
      TUNING.forEach(function (t) {
        var key = t[0], row = el('div', 'clippy-ctrl-row is-slider');
        var lab = el('label', null, t[1]); lab.title = t[6] || ''; row.appendChild(lab);
        var wrap = el('div', 'clippy-ctrl-sliderwrap');
        var input = el('input', 'clippy-ctrl-slider');
        input.type = 'range'; input.min = t[2]; input.max = t[3]; input.step = t[4];
        input.value = cfg.tuning[key] != null ? cfg.tuning[key] : t[2];
        var val = el('span', 'clippy-ctrl-val', String(input.value) + (t[5] || ''));
        input.oninput = function () {
          cfg.tuning[key] = parseFloat(input.value);
          val.textContent = String(input.value) + (t[5] || '');
          setStatus('Changed — not saved yet.');
        };
        wrap.appendChild(input); wrap.appendChild(val);
        row.appendChild(wrap);
        var help = el('div', 'clippy-ctrl-help', t[6] || '');
        body.appendChild(row);
        body.appendChild(help);
      });
      // easing dropdown
      var eRow = el('div', 'clippy-ctrl-row');
      eRow.appendChild(el('label', null, 'Camera ramp curve'));
      var eSel = el('select', 'clippy-ctrl-select');
      EASINGS.forEach(function (e2) { var o = el('option', null, e2[1]); o.value = e2[0]; eSel.appendChild(o); });
      eSel.value = cfg.tuning.easing || 'easing-quadratic';
      eSel.onchange = function () { cfg.tuning.easing = eSel.value; setStatus('Changed — not saved yet.'); };
      eRow.appendChild(eSel);
      body.appendChild(eRow);
    }
    renderBody();

    // footer: status + actions
    var status = el('div', 'clippy-ctrl-status', '');
    function setStatus(t) { status.textContent = t || ''; }
    card.appendChild(status);
    var foot = el('div', 'clippy-ctrl-foot');
    var saveBtn = el('button', 'clippy-ctrl-save', '💾 Save & send to the PC');
    saveBtn.onclick = async function () {
      saveBtn.disabled = true; setStatus('Saving…');
      var out = clone(cfg); delete out.label; out.updated = Date.now();
      var r = await saveCfg(gameSel.value, out);
      saveBtn.disabled = false;
      setStatus(r.error ? ('⚠ ' + r.error) : '✓ Saved. The PC picks it up within ~a minute (or next game launch).');
    };
    var resetBtn = el('button', 'clippy-ctrl-reset', '↩ Back to committed default');
    resetBtn.onclick = async function () {
      resetBtn.disabled = true; setStatus('Clearing override…');
      await clearCfg(gameSel.value);
      cfg = defaults(); delete cfg.label; renderBody();
      resetBtn.disabled = false;
      setStatus('✓ Override cleared — the repo profile (toddler v2) stands.');
    };
    foot.appendChild(saveBtn); foot.appendChild(resetBtn);
    card.appendChild(foot);

    gameSel.onchange = async function () {
      cfg = (await loadCfg(gameSel.value)) || defaults();
      if (cfg.label) delete cfg.label;
      if (!cfg.buttons) cfg.buttons = defaults().buttons;
      if (!cfg.tuning) cfg.tuning = defaults().tuning;
      renderBody(); setStatus('');
    };

    panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
    document.body.appendChild(panel);
  }

  NX.clippyController = { show: show, close: close, ACTIONS: ACTIONS, PRESETS: PRESETS };
})();
