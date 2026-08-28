import { useEffect, useMemo, useState } from "react";
import { getSp } from "../lib/bridge";
import type { ChatMsg } from "../lib/core";
import { fmtTime } from "../lib/core";
import { DEFAULT_OVERLAY, getTheme, themeBg } from "../lib/widget";
import type { OverlayConfig } from "../lib/widget";
import { PlatformChip } from "./bits";

/**
 * Игровой оверлей: прозрачная компактная лента поверх игры.
 * Рендерится в отдельном always-on-top окне Electron (#/overlay).
 */
export default function OverlayApp() {
  const sp = getSp();
  const [cfg, setCfg] = useState<OverlayConfig>(DEFAULT_OVERLAY);
  const [feed, setFeed] = useState<ChatMsg[]>([]);

  useEffect(() => {
    if (!sp) return;
    sp.onChat((m) => setFeed((prev) => [...prev.slice(-40), m]));
    sp.overlay.get().then((o) => o && setCfg({ ...DEFAULT_OVERLAY, ...o }));
    sp.overlay.onChange((o) => setCfg({ ...DEFAULT_OVERLAY, ...o }));
  }, [sp]);

  const theme = useMemo(() => getTheme("minimal-dark"), []);
  const shown = feed.filter((m) => !m.sys).slice(-cfg.maxMessages);

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      style={{
        background: themeBg(theme, cfg.bgOpacity),
        borderRadius: 12,
        fontFamily: "Onest, system-ui, sans-serif",
        pointerEvents: cfg.clickThrough ? "none" : "auto",
      }}
    >
      <div className="flex h-full flex-col justify-end gap-1 p-3">
        {shown.length === 0 && (
          <p className="text-[11px]" style={{ color: theme.sub }}>
            оверлей активен — жду сообщения…
          </p>
        )}
        {shown.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            {cfg.mode === "compact" && <PlatformChip id={m.platform} />}
            <div className="min-w-0">
              <span className="mr-1.5 font-bold" style={{ color: theme.name, fontSize: cfg.fontSize }}>
                {m.author}
              </span>
              <span className="break-words" style={{ color: theme.text, fontSize: cfg.fontSize }}>
                {m.text}
              </span>
            </div>
            {cfg.mode === "widget" && (
              <span className="ml-auto shrink-0 font-mono text-[9px]" style={{ color: theme.sub }}>
                {fmtTime(m.ts)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
