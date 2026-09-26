import { describe, expect, it } from 'vitest';

import {
  IDLE_RUN,
  elapsedSeconds,
  formatDuration,
  isRunning,
  pacePerUnit,
  pauseRun,
  runFromSeconds,
  speedPerHour,
  startRun,
} from './cardioTimer.js';

const T0 = 1_700_000_000_000;

describe('a cardio effort', () => {
  it('counts from the wall clock, so a locked phone loses nothing', () => {
    const run = startRun(T0);
    // Twelve minutes later, whatever the app was doing in between.
    expect(elapsedSeconds(run, T0 + 12 * 60_000)).toBe(720);
  });

  it('banks what was done before a pause and carries on from there', () => {
    const paused = pauseRun(startRun(T0), T0 + 60_000);
    expect(isRunning(paused)).toBe(false);
    expect(elapsedSeconds(paused, T0 + 10 * 60_000)).toBe(60);

    const resumed = startRun(T0 + 10 * 60_000, paused);
    expect(elapsedSeconds(resumed, T0 + 11 * 60_000)).toBe(120);
  });

  it('ignores a second start and a pause while paused', () => {
    const run = startRun(T0);
    expect(startRun(T0 + 5_000, run)).toEqual(run);
    expect(pauseRun(IDLE_RUN, T0)).toEqual(IDLE_RUN);
  });

  it('resumes from a duration already recorded', () => {
    const run = startRun(T0, runFromSeconds(300));
    expect(elapsedSeconds(run, T0 + 60_000)).toBe(360);
  });
});

describe('what the effort adds up to', () => {
  it('reads as minutes below an hour and as hours above it', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3862)).toBe('1:04:22');
  });

  it('gives pace as minutes per unit', () => {
    expect(pacePerUnit(1800, 5)).toBe('6:00');
    expect(pacePerUnit(1710, 5)).toBe('5:42');
  });

  it('gives speed per hour to one decimal', () => {
    expect(speedPerHour(3600, 12)).toBe(12);
    expect(speedPerHour(1800, 5)).toBe(10);
  });

  it('says nothing rather than dividing by zero', () => {
    expect(pacePerUnit(0, 5)).toBeNull();
    expect(pacePerUnit(600, 0)).toBeNull();
    expect(speedPerHour(600, 0)).toBeNull();
  });
});
