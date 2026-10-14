// Where `value` falls among OpenDota benchmark points [{percentile, value}] (0..1), interpolated.
export function percentileOf(points, value) {
  if (!Array.isArray(points) || !points.length || typeof value !== 'number') return null;
  const pts = [...points].sort((a, b) => a.value - b.value);
  if (value <= pts[0].value) return pts[0].value > 0 ? Math.max(0, (pts[0].percentile * value) / pts[0].value) : 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (value <= b.value) {
      const f = b.value === a.value ? 1 : (value - a.value) / (b.value - a.value);
      return a.percentile + f * (b.percentile - a.percentile);
    }
  }
  return pts[pts.length - 1].percentile;
}
