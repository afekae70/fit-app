/**
 * The week's numbers, as the app worked them out, for the coach to write its weekly review from.
 *
 * Why it exists (2026-11-14): the owner's review said there was no water data when there was.
 * The digest the coach gets (`payload.ts`) carries the water as millilitres a day and nothing to
 * set them against — the goal is the app's own rule (45 ml per kilogram, `food/waterWeek.ts`) and
 * was never sent — so "did I reach my water goal" had no answer, and the model said so.
 *
 * Rather than have the model redo the app's arithmetic, the review is handed the summary the
 * screen shows (`db/weekSummary.ts`): days at the water goal and the goal itself, calories and
 * protein against their targets, the weight and its change, workouts, records, what progressed
 * and what stalled. The coach then reasons about the numbers on the person's screen, which is
 * the rule this whole app keeps: one set of numbers, read by both.
 *
 * English, like every instruction to the model; exercise keys are the catalogue's English names.
 * Pure.
 */

import type { WeekSummary } from '../db/weekSummary.js';

const litres = (ml: number) => `${Math.round(ml / 100) / 10} L`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

export function weekFacts(week: WeekSummary): string {
  const lines: string[] = [`Week ${week.start} to ${week.end}.`];

  lines.push(
    `Workouts: ${week.workouts} (the week before: ${week.previousWorkouts}); ` +
      `working sets: ${week.sets}.` +
      (week.satisfaction === null ? '' : ` Average satisfaction with the workouts: ${week.satisfaction}/10.`),
  );

  if (week.records.length > 0) {
    lines.push(
      'Personal records: ' +
        week.records
          .map(
            (r) =>
              `${r.exerciseKey} ${r.weightKg} kg x ${r.reps}` +
              (r.previousKg === null ? ' (first time)' : ` (previous best ${r.previousKg} kg)`),
          )
          .join('; ') +
        '.',
    );
  } else {
    lines.push('Personal records: none this week.');
  }

  const compared = week.counts.up + week.counts.same + week.counts.down;
  if (compared > 0) {
    const down = week.toPush.slice(0, week.counts.down);
    const same = week.toPush.slice(week.counts.down);
    lines.push(
      `Against the previous workout of the same kind: ${week.counts.up} exercises progressed, ` +
        `${week.counts.same} stayed the same, ${week.counts.down} went down.` +
        (week.progressed.length ? ` Progressed: ${week.progressed.join(', ')}.` : '') +
        (down.length ? ` Went down: ${down.join(', ')}.` : '') +
        (same.length ? ` Stayed the same: ${same.join(', ')}.` : ''),
    );
  }

  lines.push(
    `Water: the daily goal of ${litres(week.water.goalMl)} was reached on ${week.water.reached} ` +
      `of ${week.water.counted} days` +
      (week.waterLitresPerDay === null
        ? '; no water was logged this week.'
        : `; average ${week.waterLitresPerDay} L a day.`),
  );

  if (week.food.daysLogged === 0) {
    lines.push('Food: nothing was logged this week.');
  } else {
    const target = (value: number | null, unit: string) =>
      value === null ? '' : ` (target ${value}${unit})`;
    lines.push(
      `Food, average over the ${week.food.daysLogged} logged days: ` +
        `${week.food.caloriesPerDay} kcal${target(week.food.calorieTarget, ' kcal')}` +
        (week.food.proteinPerDay === null
          ? ''
          : `, ${week.food.proteinPerDay} g protein${target(week.food.proteinTarget, ' g')}`) +
        '.',
    );
  }

  lines.push(
    week.weight.latestKg === null
      ? 'Weight: no weigh-in this week.'
      : `Weight: ${week.weight.latestKg} kg at the last weigh-in` +
          (week.weight.changeKg === null
            ? '.'
            : ` (${signed(week.weight.changeKg)} kg since the last weigh-in before the week).`),
  );

  return lines.join('\n');
}
