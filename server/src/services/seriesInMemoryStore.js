"use strict";

const DEFAULT_MAX_POINTS = 50_000;

class SeriesInMemoryStore {
  constructor({
    defaultThresholdSeconds = 600,
    defaultMaxPoints        = DEFAULT_MAX_POINTS,
    measurementConfigService = null
  } = {}) {
    this.defaultThresholdSeconds   = defaultThresholdSeconds;
    this.defaultMaxPoints          = defaultMaxPoints;
    this._measurementConfigService = measurementConfigService;
    // Map<measurementName, { timestamps: number[], dataByName: Map<dataName, number[]> }>
    this.measurementsByName    = new Map();
    this.thresholdSecondsByName = new Map();
    this.maxPointsByName        = new Map();
    this.isPersistentByName     = new Map();
    // Map<measurementName, boolean> — whether x-axis values are Unix timestamps (true) or raw numbers (false)
    this.timeFlagByName = new Map();
    this._onUpdate       = null;
    this._persistCallback = null;
    this._clearCallback   = null;
    // Tracks measurements that were cleared since the last ingest, so the
    // update callback can signal "cleared" to downstream consumers.
    this._pendingClearSet = new Set();
  }

  setUpdateCallback(fn) {
    this._onUpdate = fn;
  }

  /** Called after every successful ingestMeasurementPoints / mergeSeriesPoints. */
  setPersistCallback(fn) {
    this._persistCallback = fn;
  }

  /** Called synchronously inside clearMeasurementData so the SQLite store can wipe its rows. */
  setClearCallback(fn) {
    this._clearCallback = fn;
  }

  getDefaultThresholdSeconds() {
    return this.defaultThresholdSeconds;
  }

  getDefaultMaxPoints() {
    return this.defaultMaxPoints;
  }

  getThresholdSeconds(measurementName) {
    return this.thresholdSecondsByName.get(measurementName) ?? this.defaultThresholdSeconds;
  }

  getMaxPoints(measurementName) {
    return this.maxPointsByName.get(measurementName) ?? this.defaultMaxPoints;
  }

  getMeasurementTimeFlag(measurementName) {
    return this.timeFlagByName.get(measurementName) ?? true;
  }

  setMeasurementTimeFlag(measurementName, time) {
    this.timeFlagByName.set(measurementName, time !== false);
  }

  setThresholdSeconds(measurementName, thresholdSeconds) {
    this.thresholdSecondsByName.set(measurementName, thresholdSeconds);
    this.pruneMeasurement(measurementName, Date.now());
    if (this._measurementConfigService) {
      this._measurementConfigService.set(measurementName, { thresholdSeconds });
    }
  }

  setMaxPoints(measurementName, maxPoints) {
    this.maxPointsByName.set(measurementName, maxPoints);
    this.pruneMeasurement(measurementName, Date.now());
    if (this._measurementConfigService) {
      this._measurementConfigService.set(measurementName, { maxPoints });
    }
  }

  getMeasurementPersistent(measurementName) {
    return this.isPersistentByName.get(measurementName) ?? true;
  }

  setPersistent(measurementName, persistent) {
    this.isPersistentByName.set(measurementName, Boolean(persistent));
    if (this._measurementConfigService) {
      this._measurementConfigService.set(measurementName, { isPersistent: Boolean(persistent) });
    }
  }

  ensureMeasurement(measurementName, { defaultPersistent = true } = {}) {
    if (!this.measurementsByName.has(measurementName)) {
      this.measurementsByName.set(measurementName, {
        timestamps: [],
        dataByName: new Map()
      });
      // Restore any previously saved per-measurement config on first creation.
      if (this._measurementConfigService) {
        const saved = this._measurementConfigService.get(measurementName);
        if (saved.thresholdSeconds !== undefined) {
          this.thresholdSecondsByName.set(measurementName, saved.thresholdSeconds);
        }
        if (saved.maxPoints !== undefined) {
          this.maxPointsByName.set(measurementName, saved.maxPoints);
        }
        // Use saved isPersistent if present, else fall back to the caller-supplied default.
        const persistent = saved.isPersistent !== undefined ? saved.isPersistent : defaultPersistent;
        this.isPersistentByName.set(measurementName, persistent);
      } else {
        this.isPersistentByName.set(measurementName, defaultPersistent);
      }
    }
    return this.measurementsByName.get(measurementName);
  }

