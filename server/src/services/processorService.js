"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseIngestPayload } = require("../utils/ingestPayloadParser");
const dspLib = require("../lib/dsp");
const { CATALOG } = require("../prebuilts/index");
const { validateConfig } = require("../utils/validateConfig");
const { compileScript, runScript, buildSandbox } = require("../lib/scriptSandbox");

const PROCESSORS_FILE = "processors.json";

// Modules accessible via require() inside custom processor scripts.
const MODULE_REGISTRY = new Map([["dsp", dspLib]]);

/**
 * Manages user-defined JavaScript processors that run automatically after
 * every ingest and can read/write any measurement in the store.
 *
 * Each processor has kind "custom" or "prebuilt":
 *
 * Custom:
 *   - id, name, enabled, initCode, code  (persisted)
 *   - state {}, lastProcessedTs, initError, lastError, _initScript, _script  (in-memory)
 *
 * Prebuilt:
 *   - id, name, enabled, kind:"prebuilt", prebuiltId, config  (persisted)
 *   - state {}, lastProcessedTs, initError, lastError, configErrors {}, _prebuiltDef  (in-memory)
 *
 * Direct API for prebuilts:
 *   initFn(state, config, api) / processFn(state, config, api)
 *   api: { ingest, getMeasurement, listMeasurements, getNewPointCount, log }
 */
class ProcessorService {
  constructor({ seriesStore, dataDir, ingestErrorLog }) {
    this._store = seriesStore;
    this._dataDir = dataDir;
    this._ingestErrorLog = ingestErrorLog || null;
    this._filePath = path.join(dataDir, PROCESSORS_FILE);

    this._processors = new Map();
    this._running = false;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  load() {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const raw = fs.readFileSync(this._filePath, "utf8");
      const records = JSON.parse(raw);
      if (!Array.isArray(records)) return;
      for (const rec of records) {
        if (!rec.id) continue;
        if (rec.kind === "prebuilt") {
          if (!rec.prebuiltId) continue;
        } else {
          if (typeof rec.code !== "string") continue;
        }
        const proc = this._makeRuntime(rec);
        this._processors.set(rec.id, proc);
        this._runInit(proc);
      }
      console.log(`[Processors] Loaded ${this._processors.size} processor(s) from disk.`);
    } catch (err) {
      console.error("[Processors] Failed to load processors.json:", err.message);
    }
  }

