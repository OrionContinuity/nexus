<#
===========================================================================
 install-clippy.ps1 - turn a bare (or messy) Windows laptop into a fully
 provisioned NEXUS hive node, in ONE command, with NOTHING left to hand-fix.
 v327 (2026-07-18, keeper's word: "this is why we need an installer that
 does everything. make sure this is true.")

 ONE COMMAND on the machine (Windows PowerShell):

   irm https://raw.githubusercontent.com/orioncontinuity/nexus/main/install-clippy.ps1 | iex

 It SELF-ELEVATES (one UAC prompt) so it can truly do everything. What it does:
   0. Elevates to admin (re-launches itself; skip with -NoElevate).
   1. Stable home %LOCALAPPDATA%\NexusClippy + core files from GitHub (main).
   2. CLEANS UP legacy cruft so old installs converge on the current design:
        - the old "Orion" qwen brain (C:\OrionNode, ...\ClippyPC\brain\
          clippy_brain.py, its watchdog, its Startup shortcuts, its Orion*
          scheduled tasks, anything on port 4242) - killed + disabled.
        - the old AutoHotkey controller (%LOCALAPPDATA%\MCPad\mc_pad.ahk and
          its MC Controller / MinecraftController Startup shortcuts) - killed
          + disabled. AntiMicroX is the one true mapper now.
        - a stale ClippyDaemon task that launches powershell.exe DIRECTLY
          (flashes a console every 5 min) is re-registered HIDDEN.
   3. Installs AntiMicroX (the F310 -> Minecraft mapper) machine-scope and
      turns the controller ON for this machine (controller.on).
   4. Hands over to clippy-daemon - IT provisions git, Python, Claude Code,
      Ollama, Node+mineflayer (on the home rig), registers the HIDDEN logon +
      5-min self-heal task, and starts the worker + pet. The node then keeps
      ITSELF current (15-min self-update from GitHub).
   5. Optional -Debloat: removes Microsoft telemetry (DiagTrack, AllowTelemetry
      =0, the telemetry/appraiser/CEIP scheduled tasks) and the console-flashing
      MareBackup task - for a quiet kid's gaming laptop.
   6. FORCES `claude /login` and VERIFIES it with a real probe (the one human
      step; the seat is granted, never taken). -NoLogin for headless installs.

 Optional params (only when invoked as a file, not via `| iex`):
   -CmdToken <tok>    enable remote "Push update" (kept PRIVATE in this PC's env)
   -StewardSecret <s> the shared Steward's Seal secret (same on every node)
   -MakeHome          claim THIS machine as Clippy's Minecraft home
   -Debloat           also strip Microsoft telemetry (see step 5)
   -NoLogin           skip the forced claude /login (node stays claude:false)
   -NoElevate         do not self-elevate (unelevated: skips steps that need admin)

 Verify afterwards: the node appears in clippy_sync row 'clippy_nodes' within
 a minute; claude:true once logged in.
===========================================================================
#>
param(
  [string]$CmdToken = '',
  [string]$StewardSecret = '',
  [switch]$NoLogin,
  [switch]$MakeHome,
  [switch]$Debloat,
  [switch]$NoElevate
)
$ErrorActionPreference = 'Continue'
$RAW    = 'https://raw.githubusercontent.com/orioncontinuity/nexus/main'
$stable = Join-Path $env:LOCALAPPDATA 'NexusClippy'

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

# 0. SELF-ELEVATE ----------------------------------------------------------
# An installer that "does everything" needs admin: migrating a stale scheduled
# task, machine-scope winget installs, deleting Orion* system tasks, and the
# optional telemetry strip all require it. We re-launch ourselves elevated. The
# `irm | iex` form has no file on disk, so we relaunch by re-fetching in the
# elevated shell; a file invocation re-runs the file with the same params.
function Test-Admin { return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator) }
if (-not (Test-Admin) -and -not $NoElevate) {
  Say ''
  Say '  This installer needs admin to do EVERYTHING (clean old cruft, install' 'Yellow'
  Say '  the controller mapper, register autostart hidden). Elevating now -' 'Yellow'
  Say '  please accept the UAC prompt. (Use -NoElevate to run unprivileged.)' 'Yellow'
  try {
    $selfFile = $PSCommandPath; if (-not $selfFile) { $selfFile = $MyInvocation.MyCommand.Path }
    if ($selfFile -and (Test-Path $selfFile)) {
      # invoked as a file - re-run the file elevated, preserving bound params
      $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $selfFile + '"'))
      foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        if ($kv.Value -is [switch]) { if ($kv.Value.IsPresent) { $argList += "-$($kv.Key)" } }
        else { $argList += @("-$($kv.Key)", ('"' + $kv.Value + '"')) }
      }
      Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    } else {
      # `irm | iex` - re-fetch and run in the elevated shell
      $cmd = "irm $RAW/install-clippy.ps1 | iex"
      Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command', $cmd)
    }
    Say '  Elevated installer launched in a new window. You can close this one.' 'Cyan'
    return
  } catch {
    Say "  [!!] Could not elevate ($($_.Exception.Message)). Continuing unprivileged;" 'Red'
    Say '       some cleanup/controller/debloat steps may be skipped.' 'Red'
  }
}
$IsAdmin = Test-Admin

