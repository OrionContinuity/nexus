# Clippy audit — overnight report (v348)

A **124-agent examination + adversarial-verify fleet** swept every Clippy surface (web pet, Minecraft bot, Python cloud heartbeat, soul, games, CSS, SVG) → **81 verified findings** → a ranked plan. Here's what shipped and what's waiting on you.

---

## ✅ Shipped tonight

**Web pet — v348, live on GitHub Pages (33 fixes).** Boot-smoke + 25/25 conformance clean.

**Minecraft bot + cloud heartbeat — 9 defensive guards, committed to `main`.** These run on your remote hosts, so they need a **redeploy there** to take effect. Syntax-validated (node --check / py_compile) but not runtime-tested from here.

Headline dangers now closed: MENS falsely reporting a house has *zero* open work; "never mind" silently deleting your newest notebook fact; the bot dying on a stray promise rejection; the bot wiping his own shared soul strand on a transient read error; the cloud heartbeat permanently bricking on one corrupt row; Flappy being unplayable.

---

## ⏸️ Deferred — spec'd, ready to apply on your word (23)

I held these back deliberately — UX/perf enhancements with real regression surface, or bot *gameplay logic* I can't runtime-test from CI. Say the word and I'll ship any/all.

### Web — polish/UX
- **[25] Pet is unreachable by keyboard and screen readers** — `js/clippy.js` (medium)
  - _Fix:_ In buildShell add role="button", tabindex="0", aria-label='Clippy assistant — activate to talk'. In wireShell add a keydown listener: Enter/Space→handleClick(); a modifier (Shift+Enter)→showWhatsUp(). Add a :focus-visible outline.
- **[26] Full-screen overlays close only via a bottom button — no Escape, no backdrop dismiss** — `js/clippy.js` (medium)
  - _Fix:_ Add a tracked document keydown while any overlay is open that clicks the topmost overlay's existing [data-act=close] button on Escape (reuses each overlay's own teardown). Add a position:sticky top-right × inside .clippy-dex-overlay. Also add Escape to openPalette.
- **[27] 3-second long-press to open the main menu gives zero progress feedback** — `js/clippy.js` (medium)
  - _Fix:_ Render a progressive hold indicator on pointerdown (radial 'is-charging' ring / fill over 3s), cleared alongside the existing timer clears in pointermove/pointerup/pointercancel. Consider shortening the menu hold to ~600-800ms, keeping the extra hold only for dismiss escalation.
- **[28] Chat panel can be hidden behind the mobile soft keyboard** — `js/clippy.js` (medium)
  - _Fix:_ On input focus, add a window.visualViewport 'resize'/'scroll' listener that clamps the fixed panel's bottom to visualViewport.height minus a margin; remove the listener in closeActionBubble to avoid a leak. (scrollIntoView won't work on a position:fixed panel.)
- **[53] Toast MutationObserver does a full-subtree querySelector per added node** — `js/clippy.js` (low)
  - _Fix:_ Drop the querySelector fallback and match only the node itself: el.classList.contains('toast-error') || (el.classList.contains('toast') && el.classList.contains('is-error')). NX.toast appends the toast as a discrete node, so the subtree scan never adds detection value.
- **[54] Bubble-follow rAF loop runs at 60fps for the whole lifetime of an open chat panel** — `js/clippy.js` (low)
  - _Fix:_ Throttle the follow tick to ~10fps (re-arm via setTimeout(...,100)+rAF or skip frames) so it isn't reading getBoundingClientRect 60×/sec for a shell that only relocates on discrete events. (Don't reposition purely on move triggers — that would break the 600ms glide-follow.)
- **[62] User chat bubble uses fixed near-black text over the variable soul color** — `css/clippy.css` (low)
  - _Fix:_ Set a JS-driven --chat-soul-ink var (defaulting to a light ink when the soul color is dark) alongside --chat-soul, and use it for the bubble/send-button text; or clamp the soul background to a guaranteed-light lightness.
- **[64] Fireflies animate left/top every frame (layout thrash) with ineffective will-change** — `css/clippy.css` (low)
  - _Fix:_ Drive the 8 firefly paths with transform: translate() using px/calc offsets (merged with the existing scale into one transform), keep opacity/transform in the keyframes, and set will-change: transform, opacity. Percentages resolve against the 5px dot, so use px, not %.

### Web — SVG cleanup
- **[63] Worn hats/emotion overlays detach from the orb during dance/bounce/spin** — `clippy.svg` (low)
  - _Fix:_ Move the costume groups (and face-attached overlays cl-sweat/cl-tear/cl-tears-stream/cl-drool/etc.) inside the cl-floats group before its </g> at 645 so they ride the same transform; or add the is-dancing/is-bouncing/is-spinning/is-jiggling rules to the costume selectors. Keep cl-prop-* outside if independent float is intended.
