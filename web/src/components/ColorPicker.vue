<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "#3b82f6" }
});
const emit = defineEmits(["update:modelValue"]);

// ── Color math ───────────────────────────────────────────────────────────────

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]
    .map(x => Math.round(clamp(x, 0, 1) * 255));
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex) {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, max === 0 ? 0 : d / max, max];
}

// Parse any supported color string → { hex: "#rrggbb", alpha: 0-1 }
function parseColor(str) {
  if (!str) return { hex: "#000000", alpha: 1 };
  const rgba = str.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    return {
      hex: rgbToHex(+rgba[1], +rgba[2], +rgba[3]),
      alpha: rgba[4] !== undefined ? clamp(+rgba[4], 0, 1) : 1
    };
  }
  return { hex: /^#[0-9a-f]{6}$/i.test(str) ? str : "#000000", alpha: 1 };
}

// Emit either plain hex (alpha = 1) or rgba() string
function buildColor(hex, a) {
  if (a >= 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}

// ── Swatch grid ───────────────────────────────────────────────────────────────

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// 12 hues × 5 lightness levels (HSL), saturation 70%, lightness 80% → 20%
const SWATCH_HUES   = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const SWATCH_LIGHTS = Array.from({ length: 5 }, (_, i) => 0.80 - i * (0.80 - 0.20) / 4);
const SWATCHES = SWATCH_LIGHTS.flatMap(l =>
  SWATCH_HUES.map(h => rgbToHex(...hslToRgb(h, 0.70, l)))
);

// ── Internal state ────────────────────────────────────────────────────────────

const hue      = ref(0);
const sat      = ref(1);
const val      = ref(1);
const alpha    = ref(1);   // 0–1
const hexDraft = ref("");
const activeTab = ref("palette"); // "palette" | "swatches" | "picker"

// Tableau 10 — same set used as the default series palette in seriesColor.js
const TABLEAU10 = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
  "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"
];

function hexToHsl(hex) {
  let [r, g, b] = hexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

function shiftL(hex, delta) {
  const [h, s, l] = hexToHsl(hex);
  return rgbToHex(...hslToRgb(h, s, clamp(l + delta, 0, 1)));
}

// 3 rows: lighter (+18%), normal, darker (−22%)
const TABLEAU10_ROWS = [
  TABLEAU10.map(c => shiftL(c, +0.18)),
  [...TABLEAU10],
  TABLEAU10.map(c => shiftL(c, -0.22))
];

function applyParsed({ hex, alpha: a }) {
  const [h, s, v] = rgbToHsv(...hexToRgb(hex));
  hue.value = h;
  sat.value = s;
  val.value = v;
  alpha.value = a;
  hexDraft.value = hex;
}

watch(() => props.modelValue, v => applyParsed(parseColor(v)), { immediate: true });

const currentHex = computed(() => rgbToHex(...hsvToRgb(hue.value, sat.value, val.value)));
const hueColor   = computed(() => `hsl(${hue.value}, 100%, 50%)`);

// Gradient for the alpha slider track: transparent → current opaque color
const alphaTrackStyle = computed(() => {
  const [r, g, b] = hsvToRgb(hue.value, sat.value, val.value);
  return {
    background: `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b})),
                 repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 0 0 / 8px 8px`
  };
});

function commit() {
  emit("update:modelValue", buildColor(currentHex.value, alpha.value));
}

function pickSwatch(hex) {
  const [h, s, v] = rgbToHsv(...hexToRgb(hex));
  hue.value = h; sat.value = s; val.value = v;
  hexDraft.value = hex;
  emit("update:modelValue", buildColor(hex, alpha.value));
}

// ── SV square ────────────────────────────────────────────────────────────────

const svEl = ref(null);

function readSv(e) {
  const r = svEl.value.getBoundingClientRect();
  return [clamp((e.clientX - r.left) / r.width, 0, 1),
          clamp(1 - (e.clientY - r.top)  / r.height, 0, 1)];
}

function onSvDown(e) {
  svEl.value.setPointerCapture(e.pointerId);
  [sat.value, val.value] = readSv(e);
  commit();
}

function onSvMove(e) {
  if (!(e.buttons & 1)) return;
  [sat.value, val.value] = readSv(e);
  commit();
}

// ── Hue slider ───────────────────────────────────────────────────────────────

const hueEl = ref(null);

function readHue(e) {
  const r = hueEl.value.getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
}

function onHueDown(e) {
  hueEl.value.setPointerCapture(e.pointerId);
  hue.value = readHue(e);
  commit();
}

function onHueMove(e) {
  if (!(e.buttons & 1)) return;
  hue.value = readHue(e);
  commit();
}

// ── Alpha slider ──────────────────────────────────────────────────────────────

const alphaEl = ref(null);

function readAlpha(e) {
  const r = alphaEl.value.getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1);
}

