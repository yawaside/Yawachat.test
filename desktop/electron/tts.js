// Озвучка системными голосами Windows (SAPI) через System.Speech.
// Очередь не блокирует приём сообщений; пропуск = остановка текущего процесса.
const { spawn } = require("child_process");

function sapiProcess({ text, rate, volume, voice }) {
  // rate (0.5..2 web) -> SAPI Rate (-10..10)
  const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)));
  const sapiVolume = Math.max(0, Math.min(100, Math.round(volume * 100)));
  const voiceLine = voice
    ? `try { $s.SelectVoice('${String(voice).replace(/'/g, "''")}'); } catch {}`
    : "";
  const script =
    "Add-Type -AssemblyName System.Speech;" +
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
    voiceLine +
    `$s.Rate = ${sapiRate}; $s.Volume = ${sapiVolume};` +
    "$s.Speak([Console]::In.ReadToEnd()); $s.Dispose();";
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
  });
  child.stdin.write(text, "utf8");
  child.stdin.end();
  return child;
}

class TtsEngine {
  constructor() {
    this.queue = [];
    this.child = null;
    this.currentId = null;
    this.onEnd = null; // (id) => void
    this._voices = null;
  }

  speak(item) {
    this.queue.push(item);
    if (this.queue.length > 12) this.queue.shift();
    this._next();
    return item.id;
  }

  _next() {
    if (this.child || !this.queue.length) return;
    const item = this.queue.shift();
    this.currentId = item.id;
    let finished = false;
    try {
      this.child = sapiProcess(item);
    } catch (e) {
      console.error("[tts] не удалось запустить powershell:", e.message);
      this.child = null;
      return this._finish(item.id);
    }
    this.child.on("exit", () => {
      if (!finished) this._finish(item.id);
    });
    this.child.on("error", () => {
      if (!finished) this._finish(item.id);
    });
    const finishGuard = setTimeout(() => {
      finished = true;
    }, 300000);
    this.child.on("exit", () => clearTimeout(finishGuard));
  }

  _finish(id) {
    this.child = null;
    if (this.currentId === id) this.currentId = null;
    if (this.onEnd) this.onEnd(id);
    setImmediate(() => this._next());
  }

  skip() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* noop */
      }
    }
  }

  stopAll() {
    this.queue = [];
    this.skip();
  }

  /** Список установленных голосов SAPI (кешируется). */
  async voices() {
    if (this._voices) return this._voices;
    if (process.platform !== "win32") return [];
    const script =
      "Add-Type -AssemblyName System.Speech;" +
      "$sapi=(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name };" +
      "$oc=@();" +
      "try { $oc=(Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices\\Tokens' | ForEach-Object { $_.GetValue('') }) } catch {} ;" +
      "$all=@($sapi+$oc) | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique;" +
      "$all | ForEach-Object { $_ };";
    try {
      this._voices = await new Promise((resolve) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
          windowsHide: true,
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString("utf8")));
        child.on("exit", () =>
          resolve(
            out
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
          )
        );
        child.on("error", () => resolve([]));
        setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* noop */
          }
          resolve([]);
        }, 15000);
      });
    } catch {
      this._voices = [];
    }
    return this._voices;
  }
}

module.exports = { TtsEngine };
