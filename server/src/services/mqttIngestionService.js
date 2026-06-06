"use strict";
const mqtt = require("mqtt");
const { parseIngestPayload } = require("../utils/ingestPayloadParser");

const DEFAULT_INGEST_TOPIC = "cmnd/visualizer/ingest";

/**
 * Connects to an MQTT broker and ingests data published to the ingest topic.
 *
 * The payload must be a JSON string with the same shape as the HTTP POST /api/series/ingest body:
 *   {
 *     "measurementName": "cpu",
 *     "points": {
 *       "timestamps": [1700000000, ...],
 *       "series": { "user": [12.4, ...] }
 *     }
 *   }
 *
 * Configuration via environment variables (initial values only — can be changed at runtime):
 *   MQTT_BROKER_URL     — broker URL, e.g. mqtt://localhost:1883 (required to enable MQTT)
 *   MQTT_CLIENT_ID      — client id (default: visualizer-server-<random>)
 *   MQTT_USERNAME       — broker username (optional)
 *   MQTT_PASSWORD       — broker password (optional)
 *   MQTT_INGEST_TOPIC   — topic to subscribe to (default: cmnd/visualizer/ingest)
 */
class MqttIngestionService {
  constructor({ seriesStore, ingestErrorLog, brokerUrl = "", clientId = "", username = "", password = "", ingestTopic = "", debugMode = false }) {
    this._seriesStore = seriesStore;
    this._ingestErrorLog = ingestErrorLog || null;
    this._brokerUrl = brokerUrl;
    this._clientId = clientId || _randomClientId();
    this._username = username;
    this._password = password;
    this._ingestTopic = ingestTopic || DEFAULT_INGEST_TOPIC;
    this._debugMode = Boolean(debugMode);
    this._client = null;
    /** "disconnected" | "connecting" | "connected" | "error" */
    this._status = "disconnected";
    this._lastError = "";
    /** Incremented on every reconfigure/stop so old client callbacks self-discard. */
    this._generation = 0;
  }

  /** Returns public config (password omitted). */
  getConfig() {
    return {
      enabled: Boolean(this._brokerUrl),
      brokerUrl: this._brokerUrl,
      clientId: this._clientId,
      username: this._username,
      ingestTopic: this._ingestTopic,
      debugMode: this._debugMode,
      status: this._status,
      lastError: this._lastError
    };
  }

  /** Enable or disable debug logging without reconfiguring the connection. */
  setDebugMode(enabled) {
    this._debugMode = Boolean(enabled);
  }

  /**
   * Apply new settings and reconnect.
   * Passing an empty brokerUrl disables MQTT.
   */
  reconfigure({ brokerUrl = "", clientId = "", username = "", password = "", ingestTopic = "", debugMode }) {
    this.stop();
    this._brokerUrl = brokerUrl.trim();
    this._clientId = clientId.trim() || _randomClientId();
    this._username = username;
    this._password = password;
    this._ingestTopic = ingestTopic.trim() || DEFAULT_INGEST_TOPIC;
    if (debugMode !== undefined) this._debugMode = Boolean(debugMode);
    this._lastError = "";
    if (this._brokerUrl) {
      this.start();
    } else {
      this._status = "disconnected";
      console.log("[MQTT] MQTT disabled (no broker URL).");
    }
  }

  start() {
    if (!this._brokerUrl) return;

    const connectOptions = {
      clientId: this._clientId,
      clean: true,
      reconnectPeriod: 5000
    };
    if (this._username) connectOptions.username = this._username;
    if (this._password) connectOptions.password = this._password;

    // Capture the generation at start time; handlers discard themselves if stale.
    const gen = this._generation;
    const own = () => this._generation === gen;

    this._status = "connecting";
    const ingestTopic = this._ingestTopic;
    console.log(`[MQTT] Connecting to broker: ${this._brokerUrl}`);
    this._client = mqtt.connect(this._brokerUrl, connectOptions);

    this._client.on("connect", () => {
      if (!own()) return;
      this._status = "connected";
      this._lastError = "";
      console.log(`[MQTT] Connected. Subscribing to topic: ${ingestTopic}`);
      this._client.subscribe(ingestTopic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] Failed to subscribe to ${ingestTopic}:`, err.message);
        } else {
          console.log(`[MQTT] Subscribed to ${ingestTopic}`);
        }
      });
    });

    this._client.on("message", (topic, payloadBuffer) => {
      if (!own() || topic !== ingestTopic) return;

      const raw = payloadBuffer.toString();

      if (this._debugMode) {
        this._ingestErrorLog?.record("MQTT Debug", raw.length > 300 ? raw.slice(0, 300) + "…" : raw);
      }

      let body;
      try {
        body = JSON.parse(payloadBuffer.toString());
      } catch {
        this._ingestErrorLog?.record("MQTT", "Received non-JSON message — ignored.", raw);
        return;
      }

      const parsed = parseIngestPayload(body);
      if (!parsed.ok) {
        this._ingestErrorLog?.record("MQTT", `Invalid ingest payload: ${parsed.error}`, raw);
        return;
      }

      const { measurementName, clearMeasurement, time, normalizedTs, normalizedSeries } = parsed;
      if (clearMeasurement) {
        this._seriesStore.clearMeasurementData(measurementName);
      }
      this._seriesStore.setMeasurementTimeFlag(measurementName, time);
      try {
        this._seriesStore.ingestMeasurementPoints(
          measurementName,
          normalizedTs,
          normalizedSeries
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._ingestErrorLog?.record("MQTT", `Store error for "${measurementName}": ${msg}`, raw);
        console.error(`[MQTT] Store error for measurement "${measurementName}":`, msg);
      }
    });

    this._client.on("reconnect", () => {
      if (!own()) return;
      this._status = "connecting";
      console.log("[MQTT] Reconnecting…");
    });

    this._client.on("error", (err) => {
      if (!own()) return;
      this._status = "error";
      this._lastError = err.message;
      console.error("[MQTT] Connection error:", err.message);
    });

    this._client.on("close", () => {
      if (!own()) return;
      // Only move back to "connecting" while auto-reconnect is active.
      if (this._status !== "disconnected") {
        this._status = "connecting";
      }
      console.log("[MQTT] Connection closed.");
    });
  }

  stop() {
    if (this._client) {
      this._generation += 1;   // invalidate all callbacks from the old client
      this._status = "disconnected";
      this._client.end(true);
      this._client = null;
    }
  }
}

function _randomClientId() {
  return `visualizer-server-${Math.random().toString(16).slice(2, 8)}`;
}

module.exports = { MqttIngestionService };
