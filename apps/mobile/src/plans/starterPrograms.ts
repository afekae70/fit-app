/**
 * Ready-made training programmes, for the account that has just been created and opens the app
 * to an empty plan.
 *
 * An empty plan is the worst first screen a training app can have: it asks someone who came for
 * guidance to design their own week before they have done a single workout. These are six
 * ordinary, well-worn splits — the ones a coach would hand a client who gave them two facts,
 * how many days and where — so that the first thing on screen is something to do.
 *
 * ## What they are, once added
 *
 * Nothing special. Adding one creates a plan with its workouts and their exercises through the
 * same functions the plan screen uses, and from that moment it is the user's own: rename it,
 * swap an exercise, delete a day. There is no link back to this file and nothing here is
 * consulted again. That is deliberate — a "template" the user cannot freely edit is a cage, and
 * one that updated itself behind them would rewrite a plan they had made their own.
 *
 * ## The numbers
 *
 * Deliberately unremarkable. The big lifts at 3-4 sets of 6-10, the smaller ones at 3 of 10-15:
 * the middle of what the evidence supports for someone who wants to get stronger and look like
 * it. Nothing is tuned to the goal the account chose — cutting and bulking are decided in the
 * kitchen, and the same programme serves both. An exercise done for time rather than reps (a
 * plank) carries sets only; the catalogue says which those are, see `starterTargets`.
 *
 * ## Names
 *
 * Every exercise is named by its catalogue key, which is the English name the rest of the app
 * stores. The test for this file checks each one against the catalogue, so a rename there is a
 * red test here rather than a workout with a blank row in it.
 */

import { EXERCISE_BY_KEY } from '@fit/shared';

/** Text that exists in both of the app's languages. */
export interface Bilingual {
  he: string;
  en: string;
}

export interface StarterExercise {
  /** The catalogue key: the exercise's English name. */
  key: string;
  sets: number;
  /** A rep range, lowest then highest. Left out for an exercise that is done for time. */
  reps?: readonly [number, number];
}

export interface StarterDay {
  name: Bilingual;
  exercises: readonly StarterExercise[];
}

export type StarterPlace = 'gym' | 'home';

export interface StarterProgram {
  id: string;
  name: Bilingual;
  /** One line on who it is for. */
  blurb: Bilingual;
  place: StarterPlace;
  /**
   * How many training days a week it suits. More than one where the same workouts are simply
   * gone round twice: push, pull, legs is three days, or six.
   */
  daysPerWeek: readonly number[];
  days: readonly StarterDay[];
}

const lift = (key: string, sets = 3): StarterExercise => ({ key, sets, reps: [6, 10] });
const build = (key: string, sets = 3): StarterExercise => ({ key, sets, reps: [8, 12] });
const pump = (key: string, sets = 3): StarterExercise => ({ key, sets, reps: [10, 15] });
const light = (key: string, sets = 3): StarterExercise => ({ key, sets, reps: [12, 15] });
const hold = (key: string, sets = 3): StarterExercise => ({ key, sets });

/* ---------------------------------------------------------------------- the workouts */

const PUSH: StarterDay = {
  name: { he: 'דחיפה', en: 'Push' },
  exercises: [
    lift('Barbell Bench Press', 4),
    build('Seated Dumbbell Shoulder Press'),
    build('Incline Dumbbell Press'),
    light('Dumbbell Lateral Raise'),
    pump('Cable Tricep Pushdown'),
    pump('Overhead Tricep Extension'),
  ],
};

const PULL: StarterDay = {
  name: { he: 'משיכה', en: 'Pull' },
  exercises: [
    build('Lat Pulldown', 4),
    lift('Barbell Row'),
    build('Seated Cable Row'),
    light('Face Pull'),
    build('Barbell Curl'),
    pump('Hammer Curl'),
  ],
};

const LEGS: StarterDay = {
  name: { he: 'רגליים', en: 'Legs' },
  exercises: [
    lift('Back Squat', 4),
    build('Romanian Deadlift'),
    build('Leg Press'),
    pump('Seated Leg Curl'),
    pump('Standing Calf Raise'),
    pump('Cable Crunch'),
  ],
};

const UPPER_A: StarterDay = {
  name: { he: 'עליון א׳', en: 'Upper A' },
  exercises: [
    lift('Barbell Bench Press', 4),
    lift('Barbell Row', 4),
    build('Seated Dumbbell Shoulder Press'),
    build('Lat Pulldown'),
    pump('Dumbbell Curl'),
    pump('Cable Tricep Pushdown'),
  ],
};

const LOWER_A: StarterDay = {
  name: { he: 'תחתון א׳', en: 'Lower A' },
  exercises: [
    lift('Back Squat', 4),
    build('Romanian Deadlift'),
    build('Leg Press'),
    pump('Seated Leg Curl'),
    pump('Standing Calf Raise'),
    hold('Plank'),
  ],
};

