<#
clippy-update.ps1 - self-update a Clippy node to the latest NEXUS node software.

This is what NEXUS "Tools -> Push update" ships: it lives in the Supabase
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

foreach ($f in 'clippy-worker.py', 'clippy-daemon.ps1', 'clippy-update.ps1', 'clippy-character.json', 'clippy-dialog.json') {
  try {
    Invoke-WebRequest "$raw/$f" -OutFile (Join-Path $dir $f) -UseBasicParsing -TimeoutSec 60
    Write-Host "[ok] fetched $f"
  } catch { Write-Host "[!!] fetch $f failed: $($_.Exception.Message)" }
}

# Stop any running supervisor + worker so the fresh ones take over.
Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'clippy-daemon\.ps1' -or $_.CommandLine -match 'clippy-worker\.py') } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
Start-Sleep -Seconds 2

# Relaunch the daemon as a detached, self-healing SUPERVISOR: it re-provisions
# (keeps Ollama + the vision model), starts the worker as a Clippy-managed
# slave, registers logon autostart, and from then on keeps the worker fresh
# from GitHub on its own - so a bad worker version recovers without a manual
# pull. Detached (Start-Process) so this updater can exit. CLIPPY_CMD_TOKEN is
# read from the environment.
$daemon = Join-Path $dir 'clippy-daemon.ps1'
if (Test-Path $daemon) {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList ('-ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $daemon + '" -Supervise') `
    -WorkingDirectory $dir -WindowStyle Hidden
  Write-Host "[ok] self-healing supervisor relaunched"
} else {
  Write-Host "[!!] daemon not present after fetch - check network / repo URL"
}
Write-Host "[done] clippy node updated"
