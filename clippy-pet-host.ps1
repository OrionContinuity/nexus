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
  [int]$H = 460
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
  Start-Process powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + $PSCommandPath + '" -Url "' + $Url + '"') -WindowStyle Hidden
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
$form.BackColor = [System.Drawing.Color]::FromArgb(10, 11, 16)   # near-black; key for transparency
$form.AllowTransparency = $true
$form.TransparencyKey   = $form.BackColor

$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$wv.Dock = 'Fill'
$wv.DefaultBackgroundColor = [System.Drawing.Color]::Transparent
$form.Controls.Add($wv)

# Cache/profile so it can run offline once cached and keeps state.
$udf = Join-Path $logDir 'webview2-data'
$env:WEBVIEW2_USER_DATA_FOLDER = $udf
$env:Path = $sdk + ';' + $env:Path   # so WebView2Loader.dll resolves

$script:Url = $Url
$initDone = {
  param($s, $e)
  try {
    if ($e.IsSuccess) {
      $s.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
      $s.CoreWebView2.Settings.IsStatusBarEnabled = $false
      $s.CoreWebView2.Settings.AreDevToolsEnabled = $true
      $s.DefaultBackgroundColor = [System.Drawing.Color]::Transparent
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