const UPPER_B: StarterDay = {
  name: { he: 'עליון ב׳', en: 'Upper B' },
  exercises: [
    build('Incline Dumbbell Press', 4),
    build('Seated Cable Row', 4),
    light('Dumbbell Lateral Raise'),
    build('Close-Grip Lat Pulldown'),
    pump('Hammer Curl'),
    pump('Overhead Tricep Extension'),
  ],
};

const LOWER_B: StarterDay = {
  name: { he: 'תחתון ב׳', en: 'Lower B' },
  exercises: [
    { key: 'Conventional Deadlift', sets: 3, reps: [5, 8] },
    build('Bulgarian Split Squat'),
    pump('Leg Extension'),
    build('Hip Thrust'),
    pump('Seated Calf Raise'),
    pump('Hanging Knee Raise'),
  ],
};

/* --------------------------------------------------------------------- the programmes */

export const STARTER_PROGRAMS: readonly StarterProgram[] = [
  {
    id: 'full-body-2',
    name: { he: 'גוף מלא · פעמיים בשבוע', en: 'Full body · twice a week' },
    blurb: {
      he: 'שני אימונים שכל אחד מהם עובד על כל הגוף. מתאים למי שמתחיל, או שיש לו מעט זמן.',
      en: 'Two workouts that each train the whole body. For starting out, or a tight week.',
    },
    place: 'gym',
    daysPerWeek: [2],
    days: [
      {
        name: { he: 'גוף מלא א׳', en: 'Full body A' },
        exercises: [
          lift('Back Squat'),
          lift('Barbell Bench Press'),
          build('Seated Cable Row'),
          build('Dumbbell Romanian Deadlift'),
          build('Seated Dumbbell Shoulder Press'),
          hold('Plank'),
        ],
      },
      {
        name: { he: 'גוף מלא ב׳', en: 'Full body B' },
        exercises: [
          build('Leg Press'),
          build('Lat Pulldown'),
          build('Incline Dumbbell Press'),
          pump('Seated Leg Curl'),
          light('Dumbbell Lateral Raise'),
          pump('Cable Crunch'),
        ],
      },
    ],
  },
  {
    id: 'full-body-3',
    name: { he: 'גוף מלא · 3 אימונים בשבוע', en: 'Full body · 3 days a week' },
    blurb: {
      he: 'שלושה אימונים שונים לכל הגוף, עם יום מנוחה ביניהם. נקודת ההתחלה הקלאסית.',
      en: 'Three different whole-body workouts with a rest day between. The classic place to start.',
    },
    place: 'gym',
    daysPerWeek: [3],
    days: [
      {
        name: { he: 'גוף מלא א׳', en: 'Full body A' },
        exercises: [
          lift('Back Squat'),
          lift('Barbell Bench Press'),
          build('Barbell Row'),
          light('Dumbbell Lateral Raise'),
          pump('Cable Tricep Pushdown'),
          hold('Plank'),
        ],
      },
      {
        name: { he: 'גוף מלא ב׳', en: 'Full body B' },
        exercises: [
          lift('Romanian Deadlift'),
          lift('Overhead Barbell Press'),
          build('Lat Pulldown'),
          pump('Walking Lunge'),
          pump('Dumbbell Curl'),
          pump('Hanging Knee Raise'),
        ],
      },
      {
        name: { he: 'גוף מלא ג׳', en: 'Full body C' },
        exercises: [
          build('Leg Press'),
          build('Incline Dumbbell Press'),
          build('Seated Cable Row'),
          pump('Seated Leg Curl'),
          light('Face Pull'),
          pump('Cable Crunch'),
        ],
      },
    ],
  },
  {
    id: 'push-pull-legs',
    name: { he: 'דחיפה · משיכה · רגליים', en: 'Push · Pull · Legs' },
    blurb: {
      he: 'שלושה אימונים לפי תנועה. פעם בשבוע כל אחד, או פעמיים למי שמתאמן שישה ימים.',
      en: 'Three workouts split by movement. Each once a week, or twice for a six-day week.',
    },
    place: 'gym',
    daysPerWeek: [3, 6],
    days: [PUSH, PULL, LEGS],
  },
  {
    id: 'upper-lower-4',
    name: { he: 'עליון · תחתון · 4 אימונים בשבוע', en: 'Upper · Lower · 4 days a week' },
    blurb: {
      he: 'פלג גוף עליון ותחתון, כל אחד פעמיים בשבוע עם תרגילים שונים. איזון טוב בין נפח להתאוששות.',
      en: 'Upper and lower body, each twice a week with different exercises. A good balance of work and recovery.',
    },
    place: 'gym',
    daysPerWeek: [4],
    days: [UPPER_A, LOWER_A, UPPER_B, LOWER_B],
  },
  {
    id: 'five-day',
    name: { he: '5 אימונים בשבוע', en: '5 days a week' },
    blurb: {
      he: 'דחיפה, משיכה ורגליים, ואחריהם אימון עליון ואימון תחתון. למי שכבר מתאמן בקביעות.',
      en: 'Push, pull and legs, then an upper and a lower day. For someone already training regularly.',
    },
    place: 'gym',
    daysPerWeek: [5],
    days: [PUSH, PULL, LEGS, UPPER_B, LOWER_B],
  },
  {
    id: 'home-no-equipment',
    name: { he: 'אימון ביתי ללא ציוד', en: 'At home, no equipment' },
    blurb: {
      he: 'שלושה אימונים במשקל גוף בלבד, לכל מקום. אפשר לעשות אותם פעמיים עד ארבע פעמים בשבוע.',
      en: 'Three bodyweight-only workouts for anywhere. Two to four times a week.',
    },
    place: 'home',
    daysPerWeek: [2, 3, 4],
    days: [
      {
        name: { he: 'בית א׳', en: 'Home A' },
        exercises: [
          { key: 'Bodyweight Squat', sets: 3, reps: [12, 20] },
          { key: 'Push-up', sets: 3, reps: [8, 15] },
          { key: 'Glute Bridge', sets: 3, reps: [12, 20] },
          { key: 'Pike Push-up', sets: 3, reps: [6, 12] },
          hold('Plank'),
        ],
      },
      {
        name: { he: 'בית ב׳', en: 'Home B' },
        exercises: [
          { key: 'Bodyweight Lunge', sets: 3, reps: [10, 15] },
          { key: 'Diamond Push-up', sets: 3, reps: [6, 12] },
          { key: 'Superman', sets: 3, reps: [12, 15] },
          { key: 'Single-Leg Glute Bridge', sets: 3, reps: [10, 15] },
          { key: 'Dead Bug', sets: 3, reps: [10, 15] },
          hold('Side Plank'),
        ],
      },
      {
        name: { he: 'בית ג׳', en: 'Home C' },
        exercises: [
          { key: 'Jump Squat', sets: 3, reps: [10, 15] },
          { key: 'Push-up', sets: 3, reps: [8, 15] },
          { key: 'Bird Dog', sets: 3, reps: [10, 12] },
          hold('Wall Sit'),
          { key: 'Bicycle Crunch', sets: 3, reps: [15, 20] },
          hold('Mountain Climber'),
        ],
      },
    ],
  },
];

