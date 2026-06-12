<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import uPlot from "uplot";
import { subscribeGlobalRender } from "../services/globalCadence";

const props = defineProps({
  chartData: {
    type: Object,
    default: null
  },
  cellHeightPx: {
    type: Number,
    default: 72
  },
  liveMode: {
    type: Boolean,
    default: true
  },
  hasPendingData: {
    type: Boolean,
    default: false
  },
  time: {
    type: Boolean,
    default: true
  },
  valueFormat: {
    type: String,
    default: "fixed"  // "fixed" | "scientific" | "si"
  },
  valueDecimals: {
    type: Number,
    default: 2
  },
  xAxisLabel: {
    type: String,
    default: ""
  },
  xAxisUnit: {
    type: String,
    default: ""
  },
  yAxisLabel: {
    type: String,
    default: ""
  },
  yAxisUnit: {
    type: String,
    default: ""
  },
  showLegend: {
    type: Boolean,
    default: true
  },
  theme: {
    type: String,
    default: "light",
    validator: (v) => ["light", "dark"].includes(v)
  }
});
const emit = defineEmits(["zoom-history-request", "data-consumed"]);

const mainChartEl = ref(null);
const overviewChartEl = ref(null);
const brushLeftPx = ref(0);
const brushWidthPx = ref(0);
let mainChart = null;
let overviewChart = null;
let resizeObserver = null;
let overviewXMin = null;
let overviewXMax = null;
let dragState = null;
let zoomSwitchSent = false;
let rebuildScaleToApply = null;
let suppressNextZoomSwitchEvents = 0;
let onMainChartPointerDown = null;
let unsubscribeGlobalRender = null;
// Last known cursor position (px, plot-relative). Tracked via setCursor hook
// because uPlot resets cursor.left to -10 inside setData() before we can read it.
let lastCursorLeft = -1;
let lastCursorTop  = -1;
// Set to true by updateChartsData() so the next draw hook replays the cursor.
let cursorRestorePending = false;
// Colors/styles used when the chart was last built — compared instead of mainChart.series[i].stroke
// because uPlot converts stroke strings to functions internally, breaking === comparisons.
let chartsBuiltWithColors = [];
let chartsBuiltWithStyles = []; // [{width, paths}] per series
// Series labels hidden by the user via legend clicks. Persists across rebuilds
// so visibility is preserved when switching live ↔ history mode.
let hiddenSeriesLabels = new Set();
// Wheel-zoom event cleanup function — stored so we can detach on chart destroy.
let wheelZoomCleanup = null;
// Last Y range produced by the auto-range controller. Updated by yRangeCallback
// so the wheel handler can restore it when zoom-out is blocked.
let autoYMin = null;
let autoYMax = null;

// Drag start position in plot-local CSS pixels (same coordinate space as u.cursor.left/top).
// Captured at pointerdown so deltaX/deltaY can be computed from actual cursor movement
// rather than from the selection box, which uPlot fills to full extent on the non-drag axis.
let dragStartLeft   = -1;
let dragStartTop    = -1;
let isDraggingMain  = false;

const MIN_BRUSH_PX = 24;

// ── Drag-selection info card ─────────────────────────────────────────────────
// Raw values from the active uPlot selection; null when no selection visible.
const selInfo = ref(null);

function fmtXInfoCard(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (props.time) {
    return new Date(v * 1000).toLocaleTimeString("en-GB");
  }
  const unit = props.xAxisUnit.trim();
  const dec  = Math.max(0, Math.round(props.valueDecimals));
  const fmt  = props.valueFormat;
  if (fmt === "scientific") { return unit ? `${v.toExponential(dec)} ${unit}` : v.toExponential(dec); }
  if (fmt === "si") { return toSI(v, dec, unit); }
  return unit ? `${v.toFixed(dec)} ${unit}` : v.toFixed(dec);
}

function fmtYInfoCard(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const unit = props.yAxisUnit.trim();
  const dec  = Math.max(0, Math.round(props.valueDecimals));
  const fmt  = props.valueFormat;
  if (fmt === "scientific") { return unit ? `${v.toExponential(dec)} ${unit}` : v.toExponential(dec); }
  if (fmt === "si") { return toSI(v, dec, unit); }
  return unit ? `${v.toFixed(dec)} ${unit}` : v.toFixed(dec);
}

function fmtDeltaX(dx) {
  if (!Number.isFinite(dx)) return "—";
  if (props.time) {
    const sign = dx < 0 ? "-" : "";
    const adx  = Math.abs(dx);
    if (adx < 60)   { return `${sign}${adx.toFixed(2)} s`; }
    if (adx < 3600) { return `${sign}${(adx / 60).toFixed(2)} min`; }
    return `${sign}${(adx / 3600).toFixed(2)} h`;
  }
  return fmtXInfoCard(dx);
}

