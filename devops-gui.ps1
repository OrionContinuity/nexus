<#
devops-gui.ps1 - NEXUS DevOps control panel (GitHub + Supabase) with buttons instead of CLI typing.
Quick read-only actions print in the embedded log; interactive/long actions (logins, deploy, push,
upload) open a live console window so the GUI never freezes and you can paste tokens / do browser auth.
CLIs were installed by Claude: supabase + gh under %LOCALAPPDATA%\Programs\. git is on PATH.

  powershell -ExecutionPolicy Bypass -File devops-gui.ps1
  powershell -ExecutionPolicy Bypass -File devops-gui.ps1 -SelfTest   # build only, no window
#>
param([switch]$SelfTest)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$SB   = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe"
$GHCLI   = "$env:LOCALAPPDATA\Programs\ghcli\bin\gh.exe"
$HOMEDIR = $PSScriptRoot
$REF  = "oprsthfxqrdbwdvommpw"
$DASH = "https://supabase.com/dashboard/project/$REF"

$PAL = @{ bg=[Drawing.Color]::FromArgb(16,18,24); panel=[Drawing.Color]::FromArgb(26,30,38); ink=[Drawing.Color]::White
  sub=[Drawing.Color]::FromArgb(150,160,172); gold=[Drawing.Color]::FromArgb(230,193,112); aqua=[Drawing.Color]::FromArgb(74,184,232)
  field=[Drawing.Color]::FromArgb(12,16,22); ok=[Drawing.Color]::FromArgb(70,200,120); warn=[Drawing.Color]::FromArgb(232,180,60) }

$form = New-Object Windows.Forms.Form
$form.Text='NEXUS DevOps - GitHub + Supabase'; $form.Size=New-Object Drawing.Size(760,660)
$form.StartPosition='CenterScreen'; $form.BackColor=$PAL.bg; $form.ForeColor=$PAL.ink; $form.Font=New-Object Drawing.Font('Segoe UI',9)

$status = New-Object Windows.Forms.Label
$status.Location='14,10'; $status.Size='720,20'; $status.ForeColor=$PAL.sub
$form.Controls.Add($status)

$log = New-Object Windows.Forms.TextBox
$log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'; $log.WordWrap=$false
$log.Location='14,372'; $log.Size='726,210'; $log.BackColor=$PAL.field; $log.ForeColor=[Drawing.Color]::FromArgb(190,225,210)
$log.Font=New-Object Drawing.Font('Consolas',9); $form.Controls.Add($log)
function Log([string]$t){ $log.AppendText(((Get-Date -f 'HH:mm:ss')+'  '+$t+"`r`n")) }

function RunQuiet([string]$exe,[string[]]$cargs,[string]$cwd=$HOMEDIR){
  Log("> "+(Split-Path $exe -Leaf)+" "+($cargs -join ' '))
  try {
    $psi=New-Object Diagnostics.ProcessStartInfo; $psi.FileName=$exe; $psi.WorkingDirectory=$cwd
    $cargs | ForEach-Object { [void]$psi.ArgumentList.Add($_) }
    $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
    $p=[Diagnostics.Process]::Start($psi); $o=$p.StandardOutput.ReadToEnd(); $e=$p.StandardError.ReadToEnd(); $p.WaitForExit()
    if($o){ Log($o.TrimEnd()) }; if($e){ Log($e.TrimEnd()) }
  } catch { Log("ERROR: "+$_.Exception.Message) }
}
function RunConsole([string]$title,[string]$cmd,[string]$cwd=$HOMEDIR){
  Log("launched a console: $title  (watch that window)")
  $full="`$host.UI.RawUI.WindowTitle='$title'; Set-Location '$cwd'; $cmd; Write-Host ''; Write-Host '--- done. close when ready ---'"
  Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',$full | Out-Null
}
function OpenUrl([string]$u){ Start-Process $u | Out-Null; Log("opened $u") }

function NewGroup([string]$title,[int]$x){
  $g=New-Object Windows.Forms.GroupBox; $g.Text=$title; $g.Location="$x,40"; $g.Size='360,320'
  $g.ForeColor=$PAL.gold; $g.BackColor=$PAL.panel; $form.Controls.Add($g); return $g
}
function Field($parent,[string]$label,[int]$y,[string]$val,[bool]$mask=$false){
  $l=New-Object Windows.Forms.Label; $l.Text=$label; $l.Location="14,$y"; $l.Size='332,15'; $l.ForeColor=$PAL.sub; $parent.Controls.Add($l)
  $t=New-Object Windows.Forms.TextBox; $t.Location="14,$($y+17)"; $t.Size='332,22'; $t.BackColor=$PAL.field; $t.ForeColor=$PAL.ink; $t.BorderStyle='FixedSingle'; $t.Text=$val
  if($mask){ $t.UseSystemPasswordChar=$true }; $parent.Controls.Add($t); return $t
}
function Btn($parent,[string]$text,[int]$x,[int]$y,[int]$w,[scriptblock]$onClick,$accent=$false){
  $b=New-Object Windows.Forms.Button; $b.Text=$text; $b.Location="$x,$y"; $b.Size="$w,30"; $b.FlatStyle='Flat'
  $b.ForeColor=$(if($accent){[Drawing.Color]::FromArgb(36,26,6)}else{$PAL.ink}); $b.BackColor=$(if($accent){$PAL.gold}else{[Drawing.Color]::FromArgb(40,46,56)})
  $b.FlatAppearance.BorderSize=0; $b.Add_Click($onClick); $parent.Controls.Add($b); return $b
}

