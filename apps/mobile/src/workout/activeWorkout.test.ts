import { describe, expect, it } from 'vitest';

import { isWorkoutActive, onWorkoutActiveChange, setWorkoutActive } from './activeWorkout.js';

describe('the open-workout flag', () => {
  it('tells its listeners when a workout opens and closes, and only on a change', () => {
    const seen: boolean[] = [];
    const stop = onWorkoutActiveChange((value) => seen.push(value));

    setWorkoutActive(true);
    setWorkoutActive(true);
    expect(isWorkoutActive()).toBe(true);
    setWorkoutActive(false);

    stop();
    setWorkoutActive(true);
    expect(seen).toEqual([true, false]);
    setWorkoutActive(false);
  });
});
