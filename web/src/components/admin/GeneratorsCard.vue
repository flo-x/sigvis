<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import CodeMirrorEditor from "./CodeMirrorEditor.vue";
import PrebuiltConfigFields from "./PrebuiltConfigFields.vue";
import SlideOverPanel from "./SlideOverPanel.vue";
import { useDragReorder } from "../../composables/useDragReorder.js";
import {
  getGenerators, pauseGenerators, resumeGenerators,
  getGenerator, createGenerator, updateGenerator, deleteGenerator,
  reorderGenerators
} from "../../services/adminApi.js";

const props = defineProps({
  prebuiltsCatalog: { type: Array, default: () => [] },
  seriesCatalog:    { type: Array, default: () => [] }
});

// ── List state ────────────────────────────────────────────────────────────────
const generators  = ref([]);
const paused      = ref(false);
const listMsg     = ref("");
const listMsgErr  = ref(false);
const showHelp    = ref(false);

const { onDragStart, onDragOver, onDrop, onDragEnd, dropClass } =
  useDragReorder(generators, async (reordered) => {
    try {
      await reorderGenerators(reordered.map((g) => g.id));
    } catch (e) {
      listMsg.value   = e.message;
      listMsgErr.value = true;
      await load();
    }
  });

async function load() {
  try {
    const data = await getGenerators();
    generators.value = data.items || [];
    paused.value     = Boolean(data.paused);
    listMsg.value    = "";
  } catch (e) {
    listMsg.value   = e.message;
    listMsgErr.value = true;
  }
}

async function togglePause() {
  try {
    if (paused.value) {
      await resumeGenerators();
    } else {
      await pauseGenerators();
    }
    await load();
  } catch (e) {
    listMsg.value   = e.message;
    listMsgErr.value = true;
  }
}

async function toggleEnabled(gen) {
  const prev = gen.enabled;
  gen.enabled = !prev;
  try {
    await updateGenerator(gen.id, { enabled: gen.enabled });
  } catch (e) {
    gen.enabled = prev;
    listMsg.value   = e.message;
    listMsgErr.value = true;
  }
}

async function removeGenerator(gen) {
  if (!confirm(`Delete generator "${gen.name}"?`)) {
    return;
  }
  try {
    await deleteGenerator(gen.id);
    listMsg.value   = `Deleted "${gen.name}".`;
    listMsgErr.value = false;
    await load();
  } catch (e) {
    listMsg.value   = e.message;
    listMsgErr.value = true;
  }
}

function typeLabel(item) {
  if (item.kind !== "prebuilt") {
    return "custom";
  }
  const pb = props.prebuiltsCatalog.find((p) => p.id === item.prebuiltId);
  return pb ? pb.displayName : item.prebuiltId;
}

// ── Generator code examples ───────────────────────────────────────────────────
const GEN_EXAMPLES = [
  {
    id:       "random-walk",
    label:    "Random walk",
    initCode:
`// Initialise persistent state — runs once on save and on server start.
state.tsGen = makeTimestamps();
state.value = 0;`,
    code:
`// Random walk producing 10 samples per second (1 point per 100 ms tick).
const timestamps = state.tsGen(10); // 10 Hz

const values = timestamps.map(() => {
  state.value = state.value * 0.99 + (Math.random() - 0.5) * 0.1;
  return +state.value.toFixed(4);
});

ingest({
  measurementName: "my_generator",
  points: { timestamps, series: { value: values } }
});`,
  },
  {
    id:       "sine-wave",
    label:    "Sine wave",
    initCode:
`// Initialise persistent state — runs once on save and on server start.
state.tsGen = makeTimestamps();
state.phase = 0;`,
    code:
`// Sine-wave generator: 1 Hz signal, amplitude 1, sampled at 50 Hz.
// Configure Interval to 100 ms (= 5 samples per tick).
const FREQ_HZ   = 1;
const AMPLITUDE = 1;
const SAMPLE_HZ = 2;

const timestamps = state.tsGen(SAMPLE_HZ);

const values = timestamps.map(() => {
  state.phase += 2 * Math.PI * FREQ_HZ / SAMPLE_HZ;
  return +(AMPLITUDE * Math.sin(state.phase)).toFixed(6);
});

ingest({
  measurementName: "sine_gen",
  points: { timestamps, series: { value: values } }
});`,
  },
];

