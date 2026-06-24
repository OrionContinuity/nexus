/* ════════════════════════════════════════════════════════════════════════
   NEXUS QR — self-contained QR Code generator (no dependencies)
   ════════════════════════════════════════════════════════════════════════
   A faithful, dependency-free implementation of the QR Code spec
   (byte mode, versions 1–40, ECC levels L/M/Q/H, all 8 masks with the
   standard penalty scoring). Based on Nayuki's reference algorithm
   (MIT). Works in both the browser and Node.

   Usage (browser):
     const svg = NexusQR.svg('https://orioncontinuity.github.io/nexus/',
                             { ecl: 'M', border: 4, scale: 8 });
     document.getElementById('box').innerHTML = svg;
     // or render into an element with a brand frame:
     NexusQR.render(document.getElementById('box'),
                    'https://orioncontinuity.github.io/nexus/');

   Usage (Node — emit a file):
     node js/nexus-qr.js "https://orioncontinuity.github.io/nexus/" out.svg

   API:
     NexusQR.matrix(text, ecl)            -> boolean[][]  (true = dark)
     NexusQR.svg(text, opts)              -> string (SVG markup)
     NexusQR.render(el, text, opts)       -> injects SVG into el (browser)
   ════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.NexusQR = api;
    window.NX = window.NX || {};
    window.NX.qr = api;
  }
})(this, function () {
  'use strict';

  let _dbg = null;

  // ─── ECC level tables (index 0=L,1=M,2=Q,3=H) ─────────────────────────
  const ECL = { L: 0, M: 1, Q: 2, H: 3 };
  const ECL_FORMAT_BITS = { 0: 1, 1: 0, 2: 3, 3: 2 }; // L,M,Q,H → format bits

  // ECC codewords per block, indexed [ecl][version]
  const ECC_CODEWORDS_PER_BLOCK = [
    // ver: 0  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
  ];

  // ─── Galois field GF(256) arithmetic (generator 0x11D) ────────────────
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function reedSolomonDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function reedSolomonRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  // ─── Capacity helpers ─────────────────────────────────────────────────
  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
  }

  // ─── Byte-mode segment encoding ───────────────────────────────────────
  function toUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    // Node fallback
    return Array.from(Buffer.from(str, 'utf8'));
  }

  // Build the bit list for a byte-mode segment at a given version.
  function makeByteSegmentBits(bytes, ver) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    // Mode indicator: byte mode = 0100
    push(0x4, 4);
    // Character count: 8 bits (v1-9), 16 bits (v10-40) for byte mode
    const ccBits = ver <= 9 ? 8 : 16;
    push(bytes.length, ccBits);
    for (const b of bytes) push(b, 8);
    return bits;
  }

  // ─── Core: build the QR matrix ────────────────────────────────────────
  function buildMatrix(text, eclName, forceMask) {
    const ecl = ECL[(eclName || 'M').toUpperCase()];
    if (ecl === undefined) throw new Error('Bad ECC level: ' + eclName);
    const bytes = toUtf8(text);

    // Pick smallest version that fits.
    let ver = 1;
    for (; ver <= 40; ver++) {
      const dataCapacityBits = numDataCodewords(ver, ecl) * 8;
      const ccBits = ver <= 9 ? 8 : 16;
      const usedBits = 4 + ccBits + bytes.length * 8;
      if (usedBits <= dataCapacityBits) break;
    }
    if (ver > 40) throw new Error('Data too long for a QR code');

    // Assemble data bits + terminator + padding.
    const bits = makeByteSegmentBits(bytes, ver);
    const dataCapacityBits = numDataCodewords(ver, ecl) * 8;
    // Terminator (up to 4 zero bits)
    for (let i = 0; i < 4 && bits.length < dataCapacityBits; i++) bits.push(0);
    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);
    // Pad bytes 0xEC, 0x11 alternating
    for (let pad = 0xEC; bits.length < dataCapacityBits; pad ^= 0xEC ^ 0x11)
      for (let i = 7; i >= 0; i--) bits.push((pad >>> i) & 1);

    // Bits → data codewords
    const dataCodewords = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bits.length; i++)
      dataCodewords[i >>> 3] |= bits[i] << (7 - (i & 7));

    // Split into blocks + add ECC, then interleave.
    const allCodewords = addEccAndInterleave(dataCodewords, ver, ecl);
    _dbg = { dataCodewords: Array.from(dataCodewords), allCodewords: Array.from(allCodewords) };

    // Build module grid.
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

    drawFunctionPatterns(modules, isFunction, ver, ecl, size);
    drawCodewords(modules, isFunction, allCodewords, size);

    // Try all 8 masks, pick lowest penalty.
    let bestMask = 0, minPenalty = Infinity;
    if (forceMask != null) { bestMask = forceMask; }
    else
    for (let mask = 0; mask < 8; mask++) {
      applyMask(modules, isFunction, mask, size);
      drawFormatBits(modules, isFunction, ecl, mask, size);
      const p = penaltyScore(modules, size);
      if (p < minPenalty) { minPenalty = p; bestMask = mask; }
      applyMask(modules, isFunction, mask, size); // undo (XOR is its own inverse)
    }
    applyMask(modules, isFunction, bestMask, size);
    drawFormatBits(modules, isFunction, ecl, bestMask, size);

    return modules;
  }

  function addEccAndInterleave(data, ver, ecl) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const divisor = reedSolomonDivisor(blockEccLen);
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = reedSolomonRemainder(dat, divisor);
      const block = Array.from(dat);
      // Short blocks get a placeholder so columns line up during interleave.
      if (i < numShortBlocks) block.push(0);
      for (const b of ecc) block.push(b);
      blocks.push(block);
    }

    // Interleave.
    const result = [];
    const maxLen = shortBlockLen + 1;
    for (let i = 0; i < maxLen; i++) {
      for (let j = 0; j < blocks.length; j++) {
        // Skip the placeholder column for short blocks.
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(blocks[j][i]);
      }
    }
    return Uint8Array.from(result);
  }

  // ─── Function patterns ────────────────────────────────────────────────
  function setFn(modules, isFunction, x, y, dark) {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  }

  function drawFinder(modules, isFunction, cx, cy, size) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(modules, isFunction, x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const num = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < num; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function drawFunctionPatterns(modules, isFunction, ver, ecl, size) {
    // Timing patterns
    for (let i = 0; i < size; i++) {
      setFn(modules, isFunction, 6, i, i % 2 === 0);
      setFn(modules, isFunction, i, 6, i % 2 === 0);
    }
    // Finder patterns + separators (separators handled by 9x9 reservation below)
    drawFinder(modules, isFunction, 3, 3, size);
    drawFinder(modules, isFunction, size - 4, 3, size);
    drawFinder(modules, isFunction, 3, size - 4, size);

    // Alignment patterns
    const aligns = alignmentPositions(ver);
    for (let i = 0; i < aligns.length; i++) {
      for (let j = 0; j < aligns.length; j++) {
        // Skip the three corners occupied by finders
        if ((i === 0 && j === 0) || (i === 0 && j === aligns.length - 1) ||
            (i === aligns.length - 1 && j === 0)) continue;
        const cx = aligns[j], cy = aligns[i];
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            setFn(modules, isFunction, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    // Reserve format-info area (filled later) — mark as function modules.
    for (let i = 0; i < 9; i++) {
      if (!isFunction[i][8]) setFn(modules, isFunction, 8, i, false);
      if (!isFunction[8][i]) setFn(modules, isFunction, i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      if (!isFunction[size - 1 - i][8]) setFn(modules, isFunction, size - 1 - i, 8, false);
      if (!isFunction[8][size - 1 - i]) setFn(modules, isFunction, 8, size - 1 - i, false);
    }
    // Dark module
    setFn(modules, isFunction, 8, size - 8, true);

    // Version info (v >= 7)
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (ver << 12) | rem; // 18 bits
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        setFn(modules, isFunction, a, b, bit);
        setFn(modules, isFunction, b, a, bit);
      }
    }
  }

  function drawFormatBits(modules, isFunction, ecl, mask, size) {
    const data = (ECL_FORMAT_BITS[ecl] << 3) | mask; // 5 bits
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412; // 15 bits, masked

    // First copy (around top-left finder)
    for (let i = 0; i <= 5; i++) modules[i][8] = ((bits >>> i) & 1) === 1;
    modules[7][8] = ((bits >>> 6) & 1) === 1;
    modules[8][8] = ((bits >>> 7) & 1) === 1;
    modules[8][7] = ((bits >>> 8) & 1) === 1;
    for (let i = 9; i < 15; i++) modules[8][14 - i] = ((bits >>> i) & 1) === 1;

    // Second copy
    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = ((bits >>> i) & 1) === 1;
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = ((bits >>> i) & 1) === 1;
    modules[size - 8][8] = true; // dark module already set, keep consistent
  }

  // ─── Data placement (zigzag) ──────────────────────────────────────────
  function drawCodewords(modules, isFunction, codewords, size) {
    let i = 0; // bit index
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the timing column
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && i < codewords.length * 8) {
            modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  // ─── Masking ──────────────────────────────────────────────────────────
  function maskFn(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
    return false;
  }
  function applyMask(modules, isFunction, mask, size) {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!isFunction[y][x] && maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
  }

  // ─── Penalty scoring (to choose the best mask) ────────────────────────
  function penaltyScore(modules, size) {
    let result = 0;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

    // Rule 1: runs of 5+ same-color in rows/cols
    for (let y = 0; y < size; y++) {
      let runColor = false, runLen = 0;
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === runColor) { runLen++; if (runLen === 5) result += N1; else if (runLen > 5) result++; }
        else { runColor = modules[y][x]; runLen = 1; }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = false, runLen = 0;
      for (let y = 0; y < size; y++) {
        if (modules[y][x] === runColor) { runLen++; if (runLen === 5) result += N1; else if (runLen > 5) result++; }
        else { runColor = modules[y][x]; runLen = 1; }
      }
    }

    // Rule 2: 2x2 blocks of same color
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += N2;
      }

    // Rule 3: finder-like pattern 1:1:3:1:1 with 4 light modules on a side
    const pattern = [true, false, true, true, true, false, true];
    const hasPattern = (get) => {
      for (let k = 0; k < 7; k++) if (get(k) !== pattern[k]) return false;
      return true;
    };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (x + 6 < size && (x === 0 || x + 7 >= size || true)) {
          // horizontal: pattern then 4-light, or 4-light then pattern
          if (x + 6 < size && hasPattern(k => modules[y][x + k])) {
            const before = x >= 4 ? [modules[y][x-1],modules[y][x-2],modules[y][x-3],modules[y][x-4]].every(v=>!v) : false;
            const after = x + 10 < size ? [modules[y][x+7],modules[y][x+8],modules[y][x+9],modules[y][x+10]].every(v=>!v) : false;
            if (before || after) result += N3;
          }
        }
        if (y + 6 < size && hasPattern(k => modules[y + k][x])) {
          const before = y >= 4 ? [modules[y-1][x],modules[y-2][x],modules[y-3][x],modules[y-4][x]].every(v=>!v) : false;
          const after = y + 10 < size ? [modules[y+7][x],modules[y+8][x],modules[y+9][x],modules[y+10][x]].every(v=>!v) : false;
          if (before || after) result += N3;
        }
      }

    // Rule 4: balance of dark/light
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
    const total = size * size;
    const k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
    result += k * N4;

    return result;
  }

  // ─── Public render helpers ────────────────────────────────────────────
  function matrix(text, ecl, forceMask) { return buildMatrix(text, ecl, forceMask); }

  function svg(text, opts) {
    opts = opts || {};
    const ecl = opts.ecl || 'M';
    const border = opts.border == null ? 4 : opts.border;
    const scale = opts.scale || 8;
    const dark = opts.dark || '#0b0b0d';
    const light = opts.light || '#ffffff';
    const mods = buildMatrix(text, ecl);
    const size = mods.length;
    const dim = (size + border * 2) * scale;

    let path = '';
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (mods[y][x])
          path += `M${(x + border) * scale},${(y + border) * scale}h${scale}v${scale}h-${scale}z`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${esc(text)}">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
      `<path d="${path}" fill="${dark}"/></svg>`;
  }

  function render(el, text, opts) {
    if (!el) return;
    el.innerHTML = svg(text, opts);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { matrix, svg, render, ECL_LEVELS: Object.keys(ECL), _dbg: () => _dbg };
});

// ─── CLI: node js/nexus-qr.js "<text>" [outfile.svg] [ecl] ──────────────
if (typeof module !== 'undefined' && require.main === module) {
  const NexusQR = module.exports;
  const text = process.argv[2] || 'https://orioncontinuity.github.io/nexus/';
  const out = process.argv[3] || null;
  const ecl = process.argv[4] || 'M';
  const svgStr = NexusQR.svg(text, { ecl, border: 4, scale: 10 });
  if (out) {
    require('fs').writeFileSync(out, svgStr);
    // Also print an ASCII preview to the terminal for a quick sanity check.
    const mods = NexusQR.matrix(text, ecl);
    let ascii = '';
    for (let y = 0; y < mods.length; y += 2) {
      for (let x = 0; x < mods.length; x++) {
        const top = mods[y][x], bot = (y + 1 < mods.length) ? mods[y + 1][x] : false;
        ascii += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
      }
      ascii += '\n';
    }
    console.log(ascii);
    console.log('Wrote ' + out + '  (text: ' + text + ', ecl: ' + ecl + ', size: ' + mods.length + 'x' + mods.length + ')');
  } else {
    process.stdout.write(svgStr + '\n');
  }
}
