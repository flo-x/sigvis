<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  open:              { type: Boolean, default: false },
  title:             { type: String,  default: "" },
  closeOnBackdrop:   { type: Boolean, default: true }
});

const emit = defineEmits(["update:open"]);

function close() {
  emit("update:open", false);
}

watch(() => props.open, (val) => {
  if (val) {
    document.body.style.overflow = "hidden";
  } else {
    // Restore scroll only when no other panel is still open.
    const stillOpen = document.querySelectorAll(".config-panel.open").length;
    if (stillOpen === 0) {
      document.body.style.overflow = "";
    }
  }
}, { immediate: true });

// ── Resizable width (mirrors DataSeriesWidget config panel) ───────────────────
const PANEL_WIDTH_KEY = "sigvis-slideover-width";
const PANEL_MIN_W     = 320;
const PANEL_MAX_W     = 900;

const panelWidth = ref(
  Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Number(localStorage.getItem(PANEL_WIDTH_KEY)) || Math.round(window.innerWidth * 2 / 3)))
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
  if (!_resizeStart || !(event.buttons & 1)) {
    return;
  }
  const delta = _resizeStart.x - event.clientX;
  panelWidth.value = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, _resizeStart.w + delta));
}

function onResizeUp() {
  _resizeStart = null;
  localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth.value));
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="config-panel-backdrop" @click.self="closeOnBackdrop && close()" />

    <div class="config-panel" :class="{ open }" :style="panelStyle">
      <div
        ref="resizeHandleEl"
        class="config-panel-resize"
        @pointerdown="onResizeDown"
        @pointermove="onResizeMove"
        @pointerup="onResizeUp"
        @pointercancel="onResizeUp"
      />
      <div class="config-panel-header">
        <h3>{{ title }}</h3>
        <button type="button" class="config-panel-close" @click="close">✕</button>
      </div>
      <div class="config-panel-body">
        <slot />
      </div>
    </div>
  </Teleport>
</template>
