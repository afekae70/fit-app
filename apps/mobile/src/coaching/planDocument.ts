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

/**
 * What makes a workout a timed one: every exercise done for `workSeconds`, `restSeconds`
 * between, the whole list `rounds` times. All null on an ordinary sets-and-reps workout.
 */
export interface DayTiming {
  workSeconds: number | null;
  restSeconds: number | null;
  rounds: number | null;
}

/** An ordinary workout: nothing timed. */
export const NO_TIMING: DayTiming = { workSeconds: null, restSeconds: null, rounds: null };

/** One workout in a group. */
export interface CoachDay extends DayTiming {
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
      days.push({
        id: dayId,
        name: asText(day.name),
        workSeconds: asCount(day.work_seconds),
        restSeconds: asCount(day.rest_seconds),
        rounds: asCount(day.rounds),
        exercises,
      });
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
    // Always sent, null included: null is how a workout says it is not timed, and leaving the
    // key out is how an app that knows nothing about timing says nothing.
    work_seconds: day.workSeconds,
    rest_seconds: day.restSeconds,
    rounds: day.rounds,
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

/* -------------------------------------------------------------------------- */
/* Giving a trainee one of the coach's own workouts                            */
/* -------------------------------------------------------------------------- */

/**
 * One of the coach's own saved workouts, read from the coach's own database: the group it sits
 * in, its name, and what it prescribes.
 *
 * It carries no ids on purpose. A coach's workout and a trainee's are different rows belonging
 * to different people; what is handed over is what the workout *says*, written afresh under
 * the trainee's account.
 */
export interface OwnWorkout extends DayTiming {
  groupName: string;
  name: string | null;
  exercises: Omit<CoachExercise, 'id'>[];
}

const sameText = (a: string | null, b: string | null) => (a?.trim() ?? '') === (b?.trim() ?? '');

/** Do two workouts prescribe the same thing, exercise for exercise, in the same order? */
function samePrescription(day: CoachDay, source: OwnWorkout): boolean {
  // Forty seconds on and twenty off is a different workout from three sets of ten, whatever
  // the exercises are.
  if (
    day.workSeconds !== source.workSeconds ||
    day.restSeconds !== source.restSeconds ||
    day.rounds !== source.rounds
  ) {
    return false;
  }
  if (day.exercises.length !== source.exercises.length) return false;
  return day.exercises.every((exercise, index) => {
    const other = source.exercises[index];
    return (
      other !== undefined &&
      exercise.exerciseKey === other.exerciseKey &&
      exercise.targetSets === other.targetSets &&
      exercise.targetRepsMin === other.targetRepsMin &&
      exercise.targetRepsMax === other.targetRepsMax &&
      sameText(exercise.notes, other.notes)
    );
  });
}

/**
 * The trainee's copy of this workout, if they already have one.
 *
 * A coach puts the same leg day on four Tuesdays. Without this, each of those would hand the
 * trainee a fresh copy, and their plan screen would fill with identical workouts. A copy counts
 * as the same when it sits in a group of the same name, has the same name, and prescribes
 * exactly the same thing — so a copy the coach or the trainee has since edited is left alone,
 * and the next assignment makes a new one that says what the coach's workout says now.
 */
export function existingCopy(
  plans: readonly CoachPlan[],
  source: OwnWorkout,
): { planId: string; dayId: string } | null {
  for (const plan of plans) {
    if (!sameText(plan.name, source.groupName)) continue;
    for (const day of plan.days) {
      if (sameText(day.name, source.name) && samePrescription(day, source)) {
        return { planId: plan.id, dayId: day.id };
      }
    }
  }
  return null;
}

/** The trainee's group with this name, to put a copy into. Null when they have none yet. */
export function groupNamed(plans: readonly CoachPlan[], name: string): CoachPlan | null {
  return plans.find((plan) => sameText(plan.name, name)) ?? null;
}

/** The workout as a new one of the trainee's own: the same content, every id new. */
export function copyForTrainee(source: OwnWorkout, newId: () => string): CoachDay {
  return {
    id: newId(),
    name: source.name,
    workSeconds: source.workSeconds,
    restSeconds: source.restSeconds,
    rounds: source.rounds,
    exercises: source.exercises.map((exercise) => ({ ...exercise, id: newId() })),
  };
}

/** Every workout a trainee has, with the group it is in — for a list to choose from. */
export function allDays(
  plans: readonly CoachPlan[],
): { planId: string; planName: string; day: CoachDay; number: number }[] {
  return plans.flatMap((plan) =>
    plan.days.map((day, index) => ({
      planId: plan.id,
      planName: plan.name,
      day,
      // Its place in the group, for a workout nobody has named.
      number: index + 1,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* A trainee's calendar                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a date holds, exactly as the trainee's own calendar means it:
 *
 *   absent     nothing decided
 *   null       a rest day
 *   string[]   one or more workouts, in order — never empty
 */
export type CoachCalendar = Map<string, string[] | null>;

/**
 * `coach_get_schedule`'s answer, by date.
 *
 * The server sends one entry per row, already in the order the day is done. A date whose only
 * entries have no workout is a rest day; a workout on the same date outranks it, and the same
 * workout named twice is counted once — the same rules the phone applies to its own calendar,
 * so a coach and a trainee looking at the same date see the same thing.
 */
export function parseSchedule(raw: unknown): CoachCalendar {
  const calendar: CoachCalendar = new Map();
  if (!Array.isArray(raw)) return calendar;

  const seen = new Map<string, { workouts: string[]; rows: number }>();
  for (const entry of raw) {
    const row = asRecord(entry);
    const date = asText(row?.date);
    if (!row || !date) continue;
    const day = seen.get(date) ?? { workouts: [], rows: 0 };
    day.rows += 1;
    const workout = asText(row.plan_day_id);
    if (workout && !day.workouts.includes(workout)) day.workouts.push(workout);
    seen.set(date, day);
  }
  for (const [date, day] of seen) {
    calendar.set(date, day.workouts.length > 0 ? day.workouts : null);
  }
  return calendar;
}
