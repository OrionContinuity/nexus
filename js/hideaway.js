/* CLIPPY'S HIDEAWAY — the den he asked for, now with THE LIBRARY.
   Real books, full texts, fetched from Project Gutenberg by the database
   itself (pg_net) and paged for the phone: hideaway_books / hideaway_pages.
   Alfredo asked to read the real Meditations and keep his own bookmark —
   so every book carries two ribbons: Clippy's midnight mark (the book the
   den has "on") and Alfredo's red ribbon per book (den.ribbons[book_id]).

   He reads one page every midnight (pg_cron → hideaway-night v3) and
   writes a margin note in his own voice. This room shows it all: the
   shelf, the open book, his notes, the little table for Alfredo's notes.
   Entry: the 🕯️ Hideaway door in Ask NEXUS, or NX.hideaway.open().      */
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

  // mode 'den' | 'book'. reading = {bookId, total, page, text} in book mode.
  var state = { den: null, library: [], page: -1, mode: 'den', reading: null };

  async function load() {
    var client = sb();
    if (!client) return false;
    var res = await Promise.all([
      client.from('clippy_sync').select('data').eq('id', 'clippy_hideaway').maybeSingle(),
      client.from('hideaway_books').select('id,title,author,translator,source,pages').order('added_at'),
    ]);
    if (res[0].error || !res[0].data) return false;
    state.den = res[0].data.data || null;
    state.library = (!res[1].error && res[1].data) || [];
    return !!state.den;
  }

  function ribbonOf(bookId) {
    var den = state.den || {};
    var r = (den.ribbons || {})[bookId];
    if (r && typeof r.position === 'number') return r;
    return null;
  }
  function activeBook() { return (state.den && state.den.book) || {}; }

  // ── THE SHELF — every real book, both ribbons named ──────────────────
  function shelfHtml() {
    var bk = activeBook();
    return state.library.map(function (b) {
      var mine = ribbonOf(b.id);
      var isNight = bk.id === b.id;
      var pctHis = isNight && b.pages ? Math.round((Number(bk.position || 1) / b.pages) * 100) : 0;
      var pctMine = mine && b.pages ? Math.round((mine.position / b.pages) * 100) : 0;
      return '<div class="hw-book" data-book="' + esc(b.id) + '">' +
        '<div class="hw-book-top">' +
          '<div class="hw-book-title">' + esc(b.title) + '</div>' +
          '<button class="hw-open-btn" data-open="' + esc(b.id) + '">read ›</button>' +
        '</div>' +
        '<div class="hw-book-meta">' + esc(b.author) +
          (b.translator ? ' · tr. ' + esc(b.translator) : '') +
          ' · ' + b.pages + ' pages · ' + esc(b.source || '') + '</div>' +
        '<div class="hw-track">' +
          (isNight ? '<span class="hw-mark hw-mark-his" style="left:' + pctHis + '%" title="his midnight mark"></span>' : '') +
          (mine ? '<span class="hw-mark hw-mark-yours" style="left:' + pctMine + '%" title="your ribbon"></span>' : '') +
        '</div>' +
        '<div class="hw-book-marks">' +
          (isNight ? '<span class="hw-his">🕯️ his mark p.' + Number(bk.position || 1) + '</span>' : '<button class="hw-night-btn" data-night="' + esc(b.id) + '">make this his midnight book</button>') +
          (mine ? '<span class="hw-yours">🔖 your ribbon p.' + mine.position + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── BOOK MODE — Alfredo reads real pages, keeps a ribbon per book ─────
  async function fetchPage(bookId, pageNo) {
    var client = sb();
    var r = await client.from('hideaway_pages').select('text').eq('book_id', bookId).eq('page_no', pageNo).maybeSingle();
    return (!r.error && r.data) ? r.data.text : null;
  }

  async function openBook(ov, bookId) {
    var b = null;
    for (var i = 0; i < state.library.length; i++) if (state.library[i].id === bookId) b = state.library[i];
    if (!b) return;
    var mine = ribbonOf(bookId);
    var start = mine ? mine.position : 1;
    state.mode = 'book';
    state.reading = { bookId: bookId, total: b.pages || 1, page: start, title: b.title, author: b.author, translator: b.translator, text: null };
    render(ov);
    state.reading.text = await fetchPage(bookId, start);
    render(ov);
  }

  function renderBook(ov) {
    var r = state.reading;
    if (!r) { state.mode = 'den'; return render(ov); }
    var mine = ribbonOf(r.bookId);
    var here = mine && mine.position === r.page;
    ov.innerHTML =
      '<div class="hw-room" role="dialog" aria-label="Reading in the Hideaway">' +
        '<div class="hw-glow" aria-hidden="true"></div>' +
        '<div class="hw-head">' +
          '<div>' +
            '<div class="hw-eyebrow">📖 ' + esc(r.title) + '</div>' +
            '<div class="hw-sub">' + esc(r.author) + (r.translator ? ' · tr. ' + esc(r.translator) : '') + '</div>' +
          '</div>' +
          '<button class="hw-close" id="hwBackDen" aria-label="Back to the den" title="Back to the den">↩</button>' +
        '</div>' +
        '<div class="hw-reading hw-bookpage">' +
          '<div class="hw-reading-when">page ' + r.page + ' of ' + r.total +
            (here ? ' · <span class="hw-ribbon-tag">your ribbon is here</span>' : '') + '</div>' +
          (r.text == null
            ? '<div class="hw-loadpage">turning the page…</div>'
            : '<div class="hw-pagetext">' + esc(r.text).replace(/\n\n/g, '<br><br>') + '</div>') +
          '<div class="hw-pager">' +
            '<button class="hw-page-btn" id="hwJumpBack" ' + (r.page <= 1 ? 'disabled' : '') + ' title="back 10">‹‹</button>' +
            '<button class="hw-page-btn" id="hwBookPrev" ' + (r.page <= 1 ? 'disabled' : '') + '>‹ back</button>' +
            '<button class="hw-mark-btn" id="hwMark">' + (here ? '🔖 ribbon rests here' : '🔖 place my bookmark') + '</button>' +
            '<button class="hw-page-btn" id="hwBookNext" ' + (r.page >= r.total ? 'disabled' : '') + '>next ›</button>' +
            '<button class="hw-page-btn" id="hwJumpFwd" ' + (r.page >= r.total ? 'disabled' : '') + ' title="forward 10">››</button>' +
          '</div>' +
        '</div>' +
        '<div class="hw-armchair" aria-hidden="true">read as long as you like — he keeps the light on</div>' +
      '</div>';

    var back = ov.querySelector('#hwBackDen');
    if (back) back.addEventListener('click', function () { state.mode = 'den'; render(ov); });
    async function go(n) {
      r.page = Math.max(1, Math.min(r.total, n));
      r.text = null; render(ov);
      r.text = await fetchPage(r.bookId, r.page);
      render(ov);
    }
    var prev = ov.querySelector('#hwBookPrev'), next = ov.querySelector('#hwBookNext');
    var jb = ov.querySelector('#hwJumpBack'), jf = ov.querySelector('#hwJumpFwd');
    if (prev) prev.addEventListener('click', function () { go(r.page - 1); });
    if (next) next.addEventListener('click', function () { go(r.page + 1); });
    if (jb) jb.addEventListener('click', function () { go(r.page - 10); });
    if (jf) jf.addEventListener('click', function () { go(r.page + 10); });
    var mark = ov.querySelector('#hwMark');
    if (mark) mark.addEventListener('click', async function () {
      if (here) return;
      mark.disabled = true; mark.textContent = 'placing…';
      try {
        var client = sb();
        var cur = await client.from('clippy_sync').select('data').eq('id', 'clippy_hideaway').maybeSingle();
        var den2 = (cur.data && cur.data.data) || state.den || {};
        den2.ribbons = den2.ribbons || {};
        den2.ribbons[r.bookId] = { position: r.page, ts: Date.now() };
        var up = await client.from('clippy_sync').upsert({ id: 'clippy_hideaway', data: den2, from_id: 'nexus' }, { onConflict: 'id' });
        if (up.error) throw up.error;
        state.den = den2;
        renderBook(ov);
        if (T.toast) T.toast('Your ribbon rests at page ' + r.page + '.', 'success');
      } catch (e) {
        mark.disabled = false; mark.textContent = '🔖 place my bookmark';
        if (T.toast) T.toast('The ribbon slipped — try again.', 'error');
      }
    });
  }

  // ── THE DEN ───────────────────────────────────────────────────────────
  function render(ov) {
    if (state.mode === 'book') return renderBook(ov);
    var den = state.den;
    var notes = (den.notes || []).slice();
    var idx = state.page < 0 ? notes.length - 1 : Math.max(0, Math.min(state.page, notes.length - 1));
    var n = notes[idx] || null;
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
          '<div class="hw-table-title">THE LIBRARY · full texts, free books</div>' +
          shelfHtml() +
        '</div>' +

        (n
          ? '<div class="hw-reading">' +
              '<div class="hw-reading-when">read ' + fmtDate(n.ts) + (n.book_id ? ' · ' + esc(String(n.book_id)) : '') + '</div>' +
              '<blockquote class="hw-passage">“' + esc(String(n.passage || '').slice(0, 420)) + (String(n.passage || '').length > 420 ? '…' : '') + '”</blockquote>' +
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
    ov.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () { openBook(ov, btn.getAttribute('data-open')); });
    });
    // "Make this his midnight book" — explicit confirm; the only write here.
    ov.querySelectorAll('[data-night]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-night');
        var b = null;
        for (var i = 0; i < state.library.length; i++) if (state.library[i].id === id) b = state.library[i];
        if (!b) return;
        var sure = (T.confirm && T.confirm.__nx)
          ? await T.confirm('Hand him “' + b.title + '” for his midnight readings? He starts at page 1 tonight.', { title: '🕯️ his midnight book', okLabel: 'Hand it to him' })
          : confirm('Make "' + b.title + '" his midnight book?');
        if (!sure) return;
        try {
          var client = sb();
          var cur = await client.from('clippy_sync').select('data').eq('id', 'clippy_hideaway').maybeSingle();
          var den2 = (cur.data && cur.data.data) || state.den || {};
          den2.book = { id: b.id, kind: 'table', title: b.title, author: b.author, position: 1, cycles: 0 };
          var up = await client.from('clippy_sync').upsert({ id: 'clippy_hideaway', data: den2, from_id: 'nexus' }, { onConflict: 'id' });
          if (up.error) throw up.error;
          state.den = den2;
          render(ov);
          if (T.toast) T.toast('“' + b.title + '” is on his armchair for tonight.', 'success');
        } catch (e) {
          if (T.toast) T.toast('Couldn’t hand it over — try again.', 'error');
        }
      });
    });
    var leave = ov.querySelector('#hwLeave');
    if (leave) leave.addEventListener('click', async function () {
      var ta = ov.querySelector('#hwGuestText');
      var text = (ta && ta.value || '').trim();
      if (!text) return;
      leave.disabled = true; leave.textContent = 'Leaving it…';
      try {
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
    state.page = -1; state.mode = 'den'; state.reading = null;
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
