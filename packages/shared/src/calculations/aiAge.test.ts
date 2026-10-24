import { describe, expect, it } from 'vitest';

import { AI_MIN_AGE, aiAgeVerdict } from './aiAge.js';

const on = new Date('2026-10-24T09:00:00Z');

describe('who the AI features are for', () => {
  it('is 18, what Google’s Gemini API terms ask', () => {
    expect(AI_MIN_AGE).toBe(18);
  });

  it('lets in someone whose 18th birthday is today, and not the day before', () => {
    expect(aiAgeVerdict('2008-10-24', on)).toBe('adult');
    expect(aiAgeVerdict('2008-10-25', on)).toBe('minor');
  });

  it('keeps out a 16- or 17-year-old, who may still use the rest of the app', () => {
    expect(aiAgeVerdict('2010-01-01', on)).toBe('minor');
    expect(aiAgeVerdict('2009-06-30', on)).toBe('minor');
  });

  it('reads a timestamp by its date, as Postgres or SQLite may send one', () => {
    expect(aiAgeVerdict('1990-05-01T00:00:00+00:00', on)).toBe('adult');
  });

  it('calls anything that is not a date unknown, never adult', () => {
    for (const value of [null, undefined, '', 'yesterday', 19900501, '1990-13-45', {}]) {
      expect(aiAgeVerdict(value, on)).toBe('unknown');
    }
  });
});
