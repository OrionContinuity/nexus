// ═══════════════════════════════════════════════════════════════════════
//  NEXUS Predictive Notify — v2 (full rewrite)
// ═══════════════════════════════════════════════════════════════════════
//  Daily cron Edge Function.
//
//  What it does, in order:
//    1. PATTERN DETECTION — looks at last 365 days of dispatch_log,
//       equipment_maintenance, and contractor_events. Groups by
//       contractor name. For names seen 3+ times, computes mean
//       interval and confidence, then UPSERTs to public.patterns.
//    2. ALERT GATHERING — finds:
//         a. Pattern predictions due in next 3 days  (≥50% confidence)
//         b. Equipment PMs due in next 7 days
//         c. Warranties expiring in next 30 days
//         d. Dispatches stuck in "pending" outcome > 24h
//       All filtered to exclude soft-deleted rows.
//    3. DEDUPE — skips alerts already fired today (notify_log lookup).
//    4. DELIVERY — Web Push (RFC 8291 aes128gcm, full encryption) and
//       FCM HTTP v1 (service-account-signed). Per-alert success counts.
//    5. LOG — writes to notify_log only if at least one push succeeded
//       (so total config failures retry tomorrow). Always writes
//       action_chains for the morning brief.
//
//  Manual broadcast support:
//    POST { "broadcast": { "title": "...", "body": "...",
//                          "audience": "all|managers|staff|<user_id>" } }
//    Sends immediately, bypasses dedupe.
//
//  Secrets required:
//    VAPID_PUBLIC_KEY            base64url uncompressed P-256 (88 chars)
//    VAPID_PRIVATE_JWK           JSON-stringified JWK with d/x/y
//    VAPID_SUBJECT               mailto:ops@your-domain.com
//    FCM_SERVICE_ACCOUNT_JSON    (optional) Firebase service-account JSON
//    AUSTIN_TZ                   (optional) defaults to "America/Chicago"
//
//  Deploy:    supabase functions deploy predictive-notify
//  Schedule:  see PREDICTIVE-NOTIFY-SETUP.md (pg_cron)
// ═══════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────
interface Alert {
  alert_type: "pattern_due" | "pm_due" | "warranty_expiring" | "dispatch_stale" | "broadcast";
  entity_id: string;
  entity_kind: "pattern" | "equipment" | "dispatch" | "broadcast";
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: "high" | "normal";
}
interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
interface VapidConfig { publicKeyB64u: string; privateJwk: JsonWebKey; subject: string }

