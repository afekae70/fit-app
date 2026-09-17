import { describe, expect, it } from 'vitest';

import { filterChoices, normaliseForSearch } from './sheetSearch.js';

const workouts = [
  { label: '+ הוסף דחיפה A' },
  { label: '+ הוסף יום רגליים' },
  { label: '+ הוסף בטן' },
  { label: 'מנוחה' },
  { label: 'Push B' },
];

const labels = (query: string) => filterChoices(workouts, query).map(({ choice }) => choice.label);

describe('searching a sheet', () => {
  it('shows everything before anything is typed', () => {
    expect(labels('')).toHaveLength(workouts.length);
    expect(labels('   ')).toHaveLength(workouts.length);
  });

  it('finds a workout by part of its name', () => {
    expect(labels('בטן')).toEqual(['+ הוסף בטן']);
  });

  it('keeps the position in the original list, so the right workout is chosen', () => {
    // The sheet answers with an index into what the caller passed. A filtered index of 0 here
    // would pick "דחיפה A" instead of "בטן".
    expect(filterChoices(workouts, 'בטן')).toEqual([{ choice: { label: '+ הוסף בטן' }, index: 2 }]);
  });

  it('matches every word typed, in any order', () => {
    expect(labels('רגליים יום')).toEqual(['+ הוסף יום רגליים']);
    expect(labels('רגליים בטן')).toEqual([]);
  });

  it('ignores case in English', () => {
    expect(labels('push')).toEqual(['Push B']);
  });

  it('ignores Hebrew vowel points and geresh marks', () => {
    expect(labels('בֶּטֶן')).toEqual(['+ הוסף בטן']);
    expect(normaliseForSearch('ק״ג')).toBe(normaliseForSearch('קג'));
  });

  it('returns nothing, not everything, when nothing matches', () => {
    expect(labels('אופניים')).toEqual([]);
  });
});
