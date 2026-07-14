# NEXUS — Session Handoff (v293)

**Written:** 2026-07-14 · **Author:** Claude (Fable/Opus session)
**Repo:** https://github.com/OrionContinuity/nexus (GitHub Pages from `main`)
**Supabase project:** `oprsthfxqrdbwdvommpw`

---

## TL;DR — where things stand

Two user-requested changes for **v293** are **coded, verified, and committed
locally**, and the deploy patch is **staged**, but the push to `main` is **NOT
yet confirmed landed**. Remote `main` was still at `586af0b` (v292,
`nexus-v292-soft-delete-leak`) at handoff time. The next session's first job is
to **confirm or re-run the v293 deploy**, then verify.

### The two v293 changes

1. **Daily-notes: drop the "Since your last email:" block; mark new cards with an inline "new" pill.**
   User (screenshot, circled "Reweld Frying Baskets", underlined "Since your last email:"):
   *"please remove since last email and just give it a 'new' pill."*
   The old accumulated-movements block duplicated cards (a card showed in TO DO
   **and** again under "Since your last email: new today - …"). Now a card
   created on/after the start of the unsent-email window just renders a right-side
   **NEW** pill inline. Commit `16a907f`.

2. **Home: remove the Kind Words card.**
   User (screenshot, big X over the KIND WORDS card): *"let's remove the kind words section."*
   Unhooked the script from `index.html`, removed it from the service-worker
   precache list, and deleted `js/kind-notes.js`. The `public.kind_notes` table
   is left intact (no data destroyed) — the card just no longer mounts. Commit `6d315a7`.

---

## Git state at handoff

```
6d315a7  v293 home: remove the Kind Words card            <- local HEAD
16a907f  v293 daily-notes: drop Since-your-last-email …   <- local
586af0b  v292 FIX soft-deleted equipment leaking …        <- remote main tip
```

Branch: `claude/vendor-addition-function-ikngsy` (this is the working branch; it
pushes to both itself and `main`).

`node --check` on `js/daily-log.js` and `sw.js` passed; `scripts/boot-smoke.cjs`
returned **BOOT-OK**.

`sw.js` `CACHE_NAME` in the v293 commits: **`nexus-v293-new-pill-drop-kind`**.

---

## Deploy — mechanism + current state

The git proxy is blocked in the Claude sandbox, so deploys go through the
**Steward's Seal → PC** bus (Supabase `clippy_sync` table). The PC
(`DESKTOP-N6PACMM`, user `Taiga`) polls for sealed `art:` commands, verifies the
HMAC seal, and runs the PowerShell (clone → verify SHA → `git am` → push to
`main`).

**Patch already staged** (base64 of `git format-patch 586af0b..HEAD`):
- Bus row id: `steward_patch_v293`
- SHA256: `047576cbcc63709376c52550e831081bd880c0c7634e0aff9e63bb41fccd5c80`
- Size: 22127 bytes (two commits: `16a907f` + `6d315a7`)

**Deploy job created:** `art:deploy-v293-edfd0c5c` (status was `pending`; PC run
was **not confirmed** — the last status poll was interrupted).

### Step 1 — check whether it already landed
```sql
select data->>'status' as status, data->>'exit_code' as exit,
  right(coalesce(data->>'result',data->>'tail',data->>'error',''),300) as tail
from clippy_sync where id='art:deploy-v293-edfd0c5c';
```
Also check the truth on GitHub:
```
git ls-remote https://github.com/OrionContinuity/nexus main   # expect 6d315a7 if landed
curl -s https://raw.githubusercontent.com/OrionContinuity/nexus/main/sw.js | grep -m1 CACHE_NAME
# expect: nexus-v293-new-pill-drop-kind
```

### Step 2 — if NOT landed, re-send the sealed deploy
The staged `steward_patch_v293` row is still valid (same SHA). Re-issue the
sealed command (this is the exact template; the seal is computed in Postgres and
the secret is **never** read into the transcript):

