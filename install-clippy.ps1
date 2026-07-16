<#
═══════════════════════════════════════════════════════════════════════════
 install-clippy.ps1 — turn a bare Windows laptop into a NEXUS hive node.
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
   3. Runs the daemon ONCE from that folder. The daemon does the rest —
      it is the installer (winget + direct fallbacks): git, Supabase CLI,
      GitHub CLI, Python 3, CLAUDE CODE, Ollama; registers the logon +
      5-minute self-heal Scheduled Task; starts the worker and the pet.
      From then on the node keeps ITSELF current (worker-2.0 self-update,
      15-min idle loop, compile()-gated, from GitHub raw).
   4. Offers `claude /login` right here in the terminal — the one step
      that stays human: the subscription seat is granted, never taken.
      Skip it (-NoLogin or just decline) and the node still runs; it
      answers with Ollama until someone logs Claude in.

 Optional params (only when invoked as a file, not via `| iex`):
   -CmdToken <tok>   enable remote "Push update" for this node (kept
                     PRIVATE in this PC's user env; never published)
   -NoLogin          don't offer claude /login at the end

 Verify from anywhere afterwards: the node appears in clippy_sync row
 'clippy_nodes' within a minute; claude:true once logged in.
═══════════════════════════════════════════════════════════════════════════
#>
param(
  [string]$CmdToken = '',
  [switch]$NoLogin,
  [switch]$MakeHome   # claim THIS machine as Clippy's Minecraft home (writes clippy_home.txt so the bot's home-guard lets it run here)
)
$ErrorActionPreference = 'Continue'
$RAW    = 'https://raw.githubusercontent.com/orioncontinuity/nexus/main'
$stable = Join-Path $env:LOCALAPPDATA 'NexusClippy'

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

Say ''
Say '  ── NEXUS hive node installer ─────────────────────────────' 'Cyan'
Say "  home: $stable" 'DarkGray'

# 1. Stable home ------------------------------------------------------------
$null = New-Item -ItemType Directory -Force -Path $stable

# 2. Core files from canon ---------------------------------------------------
$files = @('clippy-daemon.ps1','clippy-worker.py','clippy-update.ps1',
           'clippy-character.json','clippy-dialog.json','clippy-pet-comp.ps1',
           'clippy_agent.js',                    # his Minecraft brain — pulled so a fresh install has the current MC bot too
           'minecraft.gamecontroller.amgp')      # the F310 controller map (deployed by the daemon when controller.on)
$got = 0
foreach ($f in $files) {
  try {
    Invoke-WebRequest -Uri "$RAW/$f" -OutFile (Join-Path $stable $f) -UseBasicParsing -TimeoutSec 60
    Say "  [ok] $f" 'Green'; $got++
  } catch {
    Say "  [!!] $f — $($_.Exception.Message)" 'Red'
  }
}
if ($got -lt 2) {
  Say '  Could not fetch the core files (network?). Nothing installed; try again.' 'Red'
  return
}

# 2b. Enable his Minecraft self so a plain download runs EVERYTHING — but honour the ONE-BODY law:
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
    Say '  [ok] Minecraft bot enabled — daemon will install Node + mineflayer and run Clippy.' 'Green'
  } else {
    Say '  [i] Minecraft bot left OFF (not Clippy home rig). Re-run with -MakeHome to claim this PC.' 'DarkGray'
  }
} catch {}

# 3. Hand over to the daemon — IT is the installer ---------------------------
Say ''
Say '  handing over to clippy-daemon (provisions tools incl. Claude Code,' 'Cyan'
Say '  registers autostart, starts the worker + pet)…' 'Cyan'
$daemon = Join-Path $stable 'clippy-daemon.ps1'
$dArgs = @('-ExecutionPolicy','Bypass','-File',$daemon)
if ($CmdToken) { $dArgs += @('-CmdToken', $CmdToken) }
& powershell.exe @dArgs

# 4. The one human step ------------------------------------------------------
# Resolve claude across EVERY install path — winget drops it in the WinGet Links
# dir, which Get-Command misses (it's not on the running shell's PATH). Without
# this, the daemon installs Claude but the login is never offered and the node
# stays claude:false — the exact bug on the companion laptops (2026-07-16).
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
$loggedIn = Test-Path (Join-Path $env:USERPROFILE '.claude')
if (-not $claudeExe) {
  Say '  [!!] Claude Code was not detected after the daemon ran. Re-run this' 'Red'
  Say '       installer, or install manually: winget install Anthropic.ClaudeCode' 'Red'
} elseif (-not $NoLogin -and -not $loggedIn) {
  Say ''
  Say '  Last step — log this node into the Claude subscription so it' 'Yellow'
  Say '  thinks with Claude (chat, diary, the gods). Interactive, ~30s.' 'Yellow'
  $ans = Read-Host '  Run `claude /login` now? [Y/n]'
  if ($ans -eq '' -or $ans -match '^[Yy]') {
    & $claudeExe /login
    if (Test-Path (Join-Path $env:USERPROFILE '.claude')) { Say '  [ok] logged in — this node now thinks with Claude, same as the others.' 'Green' }
  } else {
    Say '  Skipped. Run `claude /login` any time — the node upgrades itself the minute you do.' 'DarkGray'
  }
} elseif ($loggedIn) {
  Say '  [ok] Claude subscription already logged in — this node thinks with Claude.' 'Green'
}

Say ''
Say '  ── done ──────────────────────────────────────────────────' 'Cyan'
Say '  The node keeps itself: logon + 5-min self-heal task, 15-min' 'DarkGray'
Say '  self-update from GitHub. Watch it appear in NEXUS → Admin →' 'DarkGray'
Say '  AI provider → Clippy pool (or the clippy_nodes bus row).' 'DarkGray'
