# Сборка Windows-приложений

Из одного репозитория получаются две сборки Windows x64:

* **portable** — `YawaChatHub.exe`, один файл, установка не нужна;
* **nsis** — `YawaChatHub-Setup.exe`, обычный установщик с ярлыками.

Версия берётся из `desktop/package.json` (сейчас **2.0.0**) и совпадает с `VERSION` и
`src/version.ts`.

## Локальная сборка

```bash
# 1. интерфейс (рендерер)
npm install
npm run build
xcopy dist desktop\renderer-dist /E /I /Y      # Git Bash: cp -r dist/. desktop/renderer-dist/

# 2. оболочка
cd desktop
npm install

npm run dist         # только portable exe
npm run dist:setup   # только установщик
npm run dist:all     # обе сборки
```

Готовые файлы: `desktop/release/`.

## Что именно собирается

* `electron-builder` с `"npmRebuild": false` — иначе `@electron/rebuild` пытается собрать
  опциональный `bufferutil` для `ws` через node-gyp и падает без Visual Studio.
  `ws` и `tiktok-live-connector` работают на чистом JS.
* В сборку попадают `electron/**`, `renderer-dist/**`, `widget/**`.
* Иконка: `desktop/build/icon.png`.

## Автосборка в GitHub Actions

Файл `.github/workflows/release.yml`, запускается на push в `main`, на тег `v*` и вручную.

1. **build** (windows-latest): Vite → интерфейс, `npm install` в `desktop`,
   `electron-builder --win` → артефакт `YawaChatHub-<версия>` с двумя exe.
2. **tag**: создаёт аннотированный тег `v<версия>` (например `v2.0.0`) из файла `VERSION`,
   если такого тега ещё нет.
3. **release**: генерирует ченжлог (`scripts/changelog.sh`), обновляет `CHANGELOG.md` в репозитории
   и публикует Release с `YawaChatHub.exe` и `YawaChatHub-Setup.exe`.

Один раз включите: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

## Смена версии

Правьте версию сразу в трёх местах, затем пушьте в `main`:

```
VERSION                 →  2.1.0
src/version.ts          →  export const APP_VERSION = "2.1.0";
desktop/package.json    →  "version": "2.1.0"
```

Дальше конвейер создаст тег `v2.1.0` и релиз.
