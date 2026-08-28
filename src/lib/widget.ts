/* Конфигурация OBS-виджета и оверлея — общая для приложения и сайта. */

export interface WidgetTheme {
  id: string;
  label: string;
  /** цвет подложки в rgb — альфа задаётся отдельно (прозрачность только фона) */
  bgRgb: string;
  text: string;
  name: string;
  sub: string;
  border: string;
  shadow: string;
  swatch: [string, string, string];
  bar?: string;
}

export const WIDGET_THEMES: WidgetTheme[] = [
  {
    id: "minimal-dark",
    label: "Minimal Dark",
    bgRgb: "10, 11, 18",
    text: "#f2f3f8",
    name: "#a78bfa",
    sub: "rgba(242,243,248,0.45)",
    border: "rgba(255,255,255,0.10)",
    shadow: "0 2px 14px rgba(0,0,0,0.35)",
    swatch: ["#0e0f18", "#a78bfa", "#f2f3f8"],
  },
  {
    id: "minimal-light",
    label: "Minimal Light",
    bgRgb: "248, 249, 252",
    text: "#171a26",
    name: "#7c3aed",
    sub: "rgba(23,26,38,0.5)",
    border: "rgba(23,26,38,0.10)",
    shadow: "0 2px 14px rgba(23,26,38,0.14)",
    swatch: ["#f8f9fc", "#7c3aed", "#171a26"],
  },
  {
    id: "neon",
    label: "Neon Stream",
    bgRgb: "6, 8, 16",
    text: "#e8fdff",
    name: "#22d3ee",
    sub: "rgba(232,253,255,0.5)",
    border: "rgba(34,211,238,0.35)",
    shadow: "0 0 18px rgba(34,211,238,0.28)",
    swatch: ["#060810", "#22d3ee", "#ff2ea6"],
    bar: "linear-gradient(90deg,#22d3ee,#ff2ea6)",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    bgRgb: "5, 6, 12",
    text: "#f5f7fb",
    name: "#c4b5fd",
    sub: "rgba(245,247,251,0.42)",
    border: "rgba(167,139,250,0.22)",
    shadow: "0 10px 34px rgba(0,0,0,0.42)",
    swatch: ["#05060c", "#6d28d9", "#e5e7eb"],
  },
  {
    id: "terminal",
    label: "Terminal",
    bgRgb: "2, 10, 8",
    text: "#d1fae5",
    name: "#34d399",
    sub: "rgba(209,250,229,0.45)",
    border: "rgba(52,211,153,0.26)",
    shadow: "0 0 18px rgba(52,211,153,0.16)",
    swatch: ["#020a08", "#34d399", "#d1fae5"],
    bar: "linear-gradient(180deg,#34d399,#22c55e)",
  },
  {
    id: "sunset",
    label: "Sunset",
    bgRgb: "24, 10, 20",
    text: "#fff7ed",
    name: "#fb923c",
    sub: "rgba(255,247,237,0.45)",
    border: "rgba(251,146,60,0.25)",
    shadow: "0 8px 28px rgba(251,113,133,0.18)",
    swatch: ["#180a14", "#fb923c", "#f472b6"],
    bar: "linear-gradient(180deg,#fb923c,#f472b6)",
  },
  {
    id: "frost",
    label: "Frost Glass",
    bgRgb: "226, 239, 255",
    text: "#0f172a",
    name: "#2563eb",
    sub: "rgba(15,23,42,0.45)",
    border: "rgba(37,99,235,0.20)",
    shadow: "0 8px 28px rgba(15,23,42,0.12)",
    swatch: ["#e2efff", "#2563eb", "#0f172a"],
  },
  {
    id: "amoled",
    label: "AMOLED",
    bgRgb: "0, 0, 0",
    text: "#f3f4f6",
    name: "#a78bfa",
    sub: "rgba(243,244,246,0.45)",
    border: "rgba(255,255,255,0.14)",
    shadow: "0 0 0 rgba(0,0,0,0)",
    swatch: ["#000000", "#a78bfa", "#f3f4f6"],
  },
  {
    id: "latte",
    label: "Latte",
    bgRgb: "252, 247, 240",
    text: "#3f3a37",
    name: "#b45309",
    sub: "rgba(63,58,55,0.45)",
    border: "rgba(180,83,9,0.2)",
    shadow: "0 8px 24px rgba(63,58,55,0.14)",
    swatch: ["#fcf7f0", "#b45309", "#3f3a37"],
  },
];

