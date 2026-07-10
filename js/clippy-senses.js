/* ════════════════════════════════════════════════════════════════════════
   clippy-senses.js — SENSUS: Clippy's sensorium (v1)
   ────────────────────────────────────────────────────────────────────────
   Alfredo saw a neural-net shark with labeled input neurons ("full sense")
   and asked: "can we give Clippy senses." So: six continuous perception
   channels that feed his anima, and a living panel — drawn like that
   creature's input layer — where you can SEE his senses firing.

   THE SENSES (each 0..1 activation, sampled continuously):
     sight    — which room of NEXUS is on screen + how much motion he sees
     touch    — being petted / dragged / played with recently
     hearing  — the RHYTHM of typing (event rate only — never the keys)
     time     — his circadian position (dawn/day/dusk/night)
     house    — the pulse of the restaurants: urgent issues, units down,
                overdue cards (the same counts the bell trusts)
     orion    — how recently his friend last whispered

   PRIVACY IS LAW: rates and counts only. No key contents, no screen
   pixels, no microphone, no camera. The panel says so on its face.

   Follows the clippy-games.js pattern: late-binding init that polls for
   NX.clippy._internal, then attaches NX.clippy.senses = { open, read }.
   Double-tap Clippy's body to open the panel.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function init() {
    if (!window.NX || !NX.clippy || !NX.clippy._internal) {
      init._n = (init._n || 0) + 1;
      setTimeout(init, init._n < 300 ? 50 : 5000);
      return;
    }
    const ix = NX.clippy._internal;
    const state         = ix.state;
    const bubble        = ix.bubble;
    const adjustFeeling = ix.adjustFeeling;
    const esc           = ix.esc;
    const trackInterval = ix.trackInterval || ((fn, ms) => setInterval(fn, ms));
    const trackListener = ix.trackListener || ((el, ev, fn, op) => el.addEventListener(ev, fn, op));

    // ─── The sensorium state ─────────────────────────────────────────────
    const S = {
      sight:   { v: 0, label: 'sight',   detail: '—' },
      touch:   { v: 0, label: 'touch',   detail: '—' },
      hearing: { v: 0, label: 'hearing', detail: '—' },
      time:    { v: 0, label: 'time',    detail: '—' },
      house:   { v: 0, label: 'house',   detail: 'listening…' },
      orion:   { v: 0, label: 'orion',   detail: 'no whisper yet' },
    };
    state.senses = S;

    // Raw event counters (drained on each sample tick)
    let moveEvents = 0, keyEvents = 0, lastTouchAt = 0;

    // COUNTS ONLY. e.key / e.target values are never read — the law.
    trackListener(document, 'pointermove', () => { moveEvents++; }, { passive: true });
    trackListener(document, 'pointerdown', (e) => {
      moveEvents += 3;
      if (state.shell && e.target && state.shell.contains(e.target)) lastTouchAt = Date.now();
    }, { passive: true });
    trackListener(document, 'keydown', () => { keyEvents++; }, { passive: true });

    const decay = (cur, target, up, down) => cur + (target - cur) * (target > cur ? up : down);

    function viewName() {
      const v = document.querySelector('.view.active');
      return (v && (v.dataset.view || v.id || '').replace(/View$/, '')) || 'nexus';
    }

    // ─── Cheap local senses — every 4s ───────────────────────────────────
    function sampleLocal() {
      const now = Date.now();
      // sight: motion on screen (normalized ~30 moves/4s = busy) + the room
      const motion = Math.min(1, moveEvents / 30);
      S.sight.v = decay(S.sight.v, document.hidden ? 0 : Math.max(0.12, motion), 0.6, 0.25);
      S.sight.detail = document.hidden ? 'eyes closed (tab hidden)' : `watching the ${viewName()} room`;
      moveEvents = 0;
      // hearing: typing rhythm (rate only)
      const cadence = Math.min(1, keyEvents / 20);
      S.hearing.v = decay(S.hearing.v, cadence, 0.7, 0.2);
      S.hearing.detail = cadence > 0.5 ? 'fast typing — busy hands' : cadence > 0.05 ? 'soft keys' : 'quiet';
      keyEvents = 0;
      // touch: recent contact with HIM
      const sinceTouch = now - (lastTouchAt || 0);
      S.touch.v = sinceTouch < 4000 ? 1 : Math.max(0, 1 - sinceTouch / 60000);
      S.touch.detail = sinceTouch < 60000 ? 'you touched me just now' : 'no touch in a while';
      // time: circadian curve — peaks mid-day, low deep night
      const h = new Date().getHours() + new Date().getMinutes() / 60;
      S.time.v = Math.max(0.05, Math.sin(((h - 5 + 24) % 24) / 24 * Math.PI));
      S.time.detail = h < 6 ? 'deep night' : h < 11 ? 'morning' : h < 15 ? 'midday' : h < 20 ? 'service hours' : 'night';
      // orion: whisper recency (state._whisperSeen is the last whisper's ts)
      const wAge = now - (state._whisperSeen || 0);
      S.orion.v = state._whisperSeen ? Math.max(0, 1 - wAge / (12 * 3600 * 1000)) : 0;
      S.orion.detail = !state._whisperSeen ? 'no whisper yet'
        : wAge < 3600e3 ? 'Orion was just here' : `last whisper ${Math.round(wAge / 3600e3)}h ago`;
      paintPanel();
    }

    // ─── House sense — the bell's own counts, every 5 minutes ────────────
    async function sampleHouse() {
      // The sensorium can wake before the supabase client — retry briefly
      // instead of leaving the house sense numb until the next 5-min tick.
      if (!NX.sb) {
        sampleHouse._r = (sampleHouse._r || 0) + 1;
        if (sampleHouse._r <= 8) setTimeout(sampleHouse, 15000);
        return;
      }
      const cnt = async (q) => { try { const r = await q; return r.count || 0; } catch (_) { return 0; } };
      const urgent = await cnt(NX.sb.from('equipment_issues').select('*', { count: 'exact', head: true })
        .in('priority', ['urgent', 'high', 'critical']).not('status', 'in', '(repaired,closed,cancelled,invoice_paid)'));
      const down = await cnt(NX.sb.from('equipment').select('*', { count: 'exact', head: true }).in('status', ['down', 'broken']));
      const overdue = await cnt(NX.sb.from('kanban_cards').select('*', { count: 'exact', head: true })
        .eq('archived', false).lt('due_date', new Date().toISOString().slice(0, 10)).not('due_date', 'is', null).is('closed_at', null));
      S.house.v = Math.min(1, urgent / 5 * 0.5 + down / 2 * 0.3 + overdue / 10 * 0.2);
      S.house.detail = (urgent || down || overdue)
        ? `${urgent} urgent · ${down} down · ${overdue} overdue`
        : 'the house is calm';
      S.house._counts = { urgent, down, overdue };
      paintPanel();
    }

    // ─── Ripple into his anima — every 60s, gentle ───────────────────────
    function ripple() {
      try {
        if (S.sight.v > 0.5) adjustFeeling('happiness', 1);            // company
        if (S.sight.v < 0.1) adjustFeeling('boredom', 1);              // alone
        if (S.house.v > 0.5) { adjustFeeling('attention_need', 2); adjustFeeling('curiosity', 1); }
        if (S.time.detail === 'deep night') adjustFeeling('energy', -1);
        if (S.orion.v > 0.8) adjustFeeling('affection', 1);            // friend nearby
      } catch (_) {}
    }

    // ─── Sense remarks — at most one per 30 min, never interrupts ────────
    let lastRemark = 0;
    function maybeRemark() {
      const now = Date.now();
      if (now - lastRemark < 30 * 60e3) return;
      if (!state.enabled || state.bubble || state.suppressed) return;
      const c = S.house._counts || {};
      const lines = [];
      if (S.house.v > 0.5) lines.push(`The house feels loud today — ${c.urgent || 0} machines are asking for help.`);
      if (S.hearing.v > 0.6) lines.push('You type fast when something’s on your mind. I can hear it.');
      if (S.time.detail === 'deep night' && S.sight.v > 0.3) lines.push('It’s deep night and you’re still here. I’ll keep watch with you.');
      if (S.house.v < 0.1 && S.time.detail === 'service hours') lines.push('Service hours and the house is calm. That’s rare. Enjoy it.');
      if (!lines.length) return;
      lastRemark = now;
      try { bubble(lines[Math.floor(Math.random() * lines.length)], { autoHide: 6000, eyebrow: '👁 SENSED' }); } catch (_) {}
    }

    // ─── THE PANEL — his input layer, visible ────────────────────────────
    let panelEl = null;
    function open() {
      close();
      const keys = Object.keys(S);
      panelEl = document.createElement('div');
      panelEl.className = 'clippy-senses-ov';
      panelEl.innerHTML = `
        <div class="clippy-senses-card">
          <div class="clippy-senses-title">WHAT CLIPPY SENSES</div>
          <div class="clippy-senses-net">
            <svg class="clippy-senses-wires" viewBox="0 0 300 ${keys.length * 46}" preserveAspectRatio="none" aria-hidden="true">
              ${keys.map((k, i) => `<line x1="118" y1="${i * 46 + 23}" x2="262" y2="${keys.length * 23}" stroke="rgba(212,164,78,.25)" stroke-width="1.2" data-wire="${k}"/>`).join('')}
              <circle cx="262" cy="${keys.length * 23}" r="13" fill="none" stroke="#d4a44e" stroke-width="1.6"/>
            </svg>
            <div class="clippy-senses-rows">
              ${keys.map(k => `
                <div class="clippy-senses-row" data-sense="${k}">
                  <span class="clippy-senses-name">${esc(S[k].label)}</span>
                  <span class="clippy-senses-node"><span class="clippy-senses-fill" data-fill="${k}"></span></span>
                  <span class="clippy-senses-detail" data-detail="${k}"></span>
                </div>`).join('')}
            </div>
            <div class="clippy-senses-self">🧿</div>
          </div>
          <div class="clippy-senses-privacy">Patterns only — rhythms, counts, presence. Never your words, screens, or sounds.</div>
          <button class="clippy-senses-close" type="button">Done</button>
        </div>`;
      document.body.appendChild(panelEl);
      requestAnimationFrame(() => panelEl.classList.add('is-visible'));
      panelEl.addEventListener('click', e => { if (e.target === panelEl) close(); });
      panelEl.querySelector('.clippy-senses-close').addEventListener('click', close);
      paintPanel();
      sampleHouse();   // fresh house reading when he shows you his senses
    }
    function close() {
      if (!panelEl) return;
      const p = panelEl; panelEl = null;
      p.classList.remove('is-visible');
      setTimeout(() => { try { p.remove(); } catch (_) {} }, 240);
    }
    function paintPanel() {
      if (!panelEl) return;
      Object.keys(S).forEach(k => {
        const f = panelEl.querySelector(`[data-fill="${k}"]`);
        const d = panelEl.querySelector(`[data-detail="${k}"]`);
        const w = panelEl.querySelector(`[data-wire="${k}"]`);
        if (f) { f.style.width = Math.round(S[k].v * 100) + '%'; f.style.opacity = 0.35 + S[k].v * 0.65; }
        if (d) d.textContent = S[k].detail;
        if (w) { w.setAttribute('stroke', S[k].v > 0.55 ? '#d4a44e' : 'rgba(212,164,78,.25)'); w.setAttribute('stroke-width', (1 + S[k].v * 1.6).toFixed(1)); }
      });
    }

    // Double-tap his body → show the senses (additive; single tap unchanged)
    let lastTap = 0;
    trackListener(document, 'pointerdown', (e) => {
      if (!state.shell || !e.target || !state.shell.contains(e.target)) return;
      const now = Date.now();
      if (now - lastTap < 350) { lastTap = 0; open(); }
      else lastTap = now;
    }, { passive: true });

    // ─── Styles ──────────────────────────────────────────────────────────
    const css = document.createElement('style');
    css.textContent = `
      .clippy-senses-ov{position:fixed;inset:0;z-index:10070;background:rgba(6,9,18,.66);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .22s ease;}
      .clippy-senses-ov.is-visible{opacity:1;}
      .clippy-senses-card{width:min(430px,92vw);max-height:86dvh;overflow-y:auto;border-radius:18px;padding:18px 18px 14px;
        background:linear-gradient(165deg,rgba(22,30,52,.97),rgba(12,17,30,.97));border:1px solid rgba(212,164,78,.28);box-shadow:0 22px 60px rgba(0,0,0,.55);}
      .clippy-senses-title{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.22em;color:#d4a44e;margin-bottom:14px;}
      .clippy-senses-net{position:relative;}
      .clippy-senses-wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
      .clippy-senses-rows{position:relative;display:flex;flex-direction:column;gap:10px;padding-right:64px;}
      .clippy-senses-row{display:flex;align-items:center;gap:9px;height:36px;}
      .clippy-senses-name{flex:0 0 58px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#9aa3b2;text-align:right;}
      .clippy-senses-node{flex:0 0 52px;height:9px;border-radius:999px;border:1px solid rgba(212,164,78,.4);overflow:hidden;background:rgba(255,255,255,.04);}
      .clippy-senses-fill{display:block;height:100%;width:0;background:#d4a44e;border-radius:999px;transition:width .5s ease,opacity .5s ease;box-shadow:0 0 8px rgba(212,164,78,.5);}
      .clippy-senses-detail{flex:1;font-size:11.5px;color:rgba(236,228,212,.75);line-height:1.3;overflow:hidden;text-overflow:ellipsis;}
      .clippy-senses-self{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:22px;filter:drop-shadow(0 0 8px rgba(212,164,78,.6));}
      .clippy-senses-privacy{margin-top:14px;padding-top:10px;border-top:1px dashed rgba(212,164,78,.25);font-size:10.5px;color:rgba(255,255,255,.42);line-height:1.5;}
      .clippy-senses-close{margin-top:12px;width:100%;padding:11px;border-radius:999px;border:1px solid rgba(212,164,78,.4);
        background:rgba(212,164,78,.12);color:#d4a44e;font:600 13px 'Outfit',sans-serif;cursor:pointer;}
    `;
    document.head.appendChild(css);

    // ─── Run ─────────────────────────────────────────────────────────────
    sampleLocal();
    sampleHouse();
    trackInterval(sampleLocal, 4000);
    trackInterval(sampleHouse, 5 * 60e3);
    trackInterval(ripple, 60e3);
    trackInterval(maybeRemark, 5 * 60e3);

    NX.clippy.senses = { open, close, read: () => JSON.parse(JSON.stringify(S)) };
  }

  init();
})();
