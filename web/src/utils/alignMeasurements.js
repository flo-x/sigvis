/**
 * Align multiple measurement groups into a single flat { timestamps, series[] } response
 * compatible with TimeSeriesChart. Each measurement may have its own timestamps array;
 * when multiple measurements are present, a union of all timestamps is used and gaps
 * are filled with null.
 *
 * Extra properties on each series object (e.g. color, width, paths) are passed
 * through to the output unchanged.
 *
 * @param {{ measurementName: string, timestamps: number[], series: { name: string, unit?: string, color?: string, values: (number|null)[] }[] }[]} measurements
 * @returns {{ timestamps: number[], series: { id: string, name: string, unit: string, color: string, values: (number|null)[] }[] }}
 */
function alignMeasurements(measurements) {
  if (measurements.length === 0) {
    return { timestamps: [], series: [] };
  }

  // Collect all unique timestamps across all measurements.
  const uniqueTs = new Set();
  for (const m of measurements) {
    for (const ts of m.timestamps) {
      uniqueTs.add(ts);
    }
  }
  const timestamps = Array.from(uniqueTs).sort((a, b) => a - b);

  const series = [];
  for (const m of measurements) {
    const byTs = new Map(m.timestamps.map((ts, idx) => [ts, idx]));
    for (const s of m.series) {
      series.push({
        ...s, // pass through extra props (color, width, paths, unit, …)
        id: `${m.measurementName}:${s.name}`,
        name: `${m.measurementName} / ${s.name}`,
        unit: s.unit ?? "",
        values: timestamps.map((ts) => {
          const idx = byTs.get(ts);
          return idx !== undefined ? s.values[idx] : null;
        })
      });
    }
  }

  return { timestamps, series };
}

export { alignMeasurements };
