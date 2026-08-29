# Внутренние голоса в YawaChatHub — сборка в одном exe

Цель: убрать зависимость от внешних установок и сделать exe полностью автономным,
с русскими нейроголосами внутри — но при этом НЕ раздувать git-репозиторий.

## Главная идея: репозиторий лёгкий, exe — с голосами

Вес репозитория ≠ вес exe. Тяжёлые ONNX-модели (63 МБ) и бинарник Piper (25 МБ)
**не хранятся в git** (см. `.gitignore`), а скачиваются с публичного HuggingFace
**во время сборки** в GitHub Actions скриптом `scripts/fetch-voices.sh` и
вшиваются в exe через `electron-builder`.

Результат:
- git остаётся маленьким (только исходники);
- пользователь скачивает ОДИН exe с голосом внутри;
- никаких сторонних установок, Python или SAPI-драйверов.

Поток сборки (`.github/workflows/release.yml`):
```
Vite build → fetch-voices.sh (качает Piper irina + piper.exe) →
electron-builder (вшивает models/ и bin/ в exe) → Release
```

## 1. Что такое Silero SAPI5 сейчас

Silero SAPI5 — это не отдельный голос, а обвязка:
- DLL-драйвер SAPI5 (`silero_tts_sapi.dll` или аналог) + папка моделей `models/tts/ru/v5_ru.pt`
- При установке инсталлер:
  1. Копирует DLL и модель в `C:\Program Files\Silero\`
  2. Пишет ключи в реестр `HKLM\SOFTWARE\Microsoft\Speech\Voices\Tokens\Silero - xenia`
  3. Регистрирует COM-объект SAPI5

После этого голос появляется в `Параметры → Время и язык → Речь` и в `SAPI.SpVoice`.

Проблема: требует установщика, прав администратора (HKLM), отдельного скачивания 250 МБ.

## 2. Почему внешняя зависимость плоха для портативного чата

- Пользователь стримит игру — не хочет ставить Python/Torch и SAPI-драйверы.
- Portable-версия должна работать из любой папки, без реестра.
- Антивирусы с TLS-инспекцией уже ломали `ws` — внешние зависимости усиливают хрупкость.

## 3. Три варианта встраивания

### Вариант A — Python sidecar (официальный Silero)

Как работает сейчас в сообществе:
```python
import torch
model, _ = torch.hub.load('snakers4/silero-models','silero_tts',language='ru',speaker='v5_ru')
model.to('cpu')
audio = model.apply_tts(text="Привет из чата", speaker='xenia', sample_rate=48000)
model.save_wav(...)
```

В Electron:
- Поставляется `python/` embedded (Python 3.10) + `torch` CPU + `torchaudio` + `omegaconf`
- Процесс `silero_host.py` слушает stdin построчно JSON и пишет WAV base64 в stdout
- Очередь как в `tts.js`

Плюсы:
- 1-в-1 официальный Silero, 5 спикеров в одной модели, авто-ударения.
- Простая реализация.

Минусы:
- Размер: Python 80 МБ + torch 200 МБ + модель 60 МБ = ~340 МБ к релизу.
- RAM: 400-600 МБ после загрузки.
- Лицензия `v5_ru.pt` — **CC BY-NC 4.0** (некоммерческая). Для бесплатного MIT-проекта ок, для платного — нужно разрешение. Базовые `ru_v3` — MIT, но хуже качеством.

### Вариант B — ONNX (без Python)

Silero можно экспортировать в ONNX (сообщество уже делает `v5_ru.onnx`):
- `onnxruntime-node` + модель 60 МБ + предобработка (токенизация, ударения) на JS
- Предобработка — самая сложная часть: Silero использует свой g2p + словарь ударений.

Плюсы:
- Нет Python, быстрее старт, меньше размер (onnxruntime ~50 МБ).
- Можно запускать в том же процессе.

Минусы:
- Нужно портировать `silero_tts` pipeline на JS/ONNX, есть риск расхождения качества.

### Вариант C — Piper TTS (рекомендуется для встраивания)

Piper — движок от Rhasspy, создан именно для встраивания:
- Модели VITS → ONNX, <1 ГБ RAM, CPU-first
- Русские голоса: `irina` (жен, самая качественная), `denis`, `dmitri`, `ruslan`
- Размер: `ru_RU-irina-medium.onnx` 63 МБ, `onnx.json` 5 КБ, `piper.exe` 20 МБ + espeak-ng-data 10 МБ
- Инференс: `0.045 xRT CPU` = 45 мс на 1 сек аудио (из таблицы alphacephei)
- RAM: <100 МБ, CPU <2% на фразу

Плюсы:
- Официально для edge/Raspberry Pi, работает в `sherpa-onnx` Node addon без бинарника.
- Лицензия: код Piper MIT, голоса из RHVoice — условно свободные (для некоммерческого стрима ок).
- Можно скачать модель при первом запуске, чтобы portable остался маленьким.

Минусы:
- Не Silero, но по метрикам `Irina` UTMOS 3.67 > Silero v4 Baya 2.14, близко к EdgeTTS.

## 4. Нагрузка — только русский

| Движок | Модель | Частота | Задержка фразы 10 слов | RAM | Диск | GPU |
|--------|--------|---------|------------------------|-----|------|-----|
| SAPI5 Microsoft Irina | — | 16kHz | ~50 мс | 0 | 0 | нет |
| Silero v5_ru (torch CPU) | 60 МБ | 48kHz | 150-400 мс | 350-500 МБ | 60+200 МБ | нет |
| Piper ru_RU irina medium | 63 МБ | 22kHz | 40-90 мс | 60-90 МБ | 63 МБ | нет |

Для игрового ПК Piper почти бесплатен. Silero тоже ок, но на стриме с игрой + OBS + 5 чатов лучше Piper.

## 5. Как сделать Silero SAPI5 внутренним без установщика

Windows позволяет писать голоса в **HKCU**, без админа:
`HKCU\SOFTWARE\Microsoft\Speech\Voices\Tokens\Silero - xenia`

SAPI.SpVoice читает и HKLM, и HKCU. Значит:
1. Кладём `silero.dll` и `v5_ru.pt` в `desktop/bin/silero/`
2. При старте приложения (main.js) проверяем `HKCU\...Silero...` — если нет, создаём ключ и прописываем путь к DLL через `reg` или PowerShell
3. После этого Silero появится в списке SAPI без внешнего установщика

Это делает SAPI5 «портативным», но всё равно требует COM DLL и модели.

## 6. Рекомендуемая архитектура для YawaChatHub 3.2.0

Гибрид:
- **Встроенные нейроголоса (по умолчанию)**: Piper `irina` + `denis` через `sherpa-onnx` Node addon (или `piper.exe` fallback). Скачиваются при первом запуске в `%APPDATA%/YawaChatHub/models/` если их нет в `desktop/models/`.
- **Системные SAPI5 (fallback)**: Microsoft Irina, Pavel + любые установленные Silero SAPI5 (если пользователь уже поставил).
- **OBS-аудио**: встроенные голоса рендерятся в WAV через тот же движок и шлются в виджет как `data:audio/wav;base64`, поэтому галочка «Управлять аудио через OBS» работает.

Поток:
```
ChatPanel → push(msg) → speech.enqueue(msg)
  → если voice = internal:irina → internalTts.synthesizeWavBase64 → widgetServer.sendConfig({ttsAudio})
  → иначе SAPI TtsEngine (постоянный PowerShell процесс)
```

## 7. Что добавить в сборку

- `desktop/bin/piper/piper.exe` + `espeak-ng-data/`
- `desktop/models/piper/ru_RU-irina-medium.onnx` (или скачивать on-demand)
- `desktop/electron/piperEngine.js` + `internalTts.js`
- В `package.json.build.files`: `bin/**/*`, `models/**/*`
- В CI: кешировать модели HuggingFace, чтобы не качать каждый билд

Итоговый размер portable:
- Без моделей: ~180 МБ
- С одной Piper моделью: ~245 МБ
- С Silero torch: ~520 МБ (не рекомендуется для portable)

## 8. Итог

- Возможно ли встроить Silero SAPI5 внутрь? **Да**, через HKCU-регистрацию DLL и модель в папке приложения.
- Возможно ли не зависеть от SAPI вообще? **Да**, через Piper (лучший вариант для portable) или Silero ONNX.
- Нагрузка для только русского: **минимальна** (Piper) или **умеренная** (Silero).
- Рекомендация: в 3.2.0 добавить Piper `irina` как встроенный голос по умолчанию, оставить SAPI как fallback, Silero SAPI5 — опционально через HKCU.

