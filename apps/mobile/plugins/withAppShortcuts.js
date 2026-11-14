/**
 * The app-icon shortcuts, built into the Android project.
 *
 * Holding the app's icon on the home screen offers "start today's workout", "add a glass of
 * water" and "log food" (asked for by the owner, 2026-11-13). They are static shortcuts: a
 * resource file listing them, and one line of metadata on the launcher activity pointing at it.
 * The sources are in native/shortcuts; this copies the list, merges the names into the strings,
 * and adds the metadata.
 *
 * What each one does is not native at all: each opens a link the router receives
 * (app/shortcut/[action].tsx), so the behaviour lives with the rest of the app and is tested there.
 */
const { AndroidConfig, withAndroidManifest, withDangerousMod, withStringsXml } = require('expo/config-plugins');
const { assertPackage, copyNativeFiles, readNativeFile } = require('./nativeFiles');
const { readResourceEntries } = require('./transforms');

const PLUGIN = 'withAppShortcuts';
const FOLDER = 'shortcuts';
const META = 'android.app.shortcuts';

function withShortcutSources(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      assertPackage(config, PLUGIN);
      copyNativeFiles({
        projectRoot: config.modRequest.projectRoot,
        platformProjectRoot: config.modRequest.platformProjectRoot,
        folder: FOLDER,
        files: { 'shortcuts.xml': 'res/xml/shortcuts.xml' },
        plugin: PLUGIN,
      });
      return config;
    },
  ]);
}

function withShortcutStrings(config) {
  return withStringsXml(config, (config) => {
    const xml = readNativeFile(config.modRequest.projectRoot, FOLDER, 'shortcut_strings.xml', PLUGIN);
    const entries = readResourceEntries(xml, 'string');
    if (entries.length === 0) throw new Error(`${PLUGIN}: shortcut_strings.xml holds no strings.`);
    config.modResults = AndroidConfig.Strings.setStringItem(
      entries.map(({ name, value }) => ({ $: { name }, _: value })),
      config.modResults,
    );
    return config;
  });
}

/** The metadata goes on the launcher activity: that is where the launcher looks for it. */
function withShortcutMetadata(config) {
  return withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const metadata = activity['meta-data'] ?? [];
    if (!metadata.some((entry) => entry.$?.['android:name'] === META)) {
      metadata.push({ $: { 'android:name': META, 'android:resource': '@xml/shortcuts' } });
    }
    activity['meta-data'] = metadata;
    return config;
  });
}

module.exports = function withAppShortcuts(config) {
  return withShortcutMetadata(withShortcutStrings(withShortcutSources(config)));
};
