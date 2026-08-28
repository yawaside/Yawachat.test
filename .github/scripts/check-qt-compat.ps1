<#
.SYNOPSIS
    Гейт совместимости Qt: yawametrics.dll не должна импортировать
    qt_version_tag_6_N с N выше разрешённого.

.DESCRIPTION
    Qt6Core.dll экспортирует qt_version_tag_6_M только для минорных версий
    M, не превышающих собственную. Поэтому плагин, слинкованный с Qt 6.M,
    грузится только в OBS с Qt >= 6.M — и падает с «не найдена указанная
    процедура» во всех более старых сборках OBS.

    Матрица Qt в релизах OBS (проверено по экспортам Qt6Core.dll):
        29.1.x   Qt 6.4      31.1.x–32.1.x  Qt 6.8
        30.x–31.0.x  Qt 6.6  32.2.0–32.2.1  Qt 6.9
                              32.2.2         Qt 6.11

    Поддерживаемый диапазон — OBS 30.0+ (TECHNICAL_SPEC §5.2), значит
    сборка обязана использовать Qt <= 6.6 (obs-deps 2025-02-04) и
    импортировать максимум qt_version_tag_6_6.

    Скрипт читает таблицу импортов PE напрямую (без dumpbin): дескрипторы
    импорта -> INT (OriginalFirstThunk) -> имена символов из Qt6Core.dll.
    Работает и как локальная проверка, и как шаг CI.

.PARAMETER DllPath
    Путь к yawametrics.dll. Если не задан — рекурсивный поиск от SearchRoot.

.PARAMETER SearchRoot
    Корень поиска yawametrics.dll (по умолчанию native/.build).

.PARAMETER MaxQtMajor
    Максимально допустимая мажорная версия Qt в импортах (по умолчанию 6).

.PARAMETER MaxQtMinor
    Максимально допустимая минорная версия Qt в импортах (по умолчанию 6 —
    вместе с MaxQtMajor это Qt 6.6).

.EXAMPLE
    ./.github/scripts/check-qt-compat.ps1 -DllPath package/yawametrics.dll
#>
[CmdletBinding()]
param(
    [string]$DllPath = "",
    [string]$SearchRoot = "",
    [int]$MaxQtMajor = 6,
    [int]$MaxQtMinor = 6
)

$ErrorActionPreference = "Stop"

if (-not $DllPath) {
    if (-not $SearchRoot) {
        $SearchRoot = Join-Path $PSScriptRoot "..\..\native\.build"
    }
    if (-not (Test-Path $SearchRoot)) {
        throw "SearchRoot does not exist: $SearchRoot"
    }
    $found = Get-ChildItem -Path $SearchRoot -Recurse -Filter "yawametrics.dll" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $found) {
        throw "yawametrics.dll not found under $SearchRoot"
    }
    $DllPath = $found.FullName
}

if (-not (Test-Path -LiteralPath $DllPath)) {
    throw "DLL not found: $DllPath"
}

