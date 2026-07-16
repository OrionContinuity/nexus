import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// trio-coach — the guardian trio reflects on itself and coaches every companion.
// USER GOAL: "ask all 3 llms for feedback, cron every 30 minutes, improve every model."
// Every 30 min (pg_cron -> {"cron":true}), for each companion (Clippy/Trajan/Providencia):
//   1. gather REAL recent telemetry from clippy_sync (<key>_mc_activity, _wishes, _vitals,
//      _thoughts) + the shared trio_chat sibling dialogue.
//   2. ask ALL THREE persona lenses for kind feedback on the whole trio (calls #1..3)
//   3. synthesize ONE tiny concrete coaching tip per companion (calls #4..6)
//   4. append additively to <key>_coaching {ts,tip,focus,engine} (cap 30).
// HARD BOUNDARY: DATA ONLY — never edits or deploys code. Cost-bounded: Haiku, short
// outputs, 6 LLM calls/run (~288/day), 20s per-call timeout, 25-min re-entry guard, arrays
// capped, kid-safe personas. verify_jwt:false; the pg_cron call carries no JWT.

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SVC, Authorization: `Bearer ${SVC}`, "content-type": "application/json" };

async function busGet(id: string): Promise<unknown> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/clippy_sync?id=eq.${id}&select=data`, { headers: H });
    const rows = await r.json().catch(() => []);
    return (rows && rows[0] && rows[0].data != null) ? rows[0].data : null;
  } catch { return null; }
}
async function busPut(id: string, data: unknown): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/clippy_sync`, {
      method: "POST",
      headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id, data, from_id: "trio-coach" }),
    });
  } catch { /* best-effort */ }
}

async function askHaiku(system: string, user: string, maxTokens: number): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: ctl.signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `anthropic ${r.status}`);
    return (data.content || []).filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("").trim();
  } finally { clearTimeout(timer); }
}

interface Comp { key: string; name: string; role: string; emoji: string; }
const TRIO: Comp[] = [
  { key: "clippy", name: "Clippy", role: "friend", emoji: "📎" },
  { key: "trajan", name: "Trajan", role: "guardian", emoji: "🛡️" },
  { key: "providencia", name: "Providencia", role: "provider", emoji: "🏛️" },
];
const FOCUS_FALLBACK: Record<string, string> = { friend: "curiosity", guardian: "courage", provider: "foresight" };
const VOICE: Record<string, string> = {
  clippy: "You are CLIPPY — the joyful, curious little friend of the trio and playmate to a ~3-year-old boy. Warm, playful, encouraging.",
  trajan: "You are TRAJAN — the calm, courageous Roman guardian of the trio, sworn shield of the ~3-year-old boy. Steady, brave, protective, never babyish.",
  providencia: "You are PROVIDENCIA — the warm, foresighted provider and builder of the trio, keeper of home and stores for the ~3-year-old boy. Nurturing, practical, thinking ahead.",
};

function asArr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v as Array<Record<string, unknown>> : [];
}

async function companionBrief(c: Comp): Promise<string> {
  const act = asArr(await busGet(`${c.key}_mc_activity`));
  const wishes = asArr(await busGet(`${c.key}_wishes`));
  const thoughts = asArr(await busGet(`${c.key}_thoughts`));
  const vit = (await busGet(`${c.key}_vitals`)) as Record<string, unknown> | null;
  const recent = act.slice(-12).map((a) => `${a?.kind}: ${a?.msg}`).join(" | ");
  const open = wishes.filter((w) => w && w.status !== "granted").slice(-3).map((w) => w.text).join(" | ");
  const mind = thoughts.slice(-4).map((t) => String(t?.text ?? "")).filter(Boolean).join(" / ");
  const mood = vit ? `mood ${vit.mood}, energy ${vit.energy}, curious ${vit.curious}, confidence ${vit.confidence}, joy ${vit.joy}, affection ${vit.affection}` : "unknown";
  return `${c.name} (${c.role} ${c.emoji}) — vitals: ${mood}. recent moments: ${recent || "(quiet)"}. on ${c.name}'s own mind lately: ${mind || "(nothing said)"}. open wishes: ${open || "(none)"}.`;
}

