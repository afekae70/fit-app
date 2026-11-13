import { describe, expect, it } from 'vitest';

import { NO_TALLY, type Tally, type Verdict } from '../progress/setBySet.js';
import {
  CARD_EXERCISE_LIMIT,
  shareCardModel,
  type ShareCardComparison,
  type ShareCardInput,
  type ShareCardLabels,
} from './shareCard.js';

const labels: ShareCardLabels = {
  minutes: 'min',
  sets: 'sets',
  satisfaction: 'satisfaction',
  satisfactionValue: (value) => `${value}/10`,
  setCount: (count) => `${count} sets`,
  more: (count) => `and ${count} more`,
  verdict: { up: 'up', same: 'same', down: 'down', mixed: 'mixed', new: 'new' },
  progressedTitle: 'Progressed',
  notProgressedTitle: 'Not yet',
  newTitle: 'New',
  exercisesTitle: 'Exercises',
  comparedWith: ({ when, improved, same, worse }) => `vs ${when}: +${improved} =${same} -${worse}`,
  satisfactionVs: (now, then) => `${now} vs ${then}`,
};

const tally = (over: Partial<Tally>): Tally => ({ ...NO_TALLY, ...over });
const change = (exerciseKey: string, verdict: Verdict, t: Partial<Tally> = {}) => ({
  exerciseKey,
  verdict,
  tally: tally(t),
});

const workout = (over: Partial<ShareCardInput> = {}): ShareCardInput => ({
  title: 'Legs',
  when: 'Thursday, 8 October',
  minutes: 52,
  sets: 18,
  satisfaction: null,
  exercises: [
    { key: 'Squat', name: 'Squat', sets: 4 },
    { key: 'Leg Press', name: 'Leg Press', sets: 3 },
  ],
  comparison: null,
  ...over,
});

const against = (over: Partial<ShareCardComparison> = {}): ShareCardComparison => ({
  when: '1.10',
  satisfaction: null,
  changes: [change('Squat', 'up', { up: 3, same: 1 }), change('Leg Press', 'down', { down: 2, same: 1 })],
  ...over,
});

describe('the numbers across the top of the card', () => {
  it('are how long, how many sets and how satisfied — and never a weight', () => {
    const model = shareCardModel(workout({ satisfaction: 8 }), labels);
    expect(model.stats).toEqual([
      { key: 'minutes', value: '52', label: 'min' },
      { key: 'sets', value: '18', label: 'sets' },
      { key: 'satisfaction', value: '8/10', label: 'satisfaction' },
    ]);
    expect(JSON.stringify(model)).not.toMatch(/kg/);
  });

  it('leave out what there is none of, satisfaction not said included', () => {
    expect(shareCardModel(workout(), labels).stats.map((s) => s.key)).toEqual(['minutes', 'sets']);
    expect(shareCardModel(workout({ minutes: null, sets: 0 }), labels).stats).toEqual([]);
  });
});

describe('where it progressed and where it did not', () => {
  it('splits the exercises by their verdict against the previous workout of the kind', () => {
    const model = shareCardModel(
      workout({
        exercises: [
          { key: 'Squat', name: 'Squat', sets: 4 },
          { key: 'Leg Press', name: 'Leg Press', sets: 3 },
          { key: 'Lunge', name: 'Lunge', sets: 3 },
          { key: 'Curl', name: 'Leg Curl', sets: 3 },
        ],
        comparison: against({
          changes: [
            change('Squat', 'up', { up: 3 }),
            change('Leg Press', 'same', { same: 3 }),
            change('Lunge', 'mixed', { up: 1, down: 1 }),
            change('Curl', 'new'),
          ],
        }),
      }),
      labels,
    );
    expect(model.groups.map((g) => [g.key, g.rows.map((r) => `${r.name}:${r.detail}`)])).toEqual([
      ['progressed', ['Squat:up']],
      ['notProgressed', ['Leg Press:same', 'Lunge:mixed']],
      ['new', ['Leg Curl:new']],
    ]);
  });

  it('says how the whole workout and the satisfaction stood against the previous one', () => {
    const model = shareCardModel(
      workout({ satisfaction: 8, comparison: against({ satisfaction: 6 }) }),
      labels,
    );
    expect(model.compareLine).toBe('vs 1.10: +3 =2 -2');
    expect(model.satisfactionLine).toBe('8 vs 6');
  });

  it('has no satisfaction line unless both workouts have one', () => {
    expect(shareCardModel(workout({ satisfaction: 8, comparison: against() }), labels).satisfactionLine).toBeNull();
    expect(
      shareCardModel(workout({ comparison: against({ satisfaction: 6 }) }), labels).satisfactionLine,
    ).toBeNull();
  });

  it('without a previous workout of the kind, lists what was done by its sets', () => {
    const model = shareCardModel(workout(), labels);
    expect(model.compareLine).toBeNull();
    expect(model.groups).toEqual([
      {
        key: 'all',
        title: 'Exercises',
        rows: [
          { name: 'Squat', detail: '4 sets', verdict: null },
          { name: 'Leg Press', detail: '3 sets', verdict: null },
        ],
      },
    ]);
  });
});

describe('where the list stops', () => {
  it('shares one budget across the groups, progressed first, and counts the rest', () => {
    const exercises = Array.from({ length: CARD_EXERCISE_LIMIT + 3 }, (_, i) => ({
      key: `E${i}`,
      name: `Exercise ${i}`,
      sets: 3,
    }));
    // The last two progressed; the rest did not.
    const changes = exercises.map((e, i) =>
      change(e.key, i >= exercises.length - 2 ? 'up' : 'same', { same: 3 }),
    );
    const model = shareCardModel(workout({ exercises, comparison: against({ changes }) }), labels);
    expect(model.groups[0]!.key).toBe('progressed');
    expect(model.groups[0]!.rows).toHaveLength(2);
    expect(model.groups.reduce((n, g) => n + g.rows.length, 0)).toBe(CARD_EXERCISE_LIMIT);
    expect(model.more).toBe('and 3 more');
  });

  it('leaves off an exercise with nothing done, and says nothing more when all fit', () => {
    const model = shareCardModel(
      workout({ exercises: [{ key: 'Squat', name: 'Squat', sets: 4 }, { key: 'Row', name: 'Row', sets: 0 }] }),
      labels,
    );
    expect(model.groups[0]!.rows.map((r) => r.name)).toEqual(['Squat']);
    expect(model.more).toBeNull();
  });
});
