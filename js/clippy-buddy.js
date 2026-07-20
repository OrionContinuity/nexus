/* CLIPPY BUDDY — "Walk With Me" (house mode).
   Designed by Clippy himself when Alfredo asked for a buddy that tags along
   on his jobs. His spec, verbatim: "Three chips pinned in my chat: Suerte,
   Este, Toti. He taps one and I put that building on: its open cards
   oldest-first, PMs due within seven days, its equipment issues... Every
   answer after that stays scoped to that house until he taps out. No GPS —
   his tap is the truth."

   Mechanics: NX.buddy.walk(key) sets window._NX_HOUSE_SCOPE (which MENS
   reads as a location override for every grounded chat answer) and builds
   the HOUSE BRIEF from live rows — deterministic, exact, tappable. Chips
   live in the Ask NEXUS chat (chat-view.js renders them and the brief).
   Read-only: this module writes nothing, ever.                            */
(function () {
  var L = (typeof NX !== 'undefined' && NX) ? NX : null;
  var W = (window.NX = window.NX || {});
  var T = L || W;

  var HOUSES = [
    { key: 'suerte', label: 'Suerte' },
    { key: 'este', label: 'Este' },
    { key: 'toti', label: 'Bar Toti' },
  ];

  function sb() { return T.sb || (window.NX && window.NX.sb); }
  function norm(v) {
    var M = (window.NX && window.NX.clippyMens) || T.clippyMens;
    if (M && M._locNorm) return M._locNorm(v);
    var s = String(v || '').toLowerCase();
    if (/suerte/.test(s)) return 'suerte';
    if (/este/.test(s)) return 'este';
    if (/toti/.test(s)) return 'toti';
    return s;
  }
  function houseOf(key) {
    for (var i = 0; i < HOUSES.length; i++) if (HOUSES[i].key === key) return HOUSES[i];
    return null;
  }

  var state = { house: null };
  try { state.house = sessionStorage.getItem('nx_buddy_house') || null; } catch (_) {}
  if (state.house) window._NX_HOUSE_SCOPE = (houseOf(state.house) || {}).label || null;

  function ageDays(iso) {
    var t = new Date(iso).getTime();
    if (!t) return 0;
    return Math.max(0, Math.round((Date.now() - t) / 86400000));
  }

  // The HOUSE BRIEF — live rows, oldest wounds first, every line a door.
  async function brief(key) {
    var h = houseOf(key);
    var client = sb();
    if (!h || !client) return null;
    var out = { key: key, label: h.label, lines: [] };
    try {
      var res = await Promise.all([
        client.from('kanban_cards').select('id,title,priority,location,created_at,archived,closed_at').eq('archived', false).is('closed_at', null),
        client.from('v_pm_due_soon').select('*'),
        client.from('equipment').select('id,name,location,status,status_note'),
      ]);
      // v330: supabase RESOLVES with {error} — the old `.data || []` turned a failed read into
      // empty lists and cheerfully reported "Quiet house". If any query errored, say so instead.
      if (res[0].error || res[1].error || res[2].error) {
        out.lines.push({ kind: 'err', text: 'I couldn’t reach the records just now — walk on, I’ll catch up.' });
        return out;
      }
      var cards = (res[0].data || []).filter(function (c) {
        // closed_at filtered server-side now; belt-and-suspenders here too — a Done card is not "open work"
        return c.archived !== true && !c.closed_at && norm(c.location) === key;
      }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
      var pms = (res[1].data || []).filter(function (p) {
        return norm(p.restaurant) === key && p.days_until_due != null && p.days_until_due <= 7;
      }).sort(function (a, b) { return (a.days_until_due || 0) - (b.days_until_due || 0); });
      var down = (res[2].data || []).filter(function (e) {
        return norm(e.location) === key && /^(down|broken|needs_service)$/.test(String(e.status || '').toLowerCase());
      });

      out.lines.push({ kind: 'head', text: cards.length + ' open card' + (cards.length === 1 ? '' : 's') + ' here' + (pms.length ? ' · ' + pms.length + ' PM' + (pms.length === 1 ? '' : 's') + ' due this week' : '') + (down.length ? ' · ' + down.length + ' unit' + (down.length === 1 ? '' : 's') + ' not right' : '') });
      cards.slice(0, 3).forEach(function (c) {
        out.lines.push({ kind: 'card', view: 'board', text: '“' + (c.title || 'Untitled') + '” — ' + ageDays(c.created_at) + 'd old' + ((c.priority || '') === 'urgent' ? ' · URGENT' : '') });
      });
      if (cards.length > 3) out.lines.push({ kind: 'more', view: 'board', text: '+' + (cards.length - 3) + ' more on the board' });
      pms.slice(0, 3).forEach(function (p) {
        out.lines.push({ kind: 'pm', view: 'pm', text: (p.title || p.equipment_name || 'PM') + ' — ' + (p.days_until_due < 0 ? Math.abs(p.days_until_due) + 'd overdue' : p.days_until_due === 0 ? 'due today' : 'in ' + p.days_until_due + 'd') });
      });
      down.slice(0, 3).forEach(function (e) {
        out.lines.push({ kind: 'down', view: 'equipment', text: (e.name || 'Equipment') + ' — ' + String(e.status || '').replace(/_/g, ' ') + (e.status_note ? ' · ' + String(e.status_note).slice(0, 60) : '') });
      });
      if (!cards.length && !pms.length && !down.length) {
        out.lines.push({ kind: 'clear', text: 'Quiet house — nothing open, nothing due this week, everything upright.' });
      }
    } catch (e) {
      out.lines.push({ kind: 'err', text: 'I couldn’t reach the records just now — walk on, I’ll catch up.' });
    }
    return out;
  }

  // Enter a house: MENS answers stay scoped to it until tap-out.
  async function walk(key) {
    var h = houseOf(key);
    if (!h) return null;
    state.house = key;
    window._NX_HOUSE_SCOPE = h.label;
    try { sessionStorage.setItem('nx_buddy_house', key); } catch (_) {}
    return brief(key);
  }

  function out() {
    state.house = null;
    window._NX_HOUSE_SCOPE = null;
    try { sessionStorage.removeItem('nx_buddy_house'); } catch (_) {}
  }

  function current() { return state.house; }

  var api = { HOUSES: HOUSES, walk: walk, out: out, brief: brief, current: current };
  T.buddy = api;
  if (L && L !== W) W.buddy = api;
})();
