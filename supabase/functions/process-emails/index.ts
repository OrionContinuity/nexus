// NEXUS Process Emails v2 — with attachment handling + fixed urgent detection
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URGENT_PATTERNS = [
  { re: /health\s*(?:dept|department|inspector|inspection|violation)/i, label: "🏥 Health Dept" },
  { re: /equipment\s*(?:failure|down|broken|not\s*working|malfunction)/i, label: "🔧 Equipment Down" },
  { re: /\b(?:water\s*leak|flood|water\s*damage|burst\s*pipe)\b/i, label: "💧 Water/Leak" },
  { re: /\b(?:fire\s*(?:alarm|damage|hazard)|smoke\s*(?:alarm|damage))\b/i, label: "🔥 Fire/Safety" },
  { re: /\b(?:pest\s*(?:control|issue|problem|inspection|treatment|infestation)|cockroach|rodent|mice\b|mouse\s*trap|rat\s*trap)\b/i, label: "🐛 Pest Issue" },
  { re: /\b(?:price\s*increase|rate\s*(?:increase|change)|cost\s*increase)\b/i, label: "💰 Price Change" },
  { re: /\b(?:urgent|emergency|asap|immediately|critical)\b/i, label: "🚨 Urgent" },
];

const JUNK_FROM = [/unsubscribe@/i, /newsletter@/i, /marketing@/i, /mailer-daemon/i, /donotreply@/i];
const JUNK_SUBJ = [/out of office/i, /automatic reply/i, /your password/i, /verify your email/i, /your receipt from apple/i];

