// Локальный сервер OBS-виджета: только 127.0.0.1, доступ по токену.
// FIX: если порт занят, не падаем main process, а автоматически ищем следующий.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

function makeServer({ token, onClient, widgetFile, eventsFile }) {
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, clients: clients.size }));
      return;
    }
    if (url.pathname === "/widget" || url.pathname === "/") {
      fs.readFile(widgetFile, (err, buf) => {
        if (err) {
          res.writeHead(500);
          res.end("widget not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(buf);
      });
      return;
    }
    if (url.pathname === "/events-widget") {
      fs.readFile(eventsFile, (err, buf) => {
        if (err) {
          res.writeHead(500);
          res.end("events widget not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(buf);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });
  const state = { config: null };
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/ws" && url.searchParams.get("token") === token) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        if (onClient) onClient(clients.size);
        // сразу отдаём текущее оформление — виджет не ждёт следующего изменения
        if (state.config) {
          try { ws.send(JSON.stringify({ type: "config", ...state.config })); } catch { /* noop */ }
        }
        ws.on("close", () => {
          clients.delete(ws);
          if (onClient) onClient(clients.size);
        });
      });
    } else {
      socket.destroy();
    }
  });

  return { server, wss, clients, state };
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function startWidgetServer({ port, token, onClient, onPort, onWarn, maxPortTries = 20 }) {
  const widgetFile = path.join(__dirname, "..", "widget", "index.html");
  const eventsFile = path.join(__dirname, "..", "widget", "events.html");
  let state = null;
  let boundPort = port;

  for (let i = 0; i <= maxPortTries; i += 1) {
    const tryPort = port + i;
    const candidate = makeServer({ token, onClient, widgetFile, eventsFile });
    try {
      await listenOn(candidate.server, tryPort);
      state = candidate;
      boundPort = tryPort;
      break;
    } catch (err) {
      try {
        candidate.wss.close();
        candidate.server.close();
      } catch {
        /* noop */
      }
      if (err && err.code === "EADDRINUSE") continue;
      throw err;
    }
  }

  if (!state) {
    const warn = `Widget server: не удалось занять порт ${port}-${port + maxPortTries}`;
    if (onWarn) onWarn(warn);
    return {
      port: 0,
      url: "",
      ready: false,
      broadcast() {},
      broadcastEvent() {},
      sendConfig() {},
      close() {},
    };
  }

  if (boundPort !== port && onWarn) {
    onWarn(`Widget server: порт ${port} занят, выбран ${boundPort}`);
  }
  if (onPort) onPort(boundPort);

  function broadcast(msg) {
    const data = JSON.stringify({ type: "chat", msg });
    for (const ws of state.clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function broadcastEvent(event) {
    const data = JSON.stringify({ type: "event", event });
    for (const ws of state.clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  async function close() {
    // close all ws clients
    for (const ws of [...state.clients]) {
      try { ws.close(); } catch { try { ws.terminate(); } catch {} }
    }

    // wait for clients to close (short timeout)
    const waitClients = new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        if (state.clients.size === 0 || Date.now() - start > 2000) {
          clearInterval(t);
          resolve();
        }
      }, 50);
    });

    await waitClients;

    await new Promise((resolve) => {
      try { state.server.close(() => resolve()); } catch { resolve(); }
    });
    try { state.wss.close(); } catch {}
  }

  return {
    ready: true,
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/widget?token=${token}`,
    broadcast,
    broadcastEvent,
    /** Мгновенно применяет настройки и стиль в уже открытом виджете OBS. */
    sendConfig(payload) {
      if (!payload) return;
      if (!payload.ttsPlay && !payload.ttsAudio) state.config = payload;
      const data = JSON.stringify({ type: "config", ...payload });
      for (const ws of state.clients) {
        if (ws.readyState === 1) ws.send(data);
      }
    },
    close,
  };
}

module.exports = { startWidgetServer };
