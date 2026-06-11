import { reactive, watch } from "vue";

// ── Feature detection ─────────────────────────────────────────────────────────

export const isSerialSupported = "serial" in navigator;

// ── Parser registry ───────────────────────────────────────────────────────────

function detectSeparator(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  if (line.includes(";")) return ";";
  return " ";
}

function splitFields(line, sep) {
  if (sep === " ") return line.trim().split(/\s+/).filter(Boolean);
  return line.split(sep);
}

// Parse a "series names" config string into an array.
// "temp, hum, pressure" → ["temp", "hum", "pressure"]
// "" or whitespace-only → null (auto-detect)
function parseSeriesNamesConfig(raw) {
  if (!raw || !raw.trim()) return null;
  return raw.split(",").map((s, i) => s.trim() || `field${i + 1}`);
}

// Extend a names array to cover at least `count` entries using field<n> defaults.
function extendNames(names, count) {
  while (names.length < count) names.push(`field${names.length + 1}`);
}

const CSV_PARSER = {
  id: "csv",
  label: "CSV / Delimited values",

  createContext: (cfg) => ({
    // Pre-populate names from config so they are ready before the first line.
    seriesNames: parseSeriesNamesConfig(cfg.seriesNames),
    headerChecked: cfg.seriesNames?.trim() ? true : false, // skip header detection if names are pre-set
    sep: null,
  }),

  parseLine(rawLine, cfg, ctx) {
    const line = rawLine.trim();
    if (!line) return null;
    if (cfg.commentPrefix && line.startsWith(cfg.commentPrefix)) return null;

    // Detect separator on the first real line
    if (!ctx.sep) {
      ctx.sep = cfg.separator !== "auto" ? cfg.separator : detectSeparator(line);
    }

    const fields = splitFields(line, ctx.sep);
    if (fields.length === 0) return null;

    // First non-comment line when no names are pre-configured: check for header row
    if (!ctx.headerChecked) {
      ctx.headerChecked = true;
      const isAllNumeric = fields.every(
        (f) => f.trim() !== "" && !Number.isNaN(Number(f.trim()))
      );
      if (!isAllNumeric) {
        // Header row — derive names from it, emit no data point
        ctx.seriesNames = fields.map((f, i) => f.trim() || `field${i + 1}`);
        return null;
      }
      // Data row — generate default names for this field count
      ctx.seriesNames = fields.map((_, i) => `field${i + 1}`);
    }

    // Ensure names array covers all fields in this line (handles wider lines gracefully)
    if (!ctx.seriesNames) ctx.seriesNames = [];
    extendNames(ctx.seriesNames, fields.length);

    const series = {};
    let hasValue = false;
    for (let i = 0; i < fields.length; i++) {
      const v = Number(fields[i].trim());
      if (!Number.isNaN(v)) {
        series[ctx.seriesNames[i]] = v;
        hasValue = true;
      }
    }
    if (!hasValue) return null;

    return {
      measurementName: cfg.measurementName || "serial_data",
      ts: Date.now(),
      series,
    };
  },
};

export const PARSERS = [CSV_PARSER];

// ── Persistent config ─────────────────────────────────────────────────────────

const CONFIG_KEY = "sigvis-serial-config";

function loadSavedConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); }
  catch { return {}; }
}

function applyDefaults(saved) {
  return {
    baudRate:        saved.baudRate        ?? 115200,
    parserId:        saved.parserId        ?? "csv",
    measurementName: saved.measurementName ?? "serial_data",
    separator:       saved.separator       ?? "auto",
    commentPrefix:   saved.commentPrefix   ?? "#",
    seriesNames:     saved.seriesNames     ?? "",  // e.g. "temp,hum,pressure" — blank = auto
  };
}

export const config = reactive(applyDefaults(loadSavedConfig()));

watch(config, () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config }));
}, { deep: true });

// ── Reactive state ────────────────────────────────────────────────────────────

export const state = reactive({
  isConnected:  false,
  isConnecting: false,
  bytesReceived: 0,
  linesReceived: 0,
  pointsIngested: 0,
  parseErrors:  0,
  ingestErrors: 0,
  lastLine:     "",
  lastError:    "",
});

