// clippy-pool - fans a NEXUS request out across the live Clippy node pool.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIPPY_TOKEN = Deno.env.get("CLIPPY_TOKEN") ?? "";
const NODE_TIMEOUT_MS = 60_000;
const STALE_SECONDS   = 120;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function getNodes(): Promise<Array<{ id: string; url: string; ts?: number }>> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/clippy_sync?id=eq.clippy_nodes&select=data`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return [];
  const rows = await r.json();
  const data: any[] = Array.isArray(rows) && rows[0]?.data ? rows[0].data : [];
  const now = Date.now() / 1000;
  return data
    .filter((n) => n?.url && now - (n.ts ?? 0) < STALE_SECONDS)
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
}

async function callNode(node: any, body: unknown, vision: boolean): Promise<{ reply: string; node: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NODE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CLIPPY_TOKEN) headers["X-Clippy-Token"] = CLIPPY_TOKEN;
    const r = await fetch(`${node.url}/${vision ? "vision" : "ask"}`, {
      method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`${node.id} -> HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(`${node.id} -> ${j.error}`);
    return { reply: j.reply ?? "", node: node.id };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")   return json({ error: "POST only" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { prompt, system, image_b64, mode = "fastest" } = payload ?? {};
  if (!prompt) return json({ error: "missing 'prompt'" }, 400);

  const nodes = await getNodes();
  if (!nodes.length) return json({ error: "no Clippy nodes online" }, 503);

  const vision = !!image_b64;
  const body = vision ? { prompt, image_b64 } : { prompt, system };

  try {
    if (mode === "spread") {
      const i = Math.floor(Math.random() * nodes.length);
      try { return json(await callNode(nodes[i], body, vision)); } catch { /* fall through */ }
      const rest = nodes.filter((_, j) => j !== i);
      if (!rest.length) return json({ error: "the only node failed" }, 502);
      return json(await Promise.any(rest.map((n) => callNode(n, body, vision))));
    }
    return json(await Promise.any(nodes.map((n) => callNode(n, body, vision))));
  } catch (e) {
    const msg = e instanceof AggregateError ? "every node failed or timed out"
              : e instanceof Error ? e.message : String(e);
    return json({ error: `clippy-pool: ${msg}` }, 502);
  }
});
