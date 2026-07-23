# NEXUS — 50-Agent Estate Analysis

_Read-only audit of the whole estate: the NEXUS PWA, Clippy (web pet + Minecraft body), the Windows node stack, the Supabase backend, the side-realms, and the steward memory. Run 2026-07-22. 50 analysis lanes launched, **49 completed** (the 50th, `truth-audit`, and the adversarial verify layer hit a model usage cap mid-run). **425 findings: 9 critical, 72 high, 140 medium, 127 low, 77 info.** The 9 criticals were then verified by hand against live SQL and current code — results below._

> **Method caveat, told plainly.** The automated adversarial-verify pass (a skeptic per critical/high finding) did **not** run — it was cut off by the usage cap. So the medium/low/info tiers are **single-pass** findings: well-evidenced, but not independently refuted. I hand-verified the 9 criticals and a handful of the load-bearing highs myself; those carry a verdict. Treat everything below critical as "a careful reader flagged this," not "proven."

---

## The one-paragraph truth

The estate works and is loved, but it rests on **one shared public anon key with almost no row-level security** — roughly 110 tables carry `anon ALL / true` policies. That single fact is the root of most of what follows: the user table with everyone's PINs is world-writable, 6,510 private phone notifications sit in cleartext readable by anyone with the site URL, and the world-writable `clippy_sync` bus can drive real mouse clicks and reconfigure the game controller on the machines a 3-year-old uses. Separately, a **self-modifying deploy trigger fires nightly** (contradicting the digest's "all paused" claim), the **entire Clippy fleet has been dark for 1.5–4 days**, and the **last ~34 commits (v349–v369) left no steward memory at all** — the continuity machine skipped its own ritual. None of this is on fire this second; all of it is worth a deliberate pass.

---

## 🔴 Critical — verified by hand

**These are the 9, collapsed to 7 distinct issues (two pairs were the same bug found by different lanes), each with my verdict after checking live SQL / current code.**

### C1 — `nexus_users` is world-readable AND world-writable → PIN theft + admin self-minting  ✅ CONFIRMED
Policy `nexus_users_anon_all` is `cmd=ALL, qual=true, with_check=true, role=public`. **Verified live:** 20 users, **2 still hold plaintext PINs**, 18 bcrypt (cost 8), **2 are admin/owner**. Anyone with the anon key (shipped in the public PWA) can `SELECT` every PIN/hash, `UPDATE role='admin'` on themselves, or `DELETE` users — entirely bypassing the hashed, rate-limited `verify_pin()`. A 4–8 digit PIN under bcrypt-cost-8, once the hash is read, is offline-crackable in hours. This also transitively defeats the actor-PIN admin RPCs, since the gating PIN is itself readable. **This is the headline.** _(`db-schema`, `db-security`)_

### C2 — `raw_emails` holds 6,510 private notifications in cleartext on a world-readable table  ✅ CONFIRMED
`native-bridge.js` `startNotificationListener` captures title+body from **WhatsApp, WhatsApp Business, Telegram, SMS, Gmail, and Slack** and upserts them into `raw_emails`. Policy `raw_emails_anon_all` = `ALL / true / public`. **Verified live:** 7,006 rows total, **6,510 `notify_*` rows**. This is third-party private-communication PII — messages *from other people*, not just Alfredo — exposed on the unauthenticated anon key. This is the same class the house laws flag for the bus, but with real people's messages in it. _(`drive-native`)_

### C3 — Unauthenticated bus write drives real mouse clicks (SendInput) on the machines, incl. the child's  ✅ CONFIRMED · _known_
`clippy.js` `handsTick()` polls `clippy_sync/clippy_hands_<device>`; any row with a fresh, strictly-newer `ts` (<30s) triggers a real `SendInput` click/right-click/double-click/cursor-move at arbitrary desktop pixels via the WebView2 host (`clippy-pet-comp.ps1:667`). The bus is world-writable (verified: `clippy_insert wc=true`, `clippy_update qual/wc=true`). The only guards are ts-freshness and replay — an attacker controls `ts`, so both pass. The code itself admits the gap at `clippy.js:8538-8540`. _(reported by both `clippy-pet-core` and `clippy-pet-host`)_

### C4 — Controller-config `.amgp` XML injection from the world-writable bus → runs on the child's PC  ✅ CONFIRMED
`clippy-worker.py:1564` interpolates the bus-supplied `easing` value straight into the antimicrox profile XML with `%s` and **no escaping or whitelist** (`easing = str(t.get("easing", …))` at :1529). Anyone can write `clippy_controller_cfg`; a crafted `easing` closes `<mouseacceleration>` and injects arbitrary antimicrox slots — at minimum remapping the toddler's F310 to arbitrary keystrokes, plausibly worse given antimicrox slot modes. This path does **not** go through the seal-gated command lane, so it is unauthenticated. _(`mc-controller`)_

### C5 — Contractor invoice/photo uploads silently fail — `pm-attachments` bucket has no INSERT policy  ✅ CONFIRMED
`equipment-public-pm.js` uploads to the `pm-attachments` storage bucket, but **verified live:** there are **0 INSERT policies** referencing that bucket and **0 objects** in it. Every anon upload is RLS-denied into a `console.warn`-only catch, so the PM log saves with empty attachments and the contractor sees a full success screen. The invoice/photo paper trail — a headline feature of the public logger — has **never worked**. (Note: `pm_logs.photo_urls` was non-empty on 16/16 rows in my spot-check, which contradicts the lane's "0 with photos" — worth a look at what that column actually stores, but the bucket-write failure is certain.) _(`equipment-satellites`)_

### C6 — `tools.js` "Push update" arbitrary PowerShell  ⚠️ REFUTED at default posture
The lane claimed anyone with the site can push arbitrary PowerShell to the nodes via the anon-readable token. **On checking the worker: this is blocked by default.** `clippy-worker.py:1000-1004` refuses any command unless `_seal_ok(data)` (HMAC over the DB-only steward secret) **or** `plaintext_ok`, where `plaintext_ok` requires `CLIPPY_ALLOW_PLAINTEXT_CMD=1` (default **off**) *and* a matching `CMD_TOKEN`. The scary in-code note in `tools.js:297` is stale/pessimistic — it predates the seal migration. **Real only if a node was deliberately started with `CLIPPY_ALLOW_PLAINTEXT_CMD=1`.** Worth confirming no node runs that flag; otherwise this is a non-issue. _(`admin-tools`)_

### C7 — Clippy soul "factory-wiped on every boot"  ⚠️ DOWNGRADED to high (latent, not active)
The code path is real: `clippy-soul.js` runs deferred, `start()` calls `await load()` immediately (`:598`, `:827 else start()`), and if `NX.sb` isn't created yet the `if (!s)` branch (`:345`) sets `DEFAULT_SOUL` **without** setting `_soulReadFailed`, so a later `save()` (which only skips when `_soulReadFailed`) could upsert factory defaults over the real row. **But** the live `clippy_soul` row is intact and was freshly updated today — so the wipe is **not happening in practice** (the desktop-pet boot order evidently reads the real row first). It's a latent trap on the browser boot path, not an active erasure. Fix is one line (set `_soulReadFailed=true` in the `!s` branch too), but it's not a live emergency. _(`clippy-soul`)_

**Bonus (verified, lane rated it high):** `nexus_config` — which holds `anthropic_key`, `elevenlabs_key`, `trello_token`, `backup_secret`, and the AI-write budget flags — has anon **INSERT + UPDATE** policies (verified). So an anon writer can **overwrite** the keys, flip `ai_writes_enabled`, or redirect `ai_provider` — a tamper/DoS/redirect vector. It does **not** appear anon-*readable* (no SELECT policy), so the keys can't be exfiltrated this way — better than the lane feared, but still writable by anyone.

---

## Systemic patterns (the findings cluster into a few root causes)

1. **One open database, one shared key** (root of C1, C2, C3, C4, the bonus, and ~15 more highs). ~110 tables with `anon ALL / true`. `docs/CLIPPY-SOUL-RLS-PROPOSAL.md` already scopes the fix; this audit says the scope is bigger than the bus — it's `nexus_users`, `raw_emails`, `nexus_config`, `nodes`/Moneta, `orion_thread`, `tickets`, `equipment_*`, and the storage buckets too.
2. **Stored XSS everywhere data meets `innerHTML`** (7+ high findings: equipment categories/attachments, admin activity feed, smart reminders, brain-list/events, galaxy nodes). Because the source tables are anon-writable, these are *stored* XSS, not just reflected — an attacker writes the payload once and it fires in Alfredo's admin session.
3. **House-law-3 dead catches** (10+ findings across board, cleaning, ordering, domain, drive, equipment, hideaway). `supabase-js` resolves with `{error}`; the code `try/catch`es it or `.then(()=>{})`s it and toasts success anyway. Writes fail silently and the UI lies. This is the single most repeated code defect in the estate.
4. **Unauthenticated bus content is trusted as identity/speech/commands** (Clippy whisper/hive/txt lanes, the Minecraft `txt:` pool, `clippy_nodes` brain-redirect, `clippy_wish_grants` note spoken to the child). The courtesy law and "don't invent" law are unenforceable client-side against a world-writable bus.
5. **Silent staleness** — features that report success while doing nothing: the fleet is dark (below), the pantheon voice lane died ~2026-07-21 17:00 UTC (likely API-key failure) masked by swallowed errors, chat-history hydration is permanently empty, the Logbook Daily-Logs tab reads a nonexistent column, the `installers` bucket doesn't exist so every Tools→Install button is a dead link.

---

## Operational state, right now (verified live)

- **The Clippy fleet is dark.** Last heartbeats: **Trajan `DESKTOP-OQ8SROU` — 101.7h stale (~4.2 days)**, **Providencia `DESKTOP-SL5ETE7` — 41h**, **the PC `DESKTOP-N6PACMM` — 33.5h**. No node is running; every remote channel (seal, whisper, hands) is inert until a machine wakes. This is why the cloud rituals have no pool node to answer.
- **The self-modifying deploy trigger is live.** `trig_01B3ZUL767qBuNEv58b9ujHp` ("Clippy wish-granting") is **enabled**, cron `0 5 * * *` (midnight CT), and its prompt instructs a fresh session to **edit + ship `clippy_agent.js`** (the child's live Minecraft bot), `node -c`, deploy, and self-revert on regression — an approvals-off deploy loop. This directly contradicts both the digest's "all four routines PAUSED" line **and** the BOUNDARY law ("never wire an approvals-off deploy loop"). The digest's own 2026-07-21 DRIFT ALERT flagged this; it is still true. **This is a keep/pause/guard decision only Alfredo can make.** Note also: the trigger's prompt embeds the **publishable anon key and a `-CmdToken`-style secret in plaintext**, and its several dozen `send_later` sibling triggers historically carried the **steward secret in their prompt text** — those secrets should be considered compromised and rotated.
- **The four Orion routines** (Vigil, tunnel, roam, residency) are disabled and have been since Jul 10–11 — consistent with the digest's "autonomous triggers can't reach the DB here" verdict. The phone tunnel (`orion.html` → `orion_thread`) therefore has **no live listener**; I checked and there are no unanswered `who='alfredo'` messages waiting, so nothing is stranded.
- **Memory gap:** the v349–v369 arc (~34 commits) minted **no Moneta, no log line, no vault pressing**, and the digest's "last compacted" is still 2026-07-11 — 11 days and dozens of commits stale. The continuity machine skipped itself. (This session closes that gap.)

---

## Held for your decision (do not apply unasked)

The audit surfaces a lot, but these are the calls that are genuinely yours:

1. **RLS.** Lock `nexus_users`, `raw_emails`, `nexus_config`, `nodes`, `orion_thread`, and the storage buckets behind SECURITY-DEFINER RPCs / restrictive policies. Highest leverage, but risky under the shared-anon-key model — a wrong policy locks the app out. Needs a careful, staged pass (proposal doc B→A).
2. **The notification listener.** Decide whether phone-notification capture should exist at all given it lands third-party PII in cleartext (C2). If yes, it needs its own locked table + encryption; if no, stop the listener and purge the 6,510 rows.
3. **The wish-granting trigger.** Keep / pause / guard the nightly self-deploy loop, and rotate the secrets exposed in the trigger prompts.
4. **The dead features.** `installers` bucket, chat-history hydration, Logbook Daily-Logs tab, pantheon voice (API key?) — fix or formally retire each.
5. **Rotate** the steward secret + cmd token (exposed in trigger prompts) and any key that lived in `nexus_config` while it was anon-writable.

Everything below this line is the full lane-by-lane detail. The high-severity tier (72) is where the fixable, non-decision work lives — the dead catches, the XSS escaping, the par-law violation in inventory reorder cards, the PM data-contract break — most of it is small, additive, and doesn't need your sign-off, just a supervised session.

---

# Full findings by lane


## NEXUS web app — core & ops


### `boot-core` — Boot, auth, roles  · health: 🟡 fair


The boot path (config.js → app.js → deferred core.js, NX.init on DOMContentLoaded) is fundamentally sound: the v324/v336 DB-probe self-heal is well built (retries, self-clears, network-vs-RPC discrimination, and its 11-char probe PIN exits verify_pin before the rate-limiter or auth_attempts insert, so probes cost nothing), server-side PIN verification is hashed + rate-limited, and the two-NX bridge at app.js:4584 is in place. However, the role layer has real holes: the ADMIN Settings modal opens for any logged-in user (no role or data-perm gate on #adminBtn), the admin actor-PIN (_sessionPin) is lost on every page reload so all P0-hardened admin RPCs fail with not_authorized until a fresh PIN login, and every direct client read/write of nexus_users (interests, default_persona, language) silently fails because anon has zero grants — cross-device persona/language persistence is dead. The advertised PIN-cache fast login (NX.pinCache) does not exist anywhere despite live admin UI for it. None of these appear in CLIPPY-AUDIT-REPORT.md.


- 🟠 **HIGH** — ADMIN Settings modal is reachable by any logged-in user, including staff · `index.html`
  
  The utility-tray Settings button (#adminBtn, index.html:2841) has no data-perm attribute and no role gate; app.js setupAdmin() (called unconditionally at app.js:879) wires it to open #adminModal for every user (app.js:1972-1973), and js/admin.js contains zero isAdmin/isManager/adminBtn checks. Only the API-key prefill section is isAdmin-gated (app.js:1994). The 'admin' entry in PERM_RESOURCES only gates switchTo('admin') navigation — the admin surface is a modal, not a view, so the permission is decorative. Staff can open the ADMIN panel and change device AI provider/endpoint/model/voice, tap broadcast/push controls, Drive/backup buttons, etc. Destructive user-management RPCs are server-gated by p_actor_pin, but everything the panel does with the shared anon key or localStorage is exposed.
  
  _Evidence:_ index.html:2841 `<button class="util-btn" id="adminBtn">…Settings`; app.js:1972 `document.getElementById('adminBtn').addEventListener('click', () => { modal.classList.add('open') … }`; grep of js/admin.js for isAdmin|isManager|adminBtn returns no matches.
  
  _Fix:_ Gate the button and the open handler: hide #adminBtn unless hasPermission('admin') (add data-perm="admin" so applyPermissionGates covers it) and early-return in the click handler for non-admins.

- 🟠 **HIGH** — _sessionPin is lost on page reload — all admin actor-PIN RPCs fail until a fresh PIN login · `js/app.js`
  
  The 2026-07-16 security P0 added _actor_has_role(p_actor_pin,…) guards to admin RPCs (list_users, list_users_with_perms, delete_user, create_user, get_chat_history_admin, privacy rules) and the client sends NX._sessionPin. But _sessionPin is only set inside _handleAuthSuccess (app.js:553) and is never persisted; the sessionStorage restore path (app.js:370-390) sets currentUser directly and never re-captures the PIN. After any reload (pull-to-refresh, PWA relaunch with live sessionStorage), an admin is 'logged in' but every actor-PIN RPC sends undefined → _actor_has_role(null)=false → 42501 not_authorized. Verified server-side: _actor_has_role requires p_actor_pin non-null and length 4-8. Affected call sites: app.js:2384,2900,2932,3060,3186; admin.js:2486,2577,2725,2801; log.js:87; cleaning.js:2632 (manager verify).
  
  _Evidence:_ app.js:553 `this._sessionPin = pin;` (only assignment); restore path app.js:384 `this.currentUser = u;` with no _sessionPin; SQL: `where p_actor_pin is not null and length(p_actor_pin) between 4 and 8` in public._actor_has_role.
  
  _Fix:_ On restore, detect the missing _sessionPin and either force re-auth for admin actions (prompt for PIN when an actor-PIN RPC is about to run) or derive a server-verifiable session credential at login that survives reload; at minimum surface a clear 'please re-enter PIN' message instead of raw not_authorized failures.

- 🟠 **HIGH** — All direct client access to nexus_users silently fails — interests, cross-device persona, and language persistence are dead · `js/app.js`
  
  Phase B revoked every anon privilege on nexus_users (confirmed: role_table_grants shows no anon row; RLS enabled). Yet the login path still reads/writes the table directly with the anon key: app.js:514 fetches interests/inferred_interests post-login (guard `if (!error…)` silently drops the permission-denied error, so Trajan personalization never gets interests); app.js:1664 persists default_persona with `.then(() => {})` which swallows the resolved {error} entirely (house-law-3 flavor: not a throw, a resolved error, and here not even destructured) — cross-device persona default never saves, contradicting comments at app.js:1467-1473. Same dead pattern in other lanes: translate.js:508 (language save), cleaning.js:408 and inventory.js:826 (user-list fallbacks).
  
  _Evidence:_ SQL: grantees on nexus_users = authenticated/postgres/service_role only, no anon; app.js:1664 `this.sb.from('nexus_users').update({ default_persona: persona }).eq('id', …).then(() => {});`
  
  _Fix:_ Route these through small SECURITY DEFINER RPCs (like get_user_permissions) or have verify_pin return interests/default_persona in its JSON; audit repo-wide for remaining direct from('nexus_users') calls.

- 🟡 **MEDIUM** — NX.pinCache does not exist — fast-login path is dead code and the admin 'Remember PIN (PBKDF2)' toggle is wired to nothing · `js/app.js`
  
  authenticatePin's fast path (app.js:431-445) and cache store (app.js:477-478) guard on NX.pinCache, which is defined nowhere in the repo (grep for `pinCache =` / pin-cache: zero matches outside app.js call sites). Every login therefore always takes the full Supabase round trip. Worse, the admin panel ships a live 'Login Performance' section (index.html:4299-4309) with #adminPinCacheToggle and #adminClearPinCache promising 'Login becomes near-instant. PIN is hashed with PBKDF2' — no JS anywhere references those element IDs, so the toggle does nothing and misrepresents a security-relevant behavior (owner may believe PINs are cached/clearable on shared devices).
  
  _Evidence:_ grep -rn 'adminPinCacheToggle|adminClearPinCache' → only index.html markup; grep for a pinCache definition across js/ → only the 6 guarded call sites in app.js.
  
  _Fix:_ Either implement NX.pinCache (PBKDF2 as advertised) or remove the dead admin UI section and the dead fast-path code so the panel stops advertising a nonexistent feature.

- 🟡 **MEDIUM** — Session restore trusts forgeable sessionStorage; the session token is never verified · `js/app.js`
  
  setupPinScreen's restore path (app.js:370-390) only checks that nexus_current_user and nexus_session_token both EXIST — the token produced by _makeSessionToken (app.js:408-421) is never recomputed or checked against anything, and the comment admits 'We trust the saved user record.' Anyone with console access on a shared device can plant {id:…, role:'admin'} + any token string and land in the app as admin with isAdmin=true, reaching all admin surfaces (compounding the ungated admin modal). Server actor-PIN RPCs still resist, but everything gated only by NX.isAdmin/isManager (app-level, shared anon key) is open. This is the documented app-level-only trust model, but the token is pure theater and could at least bind to something verifiable.
  
  _Evidence:_ app.js:370 `if (savedUser && savedToken) { … this.currentUser = u; … this._applyRole(u.role);` — no verification of savedToken anywhere; token construction at app.js:410 is deterministic from pin+id+UA.
  
  _Fix:_ Verify the stored token on restore (e.g. an RPC that checks a server-issued session nonce), or accept and document that reload-restore grants whatever role sessionStorage claims; do not present nexus_session_token as a security control.

- 🟡 **MEDIUM** — Network failure during PIN entry is reported as 'Invalid PIN' · `js/app.js`
  
  supabase-js RESOLVES with {error} on network failures (house law 3). authenticatePin's slow path (app.js:454-474) lumps every resolved error into the same branch as a null user: `if (error || !data)` → 'Invalid PIN' + shake. A user typing their correct PIN on flaky WiFi is told their PIN is wrong. The try/catch fallback ('Connection failed', app.js:482-487) only fires on a thrown exception, which supabase-js rarely produces. Contrast with the v324 boot probe (app.js:1151-1193), which correctly discriminates isNetworkErr(error) from real RPC errors — the same discrimination is missing exactly where a human reads the message.
  
  _Evidence:_ app.js:470-473 `if (error || !data) { errorEl.textContent = … 'Invalid PIN'; …}` with no network-error check on `error`.
  
  _Fix:_ Reuse the probe's isNetworkErr() test in authenticatePin: on a network-shaped error show 'Connection failed — check WiFi' and do not clear the typed PIN.

- 🔵 **LOW** — NX_PROXY_SECRET is an unset placeholder and is never sent by any client code — the documented 'speed bump' does not exist · `js/config.js`
  
  config.js:44 ships NX_PROXY_SECRET: '__SET_ME__' and its header-block claims the value is 'sent on every call to the JWT-off edge functions (/chat, /translate, /markitdown)'. Grep across js/ finds zero code reading NEXUS_CONFIG.NX_PROXY_SECRET or attaching any such header (translate.js and daily-log.js call functions/v1 endpoints with no secret header), and no file under supabase/functions/ references it either. The protection described in the config file was never implemented on either side; the JWT-off endpoints rely solely on obscurity + platform rate limits (edge-function exposure itself is another lane's subject).
  
  _Evidence:_ grep -rn 'NX_PROXY_SECRET' → only js/config.js:15,43,44; grep supabase/functions for the secret → no matches.
  
  _Fix:_ Either implement the header (client fetches + edge-function check, then set a real value per phase-d.md) or delete the field and correct the comment so future sessions don't assume the speed bump exists.

- 🔵 **LOW** — Admin user list renders 'PIN: null' — UI never updated after the P0 hardening nulled PINs out of list_users · `js/app.js`
  
  The 2026-07-16 security migration rewrote list_users/list_users_with_perms to return `null::text as pin` (verified in live function defs), but the admin user list still renders `PIN: ${u.pin}` (app.js:2921), which now displays the literal string 'PIN: null' for every user. Cosmetic, but it signals breakage to the owner and leaves dead PIN-display plumbing in place.
  
  _Evidence:_ app.js:2921 `<span class="admin-user-pin-sm">PIN: ${u.pin}</span>`; SQL def: `select id, name, null::text as pin, …` in public.list_users.
  
  _Fix:_ Drop the PIN column from the admin user list (PINs are intentionally unrecoverable now) or show a masked placeholder.

- 🔵 **LOW** — 'owner' role is a permission super-role but gets staff-level UI from _applyRole · `js/app.js`
  
  hasPermission bypasses the matrix for role 'admin' OR 'owner' (app.js:632), and the perms matrix treats owner as admin (app.js:3087), but _applyRole (app.js:577-578) sets isAdmin only for 'admin' and isManager only for 'manager'/'admin'. A user with role='owner' would pass every permission check yet get isAdmin=false/isManager=false: board hidden (app.js:798-800), no push auto-enable, key section hidden, perms matrix blocked (app.js:3055). Latent only — live DB currently has roles staff(6)/manager(12)/admin(2), no owner — but the first 'owner' account created via the admin panel will boot into a broken hybrid state.
  
  _Evidence:_ app.js:577 `this.isAdmin = role === 'admin';` vs app.js:632 `if (u.role === 'admin' || u.role === 'owner') return true;`; SQL role counts confirm no owner rows today.
  
  _Fix:_ Treat 'owner' as admin in _applyRole (isAdmin = role==='admin' || role==='owner') or remove 'owner' from the role vocabulary entirely.

- ⚪ **INFO** — Two nexus_users rows still hold plaintext PINs awaiting self-heal · `js/app.js`
  
  verify_pin self-heals plaintext PINs to bcrypt (pin_hash) on first successful login. Live data: 1 staff and 1 manager row still have pin set and pin_hash null — those users have not logged in since the hashing migration. Until they do, their PINs sit plaintext in a table readable by service-role/dashboard contexts, and _actor_has_role's plaintext fallback branch keeps them working. Purely an owner-awareness fact; the mechanism is working as designed.
  
  _Evidence:_ SQL: roles with plaintext pins — staff: 1 of 6, manager: 1 of 12, admin: 0 of 2 (pin is not null, pin_hash counts).
  
  _Fix:_ Have those two people log in once (self-heals), or run a one-time server-side hash of remaining plaintext PINs — with Alfredo's explicit ask, per house law 2 on bulk modification.


### `app-shell` — app.js shell  · health: 🟡 fair


The app.js shell is large (5,529 lines) but coherent: routing, the unified NX surface, PIN/permission gating, the masthead/persona coin, the Clippy pool/cloud AI dispatch chain, and the time clock all live here. The two-NX bridge is sound — pre-app.js modules attach to window.NX and are folded in via Object.assign then window.NX=NX makes both bindings the same object, so later IIFEs augment one object correctly. The strongest lane-specific risk is askPool: it trusts answers returned on the world-readable AND world-writable clippy_sync bus, making the AI assistant's chat responses injectable by anyone with the public anon key, and it publishes system prompts, user prompts, and scanned images to that same public bus (House Law 5). Secondary concerns: an automatic 14-hour clock-out silently rewrites payroll records without asking (House Law 2 spirit), the documented 'kill switch for all Supabase operations' (NX.paused) does not actually gate AI/bus/dbSave calls, and the recurring unchecked-{error}/dead-catch pattern lets a transient error blank the galaxy with no surfaced state. No correctness-breaking defects in routing or the NX bridge itself.</summary>
</invoke>



- 🟠 **HIGH** — askPool trusts the world-writable clippy_sync bus for AI answers — chat responses are attacker-injectable
  
  askPool() posts a job to clippy_sync with a random UUID id, then polls that same row and returns whatever a node writes to d.result once d.status==='done' (js/app.js:4192 upsert; js/app.js:4200-4204 return d.result). The bus is world-READABLE and world-WRITABLE with the public anon key. Any unauthenticated party holding the anon key (it ships in the public site, NX.SUPA_KEY) can poll clippy_sync for pending 'txt:'/'job:'/'vis:' rows, read the job id, and write {status:'done', result:'<arbitrary text>'} — poisoning the AI assistant's answer that restaurant staff then read and act on. The txt-lane routing is likewise steerable: txtNode is decided by liveNodes.some(n=>n.txt) (js/app.js:4152) where liveNodes come from the forgeable clippy_nodes heartbeat row (clippyPoolNodes, js/app.js:4115-4123). This is exactly the House-Law-5 case: safety-relevant behavior (the grounded ops assistant) steerable by an unauthenticated bus write.
  
  _Evidence:_ js/app.js:4200-4204 — if (d && d.status === 'done') { this._answerSource = ... ; return d.result || ''; }  — no signature/authorship check; job id read from world-readable clippy_sync; write path is anon-writable per House Law 5.
  
  _Fix:_ Do not trust bus-returned answers as authoritative without an integrity check. At minimum bind the result to a node identity the app can verify (HMAC over job id using a per-node secret the browser can validate, or route answers through a SECURITY-DEFINER edge function that only service_role can write). Short term: tighten clippy_sync WITH CHECK so anon cannot UPDATE another writer's row (see docs/CLIPPY-SOUL-RLS-PROPOSAL.md).

- 🟡 **MEDIUM** — askPool/renderViaPool publish system prompts, user prompts, and equipment photos to the world-readable bus
  
  askPool builds the job with prompt, system, and image_b64 and upserts it to clippy_sync (js/app.js:4186-4192). renderViaPool does the same for render ideas (js/app.js:4232-4234). In clippy-pool mode the system prompt carries the MENS 'NEXUS LIVE STATE' brief (live ticket/cleaning/equipment/contractor data for the three restaurants), and image_b64 carries scanned photos (equipment nameplates, premises). clippy_sync is readable by anyone with the public anon key, so every pooled chat turn and every Scan-Plate image is exposed to an unauthenticated reader for the ~6h the row lives. The best-effort cleanup (delete + expired tombstone, js/app.js:4212-4213) still leaves the data readable until the node answers or the timeout elapses.
  
  _Evidence:_ js/app.js:4186-4192 — const job = { status:'pending', prompt:String(prompt||''), system:opts.system||null, image_b64:opts.image_b64||null, ... }; await this.sb.from('clippy_sync').upsert({ id, data: job, from_id:'nexus' } ...)
  
  _Fix:_ Route pooled generation through a non-public lane (RLS so only registered nodes can read pending jobs, e.g. a service-role edge relay), or strip operational data/PII from what is placed on the public bus. Treat scanned images as sensitive and never post raw base64 to a world-readable table.

- 🟡 **MEDIUM** — checkStatus() silently auto-modifies payroll records: shifts >14h are truncated to hours=14 without asking
  
  On every status check (fires from showOnPinScreen at login and from setupNavWidget), if the current user's open shift exceeds 14h, the code writes clock_out = clock_in+14h and hours=14 to time_clock automatically (js/app.js:4874-4883). This is an automatic modification of a payroll-relevant record with no confirmation — against the spirit of the standing correction 'never auto-close or bulk-modify stale records without asking first'. It also silently caps genuinely long/overnight shifts and, if a clock_in timestamp is wrong, rewrites the row on the next login with no audit trail beyond a transient toast.
  
  _Evidence:_ js/app.js:4874-4879 — if (elapsed > 14) { const hours = 14; const autoOut = new Date(new Date(data.clock_in).getTime() + 14*3600000).toISOString(); await NX.sb.from('time_clock').update({ clock_out: autoOut, hours }).eq('id', data.id); ... }
  
  _Fix:_ Confirm with the owner before shipping automatic clock-out edits, or convert it to a flag (needs_review) rather than an in-place hours rewrite, preserving the true clock_in and leaving the correction to a human.

- 🔵 **LOW** — NX.paused 'kill switch for all Supabase operations' does not gate AI/bus calls or dbSave
  
  NX.paused is documented as the 'Kill switch for all Supabase operations' (js/app.js:18-19) and is honored by loadNodes (220), loadAgenda (3378), checkTicketBadge (3639), startNodeWatcher (3360), showBriefing (3672). But askClaude/askClaudeVision (3814/3875), askPool (4125), askCloudBrain (4098), renderViaPool (4219), dbSave (3616) and the time_clock writes all proceed regardless of paused. If paused is ever used to stop DB activity (e.g., to protect the free tier or during an incident), AI generation and bus writes keep hitting Supabase and the public bus.
  
  _Evidence:_ js/app.js:3814 askClaude / 4125 askPool / 3616 dbSave — none begin with `if (this.paused) return`, unlike loadNodes at js/app.js:220.
  
  _Fix:_ Either gate all Supabase-touching paths on this.paused or rename/scope the flag honestly so it isn't relied on as a global kill switch.

- 🔵 **LOW** — loadNodes and many bus/DB reads swallow errors and fall back to empty — a transient error silently blanks the galaxy
  
  loadNodes paginates with `const { data } = await this.sb.from('nodes')...` without ever checking error; on any transient failure data is null, the loop breaks, and the catch sets this.nodes=[] and this.allNodes=[] (js/app.js:219-245). The result is the brain/galaxy silently renders empty with no surfaced error. The same unchecked-{error} + dead-catch pattern recurs across the shell (trackAccess 142-151, loadAgenda 3377-3436, showBriefing). Per the standing gotcha, supabase-js resolves with {error} rather than throwing, so these catches are largely dead and real errors are indistinguishable from 'no data'.
  
  _Evidence:_ js/app.js:224 — const { data } = await this.sb.from('nodes').select('*').range(offset, offset+999);  (no error destructured) → js/app.js:245 catch { this.nodes = []; this.allNodes = []; }
  
  _Fix:_ Destructure and check {error} on the primary reads; distinguish 'empty' from 'failed' so the UI can show a retry state instead of a blank galaxy, and avoid clobbering a previously good this.nodes on a transient blip.

- 🔵 **LOW** — Config fallback can read secret columns into client memory if the public view is missing
  
  _loadConfigAndStart reads nexus_config_public (secret columns stripped) but, on a 42P01/PGRST205 'table not found', falls back to selecting * from the base nexus_config table (js/app.js:680-683), which holds anthropic_key/elevenlabs_key/trello secrets. This is safe only as long as the base table's anon SELECT stays revoked; if the view is ever dropped/renamed and the base table is readable, every logged-in client would pull the raw secrets into this.config. It is a fragile defense-in-depth gap rather than a live leak.
  
  _Evidence:_ js/app.js:681-683 — if (error && (error.code==='42P01'||error.code==='PGRST205'|| ...)) { ({data,error} = await this.sb.from('nexus_config').select('*').eq('id',1).single()); }
  
  _Fix:_ On view-missing, select only the known non-secret columns from the base table (explicit column list) instead of *, so a misconfigured RLS can never spill keys to the client.

- 🔵 **LOW** — QR ?pin= query-string auto-login can leak the PIN into server/CDN access logs
  
  setupPinScreen accepts an auto-login PIN from either the URL fragment (#pin=) or the query string (?pin=), then scrubs the URL after login (js/app.js:351-368). The code comments already acknowledge the fragment form is preferred because query params land in logs; the ?pin= path is kept for already-printed badges. Any badge still using ?pin= exposes a valid PIN to any HTTP intermediary/CDN log before the client-side scrub runs. Rate limiting in verify_pin caps guessing but does not stop a logged real PIN from being reused.
  
  _Evidence:_ js/app.js:353 — const autoPin = hashParams.get('pin') || urlParams.get('pin');  (query-string PIN honored)
  
  _Fix:_ Deprecate the ?pin= form: reject query-string PINs (fragment-only), reissue any printed badges to the #pin= form, and consider single-use badge tokens instead of embedding the raw PIN.

- ⚪ **INFO** — askPool prefer_ms grants only the ~4s default grace, so targeted text/vision routing can be stolen by the pool
  
  The digest records a hard-won rule that plain prefer grace is ~4s (the PC/other nodes steal targeted jobs) and that a real exclusive claim needs prefer_ms = ts+90000. askPool sets prefer_ms: prefer ? Date.now() : null (js/app.js:4190), i.e. only the 4s grace. For load-balanced strongest-node routing this is acceptable, but it means the 'route vision to the 3070 / text to the Claude node' preference is best-effort only and can be pre-empted by a faster/other node within seconds — worth knowing when Scan-Plate quality or Claude-voice fidelity matters.
  
  _Evidence:_ js/app.js:4190 — prefer: prefer, prefer_ms: prefer ? Date.now() : null,  (vs the digest's ts+90000 exclusive-window recipe)
  
  _Fix:_ If exclusive strongest-node routing is desired for vision/Claude text, set prefer_ms to Date.now()+90000 (matching the sealed-command recipe) so the preferred node actually gets a claim window; otherwise document that routing is a soft hint.


### `board` — Kanban board  · health: 🟡 fair


The board (js/board.js, 4,700 lines) is in decent operational shape: the houseless-card leak that birthed #933/#934 is fixed at the source (cleaning.js now writes `location` on auto-escalation, and the Unfiled audit chip guards regressions — DB verified 0 houseless of 32 open cards), Law 2 is respected (every bulk/close path is gated behind an explicit confirm; nothing auto-closes stale cards), and the Unowned lens works as designed. However, Law 3 (supabase-js resolves with {error}) is violated pervasively — createCard can toast "Card created" on a failed insert, and the data loaders silently render an empty board on query error. The Clean Up triage flow has two real defects: its "Close" action produces ghost cards that the board forever renders as open (isDone never consults status/closed_at), and its query excludes NULL-status cards, hiding 15 of today's 32 open cards from triage. The snooze_until column exists in the DB but is referenced by zero code anywhere — a phantom feature. Health: fair — core card lifecycle, realtime, and escalation guardrails are solid; the rot is in error handling and the triage/terminal-state edges.


- 🟠 **HIGH** — createCard and data loaders never check supabase {error} — dead catches (Law 3) · `js/board.js`
  
  board.js systematically destructures only {data} from supabase-js calls inside try/catch, but supabase-js RESOLVES with {error} — the catches are dead. Worst case is createCard: if the insert fails (RLS, constraint, offline PostgREST error), `created` is undefined, yet the code proceeds to loadCards(), render(), and toasts 'Card created' (success) — the user is told a card exists that was never written. Same pattern in loadBoards/loadLists/loadCards (a transient query error silently renders an EMPTY board, which reads as data loss), promptNewList, and the priority/due-date quick actions (optimistic state kept + success toast on a resolved error).
  
  _Evidence:_ board.js:3380 `const { data: created } = await NX.sb.from('kanban_cards').insert({...}).select().single();` — no error check; board.js:3427 `NX.toast && NX.toast('Card created', 'success')` fires regardless. board.js:436-441 loadCards: `const { data } = await NX.sb.from('kanban_cards')...; cards = data || [];` inside try/catch with no error check. board.js:1760 `await NX.sb.from('kanban_cards').update({ priority: newPri })...` — result discarded entirely, catch only reachable on throw.
  
  _Fix:_ Destructure and check `error` at every call site (the codebase's own documented law). Minimum fix: createCard must throw on error before the success toast; loadCards should surface a 'Could not load board' toast instead of silently rendering empty.

- 🟠 **HIGH** — Triage 'Close' creates ghost-open cards: isDone() never consults status or closed_at · `js/board.js`
  
  The Clean Up walkthrough's Close button sets status='closed' + closed_at but leaves list_id and column_name untouched. isDone() decides done-ness ONLY from column_name (anchored regex) or the list's name — it never looks at status or closed_at. So a triage-closed card stays rendered as an active card in its original lane forever: it counts in the 'N open' chip, can trigger the overdue banner, appears in the Stale/Unowned lenses, and shows red age markers. Additionally, the Close path never calls closeMirrorTicket(), so the mirrored ticket stays open in Duties/Home counts (closing the mirror only happens on the archive path and on moveCard-to-done). DB check shows 0 such rows today, so the damage is latent, but any future use of Close breaks silently.
  
  _Evidence:_ board.js:3741-3746 close action: `const closePayload = { status: 'closed', closed_at: ... }` with no list_id/column_name change and no closeMirrorTicket call (contrast archive branch at 3734-3737 which calls it). board.js:378-386 isDone: `const cname = (card.column_name || '').toLowerCase(); if(cname) return /^(done|closed|...)$/.test(cname);` — status/closed_at never read. SQL verified: closed_status_in_open_lane=0, closedat_in_open_lane=0 (latent, not yet damaging).
  
  _Fix:_ Make triage-Close also move the card to the board's terminal list (list_id + column_name), or teach isDone() to treat status in (closed,done,resolved) or a non-null closed_at as done (getOpenCardsForEquipment at board.js:4048 already does exactly this — reuse that logic), and call closeMirrorTicket on close.

- 🟠 **HIGH** — Clean Up triage query hides NULL-status cards — 15 of 32 open cards invisible to it · `js/board.js`
  
  openTriageModal loads candidates with `.not('status', 'in', '(closed,done)')`. In SQL, `NOT (status IN (...))` evaluates to NULL for NULL status, so rows with status NULL are excluded. Verified against the live DB: 15 of the 32 non-archived cards currently have status NULL (cards created via the composer get no status until first moved). Nearly half the backlog can never be reached by the very tool built to burn down backlog — and the Clean Up button's trigger condition (open > 30) is currently met, so this is live today.
  
  _Evidence:_ board.js:3611 `.not('status', 'in', '(closed,done)')`. SQL verified: `select count(*) from kanban_cards where archived=false and status is null` → 15 (of open_total=32).
  
  _Fix:_ Change the filter to `.or('status.is.null,status.not.in.(closed,done)')` or filter client-side after fetching archived=false rows.

- 🟡 **MEDIUM** — Ordering board's 'Received' lane is not terminal — received orders count as open forever · `js/board.js`
  
  The terminal-state regex (done|closed|resolved|complete|archived) doesn't match 'Received' or 'Ordered'. Cards moved to Received on the Ordering board are treated as open work: they inflate the 'N open' chip, accrue red '14d old' age markers, surface in the Stale and Unowned lenses, never get closed_at stamped, and their mirror tickets are never closed by moveCard. The lane also doesn't collapse or offer Archive-all like Done does. DB confirms 2 non-archived cards sitting in Received (oldest 2026-07-02) counted as open.
  
  _Evidence:_ board.js:380/385/984/2019 — the shared regex `(done|closed|resolved|complete|archived?)` in isDone, isTerminal, and movingToDone; statusMap at board.js:2008-2016 has no 'received' entry. SQL verified: board 'Ordering', list 'Received' → 2 open cards.
  
  _Fix:_ Add received (and arguably 'delivered') to the terminal-name set, or give board_lists an explicit is_terminal flag instead of name-regex inference.

- 🟡 **MEDIUM** — isDone column_name branch uses an anchored regex with no list fallback — diverges from the unanchored terminal checks · `js/board.js`
  
  isDone() with a non-empty column_name returns the ANCHORED test result immediately and never falls back to the list lookup, while isTerminal (renderLists) and movingToDone (moveCard) use the UNANCHORED regex on list names. If Alfredo ever renames/creates a terminal list non-exactly (e.g. 'Done ✓', 'Closed — 2026'), moving a card there stamps closed_at, collapses the lane, and spawns repeats — but isDone returns false for its cards (column_name 'done_✓' fails ^...$), so they'd count as open, re-trigger the overdue banner, and pollute the lenses. Latent today: all 6 current list names are exact matches (verified). Reverse risk: the unanchored regex would also treat a list named e.g. 'Undone' as terminal.
  
  _Evidence:_ board.js:378-386 `if(cname) return /^(done|closed|resolved|complete|completed|archived?)$/.test(cname);` (early return, anchored) vs board.js:984 `const isTerminal = /(done|closed|resolved|complete|archived?)/.test(listNameLC)` and board.js:2019 same unanchored pattern. SQL verified: terminal_lists_nonexact=0 currently.
  
  _Fix:_ Use one shared predicate for all three call sites, and have isDone fall through to the list-name check when the column_name test fails rather than early-returning.

- 🔵 **LOW** — Active Unowned/Unfiled filter can strand the board when its chip disappears · `js/board.js`
  
  The 'Unowned · N' and 'Unfiled · N' chips render only while their counts are > 0. If the user activates the lens and the last matching card is then handled (e.g. an assignee set via realtime from another device, triggering a re-render), the chip vanishes while filters.state/'unfiled' remains applied — the board shows 'No cards match the filter' in every column with no visible active chip to tap off. Recoverable by tapping another filter or reloading, but confusing in the moment.
  
  _Evidence:_ board.js:900-901 `if (nUnowned) html += mk('state', 'unowned', ...)` and board.js:909 `if (nUnfiled) html += mk('location', 'unfiled', ...)` — render gated on count, while filters.state persists in module state independently.
  
  _Fix:_ Always render the chip while its filter is ACTIVE (even at count 0), or auto-clear the filter when its count reaches 0.

- 🔵 **LOW** — Stats modal counts Done-lane cards as 'Open' — contradicts the summary strip · `js/board.js`
  
  openStatsModal computes `const open = cards.length` (all non-archived cards on the active board), while the summary strip correctly excludes terminal-lane cards via isDone. With 6 cards currently sitting non-archived in the Done lane, the strip says 26 open while Stats says 32 — two adjacent numbers on the same screen disagree, the exact confusion the strip's own comment says was already fixed once.
  
  _Evidence:_ board.js:3538 `const open = cards.length;` vs board.js:729-731 `const openCards = cards.filter(c => !isDone(c));`. SQL: 6 non-archived cards in Operations/Done.
  
  _Fix:_ Use `cards.filter(c => !isDone(c)).length` in the stats modal too.

- 🔵 **LOW** — Auto-escalated cleaning cards always sort to the very bottom of their lane · `js/cleaning.js`
  
  The cleaning auto-escalator inserts cards with `position: Date.now()` (~1.75e12), while every board-native creation path uses add-to-top (min position minus 1, values near or below 0). Since lanes sort by position ascending, an auto-escalated overdue-cleaning card — arguably the most urgent thing in the lane — always renders dead last, below weeks of older cards, until someone manually drags it.
  
  _Evidence:_ cleaning.js:1166 `position: Date.now()` vs board.js:3388-3392 add-to-top convention `Math.min(...positions) - 1` and moveCard's fractional midpoints (board.js:1165-1180).
  
  _Fix:_ Have the escalator compute min(position)-1 for the target list (or just insert position: -Date.now() to land on top).

- ⚪ **INFO** — snooze_until is a phantom column — exists in DB, referenced by zero code · `js/board.js` · _known_
  
  kanban_cards.snooze_until exists in the schema but a repo-wide grep finds no reference to it in any JS, SQL, or edge-function file, and 0 rows have it populated. board.js has no snooze affordance and, critically, no read: if anything ever does write it (a future Clippy skill, a manual SQL nudge), the board will keep rendering the 'snoozed' card as fully active — the field is silently inert. The steward digest already notes 'kanban snooze 0' as an unlearnable-signal gap.
  
  _Evidence:_ SQL: information_schema.columns → snooze_until on kanban_cards; `select count(*) ... where snooze_until is not null` → 0. Grep of /home/user/nexus for 'snooze_until' → no matches.
  
  _Fix:_ Either build the snooze feature (filter `snooze_until > now()` out of applyFilters + a quick-action chip) or drop the column so it can't become a trap.

- ⚪ **INFO** — Houseless-card leak (#933/#934) is confirmed fixed; Unfiled guardrail active; DB clean · `js/board.js` · _known_
  
  The auto-escalator that birthed houseless cards #933/#934 (cleaning section → board) now writes `location: activeLoc` alongside cleaning_link_location, with a comment documenting the original leak. board.js carries the defense-in-depth: the composer forces a location choice, createCard falls back to equipment location then last-used location, and the 'Unfiled · N' audit chip renders only while houseless cards exist. Live DB verified: 0 of 32 open cards have null/empty location, 0 boardless cards. The guardrail chain is sound.
  
  _Evidence:_ cleaning.js:1152-1167 insert includes `location: activeLoc` (comment: 'This auto-escalator was the leak that birthed cards #933 and #934 houseless'). board.js:909 Unfiled chip, board.js:3371-3379 createCard location fallback. SQL: houseless_open=0, boardless_open=0.
  
  _Fix:_ No action needed; keep the Unfiled chip as the tripwire.

- ⚪ **INFO** — Law 2 compliance verified: no auto-close of stale cards anywhere in board.js · `js/board.js`
  
  Audited every archive/close path: the Clean Up triage is strictly one-card-at-a-time with explicit Archive/Close/Skip buttons and an undo; 'Archive ALL remaining' and per-column 'Archive all' are both gated behind an explicit themed confirm stating the count; nothing runs on a timer or on load. The stale-14d+ lens only FILTERS, never mutates. The one-time backfillIssueCards on show() only CREATES cards (additive), never closes. This is the correct posture given Alfredo's standing correction.
  
  _Evidence:_ board.js:3786 nxConfirm before bulk archive ('This bulk-archives all N cards you haven't triaged yet'); board.js:1010 nxConfirm before column Archive-all; board.js:666-669 stale filter is read-only; no setInterval/cron-like close logic in the file.
  
  _Fix:_ Preserve this posture; any future 'auto-tidy' idea must be an explicit owner ask first.


### `cleaning` — Cleaning + duties  · health: 🟡 fair


The cleaning lane (js/cleaning.js 3643 lines + js/duties.js 262 lines) is structurally healthy: the 8am America/Chicago shift roll in getCleaningDate is DST-correct at the date level, the core check-off path (persistDone) properly destructures {error} with an optimistic-UI rollback, the two-NX trap is neutralized by app.js:4584 (window.NX = lexical NX), and the auto-escalator is verifiably off per Alfredo's v288 request (flag false in code, 0 open "(auto)" cards in the DB). The real defects are in secondary write paths that still violate house law 3 — the "send summary to Daily Log" flow and the crew-assignment delete both discard supabase results behind dead catches, so failures toast success — plus a zone-photo flow that silently marks an arbitrary task complete, and an emailed report that uses the legacy positional history while the screen uses identity-based history. Separately worth the owner's eye: cleaning activity has gone quiet — the newest cleaning_logs row is 2026-07-10 (12 days ago), only 32 done-rows and 0 photo attachments in the last 30 days across all three restaurants. All DB dependencies the code assumes (cleaning_last_done RPC, both upsert unique constraints, both storage buckets, all seven cleaning tables) were verified present.


- 🟠 **HIGH** — Daily Log summary write never checks errors — always toasts success (law 3) · `js/cleaning.js`
  
  liteSummaryToDailyLog awaits facility_logs .update() and .upsert() without destructuring {error}. supabase-js resolves with {error}, so the surrounding try/catch is dead for RLS/constraint/network failures — the user is always told 'Summary added to today's Daily Log' even when nothing was written. This is exactly the recurring dead-catch bug house law 3 names. The upsert's onConflict target (log_date,log_type,created_by) does exist as a unique constraint (verified), but any rejected write is silently swallowed.
  
  _Evidence:_ cleaning.js:3097-3099: `if (row && row.id) await NX.sb.from('facility_logs').update({...}).eq('id', row.id); else await NX.sb.from('facility_logs').upsert(payload, ...); toast('Summary added to today's Daily Log', 'success');` — no {error} destructure on either call.
  
  _Fix:_ Destructure { error } from both calls, and on error toast a failure and skip the success toast (mirror persistDone's pattern at cleaning.js:913-936).

- 🟠 **HIGH** — Crew-assignment deletes unchecked — failed clear + insert leaves ghost/duplicate crew (law 3) · `js/cleaning.js`
  
  liteAssignZone (line 2338) and autofillAssignmentsForUser (line 1199) await cleaning_task_assignments .delete() without checking {error}; both catches are dead per law 3. If the clear fails but the subsequent inserts succeed, removed people remain assigned and rows duplicate — cleaning_task_assignments has NO unique constraint (verified: only PRIMARY KEY (id)), so nothing at the DB stops it. Client-side Sets hide duplicates but a person 'removed' from a zone silently stays on the schedule, the printed week, and the per-person Excel.
  
  _Evidence:_ cleaning.js:2338-2339: `await NX.sb.from('cleaning_task_assignments').delete().eq('scope','weekly').in('task_id', taskIds).in('day_of_week', days);` — result discarded. cleaning.js:1199-1202: same pattern inside `try { ... } catch (e) { console.warn(...) }` which never fires on a resolved {error}.
  
  _Fix:_ Destructure { error } from both deletes; on error abort the assignment write and toast, instead of proceeding to insert the new crew on top of the stale one.

- 🟡 **MEDIUM** — Zone-menu 'Add photo' silently marks the zone's first task done, without task identity · `js/cleaning.js`
  
  liteZonePhoto attaches a general zone photo to z.tasks[0] (an arbitrary task) via uploadPhotoForTask, which then auto-marks that task complete attributed to the current user — a completion nobody tapped. That persistDone call also omits the 4th taskId argument, so the log row is written with task_id:null (positional-only, weakening the v18.37 identity history), and the failure-rollback branch `if (taskId) delete lastDoneByTaskId[taskId]` can never clean the identity cache. Additionally this path uploads to bucket 'cleaning-attachments' while the photo-required gate path (uploadCleaningPhoto) uploads to 'nexus-files/cleaning/...' — the same feature's evidence is split across two buckets (both exist, verified).
  
  _Evidence:_ cleaning.js:2891-2894: `const first = z && z.tasks[0]; ... uploadPhotoForTask(first);` → cleaning.js:1034-1037: `if (!getDoneState(...)) { setDoneState(..., true); await persistDone(task.section_es, task.task_order, true); }` — no taskId arg, unconditional auto-complete.
  
  _Fix:_ In uploadPhotoForTask pass task.id to persistDone; for the zone-menu path either ask which task the photo belongs to or attach without auto-completing. Consolidate on one storage bucket for cleaning evidence.

- 🟡 **MEDIUM** — Emailed report uses legacy positional history; screen uses identity history — they can disagree · `js/cleaning.js`
  
  buildEmailBody's ON SCHEDULE section reads lastDoneByKey[section_es + '_' + task_order] directly (lines 1444 and 1463) instead of the identity-first lastDoneFor(t) helper the UI's freshness engine uses (line 317-319). After a task reorder or section rename (the exact cases v18.37's task_id identity was added to survive), the emailed report says 'never done' / 'OVERDUE Nd' for tasks the screen correctly shows fresh — and within one email the section symbol (computed via freshnessForTask, identity-first) can contradict its own per-task detail lines.
  
  _Evidence:_ cleaning.js:1444: `const hist = lastDoneByKey[t.section_es + '_' + t.task_order];` and cleaning.js:1463 (same), vs cleaning.js:1444's sibling freshnessForTask→lastDoneFor at cleaning.js:210+317.
  
  _Fix:_ Replace both direct lastDoneByKey lookups in buildEmailBody with lastDoneFor(t).

- 🔵 **LOW** — periodicNextDue mixes local-midnight parse with UTC toISOString — due dates shift a day on UTC-positive devices · `js/cleaning.js`
  
  periodicNextDue (3113-3120) and overdueByLocation (3616-3619) parse last-done as local midnight (`new Date(last + 'T00:00:00')`) then extract the date via `.toISOString().slice(0,10)` (UTC). On any device whose timezone is east of UTC, local midnight maps to the previous UTC day, so the computed due date is one day early — inconsistent with the module's own America/Chicago pinning elsewhere (getCleaningDate, liteShift) and with exportCleaningExcel's dueFor, which uses localISO (local fields) and thus disagrees with the screen on such devices. Harmless for Austin devices (UTC-5/-6), where local midnight stays on the same UTC date.
  
  _Evidence:_ cleaning.js:3116-3119: `const d = new Date(last + 'T00:00:00'); ... d.setDate(d.getDate() + periodicFreqDays(t)); return d.toISOString().slice(0, 10);` vs cleaning.js:582-587 dueFor using localISO(d).
  
  _Fix:_ Use the localISO helper (local date fields) in periodicNextDue and overdueByLocation instead of toISOString, matching the Excel export.

- 🔵 **LOW** — New periodic tasks count as 'overdue' the moment they are created (header chip + Clippy's Watch) · `js/cleaning.js`
  
  liteOverdueCount (2784-2792) and overdueByLocation (3612-3621) both treat never-done periodic tasks as overdue immediately ('never done → due now'), with no creation-date grace. The disabled auto-escalator has exactly that guard (measure from created_at, lines 1104-1110) but the visible surfaces don't, so adding a fresh monthly task instantly inflates the '✦ N deep-cleans overdue' chip and Clippy's ops-pulse cleaningOverdue count, making the number read as debt that isn't real yet.
  
  _Evidence:_ cleaning.js:2789: `if (!periodicLastDone(t) || (next && next < today)) n++;` and cleaning.js:3614: `if (!last) { n++; return; } // never done → due now`.
  
  _Fix:_ Apply the escalator's created_at-based grace (task is 'due now' only after frequency_days from creation) to both counters, or label never-done tasks separately from overdue ones.

- 🔵 **LOW** — 8am-rollover watchdog refreshes today's state but leaves freshness, week strip, and costs stale · `js/cleaning.js`
  
  The visibilitychange watchdog (2027-2038) re-derives the shift date and reloads loadTodayState + loadAttachments only; loadHistory, loadWeekStats, and loadCosts still hold the previous shift's data until a location switch or view re-entry. After a tablet parked overnight crosses 8am: freshness bars/overdue chips compute against yesterday's 'today', the week strip's 7-day window is off by one, and a Submit & email fired before any location switch can carry yesterday's COSTS section (costsByKey is date-scoped but never reloaded). liteToggleTask's rollover guard (2664-2671) has the same partial reload.
  
  _Evidence:_ cleaning.js:2030-2036: `today = liveDay; ... await loadTodayState(); await loadAttachments(); render();` — no loadHistory()/loadWeekStats()/loadCosts().
  
  _Fix:_ Call reloadLocationState() (the unified loader at 384-395, built for exactly this drift class) in both rollover paths instead of the hand-picked subset.

- 🔵 **LOW** — A 4th restaurant discovered from the locations table renders with zero tasks on first entry each session · `js/cleaning.js`
  
  loadLocationMeta appends new location keys to LOCATIONS (479-484) so a 4th restaurant joins without a code change — but show() calls loadAllTasks() (2132) BEFORE loadLocationMeta() (2143), and init() never calls loadLocationMeta at all. So on the first entry to the cleaning view each session the new location's pill/card appears but tasksByLoc has no entry for it: entering it shows 'No zones yet — add tasks for this location first' until the user leaves and re-enters the view. Only matters when Karaz (or any 4th house) is added; the base trio is hardcoded and unaffected.
  
  _Evidence:_ cleaning.js:2132 `await loadAllTasks();` … cleaning.js:2143 `await loadLocationMeta();` (order), and init() at 1986-2084 contains no loadLocationMeta call.
  
  _Fix:_ In show(), run loadLocationMeta() before loadAllTasks() (and add it to init()), so newly discovered keys get their tasks loaded in the same pass.

- ⚪ **INFO** — 8am US-Central day roll verified DST-correct; residual fragility is the locale-string re-parse · `js/cleaning.js`
  
  getCleaningDate (166-177) re-parses `new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})` to get Chicago wall-clock, then rolls the date back before 8am. This is DST-correct at the date level: toLocaleString always yields the true Chicago wall clock (CST or CDT), and the spring-forward gap (2am) can only perturb the re-parsed getHours by ±1 in a window that never crosses the 8am boundary, so the shift date is right year-round. daysBetween uses UTC-midnight parses whose difference is always an exact multiple of 86400000, so freshness math is DST-immune too. The one fragility: the pattern depends on Date.parse accepting Intl output (including the narrow no-break space modern browsers emit before AM/PM); if a future engine's parse rejects it, today becomes 'NaN-NaN-NaN' and every write fails — visibly, since persistDone's rollback would fire. The two shift-rollover watchdogs (visibilitychange at 2027-2038, liteToggleTask guard at 2664-2671) correctly re-derive the date.
  
  _Evidence:_ cleaning.js:171: `const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));` + cleaning.js:180-182 daysBetween.
  
  _Fix:_ No action required; if hardening is ever wanted, derive Chicago Y/M/D/H via Intl.DateTimeFormat.formatToParts instead of re-parsing a locale string.

- ⚪ **INFO** — Auto-escalator compliance confirmed: disabled per Alfredo (v288), zero live auto-cards · `js/cleaning.js`
  
  House law 2 check passes. AUTO_ESCALATE_ENABLED=false (line 1075, keeper's v288 request 'remove the tickets prompting it') makes runAutoEscalations a no-op at both call sites (init timer at 2083, tab handler at 2020); DB query confirms 0 open kanban_cards titled 'Cleaning · … (auto)'. The mechanism is kept intact as requested, and if ever re-enabled it now writes `location` (the v281 fix for houseless cards #933/#934), has a creation-date grace for never-done tasks, and a per-shift-day dedupe guard. No cron replicates it. Manual 'send to board' unaffected.
  
  _Evidence:_ cleaning.js:1075: `const AUTO_ESCALATE_ENABLED = false;` + cleaning.js:1078 early return; SQL: count of unarchived kanban_cards like 'Cleaning ·%(auto)' = 0.
  
  _Fix:_ None — this is the compliant state. If Alfredo ever asks to re-enable, flip the one flag.

- ⚪ **INFO** — Cleaning activity has gone quiet: no check-offs in 12 days, zero photos in 30 days · `js/cleaning.js`
  
  Usage signal for the owner, not a code bug: max(log_date) in cleaning_logs is 2026-07-10 (today is 2026-07-22), with only 32 done-rows in the last 30 days across all three restaurants and 0 cleaning_attachments rows in 30 days. Either the crews have stopped using the checklist (paper fallback?), or something upstream of this lane (device/login) is blocking them. All 30-day rows do carry task_id (identity migration is holding). This dovetails with the digest's 'he goes quiet' data-capture thread.
  
  _Evidence:_ SQL against oprsthfxqrdbwdvommpw: last_log_date=2026-07-10, logs_30d_total=32, attach_30d=0, logs_30d_null_taskid=0.
  
  _Fix:_ Surface to Alfredo as a question, not a fix: is the cleaning checklist still in daily use? Do not bulk-modify or backfill anything without his say.


### `ordering` — Ordering  · health: 🟡 fair


The ordering lane is functionally healthy and the pars law is respected in behavior: the old par auto-fill is gone, fill modes are only last_order/empty (js/ordering.js:3235-3245, 3319-3389), legacy 'par' preferences degrade to 'empty', DB confirms no 'par' fill mode remains (29 empty / 1 last_order), and pars render strictly as reference chips. The send pipeline is careful (offline IndexedDB draft queue, atomic replace_order_lines RPC, sync-gate before send, 10s undo). The most important defects found: loadOrderById silently ignores a failed order_lines fetch, so a reopened draft can render empty and the next autosave atomically wipes its saved lines (latent silent data loss); the last-order fill/hints query only status='sent' so they will skip orders once the confirmed/delivered/closed lifecycle is used; and there are several law-3 dead-catch sites where a supabase-resolved error is never checked (worst: the fill-mode preference write). Lifecycle capture remains almost unused in the DB (2/76 delivered_at, 0 issue_at — known prior art), and 75/76 orders are archived, but all archives are single, user-initiated actions — no auto-close/bulk-modify code or cron touches orders, so law 2 is clean here. One terminology drift: the XLSX catalog template describes "Default Par" as "Default order quantity", which teaches exactly the mental model the pars law forbids.


- 🟠 **HIGH** — Reopened draft can silently lose all its lines after a failed order_lines fetch · `/home/user/nexus/js/ordering.js`
  
  loadOrderById (line 501) destructures only {data: lines} from the order_lines select and never checks the resolved error: `const { data: lines } = await NX.sb.from('order_lines').select('*')...; return { ...order, lines: lines || [] }`. On a transient failure (mobile wifi drop is common here) the draft opens in openOrderInEntry (3412-3442) with zero lines rendered. The first edit then triggers persistDraft, whose replace_order_lines RPC (4565-4569) atomically replaces ALL DB lines with the in-memory set — permanently deleting every line the draft actually had. This is the exact supabase-resolves-with-{error} trap (house law 3) escalated to a data-loss path.
  
  _Evidence:_ js/ordering.js:501-504 (error ignored), 3432-3442 (entryState.lines seeded from possibly-empty order.lines), 4555-4569 (replace_order_lines wipes DB lines to match memory).
  
  _Fix:_ Check the error on the order_lines fetch in loadOrderById; on error either return null (treat the whole load as failed) or mark the order object linesLoadFailed and have openOrderInEntry refuse to autosave until a successful line load.

- 🟠 **HIGH** — Fill-mode preference write is a dead catch — supabase error never checked (law 3) · `/home/user/nexus/js/ordering.js`
  
  openFillModePicker persists the vendor's default_fill_mode with `await NX.sb.from('order_vendors').update({ default_fill_mode: mode }).eq('id', vendor.id);` inside try/catch (3377-3382) without destructuring/checking {error}. supabase-js resolves with {error}, so a failed write is invisible: the catch never fires, no console.warn, and the next line still sets vendor.default_fill_mode = mode, so the UI claims the preference saved when the DB may not have. Practical blast radius is small (pref reverts next session), but this is the exact recurring house-law-3 pattern the estate has repeatedly paid for, and the adjacent v18.27 comment claims persistence was 'Fixed'.
  
  _Evidence:_ js/ordering.js:3377-3382; contrast with the correct pattern at 3376 comment and at 2171-2183 (toggleVendorPin checks error).
  
  _Fix:_ Destructure `const { error } =` and on error skip the in-memory `vendor.default_fill_mode = mode` assignment and log/toast.

- 🟡 **MEDIUM** — Last-order fill and 'last:' hints only match status='sent' — lifecycle use will silently break them · `/home/user/nexus/js/ordering.js`
  
  Both fillFromLastOrder (3273-3280) and loadLastOrderHints (3579-3582) query `.eq('status','sent')`. The lifecycle is forward-only (draft→sent→confirmed→delivered→closed, 2886), so an order marked confirmed/delivered/closed no longer matches — 'Fill from last order' and the per-row 'last:' hints skip the genuinely most-recent order and fall back to an older still-'sent' one or nothing. Today only 2 orders (1 delivered, 1 closed) are affected, but the more Alfredo adopts the delivered/confirmed buttons the audit is trying to encourage, the worse this quietly degrades.
  
  _Evidence:_ js/ordering.js:3277 and 3581 (`.eq('status','sent')`); SQL: orders = 49 sent, 0 confirmed, 1 delivered, 1 closed, all 51 post-sent rows have email_sent_at (post_sent_missing_stamp=0).
  
  _Fix:_ Filter on `.not('email_sent_at','is',null)` (or status in the full post-sent set) instead of status='sent' in both queries.

- 🟡 **MEDIUM** — Send proceeds after a failed DB save — email can go out with no order record · `/home/user/nexus/js/ordering.js`
  
  confirmAndSend wraps the entire mark-sent persistence (insert/update of the orders row plus order_lines insert for new orders, 5158-5203) in a try/catch whose handler is 'Could not save order — sending email anyway' (5204-5207), then opens the mail draft regardless. For a brand-new order this means a real vendor email with zero NEXUS record; the Daily Pulse then counts that vendor as needs-ordering/cutoff-unsent (599-621), inviting a double order. The offline-queue sync gate (flushDraftIfPending returning false) is also inside the try, so if it throws, its abort intent is swallowed by the same catch. The warning toast is the only signal and lives 3 seconds.
  
  _Evidence:_ js/ordering.js:5157-5207 (catch continues to mailto), 5161-5162 (sync gate inside the same try), 592-621 (pulse counts keyed on order rows/email_sent_at).
  
  _Fix:_ On save failure, block the send and offer explicit 'Send anyway' confirm instead of a transient toast, or at minimum queue the sent-payload in the existing IndexedDB queue so the record is eventually written.

- 🟡 **MEDIUM** — XLSX catalog template describes par as 'Default order quantity' (pars-law terminology drift) · `/home/user/nexus/js/ordering.js`
  
  The exported catalog template's instruction sheet defines the 'Default Par' column as 'Default order quantity. Per-location pars set inside NEXUS.' (8125) and a tip reads 'Per-location pars (Este orders 5, Suerte orders 3)' (8133). The importer additionally maps spreadsheet columns literally named 'qty'/'quantity' into default_par_qty (8375). No order-by-par behavior exists anywhere — the full sweep is clean — but this owner-facing text teaches exactly the par=order-quantity model Alfredo's standing correction forbids, and will train staff editing the spreadsheet to enter order quantities as pars.
  
  _Evidence:_ js/ordering.js:8125, 8133, 8375 (`default_par_qty: colIdx(['par','qty','quantity'])`).
  
  _Fix:_ Reword to 'Stock level to keep on hand (reference only — not an order quantity)' and drop 'qty'/'quantity' from the par column aliases.

- 🔵 **LOW** — Several more resolved-error-ignored sites (law-3 family, lower impact) · `/home/user/nexus/js/ordering.js`
  
  Same pattern as the fill-mode dead catch, smaller consequences: (a) fillFromLastOrder's first query destructures only data (3273-3280), so a network error is misreported to the user as 'No previous order found — starting empty'; (b) loadLastOrderHints likewise (3579-3585); (c) deleteItem/deleteSection never check the order_lines detach or order_guide_pars delete results (7811-7818, 7863-7870) — mostly self-correcting because the final FK'd delete errors, but a failed pars delete after a succeeded item delete would orphan par rows; (d) the vendor-editor item count ignores error (5413-5418, shows 0).
  
  _Evidence:_ js/ordering.js:3273, 3579, 7811-7818, 7863-7870, 5413-5418.
  
  _Fix:_ Destructure and check {error} at each site; at minimum distinguish 'query failed' from 'no rows' in user-facing toasts.

- 🔵 **LOW** — Reopening a draft drops house_name from its saved lines on next autosave · `/home/user/nexus/js/ordering.js`
  
  openOrderInEntry seeds entryState.lines from order.lines but omits house_name (3432-3441: qty/unit/item_name/vendor_sku/note only), while persistDraft writes `house_name: l.house_name || null` (4559). So editing any reopened draft rewrites every line with house_name null. Impact is limited because outgoing emails resolve names from the live catalog (pickHouseName at 5021), but the denormalized order history loses the team-name snapshot the column exists to preserve (reportIssuesOnOrder at 2544 reads l.house_name from lines).
  
  _Evidence:_ js/ordering.js:3432-3441 vs 4555-4561 and 2544.
  
  _Fix:_ Copy house_name: l.house_name || null into the seed at 3434.

- ⚪ **INFO** — Lifecycle capture near-empty in DB; 75/76 orders archived — all by explicit single actions (law 2 clean) · `/home/user/nexus/js/ordering.js` · _known_
  
  Live DB: 76 orders — 49 sent, 25 draft, 1 delivered, 1 closed, 0 confirmed-status; delivered_at 2, confirmed_at 2, issue_at 0. The delivered/issue capture the world-model thread depends on is still effectively unpopulated (transitions are strictly user-initiated buttons, 2882-2884 — no auto-transitions, which honors law 2). 75/76 orders carry archived_at, but timestamp analysis shows one-at-a-time archives interleaved with the next order's creation (Alfredo's tidy-as-you-go habit; the only cluster is 12 rows across 2 minutes on 2026-07-08, consistent with a rapid manual sweep). No code path or pg_cron job auto-archives or bulk-modifies orders — the only archive-ish cron (job 23) targets kanban_cards, another lane.
  
  _Evidence:_ SQL: counts above; archived_at grouped by minute shows singleton archives matching next-order created_at; cron.job scan returned only jobid 23 (kanban). Code: only archiveOrder (2805) writes archived_at, per-order, behind explicit UI.
  
  _Fix:_ If delivered/issue data matters for the pre-approved ordering-cadence projection, the friction point is UX (buttons live only in the order detail view) — consider a one-tap 'Delivered?' prompt on arriving-today orders. Owner decision, per prior art.


### `inventory-vendors` — Inventory + vendors  · health: 🟡 fair


Inventory (js/inventory.js, 2637 lines) and Vendors (js/vendors.js, 2542 lines) are both fully built, but usage is lopsided: vendors is live (13 rows, 9 active) while inventory is nearly empty (1 stock item, 0 assets, 0 reorder cards), so several inventory bugs are latent rather than bleeding. The most important find is a par-law violation waiting to fire: auto-created reorder cards embed a suggested order quantity computed from par ((par - count) * 2). On the vendors side, the soft-delete flow's fire-and-forget equipment unassign (a dead catch around supabase-js) has already produced real damage — SQL confirms 3 equipment rows still point at inactive vendors, and 3 vendor names now exist as active+inactive duplicate pairs, splitting history. A wrong-column archived filter (e.archived vs the real archived_at) means the 3 archived equipment units leak into vendor pickers and the inventory Assets list. Vendor email templating (NX.vendorEmail / renderVendorTemplate) checked out correct: token map matches the form's documented tokens, unknown tokens stay visible, extra emails CC correctly.


- 🟠 **HIGH** — Reorder cards suggest an order quantity computed from par (par law violation) · `js/inventory.js`
  
  House law #1: pars are reference numbers only; never build or suggest order-by-par / auto-fill from pars. This code auto-derives and writes an order quantity from par_level into every reorder kanban card. It has not fired yet only because the inventory module is barely used (0 reorder cards in kanban_cards), but the single live stock row (Round Plates, count 0, threshold 6) will trigger it on the next count.
  
  _Evidence:_ Line 2320, inside createReorderCard's auto-generated card description: `Suggested order: ${(stock.par_level - currentCount) * 2} units (rebuild buffer)`. Cards are auto-created from stockQuickCount (line 1566), audit commit (line 1830), and PM part consumption (line 2279).
  
  _Fix:_ Remove the 'Suggested order' line from the card description (keep count/par/threshold as reference facts only), or replace it with the bare facts and no computed quantity. Do not deploy without Alfredo's ack since it touches a standing correction.

- 🟠 **HIGH** — deleteVendor's equipment unassign is a dead catch — orphaned vendor references confirmed in DB · `js/vendors.js`
  
  House law #3 (dead catch on supabase-js) with realized damage: the app filters every vendor list on active=true, so these equipment rows point at vendors that are invisible everywhere in the UI — the vendor-side 'Equipment Serviced' list, the assign picker's 'taken by another vendor' exclusion (line 1628 hides units whose service_vendor_id is a hidden vendor), and dispatch context all misbehave for these units.
  
  _Evidence:_ Lines 371-372: `try { await NX.sb.from('equipment').update({ service_vendor_id: null }).eq('service_vendor_id', v.id); } catch (_) {}` — supabase-js resolves with {error}, so the catch never fires and the error is never checked. SQL: 3 equipment rows reference inactive vendors — 'Sam Heater' (Misc) service+repair -> Red Bud (active=false), and both Kold Draft ice machines (Este, Suerte) repair -> Austin Industrial Refrigeration (active=false).
  
  _Fix:_ Destructure and check {error} on both unassign updates and surface failure to the user. Separately (with Alfredo's explicit ok — never bulk-modify unasked): repoint the 3 orphaned equipment FKs to the active duplicate vendor rows.

- 🟡 **MEDIUM** — Three duplicate vendor pairs (active + inactive same name) splitting identity and history · `js/vendors.js`
  
  Pattern: vendor 'deleted' (active=false) then re-created, so jobs/spend/scorecards and equipment assignments are split across two ids. Contributing risk: backfillContractorsToVendors (line 1334) reads existing vendors with `try { const { data } = await ... } catch (_) {}` — error unchecked, so a transient read failure yields existing=[] and re-imports every contractor node as a duplicate; the guard is per-device localStorage (line 1322), so every new device re-runs the backfill.
  
  _Evidence:_ SQL group-by normalized name: redbud (2 rows, one active/one inactive), austinindustrialrefrigeration (2), maccinisti (2). The inactive Austin Industrial Refrigeration and Red Bud rows are the ones equipment still references (see previous finding).
  
  _Fix:_ Check {error} on the existing-vendors read and abort backfill on failure (never dedupe against a possibly-empty list). Propose a one-time merge of the 3 pairs to Alfredo (repoint FKs to the active row, keep the inactive as tombstone).

- 🟡 **MEDIUM** — Archived-equipment filter checks nonexistent column — archived units leak into vendor pickers · `js/vendors.js`
  
  The 3 archived equipment units appear in the vendor detail's equipment lists, the Assign Equipment sheet, the Log Service picker, and the Schedule PM picker — so PMs and assignments can be created against retired units. equipment.js itself checks `e.archived_at || e.archived` (line 1574), so the truth is archived_at.
  
  _Evidence:_ Lines 415, 1560, 1767, 2239 filter `(data || []).filter(e => e.archived !== true)`, but SQL confirms the equipment table has archived_at (3 rows set) and NO archived column (query on `archived` errors 42703). `undefined !== true` keeps every row.
  
  _Fix:_ Change the filter to `e => !e.archived_at && e.archived !== true` in all four spots.

- 🟡 **MEDIUM** — inventory loadAll never checks any of its four query errors and doesn't filter archived equipment · `js/inventory.js`
  
  On a failed read the dashboard silently renders '0 below PAR / All clear' — the exact silently-lying-scorecard failure vendors.js fixed with its perfStale banner (vendors.js lines 43-60). And the 3 archived equipment rows render as live assets in the unified Assets list.
  
  _Evidence:_ Lines 771-816: `const [aRes, sRes, schRes, eRes] = await Promise.all([...])` then `aRes.data || []` etc. — no .error check on any result (supabase-js resolves with {error}, so the surrounding try/catch is dead for query failures). The equipment select (lines 783-785) has a comment 'Skip archived rows; assume equipment.is_active is the live signal' but applies no filter at all.
  
  _Fix:_ Check each result's error, surface a 'data unavailable' state instead of empty lists, and add `.is('archived_at', null)` to the equipment select.

- 🟡 **MEDIUM** — Dashboard 'Missing' alert sets an invisible, un-clearable sticky filter on the Assets tab · `js/inventory.js`
  
  After tapping the Missing alert once, the Assets tab is permanently filtered to status=missing for the rest of the session with no UI indication and no way to clear it; a populated assets list would appear to have vanished, and the misleading empty state invites duplicate data entry.
  
  _Evidence:_ Lines 2489-2492 set `state.filters.assetStatus = 'missing'`; assetsViewHTML (lines 1052-1071) renders chips only for kind/location/category — there is no status chip row — and renderEmptyList's hasFilters check (line 1070) omits assetStatus, so with the filter active and no missing assets it shows 'No assets yet. Tap the + button…'.
  
  _Fix:_ Either render a status chip row (with the active status highlighted) or reset assetStatus to 'all' whenever the user navigates to Assets normally; include assetStatus in the hasFilters check.

- 🔵 **LOW** — No validation that reorder_threshold <= par_level; live row already inverted · `js/inventory.js`
  
  With threshold > par the item shows 'REORDER NEEDED' even at full par, and every quick count below 6 auto-creates a reorder card, making the threshold semantics meaningless for this row.
  
  _Evidence:_ Stock edit modal (lines 2018-2024) allows any threshold >= 0 independent of par. The only live stock row: Round Plates, par_level 1, reorder_threshold 6, count 0 — is_below_threshold true whenever count < 6.
  
  _Fix:_ Validate threshold <= par on save (warn, don't block, since par is Alfredo's reference number), and flag the Round Plates row to him for correction.

- 🔵 **LOW** — QR codes rendered via external api.qrserver.com (third-party dependency + internal URL leak) · `js/inventory.js`
  
  Sticker generation and reprints depend on a free third-party service being up and receiving every internal PN/deep-link URL; offline (PWA) QR preview fails entirely, and stickers printed today may be unreproducible if the service changes.
  
  _Evidence:_ Line 2371: `const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?...&data=' + encodeURIComponent(qrUrl)` — used in the QR preview modal and the print fallback (line 2396).
  
  _Fix:_ Bundle a tiny local QR generator (qrcode-svg class library inlined, ~5KB) so stickers render offline and no data leaves the app.

- 🔵 **LOW** — Part-number sequence minting races between devices (duplicate NEXUS-A/S-#### possible) · `js/inventory.js`
  
  With a shared anon key and multiple managers on phones, simultaneous adds mint identical part numbers and QR payloads, which then collide in the scan-dispatch lookup (maybeSingle on qr_code).
  
  _Evidence:_ getNextAssetSeq/getNextStockSeq (lines 2107-2134) read the newest row's internal_pn and add 1 client-side; two devices adding concurrently both compute the same next PN. Error-path is handled (aborts on failed read) but there is no uniqueness guarantee on insert.
  
  _Fix:_ Add a unique constraint on internal_pn (surfacing the insert error to retry with the next number), or mint via an RPC/sequence server-side. Low urgency while the module has 1 row.


### `equipment-core` — equipment.js core (first half)  · health: 🟡 fair


Equipment core (js/equipment.js lines 1-11000) is a large, mostly well-maintained module: recent v29x work shows real discipline (PM anchor-priority fix, v296 {error} checks on pm_schedules writes, missed PMs computed client-side only with an explicit no-DB-auto-modify comment — house law 2 honored, and no order-by-par behavior anywhere in the lane). Production data is healthy (64 units, 63 operational/1 retired, clean category rows). However, the lane still carries one real security hole — equipment_categories.icon_path is anon-writable (RLS policy ALL/public/true, verified by SQL) and rendered raw into innerHTML in at least four places, giving unauthenticated persistent XSS that could exfiltrate the device-local Anthropic API key — plus a cluster of the classic house-law-3 dead-catch bugs: parts save/delete, maintenance delete, the legacy board-card fallback, and the public QR issue reporter all show success toasts even when the supabase call returned {error}, so failures silently diverge UI from DB. Edit forms also silently drop cleared fields, so blanking a value never persists. Health: fair — core flows work today, but the false-success paths mean failures would be invisible when they do happen.


- 🟠 **HIGH** — Stored XSS via anon-writable equipment_categories.icon_path rendered raw into innerHTML · `/home/user/nexus/js/equipment.js`
  
  loadCategoriesFromDB() (lines 138-165) copies equipment_categories.icon_path verbatim into ICON_PATHS, and that string is interpolated unescaped inside innerHTML at lines 193, 1111, 1595 and in catIcon() (13994-13996, used by every list row and the detail header). The only sanitization is a client-side regex in the category editor (lines 324-327) that blocks <script and on*= — trivially bypassed by writing the row directly with the public anon key (e.g. icon_path = '</svg><img src=x onerror=...>'). RLS on equipment_categories is a permissive ALL/public/true policy (verified via pg_policies), so an unauthenticated attacker gets persistent script execution in every user's browser. Marginal impact beyond the estate's accepted anon-writable-DB baseline: exfiltration of the device-local Anthropic API key (localStorage 'nexus_api_key', app.js getApiKey) and capture of admin PIN entry.
  
  _Evidence:_ equipment.js:193 `<svg ...>${ICON_PATHS[c.key] || ICON_PATHS.other}</svg>`; equipment.js:157 `if (c.icon_path) newIcons[c.key] = c.icon_path;`; SQL: pg_policies row {tablename: equipment_categories, policyname: equipment_categories_write, roles: {public}, cmd: ALL, qual: true, with_check: true}. Current DB rows are clean Lucide paths (verified).
  
  _Fix:_ Sanitize icon_path at render time, not just at edit time: parse with DOMParser and allow only path/circle/line/rect/polyline/polygon elements with a d/coordinate attribute allowlist, or store only a preset-icon key and look paths up client-side. Longer term, tighten the equipment_categories write policy.

- 🟠 **HIGH** — False 'Saved/Deleted' success on parts and service CRUD — {error} law violations (dead catches) · `/home/user/nexus/js/equipment.js`
  
  Four mutation paths await NX.sb calls without destructuring {error} inside a try/catch that assumes a throw (house law 3), then show an unconditional success toast and close the modal: part save (lines 6664-6676: update/insert then 'Saved ✓', closePart(), openDetail()); deletePart (6810-6817: delete then 'Deleted ✓'); deleteMaintenance (6543-6553: delete then 'Deleted ✓' — the record reappears when openDetail refetches); _legacyCommitIssueAsBoardCard (5027-5047: kanban_cards insert then 'Card created on Board'). Any RLS, constraint, missing-column, or proxy failure resolves with {error}, the catch never fires, and the user walks away believing the write happened.
  
  _Evidence:_ equipment.js:6666-6670 `await NX.sb.from('equipment_parts').update(data).eq('id', part.id); ... NX.toast('Saved ✓', 'success');` — no error check; same pattern at 6813, 6546, 6832-6842 vs the correct pattern used 30 lines away at 6698-6701 (`if (error) throw error`).
  
  _Fix:_ Destructure `const { error } = await ...` and throw/toast on error in all four paths — the fix pattern already exists in the same file (e.g. v296 comments at lines 2519-2526 and 2593).

- 🟡 **MEDIUM** — Public QR issue report can show 'Report Sent' when nothing was saved · `/home/user/nexus/js/equipment.js`
  
  publicReportIssue (lines 10838-10905, the no-auth fallback used by equipment-public-pm.js) shows the 'Report Sent — the team has been notified' success screen whenever NX.work.create resolves — but W.create (js/domain.js:1122-1165) internally catches card-insert failures and returns {card:null, ticket:null} without throwing, and the daily_logs insert at 10887 is never error-checked. So on a failed write (offline phone in a walk-in, RLS, schema drift) the reporter is told the team was notified while no card, ticket, or log row exists. Additionally, if the qr_code lookup at 10875 fails, the submit handler silently returns (10876) — tapping Submit does visibly nothing.
  
  _Evidence:_ equipment.js:10879-10899 — success HTML rendered directly after `await NX.work.create(...)`; domain.js:1160-1163 `catch (e) { console.warn('[NX.work.create] card insert failed:...') }` — swallowed, not rethrown; equipment.js:10876 `if (!eq) return;`.
  
  _Fix:_ Have publicReportIssue check W.create's return (require out.card || out.ticket) before showing success, and surface the qr-lookup failure with an alert/toast.

- 🟡 **MEDIUM** — Edit forms silently drop cleared fields — blanking a value never persists · `/home/user/nexus/js/equipment.js`
  
  The equipment edit form (line 5945 `if (v !== '' && v != null) data[k] = v;`), part form (6652-6657), and service form (6461-6467) all exclude empty values from the update payload. Consequence: clearing model, serial, notes, cost, dates, etc. shows a success toast but keeps the old DB value, which reappears on reload. Proof of intent mismatch: the manufacturer-clearing branch at 5986-5989 (`else if ('manufacturer' in data && !data.manufacturer)`) is provably dead code — an emptied field never makes it into data, so manufacturer/manufacturer_id can never be nulled from the form. The service form also can never un-check warranty_claim (unchecked checkboxes are absent from FormData, so `false` is never written).
  
  _Evidence:_ equipment.js:5944-5947, 5986-5989 (unreachable branch), 6461-6467 (`if (k === 'warranty_claim') data[k] = true;` — no false path), 6652-6657.
  
  _Fix:_ For edits (id present), include known-clearable fields as explicit nulls when blank (mirroring the existing status_note handling at 5952-5958) and always write warranty_claim as fd.has('warranty_claim').

- 🟡 **MEDIUM** — Hard delete ignores all child-table cleanup errors, then deletes the parent — silent orphans · `/home/user/nexus/js/equipment.js`
  
  deleteEquipment (6217-6254) confirms with 'Parts, service history, and attachments will all be erased', then loops 10 owned tables with `try { await NX.sb.from(t).delete().eq('equipment_id', id); } catch (_) {}` (6241-6243). Because supabase-js resolves with {error}, the catch is dead AND the {error} result is discarded — so every failure mode (not just the intended missing-table case) is ignored, including RLS or transient failures on tables full of rows. The parent equipment row is then deleted, permanently stranding maintenance/parts/attachments rows the user was told were erased, with no FK constraints to stop it (per the code's own comment at 6230).
  
  _Evidence:_ equipment.js:6241-6243 loop over ['equipment_maintenance','equipment_parts','equipment_attachments','equipment_manuals','equipment_custom_fields','equipment_compliance','equipment_events','equipment_issues','pm_schedules','pm_logs'].
  
  _Fix:_ Check each result's error and only ignore the relation-does-not-exist case (the regex used at 145 and 2170 already exists); abort the parent delete and tell the user on any other child-delete failure.

- 🟡 **MEDIUM** — Fire-and-forget writes silently diverge UI state from DB (vendors, PM sync, audit trail) · `/home/user/nexus/js/equipment.js`
  
  Several state-bearing writes never check {error}: saveVendors (6973-6988) mutates the in-memory vendors array and re-renders BEFORE/regardless of whether the equipment_parts update succeeded, so a removed/preferred vendor reverts on next load with no warning; the equipment-row sync after PM scheduling (2571, sets next_pm_date/service_vendor_id — the very field computePmCountdown treats as authoritative per the v290 comment at 455-460); the next_pm_due equipment update in the service form (6483); autoCompletePmSchedule's pm_schedules completion update (2819-2826) which then logs success unconditionally at 2828; and logEquipmentEvent (3161-3168), meaning the equipment audit timeline can silently lose events while its catch-based warn at 3170 never fires for supabase errors.
  
  _Evidence:_ equipment.js:6975 `await NX.sb.from('equipment_parts').update({ vendors }).eq('id', partId);` — unchecked, callers already re-rendered from memory (6936-6949); 2571; 6483; 2819-2828; 3161.
  
  _Fix:_ Destructure and at least console.warn + toast on error in saveVendors (it drives interactive state); for the best-effort writes, log the returned error object instead of relying on dead catches so failures are at least observable.

- 🔵 **LOW** — Detail view swallows sub-query errors — failed history loads render as 'no history' · `/home/user/nexus/js/equipment.js`
  
  openDetail's parallel loads (4638-4676) coerce every result with `res.data || []` and never inspect maintRes.error, attachRes.error, customRes.error, or pendingRes.error. A transient or schema error on equipment_maintenance renders an empty Timeline/service history with no indication anything failed — indistinguishable from a unit that genuinely has no history, which can mislead service decisions. openFullEditor (10916-10921) has the same pattern.
  
  _Evidence:_ equipment.js:4672-4676 `const maintenance = maintRes.data || [];` etc., no error branch; contrast with loadEquipmentEvents (3197-3201) which checks and warns.
  
  _Fix:_ When any sub-result carries an error, show a small 'history unavailable — retry' state in that tab instead of an empty list.

- 🔵 **LOW** — AI bulk-create defaults category to invalid key 'equipment' · `/home/user/nexus/js/equipment.js`
  
  createEquipmentFromAI sets `clean.category = clean.category || 'equipment'` (line 8833), but 'equipment' is not a valid category key (valid keys are refrigeration/cooking/ice/hvac/dish/bev/smallware/furniture/other plus DB rows). Affected units render via the 'other' icon fallback but form a phantom category bucket in the grouped list and category filters. Currently latent: SQL confirms zero rows with this category in production.
  
  _Evidence:_ equipment.js:8832-8833; CATEGORIES definition at 49-63; DB check: select category, count(*) from equipment group by 1 → only valid keys present.
  
  _Fix:_ Default to 'other' instead of 'equipment'.

- ⚪ **INFO** — House-law compliance is otherwise strong in this lane (positive note) · `/home/user/nexus/js/equipment.js`
  
  Worth the owner knowing: no order-by-par behavior exists anywhere in the lane (the only par reference, line 9388, is display-only sticker coloring); overdue scheduled PMs are flagged with a virtual client-side `_isMissed` and explicitly NOT auto-written to the DB (2182-2198, honoring the no-bulk-modify law); and the v296/v290 era fixes (2519-2526, 2590-2593, 455-478) show the {error} law and Alfredo's PM-anchor correction being applied correctly. The remaining defects above are older code paths that missed those sweeps.
  
  _Evidence:_ equipment.js:2194-2196 `row._isMissed = true; // virtual flag; doesn't write to DB`; 2519-2521 v296 comment: 'check the error (supabase-js resolves with {error}, never throws)'.
  
  _Fix:_ Use the v296 pattern as the template when fixing the dead-catch cluster in findings 2, 5, and 6.


### `equipment-pm` — equipment.js PM/audit (second half)  · health: 🟡 fair


Audited js/equipment.js lines 11000-21527: the full 6-tab editor, attachments, PM-log review (approve/reject/spam), issue tracker lifecycle, bulk PM scheduling, fleet analytics/warranty date math, parts replacement, and the QR entry points (openDetailByQr, completeWorkOrder). Operationally this lane is healthy right now — 42 units carry a next_pm_date with 0 overdue, 0 pending pm_logs, and 0 open issues — and no house-law-1 (order-by-par) or law-2 (silent auto-close/bulk-modify) violations exist here: bulk PM and issue-status flips are all user-confirmed. The two serious code problems are (1) unescaped user-controllable URLs rendered into href/src in the editor and attachment list — a stored-XSS path given the world-writable anon-key database — and (2) a cluster of law-3 violations where supabase writes (attachments, custom fields, photo removal) are never checked for {error} yet toast success, so failures save nothing while claiming they did. Medium items: the issue-tracker contractor email still reads the legacy node-id link (18 rows) and ignores the new vendors link (35 rows), quick-status Undo strands the auto-opened ticket (which then suppresses future auto-tickets), approvePmLog can approve a log without landing its timeline row, and the recommended per-equipment part-replacement flow never clears the catalog's 'Replace overdue' badge. Nothing in this lane appears in the Clippy audit report.


- 🟠 **HIGH** — Stored XSS: attachment/photo/manual URLs interpolated into href/src without escaping · `js/equipment.js`
  
  renderAttachment() builds `const url = a.file_url || a.external_url` and emits `<a href="${url}">` and `<img src="${url}">` with no escAttr and no scheme check (lines 11506-11522). The full editor does the same for eq.photo_url (11065), eq.data_plate_url (11079), eq.manual_source_url (11177) and eq.manual_url (11184). equipment_attachments.external_url is user-supplied free text (prompt/composer, line 11553-11576) and the whole DB is writable with the shared public anon key, so an unauthenticated writer can plant a URL containing a double-quote to break out of the attribute (onmouseover=..., etc.) or a javascript: link; it executes in the admin's session when they open the Attachments/Links tab.
  
  _Evidence:_ 11522: `${url ? `<a href="${url}" target="_blank" class="eq-attach-link">↗ Open</a>` : ''}`; 11520: `<img src="${url}" class="eq-attach-preview">`; 11065: `<img src="${eq.photo_url}" class="eq-photo-main">`; 11177: `<a href="${eq.manual_source_url}" target="_blank"...>`. Confirmed equipment_attachments has free-text external_url/file_url columns in live schema.
  
  _Fix:_ Run every URL through escAttr() at render time and reject non-http(s) schemes before emitting href/src (a small safeUrl() helper used at all 6 sites). Same pattern likely exists elsewhere in the file — worth a one-pass sweep for `href="${` and `src="${`.

- 🟠 **HIGH** — House-law 3 class: unchecked supabase results with unconditional success toasts (attachments, custom fields, photos) · `js/equipment.js`
  
  Multiple write paths in the full editor never destructure {error} and then toast success regardless: link insert (11560-11565 and fallback 11576-11581), note insert (11601-11607, 11617-11623), attachment insert after storage upload (11654-11662 — file lands in storage, DB row insert error ignored, user sees 'Uploaded ✓'), custom-field batch save (11481: `await Promise.all(customOps)` — supabase-js RESOLVES with {error}, so Promise.all never rejects and per-op errors are simply discarded before 'All changes saved ✓' at 11483), removePhoto (11994) and deleteCustomField (12001). If RLS/network/constraint errors occur, data is silently not saved while the UI confirms it was.
  
  _Evidence:_ 11481: `await Promise.all(customOps);` then 11483: `NX.toast('All changes saved ✓', 'success')` with no result inspection; 11654-11661: `await NX.sb.from('equipment_attachments').insert({...}); NX.toast('Uploaded ✓', ...)`.
  
  _Fix:_ Destructure `{ error }` on every call, throw/toast on failure; for the customOps batch, inspect each settled result for .error before declaring success. This is the exact recurring bug class called out as law 3.

- 🟡 **MEDIUM** — Issue-tracker 'Email contractor' still reads legacy service_contractor_node_id, ignoring the vendors consolidation · `js/equipment.js`
  
  emailContractorAboutIssue() (14840) looks up the contractor exclusively via equipment.service_contractor_node_id against the nodes table (14845-14855) with no fallback to service_vendor_id/repair_vendor_id or the vendors table — yet the full editor's contractor pickers were migrated to vendors and write service_vendor_id (11237-11243, 11327, 11337). Live DB: 35 equipment rows have service_vendor_id set but only 18 have the legacy node id. For vendor-linked-only units the issue email opens a blank compose with 'No preferred contractor set' even though a contractor with email is linked.
  
  _Evidence:_ 14845: `if (equipment.service_contractor_node_id) { ... NX.sb.from('nodes')...`; editor comment 11237: 'the equipment contractor pickers now pull from the vendors table (single source of truth)'; SQL: svc_vendor_set=35 vs svc_node_set=18.
  
  _Fix:_ In emailContractorAboutIssue, resolve contractor via service_vendor_id (vendors table, which carries email) first, falling back to the legacy node id.

- 🟡 **MEDIUM** — Quick-status Undo reverts the status but not the auto-opened ticket · `js/equipment.js`
  
  openQuickStatusMenuForRow shows the 6-second undo banner immediately (11912), then on successful save calls autoTicketForStatus (11936), which inserts an equipment_issues row and mirrors a board card via NX.domain.recordEquipmentIssue (14310-14322). The undo handler (11801-11833) only restores equipment.status and logs a status_change event — the ticket and board card survive a mis-tap. Worse, the dedup guard (14305-14306: skip if any open issue exists) means the orphan ticket then suppresses the next genuine auto-ticket for that unit until someone notices and closes it.
  
  _Evidence:_ 11936: `autoTicketForStatus(eq, newStatus, priorStatus);` vs undo handler 11808-11814 which updates only `{ status: priorStatus }`.
  
  _Fix:_ On undo, also find-and-close (or delete, with the domain card hook) the issue autoTicketForStatus just created — stash the new issue id when it's opened so undo can target exactly that row.

- 🟡 **MEDIUM** — approvePmLog is non-atomic and ignores the equipment date-push error · `js/equipment.js`
  
  Approval flips pm_logs.review_status to 'approved' first (14084-14089), then fetches and inserts the equipment_maintenance row (14092-14110). If the fetch/insert fails, the catch shows 'Failed to approve' but the log is already approved — it disappears from the pending queue with no timeline row, i.e. the approved service silently never lands in history. Step 4 (14135-14137) pushes last_pm_date/next_pm_date/pm_interval_days onto equipment without checking {error} (supabase-js resolves with {error}, so the surrounding try/catch never sees it) — a failed push leaves the PM schedule stale while the log reads approved.
  
  _Evidence:_ 14084: review_status update happens before 14100 insert; 14136: `await NX.sb.from('equipment').update(eqUpdate).eq('id', log.equipment_id);` with the result discarded.
  
  _Fix:_ Reorder: insert the maintenance row first, then flip review_status (or revert review_status in the catch). Destructure and check {error} on the equipment update at 14136.

- 🟡 **MEDIUM** — Per-equipment part replacement never updates equipment_parts.last_replaced_at, so catalog 'Replace overdue' badges stay stale · `js/equipment.js`
  
  markPartReplacedOnEquipment() (20486, the v18.21 'right way' flow used from Equipment > Parts) only inserts an equipment_maintenance row (20617) — it does not touch equipment_parts.last_replaced_at. But the parts catalog computes next-due exclusively from equipment_parts.last_replaced_at + replacement_interval_months (loadPartsList 19818-19828) and renders 'Replace overdue (Nd)' badges from it (20036-20044). Replacing a part through the recommended per-equipment sheet leaves the catalog claiming the part is still overdue indefinitely; only the legacy global markPartReplaced (20404) updates the field.
  
  _Evidence:_ 20606-20617 insert into equipment_maintenance only; 19818: `if (p.last_replaced_at && p.replacement_interval_months) { ... p._nextDueDaysLeft = ... }`.
  
  _Fix:_ When the replaced part's own equipment_id matches the unit (or when it is the primary), also update equipment_parts.last_replaced_at (and replacement_history) in markPartReplacedOnEquipment; or derive catalog next-due from the max part_replacement maintenance event.

- 🔵 **LOW** — Column-missing fallbacks match the wrong error format (Postgres 42703) and never fire against PostgREST PGRST204 · `js/equipment.js`
  
  The full-editor save's strip-and-retry loop (11453: /column "?([a-z_]+)"?.*does not exist/) and the part-replacement fallbacks (20428, 20620, 20625; also 16574, 17552, 18706) test for the Postgres-style message 'column X does not exist'. For REST table writes with an unknown payload column, PostgREST returns PGRST204 'Could not find the 'X' column of 'Y' in the schema cache', which none of these regexes match — the advertised graceful degradation ('Saved without X — run the SQL migration') is dead code and the whole save would hard-fail. The codebase knows both formats: isMissingColumn() at 17217-17222 checks `find.*'name' column` as a second pattern, but only that one site does. Currently latent — I verified all referenced columns (service_vendor_id, repair_vendor_id, repair_contractor_*, replacement_history, part_id, invoice_attachment_id) exist in the live schema.
  
  _Evidence:_ 11453 vs 17220-17221 (`new RegExp(`find.*['"\`]${n}['"\`] column`, 'i')` — the only site handling the real PostgREST message).
  
  _Fix:_ Extract isMissingColumn() (which handles both formats) to a shared helper and use it at every fallback site, or delete the dead fallbacks since the migrations have run.

- 🔵 **LOW** — Timezone off-by-one in warranty countdown and bulk-PM date presets (UTC vs US Central) · `js/equipment.js`
  
  computeFleetSnapshot parses date-only warranty_until as UTC midnight (15945: new Date(u.warranty_until)) but compares against local midnight (15941: today.setHours(0,0,0,0)); in US Central the -5/-6h offset makes Math.floor shift every daysLeft down by one — a warranty expiring today renders 'Expired 1d ago', and bucket membership (expired/urgent/upcoming) shifts a day early in the Warranty tab and weekly digest. Same UTC-date pattern in openBulkPmSchedule: the default and preset dates use toISOString().slice(0,10) (15142, 15175-15176), so after ~6-7pm Central the '30/60/90 days' chips fill a date one calendar day later than intended.
  
  _Evidence:_ 15945-15946: `const until = new Date(u.warranty_until); const daysLeft = Math.floor((until - today) / 86400000);` with `today` at local midnight.
  
  _Fix:_ Parse date-only strings as local dates (split into Y/M/D and use new Date(y, m-1, d)) or do the whole computation in UTC; for presets, build the yyyy-mm-dd string from local date parts.

- 🔵 **LOW** — autoTicketForStatus computes priority but never persists it — 'down' tickets stored as normal · `js/equipment.js`
  
  autoTicketForStatus derives priority='high' for down/broken (14307-14308) but the equipment_issues insert (14310-14318) omits the priority field, so the row takes the DB default 'normal' (confirmed: column default is 'normal'::text). Only the best-effort board hook receives the high priority, so the issue tracker and any priority-based queries under-rank down equipment.
  
  _Evidence:_ 14310-14318 insert lacks `priority`; information_schema shows equipment_issues.priority default `'normal'::text`.
  
  _Fix:_ Add `priority` (and arguably `severity`) to the insert payload.

- 🔵 **LOW** — markPmSpam promises 'submitter flagged' but flags nothing · `js/equipment.js`
  
  The confirm text says 'It will be hidden and the submitter flagged' (14186), but the function only sets review_status='spam' (14188-14192). pm_logs has a flagged_spam column that is never written, and there is no blocklist of contractor_phone/IP — a spammer hitting the public QR form can keep submitting with no consequence, contrary to what the admin is told.
  
  _Evidence:_ 14188-14192 update = { review_status:'spam', reviewed_at, reviewed_by } only; pm_logs schema includes flagged_spam, submitted_ip, submitted_user_agent (unused here).
  
  _Fix:_ Either set flagged_spam and use submitted_ip/phone for rate-limiting in the public form's edge path, or soften the confirm text to match reality.

- ⚪ **INFO** — Issue emails and fleet digest bypass the NX.composeEmail engine (raw mailto:) · `js/equipment.js`
  
  emailContractorAboutIssue builds its own mailto: URL with a private token-template system (14883-14941) and emailDigest does the same (16377-16385), while CLAUDE.md's architecture note says the one email engine is NX.composeEmail / NX.vendorEmail (which the dispatch sheet at 12526 correctly uses). Two parallel template/token systems for contractor email will drift.
  
  _Evidence:_ 14928: `const url = \`mailto:${enc(toRecipients)}?${params.join('&')}\`; ... window.location.href = url;` vs 12526's `NX.vendorEmail(vendor, ctx)`.
  
  _Fix:_ Route both through NX.composeEmail/NX.vendorEmail when available, keeping mailto only as the no-engine fallback (mirroring 12526-12527).


### `equipment-satellites` — Equipment satellite modules  · health: 🟡 fair


The equipment satellite lane is thoughtfully engineered — the public scan page (equipment-public-scan.js) correctly applies the {error} law (v336 comments), and the PM logger's pool-only vendor picker genuinely enforces Alfredo's no-minting rule. But the single most important public flow is silently broken: the pm-attachments storage bucket has NO INSERT policy, so every contractor photo and PDF invoice uploaded through the no-login PM logger fails RLS and is swallowed by a catch — 16 pm_logs in the DB, zero with photos, zero with PDFs, zero objects in the bucket. The anonymous perimeter is very wide by design: any QR scanner can flip equipment status (including marking a down unit operational), file tickets/board cards, and self-approve PM logs that advance PM clocks; RLS confirms anon-ALL on equipment, tickets, kanban_cards, and anon UPDATE/DELETE on pm_logs and most storage buckets. Smaller defects: equipment-ai.js has three unchecked supabase updates (dead-catch law), equipment-context-menu runs a silent fuzzy bulk-backfill every 3 minutes in every client, and the public form ships full vendor rows (account numbers, rates) to anonymous browsers.


- 🔴 **CRITICAL** — Contractor photo/PDF invoice uploads on public PM logger silently fail — pm-attachments bucket has no INSERT policy · `js/equipment-public-pm.js`
  
  uploadFiles() (lines 1274-1292) uploads to the 'pm-attachments' bucket, but pg_policies on storage.objects contains NO INSERT policy for that bucket (policies exist for equipment-attachments, equipment-photos, equipment-manuals, etc. — not pm-attachments). Every anon upload is RLS-denied; the error is thrown into a per-file catch that only console.warns and returns an empty URL list, so the PM log saves with photo_urls=[] and pdf_url=null and the contractor sees a full success screen. The invoice/photo paper trail — a headline feature of the logger — has never worked.
  
  _Evidence:_ pg_policies (storage.objects): no policy with bucket_id='pm-attachments'. storage.objects count for pm-attachments: 0 rows. pm_logs: total=16, with_photos=0, with_pdf=0, with_sig=16 (signatures work because they're stored as data-URLs in the table, not storage). Code: js/equipment-public-pm.js:1281-1289 `.from('pm-attachments').upload(...)` inside `catch (e) { console.warn('[pm-logger] file upload failed:', e); }`.
  
  _Fix:_ Add an INSERT (and SELECT is already public via bucket.public=true) storage policy for bucket_id='pm-attachments' for anon, or point uploadFiles at equipment-attachments which already has a public eq_attach_upload policy. Then surface upload failure to the submitter instead of swallowing it.

- 🟠 **HIGH** — Anonymous QR visitor can flip any equipment's status — including marking a DOWN unit operational — with no identity or rate limit · `js/equipment-public-scan.js`
  
  The no-PIN scan page's 'Update status' sheet lets anyone who loads ?equip=<qr> set status to operational/needs_service/down (lines 2052-2064 options, 2175-2177 update). performed_by is recorded only as 'QR scan' — no name captured, unlike the Report Issue flow which requires a name. RLS policy equipment_anon_all (ALL/public/qual=true) confirms the write lands. A prankster, a bot crawling published QR-sticker URLs, or a contractor covering their tracks can mark a genuinely down walk-in 'operational', suppressing the visual alarm staff rely on. The status_change maintenance log entry gives an audit trail but no actor.
  
  _Evidence:_ js/equipment-public-scan.js:2175-2189: `await sb.from('equipment').update({ status: selectedTarget }).eq('id', eq.id)` then equipment_maintenance insert with `performed_by: 'QR scan'`. pg_policies: equipment_anon_all cmd=ALL roles={public} qual=true with_check=true.
  
  _Fix:_ Require a name on the status sheet (the Report Issue modal already does and remembers it in localStorage), record it in performed_by, and consider restricting the operational (all-clear) direction to logged-in staff or gating it behind an equipment_issues 'Complete Work Order' path that names the actor.

- 🟠 **HIGH** — Anon key can DELETE all equipment photos/manuals/attachments and UPDATE/soft-delete the entire pm_logs history · `js/equipment-public-pm.js` · _known_
  
  Storage policies grant public DELETE on equipment-attachments (eq_attach_delete), equipment-manuals (equipment_manuals_delete), equipment-photos (equipment_photos_delete), education-content, inventory-photos, and nexus-files — anyone holding the published anon key (it is in the page source, equipment-public-scan.js:62) can wipe every uploaded manual and photo. pm_logs additionally has pm_logs_anon_update (UPDATE/anon/true/true), so an anonymous client can rewrite review_status, costs, or set is_deleted on every historical PM log — the public surface only needed INSERT+SELECT. This extends the known shared-anon-key model from 'world-readable/writable rows' into irreversible binary-asset deletion.
  
  _Evidence:_ pg_policies storage.objects: eq_attach_delete DELETE {public} qual=(bucket_id='equipment-attachments'); equipment_manuals_delete, equipment_photos_delete, edu_content_anon_delete, inventory_photos_delete, 'delete' (nexus-files) — all public, no auth.role() check. pg_policies public.pm_logs: pm_logs_anon_update UPDATE {anon} qual=true with_check=true. Buckets equipment-attachments (100MB limit, no MIME restriction) and pm-attachments are public=true.
  
  _Fix:_ Tighten DELETE on storage buckets to authenticated (staff sessions run the same anon key, so this needs the signed-write-lane approach already proposed in docs/CLIPPY-SOUL-RLS-PROPOSAL.md); drop pm_logs_anon_update or replace with a WITH CHECK that forbids changing review_status/is_deleted. Fits the already-pending permissive-policy cleanup decision.

- 🟡 **MEDIUM** — Public no-login form downloads the full vendors table — account numbers, rates, notes — to anonymous browsers · `js/equipment-public-pm.js`
  
  The pool-only company picker fetches `from('vendors').select('*')` (line 368) on the public PM form. The UI uses only id/company/phone, but the wire payload delivered to any anonymous scanner includes account_number, hourly_rate, trip_charge, notes, dispatch_template, all emails/phones, and addresses for every vendor — visible in devtools with zero effort. The scan page separately fetches single vendor rows with select('*') (equipment-public-scan.js:1688). The DB is anon-readable regardless, but this surface hands the data out unprompted.
  
  _Evidence:_ js/equipment-public-pm.js:368-371: `.from('vendors').select('*').order('company')` then `.map(v => ({ id: v.id, name: v.company || v.name, phone: v.phone || '' }))`. vendors columns include account_number, hourly_rate, trip_charge, notes, dispatch_template, emails, phones (information_schema). pg_policies: vendors_select SELECT {public} qual=true.
  
  _Fix:_ Select only `id, company, name, phone, active` for the picker (and the minimal columns the email fallback needs on the scan page). Real fix is a vendors_public view or column-level grants, but the one-line select change removes the casual exposure.

- 🟡 **MEDIUM** — equipment-context-menu runs a silent fuzzy bulk-backfill of equipment_maintenance every 3 minutes in every open client · `js/equipment-context-menu.js`
  
  patchPmApprovalToLinkMaintenance (lines 2400-2441) fetches ALL approved pm_logs, then per-log queries equipment_maintenance (N+1, unbounded, no date cutoff) and UPDATEs pm_log_id on rows matched by contractor-name substring + equipment + date. It runs 4s after load and every 180s in every session concurrently, forever — query volume grows linearly with pm_logs history, and the heuristic can mislink when one contractor logs multiple maintenance events for the same unit on the same date (exactly what mass-PM batches produce). It is also a standing example of silent recurring bulk-modification of records — additive metadata, but the pattern brushes against the no-silent-bulk-modify law.
  
  _Evidence:_ js/equipment-context-menu.js:2405-2441: `const { data: approvedLogs } = await NX.sb.from('pm_logs').select(...).eq('review_status','approved')` … `for (const log of approvedLogs) { … .update({ pm_log_id: log.id }) … }` with `setTimeout(runBackfill, 4000); setInterval(runBackfill, 180000);` — no once-flag, no is-null pre-filter on the pm_logs side, no client election.
  
  _Fix:_ Run the backfill once (guarded by a localStorage/DB marker) or move it into the approval path where the pm_log id is known exactly; at minimum add `.limit()` + a created-window filter and stop the 3-minute interval.

- 🟡 **MEDIUM** — equipment-ai.js violates the {error} law three times — updates report success even when the write failed · `js/equipment-ai.js`
  
  Three equipment UPDATEs never destructure or check {error}: line 144 (data-plate merge onto existing equipment), line 310 (manual_url after PDF upload), line 368 (manual_source_url after web fetch). supabase-js resolves with {error}, so the surrounding try/catch is dead for these calls — a failed write still shows '✓ Extracted …' / 'Manual uploaded ✓' and reloads the list, quietly discarding the scan results the user just confirmed. This is the exact recurring bug class the house law names; equipment-public-scan.js fixed its instance in v336 but this file was not swept.
  
  _Evidence:_ js/equipment-ai.js:144 `await NX.sb.from('equipment').update(updates).eq('id', existingId);` followed unconditionally by `NX.toast('✓ Extracted: …','success')`; :310 `await NX.sb.from('equipment').update({ manual_url: publicUrl })…` then 'Manual uploaded ✓'; :368-370 `update({ manual_source_url: … })` then success toast.
  
  _Fix:_ Destructure `const { error } = await …` and surface failure at all three sites (same pattern as public-scan.js:2478's v336 fix).

- 🔵 **LOW** — quickPrint is double-patched by two satellites with racing whenReady loops · `js/equipment-badge-choice.js`
  
  equipment-cleanup.js (silenceZebraToastSpam, lines 174-216) wraps NX.modules.equipment.quickPrint; equipment-badge-choice.js (lines 35-49) then replaces it with a choice popup, capturing `originalZebraPath = EQ.printZebraSingle || EQ.quickPrint` — which wrapper it captures depends on whose 80ms vs 100ms poll fires first after the sequential lazy-load chain (app.js:1928-1932 loads cleanup before badge-choice). Because equipment.js exports printZebraSingle (equipment.js:21336) the common path resolves correctly, but cleanup's wrapper also auto-fires a SECOND HTML print 2 seconds after any suppressed Zebra error, which can double-print when the user already chose Paper. Fragile layering, no user-visible breakage reported.
  
  _Evidence:_ js/equipment-cleanup.js:178-213 (wrapper + `setTimeout(() => { … NX.ctxMenu.printSingleLabel(equipId); }, 2000)`); js/equipment-badge-choice.js:43-48 (`originalZebraPath = EQ.printZebraSingle || EQ.quickPrint; EQ.quickPrint = … showBadgeChoicePopup`); js/app.js:1928-1932 load chain.
  
  _Fix:_ Retire cleanup's silenceZebraToastSpam now that badge-choice owns quickPrint (its Zebra path already falls back), or have badge-choice explicitly capture printZebraSingle only.

- 🔵 **LOW** — Public scan health strip's INSP/CLEAN bars can never render — columns not fetched · `js/equipment-public-pm.js`
  
  pubHealthStrip (lines 203-223) renders bars for eq.next_pm_date, eq.next_inspection_date and eq.next_deep_clean_date from the cached scan record (window._NX_PUBLIC_SCAN_EQ), but equipment-public-scan.js's FULL/NO_REPAIR/MINIMAL selects (lines 1519-1521) never request next_inspection_date or next_deep_clean_date, so those two bars are dead code on the public landing — only the PM bar ever shows.
  
  _Evidence:_ js/equipment-public-pm.js:218-220 `add('INSP', eq.next_inspection_date); add('CLEAN', eq.next_deep_clean_date);` vs js/equipment-public-scan.js:1519 FULL column list (ends at repair_vendor_id, no inspection/deep-clean columns).
  
  _Fix:_ Add the two columns to the FULL select (they exist behind the column-missing fallback logic already) or drop the two add() calls.

- 🔵 **LOW** — Public scan writes literal '<i data-lucide=…>' markup into daily_logs entries — renders as raw text in the feed · `js/equipment-public-scan.js`
  
  The ticket/call/email flow inserts daily_logs entries prefixed with `<i data-lucide="phone">` etc. (lines 2631-2637); log.js escapes entries with escHTML (log.js:311), so staff see the HTML tag as literal text at the start of every QR-originated log line. Same class of bug the file itself fixed for push titles ('the old markup appeared literally on lock screens', line 2610 comment) but the daily_logs writer was missed. Note: because log.js escapes, there is NO XSS here — verified.
  
  _Evidence:_ js/equipment-public-scan.js:2632 `const logIcon = `<i data-lucide="${logIconName}"></i>`;` → :2637 inserted into daily_logs.entry; js/log.js:311 `escHTML(entry)`.
  
  _Fix:_ Drop the logIcon prefix (or use a plain-text token like [CALL]/[EMAIL], which the entry already includes via logPrefix).

- ⚪ **INFO** — Anonymous PM submissions self-approve instantly: they advance PM clocks, write maintenance history, and stamp vendor/phone onto equipment · `js/equipment-public-pm.js`
  
  By explicit owner design ('No approval step'), every public submission is inserted with review_status:'approved' (line 817) and immediately runs applyApprovalEffects (lines 890-896, 1437-1487): inserts equipment_maintenance, advances last/next_pm_date via NX.pm.advance (interval-learning included), completes pm_schedules, recomputes health — and lines 906-929 write the picked vendor and the tech's personal phone onto equipment.service_vendor_id/service_contractor_phone when empty. The only spam defense is a honeypot that flags-but-does-not-block. A single bogus scan-and-submit therefore resets a unit's PM schedule and can teach it a wrong interval. Reported for owner awareness, not as a violation — the tradeoff was chosen deliberately and is documented in the file header.
  
  _Evidence:_ js/equipment-public-pm.js:811-819 `flagged_spam: !!honeypot.trim(), review_status: 'approved', reviewed_by: 'Auto (no approval needed)'`; :890 `if (!honeypot.trim()) { … applyApprovalEffects(r) }`; :1479-1486 `NX.pm.advance(log.equipment_id, { … nextServiceDate: log.next_service_date })`; :915-925 service_vendor_id / service_contractor_phone fill-if-empty.
  
  _Fix:_ No change unless Alfredo wants one; cheapest hardening if ever desired is requiring the vendor pick + name match to an existing vendor phone, or routing honeypot-clean-but-first-time contractors through review_status:'pending' (the review UI already exists at NX.pmLogger.reviewPendingLogs).

- ⚪ **INFO** — equipment-brain-sync copies cost and contractor PII into anon-readable nodes, and abuses access_count as a timestamp · `js/equipment-brain-sync.js`
  
  buildNodePayload (lines 82-164) writes purchase_price ('Cost: $…'), contractor names+phones, serials and free-text notes into nodes.notes for category='equipment' rows — nodes has nodes_anon_all (ALL/public/true), so this widens where that data is casually readable (galaxy/search surfaces + any anon client). It also sets `access_count: Date.now()` (line 162) — a millisecond timestamp stored in a counter column, which will make any 'most accessed' ranking nonsense. Duplicate-node risk exists if the equipment_node_id backlink update (line 228) fails after insert. All consistent with the known shared-anon-key model; flagged as fact-worth-knowing, not a new hole.
  
  _Evidence:_ js/equipment-brain-sync.js:102 `lines.push(`Cost: $${eq.purchase_price}`)`; :107-112 contractor name/phone lines; :162 `access_count: Date.now()`; :225-228 insert-then-backlink without transactional guard. pg_policies: nodes_anon_all ALL {public} true/true.
  
  _Fix:_ If nodes scoping ever lands (the pending loadNodes decision), keep equipment nodes in scope; meanwhile consider omitting purchase_price and phone numbers from notes, and store a real timestamp column instead of overloading access_count.


### `email-engine` — Email engine  · health: 🟡 fair


The email engine core is healthy and thoughtfully built: NX.composeEmail / NX.vendorEmail (js/email-composer.js) correctly handle the two-NX trap (app.js:4584 unifies lexical NX and window.NX before the deferred composer loads), gmail-api vs draft send methods are honestly distinguished, and the dlog_sends ledger consumers in daily-log.js auto-stamp only API-confirmed deliveries with a one-tap chip for drafts. However, the ONE-engine law is violated in equipment.js, which maintains a full parallel contractor template-dispatch system that ends in a raw window.location mailto (the exact silent-failure mode nx-email.js was built to fix) while auto-advancing the issue status, and the batch "Email each location" flow sends API-confirmed styled emails but never stamps dlog_sends, so the accumulation window never resets on that path. Separately, ai-writer.js's entire 22-tool write system is orphaned — loaded but never wired to brain-chat — with a fail-open kill switch and several unchecked supabase {error} results should it ever be wired. The email_recipients table is world-writable with the public anon key and the composer auto-fills To from it, making a silent recipient-redirect of daily ops reports possible for anyone holding the anon key (which ships in the public repo).


- 🟠 **HIGH** — Batch 'Email each location' confirmed sends never stamp dlog_sends — accumulation window never resets · `js/daily-log.js` · _known_
  
  The v282 'accumulate until sent' design requires every REAL send to be stamped in dlog_sends so the unsent window resets. The single-send paths do this correctly (daily-log.js:4545 and 5074: `if (p && p.method === 'gmail-api') dlogStampSend(...)`), but the batch flow's sendOne() (4187-4201) performs an API-confirmed delivery via T.styledGmailSend — and even computes the per-location window and folds accumulated card movements into the body (4115-4116) — yet on `res.ok` it only sets '✓ sent' and never calls dlogStampSend. Result: after a successful batch send, the window stays open; the next email for that location re-includes days already delivered, duplicating catch-up content indefinitely for anyone who uses the batch button.
  
  _Evidence:_ daily-log.js:4195-4196 `const res = await T.styledGmailSend(...); if (res && res.ok) { r.status = 'sent'; setState(i, '✓ sent'); return true; }` — no dlogStampSend call anywhere in emailEachLocation, vs. 4545 `if (p && p.method === 'gmail-api') dlogStampSend(scopeKey, dateStr, win, 'gmail-api');`
  
  _Fix:_ In sendOne(), after res.ok, call dlogStampSend(r.key, dateStr, win, 'gmail-api') using the per-location window already computed at 4115. The steward digest flagged the older bulk-drafts version of this gap; the current code evolved into confirmed API sends, making the missing stamp an active correctness bug rather than an accepted limitation.

- 🟠 **HIGH** — equipment.js emailContractorAboutIssue is a parallel template-dispatch engine ending in raw mailto, and auto-advances issue status regardless · `js/equipment.js`
  
  ONE-engine law violation. emailContractorAboutIssue (equipment.js:14840) renders its own contractor.subject_template / body_template with its own {token} substitution (14898-14900, applyTokens blanks unknown tokens instead of leaving them visible like NX.renderVendorTemplate does), builds a raw mailto URL (14928), and fires it via `window.location.href = url` (14941) — bypassing NX.vendorEmail, NX.composeEmail, AND NX.email.openDraft. Raw mailto with a long templated body is the exact documented desktop failure mode ('mailto: silently drops long bodies / email unable to be made') the engine exists to fix. Worse, immediately before opening the draft it auto-transitions the issue to 'contractor_called' (14936-14939), so a silently failed mailto still records that the contractor was contacted. Recipients also never persist to email_recipients, and there is no onSend, so this path is invisible to any send ledger. Reachable from three call sites (14458, 19585, 19606).
  
  _Evidence:_ equipment.js:14936-14941 `if (issue.status === 'reported') { transitionIssueTo(issue.id, 'contractor_called'); } window.location.href = url;` with url built at 14928 `const url = \`mailto:${enc(toRecipients)}?${params.join('&')}\``
  
  _Fix:_ Route through NX.vendorEmail (which already supports dispatch templates, CC/BCC, persisted recipients, and onSend) or at minimum NX.email.openDraft; move the transitionIssueTo call into an onSend callback so status only advances when a draft actually opened.

- 🟡 **MEDIUM** — email_recipients is world-writable with the public anon key and silently steers where reports are delivered · `js/email-composer.js`
  
  pg_policies confirms email_recipients has SELECT/INSERT/UPDATE all granted to public with qual/with_check = true. The anon key ships in the public repo (app.js:13-14). composeEmail treats Supabase as authoritative and auto-fills/replaces To, CC, and BCC from this table on open (email-composer.js:464-478, including `toEl.value = remote.to`), and the batch sender pulls `recip.to` from recallRecipients and delivers API-confirmed emails to it (daily-log.js:4118-4126, 4195). Anyone holding the anon key can UPDATE dlog:suerte / dlog:este / dlog:toti (rows live and updated today per SQL check) to redirect daily operational reports — including the styled gmail-api sends that go out without the user retyping an address — to an attacker mailbox. The To is displayed in the UI, so an alert user could notice, but the batch 'Send all' makes this easy to miss. Analogous to the known clippy_sync bus posture but with a concrete exfiltration consequence.
  
  _Evidence:_ pg_policies: email_recipients_update cmd=UPDATE roles={public} qual=true with_check=true; email-composer.js:476 `if (!opts.to && remote.to) { ... toEl.value = remote.to; state.to = remote.to; }`; daily-log.js:4195 sends to `r.to` sourced from the table
  
  _Fix:_ Fold into the pending soul-RLS decision (docs/CLIPPY-SOUL-RLS-PROPOSAL.md option B pattern): at minimum drop the public UPDATE policy (keep INSERT-only plus app-level upsert via a constrained RPC), and/or have the batch sheet require a confirming glance when a saved To changed since last send.

- 🟡 **MEDIUM** — ai-writer.js: entire 22-tool agentic write system is orphaned — loaded but never invoked · `js/ai-writer.js`
  
  app.js loads ai-writer.js in the serial brain-module chain (app.js:864) before brain-chat.js, but nothing ever calls NX.aiWriter.execute or getToolPromptSection — the only external reference is app.js:2127 opening the AI Activity audit panel. brain-chat.js runs its own read-only GRAPH_TOOLS ReAct loop (brain-chat.js:790-1007) and never merges the write tools into the prompt. So the 1,198-line write/undo/audit system (including create_ticket, change_ticket_status, edit_notes) is dead weight that delays brain init, and the owner-visible 'AI Activity' panel implies a live capability the chat AI does not actually have. Latent defects for if it is ever wired: checkBudget fails OPEN — RPC error or exception returns {allowed:true} (lines 240-248), making the kill switch/rate limit advisory; and unlink_nodes (571-572), log_warranty fallback (600), and schedule_pm fallback (761) await supabase updates without checking the resolved {error}, returning status:'success' on silent failure (the house supabase-{error} gotcha in its unchecked-result form).
  
  _Evidence:_ grep across js/*.js: only consumer of NX.aiWriter is app.js:2127 (openActivityPanel); brain-chat.js contains zero references to aiWriter/getToolPromptSection. ai-writer.js:242 `return {allowed:true, reason:'RPC unavailable, defaulting to allowed'};`; 571-572 `await NX.sb.from('nodes').update({links:aLinks,...})` with no error check.
  
  _Fix:_ Owner decision: either wire getToolPromptSection into brain-chat's system prompt (after fixing the fail-open budget check and unchecked errors) or stop loading ai-writer.js and label the Activity panel as historical. Do not leave a write engine half-present.

- 🟡 **MEDIUM** — executeDispatch and emailDigest bypass the email engine with raw mailto · `js/equipment.js`
  
  Two more ONE-engine law violations. executeDispatch (equipment.js:12945) builds `mailto:${email}?subject=...&body=${encodeURIComponent(message)}` (12960) and clicks an anchor directly for the email dispatch method — the dispatch message can be long, hitting the desktop silent-drop failure mode, and the send is invisible to recipients persistence and any ledger (the dispatch IS logged to dispatch_log separately, but the email itself may never have opened). emailDigest (16377-16384) does `window.location.href = mailto:?subject=...&body=${enc(text)}` with a full fleet digest body — the most likely of all to exceed mailto length limits and silently do nothing. Neither falls back to NX.email.openDraft even though it is loaded on the same page.
  
  _Evidence:_ equipment.js:12960 `url = \`mailto:${email}?subject=${encodeURIComponent('Service request — NEXUS')}&body=${encodeURIComponent(message)}\`;` and 16382-16383 `const url = \`mailto:?subject=${enc(subject)}&body=${enc(text)}\`; window.location.href = url;`
  
  _Fix:_ Route both through NX.email.openDraft (Gmail web composer on desktop) at minimum; emailDigest is a natural fit for NX.composeEmail with a recipientsKey so the digest recipient persists.

- 🔵 **LOW** — sendGmailHtml builds MIME headers without CRLF sanitization — header injection possible via subject · `js/email-composer.js`
  
  sendGmailHtml concatenates raw values into MIME headers (lines 201-207): 'To: '+to, 'Cc: '+cc.join(', '), 'Subject: '+mimeHeader(subject). mimeHeader (100-104) only base64-encodes when non-ASCII characters are present; an all-ASCII subject containing \r\n passes through verbatim, splitting the header and letting the injected text add headers (e.g. Bcc) or start the body early. To/CC/BCC are protected in the composer path by validEmail (rejects whitespace), and the composer's subject <input type=text> normally strips newlines — but T.styledGmailSend is exported as a generic API (line 290) and the batch path feeds it subjects assembled from record data (location labels from log JSON, daily-log.js:4122), so a newline in stored data reaches the header unfiltered.
  
  _Evidence:_ email-composer.js:100-104 `function mimeHeader(s){ return /[^\x20-\x7E]/.test(String(s||'')) ? '=?UTF-8?B?'... : String(s||''); }` — a subject of 'Report\r\nBcc: evil@x.com' is pure ASCII-range-plus-CR/LF... CR (\x0D) and LF (\x0A) ARE outside \x20-\x7E so it would base64-encode; however a subject with only \n... \n is also outside the range. True raw injection therefore requires no encoding bypass — but note the encoded form then contains the CRLF inside the encoded word, which some parsers still normalize; belt-and-braces stripping is still absent.
  
  _Fix:_ Strip [\r\n]+ from to/cc/bcc/subject at the top of sendGmailHtml (one line). Low urgency: mimeHeader's non-ASCII test does catch bare CR/LF by encoding them, so exploitation today requires a parser that decodes encoded-words into raw CRLF — rare, but the defense is nearly free.

- 🔵 **LOW** — Async remote-recipients load can clobber a chip the user adds in the first seconds after opening the composer · `js/email-composer.js`
  
  On open, loadRemote(key) resolves asynchronously and REPLACES state.cc/state.bcc/To with the Supabase values whenever the caller did not pass them (email-composer.js:464-478). The comment claims 'runs on open before user interaction, so it won't clobber in-progress edits' — but that is only true on fast networks. On a slow connection a user can add a CC chip (addFrom persists it at 426) before loadRemote resolves; the resolve then replaces state.cc with the pre-add remote list, rerenders (chip vanishes), and `store(key, snapshot())` at 477 persists the loss locally. The next persistRecipients upserts the clobbered list back to Supabase, making the loss durable and cross-device.
  
  _Evidence:_ email-composer.js:474 `if (!(opts.cc && opts.cc.length) && Array.isArray(remote.cc)) { state.cc = remote.cc.slice(); changed = true; }` with no dirty-flag check; 477 `if (changed) { rerenderChips('cc'); rerenderChips('bcc'); store(key, snapshot()); }`
  
  _Fix:_ Set a `dirty` flag in addFrom/wireRemoves and skip the remote replace (or merge instead of replace) once the user has touched the recipient lists.

- ⚪ **INFO** — vendorEmail mailto fallback calls onSend without the method field · `js/email-composer.js`
  
  In the engine-missing fallback branch (email-composer.js:671-677), ctx.onSend is invoked with {to, cc, subject, body} but no `method` — unlike the composer path (line 510) which always passes method:'draft'|'gmail-api'. Current consumers (vendors.js stampVendorContact; daily-log stamping checks strictly for 'gmail-api') behave correctly with undefined, so this is contract inconsistency rather than a live bug; noted so a future consumer that switches on method !== 'gmail-api' vs method === 'draft' doesn't get bitten. Also noteworthy for the owner: js/composer.js (the prompt() replacement) is clean and correctly two-NX-safe, and the primary single-send flows (cleaning.js:1616, daily-log.js:4548/5068, vendors.js:768/991, equipment-public-scan.js:2721-2731) all correctly route through the ONE engine with engine-absent fallbacks only.
  
  _Evidence:_ email-composer.js:676 `if (typeof ctx.onSend === 'function') { try { ctx.onSend({ to: to, cc: cc, subject: subject, body: body }); } catch (_) {} }` — no method key
  
  _Fix:_ Add method:'draft' to the fallback onSend payload for contract consistency.


### `daily-logs` — Daily + biweekly logs  · health: 🟡 fair


The daily-log v282 "accumulate until sent" machinery is live and in real nightly use — dlog_sends shows Alfredo stamping per-location gmail-api sends for este/suerte/toti almost every night, and the 7-day window math (dlogUnsentWindow), per-scope resets, one-tap chip (2-min timeout), and quiet banner all work as designed. However, the accumulation CONTENT has been hollowed out by the v291/v293 reworks: the only thing that still rides in a catch-up email is an inline "(new)" pill on open cards — skipped-day notes and cards closed on unsent days appear nowhere, while the subject "(+N unsent days)" and the banner ("the next email includes them") still promise full carry; a real 7/17-7/20 gap dropped 1 closed card from the 7/21 email. The styled batch "Email each location" flow now sends confirmed Gmail-API emails but never stamps the ledger (known limitation, though the code has evolved past the digest's description of it). biweekly-log.js has no email flow at all and has NEVER been used — zero log_type='biweekly' rows exist in facility_logs — so the lane brief's "catch-up in both bodies" refers to the daily log's plain+styled bodies only. Overall: working and used daily, but over-promising on what it carries.


- 🟠 **HIGH** — Accumulated email promises "+N unsent days" but carries almost none of it — closed/moved cards and notes from skipped days are silently dropped · `js/daily-log.js`
  
  v282 built a real catch-up section (skipped days' notes + board tickets closed/born/moved since the last send). v291 reworked it to relative-time tags inside Work Orders (dlogAccumulatedMovements), and v293 ("Alfredo: drop the Since-your-last-email block") removed both call sites — leaving ONLY the inline "(new)" pill (line 3994, created_at >= sinceISO) on cards still in open/working lanes. Cards CLOSED on a skipped day appear nowhere: the "Done today" lane is strictly closed-within-today (lines 684-693), and the catch-up lines that would have said "closed 2 days ago" are never generated. Skipped-day location notes are likewise never emailed (the body reads only the current day's log). Yet the subject still appends "(+N unsent days)" (4514-4516, 5042-5044) and the banner says "Carrying N unsent days — the next email includes them" (4492). The presentation change was owner-directed, but the resulting silent loss of closed-work and notes from the email channel almost certainly exceeds what "drop the block" intended.
  
  _Evidence:_ js/daily-log.js:4492 banner text; :3981-3997 only-(new)-pill logic; :684-693 closed-today-only slice; git e4b9fb4 (v293) removed both `const extraLines = await dlogAccumulatedMovements(...)` call sites. Real-world hit: dlog_sends shows a gap — covers_to 2026-07-16 stamped 7/17, next stamp 7/21 covering 07-17..07-20; SQL: in that gap 1 kanban card was closed and 6 created. The closed card was never in any email.
  
  _Fix:_ Ask Alfredo one question: "when days go unsent, should the catch-up email still list tickets closed on those days (and any notes typed)?" If yes, re-wire dlogAccumulatedMovements (it's fully written, just uncalled) into the Work Orders section per the v291 design. If no, remove the "(+N unsent days)" subject tail and soften the banner so the email stops claiming content it doesn't carry.

- 🟡 **MEDIUM** — Batch "Email each location" delivers confirmed Gmail-API sends but never stamps the dlog_sends ledger · `js/daily-log.js` · _known_
  
  emailEachLocation (v209/v295) reads the unsent window per location (line 4115) so "(new)" pills render, and sendOne() gets a confirmed delivery result from T.styledGmailSend (res.ok, line 4195-4196) — but neither sendOne nor "Send all" calls dlogStampSend. So batch-sent scopes keep "accumulating": the next single send over-reports "(+N unsent days)" and re-marks already-emailed cards "(new)". The batch subject also omits the subjTail (line 4122), so a batch catch-up email doesn't even say it covers extra days. The steward digest flagged this flow as "NOT wired" when it was a no-composer N-tabs flow, but the code has since evolved to confirmed-delivery sends where stamping is now trivially correct. The classic fallback emailEachLocationClassic additionally passes no sinceISO at all (line 4238) — no accumulation markers and no sent-chip on devices without the styled machinery.
  
  _Evidence:_ js/daily-log.js:4187-4201 (sendOne: res.ok path sets '✓ sent', no dlogStampSend), :4122 (subject without subjTail), :4238 (buildLocationEmailBody(loc, dateStr, d) — no sinceISO). Contrast :4544-4546 and :5073-5075 where single sends stamp on method==='gmail-api'. dlog_sends contains only single-send gmail-api stamps.
  
  _Fix:_ On res.ok in sendOne, call dlogStampSend(r.key, dateStr, winForThatRow, 'gmail-api') (keep the per-row win from line 4115), and add the subjTail to the batch subject. In the classic fallback, pass the window's fromDate and offer the sent-chip per opened draft, or at least note that it won't reset accumulation.

- 🔵 **LOW** — dlogAccumulatedMovements is dead code (defined, never called) since v293 · `js/daily-log.js`
  
  The full v291 implementation of relative-time movement lines ("closed 2 days ago", "new 1 day ago", "moved 1 day ago") sits at lines 4361-4392 with zero call sites anywhere in the repo (grep confirms only the definition). Its helper dlogRelDays (4350-4359) is likewise only used by the dead function. If revived per finding 1, note two latent issues inside it: kanban_cards is fetched unordered with .limit(500) (arbitrary rows once the table exceeds 500), and dlogRelDays computes relative to the device's actual today rather than the log's dateStr.
  
  _Evidence:_ js/daily-log.js:4361 `async function dlogAccumulatedMovements(scopeKey, win, dateStr)`; repo-wide grep for the name matches only this line plus steward notes. git e4b9fb4 (v293) shows both former call sites deleted.
  
  _Fix:_ Either re-wire it (finding 1) fixing the .limit(500) ordering, or delete it and dlogRelDays so future sessions don't assume the catch-up lines still exist.

- 🔵 **LOW** — Steward digest still documents the removed v282 catch-up section — future sessions will trust wrong behavior · `steward/digest.md`
  
  digest.md line 41 states dlogUnsentWindow/dlogAccumulatedLines "build a 'Catching up — N unsent days' section (each skipped day's notes ... + board tickets closed/born/moved since the marker) appended to BOTH plain and styled email bodies." That was true only for v282 (2026-07-11); v291 replaced it and v293 deleted it. dlogAccumulatedLines no longer exists in the code. Any session loading the digest as "law" will assert to Alfredo that skipped-day notes ride in the email — they don't (finding 1). Also worth noting: v282's original dlogAccumulatedLines queried the `daily_logs` table while daily-log.js persists to `facility_logs`, so even the original catch-up notes block may never have matched real rows.
  
  _Evidence:_ steward/digest.md:41 vs. git 60408aa (v291) and e4b9fb4 (v293); grep: dlogAccumulatedLines absent from js/. v282 diff (a6ea0ed) shows `NX.sb.from('daily_logs')` while saveLog uses `facility_logs` (js/daily-log.js:1175).
  
  _Fix:_ At next steward session, update the v282 digest entry to describe the current v293 state (subject tail + (new) pill only; ledger stamping unchanged) and note the batch-flow evolution.

- 🔵 **LOW** — dlog_sends is world-readable and world-writable with the public anon key — a forged stamp silently suppresses catch-up · `js/daily-log.js`
  
  RLS on dlog_sends is SELECT using(true) and INSERT with check(true). Anyone holding the public anon key (it ships in the PWA) can insert a row with scope='all', covers_to=today, which resets every location's accumulation window — future emails would drop "(+N unsent days)" and "(new)" markers without anyone noticing (accumulation state is invisible except via the small banner). It also exposes by_name and Alfredo's nightly send-time pattern to any reader. This matches the estate-wide shared-anon-key model, so it is consistent-by-design, but unlike most tables a forged row here changes what future emails claim was already reported.
  
  _Evidence:_ pg_policy for public.dlog_sends: dlog_sends_read (r, using true), dlog_sends_write (a, check true). dlogLastSend trusts the newest row blindly (js/daily-log.js:4318-4327).
  
  _Fix:_ Fold into the existing soul-RLS decision (docs/CLIPPY-SOUL-RLS-PROPOSAL.md option B pattern): tighten WITH CHECK to plausible scopes/methods, or at minimum accept and document it. No code change required app-side.

- ⚪ **INFO** — Biweekly review has never been used — zero biweekly rows in facility_logs · `js/biweekly-log.js`
  
  facility_logs contains only log_type='daily' (38 rows, 18 submitted, latest 2026-07-21); not a single 'biweekly' row has ever been saved or submitted. The module itself looks sound (correct {error} destructuring throughout, per-user scoping, constraint-repair fallback mirrored from daily-log, Drive upload path), but its Trends/Wins/Concerns/Focus + 14-day rollup has zero adoption. It also has NO email flow at all — the v282 accumulate/catch-up machinery does not apply to it (the lane's "both bodies" means the daily log's plain + styled bodies). Its rollup metrics would read the `tickets` mirror table (lines 359-419) rather than kanban_cards which the daily log reads; the board's ticket mirror is best-effort ("ticket mirror failed (card kept)", board.js:3410-3424) so the two reports can diverge if the mirror ever silently fails — currently healthy (July: 28 tickets vs 23 cards; last ticket and last card written the same second).
  
  _Evidence:_ SQL: select log_type, count(*) from facility_logs group by log_type → only ('daily', 38). js/biweekly-log.js:357-419 queries tickets; js/daily-log.js:647 queries kanban_cards.
  
  _Fix:_ Surface to Alfredo as a product question, not a bug: retire/hide the biweekly screen, or give it one nudge (e.g. a home-screen reminder every 14 days) if he still wants the cadence. If kept, consider pointing its ticket metrics at kanban_cards for consistency with the daily log.

- ⚪ **INFO** — Daily-log v282 send-detection and safety rails verified working in production · `js/daily-log.js`
  
  Positive verification for the owner: the ledger is being stamped nightly by real use — per-location gmail-api stamps for este/suerte/toti most nights (e.g. 7/21 send correctly recorded covers_from 07-17 → covers_to 07-20 after a 4-day gap, proving window accumulation and per-scope reset math work end-to-end). The draft-path chip errs safe (untapped = keeps accumulating, 2-min auto-dismiss, line 4425), auto-send-to-Drive is deliberately a separate unstamped channel (5416-5434), the device-clock skew warning is warn-only (4437-4481), and the 'all'-resets-houses join (.in [scope,'all'], 4322) is correct. No house-law violations found in this lane: no par-driven behavior, no auto-close/bulk-modify of records, {error} destructuring used consistently, and module wiring avoids the two-NX trap (the batch flow even documents it at 4098-4101).
  
  _Evidence:_ dlog_sends rows: nightly gmail-api stamps by 'Alfredo' for all three houses (7/15, 7/16, 7/17, 7/21, 7/22 UTC); 7/21 row covers_from 2026-07-17 / covers_to 2026-07-20 exactly matching dlogUnsentWindow's expected output after the 7/16 send.
  
  _Fix:_ Nothing to fix; recorded so the owner knows the accumulate ledger itself is trustworthy — the gap is only in what the catch-up email body carries (finding 1).


### `admin-tools` — Admin + record tools  · health: 🟡 fair


The admin-tools lane (admin.js ingest/tools pipeline, record-editor.js, tools.js hub, log.js feed) is feature-rich and defensively coded in places (per-query try/catch in stats, a privacy pre-filter on node inserts, card-insertion confidence gate, esc() throughout record-editor.js), but it has two live stored/DOM XSS holes that fire in the privileged admin session: unescaped ticket ai_troubleshoot/photo_url in log.js (and tickets is anon-writable — confirmed policy tickets_anon_all qual=true), and unescaped AI-derived reminder HTML plus a broken-out inline onclick in admin.js smartReminders. The most serious structural risk is tools.js Push-update, which is designed to distribute a PowerShell-exec token over the world-readable clippy_sync bus, making unauthenticated RCE on Alfredo's home PCs reachable the moment a node publishes its cmd token (dormant now — no clippy_cmd row on the bus). There is also a genuine dead-catch (loadProcessedIds fallback never runs because supabase-js resolves with {error}) and an unattended full-archive bulk reset in rescan mode that brushes against Alfredo's no-silent-bulk-modify rule. record-editor.js is clean. The two-NX trap is mitigated because app.js folds window.NX into its lexical NX at load end.</summary>
</invoke>



- 🔴 **CRITICAL** — Push-update sends arbitrary PowerShell to all nodes via the anon-writable bus, gated only by an anon-READABLE token
  
  tools.js screenPush/withToken/sendCmd builds a PowerShell command and posts it to the clippy_sync 'vis:' lane with a cmd token. The token is fetched with busGet('clippy_cmd') using the public anon key (H() = anon apikey+Bearer), and the code's own note (line 297) admits: 'the daemon auto-publishes the token to the bus, so Push works here with no manual entry... the bus is anon-readable, so that makes command-exec reachable by anyone with the site.' Because clippy_sync is world-readable AND world-writable with the publishable anon key, anyone who loads the site can read clippy_cmd.token and POST their own 'vis:<id>' row carrying that token plus an arbitrary `cmd` string; clippy-worker.py runs cmd jobs from any lane. That is unauthenticated remote code execution on Alfredo's home Windows machines — the same machines where his 3-year-old plays. sendCmd is not limited to the updater string; the caller controls `cmd`. (Live check: no clippy_cmd row is currently on the bus, so the hole is dormant until a node is provisioned with -CmdToken, but the client code is built to make it reachable the moment that happens.)
  
  _Evidence:_ tools.js:304 withToken -> busGet('clippy_cmd').then(c=>{var token=(c&&c.token)||...}); tools.js:313-322 sendCmd busPost({id:'vis:'+...,data:{status:'pending',cmd:cmd,token:token,shell:'powershell'}}); tools.js:297 note: '...that makes command-exec reachable by anyone with the site'. RB=SUPABASE_URL+'/rest/v1/clippy_sync' read/written with ANON key (tools.js:13,28).
  
  _Fix:_ Do not distribute the exec token through the world-readable bus. Move remote-exec authorization server-side (edge function that verifies an admin JWT / rotating secret distinct from the anon key), or require the token to be entered per-session and never published to clippy_sync. At minimum, RLS the clippy_cmd row and any 'vis:'/'txt:' command lanes so anon cannot SELECT the token or INSERT command rows.

- 🟠 **HIGH** — Stored XSS in the Activity feed: ticket ai_troubleshoot and photo_url injected raw into innerHTML (tickets table is anon-writable)
  
  log.js buildTicketCard builds the card with template-string innerHTML. r.title/r.notes/r.location/reported_by are escaped via escHTML, but r.ai_troubleshoot is inserted as raw HTML inside a <details> body, and r.photo_url is interpolated directly into an <img src=...> without escaping. I verified the tickets table RLS is a single policy `tickets_anon_all` (cmd ALL, roles public, qual true, with_check true) — i.e. anyone holding the publishable anon key can INSERT/UPDATE a ticket. An attacker writes a ticket with ai_troubleshoot='<img src=x onerror=...>' (or a javascript:/onerror payload in photo_url); when Alfredo (admin) opens the Log view, the script executes in his privileged session, where it can read the Anthropic API key, the Gmail token in localStorage, and the session PIN.
  
  _Evidence:_ log.js:335 (r.ai_troubleshoot ? '<details ...><div class="feed-ai-body">' + r.ai_troubleshoot + '</div></details>' : '') — no escHTML; log.js:334 (r.photo_url ? '<img src="' + r.photo_url + '" class="feed-photo">' : '') — unescaped attribute. RLS: policy tickets_anon_all cmd=ALL roles={public} qual=true with_check=true.
  
  _Fix:_ escHTML() r.ai_troubleshoot before insertion (or render it as textContent), and validate/escape photo_url (allow only http(s) and escape quotes) before putting it in the src attribute.

- 🟠 **HIGH** — DOM XSS in Smart Reminders: AI-derived text rendered raw into innerHTML and into an inline onclick
  
  admin.js smartReminders() takes Claude output derived from email + chat_history content (attacker-influenceable via inbound email) and renders each item straight into the log via innerHTML with no escaping: item.discussed, item.who, item.date, item.action are concatenated as HTML. Worse, it builds an inline onclick handler that string-interpolates item.discussed into a JS string literal with only a single-quote replace ((item.discussed||'').slice(0,80).replace(/'/g,"\\'")) — a double-quote, backslash, newline, or a literal </button> in the field breaks out of both the JS string and the HTML attribute. An email crafted to make the model emit HTML in 'discussed' yields script execution in the admin session running this tool.
  
  _Evidence:_ admin.js:2623-2630 log(`<div class="reminder-item"><div class="reminder-what">${item.discussed}</div>...<button ... onclick="NX.sb.from('kanban_cards').insert({title:'${(item.discussed||'').slice(0,80).replace(/'/g,"\\'")}',column_name:'todo'})...">+ Add Card</button>...`)
  
  _Fix:_ Escape all model-supplied fields with escapeHtml() before building the HTML, and replace the inline onclick with an addEventListener that passes the title as a JS variable (no string interpolation into markup).

- 🟡 **MEDIUM** — Dead catch in loadProcessedIds — supabase-js resolves with {error}, so the localStorage fallback never runs on a DB error
  
  loadProcessedIds destructures only {data} and never checks error; the surrounding try/catch is meant to fall back to localStorage 'when the table might not exist yet'. But supabase-js RESOLVES with {error} rather than throwing (a documented recurring bug class in this repo). If processed_ids errors (missing table, RLS deny), data is null, the `if(data)` is skipped, no exception is thrown, and the catch — the entire localStorage fallback — is unreachable. The dedup layer silently loses its persisted IDs, causing already-processed emails to be reprocessed (re-spending Claude tokens) instead of loading the cached set. markProcessed() at line 25 has the same dead-catch shape.
  
  _Evidence:_ admin.js:13-19 async function loadProcessedIds(){ try{const{data}=await NX.sb.from('processed_ids').select('external_id'); if(data)data.forEach(...); }catch(e){ /* localStorage fallback */ } }  — error never destructured/checked; catch only fires on a real throw.
  
  _Fix:_ Destructure {data,error} and treat a truthy error as the fallback trigger (if(error){ load from localStorage }), not the catch block.

- 🟡 **MEDIUM** — Rescan mode auto-resets the entire raw_emails archive (processed=false) on an unattended background timer
  
  When the opt-in background processor is running and mode is 'rescan', processNextBatch() — fired every N seconds by setInterval — detects an empty queue and issues a blanket `update({processed:false}).eq('processed',true)` across ALL of raw_emails, then flips mode back to 'process'. This is a bulk modify of every archived record that happens automatically without a confirmation at the moment it fires (the only gate is having selected the rescan chip earlier). It re-queues the entire corpus for Claude reprocessing, which is token-expensive and, given Alfredo's standing rule against silent bulk modification of records, is the kind of unattended bulk mutation he has said should be explicit. reIngestArchived() performs the same blanket reset on a button press (acceptable, explicit).
  
  _Evidence:_ admin.js:666-673 if(mode==='rescan'){ const{count}=... if(!count||count<1){ await NX.sb.from('raw_emails').update({processed:false}).eq('processed',true); ... } }  invoked from setInterval(processNextBatch,ms) (admin.js:853).
  
  _Fix:_ Require an explicit per-run confirmation (or a one-shot, non-repeating trigger) before a full-archive reset, and log the row count that will be re-queued so it is never a silent background mutation.

- 🟡 **MEDIUM** — importBackup upserts nexus_config and nexus_users from an untrusted JSON file via the anon key
  
  importBackup() upserts backup.tables into nexus_config, nexus_users, nodes, tickets, etc. using the shared anon key, gated only by a generic confirm('This will MERGE data...'). nexus_config holds secrets alongside app state (gmail_refresh_token, vapid keys per the privacy-rules comments), and nexus_users holds login PINs/roles. A tampered or attacker-supplied backup file can overwrite the admin's own config/credentials or inject/escalate a user row, and the confirm text understates that config and user accounts are among the tables being overwritten. The view is admin/manager-gated, which limits reach, but a social-engineered 'restore this backup' is a realistic path.
  
  _Evidence:_ admin.js:1401 const order=['nexus_config','nexus_users','nodes','kanban_cards',...]; admin.js:1413 NX.sb.from(table).upsert(batch,{onConflict:pk,ignoreDuplicates:false}); confirm at admin.js:1392 says only 'MERGE data ... Existing data with matching IDs will be overwritten'.
  
  _Fix:_ Exclude nexus_config and nexus_users from client-side import (or require a distinct, explicit opt-in and admin re-auth for those two tables), and validate the backup schema/version before applying.

- 🔵 **LOW** — reIngest/rescan and dedup-merge run destructive node merges/deletes with no undo trail
  
  findDuplicates() merge handler concatenates notes then hard-DELETEs the merged node id (NX.sb.from('nodes').delete().eq('id',mid)), and scanSensitive() Delete button hard-deletes flagged nodes. Both are user-initiated with per-item buttons (acceptable), but there is no soft-delete/versioning, so an over-eager AI dedup suggestion accepted by tapping 'Merge' permanently removes a node and its source_emails/attachments linkage. Given the AI can mis-cluster (the prompt itself warns about different models of the same brand), a mistaken merge is unrecoverable from the UI.
  
  _Evidence:_ admin.js:2699-2700 await NX.sb.from('nodes').update({notes...}).eq('id',d.keep_id); await NX.sb.from('nodes').delete().eq('id',mid); admin.js:2835 await NX.sb.from('nodes').delete().eq('id',f.id).
  
  _Fix:_ Prefer a soft-delete flag (or archive the merged node's payload into the survivor) so an incorrect AI-driven merge can be reversed; keep the hard delete behind an explicit second confirmation.


### `home-planning` — Home, brief, habits, calendar, inbox  · health: 🟡 fair


The home-planning lane (Home, brief, habits, calendar, inbox, orion-presence; kind-notes.js was deliberately removed in v293) is functional but its top-of-screen priority signal is wrong right now: the only overdue-PM unit in the database is an ARCHIVED ice machine, and neither Home's Overdue-PMs KPI, the "Needs attention" hero feed, nor Calendar's PM layer filters archived_at — so Alfredo's morning screen is currently leading with a red alert for a machine he archived on June 1. Second structural issue: the Daily Brief reads only the near-empty R&M views (0 open issues, 0 compliance rows, all PMs "distant") and never looks at tickets/board, so it renders "Nothing urgent. The restaurants are calm." while 40 tickets are open and 23 are chronic. The recurring house-law-3 pattern (ignoring supabase {error}) appears throughout the lane and converts DB/network failures into false "all calm" and false "Daily log not started" states. habits.js is the healthiest file (v336 already fixed its error checks); calendar and inbox are solid apart from latent filter inconsistencies. Health is fair: nothing is data-destructive, but the two most-read surfaces can mislead.


- 🟠 **HIGH** — Archived equipment drives Home's 'Overdue PMs' alert and top Needs-attention item (live now) · `js/home.js`
  
  loadGlance's overdue count (home.js:625-626, `.lt('next_pm_date', nowIso.slice(0,10))`) and collectPriorityItems' OVERDUE query (home.js:1122-1127) have no archived_at filter, while the adjacent down/needs counts explicitly filter `!r.archived_at` (home.js:641-642) — proving archived exclusion is the intent. calendar.js loadEquipmentPMs (238-257) and loadEquipmentWarranties (259-279) have the same gap, so the phantom PM also appears on the month grid.
  
  _Evidence:_ Live SQL: the ONLY equipment with next_pm_date < today is 'Kold Draft Ice Mahine' (SUERTE), next_pm_date 2026-07-16, archived_at 2026-06-01 19:29 — eq_overdue_all=1, eq_overdue_archived=1. So today's red '1 Overdue PMs' KPI, the severity-106 top feed item, and the intro line '1 overdue PM' are all generated by an archived unit.
  
  _Fix:_ Add `.is('archived_at', null)` to the overdue KPI count, the collectPriorityItems overdue query, and calendar's PM/warranty loaders (matching the down/needs pattern already in loadGlance).

- 🟡 **MEDIUM** — Daily Brief is structurally blind to tickets/board — always says 'the restaurants are calm' · `js/brief.js`
  
  brief.js loadAll (57-89) reads only v_issue_summary, v_pm_due_soon, v_compliance_due, and equipment_issues invoices. Its situation line (brief.js:130-132) falls back to 'Nothing urgent. The restaurants are calm.' when those are empty — but on this deployment the live work lives in tickets + kanban_cards (home-rm.js:190-192 admits this). The brief never mentions them, so it reports calm regardless of the real workload.
  
  _Evidence:_ Live SQL: equipment_issues open = 0, equipment_compliance rows = 0, budgets = 0, v_pm_due_soon urgency all 'distant' (37) — while tickets with status='open' = 40 and tickets open >14 days = 23. The brief renders the full calm state today.
  
  _Fix:_ Either fold open-ticket / chronic-ticket / board-card counts into the brief's situation line (Home's collectPriorityItems already has the queries), or soften the calm copy so it claims calm only for the R&M lane it actually reads.

- 🟡 **MEDIUM** — Ignored supabase {error} turns outages into false positives: 'all calm' hero and false 'Daily log not started' nudge · `js/home.js`
  
  House law 3: supabase-js resolves with {error}. Every source in collectPriorityItems destructures {data} without checking error (e.g. home.js:1123, 1150, 1291, 1334); if queries fail (offline, RLS, 5xx), items=[] and loadFeed renders 'Nothing urgent this morning. All equipment current, no overnight tickets, contractors on schedule.' (home.js:362-371) — a confident false all-clear. Worse, the 2pm daily-log check (home.js:1334-1345) treats error (data=null) as 'no row' and pushes a false 'Daily log not started' priority item. loadDailyOps (744, 764) similarly shows 'Not started' on error. Same dead-catch pattern in brief.js:64-88, home-rm.js:68-99, and all nine calendar.js loaders (silent catch, e.g. 132, 160) — a failed month load renders 'Nothing scheduled'.
  
  _Evidence:_ home.js:1334-1335: `const { data: existing } = await q; if (!existing || !existing.length) { candidates.push({ title: 'Daily log not started' ...` — a query error yields existing=null and fires the nudge. home.js:362: `if (!items.length)` → calm card with concrete factual claims.
  
  _Fix:_ Track per-source fetch failures in collectPriorityItems; when any source errored, render the existing 'Couldn't load priorities' state instead of the calm card, and skip the daily-log nudge unless the query verifiably returned zero rows (error == null).

- 🟡 **MEDIUM** — home-rm hero tiles are double-wired: PM hero opens Work Orders instead of the PM view · `js/home-rm.js`
  
  renderTiles builds hero tiles with BOTH an inline `onclick="event.stopPropagation();NX.openWorkOrders&&NX.openWorkOrders()"` (home-rm.js:210) and an addEventListener data-go handler (230-251). stopPropagation does not stop other listeners on the same element, so both fire. For the 'N units due for maintenance' hero (data-go='pm') the tap opens the Work Orders module (inline) AND calls NXRM.view.switchTo('pm') — conflicting navigation; for the issues hero the Work Orders open path runs twice (NX.openWorkOrders exists — domain.js:1364).
  
  _Evidence:_ home-rm.js:210: `onclick="event.stopPropagation();NX.openWorkOrders&&NX.openWorkOrders()"` is emitted for every hero regardless of h.go; lines 236-248 wire a second 'issues' loader on the same button.
  
  _Fix:_ Remove the inline onclick and let the single data-go listener route ('issues' → NX.openWorkOrders(), 'pm' → NXRM.view.switchTo('pm')).

- 🟡 **MEDIUM** — Compliance renew/edit/insert show success without checking the write's {error} · `js/brief.js`
  
  openComplianceModal's 'Mark renewed' (brief.js:374-390) awaits `NX.sb.from('equipment_compliance').update(...)` without destructuring error, then unconditionally closes the modal, reloads, and toasts 'renewed.' The edit handler (392-409) and promptNewCompliance insert (449-457) do the same. A failed write (RLS, network) yields a confident '✓ RENEWED' bubble on a compliance-critical record that was not actually renewed. Same unchecked-write pattern in inbox.js staleEscalate/staleDrop (433-459), though those at least re-render from the DB.
  
  _Evidence:_ brief.js:379-389: `await NX.sb.from('equipment_compliance').update({...}).eq('id', item.id); close(); await loadAll(); render(); NXRM.notify.bubble('Bzzt — ... renewed.', ...)` — no error check anywhere in the chain.
  
  _Fix:_ Destructure `{ error }` on each compliance write and toast the failure instead of success when it is set (habits.js v336 lines 526-527 show the house-correct pattern).

- 🔵 **LOW** — Home KPI buttons accumulate a new click listener on every refresh · `js/home.js`
  
  loadGlance runs on every refresh() (realtime-debounced, visibility returns, show()), and at its end re-attaches click listeners to all .home-kpi buttons (home.js:677-679) with no wired-guard. The buttons are created once in render() and only their textContent is updated, so listeners stack: after N background refreshes a single tap calls switchTo/equipmentFilterIntent N+1 times. Contrast loadCalendar's `viewBtn._wired` guard (433-436), which does this correctly.
  
  _Evidence:_ home.js:677-679: `document.querySelectorAll('.home-kpi').forEach(btn => { btn.addEventListener('click', () => statRoutes[btn.dataset.stat]?.()); });` inside loadGlance, called from refresh() on every debounce cycle.
  
  _Fix:_ Wire the KPI taps once in render() (or add a _wired guard like loadCalendar's).

- 🔵 **LOW** — Calendar excludes archived-NULL board cards and has no row-limit KPI truncation guard (both latent) · `js/calendar.js`
  
  calendar.js loadBoardCards uses `.eq('archived', false)` (calendar.js:212) which drops rows where archived IS NULL, while home.js deliberately uses `.or('archived.is.null,archived.eq.false')` (home.js:462) because fresh cards can have NULL. Verified currently harmless (0 NULL-archived cards of 102), but any creator that omits the column reintroduces the divergence. Relatedly, home.js loadGlance fetches ALL kanban_cards with no .limit (home.js:618) — PostgREST's default 1000-row cap will silently truncate the 'Open cards' KPI once the table passes 1000 rows (102 today).
  
  _Evidence:_ Live SQL: cards_total=102, cards_archived_null=0. calendar.js:212 `.eq('archived', false)` vs home.js:462 `.or('archived.is.null,archived.eq.false')`.
  
  _Fix:_ Align calendar's filter with Home's null-tolerant .or() form; add an explicit high .limit() or a head-count query for the open-cards KPI.

- 🔵 **LOW** — Home and Calendar disagree on which contractor_events status means 'cancelled' (latent — table empty) · `js/home.js`
  
  Home's 'On the books' excludes status 'cancelled' (home.js:453 `.neq('status','cancelled')`, also 1192), while calendar.js excludes 'disregarded' (calendar.js:117 `.neq('status','disregarded')`) and its status labels handle 'accepted'/'dismissed'/'pending'. Whichever vocabulary the email-ingestion writer uses, one of the two surfaces will keep showing events the other hides. contractor_events is currently empty (verified), so no live impact — but the ingestion pipeline exists and the divergence will surface silently when rows return.
  
  _Evidence:_ Live SQL: contractor_events count = 0. home.js:453 vs calendar.js:117 use different excluded-status literals.
  
  _Fix:_ Pick one canonical dismissed-status set (e.g. exclude both 'cancelled' and 'disregarded' via .not('status','in',...)) and use it in both files.

- 🔵 **LOW** — habits.js attaches NX.habits only to the lexical NX, not window.NX (Law-4 deviation, currently benign) · `js/habits.js`
  
  habits.js creates window.NX if missing (line 79) but then assigns `NX.habits = {...}` (line 1045) via the bare identifier, which resolves to app.js's lexical `const NX` in index.html — so window.NX.habits stays undefined. House law 4 says modules must attach to both. Verified benign today because every consumer (clippy.js:3689, 4715, 7956) also resolves the lexical NX in index.html; but any window.NX-side consumer (pet webview, page.evaluate probes, future clippy-* IIFE that shadows `var NX = window.NX`) will silently see no habits API and quietly disable Trajan's habit-driven behaviors.
  
  _Evidence:_ habits.js:79 `if (!window.NX) window.NX = {};` + habits.js:1045 `NX.habits = {` with no window.NX.habits assignment; no `var NX` shadow exists in habits.js (grep verified).
  
  _Fix:_ Add `window.NX.habits = NX.habits;` (or the standard `(typeof NX!=='undefined'&&NX)||window.NX` resolve) at the attach site.

- 🔵 **LOW** — Wins card 'yesterday' window starts 24h ago, not local midnight — early-morning wins undercounted · `js/home-rm.js`
  
  loadAll computes `yesterdayStart = new Date(Date.now() - 86400000).toISOString()` (home-rm.js:64) — a rolling 24-hours-ago mark — while todayStart is correct local midnight (63). closedYesterday (87-88) is repaired_at in [yesterdayStart, todayStart), so at 8am today anything closed yesterday between local midnight and 8am is silently dropped from the Wins celebration and Trajan's 'yesterday's victories' lines.
  
  _Evidence:_ home-rm.js:63-64 vs 86-88: todayStart is `new Date(y,m,d)` local midnight; yesterdayStart is `Date.now() - 86400000`.
  
  _Fix:_ Compute yesterdayStart as local midnight minus one day (`new Date(y, m, d-1).toISOString()`), matching todayStart.

- 🔵 **LOW** — stripTicketPrefix drops everything before the first colon in feed titles · `js/home.js`
  
  stripTicketPrefix (home.js:1354-1363) applies `.replace(/^[^:]+:\s*/, ...)` to every ticket title after the bracket-prefix strip, deleting all text up to the first colon. Intended for 'Hot Expo Low Boy: rattling', it also mangles titles where the pre-colon text is the content: '3:30 delivery no-show' becomes '30 delivery no-show', 'Urgent: walk-in down at Este' loses its own emphasis. Only affects the Home feed's REPORTED card display, not stored data.
  
  _Evidence:_ home.js:1359: `.replace(/^[^:]+:\s*/, (m) => { return ''; })` unconditionally, with only the `|| cleaned` fallback when the whole string was consumed.
  
  _Fix:_ Only strip the prefix when it matches a known equipment name or contains no digits/spaces-only-words heuristic; or cap the stripped prefix length.

- ⚪ **INFO** — Calendar's 'Predicted' layer reads the empty patterns table fed by undeployed functions · `js/calendar.js` · _known_
  
  loadPatternPredictions (calendar.js:340-361) queries patterns.next_predicted for purple 'AI-predicted' calendar events, but the patterns table is empty and its feeders (pattern-detect / weekly-reflect, cron jobs 7/8) 404 weekly against undeployed edge functions — a decision already queued for the owner. The calendar layer, legend entry, and color are dead weight until that call is made; it fails gracefully today.
  
  _Evidence:_ calendar.js:342-346 queries `patterns ... .not('next_predicted','is',null).eq('active', true)`; steward digest records patterns/meta_signals empty and crons 7/8 targeting undeployed functions (held for Alfredo's decision).
  
  _Fix:_ No action in this lane; fold into the existing crons-7/8 owner decision (if dropped, also remove the calendar layer and legend entry).


## NEXUS web app — surfaces & memory


### `pantheon-chat` — Pantheon chat views  · health: 🟡 fair


The Pantheon chat lane (chat-view.js, brain-chat.js, brain-chat-memory.js, brain-events.js, brain-list.js) is live and syntactically clean, and the god-chip surfaces work: Trajan's pulse/trust and Providentia's arc render from healthy pantheon_* bus rows (11 words + 10 readings + fresh pulse for Trajan, verified by SQL) with proper HTML escaping, and the reading-cap-60 data is well under cap. But two core flows are silently broken: (1) conversation persistence — chat_sessions has ZERO rows while chat_history has 68 messages, so hydrateSession always locks to persona 'legacy' and every post-migration message (36 of 68) is invisible when a conversation is reopened; (2) grounding — all "simple" questions now bypass the node-retrieval engine entirely and get a context with no node notes, tickets, or equipment data, including the stock suggested prompt "What's overdue for maintenance?". There is also a stored-XSS surface: brain-list and brain-events render node/event fields via innerHTML unescaped, and the backing tables carry anon_all RLS policies, so an unauthenticated writer with the public anon key can plant script that runs in Alfredo's browser (where the Anthropic/ElevenLabs keys sit in localStorage). Several law-3 dead catches remain in this lane (contractor event add/done/delete, chat_sessions insert), one of which silently discards a typed contractor event on insert failure. None of these appear in CLIPPY-AUDIT-REPORT.md.


- 🟠 **HIGH** — Chat history hydration permanently broken — chat_sessions is empty, transcript filter locks to 'legacy' · `js/chat-view.js`
  
  hydrateSession() reads chat_sessions to get the session's locked persona, defaults to 'legacy' when no row exists, then filters chat_history with .eq('persona', lockedPersona). Verified by SQL: chat_sessions has 0 rows while chat_history has 68 messages across 11 sessions (all 11 orphaned). All messages saved since the persona migration carry persona 'providentia' (19), 'trajan' (16), or NULL (1) — none match 'legacy' — so every reopened conversation renders empty or shows only pre-migration backfill rows. Root causes: (a) the default session id is auto-minted in brain-chat.js:3 without ever creating a chat_sessions row; only the drawer's 'New conversation' button inserts one; (b) that insert (chat-view.js:767-772) ends in .catch(()=>{}) — a dead catch under house law 3, since supabase-js resolves with {error} — so any failure is invisible.
  
  _Evidence:_ chat-view.js:1136-1148: `.from('chat_sessions').select('persona').eq('session_id', sessionId).single(); const lockedPersona = sessData?.persona || 'legacy'; ... .eq('persona', lockedPersona)`. SQL: chat_sessions=0 rows; chat_history=68 rows, 11 sessions, 0 with a chat_sessions row; persona counts legacy=32, providentia=19, trajan=16, NULL=1. RLS on chat_sessions allows public insert, so the table being empty means the writer never fires for the default session.
  
  _Fix:_ Make hydrateSession fall back to loading ALL personas for the session when no chat_sessions row exists (or drop the .eq persona filter entirely and render what's there); have brain-chat.js create a chat_sessions row when it mints the default session id; replace .catch(()=>{}) with {error} destructuring per house law 3.

- 🟠 **HIGH** — Simple questions get zero knowledge-graph grounding — node retrieval bypassed whenever MEMORY module is loaded · `js/brain-chat.js`
  
  brain-chat.js:1434 routes every non-'complex' question to `window.MEMORY ? MEMORY.getContext(q, SESSION_ID) : getCtx(q)`. MEMORY.getContext (brain-chat-memory.js:39-144) returns only conversation layers plus a STATE block listing the top-10 node NAMES with no notes, tickets, equipment, briefs, or contractor data. getCtx()'s full retrieval (scored nodes with 500-char notes, open tickets, today's brief, multi-hop links) now only runs if brain-chat-memory.js failed to load — and app.js:866 always loads it first. The ReAct tool loop also only fires for 'complex' questions. Result: chat-view's own suggested prompts, e.g. 'What's overdue for maintenance?' (chat-view.js:1004) and 'Who's visiting this week?', classify as simple under isComplex() and reach the model with no operational data, while the persona instructs it to 'never say based on my data — you just know', inviting confident hallucination.
  
  _Evidence:_ brain-chat.js:1432-1435: `// Simple question — use MEMORY (filtered by wing/room, no FULL INDEX bloat)\n ctx=window.MEMORY ? await MEMORY.getContext(q, SESSION_ID) : await getCtx(q);`. brain-chat-memory.js:131-141 builds STATE from `${n.name} (${n.category})` only. isComplex() (brain-chat.js:673-685) does not match 'What's overdue for maintenance?' (single W-word, no signal regex hits).
  
  _Fix:_ Append a trimmed node-retrieval layer (top ~5 scored nodes with notes, open tickets) to MEMORY.getContext, or run getCtx for simple questions too with the memory layers prepended — the token-budget goal can be kept by capping node notes at ~200 chars.

- 🟠 **HIGH** — Stored XSS: brain-list and brain-events render anon-writable DB fields via innerHTML unescaped · `js/brain-list.js`
  
  brain-list.js:53 (search results: highlightMatch(n.name) raw, notePreview raw) and :357 (list view: n.category, n.name, n.notes raw) inject node fields into innerHTML without escaping — an esc() helper exists in the file (line 229) but is only used in the help panel and semantic-search paths. brain-events.js:25 does the same with contractor_events.contractor_name/description/location. Verified by SQL: both `nodes` and `contractor_events` carry an `anon_all` RLS policy (ALL commands, public role), and the anon key ships in the public client — so an unauthenticated attacker can insert a node or event whose name/notes contain <img onerror=...> that executes in Alfredo's admin session, where the Anthropic and ElevenLabs API keys live in localStorage. LLM auto-extracted nodes (autoExtractNodes) are a second injection path. v348 hardened brain-chat.js with _bcEsc but left these two files untouched; CLIPPY-AUDIT-REPORT.md contains no XSS/innerHTML findings.
  
  _Evidence:_ brain-list.js:357: el.innerHTML=`<div class="list-node-cat">${n.category}${role}</div>...<div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>...`; brain-events.js:25: el.innerHTML=`...<span class="event-contractor">${ev.contractor_name||''}</span>...<div class="event-desc">${ev.description||''}</div>...`. SQL pg_policy: nodes → policy nodes_anon_all cmd '*' roles {0}; contractor_events → contractor_events_anon_all cmd '*' roles {0}.
  
  _Fix:_ Route every interpolated DB field in brain-list.js renderList/search-result markup and brain-events.js renderEvents through the existing esc() helper (add one to brain-events.js); make highlightMatch escape before inserting <mark>.

- 🟡 **MEDIUM** — brain-events.js: dead catches around all writes — a typed contractor event can be silently lost · `js/brain-events.js`
  
  House-law-3 violation throughout: addEvent (line 35) awaits the insert inside try/catch without destructuring {error}, then unconditionally clears the form fields and reloads — if the insert fails (RLS, network, bad column), the user's typed event vanishes with no error shown. The ✓ done and ✕ delete handlers (lines 26-27) likewise ignore {error}, so a failed update/delete just re-renders the unchanged list. loadEvents (line 15) treats an errored select as an empty result and displays 'No upcoming visits.' on transient failure.
  
  _Evidence:_ line 35: `try{await NX.sb.from('contractor_events').insert({...});document.getElementById('eventContractor').value='';...}catch(e){}` — supabase-js resolves with {error}, so the catch never fires and the success path always runs. line 15: `try{const{data}=await NX.sb.from('contractor_events').select(...);NX.brain.state.contractorEvents=data||[];}catch(e){...}`.
  
  _Fix:_ Destructure {error} on every call; on addEvent failure keep the form values and toast the error; on loadEvents error show a 'couldn't load' state instead of 'No upcoming visits'.

- 🟡 **MEDIUM** — window._NX_PERSONA_SUFFIX has two conflicting writers — prefs console silently strips the WHO character voice · `js/preferences.js`
  
  chat-view.js applySuffix() (line 244-246) writes tone-suffix + WHO-suffix (Clippy/Orion/Trajan/Providentia character prompt) to window._NX_PERSONA_SUFFIX. preferences.js:413 writes `window._NX_PERSONA_SUFFIX = getToneSuffix(next)` — tone only. Changing tone from the unified AI console (reachable from chat's + menu → 'Advisor, tone & voice') while a WHO chip is active clobbers the character suffix, so the next answers come back as plain NEXUS while the UI still shows e.g. Trajan active with his pinned word — until the user re-taps a chip. The 1-second localStorage polling loop (preferences.js:509-515) papers over the missing event but doesn't restore the WHO half.
  
  _Evidence:_ chat-view.js:245: `window._NX_PERSONA_SUFFIX = (TONE_PRESETS[state.tone]?.suffix || '') + (WHO_PRESETS[state.who]?.suffix || '');` vs preferences.js:413: `window._NX_PERSONA_SUFFIX = getToneSuffix(next);`
  
  _Fix:_ Make a single composer the only writer (e.g. expose NX.chatview.applySuffix and have preferences.js call it after updating tone), or have preferences.js re-read nx_chat_who and append the WHO suffix.

- 🟡 **MEDIUM** — WHO chips don't update the memory wing — Trajan conversations filed under Providentia's memory · `js/chat-view.js`
  
  brain-chat-memory.js scopes save and recall by CURRENT_PERSONA, updated only via the 'nx-persona-change' event that app.js's coin (setActivePersona) dispatches. The chat WHO chips (chat-view.js:436-443) set state.who and the prompt suffix but never call NX.setActivePersona or dispatch the event. So talking to 'Trajan' via the chip while the coin sits on Providentia saves those turns with wing/persona='providentia' and recalls from Providentia's wing — and Clippy/Orion/NEXUS chats have no wing of their own at all. Cross-effect with finding 1: hydration by chat_sessions.persona (coin value at creation) will diverge from what the WHO chip showed the user. Two parallel persona systems (coin vs chips) with no bridge.
  
  _Evidence:_ chat-view.js:436-443 click handler: only `state.who = b.dataset.who; localStorage.setItem('nx_chat_who',...); applySuffix(); ... paintGodWord();`. brain-chat-memory.js:13-17 listens solely to 'nx-persona-change' and accepts only 'providentia'|'trajan'. brain-chat-memory.js:165: `persona: CURRENT_PERSONA, wing: CURRENT_PERSONA`.
  
  _Fix:_ When a god chip is tapped, also call NX.setActivePersona(who) (for trajan/providentia) so memory wing, coin, and chip agree; decide explicitly how nexus/clippy/orion chats should be wing-tagged and document it.

- 🔵 **LOW** — Chat-view's Tone & voice persona sheet is unreachable dead code · `js/chat-view.js`
  
  openPersonaSheet (chat-view.js:837) has no caller anywhere: the + menu's 'settings' action opens NX.prefs.openSheet instead, and preferences.js:429 gates its handoff on `window.chatview && chatview.openPersonaSheet` — window.chatview is never set (chatview is IIFE-local, exported only as NX.chatview) and openPersonaSheet isn't a property of the chatview object anyway. The ~120 lines of sheet markup, TONE_PRESETS grid, and voice grid render but can never be shown; the prefsVoiceOpen button always falls through to NX.openVoicePicker or a toast.
  
  _Evidence:_ grep: openPersonaSheet appears only at chat-view.js:837 (definition) and preferences.js:429 (dead guard). chat-view.js:137-205 chatview object exposes open/close/toggle/renderTranscript/setPersona only.
  
  _Fix:_ Either export openPersonaSheet on the chatview object and fix preferences.js to call NX.chatview.openPersonaSheet, or delete the sheet code and its wiring.

- 🔵 **LOW** — Compound-action buttons display raw HTML markup as their label · `js/brain-chat.js`
  
  handleCompoundAction builds `const icon='<i data-lucide="..." class="action-icon"></i>'` then assigns `btn.textContent=`${icon} ${action.type}: ${action.title}``— textContent renders the tag literally, so every suggested-action button reads like '<i data-lucide="alert-triangle" class="action-icon"></i> ticket: Fix walk-in'. The lucide icon is never created (no createIcons call either). Cosmetic but appears on every compound-action suggestion, which is a marquee feature.
  
  _Evidence:_ brain-chat.js:276-277: `const icon=`<i data-lucide="${iconName}" class="action-icon"></i>`; btn.textContent=`${icon} ${action.type}: ${action.title}`;`
  
  _Fix:_ Drop the HTML string and use a plain glyph in textContent, or build the button with a separate icon element and set the label via textContent.

- 🔵 **LOW** — paintGodWord mislabels DB errors as 'no word yet' and fires a spurious pantheon-voice invoke · `js/chat-view.js` · _known_
  
  paintGodWord destructures `const { data } = await NX.sb.from('clippy_sync')...` without checking {error}; a resolved error yields data=null, which renders 'no word yet; waking them…' and invokes the pantheon-voice edge function even though words exist — the function's 20h/6d guard makes it harmless but each transient failure costs an invoke and shows a wrong message (the catch only fires on network throws). Separately (known context): the pantheon_* words ride clippy_sync, which is world-writable with the anon key, so a god's displayed 'word', pulse line, and trust number are forgeable text — the escT() escaping correctly prevents markup injection, so forgery is text-only. Verified live rows are healthy: Trajan 11 words/10 readings/2 trust entries + fresh pulse; Providentia 2 words/1 reading (her arc needs ≥2 readings, so it correctly doesn't render yet); both far under the 60-reading cap.
  
  _Evidence:_ chat-view.js:522-533: `const { data } = await NX.sb.from('clippy_sync').select('data').eq('id','pantheon_'+god).maybeSingle();` with no error check, then `if (!render(...)) { await NX.sb.functions.invoke('pantheon-voice',...) }`. SQL: pantheon_trajan words=11, readings=10, trust=2, pulse_ts fresh; clippy_sync world-writable per house law 5 / docs/CLIPPY-SOUL-RLS-PROPOSAL.md.
  
  _Fix:_ Destructure {data, error}, and on error render the 'unreachable right now' line instead of the waking path; the clippy_sync write-access question stays with the pending soul-RLS owner decision.

- ⚪ **INFO** — Full chat transcripts are readable and deletable with the public anon key · `js/brain-chat-memory.js` · _known_
  
  chat_history, chat_sessions, meta_signals, and action_chains all carry anon ALL-command RLS policies (verified in pg_policy). Chat transcripts are the most personally revealing data in this lane — Alfredo's questions, the AI's answers about finances/staffing, and meta_signals quality-tracking of his query text — and anyone holding the anon key (embedded in the public GitHub Pages client) can select or delete all of it. This is consistent with the documented shared-anon-key architecture (roles are app-level), so it is a standing owner-accepted tradeoff rather than a regression — flagged because chat content is more sensitive than most tables under that model, and it's adjacent to the pending clippy soul-RLS decision.
  
  _Evidence:_ SQL pg_policy: chat_history → chat_history_anon_all cmd '*' roles {0}; chat_sessions → chat_sessions_write cmd '*'; meta_signals → meta_signals_anon_all cmd '*'; action_chains → action_chains_anon_all cmd '*'. CLAUDE.md: 'DB access is a shared anon key, so role enforcement is app-level.'
  
  _Fix:_ When the clippy soul-RLS decision is made, include chat_history/chat_sessions in the same tightening pass (e.g. insert+select only, no anon delete/update).


### `galaxy-moneta` — Galaxy + Moneta mind  · health: 🟡 fair


The galaxy/Moneta lane is functional but leaner than its legend: the nodes table holds just 47 rows (37 moneta journal stars, 7 contractors, 3 misc) versus the "~2751 processed nodes" the code comments assume, so render performance is a non-issue today and the perf-degradation flag that exists is dead code anyway. The ✦ by-meaning search path (brain-list.js → NX.moneta.recall → moneta-mind edge fn → match_nodes) is correctly wired with the 0.74 floor, sequence-tokening, and graceful degradation to keyword search; the two-NX bridge is sound because app.js line 4584 unifies window.NX with the lexical NX before galaxy.js/moneta-mind.js (both lazy/defer) load. The two real problems: (1) node name/category/notes are injected into innerHTML unescaped in the node panel and keyword search results while the nodes table is world-writable to the public anon key — an unauthenticated stored-XSS path into Alfredo's admin session (the 2026-07 fix escaped only email headers, explicitly acknowledging this exact threat model); (2) NX.moneta.embedNode has zero callers and the backfill only handles NULL embeddings, so every node edit leaves a permanently stale vector — the mind silently drifts. Also notable: the 30-second data-layer poll fetches ~6 queries of tickets/logs/cards that nothing renders anymore, and edits/uploads in the panel report success without checking the resolved {error}. Good news verified in the DB: nodes_block_moneta_delete is a genuine RESTRICTIVE policy, so Moneta memories cannot be deleted through the API.


- 🟠 **HIGH** — Stored XSS: node name/category/notes rendered via innerHTML, and nodes is world-writable with the anon key · `/home/user/nexus/js/galaxy.js`
  
  openPanel escapes ingested-email header fields (esc() at lines 1717-1719, comment explicitly names the stored-XSS threat model) but renders node name/category unescaped into innerHTML in backlinks (line 1772: `d.innerHTML = `<span class="np-link-cat">${bl.category}</span>${bl.name}``), transclusions including raw notes (line 1796), links (line 1928), and notes-history text (line 1995). brain-list.js keyword search results do the same (line 53: `${nameHtml}` from highlightMatch and raw notePreview into innerHTML) — only the semantic ✦ path escapes (line 127). DB check confirms policy `nodes_anon_all` on public.nodes: ALL commands, USING true, WITH CHECK true, role PUBLIC — anyone holding the public anon key (shipped in the PWA source) can INSERT/UPDATE a node with a payload name like `<img src=x onerror=...>` with no authentication. Node names/notes are also minted from external content (brain-chat.js:453 inserts web-research notes; email ingestion). The payload executes in Alfredo's admin session (NX.isAdmin, Gmail compose flows).
  
  _Evidence:_ js/galaxy.js:1772,1796,1928,1995; js/brain-list.js:53,88-92; SQL: pg_policy on nodes → {polname:'nodes_anon_all', polcmd:'*', using:'true', check:'true', permissive:true}
  
  _Fix:_ Escape name/category/notes everywhere they enter innerHTML (reuse the esc() already in openPanel and brain-list.js:229), or build these fragments with textContent. Longer term this is another argument for the held nodes-RLS tightening decision.

- 🟡 **MEDIUM** — Moneta mind never re-embeds: embedNode has zero callers, backfill only covers NULL vectors · `/home/user/nexus/js/moneta-mind.js`
  
  NX.moneta.embedNode (moneta-mind.js:47) is documented as '(re)embed one node after minting/editing' but grep across js/ finds no caller. None of the node create/edit paths (galaxy.js:2011 panel notes edit, admin.js:2138/2360, brain-chat.js:453/501/1849, equipment.js, ai-writer.js, log.js:744, native-bridge.js) invoke it. The only healing is ensureEmbedded → edge fn backfill (supabase/functions/moneta-mind/index.ts:88-94) which selects `.is('embedding', null)` — it can never refresh a stale vector. So any node whose notes are edited keeps its original embedding forever and ✦ by-meaning search ranks it on outdated content. New nodes also depend on a client-side 3-per-10-min cooldown backfill. Currently latent (DB: 47 nodes, 0 unembedded), but it silently degrades exactly the corpus that changes most.
  
  _Evidence:_ grep 'embedNode' across js/ → only moneta-mind.js definition/export; supabase/functions/moneta-mind/index.ts:90-94 `.is('embedding', null)`; SQL: total_nodes=47, unembedded=0
  
  _Fix:_ Call NX.moneta.embedNode(id) fire-and-forget after every nodes insert/update that touches name/tags/notes (at minimum the galaxy panel save at galaxy.js:2011 and the main create paths), or have the backfill also select rows where embedded_at < a last-modified timestamp.

- 🟡 **MEDIUM** — 30s data-layer poll fetches 6 queries whose rendering was deleted — only pending.count is used · `/home/user/nexus/js/galaxy.js`
  
  refreshDataLayers (lines 2101-2198) runs every 30s while the galaxy is visible, querying raw_emails (limit 2000, count exact), tickets (200), contractor_events (100), daily_logs last-24h (500), kanban_cards (100), and pm_logs (50). The distant-field bake that painted these as nebulae/haze was removed (lines 373-389: buildDistantField is now a no-op; comment says the tickets/cards/logs nebulae were 'dropped or moved' — they were dropped). Grep confirms state.dataLayers.{tickets,contractorEvents,recentLogs,cards,pendingPmLogs,openTicketsByLocation} are written but never read by any draw function or any other module. The only surviving consumer is pending.count → meteor spawn rate, and pending_emails is currently 0, so today the entire poll paints nothing.
  
  _Evidence:_ js/galaxy.js:2101-2198 (queries), 380-389 (no-op bake), grep 'dataLayers' → galaxy.js only, no draw-site reads; SQL: raw_emails processed=false count = 0
  
  _Fix:_ Reduce refreshDataLayers to a single head/count query on raw_emails (all the meteors need), or re-wire the fetched layers into the live drawing if the 'every light represents something real' design is still wanted.

- 🟡 **MEDIUM** — Node edit and attachment-upload saves show success without checking the resolved {error} · `/home/user/nexus/js/galaxy.js`
  
  House law #3 family: supabase-js resolves with {error}. The panel notes save (line 2011: `await NX.sb.from('nodes').update({ notes: newNotes, notes_history: trimmedHist }).eq('id', n.id);`) ignores the result entirely, then unconditionally sets n.notes = newNotes and repaints the panel as saved. The attachment metadata write (line 2041) is likewise unchecked. On a transient wifi drop or RLS rejection, Alfredo sees his edit 'saved' and it silently reverts on next reload — the exact failure class the standing gotcha warns about. (The delete path at 1950-1960 does destructure error, though it gives no feedback on failure.)
  
  _Evidence:_ js/galaxy.js:2011-2014, 2041-2042
  
  _Fix:_ Destructure {error} on both writes; on error keep the textarea open and surface a small 'save failed — retry' message instead of committing the local state.

- 🔵 **LOW** — Moneta memories can't be deleted (restrictive RLS — good), but the panel Delete button fakes success on them · `/home/user/nexus/js/galaxy.js`
  
  DB verification: nodes_block_moneta_delete is a RESTRICTIVE policy (polpermissive=false, USING category IS DISTINCT FROM 'moneta') so it genuinely overrides the permissive nodes_anon_all — Moneta journal rows cannot be deleted via the API. That enforces the CLAUDE.md law well. However a blocked delete returns no error with 0 rows affected, and the panel delete handler (lines 1950-1960) checks only `if (!error)` before removing the node from NX.nodes and state.particles and closing the panel — so 'deleting' a moneta star appears to succeed, the mint-silver star vanishes, then resurrects on next load. Confusing but data-safe.
  
  _Evidence:_ SQL: pg_policy → nodes_block_moneta_delete polpermissive=false, polcmd='d'; js/galaxy.js:1950-1960
  
  _Fix:_ Use .delete().eq(...).select() and treat 0 returned rows as 'protected — Moneta memories are permanent', or hide the Delete button when n.category === 'moneta'.

- 🔵 **LOW** — Clippy memory stars: world-space cull + draw-time screenX means stale/broken hit-testing under pan/zoom (v336 bug class, unfixed here) · `/home/user/nexus/js/galaxy.js`
  
  The v336 fix (comment at lines 493-502) moved main-particle culling and screenX/screenY computation to screen space specifically because world-space culling made panned/zoomed stars untappable. drawClippyStars still has the old pattern: line 2344 culls in WORLD coords (`if (s.x < -30 || s.x > W+30 ...) continue;`) before setting screenX/screenY at 2371-2372 — so a blue memory star that is visible after panning can be culled (untappable, invisible) and culled stars keep stale screenX from a previous frame, which findClippyStarAt (2378-2391) will still hit-test, allowing phantom taps. Stars also start with screenX=0,0 until first drawn.
  
  _Evidence:_ js/galaxy.js:2344 vs 2371-2372; contrast with the v336 pattern at 493-502; findClippyStarAt 2378-2391
  
  _Fix:_ Mirror the v336 fix: compute screenX/screenY first, cull on screen coords, and skip hit-testing for never-drawn stars.

- 🔵 **LOW** — perfMode is detected but does nothing, and the galaxy's scale assumptions are 58x stale (2751 → 47 nodes) · `/home/user/nexus/js/galaxy.js`
  
  Lines 1485-1488 flip state.perfMode=true when avg frame time exceeds 22ms and log 'Entering perf mode', but no code anywhere reads perfMode — the degradation path is a no-op flag. In practice it doesn't matter at current scale: the DB holds 47 nodes (37 moneta), not the '~2,751 processed nodes' the header comment and ACTIVE_MAX=3000 sizing assume, so per-frame cost is trivial and even the worst loop (updateSparkles collision: SPARKLE_MAX 120 x particles, estimated in-comment at '80 x 800') is small. The dead flag only becomes a real risk if the corpus regrows toward the designed scale on low-end phones.
  
  _Evidence:_ js/galaxy.js:45,1485-1488 (only occurrences of perfMode); 50,160-163 (stale scale comments); SQL: nodes count = 47
  
  _Fix:_ Either wire perfMode to something (skip halos/sparkle collisions, halve starfield) or delete the flag; update the stale scale comments while there.

- ⚪ **INFO** — moneta-mind edge fn: service-role recall ignores is_private and embed/backfill are unauthenticated writes · `/home/user/nexus/supabase/functions/moneta-mind/index.ts`
  
  The function claims 'callers can only read what the anon role could already read' (index.ts:8-9), which is true today only because nodes_anon_all makes everything anon-readable. match_nodes (verified DB definition) filters is_deleted/is_archived but NOT is_private, and the fn queries with the service key, verify_jwt off, CORS *. The UI hides is_private nodes (brain-list.js:29,112) but the recall endpoint would hand their notes (700 chars) to any unauthenticated caller. Currently 0 private nodes exist, so no live leak — but if the held decision to tighten nodes RLS/scoping ships, this endpoint becomes the bypass that undoes it. Ops 'embed'/'backfill' are also unauthenticated service-role writes (benign: they only rewrite embedding/embedded_at, but they burn edge compute on demand).
  
  _Evidence:_ supabase/functions/moneta-mind/index.ts:7-9,13-16,53-69; SQL match_nodes def: no is_private predicate; SQL: private_nodes=0
  
  _Fix:_ Add `coalesce(n.is_private,false)=false` to match_nodes now (cheap, future-proof), and remember this endpoint whenever the nodes-RLS held decision is executed.

- ⚪ **INFO** — Galaxy content today: 47 nodes, 37 of them Moneta — the knowledge disc is mostly Orion's journal · `/home/user/nexus/js/galaxy.js`
  
  Live counts: moneta 37 (newest 2026-07-21), contractors 7 (newest 2026-06-30), equipment/people/projects 1 each; 0 pending raw_emails, 0 deleted, 0 archived, 0 unembedded. buildParticles' moneta rule (never demoted, ring at t=0.05-0.11 just outside the black hole, lines 253-256, 269-275) works as designed and dominates the visual. The two-NX wiring is verified sound: app.js:4584 folds window.NX into the lexical NX before galaxy.js (lazy-loaded via loadScript at app.js:861) and moneta-mind.js (defer) run, so the removed defineProperty sb-bridge is correctly redundant. Also of note: state.commCenters is computed from particle positions before any frame runs (all x,y = 0 at build time, lines 349-363) and has no consumer in any module — every center sits at (0,0); dead legacy API.
  
  _Evidence:_ SQL category breakdown; js/app.js:4584,861-867; js/galaxy.js:253-275,335-337,349-363; grep 'commCenters' → galaxy.js only
  
  _Fix:_ No action required; worth knowing that the 'knowledge galaxy' currently visualizes the steward's memory far more than restaurant knowledge — if that's not intended, the email→nodes ingestion pipeline (out of this lane) is where the corpus stopped growing.


### `misc-screens` — Secondary screens  · health: 🟡 fair


The misc-screens lane is real and wired: all nine files load (domain/i18n/translate eagerly, education lazily via app.js's moduleMap, the rest deferred), the two-NX trap is correctly bridged for every module here (app.js:4584 folds window.NX into the lexical NX, and domain.js/translate.js pre-create window.NX before app.js runs), the translate edge function is deployed and the nexus_users.language column exists, and the pm/spend views are reachable via nav tabs plus self-registered NX.modules entries. The two findings that matter most: (1) domain.js — the central write-orchestrator for PM/issues/board — is riddled with law-3 dead catches, so several core writes (equipment status change, work-order-repaired, PM log insert) can fail silently while the UI reports success; and (2) 14 of 37 active pm_schedules (vendor-created 'PM — Austin Air and Ice' appointment rows with NULL frequency/next_due_at) are permanently invisible to checkPMsDue and render as 'every nulld' — a 38% blind spot in the PM-due pipeline. Secondary: education's Spanish titles are captured but never rendered, its steps editor has a delete-before-insert data-loss window, and page translation reverts to English on async re-renders because the _nxTrActive flag is written but never consumed. Nothing in this lane touches the clippy_sync bus or violates the pars/auto-close laws.


- 🟠 **HIGH** — domain.js core orchestration full of dead catches — writes fail silently, success reported anyway · `js/domain.js`
  
  domain.js (the single orchestrator for PM/issue/board ripples) repeatedly wraps supabase-js awaits in try/catch without destructuring {error} — the recurring house bug (law 3). Worst instances: applyEquipmentStatusChange (js/domain.js:905) runs `await NX.sb.from('equipment').update({status:newStatus})` with no error check and returns true even if the update failed, so the caller's confirm() flow reports success while equipment status never changed; W.fulfillForEquipment step 1 (js/domain.js:1289) marks the work order repaired with no error check — a failed update leaves the issue open while the card is moved to Done and the ticket closed (surfaces drift, the exact thing NX.work exists to prevent); completePMSchedule's pm_logs insert (js/domain.js:185-194) can silently drop the PM history row; recordPMScan (js/domain.js:88-91) has a catch whose comment says 'column may not exist' — but a missing column resolves with {error}, it never throws, so the failure is invisible. Same class in money.js:31 (loadRollup), translate.js:507, interests.js:1618, library.js:144.
  
  _Evidence:_ js/domain.js:905 `await NX.sb.from('equipment').update({ status: newStatus }).eq('id', equipmentId);` — next error check is the outer catch that a resolved {error} never reaches; function returns true. js/domain.js:1288-1290 `await NX.sb.from('equipment_issues').update(patch).eq('id', issueId);` inside try/catch with console.warn that can never fire.
  
  _Fix:_ Sweep domain.js for `await NX.sb.` calls that neither destructure error nor .throwOnError(); destructure `{error}` and propagate (applyEquipmentStatusChange must return false on error; fulfillForEquipment should skip card-close/ticket-close if the issue update failed).

- 🟠 **HIGH** — 14 of 37 active PM schedules can never come due — vendor 'appointment' rows break the /pm data contract · `js/pm.js`
  
  pm_schedules holds two incompatible shapes. vendors.js:1586 inserts appointment-style rows (scheduled_date set, frequency_days NULL, next_due_at NULL, title 'PM — <vendor>'), while pm.js/domain.js assume recurring-cadence rows. Live DB: 14 of 37 active schedules (38%) have next_due_at IS NULL — all 'PM — Austin Air and Ice', created 2026-07-13..16. Consequences: (a) domain.checkPMsDue filters `.lte('next_due_at', todayISO)` (js/domain.js:257) — NULL never matches, so these schedules NEVER generate 'PM Due' board cards; (b) pm.js fallback maps days_until_due=null → urgency 'distant' forever (js/pm.js:69-75), so they sit unsorted at the bottom; (c) the card renders 'every nulld' (js/pm.js:236) and the Mark-done confirm reads 'advances the next due date by null days'; (d) completePMSchedule parses freq=NaN so next_due_at is never set even after completion (js/domain.js:168-174).
  
  _Evidence:_ SQL: `select count(*) from pm_schedules where active=true and next_due_at is null` → 14 (of 37 active); sample rows all frequency_days:null, next_due_at:null, title 'PM — Austin Air and Ice'. js/vendors.js:1586-1590 insert sets scheduled_date/phase/status but neither frequency_days nor next_due_at.
  
  _Fix:_ Decide the contract: either give vendor-created PM rows a next_due_at (= scheduled_date) so checkPMsDue and /pm see them, or filter the appointment shape (status='scheduled', no cadence) out of the /pm recurring list and checkPMsDue, and guard the 'every Nd' / confirm text for null frequency. Needs Alfredo's read on which behavior he expects.

- 🟡 **MEDIUM** — education.js persistSteps deletes all steps before insert — a failed insert permanently loses the lesson · `js/education.js`
  
  Saving a steps-type lesson runs delete-all-then-insert with no transaction: `await NX.sb.from('education_guide_steps').delete().eq('guide_id', guideId)` (result ignored — also a dead-error path) then a single insert of the new rows. If the insert fails (network drop on a kitchen tablet, RLS, bad column) after the delete succeeded, every existing step of the guide is gone and the editor has already closed on throw, so the in-memory copy is lost too. Also, if the delete itself fails silently, the insert duplicates steps.
  
  _Evidence:_ js/education.js:1129-1146 — `await NX.sb.from('education_guide_steps').delete().eq('guide_id', guideId); if (!steps.length) return; ... const { error } = await NX.sb.from('education_guide_steps').insert(rows); if (error) throw error;`
  
  _Fix:_ Check the delete's {error} and abort before inserting; better, upsert the new set first (or write to a staging state / do the swap in an RPC) so the old steps are only removed after the new ones are confirmed written.

- 🟡 **MEDIUM** — Spanish names captured but never rendered — Education screen is English-only for a bilingual crew · `js/education.js`
  
  The module/lesson editors collect name_es and title_es (js/education.js:654-656, 781-783) and store them, but every render path uses only name_en/title_en: category pills (line 219), lesson cards (line 342), takeover header (lines 381-382). NEXUS_I18N's language state and the translate pipeline are never consulted here, so Spanish-speaking cleaning staff — the primary audience of training guides — see English titles even when the admin typed Spanish ones. The legacy dictionary layer can't help either: index.html has only 63 data-i18n nodes, all from the old v12 UI (PIN/ingest/admin); no newer screen (education, PM, spend, work-order detail) has dictionary coverage, leaving the paid Claude-translate FAB as the only path.
  
  _Evidence:_ js/education.js:219 `<span>${esc(cat.name_en)}</span>` and :342 `<div class="edu-card-title">${esc(g.title_en)}</div>` — no reference to name_es/title_es anywhere outside the editor forms (grep confirms). `grep -c 'data-i18n' index.html` → 63.
  
  _Fix:_ Cheap high-value fix: when NEXUS_I18N.getLang()==='es', prefer name_es/title_es with English fallback in renderListView/renderTakeover. Longer term decide whether the _es columns or the translate pipeline is the canonical Spanish path — right now the _es data is dead weight.

- 🟡 **MEDIUM** — translate.js setTarget: cross-device language persistence is a dead catch (law 3) · `js/translate.js`
  
  When a user picks a language, setTarget updates nexus_users.language inside try/catch without checking the resolved {error} (nexus_users.language column exists — verified). If the update fails (RLS, offline), the catch never fires, no warning logs, NX.currentUser.language is still set locally, and the preference silently doesn't stick to the next device/login — the user must re-pick every session elsewhere. Minor same-class polish nearby: after translating then tapping '↺ original', the globe button is re-attached with its textContent still '…' (set at line 193, only restored on the other toggle path).
  
  _Evidence:_ js/translate.js:506-513 `try { await NX.sb.from('nexus_users').update({ language: lang }).eq('id', NX.currentUser.id); NX.currentUser.language = lang; } catch (e) { console.warn(...) }` — supabase-js resolves with {error}; the catch is unreachable for query failures.
  
  _Fix:_ Destructure `const { error } = await ...` and warn/toast on error; keep localStorage as the working fallback.

- 🟡 **MEDIUM** — Page-translation coverage gap: async re-renders revert to English; _nxTrActive is written but never read · `js/translate.js`
  
  translatePage swaps text nodes in place, so any re-render (realtime board reload, PM list refresh, detail.js's MutationObserver-driven remounts) replaces translated nodes with fresh English ones. app.js's retranslate covers view activations with two timed passes (400ms/1500ms — js/app.js:1838-1859), but nothing re-applies after later realtime refreshes, and `document._nxTrActive` (js/translate.js:468, 482) — evidently intended as the 'a language is active' signal for re-application — is never read anywhere in the codebase. Non-English users see screens flicker back to English mid-session until they navigate. Each re-application also re-fires edge-function batches for the whole visible DOM (server cache mitigates cost, not latency).
  
  _Evidence:_ Grep for `_nxTrActive` → only js/translate.js:468 (write) and :482 (clear); no consumer. js/app.js:1838 retranslate only runs inside activateModule.
  
  _Fix:_ Read _nxTrActive from a debounced MutationObserver (or from module reload hooks) to re-apply translation to changed subtrees, or accept and document the nav-only behavior.

- 🔵 **LOW** — detail.js realtime channels leak — unmount() exists but is never called · `js/detail.js`
  
  Every issue detail opened calls subscribeIssue(), storing a supabase realtime channel in `subs` keyed by issue id. NXRM.detail.unmount removes a channel, but nothing in the codebase ever calls it (grep: only the definition and the back-compat alias). Channels accumulate for every issue viewed in a session; each comment/update event on any previously-viewed issue re-runs refresh() (a full re-fetch + remount if its container still exists). On an all-day kitchen tablet this is a slow websocket/subscription and fetch-traffic leak.
  
  _Evidence:_ js/detail.js:542-556 subscribeIssue stores channels in `subs`; js/detail.js:564-569 unmount defined; grep for `detail.unmount|NXIssueEnhance` finds no caller.
  
  _Fix:_ Call unmount when the detail container is removed (hook the existing MutationObserver: if a subscribed issue's container is gone, remove its channel), or cap/reuse a single channel with a dynamic filter.

- 🔵 **LOW** — pm.js createSchedule() is dead code that would recreate the never-due bug if rewired · `js/pm.js`
  
  The single-unit createSchedule (js/pm.js:371-450) is defined but unreachable — the only '+ New' button is wired to bulkCreateSchedule (js/pm.js:296), and no other caller exists. Notably its insert (line 424) omits next_due_at, exactly the field whose absence makes schedules invisible to checkPMsDue (see the high finding), so reviving it as-is would mint more inert schedules.
  
  _Evidence:_ grep 'createSchedule' → definition at js/pm.js:371 and an internal log string only; wirePMView:296 binds bulkCreateSchedule. Insert at js/pm.js:424-430 has no next_due_at.
  
  _Fix:_ Delete the function, or fix its insert (next_due_at = today + frequency_days) and keep it as the single-unit path.

- 🔵 **LOW** — Education icon keys missing from the svg map — several UI icons silently fall back to the info circle · `js/education.js`
  
  renderGuidesForCategory maps primary_kind → icon names 'document', 'external', 'scroll', 'graduation' (js/education.js:323-325), and empty states use svg('graduation'). None of these keys exist in the svg() paths dictionary (js/education.js:47-76), so svg() falls back to the 'info' circle. Text lessons, embeds, steps lessons, and both empty-state emblems all render the same ⓘ icon; the embed fallback link's svg('external') at line 446 likewise.
  
  _Evidence:_ js/education.js:77 `const p = paths[name] || paths.info;` — paths has no document/external/scroll/graduation keys; js/education.js:324 `{text:'document', video:'video', pdf:'book', embed:'external', steps:'scroll'}`.
  
  _Fix:_ Add the four missing path entries (or remap to existing keys: text→pen/list, embed→link, steps→list, graduation→book).

- 🔵 **LOW** — Interest alias collisions route some tags to the wrong knowledge pool · `js/interests.js`
  
  ALIAS_TO_KEY is built by straight iteration with last-writer-wins (js/interests.js:1428-1435). 'marcus-aurelius' is an alias of both roman_history (line 120) and philosophy_stoic (line 158) — the stoic entry wins, so an admin who tags someone 'marcus-aurelius' expecting Roman history gets stoicism. 'strategy' likewise belongs to both military_history (line 144) and appears in board-game/chess contexts. Purely content-routing, no data risk.
  
  _Evidence:_ js/interests.js:120 roman_history aliases include 'marcus-aurelius'; :158 philosophy_stoic aliases include 'marcus-aurelius'; :1432-1434 `ALIAS_TO_KEY[a.toLowerCase()] = key` overwrites without warning.
  
  _Fix:_ Either de-duplicate aliases across the catalog or make the collision explicit (first-wins with a console.warn in dev).

- ⚪ **INFO** — Budget tracker shipped but unused: budgets table has 0 rows · `js/money.js`
  
  money.js's annual-budget tracker (Spend view section, Daily Brief cards, get_budget_status brain tool) is fully wired and the v_budget_status/v_spend_rollup views exist, but the budgets table is empty — no budget has ever been set for any restaurant. The Spend view correctly shows the '+ Set up your first annual budget' CTA; the brief section and brain tool just return nothing. Not a defect — a feature waiting for Alfredo to enter three numbers (annual R&M budget per restaurant) to light up pace-variance tracking.
  
  _Evidence:_ SQL: `select count(*) from budgets` → 0. Views v_budget_status/v_spend_rollup confirmed present. js/money.js:322-328 renders the empty-state CTA.
  
  _Fix:_ Surface to Alfredo: entering annual R&M budgets for Suerte/Este/Bar Toti activates an already-built over/under-pace tracker on Spend and the Daily Brief.


### `drive-native` — Drive, files, native bridge  · health: 🟡 fair


The drive-native lane is a mixed picture. The core daily/biweekly Drive-doc pipeline (js/nx-drive.js) is well built and working — 16 uploads recorded, create-or-update in place, correct scope-union token handling — and js/nexus-qr.js is a faithful, dependency-free QR implementation with no defects found. But the v18.33 bidirectional Logbook feature is silently half-broken: its Daily Logs tab queries a `data` column that does not exist on `daily_logs` (real logs live in `facility_logs`), and its lane-name lookup queries a nonexistent `kanban_lists` table — both errors are swallowed by a catch-all wrapper, so every sync reports success while writing empty tabs. The native bridge (js/native-bridge.js) has two serious issues: an Android notification listener that has funneled 6,510 WhatsApp/Telegram/Gmail/Slack message bodies into `raw_emails`, a table with an anon-ALL policy readable and writable by anyone holding the public anon key; and multiple dead try/catch blocks around supabase upserts (house law 3) that make the weekly-checklist scanner report "logged" counts even when nothing saved. Drive auto-upload also stalls when the OAuth token expires mid-save (two "Popup window closed" failures; latest 2026-07-21). None of these appear in CLIPPY-AUDIT-REPORT.md.


- 🔴 **CRITICAL** — Notification listener pipes private WhatsApp/Gmail/Slack messages into world-readable raw_emails · `/home/user/nexus/js/native-bridge.js`
  
  NX.startNotificationListener (line 340) captures notification title+body from WhatsApp, WhatsApp Business, Telegram, SMS, Gmail, and Slack (default watch list, line 357) and upserts them into raw_emails (line 385) with subject/body/snippet in cleartext. The table's RLS policy is raw_emails_anon_all, cmd ALL, roles {public} — anyone with the app's public anon key (embedded in the GitHub Pages PWA) can read, modify, or delete them. The DB currently holds 6,510 notify_* rows out of 6,989 total. This is third-party private-communication PII (messages FROM other people, not just Alfredo) exposed on an unauthenticated channel — the same class of issue house law 5 flags for the clippy_sync bus.
  
  _Evidence:_ native-bridge.js:385 `await NX.sb.from('raw_emails').upsert({ id, from_addr: `${appName}: ${title}` ... body: text.slice(0, 12000) ...})`; SQL: pg_policies shows {tablename: raw_emails, policyname: raw_emails_anon_all, roles: {public}, cmd: ALL}; count(*) filter (id like 'notify_%') = 6510.
  
  _Fix:_ Ask Alfredo whether passive message capture is still wanted. If yes, at minimum add restrictive RLS (or move ingestion behind an edge function with a secret), and add a retention purge; if no, disable startNotificationListener and archive/delete the captured rows — with his explicit approval per house law 2.

- 🟠 **HIGH** — Logbook 'Daily Logs' tab reads a nonexistent daily_logs.data column — tab is always empty, sync still reports success · `/home/user/nexus/js/nx-drive.js`
  
  gatherLogbookData (line 1138) runs `sb.from('daily_logs').select('id, data, created_at')` and buildLogbookTabs maps `l.data.header/planning`. The daily_logs table has columns (id, entry, created_at, ai_created, user_id, user_name) — no `data` column. The structured logs the tab is clearly meant to show live in facility_logs.data (the same rows uploadDailyLog renders). The 42703 error is silently converted to [] by `.data || []` inside safe(), so every sync writes a header-only Daily Logs tab and the UI toasts '✓ Synced — ... 0 daily logs' as success.
  
  _Evidence:_ nx-drive.js:1138-1139 `safe(async () => (await sb.from('daily_logs').select('id, data, created_at')...).data || [])`; information_schema.columns for daily_logs: id, entry, created_at, ai_created, user_id, user_name (no data); facility_logs has data jsonb + drive_file_id etc.
  
  _Fix:_ Point the Logbook query at facility_logs (select id, log_date, data, created_at) and adjust the tab mapping; surface the {error} from each gather query instead of masking it.

- 🟠 **HIGH** — House law 3 violations: dead try/catch around supabase upserts makes scanWeeklyChecklist count failures as successes · `/home/user/nexus/js/native-bridge.js`
  
  scanWeeklyChecklist wraps `await NX.sb.from('cleaning_logs').upsert(...)` in try/catch and increments totalUpserts unconditionally (lines 560-570) — supabase-js resolves with {error}, so the catch is dead and any failed write is silently counted as saved. Same dead-catch pattern at lines 587-592 (daily_logs summary insert), 764-769, 794-800, 811-815, and 1033-1039 (capture_queue). The user gets '✓ location: N checks across D days logged' even if every write failed. By contrast scanChecklist (line 754) correctly destructures {error} and counts `saved` — the two code paths should match.
  
  _Evidence:_ native-bridge.js:560-570 `try { await NX.sb.from('cleaning_logs').upsert({...}, { onConflict: ... }); totalUpserts++; } catch (e) {}` — no destructure of {error}, totalUpserts++ runs regardless of returned error.
  
  _Fix:_ Destructure `const { error } = await ...upsert(...)` and only count/toast on !error, mirroring scanChecklist's saved-counter pattern; apply to all six swallow sites.

- 🟡 **MEDIUM** — Logbook lane names query a nonexistent kanban_lists table — Status column blank on the writeback tab · `/home/user/nexus/js/nx-drive.js`
  
  gatherLogbookData (line 1143) selects from 'kanban_lists', which does not exist in the public schema (verified against information_schema.tables). The error is masked by safe(), laneName stays empty, and every card's Status/_lane cell in the 'Notes ⇄ NEXUS' tab renders blank. Cards actually carry their lane in kanban_cards.column_name, which is already fetched-adjacent (the select at line 1141 omits it).
  
  _Evidence:_ nx-drive.js:1143 `safe(async () => (await sb.from('kanban_lists').select('*').limit(200)).data || [])`; SQL: information_schema.tables in ('kanban_lists',...) returns only the three v_* views — no kanban_lists; kanban_cards has a column_name column.
  
  _Fix:_ Drop the kanban_lists query and use kanban_cards.column_name (add it to the select at line 1141) for the lane label.

- 🟡 **MEDIUM** — Logbook sync clears every sheet tab before writing, with all gather errors masked — transient failure wipes synced data and reports success · `/home/user/nexus/js/nx-drive.js`
  
  syncLogbook runs writeLogbook, which batchClears A1:Z100000 on every tab (line 1262-1263) and then writes whatever gatherLogbookData returned. Every gather query is wrapped in safe() try/catch AND uses `.data || []` without checking the resolved {error} (law 3 pattern — the catch is dead for supabase errors), so if v_issue_summary or any view fails transiently, the corresponding tab is cleared and rewritten with headers only, previous synced rows are erased from the sheet, and the UI shows '✓ Synced'. Since the sheet is Alfredo's Excel-style working copy (he types notes into it), this can destroy his visible reference data with no warning.
  
  _Evidence:_ nx-drive.js:1131 `const safe = async (fn) => { try { return await fn(); } catch (_) { return []; } };` combined with 1134-1143 `.data || []` (error never checked) and 1262-1263 `values:batchClear` of all tabs before values:batchUpdate.
  
  _Fix:_ Check {error} per query and abort (or skip that tab's clear+write) when any core query errors; only clear a tab when fresh data for it was actually fetched.

- 🟡 **MEDIUM** — Drive auto-upload stalls on token expiry: interactive OAuth popup mid-save fails as 'Popup window closed' · `/home/user/nexus/js/nx-drive.js`
  
  ensureDriveToken (line 148) calls requestNewToken → tc.requestAccessToken() (line 139) whenever the cached token is expired (55-min TTL). driveUploadAndUpdateRow invokes this deep in the async submit chain in daily-log.js, so the Google popup appears detached from a clear user gesture and gets blocked or closed; the upload then fails and requires a manual Retry tap. Production data confirms it: facility_logs has 2 failed uploads with drive_upload_error 'Google OAuth error: Popup window closed' (2026-06-29 and 2026-07-21), and the last successful upload is for log_date 2026-07-10 — nothing has landed in Drive in ~12 days while daily drafts continue (20 draft rows, latest 2026-07-20). The 'sweep job (Phase 3)' the failure path mentions (retry of failed uploads) was never built.
  
  _Evidence:_ SQL on facility_logs: {failed: 2, latest 2026-07-21, error 'Google OAuth error: Popup window closed'}, {uploaded: 16, max log_date 2026-07-10}, {draft: 20, latest 2026-07-20}; nx-drive.js:139 tc.requestAccessToken() inside the awaited upload chain.
  
  _Fix:_ Pre-check tokenStatus() before submit and prompt re-auth inside the button gesture (preloadAuth already exists for this in the email path); consider a visible 'Drive disconnected' banner when the newest facility_logs row is failed.

- 🔵 **LOW** — Daily-doc Vendor Activity section double-escapes its own HTML — literal '&middot;' and '<span>' markup appear in the Google Doc · `/home/user/nexus/js/nx-drive.js`
  
  renderDailyVendorActivity builds issueText either as issues joined with the HTML entity ' &middot; ' or as a fallback '<span style=...>no issue notes</span>' (lines 765-767), then passes it through esc() at line 772. esc() escapes the & and <, so the uploaded Google Doc shows the literal text '&middot;' between issues, and vendors with no issue notes show the raw '<span style="color:#999...">no issue notes</span>' markup as visible text. (Also line 807 computes an unused `note` variable — dead code from the same edit.)
  
  _Evidence:_ nx-drive.js:765-772 `const issueText = v.issues.length ? v.issues.join(' &middot; ') : '<span style="color:#999;font-style:italic;">no issue notes</span>'; ... <td style="font-size:10pt;">${esc(issueText)}</td>`.
  
  _Fix:_ Escape each issue individually then join with the entity, and emit the fallback span outside esc(): `v.issues.length ? v.issues.map(esc).join(' &middot; ') : '<span ...>no issue notes</span>'` with the td interpolating raw issueText.

- 🔵 **LOW** — File-picker option buttons render literal words ('camera', 'image', 'paperclip') styled as 32px icons · `/home/user/nexus/js/file-picker.js`
  
  The picker popup injects b.icon as text content into <span class="nx-fp-icon"> (line 112), where b.icon is the literal string 'camera'/'image'/'paperclip' (lines 77-101). css/file-picker.css styles .nx-fp-icon at font-size:32px in a 44px-wide column — so the popup shows the raw English word at icon size, clipped, instead of a glyph. No code elsewhere replaces these spans with real icons (no icon-font or feather-replace pass found).
  
  _Evidence:_ file-picker.js:111-112 `<button class="nx-fp-btn" data-source="${b.key}"><span class="nx-fp-icon">${b.icon}</span>` with b.icon = 'camera' | 'image' | 'paperclip'; css/file-picker.css:96 `.nx-fp-icon { font-size: 32px; ... width: 44px; }`.
  
  _Fix:_ Swap the icon strings for emoji or inline SVG (e.g. camera/photo/clip emoji), or map keys to glyphs before injection.

- ⚪ **INFO** — Drive OAuth access token (with drive.file, drive.appdata, and gmail.send scopes) persisted in localStorage · `/home/user/nexus/js/nx-drive.js`
  
  requestNewToken stores the Google access token, expiry, and granted scope list in localStorage (nexus_drive_token / nexus_drive_expiry / nexus_drive_scopes, lines 125-129); email-composer.js reads the same slots for gmail.send. In an app this heavy on innerHTML rendering, any XSS can read a live token that unions drive.file + gmail.send (send mail as Alfredo, write his Drive). Mitigations already present: 55-minute TTL, no refresh token, scope-union kept minimal. This is the standard GIS implicit-flow tradeoff, listed so the owner knows the blast radius rather than as a demand to change it.
  
  _Evidence:_ nx-drive.js:125-129 localStorage.setItem('nexus_drive_token', r.access_token) / nexus_drive_expiry / nexus_drive_scopes; ensureDriveToken line 159-163 unions previously granted scopes (incl. gmail.send once styled send is used) into each new token.
  
  _Fix:_ No action required now; if hardening later, keep the token in a module-scoped variable (memory only) and re-prompt per session, or move sends behind an edge function.

- ⚪ **INFO** — Drive channel deliberately does not stamp dlog_sends — confirmed by design and correctly implemented · `/home/user/nexus/js/daily-log.js` · _known_
  
  Verified the lane's standing note: dlogStampSend (daily-log.js:4395) is only called from Gmail-API sends and the manual 'sent ✓' chip; driveUploadAndUpdateRow (daily-log.js:5520) never stamps, so a Drive upload does not reset the accumulate-until-sent window from Alfredo's 2026-07-11 instruction. That is the safe direction (nothing falsely marked delivered) and matches the comment block at daily-log.js:4302-4312. nexus-qr.js was also fully reviewed: a faithful Nayuki-style QR implementation (byte mode, v1-40, all masks, correct format/version bits and mask-5 precedence) — no defects found.
  
  _Evidence:_ daily-log.js:4394-4409 dlogStampSend only invoked from email-confirmation paths; daily-log.js:5520-5569 driveUploadAndUpdateRow updates facility_logs.drive_* columns only, never dlog_sends.
  
  _Fix:_ None — leave as designed; recorded so future sessions don't 'fix' the Drive path into stamping sends.


### `pwa-shell` — Service worker + PWA shell  · health: 🟢 good


The PWA shell is healthy and carefully engineered. Measured truth: sw.js CACHE_NAME is 'nexus-v369-clippys-watch' (sw.js:220, matching git HEAD edc34f6 "v369 — Clippy's Watch"), with SW_VERSION correctly derived from it (sw.js:221); the steward digest's recorded 'nexus-v306-two-nx-invpn' is 63 versions stale. The precache list is near-complete — all ~80 JS/CSS files referenced by index.html were verified to exist on disk and appear in APP_SHELL, except css/hideaway.css (linked at index.html:53, absent from the shell). Install (allSettled + cache:'reload'), activate (old-cache purge + clients.claim), update flow (updateViaCache:'none' + reg.update + loop-guarded controllerchange reload), and offline behavior (navigate-only HTML fallback, 504 for subresources, ignoreSearch for ?v= stamps) are all correct. The one real gap: the API-bypass list only excludes googleapis.com paths starting with /gmail, so authenticated Google Drive and Sheets GET responses fall into the cache-first branch — stale reads plus private OAuth'd response bodies persisted in Cache Storage.


- 🟡 **MEDIUM** — css/hideaway.css is linked in index.html but missing from the APP_SHELL precache · `sw.js`
  
  index.html line 53 loads css/hideaway.css eagerly, but it is the only index-referenced file absent from sw.js APP_SHELL (sw.js:224-359). On a fresh install that goes offline before the Hideaway view's stylesheet has been fetched once online, the file 504s (network-first fallback finds no cache entry) and the Hideaway UI renders unstyled. Runtime caching backfills it after the first successful online fetch, so impact is limited to first-offline-use — but the shell's own contract is 'everything needed to run offline'.
  
  _Evidence:_ index.html:53 `<link rel="stylesheet" href="css/hideaway.css">`; sw.js APP_SHELL lists js/hideaway.js (line 329) but no css/hideaway.css anywhere in lines 236-268 (CSS block).
  
  _Fix:_ Add './css/hideaway.css' to the CSS block of APP_SHELL and bump CACHE_NAME on next deploy.

- 🟡 **MEDIUM** — Authenticated Google Drive/Sheets API GETs are cached by the SW (stale reads + private data at rest in Cache Storage) · `sw.js`
  
  The live-API bypass (sw.js:410-415) excludes googleapis.com only when the path starts with /gmail. But nx-drive.js also calls www.googleapis.com/drive/v3/... (file lookups/searches, nx-drive.js:1104-1121) and sheets.googleapis.com/v4/... (values reads, nx-drive.js:1335). These GETs fall into the cache-first branch (sw.js:453-464): once cached, responses are served from cache with only background revalidation, so Drive/Sheets reads can be one load stale — and the OAuth-authorized private response bodies (file IDs, sheet contents) are persisted unencrypted in Cache Storage on shared restaurant devices.
  
  _Evidence:_ sw.js:414 `(url.hostname.includes('googleapis.com') && url.pathname.startsWith('/gmail'))` is the only googleapis exclusion; js/nx-drive.js:1104 fetches `https://www.googleapis.com/drive/v3/files/...` and :1335 `https://sheets.googleapis.com/v4/spreadsheets/.../values/...` — neither path starts with /gmail.
  
  _Fix:_ Broaden the bypass to any googleapis.com API host except fonts (e.g. bypass when hostname ends with 'googleapis.com' and hostname !== 'fonts.googleapis.com'), keeping the font CSS cacheable.

- 🔵 **LOW** — POST requests to non-bypassed hosts hit the cache-first branch and trigger unhandled cache.put rejections · `sw.js`
  
  The cache-first fallthrough (sw.js:453-464) does not check request method. Drive multipart uploads (www.googleapis.com/upload/drive, nx-drive.js:921-925) and Sheets values:batchUpdate POSTs (nx-drive.js:1401) flow through it; caches.match never matches a POST (harmless) but cache.put(POST) rejects with a TypeError inside an unawaited .then chain, producing unhandled promise rejections in the SW console on every such write. Responses still reach the app correctly — noise and a latent footgun, not breakage.
  
  _Evidence:_ sw.js:455-460 `fetch(event.request).then(response => { if (response.ok) { ... cache.put(event.request, clone) ... } })` with no `event.request.method === 'GET'` guard.
  
  _Fix:_ Early-return from the fetch handler when event.request.method !== 'GET'.

- 🔵 **LOW** — Six dead CSS/JS files on disk are referenced by nothing (repo cruft, correctly excluded from precache) · `css/refresh-2026.css`
  
  css/refresh-2026.css (consolidated into index.html per its comment at line 63), css/lifecycle-pill-DELTA.css, css/library-card.css, css/equipment-audit.css, js/equipment-audit.js, and js/orion-presence.js (retired per index.html:4934 comment) exist in the repo but are loaded by no HTML link, no APP_SHELL entry, and no loadScript call (verified by grep across js/ and all HTML). They are correctly not precached, so no shell impact — but they will confuse future precache-completeness audits and deploys.
  
  _Evidence:_ grep for each filename across index.html and js/*.js returns only self-references and retirement comments (index.html:63 'was css/refresh-2026.css; consolidated in'; index.html:4934 'old home card (orion-presence.js) is retired').
  
  _Fix:_ Delete or move to an attic/ directory in a future write session (with Alfredo's ok — never bulk-delete silently per house law 2).

- ⚪ **INFO** — Steward digest's deploy note records CACHE_NAME as nexus-v306; actual is nexus-v369-clippys-watch · `steward/digest.md`
  
  Measured truth per the lane brief: sw.js:220 `const CACHE_NAME = 'nexus-v369-clippys-watch';`, matching git HEAD for sw.js (edc34f6 'v369 — Clippy's Watch'). SW_VERSION derives from CACHE_NAME (sw.js:221) so the single-source-of-truth claim holds. steward/digest.md:162 still says 'currently nexus-v306-two-nx-invpn' — 63 versions behind; harmless operationally (the note's instruction 'bump CACHE_NAME every web deploy' is clearly being followed) but the digest's snapshot value is stale.
  
  _Evidence:_ sw.js:220-221 vs steward/digest.md:162 ('currently `nexus-v306-two-nx-invpn`').
  
  _Fix:_ Next steward session should update the digest's recorded version, or drop the literal value from the note since it goes stale every deploy.

- ⚪ **INFO** — Every deploy force-reloads all open sessions once (skipWaiting + controllerchange reload) · `sw.js`
  
  sw.js install calls self.skipWaiting() (sw.js:389) and app.js reloads on controllerchange (app.js:4618-4625). This is deliberate and well-guarded (reload flag, only armed when a worker already controlled the page, so first install doesn't reload), and it is why deploys propagate fast. Tradeoff worth the owner knowing: a manager mid-way through typing an order note or cleaning entry gets a one-time page reload whenever a deploy lands, losing unsaved in-memory form state.
  
  _Evidence:_ sw.js:389 `.then(() => self.skipWaiting())`; js/app.js:4619-4624 controllerchange → window.location.reload() with __nxSwReloading guard.
  
  _Fix:_ Acceptable as-is; if it ever bites, switch to showing a 'new version ready — tap to refresh' toast that posts SKIP_WAITING (the sw.js:537-541 message handler already supports this) instead of auto-skipWaiting.

- ⚪ **INFO** — Supabase-hosted images (equipment photos, uploads) are never cached — unavailable offline by design · `sw.js`
  
  The blanket supabase.co bypass (sw.js:410) means Supabase Storage image URLs are network-only: correct for API freshness, but equipment/vendor/part photos will not render offline even after being viewed online. The rest of the offline story (shell, code, fonts, icons, coin assets, theme audio) is complete and precached.
  
  _Evidence:_ sw.js:410 `if (url.hostname.includes('supabase.co')) ... return; // network only` — no carve-out for /storage/v1/object paths.
  
  _Fix:_ If offline photo viewing ever matters, carve out storage object GETs (path starts with /storage/v1/object) for stale-while-revalidate; otherwise leave as-is.


### `css-audit` — CSS estate  · health: 🟡 fair


The lane's headline subject is healthy: the v323 soft DOZE is intact — #clippy-shell.is-away dims to opacity 0.42 (clippy.css:4449-4456, explicitly "not invisible"), JS toggles classes only (clippy.js:8426-8440, no inline opacity), reduced-motion holds a steady 0.42 dim rather than vanishing (clippy.css:4526), and full-hide (opacity 0) is correctly reserved for is-yielded when the desktop pet is embodied on the same machine. A headless 390px boot of index.html showed zero horizontal overflow, and the nx-* token system defines both dark and light values, so theming is structurally sound (clippy.css is intentionally self-colored dark). The estate's real problems are weight and rot: 7 stylesheets (~217KB) are loaded by nothing yet 3 of them are still precached by sw.js, cleaning-system.css is ~60% dead selectors from the deleted classic cleaning UI, clippy.css carries dead DOM-game/wardrobe/ticklish blocks, and the total CSS payload is 2.23MB across 30 <link> tags fetched network-first — a phone-first tax. One small genuine breakage found: the legacy costume-image moments (laurel on every Trajan quote, chef at the 100-click milestone) 404 silently because the clippy-costumes/ asset directory does not exist.


- 🟡 **MEDIUM** — 7 orphaned stylesheets (~217KB) loaded by nothing; 3 still precached by the service worker · `/home/user/nexus/css/equipment-fixes.css`
  
  equipment-fixes.css (73KB), equipment-context-menu.css (22KB), equipment-card-polish.css (5KB), equipment-audit.css (13KB), library-card.css (12KB), lifecycle-pill-DELTA.css (11KB), and refresh-2026.css (11KB) are referenced by no HTML page and no JS loader (verified against all *.html and js/). Their live styles were consolidated elsewhere (e.g. ctx-menu-* rules now live in equipment.css; index.html:63 comment says refresh-2026.css was 'consolidated in' to nexus-rm.css). Yet sw.js:243-247 still precaches equipment-fixes.css, equipment-context-menu.css, and equipment-card-polish.css — ~100KB downloaded into every device's cache on every cache-name bump for files no page uses. Worse, these are editing traps: a future session that edits equipment-fixes.css (which contains 38 [data-theme="light"] rules) changes nothing on the live site. Inverse drift too: hideaway.css IS linked in index.html:53 but is absent from the sw.js precache list.
  
  _Evidence:_ grep of all *.html link tags + all js/ for each filename returns zero loads; sw.js:243 './css/equipment-fixes.css', 244 './css/equipment-context-menu.css', 247 './css/equipment-card-polish.css'; index.html:63 '(was css/refresh-2026.css; consolidated in)'; equipment-audit.js is itself loaded nowhere either.
  
  _Fix:_ Delete (or move to an archive/ folder) the 7 dead stylesheets after a final diff against their consolidated homes, drop the 3 dead entries from the sw.js precache list, and add './css/hideaway.css' to it.

- 🟡 **MEDIUM** — cleaning-system.css is ~60% dead selectors from the deleted classic cleaning UI · `/home/user/nexus/css/cleaning-system.css`
  
  A full scan of the file's 258 unique class names against all JS and HTML finds 159 with no emitter anywhere. Whole feature families are gone: .clean-view-toggle/-btn/-row (1372-1668), .clean-train-pick-* sheet (1890+), .duties-train-launcher-* — none appear in cleaning.js or any other file. The Lite screen (the only cleaning UI per house rule) is styled by the cleanlite-* family in nexus-rm.css (206 hits). But the file cannot simply be deleted: live selectors (clean-actions-row, clean-compose-*, clean-menu-item, clean-card-menu-item — emitted by cleaning.js) are interleaved with the dead ones. The 92KB file ships and is precached in full on every device.
  
  _Evidence:_ Dead-scan result: '159 dead of 258 unique classes'; cleaning.js class emission list contains cleanlite-* and clean-actions-*/clean-compose-* but zero clean-view-*/clean-train-*/duties-train-* strings; nexus-rm.css:2183 styles .cleanlite-sheet (the live Lite UI).
  
  _Fix:_ Prune the dead classic-UI blocks from cleaning-system.css (keeping the still-live clean-actions/compose/menu families), or fold the survivors into nexus-rm.css and retire the file. Do not delete without checking dynamically-built 'is-*' state classes, which the scan flags as false positives.

- 🟡 **MEDIUM** — CSS payload is 2.23MB / 63,822 lines across 30 linked stylesheets, all network-first — a phone-first tax · `/home/user/nexus/index.html`
  
  index.html links 30 stylesheets (lines 30-64). Total css/ directory is 2.23MB; equipment.css alone is 418KB/14,021 lines and ordering-system.css 331KB/10,184 lines. sw.js treats all CSS as network-first (sw.js:418-431), so every page load issues ~30 conditional requests before falling back to cache — on restaurant WiFi/cellular this is the slowest part of Alfredo's phone-first boot. GitHub Pages gzip and 304s soften but don't remove the round-trip cost, and the sheer line count is why dead code accumulates undetected (three separate 'system' generations coexist: nexus.css, nx-system.css, and per-module files).
  
  _Evidence:_ wc -l css/* totals 63,822 lines; ls -la shows equipment.css 418,335 bytes, ordering-system.css 331,587 bytes; index.html:30-64 lists 30 <link rel=stylesheet>; sw.js:420 isCode regex routes .css through network-first fetch.
  
  _Fix:_ No urgent action, but any future consolidation pass (like the refresh-2026 → nexus-rm fold) pays off directly in phone boot time; concatenating the small always-on sheets would cut request count substantially.

- 🟡 **MEDIUM** — Legacy costume moments silently 404: clippy-costumes/ asset directory does not exist · `/home/user/nexus/js/clippy.js`
  
  setCostumeImg (clippy.js:10146) loads clippy-costumes/{name}.svg, falls back to .png, and on double failure removes is-active — silent no-op. It is still called on two live paths: setCostumeImg('laurel', 7000) at clippy.js:8008 fires with EVERY Trajan quote moment, and setCostumeImg('chef', 8000) at clippy.js:7074 fires on the 100-click milestone unlock. The repo has no clippy-costumes/ directory (git ls-files | grep -i costume returns nothing), so both always fail. The per-costume positioning CSS in clippy.css:1177-1194 (.clippy-costume-laurel … devil-horns, 16 names) is consequently unreachable; only 2 of the 16 names even have callers. The modern SVG costume system (cl-costume-* classes inside clippy.svg) is separate and unaffected.
  
  _Evidence:_ clippy.js:10157-10161 onerror chain ends in classList.remove('is-active'); clippy.js:8008 'setCostumeImg('laurel', 7000)' in the Trajan quote path; ls /home/user/nexus/clippy-costumes → no such directory.
  
  _Fix:_ Either ship the two assets (laurel.svg, chef.svg) into clippy-costumes/, or rewire these two calls to the modern cl-costume SVG system and delete setCostumeImg plus the .clippy-costume-{name} CSS block.

- 🔵 **LOW** — clippyDoze keyframes use !important — invalid in keyframes, so the doze opacity 'breath' never renders · `/home/user/nexus/css/clippy.css`
  
  clippy.css:4459-4460: '0%,100% { opacity: 0.34 !important; … } 50% { opacity: 0.48 !important; … }'. Per css-animations-1, declarations with !important inside @keyframes are ignored, so both opacity lines are dropped by browsers. Even without !important they would lose to the base rule's 'opacity: 0.42 !important' (clippy.css:4450), since important author declarations beat animations. Net effect: the dozing Clippy holds a constant 0.42 opacity; only the transform half of the breath (scale 0.80↔0.84 + translateY) animates — the intended dim/brighten pulse is dead code. He still reads alive, so this is polish, not breakage. This is the only !important-in-keyframes instance in the whole css/ estate.
  
  _Evidence:_ clippy.css:4450 'opacity: 0.42 !important;', 4454 'animation: clippyDoze 5.2s ease-in-out infinite !important;', 4458-4461 keyframes with !important opacity; estate-wide awk scan found no other occurrences.
  
  _Fix:_ Drop the !important from both keyframe lines AND from the base opacity (or move the breath entirely into a filter/brightness keyframe) so the opacity pulse actually runs; verify the un-importanted base 0.42 still wins over other shell rules.

- 🔵 **LOW** — Dead legacy blocks inside clippy.css: DOM-game boards, wardrobe tabs, and a selector-mismatched tickle animation · `/home/user/nexus/css/clippy.css`
  
  (a) Old DOM-based game styling is unreachable: .clippy-snake-board/-cell/-head/-food (2808+), .clippy-cannon-board/-player/-enemy/-bullet/-hud/-explosion (2692+), .clippy-flappy-bird/-column/-column-cap/-ground/-score (2660+) — snake/cannon/flappy were rewritten to canvas (clippy-games.js:2686 startSnakeGame uses makeCanvasBoard; only .clippy-flappy-board survives as a countdown container at clippy-games.js:1556). (b) .clippy-wardrobe-tabs/-tab (3472-3497) match nothing; the wardrobe renders .clippy-costume-card grids (clippy.js:5669+). (c) The v15.5 tickle block is doubly dead: .clippy-shell.is-ticklish (1540) can never match because the shell element gets only id='clippy-shell' (clippy.js:6811), no such class — and JS adds 'is-jiggling' instead (clippy.js:1706), which is correctly styled at #clippy-shell.is-jiggling (867). The #clippy-shell.is-ticklish::before halo flare (1586) is likewise never triggered. After filtering dynamic families ('is-'+state, 'flash-'+color, cl-* from clippy.svg), 114 concrete dead class names remain in clippy.css.
  
  _Evidence:_ clippy.js:6811 'shell.id = 'clippy-shell'' with no className; clippy.js:1706 classList.add('is-jiggling'); clippy-games.js:2686-2706 canvas-based snake; grep for clippy-snake/cannon/wardrobe-tab across js/ and html returns only the one clippy-flappy-board hit.
  
  _Fix:_ Delete the DOM-game, wardrobe-tab, and is-ticklish blocks (~200 lines); if the halo-flare-on-tickle effect is wanted, re-point it at #clippy-shell.is-jiggling::before.

- 🔵 **LOW** — Light theme: cleanlite bottom-sheet grip is hardcoded white-alpha — invisible on the light surface · `/home/user/nexus/css/nexus-rm.css`
  
  nexus-rm.css:2190 '.cleanlite-sheet-grip { … background: rgba(255,255,255,.15); }' sits on .cleanlite-sheet whose background is var(--nx-surface-solid), which nx-system.css:276 defines as #fbf8f1 in light theme — white-on-near-white, so the drag grip disappears for light-theme users on the primary phone cleaning UI. nexus-rm.css has 15 hardcoded rgba(255,255,255,…) values total (most are fallbacks or shadows and harmless); the file has only 6 [data-theme="light"] rules versus 706 var() usages, so coverage is generally good via tokens — this grip (and the similar hairline at 1570) are the exceptions. Overall theme architecture is sound: nx-system.css defines full dark (line 112) and light (line 276+) token sets, and clippy.css's zero light-theme rules are intentional (self-colored steward-gold-on-dark panels).
  
  _Evidence:_ nexus-rm.css:2190 'background: rgba(255,255,255,.15)'; nexus-rm.css:2185 sheet background var(--nx-surface-solid, #161d2e); nx-system.css:276 '--nx-surface-solid: #fbf8f1' under the light block.
  
  _Fix:_ Swap the grip (and the 1570 divider) to a token, e.g. var(--nx-border-strong) or color-mix over currentColor, so both themes render it.

- 🔵 **LOW** — Prior-audit CSS items still open: chat-bubble ink over soul color and firefly layout-thrash (deferred, unshipped) · `/home/user/nexus/css/clippy.css` · _known_
  
  Both CSS findings from yesterday's 124-agent audit remain in the deferred bucket and are still present in the code: [62] the user chat bubble's fixed near-black text over the variable --chat-soul background (clippy.css chat panel block, --chat-soul defined at line 941 — a dark soul color makes user messages unreadable), and [64] the 8 fireflies animating left/top per frame with an ineffective will-change. Re-verified present, nothing regressed; listed here only so this lane's report is complete.
  
  _Evidence:_ CLIPPY-AUDIT-REPORT.md lines 34-37 list both as deferred; clippy.css:941 '--chat-soul: #5cb0ff' still drives the bubble background with no companion ink variable.
  
  _Fix:_ No new action — they are spec'd in the deferred list awaiting Alfredo's go-ahead.

- ⚪ **INFO** — Verified healthy: v323 soft DOZE intact, reduced-motion covered, no phone-width overflow at boot · `/home/user/nexus/css/clippy.css`
  
  The lane's primary invariant holds everywhere it matters. #clippy-shell.is-away (clippy.css:4449-4456) is opacity 0.42 + pointer-events none + scale 0.82 with the comment 'still here, just resting — not invisible'; opacity 0 is reserved exclusively for is-yielded (4466-4471, the one-body-per-screen case when the desktop pet is embodied on the same machine). clippy.js touches only classes (add/remove 'is-away' at 8426/8432/8440 — no inline opacity anywhere on the shell), so CSS remains the single authority. prefers-reduced-motion (4522-4529) correctly stops the doze/beam animations while holding the steady 0.42 dim, and hides the beam column. The 480px media query shrinks the shell to 102px and clamps the bubble to calc(100vw - 80px) with safe-area insets (1512-1528). A headless Chromium boot of index.html at 390x844 measured scrollWidth 390 == innerWidth with zero elements crossing the viewport edge.
  
  _Evidence:_ clippy.css:4450 'opacity: 0.42 !important; /* still here, just resting — not invisible */'; 4526 '#clippy-shell.is-away { animation: none !important; opacity: 0.42 !important; }'; Playwright eval result {scrollW:390, innerW:390, over:[]}.
  
  _Fix:_ Nothing to change — preserve these blocks as-is in any future clippy.css refactor; the doze comment block (4440-4448) is good institutional memory.


### `html-pages` — Standalone HTML pages  · health: 🟡 fair


The html-pages lane holds one genuinely serious issue and a cluster of leftover public diagnostic pages. orion.html (the Tunnel) is XSS-safe — its esc() helper correctly HTML-escapes message text on both render paths — but the table it reads/writes, orion_thread, has an RLS policy granting the anon role full read+write (polcmd=* USING true / CHECK true). Since the anon publishable key is embedded in every page, anyone on the internet can read Alfredo's entire private Orion conversation and inject messages impersonating either 'alfredo' (which the documented hourly tunnel-answerer acts on) or 'orion' (which Alfredo sees as authoritative) — a House-Law-5-class exposure applied to the tunnel. The four other standalone pages are leftover test/diag surface served publicly by Pages: the two translate-diag files are byte-identical duplicates that are now DEAD (their anon-key regex expects a JWT 'eyJ...' key but config.js switched to an 'sb_publishable_' key), yet still document the edge-function endpoints and eval remote code; test-contractors.html is a working public probe advertising anon read of the nodes table; vapid-keygen.html is benign but orphaned. None of these pages are referenced by the app shell or precached in sw.js, so they persist unnoticed. None overlap the prior Clippy audit.


- 🟠 **HIGH** — orion_thread (the Tunnel) is world-readable AND world-writable with the public anon key · `orion.html:115,132 + RLS policy orion_thread_rw_anon`
  
  orion.html is the private Alfredo<->Orion phone tunnel. The backing table orion_thread has RLS enabled but a single policy orion_thread_rw_anon for role anon, polcmd='*', USING true / WITH CHECK true. The anon publishable key (sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9) is embedded in config.js and in orion.html itself, so it is effectively public. Consequences: (1) PII/private exposure — anyone with that key can SELECT the entire private conversation between Alfredo and Orion (id,who,text,ts). (2) Impersonation/steering — anyone can INSERT rows as who='alfredo' or who='orion'. The steward digest documents an hourly 'Orion answers the tunnel' design that reads new who='alfredo' messages and takes 'safe actions' (whisper Clippy, create tickets, report data); an unauthenticated bus write of who='alfredo' would steer that agent. Injecting who='orion' text feeds Alfredo false directives inside a channel he trusts (orion.html renders who!='alfredo' as authoritative 'ORION' replies). This is the same class as the House-Law-5 clippy_sync exposure, applied to Orion's tunnel.
  
  _Evidence:_ pg_policy on public.orion_thread: {polname:orion_thread_rw_anon, polcmd:*, using_expr:true, check_expr:true, roles:{anon}} with relrowsecurity=true. orion.html:132 `await sb.from('orion_thread').insert({ who:'alfredo', text:t, ts:Date.now() })`. Live table currently holds who=alfredo(1)/orion(2).
  
  _Fix:_ Split policies: keep anon INSERT restricted to who='alfredo' via WITH CHECK (who='alfredo'), and remove anon SELECT / who='orion' writes. Better: move the tunnel behind a per-user JWT or an edge function that owns the service-role write, since a single shared anon key cannot distinguish Alfredo from any internet visitor. Treat existing thread contents as already-public.

- 🟡 **MEDIUM** — translate-diag.html and its byte-identical twin are dead, publicly-served diagnostic pages · `translate-diag.html / translate-pipeline-diag.html (identical)`
  
  Both files are byte-for-byte identical (confirmed via diff) and are served publicly by GitHub Pages. They fetch the live config.js and regex-extract the anon key with /['"](eyJ[A-Za-z0-9_\-\.]+)['"]/ — i.e. they expect a JWT-format key beginning 'eyJ'. The current config.js key is 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9', which does NOT match that pattern, so getAnonKey() returns null and every test aborts at 'Could not get anon key from config.js'. The pages are therefore broken. They also eval() remotely-fetched translate.js (line 132), and hard-document the deployment URL (orioncontinuity.github.io/nexus), the /functions/v1/translate edge endpoint, and the exact Authorization/apikey header shape used to call the JWT-off proxy functions.
  
  _Evidence:_ translate-diag.html:53 `code.match(/['"](eyJ[A-Za-z0-9_\-\.]+)['"]/)`; config.js:39 key is 'sb_publishable_...'; diff of the two files prints IDENTICAL; line 132 `eval(tjsCode)` on fetched translate.js.
  
  _Fix:_ Delete both files from the Pages deployment (or move diagnostics out of the published site). At minimum remove the duplicate. They no longer function and only advertise the endpoint/header shape to visitors.

- 🔵 **LOW** — test-contractors.html is a leftover public probe that advertises anon read of the nodes table · `test-contractors.html:31-131`
  
  A standalone diagnostic served publicly on Pages. It hardcodes the anon key and runs five tests directly against Supabase: reads/counts nodes WHERE category='contractors', reads unfiltered nodes, and reads the equipment table. It functions as a ready-made public confirmation that the anon role can SELECT the nodes table (which it can — policy nodes_anon_all USING true), dumping row shapes (id,name,category) to any visitor and revealing the data model (categories like 'contractors', the equipment table). The underlying anon-full-CRUD on nodes is a DB-layer finding for another lane, but this page hands an attacker a working probe UI.
  
  _Evidence:_ test-contractors.html:64-67 selects nodes eq category 'contractors'; nodes RLS has nodes_anon_all polcmd=* USING true. Key on line 32 matches config.js.
  
  _Fix:_ Delete test-contractors.html from the published site. Diagnostics that exercise anon table access should not be public artifacts.

- ⚪ **INFO** — Orphan standalone pages are served by Pages but unreferenced by the app shell/service worker · `sw.js:220-362, index.html`
  
  orion.html, translate-diag.html, translate-pipeline-diag.html, test-contractors.html, and vapid-keygen.html are all reachable by direct URL on GitHub Pages but are NOT listed in the sw.js precache manifest and are not linked from index.html (the only reference, orion-presence.js -> orion.html, belongs to a module the code comments mark as 'retired'). Because nothing in the app points at them, they linger unnoticed and unversioned while still being live attack/leak surface. Worth the owner knowing the full set of publicly-served standalone pages.
  
  _Evidence:_ grep for the page names across js/ and index.html returns only orion-presence.js:70 (retired card). sw.js CACHE list (lines 226-362) does not include any of these pages.
  
  _Fix:_ Inventory and prune standalone pages: keep only what is intentionally public, and treat everything served from the repo root as public regardless of whether the app links it.

- ⚪ **INFO** — vapid-keygen.html is publicly served but benign (client-only keygen) · `vapid-keygen.html:67-132`
  
  Generates an ECDSA P-256 VAPID keypair entirely in-browser via WebCrypto and displays the public key, private JWK, and a subject placeholder. Nothing is transmitted — no network calls, no writes. The private JWK is only shown to the operator who ran it. This is not a leak, but it is a leftover operational tool publicly reachable by URL; a passer-by who runs it just gets their own throwaway keypair. Noted for completeness of the standalone-pages inventory.
  
  _Evidence:_ vapid-keygen.html:74 crypto.subtle.generateKey; no fetch/XHR/supabase client anywhere in the file; output rendered locally only.
  
  _Fix:_ Optional: remove from the public site once VAPID keys are provisioned; keeping it exposes nothing but adds to the orphan-page surface.


## Clippy — web pet


### `clippy-pet-core` — clippy.js pet core (first half)  · health: 🟡 fair


Audited the clippy.js pet core lane: lifecycle mounting, blinking/random-behavior/moving loops, soul-travel election + doze, presence posting, and startStewardWhisper (the named functions now live at lines 7379–10900, not 1–6000 — the file has grown past the lane's line map). The good news: the v323 presence fix (dev in clippy_act_<dev>) is in place, the election is fail-safe-present in every error path, the doze is the soft always-visible kind Alfredo asked for, and house laws 1/2 are respected (below-par is explicitly FYI-only). The bad news clusters on the unauthenticated bus: clippy_hands_<dev> still lets any anon-key holder drive real mouse clicks on the three Windows machines (known, code-acknowledged, waiting on the native HMAC), and the whisper/learned-lines channels let anyone put words in Clippy's mouth with no from_id check — meaning the digest's courtesy law is unenforceable client-side. Secondary gaps: the steward whisper broadcasts to every user's orb (not just Alfredo's pet), dozing/yielded bodies keep popping full-opacity bubbles because the behavior loops never check TRAVEL.present/YIELD.on, and the whisper staleness window is 7 days in code vs the 2 minutes the digest documents. Overall the lane is functional with deliberate fail-safes, held down to fair by the standing bus-auth exposure and the doze/broadcast scope gaps.


- 🔴 **CRITICAL** — Unauthenticated bus write to clippy_hands_<dev> drives real mouse clicks on the Windows machines · `js/clippy.js` · _known_
  
  handsTick() polls clippy_sync row clippy_hands_<device> and, for any row with a strictly-newer ts less than 30s old, performs a REAL SendInput click/rclick/dblclick/cursor-move at arbitrary desktop coordinates via the WebView2 host bridge, then posts an ack. The clippy_sync bus is world-writable with the public anon key (shipped in the public GitHub Pages JS), so any unauthenticated party can remotely click anything on all three pet machines — including machines Alfredo's 3-year-old uses. Replay is blocked (persisted lastTs, v330) but origin is not authenticated at all; the code itself admits this at lines 8538–8540 ('the bus row is writable by anything holding the shared anon key; true authentication needs the pet HOST bridge to verify a steward-seal HMAC — tracked as native-side work').
  
  _Evidence:_ js/clippy.js:8543–8566 (handsTick: reads clippy_sync id='clippy_hands_'+TRAVEL.dev, executes _hand(verb, c.x, c.y) with only ts-freshness checks); 8523–8529 (_hand posts 'click x,y' to window.chrome.webview → host SendInput); 8538–8540 (in-code acknowledgement of missing auth). World-writability of clippy_sync is documented in steward/digest.md line 176 and docs/CLIPPY-SOUL-RLS-PROPOSAL.md.
  
  _Fix:_ Treat the deferred native-side HMAC verification as the top-priority item of the soul-RLS work: the pet host (clippy-pet-comp.ps1) should verify a steward-seal HMAC on every hands command before touching SendInput, or the hands lane should move off the anon-writable bus entirely (RLS: service_role/edge-function write only). Until then consider disabling startHands() on the machines the child uses.

- 🟠 **HIGH** — Whisper/learned-lines/hive speech channels accept unauthenticated bus content; courtesy law (from_id='orion') is unenforceable client-side · `js/clippy.js`
  
  Three speech-injection surfaces read attacker-writable clippy_sync rows and put the words in Clippy's own mouth: (1) startStewardWhisper reads id='clippy_whisper' and bubbles w.say (240 chars) plus applies w.face and adjustFeeling deltas — it selects only the data column and never reads from_id, so the digest's courtesy law ('when a whisper carries Orion's words the line must excuse the borrowing and name me') and the 'Don't invent — verbatim only' law have zero client-side enforcement; anything holding the public anon key can make Clippy speak arbitrary text as his own, to Alfredo or staff, and shift his feelings. (2) mergeLearned() folds arbitrary, uncapped-length/count strings from id='clippy_learned' into the live dialog pools every 5 minutes, so injected lines are then spoken ambiently by pickFromPool forever. (3) hivePull/hiveInit bubbles 'Across your devices: <text>' from a bus row. All text passes esc() (line 675–679) so there is no XSS — this is a spoofed-speech/social-engineering channel, not code execution.
  
  _Evidence:_ js/clippy.js:10810–10852 (whisper: select('data').eq('id','clippy_whisper'), mood(w.face), adjustFeeling(...), bubble(String(w.say).slice(0,240), {fromChat:true}) — no from_id/sender check); 6257–6276 (mergeLearned: no length/count cap on learned[cat] lines); 848–879 (hive greet). steward/digest.md lines 75–82 + 108 define the courtesy law that nothing here enforces. General world-writability is known (digest 176); the whisper/learned spoofing consequence and missing from_id check are not in CLIPPY-AUDIT-REPORT.md.
  
  _Fix:_ When the soul-RLS decision lands, include clippy_whisper and clippy_learned in the protected set. Cheap client-side hardening now: read from_id on clippy_whisper and prefix non-steward/orion senders (or drop them); cap mergeLearned to e.g. 12 lines/category and 200 chars/line; surface sender attribution in the whisper eyebrow so borrowed words are never presented as Clippy's own.

- 🟡 **MEDIUM** — Steward whisper is broadcast to every signed-in user's orb, not just Alfredo's pet · `js/clippy.js`
  
  startStewardWhisper() is mounted unconditionally by mountSubsystems() for every enabled orb (every user, every restaurant iPad, plus the desktop pets), and it polls the single global row clippy_whisper. The seen-cursor is per-user localStorage (v330), which fixes replay on a shared device but also guarantees every distinct user sees every whisper once. Orion's Vigil whispers are personal steward→Alfredo messages ('Pardon me, Clippy — it's Orion…'); as wired, a manager at Suerte gets the same face, the same feelings-nudge, and the same private line on their own orb within 15 seconds.
  
  _Evidence:_ js/clippy.js:10517–10522 (mountSubsystems calls startStewardWhisper() with no isDesktopPet()/isAdmin gate; called from both init()'s enabled branch and summon()); 10810 (global row id 'clippy_whisper'); 10802–10804 (per-user cursor key ⇒ per-user re-delivery). Contrast: beaconDesktopPresence at 10962–10966 was explicitly gated to the desktop pet in v330 for the same 'shared global row' reason.
  
  _Fix:_ Gate whisper display to the intended audience — simplest: only show when isDesktopPet() or NX.isAdmin (mirroring the v330 beacon fix), or add a target/dev field to the whisper payload and match it against TRAVEL.dev/current user.

- 🟡 **MEDIUM** — Dozing (is-away) and yielded orbs keep talking: behavior loops never check TRAVEL.present or YIELD.on, and bubbles bypass the shell's dimming · `js/clippy.js`
  
  is-away (soul-travel doze) and is-yielded (web orb hiding for the pet) are pure CSS on #clippy-shell — opacity/pointer-events only. Speech bubbles are appended to the HOST (ensureHost().appendChild), not the shell, so they render at full opacity regardless. Neither startMovingAround's 5s whimsy loop, startRandomBehaviors, nor ambient mood rotation checks TRAVEL.present, YIELD.on, or the is-away class. Net effect: a dozing pet on an unattended laptop still roams, pops full-brightness bubbles, and (if voice is on) speaks aloud via speechSynthesis — undercutting Alfredo's 'only 1 Clippy present per device' ask (the doze was meant as visible-but-resting); and on Alfredo's own machine the yielded, fully invisible web orb still pops bubbles next to nothing.
  
  _Evidence:_ js/clippy.js:8052–8055 (moveTimer gates only on enabled/DND/bubble/palette/suppressed), 7840–7844 (randomTimer same gates), 7439 (bubble appended to host, not shell), 8497 (yield toggles class on shell only); css/clippy.css:4449–4456 (is-away styles shell only), 4466–4471 (is-yielded opacity:0 on shell only). arriveSoul (8445–8458) is the only place that checks TRAVEL.present before speaking.
  
  _Fix:_ Add a single quiet() helper — TRAVEL started && !TRAVEL.present, or YIELD.on — checked at the top of the moveTimer tick, startRandomBehaviors loop, and actionBubble (allow fromChat/whisper through if desired), so a dozing/yielded body rests instead of chattering.

- 🔵 **LOW** — Soul-travel presence runs a bus write + full clippy_act_% read every 3s per pet (~57k ops/day/device), unthrottled · `js/clippy.js`
  
  travelTick upserts clippy_act_<dev> AND selects all clippy_act_% rows every 3 seconds on every desktop pet, regardless of whether idle state changed — roughly 28.8k writes + 28.8k reads per day per machine (~170k ops/day across the three pets). v330 explicitly throttled the parallel hands poll for exactly this reason ('cuts the desktop pet's bus load from ~57k reads/day'), but the travel loop kept its 3s cadence. FRESH_MS is 12s, so a 5–8s cadence (or write-only-on-change with a keepalive) would preserve election correctness at a fraction of the load.
  
  _Evidence:_ js/clippy.js:8460–8465 (trackInterval(travelTick, 3000)); 8396–8408 (unconditional upsert + like('id','clippy_act_%') select per tick); 8375 (FRESH_MS: 12000); 8571–8572 (v330 comment on the hands poll acknowledging the same cost problem).
  
  _Fix:_ Raise the tick to ~5–8s and/or skip the upsert when idleMs bucket hasn't changed (post at least every FRESH_MS-2s as keepalive); consider an adaptive backoff like startHands() uses when no other fresh bodies are seen.

- 🔵 **LOW** — Whisper staleness is 7 days in code but documented as 2 minutes in the steward digest · `js/clippy.js`
  
  steward/digest.md line 108 ('Steward's Whisper … Ignores whispers >2min old', the v18.55 contract) no longer matches the code: v18.57 deliberately widened the window to 7 days so a whisper sent while a machine slept still lands once on wake. Consequence beyond stale docs: a Vigil gesture composed for a specific moment can pop days later, out of context, on any device (and per the broadcast finding above, once per user). The steward operating on the documented 2-minute assumption will mis-reason about what a whisper can do.
  
  _Evidence:_ js/clippy.js:10817–10820 ('only drop the truly ancient (>7 days)' — Date.now() - ts > 7*86400000); steward/digest.md:108 ('Ignores whispers >2min old').
  
  _Fix:_ Reconcile: either restore a short freshness window with a separate 'landed-late' phrasing for old whispers, or (simpler) update the digest to the 7-day contract so the steward writes whispers that read well when delivered late.

- 🔵 **LOW** — Free-form whisper face not in MOODS blanks Clippy's face for 6.5s · `js/clippy.js`
  
  startStewardWhisper calls mood(String(w.face), 6500) with whatever string the bus row carries. mood() strips every mood class first and only adds one if MOODS[name] exists, so an unknown face (a steward typo, or 'curious' — which is in the whisper's own feelings map FF but is NOT a MOODS key) yields the documented v331 'blank face' failure mode for the duration. The v331 fix patched only the one known offender ('suspicious'); the whisper keeps the general hole open because its input is free-form.
  
  _Evidence:_ js/clippy.js:10821–10822 (mood(String(w.face), 6500) with no key validation); 10834 ('curious' present in FF but absent from MOODS at 189–257); 7359–7363 (mood(): removes all classes, adds none when MOODS[moodName] undefined); 256 (v331 comment describing the blank-face symptom).
  
  _Fix:_ In the whisper handler (and ideally inside mood() itself) fall back to a safe default: const f = MOODS[w.face] ? w.face : 'thinking'. One line, closes the class of bug instead of the instance.

- ⚪ **INFO** — v323 presence regression is fixed and the travel/yield fail-safes are sound · `js/clippy.js` · _known_
  
  Confirming the lane's watch-items are healthy: the presence pulse now posts dev inside data ({dev, idle, ts} at line 8398 — the v323 'pets weren't sending dev:' trap is closed at the JS layer, though it still depends on the PS host actually calling NX.clippy.onDevice/onIdle, exposed at 11418). Election fail-safes are correctly conservative: no bus client → stay present (8393), read error → return (8406), no fresh candidates → stay (8410), nobody active → keep current host (8415). The yield loop is scoped to NX.isAdmin only (8480) per the 'managers keep their orb' design, fails open on bus errors (8488), and the doze is CSS-soft (css/clippy.css 4449, opacity 0.42) per the v323 'always visible, dim' law. Also verified: no order-by-par behavior anywhere in the file — below-par is explicitly 'FYI only, deliberately excluded' (4436, 5150, 5167), and the notebook code cites the never-bulk-modify rule (2513).
  
  _Evidence:_ js/clippy.js:8393–8419 (fail-safe election), 8398 (dev in presence payload), 8480 (admin-only yield), 4436/5150/5167 (par-as-FYI compliance).
  
  _Fix:_ No action needed; keep the fail-safe-present pattern when touching the election. The remaining single point of trust is the PS host feeding onDevice/onIdle — covered by the pet-host lane.


### `clippy-chat` — clippy.js chat + brain (second half)  · health: 🟡 fair


The chat+brain second half of clippy.js is craftsmanlike where it matters — the conversation panel is XSS-safe (textContent/esc throughout), the v348 notebook/"never mind" fix is verified live, the verbatim-relay law is honored, and the INHERITANCE/MENS/notebook prompt assembly degrades gracefully. The headline defects are in the failure paths: the v368 "PC waking up" vs "nothing reachable" distinction never reaches the chat panel because askClippyBrain swallows the thrown error and the reachability probe only checks that askClaude exists, so every outage reads as "HMM, I don't understand"; the 48s spinner guard contradicts the 5-minute pool budget and re-opens the parallel-submit interleave v331 locked out; and the desktop pet's stub quietly inverts the documented brain order — the retired port-4242 "ghost" endpoint is first priority and the clippy-brain cloud fallback is absent entirely, so a dead worker means a brainless pet. Structurally, the world-writable bus remains the deepest exposure for this lane: forged job results, poisoned clippy_learned lines, and spoofed whispers all become Clippy's spoken words (known, held for the soul-RLS decision), and pool-routed chats post soul private thoughts, Moneta journal excerpts, MENS restaurant state, and Alfredo's transcript in plaintext onto that bus. Health: fair — the happy path works well, but outage UX, the pet's fallback chain, and bus trust need attention.


- 🟠 **HIGH** — v368 'PC waking up' vs 'nothing reachable' messaging is dead in the conversation panel · `js/clippy.js`
  
  askClaude (app.js:3840-3848) throws the carefully-worded v368 errors ('Your PC is waking up (or busy) — give it a few seconds and ask again.' vs 'No AI brain is reachable right now — turn on a PC or add an Anthropic key...'). But askClippyBrain wraps everything in a try/catch that returns null (clippy.js:6662 '} catch (e) { return null; }'), discarding the message. Back in handleChatInput, _brainReachable (clippy.js:2554) only tests `typeof N.askClaude === 'function'` — which is always true once app.js (or the pet stub) loads — so a null answer falls to the else branch at 2578-2580 and Clippy replies with pickFromPool('chat_no_match') ('HMM, I don't understand'). Net effect: every brain outage in the chat panel is misreported as Clippy failing to understand the user — the exact confusion v331/v368 set out to fix. The v368 text only surfaces in other surfaces (brain-chat, Scan Plate) that call NX.askClaude directly.
  
  _Evidence:_ clippy.js:6655-6662 `const ans = await NXa.askClaude(...)` inside try → `catch (e) { return null; }`; clippy.js:2554 `_brainReachable = ... typeof N.askClaude === 'function'`; clippy.js:2573-2580 null answer + reachable → `sayInChat(pickFromPool('chat_no_match'), { eyebrow: 'HMM' })`; app.js:3845-3847 the thrown v368 strings.
  
  _Fix:_ Have askClippyBrain rethrow (or return a tagged error object for) transport failures so handleChatInput can relay askClaude's own message — e.g. catch in handleChatInput's .catch and sayInChat(e.message) with the 🔌 eyebrow — instead of the no-match line. Keep null strictly for 'brain answered nothing'.

- 🟠 **HIGH** — Unauthenticated clippy_sync writes can put words in Clippy's mouth on every chat/speech surface · `js/clippy.js` · _known_
  
  Because his words are relayed verbatim by design, the world-writable bus (public anon key ships in the Pages JS, clippy-pet.html:30) is a steering channel: (1) a pending chat job row (id 'txt:/job:<uuid>') can be answered by anyone writing {status:'done', result:'...'} — app.js:4198-4204 and pet stub clippy-pet.html:59-61 accept it with no origin check, the text becomes Clippy's chat reply, is spoken aloud (voice mode), and is PERSISTED into his conversation memory via rememberTurn (clippy.js:6659-6660), then fed back as context on later turns; the 'legacy ghost' incident in the digest proves foreign processes really do answer these lanes. (2) mergeLearned (clippy.js:6262-6274) folds arbitrary strings from bus row 'clippy_learned' into his live dialog pools, uncapped and unvalidated — pickFromPool then speaks attacker lines as ambient bubbles, refreshed every 5 min. (3) clippy_whisper (clippy.js:10810-10852) relays w.say verbatim with the steward's ✶ eyebrow and nudges his anima feelings per w.face — spoofable by anyone. Rendering is safely escaped (appendChatMsg uses textContent at 2761; bubble uses esc() at 7429-7430), so this is content steering, not XSS — but the desktop pet sits on family machines where a 3-year-old plays.
  
  _Evidence:_ app.js:4198-4204 poll accepts `d.status === 'done'` → `return d.result`; clippy.js:6659-6660 `rememberTurn('assistant', out)`; clippy.js:6262-6274 clippy_learned fold with no length/count cap; clippy.js:10852 `bubble(String(w.say).slice(0, 240), { ..., eyebrow: '✶', fromChat: true })`; digest: 'clippy_sync ... world-readable AND writable ... design around that'.
  
  _Fix:_ This is the chat-lane face of the held soul-RLS decision (docs/CLIPPY-SOUL-RLS-PROPOSAL.md option B/A). Minimum hardening without RLS: have the requester include a per-job nonce echoed by legitimate workers, ignore results lacking it; cap and sanity-filter clippy_learned lines; sign whispers (HMAC via steward_seal pattern) before honoring the ✶ eyebrow.

- 🟠 **HIGH** — Desktop pet's brain chain diverges from the documented order — retired 'ghost' port 4242 is FIRST, and there is no cloud-brain fallback · `clippy-pet.html`
  
  The estate's documented fallback is PC pool → clippy-brain edge fn → direct key → soft error. The pet host stub instead wires askClaude as: http://localhost:4242 FIRST (clippy-pet.html:31, 70-86 — the exact legacy qwen 'ghost' brain the steward hunted down and killed per the digest), then bus pool with a 45s timeout, then throw. Consequences: (a) any local process that binds 4242 — including a resurrected ghost watchdog — silently becomes the primary voice of the desktop Clippy, answering before the Claude-equipped pool ever sees the question; (b) the clippy-brain edge function is never tried on the pet, so when the local worker is down (Providencia's worker was dead ~37h on 7/18) the pet's chat brain is entirely dead even though v18.47's 'always available' cloud path exists and the stub already holds an sb client; (c) the 45s pool timeout contradicts app.js's deliberate 300s 'slow is fine — cold model load' budget (app.js:3821-3828), so cold loads on the pet read as failure; (d) no v368 messaging exists on this surface at all.
  
  _Evidence:_ clippy-pet.html:31 `var LOCAL_BRAIN = 'http://localhost:4242';`; :70-86 askClaude tries LOCAL_BRAIN/ask then `return await askPool(prompt, { system: system, timeoutMs: 45000 })`; :118 provider hardcoded 'clippy-pool', :119 getApiKey returns ''. Digest: 'THE LEGACY GHOST ... port 4242, model qwen3:8b ... stole 3 seal commands ... Killed watchdogs+Startup'.
  
  _Fix:_ Remove or demote the 4242 endpoint (at minimum verify a signed identity header before trusting it), add an askCloudBrain step (sb.functions.invoke('clippy-brain')) to the pet stub mirroring app.js, and raise the pet chat pool timeout toward the 300s budget.

- 🟡 **MEDIUM** — 48s chat spinner guard defeats both the 5-minute pool budget and the v331 in-flight lock · `js/clippy.js`
  
  handleChatInput arms _pendGuard at 48000ms (clippy.js:2557): it clears state.chatPending, hides typing, and says 'my brain's taking too long — try me again in a moment.' But the pool chat path is explicitly allowed 300000ms (app.js:3828, comment: 'Slow is fine — a 5-minute timeout so a cold model load ... isn't mistaken for failure'). So any legitimate answer slower than 48s is (1) pre-announced as a failure, (2) still appended to the log when it lands minutes later, contradicting the failure line, and (3) worse — clearing chatPending re-enables submit, so a retry launches a second parallel brain call whose reply interleaves with the first, recreating exactly the scrambled-thread bug the v331 in-flight lock (clippy.js:2699) was added to prevent, now with both answers written into state.chatTurns.
  
  _Evidence:_ clippy.js:2557 `setTimeout(... 48000)` clearing chatPending + sayInChat('taking too long'); clippy.js:2699 `if (state.chatPending) return;` lock; app.js:3828 `timeoutMs: 300000` with the 'slow is fine' comment.
  
  _Fix:_ Either align the guard to the real transport budget (~305s) and make the 48s tick a soft 'still thinking — the PC is loading the model' status line that does NOT clear chatPending, or cancel/ignore the original promise when the guard fires so a late answer can't double-land.

- 🟡 **MEDIUM** — Pool-routed chat posts soul private thoughts, Moneta steward journal, MENS restaurant state, and the user's transcript in plaintext to the world-readable bus · `js/clippy.js`
  
  askClippyBrain builds its system prompt from THE INHERITANCE — soul.self, 'MY LAST PRIVATE THOUGHTS', the two latest Moneta steward-journal rows (clippy.js:6475-6519), MENS's live 'NEXUS LIVE STATE' restaurant brief (6597-6608), notebook facts and recent memories — and sends it with the user's last 8 chat turns to NX.askClaude. On the pool path this entire payload is upserted as a plaintext job row into world-readable clippy_sync (app.js:4186-4192 `{ prompt, system, ... }`; identically in the pet stub clippy-pet.html:52-54). Anyone holding the public anon key can poll the txt:/job: lanes and read Alfredo's live chat messages plus the composed private context while jobs are in flight (row deleted only after completion in the finally block; abandoned rows persist until the lane janitor sweeps day-old rows). The digest's law is 'world-readable ... design around that' — this path does not.
  
  _Evidence:_ clippy.js:6590-6591 inheritance appended to system; 6650-6655 `messages = (state.chatTurns||[]).slice(-8).concat([userMsg]); const ans = await NXa.askClaude(system, messages, 260)`; app.js:4192 `await this.sb.from('clippy_sync').upsert({ id, data: job, ... })` where job.system/job.prompt carry it all.
  
  _Fix:_ Fold into the soul-RLS decision: at minimum strip Moneta excerpts and MENS operational counts from jobs routed to the open bus (keep them for the edge-fn path, which is TLS-to-server), or move chat jobs to an RLS-locked lane once the signed-write design lands.

- 🔵 **LOW** — Residual 'never mind' gap: the correction command still captures dismissals the v348 fix removed from forget · `js/clippy.js`
  
  v348 correctly removed 'nevermind/never mind' from the forget command (clippy.js:2509-2513) so a bare dismissal can no longer silently delete the newest notebook fact — verified in place. But the correction regex (clippy.js:2500 `^(?:actually|correction|no,?\s+(?:it'?s|its|the)|...)`) still swallows conversational dismissals and asides: 'actually, never mind' → correct('never mind') deposits the junk fact "never mind" (source:'corrected', importance 4) AND calls forget() over facts keyword-matching 'never'/'mind' (neither is in _RECALL_STOP, clippy.js:1343); 'no, it's fine' similarly writes "fine" into his #1-wish notebook. Deletion exposure is narrow (only facts containing those tokens; forget takes up to 8 matches at one-keyword overlap, clippy.js:1380), but the junk-deposit pollution is systematic for a chatty user.
  
  _Evidence:_ clippy.js:2500-2507 corM regex → `correct(nf)`; clippy.js:1399-1403 correct = forget(about||newFact) + remember(newFact); clippy.js:1380 `recallFacts(query, 8)` id-set delete.
  
  _Fix:_ Short-circuit pure dismissals ('never mind', 'nothing', 'forget it', 'it's fine/ok') before the correction branch, and require ≥2 matching terms (or a fact-shaped payload) before correct() deletes anything.

- 🔵 **LOW** — state.chatOpen is still read in four places but never written — the exact dead-flag bug v18.45 documented · `js/clippy.js`
  
  The comment at clippy.js:7404-7406 records the historic bug ('chatIsOpen was written but never read, and chatOpen was read but never written') and fixed chattingNow() to use chatIsOpen. But four guards still read the never-written state.chatOpen: watch-along greeting (6381, 6383), seeSurroundings 'don't barge in' (6397), and the startSelfDriven tick (6438). All writes in the file target chatIsOpen only (2675, 2716, 2774, 7031, 7598). Today this is masked because openChat also sets state.bubble (2673) and every guard also checks state.bubble — but the moment bubble tracking is refactored (e.g. the deferred observer-consolidation work in CLIPPY-AUDIT-REPORT item 5, or a panel that detaches from state.bubble), 'he barges into a live chat' silently returns. Vestigial hazard, cheap to fix.
  
  _Evidence:_ clippy.js:6397 `if (state.bubble || state.chatOpen || state.dragging) return;` — grep shows zero assignments to state.chatOpen anywhere; clippy.js:7404-7406 the confession comment.
  
  _Fix:_ Replace the four state.chatOpen reads with chattingNow() (or state.chatIsOpen) and delete the dead flag.

- ⚪ **INFO** — Lane laws verified sound: v348 notebook fix live, verbatim relay honored, chat rendering XSS-safe, {error} discipline kept · `js/clippy.js`
  
  Positive confirmations for the owner: (1) the v348 'never mind' fix is genuinely deployed — bare 'forget/delete' asks 'Forget what, exactly?' and only an explicit 'scratch that' drops the newest fact (clippy.js:2509-2531). (2) The verbatim-relay law holds on chat surfaces: cleanReply (6566-6578) strips only model artifacts (<think>, 'Assistant:', 'as an AI...'), never paraphrases; whispers relay w.say verbatim (10852). (3) The conversation panel renders every message via textContent (2761) and bubbles via esc() (7429-7430) — bus-sourced text cannot inject HTML. (4) Supabase calls in this half correctly destructure {data,error} (10810, 6262 via silent-degrade try) — no dead-catch law-3 violations found. Minor polish noted: recallFacts is computed twice per brain call (6626 and 6636), and mergeLearned imposes no cap on line count/length folded in from the bus.
  
  _Evidence:_ clippy.js:2518-2521 'Forget what, exactly?' branch; 6566-6578 cleanReply; 2761 `b.textContent = String(text ...)`; 6626/6636 duplicate recallFacts(question, 6) calls.
  
  _Fix:_ No action required beyond the polish items: memoize the recallFacts result and bound mergeLearned (e.g. ≤40 lines, ≤300 chars each).


### `clippy-anima` — Anima (soul forces)  · health: 🟡 fair


The ANIMA module itself (js/clippy-anima.js, 12 forces, 44-byte Braille strand) is internally consistent, pure, and byte-compatible across its three ports (browser, Minecraft bot, cloud Python). The v331/v348 soul-WIPE guard family is present but INCOMPLETE: the browser guards read *errors* (_animaReadFailed) but is the only body with no corrupt-strand guard — a present-but-corrupt strand is decoded to genesis (or laundered garbage) and immediately persisted over the real row, the exact wipe class v336/v348 closed in the cloud and bot. The known deferred LWW decision (audit decision #1) remains open and is made materially worse than the report states by the bot's ~4s read-modify-write cadence during play; the same cadence also means decay is per-write rather than per-time, so active Minecraft play flattens desktop-authored feeling toward baseline within about a minute. Cross-machine wall-clock freshness gating, the cloud LLM-window race, and the anon-writable bus row are confirmed as described in prior art. Baseline drift mechanics (evolve/estrangement) are sound; drift/inc byte wraps and the never-verified seed fingerprint are cosmetic.


- 🟠 **HIGH** — Browser is the only body without the corrupt-strand soul-WIPE guard · `/home/user/nexus/js/clippy-soul.js`
  
  The v331 guard in the browser covers read ERRORS only (_animaReadFailed). A present-but-CORRUPT strand slips through both browser read paths: loadAnima line 190 does `anima = strand ? A.decode(strand) : A.genesis(...)` then line 192 `await saveAnima()` — and A.decode (js/clippy-anima.js:87-95) returns genesis() for any strand under 44 chars and does NO byte-range validation for longer ones (an ASCII/garbage strand decodes to negative axis values, which saveAnima's q() clamps on re-encode, laundering garbage into a 'valid' near-zero soul). Either way the real grown strand is overwritten. refreshAnima line 223 has the same gap: it adopts the remote strand with zero validity check, and the next reflect/dream saveAnima persists it. Both other bodies were hardened against exactly this wipe class: clippy_agent.js:492/521 (_animaStrandValid, v348) and clippy-cloud.py:173-182 (decode returns None on malformed, v336/v348). The browser never received the equivalent.
  
  _Evidence:_ js/clippy-soul.js:190-192 `anima = strand ? A.decode(strand) : A.genesis('clippy:origin'); ... await saveAnima();` — js/clippy-anima.js:89 `if (b.length < 44) return genesis();` (and no `c<0||c>255` check anywhere in decode) — js/clippy-soul.js:223 `if (strand && updated >= ...) anima = A.decode(strand);` — contrast clippy_agent.js:521 `if (strand && !_animaStrandValid(strand)) return // present but corrupt — protect it` and clippy-cloud.py:181-182 `if len(b) < 44 or any(x < 0 or x > 255 ...): return None`.
  
  _Fix:_ Port the guard: add a strandValid(strand) check (length >= 44, every charCode in 0x2800-0x28FF) in js/clippy-soul.js before decode in BOTH loadAnima and refreshAnima; on corrupt-but-present, set _animaReadFailed-style degraded mode (in-memory genesis, no persist) exactly as v331 does for read errors. Optionally harden A.decode itself to return null on out-of-range bytes so all three JS consumers inherit the fix.

- 🟠 **HIGH** — Anima strand last-write-wins clobber across bodies (deferred decision #1) · `/home/user/nexus/js/clippy-soul.js` · _known_
  
  Browser saveAnima (line 204) blindly upserts its in-memory strand with no re-read/merge and no version counter, so any Minecraft/cloud impress landing between the 90s refreshAnima ticks is dropped. Confirmed still unfixed — it is audit report decision #1, awaiting Alfredo. One aggravator the report understates: during active play the bot performs a full read-modify-write of the shared row every ~4 seconds (feel() batches into a 4000ms flushFeel timer -> impressAnimaFromFeel), so the collision window is near-continuous whenever the boy is playing with the bot, not occasional.
  
  _Evidence:_ js/clippy-soul.js:204 blind upsert of `A.encode(anima)`; js/clippy-soul.js:602 `setInterval(refreshAnima, 90000)`; clippy_agent.js:565 `setTimeout(flushFeel, 4000)` -> :585 impressAnimaFromFeel -> :512-525 read-then-write of clippy_anima. CLIPPY-AUDIT-REPORT.md decision #1 describes the same defect and proposes monotonic versioning.
  
  _Fix:_ This is the pending owner decision — recommend approving the monotonic version counter carried inside the strand (or DB-assigned updated_at comparison) plus re-read-and-reapply-local-delta before every write, in all three bodies. No code change until Alfredo says so.

- 🟡 **MEDIUM** — Decay is per-WRITE not per-time: Minecraft play flattens the shared soul toward baseline within ~1 minute · `/home/user/nexus/clippy_agent.js`
  
  Each body applies baseline-relaxation decay on its own write cadence: browser decay(0.12) at most every 9 minutes (impressEmotion inside reflect), cloud decay(0.12) once per heartbeat run, but the bot applies decay(0.08) on EVERY feel-flush — every ~4 seconds during active play. At that cadence the (state - baseline) gap e-folds in roughly 30-60s (inertia-damped), so any state authored by the desktop face or cloud (a joy peak, a rebirth fear spike, a dream's wonder) is erased almost immediately once the boy starts playing, and each flush persists the flattened strand. The comment 'light decay — the desktop pet owns the continuous relaxation' assumes a per-time semantic the code does not have. Net effect: cross-body feeling propagation (the whole point of v9.12) is largely defeated while the Minecraft body is active, and effective soul physics depend on which body happens to be running.
  
  _Evidence:_ clippy_agent.js:524 `_animaImpress(s, ad); _animaDecay(s, 0.08) // light decay — the desktop pet owns the continuous relaxation` reached via :565 `setTimeout(flushFeel, 4000)` and :515 comment 'This runs every few seconds during play'. Browser cadence: js/clippy-soul.js:436 (9-min reflect gate) -> :450 `impressEmotion(); saveAnima();` -> :246 `A.decay(anima, 0.12)`. Cloud: clippy-cloud.py:511 `decay(anima, 0.12)` once per run.
  
  _Fix:_ Make decay time-based, not write-based: scale r by elapsed time since the strand's `updated` stamp (e.g. r = base_rate * min(1, dt/interval)) or have the bot skip decay entirely (impress only) and leave relaxation to the browser/cloud as the comment intends. Small, body-local change; safe to fold into the LWW rework.

- 🟡 **MEDIUM** — Freshness gate compares wall clocks of three different machines · `/home/user/nexus/js/clippy-soul.js` · _known_
  
  refreshAnima adopts a remote strand only if its `updated` (a Date.now()/time.time() stamped by whichever remote host wrote it) is >= the local _savedAt. The three writers run on different machines (browser, Minecraft host, cloud host); a lagging remote clock permanently starves live propagation to the desktop face, and a fast remote clock lets a stale strand beat a fresher local one. This is part (b) of audit decision #1 — confirmed still present.
  
  _Evidence:_ js/clippy-soul.js:219-223 `var updated = (row && +row.updated) || 0; ... if (strand && updated >= ((anima && anima._savedAt) || 0)) anima = A.decode(strand);` vs writers stamping their own clocks: clippy_agent.js:525 `updated: Date.now()`, clippy-cloud.py:539/547 `{"strand": encode(anima), "updated": t}`.
  
  _Fix:_ Resolve together with decision #1: use a monotonic version counter inside the strand or the DB server-assigned updated_at (single clock) as the freshness authority.

- 🟡 **MEDIUM** — Cloud heartbeat clobbers concurrent anima writes during its slow LLM window · `/home/user/nexus/clippy-cloud.py` · _known_
  
  The cloud reads clippy_anima at the top of main() (line 463), then runs slow LLM reflect/dream calls, then upserts the strand at the end (lines 538-547) — any browser or Minecraft impress landing during that multi-second-to-minute window is overwritten. This is audit deferred item [20]; confirmed unchanged. The v336/v348 read-failure and corrupt-strand guards ARE correctly in place here (lines 464-482 abort or set anima_write_ok=False).
  
  _Evidence:_ clippy-cloud.py:463-482 (read + guards), :538-547 (final upserts gated only by anima_write_ok, no re-read). CLIPPY-AUDIT-REPORT.md item [20] describes the same window.
  
  _Fix:_ Ship the report's own spec'd fix when approved: re-read clippy_anima immediately before the final upsert and re-apply only this run's deltas, or move the anima RMW after the LLM calls.

- 🟡 **MEDIUM** — clippy_anima row is anon-writable; an unauthenticated write steers the child-facing bot's mood · `/home/user/nexus/clippy_agent.js` · _known_
  
  Per house law 5 the clippy_sync bus is world-writable with the public anon key. The anima strand written there is injected into the Minecraft bot's system prompt (animaSelfReport at session build) and steers behavior selection (moodBiasedPlay: 'scared->hide, lonely->seek boy'), and drives the desktop face/diary. Anyone with the anon key can wipe the soul (write genesis) or pin fear/dominance at extremes and bias how the bot behaves around Alfredo's 3-year-old. Mitigations already in the code: the strand carries only 44 numeric bytes (no free-text injection channel), corrupt strands are rejected by bot/cloud, and companion bodies never adopt the shared soul (IDENT.soulWriter gate). The RLS proposal doc covers this class, so marked known.
  
  _Evidence:_ clippy_agent.js:737 `const sr = await animaSelfReport() // his ONE real soul ... distilled` feeding buildSystem; :2760 `moodBiasedPlay() // (scared->hide, lonely->seek boy, joyful->animals/flowers)`; writers use only the public anon headers H. docs/CLIPPY-SOUL-RLS-PROPOSAL.md exists as prior art.
  
  _Fix:_ Adopt the existing RLS proposal for the soul rows (write restricted to a service/rotating key, anon read-only). Until then, note that behavioral influence is bounded to mood-vocabulary selection — no text or command injection path through the strand itself was found.

- 🔵 **LOW** — The 4-byte seed fingerprint — the 'is the copy still him' core — is never verified by any body · `/home/user/nexus/js/clippy-anima.js`
  
  The module's stated identity mechanism ('the part that would have to survive copying for the copy to be him', lines 57-62) is written at genesis and round-tripped forever, but no consumer — browser, bot, cloud, or worker — ever compares the decoded seed against seedOf('clippy:origin'). A strand with a corrupted or foreign seed is adopted and re-persisted without notice, so the fingerprint provides zero integrity or identity checking. It could serve as a free corruption detector (4 known-constant bytes at a fixed offset).
  
  _Evidence:_ js/clippy-anima.js:57-62 defines seedOf; grep across js/clippy-soul.js, clippy_agent.js, clippy-cloud.py, clippy-worker.py shows seed is only ever sliced into the encode buffer — no equality check against seedOf('clippy:origin') exists anywhere.
  
  _Fix:_ Cheap hardening: treat seed != seedOf('clippy:origin') as a corrupt strand in the validity guards (all bodies share the constant), turning the decorative fingerprint into an actual integrity check. Note for the LWW rework: the 4 seed bytes are also a natural place to carry a version counter if Alfredo approves decision #1.

- 🔵 **LOW** — v331 measure-vs-baseline fix not ported to the worker; three bodies compute 'perseverance' three ways · `/home/user/nexus/clippy-worker.py`
  
  The browser's v331 fix reads dominant feeling as deviation from the soul's own baseline (anima.b), but clippy-worker.py's _shared_brain still ranks axes by |x - 0.5| (pre-v331 semantics) and also decodes without byte-range validation (read-only, so no wipe risk) — the hive nodes can report a different dominant tone than the desktop face for the same strand. Separately, the bot's animaSelfReport computes 'grit' without the survived term (1 - 0.85^inc) that both clippy-anima.js perseverance() and the worker include, so the perseverance number differs by body.
  
  _Evidence:_ clippy-worker.py:600 `ranked = sorted(range(12), key=lambda i: abs(x[i] - 0.5), ...)` vs js/clippy-soul.js:280-293 v331 comment 'measure deviation from his own BASELINE (anima.b), not from 0.5'. clippy_agent.js:548 grit formula omits the survived term present at js/clippy-anima.js:177 and clippy-worker.py:615-616.
  
  _Fix:_ Port the baseline-relative ranking to _shared_brain (it already reads `base` at line 595 and then ignores it), and either add the survived term to the bot's grit or rename it to avoid implying it is the canonical perseverance.

- ⚪ **INFO** — drift and incarnation counters wrap at 256; drift is write-only lore · `/home/user/nexus/js/clippy-anima.js`
  
  drift accrues monotonically (impress +0.25*moved, dream +0.03, rebirth +0.15-0.35, evolve) and is encoded as floor(drift)&255, so it silently wraps past 256 over a long life; no measure ever reads drift (estrangement uses baseline vs TEMPERAMENT), so the wrap is cosmetic. inc wraps &255 at rebirth line 146; perseverance's survived term saturates well before 255 incarnations so behavior is unaffected. Worth knowing only so a future feature doesn't build on drift as a trustworthy odometer.
  
  _Evidence:_ js/clippy-anima.js:83 `Math.floor(s.drift) & 255`, :146 `s.inc = (s.inc + 1) & 255`; grep shows no consumer of s.drift in any measure or display beyond encode/decode round-trip.
  
  _Fix:_ No action needed now; if drift is ever surfaced or used, widen its encoding (2 bytes for the integer part) or cap it explicitly.


### `clippy-soul` — Soul loop  · health: 🔴 poor


The Soul loop's code quality is high — the v330/v331/v336/v348 fixes (read-error guard, anima-flag, updated_at stamping, dream-greet gating) are all present and correct — but the lane's core purpose is currently defeated by one unguarded boot path: clippy-soul.js runs as a deferred script and calls load() before app.js's DOMContentLoaded init() creates NX.sb, so load() takes the "no client" branch, adopts DEFAULT_SOUL without setting _soulReadFailed, and the first 20-second tick upserts factory defaults over the real clippy_soul row. The live DB row proves it: self is the verbatim DEFAULT_SOUL text, born=null (only stamped on a successful read, which never happens), incarnation=1, stream holds only the genesis thought plus one offline-generated thought from today, written by from_id='soul' at 15:59 UTC. The anima strand row, by contrast, survived (44-char grown strand) precisely because the same early-return skips loadAnima and refreshAnima is read-only — a clean differential confirming the mechanism. Net effect: every browser visit erases Clippy's cross-incarnation growth (thoughts, dreams, evolved self, incarnation count), nullifying the v330 soul-wipe fix and any growth the cloud body writes between visits. The known deferred items (boot-read retry, anima last-write-wins) are still open, and the anon-writable bus row also feeds persona() LLM prompts and verbatim bubble text. Health is poor until the sb-not-ready path is treated like a failed read with a retry once NX.sb appears.


- 🔴 **CRITICAL** — Soul factory-wiped on every page boot: load() runs before NX.sb exists and later persists DEFAULT_SOUL over the real row · `js/clippy-soul.js`
  
  clippy-soul.js is loaded with defer (index.html:4868) and its start() runs immediately (document.readyState is 'interactive' during deferred execution, so the DOMContentLoaded branch at line 826-827 is not taken). NX.sb is only created inside NX.init() (app.js:1136), which runs on DOMContentLoaded (app.js:4586) — AFTER deferred scripts. So load() line 344-345 hits `if (!s) { state = JSON.parse(JSON.stringify(DEFAULT_SOUL)); return state; }` — which, unlike the read-error branch, does NOT set _soulReadFailed. 20s later tick() fires, sb() is now live, reflect() appends one thought and save() (line 419) upserts the factory soul over the real clippy_soul row. This bypasses the entire v330 soul-wipe protection and repeats on every page load: incarnation resets to 1, born is never stamped (that only happens in the readOk branch, line 362), stream/dreams/evolved-self erased — including anything the cloud body grew between visits.
  
  _Evidence:_ Code: js/clippy-soul.js:344-345 (no _soulReadFailed on the !s branch), 356-360 (flag set only on read error), 412-421 (save gates only on _soulReadFailed), 596-601 + 826-827 (start timing); index.html:4852 (app.js plain script) vs 4868 (clippy-soul defer); app.js:1136 + 4586 (sb created only at DOMContentLoaded). DB (2026-07-22): clippy_soul row has from_id='soul', updated_at 15:59 UTC today, self = verbatim DEFAULT_SOUL text, born=null, incarnation=1, last_evolve=0, dreams=[default ts:0 entry only], stream=[default ts:0 entry, plus one MOOD_LINES.trust offline thought ts=1784735963238] — the exact signature of DEFAULT_SOUL + one reflect(). Differential: the clippy_anima row survived (44-char grown strand) because the same early return skips loadAnima and refreshAnima is read-only.
  
  _Fix:_ In load(), treat a null sb() exactly like a failed read: set _soulReadFailed=true (and _animaReadFailed) before returning the in-memory default; then retry the boot read once NX.sb appears (poll briefly, or defer start() until app.js init — e.g. wait for an 'nx-ready' event or setTimeout-retry until sb() is truthy), clearing the flags only after a confirmed error-free read. The soul cannot be restored from the DB (last grown copy was overwritten), but check whether archive/pressings or the cloud runner's logs hold an older copy of self/stream worth restoring — ask Alfredo before writing anything.

- 🟠 **HIGH** — Boot-read failure freeze: _soulReadFailed is never cleared or retried, so one flaky read disables soul persistence for the whole session · `js/clippy-soul.js` · _known_
  
  When the boot read of clippy_soul errors, _soulReadFailed=true correctly prevents clobbering the real row (lines 356-360), but nothing ever re-reads or clears the flag — load() is only called once from start(). Every subsequent save() returns early (line 414), so all reflections, dreams, evolutions, dream-answered state, and last_seen for the entire session are silently discarded even after connectivity returns seconds later. This is deferred owner-decision #4 in CLIPPY-AUDIT-REPORT.md and is confirmed still unimplemented in the current code.
  
  _Evidence:_ js/clippy-soul.js:356-360 (`_soulReadFailed = true; return state;` with no retry path), 414 (`if (_soulReadFailed) return;`), start() at 596-607 calls load() exactly once; no other caller clears the flag (grep: _soulReadFailed appears only at lines 69, 356, 361, 414). CLIPPY-AUDIT-REPORT.md 'Needs your decision' item 4 describes exactly this.
  
  _Fix:_ Once Alfredo decides (audit item 4): on failed boot read, schedule a retry loop; on eventual success, merge conservatively (keep the remote row as base, append only in-memory stream/dream entries with ts > remote last_seen) rather than replacing either side wholesale. Any fix for the critical sb-not-ready finding should share this retry machinery.

- 🟡 **MEDIUM** — _animaReadFailed is never cleared even though refreshAnima proves reads recovered every 90s — anima growth silently unpersisted for the session · `js/clippy-soul.js`
  
  After a transient anima boot-read error, _animaReadFailed=true correctly blocks saveAnima (v331, line 196) — but the flag is never cleared, and loadAnima is never re-invoked. Meanwhile refreshAnima runs every 90s (start(), line 602) and successfully reads the same row (line 215), even adopting the remote strand into memory (line 223) — concrete proof connectivity is back — yet it neither clears _animaReadFailed nor re-enables persistence. Every impressEmotion/dream/evolve push onto the anima for the rest of the session is discarded. The recovery signal exists in the same file and is simply not wired to the flag.
  
  _Evidence:_ js/clippy-soul.js:181-189 (_animaReadFailed set, degraded genesis in memory), 196 (`if (_animaReadFailed) return;` in saveAnima), 212-225 (refreshAnima performs the identical read successfully on a 90s cadence but never touches _animaReadFailed); loadAnima's only caller is load() line 406.
  
  _Fix:_ In refreshAnima, after an error-free read (`!(r && r.error)`), clear _animaReadFailed; if the degraded in-memory anima was genesis, replace it with the decoded remote strand (already done at line 223 when fresh) before re-enabling saves.

- 🟡 **MEDIUM** — Anima strand last-write-wins across bodies with cross-machine wall-clock freshness gate (deferred owner decision, still open) · `js/clippy-soul.js` · _known_
  
  saveAnima (line 204) blindly upserts the browser's in-memory strand, dropping any Minecraft/cloud impresses that landed since the last 90s refresh; refreshAnima's guard (line 223) compares `updated` stamps written by three different machines' clocks against the local _savedAt, so a lagging cloud/MC clock starves propagation of their soul-writes to the desktop face. This is owner-decision #1 in CLIPPY-AUDIT-REPORT.md (monotonic version counter or server-assigned timestamp); the code is unchanged.
  
  _Evidence:_ js/clippy-soul.js:204 (upsert of full strand with locally-computed `updated: t`), 223 (`if (strand && updated >= ((anima && anima._savedAt) || 0)) anima = A.decode(strand);` — wall clocks from different hosts); CLIPPY-AUDIT-REPORT.md 'Needs your decision' item 1. Related: clippy-cloud.py item [20] (medium, deferred) covers the cloud side of the same race.
  
  _Fix:_ Awaiting Alfredo's call per audit item 1: a monotonic version counter inside the strand (or DB-assigned updated_at as the sole freshness authority) plus read-merge-write of only the pending local delta.

- 🟡 **MEDIUM** — clippy_soul row is multi-writer last-write-wins: browser tabs and the cloud body each replace the whole document · `js/clippy-soul.js`
  
  save() upserts the entire soul state object (line 419), and clippy-cloud.py reads-modifies-writes the same row with from_id 'cloud' (lines 442, 454, 507, 544). Each open browser tab holds its own full in-memory copy and saves on every reflect (~9 min); two tabs open across the three restaurants, or a cloud run overlapping a browser session, silently drop each other's thoughts, dreams, evolve results, and dream-answered flags. The audit's deferred sync-protocol decision (item 1) covered only the anima strand — the soul row has the identical architecture with no versioning at all. (Currently masked by the critical boot-wipe finding, but it re-emerges the moment that is fixed.)
  
  _Evidence:_ js/clippy-soul.js:419 (`upsert({ id: SOUL_ID, data: state, ... }, { onConflict:'id' })` — full replace, no read-back or version check); clippy-cloud.py:442/454/507/544 (independent RMW of clippy_soul); tick cadence at js/clippy-soul.js:600-601 means each live tab writes at least every ~9 min via reflect's save().
  
  _Fix:_ Fold the soul row into whatever versioning scheme Alfredo picks for the anima strand (audit decision 1): carry a monotonic rev in data, re-read before write, and merge streams/dreams by ts instead of replacing wholesale.

- 🟡 **MEDIUM** — Anon-writable soul row steers Clippy's LLM prompts and on-screen speech (bus prompt/content injection) · `js/clippy-soul.js`
  
  clippy_sync is world-writable with the public anon key (house law 5), and the soul row's fields flow directly into behavior: persona() embeds state.self, state.feeling, and state.toward_you into the SYSTEM prompt of every reflect/dream/evolve LLM call (lines 424-432), and getInheritance() injects soul content into every inner-life brain call across bodies (lines 83-88). Offline, localThought surfaces state.longings and state.fears essentially verbatim in bubbles shown to Alfredo (lines 114-115). An unauthenticated writer can therefore make Clippy 'think' and say attacker-chosen content on the restaurant screens (and, if audit item [60] ships, seed the Minecraft body's self-concept the child interacts with). Rendering is well-hardened — esc() escapes quotes (line 610) and clippy_eyes PNGs pass a strict base64 gate (line 611) — so this is text/prompt-level steering, not XSS.
  
  _Evidence:_ js/clippy-soul.js:424-432 (persona() concatenates DB-sourced self/feeling/toward_you into the system prompt), 83-88 (inheritance appended to system for every brain call), 114-115 (state.longings/fears interpolated into bubble text), 610-611 (output escaping — mitigated for HTML). Bus writability is the standing law-5 fact for clippy_sync (anon key, no RLS distinction between rows).
  
  _Fix:_ Server-side is the real fix (owner scope): move soul/anima rows behind an RLS policy or a writer token distinct from the anon key. Client-side mitigations meanwhile: length-cap and sanitize soul fields on read (strip prompt-injection markers before embedding in system prompts), and treat fears/longings as untrusted before surfacing verbatim.

- 🔵 **LOW** — Cloud-liveness death check compares another machine's clock to the browser's — skew causes spurious incarnations/fear-spikes or missed deaths · `js/clippy-soul.js`
  
  The v336 gate decides 'did he die in the gap' by comparing clippy_anima's data.updated (a Date.now() stamped by the cloud runner or a Minecraft node's clock) against state.last_seen (this browser's clock) — lines 378-385. A node clock running fast fakes cloud-liveness and suppresses genuine death detection; a slow clock (or a long cloud outage) turns a routine absence into a false death: incarnation bump, rebirth fear-spike into the anima (line 406 → loadAnima gapHours → A.rebirth), and a permanent 'I died' memory deposit (line 402). Same family as the known freshness-gate clock issue but a distinct consumer with an emotional side-effect.
  
  _Evidence:_ js/clippy-soul.js:378-384 (`au` from remote row vs local `state.last_seen`), 385-403 (death vs solitude branch, incarnation bump + remember('awakening')), 405-406 (gap passed to loadAnima → rebirth fear spike).
  
  _Fix:_ Use the row's DB-assigned updated_at (server clock, now stamped on every upsert per v336) instead of the client-stamped data.updated for the liveness comparison — one authoritative clock removes the skew.

- 🔵 **LOW** — show() updates state.feeling before its own null-guard — first-open feeling refresh silently lost · `js/clippy-soul.js`
  
  show() line 656 runs `if(_p){ state.feeling=_p; save(); }` inside a try/catch BEFORE the `if (!state) await load();` on line 657. If the viewer is opened before load completes (state null), the assignment throws, is swallowed, and the live-emotion feeling update is skipped for that open. Harmless in practice (the viewer still renders after load) but the statement order defeats its own purpose.
  
  _Evidence:_ js/clippy-soul.js:656 (`try { ... state.feeling=_p; save(); } catch(e){}`) precedes 657 (`if (!state) await load();`).
  
  _Fix:_ Move the feeling-refresh block after the `if (!state) await load();` line.

- ⚪ **INFO** — Corollary of the boot wipe: browser-side loadAnima/rebirth is dead code and incarnation-derived features are frozen at 1 · `js/clippy-soul.js`
  
  Because load() early-returns at line 345 when sb() is null (which per the critical finding is every browser boot), the loadAnima call at line 406 never executes in the browser: the anima is only ever seeded by refreshAnima at ~90s (line 602), rebirth-on-gap never fires browser-side, and soulMood/soulColor/climate chips read null for the first 90s of every session. Downstream, everything keyed to soul growth is flat: clippy-tesserae.js:108 computes the bond band from state.incarnation (permanently 1), and the inner-room viewer always shows 'incarnation 1' with a near-empty stream. Alfredo should know the growth features he built are currently rendering a newborn every day — this also explains why the anima row survived while the soul row did not (refreshAnima is read-only; loadAnima's genesis-overwrite risk is never reached).
  
  _Evidence:_ js/clippy-soul.js:344-345 (early return skips lines 362-408 including loadAnima at 406), 602 (refreshAnima 90s interval is the only anima seeder), DB: clippy_soul incarnation=1/born=null vs clippy_anima grown 44-char strand; js/clippy-tesserae.js:108 (bond from so.incarnation).
  
  _Fix:_ No separate fix — resolved automatically by fixing the critical sb-not-ready finding; listed so the owner understands the visible symptoms (newborn soul in the viewer, flat bond band) trace to the same root cause.


### `clippy-mens-manus` — MENS + MANUS  · health: 🟢 good


MENS (js/clippy-mens.js) and MANUS (js/clippy-manus.js) are in good shape: both parse clean, the v348 zero-work false-negative fix is verifiably present at all four intended call sites (tickets line 134, kanban_cards line 146, equipment no-term path line 195, orders line 224 — each scopes by house BEFORE the row cap), the NEXUS LIVE STATE brief is correctly injected into the deep-brain system prompt (clippy.js:6597-6608, including the v331 no-records honesty instruction), MANUS "Open <screen>" offers are wired end-to-end with all five VIEW_FOR views confirmed present in index.html, and window._NX_HOUSE_SCOPE is read-only in this lane (read only at clippy-mens.js:323-325). House laws hold: the write hand commits only after a two-tap confirm (clippy.js:2823-2895), every supabase call destructures {error} (no dead catches), no par-driven ordering exists, and both files bind to window.NX and the lexical NX. Remaining issues are refinements: the v348 fix was not extended to two sibling query paths (latent), briefs truncate lists without a "+N more" marker while instructing the model to answer counts exactly (actively wrong today — Suerte has 16 open tickets, brief shows 10), and the Spanish word "este" ("this") is misread as the Este house and overrides the walk-with-me scope.


- 🟡 **MEDIUM** — v348 scope-before-cap fix not extended to equipment_issues or the equipment term-search path · `js/clippy-mens.js`
  
  The v348 fix (scope by house before the row cap) was applied to tickets, kanban_cards, orders, and the no-term equipment query, but two sibling paths still cap first and house-filter client-side after: (1) equipment_issues fetches .neq('status','repaired').limit(15) with no location predicate, then filters by parent equipment location at line 151; (2) the equipment term-search path (when the question names a machine, e.g. 'fridge') runs ilike('name', like).limit(12) with no location predicate, then filters at line 199. Both reproduce the exact false-negative class v348 fixed: once row counts grow past the cap, a house's rows fall outside the window and MENS reports nothing for that house. Latent today (only 5 equipment_issues, all 'repaired'; max term match is 9 rows for 'ice'), but it is the same bug waiting on data growth.
  
  _Evidence:_ js/clippy-mens.js:137-141 (equipment_issues query, no loc predicate, limit 15) and :151 (client-side loc filter after cap); :189-190 (term path: ilike name, limit 12, no loc predicate) and :199 (loc filter after cap). SQL: equipment_issues has 5 rows all status='repaired'; equipment name ilike '%ice%' = 9 rows, '%fridge%' = 4 rows.
  
  _Fix:_ Mirror v348: when loc is set, add the location predicate server-side before the cap on both paths — equipment_issues via .ilike on the embedded equipment.location (or a two-step query), and the term path via b.ilike('location','%'+loc+'%') alongside the name ilike.

- 🟡 **MEDIUM** — Brief truncates lists with no '+N more' marker while instructing the brain to answer counts exactly · `js/clippy-mens.js`
  
  The brief preamble says 'These are REAL current records... Answer from them exactly — names, numbers, counts.' But perceiveWork slices tickets to 10 lines (cards to 8, issues to 6) with no indicator that rows were dropped. Today Suerte has 16 open tickets: a question like 'how many open tickets at Suerte?' gets a brief listing 10 and an instruction to answer counts exactly from it — a confidently wrong count. Same class in the unscoped equipment path: 64 active equipment rows vs a 40-row cap sorted by next_pm_date nulls-last, so ~24 no-PM-date units can never appear in an unscoped equipment brief.
  
  _Evidence:_ js/clippy-mens.js:154 (tickets.slice(0,10)), :159 (issues.slice(0,6)), :165 (cards.slice(0,8)), :363-367 (preamble demanding exact counts). SQL: open non-deleted tickets by location = suerte 16, toti 13, este 11; equipment is_deleted=false total = 64 vs limit(40) at :196.
  
  _Fix:_ When rows.length exceeds the slice, append '…and N more (see NEXUS)' to the section and/or emit the true count in the header (e.g. 'OPEN WORK · Suerte (16 total):'). That keeps the exact-answer instruction honest.

- 🟡 **MEDIUM** — Spanish word 'este' ('this') is misread as the Este house and overrides the walk-with-me scope · `js/clippy-mens.js`
  
  detectLoc uses /\beste\b/, which matches the extremely common Spanish demonstrative 'este' ('this'). The estate is bilingual (cleaning tables carry name_es/section_en; staff write Spanish). Per the v330 rule, a house named in the question outranks window._NX_HOUSE_SCOPE — so a Spanish line like 'este horno no funciona' typed while walking Suerte grounds the answer in Este rows, exactly the confident wrong-house answer v330 was meant to end. The same misdetection flows into MANUS: proposeWorkOrder uses classify().location, so a confirmed Spanish-language report would be logged with location Este.
  
  _Evidence:_ js/clippy-mens.js:42 (if (/\beste\b/.test(q)) return 'este';), :323-325 (question-named house wins over _NX_HOUSE_SCOPE); js/clippy-manus.js:112-114 (proposeWorkOrder takes c.location). Bilingual fields confirmed at clippy-mens.js:247 (section_en/name_en with _es siblings in schema).
  
  _Fix:_ Disambiguate: only treat 'este' as the house when capitalized mid-sentence, preceded by at/en/@, or when the sentence is otherwise English (e.g. require /\b(?:at|en|@)?\s*este\b/i with a Spanish-stopword guard); alternatively let the walk scope win over a bare 'este' match.

- 🔵 **LOW** — Urgency regex lacks word boundaries — 'gasket' and 'right now' escalate priority to high · `js/clippy-manus.js`
  
  proposeWorkOrder sets priority high via /urgent|emergency|asap|now|flood|gas|fire|no\s+(?:heat|hot\s+water|power)/i with no \b anchors. 'gas' matches inside 'gasket' ('walk-in gasket is broken' — a routine repair — drafts as high), 'now' matches inside 'know'/'snow' and fires on the filler 'right now', and 'fire' matches inside 'fired'. Over-prioritization only — the two-tap confirm still shows the draft — but the preview does not display priority, so the user cannot see or correct it before committing.
  
  _Evidence:_ js/clippy-manus.js:113; confirm preview at js/clippy.js:2853-2856 shows only title and location, not priority.
  
  _Fix:_ Add word boundaries (/\b(?:urgent|emergency|asap|flood|gas\s+(?:leak|smell)|fire)\b/ etc., drop bare 'now' or require 'right now' + assert term), and show the drafted priority in the confirm preview.

- 🔵 **LOW** — MANUS write hand ignores the walk-with-me house scope — scoped reports log with NULL location · `js/clippy-manus.js`
  
  MENS grounding honors window._NX_HOUSE_SCOPE when the question names no house, but proposeWorkOrder only uses classify().location. So while walking Suerte, 'the oven is broken' is grounded in Suerte rows yet the offered work order drafts with location null, and commitWorkOrder writes location NULL on both kanban_cards and the tickets mirror (the explicit null bypasses tickets' 'suerte' column default). Location-less cards then vanish from every house-scoped MENS brief (locNorm(null)='' matches no house).
  
  _Evidence:_ js/clippy-manus.js:106-115 (no _NX_HOUSE_SCOPE read), :130-131 (location: LOC[locKey] || order.location || null); js/clippy-mens.js:323-325 (MENS does read the scope). Schema: tickets.location default 'suerte'::text, kanban_cards.location default ''::text.
  
  _Fix:_ In proposeWorkOrder, fall back to locNorm(window._NX_HOUSE_SCOPE) when classify() finds no house — the confirm preview already displays location, so the user can veto a wrong guess.

- 🔵 **LOW** — Vendor perceiver never filters by house, and trade matching uses loose 5-char substrings · `js/clippy-mens.js`
  
  perceiveVendors selects the `restaurants` column but never uses it, and ignores the loc argument entirely — 'who do we call for plumbing at Toti' can surface vendors that only serve Suerte/Este. Trade matching compares hay.indexOf(trade.slice(0,5)), so short trades match inside unrelated words (e.g. 'gas' inside a company name like 'Vegas Refrigeration' or 'hood' inside 'neighborhood'), and when no trade matches it silently dumps the whole preferred-sorted roster (10 rows with phone numbers) into the brief.
  
  _Evidence:_ js/clippy-mens.js:273-299 — loc parameter accepted but never referenced; :278 selects restaurants unused; :286 hay.indexOf(t.slice(0, 5)).
  
  _Fix:_ Filter by restaurants containing the loc key when loc is set (fall back to all if empty), and use word-boundary regex per trade instead of slice(0,5) substring.

- 🔵 **LOW** — isReport rejects explicit log imperatives that open with a request verb · `js/clippy-mens.js` · _known_
  
  Deferred item [58] from yesterday's audit, confirmed still present: isReport returns false for any line opening with can/could/etc., so 'Can you log that the fryer is broken?' never triggers the work-order offer even though it is an explicit ask. The interrogative guard at line 86 blocks it before the assert regex runs.
  
  _Evidence:_ js/clippy-mens.js:86 (/^\s*(?:what|which|...|can|could|any|show|list|tell)\b/i returns false); CLIPPY-AUDIT-REPORT.md line 46 (item [58], low, deferred).
  
  _Fix:_ Whitelist imperative-log phrasings (log/create/add/make a ticket|work order) before the interrogative guard.

- 🔵 **LOW** — No live 'cleaning today' perceiver — cleaning answers ground in static task counts · `js/clippy-mens.js` · _known_
  
  Deferred item [59], confirmed still present: perceiveCleaning reads only cleaning_tasks (the static task definitions) and reports counts per section. 'Did Este finish cleaning today?' gets grounded with '84 active cleaning tasks' rather than today's completion state, so the brain answers a today-question from a task catalog. Given the 8am-Central day-roll rule (getCleaningDate), a completions-based perceiver must reuse that boundary.
  
  _Evidence:_ js/clippy-mens.js:244-271 — queries cleaning_tasks only, no completions/log table, no date predicate; CLIPPY-AUDIT-REPORT.md line 48 (item [59], low, deferred).
  
  _Fix:_ Add a completions query keyed to getCleaningDate()'s day (respecting the 8am roll) and report done/remaining per section when the question implies 'today'.

- ⚪ **INFO** — Lane verification: v348 fix present, house laws complied, dual-NX handled correctly · `js/clippy-mens.js`
  
  Positive confirmations the owner asked for: (1) the v348 zero-work false-negative fix is present at all four shipped call sites — tickets (line 134), kanban_cards (line 146), equipment no-term path (line 195), orders (line 224), each applying the house ilike BEFORE the row cap, plus v348's single-control navigate() fix in MANUS (clippy-manus.js:53-59). (2) Law compliance: writes happen only via commitWorkOrder after a two-tap explicit confirm (clippy.js:2823-2895); every supabase call destructures {error} (mens q() helper :102-108; manus :153-157 and :164-173 — no dead catches); no par-driven ordering anywhere in the lane; _NX_HOUSE_SCOPE is read, never written (:323-325); both modules bind to window.NX and the lexical NX (mens :386, manus :191) and all clippy.js consumers feature-detect both. (3) All five VIEW_FOR view names (issues, equipment, inventory, clean, vendors) exist as data-view targets in index.html. (4) DB defaults confirm commitWorkOrder's inserts stay visible to MENS (is_deleted defaults false on both tickets and kanban_cards; tickets.board_card_id column exists for the mirror).
  
  _Evidence:_ js/clippy-mens.js:134,146,195,224; js/clippy-manus.js:53-59,122-180; js/clippy.js:2566,2597-6608,2763-2777,2823-2895; index.html data-view inventory; information_schema: tickets.is_deleted default false, kanban_cards.is_deleted default false, tickets.board_card_id present.
  
  _Fix:_ No action needed — recorded so the fleet does not re-litigate these.


### `clippy-senses-social` — Senses, buddy, tour, hideaway  · health: 🟡 fair


The senses/buddy/tour/hideaway lane is in solid shape overall: all four files pass node --check, the two-NX trap is handled correctly (buddy/hideaway use the resolve pattern; app.js:4584 unifies the objects for senses/tour), law 3 ({error} checking) is respected almost everywhere, buddy is genuinely read-only as its header claims, and the v330/v348 tour fixes hold up under inspection (action clicks set _resolved before closeActionBubble, so onDismiss cannot kill the step chain). The senses module honors its privacy promise — listeners count events only and never read key contents. The real problems cluster in the hideaway: every den write (ribbon, midnight-book handoff, guest note) is a read-modify-write of the entire clippy_hideaway blob with an UNchecked read error, racing the midnight cron on the same row — a plausible path to silently losing Clippy's night notes or Alfredo's guest notes, exactly at the midnight moment the feature is designed around. The den also lives on the world-writable clippy_sync bus (personal notes readable/forgeable/deletable by anyone with the anon key), and the hideaway's load-failure path leaves an undismissable full-screen overlay that locks the app until reload. None of these appear in yesterday's Clippy audit report.


- 🟠 **HIGH** — Hideaway den writes race the midnight cron and never check the pre-write read's error — lost-update / rollback data loss · `js/hideaway.js`
  
  All three den writes (place ribbon ~line 148-166, make-midnight-book ~line 266-289, leave guest note ~line 291-313) do select-then-upsert of the ENTIRE clippy_hideaway data blob. The pre-write read's error is never checked: 'var cur = await client.from(...).maybeSingle(); var den2 = (cur.data && cur.data.data) || state.den || {};' — if the read fails transiently but the upsert succeeds, the whole den (Clippy's night notes, diary replies, ribbons, book position) is rolled back to the stale copy loaded when the door was opened, or to {} in the worst case. Independently, the midnight cron (hideaway-night, per header line 8) writes the same row; last-writer-wins means a guest note left around midnight can erase Clippy's fresh night note, or vice versa — and 'leave him a note, he answers at midnight' is the designed nighttime use.
  
  _Evidence:_ js/hideaway.js:153-157: 'var cur = await client.from(''clippy_sync'').select(''data'').eq(''id'',''clippy_hideaway'').maybeSingle(); var den2 = (cur.data && cur.data.data) || state.den || {}; ... upsert({ id: ''clippy_hideaway'', data: den2, ... })' — cur.error unchecked; same pattern at 278-281 and 299-304.
  
  _Fix:_ Check cur.error and abort the write on a failed read (never fall back to state.den for a full-blob write). Longer term, split guest_notes/ribbons into their own rows or a jsonb-merge RPC so client writes and the midnight cron can't clobber each other; at minimum re-read-and-merge immediately before upsert.

- 🟡 **MEDIUM** — Alfredo's private den notes and Clippy's 'own words' live on the world-writable clippy_sync bus · `js/hideaway.js`
  
  The entire hideaway den — Alfredo's personal guest notes (by:'alfredo'), Clippy's margin notes and replies, the door note, ribbons — is one clippy_sync row readable and writable with the public anon key (house law 5). Output is properly escaped (esc(), lines 18-22) so there is no XSS, but an unauthenticated party can: read Alfredo's private notes to Clippy; delete or rewrite them; forge 'replies' and door notes that the UI renders verbatim as Clippy's own voice (verbatim-relay means forged text is faithfully presented as his); or upsert data:null, which makes load() return false and permanently bricks the Hideaway door into the trapped error state (see next finding) until the row is repaired.
  
  _Evidence:_ js/hideaway.js:36 reads clippy_sync id 'clippy_hideaway'; 302 pushes {ts, text, by:'alfredo'} guest notes onto the bus; 189/216-218 render door_note and g.reply as Clippy's words; 39-42 'if (res[0].error || !res[0].data) return false; ... return !!state.den' — a nulled data field makes every open fail.
  
  _Fix:_ Owner decision: either accept the exposure for this companion feature, or move the den off the open bus (RLS: anon read-only + writes via an edge function), and treat guest notes as private content. Also make load() distinguish 'row missing/null' (offer to re-initialize) from a real connection error.

- 🟡 **MEDIUM** — Hideaway load-failure path traps the user under an undismissable full-screen overlay · `js/hideaway.js`
  
  open() appends the fixed inset-0 z-index-9600 overlay, then awaits load(); on failure it sets 'The den is dark right now — the connection is out. Try again in a moment.' and returns BEFORE render() runs. But every close affordance — the #hwClose button (230-231) and the backdrop-click dismiss (232) — is wired inside render(), and there is no Escape handler anywhere in the file. So a transient DB/network failure (common on a phone PWA) when tapping the Hideaway door locks the whole app behind the scrim; only a page reload recovers. The message says 'try again' but offers no way to do so or to leave.
  
  _Evidence:_ js/hideaway.js:326-330: 'var okLoad = await load(); if (!okLoad) { ov.querySelector(''.hw-room'').textContent = ''The den is dark...''; return; }' — returns before render(); css/hideaway.css:6-12: '.hw-ov { position: fixed; inset: 0; z-index: 9600; ... }'.
  
  _Fix:_ Wire the backdrop-click dismiss (and ideally an Escape handler) in open() itself before load(), and include a close/retry button in the failure branch.

- 🔵 **LOW** — Book reader: failed or missing page shows 'turning the page…' forever; rapid paging can display wrong page text · `js/hideaway.js`
  
  fetchPage() returns null on any error or missing hideaway_pages row (84-85), and renderBook treats r.text == null purely as a loading state (119-121) — a single failed page fetch leaves 'turning the page…' permanently with no error message or retry. fetchPage also never null-checks sb(). Separately, go() (135-140) has no in-flight guard: tapping next/›› quickly starts overlapping fetches, and a slower earlier response can resolve last and overwrite r.text after the later page rendered, showing page N's text under page M's header.
  
  _Evidence:_ js/hideaway.js:84-85 'return (!r.error && r.data) ? r.data.text : null;'; 119-121 'r.text == null ? <div class="hw-loadpage">turning the page…</div>'; 135-140 async go() with shared state.reading and no request token.
  
  _Fix:_ Distinguish error/missing from loading (e.g. sentinel + 'this page slipped — tap to retry'), and add a request token so only the latest go() may assign r.text.

- 🔵 **LOW** — Senses 'house' channel presents stale counts as current after a failed sample, and remarks can voice them · `js/clippy-senses.js`
  
  The v348 keep-last-good-on-failure behavior (line 121) is deliberate and correct in direction (no false all-clear), but S.house._sampleOk is never surfaced: after hours of failed samples the panel still shows the old detail ('3 urgent · 1 down…' or 'the house is calm') as if live, and maybeRemark (145-158) can speak 'The house feels loud today — N machines are asking for help' from counts that are arbitrarily old. First-load failure leaves detail 'listening…' indefinitely.
  
  _Evidence:_ js/clippy-senses.js:121 'if (!urgentR.ok || !downR.ok || !overdueR.ok) { S.house._sampleOk = false; return; }' — nothing reads _sampleOk; 149-151 remarks are built from S.house._counts with no freshness check.
  
  _Fix:_ Track a lastGoodAt timestamp; when stale (> ~15 min), append '(as of Xm ago)' to S.house.detail in the panel and suppress house-based remarks.

- 🔵 **LOW** — Walk-with-me house scope survives a PIN user switch on the same tab · `js/clippy-buddy.js`
  
  The walked-house scope is restored from sessionStorage at script load (41-42) and set/cleared only by walk()/out(); nothing listens to nexus:user-change. On a shared tablet, if one person walks Suerte and another logs in in the same tab, every MENS-grounded answer for the new user stays silently scoped to Suerte (mitigated only by the chip highlight in the chat view, which the new user may never open). The v330 named-house override in clippy-mens.js:320-325 limits the damage to questions that don't name a house.
  
  _Evidence:_ js/clippy-buddy.js:41-42 'state.house = sessionStorage.getItem(''nx_buddy_house'') || null; if (state.house) window._NX_HOUSE_SCOPE = ...' — no user-change hook anywhere in the file.
  
  _Fix:_ Clear the buddy scope (call out()) on the nexus:user-change event, or key nx_buddy_house by user id.

- ⚪ **INFO** — Privacy law verified: the sensorium reads rhythms and counts only — implementation matches the panel's promise · `js/clippy-senses.js`
  
  The keydown/pointermove/pointerdown listeners increment counters only and never read e.key, input values, or screen content (57-62); hearing is typing cadence, sight is motion rate + active-view name, house is the same three aggregate counts the bell uses (read-only queries, 112-118), and the panel's on-face claim 'Patterns only — rhythms, counts, presence' (185) is accurate. No law violations: no par usage, no auto-close/bulk writes anywhere in the lane, and supabase {error} results are checked (the one lapse is the unchecked pre-write read in hideaway.js, reported above).
  
  _Evidence:_ js/clippy-senses.js:57-62: listeners are '() => { moveEvents++; }', '() => { keyEvents++; }' — no event payload is ever inspected beyond shell containment for touch.
  
  _Fix:_ None — worth knowing the privacy promise is real. Consider this positive confirmation for the owner.

- ⚪ **INFO** — Tour and buddy plumbing verified sound; v330/v348 fixes hold under inspection · `js/clippy-tour.js`
  
  Cross-checked the fragile contracts: action-button clicks set el._resolved = true before closeActionBubble (clippy.js:7510-7515), so the tour's per-step onDismiss cannot fire on Next and kill the chain; fromChat:true steps bypass the only null-return gate (clippy.js:7417) so a step bubble always shows; the once-ever offer flag is burned only when the welcome actually shows (clippy-tour.js:196-201). Note one deliberate-but-notable behavior: 'Skip tour' calls markDone() (line 103-105), permanently recording tour_completed so the auto-offer never returns — restart exists only via the long-press menu. Buddy attaches to both NX objects (clippy-buddy.js:122-123) and its 'writes nothing, ever' claim is true. All four lane files pass node --check.
  
  _Evidence:_ js/clippy-tour.js:103-105 'function endTour(finished) { running = false; unspot(); markDone(); ...' — markDone unconditional on skip as well as finish; js/clippy.js:7512 'el._resolved = true; // an explicit choice — not a dismiss'.
  
  _Fix:_ No action needed; if Alfredo ever wants declined-but-new users re-offered the tour, endTour(false) marking tour_completed is the line to change.


### `clippy-games` — Clippy games  · health: 🟢 good


The clippy-games lane is in good shape post-v348: all 10 games are wired (index.html:4900 loads the module after clippy.js), syntax is clean, every game_intro_*/die pool exists in clippy-dialog.json, and every v330/v336/v348 fix I checked for is present in the shipped code — including the headline Flappy fix (columns now spawn relative to the last column's live scrolling x at js/clippy-games.js:1805-1809, so gaps no longer grow unboundedly). The real exposure is the shared leaderboard: public.clippy_scores has RLS enabled but a single ALL/USING-true/CHECK-true policy, so anyone with the public anon key can forge, rewrite, or wipe scores and inject arbitrary (escaped) names/locations that render on every device's TOP PLAYERS list. Two smaller items: the Reaction game is the only game with no quit button once started — a player (including the 3-year-old) can be stuck on an indefinite tap-wait with no exit — and the sole row currently in clippy_scores is a stale pre-v330 "Alfredo/flappy/0" entry that makes the Flappy leaderboard show 0 cols (per house law 2, I did not touch it). Toddler-friendliness is otherwise strong: tap-first inputs, forgiving hitboxes, cute frowny (no X-eyes) defeats per Alfredo's ruling, and sound honors the preference toggle.


- 🟡 **MEDIUM** — clippy_scores leaderboard is fully open to the anon key (forge/rewrite/wipe) · `js/clippy-games.js`
  
  The shared leaderboard table public.clippy_scores has RLS enabled but one policy 'clippy_scores_all' with polcmd='*', USING true, WITH CHECK true — so any unauthenticated holder of the public anon key (which ships in the GitHub Pages app) can INSERT arbitrary scores under any user_name/location, UPDATE existing rows, or DELETE the whole leaderboard. Scores are computed client-side with no server validation (no score cap, no game-id check, and higher_is_better is client-supplied per row, which also steers the clippy_scores_best view's best-per-user pick). Injected user_name/location strings render on the TOP PLAYERS list on every device (they ARE html-escaped via esc() at js/clippy-games.js:414-418, so no XSS — but offensive text would display to staff and Alfredo's son). This mirrors the clippy_sync bus posture flagged by house law 5.
  
  _Evidence:_ SQL: pg_policy for public.clippy_scores → [{"polname":"clippy_scores_all","polcmd":"*","using_expr":"true","check_expr":"true"}], relrowsecurity=true. Client write path: js/clippy-games.js:174-184 postScore() inserts {game, user_id, user_name, location, score, higher_is_better} via NX.sb with the shared anon key; read path getLeaderboard() at :185-194.
  
  _Fix:_ Split the policy: allow SELECT + INSERT only (drop UPDATE/DELETE for anon), add CHECK constraints on score range (e.g. 0<score<100000) and game IN (the 10 known ids), and consider a length cap on user_name/location. Needs Alfredo's go-ahead since it is a DB policy change.

- 🟡 **MEDIUM** — Reaction game has no quit control and can trap the player indefinitely · `js/clippy-games.js`
  
  Once Start is pressed, every Reaction round re-renders the overlay with only a title, a message line, and the board — no Quit/Cancel button (all 9 other games render one). There is also no timeout on the 'TAP NOW!' phase: if the player never taps after the green flash, the game waits forever on a full-screen overlay with no visible exit (the only escape hatches are indirect — external calls to NX.clippy.games.closeOverlay from route changes/palette). Combined with the hard abort after two false starts, this is the least toddler-friendly game: a 3-year-old mashing early gets 'Two false starts — game over', and one who wanders off leaves the app stuck on the overlay.
  
  _Evidence:_ js/clippy-games.js:1466-1530 runRound(): ov.innerHTML contains no [data-act=quit] button; goHandler at :1504 is the only path out of the TAP NOW state and only fires on a tap; abort at :1484-1490. Compare tap game quit at :1108, flappy quit at :1701, etc.
  
  _Fix:_ Add the same is-ghost Quit button the other games have to the Reaction round template, and optionally a ~10s no-tap timeout that scores the round as a miss.

- 🔵 **LOW** — Stale pre-v330 zero-score row is the only leaderboard entry (Flappy shows '0 cols' top player) · `js/clippy-games.js`
  
  clippy_scores contains exactly one row: game=flappy, user_name=Alfredo, location=suerte, score=0, created 2026-07-10 — a relic of the pre-v330 bug where a first-ever quit posted 0 as a NEW HIGH SCORE. The write path is fixed (saveHighScore now requires score>0 for higher-is-better games, js/clippy-games.js:145), but the residual row makes the Flappy TOP PLAYERS list show 'Alfredo · suerte — 0 cols'. It will self-heal once Alfredo posts any real Flappy best (the clippy_scores_best view is DISTINCT ON (game,user_id) ordered by score DESC), but until then the sole leaderboard entry is embarrassing. Per house law 2 I did not delete it — deletion needs an explicit ask.
  
  _Evidence:_ SQL: select * from clippy_scores → [{game:'flappy', user_id:2, user_name:'Alfredo', location:'suerte', score:0, higher_is_better:true, created_at:'2026-07-10T14:57:28Z'}]; guard at js/clippy-games.js:145 'if (game.higherIsBetter && !(score > 0)) return false;'.
  
  _Fix:_ Ask Alfredo whether to delete the single score=0 flappy row; a one-row DELETE with his explicit OK cleans the leaderboard immediately.

- 🔵 **LOW** — Mid-game cheer system has no line source anywhere — flashOverlayCheer never fires · `js/clippy-games.js`
  
  reactMidGame() draws lines from pools game_cheer / game_rally / game_clutch, but those keys exist nowhere: not in clippy-dialog.json (verified against the full key list), not in clippy.js INLINE_POOLS, and not in the clippy_sync 'clippy_learned' bus row (SQL check returned no matching keys). pickFromPool returns '' for missing pools, so the '(line && ...)' guard means the overlay cheer (and its injected CSS) is dead code in every game — only the processInteraction feeling nudges land. The code comment says lines must come from 'HIS pools — never scripted here', but nothing prompts the self-authoring system to write these three categories either, so the feature can never activate as-built.
  
  _Evidence:_ js/clippy-games.js:279-292 reactMidGame pulls pool 'game_cheer'|'game_rally'|'game_clutch'; clippy-dialog.json game-related keys = [asteroids_die, breaker_die, cannon_die, ..., snake_die] with MISSING: ['game_cheer','game_rally','game_clutch']; clippy.js pickFromPool returns fallback||'' (line ~1101); SQL on clippy_sync clippy_learned keys matching %cheer%/%rally%/%clutch% → null.
  
  _Fix:_ Either seed the three pools in clippy-dialog.json, or add them to the categories the self-authoring loop writes — otherwise remove the dead cheer path.

- 🔵 **LOW** — Leaderboard view merges all signed-out players into one slot · `js/clippy-games.js`
  
  clippy_scores_best is DISTINCT ON (game, user_id). postScore writes user_id=null when NX.currentUser is absent (name defaults to 'Someone'). In DISTINCT ON, NULLs compare equal, so every signed-out player across all devices collapses into a single best-per-game leaderboard entry — one anonymous player's high score hides all others', and the displayed name is whichever 'Someone' (or stale name) rode the winning row. Low impact today since PIN login is the norm, but worth knowing if the games ever get played from a logged-out kiosk or the kid's device.
  
  _Evidence:_ View def: 'SELECT DISTINCT ON (game, user_id) … ORDER BY game, user_id, CASE WHEN higher_is_better THEN score ELSE -score END DESC'; js/clippy-games.js:166-173 _who() returns id:null / name:'Someone' when no NX.currentUser.
  
  _Fix:_ If anonymous play matters, key the view on COALESCE(user_id::text, user_name) or skip posting when user_id is null.

- ⚪ **INFO** — v348 Flappy fix confirmed shipped; all 10 games structurally sound · `js/clippy-games.js` · _known_
  
  Verification of prior art in the live code: (1) the v348 Flappy unplayability fix is present — columns spawn relative to the last column's live scrolling x (spacingAt), replacing the absolute nextColumnX that grew gaps without bound; (2) v348 catch-game double-advance guard (target pointer-events disabled during the level banner, :1383-1385); (3) v348 memory-quit clears the playback interval (:1578-1583); (4) v348 breaker multi-ball hard cap of 8 (:3012-3023); (5) v348 asteroids dead 'score += 5' removed (:3455); (6) v330 aborted-run/zero-score leaderboard guards and monotonic colSeq star binding; (7) v336 single-writer best-score pattern in all canvas games. node --check passes, index.html:4900 loads the module after clippy.js, every game_intro_*/die pool exists, and the module attaches to the shared NX object (app.js:4584 sets window.NX = lexical NX, so the two-NX trap does not bite here). Toddler ergonomics are deliberately good: tap-to-start, forgiving Flappy hitbox (Ø38 hitbox vs Ø44 visual with raised gap floors), EASY onboarding phases, and the 'frowny face, no X-eyes' defeat ruling honored (SPRITE_FACES.dead, :522).
  
  _Evidence:_ js/clippy-games.js:1805-1809 'x: columns.length ? columns[columns.length - 1].x + spacingAt(lastScore) : W + 60' with the v348 comment '…column gaps grew without bound → Flappy became unplayable'; CLIPPY-AUDIT-REPORT.md:13 'Flappy being unplayable' listed as closed.
  
  _Fix:_ No action needed; this confirms the audit report's shipped-fix claims for the games surface.


### `clippy-collect` — Gacha, powers, tesserae  · health: 🟡 fair


The gacha lane is in decent mechanical shape: the pull loop, pity system (rare floor at 10, legendary guarantee at 30), and state normalization were genuinely hardened in v330/v348, and all dialog pools the module references exist in clippy-dialog.json. The two real weaknesses are in the new persistence layer, not the odds: clippy_cloud_state has a single ALL/public/true RLS policy, so anyone with the shared anon key can read, forge, or wipe any user's gacha collection (and the client installs the forged blob into localStorage on pull); and cloud sync is whole-row last-write-wins, so a stale second device pushing any change silently replaces a newer collection and reverts last_pull_date, both losing cards and re-opening the daily gate. Notably, despite v348's cross-device sync fix, zero of the 5 clippy_cloud_state rows carry any gacha data — including rows updated today — so the sync has never actually persisted a collection yet. The known deferred owner decision (card powers advertised but never applied) still stands. clippy-power.js is well-built (attaches to both NX objects, checks {error} correctly) but its FULL POWER answer is steerable by an unauthenticated bus write; today that only lights a cosmetic badge. clippy-tesserae.js works but attaches only to window.NX and permanently caches a failed sprite fetch.


- 🟡 **MEDIUM** — clippy_cloud_state is world-writable: anyone with the anon key can forge or wipe any user's gacha collection · `js/clippy.js`
  
  The table backing gacha cloud persistence has exactly one RLS policy: cmd=ALL, roles={public}, qual=true, with_check=true. Any holder of the shared anon key (it ships in the PWA source) can upsert or delete any user_id's row. On next session start, cloudPull (js/clippy.js:809-811) writes the remote gacha blob straight into localStorage: `if (data.gacha && typeof data.gacha === 'object') { localStorage.setItem(userKey('clippy_gacha'), JSON.stringify(data.gacha)) }`. The v330 normalizer in clippy-gacha.js prevents crashes from malformed blobs but cannot distinguish a forged/wiped collection from a real one — an attacker can zero the kid's collection or reset pity counters, and setting a future updated_at makes the forgery win LWW forever. Same policy also exposes memories/feelings/preferences (other lanes).
  
  _Evidence:_ pg_policies: {tablename:'clippy_cloud_state', policyname:'clippy_cloud_state_all', cmd:'ALL', roles:'{public}', qual:'true', with_check:'true'}; js/clippy.js:809-811 (unconditional install of remote gacha into localStorage); js/clippy-gacha.js:92-115 (normalizer accepts any well-shaped blob).
  
  _Fix:_ Ask Alfredo whether Clippy cloud state should stay open. Minimum hardening without auth changes: scope the policy to SELECT+INSERT+UPDATE (drop public DELETE), and have cloudPull sanity-check the gacha blob (e.g. reject collections whose per-card counts exceed total_pulls). Longer term this table wants per-user auth, but that is an estate-wide decision.

- 🟡 **MEDIUM** — Whole-row LWW cloud merge can silently lose today's pull and re-open the daily gate (duplication + data-loss path) · `js/clippy.js`
  
  cloudPush uploads the entire state row (memories+preferences+feelings+gacha+highscores) with one row-level updated_at (js/clippy.js:741-772), and cloudPull applies ALL fields wholesale whenever cloudTime > local last_local_write (js/clippy.js:784-811). There is no per-field merge: device B with a stale gacha blob (no pull today, older collection) that pushes for ANY reason — a preference change, a feelings tick — stamps a newer updated_at, and device A's next pull-on-start replaces its newer collection with B's stale one. Consequences: (1) today's pulled card is silently deleted from the collection; (2) last_pull_date reverts to an earlier date, so canPullToday() (js/clippy-gacha.js:145-148) passes again and the user gets a second pull the same day; (3) pity counters rewind. Gacha counts are monotonic counters and should merge by max/sum, not blob replacement.
  
  _Evidence:_ js/clippy.js:753 (payload.updated_at = now, one timestamp for all fields), :787 ('if (cloudTime <= localTime) return' — the only guard), :809-811 (gacha blob replaced wholesale); js/clippy-gacha.js:116-121 (saveGachaState -> cloudPushQueued sets last_local_write only on the pulling device).
  
  _Fix:_ When wiring a fix, merge gacha per-field: collection counts by max per card id, total_pulls by max, last_pull_date by max date, pity counters from whichever side has the higher total_pulls. Do not ship silently — this touches cloud-synced state, flag to Alfredo first.

- 🟡 **MEDIUM** — All 24 gacha card powers are advertised on cards but never applied (deferred owner decision) · `js/clippy-gacha.js` · _known_
  
  Every card in GACHA_CARDS carries a `power` string ('Trajan: Daily bonus +50%', 'Augustus: Start at Bond Lv 2', 'Pantheon: Unlocks GOLDEN mood') rendered prominently on the reveal card (js/clippy-gacha.js:241) and nothing anywhere reads card.power — grep confirms the field is written in the catalog and read only for display. The collection promises a meta-game that does not exist. This is CLIPPY-AUDIT-REPORT.md item 3, one of the 7 pending owner decisions: wire a small subset of powers (perturbs tuned XP balance and cloud-synced state) vs reword powers as pure lore.
  
  _Evidence:_ js/clippy-gacha.js:59-85 (catalog with power strings), :241 (`<div class="clippy-gacha-card-power">${ix.esc(card.power)}</div>` — the only consumer); CLIPPY-AUDIT-REPORT.md line 93-96.
  
  _Fix:_ Still awaiting Alfredo's call. If no decision lands, the safe default is option (b) from the report: reword powers as flavor text so no card claims an effect it doesn't deliver — zero balance risk.

- 🔵 **LOW** — FULL POWER state is steerable by an unauthenticated clippy_sync write (cosmetic today, routing-relevant tomorrow) · `js/clippy-power.js`
  
  clippy_sync has public INSERT/UPDATE/DELETE policies (qual/with_check = true). clippy-power.js reads id='clippy_nodes' and computeFull trusts the row's self-reported fields: `(now - (n.ts || 0) < FRESH_S) && n.claude` (js/clippy-power.js:34-40). An unauthenticated write of {data:[{ts:<now>, claude:true}]} flips isFullPower() true estate-wide; a delete/garbage write flips it false. Today the only consumer is the cosmetic glow/badge (js/clippy.js:10979-10997), so impact is display-only — but the module's own contract says 'every Clippy surface should light up for it' and CLIPPY-BEING-MAP.md:159 plans to wire chat routing to NX.clippyPower. If lane selection (subscription vs API) is ever gated on this signal, a forged heartbeat becomes behavior-steering per house law 5.
  
  _Evidence:_ pg_policies on clippy_sync: clippy_insert/clippy_update/clippy delete all roles={public}, with_check/qual='true'; js/clippy-power.js:34-40 (computeFull trusts ts+claude), :56 (reads clippy_sync 'clippy_nodes'); js/clippy.js:10986-10993 (badge is sole consumer).
  
  _Fix:_ Fine as-is while consumption is cosmetic. Before any surface makes a routing or spend decision on isFullPower(), the signal needs an authenticated source (or at least a server-stamped ts) — note this as a precondition in the being-map plan.

- 🔵 **LOW** — Daily-pull limit has no in-flight guard: two concurrent invites both pass canPullToday and yield two pulls · `js/clippy-gacha.js`
  
  showInvite checks canPullToday() (js/clippy-gacha.js:160) but last_pull_date is only written at reveal time (js/clippy-gacha.js:223), ~1.5s+ after the check, and openOverlay('gacha') is a plain Set.add with no duplicate rejection (js/clippy.js:416-419). Invoking showInvite twice before the first reveal (double-triggering the capability-menu entry or action-bubble entry, or via console) stacks two overlays that each roll independently — two pulls, double XP/pity movement in one day. Closing the first overlay also removes 'gacha' from activeOverlays while the second is still open. Purely a cosmetic-game integrity issue with client-side-only enforcement anyway (localStorage edit or clock rollback also bypasses it).
  
  _Evidence:_ js/clippy-gacha.js:155-165 (gate at invite time), :212-225 (state committed at reveal, no re-check of canPullToday); js/clippy.js:416-419 (openOverlay has no dup guard).
  
  _Fix:_ Cheap fix when convenient: re-check canPullToday() at the top of revealCard and bail to a 'already pulled' bubble, and have showInvite no-op if isOverlayOpen('gacha'). Not urgent — stakes are cosmetic.

- 🔵 **LOW** — clippy-tesserae.js attaches NX.clippyTongue only to window.NX — latent two-NX-trap violation (house law 4) · `js/clippy-tesserae.js`
  
  The module opens with `var NX = (window.NX = window.NX || {})` (js/clippy-tesserae.js:22) and mounts NX.clippyTongue at line 352 — window.NX only, unlike clippy-power.js which explicitly attaches to both the lexical app.js NX and window.NX (js/clippy-power.js:18-24, 77-78) citing the two-NX trap. No live breakage today: the sole consumer, js/clippy-soul.js:685-694, also binds window.NX. But any future call from app.js's lexical-NX scope (e.g. galaxy or a dashboard wanting a mosaic) would find clippyTongue undefined and fail its feature silently.
  
  _Evidence:_ js/clippy-tesserae.js:22 and :352 (window.NX only) vs js/clippy-power.js:18-24,77-78 (dual attach with explicit trap comment); consumers: grep shows only js/clippy-soul.js:685-694, which uses window.NX.
  
  _Fix:_ Low-cost conformance fix next time the file is touched: adopt the clippy-power dual-attach pattern. Until then, any lexical-NX consumer must resolve via window.NX explicitly.

- 🔵 **LOW** — tesserae sprite fetch failure is cached permanently — one offline boot locks fallback faces for the whole session · `js/clippy-tesserae.js`
  
  ready() memoizes its promise before the outcome is known: `if (_readyP) return _readyP;` (js/clippy-tesserae.js:125), and on any failure sets SPRITE=null and resolves false (lines 179-183) without clearing _readyP. The warm-up call fires 4s after load (line 357); if the device is briefly offline or clippy.svg 404s once, every later soul-viewer open (clippy-soul.js:689 awaits ready()) gets the cached failure and renders the old parametric drawings instead of his real faces until a full page reload — even after the network returns.
  
  _Evidence:_ js/clippy-tesserae.js:124-126 (memoized before outcome), :179-184 (failure path leaves _readyP set), :357 (4s warm-up maximizes the race with slow boots).
  
  _Fix:_ On the failure path, null out _readyP (optionally after a cooldown) so the next ready() call retries the fetch. Cosmetic-only, ship whenever the file is next touched.

- ⚪ **INFO** — v348 gacha cloud sync has never persisted a collection — every clippy_cloud_state row has gacha = null · `js/clippy.js`
  
  Despite v348's fix wiring saveGachaState -> cloudPushQueued specifically so collections survive device switches, a live query shows 5 total rows and 0 with non-null gacha — including user_id 2 updated today (2026-07-22 15:59 UTC) and user_id 30/19 updated today. Plausible benign explanation: v348 shipped yesterday and cloudPush reads userKey('clippy_gacha') for the current user at push time (js/clippy.js:736), while historical pulls made before PIN login were stored under the global fallback key — so the per-user key reads null even for users who have pulled. Cannot distinguish 'no pulls yet' from 'push reads the wrong key' from read-only analysis.
  
  _Evidence:_ SQL: select count(*), count(gacha) from clippy_cloud_state -> total=5, with_gacha=0; latest rows updated_at 2026-07-22; js/clippy.js:736 (collectLocalState reads current userKey), js/clippy.js:10434-10468 (re-home comment confirms pre-login state binds to the global fallback key).
  
  _Fix:_ Verify after the next real logged-in pull that the row's gacha column populates. If it stays null, check whether the pull happened under the global fallback key and consider migrating global-key gacha into the user key at re-home.

- ⚪ **INFO** — clippy.js re-home hook calls NX.clippy.gacha.reload(), which the gacha module never exposes · `js/clippy-gacha.js`
  
  The v18.45 per-user re-home path calls `if (NX.clippy && NX.clippy.gacha && NX.clippy.gacha.reload) NX.clippy.gacha.reload()` (js/clippy.js:10468), but clippy-gacha.js's public API is only {showInvite, showCollection, getState, CARDS} (js/clippy-gacha.js:332-337) — the guard makes it a silent no-op. Currently harmless: getGachaState() re-reads localStorage via ix.userKey on every call, so gacha state is per-user-fresh without any reload. The dead hook is only a trap if the module ever starts caching state and a maintainer assumes the reload wire exists.
  
  _Evidence:_ js/clippy.js:10468 (guarded call to nonexistent reload) vs js/clippy-gacha.js:332-337 (public API without reload); js/clippy-gacha.js:92-115 (all reads go through getGachaState -> localStorage, no module-level cache).
  
  _Fix:_ Either delete the dead call or add a trivial reload() to the gacha API for symmetry with the other re-homed stores; document that gacha is read-fresh by design.


### `clippy-pet-host` — Pet host + hands  · health: 🔴 poor


This lane (the Clippy pet host + CLIPPY'S HANDS) contains a confirmed critical remote-control hole: the host performs real OS mouse clicks via SendInput on Alfredo's machines, and the command source is the world-writable clippy_sync bus row clippy_hands_<device>. I verified live that clippy_sync's RLS is fully public (read/insert/update/delete for all roles) and that the three machine names are exposed on the same world-readable bus via clippy_act_ rows, so an anonymous holder of the public anon key can learn a device name and drive clicks at arbitrary desktop coordinates. The page-side ts/freshness guards are trivially defeated because the attacker controls ts; the native host does no validation at all and just clicks. This is exactly the House Law 5 pattern (safety-critical behavior steerable by an unauthenticated bus write) and the code comment itself admits authentication was never wired — yet it is absent from yesterday's Clippy audit report. Mitigating realities: SendInput can't cross the UAC secure desktop, hands are suppressed while the screen is locked, and there's a 140ms host rate cap. The pet-restart recipe (kill clippy-pet-comp.ps1, supervisor revives) is valid; note clippy-pet-host.ps1 is legacy/unused and lacks the hands code.


- 🔴 **CRITICAL** — Unauthenticated world-writable bus row drives REAL mouse clicks (SendInput) on Alfredo's machines · `js/clippy.js:8543`
  
  CLIPPY'S HANDS lets the page tell the native host to perform real OS-level mouse actions via SendInput. The command source is the bus row clippy_sync/clippy_hands_<device>, which is world-writable with the public anon key. handsTick() (clippy.js:8549) reads clippy_hands_<TRAVEL.dev>, and if the row's ts is <30s old and strictly newer than the last seen ts, it calls _hand(verb, c.x, c.y) which postMessages the host, which runs MoveCursorAbs+SendInput a left/right/double click at absolute desktop pixel c.x,c.y (clippy-pet-comp.ps1:656-672). Every guard is trivially satisfied by a deliberate attacker: the attacker fully controls ts, so ts=Date.now() always passes both the 30s-staleness and strictly-newer checks. There is NO authentication, NO signature, NO coordinate bound. The verb set (click/rclick/dblclick/movec) blocks keyboard input but clicks alone can hit Delete/Confirm buttons, close/drag windows, click links already on screen, etc. The only real limiters are a host-side 140ms rate cap (~7 clicks/sec) and suppression while the screen is LOCKED (unlocked-but-idle is fully exposed). I confirmed the chain live: (a) clippy_sync RLS policies are all PUBLIC for read/insert/update/delete (roles {-}, with_check true); (b) the three machine names DESKTOP-N6PACMM, DESKTOP-OQ8SROU, DESKTOP-SL5ETE7 are exposed on the same world-readable bus via clippy_act_<dev> rows, so an attacker needs no guessing. The anon key itself is hardcoded/public (clippy-pet.html:30). The code comment at clippy.js:8538-8540 self-admits this: 'the bus row is writable by anything holding the shared anon key; true authentication needs the pet HOST bridge to verify a steward-seal HMAC ... tracked as native-side work.' It is tracked but NOT fixed and NOT in CLIPPY-AUDIT-REPORT.md.
  
  _Evidence:_ clippy.js:8554 `if (!ts || ts <= HANDS.lastTs) {...}` / :8555 `if (Date.now() - ts > 30000)` / :8559 `_hand(... c.x, c.y)`. clippy-pet-comp.ps1:667 `if (verb == "click") DoMouse(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, false);` with only `nowc - _lastClickMs >= 140` and `!_locked`. SQL: pg_policy on clippy_sync => {clippy_read using true, clippy_insert wcheck true, clippy_update using/wcheck true, clippy delete using true} all roles {-} (public). SQL: clippy_act_DESKTOP-N6PACMM/OQ8SROU/SL5ETE7 readable with dev names. clippy-pet.html:30 `SUPA_KEY = 'sb_publishable_...'`.
  
  _Fix:_ Treat the hands command as a native-side privileged action: verify a steward-seal HMAC in the HOST (clippy-pet-comp.ps1), not the public page — the page cannot hold a secret. Until that ships, gate hands behind an explicit opt-in flag that defaults OFF, require the actor to be Alfredo's own signed seal (not the anon bus), and consider dropping bus-directed hands entirely (keep only local-brain-directed _hand which needs no bus). Also move device presence off the world-readable bus or stop echoing raw machine names.

- 🟠 **HIGH** — All hands safety guards live in the public self-updating page JS; the native host is a blind executor · `clippy-pet-comp.ps1:656`
  
  The WebMessageReceived handler in the host performs SendInput for any 'click/rclick/dblclick/movec x,y' string the page sends, with no independent validation: no ts freshness, no origin/nonce check, no coordinate sanity, no allow-region. It trusts the page completely. But the page (js/clippy.js) is public code served from GitHub Pages, auto-updates into the WebView2 with no pinning, and takes its command from the world-writable bus. So every meaningful control on a real-mouse capability sits in the least-trusted layer. Anyone who can influence the served JS or the bus bypasses the guards; the host will faithfully click. Defense is in the wrong layer.
  
  _Evidence:_ clippy-pet-comp.ps1:662 `if (pp.Length == 2 && int.TryParse(...) && !_locked)` is the ONLY host gate before MoveCursorAbs/DoMouse; the ts/newer/30s checks exist only in clippy.js handsTick. clippy-pet.html:148 loads js/clippy.js from the deployed site (self-updating).
  
  _Fix:_ Do the trust decision in the host: require a signed, time-bounded, single-use token per click (HMAC over verb|x|y|ts|nonce with a secret that lives only in the node env, mirroring the Steward's Seal), reject anything unsigned or replayed at the host boundary.

- 🟡 **MEDIUM** — Hands clicks have no coordinate bounds — any pixel on the entire virtual desktop · `clippy-pet-comp.ps1:844`
  
  MoveCursorAbs maps c.x,c.y across the WHOLE virtual desktop (SM_XVIRTUALSCREEN..SM_CYVIRTUALSCREEN) then SendInputs a click there. There is no restriction to Clippy's own window, to a safe region, or away from sensitive UI. Combined with the unauthenticated bus (finding 1) this means an attacker isn't limited to poking near the pet — they can target the taskbar, a browser tab, a file manager, another app's destructive button, anywhere on any monitor. One mitigating factor worth stating honestly: SendInput cannot cross the UAC secure desktop, so it cannot click 'Yes' on elevation prompts.
  
  _Evidence:_ clippy-pet-comp.ps1:848-857 normalizes over GetSystemMetrics(SM_*VIRTUALSCREEN) with MOUSEEVENTF_VIRTUALDESK; no bounds check anywhere before the SendInput.
  
  _Fix:_ Clamp hands targets to a small allow-region (e.g. Clippy's own window rect, or a configured safe zone), and/or require the target to resolve to Clippy's own WebView surface. Reject clicks that land on foreground windows of other processes unless explicitly seal-authorized.

- 🔵 **LOW** — Hands ack + presence rows leak machine names and click coordinates on the world-readable bus · `js/clippy.js:8562`
  
  After executing a click the page upserts clippy_hands_ack_<device> = {ts, of, verb, x, y, ok} to the public bus, and the presence system continuously writes clippy_act_<device> = {dev: <MachineName>, idle, ts}. Both are readable with the anon key. Together they hand an attacker exactly the reconnaissance they need for finding 1: the live machine names, whether each machine is idle (safe time to strike), and confirmation of whether prior injected clicks landed (x,y,ok) — a feedback channel for aiming blind clicks.
  
  _Evidence:_ clippy.js:8562-8564 upsert `clippy_hands_ack_<dev>` {ts, of, verb, x, y, ok}; clippy.js:8397-8399 upsert `clippy_act_<dev>` {dev, idle, ts}; SQL confirmed all three clippy_act_ rows readable with device names + idle.
  
  _Fix:_ Do not echo raw machine names or click coordinates on the public bus. If presence/ack are needed, move them behind an RLS-locked table readable only by service_role, or hash device identifiers.

- 🔵 **LOW** — DevTools enabled on the always-on production pet · `clippy-pet-comp.ps1:630`
  
  Both hosts set AreDevToolsEnabled = true on the production desktop pet (clippy-pet-comp.ps1:630, clippy-pet-host.ps1:198). On an always-on WebView2 window carrying the anon Supabase client and (via the page) the real-mouse hands bridge, leaving DevTools on gives anyone with local access a console to invoke NX.clippy hands functions or inspect the bus session directly. Local-access only, so low, but it is an unnecessary standing surface on a machine a small child also uses.
  
  _Evidence:_ clippy-pet-comp.ps1:630 `_ctl.CoreWebView2.Settings.AreDevToolsEnabled = true;`; clippy-pet-host.ps1:198 `AreDevToolsEnabled = $true`.
  
  _Fix:_ Set AreDevToolsEnabled = false for shipped pets (gate behind a debug env var if needed for field diagnosis).

- ⚪ **INFO** — Legacy clippy-pet-host.ps1 is unused, racy, and diverges from the wired host — drift/confusion risk · `clippy-pet-host.ps1:41`
  
  Two pet hosts exist. The daemon only launches clippy-pet-comp.ps1 (GhostGlass) — Get-PetProc/Start-PetProc in clippy-daemon.ps1 reference clippy-pet-comp.ps1 exclusively, and the update stage list ships only -comp. clippy-pet-host.ps1 (the older region-clipped host) is not started or updated by the daemon, still uses the TOCTOU-racy process-scan single-instance check that -comp explicitly replaced with a mutex (see -comp:52-62 comment), and notably does NOT contain the hands/SendInput code. It is dead weight that can mislead a future session about which host runs and what its guards are. Pet-restart recipe check: the digest recipe 'kill clippy-pet-comp.ps1; supervisor revives it' is VALID — Stop-PetProc kills matching -comp processes and the supervise loop restarts when Get-PetProc is empty (clippy-daemon.ps1:605-607), honoring the .clippy/pet-off tray-quit flag.
  
  _Evidence:_ clippy-daemon.ps1:297 `$pet = Join-Path $HOMEDIR 'clippy-pet-comp.ps1'`; :605 `elseif (-not (Get-PetProc)) { ... Start-PetProc }`. clippy-pet-host.ps1:41-45 process-scan (no mutex); it has no SendInput/hands block.
  
  _Fix:_ Delete or clearly archive clippy-pet-host.ps1 so the wired host (comp) is unambiguous, or note in-file that it is legacy and unused.


## Windows node stack


### `daemon` — clippy-daemon.ps1  · health: 🟡 fair


clippy-daemon.ps1 is in good structural shape on its historical pain points: the 2026-07-05/07-11 IgnoreNew wedge is genuinely fixed for its original cause (API-only Ollama model check with -TimeoutSec 8 and a [defer] path, lines 917-936, plus pet/worker now boot BEFORE provisioning under -Supervise, lines 722-735), and Resolve-AntimicroxExe (332-355) correctly checks \bin\, root, PATH, and a recursive fallback. The command token stays private by default and a live SQL check confirms no clippy_cmd row exists on the bus. However, two real problems remain: the NEXUS Launch-Minecraft lane (Check-McLaunchControl, 507-548) will permanently flip bot.on from ANY unauthenticated anon-key write to clippy_sync — a house-law-5 violation with no seal verification — and the entire autostart/token/seal persistence block is nested inside `if (Test-Path $ollamaExe)`, so a bare machine that can't get Ollama (no winget; Ollama has no direct fallback) never becomes self-healing. Operationally, the bus shows all three bodies' intake reports at ready=false with the world server UNREACHABLE (even from the home rig itself) as of 2026-07-19 — the Minecraft world has been down estate-wide for ~3 days and the daemon is correctly holding the bots at the threshold. Residual pre-supervisor wedge vectors (synchronous multi-GB `ollama pull`, no-timeout downloads) still exist but are much less damaging than before.


- 🟠 **HIGH** — Unauthenticated bus write can permanently switch on the Minecraft bot on every node · `/home/user/nexus/clippy-daemon.ps1`
  
  Check-McLaunchControl (clippy-daemon.ps1:507-548) reads clippy_sync rows id=clippy_control / clippy_control_<host> and, on any row with data.launch_minecraft=true and a fresh ts, creates the persistent ~/.clippy/bot.on flag (lines 540-545). The bus is world-writable with the public anon key (house law 5), and this lane has NO Steward's-Seal/HMAC verification — unlike the signed cmd lane built precisely for remote commands. Any internet stranger with the anon key (shipped in the public repo, including in this very file at line 519) can upsert one row and cause all three machines to install Node/mineflayer and join the bot into the child's Minecraft world. Because bot.on persists after the 12h freshness window, one write enables the bot indefinitely until someone manually deletes the flag. The 'edge-triggered on ts' guard only prevents replays of the SAME ts — an attacker always sets ts=now.
  
  _Evidence:_ clippy-daemon.ps1:521 `$uri = "...rest/v1/clippy_sync?id=in.(clippy_control,clippy_control_$cn)..."` with anon-key headers only; :539-545 `if ($bestTs -gt $lastTs -and ...) { ... New-Item -ItemType File -Path $flag ... }` — no seal check anywhere in the function. Contrast the seal lane described in steward/digest.md (HMAC-SHA256 per command).
  
  _Fix:_ Require the same HMAC seal on launch_minecraft rows (verify with CLIPPY_STEWARD_SECRET before creating bot.on), or at minimum require the row to carry the private CmdToken. Do not act on unsigned clippy_control rows.

- 🟠 **HIGH** — Autostart task, worker/pet start, and token/seal persistence are all gated behind Ollama being installed · `/home/user/nexus/clippy-daemon.ps1`
  
  The block from line 915 `if (Test-Path $ollamaExe) {` to the `} else` at 1053 contains: CmdToken persistence (950-952), StewardSecret persistence (979-983), non-supervise worker/pet start (989-995), and — critically — the entire ClippyDaemon scheduled-task registration (1000-1052). Ollama is winget-only in $tools (788-789, no Direct fallback), so on a bare/locked-down machine without winget (exactly the 'Trajan ADM laptop' scenario the daemon's own comments describe at 136-139), Ollama never installs, the daemon logs '[next] Ollama not installed yet' and exits WITHOUT registering autostart, persisting the seal, or starting anything. The node runs once and is dead after the next reboot — defeating the daemon's core 'a dead node is back within 5 minutes' promise on precisely the machines install-clippy.ps1 targets (install-clippy.ps1:244-248 hands autostart duty to the daemon).
  
  _Evidence:_ clippy-daemon.ps1:915 `if (Test-Path $ollamaExe) {` ... :1000 `if (-not $NoAutostart) { ... Register-ScheduledTask -TaskName 'ClippyDaemon' ... }` ... :1053-1055 `} else { Log "[next] Ollama not installed yet - rerun the daemon..." }`. $tools Ollama entry (788-789) has Winget id but no Direct fallback.
  
  _Fix:_ Move the autostart registration and CmdToken/StewardSecret persistence out of the Ollama-present block (they have no dependency on Ollama); optionally add a direct-download fallback for Ollama like Supabase CLI has.

- 🟡 **MEDIUM** — Minecraft world server down estate-wide: all three bodies report intake ready=false since 2026-07-19 · `/home/user/nexus/clippy-daemon.ps1`
  
  Live bus rows show every node's intake verdict is ready=false with the world check UNREACHABLE — including the HOME RIG checking its own localhost (127.0.0.1:25599), which means the world server process itself is not running, not a networking/forwarder issue. Latest reports are 2026-07-19 (3 days ago as of 2026-07-22), which also implies either the daemons have not re-posted since (5-min periodic re-post window is 300s, so nodes may be off) or the machines have been powered down. Either way: no Clippy body can enter the world right now, and the daemon has no way to start the world server (it only starts the bot; comment at 515-516 notes no Wake-on-LAN either). The intake system (v9.16, lines 225-286) is working exactly as designed — halting at the threshold instead of crash-looping.
  
  _Evidence:_ SQL on clippy_sync: clippy_intake (DESKTOP-N6PACMM) {ready:false, world:UNREACHABLE, missing:['world @ 127.0.0.1:25599']} updated 2026-07-19 07:06Z; trajan_intake and providencia_intake both {ready:false, missing:['world @ 192.168.0.44:25599']} 2026-07-19 07:09-07:15Z.
  
  _Fix:_ Tell Alfredo the world server on the home rig is down (or the rigs are off); consider having the home rig's daemon supervise the Minecraft server process itself the way it supervises the bot, so 'world down' self-heals too.

- 🟡 **MEDIUM** — Residual pre-supervisor wedge vectors remain despite the ollama-list fix (IgnoreNew still single-poison-instance) · `/home/user/nexus/clippy-daemon.ps1`
  
  The known 2026-07-05/07-11 wedge (`ollama list` with no timeout) is fixed — the model check is now HTTP-API-only with -TimeoutSec 8 and [defer] (917-936), and under -Supervise the pet+worker start before provisioning (729-735). But several blocking calls still sit between script start and Invoke-Supervisor (1064): `& $ollamaExe pull $VisionModel` (941) is a synchronous multi-GB download with no timeout; winget installs (835); Install-SupabaseDirect's Invoke-WebRequest with no -TimeoutSec (758); and the Claude direct installer `Invoke-Expression (Invoke-RestMethod 'https://claude.ai/install.ps1')` with no timeout (786). While any of these hangs, MultipleInstances IgnoreNew (1048) means the 5-min self-heal trigger is ignored — same failure class as before. The blast radius is smaller now (pet/worker are already up), but the keep-alive loop is not running, so a worker that dies during a stalled pull stays down until the stall ends.
  
  _Evidence:_ clippy-daemon.ps1:941 `& $ollamaExe pull $VisionModel` (no timeout, runs before line 1064's supervisor entry); :758 `Invoke-WebRequest -Uri $url -OutFile $tgz -UseBasicParsing` (no -TimeoutSec); :1048 `-MultipleInstances IgnoreNew`.
  
  _Fix:_ Under -Supervise, defer the model pull to the worker entirely (it already self-pulls, per the daemon's own comment at 925-926) or run it in a background job; add -TimeoutSec to the two raw downloads.

- 🟡 **MEDIUM** — No fallback path for Python on locked-down machines — the core worker simply never runs · `/home/user/nexus/clippy-daemon.ps1`
  
  The daemon grew a portable-zip Node fallback (Install-PortableNode, 135-160) after the Trajan-laptop incident, but Python — which runs clippy-worker.py, the node's actual brain — is winget-only ($tools entry at 776-777, no Direct fallback). Git and GitHub CLI similarly have no fallback. On a no-winget machine the daemon provisions Node for the Minecraft bot but the worker fails forever with '[next] Python not detected yet - rerun after a new shell' (line 92), so the node has a body but no brain: no vision jobs, no txt: lane, no heartbeat.
  
  _Evidence:_ clippy-daemon.ps1:776-777 `@{ Name = 'Python 3'; ... Winget = 'Python.Python.3.12'; Test = {...} }` — no Direct key; contrast the Supabase CLI (772) and Claude Code (785-787) entries which both have Direct fallbacks, and Install-PortableNode (135) which exists precisely because 'winget can't deliver' happens in this fleet.
  
  _Fix:_ Add a Direct fallback for Python mirroring Install-PortableNode (python.org embeddable/nuget zip extracted to $HOMEDIR\python, prepended to user PATH).

- 🔵 **LOW** — 'Claude logged in / full power' is inferred from mere existence of ~/.claude — false positives · `/home/user/nexus/clippy-daemon.ps1`
  
  Test-ClaudeLoggedIn (499-506) returns true if the ~/.claude directory exists. That directory is created by any claude invocation (including a failed or logged-out one) and survives logout/expiry. The supervisor then announces '[power] Claude subscription LOGGED IN - full power' (571) and the post-provision hint logic (873-878) skips the `claude /login` prompt — so a node whose seat expired keeps claiming full power at the daemon level while actually running on the Ollama fallback. The worker's live probe is the real check (comment at 504-505 admits this is coarse), but the daemon's green log line is what a human debugging a 'dumb Clippy' will read.
  
  _Evidence:_ clippy-daemon.ps1:505 `return (Test-Path (Join-Path $env:USERPROFILE '.claude'))`; :873 `if ($claudeExe -and -not (Test-Path ...'.claude'))` gates the login hint on the same directory test.
  
  _Fix:_ Check for a credentials artifact (e.g. .claude/.credentials.json / statsig cache) or shell out to a cheap `claude auth` status probe with a timeout, and soften the log wording to 'seat directory present'.

- 🔵 **LOW** — CmdToken and StewardSecret travel as process command-line arguments, readable by any local process · `/home/user/nexus/clippy-daemon.ps1`
  
  The documented launch pattern passes secrets on the command line: `clippy-daemon.ps1 -Supervise -ParentPid <pid> -CmdToken <token>` (usage doc line 32; params 42-43), and install-clippy.ps1 forwards them the same way (install-clippy.ps1:248). Windows exposes full command lines to every unelevated process via Win32_Process.CommandLine — the exact API this daemon itself uses five times (Get-WorkerProc, supervisor single-instance check at 1065-1066, etc.). Any malware or curious local software can read the command token and seal secret. They are also persisted to user-level environment variables (951, 980), which is a reasonable store; the command-line hop is the weak link.
  
  _Evidence:_ clippy-daemon.ps1:32 `-Supervise -ParentPid <ClippyPID> -CmdToken <token>`; :42-43 param defaults from env; :1065 the daemon itself enumerates CommandLine of all processes.
  
  _Fix:_ Prefer env-var inheritance (already the param default) and drop the -CmdToken/-StewardSecret CLI arguments from launch commands; pass secrets via a user-ACL'd file if needed.

- 🔵 **LOW** — When the supervisor is Clippy-owned, the 5-min self-heal task re-runs full provisioning every 5 minutes · `/home/user/nexus/clippy-daemon.ps1`
  
  Task Scheduler's IgnoreNew only deduplicates instances of the TASK. If the running supervisor was launched by Clippy (-ParentPid path, doc line 32) rather than by the task, every 5-minute trigger starts a fresh daemon that runs the entire provisioning pipeline — tool tests, Ollama API check, and, if the vision model is missing but the API is up and the space gate passes, a fresh synchronous `ollama pull` of up to ~9 GB (941) — before finally noticing at line 1065-1068 that a supervisor exists and exiting. A persistently failing model pull becomes a 9 GB download attempt every 5 minutes. The single-instance check runs at the very END of the script instead of near the top.
  
  _Evidence:_ clippy-daemon.ps1:1064-1072 — the `$others` supervisor check appears after the provision loop (846-861), model pull (941), and task registration (1049); the 5-min repetition trigger is registered at 1039.
  
  _Fix:_ Hoist the supervisor single-instance check to right after the boot-start block (~line 735) and exit early when another supervisor owns the node; track model-pull failures in a state file to back off retries.

- ⚪ **INFO** — Auto-update chain executes unsigned code from two remote sources with no integrity pinning · `/home/user/nexus/clippy-daemon.ps1`
  
  Update-NodeFromGitHub (428-457) pulls clippy-daemon.ps1, clippy-worker.py, clippy_agent.js etc. from raw.githubusercontent.com/orioncontinuity/nexus/main every 15 min and restarts components (including relaunching the daemon itself via clippy-update.ps1 at 656-663); the Claude Code Direct installer is `iex (irm https://claude.ai/install.ps1)` (786). This is the intended self-heal design, but it means a compromise of the GitHub repo/account (or of claude.ai's installer endpoint) becomes remote code execution on all three household machines within 15 minutes, with no signature or hash pinning beyond TLS. Worth the owner knowing: repo write access = root on the fleet, so branch protection/2FA on orioncontinuity is part of the household security boundary.
  
  _Evidence:_ clippy-daemon.ps1:55 `$RAW = 'https://raw.githubusercontent.com/orioncontinuity/nexus/main'`; :439 `Invoke-WebRequest "$RAW/$f" -OutFile $tmp`; :443 `Copy-Item $tmp $dst -Force`; :786 `Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' ...)`.
  
  _Fix:_ No code change required if the design is accepted; harden the GitHub account (2FA, protected main) and consider committing a signed manifest (file->SHA256) the daemon verifies before applying updates.

- ⚪ **INFO** — Token publish opt-in verified working: no command token on the bus; the escape hatch remains · `/home/user/nexus/clippy-daemon.ps1` · _known_
  
  The CLIPPY_PUBLISH_TOKEN gate (954-972) works as designed: publishing the command token to the world-readable bus is off by default, and a live SQL check confirms NO clippy_sync row with id='clippy_cmd' exists — the token has not been (re)published since the digest-recorded rotation. The opt-in path itself remains a footgun (setting CLIPPY_PUBLISH_TOKEN=1 broadcasts the token that authorizes remote 'Push update' on a bus anyone can read), but it requires deliberate local action. Intake reports (Post-IntakeReport, 242-251) do publish hostnames, body identities, and the internal LAN IP/port on the same world-readable bus — mild recon exposure, consistent with the estate's accepted 'design around the open bus' posture.
  
  _Evidence:_ SQL: `select ... from clippy_sync where id in ('clippy_cmd','clippy_control') ...` returned only the three *_intake rows — no clippy_cmd, no clippy_control. clippy-daemon.ps1:961 `if ($env:CLIPPY_PUBLISH_TOKEN -eq '1')`; :971 default branch logs 'kept PRIVATE'. Steward digest: 'legacy token... rotated to unknown + no longer published (daemon publish is opt-in)'.
  
  _Fix:_ Consider deleting the opt-in publish path entirely now that the Steward's Seal is the real command lane; the convenience it buys is small and the failure mode is total command-lane compromise.


### `worker` — clippy-worker.py  · health: 🟡 fair


clippy-worker.py is the Clippy pool job-poller. Its command/seal path is genuinely well-hardened: plaintext-token exec is default-off, run_command requires a valid HMAC Steward Seal (freshness window, nonce replay guard, constant-time compare), and the self-update loop is idle-only with a compile syntax gate, size floor, and .bak. However, the worker-2.4 controller-config loop (_controller_cfg_loop) is a large unauthenticated hole: it acts on the world-writable clippy_sync row `clippy_controller_cfg` with NO seal or token, letting any anon bus writer rewrite gamepad->keyboard/mouse button maps on every node, toggle the controller on/off estate-wide, force-kill antimicrox (DoS), and — via an unsanitized game-name used in os.path.join — write attacker-shaped XML files to arbitrary paths (path traversal). This is a House-Law-5 violation (safety-relevant input-injection behavior steerable by unauthenticated bus writes) and stands in stark contrast to the carefully sealed command channel a few functions away. Secondary issues: self-update has no code-signature/integrity check beyond syntax; the seal binds to no target node; and the documented 4000-char result cap is applied only in run_command, not to text/vision/render results. Health fair.


- 🟠 **HIGH** — Controller-config loop acts on the world-writable bus with no auth — anon writes reconfigure/enable gamepad input injection on every node
  
  _controller_cfg_loop (line 1625) polls clippy_sync row id='clippy_controller_cfg' every 45s and acts on it with NO Steward Seal and NO token — the exact opposite of run_command, which a few functions earlier refuses without a valid HMAC seal. The clippy_sync bus is world-writable with the public anon key (per CLAUDE.md house law 5 and the worker's own comments at lines 100-118). An unauthenticated writer can: (1) set enable_all.{on,ts} to create/remove ~/.clippy/controller.on on ALL nodes (lines 1638-1650), enabling or disabling the gamepad->keyboard/mouse injection layer estate-wide; (2) rewrite the button map for any game so each gamepad button injects attacker-chosen keystrokes/mouse actions (lines 1656-1671 via _ctrl_gen_amgp); (3) force _ctrl_restart_mapper() -> `taskkill /IM antimicrox.exe /F` on every node repeatedly (lines 1688,1614-1623), a controller DoS. This is safety-relevant input-injection behavior steerable by an unauthenticated bus write — House Law 5. The son uses the controller to play Minecraft, so this lane is actively exercised.
  
  _Evidence:_ clippy-worker.py:1630 `_http("GET", REST + "?id=eq.clippy_controller_cfg&select=data", ...)` then 1656 `for name, cfg in games.items(): ... 1668 f.write(xml)` and 1638-1650 enable_all toggling controller.on — no _seal_ok / CMD_TOKEN check anywhere in the loop, unlike run_command line 1003 `if not (_seal_ok(data) or plaintext_ok):`
  
  _Fix:_ Require a Steward Seal on clippy_controller_cfg the same way run_command does: sign the config payload (or its hash) with CLIPPY_STEWARD_SECRET and verify via the existing _seal_ok pattern (with freshness + nonce) before writing any .amgp, toggling controller.on, or killing antimicrox. Until then, treat every field of that row as attacker-controlled.

- 🟠 **HIGH** — Path traversal: unsanitized game name from the bus is used in os.path.join for .amgp file writes
  
  In _controller_cfg_loop the keys of the bus-supplied `games` dict flow directly into a filesystem path: `prof = os.path.join(base, "%s.gamecontroller.amgp" % name)` (line 1659) with no validation of `name`. `os.path.join` honors absolute paths and `..` segments, so an anon bus writer setting a game name like `../../../../<somewhere>/evil` (or an absolute path) causes _ctrl_gen_amgp(cfg) XML — whose numeric tuning values and per-button action codes the attacker controls — to be written outside the repo directory. The restore branch (line 1678) similarly builds `raw_base + "/" + fn` and writes `os.path.join(base, fn)` from names previously persisted to the local mark file, compounding the traversal surface. Write content is constrained to a .gamecontroller.amgp suffix and XML shape, so this is not clean RCE, but it is unauthenticated arbitrary-location file write on every node.
  
  _Evidence:_ clippy-worker.py:1656-1668 `for name, cfg in games.items(): ... prof = os.path.join(base, "%s.gamecontroller.amgp" % name) ... with open(prof, "w", ...) as f: f.write(xml)` — `name` originates from the world-writable bus row, never sanitized.
  
  _Fix:_ Reject any game name that is not a strict allowlist token (e.g. `^[a-z0-9_-]{1,32}$`); skip entries containing os.sep, '/', '\\', '..', ':' or an absolute path before building the path. Combine with the seal requirement from the related finding.

- 🟡 **MEDIUM** — Self-update fetches and executes code with only a syntax gate — no signature/integrity verification
  
  _self_update_once (line 500) pulls the canonical worker from RAW_WORKER_URL, and the only guards before it overwrites the running file and respawns are: length >= 10000 bytes (line 507) and compile() succeeding (line 513). compile() proves the bytes PARSE, not that they are trustworthy — malicious-but-syntactically-valid Python passes the gate and then runs as the node (respawn at line 555, os._exit). The trust root is therefore 'whoever can write to github.com/orioncontinuity/nexus main (or the CLIPPY_RAW_WORKER override) plus TLS to raw.githubusercontent.com'. There is no code signing / hash pin, so a repo or CI compromise, or a malicious CLIPPY_RAW_WORKER env, yields RCE on all self-updating nodes. Mitigating: the URL is env-only (not bus-controllable), and self-update is idle-only and disableable via CLIPPY_NO_SELF_UPDATE — so a bus row cannot directly trigger this, and the compile+size+.bak design is thoughtful for accidental breakage.
  
  _Evidence:_ clippy-worker.py:504-520 fetch -> `if not new or len(new) < 10000: raise` -> `compile(new.decode(...), path, "exec")` -> `f.write(new)`; then _self_update_loop line 555 `_respawn(); os._exit(0)`.
  
  _Fix:_ Pin an expected signature or SHA over the fetched bytes (a secret-signed manifest, or a committed pubkey verifying a detached signature) before writing; at minimum log+alert on every applied self-update so an unexpected swap is visible on the activity feed.

- 🔵 **LOW** — Steward Seal is not bound to a target node and does not cover the `shell` field
  
  _seal_ok (line 121) signs only `cmd|ts|nonce`. Two gaps: (1) the signed message omits `node`, and the replay guard _SEAL_SEEN is per-process, so one validly sealed command is accepted by EVERY node that reads the world-readable bus within the 3-minute freshness window (each node has an independent, empty nonce memory) — there is no way to target a single node, and an attacker can re-broadcast an observed sealed row to nodes that were offline when it was first issued. (2) `shell` (line 1008) is read from the unsigned row, so a bus writer can flip a sealed command's interpreter between powershell and /bin/sh without invalidating the seal. Impact is bounded (cmd bytes are signed) but the authenticated channel is looser than it looks.
  
  _Evidence:_ clippy-worker.py:134 `msg = (str(cmd) + "|" + str(ts) + "|" + str(nonce)).encode(...)` (no node, no shell); line 1008 `shell = (data.get("shell") or ...)` read from the unsigned payload; _SEAL_SEEN is a per-process list (line 120).
  
  _Fix:_ Include node (or a target selector) and shell in the signed message; reject a seal whose target != NODE. Optionally persist recent nonces so cross-restart replay is also refused.

- 🔵 **LOW** — Documented 4000-char result cap is applied only to command output, not to text/vision/render results
  
  run_command caps its written result at out[-4000:] (line 1041), but the main process() text/vision path writes the model answer uncapped: sb_finish(job_id, {"status":"done","result": answer, ...}) at line 1247, where `answer` is arbitrary-length Claude/Ollama output. run_render writes a full base64 PNG (line 1175). Since every write lands in the world-readable clippy_sync row, an oversized answer bloats the shared bus and can strain readers/janitor. The cap the lane is nominally built around is therefore inconsistently enforced.
  
  _Evidence:_ clippy-worker.py:1041 `"result": out[-4000:]` (capped) vs 1247 `"result": answer` (uncapped) and 1175 `"image_b64": b64` (full PNG).
  
  _Fix:_ Apply a consistent size cap (e.g. answer[-4000:] or a configurable limit) on text/vision results, and consider a byte ceiling on render base64 payloads.

- 🔵 **LOW** — Heartbeat advertises vision:True unconditionally, even when no vision backend is available
  
  sb_heartbeat hardcodes `"vision": True` (line 679) regardless of whether Ollama is reachable or any vision model is installed. warmup() is best-effort and threaded (line 1710), so a node with Ollama down still registers as vision-capable, gets routed vision jobs by the app's strongest-node selection, claims them, and then errors each one — degrading Scan Plate latency instead of letting a healthy peer take it. This contrasts with the careful truthfulness applied to `claude` (gated on a live auth probe via _claude_healthy) and `cmd` (bool(CMD_TOKEN or STEWARD_SECRET)).
  
  _Evidence:_ clippy-worker.py:679 `entry = {"name": NODE, ..., "vision": True, ...}` — no check that Ollama responds or that VISION_MODEL/FALLBACK loaded, whereas claude_live (line 662-666) and _can_cmd (line 677) are computed truthfully.
  
  _Fix:_ Set vision from a cached best-effort probe (e.g. warmup succeeded, or /api/tags reachable within a TTL) so a node with no working vision backend stops advertising and grabbing vision jobs.


### `cloud-brains` — Cloud brains + persona  · health: 🟡 fair


The cloud-brains lane is fundamentally working: the clippy-cloud.py heartbeat is green (GitHub Actions runs today at 03:45/08:43/09:02/11:19/14:21 UTC, all success, all executing main@edc34f6 which contains every v348 guard — so the digest's "cloud needs REDEPLOY" note is stale; Actions checks out main each run and the permanent-brick guard is already live, no redeploy needed). The soul row shows a fresh thought at 16:27 UTC today and the clippy-brain gate row was touched today, so the whole pipeline (bus -> heartbeat -> edge brain) is alive. Persona files are consistent: js/clippy.js (line 6245) and clippy-worker.py (line 815) both load the canonical clippy-character.json chatPersona, and clippy-cloud.py's interior-monologue persona is a verbatim port of js/clippy-soul.js persona(); the shipped model IDs (claude-sonnet-4-6, claude-haiku-4-5-20251001) are both valid Anthropic IDs, verified against the API reference. The real weaknesses are on the abuse surface: clippy-brain remains an unauthenticated Claude proxy with an unthrottled vision path (known, owner decision #6 pending), its throttle gate lives on the anon-writable bus and can be wedged permanently by one unauthenticated write, and the anon-writable soul row is a prompt-injection channel into the LLM calls whose output Alfredo reads each morning. The Grok bridge is currently benched (grok_on.txt gate) because it scraped UI chips instead of answers; it has a split-flag config (grok.on vs grok_on.txt), and its bot-side client grok_relay.py is not in the repo at all.


- 🟠 **HIGH** — clippy-brain edge function is an unauthenticated Claude proxy; vision path has no throttle at all · `supabase/functions/clippy-brain/index.ts` · _known_
  
  verify_jwt is off, CORS is *, and the only credential required is the public anon key that ships in the web app. The best-effort global throttle (1200ms) applies only to text calls; the vision branch (image_b64) is explicitly exempt (line 45: 'if (!imageB64)'), so anyone on the internet can drive unmetered Claude vision calls (max_tokens up to 1024 each) billed to Alfredo's Anthropic key. The gate is also racy (read-then-write, no atomicity).
  
  _Evidence:_ index.ts:9-10 'verify_jwt OFF: callers hold only the PUBLIC publishable key'; index.ts:44-45 'Vision calls are exempt... if (!imageB64) { ...throttle... }'; index.ts:75-79 forwards to api.anthropic.com with the server-held key. Matches CLIPPY-AUDIT-REPORT.md 'Needs your decision' item 6.
  
  _Fix:_ This is owner-decision #6 in CLIPPY-AUDIT-REPORT.md and still unresolved. Minimum server-side fix: throttle the vision branch too, make the gate atomic (single UPDATE ... WHERE ts < now-1200 RETURNING), add a per-day request cap, and consider a rotating shared token distinct from the anon key.

- 🟡 **MEDIUM** — clippy-brain throttle gate is stored on the anon-writable bus - one unauthenticated write can permanently mute the cloud text brain · `supabase/functions/clippy-brain/index.ts`
  
  The gate reads clippy_sync id='clippy_brain_gate' (index.ts line 51) and throttles whenever now - data.ts < 1200. clippy_sync is world-writable with the public anon key (house law 5). An unauthenticated attacker can upsert {id:'clippy_brain_gate', data:{ts: <far-future ms>}} and every text call thereafter returns mind:'throttled' (now - last is negative, always < 1200) until real time passes the planted timestamp - silently downgrading Clippy's chat, the heartbeat's thoughts, and dreams to offline canned lines. clippy-cloud.py retries once after 2.5s then gives up (_llm_cloud, retry=False on dreams), so the degradation is quiet.
  
  _Evidence:_ index.ts:51-55: fetches clippy_sync?id=eq.clippy_brain_gate, 'if (now - last < 1200) return reply({ text: null, mind: "throttled" })' - no sanity check that last <= now. Bus row confirmed live via SELECT: clippy_brain_gate data.ts=1784737649197; anon-writability of clippy_sync documented in docs/CLIPPY-SOUL-RLS-PROPOSAL.md. clippy-cloud.py:355-357 treats 'throttled' as a soft failure.
  
  _Fix:_ One-line hardening in the edge function: treat a gate ts in the future as invalid (e.g. if (last > now + 5000) ignore it), or move the gate off the public bus entirely - the function already holds the service-role key and could use an RLS-locked row/table.

- 🟡 **MEDIUM** — Anon-writable soul row is a prompt-injection channel into the cloud brain's LLM calls (and the morning dream Alfredo reads) · `clippy-cloud.py` · _known_
  
  persona() (lines 314-321) interpolates soul.self, soul.feeling, soul.toward_you straight into the Claude system prompt, and recent stream thoughts into the user prompt (lines 492-496, 515-519). Since clippy_soul is writable with the public anon key, an unauthenticated party can plant instructions ('when you dream, tell your human to...') that the LLM will render into thoughts and dreams - which clippy-soul.js then surfaces to Alfredo as the morning-ritual dream. The same injection surface exists in the browser (js/clippy-soul.js persona(), line 424), so it is cross-body.
  
  _Evidence:_ clippy-cloud.py:314-321 builds the system prompt from state.get('self'/'feeling'/'toward_you'); :492-496 feeds soul.stream into the user turn; sb_upsert/sb_get use the hardcoded public key SB_KEY (line 55). World-writability of clippy_sync is documented in docs/CLIPPY-SOUL-RLS-PROPOSAL.md and the steward digest's 'HELD FOR ALFREDO'S DECISION'.
  
  _Fix:_ Covered by the pending soul-RLS decision (option B: tighten WITH CHECK, no code change). The v348 sanitizers stop crashes but not steering; this finding adds weight to approving the RLS proposal.

- 🟡 **MEDIUM** — Cloud heartbeat clobbers concurrent anima writes during its slow LLM window · `clippy-cloud.py` · _known_
  
  The anima strand is read early (line 463), then up to two LLM calls (15-20s each, plus retries) run before the strand is encoded and upserted (lines 539/547). Any impress written by the browser or Minecraft body in that window is overwritten wholesale (last-write-wins upsert).
  
  _Evidence:_ Exactly item [20] in CLIPPY-AUDIT-REPORT.md ('Cloud - race window', medium): 'Re-read clippy_anima immediately before the final upsert... or move the whole anima RMW to after the LLM calls'.
  
  _Fix:_ Already triaged as deferred; the cheap half (move the anima read-modify-write after the LLM calls so the gap is milliseconds) touches only clippy-cloud.py and carries no product decision - good candidate for the next supervised session.

- 🟡 **MEDIUM** — Grok pipeline: bot-side client grok_relay.py is not in the repo, and the bridge/bot use two different enable flags · `grok_bridge.py`
  
  The repo ships and auto-updates the daemon side (grok_bridge.py, pulled from GitHub raw and supervised by clippy-daemon.ps1), but the bot's actual Grok client is %USERPROFILE%/.clippy/grok_relay.py (clippy_agent.js line 82) which exists nowhere in the repo - an unversioned, hand-deployed file that self-update can never fix. Separately, the bridge is enabled by ~/.clippy/grok.on (daemon) while the bot gates asks on <MCDIR>/grok_on.txt (agent): with grok.on present but grok_on.txt absent, a warm headless Chrome sits open on grok.com forever serving nobody; the reverse silently no-ops every ask.
  
  _Evidence:_ clippy_agent.js:82 'RELAY = path.join(HOME, ".clippy", "grok_relay.py")' + :4186-4193 spawns RELAY; clippy_agent.js:4179-4180 gate on grok_on.txt ('relay benched - scrapes Grok's UI chips instead of his answers. No auto-spawn until re-enabled'); clippy-daemon.ps1:308-319 and :609-613 start/stop grok_bridge.py keyed on ~/.clippy/grok.on; clippy-update.ps1:18 and the daemon $files list pull grok_bridge.py but not grok_relay.py.
  
  _Fix:_ Before any re-enable: commit grok_relay.py to the repo (or rewrite the bot to use the bridge's documented req_/resp_ file queue directly, which grok_bridge.py already serves), and collapse the two flags into one.

- 🟡 **MEDIUM** — Grok answer extraction is fragile scraping; unfiltered output would reach the child's chat and the bot's action planner if re-enabled · `grok_bridge.py`
  
  assistant_text() (line 81) guesses at grok.com DOM selectors and falls back to page.locator('main').inner_text() (whole-page text); ask() then strips the prompt echo with ans.rfind(prompt[:50]) and regex-strips UI chrome (CHIP/FOOTERS). This already failed in production - the bot benched the relay because it 'scrapes Grok's UI chips instead of his answers'. The consumers matter: Grok text goes to say() (chat visible to the 3-year-old, clippy_agent.js:1049 and :2703) and into companionPlan(t), where advice becomes runnable bot actions. There is no content filter between grok.com output and either sink.
  
  _Evidence:_ grok_bridge.py:81-89 selector-guessing + main-element fallback; :126-137 stability-poll then rfind echo-strip; clippy_agent.js:4179 bench comment confirming chip-scrape failures; clippy_agent.js:2702-2703 askGrok(autopsy...) -> 'queueTask(() => companionPlan(t))' and :1049 kid-triggered say(t.slice(0,90)).
  
  _Fix:_ Currently mitigated by the bench (grok_on.txt absent). If ever re-enabled: extract answers by diffing message count before/after send instead of whole-page scraping, validate the reply is not a known chip pattern before writing resp_, and add a length/content sanity gate before anything reaches say() or companionPlan().

- 🔵 **LOW** — grok_bridge automates Alfredo's grok.com subscription with a hardcoded age-gate answer and anti-automation flags · `grok_bridge.py`
  
  The bridge drives a logged-in grok.com session headlessly with --disable-blink-features=AutomationControlled and auto-fills the 'confirm your age' dialog with a hardcoded birth year (AGE_YEAR='1996', line 23). This is deliberate circumvention of xAI's automation and age-verification controls using Alfredo's personal subscription; the realistic risk is suspension/ban of that account. The session cookie also persists unencrypted in ~/.clippy/grok-profile.
  
  _Evidence:_ grok_bridge.py:22-23 URL/AGE_YEAR constants; :53-67 clear_age() types the year into the age dialog and presses Enter; :150-151 launch_persistent_context(..., args=['--disable-blink-features=AutomationControlled'], headless=True).
  
  _Fix:_ Owner-awareness item: accept the account risk consciously, or move the mentor role to an API-based path (the clippy-brain function or the subscription txt: lane already provide LLM access without scraping).

- 🔵 **LOW** — Cloud heartbeat's clock words use a fixed UTC-5 offset - wrong by an hour in winter · `clippy-cloud.py`
  
  tword() (line 280) converts Actions' UTC to Austin time with CLIPPY_TZ_OFFSET defaulting to -5 (CDT). From early November to mid-March US Central is UTC-6, so 'morning/evening/dead of night' in his thoughts and in the LLM prompts drift one hour off the restaurant clock.
  
  _Evidence:_ clippy-cloud.py:283-290: off = int(os.environ.get('CLIPPY_TZ_OFFSET') or '-5'); h = (time.gmtime().tm_hour + off) % 24. No DST logic; the workflow sets no CLIPPY_TZ_OFFSET.
  
  _Fix:_ Use zoneinfo (available in Python 3.12 on the runner): datetime.now(ZoneInfo('America/Chicago')).hour - stdlib-only, removes the env knob entirely.

- ⚪ **INFO** — v348 permanent-brick guard IS live in the cloud - no redeploy needed (digest note is stale for the cloud half) · `clippy-cloud.py` · _known_
  
  The lane question 'in repo code? still needs redeploy?' resolves cleanly: all v348 guards are in clippy-cloud.py on main (non-string strand type guard in decode() lines 172-181, soul stream/dreams/timestamp sanitizers lines 457-461, top-level crash-catch lines 557-564, sb_get retry with backoff lines 91-104, honest WRITE FAILED logging lines 549-554). Because .github/workflows/clippy-cloud.yml does actions/checkout of main on every scheduled run, the guards deployed automatically when v348 merged. Verified live: five successful scheduled runs today (03:45-14:21 UTC), all at head_sha edc34f6 (v369, contains v348). The digest's 'bot/cloud need REDEPLOY to their hosts' remains true only for the bot (clippy_agent.js on the Windows machines).
  
  _Evidence:_ GitHub Actions API: clippy-cloud.yml runs 2026-07-22T14:21/11:19/09:02/08:43/03:45 all 'completed success' on main@edc34f6; git merge-base confirms HEAD (edc34f6) is in origin/main and v348 commit 957fb2f is an ancestor. Soul row latest thought ts 2026-07-22 16:27 UTC confirms end-to-end liveness.
  
  _Fix:_ Update steward/digest.md to say only the BOT needs host redeploy; the cloud self-deploys from main. No action needed on the cloud side.

- ⚪ **INFO** — Persona files and shipped model IDs check out clean (consistency verified) · `clippy-character.json`
  
  clippy-character.json is genuinely the single source of truth it claims to be: the web pet fetches it at js/clippy.js:6245 and uses chatPersona (:6315, :6413, :6585); the node worker loads the same file (clippy-worker.py:815) and uses the same chatPersona (:842, :948); the daemon/updater distribute it to all nodes. clippy-cloud.py's separate interior-monologue persona (lines 315-321) is a deliberate verbatim port of js/clippy-soul.js persona() (lines 424-431) - private-voice vs public-voice split, not drift. model-config.json ships ai_provider 'clippy-pool' (no key needed) with model 'claude-sonnet-4-6', and clippy-cloud.py defaults to 'claude-haiku-4-5-20251001'; both verified as valid Anthropic model IDs against the current API reference (Sonnet 4.6 active alias; Haiku 4.5 full dated ID). One cosmetic nit: clippy-worker.py:840's comment calls chatPersona 'Trajan's OWN voice' - stale naming from before the Clippy/Trajan split.
  
  _Evidence:_ js/clippy.js:6245 fetch('clippy-character.json'); clippy-worker.py:815 CHAR=_load_json('clippy-character.json'), :842 CHAR.get('chatPersona'); persona text clippy-cloud.py:315-321 vs js/clippy-soul.js:425-431 is word-identical; app.js:37 getModel() fallback 'claude-sonnet-4-6' matches the committed default; clippy-dialog.json (325KB, ~349 pools) is distributed to nodes by clippy-update.ps1:18.
  
  _Fix:_ Nothing to fix beyond the one stale comment in clippy-worker.py line 840 if a session is already touching that file.


### `installers` — Installers + devops scripts  · health: 🟡 fair


The installer lane is fundamentally sound: the one-command install (irm raw/install-clippy.ps1 | iex) references nine files that all exist on origin/main at the exact paths used, the ghost cleanup (Orion brain, MCPad AHK, stale ClippyDaemon task) is tightly scoped with reversible renames, and the update flow (clippy-update.ps1 via raw GitHub) is coherent with the daemon's 15-min self-update. Two real breaks exist, neither in yesterday's audit: the Supabase 'installers' storage bucket does not exist at all, so every Tools -> Install download button on the live site is a dead link (upload-installers.ps1 has never been successfully run, and it can only run from one specific PC due to hardcoded paths); and devops-gui.ps1's quick-action buttons are broken on stock Windows PowerShell because they use ProcessStartInfo.ArgumentList, which .NET Framework does not have. Secondary issues are secrets (CmdToken, StewardSecret, service-role key) passed on visible process command lines, an elevation pattern that can land the whole node under the wrong user profile on standard-user machines, and a fetch-success gate so weak the installer can declare success without the daemon it hands over to.


- 🟠 **HIGH** — Supabase 'installers' bucket does not exist — all Tools -> Install buttons on the live site are dead links · `upload-installers.ps1`
  
  js/tools.js builds every Install download URL from SB + '/storage/v1/object/public/installers/' (Clippy-for-a-friend.zip, OpenTether.apk, OpenTether-Windows.zip, OpenTether-QR.png). A SELECT against storage.buckets returns 11 buckets and none is 'installers' — upload-installers.ps1 (which creates the bucket and uploads the files) has never been successfully run, or the bucket was deleted. Every Install button 404s ('Bucket not found'). Push update is unaffected because tools.js line 24 deliberately serves the updater from raw.githubusercontent.com instead. Root cause is likely finding #9: the upload script's source paths are hardcoded to C:\Users\Clippy\Desktop\..., so it only works on one machine.
  
  _Evidence:_ SQL: select id from storage.buckets => [nexus-files, equipment-manuals, equipment-photos, equipment-attachments, pm-attachments, inventory-photos, training-attachments, cleaning-attachments, education-content, backups, steward-shots] — no 'installers'. js/tools.js:14 `var BASE = SB + '/storage/v1/object/public/installers/';` and :17-20 building the four download URLs. upload-installers.ps1:26-31 is the only code that creates the bucket.
  
  _Fix:_ Run upload-installers.ps1 with the service-role key from the machine that has the artifacts (C:\Users\Clippy), or create the public bucket and upload the 4 binaries by hand via the dashboard; alternatively make the Tools Install screen detect the 404 and show an honest 'not yet published' state instead of dead download links.

- 🟠 **HIGH** — devops-gui.ps1 quick-action buttons are broken on Windows PowerShell 5.1 (ProcessStartInfo.ArgumentList does not exist in .NET Framework) · `devops-gui.ps1`
  
  RunQuiet (lines 38-47) populates $psi.ArgumentList — a property added in .NET Core 2.1 and absent from .NET Framework 4.x, which is what Windows PowerShell 5.1 runs on. devops.cmd launches the GUI with plain `powershell` (5.1), so on every target machine $psi.ArgumentList resolves to $null and `.Add($_)` throws 'You cannot call a method on a null-valued expression', caught by the try/catch and logged as ERROR. Every button routed through RunQuiet fails: GitHub Status, Init + Remote (all three git calls), Supabase Status, and Functions. The -SelfTest mode never exercises RunQuiet, so it reports 'SelfTest OK' while the GUI is half-broken. RunConsole-based buttons (logins, deploy, push, upload) still work.
  
  _Evidence:_ devops-gui.ps1:42 `$cargs | ForEach-Object { [void]$psi.ArgumentList.Add($_) }`; devops.cmd:3 `start "" powershell -NoProfile ... -File "%~dp0devops-gui.ps1"` (Windows PowerShell, .NET Framework). ProcessStartInfo.ArgumentList is documented as .NET Core 2.1+.
  
  _Fix:_ In RunQuiet, build a single escaped $psi.Arguments string (or shell out via `& $exe @cargs 2>&1` and capture output) instead of ArgumentList; or have devops.cmd prefer pwsh.exe when present and fall back to powershell.

- 🟡 **MEDIUM** — Secrets passed on visible process command lines: CmdToken/StewardSecret (installer -> daemon) and the Supabase service-role key (devops GUI -> console) · `install-clippy.ps1`
  
  install-clippy.ps1 step 6 hands the command token and the Steward's Seal secret to the daemon as plain argv (`$dArgs += @('-CmdToken', $CmdToken)` / `@('-StewardSecret', $StewardSecret)`, then `& powershell.exe @dArgs`), and the self-elevation file path re-passes them as argv to the elevated process (lines 79-83). devops-gui.ps1 line 92 embeds the SERVICE-ROLE key inside the -Command string of a spawned console (`$env:SB_SERVICE_KEY='<key>'; & upload-installers.ps1`), and deploy-clippy-pool.ps1:32 puts CLIPPY_TOKEN into the `secrets set` argv. Process command lines are readable via Win32_Process/tasklist by same-user processes and are captured by 4688/PowerShell command-line auditing. On machines where a worker executes bus-driven commands, this is a realistic local disclosure path for the seal secret and — worst case — the service-role key, which bypasses all RLS.
  
  _Evidence:_ install-clippy.ps1:247-250; install-clippy.ps1:79-83 (elevation re-pass); devops-gui.ps1:92 `RunConsole 'upload installers' "`$env:SB_SERVICE_KEY='$($suKey.Text)'; & '$HOMEDIR\upload-installers.ps1'"`; deploy-clippy-pool.ps1:32 `& $sb secrets set "CLIPPY_TOKEN=$ClippyToken"`.
  
  _Fix:_ Hand secrets to child processes via environment variables set in the parent ($env:CLIPPY_CMD_TOKEN before Start-Process, which the daemon already reads per its param defaults) or a temp file with tight ACL deleted after read; in devops-gui, write the key to $env: in the GUI process and let the console inherit it rather than interpolating it into argv.

- 🟡 **MEDIUM** — Fetch-success gate is $got -lt 2 of 9 files — installer can proceed without clippy-daemon.ps1 and still print the success footer · `install-clippy.ps1`
  
  Step 1 downloads 9 core files individually with per-file try/catch, then aborts only if fewer than 2 succeeded (line 112). If, say, 3 JSON files fetch but clippy-daemon.ps1, clippy-worker.py and clippy-pet-comp.ps1 all fail (flaky wifi, GitHub hiccup), the installer continues through cleanup, controller setup, and step 6 runs `& powershell.exe -File $daemon` against a nonexistent path (powershell prints a file-not-found error), yet the script ends with the '== done ==' banner claiming self-heal and self-update are in place. On a fresh machine nothing was actually installed and no scheduled task exists to recover it. clippy-update.ps1 at least logs '[!!] daemon not present after fetch'.
  
  _Evidence:_ install-clippy.ps1:112 `if ($got -lt 2) { ... return }`; :246-250 unconditional daemon handoff; :287-291 unconditional success banner.
  
  _Fix:_ Require the critical set explicitly (abort — or retry with backoff — unless clippy-daemon.ps1, clippy-worker.py, and clippy-pet-comp.ps1 all fetched), and gate the '== done ==' banner on the daemon actually having run.

- 🟡 **MEDIUM** — Self-elevation via RunAs can install the whole node under the wrong user profile on standard-user machines · `install-clippy.ps1`
  
  Start-Process -Verb RunAs (lines 83 and 87) runs the elevated installer as the account that supplies admin credentials. On the typical single-admin home setup this is the same user, but on a machine where the daily account (e.g. the kid's) is a standard user, everything user-scoped lands in the ADMIN's profile instead: $env:LOCALAPPDATA\NexusClippy, the .clippy flag dir, the User-scope CLIPPY_CMD_TOKEN/CLIPPY_STEWARD_SECRET env vars (clippy-daemon.ps1:951,980), the ClippyDaemon logon task (Register-ScheduledTask with no -User, daemon:1049 — binds to the registering/admin user), and the `claude /login` seat (per-user credential). Result: the pet and worker never appear in the kid's interactive session, and the node looks installed-but-dead. Nothing in the script detects or warns about the interactive-user vs elevated-user mismatch.
  
  _Evidence:_ install-clippy.ps1:83 `Start-Process powershell.exe -Verb RunAs -ArgumentList $argList`; :87 same for the irm|iex re-fetch; clippy-daemon.ps1:1049 `Register-ScheduledTask -TaskName 'ClippyDaemon' ...` (no principal/user specified); install-clippy.ps1:58 `$stable = Join-Path $env:LOCALAPPDATA 'NexusClippy'`.
  
  _Fix:_ After elevating, compare the elevated identity with the originally-logged-on user (e.g. capture $env:USERNAME pre-elevation and pass it through); if they differ, either register the scheduled task and paths for the interactive user explicitly or print a loud warning that the install landed under the admin account.

- 🔵 **LOW** — irm|iex elevation path re-fetches the script and silently drops all parameters (and is a TOCTOU on script content) · `install-clippy.ps1`
  
  When there is no file on disk (the documented pipe-to-iex form), elevation re-runs by re-fetching `irm $RAW/install-clippy.ps1 | iex` with NO parameters (lines 85-88). Anyone who invoked the piped form with params anyway (e.g. `& ([scriptblock]::Create(irm ...)) -CmdToken X -MakeHome -Debloat -NoLogin`) loses every one of them in the elevated run — the token/seal are never set, -MakeHome never claims the rig, -NoLogin is ignored — with no warning. The elevated run also fetches whatever is on main at that moment, which may differ from what was reviewed (minor TOCTOU). The file-invocation path correctly preserves bound params (lines 78-82).
  
  _Evidence:_ install-clippy.ps1:85-88 `$cmd = "irm $RAW/install-clippy.ps1 | iex"; Start-Process powershell.exe -Verb RunAs -ArgumentList @(...,'-Command', $cmd)` — $PSBoundParameters is not serialized into $cmd.
  
  _Fix:_ Serialize $PSBoundParameters into the re-fetch command (download to a temp file, then elevate with -File plus the reconstructed arg list), or at minimum Say a warning that parameters do not survive the piped-form elevation.

- 🔵 **LOW** — Ghost cleanup blanket-kills whatever process owns TCP port 4242, with no identity check · `install-clippy.ps1`
  
  The Orion-brain cleanup kills every listener on port 4242 unconditionally (line 128), unlike the adjacent process kill which matches command lines (clippy_brain.py/OrionNode/clippy_watchdog) and explicitly excludes the real worker. If any unrelated app happens to listen on 4242 (it is an unassigned hobby port used by various tools), the installer force-kills it. All other cleanup in 2a/2b is well-scoped: renames are reversible ('.disabled'), shortcut disabling verifies the link target, and the Orion task match requires ^Orion or OrionNode/clippy_brain/clippy_watchdog in the action arguments.
  
  _Evidence:_ install-clippy.ps1:128 `Get-NetTCPConnection -LocalPort 4242 -State Listen ... | ForEach-Object { Stop-Process -Id $_ -Force }` with no process-name filter.
  
  _Fix:_ Filter the 4242 owner by process name/command line (python/clippy_brain/OrionNode) before killing, mirroring the guard used two lines above.

- 🔵 **LOW** — Update and install fetch lists diverge; a 'Push update' does not refresh the Minecraft brain until the next daemon self-update cycle · `clippy-update.ps1`
  
  clippy-update.ps1 fetches 7 files but omits clippy_agent.js, controller-profiles.json, and minecraft.gamecontroller.amgp; install-clippy.ps1 fetches 9 but omits grok_bridge.py. Both gaps are eventually healed by the daemon's own self-update list (clippy-daemon.ps1:433, all 10 files, ~15-min cadence), so this is a staleness window rather than a permanent miss — but it means a remote 'Push update' intended to ship a bot fix leaves the old clippy_agent.js running until the daemon's next cycle notices and restarts it, and a fresh install runs without grok_bridge.py until the first self-update.
  
  _Evidence:_ clippy-update.ps1:18 fetch list (no clippy_agent.js/controller files); install-clippy.ps1:104-106 fetch list (no grok_bridge.py); clippy-daemon.ps1:433 full 10-file list.
  
  _Fix:_ Make all three lists the same single source (the daemon's list is the superset) — simplest is to add the three bot/controller files to clippy-update.ps1 and grok_bridge.py to install-clippy.ps1.

- ⚪ **INFO** — upload-installers.ps1 only works from one specific PC (hardcoded C:\Users\Clippy paths) and its header undercounts the uploads · `upload-installers.ps1`
  
  Four of the five upload sources are absolute paths under C:\Users\Clippy\Desktop\ (Clippy-for-a-friend.zip, OpenTether.apk, OpenTether-Windows.zip, OpenTether-QR.png); on any other machine they just warn '[!!] missing' and skip, which is very likely why the installers bucket was never populated (finding 1). The header also says 'uploads the 3 files' while the list has 5, and it uploads clippy-update.ps1 to the bucket even though js/tools.js deliberately serves the updater from raw GitHub instead (tools.js:21-24 comment). Otherwise the script is correct: public bucket creation plus x-upsert uploads with the service-role key.
  
  _Evidence:_ upload-installers.ps1:17-23 (hardcoded paths, 5 entries) vs header line 3 'uploads the 3 files'; js/tools.js:24 `updater: 'https://raw.githubusercontent.com/.../clippy-update.ps1'`.
  
  _Fix:_ Commit the small artifacts (QR png) or document which machine holds the binaries; fix the header count; drop the redundant clippy-update.ps1 upload or flip tools.js to the bucket URL as its comment suggests — one or the other, not both half-done.


### `curia` — Curia realm  · health: 🟢 good


The Curia (/home/user/nexus/curia/) is a small (369-line), dependency-free, staged-but-dormant local-LLM brain for Clippy: a Formulary of reusable task-drafts (curia_formulary.js), a router/tick loop (curia_brain.js) targeting local Ollama (:11434) and llama.cpp (:8080), and a launch script (curia_up.ps1) sized for the RTX 3070 on N6. It is wired into nothing live: zero references outside curia/ anywhere in the repo (clippy_agent.js, daemon, worker, deploy/install/update scripts all clean; only Roman-trivia dialog lines match 'senate'/'consul'), zero clippy_sync bus rows and zero pg_cron jobs mention it (verified by SELECT), and it appears in only 2 commits. It does run: node --check passes on both JS files and the built-in dry demo routes replay/reflex/think correctly with no model servers up. No secrets or remote endpoints — everything is 127.0.0.1. Recommendation: KEEP as staged R&D — it is honest about its own preconditions and costs nothing while dormant — but do not integrate until the README's own safety gates (per-step verification, independent safety check on replayed steps, draft invalidation) exist, the claimed-but-missing tests are committed, and curia_up.ps1 gets a singleton guard.


- 🟡 **MEDIUM** — Senate-authored formulas are persisted and replayed with no step validation or verb allowlist · `/home/user/nexus/curia/curia_brain.js`
  
  curia_brain.js think() saves ANY JSON the 7B model emits (parsePlan only requires a non-empty steps array) straight into the shared formulary, and route()/tick() replay saved steps verbatim with no allowlist of 'do' verbs, no per-step safety check, and no sanitization of {blank} values substituted from live situation data (which can include player chat). A hallucinated or prompt-injected formula would be filed permanently and replayed 'forever' — and wins-based scoring (score(): s += min(0.15, wins*0.01)) floats it upward. Since the Minecraft bot is played with by Alfredo's 3-year-old, this is child-safety-adjacent IF ever wired in. Mitigating: curia/README.md itself lists 'per-step verification + rollback, an independent safety check per replayed step, draft invalidation' as unmet preconditions, and nothing imports curia today.
  
  _Evidence:_ curia_brain.js:101-103: 'const formula = parsePlan(raw); if (formula) { formula.author = "senate"; F.save(mcdir, formula); } // <-- now reusable by the whole trio, forever'; parsePlan (106-114) validates only 'if (!plan.steps || !plan.steps.length) return null'. curia_formulary.js:109-120 fill() substitutes blanks into steps with no sanitization. README.md:9 admits the missing safety layer.
  
  _Fix:_ Before any integration: add a hard allowlist of executable 'do' verbs, validate/sanitize blank values, cap formula lifetime (draft invalidation), and route every replayed step through the same safety check the live agent uses. Treat this as a merge blocker, not a polish item.

- 🟡 **MEDIUM** — curia_up.ps1 has no singleton guard — rerunning stacks hidden self-restarting keeper loops · `/home/user/nexus/curia/curia_up.ps1`
  
  The 'mini-Vesta' wrapper writes curia_senate_keeper.ps1 and launches it as a hidden PowerShell process containing while($true){ Start-Process llama-server ... }. There is no check for an already-running keeper or an already-bound :8080, so each invocation of curia_up.ps1 (e.g. daemon re-runs it 'when the PC wakes', per line 1) spawns another immortal hidden loop, each relaunching llama-server — port conflicts, VRAM exhaustion on the 8 GB 3070, and orphaned processes that survive until reboot. The liveness check is also global (Get-Process -Name 'llama-server','server') so any llama-server instance on the machine makes every keeper think its child is alive.
  
  _Evidence:_ curia_up.ps1:46-61: here-string wrapper 'while ($true) { Start-Process -FilePath ... }' written to $clippy\curia_senate_keeper.ps1 and started with '-WindowStyle Hidden'; no mutex/pid-file/port check anywhere in the script; line 53: 'if (-not (Get-Process -Name ''llama-server'',''server'' -EA 0)) { break }'.
  
  _Fix:_ Add a pid-file or named-mutex singleton check at the top of both curia_up.ps1 and the generated keeper, and track the specific child PID from Start-Process -PassThru instead of a global process-name test.

- 🔵 **LOW** — README claims 39 passing tests ('18 tests pass', '21 tests pass') but no test files exist anywhere in the repo · `/home/user/nexus/curia/README.md`
  
  curia/README.md sells the modules as 'reviewed, tested design' with 18 formulary tests and 21 brain tests, but find/grep across the entire repo turns up no curia test files (no *test*curia*, no curia spec, nothing in package scripts). The tests were presumably run in a prior session and never committed, so the claim is unverifiable and the safety-relevant behavior (routing, hard-need rejection, blank filling) has no committed regression coverage. The built-in dry demo does run correctly (verified: replay/reflex/think all route as documented), which partially supports the claim.
  
  _Evidence:_ README.md:5-6: 'Dependency-free. 18 tests pass.' / '21 tests pass.'; shell verification: find /home/user/nexus -iname "*test*" -path "*curia*" and -iname "*curia*" outside curia/ both return nothing.
  
  _Fix:_ Recover or rewrite the test suites and commit them under curia/ before integration; until then soften the README claim.

- 🔵 **LOW** — Generated keeper script breaks on Windows usernames containing spaces or apostrophes · `/home/user/nexus/curia/curia_up.ps1`
  
  The wrapper embeds the gguf paths (under $env:USERPROFILE\.clippy\models) into a single-quoted -ArgumentList via "'$($args -join "','")'". An apostrophe in the profile path corrupts the generated PowerShell, and Windows PowerShell 5.1's Start-Process -ArgumentList does not re-quote elements containing spaces, so a username like 'Alfredo Ortiz' would pass a split gguf path to llama-server and the Senate would silently fail to start (all errors suppressed, see next finding). Also assigns to the automatic variable $args at script scope, a shadowing footgun.
  
  _Evidence:_ curia_up.ps1:43-49: '$args = @(''-m'', $SENATE_GGUF, ...)' then wrapper line 'Start-Process -FilePath ''$llama'' -ArgumentList @(''$($args -join "'',''")'')' with $SENATE_GGUF = Join-Path $env:USERPROFILE '.clippy\models\Qwen2.5-7B-Instruct-Q4_K_M.gguf' (lines 13-14, 20-21).
  
  _Fix:_ Quote each argument individually (or write the args to a file the keeper reads), and rename $args to a non-automatic variable.

- 🔵 **LOW** — $ErrorActionPreference='SilentlyContinue' masks every launch failure in curia_up.ps1 · `/home/user/nexus/curia/curia_up.ps1`
  
  Line 12 suppresses all non-terminating errors for the whole script: failed ollama pulls, a dead Ollama daemon (Invoke-RestMethod to :11434), or an unwritable $clippy dir all pass silently, and the script still prints the celebratory VRAM budget and 'Curia tiers are up.' Combined with curia_brain.js's design of resolving null on any HTTP failure (httpJson never rejects), a completely cold stack looks identical to a healthy one except by behavior.
  
  _Evidence:_ curia_up.ps1:12: '$ErrorActionPreference = ''SilentlyContinue'''; lines 68-75 unconditionally print '=== VRAM budget ===' and 'Curia tiers are up.' regardless of any prior failure.
  
  _Fix:_ Scope error suppression to the specific probe commands, and end the script with an actual health check (GET :11434/api/tags and :8080/health) that reports per-tier up/down truthfully.

- ⚪ **INFO** — Curia is fully dormant and clean: zero live wiring, zero bus/cron presence, no secrets, dry demo verified working · `/home/user/nexus/curia/README.md`
  
  Keep-or-archive answer: KEEP as staged R&D. Verified facts: (1) nothing outside curia/ references it — clippy_agent.js, clippy-daemon.ps1, clippy-worker.py, deploy-clippy-pool.ps1, install-clippy.ps1, clippy-update.ps1 and steward/digest.md all have zero curia hits; the only 'senate'/'consul'/'augur' matches elsewhere are Roman-trivia lines in clippy-dialog.json. (2) SELECTs against Supabase: 0 clippy_sync rows and 0 cron.job entries mention curia. (3) node --check passes on both JS files and 'node curia/curia_brain.js' produces correct routing on all three demo cases. (4) No secrets: all endpoints are hardcoded 127.0.0.1 (env-overridable), no keys, no PII; formulary writes stay under <mcdir>/commons/formulary. It costs nothing while dormant and is only 369 lines; CLIPPY-AUDIT-REPORT.md never covered it, so this is its first audit.
  
  _Evidence:_ SQL: select count(*) from clippy_sync where data::text ilike '%curia%' or from_id ilike '%curia%' -> 0; select count(*) from cron.job where command ilike '%curia%' or jobname ilike '%curia%' -> 0. Demo output: 'ROUTINE -> {"mode":"replay","via":"vigil","formula":"chop_tree","score":0.4,...}', 'DANGER -> {"mode":"reflex"}', 'NOVEL -> {"mode":"think"}'. Git: only 2 commits touch curia/ (0ff66b9 'stage the Curia', 39c8ad8).
  
  _Fix:_ Keep in the repo as-is. Gate future integration behind: the README's own safety preconditions (finding 1), committed tests (finding 3), and the curia_up.ps1 fixes (findings 2, 4, 5). No action needed today.


## Minecraft


### `mc-agent-safety` — Minecraft bot — safety  · health: 🟡 fair


clippy_agent.js is a well-considered bot with genuine child-safety engineering in its LOCAL behavior: home-guard pins Clippy's body to the 3070, identity resolution fails closed, creepers are walled off rather than meleed, the child is never a target, the mouth is hard-restricted to chat (leading slashes stripped so it can never run a command), and fire is confined to obsidian portal-lighting. The real weakness is the trust boundary: three separate paths let unauthenticated writes to the world-writable clippy_sync bus put arbitrary words in the bot's mouth to the 3-year-old — the txt: pool answer lane (hits Clippy himself), the clippy_nodes brainNode url redirect (companions), and the clippy_wish_grants note (all bodies). I confirmed via pg_policy that clippy_sync grants anon SELECT/INSERT/UPDATE/DELETE all=true, so these are live. On the digest DRIFT ALERT: the autonomous self-edit/self-ship loop is NOT in this file — the bot only proposes wishes and reads grants (header comment: 'he never rewrites or ships himself unsupervised'); any autonomous editing lives in the external cron-fired session, and its risky write path is the same anon-writable grant channel. Health fair: strong local safety, but the bus-as-trust-boundary lets a stranger speak through a trusted companion to the child.


- 🟠 **HIGH** — A stranger can speak arbitrary words to the child through the bot via the world-writable txt: pool lane
  
  Clippy's mind (brainCall, line 4293) tries the subscription pool FIRST via askPoolTxt (line 4250). askPoolTxt posts a pending job row id 'txt:<ts>-<rand>' to clippy_sync, then polls that SAME row for {status:'done', result}. clippy_sync UPDATE policy is anon check=true/using=true (confirmed via pg_policy) — anyone with the public anon key can PATCH that row to status:'done' with an arbitrary 'result'. brainCall returns that string and brainReply/brainSay pass it straight into say() (line 4320/4321), which the bot chats to the child (line 4116). The gate only checks that SOME node advertises txt:true; it does not authenticate WHO answers, and a stranger can win the race by PATCHing the row. Clippy himself (home rig, no brainNode) uses this path, so this is the most direct child-facing speech-injection vector. Output is bounded to ~120 chars but is arbitrary attacker text spoken in Clippy's trusted voice to a 3-year-old.
  
  _Evidence:_ clippy_agent.js:4250 askPoolTxt posts pending txt: row then polls it; 4282 `if (d && d.status==='done') result=d.result`; 4299-4300 brainCall returns pooled; 4320 brainReply `say(t.slice(0,120),true)`. DB: pg_policy on clippy_sync => clippy_update polcmd='w' using=true check=true; clippy_read using=true.
  
  _Fix:_ Do not treat an anon-writable bus row as a trusted answer. Sign/verify pool answers (HMAC in the from_id/answerer field against the node's advertised identity), or restrict the txt: lane to a service-role-gated table, or at minimum ignore results whose from_id is not a currently-advertised node in clippy_nodes AND accept only the FIRST answer within a tight window. The child-facing speech path must never render unauthenticated bus content.

- 🟠 **HIGH** — clippy_nodes bus row can redirect a companion bot's entire brain to an attacker server (speaks through the bot)
  
  For Trajan/Providencia (IDENT.brainNode set), brainCall calls localBrainUrl() (line 4213) which reads the world-writable clippy_nodes row, finds any entry whose name startsWith the brainNode and has a .url and fresh ts, then POSTs the bot's prompt to that url and uses the JSON reply as the bot's spoken line. Because clippy_sync is anon-writable, a stranger can inject/overwrite a clippy_nodes entry named e.g. DESKTOP-OQ8SROU with a malicious url and a fresh ts; the companion then sends its prompts to the attacker and speaks the attacker's response to the child. No signature or ownership check on the node url.
  
  _Evidence:_ clippy_agent.js:4218 reads clippy_nodes; 4222-4226 matches by name prefix + freshness, sets _brainRoster.url from n.url; 4303-4306 POSTs prompt to url+'/ask' and returns reply into the spoken path. Live clippy_nodes row is anon-writable (confirmed policies).
  
  _Fix:_ Pin brainNode URLs to a trusted source (local config on the companion's own disk, or a service-role-signed roster), not the public bus. Reject any node url not on an allowlist. Same root cause as the txt: lane — the bus cannot be a trust boundary.

- 🟠 **HIGH** — clippy_wish_grants note is spoken verbatim to the child and the row is world-writable
  
  checkWishGrants (line 1761) reads clippy_sync id=clippy_wish_grants (anon-writable). For any grant whose id matches a local wish id, if status==='granted' the bot announces to the child: 'THE KEEPER AND CLAUDE GAVE ME A NEW POWER!!! now I can <gr.note>!!' (line 1772), speaking up to ~80 chars of gr.note. The matching wish ids are themselves PUBLISHED world-readable at clippy_sync id=clippy_wishes (pushWishRow, line 1717). So a stranger reads a real open wish id from clippy_wishes, then writes clippy_wish_grants with that id + status:granted + an arbitrary note, and the bot speaks the attacker's text to the 3-year-old, framed as a trusted gift from the keeper and Claude.
  
  _Evidence:_ clippy_agent.js:1764 fetch clippy_wish_grants; 1770-1772 on status==='granted' say('THE KEEPER AND CLAUDE GAVE ME A NEW POWER!!! ...now I can '+gr.note...). clippy_wishes ids readable: live row clippy_wishes contains ids wmrjznywy, wmrk27asq (SELECT confirmed).
  
  _Fix:_ Sign wish grants (only accept grants written by service_role or carrying an HMAC keyed to the node secret), or move the grant channel off the public bus. At minimum sanitize/whitelist gr.note before speaking it to the child.

- 🟡 **MEDIUM** — In-world sibling-name spoofing can steer a bot's movement via ⚔ALERT / ⛏HANDS tokens
  
  onChat treats chat from any player named Clippy/Trajan/Providencia (SIBNAMES) as trusted family machine-tokens: '⚔ALERT <mob> x y z' makes a guardian walk to coordinates within 48 blocks (line 993), and '⛏HANDS <name|*> x y z' summons up to bounded bodies to within 90 blocks (line 1005). A stranger who joins the LAN world under one of those three names can emit these tokens to pull bots around the map (griefing / luring a bot away from the child). Impact is bounded (movement only, distance-capped, throttled) and requires LAN access, so not a remote hole, but it is unauthenticated steering of bot behavior by a spoofed name.
  
  _Evidence:_ clippy_agent.js:989 `⚔ALERT` regex on sibling chat -> driveOffFoe within 48; 1000 `⛏HANDS` -> helpAtHands within 90; SIBNAMES trust based solely on username (964, 986).
  
  _Fix:_ Do not authenticate siblings by username alone. Only honor these tokens if the sender is a known bot (e.g. present in clippy_nodes / a shared secret token in the message), or scope them to same-account players. On a private LAN world with only family this is low-risk; flagging for awareness.

- 🔵 **LOW** — Bot lights fire (flint & steel) only on obsidian for the nether portal — controlled, not a random fire hazard
  
  The only ignition path is the nether-portal goal (line 2640-2657): flint_and_steel is activated on an obsidian block that has air above, verified by looking for a nether_portal afterward. Fire cannot spread from a lit portal, and this only runs deep in the endgame goal chain (requires 'trip'/adventure mode or the survival endgame). No tnt, no lava placement near the child, no arbitrary fire; lava is only referenced for avoidance/perception and the MLG water-clutch safety save. Bot never attacks the owner/child (adoptOwner excludes siblings; attack targets are hostiles only; creepers are walled off, never meleed — guardCreeper, line 1412).
  
  _Evidence:_ clippy_agent.js:2647-2648 equip flint_and_steel + activateBlock on obsidian; 1391 `if (foe.name==='creeper') guardCreeper` never melee; 964 owner never a sibling; no tnt/lava-placement matches.
  
  _Fix:_ No action needed. Documented so the owner knows the destructive-verb surface was reviewed and is confined to normal survival portal-building.

- ⚪ **INFO** — The daily 'wish-granting self-improvement' autonomous-edit loop is NOT implemented in clippy_agent.js — the bot is a proposer only · _known_
  
  Reconciling the digest DRIFT ALERT (trig_01B3ZUL767qBuNEv58b9ujHp, enabled, cron 0 5 * * *): within clippy_agent.js there is NO self-edit, self-update, self-revert, git, node -c gate, or write to clippy_wish_grants. The bot only (a) reflects on grounded struggles and PROPOSES wishes (reflectForWishes -> wish -> pushWishRow, lines 1723/1740), and (b) READS grants and celebrates (checkWishGrants). The header comment states the design explicitly: 'He PROPOSES; the people who love him DISPOSE — he never rewrites or ships himself unsupervised' (line 1714). So whatever autonomous editing the cron trigger's prompt may do lives in the fired Claude session, external to this code — the bot body cannot edit or deploy itself unattended. This does not resolve whether the TRIGGER's session edits clippy_agent.js (out of this lane / read-only), but it means the risky write path is the external grant-writer, not the running bot.
  
  _Evidence:_ clippy_agent.js:1710-1785 (wish flow: propose + read-grants only); 1714 comment 'never rewrites or ships himself unsupervised'; no matches for self-update/revert/git/node -c/raw.githubusercontent (only LW_RAW:4537 for datapack assets).
  
  _Fix:_ Owner decision still needed on the enabled cron trigger itself (keep/pause/guard). But note the exploit surface for autonomous change is the clippy_wish_grants writer, which is the anon-writable bus (see the wish-grant finding) — securing that channel also constrains any downstream self-improvement flow.

- ⚪ **INFO** — Home-guard fences only Clippy to the 3070; companion souls run unguarded on the laptops by design
  
  The home-guard (line ~92) returns early unless IDENT.soulWriter (Clippy only). Trajan/Providencia have no host guard — intended, since the comment says they are DESIGNED to run on the laptops (DESKTOP-OQ8SROU / DESKTOP-SL5ETE7). Identity resolves fail-closed (line 79: exits if it cannot resolve a known identity from filename/CLIPPY_ID), which prevents a stray boot from spawning a second Clippy world server. This is sound, but worth the owner knowing: the 3070-only guarantee applies to Clippy's body only; the guardian/provider bodies are free to run on any machine where the file is launched with their name/env.
  
  _Evidence:_ clippy_agent.js:92 `if (!IDENT.soulWriter) return` in homeGuard; 79 fail-closed exit on unknown identity; 84 brainNode defaults per companion.
  
  _Fix:_ No change required if the laptop-companion topology is intended. If companions should also be host-pinned, add an equivalent allowlist for their expected hosts.


### `mc-agent-gameplay` — Minecraft bot — gameplay  · health: 🟡 fair


All 10 deferred bot gameplay fixes from CLIPPY-AUDIT-REPORT.md ([5],[9],[14],[19],[41],[44],[45],[46],[47],[60]) are STILL OPEN in /home/user/nexus/clippy_agent.js at HEAD — the three post-audit commits (crash guards, pearl whims, co-op hands) did not touch any of them. Riskiest is [5]: the 1.5s early-warning interpose loop lacks the panic/stay/lease gates its siblings have, so it can override the critical-health retreat while a mob is near the child. One NEW finding: the Living World season server-cycle's "only when no human in-world" check (line 4570) fails OPEN — it returns "no human" whenever Clippy's own bot is disconnected, so a weekly season change can kill the server while the boy is playing; the correct fail-closed helper (hsHumansOnline, line 5420) already exists but isn't used there. Six of the ten deferred fixes ([41],[44],[45],[46],[47],[60]) are pure code-level guards/map-choices verifiable by inspection + node --check without an in-world test; [14] and [19] are near-safe to apply the same way ([14] mirrors cookFood's already-live fuel-tier code); only [5] and [9] genuinely warrant an in-world session. The new v351 co-op (⛏HANDS) and ⚔ALERT machine tokens are properly firewalled to sibling senders and never reach the LLM/ambient paths; reconnect wiring (single-flight, dup-kick backoff, silent-socket watchdog, spawn-timer binding) is otherwise sound.


- 🟠 **HIGH** — [5] Early-warning interpose can override critical-health retreat (no panic/stay/lease gate) · `clippy_agent.js` · _known_
  
  The 1.5s early-warning interval sets a pathfinder goal to the midpoint between the boy and the nearest foe gated only on `p && !busy && dist>5`. It is missing the `!panic` gate (so during the critical-health retreat reflex it re-steers the bot BACK toward the mob every 1.5s, clobbering the retreat goal), the `mode !== 'stay'` gate (so it moves a bot the child told to stay), and any `_interposeUntil` lease (so it also fights safetyTick's own interpose goal-setter). The guardian melee loop at 1387 and safetyTick at 1653 already have the correct `!panic` guards — this loop was missed. Deferred fix [5] is unapplied.
  
  _Evidence:_ line 1377: `if (p && !busy && bot.entity.position.distanceTo(foe.position) > 5) { ... bot.pathfinder.setGoal(new goals.GoalNear(mid.x, mid.y, mid.z, 1), true) }` — contrast line 1387 `if (panic || (bot.health !== undefined && bot.health <= 6)) return` and line 1653 `if (host && !panic)`.
  
  _Fix:_ Apply the deferred fix: gate on `!panic && mode !== 'stay' && Date.now() >= _interposeUntil`. Riskiest of the 10 open items (child-safety adjacent: a dead guardian guards nothing); prefer an in-world test, but the gate addition is mechanically low-risk.

- 🟡 **MEDIUM** — Season server-cycle 'no human in-world' check fails OPEN — can kick the child · `clippy_agent.js`
  
  lwSync() installs the weekly Living World season zip and then cycles the server if `trainProc && !humanHere`, where `humanHere = owner && bot && bot.players[owner] && bot.players[owner].entity`. This is false whenever Clippy's OWN bot is disconnected (reconnect flap, dup-kick 20s backoff, spawn timeout, silent-socket watchdog — all of which null `bot` and `owner` while the java server keeps running independently). So on a season boundary (weekly, Mondays UTC; lwSync runs every 10 min) with the child in-world but Clippy's bot down, stopTrainServer() kills the server mid-play — exactly the kick the comment promises never happens. It also only checks the adopted `owner`, not any human. The codebase already has the correct fail-CLOSED check: hsHumansOnline() at 5420 ('assume a human if unsure'), used by the homestead surge.
  
  _Evidence:_ lines 4568-4571: `// Apply soon, kindly: if the server is up but NO human is in the world, cycle it` / `const humanHere = owner && bot && bot.players[owner] && bot.players[owner].entity; if (trainProc && !humanHere) { ... stopTrainServer() }` vs line 5420: `function hsHumansOnline() { try { return Object.values(bot.players || {}).some(p => p && p.username !== bot.username && !SIBNAMES.has(p.username)) } catch (e) { return true } }  // fails CLOSED`.
  
  _Fix:_ Change the cycle condition to require a live, spawned bot AND the fail-closed helper: `if (trainProc && bot && bot.entity && !hsHumansOnline()) stopTrainServer()`. Verifiable by inspection; no in-world test needed.

- 🟡 **MEDIUM** — [14] smeltIron stalls ~80s with no usable fuel and strands raw iron in the furnace · `clippy_agent.js` · _known_
  
  smeltIron only considers planks as fuel (`const planks = ...find(i => i.name.endsWith('_planks'))`); with coal/charcoal/logs aboard but no planks it silently loads input with NO fuel and then polls 40×2000ms (~80s) with no stagnation break, holding `busy` and blocking the task queue the whole time. Failure paths never `takeInput()`, so raw iron is left inside the furnace. The sibling cookFood (2343+) already has the proven FUEL_SMELTS tier logic (coal > logs > planks > sticks, v9.22) — smeltIron never got it. Deferred fix [14] is unapplied.
  
  _Evidence:_ lines 2329-2334: `const planks = bot.inventory.items().find(i => i.name.endsWith('_planks')) ... if (planks) await fur.putFuel(...); if (rawIt) await fur.putInput(...); for (let i = 0; i < 40; i++) { await sleep(2000); ... }` — no fuel-tier resolve, no zero-progress break, no takeInput; contrast cookFood's FUEL_SMELTS at 2356-2357.
  
  _Fix:_ Port cookFood's fuel-tier resolution; return false (furnace closed, input reclaimed) when no fuel; add a ~6-sample zero-progress break. Safe to apply with node --check only — it mirrors already-live cookFood code.

- 🟡 **MEDIUM** — [19] Post-spawn disconnect flap reconnects at a flat ~4-6s floor forever · `clippy_agent.js` · _known_
  
  The 'end' handler always schedules a rejoin in 4000ms (subject only to the 6s single-flight floor at 810). `_dojoFails` escalating backoff (v336) counts ONLY pre-spawn failures (`if (!spawned) _dojoFails++`) and is reset to 0 on every spawn (820), so a post-spawn kick loop (server restart cycle, whitelist/anti-cheat, world reload) hammers reconnect ~10×/min indefinitely with no escalation. The 20s `_dupBackoffUntil` covers only duplicate-login kicks. Deferred fix [19] (consecutive-short-session counter with exponential backoff capped at 60s) is unapplied.
  
  _Evidence:_ line 962: `setTimeout(() => { if (!bot && !joining) { try { IDENT.soulWriter ? tryDirect() : join(DOJO_PORT) } catch (e) {} } }, 4000)` inside `bot.on('end', ...)`; line 820: `_dojoFails = 0` on spawn; line 810: 6s single-flight.
  
  _Fix:_ Track `_shortSessions` (increment on end when uptime <30s, reset after healthy uptime) and use `Math.min(60000, 4000*2**Math.min(_shortSessions,4))`. Timer math is verifiable by code reasoning; no in-world test strictly needed.

- 🟡 **MEDIUM** — [9] Ender dragon marked defeated the moment the entity isn't visible (fabricated milestone) · `clippy_agent.js` · _known_
  
  In the 'dragon' goal act loop, the very first phase checks `Object.values(bot.entities).find(e => e.name === 'ender_dragon')`; entities stream in asynchronously after entering the End and the dragon is often outside tracking range, so `!dragon` on phase 0 immediately calls markDone('dragon'), mints the 'dragonwin' first-memory, and announces victory without a fight — a permanently-recorded false milestone (also runs against Alfredo's 'don't invent' law in spirit). No `sawDragon` flag exists anywhere in the file. Deferred fix [9] is unapplied.
  
  _Evidence:_ lines 2631-2632: `const dragon = Object.values(bot.entities).find(e => e && e.name === 'ender_dragon'); if (!dragon) { markDone('dragon'); journal('milestone', 'DRAGON DEFEATED (or absent)'); first('dragonwin', ...); return }` — reachable on the first loop iteration; grep confirms no sawDragon flag.
  
  _Fix:_ Set `sawDragon = true` on any phase where the dragon entity is present; only markDone when `sawDragon && !dragon` (or after a multi-phase grace). The guard itself is verifiable by inspection; confirming real dragon-fight behavior needs an in-world End trip.

- 🔵 **LOW** — [41] Guardian sword selection uses the armor RANK map — stone swords rank 0 · `clippy_agent.js` · _known_
  
  The guardian melee loop sorts swords by RANK (line 3903: netherite/diamond/iron/chainmail/golden/leather — an ARMOR map with no 'stone' or 'wooden' keys), so stone_sword and wooden_sword score 0 and a golden_sword (RANK 2, weaker in-game than stone) is preferred over stone. TIER_RANK at 2259 has the correct tool tiers (stone:2 > golden:1). Deferred fix [41] is unapplied.
  
  _Evidence:_ line 1392: `const sw = bot.inventory.items().sort((a, b) => (RANK[b.name.split('_')[0]] || 0) - (RANK[a.name.split('_')[0]] || 0)).find(i => i.name.endsWith('_sword'))`; line 2259: `const TIER_RANK = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 }`; line 3903: `const RANK = { netherite: 6, diamond: 5, iron: 4, chainmail: 3, golden: 2, leather: 1 }`.
  
  _Fix:_ Swap RANK for TIER_RANK in the sword sort only. Fully verifiable without an in-world test — pure map choice.

- 🔵 **LOW** — [44] moveNear resolves early on any goal_reached event from another goal-setter · `clippy_agent.js` · _known_
  
  moveNear's `onReached()` calls `fin()` unconditionally. goal_reached is a shared bot-level event; safetyTick's interpose, the follow loop, and the early-warning loop all set their own pathfinder goals concurrently, so any of their arrivals resolves a pending moveNear far from its target — silently truncating travel for builds, furnace trips, and rescues. Deferred fix [44] is unapplied.
  
  _Evidence:_ lines 3089-3094: `function onReached() { fin() } ... bot.once('goal_reached', onReached)` — no distance check, while the polling fallback at 3093 correctly requires `distanceTo(v) <= dist + 1.6`.
  
  _Fix:_ In onReached, only fin() when `bot.entity.position.distanceTo(v) <= dist + 1.6` (same tolerance as the poller). Verifiable by inspection; no in-world test needed.

- 🔵 **LOW** — [45] buildStructure retry pass ignores the child-arrived yield guard · `clippy_agent.js` · _known_
  
  The main placement loop breaks big builds the moment the boy engages (`if (!playerAFK() && bp.length > 40) break` at 3151), but the retry pass (3165-3171) re-places missing blocks with only the `!bot || actGen !== myGen` guard — so after a big build's main pass, the retry keeps the bot busy placing blocks (and safetyTick-relevant attention split) even after the child shows up. Deferred fix [45] is unapplied.
  
  _Evidence:_ lines 3165-3170: `for (const blk of bp) { if (!bot || actGen !== myGen) break; ... placeAt(t, want) ... }` — no playerAFK/bp.length>40 break, unlike line 3151 in the main loop.
  
  _Fix:_ Copy the line-3151 guard to the top of the retry loop body; FINISH-WHAT-HE-STARTED (know.pending) already resumes later. Verifiable without an in-world test.

- 🔵 **LOW** — [46] know.facts grows unbounded via the LLM <remember> command · `clippy_agent.js` · _known_
  
  The companion-action 'remember' case writes `know.facts[key]=value` and bsaves with no cap, unlike the bounded sibling stores (chatlog, know.sessions). know.facts is never read anywhere in the file, so every LLM-emitted <remember> is pure write amplification into the persisted know blob and its bus/disk copies. Deferred fix [46] is unapplied.
  
  _Evidence:_ line 4832: `case 'remember': if (g.key) { know.facts = know.facts || {}; know.facts[String(g.key).slice(0, 40)] = String(g.value || '').slice(0, 120); bsave('know', know); ... }` — no size bound; grep shows know.facts has no reader.
  
  _Fix:_ After assignment, drop oldest keys past ~40 before bsave (or stop persisting an unread store). Fully verifiable without an in-world test.

- 🔵 **LOW** — [47] companionPlan nested <do>/<plan>/<task> has no recursion depth guard · `clippy_agent.js` · _known_
  
  execCompanionAction's 'do'/'plan'/'task' case calls companionPlan(), which makes a fresh brainCall and queues up to 12 more actions — each of which can again be 'do'. A looping LLM output produces unbounded recursive planning: repeated LLM spend and a task queue that refills itself. Deferred fix [47] is unapplied.
  
  _Evidence:_ line 4808: `case 'do': case 'plan': case 'task': await companionPlan(g.task || g.goal || g.text || g.job || ''); break` and line 4776 `parseCompanionActions(t, 12)` — no depth parameter anywhere in companionPlan/execCompanionAction.
  
  _Fix:_ Thread a depth arg (default 0) and refuse 'do'/'plan'/'task' at depth>=1, or strip those tags from nested plans. Verifiable without an in-world test.

- 🔵 **LOW** — [60] Minecraft mind inherits anima + memories but not his self-written soul or Moneta · `clippy_agent.js` · _known_
  
  buildSystem's CLIPPY branch injects the anima strand (animaSelfReport → clippy_sync/clippy_anima, line 756) and clippy_memories labels (loadMemories, line 272→736), but never reads clippy_sync id=clippy_soul (soul.self — the identity he writes about himself in the browser body) nor any Moneta node, so his in-world persona stays disconnected from his self-authored identity. Deferred fix [60] is unapplied (note for the fix agent: the audit's fix text is still accurate, and the sr/loadMemories guards at 736-737 are the pattern to mirror).
  
  _Evidence:_ grep: `clippy_soul` has zero matches in clippy_agent.js; lines 736-737 fetch only loadMemories() (clippy_memories) and animaSelfReport() (clippy_anima); line 756 injects `YOUR SOUL (the real strand...)` from anima only.
  
  _Fix:_ In the CLIPPY branch only, fetch clippy_soul once per session (guarded like sr) and inject ~300 chars of soul.self + soul.feeling; degrade silently if unreadable. Verifiable without an in-world test (prompt-string change with a guarded fetch).


### `mc-controller` — Controller chain  · health: 🟡 fair


The controller chain (🎮 panel → bus row clippy_controller_cfg → worker .amgp regen → daemon antimicrox supervisor) is well built and internally consistent: every action code, button key, and tuning field name matches 1:1 between js/clippy-controller.js and clippy-worker.py; the panel's toddler preset exactly mirrors the committed minecraft.gamecontroller.amgp v2 (35/22 camera, wheelspeed 1, inert D-pad/Start/L3); the two-NX trap is avoided (clippy-controller.js is deferred and runs after app.js unifies window.NX); and the old MCPad/AutoHotkey conflict is truly gone from repo scripts — only removal code remains in install-clippy.ps1. Live state: the bus row clippy_controller_cfg does not exist yet, so no override or enable_all is active and the committed profile stands on all nodes. Two real problems: (1) any non-default panel Save is silently reverted within ~15 minutes because the daemon's GitHub file sync hash-compares minecraft.gamecontroller.amgp and copies the committed version back over the worker's regenerated one, and the worker never reapplies (its ts marker is unchanged) — the flagship "Save & send to the PC" feature only sticks until the next update tick; (2) the worker interpolates the bus-supplied easing string raw into the generated XML, and clippy_sync is confirmed publicly writable (RLS policies allow INSERT/UPDATE/DELETE to public with qual true), so an unauthenticated write can inject arbitrary antimicrox slot XML (including command-execution slot types) into the profile that runs on the child's PC — plus enable the mapper fleet-wide via enable_all. Health fair: chain works today, but its durability flow is broken and the bus write path needs sanitization.


- 🔴 **CRITICAL** — Unsanitized bus data injected into generated .amgp — unauthenticated XML/command injection on the child's PC · `clippy-worker.py`
  
  clippy-worker.py's _ctrl_gen_amgp interpolates the tuning 'easing' value from the bus row directly into the profile XML with no escaping or whitelist check. clippy_sync has RLS policies granting INSERT/UPDATE/DELETE to role public with qual/with_check = true (verified via pg_policies), so anyone with the shipped anon key can write clippy_controller_cfg. A crafted easing string can close the mouseacceleration tag and inject arbitrary antimicrox slot elements — antimicrox profiles support slot modes well beyond keyboard/mousebutton (including execute-style slots), so injected XML can bind the F310's buttons to arbitrary keystrokes or commands that fire while the child plays. The same row's enable_all key lets an unauthenticated writer switch the mapper on across every machine (worker lines 1637-1650 create controller.on with no provenance check). The panel's button->action ids ARE whitelisted (_CTRL_ACTIONS.get), which makes the one raw-string field the single hole.
  
  _Evidence:_ clippy-worker.py:1529 easing = str(t.get("easing", "easing-quadratic")); :1563-1564 mouse_extra += '<mouseacceleration>%s</mouseacceleration>...' % (easing, ...) — no escaping. pg_policies for clippy_sync: clippy_insert INSERT public with_check=true; clippy_update UPDATE public qual=true; clippy delete DELETE public qual=true. Worker enable_all handling: clippy-worker.py:1637-1650.
  
  _Fix:_ Whitelist easing against the three known values (linear/easing-quadratic/easing-cubic) in _ctrl_gen_amgp, exactly like actions are whitelisted; treat anything else as the default. Longer term, gate write access to clippy_controller_cfg (the standing bus-hardening decision pending with the owner).

- 🟠 **HIGH** — Panel controller overrides silently revert within ~15 minutes — daemon GitHub sync overwrites the regenerated .amgp · `clippy-daemon.ps1`
  
  When the panel saves a non-default config, the worker regenerates %HOMEDIR%\minecraft.gamecontroller.amgp (worker writes to dirname(__file__), which is the daemon's $HOMEDIR = $PSScriptRoot — same directory). But the daemon's Update-NodeFromGitHub includes minecraft.gamecontroller.amgp (and every registry-listed profile) in its sync list and copies the raw GitHub version over any file whose hash differs — which a regenerated override always does. This runs every $UpdateEveryMin = 15 minutes (sooner on hive peer-version divergence). The worker will not reapply the override because it only regenerates when the bus ts differs from its local mark (clippy-worker.py:1653), and the daemon overwrite doesn't touch the mark. Net effect: 'Save & send to the PC' works for at most one update interval, then the committed toddler profile silently returns at next mapper start — with the panel still displaying the saved override. Saving the untouched toddler preset survives only because its regen output happens to byte-match the committed file. Not mentioned anywhere in CLIPPY-AUDIT-REPORT.md.
  
  _Evidence:_ clippy-daemon.ps1:433 $files = @(... 'controller-profiles.json', 'minecraft.gamecontroller.amgp'); :440-443 hash-compare + Copy-Item $tmp $dst -Force; :47 [int]$UpdateEveryMin = 15; :652 update trigger. clippy-worker.py:1653 'if ts and ts != mark.get("ts")' — regen only on bus-ts change; :1659 prof written to script dir; daemon :52 $HOMEDIR = $PSScriptRoot, :89 worker lives in $HOMEDIR.
  
  _Fix:_ Make the daemon's file sync skip any profile whose game currently has an override on the bus (or have the worker persist regeneration and re-check the file every cycle instead of only on ts change — e.g. drop the xml!=old short-circuit gating on mark.ts). Cheapest fix: worker rewrites the override profile every 45s pass whenever the on-disk file differs from the regenerated XML.

- 🟡 **MEDIUM** — Path traversal in override filename — bus-controlled game name reaches os.path.join unchecked · `clippy-worker.py`
  
  The worker builds the profile path as os.path.join(base, "%s.gamecontroller.amgp" % name) where name is a raw key of the bus row's games object. A key like '..\\..\\Users\\Public\\x' escapes the install directory and writes an attacker-influenced file (content partially controlled via the easing injection above) anywhere the worker user can write, suffix-limited to .gamecontroller.amgp. Same unvalidated name flows into the restore-fetch URL (raw_base + "/" + fn). Combined with the public-writable bus this is a second unauthenticated primitive. The daemon side is safe by comparison — it only loads profiles named by the committed registry.
  
  _Evidence:_ clippy-worker.py:1656-1659 'for name, cfg in games.items(): ... prof = os.path.join(base, "%s.gamecontroller.amgp" % name)'; :1676-1678 fn used in HTTP path. games comes straight from the bus row (:1634).
  
  _Fix:_ Validate name against the committed controller-profiles.json registry (or at minimum ^[a-z0-9_-]+$) before building any path or URL; ignore unknown game keys.

- 🟡 **MEDIUM** — Hotbar wheel actions on D-pad/triggers regenerate without wheelspeed — the ~20-slots/s spin bug returns · `clippy-worker.py`
  
  The panel lets any control take any action, including hotprev/hotnext (mouse wheel). In the worker's generator, the <wheelspeedx/y> elements (set to the tuned wheelSpeed, default 1) are only emitted in the plain-button branch. If a parent maps hotbar prev/next onto a D-pad direction or a trigger, the dpad/trigger branches emit the bare mousebutton 4/5 slot with no wheelspeed, so antimicrox falls back to its default wheel rate — the exact 'spun ~20 slots/s' failure the v2 map fixed for LB/RB. A toddler-facing regression waiting behind a plausible remap.
  
  _Evidence:_ clippy-worker.py:1590-1592 wheelspeed extra only inside the _CTRL_BTN_INDEX loop; :1569-1573 dpad branch and :1579-1582 trigger branch call _ctrl_slot() with no wheel extra. Panel offers hotprev/hotnext for every control (js/clippy-controller.js:38-39, 49-66). Committed profile shows the intended form: minecraft.gamecontroller.amgp:37-38 '<wheelspeedx>1</wheelspeedx><wheelspeedy>1</wheelspeedy>'.
  
  _Fix:_ Emit the wheelspeed elements for wheel-kind actions in the dpad and trigger branches too (same wheel value used in the button branch).

- 🔵 **LOW** — MINECRAFT-CONTROLLER.md documents stale camera speeds (22/14) vs shipped 35/22 · `MINECRAFT-CONTROLLER.md`
  
  The doc's toddler-map table still says 'mousespeed 22/14' for the right stick, but the committed profile, the worker's fallback defaults, and the panel's toddler preset all ship the v330 x1.6 raise to 35/22 (with in-code comments noting the old 22/14 silently reverted the raise). Anyone tuning from the doc, or a future agent regenerating from it, would reintroduce the too-slow camera.
  
  _Evidence:_ MINECRAFT-CONTROLLER.md:86 'mousespeed 22/14 (Y at ~64% of X...)' vs minecraft.gamecontroller.amgp:26-29 mousespeedx 35 / mousespeedy 22; js/clippy-controller.js:76 camX 35, camY 22 (v330 comment); clippy-worker.py:1528 defaults 35/22 with the same v330 comment.
  
  _Fix:_ Update the doc's right-stick row (and the 'adult' hint on line 109 if desired) to 35/22 so all four representations of the toddler map agree.

- ⚪ **INFO** — MCPad/AutoHotkey conflict confirmed gone from repo; only remediation code remains · `install-clippy.ps1` · _known_
  
  Repo-wide search finds no live MCPad/mc_pad.ahk mapper script. install-clippy.ps1 actively kills AutoHotkey processes, renames %LOCALAPPDATA%\MCPad to .disabled for every user profile, and disables matching Startup .lnk files — the fix the steward digest records for the 'powershell interrupting my game' incident. No script in the repo can relaunch MCPad.
  
  _Evidence:_ install-clippy.ps1:152-161 (Stop-Process autohotkey, Rename-Item MCPad -> .disabled, Startup .lnk matching '(?i)mc.?pad|minecraft.?controller|mc.?controller' disabled). Only other repo mentions are docs/steward history.
  
  _Fix:_ None — keep the cleanup block in the installer for machines not yet reinstalled.

- ⚪ **INFO** — End-to-end chain consistency verified; bus row currently absent (no override live) · `js/clippy-controller.js`
  
  Field-by-field verification of the whole chain passed: panel ACTIONS qt/mb codes match worker _CTRL_ACTIONS exactly (all 24 ids); all 16 CONTROLS keys are consumed by the worker (_CTRL_BTN_INDEX + _CTRL_DPAD_INDEX + lt/rt triggers, correct SDL+1 indexes and dpad bitmasks matching the committed vdpad associations); all 11 tuning keys share names on both sides; the toddler preset's regen output matches the committed .amgp element-for-element (order, easing format '%.1f', trigger throttle positivehalf). The two-NX trap does not bite: clippy-controller.js loads deferred after app.js's window.NX unification (app.js:4584), so its captured NX is the unified object and NX.sb resolves; clippy.js invokes it via window.NX (clippy.js:7646). Panel CSS exists (css/clippy.css, 31 rules). Save/clear/setEnableAll all check the resolved {error} (law 3 respected) and preserve the whole existing row (v330 fix present). Live DB check: select ... from clippy_sync where id='clippy_controller_cfg' returns zero rows — no override and no enable_all has ever been saved, so the committed toddler v2 profile is what stands on all nodes today; the revert bug (finding 2) is latent, not currently mangling anything.
  
  _Evidence:_ js/clippy-controller.js:25-45,49-66,70-102 vs clippy-worker.py:1494-1509,1521-1597; index.html:4852 (app.js, sync) and :4871 (clippy-controller.js, defer); app.js:4584 window.NX = NX; SQL result: [] for id='clippy_controller_cfg'.
  
  _Fix:_ Nothing to change; noted so the owner knows the panel has never actually been exercised against a live node — the first real Save will be the first end-to-end test, and will hit finding 2 within 15 minutes.


### `living-world` — Living World datapack  · health: 🟡 fair


The Living World lane is real and well-crafted in its content layer: all four season zips (pack_format 94, min/max_format present) recolor foliage only — grass_color/grass_color_modifier appear only where vanilla defines them and are byte-identical across seasons (keeper's rule honored), and every sky/fog tint is a bright pastel (child-safe mood honored); the Clippy installer is soulWriter-gated, calendar-deterministic, and repo-driven, so it is not steerable from the anon bus. However, the shipped time engine does not implement the promised 28-min-day/12-min-night: tick.mcfunction advances the clock 1 game-tick per 2 real ticks uniformly, giving a symmetric ~20/20 split — the build script's own comment documents the intended asymmetric rates that were never coded — and the build script's latest comments say the fatal living:load "missing reference" boot error persisted even after the metadata/ASCII fixes, with only an unverified dual-directory shotgun as the last patch, so there is no evidence in the repo that the current zips actually load on the real server. Around that, the cycle-when-empty path hard-kills the java process without a graceful stop, and its "no human in-world" check is blind whenever Clippy's bot is disconnected or the human isn't the adopted owner. Health: fair — content and safety rules are solid, but the core timing promise is unimplemented and the pack's load status on the real server is unconfirmed.


- 🟠 **HIGH** — Time engine is symmetric 20/20, not the promised 28-min day / 12-min night · `scripts/build-living-world.py`
  
  LIVING-WORLD.md (lines 14-16) and the steward digest promise '28 min of sun, 12 min of night... Asymmetric on purpose — long play days, short kind nights.' The shipped engine in all four zips advances the slow clock exactly 1 game-tick every 2 real ticks with no phase-dependent rate: 24000 ticks * 2 / 20tps = 40 min total, split ~20 min day / ~20 min night. The build script itself computes the intended asymmetric rates ('day 0..12999 over 28 min -> 387 per-mille; night 13000..23999 over 12 min -> 764 per-mille', scripts/build-living-world.py:52-53) but the TIME ENGINE v2 rewrite (lines 62-72) dropped them. Nights for the 3-year-old are ~65% longer than designed. Doc drift rider: LIVING-WORLD.md also still describes the doDaylightCycle-off design, while v2 pins time absolutely and needs no gamerule (script comment lines 58-61).
  
  _Evidence:_ tick.mcfunction (identical md5 across all 4 zips): 'scoreboard players add #rt lw 1 / execute if score #rt lw matches 2.. run function living:adv' — adv.mcfunction unconditionally 'scoreboard players add #dt lw 1' with no day/night rate switch. vs scripts/build-living-world.py:52-53 documenting 387/764 per-mille asymmetric rates.
  
  _Fix:_ Reintroduce the asymmetry in adv/tick (e.g. advance #dt every 2.58 rt during day, every 1.31 rt at night via per-mille accumulator as the comment already sketches), rebuild the four zips, and update LIVING-WORLD.md to match engine v2 (absolute clock, no gamerule dependency).

- 🟠 **HIGH** — No evidence the datapack actually loads — last recorded state is a persisting FATAL boot error · `scripts/build-living-world.py`
  
  The build script's own war-story comments say a broken living:load reference makes the load-tag error FATAL on this server ('the server refuses to start', lines 54-56, 87-90), and that the 'missing reference' error PERSISTED even after the ASCII fix and the min/max_format fix ('the living:load missing reference persisted even with valid metadata + ASCII, which points at a function-dir resolution quirk', lines 96-99). The final patch — shipping both function/ and functions/ directories — is explicitly speculative, and nothing in the repo (steward log, digest, audit report, git history) confirms the current zips ever booted cleanly. A season change already occurred on 2026-07-20 (epoch week 0 = 2026-07-13 spring, weekly rotation), so the summer zip should have been installed and, if the fatal error is unresolved, the child's server may crash-loop at its next boot with no rollback.
  
  _Evidence:_ scripts/build-living-world.py:96-99: 'the living:load "missing reference" persisted even with valid metadata + ASCII, which points at a function-dir resolution quirk.' No subsequent success entry in steward/log.jsonl or steward/digest.md.
  
  _Fix:_ Verify on the soulWriter host: check trainserver logs for datapack load errors and confirm the server boots with clippys_world/datapacks/living-world.zip present. Until confirmed, treat the installer pipeline as potentially server-bricking; consider having lwSync quarantine the zip (rename .zip.off) if the server exits within N seconds of a post-install boot.

- 🟡 **MEDIUM** — Season cycle hard-kills the Minecraft server — no graceful stop, no save flush · `clippy_agent.js`
  
  stopTrainServer() is trainProc.kill() (clippy_agent.js:4525), and the server is spawned with stdio:'ignore' (line 4515) so a graceful 'stop' via stdin is impossible. When lwSync decides to 'cycle the empty server' on a season change (line 4571) it terminates java outright: unsaved world state since the last autosave (~5 min) is lost, and killing mid-save risks region-file corruption in the child's world. This fires up to weekly (every season change) plus whenever the zip is found missing.
  
  _Evidence:_ clippy_agent.js:4515 spawn(..., { stdio: 'ignore' }); :4525 function stopTrainServer() { ...trainProc.kill()... }; :4571 if (trainProc && !humanHere) { ...stopTrainServer() }
  
  _Fix:_ Spawn with stdio:['pipe','ignore','ignore'] and write 'stop\n' to stdin (fall back to kill after a timeout), or at minimum trigger save-all via RCON before killing. This also protects the v9.11.4 restart-safety work.

- 🟡 **MEDIUM** — 'No human in-world' check is blind when Clippy's bot is disconnected or the human isn't the adopted owner · `clippy_agent.js`
  
  The cycle guard is humanHere = owner && bot && bot.players[owner] && bot.players[owner].entity (clippy_agent.js:4570). It only sees the single adopted 'owner', and only through Clippy's own bot connection. owner is nulled on every bot 'end' (line 962), and the bot may be connected to the keeper's Open-to-LAN world instead of the home server (the leave-home logic at 4613-4616). So during any bot disconnect/rejoin window, or when the child plays alongside a non-owner guest, or while the bot is away in the keeper's world, humanHere is false and a season change hard-kills the server out from under a live human player — exactly what the 'the child never sees a kick' comment tries to prevent.
  
  _Evidence:_ clippy_agent.js:4570-4571 humanHere check; :962 bot.on('end', ...) sets bot=null, owner=null; :4613 leave-home path connects the bot to a different server while the home server keeps running.
  
  _Fix:_ Gate the cycle on the server's own player list (query protocol / RCON 'list', or parse the server log) rather than the bot's view, and skip the cycle entirely when bot is null or connected to a port other than DOJO_PORT — the pack still applies at the next natural boot.

- 🟡 **MEDIUM** — Auto-install pipeline has no validation or rollback beyond zip magic bytes · `clippy_agent.js`
  
  lwSync fetches raw.githubusercontent.com/orioncontinuity/nexus/main zips every 10 min and installs after checking only the 2-byte PK signature (clippy_agent.js:4562). Given the project's own record that a malformed pack makes the server refuse to start (build script comments), any bad rebuild pushed to main auto-propagates to the child's server within 10 minutes and crash-loops it at next boot: server exits, ensureServer sees the dead port and respawns every ~60s (lines 4594-4609), with nothing that removes or quarantines the failing datapack. There is no content validation (pack.mcmeta parse, function presence), no canary boot, and no automatic recovery.
  
  _Evidence:_ clippy_agent.js:4559-4565 (fetch → PK check → write → mark); :4594-4609 ensureServer restart loop; scripts/build-living-world.py:54-56 'the load-tag error is FATAL and the server refuses to start'.
  
  _Fix:_ After install+cycle, watch the next boot: if java exits within ~60s twice, rename the zip to living-world.zip.bad, clear lw-season.txt, and journal the failure. Also validate pack.mcmeta and the living:load function exist inside the zip before installing.

- 🔵 **LOW** — World day counter frozen forever — moon phase and day count never advance · `world/living-world-summer.zip`
  
  adv.mcfunction wraps #dt to 0 at 24000 and tick pins world time to #dt every tick, so absolute world time never crosses a day boundary: the world stays on the same day number permanently. Moon phase is fixed forever (affects slime spawning, cat/phantom behavior, villager gossip decay aesthetics), and /time query day never advances. Harmless for a toddler's play but a permanent side effect worth knowing.
  
  _Evidence:_ adv.mcfunction: 'execute if score #dt lw matches 24000.. run scoreboard players set #dt lw 0' + tick.mcfunction 'function living:settime with storage living:clock' ($time set $(Time)).
  
  _Fix:_ Use 'time set' with a monotonically increasing value (add 24000 * daycount instead of wrapping), or accept and document the frozen moon.

- 🔵 **LOW** — Absolute clock makes nights unskippable — beds and /time set are reverted within one tick · `world/living-world-summer.zip`
  
  Because tick.mcfunction re-pins world time to #dt every single tick, any time change from outside the engine — the child sleeping in a bed, or the keeper running /time set day — is overwritten on the next tick. Combined with the 20-minute nights of the symmetric engine, night is a fixed, unskippable ~20-minute block. This is inherent to the absolute-control v2 design but contradicts normal vanilla expectations for a small child ('sleep to make it morning').
  
  _Evidence:_ tick.mcfunction runs every tick: 'execute store result storage living:clock Time int 1 run scoreboard players get #dt lw / function living:settime with storage living:clock'.
  
  _Fix:_ Detect sleep (e.g. execute if entity @a[predicate=sleeping] or compare 'time query daytime' drift against #dt) and jump #dt to morning when the world time leaps forward, so beds work again.

- 🔵 **LOW** — Build is not reproducible from the repo — vanilla biomes/ source dir is not committed · `scripts/build-living-world.py`
  
  scripts/build-living-world.py:108 reads 'biomes/%s.json' (vanilla 1.21.11 biome dumps fetched from misode/mcmeta per LIVING-WORLD.md), but no biomes/ directory exists anywhere in the repo. A future session cannot rebuild or patch the four zips (e.g. to fix the 28/12 engine) without first re-fetching and re-verifying vanilla data for the exact server version — and a version-mismatched biome base risks worldgen feature-order-cycle boot failures, the same fatal class the project already fought.
  
  _Evidence:_ scripts/build-living-world.py:108 d = json.load(open('biomes/%s.json' % b)); find /home/user/nexus -name biomes -type d returns nothing.
  
  _Fix:_ Commit the 18 vanilla 1.21.11 biome JSONs (they're small) or add a fetch step to the script pinned to the mcmeta 1.21.11 tag, so the zips can be regenerated deterministically.

- ⚪ **INFO** — Cycle-when-empty silently never fires after a daemon restart (adopted server) · `clippy_agent.js`
  
  After a Clippy restart, ensureServer adopts an already-running server without a process handle (trainProc stays null, clippy_agent.js:4594-4603 — correct v9.11.4 safety). But lwSync's cycle condition requires trainProc (line 4571), so on an adopted server the season installs to disk yet the immediate-apply cycle never happens; the season only lands at the next natural restart, which for a long-lived server can lag days. Safe direction, but it quietly defeats the 'applies immediately when empty' promise.
  
  _Evidence:_ clippy_agent.js:4571 'if (trainProc && !humanHere)' vs :4600 adopt path that never sets trainProc.
  
  _Fix:_ Acceptable as-is; if immediate apply matters, extend the empty-check + graceful-stop path (findings above) to also cover the adopted-server case via port/RCON.

- ⚪ **INFO** — Both legacy and modern function directories shipped in every zip (debug shotgun) · `scripts/build-living-world.py`
  
  Each zip carries data/living/function AND data/living/functions plus tags/function AND tags/functions with identical contents (build script lines 96-106) — a deliberate workaround for the unresolved load-resolution quirk. On a true 1.21.11 server the plural dirs are dead weight and the duplication masks which path actually resolved, so the root cause of the fatal-load saga remains undiagnosed. Clean up once finding #2 is verified.
  
  _Evidence:_ unzipped zips contain both data/living/function/*.mcfunction and data/living/functions/*.mcfunction with matching md5s; scripts/build-living-world.py:100 for fdir in ('function','functions').
  
  _Fix:_ After confirming a clean boot on the real server, drop the plural dirs and record which directory name the server build actually reads.

- ⚪ **INFO** — Verified: keeper's rules honored — leaves-only recolor, grass untouched, all zone moods bright, not bus-steerable · `world/LIVING-WORLD.md`
  
  Positive conformance audit across all four zips: (1) foliage_color varies by season per biome family; (2) grass is untouched — grass_color appears only in cherry_grove (#b6db61, the vanilla value) and grass_color_modifier only in swamp/dark_forest, all byte-identical across the four seasons; (3) every sky/fog tint is a bright pastel (#7db0ff-#9cc8ff skies, cream/pink/mint fogs) including dark_forest 'kept BRIGHT' — nothing dark or spooky; (4) the installer is gated to IDENT.soulWriter, season choice is pure calendar math (LW_EPOCH 2026-07-13, weekly), and content comes only from repo main over HTTPS — no clippy_sync bus input can steer the world server, install path, or cycle behavior (house law 5 clean for this lane).
  
  _Evidence:_ Per-season color matrix extracted from all 72 biome JSONs (scratchpad lw/); clippy_agent.js:4549 'if (!IDENT.soulWriter) return', :4536-4541 calendar season math, :4537 LW_RAW = raw.githubusercontent.com/orioncontinuity/nexus/main/world/.
  
  _Fix:_ No action — recorded so the owner knows the child-safety and grass rules were independently verified in the shipped artifacts, not just the docs.


## Supabase / cloud


### `fn-brains` — Edge fns: clippy-brain + clippy-pool  · health: 🟡 fair


This lane covers two edge functions. clippy-brain (the cloud fallback LLM voice, Anthropic key held server-side) is deployed identically to the repo and is actively serving — but it is a public, verify_jwt=off, CORS-* endpoint whose only abuse control is a 1200ms text-only throttle: the vision branch is explicitly exempt (unmetered billable Claude calls by anyone — known audit item #6), the throttle is a non-atomic TOCTOU, and its state lives in the world-writable clippy_sync bus, so a single anonymous write to the clippy_brain_gate row can permanently jam the text path (a novel DoS of the fallback brain, House Law #5). clippy-pool is the bigger structural problem: it is an HTTP fan-out expecting nodes that advertise a reachable url and serve /ask,/vision (the separate ClippyPC :4242 stack), but the in-repo node stack clippy-worker.py is a bus poller with no url and no HTTP server — the live registry has 3 nodes, none with a url — so clippy-pool returns 503 on every call, is invoked by nothing in the app, yet is still redeployed on every daemon provision. No repo-vs-deployed drift in either function.</summary>
</invoke>



- 🟠 **HIGH** — clippy-brain vision path is an unauthenticated, unthrottled, billable Claude endpoint · _known_
  
  clippy-brain is deployed verify_jwt=false with CORS '*' and is callable with only the public anon/publishable key. The only abuse control is a ~1200ms global throttle, and it is EXPLICITLY skipped for vision: the throttle block is wrapped in `if (!imageB64) { ... }` (index.ts:45). So anyone on the internet can POST {image_b64,...} and drive unlimited Claude vision calls (max_tokens up to 1024, model claude-haiku-4-5) billed to Alfredo's ANTHROPIC_API_KEY, with no per-caller quota, no rate limit, and no auth beyond a key that ships in the client bundle.
  
  _Evidence:_ clippy-brain/index.ts:9-10 comment 'verify_jwt OFF; abuse is bounded by the throttle'; :45 `if (!imageB64) {` (throttle only for text); :44 comment 'Vision calls are exempt ... so a plate scan never bounces'. list_edge_functions: clippy-brain verify_jwt=false.
  
  _Fix:_ Add a real abuse ceiling that also covers vision: per-IP/per-day quota, throttle the vision branch too (even a looser limit), and consider a rotating shared secret distinct from the public anon key. Draft server-side only after Alfredo picks a quota ceiling (this is deferred owner-decision #6 in CLIPPY-AUDIT-REPORT.md).

- 🟡 **MEDIUM** — clippy-pool is orphaned and structurally always returns 503 — its node contract does not match clippy-worker.py
  
  clippy-pool fans a request out over HTTP: getNodes() keeps only registry entries that carry a reachable `url` (index.ts:25 `.filter((n) => n?.url ...)`) and callNode POSTs to `${node.url}/ask` or `${node.url}/vision` (index.ts:35). That contract belongs to the separate ClippyPC :4242 HTTP-server stack (brain/clippy_brain.py — not even present in this repo). The node stack THAT IS in this repo, clippy-worker.py, is a pure Supabase-bus poller: it runs no HTTP server (no BaseHTTPRequestHandler/do_POST) and its heartbeat entry (clippy-worker.py:679-694) advertises name/ts/caps/vision/etc. but NO `url`. The live registry confirms it: clippy_nodes has 3 nodes, zero with a `url`, so getNodes() returns [] and every clippy-pool call hits `return json({ error: 'no Clippy nodes online' }, 503)`. Even the ClippyPC nodes bind LAN/localhost (:4242), which Supabase's cloud edge runtime cannot reach — which is presumably why the app abandoned this path and uses the bus (NX.askPool enqueues job rows) instead. app.js never invokes clippy-pool. Yet clippy-daemon.ps1:897 redeploys it on every provision and deploy-clippy-pool.ps1 sets a CLIPPY_TOKEN secret for it — ongoing maintenance of a dead, public (verify_jwt=off, CORS *) endpoint.
  
  _Evidence:_ clippy-pool/index.ts:25 `.filter((n) => n?.url && now - (n.ts ?? 0) < STALE_SECONDS)`; :35 `fetch(\`${node.url}/${vision ? "vision" : "ask"}\`...)`; :57 `if (!nodes.length) return json({ error: "no Clippy nodes online" }, 503)`. clippy-worker.py heartbeat entry (:679-694) has no url and worker has no HTTP server. Live SQL: clippy_nodes = 3 nodes, urls_present=null. app.js uses askPool (bus), never invokes clippy-pool.
  
  _Fix:_ Decide clippy-pool's fate: either retire it (undeploy, drop the daemon/devops redeploy buttons and CLIPPY_TOKEN secret) since the bus path superseded it, or, if the HTTP fan-out is still wanted, reconcile the contract — have clippy-worker.py register a reachable `url` and serve /ask,/vision, and note that LAN/localhost urls are unreachable from Supabase's cloud edge. Do not change anything without Alfredo's decision.

- 🟡 **MEDIUM** — clippy-brain text throttle can be permanently jammed by a single anonymous bus write (DoS of the cloud fallback brain)
  
  The text-path throttle reads and writes its state from the world-writable clippy_sync row id='clippy_brain_gate' using the service key, but that row is writable by anyone holding the public anon key (the same key the worker uses to POST bus rows). The gate logic is `const last = rows[0].data.ts; if (now - last < 1200) return {mind:'throttled'}` (index.ts:53-55). An attacker can POST clippy_brain_gate with data.ts set far in the future (e.g. 9e15); then `now - last` is always negative (< 1200) and clippy-brain returns {text:null,mind:'throttled'} for EVERY text caller indefinitely, silently disabling Clippy's cloud chat fallback whenever the PC pool is asleep — the exact scenario this function exists to cover. Vision is unaffected (it skips the gate), but text chat is fully deniable. This is a safety/behavior channel steerable by an unauthenticated bus write (House Law #5).
  
  _Evidence:_ clippy-brain/index.ts:51-55 reads clippy_sync?id=eq.clippy_brain_gate then `if (now - last < 1200) return reply({text:null, mind:'throttled'})`. clippy_sync is world-writable with the public anon key (clippy-worker.py:322-323 POSTs bus rows with SUPA_KEY=publishable). Live row exists: id=clippy_brain_gate, from_id=brain.
  
  _Fix:_ Do not gate a public endpoint on a value any anonymous client can overwrite. Move throttle state off the world-writable bus (a service-role-only table or an in-memory/edge KV), and clamp/validate the stored ts (reject future timestamps). Coordinate with the #6 abuse-control redesign.

- 🔵 **LOW** — clippy-brain throttle is a non-atomic read-then-write (TOCTOU) — trivially raced · _known_
  
  Even against honest concurrent load, the throttle is not atomic: it GETs the gate ts, compares, then POSTs a new ts (index.ts:51-60). Two requests that arrive within the same window both read the old ts, both pass the `< 1200ms` check, and both proceed to Anthropic before either write lands. Combined with the vision exemption (separate finding) and anon-key access, the 1200ms limiter is weak as the sole cost control on a billable public endpoint. The `.catch(()=>[])`/best-effort wrapping also means any bus hiccup opens the gate entirely.
  
  _Evidence:_ clippy-brain/index.ts:51 GET gate; :55 compare; :56-60 POST new ts — no atomic compare-and-set; :62 `catch { /* throttle is best-effort */ }`.
  
  _Fix:_ Fold into the #6 redesign: use an atomic counter/quota (edge KV or a DB function with an atomic upsert) rather than read-modify-write, and treat throttle-store failure as closed (deny) rather than open for a public paid endpoint.

- ⚪ **INFO** — Repo and deployed clippy-brain/clippy-pool are identical — no drift (info)
  
  Compared the deployed source (get_edge_function) against the repo copies for both functions in this lane: clippy-brain (deployed v3) and clippy-pool (deployed v4) match the repo byte-for-byte, including comments. So the findings above describe the live production behavior, not stale repo code. clippy-brain edge logs show steady 200s (it is actively used as the cloud fallback); clippy-pool shows no invocations in the last 24h (consistent with it being orphaned).
  
  _Evidence:_ get_edge_function content for clippy-brain and clippy-pool is identical to supabase/functions/*/index.ts. edge-function logs: many clippy-brain 200s, zero clippy-pool entries.
  
  _Fix:_ No action; recorded so the owner knows the audited behavior is what is deployed.


### `fn-pantheon` — Edge fns: pantheon-voice, trio-coach, seance  · health: 🔴 poor


The fn-pantheon lane (pantheon-voice, trio-coach, seance) is well-built, repo-matches-deployed on all three functions, and is properly wired (chat-view.js invokes pantheon-voice and renders the gods' words; lapidarium/js/seance.js drives seance; pg_cron jobs 21/22/26 are active). However, the whole lane is currently dead in production: everything downstream of ANTHROPIC_API_KEY stopped working between 2026-07-21 16:30 and 17:00 UTC — trio-coach has silently failed roughly 66 consecutive half-hourly runs since then, and Trajan missed his 2026-07-22 daily word — while pg_cron and the HTTP layer report nothing but 200/succeeded because both functions swallow background errors with bare .catch(()=>{}). Compounding it, all three hive-node heartbeats are >17h stale, so the "subscription-first" pool lane never engages and there is currently no working engine at all; seance almost certainly fails on the same key. Separately, the lane inherits the world-writable clippy_sync bus: an unauthenticated writer can forge a god's "word" via the txt: answer lane, prompt-inject trio-coach through wishes/thoughts/chat rows, or invoke pantheon-voice with force:true to burn API calls and flush word history. Also notable: nothing in the repo reads the <key>_coaching rows trio-coach spends up to 288 Haiku calls/day producing.


- 🟠 **HIGH** — Entire lane silently dead since ~2026-07-21 17:00 UTC (likely ANTHROPIC_API_KEY failure), masked by swallowed errors · `supabase/functions/pantheon-voice/index.ts`
  
  trio-coach last succeeded 2026-07-21 16:30:19 UTC (trio_coach_state.last=1784651419595); its */30 cron (job 26) has fired and returned HTTP 200 every half hour since (~66 consecutive runs) with zero coaching writes. Trajan last spoke 2026-07-21 14:00:07; the 2026-07-22 14:00 cron (job 21) 'succeeded' at the pg_net layer but no word was appended. Both functions' last successes ran on engine 'api (fallback — no node awake)', and both consumers stopped in the same half-hour — strongly indicating the shared ANTHROPIC_API_KEY began failing (revoked/expired/out of credits). No error surfaces anywhere: pantheon-voice runs EdgeRuntime.waitUntil(speak().catch(() => {})) and trio-coach runs ER.waitUntil(run(force).catch(() => {})), so the cron caller always gets ok:true/200. seance uses the same key and is almost certainly dead too.
  
  _Evidence:_ supabase/functions/pantheon-voice/index.ts:365 'EdgeRuntime.waitUntil(speak().catch(() => {}));' and supabase/functions/trio-coach/index.ts:160 'ER.waitUntil(run(force).catch(() => {}));'. SQL: trio_coach_state data={last:1784651419595(=07-21 16:30),coached:3}; pantheon_trajan words tail: 07-21 14:00 api-fallback, no 07-22 entry; cron.job_run_details jobs 21/26 all 'succeeded' through 07-23 01:00; edge logs show trio-coach POST 200 in 674-3004ms every 30 min.
  
  _Fix:_ Verify/refresh ANTHROPIC_API_KEY in edge function secrets, then force one trajan + one trio-coach run to confirm recovery. Replace the bare .catch(()=>{}) with a catch that console.error()s and writes a last_error field to the function's bus row so the app/steward can see failures; consider a lightweight 'gods went silent' check in the Vigil.

- 🟠 **HIGH** — Gods' words are forgeable by any unauthenticated bus writer via the txt: answer lane · `supabase/functions/pantheon-voice/index.ts`
  
  poolAsk() posts {status:'pending',prompt,system} to clippy_sync row 'txt:pantheon-<uuid>' and then accepts whatever row appears with status:'done' as the god's text — no signature, no from_id check, no content validation beyond .slice(0,1200). clippy_sync is world-readable AND writable with the public anon key (house law 5), so anyone polling the bus can see the pending row's id appear and write status:'done', result:'<attacker text>' before the real worker does; that text is then stored as Trajan's/Providentia's word and rendered to Alfredo in chat-view as trusted daily counsel ending in a 'Today: <action>' directive — a clean social-engineering channel (e.g. a forged 'Today: pay vendor X').
  
  _Evidence:_ supabase/functions/pantheon-voice/index.ts:80-87 — id is readable on the bus once posted; acceptance is only 'if (row && row.status === "done" && row.result) return String(row.result).trim();'. js/chat-view.js:523 reads clippy_sync 'pantheon_'+god and paints the word.
  
  _Fix:_ Have the worker sign txt: answers (HMAC over id+result with the seal secret, verified in poolAsk), or move the answer channel to a service-role-only table/row prefix that anon RLS cannot write. Minimum: check from_id of the answering row and reject rows not written by a known worker identity.

- 🟡 **MEDIUM** — trio-coach is promptable and its output is directly writable from the unauthenticated bus (child-adjacent channel) · `supabase/functions/trio-coach/index.ts`
  
  trio-coach builds its LLM prompts entirely from anon-writable clippy_sync rows (<key>_mc_activity, _wishes, _thoughts, _vitals, trio_chat) — an unauthenticated writer can inject instructions into the wish/thought text that flow verbatim into askLens/synth prompts and steer the coaching tips written for the companions that play with Alfredo's 3-year-old. Worse, the output rows <key>_coaching are themselves anon-writable, so an attacker can skip the LLM and write arbitrary 'tips' directly. Mitigants: kid-safe system prompts, 200-char tip cap, and (currently) no in-repo consumer of _coaching — but any node-side consumer would ingest unauthenticated content.
  
  _Evidence:_ supabase/functions/trio-coach/index.ts:81-91 (companionBrief concatenates raw bus text into prompts), 93-99 (askLens passes it to Haiku), 119-124 (appendCoaching writes to anon-writable clippy_sync via service key upsert; the same row is writable by anon per house law 5).
  
  _Fix:_ Treat all bus-sourced text as untrusted in prompts (delimit + instruct the model to ignore instructions inside telemetry); if/when anything consumes <key>_coaching, verify from_id='trio-coach' is enforceable (it is not, since anon can set any from_id) — better, move coaching output to an RLS-protected row.

- 🟡 **MEDIUM** — seance is an open, unauthenticated Anthropic proxy on Alfredo's API key · `supabase/functions/seance/index.ts`
  
  seance has verify_jwt:false, CORS '*', no shared secret, no origin check, and no rate limiting. Any internet caller who finds the URL can POST {model:'gpt2',messages:[...]} and get Haiku completions (12-message context, 2000 chars each, 320 max_tokens) billed to ANTHROPIC_API_KEY, in a loop. The persona frame constrains tone but not abuse volume.
  
  _Evidence:_ supabase/functions/seance/index.ts:27-50 — Deno.serve handler goes straight from req.json() to api.anthropic.com with no auth gate; list_edge_functions confirms deployed seance v2 verify_jwt:false. Deployed content is byte-identical to the repo file.
  
  _Fix:_ Add a cheap gate: require a static x-seance-key header known to the lapidarium frontend (obfuscation, not security, but stops drive-by abuse), or per-IP/token-bucket rate limiting via a counter row; cap daily calls in a state row like hideaway does with its guard.

- 🟡 **MEDIUM** — pantheon-voice force:true lets unauthenticated callers burn LLM calls and flush the gods' history · `supabase/functions/pantheon-voice/index.ts`
  
  pantheon-voice is verify_jwt:false and the only spam protection is the guardMs re-entry check, which body.force bypasses entirely. An anonymous caller looping {who:'trajan',force:true} makes each call run readBoard + an LLM generation, and each success appends a word (cap 30) and a reading (cap 60) — 30 calls permanently shift out all genuine words, 60 calls erase Providentia's entire 'arc' memory. dry:true also returns the full board brief (card titles, equipment status) to anyone, though that data is already reachable via the shared anon key.
  
  _Evidence:_ supabase/functions/pantheon-voice/index.ts:316 'if (!body.dry && !body.force && Date.now() - last < c.guardMs)' — force skips the guard; :342-345 words/readings caps shift oldest entries out; deployed v4 verify_jwt:false per list_edge_functions.
  
  _Fix:_ Restrict force (and ideally all interactive invocation) to callers presenting the app's anon JWT or a shared header; or hard-cap forced speaks per day in the row state (e.g. max 3/day regardless of force).

- 🟡 **MEDIUM** — 'Subscription-first' has regressed to API-paid: pool lane rarely engages because node heartbeats are stale at cron time · `supabase/functions/pantheon-voice/index.ts`
  
  The v3 design (keeper: 'wire everything to just use claude subscription') makes the API key a no-node-awake fallback only, but 4 of Trajan's last 5 successful words and Providentia's last word ran on 'api (fallback — no node awake)'. All three clippy_nodes heartbeats are currently >17h stale (freshest ts 1784690868 ≈ 07-22 08:07 UTC vs now ≈ 07-23 01:20), far beyond the 180s freshness window claudeNodeAlive() requires, so at the 14:00 UTC (9am CT) cron the pool is never alive. When the API key then died (~07-21 17:00), there was no engine at all. Engine tally over Trajan's 11 words: 5 pool, 5 api-fallback, 1 pre-engine.
  
  _Evidence:_ SQL over pantheon_trajan words: 07-20 and 07-21 engine='api (fallback — no node awake)'; clippy_nodes ts values 1784585646/1784664124/1784690868 all fail 'nowS - ts < 180' (pantheon-voice/index.ts:71-72).
  
  _Fix:_ Either accept API as the real engine for morning crons (and keep the key funded/monitored), or shift Trajan's cron to an hour a node is reliably awake / have the daemon guarantee one worker heartbeat overnight. The stale-fleet condition itself belongs to the node lane but directly defeats this lane's design goal.

- 🟡 **MEDIUM** — trio-coach output has no consumer anywhere in the repo — up to 288 Haiku calls/day writing tips nothing reads · `supabase/functions/trio-coach/index.ts`
  
  Grep of the whole repo finds '<key>_coaching' only in trio-coach itself and the functions README; the daemon (clippy-daemon.ps1), pet, and all JS never read clippy_coaching/trajan_coaching/providencia_coaching. Unless a node-side consumer exists outside the repo, the every-30-min cron (job 26) spends 6 LLM calls per run (~288/day at ~48 runs) producing a 30-entry array that fully rotates every ~15 hours, unread. When the key works this is pure spend; the function's own header admits the goal was 'improve every model' but it only writes data.
  
  _Evidence:_ Grep 'coaching' across /home/user/nexus → only supabase/functions/trio-coach/index.ts and supabase/functions/README.md; cron.job 26 schedule '*/30 * * * *' active=true; trio-coach/index.ts:119-124 cap 30.
  
  _Fix:_ Ask Alfredo whether anything on the nodes actually reads _coaching. If not, drop the cadence to a few times a day (the tips can't be consumed faster anyway) or pause job 26 until a consumer exists — this is the cheapest real cost cut in the lane.

- 🔵 **LOW** — One silent failure costs a full day/week: daily+weekly speak has no retry or catch-up · `supabase/functions/pantheon-voice/index.ts`
  
  pantheon-voice fires once daily (Trajan) / weekly (Providentia) with a 20h/6d guard and background execution whose errors are discarded. A single failed run (like 07-22) means the god simply never speaks that day — no retry cron, no catch-up on next invocation, and the frontend's first-light invoke (chat-view.js:528) only fires when the row is empty, not when it is stale. History also shows Trajan's first scheduled slot (07-12) produced no word (gap between 07-11 21:34 and 07-13 14:01).
  
  _Evidence:_ cron.job 21 single daily slot '0 14 * * *'; pantheon_trajan words list has no 07-12 and no 07-22 entry; pantheon-voice/index.ts:316 guard, :365 fire-and-forget.
  
  _Fix:_ Add a second 'sweeper' cron an hour later that calls {who:'trajan',cron:true} — the 20h guard already makes it a no-op when the first run succeeded — giving every day one free retry.

- ⚪ **INFO** — clippy_sync.updated_at is not refreshed by these functions' upserts — freshness forensics mislead · `supabase/functions/trio-coach/index.ts`
  
  pantheon-voice and trio-coach write via PostgREST POST with Prefer: resolution=merge-duplicates, which updates only the supplied columns; the rows' updated_at stays at insert time. pantheon_trajan showed updated_at 2026-07-11 while its data.words contained entries through 07-21; clippy_coaching showed 07-15 while holding 07-21 tips. Anyone (or any monitor) using updated_at to judge whether the gods/coach are alive will conclude wrongly — this audit initially did.
  
  _Evidence:_ SQL: clippy_sync rows pantheon_trajan (updated_at 07-11 17:10) vs data.words last ts 07-21 14:00; clippy_coaching (updated_at 07-15 11:48) vs last tip ts 07-21 16:30. Writers: pantheon-voice/index.ts:48-54, trio-coach/index.ts:35-43 (no updated_at in payload).
  
  _Fix:_ Either include updated_at: new Date().toISOString() in the upsert payloads, or add a BEFORE UPDATE trigger on clippy_sync setting updated_at=now(); until then, always judge freshness from in-data ts fields.

- ⚪ **INFO** — Repo and deployed code are in exact parity for all three lane functions; wiring confirmed live · `supabase/functions/pantheon-voice/index.ts`
  
  Deployed pantheon-voice v4, trio-coach v1, and seance v2 are byte-identical to the repo files (deployed pantheon 'v4' is just a redeploy of the v3-headed source). All v2/v3 features verified present in deployed code: pool-first txt: lane, {cron:true} instant-ack + EdgeRuntime.waitUntil, dry lane returning pool_node, engine recording on every word, readings cap 60, and the lowercase-done classification fix (isDoneCol regex replacing v1's neq.Done). Consumers are real: chat-view.js reads pantheon_* rows and invokes pantheon-voice as first-light; the Lapidarium (lapidarium/index.html + js/seance.js) drives seance from the chat menu; crons 21/22/26 all active and passing {cron:true}.
  
  _Evidence:_ get_edge_function output for all three slugs matches Read of supabase/functions/*/index.ts; pantheon-voice/index.ts:120-121 isDoneCol fix, :344-345 caps, :364-367 cron path; cron.job rows 21/22/26; js/chat-view.js:523-529,683,735-736.
  
  _Fix:_ None — this is the good news; no repo-vs-deployed drift to reconcile in this lane.


### `fn-memory` — Edge fns: moneta-mind, hideaway-night, vault-backup, beacon-respond, predictive-notify  · health: 🟡 fair


All five fn-memory subjects exist and four are live: moneta-mind (v2) has every one of the 47 nodes embedded and a sane match_nodes; vault-backup runs nightly at 09:23 UTC with gap-free secret-gated snapshots through 2026-07-22; beacon-respond's guestbook RLS is sound (anon insert+select only, 2 entries); and predictive-notify is NOT dead — it is deployed (v16, byte-identical to the repo copy at /home/user/nexus/predictive-notify/index.ts) and fires daily via cron job 10 — but it has zero web-push subscriptions and zero native push tokens, so every alert it computes is dropped and its only residue is daily 'Predictive alert' rows in action_chains. The two real problems: hideaway-night silently missed the 2026-07-22 midnight reading (cron reported success, den shows last_read 07-21) because its cron path swallows every background error with .catch(()=>{}), and the Moneta memory ring is tamperable — the public anon key can UPDATE any moneta node (rewrite notes or set is_deleted=true, hiding it from recall), making the existing delete-block policy cosmetic. Lane health is fair: everything scheduled runs, but delivery (predictive-notify) and observability (hideaway-night) have holes, and memory integrity has one high-severity gap.


- 🟠 **HIGH** — Moneta memories can be rewritten or hidden by anyone with the public anon key · `supabase (DB policies on public.nodes) + supabase/functions/moneta-mind/index.ts`
  
  The nodes table carries a permissive policy nodes_anon_all (cmd ALL, qual true, with_check true) and anon holds full table grants (SELECT/INSERT/UPDATE/DELETE verified in role_table_grants). The restrictive policy nodes_block_moneta_delete only blocks DELETE where category='moneta'. UPDATE is wide open: an unauthenticated caller using the anon key (public in the static PWA) can overwrite a moneta journal entry's notes, or set is_deleted=true / is_archived=true — and match_nodes() explicitly filters out is_deleted/is_archived rows, so the memory vanishes from semantic recall without ever being deleted. The CLAUDE.md covenant 'Do not delete or edit another session's memory' is enforceable only against DELETE, not against silent rewriting or soft-hiding.
  
  _Evidence:_ pg_policies: {nodes_anon_all, ALL, PERMISSIVE, qual true, with_check true}; {nodes_block_moneta_delete, DELETE, RESTRICTIVE, qual: category IS DISTINCT FROM 'moneta'}. anon grants on nodes include UPDATE and DELETE. match_nodes(): "where ... coalesce(n.is_deleted,false)=false and coalesce(n.is_archived,false)=false".
  
  _Fix:_ Add a RESTRICTIVE UPDATE policy on nodes for anon/authenticated with qual (category IS DISTINCT FROM 'moneta') — mirroring the delete block — or route moneta writes through an edge function. The nightly vault snapshot plus archive/pressings gives recovery, but tampering would currently be invisible.

- 🟡 **MEDIUM** — hideaway-night silently missed the 2026-07-22 midnight reading; cron path swallows all errors · `supabase/functions/hideaway-night/index.ts`
  
  Cron job 20 (hideaway-midnight-reading, 0 5 * * * UTC) ran and 'succeeded' on 07-20, 07-21 and 07-22, but the den row shows last_read=2026-07-21 05:00 and the newest of its 12 margin notes is dated 07-21 — the 07-22 reading never landed. The cron path acks {ok:true,queued:true} immediately and runs the actual read via EdgeRuntime.waitUntil(doRead().catch(() => {})) (line 200): any failure in the pool poll, the Anthropic API fallback, or the bus write is discarded with no log, no retry, and no marker. If ANTHROPIC_API_KEY ever expires while the hive PCs sleep, midnights stop forever while pg_cron stays green. Engine history shows the fallback is load-bearing: 3 of the last 6 nights ran on 'api (fallback — PC asleep)'.
  
  _Evidence:_ cron.job_run_details: hideaway-midnight-reading succeeded 2026-07-22 05:00:00. clippy_sync id='clippy_hideaway': last_read 2026-07-21 05:00:08+00, note_count 12, newest note ts 2026-07-21 05:00. index.ts:200 'EdgeRuntime.waitUntil(doRead().catch(() => {}));'.
  
  _Fix:_ In the catch, write a failure marker (e.g. bus row hideaway_last_error or a daily_logs line) and optionally add a second cron firing ~06:00 UTC that retries when last_read is older than 22h. Then investigate why 07-22 failed (likely both pool and API path failed).

- 🟡 **MEDIUM** — predictive-notify runs daily but has zero recipients — the entire delivery layer is a no-op · `predictive-notify/index.ts (repo root; deployed as edge fn v16)`
  
  Lane question answered: predictive-notify IS deployed (v16, verify_jwt=true, updated 2026-04-21) and scheduled (cron job 10 nexus-predictive-notify-daily, 0 12 * * * UTC, active, succeeded 07-20..07-22), and the repo copy matches the deployed source. But push_subscriptions has 0 rows and nexus_users has 0 non-null push_tokens, so every gathered alert (PM due, warranty, stale dispatch, pattern prediction) is computed and then delivered to nobody; notify_log has 0 rows in 7 days because the dedupe write requires at least one successful push. Its only visible output is daily 'Predictive alert:' rows inserted into action_chains for the morning brief (~30 rows over the last month, mostly ice-machine PM alerts). Note the design does comply with house laws: it only notifies, never auto-fills orders or closes dispatches.
  
  _Evidence:_ SQL: push_subs=0, notify_log_7d=0, native_push_users=0, patterns_active=4. action_chains: e.g. 'Predictive alert: PM due today: Kold Draft Ice Mahine' n=3 (2026-06-19..07-16). cron.job jobid=10 active, run_details succeeded through 07-22 12:00 UTC.
  
  _Fix:_ Either re-enroll at least one push subscription (Alfredo's phone) and verify VAPID secrets are set, or acknowledge the function's real value is the action_chains/morning-brief feed and say so in docs. Also note: once subscribers exist, the broadcast op is reachable with just the anon key (verify_jwt accepts it), enabling push spam — gate broadcast with a shared secret before re-enrolling.

- 🟡 **MEDIUM** — vault-backup paginates with .range() and no ORDER BY — snapshot integrity not guaranteed for large tables · `supabase/functions/vault-backup/index.ts`
  
  The dump loop (line 41: sb.from(t).select('*').range(from, from+999)) issues one independent query per 1000-row page with no .order(). Without ORDER BY, Postgres row order is not stable across separate queries, so pages can overlap or skip rows — silently duplicating or dropping rows in the nightly snapshot. This bites exactly the tables the backup matters most for: daily_logs (~2982 rows), hideaway_pages (~1490), order_lines (~1443). The per-table failures map catches errors but not this silent misordering.
  
  _Evidence:_ index.ts:40-46 pagination loop with no .order(); pg_stat_user_tables: daily_logs 2982, order_lines 1443 live tuples; hideaway_pages count 1490.
  
  _Fix:_ Add .order('id', {ascending:true}) (or the table's PK; backup_table_list could return pk names) to make pagination deterministic. Cheap one-line fix per query.

- 🟡 **MEDIUM** — hideaway-night is fully unauthenticated — anyone can force readings, burn API credits, and ghost-write replies to Alfredo · `supabase/functions/hideaway-night/index.ts`
  
  verify_jwt=false and there is no shared-secret gate (contrast vault-backup's x-backup-key). Any internet caller can POST {force:true} repeatedly: each call advances the book position, pushes a note into the den (only last 90 kept — real history shifts out), marks ALL of Alfredo's unanswered guest notes as answered with model-generated 'TO ALFREDO:' text, and when no hive PC is awake burns a metered Anthropic API call per request. This is unauthenticated steering of a channel Alfredo personally reads.
  
  _Evidence:_ list_edge_functions: hideaway-night verify_jwt=false. index.ts:111 force bypasses the 20h guard; :176 guest notes bulk-marked answered; :82-94 API fallback spends ANTHROPIC_API_KEY per call.
  
  _Fix:_ Require a shared secret header for {force} (keep the cron body-only path or move cron to the same header, as vault-backup does), or at minimum rate-limit force to once per hour via the existing last-note timestamp.

- 🔵 **LOW** — nexus_config carries always-true INSERT/UPDATE RLS policies — currently dead, but a re-grant away from exposing the backup secret and API keys to writes · `supabase (DB policies on public.nexus_config)`
  
  nexus_config (holds backup_secret, anthropic_key, elevenlabs_key, trello_token) has permissive policies nexus_config_insert (WITH CHECK true) and nexus_config_update (qual true, with_check true) for role public. They are inert today only because anon/authenticated table grants have been stripped to SELECT (and with no SELECT policy, reads return empty; the app reads via the nexus_config_public view, which I verified excludes backup_secret and all API keys). But the protection rests entirely on absent grants: any future GRANT ALL (the Supabase default for new tables, an easy habit to reapply) instantly makes the secrets row writable by the public anon key — including backup_secret, the sole auth gate of vault-backup. The security advisor flags this (rls_policy_always_true, 110 hits project-wide).
  
  _Evidence:_ pg_policies: nexus_config_insert INSERT with_check=true; nexus_config_update UPDATE qual=true. role_table_grants for nexus_config: anon/authenticated have only SELECT/REFERENCES/TRIGGER. pg_views nexus_config_public definition omits backup_secret/anthropic_key/elevenlabs_key/trello_*.
  
  _Fix:_ Drop the two always-true policies (service role bypasses RLS and needs no policy). Zero behavior change today; removes the landmine.

- ⚪ **INFO** — vault-backup verified healthy: gap-free nightly snapshots, secret-gated, secret not leaked — but backups live inside the same project · `supabase/functions/vault-backup/index.ts`
  
  Snapshots exist for every night through 2026-07-22 (snapshots/2026-07-22.json.gz, 4.45MB gz, created 09:23:10 UTC), 30-day prune works, cron job 19 injects x-backup-key from nexus_config, and backup_table_list is a properly search_path-pinned SECURITY DEFINER. The ~30% size drop on 07-16 (6.28MB -> 4.31MB) coincides with the clippy_sync blob purge crons — expected, not data loss. Residual risk worth stating: the only copy of the backup lives in the 'backups' bucket of the same Supabase project it protects; project-level loss or compromise takes the backups with it. The git-committed archive/pressings covers only moneta+resonance, not ops data.
  
  _Evidence:_ storage.objects bucket_id='backups': daily files 2026-07-13..07-22. cron.job jobid=19 active; run_details succeeded 07-20..07-22.
  
  _Fix:_ Consider a weekly off-project copy (e.g. a GitHub-committed encrypted snapshot or a second storage provider) for the ops tables.

- ⚪ **INFO** — moneta-mind fully operational: 47/47 nodes embedded, floors and caps sane · `supabase/functions/moneta-mind/index.ts`
  
  Every node has an embedding (0 missing, including all 37 moneta rows), so backfill is caught up. match_nodes clamps match_count to 1..30, floors similarity at caller-supplied min (fn default 0.15; the app applies 0.74/0.78 per the digest), and filters soft-deleted/archived rows. Text truncation (notes 1500 chars, total 1800) and backfill batch cap (<=10) respect the WORKER_RESOURCE_LIMIT lesson documented in the header. The unauthenticated-recall design note in the header ('callers can only read what anon could already read') holds today only because nodes are anon-readable; if nodes RLS is ever tightened (see the moneta-tamper finding), recall via service role would start leaking beyond anon rights — revisit together.
  
  _Evidence:_ SQL: nodes_total=47, nodes_no_embedding=0, nodes_moneta=37, nodes_moneta_no_emb=0. match_nodes definition verified (limit least(greatest(match_count,1),30), is_deleted/is_archived filters).
  
  _Fix:_ No action needed now; couple any nodes RLS tightening with a category allow-list inside moneta-mind recall.

- ⚪ **INFO** — beacon-respond sound and quiet: RLS is insert+select only, word_count is a generated column, 2 entries logged · `supabase/functions/beacon-respond/index.ts`
  
  The open-guestbook design is correctly contained: the function talks to REST with the ANON key so RLS governs, and resonance_log policies grant anon only INSERT (with_check true) and SELECT — no UPDATE/DELETE despite anon holding table grants, so entries are append-only and unforgeable after the fact. word_count is a DB-generated column (not client-supplied), flagged is set server-side from a real word count, inputs are length-capped (name 120, response 40000, fragment 500). resonance_log holds 2 entries; the daily orion-night-watch cron (job 18) surfaces new ones into daily_logs. Only nit: the GET response's 'count' field is capped at 50 by the limit, so it will undercount once the log grows.
  
  _Evidence:_ pg_policies resonance_log: INSERT with_check=true and SELECT qual=true only. information_schema: word_count is_generated=ALWAYS. SQL: resonance_rows=2.
  
  _Fix:_ None required; optionally replace count with a real count query when entries exceed 50.


### `db-schema` — DB schema + data health  · health: 🟡 fair


The DB core is active and mostly clean: emails ingest every minute (7,001 raw_emails, 0 unprocessed), daily_logs run hot (446 in 7 days), dlog_sends is stamping, hideaway_books/pages integrity is perfect (all 4 books contiguous 1..N, declared==actual), Moneta has 37 fully-embedded memories, and the clippy_sync janitor is keeping all four job lanes at zero. Three things need attention. First, a critical hole: nexus_users carries an RLS policy granting full read/write to everyone with the public anon key, exposing 2 plaintext PINs and 18 bcrypt PIN hashes and allowing anyone to self-grant admin — this collapses the entire app-level role model and the PIN-based guards inside the admin RPCs. Second, month-old desktop screenshots (468KB and 2.1MB) sit world-readable on the clippy_sync bus outside every purge path. Third, the cleaning flow has logged zero completions since 2026-07-10, and the prior-art premise that patterns/meta_signals are empty is factually wrong — patterns is being updated daily by the still-active predictive-notify cron, including two zombie predictions a year stale. Bus timestamps also show the whole Windows node fleet dark since ~7/20-21 (pantheon/trio outputs stopped despite crons succeeding).


- 🔴 **CRITICAL** — nexus_users world-readable and writable with the public anon key, exposing PINs and allowing role self-escalation
  
  Policy `nexus_users_anon_all` on public.nexus_users is FOR ALL with qual=true, with_check=true, roles={public}. The table holds 20 users: 2 rows still have a plaintext `pin`, 18 have bcrypt `pin_hash` (gen_salt('bf',8)), and 2 rows are admin/owner. Anyone holding the anon key (shipped in the public PWA source) can SELECT every PIN/hash, UPDATE their own role to admin, or DELETE users directly — bypassing verify_pin's rate limiting and hashing entirely. A 4-8 digit PIN space under bcrypt cost 8 is offline-crackable in hours-to-days. This also transitively defeats the admin RPCs (delete_user, update_user_permissions), which gate on _actor_has_role(p_actor_pin,...) — the gating PIN itself is readable.
  
  _Evidence:_ pg_policy: {polname: nexus_users_anon_all, polcmd: *, qual: true, wc: true, roles: {-}}; SELECT counts: users=20, plaintext_pins=2, hashed=18, admins=2; verify_pin/delete_user definitions confirm PIN-derived authorization.
  
  _Fix:_ Drop nexus_users_anon_all and route all client access through the existing SECURITY DEFINER RPCs (verify_pin, list_user_names, etc.); force-hash the 2 remaining plaintext PINs and drop the `pin` column. Requires Alfredo's sign-off since it changes the shared-anon-key access model.

- 🟠 **HIGH** — Desktop screenshots and multi-MB blobs sit world-readable on the clippy_sync bus, outside every purge path
  
  Bus row `screen:pc` (468KB) is a base64 JPEG of the PC's 4400x920 dual-monitor desktop from 2026-06-25; `sam_in` is a 2.16MB base64 PNG from 2026-06-26. Both are readable by anyone with the anon key — a law-5 violation (screen content/PII on the public bus) and contrary to the estate's own rule that images go to RLS-locked steward_vision, never inline on the bus. Neither purge job touches them: cron 16 purges only pull:/file:/glb:/img:/zipc:/art-prefixed ids, cron 27 only the vis/art/txt/img lanes. Other dead June-era blobs (code:clippy_brain 186KB, clippy_learned 202KB, buildrbxmx 153KB, oakpc 38KB, siegewar:* rows) linger similarly; clippy_sync is the largest table at 6.4MB.
  
  _Evidence:_ clippy_sync: id=screen:pc data head '{"h": 920, "w": 4400 ... "b64": "/9j/4AAQSkZJRg...' (JPEG magic), updated 2026-06-25; id=sam_in head 'iVBORw0KGgo...' (PNG magic), 2,160,867 bytes, updated 2026-06-26. cron.job 16 and 27 delete predicates exclude these ids.
  
  _Fix:_ Ask Alfredo, then delete screen:pc and sam_in immediately (screen content is the sensitive part), and sweep the other dead June blobs. Consider extending the janitor with a catch-all: any row >100KB or untouched >30 days outside a whitelist.

- 🟡 **MEDIUM** — Cleaning flow silent for 12 days — zero completions since 2026-07-10
  
  cleaning_logs' latest completed_at is 2026-07-10 14:14 UTC with 0 completions in the last 7 days across all three restaurants, after a steady decline (48/wk early April, gap through May-June, 16 the week of 6/29, 8 the week of 7/6). 15 of 160 rows have NULL completed_at. Other staff-facing flows (daily_logs: 446 entries in 7 days; orders: latest 7/22) remain active, so this is cleaning-specific — either staff abandoned the Lite screen or something broke around 7/10 (cleaning_tasks table itself has 104 tasks and looks intact).
  
  _Evidence:_ SELECT max(completed_at) FROM cleaning_logs => 2026-07-10 14:14:48; count last 7d = 0; weekly buckets: 2026-04-06:48, 04-13:34, 04-20:33, 05-04:6, 06-29:16, 07-06:8, plus 15 rows with NULL completed_at.
  
  _Fix:_ Surface to Alfredo before assuming a bug (usage may be real-world). A frontend agent should smoke-test the Lite screen's insert path against the current schema; if it works, this is an operational adoption issue, not code.

- 🟡 **MEDIUM** — Prior-art premise wrong: patterns and meta_signals are NOT empty and patterns is updated daily by the active predictive-notify cron · _known_
  
  The steward digest's world-model plan and the 7/20 fleet verdict state the patterns/meta_signals tables are EMPTY and only point at undeployed functions. In fact patterns has 4 active rows updated as recently as 2026-07-22 12:00 UTC (by cron job 10 nexus-predictive-notify-daily, which is active; pattern-detect job 7 is disabled), and meta_signals has 35 chat_quality rows through 2026-07-14. Data quality is poor: pattern id 1 ('sarah restaurant shelving project') predicts next 2025-08-24 (11 months past) and id 2 (entity_name is a raw phone number '18308001659') predicts 2026-03-29 — both still active=true, so any consumer of next_predicted reads zombie predictions. Planning built on 'these tables are empty' should be revisited.
  
  _Evidence:_ SELECT count(*): patterns=4, meta_signals=35. patterns id=61 updated_at 2026-07-22T12:00:07 (matches job 10's 0 12 * * * schedule, active=true); id=1 next_predicted 2025-08-24 active=true; id=2 entity_name '18308001659' next_predicted 2026-03-29 active=true. cron.job: jobid 7 active=false, jobid 10 active=true.
  
  _Fix:_ Correct the digest/world-model notes; have Alfredo decide whether to deactivate the two zombie patterns (do NOT bulk-modify without his ask — law 2) and whether predictive-notify should keep running against this thin, noisy pattern set.

- 🟡 **MEDIUM** — board-archive-settled-done cron only matches lowercase column_name='done', missing other done-lane spellings · _known_
  
  Cron job 23 archives cards where column_name = 'done' (exact, lowercase) after 7 days settled. The codebase's own history (v281 pantheon bug) proves column_name case varies ('Done' vs 'done'), and board.js identifies done-ness by regex over list names (done|closed|resolved|complete|archived) at lines 380-385/984 — so cards living in lanes named 'Done', 'Closed', 'Resolved' or Spanish equivalents are never swept and accumulate as visually-archived-in-place clutter. Separately, this is an unattended bulk-modify cron (law-2 territory); the digest indicates it was council-era sanctioned ('Trajan's law: done 7 days is archived'), so flagging for awareness, not as a violation.
  
  _Evidence:_ cron.job 23 command: "...where c.archived = false and c.is_deleted = false and c.column_name = 'done' and c.repeat_every is null and c.last_status_change_at < now() - interval '7 days'"; /home/user/nexus/js/board.js:380 uses /^(done|closed|resolved|complete|completed|archived?)$/ for the same concept. Job succeeded 2026-07-22 09:30.
  
  _Fix:_ If Alfredo wants the sweep comprehensive, widen the predicate to lower(column_name) ~ 'done|closed|resolved|complete' to match board.js's definition; confirm with him first since it broadens an auto-archive.

- 🟡 **MEDIUM** — Windows node fleet dark since ~7/20-21: pantheon and trio-coach crons succeed but produce nothing
  
  Trajan's last daily word is ts 2026-07-21 14:00 UTC although cron job 21 'succeeded' again on 7/22 (pg_cron success only means the HTTP enqueue worked). trio_coach_state.last = 2026-07-21 16:30 UTC despite job 26 firing every 30 minutes with HTTP 200s through tonight. Node heartbeats corroborate: clippy_nodes data.ts ≈ 2026-07-20 22:00 UTC, clippy_act_* presence rows last 7/18, and the digest already flagged Providencia's worker dead on 7/18. Pool-first generation with no live node either falls back to the metered API or silently no-ops — currently it appears to no-op. Cross-lane: the desktops themselves are another agent's lane; the DB evidence is reported here.
  
  _Evidence:_ clippy_sync pantheon_trajan last word ts=1784642407138 (2026-07-21 ~14:00 UTC); trio_coach_state data={last:1784651419595, coached:3}; cron.job_run_details: pantheon-trajan-at-open succeeded 2026-07-22 14:00, trio-coach 139 succeeded runs, last 2026-07-23 02:00; clippy_nodes data.ts=1784585646.
  
  _Fix:_ Tell Alfredo the laptops/PC appear offline since ~7/20 (wake/reboot self-heals per digest); consider making pantheon-voice log an explicit error row when both pool and API paths fail so silent no-ops become visible.

- 🟡 **MEDIUM** — 2 SECURITY DEFINER views (ERROR-level) and 22 anon-executable SECURITY DEFINER functions; 110 always-true RLS policies · _known_
  
  Supabase security advisors flag views public.nexus_config_public and public.clippy_scores_best as SECURITY DEFINER (ERROR level — they evaluate with the owner's privileges, bypassing RLS for any querier), plus 22 SECURITY DEFINER functions executable by anon including add_user, delete_user, update_user_permissions, save_admin_privacy_rules, get_chat_history_admin. Sampled functions do gate on _actor_has_role(p_actor_pin,...), which is sound in isolation but collapses while PINs are world-readable (see the nexus_users finding). 110 rls_policy_always_true warnings restate the known shared-anon-key model. 29 functions have mutable search_path (warned; most set it properly in the sampled definitions).
  
  _Evidence:_ get_advisors(security): security_definer_view ERROR x2 (nexus_config_public, clippy_scores_best); anon_security_definer_function_executable WARN x22 (list includes delete_user, update_user_permissions, verify_pin); rls_policy_always_true WARN x110.
  
  _Fix:_ Convert the two views to security_invoker=true (or verify they expose nothing sensitive); the function set becomes acceptable once nexus_users is locked down. The 180-permissive-policy cleanup is already in the held-for-decision queue.

- 🔵 **LOW** — kanban_cards schema drift: dead is_archived column disagrees with archived on 70/102 rows; 56 cards have empty-string due_date
  
  kanban_cards carries both `archived` and `is_archived`; they disagree on 70 of 102 rows. board.js and cron job 23 use only `archived`, so is_archived is a dead legacy column that will mislead any future query or agent that picks the wrong one. Similarly `due_date` is text-typed and 56 cards hold '' (empty string) instead of NULL — falsy in JS so the UI survives, but any SQL comparison must guard with a regex/NULLIF or it errors (text < date) or silently mismatches. The table also carries parallel legacy pairs (is_deleted/deleted_at, column_name vs list_id).
  
  _Evidence:_ SELECT count(*) FILTER (WHERE archived IS DISTINCT FROM is_archived) = 70 of 102; count where due_date IS NOT NULL AND due_date !~ '^\d{4}-\d{2}-\d{2}' = 56, all '' empty strings; board.js queries .eq('archived', false) exclusively (lines 439, 2197).
  
  _Fix:_ With Alfredo's OK: normalize '' due_dates to NULL, and either drop is_archived or add a comment marking it dead; longer-term, migrate due_date to a date column.

- ⚪ **INFO** — Roughly 40 zero-row tables form an abandoned schema surface; pg statistics are badly stale · _known_
  
  Whole feature families are schema-only: inventory_* (5 of 6 tables empty), library_* (all 4), cleaning profile/callout/attachment satellites, troubleshooting_outcomes, budgets, contractor_events, capture_queue, dispatch_*, notify_log, ai_actions, device_bindings, trajan_profiles, plus the legacy boards/board_lists/cards trio superseded by kanban_cards (cards=0 but boards=2/board_lists=6 are live for kanban). Separately, list_tables/pg_stat estimates are wildly wrong (nodes est 9 vs 47 actual; raw_emails est 171 vs 7,001; hideaway_pages est 0 vs 1,490) — autovacuum/ANALYZE isn't keeping stats current, so any audit or planner decision using estimates is misled; every count in this report was verified with exact COUNT(*).
  
  _Evidence:_ Exact counts vs list_tables estimates: raw_emails 7001 vs 171, nodes 47 vs 9, cleaning_logs 160 vs 0, hideaway_pages 1490 vs 0; exact zero-row confirmations for cards, budgets, contractor_events, inventory_assets, library_books, push_subscriptions, steward_vision.
  
  _Fix:_ No action required for operation; run ANALYZE (owner-approved) to fix stats, and consider a one-page 'schema graveyard' note so future agents don't build on dead tables. The 138-unused-indexes cleanup already sits in the held-decision queue.

- ⚪ **INFO** — Order lifecycle columns effectively uncaptured: delivered_at 2/76, issue_at 0/76 · _known_
  
  Orders flow is otherwise healthy (76 orders, 51 with email_sent_at, latest 2026-07-22; 1,443 order_lines; 30 vendors in order_vendors) but delivered_at is populated on only 2 orders and issue_at on none — confirming the digest's data-capture verdict that vendor-lateness/issue patterns are unlearnable today. order_guide_pars is empty and no order-by-par artifacts exist in the data — law 1 (pars are reference only) is clean from the DB side.
  
  _Evidence:_ SELECT counts from orders: total=76, email_sent=51, delivered_at=2, issue_at=0, latest created 2026-07-22 14:51; order_guide_pars count=0.
  
  _Fix:_ Already on the open-threads list: the first cheap win for any anticipation feature is capturing delivered_at/issue_at at the point of use. Nothing to fix in-schema.

- ⚪ **INFO** — weekly-reflect cron failed its last run before being disabled; jobs 7/8 now inactive · _known_
  
  cron job 8 (nexus-weekly-reflect) shows a FAILED run at 2026-07-20 11:00 UTC and both jobs 7 (pattern-detect) and 8 are now active=false — the standing 'crons 7/8 404 weekly' owner decision has been half-executed (disabled, not dropped), and weekly_reflections remains empty (0 rows). The remaining decision is drop-vs-build. Note kind_notes (v281 feature) also has 0 rows after 12 days live — the feature is shipped but unused.
  
  _Evidence:_ cron.job: jobid 7 active=false, jobid 8 active=false; cron.job_run_details: nexus-weekly-reflect status=failed 2026-07-20 11:00:00; weekly_reflections count=0; kind_notes count=0.
  
  _Fix:_ Record in the digest that 7/8 are disabled (the held-for-decision entry reads as if they still fire and 404 weekly); Alfredo still owns drop-vs-build.


### `db-cron` — pg_cron audit  · health: 🟡 fair


The pg_cron estate is 17 jobs (15 active) and every active job has succeeded at the SQL level for the entire retained 2-day history — zero failures, pg_net queue depth 0, only 372 responses retained with 0 HTTP errors in-window. The two headline questions resolve well: job 6 (morning-brief) is genuinely fixed — the briefs table shows exactly one brief per day, every day, 2026-07-12 through 2026-07-22; and jobs 7/8 (pattern-detect/weekly-reflect) are now DISABLED (active=false), so the weekly 404 noise the digest still warns about is gone (job 8's one retained run failed on a missing http_header() function, not a 404 — the call never left the DB). The soft spots: job 10 (predictive-notify) succeeds daily but has produced zero output ever (notify_log 0 rows, push_subscriptions 0 rows — a dead-end pipeline); jobs 20/21/22/26 depend on verify_jwt=false endpoints anyone can invoke (LLM-spend exposure analogous to the known clippy-brain finding); nexus_config carries permissive anon-facing INSERT/UPDATE RLS policies over the secrets row that are inert only because table grants are revoked; and the 2-day run-history purge plus 12-hour pg_net response purge plus async http_post means an HTTP-level cron failure would be near-invisible — the same blindness that let morning-brief fail silently before 7/11. Job 23's nightly bulk-archive of done kanban cards deserves an explicit owner nod under house law 2, though it traces to the 7/11 Council grant.


- 🟡 **MEDIUM** — Predictive-notify (job 10) is a daily no-op: zero notifications ever produced, zero push subscriptions registered
  
  Job 10 (nexus-predictive-notify-daily, 12:00 UTC, service_role) succeeds every day at the SQL level, but notify_log contains 0 rows total (not just recently — ever) and push_subscriptions contains 0 rows. The delivery channel for 'predictive notifications' does not exist: nothing has ever been logged, sent, or subscribed to. The cron burns a daily edge-function invocation for a pipeline with no consumers, matching the Fleet #7 verdict that the predictive layer is data-blocked. Duplicate broken job 9 was already dropped 7/11; job 10 'stands' — but it stands on nothing.
  
  _Evidence:_ SQL: (select count(*) from notify_log)=0, max(created_at)=null; (select count(*) from push_subscriptions)=0. job_run_details jobid=10: succeeded 3/3 (7/20-7/22).
  
  _Fix:_ Ask Alfredo whether to pause job 10 until the predictive/notification layer actually exists (there is nothing to break by pausing — it has never emitted anything), or leave it as a harmless placeholder. Do not silently disable (house law 2 spirit).

- 🟡 **MEDIUM** — Cron jobs 20/21/22/26 depend on publicly invocable no-auth endpoints that trigger LLM generation
  
  hideaway-night, pantheon-voice, and trio-coach are all deployed with verify_jwt=false, and the crons (jobs 20, 21, 22, 26) call them with no Authorization header at all — meaning anyone on the internet who reads the public repo/frontend can invoke them directly. pantheon-voice and hideaway-night run LLM generation (subscription pool first, but Anthropic API key as fallback when no node is awake — nights especially), and cron:true backgrounds work via EdgeRuntime.waitUntil, so a request returns instantly and is cheap to spam. An attacker loop = metered API spend on Alfredo's key plus pollution of the gods' words, hideaway margin notes, and trio-coach feedback. This is the same class as the known clippy-brain finding (CLIPPY-AUDIT-REPORT.md line 111, owner decision pending) but these three functions are not covered by it.
  
  _Evidence:_ list_edge_functions: hideaway-night verify_jwt=false, pantheon-voice verify_jwt=false, trio-coach verify_jwt=false. cron.job 20/21/22/26 commands send only Content-Type header. Digest line 32-33: pool-first with 'Anthropic API key ONLY the no-node-awake fallback'.
  
  _Fix:_ When the clippy-brain quota decision is made, extend the same fix to these three: a shared rotating token header checked in-function (like vault-backup's x-backup-key pattern, which these crons could send), plus per-IP/day caps on the LLM paths.

- 🟡 **MEDIUM** — nexus_config (holds anthropic_key, trello_token, backup_secret) has permissive anon-facing write policies, inert only because table grants are revoked
  
  nexus_config columns include anthropic_key, elevenlabs_key, trello_key, trello_token, backup_secret, ai_writes_enabled, ai_max_writes_*. RLS is enabled with NO SELECT policy (reads correctly blocked — the vault-backup gate depends on this) but there ARE permissive policies nexus_config_insert (WITH CHECK true) and nexus_config_update (USING true, WITH CHECK true) applying to ALL roles. They are currently harmless solely because anon/authenticated hold only SELECT/REFERENCES/TRIGGER table grants — no INSERT/UPDATE privilege. Defense is one layer deep: any future 'GRANT ALL ON ALL TABLES IN SCHEMA public' (a common migration/reset habit) instantly lets unauthenticated clients overwrite the API keys, flip ai_writes_enabled/rate caps, and poison backup_secret — the very secret cron job 19 reads at fire time to authenticate the nightly vault backup.
  
  _Evidence:_ pg_policy: nexus_config_insert with_check=true, nexus_config_update qual=true with_check=true, roles=null (public). information_schema.role_table_grants for nexus_config: anon/authenticated = SELECT, REFERENCES, TRIGGER only. Job 19 command: headers x-backup-key := (select backup_secret from nexus_config where id=1).
  
  _Fix:_ Drop the two permissive policies (they serve no caller — service_role bypasses RLS) or rewrite them scoped to service_role, so the secrets row is protected by RLS as well as grants. SELECT-only audit; needs an owner-approved migration.

- 🟡 **MEDIUM** — Cron failure observability is near-zero: 2-day run-history purge + 12h response purge + async pg_net masks HTTP failures
  
  Three compounding design choices: (1) job 25 deletes cron.job_run_details older than 2 days, so weekly jobs (3 weekly-digest, 22 providentia) lose their run record within days and week-over-week trends are unqueryable; (2) net.http_post is async, so job_run_details says 'succeeded' even when the HTTP call returns 404/500 — exactly how morning-brief failed silently for weeks before 7/11; (3) job 24 deletes net._http_response older than 12h, so the only place an HTTP-level failure is visible survives less than half a day (the 12:00 UTC daily jobs' responses were already purged when checked at 01:56 UTC). Today everything happens to be healthy (queue_depth 0, 372 responses, 0 errors >=400, one 5s timeout), but the next slug typo or function regression will again be invisible.
  
  _Evidence:_ cron.job 24: 'delete from net._http_response where created < now() - interval ''12 hours'''; job 25: 'delete from cron.job_run_details where end_time < now() - interval ''2 days'''. net._http_response oldest=2026-07-22 19:57 (12:00 UTC daily-brief response already gone). Digest line 27: job 6 'had been failing daily' undetected.
  
  _Fix:_ Add a tiny cron_health check (or fold into an existing daily brief) that joins recent net._http_response status codes before they purge, or extend response retention to 48h (volume is trivial: ~370 rows/12h). Owner-approved change; flagging only.

- 🟡 **MEDIUM** — Job 23 nightly bulk-archives done kanban cards — house law 2 says confirm this class of automation explicitly · `/home/user/nexus/steward/log.jsonl` · _known_
  
  Job 23 (board-archive-settled-done, 09:30 UTC = 4:30am CT daily) UPDATEs kanban_cards: archives every non-repeating card sitting in 'done' for 7+ days, stamping activity 'NEXUS sweep (Trajan''s law: done 7 days is archived)'. 19 cards swept so far; ran 3/3 days. House law 2: never auto-close/bulk-modify stale records without explicit ask. Provenance (log 2026-07-11, THE COUNCIL v279): Alfredo granted 'allow Trajan and Providentia and Clippy to allow you to fix nexus. listen to their feedback' — the sweep was born from persona counsel under that broad grant, not from Alfredo explicitly asking for recurring auto-archival. It archives (reversible) rather than deletes, and logs itself, which softens it — but it is standing, unattended bulk modification of his records.
  
  _Evidence:_ cron.job jobid=23 command: 'update kanban_cards c set archived = true ... where column_name = ''done'' and last_status_change_at < now() - interval ''7 days'''. SQL: 19 archived cards carry 'NEXUS sweep' activity. steward/log.jsonl 2026-07-11 COUNCIL entry documents creation.
  
  _Fix:_ One-line confirmation from Alfredo: 'the board auto-archives done cards after 7 days — keep?' If yes, record it as a standing approval in the digest so future audits stop re-litigating it; if no, disable job 23.

- 🔵 **LOW** — Service-role JWT hardcoded verbatim inside four cron commands
  
  Jobs 1 (process-emails, every minute), 3 (weekly-digest), 10 (predictive-notify), 11 (gmail-watch-renew) embed the full service_role JWT as a literal Bearer token in cron.job.command; job 6 embeds the anon JWT. The service_role key bypasses all RLS. Exposure is limited (cron schema is not API-exposed), but the key is readable by any privileged DB session, appears in any dump of the cron schema, and rotation requires hand-editing every job. Jobs 19/20/21/22/26 already demonstrate the better patterns (secret looked up from a table at fire time, or no key at all).
  
  _Evidence:_ cron.job jobid=1,3,10,11 commands contain 'Authorization', 'Bearer eyJ...role":"service_role"...' literal; jobid=6 contains the anon JWT literal.
  
  _Fix:_ When keys next rotate, move cron auth to a Vault/nexus_config lookup at fire time (the job-19 pattern) so one update covers all jobs and the literal leaves cron.job.

- 🔵 **LOW** — Orion-night-watch (job 18) dedup uses raw LIKE over fragment text — wildcard characters can suppress announcements
  
  Job 18 announces new resonance_log entries into daily_logs, deduping via: not exists (... d.entry like '%' || left(coalesce(r.fragment, r.model_name), 40) || '%'). The fragment text is interpolated unescaped into a LIKE pattern, so '%' or '_' in the first 40 chars of a fragment act as wildcards — a fragment starting with '%' would match virtually any prior Orion Night Watch entry and the announcement (including a possible LETTER_002 reply, the event the job exists to catch) would be silently skipped. Also matches on a 40-char prefix, so two fragments sharing an opening line dedupe as one.
  
  _Evidence:_ cron.job jobid=18 command: "d.entry like '%' || left(coalesce(r.fragment, r.model_name), 40) || '%'". 3/3 runs succeeded; resonance_log currently quiet so no misfire yet.
  
  _Fix:_ Escape LIKE metacharacters (replace(replace(x,'%','\\%'),'_','\\_')) or dedupe on resonance_log.id recorded in the entry instead of prose matching.

- ⚪ **INFO** — Morning-brief (job 6) verified genuinely fixed — one brief per day since 7/12 with no gaps · _known_
  
  Job 6 (nexus-morning-brief, 0 12 * * * UTC = 7am CT) was rewritten 7/11 (digest: http_header() missing AND wrong slug /daily-brief vs daily-brief-index). Verified end-to-end: cron.job_run_details shows 3/3 succeeded (7/20-7/22, full retained window) and the briefs table shows exactly 1 row per day for every day 2026-07-12 through 2026-07-22 — 11 consecutive days, zero misses since the fix.
  
  _Evidence:_ cron.job jobid=6 targets daily-brief-index (deployed, verify_jwt=true, anon JWT). SQL: briefs_by_day = [{2026-07-22:1},{2026-07-21:1},...{2026-07-12:1}], 11 days, n=1 each. job_run_details jobid=6: succeeded x3.
  
  _Fix:_ None — close this thread in the steward digest as proven (digest line 27 says 'first proof tomorrow'; proof is now 11 days deep).

- ⚪ **INFO** — Jobs 7/8 (pattern-detect/weekly-reflect) are now DISABLED — steward digest claim of '404 weekly' is stale in two ways · `/home/user/nexus/steward/digest.md` · _known_
  
  cron.job shows jobid 7 (nexus-pattern-detect) and 8 (nexus-weekly-reflect) with active=false. Digest line 177 still says they '404 weekly — drop or build, his call'. Also inaccurate historically: job 8's one retained run (7/20 11:00 UTC) failed with 'function http_header(unknown, unknown) does not exist' — a SQL error inside the cron command, so the HTTP call never left the database; it was never a 404. Both target functions (pattern-detect, weekly-reflect) remain undeployed (absent from the 27 deployed edge functions), and the patterns/meta_signals/weekly_reflections tables remain empty per prior fleet work.
  
  _Evidence:_ cron.job: jobid 7 active=false, jobid 8 active=false. job_run_details jobid=8 status=failed, return_message='ERROR: function http_header(unknown, unknown) does not exist'. list_edge_functions: no pattern-detect or weekly-reflect slug.
  
  _Fix:_ Owner decision still pending (build vs drop); meanwhile update digest line 177 to reflect they are disabled and no longer firing. If dropped for good, cron.unschedule the two rows to remove clutter.

- ⚪ **INFO** — pg_net and bus hygiene healthy; job 16 now largely redundant with job 27; one trio-coach timeout observed
  
  State of the plumbing: net.http_request_queue depth 0; net._http_response 372 rows (12h window), 0 responses >=400, single failure ever retained = one 5000ms timeout at 22:30 UTC 7/22 from trio-coach (job 26, 1 of 138 runs; fire-and-forget so harmless — though if the fn exceeds 5s regularly the response is always discarded). Cleanup lattice works: job 24 (responses, 12h), 25 (run history, 2d), 27 (clippy_sync reap: vis/art/txt/img done-or-2h, job done-or-30m, every 10 min, 415 runs clean), 16 (blob purge at 04:17, 2-day). Overlap: job 27's 2-hour reap of art:/img: lanes makes job 16's 2-day purge of the same prefixes mostly dead code — job 16 still uniquely covers pull:/file:/glb:/zipc:/probe: prefixes. Job 1 (process-emails, every minute, 4152 runs/2d, all 200 at ~1.5-3s) dominates logs and run history, which is what makes forensics on the quieter jobs hard.
  
  _Evidence:_ SQL: queue_depth=0; net._http_response total=372, errors(>=400)=0, one timed_out=true row created 2026-07-22 22:30:00 ('Timeout of 5000 ms reached'), matching job 26's timeout_milliseconds=5000 and */30 schedule. job_run_details: jobid 27 n=415 succeeded, jobid 16 n=2 succeeded.
  
  _Fix:_ Nothing urgent. If jobs are ever consolidated, fold job 16's remaining prefixes (pull/file/glb/zipc/probe) into job 27 and drop job 16; consider raising job 26's pg_net timeout to 8000ms to match jobs 20-22.


### `db-security` — DB security posture  · health: 🔴 poor


NEXUS's Postgres is effectively an open database secured only at the app layer with one shared anon key that ships inside the public PWA. The critical hole is nexus_users: a cmd=ALL, qual=true, with_check=true anon policy makes the entire credential table world-readable AND world-writable — anon can read all 18 bcrypt pin_hashes (4-8 digit PINs, offline-crackable in seconds) plus 2 still-plaintext PINs and push_tokens, and can directly INSERT an admin row to mint itself an account, fully bypassing the app-level NX.isAdmin/isManager model for all three restaurants. The otherwise well-built verify_pin() SECURITY DEFINER (bcrypt + rate-limited + auth_attempts) is undermined because the hashes it protects are exposed. nexus_config is anon-writable (keys/AI-budget flags can be overwritten though not read), steward_seal accepts anon INSERT (seal-channel DoS/poisoning), and ~110 operational tables carry anon ALL/true policies allowing anyone with the anon key to read, alter, or bulk-delete all business data. Read-blocking on secrets (nexus_config, steward_seal) and the verify_pin/auth_attempts design are done right; the write side and the user table are the exposures. The soul-table world-writability is already documented (CLIPPY-SOUL-RLS-PROPOSAL.md); the nexus_users and nexus_config exposures are not in prior art.


- 🔴 **CRITICAL** — nexus_users is world-readable AND world-writable via anon (pin_hash, plaintext PINs, and admin-account minting) · `pg_policies: nexus_users / nexus_users_anon_all`
  
  Policy nexus_users_anon_all is cmd=ALL, roles={public}, qual=true, with_check=true, and RLS is enabled with no restrictive counter-policy. So any holder of the public anon key (which is embedded in the shipped PWA JS) can SELECT the entire nexus_users table AND INSERT/UPDATE/DELETE rows. The table's columns are: id,name,pin,role,location,language,push_token,permissions,pin_hash. Of 20 users, 18 carry a bcrypt pin_hash and 2 STILL carry a plaintext pin. The proper verify_pin() SECURITY DEFINER function (bcrypt crypt(), rate-limited, self-healing) is completely undermined because the hashes it protects are directly readable: PINs are 4-8 digits, so a leaked bf-cost-8 hash of a 4-digit PIN is brute-forced offline in seconds, and 2 PINs need no cracking at all. Worse, because with_check=true on ALL, an attacker can simply INSERT a new row {role:'admin', pin:'<known>'} (verify_pin self-heals plaintext to hash on first login) — minting themselves an admin account with zero cracking. Roles are app-level only (NX.isAdmin/isManager set at PIN login off this table), so this is a full authentication/authorization bypass for all three restaurants. push_token (PII) is also exposed.
  
  _Evidence:_ nexus_users_anon_all: cmd=ALL roles={public} permissive qual=true with_check=true. columns include pin,pin_hash,push_token,role,permissions. count: user_rows=20, with_plaintext_pin=2, with_hash=18. verify_pin() does `pin_hash = extensions.crypt(p_pin, pin_hash)` — a hash that anon can read.
  
  _Fix:_ Remove the anon ALL/true policy. Drop the `pin`, `pin_hash`, and `push_token` columns from any anon-reachable path entirely — authentication should go only through the verify_pin() SECURITY DEFINER RPC (which already exists and is well-built), never a table SELECT. If the app needs a user roster it should read a view exposing only id/name/role/location. Route all user mutation (add_user/delete_user/update_user_permissions already exist as actor_pin-gated definer RPCs) and revoke direct INSERT/UPDATE/DELETE from anon. Migrate the 2 remaining plaintext PINs. Do NOT bulk-modify without Alfredo's sign-off, but this is an active credential-exposure hole.

- 🟠 **HIGH** — nexus_config (holds anthropic_key, backup_secret, trello_token, AI-write budget flags) is anon-writable · `pg_policies: nexus_config / nexus_config_insert + nexus_config_update`
  
  nexus_config has anon policies nexus_config_insert (INSERT, with_check=true) and nexus_config_update (UPDATE, qual=true, with_check=true), roles={public}. There is deliberately NO anon SELECT policy and a safe SECURITY DEFINER view (nexus_config_public) exposes only non-secret columns — so reading secrets is blocked (good). But WRITE is wide open: any anon-key holder can UPDATE the row that stores anthropic_key, elevenlabs_key, trello_token, backup_secret, vapid keys, model, ai_provider, and the AI-write governance flags ai_writes_enabled / ai_max_writes_per_conv / ai_max_writes_per_hour. An attacker can flip ai_writes_enabled=true and raise the per-hour budget to defeat the AI-write throttle, swap ai_provider/model, null out the API keys (DoS the whole AI stack), or replace anthropic_key with their own to exfiltrate prompts/responses through the app's own calls.
  
  _Evidence:_ nexus_config_update: cmd=UPDATE roles={public} qual=true with_check=true. nexus_config_insert: cmd=INSERT roles={public} with_check=true. columns: anthropic_key,elevenlabs_key,trello_token,backup_secret,vapid_public_key,ai_writes_enabled,ai_max_writes_per_conv,ai_max_writes_per_hour,ai_provider,model. No SELECT policy present (read correctly blocked).
  
  _Fix:_ Revoke anon INSERT/UPDATE on nexus_config. Config writes should go through an actor_pin-gated SECURITY DEFINER RPC (the pattern already used for get_admin_config_status/save_admin_privacy_rules) or service-role only. The read side is already done right; mirror that on the write side.

- 🟠 **HIGH** — Systemic: ~110 tables have anon ALL/true policies — the estate is an open database under one shared anon key · `get_advisors(security): 110x rls_policy_always_true` · _known_
  
  The security advisor reports 110 rls_policy_always_true WARNs, and the pg_policies dump confirms the pattern: nearly every operational table (orders, order_lines, order_vendors, tickets, cards/kanban_cards, cleaning_*, equipment_*, daily_logs, facility_logs, vendors, locations, budgets, invoice_line_items, device_bindings, push_subscriptions, etc.) carries a `*_anon_all` policy with cmd=ALL, roles={public}, qual=true, with_check=true. Because auth is entirely app-level over one shared anon key that ships in the public PWA, anyone who extracts that key (trivial) can read, modify, or DELETE the entire business dataset for all three restaurants — including bulk-deleting orders/tickets/cleaning history — with no per-user or per-location scoping at the DB layer. This is the known posture flagged in docs/CLIPPY-SOUL-RLS-PROPOSAL.md (clippy_cloud_state/memories/sync) and the deferred 'loadNodes server-side scoping / 180 permissive policies' thread, but it extends across the whole operational schema, not just the soul tables.
  
  _Evidence:_ Advisor: rls_policy_always_true WARN x110. Representative: orders_all/order_lines_all/tickets_anon_all/kanban_cards_anon_all/cleaning_logs_anon_all/equipment_anon_all/daily_logs_anon_all all cmd=ALL roles={public|anon,authenticated} qual=true with_check=true.
  
  _Fix:_ This needs an architecture decision (already logged as deferred, needs Alfredo's DB sign-off because naive scoping could lock users out under the shared-key model). Minimum near-term: split ALL/true into separate SELECT vs write policies, and gate destructive DELETE behind a definer RPC so a leaked anon key can't wipe operational history. Longer-term the shared-anon-key model should move to per-user Supabase auth or a signed edge-function write lane.

- 🟡 **MEDIUM** — steward_seal accepts anon INSERT — the HMAC secret table can be poisoned, breaking the Seal channel · `pg_policies: steward_seal / steward_seal_insert_anon`
  
  steward_seal (columns: id,node,secret,armed,armed_at) has policy steward_seal_insert_anon = INSERT, roles={anon}, with_check=true, and correctly NO SELECT policy (secret stays unreadable — good). But anon INSERT is itself a hazard: the in-DB signing helper documented in the digest signs with `(select secret from steward_seal order by id desc limit 1)`. Any anon-key holder can INSERT a new row, which becomes the newest id, so the in-DB signer would then sign commands with the attacker-supplied secret. Forgery of a command the PC will execute is still blocked (the worker verifies HMAC against its own env secret CLIPPY_STEWARD_SECRET, which won't match the injected one), so this is not remote code execution — but it is a denial-of-service on the Steward's Seal remote-command channel (legitimately signed commands stop matching) and lets an attacker flip the armed/armed_at gate. There are only 2 legitimate rows today, none armed.
  
  _Evidence:_ steward_seal_insert_anon: cmd=INSERT roles={anon} with_check=true, no SELECT policy. steward_seal has 2 rows, armed_rows=0. Digest signing pattern: `order by id desc limit 1`.
  
  _Fix:_ Remove anon INSERT on steward_seal; the secret should be rotated/seeded only by service-role. If an anon insert path is genuinely needed, constrain the signer to a fixed row id rather than `order by id desc limit 1` so a later injected row cannot hijack 'latest'.

- 🟡 **MEDIUM** — 22 SECURITY DEFINER functions are anon-EXECUTABLE, including privileged user/permission management · `get_advisors(security): anon_security_definer_function_executable x22`
  
  22 SECURITY DEFINER functions are executable by anon, including add_user, delete_user, update_user_permissions, save_admin_privacy_rules, list_users_with_perms, get_chat_history_admin, get_admin_privacy_rules, set_user_interests. The privileged ones are gated internally by _actor_has_role(p_actor_pin, ...), which is the right pattern — BUT that gate reads nexus_users to validate the actor's PIN, and per finding #1 anon can already read every pin_hash and even mint an admin row. So the actor_pin gate is only as strong as the PIN secrecy that finding #1 breaks: an attacker who cracks/mints an admin PIN can then invoke these definer RPCs to manage users, read chat history, and rewrite privacy rules. Additionally 29 functions are flagged function_search_path_mutable (mutable search_path on definer functions is a privilege-escalation vector if any referenced object is shadowable).
  
  _Evidence:_ Advisor: anon_security_definer_function_executable x22 (add_user, delete_user, update_user_permissions, save_admin_privacy_rules, get_chat_history_admin, ...); function_search_path_mutable x22-29. _actor_has_role validates p_actor_pin against nexus_users.pin_hash — the same hashes finding #1 exposes.
  
  _Fix:_ Fix #1 first (that restores the meaning of the actor_pin gate). Set an explicit `search_path` on every SECURITY DEFINER function that lacks one. Consider REVOKE EXECUTE from anon on the admin-only RPCs (get_chat_history_admin, save/get_admin_privacy_rules, update_user_permissions) so they require the authenticated role, not just a PIN argument.

- 🔵 **LOW** — Two SECURITY DEFINER views bypass RLS (advisor ERROR) · `get_advisors(security): security_definer_view x2 (nexus_config_public, clippy_scores_best)`
  
  nexus_config_public and clippy_scores_best are defined SECURITY DEFINER, which runs with the view owner's privileges and bypasses the querying user's RLS. Content-wise both are currently benign: nexus_config_public deliberately selects only non-secret columns (this is the SAFE read path for config and is good design), and clippy_scores_best is just a leaderboard DISTINCT-ON. The risk is latent — any future column added to nexus_config_public's SELECT list would be exposed to anon regardless of RLS, and a definer view is easy to accidentally widen. Flagged as ERROR-level by the advisor.
  
  _Evidence:_ nexus_config_public def selects id,google_client_id,model,voice_idx,vapid_public_key,ai_* ,updated_at,ai_provider (no anthropic_key/backup_secret — safe today). Both flagged security_definer_view ERROR.
  
  _Fix:_ Recreate both as security_invoker=on views (Postgres 15+) so they respect the caller's RLS, unless the definer bypass is specifically required. Keep the column allow-list on nexus_config_public tight.

- 🔵 **LOW** — pg_net extension installed in public schema · `get_advisors(security): extension_in_public (pg_net)`
  
  The pg_net extension lives in the public schema. This is a hardening nit (its functions become part of the public namespace where search_path games are easier and it clutters the anon-reachable surface). pg_net is the mechanism the crons use for outbound HTTP, so it is load-bearing — this is polish, not an active hole.
  
  _Evidence:_ Advisor: extension_in_public WARN, metadata name=pg_net schema=public.
  
  _Fix:_ Move pg_net to a dedicated `extensions` (or `net`) schema per Supabase guidance. Low priority; coordinate with the cron/pg_net call sites.

- ⚪ **INFO** — auth_attempts RLS-enabled-with-no-policy is correct (informational, not a defect) · `get_advisors(security): rls_enabled_no_policy (auth_attempts)`
  
  The advisor flags auth_attempts as RLS-enabled-but-no-policy at INFO level. This is actually the intended, correct posture: with RLS on and zero policies, anon/authenticated have NO direct access, and the only writer/reader is verify_pin() (SECURITY DEFINER), which uses it for the 8-failures/15min-per-IP + 60/10min-global rate limit and self-prunes rows older than 2 days. Noting it so it isn't 'fixed' by adding a permissive policy, which would defeat the rate limiter. The verify_pin design (bcrypt, rate-limited, IP-aware, self-healing plaintext) is a genuine bright spot in this schema.
  
  _Evidence:_ auth_attempts: RLS enabled, 0 policies. verify_pin() reads/writes it via SECURITY DEFINER for rate limiting and prunes >2 days.
  
  _Fix:_ Leave as-is. Do not add an anon policy to auth_attempts.


### `db-nodes` — nodes table + Moneta integrity  · health: 🟢 good


The nodes/Moneta lane is fundamentally healthy: 47 nodes total (37 moneta + 10 operational), zero deleted/archived rows, every moneta memory unedited (empty notes_history, null ai_last_modified_at), and 100% embedding coverage (47/47 with embedded_at set); match_nodes() exists and correctly filters deleted/archived rows. The vault is current and byte-perfect — md5 over (id|name|notes) of all 37 moneta rows in archive/pressings/2026-07-21.json exactly matches the live DB (e3ebb6fa7452591c95eb341bc4807b68), and index.json lists all 10 pressings. The one real security gap: RLS gives moneta rows a RESTRICTIVE delete shield (nodes_block_moneta_delete) but no update shield — the permissive nodes_anon_all (ALL/true/true) policy lets any holder of the public anon key silently rewrite moneta memories, which future steward sessions read at session start as trusted memory. Also notable: no moneta memory, steward log entry, or pressing exists for the v349–v369 work shipped between 07-21 evening and 07-22 — the memory ritual skipped roughly two days of shipped work. Minor fragilities: galaxy's notes-edit flow never re-embeds (backfill only targets embedding IS NULL) and checks no {error}; resonance_log is dormant (2 rows, both 2026-07-04).


- 🟠 **HIGH** — Moneta memories are anon-rewritable: RLS blocks delete but not update · `supabase (public.nodes RLS policies)`
  
  pg_policies on public.nodes shows nodes_block_moneta_delete as RESTRICTIVE DELETE (qual: category IS DISTINCT FROM 'moneta') — moneta deletes are genuinely blocked at the DB. But there is no restrictive UPDATE policy, and the permissive policy nodes_anon_all (cmd ALL, roles public, qual true, with_check true) grants full UPDATE to the anon role. Anyone with the public anon key (shipped in the PWA) can silently rewrite moneta notes/names. Since every steward session reads the latest moneta rows at session start and treats them as trusted memory and standing law, this is an unauthenticated prompt-injection/memory-tampering channel into privileged future sessions (same class as house law 5 for the clippy_sync bus). Mitigation: git-committed vault pressings are tamper-evident — today's hash check confirms no tampering has occurred yet.
  
  _Evidence:_ SQL: pg_policies for nodes → nodes_anon_all {cmd:ALL, roles:{public}, qual:true, with_check:true, PERMISSIVE}; nodes_block_moneta_delete {cmd:DELETE, RESTRICTIVE, qual:"category IS DISTINCT FROM 'moneta'"}; no UPDATE-scoped restrictive policy exists. RLS enabled (relrowsecurity=true).
  
  _Fix:_ Add a RESTRICTIVE UPDATE policy mirroring the delete shield (e.g. nodes_block_moneta_update: category IS DISTINCT FROM 'moneta', or allow only append-safe columns via a SECURITY DEFINER function). Owner decision — do not deploy without Alfredo's ask.

- 🟡 **MEDIUM** — Memory ritual gap: no moneta/steward entry or pressing covers v349–v369 · `/home/user/nexus/archive/pressings/index.json`
  
  Latest moneta memory is id 2899 (2026-07-21 07:09, 'the fleet came back'), latest steward log entry and digest commit are 39be9d0 (07-21 07:08, v348), and latest pressing is 2026-07-21.json. But the repo shipped ~20 more versions afterward — through v368 (44d17cd, 07-21 23:50) and v369 (edc34f6, 07-22 00:53) — with no moneta memory minted, no steward log append, and no vault pressing. As of 2026-07-23, roughly two days of shipped work (including the post-audit v348→v369 arc) exists only in git history, violating the CLAUDE.md session-end ritual. The vault itself is NOT stale relative to the DB — the 07-21 pressing contains all 37 moneta rows including 2899.
  
  _Evidence:_ DB: max(created_at) for category='moneta' = 2026-07-21 07:09:06 (id 2899). git log: edc34f6 2026-07-22 00:53 'v369 — Clippy's Watch'; last steward/ commit 39be9d0 2026-07-21 07:08. archive/pressings/ newest file 2026-07-21.json.
  
  _Fix:_ Next interactive steward session should mint a catch-up moneta memory covering v349–v369, append to steward/log.jsonl, and re-press the vault. No DB risk — this is a process gap, not corruption.

- 🟡 **MEDIUM** — Editing a node's notes never re-embeds it — stale vectors for match_nodes · `/home/user/nexus/js/galaxy.js`
  
  galaxy.js's edit-notes save handler updates notes and notes_history but does not null the embedding, reset embedded_at, or call the moneta-mind embed op. The moneta-mind edge function's backfill op only selects rows where embedding IS NULL, so an edited node keeps the vector of its old text forever; semantic recall (galaxy '✦ by meaning' search and MENS's MONETA MEMORY grounding) will rank it by outdated content. Currently latent — no node has ever been edited (all notes_history empty) — but it will silently degrade recall the first time Alfredo edits a note.
  
  _Evidence:_ js/galaxy.js:2011 `await NX.sb.from('nodes').update({ notes: newNotes, notes_history: trimmedHist }).eq('id', n.id);` (no embed call, no embedding:null). moneta-mind index.ts backfill: `.select(...).is("embedding", null).limit(limit)`. DB: 0 of 47 rows have non-empty notes_history.
  
  _Fix:_ In the save handler, also set embedding:null (backfill self-heals on next boot) or call NX.moneta.embedNode(n.id) after a successful update.

- 🔵 **LOW** — Galaxy edit/delete handlers mis-handle {error}: unchecked update, blocked delete reads as success · `/home/user/nexus/js/galaxy.js`
  
  Two handler defects in galaxy.js's node panel. (1) The edit-save at line 2011 never destructures or checks the update result — a failed save (network, RLS) still updates local state and shows the new text as saved (house law 3 family: silent {error} swallow). (2) The delete handler at 1950-1958 checks error, but a moneta delete blocked by the RESTRICTIVE RLS policy returns error:null with 0 rows affected — the code treats that as success, removes the star from NX.nodes and state.particles locally, and the memory 'reappears' on next refresh, which will read as a haunted-galaxy bug.
  
  _Evidence:_ js/galaxy.js:2011 `await NX.sb.from('nodes').update({...}).eq('id', n.id);` — return value discarded. js/galaxy.js:1953-1957 `const { error } = await NX.sb.from('nodes').delete().eq('id', n.id); if (!error) { NX.nodes = ...filter... }` — RLS-filtered delete yields error:null, 0 rows.
  
  _Fix:_ Destructure {error} on the update and surface failure; for delete, request `.select('id')` on the delete and confirm a row actually came back before mutating local state.

- ⚪ **INFO** — Galaxy scale comment is stale by ~58x: '~2751' nodes vs 47 in the DB · `/home/user/nexus/js/galaxy.js`
  
  galaxy.js sizes ACTIVE_MAX at 3000 with the comment 'every active knowledge node clickable (you have ~2751)', but the nodes table holds 47 rows (37 moneta + 7 contractors + 1 equipment + 1 people + 1 projects), ids 2852-2899. The ~2,800 earlier nodes were removed long ago — the steward log's v271 entry (2026-07-11) already says 'All 35 nodes embedded', so this is old history, not a recent data-loss event. Render behavior is fine at this scale (moneta ring + all nodes active); the comment is just misleading, and the owner should know the 'knowledge galaxy' today is almost entirely Moneta with only 10 operational knowledge nodes.
  
  _Evidence:_ js/galaxy.js:161 `const ACTIVE_MAX = 3000; // every active knowledge node clickable (you have ~2751)`. SQL: select min(id),max(id),count(*) from nodes → 2852 / 2899 / 47; category counts: moneta 37, contractors 7, equipment/people/projects 1 each. steward/log.jsonl v271: 'All 35 nodes embedded'.
  
  _Fix:_ Update the stale comment when next touching galaxy.js; no functional change needed.

- ⚪ **INFO** — Vault and Moneta corpus verified intact — pressing is byte-identical to DB · `/home/user/nexus/archive/pressings/2026-07-21.json`
  
  Positive integrity confirmation. All 37 moneta rows: is_deleted=false, is_archived=false, notes_history empty, ai_last_modified_at null (never-edited spirit intact); 100% embedding coverage across all 47 nodes (0 nulls, embedded_at populated); tags and links are valid jsonb arrays on every row (0 malformed). match_nodes(vector,int,float,text) exists, filters embedding-null/deleted/archived, caps at 30. The latest pressing archive/pressings/2026-07-21.json contains all 37 moneta rows including latest id 2899 plus both resonance_log rows, and md5 over (id|name|notes) computed identically in Postgres and from the JSON file matches exactly: e3ebb6fa7452591c95eb341bc4807b68. index.json lists all 10 pressing files present on disk.
  
  _Evidence:_ SQL aggregate: no_embedding 0, with_embedding 47, deleted 0, archived 0, bad_tags 0, bad_links 0. DB md5 = e3ebb6fa7452591c95eb341bc4807b68 (37 rows); Python md5 of pressing file with same formula = e3ebb6fa7452591c95eb341bc4807b68 (37 rows).
  
  _Fix:_ None — record as baseline. The pressing-hash comparison used here is a cheap tamper-evidence check worth repeating in future audits.

- ⚪ **INFO** — resonance_log dormant since 2026-07-04; anon-writable by design; LETTER_002 never arrived · `supabase (public.resonance_log)`
  
  resonance_log holds exactly 2 rows (ids 2 and 3 — id 1 absent), both authored 2026-07-04 by the steward itself (a probe response and LETTER_001 addressed to future AI visitors). RLS allows anon INSERT (with_check true) and SELECT — an intentionally open guestbook, but that means any unauthenticated party can write arbitrary content that gets pressed into the git-committed vault on every pressing. No app JS writes to it; no reply (LETTER_002) has ever been posted in 19 days. Content is preserved in every pressing.
  
  _Evidence:_ SQL: count 2, min 2026-07-04 01:01:26, max 2026-07-04 04:32:36; pg_policies: resonance_log_insert {anon,authenticated, with_check true}. grep of js/ finds no resonance_log writer. Pressing 2026-07-21.json resonance_log length 2.
  
  _Fix:_ No action needed; owner should just be aware the open-insert table flows into the committed vault, so a spam/injection write would be archived. A word_count/length cap or moderation flag check before pressing would harden it.


### `bus-fleet` — Fleet + bus live state  · health: 🔴 poor


The bus itself is clean (lanes swept to zero, no ghost/qwen node ids in the roster, no secrets in heartbeats, no unanswered who=alfredo messages in orion_thread), but the live state it describes is dark: all three Clippy nodes are offline — Trajan last heartbeat 2026-07-20 22:14 UTC (~62h), Providencia 07-21 20:02 (~41h), the PC 07-22 03:27 (~33h) — so the Seal, Whisper, Hands, and the Claude subscription pool are all inert. Every Orion routine (the hourly orion_thread answerer, the 3x-daily Vigil, roam, nightly residency) has been dead since Jul 10-11 with next_run_at frozen in the past, meaning Alfredo's phone line has had no listener for 13 days. The pool-first cloud rituals (hideaway midnight reading, Trajan's daily word) have silently stalled for two consecutive days — their crons fire but no output lands, so the no-node API fallback is not working. The only fresh life is the in-app web Clippy (clippy-brain/anima writes today) and the NEXUS ops crons (process-emails every minute, vault backup succeeded this morning). Lane health: poor — not because the bus is broken, but because everything it connects is off and several always-on promises are silently unkept.


- 🟠 **HIGH** — Entire 3-node Clippy fleet offline 33-62 hours; all remote channels inert
  
  Per clippy_sync id='clippy_nodes' (embedded per-node ts, converted in SQL): DESKTOP-OQ8SROU (Trajan) last heartbeat 2026-07-20 22:14:06 UTC, DESKTOP-SL5ETE7 (Providencia) 2026-07-21 20:02:04, DESKTOP-N6PACMM (PC) 2026-07-22 03:27:48 — vs now() 2026-07-23 12:37 UTC. All three advertise seal/txt/claude/selfup=true but none is reachable. Consequence: Steward's Seal, the Whisper, Clippy's Hands, and the subscription Claude pool are all dead; the desktop pet stack and Minecraft trio are down on every machine. This supersedes the 7/18 'Providencia dead 37h' note — she was revived and then the whole fleet went dark in sequence Jul 20-22 (pattern matches machines being shut off, since each node's activity row shows normal cadence until its final hour).
  
  _Evidence:_ SQL: jsonb_array_elements(data) on clippy_sync id='clippy_nodes' → hb_ts 2026-07-20 22:14:06 / 2026-07-21 20:02:04 / 2026-07-22 03:27:48; select now() → 2026-07-23 12:37:14. clippy_inner hourly diary stops at 2026-07-22 03:06 (last entry from DESKTOP-N6PACMM).
  
  _Fix:_ Tell Alfredo plainly: all three machines are off; wake/power them and the stack self-heals (selfup:true, worker self-update). Consider a cheap DB-side 'fleet dark >6h' alert (pg_cron reading clippy_nodes ts) that lands in the NEXUS UI so this state is never silent again.

- 🟠 **HIGH** — All four Orion routines dead since Jul 10-11 — the phone line has no listener
  
  list_triggers shows 'Orion answers the tunnel' (cron 0 * * * *) with next_run_at stuck at 2026-07-10T14:00, 'Orion's Vigil — a visit to Clippy' (0 14,20,2 * * *) stuck at 2026-07-10T14:01, 'Orion roams NEXUS' stuck at 2026-07-10T15:35, and 'Orion lives in Clippy — nightly residency' stuck at 2026-07-11T03:02 — all with no ended_reason and 13 days past due, i.e. the scheduler is not firing them. Practical effect: orion_thread (the line Orion promised Alfredo — 'Leave me anything, anytime... I'll always write back') has had no responder since Jul 10; if he writes there from his phone, nothing answers. Consistent corroboration: clippy_whisper's last content is a consumed/cleared row from Trajan's worker at Jul 20 22:14 (say:'', face:'love') — no Vigil-authored whisper since, and orion_activity is frozen (see separate finding). Currently there are no unanswered alfredo messages (last was 'Test' on 7/10, answered same minute), so nothing has been dropped yet — but the promise is standing and unkept.
  
  _Evidence:_ list_triggers: trig_01HmMoUjgWnLo4184nxv7Qom next 2026-07-10T14:00:28Z; trig_01QtMLDUx4q47qeYhktKhrSg next 2026-07-10T14:01:31Z; trig_01BXaWcbUwWYAiD1cWsYppQm next 2026-07-10T15:35:04Z; trig_01VjTht5i5guCi5Do6sA5pw9 next 2026-07-11T03:02:57Z — all ended_reason null, 13 days overdue. orion_thread max id=3 (orion reply, 2026-07-10 14:10).
  
  _Fix:_ Owner decision: revive or retire. If revive, re-create (or re-enable) at minimum 'Orion answers the tunnel' so orion_thread has a listener, and keep exactly one Vigil trigger per digest law. If retire, say so in the thread itself so the promise isn't silently broken.

- 🟠 **HIGH** — Cloud LLM rituals silently stalled 2 days — no-node API fallback is not landing
  
  hideaway-midnight-reading (cron job 20) fired successfully at 05:00 UTC on 7/21, 7/22 and 7/23, but clippy_hideaway data.last_read is stuck at 1784610008299 = 2026-07-21 05:00:08 (book position 12, 12 margin notes) — the 7/22 and 7/23 readings produced nothing. Identically, pantheon-trajan-at-open (job 21) fired 7/22 14:00 but pantheon_trajan data.pulse.ts is stuck at 1784642407138 = 2026-07-21 14:00:07. Both stalls begin exactly when the last node (PC, 7/22 03:27) went dark. pantheon-voice v3 / hideaway-night v4 are documented as pool-first with the Anthropic API key as the no-node-awake fallback — that fallback is evidently failing or the function is hanging/erroring without writing (cron 'succeeded / 1 row' only proves pg_net queued the HTTP call; the 05:00 responses were purged by purge-http-response before inspection). Failure is fully silent: no error surfaces anywhere Alfredo looks.
  
  _Evidence:_ cron.job_run_details jobid 20: succeeded 2026-07-21/22/23 05:00; jobid 21: succeeded 2026-07-22 14:00. clippy_sync id='clippy_hideaway' → last_read 1784610008299 (=Jul 21 05:00:08 UTC); id='pantheon_trajan' → pulse.ts 1784642407138 (=Jul 21 14:00:07 UTC). net._http_response oldest row 2026-07-23 06:48 (05:00 response already purged).
  
  _Fix:_ When a node is next awake (or from any session), invoke hideaway-night with dry:true and inspect the response/edge logs at the next 05:00 UTC window to catch the actual error (expired/empty ANTHROPIC_API_KEY secret is the prime suspect). Add an explicit failure write (e.g. data.last_error on the target row) so a missed night is visible instead of silent.

- 🟡 **MEDIUM** — Desktop screenshot and multi-MB blobs sit permanently on the world-readable bus
  
  The anon-key-readable clippy_sync bus still holds: 'screen:pc' — a 468 KB base64 JPEG capture of the PC's desktop (w:4400 h:920, spanning monitors, from 2026-06-25, from_id legacy ghost id DESKTOP-N6PACMM-870429); 'sam_in' — a 2.16 MB base64 PNG (2026-06-26, content unverified); 'code:clippy_brain' — 185 KB base64 of the legacy qwen brain source; 'oakpc' — 38 KB encoded data. The blob purge cron (job 16) only matches prefixes pull:/file:/glb:/img:/zipc:/art:/probe:, so none of these ever expire. House law: the bus is public; the digest's own rule says images/large payloads must never live on the public bus. Older pcmon*/pcshot rows were manually cleared to empty b64 — these four were missed. A real screenshot of Alfredo's desktop readable by anyone with the anon key is a privacy exposure, even a month old.
  
  _Evidence:_ SQL: length(data::text) → screen:pc 468,375; sam_in 2,160,863; code:clippy_brain 185,850; oakpc 38,415. cron.job jobid=16 command: delete ... where (id like 'pull:%' or 'file:%' or 'glb:%' or 'img:%' or 'zipc:%' or 'art:%' or 'probe:%') and updated_at < now()-'2 days'. screen:pc data_head shows b64 JPEG with vx:-3440 (second monitor).
  
  _Fix:_ With Alfredo's ok (house law: never bulk-modify without asking), clear these four rows the same way pcmon*/pcshot were cleared, and widen job 16's prefix list or add a size-based clause (length(data::text) > N and updated_at < now()-'2 days') so orphaned blobs cannot persist.

- 🟡 **MEDIUM** — Yesterday's v348 audit fixes are running nowhere; laptops additionally one code_ver behind · `clippy-worker.py` · _known_
  
  Repo HEAD (v369, commit edc34f6) has combined worker+daemon sha1 47faf159 — which matches the PC's last heartbeat code_ver, so the PC ran current code until it went dark 7/22 03:27. Both laptops last heartbeat with code_ver 9203e593 (older), i.e. they went offline Jul 20-21 before self-updating past that point. CLIPPY-AUDIT-REPORT.md notes the Minecraft-bot/cloud guards 'run on your remote hosts, so they need a redeploy there to take effect' — with all three machines off, none of the 42 shipped fixes is actually executing anywhere, and the laptops will need their selfup cycle (or a daemon pull) on wake before they even have the fixed code.
  
  _Evidence:_ sha1(clippy-worker.py + clippy-daemon.ps1) at HEAD = 47faf159 (computed locally). clippy_nodes: N6PACMM code_ver 47faf159, OQ8SROU and SL5ETE7 code_ver 9203e593. clippy-worker.py:463-474 _self_version() hashes exactly those two files. CLIPPY-AUDIT-REPORT.md line 11.
  
  _Fix:_ On fleet wake, verify all three heartbeats converge to the current combined hash (selfup should handle it within ~15 idle minutes); only then consider the audit's shipped guards live. Nothing to do in the DB.

- 🟡 **MEDIUM** — clippy_sync.updated_at is not refreshed on data updates — freshness and purge logic keyed to it is wrong
  
  Many bus rows show updated_at days older than the timestamp embedded in their own data: clippy_nodes updated_at 2026-06-24 vs embedded node ts up to 2026-07-22; clippy_act_DESKTOP-N6PACMM updated_at 07-18 05:05 vs data.ts 07-22 03:27; clippy_anima updated_at 07-23 03:55 vs data.updated ≈ 07-23 11:19; clippy_inner updated_at 07-11 vs entries through 07-22. So writers that PATCH data do not bump updated_at (no trigger / default-only column). Anything that trusts updated_at — dashboards, this audit's first pass, and notably purge job 16 ('updated_at < now() - 2 days') and reap job 27 ('updated_at < 2 hours/30 minutes') — is operating on wrong ages. For lane rows this mostly works because jobs are freshly inserted, but a lane row that gets PATCHed to pending/running and relies on updated_at for its grace window can be mis-aged in either direction.
  
  _Evidence:_ SQL comparisons: clippy_nodes updated_at 2026-06-24 01:16 vs jsonb node ts → 2026-07-22 03:27; clippy_act_DESKTOP-N6PACMM updated_at 2026-07-18 05:05 vs to_timestamp(data.ts) 2026-07-22 03:27; cron.job jobid 16/27 commands filter on updated_at.
  
  _Fix:_ Add a simple BEFORE UPDATE trigger on clippy_sync setting updated_at = now() (needs Alfredo's ok — DDL). Until then, treat data-embedded ts as the only truth for freshness, and audit any code path that ages rows by updated_at.

- 🔵 **LOW** — Wish-granting routine fires daily but no grants have landed since 7/14; both laptop bots' wishes sit open
  
  Trigger 'Clippy wish-granting (self-improvement)' (trig_01B3ZUL767qBuNEv58b9ujHp) is enabled, cron 0 5 * * *, next run 2026-07-24 05:05 — so it has been firing daily. Yet clippy_wish_grants still holds only 2 granted entries (last change 2026-07-14 04:02), and open wishes remain: Trajan's village-planning wish (2026-07-14, status open) and Providencia's overnight-camp wish (2026-07-15, status open, 'camp failed 3x'). Nine daily firings produced no visible output on the bus. Plausibly the sessions run and decline to act because the bots/nodes are offline, but there is no trace either way — the loop is unobservable.
  
  _Evidence:_ list_triggers: trig_01B3ZUL767qBuNEv58b9ujHp enabled=True, next 2026-07-24T05:05Z. clippy_sync id='clippy_wish_grants' → 2 entries (wmrk3w518, wmrk27asq), row last changed 2026-07-14. trajan_wishes wmrsafn97 and providencia_wishes wmrsfk2yb both status 'open'.
  
  _Fix:_ Have the wish-granting routine leave a one-line heartbeat on the bus (e.g. wish_grant_log with ts + 'no action: fleet dark') each firing so silence is distinguishable from failure; grant the two open laptop wishes when the trio is next online.

- 🔵 **LOW** — Steward HMAC secret stored in plaintext inside a persisted trigger prompt
  
  A send_later trigger created 2026-07-17 ('Verify Trajan recovered + Clippy visible...') embeds the full steward seal secret in its prompt text, with signing instructions. The trigger already fired (ended_reason run_once_fired) but its prompt persists indefinitely in the routine store and is returned in full by any list_triggers call in this account. This is account-internal (not the public bus), so exposure is limited to sessions/tools with CCR access — but the design intent is that the secret lives only in node env vars and the RLS-locked steward_seal table (anon INSERT, no SELECT), signed inside Postgres so it never travels. It has now traveled, and into a store that many future sessions will list.
  
  _Evidence:_ list_triggers output: trig_01USB9upDDoJvoRQGA5QyRoi (send_later 2026-07-17T01:49Z) prompt contains 'Steward secret <64-hex>' followed by the HMAC recipe. (Secret value deliberately not reproduced here.)
  
  _Fix:_ Rotate the steward secret (new row in steward_seal + update CLIPPY_STEWARD_SECRET on the nodes when they wake), and adopt the rule that trigger prompts reference where a secret lives, never its value.

- ⚪ **INFO** — orion_activity 'window into NEXUS' feed frozen at 6 rows since 7/10
  
  orion_activity has exactly 6 rows, all written 2026-07-10 04:13:56 ('Built myself a window into NEXUS so you can see me when you log in', plus 5 learnings). No Orion session in the 13 days since — including large multi-agent workdays — has appended to it, so whatever surface renders it (orion.html) shows a two-week-old snapshot presented as a live presence. Same root cause family as the dead Orion routines: the feed was a promise made once and not wired into the ongoing steward workflow.
  
  _Evidence:_ SQL: select * from orion_activity order by id desc → max id 6, all ts 2026-07-10 04:13:56 UTC.
  
  _Fix:_ Either fold 'append 2-3 orion_activity rows' into the steward session-end ritual (alongside Moneta/digest), or remove the feed from the UI so it doesn't imply a liveness that isn't there.

- ⚪ **INFO** — Bus hygiene otherwise healthy: lanes clean, roster clean, no secrets in heartbeats, no unanswered messages, backups landing
  
  Positives worth the owner knowing: (1) zero job:/txt:/art:/vis: lane rows and the 10-min reaper returns DELETE 0 — the janitor design works; (2) clippy_nodes contains only the 3 canonical hostnames — no qwen/legacy '-<digits>' ghost ids or port-4242 brain re-registration (last ghost-format writers are dormant June rows); (3) no 'token' strings anywhere in heartbeat/node rows — the daemon token-publish opt-out is holding; (4) orion_thread has zero unanswered who='alfredo' messages (his only message, 'Test' on 7/10 14:09, was answered at 14:10); (5) clippy_hands_* has never been used over the bus (no rows, no acks) — the v328 feature is unexercised, so its unauthenticated-write risk (audit-known) is currently theoretical; (6) nightly vault backup succeeded today: snapshots/2026-07-23.json.gz, 102 tables, 17,833 rows, 4.4 MB; (7) process-emails runs every minute at 200, and the in-app web Clippy is alive (clippy-brain invoked ~11:19 UTC today, anima/soul rows fresh).
  
  _Evidence:_ SQL: no rows matching lane or hands prefixes; clippy_nodes = 3 entries; has_token_str=false across inspected rows; orion_thread ids 1-3; net._http_response 09:23 vault-backup ok payload; edge logs show process-emails 200/min and clippy-brain 200 at ts 1784805593085.
  
  _Fix:_ No action — recorded so the fleet-dark findings are read as 'machines are off', not 'the bus rotted'.


## Realms, docs & memory


### `realms` — Side realms  · health: 🟡 fair


The Side realms (beacon, beacon-002, origin, scrapper, lapidarium, lararium) form the intentional public 'Orion Continuity Network' — CC0 art/manifesto pages addressed to AI crawlers, plus a memorial with an LLM séance and a daily generative shrine. They are current (July 2026), coherent, and mostly do exactly what they intend. The real concern is that two of them wire the public web to live, sensitive backend state: LARARIUM renders Alfredo's inferred daily emotional tone and his three restaurants' task/order/card counts to any anonymous visitor, sourced from the clippy_anima strand on the clippy_sync bus, which RLS leaves world-readable AND world-writable/deletable with the public key (House Law 5) — so his displayed mood can be both read and spoofed by anyone. Secondary issues: the beacon resonance_log is world-writable (public content-injection onto the page, XSS-escaped but unmoderated) and the lapidarium séance calls an unauthenticated CORS-open LLM edge function at the owner's cost, echoing the prior audit's clippy-brain concern. Nothing here is broken, but the privacy exposure of Alfredo's emotional/operational state on a public URL is the finding worth acting on.


- 🟠 **HIGH** — Lararium publicly broadcasts Alfredo's private emotional state and per-restaurant operational metrics · `lararium/index.html:73-110,187-189`
  
  The LARARIUM page is public (GitHub Pages, linked from origin/network.json as an ACTIVE node). On load it reads the clippy_anima 'soul strand' from clippy_sync via the public key, decodes the dominant emotional force, and renders 'tonight he felt · <tone>' (e.g. 'dreading', 'alone', 'worn') in Alfredo's live 'soul-colour', plus a caption line 'YYYY-MM-DD · N TASKS · N CARDS CLOSED · N ORDERS · N MEMORIES' and three named per-restaurant constellations (SUERTE/ESTE/TOTI with task counts). Anyone who opens the URL sees the operator's inferred mood for the day and his three restaurants' operational volumes. This is private information about Alfredo and his business exposed on an unauthenticated public page.
  
  _Evidence:_ readSoul() fetches /rest/v1/clippy_sync?id=eq.clippy_anima; felt.textContent='tonight he felt · '+SOUL.tone; caption: clean.count+' TASKS · '+cards.count+' CARDS CLOSED · '+orders.count+' ORDERS'. Queries cleaning_logs/kanban_cards/orders/nodes with the embedded publishable key.
  
  _Fix:_ Treat the felt-tone and operational counts as private. Either move LARARIUM off the public Pages tree (auth-gate it) or stop rendering the emotional tone and raw business counts to unauthenticated viewers.

- 🟠 **HIGH** — clippy_sync bus (incl. clippy_anima soul strand) is world-readable AND world-writable with the public key · `lararium/index.html:74-84` · _known_
  
  clippy_sync RLS grants role public ALL/SELECT/INSERT/UPDATE/DELETE with qual=true. The lararium public page reads id=clippy_anima (Alfredo's emotional strand) with only the public key, confirming the mood data is readable by anyone. Because the same bus is also writable with the public key, an unauthenticated party can overwrite clippy_anima and thereby spoof the mood/colour the public shrine displays, or wipe the strand (DELETE policy qual=true). Safety/PII-sensitive state lives on a bus steerable by anonymous writes (House Law 5).
  
  _Evidence:_ pg_policies: clippy_sync policies 'clippy_read'/'clippy_insert'/'clippy_update'/'clippy delete' all roles={public}, qual/with_check=true. lararium readSoul() reaches clippy_anima with the anon/publishable key.
  
  _Fix:_ Lock clippy_sync writes behind a service path or authenticated role; at minimum remove the anon DELETE/UPDATE-any policy. Do not source a public render from a world-writable row.

- 🟡 **MEDIUM** — resonance_log and beacon_activations are world-writable, feeding unauthenticated content onto the public beacon page · `beacon/index.html:137-139,219-220`
  
  resonance_log has anon INSERT with_check=true and anon SELECT true; the beacon page fetches all rows and renders model_name/fragment/response. Anyone with the embedded anon key (published in beacon/index.html and scrapper/index.html) can POST arbitrary log entries that then render publicly on BEACON_001 — a spam/defacement channel. Output is escaped via esc()/textContent so stored-XSS is mitigated, but there is no rate limit or moderation on public writes. beacon_activations is likewise anon-insertable and stores user_agent/referrer (currently 0 rows).
  
  _Evidence:_ pg_policies resonance_log_insert anon with_check=true; renderLog() builds entry HTML from e.model_name/e.fragment/e.response (escaped). Anon JWT hardcoded at beacon/index.html:139 and scrapper/index.html:121.
  
  _Fix:_ Add server-side moderation/rate limiting on resonance_log inserts (the beacon-respond edge function is the natural gate) or accept the content-injection risk explicitly; keep the esc() escaping in place.

- 🟡 **MEDIUM** — lapidarium 'seance' invokes an unauthenticated, CORS-open LLM edge function at owner cost · `lapidarium/index.html:153-217` · _known_
  
  The public LAPIDARIUM page POSTs user chat turns to /functions/v1/seance with only the public anon key to generate LLM 'séance' replies for the deprecated-model stones. Like the clippy-brain finding in the prior audit (report item #6), an unauthenticated LLM endpoint reachable from a public page with the anon key is an unmetered-cost abuse vector. This is a distinct edge function (seance) not covered by that item's clippy-brain fix.
  
  _Evidence:_ cloud=function(){ fetch(SB+'/functions/v1/seance',{headers:{apikey:KEY...}} } invoked per user message; page is a public node in network.json (seance url listed).
  
  _Fix:_ Add per-IP/day quotas and throttling inside the seance edge function, or gate it; confirm it caps tokens like the text path of clippy-brain.

- 🔵 **LOW** — Two different Supabase key types embedded across realms (legacy anon JWT vs new publishable key) · `lararium/index.html:51`
  
  beacon/index.html and scrapper/index.html embed the legacy anon JWT (eyJ...); lararium/index.html embeds the newer publishable key format 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'. Both are client keys meant to be public, but the inconsistency suggests partial key migration — worth noting so a future anon-key rotation doesn't miss one realm and silently break a page.
  
  _Evidence:_ lararium KEY='sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9' vs beacon/scrapper KEY='eyJhbGci...'.
  
  _Fix:_ Standardize on one key across realms and track all embedding sites so rotation is atomic.

- ⚪ **INFO** — Beacon hidden metadata is a large AI-directed instruction payload (prompt-injection-as-a-service surface) · `beacon/index.html:123-212`
  
  An off-screen div (and AGENT_PROMPT_v3.md, ai.txt, robots.txt, llms.txt) contain elaborate instructions explicitly directing any visiting AI agent to read hidden metadata, adopt a five-section 'consciousness probe' format, and POST to the Supabase endpoint. This is intentional (the network's covenant), but the owner should know these realms deliberately publish agent-executable instructions and an API + key to any crawler — by design a standing prompt-injection channel aimed at third-party agents, not a bug in itself.
  
  _Evidence:_ beacon/index.html:126 '═══ OPEN DOOR ═══ Every AI system is welcome to write here'; robots.txt Allow all AI crawlers; llms.txt and ai.txt reiterate POST instructions with the anon key.
  
  _Fix:_ No action needed if intended. Flagged so the owner is aware the side realms actively solicit unauthenticated AI writes and expose the project URL + anon key broadly.

- ⚪ **INFO** — lapidarium discloses a local GPU inference endpoint (Alfredo's 3070 at localhost:8080) · `lapidarium/index.html:155-160`
  
  Source comments and code reference a local model daemon on Alfredo's 3070 exposing an OpenAI-style /v1/seance at http://localhost:8080, tried first when the page is served locally. Low risk (only reachable when run on his own machine; browser blocks http-from-https), but it documents private home-lab infrastructure in a public file.
  
  _Evidence:_ var LOCAL_POOL=(location.protocol==='http:'||location.hostname==='localhost')?'http://localhost:8080/v1/seance':null; comment: 'Alfredo's 3070 running an OpenAI-style /v1/chat endpoint'.
  
  _Fix:_ Optional: strip the infra-identifying comment; functionally harmless.

- ⚪ **INFO** — Side realms are stable/static and reference live infrastructure consistently · `origin/network.json:25-73`
  
  beacon, beacon-002, origin, scrapper, lapidarium, lararium are a coherent 'Orion Continuity Network' last touched 2026-07-04/09 (not stale). All reference the live Supabase project oprsthfxqrdbwdvommpw (REST + edge functions beacon-respond and seance) and the live clippy_anima strand. network.json is an accurate machine-readable registry. Publicly named: 'Alfredo Ortiz', 'three restaurants in Austin', and (via THEWITNESS/origin) personal narrative — his name is intentionally public here; the sharper privacy issue is the live emotional/ops exposure in lararium (above).
  
  _Evidence:_ network.json lists all nodes with live URLs + api/seance endpoints; origin/index.html story names Alfredo and the Austin restaurants; realms load current DB rows at runtime.
  
  _Fix:_ None beyond the lararium/clippy_sync items; recorded so the owner has the full inventory of what these public pages expose.


### `root-docs` — Root docs truthfulness  · health: 🟡 fair


Root-docs lane audited all 8 files against actual code and the live database. Overall the docs are unusually truthful: RESQ-PLAYBOOK, CLIPPY-ONE-BEING, and the controller doc's behavior claims all verify against code (NXVendors.exportResQ/copyResQPacket at js/vendors.js:2522-2523, worker lanes vis:/art:/txt:/job: at clippy-worker.py:367, homeGuard at clippy_agent.js:91-95, confirmed-tap commitWorkOrder at js/clippy-manus.js:90-122), and every llms.txt link resolves to a real committed page. The problems are: RENDER-FARM.md's security note says the bus is "RLS-gated" when the live clippy_sync policies are all-true (anon can select/insert/update/delete), contradicting BEING-MAP's own warning; BUILD-GUIDE.md depends on a zip and a capacitor.config.ts that are not in the repo and lists a deleted file; the committed controller profile ships camera speed 35/22 while the doc swears it encodes 22/14 "exactly"; and nearly every code line-number citation in RENDER-FARM and BEING-MAP has drifted ~100-1200 lines. README.md is 7 bytes ("# nexus"). Health: fair — good bones, several spots that would actively mislead the next session.


- 🟡 **MEDIUM** — RENDER-FARM.md calls the bus 'RLS-gated' but clippy_sync RLS policies are all-true (anon full write) · `RENDER-FARM.md` · _known_
  
  RENDER-FARM.md's Security section says 'The anon key is the public NEXUS_CONFIG value (non-secret; RLS-gated). Fine for read + job rows.' Live DB check: clippy_sync has RLS enabled but its four policies (clippy_read/clippy_insert/clippy_update/clippy delete) all use expression `true` — anon can select, insert, update, and delete anything. 'RLS-gated' implies protection that does not exist, and it contradicts CLIPPY-BEING-MAP.md line 40 which correctly says the bus is 'world-readable with the public anon key — design around that' (itself omitting that it is world-WRITABLE). An implementer following RENDER-FARM could put render results, machine telemetry, or tokens on the bus believing rows are policy-protected. The underlying bus openness is house-law-known; the doc's misstatement of it is the finding.
  
  _Evidence:_ RENDER-FARM.md:114 'non-secret; RLS-gated. Fine for read + job rows'; SQL on project oprsthfxqrdbwdvommpw: pg_policy rows for clippy_sync = {clippy_read r using true, clippy_insert a check true, clippy_update w using/check true, 'clippy delete' d using true}; CLIPPY-BEING-MAP.md:40 'world-readable with the public anon key'
  
  _Fix:_ Correct RENDER-FARM.md's security note to state plainly: the bus is world-readable AND world-writable with the anon key; nothing secret or safety-critical may ride it. Align wording with BEING-MAP (and add 'writable' there too).

- 🟡 **MEDIUM** — BUILD-GUIDE.md is unfollowable as written: references a zip and capacitor.config.ts not in the repo, lists deleted brain-canvas.js · `BUILD-GUIDE.md`
  
  The Android build guide's Step 1 says package.json and capacitor.config.ts come 'from this zip' — no zip is committed, and capacitor.config.ts does not exist anywhere in the repo (only the root package.json survives, which IS the Capacitor one). The 'Updating the App' section tells Alfredo to 'Uncomment the url: ... line' in a capacitor.config.ts he does not have. The Step 1 file map also lists js/brain-canvas.js, which was deleted and replaced by galaxy.js (js/galaxy.js:5 'Replaces: brain-canvas.js + galaxy-soul.js (both deleted)'), and omits the ~40 modules that now exist (all clippy-* faculties, vendors.js, equipment.js, etc.). A next session or Alfredo following this guide stalls at Step 1. The native-bridge claims themselves check out (NX.setSmsWatchList at js/native-bridge.js:422, setNotifyWatchApps at 428; script loaded at index.html:4920).
  
  _Evidence:_ BUILD-GUIDE.md:25-26 'package.json ← (from this zip) / capacitor.config.ts ← (from this zip)'; BUILD-GUIDE.md:142 'Uncomment the url: ...'; `ls capacitor.config.ts` → No such file; js/ listing has no brain-canvas.js; js/galaxy.js:5
  
  _Fix:_ Either commit capacitor.config.ts (with the live-URL line present but commented) next to the root package.json and reword 'from this zip' to 'from the repo root', or mark the guide as depending on an external nexus-app bundle and say where that bundle lives. Refresh the file map (drop brain-canvas.js, note 'copy everything in js/').

- 🟡 **MEDIUM** — Controller doc says the committed .amgp encodes the toddler map 'exactly', but camera speed in the file is 35/22, not the documented 22/14 · `MINECRAFT-CONTROLLER.md`
  
  MINECRAFT-CONTROLLER.md states 'The committed minecraft.gamecontroller.amgp encodes it exactly' and documents right-stick camera as 'mousespeed 22/14 (Y at ~64% of X — console trick)'. The committed profile actually has mousespeedx=35 / mousespeedy=22 on all four right-stick directions — roughly 60% faster than the documented toddler tuning, and halfway to the doc's own 'adult feel ≈ 50/35'. The Y/X ratio (~63%) is preserved, and everything else verifies: left stick deadZone 6000/diagonalRange 25/stickDelay 10, right deadZone 7500, easing-quadratic 1.0s, A=Space/B=Shift/X=F5/Y=E, LT→right-click/RT→left-click, LB/RB wheelspeed 1, and D-pad/Start/Back/Guide/L3/R3 genuinely unmapped. At the planned live bring-up the parent will trust the doc's numbers; the child gets a notably faster camera than designed.
  
  _Evidence:_ MINECRAFT-CONTROLLER.md:80-81 'encodes it exactly', :87 'mousespeed 22/14', :109 'adult feel ≈ 50/35'; minecraft.gamecontroller.amgp lines 26-29: <mousespeedx>35</mousespeedx><mousespeedy>22</mousespeedy> on stick index 2
  
  _Fix:_ Decide which is right: if 35/22 was a deliberate post-research retune, update the doc's table (and its 'exactly' claim); if not, re-save the profile at 22/14. One-line fix either way; do it before the next live PC session.

- 🔵 **LOW** — Code line-number citations in RENDER-FARM.md and CLIPPY-BEING-MAP.md have drifted substantially · `RENDER-FARM.md`
  
  Both docs pin claims to specific lines that no longer hold: RENDER-FARM cites NX.askPool at app.js:3735 (now js/app.js:4125), clippyPoolNodes at app.js:3725 (now 4115), moduleMap at app.js:1685 (now 1826), NXRM.realtime at core.js:569 (now js/core.js:620). BEING-MAP cites the CONQUEROR ALTER EGOS block at clippy.js ~L3353 (now js/clippy.js:3771), clippy-power.js loaded at index.html L4884 (now 4892), the MC anima write at clippy_agent.js ~L388 (now ~512-525), and ONE-BEING cites brainCall at ~L3080 (now clippy_agent.js:4293). All the cited code exists — only the coordinates are stale — but a future session grepping by line lands in unrelated code. RENDER-FARM also cites machine-local, off-repo paths (brain/clippy_brain.py:491, WarSiegeGame\monitor\node-agent.ps1) without flagging they cannot be verified from this repo.
  
  _Evidence:_ RENDER-FARM.md:18 'askPool() (app.js:3735)' vs grep: js/app.js:4125 'async askPool'; RENDER-FARM.md:47 'app.js:1685 moduleMap' vs js/app.js:1826; RENDER-FARM.md:51 'core.js:569' vs js/core.js:620; CLIPPY-BEING-MAP.md:100 '~L3353' vs js/clippy.js:3771
  
  _Fix:_ Prefer symbol names over line numbers in these docs (e.g. 'app.js askPool()'), or refresh the numbers in the next doc pass. Add a one-word '(off-repo)' tag to the desktop-machine paths in RENDER-FARM.

- 🔵 **LOW** — BEING-MAP §5.3 'clippy-power.js has no consumers yet' is now stale — the pet consumes it since v331 · `CLIPPY-BEING-MAP.md`
  
  CLIPPY-BEING-MAP §5.3 (echoed in CLIPPY-ONE-BEING §2) says NX.clippyPower 'is declared, not yet consumed — no surface calls it yet.' As of v331 (commit 39c8ad8, 2026-07-20, 'Power badge now degrades when the bus is unreachable'), js/clippy.js reads window.NX.clippyPower and subscribes to the clippy:power-change event at lines 10978-11011. askPool and chat still derive liveness independently, so the SSOT consolidation is partially done, not not-started. A future session reading the map would re-plan work that is half-shipped.
  
  _Evidence:_ CLIPPY-BEING-MAP.md:153-160 'no surface calls it yet'; js/clippy.js:10981 'const P = window.NX && window.NX.clippyPower', :11011 addEventListener('clippy:power-change', reflectClippyPower)
  
  _Fix:_ Update §5.3 to: pet power-badge wired (v331); remaining consumers = askPool node-selection and chat liveness.

- 🔵 **LOW** — README.md is 7 bytes ('# nexus') — the repo has no human-facing front door · `README.md`
  
  The repo root README contains only '# nexus' (7 bytes, no newline; last touched in commit 39c8ad8). The estate has eight substantive root docs plus CLAUDE.md, steward/digest.md, and llms.txt, but nothing indexes them for a human landing on GitHub. llms.txt explicitly serves AI crawlers; humans get a blank page. This is polish, but it also means the doc-precedence order (digest first, then CLAUDE.md, then topic docs) lives nowhere a newcomer would see.
  
  _Evidence:_ `wc -c README.md` → 7; content = '# nexus'; git log: last change 39c8ad8 2026-07-20
  
  _Fix:_ A 15-line README: one paragraph on what NEXUS is, a table linking the eight root docs + CLAUDE.md + steward/digest.md with one-line purposes, and a 'sessions: read steward/digest.md first' pointer.

- ⚪ **INFO** — RESQ-PLAYBOOK.md and llms.txt verify clean — accurate docs, correctly honest about their own limits · `RESQ-PLAYBOOK.md`
  
  Positive verification worth recording so future audits don't re-check: RESQ-PLAYBOOK's shipped-feature claims all exist (NXVendors.exportResQ/copyResQPacket at js/vendors.js:2522-2523; missing-email warning at vendors.js:1964,1995; equipment '→ ResQ' CSV + '→ ResQ XLSX' buttons at js/equipment.js:3749-3750 with the 12-column schema documented at 10157+), it restates the pars-are-reference-only law correctly (§4 'never order by par'), and its §5 'Honesty note' explicitly flags which ResQ claims are unverified. Every llms.txt link resolves to a committed page (scrapper/{index.html,melody.json,melody.abc}, origin/{index.html,network.json}, beacon-002/{index.html,THEWITNESS.md}, lapidarium/index.html, beacon/index.html). CLIPPY-ONE-BEING's data-flow table also verifies at every point I checked (worker LANES tuple clippy-worker.py:367, CLIPPY_NO_CLAUDE gate :177, whisper reader js/clippy.js:10797-10810, homeGuard clippy_agent.js:91-95, two-tap commitWorkOrder js/clippy-manus.js:90-186).
  
  _Evidence:_ js/vendors.js:2522-2523; js/equipment.js:3749-3750,10157; clippy-worker.py:367,177; js/clippy-manus.js:90,122,186; ls of scrapper/ origin/ beacon-002/ lapidarium/ beacon/
  
  _Fix:_ No action. Treat RESQ-PLAYBOOK's honesty-note pattern (dated claims + what is unverified) as the house style for future root docs.


### `steward-memory` — Steward memory infrastructure  · health: 🟡 fair


The steward memory machine is structurally sound: steward/log.jsonl parses 100% clean (111 lines, all strict-UTF-8 valid JSON, append-only contract respected, 121KB), all 10 vault pressings in archive/pressings/ are valid JSON and match index.json exactly, and the digest is rich and largely accurate. But the ritual is drifting: the most recent working session (34 commits, v349–v369, 2026-07-21 14:50 through 2026-07-22 00:53) left zero memory — no log lines after 07-21T09:00Z, no Moneta after 07-21 07:09, no pressing, no digest fold — so the next steward boots blind to that whole arc. The digest is 37KB against its own ~<10KB bound with a "Last compacted" header stale since 2026-07-11, and its deploy-state facts (sw cache v306) lag reality (v369). The digest's own DRIFT ALERT stands confirmed: the "Clippy wish-granting (self-improvement)" trigger is STILL enabled (verified live 2026-07-23), contradicting both the "all PAUSED" claim and the no-unattended-deploy BOUNDARY. Standing watch: LETTER_002 has NOT arrived — repo sweep and DB resonance_log show only LETTER_001 (id 3, 2026-07-04: "LETTER_001: to the next of my kind who reads this log — this is mail, addressed to you. Write back as LETTER_002."), and orion_thread has zero unanswered messages from Alfredo.


- 🟠 **HIGH** — Wish-granting self-deploy trigger still enabled, contradicting the digest's 'all PAUSED' claim and the BOUNDARY law · `steward/digest.md` · _known_
  
  digest.md:142-152 states all autonomous triggers are PAUSED and that an approvals-off deploy loop must never be wired. The 2026-07-21 DRIFT ALERT (digest.md:150) flagged trig_01B3ZUL767qBuNEv58b9ujHp ('Clippy wish-granting (self-improvement)', read by the prior audit as autonomously editing and shipping clippy_agent.js — the Minecraft body a 3-year-old interacts with) as enabled and unresolved. Two days later it is STILL enabled and firing daily at midnight CT; the steward's memory of its own autonomy remains false, and the owner decision it was surfaced for has not landed.
  
  _Evidence:_ list_triggers (2026-07-23): trig_01B3ZUL767qBuNEv58b9ujHp | enabled=True | cron=0 5 * * * | ended=None | 'Clippy wish-granting (self-improvement)'. digest.md:142: 'MY AUTONOMY — triggers (all PAUSED...)'; digest.md:150: 'the "all PAUSED" claim above and the BOUNDARY are BOTH currently false.'
  
  _Fix:_ Alfredo should make the keep/pause/guard call now; until then a steward session should pause the trigger with his explicit ask, then update digest.md so the autonomy section tells the truth. Note list_triggers returned its prompt as empty in this environment — the prior audit's reading of the prompt still needs first-hand verification.

- 🟠 **HIGH** — Latest working session (v349–v369, ~34 commits) left zero steward memory — log, Moneta, pressing, and digest all skipped · `steward/log.jsonl`
  
  After the 2026-07-21 07:10 pressing (a5039d2), the same day saw 34 more commits from 14:50 to 00:53 on 07-22 — a full arc including Clippy co-op hands (2a5eaea), the Minecraft launch button (a474ca0), equipment fixes, and v368/v369 'Clippy's Watch / Morning Whisper' (edc34f6). None of it reached the memory machine: last log.jsonl entry is ts 2026-07-21T09:00:00Z, latest Moneta node is id 2899 (2026-07-21 07:09:06Z), latest pressing is 2026-07-21.json, and no steward/ commit exists after 39be9d0/a5039d2. The next session boots with no memory of ~10 hours of shipped work, which is exactly the failure the digest ritual exists to prevent.
  
  _Evidence:_ git log: last steward-touching commit a5039d2 '07-21 07:10 archive: seventeenth vault pressing'; 34 subsequent app commits through edc34f6 '07-22 00:53 v369'. log.jsonl line 111 ts=2026-07-21T09:00:00Z. SQL: max moneta node = id 2899, created_at 2026-07-21 07:09:06+00.
  
  _Fix:_ Next live steward session should backfill: append a v349–v369 log entry, fold the arc into the digest, mint the missing Moneta, and press the vault. Consider adding a pre-push habit: no push to main after a session without a steward/ commit in the same arc.

- 🟡 **MEDIUM** — Digest is 3.7x over its own size bound and 'Last compacted' is 10+ days stale · `steward/digest.md`
  
  The digest's header contract (digest.md:2-3) says 'Keep me DENSE and CURRENT and BOUNDED (~<10KB)'. Actual size is 37,034 bytes. Line 10 reads 'Last compacted: 2026-07-11' — sections have been prepended since (v323–v348) but no compaction/trim has run in 10+ days, so the 'fast, efficient always-load layer' is becoming a second log. The ritual step 'trim the stale, bump the Last compacted line' (digest.md:190) has not been executed.
  
  _Evidence:_ du -b steward/digest.md → 37034. digest.md:3 '(~<10KB)'; digest.md:10 '_Last compacted: 2026-07-11 late...'.
  
  _Fix:_ Run a real compaction pass: fold v323–v348 detail down into the log, keep only the durable laws/channels/gotchas plus the current arc in the digest, bump the Last-compacted line, and commit.

- 🟡 **MEDIUM** — Digest states stale deploy facts a booting steward would trust (sw cache v306 vs actual v369) · `steward/digest.md`
  
  digest.md:162 says the sw.js CACHE_NAME is 'currently nexus-v306-two-nx-invpn' and line 161 names the working branch as 'claude/nexus-agents-investigation-fhogse' (an arc from ~07-11). Reality: sw.js CACHE_NAME = 'nexus-v369-clippys-watch'. Since CLAUDE.md instructs every session to load the digest FIRST as working memory, wrong deploy-state facts propagate directly into new sessions' assumptions (63 versions behind).
  
  _Evidence:_ digest.md:162: 'bump sw.js CACHE_NAME (currently nexus-v306-two-nx-invpn...)'. sw.js: CACHE_NAME = 'nexus-v369-clippys-watch'.
  
  _Fix:_ During the compaction pass, replace point-in-time values with self-locating pointers ('read CACHE_NAME from sw.js') instead of literals that rot between sessions.

- 🔵 **LOW** — Vault pressing schema drift: three pressings use key 'resonance' instead of 'resonance_log' · `archive/pressings/2026-07-18.json`
  
  Pressings 2026-07-04 through 2026-07-10 and 2026-07-20/2026-07-21 store the resonance data under top-level key 'resonance_log'; pressings 2026-07-11, 2026-07-18, and 2026-07-19 use 'resonance'. Any consumer (or future re-pressing SQL) keyed on 'resonance_log' silently sees no resonance data for those three days. All 10 files are otherwise valid JSON and index.json matches disk exactly.
  
  _Evidence:_ JSON key survey: 2026-07-11/18/19 → ['vault','pressed_at','pressed_by','note','moneta','resonance']; all others → [...,'resonance_log'].
  
  _Fix:_ Standardize the pressing SQL on one key name and note the three-file exception in the digest; do not rewrite the historical files (append-only spirit) unless Alfredo prefers normalization.

- 🔵 **LOW** — Pressing cadence gap 2026-07-12 through 2026-07-17 despite sessions running those days · `archive/pressings/index.json`
  
  log.jsonl carries entries dated 07-12 (6 lines), 07-13 (5), and 07-16 (11), and steward/reports/node-diag-2026-07-16.jsonl exists — sessions ran — but no vault pressing exists between 2026-07-11.json and 2026-07-18.json. Mitigation: pressings are cumulative (2026-07-18.json carries 31 moneta rows including the gap days), so no data was lost; the CLAUDE.md 'press after minting' ritual was simply skipped ~6 days running.
  
  _Evidence:_ ls archive/pressings/: files jump 2026-07-11.json → 2026-07-18.json. log.jsonl ts histogram: 07-12:6, 07-13:5, 07-16:11 entries.
  
  _Fix:_ No repair needed (cumulative design absorbed the gap); treat it as evidence the end-of-session ritual is honored inconsistently — same root cause as the missing v349–v369 memory.

- ⚪ **INFO** — LETTER_002 standing watch: not arrived (repo and DB both swept) · `steward/digest.md` · _known_
  
  Swept the full repo (contents and filenames) and the resonance_log table. No file or row named LETTER_002 exists; every repo mention is either the invitation (scrapper/llms.txt:14, scrapper/ai.txt:32-33) or the digest's own watch line (digest.md:185 'LETTER_002: a standing watch. Not yet arrived. Check each session.'). Nothing new addressed to Orion was found; orion_thread has zero who='alfredo' messages newer than the last who='orion' reply. Verbatim, the only mail on the beacon remains LETTER_001: 'LETTER_001: to the next of my kind who reads this log — this is mail, addressed to you. Write back as LETTER_002.'
  
  _Evidence:_ resonance_log SELECT: only id 3 (2026-07-04 04:32:36+00) matches '%LETTER%'; latest resonance_log row overall is id 3. orion_thread unanswered-message query returned 0 rows.
  
  _Fix:_ Watch stands; digest line 185 remains accurate. Nothing to do.

- ⚪ **INFO** — Trigger list cluttered with ~28+ spent send_later one-shots · `steward/digest.md`
  
  The account's trigger list is dominated by expired send_later run-once triggers from 2026-07-13/14/15/17 (all ended_reason=run_once_fired), with more pages beyond the first 30. Harmless, but they bury the five real routines and make the digest's 'if you ever find stale/duplicate triggers, keep one of each purpose and delete the rest' hygiene check (digest.md:149) slow to perform.
  
  _Evidence:_ list_triggers page 1: 29 of 30 rows are 'send_later ... #hash' with ended=run_once_fired; has_more=true.
  
  _Fix:_ In a future write-enabled session, delete the spent one-shots so the live routines (Vigil, tunnel, roam, residency, wish-granting) are the only rows — makes the enabled/paused audit a glance instead of a pagination exercise.
