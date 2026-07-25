/**
 * Strength metrics: estimated 1RM, volume load, and progression/stall detection.
 *
 * These run in the API (and mirrored in SQL for bulk queries) to produce the compact digest
 * handed to the AI coach. The model is never asked to do this arithmetic over raw set rows —
 * LLMs are unreliable at multi-step arithmetic across hundreds of values, and it would burn
 * a large number of input tokens to do badly what Postgres does exactly.
 */

/**
 * Estimated one-rep max via the Epley formula:  weight × (1 + reps / 30)
 *
 * Two caveats worth respecting:
 *  - At 1 rep the formula returns weight × 1.033, which is wrong by definition. A single rep
 *    at a given weight *is* a 1RM, so that case returns the weight unchanged.
 *  - Accuracy degrades above roughly 12 reps. `epley1RM` still computes a value there
 *    (callers often need something), but `isReliableRepRange` lets progression logic exclude
 *    high-rep sets rather than treating a 20-rep estimate as comparable to a 5-rep one.
 */
export function epley1RM(weightKg: number, reps: number): number {
  if (weightKg < 0) throw new RangeError('weightKg must not be negative');
  if (reps < 1) throw new RangeError('reps must be at least 1');
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Whether a rep count falls in the range where 1RM estimation is trustworthy. */
export function isReliableRepRange(reps: number): boolean {
  return reps >= 1 && reps <= 12;
}

/** Volume load for a single set: weight × reps. The standard tonnage measure. */
export function volumeLoad(weightKg: number, reps: number): number {
  return weightKg * reps;
}

export interface WorkingSet {
  weightKg: number;
  reps: number;
  isWarmup?: boolean;
}

/** Total volume load across sets, excluding warmups. */
export function sessionVolumeLoad(sets: readonly WorkingSet[]): number {
  return sets
    .filter((s) => !s.isWarmup)
    .reduce((total, s) => total + volumeLoad(s.weightKg, s.reps), 0);
}

/** Best estimated 1RM across sets, excluding warmups and unreliable high-rep sets. */
export function bestEstimated1RM(sets: readonly WorkingSet[]): number | null {
  const candidates = sets
    .filter((s) => !s.isWarmup && isReliableRepRange(s.reps))
    .map((s) => epley1RM(s.weightKg, s.reps));
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export interface SessionStrengthPoint {
  /** When the session happened — used only for ordering. */
  date: Date;
  bestE1rmKg: number;
  totalVolumeLoad: number;
}

export interface StallAssessment {
  /** True when no session in the lookback window beat the best e1RM before it. */
  isStalling: boolean;
  /** Sessions since the best e1RM was set. 0 means the most recent session is the best. */
  sessionsSinceBest: number;
  bestE1rmKg: number | null;
  currentE1rmKg: number | null;
  /** Change in best e1RM from the first to the last session in the window, in kg. */
  e1rmDeltaKg: number | null;
  /** Least-squares slope of volume load per session. Negative means volume is falling. */
  volumeSlopePerSession: number | null;
}

/**
 * Assess whether an exercise is progressing or stalling.
 *
 * "Stalling" is defined as: within the last `lookbackSessions` sessions, the most recent
 * session did not set a new best estimated 1RM, and at least `minStallSessions` sessions have
 * passed since the best was set. Requiring a minimum guards against calling a stall on the
 * basis of one ordinary session after a personal best, which is normal training variance
 * rather than a plateau.
 *
 * `points` may be in any order; it is sorted by date internally.
 */
export function assessStall(
  points: readonly SessionStrengthPoint[],
  { lookbackSessions = 8, minStallSessions = 3 } = {},
): StallAssessment {
  const empty: StallAssessment = {
    isStalling: false,
    sessionsSinceBest: 0,
    bestE1rmKg: null,
    currentE1rmKg: null,
    e1rmDeltaKg: null,
    volumeSlopePerSession: null,
  };
  if (points.length === 0) return empty;

  const window = [...points]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-lookbackSessions);

  const first = window[0];
  const last = window[window.length - 1];
  if (!first || !last) return empty;

  let bestIndex = 0;
  for (let i = 1; i < window.length; i++) {
    const candidate = window[i];
    const incumbent = window[bestIndex];
    if (candidate && incumbent && candidate.bestE1rmKg > incumbent.bestE1rmKg) {
      bestIndex = i;
    }
  }

  const best = window[bestIndex];
  const sessionsSinceBest = window.length - 1 - bestIndex;

  return {
    isStalling: sessionsSinceBest >= minStallSessions,
    sessionsSinceBest,
    bestE1rmKg: best?.bestE1rmKg ?? null,
    currentE1rmKg: last.bestE1rmKg,
    e1rmDeltaKg: last.bestE1rmKg - first.bestE1rmKg,
    volumeSlopePerSession: leastSquaresSlope(window.map((p) => p.totalVolumeLoad)),
  };
}

/**
 * Least-squares slope of a series against its index (0, 1, 2, ...).
 * Returns null for fewer than two points, where a slope is undefined.
 */
export function leastSquaresSlope(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) return null;

  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i];
    if (y === undefined) continue;
    const dx = i - meanX;
    numerator += dx * (y - meanY);
    denominator += dx * dx;
  }

  return denominator === 0 ? null : numerator / denominator;
}
