/**
 * i18n + RTL setup.
 *
 * Hebrew is the default, so RTL is the default layout direction. Two things about RTL on React
 * Native that shape this file:
 *
 *  1. `I18nManager.forceRTL()` only takes effect after the JS bundle reloads. There is no
 *     in-place way to mirror the current screen, so a direction change always needs a restart.
 *  2. Layout mirroring is driven by `I18nManager.isRTL`, NOT by which i18next language is
 *     active. Those can disagree (i18next switches instantly, RTL needs the reload), and that
 *     disagreement is exactly what `directionChanged` below asks the caller to resolve.
 *
 * `setAppLanguage` deliberately does NOT call `Updates.reloadAsync()` to restart automatically.
 * This app doesn't use EAS Update (no channel configured, so the call would always be a no-op
 * at best) — and `expo-updates` was removed from the project entirely after it was identified
 * as the cause of an unrelated, far worse bug: any crash anywhere in the app, on Android with
 * the New Architecture, left the screen permanently blank instead of recovering, with
 * expo-updates' own crash-recovery machinery implicated (see the pinned upstream issue:
 * https://github.com/expo/expo/issues/41543 — "any crash JS or Native result in blank screen").
 * A manual "please reopen the app" prompt is a worse UX than an automatic reload, but it doesn't
 * carry that risk.
 */

import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

import { en } from './locales/en.js';
import { he } from './locales/he.js';

export const SUPPORTED_LANGUAGES = ['he', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'he';
const RTL_LANGUAGES = new Set<Language>(['he']);

export const isRtlLanguage = (language: Language): boolean => RTL_LANGUAGES.has(language);

/**
 * The English bundle must have exactly the same *shape* as the Hebrew one, so a missing or
 * misspelled English key is a compile error rather than a runtime missing-string bug.
 *
 * `WidenStrings` is what makes that check work: both bundles are declared `as const`, so their
 * values are literal types ("פיט", "Fit"). Comparing them directly would demand the English
 * text equal the Hebrew text. Widening every leaf to `string` compares keys and nesting only.
 */
type WidenStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]>;
};

type Resources = WidenStrings<typeof he>;
const enTyped: Resources = en;

/** Pick a starting language from the device locale, falling back to Hebrew. */
export function detectDeviceLanguage(): Language {
  const locales = getLocales();
  const primary = locales[0]?.languageCode;
  return SUPPORTED_LANGUAGES.includes(primary as Language)
    ? (primary as Language)
    : DEFAULT_LANGUAGE;
}

export function initI18n(language: Language = detectDeviceLanguage()): typeof i18next {
  // Align the native layout direction with the starting language. On a cold start this is
  // applied before the first render, so no reload is needed for the initial language.
  const shouldBeRtl = isRtlLanguage(language);
  if (I18nManager.isRTL !== shouldBeRtl) {
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
  }

  void i18next.use(initReactI18next).init({
    resources: {
      he: { translation: he },
      en: { translation: enTyped },
    },
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    // React Native has no need for escaping — it is not injecting into HTML, and escaping
    // mangles Hebrew punctuation such as the geresh in ק"ג.
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  return i18next;
}

export interface LanguageChangeResult {
  language: Language;
  /**
   * True when the layout direction had to change. The native RTL flag is already written by
   * the time this returns — only the *running* UI hasn't picked it up yet, since that requires
   * a bundle reload this function deliberately doesn't attempt (see the file header). The
   * caller shows a "reopen the app" hint whenever this is true.
   */
  directionChanged: boolean;
}

/**
 * Switch language, and flip the stored layout-direction flag with it.
 *
 * `forceRTL` writes a native flag read at startup — the change is real and persisted the
 * instant this returns, it just doesn't paint until the app restarts. See the file header for
 * why this doesn't attempt that restart itself.
 */
export async function setAppLanguage(language: Language): Promise<LanguageChangeResult> {
  await i18next.changeLanguage(language);

  const shouldBeRtl = isRtlLanguage(language);
  const directionChanged = I18nManager.isRTL !== shouldBeRtl;

  if (directionChanged) {
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
  }

  return { language, directionChanged };
}
