/**
 * A finished workout as a few lines of text, for sending to someone.
 *
 * Text, not a picture, and that is a decision rather than a gap. A picture of a card would
 * need a library that captures a view as an image — native code, which means a new build for
 * every user before the feature exists at all (see CLAUDE.md). The system's own share sheet
 * takes text with nothing added to the app, and text is what a chat wants anyway: it can be
 * read in the notification, quoted, and answered.
 *
 * What it says is what someone would say: what the workout was, how long, how much — and the
 * best set of each lift, because "squat, 100 × 8" is the line that gets a reply. Not every
 * set; a workout pasted in full is a spreadsheet, and nobody reads one in a chat.
 *
 * Kept away from the screen so the layout can be tested: which lines appear, in what order,
 * and where it stops.
 */

export interface ShareExercise {
  name: string;
  /** Its best working set, already formatted in the reader's units — "100 kg × 8". */
  best: string | null;
  /** How many working sets were done. */
  sets: number;
}

export interface ShareInput {
  /** The workout's name, or what to call one that has none. */
  title: string;
  /** When, already formatted for the language: "Thursday, 8 October". */
  when: string;
  minutes: number | null;
  sets: number;
  /** The total lifted with its unit, or null when nothing was weighted. */
  volume: string | null;
  exercises: readonly ShareExercise[];
}

export interface ShareLabels {
  minutes: (count: number) => string;
  sets: (count: number) => string;
  /** "and 3 more" — for the exercises past the cut-off. */
  more: (count: number) => string;
  /** The last line: where this came from. */
  footer: string;
}

/** How many exercises are listed before the rest become a count. A screen of a chat, roughly. */
export const SHARE_EXERCISE_LIMIT = 8;

export function workoutShareText(input: ShareInput, labels: ShareLabels): string {
  const totals = [
    input.minutes !== null ? labels.minutes(input.minutes) : null,
    input.sets > 0 ? labels.sets(input.sets) : null,
    input.volume,
  ].filter((part): part is string => part !== null && part !== '');

  // An exercise with nothing done in it is not something that was done.
  const done = input.exercises.filter((exercise) => exercise.sets > 0);
  const listed = done.slice(0, SHARE_EXERCISE_LIMIT);
  const rest = done.length - listed.length;

  const lines = [
    `💪 ${input.title}`,
    [input.when, ...totals].filter(Boolean).join(' · '),
    '',
    ...listed.map((exercise) =>
      // A lift is told by its best set; a plank or a run has no "best", only that it was done.
      exercise.best
        ? `• ${exercise.name} — ${exercise.best}`
        : `• ${exercise.name} — ${labels.sets(exercise.sets)}`,
    ),
    ...(rest > 0 ? [labels.more(rest)] : []),
    '',
    labels.footer,
  ];

  // No run of blank lines, and none at either end: a workout with no exercises would otherwise
  // open with a gap and close with two.
  return lines
    .filter((line, index) => !(line === '' && lines[index - 1] === ''))
    .join('\n')
    .trim();
}
