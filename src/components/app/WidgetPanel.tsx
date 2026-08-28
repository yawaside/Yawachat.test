import { useMemo, useState } from "react";
import { Check, Copy, Link2, Palette, Radio, RotateCcw, Send, Type } from "lucide-react";
import { getSp } from "../../lib/bridge";
import { makeMessage, PLATFORMS } from "../../lib/core";
import {
  DEFAULT_WIDGET, DEFAULT_WIDGET_COLORS, getFontStack, resolveWidgetColors,
  widgetBackground, WIDGET_FONTS, WIDGET_THEMES,
} from "../../lib/widget";
import type { WidgetColors, WidgetConfig } from "../../lib/widget";
import { PlatformIcon } from "../bits";
import { Btn, Label, Panel, Segmented, Slider, Toggle } from "./ui";

/** Поле выбора цвета: свотч + hex + сброс к цвету темы. */
function ColorField({
  label, hint, value, fallback, onChange,
}: {
  label: string;
  hint: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const custom = !!value;
  const shown = value || fallback;
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border px-2.5 py-2"
      style={{ borderColor: custom ? "#8b5cf655" : "var(--dw-line)", background: "var(--dw-bg)" }}
    >
      <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border" style={{ borderColor: "var(--dw-line)" }}>
        <span className="absolute inset-0" style={{ background: shown }} />
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(shown) ? shown : "#8b5cf6"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-medium">{label}</div>
        <div className="truncate font-mono text-[9.5px]" style={{ color: "var(--dw-dim)" }}>
          {custom ? shown.toUpperCase() : `из темы · ${hint}`}
        </div>
      </div>
      {custom && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Вернуть цвет темы"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[var(--dw-hover)]"
          style={{ color: "var(--dw-dim)" }}
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}

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
  const set = (patch: Partial<WidgetConfig>) => onChange({ ...cfg, ...patch });
  const colors = { ...DEFAULT_WIDGET_COLORS, ...(cfg.colors ?? {}) };
  const setColor = (key: keyof WidgetColors, v: string) =>
    onChange({ ...cfg, colors: { ...colors, [key]: v } });

  const resolved = resolveWidgetColors(cfg);
  const fontStack = getFontStack(cfg.fontFamily);

  const demo = useMemo(
    () => [
      { ...makeMessage("twitch"), author: "yawaside", text: "Плашки теперь настраиваются полностью", color: "#a970ff" },
      { ...makeMessage("kick"), author: "wisp_gg", text: "Цвет ника, времени и рамки — свои", color: "#53fc18" },
    ],
    []
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

  const resetColors = () => {
    onChange({ ...cfg, colors: { ...DEFAULT_WIDGET_COLORS } });
    toast("Цвета возвращены к теме");
  };

  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <Panel title="Базовая тема" desc="Стартовый набор цветов. Любой элемент ниже можно переопределить.">
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
                  <span className="flex h-8 items-center justify-center gap-1 rounded-lg" style={{ background: th.swatch[0] }}>
                    {th.swatch.map((c, i) => (
                      <span key={i} className="h-3 w-3 rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="mt-1.5 block text-center text-[10.5px] font-medium" style={{ color: on ? "#a78bfa" : "var(--dw-dim)" }}>
                    {th.label}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Цвета элементов"
          desc="Свой цвет для каждой части плашки. Сброс — иконка справа в поле."
          right={
            <Btn variant="ghost" onClick={resetColors}>
              <Palette size={12} /> Сбросить
            </Btn>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ColorField label="Фон плашки" hint="подложка" value={colors.bg} fallback={resolved.bg} onChange={(v) => setColor("bg", v)} />
            <ColorField label="Текст сообщения" hint="основной текст" value={colors.text} fallback={resolved.text} onChange={(v) => setColor("text", v)} />
            <ColorField label="Ник автора" hint="имя зрителя" value={colors.author} fallback={resolved.author} onChange={(v) => setColor("author", v)} />
            <ColorField label="Время" hint="метка времени" value={colors.time} fallback={resolved.time} onChange={(v) => setColor("time", v)} />
            <ColorField label="Рамка" hint="контур плашки" value={colors.border} fallback={resolved.border} onChange={(v) => setColor("border", v)} />
            <ColorField label="Акцент" hint="полоска слева" value={colors.accent} fallback={resolved.accent} onChange={(v) => setColor("accent", v)} />
          </div>
          <div className="mt-3">
            <Toggle
              label="Ник в цвете площадки"
              hint="выключите, чтобы всегда использовать выбранный цвет ника"
              on={cfg.authorFromPlatform}
              onChange={(v) => set({ authorFromPlatform: v })}
            />
          </div>
        </Panel>

        <Panel title="Шрифт" desc="Гарнитура, насыщенность и размеры текста." right={<Type size={14} style={{ color: "var(--dw-dim)" }} />}>
          <div className="grid gap-2 sm:grid-cols-2">
            {WIDGET_FONTS.map((font) => {
              const on = cfg.fontFamily === font.id;
              return (
                <button
                  key={font.id}
                  onClick={() => set({ fontFamily: font.id })}
                  className="rounded-xl border px-3 py-2 text-left transition-all"
                  style={{
                    borderColor: on ? "#8b5cf6" : "var(--dw-line)",
                    background: on ? "#8b5cf612" : "var(--dw-input)",
                  }}
                >
                  <span className="block text-[13px]" style={{ fontFamily: font.stack, color: on ? "#c4b5fd" : "var(--dw-text)" }}>
                    Привет, чат
                  </span>
                  <span className="mt-0.5 block text-[9.5px]" style={{ color: "var(--dw-dim)" }}>{font.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <Label hint={`${cfg.fontSize}px`}>Размер текста</Label>
              <Slider value={cfg.fontSize} min={11} max={34} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={`${Math.round(cfg.authorScale * 100)}%`}>Размер ника</Label>
              <Slider
                value={Math.round(cfg.authorScale * 100)}
                min={70}
                max={140}
                onChange={(v) => set({ authorScale: v / 100 })}
                format={(v) => `${v}%`}
                color="#22d3ee"
              />
            </div>
            <div>
              <Label hint={String(cfg.fontWeight)}>Насыщенность</Label>
              <Segmented
                value={String(cfg.fontWeight)}
                onChange={(v) => set({ fontWeight: Number(v) })}
                options={[
                  { id: "400", label: "Обычный" },
                  { id: "600", label: "Полужирный" },
                  { id: "800", label: "Жирный" },
                ]}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Форма и элементы">
          <div className="space-y-3">
            <div>
              <Label hint={`${cfg.bgOpacity}%`}>Прозрачность подложки</Label>
              <Slider value={cfg.bgOpacity} min={0} max={100} onChange={(v) => set({ bgOpacity: v })} format={(v) => `${v}%`} color="#22d3ee" />
            </div>
            <div>
              <Label hint={`${cfg.radius}px`}>Скругление углов</Label>
              <Slider value={cfg.radius} min={0} max={26} onChange={(v) => set({ radius: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={`${cfg.padding}px`}>Внутренние отступы</Label>
              <Slider value={cfg.padding} min={4} max={24} onChange={(v) => set({ padding: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={`${cfg.duration} с`}>Длительность показа</Label>
              <Slider value={cfg.duration} min={3} max={30} onChange={(v) => set({ duration: v })} format={(v) => `${v}с`} color="#22d3ee" />
            </div>
            <div>
              <Label hint={`${cfg.maxMessages}`}>Сообщений на экране</Label>
              <Slider value={cfg.maxMessages} min={2} max={14} onChange={(v) => set({ maxMessages: v })} format={(v) => `${v}`} />
            </div>
            <div>
              <Label>Направление ленты</Label>
              <Segmented
                value={cfg.dir}
                onChange={(v) => set({ dir: v })}
                options={[
                  { id: "up", label: "Снизу вверх" },
                  { id: "down", label: "Сверху вниз" },
                ]}
              />
            </div>
          </div>

          <div className="mt-2 space-y-0.5 border-t pt-2" style={{ borderColor: "var(--dw-line)" }}>
            <Toggle label="Значок площадки" on={cfg.showPlatform} onChange={(v) => set({ showPlatform: v })} />
            <Toggle label="Ник автора" on={cfg.showAuthor} onChange={(v) => set({ showAuthor: v })} />
            <Toggle label="Время сообщения" on={cfg.showTime} onChange={(v) => set({ showTime: v })} />
            <Toggle label="Рамка плашки" on={cfg.showBorder} onChange={(v) => set({ showBorder: v })} />
            <Toggle label="Акцентная полоска" on={cfg.showAccent} onChange={(v) => set({ showAccent: v })} />
            <Toggle label="Тень" on={cfg.shadow} onChange={(v) => set({ shadow: v })} />
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        <Panel
          title="Предпросмотр"
          desc="Именно так плашки выглядят в OBS."
          right={
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>
              <Radio size={11} /> live
            </span>
          }
        >
          <div className="checker relative overflow-hidden rounded-xl p-3" style={{ minHeight: 230 }}>
            <div
              className="absolute inset-x-3 flex gap-2.5"
              style={{
                [cfg.dir === "up" ? "bottom" : "top"]: 12,
                flexDirection: cfg.dir === "up" ? "column" : "column-reverse",
              } as React.CSSProperties}
            >
              {demo.slice(0, Math.min(cfg.maxMessages, demo.length)).map((m) => (
                <div
                  key={m.id}
                  className="relative overflow-hidden"
                  style={{
                    fontFamily: fontStack,
                    fontSize: cfg.fontSize,
                    padding: cfg.padding,
                    borderRadius: cfg.radius,
                    background: widgetBackground(cfg),
                    border: cfg.showBorder ? `1px solid ${resolved.border}` : "1px solid transparent",
                    boxShadow: cfg.shadow ? "0 8px 26px rgba(0,0,0,0.34)" : "none",
                  }}
                >
                  {cfg.showAccent && (
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: resolved.accent }} />
                  )}
                  <div className="flex items-start gap-2.5" style={{ paddingLeft: cfg.showAccent ? 6 : 0 }}>
                    {cfg.showPlatform && (
                      <span
                        className="grid shrink-0 place-items-center rounded-lg"
                        style={{
                          width: cfg.fontSize * 1.6,
                          height: cfg.fontSize * 1.6,
                          background: `${PLATFORMS[m.platform].color}24`,
                          color: PLATFORMS[m.platform].color,
                        }}
                      >
                        <PlatformIcon id={m.platform} size={Math.max(11, cfg.fontSize * 0.72)} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      {(cfg.showAuthor || cfg.showTime) && (
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          {cfg.showAuthor && (
                            <span
                              style={{
                                color: cfg.authorFromPlatform ? PLATFORMS[m.platform].color : resolved.author,
                                fontSize: cfg.fontSize * cfg.authorScale,
                                fontWeight: cfg.fontWeight,
                              }}
                            >
                              {m.author}
                            </span>
                          )}
                          {cfg.showTime && (
                            <span style={{ color: resolved.time, fontSize: cfg.fontSize * 0.66 }}>· 24мс</span>
                          )}
                        </div>
                      )}
                      <div className="mt-0.5 break-words leading-snug" style={{ color: resolved.text }}>
                        {m.text}
                      </div>
                    </div>
                  </div>
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
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: clients ? "#4ade80" : "var(--dw-dim)" }} />
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
            <Btn
              variant="ghost"
              onClick={() => {
                onChange({ ...DEFAULT_WIDGET });
                toast("Настройки виджета сброшены");
              }}
            >
              <RotateCcw size={12} /> По умолчанию
            </Btn>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
            OBS → Источники → + → Browser. Ширина 520, высота 600. Все настройки применяются сразу —
            обновите источник, если менялась ссылка.
          </p>
        </Panel>
      </div>
    </div>
  );
}
