/**
 * Declarations the app inherits from its libraries and has no use for.
 *
 * A manifest is merged from every library's own, and a library declares what it *might* need.
 * `expo-audio` can show lock-screen controls and record in the background, so its manifest
 * declares a foreground service for each — unconditionally, with no plugin option to leave them
 * out. This app plays a beep at the end of an interval. It does neither.
 *
 * That would be untidy and nothing more, except that Google Play reads it literally. An app
 * targeting Android 14 that declares a foreground service must justify each type in the Play
 * Console, with a description and a video of the feature — and there is no feature to film. The
 * `microphone` one sits oddly beside a manifest that blocks RECORD_AUDIO, too.
 *
 * So the two services are removed from the merged manifest here, and the permissions that go
 * with them are in `blockedPermissions` in app.json.
 *
 * ## Why this is safe, and what would make it stop being safe
 *
 * Checked against expo-audio's Android source rather than assumed. `AudioControlsService` is
 * started by `setActiveForLockScreen(true)` and by nothing else; the only other calls into it are
 * `clearSession()`, which is `getInstance()?.…` — a no-op while the service has never run.
 * `AudioRecordingService` is started by the recorder alone.
 *
 * The moment this app asks for lock-screen controls or records audio, this file has to go: a
 * service that is started without being declared is an exception, not a missing feature.
 */

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const UNUSED_SERVICES = [
  'expo.modules.audio.service.AudioControlsService',
  'expo.modules.audio.service.AudioRecordingService',
];

module.exports = function withStoreManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    const application = manifest.manifest.application?.[0];
    if (!application) throw new Error('withStoreManifest: the manifest has no <application>.');

    const services = application.service ?? [];
    for (const name of UNUSED_SERVICES) {
      if (services.some((service) => service.$?.['android:name'] === name)) continue;
      // `tools:node="remove"` is an instruction to the merger: drop this element, whichever
      // library contributed it. The entry itself never reaches the final manifest.
      services.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    application.service = services;

    config.modResults = manifest;
    return config;
  });
};
