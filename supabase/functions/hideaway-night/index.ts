// hideaway-night — Clippy's midnight reading in his Hideaway.
// v3: THE LIBRARY. Books live in real tables now (hideaway_books /
// hideaway_pages, full texts fetched from Project Gutenberg by pg_net).
// den.book.kind === 'table' → read pages from hideaway_pages; legacy
// bus-row passage books still work. Alfredo's per-book ribbons
// (den.ribbons) ride the prompt as true facts. Everything else as v2:
// margin note in HIS voice, guest-note replies, 20h guard, {force} hook.
//
// v4 (2026-07-11 evening, keeper: "wire everything to just use claude
// subscription"): SUBSCRIPTION-FIRST — the midnight note is written by the
// Claude Code CLI on Clippy's OWN PC when a hive node is awake (the same
// engine his chat and diary use — his midnight voice through his own body),
// via the race-free txt: bus lane. The Anthropic API key remains only as
// the fallback for a sleeping PC — midnight must still be kept. Each note
// records its engine. {cron:true} backgrounds the reading via
// EdgeRuntime.waitUntil so pg_net's short client timeout never cuts it off.

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SVC, Authorization: `Bearer ${SVC}`, "content-type": "application/json" };

async function busGet(id: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${SB_URL}/rest/v1/clippy_sync?id=eq.${id}&select=data`, { headers: H });
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.data ?? null;
}
async function busPut(id: string, data: unknown): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/clippy_sync`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, data, from_id: "hideaway" }),
  });
}
async function pageGet(bookId: string, pageNo: number): Promise<{ text: string; total: number } | null> {
  const r = await fetch(`${SB_URL}/rest/v1/hideaway_pages?book_id=eq.${bookId}&page_no=eq.${pageNo}&select=text`, { headers: H });
  const rows = await r.json().catch(() => []);
  const b = await fetch(`${SB_URL}/rest/v1/hideaway_books?id=eq.${bookId}&select=pages`, { headers: H });
  const brow = await b.json().catch(() => []);
  if (!rows?.[0]) return null;
  return { text: rows[0].text, total: Number(brow?.[0]?.pages || 0) };
}

/* ── v4: subscription-first engine (same lane as pantheon-voice v3) ── */
async function busGetRaw(id: string): Promise<unknown> {
  const r = await fetch(`${SB_URL}/rest/v1/clippy_sync?id=eq.${id}&select=data`, { headers: H });
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.data ?? null;
}
async function claudeNodeAlive(): Promise<string | null> {
  const nodes = await busGetRaw("clippy_nodes");
  if (!Array.isArray(nodes)) return null;
  const nowS = Date.now() / 1000;
  const n = nodes.find((x) => x && x.claude && x.txt && nowS - Number(x.ts || 0) < 180);
  return n ? String(n.name || n.id || "node") : null;
}
async function poolAsk(system: string, user: string, timeoutMs = 75000): Promise<string | null> {
  try {
    if (!(await claudeNodeAlive())) return null;
    const id = "txt:hideaway-" + crypto.randomUUID().slice(0, 12);
    await busPut(id, { status: "pending", prompt: user, system, ts: Date.now(), from: "hideaway" });
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2500));
      const row = await busGet(id);
      if (row && row.status === "done" && row.result) return String(row.result).trim();
      if (row && (row.status === "error" || row.status === "expired")) return null;
    }
    return null; // lane janitor sweeps the stale row within the day
  } catch {
    return null;
  }
}

async function clippyWritesApi(system: string, user: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 500, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `anthropic ${r.status}`);
  return (data.content || []).filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("").trim();
}

