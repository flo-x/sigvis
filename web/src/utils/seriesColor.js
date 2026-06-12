/**
 * Client-side series color utilities.
 *
 * Color is not sent by the server — it is determined here based on the order
 * in which series appear in the widget's seriesIds array, with per-widget
 * overrides stored in widget.config.seriesColors.
 *
 * All color assignment is palette-based (sequential Tableau 10), matching
 * exactly the logic the config panel uses. Hash-based fallbacks are intentionally
 * absent to keep colors consistent between the chart and the config panel.
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
 * Return the first PALETTE color not present in `usedColors`.
 * Cycles through the palette when all 10 are taken.
 * @param {Set<string>} usedColors
 * @returns {string}
 */
export function firstAvailablePaletteColor(usedColors) {
  for (const color of PALETTE) {
    if (!usedColors.has(color)) { return color; }
  }
  return PALETTE[usedColors.size % PALETTE.length];
}

/**
 * Compute the effective display color for every series in `seriesIds`.
 *
 * - Series with an explicit entry in `overrides` use that color.
 * - Series without an override receive the first Tableau-10 palette color
 *   not already taken by an override or an earlier auto-assigned series,
 *   in the order they appear in `seriesIds`.
 *
 * This guarantees that the chart and the config panel always agree on colors,
 * regardless of whether the user has ever opened the config panel.
 *
 * @param {string[]} seriesIds  Ordered list of compound series IDs.
 * @param {object}   overrides  widget.config.seriesColors map (may be empty).
 * @returns {Object.<string, string>}  id → hex color string
 */
export function resolveColors(seriesIds, overrides) {
  const used   = new Set(Object.values(overrides || {}));
  const result = {};
  for (const id of seriesIds) {
    if (overrides && overrides[id]) {
      result[id] = overrides[id];
    } else {
      const color = firstAvailablePaletteColor(used);
      result[id]  = color;
      used.add(color);
    }
  }
  return result;
}
