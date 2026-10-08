/**
 * Release builds signed with the app's own key, not the one every project shares.
 *
 * Until this, every build of the app — the one on its author's phone included — was signed with
 * `debug.keystore` from the Expo template. That file is identical in every Expo and React Native
 * project and its password is `android`: it identifies nobody. Android accepts an update when it
 * is signed with the same key as what is installed, so anyone could have produced one.
 *
 * Google Play will not take a bundle signed with it. With Play App Signing the arrangement is two
 * keys: Google holds the one the app is finally signed with, and the developer holds an *upload*
 * key that proves a bundle came from them. This wires the build to that upload key.
 *
 * ## Where the key is, and where it is not
 *
 * Not in the repository, and not in the project folder either — that folder is inside OneDrive,
 * and a keystore beside its password in a synced directory is a keystore on someone else's
 * servers. The build reads a small properties file from the home directory instead:
 *
 *     ~/.novafit/upload-key.properties
 *
 *     storeFile=C:/Users/you/.novafit/novafit-upload.keystore
 *     storePassword=…
 *     keyAlias=novafit-upload
 *     keyPassword=…
 *
 * `NOVAFIT_UPLOAD_KEY` overrides the path. Without the file the build signs with the debug key as
 * before — fine for a phone on a desk, and `scripts/build-android.sh bundle` refuses to go on.
 *
 * Losing the upload key is recoverable, which is the point of the two-key arrangement: Google can
 * register a new one. Losing a self-managed app signing key is not, and is why this app does not
 * manage one.
 */

const { withAppBuildGradle } = require('expo/config-plugins');

const { addUploadSigning } = require('./transforms');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        `withReleaseSigning: app/build.gradle is ${config.modResults.language}, not Groovy.`,
      );
    }
    config.modResults.contents = addUploadSigning(config.modResults.contents);
    return config;
  });
};
