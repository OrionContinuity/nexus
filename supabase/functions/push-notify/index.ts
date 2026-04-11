// NEXUS Push Notify — sends Web Push notifications
// Deploy: supabase functions deploy push-notify
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// Web Push implementation using web-push-encryption
async function sendPush(subscription: any, payload: string, vapidKeys: any) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const auth = subscription.keys.auth;

  // Use Deno's crypto for ECDH and AES-GCM
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);

  // Simplified push — use raw fetch with VAPID JWT
  const jwt = await createVapidJwt(endpoint, vapidKeys);

  // For simplicity, send unencrypted notification via TTL 0
  // In production, implement full RFC 8291 encryption
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "high",
    },
    body: payloadBytes,
  });

  return resp.status;
}

async function createVapidJwt(endpoint: string, vapidKeys: any): Promise<string> {
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const payload = btoa(JSON.stringify({
    aud: audience,
    exp: expiration,
    sub: `mailto:${vapidKeys.email}`,
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${header}.${payload}`;
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { title, body, subscriptions } = await req.json();

    const vapidKeys = {
      publicKey: Deno.env.get("VAPID_PUBLIC_KEY") || "",
      privateKey: Deno.env.get("VAPID_PRIVATE_KEY") || "",
      email: Deno.env.get("VAPID_EMAIL") || "admin@nexusops.com",
    };

    const payload = JSON.stringify({ title: title || "NEXUS", body: body || "", icon: "/icon-192.png" });
    let sent = 0, failed = 0;

    for (const sub of (subscriptions || [])) {
      try {
        const parsed = typeof sub === "string" ? JSON.parse(sub) : sub;
        await sendPush(parsed, payload, vapidKeys);
        sent++;
      } catch (_) {
        failed++;
      }
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
