import { Eye } from "lucide-react";
import { makeMessage } from "../../lib/core";
import type { ChatViewConfig } from "../../lib/widget";
import { PlatformChip } from "../bits";
import { Label, Panel, Segmented, Slider, Toggle } from "./ui";

export default function ChatViewPanel({
  cfg, onChange,
}: {
  cfg: ChatViewConfig;
  onChange: (c: ChatViewConfig) => void;
}) {
  const set = (patch: Partial<ChatViewConfig>) => onChange({ ...cfg, ...patch });
  const demo = [makeMessage("twitch"), makeMessage("kick")];

  return (
    <div className="space-y-4">
      <Panel title="Внешний вид ленты" desc="Настройка визуала сообщений на главной странице.">
        <div className="space-y-3">
          <div>
            <Label hint={`${cfg.fontSize}px`}>Размер текста</Label>
            <Slider value={cfg.fontSize} min={12} max={19} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
          </div>
          <div>
            <Label hint={`${cfg.rowGap}px`}>Интервал между сообщениями</Label>
            <Slider value={cfg.rowGap} min={2} max={14} onChange={(v) => set({ rowGap: v })} format={(v) => `${v}px`} color="#22d3ee" />
          </div>
          <div>
            <Label hint={`${cfg.radius}px`}>Скругление строк</Label>
            <Slider value={cfg.radius} min={0} max={18} onChange={(v) => set({ radius: v })} format={(v) => `${v}px`} />
          </div>
          <div>
            <Label>Стиль строк</Label>
            <Segmented
              value={cfg.style}
              onChange={(v) => set({ style: v })}
              options={[
                { id: "classic", label: "Classic" },
                { id: "minimal", label: "Minimal" },
                { id: "glass", label: "Glass" },
                { id: "flat", label: "Flat" },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Элементы строки">
        <Toggle label="Показывать площадку" on={cfg.showPlatform} onChange={(v) => set({ showPlatform: v })} />
        <Toggle label="Показывать время" on={cfg.showTime} onChange={(v) => set({ showTime: v })} />
        <Toggle label="Показывать бейджи" on={cfg.showBadges} onChange={(v) => set({ showBadges: v })} />
      </Panel>

      <Panel
        title="Предпросмотр"
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>
            <Eye size={11} /> live
          </span>
        }
      >
        <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>
          {demo.map((m) => (
            <div
              key={m.id}
              className="flex items-start gap-3 px-2 py-1"
              style={{
                borderRadius: cfg.radius,
                marginBottom: cfg.rowGap,
                background:
                  cfg.style === "glass"
                    ? "rgba(255,255,255,0.04)"
                    : cfg.style === "flat"
                    ? "rgba(255,255,255,0.02)"
                    : cfg.style === "classic"
                    ? "rgba(255,255,255,0.03)"
                    : "transparent",
                border: cfg.style === "classic" ? "1px solid var(--dw-line)" : "1px solid transparent",
              }}
            >
              {cfg.showPlatform && <PlatformChip id={m.platform} />}
              <div className="min-w-0">
                <span className="mr-2 font-bold" style={{ color: m.color, fontSize: cfg.fontSize }}>{m.author}</span>
                {cfg.showTime && (
                  <span className="mr-2 font-mono text-[11px]" style={{ color: "var(--dw-dim)" }}>23:10</span>
                )}
                <div className="break-words" style={{ fontSize: cfg.fontSize, color: "var(--dw-text)" }}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
