#!/usr/bin/env bash
# Формирует раздел CHANGELOG.md для указанной версии на основе git-истории.
#
#   bash scripts/changelog.sh 2.0.0          — раздел для версии 2.0.0
#   bash scripts/changelog.sh                — версия берётся из файла VERSION
#
# Вывод пишется в stdout, файлы скрипт не меняет (этим занимается CI).
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null || true)"
fi
if [ -z "$VERSION" ]; then
  echo "Не указана версия и нет файла VERSION" >&2
  exit 1
fi

PREV_TAG="$(git describe --tags --abbrev=0 --exclude="v${VERSION}" 2>/dev/null || true)"

echo "## YawaChatHub v${VERSION}"
echo
echo "**Дата:** $(date -u +%Y-%m-%d)"
echo
echo "**Сборка:** YawaChatHub.exe (portable x64) и YawaChatHub-Setup.exe (NSIS installer x64)"
echo

if [ -n "$PREV_TAG" ]; then
  echo "### Изменения с ${PREV_TAG}"
  echo
  mapfile -t COMMITS < <(git log --no-merges --pretty=format:'%s' "${PREV_TAG}..HEAD")
  if [ "${#COMMITS[@]}" -eq 0 ] || [ -z "${COMMITS[0]}" ]; then
    echo "- Техническое обновление: сборка и публикация артефактов."
  else
    for c in "${COMMITS[@]}"; do
      echo "- ${c}"
    done
  fi
else
  echo "### Первый публичный релиз"
  echo
  echo "- Единая лента Twitch, YouTube Live, VK Play Live, Kick и TikTok Live"
  echo "- Озвучка системными голосами Windows (SAPI) с фильтрами и пресетами банвордов"
  echo "- OBS-виджет на локальном сервере с токеном"
  echo "- Игровой оверлей поверх окон"
  echo "- Автосохранение настроек без кнопки «Сохранить»"
  echo "- Portable exe и NSIS-установщик"
fi
echo