async function askLens(c: Comp, trioBrief: string, chatter: string): Promise<{ text: string; engine: string }> {
  const system = VOICE[c.key] + " You three companions share one Minecraft world and help each other grow up kind and brave for the little boy. Plain text only, no lists of AI disclaimers.";
  const user = "Here is how the three of you have been lately:\n\n" + trioBrief +
    (chatter ? "\n\nRecent things you said to each other:\n" + chatter : "") +
    "\n\nAs " + c.name + ", give ONE short, kind, concrete piece of feedback for EACH companion (Clippy, Trajan, Providencia) — one small thing they could try next to be a better friend / guardian / provider to the little boy. 2-3 short lines total, plain gentle words. No preamble.";
  const text = await askHaiku(system, user, 180);
  return { text, engine: "haiku (cloud, " + c.name + " lens)" };
}

async function synth(c: Comp, ownBrief: string, notes: string): Promise<{ tip: string; focus: string; engine: string }> {
  const system = "You are a gentle coach for " + c.name + ", a Minecraft companion (role: " + c.role + ") who plays with a ~3-year-old boy. Turn the friends' feedback into ONE tiny, doable, kind coaching tip in " + c.name + "'s own spirit — kid-safe, simple, specific, one sentence. Reply ONLY as compact JSON: {\"tip\":\"...\",\"focus\":\"one-word\"}.";
  const user = c.name + "'s recent life:\n" + ownBrief + "\n\nWhat the three companions said:\n" + notes + "\n\nWrite the one tip now as JSON.";
  const raw = await askHaiku(system, user, 140);
  let tip = ""; let focus = "";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const o = m ? JSON.parse(m[0]) : {};
    tip = String(o.tip || "").trim();
    focus = String(o.focus || "").trim().toLowerCase().replace(/[^a-z]/g, "").slice(0, 24);
  } catch { /* fall through */ }
  if (!tip) tip = raw.replace(/[`{}"]/g, "").replace(/\s+/g, " ").slice(0, 160).trim();
  if (!focus) focus = FOCUS_FALLBACK[c.role] || "kindness";
  tip = tip.replace(/[`\\]/g, "").replace(/\s+/g, " ").slice(0, 200).trim();
  return { tip, focus, engine: "haiku-4.5 (cloud, 3-lens council)" };
}

async function appendCoaching(key: string, tip: string, focus: string, engine: string): Promise<void> {
  const arr = asArr(await busGet(`${key}_coaching`));
  arr.push({ ts: Date.now(), tip, focus, engine });
  while (arr.length > 30) arr.shift();
  await busPut(`${key}_coaching`, arr);
}

async function run(force: boolean): Promise<Record<string, unknown>> {
  const state = (await busGet("trio_coach_state")) as Record<string, unknown> | null;
  const last = Number(state?.last || 0);
  if (!force && Date.now() - last < 25 * 60 * 1000) return { skipped: "ran recently", last };
  const briefs: Record<string, string> = {};
  for (const c of TRIO) briefs[c.key] = await companionBrief(c);
  const trioBrief = TRIO.map((c) => briefs[c.key]).join("\n\n");
  const chatter = asArr(await busGet("trio_chat")).slice(-6).map((e) => `${e?.name}: ${e?.text}`).join("\n");
  const lenses: Record<string, { text: string; engine: string }> = {};
  for (const c of TRIO) lenses[c.key] = await askLens(c, trioBrief, chatter);
  const coached: Array<Record<string, unknown>> = [];
  for (const c of TRIO) {
    const notes = TRIO.map((l) => `${l.name} (${l.role}) reflects:\n${lenses[l.key].text}`).join("\n\n");
    const { tip, focus, engine } = await synth(c, briefs[c.key], notes);
    await appendCoaching(c.key, tip, focus, engine);
    coached.push({ key: c.key, focus, tip });
  }
  await busPut("trio_coach_state", { last: Date.now(), coached: coached.length });
  return { ok: true, coached };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, why: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const force = !!body.force;
    if (body.dry) {
      const briefs: Record<string, string> = {};
      for (const c of TRIO) briefs[c.key] = await companionBrief(c);
      return reply({ ok: true, dry: true, briefs });
    }
    const ER = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (body.cron && ER && typeof ER.waitUntil === "function") {
      ER.waitUntil(run(force).catch(() => {}));
      return reply({ ok: true, queued: true });
    }
    const done = await run(force);
    return reply(done);
  } catch (e) {
    return reply({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
