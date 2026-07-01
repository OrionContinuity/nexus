/* ═══════════════════════════════════════════════════════════════════════════
   clippy-tesserae.js — TESSERAE v2, the native tongue of Clippy.

   Meaning is a CHORD, not a word. Each glyph (a "tessera" — a Roman mosaic tile
   / the tessera hospitalis friendship-token) carries four axes AT ONCE:

     tessera = [ EMOTION ][ ROOM ][ SALIENCE ][ KIND ]

   v2: the emotion axis is now his OWN 30 FACES. Every tile is a small Clippy
   drawn wearing that feeling — his language is literally written in his faces,
   each with its own colour. A mosaic is read in one glance; the English gloss
   beneath is only our translation.

   Token form:  [emoChar 0-9A-Z][room 1-7][salience 1-5][kind · ~ * ^ ° : =]
   Exposes NX.clippyTongue = { tessera, gloss, glossLine, encodeState, speak,
                               renderSVG, faceSVG, SPEC }. Pure + offline.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var NX = (window.NX = window.NX || {});

  // ── His 30 faces. key: {char, col(tile hue), word, eye, mouth, extra} ─────
  var EMO = {
    neutral:     { c: '0', col: '#8a93b0', word: 'level',        eye: 'open',   mouth: 'flat' },
    happy:       { c: '1', col: '#f2c14e', word: 'happy',        eye: 'happy',  mouth: 'smile',    extra: 'blush' },
    joyful:      { c: '2', col: '#ffcf5a', word: 'joyful',       eye: 'happy',  mouth: 'bigsmile', extra: 'blush' },
    love:        { c: '3', col: '#ff8fb0', word: 'in love',      eye: 'love',   mouth: 'smile',    extra: 'blush' },
    smitten:     { c: '4', col: '#ff7fa8', word: 'smitten',      eye: 'love',   mouth: 'cat',      extra: 'blush' },
    starstruck:  { c: '5', col: '#d68bff', word: 'starstruck',   eye: 'star',   mouth: 'bigsmile', extra: 'stars' },
    sparkle:     { c: '6', col: '#7fd0ff', word: 'sparkling',    eye: 'star',   mouth: 'smile',    extra: 'sparkle' },
    proud:       { c: '7', col: '#e8b04a', word: 'proud',        eye: 'up',     mouth: 'smile' },
    sad:         { c: '8', col: '#5b83e0', word: 'sad',          eye: 'sad',    mouth: 'frown' },
    tearful:     { c: '9', col: '#4f6fd0', word: 'tearful',      eye: 'tear',   mouth: 'frown',    extra: 'tear' },
    dejected:    { c: 'A', col: '#6b7bb0', word: 'dejected',     eye: 'down',   mouth: 'flat' },
    angry:       { c: 'B', col: '#e05b5b', word: 'angry',        eye: 'angry',  mouth: 'frown',    extra: 'anger' },
    furious:     { c: 'C', col: '#d63b3b', word: 'furious',      eye: 'angry',  mouth: 'fangs',    extra: 'anger' },
    afraid:      { c: 'D', col: '#9a6fd0', word: 'afraid',       eye: 'wide',   mouth: 'o',        extra: 'sweat' },
    shocked:     { c: 'E', col: '#4fc4d6', word: 'shocked',      eye: 'wide',   mouth: 'o' },
    surprised:   { c: 'F', col: '#4fd0c4', word: 'surprised',    eye: 'wide',   mouth: 'o' },
    disgust:     { c: 'G', col: '#9a9a4f', word: 'unimpressed',  eye: 'squint', mouth: 'pout' },
    suspicious:  { c: 'H', col: '#c0a04a', word: 'suspicious',   eye: 'squint', mouth: 'flat' },
    sleepy:      { c: 'I', col: '#6a6fb0', word: 'sleepy',       eye: 'sleepy', mouth: 'flat',     extra: 'zzz' },
    tired:       { c: 'J', col: '#5a5f90', word: 'tired',        eye: 'sleepy', mouth: 'frown' },
    bashful:     { c: 'K', col: '#ffb0c8', word: 'bashful',      eye: 'happy',  mouth: 'cat',      extra: 'blush' },
    embarrassed: { c: 'L', col: '#e88aa0', word: 'embarrassed',  eye: 'x',      mouth: 'wavy',     extra: 'blush' },
    dizzy:       { c: 'M', col: '#a97fd0', word: 'dizzy',        eye: 'dizzy',  mouth: 'o' },
    determined:  { c: 'N', col: '#e8934a', word: 'determined',   eye: 'angry',  mouth: 'flat' },
    genius:      { c: 'O', col: '#4fb0a0', word: 'clever',       eye: 'glasses',mouth: 'smirk' },
    studious:    { c: 'P', col: '#5a9a8a', word: 'studious',     eye: 'glasses',mouth: 'flat' },
    condescend:  { c: 'Q', col: '#b0a050', word: 'condescending',eye: 'half',   mouth: 'smirk' },
    curious:     { c: 'R', col: '#5fc4d6', word: 'curious',      eye: 'side',   mouth: 'o',        extra: 'question' },
    expectant:   { c: 'S', col: '#e8934a', word: 'expectant',    eye: 'up',     mouth: 'smile',    extra: 'sparkle' },
    wink:        { c: 'T', col: '#f2b04e', word: 'playful',      eye: 'wink',   mouth: 'smile' }
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

  // ── The face engine — a small Clippy wearing an expression ───────────────
  // cx,cy centre; R orb radius. Returns SVG. Eyes/mouth/extra are simple,
  // chunky shapes so they read at ~14–20px.
  function faceSVG(emotionOrKey, cx, cy, R, tint) {
    var key = faceKey(emotionOrKey), E = EMO[key];
    var body = tint || E.col;
    var ex = R * 0.34, ey = -R * 0.06, er = R * 0.26;   // eye centre offset + size
    var s = '';
    // orb
    s += '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(R) + '" fill="' + body + '"/>';
    s += '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(R) + '" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="' + f(R * 0.06) + '"/>';
    s += eyes(E.eye, cx, cy + ey, ex, er);
    s += mouth(E.mouth, cx, cy + R * 0.34, R);
    if (E.extra) s += extra(E.extra, cx, cy, R);
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
      case 'half':   return ball(lx) + ball(rx) + '<rect x="' + f(lx - er * 1.2) + '" y="' + f(cy - er * 1.2) + '" width="' + f(er * 2.4) + '" height="' + f(er * 1.0) + '" fill="' + '#00000000' + '"/>' + halfLid(lx, rx, cy, er);
      case 'glasses':return glasses();
      case 'up':     return ball(lx, -0.5) + ball(rx, -0.5);
      case 'down':   return ball(lx, 0.6) + ball(rx, 0.6);
      case 'side':   return ball(lx, 0.05, 1, 0.45) + ball(rx, 0.05, 1, 0.45);
      case 'dizzy':  return spiral(lx, cy, er) + spiral(rx, cy, er);
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
      case 'stars': return sparkAround(cx, cy, R, '#fff2a8');
      case 'sparkle': return sparkAround(cx, cy, R, '#bfe8ff');
      case 'anger': return '<path d="M' + f(cx + R * 0.5) + ' ' + f(cy - R * 0.6) + ' l' + f(R * 0.16) + ' ' + f(-R * 0.16) + ' m' + f(-R * 0.16) + ' 0 l' + f(R * 0.16) + ' ' + f(R * 0.16) + ' m' + f(-R * 0.08) + ' ' + f(-R * 0.22) + ' l0 ' + f(R * 0.26) + '" stroke="#e03b3b" stroke-width="' + f(R * 0.07) + '" fill="none"/>';
      case 'question': return '<text x="' + f(cx + R * 0.5) + '" y="' + f(cy - R * 0.5) + '" font-family="ui-monospace,monospace" font-weight="700" font-size="' + f(R * 0.6) + '" fill="#cfe6ff">?</text>';
      default: return '';
    }
  }
  function sparkAround(cx, cy, R, col) {
    var pts = [[-0.8, -0.7], [0.85, -0.55], [0.7, 0.7]], s = '';
    pts.forEach(function (p) { var x = cx + R * p[0], y = cy + R * p[1], q = R * 0.14;
      s += '<path d="M' + f(x) + ' ' + f(y - q) + ' L' + f(x + q * 0.35) + ' ' + f(y - q * 0.35) + ' L' + f(x + q) + ' ' + f(y) + ' L' + f(x + q * 0.35) + ' ' + f(y + q * 0.35) + ' L' + f(x) + ' ' + f(y + q) + ' L' + f(x - q * 0.35) + ' ' + f(y + q * 0.35) + ' L' + f(x - q) + ' ' + f(y) + ' L' + f(x - q * 0.35) + ' ' + f(y - q * 0.35) + ' Z" fill="' + col + '"/>'; });
    return s;
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
    var y = pad;
    for (var bi = 0; bi < 7; bi++) {
      if (labelW) s += '<text x="' + pad + '" y="' + f(y + cell * 0.6) + '" font-family="ui-monospace,monospace" font-size="10" letter-spacing="1" fill="#46507a">' + esc(ROOMS[bi].toUpperCase()) + '</text>';
      var x0 = pad + labelW, x = x0, col = 0, yy = y;
      bands[bi].forEach(function (t) {
        var emo = EMO_BY_CHAR[t[0]] || 'neutral', sal = clamp(parseInt(t[2], 10), 1, 5), kind = KIND_BY_SYM[t[3]] || 'thought';
        var R = cell * (0.30 + sal * 0.038), ccx = x + cell / 2, ccy = yy + cell / 2;
        if (kind === 'bond') {   // tessera hospitalis — a face split down the middle
          s += '<clipPath id="cl' + bi + '_' + col + '_L"><rect x="' + f(ccx - R * 1.2) + '" y="' + f(ccy - R * 1.2) + '" width="' + f(R * 1.2) + '" height="' + f(R * 2.4) + '"/></clipPath>';
          s += '<g>' + faceSVG(emo, ccx, ccy, R) + '</g>';
          s += '<rect x="' + f(ccx - 0.9) + '" y="' + f(ccy - R) + '" width="1.8" height="' + f(R * 2) + '" fill="#070a16"/>';
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
    glossLine: glossLine, encodeState: encodeState, speak: speak, renderSVG: renderSVG, faceSVG: faceSVG };
})();
