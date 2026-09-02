export interface SpBridge {
  mode: "app" | "overlay";
  platform: string;
  onChat: (cb: (m: ChatMsg) => void) => void;
  onChannels: (cb: (list: BridgeChannel[]) => void) => void;
  getChannels: () => Promise<BridgeChannel[]>;
  addChannel: (platform: PlatformId, channelId: string) => void;
  removeChannel: (platform: PlatformId, channelId: string) => void;
  diagnoseNet?: () => void;
  widgetUrl: () => Promise<string>;
  widgetInfo: () => Promise<{ port: number; token: string; url: string }>;
  widgetTest: (msg: ChatMsg) => void;
  /** Живое оформление OBS-виджета: применяется без смены ссылки. */
  widgetConfig?: (payload: unknown) => void;
  onWidgetClients: (cb: (n: number) => void) => void;
  onHotkey: (cb: (action: string) => void) => void;
  settings: {
    get: () => Promise<Record<string, unknown>>;
    patch: (patch: Record<string, unknown>) => void;
    onChange: (cb: (s: Record<string, unknown>) => void) => void;
  };
  hotkeys: {
    apply: (map: Record<string, string>) => void;
  };
  window: {
    minimize: () => void;
    hideToTray: () => void;
    toggleMaximize: () => void;
    close: () => void;
    onMaximize: (cb: (v: boolean) => void) => void;
    isMaximized: () => Promise<boolean>;
  };
  tts: {
    speak: (p: { text: string; rate: number; volume: number; voice?: string }) => string;
    skip: () => void;
    stopAll: () => void;
    voices: () => Promise<string[]>;
    onEnd: (cb: (id: string) => void) => void;
  };
  overlay: {
    get: () => Promise<OverlayConfig>;
    set: (cfg: Partial<OverlayConfig>) => void;
    onChange: (cb: (o: OverlayConfig) => void) => void;
  };
  // viewers
  onViewers: (cb: (payload: { byPlatform: Record<string, number>; total: number }) => void) => void;
  getViewers: () => Promise<{ byPlatform: Record<string, number>; total: number }>;
}
