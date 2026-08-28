// Коннекторы площадок — надёжная версия.
// Twitch: анонимный IRC по WebSocket (без tmi.js).
// Kick:   API + Pusher WS, запросы через https с браузерным UA.
// YouTube: страница /live + внутренний endpoint youtubei (без API-ключа).
// VK:     chat-polling через https.
// TikTok: tiktok-live-connector (если доступен).
//
// FIX(2.0.2): создан был net.js на скрытом BrowserWindow — молча ломался,
// все каналы падали в «ошибка». Теперь простой https.

const WebSocket = require("ws");
const https = require("https");
const { getText, getJson, UA } = require("./net");
const yt = require("./youtube");

const NAME_COLORS = ["#ff6b81", "#ffa94d", "#ffd43b", "#69db7c", "#3bc9db", "#4dabf7", "#9775fa", "#f783ac"];
const TWITCH_WS = "wss://irc-ws.chat.twitch.tv:443";
const KICK_WS =
  "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=8.4.0-rc2&flash=false";

function log(platform, ...args) {
  console.log(`[conn:${platform}]`, ...args);
}

/* ===================== IRC разбор ===================== */

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
    if (sp !== -1) {
      tags = parseTags(rest.slice(1, sp));
      rest = rest.slice(sp + 1);
    }
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = sp === -1 ? rest.slice(1) : rest.slice(1, sp);
    rest = sp === -1 ? "" : rest.slice(sp + 1);
  }
  const sp = rest.indexOf(" ");
  const command = sp === -1 ? rest.trim() : rest.slice(0, sp);
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

/* ===================== ConnectorManager ===================== */

class ConnectorManager {
  constructor({ settings, onChat, onStatus }) {
    this.settings = settings;
    this.onChat = onChat;
    this.onStatus = onStatus;
    this.channels = new Map();
  }

  key(c) { return `${c.platform}:${c.channelId}`; }

  list() {
    return [...this.channels.values()].map((e) => ({
      id: this.key(e.channel),
      platform: e.channel.platform,
      channelId: e.channel.channelId,
      status: e.status,
    }));
  }

  emitStatus() { this.onStatus(this.list()); }

  setStatus(entry, status) {
    if (entry.status === status) return;
    entry.status = status;
    this.emitStatus();
  }

