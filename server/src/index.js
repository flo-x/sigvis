const express = require("express");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { WebSocketServer } = require("ws");
const { createSeriesRouter } = require("./routes/series");
const { createAdminSeriesRouter } = require("./routes/adminSeries");
const { createDashboardRouter } = require("./routes/dashboards");
const { createAdminRouter } = require("./routes/admin");
const { DashboardStorageService } = require("./services/dashboardStorageService");
const { FileSystemStorageAdapter } = require("./services/storage/fileSystemStorageAdapter");
const { SeriesInMemoryStore } = require("./services/seriesInMemoryStore");
const { SubscriptionManager } = require("./services/subscriptionManager");
const { MqttIngestionService } = require("./services/mqttIngestionService");
const { ProcessorService }  = require("./services/processorService");
const { GeneratorService }  = require("./services/generatorService");
const { IngestErrorLog }          = require("./services/ingestErrorLog");
const { ServerSettingsService }   = require("./services/serverSettingsService");
const { OPENAPI_SPEC } = require("./openapi");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const DASHBOARD_STORAGE_DIR =
  process.env.DASHBOARD_STORAGE_DIR || path.resolve(__dirname, "..", "data", "dashboards");
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");

// Server settings: env vars supply defaults; saved file (if present) wins over them.
const serverSettings = new ServerSettingsService({
  dataDir: DATA_DIR,
  defaults: {
    minPushIntervalMs: Number.parseInt(process.env.MIN_PUSH_INTERVAL_MS, 10) || 30,
    mqtt: {
      brokerUrl:   process.env.MQTT_BROKER_URL    || "",
      clientId:    process.env.MQTT_CLIENT_ID     || "",
      username:    process.env.MQTT_USERNAME      || "",
      password:    process.env.MQTT_PASSWORD      || "",
      ingestTopic: process.env.MQTT_INGEST_TOPIC  || "cmnd/sigvis/ingest"
    }
  }
});
serverSettings.load();

const storageAdapter = new FileSystemStorageAdapter(DASHBOARD_STORAGE_DIR);
const dashboardStorageService = new DashboardStorageService(storageAdapter);
const seriesStore = new SeriesInMemoryStore({ defaultThresholdSeconds: 600 });
const ingestErrorLog = new IngestErrorLog();
const subscriptionManager = new SubscriptionManager({
  seriesStore,
  minPushIntervalMs: serverSettings.get("minPushIntervalMs")
});
const processorService = new ProcessorService({ seriesStore, dataDir: DATA_DIR, ingestErrorLog });
processorService.load();

seriesStore.setUpdateCallback((measurementName, earliestModifiedTs, cleared) => {
  subscriptionManager.notifyMeasurementUpdated(measurementName, earliestModifiedTs, cleared);
  processorService.onMeasurementUpdated(measurementName);
});

// Generators are loaded after the store callback is registered so that the
// first generator tick triggers fully-initialised processors.
const generatorService = new GeneratorService({ seriesStore, dataDir: DATA_DIR, ingestErrorLog });
generatorService.load();

const mqttSettings = serverSettings.get("mqtt");
const mqttService = new MqttIngestionService({ seriesStore, ingestErrorLog, ...mqttSettings });
if (mqttSettings.brokerUrl) {
  mqttService.start();
} else {
  console.log("[MQTT] No broker URL configured — MQTT ingestion disabled.");
}

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/openapi.json", (_req, res) => {
  res.json(OPENAPI_SPEC);
});

app.get("/api/docs", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Visualizer API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html, body, #swagger-ui { margin: 0; padding: 0; height: 100%; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui"
    });
  </script>
</body>
</html>`);
});

app.use(
  "/api/series",
  createSeriesRouter({
    seriesStore,
    ingestErrorLog
  })
);
app.use(
  "/api/admin/series",
  createAdminSeriesRouter({
    seriesStore
  })
);
app.use(
  "/api/dashboards",
  createDashboardRouter({
    dashboardStorageService
  })
);

app.use(createAdminRouter({ subscriptionManager, mqttService, generatorService, processorService, ingestErrorLog, serverSettings }));

const webDistPath = path.resolve(__dirname, "..", "..", "web", "dist");
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type === "subscribe" && Array.isArray(message.measurements)) {
      subscriptionManager.subscribe(ws, message.measurements);
    }
  });

  ws.on("close", () => {
    subscriptionManager.unsubscribeConnection(ws);
  });

  ws.on("error", () => {
    subscriptionManager.unsubscribeConnection(ws);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Dashboard storage dir: ${DASHBOARD_STORAGE_DIR}`);
  console.log(`Min push interval: ${serverSettings.get("minPushIntervalMs")} ms`);
});
