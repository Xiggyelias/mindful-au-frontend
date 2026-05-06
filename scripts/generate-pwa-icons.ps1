# Prefer: npm run generate:pwa-icons (rasters public/assets/icons/pwa-icon.svg via sharp).
$ErrorActionPreference = "Stop"
$frontendRoot = Split-Path $PSScriptRoot -Parent
Set-Location $frontendRoot
$mjs = Join-Path $PSScriptRoot "generate-pwa-icons.mjs"
if (-not (Test-Path $mjs)) {
  throw "Missing scripts/generate-pwa-icons.mjs"
}
node $mjs
exit $LASTEXITCODE
