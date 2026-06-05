import DataSeriesWidget from "../components/widgets/DataSeriesWidget.vue";
import { widgetMigrations } from "./widgetMigrations";

const widgetRegistry = {
  dataSeries: {
    type: "dataSeries",
    title: "Data Series",
    component: DataSeriesWidget,
    latestVersion: widgetMigrations.dataSeries.latestVersion,
    capabilities: {
      configure: true,
      toggleLive: true
    },
    defaultSizeCells: {
      w: 4,
      h: 5
    },
    defaultConfig: () => ({
      title: "",
      seriesIds: [],
      seriesColors: {},
      seriesStyles: {},
      showLegend: true,
      timeSyncDomain: "",
      valueFormat: "fixed",
      valueDecimals: 2,
      xAxisLabel: "",
      xAxisUnit: "",
      yAxisLabel: "",
      yAxisUnit: "",
      liveMode: true,
      displayPerformanceMeasurements: true
    })
  }
};

export { widgetRegistry };
