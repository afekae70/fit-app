/**
 * Calories burned by a cardio effort, estimated the way exercise physiology does it.
 *
 * `kcal = MET × 3.5 × bodyweight(kg) / 200 × minutes` — the standard conversion from the
 * Compendium of Physical Activities. A MET is a multiple of resting metabolism: walking briskly
 * is about 4, running is about 10, and the number depends far more on how fast you are moving
 * than on what the movement is called.
 *
 * So speed leads where it is known: a walk at 3 km/h and a walk at 6.5 km/h are not the same
 * training, and reading the pace off the distance the user entered is more honest than one fixed
 * number per exercise. Where there is no distance yet, the activity's own resting-ish default
 * stands in.
 *
 * It is an estimate and it is called one on screen. Without a heart rate or a power meter no
 * phone knows what someone actually burned, and a number to one decimal place would be claiming
 * a precision that does not exist — the point is whether today was more than last time.
 */

export type CardioKind = 'walk' | 'run' | 'cycle' | 'swim' | 'row' | 'other';

/** Which family an exercise belongs to, by its catalogue key. */
export function cardioKind(exerciseKey: string): CardioKind {
  const key = exerciseKey.toLowerCase();
  if (key.includes('swim')) return 'swim';
  if (key.includes('row')) return 'row';
  if (key.includes('cycl') || key.includes('bike')) return 'cycle';
  if (key.includes('run')) return 'run';
  if (key.includes('walk') || key.includes('hike') || key.includes('ruck')) return 'walk';
  return 'other';
}

/** The default when nothing has been entered but the clock — a moderate effort of its kind. */
const BASE_MET: Record<CardioKind, number> = {
  walk: 3.5,
  run: 9.8,
  cycle: 7.5,
  swim: 7,
  row: 7,
  other: 6,
};

/**
 * The MET for an effort, from its speed where there is one.
 *
 * The bands are the compendium's own, rounded to the boundaries people actually train at:
 * a stroll, a walk, a brisk walk, a jog, a run. Between them it interpolates, so entering one
 * more kilometre never makes the estimate jump.
 */
export function cardioMet(kind: CardioKind, speedKmh: number | null): number {
  if (speedKmh === null || speedKmh <= 0) return BASE_MET[kind];

  const bands: Record<CardioKind, [number, number][]> = {
    // [km/h, MET]
    walk: [
      [3, 2.8],
      [4.5, 3.5],
      [5.5, 4.3],
      [6.5, 5],
      [8, 7],
    ],
    run: [
      [8, 8.3],
      [10, 9.8],
      [12, 11.8],
      [14, 13.5],
      [16, 16],
    ],
    cycle: [
      [14, 5.8],
      [19, 7.5],
      [22, 8.5],
      [26, 10],
      [30, 12],
    ],
    swim: [
      [2, 6],
      [3, 8.3],
      [4, 10],
      [5, 11.5],
      [6, 13.8],
    ],
    row: [
      [6, 4.8],
      [9, 7],
      [12, 8.5],
      [15, 12],
      [18, 14],
    ],
    other: [
      [5, 4],
      [10, 6],
      [15, 8],
      [20, 10],
      [25, 12],
    ],
  };

  const band = bands[kind];
  const first = band[0]!;
  const last = band[band.length - 1]!;
  if (speedKmh <= first[0]) return first[1];
  if (speedKmh >= last[0]) return last[1];

  for (let i = 1; i < band.length; i += 1) {
    const [upperSpeed, upperMet] = band[i]!;
    const [lowerSpeed, lowerMet] = band[i - 1]!;
    if (speedKmh <= upperSpeed) {
      const share = (speedKmh - lowerSpeed) / (upperSpeed - lowerSpeed);
      return Math.round((lowerMet + share * (upperMet - lowerMet)) * 10) / 10;
    }
  }
  return last[1];
}

/**
 * Whole calories burned, or null when the body weight is unknown — an estimate that has to
 * invent half its own inputs is not an estimate, and a made-up 70 kg would be wrong for most
 * people by enough to notice.
 */
export function caloriesBurned(
  met: number,
  bodyWeightKg: number | null,
  seconds: number,
): number | null {
  if (!bodyWeightKg || bodyWeightKg <= 0 || seconds <= 0) return null;
  const minutes = seconds / 60;
  return Math.round((met * 3.5 * bodyWeightKg) / 200 * minutes);
}
