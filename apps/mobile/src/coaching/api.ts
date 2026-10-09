/**
 * The app's side of coaching: every call a coach or a trainee makes to the server, and what
 * the answer means.
 *
 * There is no table here for the app to read or write directly. Coaching exists on the server
 * as a set of functions (apps/api/drizzle/0007_coaching.sql), each of which checks for itself
 * who is asking; this module calls them and nothing else. A trainee's plans are never copied
 * into the coach's local database, and the link between two people is never trusted from this
 * side — the phone only ever says what it would like, and is told whether it may.
 *
 * Written against the small `RpcClient` shape rather than the Supabase client, so that what a
 * refusal means can be tested without a network.
 */

import { parsePlans, dayPayload, type CoachDay, type CoachPlan } from './planDocument.js';

export type CoachingError =
  /** The functions are not on the server: migration 0007 has not been run on this project. */
  | 'not_available'
  /** No answer. Nothing was changed. */
  | 'offline'
  | 'not_signed_in'
  /** Nobody in coach mode has that code. */
  | 'no_such_code'
  /** A coach typing their own code. */
  | 'own_code'
  /** The link is gone — the trainee left, or was removed — since the screen was opened. */
  | 'not_your_trainee'
  /** The group or workout no longer exists. */
  | 'gone'
  /** The server would not take what was sent. */
  | 'invalid'
  | 'failed';

export type CoachingResult<T> = { ok: true; value: T } | { ok: false; error: CoachingError };

export interface CoachingPerson {
  id: string;
  email: string;
  name: string | null;
  /** When the link was made, as the server recorded it. */
  since: string | null;
}

export interface CoachingStatus {
  role: 'trainee' | 'coach';
  /** The code a trainee types to join. Null until coach mode has been switched on once. */
  code: string | null;
  /** Who coaches this account, if anyone. */
  coach: CoachingPerson | null;
  /** Whom this account coaches. Empty for a trainee. */
  trainees: CoachingPerson[];
}

/** The part of the Supabase client this needs. */
export interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

/**
 * What the server's refusal means.
 *
 * The functions raise with a short name as the message (`no_such_code`, `not_your_trainee`),
 * because that is the one part of a Postgres error that survives the trip intact; the code is
 * read as well, for the failures that come from further out than the function.
 */
export function interpretCoachingError(error: { code?: string; message?: string }): CoachingError {
  const code = error.code ?? '';
  const message = error.message ?? '';

  // PostgREST's "no such function in the schema cache".
  if (code === 'PGRST202' || /could not find the function/i.test(message)) return 'not_available';
  if (/no_such_code/.test(message)) return 'no_such_code';
  if (/own_code/.test(message)) return 'own_code';
  if (/not_your_trainee/.test(message)) return 'not_your_trainee';
  if (/no_such_(plan|day)/.test(message)) return 'gone';
  if (code === '28000' || code === 'PGRST301' || /not_signed_in|jwt/i.test(message)) {
    return 'not_signed_in';
  }
  // supabase-js reports a request that never got an answer as an error with no code.
  if (code === '' && /network|fetch|timed? ?out|abort/i.test(message)) return 'offline';
  // The function's own "invalid_…", or a value Postgres could not store.
  if (/invalid_/.test(message) || /^(22|23)/.test(code)) return 'invalid';
  return 'failed';
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function parsePerson(raw: unknown): CoachingPerson | null {
  const person = asRecord(raw);
  if (!person || typeof person.id !== 'string') return null;
  return {
    id: person.id,
    email: typeof person.email === 'string' ? person.email : '',
    name: typeof person.name === 'string' && person.name.trim() !== '' ? person.name : null,
    since: typeof person.since === 'string' ? person.since : null,
  };
}

/**
 * `coach_status`'s answer, as a typed object.
 *
 * Anything missing reads as the quiet case — a trainee, no code, no coach, nobody coached — so
 * that an answer in a shape this version does not expect shows an empty screen, not a crash.
 */
export function parseStatus(raw: unknown): CoachingStatus {
  const status = asRecord(raw) ?? {};
  const trainees = Array.isArray(status.trainees) ? status.trainees : [];
  return {
    role: status.role === 'coach' ? 'coach' : 'trainee',
    code: typeof status.code === 'string' && status.code !== '' ? status.code : null,
    coach: parsePerson(status.coach),
    trainees: trainees.map(parsePerson).filter((person): person is CoachingPerson => person !== null),
  };
}

/** What to call someone in a list: their name if they gave one, otherwise the part before the @. */
export function personLabel(person: CoachingPerson): string {
  return person.name ?? (person.email.split('@')[0] || person.email);
}

/**
 * A code as typed, made into a code as stored: no spaces, upper case.
 *
 * Codes are read off one phone and typed into another, and a keyboard that capitalises the
 * first letter and nothing else is the ordinary case.
 */
export function normaliseCode(typed: string): string {
  return typed.replace(/\s+/g, '').toUpperCase();
}

export const CODE_LENGTH = 6;

export function createCoachingApi(client: RpcClient) {
  const call = async <T>(
    fn: string,
    args: Record<string, unknown> | undefined,
    read: (data: unknown) => T,
  ): Promise<CoachingResult<T>> => {
    let answer: { data: unknown; error: { code?: string; message?: string } | null };
    try {
      answer = await client.rpc(fn, args);
    } catch (thrown) {
      // A thrown request is a request that did not arrive, as far as anyone here can tell.
      answer = {
        data: null,
        error: { message: thrown instanceof Error ? thrown.message : 'network request failed' },
      };
    }
    if (answer.error) return { ok: false, error: interpretCoachingError(answer.error) };
    return { ok: true, value: read(answer.data) };
  };
  const nothing = () => undefined;

  return {
    status: () => call('coach_status', undefined, parseStatus),
    /** Switch coach mode on. Answers with the code. */
    enable: () =>
      call('coach_enable', undefined, (data) => (typeof data === 'string' ? data : null)),
    disable: () => call('coach_disable', undefined, nothing),
    join: (code: string) => call('coach_join', { p_code: normaliseCode(code) }, parseStatus),
    leave: () => call('coach_leave', undefined, nothing),
    removeTrainee: (traineeId: string) =>
      call('coach_remove_trainee', { p_trainee: traineeId }, nothing),

    plans: (traineeId: string): Promise<CoachingResult<CoachPlan[]>> =>
      call('coach_get_plans', { p_trainee: traineeId }, parsePlans),
    savePlan: (traineeId: string, planId: string, name: string) =>
      call('coach_save_plan', { p_trainee: traineeId, p_id: planId, p_name: name }, nothing),
    saveDay: (traineeId: string, planId: string, day: CoachDay) =>
      call(
        'coach_save_day',
        { p_trainee: traineeId, p_plan: planId, p_day: dayPayload(day) },
        nothing,
      ),
    deletePlan: (traineeId: string, planId: string) =>
      call('coach_delete', { p_trainee: traineeId, p_kind: 'plan', p_id: planId }, nothing),
    deleteDay: (traineeId: string, dayId: string) =>
      call('coach_delete', { p_trainee: traineeId, p_kind: 'day', p_id: dayId }, nothing),
  };
}

export type CoachingApi = ReturnType<typeof createCoachingApi>;
