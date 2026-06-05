"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseIngestPayload } = require("../utils/ingestPayloadParser");
const { validateConfig } = require("../utils/validateConfig");
const dspLib = require("../lib/dsp");
const { CATALOG } = require("../prebuilts/index");
const { compileScript, runScript, buildSandbox } = require("../lib/scriptSandbox");

const GENERATORS_FILE = "generators.json";
const MIN_INTERVAL_MS = 100;

// Modules accessible via require() inside custom generator scripts.
const MODULE_REGISTRY = new Map([["dsp", dspLib]]);

/**
 * Manages user-defined JavaScript generators that run at a fixed time interval
 * and can produce data series independently of any ingest event.
 *
 * Each generator has kind "custom" or "prebuilt":
 *
 * Custom:
 *   - id, name, enabled, intervalMs, initCode, code  (persisted)
 *   - state {}, initError, lastError, _initScript, _script, _interval  (in-memory)
 *
 * Prebuilt:
 *   - id, name, enabled, intervalMs, kind:"prebuilt", prebuiltId, config  (persisted)
 *   - state {}, initError, lastError, configErrors {}, _prebuiltDef, _interval  (in-memory)
 *
 * Script sandbox API (custom):
 *   ingest, getMeasurement, listMeasurements, setIntervalMs, require, state, log, Date, Math, JSON, …
 *
 * Direct API (prebuilt):
 *   initFn(state, config, api) / processFn(state, config, api)
 *   api: { ingest, getMeasurement, listMeasurements, setIntervalMs, log }
 */
class GeneratorService {
  constructor({ seriesStore, dataDir, ingestErrorLog }) {
    this._store    = seriesStore;
    this._dataDir  = dataDir;
    this._ingestErrorLog = ingestErrorLog || null;
    this._filePath = path.join(dataDir, GENERATORS_FILE);

    // Map<id, runtime-object>
    this._generators = new Map();

    // Master pause flag — true means all intervals are cleared regardless of enabled.
    this._paused = false;
  }

  get paused() { return this._paused; }

  pauseAll() {
    if (this._paused) return;
    this._paused = true;
    for (const gen of this._generators.values()) this._stop(gen);
    console.log("[Generators] Master pause — all generators stopped.");
  }

  resumeAll() {
    if (!this._paused) return;
    this._paused = false;
    for (const gen of this._generators.values()) {
      if (gen.enabled) this._start(gen);
    }
    console.log("[Generators] Master resume — enabled generators restarted.");
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  load() {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const raw     = fs.readFileSync(this._filePath, "utf8");
      const records = JSON.parse(raw);
      if (!Array.isArray(records)) return;
      for (const rec of records) {
        if (!rec.id) continue;
        if (rec.kind === "prebuilt") {
          if (!rec.prebuiltId) continue;
        } else {
          if (typeof rec.code !== "string") continue;
        }
        const gen = this._makeRuntime(rec);
        this._generators.set(rec.id, gen);
        this._runInit(gen);
        if (gen.enabled) this._start(gen);
      }
      console.log(`[Generators] Loaded ${this._generators.size} generator(s) from disk.`);
    } catch (err) {
      console.error("[Generators] Failed to load generators.json:", err.message);
    }
  }

