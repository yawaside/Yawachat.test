// Озвучка системными голосами Windows (SAPI) через System.Speech.
// Очередь не блокирует приём сообщений; пропуск = остановка текущего процесса.
const { spawn } = require("child_process");

function sapiProcess({ text, rate = 1, volume = 0.9, voice }) {
  const sapiRate = Math.max(-10, Math.min(10, Math.round((Number(rate) - 1) * 10)));
  const sapiVolume = Math.max(0, Math.min(100, Math.round(Number(volume) * 100)));
  const voiceLine = voice
    ? `try { $s.SelectVoice('${String(voice).replace(/'/g, "''")}'); } catch {}`
    : "";
  const script =
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);" +
    "Add-Type -AssemblyName System.Speech;" +
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
    voiceLine +
    `$s.Rate = ${sapiRate}; $s.Volume = ${sapiVolume};` +
    "$text = [Console]::In.ReadToEnd();" +
    "if (-not [String]::IsNullOrWhiteSpace($text)) { $s.Speak($text) };" +
    "$s.Dispose();";

  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }
  );
  child.stdin.setDefaultEncoding("utf8");
  child.stdin.end(String(text || ""), "utf8");
  return child;
}

class TtsEngine {
  constructor() {
    this.queue = [];
    this.child = null;
    this.currentId = null;
    this.onEnd = null;
    this._voices = null;
  }

  speak(item) {
    if (!item || !String(item.text || "").trim()) return item?.id || "";
    this.queue.push(item);
    if (this.queue.length > 12) this.queue.shift();
    this._next();
    return item.id;
  }

  _next() {
    if (this.child || !this.queue.length) return;
    const item = this.queue.shift();
    this.currentId = item.id;
    let settled = false;
    let child;
    const finish = () => {
      if (settled) return;
      settled = true;
      this._finish(item.id);
    };

    try {
      child = sapiProcess(item);
      this.child = child;
    } catch (e) {
      console.error("[tts] не удалось запустить PowerShell:", e.message);
      finish();
      return;
    }

    let err = "";
    child.stderr?.on("data", (chunk) => (err += chunk.toString("utf8")));
    child.once("exit", (code) => {
      if (code && err.trim()) console.error("[tts] SAPI:", err.trim());
      finish();
    });
    child.once("error", (e) => {
      console.error("[tts] PowerShell:", e.message);
      finish();
    });
  }

  _finish(id) {
    this.child = null;
    if (this.currentId === id) this.currentId = null;
    if (this.onEnd) this.onEnd(id);
    setImmediate(() => this._next());
  }

  skip() {
    if (!this.child) return;
    try { this.child.kill(); } catch { /* noop */ }
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
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);" +
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name };" +
      "$s.Dispose();";

    this._voices = await new Promise((resolve) => {
      const child = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true }
      );
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
}

module.exports = { TtsEngine };