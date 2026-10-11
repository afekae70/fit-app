import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FONT_FAMILIES, familyFor, fontFor } from './fontFamily.js';

describe('the font file for a weight', () => {
  it('is the weight that was asked for', () => {
    expect(familyFor('400')).toBe('Rubik-Regular');
    expect(familyFor('500')).toBe('Rubik-Medium');
    expect(familyFor('600')).toBe('Rubik-SemiBold');
    expect(familyFor('700')).toBe('Rubik-Bold');
    expect(familyFor('800')).toBe('Rubik-ExtraBold');
  });

  it('reads a number the same as its string', () => {
    expect(familyFor(500)).toBe(familyFor('500'));
    expect(familyFor(700)).toBe(familyFor('700'));
  });

  it('is regular when no weight is given, as it is on the system font', () => {
    expect(familyFor(undefined)).toBe('Rubik-Regular');
    expect(familyFor(null)).toBe('Rubik-Regular');
  });

  it('understands the weights React Native accepts by name', () => {
    expect(familyFor('normal')).toBe('Rubik-Regular');
    expect(familyFor('bold')).toBe('Rubik-Bold');
    expect(familyFor('medium')).toBe('Rubik-Medium');
    expect(familyFor('semibold')).toBe('Rubik-SemiBold');
    expect(familyFor('heavy')).toBe('Rubik-ExtraBold');
  });

  it('answers with the nearest weight there is, at the ends nothing is bundled for', () => {
    expect(familyFor('100')).toBe('Rubik-Regular');
    expect(familyFor('300')).toBe('Rubik-Regular');
    expect(familyFor('900')).toBe('Rubik-ExtraBold');
  });

  it('treats something that is not a weight as regular rather than failing', () => {
    expect(familyFor('chunky')).toBe('Rubik-Regular');
    expect(familyFor(Number.NaN)).toBe('Rubik-Regular');
  });
});

describe('the font a text style is given', () => {
  it('follows the style’s weight', () => {
    expect(fontFor({ fontWeight: '700' })).toBe('Rubik-Bold');
    expect(fontFor({})).toBe('Rubik-Regular');
    expect(fontFor(undefined)).toBe('Rubik-Regular');
  });

  it('leaves a style that names its own font alone', () => {
    expect(fontFor({ fontFamily: 'monospace' })).toBeNull();
    expect(fontFor({ fontFamily: 'monospace', fontWeight: '700' })).toBeNull();
  });

  it('lets text inside other text inherit, instead of resetting it to regular', () => {
    // A coloured run inside a bold line: it has no weight of its own, so it must stay bold.
    expect(fontFor({}, { nested: true })).toBeNull();
    expect(fontFor(undefined, { nested: true })).toBeNull();
  });

  it('still gives nested text a font when it asks for a weight of its own', () => {
    expect(fontFor({ fontWeight: '700' }, { nested: true })).toBe('Rubik-Bold');
    expect(fontFor({ fontWeight: '400' }, { nested: true })).toBe('Rubik-Regular');
  });
});

describe('the bundled files', () => {
  const fonts = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));

  it('has a file for every name that can be handed out', () => {
    for (const family of Object.values(FONT_FAMILIES)) {
      expect(existsSync(`${fonts}${family}.ttf`), family).toBe(true);
    }
  });

  it('is loaded under exactly those names', () => {
    // The loader cannot be imported here — it requires .ttf files — so it is read as text.
    const loader = readFileSync(fileURLToPath(new URL('./loadFonts.ts', import.meta.url)), 'utf8');
    for (const [key, family] of Object.entries(FONT_FAMILIES)) {
      expect(loader, family).toContain(
        `[FONT_FAMILIES.${key}]: require('../../assets/fonts/${family}.ttf')`,
      );
    }
  });

  it('ships the licence the font is distributed under', () => {
    expect(readFileSync(`${fonts}OFL.txt`, 'utf8')).toContain('SIL Open Font License');
  });
});
