/**
 * i18n + RTL setup.
 *
 * Hebrew is the default, so RTL is the default layout direction. Two things about RTL on React
 * Native that shape this file:
 *
 *  1. `I18nManager.forceRTL()` only takes effect after the JS bundle reloads. It is still
 *     written here so a cold start comes up in the right direction natively, but it is no
 *     longer what mirrors the running UI — app/_layout.tsx wraps the app in a View whose
 *     `direction` follows i18next, which flips in place with no restart.
 *  2. That means `I18nManager.isRTL` can lag the visible layout until the next launch. Anything
 *     deciding handedness must key off the active language instead — see `SwipeableRow`, whose
 *     swipe direction is a physical delta that does not mirror on its own.
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

import * as SecureStore from 'expo-secure-store';
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
 * values are literal types ("שמור", "Save"). Comparing them directly would demand the English
 * text equal the Hebrew text. Widening every leaf to `string` compares keys and nesting only.
 */
type WidenStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]>;
};

type Resources = WidenStrings<typeof he>;
const enTyped: Resources = en;

const STORAGE_KEY = 'app-language';

/**
 * The language the user last chose, if any.
 *
 * Read asynchronously and applied after the first render, which the direction wrapper in
 * app/_layout.tsx makes harmless — the layout follows i18next now, so a late switch repaints
 * rather than needing a restart.
 *
 * Nothing stored means Hebrew. The device locale is deliberately NOT consulted: this app is
 * Hebrew-first, and an English phone used to open it in English even though every screen was
 * designed right-to-left.
 */
export async function loadStoredLanguage(): Promise<Language> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(stored as Language) ? (stored as Language) : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function initI18n(language: Language = DEFAULT_LANGUAGE): typeof i18next {
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

/**
 * Switch language, and flip the stored layout-direction flag with it.
 *
 * `forceRTL` writes a native flag read at startup — the change is real and persisted the
 * instant this returns, it just doesn't paint until the app restarts. See the file header for
 * why this doesn't attempt that restart itself.
 */
export async function setAppLanguage(language: Language): Promise<void> {
  await i18next.changeLanguage(language);

  // Persisted, so the choice survives a relaunch. Previously nothing was stored and startup
  // re-read the device locale every time, which silently undid the user's choice.
  void SecureStore.setItemAsync(STORAGE_KEY, language).catch(() => {});

  // Still written, so a COLD start comes up in the right direction natively before any React
  // code runs. It is no longer what mirrors the running UI — the root View's `direction` does
  // that, in place — so there is nothing left for the caller to prompt about.
  const shouldBeRtl = isRtlLanguage(language);
  if (I18nManager.isRTL !== shouldBeRtl) {
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
  }
}