export interface WidgetConfig {
  theme: string;
  fontSize: number;
  /** прозрачность ПОДЛОЖКИ, 0..100 (текст всегда непрозрачный) */
  bgOpacity: number;
  radius: number;
  duration: number;
  dir: "up" | "down";
  shadow: boolean;
  showPlatform: boolean;
  showTime: boolean;
  maxMessages: number;
}

export const DEFAULT_WIDGET: WidgetConfig = {
  theme: "minimal-dark",
  fontSize: 16,
  bgOpacity: 70,
  radius: 12,
  duration: 8,
  dir: "up",
  shadow: true,
  showPlatform: true,
  showTime: true,
  maxMessages: 8,
};

export function getTheme(id: string): WidgetTheme {
  return WIDGET_THEMES.find((t) => t.id === id) ?? WIDGET_THEMES[0];
}

/** rgba подложки: альфа применяется ТОЛЬКО к фону */
export function themeBg(theme: WidgetTheme, opacity: number): string {
  return `rgba(${theme.bgRgb}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

export function buildWidgetUrl(cfg: WidgetConfig, port: number, token: string): string {
  const q = new URLSearchParams({
    token,
    port: String(port),
    theme: cfg.theme,
    fs: String(cfg.fontSize),
    bg: String(cfg.bgOpacity),
    r: String(cfg.radius),
    ttl: String(cfg.duration),
    dir: cfg.dir,
    shadow: cfg.shadow ? "1" : "0",
    plat: cfg.showPlatform ? "1" : "0",
    time: cfg.showTime ? "1" : "0",
    max: String(cfg.maxMessages),
  });
  return `http://127.0.0.1:${port}/widget?${q.toString()}`;
}

/* ---------- оверлей ---------- */

export interface OverlayConfig {
  enabled: boolean;
  /** прозрачность ПОДЛОЖКИ окна оверлея */
  bgOpacity: number;
  clickThrough: boolean;
  mode: "compact" | "widget";
  fontSize: number;
  maxMessages: number;
  locked: boolean;
}

export const DEFAULT_OVERLAY: OverlayConfig = {
  enabled: false,
  bgOpacity: 55,
  clickThrough: false,
  mode: "compact",
  fontSize: 12,
  maxMessages: 6,
  locked: false,
};

/* ---------- вид ленты чата ---------- */

export interface ChatViewConfig {
  style: "classic" | "minimal" | "glass" | "flat";
  fontSize: number;
  rowGap: number;
  radius: number;
  showPlatform: boolean;
  showTime: boolean;
  showBadges: boolean;
}

export const DEFAULT_CHAT_VIEW: ChatViewConfig = {
  style: "classic",
  fontSize: 15,
  rowGap: 6,
  radius: 16,
  showPlatform: true,
  showTime: true,
  showBadges: true,
};

/* ---------- горячие клавиши (дефолты зеркалят desktop/electron/settings.js) ---------- */

export const DEFAULT_HOTKEYS: Record<string, string> = {
  "overlay:toggle": "Control+Shift+G",
  "overlay:clicks": "Control+Shift+C",
  "tts:toggle": "Control+Shift+T",
  "tts:pause": "Control+Shift+P",
  "tts:skip": "Control+Shift+S",
  "tts:clear": "Control+Shift+Q",
  "window:toggle": "Control+Shift+H",
  "feed:clear": "Control+Shift+L",
};

export interface HotkeyMeta {
  id: string;
  label: string;
  group: string;
}

export const HOTKEY_META: HotkeyMeta[] = [
  { id: "tts:toggle", label: "Озвучка вкл / выкл", group: "Озвучка" },
  { id: "tts:pause", label: "Пауза / продолжить", group: "Озвучка" },
  { id: "tts:skip", label: "Пропустить текущее", group: "Озвучка" },
  { id: "tts:clear", label: "Очистить очередь", group: "Озвучка" },
  { id: "overlay:toggle", label: "Игровой оверлей вкл / выкл", group: "Оверлей" },
  { id: "overlay:clicks", label: "Сквозные клики оверлея", group: "Оверлей" },
  { id: "window:toggle", label: "Скрыть / показать окно", group: "Окно" },
  { id: "feed:clear", label: "Очистить ленту", group: "Окно" },
];
