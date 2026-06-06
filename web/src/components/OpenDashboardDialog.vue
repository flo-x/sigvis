<script setup>
import { ref } from "vue";

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

const emit = defineEmits(["close", "open-dashboard", "delete-dashboard"]);

const confirmName = ref(null);

function formatSavedAt(iso) {
  if (!iso) return "Unknown date";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

function askDelete(name) {
  confirmName.value = name;
}

function confirmDelete() {
  emit("delete-dashboard", confirmName.value);
  confirmName.value = null;
}

function cancelDelete() {
  confirmName.value = null;
}
</script>

<template>
  <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
    <div class="dialog open-dialog">
      <h3>Open Dashboard</h3>
      <div v-if="items.length === 0" class="dialog-empty">No saved dashboards found.</div>
      <ul v-else class="open-dialog-list">
        <li v-for="item in items" :key="item.name" class="open-dialog-row">
          <button class="open-dialog-open-btn" @click="emit('open-dashboard', item.name)">
            <span class="open-dialog-name">{{ item.name }}</span>
            <span class="open-dialog-date">{{ formatSavedAt(item.savedAt) }}</span>
          </button>
          <button
            class="open-dialog-delete-btn"
            title="Delete saved dashboard"
            @click.stop="askDelete(item.name)"
          >✕</button>
        </li>
      </ul>
      <div class="dialog-actions">
        <button @click="emit('close')">Close</button>
      </div>
    </div>
  </div>

  <!-- Confirmation dialog -->
  <div v-if="confirmName" class="dialog-backdrop confirm-backdrop" @click.self="cancelDelete">
    <div class="dialog confirm-dialog">
      <h3>Delete Dashboard</h3>
      <p>Delete <strong>{{ confirmName }}</strong>? This cannot be undone.</p>
      <div class="dialog-actions">
        <button class="danger" @click="confirmDelete">Delete</button>
        <button @click="cancelDelete">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.open-dialog {
  width: min(480px, 92vw);
}

.open-dialog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 50vh;
  overflow-y: auto;
}

.open-dialog-row {
  display: flex;
  align-items: stretch;
  gap: 0.3rem;
}

.open-dialog-open-btn {
  flex: 1;
  text-align: left;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.45rem 0.75rem;
  min-width: 0;
}

.open-dialog-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.open-dialog-date {
  font-size: 0.78rem;
  color: var(--c-text-3);
  white-space: nowrap;
  flex-shrink: 0;
}

.open-dialog-delete-btn {
  flex-shrink: 0;
  border: 1px solid transparent;
  background: transparent;
  color: var(--c-text-4);
  font-size: 0.8rem;
  padding: 0 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  line-height: 1;
}

.open-dialog-delete-btn:hover {
  color: var(--c-danger);
  background: var(--c-danger-bg);
  border-color: var(--c-danger-border);
}

.confirm-backdrop {
  z-index: 650;
}

.confirm-dialog {
  width: min(360px, 92vw);
}

.confirm-dialog p {
  margin: 0.25rem 0 0.75rem;
  font-size: 0.9rem;
  color: var(--c-text-2);
}
</style>
