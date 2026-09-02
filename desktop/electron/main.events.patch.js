// Accept and broadcast connector events (twitch/vk/youtube) to UI and widget server
// Added in feature/events-widget: main process wiring for platform events

// (This file is based on the original main.js — only the new parts for events are shown here)

// after existing requires and variable declarations add:
// `const EVENT_CHANNEL = "sp:event";`

// Insert after function broadcast(...) definition:
function broadcastEvent(event) {
  try {
    // broadcast to renderer windows
    for (const win of [mainWin, overlayWin]) {
      if (win && !win.isDestroyed()) win.webContents.send("sp:event", event);
    }
    // also forward to widget server if available
    try {
      if (widgetServer && widgetServer.broadcast) widgetServer.broadcast({ type: "event", event });
    } catch (e) { /* noop */ }
  } catch (e) { /* noop */ }
}

// When creating ConnectorManager, pass an emitEvent handler
// in app.whenReady() connectors = new ConnectorManager({
//   settings,
//   onChat: (m) => { ... },
//   onStatus: (list) => emit("sp:channels", list),
//   onEvent: (ev) => { broadcastEvent(ev); emit("sp:events", ev); }
// });

// Expose settings.overlay.showEvents in settings:get handler (it already returns settings object)

