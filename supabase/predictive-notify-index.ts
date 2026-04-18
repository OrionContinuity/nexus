// ═══════════════════════════════════════════════════════════════════════
// NEXUS Predictive Notify — Daily PM & Pattern Alerter
//
// Runs daily via cron. Scans:
//   1. patterns.next_predicted within next 3 days  (recurring contractor visits)
//   2. equipment.next_pm_date within next 7 days   (scheduled PM)
//   3. equipment.warranty_until within next 30 days (warranty expiration)
//   4. dispatch_log.outcome = 'pending' older than 24h (forgotten follow-ups)
//
// Sends to two channels:
//   • Web Push  → push_subscriptions (browser VAPID)
//   • Native    → nexus_users.push_token (FCM via Firebase HTTP v1)
//
// Always logs to action_chains for the morning brief to surface.
// Idempotent: writes a `notify_log` row keyed on (entity_id, alert_type, day)
// so the same equipment/pattern doesn't fire repeatedly within a window.
// ═══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface Alert {
  alert_type: "pattern_due" | "pm_due" | "warranty_expiring" | "dispatch_stale";
  entity_id: string;          // pattern.id, equipment.id, or dispatch_log.id (as text)
  entity_kind: "pattern" | "equipment" | "dispatch";
  title: string;
  body: string;
  data: Record<string, unknown>; // extra payload for client deep-link
  priority: "high" | "normal";
}

