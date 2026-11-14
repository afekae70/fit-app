/**
 * The app-icon shortcuts' work — real SQL against real SQLite.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { createTestExecutor } from '../db/testUtils.js';
import { getWaterTotal } from '../db/water.js';
import { setWaterButtons } from '../db/waterButtons.js';
import { getActiveSession, startSession } from '../db/workouts.js';
import { isShortcutAction, runShortcut } from './appShortcuts.js';

const USER = 'user-1';
const TODAY = '2026-11-13';
let db: SqlExecutor;
let counter = 0;
const newId = () => `id-${String(++counter).padStart(3, '0')}`;

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});

describe('the app-icon shortcuts', () => {
  it('know their three actions and nothing else', () => {
    expect(['workout', 'water', 'food'].every(isShortcutAction)).toBe(true);
    expect(isShortcutAction('settings')).toBe(false);
    expect(isShortcutAction(undefined)).toBe(false);
  });

  it('water: adds a glass to today and shows the home screen', async () => {
    const outcome = await runShortcut(db, USER, newId, 'water', TODAY);
    expect(outcome).toEqual({ replace: '/', addedMl: 250 });
    expect(await getWaterTotal(db, USER, TODAY)).toBe(250);
  });

  it('water: adds the amount on this person’s first water button', async () => {
    await setWaterButtons(db, USER, [330, 750]);
    const outcome = await runShortcut(db, USER, newId, 'water', TODAY);
    expect(outcome.addedMl).toBe(330);
    expect(await getWaterTotal(db, USER, TODAY)).toBe(330);
  });

  it('workout: with nothing planned, opens the workout tab and starts nothing', async () => {
    expect(await runShortcut(db, USER, newId, 'workout', TODAY)).toEqual({
      replace: '/(tabs)/workouts',
    });
    expect(await getActiveSession(db, USER)).toBeNull();
  });

  it('workout: an open workout is resumed, never a second one started', async () => {
    const open = await startSession(db, USER, newId);
    await runShortcut(db, USER, newId, 'workout', TODAY);
    expect((await getActiveSession(db, USER))?.id).toBe(open);
    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM workout_sessions WHERE user_id = ?`,
      [USER],
    );
    expect(count?.n).toBe(1);
  });

  it('food: opens adding food over the home screen; anything unknown goes home', async () => {
    expect(await runShortcut(db, USER, newId, 'food', TODAY)).toEqual({
      replace: '/',
      push: '/food-add',
    });
    expect(await runShortcut(db, USER, newId, 'nonsense', TODAY)).toEqual({ replace: '/' });
    expect(await runShortcut(db, USER, newId, undefined, TODAY)).toEqual({ replace: '/' });
  });
});
