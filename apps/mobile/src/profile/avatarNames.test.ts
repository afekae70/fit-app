import { describe, expect, it } from 'vitest';

import {
  avatarFileName,
  avatarObjectPath,
  avatarStoreKey,
  newAvatarVersion,
} from './avatarNames.js';

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

describe('profile picture tags', () => {
  it('gives every picture a different tag', () => {
    expect(newAvatarVersion(1_791_000_000_000)).not.toBe(newAvatarVersion(1_791_000_000_001));
  });

  it('uses only what the server accepts in a tag, and what is safe in a path', () => {
    // The same pattern as the CHECK on profiles.avatar_version, and as `canonical` in sync.
    for (const now of [0, 1, 1_791_000_000_000, Number.MAX_SAFE_INTEGER, -5, 12.7]) {
      expect(newAvatarVersion(now)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it('files the pictures of each account in a folder of its own', () => {
    const mine = avatarObjectPath('11111111-1111-4111-8111-111111111111', 'p1');
    const theirs = avatarObjectPath('22222222-2222-4222-8222-222222222222', 'p1');
    expect(mine).toBe('11111111-1111-4111-8111-111111111111/p1');
    expect(mine.split('/')[0]).not.toBe(theirs.split('/')[0]);
  });
});
