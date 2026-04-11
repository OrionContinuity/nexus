// NEXUS Process Emails — background pipeline, runs via pg_cron
// Deploy: supabase functions deploy process-emails
// Secrets needed: ANTHROPIC_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URGENT_PATTERNS = [
  { re: /health\s*(?:dept|department|inspector|inspection|violation)/i, label: "🏥 Health Department" },
  { re: /equipment\s*(?:failure|down|broken|not\s*working)/i, label: "🔧 Equipment Down" },
  { re: /leak|flood|water\s*damage/i, label: "💧 Water/Leak" },
  { re: /fire|smoke|burn/i, label: "🔥 Fire/Safety" },
  { re: /pest|roach|rodent|mouse|rat/i, label: "🐛 Pest Issue" },
  { re: /price\s*increase|rate\s*change/i, label: "💰 Price Change" },
  { re: /urgent|emergency|asap|critical/i, label: "🚨 Urgent" },
];

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    const sb = createClient(supabaseUrl, supabaseKey);
    const BATCH_SIZE = 5;

    // Pull unprocessed emails
    const { data: emails, error } = await sb
      .from("raw_emails")
      .select("*")
      .eq("processed", false)
      .order("ingested_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error || !emails || !emails.length) {
      return new Response(JSON.stringify({ status: "idle", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enrich emails with document attachment text via MarkItDown
    const DOC_EXTS = ["docx", "xlsx", "xls", "pptx", "csv", "html", "htm"];
    for (const email of emails) {
      const atts = email.attachments || [];
      if (!atts.length) continue;
      for (const att of atts) {
        if (!att.url || !att.filename) continue;
        const ext = (att.filename.split(".").pop() || "").toLowerCase();
        if (!DOC_EXTS.includes(ext)) continue;
        try {
          // Fetch the file and get text
          const fileResp = await fetch(att.url);
          if (!fileResp.ok) continue;
          const rawText = await fileResp.text();
          if (rawText.length < 30) continue;
          // Call markitdown function for structured extraction
          const mdResp = await fetch(`${supabaseUrl}/functions/v1/markitdown`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              content: rawText.slice(0, 20000),
              filename: att.filename,
              mode: "extract",
            }),
          });
          if (mdResp.ok) {
            const mdResult = await mdResp.json();
            if (mdResult.markdown) {
              email.body = (email.body || "") + `\n[DOC:${att.filename}]\n${mdResult.markdown.slice(0, 5000)}`;
            }
          }
        } catch (_) { /* skip on error */ }
      }
    }

    // Build chunk for Claude
    const chunk = emails.map((e, i) =>
      `[EMAIL #${i + 1}]\nFROM: ${e.from_addr}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\n---\n${(e.body || e.snippet || "").slice(0, 3000)}`
    ).join("\n\n========\n\n");

    // Load existing node names for dedup
    const { data: existingNodes } = await sb.from("nodes").select("name");
    const existingNames = (existingNodes || []).map((n) => n.name);

    const prompt = `You extract structured data from restaurant operations emails for Suerte, Este, and Bar Toti (Austin TX).

EXISTING NODES (do not duplicate): ${existingNames.slice(0, 100).join(", ")}

For each email, extract entities: people, equipment, vendors, contractors, parts, procedures, projects, locations, systems.

RULES:
- USE FULL PROPER NAMES — "Tyler Maffi" not "Tyler"
- If an entity matches an existing node, set "merge_with" to the exact existing name
- Include phone numbers, emails, model numbers, part numbers, prices in notes
- Category must be one of: equipment, contractors, vendors, procedure, projects, people, systems, parts, location

Respond ONLY with JSON: {"nodes":[{"name":"...","category":"...","notes":"...","tags":[],"merge_with":null,"source_emails":[{"from":"...","date":"...","subject":"..."}]}]}

EMAILS:
${chunk}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const aiResult = await resp.json();
    const text = aiResult.content?.[0]?.text || "";

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch (_) {
      parsed = { nodes: [] };
    }

    // Save nodes
    let created = 0, merged = 0;
    const urgentAlerts: string[] = [];
    const existingMap: Record<string, any> = {};
    const { data: allNodes } = await sb.from("nodes").select("id,name,notes,tags,source_emails");
    (allNodes || []).forEach((n) => { if (n.name) existingMap[n.name.toLowerCase()] = n; });

    const validCats = ["equipment", "contractors", "vendors", "procedure", "projects", "people", "systems", "parts", "location"];

    for (const n of (parsed.nodes || [])) {
      const nm = (n.name || "").trim();
      if (!nm || nm.length < 2) continue;

      // Check urgency
      const fullText = `${nm} ${n.notes || ""}`;
      for (const p of URGENT_PATTERNS) {
        if (p.re.test(fullText)) {
          urgentAlerts.push(`${p.label}: ${nm}`);
          break;
        }
      }

      // Check for existing match
      const existKey = n.merge_with
        ? Object.keys(existingMap).find((k) => k === n.merge_with?.toLowerCase())
        : Object.keys(existingMap).find((k) => k === nm.toLowerCase() || (nm.length > 3 && k.includes(nm.toLowerCase())));

      if (existKey) {
        const ex = existingMap[existKey];
        const newNotes = (n.notes || "").slice(0, 3000);
        if (newNotes.length > 10 && !(ex.notes || "").includes(newNotes.slice(0, 50))) {
          const mergedNotes = ((ex.notes || "") + "\n\n" + newNotes).slice(0, 4000);
          const mergedSources = [...(ex.source_emails || []), ...(n.source_emails || [])].slice(0, 50);
          await sb.from("nodes").update({ notes: mergedNotes, source_emails: mergedSources }).eq("id", ex.id);
          merged++;
        }
      } else {
        const row = {
          name: nm.slice(0, 200),
          category: validCats.includes(n.category) ? n.category : "equipment",
          tags: Array.isArray(n.tags) ? n.tags.slice(0, 20) : [],
          notes: (n.notes || "").slice(0, 3000),
          links: [],
          access_count: 1,
          source_emails: n.source_emails || [],
        };
        const { error: insertErr } = await sb.from("nodes").insert(row);
        if (!insertErr) created++;
      }
    }

    // Mark emails as processed
    for (const e of emails) {
      await sb.from("raw_emails").update({ processed: true }).eq("id", e.id);
    }

    // Send push notifications for urgent items
    if (urgentAlerts.length) {
      try {
        const { data: subs } = await sb.from("push_subscriptions").select("subscription");
        if (subs && subs.length) {
          await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              title: "🚨 NEXUS Alert",
              body: urgentAlerts.join(" | "),
              subscriptions: subs.map((s) => s.subscription),
            }),
          });
        }
      } catch (_) {}

      // Log urgent items
      await sb.from("daily_logs").insert({
        entry: `🚨 AUTO-TRIAGE: ${urgentAlerts.join(", ")}`,
        user_id: 0,
        user_name: "NEXUS",
      });
    }

    // Log processing
    await sb.from("daily_logs").insert({
      entry: `⚙ Background pipeline: ${emails.length} emails → ${created} new, ${merged} merged${urgentAlerts.length ? `, ${urgentAlerts.length} URGENT` : ""}`,
      user_id: 0,
      user_name: "NEXUS",
    });

    return new Response(JSON.stringify({
      status: "ok",
      processed: emails.length,
      created,
      merged,
      urgent: urgentAlerts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
