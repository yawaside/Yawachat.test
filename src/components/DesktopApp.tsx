import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban, Gamepad2, Info, Keyboard, LayoutList, Minus,
  Monitor, Palette, Settings, SlidersHorizontal, Square, Volume2, X,
} from "lucide-react";
import { GithubIcon } from "./brands";
import ChatPanel from "./app/ChatPanel";
import VoicePanel from "./app/VoicePanel";
import FiltersPanel from "./app/FiltersPanel";
import ChatViewPanel from "./app/ChatViewPanel";
import WidgetPanel from "./app/WidgetPanel";
import OverlayPanel from "./app/OverlayPanel";
import HotkeysPanel from "./app/HotkeysPanel";
import { AutoSave, Toggle } from "./app/ui";
import {
  getSp, isDesktop, useChatSource, useHotkeys, usePersisted, useSetting,
  useWidgetInfo, useWindowMaximized,
} from "../lib/bridge";
import type { Channel } from "../lib/bridge";
import { useSpeechEngine } from "../lib/core";
import type { ChatMsg } from "../lib/core";
import { DEFAULT_TTS, sanitizeTts } from "../lib/tts-config";
import type { TtsConfig } from "../lib/tts-config";
import {
  DEFAULT_CHAT_VIEW, DEFAULT_HOTKEYS, DEFAULT_OVERLAY, DEFAULT_WIDGET, buildWidgetUrl,
} from "../lib/widget";
import type { ChatViewConfig, OverlayConfig, WidgetConfig } from "../lib/widget";
import { APP_NAME, APP_TAG, APP_VERSION } from "../version";

const MAX_FEED = 300;
const REPO_URL = "https://github.com/yawaside/Yawachat.test";

/* ---------- темы интерфейса ---------- */

interface UiTheme {
  id: string;
  label: string;
  icon: typeof Palette;
  light?: boolean;
  vars: Record<string, string>;
}

const UI_THEMES: UiTheme[] = [
  {
    id: "midnight", label: "Midnight", icon: Monitor,
    vars: {
      "--dw-bg": "#0a0b13", "--dw-panel": "#10121d", "--dw-panel2": "#161929",
      "--dw-line": "rgba(255,255,255,0.08)", "--dw-text": "#eceef6", "--dw-dim": "#8b91a8",
      "--dw-hover": "rgba(255,255,255,0.05)", "--dw-input": "rgba(255,255,255,0.06)",
      "--dw-scroll": "rgba(255,255,255,0.16)", "--range-rest": "rgba(255,255,255,0.14)",
    },
  },
  {
    id: "light", label: "Light", icon: Palette, light: true,
    vars: {
      "--dw-bg": "#eef0f6", "--dw-panel": "#ffffff", "--dw-panel2": "#f1f3f9",
      "--dw-line": "rgba(15,18,35,0.10)", "--dw-text": "#191c2b", "--dw-dim": "#626a82",
      "--dw-hover": "rgba(15,18,35,0.05)", "--dw-input": "rgba(15,18,35,0.06)",
      "--dw-scroll": "rgba(15,18,35,0.22)", "--range-rest": "rgba(15,18,35,0.14)",
    },
  },
  {
    id: "violet", label: "Violet", icon: Palette,
    vars: {
      "--dw-bg": "#120b21", "--dw-panel": "#1b1130", "--dw-panel2": "#241640",
      "--dw-line": "rgba(167,139,250,0.18)", "--dw-text": "#f2ecff", "--dw-dim": "#a394c9",
      "--dw-hover": "rgba(167,139,250,0.10)", "--dw-input": "rgba(167,139,250,0.10)",
      "--dw-scroll": "rgba(167,139,250,0.35)", "--range-rest": "rgba(167,139,250,0.22)",
    },
  },
  {
    id: "amoled", label: "AMOLED", icon: Monitor,
    vars: {
      "--dw-bg": "#000000", "--dw-panel": "#0b0b0f", "--dw-panel2": "#141419",
      "--dw-line": "rgba(255,255,255,0.10)", "--dw-text": "#f3f4f6", "--dw-dim": "#8a8f9c",
      "--dw-hover": "rgba(255,255,255,0.06)", "--dw-input": "rgba(255,255,255,0.07)",
      "--dw-scroll": "rgba(255,255,255,0.2)", "--range-rest": "rgba(255,255,255,0.16)",
    },
  },
  {
    id: "ocean", label: "Ocean", icon: Monitor,
    vars: {
      "--dw-bg": "#06121c", "--dw-panel": "#0c1b28", "--dw-panel2": "#123044",
      "--dw-line": "rgba(34,211,238,0.18)", "--dw-text": "#e6fbff", "--dw-dim": "#7fa6b8",
      "--dw-hover": "rgba(34,211,238,0.08)", "--dw-input": "rgba(34,211,238,0.10)",
      "--dw-scroll": "rgba(34,211,238,0.32)", "--range-rest": "rgba(34,211,238,0.20)",
    },
  },
  {
    id: "cyber", label: "Cyber", icon: Palette,
    vars: {
      "--dw-bg": "#0b0616", "--dw-panel": "#150a26", "--dw-panel2": "#20103a",
      "--dw-line": "rgba(255,46,166,0.18)", "--dw-text": "#ffe9f7", "--dw-dim": "#b48bc0",
      "--dw-hover": "rgba(255,46,166,0.10)", "--dw-input": "rgba(255,46,166,0.10)",
      "--dw-scroll": "rgba(255,46,166,0.32)", "--range-rest": "rgba(255,46,166,0.20)",
    },
  },
];

