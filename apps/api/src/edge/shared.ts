/**
 * What the two halves of the Supabase function have in common: who is calling, whether they
 * have any of today's allowance left, and which models to ask.
 *
 * The function (`main.ts`) does two jobs — it reads a photographed meal (`scan-food.ts`) and
 * it answers as the coach (`coach.ts`). Both spend the same free allowance from Google, and
 * both are reachable by anyone who can sign up, with a key that is public. So both begin the
 * same way, and that beginning is here once rather than twice.
 */

/** Everything the function reaches outside itself for, so a test can stand in for all of it. */
export interface EdgeDeps {
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  /**
   * One line to the function's log, which the Supabase dashboard shows. It is the only place
   * a failure can be read back from: the phone is told a word it can translate, and the reason
   * behind the word stays here. Model names and status codes — never anything a person typed
   * or photographed.
   */
  log?: (line: string) => void;
}

/**
 * Tried in order. A model that is unknown or out of free quota hands on to the next, and each
 * has a quota of its own — so the list is also what makes the free tier go further.
 */
export const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

/** The models to try: the ones named in the `GEMINI_MODELS` secret, or the defaults. */
export function modelsToTry(deps: EdgeDeps): string[] {
  const named = (deps.env('GEMINI_MODELS') ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter((model) => /^[a-z0-9.-]+$/i.test(model));
  return named.length > 0 ? named : DEFAULT_MODELS;
}

/** The token a request carries, or undefined. */
export function bearerToken(request: Request): string | undefined {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1]?.trim();
}

/** Whose token this is, by asking the auth server. Null for the anon key or a dead session. */
export async function signedInUser(deps: EdgeDeps, token: string): Promise<string | null> {
  const base = deps.env('SUPABASE_URL');
  const anon = deps.env('SUPABASE_ANON_KEY');
  if (!base || !anon) return null;
  try {
    const response = await deps.fetch(`${base}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { id?: unknown };
    return typeof user.id === 'string' && user.id !== '' ? user.id : null;
  } catch {
    return null;
  }
}

export type LimitVerdict = 'ok' | 'daily_limit' | 'not_set_up' | 'server_error';

/**
 * Count one use against the account's day.
 *
 * A row in `table`, written as the caller. The table's trigger stamps the owner and the time
 * itself and refuses the row once the day's allowance is used (drizzle/0015 for scans, 0016
 * for the coach), so the limit cannot be talked round by a client — this only reads the
 * verdict. `limitWord` is what the trigger raises, and what is looked for.
 */
export async function countAgainstLimit(
  deps: EdgeDeps,
  token: string,
  table: 'food_scans' | 'coach_turns',
  limitWord: string,
): Promise<LimitVerdict> {
  const base = deps.env('SUPABASE_URL');
  const anon = deps.env('SUPABASE_ANON_KEY');
  if (!base || !anon) return 'not_set_up';
  try {
    const response = await deps.fetch(`${base}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: '{}',
    });
    if (response.ok) return 'ok';

    const problem = (await response.json().catch(() => ({}))) as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof problem.message === 'string' && problem.message.includes(limitWord)) {
      return 'daily_limit';
    }
    // The table is not there: the SQL has not been run. Refused rather than waved through —
    // without the table there is no limit, and an unlimited function is the thing to avoid.
    if (response.status === 404 || problem.code === 'PGRST205' || problem.code === '42P01') {
      return 'not_set_up';
    }
    return 'server_error';
  } catch {
    return 'server_error';
  }
}

/**
 * A short, safe label for why Google did not answer.
 *
 * The HTTP status and Google's own error enumeration (`RESOURCE_EXHAUSTED`,
 * `PERMISSION_DENIED`) and nothing else. Both are fixed vocabularies; the message beside them
 * is prose that can quote the request back, and is left where it is.
 */
export async function googleErrorCode(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: { status?: unknown } };
  const reason = typeof body.error?.status === 'string' ? body.error.status : null;
  return [String(response.status), reason].filter(Boolean).join(' ');
}

export const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
