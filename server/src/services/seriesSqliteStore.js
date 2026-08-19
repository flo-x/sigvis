"use strict";

const path  = require("node:path");
const Database = require("better-sqlite3");

const MAX_SLOTS          = 32;
const DEFAULT_MAX_POINTS = 500_000;
const DB_FILENAME        = "series.db";

// Column names for v01…v32.
const VALUE_COLS = Array.from({ length: MAX_SLOTS }, (_, i) =>
  `v${String(i + 1).padStart(2, "0")}`
);

/**
 * Persistent SQLite backing store for time-series data.
 *
 * Schema
 * ──────
 *   measurements(id, name UNIQUE, is_time)
 *   series_slots(measurement_id, slot 1–32, name UNIQUE per measurement)
 *   points(measurement_id, ts, v01…v32)  PRIMARY KEY (measurement_id, ts)
 *
 * Each measurement row in `points` stores up to 32 series values side-by-side,
 * so timestamps are stored once per measurement rather than once per series.
 * Series names are mapped to fixed column slots via `series_slots`, which is
 * cleared together with `points` when clearMeasurement() is called.
 *
 * Usage
 * ─────
 *   const store = new SeriesSqliteStore({ dataDir, defaultMaxPoints, ingestErrorLog });
 *   store.open();
 *   store.loadIntoStore(seriesStore);   // before any update callback is registered
 *   seriesStore.setPersistCallback((name, ts, series, isTime) =>
 *     store.persistPoints(name, ts, series, isTime));
 *   seriesStore.setClearCallback(name => store.clearMeasurement(name));
 */
