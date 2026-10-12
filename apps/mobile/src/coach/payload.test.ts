/**
 * What the coach is told about eating and drinking, built from a real database and held to
 * the real contract.
 *
 * The contract matters more than the shape. The server validates every request against
 * `coachContextSchema` and refuses the whole of one that does not fit — so a number here that
 * strays outside a bound does not produce a slightly wrong answer, it produces no coach at all.
 * Every digest built below is therefore parsed by that schema, not just compared to a literal.
 */

import { coachContextSchema } from '@fit/shared/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../db/executor.js';
import { addFoodEntry, deleteFoodEntry, listFoodDays, listFoodEntries } from '../db/food.js';
import { createTestExecutor } from '../db/testUtils.js';
import { addWater, undoLastWater } from '../db/water.js';
import { sumDay } from '../food/foodMath.js';
import { buildCoachPayload } from './payload.js';

const USER = 'user-1';
// Midday, local: far from midnight in any time zone the tests might run in.
const NOW = new Date(2026, 9, 12, 12, 0, 0);
const TODAY = '2026-10-12';

let db: SqlExecutor & { close: () => void };
let counter = 0;
let tick = Date.parse('2026-10-12T08:00:00.000Z');
const newId = () => `id-${++counter}`;
const clock = () => new Date((tick += 1000)).toISOString();

beforeEach(() => {
  db = createTestExecutor();
  counter = 0;
});
afterEach(() => db.close());

const eat = (
  eatenOn: string,
  name: string,
  calories: number,
  macros: { proteinG?: number | null; carbsG?: number | null; fatG?: number | null } = {
    proteinG: 10,
    carbsG: 20,
    fatG: 5,
  },
  userId = USER,
) => addFoodEntry(db, userId, newId, { eatenOn, name, calories, ...macros }, clock);

const build = async () => {
  const payload = await buildCoachPayload(db, USER, { locale: 'he', today: NOW });
  // The server's own check. Throws, and fails the test, on anything it would refuse.
  coachContextSchema.parse(payload);
  return payload;
};

