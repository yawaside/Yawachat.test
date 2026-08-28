import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ListX, Mic, Pause, Play, SkipForward, Volume2 } from "lucide-react";
import type { SpeechEngine } from "../../lib/core";
import type { TtsConfig } from "../../lib/tts-config";
import { isDesktop } from "../../lib/bridge";
import { Eq } from "../bits";
import { Btn, Label, Panel, Slider, Toggle } from "./ui";

export default function VoicePanel({
  speech, cfg, onChange, toast,
}: {
  speech: SpeechEngine;
  cfg: TtsConfig;
  onChange: (patch: Partial<TtsConfig>) => void;
  toast: (t: string) => void;
}) {
  const desktop = isDesktop();
  const t = cfg.template;
  const f = cfg.filters;

  const sortedVoices = useMemo(
    () =>
      [...speech.voices].sort((a, b) => {
        const ar = /ru|рус|russian/i.test(`${a.name} ${a.lang}`) ? 0 : 1;
        const br = /ru|рус|russian/i.test(`${b.name} ${b.lang}`) ? 0 : 1;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name, "ru");
      }),
    [speech.voices]
  );

  /* если в настройках голос не выбран — фиксируем тот, что выбрал движок */
  useEffect(() => {
    if (!cfg.voiceURI && speech.voiceURI) onChange({ voiceURI: speech.voiceURI });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.voiceURI]);

  const setEnabled = (v: boolean) => {
    onChange({ enabled: v });
    speech.setEnabled(v);
  };

  const preview = (() => {
    const parts: string[] = [];
    if (t.author || t.platform) {
      let who = t.author ? "neon_wolf" : "Зритель";
      if (t.platform) who += " с Твича";
      parts.push(`${who} говорит`);
    }
    parts.push("привет из чата!");
    return `«${parts.join(": ")}»`;
  })();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Движок озвучки"
        desc={desktop ? "Системные голоса Windows (SAPI). Интернет не требуется." : "Голоса браузера (Web Speech API). В приложении — SAPI."}
        right={
          <Btn variant={cfg.enabled ? "primary" : "outline"} onClick={() => setEnabled(!cfg.enabled)}>
            <Mic size={12} /> {cfg.enabled ? "Включена" : "Выключена"}
          </Btn>
        }
      >
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>
          <div className="flex items-center gap-2.5">
            {speech.now ? <Eq /> : <Volume2 size={13} style={{ color: "var(--dw-dim)" }} />}
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--dw-dim)" }}>
              {speech.now ? "говорит" : "тишина"} · очередь {speech.queueSize}
            </span>
          </div>
          <div
            className="mt-1.5 min-h-[16px] truncate text-[11.5px]"
            style={{ color: speech.now ? "var(--dw-text)" : "var(--dw-dim)" }}
          >
            {speech.now ? speech.now.label : "—"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Btn variant={speech.paused ? "primary" : "ghost"} disabled={!cfg.enabled} onClick={() => speech.setPaused(!speech.paused)}>
              {speech.paused ? <Play size={12} /> : <Pause size={12} />} {speech.paused ? "Продолжить" : "Пауза"}
            </Btn>
            <Btn variant="ghost" disabled={!cfg.enabled} onClick={speech.skip}>
              <SkipForward size={12} /> Пропустить
            </Btn>
            <Btn variant="danger" disabled={!speech.queueSize} onClick={() => { speech.clearQueue(); toast("Очередь очищена"); }}>
              <ListX size={12} /> Очередь
            </Btn>
            <Btn variant="primary" className="ml-auto" disabled={!cfg.enabled} onClick={() => { speech.test(); toast("Тестовая фраза"); }}>
              <Play size={11} /> Тест
            </Btn>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <Label hint={`×${cfg.rate.toFixed(1)}`}>Скорость речи</Label>
            <Slider value={cfg.rate} min={0.5} max={2} step={0.1} onChange={(v) => onChange({ rate: v })} format={(v) => `×${v.toFixed(1)}`} />
          </div>
          <div>
            <Label hint={`${Math.round(cfg.volume * 100)}%`}>Громкость</Label>
            <Slider
              value={Math.round(cfg.volume * 100)}
              min={0}
              max={100}
              onChange={(v) => onChange({ volume: v / 100 })}
              format={(v) => `${v}%`}
            />
          </div>
          <div>
            <Label>Голос</Label>
            <div className="relative">
              <select
                value={cfg.voiceURI}
                onChange={(e) => onChange({ voiceURI: e.target.value })}
                className="dw-select w-full appearance-none pr-7"
              >
                {sortedVoices.length === 0 && <option value="">Голоса загружаются…</option>}
                {sortedVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--dw-dim)" }} />
            </div>
            {desktop && (
              <p className="mt-1.5 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Список берётся из Windows: Параметры → Время и язык → Речь → Управление голосами.
              </p>
            )}
          </div>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Шаблон озвучки" desc="Собирается блоками — вручную писать шаблон не нужно.">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["author", "Автор"],
              ["platform", "Площадка"],
              ["text", "Сообщение"],
            ] as const).map(([k, label]) => {
              const locked = k === "text";
              const on = t[k];
              return (
                <button
                  key={k}
                  title={locked ? "Обязательный блок" : undefined}
                  onClick={() => !locked && onChange({ template: { ...t, [k]: !on } })}
                  className="rounded-lg border px-3 py-2 text-[12px] font-medium transition-all"
                  style={{
                    borderColor: on ? "#8b5cf6" : "var(--dw-line)",
                    background: on ? "#8b5cf61f" : "transparent",
                    color: on ? "#a78bfa" : "var(--dw-dim)",
                    cursor: locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.8 : 1,
                  }}
                >
                  {label}{locked && " *"}
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {([
              [{ author: true, platform: false, text: true }, "Автор: текст"],
              [{ author: true, platform: true, text: true }, "Полный"],
              [{ author: false, platform: false, text: true }, "Только текст"],
            ] as const).map(([preset, label]) => {
              const on = t.author === preset.author && t.platform === preset.platform;
              return (
                <button
                  key={label}
                  onClick={() => onChange({ template: { ...preset } })}
                  className="rounded-lg border py-1.5 text-[10.5px] transition-all"
                  style={{
                    borderColor: on ? "#8b5cf6" : "var(--dw-line)",
                    color: on ? "#a78bfa" : "var(--dw-dim)",
                    background: on ? "#8b5cf614" : "transparent",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div
            className="mt-3 rounded-lg border border-dashed px-3 py-2.5 font-mono text-[11px]"
            style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}
          >
            {preview}
          </div>
        </Panel>

        <Panel title="Базовые правила" desc="Быстрые переключатели обработки текста.">
          <div className="space-y-0.5">
            <Toggle
              label="Ссылки → слово «ссылка»"
              hint="адрес не диктуется по буквам"
              on={f.links}
              onChange={(v) => onChange({ filters: { ...f, links: v } })}
            />
            <Toggle
              label="Игнорировать команды"
              hint="сообщения, начинающиеся с ! или /"
              on={f.commands}
              onChange={(v) => onChange({ filters: { ...f, commands: v } })}
            />
            <Toggle
              label="Вырезать эмодзи"
              hint="смайлы не попадают в озвучку"
              on={f.emoji}
              onChange={(v) => onChange({ filters: { ...f, emoji: v } })}
            />
            <Toggle
              label="Анти-повтор"
              hint="одинаковые сообщения автора не чаще раза в 45 с"
              on={f.dedupe}
              onChange={(v) => onChange({ filters: { ...f, dedupe: v } })}
            />
            <Toggle
              label="Сжимать повторы символов"
              hint="«ааааа» → «аа»"
              on={f.squashRepeats}
              onChange={(v) => onChange({ filters: { ...f, squashRepeats: v } })}
            />
            <Toggle
              label="Убирать мусорные символы"
              hint="ASCII-арт и спецсимволы удаляются"
              on={f.stripSymbols}
              onChange={(v) => onChange({ filters: { ...f, stripSymbols: v } })}
            />
          </div>
        </Panel>

        <Panel title="Ограничения">
          <div className="space-y-3">
            <div>
              <Label hint={`${f.maxLen} симв.`}>Максимальная длина сообщения</Label>
              <Slider value={f.maxLen} min={40} max={400} step={10} onChange={(v) => onChange({ filters: { ...f, maxLen: v } })} format={(v) => `${v}`} color="#22d3ee" />
            </div>
            <div>
              <Label hint={`${f.minLen} симв.`}>Минимальная длина</Label>
              <Slider value={f.minLen} min={1} max={20} onChange={(v) => onChange({ filters: { ...f, minLen: v } })} format={(v) => `${v}`} color="#22d3ee" />
            </div>
            <div>
              <Label hint={`${f.perMin} / мин`}>Сообщений в минуту</Label>
              <Slider value={f.perMin} min={2} max={60} onChange={(v) => onChange({ filters: { ...f, perMin: v } })} format={(v) => `${v}`} />
            </div>
            <div>
              <Label hint={`${f.maxCapsRatio}%`}>Порог КАПСА</Label>
              <Slider value={f.maxCapsRatio} min={0} max={100} onChange={(v) => onChange({ filters: { ...f, maxCapsRatio: v } })} format={(v) => `${v}%`} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* небольшой хук-помощник для панели фильтров (используется в FiltersPanel) */
export function useFiltersState(cfg: TtsConfig) {
  const [draft, setDraft] = useState(cfg.filters);
  return { draft, setDraft };
}
