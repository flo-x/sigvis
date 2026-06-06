"use strict";

const dspLib = require("../lib/dsp");

/**
 * Round a positive number to 2 significant figures.
 * e.g. 0 → 0, 12.3 → 12, 123 → 120, 1.23 → 1.2, 0.0456 → 0.046
 */
function round2SigFigs(x) {
  if (x === 0 || !Number.isFinite(x)) return x;
  const magnitude = Math.pow(10, 2 - Math.ceil(Math.log10(Math.abs(x))));
  return Math.ceil(x * magnitude) / magnitude;
}

/**
 * Estimate sample rate in Hz from an array of timestamps (milliseconds).
 * Uses the median inter-sample interval from recent samples.
 * Returns null if it cannot be determined.
 */
function estimateSampleRateHz(timestamps) {
  const n = Math.min(timestamps.length, 256);
  if (n < 2) return null;
  const start = timestamps.length - n;
  const deltas = [];
  for (let i = start + 1; i < timestamps.length; i++) {
    const d = timestamps[i] - timestamps[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return null;
  deltas.sort((a, b) => a - b);
  const medianMs = deltas[Math.floor(deltas.length / 2)];
  return medianMs > 0 ? 1000 / medianMs : null;
}

/**
 * Prebuilt processor: Spectrum analyser (FFT-based).
 *
 * Computes the frequency-domain magnitude spectrum of a source series using
 * FFT. The sample rate is estimated automatically from the data timestamps.
 * Each frequency bin is rounded to 2 significant figures. The spectrum is
 * written to a separate output measurement so it can be visualised on a
 * numeric X axis (set the widget's X axis to "numeric" / time: false).
 */
module.exports = {
  id:          "spectrum-processor",
  displayName: "Spectrum analyser (FFT)",
  kind:        "processor",
  description:
    "Computes the FFT magnitude spectrum of a source series. " +
    "Sample rate is derived automatically from the data timestamps. " +
    "Frequency bins are rounded to 2 significant figures. " +
    "The result is written to a separate measurement with frequency (Hz) as " +
    "the X axis — display it in a widget with the X axis set to numeric.",

  paramSchema: [
    {
      name:     "measurement",
      label:    "Source measurement",
      type:     "measurement",
      default:  "",
      required: true
    },
    {
      name:             "sourceSeries",
      label:            "Source series",
      type:             "series",
      measurementParam: "measurement",
      default:          "value",
      required:         true
    },
    {
      name:     "outputMeasurement",
      label:    "Output measurement name",
      type:     "string",
      default:  "",
      required: true,
      help:     "Name of the measurement where the spectrum will be written.\n" +
                "Use a dedicated name (e.g. \"my_signal_spectrum\") so it does not\n" +
                "conflict with time-series measurements."
    },
    {
      name:    "outputSeries",
      label:   "Output series name",
      type:    "string",
      default: "magnitude",
      required: true
    },
    {
      name:    "window",
      label:   "Window function",
      type:    "select",
      options: ["hann", "hamming", "blackman", "rect"],
      default: "hann",
      help:    "Window applied to each FFT frame to reduce spectral leakage.\n" +
               "  hann     — good all-purpose choice (default)\n" +
               "  hamming  — slightly narrower main lobe than Hann\n" +
               "  blackman — lowest side lobes, widest main lobe\n" +
               "  rect     — no windowing; highest frequency resolution, most leakage"
    },
    {
      name:    "scale",
      label:   "Output scale",
      type:    "select",
      options: ["magnitude", "db"],
      default: "magnitude",
      help:    "Scale for the output magnitudes.\n" +
               "  magnitude — linear amplitude (0–1 for a unit sinusoid)\n" +
               "  db        — decibels relative to amplitude 1 (0 dB = full scale)"
    },
    {
      name:    "averaging",
      label:   "Frame averaging",
      type:    "number",
      default: 4,
      min:     1,
      help:    "Number of FFT frames to average (EMA) for a smoother spectrum.\n" +
               "1 = no averaging (single-shot per tick)\n" +
               "Higher values smooth out noise but react slower to changes."
    },
    {
      name:    "maxSamples",
      label:   "Max samples (FFT window)",
      type:    "number",
      default: 1024,
      min:     4,
      help:    "Maximum number of the most-recent samples fed to the FFT.\n" +
               "Actual FFT size is the next power of 2 at or above this value.\n" +
               "Larger values give finer frequency resolution but cost more CPU.\n" +
               "Recommended: 256, 512, 1024, 2048."
    }
  ],

  validateFn(config) {
    const errors = {};
    const validWindows = ["rect", "hann", "hamming", "blackman"];
    const w = String(config.window || "").trim().toLowerCase();
    if (w && !validWindows.includes(w)) {
      errors.window = `Invalid window. Must be one of: ${validWindows.join(", ")}.`;
    }
    const validScales = ["magnitude", "db"];
    const s = String(config.scale || "").trim().toLowerCase();
    if (s && !validScales.includes(s)) {
      errors.scale = `Invalid scale. Must be one of: ${validScales.join(", ")}.`;
    }
    const avg = Number(config.averaging);
    if (!Number.isFinite(avg) || avg < 1) {
      errors.averaging = "Frame averaging must be a number ≥ 1.";
    }
    const ms = Number(config.maxSamples);
    if (!Number.isInteger(ms) || ms < 4) {
      errors.maxSamples = "Max samples must be an integer ≥ 4.";
    }
    if (!config.outputMeasurement || !String(config.outputMeasurement).trim()) {
      errors.outputMeasurement = "Output measurement name is required.";
    }
    return errors;
  },

  initFn(state, _config, _api) {
    state.analyzer         = null;
    state.lastSampleRateHz = null;
    state.lastWindow       = null;
    state.lastScale        = null;
    state.lastAveraging    = null;
  },

  processFn(state, config, api) {
    const meas      = config.measurement;
    const src       = config.sourceSeries    || "value";
    const outMeas   = String(config.outputMeasurement || "").trim();
    const outSeries = config.outputSeries    || "magnitude";
    const window    = String(config.window   || "hann").trim().toLowerCase();
    const scale     = String(config.scale    || "magnitude").trim().toLowerCase();
    const averaging = Math.max(1, Number(config.averaging)   || 4);
    const maxSamples = Math.max(4, Math.round(Number(config.maxSamples) || 1024));

    if (!meas || !outMeas) return;

    const m = api.getMeasurement(meas);
    if (!m || !m.series[src] || m.timestamps.length < 4) return;

    // Estimate the current sample rate from the timestamps, rounded up to 2 sig figs.
    const rawSampleRateHz = estimateSampleRateHz(m.timestamps);
    if (!rawSampleRateHz || !Number.isFinite(rawSampleRateHz)) return;
    const sampleRateHz = round2SigFigs(rawSampleRateHz);

    // (Re)create the analyser when any option changes or the sample rate drifts > 5%.
    const rateChanged = !state.lastSampleRateHz ||
      Math.abs(state.lastSampleRateHz - sampleRateHz) / state.lastSampleRateHz > 0.05;
    const optChanged =
      state.lastWindow    !== window    ||
      state.lastScale     !== scale     ||
      state.lastAveraging !== averaging;

    if (!state.analyzer || rateChanged || optChanged) {
      state.analyzer         = dspLib.spectrum({ sampleRateHz, window, scale, averaging });
      state.lastSampleRateHz = sampleRateHz;
      state.lastWindow       = window;
      state.lastScale        = scale;
      state.lastAveraging    = averaging;
    }

    // Feed the most-recent maxSamples values into the FFT.
    const values = m.series[src].slice(-maxSamples);

    let frequencies, magnitudes;
    try {
      ({ frequencies, magnitudes } = state.analyzer.compute(values));
    } catch {
      return;
    }

    api.ingest({
      measurementName: outMeas,
      clearMeasurement: true,
      time: false,
      points: { timestamps: frequencies, series: { [outSeries]: magnitudes } }
    });
  }
};
