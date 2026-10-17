/**
 * Everything the dashboard asks of the server, in one shape.
 *
 * Two things answer it: the real server (`supabaseSource.ts`), through the same coach functions
 * the app calls, and a demonstration (`demoSource.ts`) that answers from made-up trainees held
 * in memory. Every page is written against this interface and cannot tell which it has — which
 * is what lets the demonstration show exactly the screens a coach will use, and lets the pages
 * be looked at without anyone's real account.
 *
 * Nothing here reads a table. A coach reaches a trainee only through the functions in
 * apps/api/drizzle (0007 onward), each of which checks the link before it answers; this file
 * cannot ask for more than they give.
 */

import type {
  AppointedCoach,
  CoachCalendar,
  CoachDay,
  CoachingResult,
  CoachingStatus,
  CoachMeasurement,
  CoachNutrition,
  CoachPhoto,
  CoachPlan,
  CoachSession,
} from '@fit/shared/coaching';

export interface CoachData {
  /** Which of the two this is. The pages say so when it is the demonstration. */
  readonly mode: 'live' | 'demo';

  status(): Promise<CoachingResult<CoachingStatus>>;
  /**
   * A trainee's finished workouts that started in `[from, to)`, newest first — all of them, not
   * one page: `sessionsBetween` asks again for as long as the server keeps filling a page.
   */
  sessions(traineeId: string, from: Date, to: Date): Promise<CoachingResult<CoachSession[]>>;
  /** The calendar between two local dates, inclusive. */
  schedule(traineeId: string, from: string, to: string): Promise<CoachingResult<CoachCalendar>>;
  plans(traineeId: string): Promise<CoachingResult<CoachPlan[]>>;

  /*
   * What the trainee chose to share beyond training (0018). Each is refused with `not_shared`
   * while its switch is off, so a page asks only when `person.sharing` says it may.
   */
  /** Weigh-ins that were taken in `[from, to]`, newest first. */
  body(traineeId: string, from: Date, to: Date): Promise<CoachingResult<CoachMeasurement[]>>;
  /** The food log, water and the app's targets, between two local dates inclusive. */
  nutrition(traineeId: string, from: string, to: string): Promise<CoachingResult<CoachNutrition>>;
  photos(traineeId: string): Promise<CoachingResult<CoachPhoto[]>>;
  /**
   * Links to look at photos, by photo id, good for an hour. A photo whose picture has not
   * reached the server yet is simply absent.
   */
  photoUrls(traineeId: string, photoIds: readonly string[]): Promise<Record<string, string>>;

  setSchedule(
    traineeId: string,
    date: string,
    planDayIds: readonly string[],
    rest: boolean,
  ): Promise<CoachingResult<void>>;
  savePlan(traineeId: string, planId: string, name: string): Promise<CoachingResult<void>>;
  saveDay(traineeId: string, planId: string, day: CoachDay): Promise<CoachingResult<void>>;
  deletePlan(traineeId: string, planId: string): Promise<CoachingResult<void>>;
  deleteDay(traineeId: string, dayId: string): Promise<CoachingResult<void>>;
  removeTrainee(traineeId: string): Promise<CoachingResult<void>>;

  /** Administrators only; the server refuses anyone else. */
  coaches(): Promise<CoachingResult<AppointedCoach[]>>;
  setCoach(email: string, on: boolean): Promise<CoachingResult<AppointedCoach[]>>;
}

/** How many workouts the server answers with at most, per call (0012). */
export const SESSION_PAGE = 60;
/** A ceiling on pages for one range: twenty pages is 1,200 workouts, years of training. */
const MAX_PAGES = 20;

type PageReader = (from: string, to: string) => Promise<CoachingResult<CoachSession[]>>;

/**
 * Every workout in a range, from a server that answers sixty at a time.
 *
 * The server returns the newest sixty that started before `to`. When a page comes back full
 * there may be more, all older than the oldest on it, so the next request ends where that one
 * began. A page that is not full is the last. Ids are de-duplicated on the way, so a workout
 * that two pages both reach is counted once.
 */
export async function sessionsBetween(
  read: PageReader,
  from: Date,
  to: Date,
): Promise<CoachingResult<CoachSession[]>> {
  const seen = new Set<string>();
  const all: CoachSession[] = [];
  let end = to.toISOString();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await read(from.toISOString(), end);
    if (!answer.ok) return answer;

    let oldest: string | null = null;
    for (const session of answer.value) {
      if (!seen.has(session.id)) {
        seen.add(session.id);
        all.push(session);
      }
      if (oldest === null || session.startedAt < oldest) oldest = session.startedAt;
    }

    // Not full: nothing older remains. Or no progress: stop rather than ask the same again.
    if (answer.value.length < SESSION_PAGE || oldest === null || oldest >= end) break;
    end = oldest;
  }

  all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return { ok: true, value: all };
}
