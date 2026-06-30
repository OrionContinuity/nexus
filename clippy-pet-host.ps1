<#
clippy-pet-host.ps1 - the NEW desktop pet host.

Renders the EXACT NEXUS web Clippy (clippy-pet.html) in a transparent,
frameless, always-on-top WebView2 window - so the desktop buddy is literally
the same SVG body, actions/moves and personality as the web one, auto-updating.

It self-provisions the WebView2 .NET SDK (downloads the NuGet package once and
caches the DLLs) - the WebView2 *runtime* is already on the machine. Logs to
%USERPROFILE%\.clippy\pet-host.log so we can see what happened.

  powershell -NoProfile -ExecutionPolicy Bypass -STA -File clippy-pet-host.ps1
#>
param(
  [string]$Url = 'https://orioncontinuity.github.io/nexus/clippy-pet.html',
  [int]$W = 380,
  [int]$H = 460,
  [switch]$Solid   # opaque window (no color-key transparency) - guarantees clicks
                   # reach WebView2; used to confirm/avoid the transparent-input bug
)
$ErrorActionPreference = 'Continue'
$home0 = $env:USERPROFILE
$logDir = Join-Path $home0 '.clippy'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'pet-host.log'
function Log([string]$m) { try { Add-Content $log ((Get-Date -Format 'HH:mm:ss') + '  ' + $m) } catch {} }
Log "=== pet-host starting (pid $PID, apartment=$([Threading.Thread]::CurrentThread.ApartmentState)) ==="

# WinForms needs STA. If we're MTA (some hosts), relaunch ourselves -STA.
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  Log "not STA - relaunching with -STA"
  $extra = ''; if ($Solid) { $extra = ' -Solid' }
  Start-Process powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + $PSCommandPath + '" -Url "' + $Url + '"' + $extra) -WindowStyle Hidden
  return
}

# Single instance: bow out if another pet host is already up. Match ONLY real
# host processes (powershell launched with -File ...clippy-pet-host.ps1) so we
# never mistake the worker's own -Command shell (which echoes this filename in
# its command line) or a diagnostic cmd for "another host".
$others = Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and
                 $_.CommandLine -match 'clippy-pet-host\.ps1' -and
                 $_.CommandLine -notmatch '(?i)-Command' }
if ($others) { Log "another host already running (pid $($others[0].ProcessId)) - exiting"; return }

# --- Ensure the WebView2 .NET SDK DLLs (runtime is already installed) ---------
$sdk = Join-Path $logDir 'webview2-sdk'
$coreDll = Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll'
$wfDll   = Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll'
$loader  = Join-Path $sdk 'WebView2Loader.dll'
if (-not (Test-Path $coreDll) -or -not (Test-Path $wfDll) -or -not (Test-Path $loader)) {
  Log "fetching WebView2 SDK (nuget) ..."
  try {
    New-Item -ItemType Directory -Force -Path $sdk | Out-Null
    $nupkg = Join-Path $env:TEMP 'wv2.zip'
    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2792.45' -OutFile $nupkg -UseBasicParsing -TimeoutSec 120
    $ex = Join-Path $env:TEMP 'wv2_ex'
    if (Test-Path $ex) { Remove-Item $ex -Recurse -Force -EA SilentlyContinue }
    Expand-Archive $nupkg -DestinationPath $ex -Force
    # Find the managed DLLs (prefer a .NET Framework build for Windows PowerShell)
    # + the win-x64 native loader - wherever the package version put them.
    $coreSrc = Get-ChildItem $ex -Recurse -Filter 'Microsoft.Web.WebView2.Core.dll'     -EA SilentlyContinue | Where-Object { $_.FullName -match '\\net4' } | Select-Object -First 1
    $wfSrc   = Get-ChildItem $ex -Recurse -Filter 'Microsoft.Web.WebView2.WinForms.dll' -EA SilentlyContinue | Where-Object { $_.FullName -match '\\net4' } | Select-Object -First 1
    if (-not $coreSrc) { $coreSrc = Get-ChildItem $ex -Recurse -Filter 'Microsoft.Web.WebView2.Core.dll'     -EA SilentlyContinue | Select-Object -First 1 }
    if (-not $wfSrc)   { $wfSrc   = Get-ChildItem $ex -Recurse -Filter 'Microsoft.Web.WebView2.WinForms.dll' -EA SilentlyContinue | Select-Object -First 1 }
    $ldSrc   = Get-ChildItem $ex -Recurse -Filter 'WebView2Loader.dll' -EA SilentlyContinue | Where-Object { $_.FullName -match 'win-x64' } | Select-Object -First 1
    if ($coreSrc) { Copy-Item $coreSrc.FullName $coreDll -Force }
    if ($wfSrc)   { Copy-Item $wfSrc.FullName   $wfDll   -Force }
    if ($ldSrc)   { Copy-Item $ldSrc.FullName   $loader  -Force }
    if ((Test-Path $coreDll) -and (Test-Path $wfDll) -and (Test-Path $loader)) {
      Log ("WebView2 SDK ready (" + $coreSrc.FullName.Substring($ex.Length) + ")")
    } else {
      Log ("WebView2 SDK INCOMPLETE: core=" + [bool]$coreSrc + " winforms=" + [bool]$wfSrc + " loader=" + [bool]$ldSrc)
    }
  } catch { Log "WebView2 SDK fetch failed: $($_.Exception.Message)" }
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [Reflection.Assembly]::LoadFrom($coreDll) | Out-Null
  [Reflection.Assembly]::LoadFrom($wfDll)   | Out-Null
} catch { Log "assembly load failed: $($_.Exception.Message)"; return }

