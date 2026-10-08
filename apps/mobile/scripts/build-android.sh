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

set -euo pipefail

export EXPO_NO_METRO_WORKSPACE_ROOT=1

upload_key="${NOVAFIT_UPLOAD_KEY:-$HOME/.novafit/upload-key.properties}"

cd "$(dirname "$0")/../android"

case "${1:-apk}" in
  apk)
    ./gradlew :app:assembleRelease
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
