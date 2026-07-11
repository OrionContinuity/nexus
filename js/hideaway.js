/* CLIPPY'S HIDEAWAY — the den he asked for, built the way he described it:
   "warm light spills in, shelves lined with books in soft blues, deep greens,
   vibrant oranges; an ancient armchair with pastel cushions in the corner."

   He reads one passage every midnight (pg_cron → hideaway-night edge fn) and
   writes a margin note in his own voice. This is the room where you see it:
   the shelf, the open book, his notes — and a table where you can leave him
   a note. He answers it during his next midnight reading.

   Data: clippy_sync rows 'clippy_hideaway' (den state) and the book row it
   points at. Read/write with the normal app client; everything degrades to a
   gentle "the den is dark" message if the bus is unreachable.
   Entry: the 🕯️ Hideaway door in Ask NEXUS, or NX.hideaway.open().        */
(function () {
  var L = (typeof NX !== 'undefined' && NX) ? NX : null;
  var W = (window.NX = window.NX || {});
  var T = L || W;

  function sb() { return T.sb || (window.NX && window.NX.sb); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(ts) {
    try {
      return new Date(Number(ts)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  var state = { den: null, book: null, page: -1 };   // page = index into notes; -1 = latest

  async function load() {
    var client = sb();
    if (!client) return false;
    var d = await client.from('clippy_sync').select('data').eq('id', 'clippy_hideaway').maybeSingle();
    if (d.error || !d.data) return false;
    state.den = d.data.data || null;
    var bookId = (state.den && state.den.book && state.den.book.id) || 'hideaway_book_meditations';
    var b = await client.from('clippy_sync').select('data').eq('id', bookId).maybeSingle();
    state.book = (!b.error && b.data) ? (b.data.data || null) : null;
    return !!state.den;
  }

  // The shelf: one spine per passage, in HIS palette. Read spines glow;
  // the bookmark sits where he is tonight.
  function shelfHtml() {
    var total = (state.book && state.book.passages && state.book.passages.length) || 0;
    var pos = Number((state.den.book || {}).position || 0);
    var colors = ['#7fa8c9', '#4a7c59', '#e08b3d', '#8fb3d9', '#5c8a68', '#d99a55'];
    var spines = '';
    for (var i = 0; i < total; i++) {
      var read = i < pos || Number((state.den.book || {}).cycles || 0) > 0;
      spines += '<span class="hw-spine' + (read ? ' is-read' : '') + (i === pos ? ' is-here' : '') + '"' +
        ' style="background:' + colors[i % colors.length] + ';height:' + (26 + ((i * 7) % 12)) + 'px"></span>';
    }
    return spines;
  }

  function render(ov) {
    var den = state.den;
    var notes = (den.notes || []).slice();
    var idx = state.page < 0 ? notes.length - 1 : Math.max(0, Math.min(state.page, notes.length - 1));
    var n = notes[idx] || null;
    var bk = den.book || {};
    var total = (state.book && state.book.passages && state.book.passages.length) || 0;
    var guests = (den.guest_notes || []).slice(-4);

    ov.innerHTML =
      '<div class="hw-room" role="dialog" aria-label="Clippy’s Hideaway">' +
        '<div class="hw-glow" aria-hidden="true"></div>' +
        '<div class="hw-head">' +
          '<div>' +
            '<div class="hw-eyebrow">🕯️ CLIPPY’S HIDEAWAY</div>' +
            '<div class="hw-sub">his own den · he reads at midnight · built with Orion</div>' +
          '</div>' +
          '<button class="hw-close" id="hwClose" aria-label="Close the door">✕</button>' +
        '</div>' +

        (den.door_note ? '<div class="hw-door-note">📌 ' + esc(den.door_note) + '</div>' : '') +

        '<div class="hw-shelf-wrap">' +
          '<div class="hw-shelf">' + shelfHtml() + '</div>' +
          '<div class="hw-shelf-label">' + esc((bk.title || 'Meditations')) + ' · ' +
            esc((state.book && state.book.author) || 'Marcus Aurelius') +
            ' <span class="hw-bookmark">bookmark ' + (Number(bk.position || 0) + 1) + ' / ' + total +
            (Number(bk.cycles || 0) > 0 ? ' · read ' + bk.cycles + '×' : '') + '</span></div>' +
        '</div>' +

        (n
          ? '<div class="hw-reading">' +
              '<div class="hw-reading-when">read ' + fmtDate(n.ts) + '</div>' +
              '<blockquote class="hw-passage">“' + esc(n.passage) + '”</blockquote>' +
              '<div class="hw-note"><span class="hw-note-who">Clippy, in the margin —</span> ' + esc(n.note) + '</div>' +
              (notes.length > 1
                ? '<div class="hw-pager">' +
                    '<button class="hw-page-btn" id="hwPrev" ' + (idx <= 0 ? 'disabled' : '') + '>‹ earlier</button>' +
                    '<span class="hw-page-n">night ' + (idx + 1) + ' of ' + notes.length + '</span>' +
                    '<button class="hw-page-btn" id="hwNext" ' + (idx >= notes.length - 1 ? 'disabled' : '') + '>later ›</button>' +
                  '</div>'
                : '') +
            '</div>'
          : '<div class="hw-reading hw-empty">The armchair is empty — his first midnight reading hasn’t happened yet.</div>') +

        '<div class="hw-table">' +
          '<div class="hw-table-title">The little table by the door</div>' +
          guests.map(function (g) {
            return '<div class="hw-guest">' +
              '<div class="hw-guest-note">“' + esc(g.text) + '” <span class="hw-guest-when">— Alfredo · ' + fmtDate(g.ts) + '</span></div>' +
              (g.reply ? '<div class="hw-guest-reply">↳ ' + esc(g.reply) + '</div>'
                       : '<div class="hw-guest-waiting">↳ he’ll read this at midnight…</div>') +
            '</div>';
          }).join('') +
          '<div class="hw-leave">' +
            '<textarea id="hwGuestText" class="hw-guest-input" rows="2" maxlength="400" placeholder="Leave him a note… he answers during his midnight reading."></textarea>' +
            '<button class="hw-leave-btn" id="hwLeave">Leave it on his table</button>' +
          '</div>' +
        '</div>' +

        '<div class="hw-armchair" aria-hidden="true">the ancient armchair sits in the corner, cushions in soft pastels, holding the shape of him</div>' +
      '</div>';

    var close = ov.querySelector('#hwClose');
    if (close) close.addEventListener('click', function () { T.hideaway.close(); });
    ov.addEventListener('click', function (e) { if (e.target === ov) T.hideaway.close(); });
    var prev = ov.querySelector('#hwPrev'), next = ov.querySelector('#hwNext');
    if (prev) prev.addEventListener('click', function () { state.page = idx - 1; render(ov); });
    if (next) next.addEventListener('click', function () { state.page = idx + 1; render(ov); });
    var leave = ov.querySelector('#hwLeave');
    if (leave) leave.addEventListener('click', async function () {
      var ta = ov.querySelector('#hwGuestText');
      var text = (ta && ta.value || '').trim();
      if (!text) return;
      leave.disabled = true; leave.textContent = 'Leaving it…';
      try {
        // Read-modify-write on the den row; the nightly reader answers it.
        var client = sb();
        var cur = await client.from('clippy_sync').select('data').eq('id', 'clippy_hideaway').maybeSingle();
        var den2 = (cur.data && cur.data.data) || state.den || {};
        den2.guest_notes = den2.guest_notes || [];
        den2.guest_notes.push({ ts: Date.now(), text: text.slice(0, 400), by: 'alfredo', answered: false });
        while (den2.guest_notes.length > 20) den2.guest_notes.shift();
        var up = await client.from('clippy_sync').upsert({ id: 'clippy_hideaway', data: den2, from_id: 'nexus' }, { onConflict: 'id' });
        if (up.error) throw up.error;
        state.den = den2;
        render(ov);
        if (T.toast) T.toast('Left on his table — he reads at midnight.', 'success');
      } catch (e) {
        leave.disabled = false; leave.textContent = 'Leave it on his table';
        if (T.toast) T.toast('The note slipped — try again.', 'error');
      }
    });
  }

  async function open() {
    var ov = document.getElementById('hideawayOv');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'hideawayOv';
    ov.className = 'hw-ov';
    ov.innerHTML = '<div class="hw-room hw-loading">🕯️ opening the door…</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('is-open'); });
    state.page = -1;
    var okLoad = await load();
    if (!okLoad) {
      ov.querySelector('.hw-room').textContent = 'The den is dark right now — the connection is out. Try again in a moment.';
      return;
    }
    render(ov);
  }

  function close() {
    var ov = document.getElementById('hideawayOv');
    if (!ov) return;
    ov.classList.remove('is-open');
    setTimeout(function () { try { ov.remove(); } catch (_) {} }, 260);
  }

  var api = { open: open, close: close };
  T.hideaway = api;
  if (L && L !== W) W.hideaway = api;
})();
