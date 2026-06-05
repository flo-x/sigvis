"use strict";
/**
 * Sliding-window median factory.
 *
 * Returns a stateful median instance that processes values incrementally.
 * Store the instance in `state` so it persists across processor runs:
 *
 *   if (!state.median) state.median = dsp.median(5);
 *   const filtered = state.median.update(newValues);
 *
 * @param {number} windowSize - Number of samples in the sliding window (positive integer).
 *   Larger windows → stronger noise rejection, more lag.
 *   Smaller windows → faster response, less smoothing.
 *   Odd values are conventional (the median is unambiguous); even values are accepted.
 */
function createMedian(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new Error("dsp.median: windowSize must be a positive integer.");
  }

  let buf = [];

  return {
    /**
     * Process an array of new values through the sliding-window median.
     * @param {number[]} values
     * @returns {number[]} Filtered values, same length as input.
     */
    update(values) {
      if (!Array.isArray(values) || values.length === 0) return [];
      return values.map((v) => {
        buf.push(v);
        if (buf.length > windowSize) buf.shift();
        const sorted = buf.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        // For even-length windows average the two middle elements.
        return sorted.length % 2 === 1
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;
      });
    },

    /** Reset the internal buffer (e.g. after a gap in data). */
    reset() {
      buf = [];
    },

    /** Current window contents (copy). */
    get buffer() {
      return buf.slice();
    }
  };
}

module.exports = { createMedian };
