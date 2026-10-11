import { describe, expect, it } from 'vitest';

import {
  ACCENT_NAMES,
  DEFAULT_ACCENT,
  darkColors,
  lightColors,
  mixHex,
  paletteFor,
  type AccentName,
  type ColorPalette,
  type ColorSchemeName,
} from './theme.js';

/** WCAG relative luminance of a `#RRGGBB`. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two solid colours, from 1 (none) to 21. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const SCHEMES: readonly ColorSchemeName[] = ['dark', 'light'];
const OTHERS = ACCENT_NAMES.filter((name) => name !== 'violet');
const every = SCHEMES.flatMap((scheme) => OTHERS.map((accent) => [scheme, accent] as const));

describe('the accent that is chosen', () => {
  it('is violet unless something else is picked, and violet is the palette as designed', () => {
    expect(DEFAULT_ACCENT).toBe('violet');
    expect(paletteFor('dark', 'violet')).toBe(darkColors);
    expect(paletteFor('light', 'violet')).toBe(lightColors);
  });

  it('gives back the same palette object for the same choice', () => {
    // Components rebuild their styles when `colors` changes identity; a fresh object per
    // render would be a fresh stylesheet per render, on every screen.
    for (const [scheme, accent] of every) {
      expect(paletteFor(scheme, accent)).toBe(paletteFor(scheme, accent));
    }
  });

  it('changes the accent and nothing that is not the accent', () => {
    const accentTokens = new Set<keyof ColorPalette>([
      'accent',
      'accentSoft',
      'accentBorder',
      'accentLift',
      'accentPair',
      'glassEdge',
    ]);
    for (const [scheme, accent] of every) {
      const base = paletteFor(scheme, 'violet');
      const chosen = paletteFor(scheme, accent);
      for (const key of Object.keys(base) as (keyof ColorPalette)[]) {
        if (accentTokens.has(key))
          expect(chosen[key], `${scheme} ${accent} ${key}`).not.toBe(base[key]);
        else expect(chosen[key], `${scheme} ${accent} ${key}`).toBe(base[key]);
      }
    }
  });

  it('leaves protein where it was, so it never lands beside the amber of carbs', () => {
    expect(paletteFor('dark', 'orange').protein).toBe(darkColors.protein);
    expect(paletteFor('light', 'orange').protein).toBe(lightColors.protein);
  });

  it('gives each choice a colour of its own in each scheme', () => {
    for (const scheme of SCHEMES) {
      const shown = ACCENT_NAMES.map((accent) => paletteFor(scheme, accent).accent);
      expect(new Set(shown).size).toBe(ACCENT_NAMES.length);
    }
  });
});

describe('every accent reads as well as the violet does', () => {
  /*
   * The violet palette is the bar, not a number from a standard: these are the contrasts the
   * design was approved at. An alternative may be easier to read than the logo's colour; it
   * may not be harder.
   */
  const measure = (palette: ColorPalette) => ({
    // A label on a filled button: `bg` is the type colour on the accent throughout the app.
    typeOnAccent: contrast(palette.bg, palette.accent),
    typeOnGradientEnd: contrast(palette.bg, palette.accentPair),
    // The accent as type and as icons, on a card and on the ground.
    accentOnCard: contrast(palette.accent, palette.surface),
    accentOnGround: contrast(palette.accent, palette.bg),
    // A ticked set's numbers, which are the largest type in the app.
    liftOnCard: contrast(palette.accentLift, palette.surface),
  });

  it.each(every)('%s %s', (scheme, accent: AccentName) => {
    const bar = measure(paletteFor(scheme, 'violet'));
    const got = measure(paletteFor(scheme, accent));
    for (const key of Object.keys(bar) as (keyof typeof bar)[]) {
      expect(got[key], key).toBeGreaterThanOrEqual(bar[key] - 0.3);
    }
  });

  it.each(every)('%s %s keeps its soft fill and border quiet, and visible', (scheme, accent) => {
    const palette = paletteFor(scheme, accent);
    // Soft is a tint of the card, not a second accent: type on it must still be body type.
    expect(contrast(palette.text, palette.accentSoft)).toBeGreaterThan(7);
    // And the border has to be an edge at all against the ground it is drawn on.
    expect(contrast(palette.accentBorder, palette.bg)).toBeGreaterThan(1.15);
  });
});

describe('mixing one colour over another', () => {
  it('is the lower colour at nothing and the upper at everything', () => {
    expect(mixHex('#FF0000', '#0000FF', 0)).toBe('#0000FF');
    expect(mixHex('#FF0000', '#0000FF', 1)).toBe('#FF0000');
  });

  it('is halfway at a half', () => {
    expect(mixHex('#FFFFFF', '#000000', 0.5)).toBe('#808080');
  });

  it('pads small channels, so the result is always six digits', () => {
    expect(mixHex('#000000', '#000000', 0.3)).toBe('#000000');
    expect(mixHex('#0A0A0A', '#000000', 0.5)).toBe('#050505');
  });
});
