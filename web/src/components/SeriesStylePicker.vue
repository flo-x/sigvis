<script setup>
import { computed, reactive, watch } from "vue";

const props = defineProps({
  modelValue: { type: Object, default: () => ({ width: 2, paths: "linear" }) }
});
const emit = defineEmits(["update:modelValue"]);

const draft = reactive({ width: 2, paths: "linear" });

watch(
  () => props.modelValue,
  (v) => {
    draft.width = v?.width ?? 2;
    draft.paths = v?.paths ?? "linear";
  },
  { immediate: true, deep: true }
);

// Static SVG path strings for the style preview.
// Five data points at x=[4,44,84,124,156], y alternating [14,4,12,4,14].
const PREVIEW_PTS = [[4,14],[44,4],[84,12],[124,4],[156,14]];

const PREVIEW_PATH = {
  linear:           "M 4,14 L 44,4 L 84,12 L 124,4 L 156,14",
  "stepped-before": "M 4,14 H 44 V 4 H 84 V 12 H 124 V 4 H 156",
  "stepped-after":  "M 4,14 V 4 H 44 V 12 H 84 V 4 H 124 V 14 H 156",
  "stepped-middle": "M 4,14 H 24 V 4 H 64 V 12 H 104 V 4 H 140 V 14 H 156",
  spline: "M 4,14 C 24,14 24,4 44,4 C 64,4 64,12 84,12 C 104,12 104,4 124,4 C 140,4 140,14 156,14"
};

const widthLabel = computed(() => draft.width === 0 ? "dots only" : `${draft.width}px`);
const previewPath = computed(() => PREVIEW_PATH[draft.paths] ?? PREVIEW_PATH.linear);

function commit() {
  emit("update:modelValue", { width: draft.width, paths: draft.paths });
}
</script>

<template>
  <div class="sp" @click.stop>
    <div class="sp-section">
      <div class="sp-label">Line width — {{ widthLabel }}</div>
      <input
        type="range"
        class="sp-slider"
        min="0"
        max="3"
        step="1"
        v-model.number="draft.width"
        @input="commit"
      />
      <div class="sp-slider-ticks">
        <span>dots</span><span>1px</span><span>2px</span><span>3px</span>
      </div>
    </div>

    <div class="sp-section">
      <div class="sp-label">Line style</div>
      <select class="sp-select" v-model="draft.paths" @change="commit" :disabled="draft.width === 0">
        <option value="linear">Linear</option>
        <option value="stepped-before">Step (before point)</option>
        <option value="stepped-after">Step (after point)</option>
        <option value="stepped-middle">Step (at midpoint)</option>
        <option value="spline">Spline (smooth)</option>
      </select>
    </div>

    <div class="sp-section">
      <div class="sp-label">Preview</div>
      <svg class="sp-preview" viewBox="0 0 160 18" width="160" height="18">
        <!-- dots-only mode: circles at each data point, no connecting line -->
        <template v-if="draft.width === 0">
          <circle
            v-for="([cx, cy], i) in PREVIEW_PTS"
            :key="i"
            :cx="cx" :cy="cy" r="2.5"
            fill="#4E79A7"
          />
        </template>
        <!-- normal line mode -->
        <path
          v-else
          :d="previewPath"
          fill="none"
          stroke="#4E79A7"
          :stroke-width="draft.width"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  </div>
</template>