const selDisplay = computed(() => {
  const s = selInfo.value;
  if (!s) return null;
  const dec = Math.max(0, Math.round(props.valueDecimals));
  const yu = props.yAxisUnit.trim();
  const xu = props.time ? "s" : props.xAxisUnit.trim();
  const slopeUnit = (yu && xu) ? `${yu}/${xu}` : "";

  const xScale   = mainChart?.scales?.x;
  const xRange   = (xScale && Number.isFinite(xScale.min) && Number.isFinite(xScale.max))
    ? Math.abs(xScale.max - xScale.min)
    : 0;
  const xEpsilon = xRange > 0 ? xRange / 10000 : 1e-12;

  const absDeltaX = Math.abs(s.deltaX);
  const slope     = absDeltaX > xEpsilon ? s.deltaY / s.deltaX : null;
  const slopeStr  = slope == null
    ? "—"
    : (Math.abs(slope) >= 1e4 || (Math.abs(slope) < 1e-3 && slope !== 0))
      ? slope.toExponential(2)
      : slope.toFixed(dec);
  const freq = props.time
    ? (absDeltaX > xEpsilon ? toSI(1 / absDeltaX, dec, "Hz") : "—")
    : null;

  return {
    x:         fmtXInfoCard(s.xCursor),
    y:         fmtYInfoCard(s.yCursor),
    deltaX:    fmtDeltaX(s.deltaX),
    deltaY:    fmtYInfoCard(s.deltaY),
    slope:     slopeStr,
    slopeUnit,
    freq,
  };
});

function getMainLegendReservedHeight() {
  if (props.showLegend === false) return 0;
  const seriesCount = props.chartData?.series?.length || 0;
  if (seriesCount === 0) return 0;
  // Slightly conservative reservation avoids clipping/overflow from uPlot legend rows.
  return 28 + seriesCount * 20;
}

function getMainPlotSize() {
  const width = Math.max(240, Math.floor(mainChartEl.value?.clientWidth || 0));
  const rawHeight = Math.floor(mainChartEl.value?.clientHeight || 0);
  const height = Math.max(90, rawHeight - getMainLegendReservedHeight());
  return { width, height };
}

function getOverviewPlotSize() {
  const width = Math.max(240, Math.floor(overviewChartEl.value?.clientWidth || 0));
  const height = Math.max(40, Math.floor(overviewChartEl.value?.clientHeight || props.cellHeightPx));
  return { width, height };
}

function getOverviewPixelWidth() {
  return Math.max(1, getOverviewPlotSize().width);
}

function clampBrush(left, width) {
  const maxWidth = getOverviewPixelWidth();
  const clampedWidth = Math.max(MIN_BRUSH_PX, Math.min(maxWidth, width));
  const clampedLeft = Math.max(0, Math.min(maxWidth - clampedWidth, left));
  return {
    left: clampedLeft,
    width: clampedWidth
  };
}

function destroyCharts() {
  if (mainChart) {
    mainChart.destroy();
    mainChart = null;
  }
  if (overviewChart) {
    overviewChart.destroy();
    overviewChart = null;
  }
  lastCursorLeft        = -1;
  lastCursorTop         = -1;
  cursorRestorePending  = false;
  chartsBuiltWithColors = [];
  chartsBuiltWithStyles = [];
  selInfo.value         = null;
  dragStartLeft         = -1;
  dragStartTop          = -1;
  isDraggingMain        = false;
  if (wheelZoomCleanup) {
    wheelZoomCleanup();
    wheelZoomCleanup = null;
  }
  autoYMin = null;
  autoYMax = null;
}


function setBrushFromMainScale() {
  if (!mainChart || !overviewChart || overviewXMin == null || overviewXMax == null) {
    return;
  }

  const xScale = mainChart.scales.x;
  const min = xScale.min;
  const max = xScale.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    // During chart rebuild uPlot can transiently expose null x-scale; do not
    // overwrite an existing brush with full-range fallback in that window.
    return;
  }
  const left = overviewChart.valToPos(min, "x");
  const right = overviewChart.valToPos(max, "x");
  const normalized = clampBrush(
    Number.isFinite(left) ? left : 0,
    Number.isFinite(right - left) ? right - left : getOverviewPixelWidth()
  );
  brushLeftPx.value = normalized.left;
  brushWidthPx.value = normalized.width;
}

function maybeSwitchToHistoryOnZoom() {
  if (suppressNextZoomSwitchEvents > 0) {
    suppressNextZoomSwitchEvents -= 1;
    return;
  }
  if (!props.liveMode || zoomSwitchSent || !mainChart || overviewXMin == null || overviewXMax == null) {
    return;
  }

  const xScale = mainChart.scales.x;
  const min = xScale.min;
  const max = xScale.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return;
  }

  const fullRange = overviewXMax - overviewXMin;
  const selectedRange = max - min;
  if (!Number.isFinite(fullRange) || fullRange <= 0) {
    return;
  }

  if (selectedRange < fullRange - 1e-9) {
    zoomSwitchSent = true;
    emit("zoom-history-request");
  }
}

function maybeSwitchToHistoryOnMainPointerDown() {
  if (!props.liveMode || zoomSwitchSent) {
    return;
  }
  zoomSwitchSent = true;
  emit("zoom-history-request");
}

function applyMainScaleFromBrush() {
  if (!mainChart || !overviewChart || overviewXMin == null || overviewXMax == null) {
    return;
  }

  const leftVal = overviewChart.posToVal(brushLeftPx.value, "x");
  const rightVal = overviewChart.posToVal(brushLeftPx.value + brushWidthPx.value, "x");
  if (!Number.isFinite(leftVal) || !Number.isFinite(rightVal) || rightVal <= leftVal) {
    return;
  }

  mainChart.setScale("x", { min: leftVal, max: rightVal });
}

function withProgrammaticScaleUpdate(updateFn) {
  suppressNextZoomSwitchEvents += 1;
  updateFn();
}

