<#
clippy-update.ps1 — self-update a Clippy node to the latest NEXUS node software.

This is what NEXUS "Tools → Push update" ships: it lives in the Supabase
`installers` bucket; each node downloads it and runs it (PowerShell). It pulls
the latest clippy-worker.py + clippy-daemon.ps1 from the repo, stops the old
worker, then re-provisions + relaunches via the daemon (which keeps Ollama + the
vision model, restarts the worker, and re-registers autostart). The command
token carries through the environment, so remote "Push update" keeps working.

Run by hand too:  powershell -ExecutionPolicy Bypass -File clippy-update.ps1
#>
$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:LOCALAPPDATA 'NexusClippy'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$raw = 'https://raw.githubusercontent.com/orioncontinuity/nexus/main'

foreach ($f in 'clippy-worker.py', 'clippy-daemon.ps1', 'clippy-update.ps1') {
  try {
    Invoke-WebRequest "$raw/$f" -OutFile (Join-Path $dir $f) -UseBasicParsing -TimeoutSec 60
    Write-Host "[ok] fetched $f"
  } catch { Write-Host "[!!] fetch $f failed: $($_.Exception.Message)" }
}

# Stop any running worker so the fresh one takes over.
Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'clippy-worker\.py' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }

# Re-provision + relaunch (installs/keeps Ollama + vision model, starts worker,
# registers logon autostart). CLIPPY_CMD_TOKEN is read from the environment.
$daemon = Join-Path $dir 'clippy-daemon.ps1'
if (Test-Path $daemon) {
  & powershell -ExecutionPolicy Bypass -File $daemon
} else {
  Write-Host "[!!] daemon not present after fetch — check network / repo URL"
}
Write-Host "[done] clippy node updated"
