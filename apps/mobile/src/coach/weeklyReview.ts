/**
 * The coach's weekly review: what went well, what stalled, and one thing to change.
 *
 * ## Asked for, not sent for
 *
 * Unlike the daily note, this is only ever requested by a press of a button. It sends the same
 * digest the coach always gets — training, bodyweight, the food log — to a model run by
 * someone else, and that is something a person should do rather than have done for them by
 * opening a screen. It is also the dearer of the two: a longer answer, from an allowance
 * everyone shares.
 *
 * ## Once a week, counted in days
 *
 * A new review can be asked for seven days after the last one, whatever day of the week that
 * is. Tying it to the calendar week would make a review written on Saturday night stale by
 * Sunday morning, and one written on Sunday the only one allowed until the next. The digest
 * itself looks back seven days from now for the same reason (see `payload.ts`).
 *
 * ## What comes back
 *
 * Plain text, kept on the phone (`db/coachBriefs.ts`) so that it is still there offline and is
 * not paid for twice. The model is asked for no markdown and sometimes sends some anyway;
 * `tidyReview` takes the marks out, since the card shows text as it is.
 */

import { getLatestWeeklyReview, saveWeeklyReview, type WeeklyReview } from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import { addDays, localDate } from '../db/schedule.js';
import type { IdFactory } from '../db/workouts.js';
import { hasUsableContext } from './dailyBrief.js';
import { buildCoachPayload } from './payload.js';
import { streamCoachChat } from './stream.js';

export const REVIEW_EVERY_DAYS = 7;

/** Never shown. English, like every instruction to the model; the reply's language is the digest's. */
const TRIGGER_MESSAGE =
  'Write my weekly review. Exactly three short parts, each a heading on its own line followed ' +
  'by one or two sentences: first what went well over the last week, then what stalled or ' +
  'slipped, then the one change to make in the coming week. Use my actual numbers from the ' +
  'digest: training progression, bodyweight trend, and the food and water log if there is one. ' +
  'Where there is no data for something, say so in a few words rather than guessing. Plain ' +
  'text only: no markdown, no asterisks, no # signs, no bullet points. Answer in text and do ' +
  'not call a tool. No greeting and no questions back.';

/** The first day a new review may be asked for, or null when one may be asked for now. */
export function nextReviewOn(latest: WeeklyReview | null, today: string): string | null {
  if (!latest) return null;
  const next = addDays(latest.writtenOn, REVIEW_EVERY_DAYS);
  return next > today ? next : null;
}

/**
 * The reply as plain text.
 *
 * Heading marks, emphasis marks and list bullets are removed, and runs of blank lines are
 * brought down to one. Anything else is left exactly as written — this is tidying, not
 * rewriting, and a `*` inside a sentence ("3*10") is not emphasis.
 */
export function tidyReview(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*[-*•]\s+/, '')
        // Emphasis is a pair of marks hugging text on both sides. Written without a
        // lookbehind, which not every JavaScript engine this runs on is sure to have.
        .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2')
        .trimEnd(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type ReviewOutcome =
  | { ok: true; review: WeeklyReview }
  /**
   * `code` is the word for what went wrong, as for a chat turn (`failure.ts`) — with two of
   * this file's own: `too_soon`, and `insufficient_context` decided on the phone before
   * anything was sent.
   */
  | { ok: false; code: string | undefined; message: string };

export interface WeeklyReviewOptions {
  db: SqlExecutor;
  userId: string;
  newId: IdFactory;
  locale: 'he' | 'en';
  baseUrl: string;
  accessToken: string;
  today?: Date;
}

/** Ask for a review, keep it, and hand it back. Never throws. */
export async function requestWeeklyReview({
  db,
  userId,
  newId,
  locale,
  baseUrl,
  accessToken,
  today = new Date(),
}: WeeklyReviewOptions): Promise<ReviewOutcome> {
  const writtenOn = localDate(today);

  // Checked here as well as by whoever draws the button: a second press, or a second phone,
  // must not spend a request on a review that already exists.
  const latest = await getLatestWeeklyReview(db, userId);
  if (nextReviewOn(latest, writtenOn) !== null) {
    return { ok: false, code: 'too_soon', message: 'A review was written less than a week ago.' };
  }

  const context = await buildCoachPayload(db, userId, { locale, today });
  if (!hasUsableContext(context)) {
    return { ok: false, code: 'insufficient_context', message: 'Nothing logged to review.' };
  }

  const outcome = await new Promise<
    { ok: true; text: string } | { ok: false; code: string | undefined; message: string }
  >((resolve) => {
    let collected = '';
    streamCoachChat({
      baseUrl,
      accessToken,
      body: { context, messages: [{ role: 'user', content: TRIGGER_MESSAGE }] },
      handlers: {
        onDelta: (chunk) => {
          collected += chunk;
        },
        // Asked not to; ignored if it does. A review is something to read, not a plan to apply.
        onPlanProposal: () => {},
        onNutritionProposal: () => {},
        onDone: () => resolve({ ok: true, text: collected }),
        onRefusal: () => resolve({ ok: false, code: 'refused', message: 'The model declined.' }),
        // Whatever arrived before the failure is dropped: half a review reads as a whole one.
        onError: (message, code) => resolve({ ok: false, code, message }),
      },
    });
  });

  if (!outcome.ok) return outcome;
  const text = tidyReview(outcome.text);
  if (text === '') {
    return { ok: false, code: 'server_error', message: 'The review came back empty.' };
  }

  await saveWeeklyReview(db, userId, newId, writtenOn, text);
  return { ok: true, review: { writtenOn, text } };
}
