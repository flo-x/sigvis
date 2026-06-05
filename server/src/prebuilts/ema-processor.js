"use strict";

const dspLib = require("../lib/dsp");

/**
 * Prebuilt processor: EMA (Exponential Moving Average)
 *
 * Reads a source measurement/series and writes a smoothed EMA series back
 * into the same measurement using the non-destructive merge path.
 */
module.exports = {
  id:          "ema-processor",
  displayName: "EMA filter",
  kind:        "processor",
  description: "Applies an Exponential Moving Average filter to a source series " +
               "and writes the smoothed result as a new series in the same measurement.",

  paramSchema: [
    {
      name:     "measurement",
      label:    "Measurement name",
      type:     "measurement",
      default:  "",
      required: true
    },
    {
      name:            "sourceSeries",
      label:           "Source series name",
      type:            "series",
      measurementParam: "measurement",
      default:         "value",
      required:        true
    },
    {
      name:     "outputSeries",
      label:    "Output series name",
      type:     "string",
      default:  "ema",
      required: true
    },
    {
      name:    "alpha",
      label:   "Alpha (smoothing factor)",
      type:    "number",
      default: 0.1,
      max:     0.999,
      help:    "Controls the trade-off between smoothing and responsiveness.\nRange: (0, 1) — closer to 0 = more smoothing, more lag; closer to 1 = less smoothing, faster response.\nApproximate time constant: 1 / alpha samples.\nExamples:\n  alpha = 0.5  → reacts quickly, light smoothing (~2 sample time constant)\n  alpha = 0.1  → moderate smoothing (~10 sample time constant)\n  alpha = 0.01 → heavy smoothing (~100 sample time constant)"
    }
  ],

  /**
   * Optional cross-field / domain validation.
   * Return { fieldName: "message" } for each invalid field; empty object = valid.
   */
  validateFn(config) {
    const errors = {};
    const alpha = Number(config.alpha);
    if (!(alpha > 0)) {
      errors.alpha = "Alpha must be a positive number (> 0).";
    }
    if (config.sourceSeries && config.outputSeries &&
        config.sourceSeries === config.outputSeries) {
      errors.outputSeries = "Output series must differ from the source series.";
    }
    return errors;
  },

  initFn(state, config, _api) {
    // Create (or recreate) the EMA filter whenever init runs.
    state.ema = dspLib.ema(config.alpha || 0.1);
  },

  processFn(state, config, api) {
    const meas   = config.measurement;
    const src    = config.sourceSeries  || "value";
    const output = config.outputSeries  || "ema";

    if (!meas) return;

    const newCount = api.getNewPointCount(meas);
    if (newCount === 0) return;

    const m = api.getMeasurement(meas);
    if (!m || !m.series[src]) return;

    const start  = m.timestamps.length - newCount;
    const newTs  = m.timestamps.slice(start);
    const newEma = state.ema.update(m.series[src].slice(start));

    api.ingest({
      measurementName: meas,
      points: { timestamps: newTs, series: { [output]: newEma } }
    });
  }
};
