/**
 * What is said when the next exercise is announced, and in which language.
 *
 * Kept apart from expo-speech so it can be tested; `speech.ts` does the speaking.
 */

export type SpokenLanguage = 'he' | 'en';

/**
 * An exercise name as it should sound.
 *
 * In Hebrew a bracketed part is dropped. Every one in the catalogue is the formal name added
 * beside the word people actually use — "אלים (הרמת רגליים)", "חץ (וי-אפ)" — and the word they
 * use is the one worth hearing mid-workout. In English a bracketed part qualifies the exercise
 * ("Side Plank (Other Side)"), so it becomes a pause instead of disappearing.
 */
export function spokenName(name: string, language: SpokenLanguage): string {
  const spoken =
    language === 'he'
      ? name.replace(/\s*\([^)]*\)\s*/g, ' ')
      : name.replace(/\s*\(\s*([^)]*?)\s*\)\s*/g, ', $1 ');
  return spoken.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim().replace(/,$/, '');
}

export function announcementText(name: string, language: SpokenLanguage): string {
  return language === 'he' ? `הבא: ${spokenName(name, 'he')}` : `Next: ${spokenName(name, 'en')}`;
}

/**
 * Whether the phone's speech engine can speak Hebrew.
 *
 * Android reports Hebrew under both its modern code and the legacy "iw" that Java still uses
 * internally, so both are accepted.
 */
export function hasHebrewVoice(voices: readonly { language: string }[]): boolean {
  return voices.some((voice) => /^(he|iw)([-_]|$)/i.test(voice.language));
}
