<#
clippy-daemon.ps1 - Clippy / render-farm node bootstrap daemon.

Makes the Clippy pool actually FUNCTION on a machine by auto-installing the
programs the worker needs - but ONLY when the device can afford it:
the system drive has enough free space AND the machine is on power (AC, or a
healthy battery above a threshold). On a low-disk or on-battery laptop it does
nothing destructive - it logs what it WOULD install, says why it skipped, and
exits 0.

Idempotent: anything already present is left alone, so it is safe to run at
every boot (Task Scheduler / shell:startup). After provisioning it will, if the
Supabase CLI is present AND logged in, (re)deploy the `clippy-pool` Edge
Function - which is what clears the "Clippy pool: HTTP Error 404" the app shows
when the function isn't published.

  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -MinFreeGB 25 -MinBatteryPct 50
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -AllowOnBattery
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -IncludeHeavy     # large GPU 3D-gen deps too
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -ReportOnly       # check + report, install nothing

SUPERVISOR MODE (worker as a Clippy slave):
  With -Supervise the daemon provisions once, then stays up as a persistent
  supervisor: it keeps clippy-worker.py alive (restarts it if it dies) and every
  -UpdateEveryMin minutes re-pulls the worker from GitHub and restarts it if it
  changed. That makes a node SELF-HEALING - a bad worker version recovers on its
  own instead of stranding the node. The logon autostart task uses this mode.

  Clippy (the master) owns its slave worker by launching the supervisor and
  passing its own PID; when Clippy exits, the supervisor stops the worker too:
    powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File clippy-daemon.ps1 -Supervise -ParentPid <ClippyPID> -CmdToken <token>
  A second supervisor started while one is already running just exits, so the
  logon task and a Clippy-launched copy never both run a worker.
#>
param(
  [int]$MinFreeGB      = 15,    # don't install unless the system drive has at least this much free
  [int]$MinBatteryPct  = 40,    # when on battery, only install above this charge
  [switch]$AllowOnBattery,      # permit installs while on battery (still honours -MinBatteryPct)
  [switch]$IncludeHeavy,        # also provision the large GPU model-gen deps (multi-GB)
  [string]$VisionModel = 'llava',  # Ollama vision model for Scan Plate. llava is reliable + light; 'llama3.2-vision' fails to load on some Ollama builds and heavier models thrash low-RAM boxes. The worker also auto-falls-back if this can't load.
  [string]$CmdToken = $env:CLIPPY_CMD_TOKEN, # enables "Push update" / remote commands; persisted for the user
  [switch]$NoAutostart,         # skip registering the logon Scheduled Task
  [switch]$Supervise,           # run as a persistent supervisor (Clippy launches this): keep the worker alive + self-heal from GitHub
  [int]$ParentPid = 0,          # if > 0, exit (and stop the worker) when this process dies - makes Clippy the master of its slave worker
  [int]$UpdateEveryMin = 15,    # supervisor: how often to re-pull the worker from GitHub and restart it if it changed
  [switch]$ReportOnly,          # report what would happen; change nothing
  [switch]$EnsureOnly           # provision tools only; skip pulling the model + starting the worker
)
$ErrorActionPreference = 'Continue'
$HOMEDIR  = $PSScriptRoot
$REF      = 'oprsthfxqrdbwdvommpw'
$ProgRoot = Join-Path $env:LOCALAPPDATA 'Programs'   # matches the existing supabase/gh layout
$RAW      = 'https://raw.githubusercontent.com/orioncontinuity/nexus/main'

function Log([string]$m, [string]$c = 'Gray') { Write-Host ((Get-Date -f 'HH:mm:ss') + '  ' + $m) -ForegroundColor $c }