```sql
with v as (
  select
    $cmd$$env:GIT_TERMINAL_PROMPT='0'; $env:GCM_INTERACTIVE='Never'; $w='C:\Users\Taiga\nexus-deploy'; if(Test-Path $w){Remove-Item $w -Recurse -Force}; git clone --quiet --depth 8 https://github.com/OrionContinuity/nexus $w 2>$null; if($LASTEXITCODE -ne 0){throw 'clone failed'}; Set-Location $w; $anon='sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'; $h=@{apikey=$anon;Authorization="Bearer $anon"}; $r=Invoke-RestMethod -Uri 'https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync?id=eq.steward_patch_v293&select=data' -Headers $h; [IO.File]::WriteAllBytes("$w\v293.mbox",[Convert]::FromBase64String($r[0].data.b64)); $sha=(Get-FileHash "$w\v293.mbox" -Algorithm SHA256).Hash.ToLower(); if($sha -ne '047576cbcc63709376c52550e831081bd880c0c7634e0aff9e63bb41fccd5c80'){throw "hash mismatch: $sha"}; git -c user.email=noreply@anthropic.com -c user.name=Claude am v293.mbox 2>&1 | Out-String; if($LASTEXITCODE -ne 0){git am --abort 2>$null; throw 'git am failed'}; git push origin HEAD:claude/vendor-addition-function-ikngsy 2>&1 | Out-String; git push origin HEAD:main 2>&1 | Out-String; if($LASTEXITCODE -ne 0){throw 'main push failed'}; Set-Location C:\; Remove-Item $w -Recurse -Force -EA SilentlyContinue; 'DEPLOY-DONE ' + $sha.Substring(0,8)$cmd$::text as cmd,
    (extract(epoch from now())*1000)::bigint as ts,
    substr(md5(random()::text), 1, 16) as nonce
)
insert into clippy_sync (id, from_id, data)
select 'art:deploy-v293b-' || substr(md5(random()::text),1,8), 'steward',
  jsonb_build_object('status','pending','cmd',v.cmd,'shell','powershell','ts',v.ts,'nonce',v.nonce,'prefer','DESKTOP-N6PACMM',
    'seal', encode(extensions.hmac(v.cmd || '|' || v.ts::text || '|' || v.nonce, (select secret from steward_seal order by id desc limit 1), 'sha256'), 'hex'))
from v returning id;
```
> Note: `git am` applies onto whatever `main` currently is. Since the patch is
> `586af0b..HEAD` and remote main == `586af0b`, it applies cleanly. If main has
> since advanced, rebuild the patch from the new base instead.

### Step 3 — verify & clean up
After `status=done` / `DEPLOY-DONE`, confirm remote main == `6d315a7` and
`CACHE_NAME == nexus-v293-new-pill-drop-kind` (curl commands above), then delete
the staged patch row:
```sql
delete from clippy_sync where id = 'steward_patch_v293';
```

### If deploying from a fresh Claude sandbox (patch row gone / different base)
```bash
git clone https://github.com/OrionContinuity/nexus && cd nexus
# apply the v293 commits (cherry-pick from this branch, or recreate the two edits — see "Change details")
git format-patch <base>..HEAD --stdout > /tmp/v293.mbox
python3 - <<'PY'
import base64,hashlib,json,urllib.request
raw=open('/tmp/v293.mbox','rb').read()
b64=base64.b64encode(raw).decode(); print('sha256',hashlib.sha256(raw).hexdigest())
anon='sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'
url='https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync'
p=json.dumps({"id":"steward_patch_v293","from_id":"steward","data":{"b64":b64}}).encode()
req=urllib.request.Request(url,data=p,method='POST',headers={'apikey':anon,'Authorization':'Bearer '+anon,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'})
print('stage',urllib.request.urlopen(req).status)
PY
```
Then update the SHA in the sealed command and issue it (Step 2). **MCP Supabase
stream drops often — just retry the same call; check for a duplicate row first
before re-inserting a deploy job.**

