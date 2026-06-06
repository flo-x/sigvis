"use strict";
const express = require("express");

function createDashboardRouter({ dashboardStorageService }) {
  const router = express.Router();

  router.get("/", async (_req, res, next) => {
    try {
      const items = await dashboardStorageService.listDashboards();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:name", async (req, res, next) => {
    try {
      const loaded = await dashboardStorageService.loadDashboard(req.params.name);
      res.json(loaded);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return res.status(404).json({ error: "Dashboard not found." });
      }
      return next(error);
    }
  });

  router.put("/:name", async (req, res, next) => {
    try {
      const saved = await dashboardStorageService.saveDashboard(req.params.name, req.body.dashboard);
      res.json(saved);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.delete("/:name", async (req, res, next) => {
    try {
      await dashboardStorageService.deleteDashboard(req.params.name);
      res.json({ deleted: req.params.name });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return res.status(404).json({ error: "Dashboard not found." });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createDashboardRouter
};
