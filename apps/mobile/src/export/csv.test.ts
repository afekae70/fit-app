import { describe, expect, it } from 'vitest';

import {
  escapeField,
  isoDate,
  metricsToCsv,
  setsToCsv,
  toCsv,
  type ExportedSet,
} from './csv.js';

const set = (over: Partial<ExportedSet> = {}): ExportedSet => ({
  startedAt: '2026-06-01T18:30:00.000Z',
  workout: 'Push A',
  gym: 'Gold Gym',
  exercise: 'לחיצת חזה במוט',
  setIndex: 1,
  isWarmup: 0,
  weightKg: 80,
  reps: 8,
  rpe: 8,
  toFailure: 0,
  doneAt: '2026-06-01T18:35:00.000Z',
  ...over,
});

describe('escaping', () => {
  it('leaves an ordinary field alone', () => {
    expect(escapeField('Bench')).toBe('Bench');
    expect(escapeField(82.5)).toBe('82.5');
  });

  it('quotes a field containing a comma', () => {
    // Gyms and workout names are free text, so this is a matter of time rather than a
    // hypothetical — and an unquoted comma silently shifts every later column by one.
    expect(escapeField('Gym, the second one')).toBe('"Gym, the second one"');
  });

  it('doubles quotes inside a quoted field', () => {
    expect(escapeField('the "big" gym')).toBe('"the ""big"" gym"');
  });

  it('quotes a field containing a line break', () => {
    expect(escapeField('two\nlines')).toBe('"two\nlines"');
  });

  it('writes nothing for null and undefined', () => {
    // An empty cell, not the text "null" — which a spreadsheet would happily treat as a value.
    expect(escapeField(null)).toBe('');
    expect(escapeField(undefined)).toBe('');
  });

  it('keeps a zero rather than dropping it', () => {
    // The falsy trap: 0 reps is data, and an `if (!value)` guard would erase it.
    expect(escapeField(0)).toBe('0');
  });

  it('keeps Hebrew intact', () => {
    expect(escapeField('לחיצת חזה')).toBe('לחיצת חזה');
  });
});

describe('the document', () => {
  it('separates records with CRLF', () => {
    // A bare newline is read by some Windows importers as part of the previous field, turning
    // the whole export into one broken row rather than raising an error.
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2');
  });

  it('is just a header when there is nothing to say', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });
});

describe('sets', () => {
  it('writes one row per set with the identifying columns repeated', () => {
    const csv = setsToCsv([set(), set({ setIndex: 2, reps: 7 })]);
    const lines = csv.split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('2026-06-01');
    expect(lines[1]).toContain('Push A');
    expect(lines[2]).toContain('Push A');
  });

  it('names the kind rather than printing a flag', () => {
    expect(setsToCsv([set({ isWarmup: 1 })]).split('\r\n')[1]).toContain('warmup');
    expect(setsToCsv([set({ isWarmup: 0 })]).split('\r\n')[1]).toContain('working');
  });

  it('leaves an unrated set empty rather than guessing', () => {
    const row = setsToCsv([set({ rpe: null, weightKg: null, reps: null })]).split('\r\n')[1]!;
    expect(row).not.toContain('null');
    expect(row.endsWith(',,,,yes')).toBe(true);
  });

  it('takes the date off the timestamp without a timezone shift', () => {
    // 18:30 UTC is the next day in some zones and the previous one in others. Parsing through
    // Date would move a late-evening session onto the wrong day; slicing cannot.
    expect(isoDate('2026-06-01T23:45:00.000Z')).toBe('2026-06-01');
  });

  it('survives a gym name with a comma in it', () => {
    const row = setsToCsv([set({ gym: 'Gym, downtown' })]).split('\r\n')[1]!;
    expect(row).toContain('"Gym, downtown"');
    // And the column count is still right, which is the thing the quoting protects.
    expect(row.match(/(^|,)(?=(?:[^"]|"[^"]*")*$)/g)).toHaveLength(11);
  });
});

describe('weigh-ins', () => {
  it('writes a row per measurement', () => {
    const csv = metricsToCsv([
      { measuredAt: '2026-06-01T07:00:00.000Z', weightKg: 73.6, bodyFatPct: null, source: 'scale' },
    ]);
    expect(csv.split('\r\n')[1]).toBe('2026-06-01,73.6,,scale');
  });

  it('is just a header with no measurements', () => {
    expect(metricsToCsv([]).split('\r\n')).toHaveLength(1);
  });
});
