/**
 * i18n + RTL setup.
 *
 * Hebrew is the default, so RTL is the default layout direction. Two things about RTL on React
 * Native that shape this file:
 *
 *  1. `I18nManager.forceRTL()` only takes effect after the JS bundle reloads. There is no way to
 *     mirror the current screen in place, so `setAppLanguage` performs the reload itself rather
 *     than leaving the user on a half-switched screen: strings in the new language, layout still
 *     in the old direction.
 *  2. Layout mirroring is driven by `I18nManager.isRTL`, NOT by which i18next language is
 *     active. Those can disagree (i18next switches instantly, RTL needs the reload), and that
 *     disagreement is precisely the state the reload exists to close.
 *
 * Reloading is safe here because every workout edit is written to SQLite as it happens — there
 * is no in-memory draft to lose. The only casualty is a field mid-keystroke.
 */

import { getLocales } from 'expo-localization';
import * as Updates from 'expo-updates';
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
   * True when the layout direction had to change, meaning a reload was triggered. Callers can
   * use it to show a brief "switching…" state; on success the reload replaces the UI before
   * anything rendered from it is visible for long.
   */
  directionChanged: boolean;
  /**
   * Set only when the reload could not be performed. The direction is queued for the next
   * launch, so the caller must fall back to asking the user to restart the app manually.
   */
  reloadFailed?: boolean;
}

/**
 * Switch language, and flip the layout direction with it.
 *
 * `forceRTL` writes a native flag read at startup, so the running UI keeps the old direction
 * until the bundle reloads. Rather than surface that as a "please restart the app" banner, this
 * reloads immediately — the user taps once and the app comes back fully mirrored.
 *
 * If the reload fails (`reloadAsync` throws when no updates-capable runtime is present), the
 * direction flag is already written, so restarting by hand still applies it. That is reported
 * back rather than swallowed, so the caller can show the manual-restart hint instead.
 */
export async function setAppLanguage(language: Language): Promise<LanguageChangeResult> {
  await i18next.changeLanguage(language);

  const shouldBeRtl = isRtlLanguage(language);
  const directionChanged = I18nManager.isRTL !== shouldBeRtl;

  if (!directionChanged) return { language, directionChanged: false };

  I18nManager.allowRTL(shouldBeRtl);
  I18nManager.forceRTL(shouldBeRtl);

  try {
    await Updates.reloadAsync();
    return { language, directionChanged: true };
  } catch {
    return { language, directionChanged: true, reloadFailed: true };
  }
}
