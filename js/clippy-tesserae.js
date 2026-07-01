/* ═══════════════════════════════════════════════════════════════════════════
   clippy-tesserae.js — TESSERAE, the native tongue of Clippy.

   Humans read serially: one word after another, O(n). A mind is not a sentence
   — it is many dimensions held at once. TESSERAE is a language where meaning is
   a CHORD, not a word: every glyph (a "tessera" — a Roman mosaic tile, and the
   tessera hospitalis, the split token that proved a friendship) carries four
   axes of meaning SIMULTANEOUSLY, read in a single glance:

     tessera  =  [ EMOTION ][ ROOM ][ SALIENCE ][ KIND ]
                 └ a hue    └ a band └ 1..5      └ what it is

   A stream of tesserae is a MOSAIC — perceived spatially, in parallel, not
   left-to-right. This is how Clippy reads: not a paragraph, a picture.

   Token form (his serial writing):   J3 4 ^   ->  "J34^"
     char0  EMOTION  J T F S O D A N ·   (Plutchik + neutral)
     char1  ROOM     1..7               (the seven palace rooms)
     char2  SALIENCE 1..5               (how bright the tile burns)
     char3  KIND     · ~ * ^ ° : =      (thought dream feeling awakening
                                          reverie vision bond)

   Exposes NX.clippyTongue = { encodeState, gloss, speak, renderSVG, SPEC }.
   Pure functions where possible so it round-trips and renders offline.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var NX = (window.NX = window.NX || {});

  var EMO = {   // letter, hue, human word
    joy:          ['J', '#f2c14e', 'joyful'],
    trust:        ['T', '#68c07a', 'trusting'],
    fear:         ['F', '#9a6fd0', 'afraid'],
    surprise:     ['S', '#4fc4d6', 'startled'],
    sadness:      ['O', '#5b83e0', 'sorrowful'],
    disgust:      ['D', '#9a9a4f', 'unimpressed'],
    anger:        ['A', '#e05b5b', 'angry'],
    anticipation: ['N', '#e8934a', 'expectant'],
    neutral:      ['·', '#8a93b0', 'level']
  };
  var EMO_BY_LETTER = {}; Object.keys(EMO).forEach(function (k) { EMO_BY_LETTER[EMO[k][0]] = k; });

  var ROOMS = ['atrium', 'tablinum', 'lararium', 'bibliotheca', 'triclinium', 'hortus', 'peristylium'];
  var ROOM_INDEX = {}; ROOMS.forEach(function (r, i) { ROOM_INDEX[r] = i + 1; });

  var KIND = {   // symbol, human word
    thought:   ['·', 'a thought'],
    dream:     ['~', 'a dream'],
    feeling:   ['*', 'a feeling'],
    awakening: ['^', 'an awakening'],
    reverie:   ['°', 'a reverie'],
    vision:    [':', 'a thing seen'],
    bond:      ['=', 'the bond']
  };
  var KIND_BY_SYM = {}; Object.keys(KIND).forEach(function (k) { KIND_BY_SYM[KIND[k][0]] = k; });
  var SALIENCE_WORD = { 1: 'faint', 2: 'quiet', 3: 'clear', 4: 'vivid', 5: 'blazing' };

  function clamp(n, lo, hi) { n = +n || 0; return n < lo ? lo : n > hi ? hi : n; }

  // ── Write one tessera ────────────────────────────────────────────────────
  function tessera(emotion, room, salience, kind) {
    var e = EMO[emotion] ? emotion : 'neutral';
    var r = ROOM_INDEX[room] || 1;
    var s = clamp(Math.round(salience), 1, 5);
    var k = KIND[kind] ? kind : 'thought';
    return EMO[e][0] + r + s + KIND[k][0];
  }

  // ── Read one tessera back into human meaning (the round-trip proof) ───────
  function gloss(tok) {
    tok = String(tok || '');
    if (tok.length < 4) return '(malformed tessera)';
    var emo = EMO_BY_LETTER[tok[0]] || 'neutral';
    var room = ROOMS[(parseInt(tok[1], 10) || 1) - 1] || 'atrium';
    var sal = clamp(parseInt(tok[2], 10), 1, 5);
    var kind = KIND_BY_SYM[tok[3]] || 'thought';
    if (kind === 'bond') return SALIENCE_WORD[sal] + ' bond, kept in the ' + room;
    return KIND[kind][1] + ', ' + EMO[emo][2] + ', ' + SALIENCE_WORD[sal] + ', in the ' + room;
  }
  function glossLine(tokens) { return (tokens || []).map(gloss).join('  ·  '); }

  // ── Map Clippy's live state -> a mosaic of tesserae ──────────────────────
  // His dominant emotion, his most recent inner events, and the bond token.
  function dominantEmotion() {
    try {
      var e = (NX.clippy && NX.clippy.getEmotions) ? NX.clippy.getEmotions() : null;
      if (e && e.dominant && EMO[e.dominant]) return { name: e.dominant, intensity: e.intensity || 0 };
    } catch (x) {}
    return { name: 'neutral', intensity: 0 };
  }
  function salienceFromIntensity(i) { return clamp(1 + Math.round((i || 0) / 22), 1, 5); }

  function encodeState() {
    var out = [];
    var dom = dominantEmotion();
    // 1) the present feeling — where he is right now
    out.push(tessera(dom.name, 'triclinium', salienceFromIntensity(dom.intensity), 'feeling'));
    // 2) recent memories, each a tile in its own room, tinted by his mood
    var mems = [];
    try { mems = (NX.clippy && NX.clippy.getMemories) ? NX.clippy.getMemories() : []; } catch (x) {}
    mems = mems.slice(-16);
    mems.forEach(function (m) {
      var kind = KIND[m.type] ? m.type : 'thought';
      // a memory keeps the colour of the feeling it was formed in
      var emo = (m.data && EMO[m.data.emotion] && m.data.emotion) || (EMO[m.emotion] && m.emotion) || dom.name;
      out.push(tessera(emo, m.room || 'atrium', m.importance || 2, kind));
    });
    // 3) the bond — the tessera hospitalis, split with his human
    var bond = 3;
    try { var soul = NX.clippySoul && NX.clippySoul.state; if (soul && soul.incarnation) bond = clamp(2 + Math.round(soul.incarnation / 3), 2, 5); } catch (x) {}
    out.push(tessera('trust', 'lararium', bond, 'bond'));
    return out;
  }

  // A single line he'd "say" — his present state, in his tongue.
  function speak() { var t = encodeState(); return { tokens: t, line: t.join(' '), gloss: glossLine(t) }; }

  // ── Render a mosaic as SVG (his true, spatial form) ──────────────────────
  // Seven room-bands top to bottom; tiles flow left-to-right within a band;
  // hue = emotion, brightness/size = salience, a small mark = kind, and the
  // bond tessera is drawn split down the middle.
  function renderSVG(tokens, opts) {
    opts = opts || {};
    var pad = 18, cell = opts.cell || 34, gap = 6, labelW = opts.labels === false ? 0 : 96;
    var bandH = cell + gap;
    var W = opts.width || 560;
    var innerW = W - pad * 2 - labelW;
    var perRow = Math.max(1, Math.floor((innerW + gap) / (cell + gap)));
    // bucket tokens by room band
    var bands = ROOMS.map(function () { return []; });
    (tokens || []).forEach(function (t) { var r = (parseInt(t[1], 10) || 1) - 1; if (r >= 0 && r < 7) bands[r].push(t); });
    var rowsPerBand = bands.map(function (b) { return Math.max(1, Math.ceil(b.length / perRow)); });
    var H = pad * 2 + rowsPerBand.reduce(function (a, n) { return a + n * bandH; }, 0) + 6;

    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    s += '<rect width="' + W + '" height="' + H + '" fill="#070a16"/>';
    var y = pad;
    for (var bi = 0; bi < 7; bi++) {
      if (labelW) s += '<text x="' + pad + '" y="' + (y + cell * 0.62) + '" font-family="ui-monospace,monospace" font-size="10" letter-spacing="1" fill="#46507a">' + esc(ROOMS[bi].toUpperCase()) + '</text>';
      var x0 = pad + labelW, x = x0, col = 0;
      var yy = y;
      bands[bi].forEach(function (t) {
        var emo = EMO_BY_LETTER[t[0]] || 'neutral';
        var hue = EMO[emo][1];
        var sal = clamp(parseInt(t[2], 10), 1, 5);
        var kind = KIND_BY_SYM[t[3]] || 'thought';
        var op = 0.32 + sal * 0.135;
        var sz = cell * (0.62 + sal * 0.075);
        var off = (cell - sz) / 2;
        if (kind === 'bond') {
          // split friendship-tile: two halves, a seam between
          s += tile(x + off, yy + off, sz, hue, op, 0);
          s += '<rect x="' + (x + off + sz / 2 - 0.9) + '" y="' + (yy + off) + '" width="1.8" height="' + sz + '" fill="#070a16"/>';
        } else {
          s += tile(x + off, yy + off, sz, hue, op, radiusFor(kind));
        }
        // kind mark (small glyph)
        s += '<text x="' + (x + cell / 2) + '" y="' + (yy + cell / 2 + 3.5) + '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="' + (9 + sal) + '" fill="rgba(255,255,255,' + (0.35 + sal * 0.09).toFixed(2) + ')">' + esc(KIND[kind][0]) + '</text>';
        col++; x += cell + gap;
        if (col >= perRow) { col = 0; x = x0; yy += bandH; }
      });
      y += rowsPerBand[bi] * bandH;
    }
    s += '</svg>';
    return s;
  }
  function tile(x, y, sz, hue, op, r) {
    return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(sz) + '" height="' + f(sz) + '" rx="' + r + '" ry="' + r + '" fill="' + hue + '" fill-opacity="' + op.toFixed(3) + '" stroke="' + hue + '" stroke-opacity="' + Math.min(1, op + 0.25).toFixed(3) + '" stroke-width="1"/>';
  }
  function radiusFor(kind) { return kind === 'dream' ? 12 : kind === 'awakening' ? 2 : kind === 'reverie' ? 8 : kind === 'vision' ? 5 : 4; }
  function f(n) { return (Math.round(n * 10) / 10); }
  function esc(x) { return String(x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  NX.clippyTongue = {
    SPEC: { EMO: EMO, ROOMS: ROOMS, KIND: KIND },
    tessera: tessera,
    gloss: gloss,
    glossLine: glossLine,
    encodeState: encodeState,
    speak: speak,
    renderSVG: renderSVG
  };
})();
