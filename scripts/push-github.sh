#!/usr/bin/env bash
# Безопасная загрузка исходников в yawaside/Yawachat.test из Git Bash.
# Portable/installer намеренно НЕ добавляются в git: они публикуются Release.
set -euo pipefail

REPO_URL="${GH_REPO_URL:-https://github.com/yawaside/Yawachat.test.git}"
BRANCH="${1:-main}"
MESSAGE="${2:-feat: update YawaChatHub}"

if ! command -v git >/dev/null 2>&1; then
  echo "Git не найден. Установите Git for Windows." >&2
  exit 1
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Запустите скрипт из корня проекта YawaChatHub." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "[1/6] Репозиторий: $ROOT"
git init >/dev/null
git branch -M "$BRANCH"

echo "[2/6] Настройка origin"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi
git remote -v

# Если папка проекта была скачана из редактора без .git, связываем её
# с существующей историей GitHub, не удаляя файлы рабочей копии.
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  if git fetch origin "$BRANCH" >/dev/null 2>&1 && git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git reset --mixed "origin/$BRANCH"
    echo "Локальные файлы привязаны к существующей ветке origin/$BRANCH"
  fi
fi

echo "[3/6] Удаление сборок из индекса Git"
# Если exe уже были добавлены раньше, одного .gitignore недостаточно.
git rm -r --cached --ignore-unmatch --quiet \
  dist desktop/release desktop/renderer-dist node_modules desktop/node_modules || true

echo "[4/6] Подготовка коммита"
git add -A
if git diff --cached --quiet; then
  echo "Новых изменений для коммита нет. Продолжаю push существующих коммитов."
else
  git commit -m "$MESSAGE"
fi

echo "[5/6] Проверка авторизации"
if command -v gh >/dev/null 2>&1; then
  if gh auth status -h github.com >/dev/null 2>&1; then
    gh auth setup-git >/dev/null 2>&1 || true
  else
    echo "GitHub CLI найден, но авторизация отсутствует. Выполните: gh auth login" >&2
    exit 1
  fi
fi

echo "[6/6] Синхронизация и push"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch origin "$BRANCH"

  if git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
    echo "Локальная ветка содержит историю GitHub. Push разрешён."
  elif git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
    echo "На GitHub есть новые коммиты. Выполняю pull --rebase."
    git pull --rebase origin "$BRANCH"
  else
    echo "Локальная и удалённая истории не связаны." >&2
    echo "Сначала выполните один из вариантов вручную:" >&2
    echo "  git pull --rebase --allow-unrelated-histories origin $BRANCH" >&2
    echo "или, если удалённая история точно не нужна:" >&2
    echo "  git push --force-with-lease -u origin $BRANCH" >&2
    exit 2
  fi
fi

git push -u origin "$BRANCH"
echo
echo "Исходники загружены: $REPO_URL"
echo "Сборки .exe загружает GitHub Actions в раздел Releases."