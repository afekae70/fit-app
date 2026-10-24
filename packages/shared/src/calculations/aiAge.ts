import { ageInYears } from './anthropometry.js';

/**
 * The youngest anyone may be to use the AI features: the coach, the weekly review, the daily
 * brief and the meal scan.
 *
 * Not a judgement about training. Google's Gemini API terms are for people 18 and over, and
 * forbid building the API into anything directed at, or likely to be used by, anyone younger.
 * JustFit itself is for 16 and over, so 16- and 17-year-olds get everything except the AI.
 *
 * Here, in the shared package, because both sides decide it: the server function refuses the
 * request (the check that counts), and the app does not offer what the server would refuse.
 */
export const AI_MIN_AGE = 18;

export type AiAgeVerdict = 'adult' | 'minor' | 'unknown';

/**
 * What a stored date of birth says about the AI features. Anything that is not a date —
 * nothing stored, or something unreadable — is `unknown`, which is refused like `minor`: an age
 * that cannot be checked is not an age that passed.
 */
export function aiAgeVerdict(birthDate: unknown, on: Date = new Date()): AiAgeVerdict {
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return 'unknown';
  const born = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return 'unknown';
  return ageInYears(born, on) >= AI_MIN_AGE ? 'adult' : 'minor';
}
