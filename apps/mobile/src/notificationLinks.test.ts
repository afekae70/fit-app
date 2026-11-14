import { describe, expect, it } from 'vitest';

import { notificationTarget } from './notificationLinks.js';

describe('where a tapped notification may lead', () => {
  it('opens the week’s summary from the Saturday reminder', () => {
    expect(notificationTarget({ url: '/week-summary' })).toBe('/week-summary');
  });

  it('opens nothing it was not built to: no data, other screens, outside links', () => {
    expect(notificationTarget(undefined)).toBeNull();
    expect(notificationTarget({})).toBeNull();
    expect(notificationTarget({ url: '/settings' })).toBeNull();
    expect(notificationTarget({ url: 'https://example.com' })).toBeNull();
    expect(notificationTarget({ url: 42 })).toBeNull();
  });
});
