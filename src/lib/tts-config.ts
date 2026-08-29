import { DEFAULT_FILTERS } from "./core";
import type { TTSTemplate, TTSFilters } from "./core";

/** Настройки озвучки. Хранятся целиком и сохраняются сразу при изменении. */
export interface TtsConfig {
  enabled: boolean;
  rate: number;
  volume: number;
  voiceURI: string;
  obsTts: boolean;
  backend: "sapi" | "silero";
  sileroSpeaker: string;
  template: TTSTemplate;
  filters: TTSFilters;
}

export const DEFAULT_TTS: TtsConfig = {
  enabled: false,
  rate: 1,
  volume: 0.9,
  voiceURI: "",
  obsTts: false,
  backend: "sapi",
  sileroSpeaker: "kseniya",
  template: { author: true, platform: true, text: true },
  filters: DEFAULT_FILTERS,
};

export const SILERO_SPEAKERS = ["aidar", "baya", "kseniya", "xenia", "eugene", "random"] as const;

export function sanitizeTts(raw: unknown): TtsConfig {
  const src = (raw ?? {}) as Partial<TtsConfig>;
  const backend = src.backend === "silero" ? "silero" : "sapi";
  return {
    ...DEFAULT_TTS,
    ...src,
    backend,
    sileroSpeaker: typeof src.sileroSpeaker === "string" && src.sileroSpeaker ? src.sileroSpeaker : "kseniya",
    template: { ...DEFAULT_TTS.template, ...(src.template ?? {}) },
    filters: { ...DEFAULT_TTS.filters, ...(src.filters ?? {}) },
  };
}
