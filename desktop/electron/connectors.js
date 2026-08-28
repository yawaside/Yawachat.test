// Коннекторы площадок. Каждый работает независимо: ошибка одной не влияет на остальные.
// Переподключение автоматическое, с ростом интервала.
//
// FIX(2.0.1) — «всегда ошибка» и «YouTube просит API»:
//   Twitch  — свой анонимный IRC поверх WebSocket (без tmi.js: библиотека в упакованном
//             приложении часто не поднималась и канал сразу падал в error).
//   YouTube — БЕЗ Data API и без ключа: читаем страницу /live и внутренний
//             endpoint youtubei/v1/live_chat (см. youtube.js).
//   Kick    — запрос через скрытое окно Chromium (net.js), иначе Cloudflare отдаёт 403.
//   VK      — публичный chat-polling, тоже через браузерный запрос.
//   TikTok  — tiktok-live-connector, если модуль доступен.

const WebSocket = require("ws");
const { getJson, request, setDebug } = require("./net");
const yt = require("./youtube");

// «Сырой» Node-запрос (обходит Chromium-стек Electron net) — нужен,
// чтобы отличить «нет сети вообще» от «проблема только в WebSocket-слое».
function rawNodeHttps(url, timeout = 8000) {
  return new Promise((resolve) => {
    let req;
    try {
      req = require("https").get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Accept": "*/*" } }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode || 0 });
      });
    } catch (e) {
      return resolve({ ok: false, status: 0, error: String(e.message || e) });
    }
    req.on("error", (e) => resolve({ ok: false, status: 0, error: String(e.message || e) }));
    req.setTimeout(timeout, () => {
      try { req.destroy(); } catch { /* noop */ }
      resolve({ ok: false, status: 0, error: "timeout" });
    });
  });
}

