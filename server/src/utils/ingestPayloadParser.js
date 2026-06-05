"use strict";
/**
 * Parses and validates an ingest payload (from HTTP body or MQTT message).
 *
 * Expected shape:
 *   {
 *     measurementName: string,
 *     clearMeasurement: boolean,       // optional — wipe existing data first
 *     time: boolean,                   // optional — default true; set false when x-axis is not a Unix timestamp
 *     points: {
 *       timestamps: number[],          // strictly increasing, ms since epoch
 *       series: { [seriesName: string]: number[] }
 *     }
 *   }
 *
 * Returns { ok: true, measurementName, clearMeasurement, time, normalizedTs, normalizedSeries }
 * or      { ok: false, error: string }
 *
 * normalizedSeries is always [{ name, values }] internally regardless of input format.
 */
function parseIngestPayload(body) {
  const measurementName = String(body?.measurementName || "").trim();
  const clearMeasurement = body?.clearMeasurement === true;
  // time defaults to true; only becomes false when explicitly set to false.
  const time = body?.time !== false;
  const timestamps = body?.points?.timestamps;
  const seriesInput = body?.points?.series;

  if (!measurementName) {
    return { ok: false, error: "Payload field 'measurementName' is required." };
  }
  if (!Array.isArray(timestamps)) {
    return { ok: false, error: "Payload field 'points.timestamps' must be an array." };
  }
  if (
    seriesInput === null ||
    typeof seriesInput !== "object" ||
    Array.isArray(seriesInput) ||
    Object.keys(seriesInput).length === 0
  ) {
    return { ok: false, error: "Payload field 'points.series' must be a non-empty object ({ seriesName: values[] })." };
  }

  const normalizedTs = [];
  for (let idx = 0; idx < timestamps.length; idx += 1) {
    const ts = Number(timestamps[idx]);
    if (!Number.isFinite(ts)) {
      return { ok: false, error: "All timestamps must be finite numbers." };
    }
    normalizedTs.push(ts);
  }
  for (let idx = 1; idx < normalizedTs.length; idx += 1) {
    if (normalizedTs[idx] <= normalizedTs[idx - 1]) {
      return { ok: false, error: "points.timestamps must be strictly increasing." };
    }
  }

  const normalizedSeries = [];
  for (const [rawName, rawValues] of Object.entries(seriesInput)) {
    const name = String(rawName).trim();
    if (!name) {
      return { ok: false, error: "All series names must be non-empty strings." };
    }
    if (!Array.isArray(rawValues)) {
      return { ok: false, error: `points.series["${name}"] must be an array.` };
    }
    if (rawValues.length !== timestamps.length) {
      return {
        ok: false,
        error: `points.series["${name}"] length must match timestamps length.`
      };
    }
    const normalizedValues = [];
    for (let idx = 0; idx < rawValues.length; idx += 1) {
      const value = Number(rawValues[idx]);
      if (!Number.isFinite(value)) {
        return { ok: false, error: `All values in series "${name}" must be finite numbers.` };
      }
      normalizedValues.push(value);
    }
    normalizedSeries.push({ name, values: normalizedValues });
  }

  return { ok: true, measurementName, clearMeasurement, time, normalizedTs, normalizedSeries };
}

module.exports = { parseIngestPayload };
