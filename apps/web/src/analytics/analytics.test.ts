import { epley1RM } from '@fit/shared/calculations';
import type { CoachCalendar, CoachSession } from '@fit/shared/coaching';
import { describe, expect, it } from 'vitest';

import { sessionsBetween, SESSION_PAGE } from '../data/source.js';
import { addDays, daysApart, daysBetween, rangeStart, weeksBetween, weekStart } from './dates.js';
import {
  changePercent,
  exerciseName,
  exerciseSummaries,
  liftSeries,
  recordsSince,
} from './lifts.js';
import { traineeOverview } from './overview.js';
import { BENCH, set, SQUAT, workout } from './testSessions.js';
import {
  adherenceOver,
  adherenceRate,
  muscleSetsPerWeek,
  periodTotals,
  sessionsWithin,
  weeklyBuckets,
  weekStreak,
} from './training.js';

// A Monday.
const TODAY = '2026-10-12';

describe('dates, as the app counts them', () => {
  it('starts a week on Sunday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-11');
    expect(weekStart('2026-10-11')).toBe('2026-10-11');
    expect(weekStart('2026-10-17')).toBe('2026-10-11');
  });

  it('counts across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysApart('2026-02-27', '2026-03-02')).toBe(3);
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(daysBetween('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('starts a period on a whole week, so the first week of a chart is not a part-week', () => {
    expect(rangeStart('4w', TODAY)).toBe('2026-09-20');
    expect(weeksBetween(rangeStart('4w', TODAY), TODAY)).toEqual([
      '2026-09-20',
      '2026-09-27',
      '2026-10-04',
      '2026-10-11',
    ]);
    expect(weeksBetween(rangeStart('52w', TODAY), TODAY)).toHaveLength(52);
  });
});