export function resetCounters() {
  state.bytesReceived  = 0;
  state.linesReceived  = 0;
  state.pointsIngested = 0;
  state.parseErrors    = 0;
  state.ingestErrors   = 0;
  state.lastLine       = "";
  state.lastError      = "";
}

// ── Internal ──────────────────────────────────────────────────────────────────

let _port        = null;
let _reader      = null;
let _flushTimer  = null;
let _buffer      = [];   // { measurementName, ts, series }
let _stopSignal  = false;

// ── Batched ingest ────────────────────────────────────────────────────────────

async function flushBuffer() {
  if (_buffer.length === 0) return;
  const batch = _buffer.splice(0);

  // Group points by measurement name
  const byMeasurement = {};
  for (const point of batch) {
    if (!byMeasurement[point.measurementName]) {
      byMeasurement[point.measurementName] = { timestamps: [], series: {} };
    }
    const entry = byMeasurement[point.measurementName];
    entry.timestamps.push(point.ts);
    for (const [name, value] of Object.entries(point.series)) {
      if (!entry.series[name]) entry.series[name] = [];
      entry.series[name].push(value);
    }
  }

  for (const [measurementName, points] of Object.entries(byMeasurement)) {
    try {
      const res = await fetch("/api/series/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ measurementName, time: true, points }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.pointsIngested += points.timestamps.length;
    } catch (err) {
      state.ingestErrors++;
      state.lastError = `Ingest failed: ${err?.message ?? "unknown"}`;
    }
  }
}

// ── Reader loop ───────────────────────────────────────────────────────────────

async function readerLoop(port, parserEntry, parserConfig, ctx) {
  const textDecoder = new TextDecoder();
  const reader = port.readable.getReader();
  _reader = reader;

  let lineBuffer = "";

  try {
    while (!_stopSignal) {
      const { value, done } = await reader.read();
      if (done) break;

      state.bytesReceived += value.byteLength;
      lineBuffer += textDecoder.decode(value, { stream: true });

      let nl;
      while ((nl = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, nl).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(nl + 1);

        state.linesReceived++;
        state.lastLine = line;

        try {
          const point = parserEntry.parseLine(line, parserConfig, ctx);
          if (point) _buffer.push(point);
        } catch (err) {
          state.parseErrors++;
          state.lastError = `Parse error on: ${line.slice(0, 60)}`;
        }
      }
    }
    // Flush any unterminated line at EOF
    if (lineBuffer) {
      state.lastLine = lineBuffer;
      try {
        const point = parserEntry.parseLine(lineBuffer, parserConfig, ctx);
        if (point) _buffer.push(point);
      } catch { /* ignore */ }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanup() {
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
  await flushBuffer();  // send any remaining buffered points
  if (_port) {
    try { await _port.close(); } catch { /* ignore */ }
    _port = null;
  }
  _reader     = null;
  _stopSignal = false;
  state.isConnected  = false;
  state.isConnecting = false;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function connect() {
  if (!isSerialSupported) {
    state.lastError = "Web Serial API is not supported in this browser.";
    return;
  }
  if (state.isConnected || state.isConnecting) return;

  state.isConnecting = true;
  state.lastError = "";

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: Number(config.baudRate) });
    _port       = port;
    _stopSignal = false;
    _buffer     = [];

    const parserEntry  = PARSERS.find((p) => p.id === config.parserId) ?? PARSERS[0];
    const parserConfig = {
      measurementName: config.measurementName,
      separator:       config.separator,
      commentPrefix:   config.commentPrefix,
      seriesNames:     config.seriesNames,
    };
    const parserCtx = parserEntry.createContext(parserConfig);

    _flushTimer = setInterval(flushBuffer, 50);

    state.isConnected  = true;
    state.isConnecting = false;

    // Runs until port closes or disconnect() is called
    await readerLoop(port, parserEntry, parserConfig, parserCtx);
  } catch (err) {
    // User dismissed the port picker — treat as a cancel, not an error
    if (err?.name !== "NotAllowedError") {
      state.lastError = err?.message ?? "Connection failed.";
    }
  } finally {
    await cleanup();
  }
}

export async function disconnect() {
  _stopSignal = true;
  if (_reader) {
    try { await _reader.cancel(); } catch { /* ignore */ }
  }
}
