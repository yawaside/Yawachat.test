#!/usr/bin/env bash
# Локальная сборка Windows x64 из Git Bash.
# Результат: desktop/release/YawaChatHub.exe и YawaChatHub-Setup.exe.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* && "${OSTYPE:-}" != win32* ]]; then
  echo "Этот скрипт запускается в Git Bash на Windows." >&2
  exit 1
fi

VERSION="${1:-$(tr -d '[:space:]' < VERSION)}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Некорректная версия: $VERSION" >&2
  exit 1
fi

echo "[1/4] Установка зависимостей интерфейса"
npm install

echo "[2/4] Сборка интерфейса"
npm run build
rm -rf desktop/renderer-dist
mkdir -p desktop/renderer-dist
cp -r dist/. desktop/renderer-dist/

echo "[3/4] Синхронизация версии $VERSION"
node scripts/sync-version.mjs "$VERSION"

echo "[4/4] Сборка portable + установщика"
pushd desktop >/dev/null
npm install
npx electron-builder --win --publish never
popd >/dev/null

test -f desktop/release/YawaChatHub.exe
test -f desktop/release/YawaChatHub-Setup.exe

echo
echo "Готово:"
echo "  desktop/release/YawaChatHub.exe"
echo "  desktop/release/YawaChatHub-Setup.exe"
echo
echo "Эти файлы НЕ добавляются в git. Для загрузки в Release выполните:"
echo "  bash scripts/upload-release.sh $VERSION"