<#
.SYNOPSIS
    Downloads and prepares every dependency required to build yawametrics.dll
    (see TECHNICAL_SPEC section 8.1).

.DESCRIPTION
    Pipeline of dependencies:

        Qt6 prebuilt         -> native/.deps/qt6
        obs-deps             -> native/.deps/obs-deps
        obs-studio sources   -> native/.deps/obs-studio   (+ generates obsconfig.h)
        obs-studio portable  -> native/.deps/obs-studio-portable
        paths manifest       -> native/.deps/obs-include-dirs.cmake
        import libraries     -> native/.deps/import-libs/{obs,obs-frontend-api}.lib

    Import libraries are generated from the portable DLLs:
    dumpbin /exports -> .def -> lib /def /machine:x64.

    The script is idempotent: every step is skipped when its output already
    exists (pass -Force to redo everything). Archives are validated against
    the ZIP signature, so an HTML error page returned by GitHub (a known
    failure mode on 404) fails fast instead of corrupting the tree.

.PARAMETER ObsVersion
    OBS Studio version used for headers and the portable ZIP (default 29.1.3,
    the last OBS release shipping a Windows portable ZIP).

.PARAMETER ObsDepsTag
    obs-deps release tag (default: from native/buildspec.json).

.PARAMETER Force
    Re-download and regenerate everything.

.EXAMPLE
    ./scripts/Install-ObsDeps.ps1
#>
[CmdletBinding()]
param(
    [string]$ObsVersion = "",
    [string]$ObsDepsTag = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DepsDir = Join-Path $RepoRoot "native\.deps"
$CacheDir = Join-Path $DepsDir ".downloads"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Read-BuildSpec {
    $path = Join-Path $RepoRoot "native\buildspec.json"
    if (-not (Test-Path $path)) {
        throw "native/buildspec.json not found at $path"
    }
    Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

$BuildSpec = Read-BuildSpec
if (-not $ObsVersion) { $ObsVersion = $BuildSpec.dependencies."obs-studio" }
if (-not $ObsDepsTag) { $ObsDepsTag = $BuildSpec.dependencies."obs-deps" }

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-ZipSignature {
    # GitHub may return an HTML page instead of an archive when a release
    # asset is missing (404). Detect that before extraction.
    param([string]$Path)
    $bytes = New-Object byte[] 4
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        [void]$stream.Read($bytes, 0, 4)
    }
    finally {
        $stream.Close()
    }
    if ($bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) {
        throw "Not a ZIP archive: $Path (first bytes: $($bytes -join ' ')). " +
              "GitHub probably returned an HTML error page — check the URL/tag."
    }
}

function Get-RemoteArchive {
    param(
        [string]$Uri,
        [string]$Name
    )
    if (-not (Test-Path $CacheDir)) {
        New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
    }
    $outFile = Join-Path $CacheDir $Name
    if ((Test-Path $outFile) -and -not $Force) {
        Write-Host "Using cached $Name"
        Assert-ZipSignature -Path $outFile
        return $outFile
    }
    Write-Host "Downloading $Uri"
    Invoke-WebRequest -Uri $Uri -OutFile $outFile -UseBasicParsing
    Assert-ZipSignature -Path $outFile
    return $outFile
}

function Expand-ZipNormalized {
    # Extracts an archive and flattens a single top-level directory,
    # so the destination always directly contains the payload.
    param(
        [string]$ZipPath,
        [string]$Destination
    )
    $tempDir = Join-Path $CacheDir ("tmp-" + [System.IO.Path]::GetFileNameWithoutExtension($ZipPath))
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
    Expand-Archive -Path $ZipPath -DestinationPath $tempDir -Force

    $payload = Get-ChildItem -LiteralPath $tempDir
    if ($payload.Count -eq 1 -and $payload[0].PSIsContainer) {
        $payload = Get-ChildItem -LiteralPath $payload[0].FullName
    }

    if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in $payload) {
        Move-Item -LiteralPath $item.FullName -Destination $Destination
    }
    Remove-Item $tempDir -Recurse -Force
}