function onOverviewPointerDown(event) {
  if (!overviewChartEl.value || !overviewChart) {
    return;
  }

  const rect = overviewChartEl.value.getBoundingClientRect();
  const pointerX = Math.max(0, Math.min(getOverviewPixelWidth(), event.clientX - rect.left));
  const target = event.target;
  const isLeftGrip = target instanceof HTMLElement && target.classList.contains("chart-brush-grip-left");
  const isRightGrip = target instanceof HTMLElement && target.classList.contains("chart-brush-grip-right");

  let mode = "move";
  if (isLeftGrip) {
    mode = "resize-left";
  } else if (isRightGrip) {
    mode = "resize-right";
  }

  const brushLeft = brushLeftPx.value;
  const brushRight = brushLeftPx.value + brushWidthPx.value;
  const offsetInsideBrush =
    pointerX >= brushLeft && pointerX <= brushRight ? pointerX - brushLeft : brushWidthPx.value / 2;

  dragState = {
    mode,
    offsetInsideBrush
  };

  const onMove = (moveEvent) => {
    if (!dragState || !overviewChartEl.value) {
      return;
    }

    const moveX = Math.max(
      0,
      Math.min(getOverviewPixelWidth(), moveEvent.clientX - overviewChartEl.value.getBoundingClientRect().left)
    );

    if (dragState.mode === "move") {
      const nextLeft = moveX - dragState.offsetInsideBrush;
      const normalized = clampBrush(nextLeft, brushWidthPx.value);
      brushLeftPx.value = normalized.left;
      brushWidthPx.value = normalized.width;
    } else if (dragState.mode === "resize-left") {
      const right = brushLeftPx.value + brushWidthPx.value;
      const nextLeft = Math.max(0, Math.min(right - MIN_BRUSH_PX, moveX));
      brushLeftPx.value = nextLeft;
      brushWidthPx.value = right - nextLeft;
    } else if (dragState.mode === "resize-right") {
      const left = brushLeftPx.value;
      const nextRight = Math.max(left + MIN_BRUSH_PX, Math.min(getOverviewPixelWidth(), moveX));
      brushWidthPx.value = nextRight - left;
    }

    applyMainScaleFromBrush();
  };

  const onUp = () => {
    dragState = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  event.preventDefault();
}

// ── Value formatter ──────────────────────────────────────────────────────────

const SI_PREFIXES = [
  { exp: 15, prefix: "P" }, { exp: 12, prefix: "T" }, { exp: 9,  prefix: "G" },
  { exp: 6,  prefix: "M" }, { exp: 3,  prefix: "k" }, { exp: 0,  prefix: ""  },
  { exp: -3, prefix: "m" }, { exp: -6, prefix: "μ" }, { exp: -9, prefix: "n" },
  { exp: -12, prefix: "p" }, { exp: -15, prefix: "f" }
];

function toSI(value, decimals, unit) {
  if (value === 0) return `0${decimals > 0 ? "." + "0".repeat(decimals) : ""}${unit ? " " + unit : ""}`;
  const abs = Math.abs(value);
  const entry = SI_PREFIXES.find(p => abs >= Math.pow(10, p.exp)) ?? SI_PREFIXES[SI_PREFIXES.length - 1];
  const scaled = value / Math.pow(10, entry.exp);
  const prefix = entry.prefix;
  return unit ? `${scaled.toFixed(decimals)} ${prefix}${unit}` : `${scaled.toFixed(decimals)}${prefix ? " " + prefix : ""}`;
}

function makeValueFormatter(format, decimals, unit) {
  return (v) => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (format === "scientific") {
      const s = v.toExponential(decimals);
      return unit ? `${s} ${unit}` : s;
    }
    if (format === "si") return toSI(v, decimals, unit);
    // "fixed" (default)
    const s = v.toFixed(decimals);
    return unit ? `${s} ${unit}` : s;
  };
}

function makePathsBuilder(style) {
  switch (style) {
    case "stepped-before": return uPlot.paths.stepped({ align: -1 });
    case "stepped-after":  return uPlot.paths.stepped({ align: 1 });
    case "stepped-middle": return uPlot.paths.stepped({ align: 0 });
    case "spline":         return uPlot.paths.spline?.() ?? null;
    default:               return null; // linear (uPlot default)
  }
}