async function pullGmail(sb: any): Promise<number> {
  let refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  let clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  let clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!refreshToken) {
    try {
      const { data } = await sb.from("nexus_config").select("config").eq("id", 1).single();
      const cfg = data?.config || {};
      refreshToken = cfg.gmail_refresh_token;
      clientId = clientId || cfg.google_client_id;
      clientSecret = clientSecret || cfg.google_client_secret;
    } catch (_) {}
  }
  if (!refreshToken || !clientId || !clientSecret) return 0;

  try {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return 0;

    const listResp = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=newer_than:2d", { headers: { Authorization: `Bearer ${accessToken}` } });
    const listData = await listResp.json();
    const messages = listData.messages || [];
    if (!messages.length) return 0;

    const ids = messages.map((m: any) => m.id);
    const { data: existing } = await sb.from("raw_emails").select("id").in("id", ids);
    const existingIds = new Set((existing || []).map((e: any) => e.id));

    let archived = 0;
    for (const m of messages) {
      if (existingIds.has(m.id)) continue;
      try {
        const msgResp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const msg = await msgResp.json();
        if (!msg?.payload) continue;

        const headers = msg.payload.headers || [];
        const getH = (name: string) => (headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || "";
        const from = getH("From");
        const subject = getH("Subject");
        if (JUNK_FROM.some((p) => p.test(from)) || JUNK_SUBJ.some((p) => p.test(subject))) continue;

        let body = "";
        const attachments: any[] = [];

        function walkParts(parts: any[]) {
          if (!parts) return;
          for (const part of parts) {
            if (part.mimeType === "text/plain" && part.body?.data) {
              try { body += atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/")); } catch (_) {}
            }
            if (part.filename && part.body?.attachmentId) {
              attachments.push({ filename: part.filename, mimeType: part.mimeType || "", attachmentId: part.body.attachmentId, size: part.body.size || 0 });
            }
            if (part.parts) walkParts(part.parts);
          }
        }

        if (msg.payload.body?.data) {
          try { body = atob(msg.payload.body.data.replace(/-/g, "+").replace(/_/g, "/")); } catch (_) {}
        }
        walkParts(msg.payload.parts);

        body = body.replace(/<[^>]+>/g, " ").replace(/^>.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
        if (body.length < 10) continue;

        // Download and upload attachments to Supabase storage
        const savedAtts: any[] = [];
        const ALLOWED_EXTS = ["pdf", "docx", "xlsx", "xls", "csv", "pptx", "jpg", "jpeg", "png", "webp"];
        for (const att of attachments) {
          const ext = (att.filename.split(".").pop() || "").toLowerCase();
          if (!ALLOWED_EXTS.includes(ext) || att.size > 10 * 1024 * 1024) continue;
          try {
            const attResp = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}/attachments/${att.attachmentId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
            const attData = await attResp.json();
            if (!attData.data) continue;
            const b64 = attData.data.replace(/-/g, "+").replace(/_/g, "/");
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = `email-attachments/${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from("nexus-files").upload(path, bytes, { contentType: att.mimeType || "application/octet-stream", upsert: true });
            if (!upErr) {
              const { data: urlData } = sb.storage.from("nexus-files").getPublicUrl(path);
              if (urlData?.publicUrl) savedAtts.push({ url: urlData.publicUrl, filename: att.filename, type: att.mimeType });
            }
          } catch (_) {}
        }

        await sb.from("raw_emails").upsert({ id: m.id, from_addr: from, to_addr: getH("To"), date: getH("Date"), subject, body, snippet: msg.snippet || "", attachment_count: savedAtts.length, attachments: savedAtts, processed: false }, { onConflict: "id" });
        archived++;
      } catch (_) {}
    }
    return archived;
  } catch (e) {
    console.error("Gmail pull error:", e.message);
    return 0;
  }
}

serve(async (req) => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    const sb = createClient(supabaseUrl, supabaseKey);
    const pulled = await pullGmail(sb);
    if (pulled > 0) {
      await sb.from("daily_logs").insert({ entry: `📬 Auto-pull: ${pulled} new emails from Gmail`, user_id: 0, user_name: "NEXUS" });
    }

    const { data: emails, error } = await sb.from("raw_emails").select("*").eq("processed", false).order("ingested_at", { ascending: true }).limit(5);
    if (error || !emails || !emails.length) {
      return new Response(JSON.stringify({ status: "idle", processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Extract document text from attachments via MarkItDown
    for (const email of emails) {
      const atts = email.attachments || [];
      for (const att of atts) {
        if (!att.url || !att.filename) continue;
        const ext = (att.filename.split(".").pop() || "").toLowerCase();
        if (["docx", "xlsx", "xls", "pptx", "csv", "html", "htm"].includes(ext)) {
          try {
            const fileResp = await fetch(att.url);
            if (!fileResp.ok) continue;
            const rawText = await fileResp.text();
            if (rawText.length < 30) continue;
            const mdResp = await fetch(`${supabaseUrl}/functions/v1/markitdown`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
              body: JSON.stringify({ content: rawText.slice(0, 20000), filename: att.filename, mode: "extract" }),
            });
            if (mdResp.ok) {
              const mdResult = await mdResp.json();
              if (mdResult.markdown) email.body = (email.body || "") + `\n[DOC:${att.filename}]\n${mdResult.markdown.slice(0, 5000)}`;
            }
          } catch (_) {}
        }
        if (ext === "pdf") email.body = (email.body || "") + `\n[PDF: ${att.filename} — ${att.url}]`;
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) email.body = (email.body || "") + `\n[IMAGE: ${att.filename} — ${att.url}]`;
      }
    }

    // AI Processing
    const chunk = emails.map((e, i) => `[EMAIL #${i + 1}]\nFROM: ${e.from_addr}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\n---\n${(e.body || e.snippet || "").slice(0, 3000)}`).join("\n\n========\n\n");
    const { data: existingNodes } = await sb.from("nodes").select("name");
    const existingNames = (existingNodes || []).map((n) => n.name);

    const prompt = `You extract structured data from restaurant operations emails for Suerte, Este, and Bar Toti (Austin TX).

EXISTING NODES (do not duplicate): ${existingNames.slice(0, 100).join(", ")}

Extract entities: people, equipment, vendors, contractors, parts, procedures, projects, locations, systems.

RULES:
- USE FULL PROPER NAMES — "Tyler Maffi" not "Tyler", "Excalibur Dehydrator" not "dehydrator"
- If an entity matches an existing node, set "merge_with" to the exact existing name
- Include phone numbers, emails, model numbers, part numbers, prices, invoice numbers in notes
- Category: equipment, contractors, vendors, procedure, projects, people, systems, parts, location
- Deliveries/shipments: extract PRODUCT as equipment or parts, VENDOR as vendors
- Invoices: extract COMPANY as vendors/contractors, include invoice # and amount in notes
- Do NOT flag routine deliveries, invoices, or order confirmations as urgent or pest-related
- Only flag pest-related if email is SPECIFICALLY about pest control or pest sightings

JSON only: {"nodes":[{"name":"...","category":"...","notes":"...","tags":[],"merge_with":null,"source_emails":[{"from":"...","date":"...","subject":"..."}]}]}

EMAILS:
${chunk}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    });
    const aiResult = await resp.json();
    const text = aiResult.content?.[0]?.text || "";
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch (_) { parsed = { nodes: [] }; }

    let created = 0, merged = 0;
    const urgentAlerts: string[] = [];
    const existingMap: Record<string, any> = {};
    const { data: allNodes } = await sb.from("nodes").select("id,name,notes,tags,source_emails");
    (allNodes || []).forEach((n) => { if (n.name) existingMap[n.name.toLowerCase()] = n; });
    const validCats = ["equipment", "contractors", "vendors", "procedure", "projects", "people", "systems", "parts", "location"];

    for (const n of parsed.nodes || []) {
      const nm = (n.name || "").trim();
      if (!nm || nm.length < 2) continue;
      const fullText = `${nm} ${n.notes || ""}`;
      for (const p of URGENT_PATTERNS) { if (p.re.test(fullText)) { urgentAlerts.push(`${p.label}: ${nm}`); break; } }
      const existKey = n.merge_with
        ? Object.keys(existingMap).find((k) => k === n.merge_with?.toLowerCase())
        : Object.keys(existingMap).find((k) => k === nm.toLowerCase() || (nm.length > 5 && k.includes(nm.toLowerCase())));
      if (existKey) {
        const ex = existingMap[existKey];
        const newNotes = (n.notes || "").slice(0, 3000);
        if (newNotes.length > 10 && !(ex.notes || "").includes(newNotes.slice(0, 50))) {
          await sb.from("nodes").update({ notes: ((ex.notes || "") + "\n\n" + newNotes).slice(0, 4000), source_emails: [...(ex.source_emails || []), ...(n.source_emails || [])].slice(0, 50) }).eq("id", ex.id);
          merged++;
        }
      } else {
        const { error: insertErr } = await sb.from("nodes").insert({ name: nm.slice(0, 200), category: validCats.includes(n.category) ? n.category : "equipment", tags: Array.isArray(n.tags) ? n.tags.slice(0, 20) : [], notes: (n.notes || "").slice(0, 3000), links: [], access_count: 1, source_emails: n.source_emails || [] });
        if (!insertErr) created++;
      }
    }

    for (const e of emails) { await sb.from("raw_emails").update({ processed: true }).eq("id", e.id); }

    if (urgentAlerts.length) {
      try {
        const { data: subs } = await sb.from("push_subscriptions").select("subscription");
        if (subs?.length) {
          await fetch(`${supabaseUrl}/functions/v1/push-notify`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` }, body: JSON.stringify({ title: "🚨 NEXUS Alert", body: urgentAlerts.join(" | "), subscriptions: subs.map((s) => s.subscription) }) });
        }
      } catch (_) {}
      await sb.from("daily_logs").insert({ entry: `🚨 AUTO-TRIAGE: ${urgentAlerts.join(", ")}`, user_id: 0, user_name: "NEXUS" });
    }

    await sb.from("daily_logs").insert({ entry: `⚙ Pipeline: ${emails.length} emails → ${created} new, ${merged} merged${urgentAlerts.length ? `, ${urgentAlerts.length} URGENT` : ""}`, user_id: 0, user_name: "NEXUS" });

    return new Response(JSON.stringify({ status: "ok", processed: emails.length, created, merged, urgent: urgentAlerts }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
