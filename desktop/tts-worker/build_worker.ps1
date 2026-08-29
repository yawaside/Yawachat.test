# Сборка портативного Silero TTS-воркера (embedded Python + torch CPU + модель v5_5_ru).
# Запускается в GitHub Actions (windows-latest): powershell -File build_worker.ps1 -OutDir ..\.. -ZipName silero-worker-ru-1.0.0.zip
param(
  [string]$OutDir = (Split-Path -Parent $PSScriptRoot),
  [string]$ZipName = "silero-worker-ru-1.0.0.zip",
  [string]$ModelUrl = "https://models.silero.ai/models/tts/ru/v5_5_ru.pt"
)

$ErrorActionPreference = "Stop"
$PyVer = "3.11.9"

$work = Join-Path $env:TEMP ("yawa-silero-build-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null

try {
  Write-Host "=== 1/4 Embedded Python $PyVer ==="
  $pyz = "python-$PyVer-embed-amd64.zip"
  Invoke-WebRequest "https://www.python.org/ftp/python/$PyVer/$pyz" -OutFile (Join-Path $work $pyz)
  Expand-Archive (Join-Path $work $pyz) -DestinationPath (Join-Path $work "python")
  $pyDir = Join-Path $work "python"
  $pth = Join-Path $pyDir "python311._pth"
  (Get-Content $pth) -replace "#import ensurepip", "import ensurepip" | Set-Content $pth
  $pyExe = Join-Path $pyDir "python.exe"
  & $pyExe -m ensurepip --upgrade
  & $pyExe -m pip install --upgrade pip --quiet

  Write-Host "=== 2/4 PyTorch CPU ==="
  & $pyExe -m pip install torch --index-url https://download.pytorch.org/whl/cpu --quiet
  & $pyExe -m pip install numpy --quiet

  Write-Host "=== 3/4 Модель v5_5_ru (русский) ==="
  $modelFile = Join-Path $pyDir "v5_5_ru.pt"
  Invoke-WebRequest $ModelUrl -OutFile $modelFile
  $modelSize = (Get-Item $modelFile).Length
  if ($modelSize -lt 50MB) { throw "Модель подозрительно мала: $modelSize байт" }
  Write-Host "Модель: $([math]::Round($modelSize / 1MB, 1)) MB"

  # 4/4 Упаковка
  Write-Host "=== 4/4 ZIP ==="
  Copy-Item (Join-Path $PSScriptRoot "silero_worker.py") (Join-Path $pyDir "silero_worker.py")
  $zipPath = Join-Path $OutDir $ZipName
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path (Join-Path $pyDir "*") -DestinationPath $zipPath
  Write-Host "OK: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)"
}
finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
