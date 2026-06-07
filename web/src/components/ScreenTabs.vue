<script setup>
const SCREEN_TABS = [
  { id: "server-settings", label: "Server Settings" },
  { id: "generators",      label: "Generators & Processors" }
];

defineProps({
  currentView: { type: String, required: true }
});

const emit = defineEmits(["navigate"]);
</script>

<template>
  <nav class="dashboard-tabs screen-tabs">
    <!-- Back button — styled as a pill button, not a tab -->
    <button
      class="screen-back-btn"
      type="button"
      @click="emit('navigate', 'dashboard')"
    >
      ← Dashboards
    </button>

    <!-- Screen tabs -->
    <button
      v-for="tab in SCREEN_TABS"
      :key="tab.id"
      class="tab"
      :class="{ active: currentView === tab.id }"
      type="button"
      @click="emit('navigate', tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>