describe('the food log in the coach’s digest', () => {
  it('is empty, and still a valid request, when nothing has been logged', async () => {
    expect((await build()).intake).toEqual({ days: [], today: [], water: [] });
  });

  it('adds each logged day up the way the food screen does', async () => {
    await eat('2026-10-11', 'אורז', 325, { proteinG: 6.8, carbsG: 70, fatG: 0.8 });
    await eat('2026-10-11', 'עוף', 248, { proteinG: 46.5, carbsG: 0, fatG: 5.4 });
    await eat(TODAY, 'ביצה', 155, { proteinG: 12.6, carbsG: 1.1, fatG: 10.6 });

    expect((await build()).intake.days).toEqual([
      {
        date: '2026-10-11',
        calories: 573,
        proteinG: 53.3,
        carbsG: 70,
        fatG: 6.2,
        macrosPartial: false,
        entryCount: 2,
      },
      {
        date: TODAY,
        calories: 155,
        proteinG: 12.6,
        carbsG: 1.1,
        fatG: 10.6,
        macrosPartial: false,
        entryCount: 1,
      },
    ]);
  });

  it('leaves out a day with nothing logged, rather than sending a day of zeros', async () => {
    await eat('2026-10-09', 'ארוחה', 600);
    await eat(TODAY, 'ארוחה', 700);
    const days = (await build()).intake.days.map((day) => day.date);
    expect(days).toEqual(['2026-10-09', TODAY]);
  });

  it('goes back a week and no further, and never forward', async () => {
    await eat('2026-10-05', 'לפני שבוע ויום', 500);
    await eat('2026-10-06', 'לפני שישה ימים', 500);
    await eat('2026-10-13', 'מחר', 500);
    expect((await build()).intake.days.map((day) => day.date)).toEqual(['2026-10-06']);
  });

  it('marks a day whose macros have gaps, so the total is read as a floor', async () => {
    await eat(TODAY, 'מהרשימה', 300);
    await eat(TODAY, 'ביד, רק קלוריות', 450, { proteinG: null, carbsG: null, fatG: null });
    const [day] = (await build()).intake.days;
    expect(day).toMatchObject({ calories: 750, proteinG: 10, macrosPartial: true, entryCount: 2 });
  });

  it('names what was eaten today, in the order it was eaten, and only today', async () => {
    await eat('2026-10-11', 'אתמול', 500);
    await eat(TODAY, 'ביצה קשה', 155.4);
    await eat(TODAY, 'יוגורט', 120);
    expect((await build()).intake.today).toEqual([
      { name: 'ביצה קשה', calories: 155 },
      { name: 'יוגורט', calories: 120 },
    ]);
  });

  it('does not tell the coach about something that was taken out of the log', async () => {
    const id = await eat(TODAY, 'טעות', 900);
    await eat(TODAY, 'נכון', 300);
    await deleteFoodEntry(db, USER, id!, clock);
    const { intake } = await build();
    expect(intake.today).toEqual([{ name: 'נכון', calories: 300 }]);
    expect(intake.days[0]).toMatchObject({ calories: 300, entryCount: 1 });
  });

  it('is this person’s log and nobody else’s on the phone', async () => {
    await eat(TODAY, 'שלי', 300);
    await eat(TODAY, 'של מישהו אחר', 5000, undefined, 'someone-else');
    await addWater(db, 'someone-else', newId, { drunkOn: TODAY, ml: 3000 }, clock);
    const { intake } = await build();
    expect(intake.today).toEqual([{ name: 'שלי', calories: 300 }]);
    expect(intake.days[0]?.calories).toBe(300);
    expect(intake.water).toEqual([]);
  });

  it('includes water, a day at a time, without what was taken back', async () => {
    await addWater(db, USER, newId, { drunkOn: '2026-10-11', ml: 500 }, clock);
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 250 }, clock);
    await addWater(db, USER, newId, { drunkOn: TODAY, ml: 500 }, clock);
    await undoLastWater(db, USER, TODAY, clock);
    expect((await build()).intake.water).toEqual([
      { date: '2026-10-11', ml: 500 },
      { date: TODAY, ml: 250 },
    ]);
  });

  it('stays a request the server accepts however absurd the log is', async () => {
    // Three entries at the most one entry may hold: more in a day than the contract allows a
    // day to be. Unclamped, this fails validation and takes the whole coach down with it.
    for (let index = 0; index < 3; index += 1) {
      await eat(TODAY, `הקלדה שגויה ${index}`, 20_000, {
        proteinG: 2000,
        carbsG: 2000,
        fatG: 2000,
      });
    }
    for (let index = 0; index < 60; index += 1) await eat(TODAY, `פריט ${index}`, 10);
    for (let index = 0; index < 12; index += 1) {
      await addWater(db, USER, newId, { drunkOn: TODAY, ml: 5000 }, clock);
    }

    const { intake } = await build(); // parses against the schema, or throws
    expect(intake.days[0]).toMatchObject({ calories: 50_000, proteinG: 5000, entryCount: 63 });
    expect(intake.today).toHaveLength(40);
    expect(intake.water).toEqual([{ date: TODAY, ml: 50_000 }]);
  });
});

describe('what each logged day came to', () => {
  it('adds a day up the way the screen’s total does', async () => {
    // An entry's calories are stored whole, so two of 100.4 are 200 and not 201; macros are
    // summed and then rounded to a tenth, so two of 0.14 are 0.3 and not 0.2.
    await eat(TODAY, 'א', 100.4, { proteinG: 0.14, carbsG: 0.14, fatG: 0.14 });
    await eat(TODAY, 'ב', 100.4, { proteinG: 0.14, carbsG: 0.14, fatG: 0.14 });
    const days = await listFoodDays(db, USER, TODAY, TODAY);
    expect(days).toEqual([
      {
        day: TODAY,
        calories: 200,
        proteinG: 0.3,
        carbsG: 0.3,
        fatG: 0.3,
        partial: false,
        entries: 2,
      },
    ]);
    // The same entries through the function the food screen uses.
    const summed = sumDay(await listFoodEntries(db, USER, TODAY));
    expect([days[0]!.calories, days[0]!.proteinG, days[0]!.carbsG, days[0]!.fatG]).toEqual([
      summed.calories,
      summed.proteinG,
      summed.carbsG,
      summed.fatG,
    ]);
  });

  it('is empty for a span with nothing in it', async () => {
    expect(await listFoodDays(db, USER, '2026-10-01', TODAY)).toEqual([]);
  });
});
