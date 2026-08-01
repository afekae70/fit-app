/**
 * Generates and caches a short daily check-in shown on the Today screen.
 *
 * One model call per user per calendar day: the result lands in `coach_briefs` and every later
 * screen visit that same day reads the cached row instead of asking the model again. The trigger
 * message is never shown to the user — only the model's reply is — and it deliberately mirrors
 * the API's own `hasUsableContext` gate (apps/api/src/ai/context.ts) so an account with nothing
 * logged yet never spends a request on a reply that would just be refused anyway.
 */

import type { CoachContextPayload } from '@fit/shared/schemas';

import { getCoachBrief, saveCoachBrief } from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import type { IdFactory } from '../db/workouts.js';
import { buildCoachPayload } from './payload.js';
import { streamCoachChat } from './stream.js';

const TRIGGER_MESSAGE =
  'Give me a short daily check-in for today: one or two sentences, encouraging but specific to ' +
  'my data below. No greeting, no questions back — just the note.';

/** Mirrors apps/api/src/ai/context.ts's hasUsableContext — kept in sync deliberately. */
export function hasUsableContext(context: CoachContextPayload): boolean {
  return (
    context.exercises.length > 0 ||
    context.weightTrend.measurementCount > 0 ||
    context.targets.tdeeKcal !== null
  );
}

/** YYYY-MM-DD in local time — the same calendar day the device's clock shows the user. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DailyBriefOptions {
  db: SqlExecutor;
  userId: string;
  newId: IdFactory;
  locale: 'he' | 'en';
  baseUrl: string;
  accessToken: string;
  today?: Date;
}

/**
 * Resolves to null when there is nothing to show — no cached brief yet, not enough logged data
 * to say anything specific, or the model call failed. The Today screen treats all three cases
 * the same way: no card, rather than an error banner for what is a nice-to-have.
 */
export async function getDailyBrief({
  db,
  userId,
  newId,
  locale,
  baseUrl,
  accessToken,
  today = new Date(),
}: DailyBriefOptions): Promise<string | null> {
  const briefDate = localDateString(today);
  const cached = await getCoachBrief(db, userId, briefDate);
  if (cached) return cached.text;

  const context = await buildCoachPayload(db, userId, { locale, today });
  if (!hasUsableContext(context)) return null;

  const text = await new Promise<string | null>((resolve) => {
    let collected = '';
    streamCoachChat({
      baseUrl,
      accessToken,
      body: { context, messages: [{ role: 'user', content: TRIGGER_MESSAGE }] },
      handlers: {
        onDelta: (chunk) => {
          collected += chunk;
        },
        onPlanProposal: () => {},
        onNutritionProposal: () => {},
        onDone: () => resolve(collected.trim() || null),
        onRefusal: () => resolve(null),
        onError: () => resolve(null),
      },
    });
  });

  if (text) await saveCoachBrief(db, userId, newId, briefDate, text);
  return text;
}
