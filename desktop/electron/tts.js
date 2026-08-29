// Озвучка системными голосами Windows (SAPI).
//
// Оптимизация задержки: раньше на КАЖДОЕ сообщение запускался новый PowerShell
// (1–2 секунды на старт). Теперь работает один постоянный процесс-синтезатор,
// который читает задания из stdin — озвучка стартует мгновенно.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PS_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

// Текст передаём base64 — так не ломаются кавычки, юникод и переводы строк.
const HOST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  try {
    $job = $line | ConvertFrom-Json
    if ($job.cmd -eq 'quit') { break }
    if ($job.voice) { try { $synth.SelectVoice($job.voice) } catch {} }
    $synth.Rate = [int]$job.rate
    $synth.Volume = [int]$job.volume
    $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($job.text))
    if (-not [String]::IsNullOrWhiteSpace($text)) { $synth.Speak($text) }
  } catch {}
  [Console]::Out.WriteLine('done')
  [Console]::Out.Flush()
}
$synth.Dispose()
`;

class TtsEngine {
  constructor() {
    this.queue = [];
    this.host = null;
    this.ready = false;
    this.currentId = null;
    this.onEnd = null;
    this._voices = null;
    this._buffer = "";
    if (process.platform === "win32") this._ensureHost();
  }

  /** Поднимает постоянный процесс синтеза (и переиспользует его). */
  _ensureHost() {
    if (this.host || process.platform !== "win32") return this.host;
    let child;
    try {
      child = spawn("powershell.exe", [...PS_ARGS, HOST_SCRIPT], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      console.error("[tts] не удалось запустить PowerShell:", e.message);
      return null;
    }

    this.host = child;
    this.ready = false;
    this._buffer = "";
    child.stdin.setDefaultEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      this._buffer += chunk.toString("utf8");
      let nl;
      while ((nl = this._buffer.indexOf("\n")) !== -1) {
        const line = this._buffer.slice(0, nl).trim();
        this._buffer = this._buffer.slice(nl + 1);
        if (line === "ready") {
          this.ready = true;
          this._pump();
        } else if (line === "done") {
          this._finishCurrent();
        }
      }
    });

    const drop = () => {
      if (this.host !== child) return;
      this.host = null;
      this.ready = false;
      this._finishCurrent();
    };
    child.once("exit", drop);
    child.once("error", drop);
    return child;
  }

  _finishCurrent() {
    const id = this.currentId;
    this.currentId = null;
    if (id && this.onEnd) this.onEnd(id);
    setImmediate(() => this._pump());
  }

  /** Отправляет следующее задание, если синтезатор свободен. */
  _pump() {
    if (this.currentId || !this.queue.length) return;
    const host = this._ensureHost();
    if (!host || !this.ready) return;

    const item = this.queue.shift();
    this.currentId = item.id;
    const job = {
      id: item.id,
      rate: Math.max(-10, Math.min(10, Math.round((Number(item.rate ?? 1) - 1) * 10))),
      volume: Math.max(0, Math.min(100, Math.round(Number(item.volume ?? 0.9) * 100))),
      voice: item.voice || "",
      text: Buffer.from(String(item.text || ""), "utf8").toString("base64"),
    };
    try {
      host.stdin.write(`${JSON.stringify(job)}\n`);
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

  /** Прерывает текущую фразу: перезапускаем процесс — Speak блокирующий. */
  skip() {
    if (!this.host) return;
    const child = this.host;
    this.host = null;
    this.ready = false;
    try { child.kill(); } catch { /* noop */ }
    this._finishCurrent();
    this._ensureHost();
  }

  stopAll() {
    this.queue = [];
    this.skip();
  }

  dispose() {
    this.queue = [];
    if (!this.host) return;
    try {
      this.host.stdin.write(`${JSON.stringify({ cmd: "quit" })}\n`);
      this.host.kill();
    } catch { /* noop */ }
    this.host = null;
  }

  /** Список установленных голосов SAPI (кешируется). */
  async voices() {
    if (this._voices) return this._voices;
    if (process.platform !== "win32") return [];
    const script =
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);" +
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name };" +
      "$s.Dispose();";

    this._voices = await new Promise((resolve) => {
      const child = spawn("powershell.exe", [...PS_ARGS, script], { windowsHide: true });
      let out = "";
      let resolved = false;
      const done = (voices) => {
        if (resolved) return;
        resolved = true;
        resolve(voices);
      };
      child.stdout.on("data", (d) => (out += d.toString("utf8")));
      child.once("exit", () => done(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
      child.once("error", () => done([]));
      setTimeout(() => {
        try { child.kill(); } catch { /* noop */ }
        done([]);
      }, 15000);
    });
    return this._voices;
  }

  /** Синтез в WAV для OBS Browser Source: аудио играет внутри источника. */
  async synthesizeWavBase64({ text, rate = 1, volume = 0.9, voice }) {
    if (process.platform !== "win32" || !String(text || "").trim()) return null;
    const file = path.join(os.tmpdir(), `yawa-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const sapiRate = Math.max(-10, Math.min(10, Math.round((Number(rate) - 1) * 10)));
    const sapiVolume = Math.max(0, Math.min(100, Math.round(Number(volume) * 100)));
    const encodedText = Buffer.from(String(text), "utf8").toString("base64");
    const safeFile = file.replace(/'/g, "''");
    const voiceLine = voice ? `try { $s.SelectVoice('${String(voice).replace(/'/g, "''")}') } catch {}` : "";
    const script =
      "$ErrorActionPreference='Stop';" +
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      voiceLine +
      `$s.Rate=${sapiRate};$s.Volume=${sapiVolume};` +
      `$s.SetOutputToWaveFile('${safeFile}');` +
      `$t=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedText}'));` +
      "$s.Speak($t);$s.Dispose();";

    return new Promise((resolve) => {
      const child = spawn("powershell.exe", [...PS_ARGS, script], { windowsHide: true });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          const b64 = fs.readFileSync(file).toString("base64");
          fs.unlinkSync(file);
          resolve(b64);
        } catch {
          resolve(null);
        }
      };
      child.once("exit", finish);
      child.once("error", () => resolve(null));
      setTimeout(() => {
        try { child.kill(); } catch { /* noop */ }
        finish();
      }, 15000);
    });
  }
}

module.exports = { TtsEngine };
