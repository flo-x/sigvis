<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false
  },
  items: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(["close", "open-dashboard"]);
</script>

<template>
  <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
    <div class="dialog">
      <h3>Open Dashboard</h3>
      <div v-if="items.length === 0" class="dialog-empty">No saved dashboards found.</div>
      <ul v-else class="dialog-list">
        <li v-for="item in items" :key="item.name">
          <button @click="emit('open-dashboard', item.name)">
            <span>{{ item.name }}</span>
            <small>{{ item.savedAt || "Unknown save date" }}</small>
          </button>
        </li>
      </ul>
      <div class="dialog-actions">
        <button @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
