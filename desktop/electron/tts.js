// Озвучка системными голосами Windows (SAPI).
//
// Оптимизация задержки: постоянный процесс-синтезатор читает задания из stdin
// — озвучка стартует мгновенно, без запуска нового PowerShell на каждое сообщение.
//
// Голоса ищутся из 64-бит и 32-бит PowerShell, чтобы увидеть все установленные
// SAPI5-голоса независимо от разрядности их COM-компонента.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PS_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

const WIN_DIR = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
const PS_64 = path.join(WIN_DIR, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const PS_32 = path.join(WIN_DIR, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe");

function psExeFor(bitness) {
  if (bitness === "32" && fs.existsSync(PS_32)) return PS_32;
  return fs.existsSync(PS_64) ? PS_64 : "powershell.exe";
}

// SSML с явным xml:lang="ru-RU" гарантирует, что голос всегда работает
// в русском режиме даже если в манифесте SAPI5-компонента записан иной Culture.
function speakLoopScript() {
  return `
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
    if (-not [String]::IsNullOrWhiteSpace($text)) {
      $escaped = [System.Security.SecurityElement]::Escape($text)
      if ($job.voice) {
        $voiceName = $job.voice.Replace("'", "&apos;")
        $voiceTag = "<voice name='$voiceName' xml:lang='ru-RU'>$escaped</voice>"
      } else {
        $voiceTag = $escaped
      }
      $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'>$voiceTag</speak>"
      $ok = $false
      try { $synth.SpeakSsml($ssml); $ok = $true } catch { $ok = $false }
      if (-not $ok) { try { $synth.Speak($text) } catch {} }
    }
  } catch {}
  [Console]::Out.WriteLine('done')
  [Console]::Out.Flush()
}
$synth.Dispose()
`;
}

// Список голосов из ТЕКУЩЕГО процесса.
const LIST_VOICES_SCRIPT =
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);" +
  "Add-Type -AssemblyName System.Speech;" +
  "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
  "$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name };" +
  "$s.Dispose();";

function runPs(exe, script, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, [...PS_ARGS, script], { windowsHide: true });
    } catch {
      resolve("");
      return;
    }
    let out = "";
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve(out);
    };
    child.stdout?.on("data", (d) => (out += d.toString("utf8")));
    child.once("exit", done);
    child.once("error", () => resolve(""));
    setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      done();
    }, timeoutMs);
  });
}

class VoiceHost {
  constructor(bitness) {
    this.bitness = bitness;
    this.queue = [];
    this.host = null;
    this.ready = false;
    this.currentId = null;
    this.onEnd = null;
    this._buffer = "";
  }

  _ensure() {
    if (this.host) return this.host;
    const exe = psExeFor(this.bitness);
    let child;
    try {
      child = spawn(exe, [...PS_ARGS, speakLoopScript()], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      console.error(`[tts:${this.bitness}] не удалось запустить PowerShell:`, e.message);
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

  _pump() {
    if (this.currentId || !this.queue.length) return;
    const host = this._ensure();
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
    this.queue.push(item);
    if (this.queue.length > 12) this.queue.shift();
    this._pump();
  }

  skip() {
    if (!this.host) return;
    const child = this.host;
    this.host = null;
    this.ready = false;
    try { child.kill(); } catch { /* noop */ }
    this._finishCurrent();
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
}

class TtsEngine {
  constructor() {
    this.onEnd = null;
    this._voices = null;
    this._voiceBitness = new Map(); // name(lowercase) -> "64" | "32"
    this._hosts = { 64: null, 32: null };
    if (process.platform === "win32") {
      this._hosts[64] = new VoiceHost("64");
      this._hosts[64].onEnd = (id) => this.onEnd && this.onEnd(id);
    }
  }

  _hostFor(voiceName) {
    const bit = voiceName ? this._voiceBitness.get(String(voiceName).toLowerCase()) : null;
    if (bit === "32") {
      if (!this._hosts[32]) {
        this._hosts[32] = new VoiceHost("32");
        this._hosts[32].onEnd = (id) => this.onEnd && this.onEnd(id);
      }
      return this._hosts[32];
    }
    if (!this._hosts[64]) {
      this._hosts[64] = new VoiceHost("64");
      this._hosts[64].onEnd = (id) => this.onEnd && this.onEnd(id);
    }
    return this._hosts[64];
  }

  speak(item) {
    if (!item || !String(item.text || "").trim()) return item?.id || "";
    this._hostFor(item.voice).speak(item);
    return item.id;
  }

  skip() {
    if (this._hosts[64]) this._hosts[64].skip();
    if (this._hosts[32]) this._hosts[32].skip();
  }

  stopAll() {
    if (this._hosts[64]) this._hosts[64].stopAll();
    if (this._hosts[32]) this._hosts[32].stopAll();
  }

  dispose() {
    if (this._hosts[64]) this._hosts[64].dispose();
    if (this._hosts[32]) this._hosts[32].dispose();
  }

  /** Список установленных SAPI5-голосов из 64-бит и 32-бит реестра (кешируется). */
  async voices() {
    if (this._voices) return this._voices;
    if (process.platform !== "win32") return [];

    const parse = (out) => out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

    const [out64, out32raw] = await Promise.all([
      runPs(psExeFor("64"), LIST_VOICES_SCRIPT),
      fs.existsSync(PS_32) ? runPs(psExeFor("32"), LIST_VOICES_SCRIPT) : Promise.resolve(""),
    ]);

    const names64 = parse(out64);
    const names32 = parse(out32raw);

    for (const n of names64) this._voiceBitness.set(n.toLowerCase(), "64");
    for (const n of names32) {
      if (!this._voiceBitness.has(n.toLowerCase())) this._voiceBitness.set(n.toLowerCase(), "32");
    }

    const merged = [];
    const seen = new Set();
    for (const n of [...names64, ...names32]) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(n);
    }

    this._voices = merged;
    return this._voices;
  }
}

module.exports = { TtsEngine };