Say ''
Say '  == NEXUS hive node installer (does everything) ============' 'Cyan'
Say "  home: $stable   admin: $IsAdmin" 'DarkGray'

# 1. Stable home + core files ----------------------------------------------
$null = New-Item -ItemType Directory -Force -Path $stable
$files = @('clippy-daemon.ps1','clippy-worker.py','clippy-update.ps1',
           'clippy-character.json','clippy-dialog.json','clippy-pet-comp.ps1',
           'clippy_agent.js','controller-profiles.json','minecraft.gamecontroller.amgp')
$got = 0
foreach ($f in $files) {
  try { Invoke-WebRequest -Uri "$RAW/$f" -OutFile (Join-Path $stable $f) -UseBasicParsing -TimeoutSec 60; Say "  [ok] $f" 'Green'; $got++ }
  catch { Say "  [!!] $f - $($_.Exception.Message)" 'Red' }
}
if ($got -lt 2) { Say '  Could not fetch core files (network?). Nothing installed; try again.' 'Red'; return }

# 2. CLEAN UP LEGACY CRUFT --------------------------------------------------
# Every messy leftover we've had to hand-remove, folded in so an install
# converges any machine onto the current, correct design. All idempotent.
Say ''
Say '  cleaning up legacy cruft (old brain, old AHK controller, stale task)...' 'Cyan'

# 2a. The old "Orion"/legacy qwen brain (HTTP node on ~4242 that stole commands)
try {
  # kill any running legacy brain (NOT the real worker, NOT ollama)
  Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object {
    ($_.CommandLine -match '(?i)clippy_brain\.py|OrionNode|clippy_watchdog') -and
    ($_.CommandLine -notmatch '(?i)NexusClippy\\clippy-worker\.py')
  } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -EA Stop; Say "    [ok] killed legacy brain pid $($_.ProcessId)" 'Green' } catch {} }
  # a listener on 4242 is the brain's API - kill its owner
  try { Get-NetTCPConnection -LocalPort 4242 -State Listen -EA SilentlyContinue | Select-Object -Expand OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -EA SilentlyContinue } catch {} } } catch {}
  # disable resurrection watchdogs + brain folders (rename, reversible)
  foreach ($u in (Get-ChildItem 'C:\Users' -Directory -EA SilentlyContinue)) {
    foreach ($rel in @('Downloads\ClippyPC\brain\clippy_watchdog.ps1','Downloads\ClippyPC\brain','.clippy\OrionNode')) {
      $p = Join-Path $u.FullName $rel
      if (Test-Path $p) { try { Rename-Item $p ($p + '.disabled') -Force -EA Stop; Say "    [ok] disabled $p" 'Green' } catch {} }
    }
    # Startup shortcuts that relaunch the brain / tray / worker-watchdog
    $sd = Join-Path $u.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
    if (Test-Path $sd) {
      Get-ChildItem $sd -Filter '*.lnk' -EA SilentlyContinue | Where-Object { $_.Name -match '(?i)Orion|clippy.?worker|clippy\.lnk' } | ForEach-Object {
        try { $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName); $tgt = "$($sh.TargetPath) $($sh.Arguments)" } catch { $tgt = '' }
        if ($tgt -match '(?i)watchdog|OrionNode|clippy_brain|ClippyPC') { try { Rename-Item $_.FullName ($_.FullName + '.disabled') -Force -EA Stop; Say "    [ok] disabled startup $($_.Name)" 'Green' } catch {} }
      }
    }
  }
  if (Test-Path 'C:\OrionNode') { try { Rename-Item 'C:\OrionNode' 'C:\OrionNode.disabled' -Force -EA Stop; Say '    [ok] disabled C:\OrionNode' 'Green' } catch {} }
  # Orion* scheduled tasks (elevated) - delete outright when admin
  Get-ScheduledTask -EA SilentlyContinue | Where-Object { $_.TaskName -match '(?i)^Orion' -or ($_.Actions.Arguments -match '(?i)OrionNode|clippy_brain|clippy_watchdog') } | ForEach-Object {
    try { Unregister-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -Confirm:$false -EA Stop; Say "    [ok] removed task $($_.TaskName)" 'Green' }
    catch { try { Disable-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -EA Stop | Out-Null; Say "    [ok] disabled task $($_.TaskName)" 'Green' } catch { Say "    [--] $($_.TaskName) (needs admin)" 'DarkGray' } }
  }
} catch { Say "    [..] brain cleanup: $($_.Exception.Message)" 'Yellow' }

