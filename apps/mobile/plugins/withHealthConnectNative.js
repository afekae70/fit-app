/**
 * The two pieces of Health Connect that nothing else generates.
 *
 * `react-native-health-connect` ships a config plugin, and it adds one intent filter to the
 * manifest. Two more things are needed for the feature to work on a current phone, and until this
 * file existed both were applied by hand to a generated project on one computer — which meant a
 * build made anywhere else, a cloud build included, shipped without them.
 *
 * 1. **The permission delegate in `MainActivity`.** Without it the first permission request
 *    throws on a background dispatcher and the app closes. See `addHealthPermissionDelegate`.
 *
 * 2. **The rationale alias, for Android 14 and up.** From Android 14 Health Connect is part of
 *    the platform and reaches an app's privacy rationale through an exported alias of the main
 *    activity, guarded by `START_VIEW_PERMISSION_USAGE` so only the system can start it. The
 *    filter the library's plugin adds is the Android 13 route and is never consulted on 14+.
 *
 * The write permissions themselves are in app.json, where Expo already knows what to do with
 * them. native/health/README.md has the longer account, including the stack trace.
 */

const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const { addHealthPermissionDelegate } = require('./transforms');

const ALIAS = 'ViewPermissionUsageActivity';

function withRationaleAlias(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('withHealthConnectNative: the manifest has no <application>.');
    }

    const aliases = application['activity-alias'] ?? [];
    if (!aliases.some((alias) => alias.$?.['android:name'] === ALIAS)) {
      aliases.push({
        $: {
          'android:name': ALIAS,
          'android:exported': 'true',
          'android:targetActivity': '.MainActivity',
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
          },
        ],
      });
    }
    application['activity-alias'] = aliases;
    return config;
  });
}

function withPermissionDelegate(config) {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(
        `withHealthConnectNative: MainActivity is ${config.modResults.language}, and this ` +
          'plugin only knows how to edit Kotlin.',
      );
    }
    config.modResults.contents = addHealthPermissionDelegate(config.modResults.contents);
    return config;
  });
}

module.exports = function withHealthConnectNative(config) {
  return withPermissionDelegate(withRationaleAlias(config));
};
