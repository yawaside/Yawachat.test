import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, Download, Eye, Headphones, ListX, Loader, Mic, Pause, Play, SkipForward, Volume2 } from "lucide-react";
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

const SILERO_LABEL: Record<string, string> = {
  aidar: "Silero: Аидар (встроенный)",
  baya: "Silero: Бая (встроенная)",
  kseniya: "Silero: Ксения (встроенная)",
  xenia: "Silero: Женя (встроенная)",
  eugene: "Silero: Евгений (встроенный)",
};

/* ---------- панель «Проверить тестовое аудио» ----------
 * Работает без Silero, без SAPI — через Web Speech API браузера или
 * встроенные голоса Windows. Позволяет услышать любой из доступных языков. */
const TEST_LANGUAGES: Array<{ code: string; label: string; phrase: string }> = [
  { code: "ru-RU", label: "Русский", phrase: "Привет из чата! Сегодня тестируем голоса." },
  { code: "en-US", label: "Английский", phrase: "Hello from the stream! Today we test voices." },
  { code: "de-DE", label: "Немецкий", phrase: "Hallo aus dem Stream! Heute testen wir Stimmen." },
  { code: "es-ES", label: "Испанский", phrase: "¡Hola desde el stream! Hoy probamos voces." },
  { code: "fr-FR", label: "Французский", phrase: "Bonjour du stream ! Aujourd'hui on teste des voix." },
  { code: "it-IT", label: "Итальянский", phrase: "Ciao dallo stream! Oggi testiamo le voci." },
  { code: "ja-JP", label: "Японский", phrase: "こんにちは、配信から！今日は声をテストします。" },
  { code: "ko-KR", label: "Корейский", phrase: "안녕하세요, 스트림에서! 오늘은 음성을 테스트합니다." },
  { code: "zh-CN", label: "Китайский", phrase: "你好, 来自直播！今天我们测试语音。" },
  { code: "uk-UA", label: "Украинский", phrase: "Привіт з етеру! Сьогодні тестуємо голоси." },
  { code: "pl-PL", label: "Польский", phrase: "Cześć ze streama! Dziś testujemy głosy." },
  { code: "tr-TR", label: "Турецкий", phrase: "Yayından selamlar! Bugün sesleri test ediyoruz." },
];

