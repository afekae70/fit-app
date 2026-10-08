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
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API |
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | Supabase dashboard → Project Settings → Database → Connection string |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `AI_PROVIDER`, `ANTHROPIC_MODEL`, `PORT`, `NODE_ENV`, `LOG_LEVEL` | not secret — see `.env.example` for the defaults |

Two things worth knowing:

- **An existing Anthropic key cannot be viewed again** after it is created. Create a new one for
  the second machine rather than hunting for the old value; old keys keep working, and you can
  revoke any of them independently.
- **Do not set `SUPABASE_SERVICE_ROLE_KEY` anywhere.** It bypasses Row Level Security entirely —
  it is the one credential that can read and rewrite every user's data. The API used to require
  it and never read it; nothing needs it now. A secret that is set but unused is pure blast
  radius: it buys nothing and is one leaked environment away from handing over the whole
  database. If it is still set in Railway, delete the variable there and rotate the key.

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

### 3. Generate the project, then build it with the script

`android/` is generated and not in git. Everything that used to be applied to it by hand — the
widgets, the Health Connect fix, the heart-rate bridge, the manifest trimming for Google Play — is
now a config plugin under `apps/mobile/plugins/`, registered in `app.json`. So generating the
project is all it takes:

```bash
cd apps/mobile
npx expo prebuild --platform android --no-install
scripts/build-android.sh           # an APK;  `scripts/build-android.sh bundle` for an AAB
```

**Use the script, not `./gradlew assembleRelease` on its own.** It sets
`EXPO_NO_METRO_WORKSPACE_ROOT=1`, without which Gradle's JavaScript bundling fails on Windows in
this monorepo: React Native passes the entry file relative to `apps/mobile`, Expo resolves it
against the repository root, and the two never agree. The script's header has the whole story.

This replaces an older workaround, which is worth knowing about because traces of it linger: the
release variant was declared "debuggable" in `app/build.gradle` so that Gradle would stop
bundling, and the bundle was produced by hand with `expo export:embed` before every build. It
worked, and it quietly shipped the bundle as plain JavaScript — parsed again at every launch —
rather than compiled Hermes bytecode. **Do not reintroduce `debuggableVariants`.**

**Never change `android.package` or `ios.bundleIdentifier` to rename the app.** The display name
is `expo.name`; the package is where Android keeps the app's private storage. Changing it does
not rename anything — it installs a **second** app beside the first and leaves every logged
workout in the original. This was tried and reverted: because the new name and icon had already
shipped to the old package, the two were indistinguishable on the home screen, and the one being
opened every day was the one that had stopped receiving updates. The identifier is invisible to
users and tidying it is worth nothing next to that.

**`expo prebuild --clean` deletes one thing that is not in git**, and the build fails without
naming it:

| File | Symptom if missing |
|---|---|
| `android/local.properties` | "SDK location not found" |

Copy it back after a clean prebuild.

**The signing key is not one of those things, whatever an earlier version of this file said.**
It claimed that losing `android/app/debug.keystore` meant a new signing key and a forced
reinstall. It does not: that keystore comes from the Expo template, and prebuild writes the
identical file every time (same SHA-256, same certificate — checked). Which is the actual
problem with it. Every Expo and React Native project has that same file with the password
`android`, so anyone can sign an update to this app. It is fine for a developer's own phone and
unacceptable for anyone else's; the app must be signed with a private key before it is
distributed. See `apps/mobile/native/widget/README.md`.

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
