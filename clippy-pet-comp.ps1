<#
clippy-pet-comp.ps1 - the TRUE-TRANSPARENCY desktop pet host.  ** GhostGlass **

GhostGlass = a full-screen, truly-transparent, always-on-top layer that you can
click straight THROUGH everywhere... except it "solidifies" under your cursor
exactly where Clippy is, so he (and his Yes/No buttons) stay clickable while the
rest of your desktop is fully usable. The trick: WS_EX_LAYERED held together
with WS_EX_NOREDIRECTIONBITMAP (DComp per-pixel alpha), the layer forced fully
opaque (LWA_ALPHA 255) so DComp's own alpha is what shows, and a 25ms cursor
poll that toggles WS_EX_TRANSPARENT off only while the pointer is over him.

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
  [int]$W = 460,
  [int]$H = 560
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
using System.Drawing.Imaging;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
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
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  const int GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20;

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
    var wa = Screen.PrimaryScreen.WorkingArea;   // GhostGlass: full screen, click-through everywhere but on him
    Wv = wa.Width; Hv = wa.Height;
    this.FormBorderStyle = FormBorderStyle.None;
    this.ShowInTaskbar   = false;
    this.TopMost         = true;
    this.StartPosition   = FormStartPosition.Manual;
    this.Left = wa.Left; this.Top = wa.Top;
    this.Width = Wv; this.Height = Hv;
  }
  protected override CreateParams CreateParams {
    // NOREDIRECTIONBITMAP -> DComp transparency; LAYERED -> lets WS_EX_TRANSPARENT
    // actually pass clicks through. Experiment: do they coexist?
    get { var cp = base.CreateParams; cp.ExStyle |= 0x00200000 | 0x00080000 /* WS_EX_LAYERED */; return cp; }
  }
  protected override void OnHandleCreated(EventArgs e){
    base.OnHandleCreated(e);
    // Keep the layer fully opaque so DComp's own per-pixel alpha is what shows.
    try { SetLayeredWindowAttributes(this.Handle, 0, 255, 0x2 /*LWA_ALPHA*/); } catch {}
    // Click-through by default; the timer clears it only while the cursor is on him.
    try { SetWindowLong(this.Handle, GWL_EXSTYLE, GetWindowLong(this.Handle, GWL_EXSTYLE) | WS_EX_TRANSPARENT); } catch {}
    var tmr = new Timer(); tmr.Interval = 25;
    tmr.Tick += delegate (object s, EventArgs ev) {
      try {
        POINT pt; if (!GetCursorPos(out pt)) return;
        var c = this.PointToClient(new Point(pt.X, pt.Y));
        bool over = OverClippy(c.X, c.Y);
        int ex = GetWindowLong(this.Handle, GWL_EXSTYLE);
        bool through = (ex & WS_EX_TRANSPARENT) != 0;
        if (over && through) SetWindowLong(this.Handle, GWL_EXSTYLE, ex & ~WS_EX_TRANSPARENT);
        else if (!over && !through) SetWindowLong(this.Handle, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT);
      } catch {}
    };
    tmr.Start();
    // Sight: a first peek ~35s after he's up, then an occasional glance.
    var first = new Timer(); first.Interval = 35000;
    first.Tick += delegate (object s, EventArgs ev) { first.Stop(); SendSight(); };
    first.Start();
    var eyes = new Timer(); eyes.Interval = 240000; // ~every 4 min
    eyes.Tick += delegate (object s, EventArgs ev) { SendSight(); };
    eyes.Start();
    var t = Setup();
  }

  // Clippy's current on-screen rects (client coords); used by WM_NCHITTEST so the
  // window is click-through EXCEPT over him. No window Region - a Region forces an
  // opaque redirection surface and kills the DComp transparency (dark disc).
  volatile int[][] _hit;
  bool OverClippy(int x, int y){
    var h = _hit; if (h == null) return false;
    foreach (var r in h) {
      int rx = r[0], ry = r[1], rw = r[2], rh = r[3];
      if (rw <= 0 || rh <= 0) continue;
      if (r[4] == 1) {
        double cx = rx + rw / 2.0, cy = ry + rh / 2.0, nx = (x - cx) / (rw / 2.0), ny = (y - cy) / (rh / 2.0);
        if (nx * nx + ny * ny <= 1.0) return true;
      } else {
        if (x >= rx - 8 && x <= rx + rw + 8 && y >= ry - 8 && y <= ry + rh + 8) return true;
      }
    }
    return false;
  }

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
      _ctl.CoreWebView2.WebMessageReceived += delegate(object sw, CoreWebView2WebMessageReceivedEventArgs aw) {
        try { string mm = aw.TryGetWebMessageAsString(); if (mm != null && mm.StartsWith("rects ")) ApplyRects(mm.Substring(6)); } catch {}
      };
      _ctl.CoreWebView2.NavigationCompleted += delegate(object s2, CoreWebView2NavigationCompletedEventArgs a2) {
        L("nav done success=" + a2.IsSuccess);
        try { var ig = _ctl.CoreWebView2.ExecuteScriptAsync(ReporterJs); } catch (Exception ie) { L("inject err: " + ie.Message); }
      };
      _ctl.CoreWebView2.Navigate(Url);
    } catch (Exception ex) {
      L("setup EX: " + ex.GetType().Name + ": " + ex.Message);
    }
  }

  // Injected into the page: report Clippy's on-screen rects so the host can clip
  // the (full-screen) window to just him - the rest stays click-through.
  const string ReporterJs = @"(function(){ try {
  var w=window.chrome&&window.chrome.webview; if(!w) return;
  if(!document.getElementById('pet-style')){var st=document.createElement('style');st.id='pet-style';st.textContent='#clippy-shell{right:60px!important;bottom:64px!important;}';(document.head||document.documentElement).appendChild(st);}
  if(!window.__petSight){window.__petSight=1;w.addEventListener('message',function(ev){try{var d=ev.data;if(typeof d==='string'&&d.slice(0,4)==='see:'){var b=d.slice(4);if(window.NX&&NX.clippy&&NX.clippy.seeSurroundings)NX.clippy.seeSurroundings(b);}}catch(e){}});}
  var SEL='#clippy-shell,.clippy-bubble';
  var PAD=2,last='';   // tight click radius - hugs the orb itself
  function vis(el){try{var r=el.getBoundingClientRect();return r.width>2&&r.height>2&&el.getClientRects().length>0;}catch(e){return false;}}
  function tick(){try{var vw=window.innerWidth,vh=window.innerHeight,o=[];document.querySelectorAll(SEL).forEach(function(el){if(!vis(el))return;var r=el.getBoundingClientRect();var orb=(el.id==='clippy-shell');var x=r.left,y=r.top,x2=r.left+r.width,y2=r.top+r.height;if(orb){x-=PAD;y-=PAD;x2+=PAD;y2+=PAD;}x=Math.max(0,x);y=Math.max(0,y);x2=Math.min(vw,x2);y2=Math.min(vh,y2);o.push({x:Math.round(x),y:Math.round(y),w:Math.round(x2-x),h:Math.round(y2-y),c:orb?1:0});});var s=JSON.stringify(o);if(s!==last){last=s;w.postMessage('rects '+s);}}catch(e){}}
  setInterval(tick,100);tick();setTimeout(tick,500);setTimeout(tick,1500);
} catch(e){} })();";

  // Clippy's eyes: grab the desktop, shrink it, hand it to the page (which runs
  // it past the vision model and makes him riff). Capture is plain GDI; we post
  // it to our OWN webview (no network here) so it stays a local hand-off.
  static ImageCodecInfo _jpg;
  void SendSight(){
    try {
      if (_ctl == null) return;
      var b = Screen.PrimaryScreen.Bounds;
      string b64;
      using (var full = new Bitmap(b.Width, b.Height))
      using (var g = Graphics.FromImage(full)) {
        g.CopyFromScreen(0, 0, 0, 0, new Size(b.Width, b.Height));
        int tw = 760; int th = (int)(b.Height * 760.0 / b.Width);
        using (var small = new Bitmap(tw, th))
        using (var g2 = Graphics.FromImage(small)) {
          g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
          g2.DrawImage(full, 0, 0, tw, th);
          if (_jpg == null) { foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") _jpg = c; }
          var ep = new EncoderParameters(1);
          ep.Param[0] = new EncoderParameter(Encoder.Quality, 40L);
          using (var ms = new MemoryStream()) {
            small.Save(ms, _jpg, ep);
            b64 = Convert.ToBase64String(ms.ToArray());
          }
        }
      }
      _ctl.CoreWebView2.PostWebMessageAsString("see:" + b64);
      L("sight sent (" + b64.Length + " b64)");
    } catch (Exception ex) { L("sight err: " + ex.Message); }
  }

  void ApplyRects(string json){
    try {
      var list = new List<int[]>();
      var ms = Regex.Matches(json, @"\{""x"":(-?\d+),""y"":(-?\d+),""w"":(\d+),""h"":(\d+),""c"":(\d)\}");
      foreach (Match mt in ms) {
        int x = int.Parse(mt.Groups[1].Value), y = int.Parse(mt.Groups[2].Value),
            wd = int.Parse(mt.Groups[3].Value), ht = int.Parse(mt.Groups[4].Value), c = int.Parse(mt.Groups[5].Value);
        if (wd <= 1 || ht <= 1) continue;
        list.Add(new int[] { x, y, wd, ht, c });
      }
      _hit = list.ToArray();
    } catch (Exception ex) { L("rects err: " + ex.Message); }
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
