#!/usr/bin/env bash
#
# Build the Android app from a generated project.
#
#   scripts/build-android.sh            a release APK, for installing directly
#   scripts/build-android.sh bundle     a release AAB, for Google Play
#
# Run it from the build tree (see SETUP.md), under git bash.
#
# It exists for two things.
#
# ## The export below
#
# Gradle bundles the JavaScript itself, by running Expo's `export:embed`. On Windows, React
# Native hands that command the entry file as a path relative to apps/mobile — and Expo, seeing a
# monorepo, resolves it against the repository root instead. The two never agree, the bundle step
# fails, and for a long time the answer here was to switch Gradle's bundling off and run the
# export by hand before every build.
#
# That workaround had a cost nobody was looking at: it shipped the bundle as plain JavaScript,
# which the phone parses again at every launch, instead of the compiled Hermes bytecode a release
# build is supposed to carry.
#
# Telling Expo to root Metro at the app, as it did before it learned about monorepos, makes the
# two agree. metro.config.js already does the monorepo's work itself — watch folders, module
# paths — so nothing is lost. eas.json sets the same variable for cloud builds, so a build made
# there is the build made here.
#
# ## Refusing to make a Play bundle without the upload key
#
# With no key on the machine the build quietly signs with the template's debug keystore, which is
# right for an APK going onto a phone on the desk. For a bundle it is a waste of ten minutes:
# Google Play rejects it at upload, and by then the reason is a web page away from the build
# that caused it. So the check is here, before anything is compiled. It looks only for the file —
# it never reads what is in it.
#
# ## The two outputs are signed with different keys, on purpose
#
# A bundle goes to Google Play and is signed with the upload key. An APK goes straight onto a
# phone, and it is signed with the debug key *even when the upload key is present* — because the
# app already on that phone was, and Android installs an update only over the same signature.
# Left to the build's own rule ("use the upload key if there is one"), creating the upload key
# would have silently changed what every later APK is signed with, and the next
# `adb install -r` would have failed with INSTALL_FAILED_UPDATE_INCOMPATIBLE. The only way past
# that error is to uninstall, which takes the workout log with it.
#
# So `apk` points the build at a key file that is not there. That is the whole mechanism: the
# signing config falls back to debug when the file is missing. A phone that has moved to the
# Play version has no use for these APKs any more — Play signs with a third key again.

set -euo pipefail

export EXPO_NO_METRO_WORKSPACE_ROOT=1

upload_key="${NOVAFIT_UPLOAD_KEY:-$HOME/.novafit/upload-key.properties}"

cd "$(dirname "$0")/../android"

case "${1:-apk}" in
  apk)
    NOVAFIT_UPLOAD_KEY="/no-upload-key-for-sideloaded-builds" ./gradlew :app:assembleRelease
    ;;
  bundle)
    if [ ! -f "$upload_key" ]; then
      echo "No upload key at $upload_key." >&2
      echo "A bundle for Google Play has to be signed with it; without it this would be signed" >&2
      echo "with the public debug keystore and refused at upload. See plugins/withReleaseSigning.js." >&2
      exit 1
    fi
    ./gradlew :app:bundleRelease
    ;;
  *)
    echo "usage: $0 [apk|bundle]" >&2
    exit 2
    ;;
esac
