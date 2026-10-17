/**
 * What keeps progress photos private on the phone, held in place by tests.
 *
 *  - **Out of Google backup and phone-to-phone transfer.** Android backs up an app's files unless
 *    told otherwise; the rules this app ships with (expo-secure-store's, applied by its plugin in
 *    app.json) list only small settings files, and a rule that names what to include backs up
 *    nothing else — not the database, not the photos folder. If those rules ever stop being the
 *    ones applied, or start including files, these fail.
 *  - **In the app's own folder**, which no other app can read.
 *  - **Behind a fingerprint**, by the rules in `lockRules.ts`.
 *  - **Unasked-for permissions blocked.** The screenshot blocker's library declares photo-library
 *    access and screenshot detection, for features this app does not use.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetPhotosUnlock,
  locksOnReturn,
  needsUnlock,
  PHOTO_UNLOCK_GRACE_MS,
  photosLastUnlockedAt,
  photosUnlockedNow,
} from './lockRules.js';

const mobile = join(import.meta.dirname, '../..');
const secureStoreXml = join(
  mobile,
  '../../node_modules/expo-secure-store/android/src/main/res/xml',
);
const appJson = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8')) as {
  expo: { plugins: unknown[]; android: { blockedPermissions: string[] } };
};

const includes = (xml: string) =>
  [...xml.matchAll(/<include\s+domain="([^"]+)"/g)].map((m) => m[1]);

describe('progress photos and Android backup', () => {
  it('applies expo-secure-store’s backup rules, not turned off', () => {
    const entry = appJson.expo.plugins.find(
      (plugin) =>
        plugin === 'expo-secure-store' ||
        (Array.isArray(plugin) && plugin[0] === 'expo-secure-store'),
    );
    expect(entry).toBeDefined();
    const options = Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : {};
    expect(options.configureAndroidBackup).not.toBe(false);
  });

  it('backs up settings files only, on Android 11 and lower', () => {
    const xml = readFileSync(join(secureStoreXml, 'secure_store_backup_rules.xml'), 'utf8');
    expect(includes(xml)).toEqual(['sharedpref']);
  });

  it('backs up and transfers settings files only, on Android 12 and higher', () => {
    const xml = readFileSync(
      join(secureStoreXml, 'secure_store_data_extraction_rules.xml'),
      'utf8',
    );
    for (const section of ['cloud-backup', 'device-transfer']) {
      const body = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? '';
      expect(includes(body), section).toEqual(['sharedpref']);
    }
  });

  it('keeps the photos in the app’s own documents folder', () => {
    const files = readFileSync(join(mobile, 'src/progressPhotos/files.ts'), 'utf8');
    expect(files).toContain("new Directory(Paths.document, 'progress-photos', userId)");
  });

  it('blocks the permissions the screenshot blocker brings and does not need', () => {
    expect(appJson.expo.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.DETECT_SCREEN_CAPTURE',
      ]),
    );
  });
});

describe('the fingerprint in front of the photos', () => {
  beforeEach(() => forgetPhotosUnlock());

  it('asks the first time, and after a restart', () => {
    expect(needsUnlock(null, Date.now())).toBe(true);
    expect(photosLastUnlockedAt()).toBeNull();
  });

  it('does not ask twice within a moment — back from the camera, back to a photo', () => {
    photosUnlockedNow(1_000);
    expect(needsUnlock(photosLastUnlockedAt(), 1_000 + 30_000)).toBe(false);
    expect(needsUnlock(photosLastUnlockedAt(), 1_000 + PHOTO_UNLOCK_GRACE_MS)).toBe(false);
  });

  it('asks again once that moment has passed', () => {
    photosUnlockedNow(1_000);
    expect(needsUnlock(photosLastUnlockedAt(), 1_000 + PHOTO_UNLOCK_GRACE_MS + 1)).toBe(true);
  });

  it('locks on coming back after time away, and not after a glance at another app', () => {
    expect(locksOnReturn(null, 10_000)).toBe(false);
    expect(locksOnReturn(0, 20_000)).toBe(false);
    expect(locksOnReturn(0, PHOTO_UNLOCK_GRACE_MS + 1)).toBe(true);
  });

  it('is two minutes', () => {
    expect(PHOTO_UNLOCK_GRACE_MS).toBe(120_000);
  });
});
