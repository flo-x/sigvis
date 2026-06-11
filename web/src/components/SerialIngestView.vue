<script setup>
import {
  isSerialSupported,
  PARSERS,
  config,
  state,
  resetCounters,
  connect,
  disconnect,
} from "../services/serialIngestService.js";

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
</script>

<template>
  <div class="adm-view serial-view">

    <!-- ── Not supported banner ─────────────────────────────────────────── -->
    <div v-if="!isSerialSupported" class="serial-unsupported">
      <strong>Web Serial API is not available.</strong>
      Serial ingest requires Chrome, Edge, or the Sigvis desktop app.
      Firefox and Safari do not support Web Serial.
    </div>

    <template v-else>

      <!-- ── Connection card ──────────────────────────────────────────────── -->
      <div class="adm-card">
        <h2>Serial port</h2>

        <div class="sv-field">
          <label class="sv-label" for="si-baud">Baud rate</label>
          <select
            id="si-baud"
            v-model.number="config.baudRate"
            :disabled="state.isConnected || state.isConnecting"
          >
            <option v-for="b in BAUD_RATES" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>

        <div class="sv-field">
          <label class="sv-label" for="si-parser">Line format</label>
          <select
            id="si-parser"
            v-model="config.parserId"
            :disabled="state.isConnected || state.isConnecting"
          >
            <option v-for="p in PARSERS" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>

        <div class="sv-field si-connect-row">
          <span class="si-status-dot" :class="{ connected: state.isConnected }" />
          <span class="sv-label">
            {{ state.isConnected ? 'Connected' : state.isConnecting ? 'Connecting…' : 'Disconnected' }}
          </span>
          <button
            class="si-connect-btn"
            :class="{ danger: state.isConnected }"
            :disabled="state.isConnecting"
            @click="state.isConnected ? disconnect() : connect()"
          >
            {{ state.isConnected ? 'Disconnect' : 'Connect…' }}
          </button>
        </div>

        <p v-if="state.lastError" class="si-error">{{ state.lastError }}</p>
      </div>

      <!-- ── Parser config card ───────────────────────────────────────────── -->
      <div class="adm-card">
        <h2>CSV parser settings</h2>

        <div class="sv-field">
          <label class="sv-label" for="si-meas">Measurement name</label>
          <input
            id="si-meas"
            v-model="config.measurementName"
            type="text"
            :disabled="state.isConnected"
          />
        </div>

        <div class="sv-field">
          <label class="sv-label" for="si-sep">Separator</label>
          <select id="si-sep" v-model="config.separator" :disabled="state.isConnected">
            <option value="auto">Auto-detect</option>
            <option value=",">Comma (,)</option>
            <option value="&#9;">Tab</option>
            <option value=" ">Space</option>
            <option value=";">Semicolon (;)</option>
          </select>
        </div>

        <div class="sv-field">
          <label class="sv-label" for="si-comment">Comment prefix</label>
          <input
            id="si-comment"
            v-model="config.commentPrefix"
            type="text"
            style="width: 4rem;"
            :disabled="state.isConnected"
          />
        </div>

        <div class="sv-field si-field-wide">
          <label class="sv-label" for="si-names">Series names</label>
          <input
            id="si-names"
            v-model="config.seriesNames"
            type="text"
            placeholder="field1, field2, …  (blank = auto)"
            class="si-names-input"
            :disabled="state.isConnected"
          />
        </div>

        <p class="si-hint">
          <strong>Series names</strong> — comma-separated list (e.g. <em>temp, hum, pressure</em>).
          When provided, these names are used immediately from the first line and
          header detection is skipped. Leave blank to auto-detect: if the first
          line is non-numeric it is treated as a header row; otherwise series are
          named <em>field1</em>, <em>field2</em>, … If a line arrives with more
          fields than expected, extra names are added automatically.
        </p>
      </div>

      <!-- ── Status card ──────────────────────────────────────────────────── -->
      <div class="adm-card">
        <div class="si-status-header">
          <h2>Status</h2>
          <button class="si-reset-btn" @click="resetCounters">Reset</button>
        </div>

        <div class="si-stats">
          <div class="si-stat">
            <span class="si-stat-label">Bytes received</span>
            <span class="si-stat-value">{{ state.bytesReceived.toLocaleString() }}</span>
          </div>
          <div class="si-stat">
            <span class="si-stat-label">Lines received</span>
            <span class="si-stat-value">{{ state.linesReceived.toLocaleString() }}</span>
          </div>
          <div class="si-stat">
            <span class="si-stat-label">Points ingested</span>
            <span class="si-stat-value">{{ state.pointsIngested.toLocaleString() }}</span>
          </div>
          <div class="si-stat">
            <span class="si-stat-label">Parse errors</span>
            <span class="si-stat-value" :class="{ 'si-error-val': state.parseErrors > 0 }">
              {{ state.parseErrors.toLocaleString() }}
            </span>
          </div>
          <div class="si-stat">
            <span class="si-stat-label">Ingest errors</span>
            <span class="si-stat-value" :class="{ 'si-error-val': state.ingestErrors > 0 }">
              {{ state.ingestErrors.toLocaleString() }}
            </span>
          </div>
        </div>

        <div v-if="state.lastLine" class="si-last-line">
          <span class="si-last-line-label">Last line</span>
          <code class="si-last-line-val">{{ state.lastLine }}</code>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.serial-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ── Unsupported banner ──────────────────────────────────────────────────── */
