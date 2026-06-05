# Node + Vue Time-Series Dashboard

Web application served by Node.js with a Vue dashboard frontend for visualizing time-series data using `uPlot`. Supports real-time live data push via WebSocket and data ingestion via HTTP or MQTT.

## Concepts

A **measurement** is a named collection of one or more **data series** — for example, a measurement called `weather_station` might contain series `temperature`, `humidity`, and `pressure`. A measurement contains one list of timestamps, and values for each data series for each of these timestamps. It is also possible to use just numbers instead of timestamps.

Data is **ingested** into the server by external producers — embedded systems, scripts, services, or anything that can make an HTTP request or publish to an MQTT topic. Once ingested in the server and stored there, any browser connected to the server can visualize the data in real time. The server also supports **generators** (JavaScript snippets that produce synthetic series on a timer) and **processors** (snippets that compute derived series automatically after every ingest event), enabling signal processing and transformation entirely on the server. Several generators and processors are predefined and can be configured for use, others can be written as Javascript snippets.

## High-Level Architecture

The **Node.js server** is the central hub: it receives measurements via HTTP or MQTT, stores them in memory, runs generator and processor scripts, and pushes live updates to connected browsers over a WebSocket. It also serves the compiled frontend as static files in production.

The **browser frontend** is a Vue 3 single-page application. Users of the application build dashboards composed of graph widgets, each configured to display one or more data series. Widgets can stream data in real time (live mode) or fetch a fixed historical window (history mode).

## Features

- Multiple dashboards managed as tabs.
- Dashboard actions: `Save`, `Save As...`, and `Open...` (via a File dropdown menu).
- View / Edit mode — toggle editing controls without a page reload.
- Server-side persistence through a generic storage service (filesystem JSON adapter).
- Widget architecture with versioning and migration support.
- `Data Series` widget using `uPlot`:
  - Multi-series selection per widget (compound `measurementName:dataName` IDs).
  - Live mode — data streamed in real time over WebSocket.
  - History mode — fetch a fixed window of historical points.
  - Time-sync domain — synchronize the time axis across multiple widgets.
  - Optional performance overlay (EMA-smoothed render time).
  - Supports numeric (non-timestamp) x-axis via the `time: false` ingest flag.
- Grid editing with `GridStack`:
  - 12 columns, drag/move and resize widgets, add/remove widgets.
- Global render cadence configurable in Hz.
- Data ingestion via **HTTP** (`POST /api/series/ingest`) or **MQTT** (subscribe to a configurable topic).
- **Series Generators** — user-authored JavaScript snippets that run at a fixed interval to produce data series autonomously.
- **Derived Series Processors** — user-authored JavaScript snippets that run automatically after every ingest to compute and store new derived series. Generators automatically trigger processors.
- Built-in DSP library (`require('dsp')`) available in both generators and processors: EMA filter and spectrum analyser.
- Built-in `/server-settings` page for managing WebSocket push interval, MQTT connection, generators, and processors.
- OpenAPI spec at `/api/openapi.json` with Swagger UI at `/api/docs`.

## Project Structure

- `server/` — Express API + WebSocket server + static frontend hosting in production.
- `web/` — Vue 3 + Vite frontend app.
- `demo_data.js` — Standalone Node.js script that generates synthetic time-series data and sends it to the server via the HTTP ingest API. Includes a small control web page on port 3001.
- `server/data/dashboards/` — Default filesystem storage location for saved dashboards.
- `server/data/processors.json` — Persisted processor definitions (created automatically).
- `server/data/generators.json` — Persisted generator definitions (created automatically).

## Requirements

- Node.js 18+
- npm 9+

## Setup

```bash
npm install
cd server && npm install
cd ../web && npm install
```

## Run In Development

From the project root:

```bash
npm run dev
```

This starts:

- Node server on `http://localhost:3000`
- Vue dev server on `http://localhost:5173` (proxying `/api` and WebSocket to port `3000`)

