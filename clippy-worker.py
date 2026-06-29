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
Env overrides: NEXUS_SUPABASE_URL, NEXUS_SUPABASE_ANON, OLLAMA_URL,
               CLIPPY_VISION_MODEL, CLIPPY_TEXT_MODEL, CLIPPY_NODE_NAME
"""
import os, sys, time, json, socket, urllib.request, urllib.error, urllib.parse

SUPA_URL   = os.environ.get("NEXUS_SUPABASE_URL",  "https://oprsthfxqrdbwdvommpw.supabase.co").rstrip("/")
SUPA_KEY   = os.environ.get("NEXUS_SUPABASE_ANON", "sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9")
OLLAMA     = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
VISION_MODEL = os.environ.get("CLIPPY_VISION_MODEL", "llama3.2-vision")
TEXT_MODEL   = os.environ.get("CLIPPY_TEXT_MODEL", "llama3.1")
NODE       = os.environ.get("CLIPPY_NODE_NAME", socket.gethostname())

REST = SUPA_URL + "/rest/v1/clippy_sync"
SB_HEADERS = {"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json"}

POLL_SECS = 2
HEARTBEAT_SECS = 30
JOB_MAX_AGE_MS = 120_000          # ignore jobs older than this (NEXUS has given up)
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
    url = REST + "?id=like.job:*&select=id,data"
    try:
        _, raw = _http("GET", url, SB_HEADERS, timeout=20)
        rows = json.loads(raw or "[]")
    except Exception as e:
        log("bus read failed: %s" % e); return []
    now = time.time() * 1000
    out = []
    for row in rows:
        d = row.get("data") or {}
        if d.get("status") != "pending":
            continue
        if now - (d.get("ts") or 0) > JOB_MAX_AGE_MS:
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
    arr.append({"name": NODE, "ts": now, "vision": True, "models": [VISION_MODEL, TEXT_MODEL]})
    h = dict(SB_HEADERS); h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    try:
        _http("POST", REST, h, {"id": "clippy_nodes", "data": arr, "from_id": NODE}, timeout=15)
    except Exception as e:
        log("heartbeat failed: %s" % e)


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
        # Model not installed yet -> pull it once, then retry.
        if _retry and ("not found" in detail.lower() or e.code == 404):
            ollama_pull(model)
            return ollama_generate(model, prompt, system, image_b64, _retry=False)
        raise RuntimeError("ollama HTTP %s: %s" % (e.code, detail[:200]))
    except urllib.error.URLError as e:
        raise RuntimeError("cannot reach Ollama at %s (%s) - is `ollama serve` running?" % (OLLAMA, e.reason))


# ─── Job processing ──────────────────────────────────────────────────────────
def process(job):
    job_id = job["id"]; data = job.get("data") or {}
    if not sb_claim(job_id, data):
        return                                   # another node got it
    is_vision = bool(data.get("image_b64")) or bool(data.get("vision"))
    model = VISION_MODEL if is_vision else (data.get("model") or TEXT_MODEL)
    log("job %s -> %s (%s)" % (job_id, model, "vision" if is_vision else "text"))
    try:
        answer = ollama_generate(model, data.get("prompt"), data.get("system"), data.get("image_b64"))
        sb_finish(job_id, {"status": "done", "result": answer, "node": NODE, "ts": int(time.time() * 1000)})
        log("job %s done (%d chars)" % (job_id, len(answer)))
    except Exception as e:
        sb_finish(job_id, {"status": "error", "error": str(e), "node": NODE, "ts": int(time.time() * 1000)})
        log("job %s error: %s" % (job_id, e))


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
