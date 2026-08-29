import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Download, Eye, ListX, Loader, Mic, Pause, Play, SkipForward, Volume2 } from "lucide-react";
import type { SpeechEngine } from "../../lib/core";
import type { TtsConfig } from "../../lib/tts-config";
import { getSp, isDesktop } from "../../lib/bridge";
import type { SileroStatus } from "../../lib/bridge";
import { Eq } from "../bits";
import { Btn, Label, Panel, Slider, Toggle } from "./ui";

function pct(p: { loaded: number; total: number }): string {
  if (!p.total) return "…";
  const percent = Math.round((p.loaded / p.total) * 100);
  const mb = Math.round(p.loaded / 1048576);
  const totalMb = Math.round(p.total / 1048576);
  return `${percent}% · ${mb} / ${totalMb} МБ`;
}

const SILOERO_LABELS: Record<string, string> = {
  aidar: "Silero: Аидар (встроенный)",
  baya: "Silero: Бая (встроенная)",
  kseniya: "Silero: Ксения (встроенная)",
  xenia: "Silero: Женя (встроенная)",
  eugene: "Silero: Евгений (встроенный)",
};

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
  const sp = getSp();

  /* ---------- встроенные голоса Silero (v5_5_ru, русский) ---------- */
  const [sileroStatus, setSileroStatus] = useState<SileroStatus | null>(null);

  const refreshSilero = useCallback(() => {
    sp?.silero?.status().then(setSileroStatus).catch(() => {});
  }, [sp]);

  useEffect(() => {
    refreshSilero();
    // подписка на статус, который шлёт main-процесс (например после установки)
    sp?.silero?.onStatus?.(setSileroStatus);
  }, [sp, refreshSilero]);

  /* живой прогресс скачивания (прилёт каждые ~500 мс) */
  useEffect(() => {
    if (!sp?.silero) return;
    const iv = window.setInterval(refreshSilero, 700);
    return () => window.clearInterval(iv);
  }, [sp, refreshSilero]);

  const sileroInstall = async () => {
    if (!sp?.silero) return;
    toast("Начинаю скачивание голосов Silero (~330 МБ, один раз)");
    const result = await sp.silero.install();
    const ok = typeof result === "boolean" ? result : result?.ok;
    const status =
      typeof result === "object" && result && "status" in result ? result.status : null;
    if (status) setSileroStatus(status);
    refreshSilero();
    if (ok) {
      toast("Голоса Silero установлены. Загружаю движок…");
      window.setTimeout(refreshSilero, 4000);
      window.setTimeout(refreshSilero, 10000);
      window.setTimeout(refreshSilero, 20000);
    } else {
      const detail =
        status?.lastError ||
        "проверьте интернет-соединение или что релиз silero-worker-v* опубликован в GitHub Releases";
      toast(`Silero: ${detail}`);
    }
  };

  const sileroSpeakers = sileroStatus?.ready ? sileroStatus.speakers : [];

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
        collapsible
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
          <Toggle
            label="Озвучивать через виджет OBS"
            hint="Полезно, чтобы направить аудио озвучки в источник Browser Source в OBS (например, для регулировки громкости на стриме)."
            on={cfg.obsTts}
            onChange={(v) => {
              speech.setObsTts(v);
              onChange({ obsTts: v });
            }}
          />
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
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--dw-dim)" }}>
                Голос
              </span>
              <span className="font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>
                кнопка ▶ рядом с именем — прослушать любой голос
              </span>
            </div>
            <VoiceList
              value={cfg.voiceURI}
              onChange={(v) => onChange({ voiceURI: v })}
              sapi={sortedVoices.map((v) => ({ id: v.voiceURI, name: v.name }))}
              silero={sileroSpeakers.map((s) => ({ id: `silero:${s}`, name: SILOERO_LABELS[s] || `Silero: ${s} (встроенный)` }))}
              sileroInstalled={!!sileroStatus?.ready}
              onSileroInstall={sileroInstall}
              onPreview={async (voiceId) => {
                const r = await speech.preview(voiceId, preview.replace(/[«»]/g, ""));
                if (!r?.ok && r?.error) toast(r.error);
              }}
            />
            {desktop && (
              <p className="mt-1.5 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Windows-голоса: Параметры → Время и язык → Речь → Управление голосами.
                Голоса Silero — встроенные нейросетевые, скачиваются один раз кнопкой ниже.
              </p>
            )}
          </div>
        </div>

        {/* Встроенные голоса Silero */}
        {desktop && (
          <Panel
            title="Голоса Silero (встроенные)"
            desc="Нейросетевые русские голоса v5_5_ru: Аидар, Бая, Ксения, Женя, Евгений. Приложение скачивает движок один раз (~330 МБ) в свою папку — сторонние программы ставить не нужно."
            collapsible
            defaultOpen={!sileroStatus?.ready}
            right={
              <Bot size={15} style={{ color: sileroStatus?.ready ? "#4ade80" : "var(--dw-dim)" }} />
            }
          >
            <div className="space-y-2.5">
              <div
                className="flex items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[11px]"
                style={{
                  borderColor: "var(--dw-line)",
                  color: sileroStatus?.ready ? "#4ade80" : sileroStatus?.installing ? "#facc15" : "var(--dw-dim)",
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: sileroStatus?.ready ? "#4ade80" : sileroStatus?.installing ? "#facc15" : "var(--dw-dim)",
                  }}
                />
                {!sileroStatus || (!sileroStatus.installed && !sileroStatus.installing)
                  ? "Движок не скачан"
                  : sileroStatus.installing && sileroStatus.progress?.phase === "download"
                  ? `Скачивание… ${pct(sileroStatus.progress)}`
                  : sileroStatus.installing
                  ? "Распаковка…"
                  : sileroStatus.ready
                  ? `Готов. Голосов: ${sileroStatus.speakers.length}`
                  : "Скачан. Загружается при первом использовании…"}
              </div>

              {sileroStatus?.progress && sileroStatus.progress.total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--dw-input)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: pct(sileroStatus.progress),
                      background: "linear-gradient(90deg,#8b5cf6,#22d3ee)",
                    }}
                  />
                </div>
              )}

              {!sileroStatus?.ready && (
                <Btn variant="primary" className="w-full !rounded-xl" onClick={sileroInstall} disabled={sileroStatus?.installing}>
                  {sileroStatus?.installing ? (
                    <>
                      <Loader size={13} className="animate-spin" /> Устанавливаю…
                    </>
                  ) : (
                    <>
                      <Download size={13} /> {sileroStatus?.installed ? "Проверить установку" : "Скачать голоса Silero (~330 МБ)"}
                    </>
                  )}
                </Btn>
              )}

              {sileroStatus?.ready && (
                <p className="text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                  Выберите голос из списка «Silero — нейросеть» выше. После скачивания работает без
                  интернета. Нагрузка: ~15–40% одного ядра на время фразы, RAM ~500 МБ.
                </p>
              )}
            </div>
          </Panel>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="Шаблон озвучки" desc="Собирается блоками — вручную писать шаблон не нужно." collapsible defaultOpen>
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
          {/* мини-виджет предпросмотра шаблона: одно тестовое сообщение */}
          <div
            className="mt-3 rounded-xl border p-3"
            style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}
          >
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--dw-dim)" }}>
              <Eye size={10} /> так прозвучит сообщение
            </div>
            <div className="flex items-start gap-2.5">
              <span
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[9px] font-bold text-white"
                style={{ background: "#a970ff" }}
              >
                T
              </span>
              <div className="min-w-0">
                <span className="mr-2 text-[12.5px] font-bold" style={{ color: "#a78bfa" }}>neon_wolf</span>
                <span className="text-[12.5px]" style={{ color: "var(--dw-text)" }}>привет из чата!</span>
                <p className="mt-1.5 font-mono text-[11px] leading-snug" style={{ color: "#22d3ee" }}>
                  {preview}
                </p>
              </div>
            </div>
            <Btn
              variant="ghost"
              className="mt-2.5 w-full !rounded-lg"
              disabled={!cfg.enabled}
              onClick={() => { speech.test(preview.replace(/[«»]/g, "")); toast("Проигрываю пример"); }}
            >
              <Play size={11} /> Прослушать пример
            </Btn>
          </div>
        </Panel>

        <Panel title="Базовые правила" desc="Быстрые переключатели обработки текста." collapsible>
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

        <Panel title="Ограничения" collapsible>
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

