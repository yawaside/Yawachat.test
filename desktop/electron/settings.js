// Хранение настроек в settings.json рядом с exe. Без реестра, без БД.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_HOTKEYS = {
  "overlay:toggle": "Control+Shift+G",
  "overlay:clicks": "Control+Shift+C",
  "tts:toggle": "Control+Shift+T",
  "tts:pause": "Control+Shift+P",
  "tts:skip": "Control+Shift+S",
  "tts:clear": "Control+Shift+Q",
  "window:toggle": "Control+Shift+H",
  "feed:clear": "Control+Shift+L",
};

const DEFAULT_WIDGET = {
  theme: "minimal-dark",
  fontSize: 16,
  bgOpacity: 70, // прозрачность ТОЛЬКО подложки
  radius: 12,
  duration: 8,
  dir: "up",
  shadow: true,
  showPlatform: true,
  showTime: true,
  maxMessages: 8,
};

const DEFAULT_OVERLAY = {
  enabled: false,
  bgOpacity: 55, // прозрачность подложки оверлея, текст остаётся чётким
  clickThrough: false,
  mode: "compact",
  fontSize: 12,
  maxMessages: 6,
  locked: false,
};

const DEFAULTS = {
  port: 47823,
  token: null, // генерируется при первом запуске
  theme: "midnight",
  /* FIX(2.0.0): поведение окна управляется из интерфейса и из меню трея */
  closeToTray: true, // крестик сворачивает окно в трей
  minimizeToTray: false, // кнопка «минус» сворачивает в трей (иначе на панель задач)
  startHidden: false, // не показывать окно при старте
  // YouTube читается без Data API (внутренний endpoint, как в браузере).
  // Ключ больше не нужен — поле оставлено только для совместимости со старыми конфигами.
  youtubeApiKey: "",
  overlayBounds: null, // позиция и размер окна оверлея
  channels: [],
  tts: null, // заполняется из интерфейса: { enabled, rate, volume, voiceURI, template, filters }
  chatView: null, // вид ленты
  widget: DEFAULT_WIDGET,
  overlay: DEFAULT_OVERLAY,
  hotkeys: DEFAULT_HOTKEYS,
};

function getBaseDir() {
  // portable-сборка electron-builder выставляет PORTABLE_EXECUTABLE_DIR
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "win32" && !process.argv[0].includes("electron")) {
    try {
      return path.dirname(process.execPath);
    } catch {
      /* noop */
    }
  }
  return path.join(__dirname, "..");
}

function getSettingsPath(baseDir) {
  return path.join(baseDir || getBaseDir(), "settings.json");
}

function loadSettings(baseDir) {
  const file = getSettingsPath(baseDir);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* первый запуск */
  }
  const settings = {
    ...DEFAULTS,
    ...data,
    widget: { ...DEFAULT_WIDGET, ...(data.widget || {}) },
    overlay: { ...DEFAULT_OVERLAY, ...(data.overlay || {}) },
    hotkeys: { ...DEFAULT_HOTKEYS, ...(data.hotkeys || {}) },
  };
  // «Сворачивать в трей» — булев флаг: защищаемся от строк из старых конфигов
  settings.closeToTray = settings.closeToTray !== false;
  settings.minimizeToTray = settings.minimizeToTray === true;
  settings.startHidden = settings.startHidden === true;
  if (!settings.token) {
    settings.token = "yawa_" + crypto.randomBytes(6).toString("hex");
    saveSettings(settings, baseDir);
  }
  return settings;
}

function saveSettings(settings, baseDir) {
  try {
    fs.writeFileSync(getSettingsPath(baseDir), JSON.stringify(settings, null, 2), "utf8");
  } catch (e) {
    console.error("[settings] не удалось записать settings.json:", e.message);
  }
}

module.exports = {
  DEFAULTS, DEFAULT_HOTKEYS, DEFAULT_WIDGET, DEFAULT_OVERLAY,
  getBaseDir, getSettingsPath, loadSettings, saveSettings,
};
