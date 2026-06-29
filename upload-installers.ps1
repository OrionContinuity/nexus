<#
upload-installers.ps1 — put the Tools-modal install files into Supabase Storage so the NEXUS
"Tools" buttons work (from your phone + the deployed site). Creates a PUBLIC bucket 'installers'
and uploads the 3 files. The anon key CANNOT do this (RLS) — you need your SERVICE ROLE key
(Supabase dashboard → Project Settings → API → service_role secret). It is a SECRET: pass it via
env var, do NOT paste it into chat or commit it.

  $env:SB_SERVICE_KEY = "<your service_role key>"
  powershell -ExecutionPolicy Bypass -File upload-installers.ps1

Or just do it by hand: Supabase dashboard → Storage → New bucket 'installers' (PUBLIC) → upload the 3 files.
#>
param([string]$Key = $env:SB_SERVICE_KEY)
$SB = 'https://oprsthfxqrdbwdvommpw.supabase.co'
if (-not $Key) { Write-Host "Set `$env:SB_SERVICE_KEY to your Supabase service_role key first (see header)." -ForegroundColor Yellow; exit 1 }

$files = @(
  @{ path = (Join-Path $PSScriptRoot "clippy-update.ps1");                  name = "clippy-update.ps1";       type = "text/plain" }
  @{ path = "C:\Users\Clippy\Desktop\Clippy-for-a-friend.zip";              name = "Clippy-for-a-friend.zip"; type = "application/zip" }
  @{ path = "C:\Users\Clippy\Desktop\OpenTether\OpenTether.apk";            name = "OpenTether.apk";          type = "application/vnd.android.package-archive" }
  @{ path = "C:\Users\Clippy\Desktop\OpenTether Desktop\OpenTether-Windows.zip"; name = "OpenTether-Windows.zip"; type = "application/zip" }
  @{ path = "C:\Users\Clippy\Desktop\OpenTether\OpenTether-QR.png";              name = "OpenTether-QR.png";      type = "image/png" }
)
$H = @{ apikey = $Key; Authorization = "Bearer $Key" }

# 1) ensure a PUBLIC 'installers' bucket
try {
  Invoke-RestMethod -Uri "$SB/storage/v1/bucket" -Method Post -Headers $H -ContentType 'application/json' `
    -Body '{"id":"installers","name":"installers","public":true}' -TimeoutSec 20 | Out-Null
  Write-Host "[ok] created public bucket 'installers'" -ForegroundColor Green
} catch { Write-Host "[..] bucket 'installers' already exists (ok)" }

# 2) upload each file (upsert)
foreach ($f in $files) {
  if (-not (Test-Path $f.path)) { Write-Host "[!!] missing: $($f.path)" -ForegroundColor Yellow; continue }
  $bytes = [System.IO.File]::ReadAllBytes($f.path)
  $hh = $H.Clone(); $hh['Content-Type'] = $f.type; $hh['x-upsert'] = 'true'
  try {
    Invoke-RestMethod -Uri "$SB/storage/v1/object/installers/$($f.name)" -Method Post -Headers $hh -Body $bytes -TimeoutSec 180 | Out-Null
    Write-Host ("[ok] uploaded {0} ({1:N1} MB)  ->  {2}/storage/v1/object/public/installers/{3}" -f $f.name, ($bytes.Length/1MB), $SB, $f.name) -ForegroundColor Green
  } catch { Write-Host "[!!] upload failed for $($f.name): $($_.Exception.Message)" -ForegroundColor Red }
}
Write-Host "`nDone. The NEXUS Tools buttons now download these. Test: open NEXUS -> Tools." -ForegroundColor Cyan
