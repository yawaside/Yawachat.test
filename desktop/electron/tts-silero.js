// Встроенные голоса Silero (v5_5_ru, только русский) — без сторонних установок.
//
// Пакет воркера (embedded Python + torch CPU + модель) скачивается самим
// приложением в <папка рядом с exe>/silero-worker/ при первом использовании.
// Дальше работает автономно: воркер-процесс с JSON-протоколом по stdin/stdout.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { net } = require("electron");
const { getJson } = require("./net");

// Репозиторий с релизами воркера
const REPO = "yawaside/Yawachat.test";
// Актуальный прямой URL опубликованной сборки воркера
const FALLBACK_TAG = "1.0.20260829";
const FALLBACK_URL =
  `https://github.com/${REPO}/releases/download/silero-worker-v${FALLBACK_TAG}/silero-worker-ru-${FALLBACK_TAG}.zip`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=50`;

/** Ищет самый свежий релиз с ассетом silero-worker-ru-*.zip. */
async function resolveWorkerUrl() {
  try {
    const releases = await getJson(RELEASES_API, { accept: "application/vnd.github+json" });
    if (Array.isArray(releases)) {
      for (const rel of releases) {
        if (!rel?.tag_name || !String(rel.tag_name).startsWith("silero-worker-")) continue;
        for (const asset of rel.assets || []) {
          if (asset?.name && /^silero-worker-ru-.*\.zip$/i.test(asset.name)) {
            return { url: asset.browser_download_url, tag: rel.tag_name };
          }
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

  /* ---------- скачивание через Chromium net с редиректами и прогрессом ---------- */

  download(targetUrl) {
    const downloadUrl = targetUrl || this.url || FALLBACK_URL;
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this.zipPath);
      let loaded = 0;
      let total = 0;
      this.progress = { phase: "download", loaded: 0, total: 0 };

      const cleanup = (err) => {
        file.close();
        this.progress = null;
        try { fs.rmSync(this.zipPath, { force: true }); } catch { /* noop */ }
        if (err) reject(err);
      };

      try {
        const req = net.request({
          method: "GET",
          url: downloadUrl,
          redirect: "follow",
        });
        req.setHeader("User-Agent", "YawaChatHub-silero-worker");
        req.setHeader("Accept", "application/octet-stream, */*");

        req.on("response", (res) => {
          if (res.statusCode !== 200) {
            cleanup(
              new Error(
                res.statusCode === 404
                  ? "Пакет голосов ещё не опубликован в релизах"
                  : `HTTP ${res.statusCode} при скачивании воркера`
              )
            );
            return;
          }
          total = Number(res.headers["content-length"]) || 0;
          res.on("data", (chunk) => {
            loaded += chunk.length;
            this.progress = { phase: "download", loaded, total };
          });
          res.pipe(file);
        });

        file.on("finish", () => {
          file.close(() => {
            this.progress = null;
            resolve();
          });
        });

        req.on("error", (err) => {
          cleanup(new Error("Ошибка сети при скачивании: " + (err.message || String(err))));
        });

        file.on("error", (err) => {
          cleanup(new Error("Ошибка записи файла: " + (err.message || String(err))));
        });

        req.end();
      } catch (e) {
        cleanup(e);
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
        // Сначала пробуем найти актуальный URL через API релизов
        const resolved = await resolveWorkerUrl();
        if (resolved) {
          this.url = resolved.url;
          this.tag = resolved.tag.replace(/^silero-worker-v?/i, "");
        } else {
          this.url = FALLBACK_URL;
          this.tag = FALLBACK_TAG;
        }

        try {
          await this.download(this.url);
        } catch (e) {
          // Если резолвинг вернул нерабочую ссылку, пробуем строгий фолбэк
          if (this.url !== FALLBACK_URL) {
            this.url = FALLBACK_URL;
            this.tag = FALLBACK_TAG;
            await this.download(FALLBACK_URL);
          } else {
            throw e;
          }
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

module.exports = { SileroTts, FALLBACK_URL, FALLBACK_TAG };
