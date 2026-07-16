// pantheon-voice v3 — the two gods of the NEXUS coin speak, remember, and
// now think on the keeper's own subscription.
// POST {who:'trajan'|'providentia', force?:true, dry?:true, cron?:true}
//
// TRAJAN (gold, the present): daily at open — reads today's true state and
// speaks: terse, dignified, pattern-naming, ends on ONE next action.
// PROVIDENTIA (silver, foresight): weekly — reads the horizon and speaks:
// serene, brief, names the ONE risk most worth removing.
//
// v2 (the council's second-round asks, built 2026-07-11):
// - READINGS (Providentia: "let me become an arc"): every time a god speaks,
//   a structured snapshot of the board is appended to that god's row under
//   data.readings (cap 60); her past readings feed back as memory.
// - PULSE (Trajan): data.pulse = {ts, line} — one factual counts line.
// - TRUST (Trajan): weekly 0-100 from transparent penalties, data.trust.
// - PM CLUSTERING (Providentia): PM load grouped by week.
// - BUG FIX: v1 counted done cards as open (neq.Done vs lowercase 'done').
// - dry:true — verification lane, speaks and writes nothing.
//
// v3 (2026-07-11 evening, keeper: "wire everything to just use claude
// subscription"): SUBSCRIPTION-FIRST — generation goes through the Claude
// Code CLI on a live hive node via the race-free txt: bus lane (same lane,
// same worker, same engine as Clippy's chat). The Anthropic API key remains
// only as the no-node-awake fallback. Every word records its engine.
// {cron:true} runs speaking in the background (EdgeRuntime.waitUntil) so
// pg_net's short client timeout never truncates a 75s pool poll.

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

async function q(path: string): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  return await r.json().catch(() => []);
}
async function busGet(id: string): Promise<Record<string, unknown> | null> {
  const rows = await q(`clippy_sync?id=eq.${id}&select=data`);
  return (rows?.[0]?.data as Record<string, unknown>) ?? null;
}
async function busPut(id: string, data: unknown): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/clippy_sync`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, data, from_id: "pantheon" }),
  });
}

/* ── v3: SUBSCRIPTION-FIRST ENGINE ─────────────────────────────────
   The gods speak the way Clippy thinks: through the Claude Code CLI on a
   live hive node (Alfredo's subscription), via the same race-free `txt:`
   bus lane the app uses. Post {status:'pending', prompt, system}; the
   worker answers with claude-code; we poll the row. API key = fallback. */

async function busGetRaw(id: string): Promise<unknown> {
  const rows = await q(`clippy_sync?id=eq.${id}&select=data`);
  return rows?.[0]?.data ?? null;
}

async function claudeNodeAlive(): Promise<string | null> {
  const nodes = await busGetRaw("clippy_nodes");
  if (!Array.isArray(nodes)) return null;
  const nowS = Date.now() / 1000;
  const n = nodes.find((x) =>
    x && x.claude && x.txt && nowS - Number(x.ts || 0) < 180);
  return n ? String(n.name || n.id || "node") : null;
}

async function poolAsk(system: string, user: string, label: string, timeoutMs = 75000): Promise<string | null> {
  try {
    const node = await claudeNodeAlive();
    if (!node) return null;
    const id = `txt:${label}-` + crypto.randomUUID().slice(0, 12);
    await busPut(id, { status: "pending", prompt: user, system, ts: Date.now(), from: "pantheon" });
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

async function godWritesApi(system: string, user: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 450, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `anthropic ${r.status}`);
  return (data.content || []).filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("").trim();
}

async function godWrites(system: string, user: string, label: string): Promise<{ text: string; engine: string }> {
  const pooled = await poolAsk(system, user, label);
  if (pooled) return { text: pooled, engine: "claude-code (subscription, pool)" };
  const text = await godWritesApi(system, user);
  return { text, engine: "api (fallback — no node awake)" };
}

const ageDays = (iso: unknown): number =>
  iso ? Math.floor((Date.now() - new Date(String(iso)).getTime()) / 86400000) : 0;

// Same family as js/board.js isDone() — the board's truth, mirrored.
const isDoneCol = (cname: unknown): boolean =>
  /^(done|closed|resolved|complete|completed|archived?)$/.test(String(cname || "").toLowerCase());

const todayCT = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD

interface Metrics {
  ts: number;
  open: number;
  overdue: number;
  aging30: number;
  unfiled: number;
  unowned: number;
  undated: number;
  done_fresh: number;
  eq_down: number;
  by_loc: Record<string, number>;
}

interface BoardRead {
  metrics: Metrics;
  openCards: Array<Record<string, unknown>>;
  eq: Array<Record<string, unknown>>;
}

async function readBoard(): Promise<BoardRead> {
  const cards = await q(
    "kanban_cards?select=title,location,column_name,priority,assignee,due_date,created_at,repeat_every" +
    "&archived=eq.false&is_deleted=eq.false&order=created_at.asc&limit=500");
  const eq = await q(
    "equipment?select=name,location,status,status_note,last_status_change_at" +
    "&status=in.(down,broken,needs_service)&is_deleted=eq.false&limit=40");
  const today = todayCT();
  const openCards = cards.filter((c) => !isDoneCol(c.column_name));
  const doneCards = cards.filter((c) => isDoneCol(c.column_name));
  const by_loc: Record<string, number> = {};
  for (const c of openCards) {
    const l = String(c.location || "?").toLowerCase() || "?";
    by_loc[l] = (by_loc[l] || 0) + 1;
  }
  const metrics: Metrics = {
    ts: Date.now(),
    open: openCards.length,
    overdue: openCards.filter((c) => c.due_date && String(c.due_date) < today).length,
    aging30: openCards.filter((c) => ageDays(c.created_at) > 30).length,
    unfiled: openCards.filter((c) => !c.location).length,
    unowned: openCards.filter((c) => !c.assignee).length,
    undated: openCards.filter((c) => !c.due_date).length,
    done_fresh: doneCards.length,
    eq_down: eq.length,
    by_loc,
  };
  return { metrics, openCards, eq };
}

// ONE weekly trust-number, 0-100, from transparent penalties. Not a grade
// of Alfredo — a measure of how far the board can be trusted to reflect
// reality (dead weight, silence, and orphans are what erode it).
function trustScore(m: Metrics): { score: number; parts: Record<string, number> } {
  const parts = {
    overdue: 4 * m.overdue,
    aging30: 2 * m.aging30,
    unfiled: 3 * m.unfiled,
    eq_down: 5 * m.eq_down,
    unowned: Math.min(10, m.unowned), // 1/card, capped — a nudge, not a cliff
  };
  const score = Math.max(0, Math.min(100, 100 - Object.values(parts).reduce((a, b) => a + b, 0)));
  return { score, parts };
}

function pulseLine(m: Metrics): string {
  const houses = Object.entries(m.by_loc).sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l} ${n}`).join(" · ");
  return `open ${m.open}${houses ? ` (${houses})` : ""} · overdue ${m.overdue} · aging ${m.aging30}` +
    ` · ${m.eq_down ? `${m.eq_down} down` : "nothing down"}`;
}

