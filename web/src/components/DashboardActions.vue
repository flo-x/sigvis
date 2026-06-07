<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import pkg from "../../../package.json";

defineProps({
  isEditMode: {
    type: Boolean,
    default: true
  },
  showEditButton: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits([
  "open-settings",
  "toggle-edit-mode",
  "open-server-settings",
  "open-generators",
  "open-data-series",
  "show-dashboards"
]);

// --- Burger menu ---
const showBurger = ref(false);
const showAbout  = ref(false);

function toggleBurger() {
  showBurger.value = !showBurger.value;
}

function closeBurger() {
  showBurger.value = false;
}

function openServerSettings() {
  closeBurger();
  emit("open-server-settings");
}

function openGenerators() {
  closeBurger();
  emit("open-generators");
}

function openDataSeries() {
  closeBurger();
  emit("open-data-series");
}

function showDashboards() {
  closeBurger();
  emit("show-dashboards");
}

function openSettings() {
  closeBurger();
  emit("open-settings");
}

function openAbout() {
  closeBurger();
  showAbout.value = true;
}

function onDocClick(e) {
  const menu = document.querySelector(".burger-menu");
  if (menu && !menu.contains(e.target)) {
    closeBurger();
  }
}

onMounted(()        => document.addEventListener("click", onDocClick, true));
onBeforeUnmount(()  => document.removeEventListener("click", onDocClick, true));
</script>

<template>
  <div class="dashboard-actions">
    <button
      v-if="showEditButton"
      class="mode-toggle"
      :class="{ active: isEditMode }"
      @click="emit('toggle-edit-mode')"
    >Edit</button>

    <!-- Burger -->
    <div class="burger-menu">
      <button class="burger-btn" @click.stop="toggleBurger" title="Menu">☰</button>
      <div v-show="showBurger" class="burger-panel">
        <button @click="showDashboards">Dashboards</button>
        <button @click="openSettings">Settings</button>
        <button @click="openServerSettings">Server Settings</button>
        <button @click="openGenerators">Generators &amp; Processors</button>
        <button @click="openDataSeries">Data Series</button>
        <button @click="openAbout">About</button>
      </div>
    </div>
  </div>

  <!-- About dialog (teleported to body) -->
  <Teleport to="body">
    <div v-if="showAbout" class="dialog-backdrop" @click.self="showAbout = false">
      <div class="dialog about-dialog">
        <h3>Sigvis</h3>
        <p>Node + Vue time-series dashboard</p>
        <p class="about-version">Version {{ pkg.version }}</p>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="showAbout = false">Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
