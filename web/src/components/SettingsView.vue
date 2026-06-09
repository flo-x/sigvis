<script setup>
import {
  runtimeSettings,
  setRenderHz,
  setPointsToRequest,
  setShowPerformanceOverlay,
  setTheme
} from "../stores/runtimeSettingsStore";
</script>

<template>
  <div class="adm-view settings-view">
    <div class="adm-card">
      <h2>Display</h2>
      <div class="sv-field">
        <label class="sv-label" for="sv-theme">Theme</label>
        <select
          id="sv-theme"
          :value="runtimeSettings.theme"
          @change="setTheme($event.target.value)"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div class="sv-field">
        <label class="sv-label sv-checkbox-label" for="sv-perf">
          <input
            id="sv-perf"
            type="checkbox"
            :checked="runtimeSettings.showPerformanceOverlay"
            @change="setShowPerformanceOverlay($event.target.checked)"
          />
          Performance overlay
        </label>
      </div>
    </div>

    <div class="adm-card">
      <h2>Data</h2>
      <div class="sv-field">
        <label class="sv-label" for="sv-hz">Render Hz</label>
        <input
          id="sv-hz"
          type="number" min="0.1" step="0.1"
          :value="runtimeSettings.renderHz"
          @change="setRenderHz(Number($event.target.value))"
        />
      </div>
      <div class="sv-field">
        <label class="sv-label" for="sv-pts">Points to request</label>
        <input
          id="sv-pts"
          type="number" min="1" step="1"
          :value="runtimeSettings.pointsToRequest"
          @change="setPointsToRequest(Number($event.target.value))"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sv-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--c-border-subtle);
  font-size: 0.875rem;
}

.sv-field:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.sv-label {
  color: var(--c-text-2);
}

.sv-checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  justify-content: flex-start;
  width: 100%;
}

.sv-field input[type="number"],
.sv-field select {
  width: 6rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  font: inherit;
  background: var(--c-surface-subtle);
  color: var(--c-text);
}
</style>
