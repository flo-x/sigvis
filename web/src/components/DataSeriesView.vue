<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import { getAdminSeries, updateSeriesMeasurement, clearSeriesMeasurement, getLastPoints } from "../services/adminApi.js";

const items            = ref([]);
const defaultThreshold = ref(null);
const defaultMaxPoints = ref(null);
const loadMsg          = ref("");
const loadMsgErr       = ref(false);
const autoRefresh      = ref(true);

// Per-row editing state: { [name]: { thresholdSeconds: string, maxPoints: string } }
const editing  = ref({});
const saving   = ref({});
const editMsg  = ref({});
const clearing = ref({});

// ── Preview (last 100 points) ─────────────────────────────────────────────────
const previewName    = ref(null);   // expanded measurement name
const previewData    = ref(null);   // { time, timestamps, series: [{ name, values }] }
const previewLoading = ref(false);
const previewError   = ref("");

async function togglePreview(item) {
  if (previewName.value === item.measurementName) {
    previewName.value = null;
    previewData.value = null;
    return;
  }
  previewName.value  = item.measurementName;
  previewData.value  = null;
  previewError.value = "";
  if (!item.dataSeriesNames.length) {
    return;
  }
  previewLoading.value = true;
  try {
    previewData.value = await getLastPoints(item.measurementName, item.dataSeriesNames, 100);
  } catch (e) {
    previewError.value = e.message;
  } finally {
    previewLoading.value = false;
  }
}

