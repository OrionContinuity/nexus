<#
clippy-pet-comp.ps1 - the TRUE-TRANSPARENCY desktop pet host.

Hosts the exact NEXUS web Clippy (clippy-pet.html) in a DirectComposition
visual with genuine per-pixel alpha - so his glow and fireflies fade straight
into the desktop with NO backing rectangle/disc. Mouse input is forwarded to the
web content, so the orb and his Yes/No buttons stay clickable.

This uses WebView2 "composition hosting" (CreateCoreWebView2CompositionController)
+ a WS_EX_NOREDIRECTIONBITMAP window + an IDCompositionDevice built on a D3D11
device. The WebView2 *runtime* is already on the machine; we self-provision the
WebView2 .NET SDK DLLs once (cached next to the region host).

  powershell -NoProfile -ExecutionPolicy Bypass -STA -File clippy-pet-comp.ps1
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
$log = Join-Path $logDir 'pet-comp.log'
function Log([string]$m) { try { Add-Content $log ((Get-Date -Format 'HH:mm:ss') + '  ' + $m) } catch {} }
Log "=== pet-comp starting (pid $PID, apartment=$([Threading.Thread]::CurrentThread.ApartmentState)) ==="

if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  Log "not STA - relaunching with -STA"
  Start-Process powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + $PSCommandPath + '" -Url "' + $Url + '"') -WindowStyle Hidden
  return
}

# Single instance (match this script's -File invocation, never the worker's -Command shell).
$others = Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and
                 $_.CommandLine -match 'clippy-pet-comp\.ps1' -and $_.CommandLine -notmatch '(?i)-Command' }
if ($others) { Log "another comp host running (pid $($others[0].ProcessId)) - exiting"; return }

# --- WebView2 .NET SDK (shared cache with the region host) --------------------
$sdk = Join-Path $logDir 'webview2-sdk'
$coreDll = Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll'
$loader  = Join-Path $sdk 'WebView2Loader.dll'
if (-not (Test-Path $coreDll) -or -not (Test-Path $loader)) {
  Log "fetching WebView2 SDK (nuget) ..."
  try {
    New-Item -ItemType Directory -Force -Path $sdk | Out-Null
    $nupkg = Join-Path $env:TEMP 'wv2.zip'
    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2792.45' -OutFile $nupkg -UseBasicParsing -TimeoutSec 120
    $ex = Join-Path $env:TEMP 'wv2_ex'
    if (Test-Path $ex) { Remove-Item $ex -Recurse -Force -EA SilentlyContinue }
    Expand-Archive $nupkg -DestinationPath $ex -Force
    $coreSrc = Get-ChildItem $ex -Recurse -Filter 'Microsoft.Web.WebView2.Core.dll' -EA SilentlyContinue | Where-Object { $_.FullName -match '\\net4' } | Select-Object -First 1
    $ldSrc   = Get-ChildItem $ex -Recurse -Filter 'WebView2Loader.dll' -EA SilentlyContinue | Where-Object { $_.FullName -match 'win-x64' } | Select-Object -First 1
    if ($coreSrc) { Copy-Item $coreSrc.FullName $coreDll -Force }
    if ($ldSrc)   { Copy-Item $ldSrc.FullName   $loader  -Force }
  } catch { Log "WebView2 SDK fetch failed: $($_.Exception.Message)" }
}

$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $logDir 'webview2-data'
$env:Path = $sdk + ';' + $env:Path

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Load the WebView2 Core assembly by identity so the compiled host can bind to it
# (the SDK folder isn't a .NET probing path - PATH only helps the native loader).
try { [Reflection.Assembly]::LoadFrom($coreDll) | Out-Null; Log "Core.dll loaded" } catch { Log "Core.dll load failed: $($_.Exception.Message)" }

$cs = @'
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

