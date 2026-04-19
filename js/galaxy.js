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
  // Barred spiral (like Milky Way): 2 main arms + central bar feel
  const ARM_COUNT      = 2;         // two dominant arms (barred spiral)
  const SPIRAL_B       = 0.32;      // looser winding — arms spread more
  const INNER_R_FRAC   = 0.14;      // pushed outward — core is negative space for the fog/bar
  const OUTER_R_FRAC   = 0.55;      // arms reach further toward edges
  const ARM_WIDTH      = 0.28;      // fatter arms — more dispersion for depth

  const BASE_OMEGA     = 0.012;     // slower, more majestic
  const DIFFERENTIAL   = 0.6;       // stronger inner-faster effect

  const DISTANT_COUNT  = 3500;      // more background fog density
  const ACTIVE_MAX     = 800;       // cap on live-drawn active stars
  const METEOR_MAX     = 10;        // slightly fewer, more impactful
  const SPARKLE_MAX    = 80;        // max concurrent sparkle particles

  // Star size scaling — controls overall brightness/density feel
  const STAR_SIZE_MIN  = 0.6;       // dimmest active star
  const STAR_SIZE_MAX  = 2.8;       // brightest active star (was effectively 4+halo=blob)
  const HALO_RATIO     = 1.8;       // halo radius = size * this (was 2.6, too blobby)
  const HALO_ALPHA     = 0.18;      // halo opacity multiplier (was 0.25)

  // Per-node tap target radius (in screen pixels)
  const TAP_SLOP       = 14;

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
    const minDim = Math.min(state.W, state.H);
    const innerR = minDim * INNER_R_FRAC;
    const outerR = minDim * OUTER_R_FRAC;

    for (let i = 0; i < active.length; i++) {
      const node = active[i];
      const community = node.community_id != null ? node.community_id : 0;
      const arm = community % ARM_COUNT;

      // Radial position — higher access_count → closer to center
      // But use Sérsic-ish bias so most nodes end up in the middle band, not piled at edge
      const importance = Math.min(1, (node.access_count || 0) / 20);
      let t = Math.pow(Math.random(), 0.7) * (1 - importance * 0.5);
      t = Math.max(0.08, Math.min(0.95, t));

      const place = placeOnArm(arm, t, node.id || i);

      // Voice assignment — determines audio-reactive band
      const vHash = hash01(node.id + ':voice');
      const voice = vHash < 0.4 ? 'bass' : vHash < 0.8 ? 'mid' : 'high';

      // Radial norm (0=core, 1=edge) for depth effects
      const radialNorm = (place.baseR - innerR) / (outerR - innerR);
      const radialClamped = Math.max(0, Math.min(1, radialNorm));

      // Size: importance + inner-boost. Clamped tight to avoid blobs.
      const sizeRaw = STAR_SIZE_MIN + importance * (STAR_SIZE_MAX - STAR_SIZE_MIN);
      const sizeDepthBoost = 1 + (1 - radialClamped) * 0.4;  // bigger near center
      const size = Math.min(STAR_SIZE_MAX, sizeRaw * sizeDepthBoost);

      // Brightness — core stars brighter (Sérsic), outer stars dimmer
      const falloff = Math.exp(-radialClamped * 1.2);
      const brightness = 0.35 + importance * 0.35 + falloff * 0.25;

      // Color — warm white near core, amber in arms, deeper amber at edge
      let color;
      if (radialClamped < 0.25) {
        color = mix([255, 230, 170], AMBER, radialClamped / 0.25);
      } else {
        const tintIdx = Math.abs(community) % COMMUNITY_TINTS.length;
        const communityTint = COMMUNITY_TINTS[tintIdx];
        color = mix(communityTint, AMBER_DIM, Math.max(0, (radialClamped - 0.6) * 1.0));
      }

      // Orbital omega — differential (inner faster)
      const omega = BASE_OMEGA * Math.pow(t, -DIFFERENTIAL);

      // Twinkle phase — each node breathes on its own cycle
      const twinklePhase = hash01(node.id + ':twinkle') * Math.PI * 2;
      const twinkleSpeed = 0.2 + hash01(node.id + ':twinkleSpeed') * 0.3;

      particles.push({
        id: node.id,
        node,
        arm,
        baseR: place.baseR,
        baseTheta: place.baseTheta,
        radialNorm: radialClamped,
        omega,
        size,
        brightness: Math.min(0.95, brightness),
        color,
        voice,
        twinklePhase, twinkleSpeed,
        x: 0, y: 0,
        screenX: 0, screenY: 0,
        audioGlow: 0
      });
    }

    state.particles = particles;
    buildCommCenters();
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
  // Two-layer bake:
  //   (1) Core fog — gaussian haze from center, Sérsic-style falloff. Makes the
  //       galaxy look "full of light" instead of empty-with-spots.
  //   (2) Star points — 3500 tiny stars placed along the arms.
  //   (3) Archived data nodes — real items, slightly brighter than dust.
  //
  // All baked to one offscreen canvas, rotated + blitted each frame.
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
    const innerR = minDim * INNER_R_FRAC;
    const outerR = minDim * OUTER_R_FRAC;

    /* ─── LAYER 1: Core fog (gaussian haze) ─────────────────────────── */
    // Radial gradient from bright-core to transparent outer edge.
    // Approximates the unresolved-stars glow of a real galaxy bulge.
    // Use additive compositing so overlapping gradients build up color.
    octx.globalCompositeOperation = 'screen';

    // Bright warm-white core
    const coreGrd = octx.createRadialGradient(cx, cy, 0, cx, cy, outerR * 0.4);
    coreGrd.addColorStop(0.0, 'rgba(255, 230, 170, 0.22)');  // hot core
    coreGrd.addColorStop(0.3, 'rgba(220, 180, 120, 0.12)');  // warm mid
    coreGrd.addColorStop(0.7, 'rgba(160, 130, 80, 0.04)');   // fading amber
    coreGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = coreGrd;
    octx.fillRect(0, 0, W, H);

    // Subtle "bar" — elongated glow along horizontal axis (barred spiral signature)
    octx.save();
    octx.translate(cx, cy);
    octx.scale(1.6, 0.55);  // elongate horizontally, flatten vertically
    const barGrd = octx.createRadialGradient(0, 0, 0, 0, 0, outerR * 0.25);
    barGrd.addColorStop(0.0, 'rgba(240, 200, 140, 0.18)');
    barGrd.addColorStop(0.6, 'rgba(180, 140, 90, 0.05)');
    barGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = barGrd;
    octx.fillRect(-outerR, -outerR, outerR * 2, outerR * 2);
    octx.restore();

    /* ─── LAYER 2: Arm haze — soft amber mist along each arm ────────── */
    // Draw 40 large soft blobs along each arm trajectory
    for (let arm = 0; arm < ARM_COUNT; arm++) {
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      for (let i = 0; i < 40; i++) {
        const t = i / 40;  // 0..1 along arm
        const r = innerR + t * (outerR - innerR);
        const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;

        // Larger blob at inner part of arm, smaller at tips
        const blobR = 35 + (1 - t) * 40;
        const intensity = 0.05 + (1 - t) * 0.08;
        const blobGrd = octx.createRadialGradient(x, y, 0, x, y, blobR);
        blobGrd.addColorStop(0.0, `rgba(210, 170, 100, ${intensity})`);
        blobGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        octx.fillStyle = blobGrd;
        octx.beginPath();
        octx.arc(x, y, blobR, 0, Math.PI * 2);
        octx.fill();
      }
    }

    // Switch back to normal compositing for point stars
    octx.globalCompositeOperation = 'source-over';

    /* ─── LAYER 3: Point stars (dust) ────────────────────────────────── */
    // Sprinkled along arms with Sérsic-like radial distribution
    for (let i = 0; i < DISTANT_COUNT; i++) {
      const arm = i % ARM_COUNT;
      // t follows power law — denser near core (Sérsic-ish)
      const t = Math.pow(Math.random(), 0.45);
      const r = innerR + t * (outerR - innerR) * 1.2;

      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B;
      const thetaJitter = gauss(ARM_WIDTH * 1.3);
      const radialJitter = gauss(r * 0.08);
      const finalR = r + radialJitter;
      const finalT = theta + thetaJitter;

      const x = cx + Math.cos(finalT) * finalR;
      const y = cy + Math.sin(finalT) * finalR;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      // Distance-from-center determines brightness + color
      const radialNorm = finalR / outerR;
      // Core: warm white. Outer: deep amber. Interpolate.
      const color = radialNorm < 0.3
        ? mix([255, 230, 170], AMBER, radialNorm / 0.3)           // white → amber
        : mix(AMBER, AMBER_DIM, Math.min(1, (radialNorm - 0.3) / 0.7));  // amber → dim

      // Brightness also falls off radially (Sérsic-like)
      const falloff = Math.exp(-radialNorm * 1.5);
      const alpha = 0.15 + Math.random() * 0.35 * falloff;
      const size = Math.random() < 0.82 ? 0.6 : 1.0;

      octx.fillStyle = rgba(color, alpha);
      octx.beginPath();
      octx.arc(x, y, size, 0, Math.PI * 2);
      octx.fill();
    }

    /* ─── LAYER 4: Archived nodes (dim stars, slightly brighter than dust) ── */
    const archived = (NX.allNodes || []).filter(n => n.archived || n.status === 'archived');
    const archCount = Math.min(1200, archived.length || 800);

    for (let i = 0; i < archCount; i++) {
      const arm = i % ARM_COUNT;
      const t = 0.25 + Math.pow(Math.random(), 0.55) * 0.75;  // bias outward
      const r = innerR + t * (outerR - innerR);
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B;
      const thetaJitter = gauss(ARM_WIDTH);
      const finalR = r + gauss(r * 0.06);
      const finalT = theta + thetaJitter;

      const x = cx + Math.cos(finalT) * finalR;
      const y = cy + Math.sin(finalT) * finalR;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      const radialNorm = finalR / outerR;
      const color = mix(AMBER, AMBER_DIM, radialNorm * 0.6);
      const alpha = 0.25 + Math.random() * 0.25;
      const size = 0.9 + Math.random() * 0.5;

      octx.fillStyle = rgba(color, alpha);
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

    // Running max audio bands — decay gracefully
    if (state.songPlaying) {
      state.bassMax = Math.max(state.bassMax * 0.996, state.bass, 0.05);
      state.midMax  = Math.max(state.midMax  * 0.996, state.mid,  0.05);
      state.highMax = Math.max(state.highMax * 0.996, state.high, 0.05);
    }
    const bassN = state.songPlaying ? Math.min(1, state.bass / state.bassMax) : 0;
    const midN  = state.songPlaying ? Math.min(1, state.mid  / state.midMax)  : 0;
    const highN = state.songPlaying ? Math.min(1, state.high / state.highMax) : 0;

    const hasSearchHits = state.searchHits && state.searchHits.size > 0;
    const hasActivated = state.activatedNodes && state.activatedNodes.size > 0;

    // Shockwave check
    let shock = null;
    if (state.shockwave) {
      const sElapsed = state.t - state.shockwave.startT;
      if (sElapsed < 4.0) {
        shock = {
          radius: sElapsed * (Math.min(W, H) * 0.7),
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
    const haloList = [];  // collect halo-worthy stars for second pass (prevents stacking)

    // ─── PASS 1: Draw star cores ────────────────────────────────────────
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      // Live orbital position
      const theta = p.baseTheta + p.omega * state.t;
      p.x = cx + Math.cos(theta) * p.baseR;
      p.y = cy + Math.sin(theta) * p.baseR;

      if (p.x < -20 || p.x > W+20 || p.y < -20 || p.y > H+20) continue;

      // Twinkle — subtle
      const twinkle = 0.92 + Math.sin(state.t * p.twinkleSpeed + p.twinklePhase) * 0.08;
      let alpha = p.brightness * twinkle;
      let color = p.color;
      let size = p.size;
      let isSpecial = false;  // gets a halo

      // Audio reactivity
      if (state.songPlaying) {
        let bandN = 0;
        if (p.voice === 'bass') bandN = bassN;
        else if (p.voice === 'mid') bandN = midN;
        else bandN = highN;
        p.audioGlow = Math.max(p.audioGlow * audioDecay, bandN);
        if (p.audioGlow > 0.1) {
          alpha = Math.min(1.0, alpha + p.audioGlow * 0.35);
          color = mix(p.color, AMBER_BRIGHT, p.audioGlow * 0.5);
          if (p.audioGlow > 0.5) isSpecial = true;
        }
      }

      // Activated (chat context)
      if (hasActivated && state.activatedNodes.has(p.id)) {
        const pulse = 0.7 + Math.sin(state.t * 3) * 0.3;
        alpha = Math.min(1.0, alpha + 0.35 * pulse);
        color = mix(color, AMBER_BRIGHT, 0.55);
        isSpecial = true;
      } else if (hasActivated) {
        alpha *= 0.35;
      }

      // Search hits
      if (hasSearchHits && state.searchHits.has(p.id)) {
        alpha = 0.95;
        color = AMBER_BRIGHT;
        isSpecial = true;
      } else if (hasSearchHits) {
        alpha *= 0.3;
      }

      // Shockwave — only light up when wavefront is near
      if (shock) {
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (Math.abs(d - shock.radius) < shock.thickness) {
          const wavePos = 1 - Math.abs(d - shock.radius) / shock.thickness;
          alpha = Math.min(1.0, alpha + wavePos * shock.intensity * 0.6);
          color = mix(color, AMBER_BRIGHT, wavePos * shock.intensity * 0.8);
          if (wavePos > 0.5) isSpecial = true;
        }
      }

      // Active/hover
      if (state.activeNode?.id === p.id || state.hoverNode?.id === p.id) {
        alpha = 1.0;
        color = AMBER_BRIGHT;
        isSpecial = true;
      }

      // Clamp size — NEVER let a star render bigger than STAR_SIZE_MAX * 1.4
      // This is the critical fix against blobs
      const drawSize = Math.min(STAR_SIZE_MAX * 1.4, size);

      // Draw star core
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, drawSize, 0, Math.PI * 2);
      ctx.fill();

      // Queue for halo pass if special
      if (isSpecial || alpha > 0.7) {
        haloList.push({ x: p.x, y: p.y, size: drawSize, color, alpha });
      }

      // Store screen position for hit testing
      p.screenX = (p.x - cx) * zoom + cx + camX;
      p.screenY = (p.y - cy) * zoom + cy + camY;
    }

    // ─── PASS 2: Halos (additive blend, capped size) ────────────────────
    ctx.globalCompositeOperation = 'screen';
    for (const h of haloList) {
      const haloR = Math.min(STAR_SIZE_MAX * HALO_RATIO, h.size * HALO_RATIO);
      ctx.fillStyle = rgba(h.color, h.alpha * HALO_ALPHA);
      ctx.beginPath();
      ctx.arc(h.x, h.y, haloR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

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
  // Redesigned: no dashed ring. Reads as an astronomical object:
  //   1. Outer haze — soft amber gradient, largest
  //   2. Accretion glow — thicker warm ring, bright inner edge (photon sphere)
  //   3. Dark event horizon disc
  //   4. Faint NEXUS watermark (least visible element)
  function drawBlackHole(dt) {
    const cx = state.W / 2, cy = state.H / 2;
    state.hole.ringAngle += dt * 0.12;  // slower, more majestic

    // Audio response on disc scale + haze brightness
    let hazeStrength = 0.35;
    let discScale = 1.0;
    if (state.songPlaying) {
      const bassN = Math.min(1, state.bass / state.bassMax);
      hazeStrength = 0.35 + bassN * 0.45;
      discScale = 1.0 + bassN * 0.10;
    }
    if (state.ingestionActive) {
      hazeStrength = Math.max(hazeStrength, 0.45);
    }
    // Gentle idle pulse — 8 second breath
    const idlePulse = 0.5 + Math.sin(state.t / 8 * Math.PI * 2) * 0.5;
    hazeStrength = Math.max(hazeStrength, 0.3 + idlePulse * 0.1);

    const screenX = cx + state.cam.x;
    const screenY = cy + state.cam.y;
    const r = state.hole.r * state.cam.zoom * discScale;

    // ─── Layer 1: Outer haze (largest, softest) ──────────────────────
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const hazeR = r * 5.5;
    const hazeGrd = ctx.createRadialGradient(screenX, screenY, r * 0.8, screenX, screenY, hazeR);
    hazeGrd.addColorStop(0.0, rgba([240, 200, 130], hazeStrength * 0.55));
    hazeGrd.addColorStop(0.3, rgba(AMBER, hazeStrength * 0.3));
    hazeGrd.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = hazeGrd;
    ctx.beginPath();
    ctx.arc(screenX, screenY, hazeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ─── Layer 2: Accretion ring (bright warm, rotating brightness) ──
    // Instead of drawing a dashed segmented ring, use two soft stroke passes
    // for a continuous glowing ring with brightness variation along its circumference.
    ctx.save();
    const ringR = r * 1.4;
    // Wider, dimmer outer stroke
    ctx.lineWidth = r * 0.35;
    ctx.strokeStyle = rgba([255, 210, 140], 0.18 + hazeStrength * 0.15);
    ctx.beginPath();
    ctx.arc(screenX, screenY, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // Sharper inner stroke — photon-sphere bright edge
    ctx.lineWidth = Math.max(1.2, r * 0.08);
    ctx.strokeStyle = rgba([255, 240, 200], 0.5 + hazeStrength * 0.4);
    ctx.beginPath();
    ctx.arc(screenX, screenY, r * 1.18, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating brightness modulation along the ring — uses a second arc drawn in segments
    // with varying alpha (gives the "material orbiting" look without being a dashed ring)
    const segments = 48;
    for (let s = 0; s < segments; s++) {
      const a0 = state.hole.ringAngle + s * (Math.PI * 2 / segments);
      const a1 = a0 + (Math.PI * 2 / segments);
      const brightnessMod = Math.max(0, Math.sin(a0 * 2.3 + state.t * 0.4));
      if (brightnessMod < 0.2) continue;
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.strokeStyle = rgba(AMBER_BRIGHT, brightnessMod * 0.35 * (0.5 + hazeStrength));
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringR, a0, a1);
      ctx.stroke();
    }
    ctx.restore();

    // ─── Layer 3: Event horizon (dark disc) ──────────────────────────
    ctx.fillStyle = '#020208';
    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner edge glint — suggests light bending around the horizon
    ctx.strokeStyle = rgba([255, 220, 150], 0.25 + hazeStrength * 0.15);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(screenX, screenY, r * 0.98, 0, Math.PI * 2);
    ctx.stroke();

    // ─── Layer 4: NEXUS watermark (least visible element) ────────────
    ctx.save();
    ctx.fillStyle = rgba(AMBER, 0.35);
    ctx.font = `300 ${Math.max(8, r * 0.22)}px -apple-system, "SF Pro Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = '3px'; } catch(_) {}
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