const NAME_COLORS = ["#ff6b81", "#ffa94d", "#ffd43b", "#69db7c", "#3bc9db", "#4dabf7", "#9775fa", "#f783ac"];
const TWITCH_WS = "wss://irc-ws.chat.twitch.tv:443";
const KICK_PUSHER = [
  "32cbd69e4b950bf97679",
  "eb1d5f283081a78b932c",
];
const WS_HEADERS = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Origin: "https://kick.com",
  },
};
function kickPusherUrl(key) {
  return `wss://ws-us2.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;
}

/* ---------------- разбор IRC ---------------- */

function parseTags(raw) {
  const tags = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    tags[part.slice(0, i)] = part
      .slice(i + 1)
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\\\/g, "\\");
  }
  return tags;
}

function parseIrc(line) {
  let rest = line;
  let tags = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const sp = rest.indexOf(" ");
  const command = sp === -1 ? rest : rest.slice(0, sp);
  const params = sp === -1 ? "" : rest.slice(sp + 1);
  return { tags, prefix, command, params };
}

function twitchBadges(tags) {
  const b = [];
  const badges = String(tags.badges || "");
  if (tags.mod === "1" || badges.includes("moderator/") || badges.includes("broadcaster/")) b.push("MOD");
  if (badges.includes("vip/")) b.push("VIP");
  if (tags.subscriber === "1" || badges.includes("subscriber/")) b.push("SUB");
  return b;
}

class ConnectorManager {
  constructor({ settings, onChat, onStatus }) {
    this.settings = settings;
    this.onChat = onChat;
    this.onStatus = onStatus;
    this.channels = new Map();
    setDebug(() => {});
  }

  _wsCheck(url, { hello, okWhen, headers } = {}) {
    return new Promise((resolve) => {
      let ws;
      const done = (msg) => {
        try { if (ws) ws.terminate(); } catch { /* noop */ }
        resolve(msg);
      };
      const t = setTimeout(() => done("таймаут 8с"), 8000);
      try {
        ws = new WebSocket(url, headers ? { headers } : undefined);
      } catch (e) {
        clearTimeout(t);
        return resolve(String(e.message || e));
      }
      ws.on("open", () => {
        if (hello) {
          try { hello(ws); } catch { /* noop */ }
        } else {
          clearTimeout(t);
          done("OK (сокет открыт)");
        }
      });
      ws.on("message", (raw) => {
        const s = raw.toString();
        if (!okWhen || okWhen(s)) {
          clearTimeout(t);
          done("OK");
        }
      });
      ws.on("error", (e) => {
        clearTimeout(t);
        done(`ошибка: ${e.message || e}`);
      });
    });
  }

  /** Диагностика доступности площадок — вызывается кнопкой «Проверить сеть». */
  async diagnose() {
    this.emitSys("twitch", "Проверка сети (Electron-сеть vs Node-сеть)…");

    // Baseline: Electron net (Chromium)
    const ytNet = await request("https://www.youtube.com/", { timeout: 8000 });
    this.emitSys("youtube", `YouTube (Electron net): ${ytNet.ok ? "OK" : "нет"} (код ${ytNet.status || 0})`);

    // Сравнение: сырой Node https. Если Electron работает, а Node нет —
    // проблема в сетевом стеке Node (обычно системный прокси).
    const kickNode = await rawNodeHttps("https://kick.com/api/v2/channels/xqc");
    this.emitSys("kick", `Kick API (Node https): ${kickNode.ok ? "OK" : "нет"} (код ${kickNode.status || 0}${kickNode.error ? ", " + kickNode.error : ""})`);

    // WebSocket (ws) — тот путь, которым ходят Twitch/Kick/TikTok/VK
    const twitch = await this._wsCheck(TWITCH_WS, {
      hello: (ws) => {
        ws.send("PASS SCHMOOPIIFS");
        ws.send("NICK justinfan12345");
      },
      okWhen: (s) => / 001 |Welcome/i.test(s),
    });
    this.emitSys("twitch", `Twitch IRC: ${twitch}`);

    const kickHttp = await request("https://kick.com/api/v2/channels/xqc", { timeout: 8000 });
    this.emitSys("kick", `Kick API: ${kickHttp.ok ? "OK" : "нет"} (код ${kickHttp.status})`);

    const kickWs = await this._wsCheck(kickPusherUrl(KICK_PUSHER[0]), {
      headers: WS_HEADERS.headers,
    });
    this.emitSys("kick", `Kick чат (Pusher WS): ${kickWs}`);

    const vk = await request("https://live.vkvideo.ru/", { timeout: 8000 });
    this.emitSys("vk", `VK Video: ${vk.ok ? "OK" : "нет"} (код ${vk.status || 0}${vk.error ? ", " + vk.error : ""})`);

    const tt = await request("https://www.tiktok.com/robots.txt", { timeout: 8000 });
    this.emitSys("tiktok", `TikTok: ${tt.ok ? "OK" : "нет"} (код ${tt.status || 0}${tt.error ? ", " + tt.error : ""})`);

    this.emitSys("twitch", "Готово. Канал должен быть В ЭФИРЕ — иначе статус «офлайн», это не ошибка сети.");
  }

  key(c) {
    return `${c.platform}:${c.channelId}`;
  }

  list() {
    return [...this.channels.values()].map((e) => ({
      id: this.key(e.channel),
      platform: e.channel.platform,
      channelId: e.channel.channelId,
      status: e.status,
    }));
  }

  emitStatus() {
    this.onStatus(this.list());
  }

  setStatus(entry, status) {
    if (entry.status === status) return;
    entry.status = status;
    this.emitStatus();
  }

  emitChat(platform, { author, text, color, badges, emotes }) {
    if (!text) return;
    this.onChat({
      id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: author || "зритель",
      text: String(text),
      color: color || NAME_COLORS[Math.floor(Math.random() * NAME_COLORS.length)],
      badges: badges || [],
      emotes: Array.isArray(emotes) ? emotes : undefined,
      ts: Date.now(),
      sys: false,
    });
  }

  emitSys(platform, text) {
    this.onChat({
      id: `s${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: "YawaChatHub",
      text,
      color: "#8b91a8",
      badges: [],
      ts: Date.now(),
      sys: true,
    });
  }

  startAll() {
    for (const c of this.settings.channels || []) this.add(c.platform, c.channelId, { silent: true });
    this.emitStatus();
  }

  add(platform, channelId, { silent } = {}) {
    const raw = String(channelId || "").trim();
    if (!raw) return;
    if (/^https?:\/\//i.test(raw) || raw.includes("/") || raw.includes("?") || raw.includes("&")) {
      this.emitSys(platform, "Введите только username канала, без ссылок");
      return;
    }
    const uname = raw.replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.-]{2,40}$/.test(uname)) {
      this.emitSys(platform, "Некорректный username канала");
      return;
    }
    const normalized = platform === "tiktok" ? `@${uname}` : uname;
    const channel = { platform, channelId: normalized };
    const k = this.key(channel);
    if (this.channels.has(k)) return;

    const entry = { channel, status: "connecting", attempts: 0, alive: true };
    this.channels.set(k, entry);
    this.emitStatus();
    this._connect(entry);

    if (!silent) {
      this.settings.channels = (this.settings.channels || []).filter(
        (c) => !(c.platform === platform && c.channelId === normalized)
      );
      this.settings.channels.push({ platform, channelId: normalized });
      this._persist();
    }
  }

  remove(platform, channelId) {
    const k = `${platform}:${channelId}`;
    const entry = this.channels.get(k);
    if (!entry) return;
    entry.alive = false;
    this._teardown(entry);
    this.channels.delete(k);
    this.settings.channels = (this.settings.channels || []).filter(
      (c) => !(c.platform === platform && c.channelId === channelId)
    );
    this._persist();
    this.emitStatus();
  }

  stopAll() {
    for (const entry of this.channels.values()) {
      entry.alive = false;
      this._teardown(entry);
    }
    this.channels.clear();
  }

  _persist() {
    try {
      require("./settings").saveSettings(this.settings);
    } catch {
      /* noop */
    }
  }

  _teardown(entry) {
    entry.closing = true;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    if (entry.ping) { clearInterval(entry.ping); entry.ping = null; }
    if (entry.client && entry.client.disconnect) {
      try { entry.client.disconnect(); } catch { /* noop */ }
    }
    if (entry.ws) {
      try { entry.ws.removeAllListeners(); entry.ws.close(); } catch { /* noop */ }
      entry.ws = null;
    }
    if (entry.vkClient) {
      try { entry.vkClient.disconnect(); entry.vkClient.removeAllListeners?.(); } catch { /* noop */ }
      entry.vkClient = null;
    }
  }

  /** плановый повтор: статус «подключение», без спама в ленту */
  _retry(entry, delayMs, { note } = {}) {
    if (!entry.alive) return;
    this._teardown(entry);
    entry.attempts += 1;
    const wait = Math.min(delayMs * Math.min(entry.attempts, 6), 120000);
    if (note && entry.attempts <= 2) this.emitSys(entry.channel.platform, note);
    this.setStatus(entry, entry.attempts > 2 ? "error" : "connecting");
    entry.timer = setTimeout(() => {
      if (!entry.alive) return;
      this.setStatus(entry, "connecting");
      this._connect(entry);
    }, wait);
  }

  /** канал в эфире, но чат сейчас недоступен (стрим не идёт) */
  _offline(entry, seconds, note) {
    if (!entry.alive) return;
    this._teardown(entry);
    this.setStatus(entry, "offline");
    if (note && !entry.notifiedOffline) {
      entry.notifiedOffline = true;
      this.emitSys(entry.channel.platform, note);
    }
    entry.timer = setTimeout(() => {
      if (!entry.alive) return;
      this.setStatus(entry, "connecting");
      this._connect(entry);
    }, seconds * 1000);
  }

  _online(entry, note) {
    entry.attempts = 0;
    entry.notifiedOffline = false;
    if (entry.status !== "online") {
      this.setStatus(entry, "online");
      if (note) this.emitSys(entry.channel.platform, note);
    }
  }

  _connect(entry) {
    if (!entry.alive) return;
    entry.closing = false;
    const p = entry.channel.platform;
    if (p === "twitch") this._twitch(entry);
    else if (p === "youtube") this._youtube(entry);
    else if (p === "kick") this._kick(entry);
    else if (p === "tiktok") this._tiktok(entry);
    else if (p === "vk") this._vk(entry);
    else this.setStatus(entry, "offline");
  }

  /** Страховочный таймер: если за ms мс не наступил online — пробуем заново. */
  _armTimeout(entry, ms, note) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (!entry.alive || entry.status === "online") return;
      this._retry(entry, 8000, { note });
    }, ms);
  }

  /* ---------------- Twitch: анонимный IRC ---------------- */
  _twitch(entry) {
    const name = entry.channel.channelId.replace(/^#/, "").toLowerCase();
    let ws;
    try {
      ws = new WebSocket(TWITCH_WS);
    } catch {
      this._retry(entry, 8000, { note: `Twitch: не удалось открыть соединение (${name})` });
      return;
    }
    entry.ws = ws;
    this._armTimeout(entry, 15000, `Twitch: нет ответа от IRC (${name})`);

    ws.on("open", () => {
      const nick = `justinfan${10000 + Math.floor(Math.random() * 80000)}`;
      try {
        ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        ws.send("PASS SCHMOOPIIFS");
        ws.send(`NICK ${nick}`);
        ws.send(`USER ${nick} 8 * :${nick}`);
        ws.send(`JOIN #${name}`);
      } catch { /* noop */ }
      entry.ping = setInterval(() => {
        try { ws.send("PING :tmi.twitch.tv"); } catch { /* noop */ }
      }, 60000);
    });

    ws.on("message", (raw) => {
      for (const line of raw.toString().split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          try { ws.send("PONG :tmi.twitch.tv"); } catch { /* noop */ }
          continue;
        }
        const msg = parseIrc(line);
        if (msg.command === "001" || msg.command === "JOIN" || msg.command === "366") {
          this._online(entry, `Канал подключён: Twitch / ${name}`);
          continue;
        }
        if (msg.command === "NOTICE" && /msg_channel_suspended|No such channel/i.test(msg.params)) {
          this._offline(entry, 120, `Twitch: канал ${name} недоступен`);
          continue;
        }
        if (msg.command !== "PRIVMSG") continue;

        const sp = msg.params.indexOf(" :");
        if (sp === -1) continue;
        const text = msg.params.slice(sp + 2);
        const login = (msg.prefix.split("!")[0] || "").replace(/^#/, "");
        // Twitch IRC: emotes=25:0-4,12-16/1902:6-10
        const emotes = [];
        const raw = String(msg.tags.emotes || "");
        if (raw) {
          for (const group of raw.split("/")) {
            if (!group) continue;
            const [id, ranges] = group.split(":");
            if (!id || !ranges) continue;
            for (const r of ranges.split(",")) {
              const [a, b] = r.split("-").map((n) => Number(n));
              if (Number.isFinite(a) && Number.isFinite(b)) emotes.push({ id, start: a, end: b });
            }
          }
        }
        this.emitChat("twitch", {
          author: msg.tags["display-name"] || login,
          color: msg.tags.color || "",
          badges: twitchBadges(msg.tags),
          text,
          emotes,
        });
      }
    });

    ws.on("close", () => {
      if (!entry.alive || entry.closing) return;
      this._retry(entry, 8000, { note: `Twitch: соединение с ${name} потеряно` });
    });
    ws.on("error", () => {
      try { ws.close(); } catch { /* noop */ }
    });
  }

  /* ---------------- YouTube Live: без API-ключа ---------------- */
  async _youtube(entry) {
    const username = entry.channel.channelId.replace(/^@/, "");
    try {
      const videoId = await yt.findLiveVideoId(username);
      if (!entry.alive) return;
      if (!videoId) {
        this._offline(entry, 60, `YouTube: ${username} сейчас не в эфире`);
        return;
      }

      const session = await yt.openChat(videoId);
      if (!entry.alive) return;
      if (!session) {
        this._offline(entry, 45, `YouTube: чат трансляции ${username} закрыт`);
        return;
      }

      this._online(entry, `Канал подключён: YouTube Live / ${username}`);
      let cont = session.continuation;
      let misses = 0;

      const loop = async () => {
        if (!entry.alive) return;
        const res = await yt.poll({ ...session, continuation: cont });
        if (!entry.alive) return;
        if (!res) {
          misses += 1;
          if (misses >= 3) {
            this._retry(entry, 15000, { note: `YouTube: чат ${username} прервался` });
            return;
          }
          entry.timer = setTimeout(loop, 5000);
          return;
        }
        misses = 0;
        cont = res.continuation;
        for (const m of res.messages) {
          this.emitChat("youtube", { author: m.author, text: m.text, badges: m.badges });
        }
        entry.timer = setTimeout(loop, Math.max(res.timeoutMs || 4000, 2500));
      };
      loop();
    } catch {
      this._retry(entry, 15000, { note: `YouTube: ошибка чтения чата ${username}` });
    }
  }

  /* ---------------- Kick ---------------- */
  async _kick(entry) {
    const slug = entry.channel.channelId.trim().toLowerCase();
    try {
      let info = await getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
        referer: `https://kick.com/${slug}`,
        origin: "https://kick.com",
        accept: "application/json",
      });
      if (!info) {
        info = await getJson(`https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`, {
          referer: `https://kick.com/${slug}`,
        });
      }
      if (!entry.alive) return;

      const chatroomId = info?.chatroom?.id;
      if (!chatroomId) {
        this._offline(entry, 60, `Kick: канал ${slug} не найден или чат закрыт`);
        return;
      }

      this._online(entry, `Канал подключён: Kick / ${slug}`);
      this._kickPoll(entry, slug, chatroomId);
      this._kickPusher(entry, slug, chatroomId);
    } catch {
      this._retry(entry, 15000, { note: `Kick: ошибка подключения к ${slug}` });
    }
  }

  _kickHandleMessage(entry, slug, d) {
    if (!d) return;
    const text = d.content || d.message || "";
    if (!text) return;
    this._online(entry, `Канал подключён: Kick / ${slug}`);
    this.emitChat("kick", {
      author: d.sender?.username || d.sender?.slug || d.username,
      color: d.sender?.identity?.color,
      text,
    });
  }

  async _kickPoll(entry, slug, chatroomId) {
    const seen = new Set();
    // Документированный публичный эндпоинт сообщений: /channels/{chatroom_id}/messages
    const urls = [
      `https://kick.com/api/v2/channels/${chatroomId}/messages`,
      `https://kick.com/api/v2/chatrooms/${chatroomId}/messages`,
    ];
    let reported = false;
    const tick = async (initial) => {
      if (!entry.alive) return;
      let data = null;
      let lastStatus = 0;
      for (const url of urls) {
        // eslint-disable-next-line no-await-in-loop
        const r = await request(url, {
          timeout: 10000,
          headers: { referer: `https://kick.com/${slug}`, accept: "application/json" },
        });
        lastStatus = r.status;
        if (r.ok) {
          try { data = JSON.parse(r.body); } catch { data = null; }
        }
        if (data) break;
      }
      if (!entry.alive) return;

      if (!reported) {
        reported = true;
        const count =
          (data?.data?.messages && data.data.messages.length) ||
          (Array.isArray(data?.data) ? data.data.length : 0) ||
          (data?.messages && data.messages.length) || 0;
        this.emitSys("kick", `Kick: опрос сообщений — код ${lastStatus}, сообщений в ответе: ${count}`);
      }

      const list = data?.data?.messages || data?.data || data?.messages || [];
      const arr = Array.isArray(list) ? list : [];
      if (arr.length && entry.status !== "online") {
        this._online(entry, `Канал подключён: Kick / ${slug}`);
      }
      for (const msg of arr) {
        const id = String(msg.id ?? `${msg.created_at}-${msg.sender?.username}`);
        if (seen.has(id)) continue;
        seen.add(id);
        if (initial) continue;
        this._kickHandleMessage(entry, slug, msg);
      }
      if (seen.size > 400) {
        const keep = [...seen].slice(-200);
        seen.clear();
        for (const k of keep) seen.add(k);
      }
      entry.timer = setTimeout(() => tick(false), 2500);
    };
    tick(true);
  }

  _kickPusher(entry, slug, chatroomId) {
    const tryKey = (idx) => {
      if (!entry.alive || idx >= KICK_PUSHER.length) return;
      let ws;
      try {
        ws = new WebSocket(kickPusherUrl(KICK_PUSHER[idx]), WS_HEADERS);
      } catch {
        tryKey(idx + 1);
        return;
      }
      entry.ws = ws;
      ws.on("open", () => {
        try {
          ws.send(JSON.stringify({
            event: "pusher:subscribe",
            data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
          }));
          ws.send(JSON.stringify({
            event: "pusher:subscribe",
            data: { auth: "", channel: `chatrooms.${chatroomId}` },
          }));
        } catch { /* noop */ }
        entry.ping = setInterval(() => {
          try { ws.send(JSON.stringify({ event: "pusher:ping", data: {} })); } catch { /* noop */ }
        }, 60000);
      });
      ws.on("message", (raw) => {
        try {
          const ev = JSON.parse(raw.toString());
          if (String(ev.event || "").includes("subscription_succeeded")) {
            this._online(entry, `Канал подключён: Kick / ${slug}`);
            return;
          }
          if (String(ev.event || "").includes("ChatMessageEvent")) {
            const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
            this._kickHandleMessage(entry, slug, d);
          }
        } catch { /* noop */ }
      });
      ws.on("close", () => {
        if (!entry.alive || entry.closing) return;
        if (idx + 1 < KICK_PUSHER.length) tryKey(idx + 1);
      });
      ws.on("error", () => {
        try { ws.close(); } catch { /* noop */ }
      });
    };
    tryKey(0);
  }

  /* ---------------- TikTok Live ---------------- */
  async _tiktok(entry) {
    const username = entry.channel.channelId.replace(/^@/, "");

    const room = await getJson(
      `https://www.tiktok.com/api-live/user/room?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(username)}`,
      { referer: `https://www.tiktok.com/@${username}`, accept: "application/json" }
    );
    const status = room?.data?.liveRoom?.status ?? room?.data?.user?.status;
    const live = status === 2 || status === "2" || room?.data?.liveRoom?.streamId;
    if (room && !live) {
      this._offline(entry, 60, `TikTok: @${username} сейчас не в эфире`);
      return;
    }

    let Conn = null;
    try {
      const mod = require("tiktok-live-connector");
      Conn = mod.WebcastPushConnection || mod.TikTokLiveConnection || null;
    } catch {
      Conn = null;
    }
    if (!Conn) {
      this._offline(entry, 120, "TikTok: модуль чата недоступен в этой сборке");
      return;
    }

    let client;
    try {
      client = new Conn(username, { processInitialData: false, enableExtendedGiftInfo: false });
    } catch {
      this._offline(entry, 60, `TikTok: не удалось создать подключение к @${username}`);
      return;
    }

    entry.client = {
      disconnect: () => {
        try { client.disconnect(); } catch { /* noop */ }
      },
    };

    client
      .connect()
      .then(() => this._online(entry, `Канал подключён: TikTok Live / @${username}`))
      .catch(() => this._offline(entry, 60, `TikTok: @${username} сейчас не в эфире`));

    client.on("chat", (d) => {
      this.emitChat("tiktok", { author: d?.nickname || d?.uniqueId, text: d?.comment });
    });
    client.on("streamEnd", () => this._offline(entry, 60, `TikTok: трансляция @${username} завершена`));
    client.on("disconnected", () => {
      if (!entry.alive || entry.closing) return;
      this._retry(entry, 20000);
    });
  }

  /* ---------------- VK Play Live ----------------
   * Официальный протокол VK Live — WebSocket Centrifugo на
   * wss://pubsub.live.vkvideo.ru (нужен connect-токен и publicWebSocketChannel).
   * Реализуем через библиотеку vklive-message-client в readonly-режиме
   * (получение сообщений без авторизации). */
  async _vk(entry) {
    const channelId = entry.channel.channelId.trim().replace(/^@/, "");
    let VKPLMessageClient = null;
    try {
      const mod = await import("vklive-message-client");
      VKPLMessageClient = mod.default || mod.VKPLMessageClient;
    } catch (e) {
      this._offline(entry, 120, `VK Play: библиотека чата не загрузилась (${String(e.message || e).slice(0, 40)})`);
      return;
    }
    if (!VKPLMessageClient) {
      this._offline(entry, 120, "VK Play: библиотека чата недоступна в этой сборке");
      return;
    }

    let client;
    try {
      client = new VKPLMessageClient({ auth: "readonly", channels: [channelId], debugLog: false, log: false });
    } catch (e) {
      this._offline(entry, 60, `VK Play: не удалось создать подключение (${String(e.message || e).slice(0, 50)})`);
      return;
    }
    entry.vkClient = client;

    client.on("message", (ctx) => {
      if (!entry.alive) return;
      const text = ctx?.message?.text;
      if (!text) return;
      this._online(entry);
      this.emitChat("vk", {
        author: ctx?.user?.nick || ctx?.user?.displayName || "vk_viewer",
        text,
      });
    });
    client.on("stream-status", (ctx) => {
      if (!entry.alive) return;
      if (ctx?.type === "stream_end") this._offline(entry, 60, `VK Play: трансляция ${channelId} завершена`);
    });
    client.on("channel-info", (ctx) => {
      if (!entry.alive) return;
      if (ctx?.isOnline) this._online(entry, `Канал подключён: VK Play Live / ${channelId}`);
    });

    try {
      await client.connect();
      this._online(entry, `Канал подключён: VK Play Live / ${channelId}`);
    } catch (e) {
      if (!entry.alive) return;
      this._retry(entry, 20000, { note: `VK Play: ${channelId} — ${String(e.message || e).slice(0, 60)}` });
    }
  }
}

module.exports = { ConnectorManager };
