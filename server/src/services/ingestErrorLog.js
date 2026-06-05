"use strict";

const MAX_ERRORS = 50;

/**
 * Shared in-memory log for ingest errors across all ingestion paths
 * (HTTP, MQTT, generators, processors).
 *
 * Each entry: { ts: number, source: string, message: string }
 * The ring buffer keeps at most MAX_ERRORS entries (oldest discarded first).
 */
class IngestErrorLog {
  constructor() {
    this._errors = [];
  }

  /**
   * Record a new ingest error.
   * @param {string} source  - Human-readable source label, e.g. "MQTT", "HTTP", "Generator:my-gen"
   * @param {string} message - Error description
   */
  record(source, message) {
    this._errors.push({ ts: Date.now(), source, message });
    if (this._errors.length > MAX_ERRORS) {
      this._errors.shift();
    }
  }

  /** Returns a shallow copy of all recorded errors (oldest first). */
  getAll() {
    return this._errors.slice();
  }

  /** Clears all recorded errors. */
  clear() {
    this._errors = [];
  }
}

module.exports = { IngestErrorLog };
