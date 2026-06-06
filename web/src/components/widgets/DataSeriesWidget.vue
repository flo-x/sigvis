<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { getSeriesCatalog, getSeriesData, subscribeSeriesData, unsubscribeSeriesData } from "../../services/seriesApi";
import { alignMeasurements } from "../../utils/alignMeasurements.js";
import { resolveColor, colorForId, PALETTE } from "../../utils/seriesColor.js";
import TimeSeriesChart from "../TimeSeriesChart.vue";
import ColorPicker from "../ColorPicker.vue";
import SeriesStylePicker from "../SeriesStylePicker.vue";
import { runtimeSettings } from "../../stores/runtimeSettingsStore";

const DEFAULT_SERIES_STYLE = { width: 2, paths: "linear" };

/** Return the first Tableau 10 palette color not already present in `usedColors`. */
function firstAvailablePaletteColor(usedColors) {
  for (const color of PALETTE) {
    if (!usedColors.has(color)) return color;
  }
  return PALETTE[usedColors.size % PALETTE.length]; // cycle when all 10 are used
}

const props = defineProps({
  widget: {
    type: Object,
    required: true
  },
  openConfigSignal: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(["update-config"]);

const catalog = ref([]);
const error = ref("");
const chartData = ref(null);
const chartTime = ref(true);
const hasPendingChartData = ref(false);

// ── Config panel width (resizable, persisted) ─────────────────────────────────
const PANEL_WIDTH_KEY = "configPanelWidth";
const PANEL_MIN_W = 300;
const PANEL_MAX_W = 800;

const panelWidth = ref(
  Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Number(localStorage.getItem(PANEL_WIDTH_KEY)) || 420))
);

const panelStyle = computed(() => ({
  width: Math.min(panelWidth.value, window.innerWidth * 0.95) + "px"
}));

const resizeHandleEl = ref(null);
let _resizeStart = null;

function onResizeDown(event) {
  resizeHandleEl.value.setPointerCapture(event.pointerId);
  _resizeStart = { x: event.clientX, w: panelWidth.value };
}

function onResizeMove(event) {
  if (!_resizeStart || !(event.buttons & 1)) return;
  const delta = _resizeStart.x - event.clientX; // drag left = wider
  panelWidth.value = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, _resizeStart.w + delta));
}

function onResizeUp() {
  _resizeStart = null;
  localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth.value));
}

// ── Config panel state ────────────────────────────────────────────────────────
const showConfigPanel = ref(false);
const draftTitle = ref("");
const draftSeriesIds = ref([]);
const draftSeriesColors = reactive({});
const draftSeriesStyles = reactive({});
const draftTimeSyncDomain = ref("");
const draftShowLegend = ref(true);
const draftValueFormat = ref("fixed");
const draftValueDecimals = ref(2);
const draftXAxisLabel = ref("");
const draftXAxisUnit = ref("");
const draftYAxisLabel = ref("");
const draftYAxisUnit = ref("");
const seriesSearch = ref("");

// ── Color picker popup ────────────────────────────────────────────────────────
const activeColorPickerId = ref(null);
const activePickerDraft = ref("#000000");
const pickerAnchorRect = ref(null);

const pickerPopupStyle = computed(() => {
  const r = pickerAnchorRect.value;
  if (!r) return {};
  const POPUP_W = 256;
  const POPUP_H = 330;
  const left = Math.max(8, r.left - POPUP_W - 10);
  const top  = Math.min(r.top, window.innerHeight - POPUP_H - 8);
  return { top: top + "px", left: left + "px" };
});

function openColorPicker(id, event) {
  closeStylePicker();
  activePickerDraft.value = draftSeriesColors[id] ?? colorForId(id);
  pickerAnchorRect.value = event.currentTarget.getBoundingClientRect();
  activeColorPickerId.value = id;
}

function closeColorPicker() {
  activeColorPickerId.value = null;
}

function toggleColorPicker(id, event) {
  if (activeColorPickerId.value === id) {
    closeColorPicker();
  } else {
    openColorPicker(id, event);
  }
}

function chooseColor() {
  if (activeColorPickerId.value) {
    draftSeriesColors[activeColorPickerId.value] = activePickerDraft.value;
  }
  closeColorPicker();
}

// ── Line style picker popup ───────────────────────────────────────────────────
const activeStylePickerId = ref(null);
const activeStyleDraft = ref({ ...DEFAULT_SERIES_STYLE });
const styleAnchorRect = ref(null);

