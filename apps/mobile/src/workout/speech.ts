/**
 * Saying the next exercise out loud, through the phone's own speech engine.
 *
 * expo-speech always uses the engine the phone has set as its default, and when that engine has
 * no voice for the language asked for it quietly speaks in the device's language instead. On a
 * Samsung phone the default is Samsung's engine, which ships no Hebrew voice — so a Hebrew name
 * handed to it would come out as an English voice stumbling over Hebrew letters, or as nothing.
 *
 * So the voices are checked first. With a Hebrew voice the announcement is in Hebrew; without one
 * it is in English, which every engine speaks, and the timer screen says how to get Hebrew. The
 * engine is the phone's setting, not the app's — nothing here tries to change it.
 */

import * as Speech from 'expo-speech';

import { announcementText, hasHebrewVoice, type SpokenLanguage } from './announce.js';

/** The Hebrew voice's identifier; null when there is none; undefined until checked. */
let hebrewVoice: string | null | undefined;

/** Check once which voices the engine has. Resolves with whether Hebrew is among them. */
export async function prepareSpeech(): Promise<boolean> {
  if (hebrewVoice === undefined) {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      hebrewVoice = voices.find((voice) => hasHebrewVoice([voice]))?.identifier ?? null;
    } catch {
      hebrewVoice = null;
    }
  }
  return hebrewVoice !== null;
}

export function announceNext(names: { he: string; en: string }, appLanguage: string): void {
  const language: SpokenLanguage = appLanguage === 'he' && hebrewVoice ? 'he' : 'en';
  const text = announcementText(language === 'he' ? names.he : names.en, language);
  try {
    // Anything still being said is cut off rather than queued behind: an announcement that
    // arrives late is an announcement about an exercise that has already started.
    void Speech.stop();
    Speech.speak(text, {
      // The bare language code. expo-speech builds a Java Locale from it, and a tagged "he-IL"
      // would become a locale whose language is "he-il", which no engine recognises.
      language,
      voice: language === 'he' ? (hebrewVoice ?? undefined) : undefined,
    });
  } catch {
    // Silent rather than fatal, like every other sound in the timer.
  }
}

export function stopSpeech(): void {
  try {
    void Speech.stop();
  } catch {
    // Nothing was being said.
  }
}
