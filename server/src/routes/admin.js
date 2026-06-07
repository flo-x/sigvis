"use strict";

const path   = require("node:path");
const express = require("express");
const { getCatalogMeta } = require("../prebuilts/index");

/**
 * @param {{ subscriptionManager, mqttService, generatorService, processorService }} services
 * @returns {express.Router}
 */
function createAdminRouter({ subscriptionManager, mqttService, generatorService, processorService, ingestErrorLog, serverSettings }) {
  const router = express.Router();

  // ── Server-settings UI ────────────────────────────────────────────────────
  router.get("/server-settings", (_req, res) => {
    res.sendFile(path.resolve(__dirname, "..", "static", "server-settings.html"));
  });

  // ── Runtime config ────────────────────────────────────────────────────────
  router.get("/api/admin/config", (_req, res) => {
    res.json({
      minPushIntervalMs: subscriptionManager.minPushIntervalMs,
      mqtt: mqttService.getConfig()
    });
  });

  router.put("/api/admin/config", (req, res) => {
    const settingsPatch = {};

    if (req.body?.minPushIntervalMs !== undefined) {
      const value = Number(req.body.minPushIntervalMs);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: "Body field 'minPushIntervalMs' must be a positive number." });
      }
      subscriptionManager.minPushIntervalMs = Math.trunc(value);
      settingsPatch.minPushIntervalMs = subscriptionManager.minPushIntervalMs;
    }

    if (req.body?.mqtt !== undefined) {
      const { brokerUrl = "", clientId = "", username = "", password = "", ingestTopic = "", debugMode } = req.body.mqtt;
      mqttService.reconfigure({ brokerUrl, clientId, username, password, ingestTopic, debugMode });
      // Persist public fields; only overwrite saved password if a new one was submitted.
      const mqttCfg = mqttService.getConfig();
      const mqttPatch = {
        brokerUrl:   mqttCfg.brokerUrl,
        clientId:    mqttCfg.clientId,
        username:    mqttCfg.username,
        ingestTopic: mqttCfg.ingestTopic,
        debugMode:   mqttCfg.debugMode
      };
      if (password) mqttPatch.password = password;
      settingsPatch.mqtt = mqttPatch;
    }

    if (Object.keys(settingsPatch).length > 0) {
      serverSettings?.update(settingsPatch);
    }

    return res.json({
      minPushIntervalMs: subscriptionManager.minPushIntervalMs,
      mqtt: mqttService.getConfig()
    });
  });

  // ── Ingest error log ──────────────────────────────────────────────────────
  router.get("/api/admin/ingest-errors", (_req, res) => {
    res.json(ingestErrorLog ? ingestErrorLog.getAll() : []);
  });

  router.post("/api/admin/ingest-errors/clear", (_req, res) => {
    ingestErrorLog?.clear();
    res.json({ ok: true });
  });

  // ── Prebuilts catalog ─────────────────────────────────────────────────────
  router.get("/api/admin/prebuilts", (_req, res) => {
    res.json(getCatalogMeta());
  });

  // ── Generators ────────────────────────────────────────────────────────────
  router.get("/api/admin/generators", (_req, res) => {
    res.json({ paused: generatorService.paused, items: generatorService.list() });
  });

  router.post("/api/admin/generators/pause", (_req, res) => {
    generatorService.pauseAll();
    res.json({ paused: true });
  });

  router.post("/api/admin/generators/resume", (_req, res) => {
    generatorService.resumeAll();
    res.json({ paused: false });
  });

  router.post("/api/admin/generators/reorder", (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "'ids' must be an array." });
    }
    generatorService.reorder(ids);
    res.json({ ok: true });
  });

  router.get("/api/admin/generators/:id", (req, res) => {
    const record = generatorService.get(req.params.id);
    if (!record) return res.status(404).json({ error: "Generator not found." });
    return res.json(record);
  });

  router.post("/api/admin/generators", (req, res) => {
    const { name, enabled, intervalMs, initCode, code, kind, prebuiltId, config } = req.body || {};
    if (kind !== "prebuilt" && typeof code !== "string") {
      return res.status(400).json({ error: "Body field 'code' (string) is required for custom generators." });
    }
    const created = generatorService.create({ name, enabled, intervalMs, initCode, code, kind, prebuiltId, config });
    return res.status(201).json(created);
  });

  router.put("/api/admin/generators/:id", (req, res) => {
    const { name, enabled, intervalMs, initCode, code, clearState, prebuiltId, config } = req.body || {};
    const updated = generatorService.update(req.params.id, {
      name, enabled, intervalMs, initCode, code, clearState: clearState === true, prebuiltId, config
    });
    if (!updated) return res.status(404).json({ error: "Generator not found." });
    return res.json(updated);
  });

  router.delete("/api/admin/generators/:id", (req, res) => {
    const existed = generatorService.delete(req.params.id);
    if (!existed) return res.status(404).json({ error: "Generator not found." });
    return res.status(204).end();
  });

  // ── Processors ────────────────────────────────────────────────────────────
  router.get("/api/admin/processors", (_req, res) => {
    res.json(processorService.list());
  });

  router.post("/api/admin/processors/reorder", (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "'ids' must be an array." });
    }
    processorService.reorder(ids);
    res.json({ ok: true });
  });

  router.get("/api/admin/processors/:id", (req, res) => {
    const record = processorService.get(req.params.id);
    if (!record) return res.status(404).json({ error: "Processor not found." });
    return res.json(record);
  });

  router.post("/api/admin/processors", (req, res) => {
    const { name, enabled, initCode, code, kind, prebuiltId, config } = req.body || {};
    if (kind !== "prebuilt" && typeof code !== "string") {
      return res.status(400).json({ error: "Body field 'code' (string) is required for custom processors." });
    }
    const created = processorService.create({ name, enabled, initCode, code, kind, prebuiltId, config });
    return res.status(201).json(created);
  });

  router.put("/api/admin/processors/:id", (req, res) => {
    const { name, enabled, initCode, code, clearState, prebuiltId, config } = req.body || {};
    const updated = processorService.update(req.params.id, {
      name, enabled, initCode, code, clearState: clearState === true, prebuiltId, config
    });
    if (!updated) return res.status(404).json({ error: "Processor not found." });
    return res.json(updated);
  });

  router.delete("/api/admin/processors/:id", (req, res) => {
    const existed = processorService.delete(req.params.id);
    if (!existed) return res.status(404).json({ error: "Processor not found." });
    return res.status(204).end();
  });

  return router;
}

module.exports = { createAdminRouter };