interface VoiceOption { id: string; name: string }

function VoiceList({
  value, onChange, sapi, silero, sileroInstalled, onSileroInstall, onPreview,
}: {
  value: string;
  onChange: (v: string) => void;
  sapi: VoiceOption[];
  silero: VoiceOption[];
  sileroInstalled: boolean;
  onSileroInstall: () => void;
  onPreview: (voiceId: string) => Promise<void>;
}) {
  const [playing, setPlaying] = useState<string | null>(null);

  const play = async (id: string, isSilero: boolean) => {
    if (isSilero && !sileroInstalled) {
      onSileroInstall();
      return;
    }
    setPlaying(id);
    try {
      await onPreview(id);
    } finally {
      window.setTimeout(() => setPlaying((p) => (p === id ? null : p)), 400);
    }
  };

  const row = (opt: VoiceOption, isSilero: boolean, unavailable = false) => {
    const selected = value === opt.id;
    return (
      <div
        key={opt.id}
        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors"
        style={{
          borderColor: selected ? "#8b5cf6" : "var(--dw-line)",
          background: selected ? "#8b5cf614" : "transparent",
          opacity: unavailable ? 0.55 : 1,
        }}
      >
        <button
          type="button"
          onClick={() => play(opt.id, isSilero)}
          title={unavailable ? "Голоса Silero ещё не скачаны — нажмите, чтобы установить" : "Прослушать"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--dw-hover)]"
          style={{ color: playing === opt.id ? "#a78bfa" : "var(--dw-text)" }}
        >
          {unavailable ? <Download size={13} /> : playing === opt.id ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
        </button>
        <button
          type="button"
          onClick={() => !unavailable && onChange(opt.id)}
          disabled={unavailable}
          className="min-w-0 flex-1 truncate text-left text-[12.5px]"
          style={{ color: selected ? "#a78bfa" : "var(--dw-text)" }}
        >
          {opt.name}
        </button>
        {selected && (
          <span className="font-mono text-[9.5px]" style={{ color: "#a78bfa" }}>выбран</span>
        )}
      </div>
    );
  };

  const sileroPlaceholders: VoiceOption[] =
    silero.length > 0
      ? silero
      : [
          { id: "silero:xenia", name: "Silero: Женя (встроенный)" },
          { id: "silero:aidar", name: "Silero: Аидар (встроенный)" },
          { id: "silero:baya", name: "Silero: Бая (встроенная)" },
          { id: "silero:kseniya", name: "Silero: Ксения (встроенная)" },
          { id: "silero:eugene", name: "Silero: Евгений (встроенный)" },
        ];

  return (
    <div className="max-h-[340px] overflow-y-auto rounded-xl border p-2 space-y-3" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>
      {sapi.length > 0 && (
        <div>
          <div className="mb-1 px-1 font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "var(--dw-dim)" }}>
            Голоса Windows / SAPI · {sapi.length}
          </div>
          <div className="space-y-1">{sapi.map((v) => row(v, false, false))}</div>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between px-1 font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "var(--dw-dim)" }}>
          <span>Silero · нейросеть · русский</span>
          {!sileroInstalled && (
            <span style={{ color: "#facc15" }}>▶ прослушать — начнётся установка (~330 МБ)</span>
          )}
        </div>
        <div className="space-y-1">{sileroPlaceholders.map((v) => row(v, true, !sileroInstalled))}</div>
      </div>
      {sapi.length === 0 && silero.length === 0 && (
        <p className="p-2 text-center text-[11px]" style={{ color: "var(--dw-dim)" }}>
          Голоса загружаются…
        </p>
      )}
    </div>
  );
}
