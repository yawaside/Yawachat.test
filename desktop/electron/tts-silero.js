// Встроенные голоса Silero (v5_5_ru, только русский) — без сторонних установок.
//
// Пакет воркера (embedded Python + torch CPU + модель) скачивается самим
// приложением в <папка рядом с exe>/silero-worker/ при первом использовании.
// Дальше работает автономно: воркер-процесс с JSON-протоколом по stdin/stdout.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn, execFile } = require("child_process");

const WORKER_TAG = "1.0.0";
const DEFAULT_WORKER_URL =
  "https://github.com/yawaside/Yawachat.test/releases/download/silero-worker-v" +
  WORKER_TAG + "/silero-worker-ru-" + WORKER_TAG + ".zip";

class SileroTts {
  constructor(baseDir) {
    this.dir = path.join(baseDir, "silero-worker");
    this.zipPath = path.join(os.tmpdir(), `yawa-silero-worker-${WORKER_TAG}.zip`);
    this.url = DEFAULT_WORKER_URL;
    this.worker = null;
    this.ready = false;
    this.speakers = [];
    this.installing = false;
    this.progress = null; // {loaded,total,phase}
    this.pending = new Map();
    this.startResolvers = [];
    this.seq = 0;
  }

  get pythonExe() {
    return path.join(this.dir, "python.exe");
  }

  isInstalled() {
    return (
      fs.existsSync(this.pythonExe) &&
      fs.existsSync(path.join(this.dir, "silero_worker.py")) &&
      fs.existsSync(path.join(this.dir, "v5_5_ru.pt"))
    );
  }

  status() {
    return {
      installed: this.isInstalled(),
      ready: this.ready,
      speakers: this.speakers,
      installing: this.installing,
      progress: this.progress,
      url: this.url,
    };
  }

  /* ---------- скачивание с редиректами и прогрессом ---------- */

  download() {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this.zipPath);
      let loaded = 0;
      let total = 0;
      this.progress = { phase: "download", loaded: 0, total: 0 };

      const reqTo = (url, depth = 0) => {
        if (depth > 5) return reject(new Error("Слишком много редиректов"));
        const mod = url.startsWith("https:") ? https : http;
        mod
          .get(url, { headers: { "user-agent": "YawaChatHub-silero-worker" } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume();
              return reqTo(new URL(res.headers.location, url).toString(), depth + 1);
            }
            if (res.statusCode !== 200) {
              file.close();
              this.progress = null;
              try { fs.rmSync(this.zipPath, { force: true }); } catch { /* noop */ }
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            total = Number(res.headers["content-length"]) || 0;
            res.on("data", (d) => {
              loaded += d.length;
              this.progress = { phase: "download", loaded, total };
            });
            res.pipe(file);
          })
          .on("error", (e) => {
            file.close();
            this.progress = null;
            try { fs.rmSync(this.zipPath, { force: true }); } catch { /* noop */ }
            reject(e);
          });
      };

      file.on("finish", () => {
        file.close(() => {
          this.progress = null;
          resolve();
        });
      });
      file.on("error", (e) => {
        this.progress = null;
        reject(e);
      });

      reqTo(this.url);
    });
  }

  extract() {
    return new Promise((resolve, reject) => {
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });
      execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy", "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath '${this.zipPath}' -DestinationPath '${this.dir}' -Force`,
        ],
        { windowsHide: true },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  /** Скачивает (при необходимости) и распаковывает воркер. */
  async install() {
    if (this.installing) return false;
    this.installing = true;
    try {
      if (!this.isInstalled()) {
        await this.download();
        this.progress = { phase: "extract", loaded: 0, total: 0 };
        await this.extract();
      }
      return true;
    } catch (e) {
      console.error("[silero] установка воркера:", e.message);
      return false;
    } finally {
      this.progress = null;
      this.installing = false;
    }
  }

  /* ---------- воркер-процесс ---------- */

  ensureRunning() {
    if (this.ready) return Promise.resolve(true);
    if (!this.isInstalled()) return Promise.resolve(false);
    if (this.worker && !this.worker.killed) {
      return new Promise((resolve) => {
        this.startResolvers.push(resolve);
        setTimeout(() => {
          const i = this.startResolvers.indexOf(resolve);
          if (i !== -1) this.startResolvers.splice(i, 1);
          resolve(this.ready);
        }, 90000); // загрузка модели с диска может занять до минуты
      });
    }

    const child = spawn(this.pythonExe, [path.join(this.dir, "silero_worker.py")], {
      cwd: this.dir,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONHASHSEED: "0" },
    });
    this.worker = child;
    let buf = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          this.ready = true;
          this.speakers = Array.isArray(msg.speakers) ? msg.speakers : [];
          const resolvers = this.startResolvers;
          this.startResolvers = [];
          for (const r of resolvers) r(true);
        } else if (msg.id) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p(msg);
          }
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      const s = d.toString().trim();
      if (s) console.error("[silero:worker]", s.slice(0, 400));
    });
    child.on("exit", () => {
      this.worker = null;
      const wasReady = this.ready;
      this.ready = false;
      if (wasReady) console.error("[silero] воркер завершился, будет перезапущен");
      for (const [id, p] of this.pending) {
        p({ id, ok: false, error: "Движок Silero завершился — попробую перезапустить" });
      }
      this.pending.clear();
      const resolvers = this.startResolvers;
      this.startResolvers = [];
      for (const r of resolvers) r(false);
    });
    child.on("error", (e) => {
      console.error("[silero] не удалось запустить воркер:", e.message);
    });

    return new Promise((resolve) => {
      this.startResolvers.push(resolve);
      setTimeout(() => {
        const i = this.startResolvers.indexOf(resolve);
        if (i !== -1) this.startResolvers.splice(i, 1);
        resolve(this.ready);
      }, 90000);
    });
  }

  /** Синтез фразы → WAV (base64). */
  async synthesize({ text, speaker, rate = 1, volume = 0.9 }) {
    const ok = await this.ensureRunning();
    if (!ok) {
      return { ok: false, error: "Движок Silero не готов. Нажмите «Скачать голос» в настройках." };
    }
    if (!String(text || "").trim()) return { ok: true, empty: true };

    this.seq += 1;
    const id = `y${Date.now()}-${this.seq}`;
    const res = await new Promise((resolve) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, ok: false, error: "Таймаут синтеза" });
      }, 120000);
      this.pending.set(id, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      try {
        this.worker.stdin.write(JSON.stringify({ id, text, speaker, rate, volume }) + "\n");
      } catch (e) {
        clearTimeout(t);
        resolve({ id, ok: false, error: String(e.message || e) });
      }
    });

    if (!res.ok) return res;
    if (!res.wav) return { ok: true, empty: true };
    try {
      const buf = fs.readFileSync(res.wav);
      try { fs.rmSync(res.wav, { force: true }); } catch { /* noop */ }
      return { ok: true, wavBase64: buf.toString("base64") };
    } catch (e) {
      return { ok: false, error: "Не удалось прочитать аудио: " + e.message };
    }
  }

  dispose() {
    for (const [id, p] of this.pending) {
      p({ id, ok: false, error: "Приложение закрывается" });
    }
    this.pending.clear();
    if (this.worker) {
      try {
        this.worker.kill();
      } catch { /* noop */ }
      this.worker = null;
    }
  }
}

module.exports = { SileroTts, WORKER_TAG, DEFAULT_WORKER_URL };
