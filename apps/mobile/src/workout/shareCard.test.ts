import { describe, expect, it } from 'vitest';

import { exerciseSetChanges, type WorkingSet } from '../progress/setBySet.js';
import {
  bestSet,
  changeOf,
  shareCardModel,
  type ShareCardComparison,
  type ShareCardExercise,
  type ShareCardInput,
  type ShareCardLabels,
} from './shareCard.js';

/** The isolate marks around signed numbers and sets, removed so the tests read plainly. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/[⁦⁩]/g, '');

const labels: ShareCardLabels = {
  minutes: 'min',
  sets: 'sets',
  satisfaction: 'satisfaction',
  formatSet: (set) =>
    set.reps === null ? null : set.weightKg ? `${set.weightKg}×${set.reps}` : `${set.reps} reps`,
  previous: (set) => `last ${set}`,
  sameAsBefore: 'same',
  reps: (value) => `${value} reps`,
  setsChange: (value) => `${value} sets`,
  setCount: (count) => `${count} sets`,
  satisfactionFrom: (then) => `from ${then}`,
  comparedWith: (when) => `vs ${when}`,
  progressedTitle: 'Progressed',
  pushTitle: 'To push',
  newTitle: 'New',
  exercisesTitle: 'Exercises',
};

const lift = (weightKg: number | null, reps: number): WorkingSet => ({
  weightKg,
  reps,
  durationSeconds: null,
  distanceM: null,
});
const times = (n: number, set: WorkingSet) => Array.from({ length: n }, () => set);

const ex = (key: string, sets: WorkingSet[]): ShareCardExercise => ({ key, name: key, sets });

/** A workout and the previous one of its kind, compared the way the app compares them. */
function compared(now: ShareCardExercise[], before: ShareCardExercise[], over: Partial<ShareCardComparison> = {}) {
  const changes = exerciseSetChanges(
    now.map((e) => ({ exerciseKey: e.key, sets: [...e.sets] })),
    before.map((e) => ({ exerciseKey: e.key, sets: [...e.sets] })),
  );
  return { when: '5.11', satisfaction: null, changes, ...over };
}

const workout = (over: Partial<ShareCardInput> = {}): ShareCardInput => ({
  title: 'Legs',
  when: 'Thursday',
  minutes: 52,
  sets: 18,
  satisfaction: null,
  exercises: [],
  comparison: null,
  ...over,
});

describe('how much an exercise moved', () => {
  it('is the weight of the best set as a percentage, first', () => {
    expect(plain(changeOf(times(3, lift(85, 8)), times(3, lift(80, 8)), labels))).toBe('+6%');
    expect(plain(changeOf(times(3, lift(40, 8)), times(3, lift(45, 8)), labels))).toBe('−11%');
  });

  it('never rounds a real change of weight to nothing', () => {
    expect(plain(changeOf([lift(101, 5)], [lift(100, 5)], labels))).toBe('+1%');
  });

  it('then the reps at the same weight, then the number of sets, then nothing', () => {
    expect(plain(changeOf([lift(180, 12)], [lift(180, 10)], labels))).toBe('+2 reps');
    expect(plain(changeOf([lift(null, 15)], [lift(null, 12)], labels))).toBe('+3 reps');
    expect(plain(changeOf(times(4, lift(60, 10)), times(3, lift(60, 10)), labels))).toBe('+1 sets');
    expect(changeOf(times(3, lift(60, 10)), times(3, lift(60, 10)), labels)).toBe('=');
  });

  it('keeps a signed number left-to-right inside Hebrew', () => {
    expect(changeOf([lift(85, 8)], [lift(80, 8)], labels)).toBe('⁦+6%⁩');
  });

  it('reads the best set as the heaviest, or without weights the most reps', () => {
    expect(bestSet([lift(80, 10), lift(85, 6), lift(85, 8)])).toEqual(lift(85, 8));
    expect(bestSet([lift(null, 12), lift(null, 15)])).toEqual(lift(null, 15));
    expect(bestSet([])).toBeNull();
  });
});

describe('the card against the previous workout of the kind', () => {
  const now = [
    ex('Squat', times(3, lift(85, 8))),
    ex('Curl', times(3, lift(40, 8))),
    ex('Calf', times(3, lift(60, 15))),
    ex('Lunge', times(2, lift(20, 10))),
  ];
  const before = [
    ex('Squat', times(3, lift(80, 8))),
    ex('Curl', times(3, lift(45, 8))),
    ex('Calf', times(3, lift(60, 15))),
  ];

  it('progressed first, then what to push — down before same — then new', () => {
    const model = shareCardModel(workout({ exercises: now, comparison: compared(now, before) }), labels);
    expect(model.groups.map((g) => [g.key, g.rows.map((r) => r.name)])).toEqual([
      ['progressed', ['Squat']],
      ['push', ['Curl', 'Calf']],
      ['new', ['Lunge']],
    ]);
    expect(model.counts).toEqual({ up: 1, same: 1, down: 1 });
    expect(model.comparedWith).toBe('vs 5.11');
  });

  it('puts this time’s best set beside last time’s, and how much it moved', () => {
    const model = shareCardModel(workout({ exercises: now, comparison: compared(now, before) }), labels);
    const rows = Object.fromEntries(model.groups.flatMap((g) => g.rows).map((r) => [r.name, r]));
    expect(plain(rows.Squat!.detail)).toBe('85×8 · last 80×8');
    expect(plain(rows.Squat!.change)).toBe('+6%');
    expect(plain(rows.Curl!.change)).toBe('−11%');
    expect(plain(rows.Calf!.detail)).toBe('60×15 · same');
    expect(rows.Calf!.change).toBe('=');
    // New: what was done, and nothing to set it against.
    expect(plain(rows.Lunge!.detail)).toBe('20×10');
    expect(rows.Lunge!.change).toBeNull();
  });

  it('says how the satisfaction stood against last time, in the tile', () => {
    const up = shareCardModel(
      workout({ satisfaction: 8, exercises: now, comparison: compared(now, before, { satisfaction: 6 }) }),
      labels,
    );
    expect(up.stats.find((s) => s.key === 'satisfaction')).toEqual({
      key: 'satisfaction',
      value: '8',
      unit: '/10',
      label: 'from 6',
      direction: 'up',
    });
    const alone = shareCardModel(workout({ satisfaction: 8 }), labels);
    expect(alone.stats.find((s) => s.key === 'satisfaction')).toMatchObject({
      label: 'satisfaction',
      direction: undefined,
    });
  });
});

describe('the card with nothing to compare with', () => {
  it('lists what was done by its best set, and nothing counted', () => {
    const model = shareCardModel(
      workout({ exercises: [ex('Squat', [lift(100, 5)]), ex('Row', [])] }),
      labels,
    );
    expect(model.counts).toBeNull();
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]!.rows.map((r) => [r.name, plain(r.detail), r.change])).toEqual([
      ['Squat', '100×5', null],
    ]);
  });

  it('leaves out the numbers there are none of', () => {
    expect(shareCardModel(workout(), labels).stats.map((s) => s.key)).toEqual(['minutes', 'sets']);
    expect(shareCardModel(workout({ minutes: null, sets: 0 }), labels).stats).toEqual([]);
  });
});
