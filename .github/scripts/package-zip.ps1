<#
.SYNOPSIS
    Assembles the manual-install ZIP kit (TECHNICAL_SPEC 9.1):
    yawametrics-<version>-windows-x64.zip
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$BuildDir = "",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $BuildDir) { $BuildDir = Join-Path $RepoRoot (Join-Path "native" (Join-Path ".build" "windows-ci-x64")) }
if (-not $OutDir)   { $OutDir = Join-Path $RepoRoot "package" }

$Dll = Join-Path $BuildDir "yawametrics.dll"
if (-not (Test-Path $Dll)) {
    throw "yawametrics.dll not found at $Dll - build the native preset first."
}

$Staging = Join-Path $OutDir "staging"
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $Staging (Join-Path "obs-plugins" "64bit")) -Force | Out-Null
$StagingLocaleDir = Join-Path (Join-Path (Join-Path (Join-Path $Staging "data") "obs-plugins") "yawametrics") "locale"
New-Item -ItemType Directory -Path $StagingLocaleDir -Force | Out-Null

# obs-plugins/64bit/yawametrics.dll
Copy-Item $Dll (Join-Path $Staging (Join-Path "obs-plugins" (Join-Path "64bit" "yawametrics.dll")))

# data/obs-plugins/yawametrics/*
$DataDir = Join-Path $RepoRoot (Join-Path "native" "data")
$WidgetDataDir = Join-Path $Staging (Join-Path "data" (Join-Path "obs-plugins" "yawametrics"))
Copy-Item (Join-Path $DataDir "yawametrics.qss") $WidgetDataDir -Force
Copy-Item (Join-Path $DataDir "widget.html") $WidgetDataDir -Force
Copy-Item (Join-Path $DataDir (Join-Path "locale" "ru-RU.ini")) (Join-Path $WidgetDataDir "locale") -Force
Copy-Item (Join-Path $DataDir (Join-Path "locale" "en-US.ini")) (Join-Path $WidgetDataDir "locale") -Force

# README.txt / obs-instructions.txt
Copy-Item (Join-Path $RepoRoot (Join-Path "installer" "README.txt")) $Staging -Force
Copy-Item (Join-Path $RepoRoot (Join-Path "installer" "obs-instructions.txt")) $Staging -Force

# Compress
$ZipName = "yawametrics-$Version-windows-x64.zip"
$ZipPath = Join-Path $OutDir $ZipName
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path (Join-Path $Staging "*") -DestinationPath $ZipPath -CompressionLevel Optimal

$size = (Get-Item $ZipPath).Length
Write-Host "Package ready: $ZipPath ($([math]::Round($size / 1KB, 1)) KiB)"
Write-Host "Staging directory: $Staging"

if ($env:GITHUB_OUTPUT) {
    Add-Content -Path $env:GITHUB_OUTPUT -Value "zipPath=$ZipPath"
    Add-Content -Path $env:GITHUB_OUTPUT -Value "stagingDir=$Staging"
}
