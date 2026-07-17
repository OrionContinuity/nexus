<#
clippy-pet-comp.ps1 - the TRUE-TRANSPARENCY desktop pet host.  ** GhostGlass **

GhostGlass = a small (520x600) always-on-top corner box you can click straight
THROUGH everywhere... except it "solidifies" exactly where Clippy is, so he (and
his Yes/No buttons) stay clickable while the rest of your desktop is fully usable.
Grab his body and DRAG to move him anywhere; he remembers where you left him.

THE TWO-WINDOW REALITY (read this before touching click-through):
WebView2 "composition hosting" renders Clippy into a DirectComposition visual on
OUR NOREDIRECTIONBITMAP window (genuine per-pixel alpha - glow/fireflies fade into
the desktop, no backing disc). BUT it ALSO spawns its OWN separate top-level window
(class Chrome_WidgetWin_1, title 'Clippy', a DIFFERENT process) that holds Clippy's
actual pixels and sits at our exact rect. Two overlapping windows:
  1. OUR host  - region-clipped (SetWindowRgn) to Clippy's silhouette; forwards
                 mouse it receives to the page. Defines the INPUT hit-area.
  2. WebView2's - full 520x600, we don't own it. Left alone it ate EVERY desktop
                 click in the corner (region-clipping our host does nothing to it).
FIX: give window #2 WS_EX_TRANSPARENT (EnsureWebView) so the OS hit-tests through
it to our host - over Clippy the host gets the click and forwards it; everywhere
else there's no window and the click reaches the desktop. Its pixels still render,
so his full glow is preserved. We also keep window #2 pinned to our position (they
are independent top-levels - moving the host does NOT move it), which is what makes
dragging work. Verified live on DESKTOP-N6PACMM 2026-07-05 with a WindowFromPoint
click-map of the whole box.

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

