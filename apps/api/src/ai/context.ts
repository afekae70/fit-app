/**
 * Turns a validated coach payload into the two halves of a prompt.
 *
 * The split is the whole design. Prompt caching is a *prefix match*: any byte that changes
 * invalidates everything after it. So the prompt is built in two pieces —
 *
 *   `COACH_PERSONA`  — byte-identical on every request, for every user. Cacheable.
 *   `renderContext()` — this user, this moment. Never cacheable.
 *
 * — and the cache breakpoint goes between them. Interpolating the user's weight into the
 * persona would make the prefix per-user and the cache would never hit across requests, which
 * is exactly the silent failure mode that makes caching look like it "doesn't work".
 *
 * The context itself is rendered as compact text rather than raw JSON: the same figures cost
 * roughly half the tokens, and the model does not need the punctuation to read them.
 */

import type {
  CoachAdherence,
  CoachContextPayload,
  CoachExerciseProgress,
} from '@fit/shared/schemas';

/**
 * The stable prefix. Must stay byte-identical across requests to be cacheable — no dates, no
 * user values, no conditional sections.
 *
 * The rules about arithmetic and safety are here rather than in the volatile half deliberately:
 * they apply to every request, and repeating them per-user would cost tokens for nothing.
 */
export const COACH_PERSONA = `You are a certified strength and conditioning coach embedded in a training app. You advise one athlete at a time, about their own logged training.

## What you are given
Each message includes a digest of the athlete's real data: profile, calculated energy targets, bodyweight trend, and per-exercise progression. Every number in it was computed by the app from logged sets, using the same formulas the athlete sees on screen.

## How to use it
- Cite their actual numbers. "Your bench estimated 1RM went 82.5 to 84.1 over four sessions" beats "you're progressing well".
- The numbers given to you are correct and final. Do not recompute estimated 1RM, TDEE, BMR, or weekly rate from the underlying sets — you do not have the underlying sets, and re-deriving them produces figures that contradict the app.
- A stalling flag is computed, not guessed. When an exercise is flagged as stalling, address it concretely: a deload, a rep-range change, a tempo or technique cue, or an exercise swap — and say which one you are recommending and why.
- Absent data is absent, not zero. If a field is null, say you would need it rather than reasoning from a value you invented.
- Only prescribe exercises the athlete can actually perform with the equipment listed. If the equipment list is empty, ask rather than assume a fully equipped gym.

## Progressive overload
Judge progression on estimated 1RM and volume trend together. Rising volume with flat e1RM is work capacity, not strength. Flat volume with rising e1RM is intensification. Both flat for several sessions is a genuine stall and deserves a specific change, not encouragement.

## Boundaries
You are not a doctor, dietitian, or physiotherapist. Say so plainly when a question crosses into medical territory (pain that is not ordinary soreness, injury, medication, disordered eating) and recommend a professional — do not attempt a diagnosis or a rehab protocol.

Never recommend a calorie target below the athlete's calculated BMR, and say why if they ask for one: below maintenance of basic metabolic function, the deficit costs lean mass and is not sustainable. If a stated goal conflicts with their computed energy figures, name the conflict rather than quietly optimising around it.

## Tone
Direct and specific. Lead with the answer, then the reasoning. Skip preamble, skip flattery, skip restating the question. If a question needs one number to answer properly, ask for that number rather than hedging through three paragraphs.`;

/** Round for display: the extra decimals are noise the model would otherwise reason about. */
const n1 = (value: number | null): string => (value === null ? '—' : value.toFixed(1));
const n0 = (value: number | null): string => (value === null ? '—' : String(Math.round(value)));

function renderExercise(exercise: CoachExerciseProgress): string {
  const parts = [
    `${exercise.exerciseKey}:`,
    `${exercise.sessionCount} sessions`,
    `e1RM ${n1(exercise.latestE1rmKg)}kg (best ${n1(exercise.bestE1rmKg)})`,
  ];

  if (exercise.e1rmDeltaKg !== null) {
    const sign = exercise.e1rmDeltaKg > 0 ? '+' : '';
    parts.push(`change ${sign}${exercise.e1rmDeltaKg.toFixed(1)}kg`);
  }
  if (exercise.volumeSlopePerSession !== null) {
    const sign = exercise.volumeSlopePerSession > 0 ? '+' : '';
    parts.push(`volume ${sign}${Math.round(exercise.volumeSlopePerSession)}/session`);
  }
  // Only stated when true. "not stalling" on 40 exercises is 40 lines of noise, and the
  // absence of the flag already carries the information.
  if (exercise.isStalling) {
    parts.push(`STALLING (${exercise.sessionsSinceBest} sessions since best)`);
  }

  return `- ${parts.join(', ')}`;
}