# --- The transparent, frameless, always-on-top window -------------------------
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar   = $false
$form.TopMost         = $true
$form.StartPosition   = 'Manual'
$form.Width = $W; $form.Height = $H
$form.Left = $wa.Right - $W - 24
$form.Top  = $wa.Bottom - $H - 24
Log ("formrect left=$($form.Left) top=$($form.Top) w=$W h=$H")
$form.BackColor = [System.Drawing.Color]::FromArgb(13, 15, 24)   # near-black backdrop
if (-not $Solid) {
  # Color-key transparency: pixels of BackColor become invisible + click-through.
  $form.AllowTransparency = $true
  $form.TransparencyKey   = $form.BackColor
}
Log ("window mode: " + $(if ($Solid) { 'SOLID (opaque)' } else { 'transparent (color-key)' }))

$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$wv.Dock = 'Fill'
# In transparent mode the page's transparent areas fall through to the keyed
# BackColor; in solid mode they show the dark backdrop directly.
$wv.DefaultBackgroundColor = $(if ($Solid) { $form.BackColor } else { [System.Drawing.Color]::Transparent })
$form.Controls.Add($wv)

# Cache/profile so it can run offline once cached and keeps state.
$udf = Join-Path $logDir 'webview2-data'
$env:WEBVIEW2_USER_DATA_FOLDER = $udf
$env:Path = $sdk + ';' + $env:Path   # so WebView2Loader.dll resolves

$script:Url = $Url
$script:WvBg = $wv.DefaultBackgroundColor
# Injected into every loaded page: reports page state + each click straight to
# the host log via chrome.webview.postMessage (no Supabase / CORS in the path).
$script:ReporterJs = @'
(function(){ try {
  var w = window.chrome && window.chrome.webview; if(!w) return;
  w.postMessage('injected supa='+(typeof window.supabase)+' nxsb='+(!!(window.NX&&window.NX.sb))+' shell='+(!!document.querySelector('.clippy-shell'))+' host='+(!!document.querySelector('#clippy-host')));
  function rep(){ var sh=document.querySelector('.clippy-shell')||document.querySelector('#clippy-host'); if(sh){ var r=sh.getBoundingClientRect(); w.postMessage('shellrect x='+Math.round(r.left)+' y='+Math.round(r.top)+' w='+Math.round(r.width)+' h='+Math.round(r.height)); } }
  rep(); setTimeout(rep, 2500);
  document.addEventListener('pointerdown', function(e){
    var b=(e.target&&e.target.closest)?e.target.closest('button,.clippy-bubble-btn,.clippy-shell,.clippy-orb'):null;
    w.postMessage('click x='+e.clientX+' y='+e.clientY+' tag='+(e.target?e.target.tagName:'?')+' btn='+(b?('['+((b.textContent||'').trim().slice(0,30))+']'):'no'));
  }, true);
} catch(err){} })();
'@
$initDone = {
  param($s, $e)
  try {
    if ($e.IsSuccess) {
      $s.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
      $s.CoreWebView2.Settings.IsStatusBarEnabled = $false
      $s.CoreWebView2.Settings.AreDevToolsEnabled = $true
      $s.DefaultBackgroundColor = $script:WvBg
      $s.CoreWebView2.add_WebMessageReceived({ param($a,$b) try { Log ('webmsg: ' + $b.TryGetWebMessageAsString()) } catch { Log 'webmsg: <parse error>' } })
      $s.CoreWebView2.add_NavigationCompleted({ param($a,$b)
        Log ('nav done: success=' + $b.IsSuccess + ' status=' + $b.WebErrorStatus)
        try { $a.ExecuteScriptAsync($script:ReporterJs) | Out-Null } catch { Log ('inject err: ' + $_.Exception.Message) }
      })
      Log "core init ok - navigating to $script:Url"
      $s.CoreWebView2.Navigate($script:Url)
    } else { Log "core init FAILED: $($e.InitializationException)" }
  } catch { Log "init handler error: $($_.Exception.Message)" }
}
$wv.add_CoreWebView2InitializationCompleted($initDone)
$form.add_Shown({ Log "form shown" })

try {
  Log "EnsureCoreWebView2Async (data=$udf)"
  $wv.EnsureCoreWebView2Async($null) | Out-Null
} catch { Log "EnsureCoreWebView2Async threw: $($_.Exception.Message)" }

[System.Windows.Forms.Application]::Run($form)
Log "pet-host exited"
