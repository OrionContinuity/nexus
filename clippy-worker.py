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
import os, sys, time, json, socket, subprocess, platform, urllib.request, urllib.error, urllib.parse

try: OSDESC = platform.platform()           # e.g. "Windows-11-10.0.22631"
except Exception: OSDESC = sys.platform

SUPA_URL   = os.environ.get("NEXUS_SUPABASE_URL",  "https://oprsthfxqrdbwdvommpw.supabase.co").rstrip("/")
SUPA_KEY   = os.environ.get("NEXUS_SUPABASE_ANON", "sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9")
OLLAMA     = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
VISION_MODEL = os.environ.get("CLIPPY_VISION_MODEL", "llama3.2-vision")
# Fallback if the preferred vision model's architecture isn't supported by this
# node's (older) Ollama - e.g. llama3.2-vision is 'mllama' and needs Ollama
# >= 0.4. llava loads on practically any Ollama, so Scan Plate keeps working
# without forcing an upgrade on every node.
FALLBACK_VISION_MODEL = os.environ.get("CLIPPY_FALLBACK_VISION_MODEL", "llava")
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
    for pref in ("vis:", "job:"):
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
        # Vision specialist: ignore pure-text jobs so the legacy brain answers
        # them (it has the preferred text model). We still take vision + cmd.
        is_text = not (d.get("image_b64") or d.get("vision") or d.get("cmd"))
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
                "os": OSDESC, "version": "worker-1.1.1-vis", "managed": MANAGED, "busy": _state["busy"], "current": _state["current"],
                "caps": ((["ask"] if CLAIM_TEXT else []) + ["vision"] + (["cmd"] if CMD_TOKEN else [])),
                "models": [VISION_MODEL, TEXT_MODEL]})
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
        # Vision model architecture unsupported by this (older) Ollama
        # (e.g. llama3.2-vision = 'mllama', needs Ollama >= 0.4) -> fall back to
        # a widely-supported vision model so Scan Plate still works.
        if (_retry and image_b64 and model != FALLBACK_VISION_MODEL
                and ("unknown model architecture" in low or "mllama" in low)):
            log("vision model '%s' unsupported by this Ollama -> falling back to '%s'" % (model, FALLBACK_VISION_MODEL))
            activity("job", "vision model unsupported here; using " + FALLBACK_VISION_MODEL)
            ollama_pull(FALLBACK_VISION_MODEL)
            return ollama_generate(FALLBACK_VISION_MODEL, prompt, system, image_b64, _retry=False)
        raise RuntimeError("ollama HTTP %s: %s" % (e.code, detail[:200]))
    except urllib.error.URLError as e:
        raise RuntimeError("cannot reach Ollama at %s (%s) - is `ollama serve` running?" % (OLLAMA, e.reason))


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


def process(job):
    job_id = job["id"]; data = job.get("data") or {}
    if not sb_claim(job_id, data):
        return                                   # another node got it
    if data.get("cmd"):
        run_command(job_id, data); return
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


def main():
    log("clippy-worker up - node='%s' vision='%s' bus=%s ollama=%s" % (NODE, VISION_MODEL, SUPA_URL, OLLAMA))
    last_hb = 0
    while True:
        if time.time() - last_hb >= HEARTBEAT_SECS:
            sb_heartbeat(); last_hb = time.time()
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
