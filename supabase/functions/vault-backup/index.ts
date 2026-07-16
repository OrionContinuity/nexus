// vault-backup — nightly full-data snapshot of every public table.
// Dumps each table to JSON (service role: sees everything, bypasses RLS),
// gzips the bundle, stores it in the private 'backups' bucket as
// snapshots/YYYY-MM-DD.json.gz, and prunes snapshots older than 30 days.
//
// Auth: verify_jwt is OFF (the app's publishable key isn't a JWT), so the
// caller must present the shared secret from nexus_config.backup_secret
// via the x-backup-key header. pg_cron sends it; nobody else can read it
// (nexus_config is locked to anon).
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Shared-secret gate
  const { data: cfg, error: cfgErr } = await sb
    .from('nexus_config').select('backup_secret').eq('id', 1).single();
  if (cfgErr || !cfg?.backup_secret) {
    return new Response(JSON.stringify({ error: 'config unavailable' }), { status: 500 });
  }
  const presented = req.headers.get('x-backup-key') || '';
  if (presented !== cfg.backup_secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const started = Date.now();
  const { data: tables, error: tErr } = await sb.rpc('backup_table_list');
  if (tErr || !Array.isArray(tables)) {
    return new Response(JSON.stringify({ error: 'table list failed: ' + (tErr?.message || '') }), { status: 500 });
  }

  const dump: Record<string, unknown[]> = {};
  const failures: Record<string, string> = {};
  for (const t of tables) {
    const rows: unknown[] = [];
    let from = 0;
    // paginate 1000/batch; tolerate any single table failing
    for (;;) {
      const { data, error } = await sb.from(t).select('*').range(from, from + 999);
      if (error) { failures[t] = error.message; break; }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    dump[t] = rows;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const payload = {
    vault: 'NEXUS-BACKUP',
    taken_at: new Date().toISOString(),
    project: 'oprsthfxqrdbwdvommpw',
    tables: Object.keys(dump).length,
    row_counts: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, (v as unknown[]).length])),
    failures,
    data: dump,
  };

  // gzip via web streams
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const gzStream = new Blob([jsonBytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const gzBytes = new Uint8Array(await new Response(gzStream).arrayBuffer());

  const path = `snapshots/${stamp}.json.gz`;
  const { error: upErr } = await sb.storage.from('backups')
    .upload(path, gzBytes, { contentType: 'application/gzip', upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ error: 'upload failed: ' + upErr.message }), { status: 500 });
  }

  // prune snapshots older than 30 days
  let pruned = 0;
  try {
    const { data: files } = await sb.storage.from('backups').list('snapshots', { limit: 200 });
    const cutoff = Date.now() - 30 * 86400000;
    const old = (files || []).filter(f => {
      const m = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(f.name);
      return m && new Date(m[1] + 'T00:00:00Z').getTime() < cutoff;
    }).map(f => 'snapshots/' + f.name);
    if (old.length) {
      await sb.storage.from('backups').remove(old);
      pruned = old.length;
    }
  } catch (_) { /* pruning is best-effort */ }

  return new Response(JSON.stringify({
    ok: true, path,
    tables: payload.tables,
    total_rows: Object.values(payload.row_counts).reduce((a: number, b) => a + (b as number), 0),
    bytes_gz: gzBytes.length,
    failures,
    pruned,
    ms: Date.now() - started,
  }), { headers: { 'Content-Type': 'application/json' } });
});