/* ---------- вкладки настроек ---------- */

type TabId = "voice" | "filters" | "chatview" | "widget" | "overlay" | "hotkeys" | "interface" | "about";

const SETTINGS_TABS: Array<{ id: TabId; label: string; icon: typeof Palette }> = [
  { id: "voice", label: "Озвучка", icon: Volume2 },
  { id: "filters", label: "Фильтры", icon: Ban },
  { id: "chatview", label: "Лента", icon: LayoutList },
  { id: "widget", label: "Виджет OBS", icon: SlidersHorizontal },
  { id: "overlay", label: "Оверлей", icon: Gamepad2 },
  { id: "hotkeys", label: "Горячие клавиши", icon: Keyboard },
  { id: "interface", label: "Интерфейс", icon: Palette },
  { id: "about", label: "О программе", icon: Info },
];

export default function DesktopApp() {
  const sp = getSp();
  const desktop = isDesktop();

  const [feed, setFeed] = useState<ChatMsg[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<TabId>("voice");

  /* ---------- уведомления ---------- */
  const [toastText, setToastText] = useState("");
  const toastTimer = useRef(0);
  const toast = useCallback((t: string) => {
    setToastText(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(""), 2400);
  }, []);

  /* ---------- настройки: сохраняются мгновенно, без кнопки «Сохранить» ---------- */
  const [tts, setTts] = usePersisted<TtsConfig>("tts", DEFAULT_TTS);
  const [chatView, setChatView] = usePersisted<ChatViewConfig>("chatView", DEFAULT_CHAT_VIEW);
  const [widgetCfg, setWidgetCfg] = usePersisted<WidgetConfig>("widget", DEFAULT_WIDGET);
  const [hotkeys, setHotkeys] = usePersisted<Record<string, string>>("hotkeys", DEFAULT_HOTKEYS);
  const [theme, setTheme] = useSetting<string>("theme", "midnight");

  /* FIX: «Сворачивать в трей при закрытии» — реальная настройка, а не заглушка */
  const [closeToTray, setCloseToTray] = useSetting<boolean>("closeToTray", true);
  const [minimizeToTray, setMinimizeToTray] = useSetting<boolean>("minimizeToTray", false);
  const [startHidden, setStartHidden] = useSetting<boolean>("startHidden", false);

  const [savedAt, setSavedAt] = useState(0);
  const savedTimer = useRef(0);
  const markSaved = useCallback(
    (label?: string) => {
      setSavedAt(Date.now());
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedAt(0), 1900);
      if (label) toast(label);
    },
    [toast]
  );

  const ttsSafe = useMemo(() => sanitizeTts(tts), [tts]);
  const patchTts = useCallback(
    (patch: Partial<TtsConfig>) => {
      setTts({ ...sanitizeTts(tts), ...patch });
      markSaved();
    },
    [tts, setTts, markSaved]
  );

  const patchChatView = useCallback(
    (c: ChatViewConfig) => {
      setChatView(c);
      markSaved();
    },
    [setChatView, markSaved]
  );

  const patchWidget = useCallback(
    (c: WidgetConfig) => {
      setWidgetCfg(c);
      markSaved();
    },
    [setWidgetCfg, markSaved]
  );

  const patchHotkeys = useCallback(
    (map: Record<string, string>) => {
      setHotkeys(map);
      sp?.hotkeys.apply(map);
      markSaved();
    },
    [setHotkeys, sp, markSaved]
  );

  /* ---------- оверлей: живёт в settings.json через отдельный IPC-канал ---------- */
  const [overlay, setOverlayState] = useState<OverlayConfig>(DEFAULT_OVERLAY);
  useEffect(() => {
    if (!sp) {
      try {
        const raw = localStorage.getItem("yawa:overlay");
        if (raw) setOverlayState({ ...DEFAULT_OVERLAY, ...JSON.parse(raw) });
      } catch { /* noop */ }
      return;
    }
    sp.overlay.get().then((o) => o && setOverlayState({ ...DEFAULT_OVERLAY, ...o }));
    sp.overlay.onChange((o) => setOverlayState({ ...DEFAULT_OVERLAY, ...o }));
  }, [sp]);

  const patchOverlay = useCallback(
    (patch: Partial<OverlayConfig>) => {
      setOverlayState((cur) => {
        const next = { ...cur, ...patch };
        if (sp) sp.overlay.set(patch);
        else {
          try {
            localStorage.setItem("yawa:overlay", JSON.stringify(next));
          } catch { /* noop */ }
        }
        return next;
      });
      markSaved();
    },
    [sp, markSaved]
  );

  /* ---------- тема интерфейса ---------- */
  const activeTheme = useMemo(() => UI_THEMES.find((t) => t.id === theme) ?? UI_THEMES[0], [theme]);

  /* ---------- окно ---------- */
  const maximized = useWindowMaximized();
  const widgetInfo = useWidgetInfo();
  const widgetUrl = useMemo(
    () => buildWidgetUrl(widgetCfg, widgetInfo.port, widgetInfo.token),
    [widgetCfg, widgetInfo.port, widgetInfo.token]
  );

  /* ---------- чат и озвучка ---------- */
  const speech = useSpeechEngine();
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const push = useCallback((m: ChatMsg) => {
    setFeed((prev) => (prev.length > MAX_FEED ? [...prev.slice(-MAX_FEED), m] : [...prev, m]));
    /* служебных событий (подключение/ошибка канала) в озвучку не отправляем —
       читаем только реальные сообщения чата */
    if (!m.sys) speechRef.current.enqueue(m);
  }, []);

  const { channels, addChannel, removeChannel } = useChatSource(push);

  /* применение сохранённых настроек озвучки к движку (и наоборот — мгновенное сохранение) */
  useEffect(() => {
    speech.setRate(ttsSafe.rate);
    speech.setVolume(ttsSafe.volume);
    speech.setTemplate(ttsSafe.template);
    speech.setFilters(ttsSafe.filters);
    if (ttsSafe.voiceURI) speech.setVoiceURI(ttsSafe.voiceURI);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSafe]);

  /* восстановление включённой озвучки после загрузки голосов */
  useEffect(() => {
    if (!ttsSafe.enabled) return;
    const t = window.setTimeout(() => speech.setEnabled(true), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTts = useCallback(() => {
    const next = !ttsSafe.enabled;
    patchTts({ enabled: next });
    speech.setEnabled(next);
    toast(next ? "Озвучка включена" : "Озвучка выключена");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSafe.enabled, patchTts, toast]);

  const clearFeed = useCallback(() => {
    setFeed([]);
    toast("Лента очищена");
  }, [toast]);

  useHotkeys({
    "tts:toggle": toggleTts,
    "tts:pause": () => speechRef.current.setPaused(!speechRef.current.paused),
    "tts:skip": () => speechRef.current.skip(),
    "tts:clear": () => {
      speechRef.current.clearQueue();
      toast("Очередь очищена");
    },
    "feed:clear": clearFeed,
  });

  /* ---------- интерфейс ---------- */
  const onlineCount = channels.filter((c) => c.status === "online").length;

  return (
    <div
      className="dw flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit]"
      style={{ ...(activeTheme.vars as React.CSSProperties) }}
    >
      {/* ================= шапка окна ================= */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{
          borderColor: "var(--dw-line)",
          background: "var(--dw-panel)",
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        <div className="min-w-0">
          <div className="text-[14px] font-semibold tracking-tight">
            {settingsOpen ? "Настройки" : "Лента чата"}
          </div>
          <div
            className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px]"
            style={{ color: "var(--dw-dim)" }}
          >
            <span>
              YawaChatHub v{APP_VERSION}
            </span>
            <span>·</span>
            <span>portable</span>
            <span>·</span>
            <span>{desktop ? "desktop" : "предпросмотр в браузере"}</span>
            {speech.enabled && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1" style={{ color: "#a78bfa" }}>
                  <Volume2 size={10} /> озвучка
                </span>
              </>
            )}
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">
              каналов {channels.length} · в эфире {onlineCount}
            </span>
          </div>
        </div>

        <div
          className="ml-auto flex items-center gap-1.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <AutoSave stamp={savedAt} />
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title={settingsOpen ? "Закрыть настройки" : "Настройки"}
            className="grid h-9 w-9 place-items-center rounded-xl border transition-colors hover:border-viol"
            style={{
              borderColor: settingsOpen ? "#8b5cf6" : "var(--dw-line)",
              background: settingsOpen ? "#8b5cf61a" : "var(--dw-input)",
              color: settingsOpen ? "#a78bfa" : "var(--dw-dim)",
            }}
          >
            {settingsOpen ? <X size={15} /> : <Settings size={15} />}
          </button>
          {desktop && (
            <>
              <button
                type="button"
                onClick={() => sp?.window.minimize()}
                title={minimizeToTray ? "Свернуть в трей" : "Свернуть"}
                className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--dw-hover)]"
                style={{ color: "var(--dw-dim)" }}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={() => sp?.window.toggleMaximize()}
                title="Во весь экран"
                className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--dw-hover)]"
                style={{ color: "var(--dw-dim)" }}
              >
                <Square size={11} strokeWidth={maximized ? 3 : 2} />
              </button>
              <button
                type="button"
                onClick={() => sp?.window.close()}
                title={closeToTray ? "Свернуть в трей" : "Закрыть приложение"}
                className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[rgba(248,113,113,0.18)]"
                style={{ color: "var(--dw-dim)" }}
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ================= тело ================= */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatPanel
          feed={feed}
          channels={channels}
          speech={speech}
          viewCfg={chatView}
          onClear={clearFeed}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
          toast={toast}
        />

        <AnimatePresence>
          {settingsOpen && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 14 }}
              transition={{ duration: 0.22, ease: [0.22, 0.36, 0, 1] }}
              className="absolute inset-0 z-30 flex min-w-0 flex-col overflow-hidden sm:flex-row"
              style={{ background: "var(--dw-bg)", borderTop: "1px solid var(--dw-line)" }}
            >
              {/* список вкладок */}
              <div
                className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-[210px] sm:flex-col sm:border-b-0 sm:border-r"
                style={{ borderColor: "var(--dw-line)" }}
              >
                <span
                  className="hidden items-center gap-2 px-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] sm:flex"
                  style={{ color: "var(--dw-dim)" }}
                >
                  <Settings size={11} /> Настройки
                </span>
                {SETTINGS_TABS.map((t) => {
                  const on = settingsTab === t.id;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSettingsTab(t.id)}
                      className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors"
                      style={{
                        background: on ? "#8b5cf61f" : "transparent",
                        color: on ? "#a78bfa" : "var(--dw-dim)",
                      }}
                    >
                      <Icon size={13} /> {t.label}
                    </button>
                  );
                })}
                <div className="mt-auto hidden px-2 pb-1 font-mono text-[9.5px] sm:block" style={{ color: "var(--dw-dim)" }}>
                  {APP_NAME} {APP_TAG}
                  <br />
                  настройки сохраняются сразу
                </div>
              </div>

              {/* содержимое вкладки */}
              <div className="scroll-thin min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold">
                    {SETTINGS_TABS.find((t) => t.id === settingsTab)?.label}
                  </span>
                  <AutoSave stamp={savedAt} />
                </div>

                {settingsTab === "voice" && (
                  <VoicePanel speech={speech} cfg={ttsSafe} onChange={patchTts} toast={toast} />
                )}
                {settingsTab === "filters" && (
                  <FiltersPanel cfg={ttsSafe} onChange={patchTts} toast={toast} />
                )}
                {settingsTab === "chatview" && (
                  <ChatViewPanel cfg={chatView} onChange={patchChatView} />
                )}
                {settingsTab === "widget" && (
                  <WidgetPanel
                    cfg={widgetCfg}
                    onChange={patchWidget}
                    url={widgetUrl}
                    clients={widgetInfo.clients}
                    toast={toast}
                  />
                )}
                {settingsTab === "overlay" && (
                  <OverlayPanel cfg={overlay} onChange={patchOverlay} desktop={desktop} />
                )}
                {settingsTab === "hotkeys" && (
                  <HotkeysPanel hotkeys={hotkeys} onChange={patchHotkeys} desktop={desktop} toast={toast} />
                )}

                {settingsTab === "interface" && (
                  <div className="mx-auto max-w-4xl space-y-4">
                    <div
                      className="rounded-2xl border p-4"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <h3 className="text-[13px] font-semibold">Тема интерфейса</h3>
                      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                        Применяется мгновенно и запоминается в settings.json.
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {UI_THEMES.map((th) => {
                          const on = activeTheme.id === th.id;
                          const Icon = th.icon;
                          return (
                            <button
                              key={th.id}
                              onClick={() => {
                                setTheme(th.id);
                                markSaved(`Тема: ${th.label}`);
                              }}
                              className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] transition-all"
                              style={{
                                borderColor: on ? "#8b5cf6" : "var(--dw-line)",
                                background: on ? "#8b5cf614" : "var(--dw-panel2)",
                                color: on ? "#a78bfa" : "var(--dw-text)",
                              }}
                            >
                              <Icon size={13} /> {th.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      className="rounded-2xl border p-4"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <h3 className="text-[13px] font-semibold">Поведение окна</h3>
                      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                        Переключатели работают сразу — перезапуск не требуется.
                      </p>
                      <div className="mt-2 space-y-1">
                        <Toggle
                          label="Сворачивать в трей при закрытии"
                          hint={
                            desktop
                              ? "крестик прячет окно в трей; выключено — приложение завершается"
                              : "настройка применится в desktop-сборке (settings.json → closeToTray)"
                          }
                          on={closeToTray}
                          onChange={(v) => {
                            setCloseToTray(v);
                            markSaved(v ? "Закрытие: сворачивать в трей" : "Закрытие: выход из приложения");
                          }}
                        />
                        <Toggle
                          label="Сворачивать в трей кнопкой «минус»"
                          hint="обычное поведение — свернуть на панель задач"
                          on={minimizeToTray}
                          onChange={(v) => {
                            setMinimizeToTray(v);
                            markSaved();
                          }}
                        />
                        <Toggle
                          label="Запускать свёрнутым в трей"
                          hint="окно не появляется при старте — открыть можно из трея"
                          on={startHidden}
                          onChange={(v) => {
                            setStartHidden(v);
                            markSaved();
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === "about" && (
                  <div className="mx-auto max-w-2xl space-y-4">
                    <div
                      className="rounded-2xl border p-5"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <div className="flex items-center gap-3">
                        <h3 className="font-display text-lg font-bold">{APP_NAME}</h3>
                        <p className="font-mono text-[11px]" style={{ color: "var(--dw-dim)" }}>
                          v{APP_VERSION} · portable x64 + installer · MIT
                        </p>
                      </div>
                      <p className="mt-4 text-[12.5px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>
                        Единая лента сообщений Twitch, YouTube Live, VK Play Live, Kick и TikTok Live с озвучкой,
                        виджетом для OBS и игровым оверлеем. Все настройки сохраняются автоматически — кнопок
                        «Сохранить» в интерфейсе больше нет.
                      </p>
                      <div className="mt-4 grid gap-2 font-mono text-[11px]" style={{ color: "var(--dw-dim)" }}>
                        <div>версия: {APP_VERSION}</div>
                        <div>тег релиза: {APP_TAG}</div>
                        <div>сборка: portable exe + NSIS installer (x64)</div>
                        <div>режим: {desktop ? "приложение (Electron)" : "демо в браузере"}</div>
                      </div>
                      <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-[12px] font-semibold transition-colors hover:border-viol"
                        style={{ borderColor: "var(--dw-line)" }}
                      >
        <GithubIcon size={14} /> Репозиторий проекта
      </a>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ================= уведомление ================= */}
      <AnimatePresence>
        {toastText && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-[12px] font-medium shadow-2xl"
            style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)", color: "var(--dw-text)" }}
          >
            {toastText}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type { Channel };
