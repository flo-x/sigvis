const widgetMigrations = {
  dataSeries: {
    latestVersion: 13,
    migrations: {
      1: (config) => ({
        ...config,
        timeSyncDomain: config?.timeSyncDomain ?? ""
      }),
      2: (config) => ({
        ...config,
        pointsToRequest: Number.isInteger(config?.pointsToRequest) && config.pointsToRequest > 0 ? config.pointsToRequest : 1000
      }),
      3: (config) => ({
        ...config,
        liveMode: config?.liveMode !== false,
        liveRefreshHz: Number(config?.liveRefreshHz) > 0 ? Number(config.liveRefreshHz) : 20
      }),
      4: (config) => ({
        ...config,
        displayPerformanceMeasurements: config?.displayPerformanceMeasurements !== false
      }),
      5: (config) => ({
        ...config,
        seriesIds: (config?.seriesIds || []).map((id) => (id.includes(":") ? id : `${id}:value`))
      }),
      // v6 → v7: strip keys that were promoted to global runtime settings.
      6: ({ pointsToRequest: _p, liveRefreshHz: _l, ...rest }) => rest,
      // v7 → v8: add per-widget title and per-series color overrides.
      7: (config) => ({ ...config, title: "", seriesColors: {} }),
      // v8 → v9: add Y-axis label and unit.
      8: (config) => ({ ...config, yAxisLabel: "", yAxisUnit: "" }),
      // v9 → v10: add X-axis label and unit.
      9: (config) => ({ ...config, xAxisLabel: "", xAxisUnit: "" }),
      // v10 → v11: add value format and decimal places.
      10: (config) => ({ ...config, valueFormat: "fixed", valueDecimals: 2 }),
      // v11 → v12: add per-series line style overrides.
      11: (config) => ({ ...config, seriesStyles: {} }),
      // v12 → v13: add legend visibility toggle.
      12: (config) => ({ ...config, showLegend: true })
    }
  }
};

function migrateWidget(widget) {
  const spec = widgetMigrations[widget.type];
  if (!spec) {
    return widget;
  }

  let version = Number(widget.version || 1);
  let config = widget.config || {};

  while (version < spec.latestVersion) {
    const migrateFn = spec.migrations[version];
    if (!migrateFn) {
      break;
    }
    config = migrateFn(config);
    version += 1;
  }

  return {
    ...widget,
    version,
    config
  };
}

export { migrateWidget, widgetMigrations };
