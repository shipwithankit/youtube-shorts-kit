# Builds dist/shorts-kit-v<version>.zip containing only the files Chrome needs.
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File scripts/package.ps1
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
$stage = Join-Path $root "dist\shorts-kit"
$zip = Join-Path $root "dist\shorts-kit-v$version.zip"
if (Test-Path (Join-Path $root "dist")) { Remove-Item (Join-Path $root "dist") -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
$files = "manifest.json","background.js","content.js","content.css","inject.js","shared.js","library.html","library.css","library.js","LICENSE","PRIVACY.md"
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $stage }
Copy-Item (Join-Path $root "icons") $stage -Recurse
Compress-Archive -Path $stage -DestinationPath $zip
Write-Output "Built $zip"
