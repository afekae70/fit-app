import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import { describe, expect, it } from 'vitest';

import { bodyDays, bodySummary } from '../analytics/body.js';
import { addDays, parseDay } from '../analytics/dates.js';
import { nutritionDays, nutritionSummary } from '../analytics/nutrition.js';
import { traineeOverview } from '../analytics/overview.js';
import { buildDemo } from './demoData.js';
import { demoSource } from './demoSource.js';

const TODAY = '2026-10-12';

describe('the demonstration', () => {
  const demo = buildDemo(TODAY);
  const lineFor = (id: string) => {
    const trainee = demo.find((t) => t.person.id === id)!;
    return traineeOverview({
      sessions: trainee.sessions.filter((s) => s.startedAt >= new Date(2026, 7, 17).toISOString()),
      calendar: trainee.calendar,
      plans: trainee.plans,
      today: TODAY,
    });
  };

  it('is the same every time it is built', () => {
    expect(JSON.stringify(buildDemo(TODAY).map((t) => t.sessions))).toBe(
      JSON.stringify(demo.map((t) => t.sessions)),
    );
  });

  it('has a trainee for each thing the front page is there to show', () => {
    expect(lineFor('demo-noa').flags).toEqual([]);
    expect(lineFor('demo-yoav').flags).toContain('stalling');
    expect(lineFor('demo-shira').flags).toContain('inactive');
    expect(lineFor('demo-omer').flags).toContain('missing');
    expect(lineFor('demo-michal').flags).toContain('unplanned');
  });

  it('uses only exercises the catalogue knows, and invented people', () => {
    for (const trainee of demo) {
      expect(trainee.person.email.endsWith('@example.com')).toBe(true);
      for (const session of trainee.sessions) {
        for (const exercise of session.exercises) {
          expect(EXERCISE_BY_KEY.has(exercise.exerciseKey ?? '')).toBe(true);
        }
      }
    }
  });

  it('never has a workout in the future', () => {
    const tomorrow = new Date(2026, 9, 13).toISOString();
    for (const trainee of demo) {
      expect(trainee.sessions.every((s) => s.startedAt < tomorrow)).toBe(true);
    }
  });

  it('answers a change on the next read, like the server', async () => {
    const source = demoSource(TODAY);
    const date = addDays(TODAY, 3);
    await source.setSchedule('demo-michal', date, [], true);
    const read = await source.schedule('demo-michal', date, date);
    expect(read.ok && read.value.get(date)).toBeNull();
    expect(read.ok && read.value.has(date)).toBe(true);
  });

  it('has someone sharing each thing, and someone sharing nothing', () => {
    const sharing = Object.fromEntries(demo.map((t) => [t.person.id, t.person.sharing]));
    expect(demo.some((t) => t.person.sharing.body)).toBe(true);
    expect(demo.some((t) => t.person.sharing.nutrition)).toBe(true);
    expect(demo.some((t) => t.person.sharing.photos)).toBe(true);
    expect(sharing['demo-omer']).toEqual({ body: false, nutrition: false, photos: false });
  });

  it('holds no data for what a trainee does not share', () => {
    for (const trainee of demo) {
      if (!trainee.person.sharing.body) expect(trainee.shared.measurements).toEqual([]);
      if (!trainee.person.sharing.nutrition) {
        expect(trainee.shared.nutrition.entries).toEqual([]);
        expect(trainee.shared.nutrition.targets).toBeNull();
      }
      if (!trainee.person.sharing.photos) expect(trainee.shared.photos).toEqual([]);
    }
  });

  it('tells the stories the new tabs are for', () => {
    const noa = demo.find((t) => t.person.id === 'demo-noa')!;
    const noaBody = bodySummary(bodyDays(noa.shared.measurements, addDays(TODAY, -84), TODAY));
    expect(noaBody.weeklyRateKg).toBeLessThan(-0.1);

    // Yoav's bench has stalled — and he eats well under what a bulk needs.
    const yoav = demo.find((t) => t.person.id === 'demo-yoav')!;
    const from = addDays(TODAY, -28);
    const eaten = nutritionSummary(
      nutritionDays(yoav.shared.nutrition, from, TODAY),
      yoav.shared.nutrition.targets,
      TODAY,
    );
    expect(eaten.avgCalories!).toBeLessThan(yoav.shared.nutrition.targets!.calorieTarget * 0.92);
  });

  it('never logs a day that has not come yet', () => {
    for (const trainee of demo) {
      expect(trainee.shared.nutrition.entries.every((e) => e.date <= TODAY)).toBe(true);
      expect(trainee.shared.photos.every((p) => p.takenOn <= TODAY)).toBe(true);
      const tomorrow = parseDay(addDays(TODAY, 1)).toISOString();
      expect(trainee.shared.measurements.every((m) => m.measuredAt < tomorrow)).toBe(true);
    }
  });

  it('refuses what is not shared, as the server does', async () => {
    const source = demoSource(TODAY);
    const notShared = { ok: false, error: 'not_shared' };
    expect(await source.body('demo-omer', new Date(0), new Date())).toEqual(notShared);
    expect(await source.nutrition('demo-omer', '2026-01-01', TODAY)).toEqual(notShared);
    expect(await source.photos('demo-yoav')).toEqual(notShared);
    expect(await source.photoUrls('demo-yoav', ['demo-yoav-photo-0'])).toEqual({});

    const photos = await source.photos('demo-noa');
    expect(photos.ok && photos.value.length).toBeGreaterThan(5);
    const ids = photos.ok ? photos.value.map((p) => p.id) : [];
    const urls = await source.photoUrls('demo-noa', ids.slice(0, 2));
    expect(Object.keys(urls)).toEqual(ids.slice(0, 2));
    // Drawn, not photographed.
    expect(Object.values(urls).every((url) => url.startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('cuts the food log to the dates asked for', async () => {
    const answer = await demoSource(TODAY).nutrition('demo-noa', addDays(TODAY, -6), TODAY);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.entries.every((e) => e.date >= addDays(TODAY, -6))).toBe(true);
    expect(answer.value.targets?.goal).toBe('cut');
  });

  it('refuses a trainee who is not there, as the server does', async () => {
    const answer = await demoSource(TODAY).plans('somebody-else');
    expect(answer).toEqual({ ok: false, error: 'not_your_trainee' });
  });
});
