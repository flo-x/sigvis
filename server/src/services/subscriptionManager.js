"use strict";
/**
 * Manages one WebSocket subscription per connection.
 * Handles snapshot-on-subscribe and throttled delta pushes.
 */
class SubscriptionManager {
  /**
   * @param {{ seriesStore: import('./seriesInMemoryStore').SeriesInMemoryStore, minPushIntervalMs: number }} options
   */
  constructor({ seriesStore, minPushIntervalMs = 30 }) {
    this.seriesStore = seriesStore;
    this.minPushIntervalMs = minPushIntervalMs;

    // Map<ws, { measurements: [{measurementName, series[], points}], lastSentTsByMeasurement: Map<string,number> }>
    this.connections = new Map();

    // Map<measurementName, { lastPushedAt: number, pendingTimer: TimeoutId|null, minEarliestTs: number }>
    this.throttleState = new Map();
  }

  /**
   * Register or replace a subscription for a WebSocket connection.
   * Immediately sends a snapshot for all subscribed measurements.
   * @param {WebSocket} ws
   * @param {{ measurementName: string, series: string[], points: number }[]} measurementsArray
   */
  subscribe(ws, measurementsArray) {
    // Update connection state with a fresh lastSentTs map.
    this.connections.set(ws, {
      measurements: measurementsArray,
      lastSentTsByMeasurement: new Map()
    });

    this._sendSnapshot(ws);
  }

  /**
   * Remove a connection and clean up its state.
   * @param {WebSocket} ws
   */
  unsubscribeConnection(ws) {
    this.connections.delete(ws);
  }

  /**
   * Called by SeriesInMemoryStore after new points are ingested.
   * Throttles delta pushes per measurement.
   * @param {string} measurementName
   * @param {number} [earliestModifiedTs] - earliest timestamp that was added or overwritten.
   *   Defaults to Infinity (pure append; no previously-sent points were touched).
   * @param {boolean} [cleared] - true when the measurement was fully cleared before this ingest.
   *   Causes all per-connection cursors to reset so the delta carries all new data, and adds
   *   a `cleared: true` flag to the delta payload so the frontend can drop its local buffer.
   */
  notifyMeasurementUpdated(measurementName, earliestModifiedTs = Infinity, cleared = false) {
    const now = Date.now();
    let state = this.throttleState.get(measurementName);
    if (!state) {
      state = { lastPushedAt: 0, pendingTimer: null, minEarliestTs: Infinity, cleared: false };
      this.throttleState.set(measurementName, state);
    }

    // A clear overrides any prior throttle state for this window.
    if (cleared) {
      state.cleared = true;
      // Reset every connection's cursor so the coming delta includes all new data.
      for (const conn of this.connections.values()) {
        conn.lastSentTsByMeasurement.set(measurementName, 0);
      }
    }

    // Track the running minimum across the throttle window so we never miss an overwrite.
    state.minEarliestTs = Math.min(state.minEarliestTs, earliestModifiedTs);

    const elapsed = now - state.lastPushedAt;

    if (elapsed >= this.minPushIntervalMs) {
      // Push immediately.
      if (state.pendingTimer !== null) {
        clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
      }
      const minTs = state.minEarliestTs;
      const wasCleared = state.cleared;
      state.minEarliestTs = Infinity;
      state.cleared = false;
      state.lastPushedAt = now;
      this._sendDelta(measurementName, minTs, wasCleared);
    } else if (state.pendingTimer === null) {
      // Schedule a trailing push so no update is dropped.
      const remaining = this.minPushIntervalMs - elapsed;
      state.pendingTimer = setTimeout(() => {
        state.pendingTimer = null;
        const minTs = state.minEarliestTs;
        const wasCleared = state.cleared;
        state.minEarliestTs = Infinity;
        state.cleared = false;
        state.lastPushedAt = Date.now();
        this._sendDelta(measurementName, minTs, wasCleared);
      }, remaining);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _sendSnapshot(ws) {
    const conn = this.connections.get(ws);
    if (!conn || ws.readyState !== ws.OPEN) return;

    const snapshotMeasurements = [];

    for (const { measurementName, series, points } of conn.measurements) {
      const { timestamps, dataByName } = this.seriesStore.getMeasurementEntries(
        measurementName,
        series,
        { maxPoints: points }
      );

      const lastTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
      conn.lastSentTsByMeasurement.set(measurementName, lastTs);

      snapshotMeasurements.push({
        measurementName,
        time: this.seriesStore.getMeasurementTimeFlag(measurementName),
        timestamps,
        series: series.map((name) => ({
          name,
          values: dataByName.get(name) || new Array(timestamps.length).fill(null)
        }))
      });
    }

    this._send(ws, { type: "snapshot", measurements: snapshotMeasurements });
  }

  _sendDelta(measurementName, minEarliestTs = Infinity, cleared = false) {
    for (const [ws, conn] of this.connections) {
      if (ws.readyState !== ws.OPEN) continue;

      const measSub = conn.measurements.find((m) => m.measurementName === measurementName);
      if (!measSub) continue;

      const lastTs = conn.lastSentTsByMeasurement.get(measurementName) ?? 0;
      // When cleared, cursor was already reset to 0 in notifyMeasurementUpdated.
      // Otherwise rewind the cursor if any already-sent point was overwritten.
      const effectiveCutoff = cleared ? 0 : Math.min(lastTs, minEarliestTs - 1);

      // Fetch all stored data and filter to points newer than effectiveCutoff.
      const { timestamps, dataByName } = this.seriesStore.getMeasurementEntries(
        measurementName,
        measSub.series,
        { maxPoints: measSub.points }
      );

      const firstNewIdx = timestamps.findIndex((ts) => ts > effectiveCutoff);
      if (firstNewIdx === -1) continue; // No new points.

      const newTimestamps = timestamps.slice(firstNewIdx);
      const newLastTs = newTimestamps[newTimestamps.length - 1];
      conn.lastSentTsByMeasurement.set(measurementName, newLastTs);

      const measurementPayload = {
        measurementName,
        time: this.seriesStore.getMeasurementTimeFlag(measurementName),
        timestamps: newTimestamps,
        series: measSub.series.map((name) => ({
          name,
          values: (dataByName.get(name) || []).slice(firstNewIdx)
        }))
      };
      if (cleared) measurementPayload.cleared = true;

      this._send(ws, {
        type: "delta",
        measurements: [measurementPayload]
      });
    }
  }

  _send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch (_err) {
      // Ignore send errors; close handler will clean up.
    }
  }
}

module.exports = { SubscriptionManager };
