<#
===========================================================================
 install-clippy.ps1 - turn a bare Windows laptop into a NEXUS hive node.
 v281 (2026-07-11, keeper's word: "have it install whatever it needs on
 other laptops. daemon installs everything.")

 ONE COMMAND on the new machine (PowerShell, no admin needed):

   irm https://raw.githubusercontent.com/orioncontinuity/nexus/main/install-clippy.ps1 | iex

 What it does, in order:
   1. Creates the stable home  %LOCALAPPDATA%\NexusClippy
   2. Downloads the node's core files from GitHub raw (main = canon):
      clippy-daemon.ps1, clippy-worker.py, clippy-update.ps1,
      clippy-character.json, clippy-dialog.json, clippy-pet-comp.ps1,
      clippy_agent.js (his Minecraft brain)
   3. Runs the daemon ONCE from that folder. The daemon does the rest -
      it is the installer (winget + direct fallbacks): git, Supabase CLI,
      GitHub CLI, Python 3, CLAUDE CODE, Ollama; registers the logon +
      5-minute self-heal Scheduled Task; starts the worker and the pet.
      From then on the node keeps ITSELF current (worker-2.0 self-update,
      15-min idle loop, compile()-gated, from GitHub raw).
   4. FORCES `claude /login` here and VERIFIES it with a real probe (the
      ~/.claude folder can exist without a valid session - that fooled us
      once). The one human step: the subscription seat is granted, never
      taken. It loops until the login truly completes; type `skip` to
      defer, or pass -NoLogin for a headless install. Until a real login
      lands the node answers with Ollama (claude:false on the bus).

 Optional params (only when invoked as a file, not via `| iex`):
   -CmdToken <tok>   enable remote "Push update" for this node (kept
                     PRIVATE in this PC's user env; never published)
   -NoLogin          skip the FORCED claude /login (headless installs);
                     node stays claude:false until you log in manually

 Verify from anywhere afterwards: the node appears in clippy_sync row
 'clippy_nodes' within a minute; claude:true once logged in.
===========================================================================
#>
param(
  [string]$CmdToken = '',
  [string]$StewardSecret = '',  # the shared Steward's Seal secret - give EVERY node the same value for a uniform command channel (seal:true, cmd:true). Kept private in this PC's env, never published.
  [switch]$NoLogin,
  [switch]$MakeHome   # claim THIS machine as Clippy's Minecraft home (writes clippy_home.txt so the bot's home-guard lets it run here)
)
$ErrorActionPreference = 'Continue'
$RAW    = 'https://raw.githubusercontent.com/orioncontinuity/nexus/main'
$stable = Join-Path $env:LOCALAPPDATA 'NexusClippy'

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

function Test-ClaudeAuth($exe) {
  # The ~/.claude FOLDER is created on the first `claude` run even with NO valid
  # login - so a dir check gives false confidence (seen live on the laptops
  # 2026-07-16: folder present, `claude -p` still said "Not logged in").
  # Probe for REAL: run a tiny prompt and confirm it isn't the login nag.
  # Wrapped in a job with a timeout so a hung/cold claude can't stall the install.
  if (-not $exe) { return $false }
  try {
    $j = Start-Job { param($x) 'ok' | & $x -p --output-format text 2>&1 } -ArgumentList $exe
    if (Wait-Job $j -Timeout 45) {
      $out = (Receive-Job $j | Out-String); Remove-Job $j -Force
      return ($out.Trim() -ne '' -and $out -notmatch 'not logged in|/login|please run')
    }
    Stop-Job $j; Remove-Job $j -Force; return $false
  } catch { return $false }
}

Say ''
Say '  -- NEXUS hive node installer -----------------------------' 'Cyan'
Say "  home: $stable" 'DarkGray'

# 1. Stable home ------------------------------------------------------------
$null = New-Item -ItemType Directory -Force -Path $stable

# 2. Core files from canon ---------------------------------------------------
$files = @('clippy-daemon.ps1','clippy-worker.py','clippy-update.ps1',
           'clippy-character.json','clippy-dialog.json','clippy-pet-comp.ps1',
           'clippy_agent.js',                    # his Minecraft brain - pulled so a fresh install has the current MC bot too
           'minecraft.gamecontroller.amgp')      # the F310 controller map (deployed by the daemon when controller.on)
$got = 0
foreach ($f in $files) {
  try {
    Invoke-WebRequest -Uri "$RAW/$f" -OutFile (Join-Path $stable $f) -UseBasicParsing -TimeoutSec 60
    Say "  [ok] $f" 'Green'; $got++
  } catch {
    Say "  [!!] $f - $($_.Exception.Message)" 'Red'
  }
}
if ($got -lt 2) {
  Say '  Could not fetch the core files (network?). Nothing installed; try again.' 'Red'
  return
}

# 2b. Enable his Minecraft self so a plain download runs EVERYTHING - but honour the ONE-BODY law:
#     the bot only runs on Clippy's home rig (hostname DESKTOP-N6PACMM, or a machine you claim with
#     -MakeHome, which writes the clippy_home.txt override the bot checks at %USERPROFILE%\.clippy\mc).
#     Other nodes stay bot-free so they don't exit-loop against his home guard.
try {
  $flagDir = Join-Path $env:USERPROFILE '.clippy'
  $mcDir   = Join-Path $flagDir 'mc'
  $null = New-Item -ItemType Directory -Force -Path $mcDir
  $homeFlag = Join-Path $mcDir 'clippy_home.txt'
  if ($MakeHome -and -not (Test-Path $homeFlag)) {
    Set-Content -Path $homeFlag -Value $env:COMPUTERNAME -NoNewline -Encoding ascii
    Say "  [ok] this machine ($env:COMPUTERNAME) claimed as Clippy's Minecraft home." 'Green'
  }
  $isHome = ($env:COMPUTERNAME -eq 'DESKTOP-N6PACMM') -or (Test-Path $homeFlag)
  if ($isHome) {
    New-Item -ItemType File -Force -Path (Join-Path $flagDir 'bot.on') -EA SilentlyContinue | Out-Null
    Say '  [ok] Minecraft bot enabled - daemon will install Node + mineflayer and run Clippy.' 'Green'
  } else {
    Say '  [i] Minecraft bot left OFF (not Clippy home rig). Re-run with -MakeHome to claim this PC.' 'DarkGray'
  }
} catch {}

# 3. Hand over to the daemon - IT is the installer ---------------------------
Say ''
Say '  handing over to clippy-daemon (provisions tools incl. Claude Code,' 'Cyan'
Say '  registers autostart, starts the worker + pet)...' 'Cyan'
$daemon = Join-Path $stable 'clippy-daemon.ps1'
$dArgs = @('-ExecutionPolicy','Bypass','-File',$daemon)
if ($CmdToken) { $dArgs += @('-CmdToken', $CmdToken) }
if ($StewardSecret) { $dArgs += @('-StewardSecret', $StewardSecret) }
& powershell.exe @dArgs

# 4. The one human step ------------------------------------------------------
# Resolve claude across EVERY install path - winget drops it in the WinGet Links
# dir, which Get-Command misses (it's not on the running shell's PATH). Without
# this, the daemon installs Claude but the login is never offered and the node
# stays claude:false - the exact bug on the companion laptops (2026-07-16).
$wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
if ((Test-Path $wingetLinks) -and ($env:PATH -notlike "*$wingetLinks*")) { $env:PATH = "$wingetLinks;$env:PATH" }
$claudeExe = $null
$c = Get-Command claude -EA SilentlyContinue
if ($c) { $claudeExe = $c.Source }
if (-not $claudeExe) {
  foreach ($p in @(
      (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
      (Join-Path $env:APPDATA 'npm\claude.cmd'),
      (Join-Path $wingetLinks 'claude.exe'),
      (Join-Path $wingetLinks 'claude.cmd'),
      (Join-Path $env:LOCALAPPDATA 'Programs\claude\claude.exe'))) {
    if ($p -and (Test-Path $p)) { $claudeExe = $p; break }
  }
}
Say '  checking Claude login (real probe, not just the folder)...' 'DarkGray'
$loggedIn = Test-ClaudeAuth $claudeExe
if (-not $claudeExe) {
  Say '  [!!] Claude Code was not detected after the daemon ran. Re-run this' 'Red'
  Say '       installer, or install manually: winget install Anthropic.ClaudeCode' 'Red'
} elseif ($loggedIn) {
  Say '  [ok] Claude subscription verified logged in - this node thinks with Claude.' 'Green'
} elseif ($NoLogin) {
  Say '  [i] -NoLogin set - skipping the forced login. This node stays claude:false' 'Yellow'
  Say '      (Ollama only) until you run:  claude /login' 'Yellow'
} else {
  # FORCED LOGIN - a Clippy node that never logs in is only half a Clippy, and a
  # folder check gave a false "logged in" before (the laptops, 2026-07-16: .claude
  # existed, claude -p still said "Not logged in"). Loop until a REAL login is
  # verified by probe, or the operator explicitly types skip. (Alfredo: "make
  # login forced when installing clippy. fix it all.")
  $verified = $false
  for ($attempt = 1; -not $verified; $attempt++) {
    Say ''
    Say "  Claude login REQUIRED (attempt $attempt) - this node thinks with Ollama" 'Yellow'
    Say '  only until it is done. A browser opens; COMPLETE the sign-in until the' 'Yellow'
    Say '  terminal confirms. This is the one human step, and it is required.' 'Yellow'
    $ans = Read-Host '  Press Enter to run claude /login now (or type skip to defer)'
    if ($ans -match '^\s*(skip|s|n|no|q|quit)\s*$') {
      Say '  [!!] Skipped. This node stays claude:false until you run:  claude /login' 'Red'
      break
    }
    & $claudeExe /login
    $verified = Test-ClaudeAuth $claudeExe
    if ($verified) {
      Say '  [ok] verified - this node now thinks with Claude, same as the others.' 'Green'
    } else {
      Say '  [..] not logged in yet - the browser sign-in did not complete. Trying' 'Yellow'
      Say '       again (or type skip to defer).' 'Yellow'
    }
  }
}

Say ''
Say '  -- done --------------------------------------------------' 'Cyan'
Say '  The node keeps itself: logon + 5-min self-heal task, 15-min' 'DarkGray'
Say '  self-update from GitHub. Watch it appear in NEXUS -> Admin ->' 'DarkGray'
Say '  AI provider -> Clippy pool (or the clippy_nodes bus row).' 'DarkGray'
