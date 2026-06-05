"use strict";
const express = require("express");
const { parseIngestPayload } = require("../utils/ingestPayloadParser");

const DEFAULT_POINTS = 120;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Build catalog item for an ingested measurement.
 * Color is intentionally omitted — it is determined entirely on the client side.
 * @param {string} measurementName
 * @param {string[]} dataSeriesNames
 */
function buildCatalogItem(measurementName, dataSeriesNames) {
  return {
    measurementName,
    series: dataSeriesNames.map((name) => ({
      name,
      unit: "units"
    }))
  };
}

function createSeriesRouter({ seriesStore, ingestErrorLog }) {
  const router = express.Router();

  // GET /catalog
  // Returns all known measurements with their data series metadata.
  router.get("/catalog", (_req, res) => {
    const items = seriesStore
      .listMeasurementsAdminState()
      .filter(({ dataSeriesNames }) => dataSeriesNames.length > 0)
      .map(({ measurementName, time, dataSeriesNames }) => ({
        ...buildCatalogItem(measurementName, dataSeriesNames),
        time
      }));

    res.json({ items });
  });

  // POST /ingest
  // Body: { measurementName, points: { timestamps[], series: { [name]: values[] } } }
  router.post("/ingest", (req, res) => {
    const parsed = parseIngestPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    const { measurementName, clearMeasurement, time, normalizedTs, normalizedSeries } = parsed;
    if (clearMeasurement) {
      seriesStore.clearMeasurementData(measurementName);
    }
    seriesStore.setMeasurementTimeFlag(measurementName, time);
    let result;
    try {
      result = seriesStore.ingestMeasurementPoints(measurementName, normalizedTs, normalizedSeries);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid ingest payload.";
      ingestErrorLog?.record("HTTP", `Store error for "${measurementName}": ${msg}`);
      return res.status(400).json({ error: msg });
    }

    return res.json({
      measurementName,
      ingestedCount: result.ingestedCount,
      totalPoints: result.totalPoints,
      thresholdSeconds: seriesStore.getThresholdSeconds(measurementName)
    });
  });

  // GET /data?series=meas1:data1,meas1:data2&points=120&interval=30
  // Returns measurements grouped, with timestamps sent once per measurement.
  router.get("/data", (req, res) => {
    const MAX_POINTS = 100000;

    const rawSeries = String(req.query.series || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawSeries.length === 0) {
      return res.status(400).json({ error: "Query parameter 'series' is required." });
    }

    // Parse compound IDs "measurementName:dataName".
    const requestedPairs = [];
    for (const compound of rawSeries) {
      const colonIdx = compound.indexOf(":");
      if (colonIdx <= 0 || colonIdx === compound.length - 1) {
        return res.status(400).json({
          error: `Invalid series identifier '${compound}'. Expected format 'measurementName:dataName'.`
        });
      }
      requestedPairs.push({
        measurementName: compound.slice(0, colonIdx),
        dataName: compound.slice(colonIdx + 1)
      });
    }

    let points = DEFAULT_POINTS;
    if (req.query.points !== undefined) {
      const parsedPoints = Number(req.query.points);
      if (!Number.isInteger(parsedPoints)) {
        return res.status(400).json({ error: "Query parameter 'points' must be an integer." });
      }
      if (parsedPoints <= 0) {
        return res.status(400).json({ error: "Query parameter 'points' must be greater than 0." });
      }
      if (parsedPoints > MAX_POINTS) {
        return res.status(400).json({
          error: `Query parameter 'points' must be less than or equal to ${MAX_POINTS}.`
        });
      }
      points = parsedPoints;
    }
    const intervalSec = clamp(Number.parseInt(req.query.interval, 10) || 30, 1, 3600);

    // Group requested pairs by measurement, preserving request order per measurement.
    const measurementOrder = [];
    const dataNamesByMeasurement = new Map();
    for (const { measurementName, dataName } of requestedPairs) {
      if (!dataNamesByMeasurement.has(measurementName)) {
        measurementOrder.push(measurementName);
        dataNamesByMeasurement.set(measurementName, []);
      }
      const names = dataNamesByMeasurement.get(measurementName);
      if (!names.includes(dataName)) {
        names.push(dataName);
      }
    }

    const measurements = [];

    for (const measurementName of measurementOrder) {
      const dataNames = dataNamesByMeasurement.get(measurementName);
      const { timestamps, dataByName } = seriesStore.getMeasurementEntries(measurementName, dataNames, {
        maxPoints: points
      });

      if (timestamps.length === 0) {
        // No stored data for this measurement — skip.
        continue;
      }

      const catalogItem = buildCatalogItem(measurementName, dataNames);
      const series = catalogItem.series.map((s) => ({
        ...s,
        values: dataByName.get(s.name) || new Array(timestamps.length).fill(null)
      }));

      measurements.push({
        measurementName,
        time: seriesStore.getMeasurementTimeFlag(measurementName),
        timestamps,
        series
      });
    }

    if (measurements.length === 0) {
      return res.status(404).json({ error: "No matching series found." });
    }

    return res.json({ measurements });
  });

  return router;
}

module.exports = {
  createSeriesRouter
};
