# curia_up.ps1 — bring the Curia's model tiers up on the 3070. Hand this to Clippy's daemon when the PC wakes.
#
#   VIGIL  (reflex)  -> Ollama, tiny model PINNED hot in VRAM         (keep_alive = -1)
#   WATCH  (eyes)    -> Ollama, small VLM, loaded transiently         (keep_alive = 30s, evicts to save VRAM)
#   SENATE (deep)    -> llama.cpp llama-server, 7B in RAM, layers streamed to GPU
#   AUGUR  (predict) -> the Senate's draft model (--model-draft) = speculative decoding, "predictive tokens"
#
# Two engines share the 8 GB on purpose: Ollama's keep_alive pins the always-on Vigil; llama.cpp's
# --model-draft gives the Senate the Augur (Ollama can't do speculative decoding out of the box).
# curia_brain.js already points vigil/watch at :11434 (Ollama) and senate at :8080 (llama.cpp).

$ErrorActionPreference = 'SilentlyContinue'
$clippy = Join-Path $env:USERPROFILE '.clippy'
$models = Join-Path $clippy 'models'          # put the Senate/Augur .gguf files here
New-Item -Force -ItemType Directory $clippy, $models | Out-Null

# ---- model picks (all chosen to co-exist in 8 GB) ----
$VIGIL_MODEL  = 'qwen2.5:1.5b-instruct-q4_K_M'          # ~1.1 GB, snap reflexes + blank-filling
$WATCH_MODEL  = 'moondream'                              # ~1.7 GB VLM, only resident while "seeing"
$SENATE_GGUF  = Join-Path $models 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'   # ~4.7 GB weights (mostly in RAM)
$AUGUR_GGUF   = Join-Path $models 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf' # ~0.4 GB draft, SAME family = aligned tokens

# ================= VIGIL + WATCH  (Ollama) =================
$env:OLLAMA_KEEP_ALIVE = '-1'          # default: keep models resident. The Watch overrides to 30s per-call.
if (Get-Command ollama -EA 0) {
  Write-Host '[Vesta] warming the Vigil (pinned hot in VRAM)...'
  ollama pull $VIGIL_MODEL  | Out-Null
  ollama pull $WATCH_MODEL  | Out-Null
  # a 1-token generate forces the model to load now, and keep_alive=-1 makes it stay
  $body = @{ model = $VIGIL_MODEL; prompt = 'ok'; keep_alive = -1; stream = $false } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:11434/api/generate' -Body $body -ContentType 'application/json' | Out-Null
  Write-Host "[Vesta] Vigil resident: $VIGIL_MODEL"
} else {
  Write-Host 'WARN: ollama not found on PATH. Install from https://ollama.com  (Vigil + Watch need it).'
}

# ================= SENATE + AUGUR  (llama.cpp) =================
# -ngl 20 : offload ~20 of the 7B's ~28 layers to the GPU (~3.5 GB) alongside the resident Vigil; rest stays in RAM.
# -c 4096 : context. Lower -ngl or -c if VRAM gets tight. The draft model rides along for speculative decoding.
$llama = (Get-Command llama-server -EA 0).Source
if (-not $llama) { $llama = (Get-Command server -EA 0).Source }   # older llama.cpp build name
if ($llama -and (Test-Path $SENATE_GGUF)) {
  $args = @('-m', $SENATE_GGUF, '-md', $AUGUR_GGUF, '--draft-max', '16', '--draft-min', '1',
            '-ngl', '20', '-c', '4096', '--host', '127.0.0.1', '--port', '8080')
  # mini-Vesta: relaunch loop + heartbeat, so the Senate revives if it dies (no scheduled task needed).
  $wrapper = @"
`$hb = Join-Path '$clippy' 'hb_senate.txt'
while (`$true) {
  Start-Process -FilePath '$llama' -ArgumentList @('$($args -join "','")') -NoNewWindow -PassThru | Out-Null
  # heartbeat while it lives; when llama-server exits, loop restarts it after a short pause
  for (`$i=0; `$i -lt 100000; `$i++) {
    [IO.File]::WriteAllText(`$hb, [string][int64]((Get-Date).ToUniversalTime()-[datetime]'1970-01-01').TotalMilliseconds)
    if (-not (Get-Process -Name 'llama-server','server' -EA 0)) { break }
    Start-Sleep -Seconds 10
  }
  Start-Sleep -Seconds 3
}
"@
  $wf = Join-Path $clippy 'curia_senate_keeper.ps1'
  [IO.File]::WriteAllText($wf, $wrapper)
  Start-Process powershell -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-File', $wf)
  Write-Host "[Vesta] Senate + Augur up on :8080  (target=$(Split-Path $SENATE_GGUF -Leaf), draft=$(Split-Path $AUGUR_GGUF -Leaf))"
} else {
  if (-not $llama)              { Write-Host 'WARN: llama-server not found. Get llama.cpp: https://github.com/ggml-org/llama.cpp/releases' }
  if (-not (Test-Path $SENATE_GGUF)) { Write-Host "WARN: missing $SENATE_GGUF  — download the Qwen2.5-7B + 0.5B Q4_K_M GGUFs into $models" }
}

Write-Host ''
Write-Host '=== VRAM budget on the 3070 (8 GB) ==='
Write-Host ' Vigil  ~1.2 GB  (resident, keep_alive=-1)'
Write-Host ' Senate ~3.5 GB  (-ngl 20 offload) + ~0.4 GB Augur draft + ~0.6 GB KV @ 4096 ctx'
Write-Host ' Watch  ~1.7 GB  (transient; evicts 30s after each look)'
Write-Host ' --> ~5.7 GB steady, ~2 GB headroom. If you OOM: drop -ngl to 14, or -c to 2048, or use the 0.5b Vigil.'
Write-Host ''
Write-Host 'Curia tiers are up. Point clippy_agent.js at curia_brain.js and it will start routing.'
