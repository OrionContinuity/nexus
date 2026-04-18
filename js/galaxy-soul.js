/* ══════════════════════════════════════════════════════════════════════════════

   NEXUS — GALAXY SOUL  v2
   ────────────────────────

   Additive overlay: weather, memory halos, time scrubbing, diegetic chat beams.
   Reads state from NX.brain.state — never mutates it.

   v2 changes from v1:
     · Fixed black-disc artifact around NEXUS beacon (90px protection radius)
     · No mix-blend-mode — was trashing GPU raster on Android, causing the
       beacon to appear punched out of the overlay
     · Memory halos cached + capped to 40/frame + viewport culled
     · Auto perf mode if avg frame >22ms (<45fps) in first 90 frames
     · 30fps cap in perf mode (interpolated — feels identical visually)
     · Beams capped at 8/answer to survive large reference sets
     · Scrubber positioned correctly above bottom nav (bottom: 120px on mobile)
     · Kill switch: NX.galaxySoul.off() in console disables everything instantly

   ══════════════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  if (!window.NX || !window.NX.brain || !window.NX.brain.state) {
    return setTimeout(arguments.callee, 400);
  }

  const brainState = window.NX.brain.state;
  const baseCanvas = document.getElementById('brainCanvas');
  if (!baseCanvas) return;

  // Feature flags — user can disable any layer via localStorage if lag
  const ENABLED = {
    weather: localStorage.getItem('nexus_soul_weather') !== '0',
    memory:  localStorage.getItem('nexus_soul_memory')  !== '0',
    time:    localStorage.getItem('nexus_soul_time')    !== '0',
    beams:   localStorage.getItem('nexus_soul_beams')   !== '0',
  };
  let PERF_MODE = localStorage.getItem('nexus_soul_perf') === '1';

  /* ══════════════════════════════════════════════════════════════════════════
     OVERLAY CANVAS — NO mix-blend-mode this time.
     The previous version used screen blend which was the root cause of
     the "black disc around the beacon" visual. We just composite normally
     on a transparent canvas now. Additive feel comes from the colors
     themselves being bright (255,240,200 etc) with low alpha.
     ══════════════════════════════════════════════════════════════════════════ */

  const soul = document.createElement('canvas');
  soul.id = 'galaxySoul';
  soul.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2;
  `;
  baseCanvas.parentElement.appendChild(soul);
  const sctx = soul.getContext('2d', { alpha: true });

  let SW = 0, SH = 0, dpr = 1;
  function resize(){
    const r = baseCanvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.25);
    SW = r.width * dpr; SH = r.height * dpr;
    soul.width = SW; soul.height = SH;
    soul.style.width = r.width + 'px';
    soul.style.height = r.height + 'px';
  }
  resize();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (isVisible()) resize(); }, 200);
  });

  function isVisible(){
    const v = document.getElementById('brainView');
    return v && v.classList.contains('active');
  }
  function isDark(){ return document.documentElement.getAttribute('data-theme') !== 'light'; }

  // Beacon protection zone — never paint inside 90px of canvas center.
  // This is the fix for the black disc around NEXUS.
  function beaconCenter(){ return { x: SW/2, y: SH/2, r: 90 * dpr }; }


  /* ─── AUTO PERF DETECTION ─── */

  const perfMeter = { frames: 0, totalMs: 0, checkAt: 90 };
  function sampleFrame(delta){
    if (perfMeter.frames >= perfMeter.checkAt) return;
    perfMeter.frames++;
    perfMeter.totalMs += delta;
    if (perfMeter.frames === perfMeter.checkAt) {
      const avg = perfMeter.totalMs / perfMeter.frames;
      if (avg > 22 && !PERF_MODE) {
        PERF_MODE = true;
        console.log('[Soul] auto perf mode — avg frame', avg.toFixed(1), 'ms');
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     WEATHER
     ══════════════════════════════════════════════════════════════════════════ */

  const weather = {
    perCommunity: new Map(),
    globalMood: 'calm', globalSeverity: 0,
    lastRefresh: 0, inflight: false,
  };

  const MOOD_COLORS = {
    calm:      [140, 180, 200],
    tense:     [232, 168, 48],
    stormy:    [212, 88, 88],
    expectant: [160, 200, 255],
    sleepy:    [120, 115, 110],
  };

  async function refreshWeather(force){
    if (!NX.sb || weather.inflight) return;
    const now = Date.now();
    if (!force && now - weather.lastRefresh < 120_000) return;
    weather.inflight = true;
    weather.lastRefresh = now;

    const today = new Date().toISOString().split('T')[0];
    const in3 = new Date(Date.now() + 3*86400000).toISOString().split('T')[0];

    try {
      const safely = async (p) => { try { return await p; } catch { return { data: null }; } };
      const [eqDown, ticketsOpen, dispatchPending, patternsDue] = await Promise.all([
        safely(NX.sb.from('equipment').select('id, location, node_id').in('status', ['down','needs_service'])),
        safely(NX.sb.from('tickets').select('id, location, equipment_id').in('status', ['open','pending']).limit(200)),
        safely(NX.sb.from('dispatch_log').select('contractor_node_id').eq('outcome', 'pending')),
        safely(NX.sb.from('patterns').select('entity_node_id, next_predicted, confidence, location')
            .eq('active', true).gte('next_predicted', today).lte('next_predicted', in3)),
      ]);

      const byComm = new Map();
      const bump = (cid, reason, kind) => {
        if (cid == null) return;
        if (!byComm.has(cid)) byComm.set(cid, { reasons: [], expectant: 0, tense: 0, stormy: 0 });
        const r = byComm.get(cid); r.reasons.push(reason); r[kind]++;
      };

      const P = brainState.particles || [];
      const nodeToComm = new Map();
      P.forEach(p => { if (p.node?.id) nodeToComm.set(String(p.node.id), p.node.community_id); });

      (eqDown.data || []).forEach(e => bump(nodeToComm.get(String(e.node_id)), 'equipment down', 'stormy'));
      (ticketsOpen.data || []).forEach(t => bump(nodeToComm.get(String(t.equipment_id)), 'open ticket', 'tense'));
      (dispatchPending.data || []).forEach(d => bump(nodeToComm.get(String(d.contractor_node_id)), 'pending dispatch', 'tense'));
      (patternsDue.data || []).forEach(p => bump(nodeToComm.get(String(p.entity_node_id)), 'prediction imminent', 'expectant'));

      weather.perCommunity.clear();
      let gTense = 0, gStormy = 0, gExpectant = 0;
      for (const [cid, r] of byComm) {
        let mood = 'calm', sev = 0;
        if (r.stormy >= 2) { mood = 'stormy'; sev = Math.min(1, 0.5 + r.stormy * 0.15); }
        else if (r.stormy === 1 || r.tense >= 2) { mood = 'tense'; sev = Math.min(1, 0.35 + r.tense * 0.12); }
        else if (r.tense === 1) { mood = 'tense'; sev = 0.28; }
        else if (r.expectant > 0) { mood = 'expectant'; sev = Math.min(0.8, 0.3 + r.expectant * 0.18); }
        weather.perCommunity.set(cid, { mood, severity: sev });
        gStormy += r.stormy; gTense += r.tense; gExpectant += r.expectant;
      }

      const NINETY = 90 * 86400000;
      const commLast = new Map();
      P.forEach(p => {
        const cid = p.node?.community_id; if (cid == null) return;
        const d = p.node?.last_relevant_date ? new Date(p.node.last_relevant_date).getTime() : 0;
        if (!commLast.has(cid) || commLast.get(cid) < d) commLast.set(cid, d);
      });
      for (const [cid, lastD] of commLast) {
        if (weather.perCommunity.has(cid)) continue;
        if (lastD && now - lastD > NINETY) {
          const ageDays = (now - lastD) / 86400000;
          weather.perCommunity.set(cid, { mood: 'sleepy', severity: Math.min(0.5, (ageDays - 90) / 400) });
        }
      }

      if (gStormy >= 2) { weather.globalMood = 'stormy'; weather.globalSeverity = Math.min(1, 0.4 + gStormy * 0.1); }
      else if (gTense + gStormy >= 3) { weather.globalMood = 'tense'; weather.globalSeverity = 0.5; }
      else if (gExpectant > 0) { weather.globalMood = 'expectant'; weather.globalSeverity = 0.3; }
      else { weather.globalMood = 'calm'; weather.globalSeverity = 0; }

    } catch (e) {
      console.warn('[Soul/weather]', e.message);
    } finally {
      weather.inflight = false;
    }
  }

  function drawWeather(t){
    if (!ENABLED.weather) return;
    const centers = brainState.commCenters || {};
    if (!Object.keys(centers).length) return;
    const transform = brainState.transform || { x:0, y:0, scale:1 };

    for (const cidKey in centers) {
      const c = centers[cidKey];
      const cidNum = Number(cidKey);
      const w = weather.perCommunity.get(cidNum) || weather.perCommunity.get(cidKey);
      if (!w) continue;

      const color = MOOD_COLORS[w.mood] || MOOD_COLORS.calm;
      const cx = c.x * transform.scale + transform.x * dpr;
      const cy = c.y * transform.scale + transform.y * dpr;
      const radius = c.r * 2.4 * transform.scale;
      if (cx + radius < 0 || cx - radius > SW || cy + radius < 0 || cy - radius > SH) continue;

      const breath = 1 + Math.sin(t * (w.mood === 'expectant' ? 1.4 : 0.4) + cidNum) * 0.05;
      const rad = radius * breath;

      const g = sctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
      const peakAlpha = (0.10 * w.severity + 0.03) * (isDark() ? 1 : 0.7);
      g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${peakAlpha})`);
      g.addColorStop(0.6, `rgba(${color[0]},${color[1]},${color[2]},${peakAlpha * 0.35})`);
      g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
      sctx.fillStyle = g;
      sctx.beginPath(); sctx.arc(cx, cy, rad, 0, Math.PI*2); sctx.fill();

      if (w.mood === 'expectant') {
        const pulse = (Math.sin(t * 1.1 + cidNum) + 1) / 2;
        const pr = rad * (0.55 + pulse * 0.15);
        sctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.15 + pulse * 0.12})`;
        sctx.lineWidth = 1.2 * dpr;
        sctx.beginPath(); sctx.arc(cx, cy, pr, 0, Math.PI*2); sctx.stroke();
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     MEMORY — cached + capped + beacon-protected
     ══════════════════════════════════════════════════════════════════════════ */

  const memoryCache = { recentIndices: [], lastParticleCount: 0, lastRebuild: 0 };

  function rebuildMemoryCache(){
    const P = brainState.particles || [];
    const now = Date.now();
    const THIRTY = 30 * 86400000;
    memoryCache.recentIndices.length = 0;
    for (let i = 0; i < P.length; i++) {
      const last = P[i].node?.last_relevant_date;
      if (!last) continue;
      const age = now - new Date(last).getTime();
      if (age >= 0 && age < THIRTY) memoryCache.recentIndices.push(i);
    }
    memoryCache.lastParticleCount = P.length;
    memoryCache.lastRebuild = now;
  }

  function drawMemory(t){
    if (!ENABLED.memory) return;
    const P = brainState.particles || [];
    if (!P.length) return;
    if (P.length !== memoryCache.lastParticleCount || Date.now() - memoryCache.lastRebuild > 600_000) {
      rebuildMemoryCache();
    }
    if (!memoryCache.recentIndices.length) return;

    const transform = brainState.transform || { x:0, y:0, scale:1 };
    if (transform.scale < 0.5) return;

    const bc = beaconCenter();
    const now = Date.now();
    const SEVEN = 7 * 86400000;
    const THIRTY = 30 * 86400000;
    const MAX_HALOS = PERF_MODE ? 20 : 40;
    let drawn = 0;
    const sharedPulse = 0.92 + Math.sin(t * 1.8) * 0.08;

    for (let k = 0; k < memoryCache.recentIndices.length && drawn < MAX_HALOS; k++) {
      const p = P[memoryCache.recentIndices[k]]; if (!p) continue;
      const x = p.x * transform.scale + transform.x * dpr;
      const y = p.y * transform.scale + transform.y * dpr;
      if (x < -20 || x > SW + 20 || y < -20 || y > SH + 20) continue;
      if (Math.hypot(x - bc.x, y - bc.y) < bc.r) continue;  // beacon protection

      const age = now - new Date(p.node.last_relevant_date).getTime();
      if (age < 0 || age > THIRTY) continue;
      const warmth = 1 - age / THIRTY;
      const isVeryRecent = age < SEVEN;

      const r = 7 * dpr * (isVeryRecent ? 1.25 : 1) * (isVeryRecent ? sharedPulse : 1);
      const alpha = warmth * (isVeryRecent ? 0.20 : 0.10);

      sctx.fillStyle = `rgba(212,182,138,${alpha * 0.5})`;
      sctx.beginPath(); sctx.arc(x, y, r * 1.8, 0, Math.PI*2); sctx.fill();
      sctx.fillStyle = `rgba(212,182,138,${alpha})`;
      sctx.beginPath(); sctx.arc(x, y, r * 0.6, 0, Math.PI*2); sctx.fill();

      drawn++;
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     TIME SCRUBBER
     ══════════════════════════════════════════════════════════════════════════ */

  const time = {
    active: false, offsetDays: 0, targetOffsetDays: 0,
    maxPastDays: 365, maxFutureDays: 60, predictions: [],
  };

  function buildScrubberUI(){
    let bar = document.getElementById('timeScrubber');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'timeScrubber';
    bar.innerHTML = `
      <div class="ts-track">
        <div class="ts-marker-now"></div>
        <div class="ts-cursor"></div>
        <div class="ts-bubble">today</div>
      </div>
      <button class="ts-audio-toggle" title="Ambient sound">·</button>
    `;
    document.body.appendChild(bar);

    const cursor = bar.querySelector('.ts-cursor');
    const track = bar.querySelector('.ts-track');
    const bubble = bar.querySelector('.ts-bubble');
    const totalRange = time.maxPastDays + time.maxFutureDays;

    const daysToX = (d) => ((d + time.maxPastDays) / totalRange) * 100;
    const xToDays = (xPct) => Math.round(xPct/100 * totalRange - time.maxPastDays);

    const updateCursor = () => {
      const pct = daysToX(time.offsetDays);
      cursor.style.left = pct + '%';
      bubble.style.left = pct + '%';
      if (time.offsetDays === 0) { bubble.textContent = 'today'; bubble.className = 'ts-bubble'; }
      else if (time.offsetDays < 0) {
        const d = -time.offsetDays;
        bubble.textContent = d < 7 ? `${d}d ago` : d < 60 ? `${Math.round(d/7)}w ago` : `${Math.round(d/30)}mo ago`;
        bubble.className = 'ts-bubble past';
      } else {
        const d = time.offsetDays;
        bubble.textContent = d < 7 ? `in ${d}d` : `in ${Math.round(d/7)}w`;
        bubble.className = 'ts-bubble future';
      }
    };

    const setFromPointer = (clientX) => {
      const r = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
      time.offsetDays = xToDays(pct);
      time.targetOffsetDays = time.offsetDays;
      updateCursor();
    };

    const onDown = (e) => {
      time.active = true;
      bar.classList.add('active');
      setFromPointer(e.clientX || e.touches?.[0]?.clientX || 0);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!time.active) return;
      setFromPointer(e.clientX || e.touches?.[0]?.clientX || 0);
    };
    const onUp = () => {
      if (!time.active) return;
      time.active = false;
      bar.classList.remove('active');
      if (Math.abs(time.offsetDays) < 4) { time.offsetDays = 0; time.targetOffsetDays = 0; }
      else { time.targetOffsetDays = 0; }
      updateCursor();
    };

    track.addEventListener('mousedown', onDown);
    track.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    time._updateCursor = updateCursor;
    updateCursor();

    const audioBtn = bar.querySelector('.ts-audio-toggle');
    audioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ambient.enabled = !ambient.enabled;
      localStorage.setItem('nexus_soul_audio', ambient.enabled ? '1' : '0');
      audioBtn.innerHTML = ambient.enabled ? '♪' : '·';
      if (ambient.enabled) { ensureAmbientCtx(); chime(659.25, 1.5, 0.05); }
    });
    if (ambient.enabled) audioBtn.innerHTML = '♪';
    return bar;
  }
  setTimeout(buildScrubberUI, 150);

  async function loadPredictions(){
    if (!NX.sb) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await NX.sb.from('patterns')
        .select('entity_node_id, entity_name, next_predicted, confidence, location')
        .eq('active', true).gte('next_predicted', today).gte('confidence', 0.4).limit(100);
      time.predictions = data || [];
    } catch (e) {}
  }
  loadPredictions();

  function drawTimeOverlay(t){
    if (!ENABLED.time) return;
    if (!time.active && time.offsetDays !== time.targetOffsetDays) {
      time.offsetDays += (time.targetOffsetDays - time.offsetDays) * 0.08;
      if (Math.abs(time.offsetDays - time.targetOffsetDays) < 0.3) {
        time.offsetDays = time.targetOffsetDays;
      }
      if (time._updateCursor) time._updateCursor();
    }
    const offset = time.offsetDays;
    if (Math.abs(offset) < 0.5) return;

    const P = brainState.particles || [];
    const transform = brainState.transform || { x:0, y:0, scale:1 };
    const now = Date.now();
    const cursorTime = now + offset * 86400000;
    const bc = beaconCenter();

    if (offset < 0) {
      const bgColor = isDark() ? 'rgba(17,17,22,0.78)' : 'rgba(244,241,235,0.78)';
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const last = p.node?.last_relevant_date; if (!last) continue;
        const lastT = new Date(last).getTime();
        const x = p.x * transform.scale + transform.x * dpr;
        const y = p.y * transform.scale + transform.y * dpr;
        if (x < 0 || x > SW || y < 0 || y > SH) continue;
        if (Math.hypot(x - bc.x, y - bc.y) < bc.r) continue;

        if (lastT > cursorTime) {
          sctx.fillStyle = bgColor;
          sctx.beginPath(); sctx.arc(x, y, 3.5 * dpr, 0, Math.PI*2); sctx.fill();
        } else {
          const ageFromCursor = cursorTime - lastT;
          const WINDOW = 14 * 86400000;
          if (ageFromCursor >= 0 && ageFromCursor < WINDOW) {
            const w = 1 - ageFromCursor / WINDOW;
            const a = w * 0.35;
            sctx.fillStyle = `rgba(180,200,230,${a * 0.5})`;
            sctx.beginPath(); sctx.arc(x, y, 9 * dpr, 0, Math.PI*2); sctx.fill();
            sctx.fillStyle = `rgba(180,200,230,${a})`;
            sctx.beginPath(); sctx.arc(x, y, 4 * dpr, 0, Math.PI*2); sctx.fill();
          }
        }
      }
    }

    if (offset > 0) {
      const cursorDate = new Date(now + offset * 86400000).toISOString().split('T')[0];
      const pulse = (Math.sin(t * 1.6) + 1) / 2;
      for (const pred of time.predictions) {
        if (!pred.next_predicted || !pred.entity_node_id) continue;
        if (pred.next_predicted > cursorDate) continue;
        const particle = P.find(x => String(x.node?.id) === String(pred.entity_node_id));
        if (!particle) continue;
        const x = particle.x * transform.scale + transform.x * dpr;
        const y = particle.y * transform.scale + transform.y * dpr;
        if (x < 0 || x > SW || y < 0 || y > SH) continue;
        const a = pred.confidence * (0.4 + pulse * 0.3);
        sctx.strokeStyle = `rgba(160,200,255,${a})`;
        sctx.lineWidth = 1.5 * dpr;
        sctx.beginPath(); sctx.arc(x, y, 14 * dpr, 0, Math.PI*2); sctx.stroke();
        sctx.fillStyle = `rgba(200,220,255,${a})`;
        sctx.font = `${10 * dpr}px "JetBrains Mono"`;
        sctx.textAlign = 'center';
        sctx.fillText('◇', x, y - 20 * dpr);
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     DIEGETIC BEAMS — capped at 8/answer, simpler tail
     ══════════════════════════════════════════════════════════════════════════ */

  const beams = [];
  const knownActivated = new Set();

  function getChatBubbleAnchor(){
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return null;
    const ai = msgs.querySelector('.msg-ai:last-child, .hud-msg-ai:last-child, [data-role="ai"]:last-child')
            || msgs.lastElementChild;
    if (!ai) return null;
    const b = ai.getBoundingClientRect();
    const cr = baseCanvas.getBoundingClientRect();
    return { x: (b.left + b.width/2 - cr.left) * dpr, y: (b.top - cr.top) * dpr };
  }

  function spawnBeamsFromActivated(){
    const ids = brainState.activatedNodes;
    if (!ids || !ids.size) return;
    const MAX_BEAMS = 8;
    let spawned = 0;
    for (const id of ids) {
      if (spawned >= MAX_BEAMS) break;
      if (knownActivated.has(id)) continue;
      knownActivated.add(id);
      const P = brainState.particles || [];
      const p = P.find(x => x.id === id || x.node?.id === id);
      if (!p) continue;
      beams.push({ sourceParticle: p, sourceId: id,
        spawnedAt: performance.now(),
        duration: 1600 + Math.random() * 600,
        phase: Math.random() * Math.PI * 2 });
      spawned++;
    }
  }

  let lastActivatedHash = '';
  setInterval(() => {
    const s = brainState.activatedNodes;
    let hash = '';
    if (s) { for (const id of s) hash += id + '|'; }
    if (!s || !s.size) knownActivated.clear();
    if (hash !== lastActivatedHash) {
      lastActivatedHash = hash;
      if (s && s.size > 0) spawnBeamsFromActivated();
    }
  }, 350);

  function drawBeams(now){
    if (!ENABLED.beams || !beams.length) return;
    const target = getChatBubbleAnchor();
    const transform = brainState.transform || { x:0, y:0, scale:1 };

    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      const elapsed = now - b.spawnedAt;
      const progress = Math.min(1, elapsed / b.duration);
      if (progress >= 1) { beams.splice(i, 1); continue; }

      const sx = b.sourceParticle.x * transform.scale + transform.x * dpr;
      const sy = b.sourceParticle.y * transform.scale + transform.y * dpr;
      const tx = target ? target.x : SW/2;
      const ty = target ? target.y : SH/2 - 40;

      const p = progress < 0.5 ? 4*progress*progress*progress : 1 - Math.pow(-2*progress + 2, 3)/2;
      const dx = tx - sx, dy = ty - sy;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const perpX = -dy / len, perpY = dx / len;
      const curveAmt = Math.min(len * 0.15, 100 * dpr) * Math.sin(b.phase) * (b.sourceParticle.x < SW/2 ? 1 : -1);
      const mx = (sx + tx) / 2 + perpX * curveAmt;
      const my = (sy + ty) / 2 + perpY * curveAmt;

      const u = 1 - p;
      const px = u*u*sx + 2*u*p*mx + p*p*tx;
      const py = u*u*sy + 2*u*p*my + p*p*ty;

      const TAIL = PERF_MODE ? 4 : 6;
      sctx.lineCap = 'round';
      let prevX = sx, prevY = sy;
      for (let k = 1; k <= TAIL; k++) {
        const kp = Math.max(0, p - k * 0.04);
        const kpe = kp < 0.5 ? 4*kp*kp*kp : 1 - Math.pow(-2*kp + 2, 3)/2;
        const ku = 1 - kpe;
        const kx = ku*ku*sx + 2*ku*kpe*mx + kpe*kpe*tx;
        const ky = ku*ku*sy + 2*ku*kpe*my + kpe*kpe*ty;
        const tailAlpha = (1 - k/TAIL) * (1 - progress*0.4) * 0.55;
        sctx.strokeStyle = `rgba(212,182,138,${tailAlpha})`;
        sctx.lineWidth = (1 + (1 - k/TAIL) * 2) * dpr;
        sctx.beginPath(); sctx.moveTo(prevX, prevY); sctx.lineTo(kx, ky); sctx.stroke();
        prevX = kx; prevY = ky;
      }

      const headAlpha = progress < 0.9 ? 1 : (1 - progress) * 10;
      sctx.fillStyle = `rgba(255,240,200,${headAlpha})`;
      if (!PERF_MODE) {
        sctx.shadowColor = `rgba(212,182,138,${headAlpha * 0.8})`;
        sctx.shadowBlur = 14 * dpr;
      }
      sctx.beginPath(); sctx.arc(px, py, 3 * dpr, 0, Math.PI*2); sctx.fill();
      sctx.shadowBlur = 0;

      if (progress > 0.82) {
        const arrAlpha = (progress - 0.82) * 5;
        sctx.fillStyle = `rgba(255,248,220,${Math.min(arrAlpha, 0.8)})`;
        sctx.beginPath(); sctx.arc(tx, ty, 5 * dpr, 0, Math.PI*2); sctx.fill();
      }
    }
  }


  /* ──────── AMBIENT SOUND ──────── */

  const ambient = { enabled: localStorage.getItem('nexus_soul_audio') === '1', ctx: null, master: null, lastTone: 0 };
  function ensureAmbientCtx(){
    if (ambient.ctx) return ambient.ctx;
    try {
      ambient.ctx = new (window.AudioContext || window.webkitAudioContext)();
      ambient.master = ambient.ctx.createGain();
      ambient.master.gain.value = 0.15;
      ambient.master.connect(ambient.ctx.destination);
    } catch (e) { return null; }
    return ambient.ctx;
  }
  function chime(freq, duration, gain){
    if (!ambient.enabled) return;
    const ctx = ensureAmbientCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    if (now - ambient.lastTone < 0.12) return;
    ambient.lastTone = now;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain || 0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g); g.connect(ambient.master);
    osc.start(now); osc.stop(now + duration + 0.05);
  }
  let lastDelivered = 0;
  function ambientPulse(){
    const delivered = beams.filter(b => (performance.now() - b.spawnedAt) / b.duration > 0.82).length;
    if (delivered > lastDelivered) {
      const notes = [523.25, 587.33, 659.25, 783.99, 880.00];
      chime(notes[Math.floor(Math.random() * notes.length)], 1.2, 0.04);
    }
    lastDelivered = delivered;
  }


  /* ──────── MAIN LOOP — framerate-capped ──────── */

  let lastFrame = performance.now();
  let accum = 0;
  function loop(now){
    requestAnimationFrame(loop);
    if (!isVisible()) { lastFrame = now; return; }
    const delta = now - lastFrame;
    lastFrame = now;
    sampleFrame(delta);
    const budget = PERF_MODE ? 33 : 16;
    accum += delta;
    if (accum < budget) return;
    accum = 0;

    const t = now / 1000;
    sctx.clearRect(0, 0, SW, SH);
    drawWeather(t);
    drawMemory(t);
    drawTimeOverlay(t);
    drawBeams(now);
    ambientPulse();
  }
  requestAnimationFrame(loop);

  refreshWeather(true);
  setInterval(() => { if (isVisible()) refreshWeather(false); }, 120_000);
  setInterval(loadPredictions, 5 * 60_000);

  function syncScrubberVisibility(){
    const bar = document.getElementById('timeScrubber');
    if (!bar) return;
    bar.style.display = isVisible() ? '' : 'none';
  }
  setTimeout(syncScrubberVisibility, 400);
  const bv = document.getElementById('brainView');
  if (bv) new MutationObserver(syncScrubberVisibility).observe(bv, { attributes: true, attributeFilter: ['class'] });


  /* ──────── KILL SWITCH + DEBUG API ──────── */

  window.NX.galaxySoul = {
    weather, time, beams, ENABLED,
    refreshWeather,
    off: () => { soul.style.display = 'none'; const s = document.getElementById('timeScrubber'); if(s) s.style.display='none'; console.log('[Soul] OFF'); },
    on:  () => { soul.style.display = ''; const s = document.getElementById('timeScrubber'); if(s) s.style.display=''; console.log('[Soul] ON'); },
    perf: () => { PERF_MODE = true; localStorage.setItem('nexus_soul_perf', '1'); console.log('[Soul] perf mode'); },
    fast: () => { PERF_MODE = false; localStorage.setItem('nexus_soul_perf', '0'); console.log('[Soul] fast mode'); },
    disable: (layer) => { ENABLED[layer] = false; localStorage.setItem('nexus_soul_' + layer, '0'); console.log('[Soul]', layer, 'off'); },
    enable:  (layer) => { ENABLED[layer] = true; localStorage.setItem('nexus_soul_' + layer, '1'); console.log('[Soul]', layer, 'on'); },
    pingBeam: (nodeId) => {
      const P = brainState.particles || [];
      const p = P.find(x => x.id === nodeId || x.node?.id === nodeId);
      if (!p) return;
      beams.push({ sourceParticle: p, sourceId: nodeId, spawnedAt: performance.now(), duration: 2000, phase: Math.random()*Math.PI*2 });
    }
  };

  console.log('[Soul v2] ready. If laggy: NX.galaxySoul.perf() — If broken: NX.galaxySoul.off()');
})();