function buildCharts() {
  if (!mainChartEl.value || !overviewChartEl.value || !props.chartData || props.chartData.series.length === 0) {
    return;
  }

  // Read theme colors from CSS variables so uPlot canvas content adapts to the theme.
  const style = getComputedStyle(document.documentElement);
  const getCSSVar = (name) => style.getPropertyValue(name).trim();
  const axisStroke = getCSSVar("--c-text-2")   || "#374151";
  const gridStroke = getCSSVar("--c-border")    || "#d1d5db";
  const tickStroke = getCSSVar("--c-border")    || "#d1d5db";

  const xData = getXData(props.chartData, props.time);
  const mainValues = props.chartData.series.map((series) => series.values);
  const mainData = [xData, ...mainValues];
  const overviewSeries = props.chartData.series[0];
  const overviewData = [xData, overviewSeries.values];
  overviewXMin = xData[0];
  overviewXMax = xData[xData.length - 1];

  // Dead-band buffer controller for the y-axis range.
  //
  // The "buffer" is the gap between the data extreme and the scale limit,
  // expressed as a fraction of the full range.  A smoothed (EMA) monitor
  // tracks this fraction; corrections fire only when the monitor leaves the
  // dead-band [BUF_LOW, BUF_HIGH].
  //
  //   data exceeds scale              → snap-expand, restore BUF_TARGET
  //   smoothedBuf < BUF_LOW  (5%)    → snap-expand, restore BUF_TARGET
  //   smoothedBuf > BUF_HIGH (15%)   → snap-contract, restore BUF_TARGET
  //   smoothedBuf ∈ [5%, 15%]        → hold (no change to scale)
  //
  // Two independent alphas:
  //   BUF_ALPHA — how fast the monitor reacts to buffer-fraction changes
  //   (not used here because we snap rather than EMA-decay, but kept as a
  //    separate constant for the smoothedBuf EMA)
  const BUF_TARGET = 0.10;
  const BUF_LOW    = 0.05;
  const BUF_HIGH   = 0.15;
  const BUF_ALPHA  = 0.001;   // EMA coefficient for the buffer-fraction monitor

  let emaYMin        = null;
  let emaYMax        = null;
  let smoothedTopBuf = BUF_TARGET;
  let smoothedBotBuf = BUF_TARGET;
  let prevRangeMin   = null;
  let prevRangeMax   = null;

  // Called by uPlot as the range callback for the y scale (auto: true).
  // uPlot passes the visible data min/max; we apply the dead-band buffer
  // controller and return the final [min, max] for the y axis.
  function yRangeCallback(_u, dataMin, dataMax) {
    // Guard: if uPlot has no visible data yet, return current ema bounds
    // or a safe default to avoid NaN propagation.
    if (dataMin == null || dataMax == null || !Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      if (emaYMin === null) return [-1, 1];
      return [emaYMin, emaYMax];
    }

    if (emaYMin === null) {
      // First call with real data — initialise with target buffer in place.
    const span = Math.max(dataMax - dataMin, 1e-6);
    emaYMax = dataMax + BUF_TARGET * span;
    emaYMin = dataMin - BUF_TARGET * span;
    smoothedTopBuf = BUF_TARGET;
    smoothedBotBuf = BUF_TARGET;
  } else {
      const range = Math.max(emaYMax - emaYMin, 1e-6);

      // --- MAX ---
      const topBufFrac = (emaYMax - dataMax) / range;
      smoothedTopBuf = BUF_ALPHA * topBufFrac + (1 - BUF_ALPHA) * smoothedTopBuf;

      let maxReason = null;
      if (dataMax > emaYMax) {
        emaYMax = dataMax + BUF_TARGET * range;
        smoothedTopBuf = BUF_TARGET;
        maxReason = "data exceeded max";
      } else if (smoothedTopBuf < BUF_LOW) {
        emaYMax += (BUF_TARGET - smoothedTopBuf) * range;
        smoothedTopBuf = BUF_TARGET;
        maxReason = `top buf ${(topBufFrac * 100).toFixed(1)}% < ${BUF_LOW * 100}%`;
      } else if (smoothedTopBuf > BUF_HIGH) {
        emaYMax = dataMax + BUF_TARGET * range;
        smoothedTopBuf = BUF_TARGET;
        maxReason = `top buf ${(topBufFrac * 100).toFixed(1)}% > ${BUF_HIGH * 100}%`;
      }

      // --- MIN ---
      const updatedRange = Math.max(emaYMax - emaYMin, 1e-6);
      const botBufFrac = (dataMin - emaYMin) / updatedRange;
      smoothedBotBuf = BUF_ALPHA * botBufFrac + (1 - BUF_ALPHA) * smoothedBotBuf;

      let minReason = null;
      if (dataMin < emaYMin) {
        emaYMin = dataMin - BUF_TARGET * updatedRange;
        smoothedBotBuf = BUF_TARGET;
        minReason = "data exceeded min";
      } else if (smoothedBotBuf < BUF_LOW) {
        emaYMin -= (BUF_TARGET - smoothedBotBuf) * updatedRange;
        smoothedBotBuf = BUF_TARGET;
        minReason = `bot buf ${(botBufFrac * 100).toFixed(1)}% < ${BUF_LOW * 100}%`;
      } else if (smoothedBotBuf > BUF_HIGH) {
        emaYMin = dataMin - BUF_TARGET * updatedRange;
        smoothedBotBuf = BUF_TARGET;
        minReason = `bot buf ${(botBufFrac * 100).toFixed(1)}% > ${BUF_HIGH * 100}%`;
      }

  }

    prevRangeMin = emaYMin;
    prevRangeMax = emaYMax;
    autoYMin = emaYMin;
    autoYMax = emaYMax;
    return [emaYMin, emaYMax];
  }

  const mainSize = getMainPlotSize();
  const xAxisLabel = props.xAxisLabel.trim();
  const xAxisUnit  = props.xAxisUnit.trim();
  const yAxisLabel = props.yAxisLabel.trim();
  const yAxisUnit  = props.yAxisUnit.trim();
  const fmt        = props.valueFormat;
  const dec        = Math.max(0, Math.round(props.valueDecimals));

  const fmtY = makeValueFormatter(fmt, dec, yAxisUnit);
  const fmtX = makeValueFormatter(fmt, dec, xAxisUnit);

  // Auto-sizing legend values: track the widest formatted string seen since the
  // last chart rebuild and left-pad narrower values with non-breaking spaces so
  // the digit column stays stable as data updates.
  function makePaddedFormatter(fmt) {
    let maxLen = 0;
    return (s) => {
      if (s !== "—" && s.length > maxLen) maxLen = s.length;
      return s.length < maxLen ? "\u00a0".repeat(maxLen - s.length) + s : s;
    };
  }

  // Sign-alignment: prepend a non-breaking space to non-negative values so the
  // digit column aligns with negative values in the legend. Applied only here
  // (not in fmtY/fmtX) so axis tick labels stay plain and measure correctly.
  const signPad = (v, s) => (Number.isFinite(v) && v >= 0 ? "\u00a0" + s : s);

  const padY = makePaddedFormatter();
  const fmtYLegend = (v) => {
    const s = fmtY(v);
    return padY(s === "—" ? s : signPad(v, s));
  };

  // Time / x-axis legend row: use uPlot's date formatter for timestamp axes,
  // fmtX for numeric axes. Apply the same nbsp padding.
  const timeFmt = props.time ? uPlot.fmtDate("{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}") : null;
  const padX = makePaddedFormatter();
  const fmtXLegend = (_u, v) => {
    if (v == null || !Number.isFinite(v)) return padX("—");
    const s = props.time ? timeFmt(new Date(v * 1000)) : signPad(v, fmtX(v));
    return padX(s);
  };

  const mainOptions = {
    width: mainSize.width,
    height: mainSize.height,
    pxAlign: 0,
    legend: { show: props.showLegend },
    scales: {
      x: { time: props.time },
      y: { range: yRangeCallback }
    },
    axes: [
      {
        // X-axis: only override tick formatter when unit or label set on a numeric axis.
        ...(xAxisLabel ? { label: xAxisLabel, labelSize: 32 } : {}),
        ...(xAxisUnit  ? { values: (_u, vals) => vals.map(v => v == null ? "" : fmtX(v)) } : {}),
        stroke: axisStroke,
        grid:  { stroke: gridStroke, width: 1 },
        ticks: { stroke: tickStroke, width: 1 }
      },
      {
        ...(yAxisLabel ? { label: yAxisLabel, labelSize: 32 } : {}),
        values: (_u, vals) => vals.map(v => v == null ? "" : fmtY(v)),
        stroke: axisStroke,
        grid:  { stroke: gridStroke, width: 1 },
        ticks: { stroke: tickStroke, width: 1 },
        // uPlot's default size function measures ticks with its own internal
        // formatter, ignoring our custom `values` callback. Override it so the
        // axis is wide enough to fit the actual formatted strings (including any
        // appended unit suffix).
        // Note: uPlot passes the already-formatted strings (output of `values`)
        // to `size`, not raw numbers.
        size: (u, vals, axisIdx) => {
          if (!vals || vals.length === 0) return 50;
          const longest = vals.reduce((a, b) => a.length >= b.length ? a : b, "");
          if (!longest) return 50;
          const { ctx, axes } = u;
          ctx.save();
          ctx.font = (axes[axisIdx].font && axes[axisIdx].font[0]) || "12px system-ui";
          const w = Math.ceil(ctx.measureText(longest).width);
          ctx.restore();
          return w + 20; // 10px for tick marks + 10px gap
        }
      }
    ],
    cursor: {
      drag: {
        x: true,
        y: true,
        uni: 50,   // adaptive: zoom only the dominant axis if drag is within 50px of horizontal/vertical
        dist: 10,  // minimum drag distance (px) before zoom activates
        setScale: true
      }
    },
    series: [
      { value: fmtXLegend },
      ...props.chartData.series.map((series) => {
        const w = series.width ?? 2;
        const dotsOnly = w === 0;
        return {
          label: series.name,
          show: !hiddenSeriesLabels.has(series.name),
          stroke: series.color,
          width: dotsOnly ? 0 : w,
          ...((!dotsOnly && series.paths) ? { paths: makePathsBuilder(series.paths) } : {}),
          points: dotsOnly ? { show: true, size: 6, width: 0, fill: series.color } : undefined,
          value: (_u, v) => fmtYLegend(v)
        };
      })
    ],
    hooks: {
      draw: [
        (u) => {
          // Fired synchronously at the very end of uPlot's redraw cycle.
          // If updateChartsData() flagged a restore, replay the cursor now —
          // everything (scale updates, y-range, etc.) has already settled.
          if (cursorRestorePending && lastCursorLeft >= 0) {
            cursorRestorePending = false;
            u.setCursor({ left: lastCursorLeft, top: lastCursorTop });
          }
        }
      ],
      setCursor: [
        (u) => {
          // Track cursor position; uPlot resets it to -10 during setData().
          if (u.cursor.left >= 0) {
            lastCursorLeft = u.cursor.left;
            lastCursorTop  = u.cursor.top;
          }
          // u.select is updated on every mousemove during drag — read it here
          // so the info card stays live without relying on the one-shot setSelect hook.
          const sel = u.select;
          if (isDraggingMain && u.cursor.left >= 0 && dragStartLeft >= 0) {
            // Use actual cursor movement (start → now) for deltaX/deltaY instead of the
            // selection box, because uPlot expands the box to full extent on the constrained
            // axis (e.g. sel.height = full plot height for a horizontal-only drag).
            const xCursor = u.posToVal(u.cursor.left, "x");
            const yCursor = u.posToVal(u.cursor.top,  "y");
            const xStart  = u.posToVal(dragStartLeft,  "x");
            const yStart  = u.posToVal(dragStartTop,   "y");
            selInfo.value = {
              xCursor,
              yCursor,
              deltaX: xCursor - xStart,
              deltaY: yCursor - yStart,
            };
          } else {
            selInfo.value = null;
          }
        }
      ],
      // setSelect fires at mouseUp — clear the card whether or not a zoom follows.
      setSelect: [
        () => { selInfo.value = null; }
      ],
      setScale: [
        (u, key) => {
          if (key === "x") {
            setBrushFromMainScale();
            maybeSwitchToHistoryOnZoom();
            selInfo.value = null;
          }
        }
      ],
      setSeries: [
        (u, i) => {
          // Keep hiddenSeriesLabels in sync whenever the user toggles a series
          // via a legend click, so visibility survives chart rebuilds.
          if (i === 0) { return; }
          const label = u.series[i]?.label;
          if (!label) { return; }
          if (u.series[i].show) {
            hiddenSeriesLabels.delete(label);
          } else {
            hiddenSeriesLabels.add(label);
          }
          // Reset the dead-band controller so it re-initialises from the new
          // visible-only data range on the very next yRangeCallback call,
          // rather than slowly adapting via the EMA from the old range.
          emaYMin        = null;
          emaYMax        = null;
          smoothedTopBuf = BUF_TARGET;
          smoothedBotBuf = BUF_TARGET;
        }
      ]
    }
  };

  const overviewSize = getOverviewPlotSize();
  const overviewOptions = {
    width: overviewSize.width,
    height: overviewSize.height,
    pxAlign: 0,
    legend: { show: false },
    scales: {
      x: { time: props.time },
      y: { auto: true }
    },
    axes: [{ show: false }, { show: false }],
    cursor: {
      x: false,
      y: false,
      drag: {
        x: false,
        y: false,
        setScale: false
      }
    },
    series: [
      {},
      {
        label: `${overviewSeries.name} overview`,
        stroke: overviewSeries.color,
        width: 1
      }
    ]
  };

  mainChart = new uPlot(mainOptions, mainData, mainChartEl.value);
  overviewChart = new uPlot(overviewOptions, overviewData, overviewChartEl.value);

  // Wheel zoom on the main chart — zooms the X axis around the cursor position.
  const wheelOver = mainChart.over;
  const ZOOM_FACTOR = 0.75; // range multiplier per scroll step (< 1 = zoom in)
  const onWheel = (e) => {
    e.preventDefault();
    const { left, top } = mainChart.cursor;
    if (!Number.isFinite(left) || left < 0) return;

    const xScale = mainChart.scales.x;
    const yScale = mainChart.scales.y;
    if (!Number.isFinite(xScale.min) || !Number.isFinite(xScale.max)) return;
    if (!Number.isFinite(yScale.min) || !Number.isFinite(yScale.max)) return;

    const zoomIn   = e.deltaY < 0;
    const mult     = zoomIn ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    // X axis — compute new range.
    const oxRange  = xScale.max - xScale.min;
    const leftPct  = left / wheelOver.clientWidth;
    const xVal     = mainChart.posToVal(left, "x");
    const nxRange  = oxRange * mult;

    // If zooming out and the new X range would exceed the full data extent,
    // bail out on zoom but restore Y to auto-range so both axes reset together.
    if (!zoomIn && overviewXMin != null && overviewXMax != null) {
      if (nxRange >= overviewXMax - overviewXMin) {
        if (autoYMin != null && autoYMax != null) {
          mainChart.setScale("y", { min: autoYMin, max: autoYMax });
        }
        return;
      }
    }

    let nxMin = xVal - leftPct * nxRange;
    let nxMax = nxMin + nxRange;

    // Pan-correct X to stay within data bounds (range is already valid here).
    if (overviewXMin != null && overviewXMax != null) {
      if (nxMin < overviewXMin) {
        nxMin = overviewXMin;
        nxMax = overviewXMin + nxRange;
      } else if (nxMax > overviewXMax) {
        nxMax = overviewXMax;
        nxMin = overviewXMax - nxRange;
      }
    }

    // Y axis — zoom around cursor position (btmPct = fraction from bottom).
    const oyRange  = yScale.max - yScale.min;
    const btmPct   = 1 - top / wheelOver.clientHeight;
    const yVal     = mainChart.posToVal(top, "y");
    const nyRange  = oyRange * mult;
    const nyMin    = yVal - btmPct * nyRange;
    const nyMax    = nyMin + nyRange;

    // Batch both scale updates into a single redraw.
    // Setting X triggers the setScale hook (brush sync + history switch);
    // Y is set with suppressNextZoomSwitchEvents already handled by X.
    mainChart.batch(() => {
      mainChart.setScale("x", { min: nxMin, max: nxMax });
      mainChart.setScale("y", { min: nyMin, max: nyMax });
    });
  };
  wheelOver.addEventListener("wheel", onWheel, { passive: false });
  wheelZoomCleanup = () => wheelOver.removeEventListener("wheel", onWheel);
  chartsBuiltWithColors = props.chartData.series.map(s => s.color);
  chartsBuiltWithStyles   = props.chartData.series.map(s => ({ width: s.width ?? 2, paths: s.paths ?? "linear" }));
  if (rebuildScaleToApply && Number.isFinite(rebuildScaleToApply.min) && Number.isFinite(rebuildScaleToApply.max)) {
    withProgrammaticScaleUpdate(() => {
      mainChart.setScale("x", {
        min: rebuildScaleToApply.min,
        max: rebuildScaleToApply.max
      });
    });
  }
  rebuildScaleToApply = null;
  brushLeftPx.value = 0;
  brushWidthPx.value = overviewSize.width;
  setBrushFromMainScale();
}