function Find-Tool {
    param([string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    # Fall back to vswhere to locate the MSVC toolchain.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -find "VC\Tools\MSVC\*\bin\Hostx64\x64\$Name" | Select-Object -First 1
        if ($found) { return $found }
    }
    throw "$Name not found. Run from a VS 2022 developer prompt or install the MSVC toolchain."
}

function New-ImportLibrary {
    # dumpbin /exports -> .def -> lib /def /machine:x64
    param(
        [string]$DllPath,
        [string]$OutputLib
    )
    $dumpbin = Find-Tool -Name "dumpbin.exe"
    $libTool = Find-Tool -Name "lib.exe"

    Write-Host "  dumpbin: $dumpbin"
    $exports = & $dumpbin /exports $DllPath 2>$null
    if (-not $exports) {
        throw "dumpbin produced no output for $DllPath"
    }

    $names = @()
    foreach ($line in $exports) {
        # "    ordinal hint RVA      name" rows:
        # "          1    0 00001A40 obs_frontend_add_dock"
        if ($line -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)$') {
            $names += $Matches[1]
        }
    }
    if ($names.Count -eq 0) {
        throw "No exports parsed from $DllPath"
    }

    $defPath = [System.IO.Path]::ChangeExtension($OutputLib, ".def")
    $lines = @("EXPORTS")
    $lines += $names | ForEach-Object { "    $_" }
    [System.IO.File]::WriteAllLines($defPath, $lines)

    Write-Host "  lib: $($names.Count) exports -> $([System.IO.Path]::GetFileName($OutputLib))"
    & $libTool /def:"$defPath" /machine:x64 /out:"$OutputLib" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "lib.exe failed for $DllPath (exit code $LASTEXITCODE)"
    }
}

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

Write-Host "YawaMetrics OBS dependency installer"
Write-Host "  OBS Studio : $ObsVersion"
Write-Host "  obs-deps   : $ObsDepsTag"
Write-Host "  Target dir : $DepsDir"

if (-not (Test-Path $DepsDir)) {
    New-Item -ItemType Directory -Path $DepsDir -Force | Out-Null
}

# --- 1. Qt6 prebuilt (from obs-deps releases) -------------------------------

$QtDir = Join-Path $DepsDir "qt6"
if ((Test-Path (Join-Path $QtDir "lib")) -and -not $Force) {
    Write-Step "Qt6 prebuilt: already present"
} else {
    Write-Step "Qt6 prebuilt -> native/.deps/qt6"
    $zip = Get-RemoteArchive `
        -Uri "https://github.com/obsproject/obs-deps/releases/download/$ObsDepsTag/windows-deps-qt6-$ObsDepsTag-x64.zip" `
        -Name "windows-deps-qt6-$ObsDepsTag-x64.zip"
    Expand-ZipNormalized -ZipPath $zip -Destination $QtDir
}

# --- 2. obs-deps -------------------------------------------------------------

$ObsDepsDir = Join-Path $DepsDir "obs-deps"
if ((Test-Path (Join-Path $ObsDepsDir "include")) -and -not $Force) {
    Write-Step "obs-deps: already present"
} else {
    Write-Step "obs-deps -> native/.deps/obs-deps"
    $zip = Get-RemoteArchive `
        -Uri "https://github.com/obsproject/obs-deps/releases/download/$ObsDepsTag/windows-deps-$ObsDepsTag-x64.zip" `
        -Name "windows-deps-$ObsDepsTag-x64.zip"
    Expand-ZipNormalized -ZipPath $zip -Destination $ObsDepsDir
}

# --- 3. obs-studio sources (headers + generated obsconfig.h) -----------------

$ObsSourceDir = Join-Path $DepsDir "obs-studio"
$ObsConfigHeader = Join-Path $ObsSourceDir "libobs\obsconfig.h"
if ((Test-Path (Join-Path $ObsSourceDir "libobs\obs.h")) -and -not $Force) {
    Write-Step "obs-studio sources: already present"
} else {
    Write-Step "obs-studio $ObsVersion sources -> native/.deps/obs-studio"
    $zip = Get-RemoteArchive `
        -Uri "https://github.com/obsproject/obs-studio/archive/refs/tags/$ObsVersion.zip" `
        -Name "obs-studio-$ObsVersion-source.zip"
    Expand-ZipNormalized -ZipPath $zip -Destination $ObsSourceDir
}

