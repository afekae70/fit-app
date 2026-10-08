/**
 * The phone's half of the live heart rate, built into the Android project.
 *
 * `NovaFitHeartRate` is a native module that lives in this app rather than in a package: it
 * hears the readings the watch app sends over the Wearable Data Layer and hands them to
 * JavaScript. Three things make it exist in a build, and this does all three:
 *
 *  1. the two Kotlin files, copied from native/heartrate;
 *  2. the Data Layer library, added to the app module's dependencies;
 *  3. the package, registered in `MainApplication` — autolinking only looks in node_modules.
 *
 * The watch app itself (native/wear) is deliberately not part of this. It is a second
 * application module with its own APK, built and installed separately, and a phone build has no
 * use for it. The phone side is harmless without it: with no watch sending, there is no reading,
 * and the workout header shows nothing where the number would be.
 */

const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const { assertPackage, copyNativeFiles } = require('./nativeFiles');
const { addHeartRatePackage, addWearableDependency } = require('./transforms');

const PLUGIN = 'withHeartRateBridge';

const FILES = {
  'HeartRateModule.kt': 'java/com/afeka/fitapp/heartrate/HeartRateModule.kt',
  'HeartRatePackage.kt': 'java/com/afeka/fitapp/heartrate/HeartRatePackage.kt',
};

function withBridgeSources(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      assertPackage(config, PLUGIN);
      copyNativeFiles({
        projectRoot: config.modRequest.projectRoot,
        platformProjectRoot: config.modRequest.platformProjectRoot,
        folder: 'heartrate',
        files: FILES,
        plugin: PLUGIN,
      });
      return config;
    },
  ]);
}

function withWearableDependency(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(`${PLUGIN}: app/build.gradle is ${config.modResults.language}, not Groovy.`);
    }
    config.modResults.contents = addWearableDependency(config.modResults.contents);
    return config;
  });
}

function withPackageRegistered(config) {
  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(`${PLUGIN}: MainApplication is ${config.modResults.language}, not Kotlin.`);
    }
    config.modResults.contents = addHeartRatePackage(config.modResults.contents);
    return config;
  });
}

module.exports = function withHeartRateBridge(config) {
  return withPackageRegistered(withWearableDependency(withBridgeSources(config)));
};
