/**
 * The widget file, which nothing on screen ever shows.
 *
 * Both widgets are drawn by the launcher from this one JSON object, in a process with none of this
 * code in it. A mistake here is a wrong number on someone's home screen that no screen in the app
 * contradicts — so the arithmetic and the shape are both worth pinning down.
 */

import { describe, expect, it } from 'vitest';

import { ringCount, ringPercent, weekForWidget, widgetPayload } from './payload.js';

describe('ringPercent', () => {
  it('fills in proportion to the target', () => {
    expect(ringPercent(0, 4)).toBe(0);
    expect(ringPercent(1, 4)).toBe(25);
    expect(ringPercent(3, 4)).toBe(75);
    expect(ringPercent(4, 4)).toBe(100);
  });

  it('rounds rather than truncating', () => {
    expect(ringPercent(2, 3)).toBe(67);
  });

  it('closes the ring and stops there past the target', () => {
    // Six workouts in a week of five is a good week, not 120 per cent of a circle.
    expect(ringPercent(6, 5)).toBe(100);
  });

  it('draws nothing for a week with no target', () => {
    expect(ringPercent(0, 0)).toBe(0);
    expect(ringPercent(2, 0)).toBe(0);
  });

  it('survives a number that is not one', () => {
    expect(ringPercent(Number.NaN, 4)).toBe(0);
    expect(ringPercent(2, Number.POSITIVE_INFINITY)).toBe(0);
    expect(ringPercent(-1, 4)).toBe(0);
  });
});

describe('ringCount', () => {
  it('reads as done over planned', () => {
    expect(ringCount(3, 5)).toBe('3/5');
  });

  it('keeps going past the target, where the ring cannot', () => {
    expect(ringCount(6, 5)).toBe('6/5');
  });

  it('survives a number that is not one', () => {
    expect(ringCount(Number.NaN, 4)).toBe('0/4');
    expect(ringCount(2.7, 4)).toBe('2/4');
  });
});

describe('weekForWidget', () => {
  const copy = { caption: 'this week', streak: (days: number) => `${days} days` };

  it('carries the ring, the figure and the lines beside it', () => {
    expect(weekForWidget({ trained: 3, target: 4, streakDays: 2 }, copy)).toEqual({
      percent: 75,
      count: '3/4',
      caption: 'this week',
      streak: '2 days',
    });
  });

  it('leaves the streak line out when there is no streak', () => {
    expect(weekForWidget({ trained: 0, target: 4, streakDays: 0 }, copy).streak).toBe('');
  });
});

describe('widgetPayload', () => {
  const week = { percent: 50, count: '2/4', caption: 'this week', streak: '' };

  it('puts today at the top level, where the first widget looks for it', () => {
    const payload = widgetPayload({
      today: { title: 'Push A', detail: '5 exercises', action: 'Start' },
      week,
    });

    expect(payload).toEqual({
      title: 'Push A',
      detail: '5 exercises',
      action: 'Start',
      week,
    });
  });

  it('still carries the week on a rest day', () => {
    // The whole reason this function exists: a rest day used to write an empty object, which would
    // have blanked the ring every Saturday.
    expect(widgetPayload({ today: null, week })).toEqual({ week });
  });

  it('writes an empty object when there is nothing at all', () => {
    expect(widgetPayload({ today: null, week: null })).toEqual({});
  });
});
