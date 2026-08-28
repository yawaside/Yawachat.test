// Коннекторы площадок. Каждый работает независимо: ошибка одной не влияет
// на остальные. Переподключение — автоматическое, с ростом интервала.
//
// Twitch  — анонимное чтение IRC по нику канала (tmi.js), без OAuth.
// YouTube — Data API v3 по username/@handle канала + ключ разработчика Google.
// Kick    — публичный API канала + Pusher WebSocket чата.
// TikTok  — tiktok-live-connector по @username активной трансляции.
// VK Play Live — публичный chat-polling по ID канала (vkplay.live/<id>).

const tmi = require("tmi.js");
const WebSocket = require("ws");

const NAME_COLORS = ["#ff6b81", "#ffa94d", "#ffd43b", "#69db7c", "#3bc9db", "#4dabf7", "#9775fa", "#f783ac"];
const KICK_WS =
  "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=8.4.0-rc2&flash=false";

function twitchBadges(tags) {
  const b = [];
  if (tags.mod || (tags.badges && tags.badges.moderator)) b.push("MOD");
  if (tags.badges && tags.badges.vip) b.push("VIP");
  if (tags.subscriber || (tags.badges && tags.badges.subscriber)) b.push("SUB");
  return b;
}

class ConnectorManager {
  constructor({ settings, onChat, onStatus }) {
    this.settings = settings;
    this.onChat = onChat;
    this.onStatus = onStatus;
    this.channels = new Map();
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
    entry.status = status;
    this.emitStatus();
  }

