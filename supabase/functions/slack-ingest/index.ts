// NEXUS Slack Ingest — receives Slack events, queues messages for AI
// Deploy: supabase functions deploy slack-ingest
// Secrets: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET (optional)
//
// Setup:
// 1. Create Slack App at api.slack.com/apps
// 2. Event Subscriptions → Request URL:
//    https://YOUR_PROJECT.supabase.co/functions/v1/slack-ingest
// 3. Subscribe to: message.channels, message.groups, message.im
// 4. OAuth → Bot Token Scopes: channels:history, groups:history, im:history, users:read
// 5. Install to workspace → copy Bot Token
// 6. supabase secrets set SLACK_BOT_TOKEN=xoxb-...

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache user names (Slack sends user IDs, not names)
const userCache: Record<string, string> = {};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    // Slack URL verification challenge
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Handle event callbacks
    if (body.type === "event_callback") {
      const event = body.event;
      if (!event || event.type !== "message") {
        return new Response("ok", { headers: corsHeaders });
      }

      // Skip bot messages, edits, deletes
      if (event.subtype && event.subtype !== "file_share") {
        return new Response("ok", { headers: corsHeaders });
      }

      const text = event.text || "";
      if (text.length < 3) {
        return new Response("ok", { headers: corsHeaders });
      }

      // Resolve user name
      let userName = event.user || "unknown";
      if (SLACK_TOKEN && event.user && !userCache[event.user]) {
        try {
          const userResp = await fetch(`https://slack.com/api/users.info?user=${event.user}`, {
            headers: { "Authorization": `Bearer ${SLACK_TOKEN}` },
          });
          const userData = await userResp.json();
          if (userData.ok) {
            userCache[event.user] = userData.user?.real_name || userData.user?.name || event.user;
          }
        } catch (_) {}
      }
      userName = userCache[event.user] || event.user;

      // Resolve channel name
      let channelName = event.channel || "unknown";
      if (SLACK_TOKEN && event.channel) {
        try {
          const chResp = await fetch(`https://slack.com/api/conversations.info?channel=${event.channel}`, {
            headers: { "Authorization": `Bearer ${SLACK_TOKEN}` },
          });
          const chData = await chResp.json();
          if (chData.ok) {
            channelName = chData.channel?.name || event.channel;
          }
        } catch (_) {}
      }

      const ts = event.ts ? new Date(parseFloat(event.ts) * 1000).toISOString() : new Date().toISOString();

      // Deterministic ID to prevent duplicates
      const msgId = `slack_${event.channel}_${event.ts}`;

      // Check if already exists
      const { data: existing } = await sb.from("raw_emails").select("id").eq("id", msgId).single();
      if (existing) {
        return new Response("ok", { headers: corsHeaders });
      }

      // Store as raw_email for AI processing
      await sb.from("raw_emails").upsert({
        id: msgId,
        from_addr: `Slack: ${userName}`,
        to_addr: `#${channelName}`,
        date: ts,
        subject: `Slack #${channelName} — ${userName}`,
        body: text.slice(0, 12000),
        snippet: text.slice(0, 200),
        attachment_count: event.files?.length || 0,
        attachments: (event.files || []).slice(0, 5).map((f: any) => ({
          filename: f.name,
          url: f.url_private,
          type: f.mimetype,
        })),
        processed: false,
      }, { onConflict: "id" });

      return new Response(JSON.stringify({ status: "queued", channel: channelName, user: userName }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Manual pull endpoint — GET or POST with {action: "pull", channel: "C0123..."}
    if (body.action === "pull" && SLACK_TOKEN) {
      const channel = body.channel;
      const limit = body.limit || 100;
      if (!channel) {
        return new Response(JSON.stringify({ error: "channel required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch recent messages from channel
      const resp = await fetch(
        `https://slack.com/api/conversations.history?channel=${channel}&limit=${limit}`,
        { headers: { "Authorization": `Bearer ${SLACK_TOKEN}` } }
      );
      const data = await resp.json();
      if (!data.ok) {
        return new Response(JSON.stringify({ error: data.error }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const messages = (data.messages || []).filter((m: any) => !m.subtype && m.text && m.text.length > 2);
      let queued = 0, skipped = 0;

      // Batch into chunks of ~20 messages
      const CHUNK = 20;
      for (let i = 0; i < messages.length; i += CHUNK) {
        const batch = messages.slice(i, i + CHUNK);
        const body = batch.map((m: any) => {
          const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toLocaleString() : "";
          const user = userCache[m.user] || m.user || "?";
          return `[${ts}] ${user}: ${m.text}`;
        }).join("\n");

        const chunkId = `slack_${channel}_batch_${batch[0]?.ts || i}`;
        const { data: exists } = await sb.from("raw_emails").select("id").eq("id", chunkId).single();
        if (exists) { skipped++; continue; }

        await sb.from("raw_emails").upsert({
          id: chunkId,
          from_addr: `Slack: #${channel}`,
          to_addr: "nexus-import",
          date: batch[0]?.ts ? new Date(parseFloat(batch[0].ts) * 1000).toISOString() : new Date().toISOString(),
          subject: `Slack #${channel} (${batch.length} msgs)`,
          body: body.slice(0, 12000),
          snippet: body.slice(0, 200),
          attachment_count: 0,
          attachments: [],
          processed: false,
        }, { onConflict: "id" });
        queued++;
      }

      return new Response(JSON.stringify({
        status: "ok",
        messages: messages.length,
        queued,
        skipped,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List channels endpoint
    if (body.action === "list_channels" && SLACK_TOKEN) {
      const resp = await fetch(
        "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200",
        { headers: { "Authorization": `Bearer ${SLACK_TOKEN}` } }
      );
      const data = await resp.json();
      const channels = (data.channels || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        members: c.num_members,
        topic: c.topic?.value || "",
      }));

      return new Response(JSON.stringify({ channels }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
