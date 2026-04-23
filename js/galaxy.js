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
    lastSpawnT: 0,
    songPlaying: false,
    fadeState: 'idle',           // 'idle' | 'in' | 'playing' | 'out'
    fadeStartT: 0,

    // Ambient system activity
    ingestionActive: false,

    // Black hole
    hole: {
      r: 26,
      ringAngle: 0,
      ringBrightness: 0.6,
      scale: 1.0,
      progress: 0,          // displayed progress (eased, glides toward target)
      progressTarget: 0,    // true position from audio.currentTime
      hazeAmount: 0         // 0..1 — smoothed haze presence, eases with play/pause
    },

    // ─── DATA LAYERS — every light in the sky represents something real ───
    dataLayers: {
      pending: [],           // raw_emails where processed=false → inter-arm stars
      tickets: [],           // open tickets → H-II bright puffs clustered by location
      openTicketsByLocation: {}, // for auxiliary glow density per arm
      contractorEvents: [],  // pending/confirmed events → soft pulsing signals
      recentLogs: [],        // last 24h daily_logs → activity haze clouds
      cards: [],              // kanban_cards not done → nebular clusters by column
      lastFetched: 0,        // timestamp of last DB query
      fetching: false        // prevent overlapping queries
    }
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
  const INNER_R_FRAC   = 0.12;      // Stage Q: tighter — more core presence
  const OUTER_R_FRAC   = 0.78;      // Stage Q: arms reach deep — fills viewport (was 0.55, too much dead space at bottom)
  const ARM_WIDTH      = 0.34;      // Stage Q: thicker arms (was 0.28) — more dispersion for depth
  const EDGE_FADE_FRAC = 0.15;      // Stage Q: outer 15% smoothly fades alpha — arms trail off, no hard circular cutoff
  const TILT_Y         = 0.88;      // Stage Q: ~8° Y-axis tilt — disc feels like a plane, not a circle

  const BASE_OMEGA     = -0.004;    // slower still — minutes per rotation
  const DIFFERENTIAL   = 0.6;       // stronger inner-faster effect

  const DISTANT_COUNT  = 9000;      // heavy star density, inter-arm fill handles the rest
  const ACTIVE_MAX     = 3000;      // every active knowledge node clickable (you have ~2751)
  const METEOR_MAX     = 10;        // slightly fewer, more impactful
  const SPARKLE_MAX    = 120;       // more particles — like old brain-canvas density

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
    const DL = state.dataLayers;

    /* ─── LOCATION → ARM mapping ──────────────────────────────────────
     * Each restaurant gets its own arm so you can visually tell which
     * location has the most activity at a glance.
     */
    const LOCATION_ARMS = { 'Suerte': 0, 'Este': 1, 'Bar Toti': 2 };
    function locToArm(loc) {
      if (!loc) return Math.floor(Math.random() * ARM_COUNT);
      const trimmed = String(loc).trim();
      if (LOCATION_ARMS[trimmed] !== undefined) return LOCATION_ARMS[trimmed];
      // Fallback — hash to arm for stable placement
      return Math.abs(hash01(trimmed) * 1000 | 0) % ARM_COUNT;
    }

    /* ─── AMBIENT LIGHTING LAYERS — pure decoration (no data meaning) ──
     * These are gradient fills that give the galaxy its luminous
     * structure. No particles — just light.
     */

    // Outer halo — diffuse glow beyond the disc
    octx.globalCompositeOperation = 'screen';
    const haloGrd = octx.createRadialGradient(cx, cy, outerR * 0.5, cx, cy, outerR * 1.8);
    haloGrd.addColorStop(0.0, 'rgba(120, 100, 70, 0.06)');
    haloGrd.addColorStop(0.5, 'rgba(90, 75, 55, 0.025)');
    haloGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = haloGrd;
    octx.fillRect(0, 0, W, H);

    // Bright bulge — multi-stop warm gradient
    const coreGrd = octx.createRadialGradient(cx, cy, 0, cx, cy, outerR * 0.45);
    coreGrd.addColorStop(0.00, 'rgba(255, 240, 200, 0.55)');
    coreGrd.addColorStop(0.08, 'rgba(255, 225, 170, 0.42)');
    coreGrd.addColorStop(0.20, 'rgba(240, 195, 140, 0.28)');
    coreGrd.addColorStop(0.40, 'rgba(210, 165, 100, 0.15)');
    coreGrd.addColorStop(0.70, 'rgba(160, 125, 75, 0.05)');
    coreGrd.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = coreGrd;
    octx.fillRect(0, 0, W, H);

    // Tight inner glow
    const innerGlow = octx.createRadialGradient(cx, cy, 0, cx, cy, outerR * 0.18);
    innerGlow.addColorStop(0.0, 'rgba(255, 250, 230, 0.5)');
    innerGlow.addColorStop(0.5, 'rgba(255, 230, 180, 0.25)');
    innerGlow.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = innerGlow;
    octx.fillRect(0, 0, W, H);

    // Barred spiral signature
    octx.save();
    octx.translate(cx, cy);
    octx.scale(1.8, 0.5);
    const barGrd = octx.createRadialGradient(0, 0, 0, 0, 0, outerR * 0.3);
    barGrd.addColorStop(0.0, 'rgba(255, 220, 160, 0.28)');
    barGrd.addColorStop(0.5, 'rgba(200, 160, 100, 0.10)');
    barGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = barGrd;
    octx.fillRect(-outerR, -outerR, outerR * 2, outerR * 2);
    octx.restore();

    /* ─── DATA LAYER A: Recent activity haze (daily_logs last 24h) ────
     * Every entry in daily_logs becomes a soft amber glow at its
     * location's arm + random radius. Clusters form where activity
     * is concentrated.
     *
     * Meaning: bright haze = active ops happening RIGHT NOW.
     */
    if (DL.recentLogs.length > 0) {
      for (const log of DL.recentLogs) {
        // Parse location from entry text if present (entries often start with [LOC])
        const match = /\[(Suerte|Este|Bar Toti|CLEAN|TICKET|SYSTEM)\]/i.exec(log.entry || '');
        const locToken = match ? match[1] : null;
        const arm = locToArm(locToken);
        const baseAngle = arm * (2 * Math.PI / ARM_COUNT);

        // Age in hours (0 = just now, 24 = oldest we fetched)
        const ageMs = Date.now() - new Date(log.created_at).getTime();
        const ageHrs = Math.max(0, Math.min(24, ageMs / (1000 * 60 * 60)));
        const freshness = 1 - (ageHrs / 24);  // 1 = fresh, 0 = day-old

        // Radial placement: recent ops cluster mid-arm
        const t = 0.25 + Math.random() * 0.55;
        const r = innerR + t * (outerR - innerR);
        const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B + gauss(0.08);
        const perpOffset = gauss(r * 0.04);
        const x = cx + Math.cos(theta) * r + Math.cos(theta + Math.PI/2) * perpOffset;
        const y = cy + (Math.sin(theta) * r + Math.sin(theta + Math.PI/2) * perpOffset) * TILT_Y;

        const blobR = 25 + Math.random() * 25;
        const intensity = 0.04 + freshness * 0.08;
        const blobGrd = octx.createRadialGradient(x, y, 0, x, y, blobR);
        blobGrd.addColorStop(0.0, `rgba(220, 180, 110, ${intensity})`);
        blobGrd.addColorStop(0.6, `rgba(180, 140, 85, ${intensity * 0.4})`);
        blobGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        octx.fillStyle = blobGrd;
        octx.beginPath();
        octx.arc(x, y, blobR, 0, Math.PI * 2);
        octx.fill();
      }
    }

    /* ─── DATA LAYER B: Open tickets → H-II bright nebulae ─────────────
     * Each open ticket is a concentrated bright puff. Color + size vary
     * with priority. Position on the arm corresponding to ticket.location.
     *
     * Meaning: visible bright clouds = places that need attention.
     * More tickets at Suerte → Suerte's arm glows brighter.
     */
    const TICKET_TINTS = {
      urgent: [255, 180, 130],    // hot peach
      high:   [250, 200, 140],    // bright gold
      normal: [230, 180, 110],    // amber
      low:    [200, 160, 90]      // muted amber
    };
    const TICKET_SIZE = { urgent: 70, high: 55, normal: 40, low: 28 };
    const TICKET_INTENSITY = { urgent: 0.18, high: 0.14, normal: 0.10, low: 0.07 };

    for (const ticket of DL.tickets) {
      const arm = locToArm(ticket.location);
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const priority = (ticket.priority || 'normal').toLowerCase();
      const tint = TICKET_TINTS[priority] || TICKET_TINTS.normal;
      const nebR = TICKET_SIZE[priority] || TICKET_SIZE.normal;
      const intensity = TICKET_INTENSITY[priority] || TICKET_INTENSITY.normal;

      // Age → older tickets drift outward (unresolved debt moves to the outskirts)
      const ageMs = Date.now() - new Date(ticket.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const t = Math.min(0.85, 0.35 + ageDays * 0.04 + Math.random() * 0.15);
      const r = innerR + t * (outerR - innerR);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B + gauss(0.06);
      const perpOffset = gauss(r * 0.035);
      const x = cx + Math.cos(theta) * r + Math.cos(theta + Math.PI/2) * perpOffset;
      const y = cy + (Math.sin(theta) * r + Math.sin(theta + Math.PI/2) * perpOffset) * TILT_Y;

      // Outer soft glow
      const outerGlow = octx.createRadialGradient(x, y, 0, x, y, nebR * 1.6);
      outerGlow.addColorStop(0.0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${intensity * 0.55})`);
      outerGlow.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      octx.fillStyle = outerGlow;
      octx.beginPath();
      octx.arc(x, y, nebR * 1.6, 0, Math.PI * 2);
      octx.fill();

      // Brighter inner core
      const innerNeb = octx.createRadialGradient(x, y, 0, x, y, nebR * 0.5);
      innerNeb.addColorStop(0.0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${intensity * 1.3})`);
      innerNeb.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      octx.fillStyle = innerNeb;
      octx.beginPath();
      octx.arc(x, y, nebR * 0.5, 0, Math.PI * 2);
      octx.fill();
    }

    /* ─── DATA LAYER C: Kanban cards → nebular clusters by column ─────
     * Cards in "todo" → mid-arm haze. Cards in "doing" → inner, closer
     * to the black hole (actively being processed).
     */
    const CARD_COLOR = {
      todo:  [200, 170, 110],
      doing: [240, 200, 130],
      other: [180, 155, 100]
    };
    for (const card of DL.cards) {
      const col = (card.column_name || '').toLowerCase();
      const tint = CARD_COLOR[col] || CARD_COLOR.other;
      // Cards don't have a location field reliably, so distribute across arms by hash
      const arm = Math.abs(hash01(String(card.id)) * 1000 | 0) % ARM_COUNT;
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      // "doing" cards closer to center, "todo" mid, others further out
      const tTarget = col === 'doing' ? 0.25 : col === 'todo' ? 0.55 : 0.75;
      const t = Math.max(0.1, Math.min(0.9, tTarget + gauss(0.08)));
      const r = innerR + t * (outerR - innerR);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B + gauss(0.06);
      const perpOffset = gauss(r * 0.03);
      const x = cx + Math.cos(theta) * r + Math.cos(theta + Math.PI/2) * perpOffset;
      const y = cy + (Math.sin(theta) * r + Math.sin(theta + Math.PI/2) * perpOffset) * TILT_Y;

      const blobR = 18 + Math.random() * 18;
      const intensity = 0.08;
      const blobGrd = octx.createRadialGradient(x, y, 0, x, y, blobR);
      blobGrd.addColorStop(0.0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${intensity})`);
      blobGrd.addColorStop(0.6, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${intensity * 0.3})`);
      blobGrd.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      octx.fillStyle = blobGrd;
      octx.beginPath();
      octx.arc(x, y, blobR, 0, Math.PI * 2);
      octx.fill();
    }

    // Switch back to normal compositing for point stars
    octx.globalCompositeOperation = 'source-over';

    /* ─── DATA LAYER D: Pending queue (raw_emails) → inter-arm stars ──
     * Every unprocessed email is a dim amber speck scattered between
     * the arms. High pending count = visually dense noise throughout
     * the galaxy — reads as "system has a lot of backlog."
     *
     * If we have the sample, use it. Otherwise synthesize count-driven
     * stars at random angles.
     */
    const pendingList = DL.pending || [];
    const pendingTotal = typeof state.pendingCount === 'number' ? state.pendingCount : pendingList.length;
    // Render up to 3000 pending stars for visual density, even if we have more in DB
    const pendingToRender = Math.min(3000, pendingTotal);

    for (let i = 0; i < pendingToRender; i++) {
      // Use sample row if available (for age data); otherwise synthesize
      const src = pendingList[i % Math.max(1, pendingList.length)] || null;

      // Uniform angle — between-arm distribution
      const theta = Math.random() * Math.PI * 2;
      // Radial — slight bulge bias, extends outward
      const t = Math.pow(Math.random(), 0.75);
      const r = innerR * 0.5 + t * (outerR * 1.15 - innerR * 0.5);

      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r * TILT_Y;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      const radialNorm = r / outerR;
      const color = radialNorm < 0.25
        ? mix([255, 235, 180], AMBER, radialNorm / 0.25)
        : mix(AMBER, AMBER_DIM, Math.min(1, (radialNorm - 0.25) / 0.85));

      // Activity-based brightness — uses last_activity_at (bumped by any meaningful
      // edit, trigger-maintained in Postgres), falls back to created_at on older data.
      // Window extended to 30 days so dormant-but-once-touched nodes still glow dimly.
      let brightness = 0.25;
      const activityTs = (src && (src.last_activity_at || src.created_at)) || null;
      if (activityTs) {
        const ageMs = Date.now() - new Date(activityTs).getTime();
        const ageHrs = Math.min(720, Math.max(0, ageMs / (1000 * 60 * 60)));  // cap at 30 days
        brightness = 0.45 - (ageHrs / 720) * 0.30;  // fresh = 0.45, month-old = 0.15
      }

      const falloff = Math.exp(-radialNorm * 1.3);
      const alpha = 0.08 + brightness * 0.22 * falloff;
      const size = Math.random() < 0.92 ? 0.5 : 0.8;

      octx.fillStyle = rgba(color, alpha);
      octx.beginPath();
      octx.arc(x, y, size, 0, Math.PI * 2);
      octx.fill();
    }

    /* ─── DATA LAYER E: Contractor events → pulsing signals ───────────
     * Small bright specks at event location's arm. These are "about to
     * happen" items — inherently pulsing in the live layer (not here).
     * Here we just lay down the base markers as brighter-than-pending.
     */
    for (const ev of DL.contractorEvents) {
      const arm = locToArm(ev.location);
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);

      // Events drift outward with time (upcoming = inner, far-future = outer)
      const eventDate = new Date(ev.event_date).getTime();
      const daysUntil = (eventDate - Date.now()) / (1000 * 60 * 60 * 24);
      // Upcoming (near 0) = inner, further = outer
      const tTarget = 0.35 + Math.max(0, Math.min(0.45, daysUntil / 30));
      const t = tTarget + gauss(0.04);
      const r = innerR + Math.max(0.15, Math.min(0.95, t)) * (outerR - innerR);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B + gauss(0.05);
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r * TILT_Y;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      // Pending events are brighter peach; confirmed are amber
      const color = ev.status === 'pending' ? [250, 200, 150] : [230, 180, 110];
      octx.fillStyle = rgba(color, 0.75);
      octx.beginPath();
      octx.arc(x, y, 1.6, 0, Math.PI * 2);
      octx.fill();
      // Soft halo
      const halo = octx.createRadialGradient(x, y, 0, x, y, 10);
      halo.addColorStop(0.0, rgba(color, 0.3));
      halo.addColorStop(1.0, 'rgba(0,0,0,0)');
      octx.fillStyle = halo;
      octx.beginPath();
      octx.arc(x, y, 10, 0, Math.PI * 2);
      octx.fill();
    }

    /* ─── DATA LAYER F: Archived nodes — dim stars along arms ─────────
     * Your archived knowledge. Dim but visible. Positioned along arms
     * to give the spiral structure visible bulk.
     */
    const archived = (NX.allNodes || []).filter(n => n.archived || n.status === 'archived');
    const archCount = Math.min(1500, archived.length);

    for (let i = 0; i < archCount; i++) {
      const node = archived[i];
      const arm = (node.community_id != null ? node.community_id : i) % ARM_COUNT;
      // Archived = older, push outward
      const t = 0.3 + Math.pow(Math.random(), 0.55) * 0.7;
      const r = innerR + t * (outerR - innerR);
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B;
      const thetaJitter = gauss(ARM_WIDTH);
      const finalR = r + gauss(r * 0.06);
      const finalT = theta + thetaJitter;

      const x = cx + Math.cos(finalT) * finalR;
      const y = cy + Math.sin(finalT) * finalR * TILT_Y;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      const radialNorm = finalR / outerR;
      const color = mix(AMBER, AMBER_DIM, radialNorm * 0.6);
      const alpha = 0.22 + Math.random() * 0.22;
      const size = 0.8 + Math.random() * 0.4;

      octx.fillStyle = rgba(color, alpha);
      octx.beginPath();
      octx.arc(x, y, size, 0, Math.PI * 2);
      octx.fill();
    }

    /* ─── LAYER G: Structural stars — dust along arms (non-data) ──────
     * A minimal count of structural stars along the arms to keep the
     * spiral shape readable even when data layers are thin. These don't
     * represent data — they're the "scaffolding" that makes the galaxy
     * look like a galaxy. Scaled down if we have lots of real data.
     */
    const dataTotal = DL.pending.length + DL.tickets.length + DL.cards.length
                    + DL.recentLogs.length + DL.contractorEvents.length + archived.length;
    const structuralCount = Math.max(600, 3500 - dataTotal);

    for (let i = 0; i < structuralCount; i++) {
      const arm = i % ARM_COUNT;
      const t = Math.pow(Math.random(), 0.42);
      const r = innerR + t * (outerR - innerR) * 1.15;
      const baseAngle = arm * (2 * Math.PI / ARM_COUNT);
      const theta = baseAngle + Math.log(Math.max(r / innerR, 1.01)) / SPIRAL_B;
      const thetaJitter = gauss(ARM_WIDTH * 1.2);
      const finalR = r + gauss(r * 0.08);
      const finalT = theta + thetaJitter;

      const x = cx + Math.cos(finalT) * finalR;
      const y = cy + Math.sin(finalT) * finalR * TILT_Y;
      if (x < -5 || x > W+5 || y < -5 || y > H+5) continue;

      const radialNorm = finalR / outerR;
      const color = radialNorm < 0.3
        ? mix([255, 230, 170], AMBER, radialNorm / 0.3)
        : mix(AMBER, AMBER_DIM, Math.min(1, (radialNorm - 0.3) / 0.7));

      const falloff = Math.exp(-radialNorm * 1.5);
      const alpha = 0.15 + Math.random() * 0.3 * falloff;
      const size = Math.random() < 0.85 ? 0.5 : 0.9;

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

    // Decay audio-reactive glows (particles deposited via collision)
    const audioDecay = Math.exp(-dt * 2.5);   // slower decay = afterglow feel

    const hasSearchHits = state.searchHits && state.searchHits.size > 0;
    const hasActivated = state.activatedNodes && state.activatedNodes.size > 0;

    ctx.save();
    ctx.translate(cx + camX, cy + camY);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    const P = state.particles;
    const haloList = [];

    // ─── PASS 1: Draw star cores ────────────────────────────────────────
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      // Live orbital position
      const theta = p.baseTheta + p.omega * state.t;
      p.x = cx + Math.cos(theta) * p.baseR;
      p.y = cy + Math.sin(theta) * p.baseR;

      if (p.x < -20 || p.x > W+20 || p.y < -20 || p.y > H+20) continue;

      // Twinkle — subtle breathing
      const twinkle = 0.92 + Math.sin(state.t * p.twinkleSpeed + p.twinklePhase) * 0.08;
      let alpha = p.brightness * twinkle;
      let color = p.color;
      let size = p.size;
      let isSpecial = false;

      // Audio glow (set by particle collisions — decays over time)
      p.audioGlow *= audioDecay;
      if (p.audioGlow > 0.05) {
        alpha = Math.min(1.0, alpha + p.audioGlow * 0.5);
        color = mix(p.color, AMBER_BRIGHT, Math.min(1, p.audioGlow * 0.7));
        size = p.size * (1 + p.audioGlow * 0.4);
        if (p.audioGlow > 0.3) isSpecial = true;
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
        size = p.size * 1.3;
        isSpecial = true;
      } else if (hasSearchHits) {
        alpha *= 0.3;
      }

      // Active/hover
      if (state.activeNode?.id === p.id || state.hoverNode?.id === p.id) {
        alpha = 1.0;
        color = AMBER_BRIGHT;
        size = p.size * 1.4;
        isSpecial = true;
      }

      const drawSize = Math.min(STAR_SIZE_MAX * 1.6, size);

      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, drawSize, 0, Math.PI * 2);
      ctx.fill();

      if (isSpecial || alpha > 0.7) {
        haloList.push({ x: p.x, y: p.y, size: drawSize, color, alpha });
      }

      p.screenX = (p.x - cx) * zoom + cx + camX;
      p.screenY = (p.y - cy) * zoom + cy + camY;
    }

    // ─── PASS 2: Halos (additive) ───────────────────────────────────────
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
    // Stage R: apply TILT_Y so meteors fly along the tilted disk plane,
    // same plane as the particles. Without this, meteors would appear
    // to float above/below the disk, breaking the illusion of depth.
    const startX = cx + Math.cos(ang) * edge;
    const startY = cy + Math.sin(ang) * edge * TILT_Y;
    // Curve the path — use a mid-control point perpendicular to the direct line
    const midX = (startX + cx) / 2 + (Math.random() - 0.5) * edge * 0.3;
    const midY = (startY + cy) / 2 + (Math.random() - 0.5) * edge * 0.3 * TILT_Y;
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

  /* ─── PARTICLES — emitted from the black hole, travel outward, light stars on contact ─── */
  // This is the ONLY lighting mechanism for nodes during song playback.
  // Particles carry different character per band:
  //   bass — large slow warm, big light-up radius, lifts heavy stars
  //   mid  — medium soft amber, the main flow — dense and gentle
  //   high — small bright white-gold sparkles, fast, short-lived
  function spawnParticle(band) {
    if (state.sparkles.length >= SPARKLE_MAX) return;
    const cx = state.W / 2, cy = state.H / 2;
    const ang = Math.random() * Math.PI * 2;
    let speed, life, size, color;
    if (band === 'bass') {
      speed = 8 + Math.random() * 12;     // slower still
      life  = 8.0 + Math.random() * 2.5;  // much longer — reaches outer arms
      size  = 1.4;
      color = [255, 210, 140];
    } else if (band === 'mid') {
      speed = 14 + Math.random() * 18;    // slower
      life  = 6.5 + Math.random() * 2.0;
      size  = 0.9;
      color = AMBER;
    } else {
      speed = 28 + Math.random() * 30;    // slower
      life  = 4.0 + Math.random() * 1.5;
      size  = 0.7;
      color = AMBER_BRIGHT;
    }
    state.sparkles.push({
      x: cx + Math.cos(ang) * (state.hole.r + 3),
      y: cy + Math.sin(ang) * (state.hole.r + 3),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      bornT: state.t,
      life,
      size,
      color,
      band,
      hitCount: 0  // how many stars this particle has lit (caps hit damage)
    });
  }

  function updateSparkles(dt) {
    // Collision detection: for each particle, check if it's near any active star
    // Spatial query would be faster, but 80 particles * 800 stars = 64k checks per frame
    // which is fine on mobile. If this ever gets slow, we bucket by grid cell.
    const P = state.particles;
    const HIT_R = 14;           // screen-space-ish distance for "contact"
    const HIT_R_SQ = HIT_R * HIT_R;

    for (let i = state.sparkles.length - 1; i >= 0; i--) {
      const s = state.sparkles[i];
      const age = state.t - s.bornT;
      if (age >= s.life) { state.sparkles.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // Gentle drag — closer to 1.0 means less drag (they keep moving)
      const drag = s.band === 'bass' ? 0.92 : s.band === 'mid' ? 0.90 : 0.85;
      s.vx *= Math.pow(drag, dt);
      s.vy *= Math.pow(drag, dt);
      s.t = age / s.life;

      // COLLISION: does this particle touch an active star?
      if (s.hitCount < 2) {
        for (let j = 0; j < P.length; j++) {
          const p = P[j];
          // Only check stars whose orbit radius is near the particle's distance from center
          const dx = p.x - s.x, dy = p.y - s.y;
          const d2 = dx*dx + dy*dy;
          if (d2 < HIT_R_SQ) {
            // Contact — star lights up (delegated to audioGlow field)
            // Different bands deposit different brightness
            const deposit = s.band === 'bass' ? 1.0 : s.band === 'mid' ? 0.7 : 1.2;
            p.audioGlow = Math.min(1.0, p.audioGlow + deposit);
            s.hitCount++;
            // Fade this particle faster after a hit (it "gave its energy")
            s.life = Math.min(s.life, age + 0.3);
            if (s.hitCount >= 2) break;
          }
        }
      }
    }
  }

  function drawSparkles() {
    const cx = state.W / 2, cy = state.H / 2;
    ctx.save();
    ctx.translate(cx + state.cam.x, cy + state.cam.y);
    ctx.scale(state.cam.zoom, state.cam.zoom);
    ctx.translate(-cx, -cy);
    ctx.globalCompositeOperation = 'screen';  // additive glow

    for (const s of state.sparkles) {
      const fade = 1 - s.t;
      // Soft outer glow
      const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 3);
      grd.addColorStop(0.0, rgba(s.color, fade * 0.5));
      grd.addColorStop(1.0, rgba(s.color, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
      ctx.fill();
      // Bright core
      ctx.fillStyle = rgba([255, 245, 220], fade * 0.9);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /* ─── SEARCH CONNECTIONS — graceful lit strings between related hits ─── */
  // Draws curved amber lines between search-hit nodes that have real link relationships.
  // Falls back to spokes-from-NEXUS when a hit has no link-partners among the other hits.
  function drawSearchConnections() {
    if (!state.searchHits || state.searchHits.size < 1) return;

    const cx = state.W / 2, cy = state.H / 2;
    const zoom = state.cam.zoom;
    const camX = state.cam.x, camY = state.cam.y;

    // Build a map of hit id → particle (with live position)
    const hitParticles = new Map();
    state.particles.forEach(p => {
      if (state.searchHits.has(p.id)) hitParticles.set(p.id, p);
    });
    if (hitParticles.size === 0) return;

    ctx.save();
    ctx.translate(cx + camX, cy + camY);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    ctx.globalCompositeOperation = 'screen';

    // Animated dash phase for the "flowing" effect
    const dashPhase = (state.t * 40) % 40;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -dashPhase;

    // Opacity pulse — connections gently breathe at ~2s cycle
    const breath = 0.7 + Math.sin(state.t * 1.8) * 0.3;

    hitParticles.forEach((p, pid) => {
      const node = p.node;
      if (!node) return;
      const partners = (node.links || []).filter(lid => hitParticles.has(lid) && lid > pid);
      // Only draw each edge once: require partner.id > p.id
      if (partners.length === 0) {
        // Fallback: spoke from this hit to the NEXUS black hole
        drawCurvedString(p.x, p.y, cx, cy, 0.5 * breath);
      } else {
        partners.forEach(lid => {
          const other = hitParticles.get(lid);
          if (!other) return;
          drawCurvedString(p.x, p.y, other.x, other.y, 0.75 * breath);
        });
      }
    });

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // Bezier string between two points — curves via a midpoint perpendicular offset
  function drawCurvedString(x1, y1, x2, y2, intensity) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.sqrt(dx*dx + dy*dy);
    // Curve magnitude: 15% of distance, perpendicular
    const curveMag = dist * 0.15;
    // Perpendicular vector
    const px = -dy / dist, py = dx / dist;
    const cx2 = midX + px * curveMag;
    const cy2 = midY + py * curveMag;

    // Outer soft stroke — creates the "glow" around the line
    ctx.lineWidth = 4;
    ctx.strokeStyle = rgba(AMBER, intensity * 0.12);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx2, cy2, x2, y2);
    ctx.stroke();

    // Inner bright stroke — the actual line
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgba(AMBER_BRIGHT, intensity * 0.65);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx2, cy2, x2, y2);
    ctx.stroke();
  }

  /* ─── NEXUS BLACK HOLE ─────────────────────────────────────────────────── */
  // Compact dense object. Tight haze. Song-progress arc that fills as the song
  // plays. Bright NEXUS label.
  function drawBlackHole(dt) {
    const cx = state.W / 2, cy = state.H / 2;
    state.hole.ringAngle += dt * 0.12;

    // ─── Smooth haze amount — eases 0↔1 with play/pause ──────────────
    // When playing: haze target is 1.0 (full presence).
    // When fading out / idle: target is 0 (disappears completely).
    // When ingesting: target is 0.5 (quiet hum).
    let hazeTarget;
    if (state.fadeState === 'in' || state.fadeState === 'playing') hazeTarget = 1.0;
    else if (state.fadeState === 'out') hazeTarget = 0.0;
    else if (state.ingestionActive) hazeTarget = 0.5;
    else hazeTarget = 0.0;

    // Ease toward target — 3-second time constant feels gentle
    const hazeEaseRate = 0.4;  // per second
    state.hole.hazeAmount += (hazeTarget - state.hole.hazeAmount) * Math.min(1, dt * hazeEaseRate * 2);

    // Breathing amplitude scales with haze amount — no breath when haze is gone
    const idlePulse = 0.5 + Math.sin(state.t / 8 * Math.PI * 2) * 0.5;
    const breathAmp = state.hole.hazeAmount * 0.1;
    const baseGlow = 0.12 + state.hole.hazeAmount * 0.5;
    let hazeStrength = baseGlow + breathAmp * idlePulse;

    // Stage R: AMBIENT BREATHING — always on, independent of song state.
    // A slow 10-second cycle that gives the core a subtle living pulse
    // even at rest. 6% amplitude on haze, 2% on disc scale.
    // Without this, the idle galaxy can look frozen. With it, the core
    // feels alive in a way that doesn't demand attention but rewards it.
    const ambientBreath = 0.5 + Math.sin(state.t / 10 * Math.PI * 2) * 0.5;
    hazeStrength += 0.06 * ambientBreath;
    const ambientDiscScale = 1 + 0.02 * ambientBreath;

    // Bass bump during playback
    let discScale = ambientDiscScale;
    if (state.songPlaying) {
      const bassN = Math.min(1, state.bass / state.bassMax);
      hazeStrength += bassN * 0.25 * state.hole.hazeAmount;
      discScale *= 1.0 + bassN * 0.08 * state.hole.hazeAmount;
    }

    const screenX = cx + state.cam.x;
    const screenY = cy + state.cam.y;
    const r = state.hole.r * state.cam.zoom * discScale;

    // ─── Layer 1: TIGHT haze (scales with hazeAmount) ────────────────
    if (state.hole.hazeAmount > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const hazeR = r * 3.2;
      const hazeGrd = ctx.createRadialGradient(screenX, screenY, r * 0.9, screenX, screenY, hazeR);
      hazeGrd.addColorStop(0.0, rgba([240, 200, 130], hazeStrength * 0.6));
      hazeGrd.addColorStop(0.4, rgba(AMBER, hazeStrength * 0.2));
      hazeGrd.addColorStop(1.0, 'rgba(0,0,0,0)');
      ctx.fillStyle = hazeGrd;
      ctx.beginPath();
      ctx.arc(screenX, screenY, hazeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ─── Layer 2: Thin accretion ring (scales with hazeAmount) ───────
    // When idle and haze faded out, only the dark disc + NEXUS label remain.
    if (state.hole.hazeAmount > 0.02) {
      ctx.save();
      const ringR = r * 1.35;
      ctx.lineWidth = Math.max(1.2, r * 0.08);
      ctx.strokeStyle = rgba([255, 230, 170], (0.4 + hazeStrength * 0.3) * state.hole.hazeAmount);
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating-brightness hot-spots along the ring (material orbiting)
      const segments = 48;
      for (let s = 0; s < segments; s++) {
        const a0 = state.hole.ringAngle + s * (Math.PI * 2 / segments);
        const a1 = a0 + (Math.PI * 2 / segments);
        const brightnessMod = Math.max(0, Math.sin(a0 * 2.3 + state.t * 0.4));
        if (brightnessMod < 0.2) continue;
        ctx.lineWidth = Math.max(1, r * 0.1);
        ctx.strokeStyle = rgba(AMBER_BRIGHT, brightnessMod * 0.35 * (0.5 + hazeStrength) * state.hole.hazeAmount);
        ctx.beginPath();
        ctx.arc(screenX, screenY, ringR, a0, a1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ─── Layer 3: SONG PROGRESS ARC — smoothly tracks audio ─────────
    // When playing, progressTarget follows audio.currentTime. The displayed
    // progress eases toward that target so pressing play glides in instead
    // of snapping.
    if (state.songPlaying && state.audio && state.audio.duration) {
      state.hole.progressTarget = state.audio.currentTime / state.audio.duration;
    } else if (!state.songPlaying && state.fadeState === 'idle') {
      // When truly stopped, target decays to 0 (arc empties out)
      state.hole.progressTarget *= Math.exp(-dt * 0.6);
    }
    // Ease displayed progress toward target — 1.5s time constant
    const progEase = Math.min(1, dt * 0.8);
    state.hole.progress += (state.hole.progressTarget - state.hole.progress) * progEase;

    if (state.hole.progress > 0.003 && state.hole.hazeAmount > 0.05) {
      const progR = r * 1.35;
      const startA = -Math.PI / 2;
      const endA = startA + state.hole.progress * Math.PI * 2;
      const progFade = state.hole.hazeAmount;  // fades with haze
      ctx.save();
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.strokeStyle = rgba(AMBER_BRIGHT, 0.22 * progFade);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(screenX, screenY, progR, startA, endA);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.2, r * 0.09);
      ctx.strokeStyle = rgba([255, 240, 200], 0.85 * progFade);
      ctx.beginPath();
      ctx.arc(screenX, screenY, progR, startA, endA);
      ctx.stroke();
      const tipX = screenX + Math.cos(endA) * progR;
      const tipY = screenY + Math.sin(endA) * progR;
      const tipGrd = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, r * 0.25);
      tipGrd.addColorStop(0.0, rgba([255, 245, 210], 0.95 * progFade));
      tipGrd.addColorStop(1.0, rgba(AMBER_BRIGHT, 0));
      ctx.fillStyle = tipGrd;
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ─── Layer 4: Event horizon (dark disc) — always present ────────
    ctx.fillStyle = '#020208';
    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner edge glint — faint when idle, brighter with haze
    ctx.strokeStyle = rgba([255, 220, 150], 0.15 + state.hole.hazeAmount * 0.25);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(screenX, screenY, r * 0.98, 0, Math.PI * 2);
    ctx.stroke();

    // ─── Layer 5: NEXUS label — always bright ───────────────────────
    ctx.save();
    ctx.fillStyle = rgba([255, 230, 170], 0.92);
    ctx.font = `500 ${Math.max(9, r * 0.28)}px -apple-system, "SF Pro Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = '2px'; } catch(_) {}
    ctx.fillText('NEXUS', screenX, screenY);
    ctx.restore();

    // Save for hit testing
    state.hole.screenX = screenX;
    state.hole.screenY = screenY;
    state.hole.screenR = r;
  }


  /* ─── AUDIO PIPELINE ───────────────────────────────────────────────────── */
  // Gradual fade-in over ~2 seconds on first tap.
  // Tap while playing → fade out over ~1.5s, stop particle emission, existing particles finish their flight.
  // Double-tap → restart from zero.

  const FADE_IN_SEC  = 3.5;
  const FADE_OUT_SEC = 5.0;
  const TARGET_VOLUME = 0.9;

  async function initAudioCtx() {
    if (state.audio) return;
    state.audio = new Audio();
    state.audio.src = 'audio/nexus-theme.mp3';
    state.audio.crossOrigin = 'anonymous';
    state.audio.preload = 'auto';
    state.audio.volume = 0;
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

    state.audio.addEventListener('ended', () => {
      state.songPlaying = false;
      state.fadeState = 'idle';
      state.audio.volume = 0;
    });
  }

  async function playSong(fromStart) {
    try {
      await initAudioCtx();
      if (!state.audioCtx) return;
      if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

      if (fromStart) state.audio.currentTime = 0;

      state.audio.volume = 0;
      await state.audio.play();

      state.songPlaying = true;
      state.fadeState = 'in';
      state.fadeStartT = state.t;
    } catch (e) {
      console.warn('[Galaxy] Song play failed:', e);
    }
  }

  function pauseSong() {
    // Begin fade-out. Audio element keeps playing until fade completes, then pauses.
    if (!state.songPlaying) return;
    state.fadeState = 'out';
    state.fadeStartT = state.t;
  }

  function updateAudioFade() {
    if (!state.audio) return;
    if (state.fadeState === 'in') {
      const elapsed = state.t - state.fadeStartT;
      const prog = Math.min(1, elapsed / FADE_IN_SEC);
      // Ease-in: volume rises from 0 to TARGET_VOLUME
      const eased = (1 - Math.cos(prog * Math.PI)) * 0.5;  // 0 → 1
      state.audio.volume = TARGET_VOLUME * eased;
      if (prog >= 1) state.fadeState = 'playing';
    } else if (state.fadeState === 'out') {
      const elapsed = state.t - state.fadeStartT;
      const prog = Math.min(1, elapsed / FADE_OUT_SEC);
      // Ease-out: volume falls from TARGET_VOLUME to 0
      const eased = (1 - Math.cos(prog * Math.PI)) * 0.5;  // 0 → 1 as progress advances
      state.audio.volume = TARGET_VOLUME * (1 - eased);    // 1 → 0 as progress advances
      if (prog >= 1) {
        state.audio.pause();
        state.audio.volume = 0;
        state.songPlaying = false;
        state.fadeState = 'idle';
      }
    }
  }

  function sampleAudio() {
    // Only read analyser if audio is actually playing (volume > 0 equivalent)
    if (!state.songPlaying || !state.analyser) {
      state.bass = state.mid = state.high = 0;
      return;
    }
    state.analyser.getByteFrequencyData(state.audioData);
    let b = 0, m = 0, h = 0;
    for (let i = 1;  i <= 4;   i++) b += state.audioData[i];
    for (let i = 5;  i <= 40;  i++) m += state.audioData[i];
    for (let i = 40; i < 128;  i++) h += state.audioData[i];
    state.bass = b / 4 / 255;
    state.mid  = m / 36 / 255;
    state.high = h / 88 / 255;

    // Gate particle spawning by fade state — during fade-out, don't spawn new particles,
    // but existing ones finish their flight. This is what makes pause feel meaningful.
    const emitting = (state.fadeState === 'in' || state.fadeState === 'playing');
    if (!emitting) return;

    // Fade-in ramps emission proportionally
    const emitScale = state.fadeState === 'in'
      ? Math.min(1, (state.t - state.fadeStartT) / FADE_IN_SEC)
      : 1.0;

    // Update running maxes
    state.bassMax = Math.max(state.bassMax * 0.996, state.bass, 0.05);
    state.midMax  = Math.max(state.midMax  * 0.996, state.mid,  0.05);
    state.highMax = Math.max(state.highMax * 0.996, state.high, 0.05);

    // Normalize
    const bassN = Math.min(1, state.bass / state.bassMax);
    const midN  = Math.min(1, state.mid  / state.midMax);
    const highN = Math.min(1, state.high / state.highMax);

    // Spawn particles per band — different character each
    const chance = (state.t - state.lastSpawnT) * 60;  // per-frame chance scaler
    state.lastSpawnT = state.t;

    // BASS — heavy slow particles (if bass present in song)
    if (bassN > 0.55 && Math.random() < bassN * 0.8 * emitScale) {
      spawnParticle('bass');
    }
    // MID — medium soft particles (main flow for mids-dominant songs)
    if (midN > 0.25 && Math.random() < midN * 1.2 * emitScale) {
      spawnParticle('mid');
      if (midN > 0.6) spawnParticle('mid');  // bursts on strong mids
    }
    // HIGH — sparkles on transients
    if (highN > 0.5 && state.t - state.lastHighPeak > 0.05) {
      const count = Math.floor(1 + highN * 3 * emitScale);
      for (let i = 0; i < count; i++) spawnParticle('high');
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
    updateAudioFade();
    sampleAudio();

    // Simulate
    updateMeteors(dt);
    updateSparkles(dt);

    // Clear
    ctx.fillStyle = '#04040c';
    ctx.fillRect(0, 0, state.W, state.H);

    // Layer compositing
    drawDistantField(dt);
    drawSearchConnections();   // strings underneath stars so they don't obscure
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

      // Debounce — Android WebView can fire pointerup twice (touch + synthetic mouse).
      // Ignore any tap within 180ms of the last handled one.
      const n = now();
      if (state._lastTapT && n - state._lastTapT < 0.18) return;
      state._lastTapT = n;

      // Tap — hole or node or empty
      if (isHoleTap(p.x, p.y)) {
        // Intentional double-tap (within 180-500ms) = restart song
        if (state._lastHoleTap && n - state._lastHoleTap < 0.5) {
          state._lastHoleTap = 0;
          playSong(true);
          return;
        }
        state._lastHoleTap = n;
        // Single-tap → toggle
        if (state.songPlaying && state.fadeState !== 'out') {
          pauseSong();
        } else {
          playSong(false);
        }
        return;
      }
      const node = findNodeAt(p.x, p.y);
      if (node) {
        state.activeNode = node.node;
        state.frozenNode = node;
        openPanel(node.node);
        // No zoom — just open the panel, keep the view steady
      } else {
        // Tap on empty space — close panel if open
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

  /* ─── PANEL (node detail view — full restoration from brain-canvas) ──── */
  function findOwnerName(ownerId) {
    if (!ownerId) return 'Shared';
    if (NX.currentUser && NX.currentUser.id === ownerId) return NX.currentUser.name;
    return 'User #' + ownerId;
  }

  function openPanel(n) {
    if (!n) return;
    const hud = document.getElementById('chatHud');
    if (hud) hud.classList.remove('expanded');
    state.activeNode = n;

    // Header fields
    const catEl = document.getElementById('npCat');
    const nameEl = document.getElementById('npName');
    const tagsEl = document.getElementById('npTags');
    const notesEl = document.getElementById('npNotes');
    if (catEl) catEl.textContent = (n.category || '').toUpperCase();
    if (nameEl) nameEl.textContent = n.name || '';
    if (tagsEl) tagsEl.textContent = '';
    const ownerLabel = n.owner_id ? ` · ${findOwnerName(n.owner_id)}'s Brain` : '';

    // Tags (clickable — search by tag)
    if (tagsEl) {
      (n.tags || []).forEach(t => {
        const tag = document.createElement('span');
        tag.className = 'np-tag-link';
        tag.textContent = '#' + t;
        tag.addEventListener('click', () => {
          if (NX.searchByTag) NX.searchByTag(t);
          closePanel();
        });
        tagsEl.appendChild(tag);
      });
      if (ownerLabel) {
        const ow = document.createElement('span');
        ow.className = 'np-owner-label';
        ow.textContent = ownerLabel;
        tagsEl.appendChild(ow);
      }
    }

    if (notesEl) notesEl.textContent = n.notes || 'No notes.';

    // ═══ BACKLINKS ═══
    const blEl = document.getElementById('npBacklinks');
    if (blEl) {
      blEl.innerHTML = '';
      const nameLow = (n.name || '').toLowerCase();
      const backlinks = (NX.nodes || []).filter(other =>
        other.id !== n.id && !other.is_private && (
          (other.notes || '').toLowerCase().includes(nameLow) ||
          (other.tags || []).some(t => t.toLowerCase().includes(nameLow)) ||
          (other.links || []).includes(n.id)
        ));
      if (backlinks.length) {
        blEl.innerHTML = '<div class="np-section-title">MENTIONED IN (' + backlinks.length + ')</div>';
        backlinks.slice(0, 10).forEach(bl => {
          const d = document.createElement('div');
          d.className = 'np-link-item';
          d.innerHTML = `<span class="np-link-cat">${bl.category}</span>${bl.name}`;
          d.onclick = () => {
            const fp = state.particles.find(p => p.id === bl.id);
            if (fp) { state.frozenNode = fp; state.activeNode = bl; openPanel(bl); }
            else { openPanel(bl); }  // open even if not in active stars
          };
          blEl.appendChild(d);
        });
      }
    }

    // ═══ TRANSCLUSION — preview linked node content ═══
    const trEl = document.getElementById('npTransclusions');
    if (trEl) {
      trEl.innerHTML = '';
      const linkedNodes = (n.links || [])
        .map(lid => (NX.nodes || []).find(x => x.id === lid))
        .filter(Boolean).slice(0, 5);
      if (linkedNodes.length) {
        trEl.innerHTML = '<div class="np-section-title">RELATED DETAILS</div>';
        linkedNodes.forEach(ln => {
          if (!ln.notes || ln.notes.length < 10) return;
          const card = document.createElement('div');
          card.className = 'np-transclude';
          card.innerHTML = `<div class="np-transclude-head"><span class="np-link-cat">${ln.category}</span><span class="np-transclude-name">${ln.name}</span></div><div class="np-transclude-body">${(ln.notes || '').slice(0, 200)}${ln.notes.length > 200 ? '…' : ''}</div>`;
          card.addEventListener('click', () => {
            const fp = state.particles.find(p => p.id === ln.id);
            if (fp) { state.frozenNode = fp; state.activeNode = ln; openPanel(ln); }
            else openPanel(ln);
          });
          trEl.appendChild(card);
        });
      }
    }

    // ═══ SOURCES ═══
    const se = document.getElementById('npSources');
    if (se) {
      se.innerHTML = '';
      const src = n.sources || n.source_emails;
      if (src && Array.isArray(src) && src.length) {
        const tt = (k) => (NX.i18n ? NX.i18n.t(k) : k);
        se.innerHTML = '<div class="np-section-title">' + tt('sources') + ' (' + src.length + ')</div>';
        src.forEach(s => {
          const card = document.createElement('div');
          card.className = 'np-email-card';
          card.innerHTML = `<div class="np-email-header"><div class="np-email-from">${s.from || 'Unknown'}</div><div class="np-email-date">${s.date || ''}</div></div><div class="np-email-subject">${s.subject || '(no subject)'}</div>`;
          if (s.snippet || s.body) {
            const preview = document.createElement('div');
            preview.className = 'np-email-preview';
            preview.textContent = (s.snippet || s.body || '').slice(0, 150);
            card.appendChild(preview);
          }
          if (s.body && s.body.length > 10 && NX.isAdmin) {
            const toggle = document.createElement('button');
            toggle.className = 'np-email-toggle';
            toggle.textContent = tt('showEmail');
            const detail = document.createElement('div');
            detail.className = 'np-email-detail';
            detail.style.display = 'none';
            detail.innerHTML = `<div class="np-email-detail-header"><div class="np-detail-row"><span class="np-detail-label">From</span><span class="np-detail-value">${s.from || ''}</span></div>${s.to ? `<div class="np-detail-row"><span class="np-detail-label">To</span><span class="np-detail-value">${s.to}</span></div>` : ''}<div class="np-detail-row"><span class="np-detail-label">Date</span><span class="np-detail-value">${s.date || ''}</span></div><div class="np-detail-row"><span class="np-detail-label">Subject</span><span class="np-detail-value">${s.subject || ''}</span></div></div><div class="np-email-full-body">${(s.body || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
            toggle.addEventListener('click', () => {
              const open = detail.style.display !== 'none';
              detail.style.display = open ? 'none' : 'block';
              toggle.textContent = open ? tt('showEmail') : tt('hideEmail');
              toggle.classList.toggle('open', !open);
            });
            card.appendChild(toggle);
            card.appendChild(detail);
          }
          se.appendChild(card);
        });
      }
    }

    // ═══ ATTACHMENTS ═══
    const ae = document.getElementById('npAttachments');
    if (ae) {
      ae.innerHTML = '';
      const att = n.attachments;
      if (att && Array.isArray(att) && att.length) {
        const seen = new Set();
        const uniqueAtt = att.filter(a => {
          const key = (a.filename || '') + (a.url || '');
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        ae.innerHTML = '<div class="np-section-title">' + (NX.i18n ? NX.i18n.t('attachments') : 'ATTACHMENTS') + ' (' + uniqueAtt.length + ')</div>';
        uniqueAtt.forEach(a => {
          const fname = a.filename || 'file';
          const ext = (fname.split('.').pop() || '').toLowerCase();
          const isImg = ['jpg','jpeg','png','gif','webp'].includes(ext);
          const isPdf = ext === 'pdf';
          const icon = isPdf ? '📄' : isImg ? '🖼' : ext === 'xlsx' || ext === 'csv' ? '📊' : ext === 'docx' ? '📝' : '📎';

          const card = document.createElement('div');
          card.className = 'np-att-card';
          card.innerHTML = `<div class="np-att-info"><span class="np-att-icon">${icon}</span><div class="np-att-details"><div class="np-att-name">${fname.length > 35 ? fname.slice(0,32) + '...' : fname}</div><div class="np-att-meta">${a.from ? a.from.split('<')[0].trim() : ''} ${a.date ? '· ' + a.date.split('T')[0] : ''}</div></div></div>`;

          if (a.url) {
            const viewBtn = document.createElement('button');
            viewBtn.className = 'np-att-view';
            viewBtn.textContent = 'View';
            viewBtn.addEventListener('click', async () => {
              viewBtn.textContent = '...';
              try {
                const path = a.url.split('/nexus-files/').pop();
                if (path) {
                  const { data: signedData, error } = await NX.sb.storage.from('nexus-files').createSignedUrl(path, 3600);
                  if (!error && signedData?.signedUrl) { window.open(signedData.signedUrl, '_blank'); viewBtn.textContent = 'View'; return; }
                }
                window.open(a.url, '_blank');
              } catch (e) { window.open(a.url, '_blank'); }
              viewBtn.textContent = 'View';
            });
            card.appendChild(viewBtn);
          }

          if (isImg && a.url) {
            const preview = document.createElement('div');
            preview.className = 'np-att-img-wrap';
            const img = document.createElement('img');
            img.className = 'np-att-preview';
            img.alt = fname;
            img.loading = 'lazy';
            (async () => {
              try {
                const path = a.url.split('/nexus-files/').pop();
                if (path) {
                  const { data } = await NX.sb.storage.from('nexus-files').createSignedUrl(path, 3600);
                  if (data?.signedUrl) img.src = data.signedUrl; else img.src = a.url;
                } else img.src = a.url;
              } catch (e) { img.src = a.url; }
            })();
            img.onerror = () => { preview.remove(); };
            img.addEventListener('click', () => window.open(img.src, '_blank'));
            preview.appendChild(img);
            card.appendChild(preview);
          }
          ae.appendChild(card);
        });
      }
    }

    // ═══ LINKS ═══
    const le = document.getElementById('npLinks');
    if (le) {
      le.innerHTML = '';
      if (n.links && n.links.length) {
        le.innerHTML = '<div class="np-section-title">' + (NX.i18n ? NX.i18n.t('connectedTo') : 'CONNECTED TO') + ' (' + n.links.length + ')</div>';
        n.links.forEach(lid => {
          const ln = (NX.nodes || []).find(x => x.id === lid);
          if (!ln) return;
          const d = document.createElement('div');
          d.className = 'np-link-item';
          d.innerHTML = `<span class="np-link-cat">${ln.category}</span>${ln.name}`;
          d.onclick = () => {
            const fp = state.particles.find(p => p.id === lid);
            if (fp) { state.frozenNode = fp; state.activeNode = ln; openPanel(ln); }
            else openPanel(ln);
          };
          le.appendChild(d);
        });
      }
    }

    // Admin-only controls
    const editBtnEl = document.getElementById('npEditNotes');
    const addSection = document.querySelector('.np-add-section');
    const npFooter = document.querySelector('.np-footer');
    if (editBtnEl) editBtnEl.style.display = NX.isAdmin ? '' : 'none';
    if (addSection) addSection.style.display = NX.isAdmin ? '' : 'none';
    if (npFooter) npFooter.style.display = NX.isAdmin ? '' : 'none';

    // Delete
    const delBtn = document.getElementById('npDelete');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!confirm('Delete "' + n.name + '"?')) return;
        try {
          const { error } = await NX.sb.from('nodes').delete().eq('id', n.id);
          if (!error) {
            NX.nodes = (NX.nodes || []).filter(x => x.id !== n.id);
            state.particles = state.particles.filter(p => p.id !== n.id);
            closePanel();
          }
        } catch (e) {}
      };
    }

    // Edit notes
    const editBtn = document.getElementById('npEditNotes');
    if (editBtn && notesEl) {
      editBtn.onclick = () => {
        const current = n.notes || '';
        const ta = document.createElement('textarea');
        ta.className = 'np-edit-textarea';
        ta.value = current;
        ta.rows = 6;
        const saveBtn = document.createElement('button');
        saveBtn.className = 'np-edit-btn';
        saveBtn.textContent = 'Save';
        saveBtn.style.marginTop = '6px';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'np-edit-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.marginTop = '6px';
        cancelBtn.style.marginLeft = '6px';
        notesEl.innerHTML = '';
        const history = n.notes_history || [];
        if (history.length) {
          const histBtn = document.createElement('button');
          histBtn.className = 'np-edit-btn np-hist-btn';
          histBtn.textContent = `↺ ${history.length} versions`;
          histBtn.style.marginTop = '6px';
          histBtn.style.marginLeft = '6px';
          histBtn.onclick = () => {
            const histDiv = document.createElement('div');
            histDiv.className = 'np-history';
            history.slice().reverse().forEach(h => {
              const item = document.createElement('div');
              item.className = 'np-hist-item';
              item.innerHTML = `<div class="np-hist-date">${h.date || 'unknown'}</div><div class="np-hist-text">${(h.text || '').slice(0,100)}</div>`;
              item.onclick = () => { ta.value = h.text; histDiv.remove(); };
              histDiv.appendChild(item);
            });
            notesEl.appendChild(histDiv);
          };
          notesEl.appendChild(ta); notesEl.appendChild(saveBtn); notesEl.appendChild(cancelBtn); notesEl.appendChild(histBtn);
        } else {
          notesEl.appendChild(ta); notesEl.appendChild(saveBtn); notesEl.appendChild(cancelBtn);
        }
        ta.focus();
        saveBtn.onclick = async () => {
          const newNotes = ta.value;
          const hist = n.notes_history || [];
          if (current && current.length > 5) hist.push({ text: current, date: new Date().toISOString().split('T')[0] });
          const trimmedHist = hist.slice(-10);
          await NX.sb.from('nodes').update({ notes: newNotes, notes_history: trimmedHist }).eq('id', n.id);
          n.notes = newNotes;
          n.notes_history = trimmedHist;
          notesEl.textContent = newNotes || 'No notes.';
        };
        cancelBtn.onclick = () => { notesEl.textContent = current || 'No notes.'; };
      };
    }

    // File upload
    const fileInput = document.getElementById('npFileInput');
    const uploadStatus = document.getElementById('npUploadStatus');
    if (fileInput) {
      fileInput.onchange = async () => {
        const files = fileInput.files;
        if (!files.length) return;
        if (uploadStatus) uploadStatus.textContent = 'Uploading...';
        const atts = n.attachments || [];
        for (const file of files) {
          try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `node-files/${n.id}_${Date.now()}_${safeName}`;
            const { error: upErr } = await NX.sb.storage.from('nexus-files').upload(path, file, { contentType: file.type, upsert: true });
            if (upErr) { if (uploadStatus) uploadStatus.textContent = 'Failed: ' + upErr.message; continue; }
            const { data: urlData } = NX.sb.storage.from('nexus-files').getPublicUrl(path);
            const url = urlData?.publicUrl || '';
            atts.push({ url, filename: file.name, type: file.type, date: new Date().toISOString().split('T')[0], from: 'Manual upload' });
            if (uploadStatus) uploadStatus.textContent = `✓ ${file.name}`;
          } catch (e) { if (uploadStatus) uploadStatus.textContent = 'Error: ' + e.message; }
        }
        await NX.sb.from('nodes').update({ attachments: atts }).eq('id', n.id);
        n.attachments = atts;
        openPanel(n);
        fileInput.value = '';
        setTimeout(() => { if (uploadStatus) uploadStatus.textContent = ''; }, 3000);
      };
    }

    // Show the panel
    const np = document.getElementById('nodePanel');
    if (np) np.classList.add('open');
    document.body.classList.add('panel-open');
    if (window.lucide) lucide.createIcons();

    // Fire event for anything else listening
    document.dispatchEvent(new CustomEvent('galaxy:node-open', { detail: { node: n } }));
  }

  function closePanel() {
    state.activeNode = null;
    state.frozenNode = null;
    const np = document.getElementById('nodePanel');
    if (np) np.classList.remove('open');
    document.body.classList.remove('panel-open');
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

  /* ─── DATA LAYER REFRESH — pull real data from Supabase ──────────────── *
   * Every light in the sky represents something real:
   *   raw_emails (unprocessed)  → inter-arm pending stars
   *   tickets (open)            → H-II bright puffs clustered by location
   *   contractor_events         → pulsing signals along arms
   *   daily_logs (last 24h)     → activity haze clouds
   *   kanban_cards (not done)   → nebular clusters by column
   *
   * Called once at init, then every 30s. If it fails silently, the galaxy
   * falls back to rendering just the ambient lighting + node stars.
   * ──────────────────────────────────────────────────────────────────── */
  async function refreshDataLayers() {
    if (!NX.sb) return;
    if (state.dataLayers.fetching) return;
    state.dataLayers.fetching = true;
    const t0 = performance.now();

    try {
      // Pending queue — count + sample (we don't need every row, just enough to paint)
      const pendingQuery = NX.sb.from('raw_emails')
        .select('id, created_at, processed', { count: 'exact' })
        .eq('processed', false)
        .order('created_at', { ascending: false })
        .limit(2000);

      // Open tickets — full rows, we need location + priority + age
      const ticketsQuery = NX.sb.from('tickets')
        .select('id, title, location, status, priority, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(200);

      // Contractor events — pending/confirmed, future or recent
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const eventsQuery = NX.sb.from('contractor_events')
        .select('id, contractor_name, location, event_date, status, description')
        .in('status', ['pending', 'confirmed'])
        .gte('event_date', since)
        .limit(100);

      // Recent daily logs — last 24h, high volume, drives activity haze density
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const logsQuery = NX.sb.from('daily_logs')
        .select('id, entry, created_at')
        .gte('created_at', yesterday)
        .order('created_at', { ascending: false })
        .limit(500);

      // Kanban cards — not archived, any column
      const cardsQuery = NX.sb.from('kanban_cards')
        .select('id, title, column_name, priority, created_at')
        .neq('column_name', 'done')
        .limit(100);

      const [pending, tickets, events, logs, cards] = await Promise.all([
        pendingQuery.catch(e => ({ data: [], count: 0, error: e })),
        ticketsQuery.catch(e => ({ data: [], error: e })),
        eventsQuery.catch(e => ({ data: [], error: e })),
        logsQuery.catch(e => ({ data: [], error: e })),
        cardsQuery.catch(e => ({ data: [], error: e }))
      ]);

      state.dataLayers.pending = Array.isArray(pending.data) ? pending.data : [];
      state.dataLayers.tickets = Array.isArray(tickets.data) ? tickets.data : [];
      state.dataLayers.contractorEvents = Array.isArray(events.data) ? events.data : [];
      state.dataLayers.recentLogs = Array.isArray(logs.data) ? logs.data : [];
      state.dataLayers.cards = Array.isArray(cards.data) ? cards.data : [];

      // Also capture the FULL pending count if it came back (the sampled query is capped at 2000)
      if (typeof pending.count === 'number') {
        state.pendingCount = pending.count;
        NX.pendingCount = pending.count;
      }
      state.dataLayers.openTickets = state.dataLayers.tickets.length;

      // Index open tickets by location for aggregate glow
      const byLoc = {};
      for (const t of state.dataLayers.tickets) {
        const loc = (t.location || 'Unknown').trim();
        byLoc[loc] = (byLoc[loc] || 0) + (t.priority === 'urgent' ? 3 : t.priority === 'high' ? 2 : 1);
      }
      state.dataLayers.openTicketsByLocation = byLoc;

      state.dataLayers.lastFetched = Date.now();
      const dtMs = Math.round(performance.now() - t0);
      console.log('[galaxy] data refreshed:',
        state.dataLayers.pending.length, 'pending /',
        state.dataLayers.tickets.length, 'tickets /',
        state.dataLayers.contractorEvents.length, 'events /',
        state.dataLayers.recentLogs.length, 'logs /',
        state.dataLayers.cards.length, 'cards -',
        dtMs + 'ms');

      // Rebuild the baked canvas with fresh data
      buildDistantField();
    } catch (e) {
      console.warn('[galaxy] data refresh failed:', e);
    } finally {
      state.dataLayers.fetching = false;
    }
  }

  /* ─── INIT ─────────────────────────────────────────────────────────────── */
  async function init() {
    resize();
    if (state.W < 10 || state.H < 10) {
      setTimeout(init, 200);
      return;
    }
    // Wait for nodes to load if they haven't yet
    let attempts = 0;
    while ((!NX.nodes || NX.nodes.length === 0) && attempts < 25) {
      console.log('[galaxy] waiting for nodes... attempt', attempts, 'current count:', NX.nodes?.length || 0);
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    console.log('[galaxy] init with', NX.nodes?.length || 0, 'nodes, canvas', state.W+'x'+state.H);
    buildParticles();
    console.log('[galaxy] built', state.particles.length, 'particles');
    setupCanvasEvents();
    updateSystemState();
    // Pull real data from DB for the distant field layers
    refreshDataLayers();
    // Update system state periodically
    setInterval(updateSystemState, 5000);
    // Refresh data layers every 30s so the galaxy reflects new tickets/events/logs
    setInterval(refreshDataLayers, 30000);
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
