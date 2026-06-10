"use strict";

// Preload script runs in an isolated context before the renderer page loads.
// contextIsolation is enabled and nodeIntegration is disabled, so no Node.js
// APIs are exposed to the renderer. The app communicates with the embedded
// Express server via standard HTTP/WebSocket over localhost — no IPC bridge needed.