const stylePopupStyle = computed(() => {
  const r = styleAnchorRect.value;
  if (!r) return {};
  const POPUP_W = 200;
  const POPUP_H = 220;
  const left = Math.max(8, r.left - POPUP_W - 10);
  const top  = Math.min(r.top, window.innerHeight - POPUP_H - 8);
  return { top: top + "px", left: left + "px" };
});

function openStylePicker(id, event) {
  closeColorPicker();
  activeStyleDraft.value = { ...DEFAULT_SERIES_STYLE, ...(draftSeriesStyles[id] ?? {}) };
  styleAnchorRect.value = event.currentTarget.getBoundingClientRect();
  activeStylePickerId.value = id;
}

function closeStylePicker() {
  activeStylePickerId.value = null;
}

function toggleStylePicker(id, event) {
  if (activeStylePickerId.value === id) {
    closeStylePicker();
  } else {
    openStylePicker(id, event);
  }
}

function chooseStyle() {
  if (activeStylePickerId.value) {
    draftSeriesStyles[activeStylePickerId.value] = { ...activeStyleDraft.value };
  }
  closeStylePicker();
}

function resolveStyle(id, overrides) {
  return { ...DEFAULT_SERIES_STYLE, ...(overrides?.[id] ?? {}) };
}

const catalogMap = computed(() => new Map(catalog.value.map((c) => [c.id, c])));

const filteredCatalog = computed(() => {
  const q = seriesSearch.value.trim().toLowerCase();
  if (!q) return catalog.value;
  return catalog.value.filter((item) => item.name.toLowerCase().includes(q));
});

const selectedSeriesItems = computed(() =>
  draftSeriesIds.value.map((id) => ({ id, name: catalogMap.value.get(id)?.name ?? id }))
);

function isLiveMode() {
  return props.widget.config?.liveMode !== false;
}

async function fetchCatalog() {
  try {
    catalog.value = await getSeriesCatalog();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load catalog.";
  }
}

function resubscribe() {
  const selected = props.widget.config?.seriesIds || [];
  const colorOverrides = props.widget.config?.seriesColors || {};
  const styleOverrides = props.widget.config?.seriesStyles || {};
  error.value = "";
  if (selected.length === 0) {
    unsubscribeSeriesData(props.widget.id);
    chartData.value = null;
    hasPendingChartData.value = true;
    return;
  }

  subscribeSeriesData({
    widgetId: props.widget.id,
    ids: selected,
    points: runtimeSettings.pointsToRequest,
    onData({ measurements }) {
      const catalogMap = new Map(catalog.value.map((c) => [c.id, c]));
      const enriched = measurements.map((m) => ({
        ...m,
        series: m.series.map((s) => {
          const id = `${m.measurementName}:${s.name}`;
          const meta = catalogMap.get(id);
          return {
            ...s,
            unit: meta?.unit ?? "",
            color: resolveColor(id, colorOverrides),
            ...resolveStyle(id, styleOverrides)
          };
        })
      }));
      error.value = "";
      chartTime.value = measurements[0]?.time ?? true;
      chartData.value = {
        timestamps: [],
        series: [],
        ...alignMeasurements(enriched)
      };
      if (isLiveMode()) {
        hasPendingChartData.value = true;
      }
    }
  });
}

async function fetchHistoryData() {
  const selected = props.widget.config?.seriesIds || [];
  if (selected.length === 0) return;
  error.value = "";
  try {
    const nextData = await getSeriesData({
      ids: selected,
      points: runtimeSettings.pointsToRequest,
      interval: 30
    });
    const colorOverrides = props.widget.config?.seriesColors || {};
    const styleOverrides = props.widget.config?.seriesStyles || {};
    chartTime.value = nextData.time ?? true;
    chartData.value = {
      ...nextData,
      series: nextData.series.map((s) => ({
        ...s,
        color: resolveColor(s.id, colorOverrides),
        ...resolveStyle(s.id, styleOverrides)
      }))
    };
    hasPendingChartData.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load series data.";
  }
}

