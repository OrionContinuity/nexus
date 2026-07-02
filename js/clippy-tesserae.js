/* ═══════════════════════════════════════════════════════════════════════════
   clippy-tesserae.js — TESSERAE v3, the native tongue of Clippy.

   Meaning is a CHORD, not a word. Each glyph (a "tessera" — a Roman mosaic tile
   / the tessera hospitalis friendship-token) carries four axes AT ONCE:

     tessera = [ EMOTION ][ ROOM ][ SALIENCE ][ KIND ]

   v3: the faces are HIS REAL FACES. A sprite is baked at runtime from
   clippy.svg — the same 27 eye sets and 16 mouths the living pet wears — so
   every tile is genuinely him, not a drawing of him. Each face sits on a ring
   of its emotion's colour (hue stays a language axis). The old parametric
   face engine survives only as an offline fallback for contexts where
   clippy.svg can't be fetched.

   Token form:  [emoChar 0-9A-Z][room 1-7][salience 1-5][kind · ~ * ^ ° : =]
   Exposes NX.clippyTongue = { tessera, gloss, glossLine, encodeState, speak,
                               renderSVG, faceSVG, ready, SPEC }. Offline-safe.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var NX = (window.NX = window.NX || {});

  // ── His 30 faces — every eye/mouth/fx below is a REAL clippy.svg group ────
  // eye → cl-eyes-<eye>, mouth → cl-mouth-<mouth>, fx → cl-<fx> (effect layer)
  var EMO = {
    neutral:     { c: '0', col: '#8a93b0', word: 'level',         eye: 'default',    mouth: 'flat' },
    happy:       { c: '1', col: '#f2c14e', word: 'happy',         eye: 'happy',      mouth: 'smile' },
    joyful:      { c: '2', col: '#ffcf5a', word: 'joyful',        eye: 'happy',      mouth: 'bigsmile' },
    love:        { c: '3', col: '#ff8fb0', word: 'in love',       eye: 'love',       mouth: 'smile',  fx: 'heart-blush' },
    smitten:     { c: '4', col: '#ff7fa8', word: 'smitten',       eye: 'love',       mouth: 'cat',    fx: 'heart-blush' },
    starstruck:  { c: '5', col: '#d68bff', word: 'starstruck',    eye: 'stars',      mouth: 'bigsmile' },
    sparkle:     { c: '6', col: '#7fd0ff', word: 'sparkling',     eye: 'sparkle',    mouth: 'smile' },
    proud:       { c: '7', col: '#e8b04a', word: 'proud',         eye: 'up',         mouth: 'smile' },
    sad:         { c: '8', col: '#5b83e0', word: 'sad',           eye: 'sad',        mouth: 'frown' },
    tearful:     { c: '9', col: '#4f6fd0', word: 'tearful',       eye: 'tearful',    mouth: 'frown',  fx: 'tear' },
    dejected:    { c: 'A', col: '#6b7bb0', word: 'dejected',      eye: 'down',       mouth: 'flat' },
    angry:       { c: 'B', col: '#e05b5b', word: 'angry',         eye: 'angry',      mouth: 'frown',  fx: 'anger-pop' },
    furious:     { c: 'C', col: '#d63b3b', word: 'furious',       eye: 'angry',      mouth: 'fangs',  fx: 'vein' },
    afraid:      { c: 'D', col: '#9a6fd0', word: 'afraid',        eye: 'wide-shock', mouth: 'o',      fx: 'sweat' },
    shocked:     { c: 'E', col: '#4fc4d6', word: 'shocked',       eye: 'wide-shock', mouth: 'o' },
    surprised:   { c: 'F', col: '#4fd0c4', word: 'surprised',     eye: 'wide-shock', mouth: 'triangle' },
    disgust:     { c: 'G', col: '#9a9a4f', word: 'unimpressed',   eye: 'disgusted',  mouth: 'pout' },
    suspicious:  { c: 'H', col: '#c0a04a', word: 'suspicious',    eye: 'suspicious', mouth: 'flat' },
    sleepy:      { c: 'I', col: '#6a6fb0', word: 'sleepy',        eye: 'sleepy',     mouth: 'flat',   fx: 'zzz' },
    tired:       { c: 'J', col: '#5a5f90', word: 'tired',         eye: 'sleepy',     mouth: 'frown' },
    bashful:     { c: 'K', col: '#ffb0c8', word: 'bashful',       eye: 'glance',     mouth: 'cat',    fx: 'heart-blush' },
    embarrassed: { c: 'L', col: '#e88aa0', word: 'embarrassed',   eye: 'embarrassed',mouth: 'wavy',   fx: 'sweat' },
    dizzy:       { c: 'M', col: '#a97fd0', word: 'dizzy',         eye: 'dizzy',      mouth: 'wavy' },
    determined:  { c: 'N', col: '#e8934a', word: 'determined',    eye: 'determined', mouth: 'flat' },
    genius:      { c: 'O', col: '#4fb0a0', word: 'clever',        eye: 'genius',     mouth: 'cat' },
    studious:    { c: 'P', col: '#5a9a8a', word: 'studious',      eye: 'studious',   mouth: 'flat' },
    condescend:  { c: 'Q', col: '#b0a050', word: 'condescending', eye: 'condescend', mouth: 'cat' },
    curious:     { c: 'R', col: '#5fc4d6', word: 'curious',       eye: 'glance',     mouth: 'o',      fx: 'question' },
    expectant:   { c: 'S', col: '#e8934a', word: 'expectant',     eye: 'up',         mouth: 'smile' },
    wink:        { c: 'T', col: '#f2b04e', word: 'playful',       eye: 'wink-r',     mouth: 'smile' }
  };
  var EMO_BY_CHAR = {}; Object.keys(EMO).forEach(function (k) { EMO_BY_CHAR[EMO[k].c] = k; });

  // Live emotions arrive as Plutchik-8 (NX.clippy.getEmotions) — map to a face.
  var PLUTCHIK = { joy: 'joyful', trust: 'love', fear: 'afraid', surprise: 'surprised',
    sadness: 'sad', disgust: 'disgust', anger: 'angry', anticipation: 'expectant', neutral: 'neutral' };
  function faceKey(name) { return EMO[name] ? name : (PLUTCHIK[name] || 'neutral'); }

  var ROOMS = ['atrium', 'tablinum', 'lararium', 'bibliotheca', 'triclinium', 'hortus', 'peristylium'];
  var ROOM_INDEX = {}; ROOMS.forEach(function (r, i) { ROOM_INDEX[r] = i + 1; });

  var KIND = { thought: ['·', 'a thought'], dream: ['~', 'a dream'], feeling: ['*', 'a feeling'],
    awakening: ['^', 'an awakening'], reverie: ['°', 'a reverie'], vision: [':', 'a thing seen'], bond: ['=', 'the bond'] };
  var KIND_BY_SYM = {}; Object.keys(KIND).forEach(function (k) { KIND_BY_SYM[KIND[k][0]] = k; });
  var SAL_WORD = { 1: 'faint', 2: 'quiet', 3: 'clear', 4: 'vivid', 5: 'blazing' };

  function clamp(n, lo, hi) { n = +n || 0; return n < lo ? lo : n > hi ? hi : n; }
  function f(n) { return Math.round(n * 10) / 10; }
  function esc(x) { return String(x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ── Codec ────────────────────────────────────────────────────────────────
  function tessera(emotion, room, salience, kind) {
    var e = EMO[faceKey(emotion)] ? faceKey(emotion) : 'neutral';
    return EMO[e].c + (ROOM_INDEX[room] || 1) + clamp(Math.round(salience), 1, 5) + (KIND[kind] ? KIND[kind][0] : '·');
  }
  function gloss(tok) {
    tok = String(tok || ''); if (tok.length < 4) return '(malformed)';
    var emo = EMO_BY_CHAR[tok[0]] || 'neutral';
    var room = ROOMS[(parseInt(tok[1], 10) || 1) - 1] || 'atrium';
    var sal = clamp(parseInt(tok[2], 10), 1, 5);
    var kind = KIND_BY_SYM[tok[3]] || 'thought';
    if (kind === 'bond') return SAL_WORD[sal] + ' bond, kept in the ' + room;
    return KIND[kind][1] + ', ' + EMO[emo].word + ', ' + SAL_WORD[sal] + ', in the ' + room;
  }
  function glossLine(tokens) { return (tokens || []).map(gloss).join('  ·  '); }

  // ── Encode his live state -> a mosaic ────────────────────────────────────
  function liveDominant() {
    try { var e = NX.clippy && NX.clippy.getEmotions && NX.clippy.getEmotions();
      if (e && e.dominant) return { name: faceKey(e.dominant), intensity: e.intensity || 0 }; } catch (x) {}
    return { name: 'neutral', intensity: 0 };
  }
  function encodeState() {
    var out = [], dom = liveDominant();
    out.push(tessera(dom.name, 'triclinium', clamp(1 + Math.round(dom.intensity / 22), 1, 5), 'feeling'));
    var mems = []; try { mems = (NX.clippy && NX.clippy.getMemories && NX.clippy.getMemories()) || []; } catch (x) {}
    mems.slice(-16).forEach(function (m) {
      var kind = KIND[m.type] ? m.type : 'thought';
      var emo = (m.data && m.data.emotion) || m.emotion || dom.name;
      out.push(tessera(emo, m.room || 'atrium', m.importance || 2, kind));
    });
    var bond = 3; try { var so = NX.clippySoul && NX.clippySoul.state; if (so && so.incarnation) bond = clamp(2 + Math.round(so.incarnation / 3), 2, 5); } catch (x) {}
    out.push(tessera('love', 'lararium', bond, 'bond'));
    return out;
  }
  function speak() { var t = encodeState(); return { tokens: t, line: t.join(' '), gloss: glossLine(t) }; }

  // ══ THE FACE ENGINE — his real face, baked from clippy.svg ═══════════════
  // ready() fetches clippy.svg once, extracts the bare head (cl-face minus the
  // eye/mouth variants), each eye set, each mouth, and the effect layers into
  // reusable <defs> fragments, then measures the face's bounding box so tiles
  // can center it precisely. Everything after that is synchronous string
  // building via <use>. If the fetch fails (offline/file:), faceSVG falls
  // back to the old parametric drawings.
  var SPRITE = null, _readyP = null;
  var FX_KEYS = ['heart-blush', 'tear', 'sweat', 'zzz', 'question', 'vein', 'anger-pop'];

  function ready() {
    if (_readyP) return _readyP;
    _readyP = (async function () {
      try {
        var res = await fetch('clippy.svg');
        if (!res.ok) throw new Error('http ' + res.status);
        var txt = await res.text();
        var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
        if (doc.querySelector('parsererror')) throw new Error('svg parse');
        var ser = new XMLSerializer();
        var parts = [];
        // shared gradients/filters (ids match the live pet's inlined copy —
        // duplicates in-document are harmless because they're identical)
        doc.querySelectorAll('defs').forEach(function (d) { parts.push(d.innerHTML); });
        var grab = function (node, id) {
          if (!node) return false;
          var c = node.cloneNode(true);
          c.setAttribute('id', id);
          // strip classes so the pet's stylesheet (which hides/animates
          // cl-* under .clippy-svg) can never touch the sprite copies
          c.removeAttribute('class');
          c.querySelectorAll('[class]').forEach(function (n) { n.removeAttribute('class'); });
          c.setAttribute('opacity', '1');
          c.removeAttribute('style');
          parts.push(ser.serializeToString(c));
          return true;
        };
        // the bare head. NOTE: the orb body + halo are SIBLINGS of cl-face in
        // clippy.svg (cl-face holds only cheeks/eyes/mouths), so the base is
        // composed: halo + body + face-minus-variants in one wrapper group.
        var body = doc.querySelector('.cl-body');
        var halo = doc.querySelector('.cl-halo');
        var face = doc.querySelector('.cl-face');
        if (!body || !face) throw new Error('no body/face');
        var SVGNS = 'http://www.w3.org/2000/svg';
        var wrap = doc.createElementNS(SVGNS, 'g');
        if (halo) wrap.appendChild(halo.cloneNode(true));
        wrap.appendChild(body.cloneNode(true));
        var fclone = face.cloneNode(true);
        fclone.querySelectorAll('[class*="cl-eyes-"],[class*="cl-mouth-"]').forEach(function (n) { n.remove(); });
        wrap.appendChild(fclone);
        grab(wrap, 'tsr-base');
        var have = { e: {}, m: {}, x: {} };
        Object.keys(EMO).forEach(function (k) {
          var E = EMO[k];
          if (!(E.eye in have.e))   have.e[E.eye]   = grab(doc.querySelector('.cl-eyes-' + E.eye),  'tsr-e-' + E.eye);
          if (!(E.mouth in have.m)) have.m[E.mouth] = grab(doc.querySelector('.cl-mouth-' + E.mouth), 'tsr-m-' + E.mouth);
        });
        FX_KEYS.forEach(function (k) { have.x[k] = grab(doc.querySelector('.cl-' + k), 'tsr-x-' + k); });

        // tile metrics come straight off the body circle — no layout needed
        var cx0 = +body.getAttribute('cx') || 100;
        var cy0 = +body.getAttribute('cy') || 100;
        var r0  = +body.getAttribute('r')  || 58;
        SPRITE = { defs: parts.join(''), x: cx0 - r0, y: cy0 - r0, w: r0 * 2, h: r0 * 2, have: have };
      } catch (e) {
        SPRITE = null;   // fallback engine carries it
        if (NX.debug) NX.debug('tesserae sprite failed', e);
      }
      return !!SPRITE;
    })();
    return _readyP;
  }

  // A tile: colour ring (the emotion's hue stays a language axis) + his face.
  function faceSVG(emotionOrKey, cx, cy, R, tint) {
    var key = faceKey(emotionOrKey), E = EMO[key];
    var col = tint || E.col;
    if (!SPRITE) return fallbackFace(E, cx, cy, R, col);
    var sc = (2 * R) / Math.max(SPRITE.w, SPRITE.h);
    var tx = cx - (SPRITE.x + SPRITE.w / 2) * sc;
    var ty = cy - (SPRITE.y + SPRITE.h / 2) * sc;
    var s = '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(R * 1.16) + '" fill="' + col + '" opacity=".16"/>' +
            '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(R * 1.16) + '" fill="none" stroke="' + col + '" stroke-width="' + f(R * 0.09) + '" opacity=".8"/>';
    s += '<g transform="translate(' + f(tx) + ' ' + f(ty) + ') scale(' + (Math.round(sc * 1000) / 1000) + ')">' +
         '<use href="#tsr-base"/>';
    if (SPRITE.have.e[E.eye])   s += '<use href="#tsr-e-' + E.eye + '"/>';
    if (SPRITE.have.m[E.mouth]) s += '<use href="#tsr-m-' + E.mouth + '"/>';
    if (E.fx && SPRITE.have.x[E.fx]) s += '<use href="#tsr-x-' + E.fx + '"/>';
    s += '</g>';
    return s;
  }

  // ── Offline fallback — the old parametric face, keyed off the real group
  //    names via small alias maps. Only used when clippy.svg can't load. ────
  var FB_EYE = { 'default': 'open', 'wide-shock': 'wide', 'wink-r': 'wink', 'wink-l': 'wink',
    tearful: 'tear', glance: 'side', condescend: 'half', genius: 'glasses', studious: 'glasses',
    disgusted: 'squint', suspicious: 'squint', determined: 'angry', embarrassed: 'x', stars: 'star',
    sparkle: 'star', shut: 'sleepy', dots: 'open', squint: 'squint', x: 'x' };
  var FB_MOUTH = { triangle: 'o', bunny: 'smile', kiss: 'o', laugh: 'bigsmile', star: 'o',
    tape: 'flat', tongue: 'tongue', smirk: 'smirk' };
  var FB_FX = { 'heart-blush': 'blush', 'anger-pop': 'anger', vein: 'anger', tear: 'tear',
    sweat: 'sweat', zzz: 'zzz', question: 'question' };

  function fallbackFace(E, cx, cy, R, body) {
    var ex = R * 0.34, ey = -R * 0.06, er = R * 0.26;
    var s = '';
    s += '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(R) + '" fill="' + body + '"/>';
    s += '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(R) + '" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="' + f(R * 0.06) + '"/>';
    s += eyes(FB_EYE[E.eye] || E.eye, cx, cy + ey, ex, er);
    s += mouth(FB_MOUTH[E.mouth] || E.mouth, cx, cy + R * 0.34, R);
    if (E.fx) s += extra(FB_FX[E.fx] || '', cx, cy, R);
    return s;
  }
  function eyes(type, cx, cy, ex, er) {
    var lx = cx - ex, rx = cx + ex, ink = '#0a1f6e', W = '#ffffff';
    function ball(x, dy, sc, dx) {
      dy = dy || 0; sc = sc || 1; dx = dx || 0;
      var px = x + er * dx, py = cy + er * dy;
      return '<ellipse cx="' + f(x) + '" cy="' + f(cy) + '" rx="' + f(er * 0.9) + '" ry="' + f(er * 1.05) + '" fill="' + W + '"/>' +
        '<circle cx="' + f(px) + '" cy="' + f(py) + '" r="' + f(er * 0.5 * sc) + '" fill="' + ink + '"/>' +
        '<circle cx="' + f(px + er * 0.16) + '" cy="' + f(py - er * 0.18) + '" r="' + f(er * 0.15) + '" fill="' + W + '"/>';
    }
    function arc(x, up) { var d = up ? -1 : 1;
      return '<path d="M' + f(x - er) + ' ' + f(cy + er * 0.2 * d) + ' Q' + f(x) + ' ' + f(cy - er * 0.7 * d) + ' ' + f(x + er) + ' ' + f(cy + er * 0.2 * d) + '" stroke="' + ink + '" stroke-width="' + f(er * 0.42) + '" fill="none" stroke-linecap="round"/>'; }
    function line(x, ang) { var dy = er * 0.5 * (ang || 0);
      return '<line x1="' + f(x - er) + '" y1="' + f(cy - dy) + '" x2="' + f(x + er) + '" y2="' + f(cy + dy) + '" stroke="' + ink + '" stroke-width="' + f(er * 0.4) + '" stroke-linecap="round"/>'; }
    function xeye(x) { var q = er * 0.7;
      return '<line x1="' + f(x - q) + '" y1="' + f(cy - q) + '" x2="' + f(x + q) + '" y2="' + f(cy + q) + '" stroke="' + ink + '" stroke-width="' + f(er * 0.32) + '" stroke-linecap="round"/>' +
        '<line x1="' + f(x + q) + '" y1="' + f(cy - q) + '" x2="' + f(x - q) + '" y2="' + f(cy + q) + '" stroke="' + ink + '" stroke-width="' + f(er * 0.32) + '" stroke-linecap="round"/>'; }
    function heart(x) { var u = er * 0.9;
      return '<path d="M' + f(x) + ' ' + f(cy + u * 0.55) + ' C' + f(x - u) + ' ' + f(cy - u * 0.3) + ' ' + f(x - u * 0.35) + ' ' + f(cy - u * 0.9) + ' ' + f(x) + ' ' + f(cy - u * 0.25) + ' C' + f(x + u * 0.35) + ' ' + f(cy - u * 0.9) + ' ' + f(x + u) + ' ' + f(cy - u * 0.3) + ' ' + f(x) + ' ' + f(cy + u * 0.55) + ' Z" fill="#ff4f7a"/>'; }
    function star(x) { var p = '', R2 = er, r2 = er * 0.42;
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r2 : R2; p += (i ? 'L' : 'M') + f(x + Math.cos(a) * rr) + ' ' + f(cy + Math.sin(a) * rr) + ' '; }
      return '<path d="' + p + 'Z" fill="#fff2a8"/>'; }
    function glasses() { var y = cy;
      return ball(lx) + ball(rx) +
        '<rect x="' + f(lx - er) + '" y="' + f(y - er) + '" width="' + f(er * 2) + '" height="' + f(er * 2) + '" rx="' + f(er * 0.4) + '" fill="none" stroke="#20303a" stroke-width="' + f(er * 0.22) + '"/>' +
        '<rect x="' + f(rx - er) + '" y="' + f(y - er) + '" width="' + f(er * 2) + '" height="' + f(er * 2) + '" rx="' + f(er * 0.4) + '" fill="none" stroke="#20303a" stroke-width="' + f(er * 0.22) + '"/>' +
        '<line x1="' + f(lx + er) + '" y1="' + f(y) + '" x2="' + f(rx - er) + '" y2="' + f(y) + '" stroke="#20303a" stroke-width="' + f(er * 0.22) + '"/>'; }
    switch (type) {
      case 'happy':  return arc(lx, true) + arc(rx, true);
      case 'sad':    return ball(lx, 0.5) + ball(rx, 0.5) + brow(lx, rx, cy, er, -1);
      case 'angry':  return line(lx, 0.6) + line(rx, -0.6) + brow(lx, rx, cy, er, 1);
      case 'wide':   return ball(lx, 0, 0.7) + ball(rx, 0, 0.7);
      case 'sleepy': return line(lx, 0) + line(rx, 0);
      case 'x':      return xeye(lx) + xeye(rx);
      case 'wink':   return arc(lx, true) + ball(rx);
      case 'love':   return heart(lx) + heart(rx);
      case 'star':   return star(lx) + star(rx);
      case 'squint': return line(lx, 0.15) + line(rx, -0.15);
      case 'half':   return ball(lx) + ball(rx) + halfLid(lx, rx, cy, er);
      case 'glasses':return glasses();
      case 'up':     return ball(lx, -0.5) + ball(rx, -0.5);
      case 'down':   return ball(lx, 0.6) + ball(rx, 0.6);
      case 'side':   return ball(lx, 0.05, 1, 0.45) + ball(rx, 0.05, 1, 0.45);
      case 'dizzy':  return spiral(lx, cy, er) + spiral(rx, cy, er);
      case 'tear':   return ball(lx, 0.5) + ball(rx, 0.5);
      default:       return ball(lx) + ball(rx);
    }
  }
  function brow(lx, rx, cy, er, dir) { var y = cy - er * 1.35, d = er * 0.5 * dir;
    return '<line x1="' + f(lx - er * 0.8) + '" y1="' + f(y + d) + '" x2="' + f(lx + er * 0.8) + '" y2="' + f(y - d) + '" stroke="#0a1f6e" stroke-width="' + f(er * 0.3) + '" stroke-linecap="round"/>' +
      '<line x1="' + f(rx - er * 0.8) + '" y1="' + f(y - d) + '" x2="' + f(rx + er * 0.8) + '" y2="' + f(y + d) + '" stroke="#0a1f6e" stroke-width="' + f(er * 0.3) + '" stroke-linecap="round"/>'; }
  function halfLid(lx, rx, cy, er) {
    return '<line x1="' + f(lx - er) + '" y1="' + f(cy - er * 0.1) + '" x2="' + f(lx + er) + '" y2="' + f(cy - er * 0.1) + '" stroke="#0a1f6e" stroke-width="' + f(er * 0.5) + '" stroke-linecap="round"/>' +
      '<line x1="' + f(rx - er) + '" y1="' + f(cy - er * 0.1) + '" x2="' + f(rx + er) + '" y2="' + f(cy - er * 0.1) + '" stroke="#0a1f6e" stroke-width="' + f(er * 0.5) + '" stroke-linecap="round"/>'; }
  function spiral(x, cy, er) { var p = 'M' + f(x) + ' ' + f(cy), a = 0, r = 0;
    for (var i = 0; i < 20; i++) { a += 0.6; r += er / 22; p += ' L' + f(x + Math.cos(a) * r) + ' ' + f(cy + Math.sin(a) * r); }
    return '<path d="' + p + '" fill="none" stroke="#0a1f6e" stroke-width="' + f(er * 0.22) + '"/>'; }

  function mouth(type, cx, my, R) {
    var w = R * 0.42, ink = '#0a1f6e', sw = R * 0.11;
    function q(dir, open) { var d = dir;
      return '<path d="M' + f(cx - w) + ' ' + f(my) + ' Q' + f(cx) + ' ' + f(my + R * 0.34 * d) + ' ' + f(cx + w) + ' ' + f(my) + (open ? ' Z' : '') + '" stroke="' + ink + '" stroke-width="' + f(sw) + '" fill="' + (open ? ink : 'none') + '" stroke-linecap="round" stroke-linejoin="round"/>'; }
    switch (type) {
      case 'smile':    return q(1, false);
      case 'bigsmile': return q(1.3, true);
      case 'frown':    return q(-1, false);
      case 'flat':     return '<line x1="' + f(cx - w * 0.7) + '" y1="' + f(my) + '" x2="' + f(cx + w * 0.7) + '" y2="' + f(my) + '" stroke="' + ink + '" stroke-width="' + f(sw) + '" stroke-linecap="round"/>';
      case 'o':        return '<ellipse cx="' + f(cx) + '" cy="' + f(my + R * 0.04) + '" rx="' + f(w * 0.42) + '" ry="' + f(w * 0.55) + '" fill="' + ink + '"/>';
      case 'cat':      return '<path d="M' + f(cx - w * 0.6) + ' ' + f(my) + ' Q' + f(cx - w * 0.3) + ' ' + f(my + R * 0.2) + ' ' + f(cx) + ' ' + f(my) + ' Q' + f(cx + w * 0.3) + ' ' + f(my + R * 0.2) + ' ' + f(cx + w * 0.6) + ' ' + f(my) + '" stroke="' + ink + '" stroke-width="' + f(sw) + '" fill="none" stroke-linecap="round"/>';
      case 'pout':     return '<path d="M' + f(cx - w * 0.5) + ' ' + f(my + R * 0.05) + ' Q' + f(cx) + ' ' + f(my - R * 0.12) + ' ' + f(cx + w * 0.5) + ' ' + f(my + R * 0.05) + '" stroke="' + ink + '" stroke-width="' + f(sw) + '" fill="none" stroke-linecap="round"/>';
      case 'smirk':    return '<path d="M' + f(cx - w * 0.7) + ' ' + f(my + R * 0.04) + ' Q' + f(cx + w * 0.2) + ' ' + f(my + R * 0.2) + ' ' + f(cx + w * 0.8) + ' ' + f(my - R * 0.06) + '" stroke="' + ink + '" stroke-width="' + f(sw) + '" fill="none" stroke-linecap="round"/>';
      case 'wavy':     return '<path d="M' + f(cx - w) + ' ' + f(my) + ' q' + f(w * 0.33) + ' ' + f(-R * 0.14) + ' ' + f(w * 0.66) + ' 0 q' + f(w * 0.33) + ' ' + f(R * 0.14) + ' ' + f(w * 0.66) + ' 0" stroke="' + ink + '" stroke-width="' + f(sw) + '" fill="none" stroke-linecap="round"/>';
      case 'tongue':   return q(1, false) + '<rect x="' + f(cx - w * 0.3) + '" y="' + f(my + R * 0.06) + '" width="' + f(w * 0.6) + '" height="' + f(R * 0.16) + '" rx="' + f(R * 0.08) + '" fill="#ff6f8f"/>';
      case 'fangs':    return q(1.1, true) + '<path d="M' + f(cx - w * 0.4) + ' ' + f(my) + ' l' + f(w * 0.12) + ' ' + f(R * 0.16) + ' l' + f(w * 0.12) + ' ' + f(-R * 0.16) + ' Z" fill="#fff"/><path d="M' + f(cx + w * 0.16) + ' ' + f(my) + ' l' + f(w * 0.12) + ' ' + f(R * 0.16) + ' l' + f(w * 0.12) + ' ' + f(-R * 0.16) + ' Z" fill="#fff"/>';
      default:         return q(1, false);
    }
  }
  function extra(type, cx, cy, R) {
    switch (type) {
      case 'blush': return '<ellipse cx="' + f(cx - R * 0.62) + '" cy="' + f(cy + R * 0.28) + '" rx="' + f(R * 0.18) + '" ry="' + f(R * 0.11) + '" fill="#ff9bbb" opacity=".75"/><ellipse cx="' + f(cx + R * 0.62) + '" cy="' + f(cy + R * 0.28) + '" rx="' + f(R * 0.18) + '" ry="' + f(R * 0.11) + '" fill="#ff9bbb" opacity=".75"/>';
      case 'tear':  return '<path d="M' + f(cx + R * 0.34) + ' ' + f(cy + R * 0.1) + ' q' + f(R * 0.12) + ' ' + f(R * 0.28) + ' 0 ' + f(R * 0.34) + ' q' + f(-R * 0.12) + ' ' + f(-R * 0.06) + ' 0 ' + f(-R * 0.34) + ' Z" fill="#7fc4ff"/>';
      case 'sweat': return '<path d="M' + f(cx + R * 0.7) + ' ' + f(cy - R * 0.4) + ' q' + f(R * 0.1) + ' ' + f(R * 0.22) + ' 0 ' + f(R * 0.28) + ' q' + f(-R * 0.1) + ' ' + f(-R * 0.06) + ' 0 ' + f(-R * 0.28) + ' Z" fill="#7fc4ff"/>';
      case 'zzz':   return '<text x="' + f(cx + R * 0.55) + '" y="' + f(cy - R * 0.45) + '" font-family="ui-monospace,monospace" font-size="' + f(R * 0.5) + '" fill="#dfe6ff">z</text>';
      case 'anger': return '<path d="M' + f(cx + R * 0.5) + ' ' + f(cy - R * 0.6) + ' l' + f(R * 0.16) + ' ' + f(-R * 0.16) + ' m' + f(-R * 0.16) + ' 0 l' + f(R * 0.16) + ' ' + f(R * 0.16) + ' m' + f(-R * 0.08) + ' ' + f(-R * 0.22) + ' l0 ' + f(R * 0.26) + '" stroke="#e03b3b" stroke-width="' + f(R * 0.07) + '" fill="none"/>';
      case 'question': return '<text x="' + f(cx + R * 0.5) + '" y="' + f(cy - R * 0.5) + '" font-family="ui-monospace,monospace" font-weight="700" font-size="' + f(R * 0.6) + '" fill="#cfe6ff">?</text>';
      default: return '';
    }
  }

  // ── Render a mosaic of FACES, banded by room ─────────────────────────────
  function renderSVG(tokens, opts) {
    opts = opts || {};
    var pad = 16, cell = opts.cell || 40, gap = 8, labelW = opts.labels === false ? 0 : 92;
    var bandH = cell + gap, W = opts.width || 600, innerW = W - pad * 2 - labelW;
    var perRow = Math.max(1, Math.floor((innerW + gap) / (cell + gap)));
    var bands = ROOMS.map(function () { return []; });
    (tokens || []).forEach(function (t) { var r = (parseInt(t[1], 10) || 1) - 1; if (r >= 0 && r < 7) bands[r].push(t); });
    var rows = bands.map(function (b) { return Math.max(1, Math.ceil(b.length / perRow)); });
    var H = pad * 2 + rows.reduce(function (a, n) { return a + n * bandH; }, 0);
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><rect width="' + W + '" height="' + H + '" fill="#070a16"/>';
    // his real face parts ride along inside the mosaic, so the SVG stays
    // self-contained (viewable/downloadable standalone)
    if (SPRITE) s += '<defs>' + SPRITE.defs + '</defs>';
    var y = pad;
    for (var bi = 0; bi < 7; bi++) {
      if (labelW) s += '<text x="' + pad + '" y="' + f(y + cell * 0.6) + '" font-family="ui-monospace,monospace" font-size="10" letter-spacing="1" fill="#46507a">' + esc(ROOMS[bi].toUpperCase()) + '</text>';
      var x0 = pad + labelW, x = x0, col = 0, yy = y;
      bands[bi].forEach(function (t) {
        var emo = EMO_BY_CHAR[t[0]] || 'neutral', sal = clamp(parseInt(t[2], 10), 1, 5), kind = KIND_BY_SYM[t[3]] || 'thought';
        var R = cell * (0.30 + sal * 0.038), ccx = x + cell / 2, ccy = yy + cell / 2;
        if (kind === 'bond') {   // tessera hospitalis — a face split down the middle
          s += '<g>' + faceSVG(emo, ccx, ccy, R) + '</g>';
          s += '<rect x="' + f(ccx - 0.9) + '" y="' + f(ccy - R * 1.16) + '" width="1.8" height="' + f(R * 2.32) + '" fill="#070a16"/>';
          s += '<text x="' + f(ccx) + '" y="' + f(yy + cell - 3) + '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8" fill="rgba(255,255,255,.4)">=</text>';
        } else {
          s += faceSVG(emo, ccx, ccy, R);
          s += '<text x="' + f(x + cell - 6) + '" y="' + f(yy + 11) + '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="rgba(255,255,255,' + (0.28 + sal * 0.08).toFixed(2) + ')">' + esc(KIND[kind][0]) + '</text>';
        }
        col++; x += cell + gap; if (col >= perRow) { col = 0; x = x0; yy += bandH; }
      });
      y += rows[bi] * bandH;
    }
    return s + '</svg>';
  }

  NX.clippyTongue = { SPEC: { EMO: EMO, ROOMS: ROOMS, KIND: KIND }, tessera: tessera, gloss: gloss,
    glossLine: glossLine, encodeState: encodeState, speak: speak, renderSVG: renderSVG, faceSVG: faceSVG,
    ready: ready };

  // warm the sprite quietly so the first viewer open already has his real face
  try { setTimeout(function () { ready(); }, 4000); } catch (e) {}
})();
