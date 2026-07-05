# Handoff — Revive Clippy on the 3070 (DESKTOP-N6PACMM)

**Written:** 2026-07-05 · for the next session (web) or the **local Claude on N6**.
**One-line:** Clippy's desktop pet is down on the 3070 because its worker **and**
supervisor both died; the machine itself is up. It needs **one logon-level kick**
on N6 to come back — after that it self-heals. Nothing over the bus can start it
while every command-capable process on the box is dead.

---

## TL;DR — do this first
If you are (or can reach) the 3070 **locally**, run in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\NexusClippy\clippy-daemon.ps1" -Supervise
```

That starts the supervisor → which starts **worker-1.6** + the **GhostGlass pet**,
and re-registers the hardened autostart task. A **reboot** does the same (logon task).
You cannot do this from a web session — see "Why the bus can't do it" below.

---

## Verified state (2026-07-05, this session)
- **Roster** (`clippy_sync` id=`clippy_nodes`): only **one** node alive — version
  `2.4.3`, `name`/`os` = null. That's the **legacy text brain** (qwen3:8b), which
  polls `job:%` and only *talks*. It has **no command exec**.
- **worker-1.6 is DOWN** — it stamps `name=DESKTOP-N6PACMM, version=worker-1.6`;
  that entry is absent from the roster.
- **Supervisor is DOWN too** — if it were alive it would restart the worker within
  30s (`clippy-daemon.ps1` `Invoke-Supervisor` loop). It hasn't, for >20 min.
- **OS is NOT hung** — the text brain heartbeats every few seconds, so N6 is powered,
  logged in, and reachable. This is dead *processes*, not a frozen PC.
- **Command token** (`clippy_sync` id=`clippy_cmd`): `pick-a-secret`, node
  `DESKTOP-N6PACMM`, published ~19h ago (= last full daemon run).
- **Armed relaunch job**: `clippy_sync` id=`art:launch-n6` — a `cmd` job that runs
  the daemon `-Supervise`. It sat **pending/unclaimed** (proof no worker is polling)
  and has since expired (`JOB_MAX_AGE_MS` = 120s). Re-arm it (fresh `ts`) if you want
  it to fire the instant a worker wakes.

## Do NOT reopen — already solved
The **click-through is fixed and Alfredo confirmed it** ("wow, it finally works",
Moneta 2026-07-05 "GhostGlass finally clicks through"). Architecture is settled:
- WebView2 **composition hosting** spawns a separate full-screen `Chrome_WidgetWin_1`
  (the pet's real display surface, cross-process). You can't re-region/de-layer it,
  only hide it — and hiding it hides Clippy.
- **Fix that works:** host is a **small 520×600 box** bottom-right; we region-clip
  **our own** window to Clippy's silhouette (rects streamed from `clippy-pet.html`
  → `SetWindowRgn`). Clicks outside his shape fall to the desktop.
- Dead ends (do not retry): `WM_NCHITTEST`→HTTRANSPARENT (same-thread only),
  permanent `WS_EX_TRANSPARENT` on NOREDIRECTIONBITMAP (inert — Alfredo tested:
  "NOPE"), `WS_EX_LAYERED`+alpha (alpha overrides `SetWindowRgn`).

So once N6 is back, the pet already clicks through correctly — no code needed there.

## What I shipped this session
- **`clippy-daemon.ps1` → main `51e6e17`**: the autostart Scheduled Task was
  **logon-only**, so any mid-session death stranded Clippy until the next logon.
  Added a **5-minute self-heal** repeat trigger (+ RestartOnFailure). Once this task
  is registered, a dead supervisor is relaunched within 5 min — **no human, no
  re-logon**. It self-instances, so repeat launches are harmless. This is the fix
  for the recurring "it's not even open." It **loads on the next logon** on N6.

## Why the bus can't do it (don't burn time here)
The bus is a mailbox. `cmd` exec lives **only** in `clippy-worker.py`
(`run_command`, token-gated). If the worker process is dead, a `cmd` job just sits
unread. The legacy text brain reads `job:%` and *LLMs* it (my launch command came
back to Alfredo as a chat "Hello!"). Precedent is in Moneta: SL5ETE7's stuck worker —
*"could not push the relaunch to it over the bus."* Starting the first process on a
fully-dead box requires the OS (Task Scheduler / logon) or a human. There is no
web-session path.

## Verify after revival (run from anywhere via Supabase SQL)
```sql
-- expect a node: version 'worker-1.6', name 'DESKTOP-N6PACMM', small age
select e->>'name', e->>'version', e->>'os',
  round(extract(epoch from (now()-to_timestamp((e->>'ts')::bigint)))::numeric) age_s
from clippy_sync, jsonb_array_elements(data) e where id='clippy_nodes' order by age_s;
```
On N6, the pet log `%USERPROFILE%\.clippy\pet-comp.log` should show
`viewport 520x600`, `region applied (N parts)`, `grid OverClippy true ~8/121`.

## Open TODO — root-cause the deaths (important)
The 5-min heal **restarts a dead supervisor but won't fix a crash loop.** Alfredo
says this has happened ~10×, so suspect a recurring crash, not a one-off. Once N6 is
up, READ:
- `%USERPROFILE%\.clippy\pet-comp.log` (compile "Warning as Error"? DComp/D3D fail?
  exception in `SendSight` — GDI CopyFromScreen/AMSI?)
- worker stdout / any worker log (Ollama OOM on the 8GB 3070 during vision? qwen2.5vl
  is ~6GB and tight).
Fix the cause so the heal isn't papering over a flap.

## Bus mechanics (reference)
- `cmd` job on `job:`/`art:`/`vis:`:
  `{status:'pending', cmd, shell:'powershell', token:'pick-a-secret', ts, prefer, prefer_ms}`
- worker (`worker-1.6`) polls `vis:`/`art:`/`job:`; writes
  `{status:'done', exit_code, result, node}`. Jobs older than 120s are ignored.
- N6's worker "grabs everything," so guard machine-specific cmds with
  `if($env:COMPUTERNAME -ne 'DESKTOP-N6PACMM'){exit}`.
- Leave durable instructions for a local Claude as a `clippy_sync` row (pattern:
  `orion_fix_sl5ete7`).

## Standing corrections (Alfredo — these are law)
- Pars are reference numbers only. Never "order by par."
- Never auto-close/bulk-modify stale records without asking.
- He communicates by screenshot + short message; investigate before asking.
- Read Moneta first (`nodes` where category='moneta', order by id desc) — it would
  have saved this session a long redundant research detour.