function updateChartsData() {
  if (!mainChart || !overviewChart || !props.chartData || props.chartData.series.length === 0) {
    return;
  }

  const previousMin = mainChart.scales.x.min;
  const previousMax = mainChart.scales.x.max;
  const hadZoomWindow =
    Number.isFinite(previousMin) &&
    Number.isFinite(previousMax) &&
    overviewXMin != null &&
    overviewXMax != null &&
    previousMax > previousMin &&
    previousMax - previousMin < overviewXMax - overviewXMin - 1e-9;

  const xData = getXData(props.chartData, props.time);
  const mainValues = props.chartData.series.map((series) => series.values);
  const mainData = [xData, ...mainValues];
  const overviewSeries = props.chartData.series[0];
  const overviewData = [xData, overviewSeries.values];
  overviewXMin = xData[0];
  overviewXMax = xData[xData.length - 1];

  // Flag the restore BEFORE setData() so the draw hook that fires inside
  // setData()'s commit cycle sees it immediately.
  if (lastCursorLeft >= 0) cursorRestorePending = true;

  mainChart.setData(mainData);
  overviewChart.setData(overviewData);

  if (hadZoomWindow) {
    const previousRange = previousMax - previousMin;
    let nextMin = previousMin;
    let nextMax = previousMax;
    if (props.liveMode) {
      // In live mode keep zoom width, follow newest points.
      nextMax = overviewXMax;
      nextMin = nextMax - previousRange;
    }
    const clampedMin = Math.max(overviewXMin, Math.min(overviewXMax, nextMin));
    const clampedMax = Math.max(overviewXMin, Math.min(overviewXMax, nextMax));
    if (clampedMax > clampedMin) {
      withProgrammaticScaleUpdate(() => {
        mainChart.setScale("x", { min: clampedMin, max: clampedMax });
      });
    }
  }
  setBrushFromMainScale();
}

