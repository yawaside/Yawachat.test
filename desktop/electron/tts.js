// Озвучка Windows через SAPI5 — поддерживает как классические SAPI, так и OneCore голоса.
// Один постоянный PowerShell-процесс (SAPI.SpVoice COM) — озвучка стартует мгновенно.
// Поддерживает Silero SAPI5 (и другие сторонние русские голоса) — они появляются в списке.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PS_BASE = ["-NoLogo", "-STA", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

const PS_HELPERS = `
function Decode64($s) {
  if ([String]::IsNullOrEmpty($s)) { return '' }
  try { return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($s)) } catch { return $s }
}
$script:sapiCache = @{}
$script:oneCache = @{}
function Load-Caches {
  try {
    $cat = New-Object -ComObject SAPI.SpObjectTokenCategory
    $cat.SetID('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech\\Voices', $false)
    foreach ($t in $cat.EnumerateTokens()) {
      $n = $t.GetAttribute('Name'); if ($n) { $script:sapiCache[$n] = $t }
    }
  } catch {}
  try {
    $cat2 = New-Object -ComObject SAPI.SpObjectTokenCategory
    $cat2.SetID('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices', $false)
    foreach ($t in $cat2.EnumerateTokens()) {
      $n = $t.GetAttribute('Name'); if ($n) { $script:oneCache[$n] = $t }
    }
  } catch {}
}
function Select-Voice($sp, $wanted) {
  if ([String]::IsNullOrWhiteSpace($wanted)) { return $false }
  $lw = $wanted.ToLowerInvariant()
  foreach ($kv in $script:sapiCache.GetEnumerator()) {
    if ($kv.Key -ceq $wanted -or $kv.Key.ToLowerInvariant() -eq $lw) { try { $sp.Voice = $kv.Value; return $true } catch {} }
  }
  foreach ($kv in $script:oneCache.GetEnumerator()) {
    if ($kv.Key -ceq $wanted -or $kv.Key.ToLowerInvariant() -eq $lw) { try { $sp.Voice = $kv.Value; return $true } catch {} }
  }
  foreach ($kv in $script:sapiCache.GetEnumerator()) {
    $kl = $kv.Key.ToLowerInvariant()
    if ($kl.Contains($lw) -or $lw.Contains($kl)) { try { $sp.Voice = $kv.Value; return $true } catch {} }
  }
  foreach ($kv in $script:oneCache.GetEnumerator()) {
    $kl = $kv.Key.ToLowerInvariant()
    if ($kl.Contains($lw) -or $lw.Contains($kl)) { try { $sp.Voice = $kv.Value; return $true } catch {} }
  }
  return $false
}
function Select-Russian($sp) {
  $cands = @('ru','рус','silero','irina','pavel','ирина','павел','aidar','baya','kseniya','xenia','eugene')
  foreach ($cat in @($script:sapiCache, $script:oneCache)) {
    foreach ($kv in $cat.GetEnumerator()) {
      $kl = $kv.Key.ToLowerInvariant()
      foreach ($c in $cands) { if ($kl.Contains($c)) { try { $sp.Voice = $kv.Value; return $true } catch {} } }
    }
  }
  try {
    foreach ($kv in $script:sapiCache.GetEnumerator()) {
      try { $lang = $kv.Value.GetAttribute('Language'); if ($lang -eq '419' -or $lang -eq '1049') { $sp.Voice = $kv.Value; return $true } } catch {}
    }
  } catch {}
  try {
    foreach ($kv in $script:oneCache.GetEnumerator()) {
      try { $lang = $kv.Value.GetAttribute('Language'); if ($lang -eq '419' -or $lang -eq '1049') { $sp.Voice = $kv.Value; return $true } } catch {}
    }
  } catch {}
  return $false
}
`;