if (-not (Test-Path $ObsConfigHeader) -or $Force) {
    Write-Step "Generating libobs/obsconfig.h (absent from the source archive)"
    $obsconfig = @"
#pragma once

/* Generated by scripts/Install-ObsDeps.ps1 for OBS Studio $ObsVersion. */

#define OBS_VERSION "$ObsVersion"
#define OBS_DATA_PATH "../../data"
#define OBS_PLUGIN_PATH "../../obs-plugins/64bit"
#define OBS_PLUGIN_DESTINATION "obs-plugins"

#define OBS_RELEASE_CANDIDATE_MAJOR 0
#define OBS_RELEASE_CANDIDATE_MINOR 0
#define OBS_RELEASE_CANDIDATE_PATCH 0
#define OBS_RELEASE_CANDIDATE_VER
        MAKE_SEMANTIC_VERSION(OBS_RELEASE_CANDIDATE_MAJOR,
                              OBS_RELEASE_CANDIDATE_MINOR,
                              OBS_RELEASE_CANDIDATE_PATCH)
#define OBS_RELEASE_CANDIDATE 0

#define OBS_BETA_MAJOR 0
#define OBS_BETA_MINOR 0
#define OBS_BETA_PATCH 0
#define OBS_BETA_VER
        MAKE_SEMANTIC_VERSION(OBS_BETA_MAJOR, OBS_BETA_MINOR, OBS_BETA_PATCH)
#define OBS_BETA 0
"@
    # obsconfig.h is consumed only when HAVE_OBSCONFIG_H is defined by CMake.
    [System.IO.File]::WriteAllText($ObsConfigHeader, $obsconfig.Replace("`r`n", "`n"))
}

# --- 4. obs-studio portable (DLLs for import libraries) ----------------------

$ObsPortableDir = Join-Path $DepsDir "obs-studio-portable"
$ObsDll = Join-Path $ObsPortableDir "bin\64bit\obs.dll"
if ((Test-Path $ObsDll) -and -not $Force) {
    Write-Step "obs-studio portable: already present"
} else {
    Write-Step "obs-studio $ObsVersion portable -> native/.deps/obs-studio-portable"
    $zip = Get-RemoteArchive `
        -Uri "https://github.com/obsproject/obs-studio/releases/download/$ObsVersion/OBS-Studio-$ObsVersion.zip" `
        -Name "OBS-Studio-$ObsVersion.zip"
    Expand-ZipNormalized -ZipPath $zip -Destination $ObsPortableDir
}

# --- 5. Import libraries ------------------------------------------------------

$ImportLibDir = Join-Path $DepsDir "import-libs"
$ObsLib = Join-Path $ImportLibDir "obs.lib"
$ObsFrontendLib = Join-Path $ImportLibDir "obs-frontend-api.lib"
if ((Test-Path $ObsLib) -and (Test-Path $ObsFrontendLib) -and -not $Force) {
    Write-Step "Import libraries: already present"
} else {
    Write-Step "Import libraries -> native/.deps/import-libs"
    New-Item -ItemType Directory -Path $ImportLibDir -Force | Out-Null
    New-ImportLibrary -DllPath $ObsDll -OutputLib $ObsLib
    $FrontendDll = Join-Path $ObsPortableDir "bin\64bit\obs-frontend-api.dll"
    if (-not (Test-Path $FrontendDll)) {
        throw "obs-frontend-api.dll not found at $FrontendDll"
    }
    New-ImportLibrary -DllPath $FrontendDll -OutputLib $ObsFrontendLib
}

# --- 6. Paths manifest --------------------------------------------------------

Write-Step "Writing native/.deps/obs-include-dirs.cmake"
function To-CMakePath {
    param([string]$Path)
    return ($Path -replace '\\', '/')
}
$manifest = @"
# Generated by scripts/Install-ObsDeps.ps1 — do not edit by hand.
# Consumed by native/CMakeLists.txt before find_package/target_include_directories.

set(YAWAMETRICS_OBS_LIBOBS_INCLUDE "$((Join-Path $ObsSourceDir 'libobs') | To-CMakePath)")
set(YAWAMETRICS_OBS_FRONTEND_INCLUDE "$((Join-Path $ObsSourceDir 'UI') | To-CMakePath)")
set(YAWAMETRICS_OBS_CONFIG_INCLUDE "$((Join-Path $ObsSourceDir 'libobs') | To-CMakePath)")
set(YAWAMETRICS_OBS_IMPORT_LIB_DIR "$(To-CMakePath $ImportLibDir)")
set(YAWAMETRICS_QT6_PREFIX "$(To-CMakePath $QtDir)")

list(APPEND CMAKE_PREFIX_PATH "${(To-CMakePath $QtDir)}")
"@
[System.IO.File]::WriteAllText((Join-Path $DepsDir "obs-include-dirs.cmake"), $manifest.Replace("`r`n", "`n"))

Write-Host ""
Write-Host "All dependencies ready:" -ForegroundColor Green
Write-Host "  $QtDir"
Write-Host "  $ObsDepsDir"
Write-Host "  $ObsSourceDir"
Write-Host "  $ObsPortableDir"
Write-Host "  $ImportLibDir"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  cmake --preset windows-ci-x64 `"-DYAWAMETRICS_VERSION=<version>`""
Write-Host "  cmake --build --preset windows-ci-x64"
