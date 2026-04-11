# NEXUS Edge Functions — Setup Guide

## Prerequisites
- Supabase Pro plan (you have this — $25/mo)
- Supabase CLI installed
- Node.js 18+ installed

## Step 1: Install Supabase CLI

```bash
npm install -g supabase
```

## Step 2: Login & Link

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is in your Supabase dashboard URL:
`https://supabase.com/dashboard/project/YOUR_PROJECT_REF`

## Step 3: Set Secrets

```bash
# Your Anthropic API key (currently exposed in browser — this fixes that)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY_HERE

# Generate VAPID keys for push notifications (run once):
# npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
supabase secrets set VAPID_PRIVATE_KEY=YOUR_PRIVATE_KEY
supabase secrets set VAPID_EMAIL=alfredo@suerte-austin.com
```

## Step 4: Deploy Functions

```bash
# From your nexus repo root:
supabase functions deploy chat
supabase functions deploy process-emails
supabase functions deploy weekly-digest
supabase functions deploy push-notify
```

## Step 5: Run SQL Migrations

Run each block separately in Supabase SQL Editor:

```sql
-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id serial PRIMARY KEY,
  user_id integer,
  user_name text,
  subscription jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_all" ON push_subscriptions FOR ALL USING (true) WITH CHECK (true);
```

```sql
-- Enable pg_cron (Pro plan required)
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

```sql
-- Enable pg_net for HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS pg_net;
```

```sql
-- Process emails every 30 minutes
SELECT cron.schedule(
  'nexus-process-emails',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-emails',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    )
  );
  $$
);
```

```sql
-- Weekly digest every Monday at 7 AM Central (12:00 UTC)
SELECT cron.schedule(
  'nexus-weekly-digest',
  '0 12 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/weekly-digest',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    )
  );
  $$
);
```

Replace `YOUR_PROJECT_REF` and `YOUR_SERVICE_ROLE_KEY` with your actual values.
Find your service role key at: Settings → API → service_role (secret)

## Step 6: Update NEXUS to use Edge Functions

In `js/app.js`, the chat function should call:
```javascript
const { data } = await NX.sb.functions.invoke('chat', {
  body: { messages, system }
});
```

Instead of calling the Anthropic API directly from the browser.

## Architecture After Setup

```
Your Phone (NEXUS PWA)
    │
    ├─── Chat ──────→ Edge Function: chat ──→ Claude API
    │                     (API key hidden)
    │
    ├─── Browse ────→ Supabase (direct, anon key)
    │
    └─── Notifications ←── Push from Edge Functions

Supabase Server (runs 24/7):
    │
    ├─── pg_cron (every 30 min) → process-emails → Claude → nodes
    │                                              → triage → push-notify
    │
    └─── pg_cron (Monday 7 AM) → weekly-digest → Claude → daily_logs
                                                → push-notify
```

## Verify It Works

```bash
# Test chat function
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'

# Test process-emails (will process any unprocessed emails)
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/process-emails \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

# Check pg_cron jobs
SELECT * FROM cron.job;

# Check pg_cron history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

## Costs

| Component | Monthly Cost |
|-----------|-------------|
| Supabase Pro | $25 (already paying) |
| Edge Function invocations | Free (under 500K) |
| pg_cron | Included in Pro |
| Claude API (process-emails) | ~$2-5 (depends on volume) |
| Claude API (weekly-digest) | ~$0.10 (4 calls/month) |
| Web Push | Free |
| **Total additional** | **~$2-5/month** |