  _save() {
    const records = Array.from(this._processors.values()).map((p) => {
      if (p.kind === "prebuilt") {
        return { id: p.id, name: p.name, enabled: p.enabled,
                 kind: "prebuilt", prebuiltId: p.prebuiltId, config: p.config };
      }
      return { id: p.id, name: p.name, enabled: p.enabled, initCode: p.initCode, code: p.code };
    });
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify(records, null, 2), "utf8");
    } catch (err) {
      console.error("[Processors] Failed to save processors.json:", err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  list() {
    return Array.from(this._processors.values()).map((p) => ({
      id:           p.id,
      name:         p.name,
      enabled:      p.enabled,
      kind:         p.kind,
      prebuiltId:   p.kind === "prebuilt" ? p.prebuiltId  : undefined,
      initError:    p.initError  || null,
      lastError:    p.lastError  || null,
      configErrors: p.kind === "prebuilt" ? (p.configErrors || {}) : undefined
    }));
  }

  get(id) {
    const p = this._processors.get(id);
    if (!p) return null;
    const base = {
      id:        p.id,
      name:      p.name,
      enabled:   p.enabled,
      kind:      p.kind,
      initError: p.initError || null,
      lastError: p.lastError || null
    };
    if (p.kind === "prebuilt") {
      return { ...base, prebuiltId: p.prebuiltId, config: p.config, configErrors: p.configErrors || {} };
    }
    return { ...base, initCode: p.initCode, code: p.code };
  }

  create(data) {
    const id   = crypto.randomUUID();
    const kind = data.kind === "prebuilt" ? "prebuilt" : "custom";
    const base = {
      id,
      name:    String(data.name || "").trim() || (kind === "prebuilt" ? "Untitled Prebuilt" : "Untitled Processor"),
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
      kind
    };
    let record;
    if (kind === "prebuilt") {
      record = { ...base, prebuiltId: String(data.prebuiltId || ""), config: data.config || {} };
    } else {
      record = { ...base, initCode: String(data.initCode || ""), code: String(data.code || "") };
    }
    const proc = this._makeRuntime(record);
    this._processors.set(id, proc);
    this._save();
    this._runInit(proc);
    return this.get(id);
  }

  update(id, data) {
    const p = this._processors.get(id);
    if (!p) return null;

    const { name, enabled, initCode, code, clearState = false, prebuiltId, config } = data;

    if (name    !== undefined) p.name    = String(name).trim() || p.name;
    if (enabled !== undefined) p.enabled = Boolean(enabled);

    let rerunInit = false;

    if (p.kind === "prebuilt") {
      if (prebuiltId !== undefined) { p.prebuiltId = String(prebuiltId); p._prebuiltDef = null; }
      if (config     !== undefined) { p.config = config; }
      p._prebuiltDef = CATALOG.get(p.prebuiltId) || null;
      p.configErrors = p._prebuiltDef
        ? validateConfig(p._prebuiltDef.paramSchema, p.config, p._prebuiltDef.validateFn)
        : { _: `Unknown prebuilt: "${p.prebuiltId}"` };
      rerunInit = true;
    } else {
      if (initCode !== undefined) { p.initCode = String(initCode); p._initScript = null; rerunInit = true; }
      if (code     !== undefined) { p.code     = String(code);     p._script     = null; }
    }

    if (clearState) { p.state = {}; rerunInit = true; }

    this._save();
    if (rerunInit) this._runInit(p);
    return this.get(id);
  }

  delete(id) {
    const existed = this._processors.has(id);
    this._processors.delete(id);
    if (existed) this._save();
    return existed;
  }

  reorder(ids) {
    const next = new Map();
    for (const id of ids) {
      if (this._processors.has(id)) {
        next.set(id, this._processors.get(id));
      }
    }
    for (const [id, proc] of this._processors) {
      if (!next.has(id)) {
        next.set(id, proc);
      }
    }
    this._processors = next;
    this._save();
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  onMeasurementUpdated(measurementName) {
    if (this._running) return;
    this._running = true;
    try {
      for (const proc of this._processors.values()) {
        if (!proc.enabled) continue;
        this._runProcessor(proc, measurementName);
      }
    } finally {
      this._running = false;
    }
  }

  _runInit(proc) {
    proc.initError = null;

    if (proc.kind === "prebuilt") {
      const def = proc._prebuiltDef;
      if (!def) { proc.initError = `Unknown prebuilt: "${proc.prebuiltId}"`; return; }
      if (Object.keys(proc.configErrors || {}).length > 0) {
        proc.initError = "Config has errors — fix them and save again.";
        return;
      }
      if (typeof def.initFn !== "function") return;
      try {
        def.initFn(proc.state, proc.config, this._buildApi(proc));
        console.log(`[Processor-init:${proc.name}] Init ran successfully.`);
      } catch (err) {
        proc.initError = err.message;
        console.error(`[Processor-init:${proc.name}] Runtime error: ${err.message}`);
      }
      return;
    }

    // Custom script path.
    if (!proc.initCode || !proc.initCode.trim()) return;

    const initFilename = `processor-init:${proc.name}`;
    if (!proc._initScript) {
      const { script, error } = compileScript(proc.initCode, initFilename);
      if (error) {
        proc.initError = error;
        console.error(`[Processor-init:${proc.name}] ${error}`);
        return;
      }
      proc._initScript = script;
    }

    const sandbox = buildSandbox(this._buildApi(proc), proc.state, MODULE_REGISTRY);
    const runError = runScript(proc._initScript, sandbox, initFilename);
    if (runError) {
      proc.initError = runError;
      console.error(`[Processor-init:${proc.name}] Runtime error: ${runError}`);
    } else {
      console.log(`[Processor-init:${proc.name}] Init ran successfully.`);
    }
  }

  // _measurementName is available for future per-measurement filtering; currently unused.
  _runProcessor(proc, _measurementName) {
    if (proc.kind === "prebuilt") {
      const def = proc._prebuiltDef;
      if (!def || typeof def.processFn !== "function") return;
      if (Object.keys(proc.configErrors || {}).length > 0) return;
      try {
        def.processFn(proc.state, proc.config, this._buildApi(proc));
        proc.lastError = null;
      } catch (err) {
        proc.lastError = err.message;
        console.error(`[Processor:${proc.name}] Runtime error: ${err.message}`);
      }
      this._advanceLastProcessedTs(proc);
      return;
    }

    // Custom script path.
    if (!proc.code || !proc.code.trim()) return;

    const procFilename = `processor:${proc.name}`;
    if (!proc._script) {
      const { script, error } = compileScript(proc.code, procFilename);
      if (error) {
        proc.lastError = error;
        console.error(`[Processor:${proc.name}] ${error}`);
        return;
      }
      proc._script = script;
    }

    const sandbox = buildSandbox(this._buildApi(proc), proc.state, MODULE_REGISTRY);
    const runError = runScript(proc._script, sandbox, procFilename);
    proc.lastError = runError;
    if (runError) console.error(`[Processor:${proc.name}] Runtime error: ${runError}`);

    this._advanceLastProcessedTs(proc);
  }

  // ---------------------------------------------------------------------------
  // Sandbox helpers
  // ---------------------------------------------------------------------------

  /** Build the api object passed to prebuilt initFn / processFn. */
  _buildApi(proc) {
    const store = this._store;
    const ingestErrorLog = this._ingestErrorLog;

    function _computeNewCount(measurementName, timestamps) {
      const lastTs = proc.lastProcessedTs.get(measurementName) ?? -Infinity;
      let count = 0;
      for (let i = timestamps.length - 1; i >= 0; i--) {
        if (timestamps[i] <= lastTs) break;
        count++;
      }
      return count;
    }

    function getMeasurement(name) {
      const measurement = store.measurementsByName.get(name);
      if (!measurement || measurement.dataByName.size === 0) return null;
      const seriesNames = Array.from(measurement.dataByName.keys());
      const { timestamps, dataByName } = store.getMeasurementEntries(name, seriesNames);
      if (timestamps.length === 0) return null;
      const series = {};
      for (const [sName, vals] of dataByName) series[sName] = vals;

      const newCount = _computeNewCount(name, timestamps);
      const newStart = timestamps.length - newCount;

      return {
        timestamps,
        series,
        getNewPointCount()       { return newCount; },
        getNewTimestamps()       { return timestamps.slice(newStart); },
        getNewValues(seriesName) { return series[seriesName]?.slice(newStart) ?? []; },
      };
    }

    function listMeasurements() {
      return store.listMeasurementNames();
    }

    function getNewPointCount(measurementName) {
      return getMeasurement(measurementName)?.getNewPointCount() ?? 0;
    }

    function ingest(payload) {
      try {
        const parsed = parseIngestPayload(payload);
        if (!parsed.ok) throw new Error(`ingest() validation failed: ${parsed.error}`);
        const { measurementName, clearMeasurement, time, normalizedTs, normalizedSeries } = parsed;
        if (clearMeasurement) store.clearMeasurementData(measurementName);
        store.setMeasurementTimeFlag(measurementName, time);
        store.mergeSeriesPoints(measurementName, normalizedTs, normalizedSeries);
      } catch (err) {
        ingestErrorLog?.record(`Processor:${proc.name}`, err.message);
        throw err;
      }
    }

    function log(msg) {
      console.log(`[Processor:${proc.name}]`, msg);
    }

    return { getMeasurement, listMeasurements, getNewPointCount, ingest, log };
  }

  _advanceLastProcessedTs(proc) {
    for (const [measurementName, measurement] of this._store.measurementsByName) {
      if (measurement.timestamps.length > 0) {
        proc.lastProcessedTs.set(measurementName, measurement.timestamps[measurement.timestamps.length - 1]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _makeRuntime(rec) {
    const kind = rec.kind === "prebuilt" ? "prebuilt" : "custom";
    const base = {
      id:              rec.id,
      name:            rec.name,
      enabled:         rec.enabled !== false,
      kind,
      state:           {},
      lastProcessedTs: new Map(),
      initError:       null,
      lastError:       null
    };
    if (kind === "prebuilt") {
      const def          = CATALOG.get(rec.prebuiltId) || null;
      const configErrors = def ? validateConfig(def.paramSchema, rec.config || {}, def.validateFn) : { _: `Unknown prebuilt: "${rec.prebuiltId}"` };
      return { ...base, prebuiltId: rec.prebuiltId, config: rec.config || {}, configErrors, _prebuiltDef: def };
    }
    return { ...base, initCode: rec.initCode || "", code: rec.code || "", _initScript: null, _script: null };
  }
}

module.exports = { ProcessorService };
