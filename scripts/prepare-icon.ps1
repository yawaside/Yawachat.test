# Создаёт настоящий PNG для electron-builder из runtime-иконки.
# Важно: генератор изображений может сохранить файл с расширением .png
# в JPEG-контейнере. Electron это читает, но Windows/electron-builder
# для ярлыка ожидает корректный PNG.
param(
  [string]$Source = "desktop/electron/assets/yawachat-tray.jpg",
  [string]$Target = "desktop/build/icon.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path $Source).Path
$targetPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Target))
$targetDir = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $size = 256
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
    }
    finally {
      $graphics.Dispose()
    }
    $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $bitmap.Dispose()
  }
}
finally {
  $sourceImage.Dispose()
}

Write-Host "Icon prepared: $targetPath"