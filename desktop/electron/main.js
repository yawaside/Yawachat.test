// YawaChatHub — главный процесс Electron.
// Окна: главное (приложение целиком) + игровой оверлей (always-on-top, click-through, drag).
// Системный трей, глобальные горячие клавиши, локальный сервер виджета, SAPI TTS.
//
// FIX(2.0.0): «Сворачивать в трей при закрытии» — рабочая настройка.
//   Раньше переключатель в интерфейсе был заглушкой: он всегда показывал «включено»
//   и только выводил тост про settings.json. Теперь closeToTray читается из
//   settings.json при каждом закрытии окна, меняется из интерфейса (settings:patch)
//   и из меню трея, а крестик честно завершает приложение, когда настройка выключена.
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen } = require("electron");
const path = require("path");
const { getBaseDir, loadSettings, saveSettings } = require("./settings");
const { startWidgetServer } = require("./widgetServer");
const { ConnectorManager } = require("./connectors");
const { TtsEngine } = require("./tts");

const baseDir = getBaseDir();
const settings = loadSettings(baseDir);

let mainWin = null;
let overlayWin = null;
let tray = null;
let widgetServer = null;
let connectors = null;
const tts = new TtsEngine();

if (!app.requestSingleInstanceLock()) app.quit();

const RENDERER = path.join(__dirname, "..", "renderer-dist", "index.html");

function broadcast(channel, payload) {
  for (const win of [mainWin, overlayWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function persist() {
  saveSettings(settings, baseDir);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu());
}

/* ---------------- окна ---------------- */

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#06060b",
    title: "YawaChatHub",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  mainWin.loadFile(RENDERER, { hash: "/app" });
  mainWin.once("ready-to-show", () => {
    if (!settings.startHidden) mainWin.show();
  });

  // уведомляем рендерер о развёрнутости — иконка кнопки «во весь экран»
  mainWin.on("maximize", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:maximize", true);
  });
  mainWin.on("unmaximize", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:maximize", false);
  });

  // FIX: сворачивание в трей теперь учитывает текущее значение closeToTray
  mainWin.on("close", (e) => {
    if (settings.closeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
      if (tray) tray.displayBalloon({
        title: "YawaChatHub",
        content: "Приложение свёрнуто в трей. Двойной клик по иконке — открыть окно.",
      });
      return;
    }
    app.isQuitting = true;
  });

  mainWin.on("closed", () => {
    mainWin = null;
    app.isQuitting = true;
    app.quit();
  });
}

function applyOverlayFlags() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  // Прозрачность — только у подложки (CSS в рендерере), окно остаётся opacity=1,
  // иначе бледнел бы и текст сообщений.
  overlayWin.setOpacity(1);
  overlayWin.setIgnoreMouseEvents(!!settings.overlay.clickThrough, { forward: true });
  overlayWin.setMovable(!settings.overlay.locked && !settings.overlay.clickThrough);
  broadcast("sp:overlay", settings.overlay);
}

function createOverlayWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  overlayWin = new BrowserWindow({
    width: 360,
    height: 440,
    x: area.width - 390,
    y: 40,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.loadFile(RENDERER, { hash: "/overlay" });
  overlayWin.on("closed", () => (overlayWin = null));
  overlayWin.webContents.on("did-finish-load", applyOverlayFlags);
  if (settings.overlay.enabled) overlayWin.showInactive();
}

function toggleOverlay(force) {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlayWindow();
  const show = force !== undefined ? force : !overlayWin.isVisible();
  if (show) overlayWin.showInactive();
  else overlayWin.hide();
  settings.overlay.enabled = show;
  persist();
  applyOverlayFlags();
}

function toggleClickThrough() {
  settings.overlay.clickThrough = !settings.overlay.clickThrough;
  persist();
  applyOverlayFlags();
}

function toggleCloseToTray() {
  settings.closeToTray = !settings.closeToTray;
  persist();
  refreshTrayMenu();
  broadcast("sp:settings", settings);
}

/* ---------------- трей ---------------- */

const sendHotkey = (action) => broadcast("sp:hotkey", action);

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: "Открыть YawaChatHub", click: () => mainWin && mainWin.show() },
    { label: "Свернуть окно в трей", click: () => mainWin && mainWin.hide() },
    { type: "separator" },
    {
      label: "Сворачивать в трей при закрытии",
      type: "checkbox",
      checked: !!settings.closeToTray,
      click: toggleCloseToTray,
    },
    { type: "separator" },
    { label: "Озвучка вкл/выкл", click: () => sendHotkey("tts:toggle") },
    { label: "Пропустить текущее", click: () => sendHotkey("tts:skip") },
    { label: "Очистить очередь", click: () => sendHotkey("tts:clear") },
    { type: "separator" },
    { label: "Игровой оверлей вкл/выкл", click: () => toggleOverlay() },
    { label: "Сквозные клики вкл/выкл", click: () => toggleClickThrough() },
    { type: "separator" },
    { label: "Выход", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`YawaChatHub ${settings.version || ""}`.trim());
  tray.setContextMenu(trayMenu());
  tray.on("double-click", () => mainWin && mainWin.show());
}

