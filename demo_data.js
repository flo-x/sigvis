#!/usr/bin/env node
/**
 * demo_data.js — synthetic data producer + control server.
 *
 * • Streams five waveform series (sine_fast, sine_slow, cpu_like, memory_like,
 *   spiky) and an optional Demo1 producer into the Sigvis server via
 *   POST /api/series/ingest.
 * • Hosts a control web page (default port 3001).
 *
 * Usage:
 *   node demo_data.js
 *   node demo_data.js http://localhost:3000
 *   SERVER_URL=http://example.com LISTEN_PORT=3001 node demo_data.js
 *
 * Open http://localhost:3001 to control the Demo1 producer.
 *
 * Requirements: Node.js 18+ (uses built-in fetch and http).
 */

"use strict";

const http = require("node:http");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TARGET_URL  = (process.argv[2] ?? process.env.SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");
const LISTEN_PORT = Number.parseInt(process.env.LISTEN_PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// Synthetic measurements — always streaming
// ---------------------------------------------------------------------------
const GENERATION_HZ     = 4;
const BATCH_INTERVAL_MS = 1000;
const POINTS_PER_BATCH  = Math.round(GENERATION_HZ * (BATCH_INTERVAL_MS / 1000)); // 4
const STEP_MS           = Math.round(BATCH_INTERVAL_MS / POINTS_PER_BATCH);       // 250

const SYNTHETIC_MEASUREMENTS = [
  {
    measurementName: "sine_fast",
    series: [{ name: "value", fn: (t) => +(14 * Math.sin(2 * Math.PI * t / 10)).toFixed(3) }]
  },
  {
    measurementName: "sine_slow",
    series: [{ name: "value", fn: (t) => +(20 * Math.sin(2 * Math.PI * t / 60)).toFixed(3) }]
  },
  {
    measurementName: "cpu_like",
    series: [{
      name: "value",
      fn: (t) => {
        const v = 50
          + 28 * Math.sin(2 * Math.PI * t / 30)
          +  8 * Math.sin(2 * Math.PI * t / 7)
          +  4 * Math.sin(2 * Math.PI * t / 3.7);
        return +Math.max(0, Math.min(100, v)).toFixed(1);
      }
    }]
  },
  {
    measurementName: "memory_like",
    series: [{ name: "value", fn: (t) => +(32 + 6 * Math.sin(2 * Math.PI * t / 120)).toFixed(2) }]
  },
  {
    measurementName: "spiky",
    series: [{
      name: "value",
      fn: (t) => {
        const base  = 18 * Math.sin(2 * Math.PI * t / 10);
        const spike = (t % 17) < (1 / GENERATION_HZ) ? 40 : 0;
        return +(base + spike).toFixed(3);
      }
    }]
  }
];

const startMs    = Date.now();
let   batchCount  = 0;
let   failureCount = 0;

// Flags set by the control page; consumed (and reset) on the very next tick.
let clearSyntheticOnNextTick = false;
let clearDemo1OnNextTick     = false;

// ---------------------------------------------------------------------------
// Demo1 producer state
// ---------------------------------------------------------------------------
let demoRunning               = false;
let demoBaseFrequency         = 100;
let demoGenerationHz          = 1;
let demoModulationRateHz      = 0.5;
let demoModulationAmplitudeHz = 25;   // Hz — freq swings between f-amp and f+amp
let demoAmplitudeModRateHz    = 0.1;  // Hz — rate of amplitude modulation
let demoAmplitudeModDepthPct  = 0;    // % — 0 = no AM, 100 = full AM
let demoPhaseRad          = 0;
let demoLastTimestampMs   = null;
let demoModulationStartMs = null;
let demoInterval          = null;

function getDemoIntervalMs() {
  const hz = Number.isFinite(demoGenerationHz) && demoGenerationHz > 0 ? demoGenerationHz : 1;
  return Math.max(10, Math.round(1000 / hz));
}

function getDemoStatus() {
  return {
    running:               demoRunning,
    demoBaseFrequency,
    generationSpeedHz:     demoGenerationHz,
    modulationRateHz:      demoModulationRateHz,
    modulationAmplitudeHz: demoModulationAmplitudeHz,
    amplitudeModRateHz:    demoAmplitudeModRateHz,
    amplitudeModDepthPct:  demoAmplitudeModDepthPct
  };
}

function demoTick() {
  const now    = Date.now();
  const stepMs = Math.max(1, Math.round(getDemoIntervalMs() / 4));
  const timestamps = [now, now + stepMs, now + stepMs * 2, now + stepMs * 3];

  const signalValues   = [];
  const envelopeValues = [];

  for (const ts of timestamps) {
    const tSec  = (ts - demoModulationStartMs) / 1000;
    const dtSec = demoLastTimestampMs == null ? 0 : (ts - demoLastTimestampMs) / 1000;
    const instFreqHz = demoBaseFrequency + demoModulationAmplitudeHz * Math.cos(2 * Math.PI * demoModulationRateHz * tSec);
    demoPhaseRad       += 2 * Math.PI * instFreqHz * dtSec;
    demoLastTimestampMs = ts;
    const amEnvelope = 1 + (demoAmplitudeModDepthPct / 100) * Math.cos(2 * Math.PI * demoAmplitudeModRateHz * tSec);
    signalValues.push(+(amEnvelope * Math.sin(demoPhaseRad)).toFixed(6));
    envelopeValues.push(+instFreqHz.toFixed(6));
  }

  const clearDemo1 = clearDemo1OnNextTick;
  clearDemo1OnNextTick = false;

  ingest("Demo1", {
    timestamps,
    series: {
      value:    signalValues,
      envelope: envelopeValues
    }
  }, clearDemo1).catch(() => {});
}

function startDemo() {
  if (demoRunning) return getDemoStatus();
  demoPhaseRad          = 0;
  demoLastTimestampMs   = null;
  demoModulationStartMs = Date.now();
  demoTick();
  demoInterval = setInterval(demoTick, getDemoIntervalMs());
  demoRunning  = true;
  console.log("  Demo1 producer started.");
  return getDemoStatus();
}

function stopDemo() {
  if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
  demoRunning         = false;
  demoLastTimestampMs = null;
  console.log("  Demo1 producer stopped.");
  return getDemoStatus();
}

// ---------------------------------------------------------------------------
// Ingest helper
// ---------------------------------------------------------------------------
// Positional wrapper: ingest(measurementName, points, clearMeasurement?)
// When clearMeasurement is true the server discards all existing data for the
// measurement before appending the supplied points (maps to the HTTP body field).
async function ingest(measurementName, points, clearMeasurement = false) {
  const res = await fetch(`${TARGET_URL}/api/series/ingest`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ measurementName, clearMeasurement, points })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${body.error ?? res.statusText}`);
  }
}


// ---------------------------------------------------------------------------
// Synthetic tick
// ---------------------------------------------------------------------------
async function syntheticTick() {
  // Consume the clear flag atomically at the start of the tick.
  const clearSynthetic = clearSyntheticOnNextTick;
  clearSyntheticOnNextTick = false;

  // Anchor the last point to real wall-clock time so timestamps never drift.
  const now = Date.now();
  const timestamps = [];
  for (let i = -(POINTS_PER_BATCH - 1); i <= 0; i++) {
    timestamps.push(now + i * STEP_MS);
  }

  const results = await Promise.allSettled(
    SYNTHETIC_MEASUREMENTS.map((m) => {
      const series = {};
      for (const s of m.series) {
        series[s.name] = timestamps.map((ts) => s.fn((ts - startMs) / 1000));
      }
      return ingest(m.measurementName, { timestamps, series }, clearSynthetic);
    })
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failureCount++;
      if (failureCount <= 5 || failureCount % 20 === 0) {
        console.error(`  ✗ ${SYNTHETIC_MEASUREMENTS[i].measurementName}: ${r.reason?.message ?? r.reason}`);
      }
    }
  });

  batchCount++;
  if (batchCount % 5 === 0) {
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    console.log(`[${elapsed}s] batch ${batchCount}  ${ok}/${SYNTHETIC_MEASUREMENTS.length} ok`);
  }
}

// ---------------------------------------------------------------------------
// Control page HTML
// ---------------------------------------------------------------------------
const CONTROL_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Data Control</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #111827; background: #f9fafb; }
    h1 { margin-bottom: 1.5rem; }
    .card { max-width: 28rem; padding: 1rem 1.25rem; background: #fff; border: 1px solid #e5e7eb; border-radius: .5rem; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 1.5rem; }
    .card h2 { margin: 0 0 .75rem; font-size: 1.05rem; }
    .field { display: flex; align-items: center; gap: .5rem; margin-top: .5rem; }
    .field label { flex: 1; font-size: .9rem; }
    .field input[type=number] { width: 7rem; padding: .35rem .5rem; border: 1px solid #d1d5db; border-radius: .35rem; font-size: .9rem; }
    .actions { display: flex; gap: .5rem; margin-top: .75rem; }
    button { padding: .45rem .75rem; border-radius: .35rem; border: 1px solid #d1d5db; background: #111827; color: #fff; cursor: pointer; font-size: .9rem; }
    button.secondary { background: #fff; color: #111827; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .status { margin-top: .5rem; color: #374151; font-size: .9rem; }
    .error  { color: #b91c1c;  margin-top: .5rem; font-size: .9rem; }
    .pill { display: inline-block; padding: .15rem .55rem; border-radius: 999px; font-size: .78rem; font-weight: 600; }
    .pill.on  { background: #d1fae5; color: #065f46; }
    .pill.off { background: #f3f4f6; color: #6b7280; }
    .series-tag { display: inline-block; background: #ede9fe; color: #4c1d95; border-radius: .3rem; padding: .1rem .45rem; font-size: .78rem; margin: .15rem .1rem 0; }
  </style>
</head>
<body>
  <h1>Demo Data Control</h1>

  <div class="card">
    <h2>Synthetic Measurements <span id="synthPill" class="pill on">streaming</span></h2>
    <div id="synthSeries" style="margin-top:.4rem"></div>
    <div class="actions" style="margin-top:.75rem">
      <button id="clearSynthBtn" class="secondary">Clear on next tick</button>
    </div>
    <p class="status" id="synthStatus"></p>
  </div>

  <div class="card">
    <h2>Demo1 Producer <span id="demoPill" class="pill off">stopped</span></h2>
    <div class="field"><label>Base frequency</label>
      <input id="demoBaseFrequency" type="number" min="0" step="1" /></div>
    <div class="field"><label>Generation speed (Hz)</label>
      <input id="generationSpeedHz" type="number" min="0.1" step="0.1" /></div>
    <div class="field"><label>Modulation rate (Hz)</label>
      <input id="modulationRateHz" type="number" min="0.001" step="0.001" /></div>
    <div class="field"><label>Modulation amplitude (Hz)</label>
      <input id="modulationAmplitudeHz" type="number" min="0" step="0.1" /></div>
    <div class="field"><label>AM rate (Hz)</label>
      <input id="amplitudeModRateHz" type="number" min="0.001" step="0.001" /></div>
    <div class="field"><label>AM depth (%)</label>
      <input id="amplitudeModDepthPct" type="number" min="0" step="1" /></div>
    <div class="actions">
      <button id="toggleBtn">Loading…</button>
      <button id="applyBtn" class="secondary">Apply parameters</button>
    </div>
    <div class="actions" style="margin-top:.4rem">
      <button id="refreshBtn" class="secondary">Refresh status</button>
      <button id="clearDemoBtn" class="secondary">Clear on next tick</button>
    </div>
    <p class="status" id="demoStatus"></p>
    <p class="error"  id="demoError"></p>
  </div>

  <script>
    let running = false;
    let busy    = false;
    const toggleBtn = document.getElementById("toggleBtn");
    const applyBtn  = document.getElementById("applyBtn");
    const demoStatusEl  = document.getElementById("demoStatus");
    const demoErrorEl   = document.getElementById("demoError");
    const demoPill      = document.getElementById("demoPill");
    const synthStatusEl = document.getElementById("synthStatus");

    function renderDemo(s) {
      running = s.running;
      demoPill.textContent  = s.running ? "running" : "stopped";
      demoPill.className    = "pill " + (s.running ? "on" : "off");
      toggleBtn.textContent = s.running ? "Stop Demo1" : "Start Demo1";
      toggleBtn.disabled    = false;
      applyBtn.disabled     = false;
      document.getElementById("demoBaseFrequency").value = s.demoBaseFrequency;
      document.getElementById("generationSpeedHz").value = s.generationSpeedHz;
      document.getElementById("modulationRateHz").value  = s.modulationRateHz;
      document.getElementById("modulationAmplitudeHz").value = s.modulationAmplitudeHz;
      document.getElementById("amplitudeModRateHz").value    = s.amplitudeModRateHz;
      document.getElementById("amplitudeModDepthPct").value  = s.amplitudeModDepthPct;
      demoStatusEl.textContent = (s.running ? "Running" : "Stopped")
        + " \u2014 base freq " + s.demoBaseFrequency + " Hz"
        + ", gen " + s.generationSpeedHz + " Hz"
        + ", FM " + s.modulationRateHz + " Hz \u00b1" + s.modulationAmplitudeHz + " Hz"
        + ", AM " + s.amplitudeModRateHz + " Hz @ " + s.amplitudeModDepthPct + "%";
    }

    async function loadStatus() {
      const r = await fetch("/api/status");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      renderDemo(d.demo);
      const synthEl = document.getElementById("synthSeries");
      synthEl.innerHTML = d.synthetic.measurements
        .map((n) => '<span class="series-tag">' + n + "</span>").join("");
      synthStatusEl.textContent = d.synthetic.generationHz + " Hz \u2022 "
        + d.synthetic.batchCount + " batches sent";
    }

    async function toggle() {
      if (busy) return;
      busy = true; toggleBtn.disabled = true; demoErrorEl.textContent = "";
      try {
        const action = running ? "stop" : "start";
        const r = await fetch("/api/demo/" + action, { method: "POST" });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
        renderDemo(await r.json());
      } catch (e) {
        demoErrorEl.textContent = e.message;
        toggleBtn.disabled = false;
      } finally { busy = false; }
    }

    async function applyParams() {
      if (busy) return;
      busy = true; applyBtn.disabled = true; demoErrorEl.textContent = "";
      const body = {
        demoBaseFrequency:    Number(document.getElementById("demoBaseFrequency").value),
        generationSpeedHz:    Number(document.getElementById("generationSpeedHz").value),
        modulationRateHz:     Number(document.getElementById("modulationRateHz").value),
        modulationAmplitudeHz: Number(document.getElementById("modulationAmplitudeHz").value),
        amplitudeModRateHz:   Number(document.getElementById("amplitudeModRateHz").value),
        amplitudeModDepthPct: Number(document.getElementById("amplitudeModDepthPct").value)
      };
      try {
        const r = await fetch("/api/demo", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
        renderDemo(await r.json());
      } catch (e) { demoErrorEl.textContent = e.message; }
      finally { busy = false; applyBtn.disabled = false; }
    }

    async function scheduleClear(path, btn) {
      btn.disabled = true;
      try {
        const r = await fetch(path, { method: "POST" });
        if (!r.ok) throw new Error("HTTP " + r.status);
      } catch (e) { demoErrorEl.textContent = "Clear failed: " + e.message; }
      finally { setTimeout(() => { btn.disabled = false; }, 1200); }
    }

    toggleBtn.addEventListener("click", toggle);
    applyBtn.addEventListener("click", applyParams);
    document.getElementById("refreshBtn").addEventListener("click", () => {
      loadStatus().catch((e) => { demoErrorEl.textContent = "Refresh failed: " + e.message; });
    });
    document.getElementById("clearSynthBtn").addEventListener("click", (e) => scheduleClear("/api/synthetic/clear", e.currentTarget));
    document.getElementById("clearDemoBtn").addEventListener("click",  (e) => scheduleClear("/api/demo/clear",      e.currentTarget));

    loadStatus().catch((e) => {
      demoErrorEl.textContent = "Failed to load status: " + e.message;
      toggleBtn.textContent = "?";
    });
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// HTTP server — serves the control page and a small REST API
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end",  () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

function sendJson(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const method = req.method.toUpperCase();
  const path   = new URL(req.url, `http://localhost`).pathname;

  // Control page
  if (method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(CONTROL_PAGE);
    return;
  }

  // Status
  if (method === "GET" && path === "/api/status") {
    sendJson(res, {
      demo:      getDemoStatus(),
      synthetic: {
        measurements: SYNTHETIC_MEASUREMENTS.map((m) => m.measurementName),
        generationHz: GENERATION_HZ,
        batchCount,
        failureCount
      }
    });
    return;
  }

  // Demo GET
  if (method === "GET" && path === "/api/demo") {
    sendJson(res, getDemoStatus());
    return;
  }

  // Demo PUT — update parameters
  if (method === "PUT" && path === "/api/demo") {
    const body = await readBody(req);
    const errors = [];

    if (body.demoBaseFrequency !== undefined) {
      const v = Number(body.demoBaseFrequency);
      if (!Number.isFinite(v) || v < 0) errors.push("demoBaseFrequency must be >= 0");
      else demoBaseFrequency = v;
    }
    if (body.generationSpeedHz !== undefined) {
      const v = Number(body.generationSpeedHz);
      if (!Number.isFinite(v) || v <= 0) errors.push("generationSpeedHz must be > 0");
      else {
        demoGenerationHz = v;
        if (demoRunning) {
          clearInterval(demoInterval);
          demoInterval = setInterval(demoTick, getDemoIntervalMs());
        }
      }
    }
    if (body.modulationRateHz !== undefined) {
      const v = Number(body.modulationRateHz);
      if (!Number.isFinite(v) || v <= 0) errors.push("modulationRateHz must be > 0");
      else demoModulationRateHz = v;
    }
    if (body.modulationAmplitudeHz !== undefined) {
      const v = Number(body.modulationAmplitudeHz);
      if (!Number.isFinite(v) || v < 0) errors.push("modulationAmplitudeHz must be >= 0");
      else demoModulationAmplitudeHz = v;
    }
    if (body.amplitudeModRateHz !== undefined) {
      const v = Number(body.amplitudeModRateHz);
      if (!Number.isFinite(v) || v <= 0) errors.push("amplitudeModRateHz must be > 0");
      else demoAmplitudeModRateHz = v;
    }
    if (body.amplitudeModDepthPct !== undefined) {
      const v = Number(body.amplitudeModDepthPct);
      if (!Number.isFinite(v) || v < 0) errors.push("amplitudeModDepthPct must be >= 0");
      else demoAmplitudeModDepthPct = v;
    }

    if (errors.length > 0) { sendJson(res, { error: errors.join("; ") }, 400); return; }
    sendJson(res, getDemoStatus());
    return;
  }

  // Demo start / stop
  if (method === "POST" && path === "/api/demo/start") { sendJson(res, startDemo()); return; }
  if (method === "POST" && path === "/api/demo/stop")  { sendJson(res, stopDemo());  return; }

  // Schedule a clear on the next tick
  if (method === "POST" && path === "/api/synthetic/clear") {
    clearSyntheticOnNextTick = true;
    sendJson(res, { scheduled: true });
    return;
  }
  if (method === "POST" && path === "/api/demo/clear") {
    clearDemo1OnNextTick = true;
    sendJson(res, { scheduled: true });
    return;
  }

  sendJson(res, { error: "Not found." }, 404);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
console.log(`Sigvis server : ${TARGET_URL}`);
console.log(`Control page      : http://localhost:${LISTEN_PORT}`);
console.log(`Synthetic series  : ${SYNTHETIC_MEASUREMENTS.map((m) => m.measurementName).join(", ")}`);
console.log(`Rate              : ${GENERATION_HZ} Hz  •  batch every ${BATCH_INTERVAL_MS} ms`);
console.log("Press Ctrl+C to stop.\n");

process.on("SIGINT", () => {
  stopDemo();
  const elapsed = Math.round((Date.now() - startMs) / 1000);
  console.log(`\nStopped after ${batchCount} batches (${elapsed}s).`);
  process.exit(0);
});

server.listen(LISTEN_PORT, () => {
  console.log(`Control page listening on http://localhost:${LISTEN_PORT}\n`);
});

syntheticTick();
setInterval(syntheticTick, BATCH_INTERVAL_MS);