describe('reading every workout in a range, sixty at a time', () => {
  const many = (count: number, newest: string): CoachSession[] =>
    Array.from({ length: count }, (_, index) => workout(addDays(newest, -index), []));

  it('asks again while the server keeps filling a page, and stops when it does not', async () => {
    const all = many(SESSION_PAGE * 2 + 7, TODAY);
    const asked: string[] = [];
    const answer = await sessionsBetween(
      async (from, to) => {
        asked.push(to);
        const page = all
          .filter((session) => session.startedAt >= from && session.startedAt < to)
          .slice(0, SESSION_PAGE);
        return { ok: true, value: page };
      },
      new Date(2020, 0, 1),
      new Date(2027, 0, 1),
    );
    expect(answer.ok && answer.value.length).toBe(SESSION_PAGE * 2 + 7);
    expect(asked).toHaveLength(3);
    // Newest first, and each workout once.
    const ids = answer.ok ? answer.value.map((session) => session.id) : [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(all[0]!.id);
  });

  it('asks once when the first page is not full', async () => {
    let calls = 0;
    await sessionsBetween(
      async () => {
        calls += 1;
        return { ok: true, value: many(3, TODAY) };
      },
      new Date(2020, 0, 1),
      new Date(2027, 0, 1),
    );
    expect(calls).toBe(1);
  });

  it('passes a refusal on rather than a partial list', async () => {
    const answer = await sessionsBetween(
      async () => ({ ok: false, error: 'not_your_trainee' }),
      new Date(2020, 0, 1),
      new Date(2027, 0, 1),
    );
    expect(answer).toEqual({ ok: false, error: 'not_your_trainee' });
  });

  it('stops rather than ask the same page for ever', async () => {
    let calls = 0;
    const stuck = many(SESSION_PAGE, TODAY);
    await sessionsBetween(
      async () => {
        calls += 1;
        return { ok: true, value: stuck };
      },
      new Date(2020, 0, 1),
      new Date(2027, 0, 1),
    );
    expect(calls).toBeLessThanOrEqual(20);
  });
});

describe('a lift’s strength line', () => {
  it('takes each workout’s best reliable set, by the shared formula', () => {
    const sessions = [
      workout('2026-10-01', [
        {
          key: BENCH,
          sets: [
            [80, 8],
            [85, 5],
            [70, 15],
          ],
          warmups: [[120, 1]],
        },
      ]),
      workout('2026-10-05', [{ key: BENCH, sets: [[87.5, 5]] }]),
    ];
    const series = liftSeries(sessions, BENCH);
    expect(series.map((point) => point.date)).toEqual(['2026-10-01', '2026-10-05']);
    // 80×8 is 101.3, 85×5 is 99.2: the eight-rep set wins. The warm-up single never counts.
    expect(series[0]).toMatchObject({
      weightKg: 80,
      reps: 8,
      e1rm: Math.round(epley1RM(80, 8) * 10) / 10,
    });
    expect(series[0]!.volumeKg).toBe(80 * 8 + 85 * 5 + 70 * 15);
  });

  it('has no point for a workout of nothing but high-rep sets', () => {
    expect(liftSeries([workout(TODAY, [{ key: BENCH, sets: [[40, 20]] }])], BENCH)).toEqual([]);
  });

  it('leaves out sets with no weight or no reps', () => {
    const plank = workout(TODAY, []);
    plank.exercises.push({
      exerciseKey: BENCH,
      supersetWithNext: false,
      sets: [set(null, 10), set(60, null)],
    });
    expect(liftSeries([plank], BENCH)).toEqual([]);
  });

  it('is oldest first whatever order the workouts came in', () => {
    const series = liftSeries(
      [
        workout('2026-10-09', [{ key: BENCH, sets: [[90, 3]] }]),
        workout('2026-10-01', [{ key: BENCH, sets: [[80, 3]] }]),
      ],
      BENCH,
    );
    expect(series.map((point) => point.weightKg)).toEqual([80, 90]);
  });
});

describe('every exercise in a period', () => {
  const block = [
    workout('2026-09-21', [
      {
        key: BENCH,
        sets: [
          [80, 5],
          [80, 5],
        ],
      },
      { key: SQUAT, sets: [[100, 5]] },
    ]),
    workout('2026-09-28', [
      {
        key: BENCH,
        sets: [
          [82.5, 5],
          [82.5, 5],
        ],
      },
    ]),
    workout('2026-10-05', [{ key: BENCH, sets: [[85, 5]] }]),
  ];

  it('puts the lift done most often first, and adds it up', () => {
    const [bench, squat] = exerciseSummaries(block);
    expect(bench).toMatchObject({
      exerciseKey: BENCH,
      sessions: 3,
      workingSets: 5,
      volumeKg: 80 * 10 + 82.5 * 10 + 85 * 5,
      lastDone: '2026-10-05',
      bestDate: '2026-10-05',
    });
    expect(squat).toMatchObject({ exerciseKey: SQUAT, sessions: 1 });
  });

  it('measures the change across the period from the first workout to the latest', () => {
    const [bench] = exerciseSummaries(block);
    expect(changePercent(bench!)).toBeCloseTo(((85 - 80) / 80) * 100, 0);
    expect(changePercent({ firstE1rm: null, latestE1rm: 90 })).toBeNull();
  });

  it('calls a lift stalling by the app’s own rule', () => {
    const flat = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map(
      (day, i) => workout(day, [{ key: BENCH, sets: [[i === 0 ? 90 : 85, 5]] }]),
    );
    expect(exerciseSummaries(flat)[0]!.stall.isStalling).toBe(true);
    expect(exerciseSummaries(block)[0]!.stall.isStalling).toBe(false);
  });

  it('does not count an exercise that had nothing but warm-ups', () => {
    const summaries = exerciseSummaries([
      workout(TODAY, [{ key: SQUAT, sets: [], warmups: [[60, 5]] }]),
    ]);
    expect(summaries).toEqual([]);
  });

  it('names exercises in Hebrew, and falls back to the key', () => {
    expect(exerciseName(BENCH)).toBe('לחיצת חזה במוט');
    expect(exerciseName('Custom Thing')).toBe('Custom Thing');
    expect(exerciseName(null)).toBe('—');
  });
});

describe('records set in a period', () => {
  const history = [
    workout('2026-08-01', [{ key: BENCH, sets: [[90, 5]] }]),
    workout('2026-09-01', [{ key: BENCH, sets: [[85, 5]] }]),
    workout('2026-10-01', [
      { key: BENCH, sets: [[92.5, 5]] },
      { key: SQUAT, sets: [[100, 5]] },
    ]),
    workout('2026-10-08', [{ key: BENCH, sets: [[95, 5]] }]),
  ];

  it('finds workouts that beat everything before them, reaching back past the period', () => {
    const records = recordsSince(history, '2026-09-15');
    expect(records.map((record) => [record.date, record.weightKg])).toEqual([
      ['2026-10-08', 95],
      ['2026-10-01', 92.5],
    ]);
    expect(records[1]!.previousE1rm).toBeCloseTo(epley1RM(90, 5), 1);
  });

  it('does not call a lift’s first appearance a record', () => {
    expect(recordsSince(history, '2026-09-15').some((record) => record.exerciseKey === SQUAT)).toBe(
      false,
    );
  });

  it('finds nothing before the period starts', () => {
    expect(recordsSince(history, '2026-10-09')).toEqual([]);
  });
});

describe('a period, week by week', () => {
  const sessions = [
    workout(
      '2026-09-20',
      [
        {
          key: BENCH,
          sets: [
            [80, 5],
            [80, 5],
          ],
        },
      ],
      { minutes: 50, rpe: 6 },
    ),
    workout('2026-09-24', [{ key: SQUAT, sets: [[100, 5]] }], { minutes: 70, rpe: 8 }),
    workout('2026-10-06', [{ key: BENCH, sets: [[85, 5]], warmups: [[40, 10]] }], { minutes: 45 }),
  ];
  const weeks = weeksBetween(rangeStart('4w', TODAY), TODAY);

  it('adds up each week, and keeps an empty week as zeros', () => {
    expect(weeklyBuckets(sessions, weeks)).toEqual([
      { weekStart: '2026-09-20', workouts: 2, volumeKg: 800 + 500, workingSets: 3, minutes: 120 },
      { weekStart: '2026-09-27', workouts: 0, volumeKg: 0, workingSets: 0, minutes: 0 },
      { weekStart: '2026-10-04', workouts: 1, volumeKg: 425, workingSets: 1, minutes: 45 },
      { weekStart: '2026-10-11', workouts: 0, volumeKg: 0, workingSets: 0, minutes: 0 },
    ]);
  });

  it('totals the period, leaving the warm-ups out of the work', () => {
    expect(periodTotals(sessions)).toEqual({
      workouts: 3,
      volumeKg: 1725,
      workingSets: 4,
      averageMinutes: 55,
      averageRpe: 7,
      trainingDays: 3,
    });
  });

  it('has no average for what was never measured', () => {
    const untimed = workout(TODAY, [], { endedAt: null });
    expect(periodTotals([untimed])).toMatchObject({ averageMinutes: null, averageRpe: null });
    expect(periodTotals([])).toMatchObject({ workouts: 0, averageMinutes: null });
  });

  it('picks out the workouts of a span of days, inclusive', () => {
    expect(sessionsWithin(sessions, '2026-09-24', '2026-10-06')).toHaveLength(2);
  });
});

describe('against the calendar', () => {
  const calendar: CoachCalendar = new Map<string, string[] | null>([
    ['2026-10-05', ['day-a']],
    ['2026-10-07', ['day-b']],
    ['2026-10-08', null],
    ['2026-10-09', ['day-a']],
    ['2026-10-12', ['day-b']],
  ]);
  const sessions = [
    workout('2026-10-05', []),
    workout('2026-10-08', []),
    workout('2026-10-09', []),
  ];

  it('counts planned, done, missed and extra the app’s way', () => {
    expect(adherenceOver(sessions, calendar, '2026-10-04', '2026-10-12', TODAY)).toEqual({
      // Today's planned workout is planned, not missed.
      planned: 4,
      done: 2,
      missed: 1,
      // Trained on the rest day.
      extra: 1,
    });
  });

  it('is the share of the days that are over, and nothing when nothing was due', () => {
    expect(adherenceRate({ done: 2, missed: 1 })).toBeCloseTo(2 / 3);
    expect(adherenceRate({ done: 0, missed: 0 })).toBeNull();
  });
});

describe('muscles, and the streak', () => {
  it('spreads working sets over the weeks, with the shared helper-muscle rule', () => {
    const work = muscleSetsPerWeek(
      [
        workout(TODAY, [
          {
            key: BENCH,
            sets: [
              [80, 5],
              [80, 5],
              [80, 5],
              [80, 5],
            ],
            warmups: [[40, 10]],
          },
        ]),
      ],
      2,
    );
    const chest = work.find((muscle) => muscle.muscle === 'chest');
    const triceps = work.find((muscle) => muscle.muscle === 'triceps');
    expect(chest?.total).toBe(2);
    expect(triceps?.total).toBe(1);
  });

  it('counts the weeks in a row with a workout, not breaking on a week that is not over', () => {
    const sessions = ['2026-09-21', '2026-09-28', '2026-10-06'].map((day) => workout(day, []));
    expect(weekStreak(sessions, TODAY)).toBe(3);
    expect(weekStreak([...sessions, workout('2026-10-12', [])], TODAY)).toBe(4);
    expect(weekStreak([workout('2026-09-14', [])], TODAY)).toBe(0);
  });
});

describe('a trainee’s line on the front page', () => {
  const plans = [
    {
      id: 'plan',
      name: 'תוכנית',
      isActive: true,
      days: [
        {
          id: 'day-a',
          name: 'רגליים',
          exercises: [],
          workSeconds: null,
          restSeconds: null,
          rounds: null,
        },
        {
          id: 'day-b',
          name: null,
          exercises: [],
          workSeconds: null,
          restSeconds: null,
          rounds: null,
        },
      ],
    },
  ];

  it('says nothing is wrong with a trainee who trains, follows the plan and has one ahead', () => {
    const sessions = [workout('2026-10-09', [{ key: BENCH, sets: [[80, 5]] }])];
    const line = traineeOverview({
      sessions,
      calendar: new Map([
        ['2026-10-09', ['day-a']],
        ['2026-10-14', ['day-b']],
      ]),
      plans,
      today: TODAY,
    });
    expect(line.flags).toEqual([]);
    expect(line).toMatchObject({ daysSinceLast: 3, workouts7: 1, workouts28: 1, adherence14: 1 });
    // A workout with no name of its own goes by its plan and its place in it.
    expect(line.next).toEqual({ date: '2026-10-14', names: ['תוכנית 2'] });
  });

  it('flags a trainee who has stopped, missed the plan, and has nothing ahead', () => {
    const line = traineeOverview({
      sessions: [workout('2026-09-30', [])],
      calendar: new Map([
        ['2026-10-05', ['day-a']],
        ['2026-10-07', ['day-a']],
      ]),
      plans,
      today: TODAY,
    });
    expect(line.flags).toEqual(['inactive', 'missing', 'unplanned']);
    expect(line.adherence14).toBe(0);
    expect(line.next).toBeNull();
  });

  it('flags a trainee who has never trained as inactive, with no figures made up', () => {
    const line = traineeOverview({ sessions: [], calendar: new Map(), plans: [], today: TODAY });
    expect(line.flags).toContain('inactive');
    expect(line).toMatchObject({
      lastWorkoutAt: null,
      daysSinceLast: null,
      adherence14: null,
      volumeTrend: null,
    });
  });

  it('flags a main lift that has stopped moving', () => {
    const days = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-09'];
    const sessions = days.map((day, i) =>
      workout(day, [{ key: BENCH, sets: [[i === 0 ? 100 : 95, 5]] }]),
    );
    const line = traineeOverview({
      sessions,
      calendar: new Map([['2026-10-13', ['day-a']]]),
      plans,
      today: TODAY,
    });
    expect(line.flags).toEqual(['stalling']);
    expect(line.stalling).toEqual([BENCH]);
  });

  it('compares the last two weeks of volume with the two before', () => {
    const line = traineeOverview({
      sessions: [
        workout('2026-09-20', [{ key: BENCH, sets: [[100, 10]] }]),
        workout('2026-10-08', [{ key: BENCH, sets: [[100, 15]] }]),
      ],
      calendar: new Map(),
      plans,
      today: TODAY,
    });
    expect(line.volumeTrend).toBe(50);
  });
});