function refreshCharts() {
  if (!props.hasPendingData) {
    return;
  }

  if (!props.chartData || props.chartData.series.length === 0) {
    destroyCharts();
    emit("data-consumed");
    return;
  }

  const expectedMainSeriesLength = 1 + props.chartData.series.length;
  const canIncrementalUpdate =
    mainChart &&
    overviewChart &&
    mainChart.series.length === expectedMainSeriesLength &&
    overviewChart.series.length === 2 &&
    props.chartData.series.every((s, i) =>
      mainChart.series[i + 1]?.label === s.name &&
      chartsBuiltWithColors[i] === s.color &&
      chartsBuiltWithStyles[i]?.width === (s.width ?? 2) &&
      chartsBuiltWithStyles[i]?.paths === (s.paths ?? "linear")
    );

  if (canIncrementalUpdate) {
    updateChartsData();
    emit("data-consumed");
    return;
  }

  if (
    !props.liveMode &&
    mainChart &&
    Number.isFinite(mainChart.scales?.x?.min) &&
    Number.isFinite(mainChart.scales?.x?.max)
  ) {
    // In history mode, any rebuild must preserve current selected range.
    rebuildScaleToApply = {
      min: mainChart.scales.x.min,
      max: mainChart.scales.x.max
    };
  }

  if (
    mainChart &&
    Number.isFinite(mainChart.scales.x.min) &&
    Number.isFinite(mainChart.scales.x.max) &&
    overviewXMin != null &&
    overviewXMax != null
  ) {
    const previousMin = mainChart.scales.x.min;
    const previousMax = mainChart.scales.x.max;
    const previousRange = previousMax - previousMin;
    const fullRange = overviewXMax - overviewXMin;
    const hadZoomWindow = previousRange > 0 && previousRange < fullRange - 1e-9;
    if (hadZoomWindow) {
      if (props.liveMode) {
        // Entering/being in live: same zoom width, aligned to newest samples.
        const nextMax = overviewXMax;
        const nextMin = Math.max(overviewXMin, nextMax - previousRange);
        rebuildScaleToApply = { min: nextMin, max: nextMax };
      } else {
        // History mode: preserve absolute selected range.
        const clampedMin = Math.max(overviewXMin, Math.min(overviewXMax, previousMin));
        const clampedMax = Math.max(overviewXMin, Math.min(overviewXMax, previousMax));
        if (clampedMax > clampedMin) {
          rebuildScaleToApply = { min: clampedMin, max: clampedMax };
        }
      }
    }
  }

  destroyCharts();
  buildCharts();
  emit("data-consumed");
}