/** The range of training days a week the picker offers. */
export const STARTER_DAY_CHOICES = [2, 3, 4, 5, 6] as const;

/** How far a programme is from suiting `daysPerWeek`: 0 is a fit, 1 is a day out. */
export function starterFit(program: StarterProgram, daysPerWeek: number): number {
  return Math.min(...program.daysPerWeek.map((days) => Math.abs(days - daysPerWeek)));
}

/**
 * Every programme for `place`, the ones that suit `daysPerWeek` first.
 *
 * All of them, not only the fits. The number of days is a guess the person made a second ago,
 * and the four-day plan next to the three-day one they asked for is often the one they take.
 * And for a number nothing suits exactly, the nearest is at the top rather than the screen being
 * empty: a near miss can be seen and judged, and no plan at all is a dead end.
 */
export function starterProgramsFor(daysPerWeek: number, place: StarterPlace): StarterProgram[] {
  return STARTER_PROGRAMS.filter((program) => program.place === place)
    .map((program, order) => ({ program, order, away: starterFit(program, daysPerWeek) }))
    .sort((a, b) => a.away - b.away || a.order - b.order)
    .map((entry) => entry.program);
}

/** Whether a catalogue exercise is counted in repetitions, as opposed to time or distance. */
function countsReps(key: string): boolean {
  const loadType = EXERCISE_BY_KEY.get(key)?.loadType ?? 'weight_reps';
  return loadType === 'weight_reps' || loadType === 'bodyweight' || loadType === 'bodyweight_plus';
}

/**
 * What one exercise is prescribed, in the shape the plan tables take.
 *
 * Reps are dropped for anything the catalogue says is not counted in reps, whatever the entry
 * above says: "3 sets of 10-15" on a plank is a target nobody can meet or miss.
 */
export function starterTargets(exercise: StarterExercise): {
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
} {
  const reps = countsReps(exercise.key) ? exercise.reps : undefined;
  return {
    targetSets: exercise.sets,
    targetRepsMin: reps?.[0] ?? null,
    targetRepsMax: reps?.[1] ?? null,
  };
}
