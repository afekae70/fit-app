/**
 * Every colour someone reads, against every ground it is drawn on, in both palettes (WCAG AA).
 *
 * The first light palette had hints, tab labels and units at under 4:1 on the lavender ground,
 * and the faintest grey at 2.2:1 — readable on a good screen indoors, not on a phone in a gym.
 * Measured on the coach website, 40 pieces of text on one page fell short. These are the rules
 * that put it right, so a later change of shade cannot quietly undo it.
 */

import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type ColorPalette } from './palette.js';

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two solid colours. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

type Token = keyof ColorPalette;

/** Every ground a word can sit on. */
const GROUNDS: Token[] = [
  'bg',
  'surface',
  'surfaceRaised',
  'surfaceHigh',
  'accentSoft',
  'tileSun',
  'tileCoral',
  'warningSoft',
  'dangerSoft',
  'infoSoft',
];
/** The plain grounds: the page, a card, a raised panel. */
const PLAIN: Token[] = ['bg', 'surface', 'surfaceRaised'];

const PALETTES = [
  ['light', lightColors],
  ['dark', darkColors],
] as const;

function failures(palette: ColorPalette, fg: Token, grounds: Token[], need: number): string[] {
  return grounds
    .map((ground) => ({ ground, ratio: contrast(palette[fg], palette[ground]) }))
    .filter(({ ratio }) => ratio < need)
    .map(({ ground, ratio }) => `${fg} on ${ground}: ${ratio.toFixed(2)}`);
}

describe.each(PALETTES)('the %s palette', (_, palette) => {
  it('is all solid colours where contrast is measured', () => {
    for (const token of [...GROUNDS, 'text', 'textMuted', 'textFaint', 'accent'] as Token[]) {
      expect(palette[token], token).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it.each(['text', 'textSecondary', 'textMuted'] as Token[])(
    '%s reads at 4.5:1 on every ground',
    (token) => {
      expect(failures(palette, token, GROUNDS, 4.5)).toEqual([]);
    },
  );

  it('keeps the accent readable as words, and a label on it readable', () => {
    expect(failures(palette, 'accent', [...PLAIN, 'accentSoft'], 4.5)).toEqual([]);
    expect(failures(palette, 'accentLift', [...PLAIN, 'accentSoft'], 4.5)).toEqual([]);
    // A primary button's label is drawn in the page's own colour, on the accent.
    expect(contrast(palette.bg, palette.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['warning', 'warningSoft'],
    ['danger', 'dangerSoft'],
    ['info', 'infoSoft'],
  ] as [Token, Token][])('%s reads on the page, on a card and on its own soft ground', (fg, soft) => {
    expect(failures(palette, fg, [...PLAIN, soft], 4.5)).toEqual([]);
  });

  it('draws macro colours that hold 3:1 as marks, and protein and fat as words', () => {
    for (const macro of ['protein', 'carbs', 'fat'] as Token[]) {
      expect(failures(palette, macro, PLAIN, 3)).toEqual([]);
    }
    expect(failures(palette, 'protein', PLAIN, 4.5)).toEqual([]);
    expect(failures(palette, 'fat', PLAIN, 4.5)).toEqual([]);
  });

  it('keeps the faintest grey visible, and still below the muted one', () => {
    expect(failures(palette, 'textFaint', PLAIN, 3)).toEqual([]);
    expect(contrast(palette.textFaint, palette.surface)).toBeLessThan(
      contrast(palette.textMuted, palette.surface),
    );
  });

  it('keeps the ramp in order, so muted text still reads as quieter than the rest', () => {
    const on = (token: Token) => contrast(palette[token], palette.surface);
    expect(on('text')).toBeGreaterThan(on('textSecondary'));
    expect(on('textSecondary')).toBeGreaterThan(on('textMuted'));
    expect(on('textMuted')).toBeGreaterThan(on('textFaint'));
  });
});

describe('the contrast arithmetic', () => {
  it('agrees with the published extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1);
  });
});