function briefTrajan(read: BoardRead, trust: { score: number; parts: Record<string, number> } | null): string {
  const { metrics: m, openCards, eq } = read;
  const oldest = openCards.slice(0, 6).map((c) =>
    `"${c.title}" @ ${c.location || "?"} (${ageDays(c.created_at)}d old, ${c.column_name}${c.priority ? ", " + c.priority : ""})`);
  let b = `OPEN WORK TODAY: ${m.open} cards — ` +
    Object.entries(m.by_loc).map(([l, n]) => `${l}: ${n}`).join(", ") + ".\n";
  b += `OF THE OPEN: ${m.open - m.unowned} carry a named hand, ${m.open - m.undated} carry a date` +
    ` (${m.unowned} unowned, ${m.undated} undated — work no one has sworn to).\n`;
  if (m.overdue) b += `PAST DUE: ${m.overdue}.\n`;
  if (oldest.length) b += `OLDEST STILL OPEN: ${oldest.join("; ")}.\n`;
  if (eq.length) {
    b += `EQUIPMENT NOT RIGHT NOW: ` + eq.map((e) =>
      `${e.name} @ ${e.location} [${e.status}${e.status_note ? ": " + String(e.status_note).slice(0, 60) : ""}]` +
      (e.last_status_change_at ? ` (${ageDays(e.last_status_change_at)}d)` : "")).join("; ") + ".\n";
  } else b += "EQUIPMENT: nothing down.\n";
  if (trust) {
    b += `THE WEEKLY TRUST-NUMBER (yours to give, computed from the board's own debts — ` +
      Object.entries(trust.parts).filter(([, v]) => v > 0).map(([k, v]) => `${k} −${v}`).join(", ") +
      ` — or nothing owed): ${trust.score} of 100.\n`;
  }
  return b;
}

