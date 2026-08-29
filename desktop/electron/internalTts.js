// Внутренний TTS без внешних установок.
// Поддерживает Piper (рекомендуется) и Silero ONNX через onnxruntime-node / sherpa-onnx.
// Если модели не найдены — возвращает null и приложение использует SAPI.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const PS_BASE = ["-NoLogo", "-STA", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

function baseDir() {
  // В упакованном exe модели и бинарники распакованы рядом с asar,
  // в dev — лежат в desktop/. Пробуем оба варианта.
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "app.asar.unpacked"));
    candidates.push(process.resourcesPath);
  }
  candidates.push(path.join(__dirname, ".."));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "models")) || fs.existsSync(path.join(c, "bin"))) return c;
  }
  return path.join(__dirname, "..");
}

function modelPaths() {
  const base = baseDir();
  return {
    piperIrina: path.join(base, "models", "piper", "ru_RU-irina-medium.onnx"),
    piperIrinaJson: path.join(base, "models", "piper", "ru_RU-irina-medium.onnx.json"),
    sileroOnnx: path.join(base, "models", "silero", "v5_ru.onnx"),
    binPiper: path.join(base, "bin", "piper", process.platform === "win32" ? "piper.exe" : "piper"),
  };
}

class InternalTtsEngine {
  constructor() {
    this.voices = [];
    this._sherpa = null;
    this._ortSession = null;
    this._piperConfig = null;
    this._scanVoices();
  }

  _scanVoices() {
    const { piperIrina, piperIrinaJson, sileroOnnx, binPiper } = modelPaths();
    const list = [];

    // Piper голоса — проверяем наличие файлов
    if (fs.existsSync(piperIrina) && fs.existsSync(piperIrinaJson)) {
      list.push({ id: "internal:irina", name: "Piper - Irina (встроенный, ru)", lang: "ru-RU", type: "piper" });
    } else {
      // Даже без файла показываем голос как «скачать» — UI предложит загрузку
      list.push({ id: "internal:irina:download", name: "Piper - Irina (скачать, ru, 63МБ)", lang: "ru-RU", type: "piper-download" });
    }

    // Дополнительные Piper голоса если есть
    const piperDir = path.join(path.dirname(piperIrina), "..");
    try {
      const files = fs.readdirSync(path.join(__dirname, "..", "models", "piper"));
      for (const f of files) {
        if (f.endsWith(".onnx") && !f.includes("irina")) {
          const name = f.replace(".onnx", "").replace("ru_RU-", "");
          list.push({ id: `internal:${name}`, name: `Piper - ${name} (встроенный, ru)`, lang: "ru-RU", type: "piper" });
        }
      }
    } catch {}

    // Silero ONNX если есть
    if (fs.existsSync(sileroOnnx)) {
      list.push({ id: "internal:silero-xenia", name: "Silero - Xenia (встроенный, ru)", lang: "ru-RU", type: "silero" });
      list.push({ id: "internal:silero-aidar", name: "Silero - Aidar (встроенный, ru)", lang: "ru-RU", type: "silero" });
      list.push({ id: "internal:silero-baya", name: "Silero - Baya (встроенный, ru)", lang: "ru-RU", type: "silero" });
    }

    this.voices = list;
  }

  getVoiceList() {
    return this.voices.map((v) => `${v.name}\u0001${v.lang}\u0001${v.type}`);
  }

  hasVoice(voiceId) {
    return this.voices.some((v) => v.id === voiceId || v.name === voiceId);
  }

  async _synthesizePiper(text, modelPath) {
    const { binPiper } = modelPaths();
    // Если есть бинарник piper — используем его
    if (fs.existsSync(binPiper)) {
      const tmp = path.join(os.tmpdir(), `yawa-piper-${Date.now()}.wav`);
      const binDir = path.dirname(binPiper);
      const espeak = path.join(binDir, "espeak-ng-data");
      const args = ["--model", modelPath, "--output_file", tmp];
      if (fs.existsSync(espeak)) args.push("--espeak_data", espeak);
      return new Promise((resolve) => {
        const child = spawn(binPiper, args, {
          windowsHide: true,
          cwd: binDir, // рядом лежат нужные DLL (onnxruntime, espeak)
          stdio: ["pipe", "ignore", "ignore"],
        });
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
        child.stdin.end(text, "utf8");
        child.on("exit", () => {
          try {
            const b64 = fs.readFileSync(tmp).toString("base64");
            fs.unlinkSync(tmp);
            finish(b64);
          } catch {
            finish(null);
          }
        });
        child.on("error", () => finish(null));
        setTimeout(() => { try { child.kill(); } catch {} finish(null); }, 15000);
      });
    }

    // Попытка через sherpa-onnx Node addon (если установлен)
    try {
      const sherpa = require("sherpa-onnx");
      // sherpa-onnx Node API: OfflineTts
      if (!this._sherpa) {
        const cfgPath = modelPath + ".json";
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        this._sherpa = sherpa.createOfflineTts({
          model: {
            vits: { model: modelPath, tokens: cfgPath, dataDir: "", dictDir: "" },
            numThreads: 2,
          },
        });
      }
      const audio = this._sherpa.generate({ text, sid: 0, speed: 1.0 });
      if (audio && audio.samples) {
        // Конвертируем float32 в WAV base64
        const wav = this._floatToWavBase64(audio.samples, audio.sampleRate || 22050);
        return wav;
      }
    } catch (e) {
      // console.error("[piper]", e.message);
    }

    return null;
  }

  _floatToWavBase64(samples, sampleRate) {
    const len = samples.length;
    const buf = Buffer.alloc(44 + len * 2);
    // RIFF header
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + len * 2, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(len * 2, 40);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, 44 + i * 2);
    }
    return buf.toString("base64");
  }

  async synthesizeWavBase64({ text, voice }) {
    if (!text || !String(text).trim()) return null;
    const { piperIrina, sileroOnnx } = modelPaths();
    const id = String(voice || "").toLowerCase();

    // Piper Irina
    if (id.includes("irina")) {
      if (!fs.existsSync(piperIrina)) return null;
      return this._synthesizePiper(text, piperIrina);
    }

    // Любой другой Piper голос
    if (id.startsWith("internal:") && id.includes("piper") === false) {
      // Пытаемся найти модель по имени
      const name = id.replace("internal:", "").split(":")[0];
      const p = path.join(path.dirname(piperIrina), `ru_RU-${name}-medium.onnx`);
      if (fs.existsSync(p)) return this._synthesizePiper(text, p);
    }

    // Silero ONNX (заглушка — нужен порт pipeline)
    if (id.includes("silero") && fs.existsSync(sileroOnnx)) {
      // TODO: реализовать Silero ONNX inference через onnxruntime-node
      // Пока возвращаем null и падаем в SAPI fallback
      return null;
    }

    return null;
  }
}

module.exports = { InternalTtsEngine, modelPaths };
