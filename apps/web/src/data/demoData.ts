/**
 * Made-up trainees for the demonstration: plans, a calendar, and a year of workouts.
 *
 * Deterministic — a seeded generator, not `Math.random` — so the demonstration shows the same
 * people with the same numbers every time it is opened, and a test can rely on it.
 *
 * Each of them is there to show something the dashboard is for: one who trains steadily and
 * progresses, one who has stopped, one whose main lift has stalled, one who misses planned
 * workouts, one with nothing planned ahead. The names are invented and the emails are on
 * `example.com`, which exists for exactly this.
 */

import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import type {
  CoachCalendar,
  CoachDay,
  CoachExercise,
  CoachingPerson,
  CoachPlan,
  CoachSession,
  CoachSet,
} from '@fit/shared/coaching';

import { addDays, parseDay } from '../analytics/dates.js';

/** Mulberry32: small, fast, and the same sequence for the same seed. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LiftPlan {
  key: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  /** Starting working weight, kg, and how much it rises per week of training. */
  start: number;
  weekly: number;
}

interface DemoTraineeSpec {
  id: string;
  name: string;
  email: string;
  sinceDaysAgo: number;
  /** Days of the week (0 = Sunday) the plan's workouts fall on, in order. */
  weekdays: number[];
  /** Workouts of the plan; each is trained on the matching weekday. */
  days: { name: string; lifts: LiftPlan[] }[];
  /** How likely a planned workout is to happen. */
  attendance: number;
  /** Stopped training this many days ago. */
  stoppedDaysAgo?: number;
  /** The first lift stops progressing this many weeks ago. */
  stallWeeksAgo?: number;
  /** Nothing planned from today on. */
  nothingAhead?: boolean;
}

const lift = (
  key: string,
  sets: number,
  repsMin: number,
  repsMax: number,
  start: number,
  weekly: number,
): LiftPlan => {
  if (!EXERCISE_BY_KEY.has(key)) throw new Error(`Not in the catalogue: ${key}`);
  return { key, sets, repsMin, repsMax, start, weekly };
};

const SPECS: DemoTraineeSpec[] = [
  {
    id: 'demo-noa',
    name: 'נועה כהן',
    email: 'noa@example.com',
    sinceDaysAgo: 320,
    weekdays: [0, 2, 4],
    days: [
      {
        name: 'פלג גוף עליון',
        lifts: [
          lift('Barbell Bench Press', 4, 6, 8, 37.5, 0.5),
          lift('Barbell Row', 4, 8, 10, 35, 0.4),
          lift('Overhead Barbell Press', 3, 6, 8, 25, 0.25),
          lift('Lat Pulldown', 3, 10, 12, 35, 0.3),
        ],
      },
      {
        name: 'פלג גוף תחתון',
        lifts: [
          lift('Back Squat', 4, 5, 6, 50, 0.9),
          lift('Romanian Deadlift', 3, 8, 10, 45, 0.6),
          lift('Hip Thrust', 3, 10, 12, 60, 0.8),
        ],
      },
      {
        name: 'גוף מלא',
        lifts: [
          lift('Conventional Deadlift', 3, 4, 5, 70, 1),
          lift('Barbell Bench Press', 3, 8, 10, 32.5, 0.4),
          lift('Pull-up', 3, 5, 8, 0, 0),
        ],
      },
    ],
    attendance: 0.92,
  },
  {
    id: 'demo-yoav',
    name: 'יואב לוי',
    email: 'yoav@example.com',
    sinceDaysAgo: 260,
    weekdays: [0, 1, 3, 4],
    days: [
      {
        name: 'דחיפה',
        lifts: [
          lift('Barbell Bench Press', 4, 5, 6, 80, 0.8),
          lift('Overhead Barbell Press', 3, 6, 8, 45, 0.4),
          lift('Incline Dumbbell Press', 3, 8, 10, 26, 0.2),
        ],
      },
      {
        name: 'משיכה',
        lifts: [lift('Barbell Row', 4, 6, 8, 70, 0.6), lift('Lat Pulldown', 3, 8, 10, 60, 0.5)],
      },
      {
        name: 'רגליים',
        lifts: [
          lift('Back Squat', 4, 5, 6, 100, 1.2),
          lift('Romanian Deadlift', 3, 8, 10, 80, 0.8),
        ],
      },
      {
        name: 'גוף מלא',
        lifts: [
          lift('Conventional Deadlift', 3, 3, 5, 130, 1.4),
          lift('Barbell Bench Press', 3, 8, 10, 70, 0.6),
        ],
      },
    ],
    attendance: 0.9,
    stallWeeksAgo: 6,
  },
  {
    id: 'demo-shira',
    name: 'שירה מזרחי',
    email: 'shira@example.com',
    sinceDaysAgo: 150,
    weekdays: [1, 3, 5],
    days: [
      {
        name: 'אימון א׳',
        lifts: [
          lift('Goblet Squat', 3, 10, 12, 16, 0.3),
          lift('Dumbbell Bench Press', 3, 10, 12, 10, 0.15),
        ],
      },
      {
        name: 'אימון ב׳',
        lifts: [
          lift('Romanian Deadlift', 3, 10, 12, 30, 0.4),
          lift('Seated Cable Row', 3, 10, 12, 30, 0.3),
        ],
      },
      {
        name: 'אימון ג׳',
        lifts: [lift('Leg Press', 3, 12, 15, 80, 1.2), lift('Lat Pulldown', 3, 10, 12, 30, 0.3)],
      },
    ],
    attendance: 0.85,
    stoppedDaysAgo: 11,
  },
  {
    id: 'demo-omer',
    name: 'עומר ביטון',
    email: 'omer@example.com',
    sinceDaysAgo: 200,
    weekdays: [0, 2, 4],
    days: [
      {
        name: 'כוח',
        lifts: [
          lift('Back Squat', 5, 3, 5, 90, 0.9),
          lift('Barbell Bench Press', 5, 3, 5, 72.5, 0.6),
        ],
      },
      {
        name: 'נפח',
        lifts: [
          lift('Front Squat', 4, 8, 10, 60, 0.6),
          lift('Incline Barbell Bench Press', 4, 8, 10, 55, 0.5),
        ],
      },
      {
        name: 'גב',
        lifts: [lift('Conventional Deadlift', 4, 4, 6, 120, 1.1), lift('Pull-up', 4, 6, 10, 0, 0)],
      },
    ],
    attendance: 0.62,
  },
  {
    id: 'demo-michal',
    name: 'מיכל רוזן',
    email: 'michal@example.com',
    sinceDaysAgo: 90,
    weekdays: [1, 4],
    days: [
      {
        name: 'גוף מלא א׳',
        lifts: [
          lift('Back Squat', 3, 8, 10, 40, 0.7),
          lift('Barbell Bench Press', 3, 8, 10, 30, 0.4),
        ],
      },
      {
        name: 'גוף מלא ב׳',
        lifts: [
          lift('Conventional Deadlift', 3, 6, 8, 55, 0.9),
          lift('Lat Pulldown', 3, 10, 12, 30, 0.3),
        ],
      },
    ],
    attendance: 0.88,
    nothingAhead: true,
  },
];

