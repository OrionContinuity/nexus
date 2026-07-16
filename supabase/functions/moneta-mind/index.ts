// MONETA MIND — semantic memory for the NEXUS galaxy.
// gte-small transformer runs INSIDE the edge runtime (Supabase.ai) —
// no external API, no key. Ops:
//   {op:'recall', query, k?, min_similarity?, category?} → nearest nodes by meaning
//   {op:'embed', id}                                     → (re)embed one node
//   {op:'backfill', limit?}                              → embed nodes missing vectors
// verify_jwt is off to match sibling functions (clippy-brain, chat); the
// service key never leaves this process and callers can only read what the
// anon role could already read from `nodes`.
import { createClient } from "jsr:@supabase/supabase-js@2";

const session = new Supabase.ai.Session("gte-small");
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// What a node "means": name + category + tags + the head of its notes.
// gte-small reads ~512 tokens (~1500-2000 chars) — anything longer is
// truncated by the tokenizer anyway, and shorter input keeps each
// inference inside the edge worker's per-request compute budget
// (4000-char texts tripped WORKER_RESOURCE_LIMIT on batch calls).
function textOf(n: { name?: string; category?: string; tags?: unknown; notes?: string }): string {
  const tags = Array.isArray(n.tags) ? (n.tags as unknown[]).join(" ") : "";
  return [n.name || "", n.category || "", tags, (n.notes || "").slice(0, 1500)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);
}

async function embed(text: string): Promise<number[]> {
  const v = (await session.run(text, { mean_pool: true, normalize: true })) as number[];
  return Array.from(v);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const op = body.op || "recall";

    if (op === "recall") {
      const q = String(body.query || "").slice(0, 2000).trim();
      if (!q) return json({ error: "query required" }, 400);
      const qe = await embed(q);
      const { data, error } = await sb.rpc("match_nodes", {
        query_embedding: qe,
        match_count: Math.min(Number(body.k) || 8, 30),
        min_similarity: typeof body.min_similarity === "number" ? body.min_similarity : 0.15,
        category_filter: body.category || null,
      });
      if (error) throw error;
      // Trim notes so recall payloads stay light for phones
      const matches = (data || []).map((m: Record<string, unknown>) => ({
        ...m,
        notes: String(m.notes || "").slice(0, 700),
      }));
      return json({ matches });
    }

    if (op === "embed") {
      const { data: n, error } = await sb
        .from("nodes")
        .select("id,name,category,tags,notes")
        .eq("id", body.id)
        .single();
      if (error) throw error;
      const e = await embed(textOf(n));
      const { error: upErr } = await sb
        .from("nodes")
        .update({ embedding: e, embedded_at: new Date().toISOString() })
        .eq("id", n.id);
      if (upErr) throw upErr;
      return json({ embedded: n.id });
    }

    if (op === "backfill") {
      const limit = Math.min(Number(body.limit) || 3, 10);
      const { data: rows, error } = await sb
        .from("nodes")
        .select("id,name,category,tags,notes")
        .is("embedding", null)
        .limit(limit);
      if (error) throw error;
      let done = 0;
      for (const n of rows || []) {
        const e = await embed(textOf(n));
        const { error: upErr } = await sb
          .from("nodes")
          .update({ embedding: e, embedded_at: new Date().toISOString() })
          .eq("id", n.id);
        if (!upErr) done++;
      }
      const { count } = await sb
        .from("nodes")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);
      return json({ embedded: done, remaining: count ?? 0 });
    }

    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
