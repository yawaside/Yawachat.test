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

    Import libraries are generated from the portable DLLs by reading the PE
    export table directly (no dumpbin): exports -> .def -> lib /def /machine:x64.
    Reading the PE directory in PowerShell keeps the step independent from
    dumpbin availability, locale and output formatting.

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

function Test-IsPeFile {
    # MZ + PE-подпись по смещению из DOS-заголовка. Используется и для
    # самопроверки кэша/результатов распаковки (испорченный файл => перекачать).
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            if ($stream.Length -lt 64) { return $false }
            $two = New-Object byte[] 2
            [void]$stream.Read($two, 0, 2)
            if ($two[0] -ne 0x4D -or $two[1] -ne 0x5A) { return $false }
            $stream.Position = 0x3C
            $four = New-Object byte[] 4
            if ($stream.Read($four, 0, 4) -ne 4) { return $false }
            $peOff = [BitConverter]::ToInt32($four, 0)
            if ($peOff -lt 0 -or ($peOff + 4) -gt $stream.Length) { return $false }
            $stream.Position = $peOff
            [void]$stream.Read($two, 0, 2)
            return ($two[0] -eq 0x50 -and $two[1] -eq 0x45)
        } finally {
            $stream.Close()
        }
    } catch {
        return $false
    }
}

function Test-IsImportLib {
    # Импортная библиотека — COFF-архив, начинается с '!<arch>' + 0x0A
    # (байты 21 3C 61 72 63 68 3E 0A).
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $item = Get-Item -LiteralPath $Path
        if ($item.Length -lt 1024) { return $false }
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $sig = New-Object byte[] 8
            [void]$stream.Read($sig, 0, 8)
            return ($sig[0] -eq 0x21 -and $sig[1] -eq 0x3C -and $sig[2] -eq 0x61 -and
                    $sig[3] -eq 0x72 -and $sig[4] -eq 0x63 -and $sig[5] -eq 0x68 -and
                    $sig[6] -eq 0x3E -and $sig[7] -eq 0x0A)
        } finally {
            $stream.Close()
        }
    } catch {
        return $false
    }
}

function Read-PeExportNames {
    # Имена экспортов напрямую из PE-таблицы экспортов (без dumpbin):
    # не зависит от окружения MSVC, локали и формата вывода сторонних утилит.
    param([string]$DllPath)

    $bytes = [System.IO.File]::ReadAllBytes($DllPath)
    if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
        throw "Not a PE file (MZ signature missing): $DllPath ($($bytes.Length) bytes)"
    }
    $peOff = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOff -lt 0 -or ($peOff + 264) -gt $bytes.Length) {
        throw "Not a PE file (bad PE header offset): $DllPath"
    }
    if ($bytes[$peOff] -ne 0x50 -or $bytes[$peOff + 1] -ne 0x45 -or
        $bytes[$peOff + 2] -ne 0 -or $bytes[$peOff + 3] -ne 0) {
        throw "Not a PE file (PE\0\0 signature missing): $DllPath"
    }
    $machine = [BitConverter]::ToUInt16($bytes, $peOff + 4)
    if ($machine -ne 0x8664) {
        throw "Expected an x64 PE (machine 0x8664, got 0x{0:X4}): $DllPath" -f $machine
    }
    $numSections = [BitConverter]::ToUInt16($bytes, $peOff + 6)
    $optSize = [BitConverter]::ToUInt16($bytes, $peOff + 20)
    $optOff = $peOff + 24
    $magic = [BitConverter]::ToUInt16($bytes, $optOff)
    if ($magic -ne 0x20B -and $magic -ne 0x10B) {
        throw "Unsupported optional header magic 0x{0:X4}: $DllPath" -f $magic
    }
    $dataDirOff = $optOff + 112  # PE32+ (мы уже проверили machine x64)
    $exportRva = [BitConverter]::ToUInt32($bytes, $dataDirOff)
    if ($exportRva -eq 0) {
        throw "PE file has no export directory: $DllPath"
    }

    # Секции для преобразования RVA -> смещение в файле.
    $sectionsOff = $optOff + $optSize
    if (($sectionsOff + $numSections * 40) -gt $bytes.Length) {
        throw "Corrupt section table: $DllPath"
    }
    $sections = @()
    for ($i = 0; $i -lt $numSections; ++$i) {
        $s = $sectionsOff + $i * 40
        # VirtualAddress(12) + VirtualSize(8) -> диапазон, PointerToRawData(20).
        $sections += , @(
            [BitConverter]::ToUInt32($bytes, $s + 12),
            [BitConverter]::ToUInt32($bytes, $s + 8),
            [BitConverter]::ToUInt32($bytes, $s + 20)
        )
    }
    $rvaToFile = {
        param([uint32]$Rva)
        foreach ($sec in $sections) {
            if ($Rva -ge $sec[0] -and $Rva -lt ($sec[0] + $sec[1])) {
                return [long]([long]$sec[2] + [long]$Rva - [long]$sec[0])
            }
        }
        return [long]-1
    }

    $expOff = & $rvaToFile $exportRva
    if ($expOff -lt 0) {
        throw "Export directory RVA 0x{0:X} is not mapped to any section: $DllPath" -f $exportRva
    }
    if (($expOff + 40) -gt $bytes.Length) {
        throw "Corrupt export directory: $DllPath"
    }

    $nameCount = [BitConverter]::ToUInt32($bytes, [int]($expOff + 24))
    $namesRva = [BitConverter]::ToUInt32($bytes, [int]($expOff + 32))
    if ($nameCount -eq 0 -or $namesRva -eq 0) {
        throw "PE export directory has no named exports: $DllPath"
    }
    if ($nameCount -gt 200000) {
        throw "Implausible export name count ($nameCount) - corrupt PE?: $DllPath"
    }
    $namesOff = & $rvaToFile $namesRva
    if ($namesOff -lt 0 -or (($namesOff + $nameCount * 4) -gt $bytes.Length)) {
        throw "Export name table is out of bounds: $DllPath"
    }

    # Latin-1: байты 1:1 в символы, декорированные имена не искажаются.
    $encoding = [System.Text.Encoding]::GetEncoding(28591)
    $names = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $nameCount; ++$i) {
        $rva = [BitConverter]::ToUInt32($bytes, [int]($namesOff + $i * 4))
        $off = & $rvaToFile $rva
        if ($off -lt 0 -or $off -ge $bytes.Length) {
            continue  # форвардер или испорченный элемент — пропускаем
        }
        $end = [int]$off
        $limit = [Math]::Min($bytes.Length - 1, [int]$off + 4096)
        while ($end -le $limit -and $bytes[$end] -ne 0) { ++$end }
        if ($end -gt [int]$off) {
            $names.Add($encoding.GetString($bytes, [int]$off, $end - [int]$off))
        }
    }
    return $names
}