To also generate synthetic data, run in a separate terminal:

```bash
node demo_data.js
```

The demo data control page is then available at `http://localhost:3001`.

## Build And Run Production

```bash
npm run build
npm run start
```

Node serves the built frontend from `web/dist` and also serves all API routes.

## Environment Variables


| Variable                | Default                  | Description                                                                     |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `PORT`                  | `3000`                   | Port the Node server listens on.                                                |
| `DASHBOARD_STORAGE_DIR` | `server/data/dashboards` | Absolute path for dashboard JSON files.                                         |
| `MIN_PUSH_INTERVAL_MS`  | `30`                     | Minimum interval (ms) between WebSocket data pushes per client.                 |
| `MQTT_BROKER_URL`       | *(unset)*                | MQTT broker URL (e.g. `mqtt://192.168.1.10:1883`). Leave unset to disable MQTT. |
| `MQTT_CLIENT_ID`        | *(auto)*                 | MQTT client identifier. Auto-generated when blank.                              |
| `MQTT_USERNAME`         | *(unset)*                | Optional MQTT broker username.                                                  |
| `MQTT_PASSWORD`         | *(unset)*                | Optional MQTT broker password.                                                  |
| `MQTT_INGEST_TOPIC`     | `cmnd/visualizer/ingest` | Topic to subscribe to for data ingestion.                                       |


Example:

```bash
export PORT=8080
export MQTT_BROKER_URL=mqtt://192.168.1.10:1883
export MQTT_INGEST_TOPIC=cmnd/visualizer/ingest
```

All MQTT settings can also be changed at runtime without restarting the server — use the `/server-settings` page or `PUT /api/admin/config`.

## API Endpoints

### Health

- `GET /api/health`

### Series

- `GET /api/series/catalog` — All known measurements with their data series metadata.
- `GET /api/series/data?series=meas1:data1,meas1:data2&points=120` — Historical data. `series` is a comma-separated list of `measurementName:dataName` compound IDs.
- `POST /api/series/ingest` — Ingest new data points (see payload below).

### Dashboards

- `GET /api/dashboards`
- `GET /api/dashboards/:name`
- `PUT /api/dashboards/:name`

### Admin — Series

- `GET /api/admin/series` — List all measurements with admin state.
- `PUT /api/admin/series/:measurementName` — Update retention threshold.

### Admin — Server Config

- `GET /api/admin/config` — Read runtime server settings (push interval, MQTT config).
- `PUT /api/admin/config` — Update runtime server settings (takes effect immediately, not persisted across restarts).

### Admin — Generators

- `GET /api/admin/generators` — Returns `{ paused: bool, items: [...] }`. Each item has `id`, `name`, `enabled`, `intervalMs`, `kind`, and any errors. Scripts are omitted; use `GET …/:id` to retrieve them.
- `GET /api/admin/generators/:id` — Full generator record including `initCode`/`code` (custom) or `prebuiltId`/`config`/`configErrors` (prebuilt).
- `POST /api/admin/generators` — Create a generator. For **custom**: `{ name, enabled, intervalMs, initCode, code }`. For **prebuilt**: `{ name, enabled, intervalMs, kind: "prebuilt", prebuiltId, config }`.
- `PUT /api/admin/generators/:id` — Update a generator. All fields optional. `clearState: true` resets in-memory state and re-runs the init script.
- `DELETE /api/admin/generators/:id` — Stop and delete a generator.
- `POST /api/admin/generators/pause` — Stop all generator intervals without changing individual `enabled` flags (master pause).
- `POST /api/admin/generators/resume` — Restart intervals for all enabled generators (master resume).

### Admin — Processors

