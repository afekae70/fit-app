/**
 * A trainee's plans as a coach's phone holds them: a document, edited in memory, sent back
 * whole.
 *
 * A coach's own plans live in SQLite and are edited one row at a time. A trainee's plans are
 * not the coach's data and never touch the coach's database — they are read from the server as
 * one document (`coach_get_plans`), changed here, and a workout at a time is sent back
 * (`coach_save_day`) as the complete list it should now be. The server works out what was
 * added, moved and removed.
 *
 * Everything in this file is a pure function over that document: no network, no database, no
 * React. What a prescription may say, what order a list ends up in, what exactly goes over the
 * wire — these are the parts that would be wrong silently, and the parts a test can hold still.
 */

/** One prescribed exercise. Targets are optional: null means "no target", not zero. */
export interface CoachExercise {
  id: string;
  /** The catalogue's stable English name — the same key the trainee's own plans use. */
  exerciseKey: string;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  notes: string | null;
}

/** One workout in a group. */
export interface CoachDay {
  id: string;
  name: string | null;
  exercises: CoachExercise[];
}

/** One group of workouts — what the trainee's plan screen calls a group. */
export interface CoachPlan {
  id: string;
  name: string;
  isActive: boolean;
  days: CoachDay[];
}

/* -------------------------------------------------------------------------- */
/* Reading what the server sent                                                */
/* -------------------------------------------------------------------------- */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** A whole number, or null. The server sends integers; anything else is treated as absent. */
const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/**
 * The server's document, as typed objects.
 *
 * Tolerant on purpose. A row that cannot be made sense of — no id, no exercise — is left out
 * rather than allowed to throw: one malformed exercise must not make a coach's whole list of
 * trainees unreadable. What is left out is not sent back either, so it is also not deleted by
 * accident: `coach_save_day` only removes what it was told about and then not sent.
 */
export function parsePlans(raw: unknown): CoachPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: CoachPlan[] = [];

  for (const entry of raw) {
    const plan = asRecord(entry);
    const id = asText(plan?.id);
    if (!plan || !id) continue;

    const days: CoachDay[] = [];
    for (const dayEntry of Array.isArray(plan.days) ? plan.days : []) {
      const day = asRecord(dayEntry);
      const dayId = asText(day?.id);
      if (!day || !dayId) continue;

      const exercises: CoachExercise[] = [];
      for (const exerciseEntry of Array.isArray(day.exercises) ? day.exercises : []) {
        const exercise = asRecord(exerciseEntry);
        const exerciseId = asText(exercise?.id);
        const exerciseKey = asText(exercise?.exercise_key);
        if (!exercise || !exerciseId || !exerciseKey) continue;
        exercises.push({
          id: exerciseId,
          exerciseKey,
          targetSets: asCount(exercise.target_sets),
          targetRepsMin: asCount(exercise.target_reps_min),
          targetRepsMax: asCount(exercise.target_reps_max),
          notes: asText(exercise.notes),
        });
      }
      days.push({ id: dayId, name: asText(day.name), exercises });
    }

    plans.push({ id, name: asText(plan.name) ?? '', isActive: plan.is_active === true, days });
  }
  return plans;
}

/** Find one workout, and the group it is in. Null when either id is not in the document. */
export function findDay(
  plans: readonly CoachPlan[],
  planId: string,
  dayId: string,
): { plan: CoachPlan; day: CoachDay } | null {
  const plan = plans.find((candidate) => candidate.id === planId);
  const day = plan?.days.find((candidate) => candidate.id === dayId);
  return plan && day ? { plan, day } : null;
}

/* -------------------------------------------------------------------------- */
/* Editing a workout                                                           */
/* -------------------------------------------------------------------------- */

/** The limits a prescription is held to. Wide enough for anything real, narrow enough to type. */
export const SETS = { min: 1, max: 20 } as const;
export const REPS = { min: 1, max: 100 } as const;

/**
 * A newly added exercise: three sets of eight to twelve.
 *
 * The same default the trainee's own plan screen gives a new exercise, so a workout written by
 * a coach and one written by the trainee start from the same place.
 */