# --- Worker (slave) lifecycle helpers - used by initial start and the supervisor
function Find-Python {
  $p = Get-Command pythonw -EA SilentlyContinue
  if (-not $p) { $p = Get-Command python -EA SilentlyContinue }
  if (-not $p) { $p = Get-Command python3 -EA SilentlyContinue }
  return $p
}
function Get-WorkerProc {
  return Get-CimInstance Win32_Process -EA SilentlyContinue |
         Where-Object { $_.CommandLine -and $_.CommandLine -match 'clippy-worker\.py' }
}
function Stop-WorkerProc {
  Get-WorkerProc | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
}
function Start-WorkerProc {
  $worker = Join-Path $HOMEDIR 'clippy-worker.py'
  if (-not (Test-Path $worker)) { Log "[!!] worker not found at $worker" 'Red'; return $false }
  $py = Find-Python
  if (-not $py) { Log "[next] Python not detected yet - rerun after a new shell." 'Yellow'; return $false }
  $env:CLIPPY_VISION_MODEL = $VisionModel
  $env:CLIPPY_MANAGED = 'clippy'     # tells the worker it runs as a Clippy-managed slave
  Start-Process -FilePath $py.Source -ArgumentList $worker -WorkingDirectory $HOMEDIR -WindowStyle Hidden | Out-Null
  Log "[ok] clippy-worker started" 'Green'
  return $true
}
function Get-PetProc {
  return Get-CimInstance Win32_Process -EA SilentlyContinue |
         Where-Object { $_.CommandLine -and $_.CommandLine -match 'clippy-pet-comp\.ps1' -and $_.CommandLine -notmatch '(?i)-Command' }
}
function Stop-PetProc {
  Get-PetProc | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
}
function Start-PetProc {
  # Launch the GhostGlass desktop pet (the floating web Clippy). Needs -STA. The
  # script has its own single-instance guard, so a double launch is harmless.
  $pet = Join-Path $HOMEDIR 'clippy-pet-comp.ps1'
  if (-not (Test-Path $pet)) { Log "[..] pet host not present yet (clippy-pet-comp.ps1)" 'Yellow'; return $false }
  Start-Process powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + $pet + '"') -WindowStyle Hidden | Out-Null
  Log "[ok] clippy pet (GhostGlass) started" 'Green'
  return $true
}
function Update-NodeFromGitHub {
  # Pull the latest node scripts into $HOMEDIR. Returns which ones changed.
  $res = @{ worker = $false; daemon = $false; pet = $false }
  foreach ($f in 'clippy-worker.py', 'clippy-daemon.ps1', 'clippy-update.ps1', 'clippy-character.json', 'clippy-dialog.json', 'clippy-pet-comp.ps1') {
    $dst = Join-Path $HOMEDIR $f
    $tmp = Join-Path $env:TEMP ('nx_' + $f)
    try {
      Invoke-WebRequest "$RAW/$f" -OutFile $tmp -UseBasicParsing -TimeoutSec 60
      $new = (Get-FileHash $tmp -Algorithm SHA256).Hash
      $old = if (Test-Path $dst) { (Get-FileHash $dst -Algorithm SHA256).Hash } else { '' }
      if ($new -ne $old) {
        Copy-Item $tmp $dst -Force
        if ($f -eq 'clippy-worker.py')  { $res.worker = $true }
        if ($f -eq 'clippy-daemon.ps1') { $res.daemon = $true }
        if ($f -eq 'clippy-pet-comp.ps1') { $res.pet = $true }
        # Character/dialog are data the worker reads at startup - restart it to reload.
        if ($f -eq 'clippy-character.json' -or $f -eq 'clippy-dialog.json') { $res.worker = $true }
        Log "[upd] refreshed $f" 'Green'
      }
      Remove-Item $tmp -Force -EA SilentlyContinue
    } catch { Log "[..] update fetch $f skipped: $($_.Exception.Message)" 'Yellow' }
  }
  return $res
}
function Invoke-Supervisor {
  # Persistent loop: keep the slave worker alive and self-heal from GitHub.
  # This is what makes a bad worker version recover automatically instead of
  # stranding the node (no more "blind worker that can't be updated").
  Log "[supervise] up - parent=$ParentPid, self-heal every ${UpdateEveryMin}m" 'Cyan'
  $lastUpd = Get-Date
  while ($true) {
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -EA SilentlyContinue)) {
      Log "[supervise] master (pid $ParentPid) exited - stopping worker" 'Yellow'
      Stop-WorkerProc
      break
    }
    if (-not (Get-WorkerProc)) {
      Log "[supervise] worker down - (re)starting" 'Yellow'
      Start-WorkerProc | Out-Null
    }
    if (-not (Get-PetProc)) {
      Log "[supervise] pet down - (re)starting" 'Yellow'
      Start-PetProc | Out-Null
    }
    if (((Get-Date) - $lastUpd).TotalMinutes -ge $UpdateEveryMin) {
      $lastUpd = Get-Date
      $u = Update-NodeFromGitHub
      if ($u.daemon) {
        # The daemon itself changed - apply it by relaunching through the updater
        # (it kills leftovers and starts a fresh supervisor from the new file),
        # so daemon-level improvements self-heal too, not just the worker.
        Log "[supervise] daemon updated - relaunching via updater" 'Green'
        Start-Process -FilePath 'powershell.exe' -ArgumentList ('-ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $HOMEDIR 'clippy-update.ps1') + '"') -WindowStyle Hidden
        break
      }
      if ($u.worker) {
        Log "[supervise] new worker pulled - restarting it" 'Green'
        Stop-WorkerProc
        Start-Sleep -Seconds 2
        Start-WorkerProc | Out-Null
      }
      if ($u.pet) {
        Log "[supervise] new pet pulled - restarting it" 'Green'
        Stop-PetProc
        Start-Sleep -Seconds 2
        Start-PetProc | Out-Null
      }
    }
    Start-Sleep -Seconds 30
  }
  Log "[supervise] exiting" 'Cyan'
}