- `GET /api/admin/processors` — List all processors. Each item has `id`, `name`, `enabled`, `kind`, and any errors. Scripts are omitted; use `GET …/:id` to retrieve them.
- `GET /api/admin/processors/:id` — Full processor record including `initCode`/`code` (custom) or `prebuiltId`/`config`/`configErrors` (prebuilt).
- `POST /api/admin/processors` — Create a processor. For **custom**: `{ name, enabled, initCode, code }`. For **prebuilt**: `{ name, enabled, kind: "prebuilt", prebuiltId, config }`.
- `PUT /api/admin/processors/:id` — Update a processor. All fields optional. `clearState: true` resets in-memory state and re-runs the init script.
- `DELETE /api/admin/processors/:id` — Delete a processor.

### Admin — Prebuilts

- `GET /api/admin/prebuilts` — Catalog of all built-in prebuilt generators and processors. Returns an array of `{ id, displayName, kind, description, paramSchema }` objects. Used by the UI to render config forms.

### Docs

- `GET /api/openapi.json` — OpenAPI 3 spec.
- `GET /api/docs` — Swagger UI.

### Server Settings Page

- `GET /server-settings` — Built-in HTML page for managing push interval, MQTT connection, generators, and processors.

## Series Ingest Payload

`POST /api/series/ingest` (and the equivalent MQTT message payload) expect:

```json
{
  "measurementName": "cpu_like",
  "clearMeasurement": false,
  "time": true,
  "points": {
    "timestamps": [1712589900000, 1712589900250, 1712589900500],
    "series": [
      { "name": "value",    "values": [42.1, 43.5, 41.8] },
      { "name": "smoothed", "values": [42.0, 42.8, 42.2] }
    ]
  }
}
```

Notes:

- `timestamps` must be strictly increasing numbers. Decimal values are preserved (sub-millisecond precision is kept).
- Each entry in `series` must have a `name` and a `values` array of the same length as `timestamps`.
- Duplicate timestamps replace existing values for that series.
- `clearMeasurement` (optional, default `false`) — when `true`, **all existing data** for the measurement is erased before the new points are written.
- `time` (optional, default `true`) — when `false`, the x-axis values are treated as plain numbers rather than timestamps (milliseconds since epoch). The frontend will display them on a numeric axis instead of a date/time axis. Use this when x values represent something other than wall-clock time (e.g. frequency bins, sample indices).
- Default retention window is `600` seconds; change it via `PUT /api/admin/series/:measurementName`. For `time: false` series, retention is range-based (points more than 100 000 units below the latest value are pruned).

The same flags are available in the generator/processor sandbox `ingest()` call:

```javascript
ingest({
  measurementName: "my_series",
  clearMeasurement: true,
  time: false,
  points: { timestamps: [0, 1, 2], series: [{ name: "value", values: [1, 2, 3] }] }
});
```

## MQTT Ingestion

The server can subscribe to an MQTT broker and ingest data from incoming messages.

Configure the broker URL (and optionally credentials and topic) via environment variables or the `/server-settings` page. The payload format is identical to the HTTP ingest endpoint above.

```
Topic:   cmnd/visualizer/ingest   (default; configurable)
Payload: same JSON as POST /api/series/ingest
```

Messages are processed in the order they are received. Overlapping timestamp ranges overwrite earlier points for the affected series.

The MQTT connection status (connecting / connected / error / disconnected) and any connection error are visible on the `/server-settings` page.

## Series Generators

Generators run at a fixed configurable interval (minimum 100 ms) and produce data series autonomously — no external ingest trigger is needed. When a generator calls `ingest()`, the new data flows through the same store update callback as HTTP/MQTT ingestion, automatically triggering all enabled processors.

Each generator is either **custom** (user-authored JavaScript) or **prebuilt** (a built-in parameterised generator chosen from the catalog).

A **master pause / resume** button on the settings page stops or starts all generator intervals at once without changing individual `enabled` flags. This is useful for pausing all data production while editing the configuration.

### How custom generators work

