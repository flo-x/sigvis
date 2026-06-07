import { parseResponse, fetchNoCache } from "../utils/http.js";

// ── Config ────────────────────────────────────────────────────────────────────

/** GET /api/admin/config → { minPushIntervalMs, mqtt: { brokerUrl, clientId, username, ingestTopic, debugMode, status, lastError } } */
export async function getConfig() {
  return parseResponse(await fetchNoCache("/api/admin/config"));
}

/** PUT /api/admin/config — accepts a partial patch (minPushIntervalMs, mqtt). Returns the full config. */
export async function updateConfig(patch) {
  return parseResponse(await fetch("/api/admin/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  }));
}

// ── Ingest error log ──────────────────────────────────────────────────────────

/** GET /api/admin/ingest-errors → [{ ts, source, message, payload? }] */
export async function getIngestErrors() {
  return parseResponse(await fetchNoCache("/api/admin/ingest-errors"));
}

/** POST /api/admin/ingest-errors/clear */
export async function clearIngestErrors() {
  return parseResponse(await fetch("/api/admin/ingest-errors/clear", { method: "POST" }));
}

// ── Prebuilts catalog ─────────────────────────────────────────────────────────

/** GET /api/admin/prebuilts → [{ id, displayName, kind, description, paramSchema }] */
export async function getPrebuiltsCatalog() {
  return parseResponse(await fetchNoCache("/api/admin/prebuilts"));
}

// ── Series catalog (raw, for measurement/series datalist fields) ───────────────

/** GET /api/series/catalog → [{ measurementName, series: [{ name }] }] */
export async function getRawSeriesCatalog() {
  const data = await parseResponse(await fetchNoCache("/api/series/catalog"));
  return Array.isArray(data) ? data : (data.items || []);
}

// ── Generators ────────────────────────────────────────────────────────────────

/** GET /api/admin/generators → { paused: bool, items: [...] } */
export async function getGenerators() {
  return parseResponse(await fetchNoCache("/api/admin/generators"));
}

/** POST /api/admin/generators/pause */
export async function pauseGenerators() {
  return parseResponse(await fetch("/api/admin/generators/pause", { method: "POST" }));
}

/** POST /api/admin/generators/resume */
export async function resumeGenerators() {
  return parseResponse(await fetch("/api/admin/generators/resume", { method: "POST" }));
}

/** GET /api/admin/generators/:id */
export async function getGenerator(id) {
  return parseResponse(await fetchNoCache(`/api/admin/generators/${id}`));
}

/** POST /api/admin/generators → created record */
export async function createGenerator(data) {
  return parseResponse(await fetch("/api/admin/generators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }));
}

/** PUT /api/admin/generators/:id → updated record */
export async function updateGenerator(id, data) {
  return parseResponse(await fetch(`/api/admin/generators/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }));
}

/** DELETE /api/admin/generators/:id */
export async function deleteGenerator(id) {
  const r = await fetch(`/api/admin/generators/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || "Delete failed.");
  }
}

/** POST /api/admin/generators/reorder — accepts { ids: string[] } */
export async function reorderGenerators(ids) {
  return parseResponse(await fetch("/api/admin/generators/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  }));
}

// ── Processors ────────────────────────────────────────────────────────────────

/** GET /api/admin/processors → [...] */
export async function getProcessors() {
  return parseResponse(await fetchNoCache("/api/admin/processors"));
}

/** GET /api/admin/processors/:id */
export async function getProcessor(id) {
  return parseResponse(await fetchNoCache(`/api/admin/processors/${id}`));
}

/** POST /api/admin/processors → created record */
export async function createProcessor(data) {
  return parseResponse(await fetch("/api/admin/processors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }));
}

/** PUT /api/admin/processors/:id → updated record */
export async function updateProcessor(id, data) {
  return parseResponse(await fetch(`/api/admin/processors/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }));
}

/** DELETE /api/admin/processors/:id */
export async function deleteProcessor(id) {
  const r = await fetch(`/api/admin/processors/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || "Delete failed.");
  }
}

/** POST /api/admin/processors/reorder — accepts { ids: string[] } */
export async function reorderProcessors(ids) {
  return parseResponse(await fetch("/api/admin/processors/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  }));
}
