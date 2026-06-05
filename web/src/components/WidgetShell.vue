<script setup>
import { computed, ref } from "vue";
import { widgetRegistry } from "../widgets/widgetRegistry";

const props = defineProps({
  widget: {
    type: Object,
    required: true
  },
  isEditMode: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(["remove", "update-config"]);

const registryEntry = computed(() => widgetRegistry[props.widget.type]);
const title = computed(() => {
  const saved = props.widget.config?.title?.trim();
  if (saved) return saved;
  const firstId = props.widget.config?.seriesIds?.[0];
  if (firstId) return firstId.replace(":", " / ");
  return registryEntry.value?.title || "Widget";
});
const canConfigure = computed(() => registryEntry.value?.capabilities?.configure === true);
const canToggleLive = computed(() => registryEntry.value?.capabilities?.toggleLive === true);
const isLiveMode = computed(() => props.widget.config?.liveMode !== false);
const openConfigSignal = ref(0);

function onConfigureClick() {
  openConfigSignal.value += 1;
}

function onToggleLiveMode() {
  emit("update-config", props.widget.id, { liveMode: !isLiveMode.value });
}
</script>

<template>
  <div class="widget-shell">
    <div class="widget-header">
      <div class="widget-title">{{ title }}</div>
      <div class="widget-header-actions">
        <button
          v-if="canToggleLive"
          type="button"
          :class="{ primary: isLiveMode }"
          @click="onToggleLiveMode"
        >
          Live
        </button>
        <button v-if="isEditMode && canConfigure" type="button" @click="onConfigureClick">Configure</button>
        <button v-if="isEditMode" class="danger" type="button" @click="emit('remove', widget.id)">Remove</button>
      </div>
    </div>
    <div class="widget-body">
      <component
        :is="registryEntry?.component"
        :widget="widget"
        :open-config-signal="openConfigSignal"
        @update-config="emit('update-config', widget.id, $event)"
      />
    </div>
  </div>
</template>