# 2b. The old AutoHotkey controller (mc_pad.ahk in %LOCALAPPDATA%\MCPad) - conflicts with AntiMicroX
try {
  Get-Process -EA SilentlyContinue | Where-Object { $_.ProcessName -match '(?i)autohotkey' } | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }
  foreach ($u in (Get-ChildItem 'C:\Users' -Directory -EA SilentlyContinue)) {
    $mc = Join-Path $u.FullName 'AppData\Local\MCPad'
    if (Test-Path $mc) { try { $t = $mc + '.disabled'; if (Test-Path $t) { Remove-Item $t -Recurse -Force -EA SilentlyContinue }; Rename-Item $mc $t -Force -EA Stop; Say "    [ok] disabled $mc" 'Green' } catch {} }
    $sd = Join-Path $u.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
    if (Test-Path $sd) { Get-ChildItem $sd -Filter '*.lnk' -EA SilentlyContinue | Where-Object { $_.Name -match '(?i)mc.?pad|minecraft.?controller|mc.?controller' } | ForEach-Object { try { Rename-Item $_.FullName ($_.FullName + '.disabled') -Force -EA Stop; Say "    [ok] disabled startup $($_.Name)" 'Green' } catch {} } }
  }
} catch { Say "    [..] AHK cleanup: $($_.Exception.Message)" 'Yellow' }

