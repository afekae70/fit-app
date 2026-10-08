/**
 * The padding that keeps a screen clear of the keyboard.
 *
 * The numbers are the real ones, read off the phone this was built for over adb: a display of
 * 1440 by 3120 at 2.875 pixels to the point — 1085dp tall — a status bar of 128px, 44.5dp, and a
 * keyboard whose top edge lands at 1856px, 645.6dp. A test with invented numbers is how the
 * status bar went missing from this sum in the first place.
 */

import { describe, expect, it } from 'vitest';

import { keyboardInset, toScreenY, windowTopFor } from './keyboardInset.js';

const STATUS_BAR = 44.5;
const KEYBOARD_TOP = 645.6;
const SCREEN = 1085.2;

describe('toScreenY', () => {
  it('puts back the status bar that measureInWindow leaves out', () => {
    // A view at the very top of the glass measures as minus the status bar.
    expect(toScreenY(-STATUS_BAR, STATUS_BAR)).toBe(0);
    expect(toScreenY(100, STATUS_BAR)).toBe(144.5);
  });

  it('changes nothing on a window that starts at the top of the screen', () => {
    expect(toScreenY(100, 0)).toBe(100);
  });

  it('does not let a bad inset move anything', () => {
    expect(toScreenY(100, Number.NaN)).toBe(100);
    expect(toScreenY(100, -20)).toBe(100);
  });
});

describe('windowTopFor', () => {
  it('is the status bar on Android, where the measurement leaves it out', () => {
    expect(windowTopFor('android', STATUS_BAR)).toBe(STATUS_BAR);
  });

  it('is nothing on iOS, where nothing was left out', () => {
    // An iPhone's top inset is the notch. Adding it here would open a gap that size above the
    // keyboard — the Android bug, mirrored.
    expect(windowTopFor('ios', 59)).toBe(0);
  });
});

describe('keyboardInset', () => {
  it('is the keyboard height for a view that fills the screen', () => {
    // Top of the glass to the bottom of it: measured from -44.5, 1085.2 tall.
    expect(
      keyboardInset({
        top: -STATUS_BAR,
        height: SCREEN,
        keyboardTop: KEYBOARD_TOP,
        windowTop: STATUS_BAR,
      }),
    ).toBe(Math.ceil(SCREEN - KEYBOARD_TOP));
  });

  it('counts the status bar that the measurement left out', () => {
    // The bug, in one line: the same view, with and without the conversion. The difference is
    // the status bar, and it is the half of the field that was hidden.
    const view = { top: 55.5, height: 900, keyboardTop: KEYBOARD_TOP };
    const right = keyboardInset({ ...view, windowTop: STATUS_BAR });
    const short = keyboardInset({ ...view, windowTop: 0 });

    expect(right).toBe(355);
    expect(right - short).toBe(45);
  });

  it('needs less for a view that stops above the bottom edge', () => {
    // A tab screen: it ends 94dp above the bottom, to leave room for the floating tab bar.
    const height = SCREEN - 94 - 100;
    expect(
      keyboardInset({
        top: 100 - STATUS_BAR,
        height,
        keyboardTop: KEYBOARD_TOP,
        windowTop: STATUS_BAR,
      }),
    ).toBe(Math.ceil(SCREEN - 94 - KEYBOARD_TOP));
  });

  it('is nothing for a view the keyboard does not reach', () => {
    expect(
      keyboardInset({ top: 80, height: 300, keyboardTop: KEYBOARD_TOP, windowTop: STATUS_BAR }),
    ).toBe(0);
  });

  it('is nothing while the keyboard is hidden', () => {
    expect(
      keyboardInset({ top: 0, height: SCREEN, keyboardTop: null, windowTop: STATUS_BAR }),
    ).toBe(0);
  });

  it('adds the extra room asked for', () => {
    const view = { top: 55.5, height: 900, keyboardTop: KEYBOARD_TOP, windowTop: STATUS_BAR };
    expect(keyboardInset({ ...view, offset: 16 })).toBe(keyboardInset(view) + 16);
  });

  it('does nothing with a measurement that is not a number', () => {
    expect(
      keyboardInset({
        top: Number.NaN,
        height: 900,
        keyboardTop: KEYBOARD_TOP,
        windowTop: STATUS_BAR,
      }),
    ).toBe(0);
  });
});
