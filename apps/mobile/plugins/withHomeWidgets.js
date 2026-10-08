/**
 * The two home-screen widgets, built into the Android project.
 *
 * A widget is native: a `RemoteViews` layout the launcher draws in its own process, which React
 * Native cannot render into. The sources are in native/widget — two providers, their layouts,
 * their metadata, three drawables, and the strings and colours they use — and this carries them
 * into the generated project and declares the two receivers.
 *
 * Everything here was once done by a script on one computer. The details that script learned the
 * hard way are kept:
 *
 *  - **The receivers are exported.** The broadcast that draws a widget comes from the launcher,
 *    another app. A provider marked `exported="false"` is never offered in the widget list.
 *  - **The colours are merged into `values-night` as well as `values`.** That pair is the whole
 *    mechanism by which the widgets follow the phone's light and dark; a night file that silently
 *    received nothing is how they once stayed white after dark.
 *
 * native/widget/README.md has the longer account.
 */

const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} = require('expo/config-plugins');

const { assertPackage, copyNativeFiles, readNativeFile } = require('./nativeFiles');
const { readResourceEntries } = require('./transforms');

const PLUGIN = 'withHomeWidgets';
const FOLDER = 'widget';

const FILES = {
  'TodayWidgetProvider.kt': 'java/com/afeka/fitapp/widget/TodayWidgetProvider.kt',
  'WeekWidgetProvider.kt': 'java/com/afeka/fitapp/widget/WeekWidgetProvider.kt',
  'today_widget.xml': 'res/layout/today_widget.xml',
  'week_widget.xml': 'res/layout/week_widget.xml',
  'today_widget_info.xml': 'res/xml/today_widget_info.xml',
  'week_widget_info.xml': 'res/xml/week_widget_info.xml',
  'today_widget_background.xml': 'res/drawable/today_widget_background.xml',
  'today_widget_button.xml': 'res/drawable/today_widget_button.xml',
  'week_widget_ring_preview.xml': 'res/drawable/week_widget_ring_preview.xml',
};

const RECEIVERS = [
  { name: '.widget.TodayWidgetProvider', label: '@string/widget_label', info: '@xml/today_widget_info' },
  { name: '.widget.WeekWidgetProvider', label: '@string/widget_week_label', info: '@xml/week_widget_info' },
];

function withWidgetSources(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      assertPackage(config, PLUGIN);
      copyNativeFiles({
        projectRoot: config.modRequest.projectRoot,
        platformProjectRoot: config.modRequest.platformProjectRoot,
        folder: FOLDER,
        files: FILES,
        plugin: PLUGIN,
      });
      return config;
    },
  ]);
}

function withWidgetStrings(config) {
  return withStringsXml(config, (config) => {
    const xml = readNativeFile(config.modRequest.projectRoot, FOLDER, 'widget_strings.xml', PLUGIN);
    const entries = readResourceEntries(xml, 'string');
    if (entries.length === 0) throw new Error(`${PLUGIN}: widget_strings.xml holds no strings.`);

    config.modResults = AndroidConfig.Strings.setStringItem(
      entries.map(({ name, value }) => ({ $: { name }, _: value })),
      config.modResults,
    );
    return config;
  });
}

/** Merge one colour file. A file that yields nothing is an error, not an empty merge. */
function mergeColors(config, file) {
  const xml = readNativeFile(config.modRequest.projectRoot, FOLDER, file, PLUGIN);
  const entries = readResourceEntries(xml, 'color');
  if (entries.length === 0) throw new Error(`${PLUGIN}: ${file} holds no colours.`);

  for (const { name, value } of entries) {
    config.modResults = AndroidConfig.Colors.assignColorValue(config.modResults, {
      name,
      value: value.trim(),
    });
  }
  return config;
}

function withWidgetColors(config) {
  config = withAndroidColors(config, (config) => mergeColors(config, 'widget_colors.xml'));
  return withAndroidColorsNight(config, (config) => mergeColors(config, 'widget_colors_night.xml'));
}

function withWidgetReceivers(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) throw new Error(`${PLUGIN}: the manifest has no <application>.`);

    const receivers = application.receiver ?? [];
    for (const { name, label, info } of RECEIVERS) {
      if (receivers.some((receiver) => receiver.$?.['android:name'] === name)) continue;
      receivers.push({
        $: { 'android:name': name, 'android:exported': 'true', 'android:label': label },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
        ],
        'meta-data': [
          { $: { 'android:name': 'android.appwidget.provider', 'android:resource': info } },
        ],
      });
    }
    application.receiver = receivers;
    return config;
  });
}

module.exports = function withHomeWidgets(config) {
  return withWidgetReceivers(withWidgetColors(withWidgetStrings(withWidgetSources(config))));
};
