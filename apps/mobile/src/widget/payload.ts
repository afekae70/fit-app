/**
 * What goes into `widget.json`, and the arithmetic behind the week's ring.
 *
 * Two widgets read this one file: today's workout, and the week's ring. So the file is written
 * whole every time — a rest day still has a week behind it, and an earlier version of this wrote
 * `{}` on a rest day, which would have blanked the ring every Saturday.
 *
 * The ring's fill is computed here rather than in the launcher. Kotlin running inside another
 * app's process is the worst place to keep a rule like "more than the target still draws a full
 * circle, and a week with no target draws an empty one" — here it is eight lines and a test.
 */

/** Today's card, as the widget shows it. Null on a rest day or before a plan exists. */
export interface WidgetToday {
  /** The workout's name. */
  title: string;
  /** What is in it — exercises, sets, minutes. */
  detail: string;
  /** What the button says. */
  action: string;
}

/** The week's ring. Every string is already in the user's language. */
export interface WidgetWeek {
  /** The ring's fill, 0 to 100, already clamped. */
  percent: number;
  /** The figure in the middle of the ring — "4/5". */
  count: string;
  /** The line beside it: "workouts this week". */
  caption: string;
  /** The line under that: the streak, or empty when there is none to brag about. */
  streak: string;
}

export interface WidgetSnapshot {
  today: WidgetToday | null;
  week: WidgetWeek | null;
}

/**
 * How full the ring is.
 *
 * A week with no workouts planned and none done is an empty ring, not a full one — the fraction
 * 0/0 has to resolve to nothing to show rather than to everything done. Over the target the ring
 * stays closed: a sixth workout in a week of five is not 120% of a circle.
 */
export function ringPercent(trained: number, target: number): number {
  if (!Number.isFinite(trained) || !Number.isFinite(target)) return 0;
  if (target <= 0 || trained <= 0) return 0;
  return Math.min(100, Math.round((trained / target) * 100));
}

/** The figure inside the ring. Guarded because it is read off a database row. */
export function ringCount(trained: number, target: number): string {
  const done = Number.isFinite(trained) ? Math.max(0, Math.trunc(trained)) : 0;
  const goal = Number.isFinite(target) ? Math.max(0, Math.trunc(target)) : 0;
  return `${done}/${goal}`;
}

/** Build the week's half of the snapshot from the numbers the home screen already loaded. */
export function weekForWidget(
  { trained, target, streakDays }: { trained: number; target: number; streakDays: number },
  copy: { caption: string; streak: (days: number) => string },
): WidgetWeek {
  return {
    percent: ringPercent(trained, target),
    count: ringCount(trained, target),
    caption: copy.caption,
    // A streak of nothing is not news. The widget leaves the line out rather than printing a zero
    // at someone who has not trained this week.
    streak: streakDays > 0 ? copy.streak(streakDays) : '',
  };
}

/**
 * The object that is written to disk.
 *
 * Today's three fields sit at the top level because that is where the first widget already looks
 * for them, and a provider on the phone is older than the app that writes to it for as long as it
 * takes the user to accept an update.
 */
export function widgetPayload(snapshot: WidgetSnapshot): Record<string, unknown> {
  return {
    ...(snapshot.today ?? {}),
    ...(snapshot.week ? { week: snapshot.week } : {}),
  };
}
