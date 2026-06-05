"use strict";

const { fft, util: { fftMag, fftFreq } } = require("fft-js");

// ---------------------------------------------------------------------------
// Window functions
// ---------------------------------------------------------------------------

const WINDOWS = {
  rect(n) {
    return new Float64Array(n).fill(1);
  },
  hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  },
  hamming(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  },
  blackman(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      w[i] =
        0.42 -
        0.5  * Math.cos((2 * Math.PI * i) / (n - 1)) +
        0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    }
    return w;
  }
};

// Minimum dB value used as a floor for zero-magnitude bins.  Keeps all output
// values finite so they pass the ingestion validator.
const DB_FLOOR = -120;

// ---------------------------------------------------------------------------
// Internal: run a single FFT frame on an already-windowed+padded Float64Array
// ---------------------------------------------------------------------------
function _computeFrame(padded, sampleRateHz) {
  const phasors     = fft(Array.from(padded));
  const magnitudes  = fftMag(phasors);
  const frequencies = fftFreq(phasors, sampleRateHz);
  return {
    frequencies: Array.from(frequencies),
    magnitudes:  Array.from(magnitudes)
  };
}

// ---------------------------------------------------------------------------
// Stateful FFT analyser
// ---------------------------------------------------------------------------

class SpectrumAnalyzer {
  /**
   * @param {object} opts
   * @param {number}  [opts.sampleRateHz=1]    Sample rate in Hz (use 1 for normalised 0–0.5 output).
   * @param {'rect'|'hann'|'hamming'|'blackman'} [opts.window='rect']
   * @param {'magnitude'|'db'} [opts.scale='magnitude']
   * @param {number}  [opts.averaging=1]        EMA smoothing over frames. 1 = no averaging.
   */
  constructor(opts = {}) {
    const { sampleRateHz = 1, window: win = "rect", scale = "magnitude", averaging = 1 } = opts;

    if (!WINDOWS[win]) {
      throw new Error(`dsp.spectrum: unknown window "${win}". Valid: ${Object.keys(WINDOWS).join(", ")}.`);
    }
    if (!["magnitude", "db"].includes(scale)) {
      throw new Error(`dsp.spectrum: unknown scale "${scale}". Valid: magnitude, db.`);
    }
    if (typeof sampleRateHz !== "number" || sampleRateHz <= 0) {
      throw new Error("dsp.spectrum: sampleRateHz must be a positive number.");
    }
    if (typeof averaging !== "number" || averaging < 1) {
      throw new Error("dsp.spectrum: averaging must be >= 1.");
    }

    this._sampleRateHz = sampleRateHz;
    this._windowFn     = WINDOWS[win];
    this._scale        = scale;
    this._alpha        = averaging === 1 ? 1 : 2 / (averaging + 1);  // EMA coefficient
    this._smoothed     = null; // Float64Array of averaged magnitudes (initialised on first call)
    this._frequencies  = null; // cached (doesn't change between frames)
  }

  /**
   * Process a new frame of samples.
   * @param {number[]} values  Real-valued input samples.
   * @returns {{ frequencies: number[], magnitudes: number[] }}
   */
  compute(values) {
    if (!Array.isArray(values) || values.length < 2) {
      throw new Error("dsp.spectrum: values must be an array with at least 2 elements.");
    }

    // Zero-pad to next power of 2.
    const n = Math.pow(2, Math.ceil(Math.log2(values.length)));

    // Apply window to the original samples (not the zero-padded region).
    // Accumulate the window sum so we can use it for amplitude normalisation.
    const win       = this._windowFn(values.length);
    const padded    = new Float64Array(n);
    let   windowSum = 0;
    for (let i = 0; i < values.length; i++) {
      padded[i]  = values[i] * win[i];
      windowSum += win[i];
    }

    const { frequencies, magnitudes } = _computeFrame(padded, this._sampleRateHz);

    // Normalise by windowSum/2 so that the output is window-invariant.
    // Convention: one-sided amplitude — a real sinusoid of amplitude A yields
    // a peak magnitude of A at its positive-frequency bin.
    // Example: unit sinusoid (A=1) → peak ≈ 1.0 regardless of window or N.
    const normalized = magnitudes.map((m) => (2 * m) / windowSum);

    // Convert to dB if requested (applied to normalised magnitudes; 0 dB = amplitude 1).
    const scaled = this._scale === "db"
      ? normalized.map((m) => (m > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(m)) : DB_FLOOR))
      : normalized;

    // Cache frequencies (bin layout is stable as long as N and sampleRate don't change).
    this._frequencies = frequencies;

    // If the FFT size changed (different input length), discard the old accumulator
    // so the EMA restarts cleanly rather than mixing bins from different resolutions.
    if (this._smoothed !== null && this._smoothed.length !== scaled.length) {
      this._smoothed = null;
    }

    // Apply per-bin EMA averaging.
    if (this._alpha === 1 || this._smoothed === null) {
      this._smoothed = new Float64Array(scaled);
    } else {
      for (let i = 0; i < this._smoothed.length; i++) {
        this._smoothed[i] =
          this._alpha * scaled[i] + (1 - this._alpha) * this._smoothed[i];
      }
    }

    return {
      frequencies: Array.from(this._frequencies),
      magnitudes:  Array.from(this._smoothed)
    };
  }

  /**
   * Reset the spectral averager (clears accumulated history).
   * Called automatically when the input length changes; also callable explicitly.
   */
  reset() {
    this._smoothed    = null;
    this._frequencies = null;
  }

  /**
   * Change one or more configuration options at runtime.
   * Any option not supplied keeps its current value.
   * The spectral accumulator is reset so the next compute() starts fresh.
   *
   * @param {object} opts  Same keys as the constructor: sampleRateHz, window, scale, averaging.
   */
  configure(opts = {}) {
    if (opts.window !== undefined) {
      if (!WINDOWS[opts.window]) {
        throw new Error(`dsp.spectrum: unknown window "${opts.window}". Valid: ${Object.keys(WINDOWS).join(", ")}.`);
      }
      this._windowFn = WINDOWS[opts.window];
    }
    if (opts.scale !== undefined) {
      if (!["magnitude", "db"].includes(opts.scale)) {
        throw new Error(`dsp.spectrum: unknown scale "${opts.scale}". Valid: magnitude, db.`);
      }
      this._scale = opts.scale;
    }
    if (opts.sampleRateHz !== undefined) {
      if (typeof opts.sampleRateHz !== "number" || opts.sampleRateHz <= 0) {
        throw new Error("dsp.spectrum: sampleRateHz must be a positive number.");
      }
      this._sampleRateHz = opts.sampleRateHz;
    }
    if (opts.averaging !== undefined) {
      if (typeof opts.averaging !== "number" || opts.averaging < 1) {
        throw new Error("dsp.spectrum: averaging must be >= 1.");
      }
      this._alpha = opts.averaging === 1 ? 1 : 2 / (opts.averaging + 1);
    }
    // Always reset the accumulator — old history is invalid after any config change.
    this.reset();
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a stateful spectrum analyser.
 *
 *   const dsp = require('dsp');
 *   if (!state.sp) state.sp = dsp.spectrum({ sampleRateHz: 100, window: 'hann', averaging: 8 });
 *   const { frequencies, magnitudes } = state.sp.compute(values);
 *
 * @param {object} [opts]
 * @returns {SpectrumAnalyzer}
 */
function createSpectrum(opts) {
  return new SpectrumAnalyzer(opts ?? {});
}

module.exports = { createSpectrum, SpectrumAnalyzer };
