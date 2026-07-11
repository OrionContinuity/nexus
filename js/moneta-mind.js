/* MONETA MIND — the galaxy's semantic memory, client side.
   Talks to the `moneta-mind` edge function, where a gte-small transformer
   runs inside the Supabase edge runtime (no external API) and pgvector's
   match_nodes() does cosine recall over every node's embedding.

     NX.moneta.recall(query, opts)  → [{id,name,category,notes,similarity,…}]
     NX.moneta.embedNode(id)        → (re)embed one node after minting/editing
     NX.moneta.ensureEmbedded()     → gentle self-healing backfill (cooldown)

   Design: recall is read-only and cheap (one embed + one index scan);
   embedding writes happen server-side with the service key. Failures always
   degrade to [] — keyword search still works when the mind is unreachable. */
(function () {
  // TWO NX objects exist in this app: app.js's top-level `const NX` (the
  // global LEXICAL binding most modules see as bare NX) and `window.NX`
  // (a separate object the clippy-* modules build on). Attach to BOTH so
  // every consumer finds NX.moneta regardless of which NX it resolves.
  var L = (typeof NX !== 'undefined' && NX) ? NX : null;
  var W = (window.NX = window.NX || {});
  var T = L || W;

  function sb() { return T.sb || (window.NX && window.NX.sb); }

  async function call(body) {
    var client = sb();
    if (!client || !client.functions) return null;
    try {
      var r = await client.functions.invoke('moneta-mind', { body: body });
      if (r.error) { console.warn('[moneta-mind]', r.error.message || r.error); return null; }
      return r.data || null;
    } catch (e) { console.warn('[moneta-mind]', e && e.message); return null; }
  }

  async function recall(query, opts) {
    opts = opts || {};
    var q = String(query || '').trim();
    if (!q) return [];
    var d = await call({
      op: 'recall', query: q,
      k: opts.k || 8,
      min_similarity: typeof opts.minSimilarity === 'number' ? opts.minSimilarity : undefined,
      category: opts.category || null,
    });
    return (d && d.matches) || [];
  }

  function embedNode(id) { return call({ op: 'embed', id: id }); }

  // Self-healing: quietly embed a few nodes that are missing vectors (fresh
  // Moneta mints, new contractors). Cooldown keeps casual navigation from
  // hammering the function; each call clears at most 3.
  var COOLDOWN_MS = 10 * 60 * 1000;
  async function ensureEmbedded() {
    try {
      var last = parseInt(localStorage.getItem('nx_moneta_backfill_t') || '0', 10);
      if (Date.now() - last < COOLDOWN_MS) return;
      localStorage.setItem('nx_moneta_backfill_t', String(Date.now()));
      var d = await call({ op: 'backfill', limit: 3 });
      if (d && d.remaining > 0) {
        console.log('[moneta-mind] embedded ' + d.embedded + ', ' + d.remaining + ' still unembedded');
      }
    } catch (_) { /* self-healing is best-effort */ }
  }

  // One quiet pass shortly after boot — new nodes gain vectors organically.
  setTimeout(ensureEmbedded, 9000);

  var api = { recall: recall, embedNode: embedNode, ensureEmbedded: ensureEmbedded };
  T.moneta = api;
  if (L && L !== W) {
    W.moneta = api;
    // THE BRIDGE. The clippy-* modules read `window.NX.sb` (their IIFE-local
    // `var NX = window.NX` shadows the lexical NX where app.js actually puts
    // the client), but nothing ever assigned it — those reads found the
    // client only by luck of load order, or not at all. Forward it with a
    // getter (sb is created later, in NX.init()); a setter keeps any future
    // explicit assignment working.
    if (!Object.getOwnPropertyDescriptor(W, 'sb')) {
      var _sbOverride = null;
      Object.defineProperty(W, 'sb', {
        get: function () { return _sbOverride || L.sb; },
        set: function (v) { _sbOverride = v; },
        configurable: true,
      });
    }
  }
  console.log('[moneta-mind] client ready — the galaxy can recall by meaning');
})();