# --- Capability probes ------------------------------------------------------
function Get-FreeGB {
  try { $d = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -EA Stop; return [math]::Round($d.Free / 1GB, 1) }
  catch { return -1 }
}
function Get-PowerState {
  # @{ OnAC = <bool>; Battery = <percent, or -1 when there is no battery> }
  try {
    Add-Type -AssemblyName System.Windows.Forms -EA Stop
    $p = [System.Windows.Forms.SystemInformation]::PowerStatus
    $onAC = ($p.PowerLineStatus -eq 'Online')
    $pct  = if ([int]$p.BatteryChargeStatus -band 128) { -1 } else { [int]([math]::Round($p.BatteryLifePercent * 100)) }
    return @{ OnAC = $onAC; Battery = $pct }
  } catch { return @{ OnAC = $true; Battery = -1 } }   # unknown -> assume desktop on AC
}

$freeGB    = Get-FreeGB
$power     = Get-PowerState
$hasWinget = [bool](Get-Command winget -EA SilentlyContinue)

$batteryTxt = if ($power.Battery -lt 0) { 'no battery (desktop/AC)' } else { "$($power.Battery)% " + $(if ($power.OnAC) { '(charging/AC)' } else { '(on battery)' }) }
Log "clippy-daemon - free disk ${freeGB} GB on $($env:SystemDrive) | power: $batteryTxt | winget: $(if($hasWinget){'yes'}else{'no'})" 'Cyan'

# --- The install gate: SPACE and POWER --------------------------------------
function Test-CanInstall([double]$needGB = 0) {
  $needTotal = $MinFreeGB + $needGB
  if ($freeGB -ge 0 -and $freeGB -lt $needTotal) {
    return @{ ok = $false; why = ("not enough disk: {0} GB free, need >= {1} GB" -f $freeGB, $needTotal) }
  }
  if ($power.Battery -lt 0) { return @{ ok = $true;  why = 'on AC (no battery)' } }   # desktop
  if ($power.OnAC)          { return @{ ok = $true;  why = 'on AC power' } }
  if (-not $AllowOnBattery) { return @{ ok = $false; why = 'on battery (pass -AllowOnBattery to permit)' } }
  if ($power.Battery -lt $MinBatteryPct) { return @{ ok = $false; why = ("on battery {0}% (< {1}%)" -f $power.Battery, $MinBatteryPct) } }
  return @{ ok = $true; why = ("on battery {0}%" -f $power.Battery) }
}

# --- Direct installer fallbacks (used when winget is unavailable) ------------
function Install-SupabaseDirect {
  # Latest release tarball -> extract supabase.exe into %LOCALAPPDATA%\Programs\supabase\
  $dest = Join-Path $ProgRoot 'supabase'
  $tmp  = Join-Path $env:TEMP 'supabase_dl'
  $null = New-Item -ItemType Directory -Force -Path $dest, $tmp
  $url  = 'https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz'
  $tgz  = Join-Path $tmp 'supabase.tar.gz'
  Invoke-WebRequest -Uri $url -OutFile $tgz -UseBasicParsing
  & tar.exe -xzf $tgz -C $tmp                       # tar.exe ships with Windows 10+
  $exe = Get-ChildItem -Path $tmp -Recurse -Filter 'supabase.exe' | Select-Object -First 1
  if (-not $exe) { throw 'supabase.exe not found in release archive' }
  Copy-Item $exe.FullName (Join-Path $dest 'supabase.exe') -Force
  Remove-Item $tmp -Recurse -Force -EA SilentlyContinue
}

