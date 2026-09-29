import { describe, expect, it } from 'vitest';

import { createLatestOnly } from './latestOnly.js';

describe('only the newest read reaches the screen', () => {
  it('keeps the last ticket handed out and stales the ones before it', () => {
    const latest = createLatestOnly();
    const first = latest.begin();
    expect(latest.isCurrent(first)).toBe(true);

    const second = latest.begin();
    expect(latest.isCurrent(first)).toBe(false);
    expect(latest.isCurrent(second)).toBe(true);
  });

  it('holds when an overtaken read finishes last — the vanishing tick', () => {
    const latest = createLatestOnly();
    // A read starts before a set is ticked; the tick's own read starts after it.
    const before = latest.begin();
    const afterTick = latest.begin();

    // They finish in the wrong order. Only the newer one is allowed to paint.
    expect(latest.isCurrent(afterTick)).toBe(true);
    expect(latest.isCurrent(before)).toBe(false);
  });

  it('gives each instance its own count', () => {
    const one = createLatestOnly();
    const two = createLatestOnly();
    const ticket = one.begin();
    two.begin();
    expect(one.isCurrent(ticket)).toBe(true);
  });
});
