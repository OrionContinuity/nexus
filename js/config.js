/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Config — shared Supabase credentials
   
   Loaded FIRST in index.html <head>, before equipment-public-scan.js and
   app.js. Both read from window.NEXUS_CONFIG so there's ONE place to
   update the publishable key when it rotates.
   
   Note: publishable keys are safe to embed publicly. They are not secrets.
   The Supabase dashboard explicitly labels these "safe to use in a
   browser if you have enabled Row Level Security (RLS)."
   
   NEVER put the sb_secret_* key here. That belongs in Supabase Edge
   Function environment variables only — never in client code.
   ═══════════════════════════════════════════════════════════════════════ */
window.NEXUS_CONFIG = {
  SUPABASE_URL:  'https://oprsthfxqrdbwdvommpw.supabase.co',
  SUPABASE_ANON: 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9',
};
