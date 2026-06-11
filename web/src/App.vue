<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DashboardActions from "./components/DashboardActions.vue";
import DashboardGrid from "./components/DashboardGrid.vue";
import DashboardTabs from "./components/DashboardTabs.vue";
import OpenDashboardDialog from "./components/OpenDashboardDialog.vue";
import ServerSettingsView from "./components/ServerSettingsView.vue";
import GeneratorsView from "./components/GeneratorsView.vue";
import DataSeriesView from "./components/DataSeriesView.vue";
import SerialIngestView from "./components/SerialIngestView.vue";
import SettingsView from "./components/SettingsView.vue";
import AboutView from "./components/AboutView.vue";
import ScreenTabs from "./components/ScreenTabs.vue";
import { listDashboards, openDashboard, saveDashboard, deleteDashboard as deleteSavedDashboardApi } from "./services/dashboardApi";
import {
  state,
  ensureInitialDashboard,
  getActiveDashboard,
  nextDefaultDashboardName,
  createDashboard,
  switchDashboard,
  deleteDashboard,
  renameDashboard,
  reorderDashboards,
  createWidget,
  removeWidget,
  updateWidgetLayout,
  updateWidgetConfig,
  serializeDashboard,
  applySavedName,
  loadDashboardPayload
} from "./stores/dashboardStore";
import {
  runtimeSettings,
  setResolvedTheme
} from "./stores/runtimeSettingsStore";
import { cadenceRenderMs, setGlobalRenderHz } from "./services/globalCadence";

const route = useRoute();
const router = useRouter();

const isEditMode = ref(true);
const openDialogVisible = ref(false);
const savedDashboards = ref([]);
const actionError = ref("");

// Derive view name from the current route name.
const currentView = computed(() => {
  const name = route.name;
  if (!name || name === "dashboard" || name === "dashboard-tab") return "dashboard";
  return name;
});

// Save-as inline dialog state.
const saveAsVisible = ref(false);
const saveAsInputValue = ref("");
let _saveAsResolve = null;

function showSaveAsDialog(initialName) {
  saveAsInputValue.value = initialName || "";
  saveAsVisible.value = true;
  return new Promise((resolve) => { _saveAsResolve = resolve; });
}

function onSaveAsConfirm() {
  saveAsVisible.value = false;
  const value = saveAsInputValue.value.trim();
  if (_saveAsResolve) _saveAsResolve(value || null);
  _saveAsResolve = null;
}

function onSaveAsCancel() {
  saveAsVisible.value = false;
  if (_saveAsResolve) _saveAsResolve(null);
  _saveAsResolve = null;
}

const activeDashboard = computed(() => getActiveDashboard());

function onCreateDashboard() {
  const dashboard = createDashboard({ name: nextDefaultDashboardName() });
  router.push({ name: "dashboard-tab", params: { id: dashboard.id } });
}

function applyRuntimeSettingsFromPayload(payload) {
  const settings = payload?.runtimeSettings;
  if (!settings || typeof settings !== "object") {
    return;
  }
  if ("renderHz" in settings) {
    setRenderHz(settings.renderHz);
  }
  if ("pointsToRequest" in settings) {
    setPointsToRequest(settings.pointsToRequest);
  }
  if ("showPerformanceOverlay" in settings) {
    setShowPerformanceOverlay(settings.showPerformanceOverlay);
  }
}

function onDeleteDashboard(id) {
  if (state.dashboards.length === 1) {
    actionError.value = "At least one Dashboard must remain.";
    return;
  }
  deleteDashboard(id);
}

async function runSave({ forcePrompt }) {
  const dashboard = activeDashboard.value;
  if (!dashboard) {
    return;
  }

  let targetName = dashboard.name;
  if (forcePrompt || !targetName) {
    targetName = await showSaveAsDialog(dashboard.name);
  }
  if (!targetName) {
    return;
  }

  try {
    actionError.value = "";
    await saveDashboard(
      targetName,
      serializeDashboard(dashboard, {
        runtimeSettings
      })
    );
    applySavedName(dashboard.id, targetName);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "Save failed.";
  }
}

async function saveTabDashboard(dashboardId) {
  const dashboard = state.dashboards.find((d) => d.id === dashboardId);
  if (!dashboard) return;

  let targetName = dashboard.lastSavedName;
  if (!targetName) {
    if (dashboard.hasCustomName) {
      targetName = dashboard.name;
    } else {
      targetName = await showSaveAsDialog(dashboard.name);
    }
  }
  if (!targetName) return;

  try {
    actionError.value = "";
    await saveDashboard(
      targetName,
      serializeDashboard(dashboard, { runtimeSettings })
    );
    applySavedName(dashboard.id, targetName);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "Save failed.";
  }
}

async function onOpenClick() {
  try {
    actionError.value = "";
    savedDashboards.value = await listDashboards();
    openDialogVisible.value = true;
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "Unable to list saved dashboards.";
  }
}

async function openDashboardByName(name) {
  try {
    actionError.value = "";
    const loaded = await openDashboard(name);
    loadDashboardPayload(
      {
        name: loaded.name,
        widgets: loaded.dashboard?.widgets || []
      },
      { asNewTab: true }
    );
    applyRuntimeSettingsFromPayload(loaded.dashboard);
    openDialogVisible.value = false;
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "Unable to open dashboard.";
  }
}

