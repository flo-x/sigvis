<script setup>
const SCREEN_TABS = [
  { id: "settings",        label: "Settings" },
  { id: "server-settings", label: "Server Settings" },
  { id: "generators",      label: "Generators & Processors" },
  { id: "data-series",     label: "Data Series" },
  { id: "about",           label: "About" }
];

defineProps({
  currentView: { type: String, required: true }
});

const emit = defineEmits(["navigate"]);
</script>

<template>
  <nav class="screen-nav">
    <button
      class="screen-back-btn"
      type="button"
      @click="emit('navigate', 'dashboard')"
    >
      ← Dashboards
    </button>

    <button
      v-for="tab in SCREEN_TABS"
      :key="tab.id"
      class="screen-nav-tab"
      :class="{ active: currentView === tab.id }"
      type="button"
      @click="emit('navigate', tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>