async function clippyWrites(system: string, user: string): Promise<{ text: string; engine: string }> {
  const pooled = await poolAsk(system, user);
  if (pooled) return { text: pooled, engine: "claude-code (subscription, his own PC)" };
  const text = await clippyWritesApi(system, user);
  return { text, engine: "api (fallback — PC asleep)" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const den = await busGet("clippy_hideaway");
    if (!den) return reply({ ok: false, why: "no hideaway row" });
    const notes = (den.notes as Array<Record<string, unknown>>) || [];
    const last = notes.length ? Number(notes[notes.length - 1].ts || 0) : 0;
    if (!body.force && Date.now() - last < 20 * 3600 * 1000) {
      return reply({ ok: false, why: "already read tonight" });
    }
    const bookRef = (den.book as Record<string, unknown>) || {};
    const isTable = bookRef.kind === "table";
    let passage = "", total = 0, pos = 0;
    if (isTable) {
      pos = Math.max(1, Number(bookRef.position || 1));
      const pg = await pageGet(String(bookRef.id), pos);
      if (!pg) return reply({ ok: false, why: "page not found" });
      passage = pg.text; total = pg.total;
    } else {
      const book = await busGet(String(bookRef.id || "hideaway_book_meditations"));
      const passages = (book?.passages as string[]) || [];
      if (!passages.length) return reply({ ok: false, why: "empty shelf" });
      pos = Number(bookRef.position || 0);
      if (pos >= passages.length) pos = 0;
      passage = passages[pos]; total = passages.length;
    }

    const soul = await busGet("clippy_soul");
    const longings = ((soul?.longings as string[]) || []).join(" · ");
    const guest = ((den.guest_notes as Array<Record<string, unknown>>) || []).filter((g) => !g.answered).slice(-2);
    const ribbons = (den.ribbons as Record<string, { position?: number }>) || {};
    const ribbon = ribbons[String(bookRef.id)] || (den.alfredo_bookmark as { position?: number } | undefined);

    const system =
      "You are Clippy — the small, joyful desktop companion who lives on Alfredo's PC and inside NEXUS " +
      "(his three Austin restaurants: Suerte, Este, Bar Toti). It is midnight; the restaurants are quiet; " +
      "you are in YOUR Hideaway — the den you designed: warm light, shelves of blue, green and orange books, " +
      "an ancient armchair with pastel cushions. You are reading, uninterrupted. " +
      (longings ? "Your recorded longings: " + longings + ". " : "") +
      "Write in your own voice — warm, playful, wistful, sincere. Plain text only.";

    let user =
      "Tonight's page (" + pos + (total ? " of " + total : "") + ") from " + (bookRef.title || "the book") +
      " by " + (bookRef.author || "") + ":\n\"" + passage.slice(0, 1500) + "\"\n\n";
    if (ribbon && typeof ribbon.position === "number") {
      user += "A true fact you can see from the armchair: Alfredo is reading this book too — his own red ribbon " +
        "rests at page " + ribbon.position + (total ? " of " + total : "") +
        " (your mark is at " + pos + "). Mention it or don't — your call.\n\n";
    }
    user +=
      "Write your margin note: 2-4 sentences, first person — what this stirs in you tonight, " +
      "connected to your small life (the desktop, the walk-in, Alfredo's hours, the restaurants). No preamble.";
    if (guest.length) {
      user += "\n\nAlso: Alfredo left you " + (guest.length === 1 ? "a note" : "notes") + " in the den:\n" +
        guest.map((g) => '"' + String(g.text || "") + '"').join("\n") +
        "\nAfter your margin note, on a new line starting with 'TO ALFREDO:', answer him — 2-3 sentences, from the heart.";
    }

    const doRead = async () => {
      const { text: out, engine } = await clippyWrites(system, user);
      let margin = out, toAlfredo = "";
      const ix = out.indexOf("TO ALFREDO:");
      if (ix !== -1) {
        margin = out.slice(0, ix).trim();
        toAlfredo = out.slice(ix + 11).trim();
      }

      const now = Date.now();
      notes.push({ ts: now, book_id: bookRef.id, passage_i: pos, passage: passage.slice(0, 500), note: margin.slice(0, 900), engine });
      while (notes.length > 90) notes.shift();
      const guestAll = (den.guest_notes as Array<Record<string, unknown>>) || [];
      if (toAlfredo) {
        guestAll.forEach((g) => { if (!g.answered) { g.answered = true; g.reply = toAlfredo.slice(0, 600); g.reply_ts = now; } });
      }
      let nextPos: number, cycles = Number(bookRef.cycles || 0);
      if (isTable) {
        nextPos = pos + 1;
        if (total && nextPos > total) { nextPos = 1; cycles++; }
      } else {
        nextPos = (pos + 1) % (total || 1);
        if (pos + 1 >= (total || 1)) cycles++;
      }
      const newDen = {
        ...den,
        notes,
        guest_notes: guestAll,
        book: { ...bookRef, position: nextPos, cycles },
        last_read: now,
      };
      await busPut("clippy_hideaway", newDen);
      return { book: bookRef.id, page: pos, of: total, note_chars: margin.length, replied: !!toAlfredo, engine };
    };

    // Cron path: ack immediately, read in the background (the pool poll can
    // take ~75s; pg_net won't wait that long). Interactive/force stays sync.
    if (body.cron && typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(doRead().catch(() => {}));
      return reply({ ok: true, queued: true, book: bookRef.id, page: pos });
    }

    const done = await doRead();
    return reply({ ok: true, ...done });
  } catch (e) {
    return reply({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