function fmtTimestamp(ts, isTime) {
  if (!isTime) {
    return typeof ts === "number" ? ts.toPrecision(6) : ts;
  }
  const d = new Date(ts);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const yyyy = d.getFullYear();
  const MM   = pad(d.getMonth() + 1);
  const dd   = pad(d.getDate());
  const hh   = pad(d.getHours());
  const mm   = pad(d.getMinutes());
  const ss   = pad(d.getSeconds());
  const ms   = pad(d.getMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}.${ms}`;
}

// DOM refs for the two inputs per row, keyed by "<name>:threshold" / "<name>:maxPoints"
const inputRefs = {};

async function load() {
  try {
    const data = await getAdminSeries();
    items.value            = data.items || [];
    defaultThreshold.value = data.defaultThresholdSeconds ?? null;
    defaultMaxPoints.value = data.defaultMaxPoints ?? null;
    loadMsg.value          = "";
  } catch (e) {
    loadMsg.value    = e.message;
    loadMsgErr.value = true;
  }
}

async function startEdit(item, focusField) {
  const name = item.measurementName;
  if (editing.value[name]) {
    return; // already editing
  }
  editing.value = {
    ...editing.value,
    [name]: {
      thresholdSeconds: String(item.thresholdSeconds),
      maxPoints:        String(item.maxPoints)
    }
  };
  const mc = { ...editMsg.value };
  delete mc[name];
  editMsg.value = mc;

  await nextTick();
  const key = `${name}:${focusField}`;
  inputRefs[key]?.focus();
  inputRefs[key]?.select();
}

function cancelEdit(name) {
  clearBlurTimer(name);
  const ec = { ...editing.value }; delete ec[name]; editing.value = ec;
  const mc = { ...editMsg.value }; delete mc[name]; editMsg.value = mc;
}

async function saveEdit(item) {
  const name  = item.measurementName;
  const draft = editing.value[name];
  if (!draft) {
    return;
  }

  const patch = {};

  if (item.time) {
    const ts = Number(draft.thresholdSeconds);
    if (!Number.isFinite(ts) || ts < 60) {
      editMsg.value = { ...editMsg.value, [name]: { text: "Retention must be at least 60 s.", err: true } };
      return;
    }
    patch.thresholdSeconds = Math.trunc(ts);
  }

  const mp = Number(draft.maxPoints);
  if (!Number.isFinite(mp) || mp < 1000) {
    editMsg.value = { ...editMsg.value, [name]: { text: "Max points must be at least 1000.", err: true } };
    return;
  }
  patch.maxPoints = Math.trunc(mp);

  saving.value = { ...saving.value, [name]: true };
  try {
    await updateSeriesMeasurement(name, patch);
    cancelEdit(name);
    await load();
  } catch (e) {
    editMsg.value = { ...editMsg.value, [name]: { text: e.message, err: true } };
  } finally {
    const sc = { ...saving.value }; delete sc[name]; saving.value = sc;
  }
}

// ── Clear measurement ─────────────────────────────────────────────────────────
async function clearMeasurement(item) {
  if (!confirm(`Clear all data points for "${item.measurementName}"?`)) {
    return;
  }
  clearing.value = { ...clearing.value, [item.measurementName]: true };
  try {
    await clearSeriesMeasurement(item.measurementName);
    await load();
  } catch (e) {
    loadMsg.value    = e.message;
    loadMsgErr.value = true;
  } finally {
    const c = { ...clearing.value };
    delete c[item.measurementName];
    clearing.value = c;
  }
}

// ── Blur-based save (focus leaving the row) ───────────────────────────────────
// Use a short timer so moving between the two inputs in the same row doesn't
// trigger a premature save.
const blurTimers = {};

function onInputBlur(item) {
  const name = item.measurementName;
  blurTimers[name] = setTimeout(() => {
    delete blurTimers[name];
    if (editing.value[name]) {
      saveEdit(item);
    }
  }, 120);
}

function onInputFocus(name) {
  clearBlurTimer(name);
}

function clearBlurTimer(name) {
  if (blurTimers[name]) {
    clearTimeout(blurTimers[name]);
    delete blurTimers[name];
  }
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
let _timer = null;

function startAutoRefresh() {
  _timer = setInterval(load, 3000);
}

function stopAutoRefresh() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

onMounted(() => {
  load();
  startAutoRefresh();
});

onBeforeUnmount(stopAutoRefresh);
</script>

<template>
  <div class="adm-card">
    <!-- Header -->
    <div style="display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap">
      <h2 style="margin: 0">Data Series</h2>
      <button
        class="adm-btn"
        type="button"
        style="font-size: 0.78rem; padding: 0.15rem 0.55rem"
        @click="load"
      >Refresh</button>
      <label style="display: flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; cursor: pointer; user-select: none">
        <input type="checkbox" :checked="autoRefresh" style="cursor: pointer" @change="toggleAutoRefresh" />
        Auto-refresh
      </label>
      <span style="margin-left: auto; font-size: 0.78rem; color: var(--c-text-3); display: flex; gap: 1rem">
        <span v-if="defaultThreshold !== null">Default retention: {{ defaultThreshold }} s</span>
        <span v-if="defaultMaxPoints !== null">Default max points: {{ defaultMaxPoints.toLocaleString() }}</span>
      </span>
    </div>

    <p v-if="loadMsg" class="adm-msg" :class="loadMsgErr ? 'adm-msg-error' : 'adm-msg-ok'">{{ loadMsg }}</p>

    <p v-if="items.length === 0 && !loadMsg" style="font-size: 0.85rem; color: var(--c-text-3)">
      No measurements yet. Ingest some data to see it here.
    </p>

    <div v-if="items.length > 0" class="ds-table-wrap">
      <table class="ds-table">
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Type</th>
            <th>Series</th>
            <th class="ds-col-num">Points</th>
            <th class="ds-col-editable">Retention (s)</th>
            <th class="ds-col-editable">Max points</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in items" :key="item.measurementName">
          <tr>
            <!-- Name -->
            <td class="ds-cell-name">
              <span
                class="ds-meas-name-link"
                :class="{ active: previewName === item.measurementName }"
                :title="previewName === item.measurementName ? 'Click to collapse' : 'Click to preview data'"
                @click="togglePreview(item)"
              >{{ item.measurementName }}</span>
            </td>

            <!-- Type badge -->
            <td>
              <span class="adm-badge">
                {{ item.time ? 'time' : 'numeric' }}
              </span>
            </td>

            <!-- Series chips -->
            <td class="ds-cell-series">
              <span v-for="s in item.dataSeriesNames" :key="s" class="ds-series-chip">{{ s }}</span>
            </td>

            <!-- Point count (live, read-only) -->
            <td class="ds-col-num">{{ item.pointCount.toLocaleString() }}</td>

            <!-- Retention (s) -->
            <td class="ds-col-editable">
              <template v-if="item.time">
                <input
                  v-if="editing[item.measurementName]"
                  :ref="el => { if (el) inputRefs[`${item.measurementName}:threshold`] = el }"
                  v-model="editing[item.measurementName].thresholdSeconds"
                  type="number" min="60" step="60"
                  class="ds-threshold-input"
                  :disabled="saving[item.measurementName]"
                  @keydown.enter.prevent="saveEdit(item)"
                  @keydown.escape.prevent="cancelEdit(item.measurementName)"
                  @blur="onInputBlur(item)"
                  @focus="onInputFocus(item.measurementName)"
                />
                <span
                  v-else
                  class="ds-field-view"
                  title="Click to edit"
                  @click="startEdit(item, 'threshold')"
                >{{ item.thresholdSeconds }}</span>
              </template>
              <span v-else style="color: var(--c-text-3); font-size: 0.75rem">n/a</span>
            </td>

            <!-- Max points -->
            <td class="ds-col-editable">
              <input
                v-if="editing[item.measurementName]"
                :ref="el => { if (el) inputRefs[`${item.measurementName}:maxPoints`] = el }"
                v-model="editing[item.measurementName].maxPoints"
                type="number" min="1000" step="1000"
                class="ds-threshold-input"
                :disabled="saving[item.measurementName]"
                @keydown.enter.prevent="saveEdit(item)"
                @keydown.escape.prevent="cancelEdit(item.measurementName)"
                @blur="onInputBlur(item)"
                @focus="onInputFocus(item.measurementName)"
              />
              <span
                v-else
                class="ds-field-view"
                title="Click to edit"
                @click="startEdit(item, 'maxPoints')"
              >{{ item.maxPoints.toLocaleString() }}</span>
              <span
                v-if="editMsg[item.measurementName]"
                class="adm-msg adm-msg-error"
                style="font-size: 0.72rem; display: block; margin-top: 0.2rem; white-space: normal"
              >{{ editMsg[item.measurementName].text }}</span>
            </td>

            <!-- Clear button -->
            <td>
              <button
                class="adm-btn adm-btn-danger"
                type="button"
                style="padding: 0.1rem 0.5rem; font-size: 0.75rem"
                :disabled="clearing[item.measurementName]"
                @click="clearMeasurement(item)"
              >Clear</button>
            </td>
          </tr>

          <!-- Preview row (last 100 points) -->
          <tr v-if="previewName === item.measurementName" class="ds-preview-row">
            <td colspan="7" style="padding: 0.5rem 0.6rem 0.75rem">
              <div v-if="previewLoading" style="font-size: 0.8rem; color: var(--c-text-3)">Loading…</div>
              <div v-else-if="previewError" class="adm-msg adm-msg-error" style="font-size: 0.8rem">{{ previewError }}</div>
              <div v-else-if="!previewData || !previewData.timestamps.length" style="font-size: 0.8rem; color: var(--c-text-3)">No data.</div>
              <template v-else>
                <div style="font-size: 0.75rem; color: var(--c-text-3); margin-bottom: 0.4rem">
                  Last {{ previewData.timestamps.length }} points
                </div>
                <div class="ds-preview-wrap">
                  <table class="ds-preview-table">
                    <thead>
                      <tr>
                        <th>{{ previewData.time ? 'Timestamp' : 'X' }}</th>
                        <th v-for="s in previewData.series" :key="s.name">{{ s.name }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(ts, i) in [...previewData.timestamps].reverse()" :key="i">
                        <td class="ds-preview-ts">{{ fmtTimestamp(ts, previewData.time) }}</td>
                        <td
                          v-for="s in previewData.series"
                          :key="s.name"
                          class="ds-preview-val"
                        >{{ s.values[previewData.timestamps.length - 1 - i] ?? '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </td>
          </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