// ═══════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const TZ = Deno.env.get("AUSTIN_TZ") || "America/Chicago";
  const vapid = readVapidConfig();
  const fcmJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "";

  // Determine mode: cron run vs manual broadcast
  let body: any = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = {}; }
  }
  const isBroadcast = !!body.broadcast;

  const result: Record<string, unknown> = {
    status: "ok",
    mode: isBroadcast ? "broadcast" : "cron",
    timezone: TZ,
    vapid_configured: !!vapid,
    fcm_configured: !!fcmJson,
  };

  try {
    let alerts: Alert[] = [];

    if (isBroadcast) {
      const b = body.broadcast;
      if (!b.title || !b.body) {
        return jsonResp({ status: "error", message: "broadcast requires title + body" }, 400);
      }
      alerts = [{
        alert_type: "broadcast",
        entity_id: `bcast-${Date.now()}`,
        entity_kind: "broadcast",
        title: b.title,
        body: b.body,
        data: { audience: b.audience || "all", view: b.view || "brain" },
        priority: b.priority === "high" ? "high" : "normal",
      }];
    } else {
      // Step 1: refresh patterns
      const stats = await detectPatterns(sb);
      result.patterns_scanned = stats.scanned;
      result.patterns_written = stats.written;

      // Step 2: gather alerts
      const today = localDateStr(TZ);
      const in3 = addDays(today, 3);
      const in7 = addDays(today, 7);
      const in30 = addDays(today, 30);

      alerts = [
        ...await gatherPatternAlerts(sb, today, in3),
        ...await gatherPMAlerts(sb, today, in7),
        ...await gatherWarrantyAlerts(sb, today, in30),
        ...await gatherStaleDispatchAlerts(sb),
      ];

      result.checked = alerts.length;

      // Step 3: dedupe (broadcasts skip dedupe)
      alerts = await dedupeAlerts(sb, alerts, today);
      result.fresh = alerts.length;

      if (!alerts.length) {
        result.sent = 0;
        result.reason = "nothing new today";
        return jsonResp(result);
      }
    }

    // Step 4: load subscribers once
    const [{ data: webSubs }, { data: nativeUsers }] = await Promise.all([
      sb.from("push_subscriptions").select("user_id, user_name, subscription"),
      sb.from("nexus_users").select("id, name, push_token, role").not("push_token", "is", null),
    ]);

    // Filter audience for broadcast
    const audience = isBroadcast ? body.broadcast.audience : null;
    const filteredWeb = filterAudience(webSubs || [], nativeUsers || [], audience);
    const filteredNative = filterNativeAudience(nativeUsers || [], audience);

    let totalWeb = 0, totalNative = 0, totalErrors = 0;

    // Step 5: per-alert delivery
    for (const alert of alerts) {
      let webForAlert = 0, nativeForAlert = 0;
      const payload = makePayload(alert);

      // Web push
      if (vapid && filteredWeb.length) {
        for (const sub of filteredWeb) {
          try {
            const subscription = parseSub(sub.subscription);
            await sendWebPush(subscription, payload, vapid);
            webForAlert++;
          } catch (e) {
            console.warn(`[Notify] web push failed (${sub.user_name}): ${errMsg(e)}`);
            totalErrors++;
            // Auto-clean dead 410 Gone subscriptions
            if (errMsg(e).includes("410") || errMsg(e).includes("404")) {
              await sb.from("push_subscriptions").delete().eq("user_id", sub.user_id);
            }
          }
        }
      }

      // FCM
      if (fcmJson && filteredNative.length) {
        for (const u of filteredNative) {
          // For cron mode: don't spam staff with non-urgent ops alerts
          if (!isBroadcast && alert.alert_type !== "dispatch_stale" && u.role === "staff") continue;
          try {
            await sendFCM(u.push_token!, payload, fcmJson);
            nativeForAlert++;
          } catch (e) {
            console.warn(`[Notify] FCM failed (${u.name}): ${errMsg(e)}`);
            totalErrors++;
          }
        }
      }

      totalWeb += webForAlert;
      totalNative += nativeForAlert;

      // Mark dedupe ONLY if at least one push succeeded
      // (so total config failures retry tomorrow)
      if (!isBroadcast && (webForAlert > 0 || nativeForAlert > 0)) {
        await sb.from("notify_log").insert({
          dedupe_key: dedupeKey(alert, localDateStr(TZ)),
          alert_type: alert.alert_type,
          entity_id: alert.entity_id,
          entity_kind: alert.entity_kind,
          title: alert.title,
          body: alert.body,
          priority: alert.priority,
          web_sent: webForAlert,
          native_sent: nativeForAlert,
        });
      }

      // Always record for morning brief
      if (!isBroadcast) {
        await sb.from("action_chains").insert({
          trigger_text: `Predictive alert: ${alert.title}`,
          actions: [{
            type: "notify",
            alert_type: alert.alert_type,
            entity: alert.entity_id,
            web_sent: webForAlert,
            native_sent: nativeForAlert,
          }],
          user_name: "NEXUS",
        });
      }
    }

    result.web_sent = totalWeb;
    result.native_sent = totalNative;
    result.errors = totalErrors;
    return jsonResp(result);

  } catch (e) {
    console.error("[Notify] Fatal:", e);
    return jsonResp({ status: "error", message: errMsg(e) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════

async function detectPatterns(sb: SupabaseClient): Promise<{ scanned: number; written: number }> {
  const cutoff = addDays(new Date().toISOString().split("T")[0], -365);
  const visits: { name: string; date: string; location?: string }[] = [];

  const { data: dispatches } = await sb.from("dispatch_log")
    .select("contractor_name, responded_at, created_at")
    .not("contractor_name", "is", null).neq("contractor_name", "")
    .gte("created_at", cutoff);
  dispatches?.forEach(d => {
    const date = (d.responded_at || d.created_at)?.split("T")[0];
    if (date && d.contractor_name) visits.push({ name: normName(d.contractor_name), date });
  });

  const { data: maint } = await sb.from("equipment_maintenance")
    .select("performed_by, event_date")
    .not("performed_by", "is", null).neq("performed_by", "")
    .gte("event_date", cutoff);
  maint?.forEach(m => {
    if (m.event_date && m.performed_by) visits.push({ name: normName(m.performed_by), date: m.event_date });
  });

  const { data: events } = await sb.from("contractor_events")
    .select("contractor_name, event_date, location, is_deleted")
    .not("contractor_name", "is", null).neq("contractor_name", "")
    .gte("event_date", cutoff);
  events?.filter(e => e.is_deleted !== true).forEach(e => {
    if (e.event_date && e.contractor_name) {
      visits.push({ name: normName(e.contractor_name), date: e.event_date, location: e.location });
    }
  });

  // Group by name
  const byName = new Map<string, { date: string; location?: string }[]>();
  for (const v of visits) {
    if (!byName.has(v.name)) byName.set(v.name, []);
    byName.get(v.name)!.push({ date: v.date, location: v.location });
  }

  let written = 0;

  for (const [name, list] of byName) {
    if (list.length < 3) continue;

    // Sort by date, dedupe same-day
    const dates = [...new Set(list.map(v => v.date))].sort();
    if (dates.length < 3) continue;

    // Intervals between consecutive visits
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(daysBetween(dates[i - 1], dates[i]));
    }

    // Outlier filter: drop intervals < 0.5x or > 2x the median
    const sorted = intervals.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const filtered = intervals.filter(i => i >= median * 0.5 && i <= median * 2);
    if (filtered.length < 2) continue;

    const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    const variance = filtered.reduce((s, v) => s + (v - mean) ** 2, 0) / filtered.length;
    const stdev = Math.sqrt(variance);
    const cv = mean > 0 ? stdev / mean : 1;
    const confidence = Math.max(0.1, Math.min(0.99, 1 - cv));

    const last = dates[dates.length - 1];
    const next = addDays(last, Math.round(mean));
    const location = list.filter(v => v.date === last).map(v => v.location).find(Boolean);

    const { error } = await sb.from("patterns").upsert({
      pattern_type: "contractor_visit",
      entity_name: name,
      interval_days: Math.round(mean),
      occurrences: dates,
      last_occurrence: last,
      next_predicted: next,
      confidence: parseFloat(confidence.toFixed(2)),
      location: location || null,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "pattern_type,entity_name" });

    if (!error) written++;
    else console.warn("[Patterns] upsert failed:", error.message);
  }

  return { scanned: byName.size, written };
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

// ═══════════════════════════════════════════════════════════════════════
//  ALERT GATHERERS
// ═══════════════════════════════════════════════════════════════════════

async function gatherPatternAlerts(sb: SupabaseClient, today: string, in3: string): Promise<Alert[]> {
  const { data } = await sb.from("patterns")
    .select("id, entity_name, next_predicted, interval_days, occurrences, confidence, location")
    .eq("active", true)
    .gte("next_predicted", today).lte("next_predicted", in3)
    .gte("confidence", 0.5);

  return (data || []).map(p => {
    const days = daysBetween(today, p.next_predicted);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const occ = Array.isArray(p.occurrences) ? p.occurrences.length : 0;
    return {
      alert_type: "pattern_due",
      entity_id: String(p.id),
      entity_kind: "pattern",
      title: `🔮 ${cap(p.entity_name)} likely ${when}`,
      body: `Based on ${occ} prior visits ~${p.interval_days}d apart (${Math.round((p.confidence || 0) * 100)}% confident)${p.location ? " · " + p.location : ""}`,
      data: { view: "log", pattern_id: p.id, location: p.location },
      priority: days <= 1 ? "high" : "normal",
    } as Alert;
  });
}

async function gatherPMAlerts(sb: SupabaseClient, today: string, in7: string): Promise<Alert[]> {
  const { data } = await sb.from("equipment")
    .select("id, name, location, area, next_pm_date, qr_code, is_deleted")
    .neq("status", "retired")
    .not("next_pm_date", "is", null)
    .gte("next_pm_date", today).lte("next_pm_date", in7);

  return (data || []).filter(e => e.is_deleted !== true).map(e => {
    const days = daysBetween(today, e.next_pm_date);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    return {
      alert_type: "pm_due",
      entity_id: String(e.id),
      entity_kind: "equipment",
      title: `🔧 PM due ${when}: ${e.name}`,
      body: `${e.location || ""}${e.area ? " · " + e.area : ""} — preventive maintenance scheduled`,
      data: { view: "equipment", equipment_id: e.id, qr_code: e.qr_code },
      priority: days <= 1 ? "high" : "normal",
    } as Alert;
  });
}

async function gatherWarrantyAlerts(sb: SupabaseClient, today: string, in30: string): Promise<Alert[]> {
  const { data } = await sb.from("equipment")
    .select("id, name, location, warranty_until, manufacturer, model, is_deleted")
    .neq("status", "retired")
    .not("warranty_until", "is", null)
    .gte("warranty_until", today).lte("warranty_until", in30);

  return (data || []).filter(e => e.is_deleted !== true).map(e => {
    const days = daysBetween(today, e.warranty_until);
    const make = [e.manufacturer, e.model].filter(Boolean).join(" ") || "Unit";
    return {
      alert_type: "warranty_expiring",
      entity_id: String(e.id),
      entity_kind: "equipment",
      title: `🛡️ Warranty expires in ${days}d: ${e.name}`,
      body: `${make} @ ${e.location || ""}. Last chance for warranty repair claims.`,
      data: { view: "equipment", equipment_id: e.id },
      priority: days <= 7 ? "high" : "normal",
    } as Alert;
  });
}

async function gatherStaleDispatchAlerts(sb: SupabaseClient): Promise<Alert[]> {
  const dayAgo  = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data } = await sb.from("dispatch_log")
    .select("id, equipment_id, contractor_name, method, created_at")
    .eq("outcome", "pending")
    .lt("created_at", dayAgo).gt("created_at", weekAgo)
    .limit(20);

  return (data || []).map(d => {
    const hoursAgo = Math.round((Date.now() - new Date(d.created_at).getTime()) / 3600000);
    return {
      alert_type: "dispatch_stale",
      entity_id: String(d.id),
      entity_kind: "dispatch",
      title: `📞 No reply from ${d.contractor_name || "contractor"}`,
      body: `${cap(d.method || "Contact")} sent ${hoursAgo}h ago — still pending. Tap to follow up.`,
      data: { view: "equipment", equipment_id: d.equipment_id, dispatch_id: d.id },
      priority: "normal",
    } as Alert;
  });
}

async function dedupeAlerts(sb: SupabaseClient, alerts: Alert[], today: string): Promise<Alert[]> {
  if (!alerts.length) return [];
  const keys = alerts.map(a => dedupeKey(a, today));
  const { data: existing } = await sb.from("notify_log")
    .select("dedupe_key").in("dedupe_key", keys);
  const seen = new Set((existing || []).map(r => r.dedupe_key));
  return alerts.filter(a => !seen.has(dedupeKey(a, today)));
}

function dedupeKey(a: Alert, today: string): string {
  return `${a.alert_type}:${a.entity_id}:${today}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  AUDIENCE FILTERS (for manual broadcasts)
// ═══════════════════════════════════════════════════════════════════════

function filterAudience(
  webSubs: any[],
  nativeUsers: any[],
  audience: string | null
): any[] {
  if (!audience || audience === "all") return webSubs;
  // For role-based audiences we need to look up user_id → role
  const roleByUserId = new Map<string, string>();
  for (const u of nativeUsers) roleByUserId.set(String(u.id), u.role);
  if (audience === "managers") {
    return webSubs.filter(s => {
      const r = roleByUserId.get(String(s.user_id));
      return r === "manager" || r === "admin";
    });
  }
  if (audience === "staff") {
    return webSubs.filter(s => roleByUserId.get(String(s.user_id)) === "staff");
  }
  // Single user_id
  return webSubs.filter(s => String(s.user_id) === String(audience));
}

function filterNativeAudience(nativeUsers: any[], audience: string | null): any[] {
  if (!audience || audience === "all") return nativeUsers;
  if (audience === "managers") return nativeUsers.filter(u => u.role === "manager" || u.role === "admin");
  if (audience === "staff") return nativeUsers.filter(u => u.role === "staff");
  return nativeUsers.filter(u => String(u.id) === String(audience));
}

// ═══════════════════════════════════════════════════════════════════════
//  PAYLOAD
// ═══════════════════════════════════════════════════════════════════════

function makePayload(alert: Alert): Record<string, unknown> {
  return {
    title: alert.title,
    body: alert.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `${alert.alert_type}_${alert.entity_id}`,
    data: { ...alert.data, alert_type: alert.alert_type, ts: Date.now() },
    priority: alert.priority,
  };
}

function parseSub(raw: any): PushSub {
  if (typeof raw === "string") raw = JSON.parse(raw);
  if (!raw?.endpoint || !raw?.keys?.p256dh || !raw?.keys?.auth) {
    throw new Error("Invalid subscription shape");
  }
  return raw as PushSub;
}

// ═══════════════════════════════════════════════════════════════════════
//  WEB PUSH — RFC 8291 (aes128gcm) + RFC 8292 (VAPID)
// ═══════════════════════════════════════════════════════════════════════

function readVapidConfig(): VapidConfig | null {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_JWK");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:ops@nexus.local";
  if (!pub || !priv) return null;
  try {
    return { publicKeyB64u: pub, privateJwk: JSON.parse(priv), subject };
  } catch {
    console.error("[Notify] VAPID_PRIVATE_JWK is not valid JSON");
    return null;
  }
}

async function sendWebPush(
  sub: PushSub,
  payload: Record<string, unknown>,
  vapid: VapidConfig
): Promise<void> {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  // 1. Decode subscription keys
  const uaPublic = b64uDecode(sub.keys.p256dh);   // 65 bytes uncompressed P-256 point
  const authSecret = b64uDecode(sub.keys.auth);    // 16 bytes

  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error("Subscription public key must be 65-byte uncompressed P-256");
  }
  if (authSecret.length !== 16) {
    throw new Error("Subscription auth must be 16 bytes");
  }

  // 2. Generate ephemeral ECDH keypair (one-time, per push)
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  ) as CryptoKeyPair;
  const asPublicJwk = await crypto.subtle.exportKey("jwk", ephemeral.publicKey) as JsonWebKey;
  const asPublicRaw = jwkToRawP256(asPublicJwk);   // 65 bytes uncompressed

  // 3. Import UA public key for ECDH
  const uaPublicKey = await crypto.subtle.importKey(
    "raw", uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false, []
  );

  // 4. ECDH → 32-byte shared secret
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey },
    ephemeral.privateKey, 256
  ));

  // 5. First HKDF: combine ECDH with subscription's auth_secret
  //    key_info = "WebPush: info\0" || ua_public || as_public
  const keyInfo = concat(
    new TextEncoder().encode("WebPush: info\0"),
    uaPublic, asPublicRaw
  );
  const ikm = await hkdfSha256(authSecret, ecdhSecret, keyInfo, 32);

  // 6. Random salt for this push
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 7. Second HKDF (per RFC 8188): derive CEK and NONCE
  const cek = await hkdfSha256(
    salt, ikm,
    new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16
  );
  const nonce = await hkdfSha256(
    salt, ikm,
    new TextEncoder().encode("Content-Encoding: nonce\0"), 12
  );

  // 8. Pad: data || 0x02 (last-record delimiter per RFC 8188)
  const padded = concat(payloadBytes, new Uint8Array([0x02]));

  // 9. AES-128-GCM encrypt → ciphertext + 16-byte tag
  const cekKey = await crypto.subtle.importKey(
    "raw", cek, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cekKey, padded
  ));

  // 10. Build aes128gcm header per RFC 8188 §2.1:
  //     salt(16) || rs(4 BE) || idlen(1) || keyid(idlen)
  //     For Web Push, keyid = ephemeral public key (65 bytes)
  const recordSize = ciphertext.length;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer, 16, 4).setUint32(0, recordSize, false);
  header[20] = 65;
  header.set(asPublicRaw, 21);

  const body = concat(header, ciphertext);

  // 11. VAPID JWT (ES256-signed)
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const jwt = await signES256(
    { typ: "JWT", alg: "ES256" },
    { aud: audience, exp, sub: vapid.subject },
    vapid.privateJwk
  );

  // 12. POST to push service
  const resp = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Length": String(body.length),
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": payload.priority === "high" ? "high" : "normal",
      "Authorization": `vapid t=${jwt}, k=${vapid.publicKeyB64u}`,
    },
    body,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Web push ${resp.status}: ${errText.slice(0, 200)}`);
  }
}