// ── Form state ────────────────────────────────────────────────────────────────
const selectedExampleId = ref("");
const formVisible    = ref(false);
const formMode       = ref("new");
const formId         = ref("");
const formName       = ref("");
const formEnabled    = ref(true);
const formIntervalMs = ref(1000);
const formKind       = ref("prebuilt");
const formPrebuiltId = ref("");
const formConfig     = ref({});
const formConfigErrors = ref({});
const formInitCode   = ref("");
const formCode       = ref("");
const saving         = ref(false);
const formMsg        = ref("");
const formMsgErr     = ref(false);

const filteredPrebuilts = computed(() =>
  props.prebuiltsCatalog.filter((p) => p.kind === "generator")
);

const selectedPrebuilt = computed(() =>
  filteredPrebuilts.value.find((p) => p.id === formPrebuiltId.value) || null
);

function onPrebuiltChange(id) {
  formPrebuiltId.value = id;
  formConfig.value = {};
  formConfigErrors.value = {};
}

function loadExample(id) {
  const ex = GEN_EXAMPLES.find((e) => e.id === id);
  if (!ex) { return; }
  if ((formInitCode.value.trim() || formCode.value.trim()) &&
      !confirm("Replace current code with this example?")) {
    selectedExampleId.value = "";
    return;
  }
  formInitCode.value = ex.initCode;
  formCode.value     = ex.code;
}

function openNew() {
  formMode.value          = "new";
  formId.value            = "";
  formName.value          = "";
  formEnabled.value       = true;
  formIntervalMs.value    = 1000;
  formKind.value          = "prebuilt";
  formPrebuiltId.value    = filteredPrebuilts.value[0]?.id || "";
  formConfig.value        = {};
  formConfigErrors.value  = {};
  formInitCode.value      = "";
  formCode.value          = "";
  selectedExampleId.value = "";
  formMsg.value           = "";
  formMsgErr.value        = false;
  formVisible.value       = true;
}

async function openEdit(gen) {
  try {
    const full = await getGenerator(gen.id);
    formMode.value       = "edit";
    formId.value         = full.id;
    formName.value       = full.name;
    formEnabled.value    = full.enabled;
    formIntervalMs.value = full.intervalMs;
    formKind.value       = full.kind === "prebuilt" ? "prebuilt" : "custom";
    formPrebuiltId.value = full.prebuiltId || filteredPrebuilts.value[0]?.id || "";
    formConfig.value     = { ...(full.config || {}) };
    formConfigErrors.value = { ...(full.configErrors || {}) };
    formInitCode.value   = full.initCode || "";
    formCode.value       = full.code || "";
    formMsg.value        = "";
    formMsgErr.value     = false;
    formVisible.value    = true;
  } catch (e) {
    listMsg.value   = e.message;
    listMsgErr.value = true;
  }
}

function closeForm() {
  formVisible.value = false;
}

// ── Form keyboard shortcuts ───────────────────────────────────────────────────
function onFormKeydown(e) {
  if (e.key === "Escape") {
    closeForm();
  } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveForm(false);
  }
}

watch(formVisible, (val) => {
  if (val) {
    document.addEventListener("keydown", onFormKeydown);
  } else {
    document.removeEventListener("keydown", onFormKeydown);
  }
});

async function saveForm(clearState = false) {
  const name = formName.value.trim();
  if (!name) {
    formMsg.value    = "Name is required.";
    formMsgErr.value = true;
    return;
  }
  const duplicate = generators.value.some(
    (g) => g.name === name && g.id !== formId.value
  );
  if (duplicate) {
    formMsg.value    = `A generator named "${name}" already exists.`;
    formMsgErr.value = true;
    return;
  }
  saving.value   = true;
  formMsg.value  = "";
  formMsgErr.value = false;
  try {
    let body;
    if (formKind.value === "prebuilt") {
      body = {
        name, enabled: formEnabled.value,
        intervalMs: Number(formIntervalMs.value) || 1000,
        kind: "prebuilt",
        prebuiltId: formPrebuiltId.value,
        config: formConfig.value,
        clearState
      };
    } else {
      body = {
        name, enabled: formEnabled.value,
        intervalMs: Number(formIntervalMs.value) || 1000,
        initCode: formInitCode.value,
        code: formCode.value,
        clearState
      };
    }

    let d;
    if (formMode.value === "edit") {
      d = await updateGenerator(formId.value, body);
    } else {
      d = await createGenerator(body);
    }

    if (formKind.value === "prebuilt" && d.configErrors && Object.keys(d.configErrors).length > 0) {
      formConfigErrors.value = d.configErrors;
      formConfig.value       = { ...(d.config || {}) };
      formMsg.value   = "Saved with config errors — check fields above.";
      formMsgErr.value = true;
    } else {
      const suffix = clearState ? " (state cleared)" : "";
      formMsg.value   = `Saved "${d.name}"${suffix}.`;
      formMsgErr.value = false;
      closeForm();
      await load();
    }
  } catch (e) {
    formMsg.value   = e.message;
    formMsgErr.value = true;
  } finally {
    saving.value = false;
  }
}