// ── Config panel open / close / save ─────────────────────────────────────────
async function openConfigPanel() {
  // Ensure catalog is fresh before opening.
  await fetchCatalog();
  draftTitle.value = props.widget.config?.title ?? "";
  draftSeriesIds.value = [...(props.widget.config?.seriesIds ?? [])];
  // Seed color drafts for selected series.
  // Saved per-series overrides are preserved as-is. Series without a saved
  // override receive the first Tableau 10 palette color not already taken by
  // an earlier selected series (assignment order = selection order).
  const savedColors = props.widget.config?.seriesColors ?? {};
  for (const key of Object.keys(draftSeriesColors)) {
    delete draftSeriesColors[key];
  }
  for (const id of draftSeriesIds.value) {
    if (savedColors[id]) {
      draftSeriesColors[id] = savedColors[id];
    } else {
      draftSeriesColors[id] = firstAvailablePaletteColor(
        new Set(Object.values(draftSeriesColors))
      );
    }
  }
  const savedStyles = props.widget.config?.seriesStyles ?? {};
  for (const key of Object.keys(draftSeriesStyles)) {
    delete draftSeriesStyles[key];
  }
  for (const item of catalog.value) {
    draftSeriesStyles[item.id] = { ...DEFAULT_SERIES_STYLE, ...(savedStyles[item.id] ?? {}) };
  }
  draftTimeSyncDomain.value = props.widget.config?.timeSyncDomain ?? "";
  draftShowLegend.value = props.widget.config?.showLegend !== false;
  draftValueFormat.value = props.widget.config?.valueFormat ?? "fixed";
  draftValueDecimals.value = props.widget.config?.valueDecimals ?? 2;
  draftXAxisLabel.value = props.widget.config?.xAxisLabel ?? "";
  draftXAxisUnit.value = props.widget.config?.xAxisUnit ?? "";
  draftYAxisLabel.value = props.widget.config?.yAxisLabel ?? "";
  draftYAxisUnit.value = props.widget.config?.yAxisUnit ?? "";
  seriesSearch.value = "";
  closeColorPicker();
  closeStylePicker();
  showConfigPanel.value = true;
}

function closeConfigPanel() {
  closeColorPicker();
  closeStylePicker();
  showConfigPanel.value = false;
}

function saveConfigPanel() {
  closeColorPicker();
  closeStylePicker();
  // Only persist overrides for series that are actually selected, to keep
  // config lean. Un-selected series lose their override (resets to defaults).
  const savedColors = {};
  const savedStyles = {};
  for (const id of draftSeriesIds.value) {
    if (draftSeriesColors[id] !== undefined) {
      savedColors[id] = draftSeriesColors[id];
    }
    if (draftSeriesStyles[id] !== undefined) {
      savedStyles[id] = draftSeriesStyles[id];
    }
  }
  emit("update-config", {
    title: draftTitle.value.trim(),
    seriesIds: [...draftSeriesIds.value],
    seriesColors: savedColors,
    seriesStyles: savedStyles,
    timeSyncDomain: draftTimeSyncDomain.value.trim(),
    showLegend: draftShowLegend.value,
    valueFormat: draftValueFormat.value,
    valueDecimals: Math.max(0, Math.min(10, Math.round(Number(draftValueDecimals.value)))),
    xAxisLabel: draftXAxisLabel.value.trim(),
    xAxisUnit: draftXAxisUnit.value.trim(),
    yAxisLabel: draftYAxisLabel.value.trim(),
    yAxisUnit: draftYAxisUnit.value.trim()
  });
  closeConfigPanel();
}

function onZoomHistoryRequest() {
  if (props.widget.config?.liveMode === false) return;
  emit("update-config", { liveMode: false });
}

function onChartDataConsumed() {
  hasPendingChartData.value = false;
}

// ── Config panel keyboard shortcuts ───────────────────────────────────────────
function onConfigPanelKeydown(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeConfigPanel();
  } else if (event.key === "Enter") {
    // Don't intercept Enter while focus is inside a <select> or <textarea>.
    const tag = document.activeElement?.tagName;
    if (tag === "SELECT" || tag === "TEXTAREA") return;
    event.stopPropagation();
    saveConfigPanel();
  }
}

watch(showConfigPanel, (isOpen) => {
  if (isOpen) {
    document.addEventListener("keydown", onConfigPanelKeydown);
  } else {
    document.removeEventListener("keydown", onConfigPanelKeydown);
  }
});

onMounted(async () => {
  await fetchCatalog();
  resubscribe();
});

onBeforeUnmount(() => {
  unsubscribeSeriesData(props.widget.id);
  document.removeEventListener("keydown", onConfigPanelKeydown);
});

watch(
  () => props.widget.config?.seriesIds,
  async () => {
    resubscribe();
    if (!isLiveMode()) {
      await fetchHistoryData();
    }
  },
  { deep: true }
);

watch(
  () => props.widget.config?.seriesColors,
  () => {
    resubscribe();
  },
  { deep: true }
);

