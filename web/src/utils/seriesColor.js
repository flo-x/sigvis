/**
 * Client-side series color utilities.
 *
 * Color is not sent by the server — it is determined here based on the series
 * compound ID ("measurementName:seriesName"), with per-widget overrides stored
 * in widget.config.seriesColors.
 */

// Tableau 10 — perceptually distinct, colorblind-friendly categorical palette.
export const PALETTE = [
  "#4E79A7", // blue
  "#F28E2B", // orange
  "#E15759", // red
  "#76B7B2", // teal
  "#59A14F", // green
  "#EDC948", // yellow
  "#B07AA1", // purple
  "#FF9DA7", // pink
  "#9C755F", // brown
  "#BAB0AC"  // gray
];

/**
 * Return the default palette color for a series compound ID.
 * Deterministic: same ID always yields the same color.
 * @param {string} id  e.g. "cpu_like:value"
 * @returns {string}   hex color string
 */
function colorForId(id) {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
    hash = hash >>> 0; // keep 32-bit unsigned
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Resolve the display color for a series, applying any widget-level override.
 * @param {string} id        compound series ID
 * @param {object} overrides widget.config.seriesColors map
 * @returns {string}         hex color string
 */
function resolveColor(id, overrides) {
  return (overrides && overrides[id]) ? overrides[id] : colorForId(id);
}

export { colorForId, resolveColor };
