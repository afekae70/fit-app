/**
 * What each app-icon shortcut does.
 *
 * Asked for by the owner (2026-11-13): holding the app's icon on the home screen offers "start
 * today's workout", "add a glass of water" and "log food", each one tap from the launcher to the
 * thing itself, without going through the home screen first.
 *
 * The shortcuts are native (`native/shortcuts/shortcuts.xml`, installed by
 * `plugins/withAppShortcuts.js`); each opens a link, `fitapp://shortcut/<action>`, that the
 * screen `app/shortcut/[action].tsx` receives and hands to `runShortcut`. Everything a shortcut
 * does is here, against the database seam, so it is tested with real SQL.
 *
 *  - **workout** does what the home screen's card does: resumes a workout already open, or starts
 *    today's plan day, then shows the workout tab. With nothing planned today it simply opens the
 *    tab, where one can be started — the same as tapping the tab.
 *  - **water** adds the first of this person's two water buttons (250 ml unless they changed it)
 *    to today, then shows the home screen, where the water card has it and can take it back.
 *  - **food** opens the screen for adding food to today, over the home screen, so the way back
 *    from it leads somewhere.
 */

import type { SqlExecutor } from '../db/executor.js';
import { getTodayWorkout } from '../db/home.js';
import { startSessionFromPlanDay } from '../db/plans.js';
import { addWater } from '../db/water.js';
import { getWaterButtons } from '../db/waterButtons.js';
import { getActiveSession, type IdFactory } from '../db/workouts.js';
import { DEFAULT_WATER_BUTTONS } from '../food/waterButtons.js';

export const SHORTCUT_ACTIONS = ['workout', 'water', 'food'] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export function isShortcutAction(value: unknown): value is ShortcutAction {
  return typeof value === 'string' && (SHORTCUT_ACTIONS as readonly string[]).includes(value);
}

/** Where to go once the shortcut has done its work. */
export interface ShortcutOutcome {
  /** The screen to show, replacing the shortcut's own. */
  replace: '/' | '/(tabs)/workouts';
  /** A screen to open over it, when there is one. */
  push?: '/food-add';
  /** Millilitres added, for the water shortcut; 0 when nothing was. */
  addedMl?: number;
}

export async function runShortcut(
  db: SqlExecutor,
  userId: string,
  newId: IdFactory,
  action: string | undefined,
  today: string,
  now: Date = new Date(),
): Promise<ShortcutOutcome> {
  if (!isShortcutAction(action)) return { replace: '/' };

  switch (action) {
    case 'workout': {
      // An open workout wins: starting another would strand it unfinished.
      if (!(await getActiveSession(db, userId))) {
        const planDayId = (await getTodayWorkout(db, userId, now))?.planDayId;
        if (planDayId) await startSessionFromPlanDay(db, userId, newId, planDayId);
      }
      return { replace: '/(tabs)/workouts' };
    }
    case 'water': {
      const [glass] = (await getWaterButtons(db, userId)) ?? DEFAULT_WATER_BUTTONS;
      const id = await addWater(db, userId, newId, { drunkOn: today, ml: glass });
      return { replace: '/', addedMl: id ? glass : 0 };
    }
    case 'food':
      return { replace: '/', push: '/food-add' };
  }
}