  emitChat(platform, { author, text, color, badges }) {
    if (!text || !text.trim()) return;
    this.onChat({
      id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: author || "зритель",
      text: String(text).trim(),
      color: color || NAME_COLORS[Math.floor(Math.random() * NAME_COLORS.length)],
      badges: badges || [],
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
    for (const c of this.settings.channels || []) {
      this.add(c.platform, c.channelId, { silent: true });
    }
    this.emitStatus();
  }

  add(platform, channelId, { silent } = {}) {
    const raw = String(channelId || "").trim();
    if (!raw) return;
    if (/^https?:\/\//i.test(raw) || raw.includes("?") || raw.includes("&")) {
      this.emitSys(platform, "Введите username канала, без ссылок");
      return;
    }
    const uname = raw.replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.-]{2,40}$/.test(uname)) {
      this.emitSys(platform, "Некорректный username. Только a-z, 0-9, _, ., -");
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
    try { require("./settings").saveSettings(this.settings); } catch { /* noop */ }
  }

  _teardown(entry) {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    if (entry.ping) { clearInterval(entry.ping); entry.ping = null; }
    if (entry.client && typeof entry.client.disconnect === "function") {
      try { entry.client.disconnect(); } catch { /* noop */ }
      entry.client = null;
    }
    if (entry.ws) {
      try { entry.ws.removeAllListeners(); entry.ws.close(); } catch { /* noop */ }
      entry.ws = null;
    }
  }

  _retry(entry, delayMs, msg) {
    if (!entry.alive) return;
    this._teardown(entry);
    entry.attempts += 1;
    const wait = Math.min(delayMs * Math.min(entry.attempts, 8), 120000);
    // первые 3 попытки — «подключение», потом «ошибка»
    this.setStatus(entry, entry.attempts <= 3 ? "connecting" : "error");
    if (msg) {
      log(entry.channel.platform, msg, `→ повтор через ${Math.round(wait / 1000)}с (попытка ${entry.attempts})`);
      // в ленту — только первый раз
      if (entry.attempts === 1) this.emitSys(entry.channel.platform, msg);
    }
    entry.timer = setTimeout(() => {
      if (!entry.alive) return;
      this.setStatus(entry, "connecting");
      this._connect(entry);
    }, wait);
  }

  _online(entry, msg) {
    entry.attempts = 0;
    if (entry.status !== "online") {
      this.setStatus(entry, "online");
      if (msg) {
        log(entry.channel.platform, msg);
        this.emitSys(entry.channel.platform, msg);
      }
    }
  }

  _offline(entry, seconds, msg) {
    if (!entry.alive) return;
    this._teardown(entry);
    this.setStatus(entry, "offline");
    if (msg && !entry._offlineNotified) {
      entry._offlineNotified = true;
      this.emitSys(entry.channel.platform, msg);
      log(entry.channel.platform, msg);
    }
    entry.timer = setTimeout(() => {
      if (!entry.alive) return;
      this.setStatus(entry, "connecting");
      this._connect(entry);
    }, seconds * 1000);
  }

  _connect(entry) {
    if (!entry.alive) return;
    const p = entry.channel.platform;
    if (p === "twitch") this._twitch(entry);
    else if (p === "youtube") this._youtube(entry);
    else if (p === "kick") this._kick(entry);
    else if (p === "tiktok") this._tiktok(entry);
    else if (p === "vk") this._vk(entry);
    else this.setStatus(entry, "offline");
  }

  /* ================== Twitch: анонимный IRC ================== */
  _twitch(entry) {
    const name = entry.channel.channelId.replace(/^#/, "").toLowerCase();
    log("twitch", `подключение к #${name}...`);

    const ws = new WebSocket(TWITCH_WS);
    entry.ws = ws;
    let connected = false;
    let joinTimer = null;

    ws.on("open", () => {
      log("twitch", `socket открыт для #${name}, отправляю NICK/JOIN...`);
      const nick = `justinfan${10000 + Math.floor(Math.random() * 90000)}`;
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${name}`);

      // если через 15 сек не пришло JOIN — канал не найден
      joinTimer = setTimeout(() => {
        if (!connected && entry.alive) {
          this._offline(entry, 60, `Twitch: канал #${name} не отвечает — возможно, не существует`);
        }
      }, 15000);
    });

    ws.on("message", (raw) => {
      const text = raw.toString();
      for (const line of text.split("\r\n")) {
        if (!line) continue;

        // pong
        if (line.startsWith("PING")) {
          try { ws.send("PONG :tmi.twitch.tv"); } catch { /* noop */ }
          continue;
        }

        const msg = parseIrc(line);

        // канал присоединился — мы онлайн
        if (msg.command === "JOIN") {
          connected = true;
          if (joinTimer) clearTimeout(joinTimer);
          this._online(entry, `Канал подключён: Twitch / ${name}`);
          entry.ping = setInterval(() => {
            try { ws.send("PING :tmi.twitch.tv"); } catch { /* noop */ }
          }, 60000);
          continue;
        }

        // ошибка
        if (msg.command === "NOTICE") {
          const params = msg.params || "";
          if (/msg_channel_suspended|No such channel|Login authentication failed/i.test(params)) {
            this._offline(entry, 120, `Twitch: канал #${name} недоступен`);
          }
          continue;
        }

        // сообщение
        if (msg.command === "PRIVMSG") {
          const colon = msg.params.indexOf(" :");
          if (colon === -1) continue;
          const chatText = msg.params.slice(colon + 2);
          const login = msg.prefix.split("!")[0];
          this.emitChat("twitch", {
            author: msg.tags["display-name"] || login,
            color: msg.tags.color || "",
            badges: twitchBadges(msg.tags),
            text: chatText,
          });
        }
      }
    });