function TestTtsPanel({ toast }: { toast: (t: string) => void }) {
  const [lastPlayed, setLastPlayed] = useState<string>("");
  const sp = getSp();
  const desktop = isDesktop();

  const play = (lang: typeof TEST_LANGUAGES[number]) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      toast("В этом окружении нет Web Speech API");
      return;
    }
    // выбираем лучший голос для языка
    const target = lang.code.toLowerCase();
    const list = window.speechSynthesis.getVoices();
    const exact = list.find((v) => v.lang.toLowerCase() === target);
    const partial = list.find((v) => v.lang.toLowerCase().startsWith(target.split("-")[0]));
    const voice = exact || partial || null;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(lang.phrase);
    u.lang = lang.code;
    if (voice) u.voice = voice;
    u.rate = 1;
    u.pitch = 1;
    u.onend = () => toast(`«${lang.label}» проиграно до конца`);
    u.onerror = () => toast("Ошибка воспроизведения — голос не найден");
    try {
      window.speechSynthesis.speak(u);
      setLastPlayed(lang.label);
    } catch {
      toast("Не удалось запустить озвучку");
    }
  };

  // Прямой синтез через SAPI5 (если есть preload) — поддерживает языки, которые
  // браузерный Web Speech не знает.
  const playViaSapi = (lang: typeof TEST_LANGUAGES[number]) => {
    if (!sp?.tts?.speak) {
      play(lang);
      return;
    }
    try {
      sp.tts.speak({ text: lang.phrase, rate: 1, volume: 0.9, voice: "" });
      setLastPlayed(lang.label);
      toast(`«${lang.label}» проиграно до конца (SAPI5)`);
    } catch {
      play(lang);
    }
  };

  return (
    <Panel
      title="Проверить тестовое аудио"
      desc="Прослушайте фразу на любом доступном языке. Используется встроенный движок приложения: если Silero скачан и выбран русский — озвучит он, иначе SAPI5 Windows, иначе Web Speech API браузера."
      collapsible
      defaultOpen
      right={<Headphones size={14} style={{ color: "var(--dw-dim)" }} />}
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {TEST_LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => (desktop ? playViaSapi(lang) : play(lang))}
            className="flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left text-[11.5px] font-medium transition-colors hover:border-viol"
            style={{
              borderColor:
                lastPlayed === lang.label ? "#8b5cf6" : "var(--dw-line)",
              background:
                lastPlayed === lang.label ? "#8b5cf618" : "rgba(255,255,255,0.02)",
              color: "var(--dw-text)",
            }}
            title={lang.phrase}
          >
            <span className="truncate">{lang.label}</span>
            <span className="font-mono text-[9.5px] opacity-60">{lang.code}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
        Языки зависят от установленных голосов: Windows-голоса появляются после установки
        Language Pack; Silero даёт русский; Web Speech API в браузере обычно умеет en-US и ru-RU.
        Если кнопка ничего не произносит — нужный голос отсутствует на компьютере.
      </p>
    </Panel>
  );
}

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
  const [sileroError, setSileroError] = useState<string | null>(null);

  const refreshSilero = useCallback(() => {
    sp?.silero?.status().then(setSileroStatus).catch(() => {});
  }, [sp]);

  useEffect(() => {
    refreshSilero();
    sp?.silero?.onStatus?.(setSileroStatus);
  }, [sp, refreshSilero]);

  useEffect(() => {
    if (!sp?.silero) return;
    const iv = window.setInterval(refreshSilero, 700);
    return () => window.clearInterval(iv);
  }, [sp, refreshSilero]);

  const sileroInstall = async () => {
    if (!sp?.silero) return;
    setSileroError(null);
    toast("Начинаю скачивание голосов Silero (~330 МБ, один раз)");
    try {
      const result = await sp.silero.install();
      const ok = typeof result === "object" ? result?.ok : !!result;
      if (!ok) {
        const err =
          (typeof result === "object" && result?.error) ||
          sileroStatus?.lastError ||
          "Не удалось скачать. Проверьте интернет и повторите попытку.";
        setSileroError(err);
        toast(err);
        return;
      }
      toast("Голоса Silero установлены. Загружаю движок…");
      window.setTimeout(refreshSilero, 4000);
      window.setTimeout(refreshSilero, 10000);
      window.setTimeout(refreshSilero, 20000);
    } catch (e) {
      const msg = (e && typeof e === "object" && "message" in e) ? (e as { message: string }).message : String(e);
      setSileroError(msg);
      toast(`Ошибка установки Silero: ${msg}`);
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
    <div className="space-y-4">
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
            <Label>Голос</Label>
            <div className="relative">
              <select
                value={cfg.voiceURI}
                onChange={(e) => onChange({ voiceURI: e.target.value })}
                className="dw-select w-full appearance-none pr-7"
              >
                {sortedVoices.length === 0 && sileroSpeakers.length === 0 && (
                  <option value="">Голоса загружаются…</option>
                )}
                {sortedVoices.length > 0 && (
                  <optgroup label="Голоса Windows / SAPI">
                    {sortedVoices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                    ))}
                  </optgroup>
                )}
                {sileroSpeakers.length > 0 && (
                  <optgroup label="Silero — нейросеть, только русский (встроенные)">
                    {sileroSpeakers.map((s) => (
                      <option key={`silero:${s}`} value={`silero:${s}`}>
                        {SILERO_LABEL[s] || `Silero: ${s} (встроенный)`}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--dw-dim)" }} />
            </div>
            {desktop && (
              <p className="mt-1.5 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Windows-голоса: Параметры → Время и язык → Речь → Управление голосами.
                Голоса Silero — встроенные нейросетевые, скачиваются один раз кнопкой ниже.
              </p>
            )}
          </div>
        </div>
      </Panel>

      {/* Встроенные голоса Silero */}
      {desktop && (
        <Panel
          title="Голоса Silero (встроенные)"
          desc="Нейросетевые русские голоса v5_5_ru: Аидар, Бая, Ксения, Женя, Евгений. Приложение скачивает движок один раз (~330 МБ) в свою папку — сторонние программы ставить не нужно."
          collapsible
          defaultOpen={!sileroStatus?.ready}
          right={<Bot size={15} style={{ color: sileroStatus?.ready ? "#4ade80" : "var(--dw-dim)" }} />}
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

            {(sileroError || sileroStatus?.lastError) && !sileroStatus?.installing && (
              <p
                className="rounded-lg border px-3 py-2 text-[10.5px] leading-snug"
                style={{ borderColor: "rgba(248,113,113,0.35)", color: "#f87171", background: "rgba(248,113,113,0.08)" }}
              >
                {sileroError || sileroStatus?.lastError}
              </p>
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

      <TestTtsPanel toast={toast} />

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
              hint="«аааа» → «аа»"
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
