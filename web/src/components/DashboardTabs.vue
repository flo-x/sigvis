<script setup>
import { nextTick, ref } from "vue";

defineProps({
  dashboards: {
    type: Array,
    required: true
  },
  activeDashboardId: {
    type: String,
    required: true
  },
  isEditMode: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(["select", "create", "delete", "rename", "reorder"]);

// --- Rename ---
const editingTabId = ref(null);
const editingTabName = ref("");
let editInputEl = null;

async function startEditing(dashboard) {
  editingTabId.value = dashboard.id;
  editingTabName.value = dashboard.name || "";
  await nextTick();
  editInputEl?.select();
}

function commitRename() {
  if (!editingTabId.value) return;
  const name = editingTabName.value.trim();
  if (name) {
    emit("rename", editingTabId.value, name);
  }
  editingTabId.value = null;
}

function cancelRename() {
  editingTabId.value = null;
}

function onEditKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    commitRename();
  } else if (event.key === "Escape") {
    cancelRename();
  }
}

// --- Drag-and-drop reorder ---
const dragOverId = ref(null);
let draggingId = null;

function onDragStart(event, dashboard) {
  draggingId = dashboard.id;
  event.dataTransfer.effectAllowed = "move";
  // Slight delay so the ghost image renders before we style the element
  setTimeout(() => { event.target.classList.add("tab-dragging"); }, 0);
}

function onDragEnd(event) {
  event.target.classList.remove("tab-dragging");
  draggingId = null;
  dragOverId.value = null;
}

function onDragOver(event, dashboard) {
  if (!draggingId || draggingId === dashboard.id) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  dragOverId.value = dashboard.id;
}

function onDragLeave() {
  dragOverId.value = null;
}

function onDrop(event, dashboard) {
  event.preventDefault();
  if (!draggingId || draggingId === dashboard.id) return;
  emit("reorder", draggingId, dashboard.id);
  dragOverId.value = null;
}
</script>

<template>
  <div class="dashboard-tabs">
    <template v-for="dashboard in dashboards" :key="dashboard.id">
      <div
        class="tab"
        :class="{
          active: dashboard.id === activeDashboardId,
          'tab-drag-over': dragOverId === dashboard.id
        }"
        :draggable="isEditMode && editingTabId !== dashboard.id"
        @click="emit('select', dashboard.id)"
        @dblclick.prevent="isEditMode && startEditing(dashboard)"
        @dragstart="isEditMode && onDragStart($event, dashboard)"
        @dragend="onDragEnd"
        @dragover="isEditMode && onDragOver($event, dashboard)"
        @dragleave="onDragLeave"
        @drop="isEditMode && onDrop($event, dashboard)"
      >
        <input
          v-if="editingTabId === dashboard.id"
          :ref="el => { editInputEl = el }"
          class="tab-rename-input"
          v-model="editingTabName"
          @keydown="onEditKeydown"
          @blur="commitRename"
          @click.stop
        />
        <template v-else>
          <span>{{ dashboard.name || "Untitled Dashboard" }}</span>
          <span v-if="dashboard.isDirty" class="dirty-dot">*</span>
          <span v-if="isEditMode" class="delete-tab" @click.stop="emit('delete', dashboard.id)">x</span>
        </template>
      </div>
    </template>
  </div>
</template>
