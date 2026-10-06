# The watch app — live heart rate during a workout

A Galaxy Watch does not hand its heart rate to other apps. Samsung Health does not stream, and
Health Connect is a store of finished records that Samsung Health syncs into every few minutes —
never a feed. So the only route to a number that changes while you are mid-set is a small app on
the wrist that reads the sensor itself and sends each reading across:

```
watch sensor → HeartRateService (this folder) → Wearable Data Layer
            → HeartRateModule (native/heartrate) → `novafit-heart-rate` event
            → useLiveHeartRate() → the workout header
```

The phone asks the watch to start when a workout opens and to stop when it ends, so in the
ordinary case nobody touches the watch at all.

## The two rules that make the Data Layer deliver anything

The Wearable Data Layer only passes messages between apps that share **an application id and a
signing certificate**. Break either and nothing is delivered and nothing is logged — the readings
simply never arrive.

- `build.gradle` sets `applicationId 'com.afeka.fitapp'`, the phone's. Only the `namespace`
  differs (`com.afeka.fitapp.wear`), so the two modules' R classes and packages do not collide.
- It signs with `../app/debug.keystore`, the phone's key. Check with
  `apksigner verify --print-certs` on both APKs: the SHA-256 digests must be identical.

## Building it

Like the widget, none of this is applied by a build, because the `android/` project is generated
and `expo prebuild` is not run here (it would regenerate the signing config and force an uninstall
— see native/widget/README.md). Into the generated project:

| From | To |
| --- | --- |
| `wear/build.gradle` | `android/wear/build.gradle` |
| `wear/AndroidManifest.xml` | `android/wear/src/main/AndroidManifest.xml` |
| `wear/*.kt` | `android/wear/src/main/java/com/afeka/fitapp/wear/` |
| `wear/activity_main.xml` | `android/wear/src/main/res/layout/` |
| `wear/button.xml`, `wear/ic_heart.xml` | `android/wear/src/main/res/drawable/` |
| `wear/strings.xml` | `android/wear/src/main/res/values/` |
| the phone app's `mipmap-*dpi/ic_launcher.png` | `android/wear/src/main/res/mipmap-*dpi/` |
| `heartrate/*.kt` | `android/app/src/main/java/com/afeka/fitapp/heartrate/` |

and three one-line edits:

```gradle
// android/settings.gradle
include ':wear'

// android/app/build.gradle, in dependencies
implementation("com.google.android.gms:play-services-wearable:18.2.0")
```

```kotlin
// android/app/src/main/java/com/afeka/fitapp/MainApplication.kt, in getPackages()
add(HeartRatePackage())
```

Then `./gradlew :wear:assembleRelease :app:assembleRelease`. The watch APK is
`android/wear/build/outputs/apk/release/wear-release.apk`.

## Installing on the watch

There is no cable. Wear OS installs over **wireless debugging**, with the watch and the computer
on the same Wi-Fi:

1. On the watch: Settings → About watch → Software information → tap **Software version** seven
   times. Developer options appears under Settings.
2. Developer options → **ADB debugging** on → **Wireless debugging** on → **Pair new device**. The
   watch shows an address, a port and a six-digit code.
3. On the computer: `adb pair <address>:<pairing port>` and type the code when asked.
4. `adb connect <address>:<port>` — the port on the Wireless debugging screen itself, which is
   **not** the pairing port.
5. `adb -s <address>:<port> install -r wear-release.apk`

Open NovaFit on the watch once and allow the sensor. After that the phone drives it.

## Decisions worth knowing before changing anything

**`SensorManager`, not Health Services' `ExerciseClient`.** ExerciseClient owns the idea of "an
exercise": it would start a second workout on the watch, competing with the one the phone is
recording, and Samsung Health would then write its own session for the same hour — which is the
duplicate entry the Health Connect export is careful never to create. All this wants is a number.

**A foreground service with a partial wake lock.** An activity stops hearing from the sensor when
it is not visible, and the heart-rate sensor is not a wake-up sensor: with the CPU asleep the
readings stop. A workout is an hour with the wrist down and the screen off, so both are necessary.
The lock has a three-hour ceiling in case a session is never finished.

**Target SDK 34.** There the sensor permission is `BODY_SENSORS`. At target 36 it becomes
`android.permission.health.READ_HEART_RATE`, and raising the target means changing the manifest
and the request in `MainActivity` together.

**Messages, not synced data.** A heart rate from four seconds ago is worth nothing, so there is no
point in a transport that guarantees eventual delivery. A reading that cannot be sent is dropped.

**The phone's listener is registered at runtime**, in `HeartRateModule`, for as long as a workout
is open — not as a manifest `WearableListenerService`. That would be an exported component woken
once a second; this is neither.

**Remote start is best effort.** Wear OS restricts starting a foreground service from the
background, and whether a Data Layer message counts as permission has varied between releases.
`PhoneListenerService` tries and swallows a refusal; opening the app on the watch always works.

## What the phone does with a reading

Everything about what a reading *means* is in `src/workout/heartRate.ts`, pure and tested: which
values are a pulse and which are a sensor off the skin, how long a reading stays current (eight
seconds — a frozen number is one someone will pace a set against), and which zone it falls in
against a maximum estimated from the profile's birth date. The header shows nothing at all when
there is no fresh reading, so training without a watch looks exactly as it did before.