# --- Required programs (data-driven) ----------------------------------------
#   Test   - already present? (skip if true)   Winget - preferred package id
#   Direct - scriptblock fallback              EstGB  - footprint for the space check
#   Heavy  - only attempted with -IncludeHeavy
$tools = @(
  @{ Name = 'git';          EstGB = 0.5; Winget = 'Git.Git';            Test = { [bool](Get-Command git -EA SilentlyContinue) } }
  @{ Name = 'Supabase CLI'; EstGB = 0.2; Winget = 'Supabase.CLI';       Direct = { Install-SupabaseDirect };
     Test = { (Test-Path (Join-Path $ProgRoot 'supabase\supabase.exe')) -or [bool](Get-Command supabase -EA SilentlyContinue) } }
  @{ Name = 'GitHub CLI';   EstGB = 0.2; Winget = 'GitHub.cli';
     Test = { (Test-Path (Join-Path $ProgRoot 'ghcli\bin\gh.exe')) -or [bool](Get-Command gh -EA SilentlyContinue) } }
  @{ Name = 'Python 3';     EstGB = 0.6; Winget = 'Python.Python.3.12';
     Test = { [bool](Get-Command python -EA SilentlyContinue) -or [bool](Get-Command python3 -EA SilentlyContinue) } }
  @{ Name = 'Ollama';       EstGB = 1.5; Winget = 'Ollama.Ollama';
     Test = { [bool](Get-Command ollama -EA SilentlyContinue) -or (Test-Path (Join-Path $ProgRoot 'Ollama\ollama.exe')) } }
  @{ Name = 'Blender';      EstGB = 4; Winget = 'BlenderFoundation.Blender';
     Test = { [bool](Get-Command blender -EA SilentlyContinue) -or [bool](Get-ChildItem (Join-Path $env:ProgramFiles 'Blender Foundation') -Recurse -Filter 'blender.exe' -EA SilentlyContinue | Select-Object -First 1) } }
  @{ Name = '3D-gen deps (TripoSR)'; EstGB = 8; Heavy = $true; Direct = { Install-RenderDeps };
     Test = { Test-Path (Join-Path $HOMEDIR 'brain\.render_ready') } }
)

function Install-RenderDeps {
  # Heavy GPU mesh-gen stack. Needs Python + pip already present.
  if (-not ((Get-Command python -EA SilentlyContinue) -or (Get-Command python3 -EA SilentlyContinue))) {
    throw 'Python is required before installing 3D-gen deps'
  }
  $py = Get-Command python -EA SilentlyContinue
  if (-not $py) { $py = Get-Command python3 -EA SilentlyContinue }
  & $py.Source -m pip install --upgrade pip
  & $py.Source -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
  & $py.Source -m pip install "git+https://github.com/VAST-AI-Research/TripoSR.git"
  $null = New-Item -ItemType Directory -Force -Path (Join-Path $HOMEDIR 'brain')
  '' | Set-Content (Join-Path $HOMEDIR 'brain\.render_ready')
}

function Install-One($tool) {
  if ($hasWinget -and $tool.Winget) {
    Log "    winget install $($tool.Winget)"
    & winget install --id $tool.Winget -e --silent --accept-package-agreements --accept-source-agreements *> $null
    if ($LASTEXITCODE -eq 0) { return $true }
    Log "    winget returned $LASTEXITCODE; trying direct fallback" 'Yellow'
  }
  if ($tool.Direct) { & $tool.Direct; return $true }
  if (-not $hasWinget) { Log "    no winget and no direct installer for $($tool.Name)" 'Yellow'; return $false }
  return $false
}

