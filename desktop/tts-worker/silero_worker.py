# -*- coding: utf-8 -*-
# YawaChatHub — встроенный Silero TTS-воркер (только русский, v5_5_ru).
#
# Протокол: JSON-строки по stdin/stdout.
#   stdin : {"id":"1","text":"привет","speaker":"xenia","sample_rate":24000,"rate":1.0,"volume":0.9}
#   stdout: {"ready":true,"speakers":[...]}        — после загрузки модели
#           {"id":"1","ok":true,"wav":"path.wav"}  — результат синтеза
#           {"id":"1","ok":false,"error":"..."}
#
# Работает на embedded Python (без pip-пакета silero): модель грузится
# напрямую из torch.package, как в Standalone Use из README silero-models.

import os
import sys
import json
import wave

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "tmp-out")
MODEL_PATH = os.environ.get("SILERO_MODEL_PATH") or os.path.join(BASE, "v5_5_ru.pt")


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if not os.path.isfile(MODEL_PATH):
        emit({"ready": False, "error": "Модель не найдена: " + MODEL_PATH})
        return

    try:
        import torch
    except Exception as e:  # noqa: BLE001
        emit({"ready": False, "error": "PyTorch не загружен: " + str(e)})
        return

    # Считаем не все ядра — чтобы не фризить стрим/игру
    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    torch.set_grad_enabled(False)

    try:
        importer = torch.package.PackageImporter(MODEL_PATH)
        model = importer.load_pickle("tts_models", "model")
    except Exception as e:  # noqa: BLE001
        emit({"ready": False, "error": "Не удалось загрузить модель: " + str(e)})
        return

    speakers = []
    try:
        config = importer.load_pickle("tts_models", "config")
        if config is not None and hasattr(config, "speakers"):
            speakers = [str(s) for s in config.speakers]
    except Exception:  # noqa: BLE001
        speakers = []
    if not speakers:
        # Голоса v5_5_ru (строго русский)
        speakers = ["aidar", "baya", "kseniya", "xenia", "eugene"]

    emit({"ready": True, "speakers": speakers, "model": os.path.basename(MODEL_PATH)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except Exception:  # noqa: BLE001
            continue

        job_id = str(job.get("id", ""))
        try:
            text = (job.get("text") or "").strip()
            speaker = job.get("speaker") or "xenia"
            sample_rate = int(job.get("sample_rate") or 24000)
            rate = float(job.get("rate") or 1.0)
            volume = job.get("volume")
            volume = float(volume) if volume is not None else 0.9
            volume = max(0.0, min(1.0, volume))

            if not text:
                emit({"id": job_id, "ok": True, "empty": True})
                continue

            # Синтез. speed — скорость речи (v5 умеет); если модель старая и
            # не принимает параметр — повторяем без него.
            audio = None
            try:
                audio = model.apply_tts(
                    text=text, speaker=speaker, sample_rate=sample_rate, speed=rate
                )
            except TypeError:
                audio = model.apply_tts(text=text, speaker=speaker, sample_rate=sample_rate)

            audio = audio.detach().float().squeeze(0)
            if volume != 1.0:
                audio = audio * volume
            audio = (audio * 32767.0).clamp(-32768, 32767).cpu().numpy().astype("int16")

            out_path = os.path.join(OUT_DIR, job_id + ".wav")
            with wave.open(out_path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(sample_rate)
                w.writeframes(audio.tobytes())

            emit({"id": job_id, "ok": True, "wav": out_path})
        except Exception as e:  # noqa: BLE001
            emit({"id": job_id, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
