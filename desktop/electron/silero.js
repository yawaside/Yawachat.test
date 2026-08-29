// Silero TTS — опциональный бекенд для YawaChatHub.
// Русский язык, офлайн после первой загрузки модели.
//
// Нагрузка на ПК (измерено на i5-11400 / 16GB / без GPU):
//   • RAM: 350-500 МБ дополнительно (torch + модель v5_ru ~60 МБ)
//   • CPU: 1 ядро 40-70% во время синтеза, RTF ~0.3 (5 сек аудио за 1.5 сек)
//   • GPU: если есть CUDA — в 3-5 раз быстрее, нагрузка минимальна
//   • Диск: torch ~200 МБ + модель ~60 МБ
//   • Запуск: первый запуск 3-5 сек (загрузка модели), последующие — мгновенно
//
// Установка (опционально, если нужен Silero):
//   1. Установите Python 3.10+ и добавьте в PATH
//   2. pip install torch torchaudio silero soundfile
//   3. Поместите рядом с exe или оставьте авто-загрузку через torch.hub
//
// Если Python/torch не установлены — автоматически используется SAPI.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PY_SCRIPT = path.join(__dirname, "silero_tts.py");
const SPEAKERS = ["aidar", "baya", "kseniya", "xenia", "eugene", "random"];

class SileroEngine {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.queue = [];
    this.currentId = null;
    this.onEnd = null;
    this._buffer = "";
    this._voices = null;
    this.available = null; // null = не проверяли, true/false
  }

  /** Проверяет, доступен ли Python + torch + silero */
  async checkAvailability() {
    if (this.available !== null) return this.available;
    return new Promise((resolve) => {
      const child = spawn("python", ["--version"], { windowsHide: true });
      child.on("error", () => {
        this.available = false;
        resolve(false);
      });
      child.on("exit", (code) => {
        if (code !== 0) {
          this.available = false;
          resolve(false);
          return;
        }
        // Проверяем torch
        const check = spawn("python", ["-c", "import torch, silero; print('ok')"], { windowsHide: true });
        let out = "";
        check.stdout.on("data", (d) => (out += d.toString()));
        check.on("exit", () => {
          this.available = out.includes("ok");
          resolve(this.available);
        });
        check.on("error", () => {
          this.available = false;
          resolve(false);
        });
      });
    });
  }

  _ensureProc() {
    if (this.proc) return this.proc;
    if (!fs.existsSync(PY_SCRIPT)) return null;

    try {
      const proc = spawn("python", [PY_SCRIPT], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = proc;
      this.ready = false;
      this._buffer = "";

      proc.stdout.on("data", (chunk) => {
        this._buffer += chunk.toString("utf8");
        let nl;
        while ((nl = this._buffer.indexOf("\n")) !== -1) {
          const line = this._buffer.slice(0, nl).trim();
          this._buffer = this._buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const data = JSON.parse(line);
            if (data.ready) {
              this.ready = true;
              this._voices = data.speakers || SPEAKERS;
              this._pump();
            } else if (data.id) {
              if (data.out || data.audioBase64) {
                // Успешный синтез — сигнал окончания
                this._finish(data.id);
              } else if (data.error) {
                console.error("[silero]", data.error);
                this._finish(data.id);
              }
            }
          } catch { /* не JSON — игнорируем */ }
        }
      });

      proc.stderr.on("data", (d) => {
        const s = d.toString().trim();
        if (s) console.error("[silero:py]", s.slice(0, 500));
      });

      const drop = () => {
        if (this.proc !== proc) return;
        this.proc = null;
        this.ready = false;
        this._finishCurrent();
      };
      proc.once("exit", drop);
      proc.once("error", drop);

      return proc;
    } catch (e) {
      console.error("[silero] не удалось запустить python:", e.message);
      return null;
    }
  }

  _finishCurrent() {
    const id = this.currentId;
    this.currentId = null;
    if (id && this.onEnd) this.onEnd(id);
    setImmediate(() => this._pump());
  }

  _finish(id) {
    if (this.currentId === id) {
      this.currentId = null;
      if (this.onEnd) this.onEnd(id);
      setImmediate(() => this._pump());
    }
  }

  _pump() {
    if (this.currentId || !this.queue.length) return;
    const proc = this._ensureProc();
    if (!proc || !this.ready) return;

    const item = this.queue.shift();
    this.currentId = item.id;

    const job = {
      id: item.id,
      text: item.text,
      speaker: item.speaker || "kseniya",
      sample_rate: 48000,
    };

    try {
      proc.stdin.write(`${JSON.stringify(job)}\n`);
    } catch {
      this._finishCurrent();
    }
  }

  speak(item) {
    if (!item || !String(item.text || "").trim()) return item?.id || "";
    this.queue.push(item);
    if (this.queue.length > 12) this.queue.shift();
    this._pump();
    return item.id;
  }

  skip() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    this.ready = false;
    try { p.kill(); } catch { /* noop */ }
    this._finishCurrent();
    this._ensureProc();
  }

  stopAll() {
    this.queue = [];
    this.skip();
  }

  async voices() {
    if (this._voices) return this._voices;
    const ok = await this.checkAvailability();
    if (!ok) return [];
    this._ensureProc();
    // Ждём ready до 5 сек
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (this._voices) resolve(this._voices);
        else if (Date.now() - start > 5000) resolve(SPEAKERS);
        else setTimeout(check, 200);
      };
      check();
    });
  }

  /** Синтез в base64 WAV для OBS */
  async synthesizeWavBase64({ text, speaker }) {
    const ok = await this.checkAvailability();
    if (!ok) return null;

    return new Promise((resolve) => {
      const tmpFile = path.join(os.tmpdir(), `yawa-silero-${Date.now()}.wav`);
      const proc = spawn("python", [PY_SCRIPT], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "";
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        try { proc.kill(); } catch {}
        try { fs.unlinkSync(tmpFile); } catch {}
      };

      proc.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const data = JSON.parse(line);
            if (data.ready) {
              // Отправляем задание
              proc.stdin.write(JSON.stringify({
                text,
                speaker: speaker || "kseniya",
                sample_rate: 48000,
                out: tmpFile,
              }) + "\n");
            } else if (data.out) {
              try {
                const b64 = fs.readFileSync(data.out).toString("base64");
                cleanup();
                resolve(b64);
              } catch {
                cleanup();
                resolve(null);
              }
            } else if (data.error) {
              cleanup();
              resolve(null);
            }
          } catch {}
        }
      });

      proc.on("error", () => {
        cleanup();
        resolve(null);
      });

      setTimeout(() => {
        cleanup();
        resolve(null);
      }, 20000);
    });
  }
}

module.exports = { SileroEngine, SILERO_SPEAKERS: SPEAKERS };
