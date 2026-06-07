"use strict";
const express = require("express");

function createAdminSeriesRouter({ seriesStore }) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({
      defaultThresholdSeconds: seriesStore.getDefaultThresholdSeconds(),
      defaultMaxPoints:        seriesStore.getDefaultMaxPoints(),
      items:                   seriesStore.listMeasurementsAdminState()
    });
  });

  router.put("/:measurementName", (req, res) => {
    const measurementName = String(req.params.measurementName || "").trim();
    if (!measurementName) {
      return res.status(400).json({ error: "Path parameter 'measurementName' is required." });
    }

    const body = req.body || {};
    let changed = false;

    if (body.thresholdSeconds !== undefined) {
      const thresholdSeconds = Number(body.thresholdSeconds);
      if (!Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
        return res.status(400).json({ error: "Body field 'thresholdSeconds' must be a positive number." });
      }
      seriesStore.setThresholdSeconds(measurementName, Math.trunc(thresholdSeconds));
      changed = true;
    }

    if (body.maxPoints !== undefined) {
      const maxPoints = Number(body.maxPoints);
      if (!Number.isFinite(maxPoints) || maxPoints < 1) {
        return res.status(400).json({ error: "Body field 'maxPoints' must be a positive integer." });
      }
      seriesStore.setMaxPoints(measurementName, Math.trunc(maxPoints));
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ error: "Provide at least one of 'thresholdSeconds' or 'maxPoints'." });
    }

    return res.json({
      measurementName,
      thresholdSeconds: seriesStore.getThresholdSeconds(measurementName),
      maxPoints:        seriesStore.getMaxPoints(measurementName)
    });
  });

  router.delete("/:measurementName", (req, res) => {
    const measurementName = String(req.params.measurementName || "").trim();
    if (!measurementName) {
      return res.status(400).json({ error: "Path parameter 'measurementName' is required." });
    }
    seriesStore.clearMeasurementData(measurementName);
    return res.status(204).end();
  });

  return router;
}

module.exports = {
  createAdminSeriesRouter
};
