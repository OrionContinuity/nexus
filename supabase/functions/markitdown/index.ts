// NEXUS MarkItDown — converts documents to clean Markdown via Claude
// Handles: Word, Excel, PPT, PDF text, HTML, email bodies
// Deploy: supabase functions deploy markitdown
// Secrets needed: ANTHROPIC_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { content, filename, mode } = body;
    // content: raw text extracted from document (client-side extraction)
    // filename: original filename for context
    // mode: 'markdown' | 'extract' | 'summarize'

    if (!content || content.length < 10) {
      return new Response(JSON.stringify({ error: "No content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompts: Record<string, string> = {
      markdown: `Convert this document content into clean, well-structured Markdown. Preserve all data, tables, lists, and formatting. Use proper headings, bullet points, and code blocks where appropriate. Output ONLY the Markdown, no explanation.`,
      extract: `Extract ALL structured data from this document for restaurant operations (Suerte, Este, Bar Toti — Austin TX). Return clean Markdown with:
- All names, companies, contacts (phone, email)
- All numbers: amounts, prices, quantities, dates, order/part/serial numbers
- All action items or decisions
- All equipment, vendor, or contractor references
Output ONLY Markdown.`,
      summarize: `Summarize this document for a restaurant operator. Include:
- Key facts and numbers
- Action items
- Important dates/deadlines
- Who is involved
Keep it concise but preserve critical details. Output ONLY Markdown.`,
    };

    const systemPrompt = prompts[mode] || prompts.markdown;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Document: ${filename || "unknown"}\n\n${content.slice(0, 30000)}`,
        }],
      }),
    });

    const aiResult = await resp.json();
    const markdown = aiResult.content?.[0]?.text || "";

    if (!markdown) {
      return new Response(JSON.stringify({ error: "No output from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optionally save to daily_logs
    if (body.save_log) {
      await sb.from("daily_logs").insert({
        entry: `📄 MarkItDown: ${filename} (${mode || "markdown"}) — ${markdown.length} chars`,
        user_name: "NEXUS",
        user_id: 0,
      });
    }

    return new Response(JSON.stringify({
      markdown,
      filename,
      mode: mode || "markdown",
      chars: markdown.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