onMounted(load);

// ── Error popover ─────────────────────────────────────────────────────────────
const errPopover = ref({ visible: false, text: "", top: 0, left: 0, width: 0 });

function showErrPopover(e, text) {
  const r  = e.currentTarget.getBoundingClientRect();
  const vw = window.innerWidth;
  const pw = Math.min(480, vw - 24);
  let left = r.left;
  if (left + pw > vw - 12) {
    left = vw - pw - 12;
  }
  errPopover.value = { visible: true, text, top: r.bottom + 6, left, width: pw };
  document.addEventListener("click", closeErrPopover, true);
  document.addEventListener("keydown", closeErrOnEsc, true);
}

function closeErrPopover(e) {
  if (e.target.closest(".adm-err-popover")) {
    return;
  }
  cleanupErrPopover();
}

function cleanupErrPopover() {
  errPopover.value.visible = false;
  document.removeEventListener("click", closeErrPopover, true);
  document.removeEventListener("keydown", closeErrOnEsc, true);
}

function closeErrOnEsc(e) {
  if (e.key === "Escape") {
    cleanupErrPopover();
  }
}

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onFormKeydown);
  cleanupErrPopover();
});
</script>

<template>
  <div class="adm-card">
    <!-- Header -->
    <div style="display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.75rem">
      <h2 style="margin: 0">Series Generators</h2>
      <button
        class="adm-btn"
        :class="{ 'adm-btn-warning': paused }"
        type="button"
        style="font-size: 0.78rem; padding: 0.15rem 0.55rem"
        @click="togglePause"
      >
        {{ paused ? '▶ Resume all' : '⏸ Pause all' }}
      </button>
      <button
        class="adm-btn"
        type="button"
        style="font-size: 0.78rem; padding: 0.15rem 0.55rem"
        @click="showHelp = true"
      >
        Help
      </button>
    </div>

    <!-- Help drawer -->
    <SlideOverPanel v-model:open="showHelp" title="Generator Help">
      <div class="adm-help-panel" style="border: none; background: none; padding: 0; margin: 0">
        <h4>How generators work</h4>
        <p>
          Each generator has <strong>two scripts</strong> that share the same <code>state</code> object:
        </p>
        <ul>
          <li><strong>Init script</strong> — runs <em>once</em> when the generator is saved and on server start. Use it to initialise stateful objects stored in <code>state</code>.</li>
          <li><strong>Process script</strong> — runs <em>at the configured interval</em>. Produce data and push it via <code>ingest()</code>.</li>
        </ul>
        <p>Generators have <strong>no input trigger</strong> — they produce data autonomously. Output flows through the store and triggers matching processors.</p>
        <p>Both scripts support <code>return</code> for early exit (e.g. <code>if (timestamps.length === 0) return;</code>).</p>
        <h4>Script API</h4>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>ingest({...})</td><td>function</td><td>Writes data into the store. Merges by default; add <code>clearMeasurement: true</code> to wipe existing data first.</td></tr>
            <tr><td>makeTimestamps()</td><td>function</td><td>Returns a stateful timestamp-generator function. Call once in the init script: <code>state.tsGen = makeTimestamps()</code>. Each tick call <code>state.tsGen(hz)</code> with the desired sample rate — returns the array of timestamps (spaced at exactly 1000/hz ms) covering the time since the last call.</td></tr>
            <tr><td>getMeasurement(name)</td><td>function</td><td>Returns <code>&#123; timestamps, series &#125;</code> or <code>null</code>.</td></tr>
            <tr><td>listMeasurements()</td><td>function</td><td>Returns <code>string[]</code> of all known measurement names.</td></tr>
            <tr><td>setIntervalMs(ms)</td><td>function</td><td>Change the firing rate at runtime (non-persistent).</td></tr>
            <tr><td>require(module)</td><td>function</td><td>Load a built-in library. Available: <code>'dsp'</code>.</td></tr>
            <tr><td>state</td><td>object</td><td>Private in-memory storage, shared between scripts.</td></tr>
            <tr><td>log(msg)</td><td>function</td><td>Writes a tagged line to the server console. Also available as <code>console.log()</code>.</td></tr>
            <tr><td>Date</td><td>global</td><td>Standard <code>Date</code> — use <code>Date.now()</code> for timestamps.</td></tr>
          </tbody>
        </table>
        <p style="font-size: 0.78rem; color: var(--c-text-3); margin: 0">
          Also available: <code>Math</code>, <code>JSON</code>, <code>Array</code>, <code>Object</code>, <code>Map</code>, <code>Set</code>, <code>parseFloat</code>, <code>parseInt</code>.
          DOM, <code>fetch</code>, and filesystem access are <strong>not</strong> available.
        </p>

        <h4>Example — Sine-wave generator</h4>
        <p style="font-size: 0.82rem; color: var(--c-text-3); margin: 0 0 0.35rem">
          Configure with <strong>Interval: 100 ms</strong>. Uses <code>makeTimestamps(50)</code> to
          produce exactly 5 timestamps per tick at 50 Hz — a smooth 1 Hz sine of amplitude 1.
          No manual step-counting needed.
        </p>
        <p style="font-size: 0.82rem; color: var(--c-text-3); margin: 0 0 0.35rem"><strong>Init script</strong></p>
        <pre>state.tsGen = makeTimestamps();