watch(
  () => props.widget.config?.seriesStyles,
  async () => {
    resubscribe();
    if (!isLiveMode()) {
      await fetchHistoryData();
    }
  },
  { deep: true }
);

watch(
  () => runtimeSettings.pointsToRequest,
  () => {
    resubscribe();
  }
);

watch(
  () => props.widget.config?.liveMode,
  async (nextLiveMode) => {
    if (nextLiveMode === false) {
      await fetchHistoryData();
    } else {
      hasPendingChartData.value = true;
    }
  }
);

watch(
  () => props.openConfigSignal,
  () => {
    openConfigPanel();
  }
);

// When the user checks a new series in the config panel, assign it the first
// Tableau 10 palette color not already used by the other selected series.
watch(draftSeriesIds, (newIds) => {
  if (!showConfigPanel.value) return;
  for (const id of newIds) {
    if (!draftSeriesColors[id]) {
      const usedColors = new Set(
        newIds.filter((sid) => sid !== id).map((sid) => draftSeriesColors[sid]).filter(Boolean)
      );
      draftSeriesColors[id] = firstAvailablePaletteColor(usedColors);
    }
  }
});
</script>

<template>
  <div class="data-series-widget">
    <div v-if="error" class="widget-message error">{{ error }}</div>
    <div v-else-if="!widget.config?.seriesIds?.length" class="widget-message">
      Select at least one data series — click <strong>Configure</strong>.
    </div>
    <TimeSeriesChart
      v-else-if="chartData"
      :chart-data="chartData"
      :live-mode="widget.config?.liveMode !== false"
      :has-pending-data="hasPendingChartData"
      :time="chartTime"
      :show-legend="widget.config?.showLegend !== false"
      :value-format="widget.config?.valueFormat ?? 'fixed'"
      :value-decimals="widget.config?.valueDecimals ?? 2"
      :x-axis-label="widget.config?.xAxisLabel ?? ''"
      :x-axis-unit="widget.config?.xAxisUnit ?? ''"
      :y-axis-label="widget.config?.yAxisLabel ?? ''"
      :y-axis-unit="widget.config?.yAxisUnit ?? ''"
      :theme="runtimeSettings.resolvedTheme"
      @data-consumed="onChartDataConsumed"
      @zoom-history-request="onZoomHistoryRequest"
    />

    <!-- Backdrop -->
    <Teleport to="body">
      <div v-if="showConfigPanel" class="config-panel-backdrop" @click.self="saveConfigPanel" />

      <div class="config-panel" :class="{ open: showConfigPanel }" :style="panelStyle">
        <!-- Drag handle on the left edge -->
        <div
          ref="resizeHandleEl"
          class="config-panel-resize"
          @pointerdown="onResizeDown"
          @pointermove="onResizeMove"
          @pointerup="onResizeUp"
          @pointercancel="onResizeUp"
        />
        <div class="config-panel-header">
          <h3>Widget Settings</h3>
          <button type="button" class="config-panel-close" @click="closeConfigPanel">✕</button>
        </div>

        <div class="config-panel-body">
          <!-- Title -->
          <label class="config-field">
            Card title
            <input
              v-model="draftTitle"
              type="text"
              placeholder="Data Series"
            />
          </label>

          <!-- Series selection (checkbox only) -->
          <fieldset class="config-series-fieldset">
            <legend>Data series</legend>
            <input
              v-model="seriesSearch"
              type="search"
              class="config-series-search"
              placeholder="Search series…"
              autocomplete="off"
            />
            <div class="config-series-scroll">
              <template v-for="item in filteredCatalog" :key="item.id">
                <div class="config-series-row">
                  <input
                    type="checkbox"
                    :value="item.id"
                    v-model="draftSeriesIds"
                  />
                  <span class="config-series-label">{{ item.name }}</span>
                </div>
              </template>
              <p v-if="catalog.length === 0" class="config-series-empty">
                No series available yet — ingest some data first.
              </p>
              <p v-else-if="filteredCatalog.length === 0" class="config-series-empty">
                No series match "{{ seriesSearch }}".
              </p>
            </div>
          </fieldset>

          <!-- Per-series appearance (color + line style) for selected series -->
          <fieldset v-if="selectedSeriesItems.length > 0" class="config-series-fieldset">
            <legend>Appearance</legend>
            <div class="config-selected-list">
              <div
                v-for="item in selectedSeriesItems"
                :key="item.id"
                class="config-series-row"
              >
                <button
                  type="button"
                  class="color-swatch-btn"
                  :style="{ background: draftSeriesColors[item.id] ?? colorForId(item.id) }"
                  :aria-label="`Pick color for ${item.name}`"
                  @click.stop="toggleColorPicker(item.id, $event)"
                />
                <button
                  type="button"
                  class="series-style-btn"
                  :style="{ color: draftSeriesColors[item.id] ?? colorForId(item.id) }"
                  :aria-label="`Set line style for ${item.name}`"
                  @click.stop="toggleStylePicker(item.id, $event)"
                  >
                    <svg width="22" height="10" viewBox="0 0 22 10" style="display:block">
                      <template v-if="(draftSeriesStyles[item.id]?.width ?? 2) === 0">
                        <circle cx="5"  cy="5" r="1.8" fill="currentColor" />
                        <circle cx="11" cy="5" r="1.8" fill="currentColor" />
                        <circle cx="17" cy="5" r="1.8" fill="currentColor" />
                      </template>
                      <line
                        v-else
                        x1="2" y1="5" x2="20" y2="5"
                        stroke="currentColor"
                        :stroke-width="draftSeriesStyles[item.id]?.width ?? 2"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                <span class="config-series-label">{{ item.name }}</span>
              </div>
            </div>
          </fieldset>

          <!-- Legend visibility -->
          <label class="config-toggle-row">
            <input type="checkbox" v-model="draftShowLegend" />
            Show legend
          </label>

          <!-- Value format -->
          <fieldset class="config-series-fieldset">
            <legend>Value format</legend>
            <div class="config-axis-group config-axis-group--center">
              <label class="config-field config-axis-field">
                Format
                <select v-model="draftValueFormat" class="config-select">
                  <option value="fixed">Fixed decimal</option>
                  <option value="scientific">Scientific (e notation)</option>
                  <option value="si">Engineering SI prefix</option>
                </select>
              </label>
              <label class="config-field" style="width: 5.5rem; flex-shrink: 0">
                Decimals
                <input
                  v-model.number="draftValueDecimals"
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  class="config-number-input"
                />
              </label>
            </div>
          </fieldset>

          <!-- Axes -->
          <fieldset class="config-series-fieldset">
            <legend>Axes</legend>
            <div class="config-axis-group">
              <span class="config-axis-name">X</span>
              <label class="config-field config-axis-field">
                Label
                <input v-model="draftXAxisLabel" type="text" placeholder="e.g. Distance" />
              </label>
              <label class="config-field config-axis-field">
                Unit
                <input v-model="draftXAxisUnit" type="text" placeholder="e.g. m" />
              </label>
            </div>
            <div class="config-axis-group">
              <span class="config-axis-name">Y</span>
              <label class="config-field config-axis-field">
                Label
                <input v-model="draftYAxisLabel" type="text" placeholder="e.g. Temperature" />
              </label>
              <label class="config-field config-axis-field">
                Unit
                <input v-model="draftYAxisUnit" type="text" placeholder="e.g. °C" />
              </label>
            </div>
          </fieldset>

          <!-- Time synchronization domain -->
          <label class="config-field">
            Time synchronization domain
            <input
              v-model="draftTimeSyncDomain"
              type="text"
              placeholder="example: market-1"
            />
          </label>
        </div>

        <div class="config-panel-footer">
          <button type="button" @click="closeConfigPanel">Discard</button>
        </div>
      </div>
    </Teleport>

    <!-- Floating color picker popup -->
    <Teleport to="body">
      <template v-if="activeColorPickerId">
        <div class="cp-popup-backdrop" @click="chooseColor" />
        <div class="cp-popup" :style="pickerPopupStyle" @click.stop>
          <ColorPicker v-model="activePickerDraft" />
          <div class="cp-popup-footer">
            <button type="button" @click="closeColorPicker">Cancel</button>
            <button type="button" class="primary" @click="chooseColor">Choose</button>
          </div>
        </div>
      </template>
    </Teleport>

    <!-- Floating line style picker popup -->
    <Teleport to="body">
      <template v-if="activeStylePickerId">
        <div class="cp-popup-backdrop" @click="chooseStyle" />
        <div class="cp-popup" :style="stylePopupStyle" @click.stop>
          <SeriesStylePicker v-model="activeStyleDraft" />
          <div class="cp-popup-footer">
            <button type="button" @click="closeStylePicker">Cancel</button>
            <button type="button" class="primary" @click="chooseStyle">Choose</button>
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
