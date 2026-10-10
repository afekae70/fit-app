import { describe, expect, it } from 'vitest';

import {
  SHARE_EXERCISE_LIMIT,
  workoutShareText,
  type ShareInput,
  type ShareLabels,
} from './shareText.js';

const labels: ShareLabels = {
  minutes: (count) => `${count} min`,
  sets: (count) => (count === 1 ? '1 set' : `${count} sets`),
  more: (count) => `and ${count} more`,
  footer: 'Logged with NovaFit',
};

const legs: ShareInput = {
  title: 'Legs',
  when: 'Thursday, 8 October',
  minutes: 52,
  sets: 14,
  volume: '8,450 kg',
  exercises: [
    { name: 'Back Squat', best: '100 kg × 8', sets: 4 },
    { name: 'Romanian Deadlift', best: '80 kg × 10', sets: 3 },
    { name: 'Plank', best: null, sets: 3 },
  ],
};

describe('a workout as text', () => {
  it('says what it was, when, how long and how much, then the best set of each lift', () => {
    expect(workoutShareText(legs, labels)).toBe(
      [
        '💪 Legs',
        'Thursday, 8 October · 52 min · 14 sets · 8,450 kg',
        '',
        '• Back Squat — 100 kg × 8',
        '• Romanian Deadlift — 80 kg × 10',
        '• Plank — 3 sets',
        '',
        'Logged with NovaFit',
      ].join('\n'),
    );
  });

  it('leaves out what there is nothing to say about', () => {
    const text = workoutShareText({ ...legs, minutes: null, volume: null }, labels);
    expect(text.split('\n')[1]).toBe('Thursday, 8 October · 14 sets');
  });

  it('does not list an exercise in which nothing was done', () => {
    const text = workoutShareText(
      { ...legs, exercises: [...legs.exercises, { name: 'Leg Press', best: null, sets: 0 }] },
      labels,
    );
    expect(text).not.toContain('Leg Press');
  });

  it('stops after a screenful and counts the rest', () => {
    const many = Array.from({ length: SHARE_EXERCISE_LIMIT + 3 }, (_unused, index) => ({
      name: `Exercise ${index + 1}`,
      best: '50 kg × 10',
      sets: 3,
    }));
    const lines = workoutShareText({ ...legs, exercises: many }, labels).split('\n');
    expect(lines.filter((line) => line.startsWith('• '))).toHaveLength(SHARE_EXERCISE_LIMIT);
    expect(lines).toContain('and 3 more');
    expect(lines.join('\n')).not.toContain(`Exercise ${SHARE_EXERCISE_LIMIT + 1} `);
  });

  it('does not say "and 0 more"', () => {
    expect(workoutShareText(legs, labels)).not.toContain('more');
  });

  it('is tidy for a workout with no exercises at all', () => {
    const text = workoutShareText({ ...legs, sets: 0, volume: null, exercises: [] }, labels);
    expect(text).toBe(
      ['💪 Legs', 'Thursday, 8 October · 52 min', '', 'Logged with NovaFit'].join('\n'),
    );
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('carries Hebrew through untouched', () => {
    const text = workoutShareText(
      {
        title: 'רגליים',
        when: 'יום חמישי, 8 באוקטובר',
        minutes: 52,
        sets: 14,
        volume: '8,450 ק"ג',
        exercises: [{ name: 'סקוואט', best: '100 ק"ג × 8', sets: 4 }],
      },
      {
        minutes: (count) => `${count} דק׳`,
        sets: (count) => `${count} סטים`,
        more: (count) => `ועוד ${count}`,
        footer: 'נרשם ב-NovaFit',
      },
    );
    expect(text.split('\n')).toEqual([
      '💪 רגליים',
      'יום חמישי, 8 באוקטובר · 52 דק׳ · 14 סטים · 8,450 ק"ג',
      '',
      '• סקוואט — 100 ק"ג × 8',
      '',
      'נרשם ב-NovaFit',
    ]);
  });
});
