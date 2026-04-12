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

# Google OAuth (enables Gmail auto-pull without browser)
# Get these from console.cloud.google.com → Credentials → your OAuth Client
supabase secrets set GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
supabase secrets set GOOGLE_CLIENT_SECRET=GOCSPX-YOUR_SECRET

# Generate VAPID keys for push notifications (run once):
# npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
supabase secrets set VAPID_PRIVATE_KEY=YOUR_PRIVATE_KEY
supabase secrets set VAPID_EMAIL=alfredo@suerte-austin.com
```

### Gmail Permanent Access

After setting Google secrets, connect Gmail **once** in the browser:

1. Open NEXUS → Ingest tab → Connect Gmail
2. Google asks for permission → Allow
3. NEXUS exchanges the auth code for a **refresh token** server-side
4. Refresh token stored in `nexus_config` — never expires
5. `process-emails` cron now auto-pulls Gmail every 30 min, no browser needed

The status badge shows **"✓ Permanent"** when the refresh token is saved.

If you need to get the Client Secret:
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials
3. Click your OAuth 2.0 Client ID
4. Copy the Client Secret

## Step 4: Deploy Functions

```bash
# From your nexus repo root:
supabase functions deploy chat
supabase functions deploy process-emails
supabase functions deploy weekly-digest
supabase functions deploy push-notify
supabase functions deploy markitdown
supabase functions deploy slack-ingest
```

## Step 4b: Slack Integration

### Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From Scratch**
2. Name it **NEXUS** and pick your workspace

### Set Permissions

Go to **OAuth & Permissions** → **Bot Token Scopes**, add:
- `channels:history` — read public channel messages
- `groups:history` — read private channel messages  
- `im:history` — read DMs
- `users:read` — resolve user names

### Enable Events (real-time)

Go to **Event Subscriptions** → toggle ON → **Request URL**:
```
https://oprsthfxqrdbwdvommpw.supabase.co/functions/v1/slack-ingest
```
Slack will verify the URL automatically.

Under **Subscribe to bot events**, add:
- `message.channels`
- `message.groups`
- `message.im`

### Install & Save Token

1. Go to **Install App** → **Install to Workspace** → Authorize
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
3. Save it:
```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-YOUR-TOKEN-HERE
```

### Invite the Bot

In Slack, invite NEXUS to channels you want monitored:
```
/invite @NEXUS
```

Messages in those channels now auto-feed into the brain.

### Manual Pull (optional)

To backfill history from a channel, call:
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/slack-ingest \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"pull","channel":"C0123ABCDEF","limit":200}'
```

Get channel IDs by right-clicking a channel in Slack → **View channel details** → scroll to bottom.

## Step 5: Run SQL Migrations

Run each block separately in Supabase SQL Editor:

```sql
-- Unified cards table (replaces tickets + kanban_cards)
CREATE TABLE IF NOT EXISTS cards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  notes text,
  status text DEFAULT 'todo' CHECK (status IN ('todo','doing','done','closed')),
  assignee text,
  location text,
  due_date date,
  priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','urgent')),
  tags text[] DEFAULT '{}',
  source text DEFAULT 'manual',
  source_ref text,
  photo_url text,
  ai_troubleshoot text,
  reported_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cards_all" ON cards FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_priority ON cards(priority);
CREATE INDEX idx_cards_due ON cards(due_date);
```

```sql
-- Migrate existing tickets into cards
INSERT INTO cards (title, notes, status, location, priority, photo_url, ai_troubleshoot, reported_by, source, created_at)
SELECT
  COALESCE(title, notes, 'Untitled'),
  notes,
  CASE WHEN status = 'open' THEN 'todo' WHEN status = 'closed' THEN 'closed' ELSE 'todo' END,
  location,
  COALESCE(priority, 'normal'),
  photo_url,
  ai_troubleshoot,
  reported_by,
  'ticket',
  created_at
FROM tickets
ON CONFLICT DO NOTHING;
```

```sql
-- Migrate existing kanban_cards into cards
INSERT INTO cards (title, status, location, due_date, source, created_at)
SELECT
  title,
  CASE WHEN column_name = 'in_progress' THEN 'doing' ELSE COALESCE(column_name, 'todo') END,
  location,
  due_date,
  'legacy',
  created_at
FROM kanban_cards
ON CONFLICT DO NOTHING;
```

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
