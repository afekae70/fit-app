import { describe, expect, it } from 'vitest';

import { showsBackButton } from './backButtonRule.js';

describe('where the floating back button shows', () => {
  it('shows on every screen opened from a tab', () => {
    expect(showsBackButton(['food'])).toBe(true);
    expect(showsBackButton(['settings'])).toBe(true);
    expect(showsBackButton(['session', '[id]'])).toBe(true);
    expect(showsBackButton(['workout-progress'])).toBe(true);
  });

  it('does not show on the tabs, which have the tab bar', () => {
    expect(showsBackButton(['(tabs)'])).toBe(false);
    expect(showsBackButton(['(tabs)', 'progress'])).toBe(false);
  });

  it('does not show before the router knows where it is', () => {
    expect(showsBackButton([])).toBe(false);
  });

  it('leaves alone the screens with their own way out', () => {
    expect(showsBackButton(['auth', 'sign-in'])).toBe(false);
    expect(showsBackButton(['exercise-picker'])).toBe(false);
    expect(showsBackButton(['shortcut', '[action]'])).toBe(false);
  });
});
