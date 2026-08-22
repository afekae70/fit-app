/**
 * Turning training history into something a spreadsheet will accept.
 *
 * Everything the app knows lives in SQLite on the phone and in Supabase. Neither is somewhere a
 * person can open a column of numbers and sort it, and neither is a backup they control. This is
 * the way out.
 *
 * ## One row per set
 *
 * Not one row per workout. A set is the atom of this data — the thing with a weight, a rep count
 * and a rating — and a spreadsheet can collapse rows into any summary the reader wants. Going the
 * other way, from a summarised row back to the sets inside it, is impossible.
 *
 * The columns that identify the set (date, workout, gym, exercise) repeat on every row, which
 * looks wasteful and is exactly what a pivot table needs.
 *
 * ## Escaping
 *
 * Exercise names are Hebrew, workouts are named by hand, and gyms are free text — so a comma or
 * a quote in the data is a matter of time rather than a hypothetical. A field is quoted whenever
 * it contains a comma, a quote, or a line break, and quotes inside are doubled, which is what
 * RFC 4180 asks for and what every spreadsheet actually implements.
 */

/** A single field, escaped only when it has to be. */
export function escapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** One row, already escaped. */
export function toRow(fields: readonly (string | number | null | undefined)[]): string {
  return fields.map(escapeField).join(',');
}

/**
 * A whole document.
 *
 * CRLF between rows, which RFC 4180 specifies and which matters in practice: a bare newline is
 * read by some Windows spreadsheet importers as part of the previous field rather than the end
 * of the record, and the result is one long broken row rather than an error.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return [toRow(header), ...rows.map(toRow)].join('\r\n');
}

export interface ExportedSet {
  startedAt: string;
  workout: string | null;
  gym: string | null;
  exercise: string;
  setIndex: number;
  isWarmup: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  toFailure: number;
  doneAt: string | null;
}

export const SET_COLUMNS = [
  'date',
  'workout',
  'gym',
  'exercise',
  'set',
  'kind',
  'weight_kg',
  'reps',
  'rpe',
  'to_failure',
  'completed',
] as const;

/**
 * The date as `YYYY-MM-DD`, taken from the stored ISO timestamp.
 *
 * Sliced rather than parsed through `Date`, deliberately. Every timestamp in this database is
 * already an ISO string, and putting it through a Date only to format it again would shift the
 * day across a timezone boundary for anyone training late in the evening — which is when a
 * surprising amount of training happens.
 */
export function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export function setsToCsv(sets: readonly ExportedSet[]): string {
  return toCsv(
    SET_COLUMNS,
    sets.map((set) => [
      isoDate(set.startedAt),
      set.workout,
      set.gym,
      set.exercise,
      set.setIndex,
      // Words rather than 1/0: a column of bare ones is unreadable next to a column of reps, and
      // the reader should not have to remember which way round the flag went.
      set.isWarmup === 1 ? 'warmup' : 'working',
      set.weightKg,
      set.reps,
      set.rpe,
      set.toFailure === 1 ? 'yes' : '',
      set.doneAt === null ? '' : 'yes',
    ]),
  );
}

export interface ExportedMetric {
  measuredAt: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  source: string | null;
}

export const METRIC_COLUMNS = ['date', 'weight_kg', 'body_fat_pct', 'source'] as const;

export function metricsToCsv(metrics: readonly ExportedMetric[]): string {
  return toCsv(
    METRIC_COLUMNS,
    metrics.map((m) => [isoDate(m.measuredAt), m.weightKg, m.bodyFatPct, m.source]),
  );
}
