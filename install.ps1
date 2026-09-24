# MySQL UI one-click installer (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/dolphinZzv/mysqlUI/main/install.ps1 | iex
#
# Options:
#   $env:VERSION = "v0.1.0"          install a specific release (default: latest)
#   $env:INSTALL_DIR = "C:\tools"    install directory
#
$ErrorActionPreference = "Stop"

$repo = "dolphinZzv/mysqlUI"
$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }

$version = $env:VERSION
if (-not $version) {
    Write-Host "==> Resolving latest release..." -ForegroundColor Cyan
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing
    $version = $release.tag_name
}
if (-not $version) { throw "could not determine the latest version" }

$asset = "mysqlui-windows-$arch.exe"
$url = "https://github.com/$repo/releases/download/$version/$asset"

$dir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\mysqlui" }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$dest = Join-Path $dir "mysqlui.exe"

Write-Host "==> Downloading $asset ($version)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

# Add to the user PATH if needed.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
    Write-Host "==> Added $dir to your PATH (restart your terminal to use 'mysqlui')." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Installed to $dest" -ForegroundColor Green
Write-Host "Start it with:  mysqlui   (then open http://localhost:8787)"
