/**
 * Deleting an account: the server first, then this device, and never the other way round.
 *
 * Two copies of someone's data exist — the one in Supabase and the one in SQLite on the phone —
 * and the order they are removed in decides what a failure looks like.
 *
 * Server first. If that call fails, nothing has happened: the account is intact, the phone is
 * intact, and the person can be told so and try again. Device first would leave the worst state
 * there is — an account that still exists, with all its data on a server, and a phone that has
 * just thrown away the session that could have asked for it to be deleted.
 *
 * Once the server has confirmed, the device follows unconditionally. The local steps cannot be
 * allowed to fail the operation: the account is already gone, and "deletion failed" would be a
 * lie. Each is attempted, and what could not be cleaned up is left for the next sign-in to find
 * as an ordinary, empty, signed-out app.
 *
 * The server side is one function, `delete_my_account` (apps/api/drizzle/0006), which deletes the
 * caller and nothing else. Everything the account owns goes with it by cascade.
 */

import type { SqlExecutor } from '../db/executor.js';
import { purgeUserData } from '../db/account.js';

export type DeleteAccountOutcome =
  /** Gone, from the server and from this device. */
  | { status: 'deleted' }
  /** There is no session to delete: already signed out, or it expired. */
  | { status: 'not_signed_in' }
  /** The server has no such function — migration 0006 has not been run on this project. */
  | { status: 'not_available' }
  /** No answer from the server. Nothing was deleted anywhere. */
  | { status: 'offline' }
  | { status: 'failed'; message: string };

/** The part of the Supabase client this needs, so that a test can stand in for it. */
export interface DeletionClient {
  rpc(fn: string): PromiseLike<{ error: { code?: string; message?: string } | null }>;
  auth: { signOut(options: { scope: 'local' }): Promise<unknown> };
}

/**
 * What the server's refusal means.
 *
 * Worth telling apart because the remedies differ: "try again when you have signal", "sign in
 * again first", and "this needs the developer" are three different things to tell someone who
 * has just decided to leave.
 */
export function interpretDeletionError(error: {
  code?: string;
  message?: string;
}): Exclude<DeleteAccountOutcome, { status: 'deleted' }> {
  const code = error.code ?? '';
  const message = error.message ?? '';

  // PostgREST's "no such function in the schema cache".
  if (code === 'PGRST202' || /could not find the function/i.test(message)) {
    return { status: 'not_available' };
  }
  // The function's own refusal (28000), or PostgREST rejecting an expired or missing token.
  if (code === '28000' || code === 'PGRST301' || /jwt|not signed in/i.test(message)) {
    return { status: 'not_signed_in' };
  }
  // supabase-js reports a request that never got an answer as an error with no code.
  if (code === '' && /network|fetch|timed? ?out|abort/i.test(message)) {
    return { status: 'offline' };
  }
  return { status: 'failed', message: message || code || 'unknown error' };
}

export interface DeleteAccountInput {
  client: DeletionClient;
  db: SqlExecutor;
  userId: string;
  /** Things kept outside the database for this user — a profile picture, saved switches. */
  clearDeviceState?: (userId: string) => Promise<void>;
}

/** Delete the signed-in account. See the note at the top of the file for the order of things. */
export async function deleteAccount({
  client,
  db,
  userId,
  clearDeviceState,
}: DeleteAccountInput): Promise<DeleteAccountOutcome> {
  let error: { code?: string; message?: string } | null;
  try {
    ({ error } = await client.rpc('delete_my_account'));
  } catch (thrown) {
    // A thrown request is a request that did not arrive, as far as anyone here can tell.
    error = { message: thrown instanceof Error ? thrown.message : 'network request failed' };
  }
  if (error) return interpretDeletionError(error);

  // The account no longer exists. Everything from here is cleaning up after it, and none of it
  // may turn a deletion that happened into one that is reported as having failed.
  await purgeUserData(db, userId).catch(() => undefined);
  await clearDeviceState?.(userId).catch(() => undefined);
  // Local scope: there is no session left on the server to revoke, and asking it to would fail.
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined);

  return { status: 'deleted' };
}
