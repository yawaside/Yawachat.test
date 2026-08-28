import { useMemo, useState } from "react";
import { Ban, Check, FlaskConical, Undo2 } from "lucide-react";
import {
  applyPreset, BAN_PRESETS, buildSpeechText, isPresetApplied, unapplyPreset,
} from "../../lib/core";
import type { BanPreset, PlatformId, TTSFilters } from "../../lib/core";
import { PLATFORM_LIST, PLATFORMS } from "../../lib/core";
import type { TtsConfig } from "../../lib/tts-config";
import { PlatformIcon } from "../bits";
import { Btn, Panel, TagInput } from "./ui";

/**
 * Плашка пресета. Клик по всей карточке включает набор — отдельной кнопки
 * «Применить» больше нет. У активного пресета зелёная обводка, при наведении
 * содержимое размывается и появляется «Отмена».
 */
function PresetCard({
  preset, filters, onApply, onUnapply,
}: {
  preset: BanPreset;
  filters: TTSFilters;
  onApply: () => void;
  onUnapply: () => void;
}) {
  const applied = isPresetApplied(preset, filters);
  const count = preset.words.length + (preset.mask?.length ?? 0) + (preset.authors?.length ?? 0);
  const platform = preset.platform && preset.platform !== "all" ? preset.platform : null;
  const accent = platform ? PLATFORMS[platform].color : "#8b5cf6";

  return (
    <button
      type="button"
      onClick={applied ? onUnapply : onApply}
      className="group relative w-full overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5"
      style={{
        borderColor: applied ? "#4ade80" : "var(--dw-line)",
        background: applied
          ? "linear-gradient(135deg, rgba(74,222,128,0.10), rgba(74,222,128,0.02))"
          : "var(--dw-panel2)",
        boxShadow: applied ? "0 0 0 1px rgba(74,222,128,0.35), 0 8px 24px rgba(74,222,128,0.10)" : "none",
      }}
      title={applied ? "Нажмите, чтобы снять пресет" : "Нажмите, чтобы применить пресет"}
    >
      {/* содержимое: размывается при наведении на активный пресет */}
      <div className={applied ? "transition-all duration-200 group-hover:blur-[3px] group-hover:opacity-40" : ""}>
        <div className="flex items-start gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
            style={{ background: `${accent}1f`, color: accent }}
          >
            {platform ? <PlatformIcon id={platform} size={14} /> : <Ban size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-semibold">{preset.label}</span>
              {applied && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold"
                  style={{ background: "rgba(74,222,128,0.16)", color: "#4ade80" }}
                >
                  <Check size={9} /> ВКЛ
                </span>
              )}
            </div>
            <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
              {preset.desc}
            </p>
            <p className="mt-1.5 font-mono text-[9.5px]" style={{ color: "var(--dw-dim)" }}>
              {count} правил
            </p>
          </div>
        </div>
      </div>

      {/* оверлей отмены */}
      {applied && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold"
            style={{ background: "rgba(248,113,113,0.18)", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.45)" }}
          >
            <Undo2 size={12} /> Отмена
          </span>
        </span>
      )}
    </button>
  );
}

