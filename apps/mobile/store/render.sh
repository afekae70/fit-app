#!/usr/bin/env bash
#
# Render the Google Play graphics from the HTML beside this file, with headless Chrome:
#
#   store/out/icon-512.png          the app icon, 512 × 512
#   store/out/feature-graphic.png   the banner at the top of the store page, 1024 × 500
#
# Run from apps/mobile under git bash. The PNGs are not committed; render them when needed.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
chrome="/c/Program Files/Google/Chrome/Application/chrome.exe"
mkdir -p "$here/out"

shot() {
  local page="$1" size="$2" out="$3"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=4000 \
    --window-size="$size" --screenshot="$(cygpath -w "$here/out/$out")" \
    "file:///$(cygpath -m "$here/$page")" 2>/dev/null
  echo "$out"
}

shot icon.html 512,512 icon-512.png
shot feature-graphic.html 1024,500 feature-graphic.png
