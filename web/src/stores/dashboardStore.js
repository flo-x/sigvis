import { reactive } from "vue";
import { widgetRegistry } from "../widgets/widgetRegistry";
import { migrateWidget } from "../widgets/widgetMigrations";

const state = reactive({
  dashboards: [],
  activeDashboardId: null
});

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function markDirty(dashboard) {
  dashboard.isDirty = true;
}

function normalizeLayout(layout = {}) {
  const safeX = Number.isFinite(layout.x) ? layout.x : 0;
  const safeY = Number.isFinite(layout.y) ? layout.y : 0;
  const safeW = Number.isFinite(layout.w) ? layout.w : 4;
  const safeH = Number.isFinite(layout.h) ? layout.h : 3;

  return {
    x: Math.max(0, Math.min(11, Math.trunc(safeX))),
    y: Math.max(0, Math.min(5000, Math.trunc(safeY))),
    w: Math.max(1, Math.min(12, Math.trunc(safeW))),
    h: Math.max(1, Math.min(12, Math.trunc(safeH)))
  };
}

function getNextWidgetY(widgets) {
  return widgets.reduce((maxY, widget) => {
    const layout = normalizeLayout(widget.layout);
    return Math.max(maxY, layout.y + layout.h);
  }, 0);
}

function createDashboard({ name = "" } = {}) {
  const dashboard = {
    id: makeId("dashboard"),
    name,
    widgets: [],
    isDirty: false,
    lastSavedName: null,
    hasCustomName: false
  };
  state.dashboards.push(dashboard);
  state.activeDashboardId = dashboard.id;
  return dashboard;
}

function getActiveDashboard() {
  return state.dashboards.find((dashboard) => dashboard.id === state.activeDashboardId) || null;
}

function switchDashboard(id) {
  if (state.dashboards.some((dashboard) => dashboard.id === id)) {
    state.activeDashboardId = id;
  }
}

function deleteDashboard(id) {
  const idx = state.dashboards.findIndex((dashboard) => dashboard.id === id);
  if (idx < 0) {
    return;
  }
  state.dashboards.splice(idx, 1);
  if (state.dashboards.length === 0) {
    createDashboard({ name: "Dashboard 1" });
    return;
  }
  if (state.activeDashboardId === id) {
    state.activeDashboardId = state.dashboards[Math.max(0, idx - 1)].id;
  }
}

function nextDefaultDashboardName() {
  return `Dashboard ${state.dashboards.length + 1}`;
}

function createWidget(type = "dataSeries") {
  const dashboard = getActiveDashboard();
  const spec = widgetRegistry[type];
  if (!dashboard || !spec) {
    return null;
  }
  const widget = {
    id: makeId("widget"),
    type,
    version: spec.latestVersion,
    layout: normalizeLayout({
      x: 0,
      y: getNextWidgetY(dashboard.widgets),
      w: spec.defaultSizeCells?.w ?? 4,
      h: spec.defaultSizeCells?.h ?? 3
    }),
    config: spec.defaultConfig()
  };
  dashboard.widgets.push(widget);
  markDirty(dashboard);
  return widget;
}

function removeWidget(widgetId) {
  const dashboard = getActiveDashboard();
  if (!dashboard) {
    return;
  }
  dashboard.widgets = dashboard.widgets.filter((widget) => widget.id !== widgetId);
  markDirty(dashboard);
}

function updateWidgetLayout(widgetId, nextLayout) {
  const dashboard = getActiveDashboard();
  if (!dashboard) {
    return;
  }
  const widget = dashboard.widgets.find((entry) => entry.id === widgetId);
  if (!widget) {
    return;
  }
  widget.layout = {
    ...normalizeLayout({
      ...widget.layout,
      ...nextLayout
    })
  };
  markDirty(dashboard);
}

function updateWidgetConfig(widgetId, partialConfig) {
  const dashboard = getActiveDashboard();
  if (!dashboard) {
    return;
  }
  const widget = dashboard.widgets.find((entry) => entry.id === widgetId);
  if (!widget) {
    return;
  }
  widget.config = {
    ...widget.config,
    ...partialConfig
  };
  markDirty(dashboard);
}

function serializeDashboard(dashboard, { runtimeSettings } = {}) {
  return {
    name: dashboard.name || "",
    widgets: dashboard.widgets.map((widget) => ({
      id: widget.id,
      type: widget.type,
      version: widget.version,
      layout: normalizeLayout(widget.layout),
      config: { ...widget.config }
    })),
    runtimeSettings: runtimeSettings
      ? {
          renderHz: runtimeSettings.renderHz,
          pointsToRequest: runtimeSettings.pointsToRequest,
          showPerformanceOverlay: runtimeSettings.showPerformanceOverlay
        }
      : undefined
  };
}

function reorderDashboards(fromId, toId) {
  const dashboards = state.dashboards;
  const fromIdx = dashboards.findIndex((d) => d.id === fromId);
  const toIdx = dashboards.findIndex((d) => d.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = dashboards.splice(fromIdx, 1);
  dashboards.splice(toIdx, 0, moved);
}

function renameDashboard(dashboardId, newName) {
  const dashboard = state.dashboards.find((entry) => entry.id === dashboardId);
  if (!dashboard) return;
  dashboard.name = newName;
  dashboard.hasCustomName = true;
  dashboard.isDirty = dashboard.lastSavedName !== newName;
}

function applySavedName(dashboardId, savedName) {
  const dashboard = state.dashboards.find((entry) => entry.id === dashboardId);
  if (!dashboard) {
    return;
  }
  dashboard.name = savedName;
  dashboard.lastSavedName = savedName;
  dashboard.isDirty = false;
}

function loadDashboardPayload(payload, { asNewTab = true } = {}) {
  const widgets = Array.isArray(payload.widgets)
    ? payload.widgets.map((widget) => {
        const migrated = migrateWidget(widget);
        return {
          ...migrated,
          layout: normalizeLayout(migrated.layout)
        };
      })
    : [];

  const normalized = {
    id: makeId("dashboard"),
    name: payload.name || "",
    widgets,
    isDirty: false,
    lastSavedName: payload.name || null
  };

  if (asNewTab) {
    state.dashboards.push(normalized);
    state.activeDashboardId = normalized.id;
    return normalized;
  }

  const active = getActiveDashboard();
  if (active) {
    active.name = normalized.name;
    active.widgets = normalized.widgets;
    active.isDirty = false;
    active.lastSavedName = normalized.lastSavedName;
    return active;
  }

  state.dashboards.push(normalized);
  state.activeDashboardId = normalized.id;
  return normalized;
}

function ensureInitialDashboard() {
  if (state.dashboards.length === 0) {
    createDashboard({ name: "Dashboard 1" });
  }
}

export {
  state,
  ensureInitialDashboard,
  getActiveDashboard,
  nextDefaultDashboardName,
  createDashboard,
  switchDashboard,
  deleteDashboard,
  createWidget,
  removeWidget,
  updateWidgetLayout,
  updateWidgetConfig,
  serializeDashboard,
  renameDashboard,
  reorderDashboards,
  applySavedName,
  loadDashboardPayload
};