- Each enabled generator fires its **process script** at the configured `intervalMs`.
- An optional **init script** runs once on save and once on server start to initialise stateful objects.
- Both scripts share a private `state` object that persists across ticks and across script edits (cleared only on server restart or explicit "Save & Clear state").
- Scripts execute inside a **VM sandbox** with a 5-second execution timeout.
- Generators are persisted to `server/data/generators.json` and reloaded on startup.

### Prebuilt generators

Prebuilt generators are ready-to-use generators defined in `server/src/prebuilts/`. Instead of writing scripts, you choose a prebuilt from the catalog and fill in its parameters. Available prebuilts:


| ID               | Description                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `sine-generator` | Sine wave with configurable frequency, amplitude, sample rate, AM, FM, additive noise, timestamp jitter, and phase jitter. |


Prebuilt parameter values are validated against the `paramSchema` (type, required, min/max) and optionally against a custom `validateFn` defined in the prebuilt itself. Config errors block execution and are shown in the UI.

### Script API


| Name                                                          | Description                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ingest({ measurementName, points: { timestamps, series } })` | Writes data into the store. Same format and flags (`clearMeasurement`, `time`) as the HTTP endpoint. |
| `getMeasurement(name)`                                        | Returns `{ timestamps, series: { [name]: values[] } }` or `null`.                                    |
| `listMeasurements()`                                          | Returns a sorted `string[]` of all measurement names.                                                |
| `setIntervalMs(ms)`                                           | Change the firing rate at runtime (non-persistent; restored on next save or restart).                |
| `require(moduleName)`                                         | Load a built-in library. Currently: `'dsp'`.                                                         |
| `state`                                                       | Generator-private object; persists across ticks and script edits.                                    |
| `log(msg)`                                                    | Tagged stdout log: `[Generator:<name>] msg`.                                                         |
| `Date`                                                        | Standard JavaScript `Date` — use `Date.now()` for wall-clock timestamps.                             |


Available globals: `Math`, `JSON`, `Array`, `Object`, `Map`, `Set`, `parseFloat`, `parseInt`, `isFinite`, `isNaN`. DOM, `fetch`, and filesystem access are **not** available.

### Example — 1 Hz sine wave at 50 Hz sample rate

Configure with **Interval: 100 ms**.

**Init script:**

```javascript
state.phaseRad = 0;
state.lastTs   = null;
```

**Process script:**

```javascript
const FREQ_HZ     = 1;    // signal frequency
const AMPLITUDE   = 1;    // peak amplitude
const SAMPLE_HZ   = 50;   // samples per second per tick
const intervalSec = 0.1;  // must match the configured Interval (100 ms)

const now    = Date.now();
const stepMs = 1000 / SAMPLE_HZ;
const count  = Math.round(intervalSec * SAMPLE_HZ);

const timestamps = [], values = [];

for (let i = 0; i < count; i++) {
  const ts    = now - (count - 1 - i) * stepMs;
  const dtSec = state.lastTs == null ? 0 : (ts - state.lastTs) / 1000;
  state.phaseRad += 2 * Math.PI * FREQ_HZ * dtSec;
  state.lastTs    = ts;
  timestamps.push(ts);
  values.push(+(AMPLITUDE * Math.sin(state.phaseRad)).toFixed(6));
}

ingest({
  measurementName: "sine_gen",
  points: { timestamps, series: [{ name: "value", values }] }
});
```

## Derived Series Processors

Processors run automatically after every ingest (HTTP, MQTT, or generator) to compute and store new derived series.

Each processor is either **custom** (user-authored JavaScript) or **prebuilt** (a built-in parameterised processor chosen from the catalog).

### How custom processors work

- All **enabled** processors execute in sequence after each ingest.
- Each processor has an **init script** (runs once on save and on server start) and a **process script** (runs after every ingest). Both share the same `state` object.
- Scripts execute inside a **VM sandbox** with a 5-second execution timeout.
- A processor that calls `ingest()` internally does **not** trigger another processor sweep (re-entrancy guard).
- Processors are persisted to `server/data/processors.json` and reloaded on startup.
- Per-processor in-memory `state` persists across runs **and across script edits**; it is cleared only on server restart, deletion, or an explicit "Save & Clear state" action.

### Prebuilt processors

Prebuilt processors are ready-to-use processors defined in `server/src/prebuilts/`. Available prebuilts:


| ID              | Description                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ema-processor` | Applies an EMA filter to a source series and writes the smoothed result as a new series in the same measurement. Configurable `alpha`, source and output series names. |


