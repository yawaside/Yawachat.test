#!/usr/bin/env bash
# Скачивает встроенные русские нейроголоса Piper и бинарник piper для Windows.
# Запускается ТОЛЬКО в сборке (GitHub Actions) — в репозиторий эти файлы не попадают.
# Результат кладётся в desktop/models/piper и desktop/bin/piper и вшивается в exe.
#
# Идея: исходники и конфиг лежат в git (лёгкие), а тяжёлые ONNX-модели и exe-движок
# берутся из публичных релизов при каждой сборке. Пользователь получает один exe.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="$ROOT/desktop/models/piper"
BIN="$ROOT/desktop/bin/piper"
mkdir -p "$MODELS" "$BIN"

HF="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU"

# Список встроенных русских голосов (только ru). Можно добавить denis/ruslan.
VOICES=(
  "irina/medium/ru_RU-irina-medium"
  "dmitri/medium/ru_RU-dmitri-medium"
)

dl() {
  # $1 = url, $2 = out
  echo "→ $2"
  if command -v curl >/dev/null 2>&1; then
    curl -fSL --retry 3 -o "$2" "$1"
  else
    wget -q -O "$2" "$1"
  fi
}

for v in "${VOICES[@]}"; do
  name="$(basename "$v")"
  dl "$HF/$v.onnx?download=true" "$MODELS/$name.onnx"
  dl "$HF/$v.onnx.json?download=true" "$MODELS/$name.onnx.json"
done

# Бинарник Piper для Windows (движок инференса ONNX + espeak-ng).
PIPER_VER="2023.11.14-2"
PIPER_ZIP="piper_windows_amd64.zip"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/${PIPER_ZIP}"

if [ "${SKIP_PIPER_BIN:-0}" != "1" ]; then
  echo "→ piper.exe ($PIPER_VER)"
  tmp="$(mktemp -d)"
  dl "$PIPER_URL" "$tmp/$PIPER_ZIP" || { echo "piper bin skip"; exit 0; }
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$tmp/$PIPER_ZIP" -d "$tmp"
    # В архиве папка piper/ — копируем содержимое (piper.exe, *.dll, espeak-ng-data)
    if [ -d "$tmp/piper" ]; then
      cp -r "$tmp/piper/." "$BIN/"
    else
      cp -r "$tmp/." "$BIN/"
    fi
  else
    echo "unzip недоступен — пропускаю бинарник (останется sherpa-onnx путь)"
  fi
  rm -rf "$tmp"
fi

echo "Готово. Модели: $(ls "$MODELS" 2>/dev/null | tr '\n' ' ')"
echo "Бинарник: $(ls "$BIN" 2>/dev/null | tr '\n' ' ')"
