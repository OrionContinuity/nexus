// NEXUS Gmail Auth — exchanges authorization code for refresh token
// Deploy: supabase functions deploy gmail-auth
// Secrets needed: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//
// Flow:
// 1. Browser gets auth code via Google Identity Services
// 2. Sends code to this function
// 3. This function exchanges code for access + refresh tokens
// 4. Stores refresh token in nexus_config so process-emails can use it
// 5. Gmail auto-pull works forever — no browser needed

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

    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
    }

    const { code, redirect_uri } = await req.json();
    if (!code) throw new Error("Authorization code required");

    // Exchange authorization code for tokens
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

    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    if (!refresh_token) {
      return new Response(JSON.stringify({
        status: "partial",
        message: "Got access token but no refresh token. User may need to revoke and re-authorize with consent prompt.",
        access_token,
        expires_in,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store refresh token in nexus_config
    const sb = createClient(supabaseUrl, supabaseKey);
    const { data: config } = await sb.from("nexus_config").select("config").eq("id", 1).single();
    const currentConfig = config?.config || {};
    currentConfig.gmail_refresh_token = refresh_token;
    currentConfig.gmail_connected_at = new Date().toISOString();

    await sb.from("nexus_config").upsert({
      id: 1,
      config: currentConfig,
    });

    // Also set as environment secret for process-emails
    // (This can't be done programmatically — user must run CLI command)

    return new Response(JSON.stringify({
      status: "ok",
      message: "Gmail connected permanently. Refresh token stored.",
      access_token,
      expires_in,
      has_refresh_token: true,
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