  emitChat(platform, { author, text, color, badges }) {
    if (!text) return;
    this.onChat({
      id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: author || "зритель",
      text: String(text),
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
    if (platform === "youtube") {
      if (/^UC[A-Za-z0-9_-]{10,}$/.test(raw) || /^[A-Za-z0-9_-]{11}$/.test(raw)) {
        this.emitSys("youtube", "YouTube: нужен username/@handle канала, не ID и не ссылка");
        return;
      }
    }
    const normalized = platform === "tiktok" ? `@${uname}` : uname;
    const channel = { platform, channelId: normalized };
    const k = this.key(channel);
    if (this.channels.has(k)) return;
    const entry = { channel, status: "connecting", attempts: 0 };
    this.channels.set(k, entry);
    this.emitStatus();
    this._connect(entry);
    if (!silent) {
      this.settings.channels = (this.settings.channels || []).filter(
        (c) => !(c.platform === platform && c.channelId === channelId)
      );
      this.settings.channels.push({ platform, channelId });
      this._persist();
    }
  }

  remove(platform, channelId) {
    const k = `${platform}:${channelId}`;
    const entry = this.channels.get(k);
    if (!entry) return;
    this._teardown(entry);
    this.channels.delete(k);
    this.settings.channels = (this.settings.channels || []).filter(
      (c) => !(c.platform === platform && c.channelId === channelId)
    );
    this._persist();
    this.emitStatus();
  }

  _persist() {
    try {
      require("./settings").saveSettings(this.settings);
    } catch {
      /* noop */
    }
  }

  _teardown(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.client && entry.client.disconnect) {
      try {
        entry.client.disconnect();
      } catch { /* noop */ }
    }
    if (entry.ws) {
      try {
        entry.ws.close();
      } catch { /* noop */ }
    }
    if (entry.pollAbort) {
      try {
        entry.pollAbort.abort();
      } catch { /* noop */ }
    }
  }

  _reconnect(entry, delayMs) {
    this.setStatus(entry, "error");
    if (entry.timer) clearTimeout(entry.timer);
    entry.attempts += 1;
    const wait = Math.min(delayMs * entry.attempts, 120000);
    this.emitSys(entry.channel.platform, `Переподключение ${entry.channel.channelId} через ${Math.round(wait / 1000)} с`);
    entry.timer = setTimeout(() => {
      this.setStatus(entry, "connecting");
      this._connect(entry);
    }, wait);
  }

  _connect(entry) {
    const p = entry.channel.platform;
    if (p === "twitch") this._twitch(entry);
    else if (p === "youtube") this._youtube(entry);
    else if (p === "kick") this._kick(entry);
    else if (p === "tiktok") this._tiktok(entry);
    else if (p === "vk") this._vk(entry);
    else this.setStatus(entry, "offline");
  }

  /* ---------------- Twitch ---------------- */
  _twitch(entry) {
    const name = entry.channel.channelId.replace(/^#/, "");
    const client = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: false, secure: true },
      channels: [name],
    });
    entry.client = client;
    client.on("message", (_ch, tags, message, self) => {
      if (self) return;
      this.emitChat("twitch", {
        author: tags["display-name"] || tags.username,
        color: tags.color,
        badges: twitchBadges(tags),
        text: message,
      });
    });
    client.on("connected", () => {
      this.setStatus(entry, "online");
      entry.attempts = 0;
      this.emitSys("twitch", `Канал подключён: Twitch / ${name}`);
    });
    client.on("disconnected", () => this._reconnect(entry, 8000));
    client.connect().catch(() => this._reconnect(entry, 8000));
  }

  /* ---------------- YouTube Live ---------------- */
  async _youtube(entry) {
    const key = this.settings.youtubeApiKey;
    const username = entry.channel.channelId.replace(/^@/, "");
    if (!key) {
      this.setStatus(entry, "offline");
      this.emitSys("youtube", "YouTube: укажите youtubeApiKey в settings.json (username/@handle канала)");
      return;
    }
    const abort = new AbortController();
    entry.pollAbort = abort;
    try {
      let channelId = "";
      const byUsername = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(username)}&key=${key}`,
        { signal: abort.signal }
      ).then((r) => r.json());
      if (byUsername.error) throw new Error(byUsername.error.message || "api error");
      channelId = byUsername.items?.[0]?.id || "";
      if (!channelId) {
        const bySearch = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=5&q=${encodeURIComponent(username)}&key=${key}`,
          { signal: abort.signal }
        ).then((r) => r.json());
        if (bySearch.error) throw new Error(bySearch.error.message || "api error");
        const exact = (bySearch.items || []).find((it) => {
          const title = String(it?.snippet?.channelTitle || "").toLowerCase();
          const ch = String(it?.snippet?.channelId || "").toLowerCase();
          return title === username.toLowerCase() || ch === username.toLowerCase();
        });
        channelId = exact?.snippet?.channelId || bySearch.items?.[0]?.snippet?.channelId || "";
      }
      if (!channelId) {
        this.setStatus(entry, "offline");
        this.emitSys("youtube", `YouTube: канал ${username} не найден`);
        entry.timer = setTimeout(() => this._connect(entry), 60000);
        return;
      }

      const search = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&eventType=live&type=video&channelId=${encodeURIComponent(channelId)}&key=${key}`,
        { signal: abort.signal }
      ).then((r) => r.json());
      if (search.error) throw new Error(search.error.message || "api error");
      const videoId = search.items?.[0]?.id?.videoId;
      if (!videoId) {
        this.setStatus(entry, "offline");
        entry.timer = setTimeout(() => this._connect(entry), 60000);
        return;
      }
      const v = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${key}`,
        { signal: abort.signal }
      ).then((r) => r.json());
      const chatId = v.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) {
        this.setStatus(entry, "offline");
        entry.timer = setTimeout(() => this._connect(entry), 60000);
        return;
      }
      this.setStatus(entry, "online");
      entry.attempts = 0;
      this.emitSys("youtube", `Канал подключён: YouTube Live / ${username}`);
      let pageToken = "";
      const poll = async () => {
        if (abort.signal.aborted) return;
        try {
          const url =
            `https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet,authorDetails` +
            `&liveChatId=${chatId}&key=${key}` + (pageToken ? `&pageToken=${pageToken}` : "");
          const data = await fetch(url, { signal: abort.signal }).then((r) => r.json());
          if (data.error) throw new Error(data.error.message || "api error");
          pageToken = data.nextPageToken || pageToken;
          for (const item of data.items || []) {
            this.emitChat("youtube", {
              author: item.authorDetails.displayName,
              text: item.snippet.displayMessage,
              badges: item.authorDetails.isChatModerator ? ["MOD"] : item.authorDetails.isChatSponsor ? ["SUB"] : [],
            });
          }
          entry.timer = setTimeout(poll, Math.max(data.pollingIntervalMillis || 5000, 3000));
        } catch {
          if (!abort.signal.aborted) this._reconnect(entry, 15000);
        }
      };
      poll();
    } catch {
      this._reconnect(entry, 15000);
    }
  }

  /* ---------------- Kick ---------------- */
  async _kick(entry) {
    const slug = entry.channel.channelId.trim();
    try {
      const info = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
        headers: { accept: "application/json", "user-agent": "YawaChatHub/2.0" },
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))));
      const chatroomId = info?.chatroom?.id;
      if (!chatroomId) {
        this.setStatus(entry, "offline");
        this.emitSys("kick", `Kick: чат канала ${slug} не найден (трансляция офлайн?)`);
        entry.timer = setTimeout(() => this._connect(entry), 60000);
        return;
      }
      const ws = new WebSocket(KICK_WS);
      entry.ws = ws;
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            event: "pusher:subscribe",
            data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
          })
        );
      });
      ws.on("message", (raw) => {
        try {
          const ev = JSON.parse(raw.toString());
          if (ev.event === "pusher_internal:subscription_succeeded") {
            this.setStatus(entry, "online");
            entry.attempts = 0;
            this.emitSys("kick", `Канал подключён: Kick / ${slug}`);
            return;
          }
          if (ev.event === "App\\Events\\ChatMessageEvent") {
            const d = JSON.parse(ev.data);
            this.emitChat("kick", {
              author: d.sender?.username,
              color: d.sender?.identity?.color,
              text: d.content,
            });
          }
        } catch {
          /* noop */
        }
      });
      ws.on("close", () => this._reconnect(entry, 10000));
      ws.on("error", () => {
        try {
          ws.close();
        } catch { /* noop */ }
      });
    } catch {
      this._reconnect(entry, 15000);
    }
  }

  /* ---------------- TikTok Live ---------------- */
  _tiktok(entry) {
    const username = entry.channel.channelId.replace(/^@/, "");
    let WebcastPushConnection;
    try {
      ({ WebcastPushConnection } = require("tiktok-live-connector"));
    } catch {
      this.setStatus(entry, "offline");
      this.emitSys("tiktok", "TikTok: модуль tiktok-live-connector не найден (npm install в desktop/)");
      return;
    }
    const client = new WebcastPushConnection(username, {
      processInitialData: false,
      enableExtendedGiftInfo: false,
    });
    entry.client = {
      disconnect: () => {
        try {
          client.disconnect();
        } catch { /* noop */ }
      },
    };
    client
      .connect()
      .then(() => {
        this.setStatus(entry, "online");
        entry.attempts = 0;
        this.emitSys("tiktok", `Канал подключён: TikTok Live / @${username}`);
      })
      .catch((err) => {
        this.setStatus(entry, "offline");
        this.emitSys("tiktok", `TikTok: @${username} не в эфире (${String(err).slice(0, 80)})`);
        entry.timer = setTimeout(() => this._connect(entry), 45000);
      });
    client.on("chat", (d) => {
      this.emitChat("tiktok", { author: d.nickname || d.uniqueId, text: d.comment });
    });
    client.on("streamEnd", () => {
      this.emitSys("tiktok", `TikTok: трансляция @${username} завершена`);
      this._reconnect(entry, 30000);
    });
    client.on("error", () => this._reconnect(entry, 20000));
  }

  /* ---------------- VK Video Live ---------------- */
  async _vk(entry) {
    const channelId = entry.channel.channelId.trim().replace(/^@/, "");
    const abort = new AbortController();
    entry.pollAbort = abort;
    const headers = {
      accept: "application/json",
      referer: `https://vkplay.live/${channelId}`,
      "user-agent": "Mozilla/5.0 YawaChatHub/2.0",
    };
    const seen = new Set();

    const partText = (part) => {
      if (!part) return "";
      const c = part.content;
      const text = Array.isArray(c) ? String(c[0] || "") : String(c || "");
      if (part.type === "text" || part.type === "link") return text;
      if (part.type === "mention") return `@${part.displayName || ""}`;
      return "";
    };

    const poll = async (initial = false) => {
      if (abort.signal.aborted) return;
      try {
        const data = await fetch(
          `https://api.vkplay.live/v1/blog/${encodeURIComponent(channelId)}/public_video_stream/chat?limit=30`,
          { signal: abort.signal, headers }
        ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))));
        if (!entry._vkOnline) {
          entry._vkOnline = true;
          this.setStatus(entry, "online");
          entry.attempts = 0;
          this.emitSys("vk", `Канал подключён: VK Play Live / ${channelId}`);
        }
        const items = Array.isArray(data?.data) ? data.data : [];
        for (const msg of items.reverse()) {
          const id = String(msg.id ?? `${msg.author?.id || msg.author?.displayName}-${msg.createdAt}`);
          if (seen.has(id)) continue;
          seen.add(id);
          if (initial) continue;
          this.emitChat("vk", {
            author: msg.author?.displayName || msg.author?.nick || "vk_viewer",
            text: (msg.data || []).map(partText).join("").trim(),
          });
        }
        entry.timer = setTimeout(() => poll(false), 2500);
      } catch {
        if (!abort.signal.aborted) this._reconnect(entry, 10000);
      }
    };
    poll(true);
  }
}

module.exports = { ConnectorManager };