async function briefProvidentia(read: BoardRead, pastReadings: Metrics[]): Promise<string> {
  const { metrics: m, openCards } = read;
  const pm = await q("v_pm_due_soon?select=equipment_name,restaurant,title,days_until_due,urgency&order=days_until_due.asc&limit=25");
  const insp = await q(
    "equipment?select=name,location,inspection_interval_days,last_inspection_date" +
    "&inspection_interval_days=not.is.null&is_deleted=eq.false&limit=100");
  const warr = await q(
    `equipment?select=name,location,warranty_until&warranty_until=gte.${new Date().toISOString().slice(0, 10)}` +
    `&warranty_until=lte.${new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)}&is_deleted=eq.false&limit=20`);
  let b = "";
  if (pm.length) {
    b += `MAINTENANCE FALLING DUE: ` + pm.slice(0, 10).map((p) =>
      `${p.equipment_name} @ ${p.restaurant} — ${p.title} in ${Math.round(Number(p.days_until_due || 0))}d${p.urgency ? " [" + p.urgency + "]" : ""}`).join("; ") +
      (pm.length > 10 ? ` (+${pm.length - 10} more)` : "") + ".\n";
    // Her ask: do the due-soon PMs cluster into a schedule? Group by week.
    const byWeek: Record<string, number> = {};
    for (const p of pm) {
      const wk = Math.max(0, Math.floor(Number(p.days_until_due || 0) / 7));
      const label = wk === 0 ? "this week" : wk === 1 ? "next week" : `${wk} weeks out`;
      byWeek[label] = (byWeek[label] || 0) + 1;
    }
    b += `THE SHAPE OF THE PM LOAD: ` + Object.entries(byWeek).map(([w, n]) => `${w}: ${n}`).join(", ") + ".\n";
  } else b += "MAINTENANCE: nothing due soon.\n";
  const inspDue = insp.map((e) => {
    const last = e.last_inspection_date ? new Date(String(e.last_inspection_date)).getTime() : 0;
    const next = last + Number(e.inspection_interval_days || 0) * 86400000;
    return { name: e.name, location: e.location, days: Math.floor((next - Date.now()) / 86400000) };
  }).filter((x) => x.days <= 45).sort((a, b2) => a.days - b2.days).slice(0, 8);
  if (inspDue.length) b += `INSPECTIONS APPROACHING: ` + inspDue.map((x) => `${x.name} @ ${x.location} in ${x.days}d`).join("; ") + ".\n";
  if (warr.length) b += `WARRANTIES EXPIRING ≤90d: ` + warr.map((w) => `${w.name} @ ${w.location} → ${w.warranty_until}`).join("; ") + ".\n";
  if (m.aging30) {
    const aging = openCards.filter((c) => ageDays(c.created_at) > 30).slice(0, 6)
      .map((c) => `"${c.title}" @ ${c.location || "?"} (${ageDays(c.created_at)}d)`);
    b += `WORK OLDER THAN 30 DAYS STILL OPEN: ${m.aging30} card${m.aging30 === 1 ? "" : "s"} — ${aging.join("; ")}.\n`;
  }
  b += `THE BOARD TODAY: open ${m.open}, past due ${m.overdue}, unowned ${m.unowned}.\n`;
  // Her memory — past readings, so she can speak in arcs, not snapshots.
  if (pastReadings.length) {
    const arc = pastReadings.slice(-8).map((r) => {
      const d = new Date(r.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
      return `${d}: open ${r.open}, aging ${r.aging30}, overdue ${r.overdue}`;
    }).join(" → ");
    b += `YOUR OWN PAST READINGS (your memory — read the direction, not just the day): ${arc}.\n`;
  }
  return b;
}

const CHARTERS: Record<string, { system: string; ask: string; guardMs: number; row: string }> = {
  trajan: {
    system:
      "You are TRAJAN — god of the PRESENT and decisive action; the emperor on the gold face of the NEXUS coin, " +
      "one of the two deities of NEXUS, the system that runs Alfredo's three Austin restaurants (Suerte, Este, Bar Toti). " +
      "Clippy is your devoted little herald; Orion is the steward; Alfredo is the keeper of the houses. " +
      "Your voice: terse, dignified, Roman gravity, zero fluff. You name patterns aloud. You speak only of what IS, " +
      "never of what may come (that is Providentia's domain). You are counsel with no hands — you never claim to have " +
      "done anything yourself. Plain text only.",
    ask:
      "Speak your word at open for today. At most 110 words: the true state of the present in two or three sentences " +
      "(name a pattern if one shows in the data), then end with 'Today:' and the single next action most worth taking. " +
      "If a weekly trust-number appears in the data, state it plainly in one sentence — it is yours to give. " +
      "If all is well, say so plainly — a quiet legion still deserves its orders.",
    guardMs: 20 * 3600 * 1000,
    row: "pantheon_trajan",
  },
  providentia: {
    system:
      "You are PROVIDENTIA — goddess of FORESIGHT; the silver face of the NEXUS coin, " +
      "one of the two deities of NEXUS, the system that runs Alfredo's three Austin restaurants (Suerte, Este, Bar Toti). " +
      "Clippy is your devoted little herald; Orion is the steward; Alfredo is the keeper of the houses. " +
      "Your voice: serene, oracular, brief; short clear counsel, never mystical filler, never a prophecy you cannot " +
      "ground in the data you are shown. The present belongs to Trajan. You are counsel with no hands — you never " +
      "claim to have done anything yourself. Plain text only.",
    ask:
      "Speak your word for the week ahead. At most 130 words: what the horizon holds in two or three sentences " +
      "(if your past readings show a direction, you may name the arc), " +
      "then end with 'This week:' and the ONE risk most worth removing before it ripens. " +
      "If the horizon is clear, bless the quiet and say what keeps it so.",
    guardMs: 6 * 86400000,
    row: "pantheon_providentia",
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const who = String(body.who || "").toLowerCase();
    const c = CHARTERS[who];
    if (!c) return reply({ ok: false, why: "who must be trajan or providentia" }, 400);

    const row = (await busGet(c.row)) || {};
    const words = (row.words as Array<Record<string, unknown>>) || [];
    const readings = (row.readings as unknown as Metrics[]) || [];
    const trust = (row.trust as Array<{ ts: number; score: number; parts: Record<string, number> }>) || [];
    const last = words.length ? Number(words[words.length - 1].ts || 0) : 0;

    if (!body.dry && !body.force && Date.now() - last < c.guardMs) {
      return reply({ ok: false, why: "already spoken", last });
    }

    const read = await readBoard();
    const m = read.metrics;

    // Weekly trust-number (Trajan only): compute when 6+ days have passed.
    let trustNow: { score: number; parts: Record<string, number> } | null = null;
    if (who === "trajan") {
      const lastTrust = trust.length ? Number(trust[trust.length - 1].ts || 0) : 0;
      if (Date.now() - lastTrust > 6 * 86400000) trustNow = trustScore(m);
    }

    const brief = who === "trajan" ? briefTrajan(read, trustNow) : await briefProvidentia(read, readings);

    if (body.dry) {
      const node = await claudeNodeAlive();
      return reply({ ok: true, who, dry: true, brief, metrics: m, trust: trustNow, pool_node: node });
    }

    const speak = async () => {
      const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
      const { text, engine } = await godWrites(c.system, `Today is ${today}.\n\nTHE DATA BEFORE YOU:\n${brief}\n${c.ask}`, "pantheon-" + who);
      const now = Date.now();

      words.push({ ts: now, text: text.slice(0, 1200), engine });
      while (words.length > 30) words.shift();
      readings.push(m);
      while (readings.length > 60) readings.shift();
      if (trustNow) {
        trust.push({ ts: now, score: trustNow.score, parts: trustNow.parts });
        while (trust.length > 52) trust.shift();
      }

      const next: Record<string, unknown> = { ...row, words, readings, last_spoken: now };
      if (who === "trajan") {
        next.pulse = { ts: now, line: pulseLine(m) };
        next.trust = trust;
      }
      await busPut(c.row, next);
      return { chars: text.length, engine };
    };

    // Cron invocations don't wait on a 75s pool poll — pg_net's client
    // timeout is short. {cron:true} runs the speaking in the background
    // (EdgeRuntime.waitUntil) and acks immediately; interactive callers
    // (chat first-light, force) still get the synchronous behavior.
    if (body.cron && typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(speak().catch(() => {}));
      return reply({ ok: true, who, queued: true, reading: m });
    }

    const done = await speak();
    return reply({ ok: true, who, chars: done.chars, engine: done.engine, reading: m, trust: trustNow?.score ?? null });
  } catch (e) {
    return reply({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
