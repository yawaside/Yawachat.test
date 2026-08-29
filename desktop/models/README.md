# Модели TTS для встраивания

Эта папка для **внутренних** голосов, чтобы не зависеть от внешних SAPI5 установок.

## Piper (рекомендуется, 3.2.0)

Скачайте при первом запуске или вручную:

```bash
mkdir -p desktop/models/piper
cd desktop/models/piper

# Irina — лучшая русская (63 МБ, UTMOS 3.67)
curl -L -o ru_RU-irina-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx
curl -L -o ru_RU-irina-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json

# Опционально другие русские
# Denis, Dmitri, Ruslan — по той же схеме
```

Бинарник Piper (опционально, если нет sherpa-onnx):
```bash
mkdir -p desktop/bin/piper
# Скачайте piper_windows_amd64.zip с https://github.com/rhasspy/piper/releases
# Распакуйте piper.exe и espeak-ng-data в desktop/bin/piper/
```

## Silero v5_ru (эксперимент)

```bash
mkdir -p desktop/models/silero
curl -L -o desktop/models/silero/v5_ru.pt https://models.silero.ai/models/tts/ru/v5_ru.pt
# Для ONNX нужен экспорт — см. docs/INTERNAL_VOICES.md
```

## Как это работает

- Если модель есть — голос появится в списке как `Piper - Irina (встроенный, ru)` и будет работать без внешних установок.
- Если модели нет — показывается `скачать` вариант и используется SAPI fallback.
- При сборке `electron-builder` папки `models/` и `bin/` попадают в exe (см. package.json build.files).
- Для маленького portable можно не класть модели в репозиторий, а скачивать в `%APPDATA%/YawaChatHub/models/` при первом запуске.

## Нагрузка

- Piper: 60-90 МБ RAM, 40-90 мс на фразу, CPU <2%
- Silero torch: 350-500 МБ RAM, 150-400 мс на фразу, CPU 50-90% на момент синтеза

Только русский язык.

