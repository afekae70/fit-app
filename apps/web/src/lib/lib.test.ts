import { darkColors, lightColors } from '@fit/shared/design';
import { describe, expect, it } from 'vitest';

import { he } from '../i18n/he.js';
import { paletteStylesheet, SERIES } from '../theme/theme.js';
import { compact, niceMax } from './chartMath.js';
import { searchExercises } from './exerciseSearch.js';
import {
  formatLitres,
  formatPercent,
  formatSigned,
  formatSignedPercent,
  formatVolume,
  initials,
  ltr,
  relativeDay,
} from './format.js';
import { hrefFor, parseRoute } from './router.js';
import { readSignInError } from './signInErrors.js';

describe('the address', () => {
  it('reads every page, and falls back to the front page', () => {
    expect(parseRoute('')).toEqual({ name: 'overview' });
    expect(parseRoute('#/')).toEqual({ name: 'overview' });
    expect(parseRoute('#/admin')).toEqual({ name: 'admin' });
    expect(parseRoute('#/trainee/abc')).toEqual({ name: 'trainee', id: 'abc', tab: 'overview' });
    expect(parseRoute('#/trainee/abc/calendar')).toEqual({
      name: 'trainee',
      id: 'abc',
      tab: 'calendar',
    });
    expect(parseRoute('#/trainee/abc/nonsense')).toEqual({
      name: 'trainee',
      id: 'abc',
      tab: 'overview',
    });
    expect(parseRoute('#/elsewhere')).toEqual({ name: 'overview' });
  });

  it('reads the tabs about what a trainee shares', () => {
    for (const tab of ['body', 'nutrition', 'photos'] as const) {
      expect(parseRoute(`#/trainee/abc/${tab}`)).toEqual({ name: 'trainee', id: 'abc', tab });
      expect(parseRoute(hrefFor({ name: 'trainee', id: 'abc', tab }))).toEqual({
        name: 'trainee',
        id: 'abc',
        tab,
      });
    }
  });

  it('writes an address that reads back as the same page', () => {
    for (const route of [
      { name: 'overview' } as const,
      { name: 'admin' } as const,
      { name: 'trainee', id: '1a2b-3c', tab: 'overview' } as const,
      { name: 'trainee', id: '1a2b-3c', tab: 'plans' } as const,
    ]) {
      expect(parseRoute(hrefFor(route))).toEqual(route);
    }
  });

  it('cannot be led out of the page by an id', () => {
    const href = hrefFor({ name: 'trainee', id: '../../evil/x', tab: 'overview' });
    expect(href.startsWith('#/trainee/')).toBe(true);
    expect(parseRoute(href)).toEqual({ name: 'trainee', id: '../../evil/x', tab: 'overview' });
  });
});

describe('numbers in Hebrew', () => {
  it('signs a change in weight, and says nothing changed as nothing', () => {
    expect(formatSigned(-2.66)).toBe(ltr('−2.7'));
    expect(formatSigned(0.24)).toBe(ltr('+0.2'));
    expect(formatSigned(0.04)).toBe('0');
    expect(formatSigned(null)).toBe('—');
  });

  it('writes water in litres', () => {
    expect(formatLitres(2450)).toBe('2.45');
    expect(formatLitres(3000)).toBe('3');
  });

  it('keeps a sign beside its number inside a right-to-left line', () => {
    expect(formatSignedPercent(-8)).toBe(ltr('−8%'));
    expect(formatSignedPercent(12.5)).toBe(ltr('+12.5%'));
    expect(formatSignedPercent(0)).toBe('0%');
    expect(formatSignedPercent(null)).toBe('—');
    expect(ltr('x')).toBe('⁦x⁩');
  });

  it('writes volume in kilograms, and in tonnes past ten of them', () => {
    expect(formatVolume(9_500)).toEqual({ value: '9,500', unit: he.stats.kg });
    expect(formatVolume(179_600)).toEqual({ value: '179.6', unit: he.stats.tonnes });
  });

  it('writes a share as a whole percentage, and nothing as a dash', () => {
    expect(formatPercent(0.833)).toBe('83%');
    expect(formatPercent(null)).toBe('—');
  });

  it('says how long ago a day was in words, up to three weeks', () => {
    const today = '2026-10-12';
    expect(relativeDay(today, today)).toBe(he.time.today);
    expect(relativeDay('2026-10-11', today)).toBe(he.time.yesterday);
    expect(relativeDay('2026-10-07', today)).toBe('לפני 5 ימים');
    expect(relativeDay('2026-10-13', today)).toBe(he.time.tomorrow);
    expect(relativeDay('2026-10-15', today)).toBe('בעוד 3 ימים');
    expect(relativeDay(null, today)).toBe(he.time.never);
    expect(relativeDay('2026-08-01', today)).not.toMatch(/לפני/);
  });

  it('makes initials of the first two words', () => {
    expect(initials('נועה כהן')).toBe('נכ');
    expect(initials('  dana  ')).toBe('D');
    expect(initials('')).toBe('');
  });
});

describe('chart axes', () => {
  it('rounds the top of an axis up to a round number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(17_300)).toBe(20_000);
    expect(niceMax(100)).toBe(100);
  });

  it('writes ticks compactly', () => {
    expect(compact(0)).toBe('0');
    expect(compact(2_500)).toBe('2.5K');
    expect(compact(20_000)).toBe('20K');
    expect(compact(1_200_000)).toBe('1.2M');
  });
});

describe('the colours', () => {
  it('draws with the app’s own palette, in both schemes', () => {
    const sheet = paletteStylesheet();
    expect(sheet).toContain(`--accent: ${lightColors.accent};`);
    expect(sheet).toContain(`--accent: ${darkColors.accent};`);
    expect(sheet).toContain(`--surface-raised: ${lightColors.surfaceRaised};`);
  });

  it('defines the chart colours, three for each scheme', () => {
    const sheet = paletteStylesheet();
    for (const colour of [...SERIES.light, ...SERIES.dark]) expect(sheet).toContain(colour);
    expect(sheet).toContain('--series-3:');
  });
});

describe('finding an exercise to add', () => {
  it('finds by Hebrew or English, any order of words', () => {
    expect(searchExercises('לחיצת חזה').map((seed) => seed.nameEn)).toContain(
      'Barbell Bench Press',
    );
    expect(searchExercises('bench barbell').map((seed) => seed.nameEn)).toContain(
      'Barbell Bench Press',
    );
  });

  it('puts names that start with what was typed first', () => {
    const [first] = searchExercises('סקוואט');
    expect(first?.nameHe.startsWith('סקוואט')).toBe(true);
  });

  it('offers nothing for nothing, and at most ten', () => {
    expect(searchExercises('   ')).toEqual([]);
    expect(searchExercises('a').length).toBeLessThanOrEqual(10);
  });
});

describe('a refused sign-in', () => {
  it('tells wrong details from an unconfirmed email and from no network', () => {
    expect(
      readSignInError({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    ).toBe('credentials');
    expect(readSignInError({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toBe(
      'unconfirmed',
    );
    expect(readSignInError({ status: 0, message: 'Failed to fetch' })).toBe('offline');
    expect(readSignInError({ status: 500, message: 'Database error' })).toBe('other');
  });
});
