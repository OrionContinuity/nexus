#!/usr/bin/env python3
"""
clippy-worker.py - Clippy pool job-poller. Makes THIS machine a Clippy node that
answers NEXUS jobs - including VISION (Scan Plate) jobs - using a local Ollama
model. No cloud: the image never leaves the LAN; a local vision model reads it
and the answer is written back over the Supabase bus.

How it fits the app (js/app.js askPool / clippyPoolNodes):
  - NEXUS writes a row to public.clippy_sync:
        id   = "job:<uuid>"
        data = {status:"pending", prompt, system, image_b64, vision, model, ts}
  - This worker polls for pending job rows, claims one, runs it on local Ollama,
    and PATCHes the row to {status:"done", result:"..."} (or {"status":"error"}).
  - It also keeps the hive registry row id="clippy_nodes" fresh so the node
    shows ONLINE in NEXUS (Admin -> AI provider -> Clippy pool).

Only the Python standard library is used, so the sole dependency is Ollama with
a vision model. The worker self-pulls the model on first use if it is missing,
so every Clippy instance can produce vision answers out of the box.

  python clippy-worker.py
  CLIPPY_VISION_MODEL=moondream python clippy-worker.py     # smaller model
It can also run commands (PowerShell/shell) when CLIPPY_CMD_TOKEN is set and a
cmd job carries the matching token — output streams back as a live `tail`.
Every job updates a `clippy_activity` feed + the node's busy/current state so
NEXUS can SHOW what the node is doing.

Env overrides: NEXUS_SUPABASE_URL, NEXUS_SUPABASE_ANON, OLLAMA_URL,
               CLIPPY_VISION_MODEL, CLIPPY_TEXT_MODEL, CLIPPY_NODE_NAME,
               CLIPPY_CMD_TOKEN (enable command jobs; empty = disabled)
"""
import os, sys, time, json, socket, subprocess, platform, threading, base64, tempfile, shutil, glob, urllib.request, urllib.error, urllib.parse

try: OSDESC = platform.platform()           # e.g. "Windows-11-10.0.22631"
except Exception: OSDESC = sys.platform


