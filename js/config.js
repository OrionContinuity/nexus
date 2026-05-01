/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Config — shared Supabase credentials + proxy header

   Loaded FIRST in index.html <head>, before equipment-public-scan.js and
   app.js. Both read from window.NEXUS_CONFIG so there's ONE place to
   update values when they rotate.

   ─────────── Two values here, neither is a real secret ───────────

   SUPABASE_ANON
     Publishable key. Safe to embed publicly. Supabase explicitly labels
     these "safe to use in a browser if you have enabled Row Level
     Security (RLS)."

   NX_PROXY_SECRET
     A "speed bump" header value sent on every call to the JWT-off edge
     functions (/chat, /translate, /markitdown). Because it lives in the
     client code, anyone who reads this file can extract it. That is OK
     and intentional. Its only job is to deflect drive-by abuse — random
     internet bots scanning Supabase for open endpoints will get 401'd
     because they don't know to send the header. A determined attacker
     who reads this file can still abuse the endpoints; they're rate-
     limited by Supabase platform defaults.

     For real protection on these endpoints we'd need real auth (Supabase
     JWTs from an actual sign-in), which is a separate migration project.

   ─────────── What does NOT belong here ───────────

   NEVER put the sb_secret_* (service role) key here. That belongs in
   Supabase Edge Function environment variables only — never in client
   code.

   NEVER put the Anthropic API key, Google client secret, ElevenLabs
   key, or any provider key here. Those live in Edge Function secrets.
   ═══════════════════════════════════════════════════════════════════════ */
window.NEXUS_CONFIG = {
  SUPABASE_URL:  'https://oprsthfxqrdbwdvommpw.supabase.co',
  SUPABASE_ANON: 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9',

  // Speed-bump header. Generate any random ~32-char string and put it
  // here. Then add the SAME string to Supabase Edge Function secrets
  // as `NX_PROXY_SECRET`. See deploy notes in phase-d.md.
  NX_PROXY_SECRET: '__SET_ME__',
};
