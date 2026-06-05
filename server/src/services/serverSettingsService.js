"use strict";

const fs   = require("node:fs");
const path = require("node:path");

const SETTINGS_FILE = "server-settings.json";

/**
 * Persists runtime server settings to DATA_DIR/server-settings.json.
 *
 * Priority on startup (highest wins):
 *   saved file  >  environment variables  >  hardcoded defaults
 *
 * After the first UI-driven save the file is the source of truth, so
 * settings survive restarts without requiring env vars.
 *
 * Stored shape:
 *   {
 *     minPushIntervalMs: number,
 *     mqtt: {
 *       brokerUrl: string,
 *       clientId:  string,
 *       username:  string,
 *       password:  string,   // stored as-is; file is local and not transmitted
 *       ingestTopic: string
 *     }
 *   }
 *
 * Usage:
 *   const svc = new ServerSettingsService({ dataDir, defaults });
 *   svc.load();                        // call once at startup
 *   const ms = svc.get("minPushIntervalMs");
 *   svc.update({ minPushIntervalMs: 50 }); // persists immediately
 */
class ServerSettingsService {
  /**
   * @param {{ dataDir: string, defaults: object }} opts
   *   defaults — initial values (typically from env vars + hardcoded fallbacks)
   */
  constructor({ dataDir, defaults = {} }) {
    this._filePath = path.join(dataDir, SETTINGS_FILE);
    this._dataDir  = dataDir;
    // Start with a deep clone of defaults.
    this._settings = _deepClone(defaults);
  }

  /**
   * Load saved settings from disk and merge them over the current defaults.
   * The saved file always wins over defaults / env-var values.
   * Safe to call at startup even if the file does not yet exist.
   */
  load() {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const raw  = fs.readFileSync(this._filePath, "utf8");
      const saved = JSON.parse(raw);
      this._settings = _deepMerge(this._settings, saved);
      console.log("[ServerSettings] Loaded settings from disk.");
    } catch (err) {
      console.error("[ServerSettings] Failed to load server-settings.json:", err.message);
    }
  }

  /**
   * Return the current value for a top-level key, or a shallow copy of all
   * settings if no key is supplied.
   * @param {string} [key]
   */
  get(key) {
    if (key !== undefined) return _deepClone(this._settings[key]);
    return _deepClone(this._settings);
  }

  /**
   * Merge a partial patch into the stored settings and persist to disk.
   * Nested objects (e.g. `mqtt`) are merged one level deep — supply only the
   * keys you want to change.
   * @param {object} patch
   */
  update(patch) {
    this._settings = _deepMerge(this._settings, patch);
    this._save();
  }

  _save() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify(this._settings, null, 2), "utf8");
    } catch (err) {
      console.error("[ServerSettings] Failed to save server-settings.json:", err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Shallow-recursive merge: scalar values and arrays in `patch` overwrite those
 * in `base`; plain objects are merged one level deep.
 */
function _deepMerge(base, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) &&
        result[k] !== null && typeof result[k] === "object" && !Array.isArray(result[k])) {
      result[k] = { ...result[k], ...v };
    } else {
      result[k] = v;
    }
  }
  return result;
}

module.exports = { ServerSettingsService };
