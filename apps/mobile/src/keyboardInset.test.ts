/**
 * The padding that keeps a screen clear of the keyboard.
 *
 * A window 800 tall, and a keyboard whose top edge lands at 500.
 */

import { describe, expect, it } from 'vitest';

import { keyboardInset } from './keyboardInset.js';

describe('keyboardInset', () => {
  it('is the keyboard height for a view that fills the window', () => {
    expect(keyboardInset({ top: 0, height: 800, keyboardTop: 500 })).toBe(300);
  });

  it('counts where the view starts, not just how tall it is', () => {
    // The bug this replaced. A screen under an 80-pixel bar is 720 tall and ends at 800 —
    // measured from its parent it "ends" at 720, and the padding comes out 80 short.
    expect(keyboardInset({ top: 80, height: 720, keyboardTop: 500 })).toBe(300);
    expect(keyboardInset({ top: 0, height: 720, keyboardTop: 500 })).toBe(220);
  });

  it('needs less for a view that stops above the bottom edge', () => {
    // Under the bar and above a 94-pixel tab bar: it ends at 706, so only 206 is covered.
    expect(keyboardInset({ top: 80, height: 626, keyboardTop: 500 })).toBe(206);
  });

  it('is nothing for a view the keyboard does not reach', () => {
    expect(keyboardInset({ top: 80, height: 300, keyboardTop: 500 })).toBe(0);
  });

  it('is nothing while the keyboard is hidden', () => {
    expect(keyboardInset({ top: 0, height: 800, keyboardTop: null })).toBe(0);
  });

  it('adds the extra room asked for', () => {
    expect(keyboardInset({ top: 0, height: 800, keyboardTop: 500, offset: 16 })).toBe(316);
  });

  it('does nothing with a measurement that is not a number', () => {
    expect(keyboardInset({ top: Number.NaN, height: 800, keyboardTop: 500 })).toBe(0);
  });
});
