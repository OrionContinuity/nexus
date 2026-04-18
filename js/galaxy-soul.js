/* ══════════════════════════════════════════════════════════════════════════════

   NEXUS — GALAXY SOUL
   ───────────────────

   This is not a feature. This is a change in what the galaxy is.

   The galaxy is no longer a visualization of a graph. It is a place that
   remembers. It has weather. It breathes. It has time. When NEXUS speaks,
   the knowledge itself lights up and answers — not a footnote, not a
   citation list, but the actual constellations lighting up to say
   "I am what she's asking about."

   Four layers compose here, each a film of light over the existing canvas:

     · WEATHER      — the galaxy reflects the live state of the business.
                       pressure systems, amber haze when things are tense,
                       pulse when something is predicted to happen soon.

     · TIME         — scrub a gentle ribbon at the bottom and the galaxy
                       moves through time. nodes dim to show what was
                       relevant then. predicted events appear as ghosts
                       of what's coming.

     · DIEGETIC     — when NEXUS answers, beams of light trace from the
                       referenced nodes to the chat bubble. the knowledge
                       itself is speaking. citations are light.

     · MEMORY       — nodes that haven't been touched in a year fade.
                       the galaxy has the same memory gradient that
                       human memory has. what matters stays bright.
                       everything else drifts softly to the periphery.

   This file reads state from brain-canvas (window.NX.brain.state) and
   renders on a transparent overlay canvas pinned on top. It never
   touches the underlying galaxy. If this file is deleted the galaxy
   reverts to what it was before, unharmed.

   Load this AFTER brain-canvas.js in index.html.

   ══════════════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // Wait until the base galaxy exists
  if (!window.NX || !window.NX.brain || !window.NX.brain.state) {
    return setTimeout(arguments.callee, 400);
  }

  const brainState = window.NX.brain.state;
  const baseCanvas = document.getElementById('brainCanvas');
  if (!baseCanvas) return;

  /* ══════════════════════════════════════════════════════════════════════════
     THE OVERLAY CANVAS
     A second canvas, perfectly aligned with the galaxy canvas, where soul
     lives. Sits underneath the chat HUD, above the galaxy. Pointer-events
     pass through so it never eats a click.
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
    mix-blend-mode: screen;
  `;
  baseCanvas.parentElement.appendChild(soul);
  const sctx = soul.getContext('2d');

  let SW = 0, SH = 0, dpr = 1;
  function resize(){
    const r = baseCanvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5);
    SW = r.width * dpr; SH = r.height * dpr;
    soul.width = SW; soul.height = SH;
    soul.style.width = r.width + 'px';
    soul.style.height = r.height + 'px';
  }
  resize();
  window.addEventListener('resize', () => { if (isVisible()) resize(); });

  function isVisible(){
    const v = document.getElementById('brainView');
    return v && v.classList.contains('active');
  }

  // In light theme, screen blend inverts our mood. Use overlay there.
  function isDark(){ return document.documentElement.getAttribute('data-theme') !== 'light'; }
  function applyBlend(){
    soul.style.mixBlendMode = isDark() ? 'screen' : 'multiply';
  }
  applyBlend();
  // Re-check blend when theme toggles
  new MutationObserver(applyBlend).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme']
  });


  /* ══════════════════════════════════════════════════════════════════════════
     WEATHER — the state of the business as pressure, tone, mood
     ══════════════════════════════════════════════════════════════════════════

     The weather system reads the live state of the business every 90s and
     derives a "mood" per community:

       calm        — nothing unusual. subtle breathing.
       tense       — open tickets, equipment down, predictions imminent.
                     amber haze settles over the community.
       stormy      — multiple things wrong at once. the haze darkens.
                     a slow drift pulls particles inward (pressure).
       expectant   — a prediction is within 24h. quiet pulse, like a star
                     about to flare. silver-blue tinge.
       sleepy      — nothing touched in 90 days. drained to greyscale,
                     drifts outward.

     Weather is additive over the base galaxy. It never replaces the colors
     the base canvas draws — it tints, hazes, pulses.
     ══════════════════════════════════════════════════════════════════════════ */

  const weather = {
    // communityId -> { mood, severity (0-1), lastUpdate, reasons[] }
    perCommunity: new Map(),
    // Global mood aggregate — for tonal background shift
    globalMood: 'calm',
    globalSeverity: 0,
    lastRefresh: 0,
  };

  const MOOD_COLORS = {
    // Each mood tints the whole zone. Values chosen to compose well on dark
    // and harmonize with the base palette (beacon amber, galaxy gold).
    calm:      [140, 180, 200],   // cool grey-blue — neutral presence
    tense:     [232, 168, 48],    // nexus amber — warning but warm
    stormy:    [212, 88, 88],     // red — alarm but muted
    expectant: [160, 200, 255],   // silver-blue — something coming
    sleepy:    [120, 115, 110],   // drained warm grey — rest
  };

  async function refreshWeather(force){
    if (!NX.sb) return;
    const now = Date.now();
    if (!force && now - weather.lastRefresh < 90_000) return;
    weather.lastRefresh = now;

    const today = new Date().toISOString().split('T')[0];
    const in3 = new Date(Date.now() + 3*86400000).toISOString().split('T')[0];

    try {
      // Five cheap parallel reads. None over ~100 rows typically.
      const [eqDown, ticketsOpen, dispatchPending, patternsDue, overdue] = await Promise.all([
        NX.sb.from('equipment').select('id, location, node_id').in('status', ['down','needs_service']),
        NX.sb.from('tickets').select('id, location, equipment_id').in('status', ['open','pending']).limit(200),
        NX.sb.from('dispatch_log').select('contractor_node_id').eq('outcome', 'pending'),
        NX.sb.from('patterns').select('entity_node_id, next_predicted, confidence, location')
            .eq('active', true).gte('next_predicted', today).lte('next_predicted', in3),
        NX.sb.from('contractor_events').select('location, event_date')
            .eq('event_date', today).neq('status', 'disregarded'),
      ]);

      // Gather reasons per community by walking particles and mapping location/node_id
      const byComm = new Map(); // cid -> { reasons: [], expectantCount, tenseCount, stormyCount }

      const bump = (cid, reason, kind) => {
        if (cid == null) return;
        if (!byComm.has(cid)) byComm.set(cid, { reasons: [], expectant: 0, tense: 0, stormy: 0 });
        const r = byComm.get(cid);
        r.reasons.push(reason);
        r[kind]++;
      };

      // Map equipment down → communities (via node_id → particle → community_id)
      const P = brainState.particles || [];
      const nodeToComm = new Map();
      P.forEach(p => { if (p.node?.id) nodeToComm.set(String(p.node.id), p.node.community_id); });

      (eqDown?.data || []).forEach(e => {
        const cid = nodeToComm.get(String(e.node_id));
        bump(cid, `equipment down`, e.id ? 'stormy' : 'tense');
      });
      (ticketsOpen?.data || []).forEach(t => {
        // Find the equipment's node if known
        const eqNodeId = P.find(p => p.node?.name?.toLowerCase?.().includes?.((t.location||'').toLowerCase()))?.node?.id;
        const cid = nodeToComm.get(String(t.equipment_id)) || nodeToComm.get(String(eqNodeId));
        bump(cid, 'open ticket', 'tense');
      });
      (dispatchPending?.data || []).forEach(d => {
        const cid = nodeToComm.get(String(d.contractor_node_id));
        bump(cid, 'pending dispatch', 'tense');
      });
      (patternsDue?.data || []).forEach(p => {
        const cid = nodeToComm.get(String(p.entity_node_id));
        bump(cid, 'prediction imminent', 'expectant');
      });
      (overdue?.data || []).forEach(o => {
        // Contractor expected today — expectant mood
        bump(null, 'contractor today', 'expectant');
      });

      // Compute mood per community
      weather.perCommunity.clear();
      let globalTense = 0, globalStormy = 0, globalExpectant = 0;

      for (const [cid, r] of byComm) {
        let mood = 'calm', sev = 0;
        if (r.stormy >= 2) { mood = 'stormy'; sev = Math.min(1, 0.5 + r.stormy * 0.15); }
        else if (r.stormy === 1 || r.tense >= 2) { mood = 'tense'; sev = Math.min(1, 0.35 + r.tense * 0.12); }
        else if (r.tense === 1) { mood = 'tense'; sev = 0.28; }
        else if (r.expectant > 0) { mood = 'expectant'; sev = Math.min(0.8, 0.3 + r.expectant * 0.18); }
        weather.perCommunity.set(cid, { mood, severity: sev, reasons: r.reasons, lastUpdate: now });
        globalStormy += r.stormy; globalTense += r.tense; globalExpectant += r.expectant;
      }

      // Sleepy communities: no particles touched in >90 days
      const NINETY_DAYS = 90 * 86400000;
      const commLastTouch = new Map();
      P.forEach(p => {
        const cid = p.node?.community_id;
        if (cid == null) return;
        const d = p.node?.last_relevant_date ? new Date(p.node.last_relevant_date).getTime() : 0;
        if (!commLastTouch.has(cid) || commLastTouch.get(cid) < d) commLastTouch.set(cid, d);
      });
      for (const [cid, lastD] of commLastTouch) {
        if (weather.perCommunity.has(cid)) continue;
        if (lastD && now - lastD > NINETY_DAYS) {
          const ageDays = (now - lastD) / 86400000;
          weather.perCommunity.set(cid, {
            mood: 'sleepy',
            severity: Math.min(0.5, (ageDays - 90) / 400),
            reasons: [`untouched ${Math.round(ageDays)}d`],
            lastUpdate: now
          });
        }
      }

      // Global mood
      if (globalStormy >= 2) { weather.globalMood = 'stormy'; weather.globalSeverity = Math.min(1, 0.4 + globalStormy * 0.1); }
      else if (globalTense + globalStormy >= 3) { weather.globalMood = 'tense'; weather.globalSeverity = 0.5; }
      else if (globalExpectant > 0) { weather.globalMood = 'expectant'; weather.globalSeverity = 0.3; }
      else { weather.globalMood = 'calm'; weather.globalSeverity = 0; }

    } catch (e) {
      console.warn('[Soul/weather] refresh failed:', e.message);
    }
  }

  function drawWeather(t){
    // Only render when community layout is computed
    const centers = brainState.commCenters || {};
    if (!Object.keys(centers).length) return;

    for (const cidKey in centers) {
      const c = centers[cidKey];
      const cidNum = Number(cidKey);
      const w = weather.perCommunity.get(cidNum) || weather.perCommunity.get(cidKey);
      if (!w) continue;

      const mood = w.mood;
      const color = MOOD_COLORS[mood] || MOOD_COLORS.calm;
      const transform = brainState.transform || { x:0, y:0, scale:1 };
      const cx = c.x * transform.scale + transform.x * dpr;
      const cy = c.y * transform.scale + transform.y * dpr;
      const radius = c.r * 2.6 * transform.scale;

      // Tonal haze — soft radial gradient, mood-tinted
      const breath = 1 + Math.sin(t * (mood === 'expectant' ? 1.4 : 0.4) + cidNum) * 0.06;
      const rad = radius * breath;

      const g = sctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
      const peakAlpha = 0.15 * w.severity + 0.04;
      g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${peakAlpha})`);
      g.addColorStop(0.6, `rgba(${color[0]},${color[1]},${color[2]},${peakAlpha * 0.35})`);
      g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
      sctx.fillStyle = g;
      sctx.beginPath(); sctx.arc(cx, cy, rad, 0, Math.PI*2); sctx.fill();

      // Expectant: slow pulse ring. Something is about to happen.
      if (mood === 'expectant') {
        const pulse = (Math.sin(t * 1.1 + cidNum) + 1) / 2;
        const pr = rad * (0.55 + pulse * 0.15);
        sctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.2 + pulse * 0.15})`;
        sctx.lineWidth = 1.2 * dpr;
        sctx.beginPath(); sctx.arc(cx, cy, pr, 0, Math.PI*2); sctx.stroke();
      }

      // Stormy: gentle lightning-like flicker on the rim, very rare
      if (mood === 'stormy' && Math.random() < 0.006 * w.severity) {
        sctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.45)`;
        sctx.lineWidth = 2 * dpr;
        const arcStart = Math.random() * Math.PI * 2;
        sctx.beginPath();
        sctx.arc(cx, cy, rad * 0.9, arcStart, arcStart + 0.3);
        sctx.stroke();
      }
    }

    // Global mood: very subtle vignette tint (never obscures)
    if (weather.globalSeverity > 0.3) {
      const gm = MOOD_COLORS[weather.globalMood] || MOOD_COLORS.calm;
      const vignAlpha = weather.globalSeverity * 0.04;
      const vg = sctx.createRadialGradient(SW/2, SH/2, Math.min(SW,SH)*0.3, SW/2, SH/2, Math.max(SW,SH)*0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(${gm[0]},${gm[1]},${gm[2]},${vignAlpha})`);
      sctx.fillStyle = vg;
      sctx.fillRect(0, 0, SW, SH);
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     MEMORY — nodes fade with time since last relevant date
     ══════════════════════════════════════════════════════════════════════════

     We don't modify the base canvas's rendering. Instead we dim/brighten
     by overlaying a soft spotlight at the position of each "alive" node —
     a tiny additive glow that makes recent nodes feel warm. Old nodes
     stay as the base draws them, which means they sit darker by contrast.

     The effect is that RECENT things have a golden halo you can sense
     before you can see; STALE things feel cool, distant, like old photos.
     ══════════════════════════════════════════════════════════════════════════ */

  function drawMemory(t){
    const P = brainState.particles || [];
    if (!P.length) return;
    const transform = brainState.transform || { x:0, y:0, scale:1 };
    const scale = transform.scale;

    // Bail early at low zoom — too many particles
    if (scale < 0.5) return;

    const now = Date.now();
    const SEVEN_DAYS = 7 * 86400000;
    const THIRTY_DAYS = 30 * 86400000;

    // Viewport cull
    const vl = -50, vr = SW + 50, vt = -50, vb = SH + 50;

    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const x = p.x * scale + transform.x * dpr;
      const y = p.y * scale + transform.y * dpr;
      if (x < vl || x > vr || y < vt || y > vb) continue;

      const last = p.node?.last_relevant_date ? new Date(p.node.last_relevant_date).getTime() : null;
      if (!last) continue;
      const age = now - last;
      if (age > THIRTY_DAYS) continue; // No halo for stale nodes

      // Warmth ramps from 1 (today) to 0 (30 days ago)
      const warmth = 1 - (age / THIRTY_DAYS);
      const isVeryRecent = age < SEVEN_DAYS;
      const pulse = isVeryRecent ? 0.9 + Math.sin(t * 1.8 + i * 0.3) * 0.1 : 1;

      const r = 8 * dpr * (isVeryRecent ? 1.3 : 1) * pulse;
      const g = sctx.createRadialGradient(x, y, 0, x, y, r);
      const alpha = warmth * (isVeryRecent ? 0.22 : 0.12);
      // Warm gold halo — matches beacon
      g.addColorStop(0, `rgba(212, 182, 138, ${alpha})`);
      g.addColorStop(1, `rgba(212, 182, 138, 0)`);
      sctx.fillStyle = g;
      sctx.beginPath(); sctx.arc(x, y, r, 0, Math.PI*2); sctx.fill();
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     DIEGETIC CHAT — beams from knowledge to speech
     ══════════════════════════════════════════════════════════════════════════

     When NEXUS answers, brain-chat sets state.activatedNodes to the IDs of
     nodes it referenced. We observe that set and, for each activated node,
     draw a luminous beam from the node's position up to the chat bubble.

     The beam is not a line. It's a traveling packet of light — a small
     bright head with a fading tail, like a comet. You see the knowledge
     LEAVE the galaxy and GO to the chat. The citation is not a footnote.
     The citation is what you just saw.

     When activatedNodes is cleared (after 12s), the last packet delivers
     itself and fades. No teardown, no abrupt cuts.
     ══════════════════════════════════════════════════════════════════════════ */

  const beams = []; // {sourceNodeId, targetXY (dyn), t0, t1, progress, phase}
  const knownActivated = new Set(); // track which IDs we've already spawned a beam for

  function getChatBubbleAnchor(){
    // Find the last AI message bubble in chat, return its canvas-space top-center.
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return null;
    const ai = msgs.querySelector('.msg-ai:last-child, .hud-msg-ai:last-child, [data-role="ai"]:last-child')
            || msgs.lastElementChild;
    if (!ai) return null;
    const b = ai.getBoundingClientRect();
    const canvasRect = baseCanvas.getBoundingClientRect();
    // Top-center of the bubble, in canvas pixel space (pre-dpr)
    return {
      x: (b.left + b.width/2 - canvasRect.left) * dpr,
      y: (b.top - canvasRect.top) * dpr,
    };
  }

  function spawnBeamsFromActivated(){
    const ids = brainState.activatedNodes;
    if (!ids || !ids.size) return;

    for (const id of ids) {
      if (knownActivated.has(id)) continue;
      knownActivated.add(id);
      // Find the particle
      const P = brainState.particles || [];
      const p = P.find(x => x.id === id || x.node?.id === id);
      if (!p) continue;
      beams.push({
        sourceParticle: p,
        sourceId: id,
        spawnedAt: performance.now(),
        duration: 1600 + Math.random() * 600, // slight variance so beams don't synchronize
        phase: Math.random() * Math.PI * 2,
      });
    }

    // If activatedNodes was cleared, forget what we knew so next answer re-triggers
    if (ids.size === 0) knownActivated.clear();
  }

  // Observe activatedNodes being replaced (brain-chat does =new Set(relIds))
  // We can't hook the setter, so poll cheaply.
  let lastActivatedSize = 0;
  let lastActivatedHash = '';
  setInterval(() => {
    const s = brainState.activatedNodes;
    const size = s ? s.size : 0;
    // Hash the set so we detect re-assignments with same count
    let hash = '';
    if (s) { for (const id of s) hash += id + '|'; }
    if (size === 0 && knownActivated.size > 0) knownActivated.clear();
    if (hash !== lastActivatedHash) {
      lastActivatedHash = hash;
      lastActivatedSize = size;
      if (size > 0) spawnBeamsFromActivated();
    }
  }, 300);

  function drawBeams(now){
    if (!beams.length) return;
    const target = getChatBubbleAnchor();
    const transform = brainState.transform || { x:0, y:0, scale:1 };

    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      const elapsed = now - b.spawnedAt;
      const progress = Math.min(1, elapsed / b.duration);
      if (progress >= 1) { beams.splice(i, 1); continue; }

      // Source position (live — follows the particle even if it drifts)
      const sx = b.sourceParticle.x * transform.scale + transform.x * dpr;
      const sy = b.sourceParticle.y * transform.scale + transform.y * dpr;

      // Target — if no chat bubble, fall back to beacon center
      const tx = target ? target.x : SW/2;
      const ty = target ? target.y : SH/2 - 40;

      // Ease-in-out cubic so the packet accelerates then decelerates
      const p = progress < 0.5 ? 4*progress*progress*progress : 1 - Math.pow(-2*progress + 2, 3)/2;

      // Gentle curve — beam arcs slightly outward rather than going straight.
      // Mid-point pushed perpendicular to the source→target vector.
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const dx = tx - sx, dy = ty - sy;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      // Perpendicular offset — away from screen center so beam sweeps wide
      const perpX = -dy / len, perpY = dx / len;
      const curveAmt = Math.min(len * 0.18, 120 * dpr) * Math.sin(b.phase) * (b.sourceParticle.x < SW/2 ? 1 : -1);
      const cpx = mx + perpX * curveAmt;
      const cpy = my + perpY * curveAmt;

      // Quadratic bezier position at p
      const u = 1 - p;
      const px = u*u*sx + 2*u*p*cpx + p*p*tx;
      const py = u*u*sy + 2*u*p*cpy + p*p*ty;

      // Tail: sample 14 points behind
      const TAIL = 14;
      sctx.lineCap = 'round';
      for (let k = TAIL; k > 0; k--) {
        const kp = Math.max(0, p - k * 0.025);
        const kpe = kp < 0.5 ? 4*kp*kp*kp : 1 - Math.pow(-2*kp + 2, 3)/2;
        // Sampled bezier
        const ku = 1 - kpe;
        const kx = ku*ku*sx + 2*ku*kpe*cpx + kpe*kpe*tx;
        const ky = ku*ku*sy + 2*ku*kpe*cpy + kpe*kpe*ty;
        const nextKp = Math.max(0, p - (k-1) * 0.025);
        const nextKpe = nextKp < 0.5 ? 4*nextKp*nextKp*nextKp : 1 - Math.pow(-2*nextKp + 2, 3)/2;
        const nku = 1 - nextKpe;
        const nkx = nku*nku*sx + 2*nku*nextKpe*cpx + nextKpe*nextKpe*tx;
        const nky = nku*nku*sy + 2*nku*nextKpe*cpy + nextKpe*nextKpe*ty;

        const tailAlpha = (1 - k/TAIL) * (1 - progress*0.5) * 0.55;
        sctx.strokeStyle = `rgba(212,182,138,${tailAlpha})`;
        sctx.lineWidth = (1 + (1 - k/TAIL) * 2.2) * dpr;
        sctx.beginPath();
        sctx.moveTo(kx, ky);
        sctx.lineTo(nkx, nky);
        sctx.stroke();
      }

      // Head: bright core + bloom
      const headAlpha = progress < 0.9 ? 1 : (1 - progress) * 10;
      sctx.fillStyle = `rgba(255,240,200,${headAlpha})`;
      sctx.shadowColor = `rgba(212,182,138,${headAlpha * 0.8})`;
      sctx.shadowBlur = 18 * dpr;
      sctx.beginPath(); sctx.arc(px, py, 3 * dpr, 0, Math.PI*2); sctx.fill();
      sctx.shadowBlur = 0;

      // Source flare — the moment of leaving. Fades quickly.
      if (progress < 0.25) {
        const srcAlpha = (1 - progress*4) * 0.5;
        sctx.fillStyle = `rgba(255,240,200,${srcAlpha})`;
        sctx.beginPath(); sctx.arc(sx, sy, 8 * dpr, 0, Math.PI*2); sctx.fill();
      }

      // Delivery flare — the moment of arrival. Bright tiny burst.
      if (progress > 0.82) {
        const arrAlpha = (progress - 0.82) * 5;
        sctx.fillStyle = `rgba(255,248,220,${Math.min(arrAlpha, 0.8)})`;
        sctx.shadowColor = 'rgba(255,240,200,0.9)';
        sctx.shadowBlur = 28 * dpr;
        sctx.beginPath(); sctx.arc(tx, ty, 5 * dpr, 0, Math.PI*2); sctx.fill();
        sctx.shadowBlur = 0;
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     TIME SCRUBBER — the galaxy moves through time
     ══════════════════════════════════════════════════════════════════════════

     A slim ribbon pinned to the bottom edge. Drag left to move into the past;
     drag right to peek into predictions. When you let go, the galaxy snaps
     back to now, gently.

     Mechanism: we don't move particles. We dim particles whose
     last_relevant_date is past the cursor (so they feel absent). And we
     paint ghost-outlines of predicted events that haven't happened yet
     at the position of their entity_node.
     ══════════════════════════════════════════════════════════════════════════ */

  const time = {
    active: false,         // currently being dragged
    hover: false,
    offsetDays: 0,         // current position: negative = past, 0 = now, positive = future
    targetOffsetDays: 0,   // where we're animating toward
    maxPastDays: 365,
    maxFutureDays: 60,
    predictions: [],       // loaded patterns with future next_predicted
  };

  function buildScrubberUI(){
    let bar = document.getElementById('timeScrubber');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'timeScrubber';
    bar.innerHTML = `
      <div class="ts-track">
        <div class="ts-marker-now" title="today"></div>
        <div class="ts-cursor" id="tsCursor"></div>
        <div class="ts-bubble" id="tsBubble">today</div>
        <div class="ts-hint" id="tsHint">← scrub time</div>
      </div>
    `;
    document.body.appendChild(bar);

    const cursor = bar.querySelector('#tsCursor');
    const track = bar.querySelector('.ts-track');
    const bubble = bar.querySelector('#tsBubble');
    const hint = bar.querySelector('#tsHint');

    const totalRange = time.maxPastDays + time.maxFutureDays;

    const daysToX = (d) => {
      // d=-365 → 0%; d=0 → 365/425; d=+60 → 100%
      return ((d + time.maxPastDays) / totalRange) * 100;
    };
    const xToDays = (xPct) => Math.round(xPct/100 * totalRange - time.maxPastDays);

    const updateCursor = () => {
      cursor.style.left = daysToX(time.offsetDays) + '%';
      if (time.offsetDays === 0) {
        bubble.textContent = 'today';
        bubble.classList.remove('past','future');
      } else if (time.offsetDays < 0) {
        const d = -time.offsetDays;
        bubble.textContent = d < 7 ? `${d}d ago` : d < 60 ? `${Math.round(d/7)}w ago` : `${Math.round(d/30)}mo ago`;
        bubble.classList.add('past'); bubble.classList.remove('future');
      } else {
        const d = time.offsetDays;
        bubble.textContent = d < 7 ? `in ${d}d` : `in ${Math.round(d/7)}w`;
        bubble.classList.add('future'); bubble.classList.remove('past');
      }
      bubble.style.left = daysToX(time.offsetDays) + '%';
      hint.style.opacity = (time.offsetDays === 0 && !time.active && !time.hover) ? '1' : '0';
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
      // Glide back to zero over ~1s. If user is nearly there, snap.
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

    track.addEventListener('mouseenter', () => { time.hover = true; updateCursor(); });
    track.addEventListener('mouseleave', () => { time.hover = false; updateCursor(); });

    time._updateCursor = updateCursor;
    updateCursor();
    return bar;
  }
  buildScrubberUI();

  async function loadPredictions(){
    if (!NX.sb) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await NX.sb.from('patterns')
        .select('entity_node_id, entity_name, next_predicted, confidence, pattern_type, location')
        .eq('active', true)
        .gte('next_predicted', today)
        .gte('confidence', 0.4)
        .limit(100);
      time.predictions = data || [];
    } catch (e) {}
  }
  loadPredictions();

  function drawTimeOverlay(t){
    // Smoothly animate offsetDays toward target when released
    if (!time.active && time.offsetDays !== time.targetOffsetDays) {
      time.offsetDays += (time.targetOffsetDays - time.offsetDays) * 0.08;
      if (Math.abs(time.offsetDays - time.targetOffsetDays) < 0.3) {
        time.offsetDays = time.targetOffsetDays;
      }
      if (time._updateCursor) time._updateCursor();
    }

    const offset = time.offsetDays;
    if (Math.abs(offset) < 0.5) return; // No effect when at "now"

    const P = brainState.particles || [];
    const transform = brainState.transform || { x:0, y:0, scale:1 };
    const now = Date.now();
    const cursorTime = now + offset * 86400000;

    // PAST: dim particles whose last_relevant_date is newer than cursor
    // (they didn't exist yet / hadn't been relevant yet, from the cursor's vantage)
    if (offset < 0) {
      sctx.save();
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const last = p.node?.last_relevant_date ? new Date(p.node.last_relevant_date).getTime() : null;
        if (!last) continue;
        const x = p.x * transform.scale + transform.x * dpr;
        const y = p.y * transform.scale + transform.y * dpr;
        if (x < 0 || x > SW || y < 0 || y > SH) continue;

        const wasRelevantThen = last <= cursorTime;
        if (!wasRelevantThen) {
          // Draw a dark veil over this particle — it "disappears" visually.
          // Since we're mix-blend-mode: screen/multiply, we need a blend-safe approach.
          // Paint a small dark disc that neutralizes that pixel's brightness.
          sctx.globalCompositeOperation = isDark() ? 'multiply' : 'screen';
          const r = 4 * dpr;
          sctx.fillStyle = isDark() ? 'rgba(10,10,15,0.85)' : 'rgba(255,255,255,0.85)';
          sctx.beginPath(); sctx.arc(x, y, r, 0, Math.PI*2); sctx.fill();
        } else {
          // Recently relevant as of cursor — tiny silver halo
          const ageFromCursor = cursorTime - last;
          const WINDOW = 14 * 86400000;
          if (ageFromCursor >= 0 && ageFromCursor < WINDOW) {
            const w = 1 - ageFromCursor / WINDOW;
            const g = sctx.createRadialGradient(x, y, 0, x, y, 10 * dpr);
            g.addColorStop(0, `rgba(180,200,230,${w * 0.4})`);
            g.addColorStop(1, 'rgba(180,200,230,0)');
            sctx.fillStyle = g;
            sctx.beginPath(); sctx.arc(x, y, 10 * dpr, 0, Math.PI*2); sctx.fill();
          }
        }
      }
      sctx.restore();
    }

    // FUTURE: draw predictions as ghostly outlines
    if (offset > 0) {
      const cursorDate = new Date(now + offset * 86400000).toISOString().split('T')[0];
      for (const pred of time.predictions) {
        if (!pred.next_predicted || !pred.entity_node_id) continue;
        // Show a prediction only if its next_predicted is at or before the cursor
        if (pred.next_predicted > cursorDate) continue;
        const particle = P.find(x => String(x.node?.id) === String(pred.entity_node_id));
        if (!particle) continue;
        const x = particle.x * transform.scale + transform.x * dpr;
        const y = particle.y * transform.scale + transform.y * dpr;
        if (x < 0 || x > SW || y < 0 || y > SH) continue;

        // Ghost outline — pulsing silver-blue ring. Confidence controls brightness.
        const ghost = (Math.sin(t * 1.6 + particle.id * 0.5) + 1) / 2;
        const a = pred.confidence * (0.4 + ghost * 0.3);
        sctx.strokeStyle = `rgba(160,200,255,${a})`;
        sctx.lineWidth = 1.5 * dpr;
        sctx.beginPath(); sctx.arc(x, y, 14 * dpr, 0, Math.PI*2); sctx.stroke();

        // Tiny drifting glyph above — a marker that says "this is still to come"
        sctx.fillStyle = `rgba(200,220,255,${a})`;
        sctx.font = `${10 * dpr}px "JetBrains Mono"`;
        sctx.textAlign = 'center';
        sctx.fillText('◇', x, y - 20 * dpr);
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════════════════
     AMBIENT — the sound of data
     ══════════════════════════════════════════════════════════════════════════

     Tiny chimes when meaningful things happen in the galaxy. NOT
     notifications. Not alerts. Ambient. The sonic equivalent of a wind
     chime moving in breeze. A soft "someone touched a node," a faint
     bell-tone when a beam arrives at the chat bubble, a distant low
     note when the weather darkens.

     Disabled by default. User opts in by tapping the speaker icon.
     Uses the existing audio context from brain-canvas if available.
     ══════════════════════════════════════════════════════════════════════════ */

  const ambient = {
    enabled: localStorage.getItem('nexus_soul_audio') === '1',
    ctx: null,
    master: null,
    lastTone: 0,
  };

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
    if (now - ambient.lastTone < 0.12) return; // rate-limit
    ambient.lastTone = now;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain || 0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g); g.connect(ambient.master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  // Tiny chime when a beam delivers
  let lastBeamCount = 0;
  function ambientPulse(){
    const current = beams.filter(b => (performance.now() - b.spawnedAt) / b.duration > 0.82).length;
    if (current > lastBeamCount) {
      // Pentatonic ascending — one of these five notes per delivery
      const notes = [523.25, 587.33, 659.25, 783.99, 880.00]; // C5, D5, E5, G5, A5
      chime(notes[Math.floor(Math.random() * notes.length)], 1.2, 0.04);
    }
    lastBeamCount = current;
  }

  // Audio toggle UI — a small speaker dot in the scrubber
  function addAudioToggle(){
    const bar = document.getElementById('timeScrubber');
    if (!bar || bar.querySelector('.ts-audio-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'ts-audio-toggle';
    btn.title = 'Ambient sound';
    btn.innerHTML = ambient.enabled ? '♪' : '·';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ambient.enabled = !ambient.enabled;
      localStorage.setItem('nexus_soul_audio', ambient.enabled ? '1' : '0');
      btn.innerHTML = ambient.enabled ? '♪' : '·';
      if (ambient.enabled) {
        ensureAmbientCtx();
        // Little welcome chime so the user hears it worked
        chime(659.25, 1.5, 0.05);
      }
    });
    bar.appendChild(btn);
  }
  addAudioToggle();


  /* ══════════════════════════════════════════════════════════════════════════
     THE LOOP
     Runs alongside the base canvas. Clears + composes its four layers per
     frame. Pauses when brain view is not active (saves battery).
     ══════════════════════════════════════════════════════════════════════════ */

  let lastT = performance.now();
  function loop(){
    requestAnimationFrame(loop);
    if (!isVisible()) return;
    const now = performance.now();
    const t = now / 1000; // seconds
    lastT = now;

    sctx.clearRect(0, 0, SW, SH);

    // Order matters: weather at the back, memory halos, time overlay on top,
    // beams on absolute top (they should never be occluded).
    drawWeather(t);
    drawMemory(t);
    drawTimeOverlay(t);
    drawBeams(now);
    ambientPulse();
  }
  loop();

  // Weather refresh loop — independent of render
  refreshWeather(true);
  setInterval(() => { if (isVisible()) refreshWeather(false); }, 90_000);
  setInterval(loadPredictions, 5 * 60_000);

  // Hide scrubber when not on brain view (it's positioned globally)
  function syncScrubberVisibility(){
    const bar = document.getElementById('timeScrubber');
    if (!bar) return;
    bar.style.display = isVisible() ? '' : 'none';
  }
  syncScrubberVisibility();
  new MutationObserver(syncScrubberVisibility).observe(
    document.getElementById('brainView'),
    { attributes: true, attributeFilter: ['class'] }
  );


  /* ══════════════════════════════════════════════════════════════════════════
     EXPORTS — other modules can inquire, but don't need to
     ══════════════════════════════════════════════════════════════════════════ */
  window.NX.galaxySoul = {
    weather,
    time,
    beams,
    refreshWeather,
    pingBeam: (nodeId) => {
      // Imperative API: force a beam from a specific node (for edge triggers,
      // e.g., "a new ticket just opened — draw attention to its equipment")
      const P = brainState.particles || [];
      const p = P.find(x => x.id === nodeId || x.node?.id === nodeId);
      if (!p) return;
      beams.push({
        sourceParticle: p,
        sourceId: nodeId,
        spawnedAt: performance.now(),
        duration: 2000,
        phase: Math.random() * Math.PI * 2,
      });
    }
  };

  console.log('[Soul] ready — weather, memory, time, diegetic chat online');
})();
