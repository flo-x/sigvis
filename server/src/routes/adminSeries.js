"use strict";
const express = require("express");

function createAdminSeriesRouter({ seriesStore }) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({
      defaultThresholdSeconds: seriesStore.getDefaultThresholdSeconds(),
      items: seriesStore.listMeasurementsAdminState()
    });
  });

  router.put("/:measurementName", (req, res) => {
    const measurementName = String(req.params.measurementName || "").trim();
    const thresholdSeconds = Number(req.body?.thresholdSeconds);

    if (!measurementName) {
      return res.status(400).json({ error: "Path parameter 'measurementName' is required." });
    }
    if (!Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
      return res.status(400).json({ error: "Body field 'thresholdSeconds' must be a positive number." });
    }

    seriesStore.setThresholdSeconds(measurementName, Math.trunc(thresholdSeconds));
    return res.json({
      measurementName,
      thresholdSeconds: seriesStore.getThresholdSeconds(measurementName)
    });
  });

  return router;
}

module.exports = {
  createAdminSeriesRouter
};
