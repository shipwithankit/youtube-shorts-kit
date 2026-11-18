# Builds dist/shorts-kit-v<version>.zip containing only the files Chrome needs.
# Uses forward slashes inside the zip so it unpacks correctly on Windows, macOS and Linux.
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File scripts/package.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
$dist = Join-Path $root "dist"
$zipPath = Join-Path $dist "shorts-kit-v$version.zip"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $dist | Out-Null

$files = @("manifest.json", "background.js", "content.js", "content.css", "inject.js", "shared.js",
  "library.html", "library.css", "library.js", "LICENSE", "PRIVACY.md",
  "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png")

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $full = Join-Path $root $f
    if (-not (Test-Path $full)) { throw "Missing file: $f" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, "shorts-kit/$f", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
Write-Output "Built $zipPath"