# --- Provision loop ---------------------------------------------------------
$installed = 0; $skipped = 0; $present = 0; $failed = 0
foreach ($t in $tools) {
  if ($t.Heavy -and -not $IncludeHeavy) { continue }
  if (& $t.Test) { Log "[have] $($t.Name)" 'Green'; $present++; continue }

  $gate = Test-CanInstall ([double]$t.EstGB)
  if (-not $gate.ok) { Log "[skip] $($t.Name) - $($gate.why)" 'Yellow'; $skipped++; continue }
  if ($ReportOnly)   { Log "[would install] $($t.Name) (~$($t.EstGB) GB) - $($gate.why)" 'Cyan'; $skipped++; continue }

  Log "[install] $($t.Name) (~$($t.EstGB) GB) - $($gate.why)"
  try {
    if (Install-One $t) {
      if (& $t.Test) { Log "[ok] $($t.Name)" 'Green'; $installed++ }
      else { Log "[!!] $($t.Name) installed but not detected - may need a new shell / PATH refresh" 'Yellow'; $failed++ }
    } else { $failed++ }
  } catch { Log "[!!] $($t.Name) failed: $($_.Exception.Message)" 'Red'; $failed++ }
}
Log "provision summary - present:$present installed:$installed skipped:$skipped failed:$failed" 'Cyan'

# --- Make the function go: (re)deploy clippy-pool if we can ------------------
if (-not $EnsureOnly -and -not $ReportOnly) {
  $sb = Join-Path $ProgRoot 'supabase\supabase.exe'
  if (-not (Test-Path $sb)) { $cmd = Get-Command supabase -EA SilentlyContinue; if ($cmd) { $sb = $cmd.Source } }
  if (Test-Path $sb) {
    & $sb projects list *> $null
    if ($LASTEXITCODE -eq 0) {
      Log "[..] deploying clippy-pool (clears the app's 'HTTP Error 404')"
      & $sb functions deploy clippy-pool --project-ref $REF
      if ($LASTEXITCODE -eq 0) { Log "[ok] clippy-pool deployed -> https://$REF.supabase.co/functions/v1/clippy-pool" 'Green' }
      else { Log "[!!] clippy-pool deploy failed - see output above" 'Red' }
    } else {
      Log "[next] Supabase CLI present but not logged in. Run once (token stays on this PC):" 'Yellow'
      Log ("       " + $sb + " login") 'Yellow'
    }
  } else {
    Log "[next] Supabase CLI not available yet - rerun after a new shell so PATH picks it up." 'Yellow'
  }
}

