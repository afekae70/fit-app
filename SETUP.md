# Working on this project from another machine

`git clone` gives you the code. It deliberately does **not** give you the secrets. This is what
is missing and how to restore it.

## The short version

Most work needs no secrets at all.

| I want to… | What I need |
| --- | --- |
| Work on the mobile app, run it, build it | `npm install` + `npx eas-cli login` |
| Deploy or update the API | Railway access (secrets already live there) |
| Run the API server **locally** | the above **plus** `apps/api/.env` |

The mobile app reads its configuration from `apps/mobile/app.json` → `expo.extra`, which **is**
committed. The values there are safe to publish: the API base URL is public, and the Supabase
key is the `anon` key, whose whole design is to ship inside client apps — Row Level Security is
what protects the data, not the secrecy of that key.

## First-time setup

```bash
git clone https://github.com/afekae70/fit-app.git
cd fit-app
npm install
```

Then verify the checkout is healthy before changing anything:

```bash
npm run typecheck && npm test
```

Everything should pass. If it does not, fix that before writing code — you are then debugging
one problem instead of two.

## Signing credentials (nothing to do)

The Android keystore is **not** in this repo and does not need to be. It is stored on Expo's
servers and is attached to the EAS account, so `eas build` on a new machine picks up the same
credentials automatically after `eas login`.

This matters more than it looks: an app signed with a different key cannot update an installed
app, it can only be installed alongside it as a separate app. Keeping the keystore on EAS is
what makes a new machine a non-event.

## Restoring `apps/api/.env`

Only needed to run the API service locally. Copy `.env.example` to `apps/api/.env` and fill it
in. **Never commit it** — `.gitignore` already blocks it, and that block should stay.

Every value can be re-fetched from its source, which is safer than copying the file between
machines over chat or email:

| Variable | Where it comes from |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API |
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | Supabase dashboard → Project Settings → Database → Connection string |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `AI_PROVIDER`, `ANTHROPIC_MODEL`, `PORT`, `NODE_ENV`, `LOG_LEVEL` | not secret — see `.env.example` for the defaults |

Two things worth knowing:

- **An existing Anthropic key cannot be viewed again** after it is created. Create a new one for
  the second machine rather than hunting for the old value; old keys keep working, and you can
  revoke any of them independently.
- `SUPABASE_SERVICE_ROLE_KEY` **bypasses Row Level Security entirely**. It belongs only in this
  file and in the Railway service's environment variables. It must never reach `app.json`, the
  mobile bundle, or a commit.

## Building the APK locally

`eas build` is the documented path above and needs no local toolchain. If the EAS plan is not
available, the whole build can run on the machine — but three things about this repository make
that harder than `./gradlew assembleRelease`, and each one fails in a way that does not name its
own cause. Every one of them cost real debugging time.

You need a JDK and the Android SDK installed, and `ANDROID_HOME` (or `android/local.properties`)
pointing at the SDK.

### 1. Build from a path with no Hebrew and no OneDrive

`npx expo prebuild` run from this checkout creates `android/` and leaves it **empty**, silently.
The project lives under a Hebrew directory name inside OneDrive, and prebuild does not cope with
it. Copy the tree somewhere plain first:

```bash
git archive --format=tar HEAD | (mkdir -p /c/Users/you/fit-build && tar -x -C /c/Users/you/fit-build)
cd /c/Users/you/fit-build && npm install
```

Work there for builds, and keep editing in the real checkout — copy `apps/mobile/app`,
`apps/mobile/src` and `packages/shared/src` across before each build.

### 2. Use `./gradlew` from git bash, never `gradlew.bat`

`gradlew.bat` dies with `-classpath requires class path specification` — it builds an empty
CLASSPATH next to `-jar`. The POSIX `gradlew` under git bash works.

Note that `android/local.properties` is a Java properties file, so its paths need **forward**
slashes. A Windows path with backslashes produces "The filename, directory name, or volume label
syntax is incorrect", which reads like a missing SDK rather than an escaping problem.

### 3. Re-apply two patches after every `prebuild --clean`

Both live in generated files, so a clean prebuild wipes them.

**Bundle the JS yourself.** Gradle's `createBundleReleaseJsAndAssets` passes `--entry-file`
relative to `apps/mobile` while Metro resolves against the monorepo root, and the two never
agree. Skipping the task with `-x` does not work either — downstream tasks query the skipped
task's output provider and fail. Instead, tell Gradle release is "debuggable" purely so it stops
bundling, in `android/app/build.gradle` inside the `react { }` block:

```groovy
debuggableVariants = ["debug", "release"]
```

then produce the bundle with an absolute entry path before each build:

```bash
cd apps/mobile
npx expo export:embed --platform android --dev false \
  --entry-file "C:/Users/you/fit-build/node_modules/expo-router/entry.js" \
  --bundle-output "C:/Users/you/fit-build/apps/mobile/android/app/src/main/assets/index.android.bundle" \
  --assets-dest "C:/Users/you/fit-build/apps/mobile/android/app/src/main/res"
cd android && ./gradlew assembleRelease
```

**Changing the app icon.** `app.json` points at `apps/mobile/assets/`, and `expo prebuild`
turns those files into the `mipmap-*` resources Android actually ships. Because `android/` is
gitignored and lives only in the build tree, editing the assets alone changes nothing in a build
that skips prebuild — the old icons are already sitting in `mipmap-*`. Either run prebuild, or
overwrite the resources directly at each density: the adaptive canvas is 108dp
(108/162/216/324/432 px for mdpi through xxxhdpi) and the legacy icon is 48dp. A `.png` replaces
a `.webp` of the same name, but delete the `.webp` or both will exist.

The master artwork is committed as `assets/logo-source.jpg`, since every icon is a crop of it
and a different crop cannot be made from a 1024px export.

**Check the Bluetooth permission.** `BLUETOOTH_SCAN` must carry
`android:usesPermissionFlags="neverForLocation"`, or on Android 12+ every scan returns zero
devices with no error at all. `app.json` deliberately does not list that permission so the
`react-native-ble-plx` plugin can add it with the flag — see the header of
`apps/mobile/src/ble/scanner.ts` for the full story. Verify:

```bash
grep BLUETOOTH_SCAN android/app/src/main/AndroidManifest.xml
```

A plain `expo prebuild` merges into the existing manifest and will happily preserve a broken
line, so use `--clean` when this needs fixing.

### Installing

```bash
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Local release builds are signed with the debug key, so they update each other in place but
**cannot** update an EAS-signed install — Android refuses, and the only way across is to
uninstall, which takes the local database with it. Pick one signing route per device and stay on
it.

## Accounts you may need to sign into

- **Expo / EAS** — `npx eas-cli login` (builds, signing credentials)
- **Supabase** — web dashboard (database, auth users, SQL editor)
- **Railway** — web dashboard (the deployed API and its environment variables)
- **Anthropic** — console (the coach's API key and its billing)

## Day-to-day between two machines

```bash
git pull
```

before you start, and

```bash
git push
```

when you stop. The repository is the only thing that has to move between machines.
