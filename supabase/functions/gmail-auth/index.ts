// NEXUS Gmail Auth — code exchange + token refresh
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");

    const sb = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    // ═══ MODE: REFRESH — get new access token from stored refresh token ═══
    if (body.action === "refresh") {
      const { data: config } = await sb.from("nexus_config").select("config").eq("id", 1).single();
      const refreshToken = config?.config?.gmail_refresh_token;
      if (!refreshToken) {
        return new Response(JSON.stringify({ error: "no_refresh_token" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const tokenData = await tokenResp.json();
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      return new Response(JSON.stringify({
        status: "ok",
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in || 3600,
        has_refresh_token: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ MODE: CODE EXCHANGE — initial authorization ═══
    const { code, redirect_uri } = body;
    if (!code) throw new Error("Authorization code required");

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect_uri || "postmessage",
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    const { access_token, refresh_token, expires_in } = tokenData;

    if (refresh_token) {
      const { data: config } = await sb.from("nexus_config").select("config").eq("id", 1).single();
      const currentConfig = config?.config || {};
      currentConfig.gmail_refresh_token = refresh_token;
      currentConfig.gmail_connected_at = new Date().toISOString();
      await sb.from("nexus_config").upsert({ id: 1, config: currentConfig });
    }

    return new Response(JSON.stringify({
      status: "ok",
      access_token,
      expires_in,
      has_refresh_token: !!refresh_token,
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
