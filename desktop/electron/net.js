// Сетевой помощник — обычный Node.js https с браузерными заголовками.
// Раньше скрытое окно Chromium (BrowserWindow + executeJavaScript) — ломалось молча,
// все запросы возвращали {ok:false}. Теперь — простой https, работает всегда.
const https = require("https");
const http = require("http");
const { URL } = require("url");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

function log(tag, ...args) {
  console.log(`[net:${tag}]`, ...args);
}

function request(url, { method = "GET", headers = {}, body = null, timeout = 25000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      resolve({ ok: false, status: 0, body: "", error: e.message });
      return;
    }
    const mod = parsed.protocol === "https:" ? https : http;
    const finalHeaders = {
      "User-Agent": UA,
      Accept: "*/*",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
      ...headers,
    };

    const req = mod.request(url, { method, headers: finalHeaders, timeout }, (res) => {
      // следуем редиректам (3xx)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith("/")) loc = `${parsed.protocol}//${parsed.host}${loc}`;
        log("redirect", res.statusCode, "→", loc);
        resolve(request(loc, { method, headers, body, timeout }));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: text });
      });
    });
    req.on("error", (e) => {
      log("error", url, e.message);
      resolve({ ok: false, status: 0, body: "", error: e.message });
    });
    req.on("timeout", () => {
      log("timeout", url);
      req.destroy();
      resolve({ ok: false, status: 0, body: "", error: "timeout" });
    });
    if (body && method !== "GET") {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      if (!finalHeaders["Content-Type"]) finalHeaders["Content-Type"] = "application/json";
      req.write(payload);
    }
    req.end();
  });
}

async function getText(url, extraHeaders) {
  const r = await request(url, { headers: extraHeaders });
  return r.ok ? r.body : "";
}

async function getJson(url, extraHeaders) {
  const r = await request(url, {
    headers: { Accept: "application/json", ...extraHeaders },
  });
  if (!r.ok) {
    log("getJson fail", url, "status:", r.status, r.error || "");
    return null;
  }
  try {
    return JSON.parse(r.body);
  } catch (e) {
    log("json parse error", url, e.message, "body:", r.body.slice(0, 200));
    return null;
  }
}

async function postJson(url, data, extraHeaders) {
  const r = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...extraHeaders },
    body: data,
  });
  if (!r.ok) {
    log("postJson fail", url, "status:", r.status);
    return null;
  }
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

function closeNet() {
  // nothing to clean up — plain https module
}

module.exports = { request, getText, getJson, postJson, closeNet, UA };
