"use strict";
/**
 * DSP namespace exposed to processor scripts via require('dsp').
 *
 * ---------------------------------------------------------------------------
 * EMA — stateful exponential moving average
 * ---------------------------------------------------------------------------
 * Store the instance in `state` so it persists across runs:
 *
 *   const dsp = require('dsp');
 *   if (!state.ema) state.ema = dsp.ema(0.1);  // alpha = 0.1
 *   const smoothed = state.ema.update(newValues);
 *
 * ---------------------------------------------------------------------------
 * spectrum — stateful spectrum analyser (FFT-based)
 * ---------------------------------------------------------------------------
 * Create once, call compute() on every tick:
 *
 *   if (!state.sp) {
 *     state.sp = dsp.spectrum({
 *       sampleRateHz:  100,         // Hz; omit for normalised [0, 0.5] output
 *       window:        'hann',      // 'rect' | 'hann' | 'hamming' | 'blackman'
 *       scale:         'magnitude', // 'magnitude' | 'db'
 *       averaging:     8            // EMA frames (1 = no averaging)
 *     });
 *   }
 *   const { frequencies, magnitudes } = state.sp.compute(values);
 *
 */
const { createEma }      = require("./ema");
const { createSpectrum } = require("./fft");
const { createMedian }   = require("./median");

module.exports = {
  /** Create a stateful EMA filter. @see ema.js */
  ema: createEma,

  /**
   * Create a stateful spectrum analyser (FFT-based).
   * @see fft.js
   */
  spectrum: createSpectrum,

  /** Create a stateful sliding-window median filter. @see median.js */
  median: createMedian
};