  _save() {
    const records = Array.from(this._generators.values()).map((g) => {
      if (g.kind === "prebuilt") {
        return { id: g.id, name: g.name, enabled: g.enabled, intervalMs: g.intervalMs,
                 kind: "prebuilt", prebuiltId: g.prebuiltId, config: g.config };
      }
      return { id: g.id, name: g.name, enabled: g.enabled, intervalMs: g.intervalMs,
               initCode: g.initCode, code: g.code };
    });
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify(records, null, 2), "utf8");
    } catch (err) {
      console.error("[Generators] Failed to save generators.json:", err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  list() {
    return Array.from(this._generators.values()).map((g) => ({
      id:          g.id,
      name:        g.name,
      enabled:     g.enabled,
      intervalMs:  g.intervalMs,
      kind:        g.kind,
      prebuiltId:  g.kind === "prebuilt" ? g.prebuiltId  : undefined,
      initError:   g.initError   || null,
      lastError:   g.lastError   || null,
      configErrors: g.kind === "prebuilt" ? (g.configErrors || {}) : undefined
    }));
  }

  get(id) {
    const g = this._generators.get(id);
    if (!g) return null;
    const base = {
      id:         g.id,
      name:       g.name,
      enabled:    g.enabled,
      intervalMs: g.intervalMs,
      kind:       g.kind,
      initError:  g.initError  || null,
      lastError:  g.lastError  || null
    };
    if (g.kind === "prebuilt") {
      return { ...base, prebuiltId: g.prebuiltId, config: g.config, configErrors: g.configErrors || {} };
    }
    return { ...base, initCode: g.initCode, code: g.code };
  }

  create(data) {
    const id   = crypto.randomUUID();
    const kind = data.kind === "prebuilt" ? "prebuilt" : "custom";
    const base = {
      id,
      name:       String(data.name || "").trim() || (kind === "prebuilt" ? "Untitled Prebuilt" : "Untitled Generator"),
      enabled:    data.enabled !== undefined ? Boolean(data.enabled) : true,
      intervalMs: Math.max(MIN_INTERVAL_MS, Number(data.intervalMs) || 1000),
      kind
    };
    let record;
    if (kind === "prebuilt") {
      record = { ...base, prebuiltId: String(data.prebuiltId || ""), config: data.config || {} };
    } else {
      record = { ...base, initCode: String(data.initCode || ""), code: String(data.code || "") };
    }
    const gen = this._makeRuntime(record);
    this._generators.set(id, gen);
    this._save();
    this._runInit(gen);
    if (gen.enabled) this._start(gen);
    return this.get(id);
  }

  update(id, data) {
    const g = this._generators.get(id);
    if (!g) return null;

    const { name, enabled, intervalMs, initCode, code, clearState = false,
            prebuiltId, config } = data;

    if (name    !== undefined) g.name    = String(name).trim() || g.name;
    if (enabled !== undefined) g.enabled = Boolean(enabled);

    let restartInterval = false;
    if (intervalMs !== undefined) {
      const v = Math.max(MIN_INTERVAL_MS, Number(intervalMs) || g.intervalMs);
      if (v !== g.intervalMs) { g.intervalMs = v; restartInterval = true; }
    }

    let rerunInit = false;

    if (g.kind === "prebuilt") {
      if (prebuiltId !== undefined) { g.prebuiltId = String(prebuiltId); g._prebuiltDef = null; }
      if (config     !== undefined) { g.config = config; }
      // Re-resolve prebuilt def (in case prebuiltId changed).
      g._prebuiltDef = CATALOG.get(g.prebuiltId) || null;
      g.configErrors = g._prebuiltDef
        ? validateConfig(g._prebuiltDef.paramSchema, g.config, g._prebuiltDef.validateFn)
        : { _: `Unknown prebuilt: "${g.prebuiltId}"` };
      rerunInit = true;
    } else {
      if (initCode !== undefined) { g.initCode = String(initCode); g._initScript = null; rerunInit = true; }
      if (code     !== undefined) { g.code     = String(code);     g._script     = null; }
    }

    if (clearState) { g.state = {}; rerunInit = true; }

    this._save();

    if (restartInterval || enabled !== undefined) {
      this._stop(g);
      if (g.enabled) this._start(g);
    }
    if (rerunInit) this._runInit(g);
    return this.get(id);
  }

  delete(id) {
    const g = this._generators.get(id);
    if (!g) return false;
    this._stop(g);
    this._generators.delete(id);
    this._save();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Interval management
  // ---------------------------------------------------------------------------

  _start(gen) {
    if (gen._interval || this._paused) return;
    gen._interval = setInterval(() => this._runGenerator(gen), gen.intervalMs);
    console.log(`[Generator:${gen.name}] Started (${gen.intervalMs} ms interval).`);
  }

  _stop(gen) {
    if (!gen._interval) return;
    clearInterval(gen._interval);
    gen._interval = null;
    console.log(`[Generator:${gen.name}] Stopped.`);
  }

  _restartWithNewInterval(gen, newMs) {
    this._stop(gen);
    gen._interval = setInterval(() => this._runGenerator(gen), newMs);
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  _runInit(gen) {
    gen.initError = null;

    if (gen.kind === "prebuilt") {
      const def = gen._prebuiltDef;
      if (!def) {
        gen.initError = `Unknown prebuilt: "${gen.prebuiltId}"`;
        return;
      }
      if (Object.keys(gen.configErrors || {}).length > 0) {
        gen.initError = "Config has errors — fix them and save again.";
        return;
      }
      if (typeof def.initFn !== "function") return;
      try {
        def.initFn(gen.state, gen.config, this._buildApi(gen));
        console.log(`[Generator-init:${gen.name}] Init ran successfully.`);
      } catch (err) {
        gen.initError = err.message;
        console.error(`[Generator-init:${gen.name}] Runtime error: ${err.message}`);
      }
      return;
    }

    // Custom script path.
    if (!gen.initCode || !gen.initCode.trim()) return;

    const initFilename = `generator-init:${gen.name}`;
    if (!gen._initScript) {
      const { script, error } = compileScript(gen.initCode, initFilename);
      if (error) {
        gen.initError = error;
        console.error(`[Generator-init:${gen.name}] ${error}`);
        return;
      }
      gen._initScript = script;
    }

    const sandbox = buildSandbox(this._buildApi(gen), gen.state, MODULE_REGISTRY);
    const runError = runScript(gen._initScript, sandbox, initFilename);
    if (runError) {
      gen.initError = runError;
      console.error(`[Generator-init:${gen.name}] Runtime error: ${runError}`);
    } else {
      console.log(`[Generator-init:${gen.name}] Init ran successfully.`);
    }
  }

  _runGenerator(gen) {
    if (gen.kind === "prebuilt") {
      const def = gen._prebuiltDef;
      if (!def || typeof def.processFn !== "function") return;
      if (Object.keys(gen.configErrors || {}).length > 0) return;
      try {
        def.processFn(gen.state, gen.config, this._buildApi(gen));
        gen.lastError = null;
      } catch (err) {
        gen.lastError = err.message;
        console.error(`[Generator:${gen.name}] Runtime error: ${err.message}`);
      }
      return;
    }

    // Custom script path.
    if (!gen.code || !gen.code.trim()) return;

    const genFilename = `generator:${gen.name}`;
    if (!gen._script) {
      const { script, error } = compileScript(gen.code, genFilename);
      if (error) {
        gen.lastError = error;
        console.error(`[Generator:${gen.name}] ${error}`);
        return;
      }
      gen._script = script;
    }

    const sandbox = buildSandbox(this._buildApi(gen), gen.state, MODULE_REGISTRY);
    const runError = runScript(gen._script, sandbox, genFilename);
    gen.lastError = runError;
    if (runError) console.error(`[Generator:${gen.name}] Runtime error: ${runError}`);
  }

  // ---------------------------------------------------------------------------
  // Sandbox helpers
  // ---------------------------------------------------------------------------

  /** Build the api object passed to prebuilt initFn / processFn. */
  _buildApi(gen) {
    const store   = this._store;
    const service = this;

    function ingest(payload) {
      try {
        const parsed = parseIngestPayload(payload);
        if (!parsed.ok) throw new Error(`ingest() validation failed: ${parsed.error}`);
        const { measurementName, clearMeasurement, time, normalizedTs, normalizedSeries } = parsed;
        if (clearMeasurement) store.clearMeasurementData(measurementName);
        store.setMeasurementTimeFlag(measurementName, time);
        store.mergeSeriesPoints(measurementName, normalizedTs, normalizedSeries);
      } catch (err) {
        service._ingestErrorLog?.record(`Generator:${gen.name}`, err.message);
        throw err;
      }
    }

    function getMeasurement(name) {
      const measurement = store.measurementsByName.get(name);
      if (!measurement || measurement.dataByName.size === 0) return null;
      const seriesNames = Array.from(measurement.dataByName.keys());
      const { timestamps, dataByName } = store.getMeasurementEntries(name, seriesNames);
      if (timestamps.length === 0) return null;
      const series = {};
      for (const [sName, vals] of dataByName) series[sName] = vals;
      return { timestamps, series };
    }

    function listMeasurements() {
      return store.listMeasurementNames();
    }

    function setIntervalMs(ms) {
      const clamped = Math.max(MIN_INTERVAL_MS, Number(ms) || gen.intervalMs);
      service._restartWithNewInterval(gen, clamped);
    }

    function log(msg) {
      console.log(`[Generator:${gen.name}]`, msg);
    }

    return { ingest, getMeasurement, listMeasurements, setIntervalMs, log };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _makeRuntime(rec) {
    const kind = rec.kind === "prebuilt" ? "prebuilt" : "custom";
    const base = {
      id:         rec.id,
      name:       rec.name,
      enabled:    rec.enabled !== false,
      intervalMs: Math.max(MIN_INTERVAL_MS, Number(rec.intervalMs) || 1000),
      kind,
      state:      {},
      initError:  null,
      lastError:  null,
      _interval:  null
    };
    if (kind === "prebuilt") {
      const def          = CATALOG.get(rec.prebuiltId) || null;
      const configErrors = def ? validateConfig(def.paramSchema, rec.config || {}, def.validateFn) : { _: `Unknown prebuilt: "${rec.prebuiltId}"` };
      return { ...base, prebuiltId: rec.prebuiltId, config: rec.config || {}, configErrors, _prebuiltDef: def };
    }
    return { ...base, initCode: rec.initCode || "", code: rec.code || "", _initScript: null, _script: null };
  }
}

module.exports = { GeneratorService };
