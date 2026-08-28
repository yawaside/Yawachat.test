# Contributing / Правила контрибуции

Спасибо за интерес к YawaMetrics! Перед отправкой PR прочитайте этот файл и
`docs/TECHNICAL_SPEC.md` — техническое задание является обязательным к
соблюдению документом.

## Ветки и PR

- Ветка по умолчанию — `main`. Работа ведётся в тематических ветках
  `feature/…`, `fix/…`, `docs/…`.
- PR должен проходить все четыре блокирующие проверки CI:
  `lint-cmake`, `lint-version`, `web`, `native`.
- Сборка `native` обязана проходить **без предупреждений при `/W3`**.

## Версионирование и релизный цикл

1. **Единственный источник версии** — первая запись `## X.Y.Z` в
   `CHANGELOG.md`. Версию не передают вручную: CI извлекает её скриптом
   `.github/scripts/version.mjs`.
2. При изменении функциональности или интерфейса **добавьте запись в
   `CHANGELOG.md`** и синхронно обновите версию в 7 файлах:
   - `CHANGELOG.md`
   - `CMakeLists.txt`
   - `native/CMakeLists.txt`
   - `buildspec.json`
   - `native/buildspec.json`
   - `installer/YawaMetrics.iss`
   - бейдж в `README.md`

   Проверка: `node .github/scripts/check-version.mjs`.
3. В `CHANGELOG.md` попадают **только функциональные и интерфейсные
   изменения** (§10.1 ТЗ). Внутренние правки сборки, компилятора и CI в
   CHANGELOG не вносятся.
4. Пуш в `main` запускает автоматический релиз: создаётся тег `vX.Y.Z`,
   публикуется GitHub Release с ZIP-комплектом ручной установки; сборка
   установщика `.exe` выполняется best-effort и не блокирует релиз.

## Ограничения реализации (§11 ТЗ — обязательные)

| ИД   | Правило |
|------|---------|
| ОР-1 | Raw-строки с кавычками внутри — только `R"YM(...)YM"` |
| ОР-2 | Полный тип до вызова метода: `#include <QResizeEvent>`, `<QStyle>`, `<QShowEvent>` |
| ОР-3 | `class`/`struct` в forward-declaration и определении обязаны совпадать |
| ОР-4 | Лямбда — не указатель: `auto f = [&]{};` |
| ОР-5 | Не использовать локальные имена, совпадающие с `std` |
| ОР-6 | В CMake запрещено `${VAR[0]}` — только `list(GET VAR 0 out)` |
| ОР-7 | Опции `iscc` передавать до имени скрипта |
| ОР-8 | В PowerShell флаг `-D…=1.2.3` брать в кавычки |
| ОР-9 | Типы общего назначения (`PlatformUiState`) объявлять в пространстве имён |
| ОР-10| `obs_frontend_add_dock_by_id`/`remove_dock` — только OBS 30+; при линковке с 29.1.3 использовать `obs_frontend_add_dock(QDockWidget*)` |
| ОР-11| Консольные скрипты для Windows — только на английском или с явным UTF-8 |

## Стиль кода

- C++17, Qt6 (Core, Widgets, Network). Строки — `QStringLiteral` /
  `QLatin1String` (сборка с `QT_NO_CAST_FROM_ASCII`).
- Все видимые строки UI — в `native/data/locale/*.ini`, не в коде.
- Регулярки разбора ответов — в raw-строках `R"YM(...)YM"` в одном модуле
  (`poll_engine.cpp`), чтобы смена разметки площадки чинилась в одном месте.
- Запросы — только асинхронно через `QNetworkAccessManager`; UI-поток OBS
  не блокируется ни на одном этапе (НФТ-1).

## Локальная проверка перед PR

```powershell
python .github/scripts/check_cmake.py
node   .github/scripts/check-version.mjs
node   .github/scripts/check-widget.mjs
./scripts/Install-ObsDeps.ps1
cmake --preset windows-ci-x64 "-DYAWAMETRICS_VERSION=<версия из CHANGELOG>"
cmake --build --preset windows-ci-x64
```