serve(async (req: Request) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON"); // optional
  const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");                   // optional
  const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY");                    // optional
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:ops@nexus.local";

  try {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const in3days  = addDays(todayStr, 3);
    const in7days  = addDays(todayStr, 7);
    const in30days = addDays(todayStr, 30);

    const alerts: Alert[] = [];

    // ─── 1. PATTERN PREDICTIONS DUE ───
    const { data: duePatterns } = await sb.from("patterns")
      .select("*")
      .eq("active", true)
      .gte("next_predicted", todayStr)
      .lte("next_predicted", in3days)
      .gte("confidence", 0.5);

    duePatterns?.forEach(p => {
      const days = daysBetween(todayStr, p.next_predicted);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      alerts.push({
        alert_type: "pattern_due",
        entity_id: String(p.id),
        entity_kind: "pattern",
        title: `🔮 ${capitalize(p.entity_name)} likely ${when}`,
        body: `Based on ${p.occurrences?.length || "past"} prior visits at ~${p.interval_days}-day intervals (${Math.round((p.confidence || 0) * 100)}% confident).${p.location ? " @ " + p.location : ""}`,
        data: { view: "log", pattern_id: p.id, location: p.location },
        priority: days <= 1 ? "high" : "normal",
      });
    });

    // ─── 2. EQUIPMENT PM DUE ───
    const { data: duePM } = await sb.from("equipment")
      .select("id, name, location, area, next_pm_date, category, qr_code")
      .neq("status", "retired")
      .not("next_pm_date", "is", null)
      .gte("next_pm_date", todayStr)
      .lte("next_pm_date", in7days);

    duePM?.forEach(e => {
      const days = daysBetween(todayStr, e.next_pm_date);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      alerts.push({
        alert_type: "pm_due",
        entity_id: String(e.id),
        entity_kind: "equipment",
        title: `🔧 PM due ${when}: ${e.name}`,
        body: `${e.location || ""}${e.area ? " · " + e.area : ""} — preventive maintenance on the schedule.`,
        data: { view: "equipment", equipment_id: e.id, qr_code: e.qr_code },
        priority: days <= 1 ? "high" : "normal",
      });
    });

    // ─── 3. WARRANTY EXPIRING ───
    const { data: dueWarranty } = await sb.from("equipment")
      .select("id, name, location, warranty_until, manufacturer, model")
      .neq("status", "retired")
      .not("warranty_until", "is", null)
      .gte("warranty_until", todayStr)
      .lte("warranty_until", in30days);

    dueWarranty?.forEach(e => {
      const days = daysBetween(todayStr, e.warranty_until);
      alerts.push({
        alert_type: "warranty_expiring",
        entity_id: String(e.id),
        entity_kind: "equipment",
        title: `🛡️ Warranty expiring in ${days}d: ${e.name}`,
        body: `${[e.manufacturer, e.model].filter(Boolean).join(" ") || "Unit"} @ ${e.location || ""}. Last chance for warranty repair claims.`,
        data: { view: "equipment", equipment_id: e.id },
        priority: days <= 7 ? "high" : "normal",
      });
    });

    // ─── 4. STALE DISPATCH FOLLOW-UPS ───
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: staleDispatches } = await sb.from("dispatch_log")
      .select("id, equipment_id, contractor_name, method, created_at")
      .eq("outcome", "pending")
      .lt("created_at", yesterday)
      .gt("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(20);

    staleDispatches?.forEach(d => {
      const hoursAgo = Math.round((Date.now() - new Date(d.created_at).getTime()) / 3600000);
      alerts.push({
        alert_type: "dispatch_stale",
        entity_id: String(d.id),
        entity_kind: "dispatch",
        title: `📞 No reply from ${d.contractor_name || "contractor"}`,
        body: `${capitalize(d.method || "Contact")} sent ${hoursAgo}h ago, still pending. Tap to follow up.`,
        data: { view: "equipment", equipment_id: d.equipment_id, dispatch_id: d.id },
        priority: "normal",
      });
    });

    // ─── DEDUPE: skip alerts already fired today ───
    const fresh: Alert[] = [];
    for (const a of alerts) {
      const dedupeKey = `${a.alert_type}:${a.entity_id}:${todayStr}`;
      const { data: existing } = await sb.from("notify_log")
        .select("id").eq("dedupe_key", dedupeKey).limit(1);
      if (existing?.length) continue;
      fresh.push(a);
    }

    if (!fresh.length) {
      return json({ status: "ok", checked: alerts.length, sent: 0, reason: "all already notified today" });
    }

    // ─── DELIVERY ───
    // Pull subscribers ONCE (small table, < 100 rows realistically)
    const [{ data: webSubs }, { data: nativeUsers }] = await Promise.all([
      sb.from("push_subscriptions").select("user_id, user_name, subscription"),
      sb.from("nexus_users").select("id, name, push_token, role").not("push_token", "is", null),
    ]);

    let webSent = 0, nativeSent = 0, errors = 0;

    for (const alert of fresh) {
      const payload = {
        title: alert.title,
        body: alert.body,
        data: { ...alert.data, alert_type: alert.alert_type, ts: Date.now() },
        priority: alert.priority,
        tag: alert.alert_type + "_" + alert.entity_id, // collapse dupes on the device
      };

      // Web push (browsers)
      if (VAPID_PRIVATE && VAPID_PUBLIC && webSubs?.length) {
        for (const sub of webSubs) {
          try {
            await sendWebPush(sub.subscription, payload, {
              publicKey: VAPID_PUBLIC,
              privateKey: VAPID_PRIVATE,
              subject: VAPID_SUBJECT,
            });
            webSent++;
          } catch (e) {
            console.warn("[Notify] Web push failed:", e instanceof Error ? e.message : e);
            errors++;
            // Optional: clean up dead subscriptions on 410 Gone
            if (e instanceof Error && e.message.includes("410")) {
              await sb.from("push_subscriptions").delete().eq("user_id", sub.user_id);
            }
          }
        }
      }

      // Native push (FCM HTTP v1)
      if (FCM_SERVICE_ACCOUNT_JSON && nativeUsers?.length) {
        for (const u of nativeUsers) {
          // Optional: gate by role (don't spam staff with ops alerts)
          if (alert.alert_type !== "dispatch_stale" && u.role === "staff") continue;
          try {
            await sendFCM(u.push_token!, payload, FCM_SERVICE_ACCOUNT_JSON);
            nativeSent++;
          } catch (e) {
            console.warn("[Notify] FCM failed:", e instanceof Error ? e.message : e);
            errors++;
          }
        }
      }

      // Mark as fired (so we don't re-notify today)
      await sb.from("notify_log").insert({
        dedupe_key: `${alert.alert_type}:${alert.entity_id}:${todayStr}`,
        alert_type: alert.alert_type,
        entity_id: alert.entity_id,
        entity_kind: alert.entity_kind,
        title: alert.title,
        body: alert.body,
        priority: alert.priority,
        web_sent: webSent,
        native_sent: nativeSent,
      });

      // Record an action_chain for the morning brief
      await sb.from("action_chains").insert({
        trigger_text: `Predictive alert: ${alert.title}`,
        actions: [{ type: "notify", alert_type: alert.alert_type, entity: alert.entity_id }],
        user_name: "NEXUS",
      });
    }

    return json({
      status: "ok",
      checked: alerts.length,
      fresh: fresh.length,
      web_sent: webSent,
      native_sent: nativeSent,
      errors,
      vapid_configured: !!(VAPID_PRIVATE && VAPID_PUBLIC),
      fcm_configured: !!FCM_SERVICE_ACCOUNT_JSON,
    });
  } catch (err) {
    console.error("[Notify] Fatal:", err);
    return json({ status: "error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function capitalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ─── WEB PUSH (VAPID) ─── */
// Minimal VAPID-signed POST. Uses Deno's built-in WebCrypto.
async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: object,
  vapid: { publicKey: string; privateKey: string; subject: string }
): Promise<void> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  // VAPID JWT (ES256)
  const header = { alg: "ES256", typ: "JWT" };
  const claims = { aud: audience, exp, sub: vapid.subject };
  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  const privateKey = await importVapidPrivateKey(vapid.privateKey);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  // Note: payload encryption (aes128gcm) is required by spec for actual payload delivery.
  // For brevity here we send a "tickle" (no payload), which prompts the SW to fetch.
  // The service worker will then read the latest unread alert from the API.
  const resp = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "TTL": "86400",
      "Authorization": `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Length": "0",
    },
  });
  if (!resp.ok) {
    throw new Error(`Web push ${resp.status} ${resp.statusText}`);
  }
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importVapidPrivateKey(b64urlKey: string): Promise<CryptoKey> {
  // VAPID private keys are 32-byte raw EC scalars in base64url.
  const raw = Uint8Array.from(
    atob(b64urlKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)
  );
  // WebCrypto needs JWK or PKCS8 — convert raw to JWK (d only is enough for signing)
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: b64urlKey,
    // x/y not strictly needed for signing in modern WebCrypto, but some impls require them.
    // If your provider rejects, derive x/y from d using a P-256 helper.
    x: "", y: "",
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

/* ─── FCM HTTP v1 ─── */
// Requires a Firebase service account JSON (Project Settings → Service Accounts → Generate Key).
// Set as edge function secret: FCM_SERVICE_ACCOUNT_JSON (paste the entire JSON string).
async function sendFCM(token: string, payload: any, serviceAccountJson: string): Promise<void> {
  const sa = JSON.parse(serviceAccountJson);
  const accessToken = await getFCMAccessToken(sa);

  const message = {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: Object.fromEntries(
        Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: payload.priority === "high" ? "HIGH" : "NORMAL",
        notification: { tag: payload.tag, channel_id: "nexus_alerts" },
      },
    },
  };

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`FCM ${resp.status}: ${errBody.slice(0, 200)}`);
  }
}

// OAuth2 service-account → access token (cached in module scope for ~50min)
let _fcmTokenCache: { token: string; exp: number } | null = null;
async function getFCMAccessToken(sa: any): Promise<string> {
  if (_fcmTokenCache && _fcmTokenCache.exp > Date.now() + 60_000) {
    return _fcmTokenCache.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const jwt = await signRS256({ alg: "RS256", typ: "JWT" }, claims, sa.private_key);
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) throw new Error(`FCM token ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  _fcmTokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return j.access_token;
}

async function signRS256(header: object, claims: object, pemKey: string): Promise<string> {
  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  // Strip PEM headers, decode base64
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}
