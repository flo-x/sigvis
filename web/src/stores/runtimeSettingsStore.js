import { reactive } from "vue";

const runtimeSettings = reactive({
  renderHz: 20,
  pointsToRequest: 1000,
  showPerformanceOverlay: false
});

function clampHz(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function clampPoints(value, fallback = 1000) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function setRenderHz(value) {
  runtimeSettings.renderHz = clampHz(value, runtimeSettings.renderHz);
}

function setPointsToRequest(value) {
  runtimeSettings.pointsToRequest = clampPoints(value, runtimeSettings.pointsToRequest);
}

function setShowPerformanceOverlay(value) {
  runtimeSettings.showPerformanceOverlay = Boolean(value);
}

export {
  runtimeSettings,
  setRenderHz,
  setPointsToRequest,
  setShowPerformanceOverlay
};
