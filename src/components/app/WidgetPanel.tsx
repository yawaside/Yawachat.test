import { useMemo, useState } from "react";
import { Check, Copy, Link2, Radio, Send } from "lucide-react";
import { getSp } from "../../lib/bridge";
import { makeMessage } from "../../lib/core";
import { getTheme, themeBg, WIDGET_THEMES } from "../../lib/widget";
import type { WidgetConfig } from "../../lib/widget";
import { PlatformChip } from "../bits";
import { Btn, Label, Panel, Segmented, Slider, Toggle } from "./ui";

export default function WidgetPanel({
  cfg, onChange, url, clients, toast,
}: {
  cfg: WidgetConfig;
  onChange: (c: WidgetConfig) => void;
  url: string;
  clients: number;
  toast: (t: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const theme = getTheme(cfg.theme);
  const set = (patch: Partial<WidgetConfig>) => onChange({ ...cfg, ...patch });

  /* стабильный демо-набор, чтобы превью не «прыгало» при каждом рендере */
  const demo = useMemo(
    () => [
      { ...makeMessage("twitch"), author: "neon_wolf", text: "ЛЕЕЕЕТС ГОООУ", color: "#a78bfa" },
      { ...makeMessage("youtube"), author: "mila_lav", text: "привет из чата, как настроение?", color: "#f472b6" },
      { ...makeMessage("kick"), author: "wisp_gg", text: "какой трек сейчас играет?", color: "#69db7c" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.theme, cfg.fontSize, cfg.radius]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Ссылка скопирована — вставьте её в OBS");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Не удалось скопировать — скопируйте вручную");
    }
  };

  const sendTest = () => {
    const sp = getSp();
    const msg = { ...makeMessage("tiktok"), text: "Тестовое сообщение из YawaChatHub" };
    if (sp) {
      sp.widgetTest(msg);
      toast("Тестовое сообщение отправлено в виджет");
    } else {
      toast("В браузере сервер виджета не запущен — работает в desktop-версии");
    }
  };

  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
      <div className="space-y-4">
        <Panel title="Тема" desc="Готовые пресеты оформления плашек.">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {WIDGET_THEMES.map((th) => {
              const on = cfg.theme === th.id;
              return (
                <button
                  key={th.id}
                  onClick={() => set({ theme: th.id })}
                  className="rounded-xl border p-2.5 text-left transition-all"
                  style={{
                    borderColor: on ? "#8b5cf6" : "var(--dw-line)",
                    background: on ? "#8b5cf612" : "transparent",
                  }}
                >
                  <span
                    className="flex h-8 items-center justify-center gap-1 rounded-lg"
                    style={{ background: th.swatch[0] }}
                  >
                    {th.swatch.map((c, i) => (
                      <span key={i} className="h-3 w-3 rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                  <span
                    className="mt-1.5 block text-center text-[10.5px] font-medium"
                    style={{ color: on ? "#a78bfa" : "var(--dw-dim)" }}
                  >
                    {th.label}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Внешний вид">
          <div className="space-y-3">
            <div>
              <Label hint={`${cfg.fontSize}px`}>Размер шрифта</Label>
              <Slider value={cfg.fontSize} min={11} max={34} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={`${cfg.bgOpacity}%`}>Прозрачность подложки</Label>
              <Slider value={cfg.bgOpacity} min={0} max={100} onChange={(v) => set({ bgOpacity: v })} format={(v) => `${v}%`} color="#22d3ee" />
              <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Меняется только фон плашки — текст и ник всегда остаются читаемыми.
              </p>
            </div>
            <div>
              <Label hint={`${cfg.radius}px`}>Скругление углов</Label>
              <Slider value={cfg.radius} min={0} max={26} onChange={(v) => set({ radius: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={`${cfg.duration} с`}>Длительность показа</Label>
              <Slider value={cfg.duration} min={3} max={30} onChange={(v) => set({ duration: v })} format={(v) => `${v}с`} color="#22d3ee" />
            </div>
            <div>
              <Label hint={`${cfg.maxMessages}`}>Сообщений на экране</Label>
              <Slider value={cfg.maxMessages} min={2} max={14} onChange={(v) => set({ maxMessages: v })} format={(v) => `${v}`} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Segmented
              value={cfg.dir}
              onChange={(v) => set({ dir: v })}
              options={[
                { id: "up", label: "Снизу вверх" },
                { id: "down", label: "Сверху вниз" },
              ]}
            />
          </div>
          <div className="mt-2 space-y-0.5">
            <Toggle label="Тень плашки" on={cfg.shadow} onChange={(v) => set({ shadow: v })} />
            <Toggle label="Значок площадки" on={cfg.showPlatform} onChange={(v) => set({ showPlatform: v })} />
            <Toggle label="Время сообщения" on={cfg.showTime} onChange={(v) => set({ showTime: v })} />
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        {/* живой предпросмотр */}
        <Panel
          title="Предпросмотр"
          desc="Так сообщения выглядят в OBS. Обновляется сразу при изменении настроек."
          right={
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>
              <Radio size={11} /> live
            </span>
          }
        >
          <div className="checker relative overflow-hidden rounded-xl p-3" style={{ minHeight: 220 }}>
            <div
              className="absolute inset-x-3 flex flex-col gap-2.5"
              style={{
                [cfg.dir === "up" ? "bottom" : "top"]: 12,
                flexDirection: cfg.dir === "up" ? "column" : "column-reverse",
              } as React.CSSProperties}
            >
              {demo.slice(0, Math.min(cfg.maxMessages, demo.length)).map((m) => (
                <div
                  key={m.id}
                  className="relative flex items-start gap-[9px] overflow-hidden"
                  style={{
                    fontSize: cfg.fontSize,
                    padding: "10px 14px",
                    borderRadius: cfg.radius,
                    border: `1px solid ${theme.border}`,
                    boxShadow: cfg.shadow ? theme.shadow : "none",
                  }}
                >
                  <span
                    className="absolute inset-0"
                    style={{
                      background: themeBg(theme, cfg.bgOpacity),
                      borderRadius: cfg.radius,
                      backdropFilter: "blur(6px)",
                    }}
                  />
                  {theme.bar && (
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: theme.bar }} />
                  )}
                  {cfg.showPlatform && (
                    <span className="relative z-[1] mt-0.5">
                      <PlatformChip id={m.platform} />
                    </span>
                  )}
                  <span className="relative z-[1] min-w-0">
                    <span
                      className="mr-2 font-bold"
                      style={{ color: m.color || theme.name, fontSize: cfg.fontSize * 0.92 }}
                    >
                      {m.author}
                    </span>
                    {cfg.showTime && (
                      <span className="mr-2 font-mono text-[0.62em]" style={{ color: theme.sub }}>
                        23:10
                      </span>
                    )}
                    <span className="leading-snug" style={{ color: theme.text }}>
                      {m.text}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title="Ссылка для OBS"
          desc="Локальный сервер 127.0.0.1, доступ по токену."
          right={
            <span
              className="flex items-center gap-1.5 font-mono text-[10px]"
              style={{ color: clients ? "#4ade80" : "var(--dw-dim)" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: clients ? "#4ade80" : "var(--dw-dim)" }}
              />
              {clients} OBS
            </span>
          }
        >
          <div
            className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
            style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}
          >
            <Link2 size={13} style={{ color: "var(--dw-dim)" }} className="shrink-0" />
            <code className="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: "#a78bfa" }}>
              {url}
            </code>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Btn variant="primary" onClick={copy}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Скопировано" : "Копировать"}
            </Btn>
            <Btn variant="ghost" onClick={sendTest}>
              <Send size={12} /> Тест
            </Btn>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
            OBS → Источники → + → Browser. Ширина 520, высота 600. Прозрачный фон включать не нужно —
            подложка рисуется самим виджетом.
          </p>
        </Panel>
      </div>
    </div>
  );
}
