"use strict";
/**
 * Exponential Moving Average (EMA) factory.
 *
 * Returns a stateful EMA instance that processes values incrementally.
 * Store the instance in `state` so it persists across processor runs:
 *
 *   if (!state.ema) state.ema = dsp.ema(0.1);
 *   const smoothed = state.ema.update(newValues);
 *
 * @param {number} alpha - Smoothing factor in (0, 1).
 *   Higher values → faster response, less smoothing.
 *   Lower values  → slower response, more smoothing.
 *   Equivalent time constant (in samples): τ ≈ 1 / alpha.
 */
function createEma(alpha) {
  if (typeof alpha !== "number" || alpha <= 0 || alpha >= 1) {
    throw new Error("dsp.ema: alpha must be a number strictly between 0 and 1.");
  }

  let acc = undefined;

  return {
    /**
     * Process an array of new values through the EMA.
     * @param {number[]} values
     * @returns {number[]} Smoothed values, same length as input.
     */
    update(values) {
      if (!Array.isArray(values) || values.length === 0) return [];
      return values.map((v) => {
        if (acc === undefined) {
          acc = v;
        } else {
          acc = alpha * v + (1 - alpha) * acc;
        }
        return acc;
      });
    },

    /** Reset the internal accumulator (e.g. after a gap in data). */
    reset() {
      acc = undefined;
    },

    /** Current accumulator value (last output), or undefined before the first update. */
    get value() {
      return acc;
    }
  };
}

module.exports = { createEma };
