import { describe, expect, it } from 'vitest';

import { avatarFileName, avatarStoreKey } from './avatarNames.js';

describe('profile picture names', () => {
  it('keeps each user apart', () => {
    expect(avatarStoreKey('3f2a-11')).not.toBe(avatarStoreKey('9b7c-22'));
  });

  it('uses only characters SecureStore and the file system accept', () => {
    expect(avatarStoreKey('user@mail.com/x')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(avatarFileName('user@mail.com/x', 1)).toMatch(/^[A-Za-z0-9_-]+\.jpg$/);
  });

  it('gives every new picture a new file name', () => {
    expect(avatarFileName('u', 1)).not.toBe(avatarFileName('u', 2));
  });
});
