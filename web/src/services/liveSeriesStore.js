import { sendSubscribe, setMessageHandler } from "./wsClient.js";

// Map<widgetId, { ids: string[], points: number, onData: fn }>
const widgetRegistrations = new Map();

// Per-measurement accumulated data buffer.
// Map<measurementName, { timestamps: number[], seriesByName: Map<dataName, (number|null)[]> }>
const measurementBuffers = new Map();

// Last subscription sent to the server (for dirty-checking).
let lastSentSubscription = null;

// Wire up the single WebSocket message handler.
setMessageHandler(handleServerMessage);

/**
 * Register or update a widget's live data subscription.
 * @param {string} widgetId
 * @param {string[]} ids - compound "measurementName:dataName" identifiers
 * @param {number} points
 * @param {function} onData - called with { timestamps, series } aligned data
 */
function registerWidget(widgetId, ids, points, onData) {
  widgetRegistrations.set(widgetId, { ids, points, onData });
  _syncSubscription();
}

/**
 * Remove a widget's live data subscription.
 * @param {string} widgetId
 */
function unregisterWidget(widgetId) {
  widgetRegistrations.delete(widgetId);
  _syncSubscription();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recompute the merged subscription and send it to the server if it changed.
 */
function _syncSubscription() {
  // Group by measurementName: union of series, max of points.
  const byMeasurement = new Map(); // measurementName -> { series: Set<dataName>, points: number }

  for (const { ids, points } of widgetRegistrations.values()) {
    for (const compound of ids) {
      const colonIdx = compound.indexOf(":");
      if (colonIdx <= 0) continue;
      const measurementName = compound.slice(0, colonIdx);
      const dataName = compound.slice(colonIdx + 1);

      let entry = byMeasurement.get(measurementName);
      if (!entry) {
        entry = { series: new Set(), points: 0 };
        byMeasurement.set(measurementName, entry);
      }
      entry.series.add(dataName);
      entry.points = Math.max(entry.points, points);
    }
  }

  if (byMeasurement.size === 0) {
    lastSentSubscription = null;
    return;
  }

  const measurements = Array.from(byMeasurement.entries()).map(([measurementName, entry]) => ({
    measurementName,
    series: Array.from(entry.series),
    points: entry.points
  }));

  const serialized = JSON.stringify(measurements);
  if (serialized === lastSentSubscription) return;

  // Clear buffers for measurements whose points limit increased (snapshot will repopulate).
  if (lastSentSubscription) {
    const prev = JSON.parse(lastSentSubscription);
    const prevByName = new Map(prev.map((m) => [m.measurementName, m.points]));
    for (const { measurementName, points } of measurements) {
      const prevPoints = prevByName.get(measurementName) ?? 0;
      if (points > prevPoints) {
        measurementBuffers.delete(measurementName);
      }
    }
  }

  lastSentSubscription = serialized;
  sendSubscribe({ type: "subscribe", measurements });
}

/**
 * Handle incoming WebSocket messages from the server.
 */
function handleServerMessage(message) {
  if (message.type === "snapshot") {
    for (const m of message.measurements || []) {
      // Replace the buffer entirely.
      const seriesByName = new Map();
      for (const s of m.series || []) {
        seriesByName.set(s.name, s.values ? [...s.values] : []);
      }
      measurementBuffers.set(m.measurementName, {
        timestamps: [...m.timestamps],
        seriesByName,
        time: m.time ?? true
      });
    }
    _fanOut(message.measurements.map((m) => m.measurementName));
  } else if (message.type === "delta") {
    const updatedMeasurements = [];
    for (const m of message.measurements || []) {
      let buf = measurementBuffers.get(m.measurementName);
      if (!buf) continue; // No snapshot received yet; ignore delta.

      // If the server cleared the measurement, drop the local buffer so the
      // incoming points form a completely fresh dataset.
      if (m.cleared) {
        buf = { timestamps: [], seriesByName: new Map(), time: buf.time ?? true };
        measurementBuffers.set(m.measurementName, buf);
      }
      // Update the time flag if the server sends a new value.
      if (m.time !== undefined) {
        buf.time = m.time;
      }

      // Append new points.
      buf.timestamps.push(...m.timestamps);
      for (const s of m.series || []) {
        let existing = buf.seriesByName.get(s.name);
        if (!existing) {
          existing = new Array(buf.timestamps.length - m.timestamps.length).fill(null);
          buf.seriesByName.set(s.name, existing);
        }
        existing.push(...(s.values || []));
      }

      // Trim buffer to max(points) for this measurement across all widgets.
      const maxPoints = _maxPointsForMeasurement(m.measurementName);
      if (buf.timestamps.length > maxPoints) {
        const excess = buf.timestamps.length - maxPoints;
        buf.timestamps.splice(0, excess);
        for (const values of buf.seriesByName.values()) {
          values.splice(0, excess);
        }
      }

      updatedMeasurements.push(m.measurementName);
    }
    if (updatedMeasurements.length > 0) {
      _fanOut(updatedMeasurements);
    }
  }
}

function _maxPointsForMeasurement(measurementName) {
  let max = 0;
  for (const { ids, points } of widgetRegistrations.values()) {
    for (const compound of ids) {
      const colonIdx = compound.indexOf(":");
      if (colonIdx > 0 && compound.slice(0, colonIdx) === measurementName) {
        max = Math.max(max, points);
        break;
      }
    }
  }
  return max || 120;
}

/**
 * Fan out data from the buffer to all interested widgets.
 * @param {string[]} updatedMeasurementNames
 */
function _fanOut(updatedMeasurementNames) {
  const updatedSet = new Set(updatedMeasurementNames);

  for (const [, { ids, points, onData }] of widgetRegistrations) {
    // Determine which measurements this widget cares about that were updated.
    const widgetMeasurements = new Map(); // measurementName -> Set<dataName>
    for (const compound of ids) {
      const colonIdx = compound.indexOf(":");
      if (colonIdx <= 0) continue;
      const measurementName = compound.slice(0, colonIdx);
      const dataName = compound.slice(colonIdx + 1);
      if (!updatedSet.has(measurementName)) continue;
      let names = widgetMeasurements.get(measurementName);
      if (!names) {
        names = new Set();
        widgetMeasurements.set(measurementName, names);
      }
      names.add(dataName);
    }

    if (widgetMeasurements.size === 0) continue;

    // Build measurement groups for this widget, sliced to its points limit.
    const measurementsForWidget = [];
    for (const [measurementName, dataNames] of widgetMeasurements) {
      const buf = measurementBuffers.get(measurementName);
      if (!buf) continue;

      const totalLen = buf.timestamps.length;
      const startIdx = Math.max(0, totalLen - points);
      const timestamps = buf.timestamps.slice(startIdx);

      const seriesArr = [];
      for (const dataName of dataNames) {
        if (!buf.seriesByName.has(dataName)) continue;
        const values = buf.seriesByName.get(dataName);
        seriesArr.push({
          name: dataName,
          values: values ? values.slice(startIdx) : new Array(timestamps.length).fill(null)
        });
      }

      if (seriesArr.length === 0) continue;
      measurementsForWidget.push({
        measurementName,
        time: buf.time ?? true,
        timestamps,
        series: seriesArr
      });
    }

    if (measurementsForWidget.length === 0) continue;

    onData({ measurements: measurementsForWidget });
  }
}

export { registerWidget, unregisterWidget };