- **[65] Five gradient/filter defs are defined but never referenced (dead code)** — `clippy.svg` (idea)
  - _Fix:_ Delete cheek-grad (16), iris-grad (20), the glow filter (25), grad-leaf (49), grad-velvet (73) from <defs> — verified unreferenced. If any was intended to be wired (e.g. iris-grad for eyes), apply it instead.

### MENS — tuning
- **[58] isReport rejects explicit log imperatives that open with a request verb** — `js/clippy-mens.js` (low)
  - _Fix:_ Before the interrogative bail-out, whitelist explicit log/report imperatives: allow a report when REPORT_ASSERT_RX matches AND the opener is a request verb ('can you log/report/add', 'please log'). Do NOT whitelist bare 'is…' (would catch real questions).
- **[59] MENS has no live 'cleaning today' perceiver — grounded answers give static counts** — `js/clippy-mens.js` (low)
  - _Fix:_ Add a live-completion read to perceiveCleaning: query cleaning_logs for the current getCleaningDate() and summarize done/total per location (location-level to avoid the Spanish/English section mismatch); gate behind the {error}-checked q() and fall back to the task-count summary when no rows exist.

### Bot — gameplay logic (needs in-world test)
- **[5] Early-warning interpose overrides critical-health retreat and thrashes pathfinder goals** — `clippy_agent.js` (high)
  - _Fix:_ Add a panic + lease + stay gate to the interpose condition: if (p && !busy && !panic && mode!=='stay' && Date.now()>=_interposeUntil && dist(bot,foe)>5). Mirrors the already-correct guards at 1358/1624.
- **[9] Ender dragon marked defeated instantly on entering the End (fabricated milestone)** — `clippy_agent.js` (medium)
  - _Fix:_ Track a sawDragon flag set true on any phase where the dragon entity is present; only markDone('dragon')/mint 'dragonwin' when sawDragon && !dragon. (Or add a grace period before the absence check.)
- **[14] smeltIron freezes ~80s when no fuel is available** — `clippy_agent.js` (medium)
  - _Fix:_ Mirror cookFood: resolve a fuel item (coal/charcoal>logs>planks>stick) before the poll loop; if none, close the furnace and return false instead of loading input. Add a stagnation counter that breaks after ~6 zero-progress samples (~12s). Also takeInput() so raw iron isn't stranded.
- **[19] Post-spawn disconnect flap reconnects at a ~6s floor with no escalating backoff** — `clippy_agent.js` (medium)
  - _Fix:_ Track consecutive short sessions: increment _shortSessions in 'end' when Date.now()-_lastJoinAt<~30000, reset in 'spawn' after uptime passes a threshold; replace the flat 4000ms with Math.min(60000, 4000*2**Math.min(_shortSessions,4)).
- **[41] Sword selection uses the armor RANK map (no stone/wooden keys) instead of TIER_RANK** — `clippy_agent.js` (low)
  - _Fix:_ Use the existing tool map at 1363 and 1396: sort by (TIER_RANK[b.name.split('_')[0]]||0)-(TIER_RANK[a.name.split('_')[0]]||0) so stone (2) correctly outranks golden (1). Leave armorUp's legitimate RANK use untouched.
- **[44] moveNear resolves early off the shared goal_reached event fired by safetyTick** — `clippy_agent.js` (low)
  - _Fix:_ In onReached, only call fin() if bot.entity.position.distanceTo(v) <= dist+1.6 (the same tolerance the polling interval uses); otherwise ignore the event and keep waiting, so a goal_reached from another goal-setter is not mistaken for arrival.