# --- Vision model + worker - THIS is what makes Clippy answer Scan Plate ------
# Pull a local Ollama vision model (space-gated) and start the job-poller, so
# every Clippy instance can produce vision answers with no cloud.
if (-not $EnsureOnly -and -not $ReportOnly) {
  $ollama = Get-Command ollama -EA SilentlyContinue
  $ollamaExe = if ($ollama) { $ollama.Source } else { Join-Path $ProgRoot 'Ollama\ollama.exe' }
  if (Test-Path $ollamaExe) {
    $estGB = if ($VisionModel -match 'moondream') { 3 } else { 9 }
    $have = (& $ollamaExe list 2>$null | Select-String -SimpleMatch $VisionModel)
    if ($have) {
      Log "[have] vision model '$VisionModel'" 'Green'
    } else {
      $g = Test-CanInstall ([double]$estGB)
      if ($g.ok) {
        Log "[pull] vision model '$VisionModel' (~$estGB GB) - $($g.why)"
        & $ollamaExe pull $VisionModel
        if ($LASTEXITCODE -eq 0) { Log "[ok] vision model ready" 'Green' }
        else { Log "[!!] model pull failed - see output above" 'Red' }
      } else {
        Log "[skip] vision model '$VisionModel' - $($g.why). Try -VisionModel moondream (smaller)." 'Yellow'
      }
    }
    # Persist the command token (enables "Push update" from NEXUS) for the user
    # so it survives reboots and is picked up by the worker we launch below.
    if ($CmdToken) {
      try { [Environment]::SetEnvironmentVariable('CLIPPY_CMD_TOKEN', $CmdToken, 'User') } catch {}
      $env:CLIPPY_CMD_TOKEN = $CmdToken
      Log "[ok] command token set - remote 'Push update' enabled" 'Green'
      # Publish the token to the bus so NEXUS auto-fills it (no manual entry).
      # NOTE: the bus is readable with the public anon key, so this trades the
      # token's secrecy for convenience - anyone with the site can then send
      # commands to this node. Skip (don't pass -CmdToken / unset it) if you
      # want command-exec to stay manual-token-only.
      try {
        $anon = 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'
        $hdr  = @{ apikey = $anon; Authorization = "Bearer $anon"; 'Content-Type' = 'application/json'; Prefer = 'resolution=merge-duplicates,return=minimal' }
        $ms   = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        $body = @{ id = 'clippy_cmd'; from_id = $env:COMPUTERNAME; data = @{ token = $CmdToken; node = $env:COMPUTERNAME; ts = $ms } } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Uri 'https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync' -Method Post -Headers $hdr -Body $body -TimeoutSec 15 | Out-Null
        Log "[ok] command token published to bus - NEXUS Push needs no manual entry" 'Green'
      } catch { Log "[..] token publish skipped: $($_.Exception.Message)" 'Yellow' }
    }
    # Coexist with the legacy v2.4.4 poller: it keeps answering TEXT (qwen3:8b)
    # while the worker specializes in VISION on its own 'vis:' lane. We never
    # stop or disable it - the two run side by side.
    # Start the job-poller (idempotent). Under -Supervise the supervisor owns the
    # worker lifecycle, so let it do the (managed) start in its first loop.
    if (-not $Supervise) {
      if (Get-WorkerProc) { Log "[have] clippy-worker already running" 'Green' }
      else { Start-WorkerProc | Out-Null }
      # Bring the desktop buddy up right away too (idempotent: it self-guards).
      if (Get-PetProc) { Log "[have] clippy pet already running" 'Green' }
      else { Start-PetProc | Out-Null }
    }

    # Auto-start on boot. Copy the scripts to a STABLE home first (this folder
    # may be a throwaway clone), then register a logon task pointing there.
    # Battery-friendly so it still runs on a laptop that's unplugged.
    if (-not $NoAutostart) {
      try {
        $self = $PSCommandPath; if (-not $self) { $self = $MyInvocation.MyCommand.Path }
        $stable = Join-Path $env:LOCALAPPDATA 'NexusClippy'
        New-Item -ItemType Directory -Force -Path $stable | Out-Null
        foreach ($f in 'clippy-daemon.ps1', 'clippy-worker.py', 'clippy-update.ps1', 'clippy-character.json', 'clippy-dialog.json', 'clippy-pet-comp.ps1') {
          $src = Join-Path $HOMEDIR $f
          if (Test-Path $src) { Copy-Item $src (Join-Path $stable $f) -Force -EA SilentlyContinue }
        }
        $stableDaemon = Join-Path $stable 'clippy-daemon.ps1'
        $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $stableDaemon + '" -Supervise')
        $trg = New-ScheduledTaskTrigger -AtLogOn
        $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        Register-ScheduledTask -TaskName 'ClippyDaemon' -Action $act -Trigger $trg -Settings $set -Force -ErrorAction Stop | Out-Null
        Log "[ok] autostart registered (logon task 'ClippyDaemon' -> $stable)" 'Green'
      } catch { Log "[..] autostart registration skipped: $($_.Exception.Message)" 'Yellow' }
    }
  } else {
    Log "[next] Ollama not installed yet - rerun the daemon (it installs Ollama), then try again." 'Yellow'
  }
}

# --- Supervisor mode -------------------------------------------------------
# Clippy launches this (master) to own its slave worker: keep it alive and
# self-heal from GitHub. -ParentPid ties the supervisor to Clippy's lifetime.
# Single-instance via a process check (fail-safe: after a kill+relaunch there is
# no stale lock to strand us) so the logon task and a Clippy-launched copy do
# not both run.
if ($Supervise -and -not $ReportOnly) {
  $others = Get-CimInstance Win32_Process -EA SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match 'clippy-daemon\.ps1' -and $_.CommandLine -match '-Supervise' }
  if ($others) {
    Log "[supervise] another supervisor already running (pid $($others[0].ProcessId)) - exiting" 'Yellow'
  } else {
    Invoke-Supervisor
  }
}

Log 'clippy-daemon done.' 'Cyan'