  isStrictlyIncreasing(timestamps) {
    for (let idx = 1; idx < timestamps.length; idx += 1) {
      if (timestamps[idx] <= timestamps[idx - 1]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Ingest points into a measurement.
   * @param {string} measurementName
   * @param {number[]} timestamps - strictly increasing
   * @param {{ name: string, values: number[] }[]} seriesArray - one or more data series
   * @param {{ defaultPersistent?: boolean }} [options]
   */
  ingestMeasurementPoints(measurementName, timestamps, seriesArray, { defaultPersistent = true } = {}) {
    if (!this.isStrictlyIncreasing(timestamps)) {
      throw new Error("Timestamps must be strictly increasing.");
    }

    const measurement = this.ensureMeasurement(measurementName, { defaultPersistent });
    const firstTimestamp = timestamps[0];

    // Truncate any stored points that overlap with the incoming range.
    if (Number.isFinite(firstTimestamp)) {
      const keepCount = measurement.timestamps.findIndex((ts) => ts > firstTimestamp);
      if (keepCount !== -1) {
        measurement.timestamps.length = keepCount;
        for (const values of measurement.dataByName.values()) {
          values.length = keepCount;
        }
      }
    }

    // Ensure all requested data series exist in the map.
    for (const { name } of seriesArray) {
      if (!measurement.dataByName.has(name)) {
        measurement.dataByName.set(name, new Array(measurement.timestamps.length).fill(null));
      }
    }

    // Build a lookup from dataName → incoming values for fast access.
    const incomingByName = new Map(seriesArray.map(({ name, values }) => [name, values]));

    for (let idx = 0; idx < timestamps.length; idx += 1) {
      const timestamp = timestamps[idx];
      const lastIdx = measurement.timestamps.length - 1;

      if (lastIdx >= 0 && measurement.timestamps[lastIdx] === timestamp) {
        // Replace existing point at same timestamp.
        for (const [name, values] of measurement.dataByName) {
          const incoming = incomingByName.get(name);
          values[lastIdx] = incoming !== undefined ? incoming[idx] : null;
        }
      } else {
        measurement.timestamps.push(timestamp);
        for (const [name, values] of measurement.dataByName) {
          const incoming = incomingByName.get(name);
          values.push(incoming !== undefined ? incoming[idx] : null);
        }
      }
    }

    this.pruneMeasurement(measurementName, Date.now());
    if (this._onUpdate) {
      const cleared = this._pendingClearSet.delete(measurementName);
      this._onUpdate(measurementName, timestamps[0], cleared);
    }
    if (this.getMeasurementPersistent(measurementName)) {
      this._persistCallback?.(measurementName, timestamps, seriesArray, this.getMeasurementTimeFlag(measurementName), { replace: true });
    }
    return {
      ingestedCount: timestamps.length,
      totalPoints: measurement.timestamps.length
    };
  }

  pruneMeasurement(measurementName, nowMs) {
    const measurement = this.measurementsByName.get(measurementName);
    if (!measurement || measurement.timestamps.length === 0) {
      return;
    }

    // Time series: prune by age first (numeric series skip this step).
    if (this.getMeasurementTimeFlag(measurementName)) {
      const thresholdMs = this.getThresholdSeconds(measurementName) * 1000;
      const cutoff = nowMs - thresholdMs;
      let firstFreshIdx = 0;
      while (firstFreshIdx < measurement.timestamps.length && measurement.timestamps[firstFreshIdx] < cutoff) {
        firstFreshIdx += 1;
      }
      if (firstFreshIdx > 0) {
        measurement.timestamps.splice(0, firstFreshIdx);
        for (const values of measurement.dataByName.values()) {
          values.splice(0, firstFreshIdx);
        }
      }
    }

    // Both time and numeric series: cap at maxPoints (drop oldest first).
    const maxPts = this.getMaxPoints(measurementName);
    const excess = measurement.timestamps.length - maxPts;
    if (excess > 0) {
      measurement.timestamps.splice(0, excess);
      for (const values of measurement.dataByName.values()) {
        values.splice(0, excess);
      }
    }
  }

  /**
   * Retrieve entries for specific data series within a measurement.
   * @param {string} measurementName
   * @param {string[]} dataNames - which data series to include
   * @param {{ maxPoints?: number }} options
   * @returns {{ timestamps: number[], dataByName: Map<string, (number|null)[]> }}
   */
  getMeasurementEntries(measurementName, dataNames, { maxPoints } = {}) {
    const measurement = this.measurementsByName.get(measurementName);
    if (!measurement || measurement.timestamps.length === 0) {
      return { timestamps: [], dataByName: new Map(dataNames.map((n) => [n, []])) };
    }

    const totalPoints = measurement.timestamps.length;
    const startIdx =
      !Number.isFinite(maxPoints) || maxPoints <= 0 || totalPoints <= maxPoints
        ? 0
        : totalPoints - maxPoints;

    const timestamps = measurement.timestamps.slice(startIdx);
    const dataByName = new Map();
    for (const name of dataNames) {
      const values = measurement.dataByName.get(name);
      dataByName.set(name, values ? values.slice(startIdx) : new Array(timestamps.length).fill(null));
    }
    return { timestamps, dataByName };
  }

  /**
   * Merge new values for specific series into an existing measurement WITHOUT
   * truncating any other series.  Used by ProcessorService for derived series (e.g. EMA). Does a two-pointer sorted merge — only touches named series, fills others with `null`. Does **not** truncate siblings.
   *
   * @param {string} measurementName
   * @param {number[]} timestamps  – must be strictly increasing
   * @param {{ name: string, values: number[] }[]} seriesArray
   * @param {{ defaultPersistent?: boolean }} [options]
   */
  mergeSeriesPoints(measurementName, timestamps, seriesArray, { defaultPersistent = false } = {}) {
    if (timestamps.length === 0) { return; }

    const measurement = this.ensureMeasurement(measurementName, { defaultPersistent });

    // Ensure every target series exists (fill gaps with null).
    for (const { name } of seriesArray) {
      if (!measurement.dataByName.has(name)) {
        measurement.dataByName.set(name, new Array(measurement.timestamps.length).fill(null));
      }
    }

    const incomingByName = new Map(seriesArray.map(({ name, values }) => [name, values]));

    // Two-pointer merge: both arrays are sorted ascending.
    let storeIdx = 0;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];

      // Advance storeIdx until we reach or pass ts.
      while (storeIdx < measurement.timestamps.length && measurement.timestamps[storeIdx] < ts) {
        storeIdx++;
      }

      if (storeIdx < measurement.timestamps.length && measurement.timestamps[storeIdx] === ts) {
        // Timestamp already exists — update only the specified series.
        for (const [name, incoming] of incomingByName) {
          measurement.dataByName.get(name)[storeIdx] = incoming[i];
        }
        storeIdx++;
      } else {
        // New timestamp — insert in place, fill un-named series with null.
        measurement.timestamps.splice(storeIdx, 0, ts);
        for (const [name, values] of measurement.dataByName) {
          const incoming = incomingByName.get(name);
          values.splice(storeIdx, 0, incoming !== undefined ? incoming[i] : null);
        }
        storeIdx++;
      }
    }

    this.pruneMeasurement(measurementName, Date.now());
    if (this._onUpdate) {
      const cleared = this._pendingClearSet.delete(measurementName);
      this._onUpdate(measurementName, timestamps[0], cleared);
    }
    if (this.getMeasurementPersistent(measurementName)) {
      this._persistCallback?.(measurementName, timestamps, seriesArray, this.getMeasurementTimeFlag(measurementName), { replace: false });
    }
  }

  /**
   * Remove all stored data points and series for a measurement, leaving the
   * measurement entry itself (and its configured threshold) intact so that the
   * next ingest can write fresh data without needing to re-create it.
   */
  clearMeasurementData(measurementName) {
    const measurement = this.measurementsByName.get(measurementName);
    if (!measurement) { return; }
    measurement.timestamps.length = 0;
    measurement.dataByName.clear();
    this._pendingClearSet.add(measurementName);
    if (this.getMeasurementPersistent(measurementName)) {
      this._clearCallback?.(measurementName);
    }
  }

  hasMeasurementData(measurementName) {
    return (this.measurementsByName.get(measurementName)?.timestamps.length ?? 0) > 0;
  }

  listMeasurementNames() {
    const names = new Set([
      ...this.measurementsByName.keys(),
      ...this.thresholdSecondsByName.keys()
    ]);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Returns admin state per measurement.
   * @returns {{ measurementName: string, time: boolean, thresholdSeconds: number, maxPoints: number, pointCount: number, dataSeriesNames: string[] }[]}
   */
  listMeasurementsAdminState() {
    return this.listMeasurementNames().map((measurementName) => {
      const measurement = this.measurementsByName.get(measurementName);
      return {
        measurementName,
        time:             this.getMeasurementTimeFlag(measurementName),
        thresholdSeconds: this.getThresholdSeconds(measurementName),
        maxPoints:        this.getMaxPoints(measurementName),
        persistent:       this.getMeasurementPersistent(measurementName),
        pointCount:       measurement ? measurement.timestamps.length : 0,
        dataSeriesNames:  measurement ? Array.from(measurement.dataByName.keys()) : []
      };
    });
  }
}

module.exports = {
  SeriesInMemoryStore
};
