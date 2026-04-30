// NEXUS Translate — on-demand content translation with durable cache.
//
// Why an edge function and not a client-side call?
//   - Anthropic API key stays server-side (never ships to browser)
//   - The cache is shared across ALL users — once someone on the team
//     translates a vendor email, everyone else gets it free
//   - Rate-limiting & retry logic lives in one place
//
// Cache strategy: SHA-256 of normalized content + target_lang is the
// key. Same text → same translation → single row, reused forever. A
// busy kitchen with 5 Spanish-speaking cooks reading the same vendor
// email sees one API call, four cache hits.
//
// Usage:
//   POST /translate
//   body: { text: "...", target: "es" }
//   body: { text: "...", target: "es", source: "en" }  // optional hint
//   body: { text: "...", target: "es", force: true }   // skip cache
//
// Response:
//   { translated: "...", source_lang: "en", cached: false, hash: "..." }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

// Languages we support. Add more anytime — Claude handles most of the
// world's languages, this is just the allow-list for UI validation.
const SUPPORTED = new Set(["en", "es", "fr", "pt", "it", "de", "zh", "ja", "ko", "vi", "ar", "hi"]);

// Content hash — used for cache key. Normalizes whitespace + case so
// "Hello World" and "hello  world" share a translation. Length-bounded
// so we don't build obscene strings in JS.
async function hashContent(text: string, target: string): Promise<string> {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 10000);
  const buffer = new TextEncoder().encode(`${target}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, texts, target, source, force } = body;

    if (!target || !SUPPORTED.has(target)) {
      throw new Error(`unsupported target language: ${target}`);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const sb = createClient(supabaseUrl, supabaseKey);

    // ── BATCH MODE ─────────────────────────────────────────────────
    // When the client sends a `texts: string[]`, translate all of them
    // in one request. This is how NX.tr.translatePage() bulk-translates
    // a whole UI. Each string is still hashed + cached independently so
    // we don't pay for the same phrase twice across pages.
    if (Array.isArray(texts)) {
      if (texts.length === 0) {
        return new Response(JSON.stringify({ translations: [], source_lang: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (texts.length > 50) throw new Error("max 50 texts per batch");

      // Cache-check each, collect cache misses for a single Claude call
      const results: string[] = new Array(texts.length);
      const misses: { index: number; text: string; hash: string }[] = [];

      await Promise.all(texts.map(async (t, idx) => {
        const input = String(t || "").slice(0, 20000);
        if (input.trim().length < 2) { results[idx] = input; return; }
        const hash = await hashContent(input, target);
        if (!force) {
          const { data: cached } = await sb.from("translations")
            .select("translated").eq("hash", hash).maybeSingle();
          if (cached) {
            results[idx] = cached.translated;
            // bump last_used_at async
            sb.from("translations").update({ last_used_at: new Date().toISOString() })
              .eq("hash", hash).then(() => {}).catch(() => {});
            return;
          }
        }
        misses.push({ index: idx, text: input, hash });
      }));

      // One Claude call for ALL cache misses, using a numbered delimiter
      // format so we can split the response reliably. Each item is wrapped
      // in <t N>...</t N> tags; Claude returns the same structure.
      if (misses.length > 0) {
        const targetName: Record<string, string> = {
          en: "English", es: "Spanish", fr: "French", pt: "Portuguese",
          it: "Italian", de: "German", zh: "Chinese (Simplified)",
          ja: "Japanese", ko: "Korean", vi: "Vietnamese", ar: "Arabic", hi: "Hindi",
        };
        const targetLabel = targetName[target] || target;
        const wrapped = misses.map((m, i) => `<t${i}>${m.text}</t${i}>`).join("\n");

        const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            system: `You are a professional translator for a restaurant operations app. Translate each numbered segment to ${targetLabel}. Preserve the <tN>...</tN> tags exactly. Inside each tag, output only the translation — no commentary. If a segment is already in ${targetLabel}, output it unchanged. Preserve line breaks, model numbers, and technical terms.`,
            messages: [{ role: "user", content: wrapped }],
          }),
        });
        if (!claudeResp.ok) {
          const errTxt = await claudeResp.text();
          throw new Error(`Claude API ${claudeResp.status}: ${errTxt.slice(0, 200)}`);
        }
        const claudeData = await claudeResp.json();
        const raw = claudeData.content?.[0]?.text || "";

        // Parse numbered tags back out. If a tag is missing, fall back
        // to the original (never show "undefined" to the user).
        const writes: any[] = [];
        misses.forEach((m, i) => {
          const re = new RegExp(`<t${i}>([\\s\\S]*?)</t${i}>`);
          const match = raw.match(re);
          const translated = match ? match[1].trim() : m.text;
          results[m.index] = translated;
          writes.push({
            hash: m.hash,
            source_text: m.text.slice(0, 5000),
            source_lang: "auto",
            target_lang: target,
            translated,
            char_count: m.text.length,
            created_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          });
        });
        // Bulk upsert cache in the background — don't block response
        if (writes.length) {
          sb.from("translations").upsert(writes, { onConflict: "hash" })
            .then(() => {}).catch((e) => console.warn("[translate] batch cache write:", e));
        }
      }

      return new Response(JSON.stringify({ translations: results, batched: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SINGLE MODE ────────────────────────────────────────────────
    if (!text || typeof text !== "string") {
      throw new Error("missing text");
    }
    const input = String(text).slice(0, 20000);
    if (input.length < 2) {
      return new Response(JSON.stringify({ translated: input, source_lang: target, cached: true, hash: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hash = await hashContent(input, target);

    // Cache hit?
    if (!force) {
      const { data: cached } = await sb.from("translations")
        .select("translated, source_lang, created_at")
        .eq("hash", hash).maybeSingle();
      if (cached) {
        sb.from("translations").update({ last_used_at: new Date().toISOString() }).eq("hash", hash).then(() => {}).catch(() => {});
        return new Response(JSON.stringify({
          translated: cached.translated,
          source_lang: cached.source_lang,
          cached: true,
          hash,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const targetName: Record<string, string> = {
      en: "English", es: "Spanish", fr: "French", pt: "Portuguese",
      it: "Italian", de: "German", zh: "Chinese (Simplified)",
      ja: "Japanese", ko: "Korean", vi: "Vietnamese", ar: "Arabic", hi: "Hindi",
    };
    const targetLabel = targetName[target] || target;
    const sourceHint = source && SUPPORTED.has(source)
      ? `The source language is ${targetName[source] || source}. `
      : "Detect the source language automatically. ";

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: `You are a professional translator for a restaurant operations app. ${sourceHint}Translate the user's text to ${targetLabel}. Preserve formatting (line breaks, bullet points, technical terms like model numbers). Do not add commentary, disclaimers, or explanations. Output ONLY the translation, nothing else. If the text is already in ${targetLabel}, output it unchanged.`,
        messages: [{ role: "user", content: input }],
      }),
    });
    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      throw new Error(`Claude API ${claudeResp.status}: ${errTxt.slice(0, 200)}`);
    }
    const claudeData = await claudeResp.json();
    const translated = claudeData.content?.[0]?.text?.trim() || "";
    if (!translated) throw new Error("empty translation from Claude");

    const detectedSource = translated.trim() === input.trim()
      ? target
      : (source && SUPPORTED.has(source) ? source : "auto");

    sb.from("translations").upsert({
      hash,
      source_text: input.slice(0, 5000),
      source_lang: detectedSource,
      target_lang: target,
      translated,
      char_count: input.length,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    }, { onConflict: "hash" }).then(() => {}).catch((e) => console.warn("[translate] cache write:", e));

    return new Response(JSON.stringify({
      translated,
      source_lang: detectedSource,
      cached: false,
      hash,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[translate] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