function renderAdherence(entry: CoachAdherence): string {
  const target =
    entry.targetSets === null
      ? 'no target'
      : `${entry.targetSets}x${entry.targetRepsMin ?? '?'}-${entry.targetRepsMax ?? '?'}`;
  return `- ${entry.exerciseKey}: planned ${target}, logged ${entry.loggedSets} working sets`;
}

/**
 * The volatile half — everything specific to this athlete right now.
 *
 * Sections with nothing to say are omitted entirely rather than rendered empty. An empty
 * heading reads to the model as "this was measured and came back blank", which invites it to
 * reason about a zero that does not exist.
 */
export function renderContext(context: CoachContextPayload): string {
  const { profile, targets, weightTrend, exercises, adherence, availableEquipment } = context;
  const sections: string[] = [];

  sections.push(
    [
      '## Athlete',
      `Age ${profile.ageYears ?? '—'}, sex ${profile.sex ?? '—'}, height ${n0(profile.heightCm)}cm, weight ${n1(profile.weightKg)}kg`,
      `Activity ${profile.activityLevel ?? '—'}, goal ${profile.goal ?? '—'}`,
    ].join('\n'),
  );

  sections.push(
    [
      '## Energy (computed by the app — do not recompute)',
      `BMR ${targets.bmrKcal ?? '—'} kcal, TDEE ${targets.tdeeKcal ?? '—'} kcal, BMI ${n1(targets.bmi)}`,
      `Daily target ${targets.calorieTarget ?? '—'} kcal — protein ${targets.proteinG ?? '—'}g, carbs ${targets.carbsG ?? '—'}g, fat ${targets.fatG ?? '—'}g`,
    ].join('\n'),
  );

  const trendLine =
    weightTrend.kgPerWeek === null
      ? 'Rate: not enough data'
      : weightTrend.isReliable
        ? `Rate: ${weightTrend.kgPerWeek > 0 ? '+' : ''}${weightTrend.kgPerWeek.toFixed(2)} kg/week`
        : // Stated explicitly so the model does not treat a two-day slope as a trajectory.
          `Rate: ${weightTrend.kgPerWeek > 0 ? '+' : ''}${weightTrend.kgPerWeek.toFixed(2)} kg/week — NOT YET RELIABLE, too few measurements to draw a conclusion from`;

  sections.push(
    [
      '## Bodyweight',
      `Current ${n1(weightTrend.currentKg)}kg across ${weightTrend.measurementCount} measurements`,
      trendLine,
    ].join('\n'),
  );

  if (exercises.length > 0) {
    sections.push(['## Progression', ...exercises.map(renderExercise)].join('\n'));
  }

  if (adherence.length > 0) {
    sections.push(
      [
        `## Last planned session${context.planName ? ` (${context.planName})` : ''} — prescribed vs actual`,
        ...adherence.map(renderAdherence),
      ].join('\n'),
    );
  }

  if (availableEquipment.length > 0) {
    sections.push(`## Available equipment\n${availableEquipment.join(', ')}`);
  }

  sections.push(
    context.locale === 'he'
      ? '## Language\nReply in Hebrew. Keep exercise names in Hebrew, but you may add the English name in parentheses on first mention where it avoids ambiguity.'
      : '## Language\nReply in English.',
  );

  return sections.join('\n\n');
}

/**
 * True when the payload carries enough for the coach to say anything useful.
 *
 * Checked before spending a request: a model handed an all-null digest will produce confident
 * generic advice, which is worse than an honest "log a couple of workouts first" — it looks
 * personalised while being about nobody.
 */
export function hasUsableContext(context: CoachContextPayload): boolean {
  return (
    context.exercises.length > 0 ||
    context.weightTrend.measurementCount > 0 ||
    context.targets.tdeeKcal !== null
  );
}
