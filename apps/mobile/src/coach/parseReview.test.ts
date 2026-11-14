import { describe, expect, it } from 'vitest';

import { parseReview, tidyReview } from './weeklyReview.js';

describe('a weekly review split into its lines', () => {
  it('reads the five tagged lines, the words after the tags in any language', () => {
    const text = [
      'TRAINING: 4 אימונים, סקוואט עלה ב-5 ק״ג.',
      'FOOD: 2,300 קלוריות ביום, קרוב ליעד.',
      'WATER: יעד המים הושג ב-5 מתוך 7 ימים.',
      'WEIGHT: ירידה של 0.6 ק״ג.',
      'TIP: הוסף סט אחד לכפיפת ברכיים.',
    ].join('\n');
    expect(parseReview(text)).toEqual({
      training: '4 אימונים, סקוואט עלה ב-5 ק״ג.',
      food: '2,300 קלוריות ביום, קרוב ליעד.',
      water: 'יעד המים הושג ב-5 מתוך 7 ימים.',
      weight: 'ירידה של 0.6 ק״ג.',
      tip: 'הוסף סט אחד לכפיפת ברכיים.',
    });
  });

  it('forgives what a model does to a tag: case, marks around it, a dash for a colon', () => {
    const text = '**Training** - Four workouts.\n• tip: Sleep earlier on rest days.';
    expect(parseReview(tidyReview(text))).toEqual({
      training: 'Four workouts.',
      tip: 'Sleep earlier on rest days.',
    });
  });

  it('joins a line without a tag to the line above it', () => {
    expect(parseReview('TRAINING: Four workouts,\nall finished.\nTIP: Rest more.')).toEqual({
      training: 'Four workouts, all finished.',
      tip: 'Rest more.',
    });
  });

  it('is nothing for a review not written that way, which is then shown whole', () => {
    expect(parseReview('A good week: squats went up and the water was steady.')).toBeNull();
    // A tip alone is not the structure either.
    expect(parseReview('TIP: Drink more.')).toBeNull();
  });

  it('reads the good and the bad sections before the subjects', () => {
    const text = [
      'GOOD: Four workouts, one more than last week. Squat up to 110 kg.',
      'BAD: Water goal reached on only 2 of 7 days.',
      'TRAINING: Squats progressed, curls went down.',
      'TIP: Fill a bottle every morning, because you drink most when it is in front of you.',
    ].join('\n');
    expect(parseReview(text)).toEqual({
      good: 'Four workouts, one more than last week. Squat up to 110 kg.',
      bad: 'Water goal reached on only 2 of 7 days.',
      training: 'Squats progressed, curls went down.',
      tip: 'Fill a bottle every morning, because you drink most when it is in front of you.',
    });
  });
});