export interface DemoTrainee {
  person: CoachingPerson;
  plans: CoachPlan[];
  calendar: CoachCalendar;
  sessions: CoachSession[];
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** The whole demonstration, as of `today`. */
export function buildDemo(today: string): DemoTrainee[] {
  return SPECS.map((spec, specIndex) => {
    const random = generator(1000 + specIndex * 7919);
    let idCounter = 0;
    const nextId = (prefix: string) => `${spec.id}-${prefix}-${++idCounter}`;

    const days: CoachDay[] = spec.days.map((day) => ({
      id: nextId('day'),
      name: day.name,
      workSeconds: null,
      restSeconds: null,
      rounds: null,
      exercises: day.lifts.map((planned): CoachExercise => ({
        id: nextId('exercise'),
        exerciseKey: planned.key,
        targetSets: planned.sets,
        targetRepsMin: planned.repsMin,
        targetRepsMax: planned.repsMax,
        notes: null,
      })),
    }));
    const plan: CoachPlan = { id: nextId('plan'), name: 'תוכנית עיקרית', isActive: true, days };

    const calendar: CoachCalendar = new Map();
    const sessions: CoachSession[] = [];
    const start = addDays(today, -spec.sinceDaysAgo);
    const horizon = addDays(today, 13);

    for (let date = start; date <= horizon; date = addDays(date, 1)) {
      const weekday = parseDay(date).getDay();
      const slot = spec.weekdays.indexOf(weekday);
      if (slot < 0) continue;
      if (date >= today && spec.nothingAhead) continue;
      const day = days[slot % days.length]!;
      const dayPlan = spec.days[slot % spec.days.length]!;
      calendar.set(date, [day.id]);

      if (date >= today) continue;
      if (spec.stoppedDaysAgo !== undefined && date > addDays(today, -spec.stoppedDaysAgo))
        continue;
      if (random() > spec.attendance) continue;

      const weeksIn = Math.floor(
        (parseDay(date).getTime() - parseDay(start).getTime()) / (7 * 86_400_000),
      );
      const startTime = parseDay(date);
      startTime.setHours(17 + Math.floor(random() * 3), Math.floor(random() * 60), 0, 0);

      const exercises = dayPlan.lifts.map((planned, liftIndex) => {
        let weeks = weeksIn;
        if (liftIndex === 0 && spec.stallWeeksAgo !== undefined) {
          const stallFrom = Math.floor(spec.sinceDaysAgo / 7) - spec.stallWeeksAgo;
          weeks = Math.min(weeks, stallFrom);
        }
        const step = planned.start >= 40 ? 2.5 : 1;
        const working =
          planned.start === 0 ? 0 : roundTo(planned.start + planned.weekly * weeks, step);
        const sets: CoachSet[] = [];
        if (working >= 40) {
          sets.push(setOf(nextId('set'), roundTo(working * 0.5, step), 10, true));
        }
        for (let n = 0; n < planned.sets; n += 1) {
          const reps =
            planned.repsMin + Math.floor(random() * (planned.repsMax - planned.repsMin + 1));
          sets.push(setOf(nextId('set'), working === 0 ? null : working, reps, false));
        }
        return { exerciseKey: planned.key, supersetWithNext: false, sets };
      });

      const minutes = 45 + Math.floor(random() * 35);
      sessions.push({
        id: nextId('session'),
        name: dayPlan.name,
        planDayId: day.id,
        startedAt: startTime.toISOString(),
        endedAt: new Date(startTime.getTime() + minutes * 60_000).toISOString(),
        rpe: [6, 7, 7, 8, 8, 9][Math.floor(random() * 6)] ?? 7,
        note: random() < 0.06 ? 'הכתף השמאלית הציקה בסט האחרון' : null,
        exercises,
      });
    }

    sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return {
      person: {
        id: spec.id,
        email: spec.email,
        name: spec.name,
        since: parseDay(start).toISOString(),
      },
      plans: [plan],
      calendar,
      sessions,
    };
  });
}

function setOf(id: string, weight: number | null, reps: number, warmup: boolean): CoachSet {
  return {
    id,
    weight_kg: weight,
    reps,
    duration_seconds: null,
    distance_m: null,
    rpe: null,
    is_warmup: warmup ? 1 : 0,
    is_drop: 0,
    to_failure: 0,
  };
}
