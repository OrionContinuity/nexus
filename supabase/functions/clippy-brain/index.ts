import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// clippy-brain — Clippy's server-side LLM voice. Holds ANTHROPIC_API_KEY in
// this project's Edge secrets so the browser NEVER needs the key. Two callers:
//   1. the cloud heartbeat (clippy-cloud.py) POSTs {system,user,max_tokens}
//   2. the NEXUS app, as the cloud FALLBACK when the local PC pool is asleep,
//      for BOTH chat (text) and Scan Plate (vision: {image_b64, mime}).
// Returns {text} on success, {text:null,...} on any problem so callers degrade
// gracefully. verify_jwt OFF: callers hold only the PUBLIC publishable key, not
// a JWT; abuse is bounded by the throttle below and the key never leaves here.

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ text: null, error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return reply({ text: null, mind: "offline", why: "no ANTHROPIC_API_KEY in edge secrets" });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const user = String(body.user ?? body.prompt ?? "");
  const imageB64 = body.image_b64 ? String(body.image_b64) : "";
  if (!user && !imageB64) return reply({ text: null, why: "no prompt" });
  const system = String(body.system ?? "");
  // Chat/summaries need room; vision nameplates too. Cap keeps the bill sane.
  const maxTokens = Math.min(1024, Math.max(16, parseInt(String(body.max_tokens ?? "512"), 10) || 512));
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";

  // Light global throttle so a public endpoint can't run up the Anthropic bill.
  // Vision calls are exempt (rare, user-initiated Scan Plate) so a plate scan
  // never bounces off a chat that fired 1s earlier. Best-effort; never blocks.
  if (!imageB64) {
    try {
      const sbUrl = Deno.env.get("SUPABASE_URL");
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (sbUrl && svc) {
        const h: Record<string, string> = { apikey: svc, Authorization: `Bearer ${svc}`, "content-type": "application/json" };
        const g = await fetch(`${sbUrl}/rest/v1/clippy_sync?id=eq.clippy_brain_gate&select=data`, { headers: h });
        const rows = await g.json().catch(() => []);
        const last = Number(rows?.[0]?.data?.ts ?? 0);
        const now = Date.now();
        if (now - last < 1200) return reply({ text: null, mind: "throttled" });
        await fetch(`${sbUrl}/rest/v1/clippy_sync`, {
          method: "POST",
          headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id: "clippy_brain_gate", data: { ts: now }, from_id: "brain" }),
        });
      }
    } catch { /* throttle is best-effort */ }
  }

  try {
    // Build the user content — a plain string, or an image + text block for vision.
    let content: unknown = user;
    if (imageB64) {
      const mime = String(body.mime ?? "image/jpeg");
      content = [
        { type: "image", source: { type: "base64", media_type: mime, data: imageB64 } },
        { type: "text", text: user || "Read this equipment data plate and return the fields." },
      ];
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
    const data = await r.json();
    if (!r.ok) return reply({ text: null, error: data?.error?.message || `anthropic ${r.status}` });
    const text = (data.content || []).filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("").trim();
    return reply({ text: text || null, mind: "llm", model });
  } catch (e) {
    return reply({ text: null, error: String(e) });
  }
});
