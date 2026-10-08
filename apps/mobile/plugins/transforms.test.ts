/**
 * The edits the config plugins make, run against the files Expo actually generates.
 *
 * The fixtures are the real thing — the MainActivity, MainApplication and build.gradle that
 * `expo prebuild` writes for SDK 54 — cut down to the parts that matter. An edit that works on a
 * file somebody imagined is how a plugin passes its tests and then does nothing in a build.
 *
 * Two properties are checked for every edit, because both have a way of failing silently: it
 * applies once however many times it runs, and it throws rather than returning the file
 * untouched when the place it edits is not there.
 */

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

// The plugins are CommonJS, because Expo loads them with `require`.
const require = createRequire(import.meta.url);
const {
  addHealthPermissionDelegate,
  addHeartRatePackage,
  addUploadSigning,
  addWearableDependency,
  readResourceEntries,
} = require('./transforms.js') as {
  addHealthPermissionDelegate: (source: string) => string;
  addHeartRatePackage: (source: string) => string;
  addUploadSigning: (source: string) => string;
  addWearableDependency: (source: string) => string;
  readResourceEntries: (xml: string, tag: string) => { name: string; value: string }[];
};

const MAIN_ACTIVITY = `package com.afeka.fitapp

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

const MAIN_APPLICATION = `package com.afeka.fitapp

import android.app.Application

import com.facebook.react.PackageList
import com.facebook.react.ReactPackage

import expo.modules.ApplicationLifecycleDispatcher

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }
      }
  )
}
`;

const BUILD_GRADLE = `android {
    namespace 'com.afeka.fitapp'
}

