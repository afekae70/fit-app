/**
 * The arithmetic behind setting two progress photos side by side: which day a picked photo was
 * taken on, how far apart two are, and what the scale said around each.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day a photo was taken on, from its EXIF date ("2026:07:14 08:31:02"); null if there is none. */
export function exifDay(
  exif: Record<string, unknown> | null | undefined,
  today: string,
): string | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  // A camera with its clock unset says 1970 or 2000; one ahead of itself says next year.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  if (day < '2005-01-01' || day > today) return null;
  return day;
}

/** Whole days from one YYYY-MM-DD to another; positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** How far from a photo's day a weigh-in may be and still be shown beside it. */
export const NEAR_DAYS = 7;

/**
 * The weigh-in closest to a day, within a week either side; null if there was none that close.
 * `measuredAt` is an ISO timestamp, compared by its local day as the app logs it.
 */
export function weightNear(
  readings: readonly { measuredAt: string; weightKg: number | null }[],
  day: string,
  localDay: (iso: string) => string,
): number | null {
  let best: { distance: number; weightKg: number } | null = null;
  for (const reading of readings) {
    if (reading.weightKg === null) continue;
    const distance = Math.abs(daysBetween(day, localDay(reading.measuredAt)));
    if (distance > NEAR_DAYS) continue;
    if (!best || distance < best.distance) best = { distance, weightKg: reading.weightKg };
  }
  return best?.weightKg ?? null;
}

/** The earlier of two photos first, as the comparison reads: before, then after. */
export function inOrder<T extends { takenOn: string }>(a: T, b: T): [T, T] {
  return a.takenOn <= b.takenOn ? [a, b] : [b, a];
}