Like prebuilt generators, config values are validated against `paramSchema` and an optional `validateFn`. Config errors block execution and are shown in the UI.

### Script API


| Name                                                          | Description                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `getMeasurement(name)`                                        | Returns `{ timestamps, series: { [name]: values[] } }` or `null`.                                                                               |
| `listMeasurements()`                                          | Returns a sorted `string[]` of all measurement names.                                                                                           |
| `getNewPointCount(name)`                                      | Points in `name` that arrived since this processor last ran.                                                                                    |
| `ingest({ measurementName, points: { timestamps, series } })` | Writes derived data using the non-destructive merge path (existing sibling series are untouched). Supports `clearMeasurement` and `time` flags. |
| `require(moduleName)`                                         | Load a built-in library. Currently: `'dsp'`.                                                                                                    |
| `state`                                                       | Processor-private object; persists across runs and script edits until server restart.                                                           |
| `log(msg)`                                                    | Tagged stdout log: `[Processor:<name>] msg`.                                                                                                    |


Available globals: `Math`, `JSON`, `Array`, `Object`, `Map`, `Set`, `parseFloat`, `parseInt`, `isFinite`, `isNaN`. DOM, `fetch`, and filesystem access are **not** available.

### Built-in DSP library

Both generators and processors can load the built-in DSP library with `require('dsp')`:

```javascript
const dsp = require('dsp');
```


| Factory               | Description                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsp.ema(alpha)`      | Stateful EMA filter. `alpha` ∈ (0, 1). Methods: `update(values[])`, `reset()`. Property: `value`.                                                                                                                                                                                                                                   |
| `dsp.spectrum(opts?)` | Stateful spectrum analyser (FFT-based). Options: `sampleRateHz`, `window` (`'rect'`/`'hann'`/`'hamming'`/`'blackman'`), `scale` (`'magnitude'`/`'db'`), `averaging`. Returns `{ frequencies, magnitudes }` from `compute(values[])`. Magnitudes use one-sided amplitude normalisation: a unit sinusoid yields a peak of 1.0 (0 dB). |


### Example — EMA using init + process scripts

**Init script:**

```javascript
const dsp = require('dsp');
state.ema = dsp.ema(0.1);
```

**Process script:**

```javascript
const m = getMeasurement("cpu_like");
if (!m || getNewPointCount("cpu_like") === 0) return;

const count  = getNewPointCount("cpu_like");
const start  = m.timestamps.length - count;
const newTs  = m.timestamps.slice(start);
const newEma = state.ema.update(m.series.value.slice(start));

ingest({
  measurementName: "cpu_like",
  points: { timestamps: newTs, series: [{ name: "ema", values: newEma }] }
});
```

## WebSocket Protocol

The server upgrades HTTP connections to WebSocket at the root path (`ws://host/`).

**Subscribe message** (client → server):

```json
{
  "type": "subscribe",
  "measurements": [
    { "measurementName": "cpu_like", "series": ["value", "ema"], "points": 500 }
  ]
}
```

The server pushes `snapshot` and `delta` messages whenever new data arrives. Delta messages include a `cleared: true` flag when the server has cleared a measurement's data, so the frontend can flush its local buffer. The client automatically reconnects on disconnect and replays the last subscribe message. See the full WebSocket protocol in the Swagger UI at `/api/docs`.