// NEXUS Chat — proxies Claude API calls, keeps API key server-side
// Deploy: supabase functions deploy chat
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

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

    const { messages, system, model, max_tokens } = await req.json();

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: max_tokens || 600,
        system: system || "",
        messages: messages || [],
      }),
    });

    const data = await resp.json();

    // Save to chat_history
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);

      const userMsg = messages?.find((m: any) => m.role === "user")?.content || "";
      const aiMsg = data.content?.[0]?.text || "";
      if (userMsg && aiMsg) {
        await sb.from("chat_history").insert({
          question: typeof userMsg === "string" ? userMsg.slice(0, 500) : JSON.stringify(userMsg).slice(0, 500),
          answer: aiMsg.slice(0, 2000),
          session_id: "edge",
          user_name: "api",
        });
      }
    } catch (_) {}

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