function handleResize() {
  if (!mainChart || !overviewChart) {
    return;
  }

  const mainSize = getMainPlotSize();
  const overviewSize = getOverviewPlotSize();
  mainChart.setSize(mainSize);
  overviewChart.setSize(overviewSize);
  setBrushFromMainScale();
}

/**
 * Convert chartData timestamps to uPlot x-values.
 * When time=true, uPlot expects Unix seconds; when false, pass raw values through.
 */
function getXData(chartData, useTime) {
  return useTime
    ? chartData.timestamps.map((ms) => ms / 1000)
    : chartData.timestamps.slice();
}

function alignLiveWindowToRightEdge() {
  if (!mainChart || overviewXMin == null || overviewXMax == null) {
    return;
  }
  const min = mainChart.scales.x.min;
  const max = mainChart.scales.x.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return;
  }
  const fullRange = overviewXMax - overviewXMin;
  const currentRange = max - min;
  if (!Number.isFinite(fullRange) || fullRange <= 0 || currentRange >= fullRange - 1e-9) {
    return;
  }
  const nextMax = overviewXMax;
  const nextMin = Math.max(overviewXMin, nextMax - currentRange);
  withProgrammaticScaleUpdate(() => {
    mainChart.setScale("x", { min: nextMin, max: nextMax });
  });
  setBrushFromMainScale();
}

let onEscapeKeyDown = null;

function cancelMainDrag() {
  if (!isDraggingMain) return;
  // Reset the selection rectangle to zero so uPlot's mouseup handler sees
  // hasSelect = false and skips applying the zoom.
  if (mainChart) {
    mainChart.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  }
  // Dispatch a synthetic mouseup on document to end uPlot's internal drag state.
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  isDraggingMain = false;
  dragStartLeft  = -1;
  dragStartTop   = -1;
  selInfo.value  = null;
}