.serial-unsupported {
  padding: 0.75rem 1rem;
  background: var(--c-surface-subtle);
  border: 1px solid var(--c-border);
  border-radius: 6px;
  font-size: 0.875rem;
  color: var(--c-text-2);
  line-height: 1.5;
}

/* ── Shared field layout (reuse sv-* from SettingsView) ─────────────────── */
.sv-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--c-border-subtle);
  font-size: 0.875rem;
  gap: 0.5rem;
}
.sv-field:last-of-type { border-bottom: none; padding-bottom: 0; }

.sv-label { color: var(--c-text-2); flex-shrink: 0; }

.sv-field input[type="text"],
.sv-field select {
  width: 10rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  font: inherit;
  background: var(--c-surface-subtle);
  color: var(--c-text);
}

/* ── Connect row ─────────────────────────────────────────────────────────── */
.si-connect-row {
  border-bottom: none;
  padding-bottom: 0;
  gap: 0.6rem;
}

.si-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-border);
  flex-shrink: 0;
  transition: background 0.2s;
}
.si-status-dot.connected { background: #3a9e5f; }

.si-connect-btn {
  margin-left: auto;
  padding: 0.3rem 0.9rem;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  background: var(--c-surface-subtle);
  color: var(--c-text);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.si-connect-btn:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.si-connect-btn:disabled { opacity: 0.5; cursor: default; }
.si-connect-btn.danger {
  border-color: #9e3a3a;
  color: #c96060;
}
.si-connect-btn.danger:hover:not(:disabled) { background: rgba(158, 58, 58, 0.1); }

.si-error {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  color: var(--c-danger, #c96060);
}

/* ── Wide field (series names stretches full width) ─────────────────────── */
.si-field-wide {
  align-items: flex-start;
  flex-direction: column;
  gap: 0.3rem;
}
.si-names-input {
  width: 100% !important;
  box-sizing: border-box;
}

/* ── Hint ────────────────────────────────────────────────────────────────── */
.si-hint {
  margin: 0.6rem 0 0;
  font-size: 0.78rem;
  color: var(--c-text-3);
  line-height: 1.5;
}

/* ── Status card ─────────────────────────────────────────────────────────── */
.si-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}
.si-status-header h2 { margin: 0; }

.si-reset-btn {
  padding: 0.2rem 0.65rem;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  background: var(--c-surface-subtle);
  color: var(--c-text-2);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}
.si-reset-btn:hover { background: var(--c-surface-hover); color: var(--c-text); }

.si-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.3rem 1.5rem;
  font-size: 0.82rem;
  margin-bottom: 0.75rem;
}

.si-stat {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--c-border-subtle);
}
.si-stat-label { color: var(--c-text-2); }
.si-stat-value { font-variant-numeric: tabular-nums; }
.si-error-val  { color: var(--c-danger, #c96060); }

.si-last-line {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-size: 0.78rem;
  margin-top: 0.25rem;
}
.si-last-line-label { color: var(--c-text-3); flex-shrink: 0; }
.si-last-line-val {
  font-family: ui-monospace, Menlo, Consolas, "Liberation Mono", monospace;
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
