<#
deploy-clippy-pool.ps1 — deploy the clippy-pool Supabase Edge Function (the cross-machine Clippy
fan-out the deployed NEXUS site uses). The CLI is already installed by Claude at
%LOCALAPPDATA%\Programs\supabase\supabase.exe and the function is staged in .\supabase\functions\.

ONE-TIME LOGIN (your account token stays on this PC — get it from
https://supabase.com/dashboard/account/tokens):
    & "$env:LOCALAPPDATA\Programs\supabase\supabase.exe" login

THEN just run:
    powershell -ExecutionPolicy Bypass -File deploy-clippy-pool.ps1
    # optional, only if you set api_token in clippy.cfg.json:
    powershell -ExecutionPolicy Bypass -File deploy-clippy-pool.ps1 -ClippyToken "<token>"
#>
param([string]$ClippyToken = $env:CLIPPY_TOKEN)
$ErrorActionPreference = 'Continue'
$sb  = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe"
$ref = "oprsthfxqrdbwdvommpw"
Set-Location $PSScriptRoot                      # run from the home, where supabase\ lives

if (-not (Test-Path $sb)) { Write-Host "Supabase CLI missing at $sb" -ForegroundColor Red; exit 1 }

& $sb projects list *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. First run (token stays local):" -ForegroundColor Yellow
  Write-Host "    & `"$sb`" login" -ForegroundColor Yellow
  exit 1
}

if ($ClippyToken) {
  Write-Host "[..] setting CLIPPY_TOKEN secret"
  & $sb secrets set "CLIPPY_TOKEN=$ClippyToken" --project-ref $ref
}

Write-Host "[..] deploying clippy-pool to project $ref ..."
& $sb functions deploy clippy-pool --project-ref $ref
if ($LASTEXITCODE -eq 0) {
  Write-Host "`n[ok] Deployed → https://$ref.supabase.co/functions/v1/clippy-pool" -ForegroundColor Green
  Write-Host "     Test:  curl -X POST https://$ref.supabase.co/functions/v1/clippy-pool -H 'Content-Type: application/json' -d '{\"prompt\":\"hi\"}'"
} else {
  Write-Host "[!!] deploy failed — see the CLI output above." -ForegroundColor Red
}
