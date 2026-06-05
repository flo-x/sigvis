<script setup>
import { computed, onMounted, ref, watch } from "vue";
import DashboardActions from "./components/DashboardActions.vue";
import DashboardGrid from "./components/DashboardGrid.vue";
import DashboardTabs from "./components/DashboardTabs.vue";
import OpenDashboardDialog from "./components/OpenDashboardDialog.vue";
import { listDashboards, openDashboard, saveDashboard } from "./services/dashboardApi";
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
  setShowPerformanceOverlay
} from "./stores/runtimeSettingsStore";
import { cadenceRenderMs, setGlobalRenderHz } from "./services/globalCadence";

const isEditMode = ref(true);
const openDialogVisible = ref(false);
const showSettingsDialog = ref(false);
const savedDashboards = ref([]);
const actionError = ref("");

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
</script>

<template>
  <main class="app-shell">
    <DashboardActions
      :is-edit-mode="isEditMode"
      @create-dashboard="onCreateDashboard"
      @save="runSave({ forcePrompt: false })"
      @save-as="runSave({ forcePrompt: true })"
      @open="onOpenClick"
      @open-settings="showSettingsDialog = true"
      @add-widget="createWidget('dataSeries')"
      @toggle-edit-mode="isEditMode = !isEditMode"
    />

    <DashboardTabs
      :dashboards="state.dashboards"
      :active-dashboard-id="state.activeDashboardId"
      :is-edit-mode="isEditMode"
      @select="switchDashboard"
      @create="onCreateDashboard"
      @delete="onDeleteDashboard"
      @rename="renameDashboard"
      @reorder="reorderDashboards"
    />

    <p v-if="actionError" class="action-error">{{ actionError }}</p>

    <DashboardGrid
      v-if="activeDashboard"
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
.settings-field input[type="number"] {
  width: 5rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.settings-field--checkbox {
  justify-content: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}
</style>
