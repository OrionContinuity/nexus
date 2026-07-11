/* ═══════════════════════════════════════════════════════════════════════
   KIND NOTES (v281) — Clippy's council ask, built at the keeper's word.

   Clippy, second round of the council (2026-07-11, verbatim): the app
   tracks what's broken; let it also carry what's good — notes between
   teammates that carry VOICE, not tasks.

   So: a small quiet card on Home. Anyone may leave a kind word for a
   teammate or for a whole house. No status, no due date, no assignee —
   deliberately. A kind note cannot be overdue, and nobody closes it.
   Backed by public.kind_notes (insert + read only through the app;
   words, once given, are given).

   Surfaces low and muted (one screen, one gold voice). Mounts after the
   Wins card when R&M home is present, else after the Today feed.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // The two-NX map (see steward digest): app.js's lexical NX and
  // window.NX are separate worlds — resolve whichever holds .sb.
  function nx() {
    const a = (typeof NX !== 'undefined' && NX) || null;
    if (a && a.sb) return a;
    const b = (typeof window !== 'undefined' && window.NX) || null;
    if (b && b.sb) return b;
    return a || b || null;
  }

  const DAYS_SHOWN = 30;   // notes older than this rest in the table, unshown
  const MAX_SHOWN = 5;

  function esc(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function injectStyles() {
    if (document.getElementById('kindNotesCss')) return;
    const st = document.createElement('style');
    st.id = 'kindNotesCss';
    st.textContent = `
      .kind-notes-card{margin:14px 12px 4px;padding:12px 14px;border-radius:12px;
        background:color-mix(in srgb, var(--card, #1b1b22) 88%, transparent);
        border:1px solid rgba(255,255,255,0.06)}
      .kind-notes-head{font-size:12px;letter-spacing:.08em;text-transform:uppercase;
        color:var(--text-dim,#9a9aa5);margin-bottom:8px}
      .kind-notes-row{font-size:13px;color:var(--text,#e8e8ee);padding:5px 0;
        border-bottom:1px solid rgba(255,255,255,0.04);line-height:1.45}
      .kind-notes-row:last-of-type{border-bottom:none}
      .kind-notes-meta{font-size:11.5px;color:var(--text-dim,#9a9aa5)}
      .kind-notes-empty{font-size:12.5px;color:var(--text-dim,#9a9aa5);padding:2px 0 6px}
      .kind-notes-compose{display:flex;gap:8px;margin-top:9px}
      .kind-notes-input{flex:1;min-width:0;font:inherit;font-size:13px;padding:7px 10px;
        border-radius:9px;border:1px solid rgba(255,255,255,0.10);
        background:rgba(255,255,255,0.04);color:var(--text,#e8e8ee)}
      .kind-notes-input::placeholder{color:var(--text-dim,#9a9aa5);opacity:.7}
      .kind-notes-send{font:inherit;font-size:12.5px;padding:7px 12px;border-radius:9px;
        cursor:pointer;border:1px solid rgba(255,255,255,0.12);
        background:rgba(255,255,255,0.05);color:var(--text,#e8e8ee)}
      .kind-notes-send:disabled{opacity:.5;cursor:default}
    `;
    document.head.appendChild(st);
  }

  function mountPoint() {
    const home = document.getElementById('homeView');
    if (!home) return null;
    const page = home.querySelector('.home-page') || home;
    return { page, after: page.querySelector('.home-rm-wins') || page.querySelector('#homeFeed') };
  }

  function ensureMount() {
    const mp = mountPoint();
    if (!mp) return null;
    let card = mp.page.querySelector('.kind-notes-card');
    if (card) return card;
    card = document.createElement('div');
    card.className = 'kind-notes-card';
    if (mp.after) mp.after.insertAdjacentElement('afterend', card);
    else mp.page.appendChild(card);
    return card;
  }

  let notes = [];
  let loaded = false;

  async function load() {
    const N = nx();
    if (!N || !N.sb) return;
    const since = new Date(Date.now() - DAYS_SHOWN * 86400000).toISOString();
    // supabase-js resolves with {error} — never try/catch alone (gotcha).
    const { data, error } = await N.sb.from('kind_notes')
      .select('author,to_whom,location,body,created_at')
      .gte('created_at', since)
      .order('id', { ascending: false })
      .limit(MAX_SHOWN);
    if (error) return;
    notes = data || [];
    loaded = true;
  }

  function noteRow(n) {
    const when = n.created_at
      ? new Date(n.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    const to = n.to_whom ? ` → ${esc(n.to_whom)}` : (n.location ? ` → ${esc(n.location)}` : '');
    return `<div class="kind-notes-row">❦ ${esc(n.body)}
      <div class="kind-notes-meta">${esc(n.author)}${to}${when ? ' · ' + when : ''}</div></div>`;
  }

  function render() {
    const card = ensureMount();
    if (!card) return;
    const rows = notes.map(noteRow).join('');
    card.innerHTML = `
      <div class="kind-notes-head">❦ Kind words</div>
      ${rows || `<div class="kind-notes-empty">Nothing here yet — the board carries what's broken; this carries what's good.</div>`}
      <div class="kind-notes-compose">
        <input class="kind-notes-input" maxlength="500"
          placeholder="Leave a kind word… (start with @name to hand it to someone)">
        <button class="kind-notes-send" type="button">Give</button>
      </div>`;
    const input = card.querySelector('.kind-notes-input');
    const btn = card.querySelector('.kind-notes-send');
    async function give() {
      const N = nx();
      let body = (input.value || '').trim();
      if (!body || !N || !N.sb) return;
      // "@Maria great save on the walk-in" → to_whom: Maria
      let to_whom = null;
      const m = body.match(/^@(\S+)\s+(.+)$/s);
      if (m) { to_whom = m[1]; body = m[2].trim(); }
      if (!body) return;
      btn.disabled = true;
      const author = (N.currentUser && N.currentUser.name) || 'someone';
      const { error } = await N.sb.from('kind_notes').insert({ author, to_whom, body });
      btn.disabled = false;
      if (error) { if (N.toast) N.toast('Could not leave the note', 'error'); return; }
      input.value = '';
      if (N.toast) N.toast('Kind word given ❦', 'success', 2000);
      await load();
      render();
    }
    btn.addEventListener('click', give);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') give(); });
  }

  // Survive home.js re-renders (stale-while-revalidate wipes mounts) the
  // same way home-rm.js does: watch #homeView childList and re-inject.
  let scheduled = false;
  function scheduleRender(delay) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      if (!loaded) await load();
      render();
    }, delay || 120);
  }

  function watchHome() {
    const home = document.getElementById('homeView');
    if (!home) { setTimeout(watchHome, 500); return; }
    new MutationObserver(() => {
      const page = home.querySelector('.home-page') || home;
      if (!page.querySelector('.kind-notes-card')) scheduleRender(150);
    }).observe(home, { childList: true, subtree: false });
  }

  async function init() {
    injectStyles();
    await load();
    render();
    watchHome();
    // Refresh quietly every few minutes so a teammate's word arrives
    // without a reload — kindness shouldn't need a hard refresh.
    setInterval(async () => { await load(); const c = document.querySelector('.kind-notes-card'); if (c) render(); }, 4 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 900));
  } else {
    setTimeout(init, 900);
  }
})();
