/**
 * The coach's copy of a trainee's workouts, read the way the trainee's phone reads its own for
 * the monthly review.
 */

import { describe, expect, it } from 'vitest';

import { historyStart, monthlyProgress, sessionsByExercise, trainingMonths } from './monthly.js';
import { set, workout } from './testSessions.js';

describe('sessionsByExercise', () => {
  it('keeps working sets only, oldest first, per exercise', () => {
    const later = workout('2026-10-20', [{ key: 'Back Squat', sets: [[100, 5]], warmups: [[60, 5]] }]);
    const earlier = workout('2026-10-06', [{ key: 'Back Squat', sets: [[95, 5]] }]);
    const line = sessionsByExercise([later, earlier]).get('Back Squat')!;
    expect(line.map((s) => s.sets.map((x) => x.weightKg))).toEqual([[95], [100]]);
  });

  it('reads an exercise entered twice in one workout as one session', () => {
    const session = workout('2026-10-06', [
      { key: 'Barbell Bench Press', sets: [[80, 8]] },
      { key: 'Barbell Bench Press', sets: [[80, 7]] },
    ]);
    const line = sessionsByExercise([session]).get('Barbell Bench Press')!;
    expect(line).toHaveLength(1);
    expect(line[0]!.sets.map((x) => x.reps)).toEqual([8, 7]);
  });

  it('leaves out an exercise with no key and one with nothing but warm-ups', () => {
    const session = workout('2026-10-06', [{ key: 'Back Squat', sets: [] , warmups: [[60, 5]] }]);
    session.exercises.push({ exerciseKey: null, supersetWithNext: false, sets: [set(20, 10)] });
    expect(sessionsByExercise([session]).size).toBe(0);
  });
});

describe('monthlyProgress', () => {
  const sessions = [
    workout('2026-09-28', [{ key: 'Barbell Bench Press', sets: [[80, 8], [80, 8]] }]),
    workout('2026-10-06', [{ key: 'Barbell Bench Press', sets: [[80, 9], [80, 8]] }]),
    workout('2026-09-27', [{ key: 'Back Squat', sets: [[100, 6]] }]),
    workout('2026-10-08', [{ key: 'Back Squat', sets: [[95, 6]] }]),
  ];

  it('gives the same verdicts as the phone, exercise by exercise and by area', () => {
    const { review, areas } = monthlyProgress(sessions, '2026-10');
    expect(review.counts).toMatchObject({ improved: 1, declined: 1 });
    expect(areas.map((a) => [a.area, a.status])).toEqual([
      ['chest', 'improved'],
      ['legs', 'declined'],
    ]);
  });

  it('knows which months have training', () => {
    expect(trainingMonths(sessions)).toEqual(['2026-09', '2026-10']);
  });
});

describe('historyStart', () => {
  it('reaches back a month and the look-back before the earliest month', () => {
    expect(historyStart('2026-10')).toEqual(new Date(new Date(2026, 8, 1).getTime() - 90 * 86_400_000));
  });
});