dependencies {
    // The version of react-native is set by the React Native Gradle Plugin
    implementation("com.facebook.react:react-android")

    if (hermesEnabled.toBoolean()) {
        implementation("com.facebook.react:hermes-android")
    }
}
`;

describe('addHealthPermissionDelegate', () => {
  const patched = addHealthPermissionDelegate(MAIN_ACTIVITY);

  it('registers the delegate straight after super.onCreate', () => {
    const lines = patched.split('\n');
    const onCreate = lines.findIndex((line) => line.includes('super.onCreate(null)'));
    const call = lines.findIndex((line) =>
      line.includes('HealthConnectPermissionDelegate.setPermissionDelegate(this)'),
    );

    expect(onCreate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(onCreate);
    // Inside the same function: before the brace that closes onCreate.
    const close = lines.findIndex((line, index) => index > onCreate && line === '  }');
    expect(call).toBeLessThan(close);
  });

  it('keeps the indentation of the function it is added to', () => {
    expect(patched).toContain('\n    HealthConnectPermissionDelegate.setPermissionDelegate(this)\n');
  });

  it('imports the class it calls', () => {
    expect(patched).toContain(
      'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n',
    );
    // And leaves the package line first, where Kotlin requires it.
    expect(patched.startsWith('package com.afeka.fitapp\n')).toBe(true);
  });

  it('does it once however many times it runs', () => {
    expect(addHealthPermissionDelegate(patched)).toBe(patched);
  });

  it('refuses a MainActivity it does not recognise', () => {
    // Returning the file unchanged here would build an app that closes when Health Connect is
    // switched on. A failed build is the better outcome.
    expect(() => addHealthPermissionDelegate('class MainActivity : ReactActivity()')).toThrow(
      /super\.onCreate/,
    );
  });
});

describe('addHeartRatePackage', () => {
  const patched = addHeartRatePackage(MAIN_APPLICATION);

  it('adds the package inside the list of packages', () => {
    const lines = patched.split('\n');
    const open = lines.findIndex((line) => line.includes('PackageList(this).packages.apply {'));
    const add = lines.findIndex((line) => line.trim() === 'add(HeartRatePackage())');
    const close = lines.findIndex((line, index) => index > open && line.trim() === '}');

    expect(add).toBeGreaterThan(open);
    expect(add).toBeLessThan(close);
  });

  it('imports the package', () => {
    expect(patched).toContain('import com.afeka.fitapp.heartrate.HeartRatePackage\n');
  });

  it('does it once however many times it runs', () => {
    expect(addHeartRatePackage(patched)).toBe(patched);
    expect(patched.match(/add\(HeartRatePackage\(\)\)/g)).toHaveLength(1);
  });

  it('refuses a MainApplication it does not recognise', () => {
    expect(() => addHeartRatePackage('import x\nclass MainApplication')).toThrow(/PackageList/);
  });
});

describe('addWearableDependency', () => {
  const patched = addWearableDependency(BUILD_GRADLE);

  it('adds the Data Layer inside the dependencies block', () => {
    expect(patched).toContain(
      '    implementation("com.google.android.gms:play-services-wearable:18.2.0")\n',
    );
    const dependencies = patched.slice(patched.indexOf('dependencies {'));
    expect(dependencies).toContain('play-services-wearable');
  });

  it('does it once however many times it runs', () => {
    expect(addWearableDependency(patched)).toBe(patched);
  });

  it('refuses a build.gradle it does not recognise', () => {
    expect(() => addWearableDependency('dependencies {\n}\n')).toThrow(/react-android/);
  });
});

// The signing block exactly as `expo prebuild` writes it for SDK 54.
const SIGNING_GRADLE = `android {
    namespace 'com.afeka.fitapp'
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('addUploadSigning', () => {
  const patched = addUploadSigning(SIGNING_GRADLE);

  it('reads the key from a file in the home directory, not from the project', () => {
    expect(patched).toContain(
      `new File(System.getenv('NOVAFIT_UPLOAD_KEY') ?: "\${System.getProperty('user.home')}/.novafit/upload-key.properties")`,
    );
  });

  it('declares the key before the block that uses it', () => {
    // Groovy reads top to bottom: a `def` after its first use is an unknown property.
    expect(patched.indexOf('def uploadKeyFile')).toBeLessThan(patched.indexOf('signingConfigs {'));
  });

  it('adds a release config beside the debug one', () => {
    const configs = patched.slice(patched.indexOf('signingConfigs {'), patched.indexOf('buildTypes {'));
    expect(configs).toContain('release {');
    expect(configs).toContain("storeFile file(uploadKey['storeFile'])");
    expect(configs).toContain("keyAlias uploadKey['keyAlias']");
    // And leaves the debug config as it was.
    expect(configs).toContain("storeFile file('debug.keystore')");
  });

  it('signs the release build with it, and only the release build', () => {
    const buildTypes = patched.slice(patched.indexOf('buildTypes {'));
    const debug = buildTypes.slice(buildTypes.indexOf('debug {'), buildTypes.indexOf('release {'));
    const release = buildTypes.slice(buildTypes.indexOf('release {'));

    expect(debug).toContain('signingConfig signingConfigs.debug');
    expect(release).toContain(
      'signingConfig uploadKeyFile.exists() ? signingConfigs.release : signingConfigs.debug',
    );
    // The plain debug line is gone from release: left behind, it would be the one Gradle used.
    expect(release).not.toMatch(/signingConfig signingConfigs\.debug\s*$/m);
  });

  it('still builds on a machine with no key, by falling back', () => {
    expect(patched).toContain('uploadKeyFile.exists() ?');
    expect(patched).toContain('if (uploadKeyFile.exists()) {');
  });

  it('does it once however many times it runs', () => {
    expect(addUploadSigning(patched)).toBe(patched);
    expect(patched.match(/def uploadKeyFile/g)).toHaveLength(1);
  });

  it('refuses a build.gradle whose release build it cannot find', () => {
    // Loading the key and then not using it would produce a Play bundle signed with the public
    // debug keystore - with nothing in the build output to say so.
    const noRelease = SIGNING_GRADLE.replace(/release \{[\s\S]*?\n        \}\n/, '');
    expect(() => addUploadSigning(noRelease)).toThrow(/release build type/);
    expect(() => addUploadSigning('android {\n}\n')).toThrow(/signingConfigs/);
  });
});

describe('readResourceEntries', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!--
  A comment that mentions <string name="not_real">nothing</string> on purpose.
-->
<resources>
    <string name="widget_label">האימון של היום</string>
    <string name="widget_start">התחל אימון</string>
    <color name="widget_surface">#FFFFFF</color>
</resources>
`;

  it('reads every entry of the kind asked for', () => {
    const colors = readResourceEntries(xml, 'color');
    expect(colors).toEqual([{ name: 'widget_surface', value: '#FFFFFF' }]);
  });

  it('keeps Hebrew as it is written', () => {
    const strings = readResourceEntries(xml, 'string');
    expect(strings.find((s) => s.name === 'widget_label')?.value).toBe('האימון של היום');
  });

  it('does not take an example in a comment for a resource', () => {
    const names = readResourceEntries(xml, 'string').map((s) => s.name);
    expect(names).toEqual(['widget_label', 'widget_start']);
  });

  it('finds nothing in a file with none', () => {
    expect(readResourceEntries('<resources/>', 'color')).toEqual([]);
  });
});
