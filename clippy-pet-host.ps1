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
# Backing colour - only shown *inside* the clip region where the page is
# transparent. We keep the region hugging Clippy's solid body so it barely shows.
$form.BackColor = [System.Drawing.Color]::FromArgb(10, 12, 18)
$script:Form  = $form
$script:Solid = [bool]$Solid
if ($Solid) { Log "window mode: SOLID (opaque rectangle)" }
else        { Log "window mode: floating (region-clipped, input-safe)" }

$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$wv.Dock = 'Fill'
# Transparent page background so the region clip is all that defines the shape.
$wv.DefaultBackgroundColor = $(if ($Solid) { $form.BackColor } else { [System.Drawing.Color]::Transparent })
$form.Controls.Add($wv)

# Cache/profile so it can run offline once cached and keeps state.
$udf = Join-Path $logDir 'webview2-data'
$env:WEBVIEW2_USER_DATA_FOLDER = $udf
$env:Path = $sdk + ';' + $env:Path   # so WebView2Loader.dll resolves

$script:Url = $Url
$script:WvBg = $wv.DefaultBackgroundColor

# Clip the window to just Clippy's visible content. The page streams the screen
# rects of the orb + any open bubble/panel; we union them into a Region so the
# rest of the window is truly outside the window (transparent + click-through),
# while everything inside stays opaque and CLICKABLE (no color-key = input works).
$script:ApplyRects = {
  param($json)
  try {
    $arr = $json | ConvertFrom-Json
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $n = 0
    foreach ($r in $arr) {
      $x = [int]$r.x; $y = [int]$r.y; $wd = [int]$r.w; $ht = [int]$r.h
      if ($wd -le 1 -or $ht -le 1) { continue }
      $path.StartFigure()
      if ($r.c -eq 1) {
        # the orb - circle over the padded rect (page already added the glow halo)
        $path.AddEllipse([single]$x, [single]$y, [single]$wd, [single]$ht)
      } else {
        # bubble / panel - rounded rect hugging it (+pad for tail & shadow)
        $g = 8; $d = [single]22
        $rx = [single]($x - $g); $ry = [single]($y - $g); $rw = [single]($wd + 2 * $g); $rh = [single]($ht + 2 * $g)
        if ($d -gt $rw) { $d = $rw }; if ($d -gt $rh) { $d = $rh }
        $path.AddArc($rx, $ry, $d, $d, [single]180, [single]90)
        $path.AddArc(($rx + $rw - $d), $ry, $d, $d, [single]270, [single]90)
        $path.AddArc(($rx + $rw - $d), ($ry + $rh - $d), $d, $d, [single]0, [single]90)
        $path.AddArc($rx, ($ry + $rh - $d), $d, $d, [single]90, [single]90)
        $path.CloseFigure()
      }
      $n++
    }
    if ($n -gt 0) { $script:Form.Region = New-Object System.Drawing.Region($path) }
  } catch { Log ('rects err: ' + $_.Exception.Message) }
}

# Injected into every loaded page: reports content rects (for the clip region) +
# clicks, straight to the host via chrome.webview.postMessage (no Supabase path).
$script:ReporterJs = @'
(function(){ try {
  var w = window.chrome && window.chrome.webview; if(!w) return;
  // Give the orb breathing room inside the small pet window so its glow +
  // fireflies aren't clipped by the window edge (web Clippy sits in a corner).
  if(!document.getElementById('pet-style')){
    var st=document.createElement('style'); st.id='pet-style';
    st.textContent='#clippy-shell{right:64px!important;bottom:70px!important;}';
    (document.head||document.documentElement).appendChild(st);
  }
  w.postMessage('injected supa='+(typeof window.supabase)+' nxsb='+(!!(window.NX&&window.NX.sb))+' shell='+(!!document.querySelector('#clippy-shell')));
  var SEL = '#clippy-shell,.clippy-bubble,.clippy-palette,.clippy-game-overlay,.clippy-gacha-overlay,.clippy-panel,.clippy-card';
  var ORB_PAD = 46;  // px of glow/firefly halo to keep around the orb
  function vis(el){ try { var r=el.getBoundingClientRect(); return r.width>2 && r.height>2 && el.getClientRects().length>0; } catch(e){ return false; } }
  var last='';
  function tick(){
    try {
      var vw=window.innerWidth, vh=window.innerHeight, out=[];
      document.querySelectorAll(SEL).forEach(function(el){
        if(!vis(el)) return; var r=el.getBoundingClientRect();
        var orb=(el.id==='clippy-shell');
        var x=r.left, y=r.top, x2=r.left+r.width, y2=r.top+r.height;
        if(orb){ x-=ORB_PAD; y-=ORB_PAD; x2+=ORB_PAD; y2+=ORB_PAD; }
        x=Math.max(0,x); y=Math.max(0,y); x2=Math.min(vw,x2); y2=Math.min(vh,y2);
        out.push({x:Math.round(x),y:Math.round(y),w:Math.round(x2-x),h:Math.round(y2-y),c:orb?1:0});
      });
      var s=JSON.stringify(out);
      if(s!==last){ last=s; w.postMessage('rects '+s); }
    } catch(e){}
  }
  setInterval(tick,120); tick(); setTimeout(tick,400); setTimeout(tick,1500);
  document.addEventListener('pointerdown', function(e){
    var b=(e.target&&e.target.closest)?e.target.closest('button,.clippy-bubble-btn,#clippy-shell'):null;
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
      $s.CoreWebView2.add_WebMessageReceived({ param($a,$b)
        try {
          $m = $b.TryGetWebMessageAsString()
          if ($m -like 'rects *') { if (-not $script:Solid) { & $script:ApplyRects ($m.Substring(6)) } }
          else { Log ('webmsg: ' + $m) }
        } catch { Log 'webmsg: <parse error>' }
      })
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