async function hkdfSha256(
  salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", ikm, { name: "HKDF" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key, length * 8
  );
  return new Uint8Array(bits);
}

function jwkToRawP256(jwk: JsonWebKey): Uint8Array {
  if (!jwk.x || !jwk.y) throw new Error("JWK missing x/y");
  const x = b64uDecode(jwk.x);
  const y = b64uDecode(jwk.y);
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

async function signES256(
  header: object, claims: object, privateJwk: JsonWebKey
): Promise<string> {
  const headerB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  const key = await crypto.subtle.importKey(
    "jwk", privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key, new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64uEncode(new Uint8Array(sig))}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  FCM HTTP v1 (service-account-signed)
// ═══════════════════════════════════════════════════════════════════════

let _fcmTokenCache: { token: string; exp: number } | null = null;

async function sendFCM(
  deviceToken: string,
  payload: Record<string, unknown>,
  serviceAccountJson: string
): Promise<void> {
  const sa = JSON.parse(serviceAccountJson);
  const accessToken = await getFCMAccessToken(sa);

  // FCM data values must all be strings
  const data = Object.fromEntries(
    Object.entries((payload.data as Record<string, unknown>) || {})
      .map(([k, v]) => [k, String(v)])
  );

  const message = {
    message: {
      token: deviceToken,
      notification: { title: payload.title, body: payload.body },
      data,
      android: {
        priority: payload.priority === "high" ? "HIGH" : "NORMAL",
        notification: {
          tag: payload.tag,
          channel_id: "nexus_alerts",
          icon: "ic_notification",
        },
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
    const errText = await resp.text();
    throw new Error(`FCM ${resp.status}: ${errText.slice(0, 200)}`);
  }
}

async function getFCMAccessToken(sa: any): Promise<string> {
  if (_fcmTokenCache && _fcmTokenCache.exp > Date.now() + 60_000) {
    return _fcmTokenCache.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const jwt = await signRS256(
    { typ: "JWT", alg: "RS256" },
    claims, sa.private_key
  );
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    throw new Error(`FCM token ${resp.status}: ${await resp.text()}`);
  }
  const j = await resp.json();
  _fcmTokenCache = {
    token: j.access_token,
    exp: Date.now() + (j.expires_in - 60) * 1000,
  };
  return j.access_token;
}

async function signRS256(
  header: object, claims: object, pemKey: string
): Promise<string> {
  const headerB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  // Strip PEM headers and any \n escapes (service account JSON has \n)
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64uEncode(new Uint8Array(sig))}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function localDateStr(timezone: string, baseDate?: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(baseDate || new Date());  // "2026-04-21"
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T12:00:00Z").getTime();
  const db = new Date(b + "T12:00:00Z").getTime();
  return Math.round((db - da) / 86400000);
}

function cap(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

function jsonResp(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