public class ClippyComp : Form {
  public static string LogPath;
  public static string UserData;
  public static string Url;
  public static int Wv, Hv;
  static void L(string s){ try { File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss") + "  [cs] " + s + Environment.NewLine); } catch {} }

  [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr a,int dt,IntPtr s,uint f,IntPtr fl,uint nfl,uint sdk,out IntPtr dev,out int outFl,out IntPtr ctx);
  [DllImport("dcomp.dll")] static extern int DCompositionCreateDevice(IntPtr dxgi, ref Guid iid, out IntPtr dev);

  [ComImport, Guid("C37EA93A-E7AA-450D-B16F-9746CB0407F3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDCompositionDevice {
    int Commit();
    int WaitForCommitCompletion();
    int GetFrameStatistics();
    int CreateTargetForHwnd(IntPtr hwnd, bool topmost, out IDCompositionTarget target);
    int CreateVisual(out IntPtr visual);
  }
  [ComImport, Guid("eacdd04c-117e-4e17-88f4-d1b12b0e3d89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDCompositionTarget { int SetRoot(IntPtr visual); }

  IntPtr _d3d, _dxgi, _dcompPtr, _visual;
  IDCompositionDevice _dcomp;
  IDCompositionTarget _target;
  CoreWebView2CompositionController _ctl;

  public ClippyComp(){
    this.FormBorderStyle = FormBorderStyle.None;
    this.ShowInTaskbar   = false;
    this.TopMost         = true;
    this.StartPosition   = FormStartPosition.Manual;
    this.Width = Wv; this.Height = Hv;
    var wa = Screen.PrimaryScreen.WorkingArea;
    this.Left = wa.Right - Wv - 24;
    this.Top  = wa.Bottom - Hv - 24;
  }
  protected override CreateParams CreateParams {
    get { var cp = base.CreateParams; cp.ExStyle |= 0x00200000 /* WS_EX_NOREDIRECTIONBITMAP */; return cp; }
  }
  protected override void OnHandleCreated(EventArgs e){ base.OnHandleCreated(e); var t = Setup(); }

  async Task Setup(){
    try {
      int fl; IntPtr ctx;
      int hr = D3D11CreateDevice(IntPtr.Zero, 1 /*HARDWARE*/, IntPtr.Zero, 0x20 /*BGRA*/, IntPtr.Zero, 0, 7, out _d3d, out fl, out ctx);
      L("d3d hardware hr=0x" + hr.ToString("X"));
      if (hr != 0) {
        hr = D3D11CreateDevice(IntPtr.Zero, 3 /*WARP*/, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out _d3d, out fl, out ctx);
        L("d3d warp hr=0x" + hr.ToString("X"));
      }
      if (hr != 0) { L("d3d FAILED - aborting"); return; }
      Guid iidDxgi = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
      hr = Marshal.QueryInterface(_d3d, ref iidDxgi, out _dxgi);
      L("qi IDXGIDevice hr=0x" + hr.ToString("X"));
      Guid iidDev = new Guid("C37EA93A-E7AA-450D-B16F-9746CB0407F3");
      hr = DCompositionCreateDevice(_dxgi, ref iidDev, out _dcompPtr);
      L("DCompositionCreateDevice hr=0x" + hr.ToString("X"));
      if (hr != 0) { L("dcomp device FAILED - aborting"); return; }
      _dcomp = (IDCompositionDevice)Marshal.GetObjectForIUnknown(_dcompPtr);
      hr = _dcomp.CreateTargetForHwnd(this.Handle, true, out _target); L("CreateTargetForHwnd hr=0x" + hr.ToString("X"));
      hr = _dcomp.CreateVisual(out _visual); L("CreateVisual hr=0x" + hr.ToString("X"));
      hr = _target.SetRoot(_visual); L("SetRoot hr=0x" + hr.ToString("X"));

      L("creating webview2 environment (data=" + UserData + ")");
      var env = await CoreWebView2Environment.CreateAsync(null, UserData, null);
      L("env ready; creating composition controller");
      _ctl = await env.CreateCoreWebView2CompositionControllerAsync(this.Handle);
      L("composition controller ready");
      // WebView2's controller background defaults to OPAQUE WHITE - that is the
      // white box behind Clippy. Make it transparent so the page's transparent
      // areas composite to nothing (real desktop shows through).
      try { _ctl.DefaultBackgroundColor = Color.FromArgb(0, 0, 0, 0); L("bg -> transparent"); }
      catch (Exception be) { L("bg set warn: " + be.Message); }
      object visObj = Marshal.GetObjectForIUnknown(_visual);
      _ctl.RootVisualTarget = visObj;
      _ctl.Bounds = new Rectangle(0, 0, Wv, Hv);
      _dcomp.Commit();
      L("committed; wiring + navigating to " + Url);
      try {
        _ctl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _ctl.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _ctl.CoreWebView2.Settings.AreDevToolsEnabled = true;
      } catch (Exception se) { L("settings warn: " + se.Message); }
      _ctl.CoreWebView2.NavigationCompleted += delegate(object s2, CoreWebView2NavigationCompletedEventArgs a2) { L("nav done success=" + a2.IsSuccess); };
      _ctl.CoreWebView2.Navigate(Url);
    } catch (Exception ex) {
      L("setup EX: " + ex.GetType().Name + ": " + ex.Message);
    }
  }

  protected override void WndProc(ref Message m){
    if (_ctl != null && m.Msg >= 0x200 && m.Msg <= 0x209) {
      try { ForwardMouse(m.Msg, m.WParam, m.LParam); } catch {}
    }
    base.WndProc(ref m);
  }
  void ForwardMouse(int msg, IntPtr wParam, IntPtr lParam){
    int lp = (int)lParam.ToInt64();
    int x = (short)(lp & 0xFFFF);
    int y = (short)((lp >> 16) & 0xFFFF);
    var pt = new Point(x, y);
    CoreWebView2MouseEventKind kind;
    switch (msg) {
      case 0x200: kind = CoreWebView2MouseEventKind.Move; break;
      case 0x201: kind = CoreWebView2MouseEventKind.LeftButtonDown; break;
      case 0x202: kind = CoreWebView2MouseEventKind.LeftButtonUp; break;
      case 0x203: kind = CoreWebView2MouseEventKind.LeftButtonDoubleClick; break;
      case 0x204: kind = CoreWebView2MouseEventKind.RightButtonDown; break;
      case 0x205: kind = CoreWebView2MouseEventKind.RightButtonUp; break;
      default: return;
    }
    _ctl.SendMouseInput(kind, CoreWebView2MouseEventVirtualKeys.None, 0, pt);
  }
}
'@

try {
  Add-Type -ReferencedAssemblies @($coreDll, 'System.Windows.Forms', 'System.Drawing') -TypeDefinition $cs -ErrorAction Stop
  Log "C# host compiled"
} catch {
  Log "C# compile FAILED: $($_.Exception.Message)"
  $ex = $_.Exception
  while ($ex) {
    if ($ex.PSObject.Properties['LoaderExceptions'] -and $ex.LoaderExceptions) {
      foreach ($le in $ex.LoaderExceptions) { Log ("  loaderex: " + $le.Message) }
    }
    if ($ex.PSObject.Properties['Errors'] -and $ex.Errors) {
      foreach ($er in $ex.Errors) { Log ("  cscerr: " + $er.ErrorText + " (line " + $er.Line + ")") }
    }
    $ex = $ex.InnerException
  }
  return
}

[ClippyComp]::LogPath  = $log
[ClippyComp]::UserData = $env:WEBVIEW2_USER_DATA_FOLDER
[ClippyComp]::Url      = $Url
[ClippyComp]::Wv       = $W
[ClippyComp]::Hv       = $H

try {
  $form = New-Object ClippyComp
  Log "form created - running message loop"
  [System.Windows.Forms.Application]::Run($form)
} catch { Log "run failed: $($_.Exception.Message)" }
Log "pet-comp exited"
