/**
 * Why the coach did not answer, as a sentence in the person's language.
 *
 * A failed turn arrives as two things: a sentence in English and, when the cause is known, a
 * word for it. The sentence used to be what the bubble showed — which put "You have reached
 * the number of coach messages for today" in front of someone reading Hebrew, and told them
 * nothing at all when the sentence was "Request failed (503)". The word is what can be
 * translated, so the word is what the screen goes by.
 *
 * The words come from two places. The server's are its refusals (`apps/api/src/edge/coach.ts`)
 * — reasons it would not start an answer. The other three are things only the phone can know:
 * that it had no network, that nothing came back in time, that the answer stopped part-way.
 *
 * A word that is not here is one this build has not been taught — a self-hosted server's rate
 * limiter, a refusal added to the function after this app was built. For those the English
 * sentence is still the best thing there is to show, and `null` says so.
 */

export const COACH_FAILURES = {
  sign_in_required: 'coach.failed.signIn',
  daily_limit: 'coach.failed.dailyLimit',
  ai_busy: 'coach.failed.busy',
  not_set_up: 'coach.failed.notSetUp',
  insufficient_context: 'coach.failed.needsData',
  offline: 'coach.failed.offline',
  timeout: 'coach.failed.timeout',
  interrupted: 'coach.cutShort',
  // The model declined. Not a fault, and worded as the chat words it.
  refused: 'coach.refused',
  // A weekly review asked for before a week has passed since the last (`weeklyReview.ts`).
  too_soon: 'coach.weekly.tooSoon',
  // The server's own age check (AI_MIN_AGE), for a build or a profile that did not stop it first.
  age_restricted: 'coach.failed.ageRestricted',
  age_unknown: 'coach.failed.ageUnknown',
  // Nothing the person can act on, and nothing they would learn from the detail: the request
  // was malformed or the server broke. The detail is in the log, where it is of use.
  invalid_request: 'coach.unavailable',
  request_too_large: 'coach.unavailable',
  server_error: 'coach.unavailable',
} as const satisfies Record<string, string>;

export type CoachFailure = keyof typeof COACH_FAILURES;

/** The translation key for a failure, or null for one this build does not know. */
export function coachFailureKey(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(COACH_FAILURES, code)
    ? COACH_FAILURES[code as CoachFailure]
    : null;
}
