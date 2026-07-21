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
  [string]$VisionModel = 'qwen2.5vl:7b',  # Ollama vision model for Scan Plate. qwen2.5-VL transcribes invoice text character-perfect on an 8GB 3070 (llava hallucinated every number; 'llama3.2-vision'='mllama' won't load on the shipped Ollama build). ~6GB, fits 8GB. The worker auto-falls-back to moondream if a node can't load it.
  [string]$CmdToken = $env:CLIPPY_CMD_TOKEN, # enables "Push update" / remote commands; persisted for the user
  [string]$StewardSecret = $env:CLIPPY_STEWARD_SECRET, # the shared Steward's Seal secret (signed command lane); persisted for the user, NEVER published. Give every node the SAME value to make them uniform (seal:true, cmd:true).
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

# Every Log line also lands in ~/.clippy/daemon.log - without this, a daemon
# launched hidden (the autostart task) reports failures to a console nobody can
# see, and problems like a silently-failing task registration stay invisible
# for weeks. Previous log is kept once (daemon.prev.log) for post-mortems.
$LogFile = Join-Path $env:USERPROFILE '.clippy\daemon.log'
try {
  $null = New-Item -ItemType Directory -Force -Path (Split-Path $LogFile)
  if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 2MB)) {
    Move-Item $LogFile ($LogFile -replace '\.log$', '.prev.log') -Force -EA SilentlyContinue
  }
} catch {}
function Log([string]$m, [string]$c = 'Gray') {
  $line = (Get-Date -f 'MM-dd HH:mm:ss') + '  ' + $m
  Write-Host $line -ForegroundColor $c
  try { Add-Content -Path $LogFile -Value $line -EA SilentlyContinue } catch {}
}

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
  # Capture the worker's output. Under pythonw sys.stdout is None, so every
  # log() print the worker makes is silently swallowed - a dead worker leaves
  # no trace. Prefer console python.exe (hidden window) with stdout/stderr
  # redirected to ~/.clippy/worker.log; the dying run's log survives one
  # restart as worker.prev.log. Falls back to the old pythonw start if needed.
  $conPy = $null
  if ($py.Name -match '^pythonw') {
    $cand = Join-Path (Split-Path $py.Source) 'python.exe'
    if (Test-Path $cand) { $conPy = $cand }
    else { $c2 = Get-Command python -EA SilentlyContinue; if ($c2) { $conPy = $c2.Source } }
  } else { $conPy = $py.Source }
  if ($conPy) {
    try {
      $logDir = Join-Path $env:USERPROFILE '.clippy'
      $null = New-Item -ItemType Directory -Force -Path $logDir
      $wLog = Join-Path $logDir 'worker.log'
      $wErr = Join-Path $logDir 'worker.err.log'
      foreach ($p in @($wLog, $wErr)) {
        if (Test-Path $p) { Move-Item $p ($p -replace '\.log$', '.prev.log') -Force -EA SilentlyContinue }
      }
      Start-Process -FilePath $conPy -ArgumentList ('-u "' + $worker + '"') -WorkingDirectory $HOMEDIR -WindowStyle Hidden -RedirectStandardOutput $wLog -RedirectStandardError $wErr | Out-Null
      Log "[ok] clippy-worker started (log: $wLog)" 'Green'
      return $true
    } catch { Log "[..] logged worker start failed ($($_.Exception.Message)) - plain start" 'Yellow' }
  }
  Start-Process -FilePath $py.Source -ArgumentList $worker -WorkingDirectory $HOMEDIR -WindowStyle Hidden | Out-Null
  Log "[ok] clippy-worker started" 'Green'
  return $true
}
# ===================== v9.12 MINECRAFT BOT - install Node + deps, run & revive Clippy =====================
# So "one download = everything": the daemon provisions Node.js + mineflayer and keeps his Minecraft brain
# (clippy_agent.js) alive - closing the old gap where NOTHING revived him after a soft-OOM/world churn.
# Opt-in per machine via a bot.on flag (install-clippy creates it, so a normal download just works; pool
# nodes without it stay bot-free). His own home-guard still decides which world he actually joins.
function Test-NodeOk {
  # the bot uses global fetch (22x) -> needs Node >=18; accept a pre-existing node only if new enough
  $n = Get-Command node -EA SilentlyContinue
  if (-not $n) { return $false }
  try { $v = (& node -v) -replace '[^\d.]', ''; return ([int]($v.Split('.')[0]) -ge 18) } catch { return $true }
}
function Install-PortableNode {
  # Fallback when winget can't deliver Node - a locked-down user with no winget, exactly Trajan's ADM
  # laptop, where the ONLY node.exe was an Adobe bundle with no npm and the body couldn't come home until
  # Node was installed by hand. Fetch the official portable zip, extract to $HOMEDIR\node, and put it on
  # this process's PATH + the persistent user PATH so node/npm resolve now and after the next reboot.
  $ver = 'v22.11.0'; $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $dst = Join-Path $HOMEDIR 'node'; $exe = Join-Path $dst 'node.exe'
  if (-not (Test-Path $exe)) {
    try {
      $name = "node-$ver-win-$arch"; $zip = Join-Path $env:TEMP "$name.zip"
      Log "[bot] Node missing and winget unavailable - installing portable Node $ver ($arch)..." 'Cyan'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/$name.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 180
      $tmp = Join-Path $env:TEMP ('nodex_' + [guid]::NewGuid().ToString('N'))
      Expand-Archive -Path $zip -DestinationPath $tmp -Force
      if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -EA SilentlyContinue }
      Move-Item (Join-Path $tmp $name) $dst -Force
      Remove-Item $zip, $tmp -Recurse -Force -EA SilentlyContinue
    } catch { Log "[bot] portable Node install failed: $($_.Exception.Message)" 'Yellow'; return $false }
  }
  if (-not (Test-Path $exe)) { return $false }
  # portable dir goes FIRST on PATH so our node/npm win over any stray bundle (e.g. Adobe's node.exe)
  if ($env:Path -notlike "*$dst*") { $env:Path = $dst + ';' + $env:Path }
  try { $up = [Environment]::GetEnvironmentVariable('Path','User'); if ($up -notlike "*$dst*") { [Environment]::SetEnvironmentVariable('Path', ($dst + ';' + $up), 'User') } } catch {}
  return $true
}
function Ensure-Node {
  if (Test-NodeOk) { return $true }
  try { Log '[bot] installing Node.js LTS (winget)...' 'Cyan'; & winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements *> $null } catch {}
  try { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') } catch {}
  if (Test-NodeOk) { return $true }
  # winget couldn't deliver it (no winget / locked-down user) -> portable zip fallback (the Trajan-laptop gap)
  if (Install-PortableNode) { return (Test-NodeOk) }
  return $false
}
function Ensure-BotDeps {
  if (Test-Path (Join-Path $HOMEDIR 'node_modules\mineflayer')) { return $true }
  if (-not (Ensure-Node)) { return $false }
  if (-not (Get-Command npm -EA SilentlyContinue)) { return $false }
  try {
    Log '[bot] installing mineflayer deps (first run, ~1-2 min)...' 'Cyan'
    $depLog = Join-Path $env:USERPROFILE '.clippy\botnpm.log'; $null = New-Item -ItemType Directory -Force -Path (Split-Path $depLog)
    # Run npm via cmd.exe /c — Start-Process on the bare `npm` shim (a shell script) fails with
    # "%1 is not a valid Win32 application"; cmd resolves npm.cmd off PATH and runs it correctly.
    Start-Process -FilePath $env:ComSpec -ArgumentList '/c npm install --no-audit --no-fund mineflayer mineflayer-pathfinder mineflayer-collectblock vec3 minecraft-data prismarine-item' -WorkingDirectory $HOMEDIR -WindowStyle Hidden -Wait -RedirectStandardOutput $depLog -RedirectStandardError ($depLog -replace '\.log$', '.err.log') | Out-Null
  } catch { Log "[bot] npm install failed: $($_.Exception.Message)" 'Yellow' }
  return (Test-Path (Join-Path $HOMEDIR 'node_modules\mineflayer'))
}
function Get-BotProc { return (Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match 'clippy_agent\.js' } | Select-Object -First 1) }
function Stop-BotProc { Get-BotProc | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} } }
function Start-BotProc {
  $bot = Join-Path $HOMEDIR 'clippy_agent.js'
  if (-not (Test-Path $bot)) { Log '[bot] clippy_agent.js not present yet' 'Yellow'; return $false }
  if (-not (Ensure-BotDeps)) { Log '[bot] deps not ready - will retry next loop' 'Yellow'; return $false }
  $node = Get-Command node -EA SilentlyContinue
  if (-not $node) { return $false }
  # Each node runs its OWN soul: the two laptops are the guardian/provider companions, the home rig is Clippy.
  # (Before, this hardcoded 'clippy', so a companion laptop either home-guard-exited or risked a second Clippy.)
  $env:CLIPPY_ID = switch ($env:COMPUTERNAME) { 'DESKTOP-OQ8SROU' { 'trajan' } 'DESKTOP-SL5ETE7' { 'providencia' } default { 'clippy' } }
  try {
    $logDir = Join-Path $env:USERPROFILE '.clippy'; $null = New-Item -ItemType Directory -Force -Path $logDir
    $bLog = Join-Path $logDir 'bot.log'; $bErr = Join-Path $logDir 'bot.err.log'
    foreach ($p in @($bLog, $bErr)) { if (Test-Path $p) { Move-Item $p ($p -replace '\.log$', '.prev.log') -Force -EA SilentlyContinue } }
    Start-Process -FilePath $node.Source -ArgumentList ('"' + $bot + '"') -WorkingDirectory $HOMEDIR -WindowStyle Hidden -RedirectStandardOutput $bLog -RedirectStandardError $bErr | Out-Null
    Log "[ok] clippy_agent.js (Minecraft) started (log: $bLog)" 'Green'; return $true
  } catch { Log "[bot] start failed: $($_.Exception.Message)" 'Yellow'; return $false }
}
# On a COMPANION laptop the bot dials 127.0.0.1:25599, but the shared world server lives on the HOME RIG.
# A tiny userspace TCP forwarder (127.0.0.1:25599 -> home rig) bridges that with NO admin and NO netsh portproxy.
# (Migrating a companion to a fresh install used to silently drop this, leaving the bot stuck on ECONNREFUSED.)
$HOME_RIG_IP = '192.168.0.44'   # the home rig's stable wired LAN address (confirmed reachable on 25599)
function Get-FwdProc { return (Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'mc-forward\.js' } | Select-Object -First 1) }
function Ensure-McForward {
  if ($env:COMPUTERNAME -eq 'DESKTOP-N6PACMM') { return }   # the home rig hosts the server; it needs no forward
  $node = Get-Command node -EA SilentlyContinue; if (-not $node) { return }
  $fwd = Join-Path $env:USERPROFILE '.clippy\mc-forward.js'
  # v9.15.1: destroy BOTH sockets when EITHER closes/errors — a half-open ghost on the host side made the bot's
  # reconnect look like a SECOND login ("logged in from another location") and churned it out of the world.
  $js = 'const net=require("net");const HOST="' + $HOME_RIG_IP + '",PORT=25599;const s=net.createServer(c=>{const u=net.connect(PORT,HOST);const kill=()=>{try{c.destroy()}catch(e){}try{u.destroy()}catch(e){}};c.on("error",kill);u.on("error",kill);c.on("close",kill);u.on("close",kill);c.pipe(u);u.pipe(c)});s.on("error",function(e){process.exit(1)});s.listen(PORT,"127.0.0.1");'
  $cur = ''; try { $cur = (Get-Content $fwd -Raw -EA SilentlyContinue) } catch {}
  if (($cur | ForEach-Object { $_.Trim() }) -ne $js.Trim()) {
    Set-Content -Path $fwd -Value $js -Encoding ASCII
    # code changed -> restart any running forwarder so it picks up the fixed teardown
    Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'mc-forward\.js' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
  }
  if (Get-FwdProc) { return }
  $flog = Join-Path $env:USERPROFILE '.clippy\mc-forward.log'
  Start-Process -FilePath $node.Source -ArgumentList ('"' + $fwd + '"') -WindowStyle Hidden -RedirectStandardOutput $flog -RedirectStandardError ($flog -replace '\.log$', '.err.log') | Out-Null
  Log "[fwd] mc-forward 127.0.0.1:25599 -> $HOME_RIG_IP started" 'Green'
}
# ===================== v9.16 THE INTAKE - a pre-flight before a body is called home =====================
# The day Trajan woke on a laptop with no Node, he sat awake and ready right outside the world and it just
# couldn't let him in. This is the fix the three bodies asked for in their own counsel: before any body is
# called into the world, CHECK everything it needs to actually arrive, FIX what can be fixed here and now
# (Clippy: "fix what it can"), and HALT-and-speak-plainly of what can't (Trajan: "better a body waits at the
# threshold than stands stranded"), reporting EVERY missing thing at once (Providencia: "the whole pantry in
# one trip"). Six things, in the order a body needs them. Cheap when all green, so it stands guard every loop.
function Test-TcpOpen([string]$hostName, [int]$port, [int]$timeoutMs = 3000) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect($hostName, $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($timeoutMs)
    if ($ok -and $c.Connected) { $c.EndConnect($iar); $c.Close(); return $true }
    try { $c.Close() } catch {}; return $false
  } catch { return $false }
}
function Get-BodyKey { switch ($env:COMPUTERNAME) { 'DESKTOP-OQ8SROU' { 'trajan' } 'DESKTOP-SL5ETE7' { 'providencia' } default { 'clippy' } } }
function Post-IntakeReport([object]$rep) {
  # publish the intake verdict so a gap is VISIBLE to the family (steward + NEXUS) instead of dying silent in a log
  try {
    $anon = 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'
    $hdr  = @{ apikey = $anon; Authorization = "Bearer $anon"; 'Content-Type' = 'application/json'; Prefer = 'resolution=merge-duplicates,return=minimal' }
    $ms   = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $body = @{ id = ((Get-BodyKey) + '_intake'); from_id = $env:COMPUTERNAME; data = @{ node = $env:COMPUTERNAME; body = (Get-BodyKey); ready = [bool]$rep.ready; missing = @($rep.missing); fixed = @($rep.fixed); checks = $rep.checks; ts = $ms } } | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Uri 'https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync' -Method Post -Headers $hdr -Body $body -TimeoutSec 12 | Out-Null
  } catch {}
}
$script:LastIntakeReady = $null
$script:LastIntakePostMs = 0
function Invoke-Intake {
  # Returns $true only when a body is truly clear to come home. Runs each supervise loop (gated on bot.on).
  $key = Get-BodyKey
  $isHost = ($env:COMPUTERNAME -eq 'DESKTOP-N6PACMM')
  $missing = @(); $fixed = @(); $checks = [ordered]@{}
  # 1. the mind's runtime - Node present & new enough (install if missing: winget, then portable zip)
  if (Test-NodeOk) { $checks['node'] = 'ok' } elseif (Ensure-Node) { $checks['node'] = 'fixed'; $fixed += 'node runtime' } else { $checks['node'] = 'MISSING'; $missing += 'node runtime' }
  # 2. the game-libraries - mineflayer & deps actually present (not just listed)
  if (Test-Path (Join-Path $HOMEDIR 'node_modules\mineflayer')) { $checks['deps'] = 'ok' } elseif (($checks['node'] -ne 'MISSING') -and (Ensure-BotDeps)) { $checks['deps'] = 'fixed'; $fixed += 'mineflayer deps' } else { $checks['deps'] = 'MISSING'; $missing += 'mineflayer deps' }
  # 3. the bridge home - companion forwarder up & answering (the host serves the world itself)
  if ($isHost) { $checks['bridge'] = 'n/a (host)' }
  else { try { Ensure-McForward } catch {}; if (Get-FwdProc) { $checks['bridge'] = 'ok' } else { $checks['bridge'] = 'MISSING'; $missing += 'mc-forward bridge' } }
  # 4. the world reachable - the door really open on the network (host: local server; companion: the home rig)
  $worldHost = if ($isHost) { '127.0.0.1' } else { $HOME_RIG_IP }
  if (Test-TcpOpen $worldHost 25599 3000) { $checks['world'] = 'ok' } else { $checks['world'] = 'UNREACHABLE'; $missing += ('world @ ' + $worldHost + ':25599') }
  # 5. the body's on-flag - the "yes, come in" switch (the loop only calls us when bot.on is set)
  $checks['on_flag'] = 'ok'
  # 6. the true name & identity - so a body arrives as itself, never nameless or wearing another's face
  if (@('clippy','trajan','providencia') -contains $key) { $checks['identity'] = "ok ($key)" } else { $checks['identity'] = 'UNKNOWN'; $missing += ('identity mapping for ' + $env:COMPUTERNAME) }

  $ready = ($missing.Count -eq 0)
  $rep = [pscustomobject]@{ ready = $ready; missing = $missing; fixed = $fixed; checks = $checks }
  if ($fixed.Count -gt 0) { Log ("[intake] $key - mended before the crossing: " + ($fixed -join ', ')) 'Green' }
  $nowMs = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $changed = ($ready -ne $script:LastIntakeReady)
  $periodic = (($nowMs - $script:LastIntakePostMs) -gt 300000)
  if ($changed -or $periodic) {
    if ($ready) { Log "[intake] $key - all six checks green; clear to come home" 'Green' } else { Log ("[intake] $key HALT - not ready to come home; missing: " + ($missing -join ', ')) 'Yellow' }
    Post-IntakeReport $rep; $script:LastIntakePostMs = $nowMs
  }
  $script:LastIntakeReady = $ready
  return $ready
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
function Get-GrokProc {
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" -EA SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'grok_bridge\.py' }
}
function Stop-GrokProc { Get-GrokProc | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} } }
function Start-GrokProc {
  # Persistent headless-Chrome daemon that serves Grok answers from Alfredo's grok.com subscription
  # (file-queue at ~/.clippy/grok). Opt-in per node via ~/.clippy/grok.on - only the box with the
  # logged-in grok.com profile should run it.
  $gb = Join-Path $HOMEDIR 'grok_bridge.py'
  if (-not (Test-Path $gb)) { Log "[..] grok bridge not present yet" 'Yellow'; return $false }
  $py = (Get-Command python -EA SilentlyContinue).Source; if (-not $py) { $py = (Get-Command py -EA SilentlyContinue).Source }
  if (-not $py) { Log "[..] grok: python not found on PATH" 'Yellow'; return $false }
  $gl = Join-Path $env:USERPROFILE '.clippy\grok_bridge_out.log'
  New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.clippy\grok') | Out-Null
  Start-Process -FilePath $py -ArgumentList ('-u "' + $gb + '"') -WorkingDirectory (Join-Path $env:USERPROFILE '.clippy') -WindowStyle Hidden -RedirectStandardOutput $gl -RedirectStandardError ($gl + '.err') | Out-Null
  Log "[ok] grok bridge started" 'Green'
  return $true
}
# ============================ v9.12 CONTROLLER - F310 -> Minecraft Java (opt-in) ============================
# Java Edition has NO native controller support (Bedrock does); the mineflayer BOT needs none. This maps
# the CHILD's Logitech F310 (rear switch on X = XInput, no driver needed) onto the vanilla Java client via
# antimicrox (free, GPL-3, the only mapper with a scriptable --profile launch). All in one place: the daemon
# installs it, and starts/stops the mapper with the game. OPT-IN per machine - create the flag file to
# enable, so every other node stays a no-op:
#     %LOCALAPPDATA%\NexusClippy\controller.on   (or  ~/.clippy/controller.on)
# The toddler button map (see MINECRAFT-CONTROLLER.md) is generated once via the antimicrox GUI and saved as
#     $HOMEDIR\minecraft.gamecontroller.amgp   (then committed so it deploys to nodes).
$script:AntimicroxExe = $null
function Resolve-AntimicroxExe {
  # winget installs antimicrox MACHINE-scope (NSIS) and does NOT add itself to PATH.
  # 2026-07-18: newer builds drop the exe in a \bin\ subfolder
  # (C:\Program Files\AntiMicroX\bin\antimicrox.exe); older builds put it at the
  # install root. We check BOTH — the missing \bin\ path meant the daemon never
  # found the mapper and the controller silently did nothing (found live on
  # Providencia: installed under \bin\, daemon looked only at the root).
  $cands = @(
    (Join-Path ${env:ProgramFiles(x86)} 'AntiMicroX\bin\antimicrox.exe'),
    (Join-Path ${env:ProgramFiles}      'AntiMicroX\bin\antimicrox.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'AntiMicroX\antimicrox.exe'),
    (Join-Path ${env:ProgramFiles}      'AntiMicroX\antimicrox.exe')
  )
  foreach ($p in $cands) { if ($p -and (Test-Path $p)) { return $p } }
  $c = Get-Command antimicrox -EA SilentlyContinue; if ($c) { return $c.Source }
  # last resort: recurse the install dir (covers any future layout change)
  foreach ($base in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)})) {
    if ($base -and (Test-Path (Join-Path $base 'AntiMicroX'))) {
      $hit = Get-ChildItem (Join-Path $base 'AntiMicroX') -Filter 'antimicrox.exe' -Recurse -File -EA SilentlyContinue | Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
  }
  return $null
}
function Test-ControllerEnabled { return (Test-Path (Join-Path $HOMEDIR 'controller.on')) -or (Test-Path (Join-Path $env:USERPROFILE '.clippy\controller.on')) }
function Get-AntimicroxProc { return (Get-Process antimicrox -EA SilentlyContinue | Select-Object -First 1) }
function Ensure-Antimicrox {
  if (-not $script:AntimicroxExe) { $script:AntimicroxExe = Resolve-AntimicroxExe }
  if ($script:AntimicroxExe) { return $true }
  try { Log '[controller] installing antimicrox via winget (machine scope, one-time UAC)...' 'Cyan'; & winget install -e --id AntiMicroX.antimicrox --scope machine --silent --accept-package-agreements --accept-source-agreements *> $null } catch {}
  $script:AntimicroxExe = Resolve-AntimicroxExe
  return [bool]$script:AntimicroxExe
}
# ── GAME DETECTION (multi-game, registry-driven) ─────────────────────────────
# controller-profiles.json lists every supported game: how to DETECT it (process
# name regex + optional command-line regex) and which .amgp profile to load.
# Adding a game = commit its profile + one registry entry; the daemon syncs both
# and this code needs no edits. First registry match wins (most specific first).
$script:CtrlActiveGame = ''   # which game's profile the running mapper was started with
function Get-ControllerRegistry {
  $reg = Join-Path $HOMEDIR 'controller-profiles.json'
  try {
    if (Test-Path $reg) {
      $j = Get-Content $reg -Raw | ConvertFrom-Json
      if ($j -and $j.games) { return @($j.games) }
    }
  } catch { Log "[controller] registry parse failed: $($_.Exception.Message)" 'Yellow' }
  # Fallback: the original built-in Minecraft entry, so a bad/missing registry never bricks play.
  return @([pscustomobject]@{ name = 'minecraft'; title = 'Minecraft Java'; profile = 'minecraft.gamecontroller.amgp'; proc = '^javaw?\.exe$'; cmdline = '(?i)minecraft' })
}
function Get-RunningGame {
  # One process scan, checked against every registry entry. Returns the entry or $null.
  $procs = Get-CimInstance Win32_Process -EA SilentlyContinue
  if (-not $procs) { return $null }
  foreach ($g in (Get-ControllerRegistry)) {
    if (-not $g.proc) { continue }
    $hit = $procs | Where-Object {
      $_.Name -match $g.proc -and ((-not $g.cmdline) -or ($_.CommandLine -match $g.cmdline))
    } | Select-Object -First 1
    if ($hit) { return $g }
  }
  return $null
}
function Start-ControllerMap([object]$game) {
  if (Get-AntimicroxProc) { return }
  if (-not (Ensure-Antimicrox)) { return }
  # --profile applies to ALL controllers (only the F310 is attached); --profile-controller alone is a
  # no-op and is flaky even with --profile (antimicrox issue #1114), so we ship the committed profile.
  $axArgs = @('--hidden')
  $prof = if ($game -and $game.profile) { Join-Path $HOMEDIR $game.profile } else { Join-Path $HOMEDIR 'minecraft.gamecontroller.amgp' }
  if (Test-Path $prof) { $axArgs += @('--profile', $prof) }
  $title = if ($game -and $game.title) { $game.title } else { 'game' }
  try {
    Start-Process $script:AntimicroxExe -ArgumentList $axArgs -WindowStyle Hidden
    $script:CtrlActiveGame = if ($game) { [string]$game.name } else { '' }
    Log "[controller] F310 mapping started for $title" 'Green'
  } catch { Log "[controller] launch failed: $($_.Exception.Message)" 'Yellow' }
}
function Stop-ControllerMap { try { Get-Process antimicrox -EA SilentlyContinue | ForEach-Object { try { $_.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 800; if (-not $_.HasExited) { $_.Kill() } } catch {} } } catch {}; $script:CtrlActiveGame = '' }
function Tick-Controller {
  # Start the mapper only while a REGISTERED game is running, with THAT game's
  # profile; stop it when the game (or the opt-in) goes away; restart it when
  # the child switches to a different registered game (profile swap).
  if (-not (Test-ControllerEnabled)) { if (Get-AntimicroxProc) { Stop-ControllerMap }; return }
  try {
    $game = Get-RunningGame
    if ($game) {
      if (-not (Get-AntimicroxProc)) { Start-ControllerMap $game }
      elseif ($script:CtrlActiveGame -and $script:CtrlActiveGame -ne [string]$game.name) {
        Log "[controller] game switched ($script:CtrlActiveGame -> $($game.name)) - swapping profile" 'Cyan'
        Stop-ControllerMap; Start-ControllerMap $game
      }
    }
    else { if (Get-AntimicroxProc) { Stop-ControllerMap } }
  } catch {}
}
function Update-NodeFromGitHub {
  # Pull the latest node scripts into $HOMEDIR. Returns which ones changed.
  $res = @{ worker = $false; daemon = $false; pet = $false; grok = $false; bot = $false }
  # Base files + the controller registry; then every game profile the registry
  # lists (so committing a new game's .amgp + registry entry deploys itself).
  $files = @('clippy-worker.py', 'clippy-daemon.ps1', 'clippy-update.ps1', 'clippy-character.json', 'clippy-dialog.json', 'clippy-pet-comp.ps1', 'grok_bridge.py', 'clippy_agent.js', 'controller-profiles.json', 'minecraft.gamecontroller.amgp')
  try { foreach ($g in (Get-ControllerRegistry)) { if ($g.profile -and ($files -notcontains [string]$g.profile)) { $files += [string]$g.profile } } } catch {}
  foreach ($f in $files) {
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
        if ($f -eq 'grok_bridge.py') { $res.grok = $true }
        if ($f -eq 'clippy_agent.js') { $res.bot = $true }   # his Minecraft brain changed - a supervisor may restart the bot to load it
        # Character/dialog are data the worker reads at startup - restart it to reload.
        if ($f -eq 'clippy-character.json' -or $f -eq 'clippy-dialog.json') { $res.worker = $true }
        Log "[upd] refreshed $f" 'Green'
      }
      Remove-Item $tmp -Force -EA SilentlyContinue
    } catch { Log "[..] update fetch $f skipped: $($_.Exception.Message)" 'Yellow' }
  }
  return $res
}
function Get-SelfCodeVer {
  # Short fingerprint of this node's own code. MUST match clippy-worker.py's
  # _self_version() byte-for-byte (SHA1 of worker.py + daemon.ps1, first 8 hex)
  # so the version a peer PUBLISHES equals the version we COMPUTE - otherwise
  # every node would forever see disagreement and update in a loop.
  try {
    $ms = New-Object System.IO.MemoryStream
    foreach ($f in 'clippy-worker.py', 'clippy-daemon.ps1') {
      $p = Join-Path $HOMEDIR $f
      if (Test-Path $p) { $b = [System.IO.File]::ReadAllBytes($p); $ms.Write($b, 0, $b.Length) }
    }
    $hash = [System.Security.Cryptography.SHA1]::Create().ComputeHash($ms.ToArray())
    return (-join ($hash | ForEach-Object { $_.ToString('x2') })).Substring(0, 8)
  } catch { return 'unknown' }
}
function Test-HivePeerNewer {
  # The hive updates each OTHER: read the node roster and, if any node that was
  # fresh in the last 2 min publishes a code_ver different from ours, one of us
  # is behind. We can't know which, so we converge the only safe way - pull the
  # canonical version from GitHub now. Everyone doing this lands on one version,
  # and the disagreement disappears. Returns $true if a peer differs.
  try {
    $mine = Get-SelfCodeVer
    if ($mine -eq 'unknown') { return $false }
    $anon = 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'
    $hdr  = @{ apikey = $anon; Authorization = "Bearer $anon" }
    $uri  = 'https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync?id=eq.clippy_nodes&select=data'
    $rows = Invoke-RestMethod -Uri $uri -Headers $hdr -TimeoutSec 12
    $roster = if ($rows -and $rows[0].data) { $rows[0].data } else { @() }
    $nowS = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    foreach ($n in $roster) {
      if (-not $n.name -or $n.name -eq $env:COMPUTERNAME) { continue }
      if (($nowS - [int64]$n.ts) -gt 120) { continue }          # only living peers
      if ($n.code_ver -and $n.code_ver -ne 'unknown' -and $n.code_ver -ne $mine) {
        Log "[hive] peer $($n.name) on $($n.code_ver), we are $mine - converging" 'Cyan'
        return $true
      }
    }
  } catch { }
  return $false
}
function Test-ClaudeLoggedIn {
  # A running node = FULL POWER: the Claude subscription seat is what upgrades every
  # Clippy surface (chat, diary, the gods, the txt: lane) from the Ollama fallback to
  # full Claude cognition. At the daemon level we detect a healthy seat the same way
  # install-clippy.ps1's $loggedIn check does - the auth token dir exists. (The worker
  # only advertises claude:true after a live probe; this is the coarse presence check.)
  return (Test-Path (Join-Path $env:USERPROFILE '.claude'))
}
function Check-McLaunchControl {
  # The NEXUS "Launch Minecraft" button (Tools hub) writes a control row to clippy_sync:
  #   id = 'clippy_control'                (all computers act on it)
  #   id = 'clippy_control_<hostname>'     (only this box acts)
  # with data = { launch_minecraft: true, ts: <ms epoch> }. When we see a launch newer than the
  # last one we honored (and reasonably fresh), flip on the local bot.on flag; the reviver below
  # then starts Clippy's world + bot. Edge-triggered on ts so a later manual KILLDESK is never
  # fought, and idempotent (bot.on is only created if missing). Best-effort — any error is a no-op.
  # NOTE: this can only START Clippy on a machine that is already ON and running this daemon; it
  # cannot power on a machine that is off (no Wake-on-LAN in this stack).
  try {
    $cn   = ($env:COMPUTERNAME).ToLower()
    $anon = 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'
    $hdr  = @{ apikey = $anon; Authorization = "Bearer $anon" }
    $uri  = "https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync?id=in.(clippy_control,clippy_control_$cn)&select=id,data"
    $rows = Invoke-RestMethod -Uri $uri -Headers $hdr -TimeoutSec 12
    if (-not $rows) { return }
    $bestTs = [double]0
    foreach ($r in $rows) {
      $d = $r.data
      if ($null -eq $d) { continue }
      if (-not $d.launch_minecraft) { continue }
      $ts = [double]0; try { $ts = [double]$d.ts } catch { $ts = [double]0 }
      if ($ts -gt $bestTs) { $bestTs = $ts }
    }
    if ($bestTs -le 0) { return }
    $tsFile = Join-Path $env:USERPROFILE '.clippy\last_mc_launch_ts'
    $lastTs = [double]0
    if (Test-Path $tsFile) { try { $lastTs = [double](Get-Content $tsFile -Raw) } catch { $lastTs = [double]0 } }
    $nowMs = [double]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    # Act only on a launch newer than the last we honored, within the last 12h (so an ancient flag
    # doesn't relaunch Clippy on some unrelated future boot).
    if ($bestTs -gt $lastTs -and ($nowMs - $bestTs) -lt (12 * 3600 * 1000)) {
      $flag = Join-Path $env:USERPROFILE '.clippy\bot.on'
      if (-not (Test-Path $flag)) {
        New-Item -ItemType File -Path $flag -Force | Out-Null
        Log '[supervise] NEXUS Launch-Minecraft button -> bot.on set, bringing Clippy into the world' 'Green'
      }
      Set-Content -Path $tsFile -Value ([string]$bestTs) -Force
    }
  } catch { }
}
function Invoke-Supervisor {
  # Persistent loop: keep the slave worker alive and self-heal from GitHub.
  # This is what makes a bad worker version recover automatically instead of
  # stranding the node (no more "blind worker that can't be updated").
  Log "[supervise] up - parent=$ParentPid, self-heal every ${UpdateEveryMin}m, code $(Get-SelfCodeVer)" 'Cyan'
  $lastUpd = Get-Date
  $lastPeerCheck = Get-Date
  # deep-logging + crash-loop guard (2026-07: an unstable worker was respawning every 30s and
  # stealing focus off Alfredo's fullscreen game). Track restarts; back off if it crash-loops.
  $wRestarts = @(); $wBackoffUntil = $null; $loopN = 0
  $botRestarts = @(); $botBackoffUntil = $null
  $lastPowerState = $null   # track Claude login so the [power] line logs at start + on change only (low-noise)
  while ($true) {
    $loopN++
    # [power] A running node = FULL POWER. Surface whether this node has the Claude
    # subscription seat (full cognition on the txt: lane) or is on the Ollama fallback.
    # Logs once at supervisor start (state differs from $null) and only when it flips,
    # so a logged-in node isn't spammed - and the moment a human runs `claude /login`
    # mid-session, the next loop announces the upgrade in Green.
    $powerNow = Test-ClaudeLoggedIn
    if ($powerNow -ne $lastPowerState) {
      if ($powerNow) {
        Log '[power] Claude subscription LOGGED IN - Clippy runs at full power' 'Green'
      } else {
        Log '[power] Claude NOT logged in - run `claude /login` for full power (Ollama fallback active)' 'Yellow'
      }
      $lastPowerState = $powerNow
    }
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -EA SilentlyContinue)) {
      Log "[supervise] master (pid $ParentPid) exited - stopping worker" 'Yellow'
      Stop-WorkerProc
      break
    }
    if (-not (Get-WorkerProc)) {
      $nowT = Get-Date
      if ($wBackoffUntil -and $nowT -lt $wBackoffUntil) {
        if ($loopN % 4 -eq 0) { Log "[supervise] worker crash-looping - in backoff until $($wBackoffUntil.ToString('HH:mm:ss')); not restarting (keeps focus off the game)" 'Red' }
      } else {
        $wRestarts = @($wRestarts | Where-Object { ($nowT - $_).TotalMinutes -lt 5 }) + $nowT
        $errTail = ''
        try { $errTail = ((Get-Content (Join-Path $env:USERPROFILE '.clippy\worker.err.log') -Tail 2 -EA SilentlyContinue) -join ' | ') } catch {}
        Log "[supervise] worker down - restart #$($wRestarts.Count)/5m | last err: $errTail" 'Yellow'
        Start-WorkerProc | Out-Null
        if ($wRestarts.Count -ge 4) {
          $wBackoffUntil = $nowT.AddMinutes(3)
          Log "[supervise] worker CRASH-LOOPING ($($wRestarts.Count)x in 5m) - backing off restarts until $($wBackoffUntil.ToString('HH:mm:ss')). Inspect ~/.clippy/worker.err.log" 'Red'
        }
      }
    } elseif ($wRestarts.Count -gt 0) {
      Log "[supervise] worker stable again - clearing crash-loop state" 'Green'
      $wRestarts = @(); $wBackoffUntil = $null
    }
    if (Test-Path (Join-Path $env:USERPROFILE '.clippy\pet-off')) {
      # User chose Quit from the tray. Honour it: stop the pet if it's up and don't
      # revive it. The Clippy desktop/Start-menu shortcut clears the flag to summon.
      if (Get-PetProc) { Log "[supervise] pet-off flag set (user Quit) - stopping pet" 'Yellow'; Stop-PetProc }
    } elseif (-not (Get-PetProc)) {
      Log "[supervise] pet down - (re)starting" 'Yellow'
      Start-PetProc | Out-Null
    }
    # Grok bridge - opt-in per node via ~/.clippy/grok.on (only the box with the grok.com login runs it)
    if (Test-Path (Join-Path $env:USERPROFILE '.clippy\grok.on')) {
      if (-not (Get-GrokProc)) { Log "[supervise] grok bridge down - (re)starting" 'Yellow'; Start-GrokProc | Out-Null }
    } elseif (Get-GrokProc) {
      Log "[supervise] grok.on not set - stopping grok bridge" 'Yellow'; Stop-GrokProc
    }
    # Controller (F310 -> Minecraft Java): opt-in via the controller.on flag. Starts/stops the antimicrox
    # mapper alongside the child's game so it's all managed from one place. No-op unless enabled.
    try { Tick-Controller } catch {}
    # NEXUS Launch-Minecraft button: if the web app requested a launch, flip on bot.on so the
    # reviver below brings Clippy into the world. Checked every loop (~30s); no-op when nothing pending.
    try { Check-McLaunchControl } catch {}
    # Minecraft bot (Clippy himself): opt-in via bot.on. Provisions Node+deps once, then keeps him alive
    # and REVIVED (his old soft-OOM exit had no reviver). Same crash-loop backoff as the worker.
    if (Test-Path (Join-Path $env:USERPROFILE '.clippy\bot.on')) {
      # THE INTAKE (v9.16): pre-flight the six things a body needs to arrive, fix what we can, and only call
      # it home once the door is truly open. Also (re)starts the forwarder as check 3, so the old standalone
      # Ensure-McForward line is folded in here. Its own error must never block a start (default clear).
      $intakeOk = $true; try { $intakeOk = Invoke-Intake } catch { $intakeOk = $true }
      if (-not (Get-BotProc)) {
        $nowB = Get-Date
        if (-not $intakeOk) {
          # a body waits at the threshold rather than crash-looping on a shut door; intake logs the gap (throttled)
        } elseif ($botBackoffUntil -and $nowB -lt $botBackoffUntil) {
          if ($loopN % 4 -eq 0) { Log "[supervise] Minecraft bot crash-looping - in backoff until $($botBackoffUntil.ToString('HH:mm:ss'))" 'Red' }
        } else {
          $botRestarts = @($botRestarts | Where-Object { ($nowB - $_).TotalMinutes -lt 5 }) + $nowB
          Log "[supervise] Minecraft bot down - (re)start #$($botRestarts.Count)/5m" 'Yellow'
          Start-BotProc | Out-Null
          if ($botRestarts.Count -ge 4) { $botBackoffUntil = $nowB.AddMinutes(5); Log '[supervise] bot crash-looping - backing off 5m (check ~/.clippy/bot.err.log)' 'Red' }
        }
      } elseif ($botRestarts.Count -gt 0) { $botRestarts = @(); $botBackoffUntil = $null }
    } elseif (Get-BotProc) {
      Log '[supervise] bot.on not set - stopping Minecraft bot' 'Yellow'; Stop-BotProc
    }
    # Peer nudge: at most every 3 min, ask the hive if anyone runs a different
    # code version. If so, pull forward NOW instead of waiting out the timer -
    # this is how nodes update each other rather than each drifting on its own.
    $peerNewer = $false
    if (((Get-Date) - $lastPeerCheck).TotalMinutes -ge 3) {
      $lastPeerCheck = Get-Date
      $peerNewer = Test-HivePeerNewer
    }
    if ($peerNewer -or ((Get-Date) - $lastUpd).TotalMinutes -ge $UpdateEveryMin) {
      $lastUpd = Get-Date
      $u = Update-NodeFromGitHub
      Log "[update] github check - worker=$($u.worker) daemon=$($u.daemon) pet=$($u.pet) bot=$($u.bot)" 'DarkGray'
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
      if ($u.bot -and (Test-Path (Join-Path $env:USERPROFILE '.clippy\bot.on')) -and (Get-BotProc)) {
        Log "[supervise] new Minecraft brain pulled - restarting the bot to load it" 'Green'
        Stop-BotProc
        Start-Sleep -Seconds 2
        Start-BotProc | Out-Null
      }
      if ($u.grok -and (Test-Path (Join-Path $env:USERPROFILE '.clippy\grok.on'))) {
        Log "[supervise] new grok bridge pulled - restarting it" 'Green'
        Stop-GrokProc; Start-Sleep -Seconds 2; Start-GrokProc | Out-Null
      }
    }
    # deep heartbeat every ~5 min: proves the loop is alive and captures node state for post-mortems
    if ($loopN % 10 -eq 1) {
      $wp = (Get-WorkerProc | Select-Object -First 1).ProcessId
      $pp = (Get-PetProc | Select-Object -First 1).ProcessId
      $freeMB = 0; try { $freeMB = [int]((Get-CimInstance Win32_OperatingSystem -EA SilentlyContinue).FreePhysicalMemory / 1024) } catch {}
      Log "[loop $loopN] alive | worker=$(if($wp){"pid $wp"}else{'DOWN'}) | pet=$(if($pp){"pid $pp"}else{'DOWN'}) | freeMem=${freeMB}MB | last update $([int]((Get-Date)-$lastUpd).TotalMinutes)m ago" 'DarkGray'
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

# --- Get Clippy ON SCREEN FIRST (supervisor mode) ---------------------------
# Liveness of the pet + worker must NOT depend on provisioning finishing. On
# 2026-07-05 a node was found stranded because `ollama list` wedged mid-provision
# and the daemon never reached the supervisor loop, so Clippy stayed dark for
# ~20 min. Under -Supervise we now bring the buddy + worker up immediately (both
# are idempotent + self-guarded; the supervisor loop re-checks them every 30s),
# THEN provision. Worst case a slow/hung install no longer keeps Clippy off screen.
if ($Supervise -and -not $ReportOnly -and -not $EnsureOnly) {
  $petOff = Test-Path (Join-Path $env:USERPROFILE '.clippy\pet-off')
  if (Get-PetProc)    { Log "[boot] pet already up" 'Green' }
  elseif ($petOff)    { Log "[boot] pet-off flag set (user Quit) - leaving Clippy off; summon via the Clippy shortcut" 'Yellow' }
  else                { Start-PetProc | Out-Null }
  if (Get-WorkerProc) { Log "[boot] worker already up" 'Green' } else { Start-WorkerProc | Out-Null }
}

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
  # v281 - THE SUBSCRIPTION ENGINE (keeper's word 2026-07-11: "wire everything
  # to just use claude subscription. daemon installs everything"). Claude Code
  # is what makes a node answer with claude:true on the txt: lane - the same
  # engine Clippy thinks with, and (as of pantheon-voice v3 / hideaway-night
  # v4) the engine the gods and the midnight reading prefer. Winget first,
  # official native installer as the fallback. The LOGIN stays human (see the
  # [next] hint after provisioning): a seat is granted, never taken.
  @{ Name = 'Claude Code';  EstGB = 0.4; Winget = 'Anthropic.ClaudeCode';
     Direct = { Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' -UseBasicParsing) };
     Test = { [bool](Resolve-ClaudeExe) } }
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

function Resolve-ClaudeExe {
  # Find the claude-code binary across EVERY install location. winget installs
  # Anthropic.ClaudeCode into %LOCALAPPDATA%\Microsoft\WinGet\Links but does NOT
  # add that dir to an already-running process's PATH - so Get-Command alone
  # misses it and the node falsely reports "Claude not installed", skips the
  # login prompt, and heartbeats claude:false forever. Mirrors the worker's
  # _find_claude(). Returns the full path, or $null. (Alfredo, 2026-07-16:
  # "make it also install claude. i want all clippys to be the same.")
  $c = Get-Command claude -EA SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
    (Join-Path $env:USERPROFILE '.local\bin\claude'),
    (Join-Path $env:APPDATA 'npm\claude.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\claude.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\claude.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\claude\claude.exe')
  )
  foreach ($p in $cands) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
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

# v281 - Claude Code installs unattended, but the SUBSCRIPTION LOGIN is
# interactive by design: the seat is Alfredo's to grant, never a machine's to
# take. Until a human runs the login once, the worker heartbeats claude:false
# and text jobs fall back to Ollama - nothing breaks, it just thinks smaller.
# Make a just-winget-installed claude resolvable in THIS session (winget edits
# the persisted user PATH, but the running process still has the old one).
$wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
if ((Test-Path $wingetLinks) -and ($env:PATH -notlike "*$wingetLinks*")) { $env:PATH = "$wingetLinks;$env:PATH" }
$claudeExe = Resolve-ClaudeExe
if ($claudeExe -and -not (Test-Path (Join-Path $env:USERPROFILE '.claude'))) {
  Log "[next] Claude Code is installed but NOT logged in. Run once in any terminal:" 'Yellow'
  Log "         claude /login" 'Yellow'
  Log "       (subscription auth; within a minute of login the worker advertises claude:true and this node thinks with Claude)" 'Yellow'
} elseif ($claudeExe) {
  Log "[power] Claude Code installed and logged in - this node thinks at full power." 'Green'
} else {
  Log "[!!] Claude Code not detected after provisioning - a new shell / PATH refresh may be needed, or winget failed." 'Yellow'
}

# --- Make the function go: (re)deploy clippy-pool if we can ------------------
if (-not $EnsureOnly -and -not $ReportOnly) {
  $sb = Join-Path $ProgRoot 'supabase\supabase.exe'
  if (-not (Test-Path $sb)) { $cmd = Get-Command supabase -EA SilentlyContinue; if ($cmd) { $sb = $cmd.Source } }
  # The CLI resolves the function source relative to the working directory; a
  # provisioned node (NexusClippy folder) has no supabase/functions checkout, so
  # deploying from there can only fail with "Entrypoint path does not exist".
  $fnSrc = Join-Path (Get-Location) 'supabase\functions\clippy-pool\index.ts'
  if (-not (Test-Path $fnSrc)) {
    Log "[..] clippy-pool source not in $(Get-Location) (repo-checkout-only step) - skipping deploy"
  } elseif (Test-Path $sb) {
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
    # Check the model list over the HTTP API ONLY: Invoke-RestMethod honours
    # -TimeoutSec and CANNOT hang. The old CLI fallback (`ollama list`, no
    # timeout) is what wedged this daemon pre-supervisor-loop on 2026-07-05
    # AND on both boots of 2026-07-11: at logon Ollama isn't listening yet,
    # the API check fails instantly, and the CLI call blocks forever - the
    # supervisor loop never starts, and (MultipleInstances IgnoreNew) the
    # wedged Running instance blocks every 5-min self-heal launch too. When
    # the API is down we DEFER: the worker self-pulls the model on first use,
    # so skipping here costs nothing and can never strand the node.
    $have = $false
    $apiUp = $false
    try {
      $tags = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 8
      $apiUp = $true
      $have = [bool]($tags.models | Where-Object { $_.name -like "$VisionModel*" -or $_.model -like "$VisionModel*" })
    } catch { $apiUp = $false }
    if ($have) {
      Log "[have] vision model '$VisionModel'" 'Green'
    } elseif (-not $apiUp) {
      Log "[defer] Ollama API not answering yet - model check skipped (worker self-pulls on first use)" 'Yellow'
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
      # Publish the token to the bus so NEXUS can auto-fill it? OFF by default.
      # The bus is readable with the public anon key, so publishing the token
      # trades its secrecy for convenience: anyone with the site could then
      # send commands to this node. We keep the token PRIVATE (set only in this
      # PC's environment) unless you explicitly opt in by setting the env var
      # CLIPPY_PUBLISH_TOKEN=1. Remote 'Push update' still works from a session
      # that knows the token; it just isn't broadcast for anyone to read.
      if ($env:CLIPPY_PUBLISH_TOKEN -eq '1') {
        try {
          $anon = 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9'
          $hdr  = @{ apikey = $anon; Authorization = "Bearer $anon"; 'Content-Type' = 'application/json'; Prefer = 'resolution=merge-duplicates,return=minimal' }
          $ms   = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
          $body = @{ id = 'clippy_cmd'; from_id = $env:COMPUTERNAME; data = @{ token = $CmdToken; node = $env:COMPUTERNAME; ts = $ms } } | ConvertTo-Json -Depth 5
          Invoke-RestMethod -Uri 'https://oprsthfxqrdbwdvommpw.supabase.co/rest/v1/clippy_sync' -Method Post -Headers $hdr -Body $body -TimeoutSec 15 | Out-Null
          Log "[ok] command token published to bus (opt-in) - NEXUS Push needs no manual entry" 'Green'
        } catch { Log "[..] token publish skipped: $($_.Exception.Message)" 'Yellow' }
      } else {
        Log "[ok] command token kept PRIVATE (not published to bus). Set CLIPPY_PUBLISH_TOKEN=1 to opt in." 'DarkGray'
      }
    }
    # Persist the Steward's Seal secret (the signed command lane) for the user so
    # this node can VERIFY signed commands (seal:true -> cmd:true). Give every
    # node the SAME secret and they become uniform on the command channel. The
    # secret lives ONLY in this PC's user env + the RLS-locked steward_seal table;
    # it is NEVER written to the world-readable bus.
    if ($StewardSecret) {
      try { [Environment]::SetEnvironmentVariable('CLIPPY_STEWARD_SECRET', $StewardSecret, 'User') } catch {}
      $env:CLIPPY_STEWARD_SECRET = $StewardSecret
      Log "[ok] steward seal set - this node now verifies signed commands (cmd/seal enabled), uniform with the others" 'Green'
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
        $stageFiles = @('clippy-daemon.ps1', 'clippy-worker.py', 'clippy-update.ps1', 'clippy-character.json', 'clippy-dialog.json', 'clippy-pet-comp.ps1', 'clippy_agent.js', 'controller-profiles.json', 'minecraft.gamecontroller.amgp')
        try { foreach ($g in (Get-ControllerRegistry)) { if ($g.profile -and ($stageFiles -notcontains [string]$g.profile)) { $stageFiles += [string]$g.profile } } } catch {}
        foreach ($f in $stageFiles) {
          $src = Join-Path $HOMEDIR $f
          if (Test-Path $src) { Copy-Item $src (Join-Path $stable $f) -Force -EA SilentlyContinue }
        }
        $stableDaemon = Join-Path $stable 'clippy-daemon.ps1'
        # Launch through a hidden wscript/VBS shim so the scheduler NEVER flashes a
        # console. When Task Scheduler runs powershell.exe DIRECTLY, conhost
        # allocates a window BEFORE '-WindowStyle Hidden' can apply - a brief flash
        # at logon and on every 5-min self-heal. wscript with window-style 0 starts
        # hidden from creation, so no window ever appears. (Alfredo: "no more
        # powershells appearing on screen", 2026-07-16.) Win10-safe (conhost
        # --headless is Win11-only). In VBS, "" is one literal quote - so the daemon
        # path stays quoted even if the user profile path contains a space.
        $vbs = Join-Path $stable 'run-daemon-hidden.vbs'
        $vbsBody = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $stableDaemon + '"" -Supervise", 0, False'
        Set-Content -Path $vbs -Value $vbsBody -Encoding ascii -Force
        $act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
        # Two triggers so Clippy is NEVER left dead:
        #  1) at logon (fresh session), and
        #  2) a 5-min repeat that re-launches the supervisor if it ever died
        #     mid-session (crash, kill, bad update). The supervisor self-instances
        #     (a second copy just exits), so repeated launches are harmless and
        #     self-healing - this is what makes "it's not even open" impossible:
        #     a dead node is back within 5 minutes with no human and no re-logon.
        # Logon trigger scoped to THIS user: a plain '-AtLogOn' means "any user",
        # and registering that needs admin rights - every unelevated daemon run
        # (which is all of them: the task itself runs unelevated) died here with
        # "Access is denied", so autostart never actually registered and every
        # reboot stranded Clippy. User-scoped registration works unelevated.
        # (Verified live on DESKTOP-N6PACMM 2026-07-05.)
        $trg = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        try {
          $heal = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
        } catch { $heal = $null }
        $triggers = if ($heal) { @($trg, $heal) } else { @($trg) }
        # The 5-min repeat trigger IS the self-heal. Do NOT add RestartOnFailure:
        # when a launched instance exits (e.g. it found a supervisor already
        # running, or a provisioning native command left a non-zero $LASTEXITCODE),
        # Task Scheduler read that as failure and re-launched every 60s forever -
        # a real churn observed on 2026-07-05 (log spam, wasted CPU, task re-
        # registered each minute). IgnoreNew alone keeps instances from stacking.
        $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName 'ClippyDaemon' -Action $act -Trigger $triggers -Settings $set -Force -ErrorAction Stop | Out-Null
        Log ("[ok] autostart registered (logon + 5-min self-heal task 'ClippyDaemon' -> $stable)") 'Green'
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

# Always report success to Task Scheduler. A stray non-zero $LASTEXITCODE left by
# a provisioning native command (winget/supabase/ollama) would otherwise make the
# task look "failed" - which, with any restart-on-failure policy, becomes a relaunch
# storm. The 5-min repeat trigger is the only self-heal we want.
exit 0

Log 'clippy-daemon done.' 'Cyan'