onMounted(() => {
  refreshCharts();
  unsubscribeGlobalRender = subscribeGlobalRender(() => {
    if (props.liveMode) {
      refreshCharts();
    }
  });
  resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  const onMainChartPointerUp = () => {
    isDraggingMain = false;
    dragStartLeft  = -1;
    dragStartTop   = -1;
  };

  onMainChartPointerDown = (e) => {
    maybeSwitchToHistoryOnMainPointerDown();
    // Record drag start in the same coordinate space as u.cursor.left/top (plot-local CSS px).
    if (mainChart?.over) {
      const r = mainChart.over.getBoundingClientRect();
      dragStartLeft  = e.clientX - r.left;
      dragStartTop   = e.clientY - r.top;
      isDraggingMain = true;
      window.addEventListener("pointerup", onMainChartPointerUp, { once: true });
    }
  };

  onEscapeKeyDown = (e) => {
    if (e.key === "Escape") {
      cancelMainDrag();
    }
  };

  if (mainChartEl.value) {
    resizeObserver.observe(mainChartEl.value);
    mainChartEl.value.addEventListener("pointerdown", onMainChartPointerDown);
  }
  if (overviewChartEl.value) {
    resizeObserver.observe(overviewChartEl.value);
  }
  document.addEventListener("keydown", onEscapeKeyDown);
});

watch(
  () => props.hasPendingData,
  (nextPending) => {
    if (nextPending && !props.liveMode) {
      refreshCharts();
    }
  }
);

watch(
  () => props.cellHeightPx,
  () => {
    handleResize();
  }
);

watch(
  () => props.time,
  () => {
    // uPlot doesn't support mutating scales.x.time after creation; rebuild.
    destroyCharts();
    buildCharts();
  }
);

watch(
  [() => props.valueFormat, () => props.valueDecimals,
   () => props.xAxisLabel, () => props.xAxisUnit,
   () => props.yAxisLabel, () => props.yAxisUnit,
   () => props.showLegend, () => props.theme],
  () => {
    if (mainChart) {
      destroyCharts();
      buildCharts();
    }
  }
);

watch(
  () => props.liveMode,
  (nextLiveMode) => {
    let preservedScale = null;
    if (
      !nextLiveMode &&
      mainChart &&
      Number.isFinite(mainChart.scales?.x?.min) &&
      Number.isFinite(mainChart.scales?.x?.max)
    ) {
      preservedScale = {
        min: mainChart.scales.x.min,
        max: mainChart.scales.x.max
      };
    }

    refreshCharts();

    if (
      !nextLiveMode &&
      preservedScale &&
      mainChart &&
      Number.isFinite(preservedScale.min) &&
      Number.isFinite(preservedScale.max)
    ) {
      withProgrammaticScaleUpdate(() => {
        mainChart.setScale("x", preservedScale);
      });
    }

    if (nextLiveMode) {
      zoomSwitchSent = false;
      alignLiveWindowToRightEdge();
    } else {
      // Ensure minimap brush reflects the current main chart zoom
      // even when no fresh data arrived (pending-data flag is false).
      setBrushFromMainScale();
    }
  }
);

onBeforeUnmount(() => {
  if (unsubscribeGlobalRender) {
    unsubscribeGlobalRender();
    unsubscribeGlobalRender = null;
  }
  if (mainChartEl.value && onMainChartPointerDown) {
    mainChartEl.value.removeEventListener("pointerdown", onMainChartPointerDown);
  }
  onMainChartPointerDown = null;
  if (onEscapeKeyDown) {
    document.removeEventListener("keydown", onEscapeKeyDown);
    onEscapeKeyDown = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  destroyCharts();
});
</script>

<template>
  <div class="chart-wrapper">
    <div ref="mainChartEl" class="chart-main-target"></div>
    <div class="chart-overview-wrapper" :style="{ height: `${Math.round(cellHeightPx / 2)}px` }">
      <div ref="overviewChartEl" class="chart-overview-target"></div>
      <div class="chart-overview-interaction" @pointerdown="onOverviewPointerDown">
        <div class="chart-brush" :style="{ left: `${brushLeftPx}px`, width: `${brushWidthPx}px` }">
          <div class="chart-brush-grip chart-brush-grip-left"></div>
          <div class="chart-brush-grip chart-brush-grip-right"></div>
        </div>
      </div>
    </div>

    <Transition name="cdi-fade">
      <div v-if="selDisplay" class="chart-drag-info">
        <div class="cdi-row">
          <span class="cdi-label">X</span>
          <span class="cdi-val">{{ selDisplay.x }}</span>
        </div>
        <div class="cdi-row">
          <span class="cdi-label">Y</span>
          <span class="cdi-val">{{ selDisplay.y }}</span>
        </div>
        <div class="cdi-divider"></div>
        <div class="cdi-row">
          <span class="cdi-label">ΔX</span>
          <span class="cdi-val">{{ selDisplay.deltaX }}</span>
        </div>
        <div v-if="selDisplay.freq" class="cdi-row">
          <span class="cdi-label">1/|ΔX|</span>
          <span class="cdi-val">{{ selDisplay.freq }}</span>
        </div>
        <div class="cdi-row">
          <span class="cdi-label">ΔY</span>
          <span class="cdi-val">{{ selDisplay.deltaY }}</span>
        </div>
        <div class="cdi-row">
          <span class="cdi-label">{{ selDisplay.slopeUnit ? `ΔY/ΔX (${selDisplay.slopeUnit})` : 'ΔY/ΔX' }}</span>
          <span class="cdi-val">{{ selDisplay.slope }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>
