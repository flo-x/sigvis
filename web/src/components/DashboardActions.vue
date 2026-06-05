<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";

defineProps({
  isEditMode: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits([
  "create-dashboard",
  "save",
  "save-as",
  "open",
  "open-settings",
  "add-widget",
  "toggle-edit-mode"
]);

const showFileMenu = ref(false);

function toggleFileMenu() {
  showFileMenu.value = !showFileMenu.value;
}

function closeFileMenu() {
  showFileMenu.value = false;
}

function onDocClick(e) {
  const menu = document.querySelector(".file-menu");
  if (menu && !menu.contains(e.target)) {
    closeFileMenu();
  }
}

onMounted(() => document.addEventListener("click", onDocClick, true));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick, true));
</script>

<template>
  <div class="dashboard-actions">
    <div v-if="isEditMode" class="file-menu">
      <button @click.stop="toggleFileMenu">Dashboard ▾</button>
      <div v-show="showFileMenu" class="file-menu__panel">
        <button @click="emit('create-dashboard'); closeFileMenu()">New</button>
        <button @click="emit('open'); closeFileMenu()">Open...</button>
        <button @click="emit('save'); closeFileMenu()">Save</button>
        <button @click="emit('save-as'); closeFileMenu()">Save As...</button>
      </div>
    </div>
    <button @click="emit('open-settings')">Settings</button>
    <button v-if="isEditMode" class="primary" @click="emit('add-widget')">+ Data Series Widget</button>
    <button
      class="mode-toggle"
      :class="{ active: isEditMode }"
      @click="emit('toggle-edit-mode')"
    >Edit</button>
  </div>
</template>
