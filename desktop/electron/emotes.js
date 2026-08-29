// Смайлы для OBS-виджета и основной ленты.
// Глобальные 7TV + BTTV + нативные Twitch emotes.

const https = require("https");

const cache = new Map(); // name -> url
let loading = null;

function getJson(url) {
  return new Promise((resolve) => {
    try {
      https
        .get(url, { headers: { accept: "application/json", "user-agent": "YawaChatHub/3.1.4" } }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
          });
        })
        .on("error", () => resolve(null));
    } catch { resolve(null); }
  });
}

function add(name, url) {
  if (typeof name === "string" && typeof url === "string" && name && url && !cache.has(name)) {
    cache.set(name, url.startsWith("//") ? `https:${url}` : url);
  }
}

function parse7tv(data) {
  if (!data) return;
  const list = data.emotes || data.emote_set?.emotes || (Array.isArray(data) ? data : []);
  for (const raw of list) {
    const host = raw?.data?.host || raw?.host;
    if (!host?.url) continue;
    const files = host.files || [];
    const file =
      files.find((f) => /2x\.webp$/i.test(f.name)) ||
      files.find((f) => /\.webp$/i.test(f.name)) ||
      files[0];
    if (!file) continue;
    const base = String(host.url).startsWith("//") ? `https:${host.url}` : host.url;
    add(raw.name, `${base.replace(/\/$/, "")}/${file.name}`);
  }
}

function parseBttv(data) {
  if (!data) return;
  const list = Array.isArray(data) ? data : [...(data.channelEmotes || []), ...(data.sharedEmotes || [])];
  for (const raw of list) {
    if (raw?.id && raw?.code) add(raw.code, `https://cdn.betterttv.net/emote/${raw.id}/2x.webp`);
  }
}

async function ensureGlobal() {
  if (loading) return loading;
  loading = (async () => {
    const [seven, bttv] = await Promise.all([
      getJson("https://7tv.io/v3/emote-sets/global"),
      getJson("https://api.betterttv.net/3/cached/emotes/global"),
    ]);
    parse7tv(seven);
    parseBttv(bttv);
  })();
  return loading;
}

function toParts(text, twitchEmotes) {
  if (!text) return [{ type: "text", value: "" }];
  if (Array.isArray(twitchEmotes) && twitchEmotes.length) {
    const sorted = [...twitchEmotes].sort((a, b) => a.start - b.start);
    const out = [];
    let cursor = 0;
    for (const e of sorted) {
      if (e.start > cursor) out.push({ type: "text", value: text.slice(cursor, e.start) });
      const name = text.slice(e.start, e.end + 1);
      out.push({
        type: "emote",
        value: name,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/2.0`,
      });
      cursor = e.end + 1;
    }
    if (cursor < text.length) out.push(...splitThird(text.slice(cursor)));
    return out.flatMap((t) => (t.type === "text" ? splitThird(t.value) : [t]));
  }
  return splitThird(text);
}

function splitThird(text) {
  if (!text) return [];
  if (!cache.size) return [{ type: "text", value: text }];
  const out = [];
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push({ type: "text", value: part });
      continue;
    }
    const url = cache.get(part);
    if (url) out.push({ type: "emote", value: part, url });
    else out.push({ type: "text", value: part });
  }
  return out.length ? out : [{ type: "text", value: text }];
}

function enrich(msg) {
  if (!msg || msg.sys) return msg;
  if (Array.isArray(msg.parts) && msg.parts.length) return msg;
  return { ...msg, parts: toParts(msg.text, msg.emotes) };
}

module.exports = { ensureGlobal, enrich, toParts };
