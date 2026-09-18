import { describe, expect, it } from 'vitest';

import { matchesExerciseSearch } from './exerciseSearch.js';

const pushdown = { nameEn: 'Single-Arm Cable Pushdown', nameHe: 'פשיטת מרפקים בכבל יד יד' };

describe('exercise search', () => {
  it('finds an exercise by the muscle it trains', () => {
    expect(matchesExerciseSearch(pushdown, 'יד אחורית', ['יד אחורית'])).toBe(true);
  });

  it('matches word by word, in any order, across name and muscle', () => {
    expect(matchesExerciseSearch(pushdown, 'יד אחורית פשיטת מרפקים יד יד', ['יד אחורית'])).toBe(true);
    expect(matchesExerciseSearch(pushdown, 'כבל פשיטת', [])).toBe(true);
  });

  it('still requires every word to be there', () => {
    expect(matchesExerciseSearch(pushdown, 'פשיטת מרפקים דמבל', ['יד אחורית'])).toBe(false);
  });

  it('finds by the English name too, ignoring case', () => {
    expect(matchesExerciseSearch(pushdown, 'cable PUSHDOWN')).toBe(true);
  });

  it('shows everything for an empty search', () => {
    expect(matchesExerciseSearch(pushdown, '   ')).toBe(true);
  });
});