    ws.on("close", () => {
      log("twitch", `socket закрыт для #${name}`);
      if (joinTimer) clearTimeout(joinTimer);
      if (connected) {
        this._retry(entry, 8000, `Twitch: соединение с #${name} потеряно`);
      } else {
        this._retry(entry, 10000, `Twitch: не удалось подключиться к #${name}`);
      }
    });

    ws.on("error", (e) => {
      log("twitch", `ошибка WS для #${name}:`, e.message);
      // error всегда сопровождается close — переподключение там
    });
  }

  /* ================== YouTube: без API-ключа ================== */
  async _youtube(entry) {
    const username = entry.channel.channelId.replace(/^@/, "");
    log("youtube", `поиск трансляции @${username}...`);
    try {
      const videoId = await yt.findLiveVideoId(username);
      if (!entry.alive) return;
      if (!videoId) {
        this._offline(entry, 60, `YouTube: @${username} сейчас не в эфире`);
        return;
      }
      log("youtube", `найдена трансляция ${videoId}, открываю чат...`);
      const session = await yt.openChat(videoId);
      if (!entry.alive) return;
      if (!session) {
        this._offline(entry, 45, `YouTube: чат трансляции @${username} недоступен`);
        return;
      }

      this._online(entry, `Канал подключён: YouTube Live / @${username}`);
      let cont = session.continuation;
      let misses = 0;

      const loop = async () => {
        if (!entry.alive) return;
        try {
          const res = await yt.poll({ ...session, continuation: cont });
          if (!entry.alive) return;
          if (!res) {
            misses += 1;
            if (misses >= 5) {
              this._retry(entry, 15000, `YouTube: чат @${username} недоступен`);
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
        } catch (e) {
          log("youtube", "poll error:", e.message);
          misses += 1;
          if (misses >= 5) {
            this._retry(entry, 15000, `YouTube: чат @${username} прервался`);
          } else {
            entry.timer = setTimeout(loop, 5000);
          }
        }
      };
      loop();
    } catch (e) {
      log("youtube", "ошибка:", e.message);
      this._retry(entry, 15000, `YouTube: ошибка подключения к @${username}`);
    }
  }

  /* ================== Kick: API + Pusher ================== */
  async _kick(entry) {
    const slug = entry.channel.channelId.trim().toLowerCase();
    log("kick", `запрос канала ${slug}...`);

    try {
      // пробуем API v2, потом v1
      let info = await getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
        Referer: `https://kick.com/${slug}`,
      });
      if (!info) {
        info = await getJson(`https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`, {
          Referer: `https://kick.com/${slug}`,
        });
      }
      if (!entry.alive) return;

      const chatroomId = info?.chatroom?.id;
      if (!chatroomId) {
        this._offline(entry, 60, `Kick: канал ${slug} не найден или чат закрыт`);
        return;
      }
      log("kick", `chatroom ${chatroomId}, подключаю Pusher...`);

      const ws = new WebSocket(KICK_WS);
      entry.ws = ws;

      ws.on("open", () => {
        ws.send(JSON.stringify({
          event: "pusher:subscribe",
          data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
        }));
        entry.ping = setInterval(() => {
          try { ws.send(JSON.stringify({ event: "pusher:ping" })); } catch { /* noop */ }
        }, 60000);
      });

      ws.on("message", (raw) => {
        try {
          const ev = JSON.parse(raw.toString());
          if (ev.event === "pusher_internal:subscription_succeeded") {
            this._online(entry, `Канал подключён: Kick / ${slug}`);
            return;
          }
          if (ev.event === "App\\Events\\ChatMessageEvent") {
            const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
            this.emitChat("kick", {
              author: d?.sender?.username,
              color: d?.sender?.identity?.color,
              text: d?.content,
            });
          }
        } catch { /* noop */ }
      });

      ws.on("close", () => this._retry(entry, 10000, `Kick: соединение с ${slug} потеряно`));
      ws.on("error", (e) => {
        log("kick", "ws error:", e.message);
        try { ws.close(); } catch { /* noop */ }
      });
    } catch (e) {
      log("kick", "ошибка:", e.message);
      this._retry(entry, 15000, `Kick: ошибка подключения к ${slug}`);
    }
  }

  /* ================== TikTok Live ================== */
  _tiktok(entry) {
    const username = entry.channel.channelId.replace(/^@/, "");
    let Conn = null;
    try {
      const mod = require("tiktok-live-connector");
      Conn = mod.WebcastPushConnection || mod.TikTokLiveConnection || null;
    } catch {
      Conn = null;
    }
    if (!Conn) {
      this._offline(entry, 300, "TikTok: модуль tiktok-live-connector недоступен");
      return;
    }
    let client;
    try {
      client = new Conn(username, { processInitialData: false, enableExtendedGiftInfo: false });
    } catch (e) {
      this._offline(entry, 120, `TikTok: ошибка создания подключения к @${username}`);
      return;
    }
    entry.client = {
      disconnect: () => { try { client.disconnect(); } catch { /* noop */ } },
    };
    client
      .connect()
      .then(() => this._online(entry, `Канал подключён: TikTok Live / @${username}`))
      .catch(() => this._offline(entry, 60, `TikTok: @${username} сейчас не в эфире`));
    client.on("chat", (d) => this.emitChat("tiktok", { author: d?.nickname || d?.uniqueId, text: d?.comment }));
    client.on("streamEnd", () => this._offline(entry, 60, `TikTok: трансляция @${username} завершена`));
    client.on("disconnected", () => this._retry(entry, 20000, `TikTok: @${username} отключён`));
    client.on("error", (e) => log("tiktok", "error:", e.message));
  }

  /* ================== VK Play Live ================== */
  async _vk(entry) {
    const channelId = entry.channel.channelId.trim().replace(/^@/, "");
    log("vk", `подключение к ${channelId}...`);
    const seen = new Set();

    const partText = (part) => {
      if (!part) return "";
      if (part.type === "mention") return `@${part.displayName || ""}`;
      if (part.type === "smile") return "";
      const c = part.content;
      let text = "";
      if (Array.isArray(c)) text = String(c[0] || "");
      else if (typeof c === "string") {
        try { const p = JSON.parse(c); text = Array.isArray(p) ? String(p[0] || "") : c; } catch { text = c; }
      }
      return text;
    };

    const endpoints = [
      `https://api.vkplay.live/v1/blog/${encodeURIComponent(channelId)}/public_video_stream/chat?limit=30`,
      `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(channelId)}/public_video_stream/chat?limit=30`,
    ];

    const poll = async (initial) => {
      if (!entry.alive) return;
      let data = null;
      for (const url of endpoints) {
        try {
          data = await getJson(url, { Referer: `https://live.vkvideo.ru/${channelId}` });
          if (data) break;
        } catch { /* try next endpoint */ }
      }
      if (!entry.alive) return;
      if (!data) {
        this._retry(entry, 10000, `VK Play: канал ${channelId} недоступен`);
        return;
      }
      this._online(entry, entry.status === "online" ? null : `Канал подключён: VK Play Live / ${channelId}`);
      const items = Array.isArray(data?.data) ? [...data.data].reverse() : [];
      for (const msg of items) {
        const id = String(msg.id ?? `${msg.author?.id || msg.author?.displayName}-${msg.createdAt}`);
        if (seen.has(id)) continue;
        seen.add(id);
        if (initial) continue;
        const text = (msg.data || []).map(partText).join("").trim();
        if (!text) continue;
        this.emitChat("vk", { author: msg.author?.displayName || msg.author?.nick || "vk_viewer", text });
      }
      if (seen.size > 400) seen.clear();
      entry.timer = setTimeout(() => poll(false), 2500);
    };

    poll(true);
  }
}

module.exports = { ConnectorManager };
