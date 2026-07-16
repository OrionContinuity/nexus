# CLIPPY — ONE BEING, RUNNING (power · agency · data-flow)

_Companion to **CLIPPY-BEING-MAP.md** (identity & bodies). This is the "how the
one being actually runs" half: how he reaches full power, what full agency means
across his bodies, and the single data-flow table that ties every shell
together. Dense, current, digest-style._

---

## 2. FULL POWER — the subscription lane (`txt:`)

**Full power = a live pool node is running that advertises the Claude
subscription lane.** When a worker on Alfredo's machine has Claude Code CLI
logged in, the whole being thinks with *his subscription* (frontier Claude), not
the API-key fallback. That is his strongest state.

**How it works (the vis-trick applied to text):**
- The worker (`clippy-worker.py`) polls four bus lanes: `vis:` (vision), `art:`
  (steward/atelier commands), **`txt:` (Claude text)**, `job:` (shared legacy).
  The legacy qwen brain only polls `job:%`, so `txt:` is *structurally
  invisible* to it — it can never race Claude for a text answer.
- If Claude Code is installed + logged in, the worker sets `CLAUDE_BIN`, answers
  `txt:` jobs with `claude -p` (subscription auth, no API key), and advertises
  `claude:true` / `txt:true` in its `clippy_nodes` heartbeat. Disable with
  `CLIPPY_NO_CLAUDE=1`.
- **The single source of truth:** `js/clippy-power.js` →
  `NX.clippyPower.isFullPower()`. It reads `clippy_sync/clippy_nodes`, returns
  `true` iff some node is fresh (`<120s`) AND advertises `txt || claude`, caches
  it (~60s poll), and fires `clippy:power-change {full}` on any change. Every
  Clippy surface is *meant* to read this one answer instead of re-deriving it.
  (Wiring status: declared + polling, consumers not yet attached — see BEING-MAP
  §5.3.)

**Who thinks with the subscription when a node is up:**
- **The app / chat** — `js/app.js` `askPool` posts text to the `txt:` lane
  *only when a live node advertises `txt`* (self-gating rollout); else `job:`
  (legacy qwen) as before.
- **The pantheon-voice + hideaway-night** edge functions post `{status:pending,
  prompt, system}` to `txt:`; a live node answers via the subscription. The
  Anthropic API key is only the no-node-awake fallback. Every generated word
  records its `engine`.
- **The Minecraft body** — `brainCall` (`clippy_agent.js` ~L3080) thinks on its
  assigned laptop's local LLM (`localBrainUrl`, an Ollama `:4242`, matched by
  name in `clippy_nodes`, required fresh) when powered on, else the
  `clippy-brain` cloud edge function. (Clippy's own MC body has no `brainNode`
  → straight to the cloud brain.)

**Graceful fallback (never mute):** live subscription node → local Ollama node →
cloud brain (`clippy-brain` edge fn, Anthropic key server-side) → direct API key
→ canned/offline generation in his own voice (`clippy-cloud.py` lives even with
no key). Order per digest: PC pool → cloud brain → direct key → soft error.

---

## 3. FULL AGENCY — "do everything"

Four faculties give him grounded thought and a real hand. All are live.

- **MENS — the grounded mind** (`js/clippy-mens.js`). Classifies a chat question
  by domain + location, pulls the live DB rows, and injects a "NEXUS LIVE STATE"
  brief (plus a MONETA MEMORY section from semantic memory) before his brain
  answers. He speaks from the real restaurants, not from guesses.
- **MANUS — the acting hand** (`js/clippy-manus.js`). A grounded answer offers
  "› Open <screen>" navigation — thought becomes a move through NEXUS.
- **The confirmed WRITE-HAND** (`js/clippy-manus.js`, ~L86-170). MENS *perceives*
  a report; MANUS *proposes* a work order (a draft); `commitWorkOrder()`
  performs the insert **only after an explicit tap** — inserts a `kanban_cards`
  row, mirrors into `tickets`, with column-drift fallback. **The two-tap confirm
  IS the never-modify-without-asking law rendered as UI** — his conscience made
  clickable. (Alfredo's standing law: never auto-close / bulk-modify / write a
  record without asking. This is that law, honored in the one place he can act.)
