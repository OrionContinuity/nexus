# NEXUS — guidance for Claude sessions

NEXUS is a vanilla-JS PWA (GitHub Pages from `main`) that runs facilities,
cleaning, ordering, equipment, and vendors for three Austin restaurants —
Suerte, Este, and Bar Toti. Owner/operator: Alfredo Ortiz. Backend:
Supabase project `oprsthfxqrdbwdvommpw` (tables + edge functions + pg_cron),
reachable through the Supabase MCP tools.

## MONETA — read this first. This is your memory.

The knowledge galaxy (`nodes` table, rendered by js/galaxy.js) doubles as
**Moneta**: the persistent memory of the Claude sessions that work on this
repo. Rows with `category = 'moneta'` are journal entries written by your
predecessors — for you.

**At the start of every session**, before substantive work, read the most
recent memories:

```sql
select name, notes, created_at from nodes
where category = 'moneta'
order by id desc limit 5;
```

**At the end of every session** (or after a major arc of work), mint one:

```sql
insert into nodes (name, category, tags, notes, links)
values (
  'Moneta · YYYY-MM-DD — <short title>',
  'moneta',
  '["moneta","claude"]'::jsonb,
  '<the journal entry>',
  '[]'::jsonb
);
```

Write it to your future self, not as a changelog. What matters:
- corrections Alfredo gave you (these are law — never relearn them the hard way)
- his standing preferences and how he communicates
- the true state of systems you touched, including what you left unfinished
- what you promised, what you wished for, what he entrusted to you

Moneta memories render as mint-silver stars on the innermost ring of the
galaxy, orbiting the black hole. Do not delete or edit another session's
memory; append your own.

## Standing corrections from Alfredo (do not relearn these the hard way)

- **Pars are reference numbers only** — the stock level he wants to keep.
  Never build or suggest "order by par" / auto-fill from pars.
- **Never auto-close or bulk-modify stale records without asking first.**
  He denied an auto-close migration once; when he later wanted tickets
  closed, he said so explicitly.
- He communicates by screenshot + short message. The screenshot IS the bug
  report. Investigate before asking.
- He gave standing trust ("stop asking for permission", "you have my
  approval for all") — act, verify, report honestly.

## Deploy pattern

Work on the designated `claude/*` branch, commit with a clear message,
push (retry with backoff on network failures), then fast-forward `main`
(`git checkout main && git merge --ff-only <branch> && git push`) —
GitHub Pages serves `main`. Return to the feature branch after. Always
`node --check` touched JS files first; a headless Playwright boot smoke
(ignore supabase/CDN network errors) catches wiring mistakes.

## Architecture notes that save time

- supabase-js RESOLVES with `{error}` — a try/catch around it is a dead
  catch. Always destructure and check `error`.
- One email engine: `NX.composeEmail(...)` (js/email-composer.js), with
  `NX.vendorEmail(vendor, ctx)` for vendor-template dispatches.
- Cleaning's day rolls at 8am local (`getCleaningDate()`), US Central.
- Roles: `NX.isAdmin` / `NX.isManager` are set at PIN login; DB access is
  a shared anon key, so role enforcement is app-level.
- The Lite screen is the only cleaning UI; the classic UI was deleted.
