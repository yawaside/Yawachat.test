import { useMemo } from "react";
import { Eye, Gamepad2, Lock, MousePointerClick, Unlock } from "lucide-react";
import { makeMessage } from "../../lib/core";
import { getTheme, themeBg } from "../../lib/widget";
import type { OverlayConfig } from "../../lib/widget";
import { PlatformChip } from "../bits";
import { Btn, Label, Panel, Segmented, Slider, Toggle } from "./ui";

export default function OverlayPanel({
  cfg, onChange, desktop,
}: {
  cfg: OverlayConfig;
  onChange: (patch: Partial<OverlayConfig>) => void;
  desktop: boolean;
}) {
  const set = (patch: Partial<OverlayConfig>) => onChange(patch);
  const theme = getTheme("minimal-dark");

  const demo = useMemo(
    () => [
      { ...makeMessage("twitch"), author: "neon_wolf", text: "ЛЕЕЕЕТС ГОООУ", color: "#a78bfa" },
      { ...makeMessage("kick"), author: "vanya_fps", text: "модератор молодец", color: "#69db7c" },
      { ...makeMessage("tiktok"), author: "luna228", text: "пошёл за чаем", color: "#f472b6" },
      { ...makeMessage("youtube"), author: "quiet_owl", text: "кто ещё смотрит с телефона?", color: "#ff4e45" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.mode, cfg.fontSize]
  );

  const shown = demo.slice(0, cfg.maxMessages);

  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
      <div className="space-y-4">
        <Panel
          title="Игровой оверлей"
          desc={
            desktop
              ? "Компактная лента поверх игры. Перетаскивается мышью, поверх всех окон."
              : "Настройки применяются в desktop-сборке. Здесь — живой предпросмотр."
          }
          right={
            <Btn variant={cfg.enabled ? "primary" : "outline"} onClick={() => set({ enabled: !cfg.enabled })}>
              <Gamepad2 size={12} /> {cfg.enabled ? "Включён" : "Выключен"}
            </Btn>
          }
        >
          <div className="space-y-1">
            <Toggle
              label="Показывать оверлей"
              hint="окно всегда поверх игры, можно скрыть горячей клавишей"
              on={cfg.enabled}
              onChange={(v) => set({ enabled: v })}
            />
            <Toggle
              label="Сквозные клики"
              hint={
                cfg.clickThrough
                  ? "Клики проходят в игру. Окно нельзя перетащить — выключите режим, чтобы подвинуть."
                  : "Окно ловит мышь: перетащите его за шапку в нужный угол экрана."
              }
              on={cfg.clickThrough}
              onChange={(v) => set({ clickThrough: v })}
            />
            <Toggle
              label="Зафиксировать позицию"
              hint="зафиксируйте после настройки, чтобы случайно не сдвинуть оверлей"
              on={cfg.locked}
              onChange={(v) => set({ locked: v })}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10.5px]" style={{ color: "var(--dw-dim)" }}>
            <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--dw-line)" }}>
              {cfg.clickThrough ? <MousePointerClick size={12} /> : <Gamepad2 size={12} />}
              {cfg.clickThrough ? "клики насквозь" : "ловит мышь"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--dw-line)" }}>
              {cfg.locked ? <Lock size={12} /> : <Unlock size={12} />}
              {cfg.locked ? "позиция зафиксирована" : "позиция свободная"}
            </span>
          </div>
        </Panel>

        <Panel title="Вид оверлея">
          <div className="space-y-3">
            <div>
              <Label hint={`${cfg.bgOpacity}%`}>Прозрачность подложки</Label>
              <Slider value={cfg.bgOpacity} min={0} max={100} onChange={(v) => set({ bgOpacity: v })} format={(v) => `${v}%`} color="#22d3ee" />
              <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Прозрачным становится только фон — текст сообщений остаётся чётким.
              </p>
            </div>
            <div>
              <Label hint={`${cfg.fontSize}px`}>Размер текста</Label>
              <Slider value={cfg.fontSize} min={9} max={24} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={`${cfg.maxMessages}`}>Сообщений в ленте</Label>
              <Slider value={cfg.maxMessages} min={2} max={20} onChange={(v) => set({ maxMessages: v })} format={(v) => `${v}`} />
            </div>
            <div>
              <Label>Вид</Label>
              <Segmented
                value={cfg.mode}
                onChange={(v) => set({ mode: v })}
                options={[
                  { id: "compact", label: "Компактная лента" },
                  { id: "widget", label: "Плашки" },
                ]}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Горячие клавиши оверлея">
          <div className="space-y-2 text-[11.5px]" style={{ color: "var(--dw-dim)" }}>
            <p>
              Показать/скрыть оверлей — <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Shift</kbd> +{" "}
              <kbd className="kbd">G</kbd>
            </p>
            <p>
              Сквозные клики — <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Shift</kbd> +{" "}
              <kbd className="kbd">C</kbd>
            </p>
            <p>Комбинации меняются на вкладке «Горячие клавиши».</p>
          </div>
        </Panel>
      </div>

      {/* живой предпросмотр */}
      <Panel
        title="Предпросмотр"
        desc="Так оверлей выглядит поверх игры. Обновляется сразу."
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>
            <Eye size={11} /> live
          </span>
        }
      >
        <div
          className="relative overflow-hidden rounded-2xl border"
          style={{
            minHeight: 360,
            borderColor: "var(--dw-line)",
            background:
              "radial-gradient(ellipse at 30% 20%, rgba(139,92,246,0.18), transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(34,211,238,0.12), transparent 50%), #0b0d16",
          }}
        >
          {/* имитация игрового фона */}
          <div className="absolute inset-0 opacity-[0.12]" style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }} />
          <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-[9.5px] text-white/60 backdrop-blur-sm">
            игра · 1920×1080
          </div>

          {/* само окно оверлея */}
          <div
            className="absolute right-4 top-10 w-[min(100%-2rem,280px)] overflow-hidden rounded-xl border p-3 shadow-2xl"
            style={{
              borderColor: "rgba(255,255,255,0.12)",
              background: themeBg(theme, cfg.bgOpacity),
              backdropFilter: "blur(8px)",
              opacity: cfg.enabled ? 1 : 0.45,
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.sub }}>
                overlay · {cfg.mode}
              </span>
              {!cfg.enabled && (
                <span className="font-mono text-[9px]" style={{ color: "#f87171" }}>выкл</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              {shown.map((m) =>
                cfg.mode === "widget" ? (
                  <div
                    key={m.id}
                    className="rounded-lg border px-2.5 py-1.5"
                    style={{
                      borderColor: "rgba(255,255,255,0.08)",
                      background: "rgba(0,0,0,0.18)",
                    }}
                  >
                    <div className="flex items-start gap-1.5">
                      <PlatformChip id={m.platform} />
                      <div className="min-w-0">
                        <span className="mr-1.5 font-bold" style={{ color: m.color, fontSize: cfg.fontSize }}>
                          {m.author}
                        </span>
                        <span style={{ color: theme.text, fontSize: cfg.fontSize }}>{m.text}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-start gap-1.5">
                    <PlatformChip id={m.platform} />
                    <p className="min-w-0 leading-snug" style={{ fontSize: cfg.fontSize }}>
                      <span className="mr-1.5 font-bold" style={{ color: m.color }}>{m.author}</span>
                      <span style={{ color: theme.text }}>{m.text}</span>
                    </p>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="absolute bottom-3 left-4 right-4 flex flex-wrap gap-2">
            <span className="rounded-lg border border-white/10 bg-black/45 px-2.5 py-1 font-mono text-[9.5px] text-white/70 backdrop-blur-sm">
              Ctrl+Shift+G — показать / скрыть
            </span>
            {cfg.clickThrough && (
              <span className="rounded-lg border border-cy/30 bg-cy/10 px-2.5 py-1 font-mono text-[9.5px] text-cy backdrop-blur-sm">
                сквозные клики
              </span>
            )}
          </div>
        </div>

        {!desktop && (
          <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
            В браузере оверлей показан как предпросмотр. Поверх игры он работает в desktop-версии.
          </p>
        )}
      </Panel>
    </div>
  );
}