# 2c. Migrate a stale flashing ClippyDaemon task (raw powershell.exe -> hidden wscript)
if ($IsAdmin) {
  try {
    $dt = Get-ScheduledTask -TaskName 'ClippyDaemon' -EA SilentlyContinue
    if ($dt -and ($dt.Actions | Select-Object -First 1).Execute -notmatch '(?i)wscript') {
      $vbs = Join-Path $stable 'run-daemon-hidden.vbs'
      if (-not (Test-Path $vbs)) {
        $d = Join-Path $stable 'clippy-daemon.ps1'
        Set-Content $vbs ('CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $d + '"" -Supervise", 0, False') -Encoding ascii -Force
      }
      Set-ScheduledTask -TaskName 'ClippyDaemon' -Action (New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')) -EA Stop | Out-Null
      Say '    [ok] ClippyDaemon task migrated to hidden launcher (no more 5-min flash)' 'Green'
    }
  } catch { Say "    [..] task migration: $($_.Exception.Message)" 'Yellow' }
}

# 3. Minecraft home / bot -----------------------------------------------------
try {
  $flagDir = Join-Path $env:USERPROFILE '.clippy'
  $mcDir   = Join-Path $flagDir 'mc'
  $null = New-Item -ItemType Directory -Force -Path $mcDir
  $homeFlag = Join-Path $mcDir 'clippy_home.txt'
  if ($MakeHome -and -not (Test-Path $homeFlag)) { Set-Content -Path $homeFlag -Value $env:COMPUTERNAME -NoNewline -Encoding ascii; Say "  [ok] $env:COMPUTERNAME claimed as Clippy's Minecraft home." 'Green' }
  $isHome = ($env:COMPUTERNAME -eq 'DESKTOP-N6PACMM') -or (Test-Path $homeFlag)
  if ($isHome) { New-Item -ItemType File -Force -Path (Join-Path $flagDir 'bot.on') -EA SilentlyContinue | Out-Null; Say '  [ok] Minecraft bot enabled (daemon installs Node + mineflayer).' 'Green' }
  else { Say '  [i] Minecraft bot OFF (not the home rig). Re-run with -MakeHome to claim.' 'DarkGray' }
} catch {}

# 4. Controller: install AntiMicroX + turn it ON -----------------------------
Say ''
Say '  setting up the game controller (AntiMicroX -> F310)...' 'Cyan'
try {
  New-Item -ItemType File -Force -Path (Join-Path $env:USERPROFILE '.clippy\controller.on') -EA SilentlyContinue | Out-Null
  Say '  [ok] controller enabled (controller.on)' 'Green'
  # find antimicrox in EITHER the \bin\ subfolder (new builds) or the root (old)
  $ax = $null
  foreach ($p in @(
      (Join-Path ${env:ProgramFiles(x86)} 'AntiMicroX\bin\antimicrox.exe'),
      (Join-Path ${env:ProgramFiles}      'AntiMicroX\bin\antimicrox.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'AntiMicroX\antimicrox.exe'),
      (Join-Path ${env:ProgramFiles}      'AntiMicroX\antimicrox.exe'))) { if ($p -and (Test-Path $p)) { $ax = $p; break } }
  if ($ax) { Say "  [ok] AntiMicroX present: $ax" 'Green' }
  else {
    Say '  installing AntiMicroX via winget (machine scope)...' 'DarkGray'
    try { & winget install -e --id AntiMicroX.antimicrox --scope machine --silent --accept-package-agreements --accept-source-agreements *> $null } catch {}
    foreach ($p in @((Join-Path ${env:ProgramFiles(x86)} 'AntiMicroX\bin\antimicrox.exe'),(Join-Path ${env:ProgramFiles} 'AntiMicroX\bin\antimicrox.exe'),(Join-Path ${env:ProgramFiles(x86)} 'AntiMicroX\antimicrox.exe'),(Join-Path ${env:ProgramFiles} 'AntiMicroX\antimicrox.exe'))) { if ($p -and (Test-Path $p)) { $ax = $p; break } }
    if ($ax) { Say "  [ok] AntiMicroX installed: $ax" 'Green' } else { Say '  [!] AntiMicroX not found after install (winget may need a retry).' 'Yellow' }
  }
  Say '  [i] the daemon starts the mapper automatically while Minecraft is running.' 'DarkGray'
} catch { Say "  [..] controller setup: $($_.Exception.Message)" 'Yellow' }

# 5. Optional: strip Microsoft telemetry -------------------------------------
if ($Debloat) {
  Say ''
  Say '  -Debloat: removing Microsoft telemetry...' 'Cyan'
  if (-not $IsAdmin) { Say '  [!] not elevated - telemetry strip needs admin; re-run without -NoElevate.' 'Yellow' }
  else {
    try {
      foreach ($s in 'DiagTrack','dmwappushservice') { Stop-Service $s -Force -EA SilentlyContinue; Set-Service $s -StartupType Disabled -EA SilentlyContinue }
      foreach ($p in 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection') { New-Item $p -Force -EA SilentlyContinue | Out-Null; New-ItemProperty $p -Name AllowTelemetry -PropertyType DWord -Value 0 -Force -EA SilentlyContinue | Out-Null }
      $tt = @(
        @('\Microsoft\Windows\Application Experience\','ProgramDataUpdater'),
        @('\Microsoft\Windows\Application Experience\','Microsoft Compatibility Appraiser'),
        @('\Microsoft\Windows\Application Experience\','MareBackup'),
        @('\Microsoft\Windows\Application Experience\','PcaPatchDbTask'),
        @('\Microsoft\Windows\Application Experience\','PcaWallpaperAppDetect'),
        @('\Microsoft\Windows\Customer Experience Improvement Program\','Consolidator'),
        @('\Microsoft\Windows\Customer Experience Improvement Program\','UsbCeip'),
        @('\Microsoft\Windows\Customer Experience Improvement Program\','KernelCeipTask'),
        @('\Microsoft\Windows\Windows Error Reporting\','QueueReporting'),
        @('\Microsoft\Windows\Feedback\Siuf\','DmClient'),
        @('\Microsoft\Windows\Feedback\Siuf\','DmClientOnScenarioDownload'),
        @('\Microsoft\Windows\CloudExperienceHost\','CreateObjectTask'),
        @('\Microsoft\Windows\Maintenance\','WinSAT'))
      foreach ($t in $tt) { try { Disable-ScheduledTask -TaskPath $t[0] -TaskName $t[1] -EA Stop | Out-Null } catch {} }
      Say '  [ok] DiagTrack disabled, AllowTelemetry=0, telemetry tasks disabled.' 'Green'
    } catch { Say "  [..] debloat: $($_.Exception.Message)" 'Yellow' }
  }
}

# 6. Hand over to the daemon (provisions tools, registers hidden autostart) ---
Say ''
Say '  handing over to clippy-daemon (Claude Code, Python, Ollama, autostart)...' 'Cyan'
$daemon = Join-Path $stable 'clippy-daemon.ps1'
$dArgs = @('-ExecutionPolicy','Bypass','-File',$daemon)
if ($CmdToken)      { $dArgs += @('-CmdToken', $CmdToken) }
if ($StewardSecret) { $dArgs += @('-StewardSecret', $StewardSecret) }
& powershell.exe @dArgs

# 7. The one human step: claude /login ---------------------------------------
function Test-ClaudeAuth($exe) {
  if (-not $exe) { return $false }
  try {
    $j = Start-Job { param($x) 'ok' | & $x -p --output-format text 2>&1 } -ArgumentList $exe
    if (Wait-Job $j -Timeout 45) { $out = (Receive-Job $j | Out-String); Remove-Job $j -Force; return ($out.Trim() -ne '' -and $out -notmatch 'not logged in|/login|please run') }
    Stop-Job $j; Remove-Job $j -Force; return $false
  } catch { return $false }
}
$wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
if ((Test-Path $wingetLinks) -and ($env:PATH -notlike "*$wingetLinks*")) { $env:PATH = "$wingetLinks;$env:PATH" }
$claudeExe = $null
$c = Get-Command claude -EA SilentlyContinue; if ($c) { $claudeExe = $c.Source }
if (-not $claudeExe) {
  foreach ($p in @((Join-Path $env:USERPROFILE '.local\bin\claude.exe'),(Join-Path $env:APPDATA 'npm\claude.cmd'),(Join-Path $wingetLinks 'claude.exe'),(Join-Path $wingetLinks 'claude.cmd'),(Join-Path $env:LOCALAPPDATA 'Programs\claude\claude.exe'))) { if ($p -and (Test-Path $p)) { $claudeExe = $p; break } }
}
Say '  checking Claude login (real probe)...' 'DarkGray'
$loggedIn = Test-ClaudeAuth $claudeExe
if (-not $claudeExe) { Say '  [!!] Claude Code not detected after the daemon ran. Re-run, or: winget install Anthropic.ClaudeCode' 'Red' }
elseif ($loggedIn)   { Say '  [ok] Claude subscription verified - this node thinks with Claude.' 'Green' }
elseif ($NoLogin)    { Say '  [i] -NoLogin set - node stays claude:false (Ollama) until: claude /login' 'Yellow' }
else {
  $verified = $false
  for ($attempt = 1; -not $verified; $attempt++) {
    Say ''
    Say "  Claude login REQUIRED (attempt $attempt). A browser opens; complete sign-in." 'Yellow'
    $ans = Read-Host '  Press Enter to run claude /login now (or type skip to defer)'
    if ($ans -match '^\s*(skip|s|n|no|q|quit)\s*$') { Say '  [!!] Skipped. Node stays claude:false until: claude /login' 'Red'; break }
    & $claudeExe /login
    $verified = Test-ClaudeAuth $claudeExe
    if ($verified) { Say '  [ok] verified - this node now thinks with Claude.' 'Green' }
    else { Say '  [..] not logged in yet - try again (or type skip to defer).' 'Yellow' }
  }
}

Say ''
Say '  == done ==================================================' 'Cyan'
Say '  Node self-heals (logon + 5-min hidden task) and self-updates' 'DarkGray'
Say '  (15-min from GitHub). Controller works on next Minecraft launch.' 'DarkGray'
if (-not $Debloat) { Say '  Tip: add -Debloat to also strip Microsoft telemetry.' 'DarkGray' }