function New-ImportLibrary {
    # Таблица экспортов PE -> .def -> lib /def /machine:x64.
    # dumpbin больше не используется: его вывод в CI однажды оказался пустым
    # (баннер на stdout, ошибка на скрытый stderr, код выхода не проверялся).
    param(
        [string]$DllPath,
        [string]$OutputLib
    )
    if (-not (Test-Path -LiteralPath $DllPath)) {
        throw "DLL not found: $DllPath"
    }
    $libTool = Find-Tool -Name "lib.exe"

    $names = Read-PeExportNames -DllPath $DllPath
    if ($null -eq $names -or $names.Count -eq 0) {
        throw "No exports parsed from $DllPath"
    }
    Write-Host ("  {0}: {1} exports" -f [System.IO.Path]::GetFileName($DllPath), $names.Count)

    $defPath = [System.IO.Path]::ChangeExtension($OutputLib, ".def")
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add("EXPORTS")
    foreach ($name in $names) {
        [void]$lines.Add("    $name")
    }
    [System.IO.File]::WriteAllLines($defPath, $lines)

    Write-Host "  lib: $($names.Count) exports -> $([System.IO.Path]::GetFileName($OutputLib))"
    & $libTool /def:"$defPath" /machine:x64 /out:"$OutputLib" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "lib.exe failed for $DllPath (exit code $LASTEXITCODE). " +
              "Verify the MSVC toolchain is available (lib.exe: $libTool)."
    }
    if (-not (Test-IsImportLib -Path $OutputLib)) {
        throw "lib.exe did not produce a valid import library at $OutputLib"
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
if ((Test-IsPeFile -Path $ObsDll) -and -not $Force) {
    Write-Step "obs-studio portable: already present"
} else {
    if ((Test-Path $ObsDll) -and -not (Test-IsPeFile -Path $ObsDll)) {
        Write-Step "obs.dll is not a valid PE - re-extracting the portable build"
    }
    Write-Step "obs-studio $ObsVersion portable -> native/.deps/obs-studio-portable"
    $zip = Get-RemoteArchive `
        -Uri "https://github.com/obsproject/obs-studio/releases/download/$ObsVersion/OBS-Studio-$ObsVersion.zip" `
        -Name "OBS-Studio-$ObsVersion.zip"
    Expand-ZipNormalized -ZipPath $zip -Destination $ObsPortableDir
    if (-not (Test-IsPeFile -Path $ObsDll)) {
        throw "obs.dll is missing or not a valid PE after extraction: $ObsDll"
    }
}

# --- 5. Import libraries ------------------------------------------------------

$ImportLibDir = Join-Path $DepsDir "import-libs"
$ObsLib = Join-Path $ImportLibDir "obs.lib"
$ObsFrontendLib = Join-Path $ImportLibDir "obs-frontend-api.lib"
if ((Test-IsImportLib -Path $ObsLib) -and (Test-IsImportLib -Path $ObsFrontendLib) -and -not $Force) {
    Write-Step "Import libraries: already present"
} else {
    Write-Step "Import libraries -> native/.deps/import-libs"
    New-Item -ItemType Directory -Path $ImportLibDir -Force | Out-Null
    New-ImportLibrary -DllPath $ObsDll -OutputLib $ObsLib
    $FrontendDll = Join-Path $ObsPortableDir "bin\64bit\obs-frontend-api.dll"
    if (-not (Test-IsPeFile -Path $FrontendDll)) {
        throw "obs-frontend-api.dll not found (or not a valid PE) at $FrontendDll"
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
