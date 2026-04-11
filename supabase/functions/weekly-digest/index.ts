// NEXUS Weekly Digest — generates ops report, runs Monday 7 AM via pg_cron
// Deploy: supabase functions deploy weekly-digest

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const today = new Date().toISOString().split("T")[0];

    // Gather all data in parallel
    const [hoursR, ticketsR, nodesR, cardsR, cleanR, chatsR] = await Promise.allSettled([
      sb.from("time_clock").select("user_name,hours,location").gte("clock_in", weekAgo).not("hours", "is", null),
      sb.from("tickets").select("title,location,status,created_at").gte("created_at", weekAgo),
      sb.from("nodes").select("name,category").gte("created_at", weekAgo),
      sb.from("kanban_cards").select("title,column_name,due_date").limit(100),
      sb.from("daily_logs").select("entry").gte("created_at", weekAgo).like("entry", "%Cleaning%"),
      sb.from("chat_history").select("question,user_name").gte("created_at", weekAgo).limit(30),
    ]);

    const hours = hoursR.status === "fulfilled" ? hoursR.value.data || [] : [];
    const tickets = ticketsR.status === "fulfilled" ? ticketsR.value.data || [] : [];
    const newNodes = nodesR.status === "fulfilled" ? nodesR.value.data || [] : [];
    const cards = cardsR.status === "fulfilled" ? cardsR.value.data || [] : [];
    const cleaning = cleanR.status === "fulfilled" ? cleanR.value.data || [] : [];
    const chats = chatsR.status === "fulfilled" ? chatsR.value.data || [] : [];

    // Aggregate hours
    const byPerson: Record<string, number> = {};
    hours.forEach((h: any) => { byPerson[h.user_name] = (byPerson[h.user_name] || 0) + parseFloat(h.hours || 0); });

    const overdue = cards.filter((c: any) => c.due_date && c.due_date < today && c.column_name !== "done");

    const dataStr = `NEXUS WEEKLY DATA — ${new Date(Date.now() - 7 * 86400000).toLocaleDateString()} to ${new Date().toLocaleDateString()}

HOURS: ${Object.entries(byPerson).sort((a, b) => b[1] - a[1]).map(([n, h]) => `${n}: ${h.toFixed(1)}h`).join(", ") || "None logged"}
Total: ${Object.values(byPerson).reduce((a, b) => a + b, 0).toFixed(1)}h

TICKETS: ${tickets.filter((t: any) => t.status === "open").length} open, ${tickets.filter((t: any) => t.status === "closed").length} closed this week
${tickets.filter((t: any) => t.status === "open").slice(0, 5).map((t: any) => `• ${t.title} (${t.location || "?"})`).join("\n") || "None open"}

BOARD: ${cards.filter((c: any) => c.column_name === "todo").length} todo, ${cards.filter((c: any) => c.column_name === "done").length} done, ${overdue.length} overdue

NEW KNOWLEDGE: ${newNodes.length} nodes (${[...new Set(newNodes.map((n: any) => n.category))].join(", ") || "none"})

CLEANING: ${cleaning.length} reports
${cleaning.slice(-3).map((l: any) => (l.entry || "").slice(0, 80)).join("\n") || "None"}

ACTIVITY: ${chats.length} conversations`;

    // Generate digest via Claude
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: `You are NEXUS, ops brain for Suerte, Este, and Bar Toti (Austin TX). Generate a weekly operations digest. Be direct, insightful, actionable. Flag concerns, praise wins, suggest focus areas for next week. Keep it concise — this goes on a phone.\n\n${dataStr}`,
        }],
      }),
    });

    const aiResult = await resp.json();
    const digest = aiResult.content?.[0]?.text || "No digest generated";

    // Save to daily_logs
    await sb.from("daily_logs").insert({
      entry: `📊 WEEKLY DIGEST (${today}):\n${digest}`,
      user_id: 0,
      user_name: "NEXUS",
    });

    // Push notification
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
            title: "📊 Weekly Digest Ready",
            body: "Your NEXUS operations report is ready",
            subscriptions: subs.map((s: any) => s.subscription),
          }),
        });
      }
    } catch (_) {}

    return new Response(JSON.stringify({ status: "ok", digest: digest.slice(0, 200) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