def _total_ram_gb():
    """Total physical RAM in GB (Windows via ctypes; 0 if unknown). Pure stdlib."""
    try:
        import ctypes
        class _MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = _MS(); m.dwLength = ctypes.sizeof(_MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return round(m.ullTotalPhys / (1024.0 ** 3), 1)
    except Exception:
        return 0.0


def _has_nvidia():
    """True if an NVIDIA GPU is present (nvidia-smi runs). NVIDIA/CUDA is what
    most accelerates Ollama, so it's the accelerator that earns the big score."""
    try:
        subprocess.run(["nvidia-smi"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=6)
        return True
    except Exception:
        return False


RAM_GB = _total_ram_gb()
ACCEL  = "nvidia" if _has_nvidia() else "cpu"
# Vision strength score the app uses to route a vision job to the STRONGEST
# online node: a CUDA GPU dominates; among similar nodes, more RAM wins.
VSCORE = int(RAM_GB) + (100 if ACCEL == "nvidia" else 0)

SUPA_URL   = os.environ.get("NEXUS_SUPABASE_URL",  "https://oprsthfxqrdbwdvommpw.supabase.co").rstrip("/")
SUPA_KEY   = os.environ.get("NEXUS_SUPABASE_ANON", "sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9")
OLLAMA     = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
# Default to llava: it's reliable across Ollama builds and light enough for a
# RAM-constrained laptop. (llama3.2-vision = 'mllama' fails to load on some
# current Ollama builds, and heavier models like minicpm-v thrash a low-RAM
# box.) Override per node with CLIPPY_VISION_MODEL.
VISION_MODEL = os.environ.get("CLIPPY_VISION_MODEL", "llava")
# Last-resort fallback if the chosen vision model can't load (e.g. an 'mllama'
# arch error, or out-of-memory). moondream is tiny, so it loads almost anywhere.
FALLBACK_VISION_MODEL = os.environ.get("CLIPPY_FALLBACK_VISION_MODEL", "moondream")
# The vision model actually serving answers (may differ from VISION_MODEL if we
# had to fall back). Surfaced in the heartbeat so the UI shows what's really used.
ACTIVE_VISION = VISION_MODEL
TEXT_MODEL   = os.environ.get("CLIPPY_TEXT_MODEL", "llama3.1")
NODE       = os.environ.get("CLIPPY_NODE_NAME", socket.gethostname())
# Command execution is OFF unless a token is set. The bus is writable with the
# public anon key, so an unguarded "run this command" channel would be remote
# code execution for anyone. Set CLIPPY_CMD_TOKEN on the node and include the
# same token in a cmd job to enable it. Empty = command jobs are refused.
CMD_TOKEN  = os.environ.get("CLIPPY_CMD_TOKEN", "")
# Set by clippy-daemon.ps1 when it runs the worker as a supervised "slave"
# (Clippy is the master). Surfaced in the heartbeat so the Tools UI can show it.
MANAGED    = os.environ.get("CLIPPY_MANAGED", "")

_state = {"busy": False, "current": ""}     # what this node is doing right now

REST = SUPA_URL + "/rest/v1/clippy_sync"
SB_HEADERS = {"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json"}

POLL_SECS = 1                     # vision rides its own 'vis:' lane (no race); 1s keeps latency low + request volume modest
HEARTBEAT_SECS = 30
JOB_MAX_AGE_MS = 120_000          # ignore jobs older than this (NEXUS has given up)
# Strongest-node routing: the app tags a vision job with the strongest online
# node in 'prefer'. Other nodes hold off this long so the preferred node claims
# first; after the grace, anyone may take it (failover if it's busy/offline).
PREFER_GRACE_MS = 4000
# Coexist with the legacy v2.4.4 poller (qwen3:8b) instead of fighting it.
# Vision jobs ride a separate 'vis:' id prefix that the legacy poller never
# queries (it polls 'job:%'), so vision can't be raced/clobbered. On the shared
# 'job:' lane this worker takes only cmd jobs and leaves TEXT to the legacy
# brain. Set CLIPPY_CLAIM_TEXT=1 to also answer text (e.g. no legacy poller).
CLAIM_TEXT = os.environ.get("CLIPPY_CLAIM_TEXT", "0") == "1"
_pulled = set()                   # models we've already ensured locally this run


def log(msg):
    print(time.strftime("%H:%M:%S") + "  " + msg, flush=True)


def _http(method, url, headers=None, body=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8", "replace")
        return r.status, raw


# ─── Supabase bus ────────────────────────────────────────────────────────────
def sb_get_pending():
    # Poll our vision lane ('vis:') AND the shared 'job:' lane (for cmd jobs).
    # Vision rides 'vis:' so the legacy v2.4.4 poller never sees it -> no race.
    # Two plain GETs with the proven `id=like.X:*` syntax rather than one
    # or=(...) logical filter, which PostgREST rejects in some forms (a bad
    # filter returns [] silently and the node goes blind to all jobs).
    rows = []
    for pref in ("vis:", "art:", "job:"):     # vision, atelier (Blender renders), shared
        url = REST + "?id=like." + pref + "*&select=id,data"
        try:
            _, raw = _http("GET", url, SB_HEADERS, timeout=20)
            rows += json.loads(raw or "[]")
        except Exception as e:
            log("bus read failed (%s): %s" % (pref, e))
    now = time.time() * 1000
    out = []
    for row in rows:
        d = row.get("data") or {}
        if d.get("status") != "pending":
            continue
        if now - (d.get("ts") or 0) > JOB_MAX_AGE_MS:
            continue
        # Strongest-node routing: if this job prefers ANOTHER node, hold off until
        # the grace passes (then take it - failover if the preferred node didn't).
        pref = d.get("prefer")
        if pref and pref != NODE and (now - (d.get("prefer_ms") or d.get("ts") or 0)) < PREFER_GRACE_MS:
            continue
        # Vision specialist: ignore pure-text jobs so the legacy brain answers
        # them (it has the preferred text model). We still take vision, cmd, and
        # atelier renders.
        is_text = not (d.get("image_b64") or d.get("vision") or d.get("cmd") or d.get("render"))
        if is_text and not CLAIM_TEXT:
            continue
        out.append(row)
    return out


def sb_claim(job_id, data):
    """Atomically flip pending->running so only one node processes the job."""
    claimed = dict(data); claimed["status"] = "running"; claimed["node"] = NODE
    url = REST + "?id=eq." + urllib.parse.quote(job_id) + "&data->>status=eq.pending"
    h = dict(SB_HEADERS); h["Prefer"] = "return=representation"
    try:
        _, raw = _http("PATCH", url, h, {"data": claimed}, timeout=20)
        return bool(json.loads(raw or "[]"))
    except Exception as e:
        log("claim failed for %s: %s" % (job_id, e)); return False


def sb_finish(job_id, patch):
    url = REST + "?id=eq." + urllib.parse.quote(job_id)
    h = dict(SB_HEADERS); h["Prefer"] = "return=minimal"
    try:
        _http("PATCH", url, h, {"data": patch}, timeout=20)
    except Exception as e:
        log("finish write failed for %s: %s" % (job_id, e))


def sb_heartbeat():
    """Keep id='clippy_nodes' fresh so NEXUS sees this node online (ts in sec)."""
    now = int(time.time())
    arr = []
    try:
        _, raw = _http("GET", REST + "?id=eq.clippy_nodes&select=data", SB_HEADERS, timeout=15)
        rows = json.loads(raw or "[]")
        cur = (rows[0].get("data") if rows else None) or []
        if isinstance(cur, list):
            arr = [n for n in cur if isinstance(n, dict) and n.get("name") != NODE and now - (n.get("ts") or 0) < 120]
    except Exception:
        pass
    arr.append({"name": NODE, "ts": now, "vision": True, "cmd": bool(CMD_TOKEN),
                "os": OSDESC, "version": "worker-1.5", "managed": MANAGED, "busy": _state["busy"], "current": _state["current"],
                "caps": ((["ask"] if CLAIM_TEXT else []) + ["vision"] + (["cmd"] if CMD_TOKEN else []) + (["gen"] if GENERATE else []) + (["art"] if HAS_BLENDER else [])),
                "vision_model": ACTIVE_VISION, "models": [VISION_MODEL, TEXT_MODEL],
                "ram_gb": RAM_GB, "accel": ACCEL, "vscore": VSCORE})
    h = dict(SB_HEADERS); h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    try:
        _http("POST", REST, h, {"id": "clippy_nodes", "data": arr, "from_id": NODE}, timeout=15)
    except Exception as e:
        log("heartbeat failed: %s" % e)


def activity(kind, msg):
    """Append to the rolling id='clippy_activity' feed so NEXUS can show a
    human-readable trail of what this node has been doing (capped, best-effort)."""
    entry = {"ts": int(time.time() * 1000), "node": NODE, "kind": kind, "msg": msg}
    try:
        _, raw = _http("GET", REST + "?id=eq.clippy_activity&select=data", SB_HEADERS, timeout=10)
        rows = json.loads(raw or "[]")
        cur = (rows[0].get("data") if rows else None) or []
        if not isinstance(cur, list):
            cur = []
    except Exception:
        cur = []
    cur = (cur + [entry])[-30:]
    h = dict(SB_HEADERS); h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    try:
        _http("POST", REST, h, {"id": "clippy_activity", "data": cur, "from_id": NODE}, timeout=10)
    except Exception:
        pass


def set_state(busy, current=""):
    _state["busy"] = busy
    _state["current"] = current
    try: sb_heartbeat()      # push the change immediately so the UI updates promptly
    except Exception: pass


# ─── Ollama ──────────────────────────────────────────────────────────────────
def ollama_pull(model):
    if model in _pulled:
        return
    log("pulling model '%s' (first use) ..." % model)
    try:
        _http("POST", OLLAMA + "/api/pull", {"Content-Type": "application/json"},
              {"name": model, "stream": False}, timeout=3600)
        _pulled.add(model)
        log("model '%s' ready" % model)
    except Exception as e:
        log("pull '%s' failed: %s" % (model, e))


def ollama_generate(model, prompt, system=None, image_b64=None, _retry=True):
    body = {"model": model, "prompt": prompt or "", "stream": False}
    if system:
        body["system"] = system
    if image_b64:
        body["images"] = [image_b64]            # Ollama wants raw base64 (no data: prefix)
    try:
        _, raw = _http("POST", OLLAMA + "/api/generate", {"Content-Type": "application/json"}, body, timeout=300)
        if image_b64:
            globals()["ACTIVE_VISION"] = model     # remember the vision model that actually worked
        return (json.loads(raw).get("response") or "").strip()
    except urllib.error.HTTPError as e:
        detail = ""
        try: detail = e.read().decode("utf-8", "replace")
        except Exception: pass
        low = detail.lower()
        # Model not installed yet -> pull it once, then retry.
        if _retry and ("not found" in low or e.code == 404):
            ollama_pull(model)
            return ollama_generate(model, prompt, system, image_b64, _retry=False)
        # Vision model can't load on this node - unsupported arch (e.g.
        # llama3.2-vision = 'mllama') or out-of-memory on a low-RAM box -> fall
        # back to the tiny model so Scan Plate still works.
        if (_retry and image_b64 and model != FALLBACK_VISION_MODEL
                and ("unknown model architecture" in low or "mllama" in low
                     or "out of memory" in low or "cannot allocate" in low
                     or "failed to load" in low or "insufficient memory" in low)):
            log("vision model '%s' can't load here -> falling back to '%s'" % (model, FALLBACK_VISION_MODEL))
            activity("job", "vision model unavailable here; using " + FALLBACK_VISION_MODEL)
            ollama_pull(FALLBACK_VISION_MODEL)
            return ollama_generate(FALLBACK_VISION_MODEL, prompt, system, image_b64, _retry=False)
        raise RuntimeError("ollama HTTP %s: %s" % (e.code, detail[:200]))
    except urllib.error.URLError as e:
        raise RuntimeError("cannot reach Ollama at %s (%s) - is `ollama serve` running?" % (OLLAMA, e.reason))


# ─── Self-written dialog (Clippy creates his own lines) ──────────────────────
# Clippy's canonical character lives in clippy-character.json. When a local LLM
# is available, he WRITES NEW lines in his own voice (his brain persona + the
# scripted corpus as a style seed) and accumulates them in the shared bus row
# 'clippy_learned' so his repertoire grows across runs (continuity). Strictly
# additive: if anything fails, the app still falls back to clippy-dialog.json.
# ON by default but gentle - only when idle, only with a text model already
# present (never auto-pulls a big model).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATE   = os.environ.get("CLIPPY_GENERATE", "1") == "1"
GEN_EVERY_SECS = int(os.environ.get("CLIPPY_GEN_EVERY", "3600"))
GEN_MODEL_PREF = [m for m in [os.environ.get("CLIPPY_GEN_MODEL", ""), TEXT_MODEL,
                              "qwen2.5:7b", "qwen3:8b", "llama3.1"] if m]


def _load_json(name):
    try:
        with open(os.path.join(SCRIPT_DIR, name), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log("character: could not load %s (%s)" % (name, e)); return None


CHAR   = _load_json("clippy-character.json") or {}
DIALOG = _load_json("clippy-dialog.json") or {}


def _available_models():
    try:
        _, raw = _http("GET", OLLAMA + "/api/tags", {"Content-Type": "application/json"}, timeout=10)
        return [m.get("name", "") for m in (json.loads(raw or "{}").get("models") or [])]
    except Exception:
        return []


def _gen_model():
    """Pick a text model that is ALREADY present (never auto-pull a big one)."""
    have = _available_models()
    base = {m.split(":")[0]: m for m in have}     # match 'qwen2.5' -> 'qwen2.5:7b'
    for pref in GEN_MODEL_PREF:
        if pref in have:
            return pref
        if pref.split(":")[0] in base:
            return base[pref.split(":")[0]]
    return None


def _gen_system():
    b = (CHAR.get("brain") or {}).get("promptLines") or []
    note = (CHAR.get("generation") or {}).get("system") or ""
    return "\n".join(b) + (("\n\n" + note) if note else "")


def generate_lines(category, n=None):
    """Write fresh in-character one-liners for a category using a local text model."""
    gen = CHAR.get("generation") or {}
    if not gen.get("enabled"):
        return []
    model = _gen_model()
    if not model:
        return []                                 # no present text model -> skip (no pull)
    params = gen.get("params") or {}
    n = n or params.get("linesPerRequest", 8)
    maxc = params.get("maxLineChars", 120)
    desc = (gen.get("categoryDescriptions") or {}).get(category) or category.replace("_", " ")
    sample = (DIALOG.get(category) or [])[:6]
    tmpl = gen.get("promptTemplate") or "Write {n} new one-liners for: {categoryDescription}. Examples: {examples}"
    prompt = (tmpl.replace("{n}", str(n)).replace("{categoryDescription}", desc)
                  .replace("{mood}", "in character").replace("{maxLineChars}", str(maxc))
                  .replace("{examples}", " / ".join(sample)))
    try:
        out = ollama_generate(model, prompt, _gen_system())
    except Exception as e:
        log("dialog gen failed (%s): %s" % (category, e)); return []
    lines = []
    for ln in (out or "").splitlines():
        s = ln.strip().lstrip("-*0123456789.) ").strip().strip('"').strip()
        if s and 2 < len(s) <= maxc + 40:
            lines.append(s)
    return lines[:n]


def store_learned(category, lines):
    """Accumulate generated lines into bus row id='clippy_learned' (continuity)."""
    if not lines:
        return
    cap = ((CHAR.get("continuity") or {}).get("cap") or {}).get("perCategory", 200)
    try:
        _, raw = _http("GET", REST + "?id=eq.clippy_learned&select=data", SB_HEADERS, timeout=15)
        rows = json.loads(raw or "[]")
        cur = (rows[0].get("data") if rows else None) or {}
        if not isinstance(cur, dict):
            cur = {}
    except Exception:
        cur = {}
    have = cur.get(category) or []
    seen = set(have); added = 0
    for l in lines:
        if l not in seen:
            have.append(l); seen.add(l); added += 1
    cur[category] = have[-cap:]
    h = dict(SB_HEADERS); h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    try:
        _http("POST", REST, h, {"id": "clippy_learned", "data": cur, "from_id": NODE}, timeout=15)
        activity("dialog", "wrote %d new '%s' line(s)" % (added, category))
        log("dialog: +%d '%s' lines (learned)" % (added, category))
    except Exception as e:
        log("store_learned failed: %s" % e)


def _generate_loop():
    cats = list((CHAR.get("generation") or {}).get("categoryDescriptions", {}).keys()) or ["whimsical_idle"]
    i = 0; first = True
    while True:
        time.sleep(90 if first else GEN_EVERY_SECS); first = False   # write a little soon after waking, then hourly
        if _state["busy"]:
            continue                              # never compete with a real job
        cat = cats[i % len(cats)]; i += 1
        set_state(True, "writing new '%s' lines" % cat)
        try:
            store_learned(cat, generate_lines(cat))
        except Exception as e:
            log("generate loop error: %s" % e)
        finally:
            set_state(False)


# ─── Job processing ──────────────────────────────────────────────────────────
def run_command(job_id, data):
    """Execute a shell/PowerShell command and stream its output back as a live
    `tail` so NEXUS shows progress. Token-gated (CLIPPY_CMD_TOKEN) — refuses
    otherwise, since the bus is writable with the public anon key."""
    now_ms = lambda: int(time.time() * 1000)
    if not CMD_TOKEN:
        sb_finish(job_id, {"status": "error", "error": "command exec disabled on this node (set CLIPPY_CMD_TOKEN)", "node": NODE, "ts": now_ms()}); return
    if data.get("token") != CMD_TOKEN:
        sb_finish(job_id, {"status": "error", "error": "bad or missing command token", "node": NODE, "ts": now_ms()}); return
    cmd = (data.get("cmd") or "").strip()
    if not cmd:
        sb_finish(job_id, {"status": "error", "error": "empty command", "node": NODE, "ts": now_ms()}); return
    shell = (data.get("shell") or ("powershell" if os.name == "nt" else "bash")).lower()
    args = (["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd]
            if shell == "powershell" else ["/bin/sh", "-lc", cmd])
    set_state(True, "cmd: " + cmd[:60]); activity("cmd", "run: " + cmd[:80])
    log("cmd %s -> %s" % (job_id, cmd[:80]))
    buf, last = [], 0
    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    except Exception as e:
        sb_finish(job_id, {"status": "error", "error": "spawn failed: %s" % e, "node": NODE, "ts": now_ms()})
        set_state(False); return
    for line in proc.stdout:
        buf.append(line)
        if time.time() - last > 2:                       # stream a tail every ~2s
            sb_finish(job_id, {"status": "running", "tail": ("".join(buf))[-1200:], "node": NODE, "ts": now_ms()})
            last = time.time()
    code = proc.wait()
    out = "".join(buf)
    patch = {"status": "done" if code == 0 else "error", "result": out[-4000:], "exit_code": code, "node": NODE, "ts": now_ms()}
    if code != 0:
        patch["error"] = "exit %d" % code
    sb_finish(job_id, patch)
    activity("cmd", ("ok: " if code == 0 else "fail %d: " % code) + cmd[:60])
    log("cmd %s exit %d (%d chars)" % (job_id, code, len(out)))
    set_state(False)


# ─── Atelier: turn an idea into a Blender render ─────────────────────────────
def _find_blender():
    p = shutil.which("blender")
    if p:
        return p
    for base in [os.environ.get("ProgramFiles", ""), os.environ.get("ProgramW6432", ""),
                 os.environ.get("LOCALAPPDATA", "")]:
        if not base:
            continue
        for exe in glob.glob(os.path.join(base, "**", "blender.exe"), recursive=True):
            return exe
    return None


HAS_BLENDER = bool(_find_blender())

# LLM-written scene code runs inside Blender. It's our own model with a tight
# prompt, but the PROMPT is user-supplied, so reject anything that isn't plain
# bpy scene-building before we run it.
_RENDER_FORBIDDEN = ("import ", "__", "os.", "sys.", "subprocess", "open(", "eval(",
                     "exec(", "compile(", "system(", "popen", "shutil", "socket",
                     "urllib", "requests", "getattr", "setattr", "globals(", "locals(")

_RENDER_HARNESS = '''OUTPATH = r"%s"
import bpy
try: bpy.ops.wm.read_factory_settings(use_empty=True)
except Exception: pass
scene = bpy.context.scene
def _mat(name, rgba):
    m = bpy.data.materials.new(name); m.use_nodes = True
    try: m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = rgba
    except Exception: pass
    return m
# --- generated scene ---
%s
# --- end generated scene ---
if not any(o.type == 'CAMERA' for o in scene.objects):
    cd = bpy.data.cameras.new("Cam"); co = bpy.data.objects.new("Cam", cd)
    scene.collection.objects.link(co); co.location = (7, -7, 5); co.rotation_euler = (1.05, 0, 0.785)
scene.camera = next((o for o in scene.objects if o.type == 'CAMERA'), None)
if not any(o.type == 'LIGHT' for o in scene.objects):
    ld = bpy.data.lights.new("Sun", 'SUN'); ld.energy = 4.0
    lo = bpy.data.objects.new("Sun", ld); scene.collection.objects.link(lo); lo.location = (5, -3, 9)
try:
    w = scene.world or bpy.data.worlds.new("W"); scene.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.09, 1)
except Exception: pass
try: scene.render.engine = 'CYCLES'; scene.cycles.samples = 24
except Exception: pass
scene.render.resolution_x = 512; scene.render.resolution_y = 512
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUTPATH
bpy.ops.render.render(write_still=True)
'''


def _render_scene_code(idea):
    """Ask the local model (in artist mode) for bpy scene-building code."""
    model = _gen_model()
    if not model:
        return None
    system = ("You write Python for Blender's bpy module to build a small 3D scene. "
              "Output ONLY Python code - no markdown, no comments, no explanation. "
              "Use ONLY bpy and the helper _mat(name, (r,g,b,1)) for colored materials. "
              "Do NOT import anything; do NOT touch files, os, network. Build the idea from simple "
              "primitives (bpy.ops.mesh.primitive_cube_add/uv_sphere_add/cylinder_add/cone_add/"
              "plane_add) with location=, scale=, rotation=. Assign colors via "
              "obj.data.materials.append(_mat('c',(r,g,b,1))). Do NOT add cameras, lights, world, "
              "render settings, or call render. Keep it under 40 lines.")
    try:
        code = ollama_generate(model, "Build a small scene that evokes: " + str(idea)[:300], system)
    except Exception as e:
        log("render code gen failed: %s" % e); return None
    code = (code or "").replace("```python", "").replace("```", "").strip()
    low = code.lower()
    if not code or any(tok in low for tok in _RENDER_FORBIDDEN):
        log("render code rejected (unsafe/empty) - using fallback scene")
        return None
    return code


_RENDER_FALLBACK = ("bpy.ops.mesh.primitive_uv_sphere_add(location=(0,0,1))\n"
                    "bpy.context.active_object.data.materials.append(_mat('a',(0.85,0.7,0.3,1)))\n"
                    "bpy.ops.mesh.primitive_plane_add(size=20)\n")


def run_render(job_id, data):
    """Render an idea with Blender (headless Cycles) and return the PNG."""
    now_ms = lambda: int(time.time() * 1000)
    idea = (data.get("render") or data.get("prompt") or "a small abstract sculpture").strip()
    blender = _find_blender()
    if not blender:
        sb_finish(job_id, {"status": "error", "error": "Blender isn't installed on this node yet.", "node": NODE, "ts": now_ms()})
        return
    set_state(True, "sculpting: " + idea[:48]); activity("art", "sculpting: " + idea[:60])
    log("render %s -> %s" % (job_id, idea[:80]))
    body = _render_scene_code(idea) or _RENDER_FALLBACK
    work = tempfile.mkdtemp(prefix="clippy_art_")
    out_png = os.path.join(work, "out.png")
    script = os.path.join(work, "scene.py")
    try:
        with open(script, "w", encoding="utf-8") as f:
            f.write(_RENDER_HARNESS % (out_png.replace("\\", "\\\\"), body))
        t0 = time.time()
        proc = subprocess.Popen([blender, "--background", "--factory-startup", "--python", script],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        last = 0
        for line in proc.stdout:
            if time.time() - last > 3:
                sb_finish(job_id, {"status": "running", "tail": line.strip()[-160:], "node": NODE, "ts": now_ms()})
                last = time.time()
        proc.wait()
        if os.path.exists(out_png):
            with open(out_png, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            sb_finish(job_id, {"status": "done", "image_b64": b64, "mime": "image/png",
                               "result": "sculpted: " + idea[:80], "node": NODE, "ts": now_ms()})
            activity("art", "sculpted '%s' in %ds" % (idea[:40], int(time.time() - t0)))
            log("render %s done (%d KB)" % (job_id, len(b64) // 1024))
        else:
            sb_finish(job_id, {"status": "error", "error": "Blender produced no image (the scene may have failed).", "node": NODE, "ts": now_ms()})
            log("render %s produced no image" % job_id)
    except Exception as e:
        sb_finish(job_id, {"status": "error", "error": "render failed: %s" % e, "node": NODE, "ts": now_ms()})
        log("render %s error: %s" % (job_id, e))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        set_state(False)


def process(job):
    job_id = job["id"]; data = job.get("data") or {}
    if not sb_claim(job_id, data):
        return                                   # another node got it
    if data.get("cmd"):
        run_command(job_id, data); return
    if data.get("render") or job_id.startswith("art:"):
        run_render(job_id, data); return
    is_vision = job_id.startswith("vis:") or bool(data.get("image_b64")) or bool(data.get("vision"))
    model = VISION_MODEL if is_vision else (data.get("model") or TEXT_MODEL)
    kind = "vision" if is_vision else "text"
    set_state(True, kind + " job"); activity("job", kind + " job claimed")
    log("job %s -> %s (%s)" % (job_id, model, kind))
    t0 = time.time()
    try:
        answer = ollama_generate(model, data.get("prompt"), data.get("system"), data.get("image_b64"))
        sb_finish(job_id, {"status": "done", "result": answer, "node": NODE, "ts": int(time.time() * 1000)})
        activity("job", "%s done in %ds" % (kind, int(time.time() - t0)))
        log("job %s done (%d chars)" % (job_id, len(answer)))
    except Exception as e:
        sb_finish(job_id, {"status": "error", "error": str(e), "node": NODE, "ts": int(time.time() * 1000)})
        activity("job", "error: " + str(e)[:80])
        log("job %s error: %s" % (job_id, e))
    finally:
        set_state(False)


def warmup():
    """Warm the vision model on startup so the first real Scan Plate is fast,
    and so the arch-fallback (to llava on older Ollama) resolves now rather than
    on a user-facing job. Best-effort; a failure here never stops the worker."""
    tiny = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
            "+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC")   # 1x1 png
    try:
        set_state(True, "warming up vision (%s)" % VISION_MODEL)
        ollama_generate(VISION_MODEL, "Reply with: ok", None, tiny)
        log("vision model warm -> %s" % ACTIVE_VISION)
        activity("node", "vision ready (%s)" % ACTIVE_VISION)
    except Exception as e:
        log("warmup skipped: %s" % e)
    finally:
        set_state(False)


def _heartbeat_loop():
    """Heartbeat on its OWN thread so the node stays ONLINE even while the main
    loop is busy in a long vision inference or a long command (those can take
    minutes on a slow box). Without this, a single slow job makes the node drop
    off the registry."""
    while True:
        try: sb_heartbeat()
        except Exception: pass
        time.sleep(HEARTBEAT_SECS)


def main():
    log("clippy-worker up - node='%s' vision='%s' bus=%s ollama=%s" % (NODE, VISION_MODEL, SUPA_URL, OLLAMA))
    sb_heartbeat()      # register immediately so the node shows online without waiting a cycle
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    warmup()
    if GENERATE:
        threading.Thread(target=_generate_loop, daemon=True).start()
        log("self-dialog generation ON (every %ds, idle-only, present model only)" % GEN_EVERY_SECS)
    while True:
        try:
            for job in sb_get_pending():
                process(job)
        except Exception as e:
            log("loop error: %s" % e)
        time.sleep(POLL_SECS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped.")
        sys.exit(0)
