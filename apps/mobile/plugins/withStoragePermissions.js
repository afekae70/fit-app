/**
 * Storage permissions, down to what the app uses — which on any phone from the last six years
 * is none.
 *
 * `expo-image-picker` and `expo-file-system` both declare READ_EXTERNAL_STORAGE and
 * WRITE_EXTERNAL_STORAGE on every Android version. The app needs neither for what it does:
 * every file it keeps is in its own folder (profile picture, progress photos, the widget's data),
 * the gallery is reached through the system picker, which hands over the one photo chosen and
 * needs no permission, and sharing goes through the system share sheet.
 *
 * One exception, found in expo-image-picker's Android source rather than assumed: on Android 9
 * and older, `launchCameraAsync` refuses to open the camera unless WRITE_EXTERNAL_STORAGE is
 * granted (`ensureCameraPermissionsAreGranted`, before Q). So:
 *
 *  - READ_EXTERNAL_STORAGE is blocked outright (app.json, `blockedPermissions`);
 *  - WRITE_EXTERNAL_STORAGE is kept up to Android 9 (API 28) only, here, where the camera needs
 *    it, and is gone from Android 10 on.
 *
 * If a feature ever reads or writes shared storage, this is the file that has to change.
 */

const { withAndroidManifest } = require('expo/config-plugins');

const { limitPermission } = require('./transforms.js');

/** Android 9. The camera's need for this permission ends with it. */
const LAST_VERSION_THAT_NEEDS_WRITE = 28;

module.exports = function withStoragePermissions(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = limitPermission(
      config.modResults,
      'android.permission.WRITE_EXTERNAL_STORAGE',
      LAST_VERSION_THAT_NEEDS_WRITE,
    );
    return config;
  });
};
