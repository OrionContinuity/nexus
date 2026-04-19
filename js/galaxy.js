/* ═══════════════════════════════════════════════════════════════════════════════
   
   NEXUS GALAXY — procedural spiral galaxy with audio-reactive soul
   
   Replaces: brain-canvas.js + galaxy-soul.js (both deleted)
   
   This is not a force-directed graph. There is no per-frame physics between nodes.
   Each node lives on a logarithmic-spiral arm and orbits the center with differential
   rotation (inner orbits faster than outer — like a real galaxy, like a clock).
   
   Four render layers, composited each frame:
     0 — void background (static)
     1 — distant field: archived nodes + synthetic dust (baked once, rotated live)
     2 — active stars: live knowledge nodes (drawn each frame)
     3 — meteors: pending-queue items streaking toward the center
     4 — nexus black hole: dark disc + amber accretion ring
   
   Audio-reactive during song playback (tap the black hole):
     bass  → black hole pulses, accretion ring brightens
     mid   → stars with voice='mid' glow in their groups
     high  → sparkle particles spawn from the center on transients
   
   Palette: void black + one hero amber (#c8a44e). Community tint variations
   stay in the warm-yellow family. No confetti.
   
   Exposes NX.brain with the same public surface as the old brain-canvas.js
   so brain-chat.js and brain-list.js keep working unchanged.
   
   ═══════════════════════════════════════════════════════════════════════════════ */