function Get-QtVersionTagImports {
    # Имена импортов вида qt_version_tag_6_N из секции импорта Qt6Core.dll.
    param([string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
        throw "Not a PE file (MZ signature missing): $Path"
    }
    $peOff = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOff -lt 0 -or ($peOff + 24) -gt $bytes.Length) {
        throw "Bad PE header offset in $Path"
    }
    if ($bytes[$peOff] -ne 0x50 -or $bytes[$peOff + 1] -ne 0x45) {
        throw "PE signature missing in $Path"
    }

    $coff = $peOff + 4
    $numSections = [BitConverter]::ToUInt16($bytes, $coff + 2)
    $optSize = [BitConverter]::ToUInt16($bytes, $coff + 16)
    $opt = $coff + 20

    $magic = [BitConverter]::ToUInt16($bytes, $opt)
    if ($magic -eq 0x20B) { $dataDir = $opt + 112 }    # PE32+
    elseif ($magic -eq 0x10B) { $dataDir = $opt + 96 } # PE32
    else { throw ("Unknown optional header magic 0x{0:X} in {1}" -f $magic, $Path) }

    # DataDirectory[1] — таблица импорта.
    $importRva = [BitConverter]::ToUInt32($bytes, $dataDir + 8)
    if ($importRva -eq 0) { return ,@() }

    # Таблица секций для перевода RVA -> смещение в файле.
    $sections = New-Object System.Collections.Generic.List[object]
    $secOff = $opt + $optSize
    for ($i = 0; $i -lt $numSections; ++$i) {
        $s = $secOff + $i * 40
        $sections.Add([pscustomobject]@{
            VA  = [BitConverter]::ToUInt32($bytes, $s + 12)
            VS  = [BitConverter]::ToUInt32($bytes, $s + 8)
            Raw = [BitConverter]::ToUInt32($bytes, $s + 20)
        })
    }
    function Convert-RvaToOffset {
        param([uint32]$Rva)
        foreach ($sec in $sections) {
            if ($sec.VA -le $Rva -and $Rva -lt ($sec.VA + $sec.VS)) {
                return [int]($sec.Raw + ($Rva - $sec.VA))
            }
        }
        return -1
    }

    function Read-AsciiZ {
        param([int]$Offset)
        $end = $Offset
        $limit = [Math]::Min($bytes.Length - 1, $Offset + 512)
        while ($end -le $limit -and $bytes[$end] -ne 0) { ++$end }
        return [System.Text.Encoding]::ASCII.GetString($bytes, $Offset, $end - $Offset)
    }

    $thunkSize = if ($magic -eq 0x20B) { 8 } else { 4 }
    # Старший бит thunk — импорт по ординалу (для PE32+ 0x8000...0 не
    # записывается литералом: PowerShell парсит его как отрицательный Int64).
    $ordinalFlag = if ($magic -eq 0x20B) {
        [UInt64]::Parse("8000000000000000", [System.Globalization.NumberStyles]::HexNumber)
    } else {
        [UInt64]0x80000000
    }

    $tags = New-Object System.Collections.Generic.List[string]
    $desc = Convert-RvaToOffset $importRva
    if ($desc -lt 0) { throw "Import directory RVA does not map to file: $Path" }

    while ($true) {
        $oftRva = [BitConverter]::ToUInt32($bytes, $desc)
        $nameRva = [BitConverter]::ToUInt32($bytes, $desc + 12)
        if ($oftRva -eq 0 -and $nameRva -eq 0) { break }

        $nameOff = Convert-RvaToOffset $nameRva
        $dllName = if ($nameOff -ge 0) { Read-AsciiZ $nameOff } else { "" }

        if ($dllName -match '^Qt6Core\.dll$') {
            $thunkOff = Convert-RvaToOffset $oftRva
            if ($thunkOff -ge 0) {
                for ($i = 0; ; ++$i) {
                    $entryPos = $thunkOff + $i * $thunkSize
                    if ($entryPos + $thunkSize -gt $bytes.Length) { break }
                    $entry = if ($thunkSize -eq 8) {
                        [BitConverter]::ToUInt64($bytes, $entryPos)
                    } else {
                        [UInt64][BitConverter]::ToUInt32($bytes, $entryPos)
                    }
                    if ($entry -eq 0) { break }
                    if (-not ($entry -band $ordinalFlag)) {
                        $hintPos = Convert-RvaToOffset ([uint32]($entry -band 0xFFFFFFFF))
                        if ($hintPos -ge 0 -and ($hintPos + 2) -lt $bytes.Length) {
                            $sym = Read-AsciiZ ($hintPos + 2)
                            # Символ называется qt_version_tag_<qt_major>_<qt_minor>
                            # (например qt_version_tag_6_11) — между числами тоже
                            # подчёркивание.
                            if ($sym -match '^qt_version_tag_\d+_\d+$') {
                                $tags.Add($sym)
                            }
                        }
                    }
                }
            }
        }
        $desc += 20
    }
    return ,$tags
}

Write-Host "Qt compatibility gate"
Write-Host "  DLL        : $DllPath"
Write-Host "  Max Qt     : $MaxQtMajor.$MaxQtMinor (obs-deps buildspec)"
$tags = Get-QtVersionTagImports -Path $DllPath

if ($null -eq $tags -or $tags.Count -eq 0) {
    # Мок-сборки без Qt-заголовков тег не импортируют — это не нарушение.
    Write-Host "  qt_version_tag imports: none — OK"
    exit 0
}

# Самая новая Qt среди импортированных тегов: тег имеет вид
# qt_version_tag_<major>_<minor> (например qt_version_tag_6_11).
$maxMajor = 0
$maxMinor = 0
foreach ($tag in $tags) {
    $parts = $tag -split '_'
    $tagMajor = [int]$parts[$parts.Count - 2]
    $tagMinor = [int]$parts[$parts.Count - 1]
    if ($tagMajor -gt $maxMajor -or ($tagMajor -eq $maxMajor -and $tagMinor -gt $maxMinor)) {
        $maxMajor = $tagMajor
        $maxMinor = $tagMinor
    }
}
Write-Host "  qt_version_tag imports: $($tags -join ', ') (requires Qt >= $maxMajor.$maxMinor)"

$tooNew = ($maxMajor -gt $MaxQtMajor) -or
    ($maxMajor -eq $MaxQtMajor -and $maxMinor -gt $MaxQtMinor)
if ($tooNew) {
    Write-Host "::error::yawametrics.dll imports qt_version_tag_$($maxMajor)_$($maxMinor) — the plugin would only load in OBS builds shipping Qt >= $maxMajor.$maxMinor. Build against obs-deps with Qt <= $MaxQtMajor.$MaxQtMinor (see native/buildspec.json dependencies.qt6; Qt matrix in .github/scripts/check-qt-compat.ps1)."
    exit 1
}

Write-Host "OK: plugin loads in every OBS with Qt >= $maxMajor.$maxMinor"
exit 0
