import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import { describe, expect, it } from 'vitest';

import { addDays } from '../analytics/dates.js';
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

  it('refuses a trainee who is not there, as the server does', async () => {
    const answer = await demoSource(TODAY).plans('somebody-else');
    expect(answer).toEqual({ ok: false, error: 'not_your_trainee' });
  });
});