(function(){

  const canvas = document.getElementById('brainCanvas');
  if (!canvas) { console.warn('[Galaxy] #brainCanvas not found'); return; }
  const ctx = canvas.getContext('2d', { alpha: false });

  /* ─── STATE ────────────────────────────────────────────────────────────── */
  const state = {
    // Canvas
    W: 0, H: 0, dpr: 1,

    // Time
    t: 0,                  // seconds since load
    lastFrame: 0,
    frameMs: 16.7,         // running average frame time
    perfMode: false,       // kicked in when frameMs > 20ms sustained

    // Camera
    cam: { x: 0, y: 0, zoom: 1, targetZoom: 1, targetX: 0, targetY: 0 },

    // Stars — live knowledge nodes (the 2,751 processed nodes)
    particles: [],         // public API: {id, x, y, node, ...}

    // Distant field (archived + dust) — baked to offscreen canvas
    distantCanvas: null,   // OffscreenCanvas or regular canvas
    distantAngle: 0,       // rotation of the whole distant field

    // Meteors (pending-queue items visualized)
    meteors: [],
    pendingCount: 0,
    lastMeteorSpawn: 0,

    // Sparkles (spawned on high-frequency audio transients)
    sparkles: [],

    // Interaction
    hoverNode: null,
    activeNode: null,
    frozenNode: null,
    dragging: false,
    dragStart: { x: 0, y: 0 },
    dragCamStart: { x: 0, y: 0 },
    pinchDist: 0,

    // External signals (from chat / search / ingestion)
    activatedNodes: new Set(),  // ids that should glow bright (chat context)
    searchHits: new Set(),      // ids highlighted by search
    commCenters: {},            // community_id → {x, y, color, label} (for outside code)
    communities: [],

    // Audio-reactive
    audio: null,
    audioCtx: null,
    analyser: null,
    audioData: null,
    bass: 0, mid: 0, high: 0,
    bassMax: 0.1, midMax: 0.1, highMax: 0.1, // running maxes for normalization
    lastHighPeak: 0,
    songPlaying: false,
    songEndsAt: 0,

    // Shockwave (one big pulse on song start)
    shockwave: null,       // {startT, radius, intensity} or null

    // Ambient system activity
    ingestionActive: false,

    // Black hole
    hole: { r: 40, ringAngle: 0, ringBrightness: 0.6, scale: 1.0 }
  };

  // Make state reachable from external code that expects it (preserves contract)
  // Public API: NX.brain.state.{particles, activatedNodes, searchHits, frozenNode, activeNode, commCenters}


  /* ─── PALETTE ──────────────────────────────────────────────────────────── */
  // One hero color: amber #c8a44e. Community tints stay in the warm-yellow family.
  const AMBER = [200, 164, 78];               // #c8a44e — the signature hue
  const AMBER_BRIGHT = [255, 220, 150];       // highlight / active / sparkle core
  const AMBER_DIM = [80, 70, 45];             // far / dim / dust

  // Community tint variations — all within the warm palette
  const COMMUNITY_TINTS = [
    [200, 164, 78],   // amber (core)
    [212, 154, 78],   // amber-warm (more orange)
    [200, 180, 100],  // amber-cool (more yellow)
    [180, 150, 90],   // amber-muted
    [220, 180, 110],  // amber-bright
    [170, 140, 80],   // amber-deep
  ];

  /* ─── TUNING CONSTANTS ─────────────────────────────────────────────────── */
  const ARM_COUNT      = 3;         // logarithmic spiral arms
  const SPIRAL_B       = 0.22;      // tightness of the spiral (lower = looser coil)
  const INNER_R_FRAC   = 0.08;      // inner radius as fraction of min(W,H)
  const OUTER_R_FRAC   = 0.48;      // outer radius (before zoom)
  const ARM_WIDTH      = 0.18;      // radian stdev of perpendicular jitter

  const BASE_OMEGA     = 0.015;     // radians/sec at inner edge
  const DIFFERENTIAL   = 0.5;       // rotation speed falloff exponent

  const DISTANT_COUNT  = 2500;      // baked far-field stars
  const ACTIVE_MAX     = 800;       // cap on live-drawn active stars
  const METEOR_MAX     = 12;        // max concurrent meteors
  const SPARKLE_MAX    = 80;        // max concurrent sparkle particles

  // Per-node tap target radius (in screen pixels)
  const TAP_SLOP       = 12;

  /* ─── UTILITIES ────────────────────────────────────────────────────────── */
  function rgba(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  function mix(a, b, t) {
    return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t];
  }
  function gauss(stdev) {
    // Box-Muller, single sample
    const u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v) * stdev;
  }
  function now() { return performance.now() / 1000; }

  // Deterministic hash → 0..1 (for per-node stable randomness without storing)
  function hash01(id) {
    let h = 2166136261;
    const s = String(id);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return ((h >>> 0) / 4294967295);
  }


  /* ─── RESIZE ───────────────────────────────────────────────────────────── */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.W = Math.max(1, Math.floor(rect.width));
    state.H = Math.max(1, Math.floor(rect.height));
    canvas.width  = state.W * state.dpr;
    canvas.height = state.H * state.dpr;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    // Rebuild distant field at new size
    buildDistantField();
  }

  /* ─── SPIRAL PLACEMENT ─────────────────────────────────────────────────── */
  // Given arm index (0..ARM_COUNT-1) and normalized radius t (0..1),
  // return polar coordinates (r, theta) for a star on that arm.
  function placeOnArm(arm, t, id) {
    const cx = state.W / 2, cy = state.H / 2;
    const minDim = Math.min(state.W, state.H);
    const innerR = minDim * INNER_R_FRAC;
    const outerR = minDim * OUTER_R_FRAC;

    // Log spiral: theta = baseAngle + ln(r/innerR) / b
    const r = innerR + t * (outerR - innerR);
    const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
    const spiralTheta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B;

    // Deterministic per-node jitter (so positions are stable across redraws)
    const seed = hash01(id + ':angle');
    const seed2 = hash01(id + ':radial');
    const thetaJitter = (seed - 0.5) * ARM_WIDTH;
    const radialJitter = (seed2 - 0.5) * r * 0.08;

    return {
      baseR: r + radialJitter,
      baseTheta: spiralTheta + thetaJitter,
      cx, cy
    };
  }

  /* ─── BUILD ACTIVE STAR PARTICLES ──────────────────────────────────────── */
  function buildParticles() {
    const nodes = (NX.nodes || []).slice();
    if (!nodes.length) { state.particles = []; return; }

    // Prioritize nodes by access_count + recency, keep top ACTIVE_MAX as live stars.
    // The rest get rolled into the distant field.
    nodes.sort((a, b) => {
      const ar = (a.access_count || 0) + (a.last_relevant_date ? 10 : 0);
      const br = (b.access_count || 0) + (b.last_relevant_date ? 10 : 0);
      return br - ar;
    });

    const active = nodes.slice(0, ACTIVE_MAX);
    const particles = [];

    for (let i = 0; i < active.length; i++) {
      const node = active[i];
      const community = node.community_id != null ? node.community_id : 0;
      const arm = community % ARM_COUNT;

      // Radial position — higher access_count → closer to center
      const importance = Math.min(1, (node.access_count || 0) / 20);
      const t = 1 - importance * 0.6 + gauss(0.15);  // inner + scatter
      const tClamped = Math.max(0.05, Math.min(0.95, t));

      const place = placeOnArm(arm, tClamped, node.id || i);

      // Voice assignment — determines audio-reactive band
      // Uses node id hash for deterministic distribution: ~40% bass, 40% mid, 20% high
      const vHash = hash01(node.id + ':voice');
      const voice = vHash < 0.4 ? 'bass' : vHash < 0.8 ? 'mid' : 'high';

      // Size + base brightness
      const size = 1.5 + importance * 2.5;
      const brightness = 0.45 + importance * 0.5;

      // Tint by community
      const tintIdx = Math.abs(community) % COMMUNITY_TINTS.length;
      const color = COMMUNITY_TINTS[tintIdx];

      // Orbital omega — differential (inner faster)
      const omega = BASE_OMEGA * Math.pow(tClamped, -DIFFERENTIAL);

      // Twinkle phase — each node breathes on its own cycle
      const twinklePhase = hash01(node.id + ':twinkle') * Math.PI * 2;
      const twinkleSpeed = 0.2 + hash01(node.id + ':twinkleSpeed') * 0.3;

      particles.push({
        id: node.id,
        node,                 // public — external code reads p.node
        arm,
        baseR: place.baseR,
        baseTheta: place.baseTheta,
        omega,
        size,
        brightness,
        color,
        voice,
        twinklePhase, twinkleSpeed,
        // Live-computed each frame (for public access)
        x: 0, y: 0,
        screenX: 0, screenY: 0,
        // Audio response
        audioGlow: 0
      });
    }

    state.particles = particles;
    buildCommCenters();  // Keep the community centers the old code exposed
  }

  /* ─── COMMUNITY CENTERS (for external API compatibility) ──────────────── */
  function buildCommCenters() {
    const groups = new Map();
    state.particles.forEach(p => {
      const cid = p.node?.community_id;
      if (cid == null) return;
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid).push(p);
    });
    const centers = {};
    groups.forEach((members, cid) => {
      // Average position of this community's members (in canvas space)
      let sx = 0, sy = 0;
      members.forEach(m => { sx += m.x; sy += m.y; });
      sx /= members.length; sy /= members.length;
      const tintIdx = Math.abs(cid) % COMMUNITY_TINTS.length;
      centers[cid] = {
        x: sx, y: sy,
        r: Math.max(40, Math.sqrt(members.length) * 14),
        color: COMMUNITY_TINTS[tintIdx],
        count: members.length,
        label: 'Zone ' + cid
      };
    });
    state.commCenters = centers;
  }


  /* ─── DISTANT FIELD (baked once, rotated live) ────────────────────────── */
  // All the stars you never draw individually each frame. Archived nodes + dust.
  // Baked to an offscreen canvas so we just rotate + blit — 1ms regardless of count.
  function buildDistantField() {
    const W = state.W, H = state.H;
    if (W < 10 || H < 10) return;

    const off = document.createElement('canvas');
    off.width = W * state.dpr;
    off.height = H * state.dpr;
    const octx = off.getContext('2d');
    octx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    octx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const minDim = Math.min(W, H);

    // Tier 1 — pure dust: 1500 points filling the spiral arms
    const DUST_COUNT = 1500;
    for (let i = 0; i < DUST_COUNT; i++) {
      const arm = i % ARM_COUNT;
      const t = Math.pow(Math.random(), 0.7);  // bias toward inner (denser core)
      const r = minDim * INNER_R_FRAC + t * minDim * (OUTER_R_FRAC - INNER_R_FRAC) * 1.15;
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const theta = baseAngle + Math.log(Math.max(r / (minDim * INNER_R_FRAC), 1.01)) / SPIRAL_B;
      const thetaJitter = gauss(ARM_WIDTH * 1.5);
      const radialJitter = gauss(r * 0.06);
      const finalR = r + radialJitter;
      const finalT = theta + thetaJitter;

      const x = cx + Math.cos(finalT) * finalR;
      const y = cy + Math.sin(finalT) * finalR;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      // Dust is very dim amber
      const alpha = 0.08 + Math.random() * 0.15;
      const size = Math.random() < 0.85 ? 0.7 : 1.2;
      octx.fillStyle = rgba(AMBER_DIM, alpha);
      octx.beginPath();
      octx.arc(x, y, size, 0, Math.PI * 2);
      octx.fill();
    }

    // Tier 2 — archived nodes: up to 1000 dimmer points, slightly brighter than dust
    // If NX.allNodes exists and has archived items, use them. Otherwise synthesize.
    const archived = (NX.allNodes || []).filter(n => n.archived || n.status === 'archived');
    const archToUse = archived.slice(0, 1000);
    const archCount = Math.max(1000, archToUse.length);

    for (let i = 0; i < archCount; i++) {
      const arm = i % ARM_COUNT;
      const t = 0.3 + Math.pow(Math.random(), 0.5) * 0.7;  // mostly outer regions
      const r = minDim * INNER_R_FRAC + t * minDim * (OUTER_R_FRAC - INNER_R_FRAC);
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const theta = baseAngle + Math.log(Math.max(r / (minDim * INNER_R_FRAC), 1.01)) / SPIRAL_B;
      const thetaJitter = gauss(ARM_WIDTH);
      const finalR = r + gauss(r * 0.05);
      const finalT = theta + thetaJitter;

      const x = cx + Math.cos(finalT) * finalR;
      const y = cy + Math.sin(finalT) * finalR;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      const alpha = 0.18 + Math.random() * 0.2;
      const size = 0.9 + Math.random() * 0.6;
      // Archived: tinted amber, slightly brighter than dust
      const archColor = mix(AMBER_DIM, AMBER, 0.3);
      octx.fillStyle = rgba(archColor, alpha);
      octx.beginPath();
      octx.arc(x, y, size, 0, Math.PI * 2);
      octx.fill();
    }

    state.distantCanvas = off;
  }

  /* ─── DRAW: distant field, rotated ─────────────────────────────────────── */
  function drawDistantField(dt) {
    if (!state.distantCanvas) return;
    state.distantAngle += dt * BASE_OMEGA * 0.5;  // slower than active stars
    const W = state.W, H = state.H;
    const cx = W / 2, cy = H / 2;
    ctx.save();
    // Apply camera first
    ctx.translate(cx + state.cam.x, cy + state.cam.y);
    ctx.scale(state.cam.zoom, state.cam.zoom);
    ctx.rotate(state.distantAngle);
    ctx.translate(-cx, -cy);
    ctx.drawImage(state.distantCanvas, 0, 0, W, H);
    ctx.restore();
  }


  /* ─── DRAW: active stars ───────────────────────────────────────────────── */
  function drawActiveStars(dt) {
    const W = state.W, H = state.H;
    const cx = W / 2, cy = H / 2;
    const zoom = state.cam.zoom;
    const camX = state.cam.x, camY = state.cam.y;

    // Decay audio-reactive glows
    const audioDecay = Math.exp(-dt * 4);

    // Running max audio bands normalize — decay over time
    if (state.songPlaying) {
      state.bassMax = Math.max(state.bassMax * 0.996, state.bass, 0.05);
      state.midMax  = Math.max(state.midMax  * 0.996, state.mid,  0.05);
      state.highMax = Math.max(state.highMax * 0.996, state.high, 0.05);
    }
    const bassN = state.songPlaying ? Math.min(1, state.bass / state.bassMax) : 0;
    const midN  = state.songPlaying ? Math.min(1, state.mid  / state.midMax)  : 0;
    const highN = state.songPlaying ? Math.min(1, state.high / state.highMax) : 0;

    // Are we in search mode or does chat have context?
    const hasSearchHits = state.searchHits && state.searchHits.size > 0;
    const hasActivated = state.activatedNodes && state.activatedNodes.size > 0;

    // Shockwave check
    let shock = null;
    if (state.shockwave) {
      const sElapsed = state.t - state.shockwave.startT;
      if (sElapsed < 4.0) {
        shock = {
          radius: sElapsed * (Math.min(W, H) * 0.7),  // expands outward over 4s
          thickness: 80,
          intensity: Math.max(0, 1 - sElapsed / 4.0)
        };
      } else {
        state.shockwave = null;
      }
    }

    ctx.save();
    ctx.translate(cx + camX, cy + camY);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    const P = state.particles;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      // Live orbital position — the heart of the whole thing
      const theta = p.baseTheta + p.omega * state.t;
      p.x = cx + Math.cos(theta) * p.baseR;
      p.y = cy + Math.sin(theta) * p.baseR;

      // Cull off-screen (in world coords this is simple)
      if (p.x < -20 || p.x > W+20 || p.y < -20 || p.y > H+20) continue;

      // Twinkle — subtle breathing per node
      const twinkle = 0.92 + Math.sin(state.t * p.twinkleSpeed + p.twinklePhase) * 0.08;

      // Base brightness
      let alpha = p.brightness * twinkle;
      let color = p.color;
      let size = p.size;

      // Audio reactivity (during song)
      if (state.songPlaying) {
        let bandN = 0;
        if (p.voice === 'bass') bandN = bassN;
        else if (p.voice === 'mid') bandN = midN;
        else bandN = highN;
        p.audioGlow = Math.max(p.audioGlow * audioDecay, bandN);
        alpha = Math.min(1.4, alpha + p.audioGlow * 0.5);
        // Bright-push color toward AMBER_BRIGHT when audio-hot
        color = mix(p.color, AMBER_BRIGHT, p.audioGlow * 0.6);
      }

      // Activated (chat context) — pulsing bright
      if (hasActivated && state.activatedNodes.has(p.id)) {
        const pulse = 0.7 + Math.sin(state.t * 3) * 0.3;
        alpha = Math.min(1.4, alpha + 0.5 * pulse);
        color = mix(color, AMBER_BRIGHT, 0.6);
        size = p.size * 1.6;
      } else if (hasActivated) {
        alpha *= 0.35;  // dim the rest when there's a context
      }

      // Search hits — flash bright, outline
      if (hasSearchHits && state.searchHits.has(p.id)) {
        alpha = 1.3;
        color = AMBER_BRIGHT;
        size = p.size * 2;
      } else if (hasSearchHits) {
        alpha *= 0.3;
      }

      // Shockwave lights up nodes as wavefront crosses them
      if (shock) {
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (Math.abs(d - shock.radius) < shock.thickness) {
          const wavePos = 1 - Math.abs(d - shock.radius) / shock.thickness;
          alpha = Math.min(1.5, alpha + wavePos * shock.intensity * 0.8);
          color = mix(color, AMBER_BRIGHT, wavePos * shock.intensity);
          size = p.size * (1 + wavePos * shock.intensity);
        }
      }

      // Active/hover state
      if (state.activeNode?.id === p.id || state.hoverNode?.id === p.id) {
        alpha = 1.4;
        size = p.size * 1.8;
        color = AMBER_BRIGHT;
      }

      // Draw with a soft halo for brighter stars
      if (alpha > 0.6) {
        // Halo
        ctx.fillStyle = rgba(color, alpha * 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();

      // Store screen position for hit testing
      p.screenX = (p.x - cx) * zoom + cx + camX;
      p.screenY = (p.y - cy) * zoom + cy + camY;
    }

    ctx.restore();
  }


  /* ─── METEORS — pending queue visualization ────────────────────────────── */
  // Spawn rate scales with pending count. Each meteor curves inward from edge to black hole.
  function spawnMeteor() {
    if (state.meteors.length >= METEOR_MAX) return;
    const W = state.W, H = state.H;
    const cx = W / 2, cy = H / 2;
    const edge = Math.max(W, H) * 0.7;
    const ang = Math.random() * Math.PI * 2;
    const startX = cx + Math.cos(ang) * edge;
    const startY = cy + Math.sin(ang) * edge;
    // Curve the path — use a mid-control point perpendicular to the direct line
    const midX = (startX + cx) / 2 + (Math.random() - 0.5) * edge * 0.3;
    const midY = (startY + cy) / 2 + (Math.random() - 0.5) * edge * 0.3;
    state.meteors.push({
      startX, startY, midX, midY, endX: cx, endY: cy,
      bornT: state.t,
      duration: 1.6 + Math.random() * 1.0,
      trail: []
    });
  }

  function updateMeteors(dt) {
    // Spawn rate proportional to pending count
    const rate = Math.min(3, state.pendingCount / 500);  // max 3/sec
    if (rate > 0 && state.t - state.lastMeteorSpawn > 1 / rate) {
      spawnMeteor();
      state.lastMeteorSpawn = state.t;
    }

    // Update + cull
    for (let i = state.meteors.length - 1; i >= 0; i--) {
      const m = state.meteors[i];
      const age = state.t - m.bornT;
      const t = age / m.duration;
      if (t >= 1) {
        state.meteors.splice(i, 1);
        continue;
      }
      // Quadratic bezier
      const u = 1 - t;
      const x = u*u*m.startX + 2*u*t*m.midX + t*t*m.endX;
      const y = u*u*m.startY + 2*u*t*m.midY + t*t*m.endY;
      m.trail.push({ x, y, age: 0 });
      if (m.trail.length > 12) m.trail.shift();
      m.trail.forEach(p => p.age += dt);
      m.x = x; m.y = y; m.t = t;
    }
  }

  function drawMeteors() {
    const cx = state.W / 2, cy = state.H / 2;
    ctx.save();
    ctx.translate(cx + state.cam.x, cy + state.cam.y);
    ctx.scale(state.cam.zoom, state.cam.zoom);
    ctx.translate(-cx, -cy);
    for (const m of state.meteors) {
      // Trail
      for (let j = 0; j < m.trail.length; j++) {
        const tp = m.trail[j];
        const a = Math.max(0, (1 - tp.age * 2)) * (j / m.trail.length) * 0.5;
        if (a < 0.02) continue;
        ctx.fillStyle = rgba(AMBER_BRIGHT, a);
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Head — bright white-gold
      const headAlpha = 0.9 * (1 - m.t * 0.6);
      ctx.fillStyle = rgba(AMBER_BRIGHT, headAlpha * 0.3);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(AMBER_BRIGHT, headAlpha);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ─── SPARKLES — spawn on high-frequency audio transients ──────────────── */
  function spawnSparkle() {
    if (state.sparkles.length >= SPARKLE_MAX) return;
    const cx = state.W / 2, cy = state.H / 2;
    const ang = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 180;
    state.sparkles.push({
      x: cx + Math.cos(ang) * (state.hole.r + 5),
      y: cy + Math.sin(ang) * (state.hole.r + 5),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      bornT: state.t,
      life: 0.8 + Math.random() * 0.4
    });
  }

  function updateSparkles(dt) {
    for (let i = state.sparkles.length - 1; i >= 0; i--) {
      const s = state.sparkles[i];
      const age = state.t - s.bornT;
      if (age >= s.life) { state.sparkles.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.5, dt);   // gentle drag
      s.vy *= Math.pow(0.5, dt);
      s.t = age / s.life;
    }
  }

  function drawSparkles() {
    const cx = state.W / 2, cy = state.H / 2;
    ctx.save();
    ctx.translate(cx + state.cam.x, cy + state.cam.y);
    ctx.scale(state.cam.zoom, state.cam.zoom);
    ctx.translate(-cx, -cy);
    for (const s of state.sparkles) {
      const fade = 1 - s.t;
      ctx.fillStyle = rgba(AMBER_BRIGHT, fade * 0.35);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3 * fade, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba([255, 245, 220], fade * 0.9);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.3 * fade, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ─── NEXUS BLACK HOLE ─────────────────────────────────────────────────── */
  function drawBlackHole(dt) {
    const cx = state.W / 2, cy = state.H / 2;
    // Ring animation
    state.hole.ringAngle += dt * 0.25;
    // Audio response on ring brightness + disc scale
    let ringBrightness = 0.55;
    let discScale = 1.0;
    if (state.songPlaying) {
      const bassN = Math.min(1, state.bass / state.bassMax);
      ringBrightness = 0.55 + bassN * 0.45;
      discScale = 1.0 + bassN * 0.12;
    }
    // Idle pulse — subtle 6-second breath
    const idlePulse = 0.5 + Math.sin(state.t / 6 * Math.PI * 2) * 0.5;  // 0..1
    ringBrightness = Math.max(ringBrightness, 0.4 + idlePulse * 0.15);

    const screenX = cx + state.cam.x;
    const screenY = cy + state.cam.y;
    const r = state.hole.r * state.cam.zoom * discScale;

    // Outer halo — when song playing or search active, brighter
    let haloStrength = 0.12;
    if (state.songPlaying) haloStrength = 0.3;
    if (state.ingestionActive) haloStrength = Math.max(haloStrength, 0.22);

    const grd = ctx.createRadialGradient(screenX, screenY, r, screenX, screenY, r * 3.5);
    grd.addColorStop(0, rgba(AMBER, haloStrength));
    grd.addColorStop(1, rgba(AMBER, 0));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(screenX, screenY, r * 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Accretion ring — segmented, rotating
    const ringR = r * 1.25;
    ctx.lineWidth = Math.max(1, r * 0.06);
    const segments = 24;
    for (let s = 0; s < segments; s++) {
      const a0 = state.hole.ringAngle + s * (Math.PI * 2 / segments);
      const a1 = a0 + (Math.PI * 2 / segments) * 0.75;
      // Gradient-ish: alternate opacity
      const segAlpha = ringBrightness * (0.5 + 0.5 * Math.sin(a0 * 2 + state.t));
      ctx.strokeStyle = rgba(AMBER_BRIGHT, segAlpha);
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringR, a0, a1);
      ctx.stroke();
    }

    // Dark disc
    ctx.fillStyle = '#02020a';
    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
    ctx.fill();
    // Subtle inner rim
    ctx.strokeStyle = rgba(AMBER, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screenX, screenY, r * 0.95, 0, Math.PI * 2);
    ctx.stroke();

    // "NEXUS" etched on the disc
    ctx.save();
    ctx.fillStyle = rgba(AMBER, 0.55);
    ctx.font = `${Math.max(9, r * 0.28)}px -apple-system, "SF Pro Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '2px';
    ctx.fillText('NEXUS', screenX, screenY);
    ctx.restore();

    // Save for hit testing
    state.hole.screenX = screenX;
    state.hole.screenY = screenY;
    state.hole.screenR = r;
  }


  /* ─── AUDIO PIPELINE ───────────────────────────────────────────────────── */
  async function startSong() {
    try {
      if (!state.audio) {
        state.audio = new Audio();
        // Try app-local first; fall back to GitHub-hosted theme
        state.audio.src = 'audio/nexus-theme.mp3';
        state.audio.crossOrigin = 'anonymous';
        state.audio.preload = 'auto';
      }
      if (!state.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { console.warn('[Galaxy] No AudioContext'); return; }
        state.audioCtx = new Ctx();
        const source = state.audioCtx.createMediaElementSource(state.audio);
        state.analyser = state.audioCtx.createAnalyser();
        state.analyser.fftSize = 256;
        state.analyser.smoothingTimeConstant = 0.7;
        source.connect(state.analyser);
        state.analyser.connect(state.audioCtx.destination);
        state.audioData = new Uint8Array(state.analyser.frequencyBinCount);
      }
      if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

      // Restart from the beginning
      state.audio.currentTime = 0;
      await state.audio.play();

      state.songPlaying = true;
      state.songEndsAt = state.t + (state.audio.duration || 75);

      // Fire the opening shockwave
      state.shockwave = { startT: state.t };

      // Listen for natural end
      state.audio.onended = () => {
        state.songPlaying = false;
        state.shockwave = null;
      };
    } catch (e) {
      console.warn('[Galaxy] Song start failed:', e);
      // Shockwave still fires even without audio — tap feedback
      state.shockwave = { startT: state.t };
    }
  }

  function sampleAudio() {
    if (!state.songPlaying || !state.analyser) { state.bass = state.mid = state.high = 0; return; }
    state.analyser.getByteFrequencyData(state.audioData);
    // 128 bins. Freq = bin * (sampleRate/2) / 128. @44.1kHz: each bin ~172Hz
    // Bass  = bins 1..4   (~170-690Hz  — we'll treat this as low-end presence)
    // Mid   = bins 5..40  (~860-6900Hz — where melody lives)
    // High  = bins 40..127(~6900+Hz    — sparkle band)
    let b=0, m=0, h=0;
    for (let i = 1; i <= 4;  i++) b += state.audioData[i];
    for (let i = 5; i <= 40; i++) m += state.audioData[i];
    for (let i = 40; i < 128; i++) h += state.audioData[i];
    state.bass = b / 4 / 255;
    state.mid  = m / 36 / 255;
    state.high = h / 88 / 255;

    // Detect high-frequency transient → spawn sparkle
    const highN = Math.min(1, state.high / state.highMax);
    if (highN > 0.6 && state.t - state.lastHighPeak > 0.08) {
      const bursts = Math.floor(1 + highN * 3);
      for (let i = 0; i < bursts; i++) spawnSparkle();
      state.lastHighPeak = state.t;
    }
  }

  /* ─── MAIN RENDER LOOP ─────────────────────────────────────────────────── */
  let rafId = null;
  function tick(nowMs) {
    const now = nowMs / 1000;
    const dt = state.lastFrame ? Math.min(0.1, now - state.lastFrame) : 0.016;
    state.lastFrame = now;
    state.t = now;

    // Running avg frame time for perf detection
    state.frameMs = state.frameMs * 0.95 + (dt * 1000) * 0.05;
    if (!state.perfMode && state.frameMs > 22) {
      state.perfMode = true;
      console.warn('[Galaxy] Entering perf mode (avg frame ' + state.frameMs.toFixed(1) + 'ms)');
    }

    // Smooth camera target
    const camLerp = 1 - Math.exp(-dt * 6);
    state.cam.zoom += (state.cam.targetZoom - state.cam.zoom) * camLerp;
    state.cam.x    += (state.cam.targetX    - state.cam.x)    * camLerp;
    state.cam.y    += (state.cam.targetY    - state.cam.y)    * camLerp;

    // Audio
    sampleAudio();

    // Simulate
    updateMeteors(dt);
    updateSparkles(dt);

    // Clear
    ctx.fillStyle = '#04040c';
    ctx.fillRect(0, 0, state.W, state.H);

    // Layer compositing
    drawDistantField(dt);
    drawActiveStars(dt);
    drawMeteors();
    drawSparkles();
    drawBlackHole(dt);

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) return;
    state.lastFrame = 0;
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }


  /* ─── INTERACTION ──────────────────────────────────────────────────────── */
  function findNodeAt(sx, sy) {
    // Hit test in screen space
    let closest = null, closestD = TAP_SLOP * TAP_SLOP;
    const P = state.particles;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const dx = p.screenX - sx, dy = p.screenY - sy;
      const d2 = dx*dx + dy*dy;
      const reach = Math.max(TAP_SLOP, p.size * state.cam.zoom + 6);
      if (d2 < reach * reach && d2 < closestD) {
        closest = p;
        closestD = d2;
      }
    }
    return closest;
  }

  function isHoleTap(sx, sy) {
    const h = state.hole;
    if (!h.screenX) return false;
    const dx = sx - h.screenX, dy = sy - h.screenY;
    const reach = Math.max(40, h.screenR * 1.4);
    return dx*dx + dy*dy < reach * reach;
  }

  function setupCanvasEvents() {
    let touchStartT = 0;
    let touchMoved = false;

    function clientXY(e) {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', e => {
      const p = clientXY(e);
      state.dragging = true;
      state.dragStart = p;
      state.dragCamStart = { x: state.cam.targetX, y: state.cam.targetY };
      touchStartT = now();
      touchMoved = false;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
      const p = clientXY(e);
      if (!state.dragging) {
        const hover = findNodeAt(p.x, p.y);
        state.hoverNode = hover ? hover.node : null;
        canvas.style.cursor = hover ? 'pointer' : (isHoleTap(p.x, p.y) ? 'pointer' : 'grab');
        return;
      }
      const dx = p.x - state.dragStart.x, dy = p.y - state.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) touchMoved = true;
      state.cam.targetX = state.dragCamStart.x + dx;
      state.cam.targetY = state.dragCamStart.y + dy;
      state.cam.x = state.cam.targetX;
      state.cam.y = state.cam.targetY;
    });

    canvas.addEventListener('pointerup', e => {
      const p = clientXY(e);
      state.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
      if (touchMoved) return;

      // Tap — hole or node or empty
      if (isHoleTap(p.x, p.y)) {
        startSong();
        return;
      }
      const node = findNodeAt(p.x, p.y);
      if (node) {
        state.activeNode = node.node;
        state.frozenNode = node;
        openPanel(node.node);
        // Soft zoom onto it
        state.cam.targetZoom = Math.min(2.2, state.cam.targetZoom * 1.4);
      } else {
        // Tap on empty space — close panel
        if (state.activeNode) closePanel();
      }
    });

    // Wheel zoom (desktop)
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.12 : 0.88;
      state.cam.targetZoom = Math.max(0.5, Math.min(3, state.cam.targetZoom * scale));
    }, { passive: false });

    // Pinch zoom (touch)
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.sqrt(dx*dx + dy*dy);
        pinchStartZoom = state.cam.targetZoom;
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d = Math.sqrt(dx*dx + dy*dy);
        state.cam.targetZoom = Math.max(0.5, Math.min(3, pinchStartZoom * d / pinchStartDist));
      }
    }, { passive: true });
    canvas.addEventListener('touchend', () => { pinchStartDist = 0; });

    // Double-tap reset
    let lastTap = 0;
    canvas.addEventListener('click', () => {
      const n = now();
      if (n - lastTap < 0.35) {
        state.cam.targetZoom = 1;
        state.cam.targetX = 0;
        state.cam.targetY = 0;
      }
      lastTap = n;
    });
  }

  /* ─── PANEL (opening node detail — uses existing NX.brain openPanel contract) ── */
  function openPanel(node) {
    // If external code (brain-chat/list) overrode this via assignment, honor it.
    // Otherwise, fire a custom event for panels to listen to.
    const evt = new CustomEvent('galaxy:node-open', { detail: { node } });
    document.dispatchEvent(evt);
  }

  function closePanel() {
    state.activeNode = null;
    state.frozenNode = null;
    state.cam.targetZoom = 1;
    state.cam.targetX = 0;
    state.cam.targetY = 0;
    document.dispatchEvent(new CustomEvent('galaxy:panel-close'));
  }

  function wakePhysics() {
    // Legacy API — in new architecture there's no physics to wake.
    // We use this as a signal to refresh state from external sources.
    if (state.activatedNodes && state.activatedNodes.size > 0) {
      // Chat just set context — audio-glow those nodes visibly
      state.particles.forEach(p => {
        if (state.activatedNodes.has(p.id)) p.audioGlow = 1.0;
      });
    }
  }

  /* ─── AMBIENT SYSTEM ACTIVITY (reads from app state) ──────────────────── */
  function updateSystemState() {
    // Read pending count from NX.allNodes or some counter the app maintains
    if (typeof NX.pendingCount === 'number') {
      state.pendingCount = NX.pendingCount;
    } else if (NX.allNodes) {
      state.pendingCount = NX.allNodes.filter(n => n.processed === false || n.status === 'pending').length;
    }
    state.ingestionActive = state.pendingCount > 0;
  }

  /* ─── INIT ─────────────────────────────────────────────────────────────── */
  async function init() {
    resize();
    if (state.W < 10 || state.H < 10) {
      setTimeout(init, 200);
      return;
    }
    buildParticles();
    setupCanvasEvents();
    updateSystemState();
    // Update system state periodically
    setInterval(updateSystemState, 5000);
    // Start the render loop
    startLoop();
    // Call chat/list initializers if they exist (preserves old contract)
    if (NX.brain?.initChat) try { NX.brain.initChat(); } catch(_) {}
    if (NX.brain?.initList) try { NX.brain.initList(); } catch(_) {}
    if (NX.brain?.initEvents) try { NX.brain.initEvents(); } catch(_) {}
  }

  /* ─── VISIBILITY — pause loop when hidden ──────────────────────────────── */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
      if (state.audio && !state.audio.paused) state.audio.pause();
    } else {
      startLoop();
    }
  });

  window.addEventListener('resize', () => {
    clearTimeout(state._resizeT);
    state._resizeT = setTimeout(resize, 180);
  });

  /* ─── PUBLIC API ───────────────────────────────────────────────────────── */
  NX.brain = {
    init,
    closePanel,
    openPanel,
    wakePhysics,
    state,
    show: () => { requestAnimationFrame(() => { resize(); }); },
    // Kill switches (for debugging)
    off: () => stopLoop(),
    on: () => startLoop(),
    // Rebuild after NX.nodes changes
    rebuild: () => { buildParticles(); }
  };
  NX.modules = NX.modules || {};
  NX.modules.brain = NX.brain;
  NX.loaded = NX.loaded || {};
  NX.loaded.brain = true;

  console.log('[Galaxy] loaded — procedural spiral, audio-reactive, ' + ACTIVE_MAX + ' active stars max');

})();