const HOST_SCRIPT = `
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'SilentlyContinue'
${PS_HELPERS}
Load-Caches
try { $sp = New-Object -ComObject SAPI.SpVoice } catch { Write-Host 'ready'; exit }
[void](Select-Russian $sp)
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  try {
    $job = $line | ConvertFrom-Json
    if ($job.cmd -eq 'quit') { break }
    $vn = Decode64 $job.voice
    if (-not (Select-Voice $sp $vn)) { [void](Select-Russian $sp) }
    $sp.Rate = [int]$job.rate
    $sp.Volume = [int]$job.volume
    $txt = Decode64 $job.text
    if (-not [String]::IsNullOrWhiteSpace($txt)) { [void]$sp.Speak($txt) }
  } catch {}
  [Console]::Out.WriteLine('done')
  [Console]::Out.Flush()
}
try { $sp = $null } catch {}
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

  _ensureHost() {
    if (this.host || process.platform !== "win32") return this.host;
    let child;
    try {
      child = spawn("powershell.exe", [...PS_BASE, HOST_SCRIPT], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      console.error("[tts] PowerShell:", e.message);
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
    const host = this._ensureHost();
    if (!host || !this.ready) return;
    const item = this.queue.shift();
    this.currentId = item.id;
    const job = {
      id: item.id,
      rate: Math.max(-10, Math.min(10, Math.round((Number(item.rate ?? 1) - 1) * 10))),
      volume: Math.max(0, Math.min(100, Math.round(Number(item.volume ?? 0.9) * 100))),
      voice: Buffer.from(String(item.voice || ""), "utf8").toString("base64"),
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

  skip() {
    if (!this.host) return;
    const child = this.host;
    this.host = null;
    this.ready = false;
    try {
      child.kill();
    } catch {}
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
    } catch {}
    this.host = null;
  }

  async voices() {
    if (process.platform !== "win32") return [];
    const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference='SilentlyContinue'
$list=@()
try {
  Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Speech\\Voices\\Tokens' -ErrorAction SilentlyContinue | ForEach-Object {
    $n=$_.GetValue(''); if (-not $n) { $n=$_.PSChildName }
    $lang=''; try { $lang=$_.GetValue('Language') } catch {}
    if (-not $lang) { try { $lang=$_.OpenSubKey('Attributes').GetValue('Language') } catch {} }
    if ($n) { $list+="$n$([char]1)$lang$([char]1)sapi" }
  }
} catch {}
try {
  Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices\\Tokens' -ErrorAction SilentlyContinue | ForEach-Object {
    $n=$_.GetValue(''); if (-not $n) { $n=$_.PSChildName }
    $lang=''; try { $lang=$_.GetValue('Language') } catch {}
    if (-not $lang) { try { $lang=$_.OpenSubKey('Attributes').GetValue('Language') } catch {} }
    if (-not $lang) { try { $lang=$_.GetValue('Culture') } catch {} }
    if ($n) { $list+="$n$([char]1)$lang$([char]1)onecore" }
  }
} catch {}
try {
  Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\SPEECH\\Voices\\Tokens' -ErrorAction SilentlyContinue | ForEach-Object {
    $n=$_.GetValue(''); if (-not $n) { $n=$_.PSChildName }
    if ($n) { $list+="$n$([char]1)$([char]1)sapi32" }
  }
} catch {}
$list | Sort-Object -Unique | ForEach-Object { $_ }
`;
    const fresh = await new Promise((resolve) => {
      const child = spawn("powershell.exe", [...PS_BASE, script], { windowsHide: true });
      let out = "";
      let resolved = false;
      const done = (v) => {
        if (resolved) return;
        resolved = true;
        resolve(v);
      };
      child.stdout.on("data", (d) => (out += d.toString("utf8")));
      child.once("exit", () => done(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
      child.once("error", () => done([]));
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
        done([]);
      }, 15000);
    });
    if (fresh && fresh.length) {
      this._voices = fresh;
      return fresh;
    }
    return this._voices || fresh;
  }

  async synthesizeWavBase64({ text, rate = 1, volume = 0.9, voice }) {
    if (process.platform !== "win32" || !String(text || "").trim()) return null;
    const file = path.join(os.tmpdir(), `yawa-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const sapiRate = Math.max(-10, Math.min(10, Math.round((Number(rate) - 1) * 10)));
    const sapiVolume = Math.max(0, Math.min(100, Math.round(Number(volume) * 100)));
    const b64Text = Buffer.from(String(text), "utf8").toString("base64");
    const b64Voice = Buffer.from(String(voice || ""), "utf8").toString("base64");
    const safeFile = file.replace(/'/g, "''");
    const script = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
${PS_HELPERS}
Load-Caches
try { $sp=New-Object -ComObject SAPI.SpVoice } catch { exit 1 }
$vn=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Voice}'))
if (-not (Select-Voice $sp $vn)) { [void](Select-Russian $sp) }
$sp.Rate=${sapiRate}; $sp.Volume=${sapiVolume}
try {
  $fs=New-Object -ComObject SAPI.SpFileStream
  $fs.Open('${safeFile}',3,$false)
  $sp.AudioOutputStream=$fs
  $t=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Text}'))
  if (-not [String]::IsNullOrWhiteSpace($t)) { [void]$sp.Speak($t) }
  $fs.Close()
} catch {}
`;
    return new Promise((resolve) => {
      const child = spawn("powershell.exe", [...PS_BASE, script], { windowsHide: true });
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
        try {
          child.kill();
        } catch {}
        finish();
      }, 15000);
    });
  }
}

module.exports = { TtsEngine };
