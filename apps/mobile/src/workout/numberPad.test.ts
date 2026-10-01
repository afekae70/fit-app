import { describe, expect, it } from 'vitest';

import { padText, padValue, pressKey } from './numberPad.js';

const type = (keys: string, options?: Parameters<typeof pressKey>[2]) =>
  [...keys].reduce((text, key) => pressKey(text, key as never, options), '');

describe('typing into the pad', () => {
  it('builds a number a key at a time, first keystroke included', () => {
    expect(type('1')).toBe('1');
    expect(type('13')).toBe('13');
    expect(type('13.75')).toBe('13.75');
  });

  it('keeps one decimal point and no more', () => {
    expect(type('1.5.')).toBe('1.5');
    expect(pressKey('.', '.')).toBe('.');
  });

  it('opens a bare point as a nought', () => {
    expect(type('.')).toBe('0.');
    expect(type('.5')).toBe('0.5');
  });

  it('refuses a decimal point where only whole numbers make sense', () => {
    expect(type('8.5', { decimals: false })).toBe('85');
  });

  it('holds at two decimals — the quarter-kilo plates that exist', () => {
    expect(type('13.756')).toBe('13.75');
  });

  it('does not stack leading zeros', () => {
    expect(type('00')).toBe('0');
    expect(type('05')).toBe('5');
  });

  it('refuses a fifth whole digit rather than letting the field run away', () => {
    expect(type('123456')).toBe('1234');
  });

  it('deletes a key at a time, and clears outright', () => {
    expect(pressKey('13.7', 'back')).toBe('13.');
    expect(pressKey('1', 'back')).toBe('');
    expect(pressKey('', 'back')).toBe('');
    expect(pressKey('82.5', 'clear')).toBe('');
  });
});

describe('what the pad holds', () => {
  it('reads a finished number', () => {
    expect(padValue('13.75')).toBe(13.75);
    expect(padValue('0')).toBe(0);
  });

  it('means nothing while it means nothing', () => {
    expect(padValue('')).toBeNull();
    expect(padValue('.')).toBeNull();
  });

  it('opens on what is already recorded', () => {
    expect(padText(82.5)).toBe('82.5');
    expect(padText(null)).toBe('');
  });
});
