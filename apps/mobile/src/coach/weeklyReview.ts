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

import {
  getLatestWeeklyReview,
  getWeeklyReviewBetween,
  saveWeeklyReview,
  type WeeklyReview,
} from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import { addDays, localDate } from '../db/schedule.js';
import type { IdFactory } from '../db/workouts.js';
import { hasUsableContext } from './dailyBrief.js';
import { buildCoachPayload } from './payload.js';
import { streamCoachChat } from './stream.js';

export const REVIEW_EVERY_DAYS = 7;

/** Never shown. English, like every instruction to the model; the reply's language is the digest's. */
/*
 * Easy to read, and explained (the owner, 2026-11-14: first "comfortable to read, simple to
 * understand, with every summary that is needed, including a tip for next week", then "with a lot
 * of explanation about the good things and the bad things"). So sections, each opening with a
 * fixed tag the phone splits on (`parseReview`): what went well and what did not, each explained;
 * a few sentences on each subject, the good and the bad of it; and the tip, with its reason. The
 * tags are English and fixed; the words after them are in the reader's language.
 *
 * The week's numbers are sent with it (`weekFacts`), worked out by the app as the summary screen
 * shows them, and the model is told to use those: the water goal in particular is in nothing else
 * the coach receives.
 */
const TRIGGER_MESSAGE =
  'Write my weekly review in exactly these seven sections, in this order. Start each section on ' +
  'a new line with its tag in English capitals followed by a colon; write everything after the ' +
  'tag in the language of the digest:\n' +
  'GOOD: the two or three best things about my week, each with its number and why it matters.\n' +
  'BAD: the two or three things that went wrong or need work, each with its number and why it ' +
  'matters.\n' +
  'TRAINING: two or three sentences: what progressed and what stalled or went down, and what that ' +
  'means.\n' +
  'FOOD: two or three sentences on calories and protein against my targets: what was good and ' +
  'what was not.\n' +
  'WATER: two or three sentences on how many days I reached my water goal and my average.\n' +
  'WEIGHT: two or three sentences on my bodyweight and its change, and what it says about my ' +
  'eating.\n' +
  'TIP: one concrete, specific thing to do next week, and in one more sentence why.\n' +
  'Use the numbers for the week given below — they are the ones on my screen — and the rest of ' +
  'the digest for background. Write simply and clearly, like a coach talking to me. Where there ' +
  'is truly no data for a section, say so in a sentence rather than guessing. Plain text only: no ' +
  'markdown, no asterisks, no bullets, no emoji, no line breaks inside a section. Answer in text ' +
  'and do not call a tool. No greeting and no questions back.';

/**
 * The days a week's review may be written on: its Saturday, when it falls due, or the Sunday
 * after. Earlier in the week is not that week's review — it was asked for before the week was
 * over — so it neither stands in for the Saturday one nor keeps it from being written.
 */
export function weekReviewDays(end: string): [string, string] {
  return [end, addDays(end, 1)];
}

/** The sections of a review, in the order it lists them. */
export const REVIEW_PARTS = ['good', 'bad', 'training', 'food', 'water', 'weight', 'tip'] as const;
export type ReviewPart = (typeof REVIEW_PARTS)[number];

/**
 * A review split into its sections, or null when it was not written that way — a review from
 * before the tags existed, or a reply that ignored them. The caller then shows the text whole.
 *
 * Forgiving about what a model does to a tag: any case, a colon or a dash after it, stray marks
 * before it. A line without a tag joins the line above it rather than being lost. Null unless at
 * least the tip and one other line were found: half a structure is not one.
 */
export function parseReview(text: string): Partial<Record<ReviewPart, string>> | null {
  const parts: Partial<Record<ReviewPart, string>> = {};
  let last: ReviewPart | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const match = /^[^A-Za-z֐-׿]*(GOOD|BAD|TRAINING|FOOD|WATER|WEIGHT|TIP)\s*[:：\-–]\s*(.*)$/i.exec(line);
    if (match) {
      last = match[1]!.toLowerCase() as ReviewPart;
      parts[last] = match[2]!.trim();
    } else if (last) {
      parts[last] = `${parts[last]} ${line}`.trim();
    }
  }
  const found = REVIEW_PARTS.filter((part) => parts[part]);
  return parts.tip && found.length >= 2 ? parts : null;
}

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
  /**
   * The calendar week the review is for, Sunday to Saturday. Given, a week has at most one review
   * — one written on its Saturday or the Sunday after (`weekReviewDays`) — instead of the rule of seven
   * days since the last; `today` is then the moment the week's review is due (its Saturday,
   * 19:00), so the digest covers that week whenever the request is actually made.
   */
  week?: { start: string; end: string };
  /**
   * The week's numbers as the app worked them out (`weekFacts`), sent with the request so the
   * review is written from the numbers on the person's screen — the water goal above all, which
   * the digest does not carry.
   */
  facts?: string;
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
  week,
  facts,
}: WeeklyReviewOptions): Promise<ReviewOutcome> {
  const writtenOn = localDate(today);

  // Checked here as well as by whoever asks: a second call, or a second phone, must not spend a
  // request on a review that already exists.
  if (week) {
    if (await getWeeklyReviewBetween(db, userId, ...weekReviewDays(week.end))) {
      return { ok: false, code: 'too_soon', message: 'This week already has its review.' };
    }
  } else {
    const latest = await getLatestWeeklyReview(db, userId);
    if (nextReviewOn(latest, writtenOn) !== null) {
      return { ok: false, code: 'too_soon', message: 'A review was written less than a week ago.' };
    }
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
      body: {
        context,
        messages: [
          {
            role: 'user',
            content: facts
              ? `${TRIGGER_MESSAGE}\n\nThe numbers for the week, worked out by the app:\n${facts}`
              : TRIGGER_MESSAGE,
          },
        ],
      },
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
