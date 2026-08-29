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

// Репозиторий с релизами воркера
const REPO = "yawaside/Yawachat.test";
// Прямая ссылка на актуальный пакет — обновляется при релизе новой сборки
const KNOWN_URL =
  `https://github.com/${REPO}/releases/download/silero-worker-v1.0.20260829/silero-worker-ru-1.0.20260829.zip`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=50`;

/** HTTP GET через Electron net (обходит TLS-инспекцию антивируса). */
function electronGet(url) {
  // net доступен только после app.whenReady()
  try {
    const { net } = require("electron");
    return new Promise((resolve, reject) => {
      const req = net.request({ url, redirect: "follow" });
      req.setHeader("User-Agent", "YawaChatHub");
      req.setHeader("Accept", "application/vnd.github+json");
      let data = "";
      req.on("response", (res) => {
        if (res.statusCode < 200 || res.statusCode >= 400) {
          res.on("data", () => {});
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.on("data", (chunk) => (data += chunk.toString("utf8")));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  } catch {
    // fallback на Node https (если net ещё не готов)
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https:") ? https : http;
      const req = mod.get(url, { headers: { "user-agent": "YawaChatHub", accept: "application/vnd.github+json" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(electronGet(res.headers.location));
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        let d = ""; res.setEncoding("utf8"); res.on("data", (c) => (d += c)); res.on("end", () => resolve(d));
      });
      req.on("error", reject);
      req.setTimeout(15000, () => req.destroy(new Error("Таймаут")));
    });
  }
}

/** Ищет самый свежий релиз с ассетом silero-worker-ru-*.zip. */
async function resolveWorkerUrl() {
  try {
    const raw = await electronGet(RELEASES_API);
    const releases = JSON.parse(raw);
    for (const rel of releases) {
      if (!rel?.tag_name || !String(rel.tag_name).startsWith("silero-worker-")) continue;
      for (const asset of rel.assets || []) {
        if (asset?.name && /^silero-worker-ru-.*\.zip$/i.test(asset.name)) {
          return { url: asset.browser_download_url, tag: rel.tag_name };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

class SileroTts {
  constructor(baseDir) {
    this.dir = path.join(baseDir, "silero-worker");
    this.zipPath = path.join(os.tmpdir(), "yawa-silero-worker.zip");
    this.url = FALLBACK_URL;
    this.tag = FALLBACK_TAG;
    this.worker = null;
    this.ready = false;
    this.speakers = [];
    this.installing = false;
    this.progress = null; // {loaded,total,phase}
    this.lastError = null;
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
      tag: this.tag,
      lastError: this.lastError,
    };
  }

  /* ---------- скачивание через Electron net (обходит TLS-инспекцию) ---------- */

  download(url) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this.zipPath);
      let loaded = 0;
      this.progress = { phase: "download", loaded: 0, total: 0 };

      const cleanup = () => {
        try { file.close(); } catch { /* noop */ }
        this.progress = null;
        try { fs.rmSync(this.zipPath, { force: true }); } catch { /* noop */ }
      };

      file.on("finish", () => file.close(() => {
        this.progress = null;
        resolve();
      }));
      file.on("error", (e) => {
        this.progress = null;
        reject(e);
      });

      // Предпочтительно Electron net (обходит антивирус/прокси)
      let useElectronNet = false;
      try {
        const { net } = require("electron");
        if (net && net.request) useElectronNet = true;
      } catch { /* noop */ }

      if (useElectronNet) {
        const { net } = require("electron");
        const req = net.request({ url, redirect: "follow" });
        req.setHeader("User-Agent", "YawaChatHub-silero-worker");
        req.on("response", (res) => {
          if (res.statusCode < 200 || res.statusCode >= 400) {
            cleanup();
            return reject(new Error(
              res.statusCode === 404
                ? "Пакет голосов не найден по ссылке (404)"
                : `HTTP ${res.statusCode}`
            ));
          }
          const total = Number(res.headers["content-length"]) || 0;
          res.on("data", (chunk) => {
            loaded += chunk.length;
            this.progress = { phase: "download", loaded, total };
            try { file.write(chunk); } catch { /* noop */ }
          });
          res.on("end", () => {
            try { file.end(); } catch { /* noop */ }
          });
          res.on("error", (e) => {
            cleanup();
            reject(new Error("Ошибка при скачивании: " + (e.message || String(e))));
          });
        });
        req.on("error", (e) => {
          cleanup();
          reject(new Error("Не удалось скачать: " + (e.message || String(e))));
        });
        req.end();
      } else {
        // Fallback на Node https
        const doReq = (u, depth = 0) => {
          if (depth > 8) { cleanup(); return reject(new Error("Слишком много редиректов")); }
          const mod = u.startsWith("https:") ? https : http;
          const req = mod.get(u, { headers: { "user-agent": "YawaChatHub" } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume();
              return doReq(new URL(res.headers.location, u).toString(), depth + 1);
            }
            if (res.statusCode !== 200) { cleanup(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const total = Number(res.headers["content-length"]) || 0;
            res.on("data", (d) => {
              loaded += d.length;
              this.progress = { phase: "download", loaded, total };
            });
            res.pipe(file);
          });
          req.on("error", (e) => { cleanup(); reject(new Error(e.message || String(e))); });
          req.setTimeout(60000, () => req.destroy(new Error("Таймаут")));
        };
        doReq(url);
      }
    });
  }

  extract() {
    return new Promise((resolve, reject) => {
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });
      execFile(
        "powershell.exe",
        [
          "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath '${this.zipPath}' -DestinationPath '${this.dir}' -Force`,
        ],
        { windowsHide: true },
        (err) => (err ? reject(new Error("Не удалось распаковать: " + err.message)) : resolve())
      );
    });
  }

  /** Скачивает (при необходимости) и распаковывает воркер. */
  async install() {
    if (this.installing) return false;
    this.installing = true;
    this.lastError = null;
    try {
      if (!this.isInstalled()) {
        // 1) Пробуем прямую известную ссылку (самый надёжный путь)
        this.url = KNOWN_URL;
        let downloaded = false;
        try {
          await this.download(KNOWN_URL);
          downloaded = true;
        } catch { /* noop */ }

        // 2) Если не удалось — пробуем через API релизов
        if (!downloaded) {
          const resolved = await resolveWorkerUrl();
          if (resolved) {
            this.url = resolved.url;
            this.tag = resolved.tag.replace(/^silero-worker-v?/i, "");
          }
          try {
            await this.download(this.url);
            downloaded = true;
          } catch { /* noop */ }
        }

        if (!downloaded) {
          throw new Error("Не удалось скачать пакет голосов. Проверьте интернет-соединение.");
        }
        this.progress = { phase: "extract", loaded: 0, total: 0 };
        await this.extract();
      }
      return true;
    } catch (e) {
      this.lastError = e && e.message ? e.message : String(e);
      console.error("[silero] установка воркера:", this.lastError);
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
        }, 90000);
      });
    }

    let child;
    try {
      child = spawn(this.pythonExe, [path.join(this.dir, "silero_worker.py")], {
        cwd: this.dir,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONHASHSEED: "0" },
      });
    } catch (e) {
      this.lastError = "Не удалось запустить движок Silero: " + (e.message || String(e));
      return Promise.resolve(false);
    }
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
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) {
          this.ready = true;
          this.lastError = null;
          this.speakers = Array.isArray(msg.speakers) ? msg.speakers : [];
          const resolvers = this.startResolvers;
          this.startResolvers = [];
          for (const r of resolvers) r(true);
        } else if (msg.ready === false && msg.error) {
          this.lastError = String(msg.error);
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
      this.ready = false;
      for (const [id, p] of this.pending) {
        p({ id, ok: false, error: "Движок Silero завершился" });
      }
      this.pending.clear();
      const resolvers = this.startResolvers;
      this.startResolvers = [];
      for (const r of resolvers) r(false);
    });
    child.on("error", (e) => {
      this.lastError = "Ошибка процесса Silero: " + (e.message || String(e));
      console.error("[silero]", this.lastError);
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
    if (!this.isInstalled()) {
      return { ok: false, error: "Голоса Silero не установлены. Нажмите «Скачать» в настройках." };
    }
    const ok = await this.ensureRunning();
    if (!ok) {
      return { ok: false, error: this.lastError || "Движок Silero не готов" };
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
      try { this.worker.kill(); } catch { /* noop */ }
      this.worker = null;
    }
  }
}

module.exports = { SileroTts, FALLBACK_URL };
