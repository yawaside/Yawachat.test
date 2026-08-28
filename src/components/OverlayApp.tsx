import { useEffect, useMemo, useState } from "react";
import { getSp } from "../lib/bridge";
import type { ChatMsg } from "../lib/core";
import { fmtTime } from "../lib/core";
import { DEFAULT_OVERLAY, getTheme, themeBg } from "../lib/widget";
import type { OverlayConfig } from "../lib/widget";
import { PlatformChip } from "./bits";

/**
 * Игровой оверлей: прозрачное окно поверх игры.
 *
 * FIX(2.0.1):
 *  - окно было чёрным квадратом: глобальный CSS (`body { background: var(--color-void) }`
 *    и зернистая плёнка `body::after`) закрашивал прозрачное окно Electron.
 *    Теперь в режиме оверлея на <html> вешается класс `overlay-mode`, который делает
 *    страницу полностью прозрачной.
 *  - окно нельзя было двигать: не было области перетаскивания.
 *    Добавлена шапка с `-webkit-app-region: drag` (и вся подложка тоже тянется,
 *    пока позиция не зафиксирована и выключены сквозные клики).
 *  - настройки не применялись: подписка на `sp.overlay.onChange` теперь ставится один раз
 *    и синхронизирует конфиг мгновенно.
 */
export default function OverlayApp() {
  const sp = getSp();
  const [cfg, setCfg] = useState<OverlayConfig>(DEFAULT_OVERLAY);
  const [feed, setFeed] = useState<ChatMsg[]>([]);
  const [hover, setHover] = useState(false);

  /* прозрачный фон страницы только для оверлея */
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    return () => document.documentElement.classList.remove("overlay-mode");
  }, []);

  useEffect(() => {
    if (!sp) {
      // предпросмотр в браузере — показываем пару демо-строк
      try {
        const raw = localStorage.getItem("yawa:overlay");
        if (raw) setCfg({ ...DEFAULT_OVERLAY, ...JSON.parse(raw) });
      } catch { /* noop */ }
      return;
    }
    sp.onChat((m) => setFeed((prev) => [...prev.slice(-60), m]));
    sp.overlay.get().then((o) => o && setCfg({ ...DEFAULT_OVERLAY, ...o }));
    sp.overlay.onChange((o) => setCfg((cur) => ({ ...cur, ...DEFAULT_OVERLAY, ...o })));
  }, [sp]);

  const theme = useMemo(() => getTheme("minimal-dark"), []);
  const shown = feed.filter((m) => !m.sys).slice(-cfg.maxMessages);

  /* окно можно тащить, только когда клики не сквозные и позиция не зафиксирована */
  const draggable = !cfg.clickThrough && !cfg.locked;
  const dragStyle = (on: boolean) =>
    ({ WebkitAppRegion: on ? "drag" : "no-drag" }) as React.CSSProperties;

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{
        background: themeBg(theme, cfg.bgOpacity),
        borderRadius: 14,
        border: `1px solid ${hover && draggable ? "rgba(139,92,246,0.55)" : "rgba(255,255,255,0.10)"}`,
        fontFamily: "Onest, system-ui, sans-serif",
        pointerEvents: cfg.clickThrough ? "none" : "auto",
        transition: "border-color 0.2s",
        ...dragStyle(draggable),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* шапка-ручка для перетаскивания */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-1.5"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          ...dragStyle(draggable),
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "#8b5cf6", boxShadow: "0 0 8px rgba(139,92,246,0.7)" }}
        />
        <span
          className="font-mono text-[9px] uppercase tracking-[0.18em]"
          style={{ color: theme.sub }}
        >
          YawaChatHub
        </span>
        <span className="ml-auto font-mono text-[9px]" style={{ color: theme.sub }}>
          {cfg.clickThrough
            ? "клики насквозь"
            : cfg.locked
            ? "закреплён"
            : hover
            ? "тяните за шапку"
            : `${shown.length}/${cfg.maxMessages}`}
        </span>
      </div>

      {/* лента */}
      <div
        className="scroll-thin flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-y-auto p-3"
        style={dragStyle(false)}
      >
        {shown.length === 0 && (
          <p className="text-[11px] leading-snug" style={{ color: theme.sub }}>
            Оверлей активен — жду сообщения из чата…
            <br />
            <span className="font-mono text-[9.5px]">Ctrl+Shift+G — скрыть</span>
          </p>
        )}

        {shown.map((m) =>
          cfg.mode === "widget" ? (
            <div
              key={m.id}
              className="rounded-lg border px-2.5 py-1.5"
              style={{
                borderColor: "rgba(255,255,255,0.09)",
                background: "rgba(0,0,0,0.22)",
              }}
            >
              <div className="flex items-start gap-2">
                <PlatformChip id={m.platform} />
                <div className="min-w-0">
                  <span className="mr-1.5 font-bold" style={{ color: m.color, fontSize: cfg.fontSize }}>
                    {m.author}
                  </span>
                  <span className="break-words" style={{ color: theme.text, fontSize: cfg.fontSize }}>
                    {m.text}
                  </span>
                </div>
                <span className="ml-auto shrink-0 font-mono text-[9px]" style={{ color: theme.sub }}>
                  {fmtTime(m.ts)}
                </span>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex items-start gap-2">
              <PlatformChip id={m.platform} />
              <p className="min-w-0 break-words leading-snug" style={{ fontSize: cfg.fontSize }}>
                <span className="mr-1.5 font-bold" style={{ color: m.color }}>
                  {m.author}
                </span>
                <span style={{ color: theme.text }}>{m.text}</span>
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
