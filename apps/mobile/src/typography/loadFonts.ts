/**
 * The font files, by the names `fontFamily.ts` hands out.
 *
 * Bundled with the app rather than fetched: this is used in gyms and on bases where signal is
 * worst, and text that changes shape when the network finally answers is worse than text in
 * the wrong font. Loaded once at launch, before the first screen is drawn — see the root
 * layout, which waits for it.
 *
 * Kept apart from `fontFamily.ts` because a `require` of a `.ttf` is something only the bundler
 * understands; the mapping next door stays importable from a test.
 *
 * Rubik is licensed under the SIL Open Font License; the licence travels with the files, in
 * `assets/fonts/OFL.txt`.
 */

import { useFonts, type FontSource } from 'expo-font';
import { useEffect, useState } from 'react';

import { FONT_FAMILIES, type FontFamilyName } from './fontFamily.js';

/* eslint-disable @typescript-eslint/no-require-imports -- assets are resolved by the bundler */
export const FONT_SOURCES: Record<FontFamilyName, FontSource> = {
  [FONT_FAMILIES.regular]: require('../../assets/fonts/Rubik-Regular.ttf') as FontSource,
  [FONT_FAMILIES.medium]: require('../../assets/fonts/Rubik-Medium.ttf') as FontSource,
  [FONT_FAMILIES.semibold]: require('../../assets/fonts/Rubik-SemiBold.ttf') as FontSource,
  [FONT_FAMILIES.bold]: require('../../assets/fonts/Rubik-Bold.ttf') as FontSource,
  [FONT_FAMILIES.extrabold]: require('../../assets/fonts/Rubik-ExtraBold.ttf') as FontSource,
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * How long launch waits for the typeface before going on without it.
 *
 * Loading five bundled files takes tens of milliseconds, so this is never reached in a build
 * that works. It is here for the one that does not: the screen is held blank while the fonts
 * load, and a load that neither finished nor failed would otherwise hold it blank for good.
 * An app in the system font is an app; a blank one is not.
 */
const FONT_WAIT_MS = 2500;

/**
 * True once text can be drawn: the typeface is loaded, or loading it failed, or it has taken
 * too long to go on waiting for.
 *
 * Text laid out before the font arrives is not redrawn when it does — nothing about its props
 * changed — which is why the first screen waits rather than rendering and catching up. When
 * the font cannot be had, its names simply resolve to the system font, which is how the app
 * looked before it had one of its own.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_SOURCES);
  const [gaveUp, setGaveUp] = useState(false);
  const settled = loaded || error !== null;

  useEffect(() => {
    if (settled) return undefined;
    const timer = setTimeout(() => setGaveUp(true), FONT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [settled]);

  return settled || gaveUp;
}
