#!/usr/bin/env bash
#
# Build the Android app from a generated project.
#
#   scripts/build-android.sh            a release APK, for installing directly
#   scripts/build-android.sh bundle     a release AAB, for Google Play
#
# Run it from the build tree (see SETUP.md), under git bash.
#
# It exists for one line, the export below.
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

set -euo pipefail

export EXPO_NO_METRO_WORKSPACE_ROOT=1

cd "$(dirname "$0")/../android"

case "${1:-apk}" in
  apk)    ./gradlew :app:assembleRelease ;;
  bundle) ./gradlew :app:bundleRelease ;;
  *)      echo "usage: $0 [apk|bundle]" >&2; exit 2 ;;
esac