function onAlphaDown(e) {
  alphaEl.value.setPointerCapture(e.pointerId);
  alpha.value = readAlpha(e);
  commit();
}

function onAlphaMove(e) {
  if (!(e.buttons & 1)) return;
  alpha.value = readAlpha(e);
  commit();
}

// ── Hex input ────────────────────────────────────────────────────────────────

function onHexChange(e) {
  const v = e.target.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    const [h, s, vv] = rgbToHsv(...hexToRgb(v));
    hue.value = h; sat.value = s; val.value = vv;
    hexDraft.value = v;
    emit("update:modelValue", buildColor(v, alpha.value));
  } else {
    hexDraft.value = currentHex.value;
  }
}
</script>

<template>
  <div class="cp" @click.stop>
    <!-- Tab bar -->
    <div class="cp-tabs">
      <button
        type="button"
        class="cp-tab"
        :class="{ 'cp-tab--active': activeTab === 'palette' }"
        @click.stop="activeTab = 'palette'"
      >Palette</button>
      <button
        type="button"
        class="cp-tab"
        :class="{ 'cp-tab--active': activeTab === 'swatches' }"
        @click.stop="activeTab = 'swatches'"
      >Swatches</button>
      <button
        type="button"
        class="cp-tab"
        :class="{ 'cp-tab--active': activeTab === 'picker' }"
        @click.stop="activeTab = 'picker'"
      >Picker</button>
    </div>

    <!-- Tab: Tableau 10 palette (3 rows: lighter / normal / darker) -->
    <div v-if="activeTab === 'palette'" class="cp-tab-body">
      <div class="cp-tableau">
        <template v-for="(row, ri) in TABLEAU10_ROWS" :key="ri">
          <button
            v-for="(color, ci) in row"
            :key="`${ri}-${ci}`"
            type="button"
            class="cp-swatch"
            :class="{ 'cp-swatch--active': currentHex.toLowerCase() === color.toLowerCase() }"
            :style="{ background: color }"
            :title="color"
            @click.stop="pickSwatch(color)"
          />
        </template>
      </div>
    </div>

    <!-- Tab: Swatches -->
    <div v-else-if="activeTab === 'swatches'" class="cp-tab-body">
      <div class="cp-swatches">
        <button
          v-for="color in SWATCHES"
          :key="color"
          type="button"
          class="cp-swatch"
          :class="{ 'cp-swatch--active': currentHex === color }"
          :style="{ background: color }"
          :title="color"
          @click.stop="pickSwatch(color)"
        />
      </div>
    </div>

    <!-- Tab: HSV picker -->
    <div v-else class="cp-tab-body">
      <!-- Saturation / Value square -->
      <div
        ref="svEl"
        class="cp-sv"
        :style="{ '--cp-hue': hueColor }"
        @pointerdown="onSvDown"
        @pointermove="onSvMove"
      >
        <div
          class="cp-sv-cursor"
          :style="{ left: sat * 100 + '%', top: (1 - val) * 100 + '%' }"
        />
      </div>

      <!-- Hue slider -->
      <div
        ref="hueEl"
        class="cp-hue"
        @pointerdown="onHueDown"
        @pointermove="onHueMove"
      >
        <div
          class="cp-hue-thumb"
          :style="{ left: hue / 360 * 100 + '%', background: hueColor }"
        />
      </div>
    </div>

    <!-- Alpha slider — always visible -->
    <div class="cp-alpha-row">
      <span class="cp-alpha-label">A</span>
      <div
        ref="alphaEl"
        class="cp-alpha"
        :style="alphaTrackStyle"
        @pointerdown="onAlphaDown"
        @pointermove="onAlphaMove"
      >
        <div
          class="cp-alpha-thumb"
          :style="{ left: alpha * 100 + '%' }"
        />
      </div>
      <span class="cp-alpha-pct">{{ Math.round(alpha * 100) }}%</span>
    </div>

    <!-- Hex + preview — always visible -->
    <div class="cp-hex-row">
      <span class="cp-hex-preview">
        <span class="cp-hex-preview-color" :style="{ background: buildColor(currentHex, alpha) }" />
      </span>
      <input
        class="cp-hex-input"
        type="text"
        :value="hexDraft"
        maxlength="7"
        spellcheck="false"
        autocomplete="off"
        placeholder="#rrggbb"
        @input="hexDraft = $event.target.value"
        @change="onHexChange"
      />
    </div>
  </div>
</template>