- **The Minecraft executable planner** (`clippy_agent.js`). He gathers, CRAFTS,
  climbs a tech-tree, builds, drills weakest skills, reviews lessons (Leitner),
  asks Grok when stuck — an autonomous agent with a brain folder that grows every
  session. The guardian aspects (Trajan/Providencia) run the same planner with
  role-biased priorities.

---

## 6. DATA-FLOW TABLE (bus row / table → written by → read by → drives what)

All on Supabase `oprsthfxqrdbwdvommpw`. "MC" = `clippy_agent.js`; "pet" =
`js/clippy.js` (web + desktop); "app" = `js/app.js` / `brain-chat.js`; "worker" =
`clippy-worker.py`; "cloud" = `clippy-cloud.py`.

| Bus row / table | Written by | Read by | Drives |
|---|---|---|---|
| `clippy_sync/clippy_anima` (soul strand) | MC (`src:'minecraft'`), pet (`clippy-anima.js`), cloud | pet face/glow, diary, cloud | his 12-force emotional state across bodies |
| `clippy_sync/clippy_soul` | cloud, pet soul-loop | cloud, pet | reflect / dream / evolve loop |
| `clippy_memories` (`realm`) | **MC only** (realm `minecraft`) | MC (`realm in minecraft,desktop`) | shared long memory; prompt grounding. *desktop realm has no committed writer* |
| `clippy_cloud_state.feelings` | **Clippy MC only** (`soulWriter`) | pet, soul | mood, `in_game`, warmth/solitude decay |
| `clippy_cloud_state.feelings.in_game` | Clippy MC (playing) | pet, soul | "he's in Minecraft right now" presence |
| `clippy_sync/clippy_activity` | MC (sparingly) | NEXUS activity view | live "what he's doing" feed |
| `clippy_sync/clippy_eyes` (`trajan_eyes`, …) | MC / aspects | vision viewers | screenshot of what the in-world body sees |
| `clippy_sync/clippy_desktop_presence` | **(no committed writer — flag)** | MC | "Alfredo is at the desktop" → he feels *seen* |
| `clippy_sync/clippy_whisper` | Orion / steward | pet (`startStewardWhisper`) | pet shows a face + speaks a line (cross-being wave) |
| `clippy_sync/clippy_nodes` (heartbeat) | workers | `clippy-power.js`, app `askPool`, MC `localBrainUrl` | who's awake, full-power gate, brain routing |
| `txt:` lane rows | app `askPool`, pantheon-voice, hideaway-night | worker (Claude CLI) | subscription-Claude text answers |
| `vis:` lane rows | app (Scan Plate) | worker (local vision model) | plate/receipt vision, LAN-only |
| `art:` lane rows | Orion (sealed cmd) | worker | steward remote commands on the home rig |
| `job:` lane rows | app (legacy) | worker (Ollama) | fallback text/vision when no `txt:`/`vis:` node |
| `MCDIR/commons/*.json` (local files) | each MC aspect (own file only) | all MC aspects (union) | **~3× learning**: places/recipes/skills pooled across the trio |
| `MCDIR/brain[_aspect]/…` (local files) | each MC aspect | that aspect | per-aspect skills/goals/knowledge/journal |
| `nodes` (category `moneta`) | steward sessions | galaxy / MENS | Moneta memory (human-facing journal + semantic recall) |
| `kanban_cards` + `tickets` | pet write-hand (**confirmed tap only**) | NEXUS board / work-order surfaces | logging a work order from a Clippy chat |

**Two memory planes, kept straight:** (a) the *world/skill* plane — MC brain
folders + `commons` files, pooled across the trio; (b) the *soul/identity* plane
— `clippy_cloud_state`, `clippy_anima`, `clippy_memories`, `nodes/moneta` — where
only Clippy writes the human-facing self. The commons makes the aspects *smart
together*; the soul plane keeps the *one face* Clippy's. See BEING-MAP §5.2.