async function deleteSavedDashboard(name) {
  try {
    actionError.value = "";
    await deleteSavedDashboardApi(name);
    savedDashboards.value = savedDashboards.value.filter((d) => d.name !== name);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "Unable to delete dashboard.";
  }
}

onMounted(() => {
  ensureInitialDashboard();
  // If the URL contains a dashboard ID, try to activate it.
  const urlId = route.params.id;
  if (urlId && state.dashboards.some((d) => d.id === urlId)) {
    switchDashboard(urlId);
  }
});

// When the user hits back/forward to a dashboard-tab route, sync the store.
watch(
  () => route.params.id,
  (id) => {
    if (id && state.dashboards.some((d) => d.id === id)) {
      switchDashboard(id);
    }
  }
);

function navigateTo(view) {
  if (view === "dashboard") {
    const id = state.activeDashboardId;
    router.push(id ? { name: "dashboard-tab", params: { id } } : { name: "dashboard" });
  } else {
    router.push({ name: view });
  }
}

function onSelectDashboard(id) {
  switchDashboard(id);
  router.push({ name: "dashboard-tab", params: { id } });
}

watch(
  () => runtimeSettings.renderHz,
  (value) => {
    setGlobalRenderHz(value);
  },
  { immediate: true }
);

// ── Theme ──────────────────────────────────────────────────────────────────
let systemDarkQuery = null;

function applyTheme(choice) {
  const root = document.documentElement;
  let resolved;
  if (choice === "dark") {
    resolved = "dark";
  } else if (choice === "light") {
    resolved = "light";
  } else {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-theme", resolved);
  setResolvedTheme(resolved);
}

function setupSystemListener(choice) {
  if (systemDarkQuery) {
    systemDarkQuery.removeEventListener("change", onSystemChange);
  }
  if (choice === "system") {
    systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    systemDarkQuery.addEventListener("change", onSystemChange);
  } else {
    systemDarkQuery = null;
  }
}

function onSystemChange() {
  if (runtimeSettings.theme === "system") applyTheme("system");
}

watch(
  () => runtimeSettings.theme,
  (choice) => {
    applyTheme(choice);
    setupSystemListener(choice);
  },
  { immediate: true }
);
</script>

<template>
  <main class="app-shell">
    <!-- ── Dashboard view ──────────────────────────────────────────────── -->
    <template v-if="currentView === 'dashboard'">
      <div class="tab-bar">
        <DashboardTabs
          :dashboards="state.dashboards"
          :active-dashboard-id="state.activeDashboardId"
          :is-edit-mode="isEditMode"
          @select="onSelectDashboard"
          @create="onCreateDashboard"
          @delete="onDeleteDashboard"
          @rename="renameDashboard"
          @reorder="reorderDashboards"
          @save="saveTabDashboard"
          @open="onOpenClick"
          @add-widget="createWidget('dataSeries')"
        />
        <DashboardActions
          :is-edit-mode="isEditMode"
          @toggle-edit-mode="isEditMode = !isEditMode"
          @navigate-to-settings="navigateTo('settings')"
        />
      </div>
      <p v-if="actionError" class="action-error">{{ actionError }}</p>
      <DashboardGrid
        v-if="activeDashboard"
        :widgets="activeDashboard.widgets"
        :is-edit-mode="isEditMode"
        @remove-widget="removeWidget"
        @update-widget-config="updateWidgetConfig"
        @update-widget-layout="updateWidgetLayout"
      />
    </template>

    <!-- ── Settings screens (sidebar layout) ───────────────────────────── -->
    <div v-else class="settings-shell">
      <aside class="settings-sidebar">
        <ScreenTabs
          :current-view="currentView"
          @navigate="navigateTo($event)"
        />
      </aside>
      <div class="settings-content">
        <p v-if="actionError" class="action-error">{{ actionError }}</p>
        <SettingsView v-if="currentView === 'settings'" />
        <AboutView v-else-if="currentView === 'about'" />
        <ServerSettingsView v-else-if="currentView === 'server-settings'" />
        <GeneratorsView v-else-if="currentView === 'generators'" />
        <DataSeriesView v-else-if="currentView === 'data-series'" />
        <SerialIngestView v-else-if="currentView === 'serial-ingest'" />
      </div>
    </div>

    <OpenDashboardDialog
      :open="openDialogVisible"
      :items="savedDashboards"
      @close="openDialogVisible = false"
      @open-dashboard="openDashboardByName"
      @delete-dashboard="deleteSavedDashboard"
    />

    <div v-if="saveAsVisible" class="dialog-backdrop" @click.self="onSaveAsCancel">
      <div class="dialog save-as-dialog">
        <h3>Save Dashboard As</h3>
        <input
          v-model="saveAsInputValue"
          class="save-as-input"
          placeholder="Dashboard name"
          @keydown.enter="onSaveAsConfirm"
          @keydown.escape="onSaveAsCancel"
        />
        <div class="dialog-actions">
          <button type="button" class="primary" @click="onSaveAsConfirm">Save</button>
          <button type="button" @click="onSaveAsCancel">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="runtimeSettings.showPerformanceOverlay" class="perf-overlay">
      <span>render: {{ cadenceRenderMs != null ? cadenceRenderMs.toFixed(1) + ' ms' : '--' }}</span>
    </div>

  </main>
</template>

<style scoped>
.save-as-dialog {
  width: min(420px, 92vw);
}
.save-as-input {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
}
</style>
