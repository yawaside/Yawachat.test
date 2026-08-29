# Сборка портативного Silero TTS-воркера (embedded Python + torch CPU + модель v5_5_ru).
# Запускается в GitHub Actions (windows-latest): powershell -File build_worker.ps1 -OutDir ..\.. -ZipName silero-worker-ru-1.0.0.zip
param(
  [string]$OutDir = (Split-Path -Parent $PSScriptRoot),
  [string]$ZipName = "silero-worker-ru-1.0.0.zip",
  [string]$ModelUrl = "https://models.silero.ai/models/tts/ru/v5_5_ru.pt"
)

$ErrorActionPreference = "Stop"
$PyVer = "3.11.9"

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Команда завершилась с кодом ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

$work = Join-Path $env:TEMP ("yawa-silero-build-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null

try {
  Write-Host "=== 1/4 Embedded Python $PyVer ==="
  $pyz = "python-$PyVer-embed-amd64.zip"
  Invoke-WebRequest "https://www.python.org/ftp/python/$PyVer/$pyz" -OutFile (Join-Path $work $pyz)
  Expand-Archive (Join-Path $work $pyz) -DestinationPath (Join-Path $work "python")
  $pyDir = Join-Path $work "python"
  $pth = Join-Path $pyDir "python311._pth"
  # В embeddable Python нет ensurepip. Для pip нужен import site.
  (Get-Content $pth) -replace "#import site", "import site" | Set-Content $pth -Encoding ASCII
  $pyExe = Join-Path $pyDir "python.exe"
  $getPip = Join-Path $work "get-pip.py"
  Invoke-WebRequest "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
  Invoke-Checked $pyExe @($getPip, "--no-warn-script-location")
  Invoke-Checked $pyExe @("-m", "pip", "install", "--upgrade", "pip", "--quiet")

  Write-Host "=== 2/4 PyTorch CPU ==="
  Invoke-Checked $pyExe @("-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu", "--quiet")
  Invoke-Checked $pyExe @("-m", "pip", "install", "numpy", "--quiet")
  Invoke-Checked $pyExe @("-c", "import torch, numpy; print('torch', torch.__version__)")

  Write-Host "=== 3/4 Модель v5_5_ru (русский) ==="
  $modelFile = Join-Path $pyDir "v5_5_ru.pt"
  Invoke-WebRequest $ModelUrl -OutFile $modelFile
  $modelSize = (Get-Item $modelFile).Length
  if ($modelSize -lt 50MB) { throw "Модель подозрительно мала: $modelSize байт" }
  Write-Host "Модель: $([math]::Round($modelSize / 1MB, 1)) MB"

  # 4/4 Упаковка
  Write-Host "=== 4/4 ZIP ==="
  Copy-Item (Join-Path $PSScriptRoot "silero_worker.py") (Join-Path $pyDir "silero_worker.py")
  # Быстрая проверка: воркер должен хотя бы запустить Python и найти torch.
  Invoke-Checked $pyExe @("-c", "import torch; import numpy; print('worker deps ok')")

  # Манифест нужен приложению для проверки структуры распакованного ZIP.
  $manifest = @{
    format = 1
    entry = "silero_worker.py"
    model = "v5_5_ru.pt"
    python = "python.exe"
    speakers = @("aidar", "baya", "kseniya", "xenia", "eugene")
  } | ConvertTo-Json -Depth 3
  Set-Content (Join-Path $pyDir "silero-worker.json") $manifest -Encoding UTF8

  # Проверяем обязательные пути до упаковки.
  foreach ($required in @("python.exe", "python311.dll", "python311.zip", "python311._pth", "silero_worker.py", "v5_5_ru.pt", "silero-worker.json")) {
    if (-not (Test-Path (Join-Path $pyDir $required))) {
      throw "В bundle отсутствует обязательный файл: $required"
    }
  }

  # Smoke-test JSON-протокола: python.exe должен загрузить модель и вывести ready.
  # stdin закрываем сразу после старта, чтобы процесс завершился сам после ready.
  Write-Host "Проверка запуска python.exe и JSON-протокола..."
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $pyExe
  $psi.Arguments = '"silero_worker.py"'
  $psi.WorkingDirectory = $pyDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $probe = New-Object System.Diagnostics.Process
  $probe.StartInfo = $psi
  [void]$probe.Start()
  $stdoutTask = $probe.StandardOutput.ReadToEndAsync()
  $stderrTask = $probe.StandardError.ReadToEndAsync()
  $probe.StandardInput.Close()
  if (-not $probe.WaitForExit(180000)) {
    try { $probe.Kill() } catch { }
    throw "JSON smoke-test: python.exe не завершился за 180 секунд"
  }
  $probeOut = $stdoutTask.Result
  $probeErr = $stderrTask.Result
  if ($probeOut -notmatch '"ready"\s*:\s*true') {
    throw "JSON smoke-test: не получен ready=true. stdout=$probeOut stderr=$probeErr"
  }
  Write-Host "JSON smoke-test: OK"
  $zipPath = Join-Path $OutDir $ZipName
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path (Join-Path $pyDir "*") -DestinationPath $zipPath

  # Проверяем, что файлы лежат в корне ZIP, а не в лишней подпапке.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($required in @("python.exe", "python311.dll", "python311.zip", "python311._pth", "silero_worker.py", "v5_5_ru.pt", "silero-worker.json")) {
      if (-not ($archive.Entries | Where-Object { $_.FullName -eq $required })) {
        throw "В ZIP отсутствует файл в корне: $required"
      }
    }
  } finally {
    $archive.Dispose()
  }
  Write-Host "OK: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)"
}
finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
