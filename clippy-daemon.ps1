<#
clippy-daemon.ps1 — Clippy / render-farm node bootstrap daemon.

Makes the Clippy pool actually FUNCTION on a machine by auto-installing the
programs the worker needs — but ONLY when the device can afford it:
the system drive has enough free space AND the machine is on power (AC, or a
healthy battery above a threshold). On a low-disk or on-battery laptop it does
nothing destructive — it logs what it WOULD install, says why it skipped, and
exits 0.

Idempotent: anything already present is left alone, so it is safe to run at
every boot (Task Scheduler / shell:startup). After provisioning it will, if the
Supabase CLI is present AND logged in, (re)deploy the `clippy-pool` Edge
Function — which is what clears the "Clippy pool: HTTP Error 404" the app shows
when the function isn't published.

  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -MinFreeGB 25 -MinBatteryPct 50
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -AllowOnBattery
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -IncludeHeavy     # large GPU 3D-gen deps too
  powershell -ExecutionPolicy Bypass -File clippy-daemon.ps1 -ReportOnly       # check + report, install nothing
#>
param(
  [int]$MinFreeGB      = 15,    # don't install unless the system drive has at least this much free
  [int]$MinBatteryPct  = 40,    # when on battery, only install above this charge
  [switch]$AllowOnBattery,      # permit installs while on battery (still honours -MinBatteryPct)
  [switch]$IncludeHeavy,        # also provision the large GPU model-gen deps (multi-GB)
  [switch]$ReportOnly,          # report what would happen; change nothing
  [switch]$EnsureOnly           # provision tools only; skip the clippy-pool deploy step
)
$ErrorActionPreference = 'Continue'
$HOMEDIR  = $PSScriptRoot
$REF      = 'oprsthfxqrdbwdvommpw'
$ProgRoot = Join-Path $env:LOCALAPPDATA 'Programs'   # matches the existing supabase/gh layout

function Log([string]$m, [string]$c = 'Gray') { Write-Host ((Get-Date -f 'HH:mm:ss') + '  ' + $m) -ForegroundColor $c }

# ─── Capability probes ──────────────────────────────────────────────────────
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
  } catch { return @{ OnAC = $true; Battery = -1 } }   # unknown → assume desktop on AC
}

$freeGB    = Get-FreeGB
$power     = Get-PowerState
$hasWinget = [bool](Get-Command winget -EA SilentlyContinue)

$batteryTxt = if ($power.Battery -lt 0) { 'no battery (desktop/AC)' } else { "$($power.Battery)% " + $(if ($power.OnAC) { '(charging/AC)' } else { '(on battery)' }) }
Log "clippy-daemon — free disk ${freeGB} GB on $($env:SystemDrive) | power: $batteryTxt | winget: $(if($hasWinget){'yes'}else{'no'})" 'Cyan'

# ─── The install gate: SPACE and POWER ──────────────────────────────────────
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

# ─── Direct installer fallbacks (used when winget is unavailable) ────────────
function Install-SupabaseDirect {
  # Latest release tarball → extract supabase.exe into %LOCALAPPDATA%\Programs\supabase\
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

# ─── Required programs (data-driven) ────────────────────────────────────────
#   Test   — already present? (skip if true)   Winget — preferred package id
#   Direct — scriptblock fallback              EstGB  — footprint for the space check
#   Heavy  — only attempted with -IncludeHeavy
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

# ─── Provision loop ─────────────────────────────────────────────────────────
$installed = 0; $skipped = 0; $present = 0; $failed = 0
foreach ($t in $tools) {
  if ($t.Heavy -and -not $IncludeHeavy) { continue }
  if (& $t.Test) { Log "[have] $($t.Name)" 'Green'; $present++; continue }

  $gate = Test-CanInstall ([double]$t.EstGB)
  if (-not $gate.ok) { Log "[skip] $($t.Name) — $($gate.why)" 'Yellow'; $skipped++; continue }
  if ($ReportOnly)   { Log "[would install] $($t.Name) (~$($t.EstGB) GB) — $($gate.why)" 'Cyan'; $skipped++; continue }

  Log "[install] $($t.Name) (~$($t.EstGB) GB) — $($gate.why)"
  try {
    if (Install-One $t) {
      if (& $t.Test) { Log "[ok] $($t.Name)" 'Green'; $installed++ }
      else { Log "[!!] $($t.Name) installed but not detected — may need a new shell / PATH refresh" 'Yellow'; $failed++ }
    } else { $failed++ }
  } catch { Log "[!!] $($t.Name) failed: $($_.Exception.Message)" 'Red'; $failed++ }
}
Log "provision summary — present:$present installed:$installed skipped:$skipped failed:$failed" 'Cyan'

# ─── Make the function go: (re)deploy clippy-pool if we can ──────────────────
if (-not $EnsureOnly -and -not $ReportOnly) {
  $sb = Join-Path $ProgRoot 'supabase\supabase.exe'
  if (-not (Test-Path $sb)) { $cmd = Get-Command supabase -EA SilentlyContinue; if ($cmd) { $sb = $cmd.Source } }
  if (Test-Path $sb) {
    & $sb projects list *> $null
    if ($LASTEXITCODE -eq 0) {
      Log "[..] deploying clippy-pool (clears the app's 'HTTP Error 404')"
      & $sb functions deploy clippy-pool --project-ref $REF
      if ($LASTEXITCODE -eq 0) { Log "[ok] clippy-pool deployed → https://$REF.supabase.co/functions/v1/clippy-pool" 'Green' }
      else { Log "[!!] clippy-pool deploy failed — see output above" 'Red' }
    } else {
      Log "[next] Supabase CLI present but not logged in. Run once (token stays on this PC):" 'Yellow'
      Log "       & `"$sb`" login" 'Yellow'
    }
  } else {
    Log "[next] Supabase CLI not available yet — rerun after a new shell so PATH picks it up." 'Yellow'
  }
}

Log 'clippy-daemon done.' 'Cyan'
