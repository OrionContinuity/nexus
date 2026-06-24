# NEXUS Render Farm — distributed model generation via Clippy

**Goal:** submit 3D-model prompts/images from NEXUS (or the phone, or *this Claude chat*) → dispatch to a
Clippy-equipped PC with a GPU (the home **RTX 3070**) → it generates the model locally → result comes back.
Multiple Clippy machines pool their GPUs; multiple jobs run in parallel.

> **The backbone already exists.** This is an *extension* of the Clippy hive, not a new system. Verified
> live 2026-06-24. See §"Proven" below.

---

## The fabric (4 parts, 3 already built)

| Part | What | Where | Status |
|---|---|---|---|
| **Bus** | Supabase `clippy_sync` table (`id / data / from_id / updated_at`). Rows: `clippy_nodes` (registry/heartbeat), `node:<HOST>` (resource telemetry), `job:*` (work queue). | `oprsthfxqrdbwdvommpw.supabase.co` | ✅ exists |
| **Worker** | **ClippyPC** on each machine — offline Ollama brain hosting `:4242` (`/ask /vision /act`), registers into `clippy_nodes` (`brain/clippy_brain.py:491 register_node`), LAN-reachable. | `Desktop\ClippyPC` | ✅ exists → **extend** |
| **Control** | **NEXUS** Clippy: provider switch already has `clippy-pool`; `NX.askPool()` (app.js:3735) enqueues a job + polls the bus; `clippyPoolNodes()` (app.js:3725) reads the registry. | `Desktop\NEXUS APP` | ✅ exists → **add module** |
| **Chat driver** | This Claude session reads/writes `clippy_sync` over Supabase REST (anon key) — see nodes, enqueue jobs, poll results, fan out N runs. | — | ✅ **proven** |

### Proven (live, this session)
- **Read hive from chat:** `GET /rest/v1/clippy_sync?id=eq.clippy_nodes` → returned the registered node.
- **Write+delete from chat:** upsert (HTTP 201) → read → delete (204). I can enqueue/clear jobs.
- **Resource telemetry in the hive:** `WarSiegeGame\monitor\node-agent.ps1 -Publish` pushed
  `{role,gpu,cuda,cpu_pct,gpu_pct,ram,vram,ts}` to `node:<HOST>`; read back from chat. Identity
  auto-detected (NVIDIA RTX→`main`/cuda, AMD APU→`laptop`).
- **Local GUI:** `WarSiegeGame\monitor\dashboard.ps1` (WinForms) shows every node LIVE/STALE/OFFLINE + bars.

---

## To build (the 4 new pieces)

### 1. Worker render capability — `ClippyPC` (runs on the 3070)
- **`brain/render_worker.py`** (new) — a job-poller: loop `GET clippy_sync?id=like.job:*` for
  `data.kind=='render3d' && data.status=='pending'`; claim (`status='claimed', node=<id>`); run the local
  3D-gen; upload the `.glb` to Supabase Storage; write back `status='done', result={glb_url, preview_url}`.
  Mirror the existing text poller pattern (`Downloads\nexus-main\tools\clippy-poller\clippy_poller.py`).
- **`local-3d-gen`** (new skill + script) — the GPU model generator on the 3070. Per the deep-research:
  TripoSR (~6 GB, MIT, seconds) for fast base meshes; TripoSG / Hunyuan3D-2 (≥8 GB, tuned) for higher
  fidelity + PBR. Input = prompt or reference image; output = GLB (+ optional vertex-colour bake for the
  no-upload EditableMesh inject path).
- **GPU telemetry in the registry** — add `{gpu,vram,cpu,role,queue}` to `register_node` (clippy_brain.py:497)
  so `clippy_nodes` itself carries resources (today they live in the parallel `node:<HOST>` rows the agent
  publishes; unify later). Until then, ship `node-agent.ps1 -Publish` alongside ClippyPC on every machine.

### 2. NEXUS control module — `NEXUS APP\js\render-farm.js` (new, follows the module pattern)
- Register `NX.modules['render-farm']` (pattern: app.js:1685 moduleMap + a `#renderFarmView` + a nav tab).
- **Submit:** write a `job:` row with `data.kind='render3d'` (reuse `askPool`'s shape, add `kind/params`).
- **Node grid:** read `clippy_sync?id=like.node:*` + `clippy_nodes` → cards w/ LIVE dot + GPU/VRAM bars
  (the web twin of the WinForms dashboard — "see if connected" from anywhere/phone).
- **Results:** poll the job row / subscribe via `NXRM.realtime` (core.js:569); show GLB preview + download;
  `NX.clippy.bubble('model ready')`.

### 3. Chat driver — `WarSiegeGame\monitor\farm.sh` (new, for this Claude session)
- `farm nodes` → list live nodes + load. `farm render "<prompt>" [--image f]` → enqueue + poll + print GLB
  url. `farm batch prompts.txt` → enqueue many (multiple runs); the worker pool drains them.
- Primitives already proven (curl upsert/select/delete with the anon key).

### 4. Keep-alive — home PC stays a worker
- 3070 boots → ClippyPC autostarts (brain + render_worker + `node-agent -Publish`) → registers in the hive.
- From anywhere (NEXUS, phone, this chat) the node shows online; jobs route to it. Closing the laptop/phone
  doesn't matter — the bus is the cloud, the GPU is at home.

---

## Job schema (extends the existing `job:` row)
```jsonc
// clippy_sync row  id = "job:<uuid>"
{ "kind": "render3d", "status": "pending",          // pending → claimed → done | error
  "prompt": "a mossy stone lantern, stylized low-poly",
  "image_b64": null,                                  // OR a reference image
  "engine": "triposr",                                // triposr | triposg | hunyuan3d
  "params": { "polycount": 6000, "texture": true },
  "from_id": "claude-chat",                            // or "nexus"
  "node": null, "result": null, "ts": 0 }
```

## Security / notes
- The anon key is the **public** NEXUS_CONFIG value (non-secret; RLS-gated). Fine for read + job rows.
- ClippyPC's `:4242` binds `0.0.0.0` and `/act` drives the mouse/keyboard — **set `api_token` in
  `brain/clippy.cfg.json`** before exposing beyond the home LAN. The render worker only needs the bus +
  the GPU, not `/act`.
- The GPU worker must validate `kind=='render3d'` and ignore anything else; never `exec` arbitrary strings.
- Original-IP guardrail stays: prompts/images are the user's own; outputs are kept (no marketplace upload).