/* ---------------- горячие клавиши ---------------- */

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const local = {
    "overlay:toggle": () => toggleOverlay(),
    "overlay:clicks": () => toggleClickThrough(),
    "window:toggle": () => {
      if (!mainWin) return;
      mainWin.isVisible() ? mainWin.hide() : mainWin.show();
    },
  };
  for (const [action, accelerator] of Object.entries(settings.hotkeys)) {
    if (!accelerator) continue;
    try {
      globalShortcut.register(accelerator, () => (local[action] ? local[action]() : sendHotkey(action)));
    } catch (e) {
      console.error(`[hotkeys] ${accelerator}: ${e.message}`);
    }
  }
}

/* ---------------- IPC ---------------- */

ipcMain.on("channels:add", (_e, c) => connectors && connectors.add(c.platform, c.channelId));
ipcMain.on("channels:remove", (_e, c) => connectors && connectors.remove(c.platform, c.channelId));
ipcMain.handle("channels:list", () => (connectors ? connectors.list() : []));

ipcMain.handle("widget:url", () => (widgetServer ? widgetServer.url : ""));
ipcMain.handle("widget:info", () => ({
  port: (widgetServer && widgetServer.port) || settings.port,
  token: settings.token,
  url: widgetServer ? widgetServer.url : "",
}));
// тестовое сообщение из панели виджета — летит во все подключённые OBS-клиенты
ipcMain.on("widget:test", (_e, msg) => {
  if (widgetServer && msg && msg.text) widgetServer.broadcast(msg);
});

ipcMain.handle("settings:get", () => settings);
ipcMain.on("settings:patch", (_e, patch) => {
  Object.assign(settings, patch);
  persist();
  refreshTrayMenu();
  broadcast("sp:settings", settings);
});

ipcMain.on("hotkeys:apply", (_e, map) => {
  settings.hotkeys = { ...settings.hotkeys, ...map };
  persist();
  registerHotkeys();
});

/* управление главным окном: свернуть / скрыть в трей / во весь экран / закрыть */
ipcMain.on("window:minimize", () => {
  if (!mainWin) return;
  if (settings.minimizeToTray) mainWin.hide();
  else mainWin.minimize();
});
ipcMain.on("window:hide-to-tray", () => mainWin && mainWin.hide());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWin) return;
  if (mainWin.isMaximized()) mainWin.unmaximize();
  else mainWin.maximize();
});
ipcMain.handle("window:is-maximized", () => (mainWin ? mainWin.isMaximized() : false));
ipcMain.on("window:close", () => {
  if (!mainWin) {
    app.isQuitting = true;
    app.quit();
    return;
  }
  if (settings.closeToTray) {
    mainWin.hide();
  } else {
    app.isQuitting = true;
    app.quit();
  }
});

tts.onEnd = (id) => broadcast("sp:tts-end", id);
ipcMain.on("tts:speak", (_e, payload) => tts.speak(payload));
ipcMain.on("tts:skip", () => tts.skip());
ipcMain.on("tts:stopAll", () => tts.stopAll());
ipcMain.handle("tts:voices", () => tts.voices());

ipcMain.handle("overlay:get", () => settings.overlay);
ipcMain.on("overlay:set", (_e, cfg) => {
  const wasEnabled = settings.overlay.enabled;
  settings.overlay = { ...settings.overlay, ...cfg };
  persist();
  if (settings.overlay.enabled !== wasEnabled) toggleOverlay(settings.overlay.enabled);
  else applyOverlayFlags();
});

ipcMain.on("app:quit", () => {
  app.isQuitting = true;
  app.quit();
});

/* ---------------- запуск ---------------- */

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// окно может быть скрыто в трей — приложение не должно завершаться
app.on("window-all-closed", (e) => {
  if (!app.isQuitting) e.preventDefault();
});

app.whenReady().then(async () => {
  widgetServer = await startWidgetServer({
    port: settings.port,
    token: settings.token,
    onClient: (n) => broadcast("sp:widget-clients", n),
    onPort: (p) => {
      if (p && p !== settings.port) {
        settings.port = p;
        persist();
      }
    },
    onWarn: (msg) => console.warn("[widget]", msg),
  });

  connectors = new ConnectorManager({
    settings,
    onChat: (m) => broadcast("sp:chat", m),
    onStatus: (list) => broadcast("sp:channels", list),
  });
  connectors.startAll();

  registerHotkeys();
  createMainWindow();
  createTray();

  app.on("activate", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.show();
  });
});