state.phase = 0;</pre>
        <p style="font-size: 0.82rem; color: var(--c-text-3); margin: 0.5rem 0 0.35rem"><strong>Process script</strong></p>
        <pre>// Sine-wave generator: 1 Hz signal, amplitude 1.
const FREQ_HZ   = 1;
const AMPLITUDE = 1;
const SAMPLE_HZ = 50;

const timestamps = state.tsGen(SAMPLE_HZ);

const values = timestamps.map(() => {
  state.phase += 2 * Math.PI * FREQ_HZ / SAMPLE_HZ;
  return +(AMPLITUDE * Math.sin(state.phase)).toFixed(6);
});

ingest({
  measurementName: "sine_gen",
  points: { timestamps, series: { value: values } }
});</pre>

        <h4>DSP Library — <code>require('dsp')</code></h4>
        <p style="font-size: 0.82rem; color: var(--c-text-3); margin: 0 0 0.5rem">
          Load in the init script: <code>const dsp = require('dsp');</code>
        </p>

        <p style="font-size: 0.82rem; font-weight: 600; margin: 0 0 0.2rem">dsp.ema(alpha) — Exponential Moving Average</p>
        <table>
          <thead><tr><th>Name</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>dsp.ema(alpha)</td><td>Create a stateful EMA. <code>alpha</code> ∈ (0, 1). Higher = faster response, less smoothing. Time constant ≈ 1/alpha samples.</td></tr>
            <tr><td>instance.update(values)</td><td>Feed an array of new values. Returns smoothed <code>number[]</code> of same length.</td></tr>
            <tr><td>instance.reset()</td><td>Clear the internal accumulator (e.g. after a data gap).</td></tr>
            <tr><td>instance.value</td><td>Current accumulator value, or <code>undefined</code> before the first update.</td></tr>
          </tbody>
        </table>

        <p style="font-size: 0.82rem; font-weight: 600; margin: 0.75rem 0 0.2rem">dsp.median(windowSize) — Sliding-Window Median Filter</p>
        <table>
          <thead><tr><th>Name</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>dsp.median(n)</td><td>Create a stateful median filter over the last <code>n</code> samples. Rejects impulse noise. Odd window sizes are conventional.</td></tr>
            <tr><td>instance.update(values)</td><td>Feed an array of new values. Returns filtered <code>number[]</code> of same length.</td></tr>
            <tr><td>instance.reset()</td><td>Clear the internal sample buffer.</td></tr>
            <tr><td>instance.buffer</td><td>Copy of the current window contents (<code>number[]</code>).</td></tr>
          </tbody>
        </table>

        <p style="font-size: 0.82rem; font-weight: 600; margin: 0.75rem 0 0.2rem">dsp.spectrum(options) — FFT Spectrum Analyser</p>
        <table>
          <thead><tr><th>Option</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>sampleRateHz</td><td>1</td><td>Sample rate in Hz. Use 1 for normalised [0, 0.5] output.</td></tr>
            <tr><td>window</td><td>'rect'</td><td>Window function: <code>rect</code>, <code>hann</code>, <code>hamming</code>, <code>blackman</code>.</td></tr>
            <tr><td>scale</td><td>'magnitude'</td><td><code>'magnitude'</code> (linear) or <code>'db'</code> (decibels, 0 dB = amplitude 1).</td></tr>
            <tr><td>averaging</td><td>1</td><td>EMA frames for spectral smoothing. 1 = no averaging.</td></tr>
          </tbody>
        </table>
        <p style="font-size: 0.8rem; margin: 0.3rem 0 0.2rem">
          <code>instance.compute(values)</code> → <code>&#123; frequencies, magnitudes &#125;</code> — process a new frame of samples (zero-padded to next power of 2).
        </p>
        <p style="font-size: 0.8rem; margin: 0 0 0.2rem">
          <code>instance.reset()</code> — clear the spectral accumulator.<br>
          <code>instance.configure(opts)</code> — update options at runtime (resets accumulator).
        </p>
        <p style="font-size: 0.78rem; color: var(--c-text-3); margin: 0 0 0.25rem">
          Tip: estimate <code>sampleRateHz</code> from timestamps as <code>1000 / medianDeltaMs</code>.
          Use power-of-2 block sizes (128, 256, 512 …) for best FFT efficiency.
          <code>averaging: 8</code> with <code>window: 'hann'</code> is a good starting point for live streams.
        </p>
      </div>
    </SlideOverPanel>

    <p style="font-size: 0.82rem; color: var(--c-text-3); margin: 0 0 0.85rem">
      JavaScript generators run at a fixed interval and produce data series autonomously.
    </p>

    <!-- List -->
    <ul class="adm-item-list">
      <li v-if="generators.length === 0">
        <span class="adm-item-empty">No generators defined.</span>
      </li>
      <li
        v-for="(gen, index) in generators"
        :key="gen.id"
        draggable="true"
        :class="dropClass(index)"
        @dragstart="onDragStart($event, index)"
        @dragover="onDragOver($event, index)"
        @drop="onDrop($event, index)"
        @dragend="onDragEnd"
      >
        <span class="adm-drag-handle" title="Drag to reorder">⠿</span>
        <span class="adm-item-name adm-item-name--link" @click="openEdit(gen)">{{ gen.name }}</span>
        <span class="adm-item-type">{{ typeLabel(gen) }}</span>
        <span
          class="adm-badge adm-badge--toggle"
          :class="gen.enabled ? 'adm-badge-enabled' : 'adm-badge-disabled'"
          :title="gen.enabled ? 'Click to disable' : 'Click to enable'"
          @click="toggleEnabled(gen)"
        >{{ gen.enabled ? 'enabled' : 'disabled' }}</span>
        <span class="adm-item-interval">{{ gen.intervalMs }} ms</span>
        <span
          v-if="gen.initError"
          class="adm-item-error"
          @click.stop="showErrPopover($event, gen.initError)"
        >Init error: {{ gen.initError }}</span>
        <span
          v-if="gen.lastError"
          class="adm-item-error"
          @click.stop="showErrPopover($event, gen.lastError)"
        >Error: {{ gen.lastError }}</span>
        <button class="adm-btn" type="button" @click="openEdit(gen)">Edit</button>
        <button class="adm-btn adm-btn-danger" type="button" @click="removeGenerator(gen)">Delete</button>
      </li>
    </ul>

    <p v-if="listMsg" class="adm-msg" :class="listMsgErr ? 'adm-msg-error' : 'adm-msg-ok'">
      {{ listMsg }}
    </p>

    <!-- Slide-over edit / create form -->
    <SlideOverPanel
      v-model:open="formVisible"
      :title="formMode === 'edit' ? 'Edit Generator' : 'New Generator'"
      :close-on-backdrop="false"
    >
      <!-- Kind toggle -->
      <div class="adm-kind-toggle">
        <label><input v-model="formKind" type="radio" value="prebuilt" /> Prebuilt</label>
        <label><input v-model="formKind" type="radio" value="custom" /> Custom script</label>
      </div>

      <div class="adm-field">
        <label for="genFormName">Name</label>
        <input id="genFormName" v-model="formName" type="text" placeholder="My Generator" style="max-width: 24rem" />
      </div>

      <div class="adm-field-row">
        <input id="genFormEnabled" v-model="formEnabled" type="checkbox" style="width: auto; margin: 0" />
        <label for="genFormEnabled" style="font-weight: normal; margin: 0">Enabled</label>
      </div>

      <div class="adm-field">
        <label for="genFormInterval">Interval (ms) <span class="adm-label-sub">minimum 30</span></label>
        <input
          id="genFormInterval"
          v-model.number="formIntervalMs"
          type="number"
          min="30"
          step="10"
          style="max-width: 9rem"
        />
      </div>

      <!-- Prebuilt section -->
      <template v-if="formKind === 'prebuilt'">
        <div class="adm-field">
          <label for="genFormPrebuiltId">Prebuilt type</label>
          <select
            id="genFormPrebuiltId"
            :value="formPrebuiltId"
            style="max-width: 22rem"
            @change="onPrebuiltChange($event.target.value)"
          >
            <option v-for="pb in filteredPrebuilts" :key="pb.id" :value="pb.id">
              {{ pb.displayName }}
            </option>
          </select>
        </div>
        <PrebuiltConfigFields
          v-if="selectedPrebuilt"
          :schema="selectedPrebuilt.paramSchema"
          :model-value="formConfig"
          :errors="formConfigErrors"
          :series-catalog="seriesCatalog"
          @update:model-value="formConfig = $event"
        />
      </template>

      <!-- Custom script section -->
      <template v-else>
        <div class="adm-field adm-field--inline">
          <label for="genExampleSelect">Load example</label>
          <select
            id="genExampleSelect"
            v-model="selectedExampleId"
            style="max-width: 22rem"
            @change="loadExample(selectedExampleId)"
          >
            <option value="">— choose an example —</option>
            <option v-for="ex in GEN_EXAMPLES" :key="ex.id" :value="ex.id">{{ ex.label }}</option>
          </select>
          <button
            class="adm-btn adm-help-inline-btn"
            type="button"
            title="Script API reference"
            @click="showHelp = true"
          >Help</button>
        </div>
        <div class="adm-field">
          <label>Init script <span class="adm-label-sub">(runs once on save and server start)</span></label>
          <CodeMirrorEditor v-model="formInitCode" />
        </div>
        <div class="adm-field">
          <label>Process script <span class="adm-label-sub">(runs at every interval tick)</span></label>
          <CodeMirrorEditor v-model="formCode" />
        </div>
      </template>

      <p v-if="formMsg" class="adm-msg" :class="formMsgErr ? 'adm-msg-error' : 'adm-msg-ok'">
        {{ formMsg }}
      </p>

      <!-- Action buttons -->
      <div class="adm-form-btns">
        <button class="adm-btn adm-btn-primary" type="button" :disabled="saving" @click="saveForm(false)">Save</button>
        <button
          v-if="formMode === 'edit'"
          class="adm-btn"
          type="button"
          :disabled="saving"
          @click="saveForm(true)"
        >Save &amp; Clear state</button>
        <button class="adm-btn" type="button" @click="closeForm">Cancel</button>
      </div>
    </SlideOverPanel>

    <button class="adm-btn adm-btn-primary" type="button" style="margin-top: 0.25rem" @click="openNew">
      + New Generator
    </button>
  </div>

  <Teleport to="body">
    <Transition name="help-pop">
      <div
        v-if="errPopover.visible"
        class="adm-err-popover"
        :style="{ top: errPopover.top + 'px', left: errPopover.left + 'px', width: errPopover.width + 'px' }"
      >
        <pre>{{ errPopover.text }}</pre>
      </div>
    </Transition>
  </Teleport>
</template>