class SeriesSqliteStore {
  constructor({ dataDir, defaultMaxPoints = DEFAULT_MAX_POINTS, ingestErrorLog = null } = {}) {
    this._dbPath         = path.join(dataDir, DB_FILENAME);
    this._defaultMaxPts  = defaultMaxPoints;
    this._ingestErrorLog = ingestErrorLog;
    this._enabled        = false;
    this._db             = null;

    // In-memory slot cache: Map<measurementName, Map<seriesName, slotNumber>>
    this._slotCache = new Map();
    // In-memory measurement id cache: Map<measurementName, { id, isTime }>
    this._measurementCache = new Map();

    // Prepared statements — populated in open()
    this._stmts = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  open() {
    const fs = require("node:fs");
    fs.mkdirSync(path.dirname(this._dbPath), { recursive: true });
    const db = new Database(this._dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
      CREATE TABLE IF NOT EXISTS measurements (
        id      INTEGER PRIMARY KEY,
        name    TEXT    NOT NULL UNIQUE,
        is_time INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS series_slots (
        measurement_id INTEGER NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
        slot           INTEGER NOT NULL,
        name           TEXT    NOT NULL,
        PRIMARY KEY (measurement_id, slot),
        UNIQUE (measurement_id, name)
      );

      CREATE TABLE IF NOT EXISTS points (
        measurement_id INTEGER NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
        ts             REAL    NOT NULL,
        ${VALUE_COLS.map((c) => `${c} REAL`).join(",\n        ")},
        PRIMARY KEY (measurement_id, ts)
      );
    `);

    this._db = db;
    this._prepareStatements();
    this._loadCaches();
    console.log(`[SQLite] Opened ${this._dbPath}`);
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  setEnabled(enabled) {
    this._enabled = Boolean(enabled);
    console.log(`[SQLite] Persistence ${this._enabled ? "enabled" : "disabled"}.`);
  }

  isEnabled() {
    return this._enabled;
  }

  // ── Startup load ───────────────────────────────────────────────────────────

  /**
   * Populate seriesStore from SQLite.  Must be called BEFORE any update
   * callback is registered on seriesStore so no WebSocket pushes fire.
   */
  loadIntoStore(seriesStore) {
    if (!this._db) { throw new Error("[SQLite] DB not open"); }
    const measurements = this._db.prepare("SELECT id, name, is_time FROM measurements").all();
    let totalLoaded = 0;

    for (const m of measurements) {
      const slots = this._db
        .prepare("SELECT slot, name FROM series_slots WHERE measurement_id = ? ORDER BY slot ASC")
        .all(m.id);

      if (slots.length === 0) { continue; }

      const maxPts = seriesStore.getMaxPoints(m.name);

      // Read the last maxPts rows in ascending order.
      const rows = this._db
        .prepare(
          `SELECT ts, ${VALUE_COLS.join(", ")} FROM points
           WHERE measurement_id = ?
           ORDER BY ts DESC LIMIT ?`
        )
        .all(m.id, maxPts)
        .reverse();

      if (rows.length === 0) { continue; }

      const timestamps = rows.map((r) => r.ts);
      const seriesArray = slots.map(({ slot, name }) => {
        const col = VALUE_COLS[slot - 1];
        return { name, values: rows.map((r) => r[col]) };
      });

      seriesStore.setMeasurementTimeFlag(m.name, m.is_time === 1);
      seriesStore.ingestMeasurementPoints(m.name, timestamps, seriesArray);
      totalLoaded += rows.length;
    }

    console.log(`[SQLite] Loaded ${totalLoaded} rows from ${measurements.length} measurement(s).`);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Persist a batch of points for one measurement.
   * Called from the persistCallback registered on SeriesInMemoryStore.
   *
   * @param {string}   measurementName
   * @param {number[]} timestamps        strictly increasing
   * @param {{ name: string, values: (number|null)[] }[]} seriesArray
   * @param {boolean}  isTime
   * @param {{ replace?: boolean }} [options]
   *   replace: true  → mirrors ingestMeasurementPoints: DELETE all existing rows
   *                    with ts >= timestamps[0] before inserting the new batch.
   *   replace: false → mirrors mergeSeriesPoints: UPSERT only, keep existing rows.
   */
  persistPoints(measurementName, timestamps, seriesArray, isTime, { replace = false } = {}) {
    if (!this._enabled || !this._db) { return; }
    if (timestamps.length === 0 || seriesArray.length === 0) { return; }

    let slotMap;
    try {
      const measurementId = this._ensureMeasurement(measurementName, isTime);
      slotMap = this._resolveSlots(measurementId, measurementName, seriesArray.map((s) => s.name));
    } catch (err) {
      console.error(`[SQLite] persistPoints error (${measurementName}):`, err.message);
      this._ingestErrorLog?.add({ source: "sqlite", measurementName, error: err.message });
      return;
    }

    const measurementId = this._measurementCache.get(measurementName).id;

    // Build a 34-element row: measurement_id, ts, v01…v32.
    // For each timestamp, fill in values for the series we have; NULLs for the rest.
    // COALESCE in ON CONFLICT keeps any pre-existing values we didn't write.
    const colList = `measurement_id, ts, ${VALUE_COLS.join(", ")}`;
    const placeholders = `?, ?, ${VALUE_COLS.map(() => "?").join(", ")}`;
    const updateClauses = VALUE_COLS.map((c) => `${c} = COALESCE(excluded.${c}, ${c})`).join(", ");
    const sql = `INSERT INTO points (${colList}) VALUES (${placeholders})
                 ON CONFLICT(measurement_id, ts) DO UPDATE SET ${updateClauses}`;

    // Pre-build series index arrays for fast inner-loop access.
    const slotIndices = seriesArray.map(({ name }) => slotMap.get(name) - 1); // 0-based

    const rowParams = timestamps.map((ts, ti) => {
      const vals = new Array(MAX_SLOTS).fill(null);
      for (let si = 0; si < seriesArray.length; si++) {
        vals[slotIndices[si]] = seriesArray[si].values[ti] ?? null;
      }
      return [measurementId, ts, ...vals];
    });

    this._db.transaction(() => {
      // Mirror the in-memory truncation: delete any SQLite rows at ts >= firstTimestamp
      // so orphaned rows cannot be reloaded on the next restart.
      if (replace) {
        this._stmts.deletePointsFrom.run(measurementId, timestamps[0]);
      }
      const stmt = this._db.prepare(sql);
      for (const row of rowParams) {
        stmt.run(row);
      }
    })();

    this._trim(measurementId, measurementName);
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  /**
   * Delete all data and slot assignments for a measurement.
   * Called when SeriesInMemoryStore.clearMeasurementData() is invoked.
   */
  clearMeasurement(measurementName) {
    if (!this._db) { return; }
    const entry = this._measurementCache.get(measurementName);
    if (!entry) { return; }

    this._db.transaction(() => {
      this._stmts.deletePoints.run(entry.id);
      this._stmts.deleteSlots.run(entry.id);
    })();

    this._slotCache.delete(measurementName);
    console.log(`[SQLite] Cleared measurement "${measurementName}".`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _prepareStatements() {
    const db = this._db;
    this._stmts = {
      getMeasurement:     db.prepare("SELECT id, is_time FROM measurements WHERE name = ?"),
      insertMeasurement:  db.prepare("INSERT OR IGNORE INTO measurements (name, is_time) VALUES (?, ?)"),
      getSlots:           db.prepare("SELECT slot, name FROM series_slots WHERE measurement_id = ?"),
      insertSlot:         db.prepare("INSERT INTO series_slots (measurement_id, slot, name) VALUES (?, ?, ?)"),
      deletePoints:       db.prepare("DELETE FROM points WHERE measurement_id = ?"),
      deletePointsFrom:   db.prepare("DELETE FROM points WHERE measurement_id = ? AND ts >= ?"),
      deleteSlots:        db.prepare("DELETE FROM series_slots WHERE measurement_id = ?"),
      trimPoints:         db.prepare(
        `DELETE FROM points WHERE measurement_id = ? AND ts < (
           SELECT ts FROM points WHERE measurement_id = ? ORDER BY ts DESC LIMIT 1 OFFSET ?
         )`
      ),
      countPoints:        db.prepare("SELECT COUNT(*) AS n FROM points WHERE measurement_id = ?")
    };
  }

  _loadCaches() {
    const measurements = this._db.prepare("SELECT id, name, is_time FROM measurements").all();
    for (const m of measurements) {
      this._measurementCache.set(m.name, { id: m.id, isTime: m.is_time === 1 });
      const slots = this._db
        .prepare("SELECT slot, name FROM series_slots WHERE measurement_id = ?")
        .all(m.id);
      const slotMap = new Map(slots.map((s) => [s.name, s.slot]));
      this._slotCache.set(m.name, slotMap);
    }
  }

  _ensureMeasurement(name, isTime) {
    if (this._measurementCache.has(name)) {
      return this._measurementCache.get(name).id;
    }
    const isTimeInt = isTime !== false ? 1 : 0;
    this._stmts.insertMeasurement.run(name, isTimeInt);
    const row = this._stmts.getMeasurement.get(name);
    this._measurementCache.set(name, { id: row.id, isTime: isTime !== false });
    this._slotCache.set(name, new Map());
    return row.id;
  }

  _resolveSlots(measurementId, measurementName, seriesNames) {
    const slotMap = this._slotCache.get(measurementName) ?? new Map();
    const newAssignments = [];

    const usedSlots = new Set(slotMap.values());

    for (const name of seriesNames) {
      if (slotMap.has(name)) { continue; }

      // Find lowest free slot.
      let freeSlot = null;
      for (let s = 1; s <= MAX_SLOTS; s++) {
        if (!usedSlots.has(s)) {
          freeSlot = s;
          break;
        }
      }

      if (freeSlot === null) {
        throw new Error(
          `Measurement "${measurementName}" has reached the maximum of ${MAX_SLOTS} series. ` +
          `Cannot add series "${name}".`
        );
      }

      slotMap.set(name, freeSlot);
      usedSlots.add(freeSlot);
      newAssignments.push({ slot: freeSlot, name });
    }

    if (newAssignments.length > 0) {
      const insertSlots = this._db.transaction(() => {
        for (const { slot, name } of newAssignments) {
          this._stmts.insertSlot.run(measurementId, slot, name);
        }
      });
      insertSlots();
      this._slotCache.set(measurementName, slotMap);
    }

    return slotMap;
  }

  _trim(measurementId, measurementName) {
    const maxPts = this._defaultMaxPts;
    this._stmts.trimPoints.run(measurementId, measurementId, maxPts);
  }
}

module.exports = { SeriesSqliteStore };
