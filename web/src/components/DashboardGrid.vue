<script setup>
import { GridStack } from "gridstack";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WidgetShell from "./WidgetShell.vue";

const props = defineProps({
  widgets: {
    type: Array,
    required: true
  },
  isEditMode: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(["remove-widget", "update-widget-config", "update-widget-layout"]);

const gridRef = ref(null);
let grid = null;
let ignoreGridEvents = false;
function onRemoveWidget(widgetId) {
  emit("remove-widget", widgetId);
}

function applyGridAttributes(element, widget) {
  element.setAttribute("gs-id", widget.id);
  element.setAttribute("gs-x", String(widget.layout.x ?? 0));
  element.setAttribute("gs-y", String(widget.layout.y ?? 0));
  element.setAttribute("gs-w", String(widget.layout.w ?? 4));
  element.setAttribute("gs-h", String(widget.layout.h ?? 3));
}

function syncGrid() {
  if (!grid || !gridRef.value) {
    return;
  }

  ignoreGridEvents = true;
  grid.batchUpdate(true);
  const ids = new Set(props.widgets.map((widget) => widget.id));

  // Remove stale elements that no longer exist in state.
  Array.from(gridRef.value.querySelectorAll(".grid-stack-item")).forEach((element) => {
    const id = element.getAttribute("gs-id");
    if (id && !ids.has(id)) {
      grid.removeWidget(element);
    }
  });

  // Vue can remove DOM nodes before GridStack sees them; clean stale engine nodes by id.
  const staleEngineNodes = (grid?.engine?.nodes || []).filter((node) => {
    if (node?.id == null) {
      return false;
    }
    return !ids.has(String(node.id));
  });
  staleEngineNodes.forEach((node) => {
    const el = node.el;
    const isConnected = Boolean(el && el.isConnected);
    if (isConnected && el) {
      grid.removeWidget(el);
    } else {
      grid.engine.removeNode(node, false, true);
    }
  });

  // Add and update active widgets.
  props.widgets.forEach((widget) => {
    const selector = `.grid-stack-item[gs-id="${widget.id}"]`;
    const element = gridRef.value.querySelector(selector);
    if (!element) {
      return;
    }

    applyGridAttributes(element, widget);
    if (!element.gridstackNode) {
      grid.makeWidget(element);
    } else {
      grid.update(element, {
        x: widget.layout.x,
        y: widget.layout.y,
        w: widget.layout.w,
        h: widget.layout.h
      });
    }
  });
  grid.batchUpdate(false);
  ignoreGridEvents = false;
}

onMounted(async () => {
  grid = GridStack.init(
    {
      column: 12,
      cellHeight: 72,
      margin: 1,
      float: true,
      disableOneColumnMode: true,
      handle: ".widget-header"
    },
    gridRef.value
  );

  grid.on("change", (_event, items) => {
    if (ignoreGridEvents) {
      return;
    }
    items.forEach((item) => {
      if (item.id == null) {
        return;
      }
      emit("update-widget-layout", String(item.id), {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h
      });
    });
  });

  grid.setStatic(!props.isEditMode);

  await nextTick();
  syncGrid();
});

watch(
  () => props.isEditMode,
  (val) => {
    if (grid) grid.setStatic(!val);
  }
);

watch(
  // Only re-sync the grid when widget IDs or layout positions change.
  // Config-only changes (e.g. series selection) do not affect the GridStack DOM.
  () => props.widgets.map((w) => `${w.id}:${w.layout.x},${w.layout.y},${w.layout.w},${w.layout.h}`).join("|"),
  async () => {
    await nextTick();
    syncGrid();
  }
);

onBeforeUnmount(() => {
  if (grid) {
    grid.destroy(false);
    grid = null;
  }
});
</script>

<template>
  <div class="dashboard-grid-wrapper">
    <div ref="gridRef" class="grid-stack">
      <div
        v-for="widget in widgets"
        :key="widget.id"
        class="grid-stack-item"
        :gs-id="widget.id"
        :gs-x="widget.layout.x"
        :gs-y="widget.layout.y"
        :gs-w="widget.layout.w"
        :gs-h="widget.layout.h"
      >
        <div class="grid-stack-item-content">
          <WidgetShell
            :widget="widget"
            :is-edit-mode="isEditMode"
            @remove="onRemoveWidget"
            @update-config="(widgetId, payload) => emit('update-widget-config', widgetId, payload)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