# ===================== GitHub =====================
$gh = NewGroup "  GitHub" 14
$ghRepo   = Field $gh "Repo folder (push deploys NEXUS to Pages)" 24 $HOMEDIR
$ghRemote = Field $gh "Remote URL" 66 "https://github.com/orioncontinuity/nexus.git"
$ghMsg    = Field $gh "Commit message" 108 "update NEXUS"
Btn $gh "Login (gh)" 14 156 110 { RunConsole 'gh auth login' "& '$GHCLI' auth login" } | Out-Null
Btn $gh "Init + Remote" 130 156 110 { RunQuiet 'git' @('init') $ghRepo.Text; RunQuiet 'git' @('remote','remove','origin') $ghRepo.Text; RunQuiet 'git' @('remote','add','origin',$ghRemote.Text) $ghRepo.Text; (New-Item -ItemType File -Force -Path (Join-Path $ghRepo.Text '.nojekyll')) | Out-Null; Log('repo ready (+.nojekyll for Pages)') } | Out-Null
Btn $gh "Status" 246 156 100 { RunQuiet 'git' @('-C',$ghRepo.Text,'status','-sb') } | Out-Null
Btn $gh "Commit + Push" 14 192 226 { $m=$ghMsg.Text -replace "'","''"; RunConsole 'git push' "git add -A; git commit -m '$m'; git push -u origin HEAD" $ghRepo.Text } $true | Out-Null
Btn $gh "Open repo" 246 192 100 { $u=$ghRemote.Text -replace '\.git$',''; OpenUrl $u } | Out-Null
$ghHint=New-Object Windows.Forms.Label; $ghHint.Location='14,232'; $ghHint.Size='332,76'; $ghHint.ForeColor=$PAL.sub
$ghHint.Text="1) Login (gh) once - browser or token, stays on this PC.`r`n2) Init + Remote (first time only).`r`n3) Commit + Push to publish. For Pages: enable it on the repo (Settings > Pages > deploy from branch)."
$gh.Controls.Add($ghHint)

# ===================== Supabase =====================
$su = NewGroup "  Supabase" 386
$suKey = Field $su "Service-role key (only for Upload installers)" 24 "" $true
Btn $su "Login" 14 72 110 { RunConsole 'supabase login' "& '$SB' login" } | Out-Null
Btn $su "Status" 130 72 110 { RunQuiet $SB @('projects','list') } | Out-Null
Btn $su "Functions" 246 72 100 { RunQuiet $SB @('functions','list','--project-ref',$REF) } | Out-Null
Btn $su "Deploy clippy-pool" 14 108 226 { RunConsole 'deploy clippy-pool' "& '$SB' functions deploy clippy-pool --project-ref $REF" $HOMEDIR } $true | Out-Null
Btn $su "Dashboard" 246 108 100 { OpenUrl $DASH } | Out-Null
Btn $su "Upload installers (Storage)" 14 144 332 { if(-not $suKey.Text){ Log('paste your service-role key first (field above).'); return }; RunConsole 'upload installers' "`$env:SB_SERVICE_KEY='$($suKey.Text)'; & '$HOMEDIR\upload-installers.ps1'" $HOMEDIR } | Out-Null
$suHint=New-Object Windows.Forms.Label; $suHint.Location='14,184'; $suHint.Size='332,124'; $suHint.ForeColor=$PAL.sub
$suHint.Text="Login once (paste the token from Account > Access Tokens), then Deploy clippy-pool publishes the cross-machine Clippy fan-out.`r`n`r`nUpload installers needs the SERVICE-ROLE key (Project Settings > API) - it creates the public 'installers' bucket and uploads OpenTether + Clippy so the Tools buttons work."
$su.Controls.Add($suHint)

Btn $form "Provision node (auto-install)" 14 344 220 { RunConsole 'clippy-daemon' "& '$HOMEDIR\clippy-daemon.ps1'" $HOMEDIR } $true | Out-Null
Btn $form "Clear log" 640 344 100 { $log.Clear() } | Out-Null

function Refresh-Status {
  $haveGit = [bool](Get-Command git -EA SilentlyContinue)
  $loggedIn = $false
  try { $null = & $SB projects list 2>$null; $loggedIn = ($LASTEXITCODE -eq 0) } catch {}
  $status.Text = ("git " + $(if($haveGit){'OK'}else{'MISSING'}) + "  |  supabase CLI " + $(if(Test-Path $SB){'OK'}else{'MISSING'}) +
                 " (" + $(if($loggedIn){'logged in'}else{'not logged in'}) + ")  |  gh CLI " + $(if(Test-Path $GHCLI){'OK'}else{'MISSING'}))
  $status.ForeColor = $(if($loggedIn){$PAL.ok}else{$PAL.warn})
}

if($SelfTest){ Refresh-Status; Write-Host ("SelfTest OK - controls: "+$form.Controls.Count+" ; "+$status.Text); $form.Dispose(); return }
$form.Add_Shown({ Log('Ready. git/supabase/gh detected. Click an action - logins and deploys open their own console.'); Refresh-Status })
[Windows.Forms.Application]::EnableVisualStyles()
[Windows.Forms.Application]::Run($form)
