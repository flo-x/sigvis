"use strict";

const dspLib = require("../lib/dsp");

/**
 * Prebuilt processor: Sliding-window median filter.
 *
 * Reads a source measurement/series and writes a median-filtered series back
 * into the same measurement using the non-destructive merge path.
 */
module.exports = {
  id:          "median-processor",
  displayName: "Median filter",
  kind:        "processor",
  description: "Applies a sliding-window median filter to a source series " +
               "and writes the smoothed result as a new series in the same measurement. " +
               "Effective at removing impulse noise (spikes) while preserving edges.",

  paramSchema: [
    {
      name:     "measurement",
      label:    "Measurement name",
      type:     "measurement",
      default:  "",
      required: true
    },
    {
      name:             "sourceSeries",
      label:            "Source series name",
      type:             "series",
      measurementParam: "measurement",
      default:          "value",
      required:         true
    },
    {
      name:     "outputSeries",
      label:    "Output series name",
      type:     "string",
      default:  "median",
      required: true
    },
    {
      name:     "windowSize",
      label:    "Window size (samples)",
      type:     "number",
      default:  5,
      min:      1,
      required: true,
      help:     "Number of samples in the sliding window.\nLarger values → stronger noise rejection, more lag.\nSmaller values → faster response, less smoothing.\nOdd values are conventional (unambiguous median); even values are also accepted.\nExamples:\n  windowSize = 3  → light smoothing, 1-sample lag at steady state\n  windowSize = 5  → moderate smoothing (default)\n  windowSize = 11 → heavy smoothing, 5-sample lag at steady state"
    }
  ],

  /**
   * Optional cross-field / domain validation.
   * Return { fieldName: "message" } for each invalid field; empty object = valid.
   */
  validateFn(config) {
    const errors = {};
    const w = Number(config.windowSize);
    if (!Number.isInteger(w) || w < 1) {
      errors.windowSize = "Window size must be a positive integer (≥ 1).";
    }
    if (config.sourceSeries && config.outputSeries &&
        config.sourceSeries === config.outputSeries) {
      errors.outputSeries = "Output series must differ from the source series.";
    }
    return errors;
  },

  initFn(state, config, _api) {
    state.median = dspLib.median(Math.max(1, Math.round(Number(config.windowSize) || 5)));
  },

  processFn(state, config, api) {
    const meas   = config.measurement;
    const src    = config.sourceSeries || "value";
    const output = config.outputSeries || "median";

    if (!meas) return;

    const newCount = api.getNewPointCount(meas);
    if (newCount === 0) return;

    const m = api.getMeasurement(meas);
    if (!m || !m.series[src]) return;

    const start      = m.timestamps.length - newCount;
    const newTs      = m.timestamps.slice(start);
    const newMedian  = state.median.update(m.series[src].slice(start));

    api.ingest({
      measurementName: meas,
      points: { timestamps: newTs, series: { [output]: newMedian } }
    });
  }
};
