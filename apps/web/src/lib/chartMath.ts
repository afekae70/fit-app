/** Axis arithmetic for the charts, kept apart from the drawing so it can be tested alone. */

/** Round numbers for an axis: 0, 2K, 4K… */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

/** 1,284 → 1.3K, for axis ticks. */
export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1000) return `${trim(value / 1000)}K`;
  return trim(value);
}
const trim = (value: number) => String(Math.round(value * 10) / 10);
