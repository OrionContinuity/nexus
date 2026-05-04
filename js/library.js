/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Library — daily-card module v2
   ─────────────────────────────────────────────────────────────────────
   Replaces js/daily-card.js. The card on Home now surfaces today's
   chapter from the user's track-of-the-day, with a full audio player.

   Mental model:
     7 tracks (one per weekday). Each track has 2+ books.
     User has independent bookmarks per track.
     Daily card shows "today's track's current chapter."
     Tap play → audio streams from archive.org via HTML5 <audio>.
     Background plays when phone screen is off (iOS/Android default
     for HTML5 audio in standalone PWA).
     Lock screen shows track + chapter via Media Session API.
     Position checkpointed to Supabase every 15s so resume works
     even if app is force-killed.

   Public API:
     NX.library.mount(el)      — render card into an element
     NX.library.refresh()      — reload state and re-render
     NX.library.openLibrary()  — open the full library screen (Phase 3,
                                 surface stub for now)

   This module owns its own <audio> element (single global instance) so
   audio survives view changes within NEXUS — switching from Home to
   Equipment doesn't pause playback.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  if (!window.NX) { console.error('[library] NX not loaded'); return; }

  const TRACK_LABELS = {
    letters_quiet:  'LETTERS',
    strategy:       'STRATEGY',
    history:        'HISTORY',
    philosophy:     'PHILOSOPHY',
    biography:      'BIOGRAPHY',
    primary_source: 'PRIMARY SOURCE',
    big_history:    'BIG HISTORY',
  };

  const DOW_TO_TRACK = [
    'letters_quiet', 'strategy', 'history', 'philosophy',
    'biography', 'primary_source', 'big_history',
  ];

  // ───────────────────────────────────────────────────────────────────
  // Single global <audio> element. Created once, reused across cards.
  // Living outside the DOM tree of any view means it survives
  // Home → Equipment view switches without pausing.
  // ───────────────────────────────────────────────────────────────────
  const audio = (function makeAudio() {
    const el = document.createElement('audio');
    el.preload = 'metadata';                  // load just enough to know duration
    el.setAttribute('playsinline', '');       // iOS: don't open native fullscreen player
    el.crossOrigin = 'anonymous';             // archive.org allows CORS for audio
    // Persist a stable id so future module reloads can find/reattach.
    el.id = 'nxLibraryAudio';
    document.body.appendChild(el);
    return el;
  })();

  // ───────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────
  const state = {
    // Latest server payload from get_daily_listen()
    daily: null,
    // The element we mounted into (so refresh() knows where to render)
    mountEl: null,
    // Position-save throttling
    lastSaveAt: 0,
    saveTimer: null,
    // Render version — bump every successful render so async ops can
    // bail out if the card was re-rendered underneath them.
    renderVersion: 0,
  };

  function fmtDuration(seconds) {
    if (!seconds || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function fmtMins(seconds) {
    if (!seconds) return '0 min';
    const m = Math.round(seconds / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}m`;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function todayTrack() {
    // Mirror SQL get_track_for_today(). Use America/Chicago to match.
    // Intl gives us the day-of-week directly without DST math.
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', weekday: 'short',
      });
      const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const wk = fmt.format(new Date()).slice(0, 3);
      return DOW_TO_TRACK[map[wk] ?? new Date().getDay()];
    } catch (_) {
      return DOW_TO_TRACK[new Date().getDay()];
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Server I/O
  // ───────────────────────────────────────────────────────────────────
  async function loadDaily() {
    if (!NX.sb || !NX.currentUser) return null;
    try {
      const { data, error } = await NX.sb.rpc('get_daily_listen', { p_user_id: NX.currentUser.id });
      if (error) { console.warn('[library] get_daily_listen', error); return null; }
      return data;
    } catch (e) {
      console.warn('[library] loadDaily failed', e);
      return null;
    }
  }

  async function loadChapterByIndex(bookId, idx) {
    if (!NX.sb) return null;
    const { data, error } = await NX.sb.from('library_chapters')
      .select('id, chapter_index, title, mp3_url, duration_seconds, reader')
      .eq('book_id', bookId)
      .eq('chapter_index', idx)
      .maybeSingle();
    if (error) { console.warn('[library] loadChapter', error); return null; }
    return data;
  }

  async function savePosition(force) {
    if (!NX.sb || !NX.currentUser || !state.daily?.book?.id) return;
    const now = Date.now();
    if (!force && now - state.lastSaveAt < 14000) return;       // ≤ once / 15s
    state.lastSaveAt = now;
    try {
      await NX.sb.rpc('save_listen_position', {
        p_user_id:        NX.currentUser.id,
        p_book_id:        state.daily.book.id,
        p_chapter_index:  state.daily.progress.chapter_index,
        p_position_seconds: Math.floor(audio.currentTime || 0),
      });
    } catch (e) { /* network blip — next checkpoint will catch up */ }
  }

  async function markChapterComplete() {
    if (!NX.sb || !NX.currentUser || !state.daily?.book?.id || !state.daily?.chapter?.id) return;
    try {
      const { data, error } = await NX.sb.rpc('mark_chapter_complete', {
        p_user_id:    NX.currentUser.id,
        p_book_id:    state.daily.book.id,
        p_chapter_id: state.daily.chapter.id,
      });
      if (error) { console.warn('[library] mark_chapter_complete', error); return; }
      if (data?.book_complete && data?.next_book_title) {
        try { NX.toast?.(`Finished: ${state.daily.book.title} → next: ${data.next_book_title}`, 'success', 5000); }
        catch (_) {}
      }
      // Reload — the card now shows the next chapter (or next book).
      await refresh();
    } catch (e) {
      console.warn('[library] markChapterComplete failed', e);
    }
  }

  async function swapBook(newBookId) {
    if (!NX.sb || !NX.currentUser) return;
    const track = state.daily?.track || todayTrack();
    try {
      const { error } = await NX.sb.rpc('swap_book_on_track', {
        p_user_id: NX.currentUser.id,
        p_track:   track,
        p_new_book_id: Number(newBookId),
      });
      if (error) { console.warn('[library] swap_book_on_track', error); return; }
      audio.pause();
      await refresh();
    } catch (e) { console.warn('[library] swap failed', e); }
  }

  // ───────────────────────────────────────────────────────────────────
  // Audio behavior
  // ───────────────────────────────────────────────────────────────────
  function attachAudioHandlers() {
    if (audio._nxBound) return;
    audio._nxBound = true;

    audio.addEventListener('play', () => {
      updatePlayButton();
      updateMediaSession();
      try { document.body.classList.add('nx-audio-playing'); } catch (_) {}
    });
    audio.addEventListener('pause', () => {
      updatePlayButton();
      // Save position on pause — captures cases where user backgrounds the
      // app and the OS pauses us (especially relevant on iOS when a call
      // comes in or another media app takes over).
      savePosition(true);
      try { document.body.classList.remove('nx-audio-playing'); } catch (_) {}
    });
    audio.addEventListener('ended', () => {
      // Auto-advance on natural completion. mark_chapter_complete() will
      // reload state and re-render with the next chapter.
      try { document.body.classList.remove('nx-audio-playing'); } catch (_) {}
      markChapterComplete();
    });
    audio.addEventListener('timeupdate', () => {
      updateScrubber();
      // Periodic save while playing
      if (!audio.paused) savePosition(false);
    });
    audio.addEventListener('loadedmetadata', () => {
      // When the file loads with new duration, ensure scrubber reflects it
      updateScrubber();
    });
    audio.addEventListener('error', () => {
      const e = audio.error;
      console.warn('[library] audio error', e);
      try { NX.toast?.('Audio playback error — check connection', 'error'); } catch (_) {}
    });

    // Page visibility: when user returns to the app after backgrounding,
    // re-sync UI to reflect actual playback state.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        updatePlayButton();
        updateScrubber();
      }
    });

    // Save on hide / unload — last-chance checkpoint.
    window.addEventListener('pagehide',     () => savePosition(true));
    window.addEventListener('beforeunload', () => savePosition(true));
  }

  function updateMediaSession() {
    // Lock-screen / control-center metadata. Browsers that don't support
    // Media Session API just ignore this.
    if (!('mediaSession' in navigator)) return;
    const d = state.daily;
    if (!d?.book || !d?.chapter) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:   d.chapter.title || `Chapter ${d.chapter.index}`,
        artist:  d.book.author || '',
        album:   d.book.title || '',
        artwork: d.book.cover_url ? [
          { src: d.book.cover_url, sizes: '512x512', type: 'image/jpeg' },
        ] : [],
      });
      navigator.mediaSession.setActionHandler('play',  () => audio.play().catch(()=>{}));
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', (e) => {
        audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 15));
      });
      navigator.mediaSession.setActionHandler('seekforward', (e) => {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (e.seekOffset || 30));
      });
      navigator.mediaSession.setActionHandler('seekto', (e) => {
        if (typeof e.seekTime === 'number') audio.currentTime = e.seekTime;
      });
    } catch (_) {}
  }

  function updatePlayButton() {
    const root = state.mountEl;
    if (!root) return;
    const btn = root.querySelector('.lib-play-btn');
    if (!btn) return;
    const playing = !audio.paused && !audio.ended;
    btn.classList.toggle('is-playing', playing);
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    btn.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  }

  function updateScrubber() {
    const root = state.mountEl;
    if (!root) return;
    const cur  = root.querySelector('.lib-time-cur');
    const tot  = root.querySelector('.lib-time-tot');
    const fill = root.querySelector('.lib-scrub-fill');
    const knob = root.querySelector('.lib-scrub-knob');
    const c = audio.currentTime || 0;
    const d = audio.duration   || state.daily?.chapter?.duration_seconds || 0;
    if (cur)  cur.textContent  = fmtDuration(c);
    if (tot)  tot.textContent  = fmtDuration(d);
    const pct = d > 0 ? Math.min(100, (c / d) * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left  = pct + '%';
  }

  function loadChapterIntoAudio() {
    const ch = state.daily?.chapter;
    if (!ch) return;
    if (audio.src !== ch.mp3_url) {
      audio.src = ch.mp3_url;
      audio.load();
      // Resume position if any
      const resume = state.daily.progress?.position_seconds || 0;
      if (resume > 5) {
        // Some browsers reject currentTime before metadata loads; defer
        const onMeta = () => {
          audio.currentTime = Math.min(resume, (audio.duration || resume) - 1);
          audio.removeEventListener('loadedmetadata', onMeta);
        };
        audio.addEventListener('loadedmetadata', onMeta);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────
  function renderEmpty(track) {
    const trackLabel = TRACK_LABELS[track] || track.toUpperCase();
    state.mountEl.innerHTML = `
      <div class="lib-card lib-card-empty">
        <div class="lib-track-tag">${esc(trackLabel)} · ${esc(weekdayLabel())}</div>
        <div class="lib-empty-msg">
          No book ingested for today's track yet.
          <br><br>
          Run the ingest script to populate the library.
        </div>
      </div>
    `;
  }

  function weekdayLabel() {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', weekday: 'short',
      }).format(new Date()).toUpperCase();
    } catch (_) { return ''; }
  }

  function dateLabel() {
    try {
      const d = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', month: 'short', day: 'numeric',
      }).format(new Date()).toUpperCase();
      return d;
    } catch (_) { return ''; }
  }

  function render() {
    if (!state.mountEl) return;
    state.renderVersion++;

    const d = state.daily;
    if (!d) {
      state.mountEl.innerHTML = `<div class="lib-card lib-card-loading">Loading library…</div>`;
      return;
    }
    if (!d.has_book) { renderEmpty(d.track); return; }

    const trackLabel = TRACK_LABELS[d.track] || d.track.toUpperCase();
    const ch = d.chapter || {};
    const bk = d.book || {};
    const total = bk.total_chapters || 0;
    const idx   = d.progress?.chapter_index || 1;
    const completed = d.progress?.completed_count || 0;

    // Available books on this track for the dropdown — exclude current book
    const others = (d.available_books || []).filter(b => b.id !== bk.id);

    state.mountEl.innerHTML = `
      <div class="lib-card">
        <!-- Track tag + date — orienting glance -->
        <div class="lib-track-row">
          <span class="lib-track-tag">${esc(trackLabel)} · ${esc(weekdayLabel())} · ${esc(dateLabel())}</span>
          <button class="lib-swap-btn" type="button" aria-label="Switch book">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 10l5-5 5 5M7 14l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>

        <!-- Book + chapter heading -->
        <h3 class="lib-book-title">${esc(bk.title)}</h3>
        <div class="lib-book-meta">
          ${esc(bk.author)}${bk.translator ? ` &middot; tr. ${esc(bk.translator)}` : ''}
        </div>
        <div class="lib-chapter-line">
          ${esc(ch.title || `Chapter ${idx}`)}
          <span class="lib-chapter-pos">&middot; ${idx} of ${total}</span>
        </div>

        <!-- Audio player -->
        <div class="lib-player">
          <button class="lib-play-btn" type="button" aria-label="Play">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
          </button>
          <div class="lib-player-body">
            <div class="lib-scrub" tabindex="0" role="slider" aria-label="Seek">
              <div class="lib-scrub-track"></div>
              <div class="lib-scrub-fill"></div>
              <div class="lib-scrub-knob"></div>
            </div>
            <div class="lib-time-row">
              <span class="lib-time-cur">0:00</span>
              <div class="lib-controls">
                <button class="lib-skip-back" type="button" aria-label="Back 15 seconds">−15</button>
                <button class="lib-speed" type="button" aria-label="Playback speed">1×</button>
                <button class="lib-skip-fwd" type="button" aria-label="Forward 30 seconds">+30</button>
              </div>
              <span class="lib-time-tot">${esc(fmtDuration(ch.duration_seconds || 0))}</span>
            </div>
          </div>
        </div>

        <!-- Footer: mark done + completed counter -->
        <div class="lib-footer">
          <button class="lib-done-btn" type="button">Mark chapter done</button>
          <span class="lib-stat">
            ${completed > 0 ? `${completed} book${completed === 1 ? '' : 's'} read on this track` : 'just getting started'}
          </span>
        </div>

        <!-- Swap drawer (hidden until swap-btn tapped) -->
        ${others.length ? `
        <div class="lib-swap-drawer" hidden>
          <div class="lib-swap-label">Switch to:</div>
          <div class="lib-swap-list">
            ${others.map(b => `
              <button class="lib-swap-option" type="button" data-book-id="${b.id}">
                <span class="lib-swap-title">${esc(b.title)}</span>
                <span class="lib-swap-author">${esc(b.author)}</span>
                <span class="lib-swap-meta">${b.total_chapters} ch · ${esc(fmtMins(b.total_seconds))}</span>
              </button>
            `).join('')}
          </div>
        </div>` : ''}
      </div>
    `;

    wireUp();
    loadChapterIntoAudio();
    updatePlayButton();
    updateScrubber();
  }

  function wireUp() {
    const root = state.mountEl;
    if (!root) return;

    // Play / pause
    root.querySelector('.lib-play-btn')?.addEventListener('click', async () => {
      if (audio.paused) {
        try { await audio.play(); }
        catch (e) { console.warn('[library] play rejected:', e?.message); }
      } else {
        audio.pause();
      }
    });

    // Skip back / forward
    root.querySelector('.lib-skip-back')?.addEventListener('click', () => {
      audio.currentTime = Math.max(0, (audio.currentTime || 0) - 15);
    });
    root.querySelector('.lib-skip-fwd')?.addEventListener('click', () => {
      const d = audio.duration || 0;
      audio.currentTime = Math.min(d, (audio.currentTime || 0) + 30);
    });

    // Speed cycle: 1.0 → 1.25 → 1.5 → 1.75 → 2.0 → 1.0
    const speedBtn = root.querySelector('.lib-speed');
    if (speedBtn) {
      const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
      let i = SPEEDS.indexOf(audio.playbackRate);
      if (i < 0) i = 0;
      const fmt = (v) => (Number.isInteger(v) ? v + '×' : v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + '×');
      speedBtn.textContent = fmt(audio.playbackRate || 1);
      speedBtn.addEventListener('click', () => {
        i = (i + 1) % SPEEDS.length;
        audio.playbackRate = SPEEDS[i];
        speedBtn.textContent = fmt(SPEEDS[i]);
      });
    }

    // Mark done
    root.querySelector('.lib-done-btn')?.addEventListener('click', async () => {
      audio.pause();
      await markChapterComplete();
    });

    // Swap drawer toggle
    const swapBtn = root.querySelector('.lib-swap-btn');
    const drawer  = root.querySelector('.lib-swap-drawer');
    if (swapBtn && drawer) {
      swapBtn.addEventListener('click', () => {
        const open = !drawer.hasAttribute('hidden');
        if (open) drawer.setAttribute('hidden', '');
        else      drawer.removeAttribute('hidden');
        swapBtn.classList.toggle('is-open', !open);
      });
    }

    // Swap option tap
    root.querySelectorAll('.lib-swap-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-book-id');
        if (id) await swapBook(id);
      });
    });

    // Scrubber — pointer-based seek
    const scrub = root.querySelector('.lib-scrub');
    if (scrub) wireScrubber(scrub);
  }

  function wireScrubber(scrub) {
    let dragging = false;
    let wasPlaying = false;

    function pctFromEvent(e) {
      const rect = scrub.getBoundingClientRect();
      const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    }
    function applyPct(pct) {
      const d = audio.duration || state.daily?.chapter?.duration_seconds || 0;
      if (!d) return;
      audio.currentTime = pct * d;
      updateScrubber();
    }

    const onDown = (e) => {
      e.preventDefault();
      dragging = true;
      wasPlaying = !audio.paused;
      audio.pause();
      applyPct(pctFromEvent(e));
    };
    const onMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      applyPct(pctFromEvent(e));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      savePosition(true);
      if (wasPlaying) { audio.play().catch(()=>{}); }
    };

    scrub.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    scrub.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',  onUp);
  }

  // ───────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────
  async function refresh() {
    if (!state.mountEl) return;
    state.daily = await loadDaily();
    render();
  }

  async function mount(el) {
    if (!el) return;
    state.mountEl = el;
    attachAudioHandlers();

    // Initial paint shows a placeholder while we fetch
    state.mountEl.innerHTML = `<div class="lib-card lib-card-loading">Loading library…</div>`;
    await refresh();
  }

  // Stub for the future Library screen (Phase 3). Right now just a
  // placeholder so the swap dropdown isn't the only entry to management.
  function openLibrary() {
    try { NX.toast?.('Full library screen coming soon. Use the swap button on the card to switch books.', 'info', 4000); }
    catch (_) {}
  }

  NX.library = { mount, refresh, openLibrary };
})();
