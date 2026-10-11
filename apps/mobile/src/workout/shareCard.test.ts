import { describe, expect, it } from 'vitest';

import {
  CARD_EXERCISE_LIMIT,
  shareCardModel,
  type ShareCardInput,
  type ShareCardLabels,
} from './shareCard.js';

const labels: ShareCardLabels = {
  minutes: 'min',
  sets: 'sets',
  volumeUnit: 'kg',
  setCount: (count) => `${count} sets`,
  more: (count) => `and ${count} more`,
};

const workout = (over: Partial<ShareCardInput> = {}): ShareCardInput => ({
  title: 'Legs',
  when: 'Thursday, 8 October',
  minutes: 52,
  sets: 18,
  volume: '12,400',
  exercises: [
    { name: 'Squat', best: '100 kg × 8', sets: 4 },
    { name: 'Leg Press', best: '180 kg × 10', sets: 3 },
  ],
  ...over,
});

describe('the numbers across the top of the card', () => {
  it('are how long, how many sets and how heavy, in that order', () => {
    expect(shareCardModel(workout(), labels).stats).toEqual([
      { key: 'minutes', value: '52', label: 'min' },
      { key: 'sets', value: '18', label: 'sets' },
      { key: 'volume', value: '12,400', label: 'kg' },
    ]);
  });

  it('leave out a number there is none of, rather than showing a zero', () => {
    // A walk: a time, and nothing lifted.
    const walk = shareCardModel(workout({ sets: 0, volume: null }), labels);
    expect(walk.stats.map((stat) => stat.key)).toEqual(['minutes']);

    // A workout still open has no length yet.
    const open = shareCardModel(workout({ minutes: null }), labels);
    expect(open.stats.map((stat) => stat.key)).toEqual(['sets', 'volume']);

    expect(shareCardModel(workout({ minutes: 0 }), labels).stats.map((stat) => stat.key)).toEqual([
      'sets',
      'volume',
    ]);
  });

  it('can be none at all', () => {
    expect(shareCardModel(workout({ minutes: null, sets: 0, volume: null }), labels).stats).toEqual(
      [],
    );
  });
});

describe('the lifts on the card', () => {
  it('are each told by their best set', () => {
    expect(shareCardModel(workout(), labels).rows).toEqual([
      { name: 'Squat', detail: '100 kg × 8' },
      { name: 'Leg Press', detail: '180 kg × 10' },
    ]);
  });

  it('are told by how many sets, when there is no best set to tell', () => {
    const model = shareCardModel(
      workout({ exercises: [{ name: 'Plank', best: null, sets: 3 }] }),
      labels,
    );
    expect(model.rows).toEqual([{ name: 'Plank', detail: '3 sets' }]);
  });

  it('leave out an exercise nothing was done in', () => {
    const model = shareCardModel(
      workout({
        exercises: [
          { name: 'Squat', best: '100 kg × 8', sets: 4 },
          { name: 'Skipped', best: null, sets: 0 },
        ],
      }),
      labels,
    );
    expect(model.rows.map((row) => row.name)).toEqual(['Squat']);
    expect(model.more).toBeNull();
  });

  it('stop at six and count the rest', () => {
    const exercises = Array.from({ length: 9 }, (_, index) => ({
      name: `Lift ${index + 1}`,
      best: '50 kg × 10',
      sets: 3,
    }));
    const model = shareCardModel(workout({ exercises }), labels);
    expect(model.rows).toHaveLength(CARD_EXERCISE_LIMIT);
    expect(model.rows.at(-1)?.name).toBe('Lift 6');
    expect(model.more).toBe('and 3 more');
  });

  it('say nothing about more when everything fitted', () => {
    const exercises = Array.from({ length: CARD_EXERCISE_LIMIT }, (_, index) => ({
      name: `Lift ${index + 1}`,
      best: '50 kg × 10',
      sets: 3,
    }));
    expect(shareCardModel(workout({ exercises }), labels).more).toBeNull();
  });

  it('do not count skipped exercises among the ones left over', () => {
    const exercises = [
      ...Array.from({ length: 7 }, (_, index) => ({
        name: `Lift ${index + 1}`,
        best: '50 kg × 10',
        sets: 3,
      })),
      { name: 'Skipped', best: null, sets: 0 },
    ];
    expect(shareCardModel(workout({ exercises }), labels).more).toBe('and 1 more');
  });
});

describe('the heading', () => {
  it('is the workout and when it was, as given', () => {
    const model = shareCardModel(workout(), labels);
    expect(model.title).toBe('Legs');
    expect(model.when).toBe('Thursday, 8 October');
  });
});
