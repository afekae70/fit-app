/**
 * The edits the config plugins make to generated source files, as plain functions over strings.
 *
 * Kept apart from the plugins themselves so they can be tested without running a prebuild: each
 * takes the text of a generated file and returns the text with one thing added.
 *
 * Two rules hold for all of them.
 *
 * **They are idempotent.** Prebuild can run over a project that was already generated, and an
 * edit that applies twice registers a package twice or declares a dependency twice.
 *
 * **They throw when they cannot find where to make the edit.** The alternative is returning the
 * file unchanged, which looks like success and ships an app without the thing the plugin exists
 * to add. For the Health Connect delegate that is not a missing feature, it is a crash: the app
 * closes the moment its switch is turned on. A build that fails with a sentence saying why is
 * the better outcome by a wide margin, and it is the only one that gets noticed before a user
 * finds it.
 *
 * CommonJS, because Expo loads config plugins with `require`.
 */

const HEALTH_IMPORT =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const HEALTH_CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

const HEART_RATE_IMPORT = 'import com.afeka.fitapp.heartrate.HeartRatePackage';
const HEART_RATE_ADD = 'add(HeartRatePackage())';

const WEARABLE_DEPENDENCY = 'com.google.android.gms:play-services-wearable';
const WEARABLE_VERSION = '18.2.0';

/** Put an import above the first one already there. Kotlin does not care about their order. */
function addKotlinImport(source, line, file) {
  if (source.includes(line)) return source;
  if (!/^import /m.test(source)) {
    throw new Error(`${file}: no import statements to add "${line}" beside.`);
  }
  return source.replace(/^import /m, `${line}\nimport `);
}

/**
 * Register Health Connect's permission launcher in `MainActivity.onCreate`.
 *
 * Health Connect asks for permission through an `ActivityResultLauncher`, which Android requires
 * to be registered before the activity starts. `react-native-health-connect` registers it nowhere
 * itself — its own config plugin only edits the manifest — so without this line the first
 * permission request throws `UninitializedPropertyAccessException` on a background dispatcher,
 * where no `try` in JavaScript can reach it.
 */
function addHealthPermissionDelegate(source) {
  if (source.includes(HEALTH_CALL)) return source;

  const onCreate = source.match(/^([ \t]*)super\.onCreate\([^)]*\)[ \t]*;?[ \t]*$/m);
  if (!onCreate) {
    throw new Error(
      'MainActivity: could not find super.onCreate(...) to register the Health Connect ' +
        'permission delegate after. Without it the app crashes when Health Connect is enabled.',
    );
  }

  const indent = onCreate[1];
  const added = [
    onCreate[0],
    `${indent}// Health Connect asks for its permissions through an ActivityResultLauncher, which has`,
    `${indent}// to be registered before the activity starts. Added by plugins/withHealthConnectNative.`,
    `${indent}${HEALTH_CALL}`,
  ].join('\n');

  return addKotlinImport(source.replace(onCreate[0], added), HEALTH_IMPORT, 'MainActivity');
}

/**
 * Register the heart-rate bridge in `MainApplication.getPackages()`.
 *
 * It lives in the app rather than in node_modules, which is the only place autolinking looks.
 */
function addHeartRatePackage(source) {
  if (source.includes(HEART_RATE_ADD)) return source;

  const packages = source.match(/^([ \t]*)PackageList\(this\)\.packages\.apply \{[ \t]*$/m);
  if (!packages) {
    throw new Error(
      'MainApplication: could not find "PackageList(this).packages.apply {" to register ' +
        'HeartRatePackage in.',
    );
  }

  const indent = `${packages[1]}  `;
  const added = [
    packages[0],
    `${indent}// The heart-rate bridge to the watch. Added by plugins/withHeartRateBridge.`,
    `${indent}${HEART_RATE_ADD}`,
  ].join('\n');

  return addKotlinImport(source.replace(packages[0], added), HEART_RATE_IMPORT, 'MainApplication');
}

/** Add the Wearable Data Layer to the app module's dependencies. */
function addWearableDependency(gradle) {
  if (gradle.includes(WEARABLE_DEPENDENCY)) return gradle;

  const anchor = gradle.match(/^([ \t]*)implementation\("com\.facebook\.react:react-android"\)[ \t]*$/m);
  if (!anchor) {
    throw new Error(
      'app/build.gradle: could not find the react-android dependency to add ' +
        `${WEARABLE_DEPENDENCY} beside.`,
    );
  }

  const indent = anchor[1];
  const added = [
    anchor[0],
    `${indent}// The channel to the NovaFit app on the watch. Added by plugins/withHeartRateBridge.`,
    `${indent}implementation("${WEARABLE_DEPENDENCY}:${WEARABLE_VERSION}")`,
  ].join('\n');

  return gradle.replace(anchor[0], added);
}

/**
 * Read `<string name="…">` or `<color name="…">` entries out of a resource file.
 *
 * The files in native/widget are real Android resource files, comments and all, so that they can
 * be read as what they are. This pulls the values out of one for merging into the project's own.
 */
function readResourceEntries(xml, tag) {
  const entries = [];
  const pattern = new RegExp(`<${tag}\\s+name="([^"]+)"\\s*>([\\s\\S]*?)</${tag}>`, 'g');
  // Comments first: these files explain themselves at length, and an example written in a
  // comment is not a resource.
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of live.matchAll(pattern)) {
    entries.push({ name: match[1], value: match[2] });
  }
  return entries;
}

module.exports = {
  addHealthPermissionDelegate,
  addHeartRatePackage,
  addWearableDependency,
  readResourceEntries,
};
