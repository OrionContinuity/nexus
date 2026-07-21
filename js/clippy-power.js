/* CLIPPY POWER — the single source of truth for "is Clippy at FULL POWER?"
   FULL POWER = a live pool node is running that advertises the Claude
   subscription lane (heartbeat `txt:true` / `claude:true`, fresh <120s). When
   a node is awake on Alfredo's machine, Clippy thinks with the subscription
   (his own Claude), not the API fallback — that is his strongest state, and
   every Clippy surface should light up for it.

   All Clippy surfaces read ONE answer here instead of each re-deriving it:
     NX.clippyPower.isFullPower()  → boolean (cached, refreshed ~60s)
     NX.clippyPower.nodes()        → the last-seen node heartbeat array
     NX.clippyPower.refresh()      → force an immediate re-read (returns bool)
   On any change in the answer, fires window 'clippy:power-change'
   {detail:{full}} so listeners can repaint without polling themselves.

   Read-only, dependency-free. Reads clippy_sync id='clippy_nodes' (the pool's
   shared heartbeat row: {data:[{ts, txt, claude, ...}, ...]}). Degrades to
   "not full power" whenever the bus is unreachable — a quiet, safe default. */
(function (LEX) {
  // TWO NX objects exist (see moneta-mind.js): app.js's lexical `const NX`
  // and the clippy-* modules' `window.NX`. Attach to BOTH so every consumer
  // finds NX.clippyPower regardless of which NX it resolved.
  var L = LEX || null;
  var W = (window.NX = window.NX || {});
  var T = L || W;

  var FRESH_S = 120;      // a heartbeat older than this is a dead node
  var POLL_MS = 60 * 1000;

  var _full = false;
  var _nodes = [];

  function sb() { return (window.NX && window.NX.sb) || (T && T.sb) || null; }

  function computeFull(arr) {
    if (!Array.isArray(arr)) return false;
    var now = Date.now() / 1000;
    return arr.some(function (n) {
      return n && (now - (n.ts || 0) < FRESH_S) && n.claude;   // v336: FULL POWER = the live Claude subscription lane only. The worker hardcodes txt:true on every heartbeat, so `n.txt||n.claude` lit the badge for ANY online node — contradicting this module's own contract.
    });
  }

  function _apply(next) {
    if (next !== _full) {
      _full = next;
      try {
        window.dispatchEvent(new CustomEvent('clippy:power-change', { detail: { full: _full } }));
      } catch (_) { /* CustomEvent unsupported — the cached value still updates */ }
    }
    return _full;
  }
  async function refresh() {
    try {
      var client = sb();
      if (!client || !client.from) return _apply(computeFull(_nodes));   // v331: recompute from cached nodes — they age past FRESH_S, so the badge decays instead of staying lit
      // supabase-js RESOLVES with {error} — destructure and check it.
      var res = await client.from('clippy_sync').select('data').eq('id', 'clippy_nodes').maybeSingle();
      var data = res && res.data;
      var error = res && res.error;
      // v331 CONTRACT FIX: the header promises "degrades to not-full whenever the bus is unreachable",
      // but every error path used to return the STALE cached _full, so once the pool was full and the
      // network then dropped, the ⚡ badge stayed lit forever. Recompute from the aging cached nodes.
      if (error) { console.warn('[clippy-power]', error.message || error); return _apply(computeFull(_nodes)); }
      var arr = (data && data.data) || [];
      _nodes = Array.isArray(arr) ? arr : [];
      return _apply(computeFull(_nodes));
    } catch (e) {
      console.warn('[clippy-power]', e && e.message);
      return _apply(computeFull(_nodes));
    }
  }

  var api = {
    isFullPower: function () { return _full; },
    nodes: function () { return _nodes; },
    refresh: refresh,
  };
  T.clippyPower = api;
  if (L && L !== W) W.clippyPower = api;

  // First poll shortly after boot (sb is created later in NX.init()), then
  // steady ~60s. try/catch so a scheduling hiccup never throws at load.
  try {
    setTimeout(refresh, 2000);
    setInterval(refresh, POLL_MS);
  } catch (_) { /* best-effort */ }

  console.log('[clippy-power] watching the pool — full power = a live subscription node');
})(typeof NX !== 'undefined' ? NX : null);