export default function FiltersPanel({
  cfg, onChange, toast,
}: {
  cfg: TtsConfig;
  onChange: (patch: Partial<TtsConfig>) => void;
  toast: (t: string) => void;
}) {
  const f = cfg.filters;
  const set = (patch: Partial<TTSFilters>) => onChange({ filters: { ...f, ...patch } });

  const appliedCount = useMemo(() => BAN_PRESETS.filter((p) => isPresetApplied(p, f)).length, [f]);

  const [testAuthor, setTestAuthor] = useState("neon_wolf");
  const [testPlatform, setTestPlatform] = useState<PlatformId>("twitch");
  const [testText, setTestText] = useState("привет из чата! заходи на мой канал");
  const [testResult, setTestResult] = useState<null | { ok: boolean; text: string }>(null);

  const runTest = () => {
    const text = buildSpeechText(
      {
        id: "test", platform: testPlatform, author: testAuthor || "зритель",
        color: "#fff", badges: [], text: testText, ts: Date.now(),
      },
      cfg.template,
      f,
      new Map()
    );
    setTestResult(
      text ? { ok: true, text } : { ok: false, text: "не озвучится — сообщение отсечено фильтрами" }
    );
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Пресеты банвордов"
        desc="Нажмите на плашку, чтобы включить набор. Активный пресет выделен зелёным — наведите на него и нажмите ещё раз для отмены."
        right={
          appliedCount > 0 ? (
            <span
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px]"
              style={{ background: "rgba(74,222,128,0.14)", color: "#4ade80" }}
            >
              <Ban size={11} /> активно: {appliedCount}
            </span>
          ) : undefined
        }
      >
        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
          {BAN_PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              filters={f}
              onApply={() => {
                set(applyPreset(f, p));
                toast(`Пресет «${p.label}» применён`);
              }}
              onUnapply={() => {
                set(unapplyPreset(f, p));
                toast(`Пресет «${p.label}» снят`);
              }}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Чёрный список слов" desc="Сообщение целиком не озвучивается, если содержит слово.">
        <TagInput items={f.banWords} onChange={(v) => set({ banWords: v })} placeholder="слово или часть слова, можно через запятую" />
      </Panel>

      <Panel title="Замена на «пип»" desc="Слово заменяется, остальное сообщение озвучивается.">
        <TagInput items={f.maskWords} onChange={(v) => set({ maskWords: v })} placeholder="слово для маскировки" accent="#facc15" />
      </Panel>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Panel title="Игнор авторов" desc="Боты и спамеры — не озвучиваются.">
          <TagInput items={f.banAuthors} onChange={(v) => set({ banAuthors: v })} placeholder="ник автора" />
        </Panel>
        <Panel title="Белый список авторов" desc="Если не пусто — озвучиваются ТОЛЬКО эти ники.">
          <TagInput items={f.allowAuthors} onChange={(v) => set({ allowAuthors: v })} placeholder="ник автора" accent="#4ade80" />
        </Panel>
      </div>

      <Panel
        title="Проверка фильтра"
        desc="Введите сообщение — увидите, что именно услышат зрители (или что оно отсечено)."
        right={
          <Btn variant="primary" onClick={runTest} disabled={!testText.trim()}>
            <FlaskConical size={12} /> Проверить
          </Btn>
        }
      >
        <div className="flex flex-wrap gap-2">
          <select
            value={testPlatform}
            onChange={(e) => setTestPlatform(e.target.value as PlatformId)}
            className="dw-select h-[31px] w-[130px]"
          >
            {PLATFORM_LIST.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <input
            value={testAuthor}
            onChange={(e) => setTestAuthor(e.target.value)}
            placeholder="автор"
            className="h-[31px] w-[140px] rounded-lg border bg-transparent px-2.5 font-mono text-[11px] outline-none placeholder:text-[var(--dw-dim)] focus:border-viol"
            style={{ borderColor: "var(--dw-line)" }}
          />
          <input
            value={testText}
            onChange={(e) => {
              setTestText(e.target.value);
              setTestResult(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && runTest()}
            placeholder="текст сообщения"
            className="h-[31px] min-w-[180px] flex-1 rounded-lg border bg-transparent px-2.5 text-[11.5px] outline-none placeholder:text-[var(--dw-dim)] focus:border-viol"
            style={{ borderColor: "var(--dw-line)" }}
          />
        </div>
        {testResult && (
          <p
            className="mt-2 rounded-lg border px-3 py-2 font-mono text-[11px]"
            style={{
              borderColor: testResult.ok ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)",
              color: testResult.ok ? "#4ade80" : "#f87171",
            }}
          >
            {testResult.ok ? `«${testResult.text}»` : testResult.text}
          </p>
        )}
      </Panel>
    </div>
  );
}
