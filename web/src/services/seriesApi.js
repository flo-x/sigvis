import { alignMeasurements } from "../utils/alignMeasurements.js";
import { parseResponse, fetchNoCache } from "../utils/http.js";

/**
 * Fetch the series catalog and return a flat list of items, one per data series.
 * Each item: { id: "measurementName:dataName", name: "Measurement / dataName", unit, color }
 */
async function getSeriesCatalog() {
  const response = await fetchNoCache("/api/series/catalog");
  const data = await parseResponse(response);
  const items = [];
  for (const measurement of data.items || []) {
    for (const series of measurement.series || []) {
      items.push({
        id: `${measurement.measurementName}:${series.name}`,
        name: `${measurement.measurementName} / ${series.name}`,
        unit: series.unit
      });
    }
  }
  return items;
}

/**
 * Fetch series data.
 * @param {{ ids: string[], points?: number, interval?: number }} options
 *   ids — compound identifiers in "measurementName:dataName" format
 * @returns {{ timestamps: number[], series: object[], points: number, intervalSec: number }}
 */
async function getSeriesData({ ids, points = 120, interval = 30 }) {
  const query = new URLSearchParams({
    series: ids.join(","),
    points: String(points),
    interval: String(interval)
  });
  const response = await fetchNoCache(`/api/series/data?${query.toString()}`);
  const data = await parseResponse(response);

  const measurements = data.measurements || [];
  const aligned = alignMeasurements(measurements);
  // Use the time flag from the first measurement (default true).
  const time = measurements[0]?.time ?? true;
  return {
    points: aligned.timestamps.length,
    intervalSec: interval,
    time,
    timestamps: aligned.timestamps,
    series: aligned.series
  };
}

/**
 * Subscribe a widget to live server-push data.
 * Raw measurement groups { measurements: [{measurementName, timestamps, series: [{name, values}]}] }
 * are delivered to onData for the caller to enrich and align.
 * @param {{ widgetId: string, ids: string[], points: number, onData: function }} options
 */
function subscribeSeriesData({ widgetId, ids, points, onData }) {
  // Lazy import to avoid circular dependency during module initialization.
  import("./liveSeriesStore.js").then(({ registerWidget }) => {
    registerWidget(widgetId, ids, points, onData);
  });
}

/**
 * Cancel a widget's live data subscription.
 * @param {string} widgetId
 */
function unsubscribeSeriesData(widgetId) {
  import("./liveSeriesStore.js").then(({ unregisterWidget }) => {
    unregisterWidget(widgetId);
  });
}

export { getSeriesCatalog, getSeriesData, subscribeSeriesData, unsubscribeSeriesData };
