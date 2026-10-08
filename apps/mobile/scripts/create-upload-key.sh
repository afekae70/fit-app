#!/usr/bin/env bash
#
# Create the upload key that Google Play bundles are signed with. Run it once, yourself.
#
#   bash apps/mobile/scripts/create-upload-key.sh
#
# It asks for a password, makes a keystore, and writes the small properties file the build reads
# (see plugins/withReleaseSigning.js). Both go in ~/.novafit — the home directory, deliberately
# outside the project, which lives in OneDrive: a keystore beside its password in a synced folder
# is a keystore on someone else's servers.
#
# ## Why a person has to run this
#
# The password is the one thing here that nobody else should ever hold — not a collaborator, not
# an assistant, not a chat window. It is read with the terminal's echo off, handed to keytool
# through the environment rather than the command line (where any process listing shows it), and
# written to one file that only the build opens.
#
# ## It will not replace a key
#
# Once a bundle signed with this key has been uploaded, Google Play knows the app by it. A second
# key made by running this again would sign bundles Play refuses, and the first would be gone. So
# with a key already in place this stops and says so. Replacing one is a conversation with Google
# Play support, not a rerun.
#
# ## Keep a copy
#
# Back up the keystore and remember the password — a password manager is the right place. Losing
# them is recoverable (Google can register a new upload key on request), but it is days of
# waiting during which no update can ship.

set -euo pipefail

dir="$HOME/.novafit"
keystore="$dir/novafit-upload.keystore"
properties="$dir/upload-key.properties"
alias="novafit-upload"

if [ -e "$keystore" ] || [ -e "$properties" ]; then
  echo "There is already an upload key in $dir." >&2
  echo "This script does not replace one: see the note at the top of it." >&2
  exit 1
fi

keytool="$(command -v keytool || true)"
if [ -z "$keytool" ]; then
  for candidate in "$JAVA_HOME/bin/keytool" "/c/Program Files/Java/jdk-17/bin/keytool.exe"; do
    if [ -x "$candidate" ]; then keytool="$candidate"; break; fi
  done
fi
if [ -z "$keytool" ]; then
  echo "keytool was not found. It comes with the JDK; put its bin folder on PATH and try again." >&2
  exit 1
fi

echo "Choose a password for the upload key."
echo "At least 8 characters; letters, digits and . _ @ % + - only. Nothing is shown as you type."
read -r -s -p "Password: " password; echo
read -r -s -p "Again:    " confirm; echo

if [ "$password" != "$confirm" ]; then
  echo "The two did not match. Nothing was created." >&2
  exit 1
fi
# A plain alphabet on purpose: the password ends up in a Java properties file, where a backslash
# or a stray space changes what the build reads without saying so.
if ! printf '%s' "$password" | grep -Eq '^[A-Za-z0-9._@%+-]{8,}$'; then
  echo "That password has too few characters, or one that is not allowed. Nothing was created." >&2
  exit 1
fi

mkdir -p "$dir"

# Twenty-seven years. Google Play requires a key that outlives the app, and there is nothing to
# be gained from one that expires sooner.
NOVAFIT_KEY_PASSWORD="$password" "$keytool" -genkeypair \
  -storetype PKCS12 \
  -keystore "$keystore" \
  -alias "$alias" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass:env NOVAFIT_KEY_PASSWORD \
  -keypass:env NOVAFIT_KEY_PASSWORD \
  -dname "CN=NovaFit, O=NovaFit" >/dev/null

# Forward slashes: this is read by Java, where a backslash in a properties file is an escape.
store_path="$keystore"
if command -v cygpath >/dev/null 2>&1; then store_path="$(cygpath -m "$keystore")"; fi

umask 077
{
  printf 'storeFile=%s\n' "$store_path"
  printf 'storePassword=%s\n' "$password"
  printf 'keyAlias=%s\n' "$alias"
  printf 'keyPassword=%s\n' "$password"
} > "$properties"

unset password confirm

echo
echo "Done. Created:"
echo "  $keystore"
echo "  $properties"
echo
echo "Back both up somewhere that is not this computer, and keep the password in a password manager."