# Single instance via a session-named mutex. The old process-scan check had a
# TOCTOU race - two hosts launched close together each saw "no other" before
# registering, so two GhostGlass layers ended up stacked and fighting over the
# click-through region. A mutex is atomic. Held for this process's lifetime
# ($script scope keeps it off the GC).
$createdNew = $false
try {
  $script:petMutex = New-Object System.Threading.Mutex($true, 'NexusClippyGhostGlassPet', [ref]$createdNew)
} catch { $createdNew = $true }   # if the mutex API itself fails, don't block startup
if (-not $createdNew) { Log 'another GhostGlass already running (mutex held) - exiting'; return }

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
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
  [DllImport("gdi32.dll")] static extern IntPtr CreateEllipticRgn(int l, int t, int r, int b);
  [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr dst, IntPtr a, IntPtr b, int mode);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int m);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int m);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECTW r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr SetCapture(IntPtr h);
  [DllImport("user32.dll")] static extern bool ReleaseCapture();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  [DllImport("wtsapi32.dll")] static extern bool WTSRegisterSessionNotification(IntPtr h, int flags);
  [DllImport("wtsapi32.dll")] static extern bool WTSUnRegisterSessionNotification(IntPtr h);
  [DllImport("user32.dll")] static extern int RegisterWindowMessage(string s);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct RECTW { public int L, T, R, B; }
  const int GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20, RGN_OR = 2, GW_OWNER = 4;
  const uint SWP_MOVE = 0x15; // NOSIZE|NOZORDER|NOACTIVATE
  const int SW_HIDE = 0, SW_SHOWNA = 8;       // show without stealing focus
  // SHQueryUserNotificationState: 3 = a D3D fullscreen app (game), 4 = presentation
  const int QUNS_D3D_FULLSCREEN = 3, QUNS_PRESENTATION = 4;
  const int WM_WTSSESSION_CHANGE = 0x02B1, WTS_SESSION_LOCK = 0x7, WTS_SESSION_UNLOCK = 0x8;
  const uint OUR_PID = 0;  // set at runtime

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

  // Null/zero-safe primary work area. On a headless boot (no monitor) or the
  // instant a monitor sleeps, Screen.PrimaryScreen can be null or report 0x0 -
  // reading .WorkingArea directly then throws and the overlay dies. Fall back to
  // a sane default; the 3s re-fit timer corrects to the real screen when it
  // appears (monitor wake, RDP connect, resolution change).
  static Rectangle ScreenWA(){
    try { var s = Screen.PrimaryScreen; if (s != null){ var r = s.WorkingArea; if (r.Width > 0 && r.Height > 0) return r; } } catch {}
    return new Rectangle(0, 0, 1920, 1080);
  }
  int PW = 520, PH = 600;   // overlay box (computed generously from the screen in the ctor)
  public ClippyComp(){
    var wa = ScreenWA();
    // Size the stage to fit his AURA and his MENUS/chat, which were clipping at
    // the old fixed 520x600 box (Alfredo: "cuts off his aura and cuts completely
    // the menus"). The WebView surface is click-through (WS_EX_TRANSPARENT), so a
    // big box never blocks the desktop; the host form's region keeps only Clippy
    // + his open UI clickable. Scale to the work area, capped, floored, so it fits
    // a small laptop screen AND a big desktop and still leaves the top-left free.
    PW = Math.Max(600, Math.Min(960,  (int)(wa.Width  * 0.52)));
    PH = Math.Max(680, Math.Min(960,  (int)(wa.Height * 0.86)));
    // The overlay is a bounded stage (not the whole screen) because DRAG moves
    // this window (MovePet); a full-screen window would make dragging shift his
    // whole world. Within the stage his aura and menus now have room and he
    // roams a big area. WebView2's surface is click-through (WS_EX_TRANSPARENT)
    // and the host is region-clipped to only Clippy + his open UI, so even this
    // large box never blocks the desktop.
    Wv = PW; Hv = PH;
    this.FormBorderStyle = FormBorderStyle.None;
    this.ShowInTaskbar   = false;
    this.TopMost         = true;
    this.StartPosition   = FormStartPosition.Manual;
    this.Left = wa.Right - PW - 8; this.Top = wa.Bottom - PH - 8;
    this.Width = Wv; this.Height = Hv;
    // If the user has dragged Clippy before, come back where they left him
    // (clamped on-screen) instead of snapping to the corner.
    LoadPos();
    int _pl, _pt; Place(out _pl, out _pt);   // fully-visible: saved spot if still on a live screen, else the corner
    this.Left = _pl; this.Top = _pt;
  }
  // Re-fit the full-screen overlay to the CURRENT primary work area. Called on
  // WM_DISPLAYCHANGE and on a slow poll, so Clippy survives monitor sleep/wake,
  // disconnect/reconnect, an RDP session grabbing a different resolution, and
  // DPI/scale changes - instead of being stranded at the launch-time geometry
  // (off-screen or with a misaligned click-through region). No-ops when nothing
  // moved, so the poll is cheap.
  void Refit(){
    try {
      // Where should the box sit? If the user dragged Clippy, honour that spot
      // (clamped on-screen); otherwise anchor to the work area's bottom-right
      // corner. Either way survives monitor sleep/wake, RDP resize, DPI change,
      // and never grows back to full-screen.
      int nl, nt; Place(out nl, out nt);   // recompute a fully-visible spot every tick (survives monitor unplug/RDP/DPI)
      if (this.Left != nl || this.Top != nt || this.Width != PW) {
        Wv = PW; Hv = PH;
        this.Left = nl; this.Top = nt;
        this.Width = PW; this.Height = PH;
        if (_ctl != null) { try { _ctl.Bounds = new Rectangle(0, 0, PW, PH); } catch {} }
        if (_dcomp != null) { try { _dcomp.Commit(); } catch {} }
        L("refit -> " + PW + "x" + PH + " @ " + this.Left + "," + this.Top);
      }
      // Every tick: make sure WebView2's own window is click-through and pinned
      // to us (belt-and-suspenders; the drag handler also does the pin live).
      EnsureWebView();
    } catch (Exception ex) { L("refit err: " + ex.Message); }
  }
  protected override CreateParams CreateParams {
    // WS_EX_NOREDIRECTIONBITMAP alone gives DComp per-pixel transparency. We
    // intentionally do NOT add WS_EX_LAYERED: on a layered window the clickable
    // shape is defined by the layer's ALPHA (uniform 255 => the whole window
    // eats clicks), which OVERRIDES SetWindowRgn - that's why the region-clipped
    // overlay still blocked the desktop. Without LAYERED, SetWindowRgn controls
    // hit-testing and everything outside Clippy's silhouette reaches the desktop.
    get { var cp = base.CreateParams; cp.ExStyle |= 0x00200000 /* WS_EX_NOREDIRECTIONBITMAP */; return cp; }
  }
  protected override void OnHandleCreated(EventArgs e){
    base.OnHandleCreated(e);
    // No SetLayeredWindowAttributes here anymore - the window is not layered.
    // Transparency is pure DComp; hit-testing is defined by the window region.
    // Click-through is now done PER-MESSAGE in WndProc via WM_NCHITTEST
    // (HTTRANSPARENT off Clippy so the click falls through to the desktop,
    // HTCLIENT over him so the orb/buttons stay live). We must NOT set
    // WS_EX_TRANSPARENT - a window with it never receives WM_NCHITTEST, so we
    // could not carve Clippy back out. Dropping the old global-flag toggle (it
    // was ineffective here) is the actual fix.
    //
    // One-shot self-diagnostic ~6s in (after the page reports its rects): sample
    // OverClippy on an 11x11 grid and log how many cells read "over Clippy". A
    // healthy overlay reports ~1-2 (just the orb); a high count would mean the
    // reported rects are oversized/mis-scaled and the rect SOURCE needs fixing
    // rather than the hit-test. Confirms the fix is attacking the right cause.
    var probe = new Timer(); probe.Interval = 6000;
    probe.Tick += delegate (object s, EventArgs ev) {
      probe.Stop();
      try {
        int hits = 0, tot = 0;
        for (int gx = 0; gx <= 10; gx++) for (int gy = 0; gy <= 10; gy++) {
          int px = (int)(Wv * gx / 10.0), py = (int)(Hv * gy / 10.0);
          tot++; if (OverClippy(px, py)) hits++;
        }
        L("grid OverClippy true " + hits + "/" + tot + " (client " + Wv + "x" + Hv + ")");
      } catch (Exception pe) { L("grid err: " + pe.Message); }
    };
    probe.Start();
    // CLICK-THROUGH via WINDOW REGION. On this NOREDIRECTIONBITMAP DComp window
    // the WS_EX_LAYERED|WS_EX_TRANSPARENT click-through path is inert (verified
    // live: desktop stayed dead even with it set). SetWindowRgn works instead -
    // the OS clips the window to Clippy's silhouette, so every pixel OUTSIDE him
    // simply isn't the window and the click lands on the desktop (cross-process
    // correct). ApplyRects rebuilds the region as he moves. Start with an EMPTY
    // region so the full-screen window blocks nothing until his rects arrive.
    try { SetWindowRgn(this.Handle, CreateRectRgn(0, 0, 0, 0), false); L("initial empty region set"); } catch (Exception re) { L("region init err: " + re.Message); }
    // NOTE: we do NOT hide WebView2's window anymore - it IS Clippy's display
    // surface (hiding it hid him). Instead the whole overlay is a small box
    // (see the constructor), so that window only covers his corner and the rest
    // of the desktop stays clickable.
    // Display self-heal: poll the primary work area every 3s and re-fit if it
    // changed. Belt-and-suspenders with the WM_DISPLAYCHANGE handler below -
    // a hidden top-level tool window doesn't always receive that message, but
    // the poll always catches a monitor sleep/wake, RDP resize, or DPI change.
    var refit = new Timer(); refit.Interval = 3000;
    refit.Tick += delegate (object s, EventArgs ev) { Refit(); };
    refit.Start();
    // Sight: a first peek ~35s after he's up, then an occasional glance.
    var first = new Timer(); first.Interval = 35000;
    first.Tick += delegate (object s, EventArgs ev) { first.Stop(); SendSight(); };
    first.Start();
    var eyes = new Timer(); eyes.Interval = 360000; // ~every 6 min (CPU vision is ~90s)
    eyes.Tick += delegate (object s, EventArgs ev) { SendSight(); };
    eyes.Start();
    // Watch-along: notice WHAT you're on (browser tab / player title), tell the
    // page so Clippy can co-watch and name the show, and while something plays
    // GLANCE more often (~90s) than the ambient 6-min cadence so he reacts to it.
    int _watchTicks = 0;
    var watch = new Timer(); watch.Interval = 5000;
    watch.Tick += delegate (object s, EventArgs ev) {
      try {
        if (_asleep || _hidden) return;
        string w = ForegroundWatch();
        if (w != _lastWatch) {
          _lastWatch = w;
          if (_ctl != null) { try { _ctl.CoreWebView2.PostWebMessageAsString("watch:" + w); } catch {} }
          L("watch: " + (w.Length > 90 ? w.Substring(0, 90) : w));
          _watchTicks = 0;
          // The tab/window changed to something new -> open his eyes now, not on
          // the next 90s tick, so he's present for what just came up.
          if (w.Length > 0) EventSight(20000);
        }
        if (_lastWatch.Length > 0) { _watchTicks++; if (_watchTicks >= 18) { _watchTicks = 0; SendSight(); } }
      } catch {}
    };
    watch.Start();
    // Roam wider: jump to another monitor now and then (only with 2+ screens).
    // Rare and smooth (GlidePet) so he explores without being a nuisance.
    var jump = new Timer(); jump.Interval = 60000;
    jump.Tick += delegate (object s, EventArgs ev) {
      if (_asleep || _hidden || _dragging) return;
      if (_rng.Next(100) < 30) JumpScreens();
    };
    jump.Start();
    // Politeness poll: every 1s decide whether to step out of the way (fullscreen
    // game / presentation) or come back. Cheap (a shell state query + maybe one
    // foreground-window rect check).
    try { WTSRegisterSessionNotification(this.Handle, 0); } catch {}   // 0 = NOTIFY_FOR_THIS_SESSION -> lock/unlock msgs
    var poli = new Timer(); poli.Interval = 1000;
    poli.Tick += delegate (object s, EventArgs ev) { ApplyVisibility(); };
    poli.Start();
    SetupTray();
    var t = Setup();
  }

  // Clippy's current on-screen rects (client coords); used by WM_NCHITTEST so the
  // window is click-through EXCEPT over him. No window Region - a Region forces an
  // opaque redirection surface and kills the DComp transparency (dark disc).
  volatile int[][] _hit;

  // --- The SECOND window ----------------------------------------------------
  // WebView2 composition hosting spawns its OWN top-level window (class
  // Chrome_WidgetWin_1, title 'Clippy') that IS Clippy's pixels. It sits at our
  // exact rect but is a DIFFERENT cross-process window we don't own. Region-
  // clipping OUR host does nothing to it, so before this fix it covered the whole
  // 520x600 box and ate every desktop click in the corner (verified live on
  // DESKTOP-N6PACMM 2026-07-05: a WindowFromPoint grid over the box returned that
  // window everywhere except the ~2 cells over the orb). THE FIX: give that window
  // WS_EX_TRANSPARENT so the OS hit-tests straight through it; clicks then fall to
  // OUR host, which is region-clipped to Clippy's silhouette - over him we get the
  // message (and forward it to the page); everywhere else there's no window and the
  // click reaches the desktop. Its full pixels (glow, fireflies) still render.
  IntPtr _wv = IntPtr.Zero;
  IntPtr FindWebView(){
    if(_wv != IntPtr.Zero && IsWindow(_wv)){
      var cc = new System.Text.StringBuilder(48); GetClassName(_wv, cc, 48);
      if(cc.ToString() == "Chrome_WidgetWin_1") return _wv;
    }
    _wv = IntPtr.Zero;
    RECTW hr; GetWindowRect(this.Handle, out hr);
    EnumWindows(delegate(IntPtr h, IntPtr l){
      if(!IsWindowVisible(h)) return true;
      var cn = new System.Text.StringBuilder(48); GetClassName(h, cn, 48);
      if(cn.ToString() != "Chrome_WidgetWin_1") return true;
      var tt = new System.Text.StringBuilder(48); GetWindowText(h, tt, 48);
      if(tt.ToString() != "Clippy") return true;
      RECTW r; GetWindowRect(h, out r);
      if(Math.Abs(r.L - hr.L) <= PW && Math.Abs(r.T - hr.T) <= PH){ _wv = h; return false; }
      return true;
    }, IntPtr.Zero);
    return _wv;
  }
  bool _wvLogged = false;
  void EnsureWebView(){
    IntPtr wv = FindWebView();
    if(wv == IntPtr.Zero) return;
    int ex = GetWindowLong(wv, GWL_EXSTYLE);
    if((ex & WS_EX_TRANSPARENT) == 0){
      SetWindowLong(wv, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT);
      if(!_wvLogged){ _wvLogged = true; L("webview window -> click-through (WS_EX_TRANSPARENT); desktop corner freed"); }
    }
    // They are independent top-levels, so WebView2's window does NOT follow when
    // we move the host (verified). Keep it pinned to our rect (drag + refit rely
    // on this) so Clippy's pixels and our input region never drift apart.
    RECTW hr; GetWindowRect(this.Handle, out hr);
    RECTW wr; GetWindowRect(wv, out wr);
    if(wr.L != hr.L || wr.T != hr.T) SetWindowPos(wv, IntPtr.Zero, hr.L, hr.T, 0, 0, SWP_MOVE);
  }

  // --- Drag + persisted position -------------------------------------------
  bool _btnDown = false, _dragging = false;
  int _downSx, _downSy, _lastSx, _lastSy;
  bool _userMoved = false; int _userL, _userT;
  public static string PosPath;
  Rectangle Roam(){ try { var v = SystemInformation.VirtualScreen; if(v.Width > 0 && v.Height > 0) return v; } catch {} return ScreenWA(); }
  // Fully-visible placement. Honour the user's dragged spot ONLY if it still lands
  // Clippy substantially on a CURRENTLY-connected screen; otherwise (a monitor was
  // unplugged, the resolution shrank, or RDP handed a smaller desktop) snap to the
  // primary work-area corner so he is never stranded off-screen as an invisible
  // sliver - the "process runs but I can't see Clippy" bug (DESKTOP-OQ8SROU,
  // 2026-07-16). The old clamp kept only 90px on-screen, which IS a near-invisible
  // sliver; this requires a healthy chunk of him on a real monitor or resets.
  void Place(out int nl, out int nt){
    var wa = ScreenWA();
    int cornerL = wa.Right - PW - 8, cornerT = wa.Bottom - PH - 8;
    if(!_userMoved){ nl = cornerL; nt = cornerT; return; }
    Rectangle box = new Rectangle(_userL, _userT, PW, PH);
    Rectangle bestWA = Rectangle.Empty; int bestArea = 0;
    try {
      foreach(var sc in Screen.AllScreens){
        var inter = Rectangle.Intersect(sc.WorkingArea, box);
        int area = inter.Width * inter.Height;
        if(area > bestArea){ bestArea = area; bestWA = sc.WorkingArea; }
      }
    } catch {}
    if(bestWA.IsEmpty || bestArea < 160*160){ nl = cornerL; nt = cornerT; return; }  // his saved monitor is gone -> reset
    nl = Math.Max(bestWA.Left, Math.Min(_userL, bestWA.Right - PW));   // FULLY inside that screen, not a 90px edge sliver
    nt = Math.Max(bestWA.Top,  Math.Min(_userT, bestWA.Bottom - PH));
  }
  void MovePet(int dx, int dy){
    var vs = Roam();
    int nl = this.Left + dx, nt = this.Top + dy;
    nl = Math.Max(vs.Left - PW + 90, Math.Min(nl, vs.Right - 90));   // keep >=90px on-screen
    nt = Math.Max(vs.Top,            Math.Min(nt, vs.Bottom - 90));
    this.Left = nl; this.Top = nt;
    _userMoved = true; _userL = nl; _userT = nt;
    IntPtr wv = FindWebView(); if(wv != IntPtr.Zero) SetWindowPos(wv, IntPtr.Zero, nl, nt, 0, 0, SWP_MOVE);
  }
  // GlidePet: like MovePet but EASED over ~0.45s instead of an instant jump, so
  // autonomous drift reads as him gliding across the desktop, not teleporting
  // (Alfredo: "remove teleports"). Drag stays on the instant MovePet path - a
  // hand-drag must track the cursor 1:1. A new glide just retargets the running
  // timer; grabbing him cancels it (see the button-down handler).
  Timer _glide; int _glTL, _glTT;
  void GlidePet(int dx, int dy){
    var vs = Roam();
    int tl = this.Left + dx, tt = this.Top + dy;
    tl = Math.Max(vs.Left - PW + 90, Math.Min(tl, vs.Right - 90));
    tt = Math.Max(vs.Top,            Math.Min(tt, vs.Bottom - 90));
    _glTL = tl; _glTT = tt;
    if (_glide == null) {
      _glide = new Timer(); _glide.Interval = 16;   // ~60fps
      _glide.Tick += delegate (object s, EventArgs e) {
        int cl = this.Left, ct = this.Top;
        int nl = cl + (int)Math.Round((_glTL - cl) * 0.18);   // ease-out toward target
        int nt = ct + (int)Math.Round((_glTT - ct) * 0.18);
        if (nl == cl && _glTL != cl) nl += (_glTL > cl) ? 1 : -1;   // never stall on rounding
        if (nt == ct && _glTT != ct) nt += (_glTT > ct) ? 1 : -1;
        bool done = (Math.Abs(_glTL - nl) <= 1 && Math.Abs(_glTT - nt) <= 1);
        if (done) { nl = _glTL; nt = _glTT; }
        this.Left = nl; this.Top = nt;
        _userMoved = true; _userL = nl; _userT = nt;
        IntPtr wv = FindWebView(); if (wv != IntPtr.Zero) SetWindowPos(wv, IntPtr.Zero, nl, nt, 0, 0, SWP_MOVE);
        if (done) _glide.Stop();
      };
    }
    _glide.Start();
  }
  void SavePos(){ try { if(PosPath != null) File.WriteAllText(PosPath, "{\"l\":" + _userL + ",\"t\":" + _userT + "}"); } catch {} }
  void LoadPos(){
    try {
      if(PosPath == null || !File.Exists(PosPath)) return;
      var s = File.ReadAllText(PosPath);
      var a = Regex.Match(s, "\"l\":(-?\\d+)"); var b = Regex.Match(s, "\"t\":(-?\\d+)");
      if(a.Success && b.Success){ _userL = int.Parse(a.Groups[1].Value); _userT = int.Parse(b.Groups[1].Value); _userMoved = true; }
    } catch {}
  }

  // --- Politeness: step out of the way for fullscreen + a locked screen -------
  // A desktop pet that photobombs a game or a fullscreen video is the #1 reason
  // people rip one out (Vista-gadget research, 2026-07-05). So we vanish while a
  // game/presentation is up or the session is locked, and come right back after.
  bool _hidden = false, _locked = false;
  bool ShouldHide(){
    if(_manualHidden) return true;   // user chose Hide from the tray menu
    if(_locked) return true;
    // SHQueryUserNotificationState is the one reliable signal: it reports 3 when a
    // real D3D fullscreen app (a game) owns the screen and 4 during presentation.
    // We deliberately DON'T try to infer fullscreen from window rectangles: a
    // maximised window on a monitor without a taskbar fills the whole monitor and
    // is indistinguishable from fullscreen by geometry (verified 2026-07-05 -
    // maximised Chrome on the 2nd monitor false-tripped it and hid Clippy). Better
    // to occasionally stay up during a borderless video than to vanish wrongly.
    try { int st; if(SHQueryUserNotificationState(out st) == 0 && (st == QUNS_D3D_FULLSCREEN || st == QUNS_PRESENTATION)) return true; } catch {}
    return false;
  }
  void ApplyVisibility(){
    try {
      bool hide = ShouldHide();
      if(hide){
        if(!_hidden){
          _hidden = true;
          IntPtr wv = FindWebView(); if(wv != IntPtr.Zero) ShowWindow(wv, SW_HIDE);
          ShowWindow(this.Handle, SW_HIDE);
          L("hide (fullscreen/locked) - stepping out of the way");
        }
      } else {
        if(_hidden){ _hidden = false; L("show - the coast is clear"); EnsureWebView(); }
        // Self-heal: whenever he SHOULD be visible, make sure he actually is.
        // If a single transition ShowWindow ever missed, this 1s poll fixes it -
        // so a game/lock can never leave Clippy stuck invisible (would look dead).
        if(!IsWindowVisible(this.Handle)) ShowWindow(this.Handle, SW_SHOWNA);
        IntPtr wv = FindWebView(); if(wv != IntPtr.Zero && !IsWindowVisible(wv)) ShowWindow(wv, SW_SHOWNA);
      }
    } catch (Exception ex) { L("visibility err: " + ex.Message); }
  }

  // --- Tray icon: the control surface (show/hide, summon, pause, quit) --------
  // Until now the only way to hide or stop Clippy was Task Manager. A NotifyIcon
  // gives him a real presence: right-click for a menu, double-click to summon him
  // back to the corner. Survives an Explorer restart via the TaskbarCreated
  // broadcast (tray icons are destroyed when Explorer restarts and must re-add).
  public static string IconPath, OffPath;
  System.Windows.Forms.NotifyIcon _tray;
  bool _manualHidden = false, _asleep = false;
  int _taskbarCreatedMsg = 0;
  System.Windows.Forms.ToolStripMenuItem _miHide, _miPause;
  void SetupTray(){
    try {
      _tray = new System.Windows.Forms.NotifyIcon();
      try { if(IconPath != null && File.Exists(IconPath)) _tray.Icon = new Icon(IconPath); else _tray.Icon = SystemIcons.Application; }
      catch { _tray.Icon = SystemIcons.Application; }
      _tray.Text = "Clippy";
      var menu = new System.Windows.Forms.ContextMenuStrip();
      _miHide  = new System.Windows.Forms.ToolStripMenuItem("Hide Clippy");     _miHide.Click  += delegate { ToggleManualHide(); };
      var miCorner = new System.Windows.Forms.ToolStripMenuItem("Bring to corner"); miCorner.Click += delegate { ResetToCorner(); };
      _miPause = new System.Windows.Forms.ToolStripMenuItem("Pause watching");   _miPause.Click += delegate { TogglePause(); };
      var miQuit = new System.Windows.Forms.ToolStripMenuItem("Quit Clippy");    miQuit.Click   += delegate { QuitClippy(); };
      menu.Items.Add(_miHide); menu.Items.Add(miCorner); menu.Items.Add(_miPause);
      menu.Items.Add(new System.Windows.Forms.ToolStripSeparator()); menu.Items.Add(miQuit);
      _tray.ContextMenuStrip = menu;
      _tray.DoubleClick += delegate { ResetToCorner(); };   // double-click tray = summon
      _tray.Visible = true;
      _taskbarCreatedMsg = RegisterWindowMessage("TaskbarCreated");
      L("tray icon up");
    } catch (Exception ex) { L("tray err: " + ex.Message); }
  }
  void ToggleManualHide(){ _manualHidden = !_manualHidden; if(_miHide != null) _miHide.Text = _manualHidden ? "Show Clippy" : "Hide Clippy"; ApplyVisibility(); L(_manualHidden ? "hidden by user (tray)" : "shown by user (tray)"); }
  void ResetToCorner(){
    _manualHidden = false; if(_miHide != null) _miHide.Text = "Hide Clippy";
    _userMoved = false;                                    // back to the auto corner
    try { if(OffPath != null && File.Exists(OffPath)) File.Delete(OffPath); } catch {}
    Refit(); ApplyVisibility(); L("summoned to corner (tray)");
  }
  void TogglePause(){ _asleep = !_asleep; if(_miPause != null) _miPause.Text = _asleep ? "Resume watching" : "Pause watching"; L(_asleep ? "vision paused (tray)" : "vision resumed (tray)"); }
  void QuitClippy(){
    // Write the off-flag FIRST so the supervisor doesn't just revive him in 30s;
    // clicking the Clippy shortcut (which clears the flag) brings him back.
    try { if(OffPath != null) File.WriteAllText(OffPath, "off"); } catch {}
    L("quit by user (tray) - off-flag set");
    try { if(_tray != null){ _tray.Visible = false; _tray.Dispose(); } } catch {}
    System.Windows.Forms.Application.Exit();
  }
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
        try {
          string mm = aw.TryGetWebMessageAsString();
          if (mm != null && mm.StartsWith("rects ")) ApplyRects(mm.Substring(6));
          else if (mm != null && mm.StartsWith("vp ")) L("viewport " + mm.Substring(3) + " vs client " + Wv + "x" + Hv);
          else if (mm == "sight") {
            // Page asked him to LOOK now (he senses you're stuck). Throttled.
            if (!_asleep && !_hidden) EventSight(30000);
          }
          else if (mm != null && mm.StartsWith("move ")) {
            // Page-driven drift: Clippy wanders the monitor by sliding the whole
            // overlay. MovePet clamps on-screen; skip while asleep/hidden or mid-drag
            // so autonomous drift never fights a fullscreen game or the user's hand.
            if (!_asleep && !_hidden && !_dragging) {
              var pp = mm.Substring(5).Split(' ');
              int mdx, mdy;
              if (pp.Length == 2 && int.TryParse(pp[0], out mdx) && int.TryParse(pp[1], out mdy)) GlidePet(mdx, mdy);
            }
          }
        } catch {}
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
  try{w.postMessage('vp '+window.innerWidth+'x'+window.innerHeight);}catch(e){}
  if(!document.getElementById('pet-style')){var st=document.createElement('style');st.id='pet-style';st.textContent='#clippy-shell{right:60px!important;bottom:64px!important;}';(document.head||document.documentElement).appendChild(st);}
  if(!window.__petSight){window.__petSight=1;w.addEventListener('message',function(ev){try{var d=ev.data;if(typeof d!=='string')return;if(d.slice(0,4)==='see:'){var b=d.slice(4);if(window.NX&&NX.clippy&&NX.clippy.seeSurroundings)NX.clippy.seeSurroundings(b);}else if(d.slice(0,6)==='watch:'){if(window.NX&&NX.clippy&&NX.clippy.onWatch)NX.clippy.onWatch(d.slice(6));}}catch(e){}});}
  var SEL='#clippy-shell,.clippy-bubble';
  var PAD=2,last='';   // tight click radius - hugs the orb itself
  function vis(el){try{var r=el.getBoundingClientRect();return r.width>2&&r.height>2&&el.getClientRects().length>0;}catch(e){return false;}}
  function tick(){try{var vw=window.innerWidth,vh=window.innerHeight,o=[];document.querySelectorAll(SEL).forEach(function(el){if(!vis(el))return;var r=el.getBoundingClientRect();var orb=(el.id==='clippy-shell');var x=r.left,y=r.top,x2=r.left+r.width,y2=r.top+r.height;if(orb){x-=PAD;y-=PAD;x2+=PAD;y2+=PAD;}x=Math.max(0,x);y=Math.max(0,y);x2=Math.min(vw,x2);y2=Math.min(vh,y2);o.push({x:Math.round(x),y:Math.round(y),w:Math.round(x2-x),h:Math.round(y2-y),c:orb?1:0});});var s=JSON.stringify(o);if(s!==last){last=s;w.postMessage('rects '+s);}}catch(e){}}
  setInterval(tick,100);tick();setTimeout(tick,500);setTimeout(tick,1500);
} catch(e){} })();";

  // Clippy's eyes: grab the desktop, shrink it, hand it to the page (which runs
  // it past the vision model and makes him riff). Capture is plain GDI; we post
  // it to our OWN webview (no network here) so it stays a local hand-off.
  // --- WATCH-ALONG + WIDER EYES ------------------------------------------------
  // "watch anime with me, detect what is being watched, read the link on any
  // browser, bigger scope." We read the FOREGROUND window's title + process so
  // Clippy knows the show/page. That title is the browser TAB TITLE (it carries
  // the anime name and the site) - not keystrokes, not the raw URL bar (UI-Auto
  // for that is heavy and the title already names the show). Only browsers and
  // media players qualify; anything else reports nothing.
  static readonly string[] _watchApps = new string[]{
    "chrome","msedge","firefox","brave","opera","vivaldi","arc","librewolf","zen",
    "vlc","mpv","mpc-hc64","mpc-hc","mpc-be64","potplayermini64","potplayer","wmplayer" };
  string _lastWatch = "";
  Random _rng = new Random();
  string ForegroundWatch(){
    try {
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "";
      var sb = new System.Text.StringBuilder(512);
      GetWindowText(h, sb, sb.Capacity);
      string title = sb.ToString().Trim();
      if (title.Length == 0) return "";
      uint pid; GetWindowThreadProcessId(h, out pid);
      string proc = "";
      try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch {}
      if (Array.IndexOf(_watchApps, proc) < 0) return "";
      return proc + "|" + title;
    } catch { return ""; }
  }
  // The monitor Clippy should look at: the one showing the foreground window (the
  // video), so his eyes follow the show even on a second screen ("bigger scope").
  System.Drawing.Rectangle SightBounds(){
    try { IntPtr h = GetForegroundWindow(); if (h != IntPtr.Zero) { var sc = Screen.FromHandle(h); if (sc != null) return sc.Bounds; } } catch {}
    try { return Screen.PrimaryScreen.Bounds; } catch { return new System.Drawing.Rectangle(0,0,1920,1080); }
  }
  // "able to jump screens": glide to a random spot on another monitor. Place()
  // then keeps him fully on whichever screen he landed on.
  void JumpScreens(){
    try {
      var all = Screen.AllScreens;
      if (all == null || all.Length < 2) return;
      var cur = Screen.FromControl(this);
      var others = new List<Screen>();
      foreach (var s in all) if (s.DeviceName != cur.DeviceName) others.Add(s);
      if (others.Count == 0) return;
      var dst = others[_rng.Next(others.Count)].WorkingArea;
      int tx = dst.Left + _rng.Next(Math.Max(1, dst.Width  - PW));
      int ty = dst.Top  + _rng.Next(Math.Max(1, dst.Height - PH));
      GlidePet(tx - this.Left, ty - this.Top);
      L("jump screens -> " + dst.Left + "," + dst.Top);
    } catch {}
  }
  // Event-driven sight (Clippy's #2 wish): LOOK when something happens - a tab
  // change, or a page-side "sight" request when he's clearly stuck - instead of
  // only on the ambient timer. Throttled so a storm of events never pins the GPU.
  int _lastEventSightTick = 0;
  void EventSight(int cooldownMs){
    try {
      if (_asleep || _hidden) return;
      int t = Environment.TickCount;
      if (_lastEventSightTick != 0 && (t - _lastEventSightTick) < cooldownMs) return;
      _lastEventSightTick = t;
      SendSight();
    } catch {}
  }
  static ImageCodecInfo _jpg;
  void SendSight(){
    try {
      if (_ctl == null) return;
      if (_asleep || _hidden) return;   // paused from the tray, or hidden - don't grab the screen or spend GPU
      var b = SightBounds();            // the monitor with the video, not always primary
      string b64;
      using (var full = new Bitmap(b.Width, b.Height))
      using (var g = Graphics.FromImage(full)) {
        g.CopyFromScreen(b.X, b.Y, 0, 0, new Size(b.Width, b.Height));
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

  int _rectLogN = 0;
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
      // Diagnostic: log the first few rect updates so the true _hit values are
      // visible (small ~92px near bottom-right = healthy; anything spanning the
      // viewport = the bug is the rect source, not the hit-test).
      if (_rectLogN < 4) { _rectLogN++; L("rects[" + list.Count + "] " + (json.Length > 220 ? json.Substring(0, 220) : json)); }
      ApplyRegion(list);
    } catch (Exception ex) { L("rects err: " + ex.Message); }
  }

  // Clip the window to the UNION of Clippy's rects so ONLY his silhouette is the
  // window; every click outside it reaches the desktop. Orb rects (c==1) become
  // ellipses padded to include the glow; bubble rects (c==0) become padded
  // rectangles. Rebuilt every time his rects change (move / center-stage / bubble
  // open/close). SetWindowRgn takes ownership of the final region, so we must NOT
  // delete it; we DO delete the intermediate sub-regions after combining.
  int _regionLogN = 0;
  void ApplyRegion(List<int[]> rects){
    try {
      IntPtr full = CreateRectRgn(0, 0, 0, 0);   // empty; OR every piece into it
      int n = 0;
      foreach (var r in rects) {
        int x = r[0], y = r[1], w = r[2], h = r[3], c = r[4];
        if (w <= 1 || h <= 1) continue;
        // Pad the region OUT past the hard content rect so soft shadows render
        // instead of being clipped square: the orb carries drop-shadow soul-glow
        // (up to ~40px) and the bubble/ORACLE panel a box-shadow glow (0 0 26px)
        // + a 6/22px drop. 8px cut both flat ("allow shadow" - Alfredo 2026-07-17).
        int pad = (c == 1) ? 44 : 32;   // orb: soul-glow halo; bubble/panel: glow + drop-shadow
        IntPtr piece = (c == 1)
          ? CreateEllipticRgn(x - pad, y - pad, x + w + pad, y + h + pad)
          : CreateRectRgn(x - pad, y - pad, x + w + pad, y + h + pad);
        CombineRgn(full, full, piece, RGN_OR);
        DeleteObject(piece);
        n++;
      }
      SetWindowRgn(this.Handle, full, true);   // system owns 'full' now - do not delete
      if (_regionLogN < 4) { _regionLogN++; L("region applied (" + n + " parts)"); }
      // First rects arrive ~0.5s after nav - earliest point WebView2's window
      // exists. Make it click-through NOW so the dead corner is freed promptly
      // (the 3s refit only maintains it thereafter).
      EnsureWebView();
    } catch (Exception ex) { L("region err: " + ex.Message); }
  }

  protected override void WndProc(ref Message m){
    // WM_DISPLAYCHANGE (0x7E) fires on resolution/monitor changes; WM_DPICHANGED
    // (0x2E0) on a per-monitor DPI change. Re-fit so the overlay tracks the new
    // desktop instead of being stranded at the old geometry.
    if (m.Msg == 0x007E || m.Msg == 0x02E0) { L("display msg 0x" + m.Msg.ToString("X")); Refit(); }
    // Session lock/unlock -> hide while the screen is locked (don't render Clippy
    // to a lock screen), reappear on unlock. The 1s poll also catches it, but this
    // reacts instantly.
    if (m.Msg == WM_WTSSESSION_CHANGE) {
      int ev = (int)m.WParam;
      if (ev == WTS_SESSION_LOCK)   { _locked = true;  ApplyVisibility(); }
      if (ev == WTS_SESSION_UNLOCK) { _locked = false; ApplyVisibility(); }
    }
    // Explorer restarted (it crashed / was restarted): tray icons are wiped and
    // must be re-added, or Clippy loses his only control surface.
    if (_taskbarCreatedMsg != 0 && m.Msg == _taskbarCreatedMsg && _tray != null) {
      try { _tray.Visible = false; _tray.Visible = true; L("tray re-added after Explorer restart"); } catch {}
    }
    // A mouse message reaching us means the pointer is genuinely over Clippy:
    // WebView2's window is click-through and OUR window is region-clipped to his
    // silhouette, so the OS only routes his pixels here (everything else goes to
    // the desktop). We turn press+drag into MOVING him, and a clean press+release
    // into a real click replayed to the page.
    if (m.Msg == 0x201) {                 // WM_LBUTTONDOWN
      POINT cp; GetCursorPos(out cp);
      _btnDown = true; _dragging = false;
      if (_glide != null) _glide.Stop();   // a hand on him cancels any autonomous glide
      _downSx = cp.X; _downSy = cp.Y; _lastSx = cp.X; _lastSy = cp.Y;
      try { SetCapture(this.Handle); } catch {}
      return;                             // buffer: decide click-vs-drag on move/up
    }
    if (m.Msg == 0x200 && _btnDown) {     // WM_MOUSEMOVE while pressed
      POINT cp; GetCursorPos(out cp);
      if (!_dragging && Math.Abs(cp.X - _downSx) + Math.Abs(cp.Y - _downSy) > 4) _dragging = true;
      if (_dragging) { MovePet(cp.X - _lastSx, cp.Y - _lastSy); _lastSx = cp.X; _lastSy = cp.Y; }
      return;
    }
    if (m.Msg == 0x202 && _btnDown) {     // WM_LBUTTONUP
      bool wasDrag = _dragging;
      _btnDown = false; _dragging = false;
      try { ReleaseCapture(); } catch {}
      if (wasDrag) { SavePos(); }
      else if (_ctl != null) {            // no drag => a real click: replay it to the page
        var pt = new Point(_downSx - this.Left, _downSy - this.Top);
        try {
          _ctl.SendMouseInput(CoreWebView2MouseEventKind.LeftButtonDown, CoreWebView2MouseEventVirtualKeys.None, 0, pt);
          _ctl.SendMouseInput(CoreWebView2MouseEventKind.LeftButtonUp,   CoreWebView2MouseEventVirtualKeys.None, 0, pt);
        } catch {}
      }
      return;
    }
    // Hover (no button) and right-click: forward straight through so Clippy still
    // reacts to the pointer and any context actions keep working.
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
[ClippyComp]::PosPath  = Join-Path $logDir 'pet-pos.json'   # remembers where you dragged him
[ClippyComp]::OffPath  = Join-Path $logDir 'pet-off'        # tray Quit writes this; supervisor honours it
$icoTry = @((Join-Path $PSScriptRoot 'clippy.ico'), (Join-Path $env:LOCALAPPDATA 'NexusClippy\clippy.ico')) | Where-Object { Test-Path $_ } | Select-Object -First 1
[ClippyComp]::IconPath = $icoTry

try {
  $form = New-Object ClippyComp
  Log "form created - running message loop"
  [System.Windows.Forms.Application]::Run($form)
} catch { Log "run failed: $($_.Exception.Message)" }
Log "pet-comp exited"
