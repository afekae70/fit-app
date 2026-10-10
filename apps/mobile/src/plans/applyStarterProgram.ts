/**
 * Turning a ready-made programme into a plan of the user's own.
 *
 * Through the plan repository and nothing else — `createPlan`, `addPlanDay`,
 * `addPlanDayExercise` — so what comes out is exactly what tapping it together by hand on the
 * plan screen would have made: the same rows, the same stamps, picked up by sync like any other
 * plan. See `starterPrograms.ts` for why there is no link back to the programme afterwards.
 */

import type { SqlExecutor } from '../db/executor.js';
import { addPlanDay, addPlanDayExercise, createPlan, deletePlan } from '../db/plans.js';
import type { Clock, IdFactory } from '../db/workouts.js';
import { starterTargets, type StarterProgram } from './starterPrograms.js';

const defaultClock: Clock = () => new Date().toISOString();

/**
 * Add `program` to this account's plans, named in `language`. Resolves to the new plan's id.
 *
 * All of it or none of it. A plan is some thirty rows written one after another; if one fails
 * the half that was written is taken out again before the error is passed on, because a
 * programme that arrives with two of its four workouts is worse than one that does not arrive —
 * it looks finished.
 */
export async function applyStarterProgram(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  program: StarterProgram,
  language: 'he' | 'en',
  clock: Clock = defaultClock,
): Promise<string> {
  const planId = await createPlan(db, userId, newId, program.name[language], clock);
  try {
    for (const day of program.days) {
      const dayId = await addPlanDay(db, newId, planId, day.name[language], clock);
      for (const exercise of day.exercises) {
        await addPlanDayExercise(db, newId, dayId, exercise.key, starterTargets(exercise), clock);
      }
    }
  } catch (error) {
    await deletePlan(db, userId, planId, clock).catch(() => undefined);
    throw error;
  }
  return planId;
}
