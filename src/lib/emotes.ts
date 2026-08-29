/**
 * Смайлы чата: глобальные и пользовательские наборы площадок.
 * Источники без авторизации:
 *  • 7TV  — глобальные + наборы Twitch-канала
 *  • BTTV — глобальные + наборы канала
 *  • FFZ  — наборы канала (по login)
 *  • Twitch CDN — нативные эмодзи из IRC-тега emotes
 *  • VK, Kick, YouTube, TikTok — нативные из коннекторов (parts)
 */
import { useEffect, useState } from "react";

export interface EmoteToken {
  type: "text" | "emote";
  value: string;
  url?: string;
}

type EmoteMap = Map<string, string>;

const cache: EmoteMap = new Map();
const loadedKeys = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const fn of listeners) fn();
}

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function addEmote(name: unknown, url: unknown) {
  if (typeof name !== "string" || typeof url !== "string" || !name.trim() || !url) return;
  if (!cache.has(name)) cache.set(name, url);
}

function absUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http")) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

/* ---------- парсеры ---------- */

function parse7tv(data: unknown) {
  if (!data) return;
  const emotes =
    (data as { emotes?: unknown[] }).emotes ??
    (data as { emote_set?: { emotes?: unknown[] } }).emote_set?.emotes ??
    (Array.isArray(data) ? data : []);

  for (const raw of emotes as Array<Record<string, unknown>>) {
    const name = raw?.name;
    const dataObj = (raw?.data as Record<string, unknown>) || raw;
    const host = (dataObj?.host as { url?: string; files?: Array<{ name: string }> }) || undefined;
    if (!host?.url) continue;
    const files = host.files ?? [];
    const file =
      files.find((f) => /2x\.webp$/i.test(f.name)) ||
      files.find((f) => /1x\.webp$/i.test(f.name)) ||
      files.find((f) => /\.webp$/i.test(f.name)) ||
      files[0];
    if (!file) continue;
    const base = absUrl(host.url).replace(/\/$/, "");
    addEmote(name, `${base}/${file.name}`);
  }
}

function parseBttv(data: unknown) {
  if (!data) return;
  const list = Array.isArray(data)
    ? data
    : [
        ...(((data as Record<string, unknown>).channelEmotes as unknown[]) ?? []),
        ...(((data as Record<string, unknown>).sharedEmotes as unknown[]) ?? []),
      ];
  for (const raw of list as Array<Record<string, unknown>>) {
    if (raw?.id && raw?.code) {
      addEmote(String(raw.code), `https://cdn.betterttv.net/emote/${raw.id}/2x.webp`);
    }
  }
}

function parseFfz(data: unknown) {
  if (!data) return;
  const sets = ((data as Record<string, unknown>).sets ?? {}) as Record<
    string,
    { emoticons?: unknown[] }
  >;
  for (const set of Object.values(sets)) {
    for (const raw of (set?.emoticons ?? []) as Array<Record<string, unknown>>) {
      const urls = raw?.urls as Record<string, string> | undefined;
      const url = urls?.["2"] || urls?.["4"] || urls?.["1"];
      if (url) addEmote(raw.name, absUrl(url));
    }
  }
}

/** Глобальные наборы — один раз при старте. */
export async function loadGlobalEmotes() {
  if (loadedKeys.has("global")) return;
  loadedKeys.add("global");
  try {
    const [seven, bttv] = await Promise.all([
      getJson("https://7tv.io/v3/emote-sets/global"),
      getJson("https://api.betterttv.net/3/cached/emotes/global"),
    ]);
    parse7tv(seven);
    parseBttv(bttv);
  } catch { /* noop */ }
  notify();
}

async function resolveTwitchId(login: string): Promise<string> {
  const clean = login.replace(/^#/, "").toLowerCase();
  const ffz = (await getJson(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(clean)}`)) as
    | { room?: { twitch_id?: number | string } }
    | null;
  if (ffz?.room?.twitch_id) return String(ffz.room.twitch_id);
  return "";
}

/** Пользовательские смайлы Twitch-канала. */
export async function loadChannelEmotes(login: string) {
  const clean = login.replace(/^#/, "").toLowerCase();
  const key = `tw:${clean}`;
  if (!clean || loadedKeys.has(key)) return;
  loadedKeys.add(key);
  try {
    const ffz = await getJson(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(clean)}`);
    parseFfz(ffz);
    const id = await resolveTwitchId(clean);
    if (id) {
      const [bttv, seven] = await Promise.all([
        getJson(`https://api.betterttv.net/3/cached/users/twitch/${id}`),
        getJson(`https://7tv.io/v3/users/twitch/${id}`),
      ]);
      parseBttv(bttv);
      parse7tv((seven as { emote_set?: unknown })?.emote_set ?? seven);
    }
  } catch { /* noop */ }
  notify();
}

/** Разбирает текст на токены с учётом нативных Twitch emotes и сторонних наборов. */
export function parseEmotes(
  text: string,
  twitchEmotes?: Array<{ id: string; start: number; end: number }>
): EmoteToken[] {
  if (!text) return [{ type: "text", value: "" }];

  if (twitchEmotes && twitchEmotes.length) {
    const sorted = [...twitchEmotes].sort((a, b) => a.start - b.start);
    const out: EmoteToken[] = [];
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
    if (cursor < text.length) out.push(...splitThirdParty(text.slice(cursor)));
    return out.flatMap((t) => (t.type === "text" ? splitThirdParty(t.value) : [t]));
  }

  return splitThirdParty(text);
}

function splitThirdParty(text: string): EmoteToken[] {
  if (!text) return [];
  if (cache.size === 0) return [{ type: "text", value: text }];
  const out: EmoteToken[] = [];
  const parts = text.split(/(\s+)/);
  for (const tok of parts) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      const last = out[out.length - 1];
      if (last && last.type === "text") last.value += tok;
      else out.push({ type: "text", value: tok });
      continue;
    }
    const url = cache.get(tok);
    if (url) out.push({ type: "emote", value: tok, url });
    else out.push({ type: "text", value: tok });
  }
  const merged: EmoteToken[] = [];
  for (const t of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === "text" && t.type === "text") last.value += t.value;
    else merged.push(t);
  }
  return merged.length ? merged : [{ type: "text", value: text }];
}

/** Подписка на загрузку наборов — лента перерисуется, когда смайлы приедут. */
export function useEmotes(channels: Array<{ platform: string; channelId: string }>) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    loadGlobalEmotes();
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    for (const c of channels) {
      if (c.platform === "twitch") loadChannelEmotes(c.channelId);
    }
  }, [channels.map((c) => `${c.platform}:${c.channelId}`).join("|")]);
  return version;
}
