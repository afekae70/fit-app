/**
 * Copying the app's hand-written Android sources into the generated project.
 *
 * The `android/` folder is generated and not in the repository, so native code that belongs to
 * this app — the widgets, the heart-rate bridge — lives under `native/` and has to be carried
 * across whenever the project is generated. Until these plugins it was carried by hand.
 *
 * The Kotlin files name their own package (`com.afeka.fitapp.…`) and import the app's `R` and
 * `MainActivity` from it, so the application id is checked rather than assumed: a rename in
 * app.json should fail here, with a sentence, and not in the Kotlin compiler twenty minutes into
 * a cloud build.
 */

const fs = require('fs');
const path = require('path');

const EXPECTED_PACKAGE = 'com.afeka.fitapp';

/** Where `native/<folder>` is, given the project root Expo hands to a mod. */
function nativeSource(projectRoot, folder) {
  return path.join(projectRoot, 'native', folder);
}

function assertPackage(config, plugin) {
  const actual = config.android?.package;
  if (actual !== EXPECTED_PACKAGE) {
    throw new Error(
      `${plugin}: the native sources are written for the package ${EXPECTED_PACKAGE}, but ` +
        `app.json says ${actual}. Change the package lines in native/ to match before building.`,
    );
  }
}

/**
 * Copy files from `native/<folder>` into the Android project.
 *
 * `files` maps a source file name to its destination under `android/app/src/main/`. A source
 * file that is missing is an error: a widget whose layout was not copied compiles and then
 * crashes the launcher when it tries to draw.
 */
function copyNativeFiles({ projectRoot, platformProjectRoot, folder, files, plugin }) {
  const from = nativeSource(projectRoot, folder);
  const main = path.join(platformProjectRoot, 'app', 'src', 'main');

  for (const [name, destination] of Object.entries(files)) {
    const source = path.join(from, name);
    if (!fs.existsSync(source)) {
      throw new Error(`${plugin}: native/${folder}/${name} is missing.`);
    }
    const target = path.join(main, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function readNativeFile(projectRoot, folder, name, plugin) {
  const source = path.join(nativeSource(projectRoot, folder), name);
  if (!fs.existsSync(source)) {
    throw new Error(`${plugin}: native/${folder}/${name} is missing.`);
  }
  return fs.readFileSync(source, 'utf8');
}

module.exports = { assertPackage, copyNativeFiles, readNativeFile };