---

## Change details (so the edits can be recreated if needed)

**File: `js/daily-log.js`**

- `dlogLocationReportLines(loc, sinceISO)` — the Work-orders block dropped the
  "Since your last email:" section. A card is "new" when
  `String(c.created_at).slice(0,10) >= newSince`, where
  `newSince = sinceISO || todayISO()`. It emits a `  (new)` flag on the card line.
- The styled-email typesetter (`renderLine`, ~line 4411) regex now accepts `new`:
  `/\s*\((new today|new|moved today[^)]*|parts ordered)\)\s*$/` and sets
  `isNewToday = true` for both `'new today'` and `'new'` → renders the existing
  right-side **NEW** pill (`rightPill('NEW')`).
- Both send flows now pass `sinceISO` (computed from `dlogUnsentWindow(scopeKey, dateStr)`,
  `sinceISO = win ? win.fromDate : null`) instead of prebuilt `extraLines`:
  `openDailyLogEmail` (~4171) and `openDailyLogStyledEmail` (~4698).
- Signatures renamed: `buildDailyLogEmailBody(d, dateStr, sinceISO)`,
  `buildLocationEmailBody(loc, dateStr, d, sinceISO)`.
- `dlogAccumulatedMovements` / `dlogRelDays` are now unused but left defined (harmless).

**File: `index.html`** — removed the `<script defer src="js/kind-notes.js">` tag
and its comment.

**File: `sw.js`** — removed `'./js/kind-notes.js'` from the precache array; bumped
`CACHE_NAME` to `nexus-v293-new-pill-drop-kind`.

**Deleted:** `js/kind-notes.js`.

---

## Pending / follow-ups (not started)

1. **App-wide emoji removal.** Only daily-notes + equipment `pm_note` were swept
   in earlier work. Still to do across `board.js`, `equipment.js` icon buttons,
   `tools.js`, `home-rm.js`, etc. **CAUTION (hard lesson):** never use cross-line
   quote/space regexes to strip emoji — a broad `re.sub` once merged a comment's
   closing quote into the next line of code and corrupted `daily-log.js`. Use
   **exact `str.replace` only**, one glyph at a time, and re-run `node --check`.
   Also: many flagged glyphs (→ ✓ ✕ ★ ☐ ❦ arrows/checks/chevrons) are
   **functional UI characters** — only remove colorful pictographs (e.g. 🦃 seen
   in an Upcoming ticket title, 🙌 the old Kind Words header). The `❦` in the now-
   deleted kind-notes.js is gone with it.

---

## Operating notes / guardrails

- **Deploy = PC seal bus only.** Sandbox git push is blocked. Stage patch as
  base64 in `clippy_sync` row `steward_patch_*`, send a sealed `art:` command
  with `prefer=DESKTOP-N6PACMM`.
- **Never read the seal secret into the transcript.** It stays inside the
  Postgres `hmac(... , (select secret from steward_seal …), 'sha256')` expression.
- **Respect explicit denies.** The user granted a standing "bypass approvals," but
  has explicitly *denied* individual commands before — when a command is denied,
  hold and report; do not retry around it.
- **Don't bulk-modify DB records** unless the user is pointing at the specific rows.
- **MCP Supabase flakiness:** "Tool permission stream closed before response
  received" is common — retry the identical call. Before re-inserting a deploy
  job after a drop, query for an existing `art:deploy-v293*` row so you don't
  double-push.
- **Verification loop for any JS change:** `node --check <file>` →
  `cd scripts && node boot-smoke.cjs` (expect `BOOT-OK`) → bump `sw.js`
  `CACHE_NAME` → commit → deploy → verify remote main + CACHE_NAME via curl.
- **Equipment soft-delete has NO boolean `archived` column** — it uses
  `archived_at` / `is_deleted` / `deleted_at` timestamps. (Root cause of the v292
  duplicate-Kold-Draft leak.)
