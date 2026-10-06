/**
 * How far the list moves when a number is tapped.
 *
 * A screen of 800, a keyboard whose top lands at 500, and a bar 90 tall on top of it: the list
 * can be seen down to 410. Everything here is measured against that line.
 */

import { describe, expect, it } from 'vitest';

import { scrollToReveal } from './revealRow.js';

const keyboard = { keyboardTop: 500, barHeight: 90 };

describe('scrollToReveal', () => {
  it('leaves a row alone when it is already in view', () => {
    expect(scrollToReveal({ ...keyboard, row: { y: 200, height: 56 } })).toBe(0);
  });

  it('leaves a row alone when it just clears the bar with its margin', () => {
    // Bottom at 398, twelve of air, and the bar begins at 410.
    expect(scrollToReveal({ ...keyboard, row: { y: 342, height: 56 } })).toBe(0);
  });

  it('lifts a row that is behind the bar by exactly what hides it', () => {
    // Bottom at 456: 46 under the line, plus the margin.
    expect(scrollToReveal({ ...keyboard, row: { y: 400, height: 56 } })).toBe(58);
  });

  it('lifts a row that is behind the keyboard itself', () => {
    expect(scrollToReveal({ ...keyboard, row: { y: 640, height: 56 } })).toBe(298);
  });

  it('never scrolls the other way', () => {
    // A row high on the page is not pulled down to sit above the keys.
    expect(scrollToReveal({ ...keyboard, row: { y: 20, height: 56 } })).toBe(0);
  });

  it('counts only the keyboard when the bar has not been measured yet', () => {
    expect(scrollToReveal({ keyboardTop: 500, barHeight: 0, row: { y: 460, height: 56 } })).toBe(28);
  });

  it('honours a different margin', () => {
    expect(scrollToReveal({ ...keyboard, margin: 0, row: { y: 400, height: 56 } })).toBe(46);
  });

  it('does nothing with a measurement that is not a number', () => {
    // A row measured while unmounting reports nonsense; the list must not leap because of it.
    expect(scrollToReveal({ ...keyboard, row: { y: Number.NaN, height: 56 } })).toBe(0);
    expect(scrollToReveal({ keyboardTop: Number.NaN, barHeight: 90, row: { y: 400, height: 56 } })).toBe(0);
  });
});
