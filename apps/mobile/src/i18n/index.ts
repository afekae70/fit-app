/**
 * i18n + RTL setup.
 *
 * Hebrew is the default, so RTL is the default layout direction. Two things about RTL on React
 * Native that shape this file:
 *
 *  1. `I18nManager.forceRTL()` only takes effect after the JS bundle reloads. Toggling language
 *     at runtime therefore cannot re-lay-out the current screen — `setAppLanguage` reports
 *     whether a reload is required so the caller can prompt for it instead of silently doing
 *     nothing visible.
 *  2. Layout mirroring is driven by `I18nManager.isRTL`, NOT by which i18next language is
 *     active. Those can disagree (i18next switches instantly, RTL needs the reload), which is
 *     exactly the state `needsReloadForRtl` describes.
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
   * True when the native layout direction no longer matches the active language. The strings
   * have already switched; the mirroring has not, and cannot until the bundle reloads.
   */
  needsReloadForRtl: boolean;
}

export async function setAppLanguage(language: Language): Promise<LanguageChangeResult> {
  await i18next.changeLanguage(language);

  const shouldBeRtl = isRtlLanguage(language);
  const needsReloadForRtl = I18nManager.isRTL !== shouldBeRtl;

  if (needsReloadForRtl) {
    // Queued for the next launch — deliberately not paired with an automatic reload here,
    // which would discard unsaved input mid-workout.
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
  }

  return { language, needsReloadForRtl };
}
