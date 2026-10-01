# The home-screen widget

Android widgets are native: a `RemoteViews` layout rendered by the launcher in its own process,
which React Native cannot draw into. These three files are that widget, kept here because the
`android/` project itself is generated and not in the repository — and under `native/widget/`
rather than `native/android/`, since the repository ignores every path named `android/` and would
have swallowed these too.

**They are not applied by a build.** Copy them into the generated project, and add the receiver to
the manifest, before `gradlew assembleRelease`:

```
android/app/src/main/java/com/afeka/fitapp/widget/TodayWidgetProvider.kt
android/app/src/main/res/layout/today_widget.xml
android/app/src/main/res/xml/today_widget_info.xml
```

and inside `<application>` in `android/app/src/main/AndroidManifest.xml` — **exported, which a
widget provider must be**: the broadcast that draws it comes from the launcher, another app, so a
receiver marked `exported="false"` is one the system never offers in the widget list at all:

```xml
<receiver android:name=".widget.TodayWidgetProvider" android:exported="true">
  <intent-filter>
    <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
  </intent-filter>
  <meta-data android:name="android.appwidget.provider" android:resource="@xml/today_widget_info"/>
</receiver>
```

**Why not a config plugin and `expo prebuild`.** Prebuild would regenerate `app/build.gradle` and
with it the signing config this build relies on — release APKs here are signed with the debug key,
and an APK signed by a different key cannot install over the one on the phone. It would have to be
uninstalled first, taking every workout logged on the device with it.

## What it shows, and where that comes from

The widget never touches the database. The app writes `widget.json` into its own files directory
whenever the home screen loads — today's workout, how many exercises it has, and a line of what
is in it — and the widget reads that file. A launcher process querying SQLite would be a second
reader of a database the app keeps open, for a label that changes once a day.

An empty or missing file is a rest day or a fresh install, and the widget says so rather than
rendering a blank slab.
