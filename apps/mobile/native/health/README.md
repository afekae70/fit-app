# Health Connect — the manifest half

Writing a workout into Health Connect needs three things the JavaScript cannot declare for
itself. Two of them `app.json` covers and `expo prebuild` would generate; the third it would not.

**Prebuild is not run here.** It regenerates `app/build.gradle` and with it the signing config
this build relies on — release APKs are signed with the debug key, and an APK signed by a
different key cannot install over the one on the phone without uninstalling it first, taking every
workout logged on the device with it. So these go into the generated project by hand, the same
way the widget does.

## 1. The write permissions

In `app.json` already, and in `android/app/src/main/AndroidManifest.xml` next to the READ set:

```xml
<uses-permission android:name="android.permission.health.WRITE_EXERCISE"/>
<uses-permission android:name="android.permission.health.WRITE_DISTANCE"/>
<uses-permission android:name="android.permission.health.WRITE_ACTIVE_CALORIES_BURNED"/>
```

One per record type, because that is how Health Connect grants them: the user can allow the
workout and refuse the calories, which `writer.ts` handles by sending only what was allowed.

Nothing asks to write weight or heart rate. This app does not measure either, and a permission
list longer than the feature is what makes people refuse the whole thing.

## 2. The rationale filter, on Android 13 and below

The `react-native-health-connect` config plugin adds this to `.MainActivity` and it is already in
the generated manifest:

```xml
<intent-filter>
  <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>
</intent-filter>
```

## 3. The rationale alias, on Android 14 and up — the part nothing generates

From Android 14 Health Connect is part of the platform rather than an installable app, and it
reaches an app's privacy rationale through a different route: an exported alias of the main
activity, guarded by `START_VIEW_PERMISSION_USAGE` so only the system can start it.

```xml
<activity-alias
  android:name="ViewPermissionUsageActivity"
  android:exported="true"
  android:targetActivity=".MainActivity"
  android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE"/>
    <category android:name="android.intent.category.HEALTH_PERMISSIONS"/>
  </intent-filter>
</activity-alias>
```

The target phone runs Android 16, where the filter in (2) is never consulted. Without this alias
Health Connect has nowhere to send someone who taps through to ask what the app wants the
permission for.

## 4. The line in `MainActivity.kt` without which the app dies

`android/app/src/main/java/com/afeka/fitapp/MainActivity.kt`:

```kotlin
import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate
...
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
  }
```

Health Connect asks for permission through an `ActivityResultLauncher`, which Android requires to
be registered on the activity before that activity is started. `react-native-health-connect`
registers it nowhere itself — its `app.plugin.js` only adds the manifest filter in (2) — so
without this line the very first permission request throws

```
kotlin.UninitializedPropertyAccessException: lateinit property requestPermission has not been
initialized
    at dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate.launchPermissionsDialog
```

on a background dispatcher, where no `try` in JavaScript can reach it: the app simply closes the
moment the switch is turned on. This was shipped once without it, and that is exactly what it did.

## Where the rest of it lives

| Piece | File |
| --- | --- |
| Which records a workout becomes | `src/health/export.ts` (pure, tested) |
| The native module, loaded lazily | `src/health/native.ts` |
| Permissions and the insert | `src/health/writer.ts` |
| The toggle, one workout, the backfill | `src/health/sync.ts` |
| The switch in Settings | `src/components/HealthSyncCard.tsx` |

## Samsung Health does not read it automatically

Health Connect is the store; Samsung Health is another app that reads it, and only once the user
allows NovaFit's data through: Samsung Health → Settings → Health Connect → allow. Until then the
workouts are in Health Connect (visible in its own "Browse data" screen) and nowhere else, which
looks exactly like a failed write but is not one.
