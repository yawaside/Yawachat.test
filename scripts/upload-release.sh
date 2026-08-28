#!/usr/bin/env bash
# Загружает локальные exe в GitHub Release через GitHub CLI.
# Требуется: gh (https://cli.github.com/) и один раз выполненный `gh auth login`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(tr -d '[:space:]' < VERSION)}"
REPO="${GH_REPO:-yawaside/Yawachat.test}"
TAG="v${VERSION}"
PORTABLE="desktop/release/YawaChatHub.exe"
INSTALLER="desktop/release/YawaChatHub-Setup.exe"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Некорректная версия: $VERSION" >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "Не найден gh. Установите GitHub CLI и выполните: gh auth login" >&2
  exit 1
fi
if [[ ! -f "$PORTABLE" || ! -f "$INSTALLER" ]]; then
  echo "Не найдены обе сборки. Сначала выполните: bash scripts/build-windows.sh $VERSION" >&2
  exit 1
fi

gh auth status -h github.com >/dev/null

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT
bash scripts/changelog.sh "$VERSION" > "$NOTES"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG уже существует — обновляю два файла"
  gh release upload "$TAG" "$PORTABLE" "$INSTALLER" --repo "$REPO" --clobber
else
  echo "Создаю Release $TAG и загружаю два файла"
  gh release create "$TAG" "$PORTABLE" "$INSTALLER" \
    --repo "$REPO" \
    --target main \
    --title "YawaChatHub $TAG" \
    --notes-file "$NOTES"
fi

echo "Готово: https://github.com/$REPO/releases/tag/$TAG"