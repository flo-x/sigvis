"use strict";

const fs   = require("node:fs");
const path = require("node:path");

const CONFIG_FILE = "measurement-config.json";

/**
 * Persists per-measurement configuration (thresholdSeconds, maxPoints) to
 * DATA_DIR/measurement-config.json so that user-defined retention settings
 * survive server restarts.
 *
 * Stored shape:
 *   {
 *     "cpu_temp":  { "thresholdSeconds": 3600, "maxPoints": 10000 },
 *     "pressure":  { "thresholdSeconds": 600  }
 *   }
 *
 * Usage:
 *   const svc = new MeasurementConfigService({ dataDir });
 *   svc.load();
 *   const cfg = svc.get("cpu_temp");  // { thresholdSeconds, maxPoints } or {}
 *   svc.set("cpu_temp", { thresholdSeconds: 3600 });  // persists immediately
 */
class MeasurementConfigService {
  constructor({ dataDir }) {
    this._filePath = path.join(dataDir, CONFIG_FILE);
    this._dataDir  = dataDir;
    this._configs  = {};
  }

  /**
   * Load saved configs from disk.
   * Safe to call at startup even if the file does not yet exist.
   */
  load() {
    if (!fs.existsSync(this._filePath)) { return; }
    try {
      const raw = fs.readFileSync(this._filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this._configs = parsed;
        console.log("[MeasurementConfig] Loaded config from disk.");
      }
    } catch (err) {
      console.error("[MeasurementConfig] Failed to load measurement-config.json:", err.message);
    }
  }

  /**
   * Return the saved config for a measurement, or an empty object if none.
   * @param {string} measurementName
   * @returns {{ thresholdSeconds?: number, maxPoints?: number }}
   */
  get(measurementName) {
    return { ...(this._configs[measurementName] || {}) };
  }

  /**
   * Merge a partial config patch for a measurement and persist immediately.
   * Passing undefined or null for a field removes it from the stored config.
   * @param {string} measurementName
   * @param {{ thresholdSeconds?: number, maxPoints?: number }} patch
   */
  set(measurementName, patch) {
    const existing = this._configs[measurementName] || {};
    const merged   = { ...existing };

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    if (Object.keys(merged).length === 0) {
      delete this._configs[measurementName];
    } else {
      this._configs[measurementName] = merged;
    }

    this._save();
  }

  _save() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(
        this._filePath,
        JSON.stringify(this._configs, null, 2),
        "utf8"
      );
    } catch (err) {
      console.error("[MeasurementConfig] Failed to save measurement-config.json:", err.message);
    }
  }
}

module.exports = { MeasurementConfigService };