export function newExercise(id: string, exerciseKey: string): CoachExercise {
  return { id, exerciseKey, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, notes: null };
}

export function addExercise(day: CoachDay, exercise: CoachExercise): CoachDay {
  return { ...day, exercises: [...day.exercises, exercise] };
}

export function removeExercise(day: CoachDay, exerciseId: string): CoachDay {
  return { ...day, exercises: day.exercises.filter((exercise) => exercise.id !== exerciseId) };
}

/** Move one exercise up (`by` -1) or down (+1). At either end it stays where it is. */
export function moveExercise(day: CoachDay, exerciseId: string, by: -1 | 1): CoachDay {
  const from = day.exercises.findIndex((exercise) => exercise.id === exerciseId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= day.exercises.length) return day;

  const exercises = [...day.exercises];
  const [moved] = exercises.splice(from, 1);
  if (!moved) return day;
  exercises.splice(to, 0, moved);
  return { ...day, exercises };
}

const clamp = (value: number, limits: { min: number; max: number }) =>
  Math.max(limits.min, Math.min(limits.max, value));

/**
 * Step one of an exercise's three numbers by one.
 *
 * The rep range is kept a range: raising the low end past the high end takes the high end with
 * it, and lowering the high end below the low end takes the low end down. The server refuses a
 * range written backwards, and a stepper that could produce one would be offering a value that
 * cannot be saved. A target that was empty starts from the default rather than from nothing.
 */
export function stepTarget(
  exercise: CoachExercise,
  field: 'sets' | 'repsMin' | 'repsMax',
  by: -1 | 1,
): CoachExercise {
  if (field === 'sets') {
    return { ...exercise, targetSets: clamp((exercise.targetSets ?? 3) + by, SETS) };
  }

  let low = exercise.targetRepsMin ?? 8;
  let high = exercise.targetRepsMax ?? Math.max(low, 12);
  if (field === 'repsMin') {
    low = clamp(low + by, REPS);
    high = Math.max(high, low);
  } else {
    high = clamp(high + by, REPS);
    low = Math.min(low, high);
  }
  return { ...exercise, targetRepsMin: low, targetRepsMax: high };
}

export function replaceExercise(day: CoachDay, next: CoachExercise): CoachDay {
  return {
    ...day,
    exercises: day.exercises.map((exercise) => (exercise.id === next.id ? next : exercise)),
  };
}

/** "3 × 8–12", "3 × 10", or nothing when no target is set. For a list row. */
export function describeTargets(exercise: CoachExercise): string {
  const { targetSets: sets, targetRepsMin: low, targetRepsMax: high } = exercise;
  const reps =
    low !== null && high !== null && low !== high
      ? `${low}–${high}`
      : (low ?? high) !== null
        ? String(low ?? high)
        : null;
  if (sets !== null && reps !== null) return `${sets} × ${reps}`;
  if (sets !== null) return `${sets} ×`;
  return reps ?? '';
}

/* -------------------------------------------------------------------------- */
/* Sending it back                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Has this workout been changed from what was loaded?
 *
 * Compared on what is sent, so that a difference the server would never see — a name that is
 * empty in one and null in the other — does not light the save button.
 */
export function sameDay(a: CoachDay, b: CoachDay): boolean {
  return JSON.stringify(dayPayload(a)) === JSON.stringify(dayPayload(b));
}

/**
 * A workout in the shape `coach_save_day` reads: snake_case, a trimmed name or null, and the
 * exercises in the order they should end up in.
 */
export function dayPayload(day: CoachDay): Record<string, unknown> {
  const name = day.name?.trim() ?? '';
  return {
    id: day.id,
    name: name === '' ? null : name,
    exercises: day.exercises.map((exercise) => {
      const notes = exercise.notes?.trim() ?? '';
      return {
        id: exercise.id,
        exercise_key: exercise.exerciseKey,
        target_sets: exercise.targetSets,
        target_reps_min: exercise.targetRepsMin,
        target_reps_max: exercise.targetRepsMax,
        notes: notes === '' ? null : notes,
      };
    }),
  };
}
