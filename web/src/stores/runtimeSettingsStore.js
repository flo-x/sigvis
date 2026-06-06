import { reactive } from "vue";

const THEME_KEY = "visualizer-theme";

function resolveThemeChoice(choice) {
  if (choice === "dark") return "dark";
  if (choice === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const themeChoice = localStorage.getItem(THEME_KEY) || "system";

const runtimeSettings = reactive({
  renderHz: 20,
  pointsToRequest: 1000,
  showPerformanceOverlay: false,
  theme: /** @type {"light"|"dark"|"system"} */ (themeChoice),
  resolvedTheme: /** @type {"light"|"dark"} */ (resolveThemeChoice(themeChoice))
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

function setTheme(value) {
  const valid = ["light", "dark", "system"];
  if (!valid.includes(value)) return;
  runtimeSettings.theme = value;
  runtimeSettings.resolvedTheme = resolveThemeChoice(value);
  localStorage.setItem(THEME_KEY, value);
}

function setResolvedTheme(value) {
  if (value === "dark" || value === "light") {
    runtimeSettings.resolvedTheme = value;
  }
}

export {
  runtimeSettings,
  setRenderHz,
  setPointsToRequest,
  setShowPerformanceOverlay,
  setTheme,
  setResolvedTheme
};
