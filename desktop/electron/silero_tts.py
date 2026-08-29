#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Silero TTS для YawaChatHub — русский язык, офлайн после первой загрузки.

Требования:
  pip install torch torchaudio silero

Использование:
  python silero_tts.py
  # затем в stdin построчно JSON:
  # {"text":"Привет из чата!","speaker":"kseniya","sample_rate":48000,"out":"C:\\Temp\\out.wav"}
  # ответ в stdout: {"ok":true,"out":"C:\\Temp\\out.wav"} или {"ok":false,"error":"..."}

Модель: v5_ru (русский, авто-ударения). Скачивается автоматически при первом запуске
в кеш torch.hub (~60 МБ). Голоса: aidar, baya, kseniya, xenia, eugene, random.

Нагрузка:
  - RAM: ~350-500 МБ (torch + модель)
  - CPU: 1 ядро на 40-70% во время синтеза, RTF ~0.3 (5 сек аудио за ~1.5 сек)
  - GPU: если есть CUDA — в 3-5 раз быстрее, нагрузка на GPU минимальна
  - Диск: модель ~60 МБ + torch ~200 МБ
"""

import sys
import json
import base64
import os
import traceback

try:
    import torch
except ImportError:
    print(json.dumps({"ok": False, "error": "torch не установлен: pip install torch torchaudio"}), flush=True)
    sys.exit(1)

MODEL_ID = "v5_ru"
SPEAKERS = ["aidar", "baya", "kseniya", "xenia", "eugene", "random"]

def load_model():
    try:
        # Пытаемся загрузить локально, если файл есть рядом
        local_path = os.path.join(os.path.dirname(__file__), "v5_ru.pt")
        if os.path.exists(local_path):
            model = torch.package.PackageImporter(local_path).load_pickle("tts_models", "model")
            # Fallback to hub if local fails
            raise Exception("local package importer not supported, use hub")
        model, _ = torch.hub.load(
            repo_or_dir='snakers4/silero-models',
            model='silero_tts',
            language='ru',
            speaker=MODEL_ID,
            trust_repo=True
        )
        model.to(torch.device('cpu'))
        return model
    except Exception as e:
        # Пробуем pip пакет silero
        try:
            from silero import silero_tts
            model, _ = silero_tts(language='ru', speaker=MODEL_ID)
            model.to(torch.device('cpu'))
            return model
        except Exception:
            raise e

def main():
    print("Загрузка Silero модели ru v5...", file=sys.stderr, flush=True)
    try:
        model = load_model()
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Не удалось загрузить модель: {e}\n{traceback.format_exc()}"}), flush=True)
        sys.exit(1)

    print(json.dumps({"ok": True, "ready": True, "speakers": SPEAKERS}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
            if job.get("cmd") == "quit":
                break
            text = job.get("text", "").strip()
            if not text:
                print(json.dumps({"ok": True, "id": job.get("id"), "empty": True}), flush=True)
                continue

            speaker = job.get("speaker", "kseniya")
            if speaker not in SPEAKERS:
                speaker = "kseniya"
            sample_rate = int(job.get("sample_rate", 48000))
            out_path = job.get("out")

            # Синтез
            audio = model.apply_tts(text=text, speaker=speaker, sample_rate=sample_rate)

            if out_path:
                # Сохраняем wav
                import torchaudio
                # audio is tensor [samples]
                if len(audio.shape) == 1:
                    audio = audio.unsqueeze(0)
                torchaudio.save(out_path, audio, sample_rate)
                print(json.dumps({"ok": True, "id": job.get("id"), "out": out_path}), flush=True)
            else:
                # Возвращаем base64 wav в памяти
                import io
                import soundfile as sf
                buf = io.BytesIO()
                sf.write(buf, audio.numpy(), sample_rate, format='WAV')
                b64 = base64.b64encode(buf.getvalue()).decode('ascii')
                print(json.dumps({"ok": True, "id": job.get("id"), "audioBase64": b64}), flush=True)

        except Exception as e:
            print(json.dumps({"ok": False, "id": job.get("id") if 'job' in locals() else None, "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
