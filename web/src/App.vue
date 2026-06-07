<script setup>
import { computed, onMounted, ref, watch } from "vue";
import DashboardActions from "./components/DashboardActions.vue";
import DashboardGrid from "./components/DashboardGrid.vue";
import DashboardTabs from "./components/DashboardTabs.vue";
import OpenDashboardDialog from "./components/OpenDashboardDialog.vue";
import ServerSettingsView from "./components/ServerSettingsView.vue";
import GeneratorsView from "./components/GeneratorsView.vue";
import DataSeriesView from "./components/DataSeriesView.vue";
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
  setRenderHz,
  setPointsToRequest,
  setShowPerformanceOverlay,
  setTheme,
  setResolvedTheme
} from "./stores/runtimeSettingsStore";
import { cadenceRenderMs, setGlobalRenderHz } from "./services/globalCadence";

const isEditMode = ref(true);
const openDialogVisible = ref(false);
const showSettingsDialog = ref(false);
const savedDashboards = ref([]);
const actionError = ref("");
const currentView = ref("dashboard");

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
  createDashboard({ name: nextDefaultDashboardName() });
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
});

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
    <div v-if="currentView === 'dashboard'" class="tab-bar">
      <DashboardTabs
        :dashboards="state.dashboards"
        :active-dashboard-id="state.activeDashboardId"
        :is-edit-mode="isEditMode"
        @select="switchDashboard"
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
        @open-settings="showSettingsDialog = true"
        @toggle-edit-mode="isEditMode = !isEditMode"
        @open-server-settings="currentView = 'server-settings'"
        @open-generators="currentView = 'generators'"
        @open-data-series="currentView = 'data-series'"
        @show-dashboards="currentView = 'dashboard'"
      />
    </div>

    <div v-else class="tab-bar">
      <ScreenTabs
        :current-view="currentView"
        @navigate="currentView = $event"
      />
      <DashboardActions
        :show-edit-button="false"
        :is-edit-mode="isEditMode"
        @open-settings="showSettingsDialog = true"
        @toggle-edit-mode="isEditMode = !isEditMode"
        @open-server-settings="currentView = 'server-settings'"
        @open-generators="currentView = 'generators'"
        @open-data-series="currentView = 'data-series'"
        @show-dashboards="currentView = 'dashboard'"
      />
    </div>

    <p v-if="actionError" class="action-error">{{ actionError }}</p>

    <ServerSettingsView v-if="currentView === 'server-settings'" />

    <GeneratorsView v-else-if="currentView === 'generators'" />

    <DataSeriesView v-else-if="currentView === 'data-series'" />

    <DashboardGrid
      v-else-if="activeDashboard"
      :widgets="activeDashboard.widgets"
      :is-edit-mode="isEditMode"
      @remove-widget="removeWidget"
      @update-widget-config="updateWidgetConfig"
      @update-widget-layout="updateWidgetLayout"
    />

    <OpenDashboardDialog
      :open="openDialogVisible"
      :items="savedDashboards"
      @close="openDialogVisible = false"
      @open-dashboard="openDashboardByName"
      @delete-dashboard="deleteSavedDashboard"
    />

    <div v-if="showSettingsDialog" class="dialog-backdrop" @click.self="showSettingsDialog = false">
      <div class="dialog settings-dialog">
        <h3>Settings</h3>
        <label class="settings-field">
          Render Hz
          <input
            type="number" min="0.1" step="0.1"
            :value="runtimeSettings.renderHz"
            @change="setRenderHz(Number($event.target.value))"
          />
        </label>
        <label class="settings-field">
          Points to request
          <input
            type="number" min="1" step="1"
            :value="runtimeSettings.pointsToRequest"
            @change="setPointsToRequest(Number($event.target.value))"
          />
        </label>
        <label class="settings-field settings-field--checkbox">
          <input
            type="checkbox"
            :checked="runtimeSettings.showPerformanceOverlay"
            @change="setShowPerformanceOverlay($event.target.checked)"
          />
          Performance overlay
        </label>
        <label class="settings-field">
          Theme
          <select
            :value="runtimeSettings.theme"
            @change="setTheme($event.target.value)"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="showSettingsDialog = false">Close</button>
        </div>
      </div>
    </div>

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
.settings-dialog {
  width: min(340px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.settings-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.875rem;
}
.settings-field input[type="number"],
.settings-field select {
  width: 5rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  font: inherit;
  background: var(--c-surface);
  color: var(--c-text);
}
.settings-field--checkbox {
  justify-content: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}
</style>