- **[45] buildStructure retry pass keeps placing blocks after yielding to the child** — `clippy_agent.js` (low)
  - _Fix:_ Add the same guard to the top of the retry for-body: if (!playerAFK() && bp.length > 40) break; (mirrors the main loop's break at 3046). The existing FINISH-WHAT-HE-STARTED path resumes the build later.
- **[46] know.facts grows unbounded via the LLM <remember> command** — `clippy_agent.js` (low)
  - _Fix:_ Bound know.facts like the sibling stores: after assigning, if Object.keys(know.facts).length>40 drop the oldest key(s) before bsave. (Note: know.facts is never read anywhere, so this is pure write amplification.)
- **[47] companionPlan nested <do> has no recursion/depth guard** — `clippy_agent.js` (low)
  - _Fix:_ Thread a depth argument (default 0) through companionPlan/execCompanionAction and refuse to dispatch 'do'/'plan'/'task' when depth>=1, or strip <do>/<plan>/<task> from parseCompanionActions output inside companionPlan.
- **[60] Minecraft mind never inherits his self-written soul or Moneta** — `clippy_agent.js` (low)
  - _Fix:_ In buildSystem's CLIPPY branch only (keep companion branches uncontaminated), fetch clippy_sync?id=eq.clippy_soul once per session (guarded like sr) and inject a compact 'WHO I AM' line from soul.self (~300 chars) + soul.feeling; optionally pull the newest moneta node from the nodes table. Degrade to current behavior if unreadable.

### Cloud — race window
- **[20] Cloud heartbeat clobbers concurrent anima writes made during its slow LLM window** — `clippy-cloud.py` (medium)
  - _Fix:_ Re-read clippy_anima immediately before the final upsert and re-apply this run's deltas (solitude/warmth/weariness impress, decay, dream_op/evolve_op) onto the freshly-read strand — or move the whole anima RMW to after the LLM calls so the read-to-write gap is milliseconds.

---

## ❓ Needs your decision (7)

These are product/architecture calls, not bugs — I won't guess on them.

### 1. Anima strand last-write-wins across bodies (browser saveAnima + monotonic versioning)
`js/clippy-soul.js`

Cross-body soul sync needs an architectural decision, not a point fix. Two related issues: (a) browser saveAnima() at line 204 blindly overwrites the strand with its stale in-memory copy, dropping Minecraft/cloud impresses landing between the 90s refreshes; (b) the freshness gate at line 223 compares wall clocks from three different machines, so a lagging cloud/MC clock starves live propagation. The safe fix is a monotonic version counter carried inside the strand (or a DB-server-assigned updated_at), plus re-reading and re-applying only the pending local delta before write. This is a sync-protocol change touching all three bodies — do you want a version-counter scheme adopted, and are you OK with the browser doing an extra remote read on the reflect/dream hot path?

### 2. Orb drifts away ~2.2s after the user deliberately drops it near the nav/FAB
`js/clippy.js`

scoreCurrentPosition scores the FAB/bottom-nav at 160 (>100), so parking the orb there makes it auto-slide to a corner two seconds later — reads as refusing to stay put. But this is deliberate anti-block behavior ('he should never sit on these'). Raising the threshold to modal-only (>=200) or respecting the deliberate drop would let the orb permanently cover the FAB/nav. Which do you prefer: keep the current evacuation (accept the drift), or let a manual drop override it and risk blocking controls?

### 3. Gacha card 'powers' are advertised on cards but never applied
`js/clippy-gacha.js`

Every card advertises a mechanical power ('Trajan: Daily bonus +50%', 'Augustus: Start at Bond Lv 2') but nothing reads card.power — the collection promises a meta-game that doesn't exist. Two honest paths: (a) wire a small subset of bond/streak powers through the reward system (perturbs the deliberately-tuned rarity XP balance and touches cloud-synced state), or (b) reword the powers as pure lore so no card claims an effect it doesn't deliver. Which direction do you want?

### 4. Transient soul boot-read failure freezes persistence for the whole session
`js/clippy-soul.js`

A single flaky read at boot sets _soulReadFailed=true (correctly, to avoid clobbering the real row with DEFAULT_SOUL), but nothing ever re-reads or clears it, so the entire session's growth is never saved even after connectivity returns. A retry that re-reads and replaces/merges in-memory state carries state-replacement risk (could overwrite an evolved self mid-session). Do you want an auto-retry on failed boot read, and how should it reconcile in-memory drift accumulated before the retry succeeds?

### 5. Consolidate three concurrent document.body subtree MutationObservers
`js/clippy.js`

Three observers (toast 4517, overlay-suppression 8380, modal 9623) each watch document.body {subtree:true}; two are un-debounced and pay per-mutation cost on every render. Consolidating into one debounced fan-out is the clean fix but is a cross-cutting refactor across three install functions with real regression surface — and the toast path deliberately calls requestPetSight() immediately ('open his eyes NOW', his #2 wish), which a debounce would delay. Worth the refactor now, or defer? (The narrow toast querySelector fix is already shipped separately in the ranked plan.)

### 6. clippy-brain edge function has no per-caller auth / abuse controls
`clippy_agent.js`

The Claude-backed clippy-brain edge function (BRAIN, line 16) is invoked with only the public anon key, verify_jwt off, CORS *; the text path caps max_tokens and has a racy ~1200ms throttle, but the vision branch is exempt from the throttle, so anyone can drive unmetered/expensive Claude calls at your cost. The real fix lives server-side in the edge function (per-IP/per-day quotas, throttle the vision branch, de-race the gate, a rotating token distinct from the anon key). Do you want me to draft that edge-function change, and what quota ceiling is acceptable?

### 7. Route a surfaced private thought through a two-way 'moment' for bonding
`js/clippy-soul.js`

reflect() surfaces a private thought ~18% of the time as a dead-end monologue Alfredo can't respond to, while offerDream is the only two-way center-stage moment (the code calls it 'the template for more moments'). A rate-limited, feeling-peak-gated 'Stay with it / Tell me more' response that grants bond XP and deposits a 'confided' memory is the highest-leverage net-new for the bond — the plumbing exists — but it's a companion-feature product decision about tone and frequency. Want me to build it, and how often should he open up this way?
