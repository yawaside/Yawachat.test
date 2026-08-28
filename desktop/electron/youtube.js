// YouTube Live Chat — БЕЗ Data API и БЕЗ ключа Google.
// Работает как браузер: страница /live → видеоId → /live_chat → youtubei endpoint.
const { getText, getJson, postJson } = require("./net");

function findJson(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  let i = html.indexOf("{", at);
  if (i === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j += 1) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : "";
}

async function fetchPage(url) {
  const html = await getText(url, {
    Referer: "https://www.youtube.com/",
  });
  return html || "";
}

/** Ищет videoId активной трансляции канала по username / @handle. */
async function findLiveVideoId(username) {
  const name = String(username || "").replace(/^@/, "");
  // список кандидатов URL — YouTube перенаправляет на правильный
  const candidates = [
    `https://www.youtube.com/@${name}/live`,
    `https://www.youtube.com/c/${name}/live`,
    `https://www.youtube.com/user/${name}/live`,
    `https://www.youtube.com/${name}/live`,
  ];
  for (const url of candidates) {
    try {
      const html = await fetchPage(url);
      if (!html || html.length < 2000) continue;

      // ищем canonical
      let id = pick(html, /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
      // ищем videoId с isLive
      if (!id) id = pick(html, /"videoId":"([\w-]{11})"[^}]*?"isLive":true/);
      // fallback — просто videoId
      if (!id) id = pick(html, /"videoId":"([\w-]{11})"/);
      if (!id) id = pick(html, /\\"videoId\\":\\"([\w-]{11})\\"/);
      if (!id) continue;

      // проверяем что трансляция идёт
      const isLive =
        /"isLiveNow":true/.test(html) ||
        /"isLive":true/.test(html) ||
        /"liveBroadcastDetails"/.test(html) ||
        /"isLiveContent":true/.test(html);
      if (isLive) return id;
    } catch {
      // пробуем следующий URL
    }
  }
  return "";
}

/** Открывает окно чата и извлекает ключ + continuation. */
async function openChat(videoId) {
  const html = await fetchPage(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`);
  if (!html || html.length < 2000) return null;

  const key = pick(html, /"INNERTUBE_API_KEY":"([^"]+)"/);
  const clientVersion =
    pick(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || "2.20241201.00.00";
  if (!key) {
    console.log("[yt] не найден INNERTUBE_API_KEY, возможно YouTube изменил структуру");
    return null;
  }

  const data = findJson(html, "ytInitialData");
  const conts =
    data?.contents?.liveChatRenderer?.continuations ||
    data?.continuationContents?.liveChatContinuation?.continuations ||
    [];
  let continuation = "";
  for (const c of conts) {
    continuation =
      c?.invalidationContinuationData?.continuation ||
      c?.timedContinuationData?.continuation ||
      c?.reloadContinuationData?.continuation ||
      "";
    if (continuation) break;
  }
  // fallback: ищем длинную строку continuation прямо в HTML
  if (!continuation) {
    continuation = pick(html, /"continuation":"([A-Za-z0-9_-]{40,})"/);
  }
  if (!continuation) {
    console.log("[yt] не найден continuation token");
    return null;
  }

  return { key, clientVersion, continuation };
}

function runsToText(message) {
  const runs = message?.runs || [];
  return runs
    .map((r) => {
      if (typeof r.text === "string") return r.text;
      const label = r?.emoji?.shortcuts?.[0] || r?.emoji?.emojiId || "";
      return label ? ` ${label} ` : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function parseActions(actions) {
  const out = [];
  for (const a of actions || []) {
    const item =
      a?.addChatItemAction?.item ||
      a?.replayChatItemAction?.actions?.[0]?.addChatItemAction?.item ||
      null;
    if (!item) continue;

    const text = item.liveChatTextMessageRenderer;
    const paid = item.liveChatPaidMessageRenderer;
    const r = text || paid;
    if (!r) continue;

    const author = r.authorName?.simpleText || "зритель";
    const body = runsToText(r.message) || (paid ? runsToText(paid.headerSubtext) : "");
    if (!body) continue;

    const badges = [];
    for (const b of r.authorBadges || []) {
      const tip = b?.liveChatAuthorBadgeRenderer?.tooltip || "";
      if (/moderator|модератор/i.test(tip)) badges.push("MOD");
      else if (/member|спонсор|участник/i.test(tip)) badges.push("SUB");
      else if (/verified|owner|влад/i.test(tip)) badges.push("VIP");
    }
    if (paid) badges.push("GIFT");
    out.push({ author, text: body, badges });
  }
  return out;
}

async function poll({ key, clientVersion, continuation }) {
  const data = await postJson(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${key}&prettyPrint=false`,
    {
      context: {
        client: { clientName: "WEB", clientVersion, hl: "ru", gl: "RU" },
      },
      continuation,
    },
    { "x-youtube-client-name": "1", "x-youtube-client-version": clientVersion }
  );
  if (!data) return null;

  const lc = data?.continuationContents?.liveChatContinuation;
  if (!lc) return null;

  const cont = lc.continuations?.[0] || {};
  const next =
    cont.invalidationContinuationData?.continuation ||
    cont.timedContinuationData?.continuation ||
    cont.reloadContinuationData?.continuation ||
    continuation;
  const timeoutMs =
    cont.invalidationContinuationData?.timeoutMs ||
    cont.timedContinuationData?.timeoutMs ||
    4000;

  return { messages: parseActions(lc.actions), continuation: next, timeoutMs };
}

module.exports = { findLiveVideoId, openChat, poll };
